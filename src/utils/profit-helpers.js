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
 * @param {number} actionCount - Number of actions/attempts
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
 * @param {number} actionCount - Number of actions/attempts
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
 * Efficiency gives bonus action completions per attempt
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
 * @returns {number} Profit per action/attempt (0 if invalid input)
 *
 * @example
 * // With 150% efficiency (2.5x), 600 actions/hr, 50 profit/item:
 * // profitPerHour = 600 × 2.5 × 50 = 75,000
 * calculateProfitPerAction(75000, 600) // Returns 125 (profit per attempt)
 */
export function calculateProfitPerAction(profitPerHour, actionsPerHour) {
    if (!actionsPerHour || actionsPerHour <= 0) {
        return 0;
    }
    return profitPerHour / actionsPerHour;
}

/**
 * Calculate total profit for a number of actions/attempts
 *
 * @param {number} profitPerHour - Profit per hour (includes efficiency)
 * @param {number} actionsPerHour - Base actions per hour (without efficiency)
 * @param {number} actionCount - Number of actions/attempts
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
 * @returns {number} Price after 2% tax deduction
 *
 * @example
 * calculatePriceAfterTax(100) // Returns 98
 */
export function calculatePriceAfterTax(price) {
    return price * (1 - MARKET_TAX);
}

// ============ Composite Calculations ============

/**
 * Calculate complete profit breakdown for queued actions
 * Takes raw inputs and returns all intermediate + final values
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.profitPerHour - Profit per hour (from profit calculator)
 * @param {number} params.actionsPerHour - Base actions per hour (from profit calculator)
 * @param {number} params.actionCount - Number of queued actions/attempts
 * @param {number} [params.revenuePerHour] - Revenue per hour (optional, for estimated value mode)
 * @param {string} [params.valueMode='profit'] - 'profit' or 'estimated_value'
 * @returns {Object} Profit breakdown with all calculated values
 *
 * @example
 * calculateQueueProfitBreakdown({
 *     profitPerHour: 75000,
 *     actionsPerHour: 600,
 *     actionCount: 100,
 * })
 * // Returns: { totalProfit: 12500, profitPerAction: 125, hoursNeeded: 0.167, ... }
 */
export function calculateQueueProfitBreakdown({
    profitPerHour,
    actionsPerHour,
    actionCount,
    revenuePerHour,
    valueMode = 'profit',
}) {
    // Determine which value to use based on mode
    const valuePerHour =
        valueMode === 'estimated_value' && revenuePerHour !== undefined ? revenuePerHour : profitPerHour;

    // Calculate derived values
    const profitPerAction = calculateProfitPerAction(valuePerHour, actionsPerHour);
    const totalProfit = profitPerAction * actionCount;
    const hoursNeeded = calculateHoursForActions(actionCount, actionsPerHour);
    const secondsNeeded = hoursNeeded * SECONDS_PER_HOUR;

    return {
        // Final values
        totalProfit,
        profitPerAction,

        // Time values
        hoursNeeded,
        secondsNeeded,

        // Input values (for reference)
        valuePerHour,
        actionsPerHour,
        actionCount,
        valueMode,
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

    // Composite
    calculateQueueProfitBreakdown,
};
