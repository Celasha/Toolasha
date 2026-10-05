import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockCheckOutlier = vi.hoisted(() => vi.fn());

vi.mock('../api/market-values.js', () => ({
    default: { checkOutlier: mockCheckOutlier },
}));

import { applyOutlierGuardToPriceCache } from './price-cache-outlier-guard.js';

beforeEach(() => {
    mockCheckOutlier.mockReset();
    mockCheckOutlier.mockImplementation((_itemHrid, _level, rawValue) => ({ value: rawValue, isOutlier: false }));
});

describe('applyOutlierGuardToPriceCache', () => {
    test('mutates ask/bid in place when checkOutlier flags them, and tracks the key', () => {
        mockCheckOutlier.mockImplementation((itemHrid, level, rawValue) => {
            if (itemHrid === '/items/sword' && rawValue === 1_000_000) {
                return { value: 1000, isOutlier: true };
            }
            return { value: rawValue, isOutlier: false };
        });

        const priceCache = new Map([['/items/sword:0', { ask: 1_000_000, bid: 900 }]]);
        const outlierKeys = applyOutlierGuardToPriceCache(priceCache);

        expect(priceCache.get('/items/sword:0')).toEqual({ ask: 1000, bid: 900 });
        expect(outlierKeys.has('/items/sword:0')).toBe(true);
    });

    test('does not flag a key when neither side was an outlier', () => {
        const priceCache = new Map([['/items/shield:0', { ask: 500, bid: 400 }]]);
        const outlierKeys = applyOutlierGuardToPriceCache(priceCache);

        expect(priceCache.get('/items/shield:0')).toEqual({ ask: 500, bid: 400 });
        expect(outlierKeys.size).toBe(0);
    });

    test('calls checkOutlier with the itemHrid and enhancementLevel parsed from the key', () => {
        const priceCache = new Map([['/items/sinister_cape:7', { ask: 100, bid: 90 }]]);
        applyOutlierGuardToPriceCache(priceCache);

        expect(mockCheckOutlier).toHaveBeenCalledWith('/items/sinister_cape', 7, 100);
        expect(mockCheckOutlier).toHaveBeenCalledWith('/items/sinister_cape', 7, 90);
    });

    test('skips entries that are not {ask, bid} objects', () => {
        const priceCache = new Map([
            ['/items/weird:0', null],
            ['/items/also_weird:0', 42],
        ]);

        expect(() => applyOutlierGuardToPriceCache(priceCache)).not.toThrow();
        expect(mockCheckOutlier).not.toHaveBeenCalled();
    });

    test('returns an empty set for an empty price cache', () => {
        const outlierKeys = applyOutlierGuardToPriceCache(new Map());
        expect(outlierKeys.size).toBe(0);
    });
});
