import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { getSetting: () => 0 } }));

const { runAllZonesSimulation, cancelAllZonesSimulation } = await import('./all-zones-runner.js');
const { CHANNEL_TASKS, CHANNEL_DEFAULT } = await import('./combat-sim-runner.js');

describe('all-zones runs per channel', () => {
    let workers;

    beforeEach(() => {
        workers = [];
        class FakeWorker {
            constructor() {
                this.terminated = false;
                workers.push(this);
            }
            postMessage() {}
            terminate() {
                this.terminated = true;
            }
        }
        vi.stubGlobal('Worker', FakeWorker);
        vi.stubGlobal('Blob', class {});
        vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} });
    });

    afterEach(() => {
        cancelAllZonesSimulation(CHANNEL_DEFAULT);
        cancelAllZonesSimulation(CHANNEL_TASKS);
        vi.unstubAllGlobals();
    });

    const params = {
        gameData: {},
        playerDTOs: [],
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        hours: 1,
        communityBuffs: {},
    };
    const settled = (promise) =>
        promise.then(
            () => 'resolved',
            (error) => error.message
        );

    test('a task estimate does not cancel a Combat Sim run, and vice versa', async () => {
        const sim = settled(runAllZonesSimulation(params));
        const taskRun = settled(runAllZonesSimulation(params, undefined, { channel: CHANNEL_TASKS }));

        expect(workers.map((worker) => worker.terminated)).toEqual([false, false]);

        cancelAllZonesSimulation(CHANNEL_DEFAULT);
        expect(workers.map((worker) => worker.terminated)).toEqual([true, false]);
        expect(await sim).toBe('Cancelled');

        cancelAllZonesSimulation(CHANNEL_TASKS);
        expect(await taskRun).toBe('Cancelled');
    });

    test('a new run on the same channel cancels the one in flight', async () => {
        const first = settled(runAllZonesSimulation(params));
        const second = settled(runAllZonesSimulation(params));

        expect(await first).toBe('Cancelled');
        expect(workers.map((worker) => worker.terminated)).toEqual([true, false]);

        cancelAllZonesSimulation();
        expect(await second).toBe('Cancelled');
    });

    test('cancelling with nothing running does nothing', () => {
        expect(() => cancelAllZonesSimulation()).not.toThrow();
        expect(() => cancelAllZonesSimulation(CHANNEL_TASKS)).not.toThrow();
    });
});
