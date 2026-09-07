/**
 * TLA-047 - Dungeon Tracker offline-resume lifecycle regressions.
 *
 * checkForActiveDungeon() (page-load bootstrap) must never make saved in-progress timing state
 * authoritative on its own - it has no live battleId to validate against. Only the guarded
 * restoreInProgressRun(currentBattleId), exercised from onNewBattle() once a real new_battle
 * arrives, may promote saved state to isTracking=true, and only after battle identity, active
 * dungeon match, and 10-minute freshness all pass.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentActions: [],
    actionDetailsByHrid: {},
    savedInProgressRun: null,
    dungeonInfoByHrid: {},
    savedTeamRuns: [],
    scrubCalls: 0,
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentActions: vi.fn(() => mocks.currentActions),
        getActionDetails: vi.fn((hrid) => mocks.actionDetailsByHrid[hrid] || null),
    },
}));

vi.mock('./dungeon-tracker-storage.js', () => ({
    default: {
        getDungeonInfo: vi.fn((hrid) => mocks.dungeonInfoByHrid[hrid] || null),
        getTeamKey: vi.fn((team) => team.join('|')),
        saveTeamRun: vi.fn(async (teamKey, run) => {
            mocks.savedTeamRuns.push({ teamKey, run });
            return true;
        }),
        scrubOutlierRuns: vi.fn(async () => {
            mocks.scrubCalls += 1;
            return { removed: 0 };
        }),
    },
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async () => mocks.savedInProgressRun),
        setJSON: vi.fn(async () => true),
        delete: vi.fn(async () => true),
    },
}));

vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({
        registerInterval: vi.fn(),
        registerTimeout: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

const { default: dungeonTracker } = await import('./dungeon-tracker.js');
const { default: storage } = await import('../../core/storage.js');
const { default: dungeonTrackerStorage } = await import('./dungeon-tracker-storage.js');

const DUNGEON_HRID = '/actions/combat/pirate_cove_dungeon';

function dungeonAction(overrides = {}) {
    return { actionHrid: DUNGEON_HRID, isDone: false, difficultyTier: 0, ...overrides };
}

function keyCountMessage(keyCountString) {
    return { systemMetadata: JSON.stringify({ keyCountString }) };
}

// onKeyCountsMessage() fires completeDungeon() without awaiting it (fire-and-forget), so tests
// must yield past its internal awaits (clearInProgressRun, then saveTeamRun) before asserting.
function flushAsync() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentActions = [dungeonAction()];
    mocks.actionDetailsByHrid = { [DUNGEON_HRID]: { combatZoneInfo: { isDungeon: true } } };
    mocks.savedInProgressRun = null;
    mocks.dungeonInfoByHrid = { [DUNGEON_HRID]: { name: 'Pirate Cove', maxWaves: 10 } };
    mocks.savedTeamRuns = [];
    mocks.scrubCalls = 0;

    dungeonTracker.isTracking = false;
    dungeonTracker.currentRun = null;
    dungeonTracker.waveStartTime = null;
    dungeonTracker.waveTimes = [];
    dungeonTracker.pendingDungeonInfo = null;
    dungeonTracker.currentBattleId = null;
    dungeonTracker.firstKeyCountTimestamp = null;
    dungeonTracker.lastKeyCountTimestamp = null;
    dungeonTracker.keyCountMessages = [];
    dungeonTracker.pendingNextRunFirstKeyCount = null;
    dungeonTracker.battleStartedTimestamp = null;
    dungeonTracker.hibernationDetected = false;
    dungeonTracker._lastCompletionTime = 0;
});

describe('TLA047-01: stale same-dungeon page-load state is not trusted', () => {
    test('checkForActiveDungeon() never installs saved timing state as active tracking', () => {
        mocks.savedInProgressRun = {
            battleId: 111,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now() - 20 * 60 * 1000, // 20 minutes old
            firstKeyCountTimestamp: 1000,
            lastKeyCountTimestamp: 1000,
            keyCountsMap: { Alice: 5 },
        };

        dungeonTracker.checkForActiveDungeon();

        expect(dungeonTracker.isTracking).toBe(false);
        expect(dungeonTracker.currentRun).toBeNull();
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.lastKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.pendingDungeonInfo).toEqual({ dungeonHrid: DUNGEON_HRID, tier: 0 });
        // checkForActiveDungeon() no longer reads the saved in-progress run at all.
        expect(storage.getJSON).not.toHaveBeenCalled();
    });
});

describe('TLA047-02: different battle ID invalidates saved state', () => {
    test('a mid-dungeon new_battle with a different battleId rejects and clears the stale save', async () => {
        mocks.savedInProgressRun = {
            battleId: 111,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now() - 1000, // fresh
            firstKeyCountTimestamp: 5000,
            lastKeyCountTimestamp: 5000,
            keyCountsMap: { Alice: 5 },
        };

        dungeonTracker.checkForActiveDungeon();
        expect(dungeonTracker.isTracking).toBe(false);

        await dungeonTracker.onNewBattle({ wave: 3, battleId: 222, combatStartTime: Date.now() });

        expect(storage.delete).toHaveBeenCalledWith('dungeonTracker_inProgressRun', 'settings');
        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.currentBattleId).toBe(222);
        // Old party timestamps must not be retained.
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.lastKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.currentRun.dungeonHrid).toBe(DUNGEON_HRID);
    });
});

describe('TLA047-03: valid same-battle reconnect still restores', () => {
    test('a fresh same-battleId save restores wave/timestamp state via the guarded path', async () => {
        mocks.savedInProgressRun = {
            battleId: 222,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            currentWave: 3,
            maxWaves: 10,
            wavesCompleted: 2,
            waveTimes: [1000, 1200],
            waveStartTime: 2000,
            lastUpdateTime: Date.now() - 1000, // fresh
            firstKeyCountTimestamp: 5000,
            lastKeyCountTimestamp: 5000,
            keyCountsMap: { Alice: 5 },
            keyCountMessages: [{ timestamp: 5000, keyCountsMap: { Alice: 5 }, text: 'Key counts: [Alice - 5]' }],
        };

        dungeonTracker.checkForActiveDungeon();
        expect(dungeonTracker.isTracking).toBe(false);

        await dungeonTracker.onNewBattle({ wave: 3, battleId: 222, combatStartTime: Date.now() });

        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.currentBattleId).toBe(222);
        expect(dungeonTracker.firstKeyCountTimestamp).toBe(5000);
        expect(dungeonTracker.lastKeyCountTimestamp).toBe(5000);
        expect(dungeonTracker.waveTimes).toEqual([1000, 1200]);
        expect(dungeonTracker.currentRun.wavesCompleted).toBe(2);
    });
});

describe('TLA047-04: wave 0 remains fresh-start authority', () => {
    test('a wave-0 new_battle clears stale saved state and starts fresh regardless of any save', async () => {
        mocks.savedInProgressRun = {
            battleId: 111,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now() - 1000,
            firstKeyCountTimestamp: 5000,
            lastKeyCountTimestamp: 5000,
            keyCountsMap: { Alice: 5 },
        };

        dungeonTracker.checkForActiveDungeon();

        await dungeonTracker.onNewBattle({ wave: 0, battleId: 333, combatStartTime: Date.now() });

        expect(storage.delete).toHaveBeenCalledWith('dungeonTracker_inProgressRun', 'settings');
        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.currentBattleId).toBe(333);
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.lastKeyCountTimestamp).toBeNull();
    });
});

describe('TLA047-05: exact offline-gap regression', () => {
    test('a stale pre-close save reconnecting into a new battle never persists a run spanning the offline gap', async () => {
        const preCloseFirstTimestamp = new Date('2026-09-05T15:51:32Z').getTime();
        mocks.savedInProgressRun = {
            battleId: 111, // old battle instance, pre-close
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: preCloseFirstTimestamp,
            lastUpdateTime: preCloseFirstTimestamp,
            firstKeyCountTimestamp: preCloseFirstTimestamp,
            lastKeyCountTimestamp: preCloseFirstTimestamp,
            keyCountsMap: { Alice: 5 },
        };

        // Page reload while the same dungeon action is still active server-side.
        dungeonTracker.checkForActiveDungeon();
        expect(dungeonTracker.isTracking).toBe(false);

        // Reconnect establishes a brand-new battle instance (different battleId) mid-dungeon.
        const resumeStart = new Date('2026-09-06T04:20:38Z').getTime();
        await dungeonTracker.onNewBattle({ wave: 4, battleId: 222, combatStartTime: resumeStart });

        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();

        // First post-reconnect Key counts message anchors the new run (as scanExistingChatMessages
        // would in production - the live onKeyCountsMessage path treats the first message received
        // while currentRun.startTime is already set as a completion, by design, for restore cases).
        dungeonTracker.firstKeyCountTimestamp = resumeStart;
        dungeonTracker.lastKeyCountTimestamp = resumeStart;
        expect(dungeonTracker.firstKeyCountTimestamp).toBe(resumeStart);

        // Completion message ~26 minutes later (an ordinary Pirate Cove run length).
        const completionTimestamp = resumeStart + 26 * 60 * 1000;
        dungeonTracker.onKeyCountsMessage(completionTimestamp, keyCountMessage('[Alice - 5]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        const savedDuration = mocks.savedTeamRuns[0].run.duration;
        expect(savedDuration).toBe(26 * 60 * 1000);

        // The offline-gap duration (~749 minutes) must never appear as a persisted run.
        const offlineGapMs = resumeStart - preCloseFirstTimestamp;
        expect(savedDuration).not.toBe(offlineGapMs);
        expect(mocks.savedTeamRuns.some((entry) => entry.run.duration === offlineGapMs)).toBe(false);
    });
});

describe('TLA047-06: live consecutive-run timestamp carry remains correct', () => {
    test('pendingNextRunFirstKeyCount still seeds the next run for uninterrupted live play', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 100, combatStartTime: 0 });
        expect(dungeonTracker.isTracking).toBe(true);

        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));
        const firstCompletionAt = 1000 + 25 * 60 * 1000;
        dungeonTracker.onKeyCountsMessage(firstCompletionAt, keyCountMessage('[Alice - 2]'));
        await flushAsync();

        expect(dungeonTracker.pendingNextRunFirstKeyCount).toBe(firstCompletionAt);
        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.duration).toBe(25 * 60 * 1000);

        // Next dungeon starts immediately (wave 0) - carries the completion timestamp forward.
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 101, combatStartTime: firstCompletionAt });

        expect(dungeonTracker.firstKeyCountTimestamp).toBe(firstCompletionAt);
        expect(dungeonTracker.lastKeyCountTimestamp).toBe(firstCompletionAt);
        expect(dungeonTracker.pendingNextRunFirstKeyCount).toBeNull();

        const secondCompletionAt = firstCompletionAt + 27 * 60 * 1000;
        dungeonTracker.onKeyCountsMessage(secondCompletionAt, keyCountMessage('[Alice - 3]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(2);
        expect(mocks.savedTeamRuns[1].run.duration).toBe(27 * 60 * 1000);
    });
});

describe('TLA047-07: no heuristic duration cap', () => {
    test('a synthetic but internally valid long single-session run is still saved, not rejected for length', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 200, combatStartTime: 0 });

        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));
        const longDuration = 5 * 60 * 60 * 1000; // 5 real hours, same live session, no restore involved
        dungeonTracker.onKeyCountsMessage(1000 + longDuration, keyCountMessage('[Alice - 2]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.duration).toBe(longDuration);
    });
});

describe('TLA047-08: history/chart corruption prevented at source', () => {
    test('a stale-resume that never gets a post-reconnect key-count pair persists no run at all', async () => {
        mocks.savedInProgressRun = {
            battleId: 111,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now() - 1000,
            firstKeyCountTimestamp: 5000,
            lastKeyCountTimestamp: 5000,
            keyCountsMap: { Alice: 5 },
        };

        dungeonTracker.checkForActiveDungeon();
        await dungeonTracker.onNewBattle({ wave: 4, battleId: 222, combatStartTime: Date.now() });

        // Party fails immediately after reconnect - no completion, no key-count pair.
        dungeonTracker.onPartyFailed(Date.now(), {});

        expect(mocks.savedTeamRuns).toHaveLength(0);
        expect(dungeonTrackerStorage.saveTeamRun).not.toHaveBeenCalled();
    });
});

describe('TLA047-09: existing outlier scrub remains non-authoritative', () => {
    test('the offline-gap regression passes correctly even though scrubOutlierRuns() is never invoked', async () => {
        mocks.savedInProgressRun = {
            battleId: 111,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now() - 1000,
            firstKeyCountTimestamp: 5000,
            lastKeyCountTimestamp: 5000,
            keyCountsMap: { Alice: 5 },
        };

        dungeonTracker.checkForActiveDungeon();
        await dungeonTracker.onNewBattle({ wave: 4, battleId: 222, combatStartTime: 10_000 });

        // As scanExistingChatMessages would anchor it in production.
        dungeonTracker.firstKeyCountTimestamp = 10_000;
        dungeonTracker.lastKeyCountTimestamp = 10_000;
        dungeonTracker.onKeyCountsMessage(10_000 + 26 * 60 * 1000, keyCountMessage('[Alice - 6]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.duration).toBe(26 * 60 * 1000);
        expect(dungeonTrackerStorage.scrubOutlierRuns).not.toHaveBeenCalled();
        expect(mocks.scrubCalls).toBe(0);
    });
});

describe('TLA047-10: reset/cleanup invariants stay green', () => {
    test('a party failure resets tracking and clears the saved in-progress run', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 400, combatStartTime: 0 });
        expect(dungeonTracker.isTracking).toBe(true);

        dungeonTracker.onPartyFailed(Date.now(), {});
        await Promise.resolve();

        expect(dungeonTracker.isTracking).toBe(false);
        expect(dungeonTracker.currentRun).toBeNull();
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
        expect(storage.delete).toHaveBeenCalledWith('dungeonTracker_inProgressRun', 'settings');
    });

    test('the completion race guard rejects a restore attempted within 5 seconds of the last completion', async () => {
        dungeonTracker._lastCompletionTime = Date.now();
        mocks.savedInProgressRun = {
            battleId: 500,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            lastUpdateTime: Date.now(),
            firstKeyCountTimestamp: 1000,
            lastKeyCountTimestamp: 1000,
            keyCountsMap: { Alice: 5 },
        };

        const restored = await dungeonTracker.restoreInProgressRun(500);

        expect(restored).toBe(false);
        expect(dungeonTracker.isTracking).toBe(false);
        expect(storage.delete).toHaveBeenCalledWith('dungeonTracker_inProgressRun', 'settings');
    });
});
