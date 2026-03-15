/**
 * Enhancement XP Calculations
 * Based on Ultimate Enhancement Tracker formulas
 */

import dataManager from '../../core/data-manager.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { MIN_ACTION_TIME_SECONDS } from '../../utils/profit-constants.js';

/**
 * Get base item level from item HRID
 * @param {string} itemHrid - Item HRID
 * @returns {number} Base item level
 */
function getBaseItemLevel(itemHrid) {
    try {
        const gameData = dataManager.getInitClientData();
        const itemData = gameData?.itemDetailMap?.[itemHrid];

        // First try direct level field (works for consumables, resources, etc.)
        if (itemData?.level) {
            return itemData.level;
        }

        // For equipment, check levelRequirements array
        if (itemData?.equipmentDetail?.levelRequirements?.length > 0) {
            // Return the level from the first requirement (highest requirement)
            return itemData.equipmentDetail.levelRequirements[0].level;
        }

        return 0;
    } catch {
        return 0;
    }
}

/**
 * Get wisdom buff percentage from all sources
 * Reads from dataManager.characterData (NOT localStorage)
 * @returns {number} Wisdom buff as decimal (e.g., 0.20 for 20%)
 */
function getWisdomBuff() {
    try {
        // Use dataManager for character data (NOT localStorage)
        const charData = dataManager.characterData;
        if (!charData) return 0;

        let totalFlatBoost = 0;

        // 1. Community Buffs
        const communityEnhancingBuffs = charData.communityActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(communityEnhancingBuffs)) {
            communityEnhancingBuffs.forEach((buff) => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 2. Equipment Buffs
        const equipmentEnhancingBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(equipmentEnhancingBuffs)) {
            equipmentEnhancingBuffs.forEach((buff) => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 3. House Buffs
        const houseEnhancingBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(houseEnhancingBuffs)) {
            houseEnhancingBuffs.forEach((buff) => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 4. Consumable Buffs (from wisdom tea, etc.)
        const consumableEnhancingBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(consumableEnhancingBuffs)) {
            consumableEnhancingBuffs.forEach((buff) => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 5. Achievement Buffs
        totalFlatBoost += dataManager.getAchievementBuffFlatBoost('/action_types/enhancing', '/buff_types/wisdom');

        // Return as decimal (flatBoost is already in decimal form, e.g., 0.2 for 20%)
        return totalFlatBoost;
    } catch {
        return 0;
    }
}

/**
 * Calculate XP gained from successful enhancement
 * Formula: 1.4 × (1 + wisdom) × enhancementMultiplier × (10 + baseItemLevel)
 * @param {number} previousLevel - Enhancement level before success
 * @param {string} itemHrid - Item HRID
 * @returns {number} XP gained
 */
export function calculateSuccessXP(previousLevel, itemHrid) {
    const baseLevel = getBaseItemLevel(itemHrid);
    const wisdomBuff = getWisdomBuff();

    // Special handling for enhancement level 0 (base items)
    const enhancementMultiplier =
        previousLevel === 0
            ? 1.0 // Base value for unenhanced items
            : previousLevel + 1; // Normal progression

    return Math.floor(1.4 * (1 + wisdomBuff) * enhancementMultiplier * (10 + baseLevel));
}

/**
 * Calculate XP gained from failed enhancement
 * Formula: 10% of success XP
 * @param {number} previousLevel - Enhancement level that failed
 * @param {string} itemHrid - Item HRID
 * @returns {number} XP gained
 */
export function calculateFailureXP(previousLevel, itemHrid) {
    return Math.floor(calculateSuccessXP(previousLevel, itemHrid) * 0.1);
}

/**
 * Calculate adjusted attempt number from session data
 * This makes tracking resume-proof (doesn't rely on WebSocket currentCount)
 * @param {Object} session - Session object
 * @returns {number} Next attempt number
 */
export function calculateAdjustedAttemptCount(session) {
    let successCount = 0;
    let failCount = 0;

    // Sum all successes and failures across all levels
    for (const level in session.attemptsPerLevel) {
        const levelData = session.attemptsPerLevel[level];
        successCount += levelData.success || 0;
        failCount += levelData.fail || 0;
    }

    // For the first attempt, return 1
    if (successCount === 0 && failCount === 0) {
        return 1;
    }

    // Return total + 1 for the next attempt
    return successCount + failCount + 1;
}

/**
 * Calculate enhancing action time from the game's buff maps
 * Reads the pre-computed action_speed flatBoost values from all buff sources
 * and adds level advantage, matching the game's actual speed calculation
 * @param {string} itemHrid - Item HRID being enhanced
 * @returns {number} Per-action time in seconds
 */
function getEnhancingActionTime(itemHrid) {
    try {
        const charData = dataManager.characterData;
        if (!charData) return 12;

        // Get base time from game data
        const actionDetails = dataManager.getActionDetails('/actions/enhancing/enhance');
        const baseTime = actionDetails?.baseTimeCost ? actionDetails.baseTimeCost / 1e9 : 12;

        // Get enhancing skill level
        const enhancingSkill = charData.characterSkills?.find((s) => s.skillHrid === '/skills/enhancing');
        const baseLevel = enhancingSkill?.level || 1;

        // Get tea level bonus from consumable buff map
        let teaLevelBonus = 0;
        const consumableBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(consumableBuffs)) {
            for (const buff of consumableBuffs) {
                if (buff.typeHrid === '/buff_types/enhancing_level') {
                    teaLevelBonus = buff.flatBoost || 0;
                }
            }
        }

        // Sum action_speed flatBoost from ALL buff sources (equipment, house, community, tea)
        let totalSpeedBuff = 0;

        const buffMaps = [
            charData.equipmentActionTypeBuffsMap,
            charData.houseActionTypeBuffsMap,
            charData.communityActionTypeBuffsMap,
            charData.consumableActionTypeBuffsMap,
        ];

        for (const buffMap of buffMaps) {
            const enhancingBuffs = buffMap?.['/action_types/enhancing'];
            if (!Array.isArray(enhancingBuffs)) continue;

            for (const buff of enhancingBuffs) {
                if (buff.typeHrid === '/buff_types/action_speed') {
                    totalSpeedBuff += buff.flatBoost || 0;
                }
            }
        }

        // Add personal buffs (Labyrinth seals)
        totalSpeedBuff += dataManager.getPersonalBuffFlatBoost('/action_types/enhancing', '/buff_types/action_speed');

        // Add level advantage: (effectiveLevel - itemLevel) / 100
        const effectiveLevel = baseLevel + teaLevelBonus;
        const itemLevel = getBaseItemLevel(itemHrid);
        if (effectiveLevel > itemLevel) {
            totalSpeedBuff += (effectiveLevel - itemLevel) / 100;
        }

        return Math.max(MIN_ACTION_TIME_SECONDS, baseTime / (1 + totalSpeedBuff));
    } catch {
        return 12;
    }
}

/**
 * Get enhancing speed breakdown from the game's buff maps
 * Returns per-source speed values and total, matching the game's actual calculation
 * @param {string} itemHrid - Item HRID being enhanced
 * @returns {Object} Speed breakdown with total and per-source values (as percentages)
 */
export function getEnhancingSpeedBreakdown(itemHrid) {
    try {
        const charData = dataManager.characterData;
        if (!charData)
            return { total: 0, equipment: 0, house: 0, community: 0, consumable: 0, personal: 0, levelAdvantage: 0 };

        // Get enhancing skill level
        const enhancingSkill = charData.characterSkills?.find((s) => s.skillHrid === '/skills/enhancing');
        const baseLevel = enhancingSkill?.level || 1;

        // Get tea level bonus from consumable buff map
        let teaLevelBonus = 0;
        const consumableBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(consumableBuffs)) {
            for (const buff of consumableBuffs) {
                if (buff.typeHrid === '/buff_types/enhancing_level') {
                    teaLevelBonus = buff.flatBoost || 0;
                }
            }
        }

        // Read action_speed flatBoost from each buff source individually
        const sources = {
            equipment: charData.equipmentActionTypeBuffsMap,
            house: charData.houseActionTypeBuffsMap,
            community: charData.communityActionTypeBuffsMap,
            consumable: charData.consumableActionTypeBuffsMap,
        };

        const breakdown = { equipment: 0, house: 0, community: 0, consumable: 0, personal: 0, levelAdvantage: 0 };

        for (const [source, buffMap] of Object.entries(sources)) {
            const enhancingBuffs = buffMap?.['/action_types/enhancing'];
            if (!Array.isArray(enhancingBuffs)) continue;

            for (const buff of enhancingBuffs) {
                if (buff.typeHrid === '/buff_types/action_speed') {
                    breakdown[source] += buff.flatBoost || 0;
                }
            }
        }

        // Personal buffs (Labyrinth seals)
        breakdown.personal = dataManager.getPersonalBuffFlatBoost(
            '/action_types/enhancing',
            '/buff_types/action_speed'
        );

        // Level advantage
        const effectiveLevel = baseLevel + teaLevelBonus;
        const itemLevel = getBaseItemLevel(itemHrid);
        if (effectiveLevel > itemLevel) {
            breakdown.levelAdvantage = (effectiveLevel - itemLevel) / 100;
        }

        // Total (as decimal, e.g. 1.56 for +156%)
        breakdown.total =
            breakdown.equipment +
            breakdown.house +
            breakdown.community +
            breakdown.consumable +
            breakdown.personal +
            breakdown.levelAdvantage;

        return breakdown;
    } catch {
        return { total: 0, equipment: 0, house: 0, community: 0, consumable: 0, personal: 0, levelAdvantage: 0 };
    }
}

/**
 * Calculate enhancement predictions using character stats
 * @param {string} itemHrid - Item HRID being enhanced
 * @param {number} startLevel - Starting enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {number} protectFrom - Level to start using protection
 * @returns {Object|null} Prediction data or null if cannot calculate
 */
export function calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom) {
    try {
        // Get item level
        const itemLevel = getBaseItemLevel(itemHrid);

        // Use getEnhancingParams() for all character stats (level, speed, success, teas, etc.)
        const params = getEnhancingParams();

        // Check for blessed tea
        const hasBlessed = params.teas?.blessed || false;

        // Calculate predictions (Markov chain for attempts, protections, success rates)
        const result = calculateEnhancement({
            enhancingLevel: params.enhancingLevel,
            houseLevel: params.houseLevel,
            toolBonus: params.toolBonus,
            speedBonus: params.speedBonus,
            itemLevel,
            targetLevel,
            startLevel,
            protectFrom,
            blessedTea: hasBlessed,
            guzzlingBonus: params.guzzlingBonus,
        });

        if (!result) {
            return null;
        }

        // Calculate per-action time from the game's buff maps (authoritative source)
        // instead of the hardcoded formula in calculateEnhancement
        const perActionTime = getEnhancingActionTime(itemHrid);

        return {
            expectedAttempts: Math.round(result.attemptsRounded),
            expectedProtections: Math.round(result.protectionCount),
            expectedTime: perActionTime * result.attempts,
            perActionTime,
            successMultiplier: result.successMultiplier,
        };
    } catch {
        return null;
    }
}
