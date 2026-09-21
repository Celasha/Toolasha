/**
 * TLA-047 - Dungeon Tracker offline-resume lifecycle regressions.
 *
 * checkForActiveDungeon() (page-load bootstrap) must never make saved in-progress timing state
 * authoritative on its own - it has no live battleId to validate against. Only the guarded
 * restoreInProgressRun(currentBattleId), exercised from onNewBattle() once a real new_battle
 * arrives, may promote saved state to isTracking=true, and only after battle identity, active
 * dungeon match, and 10-minute freshness all pass.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentActions: [],
    actionDetailsByHrid: {},
    savedInProgressRun: null,
    dungeonInfoByHrid: {},
    savedTeamRuns: [],
    scrubCalls: 0,
    socketEventHandlers: {},
}));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        onSocketEvent: vi.fn((eventType, handler) => {
            mocks.socketEventHandlers[eventType] = handler;
        }),
        offSocketEvent: vi.fn((eventType) => {
            delete mocks.socketEventHandlers[eventType];
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentActions: vi.fn(() => mocks.currentActions),
        getActionDetails: vi.fn((hrid) => mocks.actionDetailsByHrid[hrid] || null),
        getCurrentCharacterId: vi.fn(() => 'test-character'),
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
const { default: webSocketHook } = await import('../../core/websocket.js');

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
    mocks.socketEventHandlers = {};

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

describe('Fail/cancel capture: real time cost of unsuccessful attempts is persisted', () => {
    test('a party failure after a real key-count timestamp saves a validated fail record', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 600, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));

        const failTimestamp = 1000 + 3 * 60 * 1000; // 3 minutes after the key-count start anchor
        dungeonTracker.onPartyFailed(failTimestamp, {});
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        const saved = mocks.savedTeamRuns[0].run;
        expect(saved.result).toBe('fail');
        expect(saved.duration).toBe(3 * 60 * 1000);
        expect(saved.validated).toBe(true);
        expect(saved.dungeonName).toBe('Pirate Cove');
    });

    test('a party failure before any key-count message saves an unvalidated fail using the client-clock start', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 601, combatStartTime: 0 });

        const failTimestamp = 90 * 1000; // No key-count/battle-started message received yet
        dungeonTracker.onPartyFailed(failTimestamp, {});
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        const saved = mocks.savedTeamRuns[0].run;
        expect(saved.result).toBe('fail');
        expect(saved.duration).toBe(90 * 1000);
        expect(saved.validated).toBe(false);
    });

    test('a hibernation flag detected mid-run is carried into the persisted fail record', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 607, combatStartTime: 0 });
        dungeonTracker.currentRun.hibernationDetected = true;

        const failTimestamp = 90 * 1000;
        dungeonTracker.onPartyFailed(failTimestamp, {});
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.hibernationDetected).toBe(true);
    });

    test('no hibernation flag defaults to false in the persisted record', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 608, combatStartTime: 0 });

        dungeonTracker.onPartyFailed(90 * 1000, {});
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.hibernationDetected).toBe(false);
    });

    test('resetTracking() still fully clears tracking state after capturing a fail', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 602, combatStartTime: 0 });
        dungeonTracker.onPartyFailed(Date.now(), {});
        await flushAsync();

        expect(dungeonTracker.isTracking).toBe(false);
        expect(dungeonTracker.currentRun).toBeNull();
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
    });

    test('an early exit detected via actions_updated (flee/death) is captured as a fail', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 603, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(2000, keyCountMessage('[Alice - 1]'));

        dungeonTracker.onActionsUpdated({
            endCharacterActions: [{ actionHrid: DUNGEON_HRID, isDone: true, difficultyTier: 0 }],
        });
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBe('fail');
    });

    test('an early exit detected via action_completed (died mid-wave) is captured as a fail', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 604, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(3000, keyCountMessage('[Alice - 1]'));

        dungeonTracker.onActionCompleted({
            endCharacterAction: { actionHrid: DUNGEON_HRID, wave: 3, isDone: true, difficultyTier: 0 },
        });
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBe('fail');
        expect(mocks.savedTeamRuns[0].run.wavesCompleted).toBe(3);
    });

    test('a successful completion is unaffected by the fail-capture change', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 605, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));
        dungeonTracker.onKeyCountsMessage(1000 + 5 * 60 * 1000, keyCountMessage('[Alice - 2]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBeUndefined();
        expect(mocks.savedTeamRuns[0].run.duration).toBe(5 * 60 * 1000);
    });

    test('a dungeon-switch mismatch reset (no failure context) does not save a run', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 606, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));
        dungeonTracker.currentRun.dungeonHrid = '/actions/combat/some_other_dungeon';
        mocks.dungeonInfoByHrid['/actions/combat/some_other_dungeon'] = {
            name: 'Some Different Dungeon',
            maxWaves: 10,
        };

        dungeonTracker.onBattleStarted(Date.now(), {
            systemMetadata: JSON.stringify({ name: 'Some Unrelated Dungeon' }),
        });
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(0);
    });

    test('onChatMessage routes the real partyWaveFailed message type to a fail record', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 610, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));

        dungeonTracker.onChatMessage({
            message: {
                chan: '/chat_channel_types/party',
                isSystemMessage: true,
                t: 1000 + 3 * 60 * 1000,
                m: 'systemChatMessage.partyWaveFailed',
            },
        });
        await flushAsync();

        expect(dungeonTracker.isTracking).toBe(false);
        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBe('fail');
    });

    test('onChatMessage routes partyBattleEnded to a cancel record, not a fail', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 611, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));

        dungeonTracker.onChatMessage({
            message: {
                chan: '/chat_channel_types/party',
                isSystemMessage: true,
                t: 1000 + 90 * 1000,
                m: 'systemChatMessage.partyBattleEnded',
            },
        });
        await flushAsync();

        expect(dungeonTracker.isTracking).toBe(false);
        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBe('cancel');
    });

    test('a cancel caught live via onBattleEnded pre-empts the generic actions_updated fallback', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 612, combatStartTime: 0 });
        dungeonTracker.onKeyCountsMessage(1000, keyCountMessage('[Alice - 1]'));

        dungeonTracker.onBattleEnded(1000 + 45 * 1000, {});
        // The dungeon action's own isDone update arrives after the chat signal already reset
        // tracking - it must find isTracking already false and do nothing.
        dungeonTracker.onActionsUpdated({
            endCharacterActions: [{ actionHrid: DUNGEON_HRID, isDone: true, difficultyTier: 0 }],
        });
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBe('cancel');
    });
});

describe('Fresh-start false-completion guard: wavesCompleted, not startTime truthiness', () => {
    test('a realistic nonzero combatStartTime does not make the first Key counts message look like a completion', async () => {
        // Regression for a real bug: the old guard checked currentRun.startTime truthiness, which
        // is true for every run (restored or fresh) once combatStartTime is a real epoch value -
        // only the test suite's convenience use of combatStartTime: 0 masked it (0 is falsy).
        const realisticStart = new Date('2026-09-10T12:00:00Z').getTime();
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 700, combatStartTime: realisticStart });

        dungeonTracker.onKeyCountsMessage(realisticStart + 5000, keyCountMessage('[Alice - 1]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(0);
        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.firstKeyCountTimestamp).toBe(realisticStart + 5000);
        expect(dungeonTracker.lastKeyCountTimestamp).toBe(realisticStart + 5000);
    });

    test('a restored run that already completed a wave without ever capturing Key counts treats the next message as completion', async () => {
        mocks.savedInProgressRun = {
            battleId: 800,
            dungeonHrid: DUNGEON_HRID,
            tier: 0,
            startTime: 1000,
            currentWave: 3,
            maxWaves: 10,
            wavesCompleted: 2, // a wave completed under our tracking, but no anchor was ever captured
            waveTimes: [1000, 1200],
            waveStartTime: 2000,
            lastUpdateTime: Date.now() - 1000,
            firstKeyCountTimestamp: null,
            lastKeyCountTimestamp: null,
            keyCountsMap: {},
            keyCountMessages: [],
        };

        dungeonTracker.checkForActiveDungeon();
        await dungeonTracker.onNewBattle({ wave: 3, battleId: 800, combatStartTime: Date.now() });

        expect(dungeonTracker.isTracking).toBe(true);
        expect(dungeonTracker.firstKeyCountTimestamp).toBeNull();
        expect(dungeonTracker.currentRun.wavesCompleted).toBe(2);

        dungeonTracker.onKeyCountsMessage(Date.now() + 5000, keyCountMessage('[Alice - 9]'));
        await flushAsync();

        expect(mocks.savedTeamRuns).toHaveLength(1);
        expect(mocks.savedTeamRuns[0].run.result).toBeUndefined(); // successful completion, not a fail
    });
});

describe('buildTimestampFromParts: year-rollover for DOM-reconstructed chat timestamps', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test('a message from December is attributed to the previous year when parsed in January', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2027, 0, 5, 12, 0, 0)); // "now" = Jan 5, 2027

        const timestamp = dungeonTracker.buildTimestampFromParts(12, 20, 18, 30, 0); // Dec 20, no year in source

        expect(timestamp.getFullYear()).toBe(2026);
        expect(timestamp.getMonth()).toBe(11); // December
        expect(timestamp.getDate()).toBe(20);
    });

    test('an ordinary same-year message is not shifted', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // "now" = June 15, 2026

        const timestamp = dungeonTracker.buildTimestampFromParts(6, 10, 9, 0, 0); // June 10, same year

        expect(timestamp.getFullYear()).toBe(2026);
        expect(timestamp.getMonth()).toBe(5);
        expect(timestamp.getDate()).toBe(10);
    });

    test('a timestamp exactly equal to now is not shifted to the previous year', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));

        const timestamp = dungeonTracker.buildTimestampFromParts(6, 15, 12, 0, 0);

        expect(timestamp.getFullYear()).toBe(2026);
    });
});

describe('Wave-number monotonicity guard', () => {
    test('startWave ignores a wave number that goes backward', async () => {
        await dungeonTracker.onNewBattle({ wave: 3, battleId: 900, combatStartTime: 1000 });
        dungeonTracker.startWave({ wave: 5, combatStartTime: 2000 });
        expect(dungeonTracker.currentRun.currentWave).toBe(5);

        // A stale/reordered wave arriving after wave 5 must not roll currentWave back.
        dungeonTracker.startWave({ wave: 4, combatStartTime: 3000 });
        expect(dungeonTracker.currentRun.currentWave).toBe(5);
        expect(dungeonTracker.waveStartTime.getTime()).toBe(2000);
    });

    test('startWave still accepts a repeat of the same wave number', async () => {
        await dungeonTracker.onNewBattle({ wave: 3, battleId: 902, combatStartTime: 1000 });
        dungeonTracker.startWave({ wave: 3, combatStartTime: 2000 });

        expect(dungeonTracker.currentRun.currentWave).toBe(3);
        expect(dungeonTracker.waveStartTime.getTime()).toBe(2000);
    });

    test('onActionCompleted ignores a completed-wave number that goes backward', async () => {
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 901, combatStartTime: 0 });

        dungeonTracker.onActionCompleted({
            endCharacterAction: { actionHrid: DUNGEON_HRID, wave: 5, isDone: false, difficultyTier: 0 },
        });
        expect(dungeonTracker.currentRun.wavesCompleted).toBe(5);
        expect(dungeonTracker.waveTimes).toHaveLength(1);

        dungeonTracker.onActionCompleted({
            endCharacterAction: { actionHrid: DUNGEON_HRID, wave: 3, isDone: false, difficultyTier: 0 },
        });
        expect(dungeonTracker.currentRun.wavesCompleted).toBe(5); // unchanged
        expect(dungeonTracker.waveTimes).toHaveLength(1); // no spurious sample added
    });
});

describe('Heartbeat watchdog: detects a stall visibilitychange might miss', () => {
    beforeEach(() => {
        // initialize()/cleanup() touch document.addEventListener/removeEventListener for the
        // visibilitychange listener - this suite runs under vitest's 'node' environment (no real
        // DOM), so stub the minimum surface needed rather than pulling in jsdom for one describe.
        globalThis.document = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn(() => []),
        };
    });

    afterEach(async () => {
        await dungeonTracker.cleanup();
        vi.useRealTimers();
        delete globalThis.document;
    });

    test('a large gap between heartbeat ticks flags hibernationDetected mid-run', async () => {
        const start = new Date(2026, 0, 1, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(start);

        await dungeonTracker.initialize();
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 950, combatStartTime: start.getTime() });
        expect(dungeonTracker.hibernationDetected).toBe(false);

        // Jump the clock forward to simulate a long OS-sleep stall, then let the already-
        // scheduled heartbeat tick fire and observe the huge elapsed gap.
        vi.setSystemTime(new Date(start.getTime() + 90000));
        await vi.advanceTimersByTimeAsync(15000);

        expect(dungeonTracker.hibernationDetected).toBe(true);
        expect(dungeonTracker.currentRun.hibernationDetected).toBe(true);
    });

    test('normal on-schedule ticks with no real stall do not flag hibernation', async () => {
        const start = new Date(2026, 0, 1, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(start);

        await dungeonTracker.initialize();
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 951, combatStartTime: start.getTime() });

        // Advance through several on-schedule heartbeat ticks - no stall, clock and timers move
        // together exactly as they would during ordinary uninterrupted play.
        await vi.advanceTimersByTimeAsync(15000 * 3);

        expect(dungeonTracker.hibernationDetected).toBe(false);
    });
});

describe('WS disconnect flagging', () => {
    beforeEach(() => {
        globalThis.document = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn(() => []),
        };
    });

    afterEach(async () => {
        await dungeonTracker.cleanup();
        delete globalThis.document;
    });

    test('a socket close mid-run flags hibernationDetected, same as a hibernation/stall', async () => {
        await dungeonTracker.initialize();
        await dungeonTracker.onNewBattle({ wave: 0, battleId: 960, combatStartTime: Date.now() });
        expect(dungeonTracker.hibernationDetected).toBe(false);

        mocks.socketEventHandlers.close();

        expect(dungeonTracker.hibernationDetected).toBe(true);
        expect(dungeonTracker.currentRun.hibernationDetected).toBe(true);
    });

    test('a socket close while not tracking is a no-op', async () => {
        await dungeonTracker.initialize();
        expect(dungeonTracker.isTracking).toBe(false);

        mocks.socketEventHandlers.close();

        expect(dungeonTracker.hibernationDetected).toBe(false);
    });

    test('cleanup() unregisters the socket close handler', async () => {
        await dungeonTracker.initialize();
        await dungeonTracker.cleanup();

        expect(webSocketHook.offSocketEvent).toHaveBeenCalledWith('close', expect.any(Function));
    });
});
