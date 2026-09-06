/**
 * Equipment Score - value-once-fan-out orchestrator (TLA-041 / PB-19, PB-20)
 *
 * Prices each unique equipped `(itemHrid, enhancementLevel)` pair exactly once, classifies it
 * once, then attributes that single computed cost into the Combat and/or Skiller category
 * depending on its classification (an item classified into both domains contributes its one
 * computed cost to both totals - intentional, not a bug to dedupe away). Unique items are resolved
 * concurrently (TLA-041C); `resolveEquipmentItemCost` is async because it may await one shared,
 * cached enhancement expectation table per itemLevel/viewer-params combination, and that cache
 * naturally dedupes same-itemLevel items across concurrent calls.
 */

import dataManager from '../../../core/data-manager.js';
import { classifyEquipmentItem } from './equipment-classifier.js';
import { resolveEquipmentItemCost } from './equipment-resolver.js';
import { emptyCategory, attribute } from './score-result.js';

/**
 * @param {Object} profileData - Profile data from game
 * @param {Object} enhancingParams - Viewer's own params from getEnhancingParams()
 * @returns {Promise<{combat: Object, skiller: Object, hasEquipmentData: boolean}>}
 */
export async function calculateEquipmentScore(profileData, enhancingParams) {
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

    const uniqueItems = new Map(); // key: `${itemHrid}|${enhancementLevel}` -> resolved item metadata
    for (const itemData of Object.values(equippedItems)) {
        if (!itemData?.itemHrid) continue;

        const enhancementLevel = itemData.enhancementLevel || 0;
        const key = `${itemData.itemHrid}|${enhancementLevel}`;
        if (uniqueItems.has(key)) continue; // value once (PB-20)

        const itemDetails = itemDetailMap[itemData.itemHrid];
        if (!itemDetails) continue;

        const itemName = itemDetails.name || itemData.itemHrid.replace('/items/', '');
        const displayName = enhancementLevel > 0 ? `${itemName} +${enhancementLevel}` : itemName;
        const classification = classifyEquipmentItem(itemDetails.equipmentDetail);

        uniqueItems.set(key, {
            itemHrid: itemData.itemHrid,
            enhancementLevel,
            itemDetails,
            displayName,
            classification,
        });
    }

    const priced = await Promise.all(
        Array.from(uniqueItems.values()).map(async (entry) => {
            const resolved = await resolveEquipmentItemCost(
                entry.itemHrid,
                entry.enhancementLevel,
                entry.itemDetails,
                enhancingParams
            );
            return { ...resolved, name: entry.displayName, classification: entry.classification };
        })
    );

    const combat = emptyCategory();
    const skiller = emptyCategory();
    for (const leaf of priced) {
        if (leaf.classification.combat) attribute(combat, leaf);
        if (leaf.classification.skiller) attribute(skiller, leaf);
    }

    return { combat, skiller, hasEquipmentData };
}
