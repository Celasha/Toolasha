/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getCurrentActions: vi.fn(() => []),
        getInventory: vi.fn(() => []),
        getEquipment: vi.fn(() => ({})),
        getSkills: vi.fn(() => ({})),
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        getActionDetails: vi.fn(),
        getItemDetails: vi.fn(),
        getActionDrinkSlots: vi.fn(() => []),
        getCommunityBuffLevel: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getPersonalBuffFlatBoost: vi.fn(() => 0),
        getHouseRooms: vi.fn(() => new Map()),
        isTaskAction: vi.fn(() => false),
        getTaskSpeedBonus: vi.fn(() => 0),
        getElapsedSecondsInCurrentUnit: vi.fn(() => 0),
        characterData: { guildActionTypeBuffsMap: {} },
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
        setSetting: vi.fn(),
        COLOR_TEXT_SECONDARY: '#999999',
        COLOR_TOOLTIP_INFO: '#999999',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/tooltip-observer.js', () => ({
    default: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock('../../api/marketplace.js', () => ({
    default: { isLoaded: vi.fn(() => false) },
}));

vi.mock('./gathering-profit.js', () => ({
    calculateGatheringProfit: vi.fn(),
}));

vi.mock('../market/profit-calculator.js', () => ({
    default: { calculateProfit: vi.fn() },
}));

vi.mock('../market/alchemy-profit-calculator.js', () => ({
    default: {},
}));

vi.mock('../../utils/action-calculator.js', () => ({
    calculateActionStats: vi.fn(),
}));

vi.mock('../../utils/action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [], source: 'saved-loadout' })),
    resolveCurrentActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [], source: 'current' })),
}));

vi.mock('../../utils/formatters.js', () => ({
    timeReadable: vi.fn((s) => `${s}s`),
    formatWithSeparator: vi.fn((n) => `${n}`),
    formatDateTime: vi.fn(() => ''),
}));

vi.mock('../../utils/efficiency.js', () => ({
    calculateEfficiencyMultiplier: vi.fn(() => 1),
}));

vi.mock('../../utils/tea-parser.js', () => ({
    parseArtisanBonus: vi.fn(() => 0),
    getDrinkConcentration: vi.fn(() => 0),
    parseGatheringBonus: vi.fn(() => 0),
    parseGourmetBonus: vi.fn(() => 0),
}));

vi.mock('../../utils/buff-parser.js', () => ({
    getAlchemySuccessBonus: vi.fn(() => 0),
}));

vi.mock('../../utils/profit-helpers.js', () => ({
    calculateProductionActionTotalsFromBase: vi.fn(),
    calculateGatheringActionTotalsFromBase: vi.fn(),
    calculateActionsPerHour: vi.fn(() => 0),
    calculateEffectiveActionsPerHour: vi.fn(() => 0),
}));

vi.mock('../enhancement/enhancement-xp.js', () => ({
    calculateEnhancementPredictions: vi.fn(),
}));

vi.mock('../../utils/enhancement-calculator.js', () => ({
    BASE_SUCCESS_RATES: [],
}));

import { ActionTimeDisplay } from './action-time-display.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { resolveActionContext, resolveCurrentActionContext } from '../../utils/action-context.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import profitCalculator from '../market/profit-calculator.js';
import { calculateEfficiencyMultiplier } from '../../utils/efficiency.js';
import { calculateEnhancementPredictions } from '../enhancement/enhancement-xp.js';

/**
 * MutationObserver callbacks fire on the microtask queue — flush it before asserting.
 */
