/**
 * Collection Navigation
 * Adds "View Action" and "Item Dictionary" buttons when clicking collection items.
 * Works for both collected items (injects into game popover) and uncollected items
 * (shows a custom popover since the game provides no interaction for those).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { navigateToItem } from '../../utils/item-navigation.js';

/**
 * Get game object via React fiber tree traversal
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function find(fiber) {
        if (!fiber) return null;
        if (fiber.stateNode?.handleGoToMarketplace) return fiber.stateNode;
        return find(fiber.child) || find(fiber.sibling);
    }

    return find(rootFiber);
}

class CollectionNavigation {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.activePopover = null;
        this.outsideClickHandler = null;
        this.escapeKeyHandler = null;
        this.itemNameToHridCache = null;
        this.itemNameToHridCacheSource = null;
        this.panelObserver = null;
    }

    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.isFeatureEnabled('collectionNavigation')) {
            return;
        }

        this.isInitialized = true;

        // Watch for uncollected (gray) collection tiles added to the DOM
        const unregisterTiles = domObserver.onClass('CollectionNavigation', 'Collection_collection', (tile) => {
            this.handleCollectionTile(tile);
        });
        this.unregisterHandlers.push(unregisterTiles);

        // Watch for the collection panel appearing so we can attach a rescan observer
        // (covers filter checkbox toggles that show/hide existing tiles without re-adding them)
        const unregisterPanel = domObserver.onClass('CollectionNavigation', 'Collection_collections', (panel) => {
            this.attachPanelObserver(panel);
            this.rescanGrayTiles(panel);
        });
        this.unregisterHandlers.push(unregisterPanel);

        // Also attach to any panel already in the DOM
        const existingPanel = document.querySelector('[class*="Collection_collections"]');
        if (existingPanel) {
            this.attachPanelObserver(existingPanel);
        }

        // Watch for collected item popovers (MuiTooltip containing Collection_actionMenu)
        const unregisterTooltips = domObserver.onClass('CollectionNavigation', 'MuiTooltip-popper', (tooltipEl) => {
            this.handleTooltip(tooltipEl);
        });
        this.unregisterHandlers.push(unregisterTooltips);

        // Process any tiles already in the DOM
        document.querySelectorAll('[class*="Collection_tierGray"]').forEach((tile) => {
            this.handleCollectionTile(tile);
        });
    }

    disable() {
        this.dismissPopover();
        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];
        if (this.panelObserver) {
            this.panelObserver.disconnect();
            this.panelObserver = null;
        }
        this.isInitialized = false;
    }

    /**
     * Attach a MutationObserver to the collection panel to catch filter toggles
     * that show/hide existing tiles without re-adding them to the DOM.
     * @param {Element} panel
     */
    attachPanelObserver(panel) {
        if (this.panelObserver) {
            return; // Already attached
        }
        this.panelObserver = new MutationObserver(() => {
            this.rescanGrayTiles(panel);
        });
        this.panelObserver.observe(panel, { childList: true, subtree: true });
    }

    /**
     * Scan all currently visible gray tiles in the panel and attach listeners to any not yet marked.
     * @param {Element} panel
     */
    rescanGrayTiles(panel) {
        const tiles = panel.querySelectorAll('[class*="Collection_tierGray"]');
        tiles.forEach((tile) => this.handleCollectionTile(tile));
    }

    /**
     * Attach click listener to uncollected (gray) tiles
     * @param {Element} tile
     */
    handleCollectionTile(tile) {
        // If we got a container instead of the tile itself, find the tile inside
        let targetTile = tile;
        if (!tile.className.includes('Collection_tierGray')) {
            targetTile = tile.querySelector('[class*="Collection_tierGray"]');
            if (!targetTile) {
                return;
            }
        }

        // Avoid duplicate listeners
        if (targetTile.dataset.mwiCollectionNav) {
            return;
        }
        targetTile.dataset.mwiCollectionNav = 'true';

        targetTile.style.cursor = 'pointer';

        targetTile.addEventListener('click', (event) => {
            event.stopPropagation();

            const itemHrid = this.extractHridFromTile(targetTile);
            if (!itemHrid) {
                return;
            }

            this.showPopover(targetTile, itemHrid);
        });
    }

    /**
     * Show a custom popover for an uncollected item
     * @param {Element} tile - The collection tile element
     * @param {string} itemHrid - The item HRID
     */
    showPopover(tile, itemHrid) {
        this.dismissPopover();

        const itemDetails = dataManager.getItemDetails(itemHrid);
        const itemName = itemDetails?.name || itemHrid.split('/').pop().replace(/_/g, ' ');

        const rect = tile.getBoundingClientRect();

        const popover = document.createElement('div');
        popover.className = 'mwi-collection-popover';
        popover.style.cssText = `
            position: fixed;
            z-index: 9999;
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px;
            padding: 8px;
            min-width: 160px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        `;

        // Item name header
        const nameDiv = document.createElement('div');
        nameDiv.textContent = itemName;
        nameDiv.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            color: #fff;
            margin-bottom: 8px;
            text-align: center;
        `;
        popover.appendChild(nameDiv);

        // View Action button
        const viewActionBtn = this.createNavButton('View Action', () => {
            this.dismissPopover();
            navigateToItem(itemHrid);
        });
        popover.appendChild(viewActionBtn);

        // Item Dictionary button
        const dictBtn = this.createNavButton('Item Dictionary', () => {
            this.dismissPopover();
            const game = getGameObject();
            if (game?.handleOpenItemDictionary) {
                game.handleOpenItemDictionary(itemHrid);
            }
        });
        popover.appendChild(dictBtn);

        document.body.appendChild(popover);
        this.activePopover = popover;

        // Position below the tile, aligned to its left edge
        const popoverWidth = 160;
        let left = rect.left + window.scrollX;
        const top = rect.bottom + window.scrollY + 4;

        // Keep within viewport horizontally
        if (left + popoverWidth > window.innerWidth) {
            left = window.innerWidth - popoverWidth - 8;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;

        // Dismiss on outside click
        this.outsideClickHandler = (e) => {
            if (!popover.contains(e.target) && e.target !== tile) {
                this.dismissPopover();
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', this.outsideClickHandler);
        }, 0);

        // Dismiss on Escape
        this.escapeKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this.dismissPopover();
            }
        };
        document.addEventListener('keydown', this.escapeKeyHandler);
    }

    /**
     * Remove the active custom popover and clean up event listeners
     */
    dismissPopover() {
        if (this.activePopover) {
            this.activePopover.remove();
            this.activePopover = null;
        }

        if (this.outsideClickHandler) {
            document.removeEventListener('mousedown', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }

        if (this.escapeKeyHandler) {
            document.removeEventListener('keydown', this.escapeKeyHandler);
            this.escapeKeyHandler = null;
        }
    }

    /**
     * Inject navigation buttons into the game's collected-item popover
     * @param {Element} tooltipEl - MuiTooltip-popper element
     */
    handleTooltip(tooltipEl) {
        if (tooltipEl.dataset.mwiCollectionEnhanced) {
            return;
        }

        const actionMenu = tooltipEl.querySelector('[class*="Collection_actionMenu"]');
        if (!actionMenu) {
            return;
        }

        tooltipEl.dataset.mwiCollectionEnhanced = 'true';

        const nameEl = tooltipEl.querySelector('[class*="Collection_name"]');
        if (!nameEl) {
            return;
        }

        const itemHrid = this.extractItemHridFromName(nameEl.textContent.trim());
        if (!itemHrid) {
            return;
        }

        const viewActionBtn = this.createNavButton('View Action', () => {
            navigateToItem(itemHrid);
        });
        actionMenu.appendChild(viewActionBtn);

        const dictBtn = this.createNavButton('Item Dictionary', () => {
            const game = getGameObject();
            if (game?.handleOpenItemDictionary) {
                game.handleOpenItemDictionary(itemHrid);
            }
        });
        actionMenu.appendChild(dictBtn);
    }

    /**
     * Extract item HRID from a collection tile's SVG use href
     * @param {Element} tile
     * @returns {string|null}
     */
    extractHridFromTile(tile) {
        const useEl = tile.querySelector('use');
        if (!useEl) {
            return null;
        }

        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
        if (!href) {
            return null;
        }

        const name = href.split('#')[1];
        if (!name) {
            return null;
        }

        return `/items/${name}`;
    }

    /**
     * Reverse-lookup item HRID from display name using dataManager
     * @param {string} itemName
     * @returns {string|null}
     */
    extractItemHridFromName(itemName) {
        const initData = dataManager.getInitClientData();
        if (!initData?.itemDetailMap) {
            return null;
        }

        if (this.itemNameToHridCache && this.itemNameToHridCacheSource === initData.itemDetailMap) {
            return this.itemNameToHridCache.get(itemName) || null;
        }

        const map = new Map();
        for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
            map.set(item.name, hrid);
        }

        if (map.size > 0) {
            this.itemNameToHridCache = map;
            this.itemNameToHridCacheSource = initData.itemDetailMap;
        }

        return map.get(itemName) || null;
    }

    /**
     * Create a button styled to match the game's collection popover buttons
     * @param {string} label
     * @param {Function} onClick
     * @returns {HTMLButtonElement}
     */
    createNavButton(label, onClick) {
        const btn = document.createElement('button');
        btn.className = 'Button_button__1Fe9z Button_fullWidth__17pVU';
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }
}

const collectionNavigation = new CollectionNavigation();

export default {
    initialize: () => collectionNavigation.initialize(),
    disable: () => collectionNavigation.disable(),
};
