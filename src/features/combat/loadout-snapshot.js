/**
 * Loadout Snapshot
 *
 * Listens for `loadouts_updated` WebSocket messages to capture all loadout configurations
 * (equipment, abilities, consumables, enhancement levels) in real time.
 *
 * Stored snapshots are used by profit calculators to apply the correct tool/equipment
 * bonuses for a skill even when that loadout is not currently equipped.
 *
 * Skill matching: the loadout's actionTypeHrid (e.g. "/action_types/brewing") is compared
 * to the action type of the profit calculation. An "All Skills" loadout (empty actionTypeHrid)
 * is used as a fallback when no skill-specific snapshot is found.
 *
 * Priority: skill default > all skills default > skill non-default > all skills non-default
 */

import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import storage from '../../core/storage.js';

const STORAGE_KEY_PREFIX = 'loadout_snapshots';

/**
 * Get character-scoped storage key.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

/**
 * Parse a wearable hash string into itemLocationHrid, itemHrid, and enhancementLevel.
 * Format: "characterId::/item_locations/location::/items/item_hrid::enhancementLevel"
 * Empty string means no item in that slot.
 * @param {string} itemLocationHrid - The equipment slot key (e.g. "/item_locations/body")
 * @param {string} wearableHash - The wearable hash value
 * @returns {{ itemLocationHrid: string, itemHrid: string, enhancementLevel: number }|null}
 */
function parseWearable(itemLocationHrid, wearableHash) {
    if (!wearableHash) return null;

    const parts = wearableHash.split('::');
    const itemHrid = parts.find((p) => p.startsWith('/items/'));
    if (!itemHrid) return null;

    const lastPart = parts[parts.length - 1];
    const enhancementLevel = !lastPart.startsWith('/') ? parseInt(lastPart, 10) || 0 : 0;

    return { itemLocationHrid, itemHrid, enhancementLevel };
}

/**
 * Convert a server loadout object into our snapshot format.
 * @param {Object} loadout - A loadout entry from characterLoadoutMap
 * @returns {Object} snapshot
 */
function buildSnapshot(loadout) {
    // Parse equipment from wearableMap
    const equipment = [];
    for (const [locationHrid, hash] of Object.entries(loadout.wearableMap || {})) {
        const parsed = parseWearable(locationHrid, hash);
        if (parsed) equipment.push(parsed);
    }

    // Parse drinks
    const drinks = (loadout.drinkItemHrids || []).map((hrid) => ({
        itemHrid: hrid || '',
    }));

    // Parse food
    const food = (loadout.foodItemHrids || []).map((hrid) => ({
        itemHrid: hrid || '',
    }));

    // Parse abilities
    const abilities = [];
    for (const [slot, hrid] of Object.entries(loadout.abilityMap || {})) {
        if (hrid) abilities.push({ abilityHrid: hrid, slot: parseInt(slot, 10) });
    }

    return {
        name: loadout.name,
        actionTypeHrid: loadout.actionTypeHrid || '',
        isDefault: !!loadout.isDefault,
        equipment,
        abilities,
        food,
        drinks,
        abilityCombatTriggersMap: loadout.abilityCombatTriggersMap || {},
        consumableCombatTriggersMap: loadout.consumableCombatTriggersMap || {},
        savedAt: Date.now(),
    };
}

class LoadoutSnapshot {
    constructor() {
        this.snapshots = {}; // In-memory cache: { [loadoutName]: snapshot }
        this.loadoutsUpdatedHandler = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Load existing snapshots into memory
        this.snapshots = (await storage.getJSON(getStorageKey(), 'settings', null)) || {};
        console.log(`[LoadoutSnapshot] initialize() — loaded ${Object.keys(this.snapshots).length} existing snapshots`);

        // Listen for loadouts_updated WebSocket messages
        this.loadoutsUpdatedHandler = (data) => this._onLoadoutsUpdated(data);
        webSocketHook.on('loadouts_updated', this.loadoutsUpdatedHandler);
    }

