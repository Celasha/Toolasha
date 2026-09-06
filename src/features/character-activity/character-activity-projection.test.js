import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentActions: [],
    actionDetailsByHrid: {},
    inventory: [],
    itemDetailMap: {},
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
        getInitClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })),
    },
}));

vi.mock('../actions/action-time-display.js', () => ({
    default: {
        buildInventoryLookup: vi.fn((inventory) => {
            const byHrid = {};
            const byEnhancedKey = {};
            for (const item of inventory || []) {
                if (item.itemLocationHrid && item.itemLocationHrid !== '/item_locations/inventory') continue;
                const count = item.count || 0;
                if (!count) continue;
                byHrid[item.itemHrid] = (byHrid[item.itemHrid] || 0) + count;
                const enhancedKey = `${item.itemHrid}::${item.enhancementLevel || 0}`;
                byEnhancedKey[enhancedKey] = (byEnhancedKey[enhancedKey] || 0) + count;
            }
            return { byHrid, byEnhancedKey };
        }),
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

const {
    computeLiveProjection,
    resolveDisplayProjection,
    getSegmentInventoryFootprint,
    getLimitHrid,
    projectOrdinaryDeterministicInventory,
} = await import('./character-activity-projection.js');
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

function inventoryItem(itemHrid, count, overrides = {}) {
    return { itemLocationHrid: '/item_locations/inventory', itemHrid, count, ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentActions = [];
    mocks.actionDetailsByHrid = {};
    mocks.inventory = [];
    mocks.itemDetailMap = {};
    mocks.timingByActionId = {};
    mocks.drinkRemainingSecondsByType = {};
    mocks.usableSnapshotsById = {};
    // vi.clearAllMocks() clears call history but not a custom mockImplementation() installed by an
    // earlier test - restore the default canned-lookup-by-actionId behavior every time.
    actionTimeDisplay.calculateSingleQueueActionTime.mockImplementation(
        (actionObj) => mocks.timingByActionId[actionObj.id]
    );
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

describe('computeLiveProjection - sequential deterministic inventory projection (TLA-041A)', () => {
    test('CA-Q2: a later segment consuming an earlier segment’s deterministic output is trustworthy (fix for the old identity-only bug)', () => {
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
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.segments[1].stopCause).toBe('materials');
        expect(result.terminalCause).toBe('materials');
    });

    test('CA-Q1: exact Reptile Tunic -> Gobo Tunic -> Beast Tunic upgrade chain never trips inventory-dependency', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/tailoring/reptile_tunic' }),
            action({ id: 'a2', actionHrid: '/actions/tailoring/gobo_tunic' }),
            action({ id: 'a3', actionHrid: '/actions/tailoring/beast_tunic' }),
        ];
        mocks.actionDetailsByHrid['/actions/tailoring/reptile_tunic'] = actionDetails({
            type: '/action_types/tailoring',
            upgradeItemHrid: '/items/rough_tunic',
            inputItems: [{ itemHrid: '/items/reptile_leather', count: 32 }],
            outputItems: [{ itemHrid: '/items/reptile_tunic', count: 1 }],
        });
        mocks.actionDetailsByHrid['/actions/tailoring/gobo_tunic'] = actionDetails({
            type: '/action_types/tailoring',
            upgradeItemHrid: '/items/reptile_tunic',
            inputItems: [{ itemHrid: '/items/gobo_leather', count: 56 }],
            outputItems: [{ itemHrid: '/items/gobo_tunic', count: 1 }],
        });
        mocks.actionDetailsByHrid['/actions/tailoring/beast_tunic'] = actionDetails({
            type: '/action_types/tailoring',
            upgradeItemHrid: '/items/gobo_tunic',
            inputItems: [{ itemHrid: '/items/beast_leather', count: 96 }],
            outputItems: [{ itemHrid: '/items/beast_tunic', count: 1 }],
        });
        mocks.inventory = [
            inventoryItem('/items/rough_tunic', 1),
            inventoryItem('/items/reptile_leather', 32),
            inventoryItem('/items/gobo_leather', 56),
            inventoryItem('/items/beast_leather', 96),
        ];
        mocks.timingByActionId.a1 = timing({ totalTime: 7, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 15, limitType: null });
        mocks.timingByActionId.a3 = timing({ totalTime: 31, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(3);
        expect(result.segments.every((s) => s.certainty === 'trustworthy')).toBe(true);
        expect(result.segments.every((s) => s.stopCause !== 'inventory-dependency')).toBe(true);
        expect(result.terminalCause).toBe('queue');
        expect(result.terminalAt).toBe(1000 + (7 + 15 + 31) * 1000);
    });

    test('CA-Q3: repeated consumption of the same item across two segments stays trustworthy when starting balance is enough for both', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar2' }),
        ];
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 40 }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar2'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 40 }],
        });
        mocks.inventory = [inventoryItem('/items/log', 100)];
        mocks.timingByActionId.a1 = timing({ totalTime: 10, count: 1, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 10, count: 1, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments.every((s) => s.certainty === 'trustworthy')).toBe(true);
    });

    test('CA-Q4 (wiring proof): a later segment observes the inventory actually reduced by an earlier segment’s consumption, not the stale starting snapshot', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar2' }),
        ];
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 40 }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar2'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 40 }],
        });
        mocks.inventory = [inventoryItem('/items/log', 60)];
        mocks.timingByActionId.a1 = timing({ totalTime: 10, count: 1, limitType: null });

        actionTimeDisplay.calculateSingleQueueActionTime.mockImplementation(
            (actionObj, actionDetails, inventoryLookup) => {
                if (actionObj.id === 'a1') return mocks.timingByActionId.a1;
                // a2's own real limiter, derived from whatever balance it actually observes.
                const available = inventoryLookup.byHrid['/items/log'] || 0;
                return timing({ totalTime: 10, limitType: available < 40 ? 'material:/items/log' : null });
            }
        );

        const result = computeLiveProjection(1000);

        // Starting 60 - a1's 40 = 20 remaining, which is < a2's required 40 -> real materials limit.
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.segments[1].stopCause).toBe('materials');
    });

    test('CA-Q5: coin balance propagates across two coin-costing ordinary segments', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar2' }),
        ];
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({ coinCost: 100 });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar2'] = actionDetails({ coinCost: 100 });
        mocks.inventory = [inventoryItem('/items/coin', 150)];
        mocks.timingByActionId.a1 = timing({ totalTime: 10, count: 1, limitType: null });

        actionTimeDisplay.calculateSingleQueueActionTime.mockImplementation(
            (actionObj, actionDetails, inventoryLookup) => {
                if (actionObj.id === 'a1') return mocks.timingByActionId.a1;
                const available = inventoryLookup.byHrid['/items/coin'] || 0;
                return timing({ totalTime: 10, limitType: available < 100 ? 'gold' : null });
            }
        );

        const result = computeLiveProjection(1000);

        // Starting 150 - a1's 100 = 50 remaining, which is < a2's required 100 -> real gold limit.
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.segments[1].stopCause).toBe('coins');
    });

    test('CA-Q6: a later segment whose own real limiter resolves to a possibly-extra random-output hrid becomes uncertain', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('uncertain');
        expect(result.segments[1].stopCause).toBe('inventory-dependency');
        expect(result.terminalCause).toBe('unknown');
    });

    test('CA-Q7: an unrelated random output does not poison a later segment consuming a different item', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
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

    test('CA-Q7b: a later segment with no item overlap at all stays trustworthy regardless of its own stopCause', () => {
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

    test('CA-Q8: a possible random extra does not poison a later segment whose own count is not actually resource-bound', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        // Deterministic stock already fully supports a2's requested count, so its own real
        // limiter resolved to null (the requested count itself is the binding constraint) - not
        // 'material:/items/rare_gem'.
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
    });

    test('CA-Q12: an Alchemy segment keeps its touched balances fail-closed for later consumers, without poisoning unrelated segments', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/alchemy/coinify', primaryItemHash: '/items/junk::0' }),
            action({ id: 'a2', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a3', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/alchemy/coinify'] = actionDetails({
            type: '/action_types/alchemy',
        });
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            inputItems: [{ itemHrid: '/items/iron' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            coinCost: 50,
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 5, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 10, limitType: 'material:/items/iron' });
        mocks.timingByActionId.a3 = timing({ totalTime: 10, limitType: 'gold' });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(3);
        expect(result.segments[0].certainty).toBe('trustworthy');
        // a2 is unrelated to coin (or the alchemy item) - not poisoned by a1's fail-closed balances.
        expect(result.segments[1].certainty).toBe('trustworthy');
        // a3 depends on coin, which Alchemy's dynamic cost is never projected for -> fail closed.
        expect(result.segments[2].certainty).toBe('uncertain');
        expect(result.segments[2].stopCause).toBe('inventory-dependency');
        expect(result.terminalCause).toBe('unknown');
    });

    test('regression guard: a later segment’s own count-limited stopCause does not trigger inventory-dependency merely from sharing a hrid with an earlier deterministic producer', () => {
        // This is the exact TLA-025 identity-only overlap bug TLA-041A fixes: A deterministically
        // produces log, B consumes log and its own real limiter resolved to null (count-bound, not
        // resource-bound) - neither poisoning set applies, so B must be trustworthy.
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
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: null });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].certainty).toBe('trustworthy');
        expect(result.terminalCause).toBe('queue');
    });

    test('CA-Q11: the live front segment (i===0) projects the full timing.count worth of consumption regardless of currentCount/elapsed progress', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/cheesesmithing/bar', currentCount: 7, maxCount: 20 }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar2' }),
        ];
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 30 }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar2'] = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 30 }],
        });
        mocks.inventory = [inventoryItem('/items/log', 100)];
        // a1 (the live front action, already 7/20 complete) still has 3 remaining units queued.
        mocks.timingByActionId.a1 = timing({ totalTime: 10, count: 3, limitType: null });

        actionTimeDisplay.calculateSingleQueueActionTime.mockImplementation(
            (actionObj, actionDetails, inventoryLookup) => {
                if (actionObj.id === 'a1') return mocks.timingByActionId.a1;
                const available = inventoryLookup.byHrid['/items/log'] || 0;
                return timing({ totalTime: 10, limitType: available < 30 ? 'material:/items/log' : null });
            }
        );

        const result = computeLiveProjection(1000);

        // Correct model: 100 - 3*30 = 10 remaining, which is < a2's required 30 -> real materials
        // limit. A hypothetical "already-paid unit" adjustment (count-1=2) would instead leave
        // 100 - 2*30 = 40, which is >= 30 and would wrongly report a2 as count-bound - this test
        // fails under that bug and passes under the correct full-count projection.
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].stopCause).toBe('materials');
    });
});

