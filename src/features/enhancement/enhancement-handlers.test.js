/**
 * TLA-043 handler-level regression: Enhancement Tracker mid-run bootstrap.
 *
 * Direct, deterministic coverage of setupEnhancementHandlers()/handleEnhancementResult()'s
 * session-start branching — captures the real handlers registered against a mocked
 * webSocketHook and invokes them directly with WebSocket-shaped payloads, so ordering
 * (subscribe-then-inspect) and the mid-run bootstrap fallback are provable without a
 * live enhancing queue.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const callOrder = [];
    const capturedHandlers = {};

    const webSocketHook = {
        on: vi.fn((messageType, handler) => {
            callOrder.push(`on:${messageType}`);
            capturedHandlers[messageType] = handler;
        }),
        off: vi.fn((messageType, handler) => {
            callOrder.push(`off:${messageType}`);
            if (capturedHandlers[messageType] === handler) {
                delete capturedHandlers[messageType];
            }
        }),
    };

    let sessionCounter = 0;

    const tracker = {
        isInitialized: true,
        pendingSessionStart: false,
        sessions: {},
        currentSessionId: null,
        setPendingStart() {
            this.pendingSessionStart = true;
        },
        getCurrentSession() {
            return this.currentSessionId ? this.sessions[this.currentSessionId] || null : null;
        },
        async startSession(itemHrid, startLevel, targetLevel, protectFrom) {
            const id = `session_${++sessionCounter}`;
            this.sessions[id] = {
                id,
                itemHrid,
                startLevel,
                targetLevel,
                protectFrom,
                currentLevel: startLevel,
                state: 'tracking',
                totalAttempts: 0,
                totalSuccesses: 0,
                totalFailures: 0,
                totalBlessed: 0,
                lastAttempt: { attemptNumber: 0, level: startLevel, timestamp: 0 },
            };
            this.currentSessionId = id;
            return id;
        },
        async finalizeCurrentSession() {
            const session = this.getCurrentSession();
            if (session) session.state = 'completed';
            this.currentSessionId = null;
        },
        findExtendableSession(itemHrid, currentLevel) {
            for (const session of Object.values(this.sessions)) {
                if (
                    session.itemHrid === itemHrid &&
                    session.state === 'completed' &&
                    Math.abs(session.currentLevel - currentLevel) <= 1
                ) {
                    return session.id;
                }
            }
            return null;
        },
        async extendSessionTarget(sessionId, newTargetLevel) {
            const session = this.sessions[sessionId];
            if (!session || session.state !== 'completed') return false;
            session.state = 'tracking';
            session.targetLevel = newTargetLevel;
            this.currentSessionId = sessionId;
            return true;
        },
        async recordSuccess(previousLevel, newLevel, wasBlessed = false) {
            const session = this.getCurrentSession();
            if (!session) return;
            session.totalAttempts += 1;
            session.totalSuccesses += 1;
            if (wasBlessed) session.totalBlessed += 1;
            session.currentLevel = newLevel;
            if (newLevel >= session.targetLevel) {
                session.state = 'completed';
                this.currentSessionId = null;
            }
        },
        async recordFailure(previousLevel, newLevel) {
            const session = this.getCurrentSession();
            if (!session) return;
            session.totalAttempts += 1;
            session.totalFailures += 1;
            session.currentLevel = newLevel;
        },
        async trackMaterialCost() {},
        async trackCoinCost() {},
        async trackProtectionCost() {},
    };

    const dataManager = {
        getCurrentActions: vi.fn(() => {
            callOrder.push('inspect:getCurrentActions');
            return [];
        }),
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
    };

    const config = { getSetting: vi.fn(() => true) };
    const marketAPI = { getPrice: vi.fn(() => ({ ask: 0, bid: 0 })) };
    const enhancementUI = { switchToSession: vi.fn(), scheduleUpdate: vi.fn() };

    return {
        callOrder,
        capturedHandlers,
        webSocketHook,
        tracker,
        dataManager,
        config,
        marketAPI,
        enhancementUI,
    };
});

vi.mock('../../core/websocket.js', () => ({ default: mocks.webSocketHook }));
vi.mock('../../core/data-manager.js', () => ({ default: mocks.dataManager }));
vi.mock('../../core/config.js', () => ({ default: mocks.config }));
vi.mock('../../api/marketplace.js', () => ({ default: mocks.marketAPI }));
vi.mock('./enhancement-ui.js', () => ({ default: mocks.enhancementUI }));
vi.mock('./enhancement-tracker.js', () => ({ default: mocks.tracker }));
vi.mock('./enhancement-xp.js', () => ({
    calculateSuccessXP: vi.fn(() => 0),
    calculateFailureXP: vi.fn(() => 0),
    calculateAdjustedAttemptCount: vi.fn((session) => (session ? session.totalAttempts + 1 : 1)),
}));

import { setupEnhancementHandlers, cleanupEnhancementHandlers } from './enhancement-handlers.js';

function completedPayload(overrides) {
    return {
        endCharacterAction: {
            actionHrid: '/actions/enhancing/enhance',
            currentCount: 1,
            primaryItemHash: '/items/tome::0',
            enhancingMaxLevel: 5,
            enhancingProtectionMinLevel: 0,
            ...overrides,
        },
    };
}

function activeEnhanceAction(overrides) {
    return {
        actionHrid: '/actions/enhancing/enhance',
        isDone: false,
        currentCount: 2070,
        enhancingMaxLevel: 10,
        enhancingProtectionMinLevel: 0,
        ...overrides,
    };
}

const tracker = mocks.tracker;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    for (const key of Object.keys(mocks.capturedHandlers)) delete mocks.capturedHandlers[key];

    tracker.isInitialized = true;
    tracker.pendingSessionStart = false;
    tracker.sessions = {};
    tracker.currentSessionId = null;

    mocks.dataManager.getCurrentActions.mockImplementation(() => {
        mocks.callOrder.push('inspect:getCurrentActions');
        return [];
    });
    mocks.config.getSetting.mockReturnValue(true);
});

async function invoke(messageType, payload) {
    await mocks.capturedHandlers[messageType](payload);
}

describe('Enhancement Tracker mid-run bootstrap (TLA-043)', () => {
    test('ET-MR01: cached active Enhance action bootstraps without a future actions_updated', async () => {
        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction()];
        });

        setupEnhancementHandlers();

        expect(mocks.callOrder).toEqual([
            'on:action_completed',
            'on:actions_updated',
            'on:*',
            'inspect:getCurrentActions',
        ]);
        expect(tracker.pendingSessionStart).toBe(true);

        await invoke('action_completed', completedPayload({ currentCount: 2071, primaryItemHash: '/items/tome::0' }));

        const session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.itemHrid).toBe('/items/tome');
        expect(session.totalAttempts).toBe(0); // baseline-only first mid-run result
    });

    test('ET-MR02: proven action_completed self-bootstraps with no cached action and no actions_updated', async () => {
        setupEnhancementHandlers();
        expect(tracker.pendingSessionStart).toBe(false);

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 500, enhancingMaxLevel: 12, primaryItemHash: '/items/tome::3' })
        );

        let session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.totalAttempts).toBe(0);

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 501, enhancingMaxLevel: 12, primaryItemHash: '/items/tome::4' })
        );

        session = tracker.getCurrentSession();
        expect(session.totalAttempts).toBe(1);
        expect(session.totalSuccesses).toBe(1);
    });

    test('ET-MR03: natural currentCount===1 records the first attempt normally, not baseline-only', async () => {
        setupEnhancementHandlers();

        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));

        const session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.totalAttempts).toBe(1);
    });

    test('ET-MR04: unrelated action_completed never creates an Enhancement Tracker session', async () => {
        setupEnhancementHandlers();

        await invoke('action_completed', {
            endCharacterAction: { actionHrid: '/actions/tailoring/umbral_tunic', currentCount: 99 },
        });

        expect(tracker.getCurrentSession()).toBeNull();
    });

    test('ET-MR05: target change finalizes the old session; next mid-run completion starts a safe replacement', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));
        expect(tracker.getCurrentSession()).toBeTruthy();

        await invoke('actions_updated', {
            endCharacterActions: [activeEnhanceAction({ enhancingMaxLevel: 12, enhancingProtectionMinLevel: 0 })],
        });
        expect(tracker.getCurrentSession()).toBeNull();

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 400, enhancingMaxLevel: 12, primaryItemHash: '/items/tome::3' })
        );

        const session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.targetLevel).toBe(12);
        expect(session.totalAttempts).toBe(0);
    });

    test('ET-MR06: protection change finalizes the old session; replacement starts safely', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));
        expect(tracker.getCurrentSession()).toBeTruthy();

        await invoke('actions_updated', {
            endCharacterActions: [activeEnhanceAction({ enhancingMaxLevel: 5, enhancingProtectionMinLevel: 4 })],
        });
        expect(tracker.getCurrentSession()).toBeNull();

        await invoke(
            'action_completed',
            completedPayload({
                currentCount: 400,
                enhancingMaxLevel: 5,
                enhancingProtectionMinLevel: 4,
                primaryItemHash: '/items/tome::3',
            })
        );

        const session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.protectFrom).toBe(4);
        expect(session.totalAttempts).toBe(0);
    });

    test('ET-MR07: disable -> re-enable while the same Enhance queue continues bootstraps the next result', async () => {
        setupEnhancementHandlers();
        cleanupEnhancementHandlers();
        // Simulate the tracker having been disabled/reinitialized with no session — DataManager's
        // cached action state is Core state and survives the feature's own disable/enable cycle.
        tracker.currentSessionId = null;
        tracker.pendingSessionStart = false;

        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction({ currentCount: 1000 })];
        });

        setupEnhancementHandlers();
        expect(tracker.pendingSessionStart).toBe(true);

        await invoke('action_completed', completedPayload({ currentCount: 1001, primaryItemHash: '/items/tome::0' }));

        expect(tracker.getCurrentSession()).toBeTruthy();
    });

    test('ET-MR08: init with characterActions already containing Enhance does not wait for actions_updated', async () => {
        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction()];
        });

        setupEnhancementHandlers();

        await invoke('action_completed', completedPayload({ currentCount: 2071, primaryItemHash: '/items/tome::0' }));

        expect(tracker.getCurrentSession()).toBeTruthy();
    });

    test('ET-MR09: Clear mid-session (pendingSessionStart already set) still bootstraps the next result', async () => {
        setupEnhancementHandlers();
        tracker.pendingSessionStart = true; // simulates enhancementTracker.clearSessions()

        await invoke('action_completed', completedPayload({ currentCount: 250, primaryItemHash: '/items/tome::2' }));

        const session = tracker.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.totalAttempts).toBe(0);
    });

    test('ET-MR10: switching enhanced item finalizes the old session and starts a clean one for the new item', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));
        const firstSessionId = tracker.currentSessionId;

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 1, primaryItemHash: '/items/other_tome::0' })
        );

        expect(tracker.sessions[firstSessionId].state).toBe('completed');
        const newSession = tracker.getCurrentSession();
        expect(newSession.itemHrid).toBe('/items/other_tome');
        expect(newSession.totalAttempts).toBe(0);
    });

    test('ET-MR11: a second attempt on the same item does not create a duplicate session', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));
        const sessionId = tracker.currentSessionId;

        await invoke('action_completed', completedPayload({ currentCount: 2, primaryItemHash: '/items/tome::0' }));

        expect(tracker.currentSessionId).toBe(sessionId);
        expect(Object.keys(tracker.sessions)).toHaveLength(1);
    });

    test('ET-MR12: a compatible completed session is extended instead of duplicated', async () => {
        setupEnhancementHandlers();
        await invoke(
            'action_completed',
            completedPayload({ currentCount: 1, enhancingMaxLevel: 1, primaryItemHash: '/items/tome::0' })
        );
        await invoke(
            'action_completed',
            completedPayload({ currentCount: 2, enhancingMaxLevel: 1, primaryItemHash: '/items/tome::1' })
        );
        const completedSessionId = tracker.currentSessionId ?? Object.keys(tracker.sessions)[0];
        expect(tracker.sessions[completedSessionId].state).toBe('completed');

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 3, enhancingMaxLevel: 5, primaryItemHash: '/items/tome::1' })
        );

        expect(Object.keys(tracker.sessions)).toHaveLength(1);
        expect(tracker.sessions[completedSessionId].state).toBe('tracking');
    });

    test('ET-MR13: a +2 jump is tracked as Blessed', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));

        await invoke(
            'action_completed',
            completedPayload({ currentCount: 2, enhancingMaxLevel: 10, primaryItemHash: '/items/tome::2' })
        );

        const session = tracker.getCurrentSession();
        expect(session.totalBlessed).toBe(1);
    });

    test('ET-MR14: the first observed mid-run result does not invent a prior success/failure', async () => {
        setupEnhancementHandlers();

        await invoke('action_completed', completedPayload({ currentCount: 900, primaryItemHash: '/items/tome::5' }));

        const session = tracker.getCurrentSession();
        expect(session.totalAttempts).toBe(0);
        expect(session.totalSuccesses).toBe(0);
        expect(session.totalFailures).toBe(0);
    });

    test('ET-MR15: the second observed mid-run result is classified normally from the established baseline', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 900, primaryItemHash: '/items/tome::5' }));

        await invoke('action_completed', completedPayload({ currentCount: 901, primaryItemHash: '/items/tome::4' }));

        const session = tracker.getCurrentSession();
        expect(session.totalAttempts).toBe(1);
        expect(session.totalFailures).toBe(1);
    });

    test('ET-MR16: setup during an invalidated (not-yet-initialized) tracker never bootstraps stale state', async () => {
        // Simulates enhancement-feature.js calling setupEnhancementHandlers() in a window where
        // the tracker's async initialize() for a just-switched character has not resolved yet —
        // the generation guard in enhancement-feature.js normally prevents this call outright,
        // but Layer A must independently fail closed too.
        tracker.isInitialized = false;
        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction()];
        });

        setupEnhancementHandlers();

        expect(tracker.pendingSessionStart).toBe(false);
        expect(mocks.dataManager.getCurrentActions).not.toHaveBeenCalled();

        await invoke('action_completed', completedPayload({ currentCount: 2071, primaryItemHash: '/items/tome::0' }));
        expect(tracker.getCurrentSession()).toBeNull();
    });

    test('ET-MR17: disable cleanup removes action_completed/actions_updated/wildcard handlers exactly once', () => {
        setupEnhancementHandlers();
        cleanupEnhancementHandlers();

        expect(mocks.webSocketHook.off).toHaveBeenCalledTimes(3);
        expect(mocks.webSocketHook.off).toHaveBeenCalledWith('action_completed', expect.any(Function));
        expect(mocks.webSocketHook.off).toHaveBeenCalledWith('actions_updated', expect.any(Function));
        expect(mocks.webSocketHook.off).toHaveBeenCalledWith('*', expect.any(Function));
    });

    test('ET-MR18: setting disabled skips bootstrap and ignores enhancement completions', async () => {
        mocks.config.getSetting.mockReturnValue(false);
        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction()];
        });

        setupEnhancementHandlers();

        expect(tracker.pendingSessionStart).toBe(false);
        expect(mocks.dataManager.getCurrentActions).not.toHaveBeenCalled();

        await invoke('action_completed', completedPayload({ currentCount: 500, primaryItemHash: '/items/tome::3' }));

        expect(tracker.getCurrentSession()).toBeNull();
    });

    test('ET-MR19: an already-active valid session is not reset or duplicated by cached-state bootstrap', async () => {
        setupEnhancementHandlers();
        await invoke('action_completed', completedPayload({ currentCount: 1, primaryItemHash: '/items/tome::0' }));
        const sessionId = tracker.currentSessionId;

        mocks.dataManager.getCurrentActions.mockClear();
        mocks.dataManager.getCurrentActions.mockImplementation(() => {
            mocks.callOrder.push('inspect:getCurrentActions');
            return [activeEnhanceAction()];
        });
        cleanupEnhancementHandlers();
        setupEnhancementHandlers();

        expect(mocks.dataManager.getCurrentActions).not.toHaveBeenCalled();
        expect(tracker.pendingSessionStart).toBe(false);
        expect(tracker.currentSessionId).toBe(sessionId);
        expect(Object.keys(tracker.sessions)).toHaveLength(1);
    });

    test('ET-MR20: repeated Enhance completions cannot remain sessionless forever with no actions_updated', async () => {
        setupEnhancementHandlers();

        for (let i = 0; i < 3; i += 1) {
            await invoke(
                'action_completed',
                completedPayload({ currentCount: 700 + i, primaryItemHash: `/items/tome::${i}` })
            );
        }

        expect(tracker.getCurrentSession()).toBeTruthy();
        expect(Object.keys(tracker.sessions)).toHaveLength(1);
    });
});
