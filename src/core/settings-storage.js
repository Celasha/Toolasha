/**
 * Settings Storage Module
 * Handles persistence of settings to chrome.storage.local
 */

import storage from './storage.js';
import { settingsGroups } from './settings-schema.js';

class SettingsStorage {
    constructor() {
        this.storageKey = 'script_settingsMap'; // Legacy global key (used as template)
        this.storageArea = 'settings';
        this.currentCharacterId = null;
        this.currentCharacterName = null;
        this.knownCharactersKey = 'known_character_ids';
    }

    /**
     * Set the current character ID and name.
     * Must be called after character_initialized event.
     * @param {string} characterId
     * @param {string} [characterName]
     */
    setCharacterId(characterId, characterName) {
        this.currentCharacterId = characterId;
        if (characterName) this.currentCharacterName = characterName;
    }

    /**
     * Get the storage key for current character
     * Falls back to global key if no character ID set
     * @returns {string} Storage key
     */
    getCharacterStorageKey() {
        if (this.currentCharacterId) {
            return `${this.storageKey}_${this.currentCharacterId}`;
        }
        return this.storageKey; // Fallback to global key
    }

    /**
     * Load all settings from storage
     * Merges saved values with defaults from settings-schema
     * @returns {Promise<Object>} Settings map
     */
    async loadSettings() {
        const characterKey = this.getCharacterStorageKey();
        let saved = await storage.getJSON(characterKey, this.storageArea, null);

        // Migration: If this is a character-specific key and it doesn't exist
        // Copy from global template (old 'script_settingsMap' key)
        if (this.currentCharacterId && !saved) {
            const globalTemplate = await storage.getJSON(this.storageKey, this.storageArea, null);
            if (globalTemplate) {
                // Copy global template to this character
                saved = globalTemplate;
                await storage.setJSON(characterKey, saved, this.storageArea, true);
            }

            // Add character to known characters list
            await this.addToKnownCharacters(this.currentCharacterId, this.currentCharacterName);
        }

        const settings = {};

        // Build default settings from config
        for (const group of Object.values(settingsGroups)) {
            for (const [settingId, settingDef] of Object.entries(group.settings)) {
                settings[settingId] = {
                    id: settingId,
                    desc: settingDef.label,
                    type: settingDef.type || 'checkbox',
                };

                // Set default value
                if (settingDef.type === 'checkbox') {
                    settings[settingId].isTrue = settingDef.default ?? false;
                } else {
                    settings[settingId].value = settingDef.default ?? '';
                }

                // Copy other properties
                if (settingDef.options && typeof settingDef.options !== 'function') {
                    settings[settingId].options = settingDef.options;
                }
                if (settingDef.min !== undefined) {
                    settings[settingId].min = settingDef.min;
                }
                if (settingDef.max !== undefined) {
                    settings[settingId].max = settingDef.max;
                }
                if (settingDef.step !== undefined) {
                    settings[settingId].step = settingDef.step;
                }
            }
        }

        // Merge saved settings
        if (saved) {
            for (const [settingId, savedValue] of Object.entries(saved)) {
                if (settings[settingId]) {
                    // Merge saved boolean values
                    if (savedValue.hasOwnProperty('isTrue')) {
                        settings[settingId].isTrue = savedValue.isTrue;
                    }
                    // Merge saved non-boolean values
                    if (savedValue.hasOwnProperty('value')) {
                        settings[settingId].value = savedValue.value;
                    }
                }
            }

            // Migrate: formatting_useKMBFormat changed from checkbox to select
            const fmtSaved = saved['formatting_useKMBFormat'];
            if (fmtSaved && fmtSaved.hasOwnProperty('isTrue') && !fmtSaved.hasOwnProperty('value')) {
                settings['formatting_useKMBFormat'].value = fmtSaved.isTrue ? 'compact' : 'full';
            }
        }

        return settings;
    }

    /**
     * Build default settings from schema without touching storage
     * Used during early initialization before character ID is known
     * @returns {Object} Settings map with schema defaults only
     */
    buildDefaults() {
        const settings = {};

        for (const group of Object.values(settingsGroups)) {
            for (const [settingId, settingDef] of Object.entries(group.settings)) {
                settings[settingId] = {
                    id: settingId,
                    desc: settingDef.label,
                    type: settingDef.type || 'checkbox',
                };

                if (settingDef.type === 'checkbox') {
                    settings[settingId].isTrue = settingDef.default ?? false;
                } else {
                    settings[settingId].value = settingDef.default ?? '';
                }

                if (settingDef.options) {
                    settings[settingId].options = settingDef.options;
                }
                if (settingDef.min !== undefined) {
                    settings[settingId].min = settingDef.min;
                }
                if (settingDef.max !== undefined) {
                    settings[settingId].max = settingDef.max;
                }
                if (settingDef.step !== undefined) {
                    settings[settingId].step = settingDef.step;
                }
            }
        }

        return settings;
    }

    /**
     * Save all settings to storage
     * @param {Object} settings - Settings map
     * @returns {Promise<void>}
     */
    async saveSettings(settings) {
        const characterKey = this.getCharacterStorageKey();
        await storage.setJSON(characterKey, settings, this.storageArea, true);
    }

    /**
     * Add character to known characters list, storing name alongside ID.
     * Migrates old flat-array format ([id, id]) to object format ([{id, name}]).
     * @param {string} characterId
     * @param {string} characterName
     * @returns {Promise<void>}
     */
    async addToKnownCharacters(characterId, characterName) {
        const raw = await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
        const list = this._normalizeKnownCharacters(raw);
        const existing = list.find((c) => c.id === characterId);
        if (existing) {
            if (characterName && existing.name !== characterName) {
                existing.name = characterName;
                await storage.setJSON(this.knownCharactersKey, list, this.storageArea, true);
            }
        } else {
            list.push({ id: characterId, name: characterName || characterId });
            await storage.setJSON(this.knownCharactersKey, list, this.storageArea, true);
        }
    }

