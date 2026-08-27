/**
 * Loadout State
 *
 * Canonical owner of saved MWI loadout state. Raw snapshots mirror the server payload;
 * effective snapshots are resolved on demand against the current character inventory.
 *
 * Important invariants:
 * - This is the only stateful loadout singleton in Toolasha.
 * - Constructors are side-effect free; startCapture() owns lifecycle subscriptions.
 * - Fresh server characterLoadoutMap always outranks IndexedDB cache, including an empty map.
 * - Inventory changes never mutate raw snapshots. Highest-enhancement mode is resolved at read time.
 * - Character switches clear the departing character synchronously and async cache hydration is generation-guarded.
 */

import webSocketHook from './websocket.js';
import dataManager from './data-manager.js';
import storage from './storage.js';

const STORAGE_KEY_PREFIX = 'loadout_snapshots';
const LOADOUT_STATE_IMPLEMENTATION_ID = 'toolasha-core-loadout-state-v1';

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeCharacterId(value) {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
}

function normalizeSavedEnhancementLevel(value) {
    if (value === null || value === undefined || value === '') return null;
    const level = Number(value);
    // Enhancement levels are discrete, non-negative indices. A malformed cache/hash must fail
    // closed rather than becoming a plausible exact level through Number/parseInt coercion.
    return Number.isInteger(level) && level >= 0 ? level : null;
}

function getStorageKey(characterId) {
    return `${STORAGE_KEY_PREFIX}_${characterId}`;
}

function cloneJsonSafeValue(value) {
    if (Array.isArray(value)) return value.map((entry) => cloneJsonSafeValue(entry));
    if (value && typeof value === 'object') {
        const clone = {};
        for (const [key, entry] of Object.entries(value)) {
            clone[key] = cloneJsonSafeValue(entry);
        }
        return clone;
    }
    return value;
}

function cloneTriggerMap(triggerMap) {
    const clone = {};
    if (!triggerMap || typeof triggerMap !== 'object' || Array.isArray(triggerMap)) return clone;

    for (const [key, triggers] of Object.entries(triggerMap)) {
        // Native loadout trigger maps contain arrays. Reject malformed cache/server values
        // instead of retaining a mutable object reference or exposing a non-canonical shape.
        if (!Array.isArray(triggers)) continue;
        clone[key] = triggers.map((trigger) => cloneJsonSafeValue(trigger));
    }
    return clone;
}

/**
 * Parse a wearable hash string into a raw saved equipment entry.
 * Format: "characterId::/item_locations/location::/items/item_hrid::enhancementLevel".
 * @param {string} itemLocationHrid
 * @param {string} wearableHash
 * @returns {{itemLocationHrid: string, itemHrid: string, enhancementLevel: number|null, savedItemHash: string}|null}
 */
export function parseLoadoutWearable(itemLocationHrid, wearableHash) {
    if (!wearableHash || typeof wearableHash !== 'string') return null;

    const parts = wearableHash.split('::');
    const itemHrid = parts.find((part) => part.startsWith('/items/'));
    if (!itemHrid) return null;

    const lastPart = parts[parts.length - 1] || '';
    const enhancementLevel = lastPart.startsWith('/') ? null : normalizeSavedEnhancementLevel(lastPart);

    return { itemLocationHrid, itemHrid, enhancementLevel, savedItemHash: wearableHash };
}

/**
 * Convert one server loadout entry into Toolasha's raw snapshot shape.
 * The saved enhancement number is intentionally preserved even when useExactEnhancement=false;
 * it is historical server state, not the effective level to use in calculations.
 * @param {string} snapshotId
 * @param {Object} loadout
 * @returns {Object}
 */
export function buildRawLoadoutSnapshot(snapshotId, loadout) {
    const equipment = [];
    for (const [locationHrid, hash] of Object.entries(loadout?.wearableMap || {})) {
        const parsed = parseLoadoutWearable(locationHrid, hash);
        if (parsed) equipment.push(parsed);
    }

    const drinks = (loadout?.drinkItemHrids || []).map((itemHrid) => ({ itemHrid: itemHrid || '' }));
    const food = (loadout?.foodItemHrids || []).map((itemHrid) => ({ itemHrid: itemHrid || '' }));

    const abilities = [];
    for (const [slot, abilityHrid] of Object.entries(loadout?.abilityMap || {})) {
        if (!abilityHrid) continue;
        abilities.push({ abilityHrid, slot: Number.parseInt(slot, 10) || 0 });
    }
    abilities.sort((a, b) => a.slot - b.slot);

    return {
        snapshotId: String(snapshotId),
        name: loadout?.name || '',
        actionTypeHrid: loadout?.actionTypeHrid || '',
        isDefault: !!loadout?.isDefault,
        suppressValidation: !!loadout?.suppressValidation,
        useExactEnhancement: loadout?.useExactEnhancement === true,
        ordinal: loadout?.ordinal || 0,
        equipment,
        abilities,
        food,
        drinks,
        abilityCombatTriggersMap: cloneTriggerMap(loadout?.abilityCombatTriggersMap),
        consumableCombatTriggersMap: cloneTriggerMap(loadout?.consumableCombatTriggersMap),
        capturedAt: Date.now(),
    };
}

