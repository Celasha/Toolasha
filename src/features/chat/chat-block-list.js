/**
 * Chat Block List
 * Maintains an in-memory set of blocked player names sourced from the game's
 * blockedCharacterMap, kept current via init_character_data and
 * character_blocks_updated WebSocket events.
 *
 * Used by pop-out-chat.js to filter blocked messages before buffering or relay.
 */

import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';

class ChatBlockList {
    constructor() {
        this.isInitialized = false;
        this.blockedNames = new Set();
        this.handlers = {
            initCharacterData: (data) => this._syncFromMap(data?.blockedCharacterMap),
            blocksUpdated: (data) => this._syncFromMap(data?.blockedCharacterMap),
        };
    }

    /**
     * Initialize the block list — seed from current character data, then register WS listeners.
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Seed from already-received init_character_data (the WS event fires before features initialize)
        this._syncFromMap(dataManager.getBlockedCharacterMap());

        webSocketHook.on('init_character_data', this.handlers.initCharacterData);
        webSocketHook.on('character_blocks_updated', this.handlers.blocksUpdated);
    }

    /**
     * Disable the block list — unregister WS listeners and clear state.
     */
    disable() {
        webSocketHook.off('init_character_data', this.handlers.initCharacterData);
        webSocketHook.off('character_blocks_updated', this.handlers.blocksUpdated);

        this.blockedNames.clear();
        this.isInitialized = false;
    }

    /**
     * Check if a player name is blocked.
     * @param {string} name - Player name to check
     * @returns {boolean}
     */
    isBlocked(name) {
        if (!name) {
            return false;
        }

        return this.blockedNames.has(name.toLowerCase());
    }

    /**
     * Replace the in-memory blocked names set from a blockedCharacterMap object.
     * @param {Object|null|undefined} map - { [characterId]: name } map from WS
     * @private
     */
    _syncFromMap(map) {
        this.blockedNames = new Set(Object.values(map || {}).map((n) => n.toLowerCase()));
    }
}

const chatBlockList = new ChatBlockList();

export { chatBlockList };

export default {
    name: 'Chat Block List',
    initialize: () => chatBlockList.initialize(),
    cleanup: () => chatBlockList.disable(),
};
