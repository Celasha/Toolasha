import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentActions: [],
    actionDetailsByHrid: {},
    inventory: [],
    timingByActionId: {},
    drinkRemainingSecondsByType: {},
    usableSnapshotsById: {},
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentActions: vi.fn(() => mocks.currentActions),
        getActionDetails: vi.fn((hrid) => mocks.actionDetailsByHrid[hrid] || null),
        getInventory: vi.fn(() => mocks.inventory),
        getItemDetails: vi.fn(() => null),
    },
}));

vi.mock('../actions/action-time-display.js', () => ({
    default: {
        buildInventoryLookup: vi.fn((inventory) => ({ inventory })),
        calculateSingleQueueActionTime: vi.fn((actionObj) => mocks.timingByActionId[actionObj.id]),
        parseItemHash: vi.fn((hash) => {
            const parts = String(hash).split('::');
            const itemHrid = parts.find((part) => part.startsWith('/items/')) || null;
            const last = parts[parts.length - 1];
            const level = last && !last.startsWith('/') ? parseInt(last, 10) || 0 : 0;
            return { itemHrid, level };
        }),
    },
}));

vi.mock('../../utils/action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [] })),
    resolveCurrentActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [] })),
}));

vi.mock('../../utils/drink-calculator.js', () => ({
    calculateDrinkRemainingSeconds: vi.fn((actionTypeHrid) => mocks.drinkRemainingSecondsByType[actionTypeHrid] || []),
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotById: vi.fn((id) => mocks.usableSnapshotsById[String(id)] || null),
    },
}));

