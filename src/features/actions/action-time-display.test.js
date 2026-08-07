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
