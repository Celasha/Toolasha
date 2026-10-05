// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({ default: { getMarketListings: vi.fn(() => []) } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { register: vi.fn() } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => false) } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../api/marketplace.js', () => ({
    default: { getPricesBatch: vi.fn(() => new Map()), on: vi.fn(), off: vi.fn() },
}));
vi.mock('./estimated-listing-age.js', () => ({
    default: {
        orderBooksCache: {},
        getStalenessTooltip: vi.fn(() => ''),
        getStalenessColor: vi.fn(() => '#fff'),
        estimateTimestamp: vi.fn(() => 0),
    },
}));

import listingPriceDisplay from './listing-price-display.js';
import estimatedListingAge from './estimated-listing-age.js';

describe('ListingPriceDisplay - outlier guard propagation (Top Order Price)', () => {
    beforeEach(() => {
        estimatedListingAge.orderBooksCache = {};
    });

    test('_getTopOrderPrice flags the price-cache fallback when the key was substituted', () => {
        const priceCache = new Map([['/items/ore:0', { ask: 500, bid: 400 }]]);
        const outlierKeys = new Set(['/items/ore:0']);

        const result = listingPriceDisplay._getTopOrderPrice('/items/ore', 0, true, priceCache, new Set(), outlierKeys);

        expect(result).toEqual({ price: 500, isOutlier: true });
    });

    test('_getTopOrderPrice does not flag the price-cache fallback when the key is clean', () => {
        const priceCache = new Map([['/items/ore:0', { ask: 500, bid: 400 }]]);

        const result = listingPriceDisplay._getTopOrderPrice('/items/ore', 0, true, priceCache, new Set(), new Set());

        expect(result).toEqual({ price: 500, isOutlier: false });
    });

    test('_getTopOrderPrice ignores outlierKeys when a live order book price is available', () => {
        estimatedListingAge.orderBooksCache['/items/ore'] = {
            orderBooks: { 0: { asks: [{ listingId: 1, price: 999 }], bids: [] } },
        };
        const outlierKeys = new Set(['/items/ore:0']);

        const result = listingPriceDisplay._getTopOrderPrice('/items/ore', 0, true, new Map(), new Set(), outlierKeys);

        expect(result).toEqual({ price: 999, isOutlier: false });
    });

    test('createTopOrderPriceCell appends the warning icon when the fallback price was substituted', () => {
        const priceCache = new Map([['/items/ore:0', { ask: 500, bid: 400 }]]);
        const outlierKeys = new Set(['/items/ore:0']);

        const cell = listingPriceDisplay.createTopOrderPriceCell(
            '/items/ore',
            0,
            true,
            450,
            priceCache,
            new Set(),
            outlierKeys
        );

        expect(cell.textContent).toContain('⚠');
    });

    test('createTopOrderPriceCell does not append the warning icon when a live order book price is used', () => {
        estimatedListingAge.orderBooksCache['/items/ore'] = {
            orderBooks: { 0: { asks: [{ listingId: 1, price: 999 }], bids: [] } },
        };
        const outlierKeys = new Set(['/items/ore:0']);

        const cell = listingPriceDisplay.createTopOrderPriceCell(
            '/items/ore',
            0,
            true,
            450,
            new Map(),
            new Set(),
            outlierKeys
        );

        expect(cell.textContent).not.toContain('⚠');
    });
});