const { computeLiveProjection, resolveDisplayProjection } = await import('./character-activity-projection.js');
const { default: actionTimeDisplay } = await import('../actions/action-time-display.js');
const { resolveCurrentActionContext } = await import('../../utils/action-context.js');
const { default: dataManager } = await import('../../core/data-manager.js');

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
    const totalTime = overrides.totalTime ?? 100;
    return {
        totalTime,
        actionTimeSeconds: totalTime,
        isTrulyInfinite: false,
        limitType: null,
        count: 1,
        baseActionsNeeded: 1,
        materialLimit: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentActions = [];
    mocks.actionDetailsByHrid = {};
    mocks.inventory = [];
    mocks.timingByActionId = {};
    mocks.drinkRemainingSecondsByType = {};
    mocks.usableSnapshotsById = {};
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
        expect(result.segments[0].stopCause).toBe('combat');
        // The real native queue has 2 entries; projection stops at index 0, but the true remaining
        // count (1) must still be recoverable from this segment, not derived from segments.length.
        expect(result.segments[0].remainingQueuedCount).toBe(1);
    });

    test('CA-25: a later queued segment with invalid timing stops the chain as unknown while the earlier trustworthy running segment is retained', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: NaN });

        const now = 1000;
        const result = computeLiveProjection(now);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.segments).toHaveLength(2);
        // The already-running first segment is untouched - still trustworthy, with its own real
        // start/end - so a display layer showing "what's running right now" can still use it.
        expect(result.segments[0].certainty).toBe('trustworthy');
        expect(result.segments[0].startAt).toBe(now);
        expect(result.segments[0].endAt).toBe(now + 100_000);
        expect(result.segments[1].certainty).toBe('uncertain');
        expect(result.segments[1].stopCause).toBe('timing-unavailable');
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
        expect(result.segments[0].stopCause).toBe('labyrinth');
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
        expect(result.segments[0].stopCause).toBe('enhancing');
    });

    test('Special (Party Ready) is treated as uncertain, never fed into deterministic timing math', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/special/party_ready' })];
        mocks.actionDetailsByHrid['/actions/special/party_ready'] = actionDetails({
            name: 'Party Ready',
            type: '/action_types/special',
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.certainty).toBe('uncertain');
        expect(result.segments[0].stopCause).toBe('special');
        expect(actionTimeDisplay.calculateSingleQueueActionTime).not.toHaveBeenCalled();
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

describe('computeLiveProjection - live context for the front action, predictive default for later ones', () => {
    test('the front (currently running) segment uses resolveCurrentActionContext, not the predictive default', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        const liveContext = { equipment: new Map([['tool', {}]]), drinks: [] };
        resolveCurrentActionContext.mockReturnValue(liveContext);

        computeLiveProjection(1000);

        expect(resolveCurrentActionContext).toHaveBeenCalledWith('/action_types/woodcutting');
        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a1' }),
            expect.anything(),
            expect.anything(),
            liveContext
        );
    });

    test('queued (i>0) segments with no explicit characterLoadoutID keep the predictive default', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });

        computeLiveProjection(1000);

        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'a2' }),
            expect.anything(),
            expect.anything(),
            undefined
        );
    });

    test('TLA-025 DEV4 fix: native characterLoadoutID (capital ID) is the field actually consumed, not a lowercase alias', () => {
        // Deliberately no `characterLoadoutId` anywhere in this fixture - only the real native
        // spelling - so the earlier casing bug (checking `.characterLoadoutId`) cannot pass again.
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 7 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });
        const equipmentEntry = { itemLocationHrid: '/item_locations/tool', itemHrid: '/items/rainbow_hatchet' };
        mocks.usableSnapshotsById['7'] = {
            equipment: [equipmentEntry],
            drinks: [{ itemHrid: '/items/tea' }],
            drinksApplicable: true,
        };

        computeLiveProjection(1000);

        const call = actionTimeDisplay.calculateSingleQueueActionTime.mock.calls[1];
        expect(call[3].equipment.get('/item_locations/tool')).toBe(equipmentEntry);
        expect(call[3].drinks).toEqual([{ itemHrid: '/items/tea' }]);
    });

    test('CA-02: characterLoadoutID === null means no explicit native loadout - no lookup is attempted', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: null })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });

        computeLiveProjection(1000);

        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'a2' }),
            expect.anything(),
            expect.anything(),
            undefined
        );
    });

    test("CA-04: characterLoadoutID === '0' (string) means no explicit native loadout - no lookup is attempted", () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: '0' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });

        computeLiveProjection(1000);

        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'a2' }),
            expect.anything(),
            expect.anything(),
            undefined
        );
    });

    test('CA-06: an equivalent string-numeric characterLoadoutID resolves to the same exact snapshot as the numeric form', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: '7' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });
        const equipmentEntry = { itemLocationHrid: '/item_locations/tool', itemHrid: '/items/rainbow_hatchet' };
        mocks.usableSnapshotsById['7'] = { equipment: [equipmentEntry], drinks: [], drinksApplicable: true };

        computeLiveProjection(1000);

        const call = actionTimeDisplay.calculateSingleQueueActionTime.mock.calls[1];
        expect(call[3].equipment.get('/item_locations/tool')).toBe(equipmentEntry);
    });

    test('CA-09: a valid explicit queued loadout with intentionally empty equipment stays empty, never falls through to current equipment', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 7 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });
        mocks.usableSnapshotsById['7'] = { equipment: [], drinks: [], drinksApplicable: true };

        computeLiveProjection(1000);

        const call = actionTimeDisplay.calculateSingleQueueActionTime.mock.calls[1];
        expect(call[3].equipment.size).toBe(0);
        // resolveCurrentActionContext is called once for the front (i===0) action's live context;
        // the explicit-loadout queued segment (drinksApplicable === true) must not call it again
        // and must not fall through to current equipment.
        expect(resolveCurrentActionContext).toHaveBeenCalledTimes(1);
    });

    test('CA-10: an action-specific explicit queued loadout (drinksApplicable === true) uses its own resolved saved drinks', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 7 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });
        mocks.usableSnapshotsById['7'] = {
            equipment: [],
            drinks: [{ itemHrid: '/items/tea' }],
            drinksApplicable: true,
        };
        resolveCurrentActionContext.mockReturnValue({ equipment: new Map(), drinks: [{ itemHrid: '/items/wrong' }] });

        computeLiveProjection(1000);

        const call = actionTimeDisplay.calculateSingleQueueActionTime.mock.calls[1];
        expect(call[3].drinks).toEqual([{ itemHrid: '/items/tea' }]);
    });

    test('CA-11: an All Skills explicit queued loadout (drinksApplicable === false) uses current action drinks, not its always-blank saved drinks', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 7 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });
        const equipmentEntry = { itemLocationHrid: '/item_locations/tool', itemHrid: '/items/rainbow_hatchet' };
        // All Skills loadouts structurally never carry real drinks - drinks is always blank.
        mocks.usableSnapshotsById['7'] = { equipment: [equipmentEntry], drinks: [], drinksApplicable: false };
        const currentDrinks = [{ itemHrid: '/items/current_tea' }];
        resolveCurrentActionContext.mockReturnValue({ equipment: new Map(), drinks: currentDrinks });

        computeLiveProjection(1000);

        expect(resolveCurrentActionContext).toHaveBeenCalledWith('/action_types/woodcutting');
        const call = actionTimeDisplay.calculateSingleQueueActionTime.mock.calls[1];
        expect(call[3].equipment.get('/item_locations/tool')).toBe(equipmentEntry);
        expect(call[3].drinks).toBe(currentDrinks);
    });

    test('TLA-025 DEV4 fix: an explicit characterLoadoutID that cannot be resolved fails closed rather than falling back to a Toolasha default', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 99 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        // No entry in usableSnapshotsById for id 99 - deleted/unusable/missing equipment.

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('uncertain');
        expect(result.segments[1].stopCause).toBe('loadout-unavailable');
        expect(result.terminalCause).toBe('unknown');
        // The unresolvable loadout must stop the chain before ever computing a duration for it.
        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenCalledTimes(1);
    });

    test('TLA-025 DEV4 fix: characterLoadoutID === 0 means no explicit native loadout - no lookup is attempted', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: 0 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({ totalTime: 100 });

        computeLiveProjection(1000);

        // Falls through to the predictive-default path (no explicit context passed), never a
        // loadout lookup or a fail-closed segment.
        expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'a2' }),
            expect.anything(),
            expect.anything(),
            undefined
        );
    });

    test.each([[-1], [1.5], ['not-a-number']])(
        'TLA-025 DEV4 fix: a malformed non-zero characterLoadoutID (%p) fails closed, never falls back to a predictive default',
        (malformedId) => {
            mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', characterLoadoutID: malformedId })];
            mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
            mocks.timingByActionId.a1 = timing({ totalTime: 100 });

            const result = computeLiveProjection(1000);

            expect(result.segments).toHaveLength(2);
            expect(result.segments[1].stopCause).toBe('loadout-unavailable');
            expect(actionTimeDisplay.calculateSingleQueueActionTime).toHaveBeenCalledTimes(1);
        }
    );
});

