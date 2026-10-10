// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockGetItemPrice,
    mockGetItemPriceOutlierInfo,
    mockCalculateDungeonTokenValue,
    mockGetInitClientData,
    mockGetItemDetails,
    mockGetSetting,
    mockGetCustomPrice,
    mockResolveShopRedemptionValue,
} = vi.hoisted(() => {
    const getItemPrice = vi.fn();
    return {
        mockGetItemPrice: getItemPrice,
        mockGetItemPriceOutlierInfo: vi.fn((hrid, opts) => ({ value: getItemPrice(hrid, opts), isOutlier: false })),
        mockCalculateDungeonTokenValue: vi.fn(),
        mockGetInitClientData: vi.fn(),
        mockGetItemDetails: vi.fn(),
        mockGetSetting: vi.fn(() => true),
        mockGetCustomPrice: vi.fn(() => null),
        mockResolveShopRedemptionValue: vi.fn(),
    };
});

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: mockGetItemPrice,
    getItemPriceOutlierInfo: mockGetItemPriceOutlierInfo,
}));
vi.mock('../../utils/token-valuation.js', () => ({ calculateDungeonTokenValue: mockCalculateDungeonTokenValue }));
vi.mock('../../utils/shop-redemption-valuation.js', () => ({
    resolveShopRedemptionValue: mockResolveShopRedemptionValue,
}));
vi.mock('../../core/config.js', () => ({ default: { getSetting: mockGetSetting } }));
vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: mockGetInitClientData, getItemDetails: mockGetItemDetails },
}));
vi.mock('../settings/custom-price-overrides.js', () => ({ getCustomPrice: mockGetCustomPrice }));

import expectedValueCalculator from './expected-value-calculator.js';