/**
 * Build current owned-enhancement information from characterItems.
 * Equipped entries without a count are owned; only an explicit count === 0 is absent.
 * A real +0 item is retained as a map entry, so +0 ownership is distinguishable from missing.
 * @param {Array<Object>|null|undefined} characterItems
 * @returns {Map<string, {highestEnhancementLevel: number, levels: Set<number>} >}
 */
export function buildOwnedEnhancementIndex(characterItems) {
    const index = new Map();

    for (const item of characterItems || []) {
        if (!item?.itemHrid || item.count === 0) continue;

        const level = Number.isFinite(Number(item.enhancementLevel)) ? Number(item.enhancementLevel) : 0;
        let entry = index.get(item.itemHrid);
        if (!entry) {
            entry = { highestEnhancementLevel: level, levels: new Set() };
            index.set(item.itemHrid, entry);
        } else if (level > entry.highestEnhancementLevel) {
            entry.highestEnhancementLevel = level;
        }
        entry.levels.add(level);
    }

    return index;
}

/**
 * Resolve saved food/drink slots against the same inventory-only presence semantics used by
 * MWI loadout validation. Empty slots are intentional and never treated as missing.
 * Validation checks the +0 inventory hash for consumables; equipped/non-inventory entries do
 * not satisfy a saved consumable slot. Only explicit count === 0 is absent.
 * @param {Array<Object>|null|undefined} entries
 * @param {Array<Object>|null|undefined} characterItems
 * @returns {Array<{slotIndex:number,itemHrid:string,isAvailable:boolean}>}
 */
export function resolveLoadoutConsumables(entries, characterItems) {
    const inventoryPresence = new Set();
    for (const item of characterItems || []) {
        if (!item?.itemHrid || item.itemLocationHrid !== '/item_locations/inventory' || item.count === 0) {
            continue;
        }
        const level = Number.isFinite(Number(item.enhancementLevel)) ? Number(item.enhancementLevel) : 0;
        if (level === 0) inventoryPresence.add(item.itemHrid);
    }

    return (entries || []).map((entry, slotIndex) => {
        const itemHrid = entry?.itemHrid || '';
        return {
            slotIndex,
            itemHrid,
            isAvailable: !itemHrid || inventoryPresence.has(itemHrid),
        };
    });
}

/**
 * Resolve raw saved equipment against current ownership.
 * Missing-item execution semantics are deliberately not guessed; the intended item remains
 * present with isAvailable=false so callers can surface/handle that state explicitly.
 * @param {Object} rawSnapshot
 * @param {Array<Object>|null|undefined} characterItems
 * @returns {Array<Object>}
 */
export function resolveLoadoutEquipment(rawSnapshot, characterItems) {
    const useExactEnhancement = rawSnapshot?.useExactEnhancement === true;

    return (rawSnapshot?.equipment || []).map((rawEquipment) => {
        // Native MWI loadout validation only considers the saved target equipment location
        // plus Inventory for this slot. The same item equipped in some *other* location is not
        // a valid source for this saved slot, so do not use the global itemHrid ownership map
        // here. This matters for equipment types that can appear in more than one location.
        const eligibleItems = (characterItems || []).filter((item) => {
            if (item?.itemHrid !== rawEquipment.itemHrid || item.count === 0) return false;

            // Native validation first accepts the exact raw wearable hash that was saved,
            // even if that item was equipped in a different source slot when the loadout was
            // authored. Replacement variants are then searched only in the loadout's target
            // location and Inventory. Preserve the raw hash internally so we can match that
            // behavior instead of broadening eligibility to arbitrary equipped locations.
            if (rawEquipment.savedItemHash && item.hash === rawEquipment.savedItemHash) return true;
            return (
                item.itemLocationHrid === rawEquipment.itemLocationHrid ||
                item.itemLocationHrid === '/item_locations/inventory'
            );
        });
        const eligibleOwnership = buildOwnedEnhancementIndex(eligibleItems);
        const owned = eligibleOwnership.get(rawEquipment.itemHrid);
        const savedEnhancementLevel = normalizeSavedEnhancementLevel(rawEquipment.enhancementLevel);
        const hasValidSavedEnhancementLevel = savedEnhancementLevel !== null;

        if (useExactEnhancement) {
            const isAvailable = hasValidSavedEnhancementLevel && !!owned?.levels.has(savedEnhancementLevel);
            return {
                itemLocationHrid: rawEquipment.itemLocationHrid,
                itemHrid: rawEquipment.itemHrid,
                enhancementLevel: isAvailable ? savedEnhancementLevel : null,
                isAvailable,
            };
        }

        if (owned) {
            return {
                itemLocationHrid: rawEquipment.itemLocationHrid,
                itemHrid: rawEquipment.itemHrid,
                enhancementLevel: owned.highestEnhancementLevel,
                isAvailable: true,
            };
        }

        // Fail closed. The historical saved level is raw server metadata, not an
        // effective level. Do not expose it as a numeric fallback when the item is
        // unavailable, because downstream `|| 0` / `?? 0` code could silently turn
        // an unresolved loadout into a plausible-but-false calculation.
        return {
            itemLocationHrid: rawEquipment.itemLocationHrid,
            itemHrid: rawEquipment.itemHrid,
            enhancementLevel: null,
            isAvailable: false,
        };
    });
}

