/**
 * Inventory Badge Manager
 * Centralized management for all inventory item badges
 * Prevents race conditions with React re-renders by coordinating all badge rendering
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import networthCache from '../networth/networth-cache.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { getItemPrice } from '../../utils/market-data.js';

/**
 * InventoryBadgeManager class manages all inventory item badges from multiple features
 */
class InventoryBadgeManager {
    constructor() {
        this.providers = new Map(); // name -> { renderFn, priority }
        this.currentInventoryElem = null;
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.processedItems = new WeakSet(); // Track processed item containers
        this.warnedItems = new Set(); // Track items we've already warned about
        this.isCalculating = false; // Guard flag to prevent recursive calls
        this.lastCalculationTime = 0; // Timestamp of last calculation
        this.CALCULATION_COOLDOWN = 250; // 250ms minimum between calculations
        this.isRendering = false; // Guard flag for renderAllBadges
        this.lastRenderTime = 0; // Timestamp of last render
        this.RENDER_COOLDOWN = 100; // 100ms minimum between render calls
        this.inventoryLookupCache = null; // Cached inventory lookup map
        this.inventoryLookupCacheTime = 0; // Timestamp when cache was built
        this.INVENTORY_CACHE_TTL = 500; // 500ms cache lifetime
        this.nameToHridMap = null; // Reverse lookup: item name -> HRID (built once, lazy)
    }

    /**
     * Initialize badge manager
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Check if inventory is already open
        const existingInv = document.querySelector('[class*="Inventory_items"]');
        if (existingInv) {
            this.currentInventoryElem = existingInv;
        }

        // Watch for inventory panel
        const unregister = domObserver.onClass('InventoryBadgeManager', 'Inventory_items', (elem) => {
            this.currentInventoryElem = elem;
        });
        this.unregisterHandlers.push(unregister);

        // Note: We don't use a general DOM observer here because it creates infinite loops
        // (adding badges triggers the observer, which adds badges, etc.)
        // Instead, we rely on:
        // 1. Explicit calls from inventory-sort when sort mode changes
        // 2. dataManager events when items actually change
        // 3. Direct calls from other features when needed
    }

    /**
     * Register a badge provider
     * @param {string} name - Unique provider name
     * @param {Function} renderFn - Function(itemElem) that renders badges for an item
     * @param {number} priority - Render order (lower = earlier, default 100)
     */
    registerProvider(name, renderFn, priority = 100) {
        this.providers.set(name, { renderFn, priority });

        // Clear processed tracking when new provider registers
        // This ensures items get re-rendered with all providers
        this.clearProcessedTracking();
    }

    /**
     * Unregister a badge provider
     * @param {string} name - Provider name
     */
    unregisterProvider(name) {
        this.providers.delete(name);
    }

    /**
     * Clear processed tracking (forces re-render on next pass)
     */
    clearProcessedTracking() {
        this.processedItems = new WeakSet();
    }

    /**
     * Render all badges on all items from all providers
     */
    async renderAllBadges() {
        if (!this.currentInventoryElem) return;

        // Cooldown check for renderAllBadges
        const now = Date.now();
        const timeSinceLastRender = now - this.lastRenderTime;
        if (timeSinceLastRender < this.RENDER_COOLDOWN) {
            return;
        }
        this.lastRenderTime = now;

        // Prevent concurrent renders
        if (this.isRendering) {
            return;
        }
        this.isRendering = true;

        // Calculate prices for all items
        await this.calculatePricesForAllItems();

        const itemElems = this.currentInventoryElem.querySelectorAll('[class*="Item_itemContainer"]');

        // Sort providers by priority
        const sortedProviders = Array.from(this.providers.entries()).sort((a, b) => a[1].priority - b[1].priority);

        for (const itemElem of itemElems) {
            // Check if already processed AND badges still exist
            // React can destroy inner content while keeping container reference
            const wasProcessed = this.processedItems.has(itemElem);
            const hasBadges = this.itemHasBadges(itemElem);

            // Skip only if processed AND badges still exist
            if (wasProcessed && hasBadges) {
                continue;
            }

            // Call each provider's render function for this item
            for (const [name, { renderFn }] of sortedProviders) {
                try {
                    renderFn(itemElem);
                } catch (error) {
                    console.error(`[InventoryBadgeManager] Error in provider "${name}":`, error);
                }
            }

            // Mark as processed
            this.processedItems.add(itemElem);
        }

        // Clear rendering guard
        this.isRendering = false;
    }

