/**
 * Untradable Cape Value
 *
 * Capes (Chance, Gatherer, Artificer, Culinary, Sinister), the Chimerical Quiver, the Enchanted
 * Cloak and their refined versions cannot be traded, so they never have a market price. Anything that prices a cape (alchemy profit, the
 * enhancement path, net worth, chest EV) would otherwise drop it or treat it as free by accident.
 * This module owns the single decision of what an unrefined cape's base value is: nothing (the
 * default, matching how the enhancement path already behaved) or the price of a Mirror of
 * Protection, which functions as a copy of any equipment.
 *
 * Refined and enhanced values are built on top of this base by the callers (base value + refinement
 * cost + average enhancement cost); see features/enhancement/untradable-cape-value.js.
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { getItemPrice } from './market-data.js';

export const CAPE_BASE_VALUE_SETTING = 'untradableCapeBaseValue';
export const CAPE_BASE_VALUE_ZERO = 'zero';
export const CAPE_BASE_VALUE_MIRROR = 'mirror';

const MIRROR_OF_PROTECTION_HRID = '/items/mirror_of_protection';
// The Chimerical Quiver and Enchanted Cloak are the ranged and magic equivalents of the capes
const CAPE_HRID_PATTERN = /^\/items\/[a-z]+_(cape|quiver|cloak)(_refined)?$/;
const REFINED_CAPE_PATTERN = /_(cape|quiver|cloak)_refined$/;

/**
 * @param {string} itemHrid
 * @returns {boolean} True for a cape that has no market because it cannot be traded
 */
export function isUntradableCape(itemHrid) {
    if (typeof itemHrid !== 'string' || !CAPE_HRID_PATTERN.test(itemHrid)) {
        return false;
    }
    return dataManager.getItemDetails(itemHrid)?.isTradable !== true;
}

/**
 * @param {string} itemHrid
 * @returns {boolean} True for the refined version of a cape
 */
export function isRefinedCape(itemHrid) {
    return typeof itemHrid === 'string' && REFINED_CAPE_PATTERN.test(itemHrid);
}

/**
 * Value assumed for one unrefined, unenhanced cape.
 * @param {'buy'|'sell'} [side='buy'] - Price side used when the Mirror of Protection is the stand-in
 * @returns {number} 0, or the Mirror of Protection price when the setting is on "mirror"
 */
export function getCapeBaseValue(side = 'buy') {
    if (config.getSettingValue(CAPE_BASE_VALUE_SETTING, CAPE_BASE_VALUE_ZERO) !== CAPE_BASE_VALUE_MIRROR) {
        return 0;
    }
    return getItemPrice(MIRROR_OF_PROTECTION_HRID, { context: 'profit', side }) || 0;
}

/**
 * Current setting value, for use in cache keys.
 * @returns {string}
 */
export function getCapeBaseValueMode() {
    return config.getSettingValue(CAPE_BASE_VALUE_SETTING, CAPE_BASE_VALUE_ZERO) === CAPE_BASE_VALUE_MIRROR
        ? CAPE_BASE_VALUE_MIRROR
        : CAPE_BASE_VALUE_ZERO;
}