function normalizeCachedSnapshots(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    // Future-proof wrapped cache format while remaining backward compatible with the
    // existing plain { [loadoutId]: snapshot } cache already installed for users.
    // Cache is untrusted/stale input: rebuild the canonical raw schema explicitly rather
    // than spreading arbitrary legacy/effective fields back into Core truth state.
    const candidate = value.snapshots && typeof value.snapshots === 'object' ? value.snapshots : value;
    const normalized = {};

    for (const [snapshotId, snapshot] of Object.entries(candidate)) {
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.name) continue;

        const equipment = [];
        for (const entry of Array.isArray(snapshot.equipment) ? snapshot.equipment : []) {
            if (!entry?.itemHrid || !entry?.itemLocationHrid) continue;
            equipment.push({
                itemLocationHrid: entry.itemLocationHrid,
                itemHrid: entry.itemHrid,
                enhancementLevel: normalizeSavedEnhancementLevel(entry.enhancementLevel),
                savedItemHash: typeof entry.savedItemHash === 'string' ? entry.savedItemHash : '',
            });
        }

        const abilities = [];
        for (const entry of Array.isArray(snapshot.abilities) ? snapshot.abilities : []) {
            if (!entry?.abilityHrid) continue;
            const parsedSlot = Number.parseInt(entry.slot, 10);
            abilities.push({
                abilityHrid: entry.abilityHrid,
                slot: Number.isFinite(parsedSlot) ? parsedSlot : 0,
            });
        }
        abilities.sort((a, b) => a.slot - b.slot);

        const normalizeConsumables = (entries) =>
            (Array.isArray(entries) ? entries : []).map((entry) => ({
                itemHrid: typeof entry === 'string' ? entry : entry?.itemHrid || '',
            }));

        normalized[String(snapshotId)] = {
            snapshotId: String(snapshotId),
            name: snapshot.name,
            actionTypeHrid: snapshot.actionTypeHrid || '',
            isDefault: !!snapshot.isDefault,
            suppressValidation: !!snapshot.suppressValidation,
            useExactEnhancement: snapshot.useExactEnhancement === true,
            ordinal: snapshot.ordinal || 0,
            equipment,
            abilities,
            food: normalizeConsumables(snapshot.food),
            drinks: normalizeConsumables(snapshot.drinks),
            abilityCombatTriggersMap: cloneTriggerMap(snapshot.abilityCombatTriggersMap),
            consumableCombatTriggersMap: cloneTriggerMap(snapshot.consumableCombatTriggersMap),
            capturedAt: Number(snapshot.capturedAt ?? snapshot.savedAt) || Date.now(),
        };
    }

    return normalized;
}

class LoadoutState {
    constructor() {
        this.implementationId = LOADOUT_STATE_IMPLEMENTATION_ID;
        this.rawSnapshots = {};
        this.activeCharacterId = null;
        this.activeSocket = null;
        this.authority = 'none'; // none | cache | server
        this.generation = 0;
        this.captureStarted = false;
        this.persistenceReady = false;
        this.updateListeners = new Set();
        this.inventoryResolutionSignatures = new Map();
        // Effective snapshots are expensive to resolve: each equipment slot validates against
        // current ownership and consumables validate against inventory presence. Action-card
        // calculations can read the same saved loadout hundreds of times while mounting a
        // skill page, so resolving on every read turns a correct state model into a hot-path
        // performance regression. Keep one canonical effective snapshot per raw snapshot and
        // refresh it only when raw loadout state or relevant inventory semantics change.
        this.resolvedSnapshotCache = new Map();
        this.actionTypeSelectionIdCache = new Map();

        this.initCharacterDataHandler = (data, context) => this._onInitCharacterData(data, context);
        this.loadoutsUpdatedHandler = (data, context) => this._onLoadoutsUpdated(data, context);
        this.characterSwitchingHandler = (data) => this._onCharacterSwitching(data);
        this.itemsUpdatedHandler = (data) => this._onItemsUpdated(data);
    }

