/**
 * Equipment Parser Utility
 * Parses equipment speed bonuses for action time calculations
 *
 * PART OF EFFICIENCY SYSTEM (Phase 1 of 3):
 * - Phase 1 ✅: Equipment speed bonuses (this module) + level advantage
 * - Phase 2 ⏳: Community buffs + house rooms (user config)
 * - Phase 3 ⏳: Consumable buffs (research needed)
 *
 * Speed bonuses are MULTIPLICATIVE with time (reduce duration).
 * Efficiency bonuses are ADDITIVE with each other, then MULTIPLICATIVE with time.
 *
 * Formula: actionTime = baseTime / (1 + totalEfficiency + totalSpeed)
 */

/**
 * Map action type HRID to equipment speed field name
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
 * @returns {string|null} Speed field name (e.g., "cheesesmithingSpeed") or null
 */
function getSpeedFieldForActionType(actionTypeHrid) {
    // Extract skill name from action type HRID
    // e.g., "/action_types/cheesesmithing" -> "cheesesmithing"
    const skillName = actionTypeHrid.replace('/action_types/', '');

    // Map to speed field name
    // e.g., "cheesesmithing" -> "cheesesmithingSpeed"
    const speedField = skillName + 'Speed';

    // Valid speed fields from game data
    const validSpeedFields = [
        'milkingSpeed',
        'foragingSpeed',
        'woodcuttingSpeed',
        'cheesesmithingSpeed',
        'craftingSpeed',
        'tailoringSpeed',
        'brewingSpeed',
        'cookingSpeed'
    ];

    return validSpeedFields.includes(speedField) ? speedField : null;
}

/**
 * Calculate enhancement scaling for speed bonuses
 * Uses item-specific enhancement bonus from noncombatEnhancementBonuses
 * @param {number} baseSpeed - Base speed bonus from item (e.g., 0.15 for 15%)
 * @param {number} enhancementBonus - Enhancement bonus per level from item data (e.g., 0.003 for 0.3%)
 * @param {number} enhancementLevel - Enhancement level (0-20)
 * @returns {number} Scaled speed bonus
 *
 * @example
 * calculateEnhancementScaling(0.15, 0.003, 0) // 0.15 (15%)
 * calculateEnhancementScaling(0.15, 0.003, 10) // 0.18 (18%)
 * calculateEnhancementScaling(0.3, 0.006, 10) // 0.36 (36%)
 */
function calculateEnhancementScaling(baseSpeed, enhancementBonus, enhancementLevel) {
    // Formula: base + (enhancementBonus × enhancementLevel)
    return baseSpeed + (enhancementBonus * enhancementLevel);
}

/**
 * Parse equipment speed bonuses for a specific action type
 * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
 * @param {string} actionTypeHrid - Action type HRID
 * @param {Object} itemDetailMap - Item details from init_client_data
 * @returns {number} Total speed bonus as decimal (e.g., 0.15 for 15%)
 *
 * @example
 * parseEquipmentSpeedBonuses(equipment, "/action_types/brewing", items)
 * // Cheese Pot (base 0.15, bonus 0.003) +0: 0.15 (15%)
 * // Cheese Pot (base 0.15, bonus 0.003) +10: 0.18 (18%)
 * // Azure Pot (base 0.3, bonus 0.006) +10: 0.36 (36%)
 */
