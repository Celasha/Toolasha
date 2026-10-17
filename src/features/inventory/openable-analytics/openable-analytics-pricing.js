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
