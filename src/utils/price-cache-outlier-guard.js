/**
 * Shared outlier-guard helper for consumers that bypass market-data.js and batch-fetch prices
 * directly via marketAPI.getPricesBatch() for performance (net worth, inventory badges - both
 * price hundreds of items per render and can't afford a per-item market-data.js round trip).
 * Runs every entry through the market-data outlier guard, mutating ask/bid in place when either
 * side is substituted, and returns the set of flagged "itemHrid:enhancementLevel" keys so
 * callers can show a warning icon on the affected rows/badges.
 */

import marketValuesAPI from '../api/market-values.js';

/**
 * @param {Map<string, {ask: number, bid: number}>} priceCache - From marketAPI.getPricesBatch()
 * @returns {Set<string>} The "itemHrid:enhancementLevel" keys that were flagged
 */
export function applyOutlierGuardToPriceCache(priceCache) {
    const outlierKeys = new Set();

    for (const [key, prices] of priceCache.entries()) {
        if (!prices || typeof prices !== 'object') {
            continue;
        }

        const colonIndex = key.lastIndexOf(':');
        const itemHrid = key.slice(0, colonIndex);
        const enhancementLevel = Number(key.slice(colonIndex + 1)) || 0;

        const askResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, prices.ask);
        const bidResult = marketValuesAPI.checkOutlier(itemHrid, enhancementLevel, prices.bid);

        if (askResult.isOutlier || bidResult.isOutlier) {
            outlierKeys.add(key);
        }

        prices.ask = askResult.value;
        prices.bid = bidResult.value;
    }

    return outlierKeys;
}
