/**
 * Task Profit Calculator
 * Calculates total profit for gathering and production tasks
 * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
 */

import dataManager from '../../core/data-manager.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculateGatheringProfit } from '../actions/gathering-profit.js';
import { calculateProductionProfit } from '../actions/production-profit.js';

/**
 * Calculate Task Token value from Task Shop items
 * Uses same approach as Ranged Way Idle - find best Task Shop item
 * @returns {Object} Token value breakdown
 */
export function calculateTaskTokenValue() {
    const taskShopItems = [
        '/items/large_meteorite_cache',
        '/items/large_artisans_crate',
        '/items/large_treasure_chest'
    ];

    // Get expected value of each Task Shop item (all cost 30 tokens)
    const expectedValues = taskShopItems.map(itemHrid => {
        const result = expectedValueCalculator.calculate(itemHrid);
        return result?.expectedValue || 0;
    });

    // Use best (highest value) item
    const bestValue = Math.max(...expectedValues);

    // Task Token value = best chest value / 30 (cost in tokens)
    const taskTokenValue = bestValue / 30;

    // Calculate Purple's Gift prorated value (divide by 50 tasks)
    const giftResult = expectedValueCalculator.calculate('/items/purples_gift');
    const giftValue = giftResult?.expectedValue || 0;
    const giftPerTask = giftValue / 50;

    return {
        tokenValue: taskTokenValue,
        giftPerTask: giftPerTask,
        totalPerToken: taskTokenValue + giftPerTask
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
            giftPerTask: tokenData.giftPerTask
        }
    };
}

/**
 * Detect task type from description
 * @param {string} taskDescription - Task description text
 * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
 */
function detectTaskType(taskDescription) {
    // Gathering patterns: "Forage", "Gather", "Milk", "Chop"
    if (/forage|gather|milk|chop|woodcut/i.test(taskDescription)) {
        return 'gathering';
    }

    // Production patterns: "Make", "Craft", "Brew", "Cook", "Tailor"
    if (/make|craft|brew|cook|tailor|cheesesmith/i.test(taskDescription)) {
        return 'production';
    }

    // Combat patterns: "Kill", "Defeat"
    if (/kill|defeat/i.test(taskDescription)) {
        return 'combat';
    }

    return 'unknown';
}

/**
 * Parse task description to extract action HRID and quantity
 * @param {string} taskDescription - Task description text
 * @param {string} taskType - Task type (gathering/production)
 * @returns {Object|null} {actionHrid, quantity} or null if parsing fails
 */
function parseTaskDescription(taskDescription, taskType) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return null;

    const actionDetailMap = gameData.actionDetailMap;
    if (!actionDetailMap) return null;

    // Extract quantity and action name based on task type
    let quantity = 0;
    let actionName = '';

    if (taskType === 'gathering') {
        // Pattern: "Forage Asteroid Belt 1000 times"
        const match = taskDescription.match(/^(\w+)\s+(.+?)\s+(\d+)\s+times?$/i);
        if (match) {
            quantity = parseInt(match[3]);
            actionName = match[2]; // "Asteroid Belt"
        }
    } else if (taskType === 'production') {
        // Pattern: "Make 5 Wooden Nature Staff"
        const match = taskDescription.match(/^Make\s+(\d+)\s+(.+)$/i);
        if (match) {
            quantity = parseInt(match[1]);
            actionName = match[2]; // "Wooden Nature Staff"
        }
    }

    if (!quantity || !actionName) {
        return null;
    }

    // Find matching action HRID by searching for action name in action details
    for (const [actionHrid, actionDetail] of Object.entries(actionDetailMap)) {
        if (actionDetail.name && actionDetail.name.toLowerCase() === actionName.toLowerCase()) {
            return { actionHrid, quantity };
        }
    }

    return null;
}

/**
 * Calculate gathering task profit
 * @param {string} actionHrid - Action HRID
 * @param {number} quantity - Number of times to perform action
 * @returns {Object} Profit breakdown
 */
function calculateGatheringTaskProfit(actionHrid, quantity) {
    const profitPerAction = calculateGatheringProfit(actionHrid);

    return {
        totalValue: profitPerAction * quantity,
        breakdown: {
            actionHrid,
            quantity,
            perAction: profitPerAction
        }
    };
}

/**
 * Calculate production task profit
 * @param {string} actionHrid - Action HRID
 * @param {number} quantity - Number of times to perform action
 * @returns {Object} Profit breakdown
 */
function calculateProductionTaskProfit(actionHrid, quantity) {
    const profitData = calculateProductionProfit(actionHrid);

    if (!profitData) {
        return {
            totalProfit: 0,
            breakdown: {
                actionHrid,
                quantity,
                outputValue: 0,
                materialCost: 0,
                perAction: 0
            }
        };
    }

    return {
        totalProfit: profitData.profit * quantity,
        breakdown: {
            actionHrid,
            quantity,
            outputValue: profitData.outputValue * quantity,
            materialCost: profitData.inputCost * quantity,
            perAction: profitData.profit
        }
    };
}

/**
 * Calculate complete task profit
 * @param {Object} taskData - Task data {description, coinReward, taskTokenReward}
 * @returns {Object|null} Complete profit breakdown or null for combat/unknown tasks
 */
export function calculateTaskProfit(taskData) {
    const taskType = detectTaskType(taskData.description);

    // Skip combat tasks entirely
    if (taskType === 'combat') {
        return null;
    }

    // Parse task details
    const taskInfo = parseTaskDescription(taskData.description, taskType);
    if (!taskInfo) {
        // Return error state for UI to display "Unable to calculate"
        return {
            type: taskType,
            error: 'Unable to parse task description',
            totalProfit: 0
        };
    }

    // Calculate task rewards
    const rewardValue = calculateTaskRewardValue(
        taskData.coinReward,
        taskData.taskTokenReward
    );

    // Calculate action profit based on task type
    let actionProfit = null;
    if (taskType === 'gathering') {
        actionProfit = calculateGatheringTaskProfit(
            taskInfo.actionHrid,
            taskInfo.quantity
        );
    } else if (taskType === 'production') {
        actionProfit = calculateProductionTaskProfit(
            taskInfo.actionHrid,
            taskInfo.quantity
        );
    }

    if (!actionProfit) {
        return {
            type: taskType,
            error: 'Unable to calculate action profit',
            totalProfit: 0
        };
    }

    // Calculate total profit
    const actionValue = taskType === 'production' ? actionProfit.totalProfit : actionProfit.totalValue;
    const totalProfit = rewardValue.total + actionValue;

    return {
        type: taskType,
        totalProfit,
        rewards: rewardValue,
        action: actionProfit,
        taskInfo: taskInfo
    };
}
