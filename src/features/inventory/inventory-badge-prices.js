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
import { getItemPrice } from '../../utils/market-data.js';

/**
 * InventoryBadgePrices class manages price badge overlays on inventory items
 */
class InventoryBadgePrices {
    constructor() {
        this.unregisterHandlers = [];
        this.currentInventoryElem = null;
        this.warnedItems = new Set();
        this.isCalculating = false;
        this.isInitialized = false;
    }

    /**
     * Setup setting change listener (always active, even when feature is disabled)
     */
    setupSettingListener() {
        // Listen for main toggle changes
        config.onSettingChange('invBadgePrices', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        // Listen for color changes
        config.onSettingChange('color_invBadge_bid', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });

        config.onSettingChange('color_invBadge_ask', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize badge prices feature
     */
    initialize() {
        if (!config.getSetting('invBadgePrices')) {
            return;
        }

        // Prevent multiple initializations
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Check if inventory is already open
        const existingInv = document.querySelector('[class*="Inventory_items"]');
        if (existingInv) {
            this.currentInventoryElem = existingInv;
            this.updateBadges();
        }

        // Watch for inventory panel
        const unregister = domObserver.onClass(
            'InventoryBadgePrices',
            'Inventory_items',
            (elem) => {
                this.currentInventoryElem = elem;
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
                // Use market price only (no fallback to crafting/enhancement costs)
                const key = `${itemHrid}:${enhancementLevel}`;
                const marketPrice = priceCache.get(key);

                if (marketPrice) {
                    askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                    bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                }
            }

            // Store both values (per-item price, not stack total)
            itemElem.dataset.askValue = askPrice;
            itemElem.dataset.bidValue = bidPrice;
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
                                const inputPrice = getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
                                inputCost += inputPrice * input.count;
                            }
                        }

                        inputCost *= 0.9; // Artisan Tea reduction

                        let upgradeCost = 0;
                        if (action.upgradeItemHrid) {
                            const upgradePrice = getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
                            upgradeCost = upgradePrice;
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
            // Remove existing badges
            const existingBidBadge = itemElem.querySelector('.mwi-badge-price-bid');
            const existingAskBadge = itemElem.querySelector('.mwi-badge-price-ask');
            if (existingBidBadge) existingBidBadge.remove();
            if (existingAskBadge) existingAskBadge.remove();

            // Get values
            const bidValue = parseFloat(itemElem.dataset.bidValue) || 0;
            const askValue = parseFloat(itemElem.dataset.askValue) || 0;

            // Show both badges if they have values
            if (bidValue > 0) {
                this.renderPriceBadge(itemElem, bidValue, 'bid');
            }
            if (askValue > 0) {
                this.renderPriceBadge(itemElem, askValue, 'ask');
            }
        }
    }

    /**
     * Render price badge on item
     * @param {Element} itemElem - Item container element
     * @param {number} price - Per-item price
     * @param {string} type - 'bid' or 'ask'
     */
    renderPriceBadge(itemElem, price, type) {
        itemElem.style.position = 'relative';

        const badge = document.createElement('div');
        badge.className = `mwi-badge-price-${type}`;

        // Position: vertically centered on left (ask) or right (bid)
        const isAsk = type === 'ask';
        const color = isAsk ? config.COLOR_INVBADGE_ASK : config.COLOR_INVBADGE_BID;

        badge.style.cssText = `
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            ${isAsk ? 'left: 2px;' : 'right: 2px;'}
            z-index: 1;
            color: ${color};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: ${isAsk ? 'left' : 'right'};
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
        `;
        badge.textContent = formatKMB(Math.round(price), 0);

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
        const badges = document.querySelectorAll('.mwi-badge-price-bid, .mwi-badge-price-ask');
        badges.forEach(badge => badge.remove());

        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];

        this.currentInventoryElem = null;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const inventoryBadgePrices = new InventoryBadgePrices();

// Setup setting listener immediately (before initialize)
inventoryBadgePrices.setupSettingListener();

export default inventoryBadgePrices;
