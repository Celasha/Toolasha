/**
 * Custom Price Overrides
 * Manages user-defined buy/sell price overrides for profit calculations.
 * Overrides are stored in IndexedDB and cached in memory.
 */

import storage from '../../core/storage.js';

const STORAGE_KEY = 'Toolasha_customPriceOverrides';

/** @type {Object|null} In-memory cache of overrides */
let overridesCache = null;

/**
 * Load overrides from storage into cache
 * @returns {Promise<Object>} The overrides object
 */
async function loadOverrides() {
    if (overridesCache === null) {
        overridesCache = (await storage.getJSON(STORAGE_KEY, 'settings', {})) || {};
    }
    return overridesCache;
}

/**
 * Get all custom price overrides
 * @returns {Object} The overrides object (may be empty if not yet loaded)
 */
export function getCustomPriceOverrides() {
    if (overridesCache === null) {
        // Trigger async load but return empty for now
        loadOverrides();
        return {};
    }
    return overridesCache;
}

/**
 * Get all custom price overrides (async version, guaranteed loaded)
 * @returns {Promise<Object>} The overrides object
 */
export async function getCustomPriceOverridesAsync() {
    return loadOverrides();
}

/**
 * Get a custom price for a specific item, enhancement level, and transaction side.
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level (default 0)
 * @param {string} side - Transaction side ('buy' or 'sell')
 * @returns {number|null} Custom price or null if no override exists
 */
export function getCustomPrice(itemHrid, enhancementLevel = 0, side = 'sell') {
    const overrides = getCustomPriceOverrides();
    const key = `${itemHrid}:${enhancementLevel}`;
    const override = overrides[key];
    if (!override) {
        return null;
    }
    const price = override[side];
    if (price === undefined || price === null || price === '') {
        return null;
    }
    return price;
}

/**
 * Set a custom price override for an item
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level
 * @param {number|null} buy - Buy price override (null to clear)
 * @param {number|null} sell - Sell price override (null to clear)
 */
export async function setCustomPriceOverride(itemHrid, enhancementLevel, buy, sell) {
    const overrides = await loadOverrides();
    const key = `${itemHrid}:${enhancementLevel}`;

    const entry = {};
    if (buy !== null && buy !== undefined && buy !== '') {
        entry.buy = Number(buy);
    }
    if (sell !== null && sell !== undefined && sell !== '') {
        entry.sell = Number(sell);
    }

    if (Object.keys(entry).length === 0) {
        // Both empty — remove the override
        delete overrides[key];
    } else {
        overrides[key] = entry;
    }

    overridesCache = overrides;
    await storage.setJSON(STORAGE_KEY, overrides, 'settings', true);
}

/**
 * Remove a custom price override
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level
 */
export async function removeCustomPriceOverride(itemHrid, enhancementLevel) {
    const overrides = await loadOverrides();
    const key = `${itemHrid}:${enhancementLevel}`;
    delete overrides[key];
    overridesCache = overrides;
    await storage.setJSON(STORAGE_KEY, overrides, 'settings', true);
}

/**
 * Initialize the module by loading overrides from storage
 */
export async function initCustomPriceOverrides() {
    await loadOverrides();
}
