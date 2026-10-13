/**
 * Alchemy Material Calculator
 * Missing-material math for the Alchemy panel: the selected item is consumed
 * `bulkMultiplier` times per action, and the Repeat count already includes efficiency repeats.
 */

import dataManager from '../core/data-manager.js';
import { calculateQueuedMaterialsForAction } from './material-calculator.js';

/**
 * Split an inventory item hash ("{characterId}::{location}::{itemHrid}::{level}").
 * @param {string} itemHash - Inventory item hash
 * @returns {{itemHrid: string, enhancementLevel: number}|null} Parsed parts, or null if malformed
 */
export function parseInventoryItemHash(itemHash) {
    const parts = typeof itemHash === 'string' ? itemHash.split('::') : [];
    if (parts.length < 4) return null;
    const enhancementLevel = Number.parseInt(parts.at(-1), 10);
    if (!parts.at(-2) || !Number.isInteger(enhancementLevel)) return null;
    return { itemHrid: parts.at(-2), enhancementLevel };
}

/**
 * Items consumed per Alchemy action for an item.
 * @param {string} itemHrid - Item HRID
 * @returns {number} Items consumed per action (at least 1)
 */
export function getAlchemyItemsPerAction(itemHrid) {
    const bulk = Number(dataManager.getItemDetails(itemHrid)?.alchemyDetail?.bulkMultiplier);
    return Number.isFinite(bulk) && bulk >= 1 ? bulk : 1;
}

/**
 * Items already reserved by finite queued Alchemy actions on the same unenhanced item.
 * @param {string} itemHrid - Item HRID
 * @returns {number} Reserved item count
 */
function calculateQueuedAlchemyItems(itemHrid) {
    let reserved = 0;
    for (const queued of dataManager.getCurrentActions() || []) {
        if (!queued.hasMaxCount || !queued.primaryItemHash) continue;
        const parsed = parseInventoryItemHash(queued.primaryItemHash);
        if (!parsed || parsed.itemHrid !== itemHrid || parsed.enhancementLevel !== 0) continue;
        const remaining = (queued.maxCount ?? 0) - (queued.currentCount ?? 0);
        if (remaining > 0) reserved += remaining * getAlchemyItemsPerAction(itemHrid);
    }
    return reserved;
}

/**
 * Material requirements for repeating an Alchemy action on one unenhanced item.
 * Coins and catalysts are not included.
 * @param {string} itemHrid - Item being processed
 * @param {number} numActions - Repeat count
 * @param {boolean} [accountForQueue=false] - Subtract items already reserved by the queue
 * @returns {Array<Object>} Single material entry (same shape as calculateMaterialRequirements), or [] if unknown
 */
export function calculateAlchemyMaterialRequirements(itemHrid, numActions, accountForQueue = false) {
    const itemDetails = dataManager.getItemDetails(itemHrid);
    if (!itemDetails || !(numActions > 0)) return [];

    const required = numActions * getAlchemyItemsPerAction(itemHrid);
    const have = (dataManager.getInventory() || [])
        .filter((item) => item.itemHrid === itemHrid && !item.enhancementLevel)
        .reduce((sum, item) => sum + (item.count || 0), 0);
    const queued = accountForQueue
        ? (calculateQueuedMaterialsForAction(null).get(itemHrid) || 0) + calculateQueuedAlchemyItems(itemHrid)
        : 0;
    const available = Math.max(0, have - queued);

    return [
        {
            itemHrid,
            itemName: itemDetails.name,
            required,
            have,
            queued,
            available,
            missing: Math.max(0, required - available),
            isTradeable: itemDetails.isTradable === true,
            isUpgradeItem: false,
        },
    ];
}
