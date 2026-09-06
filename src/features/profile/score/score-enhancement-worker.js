/**
 * Score Enhancement Worker Manager (TLA-041C)
 *
 * Dedicated Blob-worker manager for the Profile Score's cost-only enhancement expectation kernel.
 * Deliberately separate from `src/utils/enhancement-worker-manager.js` (the older generic
 * enhancement-tooltip worker) - that worker's inline implementation has fixed matrix sizing and no
 * `startLevel` support, so it is not a safe drop-in for the Score's per-start-level statistics.
 *
 * Caching lives on the main-thread side (`expectationCache`), keyed only by the parameters that
 * affect Markov transition probabilities (`buildExpectationCacheKey`) - `speedBonus`, market
 * prices, item HRID, and time/XP fields never touch this cache, so they can't fragment it. The
 * cache stores the in-flight Promise itself (set synchronously before any await), so concurrent
 * requests for the same key coalesce into a single worker round trip.
 */

import WorkerPool from '../../../utils/worker-pool.js';

const MAX_CACHE_ENTRIES = 200;

let workerPool = null;
const expectationCache = new Map(); // cacheKey -> Promise<{targets}>

/**
 * Build the cache key from only the parameters that affect enhancement success/failure
 * probabilities. See module doc - `speedBonus`/prices/HRID/time/XP are excluded on purpose.
 * @param {Object} params
 * @returns {string}
 */
export function buildExpectationCacheKey({
    enhancingLevel,
    toolBonus = 0,
    itemLevel,
    blessedTea = false,
    guzzlingBonus = 1,
}) {
    return `${enhancingLevel}|${toolBonus}|${itemLevel}|${blessedTea}|${guzzlingBonus}`;
}

// Inline copy of `calculateScoreEnhancementExpectationTables` (+ its `solveTwoRightHandSides`
// helper) from `enhancement-expectation-kernel.js`, since a Blob-URL worker can't import this
// project's ES modules - the same duplication tradeoff `ev-worker-manager.js`/
// `enhancement-worker-manager.js`/`risk-of-ruin-worker-manager.js` already accept. Keep this
// manually in sync with the exported kernel; `enhancement-expectation-kernel.test.js` exercises the
// real exported version (verified against canonical Markov semantics), not this string.
const WORKER_SCRIPT = `
const BASE_SUCCESS_RATES = [50,45,45,40,40,40,35,35,35,35,30,30,30,30,30,30,30,30,30,30];

function solveTwoRightHandSides(matrix, rhsA, rhsB) {
    const n = rhsA.length;
    const augmented = Array.from({ length: n }, (_, rowIndex) => {
        const row = new Float64Array(n + 2);
        for (let col = 0; col < n; col++) row[col] = matrix[rowIndex][col];
        row[n] = rhsA[rowIndex];
        row[n + 1] = rhsB[rowIndex];
        return row;
    });

    for (let col = 0; col < n; col++) {
        let pivot = col;
        let pivotAbs = Math.abs(augmented[col][col]);
        for (let row = col + 1; row < n; row++) {
            const candidateAbs = Math.abs(augmented[row][col]);
            if (candidateAbs > pivotAbs) {
                pivot = row;
                pivotAbs = candidateAbs;
            }
        }
        if (!(pivotAbs > 1e-14)) throw new Error('Singular enhancement expectation system');
        if (pivot !== col) {
            const tmp = augmented[col];
            augmented[col] = augmented[pivot];
            augmented[pivot] = tmp;
        }

        const divisor = augmented[col][col];
        for (let j = col; j < n + 2; j++) augmented[col][j] /= divisor;

        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = augmented[row][col];
            if (factor === 0) continue;
            for (let j = col; j < n + 2; j++) {
                augmented[row][j] -= factor * augmented[col][j];
            }
        }
    }

    const attemptsByStart = new Array(n);
    const protectionsByStart = new Array(n);
    for (let i = 0; i < n; i++) {
        attemptsByStart[i] = augmented[i][n];
        protectionsByStart[i] = augmented[i][n + 1];
    }
    return { attemptsByStart, protectionsByStart };
}

function calculateScoreEnhancementExpectationTables(params) {
    const { enhancingLevel, toolBonus = 0, itemLevel, blessedTea = false, guzzlingBonus = 1, maxTarget = 20 } = params;

    if (!Number.isFinite(enhancingLevel) || !Number.isFinite(toolBonus) || !Number.isFinite(itemLevel)) {
        throw new Error('Invalid enhancement expectation parameters');
    }
    if (!Number.isInteger(maxTarget) || maxTarget < 1 || maxTarget > 20) {
        throw new Error('maxTarget must be 1..20');
    }

    const successMultiplier =
        enhancingLevel >= itemLevel
            ? 1 + (toolBonus + 0.05 * (enhancingLevel - itemLevel)) / 100
            : 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;

    const targets = new Array(maxTarget + 1);
    for (let targetLevel = 1; targetLevel <= maxTarget; targetLevel++) {
        const protectFromValues = [0];
        for (let protectFrom = 2; protectFrom <= targetLevel; protectFrom++) {
            protectFromValues.push(protectFrom);
        }

        const strategies = [];
        for (const protectFrom of protectFromValues) {
            const matrix = Array.from({ length: targetLevel }, () => new Float64Array(targetLevel));
            const protectionReward = new Float64Array(targetLevel);
            const attemptReward = new Float64Array(targetLevel);
            attemptReward.fill(1);

            for (let state = 0; state < targetLevel; state++) {
                matrix[state][state] = 1;

                const baseRate = BASE_SUCCESS_RATES[state] / 100;
                const successChance = Math.max(0, Math.min(1, baseRate * successMultiplier));
                const failureChance = 1 - successChance;
                const failureDestination = protectFrom > 0 && state >= protectFrom ? state - 1 : 0;

                if (blessedTea) {
                    const skipRatio = Math.max(0, Math.min(1, 0.01 * guzzlingBonus));
                    const skipChance = successChance * skipRatio;
                    const normalChance = successChance - skipChance;
                    const normalDestination = Math.min(targetLevel, state + 1);
                    const skipDestination = Math.min(targetLevel, state + 2);
                    if (normalDestination < targetLevel) matrix[state][normalDestination] -= normalChance;
                    if (skipDestination < targetLevel) matrix[state][skipDestination] -= skipChance;
                } else {
                    const successDestination = Math.min(targetLevel, state + 1);
                    if (successDestination < targetLevel) matrix[state][successDestination] -= successChance;
                }

                if (failureDestination < targetLevel) matrix[state][failureDestination] -= failureChance;
                if (protectFrom > 0 && state >= protectFrom) protectionReward[state] = failureChance;
            }

            strategies.push({
                protectFrom,
                ...solveTwoRightHandSides(matrix, attemptReward, protectionReward),
            });
        }
        targets[targetLevel] = strategies;
    }

    return { targets };
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        self.postMessage({ taskId, result: calculateScoreEnhancementExpectationTables(data.params) });
    } catch (error) {
        self.postMessage({ taskId, error: error.message || String(error) });
    }
};
`;

