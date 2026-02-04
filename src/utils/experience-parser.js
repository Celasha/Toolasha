/**
 * Experience Parser Utility
 * Parses wisdom and experience bonuses from all sources
 *
 * Experience Formula (Skilling):
 * Final XP = Base XP × (1 + Wisdom + Charm Experience)
 *
 * Where Wisdom and Charm Experience are ADDITIVE
 */

import dataManager from '../core/data-manager.js';

/**
 * Parse equipment wisdom bonus (skillingExperience stat)
 * @param {Map} equipment - Character equipment map
 * @param {Object} itemDetailMap - Item details from game data
 * @returns {Object} {total: number, breakdown: Array} Total wisdom and item breakdown
 */
export function parseEquipmentWisdom(equipment, itemDetailMap) {
    let totalWisdom = 0;
    const breakdown = [];

    for (const [_slot, item] of equipment) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail) continue;

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
        const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

        // Get base skillingExperience
        const baseWisdom = noncombatStats.skillingExperience || 0;
        if (baseWisdom === 0) continue;

        // Get enhancement scaling
        const enhancementBonus = noncombatEnhancement.skillingExperience || 0;
        const enhancementLevel = item.enhancementLevel || 0;

        // Calculate total wisdom from this item
        // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
        const enhancementTotal =
            enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
        const itemWisdom = (baseWisdom + enhancementTotal) * 100;
        totalWisdom += itemWisdom;

        // Add to breakdown
        breakdown.push({
            name: itemDetails.name,
            value: itemWisdom,
            enhancementLevel: enhancementLevel,
        });
    }

    return {
        total: totalWisdom,
        breakdown: breakdown,
    };
}

/**
 * Parse skill-specific charm experience (e.g., foragingExperience)
 * @param {Map} equipment - Character equipment map
 * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
 * @param {Object} itemDetailMap - Item details from game data
 * @returns {Object} {total: number, breakdown: Array} Total charm XP and item breakdown
 */
export function parseCharmExperience(equipment, skillHrid, itemDetailMap) {
    let totalCharmXP = 0;
    const breakdown = [];

    // Convert skill HRID to stat name (e.g., "/skills/foraging" → "foragingExperience")
    const skillName = skillHrid.replace('/skills/', '');
    const statName = `${skillName}Experience`;

    for (const [_slot, item] of equipment) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail) continue;

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
        const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

        // Get base charm experience
        const baseCharmXP = noncombatStats[statName] || 0;
        if (baseCharmXP === 0) continue;

        // Get enhancement scaling
        const enhancementBonus = noncombatEnhancement[statName] || 0;
        const enhancementLevel = item.enhancementLevel || 0;

        // Calculate total charm XP from this item
        // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
        const enhancementTotal =
            enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
        const itemCharmXP = (baseCharmXP + enhancementTotal) * 100;
        totalCharmXP += itemCharmXP;

        // Add to breakdown
        breakdown.push({
            name: itemDetails.name,
            value: itemCharmXP,
            enhancementLevel: enhancementLevel,
        });
    }

    return {
        total: totalCharmXP,
        breakdown: breakdown,
    };
}

/**
 * Parse house room wisdom bonus
 * All house rooms provide +0.05% wisdom per level
 * @returns {number} Total wisdom from house rooms (e.g., 0.4 for 8 total levels)
 */
export function parseHouseRoomWisdom() {
    const houseRooms = dataManager.getHouseRooms();
    if (!houseRooms || houseRooms.size === 0) {
        return 0;
    }

    // Sum all house room levels
    let totalLevels = 0;
    for (const [_hrid, room] of houseRooms) {
        totalLevels += room.level || 0;
    }

    // Formula: totalLevels × 0.05% per level
    return totalLevels * 0.05;
}

/**
 * Parse community buff wisdom bonus
 * Formula: 20% + ((level - 1) × 0.5%)
 * @returns {number} Wisdom percentage from community buff (e.g., 29.5 for T20)
 */
export function parseCommunityBuffWisdom() {
    const buffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
    if (!buffLevel) {
        return 0;
    }

    // Formula: 20% base + 0.5% per level above 1
    return 20 + (buffLevel - 1) * 0.5;
}

/**
 * Parse wisdom from active consumables (Wisdom Tea/Coffee)
 * @param {Array} drinkSlots - Active drink slots for the action type
 * @param {Object} itemDetailMap - Item details from game data
 * @param {number} drinkConcentration - Drink concentration bonus (e.g., 12.16 for 12.16%)
 * @returns {number} Wisdom percentage from consumables (e.g., 13.46 for 12% × 1.1216)
 */
