/**
 * Risk of Ruin Worker Manager
 * Runs Monte Carlo trial batches off the main thread via a worker pool.
 *
 * Benchmarked need: an unprotected/huge-balance enhancement scenario where every trial runs to
 * the step cap took ~6s synchronously on the main thread for 20000 trials — a real freeze risk,
 * not a speculative one. Splitting trials across workers keeps the tab responsive.
 *
 * Both risk-of-ruin adapter shapes reduce to one of two plain, structured-clone-safe models:
 * - 'fixedOutcome' (chests, alchemy): a flat per-action {prob, net} outcome list, walked for a
 *   fixed number of actions.
 * - 'levelWalk' (enhancing): a per-level {prob, nextLevel, net} outcome list, walked until a
 *   target level is reached.
 * Each worker re-implements risk-of-ruin-engine.js's createSeededRng/drawFromDistribution/
 * simulateRuin core inline (the same duplication tradeoff ev-worker-manager.js and
 * enhancement-worker-manager.js already accept, since a Blob-URL worker can't import this
 * project's ES modules) — kept deliberately tiny and mirrored closely so the two stay in sync.
 */

import WorkerPool from './worker-pool.js';
import { createSeededRng, drawFromDistribution } from './risk-of-ruin-engine.js';

let workerPool = null;

/**
 * Run a batch of 'fixedOutcome' trials (chests, alchemy): a flat per-action outcome list,
 * walked for a fixed number of actions. Exported so the exact same logic that runs inside the
 * worker (see WORKER_SCRIPT below, kept manually in sync) is directly unit-testable.
 */
export function runFixedOutcomeTrials(model, rng) {
    const { startingBalance, trials, maxSteps, outcomeDistribution, targetActionCount } = model;
    let ruinCount = 0;
    let totalRuinSteps = 0;
    let undecidedCount = 0;
    const ruinStepCounts = [];

    for (let trial = 0; trial < trials; trial++) {
        let balance = startingBalance;
        let step = 0;
        let ruined = false;

        while (step < maxSteps && step < targetActionCount) {
            balance += drawFromDistribution(outcomeDistribution, rng).net;
            step += 1;
            if (balance <= 0) {
                ruined = true;
                break;
            }
        }

        if (ruined) {
            ruinCount += 1;
            totalRuinSteps += step;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + 1;
        } else if (step < targetActionCount) {
            undecidedCount += 1;
        }
    }

    return { ruinCount, trials, totalRuinSteps, undecidedCount, ruinStepCounts };
}

/**
 * Run a batch of 'levelWalk' trials (enhancing): a per-level outcome list, walked until a
 * target level is reached. Exported for the same testability reason as above.
 */
export function runLevelWalkTrials(model, rng) {
    const { startingBalance, trials, maxSteps, perLevelOutcomeDistributions, targetLevel, startLevel } = model;
    let ruinCount = 0;
    let totalRuinSteps = 0;
    let undecidedCount = 0;
    const ruinStepCounts = [];

    for (let trial = 0; trial < trials; trial++) {
        let balance = startingBalance;
        let level = startLevel;
        let step = 0;
        let ruined = false;

        while (step < maxSteps && level < targetLevel) {
            const chosen = drawFromDistribution(perLevelOutcomeDistributions[level], rng);
            balance += chosen.net;
            level = chosen.nextLevel;
            step += 1;
            if (balance <= 0) {
                ruined = true;
                break;
            }
        }

        if (ruined) {
            ruinCount += 1;
            totalRuinSteps += step;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + 1;
        } else if (level < targetLevel) {
            undecidedCount += 1;
        }
    }

    return { ruinCount, trials, totalRuinSteps, undecidedCount, ruinStepCounts };
}

/**
 * Run one chunk's worth of trials for either model type. Exported for the same testability
 * reason as above.
 */
export function runBatch(model) {
    if (model.startingBalance <= 0) {
        return {
            ruinCount: model.trials,
            trials: model.trials,
            totalRuinSteps: 0,
            undecidedCount: 0,
            ruinStepCounts: [0],
        };
    }
    const rng = createSeededRng(model.rngSeed);
    return model.type === 'levelWalk' ? runLevelWalkTrials(model, rng) : runFixedOutcomeTrials(model, rng);
}