    /**
     * Start always-on capture. Must run once immediately after the WebSocket hook is installed.
     */
    startCapture() {
        if (this.captureStarted) return;
        this.captureStarted = true;

        webSocketHook.on('init_character_data', this.initCharacterDataHandler);
        webSocketHook.on('loadouts_updated', this.loadoutsUpdatedHandler);
        dataManager.on('character_switching', this.characterSwitchingHandler);
        dataManager.on('items_updated', this.itemsUpdatedHandler);

        // Defensive bootstrap for dev/hot-reload cases where character data predates capture.
        if (dataManager.characterData?.character?.id) {
            this._onInitCharacterData(dataManager.characterData);
        }
    }

    /**
     * Stop capture. Exposed for tests/debug teardown; normal Toolasha runtime keeps this service alive.
     */
    stopCapture() {
        if (!this.captureStarted) return;
        webSocketHook.off('init_character_data', this.initCharacterDataHandler);
        webSocketHook.off('loadouts_updated', this.loadoutsUpdatedHandler);
        dataManager.off('character_switching', this.characterSwitchingHandler);
        dataManager.off('items_updated', this.itemsUpdatedHandler);
        this.captureStarted = false;
    }

    /**
     * Enable best-effort IndexedDB hydration/persistence after storage is initialized.
     * Server state already captured before this call must never be overwritten by cache.
     */
    async hydratePersistence() {
        this.persistenceReady = true;
        const characterId = this.activeCharacterId;
        if (!characterId) return;

        const generation = this.generation;
        if (this.authority === 'server') {
            await this._persistCurrent(characterId, generation);
            return;
        }

        await this._hydrateForCharacter(characterId, generation);
    }

    onUpdate(listener) {
        if (typeof listener === 'function') this.updateListeners.add(listener);
    }

    offUpdate(listener) {
        this.updateListeners.delete(listener);
    }

    /**
     * Expose Core-owned current-ownership semantics without forcing feature bundles to
     * import named helpers from this externalized module. Keeping the helper behind the
     * canonical service also prevents Rollup's IIFE global mapping from treating the
     * singleton object as a module namespace.
     * @param {Array<Object>|null|undefined} characterItems
     * @returns {Map<string, {highestEnhancementLevel: number, levels: Set<number>} >}
     */
    getOwnedEnhancementIndex(characterItems = dataManager.getInventory?.()) {
        return buildOwnedEnhancementIndex(characterItems);
    }

    /**
     * Fingerprint the inventory-dependent portion of one raw loadout. The signature excludes
     * counts that remain positive and includes only effective equipment levels/availability and
     * consumable availability. Raw/server changes still emit unconditionally.
     * @param {Object} rawSnapshot
     * @param {Array<Object>|null|undefined} inventory
     * @returns {string}
     * @private
     */
    _buildInventoryResolutionSignature(rawSnapshot, inventory = dataManager.getInventory?.()) {
        return this._buildResolutionSignature(this._resolveRawSnapshot(rawSnapshot, inventory));
    }

    _buildResolutionSignature(resolvedSnapshot) {
        if (!resolvedSnapshot) return '';
        const equipment = (resolvedSnapshot.equipment || [])
            .map((entry) => `${entry.itemLocationHrid}:${entry.itemHrid}:${entry.enhancementLevel}`)
            .join(',');
        const unavailableEquipment = (resolvedSnapshot.unavailableEquipment || [])
            .map((entry) => `${entry.itemLocationHrid}:${entry.itemHrid}:missing`)
            .join(',');
        const food = (resolvedSnapshot.food || []).map((entry) => entry.itemHrid || '').join(',');
        const drinks = (resolvedSnapshot.drinks || []).map((entry) => entry.itemHrid || '').join(',');
        const unavailableFood = (resolvedSnapshot.unavailableFood || [])
            .map((entry) => `${entry.slotIndex}:${entry.itemHrid}`)
            .join(',');
        const unavailableDrinks = (resolvedSnapshot.unavailableDrinks || [])
            .map((entry) => `${entry.slotIndex}:${entry.itemHrid}`)
            .join(',');
        return `${equipment}|${unavailableEquipment}|${food}|${drinks}|${unavailableFood}|${unavailableDrinks}`;
    }

    _refreshResolvedState() {
        const inventory = dataManager.getInventory?.();
        const nextSignatures = new Map();
        const nextResolved = new Map();
        for (const [snapshotId, rawSnapshot] of Object.entries(this.rawSnapshots)) {
            const resolved = this._resolveRawSnapshot(rawSnapshot, inventory);
            nextResolved.set(snapshotId, resolved);
            nextSignatures.set(snapshotId, this._buildResolutionSignature(resolved));
        }
        this.resolvedSnapshotCache = nextResolved;
        this.inventoryResolutionSignatures = nextSignatures;
        this.actionTypeSelectionIdCache.clear();
    }

    _emitUpdate() {
        for (const listener of [...this.updateListeners]) {
            try {
                listener();
            } catch (error) {
                console.error('[LoadoutState] Update listener failed:', error);
            }
        }
    }

