import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInitClientData: vi.fn(),
    getItemPriceOutlierInfo: vi.fn(),
    getSettingValue: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
    default: { getSettingValue: (...args) => mocks.getSettingValue(...args) },
}));
vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: (...args) => mocks.getInitClientData(...args) },
}));
vi.mock('./market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));

import { calculateDungeonTokenValue } from './token-valuation.js';

function gameDataWithShopItems() {
    return {
        shopItemDetailMap: {
            '/shop_items/a': {
                itemHrid: '/items/weapon_a',
                costs: [{ itemHrid: '/items/chimerical_token', count: 10 }],
            },
            '/shop_items/b': {
                itemHrid: '/items/weapon_b',
                costs: [{ itemHrid: '/items/chimerical_token', count: 5 }],
            },
        },
    };
}

describe('calculateDungeonTokenValue - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSettingValue.mockImplementation((_key, fallback) => fallback);
        mocks.getInitClientData.mockReturnValue(gameDataWithShopItems());
    });

    test('returns null when game data is unavailable', () => {
        mocks.getInitClientData.mockReturnValue(null);
        expect(calculateDungeonTokenValue('/items/chimerical_token')).toBeNull();
    });

    test('returns null when no shop item costs this token', () => {
        mocks.getInitClientData.mockReturnValue({ shopItemDetailMap: {} });
        expect(calculateDungeonTokenValue('/items/chimerical_token')).toBeNull();
    });

    test('picks the shop item with the best value-per-token and surfaces its outlier flag', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/weapon_a') return { value: 100, isOutlier: false }; // 100/10 = 10/token
            if (itemHrid === '/items/weapon_b') return { value: 100, isOutlier: true }; // 100/5 = 20/token (best)
            return { value: null, isOutlier: false };
        });

        const result = calculateDungeonTokenValue('/items/chimerical_token');

        expect(result).toEqual({ value: 20, isOutlier: true });
    });

    test('does not flag isOutlier when the winning shop item price was not substituted', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/weapon_a') return { value: 100, isOutlier: true }; // 10/token (loses)
            if (itemHrid === '/items/weapon_b') return { value: 100, isOutlier: false }; // 20/token (wins, clean)
            return { value: null, isOutlier: false };
        });

        const result = calculateDungeonTokenValue('/items/chimerical_token');

        expect(result).toEqual({ value: 20, isOutlier: false });
    });

    test('falls back to the essence price, outlier-aware, when no shop item has a price', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/chimerical_essence') return { value: 55, isOutlier: true };
            return { value: null, isOutlier: false };
        });

        const result = calculateDungeonTokenValue('/items/chimerical_token');

        expect(result).toEqual({ value: 55, isOutlier: true });
    });

    test('returns null when neither shop items nor the essence fallback have a price', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });

        expect(calculateDungeonTokenValue('/items/chimerical_token')).toBeNull();
    });

    test('uses the bid side in conservative mode (buy-side-cheap convention)', () => {
        mocks.getSettingValue.mockImplementation((key, fallback) =>
            key === 'profitCalc_pricingMode' ? 'conservative' : fallback
        );
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid, opts) => {
            expect(opts.mode).toBe('bid');
            return itemHrid === '/items/weapon_a'
                ? { value: 100, isOutlier: false }
                : { value: null, isOutlier: false };
        });

        calculateDungeonTokenValue('/items/chimerical_token');
    });

    test('ignores the pricing mode and always uses bid when respectModeSetting is falsy', () => {
        mocks.getSettingValue.mockImplementation((key, fallback) => {
            if (key === 'profitCalc_pricingMode') return 'hybrid'; // would normally mean ask
            if (key === null) return false; // respectModeSetting lookup
            return fallback;
        });
        mocks.getItemPriceOutlierInfo.mockImplementation((itemHrid, opts) => {
            expect(opts.mode).toBe('bid');
            return itemHrid === '/items/weapon_a'
                ? { value: 100, isOutlier: false }
                : { value: null, isOutlier: false };
        });

        calculateDungeonTokenValue('/items/chimerical_token', 'profitCalc_pricingMode', null);
    });
});
