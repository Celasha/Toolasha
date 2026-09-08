import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: null,
    askPrices: {}, // itemHrid -> {ask, bid}
    ev: {}, // itemHrid -> expectedValue
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData), getItemDetails: vi.fn(() => null) },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: vi.fn((itemHrid) => mocks.askPrices[itemHrid] ?? null),
    getItemPrice: vi.fn((itemHrid) => mocks.askPrices[itemHrid]?.ask ?? -1),
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: {
        calculateExpectedValue: vi.fn((itemHrid) =>
            mocks.ev[itemHrid] != null ? { expectedValue: mocks.ev[itemHrid] } : null
        ),
    },
}));

import { dungeonTokenTooltips } from './dungeon-token-tooltips.js';
import { getCurrencyOpportunityValue } from '../profile/score/special-currency-valuation.js';

function resetMocks() {
    mocks.askPrices = {};
    mocks.ev = {};
    mocks.gameData = {
        itemDetailMap: {
            '/items/task_crystal': { name: 'Task Crystal', isOpenable: false },
            '/items/large_artisans_crate': { name: "Large Artisan's Crate", isOpenable: true },
            '/items/griffin_leather': { name: 'Griffin Leather', isOpenable: false },
            '/items/manticore_sting': { name: 'Manticore Sting', isOpenable: false },
            '/items/labyrinth_essence': { name: 'Labyrinth Essence', isOpenable: false },
            '/items/pathbreaker_lodestone': { name: 'Pathbreaker Lodestone', isOpenable: false },
        },
        shopItemDetailMap: {
            '/shop_items/griffin_leather': {
                itemHrid: '/items/griffin_leather',
                costs: [{ itemHrid: '/items/chimerical_token', count: 600 }],
            },
            '/shop_items/manticore_sting': {
                itemHrid: '/items/manticore_sting',
                costs: [{ itemHrid: '/items/chimerical_token', count: 1000 }],
            },
        },
        taskShopItemDetailMap: {
            '/task_shop_items/task_crystal': {
                itemHrid: '/items/task_crystal',
                cost: { itemHrid: '/items/task_token', count: 50 },
            },
            '/task_shop_items/large_artisans_crate': {
                itemHrid: '/items/large_artisans_crate',
                cost: { itemHrid: '/items/task_token', count: 30 },
            },
        },
        labyrinthShopItemDetailMap: {
            '/labyrinth_shop_items/labyrinth_essence': {
                itemHrid: '/items/labyrinth_essence',
                cost: { itemHrid: '/items/labyrinth_token', count: 1 },
                outputCount: 10,
            },
            '/labyrinth_shop_items/pathbreaker_lodestone': {
                itemHrid: '/items/pathbreaker_lodestone',
                cost: { itemHrid: '/items/labyrinth_token', count: 1000 },
                outputCount: 1,
            },
        },
    };
}

describe('TLA041E-25: shared special-currency valuation stays consistent with the Token Tooltip formula', () => {
    beforeEach(resetMocks);

    test('dungeon token: tooltip best Gold/Token matches the shared opportunity-value formula', () => {
        mocks.askPrices['/items/griffin_leather'] = { ask: 600, bid: 500 }; // 1 gold/token
        mocks.askPrices['/items/manticore_sting'] = { ask: 3000, bid: 2900 }; // 3 gold/token, best

        const shopItems = dungeonTokenTooltips._getDungeonShopItems('/items/chimerical_token');
        const tooltipBest = shopItems[0].goldPerToken;

        const shared = getCurrencyOpportunityValue('/items/chimerical_token', { opportunityCache: new Map() });

        expect(tooltipBest).toBe(3);
        expect(shared).toEqual({ value: 3, complete: true });
    });

    test('task token (openable EV path): tooltip best Gold/Token matches the shared opportunity-value formula', () => {
        mocks.askPrices['/items/task_crystal'] = { ask: 5000, bid: 4900 }; // 100 gold/token
        mocks.ev['/items/large_artisans_crate'] = 6000; // 200 gold/token, best

        const shopItems = dungeonTokenTooltips._getTaskShopItems();
        const tooltipBest = shopItems[0].goldPerToken;

        const shared = getCurrencyOpportunityValue('/items/task_token', { opportunityCache: new Map() });

        expect(tooltipBest).toBe(200);
        expect(shared).toEqual({ value: 200, complete: true });
    });

    test('labyrinth token (outputCount-aware): tooltip best Gold/Token matches the shared opportunity-value formula', () => {
        mocks.askPrices['/items/labyrinth_essence'] = { ask: 2, bid: 1 }; // 2 * 10 / 1 = 20 gold/token
        mocks.askPrices['/items/pathbreaker_lodestone'] = { ask: 5000, bid: 4000 }; // 5000 * 1 / 1000 = 5 gold/token

        const shopItems = dungeonTokenTooltips._getLabyrinthShopItems();
        const tooltipBest = shopItems[0].goldPerToken;

        const shared = getCurrencyOpportunityValue('/items/labyrinth_token', { opportunityCache: new Map() });

        expect(tooltipBest).toBe(20);
        expect(shared).toEqual({ value: 20, complete: true });
    });
});
