/**
 * Inventory Sort Module
 * Sorts inventory items by Ask/Bid price with optional stack value badges
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { formatKMB } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';

/**
 * InventorySort class manages inventory sorting and price badges
 */
class InventorySort {
    constructor() {
        this.currentMode = 'none'; // 'ask', 'bid', 'none'
        this.unregisterHandlers = [];
        this.controlsContainer = null;
        this.currentInventoryElem = null;
        this.warnedItems = new Set(); // Track items we've already warned about
    }

    /**
     * Initialize inventory sort feature
     */
    initialize() {
        if (!config.getSetting('invSort')) {
            return;
        }

        // Prevent multiple initializations
        if (this.unregisterHandlers.length > 0) {
            return;
        }

        // Load persisted settings
        this.loadSettings();

        // Check if inventory is already open
        const existingInv = document.querySelector('[class*="Inventory_items"]');
        if (existingInv) {
            this.currentInventoryElem = existingInv;
            this.injectSortControls(existingInv);
            this.applyCurrentSort();
        }

        // Watch for inventory panel (for future opens/reloads)
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

        // Watch for any DOM changes to re-calculate prices and badges
        const badgeRefreshUnregister = domObserver.register(
            'InventorySort-BadgeRefresh',
            () => {
                // Only refresh if inventory is currently visible
                if (this.currentInventoryElem) {
                    this.applyCurrentSort();
                }
            },
            { debounce: true, debounceDelay: 100 }
        );
        this.unregisterHandlers.push(badgeRefreshUnregister);

        // Listen for market data updates to refresh badges
        this.setupMarketDataListener();

    }

    /**
     * Setup listener for market data updates
     */
    setupMarketDataListener() {
        // If market data isn't loaded yet, retry periodically
        if (!marketAPI.isLoaded()) {

            let retryCount = 0;
            const maxRetries = 10;
            const retryInterval = 500; // 500ms between retries

            const retryCheck = setInterval(() => {
                retryCount++;

                if (marketAPI.isLoaded()) {
                    clearInterval(retryCheck);

                    // Refresh if inventory is still open
                    if (this.currentInventoryElem) {
                        this.applyCurrentSort();
                    }
                } else if (retryCount >= maxRetries) {
                    console.warn('[InventorySort] Market data still not available after', maxRetries, 'retries');
                    clearInterval(retryCheck);
                }
            }, retryInterval);
        } else {
        }
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
                mode: this.currentMode
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
        // Set current inventory element
        this.currentInventoryElem = inventoryElem;

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

        // Assemble controls
        this.controlsContainer.appendChild(sortLabel);
        this.controlsContainer.appendChild(askButton);
        this.controlsContainer.appendChild(bidButton);
        this.controlsContainer.appendChild(noneButton);

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
            const categoryButton = categoryDiv.querySelector('[class*="Inventory_categoryButton"]');
            if (!categoryButton) continue;

            const categoryName = categoryButton.textContent.trim();

            // Skip categories that shouldn't be sorted or badged
            const excludedCategories = ['Loots', 'Currencies'];
            if (excludedCategories.includes(categoryName)) {
                continue;
            }

            // Equipment category: only process charms (for badges), don't sort
            const isEquipmentCategory = categoryName === 'Equipment';
            const shouldSort = !isEquipmentCategory;

            // Ensure category label stays at top
            const label = categoryDiv.querySelector('[class*="Inventory_label"]');
            if (label) {
                label.style.order = Number.MIN_SAFE_INTEGER;
            }

            // Get all item elements
            const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');

            // Always calculate prices (for badges), filtering to charms only in Equipment category
            this.calculateItemPrices(itemElems, isEquipmentCategory);

            if (shouldSort && this.currentMode !== 'none') {
                // Sort by price (skip sorting for Equipment category)
                this.sortItemsByPrice(itemElems, this.currentMode);
            } else {
                // Reset to default order
                itemElems.forEach(itemElem => {
                    itemElem.style.order = 0;
                });
            }
        }

