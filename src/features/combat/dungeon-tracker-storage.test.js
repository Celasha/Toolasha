/**
 * Dungeon Tracker Storage - fail/cancel capture regressions.
 *
 * A failed/canceled attempt still costs real time, but isn't a clear. These tests assert that
 * saveTeamRun() persists a `result` field, that the existing clear-only stats (avgTime/fastest/
 * slowest) stay unaffected by fails, and that a new attempt-inclusive stat surfaces the real
 * time cost without double-counting fails as output.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    store: {},
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, storeName, defaultValue) => mocks.store[`${storeName}::${key}`] ?? defaultValue),
        setJSON: vi.fn(async (key, value, storeName) => {
            mocks.store[`${storeName}::${key}`] = value;
            return true;
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getActionDetails: vi.fn(() => null),
        getInitClientData: vi.fn(() => null),
    },
}));

const { default: dungeonTrackerStorage } = await import('./dungeon-tracker-storage.js');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = {};
});

function successRun(overrides = {}) {
    return {
        timestamp: new Date(1000).toISOString(),
        duration: 5 * 60 * 1000,
        dungeonName: 'Pirate Cove',
        ...overrides,
    };
}

describe('saveTeamRun', () => {
    test('defaults result to success and validated to true when omitted', async () => {
        await dungeonTrackerStorage.saveTeamRun('Alice', successRun());

        const saved = mocks.store['unifiedRuns::allRuns'][0];
        expect(saved.result).toBe('success');
        expect(saved.validated).toBe(true);
    });

    test('persists a fail/cancel result and validated flag when provided', async () => {
        await dungeonTrackerStorage.saveTeamRun(
            'Alice',
            successRun({ result: 'fail', validated: false, wavesCompleted: 12 })
        );

        const saved = mocks.store['unifiedRuns::allRuns'][0];
        expect(saved.result).toBe('fail');
        expect(saved.validated).toBe(false);
        expect(saved.wavesCompleted).toBe(12);
    });
});

describe('getStatsByName', () => {
    test('clear-only stats (avg/fastest/slowest) are unaffected by fails', async () => {
        mocks.store['unifiedRuns::allRuns'] = [
            successRun({ timestamp: new Date(1000).toISOString(), duration: 4 * 60 * 1000 }),
            successRun({ timestamp: new Date(2000).toISOString(), duration: 6 * 60 * 1000 }),
            successRun({
                timestamp: new Date(3000).toISOString(),
                duration: 30 * 60 * 1000, // a long fail shouldn't drag fastest/slowest/avg
                result: 'fail',
            }),
        ];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(2);
        expect(stats.avgTime).toBe(5 * 60 * 1000);
        expect(stats.fastestTime).toBe(4 * 60 * 1000);
        expect(stats.slowestTime).toBe(6 * 60 * 1000);
    });

    test('avgTimePerAttempt folds fail time into the cost but keeps the clear count as denominator', async () => {
        mocks.store['unifiedRuns::allRuns'] = [
            successRun({ timestamp: new Date(1000).toISOString(), duration: 5 * 60 * 1000 }),
            successRun({ timestamp: new Date(2000).toISOString(), duration: 5 * 60 * 1000 }),
            successRun({ timestamp: new Date(3000).toISOString(), duration: 10 * 60 * 1000, result: 'fail' }),
        ];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        // (5+5+10) minutes of total time cost / 2 clears = 10 minutes/clear
        expect(stats.avgTimePerAttempt).toBe(10 * 60 * 1000);
        expect(stats.failCount).toBe(1);
        expect(stats.totalAttempts).toBe(3);
    });

    test('runs saved before the result field existed are treated as successes', async () => {
        const legacyRun = successRun();
        delete legacyRun.result;
        mocks.store['unifiedRuns::allRuns'] = [legacyRun];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(1);
        expect(stats.failCount).toBe(0);
    });

    test('an all-fail dungeon reports zero clears but a non-zero fail count', async () => {
        mocks.store['unifiedRuns::allRuns'] = [successRun({ result: 'fail' }), successRun({ result: 'cancel' })];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(0);
        expect(stats.avgTime).toBe(0);
        expect(stats.failCount).toBe(2);
        expect(stats.totalAttempts).toBe(2);
    });
});

describe('getAllTeamStats', () => {
    test('groups by team and applies the same clear/fail split as getStatsByName', async () => {
        mocks.store['unifiedRuns::allRuns'] = [
            successRun({ teamKey: 'Alice,Bob', duration: 5 * 60 * 1000 }),
            successRun({ teamKey: 'Alice,Bob', duration: 5 * 60 * 1000, result: 'fail' }),
        ];

        const [teamStats] = await dungeonTrackerStorage.getAllTeamStats();

        expect(teamStats.teamKey).toBe('Alice,Bob');
        expect(teamStats.runCount).toBe(1);
        expect(teamStats.failCount).toBe(1);
        expect(teamStats.totalAttempts).toBe(2);
        expect(teamStats.avgTimePerAttempt).toBe(10 * 60 * 1000);
    });

    test('a team with only fails is excluded (no clears to report on)', async () => {
        mocks.store['unifiedRuns::allRuns'] = [successRun({ teamKey: 'Alice,Bob', result: 'fail' })];

        const teamStats = await dungeonTrackerStorage.getAllTeamStats();

        expect(teamStats).toHaveLength(0);
    });
});

describe('scrubOutlierRuns', () => {
    test('fails/cancels are excluded from the median calculation and never scrubbed themselves', async () => {
        const baseline = 5 * 60 * 1000;
        mocks.store['unifiedRuns::allRuns'] = [
            ...Array.from({ length: 5 }, (_, i) =>
                successRun({ teamKey: 'Alice', timestamp: new Date(i * 1000).toISOString(), duration: baseline })
            ),
            // A short fail that would corrupt the median if it were mixed into the clear group.
            successRun({
                teamKey: 'Alice',
                timestamp: new Date(9000).toISOString(),
                duration: 10 * 1000,
                result: 'fail',
            }),
        ];

        const removed = await dungeonTrackerStorage.scrubOutlierRuns();

        expect(removed).toBe(0);
        const remaining = mocks.store['unifiedRuns::allRuns'];
        expect(remaining).toHaveLength(6);
        expect(remaining.some((r) => r.result === 'fail')).toBe(true);
    });
});