async function flushMutations() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('ActionTimeDisplay action-name observer self-mutation guard', () => {
    let instance;
    let actionNameElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        actionNameElement = document.createElement('div');
        actionNameElement.textContent = 'Foraging';
        document.body.appendChild(actionNameElement);
        instance = new ActionTimeDisplay();
    });

    afterEach(() => {
        if (instance.actionNameObserver) {
            instance.actionNameObserver();
        }
    });

    test('does not re-enter updateDisplay when the observer sees only our own marker span appear', async () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});
        instance.reconnectActionNameObserver(actionNameElement);

        // Reproduces the confirmed production defect: a mutation adding/removing only our
        // own `.mwi-appended-stats` marker reaches a live observer on this element (this
        // happens for real via the leaked duplicate observer setupActionNameObserver used to
        // create). Without the guard, this would call updateDisplay() again, which would
        // re-edit the marker, which the observer would see again — forever.
        instance.appendStatsToActionName(actionNameElement, 'stats');
        await flushMutations();
        expect(updateSpy).not.toHaveBeenCalled();

        instance.clearAppendedStats(actionNameElement);
        await flushMutations();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    test('settles across repeated add/remove cycles of only our own marker (proves no runaway recursion)', async () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});
        instance.reconnectActionNameObserver(actionNameElement);

        for (let i = 0; i < 5; i++) {
            instance.appendStatsToActionName(actionNameElement, `stats ${i}`);
            await flushMutations();
            instance.clearAppendedStats(actionNameElement);
            await flushMutations();
        }

        expect(updateSpy).not.toHaveBeenCalled();
    });

    test('still calls updateDisplay for a genuine game/React change to the header', async () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});
        instance.reconnectActionNameObserver(actionNameElement);

        actionNameElement.textContent = 'Foraging (7)';
        await flushMutations();

        expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    test('setupActionNameObserver disconnects any previous observer instead of leaking a duplicate', async () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});

        // Calling this twice in a row reproduces how the persistent Header_actionName class
        // watcher and waitForActionPanel can both fire for the same element during a
        // character switch. Before the fix, the first observer was never disconnected here,
        // leaving two live observers on the same node.
        instance.setupActionNameObserver(actionNameElement);
        const firstObserver = instance.actionNameObserver;
        instance.setupActionNameObserver(actionNameElement);

        expect(instance.actionNameObserver).not.toBe(firstObserver);

        // If the first observer were still connected, our own marker mutation below would
        // reach it too. Combined with the self-mutation guard this is defense in depth, but
        // this test isolates the leak itself: only one observer should still be live.
        instance.appendStatsToActionName(actionNameElement, 'stats');
        await flushMutations();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    test('isSelfInflictedMutation returns false for a mixed batch containing a genuine change', () => {
        const markerSpan = document.createElement('span');
        markerSpan.className = 'mwi-appended-stats';
        const otherSpan = document.createElement('span');

        const mutations = [
            { type: 'childList', addedNodes: [markerSpan], removedNodes: [] },
            { type: 'childList', addedNodes: [otherSpan], removedNodes: [] },
        ];

        expect(instance.isSelfInflictedMutation(mutations)).toBe(false);
    });
});

