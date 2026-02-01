/**
 * Tests for market listing merge utilities
 */

import { describe, test, expect } from 'vitest';
import { mergeMarketListings } from './market-listings.js';

describe('mergeMarketListings', () => {
    test('replaces existing listings by id', () => {
        const current = [
            { id: 1, price: 100 },
            { id: 2, price: 200 },
        ];
        const updates = [{ id: 2, price: 250 }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            { id: 1, price: 100 },
            { id: 2, price: 250 },
        ]);
        expect(current).toEqual([
            { id: 1, price: 100 },
            { id: 2, price: 200 },
        ]);
    });

    test('adds new listings when id is missing', () => {
        const current = [{ id: 1, price: 100 }];
        const updates = [{ id: 3, price: 300 }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            { id: 1, price: 100 },
            { id: 3, price: 300 },
        ]);
    });

    test('ignores updates without ids', () => {
        const current = [{ id: 1, price: 100 }];
        const updates = [{ price: 250 }, null];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([{ id: 1, price: 100 }]);
    });

    test('handles non-array inputs', () => {
        const result = mergeMarketListings(null, undefined);

        expect(result).toEqual([]);
    });
});
