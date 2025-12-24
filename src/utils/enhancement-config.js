/**
 * Enhancement Configuration Manager
 *
 * Combines auto-detected enhancing parameters with manual overrides from settings.
 * Provides single source of truth for enhancement simulator inputs.
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { detectEnhancingGear, detectEnhancingTeas, getEnhancingTeaLevelBonus, getEnhancingTeaSpeedBonus } from './enhancement-gear-detector.js';
import { getEnhancementMultiplier } from './enhancement-multipliers.js';

/**
 * Get enhancing parameters (auto-detected or manual)
 * @returns {Object} Enhancement parameters for simulator
 */
export function getEnhancingParams() {
    const autoDetect = config.getSettingValue('enhanceSim_autoDetect', true);

    if (autoDetect) {
        return getAutoDetectedParams();
    } else {
        return getManualParams();
    }
}

/**
 * Get auto-detected enhancing parameters from character data
 * @returns {Object} Auto-detected parameters
 */
function getAutoDetectedParams() {
    // Get character data
    const equipment = dataManager.getEquipment();
    const skills = dataManager.getSkills();
    const drinkSlots = dataManager.getActionDrinkSlots('/action_types/enhancing');
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

    // Detect gear from equipped items only
    const gear = detectEnhancingGear(equipment, itemDetailMap);

    // Detect drink concentration from equipment (Guzzling Pouch)
    // IMPORTANT: Only scan equipped items, not entire inventory
    let drinkConcentration = 0;
    const itemsToScan = equipment ? Array.from(equipment.values()).filter(item => item && item.itemHrid) : [];

    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

        const concentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
        const enhancementLevel = item.enhancementLevel || 0;
        const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
        const scaledConcentration = concentration * 100 * multiplier;

        // Only keep the highest concentration (shouldn't have multiple, but just in case)
        if (scaledConcentration > drinkConcentration) {
            drinkConcentration = scaledConcentration;
        }
    }

    // Detect teas
    const teas = detectEnhancingTeas(drinkSlots, itemDetailMap);

    // Get tea level bonus (base, then scale with concentration)
    const baseTeaLevel = getEnhancingTeaLevelBonus(teas);
    const teaLevelBonus = baseTeaLevel > 0 ? baseTeaLevel * (1 + drinkConcentration / 100) : 0;

    // Get tea speed bonus (base, then scale with concentration)
    const baseTeaSpeed = getEnhancingTeaSpeedBonus(teas);
    const teaSpeedBonus = baseTeaSpeed > 0 ? baseTeaSpeed * (1 + drinkConcentration / 100) : 0;

    // Get tea wisdom bonus (base, then scale with concentration)
    // Wisdom Tea/Coffee provide 12% wisdom, scales with drink concentration
    let baseTeaWisdom = 0;
    if (drinkSlots && drinkSlots.length > 0) {
        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue;
            const drinkDetails = itemDetailMap[drink.itemHrid];
            if (!drinkDetails?.consumableDetail?.buffs) continue;

            const wisdomBuff = drinkDetails.consumableDetail.buffs.find(
                buff => buff.typeHrid === '/buff_types/wisdom'
            );

            if (wisdomBuff && wisdomBuff.flatBoost) {
                baseTeaWisdom += wisdomBuff.flatBoost * 100; // Convert to percentage
            }
        }
    }
    const teaWisdomBonus = baseTeaWisdom > 0 ? baseTeaWisdom * (1 + drinkConcentration / 100) : 0;

    // Get Enhancing skill level
    const enhancingSkill = skills.find(s => s.skillHrid === '/skills/enhancing');
    const enhancingLevel = enhancingSkill?.level || 1;

    // Get Observatory house room level (enhancing uses observatory, NOT laboratory!)
    const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/observatory');

    // Calculate global house buffs from ALL house rooms
    // Rare Find: 0.2% base + 0.2% per level (per room, only if level >= 1)
    // Wisdom: 0.05% base + 0.05% per level (per room, only if level >= 1)
    const houseRooms = dataManager.getHouseRooms();
    let houseRareFindBonus = 0;
    let houseWisdomBonus = 0;

    for (const [hrid, room] of houseRooms) {
        const level = room.level || 0;
        if (level >= 1) {
            // Each room: 0.2% per level (NOT 0.2% base + 0.2% per level)
            houseRareFindBonus += 0.2 * level;
            // Each room: 0.05% per level (NOT 0.05% base + 0.05% per level)
            houseWisdomBonus += 0.05 * level;
        }
    }

    // Get Enhancing Speed community buff level
    const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
    // Formula: 20% base + 0.5% per level
    const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

    // Get Experience (Wisdom) community buff level
    const communityWisdomLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
    // Formula: 20% base + 0.5% per level (same as other community buffs)
    const communityWisdomBonus = communityWisdomLevel > 0 ? 20 + (communityWisdomLevel - 1) * 0.5 : 0;

    // Calculate total success rate bonus
    // Equipment + house + (check for other sources)
    const houseSuccessBonus = houseLevel * 0.05;  // 0.05% per level for success
    const equipmentSuccessBonus = gear.toolBonus;
    const totalSuccessBonus = equipmentSuccessBonus + houseSuccessBonus;

    // Calculate total speed bonus
    // Speed bonus (from equipment) + house bonus (1% per level) + community buff + tea speed
    const houseSpeedBonus = houseLevel * 1.0;  // 1% per level for action speed
    const totalSpeedBonus = gear.speedBonus + houseSpeedBonus + communitySpeedBonus + teaSpeedBonus;

    // Calculate total experience bonus
    // Equipment + house wisdom + tea wisdom + community wisdom
    const totalExperienceBonus = gear.experienceBonus + houseWisdomBonus + teaWisdomBonus + communityWisdomBonus;

    // Calculate guzzling bonus multiplier (1.0 at level 0, scales with drink concentration)
    const guzzlingBonus = 1 + drinkConcentration / 100;

    return {
        // Core values for calculations
        enhancingLevel: enhancingLevel + teaLevelBonus,  // Base level + tea bonus
        houseLevel: houseLevel,
        toolBonus: totalSuccessBonus,                     // Tool + house combined
        speedBonus: totalSpeedBonus,                      // Speed + house + community + tea combined
        rareFindBonus: gear.rareFindBonus + houseRareFindBonus,  // Rare find (equipment + all house rooms)
        experienceBonus: totalExperienceBonus,            // Experience (equipment + house + tea + community wisdom)
        guzzlingBonus: guzzlingBonus,                     // Drink concentration multiplier for blessed tea
        teas: teas,

        // Display info (for UI) - show best item per slot
        toolSlot: gear.toolSlot,
        bodySlot: gear.bodySlot,
        legsSlot: gear.legsSlot,
        handsSlot: gear.handsSlot,
        detectedTeaBonus: teaLevelBonus,
        communityBuffLevel: communityBuffLevel,           // For display (speed)
        communitySpeedBonus: communitySpeedBonus,         // For display
        communityWisdomLevel: communityWisdomLevel,       // For display
        communityWisdomBonus: communityWisdomBonus,       // For display
        teaSpeedBonus: teaSpeedBonus,                     // For display
        teaWisdomBonus: teaWisdomBonus,                   // For display
        drinkConcentration: drinkConcentration,           // For display
        houseRareFindBonus: houseRareFindBonus,           // For display
        houseWisdomBonus: houseWisdomBonus,               // For display
        equipmentRareFind: gear.rareFindBonus,            // For display
        equipmentExperience: gear.experienceBonus,        // For display
        equipmentSuccessBonus: equipmentSuccessBonus,     // For display
        houseSuccessBonus: houseSuccessBonus,             // For display
    };
}

