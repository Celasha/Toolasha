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

import { getAutoDetectedParams } from '../../utils/enhancement-config.js';
import { getCapeBaseValue, isRefinedCape, isUntradableCape } from '../../utils/untradable-cape.js';
import { calculateEnhancementPath, getRealisticBaseItemPrice } from './tooltip-enhancement.js';

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
        const path = calculateEnhancementPath(itemHrid, enhancementLevel, getAutoDetectedParams());
        const totalCost = path?.optimalStrategy?.totalCost;
        if (totalCost > 0) {
            return totalCost;
        }
    } catch (error) {
        console.error('[UntradableCapeValue] Enhancement path failed for', itemHrid, enhancementLevel, error);
    }
    return levelZeroValue;
}
