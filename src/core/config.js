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
                desc: "Action panel: Quick input numbers. [Depends on the previous selection]",
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
            profileBuildScore: {
                id: "profileBuildScore",
                desc: "Profile panel: Build score.",
                isTrue: true,
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
            battlePanel: {
                id: "battlePanel",
                desc: "Battle info panel(click on player avatar during combat): Encounters/hour, revenue, exp.",
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
            ThirdPartyLinks: {
                id: "ThirdPartyLinks",
                desc: "Left sidebar: Links to 3rd-party websites, script settings.",
                isTrue: true,
            },
            actionQueue: {
                id: "actionQueue",
                desc: "Queued actions panel at the top: Estimated total time and complete time of each queued action.",
                isTrue: true,
            },
            enhanceSim: {
                id: "enhanceSim",
                desc: "Tooltip of equipment with enhancement level: Enhancing simulator calculations.",
                isTrue: true,
            },
            checkEquipment: {
                id: "checkEquipment",
                desc: "Top: Alert message when combating with production equipments equipted, or producing when there are unequipted corresponding production equipment in the inventory.",
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
            showDamage: {
                id: "showDamage",
                desc: "Bottom of player avatar during combat: DPS.",
                isTrue: true,
            },
            showDamageGraph: {
                id: "showDamageGraph",
                desc: "Floating window during combat: DPS chart. [Depends on the previous selection]",
                isTrue: true,
            },
            damageGraphTransparentBackground: {
                id: "damageGraphTransparentBackground",
                desc: "DPS chart transparent and blur background. [Depends on the previous selection]",
                isTrue: true,
            },
        };

        // Load settings from storage
        this.loadSettings();

        // Apply color settings
        this.applyColorSettings();
    }

    /**
     * Load settings from storage
     */
    loadSettings() {
        const saved = storage.getJSON('script_settingsMap', null);

        if (saved) {
            // Merge saved settings with defaults
            for (const option of Object.values(saved)) {
                if (this.settingsMap.hasOwnProperty(option.id)) {
                    this.settingsMap[option.id].isTrue = option.isTrue;
                }
            }
        }
    }

    /**
     * Save settings to storage
     */
    saveSettings() {
        storage.setJSON('script_settingsMap', this.settingsMap);
    }

    /**
     * Apply color customization based on settings
     */
    applyColorSettings() {
        if (this.settingsMap.useOrangeAsMainColor.isTrue) {
            this.SCRIPT_COLOR_MAIN = "orange";
            this.SCRIPT_COLOR_TOOLTIP = "#804600";
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
}

// Create and export singleton instance
const config = new Config();

export default config;

// Also export the class for testing
export { Config };
