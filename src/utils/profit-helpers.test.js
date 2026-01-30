/**
 * Tests for Profit Calculation Helpers
 * Testing profit/rate calculations used across features
 */

import { describe, test, expect } from 'vitest';
import {
    calculateActionsPerHour,
    calculateHoursForActions,
    calculateSecondsForActions,
    calculateProfitPerAction,
    calculateTotalProfitForActions,
    calculateProfitPerDay,
    calculateDrinksPerHour,
    calculateTeaCostsPerHour,
    calculatePriceAfterTax,
    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
} from './profit-helpers.js';
import { MARKET_TAX } from './profit-constants.js';
import { calculateEfficiencyMultiplier } from './efficiency.js';

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

describe('calculateTeaCostsPerHour', () => {
    test('returns empty costs when no drink slots', () => {
        const result = calculateTeaCostsPerHour({
            drinkSlots: [],
            drinkConcentration: 0.1,
            itemDetailMap: {},
            getItemPrice: () => 100,
        });

        expect(result.costs).toEqual([]);
        expect(result.totalCostPerHour).toBe(0);
        expect(result.hasMissingPrices).toBe(false);
    });

    test('calculates tea costs with drink concentration', () => {
        const itemDetailMap = {
            '/items/tea': { name: 'Tea' },
        };
        const getItemPrice = () => 50;

        const result = calculateTeaCostsPerHour({
            drinkSlots: [{ itemHrid: '/items/tea' }],
            drinkConcentration: 0.25,
            itemDetailMap,
            getItemPrice,
        });

        expect(result.costs).toHaveLength(1);
        expect(result.costs[0].itemName).toBe('Tea');
        expect(result.costs[0].pricePerDrink).toBe(50);
        expect(result.costs[0].drinksPerHour).toBeCloseTo(15, 6);
        expect(result.totalCostPerHour).toBeCloseTo(750, 6);
    });

    test('flags missing prices as zero cost', () => {
        const itemDetailMap = {
            '/items/unknown_tea': { name: 'Unknown Tea' },
        };

        const result = calculateTeaCostsPerHour({
            drinkSlots: [{ itemHrid: '/items/unknown_tea' }],
            drinkConcentration: 0,
            itemDetailMap,
            getItemPrice: () => null,
        });

        expect(result.totalCostPerHour).toBe(0);
        expect(result.hasMissingPrices).toBe(true);
        expect(result.costs[0].missingPrice).toBe(true);
    });

    test('propagates missing prices when mixed with valid costs', () => {
        const itemDetailMap = {
            '/items/tea': { name: 'Tea' },
            '/items/unknown_tea': { name: 'Unknown Tea' },
        };
        const getItemPrice = (itemHrid) => (itemHrid === '/items/tea' ? 100 : null);

        const result = calculateTeaCostsPerHour({
            drinkSlots: [{ itemHrid: '/items/tea' }, { itemHrid: '/items/unknown_tea' }],
            drinkConcentration: 0,
            itemDetailMap,
            getItemPrice,
        });

        expect(result.hasMissingPrices).toBe(true);
        expect(result.totalCostPerHour).toBe(1200);
        expect(result.costs).toHaveLength(2);
    });
});

describe('calculatePriceAfterTax', () => {
    test('applies 2% marketplace tax', () => {
        expect(calculatePriceAfterTax(100)).toBe(98);
        expect(calculatePriceAfterTax(1000)).toBe(980);
        expect(calculatePriceAfterTax(50)).toBe(49);
    });

    test('uses default MARKET_TAX when taxRate omitted', () => {
        const price = 123;
        expect(calculatePriceAfterTax(price)).toBe(price * (1 - MARKET_TAX));
    });

    test('supports custom tax rate overrides', () => {
        const price = 200;
        expect(calculatePriceAfterTax(price, 0.18)).toBe(164);
        expect(calculatePriceAfterTax(price, 0.18)).not.toBe(calculatePriceAfterTax(price));
    });

    test('handles zero price', () => {
        expect(calculatePriceAfterTax(0)).toBe(0);
    });

    test('handles fractional prices', () => {
        expect(calculatePriceAfterTax(99.99)).toBeCloseTo(97.99, 2);
    });
});

describe('calculateProductionActionTotalsFromBase', () => {
    test('calculates production totals from action-based inputs', () => {
        const actionsCount = 10;
        const actionsPerHour = 5;
        const result = calculateProductionActionTotalsFromBase({
            actionsCount,
            actionsPerHour,
            outputAmount: 3,
            outputPrice: 100,
            gourmetBonus: 0.1,
            bonusDrops: [{ revenuePerAction: 5 }, { revenuePerAction: 7 }],
            materialCosts: [{ totalCost: 20 }, { totalCost: 5 }],
            totalTeaCostPerHour: 10,
        });

        expect(result.hoursNeeded).toBe(calculateHoursForActions(actionsCount, actionsPerHour));
        expect(result.totalBaseItems).toBe(30);
        expect(result.totalGourmetItems).toBeCloseTo(3, 6);
        expect(result.totalBaseRevenue).toBe(3000);
        expect(result.totalGourmetRevenue).toBeCloseTo(300, 6);
        expect(result.totalBonusRevenue).toBe(120);
        expect(result.totalRevenue).toBe(3420);
        expect(result.totalMarketTax).toBeCloseTo(3420 * MARKET_TAX, 6);
        expect(result.totalMaterialCost).toBe(250);
        expect(result.totalTeaCost).toBe(20);
        expect(result.totalCosts).toBeCloseTo(338.4, 6);
        expect(result.totalProfit).toBeCloseTo(3081.6, 6);
    });

    test('handles zero actionsPerHour without tea costs', () => {
        const actionsCount = 4;
        const actionsPerHour = 0;
        const result = calculateProductionActionTotalsFromBase({
            actionsCount,
            actionsPerHour,
            outputAmount: 2,
            outputPrice: 50,
            gourmetBonus: 0,
            totalTeaCostPerHour: 10,
        });

        expect(result.hoursNeeded).toBe(0);
        expect(result.totalBaseItems).toBe(0);
        expect(result.totalGourmetItems).toBe(0);
        expect(result.totalBaseRevenue).toBe(0);
        expect(result.totalGourmetRevenue).toBe(0);
        expect(result.totalBonusRevenue).toBe(0);
        expect(result.totalRevenue).toBe(0);
        expect(result.totalMarketTax).toBe(0);
        expect(result.totalMaterialCost).toBe(0);
        expect(result.totalTeaCost).toBe(0);
        expect(result.totalCosts).toBe(0);
        expect(result.totalProfit).toBe(0);
    });

    test('scales hours and tea costs by efficiency multiplier', () => {
        const result = calculateProductionActionTotalsFromBase({
            actionsCount: 100,
            actionsPerHour: 50,
            outputAmount: 1,
            outputPrice: 10,
            gourmetBonus: 0,
            totalTeaCostPerHour: 20,
            efficiencyMultiplier: 2,
        });

        expect(result.hoursNeeded).toBe(1);
        expect(result.totalTeaCost).toBe(20);
    });
});

