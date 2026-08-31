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
let activeWorkers = [];
let taskIdCounter = 0;
let pendingRejects = []; // Track reject functions to abort on cancel

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
 * @returns {Promise<Object>} SimResult
 */
export async function runSimulation(params, onProgress) {
    const { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs } = params;

    const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
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
        difficultyTier,
        // Preserve the exact requested duration, including fractional hours - one target's
        // simulation timeline must never be time-sliced.
        simulationTimeLimit: hours * ONE_HOUR_NS,
        extraBuffsByPlayer,
    };

    const result = await runWorkerChunk(message, onProgress);

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
