/**
 * Scroll Simulator
 * Manages per-loadout and global default scroll selections for profit/XP simulation.
 *
 * Storage: scroll_simulation_${charId} in 'settings' store.
 * Structure: { '__default__': [buffTypeHrid, ...], 'Loadout Name': [...], ... }
 *
 * Priority when resolving scrolls for an action type:
 *   1. Loadout-specific selection (if a snapshot is active for the skill)
 *   2. Global default ('__default__')
 *   3. Empty set (if toggle is off or nothing configured)
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import storage from '../../core/storage.js';
import loadoutSnapshot from './loadout-snapshot.js';

const STORAGE_KEY_PREFIX = 'scroll_simulation';
export const DEFAULT_KEY = '__default__';

function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

class ScrollSimulator {
    constructor() {
        /** @type {Object.<string, Set<string>>} loadoutName → Set of buffTypeHrids */
        this.scrollsByLoadout = {};
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        const saved = await storage.getJSON(getStorageKey(), 'settings', {});
        for (const [name, arr] of Object.entries(saved)) {
            if (Array.isArray(arr)) {
                this.scrollsByLoadout[name] = new Set(arr);
            }
        }
        this.initialized = true;
    }

    /**
     * Returns the Set of buffTypeHrids to simulate for the given action type.
     * Respects the master toggle and loadout priority.
     * @param {string} actionTypeHrid
     * @returns {Set<string>}
     */
    getScrollSetForActionType(actionTypeHrid) {
        if (!config.getSetting('simulateScrollEffects')) return new Set();
        const loadoutName = loadoutSnapshot.getSnapshotInfoForSkill(actionTypeHrid)?.name;
        if (loadoutName && this.scrollsByLoadout[loadoutName]) {
            return this.scrollsByLoadout[loadoutName];
        }
        return this.scrollsByLoadout[DEFAULT_KEY] ?? new Set();
    }

    /**
     * Returns the Set of buffTypeHrids configured for a specific loadout (or the default).
     * @param {string|null} loadoutName - null for global defaults
     * @returns {Set<string>}
     */
    getScrollsForLoadout(loadoutName) {
        return this.scrollsByLoadout[loadoutName ?? DEFAULT_KEY] ?? new Set();
    }

    /**
     * Save scroll selections for a loadout (or global defaults).
     * @param {string|null} loadoutName - null for global defaults
     * @param {string[]} buffTypeHrids
     */
    async saveScrollsForLoadout(loadoutName, buffTypeHrids) {
        const key = loadoutName ?? DEFAULT_KEY;
        this.scrollsByLoadout[key] = new Set(buffTypeHrids);
        await this._persist();
    }

    async _persist() {
        const toSave = {};
        for (const [name, set] of Object.entries(this.scrollsByLoadout)) {
            toSave[name] = [...set];
        }
        await storage.setJSON(getStorageKey(), toSave, 'settings');
    }
}

const scrollSimulator = new ScrollSimulator();
export default scrollSimulator;
