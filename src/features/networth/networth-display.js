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
.mwi-nw-headname { display: inline-flex; align-items: center; gap: 7px; color: #fff; }
.mwi-nw-coin { width: 20px; height: 20px; border-radius: 6px; background: rgba(251,191,36,0.16); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; flex: none; }
.mwi-nw-big { color: #fbbf24; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mwi-nw-chev { display: inline-block; width: 11px; color: rgba(255,255,255,0.4); font-size: 9px; transition: transform 0.15s; flex: none; }
.mwi-nw-chev-open { transform: rotate(90deg); }
details.mwi-nw-node { display: block; min-width: 0; }
details.mwi-nw-node > summary { list-style: none; cursor: pointer; }
details.mwi-nw-node > summary::-webkit-details-marker { display: none; }
details.mwi-nw-node > summary .mwi-nw-chev { transform: rotate(0); }
details.mwi-nw-node[open] > summary .mwi-nw-chev { transform: rotate(90deg); }
.mwi-nw-sharebar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 10px 2px 3px; }
.mwi-nw-sharebar i { display: block; height: 100%; }
.mwi-nw-sharelegend { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.45); padding: 0 4px 2px; }
.mwi-nw-section { display: flex; align-items: center; justify-content: space-between; margin: 12px 2px 3px; padding: 3px 6px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); border-bottom: 1px solid rgba(255,255,255,0.08); }
.mwi-nw-section-value { font-size: 12px; color: rgba(255,255,255,0.85); font-weight: 600; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums; }
.mwi-nw-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 3px 6px; border-radius: 5px; font-size: 12px; min-width: 0; }
.mwi-nw-kids > details > summary:hover, .mwi-nw-kids > .mwi-nw-row:hover { background: rgba(255,255,255,0.07); }
.mwi-nw-kids > :nth-child(odd) > summary, .mwi-nw-kids > .mwi-nw-row:nth-child(odd) { background: rgba(255,255,255,0.03); }
.mwi-nw-nm { color: inherit; overflow-wrap: anywhere; }
.mwi-nw-count { color: rgba(255,255,255,0.4); font-size: 10.5px; margin-left: 4px; }
.mwi-nw-val { color: #fbbf24; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mwi-nw-zero { color: rgba(255,255,255,0.3); font-weight: 400; }
.mwi-nw-indent { border-left: 1px solid rgba(255,255,255,0.08); margin: 1px 0 1px 11px; padding-left: 9px; }
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
     * Initialize inventory panel display
     */
    initialize() {
        injectPanelStyles();

        // 1. Check if element already exists (handles late initialization)
        const existingElem = document.querySelector('[class*="Inventory_items"]');
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

        if (!this.container || !document.body.contains(this.container)) {
            return;
        }

        // Preserve expand/collapse states before updating
        const expandedStates = {};
        const sectionsToPreserve = [
            'mwi-networth-details',
            'mwi-current-assets-details',
            'mwi-equipment-breakdown',
            'mwi-inventory-breakdown',
            'mwi-listings-breakdown',
            'mwi-fixed-assets-details',
            'mwi-houses-breakdown',
            'mwi-abilities-details',
            'mwi-equipped-abilities-breakdown',
            'mwi-other-abilities-breakdown',
            'mwi-ability-books-breakdown',
            'mwi-guild-shrines-breakdown',
            'mwi-excluded-details',
        ];

        // Also preserve inventory category states
        const inventoryCategories = Object.keys(networthData.currentAssets.inventory.byCategory || {});
        inventoryCategories.forEach((categoryName) => {
            const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
            sectionsToPreserve.push(categoryId);
        });

        // Preserve chest item expand states
        const byCatForState = networthData.currentAssets.inventory.byCategory || {};
        for (const categoryData of Object.values(byCatForState)) {
            for (const item of categoryData.items) {
                if (item.isOpenable && item.itemHrid) {
                    const slug = item.itemHrid.split('/').pop();
                    sectionsToPreserve.push(`mwi-chest-${slug}-detail`);
                }
            }
        }

        sectionsToPreserve.forEach((id) => {
            const elem = this.container.querySelector(`#${id}`);
            if (elem) {
                expandedStates[id] = elem.style.display !== 'none';
            }
        });

        const totalNetworth = networthFormatter(Math.round(networthData.totalNetworth));
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

        this.container.innerHTML = `
            <div class="mwi-networth-icon-row" style="display: flex; align-items: center; gap: 6px;">
                <div style="cursor: pointer; font-weight: bold; flex: 1;" id="mwi-networth-toggle">
                    + ${t('networthDisplay.netWorthLabel', { value: totalNetworth })}
                </div>
                ${
                    showChartBtn
                        ? `<span id="mwi-networth-chart-btn" title="${t('networthDisplay.netWorthHistoryChartTooltip')}" style="
                    cursor: pointer;
                    font-size: 14px;
                    opacity: 0.7;
                    padding: 2px 4px;
                    border-radius: 3px;
                    line-height: 1;
                ">&#x1F4C8;</span>`
                        : ''
                }
                <span id="mwi-networth-exclusions-btn" title="${t('networthDisplay.configureExclusionsTooltip')}" style="
                    cursor: pointer;
                    font-size: 12px;
                    opacity: 0.6;
                    padding: 2px 4px;
                    border-radius: 3px;
                    line-height: 1;
                ">🔧</span>
            </div>
            <div id="mwi-networth-details" style="display: none; margin-left: 20px;">
                ${
                    showCurrentAssets
                        ? `
                <!-- Current Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-current-assets-toggle">
                    + ${t('networthDisplay.currentAssetsLabel', { value: networthFormatter(Math.round(ca.total)) })}
                </div>
                <div id="mwi-current-assets-details" style="display: none; margin-left: 20px;">
                    ${
                        showEquipped
                            ? `
                    <!-- Equipment Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipment-toggle">
                        + ${t('networthDisplay.equipmentValueLabel', { value: networthFormatter(Math.round(ca.equipped.value)) })}
                    </div>
                    <div id="mwi-equipment-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderEquipmentBreakdown(ca.equipped.breakdown)}</div>
                    `
                            : ''
                    }

                    ${
                        showInventory
                            ? `
                    <!-- Inventory Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-inventory-toggle">
                        + ${t('networthDisplay.inventoryValueLabel', { value: networthFormatter(Math.round(ca.inventory.value)) })}
                    </div>
                    <div id="mwi-inventory-breakdown" style="display: none; margin-left: 20px;">
                        ${this.renderInventoryBreakdown(ca.inventory)}
                    </div>
                    `
                            : ''
                    }

                    ${
                        showListings
                            ? `
                    <!-- Market Listings -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-listings-toggle">
                        + ${t('networthDisplay.marketListingsLabel', { value: networthFormatter(Math.round(ca.listings.value)) })}
                    </div>
                    <div id="mwi-listings-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderListingsBreakdown(ca.listings.breakdown)}</div>
                    `
                            : ''
                    }
                </div>
                `
                        : ''
                }

                ${
                    showFixedAssets
                        ? `
                <!-- Fixed Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-fixed-assets-toggle">
                    + ${t('networthDisplay.fixedAssetsLabel', { value: networthFormatter(Math.round(fa.total)) })}
                </div>
                <div id="mwi-fixed-assets-details" style="display: none; margin-left: 20px;">
                    ${
                        showHouses
                            ? `
                    <!-- Houses -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-houses-toggle">
                        + ${t('networthDisplay.housesLabel', { value: networthFormatter(Math.round(fa.houses.totalCost)) })}
                    </div>
                    <div id="mwi-houses-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderHousesBreakdown(fa.houses.breakdown)}</div>
                    `
                            : ''
                    }

                    ${
                        showAbilities
                            ? `
                    <!-- Abilities -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-abilities-toggle">
                        + ${t('networthDisplay.abilitiesLabel', { value: networthFormatter(Math.round(fa.abilities.totalCost)) })}
                    </div>
                    <div id="mwi-abilities-details" style="display: none; margin-left: 20px;">
                        <!-- Equipped Abilities -->
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipped-abilities-toggle">
                            + ${t('networthDisplay.equippedAbilitiesLabel', { count: fa.abilities.equippedBreakdown.length, value: networthFormatter(Math.round(fa.abilities.equippedCost)) })}
                        </div>
                        <div id="mwi-equipped-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilitiesBreakdown(fa.abilities.equippedBreakdown)}</div>

                        ${
                            fa.abilities.otherBreakdown.length > 0
                                ? `
                            <div style="cursor: pointer; margin-top: 4px;" id="mwi-other-abilities-toggle">
                                + ${t('networthDisplay.otherAbilitiesCountLabel', { count: fa.abilities.otherBreakdown.length, value: networthFormatter(Math.round(fa.abilities.totalCost - fa.abilities.equippedCost)) })}
                            </div>
                            <div id="mwi-other-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilitiesBreakdown(fa.abilities.otherBreakdown)}</div>
                        `
                                : ''
                        }
                    </div>
                    `
                            : ''
                    }

                    ${
                        fa.abilityBooks.breakdown.length > 0
                            ? `
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-ability-books-toggle">
                            + ${t('networthDisplay.abilityBooksCountLabel', { count: fa.abilityBooks.breakdown.length, value: networthFormatter(Math.round(fa.abilityBooks.totalCost)) })}
                        </div>
                        <div id="mwi-ability-books-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilityBooksBreakdown(fa.abilityBooks.breakdown)}</div>
                    `
                            : ''
                    }

                    ${
                        showGuildShrines
                            ? `
                    <!-- Guild Shrines -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-guild-shrines-toggle">
                        + ${t('networthDisplay.guildShrinesLabel', { value: networthFormatter(Math.round(fa.guildShrines.totalCost)) })}
                    </div>
                    <div id="mwi-guild-shrines-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderGuildShrinesBreakdown(fa.guildShrines.breakdown)}</div>
                    `
                            : ''
                    }
                </div>
                `
                        : ''
                }

                ${
                    showExcluded
                        ? `
                <!-- Excluded -->
                <div style="cursor: pointer; margin-top: 8px; opacity: 0.6;" id="mwi-excluded-toggle">
                    + ${t('networthDisplay.excludedLabel', { value: networthFormatter(Math.round(excl.total)) })}
                </div>
                <div id="mwi-excluded-details" style="display: none; margin-left: 20px; font-size: 0.8rem;">
                    ${excl.items
                        .map(
                            (item) => `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px; color: rgba(255,255,255,0.45);">
                            <span style="text-decoration: line-through;">${item.name}: ${networthFormatter(Math.round(item.amount))}</span>
                            <span class="mwi-excluded-remove" data-type="${item.type}" data-value="${item.value.replace(/"/g, '&quot;')}" style="cursor: pointer; color: rgba(255,100,100,0.7); margin-left: 8px; font-size: 0.75rem;" title="${t('networthExclusionPopup.removeExclusionTooltip')}">✕</span>
                        </div>
                    `
                        )
                        .join('')}
                </div>
                `
                        : ''
                }
            </div>
        `;

        // Restore expand/collapse states after updating
        sectionsToPreserve.forEach((id) => {
            const elem = this.container.querySelector(`#${id}`);
            if (elem && expandedStates[id]) {
                elem.style.display = 'block';

                // Derive the toggle button ID from the detail ID.
                // Fixed sections use suffixes like -details, -breakdown, -detail → strip and append -toggle.
                // Dynamic sections (e.g. inventory categories: mwi-inventory-loot) use id + '-toggle'.
                let toggleId = id
                    .replace('-details', '-toggle')
                    .replace('-breakdown', '-toggle')
                    .replace('-detail', '-toggle');
                if (toggleId === id) {
                    toggleId = id + '-toggle';
                }

                const toggleBtn = this.container.querySelector(`#${toggleId}`);
                if (toggleBtn) {
                    const currentText = toggleBtn.textContent;
                    toggleBtn.textContent = currentText.replace('+ ', '- ');
                }
            }
        });

        // Set up event listeners for all toggles
        this.setupToggleListeners(networthData);
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
     * Set up toggle event listeners
     * @param {Object} networthData - Networth data
     */
    setupToggleListeners(networthData) {
        const ca = networthData.currentAssets;
        const fa = networthData.fixedAssets;
        const excl = networthData.excluded ?? { total: 0, items: [] };

        // Main networth toggle
        this.setupToggle(
            'mwi-networth-toggle',
            'mwi-networth-details',
            t('networthDisplay.netWorthLabel', { value: networthFormatter(Math.round(networthData.totalNetworth)) })
        );

        // Chart button
        const chartBtn = this.container.querySelector('#mwi-networth-chart-btn');
        if (chartBtn) {
            chartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                networthHistoryChart.openModal();
            });
            chartBtn.addEventListener('mouseenter', () => {
                chartBtn.style.opacity = '1';
            });
            chartBtn.addEventListener('mouseleave', () => {
                chartBtn.style.opacity = '0.7';
            });
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
            exclusionsBtn.addEventListener('mouseenter', () => {
                exclusionsBtn.style.opacity = '1';
            });
            exclusionsBtn.addEventListener('mouseleave', () => {
                exclusionsBtn.style.opacity = '0.6';
            });
        }

        // Current assets toggle
        if (ca.total > 0) {
            this.setupToggle(
                'mwi-current-assets-toggle',
                'mwi-current-assets-details',
                t('networthDisplay.currentAssetsLabel', { value: networthFormatter(Math.round(ca.total)) })
            );
        }

        // Equipment toggle
        if (ca.equipped.value > 0) {
            this.setupToggle(
                'mwi-equipment-toggle',
                'mwi-equipment-breakdown',
                t('networthDisplay.equipmentValueLabel', { value: networthFormatter(Math.round(ca.equipped.value)) })
            );
        }

        // Inventory toggle
        if (ca.inventory.value > 0) {
            this.setupToggle(
                'mwi-inventory-toggle',
                'mwi-inventory-breakdown',
                t('networthDisplay.inventoryValueLabel', { value: networthFormatter(Math.round(ca.inventory.value)) })
            );

            // Inventory category toggles
            Object.entries(ca.inventory.byCategory || {}).forEach(([categoryName, categoryData]) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                const categoryToggleId = `${categoryId}-toggle`;
                this.setupToggle(
                    categoryToggleId,
                    categoryId,
                    `${categoryName}: ${networthFormatter(Math.round(categoryData.totalValue))}`
                );
            });

            // Per-chest item toggles (openable items)
            for (const categoryData of Object.values(ca.inventory.byCategory || {})) {
                for (const item of categoryData.items) {
                    if (item.isOpenable && item.itemHrid) {
                        const slug = item.itemHrid.split('/').pop();
                        this.setupToggle(
                            `mwi-chest-${slug}-toggle`,
                            `mwi-chest-${slug}-detail`,
                            `${item.name} x${formatKMB(item.count)}: ${networthFormatter(Math.round(item.value))}`
                        );
                    }
                }
            }
        }

        // Market Listings toggle
        if (ca.listings.value > 0) {
            this.setupToggle(
                'mwi-listings-toggle',
                'mwi-listings-breakdown',
                t('networthDisplay.marketListingsLabel', { value: networthFormatter(Math.round(ca.listings.value)) })
            );
        }

        // Fixed assets toggle
        if (fa.total > 0) {
            this.setupToggle(
                'mwi-fixed-assets-toggle',
                'mwi-fixed-assets-details',
                t('networthDisplay.fixedAssetsLabel', { value: networthFormatter(Math.round(fa.total)) })
            );
        }

        // Houses toggle
        if (fa.houses.totalCost > 0) {
            this.setupToggle(
                'mwi-houses-toggle',
                'mwi-houses-breakdown',
                t('networthDisplay.housesLabel', { value: networthFormatter(Math.round(fa.houses.totalCost)) })
            );
        }

        // Abilities toggle
        if (fa.abilities.totalCost > 0) {
            this.setupToggle(
                'mwi-abilities-toggle',
                'mwi-abilities-details',
                t('networthDisplay.abilitiesLabel', { value: networthFormatter(Math.round(fa.abilities.totalCost)) })
            );

            // Equipped abilities toggle
            this.setupToggle(
                'mwi-equipped-abilities-toggle',
                'mwi-equipped-abilities-breakdown',
                t('networthDisplay.equippedAbilitiesLabel', {
                    count: fa.abilities.equippedBreakdown.length,
                    value: networthFormatter(Math.round(fa.abilities.equippedCost)),
                })
            );

            // Other abilities toggle (if exists)
            if (fa.abilities.otherBreakdown.length > 0) {
                this.setupToggle(
                    'mwi-other-abilities-toggle',
                    'mwi-other-abilities-breakdown',
                    t('networthDisplay.otherAbilitiesLabel', {
                        value: networthFormatter(Math.round(fa.abilities.totalCost - fa.abilities.equippedCost)),
                    })
                );
            }
        }

        // Ability books toggle (if exists)
        if (fa.abilityBooks.breakdown.length > 0) {
            this.setupToggle(
                'mwi-ability-books-toggle',
                'mwi-ability-books-breakdown',
                t('networthDisplay.abilityBooksLabel', {
                    value: networthFormatter(Math.round(fa.abilityBooks.totalCost)),
                })
            );
        }

        // Guild Shrines toggle
        if (fa.guildShrines.totalCost > 0) {
            this.setupToggle(
                'mwi-guild-shrines-toggle',
                'mwi-guild-shrines-breakdown',
                t('networthDisplay.guildShrinesLabel', {
                    value: networthFormatter(Math.round(fa.guildShrines.totalCost)),
                })
            );
        }

        // Excluded toggle
        if (excl.total > 0) {
            this.setupToggle(
                'mwi-excluded-toggle',
                'mwi-excluded-details',
                t('networthDisplay.excludedLabel', { value: networthFormatter(Math.round(excl.total)) })
            );

            // ✕ remove buttons on excluded rows
            this.container.querySelectorAll('.mwi-excluded-remove').forEach((btn) => {
                btn.addEventListener('mouseenter', () => {
                    btn.style.color = 'rgba(255,100,100,1)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.color = 'rgba(255,100,100,0.7)';
                });
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.type;
                    const value = btn.dataset.value;
                    await removeExclusion(type, value);
                    if (this.networthFeature) this.networthFeature.recalculate();
                });
            });
        }
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
     * Set up a single toggle button
     * @param {string} toggleId - Toggle button element ID
     * @param {string} detailsId - Details element ID
     * @param {string} label - Label text (without +/- prefix)
     */
    setupToggle(toggleId, detailsId, label) {
        const toggleBtn = this.container.querySelector(`#${toggleId}`);
        const details = this.container.querySelector(`#${detailsId}`);

        if (!toggleBtn || !details) return;

        toggleBtn.addEventListener('click', () => {
            const isCollapsed = details.style.display === 'none';
            details.style.display = isCollapsed ? 'block' : 'none';
            toggleBtn.textContent = (isCollapsed ? '- ' : '+ ') + label;
        });
    }

    /**
     * Refresh colors on existing panel
     */
    refresh() {
        if (!this.container || !document.body.contains(this.container)) {
            return;
        }

        // Update main container color
        this.container.style.color = config.COLOR_ACCENT;
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