describe('resolveSellSideValue', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockCalculateDungeonTokenValue.mockReset();
        mockGetSetting.mockReset().mockReturnValue(true);
        mockGetCustomPrice.mockReset().mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReset();
        expectedValueCalculator.containerCache.clear();
    });

    test('Coin resolves to face value 1, never taxed', () => {
        expect(expectedValueCalculator.resolveSellSideValue('/items/coin')).toEqual({
            value: 1,
            source: 'coin',
            needsTax: false,
            isOutlier: false,
        });
    });

    test('Cowbell resolves to bag sell price / 10 after 18% tax, never taxed again by caller', () => {
        mockGetItemPrice.mockReturnValue(100);
        const result = expectedValueCalculator.resolveSellSideValue('/items/cowbell');
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/bag_of_10_cowbells', { context: 'profit', side: 'sell' });
        expect(result).toEqual({ value: 8.2, source: 'cowbell', needsTax: false, isOutlier: false });
    });

    test('Cowbell resolves to 0 when the include-cowbells setting is off', () => {
        mockGetSetting.mockReturnValue(false);
        expect(expectedValueCalculator.resolveSellSideValue('/items/cowbell')).toEqual({
            value: 0,
            source: 'cowbell',
            needsTax: false,
            isOutlier: false,
        });
    });

    test('Cowbell resolves to null when no bag price is available', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.resolveSellSideValue('/items/cowbell')).toBeNull();
    });

    test('dungeon tokens resolve via calculateDungeonTokenValue, never taxed', () => {
        mockCalculateDungeonTokenValue.mockReturnValue({ value: 42, isOutlier: false });
        const result = expectedValueCalculator.resolveSellSideValue('/items/chimerical_token');
        expect(mockCalculateDungeonTokenValue).toHaveBeenCalledWith(
            '/items/chimerical_token',
            'profitCalc_pricingMode',
            'expectedValue_respectPricingMode'
        );
        expect(result).toEqual({ value: 42, source: 'dungeonToken', needsTax: false, isOutlier: false });
    });

    test('dungeon tokens surface isOutlier when the winning shop item price was substituted', () => {
        mockCalculateDungeonTokenValue.mockReturnValue({ value: 42, isOutlier: true });
        const result = expectedValueCalculator.resolveSellSideValue('/items/chimerical_token');
        expect(result).toEqual({ value: 42, source: 'dungeonToken', needsTax: false, isOutlier: true });
    });

    test('dungeon tokens resolve to null when the shop value is unavailable', () => {
        mockCalculateDungeonTokenValue.mockReturnValue(null);
        expect(expectedValueCalculator.resolveSellSideValue('/items/chimerical_token')).toBeNull();
    });

    test('a cached container EV wins over ordinary market pricing, never taxed again', () => {
        expectedValueCalculator.containerCache.set('/items/large_treasure_chest', 12345);
        const result = expectedValueCalculator.resolveSellSideValue('/items/large_treasure_chest');
        expect(result).toEqual({ value: 12345, source: 'expectedValue', needsTax: false, isOutlier: false });
        expect(mockGetItemPrice).not.toHaveBeenCalled();
    });

    test('ordinary market item resolves via getItemPrice sell side and needs tax applied by caller', () => {
        mockGetItemPrice.mockReturnValue(500);
        const result = expectedValueCalculator.resolveSellSideValue('/items/cheese', 3);
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/cheese', {
            enhancementLevel: 3,
            context: 'profit',
            side: 'sell',
        });
        expect(result).toEqual({ value: 500, source: 'market', needsTax: true, isOutlier: false });
    });

    test('ordinary market item resolves to null when no price is available', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.resolveSellSideValue('/items/unpriced')).toBeNull();
    });

    test('a custom price override is labeled as such and still taxed like any other market value', () => {
        mockGetItemPrice.mockReturnValue(777);
        mockGetCustomPrice.mockReturnValue(777);
        const result = expectedValueCalculator.resolveSellSideValue('/items/cheese', 2);
        expect(mockGetCustomPrice).toHaveBeenCalledWith('/items/cheese', 2, 'sell');
        expect(result).toEqual({ value: 777, source: 'custom', needsTax: true, isOutlier: false });
    });

    test('an unpriced item stays null by default and never consults the redemption chain', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency')).toBeNull();
        expect(mockResolveShopRedemptionValue).not.toHaveBeenCalled();
    });

    test('allowIndirect resolves an unpriced shop-redeemable item as shopRedemption, never taxed', () => {
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        expect(
            expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency', 0, { allowIndirect: true })
        ).toEqual({ value: 30000, source: 'shopRedemption', needsTax: false, isOutlier: false });
    });

    test('allowIndirect propagates the outlier flag from the redemption chain', () => {
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: true,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        expect(
            expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency', 0, { allowIndirect: true })
        ).toEqual({ value: 30000, source: 'shopRedemption', needsTax: false, isOutlier: true });
    });

    test('allowIndirect still returns null when the redemption chain cannot price the currency', () => {
        mockGetItemPrice.mockReturnValue(null);
        mockResolveShopRedemptionValue.mockReturnValue(null);

        expect(
            expectedValueCalculator.resolveSellSideValue('/items/seal_of_efficiency', 0, { allowIndirect: true })
        ).toBeNull();
    });

    test('a direct market price wins and the redemption chain is not consulted', () => {
        mockGetItemPrice.mockReturnValue(123);
        mockResolveShopRedemptionValue.mockReturnValue({
            value: 30000,
            isOutlier: false,
            currencyHrid: '/items/labyrinth_token',
            tokenCost: 30,
            outputCount: 1,
        });

        const result = expectedValueCalculator.resolveSellSideValue('/items/some_item', 0, { allowIndirect: true });

        expect(result.source).toBe('market');
        expect(mockResolveShopRedemptionValue).not.toHaveBeenCalled();
    });
});