        // Update price badges (controlled by global setting)
        this.updatePriceBadges();
    }

    /**
     * Calculate and store prices for all items (for badges and sorting)
     * @param {NodeList} itemElems - Item elements
     * @param {boolean} isEquipmentCategory - True if processing Equipment category (only charms)
     */
    calculateItemPrices(itemElems, isEquipmentCategory = false) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            console.warn('[InventorySort] Game data not available yet');
            return;
        }

        let marketDataMissing = false;

        for (const itemElem of itemElems) {
            // Get item HRID from SVG aria-label
            const svg = itemElem.querySelector('svg');
            if (!svg) continue;

            let itemName = svg.getAttribute('aria-label');
            if (!itemName) continue;

            // Find item HRID
            const itemHrid = this.findItemHrid(itemName, gameData);
            if (!itemHrid) {
                console.warn('[InventorySort] Could not find HRID for item:', itemName);
                continue;
            }

            // In Equipment category, only process charms
            if (isEquipmentCategory) {
                const itemDetails = gameData.itemDetailMap[itemHrid];
                const isCharm = itemDetails?.equipmentDetail?.type === '/equipment_types/charm';
                if (!isCharm) {
                    // Not a charm, skip this equipment item
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                    continue;
                }

                // Skip trainee charms (untradeable, no market data)
                if (itemHrid.includes('trainee_')) {
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                    continue;
                }
            }

            // Get item count
            const countElem = itemElem.querySelector('[class*="Item_count"]');
            if (!countElem) continue;

            let itemCount = countElem.textContent;
            itemCount = this.parseItemCount(itemCount);

            // Get market price
            const marketPrice = marketAPI.getPrice(itemHrid, 0);
            if (!marketPrice) {
                // Only warn once per item to avoid console spam
                if (!this.warnedItems.has(itemHrid)) {
                    console.warn('[InventorySort] No market data for:', itemName, itemHrid);
                    this.warnedItems.add(itemHrid);
                }
                itemElem.dataset.askValue = 0;
                itemElem.dataset.bidValue = 0;
                marketDataMissing = true;
                continue;
            }

            // Store both ask and bid values
            const askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
            const bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;

            // Removed zero-price warning to reduce console spam
            // Non-zero prices are normal for many items

            itemElem.dataset.askValue = askPrice * itemCount;
            itemElem.dataset.bidValue = bidPrice * itemCount;
        }

        // Summary warning removed - individual items already warn once per session
    }

    /**
     * Sort items by price (ask or bid)
     * @param {NodeList} itemElems - Item elements
     * @param {string} mode - 'ask' or 'bid'
     */
    sortItemsByPrice(itemElems, mode) {
        // Convert NodeList to array with values
        const items = Array.from(itemElems).map(elem => ({
            elem,
            value: parseFloat(elem.dataset[mode + 'Value']) || 0
        }));

        // Sort by value descending (highest first)
        items.sort((a, b) => b.value - a.value);

        // Assign sequential order values (0, 1, 2, 3...)
        items.forEach((item, index) => {
            item.elem.style.order = index;
        });
    }

    /**
     * Update price badges on all items
     */
    updatePriceBadges() {
        if (!this.currentInventoryElem) return;

        const itemElems = this.currentInventoryElem.querySelectorAll('[class*="Item_itemContainer"]');

        // Determine if badges should be shown and which value to use
        let showBadges = false;
        let badgeValueKey = null;

        if (this.currentMode === 'none') {
            // When sort mode is 'none', check invSort_badgesOnNone setting
            const badgesOnNone = config.getSettingValue('invSort_badgesOnNone', 'None');
            if (badgesOnNone !== 'None') {
                showBadges = true;
                badgeValueKey = badgesOnNone.toLowerCase() + 'Value'; // 'askValue' or 'bidValue'
            }
        } else {
            // When sort mode is 'ask' or 'bid', check invSort_showBadges setting
            const showBadgesSetting = config.getSetting('invSort_showBadges');
            if (showBadgesSetting) {
                showBadges = true;
                badgeValueKey = this.currentMode + 'Value'; // 'askValue' or 'bidValue'
            }
        }

        for (const itemElem of itemElems) {
            // Remove existing badge
            const existingBadge = itemElem.querySelector('.mwi-stack-price');
            if (existingBadge) {
                existingBadge.remove();
            }

            // Show badges if enabled
            if (showBadges && badgeValueKey) {
                const stackValue = parseFloat(itemElem.dataset[badgeValueKey]) || 0;

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
            top: 2px;
            left: 2px;
            z-index: 1;
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: left;
            pointer-events: none;
        `;
        badge.textContent = formatKMB(Math.round(stackValue), 0);

        // Insert into item
        const itemInner = itemElem.querySelector('[class*="Item_item"]');
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
     * Refresh badges (called when badge setting changes)
     */
    refresh() {
        this.updatePriceBadges();
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
