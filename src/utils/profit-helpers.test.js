/**
 * Tests for Profit Calculation Helpers
 * Testing profit/rate calculations used across features
 */

import { describe, test, expect } from 'vitest';
import {
    calculateActionsPerHour,
    calculateHoursForActions,
    calculateSecondsForActions,
    calculateEfficiencyMultiplier,
    calculateProfitPerAction,
    calculateTotalProfitForActions,
    calculateProfitPerDay,
    calculateDrinksPerHour,
    calculatePriceAfterTax,
    calculateQueueProfitBreakdown,
} from './profit-helpers.js';

// ============ Rate Conversion Tests ============

describe('calculateActionsPerHour', () => {
    test('calculates actions per hour from action time', () => {
        expect(calculateActionsPerHour(6)).toBe(600); // 3600 / 6
        expect(calculateActionsPerHour(1)).toBe(3600); // 3600 / 1
        expect(calculateActionsPerHour(60)).toBe(60); // 3600 / 60
    });

    test('handles fractional action times', () => {
        expect(calculateActionsPerHour(0.5)).toBe(7200); // 3600 / 0.5
        expect(calculateActionsPerHour(2.5)).toBe(1440); // 3600 / 2.5
    });

    test('returns 0 for invalid inputs', () => {
        expect(calculateActionsPerHour(0)).toBe(0);
        expect(calculateActionsPerHour(-1)).toBe(0);
        expect(calculateActionsPerHour(null)).toBe(0);
        expect(calculateActionsPerHour(undefined)).toBe(0);
    });
});

describe('calculateHoursForActions', () => {
    test('calculates hours needed for actions', () => {
        expect(calculateHoursForActions(600, 600)).toBe(1);
        expect(calculateHoursForActions(1200, 600)).toBe(2);
        expect(calculateHoursForActions(300, 600)).toBe(0.5);
    });

    test('handles fractional results', () => {
        expect(calculateHoursForActions(100, 600)).toBeCloseTo(0.167, 2);
        expect(calculateHoursForActions(1, 600)).toBeCloseTo(0.00167, 4);
    });

    test('returns 0 for invalid actionsPerHour', () => {
        expect(calculateHoursForActions(100, 0)).toBe(0);
        expect(calculateHoursForActions(100, -1)).toBe(0);
        expect(calculateHoursForActions(100, null)).toBe(0);
        expect(calculateHoursForActions(100, undefined)).toBe(0);
    });
});

describe('calculateSecondsForActions', () => {
    test('calculates seconds needed for actions', () => {
        expect(calculateSecondsForActions(600, 600)).toBe(3600); // 1 hour
        expect(calculateSecondsForActions(100, 600)).toBe(600); // 10 minutes
        expect(calculateSecondsForActions(60, 3600)).toBe(60); // 1 minute
    });

    test('returns 0 for invalid inputs', () => {
        expect(calculateSecondsForActions(100, 0)).toBe(0);
    });
});

// ============ Efficiency Tests ============

describe('calculateEfficiencyMultiplier', () => {
    test('calculates multiplier from efficiency percentage', () => {
        expect(calculateEfficiencyMultiplier(0)).toBe(1);
        expect(calculateEfficiencyMultiplier(50)).toBe(1.5);
        expect(calculateEfficiencyMultiplier(100)).toBe(2);
        expect(calculateEfficiencyMultiplier(150)).toBe(2.5);
        expect(calculateEfficiencyMultiplier(250)).toBe(3.5);
    });

    test('handles null/undefined as 0%', () => {
        expect(calculateEfficiencyMultiplier(null)).toBe(1);
        expect(calculateEfficiencyMultiplier(undefined)).toBe(1);
    });

    test('handles fractional efficiency', () => {
        expect(calculateEfficiencyMultiplier(33.5)).toBe(1.335);
    });
});

// ============ Profit Calculation Tests ============

