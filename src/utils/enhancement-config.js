/**
 * Enhancement Configuration Manager
 *
 * Combines auto-detected enhancing parameters with manual overrides from settings.
 * Provides single source of truth for enhancement simulator inputs.
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { detectEnhancingGear, detectEnhancingTeas, getEnhancingTeaLevelBonus, getEnhancingTeaSpeedBonus } from './enhancement-gear-detector.js';

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
    const inventory = dataManager.getInventory();
    const skills = dataManager.getSkills();
    const drinkSlots = dataManager.getActionDrinkSlots('/action_types/enhancing');
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

    // Detect gear (scans all items in inventory, including equipped)
    const gear = detectEnhancingGear(equipment, itemDetailMap, inventory);

    // Detect drink concentration from equipment (Guzzling Pouch)
    let drinkConcentration = 0;
    const itemsToScan = inventory ? inventory.filter(item => item && item.itemHrid) :
                        equipment ? Array.from(equipment.values()).filter(item => item && item.itemHrid) : [];

    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

        const concentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
        drinkConcentration += concentration * 100; // Convert to percentage
    }

    // Detect teas
    const teas = detectEnhancingTeas(drinkSlots, itemDetailMap);
    const teaLevelBonus = getEnhancingTeaLevelBonus(teas);

    // Get tea speed bonus (base, then scale with concentration)
    const baseTeaSpeed = getEnhancingTeaSpeedBonus(teas);
    const teaSpeedBonus = baseTeaSpeed > 0 ? baseTeaSpeed * (1 + drinkConcentration / 100) : 0;

    // Get Enhancing skill level
    const enhancingSkill = skills.find(s => s.skillHrid === '/skills/enhancing');
    const enhancingLevel = enhancingSkill?.level || 1;

    // Get Observatory house room level (enhancing uses observatory, NOT laboratory!)
    const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/observatory');

    // Get Enhancing Speed community buff level
    const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
    // Formula: 20% base + 0.5% per level
    const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

    // Calculate total success rate bonus
    // Tool bonus (from equipment) + house bonus (0.05% per level)
    const houseSuccessBonus = houseLevel * 0.05;  // 0.05% per level for success
    const totalSuccessBonus = gear.toolBonus + houseSuccessBonus;

    // Calculate total speed bonus
    // Speed bonus (from equipment) + house bonus (1% per level) + community buff + tea speed
    const houseSpeedBonus = houseLevel * 1.0;  // 1% per level for action speed
    const totalSpeedBonus = gear.speedBonus + houseSpeedBonus + communitySpeedBonus + teaSpeedBonus;

    return {
        enhancingLevel: enhancingLevel + teaLevelBonus,  // Base level + tea bonus
        houseLevel: houseLevel,
        toolBonus: totalSuccessBonus,                     // Tool + house combined
        speedBonus: totalSpeedBonus,                      // Speed + house + community + tea combined
        rareFindBonus: gear.rareFindBonus,                // Rare find bonus
        experienceBonus: gear.experienceBonus,            // Experience bonus
        teas: teas,

        // Display info (for UI) - show best item per slot
        toolSlot: gear.toolSlot,
        bodySlot: gear.bodySlot,
        legsSlot: gear.legsSlot,
        handsSlot: gear.handsSlot,
        detectedTeaBonus: teaLevelBonus,
        communityBuffLevel: communityBuffLevel,           // For display
        communitySpeedBonus: communitySpeedBonus,         // For display
        teaSpeedBonus: teaSpeedBonus,                     // For display
        drinkConcentration: drinkConcentration,           // For display
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
