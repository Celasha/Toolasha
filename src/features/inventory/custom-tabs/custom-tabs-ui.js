/**
 * Custom Inventory Tabs — UI Module
 * Injects a "Toolasha" tab into the character panel tab bar. When active,
 * uses CSS `display: contents` + `order` to visually reorganize game tiles
 * into accordion sections without moving them out of their React-managed container.
 *
 * Key insight: physically moving React-owned tiles destroys them permanently.
 * Instead we flatten the DOM hierarchy with `display: contents` on wrapper divs,
 * inject accordion headers directly into Inventory_items, and use CSS `order`
 * to visually group tiles under headers. Tiles never leave Inventory_items.
 */

import config from '../../../core/config.js';
import domObserver from '../../../core/dom-observer.js';
import dataManager from '../../../core/data-manager.js';
import inventorySort from '../inventory-sort.js';
import inventoryBadgeManager from '../inventory-badge-manager.js';
import {
    loadConfig,
    saveConfig,
    addTab,
    removeTab,
    renameTab,
    setTabColor,
    moveTab,
    addItem,
    removeItem,
    reorderItem,
    setTabOpen,
    findTab,
    getAssignedItemSet,
} from './custom-tabs-data.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const PANEL_CSS = `
/* ---------- Toolasha-active mode on Inventory_items ---------- */
/* When our tab is active, Inventory_items becomes a flex container.
   Category wrappers and grids get display:contents so tiles become
   direct flex children and can be reordered with CSS order. */
.toolasha-ct-active {
    display: flex !important;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 0;
}
/* Flatten game category wrappers so tiles become direct flex children.
   Exclude our own injected elements (they have class starting with toolasha-). */
.toolasha-ct-active > *:not([class*="toolasha-"]) {
    display: contents;
}
.toolasha-ct-active [class*="Inventory_itemGrid"] {
    display: contents;
}

/* Hide game category labels and buttons exposed by display:contents */
.toolasha-ct-active [class*="Inventory_label"],
.toolasha-ct-active [class*="Inventory_categoryButton"] {
    display: none !important;
}

/* When active, hide ALL tiles by default — _applyLayout selectively shows them.
   This prevents flash of unstyled tiles when React re-renders new elements. */
.toolasha-ct-active [class*="Item_itemContainer"] {
    display: none !important;
}
/* Tiles we explicitly want visible get this class */
.toolasha-ct-active [class*="Item_itemContainer"].toolasha-ct-visible {
    display: flex !important;
}

