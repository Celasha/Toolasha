import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
    buildExtraBuffs,
    buildExtraBuffsByPlayer,
    splitAttempts,
    mergeLabyrinthResults,
    runSimulation,
    runWorkerChunk,
    cancelSimulation,
    CHANNEL_DEFAULT,
    CHANNEL_TASKS,
} from './combat-sim-runner.js';

describe('buildExtraBuffs (CSIM-AUD-019/021) - no longer carries guild/Shrine buffs', () => {
    test('hasMooPass=true contributes the MooPass wisdom buff', () => {
        const buffs = buildExtraBuffs({}, true);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
    });

    test('hasMooPass=false contributes no MooPass buff', () => {
        const buffs = buildExtraBuffs({}, false);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(false);
    });

    test('community EXP/Drop buffs are genuinely global and always included regardless of hasMooPass', () => {
        const buffs = buildExtraBuffs({ comExp: 5, comDrop: 3 }, false);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/combat_community_buff')).toBe(true);
    });

    test('never accepts/emits guild combat buffs - Shrines are handled exclusively by the engine Shrine class', () => {
        // Old signature took a second guildCombatBuffs array param; confirm passing one has no effect.
        const buffs = buildExtraBuffs({}, [{ uniqueHrid: '/buff_uniques/should_be_ignored' }]);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/should_be_ignored')).toBe(false);
    });
});

describe('buildExtraBuffsByPlayer - per-player ownership (CSIM-AUD-019/020)', () => {
    test('each player gets their own array, keyed by their own hrid, based on their own hasMooPass flag', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: true },
            { hrid: 'player2', hasMooPass: false },
            { hrid: 'player3', hasMooPass: true },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, {});

        expect(byPlayer.player1.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
        expect(byPlayer.player2.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(false);
        expect(byPlayer.player3.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
    });

    test('every player gets a distinct array reference - never one shared array applied to all players', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: true },
            { hrid: 'player2', hasMooPass: true },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, {});

        expect(byPlayer.player1).not.toBe(byPlayer.player2);
        expect(byPlayer.player1).toEqual(byPlayer.player2); // same content, different identity
    });

    test('community buffs are applied identically to every player (genuinely global)', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: false },
            { hrid: 'player2', hasMooPass: false },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, { comExp: 10 });

        expect(byPlayer.player1.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
        expect(byPlayer.player2.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
    });
});

describe('labyrinth attempt batching', () => {
    test('splitAttempts spreads attempts evenly and never gives a worker zero', () => {
        expect(splitAttempts(100, 4)).toEqual([25, 25, 25, 25]);
        expect(splitAttempts(10, 4)).toEqual([3, 3, 2, 2]);
        expect(splitAttempts(3, 6)).toEqual([1, 1, 1]);
        expect(splitAttempts(5, 1)).toEqual([5]);
        expect(splitAttempts(1, 0)).toEqual([1]);
    });

    test('mergeLabyrinthResults adds wins, attempts, elapsed time, and XP', () => {
        const merged = mergeLabyrinthResults([
            {
                encounters: 3,
                labyAttemptCount: 10,
                simulatedTime: 600e9,
                experienceGained: { p1: { attack: 10, melee: 5 } },
            },
            {
                encounters: 4,
                labyAttemptCount: 12,
                simulatedTime: 700e9,
                experienceGained: { p1: { attack: 20 }, p2: { melee: 1 } },
            },
        ]);

        expect(merged).toEqual({
            encounters: 7,
            labyAttemptCount: 22,
            simulatedTime: 1300e9,
            experienceGained: { p1: { attack: 30, melee: 5 }, p2: { melee: 1 } },
        });
    });

    test('mergeLabyrinthResults tolerates missing fields', () => {
        expect(mergeLabyrinthResults([{}])).toEqual({
            encounters: 0,
            labyAttemptCount: 0,
            simulatedTime: 0,
            experienceGained: {},
        });
    });
});

describe('worker channels - independent features never cancel each other', () => {
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
        vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} });
    });

    afterEach(() => {
        cancelSimulation(CHANNEL_DEFAULT);
        cancelSimulation(CHANNEL_TASKS);
        vi.unstubAllGlobals();
    });

    const params = {
        gameData: {},
        playerDTOs: [],
        zoneHrid: '/actions/combat/fly',
        difficultyTier: 0,
        hours: 1,
        communityBuffs: {},
    };
    const settled = (promise) =>
        promise.then(
            () => 'resolved',
            (error) => error.message
        );

    test('cancelling the default channel leaves a run on another channel alone', async () => {
        const task = runWorkerChunk({ taskId: 1 }, undefined, CHANNEL_TASKS);
        const sim = runWorkerChunk({ taskId: 2 }, undefined, CHANNEL_DEFAULT);

        cancelSimulation(CHANNEL_DEFAULT);

        await expect(sim).rejects.toThrow('Cancelled');
        expect(workers[0].terminated).toBe(false);
        expect(workers[1].terminated).toBe(true);
        cancelSimulation(CHANNEL_TASKS);
        await expect(task).rejects.toThrow('Cancelled');
    });

    test('starting a run cancels an earlier run on the same channel only', async () => {
        const taskRun = settled(runSimulation(params, undefined, { channel: CHANNEL_TASKS }));
        const firstSim = settled(runSimulation(params));
        const secondSim = runSimulation(params);

        expect(await firstSim).toBe('Cancelled');
        expect(workers.map((worker) => worker.terminated)).toEqual([false, true, false]);

        cancelSimulation(CHANNEL_DEFAULT);
        cancelSimulation(CHANNEL_TASKS);
        await expect(secondSim).rejects.toThrow('Cancelled');
        expect(await taskRun).toBe('Cancelled');
    });

    test('runs without a channel share the default one, as before', async () => {
        const first = settled(runSimulation(params));
        const second = runSimulation(params);

        expect(await first).toBe('Cancelled');

        cancelSimulation();
        await expect(second).rejects.toThrow('Cancelled');
    });
});
