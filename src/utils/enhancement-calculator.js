/**
 * Enhancement Calculator
 *
 * Uses Markov Chain matrix math to calculate exact expected values for enhancement attempts.
 * Based on the original MWI Tools Enhancelate() function.
 *
 * Math.js library is loaded via userscript @require header.
 */

/**
 * Base success rates by enhancement level (before bonuses)
 */
const BASE_SUCCESS_RATES = [
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
 * @param {number} params.houseLevel - Laboratory level
 * @param {number} params.toolBonus - Tool success bonus % (already includes house bonus)
 * @param {number} params.itemLevel - Item level being enhanced
 * @returns {number} Success rate multiplier (e.g., 1.15 = 115% of base rates)
 */
function calculateSuccessMultiplier(params) {
    const { enhancingLevel, houseLevel, toolBonus, itemLevel } = params;

    // Total bonus calculation from original MWI Tools
    // Formula: https://doh-nuts.github.io/Enhancelator/

    let totalBonus;

    if (enhancingLevel >= itemLevel) {
        // Above or at item level: +5% per (level + house - itemLevel) + tool bonus
        // Note: 0.05 * value / 100 = 0.0005 * value (0.05% per level)
        totalBonus = 1 + (0.05 * (enhancingLevel + houseLevel - itemLevel) + toolBonus) / 100;
    } else {
        // Below item level: Penalty based on level deficit + house and tool bonuses
        totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + (0.05 * houseLevel + toolBonus) / 100;
    }

    return totalBonus;
}

/**
 * Calculate enhancement statistics using Markov Chain matrix inversion
 * @param {Object} params - Enhancement parameters
 * @param {number} params.enhancingLevel - Effective enhancing level (includes tea bonus)
 * @param {number} params.houseLevel - Laboratory house room level
 * @param {number} params.toolBonus - Tool success bonus % (includes house bonus from config)
 * @param {number} params.speedBonus - Speed bonus % (for action time calculation)
 * @param {number} params.itemLevel - Item level being enhanced
 * @param {number} params.targetLevel - Target enhancement level (1-20)
 * @param {number} params.protectFrom - Start using protection items at this level (0 = never)
 * @param {boolean} params.blessedTea - Whether Blessed Tea is active (1% double jump)
 * @returns {Object} Enhancement statistics
 */
export function calculateEnhancement(params) {
    const {
        enhancingLevel,
        houseLevel,
        toolBonus,
        speedBonus = 0,
        itemLevel,
        targetLevel,
        protectFrom = 0,
        blessedTea = false
    } = params;

    // Validate inputs
    if (targetLevel < 1 || targetLevel > 20) {
        throw new Error('Target level must be between 1 and 20');
    }
    if (protectFrom < 0 || protectFrom > targetLevel) {
        throw new Error('Protection level must be between 0 and target level');
    }

    // Calculate success rate multiplier
    const successMultiplier = calculateSuccessMultiplier({
        enhancingLevel,
        houseLevel,
        toolBonus,
        itemLevel
    });

    // Build Markov Chain transition matrix (20×20)
    const markov = math.zeros(20, 20);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = baseSuccessRate * successMultiplier;

        // Where do we go on failure?
        // Protection only applies when protectFrom > 0 AND we're at or above that level
        const failureDestination = (protectFrom > 0 && i >= protectFrom) ? i - 1 : 0;

        if (blessedTea) {
            // Blessed Tea: 1% chance to jump +2, 99% chance to jump +1
            markov.set([i, i + 2], successChance * 0.01);
            markov.set([i, i + 1], successChance * 0.99);
            markov.set([i, failureDestination], 1 - successChance);
        } else {
            // Normal: Success goes to +1, failure goes to destination
            markov.set([i, i + 1], successChance);
            markov.set([i, failureDestination], 1.0 - successChance);
        }
    }

    // Absorbing state at target level
    markov.set([targetLevel, targetLevel], 1.0);

    // Extract transient matrix Q (all states before target)
    const Q = markov.subset(
        math.index(math.range(0, targetLevel), math.range(0, targetLevel))
    );

    // Fundamental matrix: M = (I - Q)^-1
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    // Expected attempts from level 0 to target
    const attemptsArray = M.subset(
        math.index(math.range(0, 1), math.range(0, targetLevel))
    );
    const attempts = math.flatten(math.row(attemptsArray, 0).valueOf())
        .reduce((a, b) => a + b, 0);

    // Expected protection item uses
    let protects = 0;
    if (protectFrom > 0 && protectFrom < targetLevel) {
        const protectAttempts = M.subset(
            math.index(math.range(0, 1), math.range(protectFrom, targetLevel))
        );
        const protectAttemptsArray = typeof protectAttempts === "number"
            ? [protectAttempts]
            : math.flatten(math.row(protectAttempts, 0).valueOf());

        protects = protectAttemptsArray
            .map((a, i) => a * markov.get([i + protectFrom, i + protectFrom - 1]))
            .reduce((a, b) => a + b, 0);
    }

    // Action time calculation
    const baseActionTime = 12; // seconds
    let speedMultiplier;

    if (enhancingLevel > itemLevel) {
        // Above item level: Get speed bonus from level advantage + equipment
        speedMultiplier = 1 + (enhancingLevel + houseLevel - itemLevel + speedBonus) / 100;
    } else {
        // Below item level: Only equipment speed bonus
        speedMultiplier = 1 + (houseLevel + speedBonus) / 100;
    }

    const perActionTime = baseActionTime / speedMultiplier;
    const totalTime = perActionTime * attempts;

    return {
        attempts: Math.round(attempts),
        protectionCount: Math.round(protects),
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
    };
}

/**
 * Calculate enhancement costs for multiple scenarios
 * @param {Object} params - Base parameters (same as calculateEnhancement)
 * @param {Array<number>} protectionLevels - Array of protection levels to compare (e.g., [0, 11, 16])
 * @returns {Array<Object>} Results for each protection strategy
 */
export function compareProtectionStrategies(params, protectionLevels = [0, 11, 16]) {
    return protectionLevels.map(protectFrom => {
        const result = calculateEnhancement({
            ...params,
            protectFrom
        });

        return {
            protectFrom,
            ...result
        };
    });
}