    _onCharacterSwitching(_data) {
        this.generation += 1;
        this.activeCharacterId = null;
        this.activeSocket = null;
        this.authority = 'none';
        this.rawSnapshots = {};
        this.inventoryResolutionSignatures = new Map();
        this.resolvedSnapshotCache = new Map();
        this.actionTypeSelectionIdCache = new Map();

        // Do not broadcast a normal loadout update while the departing character's
        // feature listeners are still being synchronously torn down. Some consumers
        // persist derived bindings and could otherwise mistake the transient empty
        // state for "all loadouts were deleted". The incoming character's server/cache
        // state will emit after cleanup has begun/completed.
    }

    _onInitCharacterData(data, context = null) {
        const characterId = normalizeCharacterId(data?.character?.id);
        if (!characterId) {
            console.warn('[LoadoutState] Ignoring init_character_data without a character id');
            return;
        }

        // DataManager is registered on the WebSocket hook before LoadoutState and is the
        // authority for whether an init_character_data transition was accepted. In
        // particular, DataManager deliberately rejects rapid (<1s) cross-character
        // transitions as loop protection. Never ingest a payload that DataManager rejected,
        // otherwise loadouts from character C could be combined with inventory from B.
        const acceptedCharacterId = normalizeCharacterId(dataManager.getCurrentCharacterId?.());
        if (!acceptedCharacterId || acceptedCharacterId !== characterId) {
            console.warn('[LoadoutState] Ignoring init_character_data not accepted by DataManager');
            return;
        }

        const previousCharacterId = this.activeCharacterId;
        const characterChanged = previousCharacterId !== characterId;
        this.generation += 1;
        const generation = this.generation;
        this.activeCharacterId = characterId;

        // WebSocket messages are FIFO only within one socket. During a reconnect/character
        // switch, an old socket can still deliver a delayed loadouts_updated payload after the
        // new character is already active, and that payload does not reliably carry a character
        // id. Bind accepted server state to the socket that delivered init_character_data so
        // later cross-socket updates can be rejected without guessing from payload shape.
        if (context?.socket) this.activeSocket = context.socket;
        else if (characterChanged) this.activeSocket = null;

        if (hasOwn(data, 'characterLoadoutMap')) {
            this._replaceFromServer(data.characterLoadoutMap, characterId);
            this._persistCurrentBestEffort(characterId, generation);
            return;
        }

        // Never carry another character's snapshots through a payload that lacks loadout state.
        // Same-character resyncs may omit the map; in that case retain the already-known state.
        if (characterChanged) {
            this.rawSnapshots = {};
            this.authority = 'none';
            this._refreshResolvedState();
            this._emitUpdate();
        }

        if (this.persistenceReady && this.authority !== 'server') {
            void this._hydrateForCharacter(characterId, generation);
        }
    }

    _onItemsUpdated(data) {
        const changedHrids = new Set((data?.endCharacterItems || []).map((item) => item?.itemHrid).filter(Boolean));
        if (changedHrids.size === 0) return;

        // Effective highest-owned state changes with inventory/equipment, while raw saved
        // snapshots intentionally do not. Only notify consumers when a changed item is
        // actually referenced by a saved loadout, avoiding noise from normal gathering.
        const inventory = dataManager.getInventory?.();
        let effectiveStateChanged = false;

        for (const [snapshotId, snapshot] of Object.entries(this.rawSnapshots)) {
            const referencesChangedItem =
                (snapshot.equipment || []).some((item) => changedHrids.has(item.itemHrid)) ||
                (snapshot.food || []).some((item) => changedHrids.has(item.itemHrid)) ||
                (snapshot.drinks || []).some((item) => changedHrids.has(item.itemHrid));
            if (!referencesChangedItem) continue;

            const nextResolved = this._resolveRawSnapshot(snapshot, inventory);
            const nextSignature = this._buildResolutionSignature(nextResolved);
            const previousSignature = this.inventoryResolutionSignatures.get(snapshotId);
            if (nextSignature !== previousSignature) {
                this.inventoryResolutionSignatures.set(snapshotId, nextSignature);
                this.resolvedSnapshotCache.set(snapshotId, nextResolved);
                effectiveStateChanged = true;
            }
        }

        if (effectiveStateChanged) this._emitUpdate();
    }

    _onLoadoutsUpdated(data, context = null) {
        if (!hasOwn(data, 'characterLoadoutMap')) {
            console.warn('[LoadoutState] loadouts_updated received without characterLoadoutMap');
            return;
        }

        const currentCharacterId = normalizeCharacterId(dataManager.getCurrentCharacterId?.());
        if (!this.activeCharacterId || !currentCharacterId || this.activeCharacterId !== currentCharacterId) {
            console.warn('[LoadoutState] Ignoring loadouts_updated outside an active matching character context');
            return;
        }

        if (this.activeSocket && context?.socket !== this.activeSocket) {
            console.warn('[LoadoutState] Ignoring loadouts_updated from an unauthenticated or stale WebSocket');
            return;
        }

        const payloadCharacterId = normalizeCharacterId(
            data?.characterID ?? data?.characterId ?? data?.character?.id ?? null
        );
        if (payloadCharacterId && payloadCharacterId !== this.activeCharacterId) {
            console.warn('[LoadoutState] Ignoring loadouts_updated for a different character');
            return;
        }

        this.generation += 1;
        const generation = this.generation;
        this._replaceFromServer(data.characterLoadoutMap, this.activeCharacterId);
        this._persistCurrentBestEffort(this.activeCharacterId, generation);
    }

