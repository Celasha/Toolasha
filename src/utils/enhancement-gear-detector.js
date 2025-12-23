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

    const equipmentType = itemDetails?.equipmentDetail?.type;
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
 * Detect best enhancing gear by equipment slot
 * @param {Map} equipment - Character equipment map (for backward compatibility, can be null)
 * @param {Object} itemDetailMap - Item details map from init_client_data
 * @param {Array} inventory - Character inventory array (all items including equipped)
 * @returns {Object} Best enhancing gear per slot with bonuses
 */
export function detectEnhancingGear(equipment, itemDetailMap, inventory = null) {
    const gear = {
        // Totals for calculations
        toolBonus: 0,
        speedBonus: 0,
        rareFindBonus: 0,
        experienceBonus: 0,

        // Best items per slot for display
        toolSlot: null,    // main_hand or two_hand
        bodySlot: null,    // body
        legsSlot: null,    // legs
        handsSlot: null,   // hands
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

    // Track best item per slot (by item level, then enhancement level)
    const slotCandidates = {
        tool: [],    // main_hand or two_hand
        body: [],    // body
        legs: [],    // legs
        hands: [],   // hands
    };

    // Search all items for enhancing bonuses and group by slot
    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

        const stats = itemDetails.equipmentDetail.noncombatStats;
        const enhancementLevel = item.enhancementLevel || 0;
        const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
        const equipmentType = itemDetails.equipmentDetail.type;

        // Check if item has any enhancing stats
        const hasEnhancingStats = stats.enhancingSuccess || stats.enhancingSpeed ||
                                  stats.enhancingRareFind || stats.enhancingExperience;

        if (!hasEnhancingStats) continue;

        // Calculate all bonuses for this item
        let itemBonuses = {
            item: item,
            itemDetails: itemDetails,
            itemLevel: itemDetails.itemLevel || 0,
            enhancementLevel: enhancementLevel,
            toolBonus: stats.enhancingSuccess ? stats.enhancingSuccess * 100 * multiplier : 0,
            speedBonus: stats.enhancingSpeed ? stats.enhancingSpeed * 100 * multiplier : 0,
            rareFindBonus: stats.enhancingRareFind ? stats.enhancingRareFind * 100 * multiplier : 0,
            experienceBonus: stats.enhancingExperience ? stats.enhancingExperience * 100 * multiplier : 0,
        };

        // Group by slot
        if (equipmentType === '/equipment_types/enhancing_tool' ||
            equipmentType === '/equipment_types/main_hand' ||
            equipmentType === '/equipment_types/two_hand') {
            slotCandidates.tool.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/body') {
            slotCandidates.body.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/legs') {
            slotCandidates.legs.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/hands') {
            slotCandidates.hands.push(itemBonuses);
        }
    }

    // Select best item per slot (highest item level, then highest enhancement level)
    const selectBest = (candidates) => {
        if (candidates.length === 0) return null;

        return candidates.reduce((best, current) => {
            // Compare by item level first
            if (current.itemLevel > best.itemLevel) return current;
            if (current.itemLevel < best.itemLevel) return best;

            // If item levels are equal, compare by enhancement level
            if (current.enhancementLevel > best.enhancementLevel) return current;
            return best;
        });
    };

    const bestTool = selectBest(slotCandidates.tool);
    const bestBody = selectBest(slotCandidates.body);
    const bestLegs = selectBest(slotCandidates.legs);
    const bestHands = selectBest(slotCandidates.hands);

    // Add bonuses from best items in each slot
    if (bestTool) {
        gear.toolBonus += bestTool.toolBonus;
        gear.speedBonus += bestTool.speedBonus;
        gear.rareFindBonus += bestTool.rareFindBonus;
        gear.experienceBonus += bestTool.experienceBonus;
        gear.toolSlot = {
            name: bestTool.itemDetails.name,
            enhancementLevel: bestTool.enhancementLevel,
        };
    }

    if (bestBody) {
        gear.toolBonus += bestBody.toolBonus;
        gear.speedBonus += bestBody.speedBonus;
        gear.rareFindBonus += bestBody.rareFindBonus;
        gear.experienceBonus += bestBody.experienceBonus;
        gear.bodySlot = {
            name: bestBody.itemDetails.name,
            enhancementLevel: bestBody.enhancementLevel,
        };
    }

    if (bestLegs) {
        gear.toolBonus += bestLegs.toolBonus;
        gear.speedBonus += bestLegs.speedBonus;
        gear.rareFindBonus += bestLegs.rareFindBonus;
        gear.experienceBonus += bestLegs.experienceBonus;
        gear.legsSlot = {
            name: bestLegs.itemDetails.name,
            enhancementLevel: bestLegs.enhancementLevel,
        };
    }

    if (bestHands) {
        gear.toolBonus += bestHands.toolBonus;
        gear.speedBonus += bestHands.speedBonus;
        gear.rareFindBonus += bestHands.rareFindBonus;
        gear.experienceBonus += bestHands.experienceBonus;
        gear.handsSlot = {
            name: bestHands.itemDetails.name,
            enhancementLevel: bestHands.enhancementLevel,
        };
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
    // Teas don't stack - highest one wins
    if (teas.ultraEnhancing) return 8;
    if (teas.superEnhancing) return 6;
    if (teas.enhancing) return 3;

    return 0;
}

/**
 * Get enhancing tea speed bonus (base, before concentration)
 * @param {Object} teas - Active teas from detectEnhancingTeas()
 * @returns {number} Base speed bonus % from teas
 */
export function getEnhancingTeaSpeedBonus(teas) {
    // Teas don't stack - highest one wins
    // Base speed bonuses (before drink concentration):
    if (teas.ultraEnhancing) return 6;  // +6% base
    if (teas.superEnhancing) return 4;  // +4% base
    if (teas.enhancing) return 2;        // +2% base

    return 0;
}
