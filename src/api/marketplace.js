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

        // Current market data
        this.marketData = null;
        this.lastFetchTimestamp = null;
        this.errorLog = [];
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
                this.lastFetchTimestamp = cached.timestamp;
                // Hide alert on successful cache load
                networkAlert.hide();
                return this.marketData;
            }
        }

        if (!connectionState.isConnected()) {
            const cachedFallback = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (cachedFallback?.marketData) {
                this.marketData = cachedFallback.marketData;
                this.lastFetchTimestamp = cachedFallback.timestamp;
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
                this.lastFetchTimestamp = response.timestamp;
                // Hide alert on successful fetch
                networkAlert.hide();
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
            this.lastFetchTimestamp = expiredCache.timestamp;
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

        const normalizeMarketPriceValue = (value) => {
            if (typeof value !== 'number') {
                return null;
            }

            if (value < 0) {
                return null;
            }

            return value;
        };

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
}

const marketAPI = new MarketAPI();

export default marketAPI;
