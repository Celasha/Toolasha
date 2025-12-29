/**
 * Enhancement XP Calculations
 * Based on Ultimate Enhancement Tracker formulas
 */

import dataManager from '../../core/data-manager.js';

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
        console.error('[Enhancement XP] Error getting base item level:', error);
        return 0;
    }
}

/**
 * Get wisdom buff percentage from all sources
 * Matches Ultimate Enhancement Tracker's approach - reads from init_character_data
 * @returns {number} Wisdom buff as decimal (e.g., 0.20 for 20%)
 */
function getWisdomBuff() {
    try {
        // Read directly from localStorage like Ultimate Tracker does
        const charData = JSON.parse(localStorage.getItem('init_character_data'));
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
        console.error('[Enhancement XP] Error calculating wisdom buff:', error);
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
