/**
 * Task Profit Calculator
 * Calculates total profit for gathering and production tasks
 * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
 */

import dataManager from '../../core/data-manager.js';
import { t } from '../../core/i18n.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculateGatheringProfit } from '../actions/gathering-profit.js';
import { calculateProductionProfit } from '../actions/production-profit.js';
import {
    calculateProductionActionTotalsFromBase,
    calculateGatheringActionTotalsFromBase,
} from '../../utils/profit-helpers.js';
import { GATHERING_TYPES, PRODUCTION_TYPES } from '../../utils/profit-constants.js';
import { getActionHridFromName } from '../../utils/game-lookups.js';

const GATHERING_TYPE_SET = new Set(GATHERING_TYPES);
const PRODUCTION_TYPE_SET = new Set(PRODUCTION_TYPES);

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
            error: t('taskProfitCalculator.marketDataNotLoadedError'),
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
        if (!result) {
            console.warn(`[TaskProfit] Expected value returned null for task shop item: ${itemHrid}`);
        }
        return result?.expectedValue || 0;
    });

    // Use best (highest value) item
    const bestValue = Math.max(...expectedValues);

    // Task Token value = best chest value / 30 (cost in tokens)
    const taskTokenValue = bestValue / 30;

    // Calculate Purple's Gift prorated value (divide by 50 tasks)
    const giftResult = expectedValueCalculator.calculateExpectedValue('/items/purples_gift');
    if (!giftResult) {
        console.warn('[TaskProfit] Expected value returned null for /items/purples_gift');
    }
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
 * Detect task type from locale-independent quest info
 * @param {Object} questInfo - Quest info { actionHrid, monsterHrid } from the task card's React fiber
 * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
 */
function detectTaskType(questInfo) {
    // Combat quests carry a monsterHrid
    if (questInfo?.monsterHrid) {
        return 'combat';
    }

    const actionHrid = questInfo?.actionHrid;
    if (!actionHrid) {
        return 'unknown';
    }

    const actionDetail = dataManager.getInitClientData()?.actionDetailMap?.[actionHrid];
    const actionTypeHrid = actionDetail?.actionTypeHrid || actionDetail?.type;
    if (!actionTypeHrid) {
        return 'unknown';
    }

    if (actionTypeHrid === '/action_types/combat') {
        return 'combat';
    }
    if (GATHERING_TYPE_SET.has(actionTypeHrid)) {
        return 'gathering';
    }
    if (PRODUCTION_TYPE_SET.has(actionTypeHrid)) {
        return 'production';
    }

    return 'unknown';
}

/**
 * Detect task type from the English "Skill - Action" description text.
 * Fallback only - the skill name is translated in non-English clients, so this can only
 * ever resolve on the English UI; quest-info-based detection is the preferred path.
 * @param {string} taskDescription - Task description text (e.g., "Cheesesmithing - Holy Cheese")
 * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
 */
function detectTaskTypeFromDescription(taskDescription) {
    // Extract skill from "Skill - Action" format
    const skillMatch = taskDescription.match(/^([^-]+)\s*-/);
    if (!skillMatch) return 'unknown';

    const skill = skillMatch[1].trim().toLowerCase();

    // Gathering skills
    if (GATHERING_TYPES.some((hrid) => hrid.split('/').pop() === skill)) {
        return 'gathering';
    }

    // Production skills
    if (PRODUCTION_TYPES.some((hrid) => hrid.split('/').pop() === skill)) {
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
        console.warn('[TaskProfit] parseTaskDescription: initClientData is null', { taskDescription, taskType });
        return null;
    }

    const actionDetailMap = gameData.actionDetailMap;
    if (!actionDetailMap) {
        console.warn('[TaskProfit] parseTaskDescription: actionDetailMap missing from initClientData', {
            taskDescription,
        });
        return null;
    }

    // Extract action name from "Skill - Action" format
    const match = taskDescription.match(/^[^-]+\s*-\s*(.+)$/);
    if (!match) {
        console.warn('[TaskProfit] parseTaskDescription: regex did not match description', { taskDescription });
        return null;
    }

    const actionName = match[1].trim();

    // Find matching action HRID via the locale-aware name lookup (matches translated
    // display names as well as the client's English data names)
    const actionHrid = getActionHridFromName(actionName);
    if (actionHrid) {
        return { actionHrid, quantity, currentProgress, description: taskDescription };
    }

    console.warn('[TaskProfit] parseTaskDescription: no actionHrid found for action name', {
        taskDescription,
        extractedActionName: actionName,
        taskType,
        actionDetailMapSize: Object.keys(actionDetailMap).length,
    });
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
        excludeSellTax: profitData.excludeSellTax,
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
        excludeSellTax: profitData.excludeSellTax,
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
            efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
            bonusRevenue: profitData.bonusRevenue, // Pass through bonus revenue data
        },
    };
}

/**
 * Calculate complete task profit
 * @param {Object} taskData - Task data {description, coinReward, taskTokenReward}
 * @param {Object|null} [questInfo=null] - Locale-independent quest info {actionHrid, monsterHrid}
 * resolved from the task card's React fiber. When provided, description text parsing is skipped.
 * @returns {Promise<Object|null>} Complete profit breakdown or null for combat/unknown tasks
 */
export async function calculateTaskProfit(taskData, questInfo = null) {
    let taskType;
    let taskInfo = null;

    if (questInfo) {
        taskType = detectTaskType(questInfo);

        // Skip combat tasks entirely
        if (taskType === 'combat') {
            return null;
        }

        // HRID known directly from the quest - skip the translated description text parsing
        if (questInfo.actionHrid && (taskType === 'gathering' || taskType === 'production')) {
            taskInfo = {
                actionHrid: questInfo.actionHrid,
                quantity: taskData.quantity,
                currentProgress: taskData.currentProgress,
                description: taskData.description,
            };
        }
    } else {
        // Fallback path: derive the type from the English "Skill - Action" description text
        taskType = detectTaskTypeFromDescription(taskData.description);

        // Skip combat tasks entirely
        if (taskType === 'combat') {
            return null;
        }
    }

    // Fallback parsing from description text (quest info missing, or type unknown above)
    if (!taskInfo) {
        taskInfo = parseTaskDescription(
            taskData.description,
            taskType,
            taskData.quantity,
            taskData.currentProgress
        );
        if (!taskInfo) {
            // Return error state for UI to display "Unable to calculate"
            return {
                type: taskType,
                error: 'Unable to parse task description',
                totalProfit: 0,
            };
        }

        // Text parsing resolved the action - re-derive its type from the action HRID so the
        // correct profit calculator runs even if the description-based guess was 'unknown'
        if (taskType !== 'gathering' && taskType !== 'production') {
            taskType = detectTaskType({ actionHrid: taskInfo.actionHrid });
        }
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
