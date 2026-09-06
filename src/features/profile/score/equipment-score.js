/**
 * Equipment Score - value-once-fan-out orchestrator (TLA-041 / PB-19, PB-20)
 *
 * Prices each unique equipped `(itemHrid, enhancementLevel)` pair exactly once, classifies it
 * once, then attributes that single computed cost into the Combat and/or Skiller category
 * depending on its classification (an item classified into both domains contributes its one
 * computed cost to both totals - intentional, not a bug to dedupe away).
 */

import dataManager from '../../../core/data-manager.js';
import { classifyEquipmentItem } from './equipment-classifier.js';
import { resolveEquipmentItemCost } from './equipment-resolver.js';
import { emptyCategory, attribute } from './score-result.js';

/**
 * @param {Object} profileData - Profile data from game
 * @param {Object} enhancingParams - Viewer's own params from getEnhancingParams()
 * @returns {{combat: Object, skiller: Object, hasEquipmentData: boolean}}
 */
export function calculateEquipmentScore(profileData, enhancingParams) {
    const equippedItems = profileData.profile?.wearableItemMap || {};
    const hideEquipment = profileData.profile?.hideWearableItems || false;
    const hasEquipmentData = Object.keys(equippedItems).length > 0;

    if (hideEquipment && !hasEquipmentData) {
        // Hidden with no actual payload: a genuine lower bound, not a deceptively exact 0 (PB-48).
        const combat = emptyCategory();
        const skiller = emptyCategory();
        combat.complete = false;
        skiller.complete = false;
        return { combat, skiller, hasEquipmentData: false };
    }

    const gameData = dataManager.getInitClientData();
    const itemDetailMap = gameData?.itemDetailMap || {};

    const priced = new Map(); // key: `${itemHrid}|${enhancementLevel}` -> priced leaf + classification

    for (const itemData of Object.values(equippedItems)) {
        if (!itemData?.itemHrid) continue;

        const enhancementLevel = itemData.enhancementLevel || 0;
        const key = `${itemData.itemHrid}|${enhancementLevel}`;
        if (priced.has(key)) continue; // value once (PB-20)

        const itemDetails = itemDetailMap[itemData.itemHrid];
        if (!itemDetails) continue;

        const resolved = resolveEquipmentItemCost(itemData.itemHrid, enhancementLevel, itemDetails, enhancingParams);
        const classification = classifyEquipmentItem(itemDetails.equipmentDetail);

        const itemName = itemDetails.name || itemData.itemHrid.replace('/items/', '');
        const displayName = enhancementLevel > 0 ? `${itemName} +${enhancementLevel}` : itemName;

        priced.set(key, { ...resolved, name: displayName, classification });
    }

    const combat = emptyCategory();
    const skiller = emptyCategory();
    for (const leaf of priced.values()) {
        if (leaf.classification.combat) attribute(combat, leaf);
        if (leaf.classification.skiller) attribute(skiller, leaf);
    }

    return { combat, skiller, hasEquipmentData };
}
