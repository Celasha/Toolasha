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
    SessionState
} from './enhancement-session.js';
import {
    saveSessions,
    loadSessions,
    saveCurrentSessionId,
    loadCurrentSessionId
} from './enhancement-storage.js';

/**
 * EnhancementTracker class manages enhancement tracking sessions
 */
class EnhancementTracker {
    constructor() {
        this.sessions = {}; // All sessions (keyed by session ID)
        this.currentSessionId = null; // Currently active session ID
        this.isInitialized = false;
    }

    /**
     * Initialize enhancement tracker
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) {
            console.log('[Enhancement Tracker] Already initialized');
            return;
        }

        if (!config.getSetting('enhancementTracker')) {
            console.log('[Enhancement Tracker] Feature disabled in settings');
            return;
        }

        try {
            // Load sessions from storage
            this.sessions = await loadSessions();
            this.currentSessionId = await loadCurrentSessionId();

            // Validate current session still exists
            if (this.currentSessionId && !this.sessions[this.currentSessionId]) {
                console.warn('[Enhancement Tracker] Current session not found, clearing');
                this.currentSessionId = null;
                await saveCurrentSessionId(null);
            }

            // Validate all loaded sessions
            for (const [sessionId, session] of Object.entries(this.sessions)) {
                if (!validateSession(session)) {
                    console.warn('[Enhancement Tracker] Invalid session detected:', sessionId);
                    delete this.sessions[sessionId];
                }
            }

            this.isInitialized = true;
            console.log('[Enhancement Tracker] Initialized with', Object.keys(this.sessions).length, 'sessions');
            console.log('[Enhancement Tracker] Current session:', this.currentSessionId || 'none');
        } catch (error) {
            console.error('[Enhancement Tracker] Initialization failed:', error);
        }
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

        // Store session
        this.sessions[session.id] = session;
        this.currentSessionId = session.id;

        // Save to storage
        await saveSessions(this.sessions);
        await saveCurrentSessionId(session.id);

        console.log('[Enhancement Tracker] Started new session:', session.id);
        console.log('[Enhancement Tracker] Item:', itemName, 'Levels:', startLevel, '→', targetLevel);

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
                console.log('[Enhancement Tracker] Found matching session:', sessionId);
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
        if (!this.sessions[sessionId]) {
            console.warn('[Enhancement Tracker] Session not found:', sessionId);
            return false;
        }

        const session = this.sessions[sessionId];

        // Can only resume tracking sessions
        if (session.state !== SessionState.TRACKING) {
            console.warn('[Enhancement Tracker] Cannot resume non-tracking session:', session.state);
            return false;
        }

        this.currentSessionId = sessionId;
        await saveCurrentSessionId(sessionId);

        console.log('[Enhancement Tracker] Resumed session:', sessionId);
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
                console.log('[Enhancement Tracker] Found extendable session:', sessionId);
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
        if (!this.sessions[sessionId]) {
            console.warn('[Enhancement Tracker] Session not found:', sessionId);
            return false;
        }

        const session = this.sessions[sessionId];

        // Can only extend completed sessions
        if (session.state !== SessionState.COMPLETED) {
            console.warn('[Enhancement Tracker] Cannot extend non-completed session:', session.state);
            return false;
        }

        extendSession(session, newTargetLevel);
        this.currentSessionId = sessionId;

        await saveSessions(this.sessions);
        await saveCurrentSessionId(sessionId);

        console.log('[Enhancement Tracker] Extended session:', sessionId, 'New target:', newTargetLevel);
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
        const session = this.getCurrentSession();
        if (!session) {
            console.warn('[Enhancement Tracker] No active session to finalize');
            return;
        }

        finalizeSession(session);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Finalized session:', session.id);

        // Clear current session
        this.currentSessionId = null;
        await saveCurrentSessionId(null);
    }

    /**
     * Record a successful enhancement attempt
     * @param {number} previousLevel - Level before success
     * @param {number} newLevel - New level after success
     * @returns {Promise<void>}
     */
    async recordSuccess(previousLevel, newLevel) {
        const session = this.getCurrentSession();
        if (!session) {
            console.warn('[Enhancement Tracker] No active session');
            return;
        }

        recordSuccess(session, previousLevel, newLevel);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Recorded success:', previousLevel, '→', newLevel);

        // Check if target reached
        if (session.state === SessionState.COMPLETED) {
            console.log('[Enhancement Tracker] Target reached! Session completed.');
            this.currentSessionId = null;
            await saveCurrentSessionId(null);
        }
    }

    /**
     * Record a failed enhancement attempt
     * @param {number} previousLevel - Level that failed
     * @returns {Promise<void>}
     */
    async recordFailure(previousLevel) {
        const session = this.getCurrentSession();
        if (!session) {
            console.warn('[Enhancement Tracker] No active session');
            return;
        }

        recordFailure(session, previousLevel);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Recorded failure at level', previousLevel);
    }

    /**
     * Track material costs for current session
     * @param {string} itemHrid - Material item HRID
     * @param {number} count - Quantity used
     * @returns {Promise<void>}
     */
    async trackMaterialCost(itemHrid, count) {
        const session = this.getCurrentSession();
        if (!session) return;

        // Get market price
        const priceData = marketAPI.getPrice(itemHrid, 0);
        const unitCost = priceData ? (priceData.ask || priceData.bid || 0) : 0;

        addMaterialCost(session, itemHrid, count, unitCost);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Added material cost:', count, 'x', itemHrid, '=', count * unitCost);
    }

    /**
     * Track coin cost for current session
     * @param {number} amount - Coin amount spent
     * @returns {Promise<void>}
     */
    async trackCoinCost(amount) {
        const session = this.getCurrentSession();
        if (!session) return;

        addCoinCost(session, amount);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Added coin cost:', amount);
    }

    /**
     * Track protection item cost for current session
     * @param {string} protectionItemHrid - Protection item HRID
     * @param {number} cost - Protection item cost
     * @returns {Promise<void>}
     */
    async trackProtectionCost(protectionItemHrid, cost) {
        const session = this.getCurrentSession();
        if (!session) return;

        addProtectionCost(session, protectionItemHrid, cost);
        await saveSessions(this.sessions);

        console.log('[Enhancement Tracker] Added protection cost:', protectionItemHrid, cost);
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
        await saveSessions(this.sessions);
    }

    /**
     * Disable and cleanup
     */
    disable() {
        console.log('[Enhancement Tracker] Disabled');
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const enhancementTracker = new EnhancementTracker();

export default enhancementTracker;
