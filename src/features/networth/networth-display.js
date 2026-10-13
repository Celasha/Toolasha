/**
 * Networth Display Components
 * Handles UI rendering for networth in two locations:
 * 1. Header (top right) - Gold: [amount]
 * 2. Inventory Panel - Detailed breakdown with collapsible sections
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { networthFormatter, formatKMB } from '../../utils/formatters.js';
import { buildOutlierPriceWarningIcon } from '../../utils/warning-icon.js';
import networthHistoryChart from './networth-history-chart.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { DUNGEON_CHEST_CHEST_KEYS } from '../combat-stats/combat-stats-calculator.js';
import { getKeyPriceInfo } from '../../utils/dungeon-key-cost.js';
import networthExclusionPopup from './networth-exclusion-popup.js';
import { removeExclusion } from './networth-exclusions.js';
import { getItemName } from '../../utils/game-i18n.js';
import { addStyles } from '../../utils/dom.js';

// Chart series blue — matches networth-history-chart category colors.
const FIXED_ASSET_COLOR = '#3b82f6';
const PANEL_STYLES_ID = 'mwi-networth-panel-styles';

function buildPanelCss() {
    return `
.mwi-nw-root { text-align: left; color: #ccc; font-size: 0.875rem; }
.mwi-nw-iconrow { display: flex; align-items: center; gap: 6px; }
.mwi-nw-headtoggle { cursor: pointer; font-weight: bold; flex: 1; display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.mwi-nw-headtoggle:hover .mwi-nw-chev { background: rgba(255,255,255,0.2); color: #fff; }
.mwi-nw-headname { display: inline-flex; align-items: center; gap: 7px; color: #fff; }
.mwi-nw-coin { width: 20px; height: 20px; border-radius: 6px; background: rgba(251,191,36,0.16); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; flex: none; }
.mwi-nw-big { color: #fbbf24; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }
.mwi-nw-chev { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 4px; background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.75); font-size: 10px; line-height: 1; transition: transform 0.15s, background 0.15s, color 0.15s; flex: none; }
#mwi-networth-chev { width: 16px; height: 16px; font-size: 11px; }
#mwi-networth-details > .mwi-nw-kids > details.mwi-nw-node > summary .mwi-nw-chev { width: 20px; height: 20px; border-radius: 5px; font-size: 13px; }
.mwi-nw-chev-open { transform: rotate(90deg); }
details.mwi-nw-node { display: block; min-width: 0; }
details.mwi-nw-node > summary { list-style: none; cursor: pointer; user-select: none; }
details.mwi-nw-node > summary::-webkit-details-marker { display: none; }
details.mwi-nw-node > summary .mwi-nw-chev { transform: rotate(0); }
details.mwi-nw-node[open] > summary .mwi-nw-chev { transform: rotate(90deg); }
.mwi-nw-sharebar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 10px 2px 3px; }
.mwi-nw-sharebar i { display: block; height: 100%; }
.mwi-nw-sharelegend { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.45); padding: 0 4px 2px; }
.mwi-nw-section { display: flex; align-items: center; justify-content: space-between; margin: 12px 2px 3px; padding: 3px 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.6); border-bottom: 1px solid rgba(255,255,255,0.14); }
.mwi-nw-section-value { font-size: 12px; color: rgba(255,255,255,0.85); font-weight: 600; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums; }
.mwi-nw-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 3px 6px; border-radius: 5px; font-size: 12px; min-width: 0; }
.mwi-nw-kids > details > summary:hover, .mwi-nw-kids > .mwi-nw-row:hover { background: rgba(255,255,255,0.07); }
.mwi-nw-kids > :nth-child(odd) > summary, .mwi-nw-kids > .mwi-nw-row:nth-child(odd) { background: rgba(255,255,255,0.03); }
/* Clickable affordance: group rows keep a tinted strip, chevron badge brightens on hover, open rows highlight. */
.mwi-nw-kids > details > summary:hover .mwi-nw-chev { background: rgba(255,255,255,0.2); color: #fff; }
.mwi-nw-kids > details.mwi-nw-node > summary { background: rgba(255,255,255,0.06); font-weight: 600; }
.mwi-nw-kids > details.mwi-nw-node > summary:hover { background: rgba(255,255,255,0.11); }
.mwi-nw-kids > details.mwi-nw-node[open] > summary { color: #fff; }
.mwi-nw-nm { color: inherit; overflow-wrap: anywhere; }
.mwi-nw-count { color: rgba(255,255,255,0.4); font-size: 10.5px; margin-left: 4px; }
.mwi-nw-val { color: #fbbf24; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mwi-nw-zero { color: rgba(255,255,255,0.3); font-weight: 400; }
.mwi-nw-indent { border-left: 1px solid rgba(255,255,255,0.08); margin: 1px 0 1px 14px; padding-left: 9px; }
.mwi-nw-lv1 { color: #ccc; }
.mwi-nw-lv2 { color: #aaa; font-size: 11.5px; }
.mwi-nw-lv3 { color: #999; font-size: 10.8px; }
.mwi-nw-empty { color: rgba(255,255,255,0.45); }
.mwi-nw-ev { padding: 4px 6px; margin: 1px 0; font-size: 10.3px; color: rgba(255,255,255,0.45); line-height: 1.7; border-radius: 5px; }
.mwi-nw-ev div { color: rgba(255,255,255,0.45); }
.mwi-nw-exclrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 6px; color: rgba(255,255,255,0.45); font-size: 11px; border-radius: 5px; }
.mwi-nw-exclrow:nth-child(odd) { background: rgba(255,255,255,0.03); }
.mwi-nw-exclname { text-decoration: line-through; overflow-wrap: anywhere; }
.mwi-nw-iconbtn { cursor: pointer; font-size: 13px; opacity: 0.6; padding: 2px 3px; border-radius: 3px; line-height: 1; flex: none; }
`;
}

function injectPanelStyles() {
    document.getElementById(PANEL_STYLES_ID)?.remove();
    addStyles(buildPanelCss(), PANEL_STYLES_ID);
}

/** Escape double quotes for data attributes (parity with existing excluded-row markup). */
function attrValue(value) {
    return String(value).replace(/"/g, '&quot;');
}

/** Muted count/Lv/type suffix span. */
function countSpan(text) {
    return text ? `<span class="mwi-nw-count">${text}</span>` : '';
}

/** Right-aligned gold value cell. */
function valueSpan(value, { zero = false } = {}) {
    return `<span class="mwi-nw-val${zero ? ' mwi-nw-zero' : ''}">${value}</span>`;
}

/** Leaf row: name left, value right. */
function leafRow(level, nameHtml, value, { zero = false } = {}) {
    return `<div class="mwi-nw-row mwi-nw-lv${level}"><span class="mwi-nw-nm">${nameHtml}</span>${valueSpan(value, { zero })}</div>`;
}

/** Collapsible node row backed by <details> so no click handlers are needed. */
function nodeDetails(level, id, nameHtml, value, childrenHtml) {
    return (
        `<details class="mwi-nw-node" id="${id}">` +
        `<summary class="mwi-nw-row mwi-nw-lv${level}"><span class="mwi-nw-nm"><span class="mwi-nw-chev">▸</span>${nameHtml}</span>${valueSpan(value)}</summary>` +
        `<div class="mwi-nw-kids mwi-nw-indent">${childrenHtml}</div></details>`
    );
}

/**
 * Compute current-vs-fixed asset share percentages for the overview bar.
 * @param {Object|null} networthData
 * @returns {{currentPct: number, fixedPct: number}|null} null when either side is zero/missing
 */
export function getSharePercent(networthData) {
    const total = networthData?.totalNetworth ?? 0;
    const current = networthData?.currentAssets?.total ?? 0;
    const fixed = networthData?.fixedAssets?.total ?? 0;
    if (total <= 0 || current <= 0 || fixed <= 0) {
        return null;
    }
    const currentPct = Math.round((current / total) * 100);
    return { currentPct, fixedPct: 100 - currentPct };
}

/** Overview bar: percentage-only split bar + legend (design option C). */
function renderShareBar(share) {
    if (!share) {
        return '';
    }
    return (
        `<div class="mwi-nw-sharebar">` +
        `<i style="width:${share.currentPct}%;background:${config.COLOR_ACCENT}"></i>` +
        `<i style="width:${share.fixedPct}%;background:${FIXED_ASSET_COLOR}"></i></div>` +
        `<div class="mwi-nw-sharelegend"><span>◀ ${t('networthDisplay.currentShareLabel', { pct: share.currentPct })}</span>` +
        `<span>${t('networthDisplay.fixedShareLabel', { pct: share.fixedPct })} ▶</span></div>`
    );
}

/**
 * Header Display Component
 * Shows "Gold: [amount]" next to total level
 */
class NetworthHeaderDisplay {
    constructor() {
        this.container = null;
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.networthFeature = null; // Reference to parent feature for recalculation
    }

    /**
     * Set reference to parent networth feature
     * @param {Object} feature - NetworthFeature instance
     */
    setNetworthFeature(feature) {
        this.networthFeature = feature;
    }

    /**
     * Get the current items sprite URL from the DOM
     * @returns {string|null} Items sprite URL or null if not found
     */
    getItemsSpriteUrl() {
        const itemIcon = document.querySelector('use[href*="items_sprite"]');
        if (!itemIcon) {
            return null;
        }
        const href = itemIcon.getAttribute('href');
        return href ? href.split('#')[0] : null;
    }

    /**
     * Clone SVG symbol from DOM into defs
     * @param {string} symbolId - Symbol ID to clone
     * @param {SVGDefsElement} defsElement - Defs element to append to
     * @returns {boolean} True if symbol was found and cloned
     */
    cloneSymbolToDefs(symbolId, defsElement) {
        // Check if already cloned
        if (defsElement.querySelector(`symbol[id="${symbolId}"]`)) {
            return true;
        }

        // Find the symbol in the game's loaded sprites
        const symbol = document.querySelector(`symbol[id="${symbolId}"]`);
        if (!symbol) {
            console.warn('[NetworthHeaderDisplay] Symbol not found:', symbolId);
            return false;
        }

        // Clone and add to our defs
        const clonedSymbol = symbol.cloneNode(true);
        defsElement.appendChild(clonedSymbol);
        return true;
    }

    /**
     * Initialize header display
     */
    initialize() {
        // 1. Check if element already exists (handles late initialization)
        const existingElem = document.querySelector('[class*="Header_totalLevel"]');
        if (existingElem) {
            this.renderHeader(existingElem);
        }

        // 2. Watch for future additions (handles SPA navigation, page reloads)
        const unregister = domObserver.onClass('NetworthHeader', 'Header_totalLevel', (elem) => {
            this.renderHeader(elem);
        });
        this.unregisterHandlers.push(unregister);

        this.isInitialized = true;
    }

    /**
     * Render header display
     * @param {Element} totalLevelElem - Total level element
     */
    renderHeader(totalLevelElem) {
        // Check if already rendered
        if (this.container && document.body.contains(this.container)) {
            return;
        }

        // Remove any existing container
        if (this.container) {
            this.container.remove();
        }

        // Create container
        this.container = document.createElement('div');
        this.container.className = 'mwi-networth-header';
        this.container.style.cssText = `
            font-size: 0.875rem;
            font-weight: 500;
            color: ${config.COLOR_ACCENT};
            text-wrap: nowrap;
        `;

        // Insert after total level
        totalLevelElem.insertAdjacentElement('afterend', this.container);

        // Initial render with loading state
        this.renderGoldDisplay(t('taskProfitDisplay.loadingEllipsis'));

        // Trigger recalculation immediately to update from "Loading..." to actual value
        if (this.networthFeature && typeof this.networthFeature.recalculate === 'function') {
            this.networthFeature.recalculate().catch((error) => {
                console.error('[NetworthHeaderDisplay] Immediate recalculation failed:', error);
            });
        }
    }

    /**
     * Render gold display with icon and value
     * @param {string} value - Formatted value text
     */
    renderGoldDisplay(value) {
        this.container.innerHTML = '';

        // Create wrapper for icon + text
        const wrapper = document.createElement('span');
        wrapper.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
        `;

        // Get current items sprite URL from DOM
        const itemsSpriteUrl = this.getItemsSpriteUrl();

        // Create icon tile (matches market order totals style)
        const tile = document.createElement('span');
        tile.style.cssText =
            'display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 8px; background: rgba(251, 191, 36, 0.16); font-size: 11px; flex: none;';

        // Create SVG icon using game's sprite (fallback to emoji)
        if (itemsSpriteUrl) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.style.cssText = `
                color: #fbbf24;
                fill: currentColor;
            `;

            // Create use element with external sprite reference
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `${itemsSpriteUrl}#coin`);
            svg.appendChild(use);

            tile.appendChild(svg);
        } else {
            tile.textContent = '💰';
        }

        wrapper.appendChild(tile);

        // Create label + value spans
        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'color: #888; font-weight: 500;';
        labelSpan.textContent = t('networthDisplay.goldLabel');

        const valueSpan = document.createElement('span');
        valueSpan.style.cssText = 'color: #fbbf24; font-weight: 600;';
        valueSpan.textContent = value;

        // Assemble
        wrapper.appendChild(labelSpan);
        wrapper.appendChild(valueSpan);
        this.container.appendChild(wrapper);
    }

    /**
     * Update header with networth data
     * @param {Object} networthData - Networth data from calculator
     */
    update(networthData) {
        if (!this.container || !document.body.contains(this.container)) {
            return;
        }

        const valueFormatted = networthFormatter(Math.round(networthData.coins));

        this.renderGoldDisplay(valueFormatted);
    }

    /**
     * Refresh colors on existing header element
     */
    refresh() {
        if (this.container && document.body.contains(this.container)) {
            this.container.style.color = config.COLOR_ACCENT;
        }
    }

    /**
     * Disable and cleanup
     */
    disable() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.isInitialized = false;
    }
}

