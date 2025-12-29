/**
 * Enhancement XP Calculations
 * Based on Ultimate Enhancement Tracker formulas
 */

import dataManager from '../../core/data-manager.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';

/**
 * Get base item level from item HRID
 * @param {string} itemHrid - Item HRID
 * @returns {number} Base item level
 */
function getBaseItemLevel(itemHrid) {
    try {
        const gameData = dataManager.getInitClientData();
        const itemData = gameData?.itemDetailMap?.[itemHrid];
        return itemData?.level || 0;
    } catch (error) {
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
            communityEnhancingBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 2. Equipment Buffs
        const equipmentEnhancingBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(equipmentEnhancingBuffs)) {
            equipmentEnhancingBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 3. House Buffs
        const houseEnhancingBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(houseEnhancingBuffs)) {
            houseEnhancingBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // 4. Consumable Buffs (from wisdom tea, etc.)
        const consumableEnhancingBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(consumableEnhancingBuffs)) {
            consumableEnhancingBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/wisdom') {
                    totalFlatBoost += buff.flatBoost || 0;
                }
            });
        }

        // Return as decimal (flatBoost is already in decimal form, e.g., 0.2 for 20%)
        return totalFlatBoost;

    } catch (error) {
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
    const enhancementMultiplier = previousLevel === 0
        ? 1.0  // Base value for unenhanced items
        : (previousLevel + 1);  // Normal progression

    return Math.floor(
        1.4 *
        (1 + wisdomBuff) *
        enhancementMultiplier *
        (10 + baseLevel)
    );
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
 * Calculate enhancement predictions using character stats
 * @param {string} itemHrid - Item HRID being enhanced
 * @param {number} startLevel - Starting enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {number} protectFrom - Level to start using protection
 * @returns {Object|null} Prediction data or null if cannot calculate
 */
export function calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom) {
    try {
        // Use dataManager for character data (NOT localStorage)
        const charData = dataManager.characterData;
        const gameData = dataManager.getInitClientData();

        if (!charData || !gameData) {
            return null;
        }

        // Get item level
        const itemData = gameData.itemDetailMap?.[itemHrid];
        if (!itemData) {
            return null;
        }
        const itemLevel = itemData.level || 0;

        // Get enhancing skill level
        const enhancingLevel = charData.characterSkills?.['/skills/enhancing']?.level || 1;

        // Get house level (Observatory)
        const houseRooms = charData.characterHouseRoomMap;
        let houseLevel = 0;
        if (houseRooms) {
            for (const roomHrid in houseRooms) {
                const room = houseRooms[roomHrid];
                if (room.houseRoomHrid === '/house_rooms/observatory') {
                    houseLevel = room.level || 0;
                    break;
                }
            }
        }

        // Get equipment buffs for enhancing
        let toolBonus = 0;
        let speedBonus = 0;
        const equipmentBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(equipmentBuffs)) {
            equipmentBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/enhancing_success') {
                    toolBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                }
                if (buff.typeHrid === '/buff_types/enhancing_speed') {
                    speedBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                }
            });
        }

        // Add house buffs
        const houseBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(houseBuffs)) {
            houseBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/enhancing_success') {
                    toolBonus += (buff.flatBoost || 0) * 100;
                }
                if (buff.typeHrid === '/buff_types/enhancing_speed') {
                    speedBonus += (buff.flatBoost || 0) * 100;
                }
            });
        }

        // Check for blessed tea
        let hasBlessed = false;
        let guzzlingBonus = 1.0;
        const enhancingTeas = charData.actionTypeDrinkSlotsMap?.['/action_types/enhancing'] || [];
        const activeTeas = enhancingTeas.filter(tea => tea?.isActive);

        activeTeas.forEach(tea => {
            if (tea.itemHrid === '/items/blessed_tea') {
                hasBlessed = true;
            }
        });

        // Get guzzling pouch bonus (drink concentration)
        const consumableBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
        if (Array.isArray(consumableBuffs)) {
            consumableBuffs.forEach(buff => {
                if (buff.typeHrid === '/buff_types/drink_concentration') {
                    guzzlingBonus = 1.0 + (buff.flatBoost || 0);
                }
            });
        }

        // Calculate predictions
        const result = calculateEnhancement({
            enhancingLevel,
            houseLevel,
            toolBonus,
            speedBonus,
            itemLevel,
            targetLevel,
            protectFrom,
            blessedTea: hasBlessed,
            guzzlingBonus
        });

        if (!result) {
            return null;
        }

        return {
            expectedAttempts: Math.round(result.attemptsRounded),
            expectedProtections: Math.round(result.protectionCount),
            expectedTime: result.totalTime,
            successMultiplier: result.successMultiplier
        };

    } catch (error) {
        return null;
    }
}
