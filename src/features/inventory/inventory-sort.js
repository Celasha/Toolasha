/**
 * Inventory Sort Module
 * Sorts inventory items by Ask/Bid price with optional stack value badges
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import storage from '../../core/storage.js';
import { formatKMB } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import inventoryBadgeManager from './inventory-badge-manager.js';

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
        this.isCalculating = false; // Guard flag to prevent recursive calls
        this.isInitialized = false;
        this.itemsUpdatedHandler = null;
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('invSort', async (value) => {
            if (value) {
                await this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize inventory sort feature
     */
    async initialize() {
        if (!config.getSetting('invSort')) {
            return;
        }

        // Prevent multiple initializations
        if (this.unregisterHandlers.length > 0) {
            return;
        }

        // Load persisted settings
        await this.loadSettings();

        // Check if inventory is already open
        const existingInv = document.querySelector('[class*="Inventory_items"]');
        if (existingInv) {
            this.currentInventoryElem = existingInv;
            this.injectSortControls(existingInv);
            this.applyCurrentSort();
        }

        // Watch for inventory panel (for future opens/reloads)
        const unregister = domObserver.onClass('InventorySort', 'Inventory_items', (elem) => {
            this.currentInventoryElem = elem;
            this.injectSortControls(elem);
            this.applyCurrentSort();
        });
        this.unregisterHandlers.push(unregister);

        // Register with badge manager for coordinated rendering
        inventoryBadgeManager.registerProvider(
            'inventory-stack-price',
            (itemElem) => this.renderBadgesForItem(itemElem),
            50 // Priority: render before bid/ask badges (lower = earlier)
        );

        // Store handler reference for cleanup
        this.itemsUpdatedHandler = () => {
            if (this.currentInventoryElem) {
                this.applyCurrentSort();
            }
        };

        // Listen for inventory changes to recalculate prices
        dataManager.on('items_updated', this.itemsUpdatedHandler);

        // Listen for market data updates to refresh badges
        this.setupMarketDataListener();

        this.isInitialized = true;
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
        }
    }

    /**
     * Load settings from storage
     */
    async loadSettings() {
        try {
            const settings = await storage.getJSON('inventorySort', 'settings');
            if (settings && settings.mode) {
                this.currentMode = settings.mode;
            }
        } catch (error) {
            console.error('[InventorySort] Failed to load settings:', error);
        }
    }

    /**
     * Save settings to storage
     */
    saveSettings() {
        try {
            storage.setJSON(
                'inventorySort',
                {
                    mode: this.currentMode,
                },
                'settings',
                true // immediate write for user preference
            );
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
            color: ${config.COLOR_ACCENT};
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
        buttons.forEach((button) => {
            const isActive = button.dataset.mode === this.currentMode;

            if (isActive) {
                button.style.backgroundColor = config.COLOR_ACCENT;
                button.style.color = 'black';
                button.style.fontWeight = 'bold';
            } else {
                button.style.backgroundColor = '#444';
                button.style.color = '${config.COLOR_TEXT_SECONDARY}';
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

        // Clear badge manager's processed tracking to force re-render with new mode
        inventoryBadgeManager.clearProcessedTracking();

        // Remove all existing stack price badges so they can be recreated with new settings
        const badges = document.querySelectorAll('.mwi-stack-price');
        badges.forEach((badge) => badge.remove());

        this.applyCurrentSort();
    }

    /**
     * Apply current sort mode to inventory
     */
    async applyCurrentSort() {
        if (!this.currentInventoryElem) return;

        // Prevent recursive calls (guard against DOM observer triggering during calculation)
        if (this.isCalculating) return;
        this.isCalculating = true;

        const inventoryElem = this.currentInventoryElem;

        // Trigger badge manager to calculate prices and render badges
        await inventoryBadgeManager.renderAllBadges();

        // Process each category
        for (const categoryDiv of inventoryElem.children) {
            // Get category name
            const categoryButton = categoryDiv.querySelector('[class*="Inventory_categoryButton"]');
            if (!categoryButton) continue;

            const categoryName = categoryButton.textContent.trim();

            // Equipment category: check setting for whether to enable sorting
            // Loots category: always disable sorting (but allow badges)
            const isEquipmentCategory = categoryName === 'Equipment';
            const isLootsCategory = categoryName === 'Loots';
            const shouldSort = isLootsCategory
                ? false
                : isEquipmentCategory
                  ? config.getSetting('invSort_sortEquipment')
                  : true;

            // Ensure category label stays at top
            const label = categoryDiv.querySelector('[class*="Inventory_label"]');
            if (label) {
                label.style.order = Number.MIN_SAFE_INTEGER;
            }

            // Get all item elements
            const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');

            if (shouldSort && this.currentMode !== 'none') {
                // Sort by price (prices already calculated by badge manager)
                this.sortItemsByPrice(itemElems, this.currentMode);
            } else {
                // Reset to default order
                itemElems.forEach((itemElem) => {
                    itemElem.style.order = 0;
                });
            }
        }

        // Clear guard flag
        this.isCalculating = false;
    }

    /**
     * Sort items by price (ask or bid)
     * @param {NodeList} itemElems - Item elements
     * @param {string} mode - 'ask' or 'bid'
     */
    sortItemsByPrice(itemElems, mode) {
        // Convert NodeList to array with values
        const items = Array.from(itemElems).map((elem) => ({
            elem,
            value: parseFloat(elem.dataset[mode + 'Value']) || 0,
        }));

        // Sort by value descending (highest first)
        items.sort((a, b) => b.value - a.value);

        // Assign sequential order values (0, 1, 2, 3...)
        items.forEach((item, index) => {
            item.elem.style.order = index;
        });
    }

    /**
     * Render stack price badge for a single item (called by badge manager)
     * @param {Element} itemElem - Item container element
     */
    renderBadgesForItem(itemElem) {
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

        // Show badge if enabled and doesn't already exist
        if (showBadges && badgeValueKey) {
            const stackValue = parseFloat(itemElem.dataset[badgeValueKey]) || 0;

            if (stackValue > 0 && !itemElem.querySelector('.mwi-stack-price')) {
                this.renderPriceBadge(itemElem, stackValue);
            }
        }
    }

    /**
     * Update price badges on all items (legacy method - now delegates to manager)
     */
    updatePriceBadges() {
        inventoryBadgeManager.renderAllBadges();
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
            right: 2px;
            z-index: 1;
            color: ${config.COLOR_ACCENT};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: right;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
        `;
        badge.textContent = formatKMB(stackValue, 2);

        // Insert into item
        const itemInner = itemElem.querySelector('[class*="Item_item"]');
        if (itemInner) {
            itemInner.appendChild(badge);
        }
    }

    /**
     * Refresh badges (called when badge setting changes)
     */
    refresh() {
        // Update controls container color
        if (this.controlsContainer) {
            this.controlsContainer.style.color = config.COLOR_ACCENT;
        }

        // Update button states (which includes colors)
        this.updateButtonStates();

        // Update all price badge colors
        document.querySelectorAll('.mwi-stack-price').forEach((badge) => {
            badge.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Disable and cleanup
     */
    disable() {
        // Remove event listeners
        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }

        // Unregister from badge manager
        inventoryBadgeManager.unregisterProvider('inventory-stack-price');

        // Remove controls
        if (this.controlsContainer) {
            this.controlsContainer.remove();
            this.controlsContainer = null;
        }

        // Remove all badges
        const badges = document.querySelectorAll('.mwi-stack-price');
        badges.forEach((badge) => badge.remove());

        // Unregister observers
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        this.currentInventoryElem = null;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const inventorySort = new InventorySort();
inventorySort.setupSettingListener();

export default inventorySort;