    _replaceFromServer(loadoutMap, characterId) {
        if (!loadoutMap || typeof loadoutMap !== 'object' || Array.isArray(loadoutMap)) {
            console.warn('[LoadoutState] Invalid characterLoadoutMap; treating it as empty server state');
            loadoutMap = {};
        }

        const snapshots = {};
        for (const [snapshotId, loadout] of Object.entries(loadoutMap)) {
            if (!loadout?.name) continue;
            snapshots[String(snapshotId)] = buildRawLoadoutSnapshot(snapshotId, loadout);
        }

        this.activeCharacterId = normalizeCharacterId(characterId);
        this.rawSnapshots = snapshots;
        this.authority = 'server';
        this._refreshResolvedState();
        this._emitUpdate();
    }

    async _hydrateForCharacter(characterId, generation) {
        if (!this.persistenceReady || !characterId) return;

        let cached;
        try {
            cached = await storage.getJSON(getStorageKey(characterId), 'settings', null);
        } catch (error) {
            console.error('[LoadoutState] Failed to read loadout cache:', error);
            return;
        }

        if (generation !== this.generation || this.activeCharacterId !== characterId || this.authority === 'server') {
            return;
        }

        if (cached === null || cached === undefined) return;

        this.rawSnapshots = normalizeCachedSnapshots(cached);
        this.authority = 'cache';
        this._refreshResolvedState();
        this._emitUpdate();
    }

    _persistCurrentBestEffort(characterId, generation) {
        if (!this.persistenceReady) return;
        void this._persistCurrent(characterId, generation);
    }

    async _persistCurrent(characterId, generation) {
        if (!this.persistenceReady || !characterId) return false;
        if (generation !== this.generation || this.activeCharacterId !== characterId) return false;

        const snapshots = this._cloneRawSnapshots();
        try {
            return await storage.setJSON(getStorageKey(characterId), snapshots, 'settings');
        } catch (error) {
            console.error('[LoadoutState] Failed to persist loadout cache:', error);
            return false;
        }
    }

    _cloneRawSnapshots() {
        const clone = {};
        for (const [snapshotId, snapshot] of Object.entries(this.rawSnapshots)) {
            // Persist only the canonical raw schema. Do not spread arbitrary future fields:
            // effective/resolved metadata must never become cache truth accidentally.
            clone[snapshotId] = {
                snapshotId: String(snapshotId),
                name: snapshot.name || '',
                actionTypeHrid: snapshot.actionTypeHrid || '',
                isDefault: !!snapshot.isDefault,
                suppressValidation: !!snapshot.suppressValidation,
                useExactEnhancement: snapshot.useExactEnhancement === true,
                ordinal: snapshot.ordinal || 0,
                equipment: (snapshot.equipment || []).map((entry) => ({
                    itemLocationHrid: entry.itemLocationHrid,
                    itemHrid: entry.itemHrid,
                    enhancementLevel: normalizeSavedEnhancementLevel(entry.enhancementLevel),
                    savedItemHash: typeof entry.savedItemHash === 'string' ? entry.savedItemHash : '',
                })),
                abilities: (snapshot.abilities || []).map((entry) => ({
                    abilityHrid: entry.abilityHrid,
                    slot: Number.parseInt(entry.slot, 10) || 0,
                })),
                food: (snapshot.food || []).map((entry) => ({ itemHrid: entry?.itemHrid || '' })),
                drinks: (snapshot.drinks || []).map((entry) => ({ itemHrid: entry?.itemHrid || '' })),
                abilityCombatTriggersMap: cloneTriggerMap(snapshot.abilityCombatTriggersMap),
                consumableCombatTriggersMap: cloneTriggerMap(snapshot.consumableCombatTriggersMap),
                capturedAt: Number(snapshot.capturedAt) || Date.now(),
            };
        }
        return clone;
    }

