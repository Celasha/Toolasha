/**
 * Coinify History Tracker
 * Records coinify sessions via WebSocket and persists to IndexedDB.
 *
 * Session lifecycle:
 * - Start: actions_updated with actionHrid === '/actions/alchemy/coinify'
 * - Result: action_completed with same actionHrid
 * - End: actions_updated with no coinify action, or different input item/enhancement level
 *
 * Result detection:
 * - Success: endCharacterItems contains a coin item (presence indicates success)
 * - Failure: no coin output in endCharacterItems
 *
 * Coins earned per success: itemDetails.sellPrice * 5 * bulkMultiplier
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';

const COINIFY_ACTION_HRID = '/actions/alchemy/coinify';
const COIN_ITEM_HRID = '/items/coin';
const CATALYST_OF_COINIFICATION_HRID = '/items/catalyst_of_coinification';
const PRIME_CATALYST_HRID = '/items/prime_catalyst';
const STORAGE_KEY = 'coinifySessions';
const STORAGE_STORE = 'alchemyHistory';

class CoinifyHistoryTracker {
    constructor() {
        this.isInitialized = false;
        this.activeSession = null; // Current in-progress session object
        this.handlers = {
            actionsUpdated: (data) => this.handleActionsUpdated(data),
            actionCompleted: (data) => this.handleActionCompleted(data),
            initCharacterData: () => this.handleReconnect(),
        };
    }

    /**
     * Initialize the tracker
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('alchemy_coinifyHistory')) {
            return;
        }

        this.isInitialized = true;

        webSocketHook.on('actions_updated', this.handlers.actionsUpdated);
        webSocketHook.on('action_completed', this.handlers.actionCompleted);
        webSocketHook.on('init_character_data', this.handlers.initCharacterData);
    }

    /**
     * Disable the tracker
     */
    disable() {
        webSocketHook.off('actions_updated', this.handlers.actionsUpdated);
        webSocketHook.off('action_completed', this.handlers.actionCompleted);
        webSocketHook.off('init_character_data', this.handlers.initCharacterData);

        if (this.activeSession) {
            this.endSession();
        }

        this.isInitialized = false;
    }

    /**
     * Handle actions_updated — detect session start or end
     * @param {Object} data - WebSocket message data
     */
    async handleActionsUpdated(data) {
        const actions = data.endCharacterActions || [];
        const coinifyAction = actions.find((a) => a.actionHrid === COINIFY_ACTION_HRID);

        if (coinifyAction) {
            const inputItemHrid = this.extractItemHrid(coinifyAction.primaryItemHash);
            const enhancementLevel = this.extractEnhancementLevel(coinifyAction.primaryItemHash);

            if (!inputItemHrid) {
                return;
            }

            if (!this.activeSession) {
                // No active session — start one
                await this.startSession(inputItemHrid, enhancementLevel, Date.now());
            } else if (
                this.activeSession.inputItemHrid !== inputItemHrid ||
                this.activeSession.enhancementLevel !== enhancementLevel
            ) {
                // Different item or enhancement level — end current session and start new one
                await this.endSession();
                await this.startSession(inputItemHrid, enhancementLevel, Date.now());
            }
            // Same item and level and active session — nothing to do
        } else if (this.activeSession) {
            // No coinify action in the update — end any active session
            await this.endSession();
        }
    }

    /**
     * Handle action_completed — record one attempt result
     * @param {Object} data - WebSocket message data
     */
    async handleActionCompleted(data) {
        const action = data.endCharacterAction;
        if (!action || action.actionHrid !== COINIFY_ACTION_HRID) {
            return;
        }

        const inputItemHrid = this.extractItemHrid(action.primaryItemHash);
        const enhancementLevel = this.extractEnhancementLevel(action.primaryItemHash);

        if (!inputItemHrid) {
            return;
        }

        // Ensure we have an active session for this item and level
        if (
            !this.activeSession ||
            this.activeSession.inputItemHrid !== inputItemHrid ||
            this.activeSession.enhancementLevel !== enhancementLevel
        ) {
            await this.startSession(inputItemHrid, enhancementLevel, Date.now());
        }

        // Count successes by number of coin entries (supports efficiency procs)
        const coinEntries = (data.endCharacterItems || []).filter((item) => item.itemHrid === COIN_ITEM_HRID);
        const successCount = coinEntries.length;

        this.activeSession.totalAttempts += Math.max(successCount, 1);

        if (successCount > 0) {
            this.activeSession.totalSuccesses += successCount;
            this.activeSession.totalCoinsEarned += this.activeSession.coinsPerSuccess * successCount;
        }

        // Track catalyst usage — catalysts are only consumed on success
        const secondaryHrid = this.extractItemHrid(action.secondaryItemHash);
        if (secondaryHrid === CATALYST_OF_COINIFICATION_HRID) {
            this.activeSession.catalystOfCoinificationUsed += successCount;
        } else if (secondaryHrid === PRIME_CATALYST_HRID) {
            this.activeSession.primeCatalystUsed += successCount;
        }

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
     * Start a new session
     * @param {string} inputItemHrid - Input item HRID
     * @param {number} enhancementLevel - Enhancement level of input item
     * @param {number} timestamp - Start timestamp in ms
     */
    async startSession(inputItemHrid, enhancementLevel, timestamp) {
        const itemDetails = dataManager.getItemDetails(inputItemHrid);

        const bulkMultiplier = itemDetails?.alchemyDetail?.bulkMultiplier ?? 1;
        const coinsPerSuccess = (itemDetails?.sellPrice || 0) * 5 * bulkMultiplier;

        this.activeSession = {
            id: `coinify_${timestamp}`,
            startTime: timestamp,
            inputItemHrid,
            enhancementLevel,
            totalAttempts: 0,
            totalSuccesses: 0,
            totalCoinsEarned: 0,
            catalystOfCoinificationUsed: 0,
            primeCatalystUsed: 0,
            coinsPerSuccess,
            bulkMultiplier,
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

            await storage.setJSON(STORAGE_KEY, sessions, STORAGE_STORE, true);
        } catch (error) {
            console.error('[CoinifyHistoryTracker] Failed to save session:', error);
        }
    }

    /**
     * Load all sessions from storage
     * @returns {Promise<Array>} Array of session objects
     */
    async loadSessions() {
        try {
            return await storage.getJSON(STORAGE_KEY, STORAGE_STORE, []);
        } catch (error) {
            console.error('[CoinifyHistoryTracker] Failed to load sessions:', error);
            return [];
        }
    }

    /**
     * Clear all history from storage
     */
    async clearHistory() {
        try {
            this.activeSession = null;
            await storage.setJSON(STORAGE_KEY, [], STORAGE_STORE, true);
        } catch (error) {
            console.error('[CoinifyHistoryTracker] Failed to clear history:', error);
        }
    }

    /**
     * Persist a caller-supplied sessions array (used by viewer for single-row delete)
     * @param {Array} sessions - Updated sessions array to persist
     */
    async deleteSessions(sessions) {
        try {
            await storage.setJSON(STORAGE_KEY, sessions, STORAGE_STORE, true);
        } catch (error) {
            console.error('[CoinifyHistoryTracker] Failed to save sessions after delete:', error);
        }
    }

    /**
     * Extract item HRID from a primaryItemHash string
     * Format: "characterId::/item_locations/inventory::/items/item_name::N"
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
     * Extract enhancement level from a primaryItemHash string
     * The level is the last segment after :: if it is a non-negative integer
     * @param {string} hash - Primary item hash
     * @returns {number} Enhancement level (0 if not present or not a number)
     */
    extractEnhancementLevel(hash) {
        if (!hash) {
            return 0;
        }

        const parts = hash.split('::');
        const last = parts[parts.length - 1];

        if (last && !last.startsWith('/')) {
            const parsed = parseInt(last, 10);
            if (!isNaN(parsed) && parsed >= 0) {
                return parsed;
            }
        }

        return 0;
    }
}

const coinifyHistoryTracker = new CoinifyHistoryTracker();

export { coinifyHistoryTracker };

export default {
    name: 'Coinify History Tracker',
    initialize: () => coinifyHistoryTracker.initialize(),
    cleanup: () => coinifyHistoryTracker.disable(),
};