describe('computeLiveProjection - fail-closed on calculation failure (does not become a fake zero-duration terminal)', () => {
    test('timingUnavailable is treated as uncertain, never a zero-time deterministic terminal', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = { timingUnavailable: true, totalTime: 0, isTrulyInfinite: false, limitType: null };

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.certainty).toBe('uncertain');
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
        expect(result.segments[0].endAt).toBeNull();
    });

    test('TLA-025 DEV4 fix: NaN totalTime fails closed, never becomes a NaN terminalAt', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: NaN });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
        expect(Number.isNaN(result.terminalAt)).toBe(false);
    });

    test('TLA-025 DEV4 fix: NaN actionTimeSeconds fails closed', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ actionTimeSeconds: NaN });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
    });

    test('TLA-025 DEV4 fix: a negative totalTime fails closed', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: -50, actionTimeSeconds: -50 });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
    });

    test('TLA-025 DEV4 fix: totalTime: Infinity without isTrulyInfinite fails closed rather than being accepted', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({
            totalTime: Infinity,
            actionTimeSeconds: Infinity,
            isTrulyInfinite: false,
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
    });

    test('TLA-025 DEV4 fix: isTrulyInfinite + totalTime Infinity is accepted as a genuine unbounded action', () => {
        mocks.currentActions = [action({ id: 'a1', hasMaxCount: false })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('infinite');
        expect(result.segments[0].stopCause).toBe('infinite');
    });

    test('TLA-025 DEV4 fix: a finite queued row with remaining work but count:0/no limiter fails closed (contradictory helper output)', () => {
        mocks.currentActions = [action({ id: 'a1', maxCount: 10, currentCount: 0 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ count: 0, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.segments[0].stopCause).toBe('timing-unavailable');
    });

    test('TLA-025 DEV4 fix: a zero-resource boundary (count:0, totalTime:0, an explicit limitType) remains a valid immediate deterministic terminal', () => {
        mocks.currentActions = [action({ id: 'a1', maxCount: 10, currentCount: 0 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({
            count: 0,
            baseActionsNeeded: 0,
            totalTime: 0,
            actionTimeSeconds: 0,
            limitType: 'material:/items/log',
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('materials');
        expect(result.segments[0].endAt).toBe(1000);
    });

    test('TLA-025 DEV4 fix: an already-complete finite row (maxCount === currentCount) with zero work is distinguishable from calculation failure', () => {
        mocks.currentActions = [action({ id: 'a1', maxCount: 10, currentCount: 10 })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({
            count: 0,
            baseActionsNeeded: 0,
            totalTime: 0,
            actionTimeSeconds: 0,
            limitType: null,
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('action');
        expect(result.segments[0].stopCause).toBe('count');
        expect(result.segments[0].endAt).toBe(1000);
    });
});

describe('computeLiveProjection - resource limiter identity (TLA-025 item 9)', () => {
    test('gold-limited action reports coins, not a generic count terminal', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 50, limitType: 'gold' });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].stopCause).toBe('coins');
        expect(result.terminalCause).toBe('coins');
    });

    test('upgrade-item-limited action reports upgrade-materials, not a generic count terminal', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 50, limitType: 'upgrade:/items/gizmo' });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].stopCause).toBe('upgrade-materials');
        expect(result.terminalCause).toBe('upgrade-materials');
    });

    test('no limiter at all still reports the plain count cause', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 50, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].stopCause).toBe('count');
        expect(result.terminalCause).toBe('action');
    });
});