describe('resolveBuySideValue', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockCalculateDungeonTokenValue.mockReset();
        mockGetSetting.mockReset().mockReturnValue(true);
        mockGetCustomPrice.mockReset().mockReturnValue(null);
        expectedValueCalculator.containerCache.clear();
    });

    test('Coin resolves to face value 1', () => {
        expect(expectedValueCalculator.resolveBuySideValue('/items/coin')).toEqual({
            value: 1,
            source: 'coin',
            isOutlier: false,
        });
    });

    test('Cowbell resolves to bag buy price / 10, never taxed', () => {
        mockGetItemPrice.mockReturnValue(100);
        const result = expectedValueCalculator.resolveBuySideValue('/items/cowbell');
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/bag_of_10_cowbells', { context: 'profit', side: 'buy' });
        expect(result).toEqual({ value: 10, source: 'cowbell', isOutlier: false });
    });

    test('dungeon tokens resolve via the same shop-derived value as the sell side', () => {
        mockCalculateDungeonTokenValue.mockReturnValue({ value: 42, isOutlier: false });
        expect(expectedValueCalculator.resolveBuySideValue('/items/pirate_token')).toEqual({
            value: 42,
            source: 'dungeonToken',
            isOutlier: false,
        });
    });

    test('dungeon tokens surface isOutlier on the buy side too', () => {
        mockCalculateDungeonTokenValue.mockReturnValue({ value: 42, isOutlier: true });
        expect(expectedValueCalculator.resolveBuySideValue('/items/pirate_token')).toEqual({
            value: 42,
            source: 'dungeonToken',
            isOutlier: true,
        });
    });

    test('a consumed openable container is valued at its ordinary buy price, not its cached EV', () => {
        expectedValueCalculator.containerCache.set('/items/large_treasure_chest', 12345);
        mockGetItemPrice.mockReturnValue(999);
        const result = expectedValueCalculator.resolveBuySideValue('/items/large_treasure_chest');
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/large_treasure_chest', {
            enhancementLevel: 0,
            context: 'profit',
            side: 'buy',
        });
        expect(result).toEqual({ value: 999, source: 'market', isOutlier: false });
    });

    test('ordinary market item resolves via getItemPrice buy side with enhancement level propagated', () => {
        mockGetItemPrice.mockReturnValue(250);
        const result = expectedValueCalculator.resolveBuySideValue('/items/sword', 5);
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/sword', {
            enhancementLevel: 5,
            context: 'profit',
            side: 'buy',
        });
        expect(result).toEqual({ value: 250, source: 'market', isOutlier: false });
    });

    test('resolves to null when no buy price is available', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.resolveBuySideValue('/items/unpriced')).toBeNull();
    });

    test('a custom price override is labeled as such', () => {
        mockGetItemPrice.mockReturnValue(300);
        mockGetCustomPrice.mockReturnValue(300);
        const result = expectedValueCalculator.resolveBuySideValue('/items/cheese', 1);
        expect(mockGetCustomPrice).toHaveBeenCalledWith('/items/cheese', 1, 'buy');
        expect(result).toEqual({ value: 300, source: 'custom', isOutlier: false });
    });
});

describe('getDropPrice regression (must match resolveSellSideValue().value exactly)', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockCalculateDungeonTokenValue.mockReset();
        mockGetSetting.mockReset().mockReturnValue(true);
        mockGetCustomPrice.mockReset().mockReturnValue(null);
        expectedValueCalculator.containerCache.clear();
    });

    test('Coin', () => {
        expect(expectedValueCalculator.getDropPrice('/items/coin')).toBe(1);
    });

    test('Cowbell', () => {
        mockGetItemPrice.mockReturnValue(100);
        expect(expectedValueCalculator.getDropPrice('/items/cowbell')).toBeCloseTo(8.2);
    });

    test('dungeon token', () => {
        mockCalculateDungeonTokenValue.mockReturnValue({ value: 7, isOutlier: false });
        expect(expectedValueCalculator.getDropPrice('/items/sinister_token')).toBe(7);
    });

    test('cached container', () => {
        expectedValueCalculator.containerCache.set('/items/large_meteorite_cache', 555);
        expect(expectedValueCalculator.getDropPrice('/items/large_meteorite_cache')).toBe(555);
    });

    test('ordinary market item', () => {
        mockGetItemPrice.mockReturnValue(321);
        expect(expectedValueCalculator.getDropPrice('/items/log')).toBe(321);
    });

    test('unresolvable item returns null, not zero', () => {
        mockGetItemPrice.mockReturnValue(null);
        expect(expectedValueCalculator.getDropPrice('/items/unpriced')).toBeNull();
    });
});

