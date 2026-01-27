/**
 * Profit Calculation Helpers
 * Pure functions for profit/rate calculations used across features
 *
 * These functions consolidate duplicated calculations from:
 * - profit-calculator.js
 * - gathering-profit.js
 * - task-profit-calculator.js
 * - action-time-display.js
 * - tooltip-prices.js
 */

import { SECONDS_PER_HOUR, HOURS_PER_DAY, DRINKS_PER_HOUR_BASE, MARKET_TAX } from './profit-constants.js';

// ============ Rate Conversions ============

/**
 * Calculate actions per hour from action time
 * @param {number} actionTimeSeconds - Time per action in seconds
 * @returns {number} Actions per hour (0 if invalid input)
 *
 * @example
 * calculateActionsPerHour(6) // Returns 600 (3600 / 6)
 * calculateActionsPerHour(0) // Returns 0 (invalid)
 */
export function calculateActionsPerHour(actionTimeSeconds) {
    if (!actionTimeSeconds || actionTimeSeconds <= 0) {
        return 0;
    }
    return SECONDS_PER_HOUR / actionTimeSeconds;
}

/**
 * Calculate hours needed for a number of actions
 * @param {number} actionCount - Number of queued actions
 * @param {number} actionsPerHour - Actions per hour rate
 * @returns {number} Hours needed (0 if invalid input)
 *
 * @example
 * calculateHoursForActions(600, 600) // Returns 1
 * calculateHoursForActions(1200, 600) // Returns 2
 */
export function calculateHoursForActions(actionCount, actionsPerHour) {
    if (!actionsPerHour || actionsPerHour <= 0) {
        return 0;
    }
    return actionCount / actionsPerHour;
}

/**
 * Calculate seconds needed for a number of actions
 * @param {number} actionCount - Number of queued actions
 * @param {number} actionsPerHour - Actions per hour rate
 * @returns {number} Seconds needed (0 if invalid input)
 *
 * @example
 * calculateSecondsForActions(100, 600) // Returns 600 (100/600 * 3600)
 */
export function calculateSecondsForActions(actionCount, actionsPerHour) {
    return calculateHoursForActions(actionCount, actionsPerHour) * SECONDS_PER_HOUR;
}

// ============ Efficiency Calculations ============

/**
 * Calculate efficiency multiplier from efficiency percentage
 * Efficiency gives bonus action completions per time-consuming action
 *
 * @param {number} efficiencyPercent - Efficiency as percentage (e.g., 150 for 150%)
 * @returns {number} Multiplier (e.g., 2.5 for 150% efficiency)
 *
 * @example
 * calculateEfficiencyMultiplier(0)   // Returns 1.0 (no bonus)
 * calculateEfficiencyMultiplier(50)  // Returns 1.5
 * calculateEfficiencyMultiplier(150) // Returns 2.5
 */
export function calculateEfficiencyMultiplier(efficiencyPercent) {
    return 1 + (efficiencyPercent || 0) / 100;
}

// ============ Profit Calculations ============

/**
 * Calculate profit per action from hourly profit data
 *
 * IMPORTANT: This assumes profitPerHour already includes efficiency.
 * The formula works because:
 * - profitPerHour = actionsPerHour × efficiencyMultiplier × profitPerItem
 * - profitPerHour / actionsPerHour = efficiencyMultiplier × profitPerItem
 * - This gives profit per ATTEMPT (what the queue shows)
 *
 * @param {number} profitPerHour - Profit per hour (includes efficiency)
 * @param {number} actionsPerHour - Base actions per hour (without efficiency)
 * @returns {number} Profit per action (0 if invalid input)
 *
 * @example
 * // With 150% efficiency (2.5x), 600 actions/hr, 50 profit/item:
 * // profitPerHour = 600 × 2.5 × 50 = 75,000
 * calculateProfitPerAction(75000, 600) // Returns 125 (profit per action)
 */
export function calculateProfitPerAction(profitPerHour, actionsPerHour) {
    if (!actionsPerHour || actionsPerHour <= 0) {
        return 0;
    }
    return profitPerHour / actionsPerHour;
}

