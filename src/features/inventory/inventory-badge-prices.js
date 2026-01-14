/**
 * Inventory Badge Prices Module
 * Shows ask/bid price badges on inventory item icons
 * Works independently of inventory sorting feature
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { formatKMB } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import networthCache from '../networth/networth-cache.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';

/**
 * InventoryBadgePrices class manages price badge overlays on inventory items
 */
class InventoryBadgePrices {
    constructor() {
        this.currentPriceType = 'none'; // 'ask', 'bid', 'none'
        this.unregisterHandlers = [];
        this.controlsContainer = null;
        this.currentInventoryElem = null;
        this.warnedItems = new Set();
        this.isCalculating = false;
    }

    /**
     * Initialize badge prices feature
     */
    initialize() {
        if (!config.getSetting('invBadgePrices')) {
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
            this.injectPriceTypeControls(existingInv);
            this.updateBadges();
        }

        // Watch for inventory panel
        const unregister = domObserver.onClass(
            'InventoryBadgePrices',
            'Inventory_items',
            (elem) => {
                this.currentInventoryElem = elem;
                this.injectPriceTypeControls(elem);
                this.updateBadges();
            }
        );
        this.unregisterHandlers.push(unregister);

        // Watch for DOM changes to refresh badges
        const badgeRefreshUnregister = domObserver.register(
            'InventoryBadgePrices-Refresh',
            () => {
                if (this.currentInventoryElem) {
                    this.updateBadges();
                }
            },
            { debounce: true, debounceDelay: 100 }
        );
        this.unregisterHandlers.push(badgeRefreshUnregister);

        // Listen for market data updates
        this.setupMarketDataListener();

        // Register callback for setting changes
        config.onSettingChange('invBadgePrices_type', (newValue) => {
            this.currentPriceType = newValue.toLowerCase();
            this.updateBadges();
        });
    }

