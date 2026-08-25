/**
 * Data Manager Module
 * Central hub for accessing game data
 *
 * Uses official API: localStorageUtil.getInitClientData()
 * Listens to WebSocket messages for player data updates
 */

import webSocketHook from './websocket.js';
import connectionState from './connection-state.js';
import storage from './storage.js';
import { mergeMarketListings } from '../utils/market-listings.js';
import { SCROLL_BUFF_VALUES } from '../utils/scroll-buff-values.js';

class DataManager {
    constructor() {
        this.webSocketHook = webSocketHook;

        // Static game data (items, actions, monsters, abilities, etc.)
        this.initClientData = null;

        // Player data (updated via WebSocket)
        this.characterData = null;
        this.characterSkills = null;
        this.characterItems = null;
        this.characterActions = [];
        this.characterQuests = []; // Active quests including tasks
        this.characterEquipment = new Map();
        this.characterHouseRooms = new Map(); // House room HRID -> {houseRoomHrid, level}
        this.actionTypeDrinkSlotsMap = new Map(); // Action type HRID -> array of drink items
        this.characterGuildBuffMap = {}; // Guild buff HRID -> {guildBuffHrid, level}
        this.guildBuildingLevelMap = {}; // Building/shrine HRID -> level
        this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
        this.bossMonsterHrids = new Set(); // Monster HRIDs that appear in bossSpawns
        this.battleData = null; // Current battle data (for Combat Sim export on Steam)

        // Trustworthy boundary for the currently in-progress base action's current unit:
        // { actionId, currentCount, unitStartTime }. Used to compute already-elapsed time in
        // the active unit so Action Time Display doesn't re-anchor its ETA to a full fresh
        // action on reload/remount. Persisted per-character so it survives reload; validated
        // against the live actionId/currentCount pair on restore so a stale/mismatched boundary
        // is never trusted (see _syncActionUnitBoundary).
        this.actionUnitBoundary = null;

        // Character tracking for switch detection
        this.currentCharacterId = null;
        this.currentCharacterName = null;
        this.currentCharacterGameMode = null;
        this.isCharacterSwitching = false;
        this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

        // Character-WebSocket ownership (TLA-018). initGeneration is bumped on every accepted
        // init_character_data so an older async init continuation can detect it was superseded
        // after resuming from an await, and activeSocket is bound to the socket that delivered
        // that accepted init so delayed character-scoped updates from a stale socket (old
        // connection after a switch/reconnect) can be rejected without depending on every
        // payload carrying a character id. Both start permissive (0 / null): no socket/epoch is
        // known yet, matching loadout-state.js's ownership model.
        this.initGeneration = 0;
        this.activeSocket = null;

        // Event listeners
        this.eventListeners = new Map();

        // Achievement buff cache (action type → buff type → flat boost)
        this.achievementBuffCache = {
            source: null,
            byActionType: new Map(),
        };

        // Personal buffs from seals (personal_buffs_updated WebSocket message)
        this.personalActionTypeBuffsMap = {};

        // Per-action-type scroll simulation (Set of buffTypeHrids to simulate)
        this.scrollSimulationByActionType = {};

        // Retry interval for loading static game data
        this.loadRetryInterval = null;
        this.fallbackInterval = null;

        // Setup WebSocket message handlers
        this.setupMessageHandlers();
    }

    /**
     * Initialize the Data Manager
     * Call this after game loads (or immediately - will retry if needed)
     */
    initialize() {
        this.cleanupIntervals();

        // Try to load static game data using official API
        const success = this.tryLoadStaticData();

        // If failed, set up retry polling
        if (!success && !this.loadRetryInterval) {
            this.loadRetryInterval = setInterval(() => {
                if (this.tryLoadStaticData()) {
                    this.cleanupIntervals();
                }
            }, 500); // Retry every 500ms
        }

        // FALLBACK: Continuous polling for missed init_character_data (should not be needed with @run-at document-start)
        // Extended timeout for slower connections/computers (Steam, etc.)
        let fallbackAttempts = 0;
        const maxAttempts = 60; // Poll for up to 30 seconds (60 × 500ms)

        const stopFallbackInterval = () => {
            if (this.fallbackInterval) {
                clearInterval(this.fallbackInterval);
                this.fallbackInterval = null;
            }
        };

        this.fallbackInterval = setInterval(() => {
            fallbackAttempts++;

            // Stop if character data received via WebSocket
            if (this.characterData) {
                stopFallbackInterval();
                return;
            }

            // Give up after max attempts
            if (fallbackAttempts >= maxAttempts) {
                console.error(
                    '[DataManager] Character data not received after 30 seconds. WebSocket hook may have failed.'
                );
                stopFallbackInterval();
            }
        }, 500); // Check every 500ms
    }

    /**
     * Cleanup polling intervals
     */
    cleanupIntervals() {
        if (this.loadRetryInterval) {
            clearInterval(this.loadRetryInterval);
            this.loadRetryInterval = null;
        }

        if (this.fallbackInterval) {
            clearInterval(this.fallbackInterval);
            this.fallbackInterval = null;
        }
    }

