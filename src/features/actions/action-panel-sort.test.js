/**
 * Tests for the "craftable" sort mode in Action Panel Sort - sorts production action panels
 * by how many times they can currently be performed given on-hand inventory (descending),
 * same shape as the existing profit/xp/coinsPerXp modes.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/storage.js', () => ({
    default: {
        get: vi.fn(async (_key, _store, fallback) => fallback),
        set: vi.fn(),
        getJSON: vi.fn(async (_key, _store, fallback) => fallback),
        setJSON: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => 'char1'),
        getActionDetails: vi.fn(() => null),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

import actionPanelSort from './action-panel-sort.js';

function makePanel(container) {
    const panel = document.createElement('div');
    container.appendChild(panel);
    return panel;
}

describe('Action Panel Sort - craftable mode', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        actionPanelSort.clearAllPanels();
        container.remove();
    });

    test('sorts panels by max produceable count, descending', () => {
        const low = makePanel(container);
        const high = makePanel(container);
        const mid = makePanel(container);

        actionPanelSort.registerPanel(low, '/actions/low');
        actionPanelSort.updateMaxProduceable(low, 3);
        actionPanelSort.registerPanel(high, '/actions/high');
        actionPanelSort.updateMaxProduceable(high, 50);
        actionPanelSort.registerPanel(mid, '/actions/mid');
        actionPanelSort.updateMaxProduceable(mid, 10);

        actionPanelSort.setSortMode('craftable');
        actionPanelSort.sortPanelsByProfit();

        expect(Array.from(container.children)).toEqual([high, mid, low]);
    });

    test('sorts panels with no craftable count (e.g. gathering actions) to the bottom', () => {
        const gathering = makePanel(container);
        const production = makePanel(container);

        actionPanelSort.registerPanel(gathering, '/actions/gather');
        // Gathering actions never call updateMaxProduceable - maxProduceable stays null.
        actionPanelSort.registerPanel(production, '/actions/craft');
        actionPanelSort.updateMaxProduceable(production, 5);

        actionPanelSort.setSortMode('craftable');
        actionPanelSort.sortPanelsByProfit();

        expect(Array.from(container.children)).toEqual([production, gathering]);
    });

    test('pinned actions still sort before everything else, even with a lower craftable count', () => {
        const pinned = makePanel(container);
        const unpinned = makePanel(container);

        actionPanelSort.registerPanel(pinned, '/actions/pinned');
        actionPanelSort.updateMaxProduceable(pinned, 1);
        actionPanelSort.registerPanel(unpinned, '/actions/unpinned');
        actionPanelSort.updateMaxProduceable(unpinned, 100);

        return actionPanelSort.togglePin('/actions/pinned').then(() => {
            actionPanelSort.setSortMode('craftable');
            actionPanelSort.sortPanelsByProfit();

            expect(Array.from(container.children)).toEqual([pinned, unpinned]);
        });
    });
});
