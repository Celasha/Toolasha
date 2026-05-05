/**
 * Combat Simulator Runner
 * Runs simulations in parallel Web Workers for maximum speed.
 *
 * For large simulations (>= 20 hours), the time is split across multiple
 * workers (up to 4) running in parallel. Results are merged by summing
 * all additive counters. For small simulations, a single worker is used.
 */

// The ?worker suffix is handled by rollup's workerBundlePlugin at build time
import WORKER_SCRIPT from './combat-sim-worker-entry.js?worker';

let workerBlobURL = null;
let activeWorkers = [];
let taskIdCounter = 0;
let pendingRejects = []; // Track reject functions to abort on cancel

const MIN_HOURS_PER_WORKER = 20;
const MAX_WORKERS = 4;

/**
 * Get or create the worker Blob URL (created once, reused).
 * @returns {string}
 */
export function getWorkerURL() {
    if (!workerBlobURL) {
        const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
        workerBlobURL = URL.createObjectURL(blob);
    }
    return workerBlobURL;
}

/**
 * Build extra buffs from community buffs and MooPass.
 * @param {Object} communityBuffs - { mooPass, comExp, comDrop }
 * @returns {Array<Object>}
 */
export function buildExtraBuffs(communityBuffs) {
    const extraBuffs = [];

    if (communityBuffs?.mooPass) {
        extraBuffs.push({
            uniqueHrid: '/buff_uniques/experience_moo_pass_buff',
            typeHrid: '/buff_types/wisdom',
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.05,
            flatBoostLevelBonus: 0,
            startTime: '0001-01-01T00:00:00Z',
            duration: 0,
        });
    }

    if (communityBuffs?.comExp > 0) {
        extraBuffs.push({
            uniqueHrid: '/buff_uniques/experience_community_buff',
            typeHrid: '/buff_types/wisdom',
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.005 * (communityBuffs.comExp - 1) + 0.2,
            flatBoostLevelBonus: 0,
            startTime: '0001-01-01T00:00:00Z',
            duration: 0,
        });
    }

    if (communityBuffs?.comDrop > 0) {
        extraBuffs.push({
            uniqueHrid: '/buff_uniques/combat_community_buff',
            typeHrid: '/buff_types/combat_drop_quantity',
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.005 * (communityBuffs.comDrop - 1) + 0.2,
            flatBoostLevelBonus: 0,
            startTime: '0001-01-01T00:00:00Z',
            duration: 0,
        });
    }

    return extraBuffs;
}

/**
 * Run a single simulation chunk in a Worker.
 * @param {Object} message - Worker message payload
 * @param {Function} [onProgress] - Progress callback (0-100 for this chunk)
 * @returns {Promise<Object>} SimResult
 */
export function runWorkerChunk(message, onProgress) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(getWorkerURL());
        activeWorkers.push(worker);
        pendingRejects.push(reject);

        const cleanup = () => {
            activeWorkers = activeWorkers.filter((w) => w !== worker);
            pendingRejects = pendingRejects.filter((r) => r !== reject);
        };

        worker.onmessage = (event) => {
            const msg = event.data;
            if (msg.taskId !== message.taskId) return;

            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.progress);
            } else if (msg.type === 'result') {
                worker.terminate();
                cleanup();
                resolve(msg.simResult);
            } else if (msg.type === 'error') {
                worker.terminate();
                cleanup();
                console.error('[CombatSimRunner] Worker error:', {
                    message: msg.error,
                    stack: msg.stack,
                    zoneHrid: msg.zoneHrid,
                    difficultyTier: msg.difficultyTier,
                });
                reject(new Error(msg.error));
            }
        };

        worker.onerror = (error) => {
            worker.terminate();
            cleanup();
            reject(new Error(error.message || 'Worker error'));
        };

        worker.postMessage(message);
    });
}

/**
 * Merge multiple SimResults into one by summing all additive counters.
 * @param {Array<Object>} results - Array of SimResult objects
 * @returns {Object} Merged SimResult
 */