// Inline copy of createSeededRng/drawFromDistribution/runFixedOutcomeTrials/runLevelWalkTrials/
// runBatch above, since a Blob-URL worker can't import this project's ES modules — the same
// duplication tradeoff ev-worker-manager.js and enhancement-worker-manager.js already accept.
// Keep this manually in sync with the exported functions above; risk-of-ruin-worker-manager.test.js
// exercises the real exported versions, not this string.
const WORKER_SCRIPT = `
function createSeededRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function drawFromDistribution(distribution, rng) {
    const roll = rng();
    let cumulative = 0;
    for (let i = 0; i < distribution.length; i++) {
        cumulative += distribution[i].prob;
        if (roll < cumulative || i === distribution.length - 1) return distribution[i];
    }
    return distribution[distribution.length - 1];
}

function runFixedOutcomeTrials(model, rng) {
    const { startingBalance, trials, maxSteps, outcomeDistribution, targetActionCount } = model;
    let ruinCount = 0;
    let totalRuinSteps = 0;
    let undecidedCount = 0;
    const ruinStepCounts = [];

    for (let trial = 0; trial < trials; trial++) {
        let balance = startingBalance;
        let step = 0;
        let ruined = false;

        while (step < maxSteps && step < targetActionCount) {
            balance += drawFromDistribution(outcomeDistribution, rng).net;
            step += 1;
            if (balance <= 0) {
                ruined = true;
                break;
            }
        }

        if (ruined) {
            ruinCount += 1;
            totalRuinSteps += step;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + 1;
        } else if (step < targetActionCount) {
            undecidedCount += 1;
        }
    }

    return { ruinCount, trials, totalRuinSteps, undecidedCount, ruinStepCounts };
}

function runLevelWalkTrials(model, rng) {
    const { startingBalance, trials, maxSteps, perLevelOutcomeDistributions, targetLevel, startLevel } = model;
    let ruinCount = 0;
    let totalRuinSteps = 0;
    let undecidedCount = 0;
    const ruinStepCounts = [];

    for (let trial = 0; trial < trials; trial++) {
        let balance = startingBalance;
        let level = startLevel;
        let step = 0;
        let ruined = false;

        while (step < maxSteps && level < targetLevel) {
            const chosen = drawFromDistribution(perLevelOutcomeDistributions[level], rng);
            balance += chosen.net;
            level = chosen.nextLevel;
            step += 1;
            if (balance <= 0) {
                ruined = true;
                break;
            }
        }

        if (ruined) {
            ruinCount += 1;
            totalRuinSteps += step;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + 1;
        } else if (level < targetLevel) {
            undecidedCount += 1;
        }
    }

    return { ruinCount, trials, totalRuinSteps, undecidedCount, ruinStepCounts };
}

function runBatch(model) {
    if (model.startingBalance <= 0) {
        return { ruinCount: model.trials, trials: model.trials, totalRuinSteps: 0, undecidedCount: 0, ruinStepCounts: [0] };
    }
    const rng = createSeededRng(model.rngSeed);
    return model.type === 'levelWalk' ? runLevelWalkTrials(model, rng) : runFixedOutcomeTrials(model, rng);
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        self.postMessage({ taskId, result: runBatch(data.model) });
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
 * Split a Monte Carlo model's trial count into per-worker chunks, each with a distinct rngSeed
 * derived from the base seed so chunks don't sample identically.
 * @param {Object} model
 * @param {number} poolSize
 * @returns {Array<{model: Object}>} Task list ready for WorkerPool#executeAll.
 */
export function buildChunkTasks(model, poolSize) {
    const chunkCount = Math.min(poolSize, model.trials) || 1;
    const baseChunkSize = Math.floor(model.trials / chunkCount);
    const remainder = model.trials % chunkCount;

    const tasks = [];
    for (let i = 0; i < chunkCount; i++) {
        const chunkTrials = baseChunkSize + (i < remainder ? 1 : 0);
        if (chunkTrials <= 0) continue;
        tasks.push({ model: { ...model, trials: chunkTrials, rngSeed: (model.rngSeed || 1) + i * 104729 } });
    }
    return tasks;
}

/**
 * Merge per-chunk trial results back into the same shape risk-of-ruin-engine.js's
 * simulateRuin() returns.
 * @param {Array<{ruinCount: number, trials: number, totalRuinSteps: number, undecidedCount: number, ruinStepCounts: number[]}>} chunkResults
 * @returns {{ruinProbability: number, ruinCount: number, trials: number, ruinStepCounts: number[], meanStepsToRuin: number|null, undecidedCount: number}}
 */
export function mergeRuinChunks(chunkResults) {
    let ruinCount = 0;
    let trials = 0;
    let totalRuinSteps = 0;
    let undecidedCount = 0;
    const ruinStepCounts = [];

    for (const chunk of chunkResults) {
        ruinCount += chunk.ruinCount;
        trials += chunk.trials;
        totalRuinSteps += chunk.totalRuinSteps;
        undecidedCount += chunk.undecidedCount;
        for (let step = 0; step < chunk.ruinStepCounts.length; step++) {
            const count = chunk.ruinStepCounts[step];
            if (!count) continue;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + count;
        }
    }

    return {
        ruinProbability: ruinCount / trials,
        ruinCount,
        trials,
        ruinStepCounts,
        meanStepsToRuin: ruinCount > 0 ? totalRuinSteps / ruinCount : null,
        undecidedCount,
    };
}

/**
 * Run a Monte Carlo ruin simulation split across the worker pool.
 * @param {Object} model - { startingBalance, trials, maxSteps, rngSeed, type, ...type-specific fields }
 * @returns {Promise<{ruinProbability: number, ruinCount: number, trials: number, ruinStepCounts: number[], meanStepsToRuin: number|null, undecidedCount: number}>}
 */
export async function simulateRuinAsync(model) {
    const pool = await getWorkerPool();
    const tasks = buildChunkTasks(model, pool.getStats().poolSize);
    const chunkResults = await pool.executeAll(tasks);
    return mergeRuinChunks(chunkResults);
}

/**
 * Terminate the worker pool.
 */
export function terminateRiskOfRuinWorkerPool() {
    if (workerPool) {
        workerPool.terminate();
        workerPool = null;
    }
}
