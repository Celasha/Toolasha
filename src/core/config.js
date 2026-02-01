/**
 * Configuration Module
 * Manages all script constants and user settings
 */

import settingsStorage from '../features/settings/settings-storage.js';
import { settingsGroups } from '../features/settings/settings-config.js';
import dataManager from './data-manager.js';

/**
 * Config class manages all script configuration
 * - Constants (colors, URLs, formatters)
 * - User settings with persistence
 */
class Config {
    constructor() {
        // === CONSTANTS ===

        // Number formatting separators (locale-aware)
        this.THOUSAND_SEPARATOR = new Intl.NumberFormat().format(1111).replaceAll('1', '').at(0) || '';
        this.DECIMAL_SEPARATOR = new Intl.NumberFormat().format(1.1).replaceAll('1', '').at(0);

        // Extended color palette (configurable)
        // Dark background colors (for UI elements on dark backgrounds)
        this.COLOR_PROFIT = '#047857'; // Emerald green for positive values
        this.COLOR_LOSS = '#f87171'; // Red for negative values
        this.COLOR_WARNING = '#ffa500'; // Orange for warnings
        this.COLOR_INFO = '#60a5fa'; // Blue for informational
        this.COLOR_ESSENCE = '#c084fc'; // Purple for essences

        // Tooltip colors (for text on light/tooltip backgrounds)
        this.COLOR_TOOLTIP_PROFIT = '#047857'; // Green for tooltips
        this.COLOR_TOOLTIP_LOSS = '#dc2626'; // Darker red for tooltips
        this.COLOR_TOOLTIP_INFO = '#2563eb'; // Darker blue for tooltips
        this.COLOR_TOOLTIP_WARNING = '#ea580c'; // Darker orange for tooltips

        // General colors
        this.COLOR_TEXT_PRIMARY = '#ffffff'; // Primary text color
        this.COLOR_TEXT_SECONDARY = '#888888'; // Secondary text color
        this.COLOR_BORDER = '#444444'; // Border color
        this.COLOR_GOLD = '#ffa500'; // Gold/currency color
        this.COLOR_ACCENT = '#22c55e'; // Script accent color (green)
        this.COLOR_REMAINING_XP = '#FFFFFF'; // Remaining XP text color

        // Legacy color constants (mapped to COLOR_ACCENT)
        this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_ALERT = 'red';

        // Market API URL
        this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

        // === SETTINGS MAP ===

        // Settings loaded from settings-config.js via settings-storage.js
        this.settingsMap = {};

        // === SETTING CHANGE CALLBACKS ===
        // Map of setting keys to callback functions
        this.settingChangeCallbacks = {};

        // === FEATURE REGISTRY ===
        // Feature toggles with metadata for future UI
        this.features = {
            // Market Features
            tooltipPrices: {
                enabled: true,
                name: 'Market Prices in Tooltips',
                category: 'Market',
                description: 'Shows bid/ask prices in item tooltips',
                settingKey: 'itemTooltip_prices',
            },
            tooltipProfit: {
                enabled: true,
                name: 'Profit Calculator in Tooltips',
                category: 'Market',
                description: 'Shows production cost and profit in tooltips',
                settingKey: 'itemTooltip_profit',
            },
            tooltipConsumables: {
                enabled: true,
                name: 'Consumable Effects in Tooltips',
                category: 'Market',
                description: 'Shows buff effects and durations for food/drinks',
                settingKey: 'showConsumTips',
            },
            expectedValueCalculator: {
                enabled: true,
                name: 'Expected Value Calculator',
                category: 'Market',
                description: 'Shows EV for openable containers (crates, chests)',
                settingKey: 'itemTooltip_expectedValue',
            },
            market_showListingPrices: {
                enabled: true,
                name: 'Market Listing Price Display',
                category: 'Market',
                description: 'Shows top order price, total value, and listing age on My Listings',
                settingKey: 'market_showListingPrices',
            },
            market_showEstimatedListingAge: {
                enabled: true,
                name: 'Estimated Listing Age',
                category: 'Market',
                description: 'Estimates creation time for all market listings using listing ID interpolation',
                settingKey: 'market_showEstimatedListingAge',
            },
            market_showOrderTotals: {
                enabled: true,
                name: 'Market Order Totals',
                category: 'Market',
                description: 'Shows buy orders, sell orders, and unclaimed coins in header',
                settingKey: 'market_showOrderTotals',
            },
            market_showHistoryViewer: {
                enabled: true,
                name: 'Market History Viewer',
                category: 'Market',
                description: 'View and export all market listing history',
                settingKey: 'market_showHistoryViewer',
            },

            // Action Features
            actionTimeDisplay: {
                enabled: true,
                name: 'Action Queue Time Display',
                category: 'Actions',
                description: 'Shows total time and completion time for queued actions',
                settingKey: 'totalActionTime',
            },
            quickInputButtons: {
                enabled: true,
                name: 'Quick Input Buttons',
                category: 'Actions',
                description: 'Adds 1/10/100/1000 buttons to action inputs',
                settingKey: 'actionPanel_totalTime_quickInputs',
            },
            actionPanelProfit: {
                enabled: true,
                name: 'Action Profit Display',
                category: 'Actions',
                description: 'Shows profit/loss for gathering and production',
                settingKey: 'actionPanel_foragingTotal',
            },
            requiredMaterials: {
                enabled: true,
                name: 'Required Materials Display',
                category: 'Actions',
                description: 'Shows total required and missing materials for production actions',
                settingKey: 'requiredMaterials',
            },

            // Combat Features
            abilityBookCalculator: {
                enabled: true,
                name: 'Ability Book Requirements',
                category: 'Combat',
                description: 'Shows books needed to reach target level',
                settingKey: 'skillbook',
            },
            zoneIndices: {
                enabled: true,
                name: 'Combat Zone Indices',
                category: 'Combat',
                description: 'Shows zone numbers in combat location list',
                settingKey: 'mapIndex',
            },
            taskZoneIndices: {
                enabled: true,
                name: 'Task Zone Indices',
                category: 'Tasks',
                description: 'Shows zone numbers on combat tasks',
                settingKey: 'taskMapIndex',
            },
            combatScore: {
                enabled: true,
                name: 'Profile Gear Score',
                category: 'Combat',
                description: 'Shows gear score on profile',
                settingKey: 'combatScore',
            },
            dungeonTracker: {
                enabled: true,
                name: 'Dungeon Tracker',
                category: 'Combat',
                description:
                    'Real-time dungeon progress tracking in top bar with wave times, statistics, and party chat completion messages',
                settingKey: 'dungeonTracker',
            },
            combatSimIntegration: {
                enabled: true,
                name: 'Combat Simulator Integration',
                category: 'Combat',
                description: 'Auto-import character/party data into Shykai Combat Simulator',
                settingKey: null, // New feature, no legacy setting
            },
            enhancementSimulator: {
                enabled: true,
                name: 'Enhancement Simulator',
                category: 'Market',
                description: 'Shows enhancement cost calculations in item tooltips',
                settingKey: 'enhanceSim',
            },

            // UI Features
            equipmentLevelDisplay: {
                enabled: true,
                name: 'Equipment Level on Icons',
                category: 'UI',
                description: 'Shows item level number on equipment icons',
                settingKey: 'itemIconLevel',
            },
            alchemyItemDimming: {
                enabled: true,
                name: 'Alchemy Item Dimming',
                category: 'UI',
                description: 'Dims items requiring higher Alchemy level',
                settingKey: 'alchemyItemDimming',
            },
            skillExperiencePercentage: {
                enabled: true,
                name: 'Skill Experience Percentage',
                category: 'UI',
                description: 'Shows XP progress percentage in left sidebar',
                settingKey: 'expPercentage',
            },
            largeNumberFormatting: {
                enabled: true,
                name: 'Use K/M/B Number Formatting',
                category: 'UI',
                description: 'Display large numbers as 1.5M instead of 1,500,000',
                settingKey: 'formatting_useKMBFormat',
            },

            // Task Features
            taskProfitDisplay: {
                enabled: true,
                name: 'Task Profit Calculator',
                category: 'Tasks',
                description: 'Shows expected profit from task rewards',
                settingKey: 'taskProfitCalculator',
            },
            taskEfficiencyRating: {
                enabled: true,
                name: 'Task Efficiency Rating',
                category: 'Tasks',
                description: 'Shows tokens or profit per hour on task cards',
                settingKey: 'taskEfficiencyRating',
            },
            taskRerollTracker: {
                enabled: true,
                name: 'Task Reroll Tracker',
                category: 'Tasks',
                description: 'Tracks reroll costs and history',
                settingKey: 'taskRerollTracker',
            },
            taskSorter: {
                enabled: true,
                name: 'Task Sorting',
                category: 'Tasks',
                description: 'Adds button to sort tasks by skill type',
                settingKey: 'taskSorter',
            },
            taskIcons: {
                enabled: true,
                name: 'Task Icons',
                category: 'Tasks',
                description: 'Shows visual icons on task cards',
                settingKey: 'taskIcons',
            },
            taskIconsDungeons: {
                enabled: false,
                name: 'Task Icons - Dungeons',
                category: 'Tasks',
                description: 'Shows dungeon icons for combat tasks',
                settingKey: 'taskIconsDungeons',
                dependencies: ['taskIcons'],
            },

            // Skills Features
            skillRemainingXP: {
                enabled: true,
                name: 'Remaining XP Display',
                category: 'Skills',
                description: 'Shows remaining XP to next level on skill bars',
                settingKey: 'skillRemainingXP',
            },

            // House Features
            houseCostDisplay: {
                enabled: true,
                name: 'House Upgrade Costs',
                category: 'House',
                description: 'Shows market value of upgrade materials',
                settingKey: 'houseUpgradeCosts',
            },

            // Economy Features
            networth: {
                enabled: true,
                name: 'Net Worth Calculator',
                category: 'Economy',
                description: 'Shows total asset value in header (Current Assets)',
                settingKey: 'networth',
            },
            inventorySummary: {
                enabled: true,
                name: 'Inventory Summary Panel',
                category: 'Economy',
                description: 'Shows detailed networth breakdown below inventory',
                settingKey: 'invWorth',
            },
            inventorySort: {
                enabled: true,
                name: 'Inventory Sort',
                category: 'Economy',
                description: 'Sorts inventory by Ask/Bid price',
                settingKey: 'invSort',
            },
            inventorySortBadges: {
                enabled: false,
                name: 'Inventory Sort Price Badges',
                category: 'Economy',
                description: 'Shows stack value badges on items when sorting',
                settingKey: 'invSort_showBadges',
            },
            inventoryBadgePrices: {
                enabled: false,
                name: 'Inventory Price Badges',
                category: 'Economy',
                description: 'Shows stack value badges on items (independent of sorting)',
                settingKey: 'invBadgePrices',
            },

            // Enhancement Features
            enhancementTracker: {
                enabled: false,
                name: 'Enhancement Tracker',
                category: 'Enhancement',
                description: 'Tracks enhancement attempts, costs, and statistics',
                settingKey: 'enhancementTracker',
            },

            // Notification Features
            notifiEmptyAction: {
                enabled: false,
                name: 'Empty Queue Notification',
                category: 'Notifications',
                description: 'Browser notification when action queue becomes empty',
                settingKey: 'notifiEmptyAction',
            },
        };

        // Note: loadSettings() must be called separately (async)
    }

