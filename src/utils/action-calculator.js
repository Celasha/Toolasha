/**
 * Action Calculator
 * Shared calculation logic for action time and efficiency
 * Used by action-time-display.js and quick-input-buttons.js
 */

import dataManager from '../core/data-manager.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from './equipment-parser.js';
import {
    parseTeaEfficiency,
    parseTeaEfficiencyBreakdown,
    getDrinkConcentration,
    parseActionLevelBonus,
    parseActionLevelBonusBreakdown,
    parseTeaSkillLevelBonus,
} from './tea-parser.js';
import { calculateHouseEfficiency } from './house-efficiency.js';
import { stackAdditive } from './efficiency.js';

/**
 * Calculate complete action statistics (time + efficiency)
 * @param {Object} actionDetails - Action detail object from game data
 * @param {Object} options - Configuration options
 * @param {Array} options.skills - Character skills array
 * @param {Array} options.equipment - Character equipment array
 * @param {Object} options.itemDetailMap - Item detail map from game data
 * @param {string} options.actionHrid - Action HRID for task detection (optional)
 * @param {boolean} options.includeCommunityBuff - Include community buff in efficiency (default: false)
 * @param {boolean} options.includeBreakdown - Include detailed breakdown data (default: false)
 * @param {boolean} options.floorActionLevel - Floor Action Level bonus for requirement calculation (default: true)
 * @param {number} options.levelRequirementOverride - Override base level requirement (e.g., item level for alchemy)
 * @returns {Object} { actionTime, totalEfficiency, breakdown? }
 */
export function calculateActionStats(actionDetails, options = {}) {
    const {
        skills,
        equipment,
        itemDetailMap,
        actionHrid,
        includeCommunityBuff = false,
        includeBreakdown = false,
        floorActionLevel = true,
        levelRequirementOverride,
    } = options;

    try {
        // Calculate base action time
        const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

        // Get equipment speed bonus
        const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap);
        const personalSpeedBonus = dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/action_speed');

        // Calculate action time with equipment speed
        let actionTime = baseTime / (1 + speedBonus + personalSpeedBonus);

        // Apply task speed multiplicatively (if action is an active task)
        if (actionHrid && dataManager.isTaskAction(actionHrid)) {
            const taskSpeedBonus = dataManager.getTaskSpeedBonus(); // Returns percentage (e.g., 15 for 15%)
            actionTime = actionTime / (1 + taskSpeedBonus / 100); // Apply multiplicatively
        }

        // Calculate efficiency
        const skillLevel = getSkillLevel(skills, actionDetails.type);
        const baseRequirement = levelRequirementOverride ?? actionDetails.levelRequirement?.level ?? 1;

        // Get drink concentration
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

        // Calculate Action Level bonus from teas
        const actionLevelBonus = parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);

        // Get Action Level bonus breakdown (if requested)
        let actionLevelBreakdown = null;
        if (includeBreakdown) {
            actionLevelBreakdown = parseActionLevelBonusBreakdown(activeDrinks, itemDetailMap, drinkConcentration);
        }

        // Calculate effective requirement
        // Note: floorActionLevel flag for compatibility
        // - quick-input-buttons uses Math.floor (can't have fractional level requirements)
        // - action-time-display historically didn't floor (preserving for compatibility)
        const effectiveRequirement =
            baseRequirement + (floorActionLevel ? Math.floor(actionLevelBonus) : actionLevelBonus);

        // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
        const teaSkillLevelBonus = parseTeaSkillLevelBonus(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate efficiency components
        // Apply tea skill level bonus to effective player level
        const effectiveLevel = skillLevel + teaSkillLevelBonus;
        const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);
        const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap);
        const achievementEfficiency =
            dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;
        const personalEfficiency =
            dataManager.getPersonalBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

        // Calculate tea efficiency
        let teaEfficiency;
        let teaBreakdown = null;
        if (includeBreakdown) {
            // Get detailed breakdown
            teaBreakdown = parseTeaEfficiencyBreakdown(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );
            teaEfficiency = teaBreakdown.reduce((sum, tea) => sum + tea.efficiency, 0);
        } else {
            // Simple total
            teaEfficiency = parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);
        }

        // Get community buff efficiency (if requested)
        let communityEfficiency = 0;
        if (includeCommunityBuff) {
            // Production Efficiency buff applies to production skills and alchemy
            const productionSkills = [
                '/action_types/alchemy',
                '/action_types/brewing',
                '/action_types/cheesesmithing',
                '/action_types/cooking',
                '/action_types/crafting',
                '/action_types/tailoring',
            ];

            if (productionSkills.includes(actionDetails.type)) {
                const communityBuffLevel = dataManager.getCommunityBuffLevel(
                    '/community_buff_types/production_efficiency'
                );
                communityEfficiency = communityBuffLevel ? (0.14 + (communityBuffLevel - 1) * 0.003) * 100 : 0;
            }
        }

        // Total efficiency (stack all components additively)
        const totalEfficiency = stackAdditive(
            levelEfficiency,
            houseEfficiency,
            equipmentEfficiency,
            teaEfficiency,
            communityEfficiency,
            achievementEfficiency,
            personalEfficiency
        );

        // Build result object
        const result = {
            actionTime,
            totalEfficiency,
        };

        // Add breakdown if requested
        if (includeBreakdown) {
            result.efficiencyBreakdown = {
                levelEfficiency,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                teaBreakdown,
                communityEfficiency,
                achievementEfficiency,
                personalEfficiency,
                skillLevel,
                baseRequirement,
                actionLevelBonus,
                actionLevelBreakdown,
                effectiveRequirement,
            };
        }

        return result;
    } catch (error) {
        console.error('[Action Calculator] Error calculating action stats:', error);
        return null;
    }
}

/**
 * Get character skill level for a skill type
 * @param {Array} skills - Character skills array
 * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
 * @returns {number} Skill level
 */
function getSkillLevel(skills, skillType) {
    // Map action type to skill HRID
    const skillHrid = skillType.replace('/action_types/', '/skills/');
    const skill = skills.find((s) => s.skillHrid === skillHrid);
    return skill?.level || 1;
}
