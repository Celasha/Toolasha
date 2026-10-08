/**
 * Decompose History Tracker
 * Records decompose sessions via WebSocket and persists to IndexedDB.
 *
 * Session lifecycle:
 * - Start: actions_updated with actionHrid === '/actions/alchemy/decompose'
 * - Result: action_completed with same actionHrid
 * - End: actions_updated with no decompose action, or different input item/enhancement level
 *
 * Result detection:
 * - Success: endCharacterItems contains items listed in the input item's decomposeItems
 * - Failure: no items from decomposeItems appear in endCharacterItems
 * - Incidental drops (essences, artisan's crates) are excluded
 *   because they are not listed in the input item's decomposeItems
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import { getItemPriceOutlierInfo } from '../../utils/market-data.js';

const DECOMPOSE_ACTION_HRID = '/actions/alchemy/decompose';
const CATALYST_OF_DECOMPOSITION_HRID = '/items/catalyst_of_decomposition';
const PRIME_CATALYST_HRID = '/items/prime_catalyst';
const COIN_ITEM_HRID = '/items/coin';
const STORAGE_KEY = 'decomposeSessions';
const STORAGE_STORE = 'alchemyHistory';

class DecomposeHistoryTracker {
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

        if (!config.getSetting('alchemy_decomposeHistory')) {
            return;
        }

        this.isInitialized = true;
        this.characterId = dataManager.getCurrentCharacterId();

        webSocketHook.on('actions_updated', this.handlers.actionsUpdated);
        webSocketHook.on('action_completed', this.handlers.actionCompleted);
        webSocketHook.on('init_character_data', this.handlers.initCharacterData);
        dataManager.on('character_switched', this.handlers.characterSwitched);

        this.pruneEmptySessions();
    }

    /**
     * One-time cleanup of 0-attempt sessions persisted by a prior bug
     * (queue reorders were mistaken for action changes, creating empty session rows)
     */
    async pruneEmptySessions() {
        try {
            const sessions = await this.loadSessions();
            const pruned = sessions.filter((s) => s.totalAttempts > 0);
            if (pruned.length !== sessions.length) {
                await storage.setJSON(this.getStorageKey(), pruned, STORAGE_STORE, true);
            }
        } catch (error) {
            console.error('[DecomposeHistoryTracker] Failed to prune empty sessions:', error);
        }
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
        // Queue reordering can reshuffle array order without anything actually starting —
        // only the lowest-ordinal match is the active/front action.
        const decomposeAction = actions
            .filter((a) => a.actionHrid === DECOMPOSE_ACTION_HRID)
            .reduce((front, a) => (!front || a.ordinal < front.ordinal ? a : front), null);

        if (decomposeAction) {
            const inputItemHrid = this.extractItemHrid(decomposeAction.primaryItemHash);
            const enhancementLevel = this.extractEnhancementLevel(decomposeAction.primaryItemHash);

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
            // No decompose action in the update — end any active session
            await this.endSession();
        }
    }

    /**
     * Handle action_completed — record one attempt result
     * @param {Object} data - WebSocket message data
     */
    async handleActionCompleted(data) {
        const action = data.endCharacterAction;
        if (!action || action.actionHrid !== DECOMPOSE_ACTION_HRID) {
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

        const itemDetails = dataManager.getItemDetails(inputItemHrid);
        const bulkMultiplier = itemDetails?.alchemyDetail?.bulkMultiplier ?? 1;

        // Build a Set of valid output HRIDs from the input item's decompose items.
        // This filters out incidental drops (essences, artisan's crates).
        const decomposeItems = itemDetails?.alchemyDetail?.decomposeItems || [];
        const validOutputHrids = new Set(decomposeItems.map((entry) => entry.itemHrid));

        // Build a map of expected count per output for value calculation
        const expectedCountMap = {};
        for (const entry of decomposeItems) {
            expectedCountMap[entry.itemHrid] = entry.count || 1;
        }

        // Filter to only valid decompose outputs (exclude coins and incidentals)
        const validOutputItems = (data.endCharacterItems || []).filter(
            (item) => item.itemHrid !== COIN_ITEM_HRID && validOutputHrids.has(item.itemHrid)
        );

        // Decompose outputs: each unique output item entry represents one successful action.
        // Unlike transmute, there is no self-return — the input is always consumed.
        // Group by unique output sets to count successes correctly.
        // For efficiency procs, multiple entries of the same output item may appear.
        // Count distinct entries of any valid output as one success each.
        const successCount =
            validOutputItems.length > 0
                ? Math.max(
                      ...Array.from(new Set(validOutputItems.map((i) => i.itemHrid))).map(
                          (hrid) => validOutputItems.filter((i) => i.itemHrid === hrid).length
                      )
                  )
                : 0;

        // Derive actual attempt count from currentCount delta (handles batched efficiency procs)
        const currentCount = action.currentCount || 0;
        let attemptCount;
        if (this.lastCurrentCount !== null && currentCount > this.lastCurrentCount) {
            attemptCount = currentCount - this.lastCurrentCount;
        } else {
            attemptCount = Math.max(successCount, 1);
        }
        this.lastCurrentCount = currentCount;

        this.activeSession.totalAttempts += attemptCount;

        if (successCount > 0) {
            this.activeSession.totalSuccesses += successCount;

            for (const outputItem of validOutputItems) {
                const outputItemHrid = outputItem.itemHrid;
                const expectedCount = expectedCountMap[outputItemHrid] || 1;

                if (!this.activeSession.results[outputItemHrid]) {
                    this.activeSession.results[outputItemHrid] = {
                        count: 0,
                        totalValue: 0,
                        priceEach: 0,
                        isOutlier: false,
                    };
                }

                // Each entry represents bulkMultiplier × expectedCount items received
                this.activeSession.results[outputItemHrid].count += bulkMultiplier * expectedCount;

                // Record market price at time of result
                const { value: price, isOutlier } = getItemPriceOutlierInfo(outputItemHrid, {
                    context: 'profit',
                    side: 'sell',
                });
                this.activeSession.results[outputItemHrid].priceEach = price || 0;
                this.activeSession.results[outputItemHrid].isOutlier = isOutlier;
                this.activeSession.results[outputItemHrid].totalValue += (price || 0) * bulkMultiplier * expectedCount;
            }
        }

        // Track catalyst usage — catalysts are only consumed on success
        if (successCount > 0) {
            const secondaryHrid = this.extractItemHrid(action.secondaryItemHash);
            if (secondaryHrid === CATALYST_OF_DECOMPOSITION_HRID) {
                this.activeSession.catalystOfDecompositionUsed += successCount;
            } else if (secondaryHrid === PRIME_CATALYST_HRID) {
                this.activeSession.primeCatalystUsed += successCount;
            }
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
     * Handle character switch — update character ID and clear active session
     * @param {Object} data - { newId, newName }
     */
    async handleCharacterSwitched(data) {
        if (this.activeSession) {
            await this.endSession();
        }
        this.characterId = data.newId || null;
        await this.pruneEmptySessions();
    }

    /**
     * Start a new session
     * @param {string} inputItemHrid - Input item HRID
     * @param {number} enhancementLevel - Enhancement level of input item
     * @param {number} timestamp - Start timestamp in ms
     */
    async startSession(inputItemHrid, enhancementLevel, timestamp) {
        this.activeSession = {
            id: `decompose_${timestamp}`,
            startTime: timestamp,
            inputItemHrid,
            enhancementLevel,
            totalAttempts: 0,
            totalSuccesses: 0,
            catalystOfDecompositionUsed: 0,
            primeCatalystUsed: 0,
            results: {},
        };
        this.lastCurrentCount = null;
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
     * Save the active session to storage (upsert by id).
     * Skips persist if no attempts recorded yet (avoids empty sessions from queue changes).
     */
    async saveActiveSession() {
        if (!this.activeSession || this.activeSession.totalAttempts === 0) {
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
            console.error('[DecomposeHistoryTracker] Failed to save session:', error);
        }
    }

    /**
     * Load all sessions from storage
     * @returns {Promise<Array>} Array of session objects
     */
    async loadSessions() {
        try {
            return await storage.getJSON(this.getStorageKey(), STORAGE_STORE, []);
        } catch (error) {
            console.error('[DecomposeHistoryTracker] Failed to load sessions:', error);
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
            console.error('[DecomposeHistoryTracker] Failed to clear history:', error);
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
            console.error('[DecomposeHistoryTracker] Failed to save sessions after delete:', error);
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

const decomposeHistoryTracker = new DecomposeHistoryTracker();

export { decomposeHistoryTracker };

export default {
    name: 'Decompose History Tracker',
    initialize: () => decomposeHistoryTracker.initialize(),
    cleanup: () => decomposeHistoryTracker.disable(),
};
