// ==UserScript==
// @name         Toolasha
// @namespace    http://tampermonkey.net/
// @version      0.4.79
// @description  Toolasha - Enhanced tools for Milky Way Idle.
// @author       Celasha and Claude, thank you to bot7420, DrDucky, Frotty, Truth_Light, AlphB for providing the basis for a lot of this. Thank you to Miku, Orvel, Jigglymoose, Incinarator, Knerd, and others for their time and help. Special thanks to Zaeter for the name. 
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js
// @require      https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js
// @downloadURL https://update.greasyfork.org/scripts/494467/MWITools.user.js
// @updateURL https://update.greasyfork.org/scripts/494467/MWITools.meta.js
// ==/UserScript==
// Note: GM_getValue/GM_setValue removed - now using IndexedDB for storage

(function () {
    'use strict';

    (function() {
    "use strict";


    /**
     * Centralized IndexedDB Storage
     * Replaces GM storage with IndexedDB for better performance and Chromium compatibility
     * Provides debounced writes to reduce I/O operations
     */

    class Storage {
        constructor() {
            this.db = null;
            this.available = false;
            this.dbName = 'ToolashaDB';
            this.dbVersion = 2;
            this.saveDebounceTimers = new Map(); // Per-key debounce timers
            this.SAVE_DEBOUNCE_DELAY = 3000; // 3 seconds
        }

        /**
         * Initialize the storage system
         * @returns {Promise<boolean>} Success status
         */
        async initialize() {
            try {
                await this.openDatabase();
                this.available = true;
                return true;
            } catch (error) {
                console.error('[Storage] Initialization failed:', error);
                this.available = false;
                return false;
            }
        }

        /**
         * Open IndexedDB database
         * @returns {Promise<void>}
         */
        openDatabase() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = () => {
                    console.error('[Storage] Failed to open IndexedDB');
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create settings store if it doesn't exist
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings');
                    }

                    // Create rerollSpending store if it doesn't exist (for task reroll tracker)
                    if (!db.objectStoreNames.contains('rerollSpending')) {
                        db.createObjectStore('rerollSpending');
                    }
                };
            });
        }

        /**
         * Get a value from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The stored value or default
         */
        async get(key, storeName = 'settings', defaultValue = null) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, returning default for key: ${key}`);
                return defaultValue;
            }

            return new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.get(key);

                    request.onsuccess = () => {
                        resolve(request.result !== undefined ? request.result : defaultValue);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get key ${key}:`, request.error);
                        resolve(defaultValue);
                    };
                } catch (error) {
                    console.error(`[Storage] Get transaction failed for key ${key}:`, error);
                    resolve(defaultValue);
                }
            });
        }

        /**
         * Set a value in storage (debounced by default)
         * @param {string} key - Storage key
         * @param {*} value - Value to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately without debouncing
         * @returns {Promise<boolean>} Success status
         */
        async set(key, value, storeName = 'settings', immediate = false) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot save key: ${key}`);
                return false;
            }

            if (immediate) {
                return this._saveToIndexedDB(key, value, storeName);
            } else {
                return this._debouncedSave(key, value, storeName);
            }
        }

        /**
         * Internal: Save to IndexedDB (immediate)
         * @private
         */
        async _saveToIndexedDB(key, value, storeName) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.put(value, key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to save key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Save transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Internal: Debounced save
         * @private
         */
        _debouncedSave(key, value, storeName) {
            const timerKey = `${storeName}:${key}`;

            // Clear existing timer for this key
            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
            }

            // Return a promise that resolves when save completes
            return new Promise((resolve) => {
                const timer = setTimeout(async () => {
                    const success = await this._saveToIndexedDB(key, value, storeName);
                    this.saveDebounceTimers.delete(timerKey);
                    resolve(success);
                }, this.SAVE_DEBOUNCE_DELAY);

                this.saveDebounceTimers.set(timerKey, timer);
            });
        }

        /**
         * Get a JSON object from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The parsed object or default
         */
        async getJSON(key, storeName = 'settings', defaultValue = null) {
            const raw = await this.get(key, storeName, null);

            if (raw === null) {
                return defaultValue;
            }

            // If it's already an object, return it
            if (typeof raw === 'object') {
                return raw;
            }

            // Otherwise, try to parse as JSON string
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.error(`[Storage] Error parsing JSON from storage (key: ${key}):`, error);
                return defaultValue;
            }
        }

        /**
         * Set a JSON object in storage
         * @param {string} key - Storage key
         * @param {*} value - Object to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately
         * @returns {Promise<boolean>} Success status
         */
        async setJSON(key, value, storeName = 'settings', immediate = false) {
            // IndexedDB can store objects directly, no need to stringify
            return this.set(key, value, storeName, immediate);
        }

        /**
         * Delete a key from storage
         * @param {string} key - Storage key to delete
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} Success status
         */
        async delete(key, storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot delete key: ${key}`);
                return false;
            }

            return new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.delete(key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to delete key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Delete transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Check if a key exists in storage
         * @param {string} key - Storage key to check
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} True if key exists
         */
        async has(key, storeName = 'settings') {
            if (!this.db) {
                return false;
            }

            const value = await this.get(key, storeName, '__STORAGE_CHECK__');
            return value !== '__STORAGE_CHECK__';
        }

        /**
         * Force immediate save of all pending debounced writes
         */
        async flushAll() {
            const timers = Array.from(this.saveDebounceTimers.keys());

            for (const timerKey of timers) {
                const timer = this.saveDebounceTimers.get(timerKey);
                if (timer) {
                    clearTimeout(timer);
                    this.saveDebounceTimers.delete(timerKey);
                }
            }
        }
    }

    // Create and export singleton instance
    const storage = new Storage();

    /**
     * Configuration Module
     * Manages all script constants and user settings
     */


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

    /**
     * WebSocket Hook Module
     * Intercepts WebSocket messages from the MWI game server
     *
     * CRITICAL: This hooks MessageEvent.prototype.data - must not break game!
     */

    class WebSocketHook {
        constructor() {
            this.originalGet = null;
            this.isHooked = false;
            this.messageHandlers = new Map();
        }

        /**
         * Install the WebSocket hook
         * MUST be called before WebSocket connection is established
         */
        install() {
            if (this.isHooked) {
                console.warn('[WebSocket Hook] Already installed');
                return;
            }

            // Get the original data property getter
            const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
            this.originalGet = dataProperty.get;

            // Capture hook instance in closure (so hookedGet can access it)
            const hookInstance = this;

            // Replace with our hooked version
            // IMPORTANT: Don't use arrow function or bind() - 'this' must be MessageEvent
            dataProperty.get = function hookedGet() {
                // 'this' is the MessageEvent instance
                const socket = this.currentTarget;

                // Only hook WebSocket messages
                if (!(socket instanceof WebSocket)) {
                    return hookInstance.originalGet.call(this);
                }

                // Only hook MWI game server WebSocket
                const isMWIWebSocket =
                    socket.url.indexOf("api.milkywayidle.com/ws") > -1 ||
                    socket.url.indexOf("api-test.milkywayidle.com/ws") > -1;

                if (!isMWIWebSocket) {
                    return hookInstance.originalGet.call(this);
                }

                // Get the original message
                const message = hookInstance.originalGet.call(this);

                // Anti-loop: Define data property so we don't hook it again
                Object.defineProperty(this, "data", { value: message });

                // Process the message (doesn't modify it)
                hookInstance.processMessage(message);

                // Return original message (game continues normally)
                return message;
            };

            Object.defineProperty(MessageEvent.prototype, "data", dataProperty);

            this.isHooked = true;
        }

        /**
         * Process intercepted message
         * @param {string} message - JSON string from WebSocket
         */
        processMessage(message) {
            try {
                const data = JSON.parse(message);
                const messageType = data.type;

                // Save critical data to GM storage for Combat Sim export
                this.saveCombatSimData(messageType, message);

                // Call registered handlers for this message type
                const handlers = this.messageHandlers.get(messageType) || [];
                for (const handler of handlers) {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${messageType}:`, error);
                    }
                }

                // Call wildcard handlers (receive all messages)
                const wildcardHandlers = this.messageHandlers.get('*') || [];
                for (const handler of wildcardHandlers) {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error('[WebSocket] Wildcard handler error:', error);
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Failed to process message:', error);
            }
        }

        /**
         * Save character/battle data for Combat Simulator export
         * @param {string} messageType - Message type
         * @param {string} message - Raw message JSON string
         */
        saveCombatSimData(messageType, message) {
            try {
                if (typeof GM_setValue === 'undefined') {
                    return; // GM functions not available
                }

                // Save full character data (on login/refresh)
                if (messageType === 'init_character_data') {
                    GM_setValue('toolasha_init_character_data', message);
                    console.log('[Toolasha] Character data saved for Combat Sim export');
                }

                // Save client data (for ability special detection)
                if (messageType === 'init_client_data') {
                    GM_setValue('toolasha_init_client_data', message);
                    console.log('[Toolasha] Client data saved for Combat Sim export');
                }

                // Save battle data including party members (on combat start)
                if (messageType === 'new_battle') {
                    GM_setValue('toolasha_new_battle', message);
                    console.log('[Toolasha] Battle data saved for Combat Sim export');
                }

                // Save profile shares (when opening party member profiles)
                if (messageType === 'profile_shared') {
                    const parsed = JSON.parse(message);
                    let profileList = JSON.parse(GM_getValue('toolasha_profile_export_list', '[]'));

                    // Extract character info
                    parsed.characterID = parsed.profile.characterSkills[0].characterID;
                    parsed.characterName = parsed.profile.sharableCharacter.name;
                    parsed.timestamp = Date.now();

                    // Remove old entry for same character
                    profileList = profileList.filter(p => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    GM_setValue('toolasha_profile_export_list', JSON.stringify(profileList));
                    console.log('[Toolasha] Profile saved for Combat Sim export:', parsed.characterName);
                }
            } catch (error) {
                console.error('[WebSocket] Failed to save Combat Sim data:', error);
            }
        }

        /**
         * Capture init_client_data from localStorage (fallback method)
         * Called periodically since it may not come through WebSocket
         */
        captureClientDataFromLocalStorage() {
            try {
                if (typeof GM_setValue === 'undefined') {
                    return;
                }

                const initClientData = localStorage.getItem('initClientData');
                if (!initClientData) {
                    // Try again in 2 seconds
                    setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                    return;
                }

                let clientDataStr = initClientData;
                let isCompressed = false;

                // Check if compressed
                try {
                    JSON.parse(initClientData);
                } catch (e) {
                    isCompressed = true;
                }

                // Decompress if needed
                if (isCompressed) {
                    if (typeof window.LZString === 'undefined' && typeof LZString === 'undefined') {
                        // LZString not loaded yet, try again later
                        setTimeout(() => this.captureClientDataFromLocalStorage(), 500);
                        return;
                    }

                    try {
                        const LZ = window.LZString || LZString;
                        clientDataStr = LZ.decompressFromUTF16(initClientData);
                    } catch (e) {
                        setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                        return;
                    }
                }

                // Parse and save
                try {
                    const clientDataObj = JSON.parse(clientDataStr);
                    if (clientDataObj?.type === 'init_client_data') {
                        GM_setValue('toolasha_init_client_data', clientDataStr);
                        console.log('[Toolasha] Client data captured from localStorage');
                    }
                } catch (e) {
                    setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                }
            } catch (error) {
                console.error('[WebSocket] Failed to capture client data from localStorage:', error);
            }
        }

        /**
         * Register a handler for a specific message type
         * @param {string} messageType - Message type to handle (e.g., "init_character_data")
         * @param {Function} handler - Function to call when message received
         */
        on(messageType, handler) {
            if (!this.messageHandlers.has(messageType)) {
                this.messageHandlers.set(messageType, []);
            }
            this.messageHandlers.get(messageType).push(handler);
        }

        /**
         * Unregister a handler
         * @param {string} messageType - Message type
         * @param {Function} handler - Handler function to remove
         */
        off(messageType, handler) {
            const handlers = this.messageHandlers.get(messageType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }
    }

    // Create and export singleton instance
    const webSocketHook = new WebSocketHook();

    /**
     * Centralized DOM Observer
     * Single MutationObserver that dispatches to registered handlers
     * Replaces 15 separate observers watching document.body
     * Supports optional debouncing to reduce CPU usage during bulk DOM changes
     */

    class DOMObserver {
        constructor() {
            this.observer = null;
            this.handlers = [];
            this.isObserving = false;
            this.debounceTimers = new Map(); // Track debounce timers per handler
            this.debouncedElements = new Map(); // Track pending elements per handler
            this.DEFAULT_DEBOUNCE_DELAY = 50; // 50ms default delay
        }

        /**
         * Start observing DOM changes
         */
        start() {
            if (this.isObserving) return;

            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        // Dispatch to all registered handlers
                        this.handlers.forEach(handler => {
                            try {
                                if (handler.debounce) {
                                    this.debouncedCallback(handler, node, mutation);
                                } else {
                                    handler.callback(node, mutation);
                                }
                            } catch (error) {
                                console.error(`[DOM Observer] Handler error (${handler.name}):`, error);
                            }
                        });
                    }
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.isObserving = true;
        }

        /**
         * Debounced callback handler
         * Collects elements and fires callback after delay
         * @private
         */
        debouncedCallback(handler, node, mutation) {
            const handlerName = handler.name;
            const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

            // Store element for batched processing
            if (!this.debouncedElements.has(handlerName)) {
                this.debouncedElements.set(handlerName, []);
            }
            this.debouncedElements.get(handlerName).push({ node, mutation });

            // Clear existing timer
            if (this.debounceTimers.has(handlerName)) {
                clearTimeout(this.debounceTimers.get(handlerName));
            }

            // Set new timer
            const timer = setTimeout(() => {
                const elements = this.debouncedElements.get(handlerName) || [];
                this.debouncedElements.delete(handlerName);
                this.debounceTimers.delete(handlerName);

                // Process all collected elements
                // For most handlers, we only need to process the last element
                // (e.g., task list updated multiple times, we only care about final state)
                if (elements.length > 0) {
                    const lastElement = elements[elements.length - 1];
                    handler.callback(lastElement.node, lastElement.mutation);
                }
            }, delay);

            this.debounceTimers.set(handlerName, timer);
        }

        /**
         * Stop observing DOM changes
         */
        stop() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Clear all debounce timers
            this.debounceTimers.forEach(timer => clearTimeout(timer));
            this.debounceTimers.clear();
            this.debouncedElements.clear();

            this.isObserving = false;
        }

        /**
         * Register a handler for DOM changes
         * @param {string} name - Handler name for debugging
         * @param {Function} callback - Function to call when nodes are added (receives node, mutation)
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        register(name, callback, options = {}) {
            const handler = {
                name,
                callback,
                debounce: options.debounce || false,
                debounceDelay: options.debounceDelay
            };
            this.handlers.push(handler);

            // Return unregister function
            return () => {
                const index = this.handlers.indexOf(handler);
                if (index > -1) {
                    this.handlers.splice(index, 1);

                    // Clean up any pending debounced callbacks
                    if (this.debounceTimers.has(name)) {
                        clearTimeout(this.debounceTimers.get(name));
                        this.debounceTimers.delete(name);
                        this.debouncedElements.delete(name);
                    }
                }
            };
        }

        /**
         * Register a handler for specific class names
         * @param {string} name - Handler name for debugging
         * @param {string|string[]} classNames - Class name(s) to watch for (supports partial matches)
         * @param {Function} callback - Function to call when matching elements appear
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false for immediate response)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        onClass(name, classNames, callback, options = {}) {
            const classArray = Array.isArray(classNames) ? classNames : [classNames];

            return this.register(name, (node) => {
                // Safely get className as string (handles SVG elements)
                const className = typeof node.className === 'string' ? node.className : '';

                // Check if node matches any of the target classes
                for (const targetClass of classArray) {
                    if (className.includes(targetClass)) {
                        callback(node);
                        return; // Only call once per node
                    }
                }

                // Also check if node contains matching elements
                if (node.querySelector) {
                    for (const targetClass of classArray) {
                        const matches = node.querySelectorAll(`[class*="${targetClass}"]`);
                        matches.forEach(match => callback(match));
                    }
                }
            }, options);
        }

        /**
         * Get stats about registered handlers
         */
        getStats() {
            return {
                isObserving: this.isObserving,
                handlerCount: this.handlers.length,
                handlers: this.handlers.map(h => ({
                    name: h.name,
                    debounced: h.debounce || false
                })),
                pendingCallbacks: this.debounceTimers.size
            };
        }
    }

    // Create singleton instance
    const domObserver = new DOMObserver();

    /**
     * Data Manager Module
     * Central hub for accessing game data
     *
     * Uses official API: localStorageUtil.getInitClientData()
     * Listens to WebSocket messages for player data updates
     */


    class DataManager {
        constructor() {
            this.webSocketHook = webSocketHook;

            // Static game data (items, actions, monsters, abilities, etc.)
            this.initClientData = null;

            // Player data (updated via WebSocket)
            this.characterData = null;
            this.characterSkills = null;
            this.characterItems = null;
            this.characterActions = [];
            this.characterEquipment = new Map();
            this.characterHouseRooms = new Map();  // House room HRID -> {houseRoomHrid, level}
            this.actionTypeDrinkSlotsMap = new Map();  // Action type HRID -> array of drink items

            // Event listeners
            this.eventListeners = new Map();

            // Retry interval for loading static game data
            this.loadRetryInterval = null;

            // Setup WebSocket message handlers
            this.setupMessageHandlers();
        }

        /**
         * Initialize the Data Manager
         * Call this after game loads (or immediately - will retry if needed)
         */
        initialize() {
            // Try to load static game data using official API
            const success = this.tryLoadStaticData();

            // If failed, set up retry polling
            if (!success && !this.loadRetryInterval) {
                this.loadRetryInterval = setInterval(() => {
                    if (this.tryLoadStaticData()) {
                        // Success! Stop retrying
                        clearInterval(this.loadRetryInterval);
                        this.loadRetryInterval = null;
                    }
                }, 500); // Retry every 500ms
            }

            // FALLBACK: Check if character is already loaded (Firefox race condition fix)
            // On Firefox, init_character_data may fire before our WebSocket hook is ready
            // If character data exists in localStorage, manually trigger initialization
            setTimeout(() => {
                if (!this.characterData && typeof localStorageUtil !== 'undefined') {
                    try {
                        // Try to get character info from localStorage directly
                        const rawData = localStorage.getItem('character');
                        if (rawData) {
                            const characterData = JSON.parse(LZString.decompressFromUTF16(rawData));
                            if (characterData && characterData.characterSkills) {
                                console.log('[DataManager] Detected missed init_character_data, manually triggering initialization');

                                // Populate data manager with existing character data
                                this.characterData = characterData;
                                this.characterSkills = characterData.characterSkills;
                                this.characterItems = characterData.characterItems;
                                this.characterActions = characterData.characterActions ? [...characterData.characterActions] : [];

                                // Build equipment map
                                this.updateEquipmentMap(characterData.characterItems);

                                // Build house room map
                                this.updateHouseRoomMap(characterData.characterHouseRoomMap);

                                // Build drink slots map
                                this.updateDrinkSlotsMap(characterData.actionTypeDrinkSlotsMap);

                                // Fire character_initialized event
                                this.emit('character_initialized', characterData);
                            }
                        }
                    } catch (error) {
                        console.warn('[DataManager] Fallback initialization failed:', error);
                    }
                }
            }, 2000); // Wait 2 seconds for normal WebSocket message, then check
        }

        /**
         * Attempt to load static game data
         * @returns {boolean} True if successful, false if needs retry
         * @private
         */
        tryLoadStaticData() {
            try {
                if (typeof localStorageUtil !== 'undefined' &&
                    typeof localStorageUtil.getInitClientData === 'function') {
                    const data = localStorageUtil.getInitClientData();
                    if (data && Object.keys(data).length > 0) {
                        this.initClientData = data;
                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('[Data Manager] Failed to load init_client_data:', error);
                return false;
            }
        }

        /**
         * Setup WebSocket message handlers
         * Listens for game data updates
         */
        setupMessageHandlers() {
            // Handle init_character_data (player data on login/refresh)
            this.webSocketHook.on('init_character_data', (data) => {
                this.characterData = data;
                this.characterSkills = data.characterSkills;
                this.characterItems = data.characterItems;
                this.characterActions = [...data.characterActions];

                // Build equipment map
                this.updateEquipmentMap(data.characterItems);

                // Build house room map
                this.updateHouseRoomMap(data.characterHouseRoomMap);

                // Build drink slots map (tea buffs)
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

                this.emit('character_initialized', data);
            });

            // Handle actions_updated (action queue changes)
            this.webSocketHook.on('actions_updated', (data) => {
                // Update action list
                for (const action of data.endCharacterActions) {
                    if (action.isDone === false) {
                        this.characterActions.push(action);
                    } else {
                        this.characterActions = this.characterActions.filter(a => a.id !== action.id);
                    }
                }

                this.emit('actions_updated', data);
            });

            // Handle action_completed (action progress)
            this.webSocketHook.on('action_completed', (data) => {
                const action = data.endCharacterAction;
                if (action.isDone === false) {
                    for (const a of this.characterActions) {
                        if (a.id === action.id) {
                            a.currentCount = action.currentCount;
                        }
                    }
                }

                this.emit('action_completed', data);
            });

            // Handle items_updated (inventory/equipment changes)
            this.webSocketHook.on('items_updated', (data) => {
                if (data.endCharacterItems) {
                    this.updateEquipmentMap(data.endCharacterItems);
                }

                this.emit('items_updated', data);
            });

            // Handle action_type_consumable_slots_updated (when user changes tea assignments)
            this.webSocketHook.on('action_type_consumable_slots_updated', (data) => {

                // Update drink slots map with new consumables
                if (data.actionTypeDrinkSlotsMap) {
                    this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
                }

                this.emit('consumables_updated', data);
            });

            // Handle consumable_buffs_updated (when buffs expire/refresh)
            this.webSocketHook.on('consumable_buffs_updated', (data) => {

                // Buffs updated - next hover will show updated values
                this.emit('buffs_updated', data);
            });

            // Handle house_rooms_updated (when user upgrades house rooms)
            this.webSocketHook.on('house_rooms_updated', (data) => {

                // Update house room map with new levels
                if (data.characterHouseRoomMap) {
                    this.updateHouseRoomMap(data.characterHouseRoomMap);
                }

                this.emit('house_rooms_updated', data);
            });

            // Handle skills_updated (when user gains skill levels)
            this.webSocketHook.on('skills_updated', (data) => {

                // Update character skills with new levels
                if (data.characterSkills) {
                    this.characterSkills = data.characterSkills;
                }

                this.emit('skills_updated', data);
            });
        }

        /**
         * Update equipment map from character items
         * @param {Array} items - Character items array
         */
        updateEquipmentMap(items) {
            for (const item of items) {
                if (item.itemLocationHrid !== "/item_locations/inventory") {
                    if (item.count === 0) {
                        this.characterEquipment.delete(item.itemLocationHrid);
                    } else {
                        this.characterEquipment.set(item.itemLocationHrid, item);
                    }
                }
            }
        }

        /**
         * Update house room map from character house room data
         * @param {Object} houseRoomMap - Character house room map
         */
        updateHouseRoomMap(houseRoomMap) {
            if (!houseRoomMap) {
                return;
            }

            this.characterHouseRooms.clear();
            for (const [hrid, room] of Object.entries(houseRoomMap)) {
                this.characterHouseRooms.set(room.houseRoomHrid, room);
            }

        }

        /**
         * Update drink slots map from character data
         * @param {Object} drinkSlotsMap - Action type drink slots map
         */
        updateDrinkSlotsMap(drinkSlotsMap) {
            if (!drinkSlotsMap) {
                return;
            }

            this.actionTypeDrinkSlotsMap.clear();
            for (const [actionTypeHrid, drinks] of Object.entries(drinkSlotsMap)) {
                this.actionTypeDrinkSlotsMap.set(actionTypeHrid, drinks || []);
            }

        }

        /**
         * Get static game data
         * @returns {Object} Init client data (items, actions, monsters, etc.)
         */
        getInitClientData() {
            return this.initClientData;
        }

        /**
         * Get combined game data (static + character)
         * Used for features that need both static data and player data
         * @returns {Object} Combined data object
         */
        getCombinedData() {
            if (!this.initClientData) {
                return null;
            }

            return {
                ...this.initClientData,
                // Character-specific data
                characterItems: this.characterItems || [],
                myMarketListings: this.characterData?.myMarketListings || [],
                characterHouseRoomMap: Object.fromEntries(this.characterHouseRooms),
                characterAbilities: this.characterData?.characterAbilities || [],
                equippedAbilities: this.characterData?.equippedAbilities || []
            };
        }

        /**
         * Get item details by HRID
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @returns {Object|null} Item details
         */
        getItemDetails(itemHrid) {
            return this.initClientData?.itemDetailMap?.[itemHrid] || null;
        }

        /**
         * Get action details by HRID
         * @param {string} actionHrid - Action HRID (e.g., "/actions/milking/cow")
         * @returns {Object|null} Action details
         */
        getActionDetails(actionHrid) {
            return this.initClientData?.actionDetailMap?.[actionHrid] || null;
        }

        /**
         * Get player's current actions
         * @returns {Array} Current action queue
         */
        getCurrentActions() {
            return [...this.characterActions];
        }

        /**
         * Get player's equipped items
         * @returns {Map} Equipment map (slot HRID -> item)
         */
        getEquipment() {
            return new Map(this.characterEquipment);
        }

        /**
         * Get player's house rooms
         * @returns {Map} House room map (room HRID -> {houseRoomHrid, level})
         */
        getHouseRooms() {
            return new Map(this.characterHouseRooms);
        }

        /**
         * Get house room level
         * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
         * @returns {number} Room level (0 if not found)
         */
        getHouseRoomLevel(houseRoomHrid) {
            const room = this.characterHouseRooms.get(houseRoomHrid);
            return room?.level || 0;
        }

        /**
         * Get active drink items for an action type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
         * @returns {Array} Array of drink items (empty if none)
         */
        getActionDrinkSlots(actionTypeHrid) {
            return this.actionTypeDrinkSlotsMap.get(actionTypeHrid) || [];
        }

        /**
         * Get community buff level
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/community_buff_types/production_efficiency")
         * @returns {number} Buff level (0 if not active)
         */
        getCommunityBuffLevel(buffTypeHrid) {
            if (!this.characterData?.communityBuffs) {
                return 0;
            }

            const buff = this.characterData.communityBuffs.find(b => b.hrid === buffTypeHrid);
            return buff?.level || 0;
        }

        /**
         * Get achievement buffs for an action type
         * Achievement buffs are provided by the game based on completed achievement tiers
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @returns {Object} Buff object with stat bonuses (e.g., {gatheringQuantity: 0.02}) or empty object
         */
        getAchievementBuffs(actionTypeHrid) {
            if (!this.characterData?.achievementActionTypeBuffsMap) {
                return {};
            }

            return this.characterData.achievementActionTypeBuffsMap[actionTypeHrid] || {};
        }

        /**
         * Get player's skills
         * @returns {Array|null} Character skills
         */
        getSkills() {
            return this.characterSkills ? [...this.characterSkills] : null;
        }

        /**
         * Get player's inventory
         * @returns {Array|null} Character items
         */
        getInventory() {
            return this.characterItems ? [...this.characterItems] : null;
        }

        /**
         * Register event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Emit event to all listeners
         * @param {string} event - Event name
         * @param {*} data - Event data
         */
        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`[Data Manager] Error in ${event} listener:`, error);
                }
            }
        }
    }

    // Create and export singleton instance
    const dataManager = new DataManager();

    /**
     * Network Alert Display
     * Shows a warning message when market data cannot be fetched
     */


    class NetworkAlert {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.isVisible = false;
        }

        /**
         * Initialize network alert display
         */
        initialize() {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            // 1. Check if header exists already
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.prepareContainer(existingElem);
            }

            // 2. Watch for header to appear (handles SPA navigation)
            const unregister = domObserver.onClass(
                'NetworkAlert',
                'Header_totalLevel',
                (elem) => {
                    this.prepareContainer(elem);
                }
            );
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Prepare container but don't show yet
         * @param {Element} totalLevelElem - Total level element
         */
        prepareContainer(totalLevelElem) {
            // Check if already prepared
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container (hidden by default)
            this.container = document.createElement('div');
            this.container.className = 'mwi-network-alert';
            this.container.style.cssText = `
            display: none;
            font-size: 0.875rem;
            font-weight: 500;
            color: #ff4444;
            text-wrap: nowrap;
            margin-left: 16px;
        `;

            // Insert after total level (or after networth if it exists)
            const networthElem = totalLevelElem.parentElement.querySelector('.mwi-networth-header');
            if (networthElem) {
                networthElem.insertAdjacentElement('afterend', this.container);
            } else {
                totalLevelElem.insertAdjacentElement('afterend', this.container);
            }
        }

        /**
         * Show the network alert
         * @param {string} message - Alert message to display
         */
        show(message = '⚠️ Market data unavailable') {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            if (!this.container || !document.body.contains(this.container)) {
                // Try to prepare container if not ready
                const totalLevelElem = document.querySelector('[class*="Header_totalLevel"]');
                if (totalLevelElem) {
                    this.prepareContainer(totalLevelElem);
                } else {
                    // Header not found, fallback to console
                    console.warn('[Network Alert]', message);
                    return;
                }
            }

            if (this.container) {
                this.container.textContent = message;
                this.container.style.display = 'block';
                this.isVisible = true;
            }
        }

        /**
         * Hide the network alert
         */
        hide() {
            if (this.container && document.body.contains(this.container)) {
                this.container.style.display = 'none';
                this.isVisible = false;
            }
        }

        /**
         * Cleanup
         */
        disable() {
            this.hide();

            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
        }
    }

    // Create and export singleton instance
    const networkAlert = new NetworkAlert();

    /**
     * Marketplace API Module
     * Fetches and caches market price data from the MWI marketplace API
     */


    /**
     * MarketAPI class handles fetching and caching market price data
     */
    class MarketAPI {
        constructor() {
            // API endpoint
            this.API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Cache settings
            this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
            this.CACHE_KEY_DATA = 'MWITools_marketAPI_json';
            this.CACHE_KEY_TIMESTAMP = 'MWITools_marketAPI_timestamp';

            // Current market data
            this.marketData = null;
            this.lastFetchTimestamp = null;
            this.errorLog = [];
        }

        /**
         * Fetch market data from API or cache
         * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
         * @returns {Promise<Object|null>} Market data object or null if failed
         */
        async fetch(forceFetch = false) {

            // Check cache first (unless force fetch)
            if (!forceFetch) {
                const cached = await this.getCachedData();
                if (cached) {
                    this.marketData = cached.data;
                    this.lastFetchTimestamp = cached.timestamp;
                    // Hide alert on successful cache load
                    networkAlert.hide();
                    return this.marketData;
                }
            }

            // Try to fetch fresh data
            try {
                const response = await this.fetchFromAPI();

                if (response) {
                    // Cache the fresh data
                    this.cacheData(response);
                    this.marketData = response.marketData;
                    this.lastFetchTimestamp = response.timestamp;
                    // Hide alert on successful fetch
                    networkAlert.hide();
                    return this.marketData;
                }
            } catch (error) {
                this.logError('Fetch failed', error);
            }

            // Fallback: Try to use expired cache
            const expiredCache = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (expiredCache) {
                console.warn('[MarketAPI] Using expired cache as fallback');
                this.marketData = expiredCache.marketData;
                this.lastFetchTimestamp = expiredCache.timestamp;
                // Show alert when using expired cache
                networkAlert.show('⚠️ Using outdated market data');
                return this.marketData;
            }

            // Total failure - show alert
            console.error('[MarketAPI] ❌ No market data available');
            networkAlert.show('⚠️ Market data unavailable');
            return null;
        }

        /**
         * Fetch from API endpoint
         * @returns {Promise<Object|null>} API response or null
         */
        async fetchFromAPI() {
            try {
                const response = await fetch(this.API_URL);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                // Validate response structure
                if (!data.marketData || typeof data.marketData !== 'object') {
                    throw new Error('Invalid API response structure');
                }

                return data;
            } catch (error) {
                console.error('[MarketAPI] API fetch error:', error);
                throw error;
            }
        }

        /**
         * Get cached data if valid
         * @returns {Promise<Object|null>} { data, timestamp } or null if invalid/expired
         */
        async getCachedData() {
            const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
            const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

            if (!cachedTimestamp || !cachedData) {
                return null;
            }

            // Check if cache is still valid
            const now = Date.now();
            const age = now - cachedTimestamp;

            if (age > this.CACHE_DURATION) {
                return null;
            }

            return {
                data: cachedData.marketData,
                timestamp: cachedData.timestamp
            };
        }

        /**
         * Cache market data
         * @param {Object} data - API response to cache
         */
        cacheData(data) {
            storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
            storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
        }

        /**
         * Get price for an item
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @param {number} enhancementLevel - Enhancement level (default: 0)
         * @returns {Object|null} { ask: number, bid: number } or null if not found
         */
        getPrice(itemHrid, enhancementLevel = 0) {
            if (!this.marketData) {
                console.warn('[MarketAPI] ⚠️ No market data available');
                return null;
            }

            const priceData = this.marketData[itemHrid];

            if (!priceData || typeof priceData !== 'object') {
                // Item not in market data at all
                return null;
            }

            // Market data is organized by enhancement level
            // { 0: { a: 1000, b: 900 }, 2: { a: 5000, b: 4500 }, ... }
            const price = priceData[enhancementLevel];

            if (!price) {
                // No price data for this enhancement level
                return null;
            }

            return {
                ask: price.a || 0,  // Sell price
                bid: price.b || 0   // Buy price
            };
        }

        /**
         * Get prices for multiple items
         * @param {string[]} itemHrids - Array of item HRIDs
         * @returns {Map<string, Object>} Map of HRID -> { ask, bid }
         */
        getPrices(itemHrids) {
            const prices = new Map();

            for (const hrid of itemHrids) {
                const price = this.getPrice(hrid);
                if (price) {
                    prices.set(hrid, price);
                }
            }

            return prices;
        }

        /**
         * Check if market data is loaded
         * @returns {boolean} True if data is available
         */
        isLoaded() {
            return this.marketData !== null;
        }

        /**
         * Get age of current data in milliseconds
         * @returns {number|null} Age in ms or null if no data
         */
        getDataAge() {
            if (!this.lastFetchTimestamp) {
                return null;
            }

            return Date.now() - this.lastFetchTimestamp;
        }

        /**
         * Log an error
         * @param {string} message - Error message
         * @param {Error} error - Error object
         */
        logError(message, error) {
            const errorEntry = {
                timestamp: new Date().toISOString(),
                message,
                error: error?.message || String(error)
            };

            this.errorLog.push(errorEntry);
            console.error(`[MarketAPI] ${message}:`, error);
        }

        /**
         * Get error log
         * @returns {Array} Array of error entries
         */
        getErrors() {
            return [...this.errorLog];
        }

        /**
         * Clear error log
         */
        clearErrors() {
            this.errorLog = [];
        }
    }

    // Create and export singleton instance
    const marketAPI = new MarketAPI();

    /**
     * Efficiency Utilities Module
     * Calculations for game mechanics (efficiency, buffs, time)
     */


    /**
     * Stack additive bonuses (most game bonuses)
     * @param {number[]} bonuses - Array of bonus percentages
     * @returns {number} Total stacked bonus percentage
     *
     * @example
     * stackAdditive([10, 20, 5])
     * // Returns: 35
     * // Because: 10% + 20% + 5% = 35%
     */
    function stackAdditive(...bonuses) {
        return bonuses.reduce((total, bonus) => total + bonus, 0);
    }

    /**
     * Equipment Parser Utility
     * Parses equipment bonuses for action calculations
     *
     * PART OF EFFICIENCY SYSTEM (Phase 1 of 3):
     * - Phase 1 ✅: Equipment speed bonuses (this module) + level advantage
     * - Phase 2 ✅: Community buffs + house rooms (WebSocket integration)
     * - Phase 3 ✅: Consumable buffs (tea parser integration)
     *
     * Speed bonuses are MULTIPLICATIVE with time (reduce duration).
     * Efficiency bonuses are ADDITIVE with each other, then MULTIPLICATIVE with time.
     *
     * Formula: actionTime = baseTime / (1 + totalEfficiency + totalSpeed)
     */

    /**
     * Map action type HRID to equipment field name
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/cheesesmithing")
     * @param {string} suffix - Field suffix (e.g., "Speed", "Efficiency", "RareFind")
     * @param {Array<string>} validFields - Array of valid field names
     * @returns {string|null} Field name (e.g., "cheesesmithingSpeed") or null
     */
    function getFieldForActionType(actionTypeHrid, suffix, validFields) {
        if (!actionTypeHrid) {
            return null;
        }

        // Extract skill name from action type HRID
        // e.g., "/action_types/cheesesmithing" -> "cheesesmithing"
        const skillName = actionTypeHrid.replace('/action_types/', '');

        // Map to field name with suffix
        // e.g., "cheesesmithing" + "Speed" -> "cheesesmithingSpeed"
        const fieldName = skillName + suffix;

        return validFields.includes(fieldName) ? fieldName : null;
    }

    /**
     * Calculate enhancement scaling for equipment stats
     * Uses item-specific enhancement bonus from noncombatEnhancementBonuses
     * @param {number} baseValue - Base stat value from item
     * @param {number} enhancementBonus - Enhancement bonus per level from item data
     * @param {number} enhancementLevel - Enhancement level (0-20)
     * @returns {number} Scaled stat value
     *
     * @example
     * calculateEnhancementScaling(0.15, 0.003, 0) // 0.15
     * calculateEnhancementScaling(0.15, 0.003, 10) // 0.18
     * calculateEnhancementScaling(0.3, 0.006, 10) // 0.36
     */
    function calculateEnhancementScaling(baseValue, enhancementBonus, enhancementLevel) {
        // Formula: base + (enhancementBonus × enhancementLevel)
        return baseValue + (enhancementBonus * enhancementLevel);
    }

    /**
     * Generic equipment stat parser - handles all noncombat stats with consistent logic
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {Object} config - Parser configuration
     * @param {string|null} config.skillSpecificField - Skill-specific field (e.g., "brewingSpeed")
     * @param {string|null} config.genericField - Generic skilling field (e.g., "skillingSpeed")
     * @param {boolean} config.returnAsPercentage - Whether to convert to percentage (multiply by 100)
     * @returns {number} Total stat bonus
     *
     * @example
     * // Parse speed bonuses for brewing
     * parseEquipmentStat(equipment, items, {
     *   skillSpecificField: "brewingSpeed",
     *   genericField: "skillingSpeed",
     *   returnAsPercentage: false
     * })
     */
    function parseEquipmentStat(characterEquipment, itemDetailMap, config) {
        if (!characterEquipment || characterEquipment.size === 0) {
            return 0; // No equipment
        }

        if (!itemDetailMap) {
            return 0; // Missing item data
        }

        const { skillSpecificField, genericField, returnAsPercentage } = config;

        let totalBonus = 0;

        // Iterate through all equipped items
        for (const [slotHrid, equippedItem] of characterEquipment) {
            // Get item details from game data
            const itemDetails = itemDetailMap[equippedItem.itemHrid];

            if (!itemDetails || !itemDetails.equipmentDetail) {
                continue; // Not an equipment item
            }

            // Check if item has noncombat stats
            const noncombatStats = itemDetails.equipmentDetail.noncombatStats;

            if (!noncombatStats) {
                continue; // No noncombat stats
            }

            // Get enhancement level from equipped item
            const enhancementLevel = equippedItem.enhancementLevel || 0;

            // Get enhancement bonuses for this item
            const enhancementBonuses = itemDetails.equipmentDetail.noncombatEnhancementBonuses;

            // Check for skill-specific stat (e.g., brewingSpeed, brewingEfficiency, brewingRareFind)
            if (skillSpecificField) {
                const baseValue = noncombatStats[skillSpecificField];

                if (baseValue && baseValue > 0) {
                    const enhancementBonus = (enhancementBonuses && enhancementBonuses[skillSpecificField]) || 0;
                    const scaledValue = calculateEnhancementScaling(baseValue, enhancementBonus, enhancementLevel);
                    totalBonus += scaledValue;
                }
            }

            // Check for generic skilling stat (e.g., skillingSpeed, skillingEfficiency, skillingRareFind, skillingEssenceFind)
            if (genericField) {
                const baseValue = noncombatStats[genericField];

                if (baseValue && baseValue > 0) {
                    const enhancementBonus = (enhancementBonuses && enhancementBonuses[genericField]) || 0;
                    const scaledValue = calculateEnhancementScaling(baseValue, enhancementBonus, enhancementLevel);
                    totalBonus += scaledValue;
                }
            }
        }

        // Convert to percentage if requested (0.15 -> 15%)
        return returnAsPercentage ? totalBonus * 100 : totalBonus;
    }

    /**
     * Valid speed fields from game data
     */
    const VALID_SPEED_FIELDS = [
        'milkingSpeed',
        'foragingSpeed',
        'woodcuttingSpeed',
        'cheesesmithingSpeed',
        'craftingSpeed',
        'tailoringSpeed',
        'brewingSpeed',
        'cookingSpeed'
    ];

    /**
     * Parse equipment speed bonuses for a specific action type
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total speed bonus as decimal (e.g., 0.15 for 15%)
     *
     * @example
     * parseEquipmentSpeedBonuses(equipment, "/action_types/brewing", items)
     * // Cheese Pot (base 0.15, bonus 0.003) +0: 0.15 (15%)
     * // Cheese Pot (base 0.15, bonus 0.003) +10: 0.18 (18%)
     * // Azure Pot (base 0.3, bonus 0.006) +10: 0.36 (36%)
     */
    function parseEquipmentSpeedBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Speed', VALID_SPEED_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingSpeed',
            returnAsPercentage: false
        });
    }

    /**
     * Valid efficiency fields from game data
     */
    const VALID_EFFICIENCY_FIELDS = [
        'milkingEfficiency',
        'foragingEfficiency',
        'woodcuttingEfficiency',
        'cheesesmithingEfficiency',
        'craftingEfficiency',
        'tailoringEfficiency',
        'brewingEfficiency',
        'cookingEfficiency',
        'alchemyEfficiency'
    ];

    /**
     * Parse equipment efficiency bonuses for a specific action type
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total efficiency bonus as percentage (e.g., 12 for 12%)
     *
     * @example
     * parseEquipmentEfficiencyBonuses(equipment, "/action_types/brewing", items)
     * // Brewer's Top (base 0.1, bonus 0.002) +0: 10%
     * // Brewer's Top (base 0.1, bonus 0.002) +10: 12%
     * // Philosopher's Necklace (skillingEfficiency 0.02, bonus 0.002) +10: 4%
     * // Total: 16%
     */
    function parseEquipmentEfficiencyBonuses(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'Efficiency', VALID_EFFICIENCY_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingEfficiency',
            returnAsPercentage: true
        });
    }

    /**
     * Parse Essence Find bonus from equipment
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total essence find bonus as percentage (e.g., 15 for 15%)
     *
     * @example
     * parseEssenceFindBonus(equipment, items)
     * // Ring of Essence Find (base 0.15, bonus 0.015) +0: 15%
     * // Ring of Essence Find (base 0.15, bonus 0.015) +10: 30%
     */
    function parseEssenceFindBonus(characterEquipment, itemDetailMap) {
        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField: null, // No skill-specific essence find
            genericField: 'skillingEssenceFind',
            returnAsPercentage: true
        });
    }

    /**
     * Valid rare find fields from game data
     */
    const VALID_RARE_FIND_FIELDS = [
        'milkingRareFind',
        'foragingRareFind',
        'woodcuttingRareFind',
        'cheesesmithingRareFind',
        'craftingRareFind',
        'tailoringRareFind',
        'brewingRareFind',
        'cookingRareFind',
        'alchemyRareFind'
    ];

    /**
     * Parse Rare Find bonus from equipment
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {string} actionTypeHrid - Action type HRID (for skill-specific rare find)
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total rare find bonus as percentage (e.g., 15 for 15%)
     *
     * @example
     * parseRareFindBonus(equipment, "/action_types/brewing", items)
     * // Brewer's Top (base 0.15, bonus 0.003) +0: 15%
     * // Brewer's Top (base 0.15, bonus 0.003) +10: 18%
     * // Earrings of Rare Find (base 0.08, bonus 0.002) +0: 8%
     * // Total: 26%
     */
    function parseRareFindBonus(characterEquipment, actionTypeHrid, itemDetailMap) {
        const skillSpecificField = getFieldForActionType(actionTypeHrid, 'RareFind', VALID_RARE_FIND_FIELDS);

        return parseEquipmentStat(characterEquipment, itemDetailMap, {
            skillSpecificField,
            genericField: 'skillingRareFind',
            returnAsPercentage: true
        });
    }

    /**
     * House Efficiency Utility
     * Calculates efficiency bonuses from house rooms
     *
     * PART OF EFFICIENCY SYSTEM (Phase 2):
     * - House rooms provide +1.5% efficiency per level to matching actions
     * - Formula: houseLevel × 1.5%
     * - Data source: WebSocket (characterHouseRoomMap)
     */


    /**
     * Map action type HRID to house room HRID
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @returns {string|null} House room HRID or null
     */
    function getHouseRoomForActionType(actionTypeHrid) {
        // Mapping matches original MWI Tools
        const actionTypeToHouseRoomMap = {
            '/action_types/brewing': '/house_rooms/brewery',
            '/action_types/cheesesmithing': '/house_rooms/forge',
            '/action_types/cooking': '/house_rooms/kitchen',
            '/action_types/crafting': '/house_rooms/workshop',
            '/action_types/foraging': '/house_rooms/garden',
            '/action_types/milking': '/house_rooms/dairy_barn',
            '/action_types/tailoring': '/house_rooms/sewing_parlor',
            '/action_types/woodcutting': '/house_rooms/log_shed',
            '/action_types/alchemy': '/house_rooms/laboratory'
        };

        return actionTypeToHouseRoomMap[actionTypeHrid] || null;
    }

    /**
     * Calculate house efficiency bonus for an action type
     * @param {string} actionTypeHrid - Action type HRID
     * @returns {number} Efficiency bonus percentage (e.g., 12 for 12%)
     *
     * @example
     * calculateHouseEfficiency("/action_types/brewing")
     * // Returns: 12 (if brewery is level 8: 8 × 1.5% = 12%)
     */
    function calculateHouseEfficiency(actionTypeHrid) {
        // Get the house room for this action type
        const houseRoomHrid = getHouseRoomForActionType(actionTypeHrid);

        if (!houseRoomHrid) {
            return 0; // No house room for this action type
        }

        // Get house room level from game data (via dataManager)
        const roomLevel = dataManager.getHouseRoomLevel(houseRoomHrid);

        // Formula: houseLevel × 1.5%
        // Returns as percentage (e.g., 12 for 12%)
        return roomLevel * 1.5;
    }

    /**
     * Calculate total Rare Find bonus from all house rooms
     * @returns {number} Total rare find bonus as percentage (e.g., 1.6 for 1.6%)
     *
     * @example
     * calculateHouseRareFind()
     * // Returns: 1.6 (if total house room levels = 8: 8 × 0.2% per level = 1.6%)
     *
     * Formula from game data:
     * - flatBoostLevelBonus: 0.2% per level
     * - Total: totalLevels × 0.2%
     * - Max: 8 rooms × 8 levels = 64 × 0.2% = 12.8%
     */
    function calculateHouseRareFind() {
        // Get all house rooms
        const houseRooms = dataManager.getHouseRooms();

        if (!houseRooms || houseRooms.size === 0) {
            return 0; // No house rooms
        }

        // Sum all house room levels
        let totalLevels = 0;
        for (const [hrid, room] of houseRooms) {
            totalLevels += room.level || 0;
        }

        // Formula: totalLevels × flatBoostLevelBonus
        // flatBoostLevelBonus: 0.2% per level (no base bonus)
        const flatBoostLevelBonus = 0.2;

        return totalLevels * flatBoostLevelBonus;
    }

    /**
     * Enhancement Multiplier System
     *
     * Handles enhancement bonus calculations for equipment.
     * Different equipment slots have different multipliers:
     * - Accessories (neck/ring/earring), Back, Trinket, Charm: 5× multiplier
     * - All other slots (weapons, armor, pouch): 1× multiplier
     */

    /**
     * Enhancement multiplier by equipment slot type
     */
    const ENHANCEMENT_MULTIPLIERS = {
        '/equipment_types/neck': 5,
        '/equipment_types/ring': 5,
        '/equipment_types/earring': 5,
        '/equipment_types/back': 5,
        '/equipment_types/trinket': 5,
        '/equipment_types/charm': 5,
        // All other slots: 1× (default)
    };

    /**
     * Enhancement bonus table
     * Maps enhancement level to percentage bonus
     */
    const ENHANCEMENT_BONUSES = {
        1: 0.020,  2: 0.042,  3: 0.066,  4: 0.092,  5: 0.120,
        6: 0.150,  7: 0.182,  8: 0.216,  9: 0.252, 10: 0.290,
        11: 0.334, 12: 0.384, 13: 0.440, 14: 0.502, 15: 0.570,
        16: 0.644, 17: 0.724, 18: 0.810, 19: 0.902, 20: 1.000
    };

    /**
     * Get enhancement multiplier for an item
     * @param {Object} itemDetails - Item details from itemDetailMap
     * @param {number} enhancementLevel - Current enhancement level of item
     * @returns {number} Multiplier to apply to bonuses
     */
    function getEnhancementMultiplier(itemDetails, enhancementLevel) {
        if (enhancementLevel === 0) {
            return 1;
        }

        const equipmentType = itemDetails?.equipmentDetail?.type;
        const slotMultiplier = ENHANCEMENT_MULTIPLIERS[equipmentType] || 1;
        const enhancementBonus = ENHANCEMENT_BONUSES[enhancementLevel] || 0;

        return 1 + (enhancementBonus * slotMultiplier);
    }

    /**
     * Tea Buff Parser Utility
     * Calculates efficiency bonuses from active tea buffs
     *
     * Tea efficiency comes from two buff types:
     * 1. /buff_types/efficiency - Generic efficiency (e.g., Efficiency Tea: 10%)
     * 2. /buff_types/{skill}_level - Skill level bonuses (e.g., Brewing Tea: +3 levels)
     *
     * All tea effects scale with Drink Concentration equipment stat.
     */


    /**
     * Generic tea buff parser - handles all tea buff types with consistent logic
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @param {Object} config - Parser configuration
     * @param {Array<string>} config.buffTypeHrids - Buff type HRIDs to check (e.g., ['/buff_types/artisan'])
     * @returns {number} Total buff bonus
     *
     * @example
     * // Parse artisan bonus
     * parseTeaBuff(drinks, items, 0.12, { buffTypeHrids: ['/buff_types/artisan'] })
     */
    function parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, config) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return 0; // No active teas
        }

        if (!itemDetailMap) {
            return 0; // Missing required data
        }

        const { buffTypeHrids } = config;
        let totalBonus = 0;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Check if this buff matches any of the target types
                if (buffTypeHrids.includes(buff.typeHrid)) {
                    const baseValue = buff.flatBoost;
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    totalBonus += scaledValue;
                }
            }
        }

        return totalBonus;
    }

    /**
     * Parse tea efficiency bonuses for a specific action type
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Total tea efficiency bonus as percentage (e.g., 12 for 12%)
     *
     * @example
     * // With Efficiency Tea (10% base) and 12% Drink Concentration:
     * parseTeaEfficiency("/action_types/brewing", activeDrinks, items, 0.12)
     * // Returns: 11.2 (10% × 1.12 = 11.2%)
     */
    function parseTeaEfficiency(actionTypeHrid, activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return 0; // No active teas
        }

        if (!actionTypeHrid || !itemDetailMap) {
            return 0; // Missing required data
        }

        let totalEfficiency = 0;

        // Extract skill name from action type for skill-specific tea detection
        // e.g., "/action_types/brewing" -> "brewing"
        const skillName = actionTypeHrid.replace('/action_types/', '');
        const skillLevelBuffType = `/buff_types/${skillName}_level`;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Generic efficiency buff (e.g., Efficiency Tea)
                if (buff.typeHrid === '/buff_types/efficiency') {
                    const baseEfficiency = buff.flatBoost * 100; // Convert to percentage
                    const scaledEfficiency = baseEfficiency * (1 + drinkConcentration);
                    totalEfficiency += scaledEfficiency;
                }
                // Skill-specific level buff (e.g., Brewing Tea: +3 Brewing levels)
                // Level bonuses translate to efficiency: +1 level = +1% efficiency
                else if (buff.typeHrid === skillLevelBuffType) {
                    const levelBonus = buff.flatBoost;
                    const scaledBonus = levelBonus * (1 + drinkConcentration);
                    totalEfficiency += scaledBonus;
                }
            }
        }

        return totalEfficiency;
    }

    /**
     * Parse tea efficiency bonuses with breakdown by individual tea
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {Array<{name: string, efficiency: number, baseEfficiency: number, dcContribution: number}>} Array of tea contributions
     *
     * @example
     * // With Efficiency Tea (10% base) and Ultra Cheesesmithing Tea (6% base) with 12% DC:
     * parseTeaEfficiencyBreakdown("/action_types/cheesesmithing", activeDrinks, items, 0.12)
     * // Returns: [
     * //   { name: "Efficiency Tea", efficiency: 11.2, baseEfficiency: 10.0, dcContribution: 1.2 },
     * //   { name: "Ultra Cheesesmithing Tea", efficiency: 6.72, baseEfficiency: 6.0, dcContribution: 0.72 }
     * // ]
     */
    function parseTeaEfficiencyBreakdown(actionTypeHrid, activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return []; // No active teas
        }

        if (!actionTypeHrid || !itemDetailMap) {
            return []; // Missing required data
        }

        const teaBreakdown = [];

        // Extract skill name from action type for skill-specific tea detection
        // e.g., "/action_types/brewing" -> "brewing"
        const skillName = actionTypeHrid.replace('/action_types/', '');
        const skillLevelBuffType = `/buff_types/${skillName}_level`;

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            let baseEfficiency = 0;
            let totalEfficiency = 0;

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Generic efficiency buff (e.g., Efficiency Tea)
                if (buff.typeHrid === '/buff_types/efficiency') {
                    const baseValue = buff.flatBoost * 100; // Convert to percentage
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    baseEfficiency += baseValue;
                    totalEfficiency += scaledValue;
                }
                // Skill-specific level buff (e.g., Brewing Tea: +3 Brewing levels)
                // Level bonuses translate to efficiency: +1 level = +1% efficiency
                else if (buff.typeHrid === skillLevelBuffType) {
                    const baseValue = buff.flatBoost;
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    baseEfficiency += baseValue;
                    totalEfficiency += scaledValue;
                }
            }

            // Only add to breakdown if this tea contributes efficiency
            if (totalEfficiency > 0) {
                teaBreakdown.push({
                    name: itemDetails.name,
                    efficiency: totalEfficiency,
                    baseEfficiency: baseEfficiency,
                    dcContribution: totalEfficiency - baseEfficiency
                });
            }
        }

        return teaBreakdown;
    }

    /**
     * Get Drink Concentration stat from equipped items
     * @param {Map} characterEquipment - Equipment map from dataManager.getEquipment()
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @returns {number} Total drink concentration as decimal (e.g., 0.12 for 12%)
     *
     * @example
     * getDrinkConcentration(equipment, items)
     * // Returns: 0.12 (if wearing items with 12% total drink concentration)
     */
    function getDrinkConcentration(characterEquipment, itemDetailMap) {
        if (!characterEquipment || characterEquipment.size === 0) {
            return 0; // No equipment
        }

        if (!itemDetailMap) {
            return 0; // Missing item data
        }

        let totalDrinkConcentration = 0;

        // Iterate through all equipped items
        for (const [slotHrid, equippedItem] of characterEquipment) {
            const itemDetails = itemDetailMap[equippedItem.itemHrid];

            if (!itemDetails || !itemDetails.equipmentDetail) {
                continue; // Not an equipment item
            }

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats;
            if (!noncombatStats) {
                continue; // No noncombat stats
            }

            // Check for drink concentration stat
            const baseDrinkConcentration = noncombatStats.drinkConcentration;
            if (!baseDrinkConcentration || baseDrinkConcentration <= 0) {
                continue; // No drink concentration on this item
            }

            // Get enhancement level from equipped item
            const enhancementLevel = equippedItem.enhancementLevel || 0;

            // Calculate scaled drink concentration with enhancement
            // Uses enhancement multiplier table (e.g., +10 = 1.29× for 1× slots like pouch)
            const enhancementMultiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const scaledDrinkConcentration = baseDrinkConcentration * enhancementMultiplier;

            totalDrinkConcentration += scaledDrinkConcentration;
        }

        return totalDrinkConcentration;
    }

    /**
     * Parse Artisan bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Artisan material reduction as decimal (e.g., 0.112 for 11.2% reduction)
     *
     * @example
     * // With Artisan Tea (10% base) and 12% Drink Concentration:
     * parseArtisanBonus(activeDrinks, items, 0.12)
     * // Returns: 0.112 (10% × 1.12 = 11.2% reduction)
     */
    function parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/artisan']
        });
    }

    /**
     * Parse Gourmet bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Gourmet bonus chance as decimal (e.g., 0.1344 for 13.44% bonus items)
     *
     * @example
     * // With Gourmet Tea (12% base) and 12% Drink Concentration:
     * parseGourmetBonus(activeDrinks, items, 0.12)
     * // Returns: 0.1344 (12% × 1.12 = 13.44% bonus items)
     */
    function parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/gourmet']
        });
    }

    /**
     * Parse Processing bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Processing conversion chance as decimal (e.g., 0.168 for 16.8% conversion chance)
     *
     * @example
     * // With Processing Tea (15% base) and 12% Drink Concentration:
     * parseProcessingBonus(activeDrinks, items, 0.12)
     * // Returns: 0.168 (15% × 1.12 = 16.8% conversion chance)
     */
    function parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/processing']
        });
    }

    /**
     * Parse Action Level bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Action Level bonus as flat number (e.g., 5.645 for +5.645 levels, floored to 5 when used)
     *
     * @example
     * // With Artisan Tea (+5 Action Level base) and 12% Drink Concentration:
     * parseActionLevelBonus(activeDrinks, items, 0.129)
     * // Returns: 5.645 (scales with DC, but game floors this to 5 when calculating requirement)
     */
    function parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        // Action Level DOES scale with DC (like all other buffs)
        // However, the game floors the result when calculating effective requirement
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/action_level']
        });
    }

    /**
     * Parse Action Level bonus with breakdown by individual tea
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {Array<{name: string, actionLevel: number, baseActionLevel: number, dcContribution: number}>} Array of tea contributions
     *
     * @example
     * // With Artisan Tea (+5 Action Level base) and 12.9% Drink Concentration:
     * parseActionLevelBonusBreakdown(activeDrinks, items, 0.129)
     * // Returns: [{ name: "Artisan Tea", actionLevel: 5.645, baseActionLevel: 5.0, dcContribution: 0.645 }]
     * // Note: Game floors actionLevel to 5 when calculating requirement, but we show full precision
     */
    function parseActionLevelBonusBreakdown(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        if (!activeDrinks || activeDrinks.length === 0) {
            return []; // No active teas
        }

        if (!itemDetailMap) {
            return []; // Missing required data
        }

        const teaBreakdown = [];

        // Process each active tea/drink
        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) {
                continue; // Empty slot
            }

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails || !itemDetails.consumableDetail || !itemDetails.consumableDetail.buffs) {
                continue; // Not a consumable or has no buffs
            }

            let baseActionLevel = 0;
            let totalActionLevel = 0;

            // Check each buff on this tea
            for (const buff of itemDetails.consumableDetail.buffs) {
                // Action Level buff (e.g., Artisan Tea: +5 Action Level)
                if (buff.typeHrid === '/buff_types/action_level') {
                    const baseValue = buff.flatBoost;
                    // Action Level DOES scale with DC (like all other buffs)
                    const scaledValue = baseValue * (1 + drinkConcentration);
                    baseActionLevel += baseValue;
                    totalActionLevel += scaledValue;
                }
            }

            // Only add to breakdown if this tea contributes action level
            if (totalActionLevel > 0) {
                teaBreakdown.push({
                    name: itemDetails.name,
                    actionLevel: totalActionLevel,
                    baseActionLevel: baseActionLevel,
                    dcContribution: totalActionLevel - baseActionLevel
                });
            }
        }

        return teaBreakdown;
    }

    /**
     * Parse Gathering bonus from active tea buffs
     * @param {Array} activeDrinks - Array of active drink items from actionTypeDrinkSlotsMap
     * @param {Object} itemDetailMap - Item details from init_client_data
     * @param {number} drinkConcentration - Drink Concentration stat (as decimal, e.g., 0.12 for 12%)
     * @returns {number} Gathering quantity bonus as decimal (e.g., 0.168 for 16.8% more items)
     *
     * @example
     * // With Gathering Tea (+15% base) and 12% Drink Concentration:
     * parseGatheringBonus(activeDrinks, items, 0.12)
     * // Returns: 0.168 (15% × 1.12 = 16.8% gathering quantity)
     */
    function parseGatheringBonus(activeDrinks, itemDetailMap, drinkConcentration = 0) {
        return parseTeaBuff(activeDrinks, itemDetailMap, drinkConcentration, {
            buffTypeHrids: ['/buff_types/gathering']
        });
    }

    /**
     * Formatting Utilities
     * Pure functions for formatting numbers and time
     */

    /**
     * Format numbers with thousand separators
     * @param {number} num - The number to format
     * @param {number} digits - Number of decimal places (default: 0 for whole numbers)
     * @returns {string} Formatted number (e.g., "1,500", "1,500,000")
     *
     * @example
     * numberFormatter(1500) // "1,500"
     * numberFormatter(1500000) // "1,500,000"
     * numberFormatter(1500.5, 1) // "1,500.5"
     */
    function numberFormatter(num, digits = 0) {
        if (num === null || num === undefined) {
            return null;
        }

        // Round to specified decimal places
        const rounded = digits > 0 ? num.toFixed(digits) : Math.round(num);

        // Format with thousand separators
        return new Intl.NumberFormat().format(rounded);
    }

    /**
     * Convert seconds to human-readable time format
     * @param {number} sec - Seconds to convert
     * @returns {string} Formatted time (e.g., "1h 23m 45s" or "3 years 5 months 3 days")
     *
     * @example
     * timeReadable(3661) // "1h 01m 01s"
     * timeReadable(90000) // "1 day"
     * timeReadable(31536000) // "1 year"
     * timeReadable(100000000) // "3 years 2 months 3 days"
     */
    function timeReadable(sec) {
        // For times >= 1 year, show in years/months/days
        if (sec >= 31536000) { // 365 days
            const years = Math.floor(sec / 31536000);
            const remainingAfterYears = sec - (years * 31536000);
            const months = Math.floor(remainingAfterYears / 2592000); // 30 days
            const remainingAfterMonths = remainingAfterYears - (months * 2592000);
            const days = Math.floor(remainingAfterMonths / 86400);

            const parts = [];
            if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
            if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
            if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

            return parts.join(' ');
        }

        // For times >= 1 day, show in days/hours/minutes
        if (sec >= 86400) {
            const days = Math.floor(sec / 86400);
            const remainingAfterDays = sec - (days * 86400);
            const hours = Math.floor(remainingAfterDays / 3600);
            const remainingAfterHours = remainingAfterDays - (hours * 3600);
            const minutes = Math.floor(remainingAfterHours / 60);

            const parts = [];
            if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);

            return parts.join(' ');
        }

        // For times < 1 day, show as HH:MM:SS
        const d = new Date(Math.round(sec * 1000));
        function pad(i) {
            return ("0" + i).slice(-2);
        }

        const hours = d.getUTCHours();
        const minutes = d.getUTCMinutes();
        const seconds = d.getUTCSeconds();

        // For times < 1 minute, just show seconds
        if (hours === 0 && minutes === 0) {
            return seconds + "s";
        }

        let str = hours + "h " + pad(minutes) + "m " + pad(seconds) + "s";
        return str;
    }

    /**
     * Format a number with thousand separators based on locale
     * @param {number} num - The number to format
     * @returns {string} Formatted number with separators
     *
     * @example
     * formatWithSeparator(1000000) // "1,000,000" (US locale)
     */
    function formatWithSeparator(num) {
        return new Intl.NumberFormat().format(num);
    }

    /**
     * Format large numbers in K/M/B notation
     * @param {number} num - The number to format
     * @param {number} decimals - Number of decimal places (default: 1)
     * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
     *
     * @example
     * formatKMB(1500) // "1.5K"
     * formatKMB(2300000) // "2.3M"
     * formatKMB(1234567890) // "1.2B"
     */
    function formatKMB(num, decimals = 1) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (absNum >= 1e9) {
            return sign + (absNum / 1e9).toFixed(decimals) + 'B';
        } else if (absNum >= 1e6) {
            return sign + (absNum / 1e6).toFixed(decimals) + 'M';
        } else if (absNum >= 1e3) {
            return sign + (absNum / 1e3).toFixed(decimals) + 'K';
        } else {
            return sign + absNum.toFixed(0);
        }
    }

    /**
     * Format numbers using game-style coin notation (4-digit maximum display)
     * @param {number} num - The number to format
     * @returns {string} Formatted number (e.g., "999", "1,000", "10K", "9,999K", "10M")
     *
     * Game formatting rules (4-digit bounded notation):
     * - 0-999: Raw number (no formatting)
     * - 1,000-9,999: Comma format
     * - 10,000-9,999,999: K suffix (10K to 9,999K)
     * - 10,000,000-9,999,999,999: M suffix (10M to 9,999M)
     * - 10,000,000,000-9,999,999,999,999: B suffix (10B to 9,999B)
     * - 10,000,000,000,000+: T suffix (10T+)
     *
     * Key rule: Display never exceeds 4 numeric digits. When a 5th digit is needed,
     * promote to the next unit (K→M→B→T).
     *
     * @example
     * coinFormatter(999) // "999"
     * coinFormatter(1000) // "1,000"
     * coinFormatter(9999) // "9,999"
     * coinFormatter(10000) // "10K"
     * coinFormatter(999999) // "999K"
     * coinFormatter(1000000) // "1,000K"
     * coinFormatter(9999999) // "9,999K"
     * coinFormatter(10000000) // "10M"
     */
    function coinFormatter(num) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        // 0-999: raw number
        if (absNum < 1000) {
            return sign + Math.floor(absNum).toString();
        }
        // 1,000-9,999: comma format
        if (absNum < 10000) {
            return sign + new Intl.NumberFormat().format(Math.floor(absNum));
        }
        // 10K-9,999K (10,000 to 9,999,999)
        if (absNum < 10000000) {
            const val = Math.floor(absNum / 1000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'K';
        }
        // 10M-9,999M (10,000,000 to 9,999,999,999)
        if (absNum < 10000000000) {
            const val = Math.floor(absNum / 1000000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'M';
        }
        // 10B-9,999B (10,000,000,000 to 9,999,999,999,999)
        if (absNum < 10000000000000) {
            const val = Math.floor(absNum / 1000000000);
            const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
            return sign + formatted + 'B';
        }
        // 10T+ (10,000,000,000,000+)
        const val = Math.floor(absNum / 1000000000000);
        const formatted = val >= 1000 ? new Intl.NumberFormat().format(val) : val;
        return sign + formatted + 'T';
    }

    /**
     * Format numbers for networth display with decimal precision
     * Uses 2 decimal places for better readability in detailed breakdowns
     * @param {number} num - The number to format
     * @returns {string} Formatted number (e.g., "1.23K", "45.67M", "89.01B")
     *
     * @example
     * networthFormatter(1234) // "1.23K"
     * networthFormatter(45678) // "45.68K"
     * networthFormatter(1234567) // "1.23M"
     * networthFormatter(89012345) // "89.01M"
     * networthFormatter(1234567890) // "1.23B"
     */
    function networthFormatter(num) {
        if (num === null || num === undefined) {
            return null;
        }

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        // 0-999: raw number (no decimals needed)
        if (absNum < 1000) {
            return sign + Math.floor(absNum).toString();
        }
        // 1,000-999,999: K with 2 decimals
        if (absNum < 1000000) {
            return sign + (absNum / 1000).toFixed(2) + 'K';
        }
        // 1M-999,999,999: M with 2 decimals
        if (absNum < 1000000000) {
            return sign + (absNum / 1000000).toFixed(2) + 'M';
        }
        // 1B+: B with 2 decimals
        return sign + (absNum / 1000000000).toFixed(2) + 'B';
    }

    /**
     * Expected Value Calculator Module
     * Calculates expected value for openable containers
     */


    /**
     * ExpectedValueCalculator class handles EV calculations for openable containers
     */
    class ExpectedValueCalculator {
        constructor() {
            // Constants
            this.MARKET_TAX = 0.02; // 2% marketplace tax
            this.CONVERGENCE_ITERATIONS = 4; // Nested container convergence

            // Cache for container EVs
            this.containerCache = new Map();

            // Special item HRIDs
            this.COIN_HRID = '/items/coin';
            this.COWBELL_HRID = '/items/cowbell';
            this.COWBELL_BAG_HRID = '/items/bag_of_10_cowbells';

            // Flag to track if initialized
            this.isInitialized = false;

            // Retry handler reference for cleanup
            this.retryHandler = null;
        }

        /**
         * Initialize the calculator
         * Pre-calculates all openable containers with nested convergence
         */
        async initialize() {
            if (!dataManager.getInitClientData()) {
                // Init data not yet available - set up retry on next character update
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        this.initialize(); // Retry initialization
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
                return false;
            }

            // Data is available - remove retry handler if it exists
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Calculate all containers with 4-iteration convergence for nesting
            this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence
         * Iterates 4 times to resolve nested container values
         */
        calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                for (const containerHrid of containerHrids) {
                    // Calculate and cache EV for this container (pass cached initData)
                    const ev = this.calculateSingleContainer(containerHrid, initData);
                    if (ev !== null) {
                        this.containerCache.set(containerHrid, ev);
                    }
                }
            }
        }

        /**
         * Calculate expected value for a single container
         * @param {string} containerHrid - Container item HRID
         * @param {Object} initData - Cached game data (optional, will fetch if not provided)
         * @returns {number|null} Expected value or null if unavailable
         */
        calculateSingleContainer(containerHrid, initData = null) {
            // Use cached data if provided, otherwise fetch
            if (!initData) {
                initData = dataManager.getInitClientData();
            }
            if (!initData || !initData.openableLootDropMap) {
                return null;
            }

            // Get drop table for this container
            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable || dropTable.length === 0) {
                return null;
            }

            let totalExpectedValue = 0;

            // Calculate expected value for each drop
            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                // Skip invalid drops
                if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
                    continue;
                }

                // Calculate average drop count
                const avgCount = (minCount + maxCount) / 2;

                // Get price for this drop
                const price = this.getDropPrice(itemHrid);

                if (price === null) {
                    continue; // Skip drops with missing data
                }

                // Check if item is tradeable (for tax calculation)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const canBeSold = itemDetails?.tradeable !== false;
                const taxFactor = canBeSold ? (1 - this.MARKET_TAX) : 1.0;

                // Calculate expected value: avgCount × dropRate × price × taxFactor
                const dropValue = avgCount * dropRate * price * taxFactor;
                totalExpectedValue += dropValue;
            }

            return totalExpectedValue;
        }

        /**
         * Get price for a drop item
         * Handles special cases (Coin, Cowbell, nested containers)
         * @param {string} itemHrid - Item HRID
         * @returns {number|null} Price or null if unavailable
         */
        getDropPrice(itemHrid) {
            // Special case: Coin (face value = 1)
            if (itemHrid === this.COIN_HRID) {
                return 1;
            }

            // Special case: Cowbell (use bag price ÷ 10, with 18% tax)
            if (itemHrid === this.COWBELL_HRID) {
                const bagPrice = marketAPI.getPrice(this.COWBELL_BAG_HRID, 0);
                if (bagPrice) {
                    // Respect pricing mode for Cowbell Bag price
                    const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');
                    const respectPricingMode = config.getSettingValue('expectedValue_respectPricingMode', true);

                    let bagValue = 0;
                    if (respectPricingMode) {
                        // Conservative: Bid (instant sell), Hybrid/Optimistic: Ask (patient sell)
                        bagValue = pricingMode === 'conservative' ? bagPrice.bid : bagPrice.ask;
                    } else {
                        // Always use conservative
                        bagValue = bagPrice.bid;
                    }

                    if (bagValue > 0) {
                        // Apply 18% market tax (Cowbell Bag only), then divide by 10
                        return (bagValue * 0.82) / 10;
                    }
                }
                return null; // No bag price available
            }

            // Check if this is a nested container (use cached EV)
            if (this.containerCache.has(itemHrid)) {
                return this.containerCache.get(itemHrid);
            }

            // Regular market item - get price based on pricing mode
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');
            const respectPricingMode = config.getSettingValue('expectedValue_respectPricingMode', true);

            // Get market price
            const price = marketAPI.getPrice(itemHrid, 0);
            if (!price) {
                return null; // No market data
            }

            // Determine which price to use for drop revenue
            let dropPrice = 0;

            if (respectPricingMode) {
                // Conservative: Bid (instant sell)
                // Hybrid/Optimistic: Ask (patient sell)
                if (pricingMode === 'conservative') {
                    dropPrice = price.bid;
                } else {
                    dropPrice = price.ask;
                }
            } else {
                // Always use conservative (instant sell)
                dropPrice = price.bid;
            }

            return dropPrice > 0 ? dropPrice : null;
        }

        /**
         * Calculate expected value for an openable container
         * @param {string} itemHrid - Container item HRID
         * @returns {Object|null} EV data or null
         */
        calculateExpectedValue(itemHrid) {
            if (!this.isInitialized) {
                console.warn('[ExpectedValueCalculator] Not initialized');
                return null;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Verify this is an openable container
            if (!itemDetails.isOpenable) {
                return null; // Not an openable container
            }

            // Get detailed drop breakdown (calculates with fresh market prices)
            const drops = this.getDropBreakdown(itemHrid);

            // Calculate total expected value from fresh drop data
            const expectedReturn = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);

            return {
                itemName: itemDetails.name,
                itemHrid,
                expectedValue: expectedReturn,
                drops
            };
        }

        /**
         * Get cached expected value for a container (for use by other modules)
         * @param {string} itemHrid - Container item HRID
         * @returns {number|null} Cached EV or null
         */
        getCachedValue(itemHrid) {
            return this.containerCache.get(itemHrid) || null;
        }

        /**
         * Get detailed drop breakdown for display
         * @param {string} containerHrid - Container HRID
         * @returns {Array} Array of drop objects
         */
        getDropBreakdown(containerHrid) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return [];
            }

            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable) {
                return [];
            }

            const drops = [];

            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                if (dropRate <= 0) {
                    continue;
                }

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Calculate average count
                const avgCount = (minCount + maxCount) / 2;

                // Get price
                const price = this.getDropPrice(itemHrid);

                // Calculate expected value for this drop
                const itemCanBeSold = itemDetails.tradeable !== false;
                const taxFactor = itemCanBeSold ? (1 - this.MARKET_TAX) : 1.0;
                const dropValue = price !== null ? (avgCount * dropRate * price * taxFactor) : 0;

                drops.push({
                    itemHrid,
                    itemName: itemDetails.name,
                    dropRate,
                    avgCount,
                    priceEach: price || 0,
                    expectedValue: dropValue,
                    hasPriceData: price !== null
                });
            }

            // Sort by expected value (highest first)
            drops.sort((a, b) => b.expectedValue - a.expectedValue);

            return drops;
        }

        /**
         * Invalidate cache (call when market data refreshes)
         */
        invalidateCache() {
            this.containerCache.clear();
            this.isInitialized = false;

            // Re-initialize if data is available
            if (dataManager.getInitClientData() && marketAPI.isLoaded()) {
                this.initialize();
            }
        }
    }

    // Create and export singleton instance
    const expectedValueCalculator = new ExpectedValueCalculator();

    /**
     * Bonus Revenue Calculator Utility
     * Calculates revenue from essence and rare find drops
     * Shared by both gathering and production profit calculators
     */


    /**
     * Calculate bonus revenue from essence and rare find drops
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionsPerHour - Actions per hour
     * @param {Map} characterEquipment - Equipment map
     * @param {Object} itemDetailMap - Item details map
     * @returns {Object} Bonus revenue data with essence and rare find drops
     */
    function calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap) {
        // Get Essence Find bonus from equipment
        const essenceFindBonus = parseEssenceFindBonus(characterEquipment, itemDetailMap);

        // Get Rare Find bonus from BOTH equipment and house rooms
        const equipmentRareFindBonus = parseRareFindBonus(characterEquipment, actionDetails.type, itemDetailMap);
        const houseRareFindBonus = calculateHouseRareFind();
        const rareFindBonus = equipmentRareFindBonus + houseRareFindBonus;

        const bonusDrops = [];
        let totalBonusRevenue = 0;

        // Process essence drops
        if (actionDetails.essenceDropTable && actionDetails.essenceDropTable.length > 0) {
            for (const drop of actionDetails.essenceDropTable) {
                const itemDetails = itemDetailMap[drop.itemHrid];
                if (!itemDetails) continue;

                // Calculate average drop count
                const avgCount = (drop.minCount + drop.maxCount) / 2;

                // Apply Essence Find multiplier to drop rate
                const finalDropRate = drop.dropRate * (1 + essenceFindBonus / 100);

                // Expected drops per hour
                const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

                // Get price: Check if openable container (use EV), otherwise market price
                let itemPrice = 0;
                if (itemDetails.isOpenable) {
                    // Use expected value for openable containers
                    itemPrice = expectedValueCalculator.getCachedValue(drop.itemHrid) || 0;
                } else {
                    // Use market price for regular items
                    const price = marketAPI.getPrice(drop.itemHrid, 0);
                    itemPrice = price?.bid || 0; // Use bid price (instant sell)
                }

                // Revenue per hour from this drop
                const revenuePerHour = dropsPerHour * itemPrice;

                bonusDrops.push({
                    itemHrid: drop.itemHrid,
                    itemName: itemDetails.name,
                    dropRate: finalDropRate,
                    dropsPerHour,
                    priceEach: itemPrice,
                    revenuePerHour,
                    type: 'essence'
                });

                totalBonusRevenue += revenuePerHour;
            }
        }

        // Process rare find drops
        if (actionDetails.rareDropTable && actionDetails.rareDropTable.length > 0) {
            for (const drop of actionDetails.rareDropTable) {
                const itemDetails = itemDetailMap[drop.itemHrid];
                if (!itemDetails) continue;

                // Calculate average drop count
                const avgCount = (drop.minCount + drop.maxCount) / 2;

                // Apply Rare Find multiplier to drop rate
                const finalDropRate = drop.dropRate * (1 + rareFindBonus / 100);

                // Expected drops per hour
                const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

                // Get price: Check if openable container (use EV), otherwise market price
                let itemPrice = 0;
                if (itemDetails.isOpenable) {
                    // Use expected value for openable containers
                    itemPrice = expectedValueCalculator.getCachedValue(drop.itemHrid) || 0;
                } else {
                    // Use market price for regular items
                    const price = marketAPI.getPrice(drop.itemHrid, 0);
                    itemPrice = price?.bid || 0; // Use bid price (instant sell)
                }

                // Revenue per hour from this drop
                const revenuePerHour = dropsPerHour * itemPrice;

                bonusDrops.push({
                    itemHrid: drop.itemHrid,
                    itemName: itemDetails.name,
                    dropRate: finalDropRate,
                    dropsPerHour,
                    priceEach: itemPrice,
                    revenuePerHour,
                    type: 'rare_find'
                });

                totalBonusRevenue += revenuePerHour;
            }
        }

        return {
            essenceFindBonus,       // Essence Find % from equipment
            rareFindBonus,          // Rare Find % from equipment + house rooms (combined)
            bonusDrops,             // Array of all bonus drops with details
            totalBonusRevenue       // Total revenue/hour from all bonus drops
        };
    }

    /**
     * Profit Calculator Module
     * Calculates production costs and profit for crafted items
     */


    /**
     * ProfitCalculator class handles profit calculations for production actions
     */
    class ProfitCalculator {
        constructor() {
            // Constants
            this.MARKET_TAX = 0.02; // 2% marketplace tax
            this.DRINKS_PER_HOUR = 12; // Average drink consumption per hour

            // Cached static game data (never changes during session)
            this._itemDetailMap = null;
            this._actionDetailMap = null;
            this._communityBuffMap = null;
        }

        /**
         * Get item detail map (lazy-loaded and cached)
         * @returns {Object} Item details map from init_client_data
         */
        getItemDetailMap() {
            if (!this._itemDetailMap) {
                const initData = dataManager.getInitClientData();
                this._itemDetailMap = initData?.itemDetailMap || {};
            }
            return this._itemDetailMap;
        }

        /**
         * Get action detail map (lazy-loaded and cached)
         * @returns {Object} Action details map from init_client_data
         */
        getActionDetailMap() {
            if (!this._actionDetailMap) {
                const initData = dataManager.getInitClientData();
                this._actionDetailMap = initData?.actionDetailMap || {};
            }
            return this._actionDetailMap;
        }

        /**
         * Get community buff map (lazy-loaded and cached)
         * @returns {Object} Community buff details map from init_client_data
         */
        getCommunityBuffMap() {
            if (!this._communityBuffMap) {
                const initData = dataManager.getInitClientData();
                this._communityBuffMap = initData?.communityBuffTypeDetailMap || {};
            }
            return this._communityBuffMap;
        }

        /**
         * Calculate profit for a crafted item
         * @param {string} itemHrid - Item HRID
         * @returns {Promise<Object|null>} Profit data or null if not craftable
         */
        async calculateProfit(itemHrid) {

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Find the action that produces this item
            const action = this.findProductionAction(itemHrid);
            if (!action) {
                return null; // Not a craftable item
            }

            // Get character skills for efficiency calculations
            const skills = dataManager.getSkills();
            if (!skills) {
                return null;
            }

            // Get action details
            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                return null;
            }


            // Calculate base action time
            // Game uses NANOSECONDS (1e9 = 1 second)
            const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

            // Get character level for the action's skill
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);

            // Get equipped items for efficiency bonus calculation
            const characterEquipment = dataManager.getEquipment();
            const itemDetailMap = this.getItemDetailMap();

            // Get Drink Concentration from equipment
            const drinkConcentration = getDrinkConcentration(
                characterEquipment,
                itemDetailMap
            );

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);


            // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
            // This lowers the effective requirement, not increases skill level
            const actionLevelBonus = parseActionLevelBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate efficiency components
            // Action Level bonus increases the effective requirement
            const baseRequirement = actionDetails.levelRequirement?.level || 1;
            const effectiveRequirement = baseRequirement + actionLevelBonus;
            const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);

            const houseEfficiency = calculateHouseEfficiency(actionDetails.type);

            // Calculate equipment efficiency bonus
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate tea efficiency bonus
            const teaEfficiency = parseTeaEfficiency(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate artisan material cost reduction
            const artisanBonus = parseArtisanBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate gourmet bonus (Brewing/Cooking extra items)
            const gourmetBonus = parseGourmetBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
            const processingBonus = parseProcessingBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Get community buff bonus (Production Efficiency)
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);


            // Total efficiency bonus (all sources additive)
            const efficiencyBonus = levelEfficiency + houseEfficiency + equipmentEfficiency + teaEfficiency + communityEfficiency;

            // Calculate equipment speed bonus
            const equipmentSpeedBonus = parseEquipmentSpeedBonuses(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate action time with ONLY speed bonuses
            // Efficiency does NOT reduce time - it gives bonus actions
            // Formula: baseTime / (1 + speedBonus)
            // Example: 60s / (1 + 0.15) = 52.17s
            const actionTime = baseTime / (1 + equipmentSpeedBonus);

            // Build time breakdown for display
            const timeBreakdown = this.calculateTimeBreakdown(
                baseTime,
                equipmentSpeedBonus
            );

            // Actions per hour (base rate without efficiency)
            const actionsPerHour = 3600 / actionTime;

            // Get output amount (how many items per action)
            // Use 'count' field from action output
            const outputAmount = action.count || action.baseAmount || 1;

            // Calculate efficiency multiplier
            // Formula matches original MWI Tools: 1 + efficiency%
            // Example: 150% efficiency → 1 + 1.5 = 2.5x multiplier
            const efficiencyMultiplier = 1 + (efficiencyBonus / 100);

            // Items produced per hour (with efficiency multiplier)
            const itemsPerHour = actionsPerHour * outputAmount * efficiencyMultiplier;

            // Extra items from Gourmet (Brewing/Cooking bonus)
            // Statistical average: itemsPerHour × gourmetChance
            const gourmetBonusItems = itemsPerHour * gourmetBonus;

            // Total items per hour (base + gourmet bonus)
            const totalItemsPerHour = itemsPerHour + gourmetBonusItems;

            // Calculate material costs (with artisan reduction if applicable)
            const materialCosts = this.calculateMaterialCosts(actionDetails, artisanBonus);

            // Total material cost per action
            const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

            // Get market price for the item
            // Use fallback {ask: 0, bid: 0} if no market data exists (e.g., refined items)
            const itemPrice = marketAPI.getPrice(itemHrid, 0) || { ask: 0, bid: 0 };

            // Check pricing mode setting
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

            // Get output price based on pricing mode
            // conservative: Bid price (instant sell)
            // hybrid/optimistic: Ask price (patient sell orders)
            let outputPrice = 0;
            if (pricingMode === 'conservative') {
                outputPrice = itemPrice.bid;
            } else {
                // hybrid or optimistic both use Ask for output
                outputPrice = itemPrice.ask;
            }

            // Apply market tax (2% tax on sales)
            const priceAfterTax = outputPrice * (1 - this.MARKET_TAX);

            // Cost per item (without efficiency scaling)
            const costPerItem = totalMaterialCost / outputAmount;

            // Material costs per hour (accounting for efficiency multiplier)
            // Efficiency repeats the action, consuming materials each time
            const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

            // Revenue per hour (already accounts for efficiency in itemsPerHour calculation)
            const revenuePerHour = (itemsPerHour * priceAfterTax) + (gourmetBonusItems * priceAfterTax);

            // Calculate tea consumption costs (drinks consumed per hour)
            const teaCosts = this.calculateTeaCosts(actionDetails.type, actionsPerHour, drinkConcentration);
            const totalTeaCostPerHour = teaCosts.reduce((sum, tea) => sum + tea.totalCost, 0);

            // Total costs per hour (materials + teas)
            const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour;

            // Calculate bonus revenue from essence and rare find drops (before profit calculation)
            const bonusRevenue = calculateBonusRevenue(
                actionDetails,
                actionsPerHour,
                characterEquipment,
                itemDetailMap
            );

            // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
            const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

            // Profit per hour (revenue + bonus revenue - total costs)
            const profitPerHour = revenuePerHour + efficiencyBoostedBonusRevenue - totalCostPerHour;

            // Profit per item (for display)
            const profitPerItem = profitPerHour / totalItemsPerHour;

            return {
                itemName: itemDetails.name,
                itemHrid,
                actionTime,
                actionsPerHour,
                itemsPerHour,
                totalItemsPerHour,        // Items/hour including Gourmet bonus
                gourmetBonusItems,        // Extra items from Gourmet
                outputAmount,
                materialCosts,
                totalMaterialCost,
                materialCostPerHour,      // Material costs per hour (with efficiency)
                teaCosts,                 // Tea consumption costs breakdown
                totalTeaCostPerHour,      // Total tea costs per hour
                costPerItem,
                itemPrice,
                priceAfterTax,            // Output price after 2% tax (bid or ask based on mode)
                profitPerItem,
                profitPerHour,
                profitPerDay: profitPerHour * 24,  // Profit per day
                bonusRevenue,             // Bonus revenue from essences and rare finds
                efficiencyBonus,         // Total efficiency
                levelEfficiency,          // Level advantage efficiency
                houseEfficiency,          // House room efficiency
                equipmentEfficiency,      // Equipment efficiency
                teaEfficiency,            // Tea buff efficiency
                communityEfficiency,      // Community buff efficiency
                actionLevelBonus,         // Action Level bonus from teas (e.g., Artisan Tea)
                artisanBonus,             // Artisan material cost reduction
                gourmetBonus,             // Gourmet bonus item chance
                processingBonus,          // Processing conversion chance
                drinkConcentration,       // Drink Concentration stat
                efficiencyMultiplier,
                equipmentSpeedBonus,
                skillLevel,
                baseRequirement,          // Base requirement level
                effectiveRequirement,     // Requirement after Action Level bonus
                requiredLevel: effectiveRequirement, // For backwards compatibility
                timeBreakdown
            };
        }

        /**
         * Find the action that produces a given item
         * @param {string} itemHrid - Item HRID
         * @returns {Object|null} Action output data or null
         */
        findProductionAction(itemHrid) {
            const actionDetailMap = this.getActionDetailMap();

            // Search through all actions for one that produces this item
            for (const [actionHrid, action] of Object.entries(actionDetailMap)) {
                if (action.outputItems) {
                    for (const output of action.outputItems) {
                        if (output.itemHrid === itemHrid) {
                            return {
                                actionHrid,
                                ...output
                            };
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Calculate material costs for an action
         * @param {Object} actionDetails - Action details from game data
         * @param {number} artisanBonus - Artisan material reduction (0 to 1, e.g., 0.112 for 11.2% reduction)
         * @returns {Array} Array of material cost objects
         */
        calculateMaterialCosts(actionDetails, artisanBonus = 0) {
            const costs = [];

            // Check pricing mode setting
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

            // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
            if (actionDetails.upgradeItemHrid) {
                const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);
                const price = marketAPI.getPrice(actionDetails.upgradeItemHrid, 0);

                if (itemDetails) {
                    // Get material price based on pricing mode
                    // conservative/hybrid: Ask price (instant buy)
                    // optimistic: Bid price (patient buy orders)
                    let materialPrice = 0;
                    if (pricingMode === 'optimistic') {
                        materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                    } else {
                        // conservative or hybrid both use Ask for materials
                        materialPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
                    }

                    // Special case: Coins have no market price but have face value of 1
                    if (actionDetails.upgradeItemHrid === '/items/coin' && materialPrice === 0) {
                        materialPrice = 1;
                    }

                    // Apply artisan reduction (upgrade items count as 1 item)
                    const reducedAmount = 1 * (1 - artisanBonus);

                    costs.push({
                        itemHrid: actionDetails.upgradeItemHrid,
                        itemName: itemDetails.name,
                        baseAmount: 1,
                        amount: reducedAmount,
                        askPrice: materialPrice,
                        totalCost: materialPrice * reducedAmount
                    });
                }
            }

            // Process regular input items
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                for (const input of actionDetails.inputItems) {
                    const itemDetails = dataManager.getItemDetails(input.itemHrid);
                    const price = marketAPI.getPrice(input.itemHrid, 0);

                    if (!itemDetails) {
                        continue;
                    }

                    // Use 'count' field (not 'amount')
                    const baseAmount = input.count || input.amount || 1;

                    // Apply artisan reduction
                    const reducedAmount = baseAmount * (1 - artisanBonus);

                    // Get material price based on pricing mode
                    // conservative/hybrid: Ask price (instant buy)
                    // optimistic: Bid price (patient buy orders)
                    let materialPrice = 0;
                    if (pricingMode === 'optimistic') {
                        materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                    } else {
                        // conservative or hybrid both use Ask for materials
                        materialPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
                    }

                    // Special case: Coins have no market price but have face value of 1
                    if (input.itemHrid === '/items/coin' && materialPrice === 0) {
                        materialPrice = 1; // 1 coin = 1 gold value
                    }

                    costs.push({
                        itemHrid: input.itemHrid,
                        itemName: itemDetails.name,
                        baseAmount: baseAmount,
                        amount: reducedAmount,
                        askPrice: materialPrice,
                        totalCost: materialPrice * reducedAmount
                    });
                }
            }

            return costs;
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            // e.g., "/action_types/cheesesmithing" -> "/skills/cheesesmithing"
            const skillHrid = skillType.replace('/action_types/', '/skills/');

            const skill = skills.find(s => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Calculate efficiency bonus from multiple sources
         * @param {number} characterLevel - Character's skill level
         * @param {number} requiredLevel - Action's required level
         * @param {string} actionTypeHrid - Action type HRID for house room matching
         * @returns {number} Total efficiency bonus percentage
         */
        calculateEfficiencyBonus(characterLevel, requiredLevel, actionTypeHrid) {
            // Level efficiency: +1% per level above requirement
            const levelEfficiency = Math.max(0, characterLevel - requiredLevel);

            // House room efficiency: houseLevel × 1.5%
            const houseEfficiency = calculateHouseEfficiency(actionTypeHrid);

            // Total efficiency (sum of all sources)
            const totalEfficiency = levelEfficiency + houseEfficiency;

            return totalEfficiency;
        }

        /**
         * Calculate time breakdown showing how modifiers affect action time
         * @param {number} baseTime - Base action time in seconds
         * @param {number} equipmentSpeedBonus - Equipment speed bonus as decimal (e.g., 0.15 for 15%)
         * @returns {Object} Time breakdown with steps
         */
        calculateTimeBreakdown(baseTime, equipmentSpeedBonus) {
            const steps = [];

            // Equipment Speed step (if > 0)
            if (equipmentSpeedBonus > 0) {
                const finalTime = baseTime / (1 + equipmentSpeedBonus);
                const reduction = baseTime - finalTime;

                steps.push({
                    name: 'Equipment Speed',
                    bonus: equipmentSpeedBonus * 100, // convert to percentage
                    reduction: reduction, // seconds saved
                    timeAfter: finalTime // final time
                });

                return {
                    baseTime: baseTime,
                    steps: steps,
                    finalTime: finalTime,
                    actionsPerHour: 3600 / finalTime
                };
            }

            // No modifiers - final time is base time
            return {
                baseTime: baseTime,
                steps: [],
                finalTime: baseTime,
                actionsPerHour: 3600 / baseTime
            };
        }

        /**
         * Calculate community buff bonus for production efficiency
         * @param {number} buffLevel - Community buff level (0-20)
         * @param {string} actionTypeHrid - Action type to check if buff applies
         * @returns {number} Efficiency bonus percentage
         */
        calculateCommunityBuffBonus(buffLevel, actionTypeHrid) {
            if (buffLevel === 0) {
                return 0;
            }

            // Check if buff applies to this action type
            const communityBuffMap = this.getCommunityBuffMap();
            const buffDef = communityBuffMap['/community_buff_types/production_efficiency'];

            if (!buffDef?.usableInActionTypeMap?.[actionTypeHrid]) {
                return 0; // Buff doesn't apply to this skill
            }

            // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
            const baseBonus = buffDef.buff.flatBoost * 100; // 14%
            const levelBonus = (buffLevel - 1) * buffDef.buff.flatBoostLevelBonus * 100; // 0.3% per level

            return baseBonus + levelBonus;
        }

        /**
         * Calculate tea consumption costs
         * @param {string} actionTypeHrid - Action type HRID
         * @param {number} actionsPerHour - Actions per hour (not used, but kept for consistency)
         * @returns {Array} Array of tea cost objects
         */
        calculateTeaCosts(actionTypeHrid, actionsPerHour, drinkConcentration = 0) {
            const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);
            if (!activeDrinks || activeDrinks.length === 0) {
                return [];
            }

            // Check pricing mode for tea costs
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

            const costs = [];

            for (const drink of activeDrinks) {
                if (!drink || !drink.itemHrid) continue;

                const itemDetails = dataManager.getItemDetails(drink.itemHrid);
                if (!itemDetails) continue;

                // Get market price for the tea
                const price = marketAPI.getPrice(drink.itemHrid, 0);

                // Use same pricing mode logic as materials
                let teaPrice = 0;
                if (pricingMode === 'optimistic') {
                    teaPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                } else {
                    // conservative or hybrid both use Ask for costs
                    teaPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
                }

                // Drink Concentration increases consumption rate: base 12/hour × (1 + DC%)
                const drinksPerHour = 12 * (1 + drinkConcentration);

                costs.push({
                    itemHrid: drink.itemHrid,
                    itemName: itemDetails.name,
                    pricePerDrink: teaPrice,
                    drinksPerHour: drinksPerHour,
                    totalCost: teaPrice * drinksPerHour
                });
            }

            return costs;
        }
    }

    // Create and export singleton instance
    const profitCalculator = new ProfitCalculator();

    /**
     * Skill Gear Detector
     *
     * Auto-detects gear and buffs from character equipment for any skill.
     * Originally designed for enhancing, now works generically for all skills.
     */


    /**
     * Detect best gear for a specific skill by equipment slot
     * @param {string} skillName - Skill name (e.g., 'enhancing', 'cooking', 'milking')
     * @param {Map} equipment - Character equipment map (equipped items only)
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Best gear per slot with bonuses
     */
    function detectSkillGear(skillName, equipment, itemDetailMap) {
        const gear = {
            // Totals for calculations
            toolBonus: 0,
            speedBonus: 0,
            rareFindBonus: 0,
            experienceBonus: 0,

            // Best items per slot for display
            toolSlot: null,    // main_hand or two_hand
            bodySlot: null,    // body
            legsSlot: null,    // legs
            handsSlot: null,   // hands
        };

        // Get items to scan - only use equipment map (already filtered to equipped items only)
        let itemsToScan = [];

        if (equipment) {
            // Scan only equipped items from equipment map
            itemsToScan = Array.from(equipment.values()).filter(item => item && item.itemHrid);
        }

        // Track best item per slot (by item level, then enhancement level)
        const slotCandidates = {
            tool: [],    // main_hand or two_hand or skill-specific tool
            body: [],    // body
            legs: [],    // legs
            hands: [],   // hands
            neck: [],    // neck (accessories have 5× multiplier)
            ring: [],    // ring (accessories have 5× multiplier)
            earring: [], // earring (accessories have 5× multiplier)
        };

        // Dynamic stat names based on skill
        const successStat = `${skillName}Success`;
        const speedStat = `${skillName}Speed`;
        const rareFindStat = `${skillName}RareFind`;
        const experienceStat = `${skillName}Experience`;

        // Search all items for skill-related bonuses and group by slot
        for (const item of itemsToScan) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail?.noncombatStats) continue;

            const stats = itemDetails.equipmentDetail.noncombatStats;
            const enhancementLevel = item.enhancementLevel || 0;
            const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const equipmentType = itemDetails.equipmentDetail.type;

            // Generic stat calculation: Loop over ALL stats and apply multiplier
            const allStats = {};
            for (const [statName, statValue] of Object.entries(stats)) {
                if (typeof statValue !== 'number') continue; // Skip non-numeric values
                allStats[statName] = statValue * 100 * multiplier;
            }

            // Check if item has any skill-related stats (including universal skills)
            const hasSkillStats = allStats[successStat] || allStats[speedStat] ||
                                 allStats[rareFindStat] || allStats[experienceStat] ||
                                 allStats.skillingSpeed || allStats.skillingExperience;

            if (!hasSkillStats) continue;

            // Calculate bonuses for this item (backward-compatible output)
            let itemBonuses = {
                item: item,
                itemDetails: itemDetails,
                itemLevel: itemDetails.itemLevel || 0,
                enhancementLevel: enhancementLevel,
                // Named bonuses (dynamic based on skill)
                toolBonus: allStats[successStat] || 0,
                speedBonus: (allStats[speedStat] || 0) + (allStats.skillingSpeed || 0),  // Combine speed sources
                rareFindBonus: allStats[rareFindStat] || 0,
                experienceBonus: (allStats[experienceStat] || 0) + (allStats.skillingExperience || 0),  // Combine experience sources
                // Generic access to all stats
                allStats: allStats,
            };

            // Group by slot
            // Tool slots: skill-specific tools (e.g., enhancing_tool, cooking_tool) plus main_hand/two_hand
            const skillToolType = `/equipment_types/${skillName}_tool`;
            if (equipmentType === skillToolType ||
                equipmentType === '/equipment_types/main_hand' ||
                equipmentType === '/equipment_types/two_hand') {
                slotCandidates.tool.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/body') {
                slotCandidates.body.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/legs') {
                slotCandidates.legs.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/hands') {
                slotCandidates.hands.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/neck') {
                slotCandidates.neck.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/ring') {
                slotCandidates.ring.push(itemBonuses);
            } else if (equipmentType === '/equipment_types/earring') {
                slotCandidates.earring.push(itemBonuses);
            }
        }

        // Select best item per slot (highest item level, then highest enhancement level)
        const selectBest = (candidates) => {
            if (candidates.length === 0) return null;

            return candidates.reduce((best, current) => {
                // Compare by item level first
                if (current.itemLevel > best.itemLevel) return current;
                if (current.itemLevel < best.itemLevel) return best;

                // If item levels are equal, compare by enhancement level
                if (current.enhancementLevel > best.enhancementLevel) return current;
                return best;
            });
        };

        const bestTool = selectBest(slotCandidates.tool);
        const bestBody = selectBest(slotCandidates.body);
        const bestLegs = selectBest(slotCandidates.legs);
        const bestHands = selectBest(slotCandidates.hands);
        const bestNeck = selectBest(slotCandidates.neck);
        const bestRing = selectBest(slotCandidates.ring);
        const bestEarring = selectBest(slotCandidates.earring);

        // Add bonuses from best items in each slot
        if (bestTool) {
            gear.toolBonus += bestTool.toolBonus;
            gear.speedBonus += bestTool.speedBonus;
            gear.rareFindBonus += bestTool.rareFindBonus;
            gear.experienceBonus += bestTool.experienceBonus;
            gear.toolSlot = {
                name: bestTool.itemDetails.name,
                enhancementLevel: bestTool.enhancementLevel,
            };
        }

        if (bestBody) {
            gear.toolBonus += bestBody.toolBonus;
            gear.speedBonus += bestBody.speedBonus;
            gear.rareFindBonus += bestBody.rareFindBonus;
            gear.experienceBonus += bestBody.experienceBonus;
            gear.bodySlot = {
                name: bestBody.itemDetails.name,
                enhancementLevel: bestBody.enhancementLevel,
            };
        }

        if (bestLegs) {
            gear.toolBonus += bestLegs.toolBonus;
            gear.speedBonus += bestLegs.speedBonus;
            gear.rareFindBonus += bestLegs.rareFindBonus;
            gear.experienceBonus += bestLegs.experienceBonus;
            gear.legsSlot = {
                name: bestLegs.itemDetails.name,
                enhancementLevel: bestLegs.enhancementLevel,
            };
        }

        if (bestHands) {
            gear.toolBonus += bestHands.toolBonus;
            gear.speedBonus += bestHands.speedBonus;
            gear.rareFindBonus += bestHands.rareFindBonus;
            gear.experienceBonus += bestHands.experienceBonus;
            gear.handsSlot = {
                name: bestHands.itemDetails.name,
                enhancementLevel: bestHands.enhancementLevel,
            };
        }

        if (bestNeck) {
            gear.toolBonus += bestNeck.toolBonus;
            gear.speedBonus += bestNeck.speedBonus;
            gear.rareFindBonus += bestNeck.rareFindBonus;
            gear.experienceBonus += bestNeck.experienceBonus;
        }

        if (bestRing) {
            gear.toolBonus += bestRing.toolBonus;
            gear.speedBonus += bestRing.speedBonus;
            gear.rareFindBonus += bestRing.rareFindBonus;
            gear.experienceBonus += bestRing.experienceBonus;
        }

        if (bestEarring) {
            gear.toolBonus += bestEarring.toolBonus;
            gear.speedBonus += bestEarring.speedBonus;
            gear.rareFindBonus += bestEarring.rareFindBonus;
            gear.experienceBonus += bestEarring.experienceBonus;
        }

        return gear;
    }

    /**
     * Detect active enhancing teas from drink slots
     * @param {Array} drinkSlots - Active drink slots for enhancing action type
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Active teas { enhancing, superEnhancing, ultraEnhancing, blessed }
     */
    function detectEnhancingTeas(drinkSlots, itemDetailMap) {
        const teas = {
            enhancing: false,        // Enhancing Tea (+3 levels)
            superEnhancing: false,   // Super Enhancing Tea (+6 levels)
            ultraEnhancing: false,   // Ultra Enhancing Tea (+8 levels)
            blessed: false,          // Blessed Tea (1% double jump)
        };

        if (!drinkSlots || drinkSlots.length === 0) {
            return teas;
        }

        // Tea HRIDs to check for
        const teaMap = {
            '/items/enhancing_tea': 'enhancing',
            '/items/super_enhancing_tea': 'superEnhancing',
            '/items/ultra_enhancing_tea': 'ultraEnhancing',
            '/items/blessed_tea': 'blessed',
        };

        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue;

            const teaKey = teaMap[drink.itemHrid];
            if (teaKey) {
                teas[teaKey] = true;
            }
        }

        return teas;
    }

    /**
     * Get enhancing tea level bonus
     * @param {Object} teas - Active teas from detectEnhancingTeas()
     * @returns {number} Total level bonus from teas
     */
    function getEnhancingTeaLevelBonus(teas) {
        // Teas don't stack - highest one wins
        if (teas.ultraEnhancing) return 8;
        if (teas.superEnhancing) return 6;
        if (teas.enhancing) return 3;

        return 0;
    }

    /**
     * Get enhancing tea speed bonus (base, before concentration)
     * @param {Object} teas - Active teas from detectEnhancingTeas()
     * @returns {number} Base speed bonus % from teas
     */
    function getEnhancingTeaSpeedBonus(teas) {
        // Teas don't stack - highest one wins
        // Base speed bonuses (before drink concentration):
        if (teas.ultraEnhancing) return 6;  // +6% base
        if (teas.superEnhancing) return 4;  // +4% base
        if (teas.enhancing) return 2;        // +2% base

        return 0;
    }

    /**
     * Backward-compatible wrapper for enhancing gear detection
     * @param {Map} equipment - Character equipment map (equipped items only)
     * @param {Object} itemDetailMap - Item details map from init_client_data
     * @returns {Object} Best enhancing gear per slot with bonuses
     */
    function detectEnhancingGear(equipment, itemDetailMap) {
        return detectSkillGear('enhancing', equipment, itemDetailMap);
    }

    /**
     * Enhancement Configuration Manager
     *
     * Combines auto-detected enhancing parameters with manual overrides from settings.
     * Provides single source of truth for enhancement simulator inputs.
     */


    /**
     * Get enhancing parameters (auto-detected or manual)
     * @returns {Object} Enhancement parameters for simulator
     */
    function getEnhancingParams() {
        const autoDetect = config.getSettingValue('enhanceSim_autoDetect', false);

        if (autoDetect) {
            return getAutoDetectedParams();
        } else {
            return getManualParams();
        }
    }

    /**
     * Get auto-detected enhancing parameters from character data
     * @returns {Object} Auto-detected parameters
     */
    function getAutoDetectedParams() {
        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const drinkSlots = dataManager.getActionDrinkSlots('/action_types/enhancing');
        const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

        // Detect gear from equipped items only
        const gear = detectEnhancingGear(equipment, itemDetailMap);

        // Detect drink concentration from equipment (Guzzling Pouch)
        // IMPORTANT: Only scan equipped items, not entire inventory
        let drinkConcentration = 0;
        const itemsToScan = equipment ? Array.from(equipment.values()).filter(item => item && item.itemHrid) : [];

        for (const item of itemsToScan) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

            const concentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
            const enhancementLevel = item.enhancementLevel || 0;
            const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
            const scaledConcentration = concentration * 100 * multiplier;

            // Only keep the highest concentration (shouldn't have multiple, but just in case)
            if (scaledConcentration > drinkConcentration) {
                drinkConcentration = scaledConcentration;
            }
        }

        // Detect teas
        const teas = detectEnhancingTeas(drinkSlots);

        // Get tea level bonus (base, then scale with concentration)
        const baseTeaLevel = getEnhancingTeaLevelBonus(teas);
        const teaLevelBonus = baseTeaLevel > 0 ? baseTeaLevel * (1 + drinkConcentration / 100) : 0;

        // Get tea speed bonus (base, then scale with concentration)
        const baseTeaSpeed = getEnhancingTeaSpeedBonus(teas);
        const teaSpeedBonus = baseTeaSpeed > 0 ? baseTeaSpeed * (1 + drinkConcentration / 100) : 0;

        // Get tea wisdom bonus (base, then scale with concentration)
        // Wisdom Tea/Coffee provide 12% wisdom, scales with drink concentration
        let baseTeaWisdom = 0;
        if (drinkSlots && drinkSlots.length > 0) {
            for (const drink of drinkSlots) {
                if (!drink || !drink.itemHrid) continue;
                const drinkDetails = itemDetailMap[drink.itemHrid];
                if (!drinkDetails?.consumableDetail?.buffs) continue;

                const wisdomBuff = drinkDetails.consumableDetail.buffs.find(
                    buff => buff.typeHrid === '/buff_types/wisdom'
                );

                if (wisdomBuff && wisdomBuff.flatBoost) {
                    baseTeaWisdom += wisdomBuff.flatBoost * 100; // Convert to percentage
                }
            }
        }
        const teaWisdomBonus = baseTeaWisdom > 0 ? baseTeaWisdom * (1 + drinkConcentration / 100) : 0;

        // Get Enhancing skill level
        const enhancingSkill = skills.find(s => s.skillHrid === '/skills/enhancing');
        const enhancingLevel = enhancingSkill?.level || 1;

        // Get Observatory house room level (enhancing uses observatory, NOT laboratory!)
        const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/observatory');

        // Calculate global house buffs from ALL house rooms
        // Rare Find: 0.2% base + 0.2% per level (per room, only if level >= 1)
        // Wisdom: 0.05% base + 0.05% per level (per room, only if level >= 1)
        const houseRooms = dataManager.getHouseRooms();
        let houseRareFindBonus = 0;
        let houseWisdomBonus = 0;

        for (const [hrid, room] of houseRooms) {
            const level = room.level || 0;
            if (level >= 1) {
                // Each room: 0.2% per level (NOT 0.2% base + 0.2% per level)
                houseRareFindBonus += 0.2 * level;
                // Each room: 0.05% per level (NOT 0.05% base + 0.05% per level)
                houseWisdomBonus += 0.05 * level;
            }
        }

        // Get Enhancing Speed community buff level
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
        // Formula: 20% base + 0.5% per level
        const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

        // Get Experience (Wisdom) community buff level
        const communityWisdomLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
        // Formula: 20% base + 0.5% per level (same as other community buffs)
        const communityWisdomBonus = communityWisdomLevel > 0 ? 20 + (communityWisdomLevel - 1) * 0.5 : 0;

        // Calculate total success rate bonus
        // Equipment + house + (check for other sources)
        const houseSuccessBonus = houseLevel * 0.05;  // 0.05% per level for success
        const equipmentSuccessBonus = gear.toolBonus;
        const totalSuccessBonus = equipmentSuccessBonus + houseSuccessBonus;

        // Calculate total speed bonus
        // Speed bonus (from equipment) + house bonus (1% per level) + community buff + tea speed
        const houseSpeedBonus = houseLevel * 1.0;  // 1% per level for action speed
        const totalSpeedBonus = gear.speedBonus + houseSpeedBonus + communitySpeedBonus + teaSpeedBonus;

        // Calculate total experience bonus
        // Equipment + house wisdom + tea wisdom + community wisdom
        const totalExperienceBonus = gear.experienceBonus + houseWisdomBonus + teaWisdomBonus + communityWisdomBonus;

        // Calculate guzzling bonus multiplier (1.0 at level 0, scales with drink concentration)
        const guzzlingBonus = 1 + drinkConcentration / 100;

        return {
            // Core values for calculations
            enhancingLevel: enhancingLevel + teaLevelBonus,  // Base level + tea bonus
            houseLevel: houseLevel,
            toolBonus: totalSuccessBonus,                     // Tool + house combined
            speedBonus: totalSpeedBonus,                      // Speed + house + community + tea combined
            rareFindBonus: gear.rareFindBonus + houseRareFindBonus,  // Rare find (equipment + all house rooms)
            experienceBonus: totalExperienceBonus,            // Experience (equipment + house + tea + community wisdom)
            guzzlingBonus: guzzlingBonus,                     // Drink concentration multiplier for blessed tea
            teas: teas,

            // Display info (for UI) - show best item per slot
            toolSlot: gear.toolSlot,
            bodySlot: gear.bodySlot,
            legsSlot: gear.legsSlot,
            handsSlot: gear.handsSlot,
            detectedTeaBonus: teaLevelBonus,
            communityBuffLevel: communityBuffLevel,           // For display (speed)
            communitySpeedBonus: communitySpeedBonus,         // For display
            communityWisdomLevel: communityWisdomLevel,       // For display
            communityWisdomBonus: communityWisdomBonus,       // For display
            teaSpeedBonus: teaSpeedBonus,                     // For display
            teaWisdomBonus: teaWisdomBonus,                   // For display
            drinkConcentration: drinkConcentration,           // For display
            houseRareFindBonus: houseRareFindBonus,           // For display
            houseWisdomBonus: houseWisdomBonus,               // For display
            equipmentRareFind: gear.rareFindBonus,            // For display
            equipmentExperience: gear.experienceBonus,        // For display
            equipmentSuccessBonus: equipmentSuccessBonus,     // For display
            houseSuccessBonus: houseSuccessBonus,             // For display
            equipmentSpeedBonus: gear.speedBonus,             // For display
            houseSpeedBonus: houseSpeedBonus,                 // For display
        };
    }

    /**
     * Get manual enhancing parameters from config settings
     * @returns {Object} Manual parameters
     */
    function getManualParams() {
        // Get values directly from config
        const getValue = (key, defaultValue) => {
            return config.getSettingValue(key, defaultValue);
        };

        const houseLevel = getValue('enhanceSim_houseLevel', 6);
        const teas = {
            enhancing: getValue('enhanceSim_enhancingTea', false),
            superEnhancing: getValue('enhanceSim_superEnhancingTea', false),
            ultraEnhancing: getValue('enhanceSim_ultraEnhancingTea', true),
            blessed: getValue('enhanceSim_blessedTea', true),
        };

        // Calculate tea bonuses
        const teaLevelBonus = teas.ultraEnhancing ? 8 : teas.superEnhancing ? 6 : teas.enhancing ? 3 : 0;
        const teaSpeedBonus = teas.ultraEnhancing ? 6 : teas.superEnhancing ? 4 : teas.enhancing ? 2 : 0;

        // Calculate house bonuses
        const houseSpeedBonus = houseLevel * 1.0;  // 1% per level
        const houseSuccessBonus = houseLevel * 0.05;  // 0.05% per level

        // Get community buffs
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed');
        const communitySpeedBonus = communityBuffLevel > 0 ? 20 + (communityBuffLevel - 1) * 0.5 : 0;

        // Equipment speed is whatever's left after house/community/tea
        const totalSpeed = getValue('enhanceSim_speedBonus', 0);
        const equipmentSpeedBonus = Math.max(0, totalSpeed - houseSpeedBonus - communitySpeedBonus - teaSpeedBonus);

        const toolBonusEquipment = getValue('enhanceSim_toolBonus', 5.42);
        const totalToolBonus = toolBonusEquipment + houseSuccessBonus;

        return {
            enhancingLevel: getValue('enhanceSim_enhancingLevel', 125) + teaLevelBonus,
            houseLevel: houseLevel,
            toolBonus: totalToolBonus,  // Total = equipment + house
            speedBonus: totalSpeed,
            rareFindBonus: getValue('enhanceSim_rareFindBonus', 0),
            experienceBonus: getValue('enhanceSim_experienceBonus', 0),
            guzzlingBonus: 1 + getValue('enhanceSim_drinkConcentration', 10.32) / 100,
            teas: teas,

            // Display info for manual mode
            toolSlot: null,
            bodySlot: null,
            legsSlot: null,
            handsSlot: null,
            detectedTeaBonus: teaLevelBonus,
            communityBuffLevel: communityBuffLevel,
            communitySpeedBonus: communitySpeedBonus,
            teaSpeedBonus: teaSpeedBonus,
            equipmentSpeedBonus: equipmentSpeedBonus,
            houseSpeedBonus: houseSpeedBonus,
            equipmentSuccessBonus: toolBonusEquipment,  // Just equipment
            houseSuccessBonus: houseSuccessBonus,
        };
    }

    /**
     * Enhancement Calculator
     *
     * Uses Markov Chain matrix math to calculate exact expected values for enhancement attempts.
     * Based on the original MWI Tools Enhancelate() function.
     *
     * Math.js library is loaded via userscript @require header.
     */

    /**
     * Base success rates by enhancement level (before bonuses)
     */
    const BASE_SUCCESS_RATES = [
        50, // +1
        45, // +2
        45, // +3
        40, // +4
        40, // +5
        40, // +6
        35, // +7
        35, // +8
        35, // +9
        35, // +10
        30, // +11
        30, // +12
        30, // +13
        30, // +14
        30, // +15
        30, // +16
        30, // +17
        30, // +18
        30, // +19
        30, // +20
    ];

    /**
     * Calculate total success rate bonus multiplier
     * @param {Object} params - Enhancement parameters
     * @param {number} params.enhancingLevel - Effective enhancing level (base + tea bonus)
     * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house bonus)
     * @param {number} params.itemLevel - Item level being enhanced
     * @returns {number} Success rate multiplier (e.g., 1.0519 = 105.19% of base rates)
     */
    function calculateSuccessMultiplier(params) {
        const { enhancingLevel, toolBonus, itemLevel } = params;

        // Total bonus calculation
        // toolBonus already includes equipment + house success bonus from config
        // We only need to add level advantage here

        let totalBonus;

        if (enhancingLevel >= itemLevel) {
            // Above or at item level: +0.05% per level above item level
            const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
            totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
        } else {
            // Below item level: Penalty based on level deficit
            totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
        }

        return totalBonus;
    }

    /**
     * Calculate per-action time for enhancement
     * Simple calculation that doesn't require Markov chain analysis
     * @param {number} enhancingLevel - Effective enhancing level (includes tea bonus)
     * @param {number} itemLevel - Item level being enhanced
     * @param {number} speedBonus - Speed bonus % (for action time calculation)
     * @returns {number} Per-action time in seconds
     */
    function calculatePerActionTime(enhancingLevel, itemLevel, speedBonus = 0) {
        const baseActionTime = 12; // seconds
        let speedMultiplier;

        if (enhancingLevel > itemLevel) {
            // Above item level: Get speed bonus from level advantage + equipment + house
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
        } else {
            // Below item level: Only equipment + house speed bonus
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + speedBonus / 100;
        }

        return baseActionTime / speedMultiplier;
    }

    /**
     * Calculate enhancement statistics using Markov Chain matrix inversion
     * @param {Object} params - Enhancement parameters
     * @param {number} params.enhancingLevel - Effective enhancing level (includes tea bonus)
     * @param {number} params.houseLevel - Observatory house room level (used for speed calculation only)
     * @param {number} params.toolBonus - Tool success bonus % (already includes equipment + house success bonus from config)
     * @param {number} params.speedBonus - Speed bonus % (for action time calculation)
     * @param {number} params.itemLevel - Item level being enhanced
     * @param {number} params.targetLevel - Target enhancement level (1-20)
     * @param {number} params.protectFrom - Start using protection items at this level (0 = never)
     * @param {boolean} params.blessedTea - Whether Blessed Tea is active (1% double jump)
     * @param {number} params.guzzlingBonus - Drink concentration multiplier (1.0 = no bonus, scales blessed tea)
     * @returns {Object} Enhancement statistics
     */
    function calculateEnhancement(params) {
        const {
            enhancingLevel,
            houseLevel,
            toolBonus,
            speedBonus = 0,
            itemLevel,
            targetLevel,
            protectFrom = 0,
            blessedTea = false,
            guzzlingBonus = 1.0
        } = params;

        // Validate inputs
        if (targetLevel < 1 || targetLevel > 20) {
            throw new Error('Target level must be between 1 and 20');
        }
        if (protectFrom < 0 || protectFrom > targetLevel) {
            throw new Error('Protection level must be between 0 and target level');
        }

        // Calculate success rate multiplier
        const successMultiplier = calculateSuccessMultiplier({
            enhancingLevel,
            toolBonus,
            itemLevel
        });

        // Build Markov Chain transition matrix (20×20)
        const markov = math.zeros(20, 20);

        for (let i = 0; i < targetLevel; i++) {
            const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
            const successChance = baseSuccessRate * successMultiplier;

            // Where do we go on failure?
            // Protection only applies when protectFrom > 0 AND we're at or above that level
            const failureDestination = (protectFrom > 0 && i >= protectFrom) ? i - 1 : 0;

            if (blessedTea) {
                // Blessed Tea: 1% base chance to jump +2, scaled by guzzling bonus
                // Remaining success chance goes to +1 (after accounting for skip chance)
                const skipChance = successChance * 0.01 * guzzlingBonus;
                const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);

                markov.set([i, i + 2], skipChance);
                markov.set([i, i + 1], remainingSuccess);
                markov.set([i, failureDestination], 1 - successChance);
            } else {
                // Normal: Success goes to +1, failure goes to destination
                markov.set([i, i + 1], successChance);
                markov.set([i, failureDestination], 1.0 - successChance);
            }
        }

        // Absorbing state at target level
        markov.set([targetLevel, targetLevel], 1.0);

        // Extract transient matrix Q (all states before target)
        const Q = markov.subset(
            math.index(math.range(0, targetLevel), math.range(0, targetLevel))
        );

        // Fundamental matrix: M = (I - Q)^-1
        const I = math.identity(targetLevel);
        const M = math.inv(math.subtract(I, Q));

        // Expected attempts from level 0 to target
        // Sum all elements in first row of M up to targetLevel
        let attempts = 0;
        for (let i = 0; i < targetLevel; i++) {
            attempts += M.get([0, i]);
        }

        // Expected protection item uses
        let protects = 0;
        if (protectFrom > 0 && protectFrom < targetLevel) {
            for (let i = protectFrom; i < targetLevel; i++) {
                const timesAtLevel = M.get([0, i]);
                const failureChance = markov.get([i, i - 1]);
                protects += timesAtLevel * failureChance;
            }
        }

        // Action time calculation
        const baseActionTime = 12; // seconds
        let speedMultiplier;

        if (enhancingLevel > itemLevel) {
            // Above item level: Get speed bonus from level advantage + equipment + house
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + (enhancingLevel - itemLevel + speedBonus) / 100;
        } else {
            // Below item level: Only equipment + house speed bonus
            // Note: speedBonus already includes house level bonus (1% per level)
            speedMultiplier = 1 + speedBonus / 100;
        }

        const perActionTime = baseActionTime / speedMultiplier;
        const totalTime = perActionTime * attempts;

        return {
            attempts: attempts,  // Keep exact decimal value for calculations
            attemptsRounded: Math.round(attempts),  // Rounded for display
            protectionCount: protects,  // Keep decimal precision
            perActionTime: perActionTime,
            totalTime: totalTime,
            successMultiplier: successMultiplier,

            // Detailed success rates for each level
            successRates: BASE_SUCCESS_RATES.slice(0, targetLevel).map((base, i) => {
                return {
                    level: i + 1,
                    baseRate: base,
                    actualRate: Math.min(100, base * successMultiplier),
                };
            }),
        };
    }

    /**
     * Enhancement Tooltip Module
     *
     * Provides enhancement analysis for item tooltips.
     * Calculates optimal enhancement path and total costs for reaching current enhancement level.
     *
     * This module is part of Phase 2 of Option D (Hybrid Approach):
     * - Enhancement panel: Shows 20-level enhancement table
     * - Item tooltips: Shows optimal path to reach current enhancement level
     */


    /**
     * Calculate optimal enhancement path for an item
     * Tests all protection strategies and finds the cheapest one
     *
     * @param {string} itemHrid - Item HRID (e.g., '/items/cheese_sword')
     * @param {number} currentEnhancementLevel - Current enhancement level (1-20)
     * @param {Object} config - Enhancement configuration from enhancement-config.js
     * @returns {Object|null} Enhancement analysis or null if not enhanceable
     */
    function calculateEnhancementPath(itemHrid, currentEnhancementLevel, config) {
        // Validate inputs
        if (!itemHrid || currentEnhancementLevel < 1 || currentEnhancementLevel > 20) {
            return null;
        }

        // Get item details
        const gameData = dataManager.getInitClientData();
        if (!gameData) return null;

        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) return null;

        // Check if item is enhanceable
        if (!itemDetails.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
            return null;
        }

        // Get enhancement parameters from config
        const itemLevel = itemDetails.itemLevel || 1;

        // Test all protection strategies (2 through target level)
        const strategies = [];

        // Strategy 0: Never protect (benchmark)
        const neverProtect = testProtectionStrategy(
            currentEnhancementLevel,
            0, // protectFrom = 0 (never)
            itemHrid,
            itemLevel,
            config
        );
        if (neverProtect) {
            strategies.push({
                protectFrom: 0,
                label: 'Never',
                ...neverProtect
            });
        }

        // Strategies 2 through target level
        for (let protectFrom = 2; protectFrom <= currentEnhancementLevel; protectFrom++) {
            const result = testProtectionStrategy(
                currentEnhancementLevel,
                protectFrom,
                itemHrid,
                itemLevel,
                config
            );

            if (result) {
                strategies.push({
                    protectFrom,
                    label: `From +${protectFrom}`,
                    ...result
                });
            }
        }

        // Find cheapest strategy
        if (strategies.length === 0) return null;

        strategies.sort((a, b) => a.totalCost - b.totalCost);
        const optimal = strategies[0];

        return {
            targetLevel: currentEnhancementLevel,
            itemLevel,
            optimalStrategy: optimal,
            allStrategies: strategies
        };
    }

    /**
     * Test a single protection strategy
     * @private
     */
    function testProtectionStrategy(targetLevel, protectFrom, itemHrid, itemLevel, config) {
        try {
            const params = {
                enhancingLevel: config.enhancingLevel,
                houseLevel: config.houseLevel,
                toolBonus: config.toolBonus || 0,
                speedBonus: config.speedBonus || 0,
                itemLevel,
                targetLevel,
                protectFrom,
                blessedTea: config.teas.blessed,
                guzzlingBonus: config.guzzlingBonus
            };

            // Calculate enhancement statistics
            const result = calculateEnhancement(params);

            // Validate result
            if (!result || typeof result.attempts !== 'number' || typeof result.totalTime !== 'number') {
                console.error('[Enhancement Tooltip] Invalid result from calculateEnhancement:', result);
                console.error('[Enhancement Tooltip] Input params were:', params);
                return null;
            }

            // Calculate costs (use full config object, not params)
            const costs = calculateTotalCost(itemHrid, targetLevel, protectFrom, config);

            return {
                expectedAttempts: result.attempts,  // Rename attempts to expectedAttempts for tooltip display
                totalTime: result.totalTime,
                ...costs
            };
        } catch (error) {
            console.error('[Enhancement Tooltip] Strategy calculation error:', error);
            return null;
        }
    }

    /**
     * Calculate total cost for enhancement path
     * Matches original MWI Tools v25.0 cost calculation
     * @private
     */
    function calculateTotalCost(itemHrid, targetLevel, protectFrom, config) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];
        const itemLevel = itemDetails.itemLevel || 1;

        // Calculate total attempts for full path (0 to targetLevel)
        const pathResult = calculateEnhancement({
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel,
            protectFrom,
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus
        });

        // Calculate per-action material cost (same for all enhancement levels)
        // enhancementCosts is a flat array of materials needed per attempt
        let perActionCost = 0;
        if (itemDetails.enhancementCosts) {
            for (const material of itemDetails.enhancementCosts) {
                const materialDetail = gameData.itemDetailMap[material.itemHrid];
                let price;

                // Special case: Trainee charms have fixed 250k price (untradeable)
                if (material.itemHrid.startsWith('/items/trainee_')) {
                    price = 250000;
                } else if (material.itemHrid === '/items/coin') {
                    price = 1; // Coins have face value of 1
                } else {
                    const marketPrice = marketAPI.getPrice(material.itemHrid, 0);
                    if (marketPrice) {
                        let ask = marketPrice.ask;
                        let bid = marketPrice.bid;

                        // Match MCS behavior: if one price is positive and other is negative, use positive for both
                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        // MCS uses just ask for material prices
                        price = ask;
                    } else {
                        // Fallback to sellPrice if no market data
                        price = materialDetail?.sellPrice || 0;
                    }
                }
                perActionCost += price * material.count;
            }
        }

        // Total material cost = per-action cost × total attempts
        const materialCost = perActionCost * pathResult.attempts;

        // Protection cost = cheapest protection option × protection count
        let protectionCost = 0;
        let protectionItemHrid = null;
        let protectionCount = 0;
        if (protectFrom > 0 && pathResult.protectionCount > 0) {
            const protectionInfo = getCheapestProtectionPrice(itemHrid);
            if (protectionInfo.price > 0) {
                protectionCost = protectionInfo.price * pathResult.protectionCount;
                protectionItemHrid = protectionInfo.itemHrid;
                protectionCount = pathResult.protectionCount;
            }
        }

        // Base item cost (initial investment) using realistic pricing
        const baseCost = getRealisticBaseItemPrice(itemHrid);

        return {
            baseCost,
            materialCost,
            protectionCost,
            protectionItemHrid,
            protectionCount,
            totalCost: baseCost + materialCost + protectionCost
        };
    }

    /**
     * Get realistic base item price with production cost fallback
     * Matches original MWI Tools v25.0 getRealisticBaseItemPrice logic
     * @private
     */
    function getRealisticBaseItemPrice(itemHrid) {
        const marketPrice = marketAPI.getPrice(itemHrid, 0);
        const ask = marketPrice?.ask > 0 ? marketPrice.ask : 0;
        const bid = marketPrice?.bid > 0 ? marketPrice.bid : 0;

        // Calculate production cost as fallback
        const productionCost = getProductionCost(itemHrid);

        // If both ask and bid exist
        if (ask > 0 && bid > 0) {
            // If ask is significantly higher than bid (>30% markup), use max(bid, production)
            if (ask / bid > 1.3) {
                return Math.max(bid, productionCost);
            }
            // Otherwise use ask (normal market)
            return ask;
        }

        // If only ask exists
        if (ask > 0) {
            // If ask is inflated compared to production, use production
            if (productionCost > 0 && ask / productionCost > 1.3) {
                return productionCost;
            }
            // Otherwise use max of ask and production
            return Math.max(ask, productionCost);
        }

        // If only bid exists, use max(bid, production)
        if (bid > 0) {
            return Math.max(bid, productionCost);
        }

        // No market data - use production cost as fallback
        return productionCost;
    }

    /**
     * Calculate production cost from crafting recipe
     * Matches original MWI Tools v25.0 getBaseItemProductionCost logic
     * @private
     */
    function getProductionCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        if (!itemDetails || !itemDetails.name) {
            return 0;
        }

        // Find the action that produces this item
        let actionHrid = null;
        for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (action.outputItems && action.outputItems.length > 0) {
                const output = action.outputItems[0];
                if (output.itemHrid === itemHrid) {
                    actionHrid = hrid;
                    break;
                }
            }
        }

        if (!actionHrid) {
            return 0;
        }

        const action = gameData.actionDetailMap[actionHrid];
        let totalPrice = 0;

        // Sum up input material costs
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputPrice = marketAPI.getPrice(input.itemHrid, 0);
                const price = inputPrice?.ask > 0 ? inputPrice.ask : 0;
                totalPrice += price * input.count;
            }
        }

        // Apply Artisan Tea reduction (0.9x)
        totalPrice *= 0.9;

        // Add upgrade item cost if this is an upgrade recipe (for refined items)
        if (action.upgradeItemHrid) {
            const upgradePrice = marketAPI.getPrice(action.upgradeItemHrid, 0);
            const price = upgradePrice?.ask > 0 ? upgradePrice.ask : 0;
            totalPrice += price;
        }

        return totalPrice;
    }

    /**
     * Get cheapest protection item price
     * Tests: item itself, mirror of protection, and specific protection items
     * @private
     */
    function getCheapestProtectionPrice(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        // Build list of protection options: [item itself, mirror, ...specific items]
        const protectionOptions = [
            itemHrid,
            '/items/mirror_of_protection'
        ];

        // Add specific protection items if they exist
        if (itemDetails.protectionItemHrids && itemDetails.protectionItemHrids.length > 0) {
            // protectionItemHrids is an array of arrays (one per level)
            // Flatten and deduplicate
            const allProtectionHrids = new Set();
            for (const levelProtections of itemDetails.protectionItemHrids) {
                if (Array.isArray(levelProtections)) {
                    for (const hrid of levelProtections) {
                        allProtectionHrids.add(hrid);
                    }
                }
            }
            protectionOptions.push(...Array.from(allProtectionHrids));
        }

        // Find cheapest option
        let cheapestPrice = Infinity;
        let cheapestItemHrid = null;
        for (const protectionHrid of protectionOptions) {
            const price = getRealisticBaseItemPrice(protectionHrid);
            if (price > 0 && price < cheapestPrice) {
                cheapestPrice = price;
                cheapestItemHrid = protectionHrid;
            }
        }

        return {
            price: cheapestPrice === Infinity ? 0 : cheapestPrice,
            itemHrid: cheapestItemHrid
        };
    }

    /**
     * Build HTML for enhancement tooltip section
     * @param {Object} enhancementData - Enhancement analysis from calculateEnhancementPath()
     * @returns {string} HTML string
     */
    function buildEnhancementTooltipHTML(enhancementData) {
        if (!enhancementData || !enhancementData.optimalStrategy) {
            return '';
        }

        const { targetLevel, optimalStrategy } = enhancementData;

        // Validate required fields
        if (typeof optimalStrategy.expectedAttempts !== 'number' ||
            typeof optimalStrategy.totalTime !== 'number' ||
            typeof optimalStrategy.materialCost !== 'number' ||
            typeof optimalStrategy.totalCost !== 'number') {
            console.error('[Enhancement Tooltip] Missing required fields in optimal strategy:', optimalStrategy);
            return '';
        }

        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin-top: 8px; padding-top: 8px;">';
        html += '<div style="font-weight: bold; margin-bottom: 4px;">ENHANCEMENT PATH (+0 → +' + targetLevel + ')</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Optimal strategy
        html += '<div>Strategy: ' + optimalStrategy.label + '</div>';
        html += '<div>Expected Attempts: ' + numberFormatter(optimalStrategy.expectedAttempts.toFixed(1)) + '</div>';

        // Costs
        html += '<div style="margin-top: 4px;">';
        html += 'Base Item: ' + numberFormatter(optimalStrategy.baseCost);
        html += '<br>Materials: ' + numberFormatter(optimalStrategy.materialCost);

        if (optimalStrategy.protectionCost > 0) {
            let protectionDisplay = numberFormatter(optimalStrategy.protectionCost);

            // Show protection count and item name if available
            if (optimalStrategy.protectionCount > 0) {
                protectionDisplay += ' (' + optimalStrategy.protectionCount.toFixed(1) + '×';

                if (optimalStrategy.protectionItemHrid) {
                    const gameData = dataManager.getInitClientData();
                    const itemDetails = gameData?.itemDetailMap[optimalStrategy.protectionItemHrid];
                    if (itemDetails?.name) {
                        protectionDisplay += ' ' + itemDetails.name;
                    }
                }

                protectionDisplay += ')';
            }

            html += '<br>Protection: ' + protectionDisplay;
        }

        html += '<br><span style="font-weight: bold;">Total: ' + numberFormatter(optimalStrategy.totalCost) + '</span>';
        html += '</div>';

        // Time estimate
        const totalSeconds = optimalStrategy.totalTime;

        if (totalSeconds < 60) {
            // Less than 1 minute: show seconds
            html += '<div style="margin-top: 4px;">Time: ~' + Math.round(totalSeconds) + ' seconds</div>';
        } else if (totalSeconds < 3600) {
            // Less than 1 hour: show minutes
            const minutes = Math.round(totalSeconds / 60);
            html += '<div style="margin-top: 4px;">Time: ~' + minutes + ' minutes</div>';
        } else if (totalSeconds < 86400) {
            // Less than 1 day: show hours
            const hours = (totalSeconds / 3600).toFixed(1);
            html += '<div style="margin-top: 4px;">Time: ~' + hours + ' hours</div>';
        } else {
            // 1 day or more: show days
            const days = (totalSeconds / 86400).toFixed(1);
            html += '<div style="margin-top: 4px;">Time: ~' + days + ' days</div>';
        }

        html += '</div>'; // Close margin-left div
        html += '</div>'; // Close main container

        return html;
    }

    /**
     * DOM Utilities Module
     * Helpers for DOM manipulation and element creation
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_TRANSFORM3D = /translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/;

    /**
     * Wait for an element to appear in the DOM
     * @param {string} selector - CSS selector
     * @param {number} timeout - Max wait time in ms (default: 10000)
     * @param {number} interval - Check interval in ms (default: 100)
     * @returns {Promise<Element|null>} The element or null if timeout
     */
    function waitForElement(selector, timeout = 10000, interval = 100) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                const element = document.querySelector(selector);

                if (element) {
                    resolve(element);
                } else if (Date.now() - startTime >= timeout) {
                    console.warn(`[DOM] Timeout waiting for: ${selector}`);
                    resolve(null);
                } else {
                    setTimeout(check, interval);
                }
            };

            check();
        });
    }

    /**
     * Wait for multiple elements to appear
     * @param {string} selector - CSS selector
     * @param {number} minCount - Minimum number of elements to wait for (default: 1)
     * @param {number} timeout - Max wait time in ms (default: 10000)
     * @returns {Promise<NodeList|null>} The elements or null if timeout
     */
    function waitForElements(selector, minCount = 1, timeout = 10000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                const elements = document.querySelectorAll(selector);

                if (elements.length >= minCount) {
                    resolve(elements);
                } else if (Date.now() - startTime >= timeout) {
                    console.warn(`[DOM] Timeout waiting for ${minCount}× ${selector}`);
                    resolve(null);
                } else {
                    setTimeout(check, 100);
                }
            };

            check();
        });
    }

    /**
     * Create a styled div element
     * @param {Object} styles - CSS styles object
     * @param {string} text - Optional text content
     * @param {string} className - Optional class name
     * @returns {HTMLDivElement} Created div
     */
    function createStyledDiv(styles = {}, text = '', className = '') {
        const div = document.createElement('div');

        if (className) {
            div.className = className;
        }

        if (text) {
            div.textContent = text;
        }

        Object.assign(div.style, styles);

        return div;
    }

    /**
     * Create a styled span element
     * @param {Object} styles - CSS styles object
     * @param {string} text - Text content
     * @param {string} className - Optional class name
     * @returns {HTMLSpanElement} Created span
     */
    function createStyledSpan(styles = {}, text = '', className = '') {
        const span = document.createElement('span');

        if (className) {
            span.className = className;
        }

        if (text) {
            span.textContent = text;
        }

        Object.assign(span.style, styles);

        return span;
    }

    /**
     * Create a colored text span (uses script colors from config)
     * @param {string} text - Text content
     * @param {string} colorType - 'main', 'tooltip', or 'alert' (default: 'main')
     * @returns {HTMLSpanElement} Created span with color
     */
    function createColoredText(text, colorType = 'main') {
        let color;

        switch (colorType) {
            case 'main':
                color = config.SCRIPT_COLOR_MAIN;
                break;
            case 'tooltip':
                color = config.SCRIPT_COLOR_TOOLTIP;
                break;
            case 'alert':
                color = config.SCRIPT_COLOR_ALERT;
                break;
            default:
                color = config.SCRIPT_COLOR_MAIN;
        }

        return createStyledSpan({ color }, text);
    }

    /**
     * Insert element before another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Element to insert before
     */
    function insertBefore(newElement, referenceElement) {
        if (!referenceElement?.parentNode) {
            console.warn('[DOM] Cannot insert: reference element has no parent');
            return;
        }

        referenceElement.parentNode.insertBefore(newElement, referenceElement);
    }

    /**
     * Insert element after another element
     * @param {Element} newElement - Element to insert
     * @param {Element} referenceElement - Element to insert after
     */
    function insertAfter(newElement, referenceElement) {
        if (!referenceElement?.parentNode) {
            console.warn('[DOM] Cannot insert: reference element has no parent');
            return;
        }

        referenceElement.parentNode.insertBefore(newElement, referenceElement.nextSibling);
    }

    /**
     * Remove all elements matching selector
     * @param {string} selector - CSS selector
     * @returns {number} Number of elements removed
     */
    function removeElements(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => el.parentNode?.removeChild(el));
        return elements.length;
    }

    /**
     * Get original text from element (strips our injected content)
     * @param {Element} element - Element to get text from
     * @returns {string} Original text content
     */
    function getOriginalText(element) {
        if (!element) return '';

        // Clone element to avoid modifying original
        const clone = element.cloneNode(true);

        // Remove inserted spans/divs (our injected content)
        clone.querySelectorAll('.insertedSpan, .script-injected').forEach(el => el.remove());

        return clone.textContent.trim();
    }

    /**
     * Add CSS to page
     * @param {string} css - CSS rules to add
     * @param {string} id - Optional style element ID (for removal later)
     */
    function addStyles(css, id = '') {
        const style = document.createElement('style');

        if (id) {
            style.id = id;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }

    /**
     * Remove CSS by ID
     * @param {string} id - Style element ID to remove
     */
    function removeStyles(id) {
        const style = document.getElementById(id);
        if (style) {
            style.remove();
        }
    }

    /**
     * Fix tooltip overflow to ensure it stays within viewport
     * @param {Element} tooltipElement - The tooltip popper element
     */
    function fixTooltipOverflow(tooltipElement) {
        // Use double requestAnimationFrame to ensure MUI positioning is complete
        // First frame: MUI does initial positioning
        // Second frame: We check and fix overflow
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!tooltipElement.isConnected) {
                    return; // Tooltip already removed
                }

                const bBox = tooltipElement.getBoundingClientRect();
                const viewportHeight = window.innerHeight;

                // Find the actual tooltip content element (child of popper)
                const tooltipContent = tooltipElement.querySelector('.MuiTooltip-tooltip');

                // Check if tooltip extends beyond viewport
                if (bBox.top < 0 || bBox.bottom > viewportHeight) {
                    // Get current transform
                    const transformString = tooltipElement.style.transform;

                    if (transformString) {
                        // Parse transform3d(x, y, z)
                        const match = transformString.match(REGEX_TRANSFORM3D);

                        if (match) {
                            const x = match[1];
                            const currentY = parseFloat(match[2]);
                            const z = match[3];

                            // Calculate how much to adjust Y
                            let newY;

                            if (bBox.height >= viewportHeight - 20) {
                                // Tooltip is taller than viewport - position at top with small margin
                                newY = 10;

                                // Force max-height on the tooltip content to enable scrolling
                                if (tooltipContent) {
                                    tooltipContent.style.maxHeight = `${viewportHeight - 20}px`;
                                    tooltipContent.style.overflowY = 'auto';
                                }
                            } else if (bBox.top < 0) {
                                // Tooltip extends above viewport - move it down
                                newY = currentY - bBox.top + 10;
                            } else if (bBox.bottom > viewportHeight) {
                                // Tooltip extends below viewport - move it up
                                newY = currentY - (bBox.bottom - viewportHeight) - 10;
                            }

                            if (newY !== undefined) {
                                tooltipElement.style.transform = `translate3d(${x}, ${newY}px, ${z})`;
                            }
                        }
                    }
                }
            });
        });
    }

    var dom = {
        waitForElement,
        waitForElements,
        createStyledDiv,
        createStyledSpan,
        createColoredText,
        insertBefore,
        insertAfter,
        removeElements,
        getOriginalText,
        addStyles,
        removeStyles,
        fixTooltipOverflow
    };

    /**
     * Market Tooltip Prices Feature
     * Adds market prices to item tooltips
     */


    // Compiled regex patterns (created once, reused for performance)
    const REGEX_ENHANCEMENT_LEVEL = /\+(\d+)$/;
    const REGEX_ENHANCEMENT_STRIP = /\s*\+\d+$/;
    const REGEX_AMOUNT = /x([\d,]+)|Amount:\s*([\d,]+)/i;
    const REGEX_COMMA = /,/g;

    /**
     * TooltipPrices class handles injecting market prices into item tooltips
     */
    class TooltipPrices {
        constructor() {
            this.unregisterObserver = null;
            this.isActive = false;
        }

        /**
         * Initialize the tooltip prices feature
         */
        async initialize() {
            // Check if feature is enabled
            if (!config.getSetting('itemTooltip_prices')) {
                return;
            }

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Add CSS to prevent tooltip cutoff
            this.addTooltipStyles();

            // Register with centralized DOM observer
            this.setupObserver();

        }

        /**
         * Add CSS styles to prevent tooltip cutoff
         *
         * CRITICAL: CSS alone is not enough! MUI uses JavaScript to position tooltips
         * with transform3d(), which can place them off-screen. We need both:
         * 1. CSS: Enables scrolling when tooltip is taller than viewport
         * 2. JavaScript: Repositions tooltip when it extends beyond viewport (see fixTooltipOverflow)
         */
        addTooltipStyles() {
            // Check if styles already exist (might be added by tooltip-consumables)
            if (document.getElementById('mwi-tooltip-fixes')) {
                return; // Already added
            }

            const css = `
            /* Ensure tooltip content is scrollable if too tall */
            .MuiTooltip-tooltip {
                max-height: calc(100vh - 20px) !important;
                overflow-y: auto !important;
            }

            /* Also target the popper container */
            .MuiTooltip-popper {
                max-height: 100vh !important;
            }

            /* Add subtle scrollbar styling */
            .MuiTooltip-tooltip::-webkit-scrollbar {
                width: 6px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
        `;

            dom.addStyles(css, 'mwi-tooltip-fixes');
        }

        /**
         * Set up observer to watch for tooltip elements
         */
        setupObserver() {
            // Register with centralized DOM observer to watch for tooltip poppers
            this.unregisterObserver = domObserver.onClass(
                'TooltipPrices',
                'MuiTooltip-popper',
                (tooltipElement) => {
                    this.handleTooltip(tooltipElement);
                }
            );

            this.isActive = true;
        }

        /**
         * Handle a tooltip element
         * @param {Element} tooltipElement - The tooltip popper element
         */
        async handleTooltip(tooltipElement) {
            // Check if it's an item tooltip (has the specific class)
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');

            if (!nameElement) {
                return; // Not an item tooltip
            }

            // Get the item HRID from the tooltip
            const itemHrid = this.extractItemHrid(tooltipElement);

            if (!itemHrid) {
                return;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!itemDetails) {
                return;
            }

            // Check if this is an openable container first (they have no market price)
            if (itemDetails.isOpenable && config.getSetting('itemTooltip_expectedValue')) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData) {
                    this.injectExpectedValueDisplay(tooltipElement, evData);
                }
                return; // Skip price/profit display for containers
            }

            // Get market price (for base item, enhancement level 0)
            const price = marketAPI.getPrice(itemHrid, 0);

            // Inject price display only if we have market data
            if (price && (price.ask > 0 || price.bid > 0)) {
                // Get item amount from tooltip (for stacks)
                const amount = this.extractItemAmount(tooltipElement);
                this.injectPriceDisplay(tooltipElement, price, amount);
            }

            // Check if profit calculator is enabled
            // Run even without market data - profit calc will handle incomplete data
            if (config.getSetting('itemTooltip_profit')) {
                // Calculate and inject profit information
                const profitData = await profitCalculator.calculateProfit(itemHrid);
                if (profitData) {
                    this.injectProfitDisplay(tooltipElement, profitData);
                }
            }

            // Check for enhancement level in item name (e.g., "+8" in "Cheese Sword +8")
            // Works even without market data
            const enhancementLevel = this.extractEnhancementLevel(tooltipElement);
            if (enhancementLevel > 0) {
                // Get enhancement configuration
                const enhancementConfig = getEnhancingParams();
                if (enhancementConfig) {
                    // Calculate optimal enhancement path
                    const enhancementData = calculateEnhancementPath(
                        itemHrid,
                        enhancementLevel,
                        enhancementConfig
                    );

                    if (enhancementData) {
                        // Inject enhancement analysis into tooltip
                        this.injectEnhancementDisplay(tooltipElement, enhancementData);
                    }
                }
            }

            // Fix tooltip overflow (ensure it stays in viewport)
            dom.fixTooltipOverflow(tooltipElement);
        }

        /**
         * Extract enhancement level from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {number} Enhancement level (0 if not enhanced)
         */
        extractEnhancementLevel(tooltipElement) {
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return 0;
            }

            const itemName = nameElement.textContent.trim();

            // Match "+X" at end of name
            const match = itemName.match(REGEX_ENHANCEMENT_LEVEL);
            if (match) {
                return parseInt(match[1], 10);
            }

            return 0;
        }

        /**
         * Inject enhancement display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} enhancementData - Enhancement analysis data
         */
        injectEnhancementDisplay(tooltipElement, enhancementData) {
            // Find the tooltip text container
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            // Check if we already injected (prevent duplicates)
            if (tooltipText.querySelector('.market-enhancement-injected')) {
                return;
            }

            // Create enhancement display container
            const enhancementDiv = dom.createStyledDiv(
                { color: config.SCRIPT_COLOR_TOOLTIP },
                '',
                'market-enhancement-injected'
            );

            // Build HTML using the tooltip-enhancement module
            enhancementDiv.innerHTML = buildEnhancementTooltipHTML(enhancementData);

            // Insert at the end of the tooltip
            tooltipText.appendChild(enhancementDiv);
        }

        /**
         * Extract item HRID from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {string|null} Item HRID or null
         */
        extractItemHrid(tooltipElement) {
            // Try to find the item HRID from the tooltip's data attributes or content
            // The game uses React, so we need to find the HRID from the displayed name

            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return null;
            }

            let itemName = nameElement.textContent.trim();

            // Strip enhancement level (e.g., "+10" from "Griffin Bulwark +10")
            // This is critical - enhanced items need to lookup the base item
            itemName = itemName.replace(REGEX_ENHANCEMENT_STRIP, '');

            // Look up item by name in game data
            const initData = dataManager.getInitClientData();
            if (!initData) {
                return null;
            }

            // Search through all items to find matching name
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                if (item.name === itemName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Extract item amount from tooltip (for stacks)
         * @param {Element} tooltipElement - Tooltip element
         * @returns {number} Item amount (default 1)
         */
        extractItemAmount(tooltipElement) {
            // Look for amount text in tooltip (e.g., "x5", "Amount: 5", "Amount: 4,900")
            const text = tooltipElement.textContent;
            const match = text.match(REGEX_AMOUNT);

            if (match) {
                // Strip commas before parsing
                const amountStr = (match[1] || match[2]).replace(REGEX_COMMA, '');
                return parseInt(amountStr, 10);
            }

            return 1; // Default to 1 if not found
        }

        /**
         * Inject price display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} price - { ask, bid }
         * @param {number} amount - Item amount
         */
        injectPriceDisplay(tooltipElement, price, amount) {
            // Find the tooltip text container
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                console.warn('[TooltipPrices] Could not find tooltip text container');
                return;
            }

            // Check if we already injected (prevent duplicates)
            if (tooltipText.querySelector('.market-price-injected')) {
                return;
            }

            // Create price display
            const priceDiv = dom.createStyledDiv(
                { color: config.SCRIPT_COLOR_TOOLTIP },
                '',
                'market-price-injected'
            );

            // Show message if no market data at all
            if (price.ask <= 0 && price.bid <= 0) {
                priceDiv.innerHTML = `Price: <span style="color: gray; font-style: italic;">No market data</span>`;
                tooltipText.appendChild(priceDiv);
                return;
            }

            // Format prices, using "-" for missing values
            const askDisplay = price.ask > 0 ? numberFormatter(price.ask) : '-';
            const bidDisplay = price.bid > 0 ? numberFormatter(price.bid) : '-';

            // Calculate totals (only if both prices valid and amount > 1)
            let totalDisplay = '';
            if (amount > 1 && price.ask > 0 && price.bid > 0) {
                const totalAsk = price.ask * amount;
                const totalBid = price.bid * amount;
                totalDisplay = ` (${numberFormatter(totalAsk)} / ${numberFormatter(totalBid)})`;
            }

            // Format: "Price: 1,200 / 950" or "Price: 1,200 / -" or "Price: - / 950"
            priceDiv.innerHTML = `Price: ${askDisplay} / ${bidDisplay}${totalDisplay}`;

            // Insert at the end of the tooltip
            tooltipText.appendChild(priceDiv);
        }

        /**
         * Inject profit display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} profitData - Profit calculation data
         */
        injectProfitDisplay(tooltipElement, profitData) {
            // Find the tooltip text container
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            // Check if we already injected (prevent duplicates)
            if (tooltipText.querySelector('.market-profit-injected')) {
                return;
            }

            // Create profit display container
            const profitDiv = dom.createStyledDiv(
                { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
                '',
                'market-profit-injected'
            );

            // Build simplified profit display - only show net profit/hr and profit/day
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
                // Market data available - show profit
                html += '<div style="font-weight: bold; margin-bottom: 4px;">PROFIT</div>';
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                const profitPerDay = profitData.profitPerHour * 24;
                const profitColor = profitData.profitPerHour >= 0 ? '#059669' : '#f87171'; // darker emerald if positive, red if negative

                html += `<div style="color: ${profitColor}; font-weight: bold;">Net: ${numberFormatter(profitData.profitPerHour)}/hr (${formatKMB(profitPerDay)}/day)</div>`;
            } else {
                // No market data - show cost
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                const teaCostPerItem = profitData.totalTeaCostPerHour / profitData.itemsPerHour;
                const productionCost = profitData.totalMaterialCost + teaCostPerItem;

                html += `<div style="font-weight: bold; color: #60a5fa;">Cost: ${numberFormatter(productionCost)}/item</div>`;
                html += `<div style="color: #999; font-style: italic; margin-top: 4px;">No market data available</div>`;
            }

            html += '</div>';
            html += '</div>';

            profitDiv.innerHTML = html;
            tooltipText.appendChild(profitDiv);
        }


        /**
         * Inject expected value display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} evData - Expected value calculation data
         */
        injectExpectedValueDisplay(tooltipElement, evData) {
            // Find the tooltip text container
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            // Check if we already injected (prevent duplicates)
            if (tooltipText.querySelector('.market-ev-injected')) {
                return;
            }

            // Create EV display container
            const evDiv = dom.createStyledDiv(
                { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
                '',
                'market-ev-injected'
            );

            // Build EV display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            // Header
            html += '<div style="font-weight: bold; margin-bottom: 4px;">EXPECTED VALUE</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // Expected value (simple display)
            html += `<div style="color: lime; font-weight: bold;">Expected Return: ${numberFormatter(evData.expectedValue)}</div>`;

            html += '</div>'; // Close summary section

            // Drop breakdown (if configured to show)
            const showDropsSetting = config.getSettingValue('expectedValue_showDrops', 'All');

            if (showDropsSetting !== 'None' && evData.drops.length > 0) {
                html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>';

                // Determine how many drops to show
                let dropsToShow = evData.drops;
                let headerLabel = 'All Drops';

                if (showDropsSetting === 'Top 5') {
                    dropsToShow = evData.drops.slice(0, 5);
                    headerLabel = 'Top 5 Drops';
                } else if (showDropsSetting === 'Top 10') {
                    dropsToShow = evData.drops.slice(0, 10);
                    headerLabel = 'Top 10 Drops';
                }

                html += `<div style="font-weight: bold; margin-bottom: 4px;">${headerLabel} (${evData.drops.length} total):</div>`;
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                // List each drop
                for (const drop of dropsToShow) {
                    if (!drop.hasPriceData) {
                        // Show item without price data in gray
                        html += `<div style="color: #aaa;">• ${drop.itemName} (${(drop.dropRate * 100).toFixed(2)}%): ${drop.avgCount.toFixed(2)} avg → No price data</div>`;
                    } else {
                        // Format drop rate percentage
                        const dropRatePercent = (drop.dropRate * 100).toFixed(2);

                        // Show full drop breakdown
                        html += `<div>• ${drop.itemName} (${dropRatePercent}%): ${drop.avgCount.toFixed(2)} avg → ${numberFormatter(drop.expectedValue)}</div>`;
                    }
                }

                html += '</div>'; // Close drops list

                // Show total
                html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 4px 0;"></div>';
                html += `<div style="font-size: 0.9em; margin-left: 8px; font-weight: bold;">Total from ${evData.drops.length} drops: ${numberFormatter(evData.expectedValue)}</div>`;
            }

            html += '</div>'; // Close main container

            evDiv.innerHTML = html;

            // Insert at the end of the tooltip
            tooltipText.appendChild(evDiv);
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const tooltipPrices = new TooltipPrices();

    /**
     * Consumable Tooltips Feature
     * Adds HP/MP restoration stats to food/drink tooltips
     */


    /**
     * TooltipConsumables class handles injecting consumable stats into item tooltips
     */
    class TooltipConsumables {
        constructor() {
            this.unregisterObserver = null;
            this.isActive = false;
        }

        /**
         * Initialize the consumable tooltips feature
         */
        async initialize() {
            // Check if feature is enabled
            if (!config.getSetting('showConsumTips')) {
                return;
            }

            // Wait for market data to load (needed for cost calculations)
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true);
            }

            // Add CSS to prevent tooltip cutoff (if not already added)
            this.addTooltipStyles();

            // Register with centralized DOM observer
            this.setupObserver();

        }

        /**
         * Add CSS styles to prevent tooltip cutoff
         *
         * CRITICAL: CSS alone is not enough! MUI uses JavaScript to position tooltips
         * with transform3d(), which can place them off-screen. We need both:
         * 1. CSS: Enables scrolling when tooltip is taller than viewport
         * 2. JavaScript: Repositions tooltip when it extends beyond viewport (see fixTooltipOverflow)
         */
        addTooltipStyles() {
            // Check if styles already exist (might be added by tooltip-prices)
            if (document.getElementById('mwi-tooltip-fixes')) {
                return; // Already added
            }

            const css = `
            /* Ensure tooltip content is scrollable if too tall */
            .MuiTooltip-tooltip {
                max-height: calc(100vh - 20px) !important;
                overflow-y: auto !important;
            }

            /* Also target the popper container */
            .MuiTooltip-popper {
                max-height: 100vh !important;
            }

            /* Add subtle scrollbar styling */
            .MuiTooltip-tooltip::-webkit-scrollbar {
                width: 6px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
        `;

            dom.addStyles(css, 'mwi-tooltip-fixes');
        }

        /**
         * Set up observer to watch for tooltip elements
         */
        setupObserver() {
            // Register with centralized DOM observer to watch for tooltip poppers
            this.unregisterObserver = domObserver.onClass(
                'TooltipConsumables',
                'MuiTooltip-popper',
                (tooltipElement) => {
                    this.handleTooltip(tooltipElement);
                }
            );

            this.isActive = true;
        }

        /**
         * Handle a tooltip element
         * @param {Element} tooltipElement - The tooltip popper element
         */
        async handleTooltip(tooltipElement) {
            // Check if it's an item tooltip
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');

            if (!nameElement) {
                return; // Not an item tooltip
            }

            // Get the item HRID from the tooltip
            const itemHrid = this.extractItemHrid(tooltipElement);

            if (!itemHrid) {
                return;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!itemDetails || !itemDetails.consumableDetail) {
                return; // Not a consumable
            }

            // Calculate consumable stats
            const consumableStats = this.calculateConsumableStats(itemHrid, itemDetails);

            if (!consumableStats) {
                return; // No stats to show
            }

            // Inject consumable display
            this.injectConsumableDisplay(tooltipElement, consumableStats);

            // Fix tooltip overflow (ensure it stays in viewport)
            dom.fixTooltipOverflow(tooltipElement);
        }

        /**
         * Extract item HRID from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {string|null} Item HRID or null
         */
        extractItemHrid(tooltipElement) {
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return null;
            }

            const itemName = nameElement.textContent.trim();

            // Look up item by name in game data
            const initData = dataManager.getInitClientData();
            if (!initData) {
                return null;
            }

            // Search through all items to find matching name
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                if (item.name === itemName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Calculate consumable stats
         * @param {string} itemHrid - Item HRID
         * @param {Object} itemDetails - Item details from game data
         * @returns {Object|null} Consumable stats or null
         */
        calculateConsumableStats(itemHrid, itemDetails) {
            const consumable = itemDetails.consumableDetail;

            if (!consumable) {
                return null;
            }

            // Get the restoration type and amount
            let restoreType = null;
            let restoreAmount = 0;

            // Check for HP restoration
            if (consumable.hitpointRestore) {
                restoreType = 'HP';
                restoreAmount = consumable.hitpointRestore;
            }
            // Check for MP restoration
            else if (consumable.manapointRestore) {
                restoreType = 'MP';
                restoreAmount = consumable.manapointRestore;
            }

            if (!restoreType || restoreAmount === 0) {
                return null; // No restoration stats
            }

            // Track BOTH durations separately
            const recoveryDuration = consumable.recoveryDuration ? consumable.recoveryDuration / 1e9 : 0;
            const cooldownDuration = consumable.cooldownDuration ? consumable.cooldownDuration / 1e9 : 0;

            // Restore per second (for over-time items)
            const restorePerSecond = recoveryDuration > 0 ? restoreAmount / recoveryDuration : 0;

            // Get market price for cost calculations
            const price = marketAPI.getPrice(itemHrid, 0);
            const askPrice = price?.ask || 0;

            // Cost per HP or MP
            const costPerPoint = askPrice > 0 ? askPrice / restoreAmount : 0;

            // Daily max based on COOLDOWN, not recovery duration
            const usesPerDay = cooldownDuration > 0 ? (24 * 60 * 60) / cooldownDuration : 0;
            const dailyMax = restoreAmount * usesPerDay;

            return {
                restoreType,
                restoreAmount,
                restorePerSecond,
                recoveryDuration,  // How long healing takes
                cooldownDuration,  // How often you can use it
                askPrice,
                costPerPoint,
                dailyMax,
                usesPerDay
            };
        }

        /**
         * Inject consumable display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} stats - Consumable stats
         */
        injectConsumableDisplay(tooltipElement, stats) {
            // Find the tooltip text container
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            // Check if we already injected (prevent duplicates)
            if (tooltipText.querySelector('.consumable-stats-injected')) {
                return;
            }

            // Create consumable display container
            const consumableDiv = dom.createStyledDiv(
                { color: config.SCRIPT_COLOR_TOOLTIP, marginTop: '8px' },
                '',
                'consumable-stats-injected'
            );

            // Build consumable display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            // CONSUMABLE STATS section
            html += '<div style="font-weight: bold; margin-bottom: 4px;">CONSUMABLE STATS</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // Restores line
            if (stats.recoveryDuration > 0) {
                html += `<div>Restores: ${numberFormatter(stats.restorePerSecond, 1)} ${stats.restoreType}/s</div>`;
            } else {
                html += `<div>Restores: ${numberFormatter(stats.restoreAmount)} ${stats.restoreType} (instant)</div>`;
            }

            // Cost efficiency line
            if (stats.costPerPoint > 0) {
                html += `<div>Cost: ${numberFormatter(stats.costPerPoint, 1)} per ${stats.restoreType}</div>`;
            } else if (stats.askPrice === 0) {
                html += `<div style="color: gray; font-style: italic;">Cost: No market data</div>`;
            }

            // Daily maximum line - ALWAYS show (based on cooldown)
            if (stats.dailyMax > 0) {
                html += `<div>Daily Max: ${numberFormatter(stats.dailyMax)} ${stats.restoreType}</div>`;
            }

            // Recovery duration line - ONLY for over-time items
            if (stats.recoveryDuration > 0) {
                html += `<div>Recovery Time: ${stats.recoveryDuration}s</div>`;
            }

            // Cooldown line - ALWAYS show
            if (stats.cooldownDuration > 0) {
                html += `<div>Cooldown: ${stats.cooldownDuration}s (${numberFormatter(stats.usesPerDay)} uses/day)</div>`;
            }

            html += '</div>';
            html += '</div>';

            consumableDiv.innerHTML = html;

            // Insert at the end of the tooltip
            tooltipText.appendChild(consumableDiv);
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const tooltipConsumables = new TooltipConsumables();

    /**
     * Market Filter
     * Adds filter dropdowns to marketplace to filter by level, class (skill requirement), and equipment slot
     */


    class MarketFilter {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];

            // Filter state
            this.minLevel = 1;
            this.maxLevel = 1000;
            this.skillRequirement = 'all';
            this.equipmentSlot = 'all';

            // Filter container reference
            this.filterContainer = null;
        }

        /**
         * Initialize market filter
         */
        initialize() {
            if (!config.getSetting('marketFilter')) {
                return;
            }

            // Register DOM observer for marketplace panel
            this.registerDOMObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers for marketplace panel
         */
        registerDOMObservers() {
            // Watch for marketplace panel appearing
            const unregister = domObserver.onClass(
                'market-filter-container',
                'MarketplacePanel_itemFilterContainer',
                (filterContainer) => {
                    this.injectFilterUI(filterContainer);
                }
            );

            this.unregisterHandlers.push(unregister);

            // Watch for market items appearing/updating
            const unregisterItems = domObserver.onClass(
                'market-filter-items',
                'MarketplacePanel_marketItems',
                (marketItemsContainer) => {
                    this.applyFilters();
                }
            );

            this.unregisterHandlers.push(unregisterItems);

            // Also check immediately in case marketplace is already open
            const existingFilterContainer = document.querySelector('div[class*="MarketplacePanel_itemFilterContainer"]');
            if (existingFilterContainer) {
                this.injectFilterUI(existingFilterContainer);
            }
        }

        /**
         * Inject filter UI into marketplace panel
         * @param {HTMLElement} oriFilterContainer - Original filter container
         */
        injectFilterUI(oriFilterContainer) {
            // Check if already injected
            if (document.querySelector('#toolasha-market-filters')) {
                return;
            }

            // Create filter container
            const filterDiv = document.createElement('div');
            filterDiv.id = 'toolasha-market-filters';
            filterDiv.style.cssText = 'display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;';

            // Add level range filters
            filterDiv.appendChild(this.createLevelFilter('min'));
            filterDiv.appendChild(this.createLevelFilter('max'));

            // Add class (skill requirement) filter
            filterDiv.appendChild(this.createClassFilter());

            // Add slot (equipment type) filter
            filterDiv.appendChild(this.createSlotFilter());

            // Insert after the original filter container
            oriFilterContainer.parentElement.insertBefore(filterDiv, oriFilterContainer.nextSibling);

            this.filterContainer = filterDiv;

            // Apply initial filters
            this.applyFilters();
        }

        /**
         * Create level filter dropdown
         * @param {string} type - 'min' or 'max'
         * @returns {HTMLElement} Filter element
         */
        createLevelFilter(type) {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = type === 'min' ? 'Level >= ' : 'Level < ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = `toolasha-level-${type}`;
            select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            // Level options
            const levels = type === 'min'
                ? [1, 10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100]
                : [10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100, 1000];

            levels.forEach(level => {
                const option = document.createElement('option');
                option.value = level;
                option.textContent = level === 1000 ? 'All' : level;
                if ((type === 'min' && level === 1) || (type === 'max' && level === 1000)) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            // Event listener
            select.addEventListener('change', () => {
                if (type === 'min') {
                    this.minLevel = parseInt(select.value);
                } else {
                    this.maxLevel = parseInt(select.value);
                }
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Create class (skill requirement) filter dropdown
         * @returns {HTMLElement} Filter element
         */
        createClassFilter() {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = 'Class: ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = 'toolasha-class-filter';
            select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            const classes = [
                { value: 'all', label: 'All' },
                { value: 'attack', label: 'Attack' },
                { value: 'melee', label: 'Melee' },
                { value: 'defense', label: 'Defense' },
                { value: 'ranged', label: 'Ranged' },
                { value: 'magic', label: 'Magic' },
                { value: 'others', label: 'Others' }
            ];

            classes.forEach(cls => {
                const option = document.createElement('option');
                option.value = cls.value;
                option.textContent = cls.label;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                this.skillRequirement = select.value;
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Create slot (equipment type) filter dropdown
         * @returns {HTMLElement} Filter element
         */
        createSlotFilter() {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = 'Slot: ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = 'toolasha-slot-filter';
            select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            const slots = [
                { value: 'all', label: 'All' },
                { value: 'main_hand', label: 'Main Hand' },
                { value: 'off_hand', label: 'Off Hand' },
                { value: 'two_hand', label: 'Two Hand' },
                { value: 'head', label: 'Head' },
                { value: 'body', label: 'Body' },
                { value: 'hands', label: 'Hands' },
                { value: 'legs', label: 'Legs' },
                { value: 'feet', label: 'Feet' },
                { value: 'neck', label: 'Neck' },
                { value: 'earrings', label: 'Earrings' },
                { value: 'ring', label: 'Ring' },
                { value: 'pouch', label: 'Pouch' },
                { value: 'back', label: 'Back' }
            ];

            slots.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.value;
                option.textContent = slot.label;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                this.equipmentSlot = select.value;
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Apply filters to all market items
         */
        applyFilters() {
            const marketItemsContainer = document.querySelector('div[class*="MarketplacePanel_marketItems"]');
            if (!marketItemsContainer) {
                return;
            }

            // Get game data
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.itemDetailMap) {
                return;
            }

            // Find all item divs
            const itemDivs = marketItemsContainer.querySelectorAll('div[class*="Item_itemContainer"]');

            itemDivs.forEach(itemDiv => {
                // Get item HRID from SVG use element (same as MWI Tools)
                const useElement = itemDiv.querySelector('use');
                if (!useElement) {
                    return;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    return;
                }

                // Extract HRID from href (e.g., #azure_sword -> /items/azure_sword)
                const hrefName = href.split('#')[1];
                if (!hrefName) {
                    return;
                }

                const itemHrid = `/items/${hrefName}`;
                const itemData = gameData.itemDetailMap[itemHrid];

                if (!itemData) {
                    itemDiv.style.display = '';
                    return;
                }

                if (!itemData.equipmentDetail) {
                    // Not equipment, hide if any non-"all" filter is active
                    if (this.minLevel > 1 || this.maxLevel < 1000 || this.skillRequirement !== 'all' || this.equipmentSlot !== 'all') {
                        itemDiv.style.display = 'none';
                    } else {
                        itemDiv.style.display = '';
                    }
                    return;
                }

                // Check if item passes all filters
                const passesFilters = this.checkItemFilters(itemData);
                itemDiv.style.display = passesFilters ? '' : 'none';
            });
        }

        /**
         * Check if item passes all current filters
         * @param {Object} itemData - Item data from game
         * @returns {boolean} True if item should be shown
         */
        checkItemFilters(itemData) {
            const itemLevel = itemData.itemLevel || 0;
            const equipmentDetail = itemData.equipmentDetail;

            // Level filter
            if (itemLevel < this.minLevel || itemLevel >= this.maxLevel) {
                return false;
            }

            // Slot filter
            if (this.equipmentSlot !== 'all') {
                const itemType = equipmentDetail.type || '';
                if (!itemType.includes(this.equipmentSlot)) {
                    return false;
                }
            }

            // Class (skill requirement) filter
            if (this.skillRequirement !== 'all') {
                const levelRequirements = equipmentDetail.levelRequirements || [];

                if (this.skillRequirement === 'others') {
                    // "Others" means non-combat skills
                    const combatSkills = ['attack', 'melee', 'defense', 'ranged', 'magic'];
                    const hasCombatReq = levelRequirements.some(req =>
                        combatSkills.some(skill => req.skillHrid.includes(skill))
                    );
                    if (hasCombatReq) {
                        return false;
                    }
                } else {
                    // Specific skill requirement
                    const hasRequirement = levelRequirements.some(req =>
                        req.skillHrid.includes(this.skillRequirement)
                    );
                    if (!hasRequirement) {
                        return false;
                    }
                }
            }

            return true;
        }

        /**
         * Cleanup on disable
         */
        disable() {
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];

            // Remove filter UI
            if (this.filterContainer) {
                this.filterContainer.remove();
                this.filterContainer = null;
            }

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const marketFilter = new MarketFilter();

    /**
     * Auto-Fill Market Price
     * Automatically fills marketplace order forms with optimal competitive pricing
     */


    class AutoFillPrice {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedModals = new WeakSet(); // Track processed modals to prevent duplicates
        }

        /**
         * Initialize auto-fill price feature
         */
        initialize() {
            if (!config.getSetting('fillMarketOrderPrice')) {
                return;
            }

            // Register DOM observer for marketplace order modals
            this.registerDOMObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers for order modals
         */
        registerDOMObservers() {
            // Watch for order modals appearing
            const unregister = domObserver.onClass(
                'auto-fill-price',
                'Modal_modalContainer',
                (modal) => {
                    // Check if this is a marketplace order modal (not instant buy/sell)
                    const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
                    if (!header) return;

                    const headerText = header.textContent.trim();

                    // Skip instant buy/sell modals (contain "Now" in title)
                    if (headerText.includes(' Now') || headerText.includes('立即')) {
                        return;
                    }

                    // Handle the order modal
                    this.handleOrderModal(modal);
                }
            );

            this.unregisterHandlers.push(unregister);
        }

        /**
         * Handle new order modal
         * @param {HTMLElement} modal - Modal container element
         */
        handleOrderModal(modal) {
            // Prevent duplicate processing (dom-observer can fire multiple times for same modal)
            if (this.processedModals.has(modal)) {
                return;
            }
            this.processedModals.add(modal);

            // Find the "Best Price" button/label
            const bestPriceLabel = modal.querySelector('span[class*="MarketplacePanel_bestPrice"]');
            if (!bestPriceLabel) {
                return;
            }

            // Determine if this is a buy or sell order
            const labelParent = bestPriceLabel.parentElement;
            const labelText = labelParent.textContent.toLowerCase();

            const isBuyOrder = labelText.includes('best buy') || labelText.includes('购买');
            const isSellOrder = labelText.includes('best sell') || labelText.includes('出售');

            if (!isBuyOrder && !isSellOrder) {
                return;
            }

            // Click the best price label to populate the suggested price
            bestPriceLabel.click();

            // Wait a brief moment for the click to take effect, then adjust the price
            setTimeout(() => {
                this.adjustPrice(modal, isBuyOrder);
            }, 50);
        }

        /**
         * Adjust the price to be optimally competitive
         * @param {HTMLElement} modal - Modal container element
         * @param {boolean} isBuyOrder - True if buy order, false if sell order
         */
        adjustPrice(modal, isBuyOrder) {
            // Find the price input container
            const inputContainer = modal.querySelector('div[class*="MarketplacePanel_inputContainer"] div[class*="MarketplacePanel_priceInputs"]');
            if (!inputContainer) {
                return;
            }

            // Find the increment/decrement buttons
            const buttonContainers = inputContainer.querySelectorAll('div[class*="MarketplacePanel_buttonContainer"]');

            if (buttonContainers.length < 3) {
                return;
            }

            // For buy orders: click the 3rd button container's button (increment)
            // For sell orders: click the 2nd button container's button (decrement)
            const targetContainer = isBuyOrder ? buttonContainers[2] : buttonContainers[1];
            const button = targetContainer.querySelector('div button');

            if (button) {
                button.click();
            }
        }

        /**
         * Cleanup on disable
         */
        disable() {
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const autoFillPrice = new AutoFillPrice();

    /**
     * Gathering Profit Calculator
     *
     * Calculates comprehensive profit/hour for gathering actions (Foraging, Woodcutting, Milking) including:
     * - All drop table items at market prices
     * - Drink consumption costs
     * - Equipment speed bonuses
     * - Efficiency buffs (level, house, tea, equipment)
     * - Gourmet tea bonus items (production skills only)
     * - Market tax (2%)
     */


    /**
     * Action types for gathering skills (3 skills)
     */
    const GATHERING_TYPES$1 = [
        '/action_types/foraging',
        '/action_types/woodcutting',
        '/action_types/milking'
    ];

    /**
     * Action types for production skills that benefit from Gourmet Tea (5 skills)
     */
    const PRODUCTION_TYPES$2 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring'
    ];

    /**
     * Calculate comprehensive profit for a gathering action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/foraging/asteroid_belt")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateGatheringProfit(actionHrid) {
        // Get action details
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process gathering actions (Foraging, Woodcutting, Milking) with drop tables
        if (!GATHERING_TYPES$1.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.dropTable) {
            return null; // No drop table - nothing to calculate
        }

        // Ensure market data is loaded
        const marketData = await marketAPI.fetch();
        if (!marketData) {
            return null;
        }

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const houseRooms = Array.from(dataManager.getHouseRooms().values());

        // Calculate action time per action (with speed bonuses)
        const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
        const speedBonus = parseEquipmentSpeedBonuses(
            equipment,
            actionDetail.type,
            gameData.itemDetailMap
        );
        // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
        const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus);

        // Calculate actions per hour
        let actionsPerHour = 3600 / actualTimePerActionSec;

        // Get character's actual equipped drink slots for this action type (from WebSocket data)
        const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

        // Get drink concentration from equipment
        const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

        // Parse tea buffs
        const teaEfficiency = parseTeaEfficiency(
            actionDetail.type,
            drinkSlots,
            gameData.itemDetailMap,
            drinkConcentration
        );

        // Gourmet Tea only applies to production skills (Brewing, Cooking, Cheesesmithing, Crafting, Tailoring)
        // NOT gathering skills (Foraging, Woodcutting, Milking)
        const gourmetBonus = PRODUCTION_TYPES$2.includes(actionDetail.type)
            ? parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        const processingBonus = GATHERING_TYPES$1.includes(actionDetail.type)
            ? parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Gathering Quantity: Increases item drop amounts (min/max)
        // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        let totalGathering = 0;
        let gatheringTea = 0;
        let communityGathering = 0;
        let achievementGathering = 0;
        if (GATHERING_TYPES$1.includes(actionDetail.type)) {
            // Parse Gathering Tea bonus
            gatheringTea = parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

            // Get Community Buff level for gathering quantity
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            communityGathering = communityBuffLevel ? 0.2 + ((communityBuffLevel - 1) * 0.005) : 0;

            // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
            const achievementBuffs = dataManager.getAchievementBuffs(actionDetail.type);
            achievementGathering = achievementBuffs.gatheringQuantity || 0;

            // Stack all bonuses additively
            totalGathering = gatheringTea + communityGathering + achievementGathering;
        }

        // Calculate drink consumption costs
        // Drink Concentration increases consumption rate: base 12/hour × (1 + DC%)
        const drinksPerHour = 12 * (1 + drinkConcentration);
        let drinkCostPerHour = 0;
        const drinkCosts = [];
        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) {
                continue;
            }
            const askPrice = marketData[drink.itemHrid]?.[0]?.a || 0;
            const costPerHour = askPrice * drinksPerHour;
            drinkCostPerHour += costPerHour;

            // Store individual drink cost details
            const drinkName = gameData.itemDetailMap[drink.itemHrid]?.name || 'Unknown';
            drinkCosts.push({
                name: drinkName,
                priceEach: askPrice,
                drinksPerHour: drinksPerHour,
                costPerHour: costPerHour
            });
        }

        // Calculate level efficiency bonus
        const requiredLevel = actionDetail.levelRequirement?.level || 1;
        const skillHrid = actionDetail.levelRequirement?.skillHrid;
        let currentLevel = requiredLevel;
        for (const skill of skills) {
            if (skill.skillHrid === skillHrid) {
                currentLevel = skill.level;
                break;
            }
        }
        const levelEfficiency = Math.max(0, currentLevel - requiredLevel);

        // Calculate house efficiency bonus
        let houseEfficiency = 0;
        for (const room of houseRooms) {
            const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionDetail.type]) {
                houseEfficiency += (room.level || 0) * 1.5;
            }
        }

        // Calculate equipment efficiency bonus (uses equipment-parser utility)
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
            equipment,
            actionDetail.type,
            gameData.itemDetailMap
        );

        // Total efficiency (all additive)
        const totalEfficiency = stackAdditive(
            levelEfficiency,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency
        );

        // Calculate efficiency multiplier (matches production profit calculator pattern)
        // Efficiency "repeats the action" - we apply it to item outputs, not action rate
        const efficiencyMultiplier = 1 + (totalEfficiency / 100);

        // Calculate revenue from drop table
        // Processing happens PER ACTION (before efficiency multiplies the count)
        // So we calculate per-action outputs, then multiply by actionsPerHour and efficiency
        let revenuePerHour = 0;
        let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
        const processingConversions = []; // Track conversion details for display
        const baseOutputs = []; // Track base item outputs for display
        const dropTable = actionDetail.dropTable;

        for (const drop of dropTable) {
            const rawBidPrice = marketData[drop.itemHrid]?.[0]?.b || 0;
            const rawPriceAfterTax = rawBidPrice * 0.98;

            // Apply gathering quantity bonus to drop amounts
            const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
            const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

            // Check if this item has a Processing conversion (look up dynamically from crafting recipes)
            // Find a crafting action where this raw item is the input
            const processingActionHrid = Object.keys(gameData.actionDetailMap).find(actionHrid => {
                const action = gameData.actionDetailMap[actionHrid];
                return action.inputItems?.[0]?.itemHrid === drop.itemHrid &&
                       action.outputItems?.[0]?.itemHrid; // Has an output
            });

            const processedItemHrid = processingActionHrid
                ? gameData.actionDetailMap[processingActionHrid].outputItems[0].itemHrid
                : null;

            // Per-action calculations (efficiency will be applied when converting to items per hour)
            let rawPerAction = 0;
            let processedPerAction = 0;

            if (processedItemHrid && processingBonus > 0) {
                // Get conversion ratio from the processing action we already found
                const conversionRatio = gameData.actionDetailMap[processingActionHrid].inputItems[0].count;

                // Processing Tea check happens per action:
                // If procs (processingBonus% chance): Convert to processed + leftover
                const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);
                const rawLeftoverIfProcs = avgAmountPerAction % conversionRatio;

                // If doesn't proc: All stays raw
                const rawIfNoProc = avgAmountPerAction;

                // Expected value per action
                processedPerAction = processingBonus * processedIfProcs;
                rawPerAction = processingBonus * rawLeftoverIfProcs + (1 - processingBonus) * rawIfNoProc;

                // Revenue per hour = per-action × actionsPerHour × efficiency
                const processedBidPrice = marketData[processedItemHrid]?.[0]?.b || 0;
                const processedPriceAfterTax = processedBidPrice * 0.98;

                const rawItemsPerHour = actionsPerHour * drop.dropRate * rawPerAction * efficiencyMultiplier;
                const processedItemsPerHour = actionsPerHour * drop.dropRate * processedPerAction * efficiencyMultiplier;

                revenuePerHour += rawItemsPerHour * rawPriceAfterTax;
                revenuePerHour += processedItemsPerHour * processedPriceAfterTax;

                // Track processing details
                const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
                const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';

                // Value gain per conversion = cheese value - cost of milk used
                const costOfMilkUsed = conversionRatio * rawPriceAfterTax;
                const valueGainPerConversion = processedPriceAfterTax - costOfMilkUsed;
                const revenueFromConversion = processedItemsPerHour * valueGainPerConversion;

                processingRevenueBonus += revenueFromConversion;
                processingConversions.push({
                    rawItem: rawItemName,
                    processedItem: processedItemName,
                    valueGain: valueGainPerConversion,
                    conversionsPerHour: processedItemsPerHour,
                    revenuePerHour: revenueFromConversion
                });

                // Store outputs (show both raw and processed)
                baseOutputs.push({
                    name: rawItemName,
                    itemsPerHour: rawItemsPerHour,
                    dropRate: drop.dropRate,
                    priceEach: rawPriceAfterTax,
                    revenuePerHour: rawItemsPerHour * rawPriceAfterTax
                });

                baseOutputs.push({
                    name: processedItemName,
                    itemsPerHour: processedItemsPerHour,
                    dropRate: drop.dropRate * processingBonus,
                    priceEach: processedPriceAfterTax,
                    revenuePerHour: processedItemsPerHour * processedPriceAfterTax,
                    isProcessed: true, // Flag to show processing percentage
                    processingChance: processingBonus // Store the processing chance (e.g., 0.15 for 15%)
                });
            } else {
                // No processing - simple calculation
                rawPerAction = avgAmountPerAction;
                const rawItemsPerHour = actionsPerHour * drop.dropRate * rawPerAction * efficiencyMultiplier;
                revenuePerHour += rawItemsPerHour * rawPriceAfterTax;

                const itemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
                baseOutputs.push({
                    name: itemName,
                    itemsPerHour: rawItemsPerHour,
                    dropRate: drop.dropRate,
                    priceEach: rawPriceAfterTax,
                    revenuePerHour: rawItemsPerHour * rawPriceAfterTax
                });
            }

            // Gourmet tea bonus (only for production skills, not gathering)
            if (gourmetBonus > 0) {
                const totalPerAction = rawPerAction + processedPerAction;
                const bonusPerAction = totalPerAction * (gourmetBonus / 100);
                const bonusItemsPerHour = actionsPerHour * drop.dropRate * bonusPerAction * efficiencyMultiplier;

                // Use weighted average price for gourmet bonus
                if (processedItemHrid && processingBonus > 0) {
                    const processedBidPrice = marketData[processedItemHrid]?.[0]?.b || 0;
                    const processedPriceAfterTax = processedBidPrice * 0.98;
                    const weightedPrice = (rawPerAction * rawPriceAfterTax + processedPerAction * processedPriceAfterTax) /
                                         (rawPerAction + processedPerAction);
                    revenuePerHour += bonusItemsPerHour * weightedPrice;
                } else {
                    revenuePerHour += bonusItemsPerHour * rawPriceAfterTax;
                }
            }
        }

        // Calculate bonus revenue from essence and rare find drops
        const bonusRevenue = calculateBonusRevenue(
            actionDetail,
            actionsPerHour,
            equipment,
            gameData.itemDetailMap
        );

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;

        // Add bonus revenue to total revenue
        revenuePerHour += efficiencyBoostedBonusRevenue;

        // Calculate net profit
        const profitPerHour = revenuePerHour - drinkCostPerHour;
        const profitPerDay = profitPerHour * 24;

        return {
            profitPerHour,
            profitPerDay,
            revenuePerHour,
            drinkCostPerHour,
            drinkCosts,                // Array of individual drink costs {name, priceEach, costPerHour}
            actionsPerHour,            // Base actions per hour (without efficiency)
            baseOutputs,               // Array of base item outputs {name, itemsPerHour, dropRate, priceEach, revenuePerHour}
            totalEfficiency,           // Total efficiency percentage
            efficiencyMultiplier,      // Efficiency as multiplier (1 + totalEfficiency / 100)
            speedBonus,
            bonusRevenue,              // Essence and rare find details
            processingBonus,           // Processing Tea chance (as decimal)
            processingRevenueBonus,    // Extra revenue from Processing conversions
            processingConversions,     // Array of conversion details {rawItem, processedItem, valueGain}
            totalGathering,            // Total gathering quantity bonus (as decimal)
            gatheringTea,              // Gathering Tea component (as decimal)
            communityGathering,        // Community Buff component (as decimal)
            achievementGathering,      // Achievement Tier component (as decimal)
            details: {
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                gourmetBonus
            }
        };
    }

    /**
     * Production Profit Calculator
     *
     * Calculates comprehensive profit/hour for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     * Reuses existing profit calculator from tooltip system.
     */


    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES$1 = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring'
    ];

    /**
     * Calculate comprehensive profit for a production action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/brewing/efficiency_tea")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateProductionProfit(actionHrid) {

        // Get action details
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process production actions with outputs
        if (!PRODUCTION_TYPES$1.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.outputItems || actionDetail.outputItems.length === 0) {
            return null; // No output - nothing to calculate
        }

        // Ensure market data is loaded
        if (!marketAPI.isLoaded()) {
            const marketData = await marketAPI.fetch();
            if (!marketData) {
                return null;
            }
        }

        // Get output item HRID
        const outputItemHrid = actionDetail.outputItems[0].itemHrid;

        // Reuse existing profit calculator (does all the heavy lifting)
        const profitData = await profitCalculator.calculateProfit(outputItemHrid);

        if (!profitData) {
            return null;
        }

        return profitData;
    }

    /**
     * Enhancement Display
     *
     * Displays enhancement calculations in the enhancement action panel.
     * Shows expected attempts, time, and protection items needed.
     */


    /**
     * Format a number with thousands separator and 2 decimal places
     * @param {number} num - Number to format
     * @returns {string} Formatted number (e.g., "1,234.56")
     */
    function formatAttempts(num) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(num);
    }

    /**
     * Get protection item HRID from the Protection slot in the UI
     * @param {HTMLElement} panel - Enhancement action panel element
     * @returns {string|null} Protection item HRID or null if none equipped
     */
    function getProtectionItemFromUI(panel) {
        try {
            // Find the protection item container using the specific class
            const protectionContainer = panel.querySelector('[class*="protectionItemInputContainer"]');

            if (!protectionContainer) {
                return null;
            }

            // Look for SVG sprites with items_sprite pattern
            // Protection items are rendered as: <use href="/static/media/items_sprite.{hash}.svg#item_name"></use>
            const useElements = protectionContainer.querySelectorAll('use[href*="items_sprite"]');

            if (useElements.length === 0) {
                // No protection item equipped
                return null;
            }

            // Extract item HRID from the sprite reference
            const useElement = useElements[0];
            const href = useElement.getAttribute('href');

            // Extract item name after the # (fragment identifier)
            // Format: /static/media/items_sprite.{hash}.svg#mirror_of_protection
            const match = href.match(/#(.+)$/);

            if (match) {
                const itemName = match[1];
                const hrid = `/items/${itemName}`;
                return hrid;
            }

            return null;
        } catch (error) {
            console.error('[MWI Tools] Error detecting protection item:', error);
            return null;
        }
    }

    /**
     * Calculate and display enhancement statistics in the panel
     * @param {HTMLElement} panel - Enhancement action panel element
     * @param {string} itemHrid - Item HRID (e.g., "/items/cheese_sword")
     */
    async function displayEnhancementStats(panel, itemHrid) {
        try {
            // Check if feature is enabled
            if (!config.getSetting('enhanceSim')) {
                // Remove existing calculator if present
                const existing = panel.querySelector('#mwi-enhancement-stats');
                if (existing) {
                    existing.remove();
                }
                return;
            }

            // Get game data
            const gameData = dataManager.getInitClientData();

            // Get item details directly (itemHrid is passed from panel observer)
            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails) {
                return;
            }

            const itemLevel = itemDetails.itemLevel || 1;

            // Get auto-detected enhancing parameters
            const params = getEnhancingParams();

            // Read Protect From Level from UI
            const protectFromLevel = getProtectFromLevelFromUI(panel);

            // Minimum protection level is 2 (dropping from +2 to +1)
            // Protection at +1 is meaningless (would drop to +0 anyway)
            const effectiveProtectFrom = protectFromLevel < 2 ? 0 : protectFromLevel;

            // Detect protection item once (avoid repeated DOM queries)
            const protectionItemHrid = getProtectionItemFromUI(panel);

            // Check for Philosopher's Mirror - calculator doesn't apply (100% success, different cost model)
            if (protectionItemHrid === '/items/philosophers_mirror') {
                // Remove existing calculator if present
                const existing = panel.querySelector('#mwi-enhancement-stats');
                if (existing) {
                    existing.remove();
                }
                return; // Exit - Philosopher's Mirror uses different mechanics
            }

            // Calculate per-action time (simple calculation, no Markov chain needed)
            const perActionTime = calculatePerActionTime(
                params.enhancingLevel,
                itemLevel,
                params.speedBonus
            );

            // Format and inject display
            const html = formatEnhancementDisplay(panel, params, perActionTime, itemDetails, effectiveProtectFrom, itemDetails.enhancementCosts || [], protectionItemHrid);
            injectDisplay(panel, html);
        } catch (error) {
            console.error('[MWI Tools] ❌ Error displaying enhancement stats:', error);
            console.error('[MWI Tools] Error stack:', error.stack);
        }
    }

    /**
     * Generate costs by level table HTML for all 20 enhancement levels
     * @param {HTMLElement} panel - Enhancement action panel element
     * @param {Object} params - Enhancement parameters
     * @param {number} itemLevel - Item level being enhanced
     * @param {number} protectFromLevel - Protection level from UI
     * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
     * @param {string|null} protectionItemHrid - Protection item HRID (cached, avoid repeated DOM queries)
     * @returns {string} HTML string
     */
    function generateCostsByLevelTable(panel, params, itemLevel, protectFromLevel, enhancementCosts, protectionItemHrid) {
        const lines = [];
        const gameData = dataManager.getInitClientData();

        lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
        lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Costs by Enhancement Level:</div>');

        // Calculate costs for each level
        const costData = [];
        for (let level = 1; level <= 20; level++) {
            // Protection only applies when target level reaches the protection threshold
            const effectiveProtect = (protectFromLevel >= 2 && level >= protectFromLevel) ? protectFromLevel : 0;

            const calc = calculateEnhancement({
                enhancingLevel: params.enhancingLevel,
                houseLevel: params.houseLevel,
                toolBonus: params.toolBonus,
                speedBonus: params.speedBonus,
                itemLevel: itemLevel,
                targetLevel: level,
                protectFrom: effectiveProtect,
                blessedTea: params.teas.blessed,
                guzzlingBonus: params.guzzlingBonus
            });

            // Calculate material cost breakdown
            let materialCost = 0;
            const materialBreakdown = {};

            if (enhancementCosts && enhancementCosts.length > 0) {
                enhancementCosts.forEach(cost => {
                    const itemDetail = gameData.itemDetailMap[cost.itemHrid];
                    let itemPrice = 0;

                    if (cost.itemHrid === '/items/coin') {
                        itemPrice = 1;
                    } else {
                        const marketData = marketAPI.getPrice(cost.itemHrid, 0);
                        if (marketData && marketData.ask) {
                            itemPrice = marketData.ask;
                        } else {
                            itemPrice = itemDetail?.sellPrice || 0;
                        }
                    }

                    const quantity = cost.count * calc.attempts;  // Use exact decimal attempts
                    const itemCost = quantity * itemPrice;
                    materialCost += itemCost;

                    // Store breakdown by item name with quantity and unit price
                    const itemName = itemDetail?.name || cost.itemHrid;
                    materialBreakdown[itemName] = {
                        cost: itemCost,
                        quantity: quantity,
                        unitPrice: itemPrice
                    };
                });
            }

            // Add protection item cost
            let protectionCost = 0;
            if (calc.protectionCount > 0) {
                if (protectionItemHrid) {
                    const protectionItemDetail = gameData.itemDetailMap[protectionItemHrid];
                    let protectionPrice = 0;

                    const protectionMarketData = marketAPI.getPrice(protectionItemHrid, 0);
                    if (protectionMarketData && protectionMarketData.ask) {
                        protectionPrice = protectionMarketData.ask;
                    } else {
                        protectionPrice = protectionItemDetail?.sellPrice || 0;
                    }

                    protectionCost = calc.protectionCount * protectionPrice;
                    const protectionName = protectionItemDetail?.name || protectionItemHrid;
                    materialBreakdown[protectionName] = {
                        cost: protectionCost,
                        quantity: calc.protectionCount,
                        unitPrice: protectionPrice
                    };
                }
            }

            const totalCost = materialCost + protectionCost;

            costData.push({
                level,
                attempts: calc.attempts,  // Use exact decimal attempts
                protection: calc.protectionCount,
                time: calc.totalTime,
                cost: totalCost,
                breakdown: materialBreakdown
            });
        }

        // Create scrollable table
        lines.push('<div style="max-height: 300px; overflow-y: auto;">');
        lines.push('<table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">');

        // Get all unique material names
        const allMaterials = new Set();
        costData.forEach(data => {
            Object.keys(data.breakdown).forEach(mat => allMaterials.add(mat));
        });
        const materialNames = Array.from(allMaterials);

        // Header row
        lines.push('<tr style="color: #888; border-bottom: 1px solid #444; position: sticky; top: 0; background: rgba(0,0,0,0.9);">');
        lines.push('<th style="text-align: left; padding: 4px;">Level</th>');
        lines.push('<th style="text-align: right; padding: 4px;">Attempts</th>');
        lines.push('<th style="text-align: right; padding: 4px;">Protection</th>');

        // Add material columns
        materialNames.forEach(matName => {
            lines.push(`<th style="text-align: right; padding: 4px;">${matName}</th>`);
        });

        lines.push('<th style="text-align: right; padding: 4px;">Time</th>');
        lines.push('<th style="text-align: right; padding: 4px;">Total Cost</th>');
        lines.push('</tr>');

        costData.forEach((data, index) => {
            const isLastRow = index === costData.length - 1;
            const borderStyle = isLastRow ? '' : 'border-bottom: 1px solid #333;';

            lines.push(`<tr style="${borderStyle}">`);
            lines.push(`<td style="padding: 6px 4px; color: #fff; font-weight: bold;">+${data.level}</td>`);
            lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${formatAttempts(data.attempts)}</td>`);
            lines.push(`<td style="padding: 6px 4px; text-align: right; color: ${data.protection > 0 ? '#ffa500' : '#888'};">${data.protection > 0 ? formatAttempts(data.protection) : '-'}</td>`);

            // Add material breakdown columns
            materialNames.forEach(matName => {
                const matData = data.breakdown[matName];
                if (matData && matData.cost > 0) {
                    const cost = Math.round(matData.cost).toLocaleString();
                    const unitPrice = Math.round(matData.unitPrice).toLocaleString();
                    const qty = matData.quantity % 1 === 0 ?
                        Math.round(matData.quantity).toLocaleString() :
                        matData.quantity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    // Format as: quantity × unit price → total cost
                    lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${qty} × ${unitPrice} → ${cost}</td>`);
                } else {
                    lines.push(`<td style="padding: 6px 4px; text-align: right; color: #888;">-</td>`);
                }
            });

            lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ccc;">${timeReadable(data.time)}</td>`);
            lines.push(`<td style="padding: 6px 4px; text-align: right; color: #ffa500;">${Math.round(data.cost).toLocaleString()}</td>`);
            lines.push('</tr>');
        });

        lines.push('</table>');
        lines.push('</div>'); // Close scrollable container
        lines.push('</div>'); // Close section

        return lines.join('');
    }

    /**
     * Get Protect From Level from UI input
     * @param {HTMLElement} panel - Enhancing panel
     * @returns {number} Protect from level (0 = never, 1-20)
     */
    function getProtectFromLevelFromUI(panel) {
        // Find the "Protect From Level" input
        const labels = Array.from(panel.querySelectorAll('*')).filter(el =>
            el.textContent.trim() === 'Protect From Level' && el.children.length === 0
        );

        if (labels.length > 0) {
            const parent = labels[0].parentElement;
            const input = parent.querySelector('input[type="number"], input[type="text"]');
            if (input && input.value) {
                const value = parseInt(input.value, 10);
                return Math.max(0, Math.min(20, value)); // Clamp 0-20
            }
        }

        return 0; // Default to never protect
    }

    /**
     * Format enhancement display HTML
     * @param {HTMLElement} panel - Enhancement action panel element (for reading protection slot)
     * @param {Object} params - Auto-detected parameters
     * @param {number} perActionTime - Per-action time in seconds
     * @param {Object} itemDetails - Item being enhanced
     * @param {number} protectFromLevel - Protection level from UI
     * @param {Array} enhancementCosts - Array of {itemHrid, count} for materials
     * @param {string|null} protectionItemHrid - Protection item HRID (cached, avoid repeated DOM queries)
     * @returns {string} HTML string
     */
    function formatEnhancementDisplay(panel, params, perActionTime, itemDetails, protectFromLevel, enhancementCosts, protectionItemHrid) {
        const lines = [];

        // Header
        lines.push('<div style="margin-top: 15px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em;">');
        lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 10px; font-size: 1.1em;">⚙️ ENHANCEMENT CALCULATOR</div>');

        // Item info
        lines.push(`<div style="color: #ddd; margin-bottom: 12px; font-weight: bold;">${itemDetails.name} <span style="color: #888;">(Item Level ${itemDetails.itemLevel})</span></div>`);

        // Current stats section
        lines.push('<div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 12px;">');
        lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Your Enhancing Stats:</div>');

        // Two column layout for stats
        lines.push('<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.85em;">');

        // Left column
        lines.push('<div>');
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">Level:</span> ${params.enhancingLevel - params.detectedTeaBonus}${params.detectedTeaBonus > 0 ? ` <span style="color: #88ff88;">(+${params.detectedTeaBonus.toFixed(1)} tea)</span>` : ''}</div>`);
        lines.push(`<div style="color: #ccc;"><span style="color: #888;">House:</span> Observatory Lvl ${params.houseLevel}</div>`);

        // Display each equipment slot
        if (params.toolSlot) {
            lines.push(`<div style="color: #ccc;"><span style="color: #888;">Tool:</span> ${params.toolSlot.name}${params.toolSlot.enhancementLevel > 0 ? ` +${params.toolSlot.enhancementLevel}` : ''}</div>`);
        }
        if (params.bodySlot) {
            lines.push(`<div style="color: #ccc;"><span style="color: #888;">Body:</span> ${params.bodySlot.name}${params.bodySlot.enhancementLevel > 0 ? ` +${params.bodySlot.enhancementLevel}` : ''}</div>`);
        }
        if (params.legsSlot) {
            lines.push(`<div style="color: #ccc;"><span style="color: #888;">Legs:</span> ${params.legsSlot.name}${params.legsSlot.enhancementLevel > 0 ? ` +${params.legsSlot.enhancementLevel}` : ''}</div>`);
        }
        if (params.handsSlot) {
            lines.push(`<div style="color: #ccc;"><span style="color: #888;">Hands:</span> ${params.handsSlot.name}${params.handsSlot.enhancementLevel > 0 ? ` +${params.handsSlot.enhancementLevel}` : ''}</div>`);
        }
        lines.push('</div>');

        // Right column
        lines.push('<div>');

        // Calculate total success (includes level advantage if applicable)
        let totalSuccess = params.toolBonus;
        let successLevelAdvantage = 0;
        if (params.enhancingLevel > itemDetails.itemLevel) {
            // For DISPLAY breakdown: show level advantage WITHOUT house (house shown separately)
            // Calculator correctly uses (enhancing + house - item), but we split for display
            successLevelAdvantage = (params.enhancingLevel - itemDetails.itemLevel) * 0.05;
            totalSuccess += successLevelAdvantage;
        }

        if (totalSuccess > 0) {
            lines.push(`<div style="color: #88ff88;"><span style="color: #888;">Success:</span> +${totalSuccess.toFixed(2)}%</div>`);

            // Show breakdown: equipment + house + level advantage
            const equipmentSuccess = params.equipmentSuccessBonus || 0;
            const houseSuccess = params.houseSuccessBonus || 0;

            if (equipmentSuccess > 0) {
                lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentSuccess.toFixed(2)}%</div>`);
            }
            if (houseSuccess > 0) {
                lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${houseSuccess.toFixed(2)}%</div>`);
            }
            if (successLevelAdvantage > 0) {
                lines.push(`<div style="color: #88ff88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${successLevelAdvantage.toFixed(2)}%</div>`);
            }
        }

        // Calculate total speed (includes level advantage if applicable)
        let totalSpeed = params.speedBonus;
        let speedLevelAdvantage = 0;
        if (params.enhancingLevel > itemDetails.itemLevel) {
            speedLevelAdvantage = params.enhancingLevel - itemDetails.itemLevel;
            totalSpeed += speedLevelAdvantage;
        }

        if (totalSpeed > 0) {
            lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +${totalSpeed.toFixed(1)}%</div>`);

            // Show breakdown: equipment + house + community + tea + level advantage
            if (params.equipmentSpeedBonus > 0) {
                lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${params.equipmentSpeedBonus.toFixed(1)}%</div>`);
            }
            if (params.houseSpeedBonus > 0) {
                lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House (Observatory):</span> +${params.houseSpeedBonus.toFixed(1)}%</div>`);
            }
            if (params.communitySpeedBonus > 0) {
                lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community T${params.communityBuffLevel}:</span> +${params.communitySpeedBonus.toFixed(1)}%</div>`);
            }
            if (params.teaSpeedBonus > 0) {
                const teaName = params.teas.ultraEnhancing ? 'Ultra' : params.teas.superEnhancing ? 'Super' : 'Enhancing';
                lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">${teaName} Tea:</span> +${params.teaSpeedBonus.toFixed(1)}%</div>`);
            }
            if (speedLevelAdvantage > 0) {
                lines.push(`<div style="color: #aaddff; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Level advantage:</span> +${speedLevelAdvantage.toFixed(1)}%</div>`);
            }
        } else if (totalSpeed === 0 && speedLevelAdvantage === 0) {
            lines.push(`<div style="color: #88ccff;"><span style="color: #888;">Speed:</span> +0.0%</div>`);
        }

        if (params.teas.blessed) {
            // Calculate Blessed Tea bonus with Guzzling Pouch concentration
            const blessedBonus = 1.1; // Base 1.1% from Blessed Tea
            lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Blessed:</span> +${blessedBonus.toFixed(1)}%</div>`);
        }
        if (params.rareFindBonus > 0) {
            lines.push(`<div style="color: #ffaa55;"><span style="color: #888;">Rare Find:</span> +${params.rareFindBonus.toFixed(1)}%</div>`);

            // Show house room breakdown if available
            if (params.houseRareFindBonus > 0) {
                const equipmentRareFind = params.rareFindBonus - params.houseRareFindBonus;
                if (equipmentRareFind > 0) {
                    lines.push(`<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentRareFind.toFixed(1)}%</div>`);
                }
                lines.push(`<div style="color: #ffaa55; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms:</span> +${params.houseRareFindBonus.toFixed(1)}%</div>`);
            }
        }
        if (params.experienceBonus > 0) {
            lines.push(`<div style="color: #ffdd88;"><span style="color: #888;">Experience:</span> +${params.experienceBonus.toFixed(1)}%</div>`);

            // Show breakdown: equipment + house wisdom + tea wisdom + community wisdom
            const teaWisdom = params.teaWisdomBonus || 0;
            const houseWisdom = params.houseWisdomBonus || 0;
            const communityWisdom = params.communityWisdomBonus || 0;
            const equipmentExperience = params.experienceBonus - houseWisdom - teaWisdom - communityWisdom;

            if (equipmentExperience > 0) {
                lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Equipment:</span> +${equipmentExperience.toFixed(1)}%</div>`);
            }
            if (houseWisdom > 0) {
                lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">House Rooms (Wisdom):</span> +${houseWisdom.toFixed(1)}%</div>`);
            }
            if (communityWisdom > 0) {
                const wisdomLevel = params.communityWisdomLevel || 0;
                lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Community (Wisdom T${wisdomLevel}):</span> +${communityWisdom.toFixed(1)}%</div>`);
            }
            if (teaWisdom > 0) {
                lines.push(`<div style="color: #ffdd88; font-size: 0.8em; padding-left: 10px;"><span style="color: #666;">Wisdom Tea:</span> +${teaWisdom.toFixed(1)}%</div>`);
            }
        }
        lines.push('</div>');

        lines.push('</div>'); // Close grid
        lines.push('</div>'); // Close stats section

        // Costs by level table for all 20 levels
        const costsByLevelHTML = generateCostsByLevelTable(panel, params, itemDetails.itemLevel, protectFromLevel, enhancementCosts, protectionItemHrid);
        lines.push(costsByLevelHTML);

        // Materials cost section (if enhancement costs exist) - just show per-attempt materials
        if (enhancementCosts && enhancementCosts.length > 0) {
            lines.push('<div style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">');
            lines.push('<div style="color: #ffa500; font-weight: bold; margin-bottom: 6px; font-size: 0.95em;">Materials Per Attempt:</div>');

            // Get game data for item names
            const gameData = dataManager.getInitClientData();

            // Materials per attempt with pricing
            enhancementCosts.forEach(cost => {
                const itemDetail = gameData.itemDetailMap[cost.itemHrid];
                const itemName = itemDetail ? itemDetail.name : cost.itemHrid;

                // Get price
                let itemPrice = 0;
                if (cost.itemHrid === '/items/coin') {
                    itemPrice = 1;
                } else {
                    const marketData = marketAPI.getPrice(cost.itemHrid, 0);
                    if (marketData && marketData.ask) {
                        itemPrice = marketData.ask;
                    } else {
                        itemPrice = itemDetail?.sellPrice || 0;
                    }
                }

                const totalCost = cost.count * itemPrice;
                const formattedCount = Number.isInteger(cost.count) ?
                    cost.count.toLocaleString() :
                    cost.count.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                lines.push(`<div style="font-size: 0.85em; color: #ccc;">${formattedCount}× ${itemName} <span style="color: #888;">(@${itemPrice.toLocaleString()} → ${totalCost.toLocaleString()})</span></div>`);
            });

            // Show protection item cost if protection is active (level 2+) AND item is equipped
            if (protectFromLevel >= 2) {
                if (protectionItemHrid) {
                    const protectionItemDetail = gameData.itemDetailMap[protectionItemHrid];
                    const protectionItemName = protectionItemDetail?.name || protectionItemHrid;

                    // Get protection item price
                    let protectionPrice = 0;
                    const protectionMarketData = marketAPI.getPrice(protectionItemHrid, 0);
                    if (protectionMarketData && protectionMarketData.ask) {
                        protectionPrice = protectionMarketData.ask;
                    } else {
                        protectionPrice = protectionItemDetail?.sellPrice || 0;
                    }

                    lines.push(`<div style="font-size: 0.85em; color: #ffa500; margin-top: 4px;">1× ${protectionItemName} <span style="color: #888;">(if used) (@${protectionPrice.toLocaleString()})</span></div>`);
                }
            }

            lines.push('</div>');
        }

        // Footer notes
        lines.push('<div style="margin-top: 8px; color: #666; font-size: 0.75em; line-height: 1.3;">');

        // Only show protection note if actually using protection
        if (protectFromLevel >= 2) {
            lines.push(`• Protection active from +${protectFromLevel} onwards (enhancement level -1 on failure)<br>`);
        } else {
            lines.push('• No protection used (all failures return to +0)<br>');
        }

        lines.push('• Attempts and time are statistical averages<br>');

        // Calculate total speed for display (includes level advantage if applicable)
        let displaySpeed = params.speedBonus;
        if (params.enhancingLevel > itemDetails.itemLevel) {
            displaySpeed += (params.enhancingLevel - itemDetails.itemLevel);
        }

        lines.push(`• Action time: ${perActionTime.toFixed(2)}s (includes ${displaySpeed.toFixed(1)}% speed bonus)`);
        lines.push('</div>');

        lines.push('</div>'); // Close targets section
        lines.push('</div>'); // Close main container

        return lines.join('');
    }

    /**
     * Find the "Current Action" tab button (cached on panel for performance)
     * @param {HTMLElement} panel - Enhancement panel element
     * @returns {HTMLButtonElement|null} Current Action tab button or null
     */
    function findCurrentActionTab(panel) {
        // Check if we already cached it
        if (panel._cachedCurrentActionTab) {
            return panel._cachedCurrentActionTab;
        }

        // Walk up the DOM to find tab buttons (only once per panel)
        let current = panel;
        let depth = 0;
        const maxDepth = 5;

        while (current && depth < maxDepth) {
            const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
            const currentActionTab = buttons.find(btn => btn.textContent.trim() === 'Current Action');

            if (currentActionTab) {
                // Cache it on the panel for future lookups
                panel._cachedCurrentActionTab = currentActionTab;
                return currentActionTab;
            }

            current = current.parentElement;
            depth++;
        }

        return null;
    }

    /**
     * Inject enhancement display into panel
     * @param {HTMLElement} panel - Action panel element
     * @param {string} html - HTML to inject
     */
    function injectDisplay(panel, html) {
        // CRITICAL: Final safety check - verify we're on Enhance tab before injecting
        // This prevents the calculator from appearing on Current Action tab due to race conditions
        const currentActionTab = findCurrentActionTab(panel);
        if (currentActionTab) {
            // Check if Current Action tab is active
            if (currentActionTab.getAttribute('aria-selected') === 'true' ||
                currentActionTab.classList.contains('Mui-selected') ||
                currentActionTab.getAttribute('tabindex') === '0') {
                // Current Action tab is active, don't inject calculator
                return;
            }
        }

        // Check if we already added display
        const existing = panel.querySelector('#mwi-enhancement-stats');
        if (existing) {
            existing.remove();
        }

        // Create container
        const container = document.createElement('div');
        container.id = 'mwi-enhancement-stats';
        container.innerHTML = html;

        // For enhancing panels: append to the end of the panel
        // For regular action panels: insert after drop table or exp gain
        const dropTable = panel.querySelector('div.SkillActionDetail_dropTable__3ViVp');
        const expGain = panel.querySelector('div.SkillActionDetail_expGain__F5xHu');

        if (dropTable || expGain) {
            // Regular action panel - insert after drop table or exp gain
            const insertAfter = dropTable || expGain;
            insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);
        } else {
            // Enhancing panel - append to end
            panel.appendChild(container);
        }
    }

    /**
     * Shared UI Components
     *
     * Reusable UI component builders for MWI Tools
     */

    /**
     * Create a collapsible section with expand/collapse functionality
     * @param {string} icon - Icon/emoji for the section (optional, pass empty string to omit)
     * @param {string} title - Section title
     * @param {string} summary - Summary text shown when collapsed (optional)
     * @param {HTMLElement} content - Content element to show/hide
     * @param {boolean} defaultOpen - Whether section starts open (default: false)
     * @param {number} indent - Indentation level: 0 = root, 1 = nested, etc. (default: 0)
     * @returns {HTMLElement} Section container
     */
    function createCollapsibleSection(icon, title, summary, content, defaultOpen = false, indent = 0) {
        const section = document.createElement('div');
        section.className = 'mwi-collapsible-section';
        section.style.cssText = `
        margin-top: ${indent > 0 ? '4px' : '8px'};
        margin-bottom: ${indent > 0 ? '4px' : '8px'};
        margin-left: ${indent * 16}px;
    `;

        // Create header
        const header = document.createElement('div');
        header.className = 'mwi-section-header';
        header.style.cssText = `
        display: flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
        padding: 4px 0;
        color: var(--text-color-primary, #fff);
        font-weight: ${indent === 0 ? '500' : '400'};
        font-size: ${indent > 0 ? '0.9em' : '1em'};
    `;

        const arrow = document.createElement('span');
        arrow.textContent = defaultOpen ? '▼' : '▶';
        arrow.style.cssText = `
        margin-right: 6px;
        font-size: 0.7em;
        transition: transform 0.2s;
    `;

        const label = document.createElement('span');
        label.textContent = icon ? `${icon} ${title}` : title;

        header.appendChild(arrow);
        header.appendChild(label);

        // Create summary (shown when collapsed)
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = `
        margin-left: 16px;
        margin-top: 2px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        display: ${defaultOpen ? 'none' : 'block'};
    `;
        if (summary) {
            summaryDiv.textContent = summary;
        }

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'mwi-section-content';
        contentWrapper.style.cssText = `
        display: ${defaultOpen ? 'block' : 'none'};
        margin-left: ${indent === 0 ? '16px' : '0px'};
        margin-top: 4px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        line-height: 1.6;
    `;
        contentWrapper.appendChild(content);

        // Toggle functionality
        header.addEventListener('click', () => {
            const isOpen = contentWrapper.style.display === 'block';
            contentWrapper.style.display = isOpen ? 'none' : 'block';
            if (summary) {
                summaryDiv.style.display = isOpen ? 'block' : 'none';
            }
            arrow.textContent = isOpen ? '▶' : '▼';
        });

        section.appendChild(header);
        if (summary) {
            section.appendChild(summaryDiv);
        }
        section.appendChild(contentWrapper);

        return section;
    }

    /**
     * Profit Display Functions
     *
     * Handles displaying profit calculations in action panels for:
     * - Gathering actions (Foraging, Woodcutting, Milking)
     * - Production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     */


    /**
     * Display gathering profit calculation in panel
     * @param {HTMLElement} panel - Action panel element
     * @param {string} actionHrid - Action HRID
     * @param {string} dropTableSelector - CSS selector for drop table element
     */
    async function displayGatheringProfit(panel, actionHrid, dropTableSelector) {
        // Calculate profit
        const profitData = await calculateGatheringProfit(actionHrid);
        if (!profitData) {
            console.error('❌ Gathering profit calculation failed for:', actionHrid);
            return;
        }

        // Check if we already added profit display
        const existingProfit = panel.querySelector('#mwi-foraging-profit');
        if (existingProfit) {
            existingProfit.remove();
        }

        // Create top-level summary
        const profit = Math.round(profitData.profitPerHour);
        const profitPerDay = Math.round(profitData.profitPerDay);
        const revenue = Math.round(profitData.revenuePerHour);
        const costs = Math.round(profitData.drinkCostPerHour);
        const summary = `${formatWithSeparator(profit)}/hr, ${formatWithSeparator(profitPerDay)}/day`;

        // ===== Build Detailed Breakdown Content =====
        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;">Revenue: ${formatWithSeparator(revenue)}/hr</div>`;

        // Base Output subsection
        const baseOutputContent = document.createElement('div');
        if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
            for (const output of profitData.baseOutputs) {
                const decimals = output.itemsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';

                // Show processing percentage for processed items
                if (output.isProcessed && output.processingChance) {
                    const processingPercent = (output.processingChance * 100).toFixed(1);
                    line.textContent = `• ${output.name}: (${processingPercent}%) ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)} each → ${formatWithSeparator(Math.round(output.revenuePerHour))}/hr`;
                } else {
                    line.textContent = `• ${output.name}: ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)} each → ${formatWithSeparator(Math.round(output.revenuePerHour))}/hr`;
                }

                baseOutputContent.appendChild(line);
            }
        }

        const baseRevenue = profitData.baseOutputs?.reduce((sum, o) => sum + o.revenuePerHour, 0) || 0;
        const baseOutputSection = createCollapsibleSection(
            '',
            `Base Output: ${formatWithSeparator(Math.round(baseRevenue))}/hr (${profitData.baseOutputs?.length || 0} item${profitData.baseOutputs?.length !== 1 ? 's' : ''})`,
            null,
            baseOutputContent,
            false,
            1
        );

        // Bonus Drops subsections - split by type
        const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
        const essenceDrops = bonusDrops.filter(drop => drop.type === 'essence');
        const rareFinds = bonusDrops.filter(drop => drop.type === 'rare_find');

        // Essence Drops subsection
        let essenceSection = null;
        if (essenceDrops.length > 0) {
            const essenceContent = document.createElement('div');
            for (const drop of essenceDrops) {
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour, 0);
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = createCollapsibleSection(
                '',
                `Essence Drops: ${formatWithSeparator(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
                null,
                essenceContent,
                false,
                1
            );
        }

        // Rare Finds subsection
        let rareFindSection = null;
        if (rareFinds.length > 0) {
            const rareFindContent = document.createElement('div');
            for (const drop of rareFinds) {
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour, 0);
            const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
            rareFindSection = createCollapsibleSection(
                '',
                `Rare Finds: ${formatWithSeparator(Math.round(rareFindRevenue))}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
                null,
                rareFindContent,
                false,
                1
            );
        }

        revenueDiv.appendChild(baseOutputSection);
        if (essenceSection) {
            revenueDiv.appendChild(essenceSection);
        }
        if (rareFindSection) {
            revenueDiv.appendChild(rareFindSection);
        }

        // Costs Section
        const costsDiv = document.createElement('div');
        costsDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-top: 12px; margin-bottom: 4px;">Costs: ${formatWithSeparator(costs)}/hr</div>`;

        // Drink Costs subsection
        const drinkCostsContent = document.createElement('div');
        if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
            for (const drink of profitData.drinkCosts) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(drink.priceEach)} → ${formatWithSeparator(Math.round(drink.costPerHour))}/hr`;
                drinkCostsContent.appendChild(line);
            }
        }

        const drinkCount = profitData.drinkCosts?.length || 0;
        const drinkCostsSection = createCollapsibleSection(
            '',
            `Drink Costs: ${formatWithSeparator(costs)}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
            null,
            drinkCostsContent,
            false,
            1
        );

        costsDiv.appendChild(drinkCostsSection);

        // Modifiers Section
        const modifiersDiv = document.createElement('div');
        modifiersDiv.style.cssText = `
        margin-top: 12px;
        color: var(--text-color-secondary, #888);
    `;

        const modifierLines = [];

        // Efficiency breakdown
        const effParts = [];
        if (profitData.details.levelEfficiency > 0) {
            effParts.push(`${profitData.details.levelEfficiency}% level`);
        }
        if (profitData.details.houseEfficiency > 0) {
            effParts.push(`${profitData.details.houseEfficiency.toFixed(1)}% house`);
        }
        if (profitData.details.teaEfficiency > 0) {
            effParts.push(`${profitData.details.teaEfficiency.toFixed(1)}% tea`);
        }
        if (profitData.details.equipmentEfficiency > 0) {
            effParts.push(`${profitData.details.equipmentEfficiency.toFixed(1)}% equip`);
        }
        if (profitData.details.gourmetBonus > 0) {
            effParts.push(`${profitData.details.gourmetBonus.toFixed(1)}% gourmet`);
        }

        if (effParts.length > 0) {
            modifierLines.push(`<div style="font-weight: 500; color: var(--text-color-primary, #fff);">Modifiers:</div>`);
            modifierLines.push(`<div style="margin-left: 8px;">• Efficiency: +${profitData.totalEfficiency.toFixed(1)}% (${effParts.join(', ')})</div>`);
        }

        // Gathering Quantity
        if (profitData.gatheringQuantity > 0) {
            const gatheringParts = [];
            if (profitData.details.communityBuffQuantity > 0) {
                gatheringParts.push(`${profitData.details.communityBuffQuantity.toFixed(1)}% community`);
            }
            if (profitData.details.gatheringTeaBonus > 0) {
                gatheringParts.push(`${profitData.details.gatheringTeaBonus.toFixed(1)}% tea`);
            }
            modifierLines.push(`<div style="margin-left: 8px;">• Gathering Quantity: +${profitData.gatheringQuantity.toFixed(1)}% (${gatheringParts.join(', ')})</div>`);
        }

        modifiersDiv.innerHTML = modifierLines.join('');

        // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
        detailsContent.appendChild(revenueDiv);
        detailsContent.appendChild(costsDiv);
        detailsContent.appendChild(modifiersDiv);

        // Create "Detailed Breakdown" collapsible
        const topLevelContent = document.createElement('div');
        topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr | Efficiency: +${profitData.totalEfficiency.toFixed(1)}%</div>
    `;

        // Add Net Profit line at top level (always visible when Profitability is expanded)
        const profitColor = profit >= 0 ? '#4ade80' : '#f87171'; // green if positive, red if negative
        const netProfitLine = document.createElement('div');
        netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
        netProfitLine.textContent = `Net Profit: ${formatWithSeparator(profit)}/hr, ${formatWithSeparator(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

        const detailedBreakdownSection = createCollapsibleSection(
            '📊',
            'Detailed Breakdown',
            null,
            detailsContent,
            false,
            0
        );

        topLevelContent.appendChild(detailedBreakdownSection);

        // Create main profit section
        const profitSection = createCollapsibleSection(
            '💰',
            'Profitability',
            summary,
            topLevelContent,
            false,
            0
        );
        profitSection.id = 'mwi-foraging-profit';

        // Find insertion point - look for existing collapsible sections or drop table
        let insertionPoint = panel.querySelector('.mwi-collapsible-section');
        if (insertionPoint) {
            // Insert after last collapsible section
            while (insertionPoint.nextElementSibling && insertionPoint.nextElementSibling.className === 'mwi-collapsible-section') {
                insertionPoint = insertionPoint.nextElementSibling;
            }
            insertionPoint.insertAdjacentElement('afterend', profitSection);
        } else {
            // Fallback: insert after drop table
            const dropTableElement = panel.querySelector(dropTableSelector);
            if (dropTableElement) {
                dropTableElement.parentNode.insertBefore(
                    profitSection,
                    dropTableElement.nextSibling
                );
            }
        }
    }

    /**
     * Display production profit calculation in panel
     * @param {HTMLElement} panel - Action panel element
     * @param {string} actionHrid - Action HRID
     * @param {string} dropTableSelector - CSS selector for drop table element
     */
    async function displayProductionProfit(panel, actionHrid, dropTableSelector) {
        // Calculate profit
        const profitData = await calculateProductionProfit(actionHrid);
        if (!profitData) {
            console.error('❌ Production profit calculation failed for:', actionHrid);
            return;
        }

        // Validate required fields
        const requiredFields = [
            'profitPerHour', 'profitPerDay', 'itemsPerHour', 'priceAfterTax',
            'gourmetBonusItems', 'materialCostPerHour', 'totalTeaCostPerHour',
            'actionsPerHour', 'efficiencyBonus', 'levelEfficiency', 'houseEfficiency',
            'teaEfficiency', 'equipmentEfficiency', 'artisanBonus', 'gourmetBonus',
            'materialCosts', 'teaCosts'
        ];

        const missingFields = requiredFields.filter(field => profitData[field] === undefined);
        if (missingFields.length > 0) {
            console.error('❌ Production profit data missing required fields:', missingFields, 'for action:', actionHrid);
            console.error('Received profitData:', profitData);
            return;
        }

        // Check if we already added profit display
        const existingProfit = panel.querySelector('#mwi-production-profit');
        if (existingProfit) {
            existingProfit.remove();
        }

        // Create top-level summary (bonus revenue now included in profitPerHour)
        const profit = Math.round(profitData.profitPerHour);
        const profitPerDay = Math.round(profit * 24);
        const bonusRevenueTotal = profitData.bonusRevenue?.totalBonusRevenue || 0;
        const revenue = Math.round(profitData.itemsPerHour * profitData.priceAfterTax + profitData.gourmetBonusItems * profitData.priceAfterTax + bonusRevenueTotal);
        const costs = Math.round(profitData.materialCostPerHour + profitData.totalTeaCostPerHour);
        const summary = `${formatWithSeparator(profit)}/hr, ${formatWithSeparator(profitPerDay)}/day`;

        // ===== Build Detailed Breakdown Content =====
        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;">Revenue: ${formatWithSeparator(revenue)}/hr</div>`;

        // Base Output subsection
        const baseOutputContent = document.createElement('div');
        const baseOutputLine = document.createElement('div');
        baseOutputLine.style.marginLeft = '8px';
        baseOutputLine.textContent = `• Base Output: ${profitData.itemsPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.priceAfterTax))} each → ${formatWithSeparator(Math.round(profitData.itemsPerHour * profitData.priceAfterTax))}/hr`;
        baseOutputContent.appendChild(baseOutputLine);

        const baseRevenue = profitData.itemsPerHour * profitData.priceAfterTax;
        const baseOutputSection = createCollapsibleSection(
            '',
            `Base Output: ${formatWithSeparator(Math.round(baseRevenue))}/hr`,
            null,
            baseOutputContent,
            false,
            1
        );

        // Gourmet Bonus subsection
        let gourmetSection = null;
        if (profitData.gourmetBonusItems > 0) {
            const gourmetContent = document.createElement('div');
            const gourmetLine = document.createElement('div');
            gourmetLine.style.marginLeft = '8px';
            gourmetLine.textContent = `• Gourmet Bonus: ${profitData.gourmetBonusItems.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(profitData.priceAfterTax))} each → ${formatWithSeparator(Math.round(profitData.gourmetBonusItems * profitData.priceAfterTax))}/hr`;
            gourmetContent.appendChild(gourmetLine);

            const gourmetRevenue = profitData.gourmetBonusItems * profitData.priceAfterTax;
            gourmetSection = createCollapsibleSection(
                '',
                `Gourmet Bonus: ${formatWithSeparator(Math.round(gourmetRevenue))}/hr (${(profitData.gourmetBonus * 100).toFixed(1)}% gourmet)`,
                null,
                gourmetContent,
                false,
                1
            );
        }

        revenueDiv.appendChild(baseOutputSection);
        if (gourmetSection) {
            revenueDiv.appendChild(gourmetSection);
        }

        // Bonus Drops subsections - split by type
        const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
        const essenceDrops = bonusDrops.filter(drop => drop.type === 'essence');
        const rareFinds = bonusDrops.filter(drop => drop.type === 'rare_find');

        // Essence Drops subsection
        let essenceSection = null;
        if (essenceDrops.length > 0) {
            const essenceContent = document.createElement('div');
            for (const drop of essenceDrops) {
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
                essenceContent.appendChild(line);
            }

            const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour, 0);
            const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
            essenceSection = createCollapsibleSection(
                '',
                `Essence Drops: ${formatWithSeparator(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
                null,
                essenceContent,
                false,
                1
            );
        }

        // Rare Finds subsection
        let rareFindSection = null;
        if (rareFinds.length > 0) {
            const rareFindContent = document.createElement('div');
            for (const drop of rareFinds) {
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
                rareFindContent.appendChild(line);
            }

            const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour, 0);
            const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
            rareFindSection = createCollapsibleSection(
                '',
                `Rare Finds: ${formatWithSeparator(Math.round(rareFindRevenue))}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
                null,
                rareFindContent,
                false,
                1
            );
        }

        if (essenceSection) {
            revenueDiv.appendChild(essenceSection);
        }
        if (rareFindSection) {
            revenueDiv.appendChild(rareFindSection);
        }

        // Costs Section
        const costsDiv = document.createElement('div');
        costsDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-top: 12px; margin-bottom: 4px;">Costs: ${formatWithSeparator(costs)}/hr</div>`;

        // Material Costs subsection
        const materialCostsContent = document.createElement('div');
        if (profitData.materialCosts && profitData.materialCosts.length > 0) {
            for (const material of profitData.materialCosts) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                // Material structure: { itemName, amount, askPrice, totalCost, baseAmount }
                const amountPerAction = material.amount || 0;
                const amountPerHour = amountPerAction * profitData.actionsPerHour;

                // Build material line with embedded Artisan information
                let materialText = `• ${material.itemName}: ${amountPerHour.toFixed(1)}/hr`;

                // Add Artisan reduction info if present
                if (profitData.artisanBonus > 0 && material.baseAmount) {
                    const baseAmountPerHour = material.baseAmount * profitData.actionsPerHour;
                    materialText += ` (${baseAmountPerHour.toFixed(1)} base -${(profitData.artisanBonus * 100).toFixed(1)}% 🍵)`;
                }

                materialText += ` @ ${formatWithSeparator(Math.round(material.askPrice))} → ${formatWithSeparator(Math.round(material.totalCost * profitData.actionsPerHour))}/hr`;

                line.textContent = materialText;
                materialCostsContent.appendChild(line);
            }
        }

        const materialCostsSection = createCollapsibleSection(
            '',
            `Material Costs: ${formatWithSeparator(Math.round(profitData.materialCostPerHour))}/hr (${profitData.materialCosts?.length || 0} material${profitData.materialCosts?.length !== 1 ? 's' : ''})`,
            null,
            materialCostsContent,
            false,
            1
        );

        // Tea Costs subsection
        const teaCostsContent = document.createElement('div');
        if (profitData.teaCosts && profitData.teaCosts.length > 0) {
            for (const tea of profitData.teaCosts) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                // Tea structure: { itemName, pricePerDrink, drinksPerHour, totalCost }
                line.textContent = `• ${tea.itemName}: ${tea.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(tea.pricePerDrink))} → ${formatWithSeparator(Math.round(tea.totalCost))}/hr`;
                teaCostsContent.appendChild(line);
            }
        }

        const teaCount = profitData.teaCosts?.length || 0;
        const teaCostsSection = createCollapsibleSection(
            '',
            `Drink Costs: ${formatWithSeparator(Math.round(profitData.totalTeaCostPerHour))}/hr (${teaCount} drink${teaCount !== 1 ? 's' : ''})`,
            null,
            teaCostsContent,
            false,
            1
        );

        costsDiv.appendChild(materialCostsSection);
        costsDiv.appendChild(teaCostsSection);

        // Modifiers Section
        const modifiersDiv = document.createElement('div');
        modifiersDiv.style.cssText = `
        margin-top: 12px;
        color: var(--text-color-secondary, #888);
    `;

        const modifierLines = [];

        // Artisan Bonus (still shown here for reference, also embedded in materials)
        if (profitData.artisanBonus > 0) {
            modifierLines.push(`<div style="font-weight: 500; color: var(--text-color-primary, #fff);">Modifiers:</div>`);
            modifierLines.push(`<div style="margin-left: 8px;">• Artisan: -${(profitData.artisanBonus * 100).toFixed(1)}% material requirement</div>`);
        }

        // Gourmet Bonus
        if (profitData.gourmetBonus > 0) {
            if (modifierLines.length === 0) {
                modifierLines.push(`<div style="font-weight: 500; color: var(--text-color-primary, #fff);">Modifiers:</div>`);
            }
            modifierLines.push(`<div style="margin-left: 8px;">• Gourmet: +${(profitData.gourmetBonus * 100).toFixed(1)}% bonus items</div>`);
        }

        modifiersDiv.innerHTML = modifierLines.join('');

        // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
        detailsContent.appendChild(revenueDiv);
        detailsContent.appendChild(costsDiv);
        if (modifierLines.length > 0) {
            detailsContent.appendChild(modifiersDiv);
        }

        // Create "Detailed Breakdown" collapsible
        const topLevelContent = document.createElement('div');
        topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr</div>
    `;

        // Add Net Profit line at top level (always visible when Profitability is expanded)
        const profitColor = profit >= 0 ? '#4ade80' : '#f87171'; // green if positive, red if negative
        const netProfitLine = document.createElement('div');
        netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
        netProfitLine.textContent = `Net Profit: ${formatWithSeparator(profit)}/hr, ${formatWithSeparator(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

        const detailedBreakdownSection = createCollapsibleSection(
            '📊',
            'Detailed Breakdown',
            null,
            detailsContent,
            false,
            0
        );

        topLevelContent.appendChild(detailedBreakdownSection);

        // Create main profit section
        const profitSection = createCollapsibleSection(
            '💰',
            'Profitability',
            summary,
            topLevelContent,
            false,
            0
        );
        profitSection.id = 'mwi-production-profit';

        // Find insertion point - look for existing collapsible sections or drop table
        let insertionPoint = panel.querySelector('.mwi-collapsible-section');
        if (insertionPoint) {
            // Insert after last collapsible section
            while (insertionPoint.nextElementSibling && insertionPoint.nextElementSibling.className === 'mwi-collapsible-section') {
                insertionPoint = insertionPoint.nextElementSibling;
            }
            insertionPoint.insertAdjacentElement('afterend', profitSection);
        } else {
            // Fallback: insert after drop table
            const dropTableElement = panel.querySelector(dropTableSelector);
            if (dropTableElement) {
                dropTableElement.parentNode.insertBefore(
                    profitSection,
                    dropTableElement.nextSibling
                );
            }
        }
    }

    /**
     * Action Panel Observer
     *
     * Detects when action panels appear and enhances them with:
     * - Gathering profit calculations (Foraging, Woodcutting, Milking)
     * - Production profit calculations (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     * - Other action panel enhancements (future)
     *
     * Automatically filters out combat action panels.
     */


    /**
     * Action types for gathering skills (3 skills)
     */
    const GATHERING_TYPES = [
        '/action_types/foraging',
        '/action_types/woodcutting',
        '/action_types/milking'
    ];

    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring'
    ];

    /**
     * Debounced update tracker for enhancement calculations
     * Maps itemHrid to timeout ID
     */
    const updateTimeouts = new Map();

    /**
     * Module-level observer reference for cleanup
     */
    let panelObserver = null;

    /**
     * Trigger debounced enhancement stats update
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function triggerEnhancementUpdate(panel, itemHrid) {
        // Clear existing timeout for this item
        if (updateTimeouts.has(itemHrid)) {
            clearTimeout(updateTimeouts.get(itemHrid));
        }

        // Set new timeout
        const timeoutId = setTimeout(async () => {
            await displayEnhancementStats(panel, itemHrid);
            updateTimeouts.delete(itemHrid);
        }, 500); // Wait 500ms after last change

        updateTimeouts.set(itemHrid, timeoutId);
    }

    /**
     * CSS selectors for action panel detection
     */
    const SELECTORS = {
        REGULAR_PANEL: 'div.SkillActionDetail_regularComponent__3oCgr',
        ENHANCING_PANEL: 'div.SkillActionDetail_enhancingComponent__17bOx',
        EXP_GAIN: 'div.SkillActionDetail_expGain__F5xHu',
        ACTION_NAME: 'div.SkillActionDetail_name__3erHV',
        DROP_TABLE: 'div.SkillActionDetail_dropTable__3ViVp',
        ENHANCING_OUTPUT: 'div.SkillActionDetail_enhancingOutput__VPHbY', // Outputs container
        ITEM_NAME: 'div.Item_name__2C42x' // Item name (without +1)
    };

    /**
     * Initialize action panel observer
     * Sets up MutationObserver on document.body to watch for action panels
     */
    function initActionPanelObserver() {
        setupMutationObserver();

        // Check for existing enhancing panel (may already be on page)
        checkExistingEnhancingPanel();

        // Listen for equipment and consumable changes to refresh enhancement calculator
        setupEnhancementRefreshListeners();
    }

    /**
     * Set up MutationObserver to detect action panels
     */
    function setupMutationObserver() {
        panelObserver = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                // Handle attribute changes
                if (mutation.type === 'attributes') {
                    // Handle value attribute changes on INPUT elements (clicking up/down arrows)
                    if (mutation.attributeName === 'value' && mutation.target.tagName === 'INPUT') {
                        const input = mutation.target;
                        const panel = input.closest(SELECTORS.ENHANCING_PANEL);
                        if (panel) {
                            const itemHrid = panel.dataset.mwiItemHrid;
                            if (itemHrid) {
                                // Trigger the same debounced update
                                triggerEnhancementUpdate(panel, itemHrid);
                            }
                        }
                    }

                    // Handle href attribute changes on USE elements (item sprite changes when selecting different item)
                    if (mutation.attributeName === 'href' && mutation.target.tagName === 'use') {
                        const panel = mutation.target.closest(SELECTORS.ENHANCING_PANEL);
                        if (panel) {
                            // Item changed - re-detect and recalculate
                            await handleEnhancingPanel(panel);
                        }
                    }
                }

                for (const addedNode of mutation.addedNodes) {
                    if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

                    // Check for modal container with regular action panel (gathering/crafting)
                    if (
                        addedNode.classList?.contains('Modal_modalContainer__3B80m') &&
                        addedNode.querySelector(SELECTORS.REGULAR_PANEL)
                    ) {
                        const panel = addedNode.querySelector(SELECTORS.REGULAR_PANEL);
                        await handleActionPanel(panel);
                    }

                    // Check for enhancing panel (non-modal, on main page)
                    if (
                        addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx') ||
                        addedNode.querySelector(SELECTORS.ENHANCING_PANEL)
                    ) {
                        const panel = addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx')
                            ? addedNode
                            : addedNode.querySelector(SELECTORS.ENHANCING_PANEL);
                        await handleEnhancingPanel(panel);
                    }

                    // Check if this is an outputs section being added to an existing enhancing panel
                    if (
                        addedNode.classList?.contains('SkillActionDetail_enhancingOutput__VPHbY') ||
                        (addedNode.querySelector && addedNode.querySelector(SELECTORS.ENHANCING_OUTPUT))
                    ) {
                        // Find the parent enhancing panel
                        let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                        if (panel) {
                            await handleEnhancingPanel(panel);
                        }
                    }

                    // Also check for item div being added (in case outputs container already exists)
                    if (
                        addedNode.classList?.contains('SkillActionDetail_item__2vEAz') ||
                        addedNode.classList?.contains('Item_name__2C42x')
                    ) {
                        // Find the parent enhancing panel
                        let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                        if (panel) {
                            await handleEnhancingPanel(panel);
                        }
                    }

                    // Check for new input elements being added (e.g., Protect From Level after dropping protection item)
                    if (addedNode.tagName === 'INPUT' && (addedNode.type === 'number' || addedNode.type === 'text')) {
                        const panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                        if (panel) {
                            // Get the item HRID from the panel's data
                            const itemHrid = panel.dataset.mwiItemHrid;
                            if (itemHrid) {
                                addInputListener(addedNode, panel, itemHrid);
                            }
                        }
                    }
                }
            }
        });

        panelObserver.observe(document.body, {
            childList: true,
            subtree: true,  // Watch entire tree, not just direct children
            attributes: true,  // Watch for attribute changes (all attributes)
            attributeOldValue: true  // Track old values
        });
    }

    /**
     * Set up listeners for equipment and consumable changes
     * Refreshes enhancement calculator when gear or teas change
     */
    function setupEnhancementRefreshListeners() {
        // Listen for equipment changes (equipping/unequipping items)
        dataManager.on('items_updated', () => {
            refreshEnhancementCalculator();
        });

        // Listen for consumable changes (drinking teas)
        dataManager.on('consumables_updated', () => {
            refreshEnhancementCalculator();
        });
    }

    /**
     * Refresh enhancement calculator if panel is currently visible
     */
    function refreshEnhancementCalculator() {
        const panel = document.querySelector(SELECTORS.ENHANCING_PANEL);
        if (!panel) return;  // Not on enhancing panel, skip

        const itemHrid = panel.dataset.mwiItemHrid;
        if (!itemHrid) return;  // No item detected yet, skip

        // Trigger debounced update
        triggerEnhancementUpdate(panel, itemHrid);
    }

    /**
     * Check for existing enhancing panel on page load
     * The enhancing panel may already exist when MWI Tools initializes
     */
    function checkExistingEnhancingPanel() {
        // Wait a moment for page to settle
        setTimeout(() => {
            const existingPanel = document.querySelector(SELECTORS.ENHANCING_PANEL);
            if (existingPanel) {
                handleEnhancingPanel(existingPanel);
            }
        }, 500);
    }

    /**
     * Handle action panel appearance (gathering/crafting/production)
     * @param {HTMLElement} panel - Action panel element
     */
    async function handleActionPanel(panel) {
        if (!panel) return;

        // Filter out combat action panels (they don't have XP gain display)
        const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
        if (!expGainElement) return; // Combat panel, skip

        // Get action name
        const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
        if (!actionNameElement) return;

        const actionName = getOriginalText(actionNameElement);
        const actionHrid = getActionHridFromName(actionName);
        if (!actionHrid) return;

        // Get action details
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];
        if (!actionDetail) return;

        // Check if this is a gathering action
        if (GATHERING_TYPES.includes(actionDetail.type)) {
            const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
            if (dropTableElement) {
                await displayGatheringProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
            }
        }

        // Check if this is a production action
        if (PRODUCTION_TYPES.includes(actionDetail.type)) {
            const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
            if (dropTableElement) {
                await displayProductionProfit(panel, actionHrid, SELECTORS.DROP_TABLE);
            }
        }
    }

    /**
     * Find and cache the Current Action tab button
     * @param {HTMLElement} panel - Enhancing panel element
     * @returns {HTMLButtonElement|null} Current Action tab button or null
     */
    function getCurrentActionTabButton(panel) {
        // Check if we already cached it
        if (panel._cachedCurrentActionTab) {
            return panel._cachedCurrentActionTab;
        }

        // Walk up the DOM to find tab buttons (only once)
        let current = panel;
        let depth = 0;
        const maxDepth = 5;

        while (current && depth < maxDepth) {
            const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
            const currentActionTab = buttons.find(btn => btn.textContent.trim() === 'Current Action');

            if (currentActionTab) {
                // Cache it on the panel for future lookups
                panel._cachedCurrentActionTab = currentActionTab;
                return currentActionTab;
            }

            current = current.parentElement;
            depth++;
        }

        return null;
    }

    /**
     * Check if we're on the "Enhance" tab (not "Current Action" tab)
     * @param {HTMLElement} panel - Enhancing panel element
     * @returns {boolean} True if on Enhance tab
     */
    function isEnhanceTabActive(panel) {
        // Get cached tab button (DOM query happens only once per panel)
        const currentActionTab = getCurrentActionTabButton(panel);

        if (!currentActionTab) {
            // No Current Action tab found, show calculator
            return true;
        }

        // Fast checks: just 3 property accesses (no DOM queries)
        if (currentActionTab.getAttribute('aria-selected') === 'true') {
            return false; // Current Action is active
        }

        if (currentActionTab.classList.contains('Mui-selected')) {
            return false;
        }

        if (currentActionTab.getAttribute('tabindex') === '0') {
            return false;
        }

        // Enhance tab is active
        return true;
    }

    /**
     * Handle enhancing panel appearance
     * @param {HTMLElement} panel - Enhancing panel element
     */
    async function handleEnhancingPanel(panel) {
        if (!panel) return;

        // Set up tab click listeners (only once per panel)
        if (!panel.dataset.mwiTabListenersAdded) {
            setupTabClickListeners(panel);
            panel.dataset.mwiTabListenersAdded = 'true';
        }

        // Only show calculator on "Enhance" tab, not "Current Action" tab
        if (!isEnhanceTabActive(panel)) {
            // Remove calculator if it exists
            const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
            if (existingDisplay) {
                existingDisplay.remove();
            }
            return;
        }

        // Find the output element that shows the enhanced item
        const outputsSection = panel.querySelector(SELECTORS.ENHANCING_OUTPUT);
        if (!outputsSection) {
            return;
        }

        // Check if there's actually an item selected (not just placeholder)
        // When no item is selected, the outputs section exists but has no item icon
        const itemIcon = outputsSection.querySelector('svg[role="img"], img');
        if (!itemIcon) {
            // No item icon = no item selected, don't show calculator
            // Remove existing calculator display if present
            const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
            if (existingDisplay) {
                existingDisplay.remove();
            }
            return;
        }

        // Get the item name from the Item_name element (without +1)
        const itemNameElement = outputsSection.querySelector(SELECTORS.ITEM_NAME);
        if (!itemNameElement) {
            return;
        }

        const itemName = itemNameElement.textContent.trim();

        if (!itemName) {
            return;
        }

        // Find the item HRID from the name
        const gameData = dataManager.getInitClientData();
        const itemHrid = getItemHridFromName(itemName, gameData);

        if (!itemHrid) {
            return;
        }

        // Get item details
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) return;

        // Store itemHrid on panel for later reference (when new inputs are added)
        panel.dataset.mwiItemHrid = itemHrid;

        // Double-check tab state right before rendering (safety check for race conditions)
        if (!isEnhanceTabActive(panel)) {
            // Current Action tab became active during processing, don't render
            return;
        }

        // Display enhancement stats using the item HRID directly
        await displayEnhancementStats(panel, itemHrid);

        // Set up observers for Target Level and Protect From Level inputs
        setupInputObservers(panel, itemHrid);
    }

    /**
     * Set up click listeners on tab buttons to show/hide calculator
     * @param {HTMLElement} panel - Enhancing panel element
     */
    function setupTabClickListeners(panel) {
        // Walk up the DOM to find tab buttons
        let current = panel;
        let depth = 0;
        const maxDepth = 5;

        let tabButtons = [];

        while (current && depth < maxDepth) {
            const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
            const foundTabs = buttons.filter(btn => {
                const text = btn.textContent.trim();
                return text === 'Enhance' || text === 'Current Action';
            });

            if (foundTabs.length === 2) {
                tabButtons = foundTabs;
                break;
            }

            current = current.parentElement;
            depth++;
        }

        if (tabButtons.length !== 2) {
            return; // Can't find tabs, skip listener setup
        }

        // Add click listeners to both tabs
        tabButtons.forEach(button => {
            button.addEventListener('click', async () => {
                // Small delay to let the tab change take effect
                setTimeout(async () => {
                    const isEnhanceActive = isEnhanceTabActive(panel);
                    const existingDisplay = panel.querySelector('#mwi-enhancement-stats');

                    if (!isEnhanceActive) {
                        // Current Action tab clicked - remove calculator
                        if (existingDisplay) {
                            existingDisplay.remove();
                        }
                    } else {
                        // Enhance tab clicked - show calculator if item is selected
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid && !existingDisplay) {
                            // Re-render calculator
                            await displayEnhancementStats(panel, itemHrid);
                        }
                    }
                }, 100);
            });
        });
    }

    /**
     * Add input listener to a single input element
     * @param {HTMLInputElement} input - Input element
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function addInputListener(input, panel, itemHrid) {
        // Handler that triggers the shared debounced update
        const handleInputChange = () => {
            triggerEnhancementUpdate(panel, itemHrid);
        };

        // Add change listeners
        input.addEventListener('input', handleInputChange);
        input.addEventListener('change', handleInputChange);
    }

    /**
     * Set up observers for Target Level and Protect From Level inputs
     * Re-calculates enhancement stats when user changes these values
     * @param {HTMLElement} panel - Enhancing panel element
     * @param {string} itemHrid - Item HRID
     */
    function setupInputObservers(panel, itemHrid) {
        // Find all input elements in the panel
        const inputs = panel.querySelectorAll('input[type="number"], input[type="text"]');

        // Add listeners to all existing inputs
        inputs.forEach(input => {
            addInputListener(input, panel, itemHrid);
        });
    }

    /**
     * Convert action name to HRID
     * @param {string} actionName - Display name of action
     * @returns {string|null} Action HRID or null if not found
     */
    function getActionHridFromName(actionName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) {
            return null;
        }

        // Search for action by name
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === actionName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Convert item name to HRID
     * @param {string} itemName - Display name of item
     * @param {Object} gameData - Game data from dataManager
     * @returns {string|null} Item HRID or null if not found
     */
    function getItemHridFromName(itemName, gameData) {
        if (!gameData?.itemDetailMap) {
            return null;
        }

        // Search for item by name
        for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
            if (detail.name === itemName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Action Time Display Module
     *
     * Displays estimated completion time for queued actions in a dedicated panel.
     * Uses WebSocket data from data-manager instead of DOM scraping.
     *
     * Features:
     * - Shows current action with queue count
     * - Displays time per action (with speed breakdown)
     * - Shows actions per hour (with efficiency)
     * - Estimates total time remaining
     * - Shows estimated completion time (clock format)
     * - Updates automatically on action changes
     * - Queue tooltip enhancement (time for each action + total)
     */


    /**
     * ActionTimeDisplay class manages the time display panel and queue tooltips
     */
    class ActionTimeDisplay {
        constructor() {
            this.displayElement = null;
            this.isInitialized = false;
            this.updateTimer = null;
            this.unregisterQueueObserver = null;
            this.actionNameObserver = null;
            this.queueMenuObserver = null; // Observer for queue menu mutations
            this.characterInitHandler = null; // Handler for character switch
        }

        /**
         * Initialize the action time display
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            // Check if feature is enabled
            const enabled = config.getSettingValue('totalActionTime', true);
            if (!enabled) {
                return;
            }

            // Set up handler for character switching
            if (!this.characterInitHandler) {
                this.characterInitHandler = () => {
                    this.handleCharacterSwitch();
                };
                dataManager.on('character_initialized', this.characterInitHandler);
            }

            // Wait for action name element to exist
            this.waitForActionPanel();

            // Initialize queue tooltip observer
            this.initializeQueueObserver();

            this.isInitialized = true;
        }

        /**
         * Initialize observer for queue tooltip
         */
        initializeQueueObserver() {
            // Register with centralized DOM observer to watch for queue menu
            this.unregisterQueueObserver = domObserver.onClass(
                'ActionTimeDisplay-Queue',
                'QueuedActions_queuedActionsEditMenu',
                (queueMenu) => {
                    this.injectQueueTimes(queueMenu);

                    // Set up mutation observer to watch for queue reordering
                    if (this.queueMenuObserver) {
                        this.queueMenuObserver.disconnect();
                    }

                    this.queueMenuObserver = new MutationObserver(() => {
                        // Disconnect to prevent infinite loop (our injection triggers mutations)
                        this.queueMenuObserver.disconnect();

                        // Queue DOM changed (reordering) - re-inject times
                        this.injectQueueTimes(queueMenu);

                        // Reconnect to continue watching
                        this.queueMenuObserver.observe(queueMenu, {
                            childList: true,
                            subtree: true
                        });
                    });

                    this.queueMenuObserver.observe(queueMenu, {
                        childList: true,
                        subtree: true
                    });
                }
            );
        }

        /**
         * Handle character switch
         * Clean up old observers and re-initialize for new character's action panel
         */
        handleCharacterSwitch() {
            // Disconnect old action name observer (watching removed element)
            if (this.actionNameObserver) {
                this.actionNameObserver.disconnect();
                this.actionNameObserver = null;
            }

            // Clear display element reference (already removed from DOM by game)
            this.displayElement = null;

            // Re-initialize action panel display for new character
            this.waitForActionPanel();
        }

        /**
         * Wait for action panel to exist in DOM
         */
        async waitForActionPanel() {
            // Try to find action name element
            const actionNameElement = document.querySelector('div.Header_actionName__31-L2');

            if (actionNameElement) {
                this.createDisplayPanel();
                this.setupActionNameObserver(actionNameElement);
                this.updateDisplay();
            } else {
                // Not found, try again in 200ms
                setTimeout(() => this.waitForActionPanel(), 200);
            }
        }

        /**
         * Setup MutationObserver to watch action name changes
         * @param {HTMLElement} actionNameElement - The action name DOM element
         */
        setupActionNameObserver(actionNameElement) {
            // Watch for text content changes in the action name element
            this.actionNameObserver = new MutationObserver(() => {
                this.updateDisplay();
            });

            this.actionNameObserver.observe(actionNameElement, {
                childList: true,
                characterData: true,
                subtree: true
            });
        }

        /**
         * Create the display panel in the DOM
         */
        createDisplayPanel() {
            if (this.displayElement) {
                return; // Already created
            }

            // Find the action name container
            const actionNameContainer = document.querySelector('div.Header_actionName__31-L2');
            if (!actionNameContainer) {
                return;
            }

            // Create display element
            this.displayElement = document.createElement('div');
            this.displayElement.id = 'mwi-action-time-display';
            this.displayElement.style.cssText = `
            font-size: 0.9em;
            color: var(--text-color-secondary, #888);
            margin-top: 2px;
            line-height: 1.4;
            text-align: left;
        `;

            // Insert after action name
            actionNameContainer.parentNode.insertBefore(
                this.displayElement,
                actionNameContainer.nextSibling
            );

        }

        /**
         * Update the display with current action data
         */
        updateDisplay() {
            if (!this.displayElement) {
                return;
            }

            // Get current action - read from game UI which is always correct
            // The game updates the DOM immediately when actions change
            const actionNameElement = document.querySelector('div.Header_actionName__31-L2');
            if (!actionNameElement || !actionNameElement.textContent) {
                this.displayElement.innerHTML = '';
                return;
            }

            // Parse action name from DOM
            // Format can be: "Action Name (#123)", "Action Name (123)", "Action Name: Item (123)", etc.
            const actionNameText = actionNameElement.textContent.trim();

            // Extract inventory count from parentheses (e.g., "Coinify: Item (4312)" -> 4312)
            const inventoryCountMatch = actionNameText.match(/\((\d+)\)$/);
            const inventoryCount = inventoryCountMatch ? parseInt(inventoryCountMatch[1]) : null;

            // Find the matching action in cache
            const cachedActions = dataManager.getCurrentActions();
            let action;

            // Parse the action name, handling special formats like "Coinify: Item Name (count)"
            const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\(#?\d+\))?$/);
            const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

            // Check if this is a format like "Coinify: Item Name"
            let actionNameFromDom, itemNameFromDom;
            if (fullNameFromDom.includes(':')) {
                const parts = fullNameFromDom.split(':');
                actionNameFromDom = parts[0].trim();
                itemNameFromDom = parts.slice(1).join(':').trim(); // Handle multiple colons
            } else {
                actionNameFromDom = fullNameFromDom;
                itemNameFromDom = null;
            }

            // Match action from cache
            action = cachedActions.find(a => {
                const actionDetails = dataManager.getActionDetails(a.actionHrid);
                if (!actionDetails || actionDetails.name !== actionNameFromDom) {
                    return false;
                }

                // If there's an item name (like "Foraging Essence" from "Coinify: Foraging Essence"),
                // we need to match on primaryItemHash
                if (itemNameFromDom && a.primaryItemHash) {
                    // Convert display name to item HRID format (lowercase with underscores)
                    const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                    return a.primaryItemHash.includes(itemHrid);
                }

                // No item name specified, just match on action name
                return true;
            });

            if (!action) {
                this.displayElement.innerHTML = '';
                return;
            }

            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                return;
            }

            // Get character data
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

            // Calculate action time
            const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

            // Get equipment speed bonus
            const speedBonus = parseEquipmentSpeedBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate actual action time (speed only)
            const actionTime = baseTime / (1 + speedBonus);
            const actionsPerHour = 3600 / actionTime;

            // Calculate efficiency
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);
            const baseRequirement = actionDetails.levelRequirement?.level || 1;

            // Get drink concentration
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas
            const actionLevelBonus = parseActionLevelBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate efficiency components
            const effectiveRequirement = baseRequirement + actionLevelBonus;
            const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
            const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );
            const teaEfficiency = parseTeaEfficiency(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Total efficiency
            stackAdditive(
                levelEfficiency,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency
            );

            // Get queue size for display (total queued, doesn't change)
            // For infinite actions with inventory count, use that; otherwise use maxCount or Infinity
            let queueSizeDisplay;
            if (action.hasMaxCount) {
                queueSizeDisplay = action.maxCount;
            } else if (inventoryCount !== null) {
                queueSizeDisplay = inventoryCount;
            } else {
                queueSizeDisplay = Infinity;
            }

            // Get remaining actions for time calculation
            // For infinite actions, use inventory count if available
            let remainingActions;
            if (action.hasMaxCount) {
                remainingActions = action.maxCount - action.currentCount;
            } else if (inventoryCount !== null) {
                remainingActions = inventoryCount - action.currentCount;
            } else {
                remainingActions = Infinity;
            }

            // Calculate total time
            // Note: Efficiency does NOT reduce time - it only increases outputs
            // The queue count represents ACTIONS to perform, not outputs wanted
            const totalTimeSeconds = remainingActions * actionTime;

            // Calculate completion time
            const completionTime = new Date();
            completionTime.setSeconds(completionTime.getSeconds() + totalTimeSeconds);

            // Format time strings (timeReadable handles days/hours/minutes properly)
            const timeStr = timeReadable(totalTimeSeconds);

            // Format completion time
            const now = new Date();
            const isToday = completionTime.toDateString() === now.toDateString();

            let clockTime;
            if (isToday) {
                // Today: Just show time in 12-hour format
                clockTime = completionTime.toLocaleString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            } else {
                // Future date: Show date and time in 12-hour format
                clockTime = completionTime.toLocaleString('en-US', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            // Build display HTML
            const lines = [];

            // Action icon (SVG sprite, matches game's icon display)
            const skillType = actionDetails.type; // e.g., "/action_types/milking"
            if (skillType) {
                // Extract skill name from type (e.g., "/action_types/milking" → "milking")
                const skillName = skillType.replace('/action_types/', '');

                // Get sprite URL from existing game SVG (to get correct hash)
                const existingSvg = document.querySelector('svg[role="img"] use[href*="skills_sprite"]');
                if (existingSvg) {
                    const spriteUrl = existingSvg.getAttribute('href').split('#')[0]; // Get base URL with hash
                    lines.push(`<svg role="img" aria-label="Icon" class="Icon_icon__2LtL_ Icon_tiny__nLKFY Icon_inline__1Idwv" width="20px" height="20px" style="vertical-align: middle; margin-right: 4px;"><use href="${spriteUrl}#${skillName}"></use></svg>`);
                }
            }

            // Action info
            const actionName = actionDetails.name || 'Unknown Action';
            lines.push(`<span style="color: var(--text-color-primary, #fff);">${actionName}</span>`);

            // Queue size (with thousand separators)
            if (queueSizeDisplay !== Infinity) {
                lines.push(` <span style="color: var(--text-color-secondary, #888);">(${queueSizeDisplay.toLocaleString()} queued)</span>`);
            } else {
                lines.push(` <span style="color: var(--text-color-secondary, #888);">(∞)</span>`);
            }

            // Show time info if we have a finite number of remaining actions
            // This includes both finite actions (hasMaxCount) and infinite actions with inventory count
            if (remainingActions !== Infinity && !isNaN(remainingActions) && remainingActions > 0) {
                lines.push('<br>');

                // Time per action and actions/hour on same line (simplified - no percentages)
                lines.push(`<span style="color: var(--text-color-secondary, #888);">`);
                lines.push(`${actionTime.toFixed(2)}s/action · ${actionsPerHour.toFixed(0)}/hr`);
                lines.push('</span><br>');

                // Total time and completion time
                lines.push(`<span style="color: var(--text-color-primary, #fff);">`);
                lines.push(`⏱ ${timeStr} → ${clockTime}`);
                lines.push('</span>');
            }

            this.displayElement.innerHTML = lines.join('');
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            const skillHrid = skillType.replace('/action_types/', '/skills/');
            const skill = skills.find(s => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Calculate action time for a given action
         * @param {Object} actionDetails - Action details from data manager
         * @returns {Object} {actionTime, totalEfficiency} or null if calculation fails
         */
        calculateActionTime(actionDetails) {
            try {
                const equipment = dataManager.getEquipment();
                const skills = dataManager.getSkills();
                const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

                // Calculate base action time
                const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

                // Get equipment speed bonus
                const speedBonus = parseEquipmentSpeedBonuses(
                    equipment,
                    actionDetails.type,
                    itemDetailMap
                );

                // Calculate actual action time (speed only)
                const actionTime = baseTime / (1 + speedBonus);

                // Calculate efficiency for output calculations
                const skillLevel = this.getSkillLevel(skills, actionDetails.type);
                const baseRequirement = actionDetails.levelRequirement?.level || 1;

                // Get drink concentration
                const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

                // Get active drinks for this action type
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

                // Calculate Action Level bonus from teas
                const actionLevelBonus = parseActionLevelBonus(
                    activeDrinks,
                    itemDetailMap,
                    drinkConcentration
                );

                // Calculate efficiency components
                const effectiveRequirement = baseRequirement + actionLevelBonus;
                const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
                const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
                const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                    equipment,
                    actionDetails.type,
                    itemDetailMap
                );
                const teaEfficiency = parseTeaEfficiency(
                    actionDetails.type,
                    activeDrinks,
                    itemDetailMap,
                    drinkConcentration
                );

                // Total efficiency
                const totalEfficiency = stackAdditive(
                    levelEfficiency,
                    houseEfficiency,
                    equipmentEfficiency,
                    teaEfficiency
                );

                return { actionTime, totalEfficiency };
            } catch (error) {
                console.error('[MWI Tools] Error calculating action time:', error);
                return null;
            }
        }

        /**
         * Match an action from cache by reading its name from a queue div
         * @param {HTMLElement} actionDiv - The queue action div element
         * @param {Array} cachedActions - Array of actions from dataManager
         * @returns {Object|null} Matched action object or null
         */
        matchActionFromDiv(actionDiv, cachedActions) {
            // Find the action text element within the div
            const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
            if (!actionTextContainer) {
                return null;
            }

            // The first child div contains the action name: "#3 🧪 Coinify: Foraging Essence"
            const firstChildDiv = actionTextContainer.querySelector('[class*="QueuedActions_text__"]');
            if (!firstChildDiv) {
                return null;
            }

            // Get the text content (format: "#3Coinify: Foraging Essence" - no space after number!)
            const fullText = firstChildDiv.textContent.trim();

            // Remove position number: "#3Coinify: Foraging Essence" → "Coinify: Foraging Essence"
            // Note: No space after the number in the actual text
            const actionNameText = fullText.replace(/^#\d+/, '').trim();

            // Parse action name (same logic as main display)
            let actionNameFromDiv, itemNameFromDiv;
            if (actionNameText.includes(':')) {
                const parts = actionNameText.split(':');
                actionNameFromDiv = parts[0].trim();
                itemNameFromDiv = parts.slice(1).join(':').trim();
            } else {
                actionNameFromDiv = actionNameText;
                itemNameFromDiv = null;
            }

            // Match action from cache (same logic as main display)
            return cachedActions.find(a => {
                const actionDetails = dataManager.getActionDetails(a.actionHrid);
                if (!actionDetails || actionDetails.name !== actionNameFromDiv) {
                    return false;
                }

                // If there's an item name, match on primaryItemHash
                if (itemNameFromDiv && a.primaryItemHash) {
                    const itemHrid = '/items/' + itemNameFromDiv.toLowerCase().replace(/\s+/g, '_');
                    return a.primaryItemHash.includes(itemHrid);
                }

                return true;
            });
        }

        /**
         * Inject time display into queue tooltip
         * @param {HTMLElement} queueMenu - Queue menu container element
         */
        injectQueueTimes(queueMenu) {
            try {
                // Get all queued actions
                const currentActions = dataManager.getCurrentActions();
                if (!currentActions || currentActions.length === 0) {
                    return;
                }

                // Find all action divs in the queue (individual actions only, not wrapper or text containers)
                const actionDivs = queueMenu.querySelectorAll('[class^="QueuedActions_action__"]');
                if (actionDivs.length === 0) {
                    return;
                }

                // Clear all existing time displays to prevent duplicates
                queueMenu.querySelectorAll('.mwi-queue-action-time').forEach(el => el.remove());
                const existingTotal = document.querySelector('#mwi-queue-total-time');
                if (existingTotal) {
                    existingTotal.remove();
                }

                let accumulatedTime = 0;
                let hasInfinite = false;

                // First, calculate time for current action to include in total
                // Read from DOM to get the actual current action (not from cache)
                const actionNameElement = document.querySelector('div.Header_actionName__31-L2');
                if (actionNameElement && actionNameElement.textContent) {
                    const actionNameText = actionNameElement.textContent.trim();

                    // Parse action name (same logic as main display)
                    const actionNameMatch = actionNameText.match(/^(.+?)(?:\s*\(#?\d+\))?$/);
                    const fullNameFromDom = actionNameMatch ? actionNameMatch[1].trim() : actionNameText;

                    let actionNameFromDom, itemNameFromDom;
                    if (fullNameFromDom.includes(':')) {
                        const parts = fullNameFromDom.split(':');
                        actionNameFromDom = parts[0].trim();
                        itemNameFromDom = parts.slice(1).join(':').trim();
                    } else {
                        actionNameFromDom = fullNameFromDom;
                        itemNameFromDom = null;
                    }

                    // Match current action from cache
                    const currentAction = currentActions.find(a => {
                        const actionDetails = dataManager.getActionDetails(a.actionHrid);
                        if (!actionDetails || actionDetails.name !== actionNameFromDom) {
                            return false;
                        }

                        if (itemNameFromDom && a.primaryItemHash) {
                            const itemHrid = '/items/' + itemNameFromDom.toLowerCase().replace(/\s+/g, '_');
                            return a.primaryItemHash.includes(itemHrid);
                        }

                        return true;
                    });

                    if (currentAction) {
                        const actionDetails = dataManager.getActionDetails(currentAction.actionHrid);
                        if (actionDetails) {
                            // Check if infinite BEFORE calculating count
                            const isInfinite = !currentAction.hasMaxCount || currentAction.actionHrid.includes('/combat/');

                            if (isInfinite) {
                                hasInfinite = true;
                            } else {
                                const count = currentAction.maxCount - currentAction.currentCount;
                                const timeData = this.calculateActionTime(actionDetails);
                                if (timeData) {
                                    const { actionTime } = timeData;
                                    const totalTime = count * actionTime;
                                    accumulatedTime += totalTime;
                                }
                            }
                        }
                    }
                }

                // Now process queued actions by reading from each div
                // Each div shows a queued action, and we match it to cache by name
                for (let divIndex = 0; divIndex < actionDivs.length; divIndex++) {
                    const actionDiv = actionDivs[divIndex];

                    // Match this div's action from the cache
                    const actionObj = this.matchActionFromDiv(actionDiv, currentActions);

                    if (!actionObj) {
                        // Could not match action - show unknown
                        const timeDiv = document.createElement('div');
                        timeDiv.className = 'mwi-queue-action-time';
                        timeDiv.style.cssText = `
                        color: var(--text-color-secondary, #888);
                        font-size: 0.85em;
                        margin-top: 2px;
                    `;
                        timeDiv.textContent = '[Unknown action]';

                        const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                        if (actionTextContainer) {
                            actionTextContainer.appendChild(timeDiv);
                        } else {
                            actionDiv.appendChild(timeDiv);
                        }

                        continue;
                    }

                    const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);
                    if (!actionDetails) {
                        console.warn('[Action Time Display] Unknown queued action:', actionObj.actionHrid);
                        continue;
                    }

                    // Check if infinite BEFORE calculating count
                    const isInfinite = !actionObj.hasMaxCount || actionObj.actionHrid.includes('/combat/');

                    if (isInfinite) {
                        hasInfinite = true;
                    }

                    // Only calculate count for finite actions
                    let count = 0;
                    if (!isInfinite) {
                        count = actionObj.maxCount - actionObj.currentCount;
                    }

                    // Calculate action time
                    const timeData = this.calculateActionTime(actionDetails);
                    if (!timeData) continue;

                    const { actionTime } = timeData;

                    // Calculate total time for this action
                    // Efficiency doesn't affect time - queue count is ACTIONS, not outputs
                    let totalTime;
                    if (isInfinite) {
                        totalTime = Infinity;
                    } else {
                        totalTime = count * actionTime;
                        accumulatedTime += totalTime;
                    }

                    // Format completion time
                    let completionText = '';
                    if (!hasInfinite && !isInfinite) {
                        const completionDate = new Date();
                        completionDate.setSeconds(completionDate.getSeconds() + accumulatedTime);

                        const hours = String(completionDate.getHours()).padStart(2, '0');
                        const minutes = String(completionDate.getMinutes()).padStart(2, '0');
                        const seconds = String(completionDate.getSeconds()).padStart(2, '0');

                        completionText = ` Complete at ${hours}:${minutes}:${seconds}`;
                    }

                    // Create time display element
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'mwi-queue-action-time';
                    timeDiv.style.cssText = `
                    color: var(--text-color-secondary, #888);
                    font-size: 0.85em;
                    margin-top: 2px;
                `;

                    if (isInfinite) {
                        timeDiv.textContent = '[∞]';
                    } else {
                        const timeStr = timeReadable(totalTime);
                        timeDiv.textContent = `[${timeStr}]${completionText}`;
                    }

                    // Find the actionText container and append inside it
                    const actionTextContainer = actionDiv.querySelector('[class*="QueuedActions_actionText"]');
                    if (actionTextContainer) {
                        actionTextContainer.appendChild(timeDiv);
                    } else {
                        // Fallback: append to action div
                        actionDiv.appendChild(timeDiv);
                    }
                }

                // Add total time at bottom (includes current action + all queued)
                const totalDiv = document.createElement('div');
                totalDiv.id = 'mwi-queue-total-time';
                totalDiv.style.cssText = `
                color: var(--text-color-primary, #fff);
                font-weight: bold;
                margin-top: 12px;
                padding: 8px;
                border-top: 1px solid var(--border-color, #444);
                text-align: center;
            `;

                if (hasInfinite) {
                    totalDiv.textContent = 'Total time: [∞]';
                } else {
                    totalDiv.textContent = `Total time: [${timeReadable(accumulatedTime)}]`;
                }

                // Insert after queue menu
                queueMenu.insertAdjacentElement('afterend', totalDiv);

            } catch (error) {
                console.error('[MWI Tools] Error injecting queue times:', error);
            }
        }

        /**
         * Disable the action time display (cleanup)
         */
        disable() {
            // Disconnect action name observer
            if (this.actionNameObserver) {
                this.actionNameObserver.disconnect();
                this.actionNameObserver = null;
            }

            // Disconnect queue menu observer
            if (this.queueMenuObserver) {
                this.queueMenuObserver.disconnect();
                this.queueMenuObserver = null;
            }

            // Unregister queue observer
            if (this.unregisterQueueObserver) {
                this.unregisterQueueObserver();
                this.unregisterQueueObserver = null;
            }

            // Unregister character switch handler
            if (this.characterInitHandler) {
                dataManager.off('character_initialized', this.characterInitHandler);
                this.characterInitHandler = null;
            }

            // Clear update timer
            if (this.updateTimer) {
                clearInterval(this.updateTimer);
                this.updateTimer = null;
            }

            // Remove display element
            if (this.displayElement && this.displayElement.parentNode) {
                this.displayElement.parentNode.removeChild(this.displayElement);
                this.displayElement = null;
            }

            this.isInitialized = false;
        }
    }

    // Create and export singleton instance
    const actionTimeDisplay = new ActionTimeDisplay();

    /**
     * Experience Parser Utility
     * Parses wisdom and experience bonuses from all sources
     *
     * Experience Formula (Skilling):
     * Final XP = Base XP × (1 + Wisdom + Charm Experience)
     *
     * Where Wisdom and Charm Experience are ADDITIVE
     */


    /**
     * Parse equipment wisdom bonus (skillingExperience stat)
     * @param {Map} equipment - Character equipment map
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {number} Wisdom percentage (e.g., 10 for 10%)
     */
    function parseEquipmentWisdom(equipment, itemDetailMap) {
        let totalWisdom = 0;

        for (const [slot, item] of equipment) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail) continue;

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
            const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

            // Get base skillingExperience
            const baseWisdom = noncombatStats.skillingExperience || 0;
            if (baseWisdom === 0) continue;

            // Get enhancement scaling
            const enhancementBonus = noncombatEnhancement.skillingExperience || 0;
            const enhancementLevel = item.enhancementLevel || 0;

            // Determine multiplier based on slot (5× for accessories, 1× for armor)
            const accessorySlots = [
                '/equipment_types/neck',
                '/equipment_types/ring',
                '/equipment_types/earrings',
                '/equipment_types/back',
                '/equipment_types/trinket',
                '/equipment_types/charm'
            ];
            const multiplier = accessorySlots.includes(itemDetails.equipmentDetail.type) ? 5 : 1;

            // Calculate total wisdom from this item
            const itemWisdom = (baseWisdom + (enhancementBonus * enhancementLevel * multiplier)) * 100;
            totalWisdom += itemWisdom;
        }

        return totalWisdom;
    }

    /**
     * Parse skill-specific charm experience (e.g., foragingExperience)
     * @param {Map} equipment - Character equipment map
     * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {Object} {total: number, breakdown: Array} Total charm XP and item breakdown
     */
    function parseCharmExperience(equipment, skillHrid, itemDetailMap) {
        let totalCharmXP = 0;
        const breakdown = [];

        // Convert skill HRID to stat name (e.g., "/skills/foraging" → "foragingExperience")
        const skillName = skillHrid.replace('/skills/', '');
        const statName = `${skillName}Experience`;

        for (const [slot, item] of equipment) {
            const itemDetails = itemDetailMap[item.itemHrid];
            if (!itemDetails?.equipmentDetail) continue;

            const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
            const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};

            // Get base charm experience
            const baseCharmXP = noncombatStats[statName] || 0;
            if (baseCharmXP === 0) continue;

            // Get enhancement scaling
            const enhancementBonus = noncombatEnhancement[statName] || 0;
            const enhancementLevel = item.enhancementLevel || 0;

            // Determine multiplier based on slot (5× for accessories/charms, 1× for armor)
            const accessorySlots = [
                '/equipment_types/neck',
                '/equipment_types/ring',
                '/equipment_types/earrings',
                '/equipment_types/back',
                '/equipment_types/trinket',
                '/equipment_types/charm'
            ];
            const multiplier = accessorySlots.includes(itemDetails.equipmentDetail.type) ? 5 : 1;

            // Calculate total charm XP from this item
            const itemCharmXP = (baseCharmXP + (enhancementBonus * enhancementLevel * multiplier)) * 100;
            totalCharmXP += itemCharmXP;

            // Add to breakdown
            breakdown.push({
                name: itemDetails.name,
                value: itemCharmXP,
                enhancementLevel: enhancementLevel
            });
        }

        return {
            total: totalCharmXP,
            breakdown: breakdown
        };
    }

    /**
     * Parse house room wisdom bonus
     * All house rooms provide +0.05% wisdom per level
     * @returns {number} Total wisdom from house rooms (e.g., 0.4 for 8 total levels)
     */
    function parseHouseRoomWisdom() {
        const houseRooms = dataManager.getHouseRooms();
        if (!houseRooms || houseRooms.size === 0) {
            return 0;
        }

        // Sum all house room levels
        let totalLevels = 0;
        for (const [hrid, room] of houseRooms) {
            totalLevels += room.level || 0;
        }

        // Formula: totalLevels × 0.05% per level
        return totalLevels * 0.05;
    }

    /**
     * Parse community buff wisdom bonus
     * Formula: 20% + ((level - 1) × 0.5%)
     * @returns {number} Wisdom percentage from community buff (e.g., 29.5 for T20)
     */
    function parseCommunityBuffWisdom() {
        const buffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
        if (!buffLevel) {
            return 0;
        }

        // Formula: 20% base + 0.5% per level above 1
        return 20 + ((buffLevel - 1) * 0.5);
    }

    /**
     * Parse wisdom from active consumables (Wisdom Tea/Coffee)
     * @param {Array} drinkSlots - Active drink slots for the action type
     * @param {Object} itemDetailMap - Item details from game data
     * @param {number} drinkConcentration - Drink concentration bonus (e.g., 12.16 for 12.16%)
     * @returns {number} Wisdom percentage from consumables (e.g., 13.46 for 12% × 1.1216)
     */
    function parseConsumableWisdom(drinkSlots, itemDetailMap, drinkConcentration) {
        if (!drinkSlots || drinkSlots.length === 0) {
            return 0;
        }

        let totalWisdom = 0;

        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue; // Skip empty slots

            const itemDetails = itemDetailMap[drink.itemHrid];
            if (!itemDetails?.consumableDetail) continue;

            // Check for wisdom buff (skillingExperience)
            const buffs = itemDetails.consumableDetail.buffs || [];
            for (const buff of buffs) {
                if (buff.flatBoost?.skillingExperience) {
                    // Base wisdom (e.g., 0.12 for 12%)
                    const baseWisdom = buff.flatBoost.skillingExperience * 100;

                    // Scale with drink concentration
                    const scaledWisdom = baseWisdom * (1 + drinkConcentration / 100);

                    totalWisdom += scaledWisdom;
                }
            }
        }

        return totalWisdom;
    }

    /**
     * Calculate total experience multiplier and breakdown
     * @param {string} skillHrid - Skill HRID (e.g., "/skills/foraging")
     * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
     * @returns {Object} Experience data with breakdown
     */
    function calculateExperienceMultiplier(skillHrid, actionTypeHrid) {
        const equipment = dataManager.getEquipment();
        const gameData = dataManager.getInitClientData();
        const itemDetailMap = gameData?.itemDetailMap || {};

        // Get drink concentration
        const drinkConcentration = equipment ? calculateDrinkConcentration(equipment, itemDetailMap) : 0;

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);

        // Parse wisdom from all sources
        const equipmentWisdom = parseEquipmentWisdom(equipment, itemDetailMap);
        const houseWisdom = parseHouseRoomWisdom();
        const communityWisdom = parseCommunityBuffWisdom();
        const consumableWisdom = parseConsumableWisdom(activeDrinks, itemDetailMap, drinkConcentration);

        const totalWisdom = equipmentWisdom + houseWisdom + communityWisdom + consumableWisdom;

        // Parse charm experience (skill-specific) - now returns object with total and breakdown
        const charmData = parseCharmExperience(equipment, skillHrid, itemDetailMap);
        const charmExperience = charmData.total;

        // Total multiplier (additive)
        const totalMultiplier = 1 + (totalWisdom / 100) + (charmExperience / 100);

        return {
            totalMultiplier,
            totalWisdom,
            charmExperience,
            charmBreakdown: charmData.breakdown,
            breakdown: {
                equipmentWisdom,
                houseWisdom,
                communityWisdom,
                consumableWisdom,
                charmExperience
            }
        };
    }

    /**
     * Calculate drink concentration from Guzzling Pouch
     * @param {Map} equipment - Character equipment map
     * @param {Object} itemDetailMap - Item details from game data
     * @returns {number} Drink concentration percentage (e.g., 12.16 for 12.16%)
     */
    function calculateDrinkConcentration(equipment, itemDetailMap) {
        // Find Guzzling Pouch in equipment
        const pouchItem = equipment.get('/equipment_types/pouch');
        if (!pouchItem || !pouchItem.itemHrid.includes('guzzling_pouch')) {
            return 0;
        }

        const itemDetails = itemDetailMap[pouchItem.itemHrid];
        if (!itemDetails?.equipmentDetail) {
            return 0;
        }

        // Get base drink concentration
        const noncombatStats = itemDetails.equipmentDetail.noncombatStats || {};
        const baseDrinkConcentration = noncombatStats.drinkConcentration || 0;

        if (baseDrinkConcentration === 0) {
            return 0;
        }

        // Get enhancement scaling (pouch is armor slot, 1× multiplier)
        const noncombatEnhancement = itemDetails.equipmentDetail.noncombatEnhancementBonuses || {};
        const enhancementBonus = noncombatEnhancement.drinkConcentration || 0;
        const enhancementLevel = pouchItem.enhancementLevel || 0;

        // Calculate total (1× multiplier for pouch)
        return (baseDrinkConcentration + (enhancementBonus * enhancementLevel)) * 100;
    }

    /**
     * Quick Input Buttons Module
     *
     * Adds quick action buttons (10, 100, 1000, Max) to action panels
     * for fast queue input without manual typing.
     *
     * Features:
     * - Preset buttons: 10, 100, 1000
     * - Max button (fills to maximum inventory amount)
     * - Works on all action panels (gathering, production, combat)
     * - Uses React's internal _valueTracker for proper state updates
     * - Auto-detects input fields and injects buttons
     */


    /**
     * QuickInputButtons class manages quick input button injection
     */
    class QuickInputButtons {
        constructor() {
            this.isInitialized = false;
            this.observer = null;
            this.presetHours = [0.5, 1, 2, 3, 4, 5, 6, 10, 12, 24];
            this.presetValues = [10, 100, 1000];
        }

        /**
         * Initialize the quick input buttons feature
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            // Start observing for action panels
            this.startObserving();
            this.isInitialized = true;
        }

        /**
         * Start MutationObserver to detect action panels
         */
        startObserving() {
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        // Look for main action detail panel (not sub-elements)
                        const actionPanel = node.querySelector?.('[class*="SkillActionDetail_skillActionDetail"]');
                        if (actionPanel) {
                            this.injectButtons(actionPanel);
                        } else if (node.className && typeof node.className === 'string' &&
                                   node.className.includes('SkillActionDetail_skillActionDetail')) {
                            this.injectButtons(node);
                        }
                    }
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        /**
         * Inject quick input buttons into action panel
         * @param {HTMLElement} panel - Action panel element
         */
        injectButtons(panel) {
            try {
                // Check if already injected
                if (panel.querySelector('.mwi-collapsible-section')) {
                    return;
                }

                // Cache game data once for all method calls
                const gameData = dataManager.getInitClientData();
                if (!gameData) {
                    return;
                }

                // Find the number input field
                let numberInput = panel.querySelector('input[type="number"]');
                if (!numberInput) {
                    // Try finding input within maxActionCountInput container
                    const inputContainer = panel.querySelector('[class*="maxActionCountInput"]');
                    if (inputContainer) {
                        numberInput = inputContainer.querySelector('input');
                    }
                }
                if (!numberInput) {
                    return;
                }

                // Get action details for time-based calculations
                const actionNameElement = panel.querySelector('[class*="SkillActionDetail_name"]');
                if (!actionNameElement) {
                    return;
                }

                const actionName = actionNameElement.textContent.trim();
                const actionDetails = this.getActionDetailsByName(actionName, gameData);
                if (!actionDetails) {
                    return;
                }

                // Calculate action duration and efficiency
                const { actionTime, totalEfficiency, efficiencyBreakdown } = this.calculateActionMetrics(actionDetails, gameData);
                const efficiencyMultiplier = 1 + (totalEfficiency / 100);

                // Find the container to insert after (same as original MWI Tools)
                const inputContainer = numberInput.parentNode.parentNode.parentNode;
                if (!inputContainer) {
                    return;
                }

                // Get equipment details for display
                const equipment = dataManager.getEquipment();
                const itemDetailMap = gameData.itemDetailMap || {};

                // Calculate speed breakdown
                const baseTime = actionDetails.baseTimeCost / 1e9;
                const speedBonus = parseEquipmentSpeedBonuses(
                    equipment,
                    actionDetails.type,
                    itemDetailMap
                );

                // ===== SECTION 1: Action Speed & Time =====
                const speedContent = document.createElement('div');
                speedContent.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const speedLines = [];
                speedLines.push(`Base: ${baseTime.toFixed(2)}s → ${actionTime.toFixed(2)}s`);
                if (speedBonus > 0) {
                    speedLines.push(`Speed: +${(speedBonus * 100).toFixed(1)}% | ${(3600 / actionTime).toFixed(0)}/hr`);
                } else {
                    speedLines.push(`${(3600 / actionTime).toFixed(0)}/hr`);
                }

                // Add Efficiency breakdown
                speedLines.push(''); // Empty line
                speedLines.push(`<span style="font-weight: 500; color: var(--text-color-primary, #fff);">Efficiency: +${totalEfficiency.toFixed(1)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${Math.round((3600 / actionTime) * efficiencyMultiplier)}/hr)</span>`);

                // Detailed efficiency breakdown
                if (efficiencyBreakdown.levelEfficiency > 0 || (efficiencyBreakdown.actionLevelBreakdown && efficiencyBreakdown.actionLevelBreakdown.length > 0)) {
                    // Calculate raw level delta (before any Action Level bonuses)
                    const rawLevelDelta = efficiencyBreakdown.skillLevel - efficiencyBreakdown.baseRequirement;

                    // Show final level efficiency
                    speedLines.push(`  - Level: +${efficiencyBreakdown.levelEfficiency.toFixed(1)}%`);

                    // Show raw level delta (what you'd get without Action Level bonuses)
                    speedLines.push(`    - Raw level delta: +${rawLevelDelta.toFixed(1)}% (${efficiencyBreakdown.skillLevel} - ${efficiencyBreakdown.baseRequirement} base requirement)`);

                    // Show Action Level bonus teas that reduce level efficiency
                    if (efficiencyBreakdown.actionLevelBreakdown && efficiencyBreakdown.actionLevelBreakdown.length > 0) {
                        for (const tea of efficiencyBreakdown.actionLevelBreakdown) {
                            // Calculate impact: base tea effect reduces efficiency
                            const baseTeaImpact = -tea.baseActionLevel;
                            speedLines.push(`    - ${tea.name} impact: ${baseTeaImpact.toFixed(1)}% (raises requirement)`);

                            // Show DC contribution as additional reduction if > 0
                            if (tea.dcContribution > 0) {
                                const dcImpact = -tea.dcContribution;
                                speedLines.push(`      - Drink Concentration: ${dcImpact.toFixed(1)}%`);
                            }
                        }
                    }
                }
                if (efficiencyBreakdown.houseEfficiency > 0) {
                    // Get house room name
                    const houseRoomName = this.getHouseRoomName(actionDetails.type);
                    speedLines.push(`  - House: +${efficiencyBreakdown.houseEfficiency.toFixed(1)}% (${houseRoomName})`);
                }
                if (efficiencyBreakdown.equipmentEfficiency > 0) {
                    speedLines.push(`  - Equipment: +${efficiencyBreakdown.equipmentEfficiency.toFixed(1)}%`);
                }
                // Break out individual teas - show BASE efficiency on main line, DC as sub-line
                if (efficiencyBreakdown.teaBreakdown && efficiencyBreakdown.teaBreakdown.length > 0) {
                    for (const tea of efficiencyBreakdown.teaBreakdown) {
                        // Show BASE efficiency (without DC scaling) on main line
                        speedLines.push(`  - ${tea.name}: +${tea.baseEfficiency.toFixed(1)}%`);
                        // Show DC contribution as sub-line if > 0
                        if (tea.dcContribution > 0) {
                            speedLines.push(`    - Drink Concentration: +${tea.dcContribution.toFixed(1)}%`);
                        }
                    }
                }
                if (efficiencyBreakdown.communityEfficiency > 0) {
                    const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
                    speedLines.push(`  - Community: +${efficiencyBreakdown.communityEfficiency.toFixed(1)}% (Production Efficiency T${communityBuffLevel})`);
                }

                // Total time (dynamic)
                const totalTimeLine = document.createElement('div');
                totalTimeLine.style.cssText = `
                color: var(--text-color-main, #6fb8e8);
                font-weight: 500;
                margin-top: 4px;
            `;

                const updateTotalTime = () => {
                    const inputValue = numberInput.value;

                    if (inputValue === '∞') {
                        totalTimeLine.textContent = 'Total time: ∞';
                        return;
                    }

                    const queueCount = parseInt(inputValue) || 0;
                    if (queueCount > 0) {
                        // Input is number of ACTIONS, not items
                        // Total time = actions × time per action
                        const totalSeconds = queueCount * actionTime;
                        totalTimeLine.textContent = `Total time: ${timeReadable(totalSeconds)}`;
                    } else {
                        totalTimeLine.textContent = 'Total time: 0s';
                    }
                };

                speedLines.push(''); // Empty line before total time
                speedContent.innerHTML = speedLines.join('<br>');
                speedContent.appendChild(totalTimeLine);

                // Initial update
                updateTotalTime();

                // Watch for input changes
                const inputObserver = new MutationObserver(() => {
                    updateTotalTime();
                });

                inputObserver.observe(numberInput, {
                    attributes: true,
                    attributeFilter: ['value']
                });

                numberInput.addEventListener('input', updateTotalTime);
                numberInput.addEventListener('change', updateTotalTime);
                panel.addEventListener('click', () => {
                    setTimeout(updateTotalTime, 50);
                });

                // Create initial summary for Action Speed & Time
                const actionsPerHour = (3600 / actionTime).toFixed(0);
                const initialSummary = `${actionsPerHour}/hr | Total time: 0s`;

                const speedSection = createCollapsibleSection(
                    '⏱',
                    'Action Speed & Time',
                    initialSummary,
                    speedContent,
                    false // Collapsed by default
                );

                // Get the summary div to update it dynamically
                const speedSummaryDiv = speedSection.querySelector('.mwi-section-header + div');

                // Enhanced updateTotalTime to also update the summary
                const originalUpdateTotalTime = updateTotalTime;
                const enhancedUpdateTotalTime = () => {
                    originalUpdateTotalTime();

                    // Update summary when collapsed
                    if (speedSummaryDiv) {
                        const inputValue = numberInput.value;
                        if (inputValue === '∞') {
                            speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: ∞`;
                        } else {
                            const queueCount = parseInt(inputValue) || 0;
                            if (queueCount > 0) {
                                const totalSeconds = queueCount * actionTime;
                                speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: ${timeReadable(totalSeconds)}`;
                            } else {
                                speedSummaryDiv.textContent = `${actionsPerHour}/hr | Total time: 0s`;
                            }
                        }
                    }
                };

                // Replace all updateTotalTime calls with enhanced version
                inputObserver.disconnect();
                inputObserver.observe(numberInput, {
                    attributes: true,
                    attributeFilter: ['value']
                });

                const newInputObserver = new MutationObserver(() => {
                    enhancedUpdateTotalTime();
                });
                newInputObserver.observe(numberInput, {
                    attributes: true,
                    attributeFilter: ['value']
                });

                numberInput.removeEventListener('input', updateTotalTime);
                numberInput.removeEventListener('change', updateTotalTime);
                numberInput.addEventListener('input', enhancedUpdateTotalTime);
                numberInput.addEventListener('change', enhancedUpdateTotalTime);

                panel.removeEventListener('click', () => {
                    setTimeout(updateTotalTime, 50);
                });
                panel.addEventListener('click', () => {
                    setTimeout(enhancedUpdateTotalTime, 50);
                });

                // Initial update with enhanced version
                enhancedUpdateTotalTime();

                // ===== SECTION 2: Level Progress =====
                const levelProgressSection = this.createLevelProgressSection(
                    actionDetails,
                    actionTime,
                    gameData
                );

                // ===== SECTION 3: Quick Queue Setup =====
                const queueContent = document.createElement('div');
                queueContent.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                margin-top: 8px;
                margin-bottom: 8px;
            `;

                // FIRST ROW: Time-based buttons (hours)
                queueContent.appendChild(document.createTextNode('Do '));

                this.presetHours.forEach(hours => {
                    const button = this.createButton(hours === 0.5 ? '0.5' : hours.toString(), () => {
                        // How many actions fit in X hours?
                        // Time (seconds) = hours × 3600
                        // Actions = Time / actionTime
                        const actionCount = Math.round((hours * 60 * 60) / actionTime);
                        this.setInputValue(numberInput, actionCount);
                    });
                    queueContent.appendChild(button);
                });

                queueContent.appendChild(document.createTextNode(' hours'));
                queueContent.appendChild(document.createElement('div')); // Line break

                // SECOND ROW: Count-based buttons (times)
                queueContent.appendChild(document.createTextNode('Do '));

                this.presetValues.forEach(value => {
                    const button = this.createButton(value.toLocaleString(), () => {
                        this.setInputValue(numberInput, value);
                    });
                    queueContent.appendChild(button);
                });

                const maxButton = this.createButton('Max', () => {
                    const maxValue = this.calculateMaxValue(panel, actionDetails, gameData);
                    // Handle both infinity symbol and numeric values
                    if (maxValue === '∞' || maxValue > 0) {
                        this.setInputValue(numberInput, maxValue);
                    }
                });
                queueContent.appendChild(maxButton);

                queueContent.appendChild(document.createTextNode(' times'));

                // Insert sections: inputContainer -> queueContent -> speedSection -> levelProgressSection
                inputContainer.insertAdjacentElement('afterend', queueContent);
                queueContent.insertAdjacentElement('afterend', speedSection);
                if (levelProgressSection) {
                    speedSection.insertAdjacentElement('afterend', levelProgressSection);
                }

            } catch (error) {
                console.error('[MWI Tools] Error injecting quick input buttons:', error);
            }
        }

        /**
         * Get action details by name
         * @param {string} actionName - Display name of the action
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {Object|null} Action details or null if not found
         */
        getActionDetailsByName(actionName, gameData) {
            const actionDetailMap = gameData?.actionDetailMap;
            if (!actionDetailMap) {
                return null;
            }

            // Find action by matching name
            for (const [hrid, details] of Object.entries(actionDetailMap)) {
                if (details.name === actionName) {
                    return details;
                }
            }

            return null;
        }

        /**
         * Calculate action time and efficiency for current character state
         * @param {Object} actionDetails - Action details from game data
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {Object} {actionTime, totalEfficiency, efficiencyBreakdown}
         */
        calculateActionMetrics(actionDetails, gameData) {
            const equipment = dataManager.getEquipment();
            const skills = dataManager.getSkills();
            const itemDetailMap = gameData?.itemDetailMap || {};

            // Calculate base action time
            const baseTime = actionDetails.baseTimeCost / 1e9; // nanoseconds to seconds

            // Get equipment speed bonus
            const speedBonus = parseEquipmentSpeedBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate actual action time (with speed)
            const actionTime = baseTime / (1 + speedBonus);

            // Calculate efficiency
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);
            const baseRequirement = actionDetails.levelRequirement?.level || 1;

            // Get drink concentration
            const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas
            const actionLevelBonus = parseActionLevelBonus(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Get Action Level bonus breakdown (individual teas)
            const actionLevelBreakdown = parseActionLevelBonusBreakdown(
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate efficiency components
            // Action Level bonuses scale with DC but get floored (can't have fractional level requirements)
            const effectiveRequirement = baseRequirement + Math.floor(actionLevelBonus);
            const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
            const houseEfficiency = calculateHouseEfficiency(actionDetails.type);
            const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
                equipment,
                actionDetails.type,
                itemDetailMap
            );

            // Get tea efficiency breakdown (individual teas)
            const teaBreakdown = parseTeaEfficiencyBreakdown(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );
            const teaEfficiency = teaBreakdown.reduce((sum, tea) => sum + tea.efficiency, 0);

            // Get community buff efficiency
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = communityBuffLevel ? (0.14 + ((communityBuffLevel - 1) * 0.003)) * 100 : 0;

            // Total efficiency
            const totalEfficiency = stackAdditive(
                levelEfficiency,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency
            );

            // Return with breakdown
            return {
                actionTime,
                totalEfficiency,
                efficiencyBreakdown: {
                    levelEfficiency,
                    houseEfficiency,
                    equipmentEfficiency,
                    teaEfficiency,
                    teaBreakdown, // Individual tea contributions
                    communityEfficiency,
                    skillLevel,
                    baseRequirement,
                    actionLevelBonus,
                    actionLevelBreakdown, // Individual Action Level bonus teas
                    effectiveRequirement
                }
            };
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            const skillHrid = skillType.replace('/action_types/', '/skills/');
            const skill = skills.find(s => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Get house room name for an action type
         * @param {string} actionType - Action type HRID
         * @returns {string} House room name with level
         */
        getHouseRoomName(actionType) {
            const houseRooms = dataManager.getHouseRooms();
            const roomMapping = {
                '/action_types/cheesesmithing': '/house_rooms/forge',
                '/action_types/cooking': '/house_rooms/kitchen',
                '/action_types/crafting': '/house_rooms/workshop',
                '/action_types/foraging': '/house_rooms/garden',
                '/action_types/milking': '/house_rooms/dairy_barn',
                '/action_types/tailoring': '/house_rooms/sewing_parlor',
                '/action_types/woodcutting': '/house_rooms/log_shed',
                '/action_types/brewing': '/house_rooms/brewery'
            };

            const roomHrid = roomMapping[actionType];
            if (!roomHrid) return 'Unknown Room';

            const room = houseRooms.get(roomHrid);
            const roomName = roomHrid.split('/').pop().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const level = room?.level || 0;

            return `${roomName} level ${level}`;
        }

        /**
         * Create a quick input button
         * @param {string} label - Button label
         * @param {Function} onClick - Click handler
         * @returns {HTMLElement} Button element
         */
        createButton(label, onClick) {
            const button = document.createElement('button');
            button.textContent = label;
            button.className = 'mwi-quick-input-btn';
            button.style.cssText = `
            background-color: white;
            color: black;
            padding: 1px 6px;
            margin: 1px;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        `;

            // Hover effect
            button.addEventListener('mouseenter', () => {
                button.style.backgroundColor = '#f0f0f0';
            });
            button.addEventListener('mouseleave', () => {
                button.style.backgroundColor = 'white';
            });

            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });

            return button;
        }

        /**
         * Set input value using React's internal _valueTracker
         * This is the critical "hack" to make React recognize the change
         * @param {HTMLInputElement} input - Number input element
         * @param {number} value - Value to set
         */
        setInputValue(input, value) {
            // Save the current value
            const lastValue = input.value;

            // Set the new value directly on the DOM
            input.value = value;

            // Create input event
            const event = new Event('input', { bubbles: true });
            event.simulated = true;

            // This is the critical part: React stores an internal _valueTracker
            // We need to set it to the old value before dispatching the event
            // so React sees the difference and updates its state
            const tracker = input._valueTracker;
            if (tracker) {
                tracker.setValue(lastValue);
            }

            // Dispatch the event - React will now recognize the change
            input.dispatchEvent(event);

            // Focus the input to show the value
            input.focus();
        }

        /**
         * Calculate maximum possible value based on inventory
         * @param {HTMLElement} panel - Action panel element
         * @param {Object} actionDetails - Action details from game data
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {number|string} Maximum value (number for production, '∞' for gathering)
         */
        calculateMaxValue(panel, actionDetails, gameData) {
            try {
                // Gathering actions (no materials needed) - return infinity symbol
                if (!actionDetails.inputItems && !actionDetails.upgradeItemHrid) {
                    return '∞';
                }

                // Production actions - calculate based on available materials
                const inventory = dataManager.getInventory();
                if (!inventory) {
                    return 0; // No inventory data available
                }

                // Get Artisan Tea reduction if active
                const equipment = dataManager.getEquipment();
                const itemDetailMap = gameData?.itemDetailMap || {};
                const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
                const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
                const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

                let maxActions = Infinity;

                // Check upgrade item first (e.g., Crimson Staff → Azure Staff)
                if (actionDetails.upgradeItemHrid) {
                    // Upgrade recipes require base item (enhancement level 0)
                    const upgradeItem = inventory.find(item =>
                        item.itemHrid === actionDetails.upgradeItemHrid &&
                        item.enhancementLevel === 0
                    );
                    const availableAmount = upgradeItem?.count || 0;
                    const baseRequirement = 1; // Upgrade items always require exactly 1

                    // Apply Artisan reduction using expected value (average over many actions)
                    const effectiveRequirement = baseRequirement * (1 - artisanBonus);

                    if (effectiveRequirement > 0) {
                        const possibleActions = Math.floor(availableAmount / effectiveRequirement);
                        maxActions = Math.min(maxActions, possibleActions);
                    }
                }

                // Check regular input items (materials like lumber, etc.)
                if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                    for (const input of actionDetails.inputItems) {
                        // Find ALL items with this HRID (different enhancement levels stack separately)
                        const allMatchingItems = inventory.filter(item => item.itemHrid === input.itemHrid);

                        // Sum up counts across all enhancement levels
                        const availableAmount = allMatchingItems.reduce((total, item) => total + (item.count || 0), 0);
                        const baseRequirement = input.count;

                        // Apply Artisan reduction using expected value (average over many actions)
                        const effectiveRequirement = baseRequirement * (1 - artisanBonus);

                        if (effectiveRequirement > 0) {
                            const possibleActions = Math.floor(availableAmount / effectiveRequirement);
                            maxActions = Math.min(maxActions, possibleActions);
                        }
                    }
                }

                // If we couldn't calculate (no materials found), return 0
                // Otherwise return the calculated max (no artificial cap)
                return maxActions === Infinity ? 0 : maxActions;
            } catch (error) {
                console.error('[MWI Tools] Error calculating max value:', error);
                return 10000; // Safe fallback on error
            }
        }

        /**
         * Create level progress section
         * @param {Object} actionDetails - Action details from game data
         * @param {number} actionTime - Time per action in seconds
         * @param {Object} gameData - Cached game data from dataManager
         * @returns {HTMLElement|null} Level progress section or null if not applicable
         */
        createLevelProgressSection(actionDetails, actionTime, gameData) {
            try {
                // Get XP information from action
                const experienceGain = actionDetails.experienceGain;
                if (!experienceGain || !experienceGain.skillHrid || experienceGain.value <= 0) {
                    return null; // No XP gain for this action
                }

                const skillHrid = experienceGain.skillHrid;
                const xpPerAction = experienceGain.value;

                // Get character skills
                const skills = dataManager.getSkills();
                if (!skills) {
                    return null;
                }

                // Find the skill
                const skill = skills.find(s => s.skillHrid === skillHrid);
                if (!skill) {
                    return null;
                }

                // Get level experience table
                const levelExperienceTable = gameData?.levelExperienceTable;
                if (!levelExperienceTable) {
                    return null;
                }

                // Current level and XP
                const currentLevel = skill.level;
                const currentXP = skill.experience || 0;

                // XP needed for next level
                const nextLevel = currentLevel + 1;
                const xpForNextLevel = levelExperienceTable[nextLevel];

                if (!xpForNextLevel) {
                    // Max level reached
                    return null;
                }

                // Calculate progress (XP gained this level / XP needed for this level)
                const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
                const xpGainedThisLevel = currentXP - xpForCurrentLevel;
                const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
                const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
                const xpNeeded = xpForNextLevel - currentXP;

                // Calculate XP multipliers and breakdown (MUST happen before calculating actions/rates)
                const xpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);

                // Calculate modified XP per action (base XP × multiplier)
                const baseXP = xpPerAction;
                const modifiedXP = xpPerAction * xpData.totalMultiplier;

                // Calculate actions and time needed (using modified XP)
                const actionsNeeded = Math.ceil(xpNeeded / modifiedXP);
                const timeNeeded = actionsNeeded * actionTime;

                // Calculate rates (using modified XP)
                const actionsPerHour = 3600 / actionTime;
                const xpPerHour = actionsPerHour * modifiedXP;
                const xpPerDay = xpPerHour * 24;

                // Calculate daily level progress
                const dailyLevelProgress = xpPerDay / xpNeededThisLevel;

                // Create content
                const content = document.createElement('div');
                content.style.cssText = `
                color: var(--text-color-secondary, #888);
                font-size: 0.9em;
                line-height: 1.6;
            `;

                const lines = [];

                // Current level and progress
                lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(1)}% to Level ${nextLevel}`);
                lines.push('');

                // Action details
                lines.push(`XP per action: ${formatWithSeparator(baseXP.toFixed(1))} base → ${formatWithSeparator(modifiedXP.toFixed(1))} (×${xpData.totalMultiplier.toFixed(2)})`);

                // XP breakdown (if any bonuses exist)
                if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                    const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                    lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(1)}%`);

                    // List all sources that contribute

                    // Equipment skill-specific XP (e.g., Celestial Shears foragingExperience)
                    if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                        for (const item of xpData.charmBreakdown) {
                            const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                            lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(1)}%`);
                        }
                    }

                    // Equipment wisdom (e.g., Philosopher's Necklace skillingExperience)
                    if (xpData.breakdown.equipmentWisdom > 0) {
                        lines.push(`    • Philosopher's Necklace: +${xpData.breakdown.equipmentWisdom.toFixed(1)}%`);
                    }

                    // House rooms
                    if (xpData.breakdown.houseWisdom > 0) {
                        lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(1)}%`);
                    }

                    // Community buff
                    if (xpData.breakdown.communityWisdom > 0) {
                        lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(1)}%`);
                    }

                    // Tea/Coffee
                    if (xpData.breakdown.consumableWisdom > 0) {
                        lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(1)}%`);
                    }
                }

                lines.push('');
                lines.push(`Actions to level: ${formatWithSeparator(actionsNeeded)} actions`);
                lines.push(`Time to level: ${timeReadable(timeNeeded)}`);
                lines.push(`XP/hour: ${formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatWithSeparator(Math.round(xpPerDay))}`);

                content.innerHTML = lines.join('<br>');

                // Create summary for collapsed view (time to next level)
                const summary = `${timeReadable(timeNeeded)} to Level ${nextLevel}`;

                // Create collapsible section
                return createCollapsibleSection(
                    '📈',
                    'Level Progress',
                    summary,
                    content,
                    false // Collapsed by default
                );
            } catch (error) {
                console.error('[MWI Tools] Error creating level progress section:', error);
                return null;
            }
        }

        /**
         * Disable quick input buttons (cleanup)
         */
        disable() {
            // Disconnect main observer
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Note: inputObserver and newInputObserver are created locally in injectQuickInputButtons()
            // and attached to panels, which will be garbage collected when panels are removed.
            // They cannot be explicitly disconnected here, but this is acceptable as they're
            // short-lived observers tied to specific panel instances.

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const quickInputButtons = new QuickInputButtons();

    /**
     * Action Speed Breakdown Module
     * Shows detailed breakdown of action speed sources
     */


    class ActionSpeedBreakdown {
        constructor() {
            this.isInitialized = false;
            this.currentActionHrid = null;
        }

        /**
         * Initialize the action speed breakdown feature
         */
        initialize() {
            if (!config.getSetting('actionPanel_speedBreakdown')) {
                return;
            }

            // Wait for action panels to appear
            domObserver.observeNewElement(
                'ActionSpeedBreakdown',
                'div[class*="SkillActionDetail_skillActionDetail"]',
                (actionPanel) => {
                    this.injectSpeedBreakdown(actionPanel);
                }
            );

            this.isInitialized = true;
        }

        /**
         * Inject speed breakdown into action panel
         * @param {HTMLElement} actionPanel - The action panel element
         */
        injectSpeedBreakdown(actionPanel) {
            // Check if already injected
            if (actionPanel.querySelector('.mwi-speed-breakdown')) {
                return;
            }

            // Get action info
            const actionNameElement = actionPanel.querySelector('[class*="SkillActionDetail_skillName"]');
            if (!actionNameElement) return;

            const actionName = actionNameElement.textContent.trim();
            const actionHrid = this.getActionHridFromName(actionName);
            if (!actionHrid) return;

            const actionData = dataManager.getActionData(actionHrid);
            if (!actionData) return;

            // Calculate speed breakdown
            const breakdown = this.calculateSpeedBreakdown(actionData);
            
            // Create breakdown UI
            const breakdownElement = this.createBreakdownUI(breakdown, actionData);

            // Find insertion point (after action time display or action name)
            const insertAfter = actionPanel.querySelector('.mwi-action-time-display') || 
                               actionNameElement.parentElement;
            
            if (insertAfter) {
                insertAfter.insertAdjacentElement('afterend', breakdownElement);
            }
        }

        /**
         * Calculate speed breakdown from all sources
         * @param {Object} actionData - Action data from dataManager
         * @returns {Object} Speed breakdown by source
         */
        calculateSpeedBreakdown(actionData) {
            const breakdown = {
                equipment: [],
                tool: [],
                consumables: [],
                total: 0
            };

            // Equipment (Skilling Speed)
            const equipment = dataManager.getEquipment();
            for (const [slot, item] of Object.entries(equipment)) {
                if (!item) continue;

                const itemData = dataManager.getItemData(item.itemHrid);
                if (!itemData?.equipmentDetail?.noncombatStats?.skillingSpeed) continue;

                const baseSpeed = itemData.equipmentDetail.noncombatStats.skillingSpeed * 100;
                const enhancementBonus = this.getEnhancementBonus(item, itemData);
                const totalSpeed = baseSpeed * (1 + enhancementBonus);

                breakdown.equipment.push({
                    name: itemData.name,
                    enhancement: item.augmentations?.augmentationLevel || 0,
                    baseSpeed: baseSpeed,
                    enhancementBonus: enhancementBonus * 100,
                    totalSpeed: totalSpeed
                });

                breakdown.total += totalSpeed;
            }

            // Tool (action-specific speed)
            const toolSpeed = this.getToolSpeed(actionData);
            if (toolSpeed.speed > 0) {
                breakdown.tool.push(toolSpeed);
                breakdown.total += toolSpeed.totalSpeed;
            }

            // Consumables (teas)
            const consumableSpeed = this.getConsumableSpeed(actionData);
            breakdown.consumables = consumableSpeed;
            breakdown.total += consumableSpeed.reduce((sum, c) => sum + c.speed, 0);

            return breakdown;
        }

        /**
         * Get enhancement bonus multiplier for equipment
         * @param {Object} item - Equipped item
         * @param {Object} itemData - Item data
         * @returns {number} Enhancement bonus multiplier (0.145 for +10 accessory = 145% bonus)
         */
        getEnhancementBonus(item, itemData) {
            const enhancementLevel = item.augmentations?.augmentationLevel || 0;
            if (enhancementLevel === 0) return 0;

            // Enhancement bonus table
            const bonusTable = [
                0, 0.02, 0.042, 0.066, 0.092, 0.12, 0.15, 0.182, 0.216, 0.252, 0.29,
                0.334, 0.384, 0.44, 0.502, 0.57, 0.644, 0.724, 0.81, 0.902, 1.0
            ];

            const bonus = bonusTable[enhancementLevel] || 0;

            // Check if accessory (5× multiplier)
            const isAccessory = ['/equipment_types/neck', '/equipment_types/ring', 
                                '/equipment_types/earrings', '/equipment_types/back',
                                '/equipment_types/trinket', '/equipment_types/charm'].includes(
                itemData.equipmentDetail.type
            );

            return bonus * (isAccessory ? 5 : 1);
        }

        /**
         * Get tool speed for the action
         * @param {Object} actionData - Action data
         * @returns {Object} Tool speed info
         */
        getToolSpeed(actionData) {
            const equipment = dataManager.getEquipment();
            const toolSlot = equipment['/equipment_types/tool'];
            
            if (!toolSlot) return { speed: 0 };

            const toolData = dataManager.getItemData(toolSlot.itemHrid);
            if (!toolData) return { speed: 0 };

            // Check for action-specific speed (e.g., woodcuttingSpeed, miningSpeed)
            const actionType = actionData.type;
            const speedStat = this.getSpeedStatForAction(actionType);
            
            if (!speedStat) return { speed: 0 };

            const baseSpeed = toolData.equipmentDetail?.noncombatStats?.[speedStat];
            if (!baseSpeed) return { speed: 0 };

            const enhancementBonus = this.getEnhancementBonus(toolSlot, toolData);
            const totalSpeed = baseSpeed * 100 * (1 + enhancementBonus);

            return {
                name: toolData.name,
                enhancement: toolSlot.augmentations?.augmentationLevel || 0,
                baseSpeed: baseSpeed * 100,
                enhancementBonus: enhancementBonus * 100,
                totalSpeed: totalSpeed,
                speed: totalSpeed
            };
        }

        /**
         * Get the speed stat name for an action type
         * @param {string} actionType - Action type HRID
         * @returns {string|null} Speed stat name
         */
        getSpeedStatForAction(actionType) {
            const mapping = {
                // Gathering skills
                '/action_types/woodcutting': 'woodcuttingSpeed',
                '/action_types/foraging': 'foragingSpeed',
                '/action_types/milking': 'milkingSpeed',
                // Production skills
                '/action_types/brewing': 'brewingSpeed',
                '/action_types/cheesesmithing': 'cheesesmithingSpeed',
                '/action_types/cooking': 'cookingSpeed',
                '/action_types/crafting': 'craftingSpeed',
                '/action_types/tailoring': 'tailoringSpeed',
                '/action_types/alchemy': 'alchemySpeed'
            };
            return mapping[actionType] || null;
        }

        /**
         * Get consumable speed bonuses (Enhancing Teas only)
         * @param {Object} actionData - Action data
         * @returns {Array} Consumable speed info
         */
        getConsumableSpeed(actionData) {
            const drinkSlots = dataManager.getDrinkSlots();
            if (!drinkSlots) return [];

            const actionType = actionData.type;
            const consumables = [];

            // Only Enhancing is relevant (all actions except combat)
            if (actionType === '/action_types/combat') {
                return consumables;
            }

            // Get drink concentration bonus from Guzzling Pouch
            const equipment = dataManager.getEquipment();
            let drinkConcentration = 0;
            for (const [slot, item] of Object.entries(equipment)) {
                if (!item) continue;
                const itemData = dataManager.getItemData(item.itemHrid);
                if (itemData?.equipmentDetail?.noncombatStats?.drinkConcentration) {
                    const baseDrinkConc = itemData.equipmentDetail.noncombatStats.drinkConcentration;
                    const enhancementBonus = this.getEnhancementBonus(item, itemData);
                    drinkConcentration += baseDrinkConc * (1 + enhancementBonus);
                }
            }

            // Check drink slots for Enhancing Teas with action_speed buff
            const enhancingTeas = {
                '/items/enhancing_tea': { name: 'Enhancing Tea', baseSpeed: 0.02 },
                '/items/super_enhancing_tea': { name: 'Super Enhancing Tea', baseSpeed: 0.04 },
                '/items/ultra_enhancing_tea': { name: 'Ultra Enhancing Tea', baseSpeed: 0.06 }
            };

            for (const drink of drinkSlots) {
                if (!drink || !drink.itemHrid) continue;

                const teaInfo = enhancingTeas[drink.itemHrid];
                if (teaInfo) {
                    const scaledSpeed = teaInfo.baseSpeed * (1 + drinkConcentration);
                    consumables.push({
                        name: teaInfo.name,
                        baseSpeed: teaInfo.baseSpeed * 100,
                        drinkConcentration: drinkConcentration * 100,
                        speed: scaledSpeed * 100
                    });
                }
            }

            return consumables;
        }

        /**
         * Get action HRID from action name
         * @param {string} actionName - Action name
         * @returns {string|null} Action HRID
         */
        getActionHridFromName(actionName) {
            const initClientData = dataManager.getInitClientData();
            if (!initClientData?.actionDetailMap) return null;

            for (const [hrid, action] of Object.entries(initClientData.actionDetailMap)) {
                if (action.name === actionName) {
                    return hrid;
                }
            }
            return null;
        }

        /**
         * Create breakdown UI element
         * @param {Object} breakdown - Speed breakdown data
         * @param {Object} actionData - Action data
         * @returns {HTMLElement} Breakdown UI element
         */
        createBreakdownUI(breakdown, actionData) {
            const container = document.createElement('div');
            container.className = 'mwi-speed-breakdown';
            container.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.875rem;
            color: #ccc;
        `;

            // Header (collapsible)
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            font-weight: bold;
            color: ${config.SCRIPT_COLOR_MAIN};
        `;
            
            const arrow = document.createElement('span');
            arrow.textContent = '▼';
            arrow.style.marginRight = '6px';
            arrow.style.fontSize = '0.7em';
            arrow.style.transition = 'transform 0.2s';

            const title = document.createElement('span');
            title.textContent = `Action Speed: +${breakdown.total.toFixed(1)}%`;

            header.appendChild(arrow);
            header.appendChild(title);

            // Content (collapsible)
            const content = document.createElement('div');
            content.style.cssText = `
            margin-top: 8px;
            margin-left: 12px;
            line-height: 1.6;
        `;

            // Add each source category
            if (breakdown.equipment.length > 0) {
                content.appendChild(this.createSourceSection('Equipment', breakdown.equipment));
            }

            if (breakdown.tool.length > 0) {
                content.appendChild(this.createSourceSection('Tool', breakdown.tool));
            }

            if (breakdown.consumables.length > 0) {
                content.appendChild(this.createSourceSection('Consumables', breakdown.consumables));
            } else {
                const noBuffs = document.createElement('div');
                noBuffs.textContent = '└─ Consumables: No active speed buffs';
                noBuffs.style.color = '#888';
                content.appendChild(noBuffs);
            }

            // Calculate base and actual time
            const baseTime = actionData.baseTimeCost / 1000; // Convert ms to seconds
            const actualTime = baseTime / (1 + breakdown.total / 100);
            
            const timeInfo = document.createElement('div');
            timeInfo.style.cssText = `
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-weight: bold;
        `;
            timeInfo.textContent = `Base Time: ${baseTime.toFixed(1)}s → Actual Time: ${actualTime.toFixed(2)}s`;
            content.appendChild(timeInfo);

            // Toggle functionality
            let isOpen = false;
            content.style.display = 'none';

            header.addEventListener('click', () => {
                isOpen = !isOpen;
                content.style.display = isOpen ? 'block' : 'none';
                arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
            });

            // Start collapsed
            arrow.style.transform = 'rotate(-90deg)';

            container.appendChild(header);
            container.appendChild(content);

            return container;
        }

        /**
         * Create a source section (Equipment, Tool, Consumables)
         * @param {string} categoryName - Category name
         * @param {Array} items - Items in this category
         * @returns {HTMLElement} Source section element
         */
        createSourceSection(categoryName, items) {
            const section = document.createElement('div');
            section.style.marginBottom = '4px';

            const categoryHeader = document.createElement('div');
            categoryHeader.textContent = `├─ ${categoryName}`;
            categoryHeader.style.fontWeight = 'bold';
            section.appendChild(categoryHeader);

            items.forEach((item, index) => {
                const isLast = index === items.length - 1;
                const prefix = isLast ? '    └─ ' : '    ├─ ';

                const itemLine = document.createElement('div');
                itemLine.style.marginLeft = '8px';

                let text = `${prefix}${item.name}`;
                if (item.enhancement > 0) {
                    text += ` +${item.enhancement}`;
                }

                // Speed display varies by source type
                if (item.speed !== undefined) {
                    text += `: +${item.speed.toFixed(1)}%`;
                } else if (item.totalSpeed !== undefined) {
                    text += `: +${item.totalSpeed.toFixed(1)}%`;
                }

                // Additional info
                if (item.baseSpeed && item.enhancementBonus > 0) {
                    text += ` (${item.baseSpeed.toFixed(1)}% base × ${(1 + item.enhancementBonus / 100).toFixed(2)})`;
                } else if (item.baseSpeed && item.drinkConcentration > 0) {
                    text += ` (${item.baseSpeed.toFixed(1)}% base × ${(1 + item.drinkConcentration / 100).toFixed(2)})`;
                } else if (item.level) {
                    text += ` (Level ${item.level})`;
                }

                itemLine.textContent = text;
                section.appendChild(itemLine);
            });

            return section;
        }

        /**
         * Cleanup
         */
        disable() {
            domObserver.unregister('ActionSpeedBreakdown');
            this.isInitialized = false;
        }
    }

    const actionSpeedBreakdown = new ActionSpeedBreakdown();

    /**
     * Ability Book Calculator
     * Shows number of books needed to reach target ability level
     * Appears in Item Dictionary when viewing ability books
     */


    /**
     * AbilityBookCalculator class handles ability book calculations in Item Dictionary
     */
    class AbilityBookCalculator {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
        }

        /**
         * Initialize the ability book calculator
         */
        initialize() {
            // Check if feature is enabled
            if (!config.getSetting('skillbook')) {
                return;
            }

            // Register with centralized observer to watch for Item Dictionary modal
            this.unregisterObserver = domObserver.onClass(
                'AbilityBookCalculator',
                'ItemDictionary_modalContent__WvEBY',
                (dictContent) => {
                    this.handleItemDictionary(dictContent);
                }
            );

            this.isActive = true;
        }

        /**
         * Handle Item Dictionary modal
         * @param {Element} panel - Item Dictionary content element
         */
        async handleItemDictionary(panel) {
            try {
                // Extract ability HRID from modal title
                const abilityHrid = this.extractAbilityHrid(panel);
                if (!abilityHrid) {
                    return; // Not an ability book
                }

                // Get ability book data
                const itemHrid = abilityHrid.replace('/abilities/', '/items/');
                const gameData = dataManager.getInitClientData();
                if (!gameData) return;

                const itemDetails = gameData.itemDetailMap[itemHrid];
                if (!itemDetails?.abilityBookDetail) {
                    return; // Not an ability book
                }

                const xpPerBook = itemDetails.abilityBookDetail.experienceGain;

                // Get current ability level and XP
                const abilityData = this.getCurrentAbilityData(abilityHrid);

                // Inject calculator UI
                this.injectCalculator(panel, abilityData, xpPerBook, itemHrid);

            } catch (error) {
                console.error('[AbilityBookCalculator] Error handling dictionary:', error);
            }
        }

        /**
         * Extract ability HRID from modal title
         * @param {Element} panel - Item Dictionary content element
         * @returns {string|null} Ability HRID or null
         */
        extractAbilityHrid(panel) {
            const titleElement = panel.querySelector('h1.ItemDictionary_title__27cTd');
            if (!titleElement) return null;

            // Get the item name from title
            const itemName = titleElement.textContent.trim()
                .toLowerCase()
                .replaceAll(' ', '_')
                .replaceAll("'", '');

            // Look up ability HRID from name
            const gameData = dataManager.getInitClientData();
            if (!gameData) return null;

            for (const abilityHrid of Object.keys(gameData.abilityDetailMap)) {
                if (abilityHrid.includes('/' + itemName)) {
                    return abilityHrid;
                }
            }

            return null;
        }

        /**
         * Get current ability level and XP from character data
         * @param {string} abilityHrid - Ability HRID
         * @returns {Object} {level, xp}
         */
        getCurrentAbilityData(abilityHrid) {
            // Get character abilities from live character data (NOT static game data)
            const characterData = dataManager.characterData;
            if (!characterData?.characterAbilities) {
                return { level: 0, xp: 0 };
            }

            // characterAbilities is an ARRAY of ability objects
            const ability = characterData.characterAbilities.find(a => a.abilityHrid === abilityHrid);
            if (ability) {
                return {
                    level: ability.level || 0,
                    xp: ability.experience || 0
                };
            }

            return { level: 0, xp: 0 };
        }

        /**
         * Calculate books needed to reach target level
         * @param {number} currentLevel - Current ability level
         * @param {number} currentXp - Current ability XP
         * @param {number} targetLevel - Target ability level
         * @param {number} xpPerBook - XP gained per book
         * @returns {number} Number of books needed
         */
        calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) return 0;

            const levelXpTable = gameData.levelExperienceTable;
            if (!levelXpTable) return 0;

            // Calculate XP needed to reach target level
            const targetXp = levelXpTable[targetLevel];
            const xpNeeded = targetXp - currentXp;

            // Calculate books needed
            let booksNeeded = xpNeeded / xpPerBook;

            // If starting from level 0, need +1 book to learn the ability initially
            if (currentLevel === 0) {
                booksNeeded += 1;
            }

            return booksNeeded;
        }

        /**
         * Inject calculator UI into Item Dictionary modal
         * @param {Element} panel - Item Dictionary content element
         * @param {Object} abilityData - {level, xp}
         * @param {number} xpPerBook - XP per book
         * @param {string} itemHrid - Item HRID for market prices
         */
        async injectCalculator(panel, abilityData, xpPerBook, itemHrid) {
            // Check if already injected
            if (panel.querySelector('.tillLevel')) {
                return;
            }

            const { level: currentLevel, xp: currentXp } = abilityData;
            const targetLevel = currentLevel + 1;

            // Calculate initial books needed
            const booksNeeded = this.calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook);

            // Get market prices
            const prices = marketAPI.getPrice(itemHrid, 0);
            const ask = prices?.ask || 0;
            const bid = prices?.bid || 0;

            // Create calculator HTML
            const calculatorDiv = dom.createStyledDiv(
                {
                    color: config.SCRIPT_COLOR_MAIN,
                    textAlign: 'left',
                    marginTop: '16px',
                    padding: '12px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px'
                },
                '',
                'tillLevel'
            );

            calculatorDiv.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 0.95em;">
                <strong>Current level:</strong> ${currentLevel}
            </div>
            <div style="margin-bottom: 8px;">
                <label for="tillLevelInput">To level: </label>
                <input
                    id="tillLevelInput"
                    type="number"
                    value="${targetLevel}"
                    min="${currentLevel + 1}"
                    max="200"
                    style="width: 60px; padding: 4px; background: #2a2a2a; color: white; border: 1px solid #555; border-radius: 3px;"
                >
            </div>
            <div id="tillLevelNumber" style="font-size: 0.95em;">
                Books needed: <strong>${numberFormatter(booksNeeded)}</strong>
                <br>
                Cost: ${numberFormatter(Math.ceil(booksNeeded * ask))} / ${numberFormatter(Math.ceil(booksNeeded * bid))} (ask / bid)
            </div>
            <div style="font-size: 0.85em; color: #999; margin-top: 8px; font-style: italic;">
                Refresh page to update current level
            </div>
        `;

            // Add event listeners for input changes
            const input = calculatorDiv.querySelector('#tillLevelInput');
            const display = calculatorDiv.querySelector('#tillLevelNumber');

            const updateDisplay = () => {
                const target = parseInt(input.value);

                if (target > currentLevel && target <= 200) {
                    const books = this.calculateBooksNeeded(currentLevel, currentXp, target, xpPerBook);
                    display.innerHTML = `
                    Books needed: <strong>${numberFormatter(books)}</strong>
                    <br>
                    Cost: ${numberFormatter(Math.ceil(books * ask))} / ${numberFormatter(Math.ceil(books * bid))} (ask / bid)
                `;
                } else {
                    display.innerHTML = '<span style="color: #f87171;">Invalid target level</span>';
                }
            };

            input.addEventListener('change', updateDisplay);
            input.addEventListener('keyup', updateDisplay);

            // Try to find the left column by looking for the modal's main content structure
            // The Item Dictionary modal typically has its content in direct children of the panel
            const directChildren = Array.from(panel.children);

            // Look for a container that has exactly 2 children (two-column layout)
            for (const child of directChildren) {
                const grandchildren = Array.from(child.children).filter(c => {
                    // Filter for visible elements that look like content columns
                    const style = window.getComputedStyle(c);
                    return style.display !== 'none' && c.offsetHeight > 50; // At least 50px tall
                });

                if (grandchildren.length === 2) {
                    // Found the two-column container! Use the left column (first child)
                    const leftColumn = grandchildren[0];
                    leftColumn.appendChild(calculatorDiv);
                    return;
                }
            }

            // Fallback: append to panel bottom (original behavior)
            panel.appendChild(calculatorDiv);
        }

        /**
         * Disable the feature
         */
        disable() {
            // Unregister from centralized observer
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const abilityBookCalculator = new AbilityBookCalculator();

    /**
     * Combat Zone Indices
     * Shows index numbers on combat zone buttons and task cards
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_COMBAT_TASK = /(?:Kill|Defeat)\s*-\s*(.+)$/;

    /**
     * ZoneIndices class manages zone index display on maps and tasks
     */
    class ZoneIndices {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
            this.monsterZoneCache = null; // Cache monster name -> zone index mapping
            this.taskMapIndexEnabled = false;
            this.mapIndexEnabled = false;
        }

        /**
         * Initialize zone indices feature
         */
        initialize() {
            // Check if either feature is enabled
            this.taskMapIndexEnabled = config.getSetting('taskMapIndex');
            this.mapIndexEnabled = config.getSetting('mapIndex');

            if (!this.taskMapIndexEnabled && !this.mapIndexEnabled) {
                return;
            }

            // Build monster->zone cache once on initialization
            if (this.taskMapIndexEnabled) {
                this.buildMonsterZoneCache();
            }

            // Register with centralized observer with debouncing enabled
            this.unregisterObserver = domObserver.register(
                'ZoneIndices',
                () => {
                    if (this.taskMapIndexEnabled) {
                        this.addTaskIndices();
                    }
                    if (this.mapIndexEnabled) {
                        this.addMapIndices();
                    }
                },
                { debounce: true, debounceDelay: 100 } // Use centralized debouncing
            );

            // Process existing elements
            if (this.taskMapIndexEnabled) {
                this.addTaskIndices();
            }
            if (this.mapIndexEnabled) {
                this.addMapIndices();
            }

            this.isActive = true;
        }

        /**
         * Build a cache of monster names to zone indices
         * Run once on initialization to avoid repeated traversals
         */
        buildMonsterZoneCache() {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return;
            }

            this.monsterZoneCache = new Map();

            for (const action of Object.values(gameData.actionDetailMap)) {
                // Only check combat actions
                if (!action.hrid?.includes('/combat/')) {
                    continue;
                }

                const categoryHrid = action.category;
                if (!categoryHrid) {
                    continue;
                }

                const category = gameData.actionCategoryDetailMap[categoryHrid];
                const zoneIndex = category?.sortIndex;
                if (!zoneIndex) {
                    continue;
                }

                // Cache action name -> zone index
                if (action.name) {
                    this.monsterZoneCache.set(action.name.toLowerCase(), zoneIndex);
                }

                // Cache boss names -> zone index
                if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                    for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                        const bossHrid = boss.combatMonsterHrid;
                        if (bossHrid) {
                            const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                            this.monsterZoneCache.set(bossName.toLowerCase(), zoneIndex);
                        }
                    }
                }
            }
        }

        /**
         * Add zone indices to task cards
         * Shows "Z5" next to monster kill tasks
         */
        addTaskIndices() {
            // Find all task name elements
            const taskNameElements = document.querySelectorAll('div[class*="RandomTask_name"]');

            for (const nameElement of taskNameElements) {
                // Always remove any existing index first (in case task was rerolled)
                const existingIndex = nameElement.querySelector('span.script_taskMapIndex');
                if (existingIndex) {
                    existingIndex.remove();
                }

                const taskText = nameElement.textContent;

                // Check if this is a combat task (contains "Kill" or "Defeat")
                if (!taskText.includes('Kill') && !taskText.includes('Defeat')) {
                    continue; // Not a combat task, skip
                }

                // Extract monster name from task text
                // Format: "Defeat - Jerry" or "Kill - Monster Name"
                const match = taskText.match(REGEX_COMBAT_TASK);
                if (!match) {
                    continue; // Couldn't parse monster name
                }

                const monsterName = match[1].trim();

                // Find the combat action for this monster
                const zoneIndex = this.getZoneIndexForMonster(monsterName);

                if (zoneIndex) {
                    // Add index to the name element
                    nameElement.insertAdjacentHTML(
                        'beforeend',
                        `<span class="script_taskMapIndex" style="margin-left: 4px; color: ${config.SCRIPT_COLOR_MAIN};">Z${zoneIndex}</span>`
                    );
                }
            }
        }

        /**
         * Add sequential indices to combat zone buttons on maps page
         * Shows "1. Zone Name", "2. Zone Name", etc.
         */
        addMapIndices() {
            // Find all combat zone tab buttons
            // Target the vertical tabs in the combat panel
            const buttons = document.querySelectorAll(
                'div.MainPanel_subPanelContainer__1i-H9 div.CombatPanel_tabsComponentContainer__GsQlg div.MuiTabs-root.MuiTabs-vertical button.MuiButtonBase-root.MuiTab-root span.MuiBadge-root'
            );

            if (buttons.length === 0) {
                return;
            }

            let index = 1;
            for (const button of buttons) {
                // Skip if already has index
                if (button.querySelector('span.script_mapIndex')) {
                    continue;
                }

                // Add index at the beginning
                button.insertAdjacentHTML(
                    'afterbegin',
                    `<span class="script_mapIndex" style="color: ${config.SCRIPT_COLOR_MAIN};">${index}. </span>`
                );

                index++;
            }
        }

        /**
         * Get zone index for a monster name
         * @param {string} monsterName - Monster display name
         * @returns {number|null} Zone index or null if not found
         */
        getZoneIndexForMonster(monsterName) {
            // Use cache if available
            if (this.monsterZoneCache) {
                return this.monsterZoneCache.get(monsterName.toLowerCase()) || null;
            }

            // Fallback to direct lookup if cache not built (shouldn't happen)
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return null;
            }

            const normalizedName = monsterName.toLowerCase();

            for (const action of Object.values(gameData.actionDetailMap)) {
                if (!action.hrid?.includes('/combat/')) {
                    continue;
                }

                if (action.name?.toLowerCase() === normalizedName) {
                    const categoryHrid = action.category;
                    if (categoryHrid) {
                        const category = gameData.actionCategoryDetailMap[categoryHrid];
                        if (category?.sortIndex) {
                            return category.sortIndex;
                        }
                    }
                }

                if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                    for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                        const bossHrid = boss.combatMonsterHrid;
                        if (bossHrid) {
                            const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                            if (bossName === normalizedName) {
                                const categoryHrid = action.category;
                                if (categoryHrid) {
                                    const category = gameData.actionCategoryDetailMap[categoryHrid];
                                    if (category?.sortIndex) {
                                        return category.sortIndex;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Disable the feature
         */
        disable() {
            // Unregister from centralized observer
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all added indices
            const taskIndices = document.querySelectorAll('span.script_taskMapIndex');
            for (const span of taskIndices) {
                span.remove();
            }

            const mapIndices = document.querySelectorAll('span.script_mapIndex');
            for (const span of mapIndices) {
                span.remove();
            }

            // Clear cache
            this.monsterZoneCache = null;
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const zoneIndices = new ZoneIndices();

    /**
     * Ability Cost Calculator Utility
     * Calculates the cost to reach a specific ability level
     * Extracted from ability-book-calculator.js for reuse in combat score
     */


    /**
     * List of starter abilities that give 50 XP per book (others give 500)
     */
    const STARTER_ABILITIES = [
        'poke', 'scratch', 'smack', 'quick_shot',
        'water_strike', 'fireball', 'entangle', 'minor_heal'
    ];

    /**
     * Check if an ability is a starter ability (50 XP per book)
     * @param {string} abilityHrid - Ability HRID
     * @returns {boolean} True if starter ability
     */
    function isStarterAbility(abilityHrid) {
        return STARTER_ABILITIES.some(skill => abilityHrid.includes(skill));
    }

    /**
     * Calculate the cost to reach a specific ability level from level 0
     * @param {string} abilityHrid - Ability HRID (e.g., '/abilities/fireball')
     * @param {number} targetLevel - Target level to reach
     * @returns {number} Total cost in coins
     */
    function calculateAbilityCost(abilityHrid, targetLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const levelXpTable = gameData.levelExperienceTable;
        if (!levelXpTable) return 0;

        // Get XP needed to reach target level from level 0
        const targetXp = levelXpTable[targetLevel] || 0;

        // Determine XP per book (50 for starters, 500 for advanced)
        const xpPerBook = isStarterAbility(abilityHrid) ? 50 : 500;

        // Calculate books needed
        let booksNeeded = targetXp / xpPerBook;
        booksNeeded += 1; // +1 book to learn the ability initially

        // Get market price for ability book
        const itemHrid = abilityHrid.replace('/abilities/', '/items/');
        const prices = marketAPI.getPrice(itemHrid, 0);

        if (!prices) return 0;

        // Match MCS behavior: if one price is positive and other is negative, use positive for both
        let ask = prices.ask;
        let bid = prices.bid;

        if (ask > 0 && bid < 0) {
            bid = ask;
        }
        if (bid > 0 && ask < 0) {
            ask = bid;
        }

        // Use weighted average
        const weightedPrice = (ask + bid) / 2;

        return booksNeeded * weightedPrice;
    }

    /**
     * House Cost Calculator Utility
     * Calculates the total cost to build house rooms to specific levels
     * Used for combat score calculation
     */


    /**
     * Calculate the total cost to build a house room to a specific level
     * @param {string} houseRoomHrid - House room HRID (e.g., '/house_rooms/dojo')
     * @param {number} currentLevel - Target level (1-8)
     * @returns {number} Total build cost in coins
     */
    function calculateHouseBuildCost(houseRoomHrid, currentLevel) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return 0;

        const houseDetail = houseRoomDetailMap[houseRoomHrid];
        if (!houseDetail) return 0;

        const upgradeCostsMap = houseDetail.upgradeCostsMap;
        if (!upgradeCostsMap) return 0;

        let totalCost = 0;

        // Sum costs for all levels from 1 to current
        for (let level = 1; level <= currentLevel; level++) {
            const levelUpgrades = upgradeCostsMap[level];
            if (!levelUpgrades) continue;

            // Add cost for each material required at this level
            for (const item of levelUpgrades) {
                // Special case: Coins have face value of 1 (no market price)
                if (item.itemHrid === '/items/coin') {
                    const itemCost = item.count * 1;
                    totalCost += itemCost;
                    continue;
                }

                const prices = marketAPI.getPrice(item.itemHrid, 0);
                if (!prices) continue;

                // Match MCS behavior: if one price is positive and other is negative, use positive for both
                let ask = prices.ask;
                let bid = prices.bid;

                if (ask > 0 && bid < 0) {
                    bid = ask;
                }
                if (bid > 0 && ask < 0) {
                    ask = bid;
                }

                // Use weighted average
                const weightedPrice = (ask + bid) / 2;

                const itemCost = item.count * weightedPrice;
                totalCost += itemCost;
            }
        }

        return totalCost;
    }

    /**
     * Calculate total cost for all battle houses
     * @param {Object} characterHouseRooms - Map of character house rooms from profile data
     * @returns {Object} {totalCost, breakdown: [{name, level, cost}]}
     */
    function calculateBattleHousesCost(characterHouseRooms) {
        const battleHouses = [
            'dining_room',
            'library',
            'dojo',
            'gym',
            'armory',
            'archery_range',
            'mystical_study'
        ];

        const gameData = dataManager.getInitClientData();
        if (!gameData) return { totalCost: 0, breakdown: [] };

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

        let totalCost = 0;
        const breakdown = [];

        for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
            // Check if this is a battle house
            const isBattleHouse = battleHouses.some(battleHouse =>
                houseRoomHrid.includes(battleHouse)
            );

            if (!isBattleHouse) continue;

            const level = houseData.level || 0;
            if (level === 0) continue;

            const cost = calculateHouseBuildCost(houseRoomHrid, level);
            totalCost += cost;

            // Get human-readable name
            const houseDetail = houseRoomDetailMap[houseRoomHrid];
            const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

            breakdown.push({
                name: houseName,
                level: level,
                cost: cost
            });
        }

        // Sort by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);

        return { totalCost, breakdown };
    }

    /**
     * Combat Score Calculator
     * Calculates player gear score based on:
     * - House Score: Cost of battle houses
     * - Ability Score: Cost to reach current ability levels
     * - Equipment Score: Cost to enhance equipped items
     */


    /**
     * Token-based item data for untradeable back slot items (capes/cloaks/quivers)
     * These items are purchased with dungeon tokens and have no market data
     */
    const CAPE_ITEM_TOKEN_DATA = {
        '/items/chimerical_quiver': {
            tokenCost: 35000,
            tokenShopItems: [
                { hrid: '/items/griffin_leather', cost: 600 },
                { hrid: '/items/manticore_sting', cost: 1000 },
                { hrid: '/items/jackalope_antler', cost: 1200 },
                { hrid: '/items/dodocamel_plume', cost: 3000 },
                { hrid: '/items/griffin_talon', cost: 3000 }
            ]
        },
        '/items/sinister_cape': {
            tokenCost: 27000,
            tokenShopItems: [
                { hrid: '/items/acrobats_ribbon', cost: 2000 },
                { hrid: '/items/magicians_cloth', cost: 2000 },
                { hrid: '/items/chaotic_chain', cost: 3000 },
                { hrid: '/items/cursed_ball', cost: 3000 }
            ]
        },
        '/items/enchanted_cloak': {
            tokenCost: 27000,
            tokenShopItems: [
                { hrid: '/items/royal_cloth', cost: 2000 },
                { hrid: '/items/knights_ingot', cost: 2000 },
                { hrid: '/items/bishops_scroll', cost: 2000 },
                { hrid: '/items/regal_jewel', cost: 3000 },
                { hrid: '/items/sundering_jewel', cost: 3000 }
            ]
        }
    };

    /**
     * Calculate combat score from profile data
     * @param {Object} profileData - Profile data from game
     * @returns {Promise<Object>} {total, house, ability, equipment, breakdown}
     */
    async function calculateCombatScore(profileData) {
        try {
            // 1. Calculate House Score
            const houseResult = calculateHouseScore(profileData);

            // 2. Calculate Ability Score
            const abilityResult = calculateAbilityScore(profileData);

            // 3. Calculate Equipment Score
            const equipmentResult = calculateEquipmentScore(profileData);

            const totalScore = houseResult.score + abilityResult.score + equipmentResult.score;

            return {
                total: totalScore,
                house: houseResult.score,
                ability: abilityResult.score,
                equipment: equipmentResult.score,
                equipmentHidden: profileData.profile?.hideWearableItems || false,
                breakdown: {
                    houses: houseResult.breakdown,
                    abilities: abilityResult.breakdown,
                    equipment: equipmentResult.breakdown
                }
            };
        } catch (error) {
            console.error('[CombatScore] Error calculating score:', error);
            return {
                total: 0,
                house: 0,
                ability: 0,
                equipment: 0,
                equipmentHidden: false,
                breakdown: { houses: [], abilities: [], equipment: [] }
            };
        }
    }

    /**
     * Calculate house score from battle houses
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown}
     */
    function calculateHouseScore(profileData) {
        const characterHouseRooms = profileData.profile?.characterHouseRoomMap || {};

        const { totalCost, breakdown } = calculateBattleHousesCost(characterHouseRooms);

        // Convert to score (cost / 1 million)
        const score = totalCost / 1_000_000;

        // Format breakdown for display
        const formattedBreakdown = breakdown.map(house => ({
            name: `${house.name} ${house.level}`,
            value: (house.cost / 1_000_000).toFixed(1)
        }));

        return { score, breakdown: formattedBreakdown };
    }

    /**
     * Calculate ability score from equipped abilities
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown}
     */
    function calculateAbilityScore(profileData) {
        // Use equippedAbilities (not characterAbilities) to match MCS behavior
        const equippedAbilities = profileData.profile?.equippedAbilities || [];

        let totalCost = 0;
        const breakdown = [];

        for (const ability of equippedAbilities) {
            if (!ability.abilityHrid || ability.level === 0) continue;

            const cost = calculateAbilityCost(ability.abilityHrid, ability.level);
            totalCost += cost;

            // Format ability name for display
            const abilityName = ability.abilityHrid
                .replace('/abilities/', '')
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            breakdown.push({
                name: `${abilityName} ${ability.level}`,
                value: (cost / 1_000_000).toFixed(1)
            });
        }

        // Convert to score (cost / 1 million)
        const score = totalCost / 1_000_000;

        // Sort by value descending
        breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

        return { score, breakdown };
    }

    /**
     * Calculate token-based item value for untradeable back slot items
     * @param {string} itemHrid - Item HRID
     * @returns {number} Item value in coins (0 if not a token-based item)
     */
    function calculateTokenBasedItemValue(itemHrid) {
        const capeData = CAPE_ITEM_TOKEN_DATA[itemHrid];
        if (!capeData) {
            return 0; // Not a token-based item
        }

        // Find the best value per token from shop items
        let bestValuePerToken = 0;
        for (const shopItem of capeData.tokenShopItems) {
            const marketPrice = marketAPI.getPrice(shopItem.hrid, 0);
            if (!marketPrice) continue;

            // Use ask price for shop items (instant buy cost)
            const shopItemPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
            if (shopItemPrice > 0) {
                const valuePerToken = shopItemPrice / shopItem.cost;
                if (valuePerToken > bestValuePerToken) {
                    bestValuePerToken = valuePerToken;
                }
            }
        }

        // Calculate total item value: best value per token × token cost
        return bestValuePerToken * capeData.tokenCost;
    }

    /**
     * Calculate equipment score from equipped items
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown}
     */
    function calculateEquipmentScore(profileData) {
        const equippedItems = profileData.profile?.wearableItemMap || {};
        const hideEquipment = profileData.profile?.hideWearableItems || false;

        // If equipment is hidden, return 0
        if (hideEquipment) {
            return { score: 0, breakdown: [] };
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) return { score: 0, breakdown: [] };

        let totalValue = 0;
        const breakdown = [];

        for (const [slot, itemData] of Object.entries(equippedItems)) {
            if (!itemData?.itemHrid) continue;

            const itemHrid = itemData.itemHrid;
            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails) continue;

            // Get enhancement level from itemData (separate field, not in HRID)
            const enhancementLevel = itemData.enhancementLevel || 0;

            let itemCost = 0;

            // First, check if this is a token-based back slot item (cape/cloak/quiver)
            const tokenValue = calculateTokenBasedItemValue(itemHrid);
            if (tokenValue > 0) {
                itemCost = tokenValue;
            } else {
                // Try market price (most items are purchased, not self-enhanced)
                const marketPrice = marketAPI.getPrice(itemHrid, enhancementLevel);

                if (marketPrice && marketPrice.ask > 0 && marketPrice.bid > 0) {
                    // Good market data exists - use actual market price
                    let ask = marketPrice.ask;
                    let bid = marketPrice.bid;

                    // Match MCS behavior: if one price is positive and other is negative, use positive for both
                    if (ask > 0 && bid < 0) {
                        bid = ask;
                    }
                    if (bid > 0 && ask < 0) {
                        ask = bid;
                    }

                    itemCost = (ask + bid) / 2;
                } else if (enhancementLevel > 1) {
                    // No market data or illiquid - calculate enhancement cost
                    const enhancementParams = getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        itemCost = enhancementPath.optimalStrategy.totalCost;
                    } else {
                        // Fallback to base market price if enhancement calculation fails
                        const basePrice = marketAPI.getPrice(itemHrid, 0);
                        if (basePrice) {
                            let ask = basePrice.ask;
                            let bid = basePrice.bid;

                            if (ask > 0 && bid < 0) {
                                bid = ask;
                            }
                            if (bid > 0 && ask < 0) {
                                ask = bid;
                            }

                            itemCost = (ask + bid) / 2;
                        }
                    }
                } else {
                    // Enhancement level 0 or 1, just use base market price
                    const basePrice = marketAPI.getPrice(itemHrid, 0);
                    if (basePrice) {
                        let ask = basePrice.ask;
                        let bid = basePrice.bid;

                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        itemCost = (ask + bid) / 2;
                    }
                }
            }

            totalValue += itemCost;

            // Format item name for display
            const itemName = itemDetails.name || itemHrid.replace('/items/', '');
            const displayName = enhancementLevel > 0 ? `${itemName} +${enhancementLevel}` : itemName;

            breakdown.push({
                name: displayName,
                value: (itemCost / 1_000_000).toFixed(1)
            });
        }

        // Convert to score (value / 1 million)
        const score = totalValue / 1_000_000;

        // Sort by value descending
        breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

        return { score, breakdown };
    }

    /**
     * Combat Score Display
     * Shows player gear score in a floating panel next to profile modal
     */


    /**
     * CombatScore class manages combat score display on profiles
     */
    class CombatScore {
        constructor() {
            this.isActive = false;
            this.currentPanel = null;
        }

        /**
         * Initialize combat score feature
         */
        initialize() {
            // Check if feature is enabled
            if (!config.getSetting('combatScore')) {
                return;
            }

            // Listen for profile_shared WebSocket messages
            webSocketHook.on('profile_shared', (data) => {
                this.handleProfileShared(data);
            });

            this.isActive = true;
        }

        /**
         * Handle profile_shared WebSocket message
         * @param {Object} profileData - Profile data from WebSocket
         */
        async handleProfileShared(profileData) {
            // Wait for profile panel to appear in DOM
            const profilePanel = await this.waitForProfilePanel();
            if (!profilePanel) {
                console.error('[CombatScore] Could not find profile panel');
                return;
            }

            // Find the modal container
            const modalContainer = profilePanel.closest('.Modal_modalContent__Iw0Yv') ||
                                  profilePanel.closest('[class*="Modal"]') ||
                                  profilePanel.parentElement;

            if (modalContainer) {
                await this.handleProfileOpen(profileData, modalContainer);
            }
        }

        /**
         * Wait for profile panel to appear in DOM
         * @returns {Promise<Element|null>} Profile panel element or null if timeout
         */
        async waitForProfilePanel() {
            for (let i = 0; i < 20; i++) {
                const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
                if (panel) {
                    return panel;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return null;
        }

        /**
         * Handle profile modal opening
         * @param {Object} profileData - Profile data from WebSocket
         * @param {Element} modalContainer - Modal container element
         */
        async handleProfileOpen(profileData, modalContainer) {
            try {
                // Calculate combat score
                const scoreData = await calculateCombatScore(profileData);

                // Display score panel
                this.showScorePanel(profileData, scoreData, modalContainer);
            } catch (error) {
                console.error('[CombatScore] Error handling profile:', error);
            }
        }

        /**
         * Show combat score panel next to profile
         * @param {Object} profileData - Profile data
         * @param {Object} scoreData - Calculated score data
         * @param {Element} modalContainer - Modal container element
         */
        showScorePanel(profileData, scoreData, modalContainer) {
            // Remove existing panel if any
            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }

            const playerName = profileData.profile?.sharableCharacter?.name || 'Player';
            const equipmentHiddenText = scoreData.equipmentHidden ? ' (Equipment hidden)' : '';

            // Create panel element
            const panel = document.createElement('div');
            panel.id = 'mwi-combat-score-panel';
            panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 12px;
            min-width: 180px;
            max-width: 280px;
            font-size: 0.875rem;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Build house breakdown HTML
            const houseBreakdownHTML = scoreData.breakdown.houses.map(item =>
                `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
            ).join('');

            // Build ability breakdown HTML
            const abilityBreakdownHTML = scoreData.breakdown.abilities.map(item =>
                `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
            ).join('');

            // Build equipment breakdown HTML
            const equipmentBreakdownHTML = scoreData.breakdown.equipment.map(item =>
                `<div style="margin-left: 10px; font-size: 0.8rem; color: #bbb;">${item.name}: ${numberFormatter(item.value)}</div>`
            ).join('');

            // Create panel HTML
            panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: bold; color: ${config.SCRIPT_COLOR_MAIN}; font-size: 0.9rem;">${playerName}</div>
                <span id="mwi-score-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="Close">×</span>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: #4CAF50;" id="mwi-score-toggle">
                + Combat Score: ${numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}
            </div>
            <div id="mwi-score-details" style="display: none; margin-left: 10px; color: #ddd;">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-house-toggle">
                    + House: ${numberFormatter(scoreData.house.toFixed(1))}
                </div>
                <div id="mwi-house-breakdown" style="display: none; margin-bottom: 6px;">
                    ${houseBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-ability-toggle">
                    + Ability: ${numberFormatter(scoreData.ability.toFixed(1))}
                </div>
                <div id="mwi-ability-breakdown" style="display: none; margin-bottom: 6px;">
                    ${abilityBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-equipment-toggle">
                    + Equipment: ${numberFormatter(scoreData.equipment.toFixed(1))}
                </div>
                <div id="mwi-equipment-breakdown" style="display: none;">
                    ${equipmentBreakdownHTML}
                </div>
            </div>
        `;

            document.body.appendChild(panel);
            this.currentPanel = panel;

            // Position panel next to modal
            this.positionPanel(panel, modalContainer);

            // Set up event listeners
            this.setupPanelEvents(panel, modalContainer, scoreData, equipmentHiddenText);

            // Set up cleanup observer
            this.setupCleanupObserver(panel, modalContainer);
        }

        /**
         * Position panel next to the modal
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         */
        positionPanel(panel, modal) {
            const modalRect = modal.getBoundingClientRect();
            const panelWidth = 220;
            const gap = 8;

            // Try right side first
            if (modalRect.right + gap + panelWidth < window.innerWidth) {
                panel.style.left = (modalRect.right + gap) + 'px';
            } else {
                // Fall back to left side
                panel.style.left = Math.max(10, modalRect.left - panelWidth - gap) + 'px';
            }

            panel.style.top = modalRect.top + 'px';
        }

        /**
         * Set up panel event listeners
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         * @param {Object} scoreData - Score data
         * @param {string} equipmentHiddenText - Equipment hidden text
         */
        setupPanelEvents(panel, modal, scoreData, equipmentHiddenText) {
            // Close button
            const closeBtn = panel.querySelector('#mwi-score-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    panel.remove();
                    this.currentPanel = null;
                });
                closeBtn.addEventListener('mouseover', () => {
                    closeBtn.style.color = '#fff';
                });
                closeBtn.addEventListener('mouseout', () => {
                    closeBtn.style.color = '#aaa';
                });
            }

            // Toggle main score details
            const toggleBtn = panel.querySelector('#mwi-score-toggle');
            const details = panel.querySelector('#mwi-score-details');
            if (toggleBtn && details) {
                toggleBtn.addEventListener('click', () => {
                    const isCollapsed = details.style.display === 'none';
                    details.style.display = isCollapsed ? 'block' : 'none';
                    toggleBtn.textContent =
                        (isCollapsed ? '- ' : '+ ') +
                        `Combat Score: ${numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}`;
                });
            }

            // Toggle house breakdown
            const houseToggle = panel.querySelector('#mwi-house-toggle');
            const houseBreakdown = panel.querySelector('#mwi-house-breakdown');
            if (houseToggle && houseBreakdown) {
                houseToggle.addEventListener('click', () => {
                    const isCollapsed = houseBreakdown.style.display === 'none';
                    houseBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    houseToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') +
                        `House: ${numberFormatter(scoreData.house.toFixed(1))}`;
                });
            }

            // Toggle ability breakdown
            const abilityToggle = panel.querySelector('#mwi-ability-toggle');
            const abilityBreakdown = panel.querySelector('#mwi-ability-breakdown');
            if (abilityToggle && abilityBreakdown) {
                abilityToggle.addEventListener('click', () => {
                    const isCollapsed = abilityBreakdown.style.display === 'none';
                    abilityBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    abilityToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') +
                        `Ability: ${numberFormatter(scoreData.ability.toFixed(1))}`;
                });
            }

            // Toggle equipment breakdown
            const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
            const equipmentBreakdown = panel.querySelector('#mwi-equipment-breakdown');
            if (equipmentToggle && equipmentBreakdown) {
                equipmentToggle.addEventListener('click', () => {
                    const isCollapsed = equipmentBreakdown.style.display === 'none';
                    equipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    equipmentToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') +
                        `Equipment: ${numberFormatter(scoreData.equipment.toFixed(1))}`;
                });
            }
        }

        /**
         * Set up cleanup observer to remove panel when modal closes
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         */
        setupCleanupObserver(panel, modal) {
            const cleanupObserver = new MutationObserver(() => {
                if (!document.body.contains(modal) || !document.querySelector('div.SharableProfile_overviewTab__W4dCV')) {
                    panel.remove();
                    this.currentPanel = null;
                    cleanupObserver.disconnect();
                }
            });

            cleanupObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const combatScore = new CombatScore();

    /**
     * Equipment Level Display
     * Shows item level in top right corner of equipment icons
     * Based on original MWI Tools implementation
     */


    /**
     * EquipmentLevelDisplay class adds level overlays to equipment icons
     */
    class EquipmentLevelDisplay {
        constructor() {
            this.unregisterHandler = null;
            this.isActive = false;
            this.processedDivs = new WeakSet(); // Track already-processed divs
        }

        /**
         * Initialize the equipment level display
         */
        initialize() {
            // Check if feature is enabled
            if (!config.getSetting('itemIconLevel')) {
                return;
            }

            // Register with centralized DOM observer
            this.unregisterHandler = domObserver.register(
                'EquipmentLevelDisplay',
                () => {
                    this.addItemLevels();
                }
            );

            // Process any existing items on page
            this.addItemLevels();

            this.isActive = true;
        }

        /**
         * Clean up
         */
        cleanup() {
            if (this.unregisterHandler) {
                this.unregisterHandler();
                this.unregisterHandler = null;
            }
            this.isActive = false;
        }

        /**
         * Add item levels to all equipment icons
         * Matches original MWI Tools logic with dungeon key zone info
         */
        addItemLevels() {
            // Find all item icon divs (the clickable containers)
            const iconDivs = document.querySelectorAll('div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6');

            for (const div of iconDivs) {
                // Skip if already processed
                if (this.processedDivs.has(div)) {
                    continue;
                }

                // Skip if already has a name element (tooltip is open)
                if (div.querySelector('div.Item_name__2C42x')) {
                    continue;
                }

                // Get the use element inside this div
                const useElement = div.querySelector('use');
                if (!useElement) {
                    continue;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    continue;
                }

                // Extract item HRID (e.g., "#cheese_sword" -> "/items/cheese_sword")
                const hrefName = href.split('#')[1];
                const itemHrid = `/items/${hrefName}`;

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // For equipment, show the level requirement (not itemLevel)
                // For ability books, show the ability level requirement
                // For dungeon entry keys, show zone index
                let displayText = null;

                if (itemDetails.equipmentDetail) {
                    // Equipment: Use levelRequirements from equipmentDetail
                    const levelReq = itemDetails.equipmentDetail.levelRequirements;
                    if (levelReq && levelReq.length > 0 && levelReq[0].level > 0) {
                        displayText = levelReq[0].level.toString();
                    }
                } else if (itemDetails.abilityBookDetail) {
                    // Ability book: Use level requirement from abilityBookDetail
                    const abilityLevelReq = itemDetails.abilityBookDetail.levelRequirements;
                    if (abilityLevelReq && abilityLevelReq.length > 0 && abilityLevelReq[0].level > 0) {
                        displayText = abilityLevelReq[0].level.toString();
                    }
                } else if (config.getSetting('showsKeyInfoInIcon') && this.isKeyOrFragment(itemHrid)) {
                    // Keys and fragments: Show zone/dungeon info
                    displayText = this.getKeyDisplayText(itemHrid);
                }

                // Add overlay if we have valid text to display
                if (displayText && !div.querySelector('div.script_itemLevel')) {
                    div.style.position = 'relative';

                    // Position: bottom left for all items (matches market value style)
                    const position = 'bottom: 2px; left: 2px; text-align: left;';

                    div.insertAdjacentHTML(
                        'beforeend',
                        `<div class="script_itemLevel" style="z-index: 1; position: absolute; ${position} color: ${config.SCRIPT_COLOR_MAIN};">${displayText}</div>`
                    );
                    // Mark as processed
                    this.processedDivs.add(div);
                } else {
                    // No valid text or already has overlay, mark as processed
                    this.processedDivs.add(div);
                }
            }
        }

        /**
         * Check if item is a key or fragment
         * @param {string} itemHrid - Item HRID
         * @returns {boolean} True if item is a key or fragment
         */
        isKeyOrFragment(itemHrid) {
            return itemHrid.includes('_key') || itemHrid.includes('_fragment');
        }

        /**
         * Get display text for keys and fragments
         * Uses hardcoded mapping like MWI Tools
         * @param {string} itemHrid - Key/fragment HRID
         * @returns {string|null} Display text (e.g., "D1", "Z3", "3.4.5.6") or null
         */
        getKeyDisplayText(itemHrid) {
            const keyMap = new Map([
                // Key fragments (zones where they drop)
                ['/items/blue_key_fragment', 'Z3'],
                ['/items/green_key_fragment', 'Z4'],
                ['/items/purple_key_fragment', 'Z5'],
                ['/items/white_key_fragment', 'Z6'],
                ['/items/orange_key_fragment', 'Z7'],
                ['/items/brown_key_fragment', 'Z8'],
                ['/items/stone_key_fragment', 'Z9'],
                ['/items/dark_key_fragment', 'Z10'],
                ['/items/burning_key_fragment', 'Z11'],

                // Entry keys (dungeon identifiers)
                ['/items/chimerical_entry_key', 'D1'],
                ['/items/sinister_entry_key', 'D2'],
                ['/items/enchanted_entry_key', 'D3'],
                ['/items/pirate_entry_key', 'D4'],

                // Chest keys (zones where they drop)
                ['/items/chimerical_chest_key', '3.4.5.6'],
                ['/items/sinister_chest_key', '5.7.8.10'],
                ['/items/enchanted_chest_key', '7.8.9.11'],
                ['/items/pirate_chest_key', '6.9.10.11']
            ]);

            return keyMap.get(itemHrid) || null;
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Remove all level overlays
            const overlays = document.querySelectorAll('div.script_itemLevel');
            for (const overlay of overlays) {
                overlay.remove();
            }

            // Clear processed tracking
            this.processedDivs = new WeakSet();

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const equipmentLevelDisplay = new EquipmentLevelDisplay();

    /**
     * Alchemy Item Dimming
     * Dims items in alchemy panel that require higher level than player has
     * Player must have Alchemy level >= itemLevel to perform alchemy actions
     */


    /**
     * AlchemyItemDimming class dims items based on level requirements
     */
    class AlchemyItemDimming {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
            this.processedDivs = new WeakSet(); // Track already-processed divs
        }

        /**
         * Initialize the alchemy item dimming
         */
        initialize() {
            // Check if feature is enabled
            if (!config.getSetting('alchemyItemDimming')) {
                return;
            }

            // Register with centralized observer to watch for alchemy panel
            this.unregisterObserver = domObserver.onClass(
                'AlchemyItemDimming',
                'ItemSelector_menu__12sEM',
                () => {
                    this.processAlchemyItems();
                }
            );

            // Process any existing items on page
            this.processAlchemyItems();

            this.isActive = true;
        }

        /**
         * Process all items in the alchemy panel
         */
        processAlchemyItems() {
            // Check if alchemy panel is open
            const alchemyPanel = this.findAlchemyPanel();
            if (!alchemyPanel) {
                return;
            }

            // Get player's Alchemy level
            const skills = dataManager.getSkills();
            if (!skills) {
                return;
            }

            const alchemySkill = skills.find(s => s.skillHrid === '/skills/alchemy');
            const playerAlchemyLevel = alchemySkill?.level || 1;

            // Find all item icon divs within the alchemy panel
            const iconDivs = alchemyPanel.querySelectorAll('div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6');

            for (const div of iconDivs) {
                // Skip if already processed
                if (this.processedDivs.has(div)) {
                    continue;
                }

                // Get the use element inside this div
                const useElement = div.querySelector('use');
                if (!useElement) {
                    continue;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    continue;
                }

                // Extract item HRID (e.g., "#cheese_sword" -> "/items/cheese_sword")
                const hrefName = href.split('#')[1];
                const itemHrid = `/items/${hrefName}`;

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Get item's alchemy level requirement
                const itemLevel = itemDetails.itemLevel || 0;

                // Apply dimming if player level is too low
                if (playerAlchemyLevel < itemLevel) {
                    div.style.opacity = '0.5';
                    div.style.pointerEvents = 'auto'; // Still clickable
                    div.classList.add('mwi-alchemy-dimmed');
                } else {
                    // Remove dimming if level is now sufficient (player leveled up)
                    div.style.opacity = '1';
                    div.classList.remove('mwi-alchemy-dimmed');
                }

                // Mark as processed
                this.processedDivs.add(div);
            }
        }

        /**
         * Find the alchemy panel in the DOM
         * @returns {Element|null} Alchemy panel element or null
         */
        findAlchemyPanel() {
            // The alchemy item selector is a MuiTooltip dropdown with ItemSelector_menu class
            // It appears when clicking in the "Alchemize Item" box
            const itemSelectorMenus = document.querySelectorAll('div.ItemSelector_menu__12sEM');

            // Check each menu to find the one with "Alchemize Item" label
            for (const menu of itemSelectorMenus) {
                // Look for the ItemSelector_label element in the document
                // (It's not a direct sibling, it's part of the button that opens this menu)
                const alchemyLabels = document.querySelectorAll('div.ItemSelector_label__22ds9');

                for (const label of alchemyLabels) {
                    if (label.textContent.trim() === 'Alchemize Item') {
                        // Found the alchemy label, this menu is likely the alchemy selector
                        return menu;
                    }
                }
            }

            return null;
        }

        /**
         * Disable the feature
         */
        disable() {
            // Unregister from centralized observer
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all dimming effects
            const dimmedItems = document.querySelectorAll('.mwi-alchemy-dimmed');
            for (const item of dimmedItems) {
                item.style.opacity = '1';
                item.classList.remove('mwi-alchemy-dimmed');
            }

            // Clear processed tracking
            this.processedDivs = new WeakSet();

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const alchemyItemDimming = new AlchemyItemDimming();

    /**
     * Skill Experience Percentage Display
     * Shows XP progress percentage in the left sidebar skill list
     */


    class SkillExperiencePercentage {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedBars = new WeakSet();
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (!config.isFeatureEnabled('skillExperiencePercentage')) {
                return;
            }

            this.isActive = true;
            this.registerObservers();

            // Initial update for existing skills
            this.updateAllSkills();
        }

        /**
         * Register DOM observers
         */
        registerObservers() {
            // Watch for progress bars appearing/changing
            const unregister = domObserver.onClass(
                'SkillExpPercentage',
                'NavigationBar_currentExperience',
                (progressBar) => {
                    this.updateSkillPercentage(progressBar);
                }
            );
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Update all existing skills on page
         */
        updateAllSkills() {
            const progressBars = document.querySelectorAll('[class*="NavigationBar_currentExperience"]');
            progressBars.forEach(bar => this.updateSkillPercentage(bar));
        }

        /**
         * Update a single skill's percentage display
         * @param {Element} progressBar - The progress bar element
         */
        updateSkillPercentage(progressBar) {
            // Get the skill container
            const skillContainer = progressBar.parentNode?.parentNode;
            if (!skillContainer) return;

            // Get the level display container (first child of skill container)
            const levelContainer = skillContainer.children[0];
            if (!levelContainer) return;

            // Find the NavigationBar_level span to set its width
            const levelSpan = skillContainer.querySelector('[class*="NavigationBar_level"]');
            if (levelSpan) {
                levelSpan.style.width = 'auto';
            }

            // Extract percentage from progress bar width
            const widthStyle = progressBar.style.width;
            if (!widthStyle) return;

            const percentage = parseFloat(widthStyle.replace('%', ''));
            if (isNaN(percentage)) return;

            // Format with 1 decimal place
            const formattedPercentage = percentage.toFixed(1) + '%';

            // Check if we already have a percentage span
            let percentageSpan = levelContainer.querySelector('.mwi-exp-percentage');

            if (percentageSpan) {
                // Update existing span
                if (percentageSpan.textContent !== formattedPercentage) {
                    percentageSpan.textContent = formattedPercentage;
                }
            } else {
                // Create new span
                percentageSpan = document.createElement('span');
                percentageSpan.className = 'mwi-exp-percentage';
                percentageSpan.textContent = formattedPercentage;
                percentageSpan.style.fontSize = '0.875rem';
                percentageSpan.style.color = config.SCRIPT_COLOR_MAIN;

                // Insert percentage before children[1] (same as original)
                levelContainer.insertBefore(percentageSpan, levelContainer.children[1]);
            }
        }

        /**
         * Disable the feature
         */
        disable() {
            // Remove all percentage spans
            document.querySelectorAll('.mwi-exp-percentage').forEach(span => span.remove());

            // Unregister observers
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];

            this.processedBars.clear();
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const skillExperiencePercentage = new SkillExperiencePercentage();

    /**
     * Task Profit Calculator
     * Calculates total profit for gathering and production tasks
     * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
     */


    /**
     * Calculate Task Token value from Task Shop items
     * Uses same approach as Ranged Way Idle - find best Task Shop item
     * @returns {Object} Token value breakdown or error state
     */
    function calculateTaskTokenValue() {
        // Return error state if expected value calculator isn't ready
        if (!expectedValueCalculator.isInitialized) {
            return {
                tokenValue: null,
                giftPerTask: null,
                totalPerToken: null,
                error: 'Market data not loaded'
            };
        }

        const taskShopItems = [
            '/items/large_meteorite_cache',
            '/items/large_artisans_crate',
            '/items/large_treasure_chest'
        ];

        // Get expected value of each Task Shop item (all cost 30 tokens)
        const expectedValues = taskShopItems.map(itemHrid => {
            const result = expectedValueCalculator.calculateExpectedValue(itemHrid);
            return result?.expectedValue || 0;
        });

        // Use best (highest value) item
        const bestValue = Math.max(...expectedValues);

        // Task Token value = best chest value / 30 (cost in tokens)
        const taskTokenValue = bestValue / 30;

        // Calculate Purple's Gift prorated value (divide by 50 tasks)
        const giftResult = expectedValueCalculator.calculateExpectedValue('/items/purples_gift');
        const giftValue = giftResult?.expectedValue || 0;
        const giftPerTask = giftValue / 50;

        return {
            tokenValue: taskTokenValue,
            giftPerTask: giftPerTask,
            totalPerToken: taskTokenValue + giftPerTask,
            error: null
        };
    }

    /**
     * Calculate task reward value (coins + tokens + Purple's Gift)
     * @param {number} coinReward - Coin reward amount
     * @param {number} taskTokenReward - Task token reward amount
     * @returns {Object} Reward value breakdown
     */
    function calculateTaskRewardValue(coinReward, taskTokenReward) {
        const tokenData = calculateTaskTokenValue();

        // Handle error state (market data not loaded)
        if (tokenData.error) {
            return {
                coins: coinReward,
                taskTokens: 0,
                purpleGift: 0,
                total: coinReward,
                breakdown: {
                    tokenValue: 0,
                    tokensReceived: taskTokenReward,
                    giftPerTask: 0
                },
                error: tokenData.error
            };
        }

        const taskTokenValue = taskTokenReward * tokenData.tokenValue;
        const purpleGiftValue = taskTokenReward * tokenData.giftPerTask;

        return {
            coins: coinReward,
            taskTokens: taskTokenValue,
            purpleGift: purpleGiftValue,
            total: coinReward + taskTokenValue + purpleGiftValue,
            breakdown: {
                tokenValue: tokenData.tokenValue,
                tokensReceived: taskTokenReward,
                giftPerTask: tokenData.giftPerTask
            },
            error: null
        };
    }

    /**
     * Detect task type from description
     * @param {string} taskDescription - Task description text (e.g., "Cheesesmithing - Holy Cheese")
     * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
     */
    function detectTaskType(taskDescription) {
        // Extract skill from "Skill - Action" format
        const skillMatch = taskDescription.match(/^([^-]+)\s*-/);
        if (!skillMatch) return 'unknown';

        const skill = skillMatch[1].trim().toLowerCase();

        // Gathering skills
        if (['foraging', 'woodcutting', 'milking'].includes(skill)) {
            return 'gathering';
        }

        // Production skills
        if (['cheesesmithing', 'brewing', 'cooking', 'crafting', 'tailoring'].includes(skill)) {
            return 'production';
        }

        // Combat
        if (skill === 'defeat') {
            return 'combat';
        }

        return 'unknown';
    }

    /**
     * Parse task description to extract action HRID
     * Format: "Skill - Action Name" (e.g., "Cheesesmithing - Holy Cheese", "Milking - Cow")
     * @param {string} taskDescription - Task description text
     * @param {string} taskType - Task type (gathering/production)
     * @param {number} quantity - Task quantity
     * @param {number} currentProgress - Current progress (actions completed)
     * @returns {Object|null} {actionHrid, quantity, currentProgress, description} or null if parsing fails
     */
    function parseTaskDescription(taskDescription, taskType, quantity, currentProgress) {

        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return null;
        }

        const actionDetailMap = gameData.actionDetailMap;
        if (!actionDetailMap) {
            return null;
        }

        // Extract action name from "Skill - Action" format
        const match = taskDescription.match(/^[^-]+\s*-\s*(.+)$/);
        if (!match) {
            return null;
        }

        const actionName = match[1].trim();

        // Find matching action HRID by searching for action name in action details
        for (const [actionHrid, actionDetail] of Object.entries(actionDetailMap)) {
            if (actionDetail.name && actionDetail.name.toLowerCase() === actionName.toLowerCase()) {
                return { actionHrid, quantity, currentProgress, description: taskDescription };
            }
        }

        return null;
    }

    /**
     * Calculate gathering task profit
     * @param {string} actionHrid - Action HRID
     * @param {number} quantity - Number of times to perform action
     * @returns {Promise<Object>} Profit breakdown
     */
    async function calculateGatheringTaskProfit(actionHrid, quantity) {

        let profitData;
        try {
            profitData = await calculateGatheringProfit(actionHrid);
        } catch (error) {
            profitData = null;
        }

        if (!profitData) {
            return {
                totalValue: 0,
                breakdown: {
                    actionHrid,
                    quantity,
                    perAction: 0
                }
            };
        }

        // Calculate per-action profit from per-hour profit
        const profitPerAction = profitData.profitPerHour / profitData.actionsPerHour;

        return {
            totalValue: profitPerAction * quantity,
            breakdown: {
                actionHrid,
                quantity,
                perAction: profitPerAction
            },
            // Include detailed data for expandable display
            details: {
                actionsPerHour: profitData.actionsPerHour,
                baseOutputs: profitData.baseOutputs,
                bonusRevenue: profitData.bonusRevenue,
                processingConversions: profitData.processingConversions,
                processingRevenueBonus: profitData.processingRevenueBonus,
                efficiencyMultiplier: profitData.efficiencyMultiplier
            }
        };
    }

    /**
     * Calculate production task profit
     * @param {string} actionHrid - Action HRID
     * @param {number} quantity - Number of times to perform action
     * @returns {Promise<Object>} Profit breakdown
     */
    async function calculateProductionTaskProfit(actionHrid, quantity) {

        let profitData;
        try {
            profitData = await calculateProductionProfit(actionHrid);
        } catch (error) {
            profitData = null;
        }


        if (!profitData) {
            return {
                totalProfit: 0,
                breakdown: {
                    actionHrid,
                    quantity,
                    outputValue: 0,
                    materialCost: 0,
                    perAction: 0
                }
            };
        }

        // Calculate per-action values from per-hour values
        const profitPerAction = profitData.profitPerHour / profitData.actionsPerHour;
        const revenuePerAction = (profitData.itemsPerHour * profitData.priceAfterTax + profitData.gourmetBonusItems * profitData.priceAfterTax) / profitData.actionsPerHour;
        const costsPerAction = (profitData.materialCostPerHour + profitData.totalTeaCostPerHour) / profitData.actionsPerHour;

        return {
            totalProfit: profitPerAction * quantity,
            breakdown: {
                actionHrid,
                quantity,
                outputValue: revenuePerAction * quantity,
                materialCost: costsPerAction * quantity,
                perAction: profitPerAction
            },
            // Include detailed data for expandable display
            details: {
                materialCosts: profitData.materialCosts,
                teaCosts: profitData.teaCosts,
                baseOutputItems: profitData.itemsPerHour,
                gourmetBonusItems: profitData.gourmetBonusItems,
                priceEach: profitData.priceAfterTax,
                actionsPerHour: profitData.actionsPerHour,
                itemsPerAction: profitData.itemsPerHour / profitData.actionsPerHour,
                bonusRevenue: profitData.bonusRevenue, // Pass through bonus revenue data
                efficiencyMultiplier: profitData.details?.efficiencyMultiplier || 1 // Pass through efficiency multiplier
            }
        };
    }

    /**
     * Calculate complete task profit
     * @param {Object} taskData - Task data {description, coinReward, taskTokenReward}
     * @returns {Promise<Object|null>} Complete profit breakdown or null for combat/unknown tasks
     */
    async function calculateTaskProfit(taskData) {
        const taskType = detectTaskType(taskData.description);

        // Skip combat tasks entirely
        if (taskType === 'combat') {
            return null;
        }

        // Parse task details
        const taskInfo = parseTaskDescription(taskData.description, taskType, taskData.quantity, taskData.currentProgress);
        if (!taskInfo) {
            // Return error state for UI to display "Unable to calculate"
            return {
                type: taskType,
                error: 'Unable to parse task description',
                totalProfit: 0
            };
        }

        // Calculate task rewards
        const rewardValue = calculateTaskRewardValue(
            taskData.coinReward,
            taskData.taskTokenReward
        );

        // Calculate action profit based on task type
        let actionProfit = null;
        if (taskType === 'gathering') {
            actionProfit = await calculateGatheringTaskProfit(
                taskInfo.actionHrid,
                taskInfo.quantity
            );
        } else if (taskType === 'production') {
            actionProfit = await calculateProductionTaskProfit(
                taskInfo.actionHrid,
                taskInfo.quantity
            );
        }

        if (!actionProfit) {
            return {
                type: taskType,
                error: 'Unable to calculate action profit',
                totalProfit: 0
            };
        }

        // Calculate total profit
        const actionValue = taskType === 'production' ? actionProfit.totalProfit : actionProfit.totalValue;
        const totalProfit = rewardValue.total + actionValue;

        return {
            type: taskType,
            totalProfit,
            rewards: rewardValue,
            action: actionProfit,
            taskInfo: taskInfo
        };
    }

    /**
     * DOM Selector Constants
     * Centralized selector strings for querying game elements
     * If game class names change, update here only
     */

    /**
     * Game UI Selectors (class names from game code)
     */
    const GAME = {
        // Header
        TOTAL_LEVEL: '[class*="Header_totalLevel"]',

        // Settings Panel
        SETTINGS_PANEL_TITLE: '[class*="SettingsPanel_title"]',
        SETTINGS_TABS_CONTAINER: 'div[class*="SettingsPanel_tabsComponentContainer"]',
        TABS_FLEX_CONTAINER: '[class*="MuiTabs-flexContainer"]',
        TAB_PANELS_CONTAINER: '[class*="TabsComponent_tabPanelsContainer"]',
        TAB_PANEL: '[class*="TabPanel_tabPanel"]',

        // Game Panel
        GAME_PANEL: 'div[class*="GamePage_gamePanel"]',

        // Skill Action Detail
        SKILL_ACTION_DETAIL: '[class*="SkillActionDetail_skillActionDetail"]',
        SKILL_ACTION_NAME: '[class*="SkillActionDetail_name"]',
        ENHANCING_COMPONENT: 'div.SkillActionDetail_enhancingComponent__17bOx',

        // Action Queue
        QUEUED_ACTIONS: '[class*="QueuedActions_action"]',
        MAX_ACTION_COUNT_INPUT: '[class*="maxActionCountInput"]',

        // Tasks
        TASK_LIST: '[class*="TasksPanel_taskList"]',
        TASK_CARD: '[class*="RandomTask_randomTask"]',
        TASK_NAME: '[class*="RandomTask_name"]',
        TASK_INFO: '.RandomTask_taskInfo__1uasf',
        TASK_ACTION: '.RandomTask_action__3eC6o',
        TASK_REWARDS: '.RandomTask_rewards__YZk7D',
        TASK_CONTENT: '[class*="RandomTask_content"]',
        TASK_NAME_DIV: 'div[class*="RandomTask_name"]',

        // House Panel
        HOUSE_HEADER: '[class*="HousePanel_header"]',
        HOUSE_COSTS: '[class*="HousePanel_costs"]',
        HOUSE_ITEM_REQUIREMENTS: '[class*="HousePanel_itemRequirements"]',

        // Inventory
        INVENTORY_ITEMS: '[class*="Inventory_items"]',
        INVENTORY_CATEGORY_BUTTON: '.Inventory_categoryButton__35s1x',
        INVENTORY_LABEL: '.Inventory_label__XEOAx',

        // Items
        ITEM_CONTAINER: '.Item_itemContainer__x7kH1',
        ITEM_ITEM: '.Item_item__2De2O',
        ITEM_COUNT: '.Item_count__1HVvv',
        ITEM_TOOLTIP_TEXT: '.ItemTooltipText_itemTooltipText__zFq3A',

        // Navigation/Experience Bars
        NAV_LEVEL: '[class*="NavigationBar_level"]',
        NAV_CURRENT_EXPERIENCE: '[class*="NavigationBar_currentExperience"]',

        // Enhancement
        PROTECTION_ITEM_INPUT: '[class*="protectionItemInputContainer"]',

        // Tooltips
        MUI_TOOLTIP: '.MuiTooltip-tooltip'
    };

    /**
     * Toolasha-specific selectors (our injected elements)
     */
    const TOOLASHA = {
        // Settings
        SETTINGS_TAB: '#toolasha-settings-tab',
        SETTING_WITH_DEPS: '.toolasha-setting[data-dependencies]',

        // Task features
        TASK_PROFIT: '.mwi-task-profit',
        REROLL_COST_DISPLAY: '.mwi-reroll-cost-display',

        // Action features
        QUEUE_TOTAL_TIME: '#mwi-queue-total-time',
        FORAGING_PROFIT: '#mwi-foraging-profit',
        PRODUCTION_PROFIT: '#mwi-production-profit',

        // House features
        HOUSE_PRICING: '.mwi-house-pricing',
        HOUSE_PRICING_EMPTY: '.mwi-house-pricing-empty',
        HOUSE_TOTAL: '.mwi-house-total',
        HOUSE_TO_LEVEL: '.mwi-house-to-level',

        // Profile/Combat Score
        SCORE_CLOSE_BTN: '#mwi-score-close-btn',
        SCORE_TOGGLE: '#mwi-score-toggle',
        SCORE_DETAILS: '#mwi-score-details',
        HOUSE_TOGGLE: '#mwi-house-toggle',
        HOUSE_BREAKDOWN: '#mwi-house-breakdown',
        ABILITY_TOGGLE: '#mwi-ability-toggle',
        ABILITY_BREAKDOWN: '#mwi-ability-breakdown',
        EQUIPMENT_TOGGLE: '#mwi-equipment-toggle',
        EQUIPMENT_BREAKDOWN: '#mwi-equipment-breakdown',

        // Market features
        MARKET_PRICE_INJECTED: '.market-price-injected',
        MARKET_PROFIT_INJECTED: '.market-profit-injected',
        MARKET_EV_INJECTED: '.market-ev-injected',
        MARKET_ENHANCEMENT_INJECTED: '.market-enhancement-injected',

        // UI features
        ALCHEMY_DIMMED: '.mwi-alchemy-dimmed',
        EXP_PERCENTAGE: '.mwi-exp-percentage',
        STACK_PRICE: '.mwi-stack-price',
        NETWORTH_HEADER: '.mwi-networth-header',

        // Enhancement
        ENHANCEMENT_STATS: '#mwi-enhancement-stats',

        // Generic
        COLLAPSIBLE_SECTION: '.mwi-collapsible-section',
        EXPANDABLE_HEADER: '.mwi-expandable-header',
        SECTION_HEADER_NEXT: '.mwi-section-header + div',

        // Legacy/cleanup markers
        INSERTED_SPAN: '.insertedSpan',
        SCRIPT_INJECTED: '.script-injected',
        CONSUMABLE_STATS_INJECTED: '.consumable-stats-injected'
    };

    /**
     * Task Profit Display
     * Shows profit calculation on task cards
     * Expandable breakdown on click
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_TASK_PROGRESS = /(\d+)\s*\/\s*(\d+)/;

    /**
     * TaskProfitDisplay class manages task profit UI
     */
    class TaskProfitDisplay {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = []; // Store unregister functions
            this.retryHandler = null; // Retry handler reference for cleanup
            this.marketDataRetryHandler = null; // Market data retry handler
            this.pendingTaskNodes = new Set(); // Track task nodes waiting for data
            this.eventListeners = new WeakMap(); // Store listeners for cleanup
        }

        /**
         * Initialize task profit display
         */
        initialize() {
            if (!config.getSetting('taskProfitCalculator')) {
                return;
            }

            // Set up retry handler for when game data loads
            if (!dataManager.getInitClientData()) {
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        // Retry all pending task nodes
                        this.retryPendingTasks();
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
            }

            // Set up retry handler for when market data loads
            if (!this.marketDataRetryHandler) {
                this.marketDataRetryHandler = () => {
                    // Retry all pending task nodes when market data becomes available
                    this.retryPendingTasks();
                };
                dataManager.on('expected_value_initialized', this.marketDataRetryHandler);
            }

            // Register WebSocket listener for task updates
            this.registerWebSocketListeners();

            // Register DOM observers for task panel appearance
            this.registerDOMObservers();

            // Initial update
            this.updateTaskProfits();

            this.isActive = true;
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const questsHandler = (data) => {
                if (!data.endCharacterQuests) return;

                // Wait for game to update DOM before recalculating profits
                setTimeout(() => {
                    this.updateTaskProfits();
                }, 250);
            };

            webSocketHook.on('quests_updated', questsHandler);

            // Store handler for cleanup
            this.unregisterHandlers.push(() => {
                webSocketHook.off('quests_updated', questsHandler);
            });

        }

        /**
         * Register DOM observers
         */
        registerDOMObservers() {
            // Watch for task list appearing
            const unregisterTaskList = domObserver.onClass(
                'TaskProfitDisplay-TaskList',
                'TasksPanel_taskList',
                () => {
                    this.updateTaskProfits();
                }
            );
            this.unregisterHandlers.push(unregisterTaskList);

            // Watch for individual tasks appearing
            const unregisterTask = domObserver.onClass(
                'TaskProfitDisplay-Task',
                'RandomTask_randomTask',
                () => {
                    // Small delay to let task data settle
                    setTimeout(() => this.updateTaskProfits(), 100);
                }
            );
            this.unregisterHandlers.push(unregisterTask);
        }

        /**
         * Update all task profit displays
         */
        updateTaskProfits() {
            if (!config.getSetting('taskProfitCalculator')) {
                return;
            }

            const taskListNode = document.querySelector(GAME.TASK_LIST);
            if (!taskListNode) return;

            const taskNodes = taskListNode.querySelectorAll(GAME.TASK_INFO);
            for (const taskNode of taskNodes) {
                // Get current task description to detect changes
                const taskData = this.parseTaskData(taskNode);
                if (!taskData) continue;

                const currentTaskKey = `${taskData.description}|${taskData.quantity}`;

                // Check if already processed
                const existingProfit = taskNode.querySelector(TOOLASHA.TASK_PROFIT);
                if (existingProfit) {
                    // Check if task has changed (rerolled)
                    const savedTaskKey = existingProfit.dataset.taskKey;
                    if (savedTaskKey === currentTaskKey) {
                        continue; // Same task, skip
                    }

                    // Task changed - clean up event listeners before removing
                    const listeners = this.eventListeners.get(existingProfit);
                    if (listeners) {
                        listeners.forEach((listener, element) => {
                            element.removeEventListener('click', listener);
                        });
                        this.eventListeners.delete(existingProfit);
                    }

                    // Remove ALL old profit displays (visible + hidden markers)
                    taskNode.querySelectorAll(TOOLASHA.TASK_PROFIT).forEach(el => el.remove());
                }

                this.addProfitToTask(taskNode);
            }
        }

        /**
         * Retry processing pending task nodes after data becomes available
         */
        retryPendingTasks() {
            if (!dataManager.getInitClientData()) {
                return; // Data still not ready
            }

            // Remove retry handler - we're ready now
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Process all pending tasks
            const pendingNodes = Array.from(this.pendingTaskNodes);
            this.pendingTaskNodes.clear();

            for (const taskNode of pendingNodes) {
                // Check if node still exists in DOM
                if (document.contains(taskNode)) {
                    this.addProfitToTask(taskNode);
                }
            }
        }

        /**
         * Add profit display to a task card
         * @param {Element} taskNode - Task card DOM element
         */
        async addProfitToTask(taskNode) {
            try {
                // Check if game data is ready
                if (!dataManager.getInitClientData()) {
                    // Game data not ready - add to pending queue
                    this.pendingTaskNodes.add(taskNode);
                    return;
                }

                // Double-check we haven't already processed this task
                // (check again in case another async call beat us to it)
                if (taskNode.querySelector(TOOLASHA.TASK_PROFIT)) {
                    return;
                }

                // Parse task data from DOM
                const taskData = this.parseTaskData(taskNode);
                if (!taskData) {
                    return;
                }

                // Calculate profit
                const profitData = await calculateTaskProfit(taskData);

                // Don't show anything for combat tasks, but mark them so we detect rerolls
                if (profitData === null) {
                    // Add hidden marker for combat tasks to enable reroll detection
                    const combatMarker = document.createElement('div');
                    combatMarker.className = 'mwi-task-profit';
                    combatMarker.style.display = 'none';
                    combatMarker.dataset.taskKey = `${taskData.description}|${taskData.quantity}`;

                    const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
                    if (actionNode) {
                        actionNode.appendChild(combatMarker);
                    }
                    return;
                }

                // Handle market data not loaded - add to pending queue
                if (profitData.error === 'Market data not loaded' ||
                    (profitData.rewards && profitData.rewards.error === 'Market data not loaded')) {

                    // Add to pending queue
                    this.pendingTaskNodes.add(taskNode);

                    // Show loading state instead of error
                    this.displayLoadingState(taskNode, taskData);
                    return;
                }

                // Check one more time before adding (another async call might have added it)
                if (taskNode.querySelector(TOOLASHA.TASK_PROFIT)) {
                    return;
                }

                // Display profit
                this.displayTaskProfit(taskNode, profitData);

            } catch (error) {
                console.error('[Task Profit Display] Failed to calculate profit:', error);

                // Display error state in UI
                this.displayErrorState(taskNode, 'Unable to calculate profit');

                // Remove from pending queue if present
                this.pendingTaskNodes.delete(taskNode);
            }
        }

        /**
         * Parse task data from DOM
         * @param {Element} taskNode - Task card DOM element
         * @returns {Object|null} {description, coinReward, taskTokenReward, quantity}
         */
        parseTaskData(taskNode) {
            // Get task description
            const nameNode = taskNode.querySelector(GAME.TASK_NAME_DIV);
            if (!nameNode) return null;

            const description = nameNode.textContent.trim();

            // Get quantity from progress (plain div with text "Progress: 0 / 1562")
            // Find all divs in taskInfo and look for the one containing "Progress:"
            let quantity = 0;
            let currentProgress = 0;
            const taskInfoDivs = taskNode.querySelectorAll('div');
            for (const div of taskInfoDivs) {
                const text = div.textContent.trim();
                if (text.startsWith('Progress:')) {
                    const match = text.match(REGEX_TASK_PROGRESS);
                    if (match) {
                        currentProgress = parseInt(match[1]); // Current progress
                        quantity = parseInt(match[2]); // Total quantity
                    }
                    break;
                }
            }

            // Get rewards
            const rewardsNode = taskNode.querySelector(GAME.TASK_REWARDS);
            if (!rewardsNode) return null;

            let coinReward = 0;
            let taskTokenReward = 0;

            const itemContainers = rewardsNode.querySelectorAll(GAME.ITEM_CONTAINER);

            for (const container of itemContainers) {
                const useElement = container.querySelector('use');
                if (!useElement) continue;

                const href = useElement.href.baseVal;

                if (href.includes('coin')) {
                    const countNode = container.querySelector(GAME.ITEM_COUNT);
                    if (countNode) {
                        coinReward = this.parseItemCount(countNode.textContent);
                    }
                } else if (href.includes('task_token')) {
                    const countNode = container.querySelector(GAME.ITEM_COUNT);
                    if (countNode) {
                        taskTokenReward = this.parseItemCount(countNode.textContent);
                    }
                }
            }

            const taskData = {
                description,
                coinReward,
                taskTokenReward,
                quantity,
                currentProgress
            };

            return taskData;
        }

        /**
         * Parse item count from text (handles K/M suffixes)
         * @param {string} text - Count text (e.g., "1.5K")
         * @returns {number} Parsed count
         */
        parseItemCount(text) {
            text = text.trim();

            if (text.includes('K')) {
                return parseFloat(text.replace('K', '')) * 1000;
            } else if (text.includes('M')) {
                return parseFloat(text.replace('M', '')) * 1000000;
            }

            return parseFloat(text) || 0;
        }

        /**
         * Display profit on task card
         * @param {Element} taskNode - Task card DOM element
         * @param {Object} profitData - Profit calculation result
         */
        displayTaskProfit(taskNode, profitData) {
            const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create profit container
            const profitContainer = document.createElement('div');
            profitContainer.className = 'mwi-task-profit';
            profitContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
        `;

            // Store task key for reroll detection
            if (profitData.taskInfo) {
                const taskKey = `${profitData.taskInfo.description}|${profitData.taskInfo.quantity}`;
                profitContainer.dataset.taskKey = taskKey;
            }

            // Check for error state
            if (profitData.error) {
                profitContainer.innerHTML = `
                <div style="color: ${config.SCRIPT_COLOR_ALERT};">
                    Unable to calculate profit
                </div>
            `;
                actionNode.appendChild(profitContainer);
                return;
            }

            // Calculate time estimate for task completion
            let timeEstimate = '???';
            if (profitData.action?.details?.actionsPerHour && profitData.taskInfo?.quantity) {
                const actionsPerHour = profitData.action.details.actionsPerHour;
                const totalQuantity = profitData.taskInfo.quantity;
                const currentProgress = profitData.taskInfo.currentProgress || 0;
                const remainingActions = totalQuantity - currentProgress;
                const efficiencyMultiplier = profitData.action.details.efficiencyMultiplier || 1;

                // Efficiency reduces the number of actions needed
                const actualActionsNeeded = remainingActions / efficiencyMultiplier;
                const totalSeconds = (actualActionsNeeded / actionsPerHour) * 3600;
                timeEstimate = timeReadable(totalSeconds);
            }

            // Create main profit display (Option B format: compact with time)
            const profitLine = document.createElement('div');
            profitLine.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            cursor: pointer;
            user-select: none;
        `;
            profitLine.textContent = `💰 ${numberFormatter(profitData.totalProfit)} | ⏱ ${timeEstimate} ▸`;

            // Create breakdown section (hidden by default)
            const breakdownSection = document.createElement('div');
            breakdownSection.className = 'mwi-task-profit-breakdown';
            breakdownSection.style.cssText = `
            display: none;
            margin-top: 6px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.7rem;
            color: #ddd;
        `;

            // Build breakdown HTML
            breakdownSection.innerHTML = this.buildBreakdownHTML(profitData);

            // Store listener references for cleanup
            const listeners = new Map();

            // Add click handlers for expandable sections
            breakdownSection.querySelectorAll('.mwi-expandable-header').forEach(header => {
                const listener = (e) => {
                    e.stopPropagation();
                    const section = header.getAttribute('data-section');
                    const detailSection = breakdownSection.querySelector(`.mwi-expandable-section[data-section="${section}"]`);

                    if (detailSection) {
                        const isHidden = detailSection.style.display === 'none';
                        detailSection.style.display = isHidden ? 'block' : 'none';

                        // Update arrow
                        const currentText = header.textContent;
                        header.textContent = currentText.replace(isHidden ? '▸' : '▾', isHidden ? '▾' : '▸');
                    }
                };

                header.addEventListener('click', listener);
                listeners.set(header, listener);
            });

            // Toggle breakdown on click
            const profitLineListener = (e) => {
                e.stopPropagation();
                const isHidden = breakdownSection.style.display === 'none';
                breakdownSection.style.display = isHidden ? 'block' : 'none';
                profitLine.textContent = `💰 ${numberFormatter(profitData.totalProfit)} | ⏱ ${timeEstimate} ${isHidden ? '▾' : '▸'}`;
            };

            profitLine.addEventListener('click', profitLineListener);
            listeners.set(profitLine, profitLineListener);

            // Store all listeners for cleanup
            this.eventListeners.set(profitContainer, listeners);

            profitContainer.appendChild(profitLine);
            profitContainer.appendChild(breakdownSection);
            actionNode.appendChild(profitContainer);
        }

        /**
         * Build breakdown HTML
         * @param {Object} profitData - Profit calculation result
         * @returns {string} HTML string
         */
        buildBreakdownHTML(profitData) {
            const lines = [];

            lines.push('<div style="font-weight: bold; margin-bottom: 4px;">Task Profit Breakdown</div>');
            lines.push('<div style="border-bottom: 1px solid #555; margin-bottom: 4px;"></div>');

            // Show warning if market data unavailable
            if (profitData.rewards.error) {
                lines.push(`<div style="color: ${config.SCRIPT_COLOR_ALERT}; margin-bottom: 6px; font-style: italic;">⚠ ${profitData.rewards.error} - Token values unavailable</div>`);
            }

            // Task Rewards section
            lines.push('<div style="margin-bottom: 4px; color: #aaa;">Task Rewards:</div>');
            lines.push(`<div style="margin-left: 10px;">Coins: ${numberFormatter(profitData.rewards.coins)}</div>`);

            if (!profitData.rewards.error) {
                lines.push(`<div style="margin-left: 10px;">Task Tokens: ${numberFormatter(profitData.rewards.taskTokens)}</div>`);
                lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.rewards.breakdown.tokensReceived} tokens @ ${numberFormatter(profitData.rewards.breakdown.tokenValue.toFixed(0))} each)</div>`);
                lines.push(`<div style="margin-left: 10px;">Purple's Gift: ${numberFormatter(profitData.rewards.purpleGift)}</div>`);
                lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${numberFormatter(profitData.rewards.breakdown.giftPerTask.toFixed(0))} per task)</div>`);
            } else {
                lines.push(`<div style="margin-left: 10px; color: #888; font-style: italic;">Task Tokens: Loading...</div>`);
                lines.push(`<div style="margin-left: 10px; color: #888; font-style: italic;">Purple's Gift: Loading...</div>`);
            }
            // Action profit section
            lines.push('<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Action Profit:</div>');

            if (profitData.type === 'gathering') {
                // Gathering Value (expandable)
                lines.push(`<div class="mwi-expandable-header" data-section="gathering" style="margin-left: 10px; cursor: pointer; user-select: none;">Gathering Value: ${numberFormatter(profitData.action.totalValue)} ▸</div>`);
                lines.push(`<div class="mwi-expandable-section" data-section="gathering" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`);

                if (profitData.action.details) {
                    const details = profitData.action.details;
                    const quantity = profitData.action.breakdown.quantity;
                    const actionsPerHour = details.actionsPerHour;
                    const hoursNeeded = quantity / actionsPerHour;

                    // Base outputs (gathered items)
                    if (details.baseOutputs && details.baseOutputs.length > 0) {
                        lines.push(`<div style="margin-top: 2px; color: #aaa;">Items Gathered:</div>`);
                        for (const output of details.baseOutputs) {
                            const itemsForTask = (output.itemsPerHour / actionsPerHour) * quantity;
                            const revenueForTask = output.revenuePerHour * hoursNeeded;
                            const dropRateText = output.dropRate < 1.0 ? ` (${(output.dropRate * 100).toFixed(1)}% drop)` : '';
                            const processingText = output.isProcessed ? ` [${(output.processingChance * 100).toFixed(1)}% processed]` : '';
                            lines.push(`<div>• ${output.name}: ${itemsForTask.toFixed(1)} items @ ${numberFormatter(Math.round(output.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}${dropRateText}${processingText}</div>`);
                        }
                    }

                    // Bonus Revenue (essence and rare finds)
                    if (details.bonusRevenue && details.bonusRevenue.bonusDrops && details.bonusRevenue.bonusDrops.length > 0) {
                        const bonusRevenue = details.bonusRevenue;
                        const efficiencyMultiplier = details.efficiencyMultiplier || 1;
                        const totalBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier * hoursNeeded;

                        lines.push(`<div style="margin-top: 4px; color: #aaa;">Bonus Drops: ${numberFormatter(Math.round(totalBonusRevenue))}</div>`);

                        // Group drops by type
                        const essenceDrops = bonusRevenue.bonusDrops.filter(d => d.type === 'essence');
                        const rareFindDrops = bonusRevenue.bonusDrops.filter(d => d.type === 'rare_find');

                        // Show essence drops
                        if (essenceDrops.length > 0) {
                            for (const drop of essenceDrops) {
                                const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                                const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                                lines.push(`<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`);
                            }
                        }

                        // Show rare find drops
                        if (rareFindDrops.length > 0) {
                            for (const drop of rareFindDrops) {
                                const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                                const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                                lines.push(`<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`);
                            }
                        }
                    }

                    // Processing conversions (raw → processed)
                    if (details.processingConversions && details.processingConversions.length > 0) {
                        const processingBonus = details.processingRevenueBonus * hoursNeeded;
                        lines.push(`<div style="margin-top: 4px; color: #aaa;">Processing Bonus: ${numberFormatter(Math.round(processingBonus))}</div>`);
                        for (const conversion of details.processingConversions) {
                            const conversionsForTask = conversion.conversionsPerHour * hoursNeeded;
                            const revenueForTask = conversion.revenuePerHour * hoursNeeded;
                            lines.push(`<div>• ${conversion.rawItem} → ${conversion.processedItem}: ${conversionsForTask.toFixed(1)} conversions, +${numberFormatter(Math.round(conversion.valueGain))} each = ${numberFormatter(Math.round(revenueForTask))}</div>`);
                        }
                    }
                }

                lines.push(`</div>`);
                lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`);
            } else if (profitData.type === 'production') {
                // Output Value (expandable)
                lines.push(`<div class="mwi-expandable-header" data-section="output" style="margin-left: 10px; cursor: pointer; user-select: none;">Output Value: ${numberFormatter(profitData.action.breakdown.outputValue)} ▸</div>`);
                lines.push(`<div class="mwi-expandable-section" data-section="output" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`);

                if (profitData.action.details) {
                    const details = profitData.action.details;
                    const itemsPerAction = details.itemsPerAction || 1;
                    const totalItems = itemsPerAction * profitData.action.breakdown.quantity;

                    lines.push(`<div>• Base Production: ${totalItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)} = ${numberFormatter(Math.round(totalItems * details.priceEach))}</div>`);

                    if (details.gourmetBonusItems > 0) {
                        const bonusItems = (details.gourmetBonusItems / details.actionsPerHour) * profitData.action.breakdown.quantity;
                        lines.push(`<div>• Gourmet Bonus: ${bonusItems.toFixed(1)} items @ ${numberFormatter(details.priceEach)} = ${numberFormatter(Math.round(bonusItems * details.priceEach))}</div>`);
                    }
                }

                lines.push(`</div>`);

                // Bonus Revenue (expandable) - Essence and Rare Find drops
                if (profitData.action.details?.bonusRevenue && profitData.action.details.bonusRevenue.bonusDrops && profitData.action.details.bonusRevenue.bonusDrops.length > 0) {
                    const details = profitData.action.details;
                    const bonusRevenue = details.bonusRevenue;
                    const hoursNeeded = profitData.action.breakdown.quantity / details.actionsPerHour;
                    const efficiencyMultiplier = details.efficiencyMultiplier || 1;
                    const totalBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier * hoursNeeded;

                    lines.push(`<div class="mwi-expandable-header" data-section="bonus" style="margin-left: 10px; cursor: pointer; user-select: none;">Bonus Revenue: ${numberFormatter(totalBonusRevenue)} ▸</div>`);
                    lines.push(`<div class="mwi-expandable-section" data-section="bonus" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`);

                    // Group drops by type
                    const essenceDrops = bonusRevenue.bonusDrops.filter(d => d.type === 'essence');
                    const rareFindDrops = bonusRevenue.bonusDrops.filter(d => d.type === 'rare_find');

                    // Show essence drops
                    if (essenceDrops.length > 0) {
                        lines.push(`<div style="margin-top: 2px; color: #aaa;">Essence Drops:</div>`);
                        for (const drop of essenceDrops) {
                            const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                            const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                            lines.push(`<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`);
                        }
                    }

                    // Show rare find drops
                    if (rareFindDrops.length > 0) {
                        if (essenceDrops.length > 0) {
                            lines.push(`<div style="margin-top: 4px; color: #aaa;">Rare Find Drops:</div>`);
                        }
                        for (const drop of rareFindDrops) {
                            const dropsForTask = drop.dropsPerHour * efficiencyMultiplier * hoursNeeded;
                            const revenueForTask = drop.revenuePerHour * efficiencyMultiplier * hoursNeeded;
                            lines.push(`<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${numberFormatter(Math.round(drop.priceEach))} = ${numberFormatter(Math.round(revenueForTask))}</div>`);
                        }
                    }

                    lines.push(`</div>`);
                }

                // Material Cost (expandable)
                lines.push(`<div class="mwi-expandable-header" data-section="materials" style="margin-left: 10px; cursor: pointer; user-select: none;">Material Cost: ${numberFormatter(profitData.action.breakdown.materialCost)} ▸</div>`);
                lines.push(`<div class="mwi-expandable-section" data-section="materials" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`);

                if (profitData.action.details && profitData.action.details.materialCosts) {
                    const details = profitData.action.details;
                    const actionsNeeded = profitData.action.breakdown.quantity;

                    for (const mat of details.materialCosts) {
                        const totalAmount = mat.amount * actionsNeeded;
                        const totalCost = mat.totalCost * actionsNeeded;
                        lines.push(`<div>• ${mat.itemName}: ${totalAmount.toFixed(1)} @ ${numberFormatter(Math.round(mat.askPrice))} = ${numberFormatter(Math.round(totalCost))}</div>`);
                    }

                    if (details.teaCosts && details.teaCosts.length > 0) {
                        const hoursNeeded = actionsNeeded / details.actionsPerHour;
                        for (const tea of details.teaCosts) {
                            const drinksNeeded = tea.drinksPerHour * hoursNeeded;
                            const totalCost = tea.totalCost * hoursNeeded;
                            lines.push(`<div>• ${tea.itemName}: ${drinksNeeded.toFixed(1)} drinks @ ${numberFormatter(Math.round(tea.pricePerDrink))} = ${numberFormatter(Math.round(totalCost))}</div>`);
                        }
                    }
                }

                lines.push(`</div>`);

                // Net Production
                lines.push(`<div style="margin-left: 10px;">Net Production: ${numberFormatter(profitData.action.totalProfit)}</div>`);
                lines.push(`<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${numberFormatter(profitData.action.breakdown.perAction.toFixed(0))} each)</div>`);
            }

            // Total
            lines.push('<div style="border-top: 1px solid #555; margin-top: 6px; padding-top: 4px;"></div>');
            lines.push(`<div style="font-weight: bold; color: ${config.SCRIPT_COLOR_MAIN};">Total Profit: ${numberFormatter(profitData.totalProfit)}</div>`);

            return lines.join('');
        }

        /**
         * Display error state when profit calculation fails
         * @param {Element} taskNode - Task card DOM element
         * @param {string} message - Error message to display
         */
        displayErrorState(taskNode, message) {
            const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create error container
            const errorContainer = document.createElement('div');
            errorContainer.className = 'mwi-task-profit mwi-task-profit-error';
            errorContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: ${config.SCRIPT_COLOR_ALERT};
            font-style: italic;
        `;
            errorContainer.textContent = `⚠ ${message}`;

            actionNode.appendChild(errorContainer);
        }

        /**
         * Display loading state while waiting for market data
         * @param {Element} taskNode - Task card DOM element
         * @param {Object} taskData - Task data for reroll detection
         */
        displayLoadingState(taskNode, taskData) {
            const actionNode = taskNode.querySelector(GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create loading container
            const loadingContainer = document.createElement('div');
            loadingContainer.className = 'mwi-task-profit mwi-task-profit-loading';
            loadingContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: #888;
            font-style: italic;
        `;
            loadingContainer.textContent = '⏳ Loading market data...';

            // Store task key for reroll detection
            const taskKey = `${taskData.description}|${taskData.quantity}`;
            loadingContainer.dataset.taskKey = taskKey;

            actionNode.appendChild(loadingContainer);
        }

        /**
         * Disable the feature
         */
        disable() {
            // Unregister all handlers
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];

            // Unregister retry handlers
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            if (this.marketDataRetryHandler) {
                dataManager.off('expected_value_initialized', this.marketDataRetryHandler);
                this.marketDataRetryHandler = null;
            }

            // Clear pending tasks
            this.pendingTaskNodes.clear();

            // Clean up event listeners before removing profit displays
            document.querySelectorAll(TOOLASHA.TASK_PROFIT).forEach(el => {
                const listeners = this.eventListeners.get(el);
                if (listeners) {
                    listeners.forEach((listener, element) => {
                        element.removeEventListener('click', listener);
                    });
                    this.eventListeners.delete(el);
                }
                el.remove();
            });

            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const taskProfitDisplay = new TaskProfitDisplay();

    /**
     * Task Reroll Cost Tracker
     * Tracks and displays reroll costs for tasks using WebSocket messages
     */


    class TaskRerollTracker {
        constructor() {
            this.taskRerollData = new Map(); // key: taskId, value: { coinRerollCount, cowbellRerollCount }
            this.unregisterHandlers = [];
            this.isInitialized = false;
        }

        /**
         * Initialize the tracker
         */
        async initialize() {
            if (this.isInitialized) return;


            // Register WebSocket listener
            this.registerWebSocketListeners();

            // Register DOM observer for display updates
            this.registerDOMObservers();

            this.isInitialized = true;
        }

        /**
         * Clean up observers and handlers
         */
        cleanup() {
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
            this.isInitialized = false;
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const questsHandler = (data) => {
                if (!data.endCharacterQuests) return;

                // Update our task reroll data from server data
                for (const quest of data.endCharacterQuests) {
                    this.taskRerollData.set(quest.id, {
                        coinRerollCount: quest.coinRerollCount || 0,
                        cowbellRerollCount: quest.cowbellRerollCount || 0,
                        monsterHrid: quest.monsterHrid || '',
                        actionHrid: quest.actionHrid || '',
                        goalCount: quest.goalCount || 0
                    });
                }

                // Wait for game to update DOM before updating displays
                setTimeout(() => {
                    this.updateAllTaskDisplays();
                }, 250);
            };

            webSocketHook.on('quests_updated', questsHandler);

            // Store handler for cleanup
            this.unregisterHandlers.push(() => {
                webSocketHook.off('quests_updated', questsHandler);
            });

        }

        /**
         * Register DOM observers for display updates
         */
        registerDOMObservers() {
            // Watch for task list appearing
            const unregisterTaskList = domObserver.onClass(
                'TaskRerollTracker-TaskList',
                'TasksPanel_taskList',
                () => {
                    this.updateAllTaskDisplays();
                }
            );
            this.unregisterHandlers.push(unregisterTaskList);

            // Watch for individual tasks appearing
            const unregisterTask = domObserver.onClass(
                'TaskRerollTracker-Task',
                'RandomTask_randomTask',
                () => {
                    // Small delay to let task data settle
                    setTimeout(() => this.updateAllTaskDisplays(), 100);
                }
            );
            this.unregisterHandlers.push(unregisterTask);
        }

        /**
         * Calculate cumulative gold spent from coin reroll count
         * Formula: 10K, 20K, 40K, 80K, 160K, 320K (doubles, caps at 320K)
         * @param {number} rerollCount - Number of gold rerolls
         * @returns {number} Total gold spent
         */
        calculateGoldSpent(rerollCount) {
            if (rerollCount === 0) return 0;

            let total = 0;
            let cost = 10000; // Start at 10K

            for (let i = 0; i < rerollCount; i++) {
                total += cost;
                // Double the cost, but cap at 320K
                cost = Math.min(cost * 2, 320000);
            }

            return total;
        }

        /**
         * Calculate cumulative cowbells spent from cowbell reroll count
         * Formula: 1, 2, 4, 8, 16, 32 (doubles, caps at 32)
         * @param {number} rerollCount - Number of cowbell rerolls
         * @returns {number} Total cowbells spent
         */
        calculateCowbellSpent(rerollCount) {
            if (rerollCount === 0) return 0;

            let total = 0;
            let cost = 1; // Start at 1

            for (let i = 0; i < rerollCount; i++) {
                total += cost;
                // Double the cost, but cap at 32
                cost = Math.min(cost * 2, 32);
            }

            return total;
        }

        /**
         * Get task ID from DOM element by matching task description
         * @param {Element} taskElement - Task DOM element
         * @returns {number|null} Task ID or null if not found
         */
        getTaskIdFromElement(taskElement) {
            // Get task description and goal count from DOM
            const nameEl = taskElement.querySelector(GAME.TASK_NAME);
            const description = nameEl ? nameEl.textContent.trim() : '';

            if (!description) return null;

            // Get quantity from progress text
            const progressDivs = taskElement.querySelectorAll('div');
            let goalCount = 0;
            for (const div of progressDivs) {
                const text = div.textContent.trim();
                if (text.startsWith('Progress:')) {
                    const match = text.match(/Progress:\s*\d+\s*\/\s*(\d+)/);
                    if (match) {
                        goalCount = parseInt(match[1]);
                        break;
                    }
                }
            }

            // Match against stored task data
            for (const [taskId, taskData] of this.taskRerollData.entries()) {
                // Check if goal count matches
                if (taskData.goalCount !== goalCount) continue;

                // Extract monster/action name from description
                // Description format: "Kill X" or "Do action X times"
                const descLower = description.toLowerCase();

                // For monster tasks, check monsterHrid
                if (taskData.monsterHrid) {
                    const monsterName = taskData.monsterHrid.replace('/monsters/', '').replace(/_/g, ' ');
                    if (descLower.includes(monsterName.toLowerCase())) {
                        return taskId;
                    }
                }

                // For action tasks, check actionHrid
                if (taskData.actionHrid) {
                    const actionParts = taskData.actionHrid.split('/');
                    const actionName = actionParts[actionParts.length - 1].replace(/_/g, ' ');
                    if (descLower.includes(actionName.toLowerCase())) {
                        return taskId;
                    }
                }
            }

            return null;
        }

        /**
         * Update display for a specific task
         * @param {Element} taskElement - Task DOM element
         */
        updateTaskDisplay(taskElement) {
            const taskId = this.getTaskIdFromElement(taskElement);
            if (!taskId) {
                // Remove display if task not found in our data
                const existingDisplay = taskElement.querySelector('.mwi-reroll-cost-display');
                if (existingDisplay) {
                    existingDisplay.remove();
                }
                return;
            }

            const taskData = this.taskRerollData.get(taskId);
            if (!taskData) return;

            // Calculate totals
            const goldSpent = this.calculateGoldSpent(taskData.coinRerollCount);
            const cowbellSpent = this.calculateCowbellSpent(taskData.cowbellRerollCount);

            // Find or create display element
            let displayElement = taskElement.querySelector(TOOLASHA.REROLL_COST_DISPLAY);

            if (!displayElement) {
                displayElement = document.createElement('div');
                displayElement.className = 'mwi-reroll-cost-display';
                displayElement.style.cssText = `
                color: ${config.SCRIPT_COLOR_SECONDARY};
                font-size: 0.75rem;
                margin-top: 4px;
                padding: 2px 4px;
                border-radius: 3px;
                background: rgba(0, 0, 0, 0.3);
            `;

                // Insert at top of task card
                const taskContent = taskElement.querySelector(GAME.TASK_CONTENT);
                if (taskContent) {
                    taskContent.insertBefore(displayElement, taskContent.firstChild);
                } else {
                    taskElement.insertBefore(displayElement, taskElement.firstChild);
                }
            }

            // Format display text
            const parts = [];
            if (cowbellSpent > 0) {
                parts.push(`${cowbellSpent}🔔`);
            }
            if (goldSpent > 0) {
                parts.push(`${numberFormatter(goldSpent)}💰`);
            }

            if (parts.length > 0) {
                displayElement.textContent = `Reroll spent: ${parts.join(' + ')}`;
                displayElement.style.display = 'block';
            } else {
                displayElement.style.display = 'none';
            }
        }

        /**
         * Update all task displays
         */
        updateAllTaskDisplays() {
            const taskList = document.querySelector(GAME.TASK_LIST);
            if (!taskList) return;

            const allTasks = taskList.querySelectorAll(GAME.TASK_CARD);
            allTasks.forEach((task) => {
                this.updateTaskDisplay(task);
            });
        }
    }

    // Create singleton instance
    const taskRerollTracker = new TaskRerollTracker();

    /**
     * House Upgrade Cost Calculator
     * Calculates material and coin costs for house room upgrades
     */


    class HouseCostCalculator {
        constructor() {
            this.isInitialized = false;
        }

        /**
         * Initialize the calculator
         */
        async initialize() {
            if (this.isInitialized) return;

            // Ensure market data is loaded
            await marketAPI.fetch();

            this.isInitialized = true;
        }

        /**
         * Get current level of a house room
         * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
         * @returns {number} Current level (0-8)
         */
        getCurrentRoomLevel(houseRoomHrid) {
            return dataManager.getHouseRoomLevel(houseRoomHrid);
        }

        /**
         * Calculate cost for a single level upgrade
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} targetLevel - Target level (1-8)
         * @returns {Promise<Object>} Cost breakdown
         */
        async calculateLevelCost(houseRoomHrid, targetLevel) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.houseRoomDetailMap) {
                throw new Error('Game data not loaded');
            }

            const roomData = initData.houseRoomDetailMap[houseRoomHrid];
            if (!roomData) {
                throw new Error(`House room not found: ${houseRoomHrid}`);
            }

            const upgradeCosts = roomData.upgradeCostsMap[targetLevel];
            if (!upgradeCosts) {
                throw new Error(`No upgrade costs for level ${targetLevel}`);
            }

            // Calculate costs
            let totalCoins = 0;
            const materials = [];

            for (const item of upgradeCosts) {
                if (item.itemHrid === '/items/coin') {
                    totalCoins = item.count;
                } else {
                    const marketPrice = await this.getItemMarketPrice(item.itemHrid);
                    materials.push({
                        itemHrid: item.itemHrid,
                        count: item.count,
                        marketPrice: marketPrice,
                        totalValue: marketPrice * item.count
                    });
                }
            }

            const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

            return {
                level: targetLevel,
                coins: totalCoins,
                materials: materials,
                totalValue: totalCoins + totalMaterialValue
            };
        }

        /**
         * Calculate cumulative cost from current level to target level
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         * @param {number} targetLevel - Target level (currentLevel+1 to 8)
         * @returns {Promise<Object>} Aggregated costs
         */
        async calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel) {
            if (targetLevel <= currentLevel) {
                throw new Error('Target level must be greater than current level');
            }

            if (targetLevel > 8) {
                throw new Error('Maximum house level is 8');
            }

            let totalCoins = 0;
            const materialMap = new Map(); // itemHrid -> {itemHrid, count, marketPrice, totalValue}

            // Aggregate costs across all levels
            for (let level = currentLevel + 1; level <= targetLevel; level++) {
                const levelCost = await this.calculateLevelCost(houseRoomHrid, level);

                totalCoins += levelCost.coins;

                // Aggregate materials
                for (const material of levelCost.materials) {
                    if (materialMap.has(material.itemHrid)) {
                        const existing = materialMap.get(material.itemHrid);
                        existing.count += material.count;
                        existing.totalValue += material.totalValue;
                    } else {
                        materialMap.set(material.itemHrid, { ...material });
                    }
                }
            }

            const materials = Array.from(materialMap.values());
            const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

            return {
                fromLevel: currentLevel,
                toLevel: targetLevel,
                coins: totalCoins,
                materials: materials,
                totalValue: totalCoins + totalMaterialValue
            };
        }

        /**
         * Get market price for an item based on pricing mode
         * @param {string} itemHrid - Item HRID
         * @returns {Promise<number>} Market price
         */
        async getItemMarketPrice(itemHrid) {
            const priceData = await marketAPI.getPrice(itemHrid);

            if (!priceData || (!priceData.ask && !priceData.bid)) {
                // Fallback to vendor price from game data
                const initData = dataManager.getInitClientData();
                const itemData = initData?.itemDetailMap?.[itemHrid];
                return itemData?.sellPrice || 0;
            }

            // Use pricing mode from config
            const pricingMode = config.getSetting('marketPricingMode') || 'hybrid';

            let ask = priceData.ask || 0;
            let bid = priceData.bid || 0;

            // Handle missing prices
            if (ask > 0 && bid <= 0) bid = ask;
            if (bid > 0 && ask <= 0) ask = bid;

            // Calculate weighted price based on mode
            switch (pricingMode) {
                case 'conservative':
                    return ask; // Buy at ask price (pessimistic)
                case 'optimistic':
                    return bid; // Sell at bid price (optimistic)
                case 'hybrid':
                default:
                    return ask * 0.5 + bid * 0.5; // 50/50 mix
            }
        }

        /**
         * Get player's inventory count for an item
         * @param {string} itemHrid - Item HRID
         * @returns {number} Item count in inventory
         */
        getInventoryCount(itemHrid) {
            const inventory = dataManager.getInventory();
            if (!inventory) return 0;

            const item = inventory.find(i => i.itemHrid === itemHrid);
            return item ? item.count : 0;
        }

        /**
         * Get item name from game data
         * @param {string} itemHrid - Item HRID
         * @returns {string} Item name
         */
        getItemName(itemHrid) {
            if (itemHrid === '/items/coin') {
                return 'Gold';
            }

            const initData = dataManager.getInitClientData();
            const itemData = initData?.itemDetailMap?.[itemHrid];
            return itemData?.name || 'Unknown Item';
        }

        /**
         * Get house room name from game data
         * @param {string} houseRoomHrid - House room HRID
         * @returns {string} Room name
         */
        getRoomName(houseRoomHrid) {
            const initData = dataManager.getInitClientData();
            const roomData = initData?.houseRoomDetailMap?.[houseRoomHrid];
            return roomData?.name || 'Unknown Room';
        }
    }

    // Create and export singleton instance
    const houseCostCalculator = new HouseCostCalculator();

    /**
     * House Upgrade Cost Display
     * UI rendering for house upgrade costs
     */


    class HouseCostDisplay {
        constructor() {
            this.isActive = false;
            this.currentModalContent = null; // Track current modal to detect room switches
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (!config.getSetting('houseUpgradeCosts')) {
                return;
            }

            this.isActive = true;
        }

        /**
         * Augment native costs section with market pricing
         * @param {Element} costsSection - The native HousePanel_costs element
         * @param {string} houseRoomHrid - House room HRID
         * @param {Element} modalContent - The modal content element
         */
        async addCostColumn(costsSection, houseRoomHrid, modalContent) {
            // Remove any existing augmentation first
            this.removeExistingColumn(modalContent);

            const currentLevel = houseCostCalculator.getCurrentRoomLevel(houseRoomHrid);

            // Don't show if already max level
            if (currentLevel >= 8) {
                return;
            }

            try {
                const nextLevel = currentLevel + 1;
                const costData = await houseCostCalculator.calculateLevelCost(houseRoomHrid, nextLevel);

                // Augment each native cost item with market pricing
                await this.augmentNativeCosts(costsSection, costData);

                // Add total cost below native costs
                this.addTotalCost(costsSection, costData);

                // Add compact "To Level" section below
                if (currentLevel < 7) {
                    await this.addCompactToLevel(costsSection, houseRoomHrid, currentLevel);
                }

                // Mark this modal as processed
                this.currentModalContent = modalContent;

            } catch (error) {
                // Silently fail - augmentation is optional
            }
        }

        /**
         * Remove existing augmentations
         * @param {Element} modalContent - The modal content element
         */
        removeExistingColumn(modalContent) {
            // Remove all MWI-added elements
            modalContent.querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level').forEach(el => el.remove());

            // Restore original grid columns
            const itemRequirementsGrid = modalContent.querySelector('[class*="HousePanel_itemRequirements"]');
            if (itemRequirementsGrid) {
                itemRequirementsGrid.style.gridTemplateColumns = '';
            }
        }

        /**
         * Augment native cost items with market pricing
         * @param {Element} costsSection - Native costs section
         * @param {Object} costData - Cost data from calculator
         */
        async augmentNativeCosts(costsSection, costData) {
            // Find the item requirements grid container
            const itemRequirementsGrid = costsSection.querySelector('[class*="HousePanel_itemRequirements"]');
            if (!itemRequirementsGrid) {
                return;
            }

            // Modify the grid to accept 4 columns instead of 3
            // Native grid is: icon | inventory count | input count
            // We want: icon | inventory count | input count | pricing
            const currentGridStyle = window.getComputedStyle(itemRequirementsGrid).gridTemplateColumns;

            // Add a 4th column for pricing (auto width)
            itemRequirementsGrid.style.gridTemplateColumns = currentGridStyle + ' auto';

            // Find all item containers (these have the icons)
            const itemContainers = itemRequirementsGrid.querySelectorAll('[class*="Item_itemContainer"]');
            if (itemContainers.length === 0) {
                return;
            }

            for (const itemContainer of itemContainers) {
                // Game uses SVG sprites, not img tags
                const svg = itemContainer.querySelector('svg');
                if (!svg) continue;

                // Extract item name from href (e.g., #lumber -> lumber)
                const useElement = svg.querySelector('use');
                const hrefValue = useElement?.getAttribute('href') || '';
                const itemName = hrefValue.split('#')[1];
                if (!itemName) continue;

                // Convert to item HRID
                const itemHrid = `/items/${itemName}`;

                // Find matching material in costData
                let materialData;
                if (itemHrid === '/items/coin') {
                    materialData = {
                        itemHrid: '/items/coin',
                        count: costData.coins,
                        marketPrice: 1,
                        totalValue: costData.coins
                    };
                } else {
                    materialData = costData.materials.find(m => m.itemHrid === itemHrid);
                }

                if (!materialData) continue;

                // Skip coins (no pricing needed)
                if (materialData.itemHrid === '/items/coin') {
                    // Add empty cell to maintain grid structure
                    this.addEmptyCell(itemRequirementsGrid, itemContainer);
                    continue;
                }

                // Add pricing as a new grid cell to the right
                this.addPricingCell(itemRequirementsGrid, itemContainer, materialData);
            }
        }

        /**
         * Add empty cell for coins to maintain grid structure
         * @param {Element} grid - The requirements grid
         * @param {Element} itemContainer - The item icon container (badge)
         */
        addEmptyCell(grid, itemContainer) {
            const emptyCell = document.createElement('span');
            emptyCell.className = 'mwi-house-pricing-empty HousePanel_itemRequirementCell__3hSBN';

            // Insert immediately after the item badge
            itemContainer.after(emptyCell);
        }

        /**
         * Add pricing as a new grid cell to the right of the item
         * @param {Element} grid - The requirements grid
         * @param {Element} itemContainer - The item icon container (badge)
         * @param {Object} materialData - Material data with pricing
         */
        addPricingCell(grid, itemContainer, materialData) {
            // Check if already augmented
            const nextSibling = itemContainer.nextElementSibling;
            if (nextSibling?.classList.contains('mwi-house-pricing')) {
                return;
            }

            const inventoryCount = houseCostCalculator.getInventoryCount(materialData.itemHrid);
            const hasEnough = inventoryCount >= materialData.count;
            const amountNeeded = Math.max(0, materialData.count - inventoryCount);

            // Create pricing cell
            const pricingCell = document.createElement('span');
            pricingCell.className = 'mwi-house-pricing HousePanel_itemRequirementCell__3hSBN';
            pricingCell.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            font-size: 0.75rem;
            color: ${config.SCRIPT_COLOR_MAIN};
            padding-left: 8px;
            white-space: nowrap;
        `;

            pricingCell.innerHTML = `
            <span style="color: ${config.SCRIPT_COLOR_SECONDARY};">@ ${coinFormatter(materialData.marketPrice)}</span>
            <span style="color: ${config.SCRIPT_COLOR_MAIN}; font-weight: bold;">= ${coinFormatter(materialData.totalValue)}</span>
            <span style="color: ${hasEnough ? '#4ade80' : '#f87171'}; margin-left: auto; text-align: right;">${coinFormatter(amountNeeded)}</span>
        `;

            // Insert immediately after the item badge
            itemContainer.after(pricingCell);
        }

        /**
         * Add total cost below native costs section
         * @param {Element} costsSection - Native costs section
         * @param {Object} costData - Cost data
         */
        addTotalCost(costsSection, costData) {
            const totalDiv = document.createElement('div');
            totalDiv.className = 'mwi-house-total';
            totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-align: center;
        `;
            totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
            costsSection.appendChild(totalDiv);
        }

        /**
         * Add compact "To Level" section
         * @param {Element} costsSection - Native costs section
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         */
        async addCompactToLevel(costsSection, houseRoomHrid, currentLevel) {
            const section = document.createElement('div');
            section.className = 'mwi-house-to-level';
            section.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
        `;

            // Compact header with inline dropdown
            const headerRow = document.createElement('div');
            headerRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 8px;
        `;

            const label = document.createElement('span');
            label.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
            font-size: 0.875rem;
        `;
            label.textContent = 'Cumulative to Level:';

            const dropdown = document.createElement('select');
            dropdown.style.cssText = `
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
            color: ${config.SCRIPT_COLOR_MAIN};
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.875rem;
        `;

            // Add options
            for (let level = currentLevel + 2; level <= 8; level++) {
                const option = document.createElement('option');
                option.value = level;
                option.textContent = level;
                dropdown.appendChild(option);
            }

            // Default to next level (currentLevel + 2)
            const defaultLevel = currentLevel + 2;
            dropdown.value = defaultLevel;

            headerRow.appendChild(label);
            headerRow.appendChild(dropdown);
            section.appendChild(headerRow);

            // Cost display container
            const costContainer = document.createElement('div');
            costContainer.className = 'mwi-cumulative-cost-container';
            costContainer.style.cssText = `
            font-size: 0.875rem;
            margin-top: 8px;
            text-align: left;
        `;
            section.appendChild(costContainer);

            // Initial render
            await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

            // Update on change
            dropdown.addEventListener('change', async () => {
                await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));
            });

            costsSection.parentElement.appendChild(section);
        }

        /**
         * Update compact cumulative display
         * @param {Element} container - Container element
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         * @param {number} targetLevel - Target level
         */
        async updateCompactCumulativeDisplay(container, houseRoomHrid, currentLevel, targetLevel) {
            container.innerHTML = '';

            const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

            // Compact material list as a unified grid
            const materialsList = document.createElement('div');
            materialsList.style.cssText = `
            display: grid;
            grid-template-columns: auto auto auto auto auto;
            align-items: center;
            gap: 2px 8px;
            line-height: 1.2;
        `;

            // Coins first
            if (costData.coins > 0) {
                this.appendMaterialCells(materialsList, {
                    itemHrid: '/items/coin',
                    count: costData.coins,
                    totalValue: costData.coins
                });
            }

            // Materials
            for (const material of costData.materials) {
                this.appendMaterialCells(materialsList, material);
            }

            container.appendChild(materialsList);

            // Total
            const totalDiv = document.createElement('div');
            totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-align: center;
        `;
            totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
            container.appendChild(totalDiv);
        }

        /**
         * Append material cells directly to grid (5 cells per material)
         * @param {Element} grid - The grid container
         * @param {Object} material - Material data
         */
        appendMaterialCells(grid, material) {
            const itemName = houseCostCalculator.getItemName(material.itemHrid);
            const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
            const hasEnough = inventoryCount >= material.count;
            const amountNeeded = Math.max(0, material.count - inventoryCount);
            const isCoin = material.itemHrid === '/items/coin';

            // Cell 1: Inventory / Required (right-aligned)
            const countsSpan = document.createElement('span');
            countsSpan.style.cssText = `
            color: ${hasEnough ? 'white' : '#f87171'};
            text-align: right;
        `;
            countsSpan.textContent = `${coinFormatter(inventoryCount)} / ${coinFormatter(material.count)}`;
            grid.appendChild(countsSpan);

            // Cell 2: Item name (left-aligned)
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = `
            color: white;
            text-align: left;
        `;
            nameSpan.textContent = itemName;
            grid.appendChild(nameSpan);

            // Cell 3: @ price (left-aligned) - empty for coins
            const priceSpan = document.createElement('span');
            if (!isCoin) {
                priceSpan.style.cssText = `
                color: ${config.SCRIPT_COLOR_SECONDARY};
                font-size: 0.75rem;
                text-align: left;
            `;
                priceSpan.textContent = `@ ${coinFormatter(material.marketPrice)}`;
            }
            grid.appendChild(priceSpan);

            // Cell 4: = total (left-aligned) - show coin total for coins
            const totalSpan = document.createElement('span');
            if (isCoin) {
                totalSpan.style.cssText = `
                color: ${config.SCRIPT_COLOR_MAIN};
                font-weight: bold;
                font-size: 0.75rem;
                text-align: left;
            `;
                totalSpan.textContent = `= ${coinFormatter(material.totalValue)}`;
            } else {
                totalSpan.style.cssText = `
                color: ${config.SCRIPT_COLOR_MAIN};
                font-weight: bold;
                font-size: 0.75rem;
                text-align: left;
            `;
                totalSpan.textContent = `= ${coinFormatter(material.totalValue)}`;
            }
            grid.appendChild(totalSpan);

            // Cell 5: Amount needed (right-aligned)
            const neededSpan = document.createElement('span');
            neededSpan.style.cssText = `
            color: ${hasEnough ? '#4ade80' : '#f87171'};
            font-size: 0.75rem;
            text-align: right;
        `;
            neededSpan.textContent = coinFormatter(amountNeeded);
            grid.appendChild(neededSpan);
        }

        /**
         * Disable the feature
         */
        disable() {
            // Remove all MWI-added elements
            document.querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level').forEach(el => el.remove());

            // Restore all grid columns
            document.querySelectorAll('[class*="HousePanel_itemRequirements"]').forEach(grid => {
                grid.style.gridTemplateColumns = '';
            });

            this.currentModalContent = null;
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const houseCostDisplay = new HouseCostDisplay();

    /**
     * House Panel Observer
     * Detects house upgrade modal and injects cost displays
     */


    class HousePanelObserver {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedCards = new WeakSet();
        }

        /**
         * Initialize the observer
         */
        async initialize() {
            if (this.isActive) return;

            // Initialize calculator
            await houseCostCalculator.initialize();

            // Initialize display
            houseCostDisplay.initialize();

            // Register modal observer
            this.registerObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers
         */
        registerObservers() {
            // Watch for house modal appearing
            const unregisterModal = domObserver.onClass(
                'HousePanelObserver-Modal',
                'HousePanel_modalContent',
                (modalContent) => {
                    this.handleHouseModal(modalContent);
                }
            );
            this.unregisterHandlers.push(unregisterModal);
        }

        /**
         * Handle house modal appearing
         * @param {Element} modalContent - The house panel modal content element
         */
        async handleHouseModal(modalContent) {
            // Wait a moment for content to fully load
            await new Promise(resolve => setTimeout(resolve, 100));

            // Modal shows one room at a time, not a grid
            // Process the currently displayed room
            await this.processModalContent(modalContent);

            // Set up observer for room switching
            this.observeModalChanges(modalContent);
        }

        /**
         * Process the modal content (single room display)
         * @param {Element} modalContent - The house panel modal content
         */
        async processModalContent(modalContent) {
            // Identify which room is currently displayed
            const houseRoomHrid = this.identifyRoomFromModal(modalContent);

            if (!houseRoomHrid) {
                return;
            }

            // Find the costs section to add our column
            const costsSection = modalContent.querySelector('[class*="HousePanel_costs"]');

            if (!costsSection) {
                return;
            }

            // Add our cost display as a column
            await houseCostDisplay.addCostColumn(costsSection, houseRoomHrid, modalContent);
        }

        /**
         * Identify house room HRID from modal header
         * @param {Element} modalContent - The modal content element
         * @returns {string|null} House room HRID
         */
        identifyRoomFromModal(modalContent) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.houseRoomDetailMap) {
                return null;
            }

            // Get room name from header
            const header = modalContent.querySelector('[class*="HousePanel_header"]');
            if (!header) {
                return null;
            }

            const roomName = header.textContent.trim();

            // Match against room names in game data
            for (const [hrid, roomData] of Object.entries(initData.houseRoomDetailMap)) {
                if (roomData.name === roomName) {
                    return hrid;
                }
            }

            return null;
        }


        /**
         * Observe modal for room switching
         * @param {Element} modalContent - The house panel modal content
         */
        observeModalChanges(modalContent) {
            const observer = new MutationObserver((mutations) => {
                // Check if header changed (indicates room switch)
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' || mutation.type === 'characterData') {
                        const header = modalContent.querySelector('[class*="HousePanel_header"]');
                        if (header && mutation.target.contains(header)) {
                            // Room switched, reprocess
                            this.processModalContent(modalContent);
                            break;
                        }
                    }
                }
            });

            observer.observe(modalContent, {
                childList: true,
                subtree: true,
                characterData: true
            });

            // Store observer for cleanup
            if (!this.modalObservers) {
                this.modalObservers = [];
            }
            this.modalObservers.push(observer);
        }

        /**
         * Clean up observers
         */
        cleanup() {
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];

            if (this.modalObservers) {
                this.modalObservers.forEach(observer => observer.disconnect());
                this.modalObservers = [];
            }

            this.processedCards = new WeakSet();
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const housePanelObserver = new HousePanelObserver();

    /**
     * Networth Cache
     * LRU cache for expensive enhancement cost calculations
     * Prevents recalculating the same enhancement paths repeatedly
     */

    class NetworthCache {
        constructor(maxSize = 100) {
            this.maxSize = maxSize;
            this.cache = new Map();
            this.marketDataHash = null;
        }

        /**
         * Generate cache key for enhancement calculation
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @returns {string} Cache key
         */
        generateKey(itemHrid, enhancementLevel) {
            return `${itemHrid}_${enhancementLevel}`;
        }

        /**
         * Generate hash of market data for cache invalidation
         * Uses first 10 items' prices as a simple hash
         * @param {Object} marketData - Market data object
         * @returns {string} Hash string
         */
        generateMarketHash(marketData) {
            if (!marketData || !marketData.marketData) return 'empty';

            // Sample first 10 items for hash (performance vs accuracy tradeoff)
            const items = Object.entries(marketData.marketData).slice(0, 10);
            const hashParts = items.map(([hrid, data]) => {
                const ask = data[0]?.a || 0;
                const bid = data[0]?.b || 0;
                return `${hrid}:${ask}:${bid}`;
            });

            return hashParts.join('|');
        }

        /**
         * Check if market data has changed and invalidate cache if needed
         * @param {Object} marketData - Current market data
         */
        checkAndInvalidate(marketData) {
            const newHash = this.generateMarketHash(marketData);

            if (this.marketDataHash !== null && this.marketDataHash !== newHash) {
                // Market data changed, invalidate entire cache
                this.clear();
            }

            this.marketDataHash = newHash;
        }

        /**
         * Get cached enhancement cost
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @returns {number|null} Cached cost or null if not found
         */
        get(itemHrid, enhancementLevel) {
            const key = this.generateKey(itemHrid, enhancementLevel);

            if (!this.cache.has(key)) {
                return null;
            }

            // Move to end (most recently used)
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);

            return value;
        }

        /**
         * Set cached enhancement cost
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {number} cost - Enhancement cost
         */
        set(itemHrid, enhancementLevel, cost) {
            const key = this.generateKey(itemHrid, enhancementLevel);

            // Delete if exists (to update position)
            if (this.cache.has(key)) {
                this.cache.delete(key);
            }

            // Add to end
            this.cache.set(key, cost);

            // Evict oldest if over size limit
            if (this.cache.size > this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
        }

        /**
         * Clear entire cache
         */
        clear() {
            this.cache.clear();
            this.marketDataHash = null;
        }

        /**
         * Get cache statistics
         * @returns {Object} {size, maxSize, hitRate}
         */
        getStats() {
            return {
                size: this.cache.size,
                maxSize: this.maxSize,
                marketDataHash: this.marketDataHash
            };
        }
    }

    // Create and export singleton instance
    const networthCache = new NetworthCache();

    /**
     * Networth Calculator
     * Calculates total character networth including:
     * - Equipped items
     * - Inventory items
     * - Market listings
     * - Houses (all 17)
     * - Abilities (equipped + others)
     */


    /**
     * Calculate the value of a single item
     * @param {Object} item - Item data {itemHrid, enhancementLevel, count}
     * @param {boolean} useAsk - Use ask prices (true) or bid prices (false)
     * @returns {number} Total value in coins
     */
    async function calculateItemValue(item, useAsk = true) {
        const { itemHrid, enhancementLevel = 0, count = 1 } = item;

        let itemValue = 0;

        // For enhanced items (1+), try market price first, then calculate enhancement cost
        if (enhancementLevel >= 1) {
            // Try market price first
            const marketPrice = getMarketPrice(itemHrid, enhancementLevel, useAsk);

            if (marketPrice > 0) {
                itemValue = marketPrice;
            } else {
                // No market data, calculate enhancement cost
                // Check cache first
                const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                if (cachedCost !== null) {
                    itemValue = cachedCost;
                } else {
                    // Not in cache, calculate
                    const enhancementParams = getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        itemValue = enhancementPath.optimalStrategy.totalCost;
                        // Cache the result
                        networthCache.set(itemHrid, enhancementLevel, itemValue);
                    } else {
                        // Enhancement calculation failed, try base item price
                        itemValue = getMarketPrice(itemHrid, 0, useAsk);
                    }
                }
            }
        } else {
            // Unenhanced items: use market price or crafting cost
            itemValue = getMarketPrice(itemHrid, enhancementLevel, useAsk);
        }

        return itemValue * count;
    }

    /**
     * Get market price for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {boolean} useAsk - Use ask price (true) or bid price (false)
     * @returns {number} Price per item
     */
    function getMarketPrice(itemHrid, enhancementLevel, useAsk) {
        // Special handling for currencies
        const currencyValue = calculateCurrencyValue(itemHrid);
        if (currencyValue !== null) {
            return currencyValue;
        }

        const prices = marketAPI.getPrice(itemHrid, enhancementLevel);

        // If no market data, try fallbacks
        if (!prices) {
            // Check if it's an openable container (crates, caches, chests)
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (itemDetails?.isOpenable && expectedValueCalculator.isInitialized) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData && evData.expectedValue > 0) {
                    return evData.expectedValue;
                }
            }

            // Try crafting cost as fallback
            const craftingCost = calculateCraftingCost(itemHrid);
            if (craftingCost > 0) {
                return craftingCost;
            }
            return 0;
        }

        let ask = prices.ask || 0;
        let bid = prices.bid || 0;

        // Match MCS behavior: if one price is positive and other is negative, use positive for both
        if (ask > 0 && bid < 0) {
            bid = ask;
        }
        if (bid > 0 && ask < 0) {
            ask = bid;
        }

        return useAsk ? ask : bid;
    }

    /**
     * Calculate value for currency items
     * @param {string} itemHrid - Item HRID
     * @returns {number|null} Currency value per unit, or null if not a currency
     */
    function calculateCurrencyValue(itemHrid) {
        // Coins: Face value (1 coin = 1 value)
        if (itemHrid === '/items/coin') {
            return 1;
        }

        // Cowbells: Market value of Bag of 10 Cowbells / 10
        if (itemHrid === '/items/cowbell') {
            const bagPrice = marketAPI.getPrice('/items/bag_of_10_cowbells', 0);
            if (bagPrice && bagPrice.ask > 0) {
                return bagPrice.ask / 10;
            }
            // Fallback: vendor value
            return 100000;
        }

        // Task Tokens: Expected value from Task Shop chests
        if (itemHrid === '/items/task_token') {
            const tokenData = calculateTaskTokenValue();
            if (tokenData && tokenData.tokenValue > 0) {
                return tokenData.tokenValue;
            }
            // Fallback if market data not loaded: 30K (approximate)
            return 30000;
        }

        // Dungeon tokens: Best market value per token approach
        // Calculate based on best shop item value (similar to task tokens)
        if (itemHrid === '/items/chimerical_token') {
            return calculateDungeonTokenValue(itemHrid);
        }
        if (itemHrid === '/items/sinister_token') {
            return calculateDungeonTokenValue(itemHrid);
        }
        if (itemHrid === '/items/enchanted_token') {
            return calculateDungeonTokenValue(itemHrid);
        }
        if (itemHrid === '/items/pirate_token') {
            return calculateDungeonTokenValue(itemHrid);
        }

        return null; // Not a currency
    }

    /**
     * Calculate dungeon token value based on best shop item value
     * Uses "best market value per token" approach: finds the shop item with highest (market price / token cost)
     * @param {string} tokenHrid - Token HRID (e.g., '/items/chimerical_token')
     * @returns {number} Value per token, or 0 if no data
     */
    function calculateDungeonTokenValue(tokenHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Get all shop items for this token type
        const shopItems = Object.values(gameData.shopItemDetailMap || {}).filter(
            item => item.costs && item.costs[0]?.itemHrid === tokenHrid
        );

        if (shopItems.length === 0) return 0;

        let bestValuePerToken = 0;

        // For each shop item, calculate market price / token cost
        for (const shopItem of shopItems) {
            const itemHrid = shopItem.itemHrid;
            const tokenCost = shopItem.costs[0].count;

            // Get market price for this item
            const prices = marketAPI.getPrice(itemHrid, 0);
            if (!prices) continue;

            // Use ask price if positive, otherwise bid
            const marketPrice = Math.max(prices.ask || 0, prices.bid || 0);
            if (marketPrice <= 0) continue;

            // Calculate value per token
            const valuePerToken = marketPrice / tokenCost;

            // Keep track of best value
            if (valuePerToken > bestValuePerToken) {
                bestValuePerToken = valuePerToken;
            }
        }

        // Fallback to essence price if no shop items found
        if (bestValuePerToken === 0) {
            const essenceMap = {
                '/items/chimerical_token': '/items/chimerical_essence',
                '/items/sinister_token': '/items/sinister_essence',
                '/items/enchanted_token': '/items/enchanted_essence',
                '/items/pirate_token': '/items/pirate_essence'
            };

            const essenceHrid = essenceMap[tokenHrid];
            if (essenceHrid) {
                const essencePrice = marketAPI.getPrice(essenceHrid, 0);
                if (essencePrice) {
                    return Math.max(essencePrice.ask || 0, essencePrice.bid || 0);
                }
            }
        }

        return bestValuePerToken;
    }

    /**
     * Calculate crafting cost for an item (simple version without efficiency bonuses)
     * @param {string} itemHrid - Item HRID
     * @returns {number} Total material cost or 0 if not craftable
     */
    function calculateCraftingCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Find the action that produces this item
        for (const action of Object.values(gameData.actionDetailMap || {})) {
            if (action.outputItems) {
                for (const output of action.outputItems) {
                    if (output.itemHrid === itemHrid) {
                        // Found the crafting action, calculate material costs
                        let totalCost = 0;

                        // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
                        if (action.upgradeItemHrid) {
                            const upgradePrice = marketAPI.getPrice(action.upgradeItemHrid, 0);
                            if (upgradePrice) {
                                totalCost += (upgradePrice.ask || 0);
                            }
                        }

                        // Add input items
                        if (action.inputItems && action.inputItems.length > 0) {
                            for (const input of action.inputItems) {
                                const inputPrice = marketAPI.getPrice(input.itemHrid, 0);
                                if (inputPrice) {
                                    totalCost += (inputPrice.ask || 0) * input.count;
                                }
                            }
                        }

                        // Divide by output count to get per-item cost
                        return totalCost / (output.count || 1);
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Calculate total value of all houses (all 17)
     * @param {Object} characterHouseRooms - Map of character house rooms
     * @returns {Object} {totalCost, breakdown: [{name, level, cost}]}
     */
    function calculateAllHousesCost(characterHouseRooms) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return { totalCost: 0, breakdown: [] };

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

        let totalCost = 0;
        const breakdown = [];

        for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
            const level = houseData.level || 0;
            if (level === 0) continue;

            const cost = calculateHouseBuildCost(houseRoomHrid, level);
            totalCost += cost;

            // Get human-readable name
            const houseDetail = houseRoomDetailMap[houseRoomHrid];
            const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

            breakdown.push({
                name: houseName,
                level: level,
                cost: cost
            });
        }

        // Sort by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);

        return { totalCost, breakdown };
    }

    /**
     * Calculate total value of all abilities
     * @param {Array} characterAbilities - Array of character abilities
     * @param {Array} equippedAbilities - Array of equipped abilities (for subtotal)
     * @returns {Object} {totalCost, equippedCost, breakdown, equippedBreakdown, otherBreakdown}
     */
    function calculateAllAbilitiesCost(characterAbilities, equippedAbilities) {
        if (!characterAbilities || characterAbilities.length === 0) {
            return {
                totalCost: 0,
                equippedCost: 0,
                breakdown: [],
                equippedBreakdown: [],
                otherBreakdown: []
            };
        }

        let totalCost = 0;
        let equippedCost = 0;
        const breakdown = [];
        const equippedBreakdown = [];
        const otherBreakdown = [];

        // Create set of equipped ability HRIDs for quick lookup
        const equippedHrids = new Set(
            equippedAbilities.map(a => a.abilityHrid).filter(Boolean)
        );

        for (const ability of characterAbilities) {
            if (!ability.abilityHrid || ability.level === 0) continue;

            const cost = calculateAbilityCost(ability.abilityHrid, ability.level);
            totalCost += cost;

            // Format ability name for display
            const abilityName = ability.abilityHrid
                .replace('/abilities/', '')
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            const abilityData = {
                name: `${abilityName} ${ability.level}`,
                cost: cost
            };

            breakdown.push(abilityData);

            // Categorize as equipped or other
            if (equippedHrids.has(ability.abilityHrid)) {
                equippedCost += cost;
                equippedBreakdown.push(abilityData);
            } else {
                otherBreakdown.push(abilityData);
            }
        }

        // Sort all breakdowns by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);
        equippedBreakdown.sort((a, b) => b.cost - a.cost);
        otherBreakdown.sort((a, b) => b.cost - a.cost);

        return {
            totalCost,
            equippedCost,
            breakdown,
            equippedBreakdown,
            otherBreakdown
        };
    }

    /**
     * Calculate total networth
     * @returns {Promise<Object>} Networth data with breakdowns
     */
    async function calculateNetworth() {
        const gameData = dataManager.getCombinedData();
        if (!gameData) {
            console.error('[Networth] No game data available');
            return createEmptyNetworthData();
        }

        // Fetch market data and invalidate cache if needed
        const marketData = await marketAPI.fetch();
        if (!marketData) {
            console.error('[Networth] Failed to fetch market data');
            return createEmptyNetworthData();
        }

        networthCache.checkAndInvalidate(marketData);

        const characterItems = gameData.characterItems || [];
        const marketListings = gameData.myMarketListings || [];
        const characterHouseRooms = gameData.characterHouseRoomMap || {};
        const characterAbilities = gameData.characterAbilities || [];
        const equippedAbilities = gameData.equippedAbilities || [];

        // Calculate equipped items value
        let equippedAsk = 0;
        let equippedBid = 0;
        const equippedBreakdown = [];

        for (const item of characterItems) {
            if (item.itemLocationHrid === '/item_locations/inventory') continue;

            const askValue = await calculateItemValue(item, true);
            const bidValue = await calculateItemValue(item, false);

            equippedAsk += askValue;
            equippedBid += bidValue;

            // Add to breakdown
            const itemDetails = gameData.itemDetailMap[item.itemHrid];
            const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
            const displayName = item.enhancementLevel > 0
                ? `${itemName} +${item.enhancementLevel}`
                : itemName;

            equippedBreakdown.push({
                name: displayName,
                askValue,
                bidValue
            });
        }

        // Calculate inventory items value
        let inventoryAsk = 0;
        let inventoryBid = 0;
        const inventoryBreakdown = [];
        const inventoryByCategory = {};

        for (const item of characterItems) {
            if (item.itemLocationHrid !== '/item_locations/inventory') continue;

            const askValue = await calculateItemValue(item, true);
            const bidValue = await calculateItemValue(item, false);

            inventoryAsk += askValue;
            inventoryBid += bidValue;

            // Add to breakdown
            const itemDetails = gameData.itemDetailMap[item.itemHrid];
            const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
            const displayName = item.enhancementLevel > 0
                ? `${itemName} +${item.enhancementLevel}`
                : itemName;

            const itemData = {
                name: displayName,
                askValue,
                bidValue,
                count: item.count
            };

            inventoryBreakdown.push(itemData);

            // Categorize item
            const categoryHrid = itemDetails?.categoryHrid || '/item_categories/other';
            const categoryName = gameData.itemCategoryDetailMap?.[categoryHrid]?.name || 'Other';

            if (!inventoryByCategory[categoryName]) {
                inventoryByCategory[categoryName] = {
                    items: [],
                    totalAsk: 0,
                    totalBid: 0
                };
            }

            inventoryByCategory[categoryName].items.push(itemData);
            inventoryByCategory[categoryName].totalAsk += askValue;
            inventoryByCategory[categoryName].totalBid += bidValue;
        }

        // Sort items within each category by value descending
        for (const category of Object.values(inventoryByCategory)) {
            category.items.sort((a, b) => b.askValue - a.askValue);
        }

        // Calculate market listings value
        let listingsAsk = 0;
        let listingsBid = 0;
        const listingsBreakdown = [];

        for (const listing of marketListings) {
            const quantity = listing.orderQuantity - listing.filledQuantity;
            const enhancementLevel = listing.enhancementLevel || 0;

            if (listing.isSell) {
                // Selling: value is locked in listing + unclaimed coins
                // Apply marketplace fee (2% for normal items, 18% for cowbells)
                const fee = listing.itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.02;

                const askValue = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: quantity },
                    true
                );
                const bidValue = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: quantity },
                    false
                );

                listingsAsk += askValue * (1 - fee) + listing.unclaimedCoinCount;
                listingsBid += bidValue * (1 - fee) + listing.unclaimedCoinCount;
            } else {
                // Buying: value is locked coins + unclaimed items
                const unclaimedAsk = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: listing.unclaimedItemCount },
                    true
                );
                const unclaimedBid = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: listing.unclaimedItemCount },
                    false
                );

                listingsAsk += quantity * listing.price + unclaimedAsk;
                listingsBid += quantity * listing.price + unclaimedBid;
            }
        }

        // Calculate houses value
        const housesData = calculateAllHousesCost(characterHouseRooms);

        // Calculate abilities value
        const abilitiesData = calculateAllAbilitiesCost(characterAbilities, equippedAbilities);

        // Calculate totals
        const totalAsk = equippedAsk + inventoryAsk + listingsAsk + housesData.totalCost + abilitiesData.totalCost;
        const totalBid = equippedBid + inventoryBid + listingsBid + housesData.totalCost + abilitiesData.totalCost;
        const totalNetworth = (totalAsk + totalBid) / 2;

        // Sort breakdowns by value descending
        equippedBreakdown.sort((a, b) => b.askValue - a.askValue);
        inventoryBreakdown.sort((a, b) => b.askValue - a.askValue);

        return {
            totalAsk,
            totalBid,
            totalNetworth,
            currentAssets: {
                ask: equippedAsk + inventoryAsk + listingsAsk,
                bid: equippedBid + inventoryBid + listingsBid,
                equipped: { ask: equippedAsk, bid: equippedBid, breakdown: equippedBreakdown },
                inventory: {
                    ask: inventoryAsk,
                    bid: inventoryBid,
                    breakdown: inventoryBreakdown,
                    byCategory: inventoryByCategory
                },
                listings: { ask: listingsAsk, bid: listingsBid, breakdown: listingsBreakdown }
            },
            fixedAssets: {
                total: housesData.totalCost + abilitiesData.totalCost,
                houses: housesData,
                abilities: abilitiesData
            }
        };
    }

    /**
     * Create empty networth data structure
     * @returns {Object} Empty networth data
     */
    function createEmptyNetworthData() {
        return {
            totalAsk: 0,
            totalBid: 0,
            totalNetworth: 0,
            currentAssets: {
                ask: 0,
                bid: 0,
                equipped: { ask: 0, bid: 0, breakdown: [] },
                inventory: { ask: 0, bid: 0, breakdown: [], byCategory: {} },
                listings: { ask: 0, bid: 0, breakdown: [] }
            },
            fixedAssets: {
                total: 0,
                houses: { totalCost: 0, breakdown: [] },
                abilities: {
                    totalCost: 0,
                    equippedCost: 0,
                    breakdown: [],
                    equippedBreakdown: [],
                    otherBreakdown: []
                }
            }
        };
    }

    /**
     * Networth Display Components
     * Handles UI rendering for networth in two locations:
     * 1. Header (top right) - Current Assets: Ask / Bid
     * 2. Inventory Panel - Detailed breakdown with collapsible sections
     */


    /**
     * Header Display Component
     * Shows "Current Assets: Ask / Bid" next to total level
     */
    class NetworthHeaderDisplay {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
        }

        /**
         * Initialize header display
         */
        initialize() {
            // 1. Check if element already exists (handles late initialization)
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.renderHeader(existingElem);
            }

            // 2. Watch for future additions (handles SPA navigation, page reloads)
            const unregister = domObserver.onClass(
                'NetworthHeader',
                'Header_totalLevel',
                (elem) => {
                    this.renderHeader(elem);
                }
            );
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Render header display
         * @param {Element} totalLevelElem - Total level element
         */
        renderHeader(totalLevelElem) {
            // Check if already rendered
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container
            this.container = document.createElement('div');
            this.container.className = 'mwi-networth-header';
            this.container.style.cssText = `
            font-size: 0.875rem;
            font-weight: 500;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-wrap: nowrap;
        `;

            // Insert after total level
            totalLevelElem.insertAdjacentElement('afterend', this.container);

            // Initial render with loading state
            this.container.textContent = 'Current Assets: Loading...';
        }

        /**
         * Update header with networth data
         * @param {Object} networthData - Networth data from calculator
         */
        update(networthData) {
            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            const { currentAssets } = networthData;
            const askFormatted = networthFormatter(Math.round(currentAssets.ask));
            const bidFormatted = networthFormatter(Math.round(currentAssets.bid));

            this.container.textContent = `Current Assets: ${askFormatted} / ${bidFormatted}`;
        }

        /**
         * Disable and cleanup
         */
        disable() {
            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
        }
    }

    /**
     * Inventory Panel Display Component
     * Shows detailed networth breakdown below inventory search bar
     */
    class NetworthInventoryDisplay {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.currentData = null;
        }

        /**
         * Initialize inventory panel display
         */
        initialize() {
            // 1. Check if element already exists (handles late initialization)
            const existingElem = document.querySelector('[class*="Inventory_items"]');
            if (existingElem) {
                this.renderPanel(existingElem);
            }

            // 2. Watch for future additions (handles SPA navigation, inventory panel reloads)
            const unregister = domObserver.onClass(
                'NetworthInv',
                'Inventory_items',
                (elem) => {
                    this.renderPanel(elem);
                }
            );
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Render inventory panel
         * @param {Element} inventoryElem - Inventory items element
         */
        renderPanel(inventoryElem) {
            // Check if already rendered
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container
            this.container = document.createElement('div');
            this.container.className = 'mwi-networth-panel';
            this.container.style.cssText = `
            text-align: left;
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.875rem;
            margin-bottom: 12px;
        `;

            // Insert before inventory items
            inventoryElem.insertAdjacentElement('beforebegin', this.container);

            // Initial render with loading state or current data
            if (this.currentData) {
                this.update(this.currentData);
            } else {
                this.container.innerHTML = `
                <div style="font-weight: bold; cursor: pointer;">
                    + Total Networth: Loading...
                </div>
            `;
            }
        }

        /**
         * Update panel with networth data
         * @param {Object} networthData - Networth data from calculator
         */
        update(networthData) {
            this.currentData = networthData;

            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            // Preserve expand/collapse states before updating
            const expandedStates = {};
            const sectionsToPreserve = [
                'mwi-networth-details',
                'mwi-current-assets-details',
                'mwi-equipment-breakdown',
                'mwi-inventory-breakdown',
                'mwi-fixed-assets-details',
                'mwi-houses-breakdown',
                'mwi-abilities-details',
                'mwi-equipped-abilities-breakdown',
                'mwi-other-abilities-breakdown'
            ];

            // Also preserve inventory category states
            const inventoryCategories = Object.keys(networthData.currentAssets.inventory.byCategory || {});
            inventoryCategories.forEach(categoryName => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                sectionsToPreserve.push(categoryId);
            });

            sectionsToPreserve.forEach(id => {
                const elem = this.container.querySelector(`#${id}`);
                if (elem) {
                    expandedStates[id] = elem.style.display !== 'none';
                }
            });

            const totalNetworth = networthFormatter(Math.round(networthData.totalNetworth));

            this.container.innerHTML = `
            <div style="cursor: pointer; font-weight: bold;" id="mwi-networth-toggle">
                + Total Networth: ${totalNetworth}
            </div>
            <div id="mwi-networth-details" style="display: none; margin-left: 20px;">
                <!-- Current Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-current-assets-toggle">
                    + Current Assets: ${networthFormatter(Math.round(networthData.currentAssets.ask))}
                </div>
                <div id="mwi-current-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Equipment Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipment-toggle">
                        + Equipment value: ${networthFormatter(Math.round(networthData.currentAssets.equipped.ask))}
                    </div>
                    <div id="mwi-equipment-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                        ${this.renderEquipmentBreakdown(networthData.currentAssets.equipped.breakdown)}
                    </div>

                    <!-- Inventory Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-inventory-toggle">
                        + Inventory value: ${networthFormatter(Math.round(networthData.currentAssets.inventory.ask))}
                    </div>
                    <div id="mwi-inventory-breakdown" style="display: none; margin-left: 20px;">
                        ${this.renderInventoryBreakdown(networthData.currentAssets.inventory.byCategory)}
                    </div>

                    <div style="margin-top: 4px;">Market listings: ${networthFormatter(Math.round(networthData.currentAssets.listings.ask))}</div>
                </div>

                <!-- Fixed Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-fixed-assets-toggle">
                    + Fixed Assets: ${networthFormatter(Math.round(networthData.fixedAssets.total))}
                </div>
                <div id="mwi-fixed-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Houses -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-houses-toggle">
                        + Houses: ${networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}
                    </div>
                    <div id="mwi-houses-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                        ${this.renderHousesBreakdown(networthData.fixedAssets.houses.breakdown)}
                    </div>

                    <!-- Abilities -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-abilities-toggle">
                        + Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}
                    </div>
                    <div id="mwi-abilities-details" style="display: none; margin-left: 20px;">
                        <!-- Equipped Abilities -->
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipped-abilities-toggle">
                            + Equipped (5): ${networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}
                        </div>
                        <div id="mwi-equipped-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                            ${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.equippedBreakdown)}
                        </div>

                        <!-- Other Abilities -->
                        ${networthData.fixedAssets.abilities.otherBreakdown.length > 0 ? `
                            <div style="cursor: pointer; margin-top: 4px;" id="mwi-other-abilities-toggle">
                                + Other Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}
                            </div>
                            <div id="mwi-other-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb;">
                                ${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.otherBreakdown)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

            // Restore expand/collapse states after updating
            sectionsToPreserve.forEach(id => {
                const elem = this.container.querySelector(`#${id}`);
                if (elem && expandedStates[id]) {
                    elem.style.display = 'block';

                    // Update the corresponding toggle button text (+ to -)
                    const toggleId = id.replace('-details', '-toggle')
                                       .replace('-breakdown', '-toggle');
                    const toggleBtn = this.container.querySelector(`#${toggleId}`);
                    if (toggleBtn) {
                        const currentText = toggleBtn.textContent;
                        toggleBtn.textContent = currentText.replace('+ ', '- ');
                    }
                }
            });

            // Set up event listeners for all toggles
            this.setupToggleListeners(networthData);
        }

        /**
         * Render houses breakdown HTML
         * @param {Array} breakdown - Array of {name, level, cost}
         * @returns {string} HTML string
         */
        renderHousesBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No houses built</div>';
            }

            return breakdown.map(house =>
                `<div style="display: block; margin-bottom: 2px;">${house.name} ${house.level}: ${networthFormatter(Math.round(house.cost))}</div>`
            ).join('');
        }

        /**
         * Render abilities breakdown HTML
         * @param {Array} breakdown - Array of {name, cost}
         * @returns {string} HTML string
         */
        renderAbilitiesBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No abilities</div>';
            }

            return breakdown.map(ability =>
                `<div style="display: block; margin-bottom: 2px;">${ability.name}: ${networthFormatter(Math.round(ability.cost))}</div>`
            ).join('');
        }

        /**
         * Render equipment breakdown HTML
         * @param {Array} breakdown - Array of {name, askValue, bidValue}
         * @returns {string} HTML string
         */
        renderEquipmentBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No equipment</div>';
            }

            return breakdown.map(item =>
                `<div style="display: block; margin-bottom: 2px;">${item.name}: ${networthFormatter(Math.round(item.askValue))}</div>`
            ).join('');
        }

        /**
         * Render inventory breakdown HTML (grouped by category)
         * @param {Object} byCategory - Object with category names as keys
         * @returns {string} HTML string
         */
        renderInventoryBreakdown(byCategory) {
            if (!byCategory || Object.keys(byCategory).length === 0) {
                return '<div>No inventory</div>';
            }

            // Sort categories by total value descending
            const sortedCategories = Object.entries(byCategory)
                .sort((a, b) => b[1].totalAsk - a[1].totalAsk);

            return sortedCategories.map(([categoryName, categoryData]) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                const categoryToggleId = `${categoryId}-toggle`;

                return `
                <div style="cursor: pointer; margin-top: 4px; font-size: 0.85rem;" id="${categoryToggleId}">
                    + ${categoryName}: ${networthFormatter(Math.round(categoryData.totalAsk))}
                </div>
                <div id="${categoryId}" style="display: none; margin-left: 20px; font-size: 0.75rem; color: #999;">
                    ${categoryData.items.map(item =>
                        `<div style="display: block; margin-bottom: 2px;">${item.name} x${item.count}: ${networthFormatter(Math.round(item.askValue))}</div>`
                    ).join('')}
                </div>
            `;
            }).join('');
        }

        /**
         * Set up toggle event listeners
         * @param {Object} networthData - Networth data
         */
        setupToggleListeners(networthData) {
            // Main networth toggle
            this.setupToggle(
                'mwi-networth-toggle',
                'mwi-networth-details',
                `Total Networth: ${networthFormatter(Math.round(networthData.totalNetworth))}`
            );

            // Current assets toggle
            this.setupToggle(
                'mwi-current-assets-toggle',
                'mwi-current-assets-details',
                `Current Assets: ${networthFormatter(Math.round(networthData.currentAssets.ask))}`
            );

            // Equipment toggle
            this.setupToggle(
                'mwi-equipment-toggle',
                'mwi-equipment-breakdown',
                `Equipment value: ${networthFormatter(Math.round(networthData.currentAssets.equipped.ask))}`
            );

            // Inventory toggle
            this.setupToggle(
                'mwi-inventory-toggle',
                'mwi-inventory-breakdown',
                `Inventory value: ${networthFormatter(Math.round(networthData.currentAssets.inventory.ask))}`
            );

            // Inventory category toggles
            const byCategory = networthData.currentAssets.inventory.byCategory || {};
            Object.entries(byCategory).forEach(([categoryName, categoryData]) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                const categoryToggleId = `${categoryId}-toggle`;
                this.setupToggle(
                    categoryToggleId,
                    categoryId,
                    `${categoryName}: ${networthFormatter(Math.round(categoryData.totalAsk))}`
                );
            });

            // Fixed assets toggle
            this.setupToggle(
                'mwi-fixed-assets-toggle',
                'mwi-fixed-assets-details',
                `Fixed Assets: ${networthFormatter(Math.round(networthData.fixedAssets.total))}`
            );

            // Houses toggle
            this.setupToggle(
                'mwi-houses-toggle',
                'mwi-houses-breakdown',
                `Houses: ${networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}`
            );

            // Abilities toggle
            this.setupToggle(
                'mwi-abilities-toggle',
                'mwi-abilities-details',
                `Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}`
            );

            // Equipped abilities toggle
            this.setupToggle(
                'mwi-equipped-abilities-toggle',
                'mwi-equipped-abilities-breakdown',
                `Equipped (5): ${networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}`
            );

            // Other abilities toggle (if exists)
            if (networthData.fixedAssets.abilities.otherBreakdown.length > 0) {
                this.setupToggle(
                    'mwi-other-abilities-toggle',
                    'mwi-other-abilities-breakdown',
                    `Other Abilities: ${networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}`
                );
            }
        }

        /**
         * Set up a single toggle button
         * @param {string} toggleId - Toggle button element ID
         * @param {string} detailsId - Details element ID
         * @param {string} label - Label text (without +/- prefix)
         */
        setupToggle(toggleId, detailsId, label) {
            const toggleBtn = this.container.querySelector(`#${toggleId}`);
            const details = this.container.querySelector(`#${detailsId}`);

            if (!toggleBtn || !details) return;

            toggleBtn.addEventListener('click', () => {
                const isCollapsed = details.style.display === 'none';
                details.style.display = isCollapsed ? 'block' : 'none';
                toggleBtn.textContent = (isCollapsed ? '- ' : '+ ') + label;
            });
        }

        /**
         * Disable and cleanup
         */
        disable() {
            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
            this.currentData = null;
        }
    }

    // Export both display components
    const networthHeaderDisplay = new NetworthHeaderDisplay();
    const networthInventoryDisplay = new NetworthInventoryDisplay();

    /**
     * Networth Feature - Main Coordinator
     * Manages networth calculation and display updates
     */


    class NetworthFeature {
        constructor() {
            this.isActive = false;
            this.updateInterval = null;
            this.currentData = null;
        }

        /**
         * Initialize the networth feature
         */
        async initialize() {
            if (this.isActive) return;

            // Initialize header display (always enabled with networth feature)
            if (config.isFeatureEnabled('networth')) {
                networthHeaderDisplay.initialize();
            }

            // Initialize inventory panel display (separate toggle)
            if (config.isFeatureEnabled('inventorySummary')) {
                networthInventoryDisplay.initialize();
            }

            // Start update interval (every 30 seconds)
            this.updateInterval = setInterval(() => this.recalculate(), 30000);

            // Initial calculation
            await this.recalculate();

            this.isActive = true;
        }

        /**
         * Recalculate networth and update displays
         */
        async recalculate() {
            try {
                // Calculate networth
                const networthData = await calculateNetworth();
                this.currentData = networthData;

                // Update displays
                if (config.isFeatureEnabled('networth')) {
                    networthHeaderDisplay.update(networthData);
                }

                if (config.isFeatureEnabled('inventorySummary')) {
                    networthInventoryDisplay.update(networthData);
                }
            } catch (error) {
                console.error('[Networth] Error calculating networth:', error);
            }
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            networthHeaderDisplay.disable();
            networthInventoryDisplay.disable();

            this.currentData = null;
            this.isActive = false;
        }
    }

    // Create and export singleton instance
    const networthFeature = new NetworthFeature();

    /**
     * Inventory Sort Module
     * Sorts inventory items by Ask/Bid price with optional stack value badges
     */


    /**
     * InventorySort class manages inventory sorting and price badges
     */
    class InventorySort {
        constructor() {
            this.currentMode = 'none'; // 'ask', 'bid', 'none'
            this.unregisterHandlers = [];
            this.controlsContainer = null;
            this.currentInventoryElem = null;
            this.warnedItems = new Set(); // Track items we've already warned about
        }

        /**
         * Initialize inventory sort feature
         */
        initialize() {
            if (!config.getSetting('invSort')) {
                return;
            }

            // Prevent multiple initializations
            if (this.unregisterHandlers.length > 0) {
                return;
            }

            // Load persisted settings
            this.loadSettings();

            // Check if inventory is already open
            const existingInv = document.querySelector('[class*="Inventory_items"]');
            if (existingInv) {
                this.currentInventoryElem = existingInv;
                this.injectSortControls(existingInv);
                this.applyCurrentSort();
            }

            // Watch for inventory panel (for future opens/reloads)
            const unregister = domObserver.onClass(
                'InventorySort',
                'Inventory_items',
                (elem) => {
                    this.currentInventoryElem = elem;
                    this.injectSortControls(elem);
                    this.applyCurrentSort();
                }
            );
            this.unregisterHandlers.push(unregister);

            // Watch for any DOM changes to re-calculate prices and badges
            const badgeRefreshUnregister = domObserver.register(
                'InventorySort-BadgeRefresh',
                () => {
                    // Only refresh if inventory is currently visible
                    if (this.currentInventoryElem) {
                        this.applyCurrentSort();
                    }
                },
                { debounce: true, debounceDelay: 100 }
            );
            this.unregisterHandlers.push(badgeRefreshUnregister);

            // Listen for market data updates to refresh badges
            this.setupMarketDataListener();

        }

        /**
         * Setup listener for market data updates
         */
        setupMarketDataListener() {
            // If market data isn't loaded yet, retry periodically
            if (!marketAPI.isLoaded()) {

                let retryCount = 0;
                const maxRetries = 10;
                const retryInterval = 500; // 500ms between retries

                const retryCheck = setInterval(() => {
                    retryCount++;

                    if (marketAPI.isLoaded()) {
                        clearInterval(retryCheck);

                        // Refresh if inventory is still open
                        if (this.currentInventoryElem) {
                            this.applyCurrentSort();
                        }
                    } else if (retryCount >= maxRetries) {
                        console.warn('[InventorySort] Market data still not available after', maxRetries, 'retries');
                        clearInterval(retryCheck);
                    }
                }, retryInterval);
            }
        }

        /**
         * Load settings from localStorage
         */
        loadSettings() {
            try {
                const saved = localStorage.getItem('toolasha_inventory_sort');
                if (saved) {
                    const settings = JSON.parse(saved);
                    this.currentMode = settings.mode || 'none';
                }
            } catch (error) {
                console.error('[InventorySort] Failed to load settings:', error);
            }
        }

        /**
         * Save settings to localStorage
         */
        saveSettings() {
            try {
                localStorage.setItem('toolasha_inventory_sort', JSON.stringify({
                    mode: this.currentMode
                }));
            } catch (error) {
                console.error('[InventorySort] Failed to save settings:', error);
            }
        }

        /**
         * Inject sort controls into inventory panel
         * @param {Element} inventoryElem - Inventory items container
         */
        injectSortControls(inventoryElem) {
            // Set current inventory element
            this.currentInventoryElem = inventoryElem;

            // Check if controls already exist
            if (this.controlsContainer && document.body.contains(this.controlsContainer)) {
                return;
            }

            // Create controls container
            this.controlsContainer = document.createElement('div');
            this.controlsContainer.className = 'mwi-inventory-sort-controls';
            this.controlsContainer.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.875rem;
            text-align: left;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        `;

            // Sort label and buttons
            const sortLabel = document.createElement('span');
            sortLabel.textContent = 'Sort: ';

            const askButton = this.createSortButton('Ask', 'ask');
            const bidButton = this.createSortButton('Bid', 'bid');
            const noneButton = this.createSortButton('None', 'none');

            // Assemble controls
            this.controlsContainer.appendChild(sortLabel);
            this.controlsContainer.appendChild(askButton);
            this.controlsContainer.appendChild(bidButton);
            this.controlsContainer.appendChild(noneButton);

            // Insert before inventory
            inventoryElem.insertAdjacentElement('beforebegin', this.controlsContainer);

            // Update button states
            this.updateButtonStates();
        }

        /**
         * Create a sort button
         * @param {string} label - Button label
         * @param {string} mode - Sort mode
         * @returns {Element} Button element
         */
        createSortButton(label, mode) {
            const button = document.createElement('button');
            button.textContent = label;
            button.dataset.mode = mode;
            button.style.cssText = `
            border-radius: 3px;
            padding: 4px 12px;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        `;

            button.addEventListener('click', () => {
                this.setSortMode(mode);
            });

            return button;
        }

        /**
         * Update button visual states based on current mode
         */
        updateButtonStates() {
            if (!this.controlsContainer) return;

            const buttons = this.controlsContainer.querySelectorAll('button');
            buttons.forEach(button => {
                const isActive = button.dataset.mode === this.currentMode;

                if (isActive) {
                    button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
                    button.style.color = 'black';
                    button.style.fontWeight = 'bold';
                } else {
                    button.style.backgroundColor = '#444';
                    button.style.color = '#ccc';
                    button.style.fontWeight = 'normal';
                }
            });
        }

        /**
         * Set sort mode and apply sorting
         * @param {string} mode - Sort mode ('ask', 'bid', 'none')
         */
        setSortMode(mode) {
            this.currentMode = mode;
            this.saveSettings();
            this.updateButtonStates();
            this.applyCurrentSort();
        }

        /**
         * Apply current sort mode to inventory
         */
        applyCurrentSort() {
            if (!this.currentInventoryElem) return;

            const inventoryElem = this.currentInventoryElem;

            // Process each category
            for (const categoryDiv of inventoryElem.children) {
                // Get category name
                const categoryButton = categoryDiv.querySelector('.Inventory_categoryButton__35s1x');
                if (!categoryButton) continue;

                const categoryName = categoryButton.textContent.trim();

                // Skip categories that shouldn't be sorted or badged
                const excludedCategories = ['Loots', 'Currencies'];
                if (excludedCategories.includes(categoryName)) {
                    continue;
                }

                // Equipment category: only process charms (for badges), don't sort
                const isEquipmentCategory = categoryName === 'Equipment';
                const shouldSort = !isEquipmentCategory;

                // Ensure category label stays at top
                const label = categoryDiv.querySelector('.Inventory_label__XEOAx');
                if (label) {
                    label.style.order = Number.MIN_SAFE_INTEGER;
                }

                // Get all item elements
                const itemElems = categoryDiv.querySelectorAll('.Item_itemContainer__x7kH1');

                // Always calculate prices (for badges), filtering to charms only in Equipment category
                this.calculateItemPrices(itemElems, isEquipmentCategory);

                if (shouldSort && this.currentMode !== 'none') {
                    // Sort by price (skip sorting for Equipment category)
                    this.sortItemsByPrice(itemElems, this.currentMode);
                } else {
                    // Reset to default order
                    itemElems.forEach(itemElem => {
                        itemElem.style.order = 0;
                    });
                }
            }

            // Update price badges (controlled by global setting)
            this.updatePriceBadges();
        }

        /**
         * Calculate and store prices for all items (for badges and sorting)
         * @param {NodeList} itemElems - Item elements
         * @param {boolean} isEquipmentCategory - True if processing Equipment category (only charms)
         */
        calculateItemPrices(itemElems, isEquipmentCategory = false) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                console.warn('[InventorySort] Game data not available yet');
                return;
            }

            for (const itemElem of itemElems) {
                // Get item HRID from SVG aria-label
                const svg = itemElem.querySelector('svg');
                if (!svg) continue;

                let itemName = svg.getAttribute('aria-label');
                if (!itemName) continue;

                // Find item HRID
                const itemHrid = this.findItemHrid(itemName, gameData);
                if (!itemHrid) {
                    console.warn('[InventorySort] Could not find HRID for item:', itemName);
                    continue;
                }

                // In Equipment category, only process charms
                if (isEquipmentCategory) {
                    const itemDetails = gameData.itemDetailMap[itemHrid];
                    const isCharm = itemDetails?.equipmentDetail?.type === '/equipment_types/charm';
                    if (!isCharm) {
                        // Not a charm, skip this equipment item
                        itemElem.dataset.askValue = 0;
                        itemElem.dataset.bidValue = 0;
                        continue;
                    }

                    // Skip trainee charms (untradeable, no market data)
                    if (itemHrid.includes('trainee_')) {
                        itemElem.dataset.askValue = 0;
                        itemElem.dataset.bidValue = 0;
                        continue;
                    }
                }

                // Get item count
                const countElem = itemElem.querySelector('.Item_count__1HVvv');
                if (!countElem) continue;

                let itemCount = countElem.textContent;
                itemCount = this.parseItemCount(itemCount);

                // Get market price
                const marketPrice = marketAPI.getPrice(itemHrid, 0);
                if (!marketPrice) {
                    // Only warn once per item to avoid console spam
                    if (!this.warnedItems.has(itemHrid)) {
                        console.warn('[InventorySort] No market data for:', itemName, itemHrid);
                        this.warnedItems.add(itemHrid);
                    }
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                    continue;
                }

                // Store both ask and bid values
                const askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                const bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;

                // Removed zero-price warning to reduce console spam
                // Non-zero prices are normal for many items

                itemElem.dataset.askValue = askPrice * itemCount;
                itemElem.dataset.bidValue = bidPrice * itemCount;
            }

            // Summary warning removed - individual items already warn once per session
        }

        /**
         * Sort items by price (ask or bid)
         * @param {NodeList} itemElems - Item elements
         * @param {string} mode - 'ask' or 'bid'
         */
        sortItemsByPrice(itemElems, mode) {
            // Convert NodeList to array with values
            const items = Array.from(itemElems).map(elem => ({
                elem,
                value: parseFloat(elem.dataset[mode + 'Value']) || 0
            }));

            // Sort by value descending (highest first)
            items.sort((a, b) => b.value - a.value);

            // Assign sequential order values (0, 1, 2, 3...)
            items.forEach((item, index) => {
                item.elem.style.order = index;
            });
        }

        /**
         * Update price badges on all items
         */
        updatePriceBadges() {
            if (!this.currentInventoryElem) return;

            const itemElems = this.currentInventoryElem.querySelectorAll('.Item_itemContainer__x7kH1');
            const showBadges = config.getSetting('invSort_showBadges');

            for (const itemElem of itemElems) {
                // Remove existing badge
                const existingBadge = itemElem.querySelector('.mwi-stack-price');
                if (existingBadge) {
                    existingBadge.remove();
                }

                // Show badges if enabled AND not in 'none' mode
                if (showBadges && this.currentMode !== 'none') {
                    // Use current sort mode's value
                    const valueKey = this.currentMode + 'Value';
                    const stackValue = parseFloat(itemElem.dataset[valueKey]) || 0;

                    if (stackValue > 0) {
                        this.renderPriceBadge(itemElem, stackValue);
                    }
                }
            }
        }

        /**
         * Render price badge on item
         * @param {Element} itemElem - Item container element
         * @param {number} stackValue - Total stack value
         */
        renderPriceBadge(itemElem, stackValue) {
            // Ensure item has relative positioning
            itemElem.style.position = 'relative';

            // Create badge element
            const badge = document.createElement('div');
            badge.className = 'mwi-stack-price';
            badge.style.cssText = `
            position: absolute;
            top: 2px;
            left: 2px;
            z-index: 1;
            color: ${config.SCRIPT_COLOR_MAIN};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: left;
            pointer-events: none;
        `;
            badge.textContent = formatKMB(Math.round(stackValue), 0);

            // Insert into item
            const itemInner = itemElem.querySelector('.Item_item__2De2O');
            if (itemInner) {
                itemInner.appendChild(badge);
            }
        }

        /**
         * Find item HRID from item name
         * @param {string} itemName - Item display name
         * @param {Object} gameData - Game data
         * @returns {string|null} Item HRID
         */
        findItemHrid(itemName, gameData) {
            // Direct lookup in itemDetailMap
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                if (item.name === itemName) {
                    return hrid;
                }
            }
            return null;
        }

        /**
         * Parse item count from text (handles K, M suffixes)
         * @param {string} text - Count text
         * @returns {number} Numeric count
         */
        parseItemCount(text) {
            text = text.toLowerCase().trim();

            if (text.includes('k')) {
                return parseFloat(text.replace('k', '')) * 1000;
            } else if (text.includes('m')) {
                return parseFloat(text.replace('m', '')) * 1000000;
            } else {
                return parseFloat(text) || 0;
            }
        }

        /**
         * Refresh badges (called when badge setting changes)
         */
        refresh() {
            this.updatePriceBadges();
        }

        /**
         * Disable and cleanup
         */
        disable() {
            // Remove controls
            if (this.controlsContainer) {
                this.controlsContainer.remove();
                this.controlsContainer = null;
            }

            // Remove all badges
            const badges = document.querySelectorAll('.mwi-stack-price');
            badges.forEach(badge => badge.remove());

            // Unregister observers
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];

            this.currentInventoryElem = null;
        }
    }

    // Create and export singleton instance
    const inventorySort = new InventorySort();

    /**
     * Enhancement Session Data Structure
     * Represents a single enhancement tracking session for one item
     */

    /**
     * Session states
     */
    const SessionState = {
        TRACKING: 'tracking',   // Currently tracking enhancements
        COMPLETED: 'completed'};

    /**
     * Create a new enhancement session
     * @param {string} itemHrid - Item HRID being enhanced
     * @param {string} itemName - Display name of item
     * @param {number} startLevel - Starting enhancement level
     * @param {number} targetLevel - Target enhancement level (1-20)
     * @param {number} protectFrom - Level to start using protection items (0 = never)
     * @returns {Object} New session object
     */
    function createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom = 0) {
        const now = Date.now();

        return {
            // Session metadata
            id: `session_${now}`,
            state: SessionState.TRACKING,
            itemHrid,
            itemName,
            startLevel,
            targetLevel,
            currentLevel: startLevel,
            protectFrom,

            // Timestamps
            startTime: now,
            lastUpdateTime: now,
            endTime: null,

            // Last attempt tracking (for detecting success/failure)
            lastAttempt: {
                attemptNumber: 0,
                level: startLevel,
                timestamp: now
            },

            // Attempt tracking (per level)
            // Format: { 1: { success: 5, fail: 3, successRate: 0.625 }, ... }
            attemptsPerLevel: {},

            // Cost tracking
            materialCosts: {}, // Format: { itemHrid: { count: 10, totalCost: 50000 } }
            coinCost: 0,
            coinCount: 0, // Track number of times coins were spent
            protectionCost: 0,
            protectionCount: 0,
            protectionItemHrid: null, // Track which protection item is being used
            totalCost: 0,

            // Statistics
            totalAttempts: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            totalXP: 0, // Total XP gained from enhancements
            longestSuccessStreak: 0,
            longestFailureStreak: 0,
            currentStreak: { type: null, count: 0 }, // 'success' or 'fail'

            // Milestones reached
            milestonesReached: [], // [5, 10, 15, 20]

            // Enhancement predictions (optional - calculated at session start)
            predictions: null // { expectedAttempts, expectedProtections, ... }
        };
    }

    /**
     * Initialize attempts tracking for a level
     * @param {Object} session - Session object
     * @param {number} level - Enhancement level
     */
    function initializeLevelTracking(session, level) {
        if (!session.attemptsPerLevel[level]) {
            session.attemptsPerLevel[level] = {
                success: 0,
                fail: 0,
                successRate: 0
            };
        }
    }

    /**
     * Update success rate for a level
     * @param {Object} session - Session object
     * @param {number} level - Enhancement level
     */
    function updateSuccessRate(session, level) {
        const levelData = session.attemptsPerLevel[level];
        if (!levelData) return;

        const total = levelData.success + levelData.fail;
        levelData.successRate = total > 0 ? levelData.success / total : 0;
    }

    /**
     * Record a successful enhancement attempt
     * @param {Object} session - Session object
     * @param {number} previousLevel - Level before enhancement (level that succeeded)
     * @param {number} newLevel - New level after success
     */
    function recordSuccess(session, previousLevel, newLevel) {
        // Initialize tracking if needed for the level that succeeded
        initializeLevelTracking(session, previousLevel);

        // Record success at the level we enhanced FROM
        session.attemptsPerLevel[previousLevel].success++;
        session.totalAttempts++;
        session.totalSuccesses++;

        // Update success rate for this level
        updateSuccessRate(session, previousLevel);

        // Update current level
        session.currentLevel = newLevel;

        // Update streaks
        if (session.currentStreak.type === 'success') {
            session.currentStreak.count++;
        } else {
            session.currentStreak = { type: 'success', count: 1 };
        }

        if (session.currentStreak.count > session.longestSuccessStreak) {
            session.longestSuccessStreak = session.currentStreak.count;
        }

        // Check for milestones
        if ([5, 10, 15, 20].includes(newLevel) && !session.milestonesReached.includes(newLevel)) {
            session.milestonesReached.push(newLevel);
        }

        // Update timestamp
        session.lastUpdateTime = Date.now();

        // Check if target reached
        if (newLevel >= session.targetLevel) {
            session.state = SessionState.COMPLETED;
            session.endTime = Date.now();
        }
    }

    /**
     * Record a failed enhancement attempt
     * @param {Object} session - Session object
     * @param {number} previousLevel - Level that failed (level we tried to enhance from)
     */
    function recordFailure(session, previousLevel) {
        // Initialize tracking if needed for the level that failed
        initializeLevelTracking(session, previousLevel);

        // Record failure at the level we enhanced FROM
        session.attemptsPerLevel[previousLevel].fail++;
        session.totalAttempts++;
        session.totalFailures++;

        // Update success rate for this level
        updateSuccessRate(session, previousLevel);

        // Update streaks
        if (session.currentStreak.type === 'fail') {
            session.currentStreak.count++;
        } else {
            session.currentStreak = { type: 'fail', count: 1 };
        }

        if (session.currentStreak.count > session.longestFailureStreak) {
            session.longestFailureStreak = session.currentStreak.count;
        }

        // Update timestamp
        session.lastUpdateTime = Date.now();
    }

    /**
     * Add material cost to session
     * @param {Object} session - Session object
     * @param {string} itemHrid - Material item HRID
     * @param {number} count - Quantity used
     * @param {number} unitCost - Cost per item (from market)
     */
    function addMaterialCost(session, itemHrid, count, unitCost) {
        if (!session.materialCosts[itemHrid]) {
            session.materialCosts[itemHrid] = {
                count: 0,
                totalCost: 0
            };
        }

        session.materialCosts[itemHrid].count += count;
        session.materialCosts[itemHrid].totalCost += count * unitCost;

        // Update total cost
        recalculateTotalCost(session);
    }

    /**
     * Add coin cost to session
     * @param {Object} session - Session object
     * @param {number} amount - Coin amount spent
     */
    function addCoinCost(session, amount) {
        session.coinCost += amount;
        session.coinCount += 1;
        recalculateTotalCost(session);
    }

    /**
     * Add protection item cost to session
     * @param {Object} session - Session object
     * @param {string} protectionItemHrid - Protection item HRID
     * @param {number} cost - Protection item cost
     */
    function addProtectionCost(session, protectionItemHrid, cost) {
        session.protectionCost += cost;
        session.protectionCount += 1;

        // Store the protection item HRID if not already set
        if (!session.protectionItemHrid) {
            session.protectionItemHrid = protectionItemHrid;
        }

        recalculateTotalCost(session);
    }

    /**
     * Recalculate total cost from all sources
     * @param {Object} session - Session object
     */
    function recalculateTotalCost(session) {
        const materialTotal = Object.values(session.materialCosts)
            .reduce((sum, m) => sum + m.totalCost, 0);

        session.totalCost = materialTotal + session.coinCost + session.protectionCost;
    }

    /**
     * Get session duration in seconds
     * @param {Object} session - Session object
     * @returns {number} Duration in seconds
     */
    function getSessionDuration(session) {
        const endTime = session.endTime || Date.now();
        return Math.floor((endTime - session.startTime) / 1000);
    }

    /**
     * Finalize session (mark as completed)
     * @param {Object} session - Session object
     */
    function finalizeSession(session) {
        session.state = SessionState.COMPLETED;
        session.endTime = Date.now();
    }

    /**
     * Check if session matches given item and level criteria (for resume logic)
     * @param {Object} session - Session object
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @param {number} targetLevel - Target level
     * @param {number} protectFrom - Protection level
     * @returns {boolean} True if session matches
     */
    function sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom = 0) {
        // Must be same item
        if (session.itemHrid !== itemHrid) return false;

        // Can only resume tracking sessions (not completed/archived)
        if (session.state !== SessionState.TRACKING) return false;

        // Must match protection settings exactly (Ultimate Tracker requirement)
        if (session.protectFrom !== protectFrom) return false;

        // Must match target level exactly (Ultimate Tracker requirement)
        if (session.targetLevel !== targetLevel) return false;

        // Must match current level (with small tolerance for out-of-order events)
        const levelDiff = Math.abs(session.currentLevel - currentLevel);
        if (levelDiff <= 1) {
            return true;
        }

        return false;
    }

    /**
     * Check if a completed session can be extended
     * @param {Object} session - Session object
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @returns {boolean} True if session can be extended
     */
    function canExtendSession(session, itemHrid, currentLevel) {
        // Must be same item
        if (session.itemHrid !== itemHrid) return false;

        // Must be completed
        if (session.state !== SessionState.COMPLETED) return false;

        // Current level should match where session ended (or close)
        const levelDiff = Math.abs(session.currentLevel - currentLevel);
        if (levelDiff <= 1) {
            return true;
        }

        return false;
    }

    /**
     * Extend a completed session to a new target level
     * @param {Object} session - Session object
     * @param {number} newTargetLevel - New target level
     */
    function extendSession(session, newTargetLevel) {
        session.state = SessionState.TRACKING;
        session.targetLevel = newTargetLevel;
        session.endTime = null;
        session.lastUpdateTime = Date.now();
    }

    /**
     * Validate session data integrity
     * @param {Object} session - Session object
     * @returns {boolean} True if valid
     */
    function validateSession(session) {
        if (!session || typeof session !== 'object') return false;

        // Required fields
        if (!session.id || !session.itemHrid || !session.itemName) return false;
        if (typeof session.startLevel !== 'number' || typeof session.targetLevel !== 'number') return false;
        if (typeof session.currentLevel !== 'number') return false;

        // Validate level ranges
        if (session.startLevel < 0 || session.startLevel > 20) return false;
        if (session.targetLevel < 1 || session.targetLevel > 20) return false;
        if (session.currentLevel < 0 || session.currentLevel > 20) return false;

        // Validate costs are non-negative
        if (session.totalCost < 0 || session.coinCost < 0 || session.protectionCost < 0) return false;

        return true;
    }

    /**
     * Enhancement Tracker Storage
     * Handles persistence of enhancement sessions using IndexedDB
     */


    const STORAGE_KEY = 'enhancementTracker_sessions';
    const CURRENT_SESSION_KEY = 'enhancementTracker_currentSession';
    const STORAGE_STORE = 'settings'; // Use existing 'settings' store

    /**
     * Save all sessions to storage
     * @param {Object} sessions - Sessions object (keyed by session ID)
     * @returns {Promise<void>}
     */
    async function saveSessions(sessions) {
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
    async function loadSessions() {
        try {
            const sessions = await storage.getJSON(STORAGE_KEY, STORAGE_STORE, {});
            return sessions;
        } catch (error) {
            return {};
        }
    }

    /**
     * Save current session ID
     * @param {string|null} sessionId - Current session ID (null if no active session)
     * @returns {Promise<void>}
     */
    async function saveCurrentSessionId(sessionId) {
        try {
            await storage.set(CURRENT_SESSION_KEY, sessionId, STORAGE_STORE, true); // immediate=true for rapid updates
        } catch (error) {
        }
    }

    /**
     * Load current session ID
     * @returns {Promise<string|null>} Current session ID or null
     */
    async function loadCurrentSessionId() {
        try {
            return await storage.get(CURRENT_SESSION_KEY, STORAGE_STORE, null);
        } catch (error) {
            return null;
        }
    }

    /**
     * Enhancement XP Calculations
     * Based on Ultimate Enhancement Tracker formulas
     */


    /**
     * Get base item level from item HRID
     * @param {string} itemHrid - Item HRID
     * @returns {number} Base item level
     */
    function getBaseItemLevel(itemHrid) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemData = gameData?.itemDetailMap?.[itemHrid];
            return itemData?.level || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get wisdom buff percentage from all sources
     * Reads from dataManager.characterData (NOT localStorage)
     * @returns {number} Wisdom buff as decimal (e.g., 0.20 for 20%)
     */
    function getWisdomBuff() {
        try {
            // Use dataManager for character data (NOT localStorage)
            const charData = dataManager.characterData;
            if (!charData) return 0;

            let totalFlatBoost = 0;

            // 1. Community Buffs
            const communityEnhancingBuffs = charData.communityActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(communityEnhancingBuffs)) {
                communityEnhancingBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 2. Equipment Buffs
            const equipmentEnhancingBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(equipmentEnhancingBuffs)) {
                equipmentEnhancingBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 3. House Buffs
            const houseEnhancingBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(houseEnhancingBuffs)) {
                houseEnhancingBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 4. Consumable Buffs (from wisdom tea, etc.)
            const consumableEnhancingBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(consumableEnhancingBuffs)) {
                consumableEnhancingBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // Return as decimal (flatBoost is already in decimal form, e.g., 0.2 for 20%)
            return totalFlatBoost;

        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate XP gained from successful enhancement
     * Formula: 1.4 × (1 + wisdom) × enhancementMultiplier × (10 + baseItemLevel)
     * @param {number} previousLevel - Enhancement level before success
     * @param {string} itemHrid - Item HRID
     * @returns {number} XP gained
     */
    function calculateSuccessXP(previousLevel, itemHrid) {
        const baseLevel = getBaseItemLevel(itemHrid);
        const wisdomBuff = getWisdomBuff();

        // Special handling for enhancement level 0 (base items)
        const enhancementMultiplier = previousLevel === 0
            ? 1.0  // Base value for unenhanced items
            : (previousLevel + 1);  // Normal progression

        return Math.floor(
            1.4 *
            (1 + wisdomBuff) *
            enhancementMultiplier *
            (10 + baseLevel)
        );
    }

    /**
     * Calculate XP gained from failed enhancement
     * Formula: 10% of success XP
     * @param {number} previousLevel - Enhancement level that failed
     * @param {string} itemHrid - Item HRID
     * @returns {number} XP gained
     */
    function calculateFailureXP(previousLevel, itemHrid) {
        return Math.floor(calculateSuccessXP(previousLevel, itemHrid) * 0.1);
    }

    /**
     * Calculate adjusted attempt number from session data
     * This makes tracking resume-proof (doesn't rely on WebSocket currentCount)
     * @param {Object} session - Session object
     * @returns {number} Next attempt number
     */
    function calculateAdjustedAttemptCount(session) {
        let successCount = 0;
        let failCount = 0;

        // Sum all successes and failures across all levels
        for (const level in session.attemptsPerLevel) {
            const levelData = session.attemptsPerLevel[level];
            successCount += levelData.success || 0;
            failCount += levelData.fail || 0;
        }

        // For the first attempt, return 1
        if (successCount === 0 && failCount === 0) {
            return 1;
        }

        // Return total + 1 for the next attempt
        return successCount + failCount + 1;
    }

    /**
     * Calculate enhancement predictions using character stats
     * @param {string} itemHrid - Item HRID being enhanced
     * @param {number} startLevel - Starting enhancement level
     * @param {number} targetLevel - Target enhancement level
     * @param {number} protectFrom - Level to start using protection
     * @returns {Object|null} Prediction data or null if cannot calculate
     */
    function calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom) {
        try {
            // Use dataManager for character data (NOT localStorage)
            const charData = dataManager.characterData;
            const gameData = dataManager.getInitClientData();

            if (!charData || !gameData) {
                return null;
            }

            // Get item level
            const itemData = gameData.itemDetailMap?.[itemHrid];
            if (!itemData) {
                return null;
            }
            const itemLevel = itemData.level || 0;

            // Get enhancing skill level
            const enhancingLevel = charData.characterSkills?.['/skills/enhancing']?.level || 1;

            // Get house level (Observatory)
            const houseRooms = charData.characterHouseRoomMap;
            let houseLevel = 0;
            if (houseRooms) {
                for (const roomHrid in houseRooms) {
                    const room = houseRooms[roomHrid];
                    if (room.houseRoomHrid === '/house_rooms/observatory') {
                        houseLevel = room.level || 0;
                        break;
                    }
                }
            }

            // Get equipment buffs for enhancing
            let toolBonus = 0;
            let speedBonus = 0;
            const equipmentBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(equipmentBuffs)) {
                equipmentBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/enhancing_success') {
                        toolBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                    }
                    if (buff.typeHrid === '/buff_types/enhancing_speed') {
                        speedBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                    }
                });
            }

            // Add house buffs
            const houseBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(houseBuffs)) {
                houseBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/enhancing_success') {
                        toolBonus += (buff.flatBoost || 0) * 100;
                    }
                    if (buff.typeHrid === '/buff_types/enhancing_speed') {
                        speedBonus += (buff.flatBoost || 0) * 100;
                    }
                });
            }

            // Check for blessed tea
            let hasBlessed = false;
            let guzzlingBonus = 1.0;
            const enhancingTeas = charData.actionTypeDrinkSlotsMap?.['/action_types/enhancing'] || [];
            const activeTeas = enhancingTeas.filter(tea => tea?.isActive);

            activeTeas.forEach(tea => {
                if (tea.itemHrid === '/items/blessed_tea') {
                    hasBlessed = true;
                }
            });

            // Get guzzling pouch bonus (drink concentration)
            const consumableBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(consumableBuffs)) {
                consumableBuffs.forEach(buff => {
                    if (buff.typeHrid === '/buff_types/drink_concentration') {
                        guzzlingBonus = 1.0 + (buff.flatBoost || 0);
                    }
                });
            }

            // Calculate predictions
            const result = calculateEnhancement({
                enhancingLevel,
                houseLevel,
                toolBonus,
                speedBonus,
                itemLevel,
                targetLevel,
                protectFrom,
                blessedTea: hasBlessed,
                guzzlingBonus
            });

            if (!result) {
                return null;
            }

            return {
                expectedAttempts: Math.round(result.attemptsRounded),
                expectedProtections: Math.round(result.protectionCount),
                expectedTime: result.totalTime,
                successMultiplier: result.successMultiplier
            };

        } catch (error) {
            return null;
        }
    }

    /**
     * Enhancement Tracker
     * Main tracker class for monitoring enhancement attempts, costs, and statistics
     */


    /**
     * EnhancementTracker class manages enhancement tracking sessions
     */
    class EnhancementTracker {
        constructor() {
            this.sessions = {}; // All sessions (keyed by session ID)
            this.currentSessionId = null; // Currently active session ID
            this.isInitialized = false;
        }

        /**
         * Initialize enhancement tracker
         * @returns {Promise<void>}
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('enhancementTracker')) {
                return;
            }

            try {
                // Load sessions from storage
                this.sessions = await loadSessions();
                this.currentSessionId = await loadCurrentSessionId();

                // Validate current session still exists
                if (this.currentSessionId && !this.sessions[this.currentSessionId]) {
                    this.currentSessionId = null;
                    await saveCurrentSessionId(null);
                }

                // Validate all loaded sessions
                for (const [sessionId, session] of Object.entries(this.sessions)) {
                    if (!validateSession(session)) {
                        delete this.sessions[sessionId];
                    }
                }

                this.isInitialized = true;
            } catch (error) {
            }
        }

        /**
         * Start a new enhancement session
         * @param {string} itemHrid - Item HRID being enhanced
         * @param {number} startLevel - Starting enhancement level
         * @param {number} targetLevel - Target enhancement level
         * @param {number} protectFrom - Level to start using protection (0 = never)
         * @returns {Promise<string>} New session ID
         */
        async startSession(itemHrid, startLevel, targetLevel, protectFrom = 0) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                throw new Error('Game data not available');
            }

            // Get item name
            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails) {
                throw new Error(`Item not found: ${itemHrid}`);
            }

            const itemName = itemDetails.name;

            // Create new session
            const session = createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom);

            // Calculate predictions
            const predictions = calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom);
            session.predictions = predictions;

            // Store session
            this.sessions[session.id] = session;
            this.currentSessionId = session.id;

            // Save to storage
            await saveSessions(this.sessions);
            await saveCurrentSessionId(session.id);

            return session.id;
        }

        /**
         * Find a matching previous session that can be resumed
         * @param {string} itemHrid - Item HRID
         * @param {number} currentLevel - Current enhancement level
         * @param {number} targetLevel - Target level
         * @param {number} protectFrom - Protection level
         * @returns {string|null} Session ID if found, null otherwise
         */
        findMatchingSession(itemHrid, currentLevel, targetLevel, protectFrom = 0) {
            for (const [sessionId, session] of Object.entries(this.sessions)) {
                if (sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom)) {
                    return sessionId;
                }
            }

            return null;
        }

        /**
         * Resume an existing session
         * @param {string} sessionId - Session ID to resume
         * @returns {Promise<boolean>} True if resumed successfully
         */
        async resumeSession(sessionId) {
            if (!this.sessions[sessionId]) {
                return false;
            }

            const session = this.sessions[sessionId];

            // Can only resume tracking sessions
            if (session.state !== SessionState.TRACKING) {
                return false;
            }

            this.currentSessionId = sessionId;
            await saveCurrentSessionId(sessionId);

            return true;
        }

        /**
         * Find a completed session that can be extended
         * @param {string} itemHrid - Item HRID
         * @param {number} currentLevel - Current enhancement level
         * @returns {string|null} Session ID if found, null otherwise
         */
        findExtendableSession(itemHrid, currentLevel) {
            for (const [sessionId, session] of Object.entries(this.sessions)) {
                if (canExtendSession(session, itemHrid, currentLevel)) {
                    return sessionId;
                }
            }

            return null;
        }

        /**
         * Extend a completed session to a new target level
         * @param {string} sessionId - Session ID to extend
         * @param {number} newTargetLevel - New target level
         * @returns {Promise<boolean>} True if extended successfully
         */
        async extendSessionTarget(sessionId, newTargetLevel) {
            if (!this.sessions[sessionId]) {
                return false;
            }

            const session = this.sessions[sessionId];

            // Can only extend completed sessions
            if (session.state !== SessionState.COMPLETED) {
                return false;
            }

            extendSession(session, newTargetLevel);
            this.currentSessionId = sessionId;

            await saveSessions(this.sessions);
            await saveCurrentSessionId(sessionId);

            return true;
        }

        /**
         * Get current active session
         * @returns {Object|null} Current session or null
         */
        getCurrentSession() {
            if (!this.currentSessionId) return null;
            return this.sessions[this.currentSessionId] || null;
        }

        /**
         * Finalize current session (mark as completed)
         * @returns {Promise<void>}
         */
        async finalizeCurrentSession() {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            finalizeSession(session);
            await saveSessions(this.sessions);


            // Clear current session
            this.currentSessionId = null;
            await saveCurrentSessionId(null);
        }

        /**
         * Record a successful enhancement attempt
         * @param {number} previousLevel - Level before success
         * @param {number} newLevel - New level after success
         * @returns {Promise<void>}
         */
        async recordSuccess(previousLevel, newLevel) {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            recordSuccess(session, previousLevel, newLevel);
            await saveSessions(this.sessions);


            // Check if target reached
            if (session.state === SessionState.COMPLETED) {
                this.currentSessionId = null;
                await saveCurrentSessionId(null);
            }
        }

        /**
         * Record a failed enhancement attempt
         * @param {number} previousLevel - Level that failed
         * @returns {Promise<void>}
         */
        async recordFailure(previousLevel) {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            recordFailure(session, previousLevel);
            await saveSessions(this.sessions);

        }

        /**
         * Track material costs for current session
         * @param {string} itemHrid - Material item HRID
         * @param {number} count - Quantity used
         * @returns {Promise<void>}
         */
        async trackMaterialCost(itemHrid, count) {
            const session = this.getCurrentSession();
            if (!session) return;

            // Get market price
            const priceData = marketAPI.getPrice(itemHrid, 0);
            const unitCost = priceData ? (priceData.ask || priceData.bid || 0) : 0;

            addMaterialCost(session, itemHrid, count, unitCost);
            await saveSessions(this.sessions);

        }

        /**
         * Track coin cost for current session
         * @param {number} amount - Coin amount spent
         * @returns {Promise<void>}
         */
        async trackCoinCost(amount) {
            const session = this.getCurrentSession();
            if (!session) return;

            addCoinCost(session, amount);
            await saveSessions(this.sessions);

        }

        /**
         * Track protection item cost for current session
         * @param {string} protectionItemHrid - Protection item HRID
         * @param {number} cost - Protection item cost
         * @returns {Promise<void>}
         */
        async trackProtectionCost(protectionItemHrid, cost) {
            const session = this.getCurrentSession();
            if (!session) return;

            addProtectionCost(session, protectionItemHrid, cost);
            await saveSessions(this.sessions);

        }

        /**
         * Get all sessions
         * @returns {Object} All sessions
         */
        getAllSessions() {
            return this.sessions;
        }

        /**
         * Get session by ID
         * @param {string} sessionId - Session ID
         * @returns {Object|null} Session or null
         */
        getSession(sessionId) {
            return this.sessions[sessionId] || null;
        }

        /**
         * Save sessions to storage (can be called directly)
         * @returns {Promise<void>}
         */
        async saveSessions() {
            await saveSessions(this.sessions);
        }

        /**
         * Disable and cleanup
         */
        disable() {
            this.isInitialized = false;
        }
    }

    // Create and export singleton instance
    const enhancementTracker = new EnhancementTracker();

    /**
     * Enhancement Tracker Floating UI
     * Displays enhancement session statistics in a draggable panel
     * Based on Ultimate Enhancement Tracker v3.7.9
     */


    // UI Style Constants (matching Ultimate Enhancement Tracker)
    const STYLE = {
        colors: {
            primary: '#00ffe7',
            border: 'rgba(0, 255, 234, 0.4)',
            textPrimary: '#e0f7ff',
            textSecondary: '#9b9bff',
            accent: '#ff00d4',
            danger: '#ff0055',
            success: '#00ff99',
            headerBg: 'rgba(15, 5, 35, 0.7)',
            gold: '#FFD700'
        },
        borderRadius: {
            medium: '8px'},
        transitions: {
            fast: 'all 0.15s ease'}
    };

    // Table styling
    const compactTableStyle = `
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 0;
`;

    const compactHeaderStyle = `
    padding: 4px 6px;
    background: ${STYLE.colors.headerBg};
    border: 1px solid ${STYLE.colors.border};
    color: ${STYLE.colors.textPrimary};
    font-weight: bold;
    text-align: center;
`;

    const compactCellStyle = `
    padding: 3px 6px;
    border: 1px solid rgba(0, 255, 234, 0.2);
    color: ${STYLE.colors.textPrimary};
`;

    /**
     * Enhancement UI Manager
     */
    class EnhancementUI {
        constructor() {
            this.floatingUI = null;
            this.currentViewingIndex = 0; // Index in sessions array
            this.updateDebounce = null;
            this.isDragging = false;
            this.screenObserver = null;
            this.isOnEnhancingScreen = false;
        }

        /**
         * Initialize the UI
         */
        initialize() {
            this.createFloatingUI();
            this.updateUI();

            // Set up screen observer for visibility control
            this.setupScreenObserver();

            // Update UI every second during active sessions
            setInterval(() => {
                const session = this.getCurrentSession();
                if (session && session.state === SessionState.TRACKING) {
                    this.updateUI();
                }
            }, 1000);
        }

        /**
         * Set up screen observer to detect Enhancing screen
         */
        setupScreenObserver() {
            // Check if setting is enabled
            if (!config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen')) {
                // Setting is disabled, always show tracker
                this.isOnEnhancingScreen = true;
                this.show();
                return;
            }

            // Initial check and set visibility
            this.checkEnhancingScreen();
            this.updateVisibility(); // Always set initial visibility

            // Set up MutationObserver to detect screen changes
            this.screenObserver = new MutationObserver(() => {
                this.checkEnhancingScreen();
            });

            this.screenObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        /**
         * Check if currently on Enhancing screen
         */
        checkEnhancingScreen() {
            const enhancingPanel = document.querySelector('div.SkillActionDetail_enhancingComponent__17bOx');
            const wasOnEnhancingScreen = this.isOnEnhancingScreen;
            this.isOnEnhancingScreen = !!enhancingPanel;

            // Only update visibility if screen state changed
            if (wasOnEnhancingScreen !== this.isOnEnhancingScreen) {
                this.updateVisibility();
            }
        }

        /**
         * Update visibility based on screen state and settings
         */
        updateVisibility() {
            const showOnlyOnEnhancingScreen = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

            if (!showOnlyOnEnhancingScreen) {
                // Setting is disabled, always show
                this.show();
            } else if (this.isOnEnhancingScreen) {
                // On Enhancing screen, show
                this.show();
            } else {
                // Not on Enhancing screen, hide
                this.hide();
            }
        }

        /**
         * Get currently viewed session
         */
        getCurrentSession() {
            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) return null;

            // Ensure index is valid
            if (this.currentViewingIndex >= sessions.length) {
                this.currentViewingIndex = sessions.length - 1;
            }
            if (this.currentViewingIndex < 0) {
                this.currentViewingIndex = 0;
            }

            return sessions[this.currentViewingIndex];
        }

        /**
         * Create the floating UI panel
         */
        createFloatingUI() {
            if (this.floatingUI && document.body.contains(this.floatingUI)) {
                return this.floatingUI;
            }

            // Main container
            this.floatingUI = document.createElement('div');
            this.floatingUI.id = 'enhancementFloatingUI';
            Object.assign(this.floatingUI.style, {
                position: 'fixed',
                top: '50px',
                left: '50px',
                zIndex: '9998',
                fontSize: '14px',
                padding: '0',
                borderRadius: STYLE.borderRadius.medium,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                overflow: 'hidden',
                width: '350px',
                minHeight: 'auto',
                background: 'rgba(25, 0, 35, 0.92)',
                backdropFilter: 'blur(12px)',
                border: `1px solid ${STYLE.colors.primary}`,
                color: STYLE.colors.textPrimary,
                display: 'flex',
                flexDirection: 'column'
            });

            // Create header
            const header = this.createHeader();
            this.floatingUI.appendChild(header);

            // Create content area
            const content = document.createElement('div');
            content.id = 'enhancementPanelContent';
            content.style.padding = '15px';
            content.style.flexGrow = '1';
            content.style.overflow = 'auto';
            this.floatingUI.appendChild(content);

            // Make draggable
            this.makeDraggable(header);

            // Add to page
            document.body.appendChild(this.floatingUI);

            return this.floatingUI;
        }

        /**
         * Create header with title and navigation
         */
        createHeader() {
            const header = document.createElement('div');
            header.id = 'enhancementPanelHeader';
            Object.assign(header.style, {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'move',
                padding: '10px 15px',
                background: STYLE.colors.headerBg,
                borderBottom: `1px solid ${STYLE.colors.border}`,
                userSelect: 'none',
                flexShrink: '0'
            });

            // Title with session counter
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'center';
            titleContainer.style.gap = '10px';

            const title = document.createElement('span');
            title.textContent = 'Enhancement Tracker';
            title.style.fontWeight = 'bold';

            const sessionCounter = document.createElement('span');
            sessionCounter.id = 'enhancementSessionCounter';
            sessionCounter.style.fontSize = '12px';
            sessionCounter.style.opacity = '0.7';
            sessionCounter.style.marginLeft = '5px';

            titleContainer.appendChild(title);
            titleContainer.appendChild(sessionCounter);

            // Navigation container
            const navContainer = document.createElement('div');
            Object.assign(navContainer.style, {
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
                marginLeft: 'auto'
            });

            // Previous session button
            const prevButton = this.createNavButton('◀', () => this.navigateSession(-1));

            // Next session button
            const nextButton = this.createNavButton('▶', () => this.navigateSession(1));

            // Clear sessions button
            const clearButton = this.createClearButton();

            navContainer.appendChild(prevButton);
            navContainer.appendChild(nextButton);
            navContainer.appendChild(clearButton);

            header.appendChild(titleContainer);
            header.appendChild(navContainer);

            return header;
        }

        /**
         * Create navigation button
         */
        createNavButton(text, onClick) {
            const button = document.createElement('button');
            button.textContent = text;
            Object.assign(button.style, {
                background: 'none',
                border: 'none',
                color: STYLE.colors.textPrimary,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 8px',
                borderRadius: '3px',
                transition: STYLE.transitions.fast
            });

            button.addEventListener('mouseover', () => {
                button.style.color = STYLE.colors.accent;
                button.style.background = 'rgba(255, 0, 212, 0.1)';
            });
            button.addEventListener('mouseout', () => {
                button.style.color = STYLE.colors.textPrimary;
                button.style.background = 'none';
            });
            button.addEventListener('click', onClick);

            return button;
        }

        /**
         * Create clear sessions button
         */
        createClearButton() {
            const button = document.createElement('button');
            button.innerHTML = '🗑️';
            button.title = 'Clear all sessions';
            Object.assign(button.style, {
                background: 'none',
                border: 'none',
                color: STYLE.colors.textPrimary,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 8px',
                borderRadius: '3px',
                transition: STYLE.transitions.fast,
                marginLeft: '5px'
            });

            button.addEventListener('mouseover', () => {
                button.style.color = STYLE.colors.danger;
                button.style.background = 'rgba(255, 0, 0, 0.1)';
            });
            button.addEventListener('mouseout', () => {
                button.style.color = STYLE.colors.textPrimary;
                button.style.background = 'none';
            });
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Clear all enhancement sessions?')) {
                    this.clearAllSessions();
                }
            });

            return button;
        }

        /**
         * Make element draggable
         */
        makeDraggable(header) {
            let offsetX = 0;
            let offsetY = 0;

            header.addEventListener('mousedown', (e) => {
                this.isDragging = true;
                offsetX = e.clientX - this.floatingUI.offsetLeft;
                offsetY = e.clientY - this.floatingUI.offsetTop;

                const onMouseMove = (e) => {
                    if (this.isDragging) {
                        this.floatingUI.style.left = `${e.clientX - offsetX}px`;
                        this.floatingUI.style.top = `${e.clientY - offsetY}px`;
                    }
                };

                const onMouseUp = () => {
                    this.isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        /**
         * Navigate between sessions
         */
        navigateSession(direction) {
            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) return;

            this.currentViewingIndex += direction;

            // Wrap around
            if (this.currentViewingIndex < 0) {
                this.currentViewingIndex = sessions.length - 1;
            } else if (this.currentViewingIndex >= sessions.length) {
                this.currentViewingIndex = 0;
            }

            this.updateUI();
        }

        /**
         * Clear all sessions
         */
        async clearAllSessions() {
            // Clear from tracker
            const sessions = enhancementTracker.getAllSessions();
            for (const sessionId of Object.keys(sessions)) {
                delete sessions[sessionId];
            }

            await enhancementTracker.saveSessions();

            this.currentViewingIndex = 0;
            this.updateUI();

        }

        /**
         * Update UI content (debounced)
         */
        scheduleUpdate() {
            if (this.updateDebounce) {
                clearTimeout(this.updateDebounce);
            }
            this.updateDebounce = setTimeout(() => this.updateUI(), 100);
        }

        /**
         * Update UI content (immediate)
         */
        updateUI() {
            if (!this.floatingUI || !document.body.contains(this.floatingUI)) {
                return;
            }

            const content = document.getElementById('enhancementPanelContent');
            if (!content) return;

            // Update session counter
            this.updateSessionCounter();

            const sessions = Object.values(enhancementTracker.getAllSessions());

            // No sessions
            if (sessions.length === 0) {
                content.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: ${STYLE.colors.textSecondary};">
                    <div style="font-size: 32px; margin-bottom: 10px;">✧</div>
                    <div style="font-size: 14px;">Begin enhancing to populate data</div>
                </div>
            `;
                return;
            }

            const session = this.getCurrentSession();
            if (!session) {
                content.innerHTML = '<div style="text-align: center; color: ${STYLE.colors.danger};">Invalid session</div>';
                return;
            }

            // Remember expanded state before updating
            const detailsId = `cost-details-${session.id}`;
            const detailsElement = document.getElementById(detailsId);
            const wasExpanded = detailsElement && detailsElement.style.display !== 'none';

            // Build UI content
            content.innerHTML = this.generateSessionHTML(session);

            // Restore expanded state after updating
            if (wasExpanded) {
                const newDetailsElement = document.getElementById(detailsId);
                if (newDetailsElement) {
                    newDetailsElement.style.display = 'block';
                }
            }
        }

        /**
         * Update session counter in header
         */
        updateSessionCounter() {
            const counter = document.getElementById('enhancementSessionCounter');
            if (!counter) return;

            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) {
                counter.textContent = '';
            } else {
                counter.textContent = `(${this.currentViewingIndex + 1}/${sessions.length})`;
            }
        }

        /**
         * Generate HTML for session display
         */
        generateSessionHTML(session) {
            const gameData = dataManager.getInitClientData();
            const itemDetails = gameData?.itemDetailMap?.[session.itemHrid];
            const itemName = itemDetails?.name || 'Unknown Item';

            // Calculate stats
            const totalAttempts = session.totalAttempts;
            const totalSuccess = session.totalSuccesses;
            session.totalFailures;
            totalAttempts > 0 ? ((totalSuccess / totalAttempts) * 100).toFixed(1) : '0.0';

            const duration = getSessionDuration(session);
            const durationText = this.formatDuration(duration);

            // Calculate XP/hour if we have enough data (at least 5 seconds + some XP)
            const xpPerHour = (duration >= 5 && session.totalXP > 0) ? Math.floor((session.totalXP / duration) * 3600) : 0;

            // Status display
            const statusColor = session.state === SessionState.COMPLETED ? STYLE.colors.success : STYLE.colors.accent;
            const statusText = session.state === SessionState.COMPLETED ? 'Completed' : 'In Progress';

            // Build HTML
            let html = `
            <div style="margin-bottom: 10px; font-size: 13px;">
                <div style="display: flex; justify-content: space-between;">
                    <span>Item:</span>
                    <strong>${itemName}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Target:</span>
                    <span>+${session.targetLevel}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Prot:</span>
                    <span>+${session.protectFrom}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px; color: ${statusColor};">
                    <span>Status:</span>
                    <strong>${statusText}</strong>
                </div>
            </div>
        `;

            // Per-level table
            html += this.generateLevelTable(session);

            // Summary stats
            html += `
            <div style="margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <div>
                        <span>Total Attempts:</span>
                        <strong> ${totalAttempts}</strong>
                    </div>
                    <div>
                        <span>Prots Used:</span>
                        <strong> ${session.protectionCount || 0}</strong>
                    </div>
                </div>
            </div>`;

            // Predictions (if available)
            if (session.predictions) {
                const predictions = session.predictions;
                const expAtt = predictions.expectedAttempts || 0;
                const expProt = predictions.expectedProtections || 0;
                const actualProt = session.protectionCount || 0;

                // Calculate factors (like Ultimate Tracker)
                const attFactor = expAtt > 0 ? (totalAttempts / expAtt).toFixed(2) : null;
                const protFactor = expProt > 0 ? (actualProt / expProt).toFixed(2) : null;

                html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px;">
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Attempts:</span>
                    <span> ${expAtt}</span>
                </div>
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Prots:</span>
                    <span> ${expProt}</span>
                </div>
            </div>`;

                if (attFactor || protFactor) {
                    html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 2px; color: ${STYLE.colors.textSecondary};">
                <div>
                    <span>Attempt Factor:</span>
                    <strong> ${attFactor ? attFactor + 'x' : '—'}</strong>
                </div>
                <div>
                    <span>Prot Factor:</span>
                    <strong> ${protFactor ? protFactor + 'x' : '—'}</strong>
                </div>
            </div>`;
                }
            }

            html += `
            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Total XP Gained:</span>
                <strong>${this.formatNumber(session.totalXP)}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Session Duration:</span>
                <strong>${durationText}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>XP/Hour:</span>
                <strong>${xpPerHour > 0 ? this.formatNumber(xpPerHour) : 'Calculating...'}</strong>
            </div>
        `;

            // Material costs
            html += this.generateMaterialCostsHTML(session);

            return html;
        }

        /**
         * Generate per-level breakdown table
         */
        generateLevelTable(session) {
            const levels = Object.keys(session.attemptsPerLevel).sort((a, b) => b - a);

            if (levels.length === 0) {
                return '<div style="text-align: center; padding: 20px; color: ${STYLE.colors.textSecondary};">No attempts recorded yet</div>';
            }

            let rows = '';
            for (const level of levels) {
                const levelData = session.attemptsPerLevel[level];
                const rate = (levelData.successRate * 100).toFixed(1);
                const isCurrent = (parseInt(level) === session.currentLevel);

                const rowStyle = isCurrent ? `
                background: linear-gradient(90deg, rgba(126, 87, 194, 0.25), rgba(0, 242, 255, 0.1));
                box-shadow: 0 0 12px rgba(126, 87, 194, 0.5), inset 0 0 6px rgba(0, 242, 255, 0.3);
                border-left: 3px solid ${STYLE.colors.accent};
                font-weight: bold;
            ` : '';

                rows += `
                <tr style="${rowStyle}">
                    <td style="${compactCellStyle} text-align: center;">${level}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.success}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.fail}</td>
                    <td style="${compactCellStyle} text-align: right;">${rate}%</td>
                </tr>
            `;
            }

            return `
            <table style="${compactTableStyle}">
                <thead>
                    <tr>
                        <th style="${compactHeaderStyle}">Lvl</th>
                        <th style="${compactHeaderStyle}">Success</th>
                        <th style="${compactHeaderStyle}">Fail</th>
                        <th style="${compactHeaderStyle}">%</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
        }

        /**
         * Generate material costs HTML (expandable)
         */
        generateMaterialCostsHTML(session) {
            // Check if there are any costs to display
            const hasMaterials = session.materialCosts && Object.keys(session.materialCosts).length > 0;
            const hasCoins = session.coinCost > 0;
            const hasProtection = session.protectionCost > 0;

            if (!hasMaterials && !hasCoins && !hasProtection) {
                return '';
            }

            const gameData = dataManager.getInitClientData();
            const detailsId = `cost-details-${session.id}`;

            let html = '<div style="margin-top: 12px; font-size: 13px;">';

            // Collapsible header
            html += `
            <div style="display: flex; justify-content: space-between; cursor: pointer; font-weight: bold; padding: 5px 0;"
                 onclick="document.getElementById('${detailsId}').style.display = document.getElementById('${detailsId}').style.display === 'none' ? 'block' : 'none'">
                <span>💰 Total Cost (click for details)</span>
                <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.totalCost)}</span>
            </div>
        `;

            // Expandable details section (hidden by default)
            html += `<div id="${detailsId}" style="display: none; margin-left: 10px; margin-top: 5px;">`;

            // Material costs
            if (hasMaterials) {
                html += '<div style="margin-bottom: 8px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">';
                html += '<div style="font-weight: bold; margin-bottom: 3px; color: ${STYLE.colors.textSecondary};">Materials:</div>';

                for (const [itemHrid, data] of Object.entries(session.materialCosts)) {
                    const itemDetails = gameData?.itemDetailMap?.[itemHrid];
                    const itemName = itemDetails?.name || itemHrid;
                    const unitCost = Math.floor(data.totalCost / data.count);

                    html += `
                    <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 12px;">
                        <span>${itemName}</span>
                        <span>${data.count} × ${this.formatNumber(unitCost)} = <span style="color: ${STYLE.colors.gold};">${this.formatNumber(data.totalCost)}</span></span>
                    </div>
                `;
                }
                html += '</div>';
            }

            // Coin costs
            if (hasCoins) {
                html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">Coins (${session.coinCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.coinCost)}</span>
                </div>
            `;
            }

            // Protection costs
            if (hasProtection) {
                const protectionItemName = session.protectionItemHrid
                    ? (gameData?.itemDetailMap?.[session.protectionItemHrid]?.name || 'Protection')
                    : 'Protection';

                html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">${protectionItemName} (${session.protectionCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.protectionCost)}</span>
                </div>
            `;
            }

            html += '</div>'; // Close details
            html += '</div>'; // Close container

            return html;
        }

        /**
         * Format number with commas
         */
        formatNumber(num) {
            return Math.floor(num).toLocaleString();
        }

        /**
         * Format duration (seconds to h:m:s)
         */
        formatDuration(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;

            if (h > 0) {
                return `${h}h ${m}m ${s}s`;
            } else if (m > 0) {
                return `${m}m ${s}s`;
            } else {
                return `${s}s`;
            }
        }

        /**
         * Show the UI
         */
        show() {
            if (this.floatingUI) {
                this.floatingUI.style.display = 'flex';
            }
        }

        /**
         * Hide the UI
         */
        hide() {
            if (this.floatingUI) {
                this.floatingUI.style.display = 'none';
            }
        }

        /**
         * Toggle UI visibility
         */
        toggle() {
            if (this.floatingUI) {
                const isVisible = this.floatingUI.style.display !== 'none';
                if (isVisible) {
                    this.hide();
                } else {
                    this.show();
                }
            }
        }
    }

    // Create and export singleton instance
    const enhancementUI = new EnhancementUI();

    /**
     * Enhancement Event Handlers
     * Automatically detects and tracks enhancement events from WebSocket messages
     */


    /**
     * Setup enhancement event handlers
     */
    function setupEnhancementHandlers() {
        // Listen for action_completed (when enhancement completes)
        webSocketHook.on('action_completed', handleActionCompleted);

        // Listen for wildcard to catch all messages for debugging
        webSocketHook.on('*', handleDebugMessage);

    }

    /**
     * Debug handler to log all messages temporarily
     * @param {Object} data - WebSocket message data
     */
    function handleDebugMessage(data) {
        // Debug logging removed
    }

    /**
     * Handle action_completed message (detects enhancement results)
     * @param {Object} data - WebSocket message data
     */
    async function handleActionCompleted(data) {
        if (!config.getSetting('enhancementTracker')) return;
        if (!enhancementTracker.isInitialized) return;

        const action = data.endCharacterAction;
        if (!action) return;

        // Check if this is an enhancement action
        // Ultimate Enhancement Tracker checks: actionHrid === "/actions/enhancing/enhance"
        if (action.actionHrid !== '/actions/enhancing/enhance') {
            return;
        }

        // Handle the enhancement
        await handleEnhancementResult(action);
    }

    /**
     * Extract protection item HRID from action data
     * @param {Object} action - Enhancement action data
     * @returns {string|null} Protection item HRID or null
     */
    function getProtectionItemHrid(action) {
        // Check if protection is enabled
        if (!action.enhancingProtectionMinLevel || action.enhancingProtectionMinLevel < 2) {
            return null;
        }

        // Extract protection item from secondaryItemHash (Ultimate Tracker method)
        if (action.secondaryItemHash) {
            const parts = action.secondaryItemHash.split('::');
            if (parts.length >= 3 && parts[2].startsWith('/items/')) {
                return parts[2];
            }
        }

        // Fallback: check if there's a direct enhancingProtectionItemHrid field
        if (action.enhancingProtectionItemHrid) {
            return action.enhancingProtectionItemHrid;
        }

        return null;
    }

    /**
     * Parse item hash to extract HRID and level
     * Based on Ultimate Enhancement Tracker's parseItemHash function
     * @param {string} primaryItemHash - Item hash from action
     * @returns {Object} {itemHrid, level}
     */
    function parseItemHash(primaryItemHash) {
        try {
            // Handle different possible formats:
            // 1. "/item_locations/inventory::/items/enhancers_bottoms::0" (level 0)
            // 2. "161296::/item_locations/inventory::/items/enhancers_bottoms::5" (level 5)
            // 3. Direct HRID like "/items/enhancers_bottoms" (no level)

            let itemHrid = null;
            let level = 0; // Default to 0 if not specified

            // Split by :: to parse components
            const parts = primaryItemHash.split('::');

            // Find the part that starts with /items/
            const itemPart = parts.find(part => part.startsWith('/items/'));
            if (itemPart) {
                itemHrid = itemPart;
            }
            // If no /items/ found but it's a direct HRID
            else if (primaryItemHash.startsWith('/items/')) {
                itemHrid = primaryItemHash;
            }

            // Try to extract enhancement level (last part after ::)
            const lastPart = parts[parts.length - 1];
            if (lastPart && !lastPart.startsWith('/')) {
                const parsedLevel = parseInt(lastPart, 10);
                if (!isNaN(parsedLevel)) {
                    level = parsedLevel;
                }
            }

            return { itemHrid, level };
        } catch (error) {
            return { itemHrid: null, level: 0 };
        }
    }

    /**
     * Get enhancement materials and costs for an item
     * Based on Ultimate Enhancement Tracker's getEnhancementMaterials function
     * @param {string} itemHrid - Item HRID
     * @returns {Array|null} Array of [hrid, count] pairs or null
     */
    function getEnhancementMaterials(itemHrid) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemData = gameData?.itemDetailMap?.[itemHrid];

            if (!itemData) {
                return null;
            }

            // Get the costs array
            const costs = itemData.enhancementCosts;

            if (!costs) {
                return null;
            }

            let materials = [];

            // Case 1: Array of objects (current format)
            if (Array.isArray(costs) && costs.length > 0 && typeof costs[0] === 'object') {
                materials = costs.map(cost => [cost.itemHrid, cost.count]);
            }
            // Case 2: Already in correct format [["/items/foo", 30], ["/items/bar", 20]]
            else if (Array.isArray(costs) && costs.length > 0 && Array.isArray(costs[0])) {
                materials = costs;
            }
            // Case 3: Object format {"/items/foo": 30, "/items/bar": 20}
            else if (typeof costs === 'object' && !Array.isArray(costs)) {
                materials = Object.entries(costs);
            }

            // Filter out any invalid entries
            materials = materials.filter(m =>
                Array.isArray(m) &&
                m.length === 2 &&
                typeof m[0] === 'string' &&
                typeof m[1] === 'number'
            );

            return materials.length > 0 ? materials : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Track material costs for current attempt
     * Based on Ultimate Enhancement Tracker's trackMaterialCosts function
     * @param {string} itemHrid - Item HRID
     * @returns {Promise<{materialCost: number, coinCost: number}>}
     */
    async function trackMaterialCosts(itemHrid) {
        const materials = getEnhancementMaterials(itemHrid) || [];
        let materialCost = 0;
        let coinCost = 0;

        for (const [resourceHrid, count] of materials) {
            // Check if this is coins
            if (resourceHrid.includes('/items/coin')) {
                // Track coins for THIS ATTEMPT ONLY
                coinCost = count; // Coins are 1:1 value
                await enhancementTracker.trackCoinCost(count);
            } else {
                // Track material costs
                await enhancementTracker.trackMaterialCost(resourceHrid, count);
                // Add to material cost total
                const priceData = marketAPI.getPrice(resourceHrid, 0);
                const unitCost = priceData ? (priceData.ask || priceData.bid || 0) : 0;
                materialCost += unitCost * count;
            }
        }

        return { materialCost, coinCost };
    }

    /**
     * Handle enhancement result (success or failure)
     * @param {Object} action - Enhancement action data
     * @param {Object} data - Full WebSocket message data
     */
    async function handleEnhancementResult(action, data) {
        try {
            const { itemHrid, level: newLevel } = parseItemHash(action.primaryItemHash);
            const rawCount = action.currentCount || 0;

            if (!itemHrid) {
                return;
            }

            // On first attempt (rawCount === 1), start session if auto-start is enabled
            // BUT: Ignore if we already have an active session (handles out-of-order events)
            let currentSession = enhancementTracker.getCurrentSession();
            if (rawCount === 1) {
                if (currentSession && currentSession.itemHrid === itemHrid) {
                    // Already have a session for this item, ignore this late rawCount=1 event
                    return;
                }

                if (!currentSession) {
                    // CRITICAL: On first event, primaryItemHash shows RESULT level, not starting level
                    // We need to infer the starting level from the result
                    const protectFrom = action.enhancingProtectionMinLevel || 0;
                    let startLevel = newLevel;

                    // If result > 0 and below protection threshold, must have started one level lower
                    if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                        startLevel = newLevel - 1; // Successful enhancement (e.g., 0→1)
                    }
                    // Otherwise, started at same level (e.g., 0→0 failure, or protected failure)

                    // Always start new session when tracker is enabled
                    const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);
                    await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
                    currentSession = enhancementTracker.getCurrentSession();

                    if (!currentSession) {
                        return;
                    }
                }
            }

            // If no active session, check if we can extend a completed session
            if (!currentSession) {
                // Try to extend a completed session for the same item
                const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, newLevel);
                if (extendableSessionId) {
                    const newTarget = Math.min(newLevel + 5, 20);
                    await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
                    currentSession = enhancementTracker.getCurrentSession();
                } else {
                    return;
                }
            }

            // Calculate adjusted attempt count (resume-proof)
            const adjustedCount = calculateAdjustedAttemptCount(currentSession);

            // Track costs for EVERY attempt (including first)
            const { materialCost, coinCost } = await trackMaterialCosts(itemHrid);

            // Get previous level from lastAttempt
            const previousLevel = currentSession.lastAttempt?.level ?? currentSession.startLevel;

            // Check protection item usage BEFORE recording attempt
            // Track protection cost if protection item exists in action data
            // Protection items are consumed when:
            // 1. Level would have decreased (Mirror of Protection prevents decrease, level stays same)
            // 2. Level increased (Philosopher's Mirror guarantees success)
            const protectionItemHrid = getProtectionItemHrid(action);
            if (protectionItemHrid) {
                // Only track if we're at a level where protection might be used
                // (either level stayed same when it could have decreased, or succeeded at high level)
                const protectFrom = currentSession.protectFrom || 0;
                const shouldTrack = previousLevel >= Math.max(2, protectFrom);

                if (shouldTrack && (newLevel <= previousLevel || newLevel === previousLevel + 1)) {
                    // Use market price (like Ultimate Tracker) instead of vendor price
                    const marketPrice = marketAPI.getPrice(protectionItemHrid, 0);
                    let protectionCost = marketPrice?.ask || marketPrice?.bid || 0;

                    // Fall back to vendor price if market price unavailable
                    if (protectionCost === 0) {
                        const gameData = dataManager.getInitClientData();
                        const protectionItem = gameData?.itemDetailMap?.[protectionItemHrid];
                        protectionCost = protectionItem?.vendorSellPrice || 0;
                    }

                    await enhancementTracker.trackProtectionCost(protectionItemHrid, protectionCost);
                }
            }

            // Determine result type
            const wasSuccess = newLevel > previousLevel;

            // Failure detection:
            // 1. Level decreased (1→0, 5→4, etc.)
            // 2. Stayed at 0 (0→0 fail)
            // 3. Stayed at non-zero level WITH protection item (protected failure)
            const levelDecreased = newLevel < previousLevel;
            const failedAtZero = previousLevel === 0 && newLevel === 0;
            const protectedFailure = previousLevel > 0 && newLevel === previousLevel && protectionItemHrid !== null;
            const wasFailure = levelDecreased || failedAtZero || protectedFailure;

            const wasBlessed = wasSuccess && (newLevel - previousLevel) >= 2; // Blessed tea detection

            // Update lastAttempt BEFORE recording (so next attempt compares correctly)
            currentSession.lastAttempt = {
                attemptNumber: adjustedCount,
                level: newLevel,
                timestamp: Date.now()
            };

            // Record the result and track XP
            if (wasSuccess) {
                const xpGain = calculateSuccessXP(previousLevel, itemHrid);
                currentSession.totalXP += xpGain;

                await enhancementTracker.recordSuccess(previousLevel, newLevel);
                enhancementUI.scheduleUpdate(); // Update UI after success

                // Check if we've reached target
                if (newLevel >= currentSession.targetLevel) {
                }
            } else if (wasFailure) {
                const xpGain = calculateFailureXP(previousLevel, itemHrid);
                currentSession.totalXP += xpGain;

                await enhancementTracker.recordFailure(previousLevel);
                enhancementUI.scheduleUpdate(); // Update UI after failure
            }
            // Note: If newLevel === previousLevel (and not 0->0), we track costs but don't record attempt
            // This happens with protection items that prevent level decrease

        } catch (error) {
        }
    }

    /**
     * Empty Queue Notification
     * Sends browser notification when action queue becomes empty
     */


    class EmptyQueueNotification {
        constructor() {
            this.wasEmpty = false;
            this.unregisterHandlers = [];
            this.permissionGranted = false;
        }

        /**
         * Initialize empty queue notification
         */
        async initialize() {
            if (!config.getSetting('notifiEmptyAction')) {
                return;
            }

            // Request notification permission
            await this.requestPermission();

            // Listen for action updates
            this.registerWebSocketListeners();
        }

        /**
         * Request browser notification permission
         */
        async requestPermission() {
            if (!('Notification' in window)) {
                console.warn('[Empty Queue Notification] Browser notifications not supported');
                return;
            }

            if (Notification.permission === 'granted') {
                this.permissionGranted = true;
                return;
            }

            if (Notification.permission !== 'denied') {
                try {
                    const permission = await Notification.requestPermission();
                    this.permissionGranted = (permission === 'granted');
                } catch (error) {
                    console.warn('[Empty Queue Notification] Permission request failed:', error);
                }
            }
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const actionsHandler = (data) => {
                this.checkActionQueue(data);
            };

            webSocketHook.on('actions_updated', actionsHandler);

            this.unregisterHandlers.push(() => {
                webSocketHook.off('actions_updated', actionsHandler);
            });
        }

        /**
         * Check if action queue is empty and send notification
         * @param {Object} data - WebSocket data
         */
        checkActionQueue(data) {
            if (!config.getSetting('notifiEmptyAction')) {
                return;
            }

            if (!this.permissionGranted) {
                return;
            }

            // Check if queue is empty
            // endCharacterActions contains actions, filter for those not done (isDone === false)
            const actions = data.endCharacterActions || [];
            const activeActions = actions.filter(action => action.isDone === false);
            const isEmpty = activeActions.length === 0;

            // Only notify on transition from not-empty to empty
            if (isEmpty && !this.wasEmpty) {
                this.sendNotification();
            }

            this.wasEmpty = isEmpty;
        }

        /**
         * Send browser notification
         */
        sendNotification() {
            try {
                if (typeof Notification === 'undefined') {
                    console.error('[Empty Queue Notification] Notification API not available');
                    return;
                }

                if (Notification.permission !== 'granted') {
                    console.error('[Empty Queue Notification] Notification permission not granted');
                    return;
                }

                // Use standard Notification API
                const notification = new Notification('Milky Way Idle', {
                    body: 'Your action queue is empty!',
                    icon: 'https://www.milkywayidle.com/favicon.ico',
                    tag: 'empty-queue',
                    requireInteraction: false
                });

                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };

                notification.onerror = (error) => {
                    console.error('[Empty Queue Notification] Notification error:', error);
                };

                // Auto-close after 5 seconds
                setTimeout(() => notification.close(), 5000);
            } catch (error) {
                console.error('[Empty Queue Notification] Failed to send notification:', error);
            }
        }

        /**
         * Cleanup
         */
        disable() {
            this.unregisterHandlers.forEach(unregister => unregister());
            this.unregisterHandlers = [];
            this.wasEmpty = false;
        }
    }

    // Create and export singleton instance
    const emptyQueueNotification = new EmptyQueueNotification();

    /**
     * Feature Registry
     * Centralized feature initialization system
     */


    /**
     * Feature Registry
     * Maps feature keys to their initialization functions and metadata
     */
    const featureRegistry = [
        // Market Features
        {
            key: 'tooltipPrices',
            name: 'Tooltip Prices',
            category: 'Market',
            initialize: () => tooltipPrices.initialize(),
            async: true
        },
        {
            key: 'expectedValueCalculator',
            name: 'Expected Value Calculator',
            category: 'Market',
            initialize: () => expectedValueCalculator.initialize(),
            async: true
        },
        {
            key: 'tooltipConsumables',
            name: 'Tooltip Consumables',
            category: 'Market',
            initialize: () => tooltipConsumables.initialize(),
            async: true
        },
        {
            key: 'marketFilter',
            name: 'Market Filter',
            category: 'Market',
            initialize: () => marketFilter.initialize(),
            async: false
        },
        {
            key: 'fillMarketOrderPrice',
            name: 'Auto-Fill Market Price',
            category: 'Market',
            initialize: () => autoFillPrice.initialize(),
            async: false
        },

        // Action Features
        {
            key: 'actionPanelProfit',
            name: 'Action Panel Profit',
            category: 'Actions',
            initialize: () => initActionPanelObserver(),
            async: false,
            healthCheck: null // This feature has no DOM presence to check
        },
        {
            key: 'actionTimeDisplay',
            name: 'Action Time Display',
            category: 'Actions',
            initialize: () => actionTimeDisplay.initialize(),
            async: false,
            healthCheck: () => {
                // Check if time display is working by looking for injected time elements
                const queueMenu = document.querySelector('div[class*="QueuedActions_queuedActionsEditMenu"]');
                if (!queueMenu) return null; // Queue not open, can't verify

                // Look for our injected time displays
                const timeDisplays = queueMenu.querySelectorAll('[data-mwi-action-time]');
                return timeDisplays.length > 0;
            }
        },
        {
            key: 'quickInputButtons',
            name: 'Quick Input Buttons',
            category: 'Actions',
            initialize: () => quickInputButtons.initialize(),
            async: false,
            healthCheck: () => {
                // Check if quick input buttons exist on any action panel
                const actionPanel = document.querySelector('[class*="SkillActionDetail_skillActionDetail"]');
                if (!actionPanel) return null; // No action panel open, can't verify

                // Look for our injected button container
                const buttons = actionPanel.querySelector('.mwi-quick-input-buttons');
                return !!buttons;
            }
        },
        {
            key: 'actionPanel_speedBreakdown',
            name: 'Action Speed Breakdown',
            category: 'Actions',
            initialize: () => actionSpeedBreakdown.initialize(),
            async: false,
            healthCheck: () => {
                // Check if speed breakdown exists on any action panel
                const actionPanel = document.querySelector('[class*="SkillActionDetail_skillActionDetail"]');
                if (!actionPanel) return null; // No action panel open, can't verify

                // Look for our injected speed breakdown
                const breakdown = actionPanel.querySelector('.mwi-speed-breakdown');
                return !!breakdown;
            }
        },

        // Combat Features
        {
            key: 'abilityBookCalculator',
            name: 'Ability Book Calculator',
            category: 'Combat',
            initialize: () => abilityBookCalculator.initialize(),
            async: false
        },
        {
            key: 'zoneIndices',
            name: 'Zone Indices',
            category: 'Combat',
            initialize: () => zoneIndices.initialize(),
            async: false
        },
        {
            key: 'combatScore',
            name: 'Combat Score',
            category: 'Combat',
            initialize: () => combatScore.initialize(),
            async: false
        },

        // UI Features
        {
            key: 'equipmentLevelDisplay',
            name: 'Equipment Level Display',
            category: 'UI',
            initialize: () => equipmentLevelDisplay.initialize(),
            async: false
        },
        {
            key: 'alchemyItemDimming',
            name: 'Alchemy Item Dimming',
            category: 'UI',
            initialize: () => alchemyItemDimming.initialize(),
            async: false
        },
        {
            key: 'skillExperiencePercentage',
            name: 'Skill Experience Percentage',
            category: 'UI',
            initialize: () => skillExperiencePercentage.initialize(),
            async: false
        },

        // Task Features
        {
            key: 'taskProfitDisplay',
            name: 'Task Profit Display',
            category: 'Tasks',
            initialize: () => taskProfitDisplay.initialize(),
            async: false
        },
        {
            key: 'taskRerollTracker',
            name: 'Task Reroll Tracker',
            category: 'Tasks',
            initialize: () => taskRerollTracker.initialize(),
            async: true
        },

        // House Features
        {
            key: 'houseCostDisplay',
            name: 'House Cost Display',
            category: 'House',
            initialize: () => housePanelObserver.initialize(),
            async: true
        },

        // Economy Features
        {
            key: 'networth',
            name: 'Net Worth',
            category: 'Economy',
            initialize: () => networthFeature.initialize(),
            async: true,
            // Also initialize if inventorySummary is enabled
            customCheck: () => config.isFeatureEnabled('networth') || config.isFeatureEnabled('inventorySummary')
        },
        {
            key: 'inventorySort',
            name: 'Inventory Sort',
            category: 'Economy',
            initialize: () => inventorySort.initialize(),
            async: false
        },

        // Enhancement Features
        {
            key: 'enhancementTracker',
            name: 'Enhancement Tracker',
            category: 'Enhancement',
            initialize: async () => {
                await enhancementTracker.initialize();
                setupEnhancementHandlers();
                enhancementUI.initialize();
            },
            async: true
        },

        // Notification Features
        {
            key: 'notifiEmptyAction',
            name: 'Empty Queue Notification',
            category: 'Notifications',
            initialize: () => emptyQueueNotification.initialize(),
            async: true
        }
    ];

    /**
     * Initialize all enabled features
     * @returns {Promise<void>}
     */
    async function initializeFeatures() {
        const errors = [];

        for (const feature of featureRegistry) {
            try {
                // Check if feature is enabled
                const isEnabled = feature.customCheck
                    ? feature.customCheck()
                    : config.isFeatureEnabled(feature.key);

                if (!isEnabled) {
                    continue;
                }

                // Initialize feature
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }

            } catch (error) {
                errors.push({
                    feature: feature.name,
                    error: error.message
                });
                console.error(`[Toolasha] Failed to initialize ${feature.name}:`, error);
            }
        }

        // Log errors if any occurred
        if (errors.length > 0) {
            console.error(`[Toolasha] ${errors.length} feature(s) failed to initialize`, errors);
        }
    }

    /**
     * Get feature by key
     * @param {string} key - Feature key
     * @returns {Object|null} Feature definition or null
     */
    function getFeature(key) {
        return featureRegistry.find(f => f.key === key) || null;
    }

    /**
     * Get all features
     * @returns {Array} Feature registry
     */
    function getAllFeatures() {
        return [...featureRegistry];
    }

    /**
     * Get features by category
     * @param {string} category - Category name
     * @returns {Array} Features in category
     */
    function getFeaturesByCategory(category) {
        return featureRegistry.filter(f => f.category === category);
    }

    /**
     * Check health of all initialized features
     * @returns {Array<Object>} Array of failed features with details
     */
    function checkFeatureHealth() {
        const failed = [];

        for (const feature of featureRegistry) {
            // Skip if feature has no health check
            if (!feature.healthCheck) continue;

            // Skip if feature is not enabled
            const isEnabled = feature.customCheck
                ? feature.customCheck()
                : config.isFeatureEnabled(feature.key);

            if (!isEnabled) continue;

            try {
                const result = feature.healthCheck();

                // null = can't verify (DOM not ready), false = failed, true = healthy
                if (result === false) {
                    failed.push({
                        key: feature.key,
                        name: feature.name,
                        reason: 'Health check returned false'
                    });
                }
            } catch (error) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: `Health check error: ${error.message}`
                });
            }
        }

        return failed;
    }

    /**
     * Retry initialization for specific features
     * @param {Array<Object>} failedFeatures - Array of failed feature objects
     * @returns {Promise<void>}
     */
    async function retryFailedFeatures(failedFeatures) {
        console.log('[Toolasha] Retrying failed features...');

        for (const failed of failedFeatures) {
            const feature = getFeature(failed.key);
            if (!feature) continue;

            try {
                console.log(`[Toolasha] Retrying ${feature.name}...`);

                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }

                console.log(`[Toolasha] ✓ ${feature.name} retry successful`);
            } catch (error) {
                console.error(`[Toolasha] ✗ ${feature.name} retry failed:`, error);
            }
        }
    }

    var featureRegistry$1 = {
        initializeFeatures,
        checkFeatureHealth,
        retryFailedFeatures,
        getFeature,
        getAllFeatures,
        getFeaturesByCategory
    };

    /**
     * Combat Simulator Export Module
     * Constructs player data in Shykai Combat Simulator format
     *
     * Exports character data for solo or party simulation testing
     */

    /**
     * Get saved character data from GM storage
     * @returns {Object|null} Parsed character data or null
     */
    function getCharacterData() {
        try {
            if (typeof GM_getValue === 'undefined') {
                console.error('[Combat Sim Export] GM_getValue not available');
                return null;
            }

            const data = GM_getValue('toolasha_init_character_data', null);
            if (!data) {
                console.error('[Combat Sim Export] No character data found. Please refresh game page.');
                return null;
            }

            return JSON.parse(data);
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get character data:', error);
            return null;
        }
    }

    /**
     * Get saved battle data from GM storage
     * @returns {Object|null} Parsed battle data or null
     */
    function getBattleData() {
        try {
            if (typeof GM_getValue === 'undefined') {
                return null;
            }

            const data = GM_getValue('toolasha_new_battle', null);
            if (!data) {
                return null; // No battle data (not in combat or solo)
            }

            return JSON.parse(data);
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get battle data:', error);
            return null;
        }
    }

    /**
     * Get init_client_data from GM storage
     * @returns {Object|null} Parsed client data or null
     */
    function getClientData() {
        try {
            if (typeof GM_getValue === 'undefined') {
                return null;
            }

            const data = GM_getValue('toolasha_init_client_data', null);
            if (!data) {
                console.warn('[Combat Sim Export] No client data found');
                return null;
            }

            return JSON.parse(data);
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get client data:', error);
            return null;
        }
    }

    /**
     * Get profile export list from GM storage
     * @returns {Array} List of saved profiles
     */
    function getProfileList() {
        try {
            if (typeof GM_getValue === 'undefined') {
                return [];
            }

            const data = GM_getValue('toolasha_profile_export_list', '[]');
            return JSON.parse(data);
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get profile list:', error);
            return [];
        }
    }

    /**
     * Construct player export object from own character data
     * @param {Object} characterObj - Character data from init_character_data
     * @param {Object} clientObj - Client data (optional)
     * @returns {Object} Player export object
     */
    function constructSelfPlayer(characterObj, clientObj) {
        const playerObj = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: []
            },
            food: { '/action_types/combat': [] },
            drinks: { '/action_types/combat': [] },
            abilities: [],
            triggerMap: {},
            houseRooms: {}
        };

        // Extract combat skill levels
        for (const skill of characterObj.characterSkills || []) {
            const skillName = skill.skillHrid.split('/').pop();
            if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
                playerObj.player[skillName + 'Level'] = skill.level;
            }
        }

        // Extract equipped items - handle both formats
        if (Array.isArray(characterObj.characterItems)) {
            // Array format (full inventory list)
            for (const item of characterObj.characterItems) {
                if (item.itemLocationHrid && !item.itemLocationHrid.includes('/item_locations/inventory')) {
                    playerObj.player.equipment.push({
                        itemLocationHrid: item.itemLocationHrid,
                        itemHrid: item.itemHrid,
                        enhancementLevel: item.enhancementLevel || 0
                    });
                }
            }
        } else if (characterObj.characterEquipment) {
            // Object format (just equipped items)
            for (const key in characterObj.characterEquipment) {
                const item = characterObj.characterEquipment[key];
                playerObj.player.equipment.push({
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0
                });
            }
        }

        // Initialize food and drink slots
        for (let i = 0; i < 3; i++) {
            playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
            playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
        }

        // Extract food slots
        const foodSlots = characterObj.actionTypeFoodSlotsMap?.['/action_types/combat'];
        if (Array.isArray(foodSlots)) {
            foodSlots.forEach((item, i) => {
                if (i < 3 && item?.itemHrid) {
                    playerObj.food['/action_types/combat'][i] = { itemHrid: item.itemHrid };
                }
            });
        }

        // Extract drink slots
        const drinkSlots = characterObj.actionTypeDrinkSlotsMap?.['/action_types/combat'];
        if (Array.isArray(drinkSlots)) {
            drinkSlots.forEach((item, i) => {
                if (i < 3 && item?.itemHrid) {
                    playerObj.drinks['/action_types/combat'][i] = { itemHrid: item.itemHrid };
                }
            });
        }

        // Initialize abilities (5 slots)
        for (let i = 0; i < 5; i++) {
            playerObj.abilities[i] = { abilityHrid: '', level: '1' };
        }

        // Extract equipped abilities
        let normalAbilityIndex = 1;
        const equippedAbilities = characterObj.combatUnit?.combatAbilities || [];
        for (const ability of equippedAbilities) {
            if (!ability || !ability.abilityHrid) continue;

            // Check if special ability
            const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

            if (isSpecial) {
                // Special ability goes in slot 0
                playerObj.abilities[0] = {
                    abilityHrid: ability.abilityHrid,
                    level: String(ability.level || 1)
                };
            } else if (normalAbilityIndex < 5) {
                // Normal abilities go in slots 1-4
                playerObj.abilities[normalAbilityIndex++] = {
                    abilityHrid: ability.abilityHrid,
                    level: String(ability.level || 1)
                };
            }
        }

        // Extract trigger maps
        playerObj.triggerMap = {
            ...(characterObj.abilityCombatTriggersMap || {}),
            ...(characterObj.consumableCombatTriggersMap || {})
        };

        // Extract house room levels
        for (const house of Object.values(characterObj.characterHouseRoomMap || {})) {
            playerObj.houseRooms[house.houseRoomHrid] = house.level;
        }

        return playerObj;
    }

    /**
     * Construct party member data from profile share
     * @param {Object} profile - Profile data from profile_shared message
     * @param {Object} clientObj - Client data (optional)
     * @param {Object} battleObj - Battle data (optional, for consumables)
     * @returns {Object} Player export object
     */
    function constructPartyPlayer(profile, clientObj, battleObj) {
        const playerObj = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: []
            },
            food: { '/action_types/combat': [] },
            drinks: { '/action_types/combat': [] },
            abilities: [],
            triggerMap: {},
            houseRooms: {}
        };

        // Extract skill levels from profile
        for (const skill of profile.profile?.characterSkills || []) {
            const skillName = skill.skillHrid?.split('/').pop();
            if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
                playerObj.player[skillName + 'Level'] = skill.level || 1;
            }
        }

        // Extract equipment from profile
        if (profile.profile?.wearableItemMap) {
            for (const key in profile.profile.wearableItemMap) {
                const item = profile.profile.wearableItemMap[key];
                playerObj.player.equipment.push({
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0
                });
            }
        }

        // Initialize food and drink slots
        for (let i = 0; i < 3; i++) {
            playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
            playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
        }

        // Get consumables from battle data if available
        let battlePlayer = null;
        if (battleObj?.players) {
            battlePlayer = battleObj.players.find(p => p.character?.id === profile.characterID);
        }

        if (battlePlayer?.combatConsumables) {
            let foodIndex = 0;
            let drinkIndex = 0;

            // Intelligently separate food and drinks
            battlePlayer.combatConsumables.forEach(consumable => {
                const itemHrid = consumable.itemHrid;

                // Check if it's a drink
                const isDrink = itemHrid.includes('/drinks/') ||
                    itemHrid.includes('coffee') ||
                    clientObj?.itemDetailMap?.[itemHrid]?.type === 'drink';

                if (isDrink && drinkIndex < 3) {
                    playerObj.drinks['/action_types/combat'][drinkIndex++] = { itemHrid: itemHrid };
                } else if (!isDrink && foodIndex < 3) {
                    playerObj.food['/action_types/combat'][foodIndex++] = { itemHrid: itemHrid };
                }
            });
        }

        // Initialize abilities (5 slots)
        for (let i = 0; i < 5; i++) {
            playerObj.abilities[i] = { abilityHrid: '', level: '1' };
        }

        // Extract equipped abilities from profile
        let normalAbilityIndex = 1;
        const equippedAbilities = profile.profile?.equippedAbilities || [];
        for (const ability of equippedAbilities) {
            if (!ability || !ability.abilityHrid) continue;

            // Check if special ability
            const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

            if (isSpecial) {
                // Special ability goes in slot 0
                playerObj.abilities[0] = {
                    abilityHrid: ability.abilityHrid,
                    level: String(ability.level || 1)
                };
            } else if (normalAbilityIndex < 5) {
                // Normal abilities go in slots 1-4
                playerObj.abilities[normalAbilityIndex++] = {
                    abilityHrid: ability.abilityHrid,
                    level: String(ability.level || 1)
                };
            }
        }

        // Extract trigger maps (prefer battle data, fallback to profile)
        playerObj.triggerMap = {
            ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
            ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {})
        };

        // Extract house room levels from profile
        if (profile.profile?.characterHouseRoomMap) {
            for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
                playerObj.houseRooms[house.houseRoomHrid] = house.level;
            }
        }

        return playerObj;
    }

    /**
     * Construct full export object (solo or party)
     * @returns {Object} Export object with player data, IDs, positions, and zone info
     */
    function constructExportObject() {
        const characterObj = getCharacterData();
        if (!characterObj) {
            return null;
        }

        const clientObj = getClientData();
        const battleObj = getBattleData();
        const profileList = getProfileList();

        // Blank player template (as string, like MCS)
        const BLANK = '{"player":{"attackLevel":1,"magicLevel":1,"meleeLevel":1,"rangedLevel":1,"defenseLevel":1,"staminaLevel":1,"intelligenceLevel":1,"equipment":[]},"food":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"drinks":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"abilities":[{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"}],"triggerMap":{},"houseRooms":{"/house_rooms/dairy_barn":0,"/house_rooms/garden":0,"/house_rooms/log_shed":0,"/house_rooms/forge":0,"/house_rooms/workshop":0,"/house_rooms/sewing_parlor":0,"/house_rooms/kitchen":0,"/house_rooms/brewery":0,"/house_rooms/laboratory":0,"/house_rooms/observatory":0,"/house_rooms/dining_room":0,"/house_rooms/library":0,"/house_rooms/dojo":0,"/house_rooms/gym":0,"/house_rooms/armory":0,"/house_rooms/archery_range":0,"/house_rooms/mystical_study":0}}';

        const exportObj = {};
        for (let i = 1; i <= 5; i++) {
            exportObj[i] = BLANK;
        }

        const playerIDs = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
        const importedPlayerPositions = [false, false, false, false, false];
        let zone = '/actions/combat/fly';
        let isZoneDungeon = false;
        let difficultyTier = 0;
        let isParty = false;

        // Check if in party
        const hasParty = characterObj.partyInfo?.partySlotMap;

        if (!hasParty) {
            // === SOLO MODE ===
            console.log('[Combat Sim Export] Exporting solo character');

            exportObj[1] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
            playerIDs[0] = characterObj.character?.name || 'Player 1';
            importedPlayerPositions[0] = true;

            // Get current combat zone and tier
            for (const action of characterObj.characterActions || []) {
                if (action && action.actionHrid.includes('/actions/combat/')) {
                    zone = action.actionHrid;
                    difficultyTier = action.difficultyTier || 0;
                    isZoneDungeon = clientObj?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
                    break;
                }
            }
        } else {
            // === PARTY MODE ===
            console.log('[Combat Sim Export] Exporting party');
            isParty = true;

            let slotIndex = 1;
            for (const member of Object.values(characterObj.partyInfo.partySlotMap)) {
                if (member.characterID) {
                    if (member.characterID === characterObj.character.id) {
                        // This is you
                        exportObj[slotIndex] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
                        playerIDs[slotIndex - 1] = characterObj.character.name;
                        importedPlayerPositions[slotIndex - 1] = true;
                    } else {
                        // Party member - try to get from profile list
                        const profile = profileList.find(p => p.characterID === member.characterID);
                        if (profile) {
                            exportObj[slotIndex] = JSON.stringify(constructPartyPlayer(profile, clientObj, battleObj));
                            playerIDs[slotIndex - 1] = profile.characterName;
                            importedPlayerPositions[slotIndex - 1] = true;
                        } else {
                            playerIDs[slotIndex - 1] = 'Open profile in game';
                            console.warn(`[Combat Sim Export] No profile found for party member ${member.characterID}. Open their profile in-game to capture data.`);
                        }
                    }
                    slotIndex++;
                }
            }

            // Get party zone and tier
            zone = characterObj.partyInfo?.party?.actionHrid || '/actions/combat/fly';
            difficultyTier = characterObj.partyInfo?.party?.difficultyTier || 0;
            isZoneDungeon = clientObj?.actionDetailMap?.[zone]?.combatZoneInfo?.isDungeon || false;
        }

        return {
            exportObj,
            playerIDs,
            importedPlayerPositions,
            zone,
            isZoneDungeon,
            difficultyTier,
            isParty
        };
    }

    /**
     * Combat Simulator Integration Module
     * Injects import button on Shykai Combat Simulator page
     *
     * Automatically fills character/party data from game into simulator
     */


    /**
     * Initialize combat sim integration (runs on sim page only)
     */
    function initialize$1() {
        console.log('[Toolasha Combat Sim] Initializing integration');

        // Wait for simulator UI to load
        waitForSimulatorUI();
    }

    /**
     * Wait for simulator's import/export button to appear
     */
    function waitForSimulatorUI() {
        const checkInterval = setInterval(() => {
            const exportButton = document.querySelector('button#buttonImportExport');
            if (exportButton) {
                clearInterval(checkInterval);
                console.log('[Toolasha Combat Sim] Simulator UI detected');
                injectImportButton(exportButton);
            }
        }, 200);

        // Stop checking after 10 seconds
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    /**
     * Inject "Import from Toolasha" button
     * @param {Element} exportButton - Reference element to insert after
     */
    function injectImportButton(exportButton) {
        // Check if button already exists
        if (document.getElementById('toolasha-import-button')) {
            return;
        }

        // Create container div
        const container = document.createElement('div');
        container.style.marginTop = '10px';

        // Create import button
        const button = document.createElement('button');
        button.id = 'toolasha-import-button';
        // Include hidden text for JIGS compatibility (JIGS searches for "Import solo/group")
        button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
        button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
        button.style.color = 'white';
        button.style.padding = '10px 20px';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.fontWeight = 'bold';
        button.style.width = '100%';

        // Add hover effect
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '0.8';
        });
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '1';
        });

        // Add click handler
        button.addEventListener('click', () => {
            importDataToSimulator(button);
        });

        container.appendChild(button);

        // Insert after export button's parent container
        exportButton.parentElement.parentElement.insertAdjacentElement('afterend', container);

        console.log('[Toolasha Combat Sim] Import button injected');
    }

    /**
     * Import character/party data into simulator
     * @param {Element} button - Button element to update status
     */
    function importDataToSimulator(button) {
        try {
            console.log('[Toolasha Combat Sim] Starting import');

            // Get export data from GM storage
            const exportData = constructExportObject();

            if (!exportData) {
                button.textContent = 'Error: No character data';
                button.style.backgroundColor = '#dc3545'; // Red
                setTimeout(() => {
                    button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                    button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
                }, 3000);
                console.error('[Toolasha Combat Sim] No export data available');
                alert('No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again');
                return;
            }

            const { exportObj, playerIDs, importedPlayerPositions, zone, isZoneDungeon, difficultyTier, isParty } = exportData;

            console.log('[Toolasha Combat Sim] Export data:', {
                playerIDs,
                zone,
                isZoneDungeon,
                difficultyTier,
                isParty
            });

            // Step 1: Switch to Group Combat tab
            const groupTab = document.querySelector('a#group-combat-tab');
            if (groupTab) {
                groupTab.click();
            } else {
                console.warn('[Toolasha Combat Sim] Group combat tab not found');
            }

            // Small delay to let tab switch complete
            setTimeout(() => {
                // Step 2: Fill import field with JSON data
                const importInput = document.querySelector('input#inputSetGroupCombatAll');
                if (importInput) {
                    // exportObj already has JSON strings for each slot, just stringify once
                    importInput.value = JSON.stringify(exportObj);
                    console.log('[Toolasha Combat Sim] Data filled into import field');
                } else {
                    console.error('[Toolasha Combat Sim] Import input field not found');
                }

                // Step 3: Click import button
                const importButton = document.querySelector('button#buttonImportSet');
                if (importButton) {
                    importButton.click();
                    console.log('[Toolasha Combat Sim] Import button clicked');
                } else {
                    console.error('[Toolasha Combat Sim] Import button not found');
                }

                // Step 4: Set player names in tabs
                for (let i = 0; i < 5; i++) {
                    const tab = document.querySelector(`a#player${i + 1}-tab`);
                    if (tab) {
                        tab.textContent = playerIDs[i];
                    }
                }

                // Step 5: Select zone or dungeon
                if (zone) {
                    selectZone(zone, isZoneDungeon);
                }

                // Step 5.5: Set difficulty tier
                setTimeout(() => {
                    // Try both input and select elements
                    let difficultyElement = document.querySelector('input#inputDifficulty') ||
                                           document.querySelector('select#inputDifficulty') ||
                                           document.querySelector('[id*="ifficulty"]');

                    if (difficultyElement) {
                        const tierValue = 'T' + difficultyTier;

                        // Handle select dropdown (set by value)
                        if (difficultyElement.tagName === 'SELECT') {
                            // Try to find option by value or text
                            for (let i = 0; i < difficultyElement.options.length; i++) {
                                const option = difficultyElement.options[i];
                                if (option.value === tierValue || option.value === String(difficultyTier) ||
                                    option.text === tierValue || option.text.includes('T' + difficultyTier)) {
                                    difficultyElement.selectedIndex = i;
                                    break;
                                }
                            }
                        } else {
                            // Handle text input
                            difficultyElement.value = tierValue;
                        }

                        difficultyElement.dispatchEvent(new Event('change'));
                        difficultyElement.dispatchEvent(new Event('input'));
                        console.log('[Toolasha Combat Sim] Difficulty tier set to:', tierValue, 'on element:', difficultyElement.tagName);
                    } else {
                        console.warn('[Toolasha Combat Sim] Difficulty element not found');
                    }
                }, 250); // Increased delay to ensure zone loads first

                // Step 6: Enable/disable player checkboxes
                for (let i = 0; i < 5; i++) {
                    const checkbox = document.querySelector(`input#player${i + 1}.form-check-input.player-checkbox`);
                    if (checkbox) {
                        checkbox.checked = importedPlayerPositions[i];
                        checkbox.dispatchEvent(new Event('change'));
                    }
                }

                // Step 7: Set simulation time to 24 hours (standard)
                const simTimeInput = document.querySelector('input#inputSimulationTime');
                if (simTimeInput) {
                    simTimeInput.value = '24';
                }

                // Step 8: Get prices (refresh market data)
                const getPriceButton = document.querySelector('button#buttonGetPrices');
                if (getPriceButton) {
                    getPriceButton.click();
                    console.log('[Toolasha Combat Sim] Refreshing market prices');
                }

                // Update button status
                button.textContent = '✓ Imported';
                button.style.backgroundColor = '#28a745'; // Green
                setTimeout(() => {
                    button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                    button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
                }, 3000);

                console.log('[Toolasha Combat Sim] Import complete');
            }, 100);

        } catch (error) {
            console.error('[Toolasha Combat Sim] Import failed:', error);
            button.textContent = 'Import Failed';
            button.style.backgroundColor = '#dc3545'; // Red
            setTimeout(() => {
                button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
            }, 3000);
        }
    }

    /**
     * Select zone or dungeon in simulator
     * @param {string} zoneHrid - Zone action HRID
     * @param {boolean} isDungeon - Whether it's a dungeon
     */
    function selectZone(zoneHrid, isDungeon) {
        const dungeonToggle = document.querySelector('input#simDungeonToggle');

        if (isDungeon) {
            // Dungeon mode
            if (dungeonToggle) {
                dungeonToggle.checked = true;
                dungeonToggle.dispatchEvent(new Event('change'));
            }

            setTimeout(() => {
                const selectDungeon = document.querySelector('select#selectDungeon');
                if (selectDungeon) {
                    for (let i = 0; i < selectDungeon.options.length; i++) {
                        if (selectDungeon.options[i].value === zoneHrid) {
                            selectDungeon.options[i].selected = true;
                            selectDungeon.dispatchEvent(new Event('change'));
                            console.log('[Toolasha Combat Sim] Dungeon selected:', zoneHrid);
                            break;
                        }
                    }
                }
            }, 100);
        } else {
            // Zone mode
            if (dungeonToggle) {
                dungeonToggle.checked = false;
                dungeonToggle.dispatchEvent(new Event('change'));
            }

            setTimeout(() => {
                const selectZone = document.querySelector('select#selectZone');
                if (selectZone) {
                    for (let i = 0; i < selectZone.options.length; i++) {
                        if (selectZone.options[i].value === zoneHrid) {
                            selectZone.options[i].selected = true;
                            selectZone.dispatchEvent(new Event('change'));
                            console.log('[Toolasha Combat Sim] Zone selected:', zoneHrid);
                            break;
                        }
                    }
                }
            }, 100);
        }
    }

    /**
     * Profile Export Button Module
     * Adds "Export to Clipboard" button on profile page
     *
     * Allows users to copy character data for manual pasting into combat simulator
     */


    /**
     * Initialize profile export button
     */
    function initialize() {
        console.log('[Profile Export] Initializing');
        waitForProfilePage();
    }

    /**
     * Wait for profile page to load
     */
    function waitForProfilePage() {
        setInterval(() => {
            const profileTab = document.querySelector('div.SharableProfile_overviewTab__W4dCV');

            // Only inject if we're on the profile page AND button doesn't exist yet
            if (profileTab && !document.getElementById('toolasha-profile-export-button')) {
                console.log('[Profile Export] Profile page detected');
                injectExportButton(profileTab);
            }
        }, 500);

        // Keep checking - profile page can be opened/closed multiple times
        // Don't stop the interval since user may navigate away and come back
    }

    /**
     * Inject export button on profile page
     * @param {Element} container - Profile overview tab container
     */
    function injectExportButton(container) {
        // Check if button already exists
        if (document.getElementById('toolasha-profile-export-button')) {
            return;
        }

        const button = document.createElement('button');
        button.id = 'toolasha-profile-export-button';
        button.textContent = 'Export to Clipboard';
        button.style.cssText = `
        border-radius: 5px;
        height: 30px;
        background-color: ${config.SCRIPT_COLOR_MAIN};
        color: black;
        box-shadow: none;
        border: 0px;
        padding: 0 15px;
        cursor: pointer;
        font-weight: bold;
        margin-top: 10px;
        width: 100%;
    `;

        // Add hover effect
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '0.8';
        });
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '1';
        });

        // Add click handler
        button.addEventListener('click', async () => {
            await handleExport(button);
        });

        // Append to container
        container.appendChild(button);
        console.log('[Profile Export] Button injected');
    }

    /**
     * Handle export button click
     * @param {Element} button - Button element to update
     */
    async function handleExport(button) {
        try {
            console.log('[Profile Export] Starting export');

            // Get export data
            const exportData = constructExportObject();

            if (!exportData) {
                button.textContent = '✗ No Data';
                button.style.backgroundColor = '#dc3545'; // Red
                setTimeout(() => resetButton(button), 3000);
                console.error('[Profile Export] No export data available');
                alert('No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again');
                return;
            }

            // Copy to clipboard
            const exportString = JSON.stringify(exportData.exportObj);
            await navigator.clipboard.writeText(exportString);

            console.log('[Profile Export] Data copied to clipboard');
            console.log('[Profile Export] Export data:', exportData);

            // Success feedback
            button.textContent = '✓ Copied';
            button.style.backgroundColor = '#28a745'; // Green
            setTimeout(() => resetButton(button), 3000);

        } catch (error) {
            console.error('[Profile Export] Export failed:', error);

            // Error feedback
            button.textContent = '✗ Failed';
            button.style.backgroundColor = '#dc3545'; // Red
            setTimeout(() => resetButton(button), 3000);

            // Show user-friendly error
            if (error.name === 'NotAllowedError') {
                alert('Clipboard access denied. Please allow clipboard permissions for this site.');
            } else {
                alert('Export failed: ' + error.message);
            }
        }
    }

    /**
     * Reset button to original state
     * @param {Element} button - Button element
     */
    function resetButton(button) {
        button.textContent = 'Export to Clipboard';
        button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
    }

    /**
     * Settings Configuration
     * Organizes all script settings into logical groups for the settings UI
     */

    const settingsGroups = {
        general: {
            title: 'General Settings',
            icon: '⚙️',
            settings: {
                networkAlert: {
                    id: 'networkAlert',
                    label: 'Show alert when market price data cannot be fetched',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        actionPanel: {
            title: 'Action Panel Enhancements',
            icon: '⚡',
            settings: {
                totalActionTime: {
                    id: 'totalActionTime',
                    label: 'Top left: Estimated total time and completion time',
                    type: 'checkbox',
                    default: true
                },
                actionPanel_totalTime: {
                    id: 'actionPanel_totalTime',
                    label: 'Action panel: Total time, times to reach target level, exp/hour',
                    type: 'checkbox',
                    default: true
                },
                actionPanel_totalTime_quickInputs: {
                    id: 'actionPanel_totalTime_quickInputs',
                    label: 'Action panel: Quick input buttons (hours, count presets, Max)',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['actionPanel_totalTime']
                },
                actionPanel_foragingTotal: {
                    id: 'actionPanel_foragingTotal',
                    label: 'Action panel: Overall profit for multi-outcome foraging',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['actionPanel_totalTime']
                },
                actionQueue: {
                    id: 'actionQueue',
                    label: 'Queued actions: Show total time and completion time',
                    type: 'checkbox',
                    default: true
                },
                actionPanel_speedBreakdown: {
                    id: 'actionPanel_speedBreakdown',
                    label: 'Action panel: Show detailed action speed breakdown',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows breakdown of action speed by source (equipment, tool, house, consumables)'
                }
            }
        },

        tooltips: {
            title: 'Item Tooltip Enhancements',
            icon: '💬',
            settings: {
                itemTooltip_prices: {
                    id: 'itemTooltip_prices',
                    label: 'Show 24-hour average market prices',
                    type: 'checkbox',
                    default: true
                },
                itemTooltip_profit: {
                    id: 'itemTooltip_profit',
                    label: 'Show production cost and profit',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['itemTooltip_prices']
                },
                itemTooltip_expectedValue: {
                    id: 'itemTooltip_expectedValue',
                    label: 'Show expected value for openable containers',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['itemTooltip_prices']
                },
                expectedValue_showDrops: {
                    id: 'expectedValue_showDrops',
                    label: 'Expected value drop display',
                    type: 'select',
                    default: 'All',
                    options: [
                        { value: 'Top 5', label: 'Top 5' },
                        { value: 'Top 10', label: 'Top 10' },
                        { value: 'All', label: 'All Drops' },
                        { value: 'None', label: 'Summary Only' }
                    ],
                    dependencies: ['itemTooltip_expectedValue']
                },
                expectedValue_respectPricingMode: {
                    id: 'expectedValue_respectPricingMode',
                    label: 'Use pricing mode for expected value calculations',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['itemTooltip_expectedValue']
                },
                showConsumTips: {
                    id: 'showConsumTips',
                    label: 'HP/MP consumables: Restore speed, cost performance',
                    type: 'checkbox',
                    default: true
                },
                enhanceSim: {
                    id: 'enhanceSim',
                    label: 'Show enhancement simulator calculations',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        enhancementSimulator: {
            title: 'Enhancement Simulator Settings',
            icon: '✨',
            settings: {
                enhanceSim_autoDetect: {
                    id: 'enhanceSim_autoDetect',
                    label: 'Auto-detect your stats (false = use market defaults)',
                    type: 'checkbox',
                    default: false,
                    help: 'Most players should use market defaults to see realistic professional enhancer costs'
                },
                enhanceSim_enhancingLevel: {
                    id: 'enhanceSim_enhancingLevel',
                    label: 'Enhancing skill level',
                    type: 'number',
                    default: 125,
                    min: 1,
                    max: 150,
                    help: 'Default: 125 (professional enhancer level)'
                },
                enhanceSim_houseLevel: {
                    id: 'enhanceSim_houseLevel',
                    label: 'Observatory house room level',
                    type: 'number',
                    default: 6,
                    min: 0,
                    max: 8,
                    help: 'Default: 6 (realistic market level)'
                },
                enhanceSim_toolBonus: {
                    id: 'enhanceSim_toolBonus',
                    label: 'Tool success bonus %',
                    type: 'number',
                    default: 5.42,
                    min: 0,
                    max: 30,
                    step: 0.01,
                    help: 'Default: 5.42 (Celestial Enhancer +10)'
                },
                enhanceSim_speedBonus: {
                    id: 'enhanceSim_speedBonus',
                    label: 'Speed bonus %',
                    type: 'number',
                    default: 0,
                    min: 0,
                    max: 50,
                    step: 0.01,
                    help: 'Default: 0 (not critical for cost calculations)'
                },
                enhanceSim_blessedTea: {
                    id: 'enhanceSim_blessedTea',
                    label: 'Blessed Tea active',
                    type: 'checkbox',
                    default: true,
                    help: 'Professional enhancers use this to reduce attempts'
                },
                enhanceSim_ultraEnhancingTea: {
                    id: 'enhanceSim_ultraEnhancingTea',
                    label: 'Ultra Enhancing Tea active',
                    type: 'checkbox',
                    default: true,
                    help: 'Provides +8 base skill levels (scales with drink concentration)'
                },
                enhanceSim_superEnhancingTea: {
                    id: 'enhanceSim_superEnhancingTea',
                    label: 'Super Enhancing Tea active',
                    type: 'checkbox',
                    default: false,
                    help: 'Provides +6 base skill levels (Ultra is better)'
                },
                enhanceSim_enhancingTea: {
                    id: 'enhanceSim_enhancingTea',
                    label: 'Enhancing Tea active',
                    type: 'checkbox',
                    default: false,
                    help: 'Provides +3 base skill levels (Ultra is better)'
                },
                enhanceSim_drinkConcentration: {
                    id: 'enhanceSim_drinkConcentration',
                    label: 'Drink Concentration %',
                    type: 'number',
                    default: 10.32,
                    min: 0,
                    max: 20,
                    step: 0.01,
                    help: 'Default: 10.32 (Guzzling Pouch +10)'
                }
            }
        },

        enhancementTracker: {
            title: 'Enhancement Tracker',
            icon: '📊',
            settings: {
                enhancementTracker: {
                    id: 'enhancementTracker',
                    label: 'Enable Enhancement Tracker',
                    type: 'checkbox',
                    default: false,
                    requiresRefresh: true,
                    help: 'Track enhancement attempts, costs, and statistics'
                },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                    label: 'Show tracker only on Enhancing screen',
                    type: 'checkbox',
                    default: false,
                    dependencies: ['enhancementTracker'],
                    help: 'Hide tracker when not on the Enhancing screen'
                }
            }
        },

        economy: {
            title: 'Economy & Inventory',
            icon: '💰',
            settings: {
                networth: {
                    id: 'networth',
                    label: 'Top right: Show current assets (net worth)',
                    type: 'checkbox',
                    default: true,
                    help: 'Enhanced items valued by enhancement simulator'
                },
                invWorth: {
                    id: 'invWorth',
                    label: 'Below inventory: Show inventory summary',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['networth']
                },
                invSort: {
                    id: 'invSort',
                    label: 'Sort inventory items by value',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['networth']
                },
                invSort_showBadges: {
                    id: 'invSort_showBadges',
                    label: 'Show stack value badges on items',
                    type: 'checkbox',
                    default: false,
                    dependencies: ['invSort']
                },
                profitCalc_pricingMode: {
                    id: 'profitCalc_pricingMode',
                    label: 'Profit calculation pricing mode',
                    type: 'select',
                    default: 'hybrid',
                    options: [
                        { value: 'conservative', label: 'Conservative (Ask/Bid - instant trading)' },
                        { value: 'hybrid', label: 'Hybrid (Ask/Ask - instant buy, patient sell)' },
                        { value: 'optimistic', label: 'Optimistic (Bid/Ask - patient trading)' }
                    ]
                }
            }
        },

        skills: {
            title: 'Skills',
            icon: '📚',
            settings: {
                skillbook: {
                    id: 'skillbook',
                    label: 'Skill books: Show books needed to reach target level',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        combat: {
            title: 'Combat Features',
            icon: '⚔️',
            settings: {
                combatScore: {
                    id: 'combatScore',
                    label: 'Profile panel: Show gear score',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        tasks: {
            title: 'Tasks',
            icon: '📋',
            settings: {
                taskProfitCalculator: {
                    id: 'taskProfitCalculator',
                    label: 'Show total profit for gathering/production tasks',
                    type: 'checkbox',
                    default: true
                },
                taskRerollTracker: {
                    id: 'taskRerollTracker',
                    label: 'Track task reroll costs',
                    type: 'checkbox',
                    default: true,
                    requiresRefresh: true,
                    help: 'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)'
                },
                taskMapIndex: {
                    id: 'taskMapIndex',
                    label: 'Show combat zone index numbers on tasks',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        ui: {
            title: 'UI Enhancements',
            icon: '🎨',
            settings: {
                expPercentage: {
                    id: 'expPercentage',
                    label: 'Left sidebar: Show skill XP percentages',
                    type: 'checkbox',
                    default: true
                },
                itemIconLevel: {
                    id: 'itemIconLevel',
                    label: 'Bottom left corner of icons: Show equipment level',
                    type: 'checkbox',
                    default: true
                },
                showsKeyInfoInIcon: {
                    id: 'showsKeyInfoInIcon',
                    label: 'Bottom left corner of key icons: Show zone index',
                    type: 'checkbox',
                    default: true,
                    dependencies: ['itemIconLevel']
                },
                mapIndex: {
                    id: 'mapIndex',
                    label: 'Combat zones: Show zone index numbers',
                    type: 'checkbox',
                    default: true
                },
                alchemyItemDimming: {
                    id: 'alchemyItemDimming',
                    label: 'Alchemy panel: Dim items requiring higher level',
                    type: 'checkbox',
                    default: true
                },
                marketFilter: {
                    id: 'marketFilter',
                    label: 'Marketplace: Filter by level, class, slot',
                    type: 'checkbox',
                    default: true
                },
                fillMarketOrderPrice: {
                    id: 'fillMarketOrderPrice',
                    label: 'Auto-fill marketplace orders with optimal price',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        house: {
            title: 'House',
            icon: '🏠',
            settings: {
                houseUpgradeCosts: {
                    id: 'houseUpgradeCosts',
                    label: 'Show upgrade costs with market prices and inventory comparison',
                    type: 'checkbox',
                    default: true
                }
            }
        },

        notifications: {
            title: 'Notifications',
            icon: '🔔',
            settings: {
                notifiEmptyAction: {
                    id: 'notifiEmptyAction',
                    label: 'Browser notification when action queue is empty',
                    type: 'checkbox',
                    default: false,
                    help: 'Only works when the game page is open'
                }
            }
        }
    };

    /**
     * Settings Storage Module
     * Handles persistence of settings to chrome.storage.local
     */


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
            await storage.setJSON(this.storageKey, settings, this.storageArea);
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

    var settingsCSS = "/* Toolasha Settings UI Styles\n * Modern, compact design\n */\n\n/* CSS Variables */\n:root {\n    --toolasha-accent: #5b8def;\n    --toolasha-accent-hover: #7aa3f3;\n    --toolasha-accent-dim: rgba(91, 141, 239, 0.15);\n    --toolasha-secondary: #8A2BE2;\n    --toolasha-text: rgba(255, 255, 255, 0.9);\n    --toolasha-text-dim: rgba(255, 255, 255, 0.5);\n    --toolasha-bg: rgba(20, 25, 35, 0.6);\n    --toolasha-border: rgba(91, 141, 239, 0.2);\n    --toolasha-toggle-off: rgba(100, 100, 120, 0.4);\n    --toolasha-toggle-on: var(--toolasha-accent);\n}\n\n/* Settings Card Container */\n.toolasha-settings-card {\n    display: flex;\n    flex-direction: column;\n    padding: 12px 16px;\n    font-size: 12px;\n    line-height: 1.3;\n    color: var(--toolasha-text);\n    position: relative;\n    overflow-y: auto;\n    gap: 6px;\n    max-height: calc(100vh - 250px);\n}\n\n/* Top gradient line */\n.toolasha-settings-card::before {\n    display: none;\n}\n\n/* Scrollbar styling */\n.toolasha-settings-card::-webkit-scrollbar {\n    width: 6px;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-track {\n    background: transparent;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-thumb {\n    background: var(--toolasha-accent);\n    border-radius: 3px;\n    opacity: 0.5;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-thumb:hover {\n    opacity: 1;\n}\n\n/* Collapsible Settings Groups */\n.toolasha-settings-group {\n    margin-bottom: 8px;\n}\n\n.toolasha-settings-group-header {\n    cursor: pointer;\n    user-select: none;\n    margin: 10px 0 4px 0;\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    font-size: 13px;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    border-bottom: 1px solid var(--toolasha-border);\n    padding-bottom: 3px;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n    transition: color 0.2s ease;\n}\n\n.toolasha-settings-group-header:hover {\n    color: var(--toolasha-accent-hover);\n}\n\n.toolasha-settings-group-header .collapse-icon {\n    font-size: 10px;\n    transition: transform 0.2s ease;\n}\n\n.toolasha-settings-group.collapsed .collapse-icon {\n    transform: rotate(-90deg);\n}\n\n.toolasha-settings-group-content {\n    max-height: 5000px;\n    overflow: hidden;\n    transition: max-height 0.3s ease-out;\n}\n\n.toolasha-settings-group.collapsed .toolasha-settings-group-content {\n    max-height: 0;\n}\n\n/* Section Headers */\n.toolasha-settings-card h3 {\n    margin: 10px 0 4px 0;\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    font-size: 13px;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    border-bottom: 1px solid var(--toolasha-border);\n    padding-bottom: 3px;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n}\n\n.toolasha-settings-card h3:first-child {\n    margin-top: 0;\n}\n\n.toolasha-settings-card h3 .icon {\n    font-size: 14px;\n}\n\n/* Individual Setting Row */\n.toolasha-setting {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 10px;\n    margin: 0;\n    padding: 6px 8px;\n    background: var(--toolasha-bg);\n    border: 1px solid var(--toolasha-border);\n    border-radius: 4px;\n    min-height: unset;\n    transition: all 0.2s ease;\n}\n\n.toolasha-setting:hover {\n    background: rgba(30, 35, 45, 0.7);\n    border-color: var(--toolasha-accent);\n}\n\n.toolasha-setting.disabled {\n    opacity: 0.3;\n    pointer-events: none;\n}\n\n.toolasha-setting.not-implemented .toolasha-setting-label {\n    color: #ff6b6b;\n}\n\n.toolasha-setting.not-implemented .toolasha-setting-help {\n    color: rgba(255, 107, 107, 0.7);\n}\n\n.toolasha-setting-label {\n    text-align: left;\n    flex: 1;\n    margin-right: 10px;\n    line-height: 1.3;\n    font-size: 12px;\n}\n\n.toolasha-setting-help {\n    display: block;\n    font-size: 10px;\n    color: var(--toolasha-text-dim);\n    margin-top: 2px;\n    font-style: italic;\n}\n\n.toolasha-setting-input {\n    flex-shrink: 0;\n}\n\n/* Modern Toggle Switch */\n.toolasha-switch {\n    position: relative;\n    width: 38px;\n    height: 20px;\n    flex-shrink: 0;\n    display: inline-block;\n}\n\n.toolasha-switch input {\n    opacity: 0;\n    width: 0;\n    height: 0;\n    position: absolute;\n}\n\n.toolasha-slider {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    bottom: 0;\n    background: var(--toolasha-toggle-off);\n    border-radius: 20px;\n    cursor: pointer;\n    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n    border: 2px solid transparent;\n}\n\n.toolasha-slider:before {\n    content: \"\";\n    position: absolute;\n    height: 12px;\n    width: 12px;\n    left: 2px;\n    bottom: 2px;\n    background: white;\n    border-radius: 50%;\n    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);\n}\n\n.toolasha-switch input:checked + .toolasha-slider {\n    background: var(--toolasha-toggle-on);\n    border-color: var(--toolasha-accent-hover);\n    box-shadow: 0 0 6px var(--toolasha-accent-dim);\n}\n\n.toolasha-switch input:checked + .toolasha-slider:before {\n    transform: translateX(18px);\n}\n\n.toolasha-switch:hover .toolasha-slider {\n    border-color: var(--toolasha-accent);\n}\n\n/* Text Input */\n.toolasha-text-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-text);\n    min-width: 100px;\n    font-size: 12px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-text-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n/* Number Input */\n.toolasha-number-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-text);\n    min-width: 80px;\n    font-size: 12px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-number-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n/* Select Dropdown */\n.toolasha-select-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    min-width: 150px;\n    cursor: pointer;\n    font-size: 12px;\n    -webkit-appearance: none;\n    -moz-appearance: none;\n    appearance: none;\n    background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5z%22%20fill%3D%22%235b8def%22%2F%3E%3C%2Fsvg%3E');\n    background-repeat: no-repeat;\n    background-position: right 6px center;\n    background-size: 14px;\n    padding-right: 28px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-select-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n.toolasha-select-input option {\n    background: #1a1a2e;\n    color: var(--toolasha-text);\n    padding: 8px;\n}\n\n/* Utility Buttons Container */\n.toolasha-utility-buttons {\n    display: flex;\n    gap: 8px;\n    margin-top: 12px;\n    padding-top: 10px;\n    border-top: 1px solid var(--toolasha-border);\n    flex-wrap: wrap;\n}\n\n.toolasha-utility-button {\n    background: linear-gradient(135deg, var(--toolasha-secondary), #6A1B9A);\n    border: 1px solid rgba(138, 43, 226, 0.4);\n    color: #ffffff;\n    padding: 6px 12px;\n    border-radius: 4px;\n    font-size: 11px;\n    font-weight: 600;\n    cursor: pointer;\n    transition: all 0.2s ease;\n    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);\n}\n\n.toolasha-utility-button:hover {\n    background: linear-gradient(135deg, #9A4BCF, var(--toolasha-secondary));\n    box-shadow: 0 0 10px rgba(138, 43, 226, 0.3);\n    transform: translateY(-1px);\n}\n\n.toolasha-utility-button:active {\n    transform: translateY(0);\n}\n\n/* Refresh Notice */\n.toolasha-refresh-notice {\n    background: rgba(255, 152, 0, 0.1);\n    border: 1px solid rgba(255, 152, 0, 0.3);\n    border-radius: 4px;\n    padding: 8px 12px;\n    margin-top: 10px;\n    color: #ffa726;\n    font-size: 11px;\n    display: flex;\n    align-items: center;\n    gap: 8px;\n}\n\n.toolasha-refresh-notice::before {\n    content: \"⚠️\";\n    font-size: 14px;\n}\n\n/* Dependency Indicator */\n.toolasha-setting.has-dependency::before {\n    content: \"↳\";\n    position: absolute;\n    left: -4px;\n    color: var(--toolasha-accent);\n    font-size: 14px;\n    opacity: 0.5;\n}\n\n.toolasha-setting.has-dependency {\n    margin-left: 16px;\n    position: relative;\n}\n\n/* Nested setting collapse icons */\n.setting-collapse-icon {\n    flex-shrink: 0;\n    color: var(--toolasha-accent);\n    opacity: 0.7;\n}\n\n.toolasha-setting.dependents-collapsed .setting-collapse-icon {\n    opacity: 1;\n}\n\n.toolasha-setting-label-container:hover .setting-collapse-icon {\n    opacity: 1;\n}\n\n/* Tab Panel Override (for game's settings panel) */\n.TabPanel_tabPanel__tXMJF#toolasha-settings {\n    display: block !important;\n}\n\n.TabPanel_tabPanel__tXMJF#toolasha-settings.TabPanel_hidden__26UM3 {\n    display: none !important;\n}\n";

    /**
     * Settings UI Module
     * Injects Toolasha settings tab into the game's settings panel
     * Based on MWITools Extended approach
     */


    class SettingsUI {
        constructor() {
            this.config = config;
            this.settingsPanel = null;
            this.settingsObserver = null;
            this.currentSettings = {};
        }

        /**
         * Initialize the settings UI
         */
        async initialize() {
            console.log('[Toolasha Settings] Initializing...');

            // Inject CSS styles
            this.injectStyles();

            // Load current settings
            this.currentSettings = await settingsStorage.loadSettings();
            console.log('[Toolasha Settings] Settings loaded, starting observer');

            // Wait for game's settings panel to load
            this.observeSettingsPanel();
            console.log('[Toolasha Settings] Observer started');
        }

        /**
         * Inject CSS styles into page
         */
        injectStyles() {
            const styleEl = document.createElement('style');
            styleEl.id = 'toolasha-settings-styles';
            styleEl.textContent = settingsCSS;
            document.head.appendChild(styleEl);
        }

        /**
         * Observe for game's settings panel
         * Uses MutationObserver to detect when settings panel appears
         */
        observeSettingsPanel() {
            // Watch for settings panel to be added to DOM
            const observer = new MutationObserver((mutations) => {
                // Look for the settings tabs container
                const tabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

                if (tabsContainer) {
                    console.log('[Toolasha Settings] Settings panel detected by observer');
                    // Check if our tab already exists before injecting
                    if (!tabsContainer.querySelector('#toolasha-settings-tab')) {
                        console.log('[Toolasha Settings] Injecting settings tab');
                        this.injectSettingsTab();
                    } else {
                        console.log('[Toolasha Settings] Tab already exists, skipping injection');
                    }
                    // Keep observer running - panel might be removed/re-added if user navigates away and back
                }
            });

            // Observe the main game panel for changes
            const gamePanel = document.querySelector('div[class*="GamePage_gamePanel"]');
            if (gamePanel) {
                observer.observe(gamePanel, {
                    childList: true,
                    subtree: true
                });
            } else {
                // Fallback: observe entire body if game panel not found (Firefox timing issue)
                console.warn('[Toolasha Settings] Could not find game panel, observing body instead');
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }

            // Store observer reference
            this.settingsObserver = observer;

            // Also check immediately in case settings is already open
            const existingTabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');
            if (existingTabsContainer) {
                console.log('[Toolasha Settings] Settings panel already open, injecting immediately');
                // Check if our tab already exists
                if (!existingTabsContainer.querySelector('#toolasha-settings-tab')) {
                    this.injectSettingsTab();
                } else {
                    console.log('[Toolasha Settings] Tab already exists (immediate check)');
                }
            } else {
                console.log('[Toolasha Settings] Settings panel not open yet, waiting for observer');
            }
        }

        /**
         * Inject Toolasha settings tab into game's settings panel
         */
        injectSettingsTab() {
            // Find tabs container (MWIt-E approach)
            const tabsComponentContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

            if (!tabsComponentContainer) {
                console.warn('[Toolasha Settings] Could not find tabsComponentContainer');
                return;
            }

            // Find the MUI tabs flexContainer
            const tabsContainer = tabsComponentContainer.querySelector('[class*="MuiTabs-flexContainer"]');
            const tabPanelsContainer = tabsComponentContainer.querySelector('[class*="TabsComponent_tabPanelsContainer"]');

            if (!tabsContainer || !tabPanelsContainer) {
                console.warn('[Toolasha Settings] Could not find tabs or panels container');
                return;
            }

            // Check if already injected
            if (tabsContainer.querySelector('#toolasha-settings-tab')) {
                return;
            }

            // Get existing tabs for reference
            const existingTabs = Array.from(tabsContainer.querySelectorAll('button[role="tab"]'));

            // Create new tab button
            const tabButton = this.createTabButton();

            // Create tab panel
            const tabPanel = this.createTabPanel();

            // Setup tab switching
            this.setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer);

            // Append to DOM
            tabsContainer.appendChild(tabButton);
            tabPanelsContainer.appendChild(tabPanel);

            // Store reference
            this.settingsPanel = tabPanel;
        }

        /**
         * Create tab button
         * @returns {HTMLElement} Tab button element
         */
        createTabButton() {
            const button = document.createElement('button');
            button.id = 'toolasha-settings-tab';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', 'false');
            button.setAttribute('tabindex', '-1');
            button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';
            button.style.minWidth = '90px';

            const span = document.createElement('span');
            span.className = 'MuiTab-wrapper';
            span.textContent = 'Toolasha';

            button.appendChild(span);

            return button;
        }

        /**
         * Create tab panel with all settings
         * @returns {HTMLElement} Tab panel element
         */
        createTabPanel() {
            const panel = document.createElement('div');
            panel.id = 'toolasha-settings';
            panel.className = 'TabPanel_tabPanel__tXMJF TabPanel_hidden__26UM3';
            panel.setAttribute('role', 'tabpanel');
            panel.style.display = 'none';

            // Create settings card
            const card = document.createElement('div');
            card.className = 'toolasha-settings-card';
            card.id = 'toolasha-settings-content';

            // Generate settings from config
            this.generateSettings(card);

            // Add utility buttons
            this.addUtilityButtons(card);

            // Add refresh notice
            this.addRefreshNotice(card);

            panel.appendChild(card);

            // Add change listener
            card.addEventListener('change', (e) => this.handleSettingChange(e));

            return panel;
        }

        /**
         * Generate all settings UI from config
         * @param {HTMLElement} container - Container element
         */
        generateSettings(container) {
            for (const [groupKey, group] of Object.entries(settingsGroups)) {
                // Create collapsible group container
                const groupContainer = document.createElement('div');
                groupContainer.className = 'toolasha-settings-group';
                groupContainer.dataset.group = groupKey;

                // Add section header with collapse toggle
                const header = document.createElement('h3');
                header.className = 'toolasha-settings-group-header';
                header.innerHTML = `
                <span class="collapse-icon">▼</span>
                <span class="icon">${group.icon}</span>
                ${group.title}
            `;
                // Bind toggleGroup method to this instance
                header.addEventListener('click', this.toggleGroup.bind(this, groupContainer));

                // Create content container for this group
                const content = document.createElement('div');
                content.className = 'toolasha-settings-group-content';

                // Add settings in this group
                for (const [settingId, settingDef] of Object.entries(group.settings)) {
                    const settingEl = this.createSettingElement(settingId, settingDef);
                    content.appendChild(settingEl);
                }

                groupContainer.appendChild(header);
                groupContainer.appendChild(content);
                container.appendChild(groupContainer);
            }

            // After all settings are created, set up collapse functionality for parent settings
            this.setupParentCollapseIcons(container);

            // Restore collapse states from localStorage
            this.restoreCollapseStates(container);
        }

        /**
         * Setup collapse icons for parent settings (settings that have dependents)
         * @param {HTMLElement} container - Settings container
         */
        setupParentCollapseIcons(container) {
            const allSettings = container.querySelectorAll('.toolasha-setting');

            allSettings.forEach(setting => {
                const settingId = setting.dataset.settingId;

                // Find all dependents of this setting
                const dependents = Array.from(allSettings).filter(s =>
                    s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                );

                if (dependents.length > 0) {
                    // This setting has dependents - show collapse icon
                    const collapseIcon = setting.querySelector('.setting-collapse-icon');
                    if (collapseIcon) {
                        collapseIcon.style.display = 'inline-block';

                        // Add click handler to toggle dependents - bind to preserve this context
                        const labelContainer = setting.querySelector('.toolasha-setting-label-container');
                        labelContainer.style.cursor = 'pointer';
                        labelContainer.addEventListener('click', (e) => {
                            // Don't toggle if clicking the input itself
                            if (e.target.closest('.toolasha-setting-input')) return;

                            this.toggleDependents(setting, dependents);
                        });
                    }
                }
            });
        }

        /**
         * Toggle group collapse/expand
         * @param {HTMLElement} groupContainer - Group container element
         */
        toggleGroup(groupContainer) {
            groupContainer.classList.toggle('collapsed');

            // Save collapse state to localStorage
            const groupKey = groupContainer.dataset.group;
            const isCollapsed = groupContainer.classList.contains('collapsed');
            this.saveCollapseState('group', groupKey, isCollapsed);
        }

        /**
         * Toggle dependent settings visibility
         * @param {HTMLElement} parentSetting - Parent setting element
         * @param {HTMLElement[]} dependents - Array of dependent setting elements
         */
        toggleDependents(parentSetting, dependents) {
            const collapseIcon = parentSetting.querySelector('.setting-collapse-icon');
            const isCollapsed = parentSetting.classList.contains('dependents-collapsed');

            if (isCollapsed) {
                // Expand
                parentSetting.classList.remove('dependents-collapsed');
                collapseIcon.style.transform = 'rotate(0deg)';
                dependents.forEach(dep => dep.style.display = 'flex');
            } else {
                // Collapse
                parentSetting.classList.add('dependents-collapsed');
                collapseIcon.style.transform = 'rotate(-90deg)';
                dependents.forEach(dep => dep.style.display = 'none');
            }

            // Save collapse state to localStorage
            const settingId = parentSetting.dataset.settingId;
            const newState = !isCollapsed; // Inverted because we just toggled
            this.saveCollapseState('setting', settingId, newState);
        }

        /**
         * Save collapse state to IndexedDB
         * @param {string} type - 'group' or 'setting'
         * @param {string} key - Group key or setting ID
         * @param {boolean} isCollapsed - Whether collapsed
         */
        async saveCollapseState(type, key, isCollapsed) {
            try {
                const states = await storage.getJSON('collapse-states', 'settings', {});

                if (!states[type]) {
                    states[type] = {};
                }
                states[type][key] = isCollapsed;

                await storage.setJSON('collapse-states', states, 'settings');
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to save collapse states:', e);
            }
        }

        /**
         * Load collapse state from IndexedDB
         * @param {string} type - 'group' or 'setting'
         * @param {string} key - Group key or setting ID
         * @returns {Promise<boolean|null>} Collapse state or null if not found
         */
        async loadCollapseState(type, key) {
            try {
                const states = await storage.getJSON('collapse-states', 'settings', {});
                return states[type]?.[key] ?? null;
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to load collapse states:', e);
                return null;
            }
        }

        /**
         * Restore collapse states from IndexedDB
         * @param {HTMLElement} container - Settings container
         */
        async restoreCollapseStates(container) {
            try {
                // Restore group collapse states
                const groups = container.querySelectorAll('.toolasha-settings-group');
                for (const group of groups) {
                    const groupKey = group.dataset.group;
                    const isCollapsed = await this.loadCollapseState('group', groupKey);
                    if (isCollapsed === true) {
                        group.classList.add('collapsed');
                    }
                }

                // Restore setting collapse states
                const settings = container.querySelectorAll('.toolasha-setting');
                for (const setting of settings) {
                    const settingId = setting.dataset.settingId;
                    const isCollapsed = await this.loadCollapseState('setting', settingId);

                    if (isCollapsed === true) {
                        setting.classList.add('dependents-collapsed');

                        // Update collapse icon rotation
                        const collapseIcon = setting.querySelector('.setting-collapse-icon');
                        if (collapseIcon) {
                            collapseIcon.style.transform = 'rotate(-90deg)';
                        }

                        // Hide dependents
                        const allSettings = container.querySelectorAll('.toolasha-setting');
                        const dependents = Array.from(allSettings).filter(s =>
                            s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                        );
                        dependents.forEach(dep => dep.style.display = 'none');
                    }
                }
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to restore collapse states:', e);
            }
        }

        /**
         * Create a single setting UI element
         * @param {string} settingId - Setting ID
         * @param {Object} settingDef - Setting definition
         * @returns {HTMLElement} Setting element
         */
        createSettingElement(settingId, settingDef) {
            const div = document.createElement('div');
            div.className = 'toolasha-setting';
            div.dataset.settingId = settingId;
            div.dataset.type = settingDef.type || 'checkbox';

            // Add dependency class and make parent settings collapsible
            if (settingDef.dependencies && settingDef.dependencies.length > 0) {
                div.classList.add('has-dependency');
                div.dataset.dependencies = settingDef.dependencies.join(',');
            }

            // Add not-implemented class for red text
            if (settingDef.notImplemented) {
                div.classList.add('not-implemented');
            }

            // Create label container (clickable for collapse if has dependents)
            const labelContainer = document.createElement('div');
            labelContainer.className = 'toolasha-setting-label-container';
            labelContainer.style.display = 'flex';
            labelContainer.style.alignItems = 'center';
            labelContainer.style.flex = '1';
            labelContainer.style.gap = '6px';

            // Add collapse icon if this setting has dependents (will be populated by checkDependents)
            const collapseIcon = document.createElement('span');
            collapseIcon.className = 'setting-collapse-icon';
            collapseIcon.textContent = '▼';
            collapseIcon.style.display = 'none'; // Hidden by default, shown if dependents exist
            collapseIcon.style.cursor = 'pointer';
            collapseIcon.style.fontSize = '10px';
            collapseIcon.style.transition = 'transform 0.2s ease';

            // Create label
            const label = document.createElement('span');
            label.className = 'toolasha-setting-label';
            label.textContent = settingDef.label;

            // Add help text if present
            if (settingDef.help) {
                const help = document.createElement('span');
                help.className = 'toolasha-setting-help';
                help.textContent = settingDef.help;
                label.appendChild(help);
            }

            labelContainer.appendChild(collapseIcon);
            labelContainer.appendChild(label);

            // Create input
            const inputHTML = this.generateSettingInput(settingId, settingDef);
            const inputContainer = document.createElement('div');
            inputContainer.className = 'toolasha-setting-input';
            inputContainer.innerHTML = inputHTML;

            div.appendChild(labelContainer);
            div.appendChild(inputContainer);

            return div;
        }

        /**
         * Generate input HTML for a setting
         * @param {string} settingId - Setting ID
         * @param {Object} settingDef - Setting definition
         * @returns {string} Input HTML
         */
        generateSettingInput(settingId, settingDef) {
            const currentSetting = this.currentSettings[settingId];
            const type = settingDef.type || 'checkbox';

            switch (type) {
                case 'checkbox': {
                    const checked = currentSetting?.isTrue ?? settingDef.default ?? false;
                    return `
                    <label class="toolasha-switch">
                        <input type="checkbox" id="${settingId}" ${checked ? 'checked' : ''}>
                        <span class="toolasha-slider"></span>
                    </label>
                `;
                }

                case 'text': {
                    const value = currentSetting?.value ?? settingDef.default ?? '';
                    return `
                    <input type="text"
                        id="${settingId}"
                        class="toolasha-text-input"
                        value="${value}"
                        placeholder="${settingDef.placeholder || ''}">
                `;
                }

                case 'number': {
                    const value = currentSetting?.value ?? settingDef.default ?? 0;
                    return `
                    <input type="number"
                        id="${settingId}"
                        class="toolasha-number-input"
                        value="${value}"
                        min="${settingDef.min ?? ''}"
                        max="${settingDef.max ?? ''}"
                        step="${settingDef.step ?? '1'}">
                `;
                }

                case 'select': {
                    const value = currentSetting?.value ?? settingDef.default ?? '';
                    const options = settingDef.options || [];
                    const optionsHTML = options.map(option => {
                        const optValue = typeof option === 'object' ? option.value : option;
                        const optLabel = typeof option === 'object' ? option.label : option;
                        const selected = optValue === value ? 'selected' : '';
                        return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                    }).join('');

                    return `
                    <select id="${settingId}" class="toolasha-select-input">
                        ${optionsHTML}
                    </select>
                `;
                }

                default:
                    return `<span style="color: red;">Unknown type: ${type}</span>`;
            }
        }

        /**
         * Add utility buttons (Reset, Export, Import)
         * @param {HTMLElement} container - Container element
         */
        addUtilityButtons(container) {
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'toolasha-utility-buttons';

            // Reset button
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset to Defaults';
            resetBtn.className = 'toolasha-utility-button';
            resetBtn.addEventListener('click', () => this.handleReset());

            // Export button
            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Export Settings';
            exportBtn.className = 'toolasha-utility-button';
            exportBtn.addEventListener('click', () => this.handleExport());

            // Import button
            const importBtn = document.createElement('button');
            importBtn.textContent = 'Import Settings';
            importBtn.className = 'toolasha-utility-button';
            importBtn.addEventListener('click', () => this.handleImport());

            buttonsDiv.appendChild(resetBtn);
            buttonsDiv.appendChild(exportBtn);
            buttonsDiv.appendChild(importBtn);

            container.appendChild(buttonsDiv);
        }

        /**
         * Add refresh notice
         * @param {HTMLElement} container - Container element
         */
        addRefreshNotice(container) {
            const notice = document.createElement('div');
            notice.className = 'toolasha-refresh-notice';
            notice.textContent = 'Some settings require a page refresh to take effect';
            container.appendChild(notice);
        }

        /**
         * Setup tab switching functionality
         * @param {HTMLElement} tabButton - Toolasha tab button
         * @param {HTMLElement} tabPanel - Toolasha tab panel
         * @param {HTMLElement[]} existingTabs - Existing tab buttons
         * @param {HTMLElement} tabPanelsContainer - Tab panels container
         */
        setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer) {
            const switchToTab = (targetButton, targetPanel) => {
                // Hide all panels
                const allPanels = tabPanelsContainer.querySelectorAll('[class*="TabPanel_tabPanel"]');
                allPanels.forEach(panel => {
                    panel.style.display = 'none';
                    panel.classList.add('TabPanel_hidden__26UM3');
                });

                // Deactivate all buttons
                const allButtons = document.querySelectorAll('button[role="tab"]');
                allButtons.forEach(btn => {
                    btn.setAttribute('aria-selected', 'false');
                    btn.setAttribute('tabindex', '-1');
                    btn.classList.remove('Mui-selected');
                });

                // Activate target
                targetButton.setAttribute('aria-selected', 'true');
                targetButton.setAttribute('tabindex', '0');
                targetButton.classList.add('Mui-selected');
                targetPanel.style.display = 'block';
                targetPanel.classList.remove('TabPanel_hidden__26UM3');

                // Update title
                const titleEl = document.querySelector('[class*="SettingsPanel_title"]');
                if (titleEl) {
                    if (targetButton.id === 'toolasha-settings-tab') {
                        titleEl.textContent = '⚙️ Toolasha Settings (refresh to apply)';
                    } else {
                        titleEl.textContent = 'Settings';
                    }
                }
            };

            // Click handler for Toolasha tab
            tabButton.addEventListener('click', () => {
                switchToTab(tabButton, tabPanel);
            });

            // Click handlers for existing tabs
            existingTabs.forEach((existingTab, index) => {
                existingTab.addEventListener('click', () => {
                    const correspondingPanel = tabPanelsContainer.children[index];
                    if (correspondingPanel) {
                        switchToTab(existingTab, correspondingPanel);
                    }
                });
            });
        }

        /**
         * Handle setting change
         * @param {Event} event - Change event
         */
        async handleSettingChange(event) {
            const input = event.target;
            if (!input.id) return;

            const settingId = input.id;
            const type = input.closest('.toolasha-setting')?.dataset.type || 'checkbox';

            let value;

            // Get value based on type
            if (type === 'checkbox') {
                value = input.checked;
            } else if (type === 'number') {
                value = parseFloat(input.value) || 0;
            } else {
                value = input.value;
            }

            // Save to storage
            await settingsStorage.setSetting(settingId, value);

            // Update config module (for backward compatibility)
            if (type === 'checkbox') {
                this.config.setSetting(settingId, value);
            } else {
                this.config.setSettingValue(settingId, value);
            }

            // Update dependencies
            this.updateDependencies();
        }

        /**
         * Update dependency states (enable/disable dependent settings)
         */
        updateDependencies() {
            const settings = document.querySelectorAll('.toolasha-setting[data-dependencies]');

            settings.forEach(settingEl => {
                const dependencies = settingEl.dataset.dependencies.split(',');
                let enabled = true;

                // Check if all dependencies are met
                for (const depId of dependencies) {
                    const depInput = document.getElementById(depId);
                    if (depInput && depInput.type === 'checkbox' && !depInput.checked) {
                        enabled = false;
                        break;
                    }
                }

                // Enable or disable
                if (enabled) {
                    settingEl.classList.remove('disabled');
                } else {
                    settingEl.classList.add('disabled');
                }
            });
        }

        /**
         * Handle reset to defaults
         */
        async handleReset() {
            if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
                return;
            }

            await settingsStorage.resetToDefaults();
            await this.config.resetToDefaults();

            alert('Settings reset to defaults. Please refresh the page.');
            window.location.reload();
        }

        /**
         * Handle export settings
         */
        async handleExport() {
            const json = await settingsStorage.exportSettings();

            // Create download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `toolasha-settings-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        /**
         * Handle import settings
         */
        async handleImport() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const success = await settingsStorage.importSettings(text);

                    if (success) {
                        alert('Settings imported successfully. Please refresh the page.');
                        window.location.reload();
                    } else {
                        alert('Failed to import settings. Please check the file format.');
                    }
                } catch (error) {
                    console.error('[Toolasha Settings] Import error:', error);
                    alert('Failed to import settings.');
                }
            });

            input.click();
        }
    }

    // Create and export singleton instance
    const settingsUI = new SettingsUI();

    /**
     * MWI Tools - Main Entry Point
     * Refactored modular version
     */


    /**
     * Detect if running on Combat Simulator page
     * @returns {boolean} True if on Combat Simulator
     */
    function isCombatSimulatorPage() {
        const url = window.location.href;
        // Only work on test Combat Simulator for now
        return url.includes('shykai.github.io/MWICombatSimulatorTest/dist/');
    }

    // === COMBAT SIMULATOR PAGE ===
    if (isCombatSimulatorPage()) {
        // Initialize combat sim integration only
        initialize$1();

        // Skip all other initialization
    } else {
        // === GAME PAGE ===

        // CRITICAL: Install WebSocket hook FIRST, before game connects
        webSocketHook.install();

        // CRITICAL: Start centralized DOM observer SECOND, before features initialize
        domObserver.start();

        // Initialize network alert (must be early, before market features)
        networkAlert.initialize();

        // Start capturing client data from localStorage (for Combat Sim export)
        webSocketHook.captureClientDataFromLocalStorage();

        // Initialize profile export button (always available)
        initialize();

        // Initialize storage and config THIRD (async)
        (async () => {
            try {
                // Initialize storage (opens IndexedDB)
                await storage.initialize();

                // Initialize config (loads settings from storage)
                await config.initialize();

                // Initialize Settings UI (injects tab into game settings panel)
                await settingsUI.initialize().catch(error => {
                    console.error('[Toolasha] Settings UI initialization failed:', error);
                });

                // Add beforeunload handler to flush all pending writes
                window.addEventListener('beforeunload', () => {
                    storage.flushAll();
                });

                // Initialize Data Manager immediately
                // Don't wait for localStorageUtil - it handles missing data gracefully
                dataManager.initialize();
            } catch (error) {
                console.error('[Toolasha] Storage/config initialization failed:', error);
                // Initialize anyway
                dataManager.initialize();
            }
        })();

        dataManager.on('character_initialized', (data) => {
            // Initialize all features using the feature registry
            setTimeout(async () => {
                try {
                    console.log('[Toolasha] Initializing features...');
                    await featureRegistry$1.initializeFeatures();
                    console.log('[Toolasha] Feature initialization complete');

                    // Health check after initialization
                    setTimeout(async () => {
                        const failedFeatures = featureRegistry$1.checkFeatureHealth();

                        // Also check settings tab health
                        const settingsTabExists = document.querySelector('#toolasha-settings-tab');
                        if (!settingsTabExists) {
                            console.warn('[Toolasha] Settings tab not found, retrying settings UI initialization...');
                            try {
                                await settingsUI.initialize();
                            } catch (error) {
                                console.error('[Toolasha] Settings UI retry failed:', error);
                            }
                        }

                        if (failedFeatures.length > 0) {
                            console.warn('[Toolasha] Health check found failed features:', failedFeatures.map(f => f.name));
                            console.log('[Toolasha] Retrying failed features in 3 seconds...');

                            setTimeout(async () => {
                                await featureRegistry$1.retryFailedFeatures(failedFeatures);

                                // Final health check
                                const stillFailed = featureRegistry$1.checkFeatureHealth();
                                if (stillFailed.length > 0) {
                                    console.warn('[Toolasha] These features could not initialize:', stillFailed.map(f => f.name));
                                    console.warn('[Toolasha] Try refreshing the page or reopening the relevant game panels');
                                } else {
                                    console.log('[Toolasha] All features healthy after retry!');
                                }
                            }, 3000);
                        } else {
                            console.log('[Toolasha] All features healthy!');
                        }
                    }, 2000); // Wait 2s after initialization to check health

                } catch (error) {
                    console.error('[Toolasha] Feature initialization failed:', error);
                }
            }, 1000);
        });

        // Expose minimal user-facing API
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        targetWindow.Toolasha = {
            version: '0.4.5',

            // Feature toggle API (for users to manage settings via console)
            features: {
                list: () => config.getFeaturesByCategory(),
                enable: (key) => config.setFeatureEnabled(key, true),
                disable: (key) => config.setFeatureEnabled(key, false),
                toggle: (key) => config.toggleFeature(key),
                status: (key) => config.isFeatureEnabled(key),
                info: (key) => config.getFeatureInfo(key)
            }
        };
    }


    })();

})();