describe('getDropBreakdown (regression - tax application unchanged by the resolveSellSideValue extraction)', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockGetInitClientData.mockReset();
        mockGetItemDetails.mockReset();
        mockGetCustomPrice.mockReset().mockReturnValue(null);
        expectedValueCalculator.containerCache.clear();
    });

    test('applies market tax to tradeable drops but not to Coin', () => {
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/test_chest': [
                    { itemHrid: '/items/coin', dropRate: 1, minCount: 100, maxCount: 100 },
                    { itemHrid: '/items/cheese', dropRate: 0.5, minCount: 10, maxCount: 10 },
                ],
            },
        });
        mockGetItemDetails.mockImplementation((hrid) => ({
            name: hrid,
            isTradable: hrid !== '/items/coin',
            isOpenable: false,
        }));
        mockGetItemPrice.mockImplementation((hrid) => (hrid === '/items/cheese' ? 100 : null));

        const drops = expectedValueCalculator.getDropBreakdown('/items/test_chest');

        const coinDrop = drops.find((d) => d.itemHrid === '/items/coin');
        const cheeseDrop = drops.find((d) => d.itemHrid === '/items/cheese');

        expect(coinDrop.expectedValue).toBe(100); // 100 * 1 * 1, no tax
        expect(cheeseDrop.expectedValue).toBeCloseTo(0.5 * 10 * 100 * 0.96); // MARKET_TAX = 0.04
    });

    test('marks a drop with no price data as having no price data rather than a fake value', () => {
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/test_chest': [{ itemHrid: '/items/unpriced', dropRate: 1, minCount: 1, maxCount: 1 }],
            },
        });
        mockGetItemDetails.mockReturnValue({ name: 'Unpriced', isTradable: true, isOpenable: false });
        mockGetItemPrice.mockReturnValue(null);

        const drops = expectedValueCalculator.getDropBreakdown('/items/test_chest');

        expect(drops[0].hasPriceData).toBe(false);
        expect(drops[0].expectedValue).toBe(0);
    });

    test('flags a drop with isOutlier when the market-data guard substituted its price', () => {
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/test_chest': [{ itemHrid: '/items/cheese', dropRate: 1, minCount: 1, maxCount: 1 }],
            },
        });
        mockGetItemDetails.mockReturnValue({ name: 'Cheese', isTradable: true, isOpenable: false });
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 100, isOutlier: true });

        const drops = expectedValueCalculator.getDropBreakdown('/items/test_chest');

        expect(drops[0].isOutlier).toBe(true);
    });
});

describe('getDropPriceInfo', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockGetItemPriceOutlierInfo.mockReset();
        expectedValueCalculator.containerCache.clear();
    });

    test('returns the resolved value and isOutlier flag together', () => {
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 42, isOutlier: true });
        expect(expectedValueCalculator.getDropPriceInfo('/items/cheese')).toEqual({ value: 42, isOutlier: true });
    });

    test('returns a null value with isOutlier false when the drop is unresolvable', () => {
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });
        expect(expectedValueCalculator.getDropPriceInfo('/items/unpriced')).toEqual({
            value: null,
            isOutlier: false,
        });
    });
});

describe('calculateExpectedValue hasOutlierPrices aggregate', () => {
    beforeEach(() => {
        mockGetItemPrice.mockReset();
        mockGetItemPriceOutlierInfo.mockReset();
        mockGetInitClientData.mockReset();
        mockGetItemDetails.mockReset();
        mockGetCustomPrice.mockReset().mockReturnValue(null);
        expectedValueCalculator.containerCache.clear();
        expectedValueCalculator.isInitialized = true;
    });

    test('flags hasOutlierPrices true when any drop price was substituted', () => {
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/test_chest': [{ itemHrid: '/items/cheese', dropRate: 1, minCount: 1, maxCount: 1 }],
            },
        });
        mockGetItemDetails.mockImplementation((hrid) =>
            hrid === '/items/test_chest'
                ? { name: 'Test Chest', isOpenable: true }
                : { name: 'Cheese', isTradable: true, isOpenable: false }
        );
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 100, isOutlier: true });

        const ev = expectedValueCalculator.calculateExpectedValue('/items/test_chest');

        expect(ev.hasOutlierPrices).toBe(true);
    });

    test('flags hasOutlierPrices false when no drop price was substituted', () => {
        mockGetInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/test_chest': [{ itemHrid: '/items/cheese', dropRate: 1, minCount: 1, maxCount: 1 }],
            },
        });
        mockGetItemDetails.mockImplementation((hrid) =>
            hrid === '/items/test_chest'
                ? { name: 'Test Chest', isOpenable: true }
                : { name: 'Cheese', isTradable: true, isOpenable: false }
        );
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 100, isOutlier: false });

        const ev = expectedValueCalculator.calculateExpectedValue('/items/test_chest');

        expect(ev.hasOutlierPrices).toBe(false);
    });
});
