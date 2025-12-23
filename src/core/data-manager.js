/**
 * Data Manager Module
 * Central hub for accessing game data
 *
 * Uses official API: localStorageUtil.getInitClientData()
 * Listens to WebSocket messages for player data updates
 */

import webSocketHook from './websocket.js';

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
        this.characterEquipment = new Map();
        this.characterHouseRooms = new Map();  // House room HRID -> {houseRoomHrid, level}
        this.actionTypeDrinkSlotsMap = new Map();  // Action type HRID -> array of drink items

        // Event listeners
        this.eventListeners = new Map();

        // Setup WebSocket message handlers
        this.setupMessageHandlers();
    }

    /**
     * Initialize the Data Manager
     * Call this after game loads
     */
    initialize() {
        // Load static game data using official API
        try {
            if (typeof localStorageUtil !== 'undefined') {
                this.initClientData = localStorageUtil.getInitClientData();
            } else {
                console.warn('[Data Manager] localStorageUtil not available yet');
            }
        } catch (error) {
            console.error('[Data Manager] Failed to load init_client_data:', error);
        }
    }

    /**
     * Setup WebSocket message handlers
     * Listens for game data updates
     */
    setupMessageHandlers() {
        // Handle init_character_data (player data on login/refresh)
        this.webSocketHook.on('init_character_data', (data) => {
            this.characterData = data;
            this.characterSkills = data.characterSkills;
            this.characterItems = data.characterItems;
            this.characterActions = [...data.characterActions];

            // Build equipment map
            this.updateEquipmentMap(data.characterItems);

            // Build house room map
            this.updateHouseRoomMap(data.characterHouseRoomMap);

            // Build drink slots map (tea buffs)
            this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

            this.emit('character_initialized', data);
        });

        // Handle actions_updated (action queue changes)
        this.webSocketHook.on('actions_updated', (data) => {
            // Update action list
            for (const action of data.endCharacterActions) {
                if (action.isDone === false) {
                    this.characterActions.push(action);
                } else {
                    this.characterActions = this.characterActions.filter(a => a.id !== action.id);
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

            this.emit('action_completed', data);
        });

        // Handle items_updated (inventory/equipment changes)
        this.webSocketHook.on('items_updated', (data) => {
            if (data.endCharacterItems) {
                this.updateEquipmentMap(data.endCharacterItems);
            }

            this.emit('items_updated', data);
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
    }

    /**
     * Update equipment map from character items
     * @param {Array} items - Character items array
     */
    updateEquipmentMap(items) {
        for (const item of items) {
            if (item.itemLocationHrid !== "/item_locations/inventory") {
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
        for (const [hrid, room] of Object.entries(houseRoomMap)) {
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
     * Get community buff level
     * @param {string} buffTypeHrid - Buff type HRID (e.g., "/community_buff_types/production_efficiency")
     * @returns {number} Buff level (0 if not active)
     */
    getCommunityBuffLevel(buffTypeHrid) {
        if (!this.characterData?.communityBuffs) {
            return 0;
        }

        const buff = this.characterData.communityBuffs.find(b => b.hrid === buffTypeHrid);
        return buff?.level || 0;
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
