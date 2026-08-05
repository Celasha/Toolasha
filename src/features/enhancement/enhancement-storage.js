/**
 * Enhancement Tracker Storage
 * Handles character-scoped persistence of enhancement sessions using IndexedDB.
 */

import storage from '../../core/storage.js';

const LEGACY_SESSIONS_KEY = 'enhancementTracker_sessions';
const LEGACY_CURRENT_SESSION_KEY = 'enhancementTracker_currentSession';
const STORAGE_STORE = 'settings';
const STORAGE_MISSING = Symbol('enhancement-storage-missing');

/**
 * Get a character-scoped enhancement storage key.
 * @param {string} baseKey - Legacy base key
 * @param {string} characterId - Character ID
 * @returns {string} Scoped storage key
 */
export function getCharacterStorageKey(baseKey, characterId) {
    return `${baseKey}:${characterId}`;
}

/**
 * Load the complete enhancement state for a character. If the character has no
 * scoped state yet, legacy unscoped data is migrated once to that character.
 * @param {string} characterId - Active character ID
 * @returns {Promise<{sessions: Object, currentSessionId: string|null}>} Persisted state
 */
export async function loadEnhancementState(characterId) {
    if (!characterId) {
        return { sessions: {}, currentSessionId: null };
    }

    const sessionsKey = getCharacterStorageKey(LEGACY_SESSIONS_KEY, characterId);
    const currentSessionKey = getCharacterStorageKey(LEGACY_CURRENT_SESSION_KEY, characterId);
    const scopedSessions = await storage.getJSON(sessionsKey, STORAGE_STORE, STORAGE_MISSING);

    if (scopedSessions !== STORAGE_MISSING) {
        const currentSessionId = await storage.get(currentSessionKey, STORAGE_STORE, null);

        // Scoped sessions are the migration-complete marker. Any remaining legacy
        // keys are stale leftovers and must not be inherited by another character.
        const legacySessions = await storage.getJSON(LEGACY_SESSIONS_KEY, STORAGE_STORE, STORAGE_MISSING);
        if (legacySessions !== STORAGE_MISSING) {
            await storage.delete(LEGACY_SESSIONS_KEY, STORAGE_STORE);
            await storage.delete(LEGACY_CURRENT_SESSION_KEY, STORAGE_STORE);
        }

        return {
            sessions: scopedSessions || {},
            currentSessionId: currentSessionId || null,
        };
    }

    const legacySessions = await storage.getJSON(LEGACY_SESSIONS_KEY, STORAGE_STORE, STORAGE_MISSING);
    if (legacySessions === STORAGE_MISSING) {
        return { sessions: {}, currentSessionId: null };
    }

    const sessions = legacySessions || {};
    const legacyCurrentSessionId = await storage.get(LEGACY_CURRENT_SESSION_KEY, STORAGE_STORE, null);
    const currentSessionId = legacyCurrentSessionId && sessions[legacyCurrentSessionId] ? legacyCurrentSessionId : null;

    // Write the active pointer first so an interrupted migration can be retried safely
    // while the scoped sessions key remains the migration-complete marker.
    const currentSessionSaved = await storage.set(currentSessionKey, currentSessionId, STORAGE_STORE, true);
    if (!currentSessionSaved) {
        console.error('[EnhancementStorage] Legacy migration could not save the scoped current session');
        return { sessions, currentSessionId };
    }

    const sessionsSaved = await storage.setJSON(sessionsKey, sessions, STORAGE_STORE, true);
    if (!sessionsSaved) {
        console.error('[EnhancementStorage] Legacy migration could not save the scoped sessions');
        return { sessions, currentSessionId };
    }

    await storage.delete(LEGACY_SESSIONS_KEY, STORAGE_STORE);
    await storage.delete(LEGACY_CURRENT_SESSION_KEY, STORAGE_STORE);

    return { sessions, currentSessionId };
}

/**
 * Save all sessions to storage.
 * @param {Object} sessions - Sessions object (keyed by session ID)
 * @param {string} characterId - Character ID owning the sessions
 * @returns {Promise<boolean>} Success status
 */
export async function saveSessions(sessions, characterId) {
    if (!characterId) return false;

    try {
        const key = getCharacterStorageKey(LEGACY_SESSIONS_KEY, characterId);
        return await storage.setJSON(key, sessions, STORAGE_STORE, true);
    } catch (error) {
        console.error('[EnhancementStorage] Failed to save sessions:', error);
        return false;
    }
}

/**
 * Save current session ID.
 * @param {string|null} sessionId - Current session ID (null if no active session)
 * @param {string} characterId - Character ID owning the session
 * @returns {Promise<boolean>} Success status
 */
export async function saveCurrentSessionId(sessionId, characterId) {
    if (!characterId) return false;

    try {
        const key = getCharacterStorageKey(LEGACY_CURRENT_SESSION_KEY, characterId);
        return await storage.set(key, sessionId, STORAGE_STORE, true);
    } catch (error) {
        console.error('[EnhancementStorage] Failed to save current session ID:', error);
        return false;
    }
}

/**
 * Delete a session.
 * @param {Object} sessions - Sessions object
 * @param {string} sessionId - Session ID to delete
 * @param {string} characterId - Character ID owning the sessions
 * @returns {Promise<void>}
 */
export async function deleteSession(sessions, sessionId, characterId) {
    if (sessions[sessionId]) {
        delete sessions[sessionId];
        await saveSessions(sessions, characterId);
    }
}

/**
 * Archive old completed sessions (keep only recent N sessions).
 * Retention is not currently invoked; the helper remains available for a future
 * product decision.
 * @param {Object} sessions - Sessions object
 * @param {number} maxSessions - Maximum sessions to keep (default: 50)
 * @param {string} characterId - Character ID owning the sessions
 * @returns {Promise<void>}
 */
export async function archiveOldSessions(sessions, maxSessions = 50, characterId = null) {
    const sessionArray = Object.entries(sessions);

    if (sessionArray.length <= maxSessions) {
        return;
    }

    sessionArray.sort(([, a], [, b]) => a.startTime - b.startTime);

    const sessionsToKeep = sessionArray.slice(-maxSessions);
    const newSessions = Object.fromEntries(sessionsToKeep);

    await saveSessions(newSessions, characterId);
}

/**
 * Export session data as JSON string.
 * @param {Object} session - Session object
 * @returns {string} JSON string
 */
export function exportSession(session) {
    return JSON.stringify(session, null, 2);
}

/**
 * Import session data from JSON string.
 * @param {string} jsonStr - JSON string
 * @returns {Object|null} Session object or null if invalid
 */
export function importSession(jsonStr) {
    try {
        const session = JSON.parse(jsonStr);

        if (!session.id || !session.itemHrid) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

/**
 * Clear all sessions for one character (for testing/reset).
 * @param {string} characterId - Character ID to clear
 * @returns {Promise<void>}
 */
export async function clearAllSessions(characterId) {
    if (!characterId) return;

    try {
        await saveSessions({}, characterId);
        await saveCurrentSessionId(null, characterId);
    } catch (error) {
        console.error('[EnhancementStorage] Failed to clear sessions:', error);
    }
}