/**
 * Inventory Panel Display Component
 * Shows detailed networth breakdown below inventory search bar
 */
class NetworthInventoryDisplay {
    constructor() {
        this.container = null;
        this.unregisterHandlers = [];
        this.currentData = null;
        this.isInitialized = false;
        this.networthFeature = null;
    }

    /**
     * Set reference to parent networth feature for recalculation.
     * @param {Object} feature - NetworthFeature instance
     */
    setNetworthFeature(feature) {
        this.networthFeature = feature;
    }

    /**
     * Check if an element is actually rendered (occupies layout space).
     * Elements inside display:none subtrees report zero size and no client rects.
     * @param {Element} el - Element to check
     * @returns {boolean} True if element is rendered
     */
    isRendered(el) {
        return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length > 0));
    }

    /**
     * Find the rendered Inventory items element. The game keeps a permanently
     * hidden Inventory subtree inside CharacterManagement which may appear first
     * in document order, so hidden instances must be skipped.
     * @returns {Element|null} Rendered inventory items element
     */
    findRenderedInventoryItems() {
        for (const el of document.querySelectorAll('[class*="Inventory_items"]')) {
            if (this.isRendered(el)) {
                return el;
            }
        }
        return null;
    }

    /**
     * Initialize inventory panel display
     */
    initialize() {
        injectPanelStyles();

        // 1. Check if element already exists (handles late initialization).
        // Must anchor to the rendered instance - the hidden CharacterManagement
        // Inventory clone also matches the selector.
        const existingElem = this.findRenderedInventoryItems();
        if (existingElem) {
            this.renderPanel(existingElem);
        }

        // 2. Watch for future additions (handles SPA navigation, inventory panel reloads)
        const unregister = domObserver.onClass('NetworthInv', 'Inventory_items', (elem) => {
            this.renderPanel(elem);
        });
        this.unregisterHandlers.push(unregister);

        this.isInitialized = true;
    }

    /**
     * Render inventory panel
     * @param {Element} inventoryElem - Inventory items element
     */
    renderPanel(inventoryElem) {
        // Never anchor into a hidden Inventory instance (e.g. the
        // CharacterManagement clone) - the panel would stay invisible.
        if (!this.isRendered(inventoryElem)) {
            return;
        }

        // Check if already rendered and still visible
        if (this.container && document.body.contains(this.container) && this.isRendered(this.container)) {
            return;
        }

        // Remove any existing container
        if (this.container) {
            this.container.remove();
        }

        // Create container
        this.container = document.createElement('div');
        this.container.className = 'mwi-networth-panel';
        this.container.style.cssText = `
            text-align: left;
            color: ${config.COLOR_ACCENT};
            font-size: 0.875rem;
            margin-top: -10px;
            margin-bottom: 0;
        `;

        // Insert before inventory items
        inventoryElem.insertAdjacentElement('beforebegin', this.container);

        // Initial render with loading state or current data
        if (this.currentData) {
            this.update(this.currentData);
        } else {
            this.container.innerHTML = `
                <div style="font-weight: bold; cursor: pointer;">
                    ${t('networthDisplay.networthLoadingMessage')}
                </div>
            `;
        }
    }

    /**
     * Update panel with networth data
     * @param {Object} networthData - Networth data from calculator
     */
    update(networthData) {
        this.currentData = networthData;

        // Self-heal: if the panel is missing or trapped in a hidden subtree
        // (game keeps a display:none Inventory clone), re-anchor to the
        // rendered Inventory instance. renderPanel() calls back into update()
        // with the container already visible, so this cannot loop.
        if (!this.container || !document.body.contains(this.container) || !this.isRendered(this.container)) {
            const anchor = this.findRenderedInventoryItems();
            if (anchor) {
                this.renderPanel(anchor);
                return;
            }
            // No rendered anchor available: keep updating the existing
            // container if it is still attached (also covers layout-less
            // environments such as DOM tests).
            if (!this.container || !document.body.contains(this.container)) {
                return;
            }
        }

        // Preserve <details> open state across re-render (generic: any details with an id)
        const prevOpenIds = new Set(
            Array.from(this.container.querySelectorAll('details[id]'))
                .filter((d) => d.open)
                .map((d) => d.id)
        );
        // First render starts collapsed; afterwards preserve the user's toggle state.
        const prevRoot = this.container.querySelector('#mwi-networth-details');
        const rootWasOpen = prevRoot ? prevRoot.style.display !== 'none' : false;

        const totalNetworth = networthFormatter(Math.round(networthData.totalNetworth));
        const share = getSharePercent(networthData);
        const showChartBtn = config.getSetting('networth_historyChart');
        const ca = networthData.currentAssets;
        const fa = networthData.fixedAssets;
        const excl = networthData.excluded ?? { total: 0, items: [] };

        const showCurrentAssets = ca.total > 0;
        const showEquipped = ca.equipped.value > 0;
        const showInventory = ca.inventory.value > 0;
        const showListings = ca.listings.value > 0;
        const showFixedAssets = fa.total > 0;
        const showHouses = fa.houses.totalCost > 0;
        const showAbilities = fa.abilities.totalCost > 0;
        const showGuildShrines = fa.guildShrines.totalCost > 0;
        const showExcluded = excl.total > 0;

        const sections = [];
        if (showCurrentAssets) {
            const nodes = [];
            if (showEquipped) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-equipment',
                        t('networthDisplay.equipmentName'),
                        networthFormatter(Math.round(ca.equipped.value)),
                        this.renderEquipmentBreakdown(ca.equipped.breakdown)
                    )
                );
            }
            if (showInventory) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-inventory',
                        t('networthDisplay.inventoryName'),
                        networthFormatter(Math.round(ca.inventory.value)),
                        this.renderInventoryBreakdown(ca.inventory)
                    )
                );
            }
            if (showListings) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-listings',
                        t('networthDisplay.marketListingsName'),
                        networthFormatter(Math.round(ca.listings.value)),
                        this.renderListingsBreakdown(ca.listings.breakdown)
                    )
                );
            }
            sections.push(
                `<div class="mwi-nw-section"><span class="mwi-nw-section-name">${t('networthDisplay.currentAssetsName')}</span><span class="mwi-nw-section-value">${networthFormatter(Math.round(ca.total))}</span></div>` +
                    `<div class="mwi-nw-kids">${nodes.join('')}</div>`
            );
        }
        if (showFixedAssets) {
            const nodes = [];
            if (showHouses) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-houses',
                        t('networthDisplay.housesName'),
                        networthFormatter(Math.round(fa.houses.totalCost)),
                        this.renderHousesBreakdown(fa.houses.breakdown)
                    )
                );
            }
            if (showAbilities) {
                const abilityChildren =
                    nodeDetails(
                        2,
                        'mwi-nw-abilities-equipped',
                        t('networthDisplay.equippedAbilitiesLabel', { count: fa.abilities.equippedBreakdown.length }),
                        networthFormatter(Math.round(fa.abilities.equippedCost)),
                        this.renderAbilitiesBreakdown(fa.abilities.equippedBreakdown)
                    ) +
                    (fa.abilities.otherBreakdown.length > 0
                        ? nodeDetails(
                              2,
                              'mwi-nw-abilities-other',
                              t('networthDisplay.otherAbilitiesLabel', { count: fa.abilities.otherBreakdown.length }),
                              networthFormatter(Math.round(fa.abilities.totalCost - fa.abilities.equippedCost)),
                              this.renderAbilitiesBreakdown(fa.abilities.otherBreakdown)
                          )
                        : '');
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-abilities',
                        t('networthDisplay.abilitiesName'),
                        networthFormatter(Math.round(fa.abilities.totalCost)),
                        abilityChildren
                    )
                );
            }
            if (fa.abilityBooks.breakdown.length > 0) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-ability-books',
                        t('networthDisplay.abilityBooksLabel', { count: fa.abilityBooks.breakdown.length }),
                        networthFormatter(Math.round(fa.abilityBooks.totalCost)),
                        this.renderAbilityBooksBreakdown(fa.abilityBooks.breakdown)
                    )
                );
            }
            if (showGuildShrines) {
                nodes.push(
                    nodeDetails(
                        1,
                        'mwi-nw-shrines',
                        t('networthDisplay.guildShrinesName'),
                        networthFormatter(Math.round(fa.guildShrines.totalCost)),
                        this.renderGuildShrinesBreakdown(fa.guildShrines.breakdown)
                    )
                );
            }
            sections.push(
                `<div class="mwi-nw-section"><span class="mwi-nw-section-name">${t('networthDisplay.fixedAssetsName')}</span><span class="mwi-nw-section-value">${networthFormatter(Math.round(fa.total))}</span></div>` +
                    `<div class="mwi-nw-kids">${nodes.join('')}</div>`
            );
        }
        if (showExcluded) {
            const rows = excl.items
                .map(
                    (item) =>
                        `<div class="mwi-nw-exclrow"><span class="mwi-nw-exclname">${item.name}: ${networthFormatter(Math.round(item.amount))}</span>` +
                        `<span class="mwi-excluded-remove" data-type="${attrValue(item.type)}" data-value="${attrValue(item.value)}" title="${t('networthExclusionPopup.removeExclusionTooltip')}">✕</span></div>`
                )
                .join('');
            sections.push(
                `<div class="mwi-nw-section"><span class="mwi-nw-section-name">${t('networthDisplay.excludedSectionName')}</span><span class="mwi-nw-section-value">${networthFormatter(Math.round(excl.total))}</span></div>` +
                    `<div class="mwi-nw-kids">${rows}</div>`
            );
        }

        this.container.innerHTML = `
            <div class="mwi-nw-root">
                <div class="mwi-networth-icon-row mwi-nw-iconrow">
                    <div class="mwi-nw-headtoggle" id="mwi-networth-toggle">
                        <span class="mwi-nw-headname"><span class="mwi-nw-chev" id="mwi-networth-chev">▸</span><span class="mwi-nw-coin">🪙</span>${t('networthDisplay.netWorthName')}</span>
                        <span class="mwi-nw-big">${totalNetworth}</span>
                    </div>
                    ${
                        showChartBtn
                            ? `<span id="mwi-networth-chart-btn" class="mwi-nw-iconbtn" title="${t('networthDisplay.netWorthHistoryChartTooltip')}">📈</span>`
                            : ''
                    }
                    <span id="mwi-networth-exclusions-btn" class="mwi-nw-iconbtn" title="${t('networthDisplay.configureExclusionsTooltip')}">🔧</span>
                </div>
                <div id="mwi-networth-details" style="${rootWasOpen ? '' : 'display: none;'} margin-left: 20px;">
                    ${renderShareBar(share)}
                    ${sections.join('')}
                </div>
            </div>
        `;

        // Restore details open state
        prevOpenIds.forEach((id) => {
            const el = this.container.querySelector(`details[id="${id}"]`);
            if (el) {
                el.open = true;
            }
        });

        this.setupActionListeners(networthData);
    }

    /**
     * Render houses breakdown HTML
     * @param {Array} breakdown - Array of {name, level, cost}
     * @returns {string} HTML string
     */
    renderHousesBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noHousesBuiltMessage')}</div>`;
        }
        return breakdown
            .map((house) =>
                leafRow(
                    2,
                    `${house.name}${countSpan(String(house.level))}${buildOutlierPriceWarningIcon(house.isOutlier)}`,
                    networthFormatter(Math.round(house.cost))
                )
            )
            .join('');
    }

    /**
     * Render abilities breakdown HTML
     * @param {Array} breakdown - Array of {name, cost}
     * @returns {string} HTML string
     */
    renderAbilitiesBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noAbilitiesMessage')}</div>`;
        }
        return breakdown
            .map((ability) =>
                leafRow(
                    3,
                    `${ability.name}${buildOutlierPriceWarningIcon(ability.isOutlier)}`,
                    networthFormatter(Math.round(ability.cost))
                )
            )
            .join('');
    }

    /**
     * Render ability books breakdown HTML
     * @param {Array} breakdown - Array of {name, value, count}
     * @returns {string} HTML string
     */
    renderAbilityBooksBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noAbilityBooksMessage')}</div>`;
        }
        return breakdown
            .map((book) =>
                leafRow(2, `${book.name}${countSpan(formatKMB(book.count))}`, networthFormatter(Math.round(book.value)))
            )
            .join('');
    }

    /**
     * Render guild shrines breakdown HTML
     * @param {Array} breakdown - Array of {name, level, cost}
     * @returns {string} HTML string
     */
    renderGuildShrinesBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noGuildShrineBuffsMessage')}</div>`;
        }
        return breakdown
            .map((buff) =>
                leafRow(2, `${buff.name}${countSpan(`Lv.${buff.level}`)}`, networthFormatter(Math.round(buff.cost)))
            )
            .join('');
    }

    /**
     * Render equipment breakdown HTML
     * @param {Array} breakdown - Array of {name, value}
     * @returns {string} HTML string
     */
    renderEquipmentBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noEquipmentMessage')}</div>`;
        }
        return breakdown
            .map((item) =>
                leafRow(
                    2,
                    `${item.name}${buildOutlierPriceWarningIcon(item.isOutlier)}`,
                    networthFormatter(Math.round(item.value))
                )
            )
            .join('');
    }

    /**
     * Render market listings breakdown HTML
     * @param {Array} breakdown - Array of listing objects
     * @returns {string} HTML string
     */
    renderListingsBreakdown(breakdown) {
        if (!breakdown || breakdown.length === 0) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noMarketListingsMessage')}</div>`;
        }
        return breakdown
            .map((listing) => {
                const typeLabel = listing.isSell ? t('marketHistory.sellLabel') : t('marketHistory.buyLabel');
                return leafRow(
                    2,
                    `${listing.name}${countSpan(`(${typeLabel})`)}${buildOutlierPriceWarningIcon(listing.isOutlier)}`,
                    networthFormatter(Math.round(listing.value))
                );
            })
            .join('');
    }

    /**
     * Render inventory breakdown HTML (grouped by category, with Coin as a top-level line item)
     * @param {Object} inventory - inventory object with byCategory and breakdown
     * @returns {string} HTML string
     */
    renderInventoryBreakdown(inventory) {
        const byCategory = inventory.byCategory ?? {};
        const coinItem = inventory.breakdown?.find((item) => item.itemHrid === '/items/coin') ?? null;

        if (Object.keys(byCategory).length === 0 && !coinItem) {
            return `<div class="mwi-nw-row mwi-nw-empty">${t('networthDisplay.noInventoryMessage')}</div>`;
        }

        const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1].totalValue - a[1].totalValue);

        const renderCategory = ([categoryName, categoryData]) => {
            const categoryId = `mwi-nw-cat-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
            const children = categoryData.items
                .map((item) => {
                    if (item.isOpenable && item.itemHrid) {
                        return this.renderOpenableItemRow(item);
                    }
                    return leafRow(
                        3,
                        `${item.name}${countSpan(`x${formatKMB(item.count)}`)}${buildOutlierPriceWarningIcon(item.isOutlier)}`,
                        networthFormatter(Math.round(item.value)),
                        { zero: item.value === 0 }
                    );
                })
                .join('');
            return nodeDetails(
                2,
                categoryId,
                categoryName,
                networthFormatter(Math.round(categoryData.totalValue)),
                children
            );
        };

        const coinHTML = coinItem
            ? leafRow(2, t('networthDisplay.coinName'), networthFormatter(Math.round(coinItem.value)), {
                  zero: coinItem.value === 0,
              })
            : '';

        // Insert coin at the right position based on value (sorted descending with categories)
        let html = '';
        let coinInserted = !coinItem;
        for (const entry of sortedCategories) {
            if (!coinInserted && coinItem.value >= entry[1].totalValue) {
                html += coinHTML;
                coinInserted = true;
            }
            html += renderCategory(entry);
        }
        if (!coinInserted) {
            html += coinHTML;
        }
        return html;
    }

    /**
     * Bind chart / exclusions / excluded-row remove listeners.
     * Expand/collapse itself is native <details> behavior — no toggle handlers needed.
     * @param {Object} networthData - Networth data
     */
    setupActionListeners(networthData) {
        // Root collapse toggle
        const rootToggle = this.container.querySelector('#mwi-networth-toggle');
        const rootDetails = this.container.querySelector('#mwi-networth-details');
        if (rootToggle && rootDetails) {
            rootToggle.addEventListener('click', () => {
                const isCollapsed = rootDetails.style.display === 'none';
                rootDetails.style.display = isCollapsed ? 'block' : 'none';
                this.container.querySelector('#mwi-networth-chev')?.classList.toggle('mwi-nw-chev-open', isCollapsed);
            });
        }

        // Chart button
        const chartBtn = this.container.querySelector('#mwi-networth-chart-btn');
        if (chartBtn) {
            chartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                networthHistoryChart.openModal();
            });
            chartBtn.addEventListener('mouseenter', () => (chartBtn.style.opacity = '1'));
            chartBtn.addEventListener('mouseleave', () => (chartBtn.style.opacity = '0.6'));
        }

        // Exclusions button
        const exclusionsBtn = this.container.querySelector('#mwi-networth-exclusions-btn');
        if (exclusionsBtn) {
            exclusionsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                networthExclusionPopup.open(networthData, () => {
                    if (this.networthFeature) this.networthFeature.recalculate();
                });
            });
            exclusionsBtn.addEventListener('mouseenter', () => (exclusionsBtn.style.opacity = '1'));
            exclusionsBtn.addEventListener('mouseleave', () => (exclusionsBtn.style.opacity = '0.6'));
        }

        // ✕ remove buttons on excluded rows
        this.container.querySelectorAll('.mwi-excluded-remove').forEach((btn) => {
            btn.addEventListener('mouseenter', () => (btn.style.color = 'rgba(255,100,100,1)'));
            btn.addEventListener('mouseleave', () => (btn.style.color = 'rgba(255,100,100,0.7)'));
            btn.addEventListener('click', async () => {
                await removeExclusion(btn.dataset.type, btn.dataset.value);
                if (this.networthFeature) this.networthFeature.recalculate();
            });
        });
    }

    /**
     * Render an expandable row for an openable item (chest, cache, crate)
     * @param {Object} item - Item data including itemHrid and isOpenable
     * @returns {string} HTML string
     */
    renderOpenableItemRow(item) {
        const slug = item.itemHrid.split('/').pop();
        const detailId = `mwi-nw-chest-${slug}`;

        const evData = expectedValueCalculator.isInitialized
            ? expectedValueCalculator.calculateExpectedValue(item.itemHrid)
            : null;

        let detailsHTML = '';
        if (evData) {
            const chestKeyHrid = DUNGEON_CHEST_CHEST_KEYS[item.itemHrid];
            let keyPrice = 0;
            let keyName = null;
            let keyPriceOutlier = false;
            if (chestKeyHrid) {
                const keyPriceInfo = getKeyPriceInfo(chestKeyHrid);
                keyPrice = keyPriceInfo.price ?? 0;
                keyPriceOutlier = keyPriceInfo.isOutlier;
                keyName = getItemName(chestKeyHrid, dataManager.getItemDetails(chestKeyHrid)?.name);
            }
            detailsHTML = this.buildChestDropsHTML(evData, keyPrice, keyName, keyPriceOutlier);
        }

        return nodeDetails(
            3,
            detailId,
            `${item.name}${countSpan(`x${formatKMB(item.count)}`)}${buildOutlierPriceWarningIcon(item.isOutlier)}`,
            networthFormatter(Math.round(item.value)),
            `<div class="mwi-nw-ev">${detailsHTML}</div>`
        );
    }

    /**
     * Build the drop breakdown HTML for an expanded chest row
     * @param {Object} evData - Expected value data from expectedValueCalculator
     * @param {number} keyPrice - Chest key market price (0 for non-dungeon chests)
     * @param {string|null} keyName - Chest key item name
     * @param {boolean} [keyPriceOutlier=false] - Whether the key price was substituted by the
     *   market-data outlier guard
     * @returns {string} HTML string
     */
    buildChestDropsHTML(evData, keyPrice, keyName, keyPriceOutlier = false) {
        let html = `<div>${t('networthDisplay.evPerChestLabel', { value: networthFormatter(Math.round(evData.expectedValue)) })}${buildOutlierPriceWarningIcon(evData.hasOutlierPrices)}</div>`;
        if (keyPrice > 0) {
            const label = keyName
                ? t('networthDisplay.keyLabelWithName', { name: keyName })
                : t('networthDisplay.keyCostLabel');
            html += `<div>\u2212 ${label}: ${networthFormatter(Math.round(keyPrice))}${buildOutlierPriceWarningIcon(keyPriceOutlier)}</div>`;
            html += `<div>${t('networthDisplay.netPerChestLabel', { value: networthFormatter(Math.round(evData.expectedValue - keyPrice)) })}</div>`;
        }
        const pricedDrops = evData.drops.filter((d) => d.hasPriceData);
        if (pricedDrops.length > 0) {
            html += '<div style="margin-top: 3px;">';
            for (const drop of pricedDrops) {
                const pct = (drop.dropRate * 100).toFixed(1);
                html += `<div>\u2022 ${getItemName(drop.itemHrid, drop.itemName)} (${pct}%): ${networthFormatter(Math.round(drop.expectedValue))}${buildOutlierPriceWarningIcon(drop.isOutlier)}</div>`;
            }
            html += '</div>';
        }
        return html;
    }

    /**
     * Refresh colors on existing panel
     */
    refresh() {
        if (!this.container || !document.body.contains(this.container)) {
            return;
        }
        injectPanelStyles();
    }

    /**
     * Disable and cleanup
     */
    disable() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.currentData = null;
        this.isInitialized = false;
    }
}

// Export both display components
export const networthHeaderDisplay = new NetworthHeaderDisplay();
export const networthInventoryDisplay = new NetworthInventoryDisplay();
