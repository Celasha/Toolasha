/**
 * Production Profit Calculator
 *
 * Calculates comprehensive profit/hour for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
 * Reuses existing profit calculator from tooltip system.
 */

import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import profitCalculator from '../market/profit-calculator.js';
import { formatWithSeparator } from '../../utils/formatters.js';

/**
 * Action types for production skills (5 skills)
 */
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring'
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

    // Ensure market data is loaded
    const marketData = await marketAPI.fetch();
    if (!marketData) {
        return null;
    }

    // Get output item HRID
    const outputItemHrid = actionDetail.outputItems[0].itemHrid;

    // Reuse existing profit calculator (does all the heavy lifting)
    const profitData = await profitCalculator.calculateProfit(outputItemHrid);

    if (!profitData) {
        return null;
    }

    // Add profit per day calculation
    profitData.profitPerDay = profitData.profitPerHour * 24;

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

    return {
        profit: Math.round(profitData.profitPerHour),
        profitPerDay: Math.round(profitData.profitPerDay),
        revenue: Math.round(profitData.itemsPerHour * profitData.priceAfterTax + profitData.gourmetBonusItems * profitData.priceAfterTax),
        costs: Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour),
        actionsPerHour: profitData.actionsPerHour,
        totalEfficiency: profitData.efficiencyBonus,

        // Output details
        baseOutputItems: profitData.itemsPerHour,
        gourmetBonusItems: profitData.gourmetBonusItems,
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
            gourmetBonus: profitData.gourmetBonus
        }
    };
}
