/**
 * Equipment Parser Utility
 * Parses equipment bonuses for action calculations
 *
 * PART OF EFFICIENCY SYSTEM (Phase 1 of 3):
 * - Phase 1 ✅: Equipment speed bonuses (this module) + level advantage
 * - Phase 2 ✅: Community buffs + house rooms (WebSocket integration)
 * - Phase 3 ✅: Consumable buffs (tea parser integration)
 *
 * Speed bonuses are MULTIPLICATIVE with time (reduce duration).
 * Efficiency bonuses are ADDITIVE with each other, then MULTIPLICATIVE with time.
 *
 * Formula: actionTime = baseTime / (1 + totalEfficiency + totalSpeed)
 */

/**
 * Map action type HRID to equipment field name
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
 * @param {string} suffix - Field suffix (e.g., "Speed", "Efficiency", "RareFind")
 * @param {Array<string>} validFields - Array of valid field names
 * @returns {string|null} Field name (e.g., "cheesesmithingSpeed") or null
 */
function getFieldForActionType(actionTypeHrid, suffix, validFields) {
    if (!actionTypeHrid) {
        return null;
    }

    // Extract skill name from action type HRID
    // e.g., "/action_types/cheesesmithing" -> "cheesesmithing"
    const skillName = actionTypeHrid.replace('/action_types/', '');

    // Map to field name with suffix
    // e.g., "cheesesmithing" + "Speed" -> "cheesesmithingSpeed"
    const fieldName = skillName + suffix;

    return validFields.includes(fieldName) ? fieldName : null;
}

/**
 * Enhancement percentage table (based on game mechanics)
 * Each enhancement level provides a percentage boost to base stats
 */
const ENHANCEMENT_PERCENTAGES = {
    0: 0.0,
    1: 0.02, // 2.0%
    2: 0.042, // 4.2%
    3: 0.066, // 6.6%
    4: 0.092, // 9.2%
    5: 0.12, // 12.0%
    6: 0.15, // 15.0%
    7: 0.182, // 18.2%
    8: 0.216, // 21.6%
    9: 0.252, // 25.2%
    10: 0.29, // 29.0%
    11: 0.334, // 33.4%
    12: 0.384, // 38.4%
    13: 0.44, // 44.0%
    14: 0.502, // 50.2%
    15: 0.57, // 57.0%
    16: 0.644, // 64.4%
    17: 0.724, // 72.4%
    18: 0.81, // 81.0%
    19: 0.902, // 90.2%
    20: 1.0, // 100.0%
};

/**
 * Slot multipliers for enhancement bonuses
 * Accessories get 5× bonus, weapons/armor get 1× bonus
 * Keys use item_locations (not equipment_types) to match characterEquipment map keys
 */
const SLOT_MULTIPLIERS = {
    '/item_locations/neck': 5, // Necklace
    '/item_locations/ring': 5, // Ring
    '/item_locations/earrings': 5, // Earrings
    '/item_locations/back': 5, // Back/Cape
    '/item_locations/trinket': 5, // Trinket
    '/item_locations/charm': 5, // Charm
    '/item_locations/main_hand': 1, // Main hand weapon
    '/item_locations/two_hand': 1, // Two-handed weapon
    '/item_locations/off_hand': 1, // Off-hand/shield
    '/item_locations/head': 1, // Head armor
    '/item_locations/body': 1, // Body armor
    '/item_locations/legs': 1, // Leg armor
    '/item_locations/hands': 1, // Hand armor
    '/item_locations/feet': 1, // Feet armor
    '/item_locations/pouch': 1, // Pouch
};

/**
 * Calculate enhancement scaling for equipment stats
 * Uses percentage-based enhancement system with slot multipliers
 *
 * Formula: base × (1 + enhancementPercentage × slotMultiplier)
 *
 * @param {number} baseValue - Base stat value from item data
 * @param {number} enhancementLevel - Enhancement level (0-20)
 * @param {string} slotHrid - Equipment slot HRID (e.g., "/equipment_types/neck")
 * @returns {number} Scaled stat value
 *
 * @example
 * // Philosopher's Necklace +4 (4% base speed, neck slot 5×)
 * calculateEnhancementScaling(0.04, 4, '/equipment_types/neck')
 * // = 0.04 × (1 + 0.092 × 5) = 0.04 × 1.46 = 0.0584 (5.84%)
 *
 * // Lumberjack's Top +10 (10% base efficiency, body slot 1×)
 * calculateEnhancementScaling(0.10, 10, '/equipment_types/body')
 * // = 0.10 × (1 + 0.290 × 1) = 0.10 × 1.29 = 0.129 (12.9%)
 */
function calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid) {
    if (enhancementLevel === 0) {
        return baseValue;
    }

    // Get enhancement percentage from table
    const enhancementPercentage = ENHANCEMENT_PERCENTAGES[enhancementLevel] || 0;

    // Get slot multiplier (default to 1× if slot not found)
    const slotMultiplier = SLOT_MULTIPLIERS[slotHrid] || 1;

    // Apply formula: base × (1 + percentage × multiplier)
    return baseValue * (1 + enhancementPercentage * slotMultiplier);
}

/**
 * Generic equipment stat parser - handles all noncombat stats with consistent logic
 * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
 * @param {Object} itemDetailMap - Item details from init_client_data
 * @param {Object} config - Parser configuration
 * @param {string|null} config.skillSpecificField - Skill-specific field (e.g., "brewingSpeed")
 * @param {string|null} config.genericField - Generic skilling field (e.g., "skillingSpeed")
 * @param {boolean} config.returnAsPercentage - Whether to convert to percentage (multiply by 100)
 * @returns {number} Total stat bonus
 *
 * @example
 * // Parse speed bonuses for brewing
 * parseEquipmentStat(equipment, items, {
 *   skillSpecificField: "brewingSpeed",
 *   genericField: "skillingSpeed",
 *   returnAsPercentage: false
 * })
 */
function parseEquipmentStat(characterEquipment, itemDetailMap, config) {
    if (!characterEquipment || characterEquipment.size === 0) {
        return 0; // No equipment
    }

    if (!itemDetailMap) {
        return 0; // Missing item data
    }

    const { skillSpecificField, genericField, returnAsPercentage } = config;

    let totalBonus = 0;

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

        // Check for skill-specific stat (e.g., brewingSpeed, brewingEfficiency, brewingRareFind)
        if (skillSpecificField) {
            const baseValue = noncombatStats[skillSpecificField];

            if (baseValue && baseValue > 0) {
                const scaledValue = calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid);
                totalBonus += scaledValue;
            }
        }

        // Check for generic skilling stat (e.g., skillingSpeed, skillingEfficiency, skillingRareFind, skillingEssenceFind)
        if (genericField) {
            const baseValue = noncombatStats[genericField];

            if (baseValue && baseValue > 0) {
                const scaledValue = calculateEnhancementScaling(baseValue, enhancementLevel, slotHrid);
                totalBonus += scaledValue;
            }
        }
    }

    // Convert to percentage if requested (0.15 -> 15%)
    return returnAsPercentage ? totalBonus * 100 : totalBonus;
}

/**
 * Valid speed fields from game data
 */
const VALID_SPEED_FIELDS = [
    'milkingSpeed',
    'foragingSpeed',
    'woodcuttingSpeed',
    'cheesesmithingSpeed',
    'craftingSpeed',
    'tailoringSpeed',
    'brewingSpeed',
    'cookingSpeed',
    'alchemySpeed',
    'enhancingSpeed',
    'taskSpeed',
];

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
    const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Speed', VALID_SPEED_FIELDS);

    return parseEquipmentStat(characterEquipment, itemDetailMap, {
        skillSpecificField,
        genericField: 'skillingSpeed',
        returnAsPercentage: false,
    });
}

/**
 * Valid efficiency fields from game data
 */
const VALID_EFFICIENCY_FIELDS = [
    'milkingEfficiency',
    'foragingEfficiency',
    'woodcuttingEfficiency',
    'cheesesmithingEfficiency',
    'craftingEfficiency',
    'tailoringEfficiency',
    'brewingEfficiency',
    'cookingEfficiency',
    'alchemyEfficiency',
];

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
    const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Efficiency', VALID_EFFICIENCY_FIELDS);

    return parseEquipmentStat(characterEquipment, itemDetailMap, {
        skillSpecificField,
        genericField: 'skillingEfficiency',
        returnAsPercentage: true,
    });
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
    return parseEquipmentStat(characterEquipment, itemDetailMap, {
        skillSpecificField: null, // No skill-specific essence find
        genericField: 'skillingEssenceFind',
        returnAsPercentage: true,
    });
}