function mergeSimResults(results) {
    if (results.length === 1) return results[0];

    const merged = structuredClone(results[0]);

    for (let i = 1; i < results.length; i++) {
        const r = results[i];

        // Encounters
        merged.encounters += r.encounters;

        // Deaths (per unit hrid)
        for (const [hrid, count] of Object.entries(r.deaths)) {
            merged.deaths[hrid] = (merged.deaths[hrid] || 0) + count;
        }

        // Experience gained (per player → per skill)
        for (const [playerHrid, skills] of Object.entries(r.experienceGained)) {
            if (!merged.experienceGained[playerHrid]) {
                merged.experienceGained[playerHrid] = {};
            }
            for (const [skill, amount] of Object.entries(skills)) {
                merged.experienceGained[playerHrid][skill] = (merged.experienceGained[playerHrid][skill] || 0) + amount;
            }
        }

        // Consumables used (per player → per item)
        for (const [playerHrid, items] of Object.entries(r.consumablesUsed)) {
            if (!merged.consumablesUsed[playerHrid]) {
                merged.consumablesUsed[playerHrid] = {};
            }
            for (const [itemHrid, count] of Object.entries(items)) {
                merged.consumablesUsed[playerHrid][itemHrid] =
                    (merged.consumablesUsed[playerHrid][itemHrid] || 0) + count;
            }
        }

        // Mana used (per player → per ability)
        if (r.manaUsed) {
            if (!merged.manaUsed) merged.manaUsed = {};
            for (const [playerHrid, abilities] of Object.entries(r.manaUsed)) {
                if (!merged.manaUsed[playerHrid]) merged.manaUsed[playerHrid] = {};
                for (const [abilityHrid, amount] of Object.entries(abilities)) {
                    merged.manaUsed[playerHrid][abilityHrid] = (merged.manaUsed[playerHrid][abilityHrid] || 0) + amount;
                }
            }
        }

        // Hitpoints gained/spent (per unit → per source)
        for (const field of ['hitpointsGained', 'manapointsGained', 'hitpointsSpent']) {
            if (r[field]) {
                if (!merged[field]) merged[field] = {};
                for (const [unitHrid, sources] of Object.entries(r[field])) {
                    if (!merged[field][unitHrid]) merged[field][unitHrid] = {};
                    for (const [source, amount] of Object.entries(sources)) {
                        merged[field][unitHrid][source] = (merged[field][unitHrid][source] || 0) + amount;
                    }
                }
            }
        }

        // Attacks (per source → per target → per ability)
        if (r.attacks) {
            if (!merged.attacks) merged.attacks = {};
            for (const [sourceHrid, targets] of Object.entries(r.attacks)) {
                if (!merged.attacks[sourceHrid]) merged.attacks[sourceHrid] = {};
                for (const [targetHrid, abilities] of Object.entries(targets)) {
                    if (!merged.attacks[sourceHrid][targetHrid]) {
                        merged.attacks[sourceHrid][targetHrid] = {};
                    }
                    for (const [abilityName, stats] of Object.entries(abilities)) {
                        if (!merged.attacks[sourceHrid][targetHrid][abilityName]) {
                            merged.attacks[sourceHrid][targetHrid][abilityName] = { hit: 0, miss: 0 };
                        }
                        merged.attacks[sourceHrid][targetHrid][abilityName].hit += stats.hit || 0;
                        merged.attacks[sourceHrid][targetHrid][abilityName].miss += stats.miss || 0;
                    }
                }
            }
        }

        // Dungeon stats
        if (r.isDungeon) {
            merged.dungeonsCompleted = (merged.dungeonsCompleted || 0) + (r.dungeonsCompleted || 0);
            merged.dungeonsFailed = (merged.dungeonsFailed || 0) + (r.dungeonsFailed || 0);
            merged.maxWaveReached = Math.max(merged.maxWaveReached || 0, r.maxWaveReached || 0);
        }

        // Simulated time
        merged.simulatedTime = (merged.simulatedTime || 0) + (r.simulatedTime || 0);

        // Time spent alive
        if (r.timeSpentAlive) {
            if (!merged.timeSpentAlive) merged.timeSpentAlive = [];
            for (const entry of r.timeSpentAlive) {
                const existing = merged.timeSpentAlive.find((e) => e.name === entry.name);
                if (existing) {
                    existing.timeSpentAlive += entry.timeSpentAlive;
                    existing.count += entry.count;
                } else {
                    merged.timeSpentAlive.push({ ...entry });
                }
            }
        }
    }

    return merged;
}

/**
 * Run a combat simulation, parallelized across multiple Workers when beneficial.
 * @param {Object} params
 * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
 * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
 * @param {string} params.zoneHrid - Zone HRID
 * @param {number} params.difficultyTier - Difficulty tier (0+)
 * @param {number} params.hours - Hours to simulate
 * @param {Object} params.communityBuffs - { mooPass, comExp, comDrop }
 * @param {Function} [onProgress] - Called with (percent: 0-100)
 * @returns {Promise<Object>} Merged SimResult
 */
export async function runSimulation(params, onProgress) {
    const { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs } = params;

    const extraBuffs = buildExtraBuffs(communityBuffs);
    const ONE_HOUR_NS = 3600 * 1e9;

    // Cancel any previous run
    cancelSimulation();

    // Determine worker count
    const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const maxWorkers = Math.min(MAX_WORKERS, availableCores);
    const workerCount =
        hours >= MIN_HOURS_PER_WORKER * 2 ? Math.min(maxWorkers, Math.floor(hours / MIN_HOURS_PER_WORKER)) : 1;

    // Split hours across workers
    const baseHours = Math.floor(hours / workerCount);
    const remainder = hours - baseHours * workerCount;

    const chunks = [];
    for (let i = 0; i < workerCount; i++) {
        const chunkHours = baseHours + (i < remainder ? 1 : 0);
        chunks.push(chunkHours);
    }

    // Track per-worker progress
    const workerProgress = new Array(workerCount).fill(0);
    const reportProgress = () => {
        if (!onProgress) return;
        const totalPercent = Math.round(workerProgress.reduce((sum, p) => sum + p, 0) / workerCount);
        onProgress(totalPercent);
    };

    // Launch all workers in parallel
    const promises = chunks.map((chunkHours, i) => {
        const taskId = ++taskIdCounter;
        const message = {
            type: 'start_simulation',
            taskId,
            gameData,
            playerDTOs,
            zoneHrid,
            difficultyTier,
            simulationTimeLimit: chunkHours * ONE_HOUR_NS,
            extraBuffs,
        };

        return runWorkerChunk(message, (percent) => {
            workerProgress[i] = percent;
            reportProgress();
        });
    });

    const results = await Promise.all(promises);

    if (onProgress) onProgress(100);

    return mergeSimResults(results);
}

/**
 * Terminate all active simulation workers and reject pending promises.
 */
export function cancelSimulation() {
    for (const worker of activeWorkers) {
        worker.terminate();
    }
    activeWorkers = [];

    const rejects = pendingRejects.slice();
    pendingRejects = [];
    for (const reject of rejects) {
        reject(new Error('Cancelled'));
    }
}
