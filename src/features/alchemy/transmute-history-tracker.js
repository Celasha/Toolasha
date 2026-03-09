/**
 * Transmute History Tracker
 * Records transmute sessions via WebSocket and persists to IndexedDB.
 *
 * Session lifecycle:
 * - Start: actions_updated with actionHrid === '/actions/alchemy/transmute'
 * - Result: action_completed with same actionHrid
 * - End: actions_updated with no transmute action, or different input item
 *
 * Result detection:
 * - Success: endCharacterItems contains a non-coin item different from inputItemHrid
 * - Failure: all non-coin items in endCharacterItems match inputItemHrid
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import { getItemPrice } from '../../utils/market-data.js';

const TRANSMUTE_ACTION_HRID = '/actions/alchemy/transmute';
const COIN_ITEM_HRID = '/items/coin';
const STORAGE_KEY = 'transmuteSessions';
const STORAGE_STORE = 'alchemyHistory';

class TransmuteHistoryTracker {
    constructor() {
        this.isInitialized = false;
        this.characterId = null;
        this.activeSession = null; // Current in-progress session object
        this.handlers = {
            actionsUpdated: (data) => this.handleActionsUpdated(data),
            actionCompleted: (data) => this.handleActionCompleted(data),
            initCharacterData: () => this.handleReconnect(),
            characterSwitched: (data) => this.handleCharacterSwitched(data),
        };
    }

    getStorageKey() {
        return this.characterId ? `${STORAGE_KEY}_${this.characterId}` : STORAGE_KEY;
    }

    /**
     * Initialize the tracker
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('alchemy_transmuteHistory')) {
            return;
        }

        this.isInitialized = true;
        this.characterId = dataManager.getCurrentCharacterId();

        webSocketHook.on('actions_updated', this.handlers.actionsUpdated);
        webSocketHook.on('action_completed', this.handlers.actionCompleted);
        webSocketHook.on('init_character_data', this.handlers.initCharacterData);
        dataManager.on('character_switched', this.handlers.characterSwitched);
    }

    /**
     * Disable the tracker
     */
    disable() {
        webSocketHook.off('actions_updated', this.handlers.actionsUpdated);
        webSocketHook.off('action_completed', this.handlers.actionCompleted);
        webSocketHook.off('init_character_data', this.handlers.initCharacterData);
        dataManager.off('character_switched', this.handlers.characterSwitched);

        if (this.activeSession) {
            this.endSession();
        }

        this.isInitialized = false;
        this.characterId = null;
    }

    /**
     * Handle actions_updated — detect session start or end
     * @param {Object} data - WebSocket message data
     */
    async handleActionsUpdated(data) {
        const actions = data.endCharacterActions || [];
        const transmuteAction = actions.find((a) => a.actionHrid === TRANSMUTE_ACTION_HRID);

        if (transmuteAction) {
            const inputItemHrid = this.extractItemHrid(transmuteAction.primaryItemHash);
            if (!inputItemHrid) {
                return;
            }

            if (!this.activeSession) {
                // No active session — start one
                await this.startSession(inputItemHrid, Date.now());
            } else if (this.activeSession.inputItemHrid !== inputItemHrid) {
                // Different item — end current session and start new one
                await this.endSession();
                await this.startSession(inputItemHrid, Date.now());
            }
            // Same item and active session — nothing to do (player restarted same action)
        } else if (this.activeSession) {
            // No transmute action in the update — end any active session
            await this.endSession();
        }
    }

    /**
     * Handle action_completed — record one attempt result
     * @param {Object} data - WebSocket message data
     */
    async handleActionCompleted(data) {
        const action = data.endCharacterAction;
        if (!action || action.actionHrid !== TRANSMUTE_ACTION_HRID) {
            return;
        }

        const inputItemHrid = this.extractItemHrid(action.primaryItemHash);
        if (!inputItemHrid) {
            return;
        }

        // Ensure we have an active session for this item
        if (!this.activeSession || this.activeSession.inputItemHrid !== inputItemHrid) {
            await this.startSession(inputItemHrid, Date.now());
        }

        // bulkMultiplier defines how many items are consumed and returned per action
        const itemDetailsForBulk = dataManager.getItemDetails(inputItemHrid);
        if (!itemDetailsForBulk?.alchemyDetail?.bulkMultiplier) {
            console.error(`[TransmuteHistoryTracker] Item has no alchemyDetail.bulkMultiplier: ${inputItemHrid}`);
        }
        const bulkMultiplier = itemDetailsForBulk?.alchemyDetail?.bulkMultiplier ?? 1;

        // Detect success vs failure — exclude incidental drops (essences, artisan's crates)
        const nonCoinItems = (data.endCharacterItems || []).filter((item) => item.itemHrid !== COIN_ITEM_HRID);

        // The game always sends one entry for the consumed input item.
        // If the input is also returned (self-return), it sends additional entries.
        // Only the extra entries (beyond the first consumed one) represent actual returns.
        const inputItemEntries = nonCoinItems.filter((item) => item.itemHrid === inputItemHrid);
        const inputReturned = inputItemEntries.length > 1;
        const selfReturnEntries = inputReturned ? inputItemEntries.slice(1) : [];

        // Other non-input outputs
        const otherOutputs = nonCoinItems.filter((item) => item.itemHrid !== inputItemHrid);

        // Collect all output items — the game sends one entry per action per output item,
        // so entry count correctly represents number of actions for that output.
        const outputItems = [...selfReturnEntries, ...otherOutputs];

        // Each entry corresponds to one successful action; failures produce no output.
        // Use the output count as the attempt count so efficiency procs are recorded accurately.
        // Fall back to 1 for a plain failure.
        this.activeSession.totalAttempts += Math.max(outputItems.length, 1);

        if (outputItems.length > 0) {
            this.activeSession.totalSuccesses += outputItems.length;

            for (const outputItem of outputItems) {
                const outputItemHrid = outputItem.itemHrid;
                const isOutputSelfReturn = outputItemHrid === inputItemHrid;

                if (!this.activeSession.results[outputItemHrid]) {
                    this.activeSession.results[outputItemHrid] = {
                        count: 0,
                        totalValue: 0,
                        priceEach: 0,
                        isSelfReturn: isOutputSelfReturn,
                    };
                }

                // Each entry represents bulkMultiplier items received
                this.activeSession.results[outputItemHrid].count += bulkMultiplier;

                // Record market price at time of result
                if (!isOutputSelfReturn) {
                    const price = getItemPrice(outputItemHrid, { context: 'profit', side: 'sell' }) || 0;
                    this.activeSession.results[outputItemHrid].priceEach = price;
                    this.activeSession.results[outputItemHrid].totalValue += price * bulkMultiplier;
                }
            }
        }
        // Failure — totalAttempts already incremented, nothing more to record

        await this.saveActiveSession();
    }

    /**
     * Handle reconnect — finalize any open session
     */
    async handleReconnect() {
        if (this.activeSession) {
            await this.endSession();
        }
    }

    /**
     * Handle character switch — update character ID and clear active session
     * @param {Object} data - { newId, newName }
     */
    async handleCharacterSwitched(data) {
        if (this.activeSession) {
            await this.endSession();
        }
        this.characterId = data.newId || null;
    }

    /**
     * Start a new session
     * @param {string} inputItemHrid - Input item HRID
     * @param {number} timestamp - Start timestamp in ms
     */
    async startSession(inputItemHrid, timestamp) {
        this.activeSession = {
            id: `transmute_${timestamp}`,
            startTime: timestamp,
            inputItemHrid,
            totalAttempts: 0,
            totalSuccesses: 0,
            results: {},
        };

        await this.saveActiveSession();
    }

    /**
     * End the active session
     */
    async endSession() {
        if (!this.activeSession) {
            return;
        }

        await this.saveActiveSession();
        this.activeSession = null;
    }

    /**
     * Save the active session to storage (upsert by id)
     */
    async saveActiveSession() {
        if (!this.activeSession) {
            return;
        }

        try {
            const sessions = await this.loadSessions();
            const index = sessions.findIndex((s) => s.id === this.activeSession.id);

            if (index !== -1) {
                sessions[index] = this.activeSession;
            } else {
                sessions.push(this.activeSession);
            }

            await storage.setJSON(this.getStorageKey(), sessions, STORAGE_STORE, true);
        } catch (error) {
            console.error('[TransmuteHistoryTracker] Failed to save session:', error);
        }
    }

    /**
     * Load all sessions from storage
     * @returns {Array} Array of session objects
     */
    async loadSessions() {
        try {
            return await storage.getJSON(this.getStorageKey(), STORAGE_STORE, []);
        } catch (error) {
            console.error('[TransmuteHistoryTracker] Failed to load sessions:', error);
            return [];
        }
    }

    /**
     * Clear all history from storage
     */
    async clearHistory() {
        try {
            this.activeSession = null;
            await storage.setJSON(this.getStorageKey(), [], STORAGE_STORE, true);
        } catch (error) {
            console.error('[TransmuteHistoryTracker] Failed to clear history:', error);
        }
    }

    /**
     * Persist a caller-supplied sessions array (used by viewer for single-row delete)
     * @param {Array} sessions - Updated sessions array to persist
     */
    async deleteSessions(sessions) {
        try {
            await storage.setJSON(this.getStorageKey(), sessions, STORAGE_STORE, true);
        } catch (error) {
            console.error('[TransmuteHistoryTracker] Failed to save sessions after delete:', error);
        }
    }

    /**
     * Extract item HRID from a primaryItemHash string
     * Format: "characterId::/item_locations/inventory::/items/item_name::0"
     * @param {string} hash - Primary item hash
     * @returns {string|null} Item HRID or null
     */
    extractItemHrid(hash) {
        if (!hash) {
            return null;
        }

        const parts = hash.split('::');
        if (parts.length < 3) {
            return null;
        }

        const hrid = parts[2];
        return hrid.startsWith('/items/') ? hrid : null;
    }

    /**
     * Get the item name from HRID via dataManager
     * @param {string} itemHrid - Item HRID
     * @returns {string} Item display name
     */
    getItemName(itemHrid) {
        const details = dataManager.getItemDetails(itemHrid);
        return details?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
    }
}

const transmuteHistoryTracker = new TransmuteHistoryTracker();

export { transmuteHistoryTracker };

export default {
    name: 'Transmute History Tracker',
    initialize: () => transmuteHistoryTracker.initialize(),
    cleanup: () => transmuteHistoryTracker.disable(),
};
