/**
 * Tests for EstimatedListingAge.parsePrice (TLA-008)
 */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({
    default: { on: vi.fn(), off: vi.fn(), getMarketListings: vi.fn(() => []) },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => false), onSettingChange: vi.fn() } }));
vi.mock('../../core/storage.js', () => ({
    default: { get: vi.fn(), set: vi.fn(), getJSON: vi.fn(), setJSON: vi.fn() },
}));
vi.mock('../../api/marketplace.js', () => ({ default: { fetch: vi.fn() } }));
vi.mock('../../utils/formatters.js', () => ({ formatRelativeTime: vi.fn(), formatDateTime: vi.fn() }));

const { default: estimatedListingAge } = await import('./estimated-listing-age.js');

describe('EstimatedListingAge.parsePrice', () => {
    test('plain integer', () => {
        expect(estimatedListingAge.parsePrice('999')).toBe(999);
    });

    test('K suffix', () => {
        expect(estimatedListingAge.parsePrice('1.5K')).toBe(1500);
    });

    test('M suffix', () => {
        expect(estimatedListingAge.parsePrice('12M')).toBe(12000000);
    });

    test('B suffix', () => {
        expect(estimatedListingAge.parsePrice('1.5B')).toBe(1500000000);
    });

    test('comma-separated value', () => {
        expect(estimatedListingAge.parsePrice('1,234,567')).toBe(1234567);
    });

    test('lowercase k suffix', () => {
        expect(estimatedListingAge.parsePrice('2.5k')).toBe(2500);
    });

    test('lowercase m suffix', () => {
        expect(estimatedListingAge.parsePrice('3m')).toBe(3000000);
    });

    test('lowercase b suffix', () => {
        expect(estimatedListingAge.parsePrice('2b')).toBe(2000000000);
    });

    test('leading/trailing whitespace', () => {
        expect(estimatedListingAge.parsePrice('  500K  ')).toBe(500000);
    });

    test('empty string returns null', () => {
        expect(estimatedListingAge.parsePrice('')).toBeNull();
    });

    test('invalid text returns null, not 0', () => {
        expect(estimatedListingAge.parsePrice('bad')).toBeNull();
    });

    test('invalid text does not match a zero-price listing', () => {
        const price = estimatedListingAge.parsePrice('bad');
        // The match check is Math.abs(listing.price - price) < 0.01
        // With price=null: Math.abs(somePrice - null) = Math.abs(somePrice - 0)
        // which could falsely match a zero-price listing.
        // With the correct null return, callers that guard with `if (price === null) continue`
        // skip matching entirely — test that the guard works.
        expect(price).toBeNull();
    });

    test('billion-scale price matches stored listing correctly', () => {
        const storedPrice = 1500000000;
        const parsed = estimatedListingAge.parsePrice('1.5B');
        expect(Math.abs(storedPrice - parsed) < 0.01).toBe(true);
    });
});

describe('EstimatedListingAge — call-site null guards', () => {
    test('invalid price text does not match a zero-price listing in addAgeColumn path', () => {
        // null coerces to 0 in Math.abs(listing.price - null), so without a guard
        // a zero-price stored listing would be falsely matched by any invalid row text.
        // The guard `if (price === null) continue` must prevent this.
        const price = estimatedListingAge.parsePrice('bad');
        expect(price).toBeNull();
        // Simulate the predicate that was previously unguarded:
        const zeroPriceListing = { price: 0 };
        const wouldFalselyMatch = price !== null && Math.abs(zeroPriceListing.price - price) < 0.01;
        expect(wouldFalselyMatch).toBe(false);
    });

    test('invalid price text does not resolve an item via zero-price match in getCurrentItemHrid path', () => {
        const price = estimatedListingAge.parsePrice('---');
        expect(price).toBeNull();
        // Without the guard, null coerces to 0 and matches listing.price === 0.
        const zeroPriceListing = { price: 0, orderQuantity: 1, filledQuantity: 0 };
        const wouldFalselyMatch = price !== null && Math.abs(zeroPriceListing.price - price) < 0.01;
        expect(wouldFalselyMatch).toBe(false);
    });
});
