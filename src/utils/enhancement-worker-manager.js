/**
 * Enhancement Calculator Worker Manager
 * Manages a worker pool for parallel enhancement calculations
 */

import WorkerPool from './worker-pool.js';

// Worker pool instance
let workerPool = null;

// Worker script as inline string (bundled from enhancement-calculator.worker.js)
const WORKER_SCRIPT = `
// Import math.js library from CDN
importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js');

// Cache for enhancement calculation results
const calculationCache = new Map();

const BASE_SUCCESS_RATES = [50,45,45,40,40,40,35,35,35,35,30,30,30,30,30,30,30,30,30,30];

function getCacheKey(params) {
    const {enhancingLevel,toolBonus,itemLevel,targetLevel,protectFrom,blessedTea,guzzlingBonus,speedBonus} = params;
    return \`\${enhancingLevel}|\${toolBonus}|\${itemLevel}|\${targetLevel}|\${protectFrom}|\${blessedTea}|\${guzzlingBonus}|\${speedBonus}\`;
}

function calculateSuccessMultiplier(params) {
    const { enhancingLevel, toolBonus, itemLevel } = params;
    let totalBonus;
    if (enhancingLevel >= itemLevel) {
        const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
        totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
    } else {
        totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
    }
    return totalBonus;
}

function calculateEnhancement(params) {
    const {enhancingLevel,toolBonus,speedBonus=0,itemLevel,targetLevel,protectFrom=0,blessedTea=false,guzzlingBonus=1.0} = params;

    if (targetLevel < 1 || targetLevel > 20) throw new Error('Target level must be between 1 and 20');
    if (protectFrom < 0 || protectFrom > targetLevel) throw new Error('Protection level must be between 0 and target level');

    const successMultiplier = calculateSuccessMultiplier({enhancingLevel,toolBonus,itemLevel});
    const markov = math.zeros(20, 20);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = baseSuccessRate * successMultiplier;
        const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

        if (blessedTea) {
            const skipChance = successChance * 0.01 * guzzlingBonus;
            const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);
            markov.set([i, i + 2], skipChance);
            markov.set([i, i + 1], remainingSuccess);
            markov.set([i, failureDestination], 1 - successChance);
        } else {
            markov.set([i, i + 1], successChance);
            markov.set([i, failureDestination], 1.0 - successChance);
        }
    }

    markov.set([targetLevel, targetLevel], 1.0);
    const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    let attempts = 0;
    for (let i = 0; i < targetLevel; i++) {
        attempts += M.get([0, i]);
    }

    let protects = 0;
    if (protectFrom > 0 && protectFrom < targetLevel) {
        for (let i = protectFrom; i < targetLevel; i++) {
            const timesAtLevel = M.get([0, i]);
            const failureChance = markov.get([i, i - 1]);
            protects += timesAtLevel * failureChance;
        }
    }

    const baseActionTime = 12;
    let speedMultiplier;
    if (enhancingLevel > itemLevel) {
        speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
    } else {
        speedMultiplier = 1 + speedBonus / 100;
    }

    const perActionTime = baseActionTime / speedMultiplier;
    const totalTime = perActionTime * attempts;

    return {
        attempts,
        attemptsRounded: Math.round(attempts),
        protectionCount: protects,
        perActionTime,
        totalTime,
        successMultiplier,
        successRates: BASE_SUCCESS_RATES.slice(0, targetLevel).map((base, i) => ({
            level: i + 1,
            baseRate: base,
            actualRate: Math.min(100, base * successMultiplier)
        }))
    };
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        const { action, params } = data;
        if (action === 'calculate') {
            const cacheKey = getCacheKey(params);
            let result = calculationCache.get(cacheKey);
            if (!result) {
                result = calculateEnhancement(params);
                calculationCache.set(cacheKey, result);
                if (calculationCache.size > 1000) {
                    const firstKey = calculationCache.keys().next().value;
                    calculationCache.delete(firstKey);
                }
            }
            self.postMessage({taskId,result});
        } else if (action === 'clearCache') {
            calculationCache.clear();
            self.postMessage({taskId,result: { success: true, message: 'Cache cleared' }});
        } else {
            throw new Error(\`Unknown action: \${action}\`);
        }
    } catch (error) {
        self.postMessage({taskId,error: error.message || String(error)});
    }
};
`;

/**
 * Get or create the worker pool instance
 */
async function getWorkerPool() {
    if (workerPool) {
        return workerPool;
    }

    try {
        // Create worker blob from inline script
        const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });

        // Initialize worker pool with 2-4 workers
        workerPool = new WorkerPool(blob);
        await workerPool.initialize();

        return workerPool;
    } catch (error) {
        throw error;
    }
}

/**
 * Calculate enhancement path using worker pool
 * @param {Object} params - Enhancement parameters
 * @returns {Promise<Object>} Enhancement calculation results
 */
export async function calculateEnhancementAsync(params) {
    const pool = await getWorkerPool();

    return pool.execute({
        action: 'calculate',
        params,
    });
}

/**
 * Calculate multiple enhancements in parallel
 * @param {Array<Object>} paramsArray - Array of enhancement parameters
 * @returns {Promise<Array<Object>>} Array of enhancement results
 */
export async function calculateEnhancementBatch(paramsArray) {
    const pool = await getWorkerPool();

    const tasks = paramsArray.map((params) => ({
        action: 'calculate',
        params,
    }));

    return pool.executeAll(tasks);
}

/**
 * Clear the worker cache
 */
export async function clearEnhancementCache() {
    if (!workerPool) {
        return;
    }

    const pool = await getWorkerPool();
    return pool.execute({
        action: 'clearCache',
    });
}

/**
 * Get worker pool statistics
 */
export function getWorkerStats() {
    return workerPool ? workerPool.getStats() : null;
}

/**
 * Terminate the worker pool
 */
export function terminateWorkerPool() {
    if (workerPool) {
        workerPool.terminate();
        workerPool = null;
    }
}
