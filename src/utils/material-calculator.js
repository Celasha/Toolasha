/**
 * Material Calculator Utility
 * Shared calculation logic for material requirements with artisan bonus
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { parseArtisanBonus, getDrinkConcentration } from './tea-parser.js';
import { getEnhancingParams } from './enhancement-config.js';
import { calculateEnhancement } from './enhancement-calculator.js';
import { resolveActionContext } from './action-context.js';

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
export function calculateQueuedMaterialsForAction(actionHrid = null) {
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

    const artisanMode = getArtisanMaterialMode();

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
                const totalForAction = calculateTotalRequired(basePerAction, artisanBonus, actionCount, artisanMode);

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
export function calculateMaterialRequirements(actionHrid, numActions, accountForQueue = false) {
    const actionDetails = dataManager.getActionDetails(actionHrid);
    const inventory = dataManager.getInventory();
    const gameData = dataManager.getInitClientData();

    if (!actionDetails) {
        return [];
    }

    const artisanMode = getArtisanMaterialMode();

    // Calculate artisan bonus (material reduction from Artisan Tea)
    const artisanBonus = calculateArtisanBonus(actionDetails);

    // Get queued materials if accounting for queue
    // Pass null to get materials for ALL queued actions (not just matching actionHrid)
    const queuedMaterialsMap = accountForQueue ? calculateQueuedMaterialsForAction(null) : new Map();

    const materials = [];

    // Process regular input items first
    if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
        for (const input of actionDetails.inputItems) {
            const basePerAction = input.count || input.amount || 1;

            // Calculate total materials needed for requested actions
            const totalRequired = calculateTotalRequired(basePerAction, artisanBonus, numActions, artisanMode);

            // Only count unenhanced items — enhanced copies are distinct items the player
            // would not want consumed as crafting materials
            const have = inventory
                .filter((i) => i.itemHrid === input.itemHrid && !i.enhancementLevel)
                .reduce((sum, i) => sum + (i.count || 0), 0);

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

        const have = inventory
            .filter((i) => i.itemHrid === actionDetails.upgradeItemHrid && !i.enhancementLevel)
            .reduce((sum, i) => sum + (i.count || 0), 0);

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
export function calculateArtisanBonus(actionDetails) {
    try {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return 0;
        }

        const { equipment, drinks: activeDrinks } = resolveActionContext(actionDetails.type);
        const itemDetailMap = gameData.itemDetailMap || {};
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

        return parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);
    } catch (error) {
        console.error('[Material Calculator] Error calculating artisan bonus:', error);
        return 0;
    }
}

/**
 * Returns true if artisan tea is selected in a drink slot but has 0 quantity in inventory.
 * Used to warn the user that material counts reflect no artisan reduction.
 * @param {string} actionHrid
 * @returns {boolean}
 */
export function isArtisanTeaOutOfStock(actionHrid) {
    try {
        const actionDetails = dataManager.getActionDetails(actionHrid);
        if (!actionDetails) return false;

        const gameData = dataManager.getInitClientData();
        if (!gameData) return false;

        const itemDetailMap = gameData.itemDetailMap || {};

        // Raw slotted drinks (ignoring stock)
        const rawDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
        if (!rawDrinks?.length) return false;

        // In-stock drinks come from resolveActionContext (already filtered)
        const { equipment, drinks: inStockDrinks } = resolveActionContext(actionDetails.type);
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

        return (
            parseArtisanBonus(rawDrinks, itemDetailMap, drinkConcentration) > 0 &&
            parseArtisanBonus(inStockDrinks, itemDetailMap, drinkConcentration) === 0
        );
    } catch (error) {
        console.error('[Material Calculator] Error checking artisan tea stock:', error);
        return false;
    }
}

/**
 * Calculate material requirements for enhancement actions
 * Uses Markov chain statistics to determine expected materials needed
 * @param {string} itemHrid - Item HRID being enhanced
 * @param {number} startLevel - Current enhancement level (0-19)
 * @param {number} targetLevel - Target enhancement level (1-20)
 * @param {string|null} protectionItemHrid - Protection item HRID or null
 * @param {number} protectFromLevel - Level at which protection begins (0 = never)
 * @returns {Array<Object>} Array of material requirement objects (same format as calculateMaterialRequirements)
 */
export function calculateEnhancementMaterialRequirements(
    itemHrid,
    startLevel,
    targetLevel,
    protectionItemHrid,
    protectFromLevel,
    repeatCount
) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) {
        return [];
    }

    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails) {
        return [];
    }

    const enhancementCosts = itemDetails.enhancementCosts || [];
    if (enhancementCosts.length === 0) {
        return [];
    }

    // Get enhancing parameters (level, tool bonus, teas, etc.)
    const params = getEnhancingParams();
    const effectiveProtect = protectFromLevel >= 2 && protectFromLevel <= targetLevel ? protectFromLevel : 0;

    // Single Markov chain call for the full level range
    const calc = calculateEnhancement({
        enhancingLevel: params.enhancingLevel,
        houseLevel: params.houseLevel,
        toolBonus: params.toolBonus,
        speedBonus: params.speedBonus,
        itemLevel: itemDetails.itemLevel || 1,
        targetLevel: targetLevel,
        startLevel: startLevel,
        protectFrom: effectiveProtect,
        blessedTea: params.teas.blessed,
        guzzlingBonus: params.guzzlingBonus,
    });

    const inventory = dataManager.getInventory();
    const materials = [];

    // Process enhancement cost materials
    for (const cost of enhancementCosts) {
        // Skip coins — not tradeable, auto-deducted by the game
        if (cost.itemHrid === '/items/coin') {
            continue;
        }

        const matDetails = gameData.itemDetailMap[cost.itemHrid];
        if (!matDetails) {
            continue;
        }

        const totalQuantity = Math.ceil(cost.count * (repeatCount ?? calc.attempts));
        const have = inventory
            .filter((i) => i.itemHrid === cost.itemHrid && !i.enhancementLevel)
            .reduce((sum, i) => sum + (i.count || 0), 0);
        const missing = Math.max(0, totalQuantity - have);

        materials.push({
            itemHrid: cost.itemHrid,
            itemName: matDetails.name,
            required: totalQuantity,
            have: have,
            queued: 0,
            available: have,
            missing: missing,
            isTradeable: matDetails.isTradable === true,
            isUpgradeItem: false,
        });
    }

    // Add protection item if applicable
    // Skip Philosopher's Mirror — special mechanic, not consumed as standard protection
    if (calc.protectionCount > 0 && protectionItemHrid && protectionItemHrid !== '/items/philosophers_mirror') {
        const totalProtection = Math.ceil(calc.protectionCount);
        const protDetails = gameData.itemDetailMap[protectionItemHrid];

        if (protDetails) {
            const have = inventory
                .filter((i) => i.itemHrid === protectionItemHrid && !i.enhancementLevel)
                .reduce((sum, i) => sum + (i.count || 0), 0);
            const missing = Math.max(0, totalProtection - have);

            materials.push({
                itemHrid: protectionItemHrid,
                itemName: protDetails.name,
                required: totalProtection,
                have: have,
                queued: 0,
                available: have,
                missing: missing,
                isTradeable: protDetails.isTradable === true,
                isUpgradeItem: false,
            });
        }
    }

    return materials;
}