async function getWorkerPool() {
    if (workerPool) return workerPool;
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    workerPool = new WorkerPool(blob);
    await workerPool.initialize();
    return workerPool;
}

/**
 * Request the full target-1..20 enhancement expectation table for one viewer-params/itemLevel
 * combination. Concurrent calls with the same probability-affecting parameters share one worker
 * round trip; a rejected request clears its cache entry (so a later call retries) while still
 * propagating the rejection to every caller already awaiting it - equipment-resolver.js treats
 * that as "reconstruction-dependent candidates become incomplete", never a synchronous fallback.
 * @param {Object} params - {enhancingLevel, toolBonus, itemLevel, blessedTea, guzzlingBonus}
 * @returns {Promise<{targets: Array}>}
 */
export function getScoreEnhancementExpectationTable(params) {
    const cacheKey = buildExpectationCacheKey(params);
    const cached = expectationCache.get(cacheKey);
    if (cached) return cached;

    const promise = (async () => {
        const pool = await getWorkerPool();
        return pool.execute({ action: 'calculate', params: { ...params, maxTarget: params.maxTarget || 20 } });
    })();

    promise.catch(() => {
        expectationCache.delete(cacheKey);
    });

    expectationCache.set(cacheKey, promise);
    if (expectationCache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = expectationCache.keys().next().value;
        if (oldestKey !== cacheKey) expectationCache.delete(oldestKey);
    }

    return promise;
}

/**
 * Clear the pure expectation-table cache (tests / explicit cache reset).
 */
export function clearScoreEnhancementExpectationCache() {
    expectationCache.clear();
}

/**
 * Terminate the worker pool and clear the cache.
 */
export function terminateScoreEnhancementWorkerPool() {
    if (workerPool) {
        workerPool.terminate();
        workerPool = null;
    }
    expectationCache.clear();
}
