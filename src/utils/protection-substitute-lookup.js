/**
 * Protection Substitute Lookup
 * Detects items that are real, data-backed substitutes for enhancement-protection consumables
 * (e.g. a dungeon-chest drop that can be sacrificed as protection instead of buying a Mirror of
 * Protection), and suggests a proxy sell price for them when they have no direct market price.
 */

import dataManager from '../core/data-manager.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';

/**
 * Always a valid protection sacrifice for ANY equipment, per its own item description
 * ("functions as a copy of any equipment for enhancing protection") - confirmed it never
 * appears in any item's own protectionItemHrids list (that field only enumerates item-specific
 * substitutes), so it can't be found by the reverse lookup below and must be special-cased.
 * Philosopher's Mirror exists too but is a guaranteed-success item worth ~50x more - not a
 * meaningful "basic protection" cost baseline, so it's deliberately excluded here.
 */
const UNIVERSAL_PROTECTION_ITEM_HRID = '/items/mirror_of_protection';

function getSubstituteHrids() {
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
    const hrids = new Set();
    for (const details of Object.values(itemDetailMap)) {
        for (const hrid of details.protectionItemHrids || []) {
            hrids.add(hrid);
        }
    }
    return hrids;
}

/**
 * @param {string} itemHrid
 * @returns {boolean} True if itemHrid appears in some other item's protectionItemHrids list,
 *      i.e. it's a real substitute for that item's enhancement protection.
 */
export function isProtectionSubstitute(itemHrid) {
    return getSubstituteHrids().has(itemHrid);
}

/**
 * Suggest a proxy sell price for an unpriceable item that's a real protection substitute,
 * based on the universal protection item's own current sell price - same pricing mode/outlier
 * handling as every other row in the same EV table, via expectedValueCalculator.
 * @param {string} itemHrid
 * @returns {{price: number, isOutlier: boolean, viaItemHrid: string}|null} null when itemHrid
 *      isn't a known protection substitute, or the universal item itself has no price data.
 */
export function suggestProtectionSubstituteProxyPrice(itemHrid) {
    if (!isProtectionSubstitute(itemHrid)) return null;

    const priceInfo = expectedValueCalculator.getDropPriceInfo(UNIVERSAL_PROTECTION_ITEM_HRID);
    if (priceInfo.value === null) return null;

    return {
        price: priceInfo.value,
        isOutlier: priceInfo.isOutlier,
        viaItemHrid: UNIVERSAL_PROTECTION_ITEM_HRID,
    };
}