export function parseEquipmentSpeedBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return 0; // No equipment
    }

    if (!actionTypeHrid || !itemDetailMap) {
        return 0; // Missing required data
    }

    // Get the speed field for this action type
    const speedField = getSpeedFieldForActionType(actionTypeHrid);

    if (!speedField) {
        // No speed bonuses for this action type
        return 0;
    }

    let totalSpeedBonus = 0;

    // Iterate through all equipped items
    for (const [slotHrid, equippedItem] of characterEquipment) {
        // Get item details from game data
        const itemDetails = itemDetailMap[equippedItem.itemHrid];

        if (!itemDetails || !itemDetails.equipmentDetail) {
            continue; // Not an equipment item
        }

        // Check if item has noncombat stats
        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

        if (!noncombatStats) {
            continue; // No noncombat stats
        }

        // Check if item has the speed bonus for this action type
        const baseSpeed = noncombatStats[speedField];

        if (!baseSpeed || baseSpeed <= 0) {
            continue; // No speed bonus for this skill
        }

        // Get enhancement level from equipped item
        const enhancementLevel = equippedItem.enhancementLevel || 0;

        // Get enhancement bonus from item data (how much each level adds)
        const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;
        const enhancementBonus = (enhancementBonuses && enhancementBonuses[speedField]) || 0;

        // Calculate scaled speed bonus
        const scaledSpeed = calculateEnhancementScaling(baseSpeed, enhancementBonus, enhancementLevel);

        // Add to total
        totalSpeedBonus += scaledSpeed;
    }

    return totalSpeedBonus;
}

/**
 * Get all speed bonuses for debugging
 * @param {Map} characterEquipment - Equipment map
 * @param {Object} itemDetailMap - Item details
 * @returns {Array} Array of speed bonus objects
 */
export function debugEquipmentSpeedBonuses(characterEquipment, itemDetailMap) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return [];
    }

    const bonuses = [];

    for (const [slotHrid, equippedItem] of characterEquipment) {
        const itemDetails = itemDetailMap[equippedItem.itemHrid];

        if (!itemDetails || !itemDetails.equipmentDetail) {
            continue;
        }

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

        if (!noncombatStats) {
            continue;
        }

        // Find all speed bonuses on this item
        for (const [statName, value] of Object.entries(noncombatStats)) {
            if (statName.endsWith('Speed') && value > 0) {
                const enhancementLevel = equippedItem.enhancementLevel || 0;

                // Get enhancement bonus from item data
                const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;
                const enhancementBonus = (enhancementBonuses && enhancementBonuses[statName]) || 0;

                const scaledValue = calculateEnhancementScaling(value, enhancementBonus, enhancementLevel);

                bonuses.push({
                    itemName: itemDetails.name,
                    itemHrid: equippedItem.itemHrid,
                    slot: slotHrid,
                    speedType: statName,
                    baseBonus: value,
                    enhancementBonus,
                    enhancementLevel,
                    scaledBonus: scaledValue
                });
            }
        }
    }

    return bonuses;
}

/**
 * Map action type HRID to equipment efficiency field name
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
 * @returns {string|null} Efficiency field name (e.g., "cheesesmithingEfficiency") or null
 */
function getEfficiencyFieldForActionType(actionTypeHrid) {
    // Extract skill name from action type HRID
    // e.g., "/action_types/cheesesmithing" -> "cheesesmithing"
    const skillName = actionTypeHrid.replace('/action_types/', '');

    // Map to efficiency field name
    // e.g., "cheesesmithing" -> "cheesesmithingEfficiency"
    const efficiencyField = skillName + 'Efficiency';

    // Valid efficiency fields from game data
    const validEfficiencyFields = [
        'milkingEfficiency',
        'foragingEfficiency',
        'woodcuttingEfficiency',
        'cheesesmithingEfficiency',
        'craftingEfficiency',
        'tailoringEfficiency',
        'brewingEfficiency',
        'cookingEfficiency',
        'alchemyEfficiency'
    ];

    return validEfficiencyFields.includes(efficiencyField) ? efficiencyField : null;
}

/**
 * Parse equipment efficiency bonuses for a specific action type
 * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
 * @param {string} actionTypeHrid - Action type HRID
 * @param {Object} itemDetailMap - Item details from init_client_data
 * @returns {number} Total efficiency bonus as percentage (e.g., 12 for 12%)
 *
 * @example
 * parseEquipmentEfficiencyBonuses(equipment, "/action_types/brewing", items)
 * // Brewer's Top (base 0.1, bonus 0.002) +0: 10%
 * // Brewer's Top (base 0.1, bonus 0.002) +10: 12%
 * // Philosopher's Necklace (skillingEfficiency 0.02, bonus 0.002) +10: 4%
 * // Total: 16%
 */
export function parseEquipmentEfficiencyBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return 0; // No equipment
    }

    if (!actionTypeHrid || !itemDetailMap) {
        return 0; // Missing required data
    }

    // Get the skill-specific efficiency field for this action type
    const efficiencyField = getEfficiencyFieldForActionType(actionTypeHrid);

    let totalEfficiencyBonus = 0;

    // Iterate through all equipped items
    for (const [slotHrid, equippedItem] of characterEquipment) {
        // Get item details from game data
        const itemDetails = itemDetailMap[equippedItem.itemHrid];

        if (!itemDetails || !itemDetails.equipmentDetail) {
            continue; // Not an equipment item
        }

        // Check if item has noncombat stats
        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

        if (!noncombatStats) {
            continue; // No noncombat stats
        }

        // Get enhancement level from equipped item
        const enhancementLevel = equippedItem.enhancementLevel || 0;

        // Get enhancement bonuses for this item
        const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;

        // Check for skill-specific efficiency (e.g., brewingEfficiency)
        if (efficiencyField) {
            const baseEfficiency = noncombatStats[efficiencyField];

            if (baseEfficiency && baseEfficiency > 0) {
                const enhancementBonus = (enhancementBonuses && enhancementBonuses[efficiencyField]) || 0;
                const scaledEfficiency = calculateEnhancementScaling(baseEfficiency, enhancementBonus, enhancementLevel);
                totalEfficiencyBonus += scaledEfficiency;
            }
        }

        // Check for generic skilling efficiency (applies to all skills)
        const baseSkillingEfficiency = noncombatStats.skillingEfficiency;

        if (baseSkillingEfficiency && baseSkillingEfficiency > 0) {
            const enhancementBonus = (enhancementBonuses && enhancementBonuses.skillingEfficiency) || 0;
            const scaledEfficiency = calculateEnhancementScaling(baseSkillingEfficiency, enhancementBonus, enhancementLevel);
            totalEfficiencyBonus += scaledEfficiency;
        }
    }

    // Convert to percentage (0.15 -> 15%)
    return totalEfficiencyBonus * 100;
}

/**
 * Parse Essence Find bonus from equipment
 * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
 * @param {Object} itemDetailMap - Item details from init_client_data
 * @returns {number} Total essence find bonus as percentage (e.g., 15 for 15%)
 *
 * @example
 * parseEssenceFindBonus(equipment, items)
 * // Ring of Essence Find (base 0.15, bonus 0.015) +0: 15%
 * // Ring of Essence Find (base 0.15, bonus 0.015) +10: 30%
 */
export function parseEssenceFindBonus(characterEquipment, itemDetailMap) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return 0; // No equipment
    }

    if (!itemDetailMap) {
        return 0; // Missing item data
    }

    let totalEssenceFindBonus = 0;

    // Iterate through all equipped items
    for (const [slotHrid, equippedItem] of characterEquipment) {
        const itemDetails = itemDetailMap[equippedItem.itemHrid];

        if (!itemDetails || !itemDetails.equipmentDetail) {
            continue; // Not an equipment item
        }

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;
        if (!noncombatStats) {
            continue; // No noncombat stats
        }

        // Get enhancement level from equipped item
        const enhancementLevel = equippedItem.enhancementLevel || 0;

        // Get enhancement bonuses for this item
        const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;

        // Check for skillingEssenceFind stat
        const baseEssenceFind = noncombatStats.skillingEssenceFind;

        if (baseEssenceFind && baseEssenceFind > 0) {
            const enhancementBonus = (enhancementBonuses && enhancementBonuses.skillingEssenceFind) || 0;
            const scaledEssenceFind = calculateEnhancementScaling(baseEssenceFind, enhancementBonus, enhancementLevel);
            totalEssenceFindBonus += scaledEssenceFind;
        }
    }

    // Convert to percentage (0.15 -> 15%)
    return totalEssenceFindBonus * 100;
}

