/* @vitest-environment jsdom */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../risk-of-ruin/risk-of-ruin-ui.js', () => ({ default: { getDepthCapContext: vi.fn(() => null) } }));

const { calculateDepthCap } = await import('./market-depth-cap.js');

describe('calculateDepthCap', () => {
    test('sums quantity across bid levels that still clear the cost threshold', () => {
        // threshold = cost / ((1-tax) * qty) = 100 / (0.95 * 2) = ~52.63
        const bids = [
            { price: 100, quantity: 10 },
            { price: 60, quantity: 5 },
            { price: 40, quantity: 20 }, // below threshold, excluded
        ];

        const result = calculateDepthCap({ bids, costPerAction: 100, quantityPerAction: 2, marketTax: 0.05 });

        expect(result.cumulativeQuantity).toBe(15);
        expect(result.nstar).toBe(7); // floor(15 / 2)
        expect(result.hitBookEnd).toBe(false);
    });

    test('stops at the exact listing where price first drops below threshold', () => {
        // threshold = 45 / (0.95 * 1) ~= 47.37
        const bids = [
            { price: 50, quantity: 10 }, // clears threshold, included
            { price: 47, quantity: 100 }, // below threshold, excluded entirely
        ];

        const result = calculateDepthCap({ bids, costPerAction: 45, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.cumulativeQuantity).toBe(10);
        expect(result.hitBookEnd).toBe(false);
    });

    test('flags hitBookEnd when every visible bid still clears cost', () => {
        const bids = [
            { price: 1000, quantity: 3 },
            { price: 900, quantity: 4 },
        ];

        const result = calculateDepthCap({ bids, costPerAction: 10, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.hitBookEnd).toBe(true);
        expect(result.cumulativeQuantity).toBe(7);
    });

    test('returns a zero result when no bid clears the threshold', () => {
        const bids = [{ price: 10, quantity: 100 }];
        const result = calculateDepthCap({ bids, costPerAction: 1000, quantityPerAction: 1, marketTax: 0.05 });

        expect(result.nstar).toBe(0);
        expect(result.cumulativeQuantity).toBe(0);
        expect(result.hitBookEnd).toBe(false);
    });

    test('returns a zero result for missing/invalid inputs', () => {
        expect(calculateDepthCap({ bids: [], costPerAction: 100, quantityPerAction: 1 })).toEqual({
            nstar: 0,
            cumulativeQuantity: 0,
            thresholdPrice: null,
            hitBookEnd: false,
        });
        expect(
            calculateDepthCap({ bids: [{ price: 10, quantity: 1 }], costPerAction: 0, quantityPerAction: 1 })
        ).toEqual({ nstar: 0, cumulativeQuantity: 0, thresholdPrice: null, hitBookEnd: false });
        expect(
            calculateDepthCap({ bids: [{ price: 10, quantity: 1 }], costPerAction: 100, quantityPerAction: 0 })
        ).toEqual({ nstar: 0, cumulativeQuantity: 0, thresholdPrice: null, hitBookEnd: false });
    });

    test('defaults marketTax to the shared MARKET_TAX constant when omitted', () => {
        const bids = [{ price: 100, quantity: 10 }];
        const withDefault = calculateDepthCap({ bids, costPerAction: 100, quantityPerAction: 1 });
        const withExplicit = calculateDepthCap({ bids, costPerAction: 100, quantityPerAction: 1, marketTax: 0.05 });

        expect(withDefault).toEqual(withExplicit);
    });
});
