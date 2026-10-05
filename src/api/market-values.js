/**
 * Market Values API Module
 * Fetches and caches the game's own reference "market value" estimates
 * (https://www.milkywayidle.com/game_data/market_values.json) - the same endpoint the game
 * client itself fetches and caches. Each item maps to an array of one blended price estimate
 * per enhancement level (or a single entry for non-enhanceable items), distinct from the live
 * ask/bid order-book data in marketplace.js. Used as a last-resort fallback price source for
 * items with no live order-book data and no computable crafting/shop cost.
 */

import storage from '../core/storage.js';
import config from '../core/config.js';
import { createTimerRegistry } from '../utils/timer-registry.js';

/**
 * MarketValuesAPI class handles fetching and caching the game's reference market values
 */
class MarketValuesAPI {
    constructor() {
        this.API_URL = 'https://www.milkywayidle.com/game_data/market_values.json';

        // Cache settings - this is a slow-moving reference value, not live order-book data
        this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour
        this.CACHE_KEY_DATA = 'Toolasha_marketValuesAPI_json';
        this.CACHE_KEY_TIMESTAMP = 'Toolasha_marketValuesAPI_timestamp';

        // { "<bare_item_name>": [priceAtLvl0, priceAtLvl1, ...] | [price] }
        this.marketItemValues = null;
        this.marketValuesVersion = 0;

        this.timerRegistry = createTimerRegistry();
        this.autoRefreshStarted = false;
    }

    /**
     * Fetch market values from API or cache
     * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
     * @returns {Promise<Object|null>} marketItemValues object or null if unavailable
     */
    async fetch(forceFetch = false) {
        if (!forceFetch) {
            const cached = await this.getCachedData();
            if (cached) {
                this.marketItemValues = cached.marketItemValues;
                this.marketValuesVersion = cached.marketValuesVersion || 0;
                return this.marketItemValues;
            }
        }

        try {
            const data = await this.fetchFromAPI();
            if (data) {
                this.marketItemValues = data.marketItemValues;
                this.marketValuesVersion = data.marketValuesVersion || 0;
                this.cacheData(data);
                return this.marketItemValues;
            }
        } catch (error) {
            console.error('[MarketValuesAPI] Fetch failed:', error);
        }

        // Fallback: expired cache is still better than nothing for a slow-moving reference value
        const expired = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
        if (expired) {
            console.warn('[MarketValuesAPI] Using expired cache as fallback');
            this.marketItemValues = expired.marketItemValues;
            this.marketValuesVersion = expired.marketValuesVersion || 0;
            return this.marketItemValues;
        }

        return null;
    }

    /**
     * Start periodically re-checking the reference snapshot so a long-lived tab doesn't keep
     * serving values from whenever the page happened to load. Safe to call multiple times;
     * only the first call starts the interval.
     */
    startAutoRefresh() {
        if (this.autoRefreshStarted) {
            return;
        }
        this.autoRefreshStarted = true;

        const intervalId = setInterval(() => {
            this.fetch().catch((error) => {
                console.error('[MarketValuesAPI] Auto-refresh fetch failed:', error);
            });
        }, this.CACHE_DURATION);

        this.timerRegistry.registerInterval(intervalId);
    }

    /**
     * Stop the periodic re-fetch started by startAutoRefresh().
     */
    stopAutoRefresh() {
        this.timerRegistry.clearAll();
        this.autoRefreshStarted = false;
    }

    /**
     * Fetch from the API endpoint
     * @returns {Promise<Object|null>} { marketValuesVersion, marketItemValues } or null
     */
    async fetchFromAPI() {
        const response = await fetch(this.API_URL);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.marketItemValues || typeof data.marketItemValues !== 'object') {
            throw new Error('Invalid API response structure');
        }

        return data;
    }

    /**
     * Get cached data if still within CACHE_DURATION
     * @returns {Promise<Object|null>} { marketValuesVersion, marketItemValues } or null
     */
    async getCachedData() {
        const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
        const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

        if (!cachedTimestamp || !cachedData) {
            return null;
        }

        if (Date.now() - cachedTimestamp > this.CACHE_DURATION) {
            return null;
        }

        return cachedData;
    }

    /**
     * Cache the fetched data
     * @param {Object} data - { marketValuesVersion, marketItemValues }
     */
    cacheData(data) {
        storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
        storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
    }

    /**
     * Get the game's reference market value for an item at a given enhancement level.
     * Not ask/bid - a single blended estimate, intended as a last-resort fallback.
     * @param {string} itemHrid - e.g. "/items/sinister_cape"
     * @param {number} enhancementLevel - 0-20 (default 0)
     * @returns {number|null} Reference price, or null if unavailable
     */
    getValue(itemHrid, enhancementLevel = 0) {
        if (!this.marketItemValues || !itemHrid) {
            return null;
        }

        const bareName = itemHrid.replace('/items/', '');
        const levels = this.marketItemValues[bareName];
        if (!Array.isArray(levels)) {
            return null;
        }

        const value = levels[enhancementLevel];
        return typeof value === 'number' && value > 0 ? value : null;
    }

    /**
     * Check whether a live price is an "outlier" relative to the reference value, and return
     * the value to use instead. Never flags anything when the guard is disabled, or when there's
     * no reference value for this item/level at all (the 872-item dataset doesn't cover
     * everything, so there's nothing to compare against - the raw price always passes through).
     * @param {string} itemHrid
     * @param {number} enhancementLevel
     * @param {number} rawValue - The live ask/bid value to check
     * @returns {{value: number, isOutlier: boolean}}
     */
    checkOutlier(itemHrid, enhancementLevel, rawValue) {
        if (typeof rawValue !== 'number' || rawValue <= 0) {
            return { value: rawValue, isOutlier: false };
        }

        if (!config.getSetting('marketData_outlierGuardEnabled')) {
            return { value: rawValue, isOutlier: false };
        }

        const reference = this.getValue(itemHrid, enhancementLevel);
        if (!reference) {
            return { value: rawValue, isOutlier: false };
        }

        const multiplier = Number(config.getSettingValue('marketData_outlierBandMultiplier', 3)) || 3;
        if (rawValue > reference * multiplier || rawValue < reference / multiplier) {
            return { value: reference, isOutlier: true };
        }

        return { value: rawValue, isOutlier: false };
    }
}

const marketValuesAPI = new MarketValuesAPI();
export default marketValuesAPI;
export { MarketValuesAPI };
