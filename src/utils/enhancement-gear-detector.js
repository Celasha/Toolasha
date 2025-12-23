/**
 * Enhancement Gear Detector
 *
 * Auto-detects enhancing gear and buffs from character equipment and consumables.
 * Finds the best equipped tool (success rate) and gloves (speed) for enhancing.
 */

/**
 * Enhancement multiplier by enhancement level
 * Accessories/Back/Trinket/Charm: 5× multiplier
 * All other slots: 1× multiplier
 */
const ENHANCEMENT_MULTIPLIERS = {
    '/equipment_types/neck': 5,
    '/equipment_types/ring': 5,
    '/equipment_types/earring': 5,
    '/equipment_types/back': 5,
    '/equipment_types/trinket': 5,
    '/equipment_types/charm': 5,
    // All other slots: 1× (default)
};

/**
 * Get enhancement multiplier for an item
 * @param {Object} itemDetails - Item details from itemDetailMap
 * @param {number} enhancementLevel - Current enhancement level of item
 * @returns {number} Multiplier to apply to bonuses
 */
function getEnhancementMultiplier(itemDetails, enhancementLevel) {
    if (enhancementLevel === 0) {
        return 1;
    }

    const equipmentType = itemDetails?.equipmentDetail?.equipmentType;
    const slotMultiplier = ENHANCEMENT_MULTIPLIERS[equipmentType] || 1;

    // Enhancement bonus table (same as original MWI Tools)
    const enhancementBonuses = {
        1: 0.020,  2: 0.042,  3: 0.066,  4: 0.092,  5: 0.120,
        6: 0.150,  7: 0.182,  8: 0.216,  9: 0.252, 10: 0.290,
        11: 0.334, 12: 0.384, 13: 0.440, 14: 0.502, 15: 0.570,
        16: 0.644, 17: 0.724, 18: 0.810, 19: 0.902, 20: 1.000
    };

    const enhancementBonus = enhancementBonuses[enhancementLevel] || 0;
    return 1 + (enhancementBonus * slotMultiplier);
}

/**
 * Detect best enhancing gear from all available items (equipped + inventory)
 * @param {Map} equipment - Character equipment map (for backward compatibility, can be null)
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @param {Array} inventory - Character inventory array (all items including equipped)
 * @returns {Object} Best enhancing gear for each stat
 */
export function detectEnhancingGear(equipment, itemDetailMap, inventory = null) {
    const gear = {
        // Success rate (tool) - usually just one item
        toolItems: [],
        toolBonus: 0,

        // Speed (gloves/clothing) - can be multiple items
        speedItems: [],
        speedBonus: 0,

        // Rare Find (clothing) - can be multiple items
        rareFindItems: [],
        rareFindBonus: 0,

        // Experience (clothing) - can be multiple items
        experienceItems: [],
        experienceBonus: 0,
    };

    // Get items to scan - use inventory if provided, otherwise fall back to equipment
    let itemsToScan = [];

    if (inventory) {
        // Scan all items in inventory (includes equipped items)
        itemsToScan = inventory.filter(item => item && item.itemHrid);
    } else if (equipment) {
        // Fallback: scan only equipped items
        itemsToScan = Array.from(equipment.values()).filter(item => item && item.itemHrid);
    }

    // Search all items for enhancing bonuses
    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

        const stats = itemDetails.equipmentDetail.noncombatStats;
        const enhancementLevel = item.enhancementLevel || 0;
        const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);

        // Check for enhancing success rate (tools: celestial enhancer, etc.)
        if (stats.enhancingSuccess) {
            const bonus = stats.enhancingSuccess * 100 * multiplier;
            gear.toolBonus += bonus;
            gear.toolItems.push({
                name: itemDetails.name,
                enhancementLevel: enhancementLevel,
                bonus: bonus
            });
        }

        // Check for enhancing speed (gloves/clothing)
        if (stats.enhancingSpeed) {
            const bonus = stats.enhancingSpeed * 100 * multiplier;
            gear.speedBonus += bonus;
            gear.speedItems.push({
                name: itemDetails.name,
                enhancementLevel: enhancementLevel,
                bonus: bonus
            });
        }

        // Check for enhancing rare find (clothing)
        if (stats.enhancingRareFind) {
            const bonus = stats.enhancingRareFind * 100 * multiplier;
            gear.rareFindBonus += bonus;
            gear.rareFindItems.push({
                name: itemDetails.name,
                enhancementLevel: enhancementLevel,
                bonus: bonus
            });
        }

        // Check for enhancing experience (clothing)
        if (stats.enhancingExperience) {
            const bonus = stats.enhancingExperience * 100 * multiplier;
            gear.experienceBonus += bonus;
            gear.experienceItems.push({
                name: itemDetails.name,
                enhancementLevel: enhancementLevel,
                bonus: bonus
            });
        }
    }

    return gear;
}

/**
 * Detect active enhancing teas from drink slots
 * @param {Array} drinkSlots - Active drink slots for enhancing action type
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @returns {Object} Active teas { enhancing, superEnhancing, ultraEnhancing, blessed }
 */
export function detectEnhancingTeas(drinkSlots, itemDetailMap) {
    const teas = {
        enhancing: false,        // Enhancing Tea (+3 levels)
        superEnhancing: false,   // Super Enhancing Tea (+6 levels)
        ultraEnhancing: false,   // Ultra Enhancing Tea (+8 levels)
        blessed: false,          // Blessed Tea (1% double jump)
    };

    if (!drinkSlots || drinkSlots.length === 0) {
        return teas;
    }

    // Tea HRIDs to check for
    const teaMap = {
        '/items/enhancing_tea': 'enhancing',
        '/items/super_enhancing_tea': 'superEnhancing',
        '/items/ultra_enhancing_tea': 'ultraEnhancing',
        '/items/blessed_tea': 'blessed',
    };

    for (const drink of drinkSlots) {
        if (!drink || !drink.itemHrid) continue;

        const teaKey = teaMap[drink.itemHrid];
        if (teaKey) {
            teas[teaKey] = true;
        }
    }

    return teas;
}

/**
 * Get enhancing tea level bonus
 * @param {Object} teas - Active teas from detectEnhancingTeas()
 * @returns {number} Total level bonus from teas
 */
export function getEnhancingTeaLevelBonus(teas) {
    let bonus = 0;

    if (teas.enhancing) bonus += 3;
    if (teas.superEnhancing) bonus += 6;
    if (teas.ultraEnhancing) bonus += 8;

    // Teas don't stack - highest one wins
    // So we actually need to return the max, not sum
    if (teas.ultraEnhancing) return 8;
    if (teas.superEnhancing) return 6;
    if (teas.enhancing) return 3;

    return 0;
}
