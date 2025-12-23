/**
 * Enhancement Gear Detector
 *
 * Auto-detects enhancing gear and buffs from character equipment and consumables.
 * Finds the best equipped tool (success rate) and gloves (speed) for enhancing.
 */

import { getEnhancementMultiplier } from './enhancement-multipliers.js';

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
        tool: [],    // main_hand or two_hand or enhancing_tool
        body: [],    // body
        legs: [],    // legs
        hands: [],   // hands
        neck: [],    // neck (accessories have 5× multiplier)
        ring: [],    // ring (accessories have 5× multiplier)
        earring: [], // earring (accessories have 5× multiplier)
    };

    // Search all items for enhancing bonuses and group by slot
    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

        const stats = itemDetails.equipmentDetail.noncombatStats;
        const enhancementLevel = item.enhancementLevel || 0;
        const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
        const equipmentType = itemDetails.equipmentDetail.type;

        // Check if item has any enhancing-related stats (including universal skillingSpeed)
        const hasEnhancingStats = stats.enhancingSuccess || stats.enhancingSpeed ||
                                  stats.enhancingRareFind || stats.enhancingExperience ||
                                  stats.skillingSpeed;

        if (!hasEnhancingStats) continue;

        // Calculate all bonuses for this item
        let itemBonuses = {
            item: item,
            itemDetails: itemDetails,
            itemLevel: itemDetails.itemLevel || 0,
            enhancementLevel: enhancementLevel,
            toolBonus: stats.enhancingSuccess ? stats.enhancingSuccess * 100 * multiplier : 0,
            speedBonus: (stats.enhancingSpeed ? stats.enhancingSpeed * 100 * multiplier : 0) +
                       (stats.skillingSpeed ? stats.skillingSpeed * 100 * multiplier : 0),  // Add universal speed
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
        } else if (equipmentType === '/equipment_types/neck') {
            slotCandidates.neck.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/ring') {
            slotCandidates.ring.push(itemBonuses);
        } else if (equipmentType === '/equipment_types/earring') {
            slotCandidates.earring.push(itemBonuses);
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
    const bestNeck = selectBest(slotCandidates.neck);
    const bestRing = selectBest(slotCandidates.ring);
    const bestEarring = selectBest(slotCandidates.earring);

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

    if (bestNeck) {
        gear.toolBonus += bestNeck.toolBonus;
        gear.speedBonus += bestNeck.speedBonus;
        gear.rareFindBonus += bestNeck.rareFindBonus;
        gear.experienceBonus += bestNeck.experienceBonus;
    }

    if (bestRing) {
        gear.toolBonus += bestRing.toolBonus;
        gear.speedBonus += bestRing.speedBonus;
        gear.rareFindBonus += bestRing.rareFindBonus;
        gear.experienceBonus += bestRing.experienceBonus;
    }

    if (bestEarring) {
        gear.toolBonus += bestEarring.toolBonus;
        gear.speedBonus += bestEarring.speedBonus;
        gear.rareFindBonus += bestEarring.rareFindBonus;
        gear.experienceBonus += bestEarring.experienceBonus;
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
