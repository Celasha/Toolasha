/**
 * Untradable cape valuation (refined and enhanced)
 *
 * value = base cape value + refinement cost + average enhancement cost
 *
 * The base cape value comes from the cape setting (see utils/untradable-cape.js). Refinement and
 * enhancement costs come from the existing enhancement path, evaluated with the player's OWN
 * stats and equipped gear (not the manual enhancing parameters), since the point is to estimate
 * what the player has actually invested in a cape they cannot buy.
 */

import marketAPI from '../../api/marketplace.js';
import { getAutoDetectedParams } from '../../utils/enhancement-config.js';
import {
    getCapeBaseValue,
    getCapeBaseValueMode,
    isRefinedCape,
    isUntradableCape,
} from '../../utils/untradable-cape.js';
import { getCustomPriceOverrides } from '../settings/custom-price-overrides.js';
import { calculateEnhancementPath, getRealisticBaseItemPrice } from './tooltip-enhancement.js';

// The enhancement path is a full simulation and net worth asks for it on every inventory change, so
// the result is kept. It depends on the player's gear, teas and levels (the auto-detected params),
// the cape setting and custom prices, which are part of the key, and on market prices, which clear it.
const _pathCostCache = new Map();

marketAPI.on(() => _pathCostCache.clear());

/**
 * Drop every remembered cape enhancement cost.
 */
export function clearUntradableCapeValueCache() {
    _pathCostCache.clear();
}

/**
 * Average enhancement cost of a cape, or null when the path cannot be worked out.
 * @param {string} itemHrid
 * @param {number} enhancementLevel
 * @returns {number|null}
 */
function getEnhancementPathCost(itemHrid, enhancementLevel) {
    const params = getAutoDetectedParams();
    const key = `${itemHrid}|${enhancementLevel}|${getCapeBaseValueMode()}|${JSON.stringify(params)}|${JSON.stringify(
        getCustomPriceOverrides()
    )}`;
    if (_pathCostCache.has(key)) return _pathCostCache.get(key);

    const totalCost = calculateEnhancementPath(itemHrid, enhancementLevel, params)?.optimalStrategy?.totalCost;
    const cost = totalCost > 0 ? totalCost : null;
    _pathCostCache.set(key, cost);
    return cost;
}

/**
 * Value of an untradable cape at an enhancement level.
 * @param {string} itemHrid - Cape item HRID (base or refined)
 * @param {number} [enhancementLevel=0]
 * @returns {number|null} Value in coins, or null if the item is not an untradable cape
 */
export function getUntradableCapeValue(itemHrid, enhancementLevel = 0) {
    if (!isUntradableCape(itemHrid)) {
        return null;
    }

    const levelZeroValue = isRefinedCape(itemHrid) ? getRealisticBaseItemPrice(itemHrid) : getCapeBaseValue();
    if (!(enhancementLevel > 0)) {
        return levelZeroValue;
    }

    try {
        const totalCost = getEnhancementPathCost(itemHrid, enhancementLevel);
        if (totalCost !== null) {
            return totalCost;
        }
    } catch (error) {
        console.error('[UntradableCapeValue] Enhancement path failed for', itemHrid, enhancementLevel, error);
    }
    return levelZeroValue;
}
