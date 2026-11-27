import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    calculateItemValue: vi.fn(),
    getItemPrices: vi.fn(),
    getSettingValue: vi.fn((_key, fallback) => fallback),
}));

vi.mock('../../networth/networth-calculator.js', () => ({ calculateItemValue: mocks.calculateItemValue }));
vi.mock('../../../utils/market-data.js', () => ({ getItemPrices: mocks.getItemPrices }));
vi.mock('../../../core/config.js', () => ({ default: { getSettingValue: mocks.getSettingValue } }));

const { getWishlistPrice } = await import('./wishlist-pricing.js');

describe('getWishlistPrice', () => {
    beforeEach(() => {
        mocks.calculateItemValue.mockReset();
        mocks.getItemPrices.mockReset();
        mocks.getSettingValue.mockReset().mockImplementation((_key, fallback) => fallback);
    });

    test('prices one item through the net worth rules', async () => {
        mocks.calculateItemValue.mockResolvedValue(5000);
        mocks.getItemPrices.mockReturnValue({ ask: 5000, bid: 4000 });

        const result = await getWishlistPrice({ itemHrid: '/items/a', enhancementLevel: 3 });

        expect(mocks.calculateItemValue).toHaveBeenCalledWith({ itemHrid: '/items/a', enhancementLevel: 3, count: 1 });
        expect(result).toEqual({ price: 5000, available: true, estimated: false });
    });

    test('marks the price estimated when the net worth price field has no live price', async () => {
        mocks.calculateItemValue.mockResolvedValue(9000);
        mocks.getItemPrices.mockReturnValue({ ask: -1, bid: 8000 });

        expect((await getWishlistPrice({ itemHrid: '/items/a' })).estimated).toBe(true);
    });

    test('follows the net worth pricing mode when judging whether a live price exists', async () => {
        mocks.calculateItemValue.mockResolvedValue(9000);
        mocks.getItemPrices.mockReturnValue({ ask: -1, bid: 8000 });
        mocks.getSettingValue.mockImplementation((key) => (key === 'networth_pricingMode' ? 'bid' : undefined));

        expect((await getWishlistPrice({ itemHrid: '/items/a' })).estimated).toBe(false);
    });

    test('an item with no market data at all is estimated', async () => {
        mocks.calculateItemValue.mockResolvedValue(1200);
        mocks.getItemPrices.mockReturnValue(null);

        expect(await getWishlistPrice({ itemHrid: '/items/a' })).toEqual({
            price: 1200,
            available: true,
            estimated: true,
        });
    });

    test('reports no price when nothing could value the item', async () => {
        mocks.calculateItemValue.mockResolvedValue(0);

        expect(await getWishlistPrice({ itemHrid: '/items/a' })).toEqual({
            price: 0,
            available: false,
            estimated: false,
        });
    });

    test('a failing valuation is reported as no price, not thrown', async () => {
        mocks.calculateItemValue.mockRejectedValue(new Error('boom'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect((await getWishlistPrice({ itemHrid: '/items/a' })).available).toBe(false);
        spy.mockRestore();
    });
});
