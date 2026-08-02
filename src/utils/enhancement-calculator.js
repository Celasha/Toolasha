/**
 * Enhancement Calculator
 *
 * Uses Markov Chain matrix math to calculate exact expected values for enhancement attempts.
 * Based on the original MWI Tools Enhancelate() function.
 *
 * Math.js library is loaded via userscript @require header.
 */

import { MIN_ACTION_TIME_SECONDS } from './profit-constants.js';

/**
 * Base success rates by enhancement level (before bonuses)
 */
export const BASE_SUCCESS_RATES = [
    50, // +1
    45, // +2
    45, // +3
    40, // +4
    40, // +5
    40, // +6
    35, // +7
    35, // +8
    35, // +9
    35, // +10
    30, // +11
    30, // +12
    30, // +13
    30, // +14
    30, // +15
    30, // +16
    30, // +17
    30, // +18
    30, // +19
    30, // +20
];

/**
 * Calculate total success rate bonus multiplier
 * @param {Object} params - Enhancement parameters
 * @param {number} params.enhancingLevel - Effective enhancing level (base + tea bonus)
 * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house bonus)
 * @param {number} params.itemLevel - Item level being enhanced
 * @returns {number} Success rate multiplier (e.g., 1.0519 = 105.19% of base rates)
 */
function calculateSuccessMultiplier(params) {
    const { enhancingLevel, toolBonus, itemLevel } = params;

    // Total bonus calculation
    // toolBonus already includes equipment + house success bonus from config
    // We only need to add level advantage here

    let totalBonus;

    if (enhancingLevel >= itemLevel) {
        // Above or at item level: +0.05% per level above item level
        const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
        totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
    } else {
        // Below item level: Penalty based on level deficit
        totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
    }

    return totalBonus;
}

/**
 * Calculate per-action time for enhancement
 * Simple calculation that doesn't require Markov chain analysis
 * @param {number} enhancingLevel - Effective enhancing level (includes tea bonus)
 * @param {number} itemLevel - Item level being enhanced
 * @param {number} speedBonus - Speed bonus % (for action time calculation)
 * @returns {number} Per-action time in seconds
 */
export function calculatePerActionTime(enhancingLevel, itemLevel, speedBonus = 0) {
    const baseActionTime = 12; // seconds
    let speedMultiplier;

    if (enhancingLevel > itemLevel) {
        // Above item level: Get speed bonus from level advantage + equipment + house
        // Note: speedBonus already includes house level bonus (1% per level)
        speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
    } else {
        // Below item level: Only equipment + house speed bonus
        // Note: speedBonus already includes house level bonus (1% per level)
        speedMultiplier = 1 + speedBonus / 100;
    }

    return Math.max(MIN_ACTION_TIME_SECONDS, baseActionTime / speedMultiplier);
}

/**
 * Calculate enhancement statistics using Markov Chain matrix inversion
 * @param {Object} params - Enhancement parameters
 * @param {number} params.enhancingLevel - Effective enhancing level (includes tea bonus)
 * @param {number} params.houseLevel - Observatory house room level (used for speed calculation only)
 * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house success bonus from config)
 * @param {number} params.speedBonus - Speed bonus % (for action time calculation)
 * @param {number} params.itemLevel - Item level being enhanced
 * @param {number} params.targetLevel - Target enhancement level (1-20)
 * @param {number} params.startLevel - Starting enhancement level (0-19, default 0)
 * @param {number} params.protectFrom - Start using protection items at this level (0 = never)
 * @param {boolean} params.blessedTea - Whether Blessed Tea is active (1% double jump)
 * @param {number} params.guzzlingBonus - Drink concentration multiplier (1.0 = no bonus, scales blessed tea)
 * @returns {Object} Enhancement statistics
 */
