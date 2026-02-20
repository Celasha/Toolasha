/**
 * Marketplace API Module
 * Fetches and caches market price data from the MWI marketplace API
 */

import connectionState from '../core/connection-state.js';
import storage from '../core/storage.js';
import networkAlert from '../features/market/network-alert.js';

/**
 * MarketAPI class handles fetching and caching market price data
 */
class MarketAPI {
    constructor() {
        // API endpoint
        this.API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

        // Cache settings
        this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
        this.CACHE_KEY_DATA = 'MWITools_marketAPI_json';
        this.CACHE_KEY_TIMESTAMP = 'MWITools_marketAPI_timestamp';
        this.CACHE_KEY_PATCHES = 'MWITools_marketAPI_patches';
        this.CACHE_KEY_MIGRATION = 'MWITools_marketAPI_migration_version';
        this.CURRENT_MIGRATION_VERSION = 1; // Increment this when patches need to be cleared

        // Current market data
        this.marketData = null;
        this.lastFetchTimestamp = null;
        this.errorLog = [];

        // Price patches from order book data (fresher than API)
        // Structure: { "itemHrid:enhLevel": { a: ask, b: bid, timestamp: ms } }
        this.pricePatchs = {};

        // Event listeners for price updates
        this.listeners = [];
    }

    /**
     * Fetch market data from API or cache
     * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
     * @returns {Promise<Object|null>} Market data object or null if failed
     */
    async fetch(forceFetch = false) {
        // Check cache first (unless force fetch)
        if (!forceFetch) {
            const cached = await this.getCachedData();
            if (cached) {
                this.marketData = cached.data;
                // API timestamp is in seconds, convert to milliseconds for comparison with Date.now()
                this.lastFetchTimestamp = cached.timestamp * 1000;
                // Load patches from storage
                await this.loadPatches();
                // Hide alert on successful cache load
                networkAlert.hide();
                // Notify listeners (initial load)
                this.notifyListeners();
                return this.marketData;
            }
        }

        if (!connectionState.isConnected()) {
            const cachedFallback = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (cachedFallback?.marketData) {
                this.marketData = cachedFallback.marketData;
                // API timestamp is in seconds, convert to milliseconds
                this.lastFetchTimestamp = cachedFallback.timestamp * 1000;
                // Load patches from storage
                await this.loadPatches();
                console.warn('[MarketAPI] Skipping fetch; disconnected. Using cached data.');
                return this.marketData;
            }

            console.warn('[MarketAPI] Skipping fetch; disconnected and no cache available');
            return null;
        }

        // Try to fetch fresh data
        try {
            const response = await this.fetchFromAPI();

            if (response) {
                // Cache the fresh data
                this.cacheData(response);
                this.marketData = response.marketData;
                // API timestamp is in seconds, convert to milliseconds
                this.lastFetchTimestamp = response.timestamp * 1000;
                // Load patches from storage (they may still be fresher than new API data)
                await this.loadPatches();
                // Hide alert on successful fetch
                networkAlert.hide();
                // Notify listeners of price update
                this.notifyListeners();
                return this.marketData;
            }
        } catch (error) {
            this.logError('Fetch failed', error);
        }

        // Fallback: Try to use expired cache
        const expiredCache = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
        if (expiredCache) {
            console.warn('[MarketAPI] Using expired cache as fallback');
            this.marketData = expiredCache.marketData;
            // API timestamp is in seconds, convert to milliseconds
            this.lastFetchTimestamp = expiredCache.timestamp * 1000;
            // Load patches from storage
            await this.loadPatches();
            // Show alert when using expired cache
            networkAlert.show('⚠️ Using outdated market data');
            return this.marketData;
        }

        // Total failure - show alert
        console.error('[MarketAPI] ❌ No market data available');
        networkAlert.show('⚠️ Market data unavailable');
        return null;
    }

    /**
     * Fetch from API endpoint
     * @returns {Promise<Object|null>} API response or null
     */
    async fetchFromAPI() {
        try {
            const response = await fetch(this.API_URL);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Validate response structure
            if (!data.marketData || typeof data.marketData !== 'object') {
                throw new Error('Invalid API response structure');
            }

            return data;
        } catch (error) {
            console.error('[MarketAPI] API fetch error:', error);
            throw error;
        }
    }

