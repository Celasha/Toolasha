/**
 * Worker Pool Manager
 * Manages a pool of Web Workers for parallel task execution
 */

class WorkerPool {
    constructor(workerScript, poolSize = null) {
        // Auto-detect optimal pool size (max 4 workers)
        this.poolSize = poolSize || Math.min(navigator.hardwareConcurrency || 2, 4);
        this.workerScript = workerScript;
        this.workers = [];
        this.taskQueue = [];
        this.activeWorkers = new Set();
        this.nextTaskId = 0;
        this.initialized = false;
    }

    /**
     * Initialize the worker pool
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Create workers
            for (let i = 0; i < this.poolSize; i++) {
                const worker = new Worker(URL.createObjectURL(this.workerScript));
                this.workers.push({
                    id: i,
                    worker,
                    busy: false,
                    currentTask: null,
                });
            }

            this.initialized = true;
        } catch (error) {
            console.error('[WorkerPool] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Execute a task in the worker pool
     * @param {Object} taskData - Data to send to worker
     * @returns {Promise} Promise that resolves with worker result
     */
    async execute(taskData) {
        if (!this.initialized) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const taskId = this.nextTaskId++;
            const task = {
                id: taskId,
                data: taskData,
                resolve,
                reject,
                timestamp: Date.now(),
            };

            // Try to assign to an available worker immediately
            const availableWorker = this.workers.find((w) => !w.busy);

            if (availableWorker) {
                this.assignTask(availableWorker, task);
            } else {
                // Queue the task if all workers are busy
                this.taskQueue.push(task);
            }
        });
    }

    /**
     * Execute multiple tasks in parallel
     * @param {Array} taskDataArray - Array of task data objects
     * @returns {Promise<Array>} Promise that resolves with array of results
     */
    async executeAll(taskDataArray) {
        if (!this.initialized) {
            await this.initialize();
        }

        const promises = taskDataArray.map((taskData) => this.execute(taskData));
        return Promise.all(promises);
    }

    /**
     * Assign a task to a worker
     * @private
     */
    assignTask(workerWrapper, task) {
        workerWrapper.busy = true;
        workerWrapper.currentTask = task;

        // Set up message handler for this specific task
        const messageHandler = (e) => {
            const { taskId, result, error } = e.data;

            if (taskId === task.id) {
                // Clean up
                workerWrapper.worker.removeEventListener('message', messageHandler);
                workerWrapper.worker.removeEventListener('error', errorHandler);
                workerWrapper.busy = false;
                workerWrapper.currentTask = null;

                // Resolve or reject the promise
                if (error) {
                    task.reject(new Error(error));
                } else {
                    task.resolve(result);
                }

                // Process next task in queue
                this.processQueue();
            }
        };

        const errorHandler = (error) => {
            console.error('[WorkerPool] Worker error:', error);
            workerWrapper.worker.removeEventListener('message', messageHandler);
            workerWrapper.worker.removeEventListener('error', errorHandler);
            workerWrapper.busy = false;
            workerWrapper.currentTask = null;

            task.reject(error);

            // Process next task in queue
            this.processQueue();
        };

        workerWrapper.worker.addEventListener('message', messageHandler);
        workerWrapper.worker.addEventListener('error', errorHandler);

        // Send task to worker
        workerWrapper.worker.postMessage({
            taskId: task.id,
            data: task.data,
        });
    }

    /**
     * Process the next task in the queue
     * @private
     */
    processQueue() {
        if (this.taskQueue.length === 0) {
            return;
        }

        const availableWorker = this.workers.find((w) => !w.busy);
        if (availableWorker) {
            const task = this.taskQueue.shift();
            this.assignTask(availableWorker, task);
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            poolSize: this.poolSize,
            busyWorkers: this.workers.filter((w) => w.busy).length,
            queuedTasks: this.taskQueue.length,
            totalWorkers: this.workers.length,
        };
    }

    /**
     * Terminate all workers and clean up
     */
    terminate() {
        for (const workerWrapper of this.workers) {
            workerWrapper.worker.terminate();
        }

        this.workers = [];
        this.taskQueue = [];
        this.initialized = false;
    }
}

export default WorkerPool;
