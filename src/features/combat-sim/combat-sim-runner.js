/**
 * Combat Simulator Runner
 * Runs one logical stateful simulation timeline in one Web Worker.
 *
 * Independent targets/zones may still be parallelized by their higher-level runners
 * (see all-zones-runner.js), but elapsed time from one stateful simulation must never
 * be split across fresh worker replicas and merged as if it were one timeline - buffs,
 * cooldowns, consumables, Fury, and OOM windows would silently reset at each split.
 */

// The ?worker suffix is handled by rollup's workerBundlePlugin at build time
import WORKER_SCRIPT from './combat-sim-worker-entry.js?worker';

let workerBlobURL = null;
let taskIdCounter = 0;

// Checked against the production bundles by scripts/check-combat-sim-singleton.js: this worker state
// must exist in exactly one library (toolasha-sim.js).
export const RUNNER_STATE_IMPLEMENTATION_ID = 'toolasha-sim-runner-state-v1';

// Worker slots are scoped by channel. Starting a run cancels whatever is in flight on ITS channel
// only, so independent features never abort each other's simulations. The Combat Sim UIs and the
// labyrinth tools share the default channel (as they always have); the task estimates use their own.
// This runner is now a single shared copy, so the isolation the task features used to get by
// bundling their own copy of it has to be explicit.
export const CHANNEL_DEFAULT = 'default';
export const CHANNEL_TASKS = 'tasks';
const slots = new Map(); // channel -> { workers: Worker[], rejects: Function[] }

function getSlot(channel = CHANNEL_DEFAULT) {
    let slot = slots.get(channel);
    if (!slot) {
        slot = { workers: [], rejects: [] };
        slots.set(channel, slot);
    }
    return slot;
}

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
 * Build one player's extra (non-house, non-shrine) buffs: genuinely global community buffs plus
 * that player's own MooPass status. Guild Shrine buffs are no longer carried here - they are
 * constructed generically by the engine's Shrine class from each player's own `shrineLevels`
 * (CSIM-AUD-021/UI-002), so there is exactly one canonical path and no double application.
 * @param {Object} communityBuffs - { comExp, comDrop } (genuinely server-wide, shared by every player)
 * @param {boolean} [hasMooPass] - Whether THIS specific player has MooPass active
 * @returns {Array<Object>}
 */