export function parseConsumableWisdom(drinkSlots, itemDetailMap, drinkConcentration) {
    if (!drinkSlots || drinkSlots.length === 0) {
        return 0;
    }

    let totalWisdom = 0;

    for (const drink of drinkSlots) {
        if (!drink || !drink.itemHrid) continue; // Skip empty slots

        const itemDetails = itemDetailMap[drink.itemHrid];
        if (!itemDetails?.consumableDetail) continue;

        // Check for wisdom buff (typeHrid === "/buff_types/wisdom")
        const buffs = itemDetails.consumableDetail.buffs || [];
        for (const buff of buffs) {
            // Check if this is a wisdom buff by typeHrid
            if (buff.typeHrid === '/buff_types/wisdom' && buff.flatBoost) {
                // Base wisdom (e.g., 0.12 for 12%)
                const baseWisdom = buff.flatBoost * 100;

                // Scale with drink concentration
                const scaledWisdom = baseWisdom * (1 + drinkConcentration / 100);

                totalWisdom += scaledWisdom;
            }
        }
    }

    return totalWisdom;
}

/**
 * Calculate total experience multiplier and breakdown
 * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
 * @returns {Object} Experience data with breakdown
 */
export function calculateExperienceMultiplier(skillHrid, actionTypeHrid) {
    const equipment = dataManager.getEquipment();
    const gameData = dataManager.getInitClientData();
    const itemDetailMap = gameData?.itemDetailMap || {};

    // Get drink concentration
    const drinkConcentration = equipment ? calculateDrinkConcentration(equipment, itemDetailMap) : 0;

    // Get active drinks for this action type
    const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);

    // Parse wisdom from all sources
    const equipmentWisdomData = parseEquipmentWisdom(equipment, itemDetailMap);
    const equipmentWisdom = equipmentWisdomData.total;
    const houseWisdom = parseHouseRoomWisdom();
    const communityWisdom = parseCommunityBuffWisdom();
    const consumableWisdom = parseConsumableWisdom(activeDrinks, itemDetailMap, drinkConcentration);
    const achievementWisdom = dataManager.getAchievementBuffFlatBoost(actionTypeHrid, '/buff_types/wisdom') * 100;

    const totalWisdom = equipmentWisdom + houseWisdom + communityWisdom + consumableWisdom + achievementWisdom;

    // Parse charm experience (skill-specific) - now returns object with total and breakdown
    const charmData = parseCharmExperience(equipment, skillHrid, itemDetailMap);
    const charmExperience = charmData.total;

    // Total multiplier (additive)
    const totalMultiplier = 1 + totalWisdom / 100 + charmExperience / 100;

    return {
        totalMultiplier,
        totalWisdom,
        charmExperience,
        charmBreakdown: charmData.breakdown,
        wisdomBreakdown: equipmentWisdomData.breakdown,
        breakdown: {
            equipmentWisdom,
            houseWisdom,
            communityWisdom,
            consumableWisdom,
            achievementWisdom,
            charmExperience,
        },
    };
}

/**
 * Calculate drink concentration from Guzzling Pouch
 * @param {Map} equipment - Character equipment map
 * @param {Object} itemDetailMap - Item details from game data
 * @returns {number} Drink concentration percentage (e.g., 12.16 for 12.16%)
 */
function calculateDrinkConcentration(equipment, itemDetailMap) {
    // Find Guzzling Pouch in equipment
    const pouchItem = equipment.get('/equipment_types/pouch');
    if (!pouchItem || !pouchItem.itemHrid.includes('guzzling_pouch')) {
        return 0;
    }

    const itemDetails = itemDetailMap[pouchItem.itemHrid];
    if (!itemDetails?.equipmentDetail) {
        return 0;
    }

    // Get base drink concentration
    const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
    const baseDrinkConcentration = noncombatStats.drinkConcentration || 0;

    if (baseDrinkConcentration === 0) {
        return 0;
    }

    // Get enhancement scaling
    const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};
    const enhancementBonus = noncombatEnhancement.drinkConcentration || 0;
    const enhancementLevel = pouchItem.enhancementLevel || 0;

    // Calculate total drink concentration
    // Enhancement scales quadratically: level × (1 + 0.05 × (level - 1))
    const enhancementTotal =
        enhancementBonus * (enhancementLevel + (0.1 * enhancementLevel * (enhancementLevel - 1)) / 2);
    return (baseDrinkConcentration + enhancementTotal) * 100;
}

export default {
    parseEquipmentWisdom,
    parseCharmExperience,
    parseHouseRoomWisdom,
    parseCommunityBuffWisdom,
    parseConsumableWisdom,
    calculateExperienceMultiplier,
};
