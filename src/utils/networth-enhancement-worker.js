import { calculateEnhancement } from './enhancement-calculator.js';

/** Calculate the Markov statistics used by listing valuation, without consulting prices. */
export function calculateNetworthEnhancementStats({ itemLevel, targetLevel, fodderItemLevel, enhancementParams }) {
    const stats = {};

    const calculateLevel = (level, target, includeXP) => {
        const byProtection = {};
        for (let protectFrom = 0; protectFrom <= target; protectFrom++) {
            if (protectFrom === 1) continue;
            const { attempts, totalTime, protectionCount, visitCounts, successRates } = calculateEnhancement({
                enhancingLevel: enhancementParams.enhancingLevel,
                toolBonus: enhancementParams.toolBonus || 0,
                speedBonus: enhancementParams.speedBonus || 0,
                itemLevel: level,
                targetLevel: target,
                protectFrom,
                blessedTea: enhancementParams.teas.blessed,
                guzzlingBonus: enhancementParams.guzzlingBonus,
            });
            byProtection[protectFrom] = { attempts, totalTime, protectionCount };
            if (includeXP) Object.assign(byProtection[protectFrom], { visitCounts, successRates });
        }
        (stats[level] ??= {})[target] = byProtection;
    };

    for (let target = 1; target <= targetLevel; target++) {
        calculateLevel(itemLevel, target, target === targetLevel);
    }
    if (targetLevel > 2 && fodderItemLevel != null && fodderItemLevel !== itemLevel) {
        calculateLevel(fodderItemLevel, targetLevel - 2, false);
    }
    return stats;
}

// The existing valuation worker includes this bundle before installing its message handler.
if (typeof globalThis.WorkerGlobalScope !== 'undefined' && globalThis instanceof globalThis.WorkerGlobalScope) {
    globalThis.calculateNetworthEnhancementStats = calculateNetworthEnhancementStats;
}