export function buildExtraBuffs(communityBuffs, hasMooPass) {
    const extraBuffs = [];

    if (hasMooPass) {
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
 * Build each player's own extra buffs (CSIM-AUD-019/020): community buffs are genuinely global
 * and shared identically, but MooPass is per-player. Every player gets its OWN array (never one
 * shared array reference across players), closing the CSIM-AUD-020B amplification vector at its
 * source in addition to the ownership fix in CombatUnit.addPermanentBuff().
 * @param {Array<Object>} playerDTOs
 * @param {Object} communityBuffs - { comExp, comDrop }
 * @returns {Object<string, Array<Object>>} playerHrid -> that player's own extraBuffs array
 */
export function buildExtraBuffsByPlayer(playerDTOs, communityBuffs) {
    const extraBuffsByPlayer = {};
    for (const dto of playerDTOs) {
        extraBuffsByPlayer[dto.hrid] = buildExtraBuffs(communityBuffs, dto.hasMooPass);
    }
    return extraBuffsByPlayer;
}

/**
 * Run a single simulation chunk in a Worker.
 * @param {Object} message - Worker message payload
 * @param {Function} [onProgress] - Progress callback (0-100 for this chunk)
 * @param {string} [channel] - Worker slot to register on (see CHANNEL_DEFAULT)
 * @returns {Promise<Object>} SimResult
 */
export function runWorkerChunk(message, onProgress, channel = CHANNEL_DEFAULT) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(getWorkerURL());
        const slot = getSlot(channel);
        slot.workers.push(worker);
        slot.rejects.push(reject);

        const cleanup = () => {
            slot.workers = slot.workers.filter((w) => w !== worker);
            slot.rejects = slot.rejects.filter((r) => r !== reject);
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
 * Run a combat simulation as one continuous, full-duration stateful timeline (CSIM-AUD-006).
 * Independent targets/zones are parallelized by all-zones-runner.js at a higher level, never by
 * splitting one target's elapsed time across independent worker replicas.
 * @param {Object} params
 * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
 * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
 * @param {string} params.zoneHrid - Zone HRID
 * @param {number} params.difficultyTier - Difficulty tier (0+)
 * @param {number} params.hours - Hours to simulate
 * @param {Object} params.communityBuffs - { comExp, comDrop }
 * @param {Function} [onProgress] - Called with (percent: 0-100)
 * @param {Object} [options]
 * @param {string} [options.channel] - Worker slot; a new run only cancels runs on the same channel
 * @returns {Promise<Object>} SimResult
 */
export async function runSimulation(params, onProgress, options = {}) {
    const { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs } = params;
    const channel = options.channel ?? CHANNEL_DEFAULT;

    const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
    const ONE_HOUR_NS = 3600 * 1e9;

    // Cancel any previous run
    cancelSimulation(channel);

    const taskId = ++taskIdCounter;
    const message = {
        type: 'start_simulation',
        taskId,
        gameData,
        playerDTOs,
        zoneHrid,
        difficultyTier,
        // Preserve the exact requested duration, including fractional hours - one target's
        // simulation timeline must never be time-sliced.
        simulationTimeLimit: hours * ONE_HOUR_NS,
        extraBuffsByPlayer,
    };

    const result = await runWorkerChunk(message, onProgress, channel);

    if (onProgress) onProgress(100);

    return result;
}

/**
 * Build labyrinth crate buff arrays from crate item HRIDs.
 * @param {string[]} crateHrids - Array of crate item HRIDs (e.g., ['/items/expert_coffee_crate'])
 * @param {Object} gameData - Game data containing labyrinthCrateDetailMap
 * @returns {Array<Object>} Buff objects compatible with zoneBuffs
 */
export function buildCrateBuffs(crateHrids, gameData) {
    if (!crateHrids || crateHrids.length === 0) return [];

    const crateMap = gameData.labyrinthCrateDetailMap;
    if (!crateMap) return [];

    let buffs = [];
    for (const hrid of crateHrids) {
        if (crateMap[hrid]) {
            buffs = buffs.concat(crateMap[hrid]);
        }
    }
    return buffs;
}

/**
 * Run a labyrinth simulation.
 * @param {Object} params
 * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
 * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
 * @param {string} params.zoneHrid - Zone HRID (used for SimResult context; any combat zone works)
 * @param {string} params.monsterHrid - Labyrinth monster HRID
 * @param {number} params.roomLevel - Room level (scales monster stats)
 * @param {string[]} params.crates - Crate item HRIDs
 * @param {number} params.hours - Hours to simulate
 * @param {Object} params.communityBuffs - { mooPass, comExp, comDrop }
 * @param {Function} [onProgress] - Called with (percent: 0-100)
 * @returns {Promise<Object>} SimResult with labyrinth fields
 */
export async function runLabyrinthSimulation(params, onProgress) {
    const {
        gameData,
        playerDTOs,
        zoneHrid,
        monsterHrid,
        roomLevel,
        crates,
        hours,
        communityBuffs,
        labyrinthCombatBuffs,
    } = params;

    const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
    if (labyrinthCombatBuffs?.length) {
        // Labyrinth crate buffs are genuinely shared party-wide loot, unlike guild Shrines/MooPass.
        for (const dto of playerDTOs) {
            extraBuffsByPlayer[dto.hrid] = [...extraBuffsByPlayer[dto.hrid], ...labyrinthCombatBuffs];
        }
    }
    const ONE_HOUR_NS = 3600 * 1e9;

    // Cancel any previous run
    cancelSimulation();

    const taskId = ++taskIdCounter;
    const message = {
        type: 'start_simulation',
        taskId,
        gameData,
        playerDTOs,
        zoneHrid,
        difficultyTier: 0,
        simulationTimeLimit: hours * ONE_HOUR_NS,
        extraBuffsByPlayer,
        labyrinth: {
            monsterHrid,
            roomLevel,
            crates: crates || [],
        },
    };

    const result = await runWorkerChunk(message, onProgress);

    if (onProgress) onProgress(100);

    return result;
}

// Each labyrinth attempt ends within 120s of simulated time (win, death, or timeout), so this is
// a ceiling the attempt count always reaches first - it only guards against a runaway loop.
const LABYRINTH_ATTEMPT_CEILING_NS = 125 * 1e9;
const MAX_ATTEMPT_WORKERS = 6;

/**
 * Number of workers to spread labyrinth attempts over. Leaves one core for the game itself.
 * @returns {number}
 */
export function getAttemptWorkerCount() {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
    return Math.max(1, Math.min((cores || 2) - 1, MAX_ATTEMPT_WORKERS));
}

/**
 * Split an attempt count as evenly as possible across workers, never giving one zero attempts.
 * @param {number} attempts
 * @param {number} workers
 * @returns {number[]} Per-worker attempt counts, summing to `attempts`
 */
export function splitAttempts(attempts, workers) {
    const count = Math.max(1, Math.min(Math.floor(workers), Math.floor(attempts)));
    const base = Math.floor(attempts / count);
    const remainder = attempts - base * count;
    return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Combine the results of independent labyrinth attempt batches into one. Attempts are fully
 * independent (the engine resets the player before each), so wins, attempts, elapsed simulated
 * time, and XP simply add.
 * @param {Array<Object>} results - Worker SimResults from attempt-count runs
 * @returns {{encounters: number, labyAttemptCount: number, simulatedTime: number, experienceGained: Object}}
 */
export function mergeLabyrinthResults(results) {
    const merged = { encounters: 0, labyAttemptCount: 0, simulatedTime: 0, experienceGained: {} };
    for (const result of results) {
        merged.encounters += result.encounters || 0;
        merged.labyAttemptCount += result.labyAttemptCount || 0;
        merged.simulatedTime += result.simulatedTime || 0;
        for (const [hrid, skills] of Object.entries(result.experienceGained || {})) {
            const target = (merged.experienceGained[hrid] = merged.experienceGained[hrid] || {});
            for (const [skill, xp] of Object.entries(skills)) {
                target[skill] = (target[skill] || 0) + xp;
            }
        }
    }
    return merged;
}

/**
 * Run a fixed number of independent labyrinth attempts, spread across several workers.
 * `simulatedTime` in the result is the total simulated time across all workers (so dividing it by
 * the attempt count gives the average attempt length), not wall-clock time.
 * @param {Object} params - Same fields as runLabyrinthSimulation, with `attempts` instead of `hours`
 * @param {number} params.attempts - Number of attempts to run in total
 * @param {number} [params.workers] - Worker count (defaults to getAttemptWorkerCount())
 * @returns {Promise<Object>} Merged result (see mergeLabyrinthResults)
 */
export async function runLabyrinthAttempts(params) {
    const { gameData, playerDTOs, zoneHrid, monsterHrid, roomLevel, crates, attempts, communityBuffs } = params;

    const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
    if (params.labyrinthCombatBuffs?.length) {
        for (const dto of playerDTOs) {
            extraBuffsByPlayer[dto.hrid] = [...extraBuffsByPlayer[dto.hrid], ...params.labyrinthCombatBuffs];
        }
    }

    // Cancel any previous run
    cancelSimulation();

    const shares = splitAttempts(attempts, params.workers || getAttemptWorkerCount());
    const results = await Promise.all(
        shares.map((share) =>
            runWorkerChunk({
                type: 'start_simulation',
                taskId: ++taskIdCounter,
                gameData,
                playerDTOs,
                zoneHrid,
                difficultyTier: 0,
                simulationTimeLimit: (share + 1) * LABYRINTH_ATTEMPT_CEILING_NS,
                extraBuffsByPlayer,
                labyrinth: { monsterHrid, roomLevel, crates: crates || [], maxAttempts: share },
            })
        )
    );

    return mergeLabyrinthResults(results);
}

/**
 * Terminate all active simulation workers on a channel and reject their pending promises.
 * @param {string} [channel] - Worker slot to cancel (default: the shared default channel)
 */
export function cancelSimulation(channel = CHANNEL_DEFAULT) {
    const slot = getSlot(channel);
    for (const worker of slot.workers) {
        worker.terminate();
    }
    slot.workers = [];

    const rejects = slot.rejects.slice();
    slot.rejects = [];
    for (const reject of rejects) {
        reject(new Error('Cancelled'));
    }
}
