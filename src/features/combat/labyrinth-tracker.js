/**
 * Labyrinth Tracker
 * Detects cleared combat rooms via WebSocket events and records per-monster best recommendedLevel
 */

import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';

const STORAGE_KEY_PREFIX = 'monsterBestLevels';
const STORE_NAME = 'labyrinth';
/**
 * Get character-scoped storage key for labyrinth best levels.
 * @returns {string}
 */
function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

const COMBAT_ROOM_TYPE = '/labyrinth_room_types/combat';
const SKILLING_ROOM_TYPE = '/labyrinth_room_types/skilling';

class LabyrinthTracker {
    constructor() {
        this.prevRoomData = null;
        this.monsterBestLevels = {};
        this.handlers = {};
        this.isInitialized = false;
        this.updateListeners = [];
    }

    /**
     * Initialize labyrinth tracker
     */
    async initialize() {
        if (!config.getSetting('labyrinthTracker')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        await this.loadData();

        this.handlers.labyrinthUpdated = (data) => this.onLabyrinthUpdated(data);
        webSocketHook.on('labyrinth_updated', this.handlers.labyrinthUpdated);

        this.isInitialized = true;
        console.log('[LabyrinthTracker] Initialized');
    }

    /**
     * Disable and clean up
     */
    disable() {
        if (this.handlers.labyrinthUpdated) {
            webSocketHook.off('labyrinth_updated', this.handlers.labyrinthUpdated);
            this.handlers.labyrinthUpdated = null;
        }

        this.prevRoomData = null;
        this.updateListeners = [];
        this.isInitialized = false;
    }

    /**
     * Handle labyrinth_updated WebSocket event
     * @param {Object} data - WS message payload
     */
    onLabyrinthUpdated(data) {
        const roomData = data.labyrinth?.roomData;

        if (!roomData) {
            return;
        }

        if (this.prevRoomData) {
            this.diffRooms(this.prevRoomData, roomData);
        }

        // Deep-copy to snapshot current state
        this.prevRoomData = roomData.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
    }

    /**
     * Compare previous and current room grids to find newly cleared rooms
     * @param {Array} prevRooms - Previous room grid snapshot
     * @param {Array} currRooms - Current room grid
     */
    diffRooms(prevRooms, currRooms) {
        for (let row = 0; row < currRooms.length; row++) {
            for (let col = 0; col < currRooms[row].length; col++) {
                const prev = prevRooms[row]?.[col];
                const curr = currRooms[row][col];

                if (!prev || !curr) {
                    continue;
                }

                const wasTrackable =
                    (prev.roomType === COMBAT_ROOM_TYPE || prev.roomType === SKILLING_ROOM_TYPE) && !prev.isCleared;
                const isNowCleared = curr.isCleared === true;
                // Shrouded rooms go straight to cleared without entryCount;
                // naturally cleared rooms always had entryCount set first
                const wasEntered = prev.entryCount > 0;

                if (wasTrackable && isNowCleared && wasEntered) {
                    this.recordClear(prev);
                }
            }
        }
    }

    /**
     * Record a room clear, updating best level if this is a new record
     * @param {Object} room - Pre-clear room data
     */
    recordClear(room) {
        const hrid = room.monsterHrid || room.skillHrid || room.combatZoneHrid || room.enemyHrid || null;

        if (!hrid) {
            console.warn('[LabyrinthTracker] Could not determine HRID from room:', room);
            return;
        }

        let recommendedLevel = room.recommendedLevel;
        if (recommendedLevel == null) {
            const clientData = dataManager.getInitClientData();
            const details = clientData?.combatMonsterDetailMap?.[hrid] || clientData?.skillDetailMap?.[hrid];
            recommendedLevel = details?.recommendedLevel;
        }

        if (recommendedLevel == null) {
            console.warn('[LabyrinthTracker] Could not determine recommendedLevel for', hrid);
            return;
        }

        const level = Number(recommendedLevel);
        const existing = this.monsterBestLevels[hrid];

        if (!existing || level > existing.bestLevel) {
            const clientData = dataManager.getInitClientData();
            const details = clientData?.combatMonsterDetailMap?.[hrid] || clientData?.skillDetailMap?.[hrid];
            const name = details?.name || hrid;

            this.monsterBestLevels[hrid] = { name, bestLevel: level };
            this.saveData();
            this.notifyListeners();
        }
    }

    /**
     * Load stored best levels from IndexedDB
     */
    async loadData() {
        try {
            const data = await storage.getJSON(getStorageKey(), STORE_NAME, {});
            this.monsterBestLevels = data || {};
        } catch (error) {
            console.error('[LabyrinthTracker] Failed to load data:', error);
            this.monsterBestLevels = {};
        }
    }

    /**
     * Save best levels to IndexedDB
     */
    async saveData() {
        try {
            await storage.setJSON(getStorageKey(), this.monsterBestLevels, STORE_NAME, true);
        } catch (error) {
            console.error('[LabyrinthTracker] Failed to save data:', error);
        }
    }

    /**
     * Get the best level recorded for a monster
     * @param {string} monsterHrid - Monster HRID
     * @returns {number|null} Best level or null
     */
    getBestLevel(monsterHrid) {
        return this.monsterBestLevels[monsterHrid]?.bestLevel ?? null;
    }

    /**
     * Subscribe to update events (called when a new best is recorded)
     * @param {Function} cb - Callback function
     */
    onUpdate(cb) {
        if (!this.updateListeners.includes(cb)) {
            this.updateListeners.push(cb);
        }
    }

    /**
     * Unsubscribe from update events
     * @param {Function} cb - Callback function
     */
    offUpdate(cb) {
        this.updateListeners = this.updateListeners.filter((l) => l !== cb);
    }

    /**
     * Notify all update subscribers
     */
    notifyListeners() {
        for (const cb of this.updateListeners) {
            try {
                cb();
            } catch (error) {
                console.error('[LabyrinthTracker] Error in update listener:', error);
            }
        }
    }
}

const labyrinthTracker = new LabyrinthTracker();
export default labyrinthTracker;
