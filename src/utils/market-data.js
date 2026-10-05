/**
 * Market Data Utility
 * Centralized access to market prices with smart pricing mode handling
 */

import marketAPI from '../api/marketplace.js';
import marketValuesAPI from '../api/market-values.js';
import config from '../core/config.js';
import { getCustomPrice } from '../features/settings/custom-price-overrides.js';

// Track logged warnings to prevent console spam
const loggedWarnings = new Set();

/**
 * Get item price based on pricing mode and context
 * @param {string} itemHrid - Item HRID
 * @param {Object} options - Configuration options
 * @param {number} [options.enhancementLevel=0] - Enhancement level
 * @param {string} [options.mode] - Pricing mode ('ask'|'bid'|'average'). If not provided, uses context or user settings
 * @param {string} [options.context] - Context hint ('profit'|'networth'|null). Used to determine pricing mode from settings
 * @param {string} [options.side='sell'] - Transaction side ('buy'|'sell') - used with 'profit' context to determine correct price
 * @returns {number|null} Price in gold, or null if no market data
 */
export function getItemPrice(itemHrid, options = {}) {
    return resolveItemPrice(itemHrid, options).value;
}

/**
 * Resolve an item price along with whether the market-data outlier guard substituted it.
 * Same resolution logic/options as getItemPrice(), for callers that want to show a warning
 * icon when a live price was replaced by the reference market value.
 * @param {string} itemHrid
 * @param {Object} options - Same shape as getItemPrice()
 * @returns {{value: number|null, isOutlier: boolean}}
 */
export function getItemPriceOutlierInfo(itemHrid, options = {}) {
    return resolveItemPrice(itemHrid, options);
}

function resolveItemPrice(itemHrid, options = {}) {
    // Validate inputs
    if (!itemHrid || typeof itemHrid !== 'string') {
        return { value: null, isOutlier: false };
    }

    // Handle case where someone passes enhancementLevel as second arg (old API)
    if (typeof options === 'number') {
        options = { enhancementLevel: options };
    }

    // Ensure options is an object
    if (typeof options !== 'object' || options === null) {
        options = {};
    }

    const { enhancementLevel = 0, mode, context, side = 'sell' } = options;

    // Check for custom price override - a user-set price is never second-guessed
    const customPrice = getCustomPrice(itemHrid, enhancementLevel, side);
    if (customPrice !== null) {
        return { value: customPrice, isOutlier: false };
    }

    // Get raw price data from API
    const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

    if (!priceData) {
        return { value: null, isOutlier: false };
    }

    // Determine pricing mode
    const pricingMode = mode || getPricingMode(context, side);

    const resolveSide = (value) => {
        if (typeof value !== 'number' || value < 0) {
            return { value: null, isOutlier: false };
        }

        return marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, value);
    };

    // Validate pricing mode
    const validModes = ['ask', 'bid', 'average'];
    if (!validModes.includes(pricingMode)) {
        const warningKey = `mode:${pricingMode}`;
        if (!loggedWarnings.has(warningKey)) {
            console.warn(`[Market Data] Unknown pricing mode: ${pricingMode}, defaulting to ask`);
            loggedWarnings.add(warningKey);
        }
        return marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, priceData.ask || 0);
    }

    // Return price based on mode
    switch (pricingMode) {
        case 'ask':
            return resolveSide(priceData.ask);
        case 'bid':
            return resolveSide(priceData.bid);
        case 'average': {
            if (typeof priceData.ask !== 'number' || typeof priceData.bid !== 'number') {
                return { value: null, isOutlier: false };
            }

            if (priceData.ask < 0 || priceData.bid < 0) {
                return { value: null, isOutlier: false };
            }

            const askResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, priceData.ask);
            const bidResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, priceData.bid);
            return {
                value: (askResult.value + bidResult.value) / 2,
                isOutlier: askResult.isOutlier || bidResult.isOutlier,
            };
        }
        default:
            return resolveSide(priceData.ask);
    }
}

/**
 * Get all price variants for an item
 * @param {string} itemHrid - Item HRID
 * @param {number} [enhancementLevel=0] - Enhancement level
 * @returns {Object|null} Object with {ask, bid, average, askOutlier, bidOutlier} or null
 */
export function getItemPrices(itemHrid, enhancementLevel = 0) {
    const priceData = marketAPI.getPrice(itemHrid, enhancementLevel);

    if (!priceData) {
        return null;
    }

    const askResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, priceData.ask);
    const bidResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, priceData.bid);

    return {
        ask: askResult.value,
        bid: bidResult.value,
        average: (askResult.value + bidResult.value) / 2,
        askOutlier: askResult.isOutlier,
        bidOutlier: bidResult.isOutlier,
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
    const { decimals = 1, showZero = true } = options;

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
 * @param {string} [side='sell'] - Transaction side ('buy'|'sell') - used with 'profit' context
 * @returns {string} Pricing mode ('ask'|'bid'|'average')
 */
export function getPricingMode(context, side = 'sell') {
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

            // Convert profit calculation modes to price types based on transaction side
            // Conservative: Ask/Bid (instant buy materials, instant sell output)
            // Hybrid: Ask/Ask (instant buy materials, patient sell output)
            // Optimistic: Bid/Ask (patient buy materials, patient sell output)
            // Patient Buy: Bid/Bid (patient buy materials, instant sell output)
            let selectedPriceType;
            switch (profitMode) {
                case 'conservative':
                    selectedPriceType = side === 'buy' ? 'ask' : 'bid';
                    break;
                case 'hybrid':
                    selectedPriceType = 'ask'; // Ask for both buy and sell
                    break;
                case 'optimistic':
                    selectedPriceType = side === 'buy' ? 'bid' : 'ask';
                    break;
                case 'patientBuy':
                    selectedPriceType = 'bid'; // Bid for both buy and sell
                    break;
                default:
                    selectedPriceType = 'ask';
            }
            return selectedPriceType;
        }
        case 'networth': {
            return config.getSettingValue('networth_pricingMode') || 'ask';
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
 * @param {string} [options.side='sell'] - Transaction side ('buy'|'sell')
 * @returns {Map<string, number>} Map of itemHrid+enhancementLevel to price
 */
export function getItemPricesBatch(items, options = {}) {
    const result = new Map();

    for (const item of items) {
        const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
        const price = getItemPrice(item.itemHrid, {
            enhancementLevel: item.enhancementLevel || 0,
            mode: options.mode,
            context: options.context,
            side: options.side,
        });

        if (price !== null) {
            result.set(key, price);
        }
    }

    return result;
}

export default {
    getItemPrice,
    getItemPriceOutlierInfo,
    getItemPrices,
    formatPrice,
    getPricingMode,
    getItemPricesBatch,
};