export function calculateEnhancement(params) {
    const {
        enhancingLevel,
        _houseLevel,
        toolBonus,
        speedBonus = 0,
        itemLevel,
        targetLevel,
        startLevel = 0,
        protectFrom = 0,
        blessedTea = false,
        guzzlingBonus = 1.0,
    } = params;

    // Validate inputs
    if (targetLevel < 1 || targetLevel > 20) {
        throw new Error('Target level must be between 1 and 20');
    }
    if (!Number.isInteger(startLevel) || startLevel < 0 || startLevel >= targetLevel) {
        throw new Error('Start level must be an integer between 0 and target level - 1');
    }
    if (protectFrom < 0 || protectFrom > targetLevel) {
        throw new Error('Protection level must be between 0 and target level');
    }

    // Calculate success rate multiplier
    const successMultiplier = calculateSuccessMultiplier({
        enhancingLevel,
        toolBonus,
        itemLevel,
    });

    // States are enhancement levels 0..targetLevel inclusive. A target of +20
    // therefore needs 21 states; the previous fixed 20×20 matrix wrote outside
    // its bounds at the top level.
    const markov = math.zeros(targetLevel + 1, targetLevel + 1);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = Math.max(0, Math.min(1, baseSuccessRate * successMultiplier));

        // Where do we go on failure?
        // Protection only applies when protectFrom > 0 AND we're at or above that level
        const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

        if (blessedTea) {
            // Blessed Tea: 1% base chance to jump +2, scaled by guzzling bonus.
            // Reaching or overshooting the requested target is the same absorbing
            // completion. At target - 1 both success branches therefore merge.
            const skipRatio = Math.max(0, Math.min(1, 0.01 * guzzlingBonus));
            const skipChance = successChance * skipRatio;
            const remainingSuccess = successChance - skipChance;
            const normalDestination = Math.min(targetLevel, i + 1);
            const skipDestination = Math.min(targetLevel, i + 2);

            if (normalDestination === skipDestination) {
                markov.set([i, normalDestination], successChance);
            } else {
                markov.set([i, skipDestination], skipChance);
                markov.set([i, normalDestination], remainingSuccess);
            }
            markov.set([i, failureDestination], 1 - successChance);
        } else {
            // Normal: Success goes to +1, failure goes to destination.
            markov.set([i, Math.min(targetLevel, i + 1)], successChance);
            markov.set([i, failureDestination], 1.0 - successChance);
        }
    }

    // Absorbing state at target level
    markov.set([targetLevel, targetLevel], 1.0);

    // Extract transient matrix Q (all states before target)
    const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));

    // Fundamental matrix: M = (I - Q)^-1
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    // Expected attempts from startLevel to target. A failure can send an
    // already-enhanced item below its starting level (usually back to +0), so
    // every transient state must be counted, not only startLevel..targetLevel.
    let attempts = 0;
    for (let i = 0; i < targetLevel; i++) {
        attempts += M.get([startLevel, i]);
    }

    // Expected protection item uses
    let protects = 0;
    if (protectFrom > 0 && protectFrom < targetLevel) {
        for (let i = protectFrom; i < targetLevel; i++) {
            const timesAtLevel = M.get([startLevel, i]);
            const failureChance = markov.get([i, i - 1]);
            protects += timesAtLevel * failureChance;
        }
    }

    // Action time calculation
    const baseActionTime = 12; // seconds
    let speedMultiplier;

    if (enhancingLevel > itemLevel) {
        // Above item level: Get speed bonus from level advantage + equipment + house
        // Note: speedBonus already includes house level bonus (1% per level)
        speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
    } else {
        // Below item level: Only equipment + house speed bonus
        // Note: speedBonus already includes house level bonus (1% per level)
        speedMultiplier = 1 + speedBonus / 100;
    }

    const perActionTime = Math.max(MIN_ACTION_TIME_SECONDS, baseActionTime / speedMultiplier);
    const totalTime = perActionTime * attempts;

    return {
        attempts: attempts, // Keep exact decimal value for calculations
        attemptsRounded: Math.round(attempts), // Rounded for display
        protectionCount: protects, // Keep decimal precision
        perActionTime: perActionTime,
        totalTime: totalTime,
        successMultiplier: successMultiplier,

        // Detailed success rates for each level
        successRates: BASE_SUCCESS_RATES.slice(0, targetLevel).map((base, i) => {
            return {
                level: i + 1,
                baseRate: base,
                actualRate: Math.min(100, base * successMultiplier),
            };
        }),

        // Expected number of times each state is visited (from fundamental matrix M)
        visitCounts: Array.from({ length: targetLevel }, (_, i) => M.get([startLevel, i])),
    };
}
