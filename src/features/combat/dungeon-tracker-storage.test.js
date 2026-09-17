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
        delete: vi.fn(async (key, storeName) => {
            delete mocks.store[`${storeName}::${key}`];
            return true;
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getActionDetails: vi.fn(() => null),
        getInitClientData: vi.fn(() => null),
        getCurrentCharacterId: vi.fn(() => 'test-character'),
    },
}));

const { default: dungeonTrackerStorage } = await import('./dungeon-tracker-storage.js');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = {};
    dungeonTrackerStorage._legacyMigrationDone = false;
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

        const saved = mocks.store['unifiedRuns::allRuns_test-character'][0];
        expect(saved.result).toBe('success');
        expect(saved.validated).toBe(true);
    });

    test('persists a fail/cancel result and validated flag when provided', async () => {
        await dungeonTrackerStorage.saveTeamRun(
            'Alice',
            successRun({ result: 'fail', validated: false, wavesCompleted: 12 })
        );

        const saved = mocks.store['unifiedRuns::allRuns_test-character'][0];
        expect(saved.result).toBe('fail');
        expect(saved.validated).toBe(false);
        expect(saved.wavesCompleted).toBe(12);
    });
});

describe('getStatsByName', () => {
    test('clear-only stats (avg/fastest/slowest) are unaffected by fails', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
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
        mocks.store['unifiedRuns::allRuns_test-character'] = [
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
        mocks.store['unifiedRuns::allRuns_test-character'] = [legacyRun];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(1);
        expect(stats.failCount).toBe(0);
    });

    test('an all-fail dungeon reports zero clears but a non-zero fail count', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
            successRun({ result: 'fail' }),
            successRun({ result: 'cancel' }),
        ];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(0);
        expect(stats.avgTime).toBe(0);
        expect(stats.failCount).toBe(2);
        expect(stats.totalAttempts).toBe(2);
    });
});

describe('getAllTeamStats', () => {
    test('groups by team and applies the same clear/fail split as getStatsByName', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
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
        mocks.store['unifiedRuns::allRuns_test-character'] = [successRun({ teamKey: 'Alice,Bob', result: 'fail' })];

        const teamStats = await dungeonTrackerStorage.getAllTeamStats();

        expect(teamStats).toHaveLength(0);
    });
});

describe('scrubOutlierRuns', () => {
    test('fails/cancels are excluded from the median calculation and never scrubbed themselves', async () => {
        const baseline = 5 * 60 * 1000;
        mocks.store['unifiedRuns::allRuns_test-character'] = [
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
        const remaining = mocks.store['unifiedRuns::allRuns_test-character'];
        expect(remaining).toHaveLength(6);
        expect(remaining.some((r) => r.result === 'fail')).toBe(true);
    });
});

describe('character-scoped storage', () => {
    test('run history is stored under a per-character key, not a bare global key', async () => {
        await dungeonTrackerStorage.saveTeamRun('Alice', successRun());

        expect(mocks.store['unifiedRuns::allRuns']).toBeUndefined();
        expect(mocks.store['unifiedRuns::allRuns_test-character']).toHaveLength(1);
    });

    test('legacy unscoped history is migrated to the current character on first read', async () => {
        mocks.store['unifiedRuns::allRuns'] = [successRun({ dungeonName: 'Legacy Run' })];

        const runs = await dungeonTrackerStorage.getAllRuns();

        expect(runs).toHaveLength(1);
        expect(runs[0].dungeonName).toBe('Legacy Run');
        expect(mocks.store['unifiedRuns::allRuns_test-character']).toHaveLength(1);
        // The legacy key is cleared immediately so a second character can never re-claim it.
        expect(mocks.store['unifiedRuns::allRuns']).toBeUndefined();
    });

    test('legacy migration never overwrites runs the current character already has', async () => {
        mocks.store['unifiedRuns::allRuns'] = [successRun({ dungeonName: 'Legacy Run' })];
        mocks.store['unifiedRuns::allRuns_test-character'] = [successRun({ dungeonName: 'Already Mine' })];

        const runs = await dungeonTrackerStorage.getAllRuns();

        expect(runs).toHaveLength(1);
        expect(runs[0].dungeonName).toBe('Already Mine');
        // Still cleared, even though this character didn't claim it - prevents a later character
        // from claiming the same stale legacy blob.
        expect(mocks.store['unifiedRuns::allRuns']).toBeUndefined();
    });

    test('migration only runs once per session even across repeated reads', async () => {
        mocks.store['unifiedRuns::allRuns'] = [successRun({ dungeonName: 'Legacy Run' })];

        await dungeonTrackerStorage.getAllRuns();
        // Simulate a second character's runs landing after migration already claimed the legacy
        // blob for the first character - re-adding a legacy key must not trigger a second claim.
        mocks.store['unifiedRuns::allRuns'] = [successRun({ dungeonName: 'Should Not Be Claimed' })];

        const runs = await dungeonTrackerStorage.getAllRuns();

        expect(runs).toHaveLength(1);
        expect(runs[0].dungeonName).toBe('Legacy Run');
    });
});

describe('hibernation-flagged unvalidated runs are excluded from time stats', () => {
    test('getStatsByName excludes an unvalidated hibernation-flagged run from time math but still counts it', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
            successRun({ duration: 5 * 60 * 1000, validated: true }),
            successRun({
                duration: 9 * 60 * 60 * 1000, // wildly inflated by a sleep gap
                validated: false,
                hibernationDetected: true,
            }),
        ];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(1);
        expect(stats.avgTime).toBe(5 * 60 * 1000);
        expect(stats.slowestTime).toBe(5 * 60 * 1000);
        expect(stats.hibernationFlaggedCount).toBe(1);
        expect(stats.totalAttempts).toBe(2);
    });

    test('a validated run is never excluded even if hibernationDetected is true (server-anchored duration is immune)', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
            successRun({ duration: 5 * 60 * 1000, validated: true, hibernationDetected: true }),
        ];

        const stats = await dungeonTrackerStorage.getStatsByName('Pirate Cove');

        expect(stats.totalRuns).toBe(1);
        expect(stats.avgTime).toBe(5 * 60 * 1000);
        expect(stats.hibernationFlaggedCount).toBe(0);
    });

    test('getAllTeamStats applies the same hibernation-reliability split', async () => {
        mocks.store['unifiedRuns::allRuns_test-character'] = [
            successRun({ teamKey: 'Alice,Bob', duration: 5 * 60 * 1000, validated: true }),
            successRun({
                teamKey: 'Alice,Bob',
                duration: 9 * 60 * 60 * 1000,
                validated: false,
                hibernationDetected: true,
            }),
        ];

        const [teamStats] = await dungeonTrackerStorage.getAllTeamStats();

        expect(teamStats.runCount).toBe(1);
        expect(teamStats.avgTime).toBe(5 * 60 * 1000);
        expect(teamStats.hibernationFlaggedCount).toBe(1);
        expect(teamStats.totalAttempts).toBe(2);
    });
});
