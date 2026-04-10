/**
 * Custom Inventory Tabs — Data Module
 * Manages tab configuration storage and CRUD operations.
 * All mutating helpers return new objects (never mutate in place).
 */

import storage from '../../../core/storage.js';

const STORAGE_KEY = 'inventoryTabs_config';
const STORE = 'settings';
const CONFIG_VERSION = 1;

export const LINEBREAK_HRID = '__linebreak__';

/**
 * Generate a unique ID
 * @returns {string}
 */
export function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Build the character-scoped storage key
 * @param {string} characterId
 * @returns {string}
 */
function getStorageKey(characterId) {
    return `${characterId}_${STORAGE_KEY}`;
}

/**
 * Return a blank config
 * @returns {Object}
 */
function defaultConfig() {
    return { version: CONFIG_VERSION, tabs: [], selectedTabId: null };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load the tab config for a character
 * @param {string} characterId
 * @returns {Promise<Object>} { version, tabs, selectedTabId }
 */
export async function loadConfig(characterId) {
    if (!characterId) return defaultConfig();
    const saved = await storage.getJSON(getStorageKey(characterId), STORE, null);
    if (!saved || !Array.isArray(saved.tabs)) return defaultConfig();
    return { ...defaultConfig(), ...saved };
}

/**
 * Persist the tab config for a character
 * @param {string} characterId
 * @param {Object} config
 */
export async function saveConfig(characterId, config) {
    if (!characterId) return;
    await storage.setJSON(getStorageKey(characterId), config, STORE);
}

// ---------------------------------------------------------------------------
// Deep-clone helper (structuredClone with fallback)
// ---------------------------------------------------------------------------

function clone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// CRUD helpers — all return a new config object
// ---------------------------------------------------------------------------

/**
 * Add a tab (at root level or inside a parent)
 * @param {Object} config
 * @param {string|null} parentId - null for root level
 * @param {string} name
 * @returns {Object} { config, tabId }
 */
export function addTab(config, parentId, name) {
    const c = clone(config);
    const tab = {
        id: makeId(),
        name,
        color: null,
        open: false,
        items: [],
        children: [],
    };
    if (!parentId) {
        c.tabs.push(tab);
    } else {
        const result = _findNode(c.tabs, parentId);
        if (result) {
            result.tab.children.push(tab);
            result.tab.open = true;
        } else {
            c.tabs.push(tab);
        }
    }
    return { config: c, tabId: tab.id };
}

/**
 * Remove a tab (and all its descendants)
 * @param {Object} config
 * @param {string} tabId
 * @returns {Object} new config
 */
export function removeTab(config, tabId) {
    const c = clone(config);
    _removeFromArray(c.tabs, tabId);
    if (c.selectedTabId === tabId) c.selectedTabId = null;
    return c;
}

/**
 * Rename a tab
 * @param {Object} config
 * @param {string} tabId
 * @param {string} name
 * @returns {Object} new config
 */
export function renameTab(config, tabId, name) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result) result.tab.name = name;
    return c;
}

/**
 * Set a tab's accent color
 * @param {Object} config
 * @param {string} tabId
 * @param {string|null} color
 * @returns {Object} new config
 */
export function setTabColor(config, tabId, color) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result) result.tab.color = color;
    return c;
}

/**
 * Move a tab to a new position within its parent's children (or root)
 * @param {Object} config
 * @param {string} tabId
 * @param {number} newIndex - target index in the parent's children array
 * @returns {Object} new config
 */
export function moveTab(config, tabId, newIndex) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (!result) return c;

    const arr = result.parent ? result.parent.children : c.tabs;
    const oldIndex = arr.findIndex((t) => t.id === tabId);
    if (oldIndex === -1) return c;

    const [removed] = arr.splice(oldIndex, 1);
    const clampedIndex = Math.max(0, Math.min(newIndex, arr.length));
    arr.splice(clampedIndex, 0, removed);
    return c;
}

/**
 * Add an item to a tab (no-op if already present)
 * @param {Object} config
 * @param {string} tabId
 * @param {string} itemHrid
 * @returns {Object} new config
 */
export function addItem(config, tabId, itemHrid) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result && !result.tab.items.includes(itemHrid)) {
        result.tab.items.push(itemHrid);
    }
    return c;
}

