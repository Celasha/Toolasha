/**
 * Networth Display Components
 * Handles UI rendering for networth in two locations:
 * 1. Header (top right) - Gold: [amount]
 * 2. Inventory Panel - Detailed breakdown with collapsible sections
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { networthFormatter, formatKMB } from '../../utils/formatters.js';
import networthHistoryChart from './networth-history-chart.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { DUNGEON_CHEST_CHEST_KEYS } from '../combat-stats/combat-stats-calculator.js';
import networthExclusionPopup from './networth-exclusion-popup.js';
import { removeExclusion } from './networth-exclusions.js';

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
        this.renderGoldDisplay('Loading...');

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

        // Create SVG icon using game's sprite
        if (itemsSpriteUrl) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.style.cssText = `
                vertical-align: middle;
                fill: currentColor;
            `;

            // Create use element with external sprite reference
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `${itemsSpriteUrl}#coin`);
            svg.appendChild(use);

            wrapper.appendChild(svg);
        }

        // Create text span
        const textSpan = document.createElement('span');
        textSpan.textContent = `Gold: ${value}`;

        // Assemble
        wrapper.appendChild(textSpan);
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
                    Networth: Loading...
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
            'mwi-fixed-assets-details',
            'mwi-houses-breakdown',
            'mwi-abilities-details',
            'mwi-equipped-abilities-breakdown',
            'mwi-other-abilities-breakdown',
            'mwi-ability-books-breakdown',
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
        const showExcluded = excl.total > 0;

        this.container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px;">
                <div style="cursor: pointer; font-weight: bold; flex: 1;" id="mwi-networth-toggle">
                    + Net Worth: ${totalNetworth}
                </div>
                ${
                    showChartBtn
                        ? `<span id="mwi-networth-chart-btn" title="Net Worth History Chart" style="
                    cursor: pointer;
                    font-size: 14px;
                    opacity: 0.7;
                    padding: 2px 4px;
                    border-radius: 3px;
                    line-height: 1;
                ">&#x1F4C8;</span>`
                        : ''
                }
                <span id="mwi-networth-exclusions-btn" title="Configure Net Worth Exclusions" style="
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
                    + Current Assets: ${networthFormatter(Math.round(ca.total))}
                </div>
                <div id="mwi-current-assets-details" style="display: none; margin-left: 20px;">
                    ${
                        showEquipped
                            ? `
                    <!-- Equipment Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipment-toggle">
                        + Equipment value: ${networthFormatter(Math.round(ca.equipped.value))}
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
                        + Inventory value: ${networthFormatter(Math.round(ca.inventory.value))}
                    </div>
                    <div id="mwi-inventory-breakdown" style="display: none; margin-left: 20px;">
                        ${this.renderInventoryBreakdown(ca.inventory.byCategory)}
                    </div>
                    `
                            : ''
                    }

                    ${
                        showListings
                            ? `
                    <!-- Market Listings -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-listings-toggle">
                        + Market listings: ${networthFormatter(Math.round(ca.listings.value))}
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
                    + Fixed Assets: ${networthFormatter(Math.round(fa.total))}
                </div>
                <div id="mwi-fixed-assets-details" style="display: none; margin-left: 20px;">
                    ${
                        showHouses
                            ? `
                    <!-- Houses -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-houses-toggle">
                        + Houses: ${networthFormatter(Math.round(fa.houses.totalCost))}
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
                        + Abilities: ${networthFormatter(Math.round(fa.abilities.totalCost))}
                    </div>
                    <div id="mwi-abilities-details" style="display: none; margin-left: 20px;">
                        <!-- Equipped Abilities -->
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipped-abilities-toggle">
                            + Equipped (${fa.abilities.equippedBreakdown.length}): ${networthFormatter(Math.round(fa.abilities.equippedCost))}
                        </div>
                        <div id="mwi-equipped-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilitiesBreakdown(fa.abilities.equippedBreakdown)}</div>

                        ${
                            fa.abilities.otherBreakdown.length > 0
                                ? `
                            <div style="cursor: pointer; margin-top: 4px;" id="mwi-other-abilities-toggle">
                                + Other (${fa.abilities.otherBreakdown.length}): ${networthFormatter(Math.round(fa.abilities.totalCost - fa.abilities.equippedCost))}
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
                            + Ability Books (${fa.abilityBooks.breakdown.length}): ${networthFormatter(Math.round(fa.abilityBooks.totalCost))}
                        </div>
                        <div id="mwi-ability-books-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilityBooksBreakdown(fa.abilityBooks.breakdown)}</div>
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
                    + Excluded: ${networthFormatter(Math.round(excl.total))}
                </div>
                <div id="mwi-excluded-details" style="display: none; margin-left: 20px; font-size: 0.8rem;">
                    ${excl.items
                        .map(
                            (item) => `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px; color: rgba(255,255,255,0.45);">
                            <span style="text-decoration: line-through;">${item.name}: ${networthFormatter(Math.round(item.amount))}</span>
                            <span class="mwi-excluded-remove" data-type="${item.type}" data-value="${item.value.replace(/"/g, '&quot;')}" style="cursor: pointer; color: rgba(255,100,100,0.7); margin-left: 8px; font-size: 0.75rem;" title="Remove exclusion">✕</span>
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
            return '<div>No houses built</div>';
        }

        return breakdown
            .map((house) => {
                return `${house.name} ${house.level}: ${networthFormatter(Math.round(house.cost))}`;
            })
            .join('\n');
    }

    /**
     * Render abilities breakdown HTML
     * @param {Array} breakdown - Array of {name, cost}
     * @returns {string} HTML string
     */
    renderAbilitiesBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return '<div>No abilities</div>';
        }

        return breakdown
            .map((ability) => {
                return `${ability.name}: ${networthFormatter(Math.round(ability.cost))}`;
            })
            .join('\n');
    }

    /**
     * Render ability books breakdown HTML
     * @param {Array} breakdown - Array of {name, value, count}
     * @returns {string} HTML string
     */
    renderAbilityBooksBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return '<div>No ability books</div>';
        }

        return breakdown
            .map((book) => {
                return `${book.name} (${formatKMB(book.count)}): ${networthFormatter(Math.round(book.value))}`;
            })
            .join('\n');
    }

    /**
     * Render equipment breakdown HTML
     * @param {Array} breakdown - Array of {name, value}
     * @returns {string} HTML string
     */
    renderEquipmentBreakdown(breakdown) {
        if (breakdown.length === 0) {
            return '<div>No equipment</div>';
        }

        return breakdown
            .map((item) => {
                return `${item.name}: ${networthFormatter(Math.round(item.value))}`;
            })
            .join('\n');
    }

    /**
     * Render market listings breakdown HTML
     * @param {Array} breakdown - Array of listing objects
     * @returns {string} HTML string
     */
    renderListingsBreakdown(breakdown) {
        if (!breakdown || breakdown.length === 0) {
            return '<div>No market listings</div>';
        }

        return breakdown
            .map((listing) => {
                const typeLabel = listing.isSell ? 'Sell' : 'Buy';
                return `${listing.name} (${typeLabel}): ${networthFormatter(Math.round(listing.value))}`;
            })
            .join('\n');
    }

    /**
     * Render inventory breakdown HTML (grouped by category)
     * @param {Object} byCategory - Object with category names as keys
     * @returns {string} HTML string
     */
    renderInventoryBreakdown(byCategory) {
        if (!byCategory || Object.keys(byCategory).length === 0) {
            return '<div>No inventory</div>';
        }

        // Sort categories by total value descending
        const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1].totalValue - a[1].totalValue);

        return sortedCategories
            .map(([categoryName, categoryData]) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                const categoryToggleId = `${categoryId}-toggle`;

                // Build items HTML
                const itemsHTML = categoryData.items
                    .map((item) => {
                        if (item.isOpenable && item.itemHrid) {
                            return this.renderOpenableItemRow(item);
                        }
                        return `<div>${item.name} x${formatKMB(item.count)}: ${networthFormatter(Math.round(item.value))}</div>`;
                    })
                    .join('');

                return `
                <div style="cursor: pointer; margin-top: 4px; font-size: 0.85rem;" id="${categoryToggleId}">
                    + ${categoryName}: ${networthFormatter(Math.round(categoryData.totalValue))}
                </div>
                <div id="${categoryId}" style="display: none; margin-left: 20px; font-size: 0.75rem; color: #999;">
                    ${itemsHTML}
                </div>
            `;
            })
            .join('');
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
            `Net Worth: ${networthFormatter(Math.round(networthData.totalNetworth))}`
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
                `Current Assets: ${networthFormatter(Math.round(ca.total))}`
            );
        }

        // Equipment toggle
        if (ca.equipped.value > 0) {
            this.setupToggle(
                'mwi-equipment-toggle',
                'mwi-equipment-breakdown',
                `Equipment value: ${networthFormatter(Math.round(ca.equipped.value))}`
            );
        }

        // Inventory toggle
        if (ca.inventory.value > 0) {
            this.setupToggle(
                'mwi-inventory-toggle',
                'mwi-inventory-breakdown',
                `Inventory value: ${networthFormatter(Math.round(ca.inventory.value))}`
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
                `Market listings: ${networthFormatter(Math.round(ca.listings.value))}`
            );
        }

        // Fixed assets toggle
        if (fa.total > 0) {
            this.setupToggle(
                'mwi-fixed-assets-toggle',
                'mwi-fixed-assets-details',
                `Fixed Assets: ${networthFormatter(Math.round(fa.total))}`
            );
        }

        // Houses toggle
        if (fa.houses.totalCost > 0) {
            this.setupToggle(
                'mwi-houses-toggle',
                'mwi-houses-breakdown',
                `Houses: ${networthFormatter(Math.round(fa.houses.totalCost))}`
            );
        }

        // Abilities toggle
        if (fa.abilities.totalCost > 0) {
            this.setupToggle(
                'mwi-abilities-toggle',
                'mwi-abilities-details',
                `Abilities: ${networthFormatter(Math.round(fa.abilities.totalCost))}`
            );

            // Equipped abilities toggle
            this.setupToggle(
                'mwi-equipped-abilities-toggle',
                'mwi-equipped-abilities-breakdown',
                `Equipped (${fa.abilities.equippedBreakdown.length}): ${networthFormatter(Math.round(fa.abilities.equippedCost))}`
            );

            // Other abilities toggle (if exists)
            if (fa.abilities.otherBreakdown.length > 0) {
                this.setupToggle(
                    'mwi-other-abilities-toggle',
                    'mwi-other-abilities-breakdown',
                    `Other Abilities: ${networthFormatter(Math.round(fa.abilities.totalCost - fa.abilities.equippedCost))}`
                );
            }
        }

        // Ability books toggle (if exists)
        if (fa.abilityBooks.breakdown.length > 0) {
            this.setupToggle(
                'mwi-ability-books-toggle',
                'mwi-ability-books-breakdown',
                `Ability Books: ${networthFormatter(Math.round(fa.abilityBooks.totalCost))}`
            );
        }

        // Excluded toggle
        if (excl.total > 0) {
            this.setupToggle(
                'mwi-excluded-toggle',
                'mwi-excluded-details',
                `Excluded: ${networthFormatter(Math.round(excl.total))}`
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
        const toggleId = `mwi-chest-${slug}-toggle`;
        const detailId = `mwi-chest-${slug}-detail`;

        const evData = expectedValueCalculator.isInitialized
            ? expectedValueCalculator.calculateExpectedValue(item.itemHrid)
            : null;

        let detailsHTML = '';
        if (evData) {
            const chestKeyHrid = DUNGEON_CHEST_CHEST_KEYS[item.itemHrid];
            let keyPrice = 0;
            let keyName = null;
            if (chestKeyHrid) {
                const setting = config.getSettingValue('profitCalc_keyPricingMode') || 'ask';
                const keyPrices = marketAPI.getPrice(chestKeyHrid);
                keyPrice = keyPrices?.[setting] ?? keyPrices?.ask ?? 0;
                keyName = dataManager.getItemDetails(chestKeyHrid)?.name;
            }
            detailsHTML = this.buildChestDropsHTML(evData, keyPrice, keyName);
        }

        return `
            <div id="${toggleId}" style="cursor: pointer; padding: 1px 0;">
                + ${item.name} x${formatKMB(item.count)}: ${networthFormatter(Math.round(item.value))}
            </div>
            <div id="${detailId}" style="display: none; margin-left: 16px; color: #bbb; margin-bottom: 2px;">
                ${detailsHTML}
            </div>`;
    }

    /**
     * Build the drop breakdown HTML for an expanded chest row
     * @param {Object} evData - Expected value data from expectedValueCalculator
     * @param {number} keyPrice - Chest key market price (0 for non-dungeon chests)
     * @param {string|null} keyName - Chest key item name
     * @returns {string} HTML string
     */
    buildChestDropsHTML(evData, keyPrice, keyName) {
        let html = `<div>EV: ${networthFormatter(Math.round(evData.expectedValue))}/chest</div>`;
        if (keyPrice > 0) {
            const label = keyName ? `Key (${keyName})` : 'Key Cost';
            html += `<div>\u2212 ${label}: ${networthFormatter(Math.round(keyPrice))}</div>`;
            html += `<div>Net: ${networthFormatter(Math.round(evData.expectedValue - keyPrice))}/chest</div>`;
        }
        const pricedDrops = evData.drops.filter((d) => d.hasPriceData);
        if (pricedDrops.length > 0) {
            html += '<div style="margin-top: 3px;">';
            for (const drop of pricedDrops) {
                const pct = (drop.dropRate * 100).toFixed(1);
                html += `<div>\u2022 ${drop.itemName} (${pct}%): ${networthFormatter(Math.round(drop.expectedValue))}</div>`;
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