    /**
     * Normalise stored known-characters to [{id, name}] regardless of legacy format.
     * @param {Array} raw
     * @returns {Array<{id: string, name: string}>}
     * @private
     */
    _normalizeKnownCharacters(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.map((entry) =>
            typeof entry === 'object' && entry !== null
                ? { id: String(entry.id), name: entry.name || String(entry.id) }
                : { id: String(entry), name: String(entry) }
        );
    }

    /**
     * Get list of known characters as [{id, name}] objects.
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getKnownCharacters() {
        const raw = await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
        return this._normalizeKnownCharacters(raw);
    }

    /**
     * Sync current settings to a specified subset of characters.
     * @param {Object} settings - Current settings to copy
     * @param {string[]} targetIds - IDs to sync to (omit to sync to all others)
     * @returns {Promise<number>} Number of characters synced
     */
    async syncSettingsToAllCharacters(settings, targetIds) {
        const knownCharacters = await this.getKnownCharacters();
        let syncedCount = 0;

        const targets = targetIds
            ? knownCharacters.filter((c) => targetIds.includes(c.id))
            : knownCharacters.filter((c) => c.id !== this.currentCharacterId);

        for (const character of targets) {
            if (character.id === this.currentCharacterId) continue;
            const characterKey = `${this.storageKey}_${character.id}`;
            await storage.setJSON(characterKey, settings, this.storageArea, true);
            syncedCount++;
        }

        return syncedCount;
    }

    /**
     * Get a single setting value
     * @param {string} settingId - Setting ID
     * @param {*} defaultValue - Default value if not found
     * @returns {Promise<*>} Setting value
     */
    async getSetting(settingId, defaultValue = null) {
        const settings = await this.loadSettings();
        const setting = settings[settingId];

        if (!setting) {
            return defaultValue;
        }

        // Return boolean for checkbox settings
        if (setting.type === 'checkbox') {
            return setting.isTrue ?? defaultValue;
        }

        // Return value for other settings
        return setting.value ?? defaultValue;
    }

    /**
     * Set a single setting value
     * @param {string} settingId - Setting ID
     * @param {*} value - New value
     * @returns {Promise<void>}
     */
    async setSetting(settingId, value) {
        const settings = await this.loadSettings();

        if (!settings[settingId]) {
            console.warn(`Setting '${settingId}' not found`);
            return;
        }

        // Update value
        if (settings[settingId].type === 'checkbox') {
            settings[settingId].isTrue = value;
        } else {
            settings[settingId].value = value;
        }

        await this.saveSettings(settings);
    }

    /**
     * Reset all settings to defaults
     * @returns {Promise<void>}
     */
    async resetToDefaults() {
        // Clear per-character settings so loadSettings() returns defaults
        const characterKey = this.getCharacterStorageKey();
        await storage.delete(characterKey, this.storageArea);
    }

    /**
     * Export all settings as JSON (full dump of settings store)
     * Includes global keys and current character's keys.
     * Excludes transient cache data.
     * @returns {Promise<string>} JSON string
     */
    async exportSettings() {
        const allData = await storage.getAll(this.storageArea);

        // Exclude transient cache keys
        const EXCLUDE_PREFIXES = ['marketplace_cache'];
        const exported = {};

        for (const [key, value] of Object.entries(allData)) {
            if (EXCLUDE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
            exported[key] = value;
        }

        return JSON.stringify(exported, null, 2);
    }

    /**
     * Import settings from JSON
     * Only imports global keys and keys matching the current character ID.
     * Character-specific keys for other characters are skipped.
     * @param {string} jsonString - JSON string
     * @returns {Promise<{imported: number, skipped: number}>} Import result
     */
    async importSettings(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            const currentCharId = this.currentCharacterId;
            let imported = 0;
            let skipped = 0;

            const knownCharacters = new Set(await this.getKnownCharacters());
            if (data[this.knownCharactersKey]) {
                for (const id of data[this.knownCharactersKey]) {
                    knownCharacters.add(String(id));
                }
            }

            for (const [key, value] of Object.entries(data)) {
                const charIdMatch =
                    key.match(/_([0-9a-f]{24})$/i) ||
                    key.match(/_(\d{10,})$/) ||
                    this._matchKnownCharacterSuffix(key, knownCharacters);

                if (charIdMatch) {
                    const keyCharId = charIdMatch[1];
                    if (currentCharId && keyCharId !== String(currentCharId)) {
                        skipped++;
                        continue;
                    }
                }

                await storage.setJSON(key, value, this.storageArea, true);
                imported++;
            }

            return { imported, skipped };
        } catch (error) {
            console.error('[Settings Storage] Import failed:', error);
            return null;
        }
    }

    /**
     * Check if a key ends with a known character ID suffix
     * @param {string} key - Storage key
     * @param {Set<string>} knownIds - Set of known character ID strings
     * @returns {Array|null} Match array with captured ID at index 1, or null
     * @private
     */
    _matchKnownCharacterSuffix(key, knownIds) {
        const lastUnderscore = key.lastIndexOf('_');
        if (lastUnderscore === -1) return null;
        const suffix = key.substring(lastUnderscore + 1);
        if (knownIds.has(suffix)) {
            return [key, suffix];
        }
        return null;
    }
}

const settingsStorage = new SettingsStorage();

export default settingsStorage;