describe('computeLiveProjection - sequential inventory dependency across segments (TLA-025 item 11)', () => {
    test('a later materials-limited segment depending on an earlier segment’s output is no longer trustworthy', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/woodcutting/log' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/woodcutting/log'] = actionDetails({
            outputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/log' });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('uncertain');
        expect(result.segments[1].stopCause).toBe('inventory-dependency');
        expect(result.terminalCause).toBe('unknown');
    });

    test('a later materials-limited segment on a non-overlapping item stays trustworthy', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/woodcutting/log' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/woodcutting/log'] = actionDetails({
            outputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/iron' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/iron' });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.terminalCause).toBe('materials');
    });

    test('TLA-025 rejection fix: a later segment depending on a shared item is flagged even when its OWN calculated stopCause is count (not resource-based)', () => {
        // Against the stale starting inventory, B's own material check may resolve to a plain
        // count limit (e.g. plentiful stock at snapshot time) even though B genuinely consumes
        // the same item A produces - the dependency must not be gated behind B's own stopCause.
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/woodcutting/log' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/woodcutting/log'] = actionDetails({
            outputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: null }); // stale-snapshot count-limited

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('uncertain');
        expect(result.segments[1].stopCause).toBe('inventory-dependency');
        expect(result.terminalCause).toBe('unknown');
    });

    test('a later segment with no item overlap at all stays trustworthy regardless of its own stopCause', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/woodcutting/log' }),
            action({ id: 'a2', actionHrid: '/actions/foraging/berry' }),
        ];
        mocks.actionDetailsByHrid['/actions/woodcutting/log'] = actionDetails({
            outputItems: [{ itemHrid: '/items/log' }],
        });
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails(); // no inputItems/upgradeItem/coinCost at all
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.terminalCause).toBe('queue');
    });
});

describe('computeLiveProjection - timed-context (drink/tea) trust boundary (TLA-025 item 12)', () => {
    test('a drink running out mid-segment truncates the trustworthy window instead of assuming it holds constant', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 7200 }); // 2h segment
        mocks.drinkRemainingSecondsByType['/action_types/woodcutting'] = [
            { itemHrid: '/items/gathering_tea', totalSeconds: 1800 }, // 30 min remaining
        ];

        const now = 1000;
        const result = computeLiveProjection(now);

        expect(result.terminalCause).toBe('drink');
        expect(result.terminalAt).toBe(now + 1_800_000);
        expect(result.segments[0].stopCause).toBe('drink');
        expect(result.segments[0].endAt).toBe(now + 1_800_000);
    });

    test('a drink outlasting the segment does not truncate anything', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.drinkRemainingSecondsByType['/action_types/woodcutting'] = [
            { itemHrid: '/items/gathering_tea', totalSeconds: 999_999 },
        ];

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('action');
        expect(result.segments[0].stopCause).toBe('count');
    });

    test('an infinite action under a finite drink is bounded by the drink cutoff, not left unknowable forever', () => {
        mocks.currentActions = [action({ id: 'a1', hasMaxCount: false })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ isTrulyInfinite: true, totalTime: Infinity });
        mocks.drinkRemainingSecondsByType['/action_types/woodcutting'] = [
            { itemHrid: '/items/gathering_tea', totalSeconds: 3600 },
        ];

        const now = 1000;
        const result = computeLiveProjection(now);

        expect(result.terminalCause).toBe('drink');
        expect(result.terminalAt).toBe(now + 3_600_000);
        expect(result.segments[0].endAt).toBe(now + 3_600_000);
    });
});

