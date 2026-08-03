/**
 * Tests for the enhancement tooltip's minimum-sell-price calculation
 */

import { describe, test, expect } from 'vitest';
import { calculateMinimumSellPrice } from './tooltip-enhancement.js';

describe('calculateMinimumSellPrice', () => {
    test('returns total cost plus rate-for-time when tax is excluded', () => {
        // 1 hour of time at a 10M/hr rate on top of a 5M total cost
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, false);
        expect(result).toBe(15_000_000);
    });

    test('grosses up by the 2% marketplace tax when included', () => {
        const breakeven = 15_000_000;
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, true);
        expect(result).toBeCloseTo(breakeven / 0.98, 5);
    });

    test('scales the rate contribution by fractional hours', () => {
        // 30 minutes at 10M/hr = 5M added to a 5M cost
        const result = calculateMinimumSellPrice(5_000_000, 1800, 10_000_000, false);
        expect(result).toBe(10_000_000);
    });

    test('returns just the total cost when hourly rate is zero', () => {
        const result = calculateMinimumSellPrice(5_000_000, 3600, 0, false);
        expect(result).toBe(5_000_000);
    });

    test('returns just the total cost when no time has elapsed', () => {
        const result = calculateMinimumSellPrice(5_000_000, 0, 10_000_000, false);
        expect(result).toBe(5_000_000);
    });
});
