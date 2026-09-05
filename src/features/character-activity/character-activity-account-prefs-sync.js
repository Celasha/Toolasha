/**
 * Character Activity Account Preferences Sync
 * Keeps the account-level preference mirror (enabled flag + date/time format) fresh independently
 * of whether the character-scoped Character Activity collector is currently running. The
 * always-on Character Select renderer reads that mirror before any character has ever connected,
 * or after the feature has been toggled off - the collector itself only writes it while active,
 * so this listens directly to settings infrastructure that stays live regardless.
 */

import config from '../../core/config.js';
import { saveAccountPreferences } from './character-activity-storage.js';
import characterSelectRenderer from './character-select-renderer.js';

function readCurrentAccountPreferences() {
    return {
        enabled: config.getSetting('characterActivityStatus'),
        dateFormat: config.getSettingValue('market_listingDateFormat', 'MM-DD'),
        timeFormat: config.getSettingValue('market_listingTimeFormat', '24hour'),
    };
}

// These writes are rare (a settings change, not a hot path) and should preserve callback order
// even if IndexedDB/rendering is momentarily slow - a serialized queue keeps two rapid changes
// from committing (or refreshing the renderer) out of order.
let accountPreferencesSyncQueue = Promise.resolve();

function syncAccountPreferencesMirror() {
    // Capture one coherent settings snapshot at callback time, before this task's turn in the queue.
    const prefs = readCurrentAccountPreferences();

    accountPreferencesSyncQueue = accountPreferencesSyncQueue
        .catch((error) => {
            console.warn('[Character Activity] Previous account preference sync failed:', error);
        })
        .then(async () => {
            const saved = await saveAccountPreferences(prefs, true);
            if (!saved) return;
            await characterSelectRenderer.refreshNow();
        });

    return accountPreferencesSyncQueue;
}

/**
 * Register the always-on listeners. Safe to call once at module/page-load time, before
 * config.initialize() has even run - onSettingChange/onSettingsLoaded only register callbacks
 * for later, and reads before initialization complete safely fall back to schema defaults.
 */
export function startAccountPreferencesSync() {
    config.onSettingsLoaded(syncAccountPreferencesMirror);
    config.onSettingChange('characterActivityStatus', syncAccountPreferencesMirror);
    config.onSettingChange('market_listingDateFormat', syncAccountPreferencesMirror);
    config.onSettingChange('market_listingTimeFormat', syncAccountPreferencesMirror);
}
