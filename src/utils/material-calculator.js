/**
 * Material Calculator Utility
 * Shared calculation logic for material requirements with artisan bonus
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { parseArtisanBonus, getDrinkConcentration } from './tea-parser.js';

export const ARTISAN_MATERIAL_MODE = {
    EXPECTED: 'expected',
    WORST_CASE: 'worst-case',
};

function normalizeArtisanMode(mode) {
    return mode === ARTISAN_MATERIAL_MODE.WORST_CASE
        ? ARTISAN_MATERIAL_MODE.WORST_CASE
        : ARTISAN_MATERIAL_MODE.EXPECTED;
}

/**
 * Get artisan material mode setting.
 * @returns {string}
 */
function getArtisanMaterialMode() {
    const setting = config.getSettingValue('actions_artisanMaterialMode', ARTISAN_MATERIAL_MODE.EXPECTED);
    return normalizeArtisanMode(setting);
}
/**
 * Calculate total materials required, optionally using conservative per-action rounding.
 * @param {number} basePerAction
 * @param {number} artisanBonus
 * @param {number} numActions
 * @param {string} artisanMode
 * @returns {number}
 */
function calculateTotalRequired(basePerAction, artisanBonus, numActions, artisanMode) {
    const materialsPerAction = basePerAction * (1 - artisanBonus);
    if (artisanMode === ARTISAN_MATERIAL_MODE.WORST_CASE) {
        return Math.ceil(materialsPerAction) * numActions;
    }
    return Math.ceil(materialsPerAction * numActions);
}

/**
 * Calculate materials reserved by queued actions
 * @param {string} actionHrid - Action HRID to check queue for (optional - if null, calculates for ALL queued actions)
 * @returns {Map<string, number>} Map of itemHrid -> queued quantity
 */
export function calculateQueuedMaterialsForAction(actionHrid = null, artisanMode = ARTISAN_MATERIAL_MODE.EXPECTED) {
    const queuedMaterials = new Map();
    const gameData = dataManager.getInitClientData();

    if (!gameData) {
        return queuedMaterials;
    }

    // Get all queued actions
    const queuedActions = dataManager.getCurrentActions();

    if (!queuedActions || queuedActions.length === 0) {
        return queuedMaterials;
    }

    const normalizedArtisanMode = normalizeArtisanMode(artisanMode);

    // Process each queued action
    for (const queuedAction of queuedActions) {
        // If actionHrid is specified, only process matching actions
        if (actionHrid && queuedAction.actionHrid !== actionHrid) {
            continue;
        }

        const actionDetails = dataManager.getActionDetails(queuedAction.actionHrid);
        if (!actionDetails) {
            continue;
        }

        // Calculate remaining actions for this queued action
        // Finite actions: maxCount is target, currentCount is progress
        // Infinite actions: Skip for now (would require material limit calculation which is complex)
        let actionCount = 0;
        if (queuedAction.hasMaxCount) {
            actionCount = queuedAction.maxCount - queuedAction.currentCount;
        } else {
            // Infinite action - skip for now (materials for infinite actions are complex)
            // User can use the "Ignore queue" setting if they queue many infinite actions
            continue;
        }

        if (actionCount <= 0) {
            continue;
        }

        // Calculate artisan bonus for this action type
        const artisanBonus = calculateArtisanBonus(actionDetails);

        // Process regular input items
        if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
            for (const input of actionDetails.inputItems) {
                const basePerAction = input.count || input.amount || 1;

                // Calculate total materials needed for this queued action
                const totalForAction = calculateTotalRequired(
                    basePerAction,
                    artisanBonus,
                    actionCount,
                    normalizedArtisanMode
                );

                // Add to queued total
                const currentQueued = queuedMaterials.get(input.itemHrid) || 0;
                queuedMaterials.set(input.itemHrid, currentQueued + totalForAction);
            }
        }

        // Process upgrade item (if exists)
        if (actionDetails.upgradeItemHrid) {
            // Upgrade items always need exactly 1 per action, no artisan reduction
            const totalForAction = actionCount;

            const currentQueued = queuedMaterials.get(actionDetails.upgradeItemHrid) || 0;
            queuedMaterials.set(actionDetails.upgradeItemHrid, currentQueued + totalForAction);
        }
    }

    return queuedMaterials;
}

/**
 * Calculate material requirements for an action
 * @param {string} actionHrid - Action HRID (e.g., "/actions/crafting/celestial_enhancer")
 * @param {number} numActions - Number of actions to perform
 * @param {boolean} accountForQueue - Whether to subtract queued materials from available inventory (default: false)
 * @returns {Array<Object>} Array of material requirement objects (includes upgrade items)
 */
export function calculateMaterialRequirements(actionHrid, numActions, accountForQueue = false, options = {}) {
    const actionDetails = dataManager.getActionDetails(actionHrid);
    const inventory = dataManager.getInventory();
    const gameData = dataManager.getInitClientData();

    if (!actionDetails) {
        return [];
    }

    const normalizedArtisanMode = normalizeArtisanMode(
        options.artisanMode === undefined ? getArtisanMaterialMode() : options.artisanMode
    );

    // Calculate artisan bonus (material reduction from Artisan Tea)
    const artisanBonus = calculateArtisanBonus(actionDetails);

    // Get queued materials if accounting for queue
    // Pass null to get materials for ALL queued actions (not just matching actionHrid)
    const queuedMaterialsMap = accountForQueue
        ? calculateQueuedMaterialsForAction(null, normalizedArtisanMode)
        : new Map();

    const materials = [];

    // Process regular input items first
    if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
        for (const input of actionDetails.inputItems) {
            const basePerAction = input.count || input.amount || 1;

            // Calculate total materials needed for requested actions
            const totalRequired = calculateTotalRequired(
                basePerAction,
                artisanBonus,
                numActions,
                normalizedArtisanMode
            );

            const inventoryItem = inventory.find((i) => i.itemHrid === input.itemHrid);
            const have = inventoryItem?.count || 0;

            // Calculate queued and available amounts
            const queued = queuedMaterialsMap.get(input.itemHrid) || 0;
            const available = Math.max(0, have - queued);
            const missingAmount = Math.max(0, totalRequired - available);

            const itemDetails = gameData.itemDetailMap[input.itemHrid];
            if (!itemDetails) {
                continue;
            }

            materials.push({
                itemHrid: input.itemHrid,
                itemName: itemDetails.name,
                required: totalRequired,
                have: have,
                queued: queued,
                available: available,
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

        // Calculate queued and available amounts
        const queued = queuedMaterialsMap.get(actionDetails.upgradeItemHrid) || 0;
        const available = Math.max(0, have - queued);
        const missingAmount = Math.max(0, totalRequired - available);

        const itemDetails = gameData.itemDetailMap[actionDetails.upgradeItemHrid];
        if (itemDetails) {
            materials.push({
                itemHrid: actionDetails.upgradeItemHrid,
                itemName: itemDetails.name,
                required: totalRequired,
                have: have,
                queued: queued,
                available: available,
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
