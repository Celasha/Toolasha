/**
 * Settings Storage Module
 * Handles persistence of settings to chrome.storage.local
 */

import storage from '../../core/storage.js';
import { settingsGroups } from './settings-config.js';

class SettingsStorage {
    constructor() {
        this.storageKey = 'script_settingsMap'; // Legacy global key (used as template)
        this.storageArea = 'settings';
        this.currentCharacterId = null; // Current character ID (set after login)
        this.knownCharactersKey = 'known_character_ids'; // List of character IDs
    }

    /**
     * Set the current character ID
     * Must be called after character_initialized event
     * @param {string} characterId - Character ID
     */
    setCharacterId(characterId) {
        this.currentCharacterId = characterId;
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
     * Merges saved values with defaults from settings-config
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
            await this.addToKnownCharacters(this.currentCharacterId);
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
     * Add character to known characters list
     * @param {string} characterId - Character ID
     * @returns {Promise<void>}
     */
    async addToKnownCharacters(characterId) {
        const knownCharacters = await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
        if (!knownCharacters.includes(characterId)) {
            knownCharacters.push(characterId);
            await storage.setJSON(this.knownCharactersKey, knownCharacters, this.storageArea, true);
        }
    }

    /**
     * Get list of known character IDs
     * @returns {Promise<Array<string>>} Character IDs
     */
    async getKnownCharacters() {
        return await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
    }

    /**
     * Sync current settings to all other characters
     * @param {Object} settings - Current settings to copy
     * @returns {Promise<number>} Number of characters synced
     */
    async syncSettingsToAllCharacters(settings) {
        const knownCharacters = await this.getKnownCharacters();
        let syncedCount = 0;

        for (const characterId of knownCharacters) {
            // Skip current character (already has these settings)
            if (characterId === this.currentCharacterId) {
                continue;
            }

            // Write settings to this character's key
            const characterKey = `${this.storageKey}_${characterId}`;
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
        // Simply clear storage - loadSettings() will return defaults
        await storage.remove(this.storageKey, this.storageArea);
    }

    /**
     * Export settings as JSON
     * @returns {Promise<string>} JSON string
     */
    async exportSettings() {
        const settings = await this.loadSettings();
        return JSON.stringify(settings, null, 2);
    }

    /**
     * Import settings from JSON
     * @param {string} jsonString - JSON string
     * @returns {Promise<boolean>} Success
     */
    async importSettings(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            await this.saveSettings(imported);
            return true;
        } catch (error) {
            console.error('[Settings Storage] Import failed:', error);
            return false;
        }
    }
}

const settingsStorage = new SettingsStorage();

export default settingsStorage;