/* ---------- Top bar (injected into Inventory_items) ---------- */
.toolasha-ct-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid #333;
    flex-basis: 100%;
    flex-shrink: 0;
    box-sizing: border-box;
    color: #d4d4d4;
    font-family: inherit;
    font-size: 13px;
}
.toolasha-ct-add-btn {
    background: #2a5a3a;
    color: #9fd;
    border: 1px solid #3a7a4a;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
}
.toolasha-ct-add-btn:hover { background: #3a7a4a; }

/* ---------- Accordion header (injected into Inventory_items) ---------- */
.toolasha-ct-section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px calc(10px + var(--depth, 0) * 20px);
    cursor: pointer;
    user-select: none;
    flex-basis: 100%;
    flex-shrink: 0;
    box-sizing: border-box;
    border-bottom: 1px solid #2a2a2a;
    color: #d4d4d4;
    font-family: inherit;
    font-size: 13px;
}
.toolasha-ct-section-header:hover { background: rgba(255,255,255,0.04); }
.toolasha-ct-chevron {
    width: 14px;
    text-align: center;
    font-size: 10px;
    color: #888;
    flex-shrink: 0;
}
.toolasha-ct-section-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    color: #e0e0e0;
}
.toolasha-ct-section-count {
    font-size: 11px;
    color: #666;
    margin-left: 4px;
}
.toolasha-ct-section-actions {
    display: none;
    gap: 2px;
    flex-shrink: 0;
}
.toolasha-ct-section-header:hover .toolasha-ct-section-actions { display: flex; }
.toolasha-ct-node-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
    line-height: 1;
}
.toolasha-ct-node-btn:hover { color: #ddd; }

/* ---------- Unorganized bucket header ---------- */
.toolasha-ct-unorg-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 4px;
    margin-top: 4px;
    border-top: 1px solid #333;
    cursor: pointer;
    color: #888;
    font-size: 12px;
    flex-basis: 100%;
    flex-shrink: 0;
    box-sizing: border-box;
}
.toolasha-ct-unorg-header:hover { color: #aaa; }

.toolasha-ct-empty {
    color: #666;
    font-style: italic;
    padding: 12px 10px;
    text-align: center;
    font-size: 12px;
    flex-basis: 100%;
}

/* Drag indicator */
.toolasha-ct-section-header.toolasha-ct-section--drag-over {
    border-top: 2px solid #4a9eff;
}

/* ---------- Editor modal ---------- */
.toolasha-ct-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
}
.toolasha-ct-modal {
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 16px;
    width: 380px;
    max-height: 80vh;
    overflow-y: auto;
    color: #d4d4d4;
}
.toolasha-ct-modal * { box-sizing: border-box; }
.toolasha-ct-modal h3 {
    margin: 0 0 12px;
    font-size: 15px;
    color: #e0e0e0;
}
.toolasha-ct-modal label {
    display: block;
    font-size: 12px;
    color: #aaa;
    margin-bottom: 4px;
}
.toolasha-ct-modal input[type="text"],
.toolasha-ct-modal input[type="search"] {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #444;
    border-radius: 4px;
    background: #111;
    color: #ddd;
    font-size: 13px;
    margin-bottom: 8px;
}
.toolasha-ct-swatches {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
}
.toolasha-ct-swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
}
.toolasha-ct-swatch--active { border-color: #fff; }
.toolasha-ct-search-results {
    max-height: 160px;
    overflow-y: auto;
    margin-bottom: 8px;
}
.toolasha-ct-search-result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    cursor: pointer;
    border-radius: 3px;
}
.toolasha-ct-search-result:hover { background: rgba(255,255,255,0.08); }
.toolasha-ct-search-result svg {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
}
.toolasha-ct-search-group-header { font-weight: 500; }
.toolasha-ct-search-level-row { padding-left: 32px; }
.toolasha-ct-level-badges {
    color: #888;
    font-size: 11px;
    margin-left: 4px;
    flex-shrink: 0;
}
.toolasha-ct-expand-btn {
    margin-left: auto;
    color: #666;
    font-size: 11px;
    flex-shrink: 0;
    padding: 0 2px;
}
.toolasha-ct-assigned-list {
    margin-top: 8px;
}
.toolasha-ct-assigned-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: 3px;
}
.toolasha-ct-assigned-item:hover { background: rgba(255,255,255,0.05); }
.toolasha-ct-assigned-item.toolasha-ct-drag-over { background: rgba(255,255,255,0.12); outline: 1px dashed #888; }
.toolasha-ct-assigned-item svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
}
.toolasha-ct-assigned-item .toolasha-ct-node-btn {
    margin-left: auto;
}
.toolasha-ct-drag-handle {
    cursor: grab;
    color: #555;
    font-size: 14px;
    flex-shrink: 0;
    user-select: none;
    padding: 0 2px;
}
.toolasha-ct-drag-handle:active { cursor: grabbing; }
.toolasha-ct-modal-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #333;
}
.toolasha-ct-delete-btn {
    background: #5a1a1a;
    color: #faa;
    border: 1px solid #8a2a2a;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
}
.toolasha-ct-delete-btn:hover { background: #7a2a2a; }
.toolasha-ct-close-btn {
    background: #333;
    color: #ccc;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
}
.toolasha-ct-close-btn:hover { background: #444; }
.toolasha-ct-clear-btn {
    background: #3a2a0a;
    color: #f0b040;
    border: 1px solid #6a4a10;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
}
.toolasha-ct-clear-btn:hover { background: #5a3a10; }

/* ---------- Category buttons ---------- */
.toolasha-ct-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
}
.toolasha-ct-cat-btn {
    background: #1e2a3a;
    color: #8ab4f0;
    border: 1px solid #2a4060;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
}
.toolasha-ct-cat-btn:hover { background: #2a4060; }
.toolasha-ct-cat-btn--added {
    background: #1a3a2a;
    color: #6c6;
    border-color: #2a5a3a;
    cursor: pointer;
}
.toolasha-ct-cat-btn--added:hover { background: #2a5a3a; }

/* ---------- Category filter ---------- */
.toolasha-ct-search-row {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
}
.toolasha-ct-search-row input[type="search"] {
    flex: 1;
    margin-bottom: 0;
}
.toolasha-ct-cat-filter {
    padding: 4px 6px;
    border: 1px solid #444;
    border-radius: 4px;
    background: #111;
    color: #ddd;
    font-size: 12px;
    min-width: 100px;
}
`;

// Sprite URL cache — needed for editor modal item search results
let _spriteBaseUrl = null;

/**
 * Discover the game's items SVG sprite URL
 * @returns {string|null}
 */
function getSpriteBaseUrl() {
    if (_spriteBaseUrl) return _spriteBaseUrl;
    const allUses = document.querySelectorAll('svg use');
    for (const useEl of allUses) {
        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
        if (href.includes('items_sprite')) {
            const hashIdx = href.indexOf('#');
            if (hashIdx > 0) {
                _spriteBaseUrl = href.slice(0, hashIdx);
                return _spriteBaseUrl;
            }
        }
    }
    return null;
}

// Color presets for tab accents
const COLOR_PRESETS = ['#e06060', '#e0a030', '#40c060', '#40a0e0', '#a060e0', '#e060c0'];

export default class CustomTabsUI {
    constructor() {
        this._isActive = false;
        this._config = null;
        this._tabBtn = null;
        this._invContainer = null;
        this._injectedEls = []; // Elements we injected into Inventory_items (headers, topbar)
        this._unregisterHandlers = [];
        this._onItemsUpdated = null;
        this._styleEl = null;
        this._unorgOpen = true;
        this._editorTabId = null;
        this._deleteConfirmId = null;
        this._dragInProgress = false; // Suppress click-toggles immediately after a drag-drop
        this._inventoryTabEl = null; // Ref to native Inventory tab button (for restore on cleanup)
        this._expandedSearchHrids = null; // Set of base hrids expanded in the item picker
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async initialize() {
        const charId = dataManager.getCurrentCharacterId();
        this._config = await loadConfig(charId);

        // Inject CSS
        this._styleEl = document.createElement('style');
        this._styleEl.textContent = PANEL_CSS;
        document.head.appendChild(this._styleEl);

        // Inject tab button into character panel tab bar
        this._tryInjectTabButton();

        const unregister = domObserver.onClass('CustomTabs', 'TabsComponent_tabsContainer', () => {
            this._tryInjectTabButton();
        });
        this._unregisterHandlers.push(unregister);

        if (!this._tabBtn) {
            let retries = 0;
            const retryInterval = setInterval(() => {
                retries++;
                this._tryInjectTabButton();
                if (this._tabBtn || retries >= 20) clearInterval(retryInterval);
            }, 500);
            this._unregisterHandlers.push(() => clearInterval(retryInterval));
        }

        // Live setting change for default-tab behaviour
        const unregisterDefaultTab = config.onSettingChange('inventoryTabs_defaultTab', () => {
            this._applyDefaultTabSetting();
        });
        this._unregisterHandlers.push(unregisterDefaultTab);

        // Re-apply layout when inventory changes
        let debounceTimer = null;
        this._onItemsUpdated = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (this._isActive) this._applyLayout();
            }, 200);
        };
        dataManager.on('items_updated', this._onItemsUpdated);

        // Re-apply layout when sort mode changes
        const unregisterSort = inventorySort.onModeChange(() => {
            if (this._isActive) this._applyLayout();
        });
        this._unregisterHandlers.push(unregisterSort);
    }

    cleanup() {
        if (this._inventoryTabEl) {
            this._inventoryTabEl.style.display = '';
            this._inventoryTabEl = null;
        }

        this._clearLayout();

        if (this._onItemsUpdated) {
            dataManager.off('items_updated', this._onItemsUpdated);
            this._onItemsUpdated = null;
        }
        for (const unreg of this._unregisterHandlers) unreg();
        this._unregisterHandlers = [];

        this._tabBtn?.remove();
        this._styleEl?.remove();
        this._isActive = false;
    }

    // -----------------------------------------------------------------------
    // Tab button injection
    // -----------------------------------------------------------------------

    _findCharacterTabList() {
        const allTabLists = document.querySelectorAll('[role="tablist"]');
        for (const tl of allTabLists) {
            for (const tab of tl.querySelectorAll('[role="tab"]')) {
                if (tab.textContent.trim() === 'Inventory') return tl;
            }
        }
        return null;
    }

    _tryInjectTabButton() {
        try {
            const tabList = this._findCharacterTabList();
            if (!tabList) return;
            if (tabList.querySelector('.toolasha-inv-tab')) return;

            const existingTab = tabList.querySelector('[role="tab"]');
            const btn = document.createElement('button');
            btn.className =
                'toolasha-inv-tab ' + (existingTab ? existingTab.className.replace(/Mui-selected/g, '') : '');
            btn.setAttribute('role', 'tab');
            btn.setAttribute('type', 'button');
            btn.textContent = 'Toolasha';
            btn.style.minWidth = 'auto';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._activatePanel();
            });

            const inventoryTab = [...tabList.querySelectorAll('[role="tab"]')].find(
                (t) => t.textContent.trim() === 'Inventory'
            );
            if (inventoryTab) this._inventoryTabEl = inventoryTab;
            if (inventoryTab?.nextSibling) {
                tabList.insertBefore(btn, inventoryTab.nextSibling);
            } else {
                tabList.appendChild(btn);
            }
            this._tabBtn = btn;

            const scroller = tabList.parentElement;
            if (scroller && scroller.className.includes('MuiTabs-scroller')) {
                scroller.style.overflow = 'auto';
            }

            for (const tab of tabList.querySelectorAll('[role="tab"]:not(.toolasha-inv-tab)')) {
                tab.addEventListener('click', () => this._deactivatePanel(tab));
            }

            this._applyDefaultTabSetting();
        } catch (err) {
            console.error('[CustomTabs] _tryInjectTabButton failed:', err);
        }
    }

    // -----------------------------------------------------------------------
    // Panel activation / deactivation
    // -----------------------------------------------------------------------

    /**
     * Apply (or remove) the "show Toolasha tab by default" behaviour.
     * Called when the tab button is first injected and on live setting changes.
     */
    _applyDefaultTabSetting() {
        if (!this._tabBtn) return;
        const enabled = config.getSetting('inventoryTabs_defaultTab');
        if (this._inventoryTabEl) {
            this._inventoryTabEl.style.display = enabled ? 'none' : '';
        }
        if (enabled && !this._isActive) {
            this._activatePanel();
        } else if (enabled && this._isActive) {
            // Tab bar was reconstructed by React; re-hide content and re-apply layout
            this._hideGameContent();
            this._applyLayout();
        }
    }

    _activatePanel() {
        if (this._isActive) return;
        this._isActive = true;

        if (this._tabBtn) this._tabBtn.classList.add('Mui-selected');
        const tabList = this._tabBtn?.parentElement;
        if (tabList) {
            for (const tab of tabList.querySelectorAll('[role="tab"]:not(.toolasha-inv-tab)')) {
                tab.classList.remove('Mui-selected');
                tab.setAttribute('aria-selected', 'false');
            }
        }

        // Hide the game's content panels (Equipment, Abilities, etc.)
        this._hideGameContent();

        this._applyLayout();
    }

    _deactivatePanel(clickedTab = null) {
        if (!this._isActive) return;
        this._isActive = false;
        if (this._tabBtn) this._tabBtn.classList.remove('Mui-selected');
        this._clearLayout();
        this._showGameContent();
        // Restore the selected state on the clicked native tab. React won't re-render because
        // MUI still thinks this tab was selected (we bypassed its state when activating Toolasha).
        if (clickedTab) {
            clickedTab.classList.add('Mui-selected');
            clickedTab.setAttribute('aria-selected', 'true');
        }
    }

    /**
     * Hide the game's TabsComponent_tabPanelsContainer content
     * (the content for Inventory/Equipment/etc.)
     */
    _hideGameContent() {
        const contentContainer = this._findContentContainer();
        if (contentContainer) {
            contentContainer.style.display = 'none';
        }
    }

    /**
     * Restore the game's TabsComponent_tabPanelsContainer content
     */
    _showGameContent() {
        const contentContainer = this._findContentContainer();
        if (contentContainer) {
            contentContainer.style.display = '';
        }
    }

    /**
     * Find the TabsComponent_tabPanelsContainer that holds game content
     * @returns {HTMLElement|null}
     */
    _findContentContainer() {
        const tabList = this._findCharacterTabList();
        if (!tabList) return null;
        const wrapper = tabList.closest('[class*="TabsComponent_tabsContainer"]');
        return wrapper?.nextElementSibling || null;
    }

    // -----------------------------------------------------------------------
    // Layout: CSS order approach — tiles stay in Inventory_items
    // -----------------------------------------------------------------------

    /**
     * Find the game's Inventory_items element
     * @returns {HTMLElement|null}
     */
    _findInvContainer() {
        return document.querySelector('[class*="Inventory_items"]');
    }

    /**
     * Apply the CSS order layout. Tiles never leave Inventory_items.
     * We add `display: contents` to flatten wrapper divs, inject accordion
     * headers, and set CSS `order` on each tile to group them visually.
     *
     * Tiles are hidden by default via the CSS rule on .toolasha-ct-active,
     * then selectively shown by adding .toolasha-ct-visible.
     */
    async _applyLayout() {
        const invContainer = this._findInvContainer();
        if (!invContainer) return;

        const isSameNode = invContainer === this._invContainer;
        const injectedStillPresent =
            this._injectedEls.length > 0 && this._injectedEls[0].parentElement === invContainer;
        const needsFullRebuild = !isSameNode || !injectedStillPresent;

        this._invContainer = invContainer;

        // Add the active class — this makes Inventory_items a flex container,
        // applies display:contents to category wrappers, hides category labels,
        // and hides ALL tiles by default (via CSS).
        invContainer.classList.add('toolasha-ct-active');

        // Ensure the Inventory panel is visible
        this._showInventoryPanel();

        if (needsFullRebuild) {
            this._removeInjectedEls();
        }

        // Ensure badge manager has prices calculated before we sort tiles.
        // On mobile the inventory panel is created fresh each time "My Stuff" opens —
        // the badge manager's DOM observer fires a render concurrently with _applyLayout,
        // causing isRendering/isCalculating guards to block our call. Wait for any
        // in-progress render to finish, then force a fresh calculation.
        if (!inventoryBadgeManager.currentInventoryElem) {
            inventoryBadgeManager.currentInventoryElem = invContainer;
        }
        while (inventoryBadgeManager.isRendering || inventoryBadgeManager.isCalculating) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        inventoryBadgeManager.lastRenderTime = 0;
        inventoryBadgeManager.lastCalculationTime = 0;
        await inventoryBadgeManager.renderAllBadges();

        // Build tile map from all tiles currently in invContainer
        const tileMap = this._buildTileMap(invContainer);

        // Reset all tiles: remove visible class and clear inline order
        const allTiles = invContainer.querySelectorAll('[class*="Item_itemContainer"]');
        for (const tile of allTiles) {
            tile.classList.remove('toolasha-ct-visible');
            tile.style.order = '';
        }

        if (needsFullRebuild) {
            // Full rebuild: inject topbar, headers, and set tile order/visibility
            let orderCounter = 0;

            const topbar = this._createTopbar();
            topbar.style.order = orderCounter++;
            invContainer.appendChild(topbar);
            this._injectedEls.push(topbar);

            if (this._config.tabs.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'toolasha-ct-empty';
                empty.textContent = 'No custom tabs yet. Click "+ Tab" to create one.';
                empty.style.order = orderCounter++;
                invContainer.appendChild(empty);
                this._injectedEls.push(empty);
            } else {
                orderCounter = this._injectAccordionHeaders(invContainer, this._config.tabs, 0, tileMap, orderCounter);
            }

            if (config.getSettingValue('inventoryTabs_showUnorganized')) {
                orderCounter = this._injectUnorganized(invContainer, tileMap, orderCounter);
            }
        } else {
            // Lightweight update: headers already exist, just re-apply tile order/visibility
            this._updateTileVisibility(invContainer, tileMap);
        }
    }

    /**
     * Lightweight tile update — headers are already injected with correct order values.
     * Re-apply toolasha-ct-visible and style.order to tiles based on current config.
     * @param {HTMLElement} invContainer
     * @param {Map} tileMap
     */
    _updateTileVisibility(invContainer, tileMap) {
        // Walk through injected headers to read their order values and match tiles
        const headers = invContainer.querySelectorAll('.toolasha-ct-section-header');
        const headerOrderMap = new Map();
        for (const header of headers) {
            headerOrderMap.set(header.dataset.tabId, parseInt(header.style.order, 10));
        }

        // Show tiles for open tabs, assigning order values after their header
        this._applyTileOrderForTabs(this._config.tabs, tileMap, headerOrderMap);

        // Handle unorganized bucket
        const unorgHeader = invContainer.querySelector('.toolasha-ct-unorg-header');
        if (unorgHeader && this._unorgOpen) {
            const unorgOrder = parseInt(unorgHeader.style.order, 10);
            const assignedSet = getAssignedItemSet(this._config);
            const unorgTiles = [];
            for (const [hrid, tiles] of tileMap) {
                const baseHrid = hrid.replace(/\+\d+$/, '');
                if (!assignedSet.has(hrid) && !assignedSet.has(baseHrid)) {
                    for (const tile of tiles) unorgTiles.push(tile);
                }
            }
            this._assignTileOrders(unorgTiles, unorgOrder + 1);
        }
    }

    /**
     * Recursively apply tile visibility/order for tabs using existing header order values
     * @param {Array} tabs
     * @param {Map} tileMap
     * @param {Map} headerOrderMap - tabId → order number from injected headers
     */
    _applyTileOrderForTabs(tabs, tileMap, headerOrderMap) {
        for (const tab of tabs) {
            const headerOrder = headerOrderMap.get(tab.id);
            if (headerOrder === undefined) continue;

            if (tab.open) {
                const sectionTiles = [];
                for (const hrid of tab.items) {
                    for (const tile of this._claimTilesForHrid(hrid, tileMap)) sectionTiles.push(tile);
                }
                this._assignTileOrders(sectionTiles, headerOrder + 1);

                if (tab.children.length > 0) {
                    this._applyTileOrderForTabs(tab.children, tileMap, headerOrderMap);
                }
            } else {
                // Collapsed — leave own items in tileMap; remove children's items only.
                this._removeTilesFromMapForChildren(tab.children, tileMap);
            }
        }
    }

    /**
     * Ensure the Inventory panel (first tab panel) is visible while hiding others.
     * The content container was hidden on activation; we need to un-hide it but
     * only show the Inventory panel.
     */
    _showInventoryPanel() {
        const contentContainer = this._findContentContainer();
        if (!contentContainer) return;

        // Show the content container itself
        contentContainer.style.display = '';

        // Hide all child panels, then show only the first one (Inventory)
        for (const child of contentContainer.children) {
            child.style.display = 'none';
        }
        if (contentContainer.children[0]) {
            contentContainer.children[0].style.display = 'block';
        }
    }

    /**
     * Remove all CSS classes and injected elements; restore normal game layout.
     */
    _clearLayout() {
        this._removeInjectedEls();

        if (this._invContainer) {
            this._invContainer.classList.remove('toolasha-ct-active');

            // Remove visible class and inline order from all tiles
            const tiles = this._invContainer.querySelectorAll('[class*="Item_itemContainer"]');
            for (const tile of tiles) {
                tile.classList.remove('toolasha-ct-visible');
                tile.style.order = '';
            }
        }

        // Restore content container panels visibility
        const contentContainer = this._findContentContainer();
        if (contentContainer) {
            for (const child of contentContainer.children) {
                child.style.display = '';
            }
        }
    }

    /**
     * Remove all elements we injected into invContainer
     */
    _removeInjectedEls() {
        for (const el of this._injectedEls) {
            el.remove();
        }
        this._injectedEls = [];
    }

    /**
     * Create the top bar element
     * @returns {HTMLElement}
     */
    _createTopbar() {
        const topbar = document.createElement('div');
        topbar.className = 'toolasha-ct-topbar';
        topbar.innerHTML = '<span style="font-size:12px;color:#888;">Custom Tabs</span>';
        const addBtn = document.createElement('button');
        addBtn.className = 'toolasha-ct-add-btn';
        addBtn.textContent = '+ Tab';
        addBtn.addEventListener('click', () => this._onAddTab(null));
        topbar.appendChild(addBtn);
        return topbar;
    }

    /**
     * Build a map of itemHrid → array of game tile elements in the inventory DOM.
     * @param {HTMLElement} invContainer
     * @returns {Map<string, HTMLElement[]>}
     */
    _buildTileMap(invContainer) {
        const map = new Map();
        const tiles = invContainer.querySelectorAll('[class*="Item_itemContainer"]');
        for (const tile of tiles) {
            const svg = tile.querySelector('svg[aria-label]');
            if (!svg) continue;
            const baseName = svg.getAttribute('aria-label');
            const hrid = this._nameToHrid(baseName);
            if (!hrid) continue;
            // Always register under base hrid (matches all enhancement levels)
            if (!map.has(hrid)) map.set(hrid, []);
            map.get(hrid).push(tile);
            // Check for enhancement level badge element
            const enhEl = tile.querySelector('[class*="Item_enhancementLevel"]');
            if (enhEl) {
                const level = parseInt(enhEl.textContent.trim().replace('+', ''), 10);
                if (!isNaN(level) && level > 0) {
                    const enhancedHrid = `${hrid}+${level}`;
                    if (!map.has(enhancedHrid)) map.set(enhancedHrid, []);
                    map.get(enhancedHrid).push(tile);
                }
            }
        }
        return map;
    }

    /**
     * Claim tiles for a given hrid from the tileMap.
     * - Base hrid (/items/foo): claims all tiles (all enhancement levels)
     * - Enhanced hrid (/items/foo+3): claims only +3 tiles and removes them from the base key too
     * @param {string} hrid
     * @param {Map} tileMap
     * @returns {HTMLElement[]}
     */
    _claimTilesForHrid(hrid, tileMap) {
        const entries = tileMap.get(hrid);
        if (!entries) return [];
        tileMap.delete(hrid);
        if (/\+\d+$/.test(hrid)) {
            // Enhanced hrid: also remove these tiles from the base key to prevent double-claim
            const baseHrid = hrid.replace(/\+\d+$/, '');
            const baseEntries = tileMap.get(baseHrid);
            if (baseEntries) {
                const claimedSet = new Set(entries);
                const remaining = baseEntries.filter((t) => !claimedSet.has(t));
                if (remaining.length > 0) tileMap.set(baseHrid, remaining);
                else tileMap.delete(baseHrid);
            }
        }
        return entries;
    }

    /**
     * Lazy-build a name→hrid lookup map
     * @param {string} name
     * @returns {string|null}
     */
    _nameToHrid(name) {
        if (!this._nameHridCache) {
            this._nameHridCache = new Map();
            const initData = dataManager.getInitClientData();
            if (initData?.itemDetailMap) {
                for (const [hrid, details] of Object.entries(initData.itemDetailMap)) {
                    if (details.name) this._nameHridCache.set(details.name, hrid);
                }
            }
        }
        return this._nameHridCache.get(name) || null;
    }

    // -----------------------------------------------------------------------
    // Accordion headers — injected into Inventory_items with CSS order
    // -----------------------------------------------------------------------

    /**
     * Inject accordion headers into invContainer for the given tabs.
     * Show/hide tiles using CSS class + order.
     * @param {HTMLElement} invContainer
     * @param {Array} tabs
     * @param {number} depth
     * @param {Map} tileMap
     * @param {number} orderCounter
     * @returns {number} updated orderCounter
     */
    _injectAccordionHeaders(invContainer, tabs, depth, tileMap, orderCounter) {
        for (const tab of tabs) {
            orderCounter = this._injectSectionHeader(invContainer, tab, depth, tileMap, orderCounter);
        }
        return orderCounter;
    }

    /**
     * Inject a single section header + show its tiles via CSS order
     * @param {HTMLElement} invContainer
     * @param {Object} tab
     * @param {number} depth
     * @param {Map} tileMap
     * @param {number} orderCounter
     * @returns {number} updated orderCounter
     */
    _injectSectionHeader(invContainer, tab, depth, tileMap, orderCounter) {
        // Create and inject the header element
        const header = document.createElement('div');
        header.className = 'toolasha-ct-section-header';
        header.dataset.tabId = tab.id;
        header.style.setProperty('--depth', depth);
        header.style.order = orderCounter++;
        if (tab.color) header.style.background = `${tab.color}30`;

        // Drag for reordering
        header.draggable = true;
        header.addEventListener('dragstart', (e) => {
            this._dragInProgress = true;
            e.dataTransfer.setData('text/plain', tab.id);
            e.dataTransfer.effectAllowed = 'move';
            header.style.opacity = '0.4';
        });
        header.addEventListener('dragend', () => {
            header.style.opacity = '';
            // Use a microtask delay so any click that fires immediately after dragend
            // (before the event queue clears) is still suppressed by the flag.
            setTimeout(() => {
                this._dragInProgress = false;
            }, 0);
        });
        header.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            header.classList.add('toolasha-ct-section--drag-over');
        });
        header.addEventListener('dragleave', () => {
            header.classList.remove('toolasha-ct-section--drag-over');
        });
        header.addEventListener('drop', (e) => {
            e.preventDefault();
            header.classList.remove('toolasha-ct-section--drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== tab.id) this._onReorderTab(draggedId, tab.id);
        });

        const chevron = document.createElement('span');
        chevron.className = 'toolasha-ct-chevron';
        chevron.textContent = tab.open ? '▼' : '▶';
        header.appendChild(chevron);

        const name = document.createElement('span');
        name.className = 'toolasha-ct-section-name';
        name.textContent = tab.name;
        header.appendChild(name);

        if (tab.items.length > 0) {
            const countBadge = document.createElement('span');
            countBadge.className = 'toolasha-ct-section-count';
            countBadge.textContent = `(${tab.items.length})`;
            header.appendChild(countBadge);
        }

        const actions = document.createElement('span');
        actions.className = 'toolasha-ct-section-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'toolasha-ct-node-btn';
        editBtn.textContent = '✏';
        editBtn.title = 'Edit tab';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openEditor(tab.id);
        });
        actions.appendChild(editBtn);

        const addSubBtn = document.createElement('button');
        addSubBtn.className = 'toolasha-ct-node-btn';
        addSubBtn.textContent = '+';
        addSubBtn.title = 'Add subtab';
        addSubBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onAddTab(tab.id);
        });
        actions.appendChild(addSubBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'toolasha-ct-node-btn';
        delBtn.textContent = '×';
        delBtn.title = 'Delete tab';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onDeleteTab(tab.id);
        });
        actions.appendChild(delBtn);

        header.appendChild(actions);
        header.addEventListener('click', () => {
            if (this._dragInProgress) return;
            this._onToggleTabOpen(tab.id, !tab.open);
        });

        invContainer.appendChild(header);
        this._injectedEls.push(header);

        if (tab.open) {
            // Collect all tiles for this tab's items
            const sectionTiles = [];
            for (const hrid of tab.items) {
                for (const tile of this._claimTilesForHrid(hrid, tileMap)) sectionTiles.push(tile);
            }

            // Sort tiles by value if a sort mode is active, then assign orders
            orderCounter = this._assignTileOrders(sectionTiles, orderCounter);

            // Recurse into children
            if (tab.children.length > 0) {
                orderCounter = this._injectAccordionHeaders(
                    invContainer,
                    tab.children,
                    depth + 1,
                    tileMap,
                    orderCounter
                );
            }
        } else {
            // Collapsed — leave this tab's own items in tileMap so that any
            // sibling/parent open tab sharing those items can still display them.
            // Unorganized bucket already filters assigned items via getAssignedItemSet,
            // so we don't need to delete them here to keep them out of unorganized.
            // Children are still hidden (parent is closed), so remove them.
            this._removeTilesFromMapForChildren(tab.children, tileMap);
        }

        return orderCounter;
    }

    /**
     * Remove tiles from the tileMap for all descendant tabs (used when a parent is collapsed)
     * @param {Array} tabs
     * @param {Map} tileMap
     */
    _removeTilesFromMapForChildren(tabs, tileMap) {
        for (const tab of tabs) {
            for (const hrid of tab.items) this._claimTilesForHrid(hrid, tileMap);
            if (tab.children.length > 0) this._removeTilesFromMapForChildren(tab.children, tileMap);
        }
    }

    /**
     * Mark tiles as visible and assign sequential CSS order values,
     * sorting by ask/bid value if inventory sort is active.
     * @param {HTMLElement[]} tiles
     * @param {number} startOrder
     * @returns {number} next available order counter
     */
    _assignTileOrders(tiles, startOrder) {
        if (tiles.length === 0) return startOrder;

        const mode = inventorySort.currentMode;
        if (mode && mode !== 'none') {
            const valueKey = mode + 'Value';
            tiles.sort((a, b) => (parseFloat(b.dataset[valueKey]) || 0) - (parseFloat(a.dataset[valueKey]) || 0));
        }

        for (const tile of tiles) {
            tile.classList.add('toolasha-ct-visible');
            tile.style.order = startOrder++;
        }
        return startOrder;
    }

    // -----------------------------------------------------------------------
    // Unorganized bucket
    // -----------------------------------------------------------------------

    /**
     * Inject the unorganized bucket header and show unassigned tiles
     * @param {HTMLElement} invContainer
     * @param {Map} tileMap - remaining tiles not placed in any tab
     * @param {number} orderCounter
     * @returns {number} updated orderCounter
     */
    _injectUnorganized(invContainer, tileMap, orderCounter) {
        const assignedSet = getAssignedItemSet(this._config);
        const remainingEntries = [];
        for (const [hrid, tiles] of tileMap) {
            // An enhanced key (e.g. /items/foo+3) is also covered if the base hrid is assigned
            const baseHrid = hrid.replace(/\+\d+$/, '');
            if (!assignedSet.has(hrid) && !assignedSet.has(baseHrid)) {
                remainingEntries.push({ hrid, tiles });
            }
        }
        if (remainingEntries.length === 0) return orderCounter;

        const totalTiles = remainingEntries.reduce((sum, e) => sum + e.tiles.length, 0);

        const headerEl = document.createElement('div');
        headerEl.className = 'toolasha-ct-unorg-header';
        headerEl.innerHTML = `<span>${this._unorgOpen ? '▼' : '▶'}</span> <span>Unorganized (${totalTiles})</span>`;
        headerEl.style.order = orderCounter++;
        headerEl.addEventListener('click', () => {
            this._unorgOpen = !this._unorgOpen;
            this._applyLayout();
        });
        invContainer.appendChild(headerEl);
        this._injectedEls.push(headerEl);

        if (this._unorgOpen) {
            const unorgTiles = remainingEntries.flatMap(({ tiles }) => tiles);
            orderCounter = this._assignTileOrders(unorgTiles, orderCounter);
        }

        return orderCounter;
    }

    // -----------------------------------------------------------------------
    // Tab editor modal
    // -----------------------------------------------------------------------

    _openEditor(tabId) {
        this._editorTabId = tabId;
        this._deleteConfirmId = null;
        this._expandedSearchHrids = new Set();
        const result = findTab(this._config, tabId);
        if (!result) return;
        const tab = result.tab;

        const overlay = document.createElement('div');
        overlay.className = 'toolasha-ct-modal-overlay';
        let mousedownOnOverlay = false;
        overlay.addEventListener('mousedown', (e) => {
            mousedownOnOverlay = e.target === overlay;
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && mousedownOnOverlay) {
                overlay.remove();
                this._removeInjectedEls();
                this._applyLayout();
            }
        });

        const modal = document.createElement('div');
        modal.className = 'toolasha-ct-modal';

        modal.innerHTML = `
            <h3>Edit Tab</h3>
            <label>Name</label>
            <input type="text" class="toolasha-ct-editor-name" value="${this._escHtml(tab.name)}">

            <label>Color</label>
            <div class="toolasha-ct-swatches"></div>

            <label>Add Category</label>
            <div class="toolasha-ct-categories"></div>

            <label>Items</label>
            <div class="toolasha-ct-search-row">
                <input type="search" class="toolasha-ct-editor-search" placeholder="Search items to add...">
                <select class="toolasha-ct-cat-filter">
                    <option value="">All</option>
                </select>
            </div>
            <div class="toolasha-ct-search-results"></div>
            <div class="toolasha-ct-assigned-list"></div>

            <div class="toolasha-ct-modal-footer">
                <button class="toolasha-ct-delete-btn">Delete Tab</button>
                <button class="toolasha-ct-clear-btn">Clear All</button>
                <button class="toolasha-ct-close-btn">Close</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const nameInput = modal.querySelector('.toolasha-ct-editor-name');
        nameInput.focus();
        nameInput.addEventListener('change', () => {
            this._config = renameTab(this._config, tabId, nameInput.value.trim() || 'Untitled');
            this._save();
        });

        const swatchContainer = modal.querySelector('.toolasha-ct-swatches');
        for (const color of [null, ...COLOR_PRESETS]) {
            const sw = document.createElement('span');
            sw.className = 'toolasha-ct-swatch' + (tab.color === color ? ' toolasha-ct-swatch--active' : '');
            sw.style.background = color || '#555';
            if (!color) sw.textContent = '×';
            sw.style.textAlign = 'center';
            sw.style.lineHeight = '18px';
            sw.style.fontSize = '12px';
            sw.addEventListener('click', () => {
                this._config = setTabColor(this._config, tabId, color);
                this._save();
                this._applyLayout();
                swatchContainer
                    .querySelectorAll('.toolasha-ct-swatch')
                    .forEach((s) => s.classList.remove('toolasha-ct-swatch--active'));
                sw.classList.add('toolasha-ct-swatch--active');
            });
            swatchContainer.appendChild(sw);
        }

        this._renderCategoryButtons(modal.querySelector('.toolasha-ct-categories'), tabId);
        this._populateCategoryFilter(modal.querySelector('.toolasha-ct-cat-filter'));

        const searchInput = modal.querySelector('.toolasha-ct-editor-search');
        const catFilter = modal.querySelector('.toolasha-ct-cat-filter');
        const resultsDiv = modal.querySelector('.toolasha-ct-search-results');
        let searchTimeout = null;
        const doSearch = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this._renderSearchResults(resultsDiv, searchInput.value.trim(), tabId, catFilter.value);
            }, 150);
        };
        searchInput.addEventListener('input', doSearch);
        catFilter.addEventListener('change', doSearch);

        this._renderAssignedItems(modal.querySelector('.toolasha-ct-assigned-list'), tabId);

        const deleteBtn = modal.querySelector('.toolasha-ct-delete-btn');
        deleteBtn.addEventListener('click', () => {
            if (this._deleteConfirmId === tabId) {
                this._config = removeTab(this._config, tabId);
                this._save();
                overlay.remove();
                this._removeInjectedEls();
                this._applyLayout();
            } else {
                this._deleteConfirmId = tabId;
                deleteBtn.textContent = 'Confirm Delete?';
                deleteBtn.style.background = '#a03030';
            }
        });

        let clearConfirm = false;
        const clearBtn = modal.querySelector('.toolasha-ct-clear-btn');
        clearBtn.addEventListener('click', () => {
            if (clearConfirm) {
                const currentTab = findTab(this._config, tabId)?.tab;
                if (currentTab) {
                    for (const hrid of [...currentTab.items]) {
                        this._config = removeItem(this._config, tabId, hrid);
                    }
                    this._save();
                    this._renderCategoryButtons(modal.querySelector('.toolasha-ct-categories'), tabId);
                    this._renderAssignedItems(modal.querySelector('.toolasha-ct-assigned-list'), tabId);
                }
                clearBtn.textContent = 'Clear All';
                clearBtn.style.background = '';
                clearConfirm = false;
            } else {
                clearConfirm = true;
                clearBtn.textContent = 'Confirm Clear?';
                clearBtn.style.background = '#6a3a00';
            }
        });

        modal.querySelector('.toolasha-ct-close-btn').addEventListener('click', () => {
            overlay.remove();
            this._removeInjectedEls();
            this._applyLayout();
        });
    }

    _renderSearchResults(container, query, tabId, categoryFilter) {
        container.innerHTML = '';
        if ((!query || query.length < 2) && !categoryFilter) return;

        const initData = dataManager.getInitClientData();
        if (!initData?.itemDetailMap) return;

        const lowerQuery = query ? query.toLowerCase() : '';
        const currentTab = findTab(this._config, tabId)?.tab;
        const currentItems = new Set(currentTab?.items || []);
        const addAllItems = config.getSettingValue('inventoryTabs_categoryAddAll');
        const ownedHrids = addAllItems ? null : this._getOwnedItemHrids();

        // Build map: baseHrid → Set<enhancementLevel> from current inventory
        const levelMap = new Map();
        for (const item of dataManager.getInventory() || []) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                if (!levelMap.has(item.itemHrid)) levelMap.set(item.itemHrid, new Set());
                levelMap.get(item.itemHrid).add(item.enhancementLevel || 0);
            }
        }

        let count = 0;

        for (const [hrid, details] of Object.entries(initData.itemDetailMap)) {
            if (count >= 30) break;
            if (!details.name) continue;
            if (currentItems.has(hrid)) continue;
            if (categoryFilter && details.categoryHrid !== categoryFilter) continue;
            if (lowerQuery && !details.name.toLowerCase().includes(lowerQuery)) continue;
            if (ownedHrids && !ownedHrids.has(hrid)) continue;

            const iconId = hrid.replace('/items/', '');
            const spriteUrl = getSpriteBaseUrl();
            const iconHref = spriteUrl ? `${spriteUrl}#${iconId}` : `#${iconId}`;

            const ownedLevels = levelMap.get(hrid);
            const hasEnhanced = ownedLevels && [...ownedLevels].some((l) => l > 0);
            const isExpanded = this._expandedSearchHrids?.has(hrid);

            if (hasEnhanced) {
                if (isExpanded) {
                    // Collapse header row
                    const headerRow = document.createElement('div');
                    headerRow.className = 'toolasha-ct-search-result toolasha-ct-search-group-header';
                    headerRow.innerHTML = `<svg viewBox="0 0 32 32"><use href="${iconHref}"></use></svg><span>${this._escHtml(details.name)}</span><span class="toolasha-ct-expand-btn">▲</span>`;
                    headerRow.addEventListener('click', () => {
                        this._expandedSearchHrids.delete(hrid);
                        this._renderSearchResults(container, query, tabId, categoryFilter);
                    });
                    container.appendChild(headerRow);

                    // One row per owned enhancement level
                    for (const level of [...ownedLevels].sort((a, b) => a - b)) {
                        const levelHrid = level === 0 ? hrid : `${hrid}+${level}`;
                        if (currentItems.has(levelHrid)) continue;

                        const levelRow = document.createElement('div');
                        levelRow.className = 'toolasha-ct-search-result toolasha-ct-search-level-row';
                        const displayName = level === 0 ? details.name : `${details.name} +${level}`;
                        levelRow.innerHTML = `<svg viewBox="0 0 32 32"><use href="${iconHref}"></use></svg><span>${this._escHtml(displayName)}</span>`;
                        levelRow.addEventListener('click', () => {
                            this._config = addItem(this._config, tabId, levelHrid);
                            this._save();
                            this._renderSearchResults(container, query, tabId, categoryFilter);
                            this._renderAssignedItems(
                                container.parentElement.querySelector('.toolasha-ct-assigned-list'),
                                tabId
                            );
                        });
                        container.appendChild(levelRow);
                    }
                } else {
                    // Collapsed group row — shows owned levels as badge, expand on click
                    const sortedLevels = [...ownedLevels].sort((a, b) => a - b);
                    const levelBadges = sortedLevels.map((l) => `+${l}`).join(' ');

                    const row = document.createElement('div');
                    row.className = 'toolasha-ct-search-result toolasha-ct-search-group-header';
                    row.innerHTML = `<svg viewBox="0 0 32 32"><use href="${iconHref}"></use></svg><span>${this._escHtml(details.name)}</span><span class="toolasha-ct-level-badges">${this._escHtml(levelBadges)}</span><span class="toolasha-ct-expand-btn">▶</span>`;
                    row.addEventListener('click', () => {
                        if (!this._expandedSearchHrids) this._expandedSearchHrids = new Set();
                        this._expandedSearchHrids.add(hrid);
                        this._renderSearchResults(container, query, tabId, categoryFilter);
                    });
                    container.appendChild(row);
                }
            } else {
                // Flat row — no enhanced variants in inventory
                const row = document.createElement('div');
                row.className = 'toolasha-ct-search-result';
                row.innerHTML = `<svg viewBox="0 0 32 32"><use href="${iconHref}"></use></svg><span>${this._escHtml(details.name)}</span>`;
                row.addEventListener('click', () => {
                    this._config = addItem(this._config, tabId, hrid);
                    this._save();
                    row.remove();
                    this._renderAssignedItems(
                        container.parentElement.querySelector('.toolasha-ct-assigned-list'),
                        tabId
                    );
                });
                container.appendChild(row);
            }

            count++;
        }

        if (count === 0) {
            container.innerHTML = '<div style="color:#666;padding:6px;font-size:12px;">No matching items found</div>';
        }
    }

    _renderAssignedItems(container, tabId) {
        container.innerHTML = '';
        const tab = findTab(this._config, tabId)?.tab;
        if (!tab || tab.items.length === 0) {
            container.innerHTML = '<div style="color:#555;font-size:12px;padding:4px;">No items assigned</div>';
            return;
        }

        let dragFromIndex = null;

        tab.items.forEach((hrid, index) => {
            const enhanceMatch = hrid.match(/\+(\d+)$/);
            const baseHrid = enhanceMatch ? hrid.slice(0, hrid.length - enhanceMatch[0].length) : hrid;
            const level = enhanceMatch ? parseInt(enhanceMatch[1], 10) : 0;
            const details = dataManager.getItemDetails(baseHrid);
            const baseName = details?.name || baseHrid;
            const name = level > 0 ? `${baseName} +${level}` : baseName;
            const iconId = baseHrid.replace('/items/', '');
            const spriteUrl = getSpriteBaseUrl();
            const iconHref = spriteUrl ? `${spriteUrl}#${iconId}` : `#${iconId}`;

            const row = document.createElement('div');
            row.className = 'toolasha-ct-assigned-item';
            row.draggable = true;

            const handle = document.createElement('span');
            handle.className = 'toolasha-ct-drag-handle';
            handle.textContent = '⠿';
            row.appendChild(handle);

            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 32 32');
            icon.innerHTML = `<use href="${iconHref}"></use>`;
            row.appendChild(icon);

            const label = document.createElement('span');
            label.textContent = name;
            row.appendChild(label);

            row.addEventListener('dragstart', (e) => {
                dragFromIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                row.style.opacity = '0.4';
            });
            row.addEventListener('dragend', () => {
                row.style.opacity = '';
                container
                    .querySelectorAll('.toolasha-ct-drag-over')
                    .forEach((el) => el.classList.remove('toolasha-ct-drag-over'));
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                container
                    .querySelectorAll('.toolasha-ct-drag-over')
                    .forEach((el) => el.classList.remove('toolasha-ct-drag-over'));
                row.classList.add('toolasha-ct-drag-over');
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('toolasha-ct-drag-over');
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('toolasha-ct-drag-over');
                if (dragFromIndex !== null && dragFromIndex !== index) {
                    this._config = reorderItem(this._config, tabId, dragFromIndex, index);
                    this._save();
                    this._renderAssignedItems(container, tabId);
                }
                dragFromIndex = null;
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'toolasha-ct-node-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', () => {
                this._config = removeItem(this._config, tabId, hrid);
                this._save();
                this._renderAssignedItems(container, tabId);
            });
            row.appendChild(removeBtn);
            container.appendChild(row);
        });
    }

    // -----------------------------------------------------------------------
    // Category helpers
    // -----------------------------------------------------------------------

    _getCategories() {
        const initData = dataManager.getInitClientData();
        if (!initData?.itemCategoryDetailMap) return [];
        const categories = [];
        for (const [hrid, detail] of Object.entries(initData.itemCategoryDetailMap)) {
            if (detail?.name) categories.push({ hrid, name: detail.name });
        }
        return categories.sort((a, b) => a.name.localeCompare(b.name));
    }

    _getItemsInCategory(categoryHrid) {
        const initData = dataManager.getInitClientData();
        if (!initData?.itemDetailMap) return [];
        const addAllItems = config.getSettingValue('inventoryTabs_categoryAddAll');
        const ownedHrids = addAllItems ? null : this._getOwnedItemHrids();
        const items = [];
        for (const [hrid, details] of Object.entries(initData.itemDetailMap)) {
            if (details.categoryHrid === categoryHrid) {
                if (!ownedHrids || ownedHrids.has(hrid)) items.push(hrid);
            }
        }
        return items;
    }

    _getOwnedItemHrids() {
        const inventory = dataManager.getInventory() || [];
        const set = new Set();
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                set.add(item.itemHrid);
                if (item.enhancementLevel > 0) {
                    set.add(`${item.itemHrid}+${item.enhancementLevel}`);
                }
            }
        }
        return set;
    }

    _renderCategoryButtons(container, tabId) {
        container.innerHTML = '';
        const categories = this._getCategories();
        const currentTab = findTab(this._config, tabId)?.tab;
        const currentItems = new Set(currentTab?.items || []);

        for (const cat of categories) {
            const catItems = this._getItemsInCategory(cat.hrid);
            if (catItems.length === 0) continue;

            const allAlreadyAdded = catItems.every((hrid) => currentItems.has(hrid));
            const btn = document.createElement('button');
            btn.className = 'toolasha-ct-cat-btn' + (allAlreadyAdded ? ' toolasha-ct-cat-btn--added' : '');
            btn.textContent = cat.name;
            btn.title = allAlreadyAdded
                ? `Click to remove ${catItems.length} items from ${cat.name}`
                : `Add ${catItems.length} items from ${cat.name}`;

            if (allAlreadyAdded) {
                btn.addEventListener('click', () => {
                    for (const hrid of catItems) {
                        if (currentItems.has(hrid)) {
                            this._config = removeItem(this._config, tabId, hrid);
                            currentItems.delete(hrid);
                        }
                    }
                    this._save();
                    this._renderCategoryButtons(container, tabId);
                    const modal = container.closest('.toolasha-ct-modal');
                    if (modal) this._renderAssignedItems(modal.querySelector('.toolasha-ct-assigned-list'), tabId);
                });
            } else {
                btn.addEventListener('click', () => {
                    for (const hrid of catItems) {
                        if (!currentItems.has(hrid)) {
                            this._config = addItem(this._config, tabId, hrid);
                            currentItems.add(hrid);
                        }
                    }
                    this._save();
                    this._renderCategoryButtons(container, tabId);
                    const modal = container.closest('.toolasha-ct-modal');
                    if (modal) this._renderAssignedItems(modal.querySelector('.toolasha-ct-assigned-list'), tabId);
                });
            }
            container.appendChild(btn);
        }
    }

    _populateCategoryFilter(select) {
        for (const cat of this._getCategories()) {
            const opt = document.createElement('option');
            opt.value = cat.hrid;
            opt.textContent = cat.name;
            select.appendChild(opt);
        }
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    _onAddTab(parentId) {
        const result = addTab(this._config, parentId, 'New Tab');
        this._config = result.config;
        this._config = setTabOpen(this._config, result.tabId, true);
        this._removeInjectedEls();
        this._applyLayout();
        this._openEditor(result.tabId);
        this._save();
    }

    _onDeleteTab(tabId) {
        this._config = removeTab(this._config, tabId);
        this._save();
        this._removeInjectedEls();
        this._applyLayout();
    }

    _onToggleTabOpen(tabId, open) {
        this._config = setTabOpen(this._config, tabId, open);
        this._save();
        this._removeInjectedEls();
        this._applyLayout();
    }

    _onReorderTab(draggedId, targetId) {
        const dragResult = findTab(this._config, draggedId);
        const targetResult = findTab(this._config, targetId);
        if (!dragResult || !targetResult) return;

        const dragParent = dragResult.parent;
        const targetParent = targetResult.parent;
        if (dragParent !== targetParent) return;

        const arr = dragParent ? dragParent.children : this._config.tabs;
        const targetIndex = arr.findIndex((t) => t.id === targetId);
        this._config = moveTab(this._config, draggedId, targetIndex);
        this._save();
        this._removeInjectedEls();
        this._applyLayout();
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    async _save() {
        const charId = dataManager.getCurrentCharacterId();
        await saveConfig(charId, this._config);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
