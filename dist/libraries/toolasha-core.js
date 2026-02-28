/**
 * Toolasha Core Library
 * Core infrastructure and API clients
 * Version: 1.21.0
 * License: CC-BY-NC-SA-4.0
 */

(function () {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

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
            this.dbVersion = 9; // Bumped for xpHistory store
            this.saveDebounceTimers = new Map(); // Per-key debounce timers
            this.pendingWrites = new Map(); // Per-key pending write data: {value, storeName}
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
                    console.error('[Storage] Failed to open IndexedDB', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    // Handle connection being closed unexpectedly (e.g. version upgrade from another tab)
                    this.db.onversionchange = () => {
                        this.db.close();
                        this.db = null;
                        console.warn('[Storage] DB version changed, connection closed. Reload the page.');
                    };
                    resolve();
                };

                request.onblocked = () => {
                    console.warn('[Storage] IndexedDB open blocked by existing connection — retrying after close');
                    // Attempt to close any stale connection and retry once
                    if (this.db) {
                        this.db.close();
                        this.db = null;
                    }
                    const retry = indexedDB.open(this.dbName, this.dbVersion);
                    retry.onerror = () => {
                        console.error('[Storage] Retry failed to open IndexedDB', retry.error);
                        reject(retry.error);
                    };
                    retry.onsuccess = () => {
                        this.db = retry.result;
                        this.db.onversionchange = () => {
                            this.db.close();
                            this.db = null;
                        };
                        resolve();
                    };
                    retry.onupgradeneeded = request.onupgradeneeded;
                    retry.onblocked = () => {
                        console.error('[Storage] IndexedDB still blocked after retry — DB unavailable');
                        reject(new Error('IndexedDB blocked'));
                    };
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

                    // Create dungeonRuns store if it doesn't exist (for dungeon tracker)
                    if (!db.objectStoreNames.contains('dungeonRuns')) {
                        db.createObjectStore('dungeonRuns');
                    }

                    // Create teamRuns store if it doesn't exist (for team-based backfill)
                    if (!db.objectStoreNames.contains('teamRuns')) {
                        db.createObjectStore('teamRuns');
                    }

                    // Create combatExport store if it doesn't exist (for combat sim/milkonomy exports)
                    if (!db.objectStoreNames.contains('combatExport')) {
                        db.createObjectStore('combatExport');
                    }

                    // Create unifiedRuns store if it doesn't exist (for dungeon tracker unified storage)
                    if (!db.objectStoreNames.contains('unifiedRuns')) {
                        db.createObjectStore('unifiedRuns');
                    }

                    // Create marketListings store if it doesn't exist (for estimated listing ages)
                    if (!db.objectStoreNames.contains('marketListings')) {
                        db.createObjectStore('marketListings');
                    }

                    // Create combatStats store if it doesn't exist (for combat statistics feature)
                    if (!db.objectStoreNames.contains('combatStats')) {
                        db.createObjectStore('combatStats');
                    }

                    // Create xpHistory store if it doesn't exist (for XP/hr tracker)
                    if (!db.objectStoreNames.contains('xpHistory')) {
                        db.createObjectStore('xpHistory');
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

            return new Promise((resolve, _reject) => {
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
            return new Promise((resolve, _reject) => {
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

            // Store pending write data
            this.pendingWrites.set(timerKey, { value, storeName });

            // Clear existing timer for this key
            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
            }

            // Return a promise that resolves when save completes
            return new Promise((resolve) => {
                const timer = setTimeout(async () => {
                    const pending = this.pendingWrites.get(timerKey);
                    if (pending) {
                        const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);
                        this.pendingWrites.delete(timerKey);
                        this.saveDebounceTimers.delete(timerKey);
                        resolve(success);
                    } else {
                        resolve(false);
                    }
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

            return new Promise((resolve, _reject) => {
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
         * Get all keys from a store
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<Array<string>>} Array of keys
         */
        async getAllKeys(storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot get keys from store: ${storeName}`);
                return [];
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.getAllKeys();

                    request.onsuccess = () => {
                        resolve(request.result || []);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get all keys from ${storeName}:`, request.error);
                        resolve([]);
                    };
                } catch (error) {
                    console.error(`[Storage] GetAllKeys transaction failed for store ${storeName}:`, error);
                    resolve([]);
                }
            });
        }

        /**
         * Force immediate save of all pending debounced writes
         */
        async flushAll() {
            // Clear all timers first
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();

            // Now execute all pending writes immediately
            const writes = Array.from(this.pendingWrites.entries());
            for (const [timerKey, pending] of writes) {
                // Extract actual key from timerKey (format: "storeName:key")
                const colonIndex = timerKey.indexOf(':');
                const storeName = timerKey.substring(0, colonIndex);
                const key = timerKey.substring(colonIndex + 1); // Handle keys with colons

                await this._saveToIndexedDB(key, pending.value, storeName);
            }
            this.pendingWrites.clear();
        }

        /**
         * Cleanup pending debounced writes without flushing
         */
        cleanupPendingWrites() {
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();
            this.pendingWrites.clear();
        }
    }

    const storage = new Storage();

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
                    default: true,
                },
                chatCommands: {
                    id: 'chatCommands',
                    label: 'Enable chat commands (/item, /wiki, /market)',
                    type: 'checkbox',
                    default: true,
                    help: 'Type /item, /wiki, or /market followed by an item name in chat. Example: /item radiant fiber',
                },
                chat_mentionTracker: {
                    id: 'chat_mentionTracker',
                    label: 'Show badge when mentioned in chat',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a red badge on chat tabs when someone @mentions you',
                },
                chat_popOut: {
                    id: 'chat_popOut',
                    label: 'Enable Pop-out Chat Window button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button to the chat panel to open chat in a separate browser window with multi-channel split view',
                },
                altClickNavigation: {
                    id: 'altClickNavigation',
                    label: 'Alt+click items to navigate to crafting/gathering or dictionary',
                    type: 'checkbox',
                    default: true,
                    help: 'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable',
                },
            },
        },

        actionPanel: {
            title: 'Action Panel Enhancements',
            icon: '⚡',
            settings: {
                totalActionTime: {
                    id: 'totalActionTime',
                    label: 'Top left: Action bar display mode',
                    type: 'select',
                    default: 'full',
                    options: [
                        { value: 'full', label: 'Full Details (all stats + time)' },
                        { value: 'compact', label: 'Compact (all stats, limited width)' },
                        { value: 'minimal', label: 'Minimal (remaining + time only)' },
                    ],
                    help: 'Choose what information to display in the action bar. Full shows all stats, Compact limits width for wide monitors, Minimal shows only remaining actions and time to complete.',
                },
                actionPanel_totalTime: {
                    id: 'actionPanel_totalTime',
                    label: 'Action panel: Total time, times to reach target level, exp/hour',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_totalTime_quickInputs: {
                    id: 'actionPanel_totalTime_quickInputs',
                    label: 'Action panel: Quick input buttons (hours, count presets, Max)',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_foragingTotal: {
                    id: 'actionPanel_foragingTotal',
                    label: 'Action panel: Overall profit for multi-outcome foraging',
                    type: 'checkbox',
                    default: true,
                },
                actionQueue: {
                    id: 'actionQueue',
                    label: 'Queued actions: Show total time and completion time',
                    type: 'checkbox',
                    default: true,
                },
                actionQueue_valueMode: {
                    id: 'actionQueue_valueMode',
                    label: 'Queued actions: Value calculation mode',
                    type: 'select',
                    default: 'profit',
                    options: [
                        { value: 'profit', label: 'Total Profit (revenue - all costs)' },
                        { value: 'estimated_value', label: 'Estimated Value (revenue after tax)' },
                    ],
                    help: 'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).',
                },
                actionPanel_outputTotals: {
                    id: 'actionPanel_outputTotals',
                    label: 'Action panel: Show total expected outputs below per-action outputs',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays calculated totals when you enter a quantity in the action input',
                },
                actionPanel_maxProduceable: {
                    id: 'actionPanel_maxProduceable',
                    label: 'Action panel: Show max produceable count on crafting actions',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays how many items you can make based on current inventory',
                },
                actionPanel_gatheringStats: {
                    id: 'actionPanel_gatheringStats',
                    label: 'Action panel: Show profit/exp per hour on gathering actions',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays profit/hr and exp/hr on gathering tiles (foraging, woodcutting, milking)',
                },
                actionPanel_hideActionStats: {
                    id: 'actionPanel_hideActionStats',
                    label: 'Action panel: Hide all profit/efficiency displays',
                    type: 'checkbox',
                    default: false,
                    help: 'Hides Profitability, Action Speed & Time, and Level Progress sections in gathering, production, and alchemy panels',
                },
                actionPanel_hideNegativeProfit: {
                    id: 'actionPanel_hideNegativeProfit',
                    label: 'Action panel: Hide actions with negative profit',
                    type: 'checkbox',
                    default: false,
                    help: 'Hides action panels that would result in a loss (negative profit/hr)',
                },
                requiredMaterials: {
                    id: 'requiredMaterials',
                    label: 'Action panel: Show total required and missing materials',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays total materials needed and shortfall when entering quantity',
                },
                alchemy_profitDisplay: {
                    id: 'alchemy_profitDisplay',
                    label: 'Alchemy panel: Show profit calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices',
                },
                actions_missingMaterialsButton: {
                    id: 'actions_missingMaterialsButton',
                    label: 'Show "Missing Mats Marketplace" button on production panels',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds button to production panels that opens marketplace with tabs for missing materials',
                },
                actions_missingMaterialsButton_ignoreQueue: {
                    id: 'actions_missingMaterialsButton_ignoreQueue',
                    label: 'Ignore queued actions when calculating missing materials',
                    type: 'checkbox',
                    default: false,
                    help: 'When enabled, missing materials calculation only considers current action request, ignoring materials already reserved by queued actions. Default (off) accounts for queue.',
                },
                lootLogStats: {
                    id: 'lootLogStats',
                    label: 'Loot Log Statistics',
                    type: 'checkbox',
                    default: true,
                    help: 'Display total value, average time, and daily output in loot logs',
                },
                inventoryCountDisplay: {
                    id: 'inventoryCountDisplay',
                    label: 'Action panels: Show current inventory count of output item',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows how many of the output item you currently own, on action tiles and in the action detail panel',
                },
            },
        },

        tooltips: {
            title: 'Item Tooltip Enhancements',
            icon: '💬',
            settings: {
                itemTooltip_prices: {
                    id: 'itemTooltip_prices',
                    label: 'Show 24-hour average market prices',
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_profit: {
                    id: 'itemTooltip_profit',
                    label: 'Show production cost and profit',
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_detailedProfit: {
                    id: 'itemTooltip_detailedProfit',
                    label: 'Show detailed materials breakdown in profit display',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown',
                },
                itemTooltip_multiActionProfit: {
                    id: 'itemTooltip_multiActionProfit',
                    label: 'Show profit comparison for all item actions',
                    type: 'checkbox',
                    default: false,
                    help: 'Displays best profit/hr highlighted, with other profitable actions (craft, coinify, decompose, transmute) summarized below',
                },
                itemTooltip_expectedValue: {
                    id: 'itemTooltip_expectedValue',
                    label: 'Show expected value for openable containers',
                    type: 'checkbox',
                    default: true,
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
                        { value: 'None', label: 'Summary Only' },
                    ],
                },
                expectedValue_respectPricingMode: {
                    id: 'expectedValue_respectPricingMode',
                    label: 'Use pricing mode for expected value calculations',
                    type: 'checkbox',
                    default: true,
                },
                showConsumTips: {
                    id: 'showConsumTips',
                    label: 'HP/MP consumables: Restore speed, cost performance',
                    type: 'checkbox',
                    default: true,
                },
                dungeonTokenTooltips: {
                    id: 'dungeonTokenTooltips',
                    label: 'Dungeon tokens: Show shop items and costs',
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim: {
                    id: 'enhanceSim',
                    label: 'Show enhancement simulator calculations',
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim_showConsumedItemsDetail: {
                    id: 'enhanceSim_showConsumedItemsDetail',
                    label: 'Enhancement tooltips: Show detailed breakdown for consumed items',
                    type: 'checkbox',
                    default: false,
                    help: "When enabled, shows base/materials/protection breakdown for each consumed item in Philosopher's Mirror calculations",
                },
                itemTooltip_gathering: {
                    id: 'itemTooltip_gathering',
                    label: 'Show gathering sources and profit',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows gathering actions that produce this item (foraging, woodcutting, milking)',
                },
                itemTooltip_gatheringRareDrops: {
                    id: 'itemTooltip_gatheringRareDrops',
                    label: 'Show rare drops from gathering',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)',
                },
                itemTooltip_abilityStatus: {
                    id: 'itemTooltip_abilityStatus',
                    label: 'Show ability book status',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows whether ability is learned and current level/progress on ability book tooltips',
                },
            },
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
                    help: 'Most players should use market defaults to see realistic professional enhancer costs',
                },
                enhanceSim_enhancingLevel: {
                    id: 'enhanceSim_enhancingLevel',
                    label: 'Enhancing skill level',
                    type: 'number',
                    default: 140,
                    min: 1,
                    max: 150,
                    help: 'Default: 140 (professional enhancer level)',
                },
                enhanceSim_houseLevel: {
                    id: 'enhanceSim_houseLevel',
                    label: 'Observatory house room level',
                    type: 'number',
                    default: 8,
                    min: 0,
                    max: 8,
                    help: 'Default: 8 (max level)',
                },
                enhanceSim_toolBonus: {
                    id: 'enhanceSim_toolBonus',
                    label: 'Tool success bonus %',
                    type: 'number',
                    default: 6.05,
                    min: 0,
                    max: 30,
                    step: 0.01,
                    help: 'Default: 6.05 (Celestial Enhancer +13)',
                },
                enhanceSim_speedBonus: {
                    id: 'enhanceSim_speedBonus',
                    label: 'Speed bonus %',
                    type: 'number',
                    default: 48.5,
                    min: 0,
                    max: 100,
                    step: 0.1,
                    help: "Default: 48.5 (All enhancing gear +10: Body/Legs/Hands + Philosopher's Necklace)",
                },
                enhanceSim_blessedTea: {
                    id: 'enhanceSim_blessedTea',
                    label: 'Blessed Tea active',
                    type: 'checkbox',
                    default: true,
                    help: 'Professional enhancers use this to reduce attempts',
                },
                enhanceSim_ultraEnhancingTea: {
                    id: 'enhanceSim_ultraEnhancingTea',
                    label: 'Ultra Enhancing Tea active',
                    type: 'checkbox',
                    default: true,
                    help: 'Provides +8 base skill levels (scales with drink concentration)',
                },
                enhanceSim_superEnhancingTea: {
                    id: 'enhanceSim_superEnhancingTea',
                    label: 'Super Enhancing Tea active',
                    type: 'checkbox',
                    default: false,
                    help: 'Provides +6 base skill levels (Ultra is better)',
                },
                enhanceSim_enhancingTea: {
                    id: 'enhanceSim_enhancingTea',
                    label: 'Enhancing Tea active',
                    type: 'checkbox',
                    default: false,
                    help: 'Provides +3 base skill levels (Ultra is better)',
                },
                enhanceSim_drinkConcentration: {
                    id: 'enhanceSim_drinkConcentration',
                    label: 'Drink Concentration %',
                    type: 'number',
                    default: 12.9,
                    min: 0,
                    max: 20,
                    step: 0.1,
                    help: 'Default: 12.9 (Guzzling Pouch +10)',
                },
            },
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
                    help: 'Track enhancement attempts, costs, and statistics',
                },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                    label: 'Show tracker only on Enhancing screen',
                    type: 'checkbox',
                    default: false,
                    help: 'Hide tracker when not on the Enhancing screen',
                },
            },
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
                    help: 'Enhanced items valued by enhancement simulator',
                },
                invWorth: {
                    id: 'invWorth',
                    label: 'Below inventory: Show inventory summary',
                    type: 'checkbox',
                    default: true,
                },
                invSort: {
                    id: 'invSort',
                    label: 'Sort inventory items by value',
                    type: 'checkbox',
                    default: true,
                },
                invSort_showBadges: {
                    id: 'invSort_showBadges',
                    label: 'Show stack value badges when sorting by Ask/Bid',
                    type: 'checkbox',
                    default: false,
                },
                invSort_badgesOnNone: {
                    id: 'invSort_badgesOnNone',
                    label: 'Badge type when "None" sort is selected',
                    type: 'select',
                    default: 'None',
                    options: ['None', 'Ask', 'Bid'],
                },
                invSort_netOfTax: {
                    id: 'invSort_netOfTax',
                    label: 'Show badge values net of market tax',
                    type: 'checkbox',
                    default: false,
                },
                invSort_sortEquipment: {
                    id: 'invSort_sortEquipment',
                    label: 'Enable sorting for Equipment category',
                    type: 'checkbox',
                    default: false,
                },
                invBadgePrices: {
                    id: 'invBadgePrices',
                    label: 'Show price badges on item icons',
                    type: 'checkbox',
                    default: false,
                    help: 'Displays per-item ask or bid price on inventory items',
                },
                profitCalc_pricingMode: {
                    id: 'profitCalc_pricingMode',
                    label: 'Profit calculation pricing mode',
                    type: 'select',
                    default: 'hybrid',
                    options: [
                        { value: 'conservative', label: 'Conservative (Ask/Bid - instant trading)' },
                        { value: 'hybrid', label: 'Hybrid (Ask/Ask - instant buy, patient sell)' },
                        { value: 'optimistic', label: 'Optimistic (Bid/Ask - patient trading)' },
                    ],
                },
                actions_artisanMaterialMode: {
                    id: 'actions_artisanMaterialMode',
                    label: 'Missing materials: Artisan requirement mode',
                    type: 'select',
                    default: 'expected',
                    options: [
                        { value: 'expected', label: 'Expected value (average)' },
                        { value: 'worst-case', label: 'Worst-case per action (ceil per craft)' },
                    ],
                    help: 'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.',
                },
                networth_highEnhancementUseCost: {
                    id: 'networth_highEnhancementUseCost',
                    label: 'Use enhancement cost for highly enhanced items',
                    type: 'checkbox',
                    default: true,
                    help: 'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.',
                },
                networth_highEnhancementMinLevel: {
                    id: 'networth_highEnhancementMinLevel',
                    label: 'Minimum enhancement level to use cost',
                    type: 'select',
                    default: 13,
                    options: [
                        { value: 10, label: '+10 and above' },
                        { value: 11, label: '+11 and above' },
                        { value: 12, label: '+12 and above' },
                        { value: 13, label: '+13 and above (recommended)' },
                        { value: 15, label: '+15 and above' },
                    ],
                    help: 'Enhancement level at which to stop trusting market prices',
                },
                networth_includeCowbells: {
                    id: 'networth_includeCowbells',
                    label: 'Include cowbells in net worth',
                    type: 'checkbox',
                    default: false,
                    help: 'Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price',
                },
                networth_includeTaskTokens: {
                    id: 'networth_includeTaskTokens',
                    label: 'Include task tokens in net worth',
                    type: 'checkbox',
                    default: true,
                    help: 'Value task tokens based on expected value from Task Shop chests. Disable to exclude them from net worth.',
                },
                networth_abilityBooksAsInventory: {
                    id: 'networth_abilityBooksAsInventory',
                    label: 'Count ability books as inventory (Current Assets)',
                    type: 'checkbox',
                    default: false,
                    help: 'Move ability books from Fixed Assets to Current Assets inventory value. Useful if you plan to sell them.',
                },
                autoAllButton: {
                    id: 'autoAllButton',
                    label: 'Auto-click "All" button when opening loot boxes',
                    type: 'checkbox',
                    default: true,
                    help: 'Automatically clicks the "All" button when opening openable containers (crates, chests, caches)',
                },
            },
        },

        skills: {
            title: 'Skills',
            icon: '📚',
            settings: {
                xpTracker: {
                    id: 'xpTracker',
                    label: 'Left sidebar: Show XP/hr rate on skill bars',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays live XP/hr rate under each skill bar in the navigation panel',
                },
                xpTracker_timeTillLevel: {
                    id: 'xpTracker_timeTillLevel',
                    label: 'Skill tooltip: Show time till next level',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows estimated time remaining until the next level in the skill hover tooltip (based on current XP/hr)',
                },
                skillRemainingXP: {
                    id: 'skillRemainingXP',
                    label: 'Left sidebar: Show remaining XP to next level',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays how much XP needed to reach the next level under skill progress bars',
                },
                skillRemainingXP_blackBorder: {
                    id: 'skillRemainingXP_blackBorder',
                    label: 'Remaining XP: Add black text border for better visibility',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a black outline/shadow to the XP text for better readability against progress bars',
                },
                skillbook: {
                    id: 'skillbook',
                    label: 'Skill books: Show books needed to reach target level (in the ability book item dictionary window)',
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        combat: {
            title: 'Combat Features',
            icon: '⚔️',
            settings: {
                combatScore: {
                    id: 'combatScore',
                    label: 'Profile panel: Show gear score',
                    type: 'checkbox',
                    default: true,
                },
                abilitiesTriggers: {
                    id: 'abilitiesTriggers',
                    label: 'Profile panel: Show abilities & triggers',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays equipped abilities, consumables, and their combat triggers below the profile',
                },
                characterCard: {
                    id: 'characterCard',
                    label: 'Profile panel: Show View Card button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds button to open character sheet in external viewer',
                },
                dungeonTracker: {
                    id: 'dungeonTracker',
                    label: 'Dungeon Tracker: Real-time progress tracking',
                    type: 'checkbox',
                    default: true,
                    help: 'Tracks dungeon runs with server-validated duration from party messages',
                },
                dungeonTrackerUI: {
                    id: 'dungeonTrackerUI',
                    label: 'Show Dungeon Tracker UI panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays dungeon progress panel with wave counter, run history, and statistics',
                },
                dungeonTrackerChatAnnotations: {
                    id: 'dungeonTrackerChatAnnotations',
                    label: 'Show run time in party chat',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds colored timer annotations to "Key counts" messages (green if fast, red if slow)',
                },
                combatSummary: {
                    id: 'combatSummary',
                    label: 'Combat Summary: Show detailed statistics on return',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays encounters/hour, revenue, experience rates when returning from combat',
                },
                combatStats: {
                    id: 'combatStats',
                    label: 'Combat Statistics: Show Statistics tab in Combat panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details',
                },
                combatStatsChatMessage: {
                    id: 'combatStatsChatMessage',
                    label: 'Combat Statistics: Chat message format',
                    type: 'template',
                    default: [
                        { type: 'text', value: 'Combat Stats: ' },
                        { type: 'variable', key: '{duration}', label: 'Duration' },
                        { type: 'text', value: ' duration | ' },
                        { type: 'variable', key: '{encountersPerHour}', label: 'Encounters/Hour' },
                        { type: 'text', value: ' EPH | ' },
                        { type: 'variable', key: '{income}', label: 'Total Income' },
                        { type: 'text', value: ' income | ' },
                        { type: 'variable', key: '{dailyIncome}', label: 'Daily Income' },
                        { type: 'text', value: ' income/d | ' },
                        { type: 'variable', key: '{dailyConsumableCosts}', label: 'Daily Consumable Costs' },
                        { type: 'text', value: ' consumables/d | ' },
                        { type: 'variable', key: '{dailyProfit}', label: 'Daily Profit' },
                        { type: 'text', value: ' profit/d | ' },
                        { type: 'variable', key: '{exp}', label: 'EXP/Hour' },
                        { type: 'text', value: ' exp/h | ' },
                        { type: 'variable', key: '{deathCount}', label: 'Deaths' },
                        { type: 'text', value: ' deaths' },
                    ],
                    help: 'Message format when Ctrl+clicking player card in Statistics. Click "Edit Template" to customize.',
                    templateVariables: [
                        { key: '{duration}', label: 'Duration', description: 'Combat session duration' },
                        { key: '{encountersPerHour}', label: 'Encounters/Hour', description: 'Encounters per hour (EPH)' },
                        { key: '{income}', label: 'Total Income', description: 'Total income from combat' },
                        { key: '{dailyIncome}', label: 'Daily Income', description: 'Income per day' },
                        {
                            key: '{dailyConsumableCosts}',
                            label: 'Daily Consumable Costs',
                            description: 'Consumable costs per day',
                        },
                        { key: '{dailyProfit}', label: 'Daily Profit', description: 'Profit per day' },
                        { key: '{exp}', label: 'EXP/Hour', description: 'Experience per hour' },
                        { key: '{deathCount}', label: 'Deaths', description: 'Number of deaths' },
                    ],
                },
            },
        },

        tasks: {
            title: 'Tasks',
            icon: '📋',
            settings: {
                taskProfitCalculator: {
                    id: 'taskProfitCalculator',
                    label: 'Show total profit for gathering/production tasks',
                    type: 'checkbox',
                    default: true,
                },
                taskEfficiencyRating: {
                    id: 'taskEfficiencyRating',
                    label: 'Show task efficiency rating (tokens/profit per hour)',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a color-graded efficiency score based on expected completion time.',
                },
                taskEfficiencyRatingMode: {
                    id: 'taskEfficiencyRatingMode',
                    label: 'Efficiency algorithm',
                    type: 'select',
                    default: 'gold',
                    options: [
                        { value: 'tokens', label: 'Task tokens per hour' },
                        { value: 'gold', label: 'Task profit per hour' },
                    ],
                    help: 'Choose whether to rate by task token payout or total profit.',
                },
                taskEfficiencyGradient: {
                    id: 'taskEfficiencyGradient',
                    label: 'Use relative gradient colors',
                    type: 'checkbox',
                    default: false,
                    help: 'Colors efficiency ratings relative to visible tasks.',
                },
                taskRerollTracker: {
                    id: 'taskRerollTracker',
                    label: 'Track task reroll costs',
                    type: 'checkbox',
                    default: true,
                    help: 'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)',
                },
                taskMapIndex: {
                    id: 'taskMapIndex',
                    label: 'Show combat zone index numbers on tasks',
                    type: 'checkbox',
                    default: true,
                },
                taskIcons: {
                    id: 'taskIcons',
                    label: 'Show visual icons on task cards',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays semi-transparent item/monster icons on task cards',
                },
                taskIconsDungeons: {
                    id: 'taskIconsDungeons',
                    label: 'Show dungeon icons on combat tasks',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows which dungeons contain the monster (requires Task Icons enabled)',
                },
                taskSorter_autoSort: {
                    id: 'taskSorter_autoSort',
                    label: 'Automatically sort tasks when opening task panel',
                    type: 'checkbox',
                    default: false,
                    help: 'Automatically sorts tasks by skill type when you open the task panel',
                },
                taskSorter_sortMode: {
                    id: 'taskSorter_sortMode',
                    label: 'Task sort mode',
                    type: 'select',
                    default: 'skill',
                    options: [
                        { value: 'skill', label: 'Skill / Zone' },
                        { value: 'time', label: 'Time to Completion' },
                    ],
                    help: 'How tasks are ordered when clicking Sort Tasks. "Time to Completion" sorts fastest tasks first; combat and completed tasks go to the bottom.',
                },
                taskInventoryHighlighter: {
                    id: 'taskInventoryHighlighter',
                    label: 'Enable Task Inventory Highlighter button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button to dim inventory items not needed for your current non-combat tasks',
                },
                taskStatistics: {
                    id: 'taskStatistics',
                    label: 'Show task statistics button on Tasks panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Statistics button to the Tasks panel showing overflow time, expected rewards, and completion estimates',
                },
            },
        },

        ui: {
            title: 'UI Enhancements',
            icon: '🎨',
            settings: {
                formatting_useKMBFormat: {
                    id: 'formatting_useKMBFormat',
                    label: 'Use K/M/B number formatting (e.g., 1.5M instead of 1,500,000)',
                    type: 'checkbox',
                    default: true,
                    help: 'Applies to tooltips, action panels, profit displays, and all number formatting throughout the UI',
                },
                ui_externalLinks: {
                    id: 'ui_externalLinks',
                    label: 'Left sidebar: Show external tool links',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy',
                },
                expPercentage: {
                    id: 'expPercentage',
                    label: 'Left sidebar: Show skill XP percentages',
                    type: 'checkbox',
                    default: true,
                },
                itemIconLevel: {
                    id: 'itemIconLevel',
                    label: 'Bottom left corner of icons: Show equipment level',
                    type: 'checkbox',
                    default: true,
                },
                loadoutEnhancementDisplay: {
                    id: 'loadoutEnhancementDisplay',
                    label: 'Loadout panel: Show highest-owned enhancement level on equipment icons',
                    type: 'checkbox',
                    default: true,
                },
                showsKeyInfoInIcon: {
                    id: 'showsKeyInfoInIcon',
                    label: 'Bottom left corner of key icons: Show zone index',
                    type: 'checkbox',
                    default: true,
                },
                mapIndex: {
                    id: 'mapIndex',
                    label: 'Combat zones: Show zone index numbers',
                    type: 'checkbox',
                    default: true,
                },
                alchemyItemDimming: {
                    id: 'alchemyItemDimming',
                    label: 'Alchemy panel: Dim items requiring higher level',
                    type: 'checkbox',
                    default: true,
                },
                marketFilter: {
                    id: 'marketFilter',
                    label: 'Marketplace: Filter by level, class, slot',
                    type: 'checkbox',
                    default: true,
                },
                marketSort: {
                    id: 'marketSort',
                    label: 'Marketplace: Sort items by profitability',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button to sort marketplace items by profit/hour. Items without profit data (drop-only) appear at the end.',
                },
                fillMarketOrderPrice: {
                    id: 'fillMarketOrderPrice',
                    label: 'Auto-fill marketplace orders with optimal price',
                    type: 'checkbox',
                    default: true,
                },
                market_autoFillSellStrategy: {
                    id: 'market_autoFillSellStrategy',
                    label: 'Auto-fill sell price strategy',
                    type: 'select',
                    default: 'match',
                    options: [
                        { value: 'match', label: 'Match best sell price' },
                        { value: 'undercut', label: 'Undercut by 1 (best sell - 1)' },
                    ],
                    help: 'When creating sell listings, choose whether to match or undercut the current best sell price',
                },
                market_autoClickMax: {
                    id: 'market_autoClickMax',
                    label: 'Auto-click Max button on sell listing dialogs',
                    type: 'checkbox',
                    default: true,
                    help: 'Automatically clicks the Max button in the quantity field when opening Sell listing dialogs',
                },
                market_visibleItemCount: {
                    id: 'market_visibleItemCount',
                    label: 'Market: Show inventory count on items',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays how many of each item you own when browsing the market',
                },
                market_visibleItemCountOpacity: {
                    id: 'market_visibleItemCountOpacity',
                    label: 'Market: Opacity for items not in inventory',
                    type: 'slider',
                    default: 0.25,
                    min: 0,
                    max: 1,
                    step: 0.05,
                    help: 'How transparent item tiles appear when you own zero of that item',
                },
                market_visibleItemCountIncludeEquipped: {
                    id: 'market_visibleItemCountIncludeEquipped',
                    label: 'Market: Count equipped items',
                    type: 'checkbox',
                    default: true,
                    help: 'Include currently equipped items in the displayed count',
                },
                market_showListingPrices: {
                    id: 'market_showListingPrices',
                    label: 'Market: Show prices on individual listings',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays top order price and total value on each listing in My Listings table',
                },
                market_tradeHistory: {
                    id: 'market_tradeHistory',
                    label: 'Market: Show personal trade history',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays your last buy/sell prices for items in marketplace',
                },
                market_tradeHistoryComparisonMode: {
                    id: 'market_tradeHistoryComparisonMode',
                    label: 'Market: Trade history comparison mode',
                    type: 'select',
                    default: 'instant',
                    options: [
                        { value: 'instant', label: 'Instant' },
                        { value: 'listing', label: 'Orders' },
                    ],
                    help: 'Instant: Compare to instant buy/sell prices. Orders: Compare to buy/sell orders.',
                },
                market_listingPricePrecision: {
                    id: 'market_listingPricePrecision',
                    label: 'Market: Listing price decimal precision',
                    type: 'number',
                    default: 2,
                    min: 0,
                    max: 4,
                    help: 'Number of decimal places to show for listing prices',
                },
                market_showListingAge: {
                    id: 'market_showListingAge',
                    label: 'Market: Show listing age on My Listings',
                    type: 'checkbox',
                    default: false,
                    help: 'Display how long ago each listing was created on the My Listings tab (e.g., "3h 45m")',
                },
                market_showTopOrderAge: {
                    id: 'market_showTopOrderAge',
                    label: 'Market: Show top order age on My Listings',
                    type: 'checkbox',
                    default: false,
                    help: 'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)',
                },
                market_showEstimatedListingAge: {
                    id: 'market_showEstimatedListingAge',
                    label: 'Market: Show estimated age on order book',
                    type: 'checkbox',
                    default: true,
                    help: 'Estimates creation time for all market listings using listing ID interpolation',
                },
                market_listingAgeFormat: {
                    id: 'market_listingAgeFormat',
                    label: 'Market: Listing age display format',
                    type: 'select',
                    default: 'datetime',
                    options: [
                        { value: 'elapsed', label: 'Elapsed Time (e.g., "3h 45m")' },
                        { value: 'datetime', label: 'Date/Time (e.g., "01-13 14:30")' },
                    ],
                    help: 'Choose how to display listing creation times',
                },
                market_listingTimeFormat: {
                    id: 'market_listingTimeFormat',
                    label: 'Market: Time format for date/time display',
                    type: 'select',
                    default: '24hour',
                    options: [
                        { value: '24hour', label: '24-hour (14:30)' },
                        { value: '12hour', label: '12-hour (2:30 PM)' },
                    ],
                    help: 'Time format when using Date/Time display (only applies if Date/Time format is selected)',
                },
                market_listingDateFormat: {
                    id: 'market_listingDateFormat',
                    label: 'Market: Date format for date/time display',
                    type: 'select',
                    default: 'MM-DD',
                    options: [
                        { value: 'MM-DD', label: 'MM-DD (01-13)' },
                        { value: 'DD-MM', label: 'DD-MM (13-01)' },
                    ],
                    help: 'Date format when using Date/Time display (only applies if Date/Time format is selected)',
                },
                market_showOrderTotals: {
                    id: 'market_showOrderTotals',
                    label: 'Market: Show order totals in header',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold',
                },
                market_showHistoryViewer: {
                    id: 'market_showHistoryViewer',
                    label: 'Market: Show history viewer button in settings',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds "View Market History" button to settings panel for viewing and exporting all market listing history',
                },
                market_showPhiloCalculator: {
                    id: 'market_showPhiloCalculator',
                    label: 'Market: Show Philo Gamba calculator button in settings',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds "Philo Gamba" button to settings panel for calculating transmutation ROI into Philosopher\'s Stones',
                },
                market_showQueueLength: {
                    id: 'market_showQueueLength',
                    label: 'Market: Show queue length estimates',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays total quantity at best price below Buy/Sell buttons. Estimated values (20+ orders at same price) are shown in a different color.',
                },
                itemDictionary_transmuteRates: {
                    id: 'itemDictionary_transmuteRates',
                    label: 'Item Dictionary: Show transmutation success rates',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays success rate percentages in the "Transmuted From (Alchemy)" section',
                },
                itemDictionary_transmuteIncludeBaseRate: {
                    id: 'itemDictionary_transmuteIncludeBaseRate',
                    label: 'Item Dictionary: Include base success rate in transmutation percentages',
                    type: 'checkbox',
                    default: true,
                    help: 'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching "Transmutes Into" section)',
                },
            },
        },

        house: {
            title: 'House',
            icon: '🏠',
            settings: {
                houseUpgradeCosts: {
                    id: 'houseUpgradeCosts',
                    label: 'Show upgrade costs with market prices and inventory comparison',
                    type: 'checkbox',
                    default: true,
                },
            },
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
                    help: 'Only works when the game page is open',
                },
            },
        },

        colors: {
            title: 'Color Customization',
            icon: '🎨',
            settings: {
                color_profit: {
                    id: 'color_profit',
                    label: 'Profit/Positive Values',
                    type: 'color',
                    default: '#047857',
                    help: 'Color used for profit, gains, and positive values',
                },
                color_loss: {
                    id: 'color_loss',
                    label: 'Loss/Negative Values',
                    type: 'color',
                    default: '#f87171',
                    help: 'Color used for losses, costs, and negative values',
                },
                color_warning: {
                    id: 'color_warning',
                    label: 'Warnings',
                    type: 'color',
                    default: '#ffa500',
                    help: 'Color used for warnings and important notices',
                },
                color_info: {
                    id: 'color_info',
                    label: 'Informational',
                    type: 'color',
                    default: '#60a5fa',
                    help: 'Color used for informational text and highlights',
                },
                color_essence: {
                    id: 'color_essence',
                    label: 'Essences',
                    type: 'color',
                    default: '#c084fc',
                    help: 'Color used for essence drops and essence-related text',
                },
                color_tooltip_profit: {
                    id: 'color_tooltip_profit',
                    label: 'Tooltip Profit/Positive',
                    type: 'color',
                    default: '#047857',
                    help: 'Color for profit/positive values in tooltips (light backgrounds)',
                },
                color_tooltip_loss: {
                    id: 'color_tooltip_loss',
                    label: 'Tooltip Loss/Negative',
                    type: 'color',
                    default: '#dc2626',
                    help: 'Color for loss/negative values in tooltips (light backgrounds)',
                },
                color_tooltip_info: {
                    id: 'color_tooltip_info',
                    label: 'Tooltip Informational',
                    type: 'color',
                    default: '#2563eb',
                    help: 'Color for informational text in tooltips (light backgrounds)',
                },
                color_tooltip_warning: {
                    id: 'color_tooltip_warning',
                    label: 'Tooltip Warnings',
                    type: 'color',
                    default: '#ea580c',
                    help: 'Color for warnings in tooltips (light backgrounds)',
                },
                color_text_primary: {
                    id: 'color_text_primary',
                    label: 'Primary Text',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Main text color',
                },
                color_text_secondary: {
                    id: 'color_text_secondary',
                    label: 'Secondary Text',
                    type: 'color',
                    default: '#888888',
                    help: 'Dimmed/secondary text color',
                },
                color_border: {
                    id: 'color_border',
                    label: 'Borders',
                    type: 'color',
                    default: '#444444',
                    help: 'Border and separator color',
                },
                color_gold: {
                    id: 'color_gold',
                    label: 'Gold/Currency',
                    type: 'color',
                    default: '#ffa500',
                    help: 'Color used for gold and currency displays',
                },
                color_accent: {
                    id: 'color_accent',
                    label: 'Script Accent Color',
                    type: 'color',
                    default: '#22c55e',
                    help: 'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)',
                },
                color_remaining_xp: {
                    id: 'color_remaining_xp',
                    label: 'Remaining XP Text',
                    type: 'color',
                    default: '#FFFFFF',
                    help: 'Color for remaining XP text below skill bars in left navigation',
                },
                color_xp_rate: {
                    id: 'color_xp_rate',
                    label: 'XP/hr Rate Text',
                    type: 'color',
                    default: '#ffffff',
                },
                color_inv_count: {
                    id: 'color_inv_count',
                    label: 'Inventory Count Text',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color for inventory count shown on action tiles and in the action detail panel',
                },
                color_invBadge_ask: {
                    id: 'color_invBadge_ask',
                    label: 'Inventory Badge: Ask Price',
                    type: 'color',
                    default: '#047857',
                    help: 'Color for Ask price badges on inventory items (seller asking price - better selling value)',
                },
                color_invBadge_bid: {
                    id: 'color_invBadge_bid',
                    label: 'Inventory Badge: Bid Price',
                    type: 'color',
                    default: '#60a5fa',
                    help: 'Color for Bid price badges on inventory items (buyer bid price - instant-sell value)',
                },
                color_transmute: {
                    id: 'color_transmute',
                    label: 'Transmutation Rates',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color used for transmutation success rate percentages in Item Dictionary',
                },
                color_queueLength_known: {
                    id: 'color_queueLength_known',
                    label: 'Queue Length: Known Value',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color for known queue lengths (when all visible orders are counted)',
                },
                color_queueLength_estimated: {
                    id: 'color_queueLength_estimated',
                    label: 'Queue Length: Estimated Value',
                    type: 'color',
                    default: '#60a5fa',
                    help: 'Color for estimated queue lengths (extrapolated from 20+ orders at same price)',
                },
            },
        },
    };

    /**
     * Settings Storage Module
     * Handles persistence of settings to chrome.storage.local
     */


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

    /**
     * Profile Cache Module
     * Stores current profile in memory for Steam users
     */

    // Module-level variable to hold current profile in memory
    let currentProfileCache = null;

    /**
     * Set current profile in memory
     * @param {Object} profileData - Profile data from profile_shared message
     */
    function setCurrentProfile(profileData) {
        currentProfileCache = profileData;
    }

    /**
     * Get current profile from memory
     * @returns {Object|null} Current profile or null
     */
    function getCurrentProfile() {
        return currentProfileCache;
    }

    /**
     * Clear current profile from memory
     */
    function clearCurrentProfile() {
        currentProfileCache = null;
    }

    /**
     * WebSocket Hook Module
     * Intercepts WebSocket messages from the MWI game server
     *
     * Uses WebSocket constructor wrapper for better performance than MessageEvent.prototype.data hooking
     */


    class WebSocketHook {
        constructor() {
            this.isHooked = false;
            this.messageHandlers = new Map();
            this.socketEventHandlers = new Map();
            this.attachedSockets = new WeakSet();
            /**
             * Track processed message events to avoid duplicate handling when multiple hooks fire.
             *
             * We intercept messages through three paths:
             * 1) MessageEvent.prototype.data getter
             * 2) WebSocket.prototype addEventListener/onmessage wrappers
             * 3) Direct socket listeners in attachSocketListeners
             */
            this.processedMessageEvents = new WeakSet();

            /**
             * Track processed messages by content hash to prevent duplicate JSON.parse
             * Uses message content (first 100 chars) as key since same message can have different event objects
             */
            this.processedMessages = new Map(); // message hash -> timestamp
            this.recentActionCompleted = new Map(); // message content -> timestamp (50ms TTL dedup)
            this.messageCleanupInterval = null;
            this.isSocketWrapped = false;
            this.originalWebSocket = null;
            this.currentWebSocket = null;
            // Detect if userscript manager is present (Tampermonkey, Greasemonkey, etc.)
            this.hasScriptManager = typeof GM_info !== 'undefined';
            this.clientDataRetryTimeout = null;
        }

        /**
         * Save combat sim export data to appropriate storage
         * Only saves if script manager is available (cross-domain sharing with Combat Sim)
         * @param {string} key - Storage key
         * @param {string} value - Value to save (JSON string)
         */
        async saveToStorage(key, value) {
            if (this.hasScriptManager) {
                // Tampermonkey: use GM storage for cross-domain sharing with Combat Sim
                // Wrap in setTimeout to make async and prevent main thread blocking
                setTimeout(() => {
                    try {
                        GM_setValue(key, value);
                    } catch (error) {
                        console.error('[WebSocket] Failed to save to GM storage:', error);
                    }
                }, 0);
            }
            // Steam/standalone: Skip saving - Combat Sim import not possible without cross-domain storage
        }

        /**
         * Load combat sim export data from appropriate storage
         * Only loads if script manager is available
         * @param {string} key - Storage key
         * @param {string} defaultValue - Default value if not found
         * @returns {string|null} Stored value or default
         */
        async loadFromStorage(key, defaultValue = null) {
            if (this.hasScriptManager) {
                // Tampermonkey: use GM storage
                return GM_getValue(key, defaultValue);
            }
            // Steam/standalone: No data available (Combat Sim import requires script manager)
            return defaultValue;
        }

        /**
         * Install the WebSocket hook
         * MUST be called before WebSocket connection is established
         * Uses MessageEvent.prototype.data hook (same method as MWI Tools)
         */
        install() {
            if (this.isHooked) {
                console.warn('[WebSocket Hook] Already installed');
                return;
            }

            this.wrapWebSocketConstructor();
            this.wrapWebSocketPrototype();

            // Capture hook instance for closure
            const hookInstance = this;

            // Hook MessageEvent.prototype.data (same as MWI Tools)
            const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
            const originalGet = dataProperty.get;

            dataProperty.get = function hookedGet() {
                const socket = this.currentTarget;

                // Only hook WebSocket messages
                if (!(socket instanceof WebSocket)) {
                    return originalGet.call(this);
                }

                // Only hook MWI game server
                if (!hookInstance.isGameSocket(socket)) {
                    return originalGet.call(this);
                }

                hookInstance.attachSocketListeners(socket);

                const message = originalGet.call(this);

                // Anti-loop: define data property so we don't hook our own access
                Object.defineProperty(this, 'data', { value: message });

                // Process message in our hook
                hookInstance.markMessageEventProcessed(this);
                hookInstance.processMessage(message);

                return message;
            };

            Object.defineProperty(MessageEvent.prototype, 'data', dataProperty);

            this.isHooked = true;
        }

        /**
         * Wrap WebSocket prototype handlers to intercept message events
         */
        wrapWebSocketPrototype() {
            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket || !targetWindow.WebSocket.prototype) {
                return;
            }

            const hookInstance = this;
            const proto = targetWindow.WebSocket.prototype;

            if (!proto.__toolashaPatched) {
                const originalAddEventListener = proto.addEventListener;
                proto.addEventListener = function toolashaAddEventListener(type, listener, options) {
                    if (type === 'message' && typeof listener === 'function') {
                        const wrappedListener = function toolashaMessageListener(event) {
                            if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                hookInstance.markMessageEventProcessed(event);
                                hookInstance.processMessage(event.data);
                            }
                            return listener.call(this, event);
                        };

                        wrappedListener.__toolashaOriginal = listener;
                        return originalAddEventListener.call(this, type, wrappedListener, options);
                    }

                    return originalAddEventListener.call(this, type, listener, options);
                };

                const originalOnMessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
                if (originalOnMessage && originalOnMessage.set) {
                    Object.defineProperty(proto, 'onmessage', {
                        configurable: true,
                        get: originalOnMessage.get,
                        set(handler) {
                            if (typeof handler !== 'function') {
                                return originalOnMessage.set.call(this, handler);
                            }

                            const wrappedHandler = function toolashaOnMessage(event) {
                                if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                    hookInstance.markMessageEventProcessed(event);
                                    hookInstance.processMessage(event.data);
                                }
                                return handler.call(this, event);
                            };

                            wrappedHandler.__toolashaOriginal = handler;
                            return originalOnMessage.set.call(this, wrappedHandler);
                        },
                    });
                }

                proto.__toolashaPatched = true;
            }
        }

        /**
         * Check if a WebSocket instance belongs to the game server
         * @param {WebSocket} socket - WebSocket instance
         * @returns {boolean} True if game socket
         */
        isGameSocket(socket) {
            if (!socket || !socket.url) {
                return false;
            }

            return (
                socket.url.indexOf('api.milkywayidle.com/ws') !== -1 ||
                socket.url.indexOf('api-test.milkywayidle.com/ws') !== -1
            );
        }

        /**
         * Wrap the WebSocket constructor to attach lifecycle listeners
         */
        wrapWebSocketConstructor() {
            if (this.isSocketWrapped) {
                return;
            }

            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket) {
                return;
            }

            const hookInstance = this;

            const wrapConstructor = (OriginalWebSocket) => {
                if (!OriginalWebSocket || OriginalWebSocket.__toolashaWrapped) {
                    hookInstance.currentWebSocket = OriginalWebSocket;
                    return;
                }

                class ToolashaWebSocket extends OriginalWebSocket {
                    constructor(...args) {
                        super(...args);
                        hookInstance.attachSocketListeners(this);
                    }
                }

                ToolashaWebSocket.__toolashaWrapped = true;
                ToolashaWebSocket.__toolashaOriginal = OriginalWebSocket;

                hookInstance.originalWebSocket = OriginalWebSocket;
                hookInstance.currentWebSocket = ToolashaWebSocket;
            };

            wrapConstructor(targetWindow.WebSocket);

            Object.defineProperty(targetWindow, 'WebSocket', {
                configurable: true,
                get() {
                    return hookInstance.currentWebSocket;
                },
                set(nextWebSocket) {
                    wrapConstructor(nextWebSocket);
                },
            });
            this.isSocketWrapped = true;
        }

        /**
         * Attach lifecycle listeners to a socket
         * @param {WebSocket} socket - WebSocket instance
         */
        attachSocketListeners(socket) {
            if (!this.isGameSocket(socket)) {
                return;
            }

            if (this.attachedSockets.has(socket)) {
                return;
            }

            this.attachedSockets.add(socket);

            const events = ['open', 'close', 'error'];
            for (const eventName of events) {
                socket.addEventListener(eventName, (event) => {
                    this.emitSocketEvent(eventName, event, socket);
                });
            }

            socket.addEventListener('message', (event) => {
                if (this.isMessageEventProcessed(event)) {
                    return;
                }

                if (!event || typeof event.data !== 'string') {
                    return;
                }

                this.markMessageEventProcessed(event);
                this.processMessage(event.data);
            });
        }

        isMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return false;
            }

            return this.processedMessageEvents.has(event);
        }

        markMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return;
            }

            this.processedMessageEvents.add(event);
        }

        /**
         * Process intercepted message
         * @param {string} message - JSON string from WebSocket
         */
        processMessage(message) {
            // Parse message type first to determine deduplication strategy
            let messageType;
            try {
                // Quick parse to get type (avoid full parse for duplicates)
                const typeMatch = message.match(/"type":"([^"]+)"/);
                messageType = typeMatch ? typeMatch[1] : null;
            } catch {
                // If regex fails, skip deduplication and process normally
                messageType = null;
            }

            // Skip deduplication for events where consecutive messages have similar first 100 chars
            // but contain different data (counts, timestamps, etc. beyond the 100-char hash window)
            // OR events that should always trigger UI updates (profile_shared, battle_unit_fetched)
            const skipDedup =
                messageType === 'quests_updated' ||
                messageType === 'action_completed' ||
                messageType === 'items_updated' ||
                messageType === 'market_item_order_books_updated' ||
                messageType === 'market_listings_updated' ||
                messageType === 'profile_shared' ||
                messageType === 'battle_consumable_ability_updated' ||
                messageType === 'battle_unit_fetched' ||
                messageType === 'action_type_consumable_slots_updated' ||
                messageType === 'consumable_buffs_updated' ||
                messageType === 'character_info_updated';

            if (!skipDedup) {
                // Deduplicate by message content to prevent 4x JSON.parse on same message
                // Use first 100 chars as hash (contains type + timestamp, unique enough)
                const messageHash = message.substring(0, 100);

                if (this.processedMessages.has(messageHash)) {
                    return; // Already processed this message, skip
                }

                this.processedMessages.set(messageHash, Date.now());

                // Cleanup old entries every 100 messages to prevent memory leak
                if (this.processedMessages.size > 100) {
                    this.cleanupProcessedMessages();
                }
            } else if (messageType === 'action_completed') {
                // action_completed bypasses the content-hash dedup (Gabriel's fix, commit 1007215)
                // but the WebSocket prototype wrapper can fire two listeners for the same physical
                // message object. The WeakSet guard catches same-object duplicates, but if two
                // independent listeners each receive a distinct MessageEvent wrapping the same
                // payload, both pass the WeakSet check and processMessage is called twice.
                // Use a short 50ms TTL keyed on full message content to collapse these duplicates.
                // Two genuine consecutive action_completed messages are always seconds apart.
                const now = Date.now();
                if (this.recentActionCompleted.has(message)) {
                    return; // Duplicate from second listener — skip
                }
                this.recentActionCompleted.set(message, now);
                // Prune entries older than 50ms to keep memory bounded
                for (const [key, ts] of this.recentActionCompleted) {
                    if (now - ts > 50) {
                        this.recentActionCompleted.delete(key);
                    }
                }
            }

            try {
                const data = JSON.parse(message);
                const parsedMessageType = data.type;

                // Save critical data to GM storage for Combat Sim export
                this.saveCombatSimData(parsedMessageType, message);

                // Call registered handlers for this message type
                const handlers = this.messageHandlers.get(parsedMessageType) || [];

                for (const handler of handlers) {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${parsedMessageType}:`, error);
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
        async saveCombatSimData(messageType, message) {
            try {
                // Save full character data (on login/refresh)
                if (messageType === 'init_character_data') {
                    await this.saveToStorage('toolasha_init_character_data', message);
                }

                // Save client data (for ability special detection)
                if (messageType === 'init_client_data') {
                    await this.saveToStorage('toolasha_init_client_data', message);
                }

                // Save battle data including party members (on combat start)
                if (messageType === 'new_battle') {
                    await this.saveToStorage('toolasha_new_battle', message);
                }

                // Save profile shares (when opening party member profiles)
                if (messageType === 'profile_shared') {
                    const parsed = JSON.parse(message);

                    // Extract character info - try multiple sources for ID
                    parsed.characterID =
                        parsed.profile.sharableCharacter?.id ||
                        parsed.profile.characterSkills?.[0]?.characterID ||
                        parsed.profile.character?.id;
                    parsed.characterName = parsed.profile.sharableCharacter?.name || 'Unknown';
                    parsed.timestamp = Date.now();

                    // Validate we got a character ID
                    if (!parsed.characterID) {
                        console.error('[Toolasha] Failed to extract characterID from profile:', parsed);
                        return;
                    }

                    // Store in memory for Steam users (works without GM storage)
                    setCurrentProfile(parsed);

                    // Load existing profile list from GM storage (cross-origin accessible)
                    const profileListJson = await this.loadFromStorage('toolasha_profile_list', '[]');
                    let profileList = JSON.parse(profileListJson);

                    // Remove old entry for same character
                    profileList = profileList.filter((p) => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    // Save updated profile list to GM storage (matches pattern of other combat sim data)
                    await this.saveToStorage('toolasha_profile_list', JSON.stringify(profileList));
                }
            } catch (error) {
                console.error('[WebSocket] Failed to save Combat Sim data:', error);
            }
        }

        /**
         * Capture init_client_data from localStorage (fallback method)
         * Called periodically since it may not come through WebSocket
         * Uses official game API to avoid manual decompression
         */
        async captureClientDataFromLocalStorage() {
            try {
                // Use official game API instead of manual localStorage access
                if (typeof localStorageUtil === 'undefined' || typeof localStorageUtil.getInitClientData !== 'function') {
                    // API not ready yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // API returns parsed object and handles decompression automatically
                const clientDataObj = localStorageUtil.getInitClientData();
                if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
                    // Data not available yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // Verify it's init_client_data
                if (clientDataObj?.type === 'init_client_data') {
                    // Save as JSON string for Combat Sim export
                    const clientDataStr = JSON.stringify(clientDataObj);
                    await this.saveToStorage('toolasha_init_client_data', clientDataStr);
                    console.log('[Toolasha] Client data captured from localStorage via official API');
                    this.clearClientDataRetry();
                }
            } catch (error) {
                console.error('[WebSocket] Failed to capture client data from localStorage:', error);
                // Retry on error
                this.scheduleClientDataRetry();
            }
        }

        /**
         * Schedule a retry for client data capture
         */
        scheduleClientDataRetry() {
            this.clearClientDataRetry();
            this.clientDataRetryTimeout = setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }

        /**
         * Clear any pending client data retry
         */
        clearClientDataRetry() {
            if (this.clientDataRetryTimeout) {
                clearTimeout(this.clientDataRetryTimeout);
                this.clientDataRetryTimeout = null;
            }
        }

        /**
         * Cleanup old processed message entries (keep last 50, remove rest)
         */
        cleanupProcessedMessages() {
            const entries = Array.from(this.processedMessages.entries());
            // Sort by timestamp, keep newest 50
            entries.sort((a, b) => b[1] - a[1]);

            this.processedMessages.clear();
            for (let i = 0; i < Math.min(50, entries.length); i++) {
                this.processedMessages.set(entries[i][0], entries[i][1]);
            }
        }

        /**
         * Cleanup any pending retry timeouts
         */
        cleanup() {
            this.clearClientDataRetry();
            this.processedMessages.clear();
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
         * Register a handler for WebSocket lifecycle events
         * @param {string} eventType - Event type (open, close, error)
         * @param {Function} handler - Handler function
         */
        onSocketEvent(eventType, handler) {
            if (!this.socketEventHandlers.has(eventType)) {
                this.socketEventHandlers.set(eventType, []);
            }
            this.socketEventHandlers.get(eventType).push(handler);
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

        /**
         * Unregister a WebSocket lifecycle handler
         * @param {string} eventType - Event type
         * @param {Function} handler - Handler function
         */
        offSocketEvent(eventType, handler) {
            const handlers = this.socketEventHandlers.get(eventType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }

        emitSocketEvent(eventType, event, socket) {
            const handlers = this.socketEventHandlers.get(eventType) || [];
            for (const handler of handlers) {
                try {
                    handler(event, socket);
                } catch (error) {
                    console.error(`[WebSocket] ${eventType} handler error:`, error);
                }
            }
        }
    }

    const webSocketHook = new WebSocketHook();

    const CONNECTION_STATES = {
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        RECONNECTING: 'reconnecting',
    };

    class ConnectionState {
        constructor() {
            this.state = CONNECTION_STATES.RECONNECTING;
            this.eventListeners = new Map();
            this.lastDisconnectedAt = null;
            this.lastConnectedAt = null;

            this.setupListeners();
        }

        /**
         * Get current connection state
         * @returns {string} Connection state (connected, disconnected, reconnecting)
         */
        getState() {
            return this.state;
        }

        /**
         * Check if currently connected
         * @returns {boolean} True if connected
         */
        isConnected() {
            return this.state === CONNECTION_STATES.CONNECTED;
        }

        /**
         * Register a listener for connection events
         * @param {string} event - Event name (disconnected, reconnected)
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister a connection event listener
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
         * Notify connection state from character initialization
         * @param {Object} data - Character initialization payload
         */
        handleCharacterInitialized(data) {
            if (!data) {
                return;
            }

            this.setConnected('character_initialized');
        }

        setupListeners() {
            webSocketHook.onSocketEvent('open', () => {
                this.setReconnecting('socket_open', { allowConnected: true });
            });

            webSocketHook.onSocketEvent('close', (event) => {
                this.setDisconnected('socket_close', event);
            });

            webSocketHook.onSocketEvent('error', (event) => {
                this.setDisconnected('socket_error', event);
            });

            webSocketHook.on('init_character_data', () => {
                this.setConnected('init_character_data');
            });
        }

        setReconnecting(reason, options = {}) {
            if (this.state === CONNECTION_STATES.CONNECTED && !options.allowConnected) {
                return;
            }

            this.updateState(CONNECTION_STATES.RECONNECTING, {
                reason,
            });
        }

        setDisconnected(reason, event) {
            if (this.state === CONNECTION_STATES.DISCONNECTED) {
                return;
            }

            this.lastDisconnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.DISCONNECTED, {
                reason,
                event,
                disconnectedAt: this.lastDisconnectedAt,
            });
        }

        setConnected(reason) {
            if (this.state === CONNECTION_STATES.CONNECTED) {
                return;
            }

            this.lastConnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.CONNECTED, {
                reason,
                disconnectedAt: this.lastDisconnectedAt,
                connectedAt: this.lastConnectedAt,
            });
        }

        updateState(nextState, details) {
            if (this.state === nextState) {
                return;
            }

            const previousState = this.state;
            this.state = nextState;

            if (nextState === CONNECTION_STATES.DISCONNECTED) {
                this.emit('disconnected', {
                    previousState,
                    ...details,
                });
                return;
            }

            if (nextState === CONNECTION_STATES.CONNECTED) {
                this.emit('reconnected', {
                    previousState,
                    ...details,
                });
            }
        }

        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error('[ConnectionState] Listener error:', error);
                }
            }
        }
    }

    const connectionState = new ConnectionState();

    /**
     * Merge market listing updates into the current list.
     * @param {Array} currentListings - Existing market listings.
     * @param {Array} updatedListings - Updated listings from WebSocket.
     * @returns {Array} New merged listings array.
     */
    const mergeMarketListings = (currentListings = [], updatedListings = []) => {
        const safeCurrent = Array.isArray(currentListings) ? currentListings : [];
        const safeUpdates = Array.isArray(updatedListings) ? updatedListings : [];

        if (safeUpdates.length === 0) {
            return [...safeCurrent];
        }

        const indexById = new Map();
        safeCurrent.forEach((listing, index) => {
            if (!listing || listing.id === undefined || listing.id === null) {
                return;
            }
            indexById.set(listing.id, index);
        });

        const merged = [...safeCurrent];

        for (const listing of safeUpdates) {
            if (!listing || listing.id === undefined || listing.id === null) {
                continue;
            }

            const existingIndex = indexById.get(listing.id);
            if (existingIndex !== undefined) {
                merged[existingIndex] = listing;
            } else {
                merged.push(listing);
            }
        }

        return merged;
    };

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
            this.characterQuests = []; // Active quests including tasks
            this.characterEquipment = new Map();
            this.characterHouseRooms = new Map(); // House room HRID -> {houseRoomHrid, level}
            this.actionTypeDrinkSlotsMap = new Map(); // Action type HRID -> array of drink items
            this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
            this.battleData = null; // Current battle data (for Combat Sim export on Steam)

            // Character tracking for switch detection
            this.currentCharacterId = null;
            this.currentCharacterName = null;
            this.isCharacterSwitching = false;
            this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

            // Event listeners
            this.eventListeners = new Map();

            // Achievement buff cache (action type → buff type → flat boost)
            this.achievementBuffCache = {
                source: null,
                byActionType: new Map(),
            };

            // Personal buffs from seals (personal_buffs_updated WebSocket message)
            this.personalActionTypeBuffsMap = {};

            // Retry interval for loading static game data
            this.loadRetryInterval = null;
            this.fallbackInterval = null;

            // Setup WebSocket message handlers
            this.setupMessageHandlers();
        }

        /**
         * Initialize the Data Manager
         * Call this after game loads (or immediately - will retry if needed)
         */
        initialize() {
            this.cleanupIntervals();

            // Try to load static game data using official API
            const success = this.tryLoadStaticData();

            // If failed, set up retry polling
            if (!success && !this.loadRetryInterval) {
                this.loadRetryInterval = setInterval(() => {
                    if (this.tryLoadStaticData()) {
                        this.cleanupIntervals();
                    }
                }, 500); // Retry every 500ms
            }

            // FALLBACK: Continuous polling for missed init_character_data (should not be needed with @run-at document-start)
            // Extended timeout for slower connections/computers (Steam, etc.)
            let fallbackAttempts = 0;
            const maxAttempts = 60; // Poll for up to 30 seconds (60 × 500ms)

            const stopFallbackInterval = () => {
                if (this.fallbackInterval) {
                    clearInterval(this.fallbackInterval);
                    this.fallbackInterval = null;
                }
            };

            this.fallbackInterval = setInterval(() => {
                fallbackAttempts++;

                // Stop if character data received via WebSocket
                if (this.characterData) {
                    stopFallbackInterval();
                    return;
                }

                // Give up after max attempts
                if (fallbackAttempts >= maxAttempts) {
                    console.error(
                        '[DataManager] Character data not received after 30 seconds. WebSocket hook may have failed.'
                    );
                    stopFallbackInterval();
                }
            }, 500); // Check every 500ms
        }

        /**
         * Cleanup polling intervals
         */
        cleanupIntervals() {
            if (this.loadRetryInterval) {
                clearInterval(this.loadRetryInterval);
                this.loadRetryInterval = null;
            }

            if (this.fallbackInterval) {
                clearInterval(this.fallbackInterval);
                this.fallbackInterval = null;
            }
        }

        /**
         * Attempt to load static game data
         * @returns {boolean} True if successful, false if needs retry
         * @private
         */
        tryLoadStaticData() {
            try {
                if (typeof localStorageUtil !== 'undefined' && typeof localStorageUtil.getInitClientData === 'function') {
                    const data = localStorageUtil.getInitClientData();
                    if (data && Object.keys(data).length > 0) {
                        this.initClientData = data;

                        // Build monster sort index map for task sorting
                        this.buildMonsterSortIndexMap();

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
            this.webSocketHook.on('init_character_data', async (data) => {
                // Detect character switch
                const newCharacterId = data.character?.id;
                const newCharacterName = data.character?.name;

                // Validate character data before processing
                if (!newCharacterId || !newCharacterName) {
                    console.error('[DataManager] Invalid character data received:', {
                        hasCharacter: !!data.character,
                        hasId: !!newCharacterId,
                        hasName: !!newCharacterName,
                    });
                    return; // Don't process invalid character data
                }

                // Track whether this is a character switch or first load
                let isCharacterSwitch = false;

                // Check if this is a character switch (not first load)
                if (this.currentCharacterId && this.currentCharacterId !== newCharacterId) {
                    isCharacterSwitch = true;
                    // Prevent rapid-fire character switches (loop protection)
                    const now = Date.now();
                    if (this.lastCharacterSwitchTime && now - this.lastCharacterSwitchTime < 1000) {
                        console.warn('[Toolasha] Ignoring rapid character switch (<1s since last), possible loop detected');
                        return;
                    }
                    this.lastCharacterSwitchTime = now;

                    // Flush all pending storage writes before cleanup (non-blocking)
                    // Use setTimeout to prevent main thread blocking during character switch
                    setTimeout(async () => {
                        try {
                            if (storage && typeof storage.flushAll === 'function') {
                                await storage.flushAll();
                            }
                        } catch (error) {
                            console.error('[Toolasha] Failed to flush storage before character switch:', error);
                        }
                    }, 0);

                    // Set switching flag to block feature initialization
                    this.isCharacterSwitching = true;

                    // Emit character_switching event (cleanup phase)
                    this.emit('character_switching', {
                        oldId: this.currentCharacterId,
                        newId: newCharacterId,
                        oldName: this.currentCharacterName,
                        newName: newCharacterName,
                    });

                    // Update character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;

                    // Clear old character data
                    this.characterData = null;
                    this.characterSkills = null;
                    this.characterItems = null;
                    this.characterActions = [];
                    this.characterQuests = [];
                    this.characterEquipment.clear();
                    this.characterHouseRooms.clear();
                    this.actionTypeDrinkSlotsMap.clear();
                    this.personalActionTypeBuffsMap = {};
                    this.battleData = null;

                    // Reset switching flag (cleanup complete, ready for re-init)
                    this.isCharacterSwitching = false;

                    // Emit character_switched event (ready for re-init)
                    this.emit('character_switched', {
                        newId: newCharacterId,
                        newName: newCharacterName,
                    });
                } else if (!this.currentCharacterId) {
                    // First load - set character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;
                }

                // Process new character data normally
                this.characterData = data;
                this.characterSkills = data.characterSkills;
                this.characterItems = data.characterItems;
                this.characterActions = [...data.characterActions];
                this.characterQuests = data.characterQuests || [];

                // Build equipment map
                this.updateEquipmentMap(data.characterItems);

                // Build house room map
                this.updateHouseRoomMap(data.characterHouseRoomMap);

                // Build drink slots map (tea buffs)
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

                // Load personal buffs (seal buffs from Labyrinth, may be present on login)
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }

                // Clear switching flag
                this.isCharacterSwitching = false;

                // Emit character_initialized event (trigger feature initialization)
                // Include flag to indicate if this is a character switch vs first load
                // IMPORTANT: Mutate data object instead of spreading to avoid copying MB of data
                data._isCharacterSwitch = isCharacterSwitch;
                this.emit('character_initialized', data);
                connectionState.handleCharacterInitialized(data);
            });

            // Handle actions_updated (action queue changes)
            this.webSocketHook.on('actions_updated', (data) => {
                // Update action list
                for (const action of data.endCharacterActions) {
                    if (action.isDone === false) {
                        this.characterActions.push(action);
                    } else {
                        this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
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

                // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
                if (data.endCharacterItems && Array.isArray(data.endCharacterItems)) {
                    for (const endItem of data.endCharacterItems) {
                        // Only update inventory items
                        if (endItem.itemLocationHrid !== '/item_locations/inventory') {
                            continue;
                        }

                        // Find and update the item in inventory
                        const index = this.characterItems.findIndex((invItem) => invItem.id === endItem.id);
                        if (index !== -1) {
                            // Update existing item
                            this.characterItems[index].count = endItem.count;
                        } else {
                            // Add new item to inventory
                            this.characterItems.push(endItem);
                        }
                    }

                    // Notify items_updated listeners (e.g. networth) of the inventory change
                    this.emit('items_updated', data);
                }

                // CRITICAL: Update skill experience from action_completed (this is how XP updates in real-time!)
                if (data.endCharacterSkills && Array.isArray(data.endCharacterSkills) && this.characterSkills) {
                    for (const updatedSkill of data.endCharacterSkills) {
                        const skill = this.characterSkills.find((s) => s.skillHrid === updatedSkill.skillHrid);
                        if (skill) {
                            // Update experience (and level if it changed)
                            skill.experience = updatedSkill.experience;
                            if (updatedSkill.level !== undefined) {
                                skill.level = updatedSkill.level;
                            }
                        }
                    }
                }

                this.emit('action_completed', data);
            });

            // Handle items_updated (inventory/equipment changes)
            this.webSocketHook.on('items_updated', (data) => {
                if (data.endCharacterItems) {
                    // Update inventory items in-place (endCharacterItems contains only changed items, not full inventory)
                    for (const item of data.endCharacterItems) {
                        const index = this.characterItems.findIndex((invItem) => invItem.id === item.id);
                        if (index !== -1) {
                            if (item.count === 0) {
                                // count 0 means removed from this location (e.g. equipped from inventory)
                                this.characterItems.splice(index, 1);
                            } else {
                                // Update existing item (count and location may have changed, e.g. unequip)
                                this.characterItems[index] = { ...this.characterItems[index], ...item };
                            }
                        } else if (item.count > 0) {
                            // New item in inventory or equipment slot
                            this.characterItems.push(item);
                        }
                    }

                    this.updateEquipmentMap(data.endCharacterItems);
                }

                this.emit('items_updated', data);
            });

            // Handle market_listings_updated (market order changes)
            this.webSocketHook.on('market_listings_updated', (data) => {
                if (!this.characterData || !Array.isArray(data?.endMarketListings)) {
                    return;
                }

                const currentListings = Array.isArray(this.characterData.myMarketListings)
                    ? this.characterData.myMarketListings
                    : [];
                const updatedListings = mergeMarketListings(currentListings, data.endMarketListings);

                this.characterData = {
                    ...this.characterData,
                    myMarketListings: updatedListings,
                };

                this.emit('market_listings_updated', {
                    ...data,
                    myMarketListings: updatedListings,
                });
            });

            // Handle market_item_order_books_updated (order book updates)
            this.webSocketHook.on('market_item_order_books_updated', (data) => {
                this.emit('market_item_order_books_updated', data);
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

            // Handle personal_buffs_updated (seal buffs from Labyrinth)
            this.webSocketHook.on('personal_buffs_updated', (data) => {
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }
                this.emit('personal_buffs_updated', data);
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

            // Handle new_battle (combat start - for Combat Sim export on Steam)
            this.webSocketHook.on('new_battle', (data) => {
                // Store battle data (includes party consumables)
                this.battleData = data;
            });

            // Handle character_info_updated (task slot changes, cooldown timestamps, etc.)
            this.webSocketHook.on('character_info_updated', (data) => {
                if (this.characterData && data.characterInfo) {
                    this.characterData.characterInfo = data.characterInfo;
                }
                this.emit('character_info_updated', data);
            });

            // Handle quests_updated (keep characterQuests in sync mid-session)
            this.webSocketHook.on('quests_updated', (data) => {
                if (data.endCharacterQuests && Array.isArray(data.endCharacterQuests)) {
                    for (const updatedQuest of data.endCharacterQuests) {
                        const index = this.characterQuests.findIndex((q) => q.id === updatedQuest.id);
                        if (index !== -1) {
                            this.characterQuests[index] = updatedQuest;
                        } else {
                            this.characterQuests.push(updatedQuest);
                        }
                    }
                    // Remove claimed quests
                    this.characterQuests = this.characterQuests.filter((q) => q.status !== '/quest_status/claimed');
                }
            });
        }

        /**
         * Update equipment map from character items
         * @param {Array} items - Character items array
         */
        updateEquipmentMap(items) {
            for (const item of items) {
                if (item.itemLocationHrid !== '/item_locations/inventory') {
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
            for (const [_hrid, room] of Object.entries(houseRoomMap)) {
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
                abilityCombatTriggersMap: this.characterData?.abilityCombatTriggersMap || {},
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
         * Get MooPass buffs
         * @returns {Array} MooPass buffs array (empty if no MooPass)
         */
        getMooPassBuffs() {
            return this.characterData?.mooPassBuffs || [];
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
         * Get current character ID
         * @returns {string|null} Character ID or null
         */
        getCurrentCharacterId() {
            return this.currentCharacterId;
        }

        /**
         * Get current character name
         * @returns {string|null} Character name or null
         */
        getCurrentCharacterName() {
            return this.currentCharacterName;
        }

        /**
         * Check if character is currently switching
         * @returns {boolean} True if switching
         */
        getIsCharacterSwitching() {
            return this.isCharacterSwitching;
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

            const buff = this.characterData.communityBuffs.find((b) => b.hrid === buffTypeHrid);
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
         * Get achievement buff flat boost for an action type and buff type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/wisdom")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getAchievementBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
            if (!achievementMap) {
                return 0;
            }

            if (this.achievementBuffCache.source !== achievementMap) {
                this.achievementBuffCache = {
                    source: achievementMap,
                    byActionType: new Map(),
                };
            }

            const actionCache = this.achievementBuffCache.byActionType.get(actionTypeHrid) || new Map();
            if (actionCache.has(buffTypeHrid)) {
                return actionCache.get(buffTypeHrid);
            }

            const achievementBuffs = achievementMap[actionTypeHrid];
            if (!Array.isArray(achievementBuffs)) {
                actionCache.set(buffTypeHrid, 0);
                this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
                return 0;
            }

            const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            const flatBoost = buff?.flatBoost || 0;
            actionCache.set(buffTypeHrid, flatBoost);
            this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
            return flatBoost;
        }

        /**
         * Get personal buff flat boost for an action type and buff type (seal buffs from Labyrinth)
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/efficiency")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getPersonalBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const personalBuffs = this.personalActionTypeBuffsMap[actionTypeHrid];
            if (!Array.isArray(personalBuffs)) {
                return 0;
            }

            const buff = personalBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.flatBoost || 0;
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
         * Get player's market listings
         * @returns {Array} Market listings array
         */
        getMarketListings() {
            return this.characterData?.myMarketListings ? [...this.characterData.myMarketListings] : [];
        }

        /**
         * Get active task action HRIDs
         * @returns {Array<string>} Array of action HRIDs that are currently active tasks
         */
        getActiveTaskActionHrids() {
            if (!this.characterQuests || this.characterQuests.length === 0) {
                return [];
            }

            return this.characterQuests
                .filter(
                    (quest) =>
                        quest.category === '/quest_category/random_task' &&
                        quest.status === '/quest_status/in_progress' &&
                        quest.actionHrid
                )
                .map((quest) => quest.actionHrid);
        }

        /**
         * Check if an action is currently an active task
         * @param {string} actionHrid - Action HRID to check
         * @returns {boolean} True if action is an active task
         */
        isTaskAction(actionHrid) {
            const activeTasks = this.getActiveTaskActionHrids();
            return activeTasks.includes(actionHrid);
        }

        /**
         * Get task speed bonus from equipped task badges
         * @returns {number} Task speed percentage (e.g., 15 for 15%)
         */
        getTaskSpeedBonus() {
            if (!this.characterEquipment || !this.initClientData) {
                return 0;
            }

            let totalTaskSpeed = 0;

            // Task badges are in trinket slot
            const trinketLocation = '/item_locations/trinket';
            const equippedItem = this.characterEquipment.get(trinketLocation);

            if (!equippedItem || !equippedItem.itemHrid) {
                return 0;
            }

            const itemDetail = this.initClientData.itemDetailMap[equippedItem.itemHrid];
            if (!itemDetail || !itemDetail.equipmentDetail) {
                return 0;
            }

            const taskSpeed = itemDetail.equipmentDetail.noncombatStats?.taskSpeed || 0;
            if (taskSpeed === 0) {
                return 0;
            }

            // Calculate enhancement bonus
            // Note: noncombatEnhancementBonuses already includes slot multiplier (5× for trinket)
            const enhancementLevel = equippedItem.enhancementLevel || 0;
            const enhancementBonus = itemDetail.equipmentDetail.noncombatEnhancementBonuses?.taskSpeed || 0;
            const totalEnhancementBonus = enhancementBonus * enhancementLevel;

            // Total taskSpeed = base + enhancement
            totalTaskSpeed = (taskSpeed + totalEnhancementBonus) * 100; // Convert to percentage

            return totalTaskSpeed;
        }

        /**
         * Build monster-to-sortIndex mapping from combat zone data
         * Used for sorting combat tasks by zone progression order
         * @private
         */
        buildMonsterSortIndexMap() {
            if (!this.initClientData || !this.initClientData.actionDetailMap) {
                return;
            }

            this.monsterSortIndexMap.clear();

            // Extract combat zones (non-dungeon only)
            for (const [_zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
                // Skip non-combat actions and dungeons
                if (action.type !== '/action_types/combat' || action.combatZoneInfo?.isDungeon) {
                    continue;
                }

                const sortIndex = action.sortIndex;

                // Get regular spawn monsters
                const regularMonsters = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];

                // Get boss monsters (every 10 battles)
                const bossMonsters = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

                // Combine all monsters from this zone
                const allMonsters = [...regularMonsters, ...bossMonsters];

                // Map each monster to this zone's sortIndex
                for (const spawn of allMonsters) {
                    const monsterHrid = spawn.combatMonsterHrid;
                    if (!monsterHrid) continue;

                    // If monster appears in multiple zones, use earliest zone (lowest sortIndex)
                    if (
                        !this.monsterSortIndexMap.has(monsterHrid) ||
                        sortIndex < this.monsterSortIndexMap.get(monsterHrid)
                    ) {
                        this.monsterSortIndexMap.set(monsterHrid, sortIndex);
                    }
                }
            }
        }

        /**
         * Get zone sortIndex for a monster (for task sorting)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/rat")
         * @returns {number} Zone sortIndex (999 if not found)
         */
        getMonsterSortIndex(monsterHrid) {
            return this.monsterSortIndexMap.get(monsterHrid) || 999;
        }

        /**
         * Get monster HRID from display name (for task sorting)
         * @param {string} monsterName - Monster display name (e.g., "Jerry")
         * @returns {string|null} Monster HRID or null if not found
         */
        getMonsterHridFromName(monsterName) {
            if (!this.initClientData || !this.initClientData.combatMonsterDetailMap) {
                return null;
            }

            // Search for monster by display name
            for (const [hrid, monster] of Object.entries(this.initClientData.combatMonsterDetailMap)) {
                if (monster.name === monsterName) {
                    return hrid;
                }
            }

            return null;
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
         * Only character_switching is critical (must run immediately for proper cleanup)
         * All other events including character_switched and character_initialized are deferred
         * @param {string} event - Event name
         * @param {*} data - Event data
         */
        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];

            // Only character_switching must run immediately (cleanup phase)
            // character_switched can be deferred - it just schedules re-init anyway
            const isCritical = event === 'character_switching';

            if (isCritical) {
                // Run immediately on main thread
                for (const listener of listeners) {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`[Data Manager] Error in ${event} listener:`, error);
                    }
                }
            } else {
                // Defer all other events to prevent main thread blocking
                setTimeout(() => {
                    for (const listener of listeners) {
                        try {
                            listener(data);
                        } catch (error) {
                            console.error(`[Data Manager] Error in ${event} listener:`, error);
                        }
                    }
                }, 0);
            }
        }
    }

    const dataManager = new DataManager();

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
            this.COLOR_XP_RATE = '#ffffff'; // XP/hr rate text color
            this.COLOR_INV_COUNT = '#ffffff'; // Inventory count display color

            // Legacy color constants (mapped to COLOR_ACCENT)
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_ALERT = 'red';

            // Market API URL
            this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Settings loaded from settings-schema via settings-storage.js
            this.settingsMap = {};

            // Map of setting keys to callback functions
            this.settingChangeCallbacks = {};

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
                market_showPhiloCalculator: {
                    enabled: true,
                    name: 'Philo Gamba Calculator',
                    category: 'Market',
                    description: "Calculate expected value of transmuting items into Philosopher's Stones",
                    settingKey: 'market_showPhiloCalculator',
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

            // Load settings from settings-storage (which uses settings-schema as source of truth)
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

            // Fallback: Check settings-schema for default (fixes race condition on load)
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
                let value = setting.value;

                // Parse JSON strings for template-type settings
                if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        console.warn(`[Config] Failed to parse JSON for setting '${key}':`, e);
                        // Return as-is if parsing fails
                    }
                }

                return value;
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
            this.COLOR_XP_RATE = this.getSettingValue('color_xp_rate', '#ffffff');
            this.COLOR_INV_COUNT = this.getSettingValue('color_inv_count', '#ffffff');
            this.COLOR_INVBADGE_ASK = this.getSettingValue('color_invBadge_ask', '#047857');
            this.COLOR_INVBADGE_BID = this.getSettingValue('color_invBadge_bid', '#60a5fa');
            this.COLOR_TRANSMUTE = this.getSettingValue('color_transmute', '#ffffff');

            // Set legacy SCRIPT_COLOR_MAIN to accent color
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT; // Keep tooltip same as main
        }

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

    const config = new Config();

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

            // Wait for document.body to exist (critical for @run-at document-start)
            const startObserver = () => {
                if (!document.body) {
                    // Body doesn't exist yet, wait and try again
                    setTimeout(startObserver, 10);
                    return;
                }

                this.observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;

                            // Dispatch to all registered handlers
                            this.handlers.forEach((handler) => {
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
                    subtree: true,
                });

                this.isObserving = true;
            };

            startObserver();
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
            this.debounceTimers.forEach((timer) => clearTimeout(timer));
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
                debounceDelay: options.debounceDelay,
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

            return this.register(
                name,
                (node) => {
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
                            matches.forEach((match) => callback(match));
                        }
                    }
                },
                options
            );
        }

        /**
         * Get stats about registered handlers
         */
        getStats() {
            return {
                isObserving: this.isObserving,
                handlerCount: this.handlers.length,
                handlers: this.handlers.map((h) => ({
                    name: h.name,
                    debounced: h.debounce || false,
                })),
                pendingCallbacks: this.debounceTimers.size,
            };
        }
    }

    const domObserver = new DOMObserver();

    /**
     * Feature Registry
     * Centralized feature initialization system
     */


    /**
     * Feature Registry
     * Populated at runtime by the entrypoint to avoid bundling feature code in core.
     */
    const featureRegistry = [];

    /**
     * Initialize all enabled features
     * @returns {Promise<void>}
     */
    async function initializeFeatures() {
        // Block feature initialization during character switch
        if (dataManager.getIsCharacterSwitching()) {
            return;
        }

        const errors = [];

        for (const feature of featureRegistry) {
            try {
                const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

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
                    error: error.message,
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
        return featureRegistry.find((f) => f.key === key) || null;
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
        return featureRegistry.filter((f) => f.category === category);
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
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

            if (!isEnabled) continue;

            try {
                const result = feature.healthCheck();

                // null = can't verify (DOM not ready), false = failed, true = healthy
                if (result === false) {
                    failed.push({
                        key: feature.key,
                        name: feature.name,
                        reason: 'Health check returned false',
                    });
                }
            } catch (error) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: `Health check error: ${error.message}`,
                });
            }
        }

        return failed;
    }

    /**
     * Setup character switch handler
     * Re-initializes all features when character switches
     */
    function setupCharacterSwitchHandler() {
        // Promise that resolves when cleanup is complete
        let cleanupPromise = null;
        let reinitScheduled = false;

        // Handle character_switching event (cleanup phase)
        dataManager.on('character_switching', async (_data) => {
            cleanupPromise = (async () => {
                try {
                    // Clear config cache IMMEDIATELY to prevent stale settings
                    if (config && typeof config.clearSettingsCache === 'function') {
                        config.clearSettingsCache();
                    }

                    // Disable all active features (cleanup DOM elements, event listeners, etc.)
                    const cleanupPromises = [];
                    for (const feature of featureRegistry) {
                        try {
                            const featureInstance = getFeatureInstance(feature.key);
                            if (featureInstance && typeof featureInstance.disable === 'function') {
                                const result = featureInstance.disable();
                                if (result && typeof result.then === 'function') {
                                    cleanupPromises.push(
                                        result.catch((error) => {
                                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                                        })
                                    );
                                }
                            }
                        } catch (error) {
                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                        }
                    }

                    // Wait for all cleanup in parallel
                    if (cleanupPromises.length > 0) {
                        await Promise.all(cleanupPromises);
                    }
                } catch (error) {
                    console.error('[FeatureRegistry] Error during character switch cleanup:', error);
                }
            })();

            await cleanupPromise;
        });

        // Handle character_switched event (re-initialization phase)
        dataManager.on('character_switched', async (_data) => {
            // Prevent multiple overlapping reinits
            if (reinitScheduled) {
                return;
            }

            reinitScheduled = true;

            // Force cleanup of dungeon tracker UI (safety measure)
            const dungeonTrackerFeature = getFeature('dungeonTrackerUI');
            if (dungeonTrackerFeature && typeof dungeonTrackerFeature.cleanup === 'function') {
                dungeonTrackerFeature.cleanup();
            }

            try {
                // Wait for cleanup to complete (with safety timeout)
                if (cleanupPromise) {
                    await Promise.race([cleanupPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
                }

                // CRITICAL: Load settings BEFORE any feature initialization
                // This ensures all features see the new character's settings
                await config.loadSettings();
                config.applyColorSettings();

                // Small delay to ensure game state is stable
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Now re-initialize all features with fresh settings
                await initializeFeatures();
            } catch (error) {
                console.error('[FeatureRegistry] Error during feature reinitialization:', error);
            } finally {
                reinitScheduled = false;
            }
        });
    }

    /**
     * Get feature instance from imported module
     * @param {string} key - Feature key
     * @returns {Object|null} Feature instance or null
     * @private
     */
    function getFeatureInstance(key) {
        const feature = getFeature(key);
        if (!feature) {
            return null;
        }

        return feature.module || feature;
    }

    /**
     * Retry initialization for specific features
     * @param {Array<Object>} failedFeatures - Array of failed feature objects
     * @returns {Promise<void>}
     */
    async function retryFailedFeatures(failedFeatures) {
        for (const failed of failedFeatures) {
            const feature = getFeature(failed.key);
            if (!feature) continue;

            try {
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }

                // Verify the retry actually worked by running health check
                if (feature.healthCheck) {
                    const healthResult = feature.healthCheck();
                    if (healthResult === false) {
                        console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                    }
                }
            } catch (error) {
                console.error(`[Toolasha] ${feature.name} retry failed:`, error);
            }
        }
    }

    /**
     * Replace the feature registry (for library split)
     * @param {Array} newFeatures - New feature registry array
     */
    function replaceFeatures(newFeatures) {
        featureRegistry.length = 0; // Clear existing array
        featureRegistry.push(...newFeatures); // Add new features
    }

    var featureRegistry$1 = {
        initializeFeatures,
        setupCharacterSwitchHandler,
        checkFeatureHealth,
        retryFailedFeatures,
        getFeature,
        getAllFeatures,
        replaceFeatures,
        getFeaturesByCategory,
    };

    /**
     * Tooltip Observer
     * Centralized observer for tooltip/popper appearances
     * Any feature can subscribe to be notified when tooltips appear
     */


    class TooltipObserver {
        constructor() {
            this.subscribers = new Map(); // name -> callback
            this.unregisterObserver = null;
            this.isInitialized = false;
        }

        /**
         * Initialize the observer (call once)
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Watch for tooltip/popper elements appearing
            // These are the common classes used by MUI tooltips/poppers
            this.unregisterObserver = domObserver.onClass('TooltipObserver', ['MuiPopper', 'MuiTooltip'], (element) => {
                this.notifySubscribers(element);
            });
        }

        /**
         * Subscribe to tooltip appearance events
         * @param {string} name - Unique subscriber name
         * @param {Function} callback - Function(element) to call when tooltip appears
         */
        subscribe(name, callback) {
            this.subscribers.set(name, callback);

            // Auto-initialize if first subscriber
            if (!this.isInitialized) {
                this.initialize();
            }
        }

        /**
         * Unsubscribe from tooltip events
         * @param {string} name - Subscriber name
         */
        unsubscribe(name) {
            this.subscribers.delete(name);

            // If no subscribers left, could optionally stop observing
            // For now, keep observer active for simplicity
        }

        /**
         * Notify all subscribers that a tooltip appeared
         * @param {Element} element - The tooltip/popper element
         * @private
         */
        notifySubscribers(element) {
            // Set up observer to detect when this specific tooltip is removed
            const removalObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const removedNode of mutation.removedNodes) {
                        if (removedNode === element) {
                            // Notify subscribers that tooltip closed
                            for (const [name, callback] of this.subscribers.entries()) {
                                try {
                                    callback(element, 'closed');
                                } catch (error) {
                                    console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                                }
                            }
                            removalObserver.disconnect();
                            return;
                        }
                    }
                }
            });

            // Watch the parent for removal of this tooltip
            if (element.parentNode) {
                removalObserver.observe(element.parentNode, {
                    childList: true,
                });
            }

            // Notify subscribers that tooltip opened
            for (const [name, callback] of this.subscribers.entries()) {
                try {
                    callback(element, 'opened');
                } catch (error) {
                    console.error(`[TooltipObserver] Error in subscriber "${name}" (open):`, error);
                }
            }
        }

        /**
         * Cleanup and disable
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
            this.subscribers.clear();
            this.isInitialized = false;
        }
    }

    const tooltipObserver = new TooltipObserver();

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
            const unregister = domObserver.onClass('NetworkAlert', 'Header_totalLevel', (elem) => {
                this.prepareContainer(elem);
            });
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

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
        }
    }

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
            this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
            this.CACHE_KEY_DATA = 'Toolasha_marketAPI_json';
            this.CACHE_KEY_TIMESTAMP = 'Toolasha_marketAPI_timestamp';
            this.CACHE_KEY_PATCHES = 'Toolasha_marketAPI_patches';
            this.CACHE_KEY_MIGRATION = 'Toolasha_marketAPI_migration_version';
            this.CURRENT_MIGRATION_VERSION = 1; // Increment this when patches need to be cleared

            // Current market data
            this.marketData = null;
            this.lastFetchTimestamp = null;
            this.errorLog = [];

            // Price patches from order book data (fresher than API)
            // Structure: { "itemHrid:enhLevel": { a: ask, b: bid, timestamp: ms } }
            this.pricePatchs = {};

            // Event listeners for price updates
            this.listeners = [];
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
                    // API timestamp is in seconds, convert to milliseconds for comparison with Date.now()
                    this.lastFetchTimestamp = cached.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    // Hide alert on successful cache load
                    networkAlert.hide();
                    // Notify listeners (initial load)
                    this.notifyListeners();
                    return this.marketData;
                }
            }

            if (!connectionState.isConnected()) {
                const cachedFallback = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
                if (cachedFallback?.marketData) {
                    this.marketData = cachedFallback.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = cachedFallback.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    console.warn('[MarketAPI] Skipping fetch; disconnected. Using cached data.');
                    return this.marketData;
                }

                console.warn('[MarketAPI] Skipping fetch; disconnected and no cache available');
                return null;
            }

            // Try to fetch fresh data
            try {
                const response = await this.fetchFromAPI();

                if (response) {
                    // Cache the fresh data
                    this.cacheData(response);
                    this.marketData = response.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = response.timestamp * 1000;
                    // Load patches from storage (they may still be fresher than new API data)
                    await this.loadPatches();
                    // Hide alert on successful fetch
                    networkAlert.hide();
                    // Notify listeners of price update
                    this.notifyListeners();
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
                // API timestamp is in seconds, convert to milliseconds
                this.lastFetchTimestamp = expiredCache.timestamp * 1000;
                // Load patches from storage
                await this.loadPatches();
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
                timestamp: cachedData.timestamp,
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
            const normalizeMarketPriceValue = (value) => {
                if (typeof value !== 'number') {
                    return null;
                }

                if (value < 0) {
                    return null;
                }

                return value;
            };

            // Check for fresh patch first
            const patchKey = `${itemHrid}:${enhancementLevel}`;
            const patch = this.pricePatchs[patchKey];

            if (patch && patch.timestamp > this.lastFetchTimestamp) {
                // Patch is fresher than API data - use it
                return {
                    ask: normalizeMarketPriceValue(patch.a),
                    bid: normalizeMarketPriceValue(patch.b),
                };
            }

            // Fall back to API data
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
                ask: normalizeMarketPriceValue(price.a), // Sell price
                bid: normalizeMarketPriceValue(price.b), // Buy price
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
         * Get prices for multiple items with enhancement levels (batch optimized)
         * @param {Array<{itemHrid: string, enhancementLevel: number}>} items - Array of items with enhancement levels
         * @returns {Map<string, Object>} Map of "hrid:level" -> { ask, bid }
         */
        getPricesBatch(items) {
            const priceMap = new Map();

            for (const { itemHrid, enhancementLevel = 0 } of items) {
                const key = `${itemHrid}:${enhancementLevel}`;
                if (!priceMap.has(key)) {
                    const price = this.getPrice(itemHrid, enhancementLevel);
                    if (price) {
                        priceMap.set(key, price);
                    }
                }
            }

            return priceMap;
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
                error: error?.message || String(error),
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

        /**
         * Update price from order book data (fresher than API)
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {number|null} ask - Top ask price (null if no asks)
         * @param {number|null} bid - Top bid price (null if no bids)
         */
        updatePrice(itemHrid, enhancementLevel, ask, bid) {
            const key = `${itemHrid}:${enhancementLevel}`;

            this.pricePatchs[key] = {
                a: ask,
                b: bid,
                timestamp: Date.now(),
            };

            // Save patches to storage (debounced via storage module)
            this.savePatches();

            // Notify listeners of price update
            this.notifyListeners();
        }

        /**
         * Load price patches from storage
         */
        async loadPatches() {
            try {
                // Check migration version - clear patches if old version
                const migrationVersion = await storage.get(this.CACHE_KEY_MIGRATION, 'settings', 0);

                if (migrationVersion < this.CURRENT_MIGRATION_VERSION) {
                    console.log(
                        `[MarketAPI] Migrating price patches from v${migrationVersion} to v${this.CURRENT_MIGRATION_VERSION}`
                    );
                    // Clear old patches (they may have corrupted data)
                    this.pricePatchs = {};
                    await storage.set(this.CACHE_KEY_PATCHES, {}, 'settings');
                    await storage.set(this.CACHE_KEY_MIGRATION, this.CURRENT_MIGRATION_VERSION, 'settings');
                    console.log('[MarketAPI] Price patches cleared due to migration');
                    return;
                }

                // Load patches normally
                const patches = await storage.getJSON(this.CACHE_KEY_PATCHES, 'settings', {});
                this.pricePatchs = patches || {};

                // Purge stale patches (older than API data)
                this.purgeStalePatches();
            } catch (error) {
                console.error('[MarketAPI] Failed to load price patches:', error);
                this.pricePatchs = {};
            }
        }

        /**
         * Remove patches older than the current API data
         * Called after loadPatches() to clean up stale patches
         */
        purgeStalePatches() {
            if (!this.lastFetchTimestamp) {
                return; // No API data loaded yet
            }

            let purgedCount = 0;
            const keysToDelete = [];

            for (const [key, patch] of Object.entries(this.pricePatchs)) {
                // Check for corrupted/invalid patches or stale timestamps
                if (!patch || !patch.timestamp || patch.timestamp < this.lastFetchTimestamp) {
                    keysToDelete.push(key);
                    purgedCount++;
                }
            }

            // Remove stale patches
            for (const key of keysToDelete) {
                delete this.pricePatchs[key];
            }

            if (purgedCount > 0) {
                console.log(`[MarketAPI] Purged ${purgedCount} stale price patches`);
                // Save cleaned patches
                this.savePatches();
            }
        }

        /**
         * Save price patches to storage
         */
        savePatches() {
            storage.setJSON(this.CACHE_KEY_PATCHES, this.pricePatchs, 'settings', true);
        }

        /**
         * Clear cache and fetch fresh market data
         * @returns {Promise<Object|null>} Fresh market data or null if failed
         */
        async clearCacheAndRefetch() {
            // Clear storage cache
            await storage.delete(this.CACHE_KEY_DATA, 'settings');
            await storage.delete(this.CACHE_KEY_TIMESTAMP, 'settings');

            // Clear in-memory state
            this.marketData = null;
            this.lastFetchTimestamp = null;

            // Force fresh fetch
            return await this.fetch(true);
        }

        /**
         * Register a listener for price updates
         * @param {Function} callback - Called when prices update
         */
        on(callback) {
            this.listeners.push(callback);
        }

        /**
         * Unregister a listener
         * @param {Function} callback - The callback to remove
         */
        off(callback) {
            this.listeners = this.listeners.filter((cb) => cb !== callback);
        }

        /**
         * Notify all listeners that prices have been updated
         */
        notifyListeners() {
            for (const callback of this.listeners) {
                try {
                    callback();
                } catch (error) {
                    console.error('[MarketAPI] Listener error:', error);
                }
            }
        }
    }

    const marketAPI = new MarketAPI();

    /**
     * Foundation Core Library
     * Core infrastructure and API clients only (no utilities)
     *
     * Exports to: window.Toolasha.Core
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Core = {
        storage,
        config,
        webSocketHook,
        domObserver,
        dataManager,
        featureRegistry: featureRegistry$1,
        settingsStorage,
        settingsGroups,
        tooltipObserver,
        profileManager: {
            setCurrentProfile,
            getCurrentProfile,
            clearCurrentProfile,
        },
        marketAPI,
    };

    console.log('[Toolasha] Core library loaded');

})();
