/**
 * Openable Analytics Cost
 * Resolves the recurring cost of opening a container: the current buy price of its required key
 * item (`openKeyItemHrid`), if any. Containers themselves are typically earned as drops/rewards
 * rather than purchased, so only the consumable key - the one thing actually spent on every
 * single opening - counts as cost here. For dungeon chests, also resolves the separate entry-key
 * cost of the dungeon run that produced the chest (see calculateEntryKeyCost).
 */

import dataManager from '../../../core/data-manager.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';
import { DUNGEON_ENTRY_KEYS } from '../../combat-sim/combat-sim-adapter.js';
import { getKeyPriceInfo } from '../../../utils/dungeon-key-cost.js';

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

/**
 * Calculate the dungeon entry-key cost behind `containerCount` copies of this REGULAR dungeon
 * chest. One entry key is spent per dungeon run, and every run grants exactly one regular chest
 * (plus a chance of an extra refinement chest riding along on that same key) - so entry-key cost
 * only applies to regular chest hrids, which is exactly what DUNGEON_ENTRY_KEYS maps. Priced via
 * the dedicated profitCalc_keyPricingMode setting (ask/bid/cheapest-via-crafting), matching every
 * other dungeon-economics feature in this codebase (risk-of-ruin, combat stats, combat sim) that
 * already prices this same key - not the generic buy-side pricing calculateOpeningCost() uses for
 * the chest's own key.
 * @param {string} containerHrid
 * @param {number} containerCount
 * @returns {{cost: number, complete: boolean}|null} null when containerHrid isn't a dungeon's
 *      regular chest (no entry key applies - most containers, including refinement chests).
 */
export function calculateEntryKeyCost(containerHrid, containerCount) {
    const entryKeyHrid = DUNGEON_ENTRY_KEYS[containerHrid];
    if (!entryKeyHrid) return null;
    if (!(containerCount > 0)) return { cost: 0, complete: true };

    const { price } = getKeyPriceInfo(entryKeyHrid);
    if (price === null) return { cost: 0, complete: false };

    return { cost: price * containerCount, complete: true };
}

export default {
    calculateOpeningCost,
    calculateEntryKeyCost,
};
