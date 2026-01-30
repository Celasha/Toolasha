/**
 * Production Profit Calculator
 *
 * Calculates comprehensive profit/hour for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 * Reuses existing profit calculator from tooltip system.
 */

import dataManager from '../../core/data-manager.js';
import profitCalculator from '../market/profit-calculator.js';

/**
 * Action types for production skills (5 skills)
 */
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * Calculate comprehensive profit for a production action
 * @param {string} actionHrid - Action HRID (e.g., "/actions/brewing/efficiency_tea")
 * @returns {Object|null} Profit data or null if not applicable
 */
export async function calculateProductionProfit(actionHrid) {
    // Get action details
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];

    if (!actionDetail) {
        return null;
    }

    // Only process production actions with outputs
    if (!PRODUCTION_TYPES.includes(actionDetail.type)) {
        return null;
    }

    if (!actionDetail.outputItems || actionDetail.outputItems.length === 0) {
        return null; // No output - nothing to calculate
    }

    // Note: Market API is pre-loaded by caller (max-produceable.js)
    // No need to check or fetch here

    // Get output item HRID
    const outputItemHrid = actionDetail.outputItems[0].itemHrid;

    // Reuse existing profit calculator (does all the heavy lifting)
    const profitData = await profitCalculator.calculateProfit(outputItemHrid);

    if (!profitData) {
        return null;
    }

    return profitData;
}

/**
 * Format profit data into display object for panel display
 * @param {Object} profitData - Profit data from calculateProductionProfit
 * @returns {Object} Formatted display data
 */
export function formatProfitDisplay(profitData) {
    if (!profitData) {
        return null;
    }

    // Helper: Format number with appropriate decimals (2 if < 1, else 1)
    const formatWithDecimals = (value) => {
        if (value < 1) {
            return parseFloat(value.toFixed(2));
        }
        return parseFloat(value.toFixed(1));
    };

    return {
        profit: Math.round(profitData.profitPerHour),
        profitPerDay: Math.round(profitData.profitPerDay),
        revenue: Math.round(
            profitData.itemsPerHour * profitData.priceAfterTax + profitData.gourmetBonusItems * profitData.priceAfterTax
        ),
        costs: Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour),
        actionsPerHour: formatWithDecimals(profitData.actionsPerHour),
        totalEfficiency: profitData.totalEfficiency,

        // Output details (preserve decimals for items/hour)
        baseOutputItems: formatWithDecimals(profitData.itemsPerHour),
        gourmetBonusItems: formatWithDecimals(profitData.gourmetBonusItems),
        priceEach: Math.round(profitData.priceAfterTax),

        // Material breakdown
        materialCosts: profitData.materialCosts,
        totalMaterialCost: Math.round(profitData.materialCostPerHour),

        // Tea breakdown
        teaCosts: profitData.teaCosts,
        totalTeaCost: Math.round(profitData.totalTeaCostPerHour),

        // Efficiency breakdown
        details: {
            levelEfficiency: profitData.levelEfficiency,
            houseEfficiency: profitData.houseEfficiency,
            teaEfficiency: profitData.teaEfficiency,
            equipmentEfficiency: profitData.equipmentEfficiency,
            artisanBonus: profitData.artisanBonus,
            gourmetBonus: profitData.gourmetBonus,
            efficiencyMultiplier: profitData.efficiencyMultiplier, // For time calculations
        },
    };
}
