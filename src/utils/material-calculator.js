/**
 * Material Calculator Utility
 * Shared calculation logic for material requirements with artisan bonus
 */

import dataManager from '../core/data-manager.js';
import { parseArtisanBonus, getDrinkConcentration } from './tea-parser.js';

/**
 * Calculate material requirements for an action
 * @param {string} actionHrid - Action HRID (e.g., "/actions/crafting/celestial_enhancer")
 * @param {number} numActions - Number of actions to perform
 * @returns {Array<Object>} Array of material requirement objects (includes upgrade items)
 */
export function calculateMaterialRequirements(actionHrid, numActions) {
    const actionDetails = dataManager.getActionDetails(actionHrid);
    const inventory = dataManager.getInventory();
    const gameData = dataManager.getInitClientData();

    if (!actionDetails) {
        return [];
    }

    // Calculate artisan bonus (material reduction from Artisan Tea)
    const artisanBonus = calculateArtisanBonus(actionDetails);

    const materials = [];

    // Process regular input items first
    if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
        for (const input of actionDetails.inputItems) {
            const basePerAction = input.count || input.amount || 1;

            // Apply artisan reduction to materials
            // Materials are consumed PER ACTION
            // Efficiency gives bonus actions for FREE (no material cost)
            const materialsPerAction = basePerAction * (1 - artisanBonus);

            // Calculate total materials needed for queued actions
            const totalRequired = Math.ceil(materialsPerAction * numActions);

            const inventoryItem = inventory.find((i) => i.itemHrid === input.itemHrid);
            const have = inventoryItem?.count || 0;
            const missingAmount = Math.max(0, totalRequired - have);

            const itemDetails = gameData.itemDetailMap[input.itemHrid];
            if (!itemDetails) {
                continue;
            }

            materials.push({
                itemHrid: input.itemHrid,
                itemName: itemDetails.name,
                required: totalRequired,
                have: have,
                missing: missingAmount,
                isTradeable: itemDetails.isTradable === true, // British spelling
                isUpgradeItem: false,
            });
        }
    }

    // Process upgrade item at the end (if exists)
    if (actionDetails.upgradeItemHrid) {
        // Upgrade items always need exactly 1 per action, no artisan reduction
        const totalRequired = numActions;

        const inventoryItem = inventory.find((i) => i.itemHrid === actionDetails.upgradeItemHrid);
        const have = inventoryItem?.count || 0;
        const missingAmount = Math.max(0, totalRequired - have);

        const itemDetails = gameData.itemDetailMap[actionDetails.upgradeItemHrid];
        if (itemDetails) {
            materials.push({
                itemHrid: actionDetails.upgradeItemHrid,
                itemName: itemDetails.name,
                required: totalRequired,
                have: have,
                missing: missingAmount,
                isTradeable: itemDetails.isTradable === true, // British spelling
                isUpgradeItem: true, // Flag to identify upgrade items
            });
        }
    }

    return materials;
}

/**
 * Calculate artisan bonus (material reduction) for an action
 * @param {Object} actionDetails - Action details from game data
 * @returns {number} Artisan bonus (0-1 decimal, e.g., 0.1129 for 11.29% reduction)
 */
function calculateArtisanBonus(actionDetails) {
    try {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return 0;
        }

        // Get character data
        const equipment = dataManager.getEquipment();
        const itemDetailMap = gameData.itemDetailMap || {};

        // Calculate artisan bonus (material reduction from Artisan Tea)
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
        const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

        return artisanBonus;
    } catch (error) {
        console.error('[Material Calculator] Error calculating artisan bonus:', error);
        return 0;
    }
}
