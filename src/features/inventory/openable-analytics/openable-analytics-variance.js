/**
 * Openable Analytics Variance
 * Derives the standard deviation of total income from N openings of a container, purely from
 * its drop table (`openableLootDropMap`) - no historical sampling required. Reuses the same
 * per-item sell-side pricing/tax convention as the Expected Value calculator so this stays
 * consistent with the E[income] figure it's paired with.
 */

import dataManager from '../../../core/data-manager.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';
import { calculatePriceAfterTax } from '../../../utils/profit-helpers.js';
import { MARKET_TAX } from '../../../utils/profit-constants.js';

/**
 * Variance of one drop table row's value contribution to a single container opening.
 *
 * Modeled as X = Occurs * Q * price, where Occurs ~ Bernoulli(dropRate) and Q is a discrete
 * uniform count over [minCount, maxCount], independent of Occurs. For independent B and Q:
 *   Var[B*Q] = p*Var[Q] + p*(1-p)*E[Q]^2
 * (derived from Var[B*Q] = E[B]*E[Q^2] - (E[B]*E[Q])^2 using E[B^2] = E[B] = p for a 0/1 variable)
 * Var[Q] for a discrete uniform over n = maxCount - minCount + 1 integers is (n^2 - 1) / 12.
 * @param {Object} drop - One `openableLootDropMap` entry
 * @returns {number} Variance contribution in currency^2, or 0 if the drop can't be priced
 */
function dropValueVariance(drop) {
    const p = drop?.dropRate || 0;
    if (p <= 0) return 0;

    const minCount = drop?.minCount || 0;
    const maxCount = drop?.maxCount || 0;
    const n = maxCount - minCount + 1;
    const countVariance = n > 1 ? (n * n - 1) / 12 : 0;
    const avgCount = (minCount + maxCount) / 2;

    const resolved = expectedValueCalculator.resolveSellSideValue(drop.itemHrid);
    if (!resolved) return 0;

    const itemDetails = dataManager.getItemDetails(drop.itemHrid);
    const isTradable = itemDetails?.isTradable !== false;
    const isCoin = drop.itemHrid === expectedValueCalculator.COIN_HRID;
    const perUnitValue = isCoin || !isTradable ? resolved.value : calculatePriceAfterTax(resolved.value, MARKET_TAX);

    return perUnitValue * perUnitValue * (p * countVariance + p * (1 - p) * avgCount * avgCount);
}

/**
 * Variance of total income from a single opening of this container, summing every drop table
 * row's contribution under an independence assumption across rows (the same assumption the
 * existing Expected Value calculator makes when summing each row's mean contribution).
 * @param {string} containerHrid
 * @returns {number|null} Variance in currency^2, or null if there's no drop table to model
 */
export function calculatePerOpeningVariance(containerHrid) {
    const dropTable = dataManager.getInitClientData?.()?.openableLootDropMap?.[containerHrid];
    if (!Array.isArray(dropTable) || dropTable.length === 0) return null;

    return dropTable.reduce((sum, drop) => sum + dropValueVariance(drop), 0);
}

/**
 * Standard deviation of total income from `containerCount` independent openings of this
 * container (variance scales linearly with the number of i.i.d. openings).
 * @param {string} containerHrid
 * @param {number} containerCount
 * @returns {number|null} Standard deviation in currency, or null if unavailable
 */
export function calculateIncomeStdDev(containerHrid, containerCount) {
    if (!(containerCount > 0)) return null;
    const perOpeningVariance = calculatePerOpeningVariance(containerHrid);
    if (perOpeningVariance === null) return null;

    return Math.sqrt(perOpeningVariance * containerCount);
}

export default {
    calculatePerOpeningVariance,
    calculateIncomeStdDev,
};
