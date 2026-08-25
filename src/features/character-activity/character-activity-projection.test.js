import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentActions: [],
    actionDetailsByHrid: {},
    inventory: [],
    timingByActionId: {},
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentActions: vi.fn(() => mocks.currentActions),
        getActionDetails: vi.fn((hrid) => mocks.actionDetailsByHrid[hrid] || null),
        getInventory: vi.fn(() => mocks.inventory),
    },
}));

vi.mock('../actions/action-time-display.js', () => ({
    default: {
        buildInventoryLookup: vi.fn((inventory) => ({ inventory })),
        calculateSingleQueueActionTime: vi.fn((actionObj) => mocks.timingByActionId[actionObj.id]),
    },
}));

const { computeLiveProjection, resolveDisplayProjection } = await import('./character-activity-projection.js');

function action(overrides = {}) {
    return {
        id: 'a1',
        actionHrid: '/actions/woodcutting/redwood',
        maxCount: 10,
        currentCount: 0,
        hasMaxCount: true,
        ...overrides,
    };
}

function actionDetails(overrides = {}) {
    return { name: 'Redwood Tree', type: '/action_types/woodcutting', ...overrides };
}

function timing(overrides = {}) {
    return {
        totalTime: 100,
        isTrulyInfinite: false,
        limitType: null,
        ...overrides,
    };
}

beforeEach(() => {
    mocks.currentActions = [];
    mocks.actionDetailsByHrid = {};
    mocks.inventory = [];
    mocks.timingByActionId = {};
});

describe('computeLiveProjection - limiter selection', () => {
    test('one finite action, no queue -> action ends', () => {
        mocks.currentActions = [action()];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });

        const now = 1000;
        const result = computeLiveProjection(now);

        expect(result.terminalCause).toBe('action');
        expect(result.terminalAt).toBe(now + 100_000);
        expect(result.segments).toHaveLength(1);
        expect(result.certainty).toBe('trustworthy');
    });

    test('one action, material exhaustion first -> materials', () => {
        mocks.currentActions = [action()];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 50, limitType: 'material:/items/log' });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('materials');
        expect(result.terminalAt).toBe(1000 + 50_000);
    });

    test('current + several finite queue entries -> queue ends at cumulative terminal time', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2' }), action({ id: 'a3' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 200 });
        mocks.timingByActionId.a3 = timing({ totalTime: 300 });

        const now = 1000;
        const result = computeLiveProjection(now);

        expect(result.terminalCause).toBe('queue');
        expect(result.terminalAt).toBe(now + 600_000);
        expect(result.segments).toHaveLength(3);
        expect(result.segments[0].startAt).toBe(now);
        expect(result.segments[0].endAt).toBe(now + 100_000);
        expect(result.segments[1].startAt).toBe(now + 100_000);
        expect(result.segments[1].endAt).toBe(now + 300_000);
        expect(result.segments[2].endAt).toBe(now + 600_000);
    });

    test('finite actions leading into a truly continuous action -> infinite (offline cap resolved later)', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', hasMaxCount: false })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ isTrulyInfinite: true, totalTime: Infinity });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('infinite');
        expect(result.terminalAt).toBeNull();
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].endAt).toBeNull();
    });

    test('material limit that automatically advances to a viable next queue entry is not a terminal limiter', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        // a1 is material-limited but a2 (a different, unaffected action) follows automatically.
        mocks.timingByActionId.a1 = timing({ totalTime: 50, limitType: 'material:/items/log' });
        mocks.timingByActionId.a2 = timing({ totalTime: 100, limitType: null });

        const result = computeLiveProjection(1000);

        // The terminal cause reflects the LAST segment's own limiter, not the intermediate one.
        expect(result.terminalCause).toBe('queue');
        expect(result.segments).toHaveLength(2);
    });

    test('uncertain Combat action stops the trustworthy chain -> unknown, even with more queued after it', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/combat/aqua_planet' }), action({ id: 'a2' })];
        mocks.actionDetailsByHrid['/actions/combat/aqua_planet'] = actionDetails({
            name: 'Aqua Planet',
            type: '/action_types/combat',
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.certainty).toBe('uncertain');
        expect(result.segments).toHaveLength(1);
    });

    test('uncertain Labyrinth action type stops the trustworthy chain', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/labyrinth/explore' })];
        mocks.actionDetailsByHrid['/actions/labyrinth/explore'] = actionDetails({
            name: 'Explore Labyrinth',
            type: '/action_types/labyrinth',
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.certainty).toBe('uncertain');
    });

    test('stochastic Enhancing action type stops the trustworthy chain', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/enhancing/sword' })];
        mocks.actionDetailsByHrid['/actions/enhancing/sword'] = actionDetails({
            name: 'Enhance Sword',
            type: '/action_types/enhancing',
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.certainty).toBe('uncertain');
    });

    test('idle - no current actions', () => {
        mocks.currentActions = [];

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('idle');
        expect(result.terminalAt).toBe(1000);
        expect(result.segments).toHaveLength(0);
    });

    test('missing action details fails closed to unknown rather than crashing', () => {
        mocks.currentActions = [action({ actionHrid: '/actions/unknown/thing' })];

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.certainty).toBe('uncertain');
    });
});