    _resolveRawSnapshot(rawSnapshot, inventory = dataManager.getInventory?.()) {
        if (!rawSnapshot) return null;
        const resolvedEquipment = resolveLoadoutEquipment(rawSnapshot, inventory);
        const resolvedFood = resolveLoadoutConsumables(rawSnapshot.food, inventory);
        const resolvedDrinks = resolveLoadoutConsumables(rawSnapshot.drinks, inventory);
        const unavailableEquipment = resolvedEquipment
            .filter((entry) => entry.isAvailable === false)
            .map((entry) => ({
                itemLocationHrid: entry.itemLocationHrid,
                itemHrid: entry.itemHrid,
            }));
        const unavailableFood = resolvedFood
            .filter((entry) => entry.itemHrid && entry.isAvailable === false)
            .map((entry) => ({ slotIndex: entry.slotIndex, itemHrid: entry.itemHrid }));
        const unavailableDrinks = resolvedDrinks
            .filter((entry) => entry.itemHrid && entry.isAvailable === false)
            .map((entry) => ({ slotIndex: entry.slotIndex, itemHrid: entry.itemHrid }));

        // Do not expose raw enhancement-mode metadata or unresolved numeric levels to
        // feature consumers. Public `equipment` contains only equipment Toolasha can
        // prove is currently available; missing entries are carried separately so UIs
        // can warn without calculations accidentally consuming historical levels.
        const {
            equipment: _rawEquipment,
            useExactEnhancement: _rawUseExactEnhancement,
            suppressValidation: _rawSuppressValidation,
            ...publicMetadata
        } = rawSnapshot;

        return {
            ...publicMetadata,
            equipment: resolvedEquipment.filter((entry) => entry.isAvailable !== false),
            unavailableEquipment,
            hasUnavailableEquipment: unavailableEquipment.length > 0,
            unavailableFood,
            unavailableDrinks,
            hasUnavailableConsumables: unavailableFood.length > 0 || unavailableDrinks.length > 0,
            // Missing consumables never gate usability: unlike equipment (which can be rare or
            // costly to reacquire), food/drinks are cheap and fast to rebuy, so a loadout missing
            // only consumables is still usable — the resolved food/drinks arrays already blank the
            // missing slots above rather than fabricating an item the character doesn't own.
            isUsableForCalculation: unavailableEquipment.length === 0,
            abilities: (rawSnapshot.abilities || []).map((entry) => ({ ...entry })),
            // Preserve native slot indices, including intentional holes. Missing consumables
            // are blanked in calculation-facing arrays and retained only in the explicit
            // unavailable* diagnostics so callers cannot accidentally simulate an item the
            // character does not own.
            food: resolvedFood.map((entry) => ({ itemHrid: entry.isAvailable ? entry.itemHrid : '' })),
            drinks: resolvedDrinks.map((entry) => ({ itemHrid: entry.isAvailable ? entry.itemHrid : '' })),
            abilityCombatTriggersMap: cloneTriggerMap(rawSnapshot.abilityCombatTriggersMap),
            consumableCombatTriggersMap: cloneTriggerMap(rawSnapshot.consumableCombatTriggersMap),
        };
    }

    _cloneResolvedSnapshot(snapshot) {
        return snapshot ? cloneJsonSafeValue(snapshot) : null;
    }

    /**
     * Resolve a raw/cached snapshot against current character state.
     * Effective state is maintained event-driven by loadouts_updated / items_updated and reads
     * are served from the canonical cache. Returning a defensive clone preserves the old public
     * contract: feature code can never mutate Core's cached truth by holding a snapshot object.
     * @param {Object|string|null} snapshotOrId
     * @returns {Object|null}
     */
    resolveSnapshot(snapshotOrId) {
        if (!snapshotOrId) return null;

        let snapshotId = null;
        if (typeof snapshotOrId === 'string' || typeof snapshotOrId === 'number') {
            snapshotId = String(snapshotOrId);
        } else if (hasOwn(snapshotOrId, 'snapshotId')) {
            // A previously resolved snapshot has stable identity. If that id was deleted, do
            // not silently rebind the stale object to a newly-created loadout that happens to
            // reuse the same display name. Callers that intentionally select by name use
            // getSnapshotByName()/getUsableSnapshotByName() explicitly.
            snapshotId = String(snapshotOrId.snapshotId);
        } else if (snapshotOrId.name) {
            const rawSnapshot = Object.values(this.rawSnapshots).find(
                (snapshot) => snapshot.name === snapshotOrId.name
            );
            snapshotId = rawSnapshot?.snapshotId || null;
        }

        if (!snapshotId || !this.rawSnapshots[snapshotId]) return null;

        let resolved = this.resolvedSnapshotCache.get(snapshotId);
        if (!resolved) {
            resolved = this._resolveRawSnapshot(this.rawSnapshots[snapshotId]);
            this.resolvedSnapshotCache.set(snapshotId, resolved);
            this.inventoryResolutionSignatures.set(snapshotId, this._buildResolutionSignature(resolved));
        }
        return this._cloneResolvedSnapshot(resolved);
    }

    getSnapshotById(snapshotId) {
        return this.resolveSnapshot(String(snapshotId));
    }

    getSnapshotByName(name) {
        const rawSnapshot = Object.values(this.rawSnapshots).find((snapshot) => snapshot.name === name);
        return rawSnapshot ? this.resolveSnapshot(rawSnapshot) : null;
    }

