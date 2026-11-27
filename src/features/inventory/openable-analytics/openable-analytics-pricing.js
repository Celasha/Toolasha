/**
 * Openable Analytics pricing options
 * Single source for whether untradeable drops (capes, seals, shop tokens) are valued through
 * the shop-redemption chain, so Actual, Expected, variance and the side panel share one basis.
 */

import config from '../../../core/config.js';

/**
 * Whether drops with no market price should be valued via shop redemption.
 * Only an explicit `false` disables it, so a missing/unreadable setting keeps the default (on).
 * @returns {boolean}
 */
export function allowIndirectPricing() {
    return config.getSetting('openableAnalytics_valueUntradeables') !== false;
}

/**
 * Whether a drop priced on only one side of the order book (e.g. asks but no buy orders) should be
 * valued at the side that exists. Only an explicit `false` disables it (default on).
 * @returns {boolean}
 */
export function allowOtherSidePricing() {
    return config.getSetting('expectedValue_otherSideFallback') !== false;
}

/**
 * The full set of pricing options Openable Analytics passes to the shared resolver, so Actual,
 * Expected, variance and the side panel all share one value basis.
 * @returns {{allowIndirect: boolean, allowOtherSide: boolean}}
 */
export function openableValuationOptions() {
    return { allowIndirect: allowIndirectPricing(), allowOtherSide: allowOtherSidePricing() };
}