describe('calculateProfitPerAction', () => {
    test('calculates profit per action from hourly values', () => {
        // Simple case: 30,000/hr with 600 actions/hr = 50 per action
        expect(calculateProfitPerAction(30000, 600)).toBe(50);

        // With efficiency baked in: 75,000/hr with 600 base actions/hr = 125 per action
        expect(calculateProfitPerAction(75000, 600)).toBe(125);
    });

    test('handles negative profit (loss)', () => {
        expect(calculateProfitPerAction(-10000, 600)).toBeCloseTo(-16.67, 1);
    });

    test('handles zero profit', () => {
        expect(calculateProfitPerAction(0, 600)).toBe(0);
    });

    test('returns 0 for invalid actionsPerHour', () => {
        expect(calculateProfitPerAction(30000, 0)).toBe(0);
        expect(calculateProfitPerAction(30000, -1)).toBe(0);
        expect(calculateProfitPerAction(30000, null)).toBe(0);
    });
});

describe('calculateTotalProfitForActions', () => {
    test('calculates total profit for queued actions', () => {
        // 30,000/hr, 600 actions/hr, 100 queued = 5,000 total
        expect(calculateTotalProfitForActions(30000, 600, 100)).toBe(5000);

        // With efficiency: 75,000/hr, 600 actions/hr, 100 queued = 12,500 total
        expect(calculateTotalProfitForActions(75000, 600, 100)).toBe(12500);
    });

    test('handles large queue counts', () => {
        expect(calculateTotalProfitForActions(30000, 600, 10000)).toBe(500000);
    });

    test('handles single action', () => {
        expect(calculateTotalProfitForActions(30000, 600, 1)).toBe(50);
    });

    test('handles zero actions', () => {
        expect(calculateTotalProfitForActions(30000, 600, 0)).toBe(0);
    });

    test('handles negative profit', () => {
        expect(calculateTotalProfitForActions(-6000, 600, 100)).toBe(-1000);
    });
});

describe('calculateProfitPerDay', () => {
    test('calculates daily profit from hourly', () => {
        expect(calculateProfitPerDay(10000)).toBe(240000);
        expect(calculateProfitPerDay(1000)).toBe(24000);
        expect(calculateProfitPerDay(0)).toBe(0);
    });

    test('handles negative profit', () => {
        expect(calculateProfitPerDay(-5000)).toBe(-120000);
    });
});

// ============ Cost Calculation Tests ============

describe('calculateDrinksPerHour', () => {
    test('returns base rate with no concentration', () => {
        expect(calculateDrinksPerHour(0)).toBe(12);
        expect(calculateDrinksPerHour()).toBe(12);
    });

    test('increases rate with drink concentration', () => {
        expect(calculateDrinksPerHour(0.15)).toBeCloseTo(13.8, 1); // 12 × 1.15
        expect(calculateDrinksPerHour(0.3)).toBeCloseTo(15.6, 1); // 12 × 1.30
        expect(calculateDrinksPerHour(0.5)).toBe(18); // 12 × 1.50
    });
});

describe('calculatePriceAfterTax', () => {
    test('applies 2% marketplace tax', () => {
        expect(calculatePriceAfterTax(100)).toBe(98);
        expect(calculatePriceAfterTax(1000)).toBe(980);
        expect(calculatePriceAfterTax(50)).toBe(49);
    });

    test('handles zero price', () => {
        expect(calculatePriceAfterTax(0)).toBe(0);
    });

    test('handles fractional prices', () => {
        expect(calculatePriceAfterTax(99.99)).toBeCloseTo(97.99, 2);
    });
});

// ============ Composite Calculation Tests ============

