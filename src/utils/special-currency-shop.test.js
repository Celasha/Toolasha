import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ gameData: null }));

vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData) },
}));

import {
    getAllSpecialCurrencyShopEntries,
    getShopEntriesForCurrency,
    findShopPurchaseInfo,
} from './special-currency-shop.js';

function resetGameData() {
    mocks.gameData = {
        itemDetailMap: {
            '/items/task_crystal': { isOpenable: false },
            '/items/large_artisans_crate': { isOpenable: true },
            '/items/pathbreaker_lodestone': { isOpenable: false },
            '/items/chimerical_quiver': { isOpenable: false },
        },
        shopItemDetailMap: {
            '/shop_items/chimerical_quiver': {
                itemHrid: '/items/chimerical_quiver',
                costs: [{ itemHrid: '/items/chimerical_token', count: 35000 }],
            },
            '/shop_items/coin_only_item': {
                itemHrid: '/items/some_coin_item',
                costs: [{ itemHrid: '/items/coin', count: 100 }],
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

describe('special-currency-shop - TLA041E-11/12/17/26: generic shop-map normalization', () => {
    beforeEach(resetGameData);

    test('merges dungeon/task/labyrinth shop maps into one normalized entry list, excluding coin-cost shop items', () => {
        const entries = getAllSpecialCurrencyShopEntries();
        const hrids = entries.map((e) => e.itemHrid);
        expect(hrids).toContain('/items/chimerical_quiver');
        expect(hrids).toContain('/items/task_crystal');
        expect(hrids).toContain('/items/labyrinth_essence');
        expect(hrids).toContain('/items/pathbreaker_lodestone');
        expect(hrids).not.toContain('/items/some_coin_item'); // coin-cost shop items are not special-currency
    });

    test('outputCount defaults to 1 when the shop entry omits it, and is honored when present (TLA041E-12)', () => {
        const entries = getAllSpecialCurrencyShopEntries();
        const essence = entries.find((e) => e.itemHrid === '/items/labyrinth_essence');
        const crystal = entries.find((e) => e.itemHrid === '/items/task_crystal');
        expect(essence.outputCount).toBe(10);
        expect(crystal.outputCount).toBe(1);
    });

    test('isOpenable is read from itemDetailMap for openable Task Shop crates', () => {
        const entries = getAllSpecialCurrencyShopEntries();
        const crate = entries.find((e) => e.itemHrid === '/items/large_artisans_crate');
        const crystal = entries.find((e) => e.itemHrid === '/items/task_crystal');
        expect(crate.isOpenable).toBe(true);
        expect(crystal.isOpenable).toBe(false);
    });

    test('getShopEntriesForCurrency filters by currency across all three shop maps', () => {
        const labyrinthEntries = getShopEntriesForCurrency('/items/labyrinth_token');
        expect(labyrinthEntries.map((e) => e.itemHrid).sort()).toEqual([
            '/items/labyrinth_essence',
            '/items/pathbreaker_lodestone',
        ]);
    });

    test("findShopPurchaseInfo resolves an item's own official special-currency purchase", () => {
        expect(findShopPurchaseInfo('/items/pathbreaker_lodestone')).toEqual({
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 1000,
            outputCount: 1,
        });
    });

    test('findShopPurchaseInfo returns null for a crafted (non-shop-purchased) item', () => {
        expect(findShopPurchaseInfo('/items/expert_task_badge')).toBeNull();
    });

    test('malformed/missing shop cost entries are skipped, never fabricated (TLA041E-17)', () => {
        mocks.gameData.taskShopItemDetailMap['/task_shop_items/broken'] = {
            itemHrid: '/items/broken_item',
            cost: null,
        };
        mocks.gameData.labyrinthShopItemDetailMap['/labyrinth_shop_items/broken'] = {
            itemHrid: '/items/broken_labyrinth_item',
            cost: { itemHrid: '/items/labyrinth_token', count: 0 },
        };
        const entries = getAllSpecialCurrencyShopEntries();
        expect(entries.some((e) => e.itemHrid === '/items/broken_item')).toBe(false);
        expect(entries.some((e) => e.itemHrid === '/items/broken_labyrinth_item')).toBe(false);
    });

    test('no game data yields an empty entry list, never a crash', () => {
        mocks.gameData = null;
        expect(getAllSpecialCurrencyShopEntries()).toEqual([]);
        expect(findShopPurchaseInfo('/items/task_crystal')).toBeNull();
    });
});