    /**
     * Calculate prices for all items in inventory
     */
    async calculatePricesForAllItems() {
        if (!this.currentInventoryElem) return;

        // Prevent recursive calls
        if (this.isCalculating) {
            return;
        }

        // Cooldown check - prevent spamming during rapid events
        const now = Date.now();
        const timeSinceLastCalc = now - this.lastCalculationTime;
        if (timeSinceLastCalc < this.CALCULATION_COOLDOWN) {
            return;
        }
        this.lastCalculationTime = now;

        this.isCalculating = true;

        const inventoryElem = this.currentInventoryElem;

        // Build inventory cache once if expired or missing (500ms TTL)
        let inventory = null;
        let inventoryLookup = null;

        const cacheAge = now - this.inventoryLookupCacheTime;
        if (this.inventoryLookupCache && cacheAge < this.INVENTORY_CACHE_TTL) {
            // Use cached data
            inventory = this.inventoryLookupCache.inventory;
            inventoryLookup = this.inventoryLookupCache.lookup;
        } else {
            // Rebuild cache
            inventory = dataManager.getInventory();
            if (inventory) {
                inventoryLookup = new Map();
                for (const item of inventory) {
                    if (item.itemLocationHrid === '/item_locations/inventory') {
                        const key = `${item.itemHrid}|${item.count}`;
                        inventoryLookup.set(key, item);
                    }
                }
                // Store in cache
                this.inventoryLookupCache = { inventory, lookup: inventoryLookup };
                this.inventoryLookupCacheTime = now;
            }
        }

        // Process each category
        for (const categoryDiv of inventoryElem.children) {
            const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');
            await this.calculateItemPrices(itemElems, inventory, inventoryLookup);
        }

        this.isCalculating = false;
    }