    /**
     * Attempt to load static game data
     * @returns {boolean} True if successful, false if needs retry
     * @private
     */
    tryLoadStaticData() {
        try {
            if (typeof localStorageUtil !== 'undefined' && typeof localStorageUtil.getInitClientData === 'function') {
                const data = localStorageUtil.getInitClientData();
                if (data && Object.keys(data).length > 0) {
                    this.initClientData = data;

                    // Build monster sort index map for task sorting
                    this.buildMonsterSortIndexMap();

                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('[Data Manager] Failed to load init_client_data:', error);
            return false;
        }
    }

    /**
     * Setup WebSocket message handlers
     * Listens for game data updates
     */
    setupMessageHandlers() {
        // Handle init_character_data (player data on login/refresh)
        this.webSocketHook.on('init_character_data', async (data, context) => {
            // Detect character switch
            const newCharacterId = data.character?.id;
            const newCharacterName = data.character?.name;

            // Validate character data before processing
            if (!newCharacterId || !newCharacterName) {
                console.error('[DataManager] Invalid character data received:', {
                    hasCharacter: !!data.character,
                    hasId: !!newCharacterId,
                    hasName: !!newCharacterName,
                });
                return; // Don't process invalid character data
            }

            // Track whether this is a character switch or first load
            let isCharacterSwitch = false;

            // Check if this is a character switch (not first load)
            if (this.currentCharacterId && this.currentCharacterId !== newCharacterId) {
                isCharacterSwitch = true;
                // Prevent rapid-fire character switches (loop protection)
                const now = Date.now();
                if (this.lastCharacterSwitchTime && now - this.lastCharacterSwitchTime < 1000) {
                    console.warn('[Toolasha] Ignoring rapid character switch (<1s since last), possible loop detected');
                    return;
                }
                this.lastCharacterSwitchTime = now;

                // Flush all pending storage writes before cleanup (non-blocking)
                // Use setTimeout to prevent main thread blocking during character switch
                setTimeout(async () => {
                    try {
                        if (storage && typeof storage.flushAll === 'function') {
                            await storage.flushAll();
                        }
                    } catch (error) {
                        console.error('[Toolasha] Failed to flush storage before character switch:', error);
                    }
                }, 0);

                // Set switching flag to block feature initialization
                this.isCharacterSwitching = true;

                // Emit character_switching event (cleanup phase)
                this.emit('character_switching', {
                    oldId: this.currentCharacterId,
                    newId: newCharacterId,
                    oldName: this.currentCharacterName,
                    newName: newCharacterName,
                });

                // Update character tracking
                this.currentCharacterId = newCharacterId;
                this.currentCharacterName = newCharacterName;
                this.currentCharacterGameMode = data.character?.gameMode || null;

                // Clear old character data
                this.characterData = null;
                this.characterSkills = null;
                this.characterItems = null;
                this.characterActions = [];
                this.characterQuests = [];
                this.characterEquipment.clear();
                this.characterHouseRooms.clear();
                this.actionTypeDrinkSlotsMap.clear();
                this.personalActionTypeBuffsMap = {};
                this.characterGuildBuffMap = {};
                this.guildBuildingLevelMap = {};
                this.battleData = null;
                this.actionUnitBoundary = null;

                // Reset switching flag (cleanup complete, ready for re-init)
                this.isCharacterSwitching = false;

                // Emit character_switched event (ready for re-init)
                this.emit('character_switched', {
                    newId: newCharacterId,
                    newName: newCharacterName,
                });
            } else if (!this.currentCharacterId) {
                // First load - set character tracking
                this.currentCharacterId = newCharacterId;
                this.currentCharacterName = newCharacterName;
                this.currentCharacterGameMode = data.character?.gameMode || null;
            }

            // This init is accepted (validated, and not rejected as a rapid-fire switch above).
            // Establish a new ownership epoch and bind the socket that delivered it before any
            // awaits below can interleave with a second accepted init. A same-character
            // reconnect still starts a fresh epoch — WebSocketHook does not serialize async
            // handlers, so two overlapping init_character_data continuations must be
            // distinguishable even when neither payload's character id differs (TLA-018).
            this.initGeneration += 1;
            const generation = this.initGeneration;
            if (context?.socket) {
                this.activeSocket = context.socket;
            } else if (isCharacterSwitch) {
                // No socket context and the character changed: the previously bound socket no
                // longer corresponds to who is active. Fail closed to "unknown" rather than keep
                // trusting a socket that may belong to the departed character.
                this.activeSocket = null;
            }

            // Process new character data normally. Keep characterData.characterItems and
            // this.characterItems on the same live array: several legacy consumers still read
            // characterData directly, while incremental updates mutate this.characterItems.
            // Mirror native presence semantics first so both views exclude only explicit zero.
            // Do not mutate the shared WebSocket payload object: later subscribers should still
            // observe the server message exactly as delivered.
            const characterItems = Array.isArray(data.characterItems)
                ? data.characterItems.filter((item) => item?.count !== 0)
                : [];
            this.characterData = { ...data, characterItems };
            this.characterSkills = data.characterSkills;
            this.characterItems = characterItems;
            this.characterActions = [...data.characterActions];
            this.characterQuests = data.characterQuests || [];

            // Restore/establish the current-unit timing boundary for whatever action is now
            // front-most, so a reload or character switch-back doesn't discard a still-valid
            // partial-progress boundary (see _restoreActionUnitBoundary).
            await this._restoreActionUnitBoundary(newCharacterId, generation);

            if (this.initGeneration !== generation) {
                // A newer init_character_data was accepted while this one was still awaiting its
                // action-unit boundary restore. This continuation is stale: it must not publish
                // derived maps built from its own local `data`, or emit character_initialized,
                // over the newer character's already-installed canonical state (TLA-018).
                console.warn(
                    '[DataManager] Dropping stale init_character_data continuation (superseded by a newer accepted init)'
                );
                return;
            }

            // Build equipment map
            this.updateEquipmentMap(this.characterItems);

            // Build house room map
            this.updateHouseRoomMap(data.characterHouseRoomMap);

            // Build drink slots map (tea buffs)
            this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

            // Load personal buffs (seal buffs from Labyrinth, may be present on login)
            if (data.personalActionTypeBuffsMap) {
                this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
            }

            // Load guild buff levels and shrine/building levels
            this.characterGuildBuffMap = data.characterGuildBuffMap || {};
            this.guildBuildingLevelMap = data.guildBuildingLevelMap || {};

            // Clear switching flag
            this.isCharacterSwitching = false;

            // Emit character_initialized event (trigger feature initialization)
            // Include flag to indicate if this is a character switch vs first load
            // IMPORTANT: Mutate data object instead of spreading to avoid copying MB of data
            data._isCharacterSwitch = isCharacterSwitch;
            this.emit('character_initialized', data);
            connectionState.handleCharacterInitialized(data);
        });

        // Handle actions_updated (action queue changes)
        this.webSocketHook.on('actions_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Update action list
            for (const action of data.endCharacterActions) {
                // Always remove the old entry first to prevent duplicates —
                // endCharacterActions can contain existing actions alongside new ones.
                this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
                if (action.isDone === false) {
                    this.characterActions.push(action);
                }
            }

            this._syncActionUnitBoundary();

            this.emit('actions_updated', data);
        });

        // Handle action_completed (action progress)
        this.webSocketHook.on('action_completed', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            const action = data.endCharacterAction;
            if (action.isDone === false) {
                for (let i = 0; i < this.characterActions.length; i++) {
                    if (this.characterActions[i].id === action.id) {
                        // Replace the entire cached action with fresh data from the server
                        // This keeps primaryItemHash, enhancingMaxLevel, etc. up to date
                        this.characterActions[i] = action;
                        break;
                    }
                }
            }

            this._syncActionUnitBoundary();

            // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
            if (data.endCharacterItems && Array.isArray(data.endCharacterItems) && this.characterItems) {
                this.applyCharacterItemUpdates(data.endCharacterItems, { inventoryOnly: true });

                // Notify items_updated listeners (e.g. networth) of the inventory change
                this.emit('items_updated', data);
            }

            // CRITICAL: Update skill experience from action_completed (this is how XP updates in real-time!)
            if (data.endCharacterSkills && Array.isArray(data.endCharacterSkills) && this.characterSkills) {
                for (const updatedSkill of data.endCharacterSkills) {
                    const skill = this.characterSkills.find((s) => s.skillHrid === updatedSkill.skillHrid);
                    if (skill) {
                        // Update experience (and level if it changed)
                        skill.experience = updatedSkill.experience;
                        if (updatedSkill.level !== undefined) {
                            skill.level = updatedSkill.level;
                        }
                    }
                }
            }

            // Merge ability XP/level changes embedded in action_completed (e.g. combat
            // actions granting ability XP) - a second live path alongside abilities_updated.
            this._mergeCharacterAbilities(data.endCharacterAbilities);

            this.emit('action_completed', data);
        });

        // Handle abilities_updated (ability level/XP changes: leveling up, learning a new
        // ability, or other native ability-state changes outside of action_completed)
        this.webSocketHook.on('abilities_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            this._mergeCharacterAbilities(data.endCharacterAbilities);
        });