    /**
     * Initialize config (async) - loads settings from storage
     * @returns {Promise<void>}
     */
    async initialize() {
        await this.loadSettings();
        this.applyColorSettings();
    }

    /**
     * Load settings from storage (async)
     * @returns {Promise<void>}
     */
    async loadSettings() {
        // Set character ID in settings storage for per-character settings
        const characterId = dataManager.getCurrentCharacterId();
        if (characterId) {
            settingsStorage.setCharacterId(characterId);
        }

        // Load settings from settings-storage (which uses settings-config.js as source of truth)
        this.settingsMap = await settingsStorage.loadSettings();
    }

    /**
     * Clear settings cache (for character switching)
     */
    clearSettingsCache() {
        this.settingsMap = {};
    }

    /**
     * Save settings to storage (immediately)
     */
    saveSettings() {
        settingsStorage.saveSettings(this.settingsMap);
    }

    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {boolean} Setting value
     */
    getSetting(key) {
        // Check loaded settings first
        if (this.settingsMap[key]) {
            return this.settingsMap[key].isTrue ?? false;
        }

        // Fallback: Check settings-config.js for default (fixes race condition on load)
        for (const group of Object.values(settingsGroups)) {
            if (group.settings[key]) {
                return group.settings[key].default ?? false;
            }
        }

        // Ultimate fallback
        return false;
    }