describe('resolveDisplayProjection - offline cap overlay', () => {
    function storedRecord(overrides = {}) {
        return {
            offline: { hourCap: 10, mooPassExpireTime: null },
            projection: {
                segments: [
                    {
                        actionHrid: '/actions/woodcutting/redwood',
                        actionName: 'Redwood Tree',
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'trustworthy',
                        stopCause: 'infinite',
                    },
                ],
                terminalCause: 'infinite',
                terminalAt: null,
            },
            ...overrides,
        };
    }

    test('infinite chain + known offline cap + known lastOfflineTime -> resolves to offline at lastOfflineTime + cap', () => {
        const lastOfflineTime = 5000;
        const result = resolveDisplayProjection(storedRecord(), lastOfflineTime);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(lastOfflineTime + 10 * 3600 * 1000);
    });

    test('infinite chain + no offline cap known -> unknown, not a fake reassurance', () => {
        const result = resolveDisplayProjection(
            storedRecord({ offline: { hourCap: null, mooPassExpireTime: null } }),
            5000
        );

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('infinite chain + no native lastOfflineTime yet -> unknown', () => {
        const result = resolveDisplayProjection(storedRecord(), null);

        expect(result.terminalCause).toBe('unknown');
    });

    test('finite chain whose own terminalAt is earlier than the offline cap keeps its own cause', () => {
        const stored = storedRecord({
            projection: {
                segments: [{ endAt: 6000 }],
                terminalCause: 'action',
                terminalAt: 6000,
            },
        });

        const result = resolveDisplayProjection(stored, 1000); // offline limit = 1000 + 36,000,000 (way later)

        expect(result.terminalCause).toBe('action');
        expect(result.terminalAt).toBe(6000);
    });

    test('finite chain whose offline cap arrives earlier than its own natural end overrides to offline', () => {
        const stored = storedRecord({
            offline: { hourCap: 1, mooPassExpireTime: null }, // 1 hour cap
            projection: {
                segments: [{ endAt: 100_000_000 }],
                terminalCause: 'queue',
                terminalAt: 100_000_000, // far in the future
            },
        });

        const lastOfflineTime = 0;
        const result = resolveDisplayProjection(stored, lastOfflineTime);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(1 * 3600 * 1000);
    });

    test('already-uncertain terminal cause is never overridden by the offline cap', () => {
        const stored = storedRecord({
            projection: { segments: [{ endAt: null }], terminalCause: 'unknown', terminalAt: null },
        });

        const result = resolveDisplayProjection(stored, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('idle terminal cause is never overridden by the offline cap', () => {
        const stored = storedRecord({
            projection: { segments: [], terminalCause: 'idle', terminalAt: 500 },
        });

        const result = resolveDisplayProjection(stored, 5000);

        expect(result.terminalCause).toBe('idle');
        expect(result.terminalAt).toBe(500);
    });

    test('MooPass expiring before the offline deadline fails closed to unknown rather than asserting the extended cap', () => {
        const stored = storedRecord({
            offline: { hourCap: 10, mooPassExpireTime: 6000 }, // MooPass expires well before lastOfflineTime + 10h
        });

        const result = resolveDisplayProjection(stored, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('MooPass expiring after the offline deadline does not block the normal offline resolution', () => {
        const lastOfflineTime = 5000;
        const offlineLimitAt = lastOfflineTime + 10 * 3600 * 1000;
        const stored = storedRecord({
            offline: { hourCap: 10, mooPassExpireTime: offlineLimitAt + 1000 }, // expires after the cap would hit
        });

        const result = resolveDisplayProjection(stored, lastOfflineTime);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(offlineLimitAt);
    });
});