    getUsableSnapshotById(snapshotId) {
        const snapshot = this.getSnapshotById(snapshotId);
        return snapshot?.isUsableForCalculation ? snapshot : null;
    }

    getUsableSnapshotByName(name) {
        const snapshot = this.getSnapshotByName(name);
        return snapshot?.isUsableForCalculation ? snapshot : null;
    }

    getSnapshotsById() {
        const result = {};
        for (const snapshotId of Object.keys(this.rawSnapshots)) {
            const resolved = this.getSnapshotById(snapshotId);
            if (resolved) result[snapshotId] = resolved;
        }
        return result;
    }

    getAllSnapshots() {
        return Object.keys(this.rawSnapshots)
            .map((snapshotId) => this.getSnapshotById(snapshotId))
            .filter(Boolean)
            .sort((a, b) => a.ordinal - b.ordinal);
    }

    _getSelectedSnapshotIdForActionType(actionTypeHrid) {
        if (this.actionTypeSelectionIdCache.has(actionTypeHrid)) {
            return this.actionTypeSelectionIdCache.get(actionTypeHrid);
        }

        let skillDefault = null;
        let allSkillsDefault = null;
        let skillNonDefault = null;
        let allSkillsNonDefault = null;

        for (const rawSnapshot of Object.values(this.rawSnapshots)) {
            if (rawSnapshot.actionTypeHrid === actionTypeHrid) {
                if (rawSnapshot.isDefault) skillDefault = rawSnapshot.snapshotId;
                else skillNonDefault = rawSnapshot.snapshotId;
            } else if (rawSnapshot.actionTypeHrid === '') {
                if (rawSnapshot.isDefault) allSkillsDefault = rawSnapshot.snapshotId;
                else allSkillsNonDefault = rawSnapshot.snapshotId;
            }
        }

        const selectedId = skillDefault || allSkillsDefault || skillNonDefault || allSkillsNonDefault || null;
        this.actionTypeSelectionIdCache.set(actionTypeHrid, selectedId);
        return selectedId;
    }

    /**
     * Lightweight saved-loadout lookup for action/profit hot paths. Unlike the descriptive
     * snapshot API, this intentionally copies only the fields calculations need and never
     * clones abilities/trigger maps. Effective equipment/consumable state still comes from the
     * same canonical cache and therefore preserves all Exact/Highest/availability semantics.
     * @param {string} actionTypeHrid
     * @returns {{status:string,snapshot:Object|null}}
     */
    findCalculationSelectionForActionType(actionTypeHrid) {
        const selectedId = this._getSelectedSnapshotIdForActionType(actionTypeHrid);
        if (!selectedId) return { status: 'none', snapshot: null };

        const resolved = this.resolvedSnapshotCache.get(selectedId);
        if (!resolved) return { status: 'none', snapshot: null };

        const snapshot = {
            snapshotId: resolved.snapshotId,
            name: resolved.name,
            equipment: (resolved.equipment || []).map((entry) => ({ ...entry })),
            drinks: (resolved.drinks || []).map((entry) => ({ ...entry })),
            hasUnavailableEquipment: resolved.hasUnavailableEquipment,
            hasUnavailableConsumables: resolved.hasUnavailableConsumables,
            isUsableForCalculation: resolved.isUsableForCalculation,
        };

        return {
            status: snapshot.isUsableForCalculation ? 'usable' : 'unavailable',
            snapshot,
        };
    }

    /**
     * Find the preferred saved loadout for an action type. This method is independent of the
     * user setting that controls automatic profit/action calculations; callers decide whether
     * saved loadouts should be used in their context.
     * @param {string} actionTypeHrid
     * @returns {Object|null}
     */
    findSnapshotSelectionForActionType(actionTypeHrid) {
        const selectedId = this._getSelectedSnapshotIdForActionType(actionTypeHrid);

        if (!selectedId) return { status: 'none', snapshot: null };

        const resolved = this.resolveSnapshot(selectedId);
        if (!resolved) return { status: 'none', snapshot: null };
        return {
            status: resolved.isUsableForCalculation ? 'usable' : 'unavailable',
            snapshot: resolved,
        };
    }

    findSnapshotForActionType(actionTypeHrid) {
        const selection = this.findSnapshotSelectionForActionType(actionTypeHrid);
        return selection.status === 'usable' ? selection.snapshot : null;
    }

    /**
     * Expose state metadata for diagnostics/tests without exposing mutable raw snapshots.
     */
    getStateInfo() {
        return {
            activeCharacterId: this.activeCharacterId,
            authority: this.authority,
            generation: this.generation,
            snapshotCount: Object.keys(this.rawSnapshots).length,
            captureStarted: this.captureStarted,
            persistenceReady: this.persistenceReady,
        };
    }
}

const loadoutState = new LoadoutState();

export { LoadoutState };
export default loadoutState;