describe('computeLiveProjection - infinite-tail attention continuity (TLA-025A)', () => {
    test('CA-A01: the current active segment itself proven truly infinite sets attention runs-infinite', () => {
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
        expect(result.attention).toEqual({ mode: 'runs-infinite' });
    });

    test('CA-A02: an exact finite prefix leading into a later truly infinite segment sets attention queue-infinite, not runs-infinite', () => {
        mocks.currentActions = [action({ id: 'a1' }), action({ id: 'a2', hasMaxCount: false })];
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.timingByActionId.a1 = timing({ totalTime: 100 });
        mocks.timingByActionId.a2 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('infinite');
        expect(result.attention).toEqual({ mode: 'queue-infinite' });
    });

    test('CA-A03: reproduced case - Decompose makes coin unknown, Coinify trips inventory-dependency on coin, but Star Fruit true-∞ gathering after it sets attention queue-infinite', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/alchemy/decompose', primaryItemHash: '/items/junk::0' }),
            action({ id: 'a2', actionHrid: '/actions/alchemy/coinify', primaryItemHash: '/items/foraging_essence::0' }),
            action({ id: 'a3', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/alchemy/decompose'] = actionDetails({ type: '/action_types/alchemy' });
        mocks.actionDetailsByHrid['/actions/alchemy/coinify'] = actionDetails({ type: '/action_types/alchemy' });
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 30, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 30, limitType: null });
        mocks.timingByActionId.a3 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        // Exact duration stays fail-closed - Coinify's own coin balance is unknown after Decompose.
        expect(result.terminalCause).toBe('unknown');
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].stopCause).toBe('inventory-dependency');
        // But the guaranteed non-blocking path to the true-∞ gathering tail is still recorded.
        expect(result.attention).toEqual({ mode: 'queue-infinite' });
    });

    test('CA-A10/A18: resource/inventory uncertainty followed only by a finite queue end never sets attention', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });

        const result = computeLiveProjection(1000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.attention).toBeNull();
    });

    test.each([
        ['CA-A11 Combat', { actionHrid: '/actions/combat/aqua_planet' }, {}],
        ['CA-A12 Labyrinth', { actionHrid: '/actions/labyrinth/explore' }, { type: '/action_types/labyrinth' }],
        ['CA-A13 Enhancing', { actionHrid: '/actions/enhancing/sword' }, { type: '/action_types/enhancing' }],
        [
            'CA-A14 Party Ready / Special',
            { actionHrid: '/actions/special/party_ready' },
            { type: '/action_types/special' },
        ],
    ])(
        '%s between the uncertain segment and a later true-∞ tail blocks attention',
        (_label, actionOverrides, detailsOverrides) => {
            mocks.currentActions = [
                action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
                action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
                action({ id: 'a3', ...actionOverrides }),
                action({ id: 'a4', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
            ];
            mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
                type: '/action_types/foraging',
                dropTable: [{ itemHrid: '/items/rare_gem' }],
            });
            mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
                inputItems: [{ itemHrid: '/items/rare_gem' }],
            });
            mocks.actionDetailsByHrid[actionOverrides.actionHrid] = actionDetails(detailsOverrides);
            mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({
                type: '/action_types/foraging',
            });
            mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
            mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
            mocks.timingByActionId.a4 = timing({
                isTrulyInfinite: true,
                totalTime: Infinity,
                count: 0,
                baseActionsNeeded: 0,
            });

            const result = computeLiveProjection(1000);

            expect(result.attention).toBeNull();
        }
    );

    test('CA-A15: an unresolvable explicit loadout between the uncertain segment and a later true-∞ tail blocks attention', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a3', characterLoadoutID: 99 }),
            action({ id: 'a4', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
        mocks.timingByActionId.a4 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });
        // No entry in usableSnapshotsById for id 99 - deleted/unusable/missing equipment.

        const result = computeLiveProjection(1000);

        expect(result.attention).toBeNull();
    });

    test('CA-A16: a timing-unavailable action between the uncertain segment and a later true-∞ tail blocks attention', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a3' }),
            action({ id: 'a4', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
        // a3 intentionally has no timingByActionId entry - the default mock returns undefined.
        mocks.timingByActionId.a4 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        expect(result.attention).toBeNull();
    });

    test('CA-A17: missing action details between the uncertain segment and a later true-∞ tail blocks attention', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a3', actionHrid: '/actions/unknown/thing' }),
            action({ id: 'a4', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
        mocks.timingByActionId.a4 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        expect(result.attention).toBeNull();
    });

    test('CA-A09: an active drink for an intervening action type blocks attention even though a later true-∞ tail exists', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a3', actionHrid: '/actions/woodcutting/redwood' }),
            action({ id: 'a4', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/woodcutting/redwood'] = actionDetails();
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
        mocks.timingByActionId.a3 = timing({ totalTime: 999_999, limitType: null });
        mocks.timingByActionId.a4 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });
        // A drink is slotted for a3's type - even though it outlasts everything, this scan cannot
        // prove the eventual offline deadline falls after its cutoff, so it must fail closed.
        mocks.drinkRemainingSecondsByType['/action_types/woodcutting'] = [
            { itemHrid: '/items/gathering_tea', totalSeconds: 999_999 },
        ];

        const result = computeLiveProjection(1000);

        expect(result.attention).toBeNull();
    });

    test('a later segment whose own real limiter binds a possibly-extra random-output hrid can still find a guaranteed true-∞ tail beyond it', () => {
        mocks.currentActions = [
            action({ id: 'a1', actionHrid: '/actions/foraging/berry' }),
            action({ id: 'a2', actionHrid: '/actions/cheesesmithing/bar' }),
            action({ id: 'a3', actionHrid: '/actions/foraging/star_fruit', hasMaxCount: false }),
        ];
        mocks.actionDetailsByHrid['/actions/foraging/berry'] = actionDetails({
            type: '/action_types/foraging',
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/cheesesmithing/bar'] = actionDetails({
            inputItems: [{ itemHrid: '/items/rare_gem' }],
        });
        mocks.actionDetailsByHrid['/actions/foraging/star_fruit'] = actionDetails({ type: '/action_types/foraging' });
        mocks.timingByActionId.a1 = timing({ totalTime: 100, limitType: null });
        mocks.timingByActionId.a2 = timing({ totalTime: 50, limitType: 'material:/items/rare_gem' });
        mocks.timingByActionId.a3 = timing({
            isTrulyInfinite: true,
            totalTime: Infinity,
            count: 0,
            baseActionsNeeded: 0,
        });

        const result = computeLiveProjection(1000);

        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].stopCause).toBe('inventory-dependency');
        expect(result.attention).toEqual({ mode: 'queue-infinite' });
    });
});

