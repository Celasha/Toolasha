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
 */

let simWorkerBlobURL = null;
let taskIdCounter = 0;

onmessage = async function (event) {
    const { type } = event.data;

    if (type === 'start_all_zones') {
        const { workerScript, gameData, playerDTOs, zones, simulationTimeLimit, extraBuffs, maxWorkers } = event.data;

        // Create Blob URL for simulation workers from the bundled script string
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        simWorkerBlobURL = URL.createObjectURL(blob);

        const poolSize = Math.min(maxWorkers, zones.length);
        const workerURL = simWorkerBlobURL;

        const taskQueue = [...zones.map((zone, index) => ({ ...zone, index }))];
        const results = new Array(zones.length);

        // Per-zone progress tracking
        const zoneProgress = new Array(zones.length).fill(0);
        const reportProgress = () => {
            const total = zoneProgress.reduce((sum, p) => sum + p, 0);
            postMessage({ type: 'progress', progress: total / zones.length });
        };

        // Each pool slot processes zones sequentially, fresh worker per zone
        const processQueue = async () => {
            while (taskQueue.length > 0) {
                const task = taskQueue.shift();
                const taskId = ++taskIdCounter;

                try {
                    const simResult = await new Promise((resolve, reject) => {
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
                            extraBuffs,
                        });
                    });

                    results[task.index] = simResult;
                } catch (error) {
                    console.error(`[MultiWorker] Zone ${task.zoneHrid} T${task.difficultyTier} failed:`, error);
                    results[task.index] = null;
                }

                zoneProgress[task.index] = 100;
                reportProgress();
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
    }
};