    /**
     * Setup listener for market data updates
     */
    setupMarketDataListener() {
        if (!marketAPI.isLoaded()) {
            let retryCount = 0;
            const maxRetries = 10;
            const retryInterval = 500;

            const retryCheck = setInterval(() => {
                retryCount++;

                if (marketAPI.isLoaded()) {
                    clearInterval(retryCheck);
                    if (this.currentInventoryElem) {
                        this.updateBadges();
                    }
                } else if (retryCount >= maxRetries) {
                    console.warn('[InventoryBadgePrices] Market data still not available after', maxRetries, 'retries');
                    clearInterval(retryCheck);
                }
            }, retryInterval);
        }
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const saved = localStorage.getItem('toolasha_inventory_badge_prices');
            if (saved) {
                const settings = JSON.parse(saved);
                this.currentPriceType = settings.priceType || 'none';
            } else {
                // Use config value as default
                this.currentPriceType = config.getSettingValue('invBadgePrices_type', 'Ask').toLowerCase();
            }
        } catch (error) {
            console.error('[InventoryBadgePrices] Failed to load settings:', error);
            this.currentPriceType = 'ask';
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            localStorage.setItem('toolasha_inventory_badge_prices', JSON.stringify({
                priceType: this.currentPriceType
            }));
        } catch (error) {
            console.error('[InventoryBadgePrices] Failed to save settings:', error);
        }
    }

    /**
     * Inject price type controls into inventory panel
     * @param {Element} inventoryElem - Inventory items container
     */
    injectPriceTypeControls(inventoryElem) {
        this.currentInventoryElem = inventoryElem;

        // Check if controls already exist
        if (this.controlsContainer && document.body.contains(this.controlsContainer)) {
            return;
        }

        // Create controls container
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'mwi-badge-prices-controls';
        this.controlsContainer.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.875rem;
            text-align: left;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        `;

        // Price type label and buttons
        const label = document.createElement('span');
        label.textContent = 'Badge Prices: ';

        const askButton = this.createPriceTypeButton('Ask', 'ask');
        const bidButton = this.createPriceTypeButton('Bid', 'bid');
        const noneButton = this.createPriceTypeButton('None', 'none');

        // Assemble controls
        this.controlsContainer.appendChild(label);
        this.controlsContainer.appendChild(askButton);
        this.controlsContainer.appendChild(bidButton);
        this.controlsContainer.appendChild(noneButton);

        // Insert before inventory
        inventoryElem.insertAdjacentElement('beforebegin', this.controlsContainer);

        // Update button states
        this.updateButtonStates();
    }

    /**
     * Create a price type button
     * @param {string} label - Button label
     * @param {string} type - Price type ('ask', 'bid', 'none')
     * @returns {Element} Button element
     */
    createPriceTypeButton(label, type) {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.type = type;
        button.style.cssText = `
            border-radius: 3px;
            padding: 4px 12px;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        `;

        button.addEventListener('click', () => {
            this.setPriceType(type);
        });

        return button;
    }

    /**
     * Update button visual states
     */
    updateButtonStates() {
        if (!this.controlsContainer) return;

        const buttons = this.controlsContainer.querySelectorAll('button');
        buttons.forEach(button => {
            const isActive = button.dataset.type === this.currentPriceType;

            if (isActive) {
                button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
                button.style.color = 'black';
                button.style.fontWeight = 'bold';
            } else {
                button.style.backgroundColor = '#444';
                button.style.color = config.COLOR_TEXT_SECONDARY;
                button.style.fontWeight = 'normal';
            }
        });
    }

    /**
     * Set price type and update badges
     * @param {string} type - Price type ('ask', 'bid', 'none')
     */
    setPriceType(type) {
        this.currentPriceType = type;
        this.saveSettings();
        this.updateButtonStates();
        this.updateBadges();
    }

    /**
     * Update all price badges
     */
    async updateBadges() {
        if (!this.currentInventoryElem) return;

        // Prevent recursive calls
        if (this.isCalculating) return;
        this.isCalculating = true;

        const inventoryElem = this.currentInventoryElem;

        // Process each category
        for (const categoryDiv of inventoryElem.children) {
            const categoryButton = categoryDiv.querySelector('[class*="Inventory_categoryButton"]');
            if (!categoryButton) continue;

            const categoryName = categoryButton.textContent.trim();

            // Skip categories that shouldn't show badges
            const excludedCategories = ['Currencies'];
            if (excludedCategories.includes(categoryName)) {
                continue;
            }

            const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');

            // Calculate prices for all items
            await this.calculateItemPrices(itemElems);
        }

        // Render badges
        this.renderBadges();

        this.isCalculating = false;
    }

    /**
     * Calculate and store prices for all items
     * @param {NodeList} itemElems - Item elements
     */
    async calculateItemPrices(itemElems) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            console.warn('[InventoryBadgePrices] Game data not available yet');
            return;
        }

        const inventory = dataManager.getInventory();
        if (!inventory) {
            console.warn('[InventoryBadgePrices] Inventory data not available yet');
            return;
        }

        // Build lookup map
        const inventoryLookup = new Map();
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                const key = `${item.itemHrid}|${item.count}`;
                inventoryLookup.set(key, item);
            }
        }

        // Pre-fetch market prices
        const itemsToPrice = [];
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                itemsToPrice.push({
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0
                });
            }
        }
        const priceCache = marketAPI.getPricesBatch(itemsToPrice);

        const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
        const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;

        for (const itemElem of itemElems) {
            const svg = itemElem.querySelector('svg');
            if (!svg) continue;

            let itemName = svg.getAttribute('aria-label');
            if (!itemName) continue;

            const itemHrid = this.findItemHrid(itemName, gameData);
            if (!itemHrid) continue;

            const countElem = itemElem.querySelector('[class*="Item_count"]');
            if (!countElem) continue;

            let itemCount = this.parseItemCount(countElem.textContent);
            const itemDetails = gameData.itemDetailMap[itemHrid];

            // Handle trainee items
            if (itemHrid.includes('trainee_')) {
                const equipmentType = itemDetails?.equipmentDetail?.type;
                const isCharm = equipmentType === '/equipment_types/charm';
                const sellPrice = itemDetails?.sellPrice;

                if (isCharm && sellPrice) {
                    itemElem.dataset.askValue = sellPrice * itemCount;
                    itemElem.dataset.bidValue = sellPrice * itemCount;
                } else {
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                }
                continue;
            }

            // Handle openable containers
            if (itemDetails?.isOpenable && expectedValueCalculator.isInitialized) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData && evData.expectedValue > 0) {
                    itemElem.dataset.askValue = evData.expectedValue * itemCount;
                    itemElem.dataset.bidValue = evData.expectedValue * itemCount;
                    continue;
                }
            }

            // Match to inventory item
            const key = `${itemHrid}|${itemCount}`;
            const inventoryItem = inventoryLookup.get(key);
            const enhancementLevel = inventoryItem?.enhancementLevel || 0;
            const isEquipment = itemDetails?.equipmentDetail ? true : false;

            let askPrice = 0;
            let bidPrice = 0;

            // Determine pricing method
            if (isEquipment && useHighEnhancementCost && enhancementLevel >= minLevel) {
                const cachedCost = networthCache.get(itemHrid, enhancementLevel);

                if (cachedCost !== null) {
                    askPrice = cachedCost;
                    bidPrice = cachedCost;
                } else {
                    const enhancementParams = getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        const enhancementCost = enhancementPath.optimalStrategy.totalCost;
                        networthCache.set(itemHrid, enhancementLevel, enhancementCost);
                        askPrice = enhancementCost;
                        bidPrice = enhancementCost;
                    } else {
                        const key = `${itemHrid}:${enhancementLevel}`;
                        const marketPrice = priceCache.get(key);
                        if (marketPrice) {
                            askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                            bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                        }
                    }
                }
            } else {
                // Use market price
                const key = `${itemHrid}:${enhancementLevel}`;
                const marketPrice = priceCache.get(key);

                if (marketPrice) {
                    askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                    bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                }

                // Fill in missing prices with enhancement cost for enhanced equipment
                if (isEquipment && enhancementLevel > 0 && (askPrice === 0 || bidPrice === 0)) {
                    const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                    let enhancementCost = cachedCost;

                    if (cachedCost === null) {
                        const enhancementParams = getEnhancingParams();
                        const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                        if (enhancementPath && enhancementPath.optimalStrategy) {
                            enhancementCost = enhancementPath.optimalStrategy.totalCost;
                            networthCache.set(itemHrid, enhancementLevel, enhancementCost);
                        } else {
                            enhancementCost = null;
                        }
                    }

                    if (enhancementCost !== null) {
                        if (askPrice === 0) askPrice = enhancementCost;
                        if (bidPrice === 0) bidPrice = enhancementCost;
                    }
                } else if (isEquipment && enhancementLevel === 0 && askPrice === 0 && bidPrice === 0) {
                    // Use crafting cost for unenhanced equipment
                    const craftingCost = this.calculateCraftingCost(itemHrid);
                    if (craftingCost > 0) {
                        askPrice = craftingCost;
                        bidPrice = craftingCost;
                    }
                }
            }

            // Store both values
            itemElem.dataset.askValue = askPrice * itemCount;
            itemElem.dataset.bidValue = bidPrice * itemCount;
        }
    }

    /**
     * Calculate crafting cost for an item
     * @param {string} itemHrid - Item HRID
     * @returns {number} Total material cost or 0
     */
    calculateCraftingCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        for (const action of Object.values(gameData.actionDetailMap || {})) {
            if (action.outputItems) {
                for (const output of action.outputItems) {
                    if (output.itemHrid === itemHrid) {
                        let inputCost = 0;

                        if (action.inputItems && action.inputItems.length > 0) {
                            for (const input of action.inputItems) {
                                const inputPrice = marketAPI.getPrice(input.itemHrid, 0);
                                if (inputPrice) {
                                    inputCost += (inputPrice.ask || 0) * input.count;
                                }
                            }
                        }

                        inputCost *= 0.9; // Artisan Tea reduction

                        let upgradeCost = 0;
                        if (action.upgradeItemHrid) {
                            const upgradePrice = marketAPI.getPrice(action.upgradeItemHrid, 0);
                            if (upgradePrice) {
                                upgradeCost = (upgradePrice.ask || 0);
                            }
                        }

                        const totalCost = inputCost + upgradeCost;
                        return totalCost / (output.count || 1);
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Render price badges on all items
     */
    renderBadges() {
        if (!this.currentInventoryElem) return;

        const itemElems = this.currentInventoryElem.querySelectorAll('[class*="Item_itemContainer"]');

        for (const itemElem of itemElems) {
            // Remove existing badge
            const existingBadge = itemElem.querySelector('.mwi-badge-price');
            if (existingBadge) {
                existingBadge.remove();
            }

            // Show badge if price type is selected
            if (this.currentPriceType !== 'none') {
                const valueKey = this.currentPriceType + 'Value';
                const stackValue = parseFloat(itemElem.dataset[valueKey]) || 0;

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
        itemElem.style.position = 'relative';

        const badge = document.createElement('div');
        badge.className = 'mwi-badge-price';
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
            text-shadow: 0 0 3px rgba(0,0,0,0.8), 0 0 5px rgba(0,0,0,0.6);
        `;
        badge.textContent = formatKMB(Math.round(stackValue), 0);

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
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            if (item.name === itemName) {
                return hrid;
            }
        }
        return null;
    }

    /**
     * Parse item count from text
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
     * Refresh badges (called when settings change)
     */
    refresh() {
        this.updateBadges();
    }

    /**
     * Disable and cleanup
     */
    disable() {
        if (this.controlsContainer) {
            this.controlsContainer.remove();
            this.controlsContainer = null;
        }

        const badges = document.querySelectorAll('.mwi-badge-price');
        badges.forEach(badge => badge.remove());

        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];

        this.currentInventoryElem = null;
    }
}

// Create and export singleton instance
const inventoryBadgePrices = new InventoryBadgePrices();

export default inventoryBadgePrices;
