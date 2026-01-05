/**
 * Networth Display Components
 * Handles UI rendering for networth in two locations:
 * 1. Header (top right) - Current Assets: Ask / Bid
 * 2. Inventory Panel - Detailed breakdown with collapsible sections
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { networthFormatter } from '../../utils/formatters.js';

/**
 * Header Display Component
 * Shows "Current Assets: Ask / Bid" next to total level
 */
class NetworthHeaderDisplay {
    constructor() {
        this.container = null;
        this.unregisterHandlers = [];
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
        const unregister = domObserver.onClass(
            'NetworthHeader',
            'Header_totalLevel',
            (elem) => {
                this.renderHeader(elem);
            }
        );
        this.unregisterHandlers.push(unregister);
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
            color: ${config.SCRIPT_COLOR_MAIN};
            text-wrap: nowrap;
        `;

        // Insert after total level
        totalLevelElem.insertAdjacentElement('afterend', this.container);

        // Initial render with loading state
        this.container.textContent = 'Current Assets: Loading...';
    }

    /**
     * Update header with networth data
     * @param {Object} networthData - Networth data from calculator
     */
    update(networthData) {
        if (!this.container || !document.body.contains(this.container)) {
            return;
        }

        const { currentAssets } = networthData;
        const valueFormatted = networthFormatter(Math.round(currentAssets.total));

        this.container.textContent = `Current Assets: ${valueFormatted}`;
    }

    /**
     * Disable and cleanup
     */
    disable() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];
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
        const unregister = domObserver.onClass(
            'NetworthInv',
            'Inventory_items',
            (elem) => {
                this.renderPanel(elem);
            }
        );
        this.unregisterHandlers.push(unregister);
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
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.875rem;
            margin-bottom: 12px;
        `;

        // Insert before inventory items
        inventoryElem.insertAdjacentElement('beforebegin', this.container);

        // Initial render with loading state or current data
        if (this.currentData) {
            this.update(this.currentData);
        } else {
            this.container.innerHTML = `
                <div style="font-weight: bold; cursor: pointer;">
                    + Total Networth: Loading...
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
            'mwi-ability-books-breakdown'
        ];

        // Also preserve inventory category states
        const inventoryCategories = Object.keys(networthData.currentAssets.inventory.byCategory || {});
        inventoryCategories.forEach(categoryName => {
            const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
            sectionsToPreserve.push(categoryId);
        });

        sectionsToPreserve.forEach(id => {
            const elem = this.container.querySelector(`#${id}`);
            if (elem) {
                expandedStates[id] = elem.style.display !== 'none';
            }
        });

        const totalNetworth = networthFormatter(Math.round(networthData.totalNetworth));