    /**
     * Get cached data if valid
     * @returns {Promise<Object|null>} { data, timestamp } or null if invalid/expired
     */
    async getCachedData() {
        const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
        const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

        if (!cachedTimestamp || !cachedData) {
            return null;
        }

        // Check if cache is still valid
        const now = Date.now();
        const age = now - cachedTimestamp;

        if (age > this.CACHE_DURATION) {
            return null;
        }

        return {
            data: cachedData.marketData,
            timestamp: cachedData.timestamp,
        };
    }

    /**
     * Cache market data
     * @param {Object} data - API response to cache
     */
    cacheData(data) {
        storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
        storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
    }

    /**
     * Get price for an item
     * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
     * @param {number} enhancementLevel - Enhancement level (default: 0)
     * @returns {Object|null} { ask: number, bid: number } or null if not found
     */
    getPrice(itemHrid, enhancementLevel = 0) {
        const normalizeMarketPriceValue = (value) => {
            if (typeof value !== 'number') {
                return null;
            }

            if (value < 0) {
                return null;
            }

            return value;
        };

        // Check for fresh patch first
        const patchKey = `${itemHrid}:${enhancementLevel}`;
        const patch = this.pricePatchs[patchKey];

        if (patch && patch.timestamp > this.lastFetchTimestamp) {
            // Patch is fresher than API data - use it
            return {
                ask: normalizeMarketPriceValue(patch.a),
                bid: normalizeMarketPriceValue(patch.b),
            };
        }

        // Fall back to API data
        if (!this.marketData) {
            console.warn('[MarketAPI] ⚠️ No market data available');
            return null;
        }

        const priceData = this.marketData[itemHrid];

        if (!priceData || typeof priceData !== 'object') {
            // Item not in market data at all
            return null;
        }

        // Market data is organized by enhancement level
        // { 0: { a: 1000, b: 900 }, 2: { a: 5000, b: 4500 }, ... }
        const price = priceData[enhancementLevel];

        if (!price) {
            // No price data for this enhancement level
            return null;
        }

        return {
            ask: normalizeMarketPriceValue(price.a), // Sell price
            bid: normalizeMarketPriceValue(price.b), // Buy price
        };
    }

    /**
     * Get prices for multiple items
     * @param {string[]} itemHrids - Array of item HRIDs
     * @returns {Map<string, Object>} Map of HRID -> { ask, bid }
     */
    getPrices(itemHrids) {
        const prices = new Map();

        for (const hrid of itemHrids) {
            const price = this.getPrice(hrid);
            if (price) {
                prices.set(hrid, price);
            }
        }

        return prices;
    }

    /**
     * Get prices for multiple items with enhancement levels (batch optimized)
     * @param {Array<{itemHrid: string, enhancementLevel: number}>} items - Array of items with enhancement levels
     * @returns {Map<string, Object>} Map of "hrid:level" -> { ask, bid }
     */
    getPricesBatch(items) {
        const priceMap = new Map();

        for (const { itemHrid, enhancementLevel = 0 } of items) {
            const key = `${itemHrid}:${enhancementLevel}`;
            if (!priceMap.has(key)) {
                const price = this.getPrice(itemHrid, enhancementLevel);
                if (price) {
                    priceMap.set(key, price);
                }
            }
        }

        return priceMap;
    }

    /**
     * Check if market data is loaded
     * @returns {boolean} True if data is available
     */
    isLoaded() {
        return this.marketData !== null;
    }

    /**
     * Get age of current data in milliseconds
     * @returns {number|null} Age in ms or null if no data
     */
    getDataAge() {
        if (!this.lastFetchTimestamp) {
            return null;
        }

        return Date.now() - this.lastFetchTimestamp;
    }

