/**
 * All Zones Combat Simulator Runner
 * Uses a dedicated coordinator worker (multiWorker) that spawns child simulation workers.
 *
 * Worker-spawned workers get different CPU scheduling from the browser than
 * main-thread-spawned workers, matching Shykai's architecture for better
 * multi-zone throughput.
 */

import { buildExtraBuffs } from './combat-sim-runner.js';
import WORKER_SCRIPT from './combat-sim-worker-entry.js?worker';
import MULTI_WORKER_SCRIPT from './multi-worker-entry.js?worker';

let multiWorker = null;
let activeReject = null;

/**
 * Run simulations for all specified zones in parallel via a coordinator worker.
 * @param {Object} params
 * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
 * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
 * @param {Array<{zoneHrid: string, difficultyTier: number}>} params.zones - Zones to simulate
 * @param {number} params.hours - Hours to simulate per zone
 * @param {Object} params.communityBuffs - { mooPass, comExp, comDrop }
 * @param {Function} [onProgress] - Called with (percent: 0-100) for overall progress
 * @returns {Promise<Array<Object>>} Array of SimResults, one per zone (same order as input)
 */
export async function runAllZonesSimulation(params, onProgress) {
    const { gameData, playerDTOs, zones, hours, communityBuffs } = params;

    if (!zones.length) return [];

    // Cancel any previous run
    cancelAllZonesSimulation();

    const extraBuffs = buildExtraBuffs(communityBuffs);
    const ONE_HOUR_NS = 3600 * 1e9;
    const simulationTimeLimit = hours * ONE_HOUR_NS;

    const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const maxWorkers = availableCores;

    return new Promise((resolve, reject) => {
        // Store reject so cancelAllZonesSimulation can unblock the promise
        activeReject = reject;

        // Create the coordinator worker
        const blob = new Blob([MULTI_WORKER_SCRIPT], { type: 'application/javascript' });
        const blobURL = URL.createObjectURL(blob);
        const worker = new Worker(blobURL);
        multiWorker = worker;

        const cleanup = () => {
            multiWorker = null;
            activeReject = null;
            URL.revokeObjectURL(blobURL);
        };

        worker.onmessage = (event) => {
            const msg = event.data;

            if (msg.type === 'progress') {
                if (onProgress) onProgress(Math.round(msg.progress));
            } else if (msg.type === 'all_zones_result') {
                worker.terminate();
                cleanup();
                if (onProgress) onProgress(100);
                resolve(msg.results);
            } else if (msg.type === 'error') {
                worker.terminate();
                cleanup();
                reject(new Error(msg.error));
            }
        };

        worker.onerror = (error) => {
            worker.terminate();
            cleanup();
            reject(new Error(error.message || 'MultiWorker error'));
        };

        // Send the simulation worker script as a string so the multiWorker can spawn child workers
        worker.postMessage({
            type: 'start_all_zones',
            workerScript: WORKER_SCRIPT,
            gameData,
            playerDTOs,
            zones,
            simulationTimeLimit,
            extraBuffs,
            maxWorkers,
        });
    });
}

/**
 * Terminate the coordinator worker (kills all child workers too) and reject the pending promise.
 */
export function cancelAllZonesSimulation() {
    if (multiWorker) {
        multiWorker.terminate();
        multiWorker = null;
    }
    if (activeReject) {
        activeReject(new Error('Cancelled'));
        activeReject = null;
    }
}
