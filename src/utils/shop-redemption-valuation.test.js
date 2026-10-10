import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: null,
    getItemPriceOutlierInfo: vi.fn(),
    getSettingValue: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
    default: { getSettingValue: (...args) => mocks.getSettingValue(...args) },
}));
vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData) },
}));
vi.mock('./market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));

// 特意不 mock token-valuation / special-currency-shop：真实模块 + 可控 gameData 做轻集成
import { resolveShopRedemptionValue } from './shop-redemption-valuation.js';

function resetGameData() {
    mocks.gameData = {
        itemDetailMap: {
            '/items/seal_of_efficiency': { isOpenable: false, isTradable: false },
            '/items/chimerical_quiver': { isOpenable: false, isTradable: false },
            '/items/labyrinth_essence': { isOpenable: false },
            '/items/pathbreaker_lodestone': { isOpenable: false },
            '/items/weapon_a': { isOpenable: false },
            '/items/weapon_b': { isOpenable: false },
        },
        shopItemDetailMap: {
            '/shop_items/weapon_a': {
                itemHrid: '/items/weapon_a',
                costs: [{ itemHrid: '/items/chimerical_token', count: 10 }],
            },
            '/shop_items/weapon_b': {
                itemHrid: '/items/weapon_b',
                costs: [{ itemHrid: '/items/chimerical_token', count: 5 }],
            },
            '/shop_items/chimerical_quiver': {
                itemHrid: '/items/chimerical_quiver',
                costs: [{ itemHrid: '/items/chimerical_token', count: 35000 }],
            },
        },
        labyrinthShopItemDetailMap: {
            '/labyrinth_shop_items/seal_of_efficiency': {
                itemHrid: '/items/seal_of_efficiency',
                cost: { itemHrid: '/items/labyrinth_token', count: 30 },
                outputCount: 1,
            },
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

beforeEach(() => {
    vi.clearAllMocks();
    resetGameData();
    mocks.getSettingValue.mockImplementation((_key, fallback) => fallback);
    // 默认全部无价，各用例自行覆盖
    mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });
});

describe('resolveShopRedemptionValue', () => {
    test('values a seal via its labyrinth-token redemption chain (best redemption wins)', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/labyrinth_essence') return { value: 100, isOutlier: false }; // 100×10/1 = 1000/token
            if (itemHrid === '/items/pathbreaker_lodestone') return { value: 50000, isOutlier: false }; // 50000/1000 = 50/token
            return { value: null, isOutlier: false };
        });

        const result = resolveShopRedemptionValue('/items/seal_of_efficiency');

        expect(result).toEqual({
            value: 30000, // 30 tokens × 1000/token ÷ outputCount 1
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });
    });

    test('honors outputCount when dividing the implied per-unit value', () => {
        mocks.gameData.labyrinthShopItemDetailMap['/labyrinth_shop_items/seal_of_efficiency'].outputCount = 2;
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) =>
            itemHrid === '/items/labyrinth_essence'
                ? { value: 100, isOutlier: false }
                : { value: null, isOutlier: false }
        );

        const result = resolveShopRedemptionValue('/items/seal_of_efficiency');

        expect(result.value).toBe(15000); // 30 × 1000 ÷ 2
        expect(result.outputCount).toBe(2);
    });

    test('prices dungeon-token shop items via the existing calculateDungeonTokenValue chain', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/weapon_a') return { value: 100, isOutlier: false }; // 100/10 = 10/token
            if (itemHrid === '/items/weapon_b') return { value: 100, isOutlier: false }; // 100/5 = 20/token (best)
            return { value: null, isOutlier: false };
        });

        const result = resolveShopRedemptionValue('/items/chimerical_quiver');

        expect(result).toMatchObject({ value: 700000, currencyHrid: '/items/chimerical_token', tokenCost: 35000 }); // 20 × 35000
    });

    test('propagates the outlier flag from the winning redemption', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) =>
            itemHrid === '/items/labyrinth_essence'
                ? { value: 100, isOutlier: true }
                : { value: null, isOutlier: false }
        );

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency').isOutlier).toBe(true);
    });

    test('uses the bid side in conservative mode and the ask side in hybrid mode', () => {
        mocks.getSettingValue.mockImplementation((key, fallback) =>
            key === 'profitCalc_pricingMode' ? 'conservative' : fallback
        );
        mocks.getItemPriceOutlierInfo.mockImplementation((_itemHrid, opts) => {
            expect(opts.mode).toBe('bid');
            return { value: null, isOutlier: false };
        });
        resolveShopRedemptionValue('/items/seal_of_efficiency');

        mocks.getSettingValue.mockImplementation((key, fallback) =>
            key === 'profitCalc_pricingMode' ? 'hybrid' : fallback
        );
        mocks.getItemPriceOutlierInfo.mockClear();
        mocks.getItemPriceOutlierInfo.mockImplementation((_itemHrid, opts) => {
            expect(opts.mode).toBe('ask');
            return { value: null, isOutlier: false };
        });
        resolveShopRedemptionValue('/items/seal_of_efficiency');
        expect(mocks.getItemPriceOutlierInfo).toHaveBeenCalled();
    });

    test('returns null for an item with no official shop purchase', () => {
        expect(resolveShopRedemptionValue('/items/not_in_any_shop')).toBeNull();
    });

    test('returns null when every redemption target of the currency is unpriced', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency')).toBeNull();
    });

    test('returns null when game data is unavailable', () => {
        mocks.gameData = null;

        expect(resolveShopRedemptionValue('/items/seal_of_efficiency')).toBeNull();
    });
});
