/**
 * All Zones Combat Simulator Runner
 * Uses a dedicated coordinator worker (multiWorker) that spawns child simulation workers.
 *
 * Worker-spawned workers get different CPU scheduling from the browser than
 * main-thread-spawned workers, matching Shykai's architecture for better
 * multi-zone throughput.
 */

import { buildExtraBuffsByPlayer } from './combat-sim-runner.js';
import WORKER_SCRIPT from './combat-sim-worker-entry.js?worker';
import MULTI_WORKER_SCRIPT from './multi-worker-entry.js?worker';
import { calculateSimRevenue } from './combat-sim-adapter.js';
import config from '../../core/config.js';

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
 * @param {boolean} [params.useEarlyExit] - Skip higher tiers when both XP/hr and profit/hr decline
 * @param {Function} [onProgress] - Called with (percent: 0-100) for overall progress
 * @returns {Promise<Array<Object>>} Array of SimResults, one per zone (same order as input)
 */
export async function runAllZonesSimulation(params, onProgress) {
    const { gameData, playerDTOs, zones, hours, communityBuffs, useEarlyExit } = params;

    if (!zones.length) return [];

    // Cancel any previous run
    cancelAllZonesSimulation();

    const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
    const ONE_HOUR_NS = 3600 * 1e9;
    const simulationTimeLimit = hours * ONE_HOUR_NS;

    const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const maxThreadsSetting = config.getSetting('combatSim_maxThreads') || 0;
    const maxWorkers = maxThreadsSetting > 0 ? Math.min(maxThreadsSetting, availableCores) : availableCores;

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

        // Per-zone tier metrics for early exit comparison: zoneHrid → [{xpPerHour, profitPerHour}]
        const tierResultsByZone = new Map();

        worker.onmessage = (event) => {
            const msg = event.data;

            if (msg.type === 'progress') {
                if (onProgress) onProgress(Math.round(msg.progress));
            } else if (msg.type === 'zone_tier_result') {
                // Calculate XP/hr and profit/hr for this tier and decide whether to skip the next
                const { zoneHrid, simResult } = msg;
                const simHours = (simResult.simulatedTime || 0) / (3600 * 1e9) || hours;

                // Sum XP across all players and all skills
                let totalXP = 0;
                for (const playerXP of Object.values(simResult.experienceGained || {})) {
                    for (const xp of Object.values(playerXP)) {
                        totalXP += xp;
                    }
                }
                const xpPerHour = totalXP / simHours;

                let profitPerHour = 0;
                try {
                    const revenue = calculateSimRevenue(simResult, gameData, 'player1', simHours);
                    profitPerHour = revenue.netPerHour;
                } catch {
                    // Revenue calculation may fail if market data is unavailable
                }

                const prevResults = tierResultsByZone.get(zoneHrid) || [];
                const currMetrics = { xpPerHour, profitPerHour };

                let skip = false;
                if (prevResults.length > 0) {
                    const prev = prevResults[prevResults.length - 1];
                    if (xpPerHour < prev.xpPerHour && profitPerHour < prev.profitPerHour) {
                        skip = true;
                    }
                }

                prevResults.push(currMetrics);
                tierResultsByZone.set(zoneHrid, prevResults);

                worker.postMessage({ type: 'zone_tier_decision', zoneHrid, skip });
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
            extraBuffsByPlayer,
            maxWorkers,
            useEarlyExit: !!useEarlyExit,
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
