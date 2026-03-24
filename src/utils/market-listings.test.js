/**
 * Tests for market listing merge utilities
 */

import { describe, test, expect } from 'vitest';
import { mergeMarketListings } from './market-listings.js';

describe('mergeMarketListings', () => {
    test('replaces existing listings by id', () => {
        const current = [
            { id: 1, price: 100, status: '/market_listing_status/active' },
            { id: 2, price: 200, status: '/market_listing_status/active' },
        ];
        const updates = [{ id: 2, price: 250, status: '/market_listing_status/active' }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            { id: 1, price: 100, status: '/market_listing_status/active' },
            { id: 2, price: 250, status: '/market_listing_status/active' },
        ]);
        expect(current).toEqual([
            { id: 1, price: 100, status: '/market_listing_status/active' },
            { id: 2, price: 200, status: '/market_listing_status/active' },
        ]);
    });

    test('adds new listings when id is missing', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [{ id: 3, price: 300, status: '/market_listing_status/active' }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            { id: 1, price: 100, status: '/market_listing_status/active' },
            { id: 3, price: 300, status: '/market_listing_status/active' },
        ]);
    });

    test('ignores updates without ids', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [{ price: 250 }, null];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([{ id: 1, price: 100, status: '/market_listing_status/active' }]);
    });

    test('handles non-array inputs', () => {
        const result = mergeMarketListings(null, undefined);

        expect(result).toEqual([]);
    });

    test('removes cancelled listings', () => {
        const current = [
            { id: 1, price: 100, status: '/market_listing_status/active' },
            { id: 2, price: 200, status: '/market_listing_status/active' },
        ];
        const updates = [{ id: 2, price: 200, status: '/market_listing_status/cancelled' }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([{ id: 1, price: 100, status: '/market_listing_status/active' }]);
    });

    test('removes expired listings', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [{ id: 1, price: 100, status: '/market_listing_status/expired' }];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([]);
    });

    test('removes filled listings once fully claimed', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [
            {
                id: 1,
                price: 100,
                status: '/market_listing_status/filled',
                unclaimedItemCount: 0,
                unclaimedCoinCount: 0,
            },
        ];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([]);
    });

    test('keeps filled listings with unclaimed items', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [
            {
                id: 1,
                price: 100,
                status: '/market_listing_status/filled',
                unclaimedItemCount: 5,
                unclaimedCoinCount: 0,
            },
        ];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            {
                id: 1,
                price: 100,
                status: '/market_listing_status/filled',
                unclaimedItemCount: 5,
                unclaimedCoinCount: 0,
            },
        ]);
    });

    test('keeps filled listings with unclaimed coins', () => {
        const current = [{ id: 1, price: 100, status: '/market_listing_status/active' }];
        const updates = [
            {
                id: 1,
                price: 100,
                status: '/market_listing_status/filled',
                unclaimedItemCount: 0,
                unclaimedCoinCount: 50000,
            },
        ];

        const result = mergeMarketListings(current, updates);

        expect(result).toEqual([
            {
                id: 1,
                price: 100,
                status: '/market_listing_status/filled',
                unclaimedItemCount: 0,
                unclaimedCoinCount: 50000,
            },
        ]);
    });
});