/**
 * Append a line break sentinel to a tab's items array.
 * Multiple line breaks are allowed, so no duplicate check is performed.
 * @param {Object} config
 * @param {string} tabId
 * @returns {Object} new config
 */
export function addLineBreak(config, tabId) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result) result.tab.items.push(LINEBREAK_HRID);
    return c;
}

/**
 * Reorder an item within a tab's items array
 * @param {Object} config
 * @param {string} tabId
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {Object} new config
 */
export function reorderItem(config, tabId, fromIndex, toIndex) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (!result) return c;
    const items = result.tab.items;
    if (fromIndex < 0 || fromIndex >= items.length) return c;
    const clamped = Math.max(0, Math.min(toIndex, items.length - 1));
    const [removed] = items.splice(fromIndex, 1);
    items.splice(clamped, 0, removed);
    return c;
}

/**
 * Remove an item from a tab
 * @param {Object} config
 * @param {string} tabId
 * @param {string} itemHrid
 * @returns {Object} new config
 */
export function removeItem(config, tabId, itemHrid) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result) {
        result.tab.items = result.tab.items.filter((h) => h !== itemHrid);
    }
    return c;
}

/**
 * Remove a single item at a specific index from a tab.
 * Preferred over removeItem when duplicates may exist (e.g. line breaks).
 * @param {Object} config
 * @param {string} tabId
 * @param {number} index
 * @returns {Object} new config
 */
export function removeItemAtIndex(config, tabId, index) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result && index >= 0 && index < result.tab.items.length) {
        result.tab.items.splice(index, 1);
    }
    return c;
}

/**
 * Toggle a tree node open/closed
 * @param {Object} config
 * @param {string} tabId
 * @param {boolean} open
 * @returns {Object} new config
 */
export function setTabOpen(config, tabId, open) {
    const c = clone(config);
    const result = _findNode(c.tabs, tabId);
    if (result) result.tab.open = open;
    return c;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Depth-first search for a tab by ID
 * @param {Object} config
 * @param {string} tabId
 * @returns {{ tab: Object, parent: Object|null } | null}
 */
export function findTab(config, tabId) {
    return _findNode(config.tabs, tabId);
}

/**
 * Collect all assigned itemHrids across every tab
 * @param {Object} config
 * @returns {Set<string>}
 */
export function getAssignedItemSet(config) {
    const set = new Set();
    _walkTabs(config.tabs, (tab) => {
        for (const hrid of tab.items) {
            if (hrid !== LINEBREAK_HRID) set.add(hrid);
        }
    });
    return set;
}

/**
 * Collect itemHrids from a tab and all its descendants
 * @param {Object} tab - A single TabNode
 * @returns {Set<string>}
 */
export function collectTabItems(tab) {
    const set = new Set();
    _walkTabs([tab], (t) => {
        for (const hrid of t.items) set.add(hrid);
    });
    return set;
}

// ---------------------------------------------------------------------------
// Internal tree traversal helpers
// ---------------------------------------------------------------------------

/**
 * Find a node by id in a tab tree, returning { tab, parent }
 * @param {Array} tabs
 * @param {string} id
 * @param {Object|null} parent
 * @returns {{ tab: Object, parent: Object|null } | null}
 */
function _findNode(tabs, id, parent = null) {
    for (const tab of tabs) {
        if (tab.id === id) return { tab, parent };
        if (tab.children.length > 0) {
            const found = _findNode(tab.children, id, tab);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Remove a node by id from a tab tree (mutates the array)
 * @param {Array} tabs
 * @param {string} id
 * @returns {boolean} true if removed
 */
function _removeFromArray(tabs, id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx !== -1) {
        tabs.splice(idx, 1);
        return true;
    }
    for (const tab of tabs) {
        if (_removeFromArray(tab.children, id)) return true;
    }
    return false;
}

/**
 * Walk all tabs depth-first, calling fn(tab) on each
 * @param {Array} tabs
 * @param {Function} fn
 */
function _walkTabs(tabs, fn) {
    for (const tab of tabs) {
        fn(tab);
        if (tab.children.length > 0) _walkTabs(tab.children, fn);
    }
}
