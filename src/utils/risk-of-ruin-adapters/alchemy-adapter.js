/**
 * Alchemy Transmute Risk-of-Ruin Adapter
 *
 * Builds a two-outcome-per-attempt cost/payout model for a Transmute action, from
 * alchemyProfitCalculator.calculateTransmuteProfit() — the same per-attempt economics
 * (material cost net of self-return, catalyst cost, output drop-table EV, success rate) the
 * live action panel and best-item ranking already use, not a re-derived approximation.
 *
 * Catalyst is consumed only on success (per alchemy-profit-display.js's own label: "consumed
 * only on success"), so it is charged only in the success branch. Materials — including any
 * direct coin cost — are consumed on every attempt regardless of outcome.
 *
 * calculateTransmuteProfit() itself blends the success/fail split together into hourly EVs
 * (e.g. catalystCostPerHour, selfReturnValue are already scaled by successRate). This adapter
 * un-blends those back into the two discrete branches a single attempt can land in, using only
 * the function's public return fields — no private internals are touched.
 */

import alchemyProfitCalculator from '../../features/market/alchemy-profit-calculator.js';
import { drawFromDistribution } from '../risk-of-ruin-engine.js';

/**
 * Build the two-outcome risk-of-ruin model for repeatedly Transmuting one item.
 * @param {string} itemHrid - Item being transmuted.
 * @param {Object} [options]
 * @param {boolean} [options.useLiveSetup] - Use the currently-open action panel's live
 *   catalyst/tea selection instead of the automatically-best combination.
 * @returns {{
 *   cost: number,
 *   maxSinglePossibleLoss: number,
 *   outcomeDistribution: Array<{prob: number, net: number}>,
 *   stepFn: function(state: Object, rng: function(): number): Object,
 * }|null} null if the item isn't transmutable or has no usable market/success-rate data.
 */
export function buildAlchemyTransmuteModel(itemHrid, { useLiveSetup = false } = {}) {
    const profit = alchemyProfitCalculator.calculateTransmuteProfit(itemHrid, useLiveSetup);
    if (!profit || !(profit.successRate > 0)) return null;

    const coinCost = profit.requirementCosts.find((r) => r.itemHrid === '/items/coin')?.costPerAction ?? 0;
    const attemptCost = profit.grossMaterialCost + coinCost;
    const catalystCostOnSuccess = profit.catalystPrice || 0;
    const outputValueGivenSuccess = profit.incomePerAttempt / profit.successRate;
    const selfReturnGivenSuccess = profit.selfReturnValue / profit.successRate;

    const netOnSuccess = -attemptCost - catalystCostOnSuccess + outputValueGivenSuccess + selfReturnGivenSuccess;
    const netOnFail = -attemptCost;

    const outcomeDistribution = [
        { prob: profit.successRate, net: netOnSuccess },
        { prob: 1 - profit.successRate, net: netOnFail },
    ];

    return {
        cost: attemptCost,
        maxSinglePossibleLoss: Math.max(0, -netOnSuccess, -netOnFail),
        outcomeDistribution,
        stepFn: (state, rng) => ({ balance: state.balance + drawFromDistribution(outcomeDistribution, rng).net }),
    };
}
