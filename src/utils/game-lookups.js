/**
 * Game Data Lookup Utilities
 *
 * Centralized functions for resolving display names to HRIDs.
 * Handles the ★ ↔ (R) refined item display name difference between
 * test server and live server.
 */

import dataManager from '../core/data-manager.js';

/**
 * Generate alternate display names to handle ★ ↔ (R) refined item naming.
 * @param {string} name - Original display name
 * @returns {string[]} Array of alternate names to try (may be empty)
 */
function getRefinedNameVariants(name) {
    const variants = [];
    if (name.includes('★')) {
        variants.push(name.replace(/\s*★/, ' (R)'));
    }
    if (name.includes('(R)')) {
        variants.push(name.replace(/\s*\(R\)/, ' ★'));
    }
    return variants;
}

/**
 * Find an action HRID from its display name.
 * Tries exact match first, then ★ ↔ (R) variants for refined items.
 * @param {string} actionName - Display name of the action
 * @returns {string|null} Action HRID or null if not found
 */
export function getActionHridFromName(actionName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // Try exact match first
    for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
        if (detail.name === actionName) {
            return hrid;
        }
    }

    // Try ★ ↔ (R) variants for refined items
    for (const variant of getRefinedNameVariants(actionName)) {
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === variant) {
                return hrid;
            }
        }
    }

    return null;
}

/**
 * Find an item HRID from its display name.
 * Tries exact match first, then ★ ↔ (R) variants for refined items.
 * @param {string} itemName - Display name of the item
 * @returns {string|null} Item HRID or null if not found
 */
export function getItemHridFromName(itemName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) {
        return null;
    }

    // Try exact match first
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (detail.name === itemName) {
            return hrid;
        }
    }

    // Try ★ ↔ (R) variants for refined items
    for (const variant of getRefinedNameVariants(itemName)) {
        for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
            if (detail.name === variant) {
                return hrid;
            }
        }
    }

    return null;
}
