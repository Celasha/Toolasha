import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: null,
    askPrices: {}, // itemHrid -> ask
    ev: {}, // itemHrid -> expectedValue
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData) },
}));

vi.mock('../../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => mocks.askPrices[itemHrid] ?? -1),
}));

vi.mock('../../market/expected-value-calculator.js', () => ({
    default: {
        calculateExpectedValue: vi.fn((itemHrid) =>
            mocks.ev[itemHrid] != null ? { expectedValue: mocks.ev[itemHrid] } : null
        ),
    },
}));

import { getCurrencyOpportunityValue, getSpecialCurrencyAcquisitionCost } from './special-currency-valuation.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';

function createContext() {
    return { opportunityCache: new Map() };
}

function resetMocks() {
    mocks.askPrices = {};
    mocks.ev = {};
    mocks.gameData = {
        itemDetailMap: {
            '/items/task_crystal': { isOpenable: false },
            '/items/large_artisans_crate': { isOpenable: true },
            '/items/large_meteorite_cache': { isOpenable: true },
            '/items/pathbreaker_lodestone': { isOpenable: false },
            '/items/labyrinth_essence': { isOpenable: false },
        },
        shopItemDetailMap: {},
        taskShopItemDetailMap: {
            '/task_shop_items/task_crystal': {
                itemHrid: '/items/task_crystal',
                cost: { itemHrid: '/items/task_token', count: 50 },
            },
            '/task_shop_items/large_artisans_crate': {
                itemHrid: '/items/large_artisans_crate',
                cost: { itemHrid: '/items/task_token', count: 30 },
            },
            '/task_shop_items/large_meteorite_cache': {
                itemHrid: '/items/large_meteorite_cache',
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
    expectedValueCalculator.calculateExpectedValue.mockClear();
}

describe('getCurrencyOpportunityValue - TLA041E-02/03/04/18', () => {
    beforeEach(resetMocks);

    test('TLA041E-02: a valid Task Crystal Ask contributes Ask/50 Gold/Task Token', () => {
        mocks.askPrices['/items/task_crystal'] = 5000; // 5000/50 = 100/token
        const result = getCurrencyOpportunityValue('/items/task_token', createContext());
        expect(result).toEqual({ value: 100, complete: true });
    });

    test('TLA041E-03: with no Task Crystal Ask, a priceable openable EV anchors the opportunity value', () => {
        mocks.ev['/items/large_artisans_crate'] = 900; // 900/30 = 30/token
        const result = getCurrencyOpportunityValue('/items/task_token', createContext());
        expect(result).toEqual({ value: 30, complete: true });
    });

    test('TLA041E-04: opportunity value is the MAXIMUM independently-priced shop use, not the first found', () => {
        mocks.askPrices['/items/task_crystal'] = 5000; // 100/token
        mocks.ev['/items/large_artisans_crate'] = 6000; // 200/token - higher, must win
        const result = getCurrencyOpportunityValue('/items/task_token', createContext());
        expect(result).toEqual({ value: 200, complete: true });
    });

    test('an openable whose Ask beats its own EV still only contributes once, at the higher of the two', () => {
        mocks.askPrices['/items/large_artisans_crate'] = 12000; // 400/token, Ask side
        mocks.ev['/items/large_artisans_crate'] = 3000; // 100/token, EV side (lower)
        const result = getCurrencyOpportunityValue('/items/task_token', createContext());
        expect(result).toEqual({ value: 400, complete: true });
    });

    test('TLA041E-12: Labyrinth Essence outputCount (10) is honored - 0.1 token/essence before conversion', () => {
        mocks.askPrices['/items/labyrinth_essence'] = 1; // 1 * 10 / 1 = 10/token
        mocks.askPrices['/items/pathbreaker_lodestone'] = 5000; // 5000 * 1 / 1000 = 5/token
        const result = getCurrencyOpportunityValue('/items/labyrinth_token', createContext());
        expect(result).toEqual({ value: 10, complete: true }); // essence wins over lodestone
    });

    test('TLA041E-18: no independently-priced shop alternative anywhere -> opportunity remains unavailable, never zero/fabricated', () => {
        const result = getCurrencyOpportunityValue('/items/task_token', createContext());
        expect(result).toEqual({ value: null, complete: false });
    });

    test('TLA041E-28/29: opportunity value and EV are each computed once per currency per context, even if requested repeatedly', () => {
        mocks.ev['/items/large_artisans_crate'] = 900;
        const context = createContext();
        getCurrencyOpportunityValue('/items/task_token', context);
        getCurrencyOpportunityValue('/items/task_token', context);
        getCurrencyOpportunityValue('/items/task_token', context);
        expect(expectedValueCalculator.calculateExpectedValue).toHaveBeenCalledTimes(2); // 2 openables in the fixture shop, scanned once
    });

    test('a currency with no shop entries at all resolves to unavailable, never a crash', () => {
        const result = getCurrencyOpportunityValue('/items/nonexistent_token', createContext());
        expect(result).toEqual({ value: null, complete: false });
    });
});

describe('getSpecialCurrencyAcquisitionCost - TLA041E-06', () => {
    beforeEach(resetMocks);

    test('an item purchasable via special currency prices at opportunityValue * tokenCost / outputCount', () => {
        // Opportunity value for labyrinth_token is anchored by Essence's Ask (a DIFFERENT item),
        // never by Lodestone's own token-derived value - no self-referential circularity.
        mocks.askPrices['/items/labyrinth_essence'] = 2; // 2 * 10 / 1 = 20/token opportunity value
        const context = createContext();
        const result = getSpecialCurrencyAcquisitionCost('/items/pathbreaker_lodestone', context);
        // Lodestone's own shop cost is 1000 tokens, outputCount 1 -> 20 * 1000 / 1 = 20,000
        expect(result).toEqual({ cost: 20_000, complete: true });
    });

    test('an item not purchasable via any special currency shop is incomplete, not zero', () => {
        const result = getSpecialCurrencyAcquisitionCost('/items/expert_task_badge', createContext());
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('a purchasable item with an unpriceable currency opportunity value is incomplete, not zero', () => {
        // No Ask/EV anywhere in the shop -> opportunity value unavailable for task_token.
        const result = getSpecialCurrencyAcquisitionCost('/items/task_crystal', createContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});