describe('calculateGatheringActionTotalsFromBase', () => {
    test('calculates gathering totals from action-based inputs', () => {
        const actionsCount = 10;
        const actionsPerHour = 4;
        const result = calculateGatheringActionTotalsFromBase({
            actionsCount,
            actionsPerHour,
            baseOutputs: [{ revenuePerAction: 3 }, { revenuePerAction: 2 }],
            bonusDrops: [{ revenuePerAction: 1.5 }],
            processingRevenueBonusPerAction: 0.5,
            gourmetRevenueBonusPerAction: 0.75,
            drinkCostPerHour: 6,
        });

        expect(result.hoursNeeded).toBe(calculateHoursForActions(actionsCount, actionsPerHour));
        expect(result.totalBaseRevenue).toBe(50);
        expect(result.totalGourmetRevenue).toBe(7.5);
        expect(result.totalBonusRevenue).toBe(15);
        expect(result.totalProcessingRevenue).toBe(5);
        expect(result.totalRevenue).toBe(77.5);
        expect(result.totalMarketTax).toBeCloseTo(77.5 * MARKET_TAX, 6);
        expect(result.totalDrinkCost).toBeCloseTo(15, 6);
        expect(result.totalCosts).toBeCloseTo(16.55, 6);
        expect(result.totalProfit).toBeCloseTo(60.95, 6);
    });

    test('handles missing inputs with zero actionsPerHour', () => {
        const result = calculateGatheringActionTotalsFromBase({
            actionsCount: 5,
            actionsPerHour: 0,
            drinkCostPerHour: 10,
        });

        expect(result.hoursNeeded).toBe(0);
        expect(result.totalBaseRevenue).toBe(0);
        expect(result.totalBonusRevenue).toBe(0);
        expect(result.totalProcessingRevenue).toBe(0);
        expect(result.totalGourmetRevenue).toBe(0);
        expect(result.totalRevenue).toBe(0);
        expect(result.totalMarketTax).toBe(0);
        expect(result.totalDrinkCost).toBe(0);
        expect(result.totalCosts).toBe(0);
        expect(result.totalProfit).toBe(0);
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
        // - Queue shows "Produce 100 times" (completed actions)

        const actionsPerHour = calculateActionsPerHour(6);
        expect(actionsPerHour).toBe(600);

        const efficiencyMultiplier = calculateEfficiencyMultiplier(150);
        expect(efficiencyMultiplier).toBe(2.5);

        const result = calculateProductionActionTotalsFromBase({
            actionsCount: 100,
            actionsPerHour,
            outputAmount: 1,
            outputPrice: 100,
            gourmetBonus: 0,
            materialCosts: [{ totalCost: 50 }],
            totalTeaCostPerHour: 0,
            efficiencyMultiplier,
        });

        // 100 actions × 50 profit per action minus tax = 4,800
        expect(result.totalProfit).toBe(4800);
    });

    test('Gathering with 50% efficiency', () => {
        // Scenario:
        // - 4 second action time → 900 base actions/hour
        // - 50% efficiency → 1.5x multiplier
        // - Average drop value = 20 per action (before efficiency)
        // - profitPerHour = 900 × 1.5 × 20 = 27,000
        // - Queue shows "Gather 500 times" (completed actions)

        const actionsPerHour = calculateActionsPerHour(4);
        expect(actionsPerHour).toBe(900);

        const result = calculateGatheringActionTotalsFromBase({
            actionsCount: 500,
            actionsPerHour,
            baseOutputs: [{ revenuePerAction: 20 }],
            drinkCostPerHour: 0,
            efficiencyMultiplier: 1.5,
        });

        // 500 actions × 20 profit per action minus tax = 9,800
        expect(result.totalProfit).toBe(9800);
    });

    test('Loss-making action (material cost > sale price)', () => {
        // Scenario:
        // - 600 actions/hour
        // - Each action loses 10 gold
        // - profitPerHour = -6,000
        // - Queue shows "Produce 200 times"

        const result = calculateProductionActionTotalsFromBase({
            actionsCount: 200,
            actionsPerHour: 600,
            outputAmount: 1,
            outputPrice: 0,
            gourmetBonus: 0,
            materialCosts: [{ totalCost: 10 }],
            totalTeaCostPerHour: 0,
        });

        expect(result.totalProfit).toBe(-2000);
    });
});