/**
 * Calculate total profit for a number of actions
 *
 * @param {number} profitPerHour - Profit per hour (includes efficiency)
 * @param {number} actionsPerHour - Base actions per hour (without efficiency)
 * @param {number} actionCount - Number of queued actions
 * @returns {number} Total profit (0 if invalid input)
 *
 * @example
 * // Queue shows "Produce 100 times" with 75,000 profit/hr and 600 actions/hr
 * calculateTotalProfitForActions(75000, 600, 100) // Returns 12,500
 */
export function calculateTotalProfitForActions(profitPerHour, actionsPerHour, actionCount) {
    const profitPerAction = calculateProfitPerAction(profitPerHour, actionsPerHour);
    return profitPerAction * actionCount;
}

/**
 * Calculate profit per day from hourly profit
 * @param {number} profitPerHour - Profit per hour
 * @returns {number} Profit per day
 *
 * @example
 * calculateProfitPerDay(10000) // Returns 240,000
 */
export function calculateProfitPerDay(profitPerHour) {
    return profitPerHour * HOURS_PER_DAY;
}

// ============ Cost Calculations ============

/**
 * Calculate drink consumption rate with Drink Concentration
 * @param {number} drinkConcentration - Drink Concentration stat as decimal (e.g., 0.15 for 15%)
 * @returns {number} Drinks consumed per hour
 *
 * @example
 * calculateDrinksPerHour(0)    // Returns 12 (base rate)
 * calculateDrinksPerHour(0.15) // Returns 13.8 (12 × 1.15)
 */
export function calculateDrinksPerHour(drinkConcentration = 0) {
    return DRINKS_PER_HOUR_BASE * (1 + drinkConcentration);
}

/**
 * Calculate price after marketplace tax
 * @param {number} price - Price before tax
 * @param {number} [taxRate=MARKET_TAX] - Tax rate (e.g., 0.02 for 2%)
 * @returns {number} Price after tax deduction
 *
 * @example
 * calculatePriceAfterTax(100) // Returns 98
 */
export function calculatePriceAfterTax(price, taxRate = MARKET_TAX) {
    return price * (1 - taxRate);
}

/**
 * Calculate action-based totals for production actions
 * Uses per-action base inputs (efficiency only affects time)
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.actionsCount - Number of queued actions
 * @param {number} params.actionsPerHour - Base actions per hour
 * @param {number} params.outputAmount - Items produced per action
 * @param {number} params.outputPrice - Output price per item (pre-tax)
 * @param {number} params.gourmetBonus - Gourmet bonus as decimal (e.g., 0.1 for 10%)
 * @param {Array} [params.bonusDrops] - Bonus drop entries with revenuePerAction
 * @param {Array} [params.materialCosts] - Material cost entries per action
 * @param {number} params.totalTeaCostPerHour - Tea cost per hour
 * @param {number} [params.efficiencyMultiplier=1] - Efficiency multiplier for time scaling
 * @returns {Object} Totals and time values
 */
export function calculateProductionActionTotalsFromBase({
    actionsCount,
    actionsPerHour,
    outputAmount,
    outputPrice,
    gourmetBonus,
    bonusDrops = [],
    materialCosts = [],
    totalTeaCostPerHour,
    efficiencyMultiplier = 1,
}) {
    const effectiveActionsPerHour = actionsPerHour * efficiencyMultiplier;
    if (!effectiveActionsPerHour || effectiveActionsPerHour <= 0) {
        return {
            totalBaseItems: 0,
            totalGourmetItems: 0,
            totalBaseRevenue: 0,
            totalGourmetRevenue: 0,
            totalBonusRevenue: 0,
            totalRevenue: 0,
            totalMarketTax: 0,
            totalMaterialCost: 0,
            totalTeaCost: 0,
            totalCosts: 0,
            totalProfit: 0,
            hoursNeeded: 0,
        };
    }
    const totalBaseItems = outputAmount * actionsCount;
    const totalGourmetItems = outputAmount * gourmetBonus * actionsCount;
    const totalBaseRevenue = totalBaseItems * outputPrice;
    const totalGourmetRevenue = totalGourmetItems * outputPrice;
    const totalBonusRevenue = bonusDrops.reduce((sum, drop) => sum + (drop.revenuePerAction || 0) * actionsCount, 0);
    const totalRevenue = totalBaseRevenue + totalGourmetRevenue + totalBonusRevenue;
    const totalMarketTax = totalRevenue * MARKET_TAX;
    const totalMaterialCost = materialCosts.reduce((sum, material) => sum + material.totalCost * actionsCount, 0);
    const hoursNeeded = calculateHoursForActions(actionsCount, effectiveActionsPerHour);
    const totalTeaCost = totalTeaCostPerHour * hoursNeeded;
    const totalCosts = totalMaterialCost + totalTeaCost + totalMarketTax;
    const totalProfit = totalRevenue - totalCosts;

    return {
        totalBaseItems,
        totalGourmetItems,
        totalBaseRevenue,
        totalGourmetRevenue,
        totalBonusRevenue,
        totalRevenue,
        totalMarketTax,
        totalMaterialCost,
        totalTeaCost,
        totalCosts,
        totalProfit,
        hoursNeeded,
    };
}

