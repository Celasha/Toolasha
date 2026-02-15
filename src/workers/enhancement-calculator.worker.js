/**
 * Enhancement Calculator Web Worker
 * Performs heavy Markov chain matrix calculations off the main thread
 */

// Import math.js library from CDN
importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js');

// Cache for enhancement calculation results
const calculationCache = new Map();

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
 * Generate cache key for enhancement calculation
 */
function getCacheKey(params) {
    const { enhancingLevel, toolBonus, itemLevel, targetLevel, protectFrom, blessedTea, guzzlingBonus, speedBonus } =
        params;

    return `${enhancingLevel}|${toolBonus}|${itemLevel}|${targetLevel}|${protectFrom}|${blessedTea}|${guzzlingBonus}|${speedBonus}`;
}

/**
 * Calculate total success rate bonus multiplier
 */
function calculateSuccessMultiplier(params) {
    const { enhancingLevel, toolBonus, itemLevel } = params;

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
 * Calculate enhancement statistics using Markov Chain matrix inversion
 */
function calculateEnhancement(params) {
    const {
        enhancingLevel,
        toolBonus,
        speedBonus = 0,
        itemLevel,
        targetLevel,
        protectFrom = 0,
        blessedTea = false,
        guzzlingBonus = 1.0,
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
        toolBonus,
        itemLevel,
    });

    // Build Markov Chain transition matrix (20×20)
    const markov = math.zeros(20, 20);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = baseSuccessRate * successMultiplier;

        // Where do we go on failure?
        // Protection only applies when protectFrom > 0 AND we're at or above that level
        const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

        if (blessedTea) {
            // Blessed Tea: 1% base chance to jump +2, scaled by guzzling bonus
            // Remaining success chance goes to +1 (after accounting for skip chance)
            const skipChance = successChance * 0.01 * guzzlingBonus;
            const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);

            markov.set([i, i + 2], skipChance);
            markov.set([i, i + 1], remainingSuccess);
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
    const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));

    // Fundamental matrix: M = (I - Q)^-1
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    // Expected attempts from level 0 to target
    // Sum all elements in first row of M up to targetLevel
    let attempts = 0;
    for (let i = 0; i < targetLevel; i++) {
        attempts += M.get([0, i]);
    }

    // Expected protection item uses
    let protects = 0;
    if (protectFrom > 0 && protectFrom < targetLevel) {
        for (let i = protectFrom; i < targetLevel; i++) {
            const timesAtLevel = M.get([0, i]);
            const failureChance = markov.get([i, i - 1]);
            protects += timesAtLevel * failureChance;
        }
    }

    // Action time calculation
    const baseActionTime = 12; // seconds
    let speedMultiplier;

    if (enhancingLevel > itemLevel) {
        // Above item level: Get speed bonus from level advantage + equipment + house
        speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
    } else {
        // Below item level: Only equipment + house speed bonus
        speedMultiplier = 1 + speedBonus / 100;
    }

    const perActionTime = baseActionTime / speedMultiplier;
    const totalTime = perActionTime * attempts;

    return {
        attempts: attempts,
        attemptsRounded: Math.round(attempts),
        protectionCount: protects,
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
 * Handle messages from main thread
 */
self.onmessage = function (e) {
    const { taskId, data } = e.data;

    try {
        const { action, params } = data;

        if (action === 'calculate') {
            // Check cache first
            const cacheKey = getCacheKey(params);
            let result = calculationCache.get(cacheKey);

            if (!result) {
                // Calculate and cache
                result = calculateEnhancement(params);
                calculationCache.set(cacheKey, result);

                // Limit cache size to prevent memory bloat
                if (calculationCache.size > 1000) {
                    // Remove oldest entry
                    const firstKey = calculationCache.keys().next().value;
                    calculationCache.delete(firstKey);
                }
            }

            // Send result back to main thread
            self.postMessage({
                taskId,
                result,
            });
        } else if (action === 'clearCache') {
            calculationCache.clear();
            self.postMessage({
                taskId,
                result: { success: true, message: 'Cache cleared' },
            });
        } else {
            throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        // Send error back to main thread
        self.postMessage({
            taskId,
            error: error.message || String(error),
        });
    }
};
