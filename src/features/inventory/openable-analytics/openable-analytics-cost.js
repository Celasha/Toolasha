/**
 * Openable Analytics Cost
 * Resolves the recurring cost of opening a container: the current buy price of its required key
 * item (`openKeyItemHrid`), if any. Containers themselves are typically earned as drops/rewards
 * rather than purchased, so only the consumable key - the one thing actually spent on every
 * single opening - counts as cost here.
 */

import dataManager from '../../../core/data-manager.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';

/**
 * Calculate the total cost of opening `containerCount` copies of this container.
 * @param {string} containerHrid
 * @param {number} containerCount
 * @returns {{cost: number, complete: boolean}} Total key cost, and whether it could be fully
 *      priced (a container with no key requirement is always complete with cost 0).
 */
export function calculateOpeningCost(containerHrid, containerCount) {
    if (!(containerCount > 0)) return { cost: 0, complete: true };

    const keyItemHrid = dataManager.getItemDetails(containerHrid)?.openKeyItemHrid;
    if (!keyItemHrid) return { cost: 0, complete: true };

    const resolved = expectedValueCalculator.resolveBuySideValue(keyItemHrid);
    if (!resolved) return { cost: 0, complete: false };

    return { cost: resolved.value * containerCount, complete: true };
}

export default {
    calculateOpeningCost,
};
