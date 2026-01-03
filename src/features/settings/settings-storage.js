/**
 * Settings Storage Module
 * Handles persistence of settings to chrome.storage.local
 */

import storage from '../../core/storage.js';
import { settingsGroups, getAllSettingIds } from './settings-config.js';

class SettingsStorage {
    constructor() {
        this.storageKey = 'script_settingsMap';
        this.storageArea = 'settings';
    }

    /**
     * Load all settings from storage
     * Merges saved values with defaults from settings-config
     * @returns {Promise<Object>} Settings map
     */
    async loadSettings() {
        const saved = await storage.getJSON(this.storageKey, this.storageArea, null);
        const settings = {};

        // Build default settings from config
        for (const group of Object.values(settingsGroups)) {
            for (const [settingId, settingDef] of Object.entries(group.settings)) {
                settings[settingId] = {
                    id: settingId,
                    desc: settingDef.label,
                    type: settingDef.type || 'checkbox'
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
        await storage.setJSON(this.storageKey, settings, this.storageArea, true);
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

// Create and export singleton instance
const settingsStorage = new SettingsStorage();

export default settingsStorage;