describe('computeLiveProjection - display name enrichment (TLA-025 item 4)', () => {
    test('ordinary actions are unchanged - displayName equals the raw action name', () => {
        mocks.currentActions = [action({ id: 'a1' })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].displayName).toBe('Redwood Tree');
    });

    test('Alchemy actions include the item name: "<action>: <item>"', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/alchemy/coinify', primaryItemHash: '/items/dragon_fruit::0' }),
        ];
        mocks.actionDetailsByHrid['/actions/alchemy/coinify'] = actionDetails({
            name: 'Coinify',
            type: '/action_types/alchemy',
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 50 });
        dataManager.getItemDetails.mockReturnValue({ name: 'Dragon Fruit' });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].displayName).toBe('Coinify: Dragon Fruit');
    });

    test('Combat actions with a difficulty tier append " (Tn)"', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/combat/aqua_planet', difficultyTier: 2 })];
        mocks.actionDetailsByHrid['/actions/combat/aqua_planet'] = actionDetails({
            name: 'Aqua Planet',
            type: '/action_types/combat',
        });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].displayName).toBe('Aqua Planet (T2)');
    });

    test('Combat actions with a partyID append a party marker', () => {
        mocks.currentActions = [action({ id: 'a1', actionHrid: '/actions/combat/aqua_planet', partyID: 'p1' })];
        mocks.actionDetailsByHrid['/actions/combat/aqua_planet'] = actionDetails({
            name: 'Aqua Planet',
            type: '/action_types/combat',
        });

        const result = computeLiveProjection(1000);

        expect(result.segments[0].displayName).toContain('Aqua Planet');
        expect(result.segments[0].displayName).toContain('Party');
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

    test('TLA-025 item 13: offline cap landing inside a trustworthy prefix wins even though the queue later goes uncertain', () => {
        const stored = storedRecord({
            offline: { hourCap: 0.01, mooPassExpireTime: null }, // ~36s cap
            projection: {
                segments: [
                    { startAt: 0, endAt: 100_000, certainty: 'trustworthy', stopCause: 'count' },
                    { startAt: 100_000, endAt: null, certainty: 'uncertain', stopCause: 'labyrinth' },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        const result = resolveDisplayProjection(stored, 0);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(36_000);
    });

    test('TLA-025 item 13: offline cap landing after the trustworthy prefix ends stays unknown', () => {
        const stored = storedRecord({
            offline: { hourCap: 10, mooPassExpireTime: null }, // far later than the 100s prefix
            projection: {
                segments: [
                    { startAt: 0, endAt: 100_000, certainty: 'trustworthy', stopCause: 'count' },
                    { startAt: 100_000, endAt: null, certainty: 'uncertain', stopCause: 'labyrinth' },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        const result = resolveDisplayProjection(stored, 0);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('TLA-025 item 13: no trustworthy prefix at all (already uncertain from the start) stays unknown unchanged', () => {
        const stored = storedRecord({
            offline: { hourCap: 0.01, mooPassExpireTime: null },
            projection: {
                segments: [{ startAt: 0, endAt: null, certainty: 'uncertain', stopCause: 'combat' }],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        const result = resolveDisplayProjection(stored, 0);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('TLA-025 item 14: a finite terminal that crosses an unresolved MooPass boundary fails closed to unknown', () => {
        const stored = storedRecord({
            offline: { hourCap: 10, mooPassExpireTime: 6000 },
            projection: {
                segments: [{ endAt: 100_000_000 }],
                terminalCause: 'queue',
                terminalAt: 100_000_000, // far past the MooPass boundary
            },
        });

        const result = resolveDisplayProjection(stored, 5000); // offlineLimitAt = 5000 + 36,000,000

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
    });

    test('TLA-025 item 14: a finite terminal provably before the MooPass boundary is unaffected', () => {
        const stored = storedRecord({
            offline: { hourCap: 10, mooPassExpireTime: 6000 },
            projection: {
                segments: [{ endAt: 3000 }],
                terminalCause: 'action',
                terminalAt: 3000, // before mooPassExpireTime (6000)
            },
        });

        const result = resolveDisplayProjection(stored, 5000);

        expect(result.terminalCause).toBe('action');
        expect(result.terminalAt).toBe(3000);
    });
});