        this.container.innerHTML = `
            <div style="cursor: pointer; font-weight: bold;" id="mwi-networth-toggle">
                + Total Networth: ${totalNetworth}
            </div>
            <div id="mwi-networth-details" style="display: none; margin-left: 20px;">
                <!-- Current Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-current-assets-toggle">
                    + Current Assets: ${networthFormatter(Math.round(networthData.currentAssets.total))}
                </div>
                <div id="mwi-current-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Equipment Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipment-toggle">
                        + Equipment value: ${networthFormatter(Math.round(networthData.currentAssets.equipped.value))}
                    </div>
                    <div id="mwi-equipment-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                        ${this.renderEquipmentBreakdown(networthData.currentAssets.equipped.breakdown)}
                    </div>

                    <!-- Inventory Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-inventory-toggle">
                        + Inventory value: ${networthFormatter(Math.round(networthData.currentAssets.inventory.value))}
                    </div>
                    <div id="mwi-inventory-breakdown" style="display: none; margin-left: 20px;">
                        ${this.renderInventoryBreakdown(networthData.currentAssets.inventory.byCategory)}
                    </div>

                    <div style="margin-top: 4px;">Market listings: ${networthFormatter(Math.round(networthData.currentAssets.listings.value))}</div>
                </div>

                <!-- Fixed Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-fixed-assets-toggle">
                    + Fixed Assets: ${networthFormatter(Math.round(networthData.fixedAssets.total))}
                </div>
                <div id="mwi-fixed-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Houses -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-houses-toggle">
                        + Houses: ${networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}
                    </div>
                    <div id="mwi-houses-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                        ${this.renderHousesBreakdown(networthData.fixedAssets.houses.breakdown)}
                    </div>

                    <!-- Abilities -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-abilities-toggle">
                        + Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}
                    </div>
                    <div id="mwi-abilities-details" style="display: none; margin-left: 20px;">
                        <!-- Equipped Abilities -->
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipped-abilities-toggle">
                            + Equipped (${networthData.fixedAssets.abilities.equippedBreakdown.length}): ${networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}
                        </div>
                        <div id="mwi-equipped-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                            ${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.equippedBreakdown)}
                        </div>

                        <!-- Other Abilities -->
                        ${networthData.fixedAssets.abilities.otherBreakdown.length > 0 ? `
                            <div style="cursor: pointer; margin-top: 4px;" id="mwi-other-abilities-toggle">
                                + Other Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}
                            </div>
                            <div id="mwi-other-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                                ${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.otherBreakdown)}
                            </div>
                        ` : ''}
                    </div>

                    <!-- Ability Books -->
                    ${networthData.fixedAssets.abilityBooks.breakdown.length > 0 ? `
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-ability-books-toggle">
                            + Ability Books: ${networthFormatter(Math.round(networthData.fixedAssets.abilityBooks.totalCost))}
                        </div>
                        <div id="mwi-ability-books-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                            ${this.renderAbilityBooksBreakdown(networthData.fixedAssets.abilityBooks.breakdown)}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Restore expand/collapse states after updating
        sectionsToPreserve.forEach(id => {
            const elem = this.container.querySelector(`#${id}`);
            if (elem && expandedStates[id]) {
                elem.style.display = 'block';

                // Update the corresponding toggle button text (+ to -)
                const toggleId = id.replace('-details', '-toggle')
                                   .replace('-breakdown', '-toggle');
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

        return breakdown.map(house =>
            `<div style="display: block; margin-bottom: 2px; white-space: nowrap;">${house.name} ${house.level}: ${networthFormatter(Math.round(house.cost))}</div>`
        ).join('\n');
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

        return breakdown.map(ability =>
            `<div style="display: block; margin-bottom: 2px; white-space: nowrap;">${ability.name}: ${networthFormatter(Math.round(ability.cost))}</div>`
        ).join('\n');
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

        return breakdown.map(book => {
            return `<div style="display: block; margin-bottom: 2px; white-space: nowrap;">${book.name} (${book.count}): ${networthFormatter(Math.round(book.value))}</div>`;
        }).join('\n');
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

        return breakdown.map(item =>
            `<div style="display: block; margin-bottom: 2px; white-space: nowrap;">${item.name}: ${networthFormatter(Math.round(item.value))}</div>`
        ).join('\n');
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
        const sortedCategories = Object.entries(byCategory)
            .sort((a, b) => b[1].totalValue - a[1].totalValue);

        return sortedCategories.map(([categoryName, categoryData]) => {
            const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
            const categoryToggleId = `${categoryId}-toggle`;

            return `
                <div style="cursor: pointer; margin-top: 4px; font-size: 0.85rem;" id="${categoryToggleId}">
                    + ${categoryName}: ${networthFormatter(Math.round(categoryData.totalValue))}
                </div>
                <div id="${categoryId}" style="display: none; margin-left: 20px; font-size: 0.75rem; color: #999;">
                    ${categoryData.items.map(item =>
                        `<div style="display: block; margin-bottom: 2px; white-space: nowrap;">${item.name} x${item.count}: ${networthFormatter(Math.round(item.value))}</div>`
                    ).join('\n')}
                </div>
            `;
        }).join('');
    }

    /**
     * Set up toggle event listeners
     * @param {Object} networthData - Networth data
     */
    setupToggleListeners(networthData) {
        // Main networth toggle
        this.setupToggle(
            'mwi-networth-toggle',
            'mwi-networth-details',
            `Total Networth: ${networthFormatter(Math.round(networthData.totalNetworth))}`
        );

        // Current assets toggle
        this.setupToggle(
            'mwi-current-assets-toggle',
            'mwi-current-assets-details',
            `Current Assets: ${networthFormatter(Math.round(networthData.currentAssets.total))}`
        );

        // Equipment toggle
        this.setupToggle(
            'mwi-equipment-toggle',
            'mwi-equipment-breakdown',
            `Equipment value: ${networthFormatter(Math.round(networthData.currentAssets.equipped.value))}`
        );

        // Inventory toggle
        this.setupToggle(
            'mwi-inventory-toggle',
            'mwi-inventory-breakdown',
            `Inventory value: ${networthFormatter(Math.round(networthData.currentAssets.inventory.value))}`
        );

        // Inventory category toggles
        const byCategory = networthData.currentAssets.inventory.byCategory || {};
        Object.entries(byCategory).forEach(([categoryName, categoryData]) => {
            const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
            const categoryToggleId = `${categoryId}-toggle`;
            this.setupToggle(
                categoryToggleId,
                categoryId,
                `${categoryName}: ${networthFormatter(Math.round(categoryData.totalValue))}`
            );
        });

        // Fixed assets toggle
        this.setupToggle(
            'mwi-fixed-assets-toggle',
            'mwi-fixed-assets-details',
            `Fixed Assets: ${networthFormatter(Math.round(networthData.fixedAssets.total))}`
        );

        // Houses toggle
        this.setupToggle(
            'mwi-houses-toggle',
            'mwi-houses-breakdown',
            `Houses: ${networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}`
        );

        // Abilities toggle
        this.setupToggle(
            'mwi-abilities-toggle',
            'mwi-abilities-details',
            `Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}`
        );

        // Equipped abilities toggle
        this.setupToggle(
            'mwi-equipped-abilities-toggle',
            'mwi-equipped-abilities-breakdown',
            `Equipped (${networthData.fixedAssets.abilities.equippedBreakdown.length}): ${networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}`
        );

        // Other abilities toggle (if exists)
        if (networthData.fixedAssets.abilities.otherBreakdown.length > 0) {
            this.setupToggle(
                'mwi-other-abilities-toggle',
                'mwi-other-abilities-breakdown',
                `Other Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}`
            );
        }

        // Ability books toggle (if exists)
        if (networthData.fixedAssets.abilityBooks.breakdown.length > 0) {
            this.setupToggle(
                'mwi-ability-books-toggle',
                'mwi-ability-books-breakdown',
                `Ability Books: ${networthFormatter(Math.round(networthData.fixedAssets.abilityBooks.totalCost))}`
            );
        }
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
     * Disable and cleanup
     */
    disable() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];
        this.currentData = null;
    }
}

// Export both display components
export const networthHeaderDisplay = new NetworthHeaderDisplay();
export const networthInventoryDisplay = new NetworthInventoryDisplay();
