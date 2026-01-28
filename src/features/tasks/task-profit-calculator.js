/**
 * Task Profit Calculator
 * Calculates total profit for gathering and production tasks
 * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
 */

import dataManager from '../../core/data-manager.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculateGatheringProfit } from '../actions/gathering-profit.js';
import { calculateProductionProfit } from '../actions/production-profit.js';
import {
    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
} from '../../utils/profit-helpers.js';

/**
 * Calculate Task Token value from Task Shop items
 * Uses same approach as Ranged Way Idle - find best Task Shop item
 * @returns {Object} Token value breakdown or error state
 */
export function calculateTaskTokenValue() {
    // Return error state if expected value calculator isn't ready
    if (!expectedValueCalculator.isInitialized) {
        return {
            tokenValue: null,
            giftPerTask: null,
            totalPerToken: null,
            error: 'Market data not loaded',
        };
    }

    const taskShopItems = [
        '/items/large_meteorite_cache',
        '/items/large_artisans_crate',
        '/items/large_treasure_chest',
    ];

    // Get expected value of each Task Shop item (all cost 30 tokens)
    const expectedValues = taskShopItems.map((itemHrid) => {
        const result = expectedValueCalculator.calculateExpectedValue(itemHrid);
        return result?.expectedValue || 0;
    });

    // Use best (highest value) item
    const bestValue = Math.max(...expectedValues);

    // Task Token value = best chest value / 30 (cost in tokens)
    const taskTokenValue = bestValue / 30;

    // Calculate Purple's Gift prorated value (divide by 50 tasks)
    const giftResult = expectedValueCalculator.calculateExpectedValue('/items/purples_gift');
    const giftValue = giftResult?.expectedValue || 0;
    const giftPerTask = giftValue / 50;

    return {
        tokenValue: taskTokenValue,
        giftPerTask: giftPerTask,
        totalPerToken: taskTokenValue + giftPerTask,
        error: null,
    };
}

/**
 * Calculate task reward value (coins + tokens + Purple's Gift)
 * @param {number} coinReward - Coin reward amount
 * @param {number} taskTokenReward - Task token reward amount
 * @returns {Object} Reward value breakdown
 */
export function calculateTaskRewardValue(coinReward, taskTokenReward) {
    const tokenData = calculateTaskTokenValue();

    // Handle error state (market data not loaded)
    if (tokenData.error) {
        return {
            coins: coinReward,
            taskTokens: 0,
            purpleGift: 0,
            total: coinReward,
            breakdown: {
                tokenValue: 0,
                tokensReceived: taskTokenReward,
                giftPerTask: 0,
            },
            error: tokenData.error,
        };
    }

    const taskTokenValue = taskTokenReward * tokenData.tokenValue;
    const purpleGiftValue = taskTokenReward * tokenData.giftPerTask;

    return {
        coins: coinReward,
        taskTokens: taskTokenValue,
        purpleGift: purpleGiftValue,
        total: coinReward + taskTokenValue + purpleGiftValue,
        breakdown: {
            tokenValue: tokenData.tokenValue,
            tokensReceived: taskTokenReward,
            giftPerTask: tokenData.giftPerTask,
        },
        error: null,
    };
}

/**
 * Detect task type from description
 * @param {string} taskDescription - Task description text (e.g., "Cheesesmithing - Holy Cheese")
 * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
 */
function detectTaskType(taskDescription) {
    // Extract skill from "Skill - Action" format
    const skillMatch = taskDescription.match(/^([^-]+)\s*-/);
    if (!skillMatch) return 'unknown';

    const skill = skillMatch[1].trim().toLowerCase();

    // Gathering skills
    if (['foraging', 'woodcutting', 'milking'].includes(skill)) {
        return 'gathering';
    }

    // Production skills
    if (['cheesesmithing', 'brewing', 'cooking', 'crafting', 'tailoring'].includes(skill)) {
        return 'production';
    }

    // Combat
    if (skill === 'defeat') {
        return 'combat';
    }

    return 'unknown';
}

/**
 * Parse task description to extract action HRID
 * Format: "Skill - Action Name" (e.g., "Cheesesmithing - Holy Cheese", "Milking - Cow")
 * @param {string} taskDescription - Task description text
 * @param {string} taskType - Task type (gathering/production)
 * @param {number} quantity - Task quantity
 * @param {number} currentProgress - Current progress (actions completed)
 * @returns {Object|null} {actionHrid, quantity, currentProgress, description} or null if parsing fails
 */
function parseTaskDescription(taskDescription, taskType, quantity, currentProgress) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) {
        return null;
    }

    const actionDetailMap = gameData.actionDetailMap;
    if (!actionDetailMap) {
        return null;
    }

    // Extract action name from "Skill - Action" format
    const match = taskDescription.match(/^[^-]+\s*-\s*(.+)$/);
    if (!match) {
        return null;
    }

    const actionName = match[1].trim();

    // Find matching action HRID by searching for action name in action details
    for (const [actionHrid, actionDetail] of Object.entries(actionDetailMap)) {
        if (actionDetail.name && actionDetail.name.toLowerCase() === actionName.toLowerCase()) {
            return { actionHrid, quantity, currentProgress, description: taskDescription };
        }
    }

    return null;
}

/**
 * Calculate gathering task profit
 * @param {string} actionHrid - Action HRID
 * @param {number} quantity - Number of times to perform action
 * @returns {Promise<Object>} Profit breakdown
 */