/**
 * Get manual enhancing parameters from config settings
 * @returns {Object} Manual parameters
 */
function getManualParams() {
    return {
        enhancingLevel: config.getSettingValue('enhanceSim_enhancingLevel', 125),
        houseLevel: config.getSettingValue('enhanceSim_houseLevel', 6),
        toolBonus: config.getSettingValue('enhanceSim_toolBonus', 15),
        speedBonus: config.getSettingValue('enhanceSim_speedBonus', 0),
        rareFindBonus: config.getSettingValue('enhanceSim_rareFindBonus', 0),
        experienceBonus: config.getSettingValue('enhanceSim_experienceBonus', 0),
        guzzlingBonus: 1 + config.getSettingValue('enhanceSim_drinkConcentration', 0) / 100,
        teas: {
            enhancing: config.getSettingValue('enhanceSim_enhancingTea', false),
            superEnhancing: config.getSettingValue('enhanceSim_superEnhancingTea', false),
            ultraEnhancing: config.getSettingValue('enhanceSim_ultraEnhancingTea', false),
            blessed: config.getSettingValue('enhanceSim_blessedTea', false),
        },

        // No display info for manual mode
        toolSlot: null,
        bodySlot: null,
        legsSlot: null,
        handsSlot: null,
        detectedTeaBonus: 0,
    };
}