describe('getSegmentInventoryFootprint / getLimitHrid / projectOrdinaryDeterministicInventory (TLA-041A units)', () => {
    test('getLimitHrid maps gold/material/upgrade limiters to their item hrid, else null', () => {
        expect(getLimitHrid('gold')).toBe('/items/coin');
        expect(getLimitHrid('material:/items/log')).toBe('/items/log');
        expect(getLimitHrid('upgrade:/items/gizmo')).toBe('/items/gizmo');
        expect(getLimitHrid(null)).toBeNull();
        expect(getLimitHrid(undefined)).toBeNull();
    });

    test('getSegmentInventoryFootprint splits deterministic outputItems from stochastic dropTable, and only adds Alchemy-specific consumed identities for Alchemy actions', () => {
        const ordinary = actionDetails({
            inputItems: [{ itemHrid: '/items/log' }],
            upgradeItemHrid: '/items/rough_tunic',
            coinCost: 10,
            outputItems: [{ itemHrid: '/items/bar' }],
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        const footprint = getSegmentInventoryFootprint(ordinary, action());

        expect(footprint.consumed).toEqual(new Set(['/items/log', '/items/rough_tunic', '/items/coin']));
        expect(footprint.deterministicProduced).toEqual(new Set(['/items/bar']));
        expect(footprint.stochasticProduced).toEqual(new Set(['/items/rare_gem']));

        const alchemy = actionDetails({ type: '/action_types/alchemy' });
        const alchemyFootprint = getSegmentInventoryFootprint(
            alchemy,
            action({ primaryItemHash: '/items/junk::0', secondaryItemHash: '/items/catalyst::0' })
        );
        expect(alchemyFootprint.consumed).toEqual(new Set(['/items/junk', '/items/catalyst', '/items/coin']));
    });

    test('projectOrdinaryDeterministicInventory subtracts inputItems/upgradeItemHrid/coinCost, adds outputItems, and mirrors byHrid/byEnhancedKey', () => {
        const details = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 10 }],
            upgradeItemHrid: '/items/rough_tunic',
            coinCost: 5,
            outputItems: [{ itemHrid: '/items/bar', count: 2 }],
        });
        const lookup = {
            byHrid: { '/items/log': 100, '/items/rough_tunic': 3, '/items/coin': 50 },
            byEnhancedKey: { '/items/log::0': 100, '/items/rough_tunic::0': 3, '/items/coin::0': 50 },
        };
        const result = projectOrdinaryDeterministicInventory(details, { count: 3 }, lookup, {
            equipment: new Map(),
            drinks: [],
        });

        expect(result.supported).toBe(true);
        // No drinks configured -> 0 Artisan bonus -> full 10*3=30 consumed.
        expect(result.inventoryLookup.byHrid['/items/log']).toBe(70);
        expect(result.inventoryLookup.byEnhancedKey['/items/log::0']).toBe(70);
        expect(result.inventoryLookup.byHrid['/items/rough_tunic']).toBe(0); // 3 - 1*3, clamped at 0
        expect(result.inventoryLookup.byHrid['/items/coin']).toBe(35); // 50 - 5*3
        expect(result.inventoryLookup.byHrid['/items/bar']).toBe(6); // 0 + 2*3
        expect(result.inventoryLookup.byEnhancedKey['/items/bar::0']).toBe(6);
        // Original lookup must be untouched (clone, not mutate-in-place).
        expect(lookup.byHrid['/items/log']).toBe(100);
    });

    test('projectOrdinaryDeterministicInventory applies Artisan reduction to inputItems only, never to upgradeItemHrid', () => {
        mocks.itemDetailMap = {
            '/items/artisan_tea': {
                consumableDetail: { buffs: [{ typeHrid: '/buff_types/artisan', flatBoost: 0.1 }] },
            },
        };
        const details = actionDetails({
            inputItems: [{ itemHrid: '/items/log', count: 10 }],
            upgradeItemHrid: '/items/rough_tunic',
        });
        const lookup = {
            byHrid: { '/items/log': 1000, '/items/rough_tunic': 1000 },
            byEnhancedKey: {},
        };

        // 10% Artisan bonus, no Drink Concentration -> input consumption per action is
        // 10 * (1 - 0.1) = 9, times count 3 = 27. Upgrade item is never Artisan-reduced: 1*3 = 3.
        const result = projectOrdinaryDeterministicInventory(details, { count: 3 }, lookup, {
            equipment: new Map(),
            drinks: [{ itemHrid: '/items/artisan_tea' }],
        });

        expect(result.inventoryLookup.byHrid['/items/log']).toBe(1000 - 27);
        expect(result.inventoryLookup.byHrid['/items/rough_tunic']).toBe(1000 - 3);
    });

    test('CA-Q9: uses timing.count (completed queued actions), never baseActionsNeeded (time-consuming actions after efficiency)', () => {
        const details = actionDetails({ inputItems: [{ itemHrid: '/items/log', count: 10 }] });
        const lookup = { byHrid: { '/items/log': 1000 }, byEnhancedKey: {} };

        // Efficiency > 1 collapses many completed actions into few time-consuming ones -
        // baseActionsNeeded (2) must never be used as the material multiplier instead of count (7).
        const result = projectOrdinaryDeterministicInventory(details, { count: 7, baseActionsNeeded: 2 }, lookup, {
            equipment: new Map(),
            drinks: [],
        });

        expect(result.inventoryLookup.byHrid['/items/log']).toBe(1000 - 10 * 7);
    });

    test('dropTable output is never added to the projected deterministic lookup, only deterministic outputItems', () => {
        const details = actionDetails({
            outputItems: [{ itemHrid: '/items/log', count: 1 }],
            dropTable: [{ itemHrid: '/items/rare_gem' }],
        });
        const lookup = { byHrid: {}, byEnhancedKey: {} };

        const result = projectOrdinaryDeterministicInventory(details, { count: 5 }, lookup, {
            equipment: new Map(),
            drinks: [],
        });

        expect(result.inventoryLookup.byHrid['/items/log']).toBe(5);
        expect(result.inventoryLookup.byHrid['/items/rare_gem']).toBeUndefined();
    });

    test('declines to project Alchemy and Enhancing action types (supported: false)', () => {
        const lookup = { byHrid: {}, byEnhancedKey: {} };
        const alchemyResult = projectOrdinaryDeterministicInventory(
            actionDetails({ type: '/action_types/alchemy' }),
            { count: 1 },
            lookup,
            { equipment: new Map(), drinks: [] }
        );
        const enhancingResult = projectOrdinaryDeterministicInventory(
            actionDetails({ type: '/action_types/enhancing' }),
            { count: 1 },
            lookup,
            { equipment: new Map(), drinks: [] }
        );

        expect(alchemyResult.supported).toBe(false);
        expect(alchemyResult.inventoryLookup).toBe(lookup);
        expect(enhancingResult.supported).toBe(false);
    });

    test('declines to project when timing.count is not a finite non-negative number', () => {
        const lookup = { byHrid: {}, byEnhancedKey: {} };
        const details = actionDetails({ inputItems: [{ itemHrid: '/items/log', count: 1 }] });

        expect(projectOrdinaryDeterministicInventory(details, { count: NaN }, lookup, {}).supported).toBe(false);
        expect(projectOrdinaryDeterministicInventory(details, { count: -1 }, lookup, {}).supported).toBe(false);
        expect(projectOrdinaryDeterministicInventory(details, {}, lookup, {}).supported).toBe(false);
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

describe('resolveDisplayProjection - attention/offline continuity overlay (TLA-025A)', () => {
    function attentionRecord(mode, overrides = {}) {
        return {
            offline: { hourCap: 10, mooPassExpireTime: null },
            projection: {
                segments: [
                    { startAt: 1000, endAt: null, queuedIndex: 0, certainty: 'trustworthy', stopCause: 'infinite' },
                ],
                terminalCause: 'infinite',
                terminalAt: null,
                attention: { mode },
                ...overrides.projection,
            },
            ...overrides,
        };
    }

    test('CA-A01: direct runs-infinite + known trustworthy cap resolves to offline/known', () => {
        const result = resolveDisplayProjection(attentionRecord('runs-infinite'), 5000);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(5000 + 10 * 3600 * 1000);
        expect(result.attentionMode).toBe('runs-infinite');
        expect(result.offlineLimitState).toBe('known');
    });

    test('CA-A04: direct runs-infinite + no trustworthy cap resolves to unknown/unavailable, never a fake reassurance', () => {
        const result = resolveDisplayProjection(attentionRecord('runs-infinite'), null);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.attentionMode).toBe('runs-infinite');
        expect(result.offlineLimitState).toBe('unavailable');
    });

    test('CA-A06: direct runs-infinite + MooPass ambiguity resolves to unknown/uncertain', () => {
        const record = attentionRecord('runs-infinite', { offline: { hourCap: 10, mooPassExpireTime: 6000 } });

        const result = resolveDisplayProjection(record, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.terminalAt).toBeNull();
        expect(result.attentionMode).toBe('runs-infinite');
        expect(result.offlineLimitState).toBe('uncertain');
    });

    test('CA-A02/A03: queue-infinite (terminalCause already unknown from an inventory-dependency stop) + known cap resolves to offline/known', () => {
        const record = attentionRecord('queue-infinite', {
            projection: {
                segments: [
                    { startAt: 1000, endAt: 1500, queuedIndex: 0, certainty: 'trustworthy', stopCause: 'count' },
                    {
                        startAt: 1500,
                        endAt: null,
                        queuedIndex: 1,
                        certainty: 'uncertain',
                        stopCause: 'inventory-dependency',
                    },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
                attention: { mode: 'queue-infinite' },
            },
        });

        const result = resolveDisplayProjection(record, 5000);

        expect(result.terminalCause).toBe('offline');
        expect(result.terminalAt).toBe(5000 + 10 * 3600 * 1000);
        expect(result.attentionMode).toBe('queue-infinite');
        expect(result.offlineLimitState).toBe('known');
    });

    test('CA-A05: queue-infinite (terminalCause unknown) + no trustworthy cap resolves to unknown/unavailable', () => {
        const record = attentionRecord('queue-infinite', {
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [
                    {
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'uncertain',
                        stopCause: 'inventory-dependency',
                    },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
                attention: { mode: 'queue-infinite' },
            },
        });

        const result = resolveDisplayProjection(record, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.attentionMode).toBe('queue-infinite');
        expect(result.offlineLimitState).toBe('unavailable');
    });

    test('CA-A07: queue-infinite (terminalCause unknown) + MooPass ambiguity resolves to unknown/uncertain', () => {
        const record = attentionRecord('queue-infinite', {
            offline: { hourCap: 10, mooPassExpireTime: 6000 },
            projection: {
                segments: [
                    {
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'uncertain',
                        stopCause: 'inventory-dependency',
                    },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
                attention: { mode: 'queue-infinite' },
            },
        });

        const result = resolveDisplayProjection(record, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.attentionMode).toBe('queue-infinite');
        expect(result.offlineLimitState).toBe('uncertain');
    });

    test('CA-A08: a passed offline cap keeps the ordinary offline terminalCause/terminalAt untouched by attentionMode (no ∞ prefix locked at the renderer)', () => {
        const result = resolveDisplayProjection(attentionRecord('runs-infinite'), 1000);

        // lastOfflineTime(1000) + 10h cap is far in the future relative to terminalAt: null (infinite),
        // so this just confirms the same 'offline' shape used by the existing passed-cap path.
        expect(result.terminalCause).toBe('offline');
        expect(result.attentionMode).toBe('runs-infinite');
    });

    test('an ordinary unknown terminalCause with no attention recorded (e.g. Combat) never synthesizes an attentionMode', () => {
        const stored = {
            offline: { hourCap: 10, mooPassExpireTime: null },
            projection: {
                segments: [{ startAt: 1000, endAt: null, queuedIndex: 0, certainty: 'uncertain', stopCause: 'combat' }],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        };

        const result = resolveDisplayProjection(stored, 5000);

        expect(result.terminalCause).toBe('unknown');
        expect(result.attentionMode).toBeUndefined();
        expect(result.offlineLimitState).toBeUndefined();
    });
});
