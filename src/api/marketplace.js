/**
 * Marketplace API Module
 * Fetches and caches market price data from the MWI marketplace API
 */

import storage from '../core/storage.js';

/**
 * MarketAPI class handles fetching and caching market price data
 */
class MarketAPI {
    constructor() {
        // API endpoint
        this.API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

        // Cache settings
        this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
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
        console.log('[MarketAPI] Fetching market data...');

        // Check cache first (unless force fetch)
        if (!forceFetch) {
            const cached = this.getCachedData();
            if (cached) {
                console.log('[MarketAPI] Using cached data');
                this.marketData = cached.data;
                this.lastFetchTimestamp = cached.timestamp;
                return this.marketData;
            }
        }

        // Try to fetch fresh data
        try {
            const response = await this.fetchFromAPI();

            if (response) {
                // Cache the fresh data
                this.cacheData(response);
                this.marketData = response.marketData;
                this.lastFetchTimestamp = response.timestamp;
                console.log('[MarketAPI] ✅ Fetched fresh data');
                return this.marketData;
            }
        } catch (error) {
            this.logError('Fetch failed', error);
        }

        // Fallback: Try to use expired cache
        const expiredCache = storage.getJSON(this.CACHE_KEY_DATA, null);
        if (expiredCache) {
            console.warn('[MarketAPI] Using expired cache as fallback');
            this.marketData = expiredCache.marketData;
            this.lastFetchTimestamp = expiredCache.timestamp;
            return this.marketData;
        }

        // Total failure
        console.error('[MarketAPI] ❌ No market data available');
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
     * @returns {Object|null} { data, timestamp } or null if invalid/expired
     */
    getCachedData() {
        const cachedTimestamp = storage.get(this.CACHE_KEY_TIMESTAMP, null);
        const cachedData = storage.getJSON(this.CACHE_KEY_DATA, null);

        if (!cachedTimestamp || !cachedData) {
            return null;
        }

        // Check if cache is still valid
        const now = Date.now();
        const age = now - cachedTimestamp;

        if (age > this.CACHE_DURATION) {
            console.log(`[MarketAPI] Cache expired (${Math.round(age / 1000 / 60)} minutes old)`);
            return null;
        }

        return {
            data: cachedData.marketData,
            timestamp: cachedData.timestamp
        };
    }

    /**
     * Cache market data
     * @param {Object} data - API response to cache
     */
    cacheData(data) {
        storage.setJSON(this.CACHE_KEY_DATA, data);
        storage.set(this.CACHE_KEY_TIMESTAMP, Date.now());
        console.log('[MarketAPI] Data cached');
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

        return {
            ask: price.a || 0,  // Sell price
            bid: price.b || 0   // Buy price
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
            error: error?.message || String(error)
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
}

// Create and export singleton instance
const marketAPI = new MarketAPI();

export default marketAPI;
