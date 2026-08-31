/**
 * Multi-Worker Entry for All-Zones Simulation
 *
 * This file is bundled into a string and runs inside a Web Worker.
 * It receives all zones to simulate, creates a pool of child simulation workers,
 * and processes zones via a task queue. Child workers are spawned from a Blob URL
 * created from the simulation worker script passed in the init message.
 *
 * This matches Shykai's architecture: worker-spawned workers get different
 * CPU scheduling from the browser than main-thread-spawned workers.
 *
 * When useEarlyExit is true, only T0 is seeded per zone initially. After each tier
 * completes, a zone_tier_result message is sent to the main thread. The main thread
 * compares XP/hr and profit/hr and responds with zone_tier_decision { skip }. If skip
 * is false, the next tier is enqueued; if true, remaining tiers for that zone are skipped.
 */

let simWorkerBlobURL = null;
let taskIdCounter = 0;

// Pending early-exit decisions: zoneHrid → resolve function
const pendingDecisions = new Map();

onmessage = async function (event) {
    const { type } = event.data;

    if (type === 'start_all_zones') {
        const {
            workerScript,
            gameData,
            playerDTOs,
            zones,
            simulationTimeLimit,
            extraBuffsByPlayer,
            maxWorkers,
            useEarlyExit,
        } = event.data;

        // Create Blob URL for simulation workers from the bundled script string
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        simWorkerBlobURL = URL.createObjectURL(blob);
        const workerURL = simWorkerBlobURL;

        const results = new Array(zones.length);

        // Per-zone progress tracking
        const zoneProgress = new Array(zones.length).fill(0);
        const reportProgress = () => {
            const total = zoneProgress.reduce((sum, p) => sum + p, 0);
            postMessage({ type: 'progress', progress: total / zones.length });
        };

        // zoneInfoMap groups tiers by zone for early exit tracking
        const zoneInfoMap = new Map(); // zoneHrid → { tiers: [{tier, index}], nextIdx }

        // Build initial task queue
        let taskQueue;
        if (useEarlyExit) {
            // Group zones by hrid, sort tiers ascending within each group
            for (let i = 0; i < zones.length; i++) {
                const { zoneHrid, difficultyTier } = zones[i];
                if (!zoneInfoMap.has(zoneHrid)) {
                    zoneInfoMap.set(zoneHrid, { tiers: [], nextIdx: 0 });
                }
                zoneInfoMap.get(zoneHrid).tiers.push({ tier: difficultyTier, index: i });
            }
            for (const info of zoneInfoMap.values()) {
                info.tiers.sort((a, b) => a.tier - b.tier);
            }

            // Seed only the first (lowest) tier per zone
            taskQueue = [];
            for (const [zoneHrid, info] of zoneInfoMap) {
                const first = info.tiers[0];
                taskQueue.push({ zoneHrid, difficultyTier: first.tier, index: first.index });
                info.nextIdx = 1;
            }
        } else {
            taskQueue = [...zones.map((zone, index) => ({ ...zone, index }))];
        }

        const poolSize = Math.min(maxWorkers, taskQueue.length);

        // Each pool slot processes tasks sequentially, one fresh worker per task
        const processQueue = async () => {
            while (taskQueue.length > 0) {
                const task = taskQueue.shift();
                if (!task) continue;
                const taskId = ++taskIdCounter;

                let simResult = null;
                try {
                    simResult = await new Promise((resolve, reject) => {
                        const worker = new Worker(workerURL);

                        worker.onmessage = (e) => {
                            const msg = e.data;
                            if (msg.taskId !== taskId) return;

                            if (msg.type === 'progress') {
                                zoneProgress[task.index] = msg.progress;
                                reportProgress();
                            } else if (msg.type === 'result') {
                                worker.terminate();
                                resolve(msg.simResult);
                            } else if (msg.type === 'error') {
                                worker.terminate();
                                reject(new Error(msg.error));
                            }
                        };

                        worker.onerror = (error) => {
                            worker.terminate();
                            reject(new Error(error.message || 'Worker error'));
                        };

                        worker.postMessage({
                            type: 'start_simulation',
                            taskId,
                            gameData,
                            playerDTOs,
                            zoneHrid: task.zoneHrid,
                            difficultyTier: task.difficultyTier,
                            simulationTimeLimit,
                            extraBuffsByPlayer,
                        });
                    });
                } catch (error) {
                    console.error(`[MultiWorker] Zone ${task.zoneHrid} T${task.difficultyTier} failed:`, error);
                }

                results[task.index] = simResult;
                zoneProgress[task.index] = 100;
                reportProgress();

                // Early exit: send tier result to main thread and await go/skip decision
                if (useEarlyExit && simResult) {
                    const zoneInfo = zoneInfoMap.get(task.zoneHrid);
                    if (zoneInfo && zoneInfo.nextIdx < zoneInfo.tiers.length) {
                        postMessage({
                            type: 'zone_tier_result',
                            zoneHrid: task.zoneHrid,
                            tier: task.difficultyTier,
                            index: task.index,
                            simResult,
                        });

                        const skip = await new Promise((resolve) => {
                            pendingDecisions.set(task.zoneHrid, resolve);
                        });

                        if (skip) {
                            // Mark remaining tiers for this zone as skipped (null result)
                            for (let i = zoneInfo.nextIdx; i < zoneInfo.tiers.length; i++) {
                                results[zoneInfo.tiers[i].index] = null;
                                zoneProgress[zoneInfo.tiers[i].index] = 100;
                            }
                            zoneInfo.nextIdx = zoneInfo.tiers.length;
                            reportProgress();
                        } else {
                            // Enqueue the next tier
                            const next = zoneInfo.tiers[zoneInfo.nextIdx];
                            zoneInfo.nextIdx++;
                            taskQueue.push({
                                zoneHrid: task.zoneHrid,
                                difficultyTier: next.tier,
                                index: next.index,
                            });
                        }
                    }
                }
            }
        };

        try {
            await Promise.all(
                Array(poolSize)
                    .fill()
                    .map(() => processQueue())
            );
            postMessage({ type: 'all_zones_result', results });
        } catch (error) {
            postMessage({ type: 'error', error: error.message || String(error) });
        }

        // Clean up
        URL.revokeObjectURL(simWorkerBlobURL);
        simWorkerBlobURL = null;
    } else if (type === 'zone_tier_decision') {
        // Main thread responded to an early-exit zone_tier_result
        const { zoneHrid, skip } = event.data;
        const resolve = pendingDecisions.get(zoneHrid);
        if (resolve) {
            pendingDecisions.delete(zoneHrid);
            resolve(skip);
        }
    }
};