/**
 * Calculate action-based totals for gathering actions
 * Uses per-action base inputs (efficiency only affects time)
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.actionsCount - Number of queued actions
 * @param {number} params.actionsPerHour - Base actions per hour
 * @param {Array} [params.baseOutputs] - Base outputs with revenuePerAction
 * @param {Array} [params.bonusDrops] - Bonus drop entries with revenuePerAction
 * @param {number} params.processingRevenueBonusPerAction - Processing bonus per action
 * @param {number} params.drinkCostPerHour - Drink costs per hour
 * @param {number} [params.efficiencyMultiplier=1] - Efficiency multiplier for time scaling
 * @returns {Object} Totals and time values
 */
export function calculateGatheringActionTotalsFromBase({
    actionsCount,
    actionsPerHour,
    baseOutputs = [],
    bonusDrops = [],
    processingRevenueBonusPerAction,
    drinkCostPerHour,
    efficiencyMultiplier = 1,
}) {
    const effectiveActionsPerHour = actionsPerHour * efficiencyMultiplier;
    if (!effectiveActionsPerHour || effectiveActionsPerHour <= 0) {
        return {
            totalBaseRevenue: 0,
            totalBonusRevenue: 0,
            totalProcessingRevenue: 0,
            totalRevenue: 0,
            totalMarketTax: 0,
            totalDrinkCost: 0,
            totalCosts: 0,
            totalProfit: 0,
            hoursNeeded: 0,
        };
    }
    const totalBaseRevenue = baseOutputs.reduce(
        (sum, output) => sum + (output.revenuePerAction || 0) * actionsCount,
        0
    );
    const totalBonusRevenue = bonusDrops.reduce((sum, drop) => sum + (drop.revenuePerAction || 0) * actionsCount, 0);
    const totalProcessingRevenue = (processingRevenueBonusPerAction || 0) * actionsCount;
    const totalRevenue = totalBaseRevenue + totalBonusRevenue + totalProcessingRevenue;
    const totalMarketTax = totalRevenue * MARKET_TAX;
    const hoursNeeded = calculateHoursForActions(actionsCount, effectiveActionsPerHour);
    const totalDrinkCost = drinkCostPerHour * hoursNeeded;
    const totalCosts = totalDrinkCost + totalMarketTax;
    const totalProfit = totalRevenue - totalCosts;

    return {
        totalBaseRevenue,
        totalBonusRevenue,
        totalProcessingRevenue,
        totalRevenue,
        totalMarketTax,
        totalDrinkCost,
        totalCosts,
        totalProfit,
        hoursNeeded,
    };
}

export default {
    // Rate conversions
    calculateActionsPerHour,
    calculateHoursForActions,
    calculateSecondsForActions,

    // Efficiency
    calculateEfficiencyMultiplier,

    // Profit
    calculateProfitPerAction,
    calculateTotalProfitForActions,
    calculateProfitPerDay,

    // Costs
    calculateDrinksPerHour,
    calculatePriceAfterTax,

    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
};
