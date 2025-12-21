/**
 * Data Manager Module
 * Central hub for accessing game data
 *
 * Uses official API: localStorageUtil.getInitClientData()
 * Listens to WebSocket messages for player data updates
 */

class DataManager {
    constructor(webSocketHook) {
        this.webSocketHook = webSocketHook;

        // Static game data (items, actions, monsters, abilities, etc.)
        this.initClientData = null;

        // Player data (updated via WebSocket)
        this.characterData = null;
        this.characterSkills = null;
        this.characterItems = null;
        this.characterActions = [];
        this.characterEquipment = new Map();

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
        console.log('[Data Manager] Initializing...');

        // Load static game data using official API
        try {
            if (typeof localStorageUtil !== 'undefined') {
                this.initClientData = localStorageUtil.getInitClientData();
                console.log('[Data Manager] ✅ Loaded init_client_data via official API');
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
            console.log('[Data Manager] Received init_character_data');
            this.characterData = data;
            this.characterSkills = data.characterSkills;
            this.characterItems = data.characterItems;
            this.characterActions = [...data.characterActions];

            // Build equipment map
            this.updateEquipmentMap(data.characterItems);

            this.emit('character_initialized', data);
        });

        // Handle actions_updated (action queue changes)
        this.webSocketHook.on('actions_updated', (data) => {
            console.log('[Data Manager] Actions updated');

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
            console.log('[Data Manager] Items updated');

            if (data.endCharacterItems) {
                this.updateEquipmentMap(data.endCharacterItems);
            }

            this.emit('items_updated', data);
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

export default DataManager;
export { DataManager };