/**
 * Map action type HRID to equipment rare find field name
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
 * @returns {string|null} Rare find field name (e.g., "brewingRareFind") or null
 */
function getRareFindFieldForActionType(actionTypeHrid) {
    // Extract skill name from action type HRID
    // e.g., "/action_types/brewing" -> "brewing"
    const skillName = actionTypeHrid.replace('/action_types/', '');

    // Map to rare find field name
    // e.g., "brewing" -> "brewingRareFind"
    const rareFindField = skillName + 'RareFind';

    // Valid rare find fields from game data
    const validRareFindFields = [
        'milkingRareFind',
        'foragingRareFind',
        'woodcuttingRareFind',
        'cheesesmithingRareFind',
        'craftingRareFind',
        'tailoringRareFind',
        'brewingRareFind',
        'cookingRareFind',
        'alchemyRareFind'
    ];

    return validRareFindFields.includes(rareFindField) ? rareFindField : null;
}

/**
 * Parse Rare Find bonus from equipment
 * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
 * @param {string} actionTypeHrid - Action type HRID (for skill-specific rare find)
 * @param {Object} itemDetailMap - Item details from init_client_data
 * @returns {number} Total rare find bonus as percentage (e.g., 15 for 15%)
 *
 * @example
 * parseRareFindBonus(equipment, "/action_types/brewing", items)
 * // Brewer's Top (base 0.15, bonus 0.003) +0: 15%
 * // Brewer's Top (base 0.15, bonus 0.003) +10: 18%
 * // Earrings of Rare Find (base 0.08, bonus 0.002) +0: 8%
 * // Total: 26%
 */
export function parseRareFindBonus(characterEquipment, actionTypeHrid, itemDetailMap) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return 0; // No equipment
    }

    if (!itemDetailMap) {
        return 0; // Missing item data
    }

    // Get the skill-specific rare find field for this action type
    const rareFindField = getRareFindFieldForActionType(actionTypeHrid);

    let totalRareFindBonus = 0;

    // Iterate through all equipped items
    for (const [slotHrid, equippedItem] of characterEquipment) {
        const itemDetails = itemDetailMap[equippedItem.itemHrid];

        if (!itemDetails || !itemDetails.equipmentDetail) {
            continue; // Not an equipment item
        }

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;
        if (!noncombatStats) {
            continue; // No noncombat stats
        }

        // Get enhancement level from equipped item
        const enhancementLevel = equippedItem.enhancementLevel || 0;

        // Get enhancement bonuses for this item
        const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;

        // Check for skill-specific rare find (e.g., brewingRareFind)
        if (rareFindField) {
            const baseRareFind = noncombatStats[rareFindField];

            if (baseRareFind && baseRareFind > 0) {
                const enhancementBonus = (enhancementBonuses && enhancementBonuses[rareFindField]) || 0;
                const scaledRareFind = calculateEnhancementScaling(baseRareFind, enhancementBonus, enhancementLevel);
                totalRareFindBonus += scaledRareFind;
            }
        }

        // Check for generic skilling rare find (applies to all skills)
        const baseSkillingRareFind = noncombatStats.skillingRareFind;

        if (baseSkillingRareFind && baseSkillingRareFind > 0) {
            const enhancementBonus = (enhancementBonuses && enhancementBonuses.skillingRareFind) || 0;
            const scaledRareFind = calculateEnhancementScaling(baseSkillingRareFind, enhancementBonus, enhancementLevel);
            totalRareFindBonus += scaledRareFind;
        }
    }

    // Convert to percentage (0.15 -> 15%)
    return totalRareFindBonus * 100;
}