    /**
     * Handle a loadouts_updated WebSocket message.
     * Replaces all snapshots with the server's current state.
     * @param {Object} data - The WebSocket message payload
     */
    _onLoadoutsUpdated(data) {
        console.log('[LoadoutSnapshot] loadouts_updated WebSocket message received');
        const loadoutMap = data.characterLoadoutMap;
        if (!loadoutMap) {
            console.log('[LoadoutSnapshot] no characterLoadoutMap in message');
            return;
        }

        const newSnapshots = {};
        for (const [id, loadout] of Object.entries(loadoutMap)) {
            if (!loadout.name) continue;
            newSnapshots[id] = buildSnapshot(loadout);
            console.log(
                `[LoadoutSnapshot]   → ${loadout.name} (id=${id}): type=${loadout.actionTypeHrid || 'All Skills'}, default=${loadout.isDefault}`
            );
        }

        this.snapshots = newSnapshots;
        storage.setJSON(getStorageKey(), this.snapshots, 'settings');
        console.log(
            `[LoadoutSnapshot] Synced ${Object.keys(newSnapshots).length} snapshots:`,
            Object.values(newSnapshots).map((s) => s.name)
        );
    }

    /**
     * Find the best snapshot for a given action type.
     * Priority: skill default > all skills default > skill non-default > all skills non-default
     * @param {string} actionTypeHrid - e.g. "/action_types/brewing"
     * @returns {Object|null} snapshot entry or null
     */
    _findSnapshot(actionTypeHrid) {
        if (!config.getSetting('loadoutSnapshot')) return null;

        let skillDefault = null;
        let allSkillsDefault = null;
        let skillNonDefault = null;
        let allSkillsNonDefault = null;

        for (const snapshot of Object.values(this.snapshots)) {
            if (snapshot.actionTypeHrid === actionTypeHrid) {
                if (snapshot.isDefault) {
                    skillDefault = snapshot;
                } else {
                    skillNonDefault = snapshot;
                }
            } else if (snapshot.actionTypeHrid === '') {
                if (snapshot.isDefault) {
                    allSkillsDefault = snapshot;
                } else {
                    allSkillsNonDefault = snapshot;
                }
            }
        }

        return skillDefault || allSkillsDefault || skillNonDefault || allSkillsNonDefault || null;
    }

    /**
     * Get a Map<itemLocationHrid, item> for the best loadout snapshot matching the given
     * action type. Returns null if no snapshot exists or the feature is disabled.
     * The returned Map has the same format as dataManager.getEquipment().
     * @param {string} actionTypeHrid
     * @returns {Map<string, Object>|null}
     */
    getSnapshotForSkill(actionTypeHrid) {
        const snapshot = this._findSnapshot(actionTypeHrid);
        if (!snapshot || !snapshot.equipment?.length) return null;
        return new Map(snapshot.equipment.map((e) => [e.itemLocationHrid, e]));
    }

    /**
     * Get the drink slots array for the best loadout snapshot matching the given
     * action type. Returns null if no snapshot exists or the feature is disabled.
     * The returned array has the same format as dataManager.getActionDrinkSlots().
     * @param {string} actionTypeHrid
     * @returns {Array<{itemHrid: string}>|null}
     */
    getSnapshotDrinksForSkill(actionTypeHrid) {
        const snapshot = this._findSnapshot(actionTypeHrid);
        if (!snapshot) return null;
        // Filter out empty slots so callers get only actual items
        const filled = (snapshot.drinks || []).filter((d) => d.itemHrid);
        return filled.length > 0 ? filled : null;
    }

    /**
     * Get all saved loadout snapshots as a flat array.
     * @returns {Array<Object>} Array of snapshot objects
     */
    getAllSnapshots() {
        return Object.values(this.snapshots);
    }

    /**
     * Get the name and default status of the saved loadout being used for a given action type.
     * Returns an object with name and isDefault, or null if no snapshot exists or feature is disabled.
     * @param {string} actionTypeHrid
     * @returns {{ name: string, isDefault: boolean }|null}
     */
    getSnapshotInfoForSkill(actionTypeHrid) {
        const snapshot = this._findSnapshot(actionTypeHrid);
        if (!snapshot) return null;
        return { name: snapshot.name, isDefault: !!snapshot.isDefault };
    }

    disable() {
        if (this.loadoutsUpdatedHandler) {
            webSocketHook.off('loadouts_updated', this.loadoutsUpdatedHandler);
            this.loadoutsUpdatedHandler = null;
        }

        this.isInitialized = false;
    }
}

const loadoutSnapshot = new LoadoutSnapshot();

export default loadoutSnapshot;