async function calculateGatheringTaskProfit(actionHrid, quantity) {
    let profitData;
    try {
        profitData = await calculateGatheringProfit(actionHrid);
    } catch {
        profitData = null;
    }

    if (!profitData) {
        return {
            totalValue: 0,
            breakdown: {
                actionHrid,
                quantity,
                perAction: 0,
            },
        };
    }

    const hasMissingPrices = profitData.hasMissingPrices;

    const totals = calculateGatheringActionTotalsFromBase({
        actionsCount: quantity,
        actionsPerHour: profitData.actionsPerHour,
        baseOutputs: profitData.baseOutputs,
        bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
        processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
        gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
        drinkCostPerHour: profitData.drinkCostPerHour,
        efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
    });

    return {
        totalValue: hasMissingPrices ? null : totals.totalProfit,
        hasMissingPrices,
        breakdown: {
            actionHrid,
            quantity,
            perAction: quantity > 0 ? totals.totalProfit / quantity : 0,
        },
        // Include detailed data for expandable display
        details: {
            profitPerHour: profitData.profitPerHour,
            actionsPerHour: profitData.actionsPerHour,
            baseOutputs: profitData.baseOutputs,
            gourmetBonuses: profitData.gourmetBonuses,
            bonusRevenue: profitData.bonusRevenue,
            processingConversions: profitData.processingConversions,
            processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
            processingBonus: profitData.processingBonus,
            gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
            gourmetBonus: profitData.gourmetBonus,
            efficiencyMultiplier: profitData.efficiencyMultiplier,
        },
    };
}

/**
 * Calculate production task profit
 * @param {string} actionHrid - Action HRID
 * @param {number} quantity - Number of times to perform action
 * @returns {Promise<Object>} Profit breakdown
 */
async function calculateProductionTaskProfit(actionHrid, quantity) {
    let profitData;
    try {
        profitData = await calculateProductionProfit(actionHrid);
    } catch {
        profitData = null;
    }

    if (!profitData) {
        return {
            totalProfit: 0,
            breakdown: {
                actionHrid,
                quantity,
                outputValue: 0,
                materialCost: 0,
                perAction: 0,
            },
        };
    }

    const hasMissingPrices = profitData.hasMissingPrices;

    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const totals = calculateProductionActionTotalsFromBase({
        actionsCount: quantity,
        actionsPerHour: profitData.actionsPerHour,
        outputAmount: profitData.outputAmount || 1,
        outputPrice: profitData.outputPrice,
        gourmetBonus: profitData.gourmetBonus || 0,
        bonusDrops,
        materialCosts: profitData.materialCosts,
        totalTeaCostPerHour: profitData.totalTeaCostPerHour,
        efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
    });

    return {
        totalProfit: hasMissingPrices ? null : totals.totalProfit,
        hasMissingPrices,
        breakdown: {
            actionHrid,
            quantity,
            outputValue: totals.totalBaseRevenue + totals.totalGourmetRevenue,
            materialCost: totals.totalMaterialCost + totals.totalTeaCost,
            perAction: quantity > 0 ? totals.totalProfit / quantity : 0,
        },
        // Include detailed data for expandable display
        details: {
            profitPerHour: profitData.profitPerHour,
            materialCosts: profitData.materialCosts,
            teaCosts: profitData.teaCosts,
            outputAmount: profitData.outputAmount,
            itemName: profitData.itemName,
            itemHrid: profitData.itemHrid,
            gourmetBonus: profitData.gourmetBonus,
            priceEach: profitData.outputPrice,
            outputPriceMissing: profitData.outputPriceMissing,
            actionsPerHour: profitData.actionsPerHour,
            bonusRevenue: profitData.bonusRevenue, // Pass through bonus revenue data
        },
    };
}

/**
 * Calculate complete task profit
 * @param {Object} taskData - Task data {description, coinReward, taskTokenReward}
 * @returns {Promise<Object|null>} Complete profit breakdown or null for combat/unknown tasks
 */
export async function calculateTaskProfit(taskData) {
    const taskType = detectTaskType(taskData.description);

    // Skip combat tasks entirely
    if (taskType === 'combat') {
        return null;
    }

    // Parse task details
    const taskInfo = parseTaskDescription(taskData.description, taskType, taskData.quantity, taskData.currentProgress);
    if (!taskInfo) {
        // Return error state for UI to display "Unable to calculate"
        return {
            type: taskType,
            error: 'Unable to parse task description',
            totalProfit: 0,
        };
    }

    // Calculate task rewards
    const rewardValue = calculateTaskRewardValue(taskData.coinReward, taskData.taskTokenReward);

    // Calculate action profit based on task type
    let actionProfit = null;
    if (taskType === 'gathering') {
        actionProfit = await calculateGatheringTaskProfit(taskInfo.actionHrid, taskInfo.quantity);
    } else if (taskType === 'production') {
        actionProfit = await calculateProductionTaskProfit(taskInfo.actionHrid, taskInfo.quantity);
    }

    if (!actionProfit) {
        return {
            type: taskType,
            error: 'Unable to calculate action profit',
            totalProfit: 0,
        };
    }

    // Calculate total profit
    const actionValue = taskType === 'production' ? actionProfit.totalProfit : actionProfit.totalValue;
    const hasMissingPrices = actionProfit.hasMissingPrices;
    const totalProfit = hasMissingPrices ? null : rewardValue.total + actionValue;

    return {
        type: taskType,
        totalProfit,
        hasMissingPrices,
        rewards: rewardValue,
        action: actionProfit,
        taskInfo: taskInfo,
    };
}
