/**
 * Data Manager Module
 * Central hub for accessing game data
 *
 * Uses official API: localStorageUtil.getInitClientData()
 * Listens to WebSocket messages for player data updates
 */

import webSocketHook from './websocket.js';
import storage from './storage.js';
import { mergeMarketListings } from '../utils/market-listings.js';

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
        this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
        this.battleData = null; // Current battle data (for Combat Sim export on Steam)

        // Character tracking for switch detection
        this.currentCharacterId = null;
        this.currentCharacterName = null;
        this.isCharacterSwitching = false;
        this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

        // Event listeners
        this.eventListeners = new Map();

        // Achievement buff cache (action type → buff type → flat boost)
        this.achievementBuffCache = {
            source: null,
            byActionType: new Map(),
        };

        // Retry interval for loading static game data
        this.loadRetryInterval = null;

        // Setup WebSocket message handlers
        this.setupMessageHandlers();
    }

    /**
     * Initialize the Data Manager
     * Call this after game loads (or immediately - will retry if needed)
     */
    initialize() {
        // Try to load static game data using official API
        const success = this.tryLoadStaticData();

        // If failed, set up retry polling
        if (!success && !this.loadRetryInterval) {
            this.loadRetryInterval = setInterval(() => {
                if (this.tryLoadStaticData()) {
                    // Success! Stop retrying
                    clearInterval(this.loadRetryInterval);
                    this.loadRetryInterval = null;
                }
            }, 500); // Retry every 500ms
        }

        // FALLBACK: Continuous polling for missed init_character_data (Firefox/timing race condition fix)
        // If WebSocket message was missed (hook installed too late), poll localStorage for character data
        let fallbackAttempts = 0;
        const maxAttempts = 20; // Poll for up to 10 seconds (20 × 500ms)

        const fallbackInterval = setInterval(() => {
            fallbackAttempts++;

            // Stop if character data received via WebSocket
            if (this.characterData) {
                clearInterval(fallbackInterval);
                return;
            }

            // Give up after max attempts
            if (fallbackAttempts >= maxAttempts) {
                console.warn('[DataManager] Fallback polling timeout after', maxAttempts, 'attempts (10 seconds)');
                clearInterval(fallbackInterval);
                return;
            }

            // Try to load from localStorage
            if (typeof localStorageUtil !== 'undefined') {
                try {
                    // Note: Using manual decompression for localStorage 'character' data as there is no
                    // official localStorageUtil API for character data (only for initClientData via getInitClientData()).
                    // This is a fallback when WebSocket init_character_data message is missed.
                    // WebSocket message: init_character_data (JSON string, not compressed)
                    // localStorage item: 'character' (LZ-compressed)
                    const rawData = localStorage.getItem('character');
                    if (rawData) {
                        const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
                        if (characterData && characterData.characterSkills) {
                            // Populate data manager with existing character data
                            this.characterData = characterData;
                            this.characterSkills = characterData.characterSkills;
                            this.characterItems = characterData.characterItems;
                            this.characterActions = characterData.characterActions
                                ? [...characterData.characterActions]
                                : [];

                            // Build equipment map
                            this.updateEquipmentMap(characterData.characterItems);

                            // Build house room map
                            this.updateHouseRoomMap(characterData.characterHouseRoomMap);

                            // Build drink slots map
                            this.updateDrinkSlotsMap(characterData.actionTypeDrinkSlotsMap);

                            // Fire character_initialized event
                            this.emit('character_initialized', characterData);

                            // Stop polling
                            clearInterval(fallbackInterval);
                        }
                    }
                } catch (error) {
                    console.warn('[DataManager] Fallback initialization attempt', fallbackAttempts, 'failed:', error);
                }
            }
        }, 500); // Check every 500ms
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
        this.webSocketHook.on('init_character_data', async (data) => {
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

            // Check if this is a character switch (not first load)
            if (this.currentCharacterId && this.currentCharacterId !== newCharacterId) {
                // Prevent rapid-fire character switches (loop protection)
                const now = Date.now();
                if (this.lastCharacterSwitchTime && now - this.lastCharacterSwitchTime < 1000) {
                    console.warn('[Toolasha] Ignoring rapid character switch (<1s since last), possible loop detected');
                    return;
                }
                this.lastCharacterSwitchTime = now;

                // FIX 3: Flush all pending storage writes before cleanup
                try {
                    if (storage && typeof storage.flushAll === 'function') {
                        await storage.flushAll();
                    }
                } catch (error) {
                    console.error('[Toolasha] Failed to flush storage before character switch:', error);
                }

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

                // Clear old character data
                this.characterData = null;
                this.characterSkills = null;
                this.characterItems = null;
                this.characterActions = [];
                this.characterQuests = [];
                this.characterEquipment.clear();
                this.characterHouseRooms.clear();
                this.actionTypeDrinkSlotsMap.clear();
                this.battleData = null;

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
            }

            // Process new character data normally
            this.characterData = data;
            this.characterSkills = data.characterSkills;
            this.characterItems = data.characterItems;
            this.characterActions = [...data.characterActions];
            this.characterQuests = data.characterQuests || [];

            // Build equipment map
            this.updateEquipmentMap(data.characterItems);

            // Build house room map
            this.updateHouseRoomMap(data.characterHouseRoomMap);

            // Build drink slots map (tea buffs)
            this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

            // Clear switching flag
            this.isCharacterSwitching = false;

            // Emit character_initialized event (trigger feature initialization)
            this.emit('character_initialized', data);
        });

        // Handle actions_updated (action queue changes)
        this.webSocketHook.on('actions_updated', (data) => {
            // Update action list
            for (const action of data.endCharacterActions) {
                if (action.isDone === false) {
                    this.characterActions.push(action);
                } else {
                    this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
                }
            }

            this.emit('actions_updated', data);
        });

        // Handle action_completed (action progress)
        this.webSocketHook.on('action_completed', (data) => {
            const action = data.endCharacterAction;
            if (action.isDone === false) {
                for (const a of this.characterActions) {
                    if (a.id === action.id) {
                        a.currentCount = action.currentCount;
                    }
                }
            }

            // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
            if (data.endCharacterItems && Array.isArray(data.endCharacterItems)) {
                for (const endItem of data.endCharacterItems) {
                    // Only update inventory items
                    if (endItem.itemLocationHrid !== '/item_locations/inventory') {
                        continue;
                    }

                    // Find and update the item in inventory
                    for (const invItem of this.characterItems) {
                        if (invItem.id === endItem.id) {
                            invItem.count = endItem.count;
                            break;
                        }
                    }
                }
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

            this.emit('action_completed', data);
        });

        // Handle items_updated (inventory/equipment changes)
        this.webSocketHook.on('items_updated', (data) => {
            if (data.endCharacterItems) {
                // Update inventory items in-place (endCharacterItems contains only changed items, not full inventory)
                for (const item of data.endCharacterItems) {
                    if (item.itemLocationHrid !== '/item_locations/inventory') {
                        // Equipment items handled by updateEquipmentMap
                        continue;
                    }

                    // Update or add inventory item
                    const index = this.characterItems.findIndex((invItem) => invItem.id === item.id);
                    if (index !== -1) {
                        // Update existing item count
                        this.characterItems[index].count = item.count;
                    } else {
                        // Add new item to inventory
                        this.characterItems.push(item);
                    }
                }

                this.updateEquipmentMap(data.endCharacterItems);
            }

            this.emit('items_updated', data);
        });

        // Handle market_listings_updated (market order changes)
        this.webSocketHook.on('market_listings_updated', (data) => {
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

        // Handle market_item_order_books_updated (order book updates)
        this.webSocketHook.on('market_item_order_books_updated', (data) => {
            this.emit('market_item_order_books_updated', data);
        });

        // Handle action_type_consumable_slots_updated (when user changes tea assignments)
        this.webSocketHook.on('action_type_consumable_slots_updated', (data) => {
            // Update drink slots map with new consumables
            if (data.actionTypeDrinkSlotsMap) {
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
            }

            this.emit('consumables_updated', data);
        });

        // Handle consumable_buffs_updated (when buffs expire/refresh)
        this.webSocketHook.on('consumable_buffs_updated', (data) => {
            // Buffs updated - next hover will show updated values
            this.emit('buffs_updated', data);
        });

        // Handle house_rooms_updated (when user upgrades house rooms)
        this.webSocketHook.on('house_rooms_updated', (data) => {
            // Update house room map with new levels
            if (data.characterHouseRoomMap) {
                this.updateHouseRoomMap(data.characterHouseRoomMap);
            }

            this.emit('house_rooms_updated', data);
        });

        // Handle skills_updated (when user gains skill levels)
        this.webSocketHook.on('skills_updated', (data) => {
            // Update character skills with new levels
            if (data.characterSkills) {
                this.characterSkills = data.characterSkills;
            }

            this.emit('skills_updated', data);
        });

        // Handle new_battle (combat start - for Combat Sim export on Steam)
        this.webSocketHook.on('new_battle', (data) => {
            // Store battle data (includes party consumables)
            this.battleData = data;
        });
    }

    /**
     * Update equipment map from character items
     * @param {Array} items - Character items array
     */
    updateEquipmentMap(items) {
        for (const item of items) {
            if (item.itemLocationHrid !== '/item_locations/inventory') {
                if (item.count === 0) {
                    this.characterEquipment.delete(item.itemLocationHrid);
                } else {
                    this.characterEquipment.set(item.itemLocationHrid, item);
                }
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
     * Get player's equipped items
     * @returns {Map} Equipment map (slot HRID -> item)
     */
    getEquipment() {
        return new Map(this.characterEquipment);
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
     * Get zone sortIndex for a monster (for task sorting)
     * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/rat")
     * @returns {number} Zone sortIndex (999 if not found)
     */
    getMonsterSortIndex(monsterHrid) {
        return this.monsterSortIndexMap.get(monsterHrid) || 999;
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
        this.eventListeners.get(event).push(callback);
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
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        const listeners = this.eventListeners.get(event) || [];
        for (const listener of listeners) {
            try {
                listener(data);
            } catch (error) {
                console.error(`[Data Manager] Error in ${event} listener:`, error);
            }
        }
    }
}

// Create and export singleton instance
const dataManager = new DataManager();

export default dataManager;
