/**
 * Tests for Shop Max Buy Helper: resolving a buy modal's cost line(s) to item hrids and
 * computing the max affordable quantity.
 */

/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetInventory, mockGetItemHridFromName } = vi.hoisted(() => ({
    mockGetInventory: vi.fn(),
    mockGetItemHridFromName: vi.fn(),
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInventory: mockGetInventory,
    },
}));

vi.mock('./game-lookups.js', () => ({
    getItemHridFromName: mockGetItemHridFromName,
}));

import { resolveCostLines, computeMaxAffordable } from './shop-max-buy.js';

function inventoryItem(itemHrid, count, enhancementLevel = 0) {
    return { itemHrid, count, enhancementLevel, itemLocationHrid: '/item_locations/inventory' };
}

function buildModal({ inputHtml = '<input type="number" value="1">', costHtml }) {
    document.body.innerHTML = `
        <div class="TasksPanel_inputContainer__1DTU-">
            ${inputHtml}
            <div class="TasksPanel_error__32YiV"></div>
        </div>
        <div class="None">${costHtml}</div>
    `;
    return document.querySelector('[class*="inputContainer"]');
}

describe('resolveCostLines - icon style', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('resolves a single-currency cost row via the icon href fragment', () => {
        const inputContainer = buildModal({
            costHtml: `You Pay: 50<svg><use href="/static/media/items_sprite.abc.svg#task_token"></use></svg>`,
        });

        const lines = resolveCostLines(inputContainer, 'icon');

        expect(lines).toEqual([{ itemHrid: '/items/task_token', perUnitAmount: 50 }]);
    });

    test('parses locale-formatted thousands separators in the amount', () => {
        const inputContainer = buildModal({
            costHtml: `You Pay: 5,000<svg><use href="/static/media/items_sprite.abc.svg#coin"></use></svg>`,
        });

        const lines = resolveCostLines(inputContainer, 'icon');

        expect(lines).toEqual([{ itemHrid: '/items/coin', perUnitAmount: 5000 }]);
    });

    test('resolves two cost lines when a purchase requires multiple currencies', () => {
        const inputContainer = buildModal({
            costHtml: `
                <div>You Pay: 50<svg><use href="/static/media/items_sprite.abc.svg#task_token"></use></svg></div>
                <div>You Pay: 10<svg><use href="/static/media/items_sprite.abc.svg#labyrinth_token"></use></svg></div>
            `,
        });

        const lines = resolveCostLines(inputContainer, 'icon');

        expect(lines).toEqual([
            { itemHrid: '/items/task_token', perUnitAmount: 50 },
            { itemHrid: '/items/labyrinth_token', perUnitAmount: 10 },
        ]);
    });

    test('ignores a digit-bearing descriptive row that has no icon (e.g. "Grants: 7 days of MooPass")', () => {
        const inputContainer = buildModal({
            costHtml: `
                <div>You Pay: 250<svg><use href="/static/media/items_sprite.abc.svg#cowbell"></use></svg></div>
                <div>Grants: 7 days of MooPass</div>
            `,
        });

        const lines = resolveCostLines(inputContainer, 'icon');

        expect(lines).toEqual([{ itemHrid: '/items/cowbell', perUnitAmount: 250 }]);
    });

    test('returns an empty array when the cost row has no icon at all', () => {
        const inputContainer = buildModal({ costHtml: `You Pay: 50` });

        const lines = resolveCostLines(inputContainer, 'icon');

        expect(lines).toEqual([]);
    });

    test('returns an empty array when there is no next sibling to the input container', () => {
        document.body.innerHTML = `<div class="TasksPanel_inputContainer__1DTU-"></div>`;
        const inputContainer = document.querySelector('[class*="inputContainer"]');

        expect(resolveCostLines(inputContainer, 'icon')).toEqual([]);
    });
});

describe('resolveCostLines - text style', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('resolves currency name text after the amount via getItemHridFromName', () => {
        mockGetItemHridFromName.mockReturnValue('/items/coin');
        const inputContainer = buildModal({ costHtml: `You Pay: 5,000 Coin` });

        const lines = resolveCostLines(inputContainer, 'text');

        expect(mockGetItemHridFromName).toHaveBeenCalledWith('Coin');
        expect(lines).toEqual([{ itemHrid: '/items/coin', perUnitAmount: 5000 }]);
    });

    test('resolves a multi-word localized item name', () => {
        mockGetItemHridFromName.mockReturnValue('/items/chimerical_token');
        const inputContainer = buildModal({ costHtml: `You Pay: 1 Chimerical Token` });

        const lines = resolveCostLines(inputContainer, 'text');

        expect(mockGetItemHridFromName).toHaveBeenCalledWith('Chimerical Token');
        expect(lines).toEqual([{ itemHrid: '/items/chimerical_token', perUnitAmount: 1 }]);
    });

    test('drops a row whose trailing text does not resolve to a known item', () => {
        mockGetItemHridFromName.mockReturnValue(null);
        const inputContainer = buildModal({ costHtml: `You Pay: 5,000 Unknown Thing` });

        const lines = resolveCostLines(inputContainer, 'text');

        expect(lines).toEqual([]);
    });
});

describe('computeMaxAffordable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns null for an empty cost-line list', () => {
        expect(computeMaxAffordable([])).toBeNull();
    });

    test('computes floor(owned / perUnitAmount) for a single currency', () => {
        mockGetInventory.mockReturnValue([inventoryItem('/items/task_token', 230)]);

        const max = computeMaxAffordable([{ itemHrid: '/items/task_token', perUnitAmount: 50 }]);

        expect(max).toBe(4);
    });

    test('sums owned count across enhancement levels', () => {
        mockGetInventory.mockReturnValue([
            inventoryItem('/items/task_token', 20, 0),
            inventoryItem('/items/task_token', 30, 5),
        ]);

        const max = computeMaxAffordable([{ itemHrid: '/items/task_token', perUnitAmount: 10 }]);

        expect(max).toBe(5);
    });

    test('takes the min across multiple required currencies', () => {
        mockGetInventory.mockReturnValue([
            inventoryItem('/items/task_token', 500),
            inventoryItem('/items/labyrinth_token', 15),
        ]);

        const max = computeMaxAffordable([
            { itemHrid: '/items/task_token', perUnitAmount: 50 },
            { itemHrid: '/items/labyrinth_token', perUnitAmount: 10 },
        ]);

        expect(max).toBe(1);
    });

    test('returns null when the player cannot afford even a single unit', () => {
        mockGetInventory.mockReturnValue([inventoryItem('/items/task_token', 10)]);

        const max = computeMaxAffordable([{ itemHrid: '/items/task_token', perUnitAmount: 50 }]);

        expect(max).toBeNull();
    });

    test('returns null when inventory is unavailable', () => {
        mockGetInventory.mockReturnValue(null);

        const max = computeMaxAffordable([{ itemHrid: '/items/task_token', perUnitAmount: 50 }]);

        expect(max).toBeNull();
    });

    test('ignores items held outside the inventory location (e.g. equipped)', () => {
        mockGetInventory.mockReturnValue([
            { itemHrid: '/items/task_token', count: 999, itemLocationHrid: '/item_locations/head' },
        ]);

        const max = computeMaxAffordable([{ itemHrid: '/items/task_token', perUnitAmount: 1 }]);

        expect(max).toBeNull();
    });
});
