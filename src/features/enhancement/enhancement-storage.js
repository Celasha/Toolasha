/**
 * Enhancement Tracker Storage
 * Handles persistence of enhancement sessions using IndexedDB
 */

import storage from '../../core/storage.js';

const STORAGE_KEY = 'enhancementTracker_sessions';
const CURRENT_SESSION_KEY = 'enhancementTracker_currentSession';
const STORAGE_STORE = 'settings'; // Use existing 'settings' store

/**
 * Save all sessions to storage
 * @param {Object} sessions - Sessions object (keyed by session ID)
 * @returns {Promise<void>}
 */
export async function saveSessions(sessions) {
    try {
        await storage.setJSON(STORAGE_KEY, sessions, STORAGE_STORE, true); // immediate=true for rapid updates
    } catch (error) {
        throw error;
    }
}

/**
 * Load all sessions from storage
 * @returns {Promise<Object>} Sessions object (keyed by session ID)
 */
export async function loadSessions() {
    try {
        const sessions = await storage.getJSON(STORAGE_KEY, STORAGE_STORE, {});
        return sessions;
    } catch (error) {
        console.error('[EnhancementStorage] Failed to load sessions:', error);
        return {};
    }
}

/**
 * Save current session ID
 * @param {string|null} sessionId - Current session ID (null if no active session)
 * @returns {Promise<void>}
 */
export async function saveCurrentSessionId(sessionId) {
    try {
        await storage.set(CURRENT_SESSION_KEY, sessionId, STORAGE_STORE, true); // immediate=true for rapid updates
    } catch (error) {
        console.error('[EnhancementStorage] Failed to save current session ID:', error);
    }
}

/**
 * Load current session ID
 * @returns {Promise<string|null>} Current session ID or null
 */
export async function loadCurrentSessionId() {
    try {
        return await storage.get(CURRENT_SESSION_KEY, STORAGE_STORE, null);
    } catch (error) {
        console.error('[EnhancementStorage] Failed to load current session ID:', error);
        return null;
    }
}

/**
 * Delete a session
 * @param {Object} sessions - Sessions object
 * @param {string} sessionId - Session ID to delete
 * @returns {Promise<void>}
 */
export async function deleteSession(sessions, sessionId) {
    if (sessions[sessionId]) {
        delete sessions[sessionId];
        await saveSessions(sessions);
    }
}

/**
 * Archive old completed sessions (keep only recent N sessions)
 * @param {Object} sessions - Sessions object
 * @param {number} maxSessions - Maximum sessions to keep (default: 50)
 * @returns {Promise<void>}
 */
export async function archiveOldSessions(sessions, maxSessions = 50) {
    const sessionArray = Object.entries(sessions);

    // Skip if under limit
    if (sessionArray.length <= maxSessions) {
        return;
    }

    // Sort by start time (oldest first)
    sessionArray.sort(([, a], [, b]) => a.startTime - b.startTime);

    // Keep only the newest sessions
    const sessionsToKeep = sessionArray.slice(-maxSessions);
    const newSessions = Object.fromEntries(sessionsToKeep);

    await saveSessions(newSessions);
}

/**
 * Export session data as JSON string
 * @param {Object} session - Session object
 * @returns {string} JSON string
 */
export function exportSession(session) {
    return JSON.stringify(session, null, 2);
}

/**
 * Import session data from JSON string
 * @param {string} jsonStr - JSON string
 * @returns {Object|null} Session object or null if invalid
 */
export function importSession(jsonStr) {
    try {
        const session = JSON.parse(jsonStr);

        // Basic validation
        if (!session.id || !session.itemHrid) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

/**
 * Clear all sessions (for testing/reset)
 * @returns {Promise<void>}
 */
export async function clearAllSessions() {
    try {
        await storage.setJSON(STORAGE_KEY, {}, STORAGE_STORE);
        await storage.set(CURRENT_SESSION_KEY, null, STORAGE_STORE);
    } catch (error) {
        console.error('[EnhancementStorage] Failed to clear sessions:', error);
    }
}
