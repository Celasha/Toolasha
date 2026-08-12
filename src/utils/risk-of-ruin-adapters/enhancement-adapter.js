/**
 * Enhancement Risk-of-Ruin Adapter
 *
 * Walks the same per-level success-rate / failure-destination / blessed-tea-skip transition
 * model as calculateEnhancement()'s exact Markov chain (src/utils/enhancement-calculator.js),
 * but as a step-by-step Monte Carlo walk against a gold balance instead of a closed-form
 * expectation. Every attempt costs materials (calculatePerAttemptMaterialCost, same value at
 * every level) regardless of outcome, plus a protection-item cost specifically when a
 * protected attempt fails.
 *
 * Unlike chests/alchemy, enhancing has no monetary payout branch at all — every outcome is a
 * pure cost, there is no "success revenue" modeled here (the target level itself is the goal,
 * not a resale value). That means the expected per-attempt gold change is always negative, so
 * the Lundberg bound is never meaningful for this mode (findAdjustmentCoefficient always
 * returns null) — only the Monte Carlo estimate applies. This is the correct, expected
 * behavior of a pure-cost process, not a defect; callers must surface it as such rather than
 * treating a `meaningful: false` result as broken.
 */

import dataManager from '../../core/data-manager.js';
import { calculateEnhancement } from '../enhancement-calculator.js';
import {
    calculatePerAttemptMaterialCost,
    getCheapestProtectionPrice,
} from '../../features/enhancement/tooltip-enhancement.js';
import { drawFromDistribution } from '../risk-of-ruin-engine.js';

/**
 * Build the per-level outcome list a single attempt at enhancement level `i` can produce,
 * mirroring calculateEnhancement()'s markov.set(...) transitions exactly.
 * @returns {Array<{prob: number, nextLevel: number, net: number}>}
 */
function buildLevelOutcomes({
    i,
    successChance,
    targetLevel,
    protectFrom,
    blessedTea,
    skipRatio,
    costPerAttempt,
    protectionCostOnFailure,
}) {
    const isProtected = protectFrom > 0 && i >= protectFrom;
    const failureDestination = isProtected ? i - 1 : 0;
    const failureNet = -(costPerAttempt + (isProtected ? protectionCostOnFailure : 0));

    const outcomes = [{ prob: 1 - successChance, nextLevel: failureDestination, net: failureNet }];

    if (blessedTea) {
        const skipChance = successChance * skipRatio;
        const remainingSuccess = successChance - skipChance;
        const normalDestination = Math.min(targetLevel, i + 1);
        const skipDestination = Math.min(targetLevel, i + 2);

        if (normalDestination === skipDestination) {
            outcomes.push({ prob: successChance, nextLevel: normalDestination, net: -costPerAttempt });
        } else {
            outcomes.push({ prob: remainingSuccess, nextLevel: normalDestination, net: -costPerAttempt });
            outcomes.push({ prob: skipChance, nextLevel: skipDestination, net: -costPerAttempt });
        }
    } else {
        outcomes.push({ prob: successChance, nextLevel: Math.min(targetLevel, i + 1), net: -costPerAttempt });
    }

    return outcomes;
}

/**
 * Build the level-by-level risk-of-ruin model for enhancing one item to a target level.
 * @param {string} itemHrid - Item being enhanced.
 * @param {Object} params - Same shape as calculateEnhancement()'s params (enhancingLevel,
 *   toolBonus, itemLevel, targetLevel, startLevel, protectFrom, blessedTea, guzzlingBonus, ...).
 * @returns {{
 *   costPerAttempt: number,
 *   protectionCostOnFailure: number,
 *   maxSinglePossibleLoss: number,
 *   perLevelOutcomeDistributions: Array<Array<{prob: number, net: number}>>,
 *   stepFn: function(state: Object, rng: function(): number): Object,
 *   isTargetReached: function(state: Object): boolean,
 *   initialState: {level: number},
 * }|null} null if the item/params are invalid or have no usable cost data.
 */
export function buildEnhancementModel(itemHrid, params) {
    const itemDetails = dataManager.getItemDetails(itemHrid);
    if (!itemDetails) return null;

    const { targetLevel, startLevel = 0, protectFrom = 0, blessedTea = false, guzzlingBonus = 1.0 } = params;

    let calc;
    try {
        calc = calculateEnhancement(params);
    } catch {
        return null;
    }
    if (!calc?.successRates?.length) return null;

    const perAttemptMaterial = calculatePerAttemptMaterialCost(itemDetails);
    const costPerAttempt = perAttemptMaterial.cost;

    let protectionCostOnFailure = 0;
    if (protectFrom > 0) {
        protectionCostOnFailure = getCheapestProtectionPrice(itemHrid)?.price || 0;
    }

    const skipRatio = blessedTea ? Math.max(0, Math.min(1, 0.01 * guzzlingBonus)) : 0;

    const perLevelOutcomeDistributions = calc.successRates.map(({ actualRate }, i) =>
        buildLevelOutcomes({
            i,
            successChance: Math.max(0, Math.min(1, actualRate / 100)),
            targetLevel,
            protectFrom,
            blessedTea,
            skipRatio,
            costPerAttempt,
            protectionCostOnFailure,
        })
    );

    return {
        costPerAttempt,
        protectionCostOnFailure,
        maxSinglePossibleLoss: costPerAttempt + protectionCostOnFailure,
        perLevelOutcomeDistributions,
        stepFn: (state, rng) => {
            const chosen = drawFromDistribution(perLevelOutcomeDistributions[state.level], rng);
            return { balance: state.balance + chosen.net, level: chosen.nextLevel };
        },
        isTargetReached: (state) => state.level >= targetLevel,
        initialState: { level: startLevel },
    };
}
