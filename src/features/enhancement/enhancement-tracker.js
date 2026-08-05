/**
 * Enhancement Tracker
 * Main tracker class for monitoring enhancement attempts, costs, and statistics
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import {
    createSession,
    recordSuccess,
    recordFailure,
    addMaterialCost,
    addCoinCost,
    addProtectionCost,
    finalizeSession,
    sessionMatches,
    canExtendSession,
    extendSession,
    validateSession,
    SessionState,
} from './enhancement-session.js';
import { loadEnhancementState, saveSessions, saveCurrentSessionId } from './enhancement-storage.js';
import { calculateEnhancementPredictions } from './enhancement-xp.js';

/**
 * EnhancementTracker class manages enhancement tracking sessions
 */
export class EnhancementTracker {
    constructor() {
        this.sessions = {}; // All sessions (keyed by session ID)
        this.currentSessionId = null; // Currently active session ID
        this.isInitialized = false;
        this.isInitializing = false;
        this.characterId = null;
        this.lifecycleGeneration = 0;
        this.pendingSessionStart = false; // Start new session on next action_completed regardless of currentCount
    }

    /**
     * Initialize enhancement tracker
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized || this.isInitializing) {
            return;
        }

        if (!config.getSetting('enhancementTracker')) {
            return;
        }

        const characterId = dataManager.getCurrentCharacterId();
        if (!characterId) {
            return;
        }

        const generation = ++this.lifecycleGeneration;
        this.isInitializing = true;

        try {
            const { sessions: loadedSessions, currentSessionId: loadedCurrentSessionId } =
                await loadEnhancementState(characterId);

            if (
                generation !== this.lifecycleGeneration ||
                dataManager.getCurrentCharacterId() !== characterId ||
                dataManager.getIsCharacterSwitching?.()
            ) {
                return;
            }

            const sessions = { ...loadedSessions };
            for (const [sessionId, session] of Object.entries(sessions)) {
                if (!validateSession(session)) {
                    delete sessions[sessionId];
                }
            }

            const currentSessionId =
                loadedCurrentSessionId && sessions[loadedCurrentSessionId] ? loadedCurrentSessionId : null;

            this.sessions = sessions;
            this.currentSessionId = currentSessionId;
            this.characterId = characterId;
            this.isInitialized = true;

            if (loadedCurrentSessionId && !currentSessionId) {
                await saveCurrentSessionId(null, characterId);
            }
        } catch (error) {
            console.error('[EnhancementTracker] Failed to initialize:', error);
        } finally {
            if (generation === this.lifecycleGeneration) {
                this.isInitializing = false;
            }
        }
    }

    /**
     * Capture the active character lifecycle and session collection for an async write.
     * @returns {{characterId: string, generation: number, sessions: Object}|null} Persistence context
     * @private
     */
    _captureContext() {
        if (!this.isInitialized || !this.characterId) {
            return null;
        }

        return {
            characterId: this.characterId,
            generation: this.lifecycleGeneration,
            sessions: this.sessions,
        };
    }

    /**
     * Start a new enhancement session
     * @param {string} itemHrid - Item HRID being enhanced
     * @param {number} startLevel - Starting enhancement level
     * @param {number} targetLevel - Target enhancement level
     * @param {number} protectFrom - Level to start using protection (0 = never)
     * @returns {Promise<string>} New session ID
     */
    async startSession(itemHrid, startLevel, targetLevel, protectFrom = 0) {
        const context = this._captureContext();
        if (!context) {
            return null;
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            throw new Error('Game data not available');
        }

        // Get item name
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) {
            throw new Error(`Item not found: ${itemHrid}`);
        }

        const itemName = itemDetails.name;