    /**
     * Log an error
     * @param {string} message - Error message
     * @param {Error} error - Error object
     */
    logError(message, error) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            message,
            error: error?.message || String(error),
        };

        this.errorLog.push(errorEntry);
        console.error(`[MarketAPI] ${message}:`, error);
    }

    /**
     * Get error log
     * @returns {Array} Array of error entries
     */
    getErrors() {
        return [...this.errorLog];
    }

    /**
     * Clear error log
     */
    clearErrors() {
        this.errorLog = [];
    }

    /**
     * Update price from order book data (fresher than API)
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {number|null} ask - Top ask price (null if no asks)
     * @param {number|null} bid - Top bid price (null if no bids)
     */
    updatePrice(itemHrid, enhancementLevel, ask, bid) {
        const key = `${itemHrid}:${enhancementLevel}`;

        this.pricePatchs[key] = {
            a: ask,
            b: bid,
            timestamp: Date.now(),
        };

        // Save patches to storage (debounced via storage module)
        this.savePatches();

        // Notify listeners of price update
        this.notifyListeners();
    }

    /**
     * Load price patches from storage
     */
    async loadPatches() {
        try {
            // Check migration version - clear patches if old version
            const migrationVersion = await storage.get(this.CACHE_KEY_MIGRATION, 'settings', 0);

            if (migrationVersion < this.CURRENT_MIGRATION_VERSION) {
                console.log(
                    `[MarketAPI] Migrating price patches from v${migrationVersion} to v${this.CURRENT_MIGRATION_VERSION}`
                );
                // Clear old patches (they may have corrupted data)
                this.pricePatchs = {};
                await storage.set(this.CACHE_KEY_PATCHES, {}, 'settings');
                await storage.set(this.CACHE_KEY_MIGRATION, this.CURRENT_MIGRATION_VERSION, 'settings');
                console.log('[MarketAPI] Price patches cleared due to migration');
                return;
            }

            // Load patches normally
            const patches = await storage.getJSON(this.CACHE_KEY_PATCHES, 'settings', {});
            this.pricePatchs = patches || {};

            // Purge stale patches (older than API data)
            this.purgeStalePatches();
        } catch (error) {
            console.error('[MarketAPI] Failed to load price patches:', error);
            this.pricePatchs = {};
        }
    }

    /**
     * Remove patches older than the current API data
     * Called after loadPatches() to clean up stale patches
     */
    purgeStalePatches() {
        if (!this.lastFetchTimestamp) {
            return; // No API data loaded yet
        }

        let purgedCount = 0;
        const keysToDelete = [];

        for (const [key, patch] of Object.entries(this.pricePatchs)) {
            // Check for corrupted/invalid patches or stale timestamps
            if (!patch || !patch.timestamp || patch.timestamp < this.lastFetchTimestamp) {
                keysToDelete.push(key);
                purgedCount++;
            }
        }

        // Remove stale patches
        for (const key of keysToDelete) {
            delete this.pricePatchs[key];
        }

        if (purgedCount > 0) {
            console.log(`[MarketAPI] Purged ${purgedCount} stale price patches`);
            // Save cleaned patches
            this.savePatches();
        }
    }

    /**
     * Save price patches to storage
     */
    savePatches() {
        storage.setJSON(this.CACHE_KEY_PATCHES, this.pricePatchs, 'settings', true);
    }

    /**
     * Clear cache and fetch fresh market data
     * @returns {Promise<Object|null>} Fresh market data or null if failed
     */
    async clearCacheAndRefetch() {
        // Clear storage cache
        await storage.delete(this.CACHE_KEY_DATA, 'settings');
        await storage.delete(this.CACHE_KEY_TIMESTAMP, 'settings');

        // Clear in-memory state
        this.marketData = null;
        this.lastFetchTimestamp = null;

        // Force fresh fetch
        return await this.fetch(true);
    }

    /**
     * Register a listener for price updates
     * @param {Function} callback - Called when prices update
     */
    on(callback) {
        this.listeners.push(callback);
    }

    /**
     * Unregister a listener
     * @param {Function} callback - The callback to remove
     */
    off(callback) {
        this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    /**
     * Notify all listeners that prices have been updated
     */
    notifyListeners() {
        for (const callback of this.listeners) {
            try {
                callback();
            } catch (error) {
                console.error('[MarketAPI] Listener error:', error);
            }
        }
    }
}

const marketAPI = new MarketAPI();

export default marketAPI;
