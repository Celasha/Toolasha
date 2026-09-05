/**
 * Character Activity Status Storage
 * Character-scoped persistence for activity projections, plus a small account-level mirror of
 * the enable flag and date/time presentation preferences - both must be readable on Character
 * Select, where there is no active character and therefore no per-character settings context.
 */

import storage from '../../core/storage.js';

const STORE_NAME = 'characterActivityStatus';
const ACCOUNT_PREFS_KEY = 'accountPreferences';
const SCHEMA_VERSION = 1;

const DEFAULT_ACCOUNT_PREFS = Object.freeze({
    enabled: true,
    dateFormat: 'MM-DD',
    timeFormat: '24hour',
});

/**
 * Load the persisted activity record for one character.
 * @param {string} characterId
 * @returns {Promise<Object|null>}
 */
export async function loadCharacterActivity(characterId) {
    const record = await storage.getJSON(characterId, STORE_NAME, null);
    if (!record || record.version !== SCHEMA_VERSION) {
        // No prior schema exists to migrate from yet - anything else (missing, or a future,
        // higher version this build doesn't understand) is treated as "never observed" rather
        // than guessed at.
        return null;
    }
    return record;
}

/**
 * Persist the activity record for one character.
 * @param {string} characterId
 * @param {Object} record
 * @param {boolean} [immediate] - Skip the normal debounce (e.g. best-effort flush on character
 *      switch / page departure, where a delayed write could be lost)
 * @returns {Promise<boolean>}
 */
export async function saveCharacterActivity(characterId, record, immediate = false) {
    return storage.setJSON(characterId, { ...record, version: SCHEMA_VERSION }, STORE_NAME, immediate);
}

/**
 * Load the account-level presentation/enable preferences used on Character Select, where no
 * per-character settings context exists. Always returns a complete object (schema defaults
 * fill in anything missing/never-saved).
 * @returns {Promise<{enabled: boolean, dateFormat: string, timeFormat: string}>}
 */
export async function loadAccountPreferences() {
    const saved = await storage.getJSON(ACCOUNT_PREFS_KEY, STORE_NAME, null);
    return { ...DEFAULT_ACCOUNT_PREFS, ...(saved || {}) };
}

/**
 * Persist the account-level presentation/enable preferences. Callers should pass the character-
 * scoped values currently in effect for the active character, so Character Select later shows
 * whatever was last actually used rather than a schema default.
 * @param {Partial<{enabled: boolean, dateFormat: string, timeFormat: string}>} prefs
 * @param {boolean} [immediate=false] - Skip the normal debounce (e.g. a rare presentation-setting
 *      change made just before navigating to Character Select, where a delayed write could miss it)
 * @returns {Promise<boolean>}
 */
export async function saveAccountPreferences(prefs, immediate = false) {
    const current = await loadAccountPreferences();
    return storage.setJSON(ACCOUNT_PREFS_KEY, { ...current, ...prefs }, STORE_NAME, immediate);
}

export const CHARACTER_ACTIVITY_STORE = STORE_NAME;
export const CHARACTER_ACTIVITY_SCHEMA_VERSION = SCHEMA_VERSION;
