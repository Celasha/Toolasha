/**
 * Networth Exclusions
 * Manages the list of assets to exclude from net worth calculation.
 * Persisted per character to IndexedDB (settings store).
 *
 * Exclusion types:
 *   assetType  - entire section ('houses', 'abilities', 'abilityBooks', 'listings', 'equipped')
 *   category   - all items in an inventory category ('/item_categories/food', etc.)
 *   item       - all stacks of a specific item type ('/items/...')
 *   houseRoom  - one specific house room ('/house_rooms/...')
 *   ability    - one specific ability ('/abilities/...')
 *   loadout    - all equipment items in a named loadout snapshot
 */

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';

const STORAGE_KEY_PREFIX = 'networth_exclusions';

/** @type {Array<{type: string, value: string}>|null} In-memory cache */
let cache = null;

/**
 * Get the character-scoped storage key.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

/**
 * Load exclusions from storage into memory.
 * @returns {Promise<Array<{type: string, value: string}>>}
 */
async function loadExclusions() {
    if (cache === null) {
        cache = (await storage.getJSON(getStorageKey(), 'settings', [])) || [];
    }
    return cache;
}

/**
 * Initialize exclusions — call at feature startup to warm the cache.
 * @returns {Promise<void>}
 */
export async function initExclusions() {
    await loadExclusions();
}

/**
 * Get all current exclusions synchronously (may be empty before initExclusions completes).
 * @returns {Array<{type: string, value: string}>}
 */
export function getExclusions() {
    return cache ?? [];
}

/**
 * Check whether a given type/value pair is currently excluded.
 * @param {string} type - 'assetType' | 'category' | 'item' | 'houseRoom' | 'ability' | 'loadout'
 * @param {string} value - HRID or loadout name
 * @returns {boolean}
 */
export function isExcluded(type, value) {
    const list = cache ?? [];
    return list.some((e) => e.type === type && e.value === value);
}

/**
 * Add an exclusion if it does not already exist. Persists to storage.
 * @param {string} type
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function addExclusion(type, value) {
    const list = await loadExclusions();
    if (!list.some((e) => e.type === type && e.value === value)) {
        list.push({ type, value });
        cache = list;
        // Fire-and-forget: persist in background so the UI updates instantly
        storage.setJSON(getStorageKey(), list, 'settings');
    }
}

/**
 * Remove an exclusion. Persists to storage.
 * @param {string} type
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function removeExclusion(type, value) {
    const list = await loadExclusions();
    const idx = list.findIndex((e) => e.type === type && e.value === value);
    if (idx !== -1) {
        list.splice(idx, 1);
        cache = list;
        // Fire-and-forget: persist in background so the UI updates instantly
        storage.setJSON(getStorageKey(), list, 'settings');
    }
}