describe('ActionTimeDisplay atomic current vs prediction contexts (TLA-027)', () => {
    let instance;
    const TYPE = '/action_types/woodcutting';
    const ACTION = '/actions/woodcutting/arcane_tree';
    const actionDetails = { type: TYPE, levelRequirement: { skillHrid: '/skills/woodcutting', level: 80 } };
    const currentContext = {
        equipment: new Map([['/item_locations/tool', { itemHrid: '/items/holy_hatchet', enhancementLevel: 5 }]]),
        drinks: [{ itemHrid: '/items/current_tea' }],
        source: 'current',
    };
    const predictionContext = {
        equipment: new Map([['/item_locations/tool', { itemHrid: '/items/rainbow_hatchet', enhancementLevel: 5 }]]),
        drinks: [{ itemHrid: '/items/saved_tea' }],
        source: 'saved-loadout',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        config.getSetting.mockImplementation(() => false);
        instance = new ActionTimeDisplay();
        dataManager.getSkills.mockReturnValue([{ skillHrid: '/skills/woodcutting', level: 83 }]);
        dataManager.getActionDetails.mockReturnValue(actionDetails);
        dataManager.getCurrentActions.mockReturnValue([{ id: 1, ordinal: 0, actionHrid: ACTION }]);
        resolveCurrentActionContext.mockReturnValue(currentContext);
        resolveActionContext.mockReturnValue(predictionContext);
        calculateActionStats.mockReturnValue({ actionTime: 10, totalEfficiency: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('explicit current context reaches calculateActionStats atomically without re-resolving prediction context', () => {
        instance.calculateActionTime(actionDetails, ACTION, currentContext);

        expect(calculateActionStats).toHaveBeenCalledWith(
            actionDetails,
            expect.objectContaining({
                equipment: currentContext.equipment,
                actionContext: currentContext,
            })
        );
        expect(resolveActionContext).not.toHaveBeenCalled();
    });

    test('future queue calculation defaults to the saved-loadout-aware prediction context', () => {
        instance.calculateActionTime(actionDetails, ACTION);

        expect(resolveActionContext).toHaveBeenCalledWith(TYPE);
        expect(calculateActionStats).toHaveBeenCalledWith(
            actionDetails,
            expect.objectContaining({
                equipment: predictionContext.equipment,
                actionContext: predictionContext,
            })
        );
    });

    test('calculateSingleQueueActionTime forwards an explicit context atomically to calculateActionTime, without re-resolving prediction', () => {
        // This is the layer calculateCurrentActionTime uses for the currently active action -
        // proving it passes resolveCurrentActionContext()'s result straight through.
        instance.calculateSingleQueueActionTime(
            { id: 1, hasMaxCount: true, maxCount: 1, currentCount: 0, actionHrid: ACTION },
            actionDetails,
            { byHrid: {} },
            currentContext
        );

        expect(calculateActionStats).toHaveBeenCalledWith(
            actionDetails,
            expect.objectContaining({ equipment: currentContext.equipment, actionContext: currentContext })
        );
        expect(resolveActionContext).not.toHaveBeenCalled();
    });

    test('live-state refresh is signature-gated so ordinary unchanged items_updated work does not rerender', () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});
        instance.lastLiveContextSignature = instance.buildLiveContextSignature(
            dataManager.getCurrentActions()[0],
            actionDetails
        );

        instance.scheduleLiveContextRefresh();
        vi.advanceTimersByTime(50);
        expect(updateSpy).not.toHaveBeenCalled();

        resolveCurrentActionContext.mockReturnValue({
            ...currentContext,
            equipment: new Map([['/item_locations/tool', { itemHrid: '/items/rainbow_hatchet', enhancementLevel: 5 }]]),
        });
        instance.scheduleLiveContextRefresh();
        vi.advanceTimersByTime(50);
        expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    test('rapid repeated live-state notifications inside the debounce window coalesce into a single refresh', () => {
        const updateSpy = vi.spyOn(instance, 'updateDisplay').mockImplementation(() => {});
        instance.lastLiveContextSignature = 'stale';

        instance.scheduleLiveContextRefresh();
        instance.scheduleLiveContextRefresh();
        instance.scheduleLiveContextRefresh();
        vi.advanceTimersByTime(50);

        expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    test('Action Bar profit uses the supplied current context instead of saved-loadout defaults', async () => {
        config.getSetting.mockImplementation((key) => key === 'actionBar_showProfit');
        instance.profitElement = document.createElement('div');
        const action = { actionHrid: ACTION };
        dataManager.getActionDetails.mockReturnValue({ ...actionDetails, dropTable: [{}] });
        calculateGatheringProfit.mockResolvedValue({
            profitPerHour: 1000,
            actionsPerHour: 100,
            efficiencyMultiplier: 1,
        });

        await instance.updateActionBarProfit(action, Infinity, currentContext);

        expect(calculateGatheringProfit).toHaveBeenCalledWith(ACTION, { actionContext: currentContext });
        expect(profitCalculator.calculateProfit).not.toHaveBeenCalled();
    });

    test('Action Bar profit defaults to resolveCurrentActionContext when no context is explicitly supplied', async () => {
        config.getSetting.mockImplementation((key) => key === 'actionBar_showProfit');
        instance.profitElement = document.createElement('div');
        const action = { actionHrid: ACTION };
        dataManager.getActionDetails.mockReturnValue({ ...actionDetails, dropTable: [{}] });
        calculateGatheringProfit.mockResolvedValue({
            profitPerHour: 500,
            actionsPerHour: 50,
            efficiencyMultiplier: 1,
        });

        await instance.updateActionBarProfit(action, Infinity);

        expect(resolveCurrentActionContext).toHaveBeenCalledWith(TYPE);
        expect(calculateGatheringProfit).toHaveBeenCalledWith(ACTION, { actionContext: currentContext });
    });
});

describe('ActionTimeDisplay live invalidation subscribes to the common buffs_updated event (TLA-028)', () => {
    let instance;

    beforeEach(() => {
        vi.clearAllMocks();
        config.getSetting.mockImplementation((key) => key === 'actionBar_enabled');
        config.getSettingValue.mockImplementation((_key, fallback) => fallback);
        instance = new ActionTimeDisplay();
    });

    afterEach(() => {
        instance.disable();
    });

    test('subscribes to the common buffs_updated event rather than enumerating individual native buff message types', async () => {
        await instance.initialize();

        const subscribedEvents = dataManager.on.mock.calls.map(([event]) => event);
        expect(subscribedEvents).toContain('buffs_updated');
        expect(subscribedEvents).not.toContain('personal_buffs_updated');
        expect(subscribedEvents).not.toContain('house_rooms_updated');
    });

    test('still subscribes to the non-buff live-state events needed for the signature gate', async () => {
        await instance.initialize();

        const subscribedEvents = dataManager.on.mock.calls.map(([event]) => event);
        expect(subscribedEvents).toContain('items_updated');
        expect(subscribedEvents).toContain('consumables_updated');
        expect(subscribedEvents).toContain('skills_updated');
        expect(subscribedEvents).toContain('action_completed');
    });

    test('disable() cleans up the buffs_updated subscription', async () => {
        await instance.initialize();
        expect(dataManager.on).toHaveBeenCalledWith('buffs_updated', expect.any(Function));

        instance.disable();

        expect(dataManager.off).toHaveBeenCalledWith('buffs_updated', expect.any(Function));
    });
});

describe('ActionTimeDisplay current-unit partial progress (TLA-015)', () => {
    let instance;

    const actionDetails = { type: '/action_types/cheesesmithing' };
    const inventoryLookup = { byHrid: {}, byEnhancedKey: {} };

    beforeEach(() => {
        vi.clearAllMocks();
        instance = new ActionTimeDisplay();
        calculateActionStats.mockReturnValue({ actionTime: 135, totalEfficiency: 0 });
        calculateEfficiencyMultiplier.mockReturnValue(1);
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(0);
    });

    function makeAction(overrides = {}) {
        return {
            id: 1,
            hasMaxCount: true,
            maxCount: 1,
            currentCount: 0,
            actionHrid: '/actions/cheesesmithing/holy_hammer',
            ...overrides,
        };
    }

    test('T1 - no elapsed progress: remaining equals the full action time', () => {
        const result = instance.calculateSingleQueueActionTime(makeAction(), actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(135);
    });

    test('T2 - 60s elapsed of a 135s action: remaining is 75s, not 135s', () => {
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(60);
        const result = instance.calculateSingleQueueActionTime(makeAction(), actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(75);
    });

    test('T3 - near-complete current unit (134s of 135s elapsed): remaining is ~1s', () => {
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(134);
        const result = instance.calculateSingleQueueActionTime(makeAction(), actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(1);
    });

    test('T4 - current partial unit plus two future full units: 75 + 135 + 135, not 3x135', () => {
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(60);
        const action = makeAction({ maxCount: 3, currentCount: 0 });
        const result = instance.calculateSingleQueueActionTime(action, actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(345);
        expect(result.totalTime).not.toBe(405);
    });

    test('elapsed subtraction is clamped so total time never goes negative', () => {
        // Defensive edge case: elapsed reported >= full unit duration should never invert the sign.
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(135);
        const result = instance.calculateSingleQueueActionTime(makeAction(), actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(0);
    });

    test('cold/unknown provenance (no boundary yet): behaves exactly as before the fix, no fabricated partial', () => {
        // getElapsedSecondsInCurrentUnit defaults to 0 when data-manager has no trustworthy boundary —
        // this must reproduce the pre-fix "full remaining time" result, not some invented estimate.
        const result = instance.calculateSingleQueueActionTime(makeAction(), actionDetails, inventoryLookup);
        expect(result.totalTime).toBe(135);
        expect(dataManager.getElapsedSecondsInCurrentUnit).toHaveBeenCalledWith(1, 0, 135);
    });

    test('queued (non-current) actions are unaffected — elapsed lookup uses that action own id/count', () => {
        // calculateSingleQueueActionTime is shared by the current action and by queued-action loops;
        // the lookup key is scoped by (actionId, currentCount) so a queued action never inherits the
        // front action's elapsed time.
        const queuedAction = makeAction({ id: 99, currentCount: 0 });
        instance.calculateSingleQueueActionTime(queuedAction, actionDetails, inventoryLookup);
        expect(dataManager.getElapsedSecondsInCurrentUnit).toHaveBeenCalledWith(99, 0, 135);
    });

    test('enhancing: 60s elapsed of a 90s attempt reduces materialTime-equivalent total by the same amount', () => {
        calculateEnhancementPredictions.mockReturnValue({
            expectedAttempts: 3,
            expectedProtections: 0,
            perActionTime: 90,
            successMultiplier: 1,
        });
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(60);

        const enhancingAction = {
            id: 2,
            hasMaxCount: true,
            maxCount: 5,
            currentCount: 0,
            enhancingMaxLevel: 10,
            primaryItemHash: '/item_locations/inventory::/items/cheese_sword::0',
        };
        const enhancingDetails = { type: '/action_types/enhancing' };

        const result = instance.calculateEnhancingQueueTime(enhancingAction, enhancingDetails, inventoryLookup);
        // realisticActions = min(5, 3) = 3 attempts of 90s = 270s, minus 60s already elapsed in the
        // current attempt = 210s.
        expect(result.totalTime).toBe(210);
    });

    test("enhancing with Philosopher's Mirror: elapsed is subtracted from the guaranteed-success total too", () => {
        calculateEnhancementPredictions.mockReturnValue({
            expectedAttempts: 5,
            expectedProtections: 0,
            perActionTime: 90,
            successMultiplier: 1,
        });
        dataManager.getElapsedSecondsInCurrentUnit.mockReturnValue(30);

        const enhancingAction = {
            id: 3,
            hasMaxCount: false,
            currentCount: 0,
            primaryItemHash: '/item_locations/inventory::/items/cheese_sword::0',
            secondaryItemHash: '/item_locations/inventory::/items/philosophers_mirror::0',
            enhancingMaxLevel: 5,
        };
        const enhancingDetails = { type: '/action_types/enhancing' };

        const result = instance.calculateEnhancingQueueTime(enhancingAction, enhancingDetails, inventoryLookup);
        // Guaranteed success: targetLevel(5) - currentLevel(0) = 5 attempts of 90s = 450s, minus 30s.
        expect(result.totalTime).toBe(420);
    });
});
