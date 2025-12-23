/**
 * Enhancement Multiplier System
 *
 * Handles enhancement bonus calculations for equipment.
 * Different equipment slots have different multipliers:
 * - Accessories (neck/ring/earring), Back, Trinket, Charm: 5× multiplier
 * - All other slots (weapons, armor, pouch): 1× multiplier
 */

/**
 * Enhancement multiplier by equipment slot type
 */
export const ENHANCEMENT_MULTIPLIERS = {
    '/equipment_types/neck': 5,
    '/equipment_types/ring': 5,
    '/equipment_types/earring': 5,
    '/equipment_types/back': 5,
    '/equipment_types/trinket': 5,
    '/equipment_types/charm': 5,
    // All other slots: 1× (default)
};

/**
 * Enhancement bonus table
 * Maps enhancement level to percentage bonus
 */
export const ENHANCEMENT_BONUSES = {
    1: 0.020,  2: 0.042,  3: 0.066,  4: 0.092,  5: 0.120,
    6: 0.150,  7: 0.182,  8: 0.216,  9: 0.252, 10: 0.290,
    11: 0.334, 12: 0.384, 13: 0.440, 14: 0.502, 15: 0.570,
    16: 0.644, 17: 0.724, 18: 0.810, 19: 0.902, 20: 1.000
};

/**
 * Get enhancement multiplier for an item
 * @param {Object} itemDetails - Item details from itemDetailMap
 * @param {number} enhancementLevel - Current enhancement level of item
 * @returns {number} Multiplier to apply to bonuses
 */
export function getEnhancementMultiplier(itemDetails, enhancementLevel) {
    if (enhancementLevel === 0) {
        return 1;
    }

    const equipmentType = itemDetails?.equipmentDetail?.type;
    const slotMultiplier = ENHANCEMENT_MULTIPLIERS[equipmentType] || 1;
    const enhancementBonus = ENHANCEMENT_BONUSES[enhancementLevel] || 0;

    return 1 + (enhancementBonus * slotMultiplier);
}
