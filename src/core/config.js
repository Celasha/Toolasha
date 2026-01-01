/**
 * Configuration Module
 * Manages all script constants and user settings
 */

import storage from './storage.js';

/**
 * Config class manages all script configuration
 * - Constants (colors, URLs, formatters)
 * - User settings with persistence
 */
class Config {
    constructor() {
        // === CONSTANTS ===

        // Number formatting separators (locale-aware)
        this.THOUSAND_SEPARATOR = new Intl.NumberFormat().format(1111).replaceAll("1", "").at(0) || "";
        this.DECIMAL_SEPARATOR = new Intl.NumberFormat().format(1.1).replaceAll("1", "").at(0);

        // Script colors (can be changed by settings)
        this.SCRIPT_COLOR_MAIN = "green";
        this.SCRIPT_COLOR_TOOLTIP = "darkgreen";
        this.SCRIPT_COLOR_ALERT = "red";

        // Market API URL
        this.MARKET_API_URL = "https://www.milkywayidle.com/game_data/marketplace.json";

        // === SETTINGS MAP ===

        this.settingsMap = {
            useOrangeAsMainColor: {
                id: "useOrangeAsMainColor",
                desc: "Use orange as the main color for the script.",
                isTrue: true,
            },
            totalActionTime: {
                id: "totalActionTime",
                desc: "Top left: Estimated total time of the current action, estimated complete time.",
                isTrue: true,
            },
            actionPanel_totalTime: {
                id: "actionPanel_totalTime",
                desc: "Action panel: Estimated total time of the action, times needed to reach a target skill level, exp/hour.",
                isTrue: true,
            },
            actionPanel_totalTime_quickInputs: {
                id: "actionPanel_totalTime_quickInputs",
                desc: "Action panel: Quick input buttons (hours, count presets, Max). [Depends on the previous selection]",
                isTrue: true,
            },
            actionPanel_foragingTotal: {
                id: "actionPanel_foragingTotal",
                desc: "Action panel: Overall profit of the foraging maps with multiple outcomes. [Depends on the previous selection]",
                isTrue: true,
            },
            networth: {
                id: "networth",
                desc: "Top right: Current assets (Items with at least 2 enhancement levels are valued by enchancing simulator).",
                isTrue: true,
            },
            invWorth: {
                id: "invWorth",
                desc: "Below inventory search bar: Inventory and character summery. [Depends on the previous selection]",
                isTrue: true,
            },
            invSort: {
                id: "invSort",
                desc: "Inventory: Sort inventory items. [Depends on the previous selection]",
                isTrue: true,
            },
            invSort_showBadges: {
                id: "invSort_showBadges",
                desc: "Inventory: Show stack value badges on items. [Depends on the previous selection]",
                isTrue: false,
            },
            itemTooltip_prices: {
                id: "itemTooltip_prices",
                desc: "Item tooltip: 24 hours average market price.",
                isTrue: true,
            },
            itemTooltip_profit: {
                id: "itemTooltip_profit",
                desc: "Item tooltip: Production cost and profit. [Depends on the previous selection]",
                isTrue: true,
            },
            itemTooltip_expectedValue: {
                id: "itemTooltip_expectedValue",
                desc: "Item tooltip: Expected value for openable containers (crates, chests, Purple's Gift). [Depends on the first selection]",
                isTrue: true,
            },
            expectedValue_showDrops: {
                id: "expectedValue_showDrops",
                desc: "Expected value drop display: 'Top 5' = 5 highest value drops, 'Top 10' = 10 highest, 'All' = all drops, 'None' = summary only. [Depends on the previous selection]",
                value: "All",
            },
            expectedValue_respectPricingMode: {
                id: "expectedValue_respectPricingMode",
                desc: "Use pricing mode for expected value calculations (same as profit calculator). [Depends on the previous selection]",
                isTrue: true,
            },
            enhanceSim_autoDetect: {
                id: "enhanceSim_autoDetect",
                desc: "Enhancement tooltips: Auto-detect your current stats (true) or use market defaults (false). Most players should use market defaults to see realistic professional enhancer costs.",
                isTrue: false,
            },
            enhanceSim_enhancingLevel: {
                id: "enhanceSim_enhancingLevel",
                desc: "Enhancement skill level for cost calculations (default: 125 - professional enhancer level).",
                value: 125,
            },
            enhanceSim_houseLevel: {
                id: "enhanceSim_houseLevel",
                desc: "Observatory house room level (default: 6 - realistic market level, max: 8).",
                value: 6,
            },
            enhanceSim_toolBonus: {
                id: "enhanceSim_toolBonus",
                desc: "Tool success bonus percentage (default: 5.42 = Celestial Enhancer +10).",
                value: 5.42,
            },
            enhanceSim_speedBonus: {
                id: "enhanceSim_speedBonus",
                desc: "Speed bonus percentage (default: 0 - not critical for cost calculations).",
                value: 0,
            },
            enhanceSim_blessedTea: {
                id: "enhanceSim_blessedTea",
                desc: "Blessed Tea active (default: true - professional enhancers use it to reduce attempts).",
                isTrue: true,
            },
            enhanceSim_ultraEnhancingTea: {
                id: "enhanceSim_ultraEnhancingTea",
                desc: "Ultra Enhancing Tea active (default: true - provides +8 base skill levels, scales with drink concentration).",
                isTrue: true,
            },
            enhanceSim_superEnhancingTea: {
                id: "enhanceSim_superEnhancingTea",
                desc: "Super Enhancing Tea active (default: false - provides +6 base skill levels, Ultra is better).",
                isTrue: false,
            },
            enhanceSim_enhancingTea: {
                id: "enhanceSim_enhancingTea",
                desc: "Enhancing Tea active (default: false - provides +3 base skill levels, Ultra is better).",
                isTrue: false,
            },
            enhanceSim_drinkConcentration: {
                id: "enhanceSim_drinkConcentration",
                desc: "Drink Concentration percentage (default: 10.32 = Guzzling Pouch +10).",
                value: 10.32,
            },
            profitCalc_pricingMode: {
                id: "profitCalc_pricingMode",
                desc: "Profit calculation pricing mode: 'conservative' = instant trading (Ask/Bid), 'hybrid' = instant buy + sell orders (Ask/Ask), 'optimistic' = patient trading (Bid/Ask).",
                value: "hybrid",
            },
            showConsumTips: {
                id: "showConsumTips",
                desc: "Item tooltip: HP/MP consumables restore speed, cost performance, max cost per day.",
                isTrue: true,
            },
            networkAlert: {
                id: "networkAlert",
                desc: "Top right: Alert message when market price data can not be fetched.",
                isTrue: true,
            },
            expPercentage: {
                id: "expPercentage",
                desc: "Left sidebar: Percentages of exp of the skill levels.",
                isTrue: true,
            },
            itemIconLevel: {
                id: "itemIconLevel",
                desc: "Top right corner of equipment icons: Equipment level.",
                isTrue: true,
            },
            showsKeyInfoInIcon: {
                id: "showsKeyInfoInIcon",
                desc: "Top right corner of key/fragment icons: Corresponding combat zone index number. [Depends on the previous selection]",
                isTrue: true,
            },
            alchemyItemDimming: {
                id: "alchemyItemDimming",
                desc: "Alchemy panel: Dim items that require higher Alchemy level than you have.",
                isTrue: true,
            },
            marketFilter: {
                id: "marketFilter",
                desc: "Marketplace: Filter by equipment level, class, slot.",
                isTrue: true,
            },
            taskMapIndex: {
                id: "taskMapIndex",
                desc: "Tasks page: Combat zone index number.",
                isTrue: true,
            },
            mapIndex: {
                id: "mapIndex",
                desc: "Combat zones page: Combat zone index number.",
                isTrue: true,
            },
            skillbook: {
                id: "skillbook",
                desc: "Item dictionary of skill books: Number of books needed to reach target skill level.",
                isTrue: true,
            },
            combatScore: {
                id: "combatScore",
                desc: "Profile panel: Gear score based on houses, abilities, and equipment.",
                isTrue: true,
            },
            taskProfitCalculator: {
                id: "taskProfitCalculator",
                desc: "Task panel: Show total profit for gathering and production tasks (rewards + action profit).",
                isTrue: true,
            },
            taskRerollTracker: {
                id: "taskRerollTracker",
                desc: "Task panel: Track task reroll costs (EXPERIMENTAL - may cause UI freezing).",
                isTrue: true,
            },
            houseUpgradeCosts: {
                id: "houseUpgradeCosts",
                desc: "House panel: Show upgrade costs with market prices, inventory comparison, and cumulative costs to target level.",
                isTrue: true,
            },
            actionQueue: {
                id: "actionQueue",
                desc: "Queued actions panel at the top: Estimated total time and complete time of each queued action.",
                isTrue: true,
            },
            actionPanel_speedBreakdown: {
                id: "actionPanel_speedBreakdown",
                desc: "Action panel: Show detailed action speed breakdown by source (equipment, tool, consumables).",
                isTrue: true,
            },
            enhanceSim: {
                id: "enhanceSim",
                desc: "Tooltip of equipment with enhancement level: Enhancing simulator calculations.",
                isTrue: true,
            },
            notifiEmptyAction: {
                id: "notifiEmptyAction",
                desc: "Browser notification: Action queue is empty. (Works only when the game page is open.)",
                isTrue: false,
            },
            fillMarketOrderPrice: {
                id: "fillMarketOrderPrice",
                desc: "Automatically input price with the smallest increasement/decreasement when posting marketplace bid/sell orders.",
                isTrue: true,
            },
            enhancementTracker: {
                id: "enhancementTracker",
                desc: "Enhancement: Track enhancement attempts, costs, and statistics across multiple sessions.",
                isTrue: false,
            },
            enhancementTracker_showOnlyOnEnhancingScreen: {
                id: "enhancementTracker_showOnlyOnEnhancingScreen",
                desc: "Enhancement Tracker: Show tracker only on Enhancing screen (hides when viewing other screens).",
                isTrue: false,
            },
        };

        // === FEATURE REGISTRY ===
        // Feature toggles with metadata for future UI
        this.features = {
            // Market Features
            tooltipPrices: {
                enabled: true,
                name: 'Market Prices in Tooltips',
                category: 'Market',
                description: 'Shows bid/ask prices in item tooltips',
                settingKey: 'itemTooltip_prices'
            },
            tooltipProfit: {
                enabled: true,
                name: 'Profit Calculator in Tooltips',
                category: 'Market',
                description: 'Shows production cost and profit in tooltips',
                settingKey: 'itemTooltip_profit'
            },
            tooltipConsumables: {
                enabled: true,
                name: 'Consumable Effects in Tooltips',
                category: 'Market',
                description: 'Shows buff effects and durations for food/drinks',
                settingKey: 'showConsumTips'
            },
            expectedValueCalculator: {
                enabled: true,
                name: 'Expected Value Calculator',
                category: 'Market',
                description: 'Shows EV for openable containers (crates, chests)',
                settingKey: 'itemTooltip_expectedValue'
            },

            // Action Features
            actionTimeDisplay: {
                enabled: true,
                name: 'Action Queue Time Display',
                category: 'Actions',
                description: 'Shows total time and completion time for queued actions',
                settingKey: 'totalActionTime'
            },
            quickInputButtons: {
                enabled: true,
                name: 'Quick Input Buttons',
                category: 'Actions',
                description: 'Adds 1/10/100/1000 buttons to action inputs',
                settingKey: 'actionPanel_totalTime_quickInputs'
            },
            actionPanelProfit: {
                enabled: true,
                name: 'Action Profit Display',
                category: 'Actions',
                description: 'Shows profit/loss for gathering and production',
                settingKey: 'actionPanel_foragingTotal'
            },

            // Combat Features
            abilityBookCalculator: {
                enabled: true,
                name: 'Ability Book Requirements',
                category: 'Combat',
                description: 'Shows books needed to reach target level',
                settingKey: 'skillbook'
            },
            zoneIndices: {
                enabled: true,
                name: 'Combat Zone Indices',
                category: 'Combat',
                description: 'Shows zone numbers in combat location list',
                settingKey: 'mapIndex'
            },
            taskZoneIndices: {
                enabled: true,
                name: 'Task Zone Indices',
                category: 'Tasks',
                description: 'Shows zone numbers on combat tasks',
                settingKey: 'taskMapIndex'
            },
            combatScore: {
                enabled: true,
                name: 'Profile Gear Score',
                category: 'Combat',
                description: 'Shows gear score on profile',
                settingKey: 'combatScore'
            },
            combatSimIntegration: {
                enabled: true,
                name: 'Combat Simulator Integration',
                category: 'Combat',
                description: 'Auto-import character/party data into Shykai Combat Simulator',
                settingKey: null // New feature, no legacy setting
            },
            enhancementSimulator: {
                enabled: true,
                name: 'Enhancement Simulator',
                category: 'Market',
                description: 'Shows enhancement cost calculations in item tooltips',
                settingKey: 'enhanceSim'
            },

            // UI Features
            equipmentLevelDisplay: {
                enabled: true,
                name: 'Equipment Level on Icons',
                category: 'UI',
                description: 'Shows item level number on equipment icons',
                settingKey: 'itemIconLevel'
            },
            alchemyItemDimming: {
                enabled: true,
                name: 'Alchemy Item Dimming',
                category: 'UI',
                description: 'Dims items requiring higher Alchemy level',
                settingKey: 'alchemyItemDimming'
            },
            skillExperiencePercentage: {
                enabled: true,
                name: 'Skill Experience Percentage',
                category: 'UI',
                description: 'Shows XP progress percentage in left sidebar',
                settingKey: 'expPercentage'
            },

            // Task Features
            taskProfitDisplay: {
                enabled: true,
                name: 'Task Profit Calculator',
                category: 'Tasks',
                description: 'Shows expected profit from task rewards',
                settingKey: 'taskProfitCalculator'
            },
            taskRerollTracker: {
                enabled: true,
                name: 'Task Reroll Tracker',
                category: 'Tasks',
                description: 'Tracks reroll costs and history',
                settingKey: 'taskRerollTracker'
            },

            // House Features
            houseCostDisplay: {
                enabled: true,
                name: 'House Upgrade Costs',
                category: 'House',
                description: 'Shows market value of upgrade materials',
                settingKey: 'houseUpgradeCosts'
            },

            // Economy Features
            networth: {
                enabled: true,
                name: 'Net Worth Calculator',
                category: 'Economy',
                description: 'Shows total asset value in header (Current Assets)',
                settingKey: 'networth'
            },
            inventorySummary: {
                enabled: true,
                name: 'Inventory Summary Panel',
                category: 'Economy',
                description: 'Shows detailed networth breakdown below inventory',
                settingKey: 'invWorth'
            },
            inventorySort: {
                enabled: true,
                name: 'Inventory Sort',
                category: 'Economy',
                description: 'Sorts inventory by Ask/Bid price',
                settingKey: 'invSort'
            },
            inventorySortBadges: {
                enabled: false,
                name: 'Inventory Sort Price Badges',
                category: 'Economy',
                description: 'Shows stack value badges on items',
                settingKey: 'invSort_showBadges'
            },

            // Enhancement Features
            enhancementTracker: {
                enabled: false,
                name: 'Enhancement Tracker',
                category: 'Enhancement',
                description: 'Tracks enhancement attempts, costs, and statistics',
                settingKey: 'enhancementTracker'
            }
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
        const saved = await storage.getJSON('script_settingsMap', 'settings', null);

        if (saved) {
            // Merge saved settings with defaults
            for (const option of Object.values(saved)) {
                if (this.settingsMap.hasOwnProperty(option.id)) {
                    // Load both isTrue (boolean settings) and value (numeric/string settings)
                    if (option.hasOwnProperty('isTrue')) {
                        this.settingsMap[option.id].isTrue = option.isTrue;
                    }
                    if (option.hasOwnProperty('value')) {
                        this.settingsMap[option.id].value = option.value;
                    }
                }
            }
        }
    }

    /**
     * Save settings to storage (immediately)
     */
    saveSettings() {
        storage.setJSON('script_settingsMap', this.settingsMap, 'settings', true);
    }

    /**
     * Apply color customization based on settings
     */
    applyColorSettings() {
        if (this.settingsMap.useOrangeAsMainColor.isTrue) {
            this.SCRIPT_COLOR_MAIN = "gold";
            this.SCRIPT_COLOR_TOOLTIP = "#806B00";
        }
    }

    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {boolean} Setting value
     */
    getSetting(key) {
        return this.settingsMap[key]?.isTrue ?? false;
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
        }
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
            this.settingsMap[key].isTrue = (key === 'notifiEmptyAction') ? false : true;
        }

        this.saveSettings();
        this.applyColorSettings();
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
                enabled: this.isFeatureEnabled(key)
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
            enabled: this.isFeatureEnabled(featureKey)
        };
    }
}

// Create and export singleton instance
const config = new Config();

export default config;

// Also export the class for testing
export { Config };