        // Create new session
        const session = createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom);

        // Calculate predictions
        const predictions = calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom);
        session.predictions = predictions;

        // Store session
        context.sessions[session.id] = session;
        this.currentSessionId = session.id;

        // Save to storage
        await Promise.all([
            saveSessions(context.sessions, context.characterId),
            saveCurrentSessionId(session.id, context.characterId),
        ]);

        return session.id;
    }

    /**
     * Find a matching previous session that can be resumed
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @param {number} targetLevel - Target level
     * @param {number} protectFrom - Protection level
     * @returns {string|null} Session ID if found, null otherwise
     */
    findMatchingSession(itemHrid, currentLevel, targetLevel, protectFrom = 0) {
        for (const [sessionId, session] of Object.entries(this.sessions)) {
            if (sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom)) {
                return sessionId;
            }
        }

        return null;
    }

    /**
     * Resume an existing session
     * @param {string} sessionId - Session ID to resume
     * @returns {Promise<boolean>} True if resumed successfully
     */
    async resumeSession(sessionId) {
        const context = this._captureContext();
        if (!context || !context.sessions[sessionId]) {
            return false;
        }

        const session = context.sessions[sessionId];

        // Can only resume tracking sessions
        if (session.state !== SessionState.TRACKING) {
            return false;
        }

        this.currentSessionId = sessionId;
        await saveCurrentSessionId(sessionId, context.characterId);

        return true;
    }

    /**
     * Find a completed session that can be extended
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @returns {string|null} Session ID if found, null otherwise
     */
    findExtendableSession(itemHrid, currentLevel) {
        for (const [sessionId, session] of Object.entries(this.sessions)) {
            if (canExtendSession(session, itemHrid, currentLevel)) {
                return sessionId;
            }
        }

        return null;
    }

    /**
     * Extend a completed session to a new target level
     * @param {string} sessionId - Session ID to extend
     * @param {number} newTargetLevel - New target level
     * @returns {Promise<boolean>} True if extended successfully
     */
    async extendSessionTarget(sessionId, newTargetLevel) {
        const context = this._captureContext();
        if (!context || !context.sessions[sessionId]) {
            return false;
        }

        const session = context.sessions[sessionId];

        // Can only extend completed sessions
        if (session.state !== SessionState.COMPLETED) {
            return false;
        }

        extendSession(session, newTargetLevel);
        this.currentSessionId = sessionId;

        // Recalculate predictions for the new target level
        const predictions = calculateEnhancementPredictions(
            session.itemHrid,
            session.currentLevel,
            newTargetLevel,
            session.protectFrom
        );
        if (predictions) {
            session.predictions = predictions;
        }

        await Promise.all([
            saveSessions(context.sessions, context.characterId),
            saveCurrentSessionId(sessionId, context.characterId),
        ]);

        return true;
    }

    /**
     * Get current active session
     * @returns {Object|null} Current session or null
     */
    getCurrentSession() {
        if (!this.currentSessionId) return null;
        return this.sessions[this.currentSessionId] || null;
    }

    /**
     * Finalize current session (mark as completed)
     * @returns {Promise<void>}
     */
    async finalizeCurrentSession() {
        const context = this._captureContext();
        if (!context) {
            return;
        }

        const session = context.sessions[this.currentSessionId];
        if (!session) {
            return;
        }

        finalizeSession(session);
        this.currentSessionId = null;
        await Promise.all([
            saveSessions(context.sessions, context.characterId),
            saveCurrentSessionId(null, context.characterId),
        ]);
    }

    /**
     * Record a successful enhancement attempt
     * @param {number} previousLevel - Level before success
     * @param {number} newLevel - New level after success
     * @returns {Promise<void>}
     */
    async recordSuccess(previousLevel, newLevel) {
        const context = this._captureContext();
        if (!context) {
            return;
        }

        const session = context.sessions[this.currentSessionId];
        if (!session) {
            return;
        }

        recordSuccess(session, previousLevel, newLevel);

        // Check if target reached
        if (session.state === SessionState.COMPLETED) {
            this.currentSessionId = null;
        }

        if (session.state === SessionState.COMPLETED) {
            await Promise.all([
                saveSessions(context.sessions, context.characterId),
                saveCurrentSessionId(null, context.characterId),
            ]);
        } else {
            await saveSessions(context.sessions, context.characterId);
        }
    }

    /**
     * Record a failed enhancement attempt
     * @param {number} previousLevel - Level that failed
     * @param {number} newLevel - Actual level after failure
     * @returns {Promise<void>}
     */
    async recordFailure(previousLevel, newLevel) {
        const context = this._captureContext();
        if (!context) {
            return;
        }

        const session = context.sessions[this.currentSessionId];
        if (!session) {
            return;
        }

        recordFailure(session, previousLevel, newLevel);
        await saveSessions(context.sessions, context.characterId);
    }

    /**
     * Track material costs for current session
     * @param {string} itemHrid - Material item HRID
     * @param {number} count - Quantity used
     * @returns {Promise<void>}
     */
    async trackMaterialCost(itemHrid, count) {
        const context = this._captureContext();
        if (!context) return;

        const session = context.sessions[this.currentSessionId];
        if (!session) return;

        // Get market price
        const priceData = marketAPI.getPrice(itemHrid, 0);
        const unitCost = priceData ? priceData.ask || priceData.bid || 0 : 0;

        addMaterialCost(session, itemHrid, count, unitCost);
        await saveSessions(context.sessions, context.characterId);
    }

    /**
     * Track coin cost for current session
     * @param {number} amount - Coin amount spent
     * @returns {Promise<void>}
     */
    async trackCoinCost(amount) {
        const context = this._captureContext();
        if (!context) return;

        const session = context.sessions[this.currentSessionId];
        if (!session) return;

        addCoinCost(session, amount);
        await saveSessions(context.sessions, context.characterId);
    }

    /**
     * Track protection item cost for current session
     * @param {string} protectionItemHrid - Protection item HRID
     * @param {number} cost - Protection item cost
     * @returns {Promise<void>}
     */
    async trackProtectionCost(protectionItemHrid, cost) {
        const context = this._captureContext();
        if (!context) return;

        const session = context.sessions[this.currentSessionId];
        if (!session) return;

        addProtectionCost(session, protectionItemHrid, cost);
        await saveSessions(context.sessions, context.characterId);
    }

    /**
     * Get all sessions
     * @returns {Object} All sessions
     */
    getAllSessions() {
        return this.sessions;
    }

    /**
     * Get session by ID
     * @param {string} sessionId - Session ID
     * @returns {Object|null} Session or null
     */
    getSession(sessionId) {
        return this.sessions[sessionId] || null;
    }

    /**
     * Save sessions to storage (can be called directly)
     * @returns {Promise<void>}
     */
    async saveSessions() {
        const context = this._captureContext();
        if (!context) return;

        await saveSessions(context.sessions, context.characterId);
    }

    /**
     * Set flag so the next action_completed starts a new session regardless of currentCount.
     * Used when the tracker is cleared mid-session or when a new action queue is detected.
     */
    setPendingStart() {
        this.pendingSessionStart = true;
    }

    /**
     * Clear all sessions and flag that the next attempt should start a new session.
     * @returns {Promise<void>}
     */
    async clearSessions() {
        const context = this._captureContext();
        if (!context) return;

        const clearedSessions = {};
        this.sessions = clearedSessions;
        this.currentSessionId = null;
        this.pendingSessionStart = true;
        await Promise.all([
            saveSessions(clearedSessions, context.characterId),
            saveCurrentSessionId(null, context.characterId),
        ]);
    }

    /**
     * Disable and cleanup
     */
    disable() {
        this.lifecycleGeneration += 1;

        // Clear in-memory session data (will be reloaded from storage on next init)
        this.sessions = {};
        this.currentSessionId = null;
        this.isInitialized = false;
        this.isInitializing = false;
        this.characterId = null;
        this.pendingSessionStart = false;
    }
}

const enhancementTracker = new EnhancementTracker();

export default enhancementTracker;
