/**
 * Experience Calculator
 * Shared utility for calculating experience per hour across features
 *
 * Calculates accurate XP/hour including:
 * - Base experience from action
 * - Experience multipliers (Wisdom + Charm Experience)
 * - Action time with speed bonuses
 * - Efficiency repeats (critical for accuracy)
 */

import dataManager from '../core/data-manager.js';
import { calculateActionStats } from './action-calculator.js';
import { calculateExperienceMultiplier } from './experience-parser.js';
import { calculateEfficiencyMultiplier } from './efficiency.js';
import { calculateActionsPerHour, calculateEffectiveActionsPerHour } from './profit-helpers.js';

/**
 * Calculate experience per hour for an action
 * @param {string} actionHrid - The action HRID (e.g., "/actions/cheesesmithing/cheese")
 * @returns {Object|null} Experience data or null if not applicable
 *   {
 *     expPerHour: number,           // Total XP per hour (with all bonuses)
 *     baseExp: number,              // Base XP per action
 *     modifiedXP: number,           // XP per action after multipliers
 *     actionsPerHour: number,       // Actions per hour (with efficiency)
 *     xpMultiplier: number,         // Total XP multiplier (Wisdom + Charm)
 *     actionTime: number,           // Time per action in seconds
 *     totalEfficiency: number       // Total efficiency percentage
 *   }
 */
export function calculateExpPerHour(actionHrid) {
    const actionDetails = dataManager.getActionDetails(actionHrid);

    // Validate action has experience gain
    if (!actionDetails || !actionDetails.experienceGain || !actionDetails.experienceGain.value) {
        return null;
    }

    // Get character data
    const skills = dataManager.getSkills();
    const equipment = dataManager.getEquipment();
    const gameData = dataManager.getInitClientData();

    if (!gameData || !skills || !equipment) {
        return null;
    }

    // Calculate action stats (time + efficiency)
    const stats = calculateActionStats(actionDetails, {
        skills,
        equipment,
        itemDetailMap: gameData.itemDetailMap,
        includeCommunityBuff: true,
        includeBreakdown: false,
        floorActionLevel: true,
    });

    if (!stats) {
        return null;
    }

    const { actionTime, totalEfficiency } = stats;

    // Calculate actions per hour (base rate)
    const baseActionsPerHour = calculateActionsPerHour(actionTime);

    // Calculate average queued actions completed per time-consuming action
    // Efficiency gives guaranteed repeats + chance for extra
    const avgActionsPerBaseAction = calculateEfficiencyMultiplier(totalEfficiency);

    // Calculate actions per hour WITH efficiency (total completions including instant repeats)
    const actionsPerHourWithEfficiency = calculateEffectiveActionsPerHour(baseActionsPerHour, avgActionsPerBaseAction);

    // Calculate experience multiplier (Wisdom + Charm Experience)
    const skillHrid = actionDetails.experienceGain.skillHrid;
    const xpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);

    // Calculate exp per hour with all bonuses
    const baseExp = actionDetails.experienceGain.value;
    const modifiedXP = baseExp * xpData.totalMultiplier;
    const expPerHour = actionsPerHourWithEfficiency * modifiedXP;

    return {
        expPerHour: Math.floor(expPerHour),
        baseExp,
        modifiedXP,
        actionsPerHour: actionsPerHourWithEfficiency,
        xpMultiplier: xpData.totalMultiplier,
        actionTime,
        totalEfficiency,
    };
}

/**
 * Calculate actions and time needed to reach a target level
 * Accounts for progressive efficiency gains (+1% per level)
 * @param {number} currentLevel - Current skill level
 * @param {number} currentXP - Current experience points
 * @param {number} targetLevel - Target skill level
 * @param {number} baseEfficiency - Starting efficiency percentage
 * @param {number} actionTime - Time per action in seconds
 * @param {number} xpPerAction - Modified XP per action (with multipliers, success rate, etc.)
 * @param {Object} levelExperienceTable - XP requirements per level
 * @returns {{ actionsNeeded: number, timeNeeded: number }}
 */
export function calculateMultiLevelProgress(
    currentLevel,
    currentXP,
    targetLevel,
    baseEfficiency,
    actionTime,
    xpPerAction,
    levelExperienceTable
) {
    let totalActions = 0;
    let totalTime = 0;

    for (let level = currentLevel; level < targetLevel; level++) {
        let xpNeeded;
        if (level === currentLevel) {
            xpNeeded = levelExperienceTable[level + 1] - currentXP;
        } else {
            xpNeeded = levelExperienceTable[level + 1] - levelExperienceTable[level];
        }

        // Progressive efficiency: +1% per level gained during grind
        const levelsGained = level - currentLevel;
        const progressiveEfficiency = baseEfficiency + levelsGained;
        const efficiencyMultiplier = 1 + progressiveEfficiency / 100;

        const xpPerPerformedAction = xpPerAction * efficiencyMultiplier;
        const baseActionsForLevel = Math.ceil(xpNeeded / xpPerPerformedAction);
        const actionsToQueue = Math.round(baseActionsForLevel * efficiencyMultiplier);
        totalActions += actionsToQueue;
        totalTime += baseActionsForLevel * actionTime;
    }

    return { actionsNeeded: totalActions, timeNeeded: totalTime };
}

export default {
    calculateExpPerHour,
    calculateMultiLevelProgress,
};