        // Handle items_updated (inventory/equipment changes)
        this.webSocketHook.on('items_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (data.endCharacterItems) {
                if (!this.characterItems) {
                    this.emit('items_updated', data);
                    return;
                }
                // Native MWI keys character-item updates by `hash` and updates its equipment
                // location map in message order. applyCharacterItemUpdates mirrors both maps,
                // including the guarded removal that cannot delete an already-current replacement.
                this.applyCharacterItemUpdates(data.endCharacterItems);
            }

            this.emit('items_updated', data);
        });

        // Handle market_listings_updated (the current character's own market order changes —
        // character-scoped, unlike market_item_order_books_updated below)
        this.webSocketHook.on('market_listings_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (!this.characterData || !Array.isArray(data?.endMarketListings)) {
                return;
            }

            const currentListings = Array.isArray(this.characterData.myMarketListings)
                ? this.characterData.myMarketListings
                : [];
            const updatedListings = mergeMarketListings(currentListings, data.endMarketListings);

            this.characterData = {
                ...this.characterData,
                myMarketListings: updatedListings,
            };

            this.emit('market_listings_updated', {
                ...data,
                myMarketListings: updatedListings,
            });
        });

        // Handle market_item_order_books_updated (order book updates). Global market data, not
        // scoped to the active character — must not be dropped by socket-ownership checks.
        this.webSocketHook.on('market_item_order_books_updated', (data) => {
            this.emit('market_item_order_books_updated', data);
        });

        // Handle action_type_consumable_slots_updated (when user changes tea assignments)
        this.webSocketHook.on('action_type_consumable_slots_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Update drink slots map with new consumables
            if (data.actionTypeDrinkSlotsMap) {
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
            }

            this.emit('consumables_updated', data);
        });

        // Handle consumable_buffs_updated (when buffs expire/refresh)
        this.webSocketHook.on('consumable_buffs_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Buffs updated - next hover will show updated values
            this.emit('buffs_updated', data);
        });

        // Handle personal_buffs_updated (seal buffs from Labyrinth)
        this.webSocketHook.on('personal_buffs_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (data.personalActionTypeBuffsMap) {
                this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
            }
            this.emit('personal_buffs_updated', data);
        });

        // Handle house_rooms_updated (when user upgrades house rooms)
        this.webSocketHook.on('house_rooms_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Update house room map with new levels
            if (data.characterHouseRoomMap) {
                this.updateHouseRoomMap(data.characterHouseRoomMap);
            }

            this.emit('house_rooms_updated', data);
        });

        // Handle skills_updated (when user gains skill levels)
        this.webSocketHook.on('skills_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Update character skills with new levels
            if (data.characterSkills) {
                this.characterSkills = data.characterSkills;
            }

            this.emit('skills_updated', data);
        });

        // Handle new_battle (combat start - for Combat Sim export on Steam)
        this.webSocketHook.on('new_battle', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            // Store battle data (includes party consumables)
            this.battleData = data;
        });

        // Handle character_info_updated (task slot changes, cooldown timestamps, etc.)
        this.webSocketHook.on('character_info_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (this.characterData && data.characterInfo) {
                this.characterData.characterInfo = data.characterInfo;
            }
            this.emit('character_info_updated', data);
        });

        // Handle setting_updated (labyrinth skip thresholds, crate selection, etc.)
        this.webSocketHook.on('setting_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (this.characterData && data.characterSetting) {
                this.characterData.characterSetting = data.characterSetting;
            }
            this.emit('setting_updated', data);
        });

        // Handle quests_updated (keep characterQuests in sync mid-session)
        this.webSocketHook.on('quests_updated', (data, context) => {
            if (!this._isFromActiveSocket(context)) return;

            if (data.endCharacterQuests && Array.isArray(data.endCharacterQuests)) {
                for (const updatedQuest of data.endCharacterQuests) {
                    const index = this.characterQuests.findIndex((q) => q.id === updatedQuest.id);
                    if (index !== -1) {
                        this.characterQuests[index] = updatedQuest;
                    } else {
                        this.characterQuests.push(updatedQuest);
                    }
                }
                // Remove claimed quests
                this.characterQuests = this.characterQuests.filter((q) => q.status !== '/quest_status/claimed');
            }
        });
    }

    /**
     * True unless a character-scoped update is provably from a stale WebSocket — i.e., an
     * accepted init_character_data bound a real socket (this.activeSocket) and this update's
     * context carries a different one. Permissive whenever no socket is bound yet (initial
     * load before any init_character_data, or tests that invoke handlers without a socket
     * context) so this never depends on every payload carrying a character id (TLA-018).
     * @param {{socket?: WebSocket}|null} context
     * @returns {boolean}
     */
    _isFromActiveSocket(context) {
        return !this.activeSocket || context?.socket === this.activeSocket;
    }

    /**
     * Find the existing record targeted by an incremental character-item update. Current MWI
     * payloads expose `hash` (character + location + item + enhancement), which is authoritative.
     * Older/fallback payloads may only expose `id`, so matching deliberately supports transitions
     * between legacy id-only and current hash-aware records without letting a reused id collapse
     * two distinct hash variants in the same batch.
     * @param {Object} item
     * @returns {number}
     */
    findCharacterItemIndex(item) {
        if (!item || typeof item !== 'object' || !Array.isArray(this.characterItems)) return -1;

        if (item.hash) {
            const hashIndex = this.characterItems.findIndex((existing) => existing?.hash === item.hash);
            if (hashIndex !== -1) return hashIndex;

            // A current hash-aware update may replace a legacy cached record that never had a hash.
            if (item.id !== null && item.id !== undefined) {
                const legacyIdIndex = this.characterItems.findIndex(
                    (existing) => !existing?.hash && existing?.id === item.id
                );
                if (legacyIdIndex !== -1) return legacyIdIndex;
            }
            return -1;
        }

        if (item.id !== null && item.id !== undefined) {
            const idIndex = this.characterItems.findIndex((existing) => existing?.id === item.id);
            if (idIndex !== -1) return idIndex;
        }

        if (!item.itemHrid || !item.itemLocationHrid) return -1;
        const level = Number(item.enhancementLevel) || 0;
        return this.characterItems.findIndex(
            (existing) =>
                !existing?.hash &&
                (existing?.id === null || existing?.id === undefined) &&
                existing?.itemLocationHrid === item.itemLocationHrid &&
                existing?.itemHrid === item.itemHrid &&
                (Number(existing?.enhancementLevel) || 0) === level
        );
    }

    /**
     * Apply incremental character-item updates using native MWI identity/presence semantics.
     * Only explicit count === 0 removes a record; omitted count is valid/present.
     * @param {Array<Object>} updates
     * @param {{inventoryOnly?: boolean}} options
     */
    applyCharacterItemUpdates(updates, { inventoryOnly = false } = {}) {
        if (!Array.isArray(this.characterItems)) this.characterItems = [];

        const matchesCurrentEquipment = (current, candidate) => {
            if (!current || !candidate) return false;
            if (candidate.hash) return current.hash === candidate.hash;
            if (candidate.id !== null && candidate.id !== undefined) return current.id === candidate.id;
            return (
                current.itemHrid === candidate.itemHrid &&
                current.itemLocationHrid === candidate.itemLocationHrid &&
                (Number(current.enhancementLevel) || 0) === (Number(candidate.enhancementLevel) || 0)
            );
        };

        for (const item of updates || []) {
            if (!item) continue;
            if (inventoryOnly && item.itemLocationHrid !== '/item_locations/inventory') continue;

            const hasIdentity =
                !!item.hash ||
                (item.id !== null && item.id !== undefined) ||
                (!!item.itemHrid && !!item.itemLocationHrid);
            if (!hasIdentity) continue;

            const index = this.findCharacterItemIndex(item);
            const previous = index !== -1 ? this.characterItems[index] : null;
            const previousLocation = previous?.itemLocationHrid;

            if (item.count === 0) {
                if (index !== -1) this.characterItems.splice(index, 1);

                if (!inventoryOnly) {
                    const removedLocation = item.itemLocationHrid || previousLocation;
                    if (removedLocation && removedLocation !== '/item_locations/inventory') {
                        const current = this.characterEquipment.get(removedLocation);
                        // Match native MWI: deleting an old hash must not clear a replacement
                        // that already became current for the same equipment location.
                        const removalMatchesCurrent =
                            item.hash && current?.hash
                                ? current.hash === item.hash
                                : matchesCurrentEquipment(current, previous || item);
                        if (removalMatchesCurrent) this.characterEquipment.delete(removedLocation);
                    }
                }
                continue;
            }

            // Native MWI's hash-keyed Map replaces the full record on update. Preserve that
            // behavior for current hash-aware payloads so an omitted field (notably `count`)
            // cannot inherit stale state from an older object. Legacy id-only payloads still
            // merge because they may be partial compatibility updates.
            const storedItem = item.hash ? item : previous ? { ...previous, ...item } : item;
            if (index !== -1) this.characterItems[index] = storedItem;
            else this.characterItems.push(storedItem);

            if (!inventoryOnly) {
                const nextLocation = storedItem.itemLocationHrid;
                // Legacy partial records can represent a move without an explicit old count:0.
                // Avoid leaving a stale equipment pointer in the previous location.
                if (
                    previousLocation &&
                    previousLocation !== '/item_locations/inventory' &&
                    previousLocation !== nextLocation
                ) {
                    const current = this.characterEquipment.get(previousLocation);
                    if (matchesCurrentEquipment(current, previous)) {
                        this.characterEquipment.delete(previousLocation);
                    }
                }

                if (nextLocation && nextLocation !== '/item_locations/inventory') {
                    // Native location-map semantics are update ordered: the last present update
                    // for a location wins, independently of where its hash record sits in our array.
                    this.characterEquipment.set(nextLocation, storedItem);
                }
            }
        }
    }

    /**
     * Build the equipment location map from a full character-item snapshot (initial load).
     * Incremental updates maintain this map directly in applyCharacterItemUpdates so native
     * update ordering and guarded-removal semantics are preserved.
     * @param {Array} items - Full current character items array
     */
    updateEquipmentMap(items) {
        this.characterEquipment.clear();
        for (const item of items || []) {
            if (item?.itemLocationHrid && item.itemLocationHrid !== '/item_locations/inventory' && item.count !== 0) {
                this.characterEquipment.set(item.itemLocationHrid, item);
            }
        }
    }

    /**
     * Update house room map from character house room data
     * @param {Object} houseRoomMap - Character house room map
     */
    updateHouseRoomMap(houseRoomMap) {
        if (!houseRoomMap) {
            return;
        }

        this.characterHouseRooms.clear();
        for (const [_hrid, room] of Object.entries(houseRoomMap)) {
            this.characterHouseRooms.set(room.houseRoomHrid, room);
        }
    }

    /**
     * Update drink slots map from character data
     * @param {Object} drinkSlotsMap - Action type drink slots map
     */
    updateDrinkSlotsMap(drinkSlotsMap) {
        if (!drinkSlotsMap) {
            return;
        }

        this.actionTypeDrinkSlotsMap.clear();
        for (const [actionTypeHrid, drinks] of Object.entries(drinkSlotsMap)) {
            this.actionTypeDrinkSlotsMap.set(actionTypeHrid, drinks || []);
        }
    }

    /**
     * Merge a live ability-state update into the current character's ability list.
     * Mirrors the native client's `updateCharacterAbilities()`: replace by abilityHrid,
     * append if not yet known (newly learned ability). `endCharacterAbilities` is an update
     * set, not necessarily the complete list, so unrelated abilities are preserved. Reassigns
     * `characterData.characterAbilities` (rather than mutating in place) so every consumer
     * that reads it fresh - Ability Book Calculator, Combat Sim adapter, Networth, tooltip
     * prices, Combat Score - stays in sync from this one source with no separate mirror.
     * @param {Array} endCharacterAbilities - Updated/newly learned ability entries
     */
    _mergeCharacterAbilities(endCharacterAbilities) {
        if (!this.characterData || !Array.isArray(endCharacterAbilities) || endCharacterAbilities.length === 0) {
            return;
        }

        const abilities = [...(this.characterData.characterAbilities || [])];
        for (const updated of endCharacterAbilities) {
            const index = abilities.findIndex((a) => a.abilityHrid === updated.abilityHrid);
            if (index !== -1) {
                abilities[index] = updated;
            } else {
                abilities.push(updated);
            }
        }
        this.characterData.characterAbilities = abilities;

        this.emit('abilities_updated', { endCharacterAbilities });
    }

    /**
     * Get static game data
     * @returns {Object} Init client data (items, actions, monsters, etc.)
     */
    getInitClientData() {
        return this.initClientData;
    }

    /**
     * Get combined game data (static + character)
     * Used for features that need both static data and player data
     * @returns {Object} Combined data object
     */
    getCombinedData() {
        if (!this.initClientData) {
            return null;
        }

        return {
            ...this.initClientData,
            // Character-specific data
            characterItems: this.characterItems || [],
            myMarketListings: this.characterData?.myMarketListings || [],
            characterHouseRoomMap: Object.fromEntries(this.characterHouseRooms),
            characterAbilities: this.characterData?.characterAbilities || [],
            abilityCombatTriggersMap: this.characterData?.abilityCombatTriggersMap || {},
        };
    }

    /**
     * Get item details by HRID
     * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
     * @returns {Object|null} Item details
     */
    getItemDetails(itemHrid) {
        return this.initClientData?.itemDetailMap?.[itemHrid] || null;
    }

    /**
     * Get action details by HRID
     * @param {string} actionHrid - Action HRID (e.g., "/actions/milking/cow")
     * @returns {Object|null} Action details
     */
    getActionDetails(actionHrid) {
        return this.initClientData?.actionDetailMap?.[actionHrid] || null;
    }

    /**
     * Get player's current actions
     * @returns {Array} Current action queue
     */
    getCurrentActions() {
        return [...this.characterActions];
    }

    /**
     * Elapsed time already spent in the currently in-progress base action's active unit, so
     * callers modeling "remaining time" don't double-count that partial unit as a full one.
     * Returns 0 (fail-closed) whenever there's no trustworthy boundary for this exact
     * (actionId, currentCount) pair — e.g. cold start, a completed unit we never observed, or a
     * different action — matching the previous "assume fresh" behavior rather than fabricating
     * a partial estimate.
     * @param {number} actionId - id of the action currently in progress
     * @param {number} currentCount - that action's currentCount at the moment being queried
     * @param {number} unitDurationSeconds - full duration of one base action, for clamping
     * @returns {number} Elapsed seconds in [0, unitDurationSeconds]
     */
    getElapsedSecondsInCurrentUnit(actionId, currentCount, unitDurationSeconds) {
        const boundary = this.actionUnitBoundary;
        if (!boundary || boundary.actionId !== actionId || boundary.currentCount !== currentCount) {
            return 0;
        }
        const elapsedSeconds = (Date.now() - boundary.unitStartTime) / 1000;
        return Math.min(Math.max(0, elapsedSeconds), unitDurationSeconds);
    }

    /**
     * Reconcile the tracked current-unit boundary against the live front action (lowest
     * ordinal). A no-op when the front action's (id, currentCount) is unchanged — that's the
     * same in-progress unit, so its start time must not be reset. Otherwise establishes a
     * fresh boundary at "now": this is exactly right when the front action just transitioned
     * (action_completed continuation, or a new action taking the front slot) since that
     * transition instant IS the new unit's start, and it's the correct fail-closed default
     * when provenance is unknown (e.g. first observation of this pair).
     */
    _syncActionUnitBoundary() {
        const sorted = [...this.characterActions].sort((a, b) => a.ordinal - b.ordinal);
        const front = sorted[0] || null;

        if (!front) {
            this.actionUnitBoundary = null;
            return;
        }

        const existing = this.actionUnitBoundary;
        if (existing && existing.actionId === front.id && existing.currentCount === front.currentCount) {
            return;
        }

        this.actionUnitBoundary = {
            actionId: front.id,
            currentCount: front.currentCount,
            unitStartTime: Date.now(),
        };

        if (this.currentCharacterId) {
            storage.set(this.currentCharacterId, this.actionUnitBoundary, 'actionProgress');
        }
    }

    /**
     * Restore a persisted current-unit boundary on character load/switch/reload. Only trusted
     * when its (actionId, currentCount) still matches the live front action — otherwise at
     * least one unit completed while unobserved, so the old start time is no longer meaningful
     * and _syncActionUnitBoundary falls back to a fresh fail-closed boundary instead.
     *
     * `generation` is the init_character_data ownership epoch (TLA-018) captured by the caller
     * before this await. WebSocketHook does not serialize async handlers, so a second
     * init_character_data can be accepted — bumping `this.initGeneration` — while this restore's
     * own `storage.get()` is still pending. Re-checking the epoch immediately after that await
     * (and before the early-return no-op branch below, which has no await but still runs after
     * the caller's own epoch check) ensures a stale continuation can never install a boundary
     * for a character/init that is no longer the accepted one.
     * @param {number} characterId
     * @param {number} generation
     */
    async _restoreActionUnitBoundary(characterId, generation) {
        const sorted = [...this.characterActions].sort((a, b) => a.ordinal - b.ordinal);
        const front = sorted[0] || null;

        if (!front) {
            if (this.initGeneration === generation) this.actionUnitBoundary = null;
            return;
        }

        const persisted = await storage.get(characterId, 'actionProgress', null);
        if (this.initGeneration !== generation) {
            // Superseded by a newer accepted init while this storage read was pending.
            return;
        }

        this.actionUnitBoundary =
            persisted && persisted.actionId === front.id && persisted.currentCount === front.currentCount
                ? persisted
                : null;

        this._syncActionUnitBoundary();
    }

    /**
     * Get player's equipped items
     * @returns {Map} Equipment map (slot HRID -> item)
     */
    getEquipment() {
        return new Map(this.characterEquipment);
    }

    /**
     * Get MooPass buffs
     * @returns {Array} MooPass buffs array (empty if no MooPass)
     */
    getMooPassBuffs() {
        return this.characterData?.mooPassBuffs || [];
    }

    /**
     * Get the current character's server-resolved offline-progress hour cap. Never reconstructed
     * from purchased upgrades - this is the exact value the server sends.
     * @returns {number|null} Offline hour cap, or null if not yet known
     */
    getOfflineHourCap() {
        return this.characterData?.characterInfo?.offlineHourCap ?? null;
    }

    /**
     * Get the current character's MooPass expiry timestamp, if any.
     * @returns {number|null} Epoch ms, or null if no MooPass / not yet known
     */
    getMooPassExpireTime() {
        return this.characterData?.characterInfo?.mooPassExpireTime ?? null;
    }

    /**
     * Get player's house rooms
     * @returns {Map} House room map (room HRID -> {houseRoomHrid, level})
     */
    getHouseRooms() {
        return new Map(this.characterHouseRooms);
    }

    /**
     * Get house room level
     * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
     * @returns {number} Room level (0 if not found)
     */
    getHouseRoomLevel(houseRoomHrid) {
        const room = this.characterHouseRooms.get(houseRoomHrid);
        return room?.level || 0;
    }

    /**
     * Get character's purchased level for a guild buff
     * @param {string} guildBuffHrid - Guild buff HRID (e.g., "/guild_buffs/force_combat")
     * @returns {number} Current purchased level (0 if not purchased)
     */
    getCharacterGuildBuffLevel(guildBuffHrid) {
        return this.characterGuildBuffMap[guildBuffHrid]?.level || 0;
    }

    /**
     * Get guild shrine or building level
     * @param {string} hrid - Building/shrine HRID (e.g., "/guild_shrines/force")
     * @returns {number} Current guild building level (0 if not in a guild or not built)
     */
    getGuildBuildingLevel(hrid) {
        return this.guildBuildingLevelMap[hrid] || 0;
    }

    /**
     * Get active drink items for an action type
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @returns {Array} Array of drink items (empty if none)
     */
    getActionDrinkSlots(actionTypeHrid) {
        return this.actionTypeDrinkSlotsMap.get(actionTypeHrid) || [];
    }

    /**
     * Get current character ID
     * @returns {string|null} Character ID or null
     */
    getCurrentCharacterId() {
        return this.currentCharacterId;
    }

    /**
     * Get current character name
     * @returns {string|null} Character name or null
     */
    getCurrentCharacterName() {
        return this.currentCharacterName;
    }

    /**
     * Get current character game mode
     * @returns {string|null} Game mode ('ironcow', 'standard', etc.) or null
     */
    getCurrentCharacterGameMode() {
        return this.currentCharacterGameMode;
    }

    /**
     * Check if character is currently switching
     * @returns {boolean} True if switching
     */
    getIsCharacterSwitching() {
        return this.isCharacterSwitching;
    }

    /**
     * Get community buff level
     * @param {string} buffTypeHrid - Buff type HRID (e.g., "/community_buff_types/production_efficiency")
     * @returns {number} Buff level (0 if not active)
     */
    getCommunityBuffLevel(buffTypeHrid) {
        if (!this.characterData?.communityBuffs) {
            return 0;
        }

        const buff = this.characterData.communityBuffs.find((b) => b.hrid === buffTypeHrid);
        return buff?.level || 0;
    }

    /**
     * Get achievement buffs for an action type
     * Achievement buffs are provided by the game based on completed achievement tiers
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
     * @returns {Object} Buff object with stat bonuses (e.g., {gatheringQuantity: 0.02}) or empty object
     */
    getAchievementBuffs(actionTypeHrid) {
        if (!this.characterData?.achievementActionTypeBuffsMap) {
            return {};
        }

        return this.characterData.achievementActionTypeBuffsMap[actionTypeHrid] || {};
    }

    /**
     * Get achievement buff flat boost for an action type and buff type
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
     * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/wisdom")
     * @returns {number} Flat boost value (decimal) or 0 if not found
     */
    getAchievementBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
        const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
        if (!achievementMap) {
            return 0;
        }

        if (this.achievementBuffCache.source !== achievementMap) {
            this.achievementBuffCache = {
                source: achievementMap,
                byActionType: new Map(),
            };
        }

        const actionCache = this.achievementBuffCache.byActionType.get(actionTypeHrid) || new Map();
        if (actionCache.has(buffTypeHrid)) {
            return actionCache.get(buffTypeHrid);
        }

        const achievementBuffs = achievementMap[actionTypeHrid];
        if (!Array.isArray(achievementBuffs)) {
            actionCache.set(buffTypeHrid, 0);
            this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
            return 0;
        }

        const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
        const flatBoost = buff?.flatBoost || 0;
        actionCache.set(buffTypeHrid, flatBoost);
        this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
        return flatBoost;
    }

    /**
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/enhancing")
     * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/enhancing_success")
     * @returns {number} Ratio boost value (decimal) or 0 if not found
     */
    getAchievementBuffRatioBoost(actionTypeHrid, buffTypeHrid) {
        const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
        if (!achievementMap) return 0;

        const achievementBuffs = achievementMap[actionTypeHrid];
        if (!Array.isArray(achievementBuffs)) return 0;

        const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
        return buff?.ratioBoost || 0;
    }

    /**
     * Get personal buff flat boost for an action type and buff type (seal buffs from Labyrinth).
     * When scroll simulation is armed for this action type, returns max(active, simulated).
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
     * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/efficiency")
     * @returns {number} Flat boost value (decimal) or 0 if not found
     */
    getPersonalBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
        const activeValue = this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
        const simSet = this.scrollSimulationByActionType[actionTypeHrid];
        if (simSet?.has(buffTypeHrid)) {
            return Math.max(activeValue, SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0);
        }
        return activeValue;
    }

    /**
     * @param {string} actionTypeHrid
     * @param {string} buffTypeHrid
     * @returns {number}
     */
    _getActivePersonalBuff(actionTypeHrid, buffTypeHrid) {
        const personalBuffs = this.personalActionTypeBuffsMap[actionTypeHrid];
        if (!Array.isArray(personalBuffs)) return 0;
        const buff = personalBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
        return buff?.flatBoost || 0;
    }

    /**
     * Arm scroll simulation for a specific action type before running calculations.
     * @param {string} actionTypeHrid
     * @param {Set<string>} buffTypeSet - Set of buffTypeHrids to simulate
     */
    setScrollSimulation(actionTypeHrid, buffTypeSet) {
        if (buffTypeSet?.size > 0) {
            this.scrollSimulationByActionType[actionTypeHrid] = buffTypeSet;
        } else {
            delete this.scrollSimulationByActionType[actionTypeHrid];
        }
    }

    /**
     * Disarm scroll simulation for a specific action type after calculations are done.
     * @param {string} actionTypeHrid
     */
    clearScrollSimulation(actionTypeHrid) {
        delete this.scrollSimulationByActionType[actionTypeHrid];
    }

    /**
     * Returns true when a scroll buff is being simulated (simulated value > active value).
     * Used by display code to decide whether to show the scroll sprite on a buff row.
     * @param {string} actionTypeHrid
     * @param {string} buffTypeHrid
     * @returns {boolean}
     */
    isBuffBeingSimulated(actionTypeHrid, buffTypeHrid) {
        const simSet = this.scrollSimulationByActionType[actionTypeHrid];
        if (!simSet?.has(buffTypeHrid)) return false;
        return (SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0) > this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
    }

    /**
     * Get player's skills
     * @returns {Array|null} Character skills
     */
    getSkills() {
        return this.characterSkills ? [...this.characterSkills] : null;
    }

    /**
     * Get player's inventory
     * @returns {Array|null} Character items
     */
    getInventory() {
        return this.characterItems ? [...this.characterItems] : null;
    }

    /**
     * Get player's market listings
     * @returns {Array} Market listings array
     */
    getMarketListings() {
        return this.characterData?.myMarketListings ? [...this.characterData.myMarketListings] : [];
    }

    /**
     * Get the current blocked character map { [characterId]: name }
     * @returns {Object} Blocked character map, or empty object if not available
     */
    getBlockedCharacterMap() {
        return this.characterData?.blockedCharacterMap || {};
    }

    /**
     * Get active task action HRIDs
     * @returns {Array<string>} Array of action HRIDs that are currently active tasks
     */
    getActiveTaskActionHrids() {
        if (!this.characterQuests || this.characterQuests.length === 0) {
            return [];
        }

        return this.characterQuests
            .filter(
                (quest) =>
                    quest.category === '/quest_category/random_task' &&
                    quest.status === '/quest_status/in_progress' &&
                    quest.actionHrid
            )
            .map((quest) => quest.actionHrid);
    }

    /**
     * Check if an action is currently an active task
     * @param {string} actionHrid - Action HRID to check
     * @returns {boolean} True if action is an active task
     */
    isTaskAction(actionHrid) {
        const activeTasks = this.getActiveTaskActionHrids();
        return activeTasks.includes(actionHrid);
    }

    /**
     * Get task speed bonus from equipped task badges
     * @returns {number} Task speed percentage (e.g., 15 for 15%)
     */
    getTaskSpeedBonus() {
        if (!this.characterEquipment || !this.initClientData) {
            return 0;
        }

        let totalTaskSpeed = 0;

        // Task badges are in trinket slot
        const trinketLocation = '/item_locations/trinket';
        const equippedItem = this.characterEquipment.get(trinketLocation);

        if (!equippedItem || !equippedItem.itemHrid) {
            return 0;
        }

        const itemDetail = this.initClientData.itemDetailMap[equippedItem.itemHrid];
        if (!itemDetail || !itemDetail.equipmentDetail) {
            return 0;
        }

        const taskSpeed = itemDetail.equipmentDetail.noncombatStats?.taskSpeed || 0;
        if (taskSpeed === 0) {
            return 0;
        }

        // Calculate enhancement bonus
        // Note: noncombatEnhancementBonuses already includes slot multiplier (5× for trinket)
        const enhancementLevel = equippedItem.enhancementLevel || 0;
        const enhancementBonus = itemDetail.equipmentDetail.noncombatEnhancementBonuses?.taskSpeed || 0;
        const totalEnhancementBonus = enhancementBonus * enhancementLevel;

        // Total taskSpeed = base + enhancement
        totalTaskSpeed = (taskSpeed + totalEnhancementBonus) * 100; // Convert to percentage

        return totalTaskSpeed;
    }

    /**
     * Build monster-to-sortIndex mapping from combat zone data
     * Used for sorting combat tasks by zone progression order
     * @private
     */
    buildMonsterSortIndexMap() {
        if (!this.initClientData || !this.initClientData.actionDetailMap) {
            return;
        }

        this.monsterSortIndexMap.clear();
        this.bossMonsterHrids.clear();

        // Extract combat zones (non-dungeon only)
        for (const [_zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
            // Skip non-combat actions and dungeons
            if (action.type !== '/action_types/combat' || action.combatZoneInfo?.isDungeon) {
                continue;
            }

            const sortIndex = action.sortIndex;

            // Get regular spawn monsters
            const regularMonsters = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];

            // Get boss monsters (every 10 battles)
            const bossMonsters = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

            // Track boss monster HRIDs
            for (const boss of bossMonsters) {
                if (boss.combatMonsterHrid) {
                    this.bossMonsterHrids.add(boss.combatMonsterHrid);
                }
            }

            // Combine all monsters from this zone
            const allMonsters = [...regularMonsters, ...bossMonsters];

            // Map each monster to this zone's sortIndex
            for (const spawn of allMonsters) {
                const monsterHrid = spawn.combatMonsterHrid;
                if (!monsterHrid) continue;

                // If monster appears in multiple zones, use earliest zone (lowest sortIndex)
                if (
                    !this.monsterSortIndexMap.has(monsterHrid) ||
                    sortIndex < this.monsterSortIndexMap.get(monsterHrid)
                ) {
                    this.monsterSortIndexMap.set(monsterHrid, sortIndex);
                }
            }
        }
    }

    /**
     * Find the combat zone actionHrid that contains a given monster
     * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/bear")
     * @returns {string|null} Zone actionHrid or null
     */
    getCombatZoneForMonster(monsterHrid) {
        if (!this.initClientData?.actionDetailMap) return null;

        for (const [zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
            if (action.type !== '/action_types/combat') continue;

            const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
            const bosses = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

            for (const spawn of [...spawns, ...bosses]) {
                if (spawn.combatMonsterHrid === monsterHrid) {
                    return zoneHrid;
                }
            }
        }
        return null;
    }

    /**
     * Get zone sortIndex for a monster (for task sorting)
     * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/rat")
     * @returns {number} Zone sortIndex (999 if not found)
     */
    getMonsterSortIndex(monsterHrid) {
        return this.monsterSortIndexMap.get(monsterHrid) || 999;
    }

    /**
     * Check if a monster is a boss (appears in bossSpawns of any combat zone)
     * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/crystal_colossus")
     * @returns {boolean} True if the monster is a boss
     */
    isBossMonster(monsterHrid) {
        return this.bossMonsterHrids.has(monsterHrid);
    }

    /**
     * Get monster HRID from display name (for task sorting)
     * @param {string} monsterName - Monster display name (e.g., "Jerry")
     * @returns {string|null} Monster HRID or null if not found
     */
    getMonsterHridFromName(monsterName) {
        if (!this.initClientData || !this.initClientData.combatMonsterDetailMap) {
            return null;
        }

        // Search for monster by display name
        for (const [hrid, monster] of Object.entries(this.initClientData.combatMonsterDetailMap)) {
            if (monster.name === monsterName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Register event listener
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        const listeners = this.eventListeners.get(event);
        if (!listeners.includes(callback)) {
            listeners.push(callback);
        }
    }

    /**
     * Unregister event listener
     * @param {string} event - Event name
     * @param {Function} callback - Handler function to remove
     */
    off(event, callback) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Emit event to all listeners
     * Only character_switching is critical (must run immediately for proper cleanup)
     * All other events including character_switched and character_initialized are deferred
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        // Snapshot at emit time. Lifecycle listeners commonly unregister themselves
        // during character_switching; iterating the live array would shift entries and
        // deterministically skip the next cleanup handler. Deferred events must also not
        // be delivered to listeners that subscribed after the event was emitted.
        const listeners = [...(this.eventListeners.get(event) || [])];

        // Only character_switching must run immediately (cleanup phase)
        // character_switched can be deferred - it just schedules re-init anyway
        const isCritical = event === 'character_switching';

        if (isCritical) {
            // Run immediately on main thread
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`[Data Manager] Error in ${event} listener:`, error);
                }
            }
        } else {
            // Defer all other events to prevent main thread blocking
            setTimeout(() => {
                for (const listener of listeners) {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`[Data Manager] Error in ${event} listener:`, error);
                    }
                }
            }, 0);
        }
    }
}

const dataManager = new DataManager();

export default dataManager;
