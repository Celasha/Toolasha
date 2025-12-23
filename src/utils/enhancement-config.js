/**
 * Enhancement Configuration Manager
 *
 * Combines auto-detected enhancing parameters with manual overrides from settings.
 * Provides single source of truth for enhancement simulator inputs.
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { detectEnhancingGear, detectEnhancingTeas, getEnhancingTeaLevelBonus } from './enhancement-gear-detector.js';

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

    // Detect teas
    const teas = detectEnhancingTeas(drinkSlots, itemDetailMap);
    const teaLevelBonus = getEnhancingTeaLevelBonus(teas);

    // Get Enhancing skill level
    const enhancingSkill = skills.find(s => s.skillHrid === '/skills/enhancing');
    const enhancingLevel = enhancingSkill?.level || 1;

    // Get Enhancing house room level (using convenience method)
    const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/enhancing');

    // Calculate total success rate bonus
    // Tool bonus (from equipment) + house bonus (0.5% per level) + tea level bonus
    const houseBonus = houseLevel * 0.5;
    const totalSuccessBonus = gear.toolBonus + houseBonus;

    return {
        enhancingLevel: enhancingLevel + teaLevelBonus,  // Base level + tea bonus
        houseLevel: houseLevel,
        toolBonus: totalSuccessBonus,                     // Tool + house combined
        glovesBonus: gear.glovesBonus,                    // Speed bonus
        teas: teas,

        // Display info (for UI)
        toolName: gear.toolName,
        toolLevel: gear.toolLevel,
        glovesName: gear.glovesName,
        glovesLevel: gear.glovesLevel,
        detectedTeaBonus: teaLevelBonus,
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
        glovesBonus: config.getSettingValue('enhanceSim_glovesBonus', 0),
        teas: {
            enhancing: config.getSettingValue('enhanceSim_enhancingTea', false),
            superEnhancing: config.getSettingValue('enhanceSim_superEnhancingTea', false),
            ultraEnhancing: config.getSettingValue('enhanceSim_ultraEnhancingTea', false),
            blessed: config.getSettingValue('enhanceSim_blessedTea', false),
        },

        // No display info for manual mode
        toolName: null,
        toolLevel: 0,
        glovesName: null,
        glovesLevel: 0,
        detectedTeaBonus: 0,
    };
}