describe('calculateQueueProfitBreakdown', () => {
    test('calculates complete breakdown for production action', () => {
        const result = calculateQueueProfitBreakdown({
            profitPerHour: 75000,
            actionsPerHour: 600,
            actionCount: 100,
        });

        expect(result.totalProfit).toBe(12500);
        expect(result.profitPerAction).toBe(125);
        expect(result.hoursNeeded).toBeCloseTo(0.167, 2);
        expect(result.secondsNeeded).toBe(600);
        expect(result.valueMode).toBe('profit');
    });

    test('uses revenue in estimated_value mode', () => {
        const result = calculateQueueProfitBreakdown({
            profitPerHour: 50000,
            revenuePerHour: 100000,
            actionsPerHour: 600,
            actionCount: 100,
            valueMode: 'estimated_value',
        });

        // Should use revenuePerHour (100,000) not profitPerHour (50,000)
        expect(result.totalProfit).toBeCloseTo(16667, 0);
        expect(result.profitPerAction).toBeCloseTo(166.67, 1);
        expect(result.valuePerHour).toBe(100000);
    });

    test('falls back to profit when revenue undefined in estimated_value mode', () => {
        const result = calculateQueueProfitBreakdown({
            profitPerHour: 50000,
            actionsPerHour: 600,
            actionCount: 100,
            valueMode: 'estimated_value',
        });

        expect(result.valuePerHour).toBe(50000);
    });

    test('handles negative profit', () => {
        const result = calculateQueueProfitBreakdown({
            profitPerHour: -10000,
            actionsPerHour: 600,
            actionCount: 100,
        });

        expect(result.totalProfit).toBeCloseTo(-1667, 0);
        expect(result.profitPerAction).toBeCloseTo(-16.67, 1);
    });

    test('handles zero actionsPerHour gracefully', () => {
        const result = calculateQueueProfitBreakdown({
            profitPerHour: 75000,
            actionsPerHour: 0,
            actionCount: 100,
        });

        expect(result.totalProfit).toBe(0);
        expect(result.profitPerAction).toBe(0);
        expect(result.hoursNeeded).toBe(0);
    });
});

// ============ Real-World Scenario Tests ============

describe('Real-world profit scenarios', () => {
    test('Cheese production with 150% efficiency', () => {
        // Scenario:
        // - 6 second action time → 600 base actions/hour
        // - 150% efficiency → 2.5x multiplier
        // - Cheese sells for 100, costs 50 in materials
        // - Profit per cheese = 50
        // - profitPerHour = 600 × 2.5 × 50 = 75,000 (efficiency already included)
        // - Queue shows "Produce 100 times"

        const actionsPerHour = calculateActionsPerHour(6);
        expect(actionsPerHour).toBe(600);

        const efficiencyMultiplier = calculateEfficiencyMultiplier(150);
        expect(efficiencyMultiplier).toBe(2.5);

        // profitPerHour already includes efficiency (calculated by profit-calculator.js)
        const profitPerHour = 75000;

        const result = calculateQueueProfitBreakdown({
            profitPerHour,
            actionsPerHour,
            actionCount: 100,
        });

        // 100 attempts × 125 profit per attempt = 12,500
        expect(result.totalProfit).toBe(12500);
        expect(result.profitPerAction).toBe(125); // 50 profit × 2.5 efficiency
    });

    test('Gathering with 50% efficiency', () => {
        // Scenario:
        // - 4 second action time → 900 base actions/hour
        // - 50% efficiency → 1.5x multiplier
        // - Average drop value = 20 per action (before efficiency)
        // - profitPerHour = 900 × 1.5 × 20 = 27,000
        // - Queue shows "Gather 500 times"

        const actionsPerHour = calculateActionsPerHour(4);
        expect(actionsPerHour).toBe(900);

        const profitPerHour = 27000;

        const result = calculateQueueProfitBreakdown({
            profitPerHour,
            actionsPerHour,
            actionCount: 500,
        });

        // 500 attempts × 30 profit per attempt = 15,000
        expect(result.totalProfit).toBe(15000);
        expect(result.profitPerAction).toBe(30); // 20 profit × 1.5 efficiency
    });

    test('Loss-making action (material cost > sale price)', () => {
        // Scenario:
        // - 600 actions/hour
        // - Each action loses 10 gold
        // - profitPerHour = -6,000
        // - Queue shows "Produce 200 times"

        const result = calculateQueueProfitBreakdown({
            profitPerHour: -6000,
            actionsPerHour: 600,
            actionCount: 200,
        });

        expect(result.totalProfit).toBe(-2000);
        expect(result.profitPerAction).toBe(-10);
    });
});
