/**
 * Market Data Utility
 * Centralized access to market prices with smart pricing mode handling
 */

import marketAPI from '../api/marketplace.js';
import config from '../core/config.js';

// Track logged warnings to prevent console spam
const loggedWarnings = new Set();

/**
 * Get item price based on pricing mode and context
 * @param {string} itemHrid - Item HRID
 * @param {Object} options - Configuration options
 * @param {number} [options.enhancementLevel=0] - Enhancement level
 * @param {string} [options.mode] - Pricing mode ('ask'|'bid'|'average'). If not provided, uses context or user settings
 * @param {string} [options.context] - Context hint ('profit'|'networth'|null). Used to determine pricing mode from settings
 * @returns {number|null} Price in gold, or null if no market data
 */
export function getItemPrice(itemHrid, options = {}) {
    // Validate inputs
    if (!itemHrid || typeof itemHrid !== 'string') {
        return null;
    }

    // Handle case where someone passes enhancementLevel as second arg (old API)
    if (typeof options === 'number') {
        options = { enhancementLevel: options };
    }

    // Ensure options is an object
    if (typeof options !== 'object' || options === null) {
        options = {};
    }

    const {
        enhancementLevel = 0,
        mode,
        context
    } = options;

    // Get raw price data from API
    const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

    if (!priceData) {
        return null;
    }

    // Determine pricing mode
    const pricingMode = mode || getPricingMode(context);

    // Validate pricing mode
    const validModes = ['ask', 'bid', 'average'];
    if (!validModes.includes(pricingMode)) {
        const warningKey = `mode:${pricingMode}`;
        if (!loggedWarnings.has(warningKey)) {
            console.warn(`[Market Data] Unknown pricing mode: ${pricingMode}, defaulting to ask`);
            loggedWarnings.add(warningKey);
        }
        return priceData.ask || 0;
    }

    // Return price based on mode
    switch (pricingMode) {
        case 'ask':
            return priceData.ask || 0;
        case 'bid':
            return priceData.bid || 0;
        case 'average':
            return ((priceData.ask || 0) + (priceData.bid || 0)) / 2;
        default:
            return priceData.ask || 0;
    }
}

/**
 * Get all price variants for an item
 * @param {string} itemHrid - Item HRID
 * @param {number} [enhancementLevel=0] - Enhancement level
 * @returns {Object|null} Object with {ask, bid, average} or null if no market data
 */
export function getItemPrices(itemHrid, enhancementLevel = 0) {
    const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

    if (!priceData) {
        return null;
    }

    return {
        ask: priceData.ask,
        bid: priceData.bid,
        average: (priceData.ask + priceData.bid) / 2
    };
}

/**
 * Format price with K/M/B suffixes
 * @param {number} amount - Amount to format
 * @param {Object} options - Formatting options
 * @param {number} [options.decimals=1] - Number of decimal places
 * @param {boolean} [options.showZero=true] - Whether to show '0' for zero values
 * @returns {string} Formatted price string
 */
export function formatPrice(amount, options = {}) {
    const {
        decimals = 1,
        showZero = true
    } = options;

    if (amount === null || amount === undefined) {
        return '--';
    }

    if (amount === 0) {
        return showZero ? '0' : '--';
    }

    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';

    if (absAmount >= 1_000_000_000) {
        return `${sign}${(absAmount / 1_000_000_000).toFixed(decimals)}B`;
    } else if (absAmount >= 1_000_000) {
        return `${sign}${(absAmount / 1_000_000).toFixed(decimals)}M`;
    } else if (absAmount >= 1_000) {
        return `${sign}${(absAmount / 1_000).toFixed(decimals)}K`;
    } else {
        return `${sign}${absAmount.toFixed(decimals)}`;
    }
}

/**
 * Determine pricing mode from context and user settings
 * @param {string} [context] - Context hint ('profit'|'networth'|null)
 * @returns {string} Pricing mode ('ask'|'bid'|'average')
 */
export function getPricingMode(context) {
    // If no context, default to 'ask'
    if (!context) {
        return 'ask';
    }

    // Validate context is a string
    if (typeof context !== 'string') {
        return 'ask';
    }

    // Get pricing mode from settings based on context
    switch (context) {
        case 'profit': {
            const profitMode = config.getSettingValue('profitCalc_pricingMode');

            // Convert profit calculation modes to price types
            // For EV/profit context, we're calculating sell-side value
            switch (profitMode) {
                case 'conservative':
                    return 'bid'; // Instant sell (Bid price)
                case 'hybrid':
                case 'optimistic':
                    return 'ask'; // Patient sell (Ask price)
                default:
                    return 'ask';
            }
        }
        case 'networth': {
            const networthMode = config.getSettingValue('networth_pricingMode');
            return networthMode || 'average';
        }
        default: {
            const warningKey = `context:${context}`;
            if (!loggedWarnings.has(warningKey)) {
                console.warn(`[Market Data] Unknown context: ${context}, defaulting to ask`);
                loggedWarnings.add(warningKey);
            }
            return 'ask';
        }
    }
}

/**
 * Get prices for multiple items in batch
 * @param {Array<{itemHrid: string, enhancementLevel?: number}>} items - Array of items to price
 * @param {Object} options - Configuration options
 * @param {string} [options.mode] - Pricing mode ('ask'|'bid'|'average')
 * @param {string} [options.context] - Context hint ('profit'|'networth'|null)
 * @returns {Map<string, number>} Map of itemHrid+enhancementLevel to price
 */
export function getItemPricesBatch(items, options = {}) {
    const result = new Map();

    for (const item of items) {
        const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
        const price = getItemPrice(item.itemHrid, {
            enhancementLevel: item.enhancementLevel || 0,
            mode: options.mode,
            context: options.context
        });

        if (price !== null) {
            result.set(key, price);
        }
    }

    return result;
}

export default {
    getItemPrice,
    getItemPrices,
    formatPrice,
    getPricingMode,
    getItemPricesBatch
};
