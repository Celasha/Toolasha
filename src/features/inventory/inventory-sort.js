/**
 * Inventory Sort Module
 * Sorts inventory items by Ask/Bid price with optional stack value badges
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { networthFormatter } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';

/**
 * InventorySort class manages inventory sorting and price badges
 */
class InventorySort {
    constructor() {
        this.currentMode = 'none'; // 'ask', 'bid', 'none'
        this.showBadges = false;
        this.unregisterHandlers = [];
        this.controlsContainer = null;
        this.currentInventoryElem = null;
    }

    /**
     * Initialize inventory sort feature
     */
    initialize() {
        if (!config.getSetting('invSort')) {
            return;
        }

        // Load persisted settings
        this.loadSettings();

        // Watch for inventory panel
        const unregister = domObserver.onClass(
            'InventorySort',
            'Inventory_items',
            (elem) => {
                this.currentInventoryElem = elem;
                this.injectSortControls(elem);
                this.applyCurrentSort();
            }
        );
        this.unregisterHandlers.push(unregister);

        console.log('[InventorySort] Initialized');
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const saved = localStorage.getItem('toolasha_inventory_sort');
            if (saved) {
                const settings = JSON.parse(saved);
                this.currentMode = settings.mode || 'none';
                this.showBadges = settings.showBadges || false;
            }
        } catch (error) {
            console.error('[InventorySort] Failed to load settings:', error);
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            localStorage.setItem('toolasha_inventory_sort', JSON.stringify({
                mode: this.currentMode,
                showBadges: this.showBadges
            }));
        } catch (error) {
            console.error('[InventorySort] Failed to save settings:', error);
        }
    }

    /**
     * Inject sort controls into inventory panel
     * @param {Element} inventoryElem - Inventory items container
     */
    injectSortControls(inventoryElem) {
        // Check if controls already exist
        if (this.controlsContainer && document.body.contains(this.controlsContainer)) {
            return;
        }

        // Create controls container
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'mwi-inventory-sort-controls';
        this.controlsContainer.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.875rem;
            text-align: left;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        `;

        // Sort label and buttons
        const sortLabel = document.createElement('span');
        sortLabel.textContent = 'Sort: ';

        const askButton = this.createSortButton('Ask', 'ask');
        const bidButton = this.createSortButton('Bid', 'bid');
        const noneButton = this.createSortButton('None', 'none');

        // Badge toggle checkbox
        const badgeContainer = document.createElement('label');
        badgeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            margin-left: 12px;
        `;

        const badgeCheckbox = document.createElement('input');
        badgeCheckbox.type = 'checkbox';
        badgeCheckbox.checked = this.showBadges;
        badgeCheckbox.style.cursor = 'pointer';
        badgeCheckbox.addEventListener('change', (e) => {
            this.showBadges = e.target.checked;
            this.saveSettings();
            this.updatePriceBadges();
        });

        const badgeLabel = document.createElement('span');
        badgeLabel.textContent = 'Show Stack Value';

        badgeContainer.appendChild(badgeCheckbox);
        badgeContainer.appendChild(badgeLabel);

        // Assemble controls
        this.controlsContainer.appendChild(sortLabel);
        this.controlsContainer.appendChild(askButton);
        this.controlsContainer.appendChild(bidButton);
        this.controlsContainer.appendChild(noneButton);
        this.controlsContainer.appendChild(badgeContainer);

        // Insert before inventory
        inventoryElem.insertAdjacentElement('beforebegin', this.controlsContainer);

        // Update button states
        this.updateButtonStates();
    }

    /**
     * Create a sort button
     * @param {string} label - Button label
     * @param {string} mode - Sort mode
     * @returns {Element} Button element
     */
    createSortButton(label, mode) {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.mode = mode;
        button.style.cssText = `
            border-radius: 3px;
            padding: 4px 12px;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        `;

        button.addEventListener('click', () => {
            this.setSortMode(mode);
        });

        return button;
    }

    /**
     * Update button visual states based on current mode
     */
    updateButtonStates() {
        if (!this.controlsContainer) return;

        const buttons = this.controlsContainer.querySelectorAll('button');
        buttons.forEach(button => {
            const isActive = button.dataset.mode === this.currentMode;

            if (isActive) {
                button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
                button.style.color = 'black';
                button.style.fontWeight = 'bold';
            } else {
                button.style.backgroundColor = '#444';
                button.style.color = '#ccc';
                button.style.fontWeight = 'normal';
            }
        });
    }

    /**
     * Set sort mode and apply sorting
     * @param {string} mode - Sort mode ('ask', 'bid', 'none')
     */
    setSortMode(mode) {
        this.currentMode = mode;
        this.saveSettings();
        this.updateButtonStates();
        this.applyCurrentSort();
    }

    /**
     * Apply current sort mode to inventory
     */
    applyCurrentSort() {
        if (!this.currentInventoryElem) return;

        const inventoryElem = this.currentInventoryElem;

        // Process each category
        for (const categoryDiv of inventoryElem.children) {
            // Get category name
            const categoryButton = categoryDiv.querySelector('.Inventory_categoryButton__35s1x');
            if (!categoryButton) continue;

            const categoryName = categoryButton.textContent.trim();

            // Skip categories that shouldn't be sorted
            const excludedCategories = ['Loots', 'Currencies', 'Equipment'];
            if (excludedCategories.includes(categoryName)) {
                continue;
            }

            // Ensure category label stays at top
            const label = categoryDiv.querySelector('.Inventory_label__XEOAx');
            if (label) {
                label.style.order = Number.MIN_SAFE_INTEGER;
            }

            // Get all item elements
            const itemElems = categoryDiv.querySelectorAll('.Item_itemContainer__x7kH1');

            if (this.currentMode === 'none') {
                // Reset to default order
                itemElems.forEach(itemElem => {
                    itemElem.style.order = '0';
                });
            } else {
                // Sort by price
                this.sortItemsByPrice(itemElems, this.currentMode);
            }
        }

        // Update price badges
        this.updatePriceBadges();
    }

    /**
     * Sort items by price (ask or bid)
     * @param {NodeList} itemElems - Item elements
     * @param {string} mode - 'ask' or 'bid'
     */
    sortItemsByPrice(itemElems, mode) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        for (const itemElem of itemElems) {
            // Get item HRID from SVG aria-label
            const svg = itemElem.querySelector('svg');
            if (!svg) continue;

            let itemName = svg.getAttribute('aria-label');
            if (!itemName) continue;

            // Find item HRID
            const itemHrid = this.findItemHrid(itemName, gameData);
            if (!itemHrid) continue;

            // Get item count
            const countElem = itemElem.querySelector('.Item_count__1HVvv');
            if (!countElem) continue;

            let itemCount = countElem.textContent;
            itemCount = this.parseItemCount(itemCount);

            // Get market price
            const marketPrice = marketAPI.getPrice(itemHrid, 0);
            if (!marketPrice) {
                itemElem.style.order = '0';
                continue;
            }

            const price = mode === 'ask' ? marketPrice.ask : marketPrice.bid;
            if (price <= 0) {
                itemElem.style.order = '0';
                continue;
            }

            const stackValue = price * itemCount;

            // Set order (negative for descending sort)
            itemElem.style.order = -stackValue;

            // Store value for badge rendering
            itemElem.dataset.stackValue = stackValue;
        }
    }

    /**
     * Update price badges on all items
     */
    updatePriceBadges() {
        if (!this.currentInventoryElem) return;

        const itemElems = this.currentInventoryElem.querySelectorAll('.Item_itemContainer__x7kH1');

        for (const itemElem of itemElems) {
            // Remove existing badge
            const existingBadge = itemElem.querySelector('.mwi-stack-price');
            if (existingBadge) {
                existingBadge.remove();
            }

            // Only show badges if enabled and sorting by price
            if (this.showBadges && this.currentMode !== 'none') {
                const stackValue = parseFloat(itemElem.dataset.stackValue);
                if (stackValue > 0) {
                    this.renderPriceBadge(itemElem, stackValue);
                }
            }
        }
    }

    /**
     * Render price badge on item
     * @param {Element} itemElem - Item container element
     * @param {number} stackValue - Total stack value
     */
    renderPriceBadge(itemElem, stackValue) {
        // Ensure item has relative positioning
        itemElem.style.position = 'relative';

        // Create badge element
        const badge = document.createElement('div');
        badge.className = 'mwi-stack-price';
        badge.style.cssText = `
            position: absolute;
            bottom: 2px;
            left: 2px;
            z-index: 1;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.7rem;
            font-weight: bold;
            pointer-events: none;
        `;
        badge.textContent = networthFormatter(Math.round(stackValue));

        // Insert into item
        const itemInner = itemElem.querySelector('.Item_item__2De2O');
        if (itemInner) {
            itemInner.appendChild(badge);
        }
    }

    /**
     * Find item HRID from item name
     * @param {string} itemName - Item display name
     * @param {Object} gameData - Game data
     * @returns {string|null} Item HRID
     */
    findItemHrid(itemName, gameData) {
        // Direct lookup in itemDetailMap
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            if (item.name === itemName) {
                return hrid;
            }
        }
        return null;
    }

    /**
     * Parse item count from text (handles K, M suffixes)
     * @param {string} text - Count text
     * @returns {number} Numeric count
     */
    parseItemCount(text) {
        text = text.toLowerCase().trim();

        if (text.includes('k')) {
            return parseFloat(text.replace('k', '')) * 1000;
        } else if (text.includes('m')) {
            return parseFloat(text.replace('m', '')) * 1000000;
        } else {
            return parseFloat(text) || 0;
        }
    }

    /**
     * Disable and cleanup
     */
    disable() {
        // Remove controls
        if (this.controlsContainer) {
            this.controlsContainer.remove();
            this.controlsContainer = null;
        }

        // Remove all badges
        const badges = document.querySelectorAll('.mwi-stack-price');
        badges.forEach(badge => badge.remove());

        // Unregister observers
        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];

        this.currentInventoryElem = null;
    }
}

// Create and export singleton instance
const inventorySort = new InventorySort();

export default inventorySort;