    /**
     * Calculate and store prices for all items (populates dataset.askValue/bidValue)
     * @param {NodeList} itemElems - Item elements
     * @param {Array} cachedInventory - Optional cached inventory data
     * @param {Map} cachedInventoryLookup - Optional cached inventory lookup map
     */
    async calculateItemPrices(itemElems, cachedInventory = null, cachedInventoryLookup = null) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            console.warn('[InventoryBadgeManager] Game data not available yet');
            return;
        }

        // Use cached inventory if provided, otherwise fetch fresh
        let inventory = cachedInventory;
        let inventoryLookup = cachedInventoryLookup;

        if (!inventory || !inventoryLookup) {
            // Get inventory data for enhancement level matching
            inventory = dataManager.getInventory();
            if (!inventory) {
                console.warn('[InventoryBadgeManager] Inventory data not available yet');
                return;
            }

            // Build lookup map: itemHrid|count -> inventory item
            inventoryLookup = new Map();
            for (const item of inventory) {
                if (item.itemLocationHrid === '/item_locations/inventory') {
                    const key = `${item.itemHrid}|${item.count}`;
                    inventoryLookup.set(key, item);
                }
            }
        }

        // OPTIMIZATION: Pre-fetch all market prices in one batch
        const itemsToPrice = [];
        for (const item of inventory) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                itemsToPrice.push({
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                });
            }
        }
        const priceCache = marketAPI.getPricesBatch(itemsToPrice);

        // Get settings for high enhancement cost mode
        const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
        const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;

        // Currency items to skip (actual currencies, not category)
        const currencyHrids = new Set([
            '/items/gold_coin',
            '/items/cowbell',
            '/items/task_token',
            '/items/chimerical_token',
            '/items/sinister_token',
            '/items/enchanted_token',
            '/items/pirate_token',
        ]);

        for (const itemElem of itemElems) {
            // Get item HRID from SVG aria-label
            const svg = itemElem.querySelector('svg');
            if (!svg) continue;

            const itemName = svg.getAttribute('aria-label');
            if (!itemName) continue;

            // Find item HRID
            const itemHrid = this.findItemHrid(itemName, gameData);
            if (!itemHrid) {
                console.warn('[InventoryBadgeManager] Could not find HRID for item:', itemName);
                continue;
            }

            // Skip actual currency items
            if (currencyHrids.has(itemHrid)) {
                itemElem.dataset.askPrice = 0;
                itemElem.dataset.bidPrice = 0;
                itemElem.dataset.askValue = 0;
                itemElem.dataset.bidValue = 0;
                continue;
            }

            // Get item count
            const countElem = itemElem.querySelector('[class*="Item_count"]');
            if (!countElem) continue;

            let itemCount = countElem.textContent;
            itemCount = this.parseItemCount(itemCount);

            // Get item details (reused throughout)
            const itemDetails = gameData.itemDetailMap[itemHrid];

            // Handle trainee items (untradeable, no market data)
            if (itemHrid.includes('trainee_')) {
                // EXCEPTION: Trainee charms should use vendor price
                const equipmentType = itemDetails?.equipmentDetail?.type;
                const isCharm = equipmentType === '/equipment_types/charm';
                const sellPrice = itemDetails?.sellPrice;

                if (isCharm && sellPrice) {
                    // Use sell price for trainee charms
                    itemElem.dataset.askPrice = sellPrice;
                    itemElem.dataset.bidPrice = sellPrice;
                    itemElem.dataset.askValue = sellPrice * itemCount;
                    itemElem.dataset.bidValue = sellPrice * itemCount;
                } else {
                    // Other trainee items (weapons/armor) remain at 0
                    itemElem.dataset.askPrice = 0;
                    itemElem.dataset.bidPrice = 0;
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                }
                continue;
            }

            // Handle openable containers (chests, crates, caches)
            if (itemDetails?.isOpenable && expectedValueCalculator.isInitialized) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData && evData.expectedValue > 0) {
                    // Use expected value for both ask and bid
                    itemElem.dataset.askPrice = evData.expectedValue;
                    itemElem.dataset.bidPrice = evData.expectedValue;
                    itemElem.dataset.askValue = evData.expectedValue * itemCount;
                    itemElem.dataset.bidValue = evData.expectedValue * itemCount;
                    continue;
                }
            }

            // Match to inventory item to get enhancement level
            const key = `${itemHrid}|${itemCount}`;
            const inventoryItem = inventoryLookup.get(key);
            const enhancementLevel = inventoryItem?.enhancementLevel || 0;

            // Check if item is equipment
            const isEquipment = !!itemDetails?.equipmentDetail;

            let askPrice = 0;
            let bidPrice = 0;

            // Determine pricing method
            if (isEquipment && useHighEnhancementCost && enhancementLevel >= minLevel) {
                // Use enhancement cost calculation for high-level equipment
                const cachedCost = networthCache.get(itemHrid, enhancementLevel);

                if (cachedCost !== null) {
                    // Use cached value for both ask and bid
                    askPrice = cachedCost;
                    bidPrice = cachedCost;
                } else {
                    // Calculate enhancement cost
                    const enhancementParams = getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        const enhancementCost = enhancementPath.optimalStrategy.totalCost;

                        // Cache the result
                        networthCache.set(itemHrid, enhancementLevel, enhancementCost);

                        // Use enhancement cost for both ask and bid
                        askPrice = enhancementCost;
                        bidPrice = enhancementCost;
                    } else {
                        // Enhancement calculation failed, fallback to market price
                        const key = `${itemHrid}:${enhancementLevel}`;
                        const marketPrice = priceCache.get(key);
                        if (marketPrice) {
                            askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                            bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                        }
                    }
                }
            } else {
                // Use market price (for non-equipment or low enhancement levels)
                const key = `${itemHrid}:${enhancementLevel}`;
                const marketPrice = priceCache.get(key);

                // Start with whatever market data exists
                if (marketPrice) {
                    askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                    bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                }

                // For enhanced equipment, fill in missing prices with enhancement cost
                if (isEquipment && enhancementLevel > 0 && (askPrice === 0 || bidPrice === 0)) {
                    // Check cache first
                    const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                    let enhancementCost = cachedCost;

                    if (cachedCost === null) {
                        // Calculate enhancement cost
                        const enhancementParams = getEnhancingParams();
                        const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                        if (enhancementPath && enhancementPath.optimalStrategy) {
                            enhancementCost = enhancementPath.optimalStrategy.totalCost;
                            networthCache.set(itemHrid, enhancementLevel, enhancementCost);
                        } else {
                            enhancementCost = null;
                        }
                    }

                    // Fill in missing prices
                    if (enhancementCost !== null) {
                        if (askPrice === 0) askPrice = enhancementCost;
                        if (bidPrice === 0) bidPrice = enhancementCost;
                    }
                } else if (isEquipment && enhancementLevel === 0 && askPrice === 0 && bidPrice === 0) {
                    // For unenhanced equipment with no market data, use crafting cost
                    const craftingCost = this.calculateCraftingCost(itemHrid);
                    if (craftingCost > 0) {
                        askPrice = craftingCost;
                        bidPrice = craftingCost;
                    } else if (!this.warnedItems.has(itemHrid)) {
                        // No crafting recipe found (likely drop-only item) - silently skip
                        this.warnedItems.add(itemHrid);
                    }
                } else if (!isEquipment && askPrice === 0 && bidPrice === 0) {
                    // Non-equipment with no market data - silently skip
                    if (!this.warnedItems.has(itemHrid)) {
                        this.warnedItems.add(itemHrid);
                    }
                    // Leave values at 0 (no badge will be shown)
                }
            }

            // Store per-item prices (for badge display)
            itemElem.dataset.askPrice = askPrice;
            itemElem.dataset.bidPrice = bidPrice;

            // Store stack totals (for sorting and stack value badges)
            itemElem.dataset.askValue = askPrice * itemCount;
            itemElem.dataset.bidValue = bidPrice * itemCount;
        }
    }

    /**
     * Calculate crafting cost for an item (used for unenhanced equipment with no market data)
     * @param {string} itemHrid - Item HRID
     * @returns {number} Total material cost or 0 if not craftable
     */
    calculateCraftingCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Find the action that produces this item
        for (const action of Object.values(gameData.actionDetailMap || {})) {
            if (action.outputItems) {
                for (const output of action.outputItems) {
                    if (output.itemHrid === itemHrid) {
                        // Found the crafting action, calculate material costs
                        let inputCost = 0;

                        // Add input items
                        if (action.inputItems && action.inputItems.length > 0) {
                            for (const input of action.inputItems) {
                                const inputPrice = getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
                                inputCost += inputPrice * input.count;
                            }
                        }

                        // Apply Artisan Tea reduction (0.9x) to input materials
                        inputCost *= 0.9;

                        // Add upgrade item cost (not affected by Artisan Tea)
                        let upgradeCost = 0;
                        if (action.upgradeItemHrid) {
                            const upgradePrice = getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
                            upgradeCost = upgradePrice;
                        }

                        const totalCost = inputCost + upgradeCost;

                        // Divide by output count to get per-item cost
                        return totalCost / (output.count || 1);
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Find item HRID from item name
     * @param {string} itemName - Item display name
     * @param {Object} gameData - Game data
     * @returns {string|null} Item HRID
     */
    /**
     * Build reverse lookup map from item name to HRID
     * Built once on first use, cached thereafter
     * @param {Object} gameData - Game data
     */
    buildNameToHridMap(gameData) {
        if (this.nameToHridMap) {
            return; // Already built
        }

        this.nameToHridMap = new Map();

        if (!gameData || !gameData.itemDetailMap) {
            console.warn('[InventoryBadgeManager] Cannot build name lookup: missing itemDetailMap');
            return;
        }

        // Build reverse lookup: name -> HRID (one-time O(n) operation)
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            if (item.name) {
                this.nameToHridMap.set(item.name, hrid);
            }
        }
    }

    /**
     * Find item HRID by name (optimized with reverse lookup map)
     * @param {string} itemName - Item name
     * @param {Object} gameData - Game data
     * @returns {string|null} Item HRID or null if not found
     */
    findItemHrid(itemName, gameData) {
        // Build map on first use (lazy initialization)
        if (!this.nameToHridMap) {
            this.buildNameToHridMap(gameData);
        }

        // O(1) lookup
        return this.nameToHridMap.get(itemName) || null;
    }

    /**
     * Parse item count from text (handles K, M suffixes and international number formats)
     * @param {string} text - Count text
     * @returns {number} Numeric count
     */
    parseItemCount(text) {
        text = text.toLowerCase().trim();

        // Remove all whitespace characters (handles international formats like "27 115" or "1 000")
        text = text.replace(/\s/g, '');

        if (text.includes('k')) {
            return parseFloat(text.replace('k', '')) * 1000;
        } else if (text.includes('m')) {
            return parseFloat(text.replace('m', '')) * 1000000;
        } else {
            return parseFloat(text) || 0;
        }
    }

    /**
     * Check if item has any badges
     * @param {Element} itemElem - Item container element
     * @returns {boolean} True if item has any badge elements
     */
    itemHasBadges(itemElem) {
        return !!(
            itemElem.querySelector('.mwi-badge-price-bid') ||
            itemElem.querySelector('.mwi-badge-price-ask') ||
            itemElem.querySelector('.mwi-stack-price')
        );
    }

    /**
     * Disable and cleanup
     */
    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.providers.clear();
        this.processedItems = new WeakSet();
        this.currentInventoryElem = null;
        this.isInitialized = false;
    }
}

const inventoryBadgeManager = new InventoryBadgeManager();

export default inventoryBadgeManager;