/**
 * Valid rare find fields from game data
 */
const VALID_RARE_FIND_FIELDS = [
    'milkingRareFind',
    'foragingRareFind',
    'woodcuttingRareFind',
    'cheesesmithingRareFind',
    'craftingRareFind',
    'tailoringRareFind',
    'brewingRareFind',
    'cookingRareFind',
    'alchemyRareFind',
    'enhancingRareFind',
];

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
    const skillSpecificField = getFieldForActionType(actionTypeHrid, 'RareFind', VALID_RARE_FIND_FIELDS);

    return parseEquipmentStat(characterEquipment, itemDetailMap, {
        skillSpecificField,
        genericField: 'skillingRareFind',
        returnAsPercentage: true,
    });
}

/**
 * Generic per-item equipment stat breakdown
 * @param {Map} characterEquipment - Equipment map
 * @param {Object} itemDetailMap - Item details
 * @param {string|null} skillSpecificField - e.g. "foragingEfficiency"
 * @param {string|null} genericField - e.g. "skillingEfficiency"
 * @param {boolean} returnAsPercentage - Multiply by 100
 * @returns {Array<{name, enhancementLevel, value}>}
 */
function parseEquipmentStatBreakdown(
    characterEquipment,
    itemDetailMap,
    skillSpecificField,
    genericField,
    returnAsPercentage
) {
    if (!characterEquipment || characterEquipment.size === 0) return [];
    if (!itemDetailMap) return [];

    const items = [];

    for (const [slotHrid, equippedItem] of characterEquipment) {
        const itemDetails = itemDetailMap[equippedItem.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

        const noncombatStats = itemDetails.equipmentDetail.noncombatStats;
        const enhancementLevel = equippedItem.enhancementLevel || 0;
        let value = 0;

        if (skillSpecificField) {
            const base = noncombatStats[skillSpecificField];
            if (base > 0) value += calculateEnhancementScaling(base, enhancementLevel, slotHrid);
        }
        if (genericField) {
            const base = noncombatStats[genericField];
            if (base > 0) value += calculateEnhancementScaling(base, enhancementLevel, slotHrid);
        }

        if (value > 0) {
            items.push({
                name: itemDetails.name,
                enhancementLevel,
                value: returnAsPercentage ? value * 100 : value,
            });
        }
    }

    return items;
}

/**
 * Get per-item efficiency bonus breakdown for an action type
 * @param {Map} characterEquipment - Equipment map
 * @param {string} actionTypeHrid - Action type HRID
 * @param {Object} itemDetailMap - Item details
 * @returns {Array<{name, enhancementLevel, value}>}
 */
export function parseEquipmentEfficiencyBreakdown(characterEquipment, actionTypeHrid, itemDetailMap) {
    const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Efficiency', VALID_EFFICIENCY_FIELDS);
    return parseEquipmentStatBreakdown(
        characterEquipment,
        itemDetailMap,
        skillSpecificField,
        'skillingEfficiency',
        true
    );
}

/**
 * Get per-item rare find bonus breakdown for an action type
 * @param {Map} characterEquipment - Equipment map
 * @param {string} actionTypeHrid - Action type HRID
 * @param {Object} itemDetailMap - Item details
 * @returns {Array<{name, enhancementLevel, value}>}
 */
export function parseRareFindBreakdown(characterEquipment, actionTypeHrid, itemDetailMap) {
    const skillSpecificField = getFieldForActionType(actionTypeHrid, 'RareFind', VALID_RARE_FIND_FIELDS);
    return parseEquipmentStatBreakdown(characterEquipment, itemDetailMap, skillSpecificField, 'skillingRareFind', true);
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
                const scaledValue = calculateEnhancementScaling(value, enhancementLevel, slotHrid);

                bonuses.push({
                    itemName: itemDetails.name,
                    itemHrid: equippedItem.itemHrid,
                    slot: slotHrid,
                    speedType: statName,
                    baseBonus: value,
                    enhancementLevel,
                    scaledBonus: scaledValue,
                });
            }
        }
    }

    return bonuses;
}