    /**
     * Get a setting value (for non-boolean settings)
     * @param {string} key - Setting key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} Setting value
     */
    getSettingValue(key, defaultValue = null) {
        const setting = this.settingsMap[key];
        if (!setting) {
            return defaultValue;
        }
        // Handle both boolean (isTrue) and value-based settings
        if (setting.hasOwnProperty('value')) {
            return setting.value;
        } else if (setting.hasOwnProperty('isTrue')) {
            return setting.isTrue;
        }
        return defaultValue;
    }

    /**
     * Set a setting value (auto-saves)
     * @param {string} key - Setting key
     * @param {boolean} value - Setting value
     */
    setSetting(key, value) {
        if (this.settingsMap[key]) {
            this.settingsMap[key].isTrue = value;
            this.saveSettings();

            // Re-apply colors if color setting changed
            if (key === 'useOrangeAsMainColor') {
                this.applyColorSettings();
            }

            // Trigger registered callbacks for this setting
            if (this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key](value);
            }
        }
    }

    /**
     * Set a setting value (for non-boolean settings, auto-saves)
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     */
    setSettingValue(key, value) {
        if (this.settingsMap[key]) {
            this.settingsMap[key].value = value;
            this.saveSettings();

            // Re-apply color settings if this is a color setting
            if (key.startsWith('color_')) {
                this.applyColorSettings();
            }

            // Trigger registered callbacks for this setting
            if (this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key](value);
            }
        }
    }

    /**
     * Register a callback to be called when a specific setting changes
     * @param {string} key - Setting key to watch
     * @param {Function} callback - Callback function to call when setting changes
     */
    onSettingChange(key, callback) {
        this.settingChangeCallbacks[key] = callback;
    }

    /**
     * Unregister a callback for a specific setting change
     * @param {string} key - Setting key to stop watching
     * @param {Function} _callback - Callback function to remove (unused, kept for API consistency)
     */
    offSettingChange(key, _callback) {
        delete this.settingChangeCallbacks[key];
    }

    /**
     * Toggle a setting (auto-saves)
     * @param {string} key - Setting key
     * @returns {boolean} New value
     */
    toggleSetting(key) {
        const newValue = !this.getSetting(key);
        this.setSetting(key, newValue);
        return newValue;
    }

    /**
     * Get all settings as an array (useful for UI)
     * @returns {Array} Array of setting objects
     */
    getAllSettings() {
        return Object.values(this.settingsMap);
    }

    /**
     * Reset all settings to defaults
     */
    resetToDefaults() {
        // Find default values from constructor (all true except notifiEmptyAction)
        for (const key in this.settingsMap) {
            this.settingsMap[key].isTrue = key !== 'notifiEmptyAction';
        }

        this.saveSettings();
        this.applyColorSettings();
    }

    /**
     * Sync current settings to all other characters
     * @returns {Promise<{success: boolean, count: number, error?: string}>} Result object
     */
    async syncSettingsToAllCharacters() {
        try {
            // Ensure character ID is set
            const characterId = dataManager.getCurrentCharacterId();
            if (!characterId) {
                return {
                    success: false,
                    count: 0,
                    error: 'No character ID available',
                };
            }

            // Set character ID in settings storage
            settingsStorage.setCharacterId(characterId);

            // Sync settings to all other characters
            const syncedCount = await settingsStorage.syncSettingsToAllCharacters(this.settingsMap);

            return {
                success: true,
                count: syncedCount,
            };
        } catch (error) {
            console.error('[Config] Failed to sync settings:', error);
            return {
                success: false,
                count: 0,
                error: error.message,
            };
        }
    }

    /**
     * Get number of known characters (including current)
     * @returns {Promise<number>} Number of characters
     */
    async getKnownCharacterCount() {
        try {
            const knownCharacters = await settingsStorage.getKnownCharacters();
            return knownCharacters.length;
        } catch (error) {
            console.error('[Config] Failed to get character count:', error);
            return 0;
        }
    }

    /**
     * Apply color settings to color constants
     */
    applyColorSettings() {
        // Apply extended color palette from settings
        this.COLOR_PROFIT = this.getSettingValue('color_profit', '#047857');
        this.COLOR_LOSS = this.getSettingValue('color_loss', '#f87171');
        this.COLOR_WARNING = this.getSettingValue('color_warning', '#ffa500');
        this.COLOR_INFO = this.getSettingValue('color_info', '#60a5fa');
        this.COLOR_ESSENCE = this.getSettingValue('color_essence', '#c084fc');
        this.COLOR_TOOLTIP_PROFIT = this.getSettingValue('color_tooltip_profit', '#047857');
        this.COLOR_TOOLTIP_LOSS = this.getSettingValue('color_tooltip_loss', '#dc2626');
        this.COLOR_TOOLTIP_INFO = this.getSettingValue('color_tooltip_info', '#2563eb');
        this.COLOR_TOOLTIP_WARNING = this.getSettingValue('color_tooltip_warning', '#ea580c');
        this.COLOR_TEXT_PRIMARY = this.getSettingValue('color_text_primary', '#ffffff');
        this.COLOR_TEXT_SECONDARY = this.getSettingValue('color_text_secondary', '#888888');
        this.COLOR_BORDER = this.getSettingValue('color_border', '#444444');
        this.COLOR_GOLD = this.getSettingValue('color_gold', '#ffa500');
        this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
        this.COLOR_REMAINING_XP = this.getSettingValue('color_remaining_xp', '#FFFFFF');
        this.COLOR_INVBADGE_ASK = this.getSettingValue('color_invBadge_ask', '#047857');
        this.COLOR_INVBADGE_BID = this.getSettingValue('color_invBadge_bid', '#60a5fa');
        this.COLOR_TRANSMUTE = this.getSettingValue('color_transmute', '#ffffff');

        // Set legacy SCRIPT_COLOR_MAIN to accent color
        this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT; // Keep tooltip same as main
    }

    // === FEATURE TOGGLE METHODS ===

    /**
     * Check if a feature is enabled
     * Uses legacy settingKey if available, otherwise uses feature.enabled
     * @param {string} featureKey - Feature key (e.g., 'tooltipPrices')
     * @returns {boolean} Whether feature is enabled
     */
    isFeatureEnabled(featureKey) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            return true; // Default to enabled if not found
        }

        // Check legacy setting first (for backward compatibility)
        if (feature.settingKey && this.settingsMap[feature.settingKey]) {
            return this.settingsMap[feature.settingKey].isTrue ?? true;
        }

        // Otherwise use feature.enabled
        return feature.enabled ?? true;
    }

    /**
     * Enable or disable a feature
     * @param {string} featureKey - Feature key
     * @param {boolean} enabled - Enable state
     */
    async setFeatureEnabled(featureKey, enabled) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            console.warn(`Feature '${featureKey}' not found`);
            return;
        }

        // Update legacy setting if it exists
        if (feature.settingKey && this.settingsMap[feature.settingKey]) {
            this.settingsMap[feature.settingKey].isTrue = enabled;
        }

        // Update feature registry
        feature.enabled = enabled;

        await this.saveSettings();
    }

    /**
     * Toggle a feature
     * @param {string} featureKey - Feature key
     * @returns {boolean} New enabled state
     */
    async toggleFeature(featureKey) {
        const current = this.isFeatureEnabled(featureKey);
        await this.setFeatureEnabled(featureKey, !current);
        return !current;
    }

    /**
     * Get all features grouped by category
     * @returns {Object} Features grouped by category
     */
    getFeaturesByCategory() {
        const grouped = {};

        for (const [key, feature] of Object.entries(this.features)) {
            const category = feature.category || 'Other';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push({
                key,
                name: feature.name,
                description: feature.description,
                enabled: this.isFeatureEnabled(key),
            });
        }

        return grouped;
    }

    /**
     * Get all feature keys
     * @returns {string[]} Array of feature keys
     */
    getFeatureKeys() {
        return Object.keys(this.features || {});
    }

    /**
     * Get feature info
     * @param {string} featureKey - Feature key
     * @returns {Object|null} Feature info with current enabled state
     */
    getFeatureInfo(featureKey) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            return null;
        }

        return {
            key: featureKey,
            name: feature.name,
            category: feature.category,
            description: feature.description,
            enabled: this.isFeatureEnabled(featureKey),
        };
    }
}

// Create and export singleton instance
const config = new Config();

export default config;
