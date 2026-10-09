/**
 * Toolasha Core Library
 * Core infrastructure and API clients
 * Version: 3.8.0
 * License: CC-BY-NC-SA-4.0
 */

(function () {
    'use strict';

    /**
     * Centralized IndexedDB Storage
     * Replaces GM storage with IndexedDB for better performance and Chromium compatibility
     * Provides debounced writes to reduce I/O operations
     */

    class Storage {
        constructor() {
            this.db = null;
            this.available = false;
            this.dbVersion = 20; // Bumped for characterActivityStatus and openableAnalytics stores
            // Standalone dev/test builds (BUILD_TARGET=dev-standalone) must never share the released
            // product's IndexedDB namespace: a dev build carrying an unreleased schema bump upgrades
            // ToolashaDB in place, and released code can then never reopen it (VersionError) once the
            // dev build is removed. The build-channel marker is injected by rollup.config.js only for
            // that target, so production/watch builds are unaffected.
            const isStandaloneDevBuild = globalThis.__TOOLASHA_BUILD_CHANNEL__ === 'dev-standalone';
            this.dbName = isStandaloneDevBuild ? `ToolashaDB-dev-v${this.dbVersion}` : 'ToolashaDB';
            this.saveDebounceTimers = new Map(); // Per-key debounce timers
            this.pendingWrites = new Map(); // Per-key pending write data: {value, storeName, resolvers, generation}
            this._writeGeneration = new Map(); // Per-key monotonic generation counter
            this.SAVE_DEBOUNCE_DELAY = 3000; // 3 seconds
            this._reconnecting = false; // Guard against concurrent reconnection attempts
            this._dbNulledReason = null; // Track why db was last set to null
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
                    if (request.error?.name === 'VersionError') {
                        // The physical DB was created by a newer Toolasha schema than this build
                        // requests. Never delete/recreate it here - the data is intact and only
                        // needs a compatible/newer Toolasha version to open it again.
                        console.error(
                            `[Storage] ${this.dbName} was created by a newer Toolasha schema. ` +
                                'Stored data has been preserved; install a compatible/newer Toolasha version.',
                            request.error
                        );
                    } else {
                        console.error('[Storage] Failed to open IndexedDB', request.error);
                    }
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    this._dbNulledReason = null;
                    this._setupDbEventHandlers();
                    resolve();
                };

                request.onblocked = () => {
                    console.warn('[Storage] IndexedDB open blocked by existing connection — retrying after close');
                    this._dbNulledReason = 'onblocked';
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
                        this._dbNulledReason = null;
                        this._setupDbEventHandlers();
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

                    // Create alchemyHistory store if it doesn't exist (for transmute history tracker)
                    if (!db.objectStoreNames.contains('alchemyHistory')) {
                        db.createObjectStore('alchemyHistory');
                    }

                    // Create labyrinth store if it doesn't exist (for labyrinth tracker)
                    if (!db.objectStoreNames.contains('labyrinth')) {
                        db.createObjectStore('labyrinth');
                    }

                    // Create guildHistory store if it doesn't exist (for guild XP tracker)
                    if (!db.objectStoreNames.contains('guildHistory')) {
                        db.createObjectStore('guildHistory');
                    }

                    // Create networthHistory store if it doesn't exist (for networth chart)
                    if (!db.objectStoreNames.contains('networthHistory')) {
                        db.createObjectStore('networthHistory');
                    }

                    // Create collections store if it doesn't exist (for collection filters feature)
                    if (!db.objectStoreNames.contains('collections')) {
                        db.createObjectStore('collections');
                    }

                    // Create queueSnapshots store if it doesn't exist (for cross-character queue monitor)
                    if (!db.objectStoreNames.contains('queueSnapshots')) {
                        db.createObjectStore('queueSnapshots');
                    }

                    // Create lootLogHistory store if it doesn't exist (for extended loot log)
                    if (!db.objectStoreNames.contains('lootLogHistory')) {
                        db.createObjectStore('lootLogHistory');
                    }

                    // Create leaderboardHistory store if it doesn't exist (for leaderboard XP tracker)
                    if (!db.objectStoreNames.contains('leaderboardHistory')) {
                        db.createObjectStore('leaderboardHistory');
                    }

                    // Create actionProgress store if it doesn't exist (for Action Time Display's
                    // cross-reload current-unit partial-progress boundary)
                    if (!db.objectStoreNames.contains('actionProgress')) {
                        db.createObjectStore('actionProgress');
                    }

                    // Create characterActivityStatus store if it doesn't exist (for Character
                    // Activity Status projections + account-level presentation preferences)
                    if (!db.objectStoreNames.contains('characterActivityStatus')) {
                        db.createObjectStore('characterActivityStatus');
                    }

                    // Create openableAnalytics store if it doesn't exist (for Openable Analytics
                    // lifetime aggregates and bounded detailed opening history)
                    if (!db.objectStoreNames.contains('openableAnalytics')) {
                        db.createObjectStore('openableAnalytics');
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
                        resolve(request.result != null ? request.result : defaultValue);
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
                return this._saveImmediate(key, value, storeName);
            } else {
                return this._debouncedSave(key, value, storeName);
            }
        }

        /**
         * Internal: Save immediately, superseding any pending debounced write for the same key so it
         * can never later overwrite this value with stale data.
         * @private
         */
        async _saveImmediate(key, value, storeName) {
            const timerKey = `${storeName}:${key}`;

            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
                this.saveDebounceTimers.delete(timerKey);
            }
            // Claim the slot so a same-tick-scheduled old timer sees `!pending` and no-ops, and bump
            // the generation as a second guard against any already-in-flight timer callback.
            const pending = this.pendingWrites.get(timerKey);
            this.pendingWrites.delete(timerKey);
            this._writeGeneration.set(timerKey, (this._writeGeneration.get(timerKey) || 0) + 1);

            const success = await this._saveToIndexedDB(key, value, storeName);

            if (pending) {
                for (const resolve of pending.resolvers) resolve(success);
            }
            return success;
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

            const existing = this.pendingWrites.get(timerKey);
            const resolvers = existing?.resolvers || [];

            const generation = (this._writeGeneration.get(timerKey) || 0) + 1;
            this._writeGeneration.set(timerKey, generation);
            this.pendingWrites.set(timerKey, { value, storeName, resolvers, generation });

            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
            }

            return new Promise((resolve) => {
                resolvers.push(resolve);

                const timer = setTimeout(async () => {
                    this.saveDebounceTimers.delete(timerKey);

                    const pending = this.pendingWrites.get(timerKey);
                    if (!pending || pending.generation !== generation) {
                        // A newer write arrived and owns this slot — do nothing.
                        // The newer timer will handle persistence and resolve all coalesced callers.
                        return;
                    }

                    // Take ownership: remove from queue before attempting save
                    // so a concurrent newer write can claim the slot cleanly.
                    this.pendingWrites.delete(timerKey);

                    const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);

                    if (!success) {
                        // Requeue without a timer so the value survives for the next
                        // flushAll() or the next debounced write to this key.
                        if (!this.pendingWrites.has(timerKey)) {
                            this.pendingWrites.set(timerKey, {
                                value: pending.value,
                                storeName: pending.storeName,
                                resolvers: pending.resolvers,
                                generation: pending.generation,
                            });
                        }
                        // A newer write already reclaimed the slot — resolve callers with false.
                        else {
                            for (const r of pending.resolvers) {
                                r(false);
                            }
                        }
                        return;
                    }

                    for (const r of pending.resolvers) {
                        r(true);
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
         * Get all key-value pairs from an object store
         * @param {string} storeName - Object store name
         * @returns {Promise<Object>} Map of key → value
         */
        async getAll(storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot get all from store: ${storeName}`);
                return {};
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const result = {};
                    const cursorRequest = store.openCursor();

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            result[cursor.key] = cursor.value;
                            cursor.continue();
                        } else {
                            resolve(result);
                        }
                    };

                    cursorRequest.onerror = () => {
                        console.error(`[Storage] Failed to get all from ${storeName}:`, cursorRequest.error);
                        resolve({});
                    };
                } catch (error) {
                    console.error(`[Storage] GetAll transaction failed for store ${storeName}:`, error);
                    resolve({});
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

            // Snapshot the current pending writes; do not clear the map upfront.
            // Each entry is only removed after its write succeeds to preserve durability.
            const writes = Array.from(this.pendingWrites.entries());

            for (const [timerKey, pending] of writes) {
                // Skip if a newer write has already replaced this entry.
                if (this.pendingWrites.get(timerKey) !== pending) continue;

                const colonIndex = timerKey.indexOf(':');
                const key = timerKey.substring(colonIndex + 1);

                const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);

                if (success) {
                    // Only remove if no newer write has claimed the slot since we started.
                    if (this.pendingWrites.get(timerKey) === pending) {
                        this.pendingWrites.delete(timerKey);
                    }
                    for (const r of pending.resolvers || []) {
                        r(true);
                    }
                } else {
                    // Leave the entry in pendingWrites so reconnect / next flush can retry.
                    for (const r of pending.resolvers || []) {
                        r(false);
                    }
                }
            }
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

            // Resolve all pending Promises with false before clearing
            for (const pending of this.pendingWrites.values()) {
                for (const r of pending.resolvers || []) {
                    r(false);
                }
            }
            this.pendingWrites.clear();
            this._writeGeneration.clear();
        }

        /**
         * Set up event handlers on the active DB connection.
         * @private
         */
        _setupDbEventHandlers() {
            if (!this.db) return;

            this.db.onversionchange = () => {
                console.warn('[Storage] DB connection lost: onversionchange fired (another tab/instance upgraded the DB)');
                this._dbNulledReason = 'onversionchange';
                this.db.close();
                this.db = null;
                this._reconnect();
            };

            this.db.onclose = () => {
                console.warn('[Storage] DB connection lost: onclose fired (connection dropped unexpectedly)');
                this._dbNulledReason = 'onclose';
                this.db = null;
                this._reconnect();
            };
        }

        /**
         * Attempt to reconnect to IndexedDB after the connection is lost.
         * @private
         */
        async _reconnect() {
            if (this._reconnecting) return;
            this._reconnecting = true;

            // Wait a brief moment for any version upgrade to complete
            await new Promise((r) => setTimeout(r, 500));

            try {
                await this.openDatabase();
                this.available = true;
                console.log('[Storage] Successfully reconnected to IndexedDB');
            } catch (error) {
                console.error('[Storage] Reconnection failed:', error);
                this.available = false;
            } finally {
                this._reconnecting = false;
            }
        }

        /**
         * Return diagnostic info about current storage state.
         * @returns {Object}
         */
        diagnostics() {
            return {
                dbExists: this.db !== null,
                available: this.available,
                dbName: this.dbName,
                dbVersion: this.dbVersion,
                reconnecting: this._reconnecting,
                lastNullReason: this._dbNulledReason,
                pendingWrites: this.pendingWrites.size,
                activeTimers: this.saveDebounceTimers.size,
            };
        }
    }

    const storage = new Storage();

    /**
     * Settings Configuration
     * Organizes all script settings into logical groups for the settings UI
     */

    const settingsGroups = {
        ironCow: {
            title: 'Iron Cow Mode',
            icon: '🐄',
            settings: {
                ironCow_enabled: {
                    id: 'ironCow_enabled',
                    label: 'Iron Cow Mode',
                    type: 'checkbox',
                    default: false,
                    hidden: true,
                    help: 'Disable all market and profit features for a no-marketplace playthrough.',
                },
            },
        },

        general: {
            title: 'General Settings',
            icon: '⚙️',
            settings: {
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
                chatHistoryExtender: {
                    id: 'chatHistoryExtender',
                    label: 'Chat: Extend chat history',
                    type: 'checkbox',
                    default: true,
                    help: 'Preserves messages that the game removes from the live buffer, keeping them visible above the live chat',
                },
                chatHistoryExtender_maxHistory: {
                    id: 'chatHistoryExtender_maxHistory',
                    label: 'Chat: Max messages to retain per tab',
                    type: 'text',
                    default: '150',
                },
                notificationLog: {
                    id: 'notificationLog',
                    label: 'Chat: Add Log tab',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Log tab to the chat panel logging item trades, level-ups, guild events, and other in-game toasts',
                },
                chat_24hrTimestamps: {
                    id: 'chat_24hrTimestamps',
                    label: 'Chat: Reformat message timestamps',
                    type: 'checkbox',
                    default: true,
                    help: 'Reformats chat message timestamps using your Market date/time format settings instead of the browser default',
                },
                notificationLog_maxEntries: {
                    id: 'notificationLog_maxEntries',
                    label: 'Chat: Max notifications to keep',
                    type: 'number',
                    default: 100,
                    min: 10,
                    max: 1000,
                    help: 'How many notifications to keep in history, per character. Filtering in the tab only changes what is shown, not what is stored.',
                },
                altClickNavigation: {
                    id: 'altClickNavigation',
                    label: 'Alt+click items to navigate to crafting/gathering or dictionary',
                    type: 'checkbox',
                    default: true,
                    help: 'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable',
                },
                collectionNavigation: {
                    id: 'collectionNavigation',
                    label: 'Add navigation buttons to collection items',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds View Action and Item Dictionary buttons when clicking collection items',
                },
                queueMonitor: {
                    id: 'queueMonitor',
                    label: 'Cross-character queue monitor',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows estimated queue time remaining for your other characters in a floating widget',
                },
                characterActivityStatus: {
                    id: 'characterActivityStatus',
                    label: 'Character Select: Show activity status',
                    type: 'checkbox',
                    default: true,
                    help: 'On Character Select, shows what each character is expected to be doing and the earliest point they may need attention (action/queue end, materials, or offline cap)',
                },
            },
        },

        actionBar: {
            title: 'Action Bar',
            icon: '⚡',
            settings: {
                actionBar_enabled: {
                    id: 'actionBar_enabled',
                    label: 'Action bar: Enable action bar display',
                    type: 'checkbox',
                    default: true,
                },
                actionBar_compactWidth: {
                    id: 'actionBar_compactWidth',
                    label: 'Action bar: Compact width (800px limit)',
                    type: 'checkbox',
                    default: false,
                    help: 'Limits action bar width to 800px. Useful for wide monitors.',
                },
                actionBar_showQueueCount: {
                    id: 'actionBar_showQueueCount',
                    label: 'Action bar: Queue/remaining count',
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showActionDuration: {
                    id: 'actionBar_showActionDuration',
                    label: 'Action bar: Time per action (e.g. 14.94s/action)',
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showActionsPerHour: {
                    id: 'actionBar_showActionsPerHour',
                    label: 'Action bar: Actions/hr and items/hr',
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showTimeRemaining: {
                    id: 'actionBar_showTimeRemaining',
                    label: 'Action bar: Time remaining display',
                    type: 'select',
                    default: 'both',
                    options: [
                        { value: 'both', label: 'Time remaining and completion ETA' },
                        { value: 'relative', label: 'Time remaining only' },
                        { value: 'absolute', label: 'Completion ETA only' },
                        { value: 'none', label: 'Neither' },
                    ],
                },
                actionBar_showRecycleTime: {
                    id: 'actionBar_showRecycleTime',
                    label: 'Action bar: Transmute recycle time estimate',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows estimated total time accounting for self-return recycling during transmute actions',
                },
                actionBar_showProfit: {
                    id: 'actionBar_showProfit',
                    label: 'Action bar: Show current action profit',
                    type: 'checkbox',
                    default: false,
                    help: 'Displays profit/hr and remaining profit for the current action (gathering and production)',
                },
                actionPanel_liveCountdown: {
                    id: 'actionPanel_liveCountdown',
                    label: 'Action bar: Live countdown timer',
                    type: 'checkbox',
                    default: false,
                    help: 'Replaces the static time display on the action progress bar with a live countdown in seconds',
                },
            },
        },

        skillPageTiles: {
            title: 'Skill Page & Tiles',
            icon: '🗃️',
            settings: {
                actionPanel_showFilter: {
                    id: 'actionPanel_showFilter',
                    label: 'Skill page: Filter actions input',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showSort: {
                    id: 'actionPanel_showSort',
                    label: 'Skill page: Sort button',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showPricingMode: {
                    id: 'actionPanel_showPricingMode',
                    label: 'Skill page: Pricing mode button',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showCraftToggle: {
                    id: 'actionPanel_showCraftToggle',
                    label: 'Skill page: Craft toggle button',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showSellTaxToggle: {
                    id: 'actionPanel_showSellTaxToggle',
                    label: 'Skill page: Sell tax toggle button',
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showProfitPerHour_gathering: {
                    id: 'actionPanel_showProfitPerHour_gathering',
                    label: 'Action page: Show profit/hr on gathering tiles',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays profit/hr on gathering action tiles (Foraging, Woodcutting, etc.)',
                },
                actionPanel_showProfitPerHour_production: {
                    id: 'actionPanel_showProfitPerHour_production',
                    label: 'Action page: Show profit/hr on production tiles',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays profit/hr on production action tiles (Crafting, Tailoring, etc.)',
                },
                actionPanel_showExpPerHour_gathering: {
                    id: 'actionPanel_showExpPerHour_gathering',
                    label: 'Action page: Show exp/hr on gathering tiles',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays exp/hr on gathering action tiles (Foraging, Woodcutting, etc.)',
                },
                actionPanel_showExpPerHour_production: {
                    id: 'actionPanel_showExpPerHour_production',
                    label: 'Action page: Show exp/hr on production tiles',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays exp/hr on production action tiles (Crafting, Tailoring, etc.)',
                },
                actionPanel_hideNegativeProfit: {
                    id: 'actionPanel_hideNegativeProfit',
                    label: 'Action panel: Hide actions with negative profit',
                    type: 'checkbox',
                    default: false,
                    help: 'Hides action panels that would result in a loss (negative profit/hr)',
                },
                inventoryCountDisplay: {
                    id: 'inventoryCountDisplay',
                    label: 'Action panels: Show current inventory count of output item',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows how many of the output item you currently own, on action tiles and in the action detail panel',
                },
                actions_pinnedPage: {
                    id: 'actions_pinnedPage',
                    label: 'Pinned actions: Enable pinned actions page and pin icons',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Pinned button to the left nav bar showing all pinned actions, and shows pin icons on action tiles.',
                },
            },
        },

        actionPanel: {
            title: 'Action Panel',
            icon: '📄',
            settings: {
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
                actionPanel_quickInputs_countPresets: {
                    id: 'actionPanel_quickInputs_countPresets',
                    label: 'Action panel: Custom count presets (comma-separated, e.g. 100,1000,1000000)',
                    type: 'text',
                    default: '',
                },
                actionPanel_quickInputs_hourPresets: {
                    id: 'actionPanel_quickInputs_hourPresets',
                    label: 'Action panel: Custom hour presets (comma-separated, e.g. 0.5,1,24,168,720)',
                    type: 'text',
                    default: '',
                },
                actionPanel_foragingTotal: {
                    id: 'actionPanel_foragingTotal',
                    label: 'Action panel: Overall profit for multi-outcome foraging',
                    type: 'checkbox',
                    default: true,
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
                actionPanel_showProfitDetail: {
                    id: 'actionPanel_showProfitDetail',
                    label: 'Action panel: Show profitability detail',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays the profitability breakdown section inside gathering, production, and alchemy action panels',
                },
                actionPanel_showLevelProgress: {
                    id: 'actionPanel_showLevelProgress',
                    label: 'Action panel: Show level progress',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays XP and level progress estimates inside action panels',
                },
                actionPanel_showSpeedTime: {
                    id: 'actionPanel_showSpeedTime',
                    label: 'Action panel: Show action speed & time',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays speed breakdown, efficiency, and total time inside action panels',
                },
                requiredMaterials: {
                    id: 'requiredMaterials',
                    label: 'Action panel: Show total required and missing materials',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays total materials needed and shortfall when entering quantity',
                },
                actionPanel_enhanceMatLimitProtections: {
                    id: 'actionPanel_enhanceMatLimitProtections',
                    label: 'Enhancement material limit: Include protection items',
                    type: 'checkbox',
                    default: true,
                    help: 'When enabled, protection item availability is factored into the material limit estimate. Disable to see material limit based only on enhancement materials.',
                },
            },
        },

        actionQueue: {
            title: 'Action Queue',
            icon: '📌',
            settings: {
                actionQueue: {
                    id: 'actionQueue',
                    label: 'Queued actions: Show total time and completion time',
                    type: 'checkbox',
                    default: true,
                },
                actionQueue_showValue: {
                    id: 'actionQueue_showValue',
                    label: 'Queued actions: Show profit/value for queued actions',
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
                actionQueue_completionTimeStyle: {
                    id: 'actionQueue_completionTimeStyle',
                    label: 'Queued actions: Completion display',
                    type: 'select',
                    default: 'absolute',
                    options: [
                        { value: 'absolute', label: 'Clock time only (Complete at 14:32)' },
                        { value: 'relative', label: 'Cumulative duration only (Complete in 3h 40m)' },
                        { value: 'both', label: 'Both' },
                    ],
                    help: 'How queued-action completion is shown in the Queued Actions popup and hover tooltip',
                },
            },
        },

        alchemy: {
            title: 'Alchemy',
            icon: '⚗️',
            settings: {
                alchemy_profitDisplay: {
                    id: 'alchemy_profitDisplay',
                    label: 'Alchemy panel: Show profit calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices',
                },
                alchemy_bestItems: {
                    id: 'alchemy_bestItems',
                    label: 'Alchemy panel: Show best items button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button to see items ranked by profit or XP for each alchemy type.',
                },
                alchemy_transmuteHistory: {
                    id: 'alchemy_transmuteHistory',
                    label: 'Alchemy panel: Track and view transmute session history',
                    type: 'checkbox',
                    default: true,
                    help: 'Records transmutation sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_coinifyHistory: {
                    id: 'alchemy_coinifyHistory',
                    label: 'Alchemy panel: Track and view coinify session history',
                    type: 'checkbox',
                    default: true,
                    help: 'Records coinify sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_decomposeHistory: {
                    id: 'alchemy_decomposeHistory',
                    label: 'Alchemy panel: Track and view decompose session history',
                    type: 'checkbox',
                    default: true,
                    help: 'Records decompose sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_actionProtection: {
                    id: 'alchemy_actionProtection',
                    label: 'Alchemy panel: Protect categories from accidental alchemy actions',
                    type: 'checkbox',
                    default: true,
                    help: 'Blocks alchemy action buttons for 3 seconds when the selected item belongs to a protected category. A shield icon appears in the alchemy panel to configure protected categories.',
                },
                alchemyItemDimming: {
                    id: 'alchemyItemDimming',
                    label: 'Alchemy panel: Dim items requiring higher level',
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        missingMaterials: {
            title: 'Missing Materials & Crafting Plan',
            icon: '🛒',
            settings: {
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
                actions_budgetCalculator: {
                    id: 'actions_budgetCalculator',
                    label: 'Action panel: Budget calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a budget input below the Missing Mats button. Enter a gold budget (e.g. 50m) to calculate how many units you can produce by buying missing tradeable materials at ask price.',
                },
                actions_costSummary: {
                    id: 'actions_costSummary',
                    label: 'Action panel: Show cost summary',
                    type: 'checkbox',
                    default: true,
                    help: 'Compact 4-line cost comparison for the selected produce quantity: direct recipe cost, missing direct mats, best crafting plan, and finished item market price.',
                },
                actionPanel_bestCraftingPlan: {
                    id: 'actionPanel_bestCraftingPlan',
                    label: 'Action panel: Show best crafting plan',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows the cheapest way to obtain a crafted item by comparing buy vs craft at each material tier.',
                },
                actionPanel_craftingPlanBuyIntermediates: {
                    id: 'actionPanel_craftingPlanBuyIntermediates',
                    label: 'Action panel: Crafting plan buys raw materials only',
                    type: 'checkbox',
                    default: false,
                    help: 'Always craft items that have a recipe — only buy uncraftable raw materials from the market.',
                },
                actionPanel_craftingPlanNoProcessing: {
                    id: 'actionPanel_craftingPlanNoProcessing',
                    label: 'Action panel: Crafting plan no processing',
                    type: 'checkbox',
                    default: false,
                    help: 'Only craft the final item — buy all sub-materials from the market instead of processing them yourself.',
                },
                actionPanel_craftingPlanTaskMode: {
                    id: 'actionPanel_craftingPlanTaskMode',
                    label: 'Action panel: Crafting plan task mode',
                    type: 'checkbox',
                    default: false,
                    help: 'Forces the final craft step (for task credit) but allows buying intermediate materials if cheaper.',
                },
                actionPanel_craftingPlanTimeCost: {
                    id: 'actionPanel_craftingPlanTimeCost',
                    label: 'Action panel: Crafting plan time cost',
                    type: 'checkbox',
                    default: false,
                    help: 'Factor in the time cost of crafting when deciding buy vs craft. Uses your gold/hr value to determine if crafting is worth your time.',
                },
                actionPanel_craftingPlanGoldPerHour: {
                    id: 'actionPanel_craftingPlanGoldPerHour',
                    label: 'Action panel: Crafting plan gold/hr value',
                    type: 'number',
                    default: 0,
                    help: 'Your time value in gold per hour. Used to calculate if crafting intermediates is worth the time. Set to your typical hourly profit (e.g., 500000).',
                },
                actionPanel_craftingPlanMatchQuantity: {
                    id: 'actionPanel_craftingPlanMatchQuantity',
                    label: 'Action panel: Crafting plan matches action quantity',
                    type: 'checkbox',
                    default: false,
                    help: 'Scale the Best Crafting Plan (shopping list, craft steps, totals) to the quantity entered in the action panel instead of always planning for 1.',
                },
                actions_artisanMaterialMode: {
                    id: 'actions_artisanMaterialMode',
                    label: 'Missing materials: Artisan requirement mode',
                    type: 'select',
                    default: 'expected',
                    options: [
                        { value: 'expected', label: 'Expected value (average)' },
                        { value: 'worst-case', label: 'Worst-case per action (ceil per craft)' },
                        { value: 'hybrid', label: 'Hybrid (ceil below 100 actions, average at 100+)' },
                    ],
                    help: 'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.',
                },
            },
        },

        lootLog: {
            title: 'Loot Log',
            icon: '📦',
            settings: {
                lootLogStats: {
                    id: 'lootLogStats',
                    label: 'Loot Log Statistics',
                    type: 'checkbox',
                    default: true,
                    help: 'Display total value, average time, and daily output in loot logs',
                },
                lootLogHistory: {
                    id: 'lootLogHistory',
                    label: 'Loot Log: Persist and display historical entries',
                    type: 'checkbox',
                    default: true,
                    help: 'Saves loot log entries and displays older entries below current ones in the loot log panel',
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
                itemTooltip_effectivePrices: {
                    id: 'itemTooltip_effectivePrices',
                    label: 'Show effective (after-tax) prices',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows what you actually receive after the 4% marketplace tax next to ask/bid prices in item tooltips',
                },
                itemTooltip_decomposeValue: {
                    id: 'itemTooltip_decomposeValue',
                    label: 'Show decompose value',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows the market value of what you would get from decomposing this item (ask/bid), below the Price line. This is a raw value of the components only - not netted against catalyst/coin costs or the 60% success rate - so you can compare it directly against selling the item outright.',
                },
                itemTooltip_enhancingHourlyRate: {
                    id: 'itemTooltip_enhancingHourlyRate',
                    label: 'Target hourly rate for enhancing (e.g. 50m)',
                    type: 'text',
                    default: '',
                    help: 'Adds a minimum sell price to the enhancement tooltip that covers total cost plus this rate for time spent. Leave blank to disable.',
                },
                itemTooltip_enhancingHourlyRateTax: {
                    id: 'itemTooltip_enhancingHourlyRateTax',
                    label: 'Include marketplace tax in minimum sell price',
                    type: 'checkbox',
                    default: false,
                    help: 'Accounts for the 4% marketplace seller tax so listing at minimum sell still nets your target rate after tax',
                },
                itemTooltip_artisanPrices: {
                    id: 'itemTooltip_artisanPrices',
                    label: 'Adjust tooltip prices for Artisan Tea reduction',
                    type: 'checkbox',
                    default: true,
                    help: 'When viewing a recipe on an action panel, adjusts the total price to reflect actual material cost after Artisan Tea reduction',
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
                    help: 'Displays best profit/hr highlighted, with other alternative actions (craft, coinify, decompose, transmute) summarized below',
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
                expectedValue_includeCowbells: {
                    id: 'expectedValue_includeCowbells',
                    label: 'Include cowbell value in expected value calculations',
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
                    label: 'Currency tooltips: Show shop values for tokens, seals, and cowbells',
                    type: 'checkbox',
                    default: true,
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
                abilityTooltip_effectiveTiming: {
                    id: 'abilityTooltip_effectiveTiming',
                    label: 'Show effective cooldown/cast time (with your stats)',
                    type: 'checkbox',
                    default: true,
                    help: 'Computes actual Cooldown/Cast Time from your current Ability Haste, Cast Speed, and Attack level, and shows it on ability tooltips when different from the base value.',
                },
                itemTooltip_enhancementMilestones: {
                    id: 'itemTooltip_enhancementMilestones',
                    label: 'Show enhancement milestones (+5/+7/+10/+12)',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows expected cost and XP to reach +5, +7, +10, and +12 on unenhanced equipment tooltips',
                },
                itemTooltip_enhancementPath: {
                    id: 'itemTooltip_enhancementPath',
                    label: 'Show enhancement path on enhanced items',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows the optimal enhancement path cost breakdown when hovering over enhanced (+1 to +20) items',
                },
                itemTooltip_pinTop: {
                    id: 'itemTooltip_pinTop',
                    label: 'Pin tooltips to top-center of screen',
                    type: 'checkbox',
                    default: false,
                    help: 'Forces item tooltips to always appear centered at the top of the screen instead of near the hovered item',
                },
                itemTooltip_hideInEnhanceSelector: {
                    id: 'itemTooltip_hideInEnhanceSelector',
                    label: 'Hide tooltip extras in enhance item selector',
                    type: 'checkbox',
                    default: false,
                    help: 'Suppresses injected tooltip content (prices, profit, milestones) when browsing items in the enhancement selector',
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

        enhancementSimulator: {
            title: 'Enhancement Simulator Settings',
            icon: '✨',
            settings: {
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
                enhanceSim_baseItemCraftingCost: {
                    id: 'enhanceSim_baseItemCraftingCost',
                    label: 'Enhancement path: Use crafting cost for base item if cheaper',
                    type: 'checkbox',
                    default: false,
                    help: 'When enabled, uses the lower of crafting cost or market price for the base item in enhancement path calculations, applied independently to both the Ask and Bid columns',
                },
                enhanceSim_autoTargetLevel: {
                    id: 'enhanceSim_autoTargetLevel',
                    label: 'Enhancement: Auto-fill target level on panel open (0 = disabled)',
                    type: 'number',
                    default: 0,
                    min: 0,
                    max: 20,
                    help: "When non-zero, automatically sets the Target Level input to this value whenever you open an item's enhancement panel. Re-applies each time you switch items.",
                },
                enhanceSim_autoProtectFrom: {
                    id: 'enhanceSim_autoProtectFrom',
                    label: 'Enhancement: Auto-fill optimal protect-from level when protection item is set',
                    type: 'checkbox',
                    default: false,
                    help: 'When enabled, automatically fills the Protect From Level input with the optimal (cheapest) value whenever a protection item is placed in the slot.',
                },
                enhanceSim_autoDetect: {
                    id: 'enhanceSim_autoDetect',
                    label: 'Auto-detect your stats (false = use settings below)',
                    type: 'checkbox',
                    default: false,
                    help: 'Most players should leave this off to see realistic professional enhancer costs',
                },
                enhanceSim_protectionMarketplaceButton: {
                    id: 'enhanceSim_protectionMarketplaceButton',
                    label: 'Protection item picker: Show "Buy Cheapest" marketplace button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button to the Protection item selector popup in the Enhancing panel that navigates to the Marketplace for the cheapest available protection option',
                },
                // --- ENHANCING ---
                enhanceSim_enhancingLevel: {
                    id: 'enhanceSim_enhancingLevel',
                    label: 'Enhancing skill level',
                    type: 'number',
                    default: 140,
                    min: 1,
                    max: 200,
                    help: 'Default: 140 (professional enhancer level)',
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_houseLevel: {
                    id: 'enhanceSim_houseLevel',
                    label: 'Observatory house room level',
                    type: 'number',
                    default: 8,
                    min: 0,
                    max: 8,
                    help: 'Default: 8 (max level)',
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_achievement: {
                    id: 'enhanceSim_achievement',
                    label: 'Achievement bonus (+0.2%)',
                    type: 'checkbox',
                    default: false,
                    help: 'Include enhancing achievement success bonus',
                    disabledBy: 'enhanceSim_autoDetect',
                },
                // --- GEAR (compact rows: checkbox + optional tier + enhancement level) ---
                enhanceSim_gear_enhancer: {
                    id: 'enhanceSim_gear_enhancer',
                    label: 'Enhancer',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'celestial', level: 13 },
                    tiers: [
                        { value: 'cheese', label: 'Cheese' },
                        { value: 'verdant', label: 'Verdant' },
                        { value: 'azure', label: 'Azure' },
                        { value: 'burble', label: 'Burble' },
                        { value: 'crimson', label: 'Crimson' },
                        { value: 'rainbow', label: 'Rainbow' },
                        { value: 'holy', label: 'Holy' },
                        { value: 'celestial', label: 'Celestial' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_gloves: {
                    id: 'enhanceSim_gear_gloves',
                    label: 'Gloves',
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_top: {
                    id: 'enhanceSim_gear_top',
                    label: 'Top',
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_bottoms: {
                    id: 'enhanceSim_gear_bottoms',
                    label: 'Bottoms',
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_neck: {
                    id: 'enhanceSim_gear_neck',
                    label: 'Neck',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: 'Philo' },
                        { value: 'speed', label: 'Speed' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_ring: {
                    id: 'enhanceSim_gear_ring',
                    label: 'Ring',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: 'Philo' },
                        { value: 'rarefind', label: 'Rare Find' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_earring: {
                    id: 'enhanceSim_gear_earring',
                    label: 'Earring',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: 'Philo' },
                        { value: 'rarefind', label: 'Rare Find' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_cape: {
                    id: 'enhanceSim_gear_cape',
                    label: 'Cape',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'normal', level: 5 },
                    tiers: [
                        { value: 'normal', label: 'Normal' },
                        { value: 'refined', label: 'Refined' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_guzzling: {
                    id: 'enhanceSim_gear_guzzling',
                    label: 'Guzzling',
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_charm: {
                    id: 'enhanceSim_gear_charm',
                    label: 'Charm',
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'grandmaster', level: 0 },
                    tiers: [
                        { value: 'trainee', label: 'Trainee' },
                        { value: 'basic', label: 'Basic' },
                        { value: 'advanced', label: 'Advanced' },
                        { value: 'expert', label: 'Expert' },
                        { value: 'master', label: 'Master' },
                        { value: 'grandmaster', label: 'Grandmaster' },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                // --- BUFFS ---
                enhanceSim_tea: {
                    id: 'enhanceSim_tea',
                    label: 'Enhancing tea',
                    type: 'select',
                    default: 'ultra',
                    options: [
                        { value: 'none', label: 'None' },
                        { value: 'basic', label: 'Enhancing Tea (+3)' },
                        { value: 'super', label: 'Super Enhancing Tea (+6)' },
                        { value: 'ultra', label: 'Ultra Enhancing Tea (+8)' },
                    ],
                    help: 'Enhancing tea provides skill level bonus',
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_blessedTea: {
                    id: 'enhanceSim_blessedTea',
                    label: 'Blessed Tea active',
                    type: 'checkbox',
                    default: true,
                    help: 'Professional enhancers use this to reduce attempts',
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_communityBuff: {
                    id: 'enhanceSim_communityBuff',
                    label: 'Community Buff',
                    type: 'enhanceGear',
                    default: { enabled: true, level: 1 },
                    help: 'Enhancing speed community buff. Checked = auto-detect from game.',
                    checkedMeansAuto: true,
                    disabledBy: 'enhanceSim_autoDetect',
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
                enhancementXPH: {
                    id: 'enhancementXPH',
                    label: 'Enhancement: XPH calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Ranks all enhanceable items by expected XP per hour at your current stats',
                },
                enhancementXPH_maxLevel: {
                    id: 'enhancementXPH_maxLevel',
                    label: 'Enhancement XPH: Default max enhancement level (1–20)',
                    type: 'text',
                    default: '6',
                },
                enhancementXPH_protectFrom: {
                    id: 'enhancementXPH_protectFrom',
                    label: 'Enhancement XPH: Default protect from level (0 = no protection)',
                    type: 'text',
                    default: '0',
                },
            },
        },

        riskOfRuin: {
            title: 'Risk of Ruin',
            icon: '🎲',
            settings: {
                riskOfRuin: {
                    id: 'riskOfRuin',
                    label: 'Enable Risk of Ruin calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a standalone calculator estimating the chance of hitting 0 gold before reaching a target number of dungeon chests, alchemy Transmute actions, or an enhancement level.',
                },
                riskOfRuin_trials: {
                    id: 'riskOfRuin_trials',
                    label: 'Risk of Ruin: Monte Carlo trial count',
                    type: 'text',
                    default: '10000',
                    help: 'Higher trial counts give a more precise probability estimate at the cost of a slower calculation.',
                },
            },
        },

        marketplace: {
            title: 'Marketplace',
            icon: '🏪',
            settings: {
                sellQueue: {
                    id: 'sellQueue',
                    label: 'Sell Queue (Shift+RightClick inventory items)',
                    type: 'checkbox',
                    default: true,
                    help: 'Shift+RightClick an inventory item to open the marketplace and create a tab for it. Tabs close automatically when the item sells out.',
                },
                networkAlert: {
                    id: 'networkAlert',
                    label: 'Show alert when market price data cannot be fetched',
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
                market_autoFillBuyStrategy: {
                    id: 'market_autoFillBuyStrategy',
                    label: 'Auto-fill buy price strategy',
                    type: 'select',
                    default: 'outbid',
                    options: [
                        { value: 'outbid', label: 'Outbid by 1 (best buy + 1)' },
                        { value: 'match', label: 'Match best buy price' },
                        { value: 'undercut', label: 'Undercut by 1 (best buy - 1)' },
                    ],
                    help: 'When creating buy listings, choose whether to outbid, match, or undercut the current best buy price',
                },
                market_autoClickMax: {
                    id: 'market_autoClickMax',
                    label: 'Auto-click Max button on sell listing dialogs',
                    type: 'checkbox',
                    default: true,
                    help: 'Automatically clicks the Max button in the quantity field when opening Sell listing dialogs',
                },
                market_quickInputButtons: {
                    id: 'market_quickInputButtons',
                    label: 'Marketplace: Quick input buttons on order dialogs',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds 10, 100, 1000 preset quantity buttons to buy/sell dialogs',
                },
                market_quickInputButtons_presets: {
                    id: 'market_quickInputButtons_presets',
                    label: 'Marketplace: Custom quick input presets',
                    type: 'text',
                    default: '',
                    help: 'Comma-separated preset values (e.g. 50,500,5000). Leave blank for defaults (10, 100, 1000). Max 8 values.',
                },
                market_multiplierButtons: {
                    id: 'market_multiplierButtons',
                    label: 'Marketplace: ÷2 and ×2 buttons on order dialogs',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds ÷2 and ×2 buttons to the price and quantity rows in buy/sell dialogs',
                },
                market_showOwnedInBuyModal: {
                    id: 'market_showOwnedInBuyModal',
                    label: 'Marketplace: Show owned count in buy dialogs',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays how many of the item you currently own in Buy Now and Buy Listing modals',
                },
                market_marketplaceShortcuts: {
                    id: 'market_marketplaceShortcuts',
                    label: 'Marketplace: Show "Marketplace Action" button on item menus',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Marketplace Action dropdown to item menus with Sell Now, Buy Now, and listing shortcuts',
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
                market_collectableListingsToTop: {
                    id: 'market_collectableListingsToTop',
                    label: 'Market: Move collectable listings to top of My Listings',
                    type: 'checkbox',
                    default: true,
                    help:
                        'Listings with something to collect are moved to the top so you can see what "Collect All" ' +
                        'grabbed without scrolling. Manually sorting a column takes over until sort is cleared',
                },
                market_listingRefreshNavigator: {
                    id: 'market_listingRefreshNavigator',
                    label: 'Market: Show Refresh/Next buttons for cycling My Listings',
                    type: 'checkbox',
                    default: true,
                    help:
                        'Adds a "Refresh" button on My Listings that opens your first listing\'s order book, then a ' +
                        '"Next" button on each listing\'s page to move to the next one, ending in "Back to My Listings"',
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
                    label: 'Time format for date/time display',
                    type: 'select',
                    default: '24hour',
                    options: [
                        { value: '24hour', label: '24-hour (14:30)' },
                        { value: '12hour', label: '12-hour (2:30 PM)' },
                    ],
                    help: 'Time format used in marketplace listings, action completion times, and chat timestamps',
                },
                market_listingDateFormat: {
                    id: 'market_listingDateFormat',
                    label: 'Date format for date/time display',
                    type: 'select',
                    default: 'MM-DD',
                    options: [
                        { value: 'MM-DD', label: 'MM-DD (01-13)' },
                        { value: 'DD-MM', label: 'DD-MM (13-01)' },
                    ],
                    help: 'Date format used in marketplace listings, action completion times, and chat timestamps',
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
                market_depthCapEnabled: {
                    id: 'market_depthCapEnabled',
                    label: 'Market: Show sell depth cap (Risk of Ruin)',
                    type: 'checkbox',
                    default: true,
                    help: "Shows how many actions worth of the currently-viewed item the order book can profitably absorb, based on the last Risk of Ruin calculation. Ignores the marketplace's tradable range floor, which isn't exposed in game data.",
                },
            },
        },

        pricingProfit: {
            title: 'Pricing & Profit',
            icon: '💹',
            settings: {
                marketData_outlierGuardEnabled: {
                    id: 'marketData_outlierGuardEnabled',
                    label: 'Guard against absurd marketplace listings',
                    type: 'checkbox',
                    default: true,
                    help: "Applies everywhere Toolasha reads a market price (profit calculators, net worth, upgrade advisor, etc.). When a live ask/bid is wildly outside the band around the game's own reference market value, Toolasha substitutes the reference value instead and marks the affected number with a ⚠ so you can see where this happened.",
                },
                marketData_outlierBandMultiplier: {
                    id: 'marketData_outlierBandMultiplier',
                    label: 'Outlier band multiplier',
                    type: 'number',
                    default: 3,
                    min: 1.5,
                    max: 20,
                    step: 0.5,
                    help: 'A live price counts as an outlier when it is more than this many times above or below the reference value (e.g. 3 = outside 1/3x-3x the reference). Only applies to items the reference dataset actually covers.',
                },
                profitCalc_pricingMode: {
                    id: 'profitCalc_pricingMode',
                    label: 'Profit calculation pricing mode',
                    type: 'select',
                    default: 'hybrid',
                    options: [
                        { value: 'conservative', label: 'Buy: Ask / Sell: Bid (Instant Buy / Instant Sell)' },
                        { value: 'hybrid', label: 'Buy: Ask / Sell: Ask (Instant Buy / Patient Sell)' },
                        { value: 'optimistic', label: 'Buy: Bid / Sell: Ask (Patient Buy / Patient Sell)' },
                        { value: 'patientBuy', label: 'Buy: Bid / Sell: Bid (Patient Buy / Instant Sell)' },
                    ],
                },
                profitCalc_pricingNaming: {
                    id: 'profitCalc_pricingNaming',
                    label: 'Pricing mode naming convention',
                    type: 'checkbox',
                    default: false,
                    help: 'Show pricing modes as "Instant Buy / Instant Sell" instead of "Buy: Ask / Sell: Bid"',
                },
                profitCalc_keyPricingMode: {
                    id: 'profitCalc_keyPricingMode',
                    label: 'Key pricing mode',
                    type: 'select',
                    default: 'ask',
                    options: [
                        { value: 'ask', label: 'Ask (instant buy)' },
                        { value: 'bid', label: 'Bid (patient buy)' },
                        { value: 'cheapest', label: 'Cheapest (buy or craft)' },
                    ],
                    help: 'How to value dungeon keys in tooltips, networth, and combat income calculations: ask (instant buy), bid (patient buy), or cheapest (compares buying to crafting the key yourself, using Best Crafting Plan’s engine and your Profit calculation pricing mode’s buy-side basis).',
                },
                profitCalc_customPriceOverrides: {
                    id: 'profitCalc_customPriceOverrides',
                    label: 'Custom price overrides',
                    type: 'customPriceOverrides',
                    default: {},
                    help: 'Set custom buy/sell prices for specific items. Overrides marketplace prices in profit calculations.',
                },
                profitCalc_craftUpgradeItems: {
                    id: 'profitCalc_craftUpgradeItems',
                    label: 'Profit: Use crafting cost for upgrade items if cheaper',
                    type: 'checkbox',
                    default: true,
                    help: 'When enabled, uses crafting cost instead of market price for upgrade items if cheaper, and factors crafting time into profit/hr calculations.',
                },
                profitCalc_excludeSellTax: {
                    id: 'profitCalc_excludeSellTax',
                    label: 'Profit: Exclude sell tax (producing for personal use)',
                    type: 'checkbox',
                    default: false,
                    help: "When enabled, Net Profit / Profit per hour assumes you keep what you produce instead of selling it, so the marketplace sell tax is not deducted from output value. Use for dungeon keys, food/drinks, labyrinth consumables, or anything else you don't plan to sell. This makes profit numbers higher than what you'd actually get by selling the output - a warning indicator appears while this is on.",
                },
                offlineProgressEconomics: {
                    id: 'offlineProgressEconomics',
                    label: 'Offline Progress: Show Revenue/Cost/Profit summary',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Revenue/Cost/Profit summary (with per-day projections) to the native Welcome Back modal, using your Pricing & Profit settings.',
                },
            },
        },

        inventoryNetWorth: {
            title: 'Inventory & Net Worth',
            icon: '💎',
            settings: {
                networth: {
                    id: 'networth',
                    label: 'Top right: Show gold count',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays your current gold count next to Total Level in the page header',
                },
                invWorth: {
                    id: 'invWorth',
                    label: 'Below inventory: Show net worth breakdown',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows total net worth with a per-category breakdown (equipment, inventory, listings, houses, abilities) below the inventory panel',
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
                    help: 'Displays per-item ask and bid prices on inventory items',
                },
                invCategoryTotals: {
                    id: 'invCategoryTotals',
                    label: 'Show category totals in inventory',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays the total market value of all items in each inventory category',
                },
                networth_pricingMode: {
                    id: 'networth_pricingMode',
                    label: 'Net worth pricing mode',
                    type: 'select',
                    default: 'ask',
                    options: [
                        { value: 'ask', label: 'Ask price (patient sell value)' },
                        { value: 'bid', label: 'Bid price (instant liquidation value)' },
                    ],
                    help: 'Ask shows what you could get by listing patiently. Bid shows what you could get by selling instantly.',
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
                networth_historyChart: {
                    id: 'networth_historyChart',
                    label: 'Enable net worth history chart',
                    type: 'checkbox',
                    default: true,
                    help: 'Records hourly net worth snapshots and shows a chart icon next to Total Net Worth. Disable to stop tracking and hide the chart button.',
                },
                autoAllButton: {
                    id: 'autoAllButton',
                    label: 'Auto-click "All" button when opening loot boxes',
                    type: 'checkbox',
                    default: true,
                    help: 'Automatically clicks the "All" button when opening openable containers (crates, chests, caches)',
                },
                autoAllButton_excludeSeals: {
                    id: 'autoAllButton_excludeSeals',
                    label: 'Auto-click "All": Skip Scroll of... items',
                    type: 'checkbox',
                    default: true,
                    help: 'When enabled, Scroll of... items from the Labyrinth are not auto-opened',
                },
                openableAnalytics: {
                    id: 'openableAnalytics',
                    label: 'Openable Analytics: Track Actual vs Expected Value + Luck',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows Actual Value, Expected Value, and Luck for chests/crates/caches you open, plus a character-scoped Analytics view with session/lifetime history',
                },
                openableAnalytics_sidePanel: {
                    id: 'openableAnalytics_sidePanel',
                    label: 'Openable Analytics: Show Current/History side panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Pins a panel to the left of the Opened Loot window with Opened, Income, Profit, Luck, Expected income, and vs. expected for the current opening and its lifetime history',
                },
            },
        },

        inventoryTabs: {
            title: 'Custom Inventory Tabs',
            icon: '🗂️',
            settings: {
                inventoryTabs: {
                    id: 'inventoryTabs',
                    label: 'Custom Inventory Tabs: Enable',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Toolasha tab to the character panel where you can organize inventory items into personal tabs.',
                },
                inventoryTabs_showUnorganized: {
                    id: 'inventoryTabs_showUnorganized',
                    label: 'Custom Inventory Tabs: Show Unorganized bucket',
                    type: 'checkbox',
                    default: true,
                    help: 'Show an "Unorganized" section containing all items not assigned to any tab.',
                },
                inventoryTabs_categoryAddAll: {
                    id: 'inventoryTabs_categoryAddAll',
                    label: 'Custom Inventory Tabs: Add all items when adding category',
                    type: 'checkbox',
                    default: false,
                    hidden: true,
                    help: 'When adding a category to a tab, add every item in that category (including items not in your inventory). When disabled, only items currently in your inventory are added.',
                },
                inventoryTabs_defaultTab: {
                    id: 'inventoryTabs_defaultTab',
                    label: 'Custom Inventory Tabs: Show Toolasha tab by default',
                    type: 'checkbox',
                    default: false,
                    help: 'Hides the native Inventory tab and automatically activates the Toolasha tab whenever the character panel opens.',
                },
                inventoryTabs_tileGap: {
                    id: 'inventoryTabs_tileGap',
                    label: 'Custom Inventory Tabs: Item spacing (px)',
                    type: 'number',
                    default: 4,
                    min: 0,
                    max: 20,
                    step: 1,
                    help: 'Pixel gap between item tiles on the Toolasha tab.',
                },
                inventoryTabs_loadoutIncludeConsumables: {
                    id: 'inventoryTabs_loadoutIncludeConsumables',
                    label: 'Custom Inventory Tabs: Include food & drinks when adding from loadout',
                    type: 'checkbox',
                    default: false,
                    help: 'When adding items from a loadout to a tab, also include food and drink items.',
                },
                inventoryTabs_topTabPriority: {
                    id: 'inventoryTabs_topTabPriority',
                    label: 'Custom Inventory Tabs: Items visible in topmost tab only',
                    type: 'checkbox',
                    default: true,
                    help: 'When an item appears in multiple tabs, it only shows in the highest (topmost) tab that contains it. When disabled, collapsing a tab releases its items to lower tabs.',
                },
            },
        },

        skills: {
            title: 'Skills',
            icon: '📚',
            settings: {
                simulateScrollEffects: {
                    id: 'simulateScrollEffects',
                    label: 'Skills: Simulate missing scroll effects in calculations',
                    type: 'checkboxWithButton',
                    buttonLabel: 'Defaults...',
                    default: false,
                    help: 'When enabled, profit/XP/speed calculations show hypothetical results as if selected scrolls were active. Configure default scrolls with the button; override per-loadout from the Loadouts panel.',
                },
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
                drinkTimer: {
                    id: 'drinkTimer',
                    label: 'Drink timer: Show remaining tea time in consumables box',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays remaining drink supply time and queue coverage under the consumables slots on Gathering/Production, Alchemy, and Enhancing action panels.',
                },
                drinkTimer_warningThreshold: {
                    id: 'drinkTimer_warningThreshold',
                    label: 'Drink timer: warning threshold (hours)',
                    type: 'number',
                    default: 24,
                    help: 'Show an amber warning on drink time displays when remaining supply falls below this many hours.',
                },
                skillingOptimizer: {
                    id: 'skillingOptimizer',
                    label: 'Skilling Simulator/Optimizer: Enable Optimizer tab in character panel',
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
                eliteAchievementReminder: {
                    id: 'eliteAchievementReminder',
                    label: 'Profile panel: Show Elite achievement reminder icon',
                    type: 'checkbox',
                    default: true,
                    help: "Shows a ✉️ icon next to a player's name if they haven't completed Elite achievements; click to pre-fill a whisper.",
                },
                eliteAchievementReminderMessage: {
                    id: 'eliteAchievementReminderMessage',
                    label: 'Elite achievement reminder: whisper message',
                    type: 'text',
                    default: 'Be Elite. Do your Elite achievements.',
                    help: 'Message pre-filled into chat when the Elite achievement reminder icon is clicked.',
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
                labyrinthTracker: {
                    id: 'labyrinthTracker',
                    label: 'Labyrinth best level tracker',
                    type: 'checkbox',
                    default: true,
                    help: 'Tracks the highest recommended level enemy defeated per monster type and shows it in the Automation tab',
                },
                labyrinthShopPrices: {
                    id: 'labyrinthShopPrices',
                    label: 'Labyrinth Shop: Show market prices',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows ask/bid market prices on tradeable items in the Labyrinth Shop tab',
                },
                labyrinthClearRate: {
                    id: 'labyrinthClearRate',
                    label: 'Labyrinth clear rate calculator',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows expected clear time and success rate on labyrinth skilling room tiles',
                },
                labyrinthMissingSuppliesButton: {
                    id: 'labyrinthMissingSuppliesButton',
                    label: 'Labyrinth: Show "Buy Missing Supplies" button',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a button next to the Supplies section that opens the marketplace with tabs for whatever Torch/Shroud/Beacon tier is short of its carry cap',
                },
                labyrinthRecommendTargetRate: {
                    id: 'labyrinthRecommendTargetRate',
                    label: 'Labyrinth: Recommend target clear rate (%)',
                    type: 'number',
                    default: 70,
                    min: 1,
                    max: 100,
                    step: 1,
                    help: 'Default target clear rate for labyrinth skip threshold recommendations',
                },
                labyrinthRecommendSimHours: {
                    id: 'labyrinthRecommendSimHours',
                    label: 'Labyrinth: Recommend sim hours per step',
                    type: 'number',
                    default: 1,
                    min: 1,
                    max: 100,
                    step: 1,
                    help: 'Default hours of combat simulation per binary search step in recommendations',
                },
                labyrinthLiveProgress: {
                    id: 'labyrinthLiveProgress',
                    label: 'Labyrinth: Show live clear chance',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows live clear chance during active labyrinth skilling/enhancing rooms',
                },
                combatBattleCounter: {
                    id: 'combatBattleCounter',
                    label: 'Show battle/wave counter in current action panel during combat',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays "Battle #N" for regular zones or "Wave N" for dungeons in the top-left action panel',
                },
                combatSummary: {
                    id: 'combatSummary',
                    label: 'Combat Summary: Add rate stats to Battle Info panel',
                    type: 'checkbox',
                    default: true,
                    help:
                        'Adds encounters/hour, revenue, and experience rates to the Battle Info panel for the ' +
                        'currently-viewed unit',
                },
                combatSim: {
                    id: 'combatSim',
                    label: 'Combat Simulator',
                    type: 'checkbox',
                    default: true,
                    help: 'Simulate combat encounters to estimate XP/hr, deaths, and consumable usage',
                },
                labSim: {
                    id: 'labSim',
                    label: 'Lab Simulator',
                    type: 'checkbox',
                    default: true,
                    help: 'Simulate labyrinth runs to estimate performance across skills and combat',
                },
                combatSim_defaultHours: {
                    id: 'combatSim_defaultHours',
                    label: 'Combat Simulator: Default hours (single zone)',
                    type: 'number',
                    default: 100,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: 'Default simulation duration in hours for single-zone runs',
                },
                combatSim_allZonesDefaultHours: {
                    id: 'combatSim_allZonesDefaultHours',
                    label: 'Combat Simulator: Default hours (All Zones)',
                    type: 'number',
                    default: 10,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: 'Default simulation duration in hours for All Zones runs',
                },
                combatSim_seekDefaultHours: {
                    id: 'combatSim_seekDefaultHours',
                    label: 'Combat Simulator: Default hours (Seek)',
                    type: 'number',
                    default: 10,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: 'Default simulation duration in hours for Seek Best Source runs',
                },
                combatSim_decimalMinutes: {
                    id: 'combatSim_decimalMinutes',
                    label: 'Combat Simulator: Show completion time as decimal minutes',
                    type: 'checkbox',
                    default: false,
                    help: 'Display avg completion time as "X.XX min" instead of "Xm Ys"',
                },
                combatSim_defaultLoadout: {
                    id: 'combatSim_defaultLoadout',
                    label: 'Combat Simulator: Default loadout',
                    type: 'select',
                    default: '',
                    options: () => {
                        const snapshot = window.Toolasha?.Core?.loadoutState;
                        const loadouts = snapshot
                            ? snapshot
                                  .getAllSnapshots()
                                  .filter((s) => !s.actionTypeHrid || s.actionTypeHrid === '/action_types/combat')
                            : [];
                        // Labels are translated in settings-ui.js: '' resolves via the options._empty
                        // locale key and the ' (Unavailable)' suffix via settingsSchema.selectUnavailableSuffix.
                        return [
                            { value: '', label: 'Current Gear' },
                            ...loadouts.map((s) => ({
                                value: s.name,
                                label: s.isUsableForCalculation ? s.name : `${s.name} (Unavailable)`,
                            })),
                        ];
                    },
                    help: 'Loadout to use by default for combat estimates instead of currently equipped gear',
                },
                combatSim_autoEstimate: {
                    id: 'combatSim_autoEstimate',
                    label: 'Combat Simulator: Auto-run estimate on task cards',
                    type: 'checkbox',
                    default: false,
                    help: 'Automatically run combat estimates using the default loadout when task cards appear',
                },
                combatSim_maxThreads: {
                    id: 'combatSim_maxThreads',
                    label: 'Combat Simulator: Max threads',
                    type: 'number',
                    default: 0,
                    min: 0,
                    max: 32,
                    help: 'Maximum Web Worker threads for simulations (0 = auto, uses all available cores)',
                },
                combatSim_upgradeSkipSkillingRooms: {
                    id: 'combatSim_upgradeSkipSkillingRooms',
                    label: 'Combat Simulator: Upgrade Advisor - skip skilling house rooms',
                    type: 'checkbox',
                    default: true,
                    help:
                        'House Rooms Upgrade mode: skip simulating rooms with no combat stat bonus (Brewery, Garden, ' +
                        'etc.) to save sim time. They still get a tiny Wisdom/Rare Find bonus like every room, so ' +
                        'turn this off to see their (usually negligible) Gold/EXP and Gold/Profit values too.',
                },
                combatStats: {
                    id: 'combatStats',
                    label: 'Combat Statistics: Show Statistics tab in Combat panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details',
                },
                combatStats_runwayWarningThreshold: {
                    id: 'combatStats_runwayWarningThreshold',
                    label: 'Combat Statistics: consumable runway warning threshold (hours)',
                    type: 'number',
                    default: 12,
                    help: 'Highlight combat consumables projected to run out within this many hours. Set to 0 to disable warnings.',
                },
                combatStats_showLootLuck: {
                    id: 'combatStats_showLootLuck',
                    label: 'Combat Statistics: Show Loot Luck comparison',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows the Actual vs Expected drop-rate/profit comparison and Loot Luck delta in the Statistics panel.',
                },
                combatConsumableTimer: {
                    id: 'combatConsumableTimer',
                    label: 'Combat consumable timer: Show remaining food/drink time during battle',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows each active combat food/drink\'s estimated remaining runway below its icon in the Consumables list during battle. Requires "Combat Statistics" to be enabled - the estimate comes from its consumption tracker.',
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
                taskSpeedBreakdown: {
                    id: 'taskSpeedBreakdown',
                    label: 'Show expandable speed & time breakdown on tasks',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays an expandable action speed, efficiency, and timing breakdown on task cards.',
                },
                taskCombatEstimate: {
                    id: 'taskCombatEstimate',
                    label: 'Show combat estimate on combat tasks',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a loadout dropdown and estimate button on combat task cards.',
                },
                taskEfficiencyRating: {
                    id: 'taskEfficiencyRating',
                    label: 'Show task efficiency rating (tokens/profit per hour)',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a color-graded efficiency score based on expected completion time.',
                },
                taskMaterialsIndicator: {
                    id: 'taskMaterialsIndicator',
                    label: 'Show materials availability on production tasks',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows how many task actions you can complete with current inventory.',
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
                taskQueuedIndicator: {
                    id: 'taskQueuedIndicator',
                    label: 'Show "Queued" indicator on task cards',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a status message on task cards when their action is in your action queue',
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
                taskSorter_hideButton: {
                    id: 'taskSorter_hideButton',
                    label: 'Hide Sort Tasks button',
                    type: 'checkbox',
                    default: false,
                    help: 'Hides the Sort Tasks button while keeping auto-sort functional',
                },
                taskSorter_sortMode: {
                    id: 'taskSorter_sortMode',
                    label: 'Task sort mode',
                    type: 'select',
                    default: 'skill',
                    options: [
                        { value: 'skill', label: 'Skill / Zone' },
                        { value: 'time', label: 'Time to Completion' },
                        { value: 'protection', label: 'Protection (unprotected first)' },
                    ],
                    help: 'How tasks are ordered when clicking Sort Tasks. "Time to Completion" sorts fastest tasks first; combat and completed tasks go to the bottom. "Protection" puts unprotected tasks first.',
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
                taskClaimCollector: {
                    id: 'taskClaimCollector',
                    label: 'Move Claim Reward buttons to top of task list',
                    type: 'checkbox',
                    default: true,
                    help: 'Moves all Claim Reward buttons to a stack at the top of the task list so you can click the same spot repeatedly to claim all completed tasks',
                },
                taskGoMerge: {
                    id: 'taskGoMerge',
                    label: 'Merge duplicate tasks on Go',
                    type: 'checkbox',
                    default: true,
                    help: 'When clicking Go on a task, combines the required amounts of all in-progress tasks for the same action into a single pre-filled count',
                },
                taskRerollProtection: {
                    id: 'taskRerollProtection',
                    label: 'Task reroll protection',
                    type: 'checkbox',
                    default: true,
                    help: 'Protect specific tasks from accidental rerolling. Protected tasks get a green highlight and require a confirmation click before rerolling. A shield icon appears in the task panel to configure protected zones.',
                },
                taskRerollProtection_hideHighlight: {
                    id: 'taskRerollProtection_hideHighlight',
                    label: 'Task reroll protection: Hide green highlight',
                    type: 'checkbox',
                    default: false,
                    help: 'Removes the green outline/glow from protected tasks while keeping the reroll confirmation active.',
                },
                taskAutoReroll: {
                    id: 'taskAutoReroll',
                    label: 'Task auto-reroll reminder',
                    type: 'checkbox',
                    default: true,
                    help: 'Highlights tasks you want to reroll with a red border and reminder badge. Configure per-character via the target icon in the task panel.',
                },
                taskTokenThreshold: {
                    id: 'taskTokenThreshold',
                    label: 'Flag tasks by Task Token reward for reroll',
                    type: 'checkbox',
                    default: true,
                    help: 'Highlights tasks whose Task Token reward crosses a configurable cutoff (below or above) with the same red border and reminder badge as auto-reroll. Does not click or reroll anything automatically. Configure the cutoff and direction per-character via the icon in the task panel.',
                },
            },
        },

        ui: {
            title: 'UI & Appearance',
            icon: '🎨',
            settings: {
                draggableModals: {
                    id: 'draggableModals',
                    label: 'Draggable modals',
                    type: 'checkbox',
                    default: true,
                    help: 'Makes game popup modals draggable. Position is remembered per modal type across sessions.',
                },
                formatting_useKMBFormat: {
                    id: 'formatting_useKMBFormat',
                    label: 'Number format mode',
                    type: 'select',
                    default: 'compact',
                    options: [
                        { value: 'full', label: 'Full (1,250,000)' },
                        { value: 'threshold', label: 'Abbreviate after 4 digits (1,250K)' },
                        { value: 'compact', label: 'Always abbreviate (1.25M)' },
                    ],
                    help: 'Controls how large numbers are displayed throughout the UI',
                },
                formatting_precision: {
                    id: 'formatting_precision',
                    label: 'Abbreviation precision (decimal digits)',
                    type: 'select',
                    default: '2',
                    options: [
                        { value: '1', label: '1 digit (1.2M)' },
                        { value: '2', label: '2 digits (1.25M)' },
                        { value: '3', label: '3 digits (1.250M)' },
                        { value: '4', label: '4 digits (1.2500M)' },
                    ],
                    help: 'Number of decimal places shown when numbers are abbreviated with K/M/B suffixes',
                },
                ui_externalLinks: {
                    id: 'ui_externalLinks',
                    label: 'Left sidebar: Show external tool links',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy',
                },
                hideLabyrinthBadge: {
                    id: 'hideLabyrinthBadge',
                    label: 'Left sidebar: Hide Labyrinth ping badge',
                    type: 'checkbox',
                    default: false,
                },
                hideGuildBadge: {
                    id: 'hideGuildBadge',
                    label: 'Left sidebar: Hide Guild notification badge',
                    type: 'checkbox',
                    default: false,
                },
                hideNavBarGlow: {
                    id: 'hideNavBarGlow',
                    label: 'Left sidebar: Hide active skill glow effect',
                    type: 'checkbox',
                    default: false,
                    help: "Removes the game's pulsing orange glow animation from the currently active skill's icon in the left navigation bar.",
                },
                tabReorder: {
                    id: 'tabReorder',
                    label: 'Character panel: Drag-and-drop tab reordering',
                    type: 'checkbox',
                    default: true,
                    help: 'Drag tabs to rearrange the order of Inventory, Toolasha, Equipment, Houses, Abilities, and Loadout. Order persists through refresh.',
                },
                expPercentage: {
                    id: 'expPercentage',
                    label: 'Left sidebar: Show skill XP percentages',
                    type: 'checkbox',
                    default: true,
                },
                combatLevelProgress: {
                    id: 'combatLevelProgress',
                    label: 'Left sidebar: Show decimal Combat Level',
                    type: 'checkbox',
                    default: true,
                    help: "Shows the unrounded Combat Level formula value from current whole skill levels (e.g. 133.2). MWI's native sidebar floors it to an integer for display.",
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
                loadoutSnapshot: {
                    id: 'loadoutSnapshot',
                    label: 'Loadouts: Use saved loadouts in profit/action calculations',
                    type: 'checkbox',
                    default: true,
                    help: "When you queue an action, Toolasha predicts its XP, time, and profit using the current saved game loadout for that skill (skill-default → all-skills-default → matching saved loadout → currently-equipped). 'Use highest enhancement level' is resolved from what you currently own. Unavailable saved equipment makes the prediction fall back to the proven currently-equipped setup; unavailable saved food/drinks do not invalidate the loadout and their missing slots are omitted. Disable to always predict using currently-equipped gear.",
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
            },
        },

        guild: {
            title: 'Guild',
            icon: '👥',
            settings: {
                guildXPTracker: {
                    id: 'guildXPTracker',
                    label: 'Track guild and member XP over time',
                    type: 'checkbox',
                    default: true,
                    help: 'Records guild and member XP data from WebSocket messages for XP/hr calculations on the Guild panel.',
                },
                guildXPDisplay: {
                    id: 'guildXPDisplay',
                    label: 'Show XP/hr stats on Guild panel',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays XP/hr rates, rankings, and a weekly chart on the Guild Overview, Members, and Guild Leaderboard tabs. Disable the standalone Guild XP/h userscript if using this.',
                },
                guildIdleDisplay: {
                    id: 'guildIdleDisplay',
                    label: 'Guild Overview: Show idle members list',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays a list of guild members who are currently idle (not performing any action) on the Guild Overview tab.',
                },
                guildTrialSignupDisplay: {
                    id: 'guildTrialSignupDisplay',
                    label: 'Guild Trials: Show unsigned members list',
                    type: 'checkbox',
                    default: true,
                    help: "Displays which guild members have not yet signed up for the current week's skilling and combat trials.",
                },
                guildTrialWhisperTemplate: {
                    id: 'guildTrialWhisperTemplate',
                    label: 'Guild Trials: Whisper message when clicking a name',
                    type: 'text',
                    default: "/w {name} Why haven't you signed up for your trial(s) yet?!",
                    help: "Message pre-filled in chat when clicking an unsigned member's name. Use {name} for the player's name.",
                    templateVariables: [
                        { key: '{name}', label: 'Player Name', description: 'The name of the unsigned guild member' },
                    ],
                },
                guildMembersActivityTab: {
                    id: 'guildMembersActivityTab',
                    label: 'Guild Members: Show Activity column on',
                    type: 'select',
                    default: 'contributions',
                    options: [
                        { value: 'status', label: 'Status tab only (native)' },
                        { value: 'contributions', label: 'Contributions tab only' },
                        { value: 'both', label: 'Both tabs' },
                    ],
                    help: 'Controls where the Activity column appears. "Contributions tab only" hides the native column on Status and shows it on Contributions instead.',
                },
                guildMembersShowGameMode: {
                    id: 'guildMembersShowGameMode',
                    label: 'Guild Members: Show Game Mode column',
                    type: 'checkbox',
                    default: false,
                    help: 'Shows the MC/IC/LC game mode column (Status tab).',
                },
                guildMembersShowJoined: {
                    id: 'guildMembersShowJoined',
                    label: 'Guild Members: Show Joined column',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows the date each member joined the guild (Status tab).',
                },
                guildMembersShowLastXPH: {
                    id: 'guildMembersShowLastXPH',
                    label: 'Guild Members: Show Last XP/h column',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows recent XP/hr tracked by Toolasha (Contributions tab).',
                },
                guildMembersShowLastDayXPH: {
                    id: 'guildMembersShowLastDayXPH',
                    label: 'Guild Members: Show Last day XP/h column',
                    type: 'checkbox',
                    default: true,
                    help: 'Shows 24-hour average XP/hr tracked by Toolasha (Contributions tab).',
                },
                guildCreditValue: {
                    id: 'guildCreditValue',
                    label: 'Guild Shop: Show gold cost per credit table',
                    type: 'checkbox',
                    default: true,
                    help: 'Injects a cost-efficiency table into each guild credit exchange modal, sorted cheapest first using your profit pricing mode.',
                },
                guildTokenValueComparison: {
                    id: 'guildTokenValueComparison',
                    label: 'Guild Shop: Show Guild Token gold-value comparison',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a Guild Token row to the credit exchange cost table, and a Guild Credit Value table to the Guild Token tooltip, showing gold/token via the cheapest tradeable item route to each credit type.',
                },
                guildCreditExchangeAdvisor: {
                    id: 'guildCreditExchangeAdvisor',
                    label: 'Guild Shop: Show exchange advisor (sell → rebuy comparison)',
                    type: 'checkbox',
                    default: true,
                    help: 'When the selected item is not the cheapest option, shows whether selling it and rebuying the best item would yield more credits (accounts for 4% seller tax).',
                },
                guildShrineUpgradePlanner: {
                    id: 'guildShrineUpgradePlanner',
                    label: 'Guild Shop: Show shrine upgrade planner',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds a shrine upgrade planner to the guild credit exchange panel, showing total credit and token costs to upgrade from your current level to a target level.',
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

        leaderboard: {
            title: 'Leaderboard',
            icon: '🏆',
            settings: {
                leaderboardXPTracker: {
                    id: 'leaderboardXPTracker',
                    label: 'Track player XP over time from Leaderboard',
                    type: 'checkbox',
                    default: true,
                    help: 'Records player XP from leaderboard WebSocket messages for XP/hr calculations on the Leaderboard panel.',
                },
                leaderboardXPDisplay: {
                    id: 'leaderboardXPDisplay',
                    label: 'Show XP/hr columns on Leaderboard',
                    type: 'checkbox',
                    default: true,
                    help: 'Adds Last XP/h and Last day XP/h columns to the player Leaderboard panel.',
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
                color_mirror: {
                    id: 'color_mirror',
                    label: "Philosopher's Mirror",
                    type: 'color',
                    default: '#ffd700',
                    help: "Color for the Philosopher's Mirror usage line in enhancement tooltips",
                },
                color_listing_price_1m: {
                    id: 'color_listing_price_1m',
                    label: 'Listing Total: 1M+',
                    type: 'color',
                    default: '#ffd700',
                    help: 'Color for market listing total prices of 1 million or more',
                },
                color_listing_price_100k: {
                    id: 'color_listing_price_100k',
                    label: 'Listing Total: 100K+',
                    type: 'color',
                    default: '#22c55e',
                    help: 'Color for market listing total prices of 100K or more',
                },
                color_listing_price_10k: {
                    id: 'color_listing_price_10k',
                    label: 'Listing Total: 10K+',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color for market listing total prices of 10K or more',
                },
                color_listing_price_low: {
                    id: 'color_listing_price_low',
                    label: 'Listing Total: <10K',
                    type: 'color',
                    default: '#888888',
                    help: 'Color for market listing total prices under 10K',
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
                    label: 'XP Rate Text',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color for XP/hr rate text on skill bars in left navigation',
                },
                color_hours_to_level: {
                    id: 'color_hours_to_level',
                    label: 'Hours to Level Text',
                    type: 'color',
                    default: '#ffffff',
                    help: 'Color for "hours till next level" text in skill tooltips',
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

        collectionFilters: {
            title: 'Collection Filters',
            icon: '⭐',
            settings: {
                collectionFilters: {
                    id: 'collectionFilters',
                    label: 'Collection Filters: Count-range, dungeon, and skilling-outfit filters',
                    type: 'checkbox',
                    default: true,
                },
                collectionFavorites: {
                    id: 'collectionFavorites',
                    label: 'Collection Favorites: Star (★) items to mark and filter favorites',
                    type: 'checkbox',
                    default: true,
                },
                collectionFavoritesSection: {
                    id: 'collectionFavoritesSection',
                    label: 'Collection Favorites: Show favorites section at top of grid',
                    type: 'checkbox',
                    default: true,
                },
                collectionFilters_skillingBadges: {
                    id: 'collectionFilters_skillingBadges',
                    label: 'Show collection count badges on skilling action tiles',
                    type: 'checkbox',
                    default: true,
                    help: 'Displays your collection count on skilling actions (open Collections once to populate counts)',
                },
            },
        },
    };

    /**
     * Settings Storage Module
     * Handles persistence of settings to chrome.storage.local
     */


    // Task-related storage keys that are scoped per-character by a `_<charId>` suffix, outside
    // the main schema settings blob (see task-reroll-protection.js / task-auto-reroll.js).
    const TASK_CHARACTER_SCOPED_PREFIXES = ['taskProtectedHrids', 'taskAutoRerollHrids'];

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
            this.currentCharacterId = String(characterId);
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

                // Migrate: actionBar_showTimeRemaining changed from checkbox to select
                const timeRemainingSaved = saved['actionBar_showTimeRemaining'];
                if (
                    timeRemainingSaved &&
                    timeRemainingSaved.hasOwnProperty('isTrue') &&
                    !timeRemainingSaved.hasOwnProperty('value')
                ) {
                    settings['actionBar_showTimeRemaining'].value = timeRemainingSaved.isTrue ? 'both' : 'none';
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
         *
         * Known, accepted race (investigated, not fixed): this is a global read-modify-write list
         * with no compare-and-swap. Two different characters loading for the very first time ever,
         * in two separate tabs, within the same write window, could race and drop one entry. Same-
         * character dual-tab play is not possible, so the exposure is limited to that one-time-per-
         * character-ever event, and the consequence is cosmetic (a missing/stale name in the
         * settings-sync character list) rather than lost gameplay data - not worth an OCC/revision
         * guard for that risk/reward. Revisit if a future caller writes this list more frequently or
         * for data where a dropped entry would actually matter.
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
         * Also copies task-related per-character data (protected task list, auto-reroll
         * targets) from the current character, since those live outside the settings blob.
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

            const taskScopedValues = await Promise.all(
                TASK_CHARACTER_SCOPED_PREFIXES.map((prefix) =>
                    storage.getJSON(`${prefix}_${this.currentCharacterId}`, this.storageArea, null)
                )
            );

            for (const character of targets) {
                if (character.id === this.currentCharacterId) continue;
                const characterKey = `${this.storageKey}_${character.id}`;
                await storage.setJSON(characterKey, settings, this.storageArea, true);

                for (let i = 0; i < TASK_CHARACTER_SCOPED_PREFIXES.length; i++) {
                    if (taskScopedValues[i] === null) continue;
                    const targetKey = `${TASK_CHARACTER_SCOPED_PREFIXES[i]}_${character.id}`;
                    await storage.setJSON(targetKey, taskScopedValues[i], this.storageArea, true);
                }

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

                const toId = (entry) => String(typeof entry === 'object' && entry !== null ? entry.id : entry);
                const knownCharacters = new Set((await this.getKnownCharacters()).map((c) => c.id));
                if (data[this.knownCharactersKey]) {
                    for (const id of data[this.knownCharactersKey]) {
                        knownCharacters.add(toId(id));
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
            this.processedMessages = new Map(); // socket-scoped message hash -> timestamp
            this.socketDedupIds = new WeakMap();
            this.nextSocketDedupId = 1;
            // Some character event types must bypass the lossy first-100-char dedup because two
            // genuine messages can share the same prefix. Keep a tiny socket-scoped exact-message
            // guard for duplicate interception of the same physical payload instead.
            this.recentExactMessages = new Map(); // socket + type + full message -> timestamp
            this.messageCleanupInterval = null;
            this.isSocketWrapped = false;
            this.originalWebSocket = null;
            this.currentWebSocket = null;
            this.clientDataRetryTimeout = null;
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

            // Capture hook instance for closure
            const hookInstance = this;

            // Hook MessageEvent.prototype.data on the PAGE's prototype (via unsafeWindow)
            // Using the sandbox's MessageEvent fails when Tampermonkey isolates prototypes
            const pageMessageEvent = typeof unsafeWindow !== 'undefined' ? unsafeWindow.MessageEvent : MessageEvent;
            const dataProperty = Object.getOwnPropertyDescriptor(pageMessageEvent.prototype, 'data');
            const originalGet = dataProperty.get;

            dataProperty.get = function hookedGet() {
                const socket = this.currentTarget;

                // Only hook MWI game server (URL check handles non-WebSocket events safely)
                if (!hookInstance.isGameSocket(socket)) {
                    return originalGet.call(this);
                }

                // Already processed — pass through without re-processing
                if (hookInstance.isMessageEventProcessed(this)) {
                    return originalGet.call(this);
                }

                hookInstance.attachSocketListeners(socket);

                const message = originalGet.call(this);

                hookInstance.markMessageEventProcessed(this);
                hookInstance.processMessage(message, socket);

                return message;
            };

            Object.defineProperty(pageMessageEvent.prototype, 'data', dataProperty);

            this.isHooked = true;
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

                // Only subclass native WebSocket constructors. Third-party wrappers
                // (other userscripts replacing window.WebSocket) are passed through
                // as-is — Toolasha still intercepts via MessageEvent.data hook and
                // WebSocket.prototype patches.
                const isNative = /\[native code\]/.test(Function.prototype.toString.call(OriginalWebSocket));
                if (!isNative) {
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

                // Reading event.data above can itself trigger the MessageEvent.prototype.data
                // getter hook (hookedGet), which already marks-and-processes the event. Re-check
                // here so this listener doesn't call processMessage a second time for the same
                // physical message.
                if (this.isMessageEventProcessed(event)) {
                    return;
                }

                this.markMessageEventProcessed(event);
                this.processMessage(event.data, socket);
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
         * @param {WebSocket|null} socket - Originating game socket when available
         */
        processMessage(message, socket = null) {
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
                messageType === 'actions_updated' ||
                messageType === 'items_updated' ||
                messageType === 'market_item_order_books_updated' ||
                messageType === 'market_listings_updated' ||
                messageType === 'profile_shared' ||
                messageType === 'battle_consumable_ability_updated' ||
                messageType === 'battle_unit_fetched' ||
                messageType === 'action_type_consumable_slots_updated' ||
                // Native skilling/live-buff state messages replace whole maps/arrays. Two genuine
                // consecutive updates can easily share the first 100 raw characters and differ only
                // in a later buff value, so the lossy prefix hash must never collapse them.
                messageType === 'house_rooms_updated' ||
                messageType === 'achievement_buffs_updated' ||
                messageType === 'moo_pass_buffs_updated' ||
                messageType === 'community_buffs_updated' ||
                messageType === 'consumable_buffs_updated' ||
                messageType === 'equipment_buffs_updated' ||
                messageType === 'personal_buffs_updated' ||
                messageType === 'guild_buffs_updated' ||
                messageType === 'character_info_updated' ||
                messageType === 'labyrinth_updated' ||
                messageType === 'loadouts_updated' ||
                messageType === 'setting_updated' ||
                messageType === 'labyrinth_room_progress' ||
                messageType === 'leaderboard_updated' ||
                messageType === 'guild_updated' ||
                messageType === 'loot_opened' ||
                // Two genuine, distinct info toasts (e.g. selling the same item twice in a row)
                // can share the same first-100-char prefix - see the exact-match branch below.
                messageType === 'info';

            if (!skipDedup) {
                // Deduplicate by message content to prevent multiple interception paths from
                // parsing the same physical socket message. Keep the key socket-scoped: a new
                // game socket may legitimately deliver an init/state payload with the same first
                // 100 characters as an old socket during reconnect/character switching.
                const socketKey = this.getSocketDedupKey(socket);
                const messageHash = `${socketKey}:${message.substring(0, 100)}`;

                if (this.processedMessages.has(messageHash)) {
                    return; // Already processed this message, skip
                }

                this.processedMessages.set(messageHash, Date.now());

                // Cleanup old entries every 100 messages to prevent memory leak
                if (this.processedMessages.size > 100) {
                    this.cleanupProcessedMessages();
                }
            } else if (messageType === 'action_completed' || messageType === 'loot_opened' || messageType === 'info') {
                // These types bypass the lossy first-100-char dedup (Gabriel's fix, commit 1007215,
                // extended to loot_opened, then info) because two genuine consecutive messages can
                // share the same prefix while differing later. The WebSocket prototype wrapper can still fire
                // two listeners for the same physical message object - the WeakSet guard catches
                // same-object duplicates, but if two independent listeners each receive a distinct
                // MessageEvent wrapping the same payload, both pass the WeakSet check and
                // processMessage is called twice. Collapse only that exact-duplicate interception in
                // a short 50ms TTL window, scoped per socket and message type so a reconnect can
                // replay identical state without being suppressed by the old socket's guard.
                const now = Date.now();
                const socketKey = this.getSocketDedupKey(socket);
                const exactKey = `${socketKey}:${messageType}:${message}`;
                const previous = this.recentExactMessages.get(exactKey);
                if (previous !== undefined && now - previous <= 50) {
                    return; // Duplicate from second listener — skip
                }
                this.recentExactMessages.set(exactKey, now);
                // Prune entries older than 50ms to keep memory bounded
                for (const [key, ts] of this.recentExactMessages) {
                    if (now - ts > 50) {
                        this.recentExactMessages.delete(key);
                    }
                }
            }

            try {
                const data = JSON.parse(message);
                const parsedMessageType = data.type;

                // Save critical data to GM storage for Combat Sim export
                this.saveCombatSimData(parsedMessageType, message);

                // Call registered handlers for this message type
                const handlers = [...(this.messageHandlers.get(parsedMessageType) || [])];

                for (const handler of handlers) {
                    try {
                        const result = handler(data, { socket });
                        if (result instanceof Promise) {
                            result.catch((error) => {
                                console.error(`[WebSocket] Async handler error for ${parsedMessageType}:`, error);
                            });
                        }
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${parsedMessageType}:`, error);
                    }
                }

                // Call wildcard handlers (receive all messages)
                const wildcardHandlers = [...(this.messageHandlers.get('*') || [])];
                for (const handler of wildcardHandlers) {
                    try {
                        const result = handler(data, { socket });
                        if (result instanceof Promise) {
                            result.catch((error) => {
                                console.error('[WebSocket] Async wildcard handler error:', error);
                            });
                        }
                    } catch (error) {
                        console.error('[WebSocket] Wildcard handler error:', error);
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Failed to process message:', error);
            }
        }

        /**
         * Save combat sim data for export (cross-domain via GM storage + IndexedDB).
         * Character/client/battle data is saved to GM storage so the Shykai sim page can read it.
         * Profile shares are saved to IndexedDB for cross-session persistence.
         * @param {string} messageType - Message type
         * @param {string} message - Raw message JSON string
         */
        async saveCombatSimData(messageType, message) {
            const hasGM = typeof GM_setValue !== 'undefined';
            try {
                // Save character/client/battle data to GM storage for cross-domain Shykai access
                if (hasGM && messageType === 'init_character_data') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_init_character_data', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
                } else if (hasGM && messageType === 'init_client_data') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_init_client_data', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
                } else if (hasGM && messageType === 'new_battle') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_new_battle', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
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

                    // Load existing profile list from IndexedDB
                    let profileList = (await storage.getJSON('profile_list', 'combatExport', null)) || [];

                    // Remove old entry for same character
                    profileList = profileList.filter((p) => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    // Save updated profile list to IndexedDB (cross-session) and GM storage (cross-domain for Shykai)
                    await storage.setJSON('profile_list', profileList, 'combatExport', true);
                    if (hasGM) {
                        try {
                            GM_setValue('toolasha_profile_list', JSON.stringify(profileList));
                        } catch {
                            /* ignore */
                        }
                    }
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
         * Return a stable weak identity for socket-scoped message deduplication.
         * @param {WebSocket|null} socket - Originating socket when available
         * @returns {string} Stable deduplication scope key
         */
        getSocketDedupKey(socket) {
            if (!socket || (typeof socket !== 'object' && typeof socket !== 'function')) return 'no-socket';

            let id = this.socketDedupIds.get(socket);
            if (!id) {
                id = this.nextSocketDedupId++;
                this.socketDedupIds.set(socket, id);
            }
            return `socket-${id}`;
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
            this.recentExactMessages.clear();
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
            const handlers = this.messageHandlers.get(messageType);
            if (!handlers.includes(handler)) {
                handlers.push(handler);
            }
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
            const handlers = [...(this.socketEventHandlers.get(eventType) || [])];
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
            const listeners = this.eventListeners.get(event);
            if (!listeners.includes(callback)) {
                listeners.push(callback);
            }
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
            const listeners = [...(this.eventListeners.get(event) || [])];
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

        // Remove dead listings: cancelled/expired immediately, filled once fully claimed
        return merged.filter((listing) => {
            if (!listing) return false;
            if (
                listing.status === '/market_listing_status/cancelled' ||
                listing.status === '/market_listing_status/expired'
            ) {
                return false;
            }
            if (
                listing.status === '/market_listing_status/filled' &&
                (listing.unclaimedItemCount || 0) === 0 &&
                (listing.unclaimedCoinCount || 0) === 0
            ) {
                return false;
            }
            return true;
        });
    };

    /**
     * Game i18n Bridge
     *
     * Obtains the game's i18next instance from the React fiber tree and provides
     * locale-independent translation of game data names (items, actions, monsters,
     * skills, etc.). Falls back to the English name when the i18n instance is
     * unavailable or the key is missing.
     */

    let cachedI18n = null;

    /**
     * Walk the React fiber tree from #root to find the i18next instance.
     * @returns {import('i18next').i18n | null}
     */
    function getGameI18n() {
        if (cachedI18n) return cachedI18n;
        if (typeof document === 'undefined') return null;

        const root = document.getElementById('root');
        const fiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
        if (!fiber) return null;

        const stack = [fiber];
        while (stack.length > 0) {
            const f = stack.pop();
            if (!f) continue;
            try {
                const props = f.memoizedProps || {};
                if (props.i18n && typeof props.i18n.t === 'function') {
                    cachedI18n = props.i18n;
                    return cachedI18n;
                }
                if (props.value?.i18n && typeof props.value.i18n.t === 'function') {
                    cachedI18n = props.value.i18n;
                    return cachedI18n;
                }
            } catch (error) {
                console.error('[GameI18n] Fiber access error during tree walk:', error);
            }
            if (f.sibling) stack.push(f.sibling);
            if (f.child) stack.push(f.child);
        }
        return null;
    }

    /**
     * Translate a game data name via the game's i18next instance.
     * @param {string} namespace - i18n namespace (e.g. 'itemNames')
     * @param {string} hrid - Game data HRID (e.g. '/items/abyssal_essence')
     * @param {string} [fallback=''] - English name to fall back to
     * @returns {string} Translated name or fallback
     */
    function translateGameName(namespace, hrid, fallback = '') {
        if (!hrid) return fallback;
        const i18n = getGameI18n();
        if (!i18n) return fallback;

        const key = `${namespace}.${hrid}`;
        try {
            const translated = i18n.t(key);
            // i18next returns the key itself when no translation exists
            if (translated === key) return fallback;
            return translated;
        } catch (error) {
            console.error('[GameI18n] i18n.t() failed for key:', key, error);
            return fallback;
        }
    }
    const getMonsterName = (hrid, fallback = '') => translateGameName('monsterNames', hrid, fallback);

    /**
     * Scroll Buff Values
     * Hardcoded buff definitions for Labyrinth scrolls (formerly "Seals").
     * The game JSON has no consumableDetail for scroll items — values sourced from item descriptions.
     */


    const SCROLL_BUFF_VALUES = {
        '/buff_types/efficiency': 0.14,
        '/buff_types/gathering': 0.18,
        '/buff_types/wisdom': 0.2,
        '/buff_types/action_speed': 0.15,
        '/buff_types/rare_find': 0.6,
        '/buff_types/processing': 0.2,
        '/buff_types/gourmet': 0.16,
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
            this.characterGuildBuffMap = {}; // Guild buff HRID -> {guildBuffHrid, level}
            this.guildBuildingLevelMap = {}; // Building/shrine HRID -> level
            this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
            this.bossMonsterHrids = new Set(); // Monster HRIDs that appear in bossSpawns
            this.battleData = null; // Current battle data (for Combat Sim export on Steam)

            // Trustworthy boundary for the currently in-progress base action's current unit:
            // { actionId, currentCount, unitStartTime }. Used to compute already-elapsed time in
            // the active unit so Action Time Display doesn't re-anchor its ETA to a full fresh
            // action on reload/remount. Persisted per-character so it survives reload; validated
            // against the live actionId/currentCount pair on restore so a stale/mismatched boundary
            // is never trusted (see _syncActionUnitBoundary).
            this.actionUnitBoundary = null;

            // Character tracking for switch detection
            this.currentCharacterId = null;
            this.currentCharacterName = null;
            this.currentCharacterGameMode = null;
            this.isCharacterSwitching = false;
            this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

            // Character-WebSocket ownership (TLA-018). initGeneration is bumped on every accepted
            // init_character_data so an older async init continuation can detect it was superseded
            // after resuming from an await, and activeSocket is bound to the socket that delivered
            // that accepted init so delayed character-scoped updates from a stale socket (old
            // connection after a switch/reconnect) can be rejected without depending on every
            // payload carrying a character id. Both start permissive (0 / null): no socket/epoch is
            // known yet, matching loadout-state.js's ownership model.
            this.initGeneration = 0;
            this.activeSocket = null;

            // Event listeners
            this.eventListeners = new Map();

            // Achievement buff cache (action type → buff type → flat boost)
            this.achievementBuffCache = {
                source: null,
                byActionType: new Map(),
            };

            // Personal buffs from seals (personal_buffs_updated WebSocket message)
            this.personalActionTypeBuffsMap = {};

            // Per-action-type scroll simulation (Set of buffTypeHrids to simulate)
            this.scrollSimulationByActionType = {};

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
            this.webSocketHook.on('init_character_data', async (data, context) => {
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
                    this.currentCharacterGameMode = data.character?.gameMode || null;

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
                    this.characterGuildBuffMap = {};
                    this.guildBuildingLevelMap = {};
                    this.battleData = null;
                    this.actionUnitBoundary = null;

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
                    this.currentCharacterGameMode = data.character?.gameMode || null;
                }

                // This init is accepted (validated, and not rejected as a rapid-fire switch above).
                // Establish a new ownership epoch and bind the socket that delivered it before any
                // awaits below can interleave with a second accepted init. A same-character
                // reconnect still starts a fresh epoch — WebSocketHook does not serialize async
                // handlers, so two overlapping init_character_data continuations must be
                // distinguishable even when neither payload's character id differs (TLA-018).
                this.initGeneration += 1;
                const generation = this.initGeneration;
                if (context?.socket) {
                    this.activeSocket = context.socket;
                } else if (isCharacterSwitch) {
                    // No socket context and the character changed: the previously bound socket no
                    // longer corresponds to who is active. Fail closed to "unknown" rather than keep
                    // trusting a socket that may belong to the departed character.
                    this.activeSocket = null;
                }

                // Process new character data normally. Keep characterData.characterItems and
                // this.characterItems on the same live array: several legacy consumers still read
                // characterData directly, while incremental updates mutate this.characterItems.
                // Mirror native presence semantics first so both views exclude only explicit zero.
                // Do not mutate the shared WebSocket payload object: later subscribers should still
                // observe the server message exactly as delivered.
                const characterItems = Array.isArray(data.characterItems)
                    ? data.characterItems.filter((item) => item?.count !== 0)
                    : [];
                this.characterData = { ...data, characterItems };
                this.characterSkills = data.characterSkills;
                this.characterItems = characterItems;
                this.characterActions = [...data.characterActions];
                this.characterQuests = data.characterQuests || [];

                // Restore/establish the current-unit timing boundary for whatever action is now
                // front-most, so a reload or character switch-back doesn't discard a still-valid
                // partial-progress boundary (see _restoreActionUnitBoundary).
                await this._restoreActionUnitBoundary(newCharacterId, generation);

                if (this.initGeneration !== generation) {
                    // A newer init_character_data was accepted while this one was still awaiting its
                    // action-unit boundary restore. This continuation is stale: it must not publish
                    // derived maps built from its own local `data`, or emit character_initialized,
                    // over the newer character's already-installed canonical state (TLA-018).
                    console.warn(
                        '[DataManager] Dropping stale init_character_data continuation (superseded by a newer accepted init)'
                    );
                    return;
                }

                // Build equipment map
                this.updateEquipmentMap(this.characterItems);

                // Build house room map
                this.updateHouseRoomMap(data.characterHouseRoomMap);

                // Build drink slots map (tea buffs)
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

                // Load personal buffs (seal buffs from Labyrinth, may be present on login)
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }

                // Load guild buff levels and shrine/building levels
                this.characterGuildBuffMap = data.characterGuildBuffMap || {};
                this.guildBuildingLevelMap = data.guildBuildingLevelMap || {};

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
            this.webSocketHook.on('actions_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                // Mirror native MWI queue-state semantics: replace existing actions in place,
                // remove completed actions, and re-sort only when a row is new or its ordinal changes.
                // Removing + appending every update makes array insertion order diverge from the
                // native queue after a reorder; consumers that inspect the first/current action can
                // then accidentally read a queued action instead.
                let queueOrderChanged = false;
                for (const action of data.endCharacterActions) {
                    const index = this.characterActions.findIndex((existing) => existing.id === action.id);

                    if (action.isDone === true) {
                        if (index !== -1) this.characterActions.splice(index, 1);
                    } else if (action.isDone === false) {
                        if (index !== -1) {
                            if (this.characterActions[index].ordinal !== action.ordinal) queueOrderChanged = true;
                            this.characterActions[index] = action;
                        } else {
                            this.characterActions.push(action);
                            queueOrderChanged = true;
                        }
                    }
                }

                if (queueOrderChanged) {
                    this.characterActions.sort((a, b) => {
                        const aPartyId = a?.partyID ?? 0;
                        const bPartyId = b?.partyID ?? 0;
                        if (aPartyId !== 0 && bPartyId === 0) return -1;
                        if (aPartyId === 0 && bPartyId !== 0) return 1;
                        return (Number(a?.ordinal) || 0) - (Number(b?.ordinal) || 0);
                    });
                }

                this._syncActionUnitBoundary();

                this.emit('actions_updated', data);
            });

            // Handle action_completed (action progress)
            this.webSocketHook.on('action_completed', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                const action = data.endCharacterAction;
                if (action.isDone === false) {
                    for (let i = 0; i < this.characterActions.length; i++) {
                        if (this.characterActions[i].id === action.id) {
                            // Replace the entire cached action with fresh data from the server
                            // This keeps primaryItemHash, enhancingMaxLevel, etc. up to date
                            this.characterActions[i] = action;
                            break;
                        }
                    }
                }

                this._syncActionUnitBoundary();

                // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
                if (data.endCharacterItems && Array.isArray(data.endCharacterItems) && this.characterItems) {
                    this.applyCharacterItemUpdates(data.endCharacterItems, { inventoryOnly: true });

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

                // Merge ability XP/level changes embedded in action_completed (e.g. combat
                // actions granting ability XP) - a second live path alongside abilities_updated.
                this._mergeCharacterAbilities(data.endCharacterAbilities);

                this.emit('action_completed', data);
            });

            // Handle abilities_updated (ability level/XP changes: leveling up, learning a new
            // ability, or other native ability-state changes outside of action_completed)
            this.webSocketHook.on('abilities_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                this._mergeCharacterAbilities(data.endCharacterAbilities);
            });

            // Handle items_updated (inventory/equipment changes)
            this.webSocketHook.on('items_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (data.endCharacterItems) {
                    if (!this.characterItems) {
                        this.emit('items_updated', data);
                        return;
                    }
                    // Native MWI keys character-item updates by `hash` and updates its equipment
                    // location map in message order. applyCharacterItemUpdates mirrors both maps,
                    // including the guarded removal that cannot delete an already-current replacement.
                    this.applyCharacterItemUpdates(data.endCharacterItems);
                }

                this.emit('items_updated', data);
            });

            // Handle market_listings_updated (the current character's own market order changes —
            // character-scoped, unlike market_item_order_books_updated below)
            this.webSocketHook.on('market_listings_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

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

            // Handle market_item_order_books_updated (order book updates). Global market data, not
            // scoped to the active character — must not be dropped by socket-ownership checks.
            this.webSocketHook.on('market_item_order_books_updated', (data) => {
                this.emit('market_item_order_books_updated', data);
            });

            // Handle action_type_consumable_slots_updated (when user changes tea assignments)
            this.webSocketHook.on('action_type_consumable_slots_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                // Update drink slots map with new consumables
                if (data.actionTypeDrinkSlotsMap) {
                    this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
                }

                this.emit('consumables_updated', data);
            });

            // Native skilling/live-buff state family. MWI replaces these maps/arrays wholesale in
            // its own message handlers; mirror that exact replacement contract in canonical
            // characterData before emitting semantic events. Every handler is character/socket
            // scoped through the TLA-018 accepted-socket boundary. Existing separate DataManager
            // mirrors that current getters depend on (characterHouseRooms, personalActionTypeBuffsMap,
            // characterGuildBuffMap) are kept in sync alongside characterData, not replaced by it.

            // Handle house_rooms_updated (room levels + derived house action buffs)
            this.webSocketHook.on('house_rooms_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (data.characterHouseRoomMap !== undefined) {
                    this.updateHouseRoomMap(data.characterHouseRoomMap);
                    if (this.characterData) this.characterData.characterHouseRoomMap = data.characterHouseRoomMap;
                }
                if (data.houseActionTypeBuffsMap !== undefined && this.characterData) {
                    this.characterData.houseActionTypeBuffsMap = data.houseActionTypeBuffsMap;
                }

                this.emit('house_rooms_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle achievement_buffs_updated
            this.webSocketHook.on('achievement_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (data.achievementActionTypeBuffsMap !== undefined && this.characterData) {
                    this.characterData.achievementActionTypeBuffsMap = data.achievementActionTypeBuffsMap;
                }

                this.emit('achievement_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle moo_pass_buffs_updated
            this.webSocketHook.on('moo_pass_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (this.characterData) {
                    if (data.mooPassBuffs !== undefined) this.characterData.mooPassBuffs = data.mooPassBuffs;
                    if (data.mooPassActionTypeBuffsMap !== undefined) {
                        this.characterData.mooPassActionTypeBuffsMap = data.mooPassActionTypeBuffsMap;
                    }
                }

                this.emit('moo_pass_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle community_buffs_updated
            this.webSocketHook.on('community_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (this.characterData) {
                    if (data.communityBuffs !== undefined) this.characterData.communityBuffs = data.communityBuffs;
                    if (data.communityActionTypeBuffsMap !== undefined) {
                        this.characterData.communityActionTypeBuffsMap = data.communityActionTypeBuffsMap;
                    }
                }

                this.emit('community_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle consumable_buffs_updated (when active consumable buffs expire/refresh)
            this.webSocketHook.on('consumable_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (data.consumableActionTypeBuffsMap !== undefined && this.characterData) {
                    this.characterData.consumableActionTypeBuffsMap = data.consumableActionTypeBuffsMap;
                }

                this.emit('consumable_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle equipment_buffs_updated
            this.webSocketHook.on('equipment_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (this.characterData) {
                    if (data.equipmentActionTypeBuffsMap !== undefined) {
                        this.characterData.equipmentActionTypeBuffsMap = data.equipmentActionTypeBuffsMap;
                    }
                    if (data.equipmentTaskActionBuffs !== undefined) {
                        this.characterData.equipmentTaskActionBuffs = data.equipmentTaskActionBuffs;
                    }
                }

                this.emit('equipment_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle personal_buffs_updated (seal buffs from Labyrinth)
            this.webSocketHook.on('personal_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (data.personalActionTypeBuffsMap !== undefined) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                    if (this.characterData) {
                        this.characterData.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                    }
                }
                if (data.characterBuffs !== undefined && this.characterData) {
                    this.characterData.characterBuffs = data.characterBuffs || [];
                }

                this.emit('personal_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle guild_buffs_updated (purchased guild buffs + derived action-type buffs).
            // guildBuildingLevelMap (shrine/building lifecycle) is a separate native message
            // (guild_updated), handled by its own listener below.
            this.webSocketHook.on('guild_buffs_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                this.characterGuildBuffMap = data.characterGuildBuffMap || {};
                if (this.characterData) {
                    this.characterData.characterGuildBuffMap = this.characterGuildBuffMap;
                    this.characterData.guildActionTypeBuffsMap = data.guildActionTypeBuffsMap || {};
                }

                this.emit('guild_buffs_updated', data);
                this.emit('buffs_updated', data);
            });

            // Handle guild_updated (shrine/building levels + guild info). Without this,
            // guildBuildingLevelMap would only ever reflect whatever guild was active at the last
            // init_character_data - going stale the moment a character switches guilds mid-session,
            // since guild_buffs_updated (above) refreshes the purchased/active buff levels live but
            // never the shrine building's unlocked cap.
            this.webSocketHook.on('guild_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                this.guildBuildingLevelMap = data.guildBuildingLevelMap || {};
                if (this.characterData) {
                    this.characterData.guildBuildingLevelMap = this.guildBuildingLevelMap;
                }

                this.emit('guild_updated', data);
            });

            // Handle skills_updated (when user gains skill levels)
            this.webSocketHook.on('skills_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                // Update character skills with new levels
                if (data.characterSkills) {
                    this.characterSkills = data.characterSkills;
                }

                this.emit('skills_updated', data);
            });

            // Handle new_battle (combat start - for Combat Sim export on Steam)
            this.webSocketHook.on('new_battle', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                // Store battle data (includes party consumables)
                this.battleData = data;
            });

            // Handle character_info_updated (task slot changes, cooldown timestamps, etc.)
            this.webSocketHook.on('character_info_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (this.characterData && data.characterInfo) {
                    this.characterData.characterInfo = data.characterInfo;
                }
                this.emit('character_info_updated', data);
            });

            // Handle setting_updated (labyrinth skip thresholds, crate selection, etc.)
            this.webSocketHook.on('setting_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

                if (this.characterData && data.characterSetting) {
                    this.characterData.characterSetting = data.characterSetting;
                }
                this.emit('setting_updated', data);
            });

            // Handle quests_updated (keep characterQuests in sync mid-session)
            this.webSocketHook.on('quests_updated', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;

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

            // `loot_opened` is character-scoped, but it has no dedicated DataManager-owned state -
            // feature modules (Openable Analytics) consume it directly. Route it through the same
            // TLA-018 accepted-socket ownership as every other character-scoped handler instead of
            // letting a feature invent its own socket ownership, and capture characterId at
            // acceptance time so a later character switch can't cause the opening to be attributed
            // to whichever character happens to be current when an async consumer continuation
            // resumes.
            this.webSocketHook.on('loot_opened', (data, context) => {
                if (!this._isFromActiveSocket(context)) return;
                if (!this.currentCharacterId) return;

                this.emit('loot_opened', { data, characterId: this.currentCharacterId });
            });
        }

        /**
         * True unless a character-scoped update is provably from a stale WebSocket — i.e., an
         * accepted init_character_data bound a real socket (this.activeSocket) and this update's
         * context carries a different one. Permissive whenever no socket is bound yet (initial
         * load before any init_character_data, or tests that invoke handlers without a socket
         * context) so this never depends on every payload carrying a character id (TLA-018).
         * @param {{socket?: WebSocket}|null} context
         * @returns {boolean}
         */
        _isFromActiveSocket(context) {
            return !this.activeSocket || context?.socket === this.activeSocket;
        }

        /**
         * Find the existing record targeted by an incremental character-item update. Current MWI
         * payloads expose `hash` (character + location + item + enhancement), which is authoritative.
         * Older/fallback payloads may only expose `id`, so matching deliberately supports transitions
         * between legacy id-only and current hash-aware records without letting a reused id collapse
         * two distinct hash variants in the same batch.
         * @param {Object} item
         * @returns {number}
         */
        findCharacterItemIndex(item) {
            if (!item || typeof item !== 'object' || !Array.isArray(this.characterItems)) return -1;

            if (item.hash) {
                const hashIndex = this.characterItems.findIndex((existing) => existing?.hash === item.hash);
                if (hashIndex !== -1) return hashIndex;

                // A current hash-aware update may replace a legacy cached record that never had a hash.
                if (item.id !== null && item.id !== undefined) {
                    const legacyIdIndex = this.characterItems.findIndex(
                        (existing) => !existing?.hash && existing?.id === item.id
                    );
                    if (legacyIdIndex !== -1) return legacyIdIndex;
                }
                return -1;
            }

            if (item.id !== null && item.id !== undefined) {
                const idIndex = this.characterItems.findIndex((existing) => existing?.id === item.id);
                if (idIndex !== -1) return idIndex;
            }

            if (!item.itemHrid || !item.itemLocationHrid) return -1;
            const level = Number(item.enhancementLevel) || 0;
            return this.characterItems.findIndex(
                (existing) =>
                    !existing?.hash &&
                    (existing?.id === null || existing?.id === undefined) &&
                    existing?.itemLocationHrid === item.itemLocationHrid &&
                    existing?.itemHrid === item.itemHrid &&
                    (Number(existing?.enhancementLevel) || 0) === level
            );
        }

        /**
         * Apply incremental character-item updates using native MWI identity/presence semantics.
         * Only explicit count === 0 removes a record; omitted count is valid/present.
         * @param {Array<Object>} updates
         * @param {{inventoryOnly?: boolean}} options
         */
        applyCharacterItemUpdates(updates, { inventoryOnly = false } = {}) {
            if (!Array.isArray(this.characterItems)) this.characterItems = [];

            const matchesCurrentEquipment = (current, candidate) => {
                if (!current || !candidate) return false;
                if (candidate.hash) return current.hash === candidate.hash;
                if (candidate.id !== null && candidate.id !== undefined) return current.id === candidate.id;
                return (
                    current.itemHrid === candidate.itemHrid &&
                    current.itemLocationHrid === candidate.itemLocationHrid &&
                    (Number(current.enhancementLevel) || 0) === (Number(candidate.enhancementLevel) || 0)
                );
            };

            for (const item of updates || []) {
                if (!item) continue;
                if (inventoryOnly && item.itemLocationHrid !== '/item_locations/inventory') continue;

                const hasIdentity =
                    !!item.hash ||
                    (item.id !== null && item.id !== undefined) ||
                    (!!item.itemHrid && !!item.itemLocationHrid);
                if (!hasIdentity) continue;

                const index = this.findCharacterItemIndex(item);
                const previous = index !== -1 ? this.characterItems[index] : null;
                const previousLocation = previous?.itemLocationHrid;

                if (item.count === 0) {
                    if (index !== -1) this.characterItems.splice(index, 1);

                    if (!inventoryOnly) {
                        const removedLocation = item.itemLocationHrid || previousLocation;
                        if (removedLocation && removedLocation !== '/item_locations/inventory') {
                            const current = this.characterEquipment.get(removedLocation);
                            // Match native MWI: deleting an old hash must not clear a replacement
                            // that already became current for the same equipment location.
                            const removalMatchesCurrent =
                                item.hash && current?.hash
                                    ? current.hash === item.hash
                                    : matchesCurrentEquipment(current, previous || item);
                            if (removalMatchesCurrent) this.characterEquipment.delete(removedLocation);
                        }
                    }
                    continue;
                }

                // Native MWI's hash-keyed Map replaces the full record on update. Preserve that
                // behavior for current hash-aware payloads so an omitted field (notably `count`)
                // cannot inherit stale state from an older object. Legacy id-only payloads still
                // merge because they may be partial compatibility updates.
                const storedItem = item.hash ? item : previous ? { ...previous, ...item } : item;
                if (index !== -1) this.characterItems[index] = storedItem;
                else this.characterItems.push(storedItem);

                if (!inventoryOnly) {
                    const nextLocation = storedItem.itemLocationHrid;
                    // Legacy partial records can represent a move without an explicit old count:0.
                    // Avoid leaving a stale equipment pointer in the previous location.
                    if (
                        previousLocation &&
                        previousLocation !== '/item_locations/inventory' &&
                        previousLocation !== nextLocation
                    ) {
                        const current = this.characterEquipment.get(previousLocation);
                        if (matchesCurrentEquipment(current, previous)) {
                            this.characterEquipment.delete(previousLocation);
                        }
                    }

                    if (nextLocation && nextLocation !== '/item_locations/inventory') {
                        // Native location-map semantics are update ordered: the last present update
                        // for a location wins, independently of where its hash record sits in our array.
                        this.characterEquipment.set(nextLocation, storedItem);
                    }
                }
            }
        }

        /**
         * Build the equipment location map from a full character-item snapshot (initial load).
         * Incremental updates maintain this map directly in applyCharacterItemUpdates so native
         * update ordering and guarded-removal semantics are preserved.
         * @param {Array} items - Full current character items array
         */
        updateEquipmentMap(items) {
            this.characterEquipment.clear();
            for (const item of items || []) {
                if (item?.itemLocationHrid && item.itemLocationHrid !== '/item_locations/inventory' && item.count !== 0) {
                    this.characterEquipment.set(item.itemLocationHrid, item);
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
         * Merge a live ability-state update into the current character's ability list.
         * Mirrors the native client's `updateCharacterAbilities()`: replace by abilityHrid,
         * append if not yet known (newly learned ability). `endCharacterAbilities` is an update
         * set, not necessarily the complete list, so unrelated abilities are preserved. Reassigns
         * `characterData.characterAbilities` (rather than mutating in place) so every consumer
         * that reads it fresh - Ability Book Calculator, Combat Sim adapter, Networth, tooltip
         * prices, Combat Score - stays in sync from this one source with no separate mirror.
         * @param {Array} endCharacterAbilities - Updated/newly learned ability entries
         */
        _mergeCharacterAbilities(endCharacterAbilities) {
            if (!this.characterData || !Array.isArray(endCharacterAbilities) || endCharacterAbilities.length === 0) {
                return;
            }

            const abilities = [...(this.characterData.characterAbilities || [])];
            for (const updated of endCharacterAbilities) {
                const index = abilities.findIndex((a) => a.abilityHrid === updated.abilityHrid);
                if (index !== -1) {
                    abilities[index] = updated;
                } else {
                    abilities.push(updated);
                }
            }
            this.characterData.characterAbilities = abilities;

            this.emit('abilities_updated', { endCharacterAbilities });
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
         * Elapsed time already spent in the currently in-progress base action's active unit, so
         * callers modeling "remaining time" don't double-count that partial unit as a full one.
         * Returns 0 (fail-closed) whenever there's no trustworthy boundary for this exact
         * (actionId, currentCount) pair — e.g. cold start, a completed unit we never observed, or a
         * different action — matching the previous "assume fresh" behavior rather than fabricating
         * a partial estimate.
         * @param {number} actionId - id of the action currently in progress
         * @param {number} currentCount - that action's currentCount at the moment being queried
         * @param {number} unitDurationSeconds - full duration of one base action, for clamping
         * @returns {number} Elapsed seconds in [0, unitDurationSeconds]
         */
        getElapsedSecondsInCurrentUnit(actionId, currentCount, unitDurationSeconds) {
            const boundary = this.actionUnitBoundary;
            if (!boundary || boundary.actionId !== actionId || boundary.currentCount !== currentCount) {
                return 0;
            }
            const elapsedSeconds = (Date.now() - boundary.unitStartTime) / 1000;
            return Math.min(Math.max(0, elapsedSeconds), unitDurationSeconds);
        }

        /**
         * Reconcile the tracked current-unit boundary against the live front action (lowest
         * ordinal). A no-op when the front action's (id, currentCount) is unchanged — that's the
         * same in-progress unit, so its start time must not be reset. Otherwise establishes a
         * fresh boundary at "now": this is exactly right when the front action just transitioned
         * (action_completed continuation, or a new action taking the front slot) since that
         * transition instant IS the new unit's start, and it's the correct fail-closed default
         * when provenance is unknown (e.g. first observation of this pair).
         */
        _syncActionUnitBoundary() {
            const sorted = [...this.characterActions].sort((a, b) => a.ordinal - b.ordinal);
            const front = sorted[0] || null;

            if (!front) {
                this.actionUnitBoundary = null;
                return;
            }

            const existing = this.actionUnitBoundary;
            if (existing && existing.actionId === front.id && existing.currentCount === front.currentCount) {
                return;
            }

            this.actionUnitBoundary = {
                actionId: front.id,
                currentCount: front.currentCount,
                unitStartTime: Date.now(),
            };

            if (this.currentCharacterId) {
                storage.set(this.currentCharacterId, this.actionUnitBoundary, 'actionProgress');
            }
        }

        /**
         * Restore a persisted current-unit boundary on character load/switch/reload. Only trusted
         * when its (actionId, currentCount) still matches the live front action — otherwise at
         * least one unit completed while unobserved, so the old start time is no longer meaningful
         * and _syncActionUnitBoundary falls back to a fresh fail-closed boundary instead.
         *
         * `generation` is the init_character_data ownership epoch (TLA-018) captured by the caller
         * before this await. WebSocketHook does not serialize async handlers, so a second
         * init_character_data can be accepted — bumping `this.initGeneration` — while this restore's
         * own `storage.get()` is still pending. Re-checking the epoch immediately after that await
         * (and before the early-return no-op branch below, which has no await but still runs after
         * the caller's own epoch check) ensures a stale continuation can never install a boundary
         * for a character/init that is no longer the accepted one.
         * @param {number} characterId
         * @param {number} generation
         */
        async _restoreActionUnitBoundary(characterId, generation) {
            const sorted = [...this.characterActions].sort((a, b) => a.ordinal - b.ordinal);
            const front = sorted[0] || null;

            if (!front) {
                if (this.initGeneration === generation) this.actionUnitBoundary = null;
                return;
            }

            const persisted = await storage.get(characterId, 'actionProgress', null);
            if (this.initGeneration !== generation) {
                // Superseded by a newer accepted init while this storage read was pending.
                return;
            }

            this.actionUnitBoundary =
                persisted && persisted.actionId === front.id && persisted.currentCount === front.currentCount
                    ? persisted
                    : null;

            this._syncActionUnitBoundary();
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
         * Get the current character's server-resolved offline-progress hour cap. Never reconstructed
         * from purchased upgrades - this is the exact value the server sends.
         * @returns {number|null} Offline hour cap, or null if not yet known
         */
        getOfflineHourCap() {
            return this.characterData?.characterInfo?.offlineHourCap ?? null;
        }

        /**
         * Get the current character's MooPass expiry timestamp, if any.
         * @returns {number|null} Epoch ms, or null if no MooPass / not yet known
         */
        getMooPassExpireTime() {
            return this.characterData?.characterInfo?.mooPassExpireTime ?? null;
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
         * Get character's purchased level for a guild buff
         * @param {string} guildBuffHrid - Guild buff HRID (e.g., "/guild_buffs/force_combat")
         * @returns {number} Current purchased level (0 if not purchased)
         */
        getCharacterGuildBuffLevel(guildBuffHrid) {
            return this.characterGuildBuffMap[guildBuffHrid]?.level || 0;
        }

        /**
         * Get guild shrine or building level
         * @param {string} hrid - Building/shrine HRID (e.g., "/guild_shrines/force")
         * @returns {number} Current guild building level (0 if not in a guild or not built)
         */
        getGuildBuildingLevel(hrid) {
            return this.guildBuildingLevelMap[hrid] || 0;
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
         * Get current character game mode
         * @returns {string|null} Game mode ('ironcow', 'standard', etc.) or null
         */
        getCurrentCharacterGameMode() {
            return this.currentCharacterGameMode;
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
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/enhancing")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/enhancing_success")
         * @returns {number} Ratio boost value (decimal) or 0 if not found
         */
        getAchievementBuffRatioBoost(actionTypeHrid, buffTypeHrid) {
            const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
            if (!achievementMap) return 0;

            const achievementBuffs = achievementMap[actionTypeHrid];
            if (!Array.isArray(achievementBuffs)) return 0;

            const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.ratioBoost || 0;
        }

        /**
         * Get personal buff flat boost for an action type and buff type (seal buffs from Labyrinth).
         * When scroll simulation is armed for this action type, returns max(active, simulated).
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/efficiency")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getPersonalBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const activeValue = this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
            const simSet = this.scrollSimulationByActionType[actionTypeHrid];
            if (simSet?.has(buffTypeHrid)) {
                return Math.max(activeValue, SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0);
            }
            return activeValue;
        }

        /**
         * @param {string} actionTypeHrid
         * @param {string} buffTypeHrid
         * @returns {number}
         */
        _getActivePersonalBuff(actionTypeHrid, buffTypeHrid) {
            const personalBuffs = this.personalActionTypeBuffsMap[actionTypeHrid];
            if (!Array.isArray(personalBuffs)) return 0;
            const buff = personalBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.flatBoost || 0;
        }

        /**
         * Arm scroll simulation for a specific action type before running calculations.
         * @param {string} actionTypeHrid
         * @param {Set<string>} buffTypeSet - Set of buffTypeHrids to simulate
         */
        setScrollSimulation(actionTypeHrid, buffTypeSet) {
            if (buffTypeSet?.size > 0) {
                this.scrollSimulationByActionType[actionTypeHrid] = buffTypeSet;
            } else {
                delete this.scrollSimulationByActionType[actionTypeHrid];
            }
        }

        /**
         * Disarm scroll simulation for a specific action type after calculations are done.
         * @param {string} actionTypeHrid
         */
        clearScrollSimulation(actionTypeHrid) {
            delete this.scrollSimulationByActionType[actionTypeHrid];
        }

        /**
         * Returns true when a scroll buff is being simulated (simulated value > active value).
         * Used by display code to decide whether to show the scroll sprite on a buff row.
         * @param {string} actionTypeHrid
         * @param {string} buffTypeHrid
         * @returns {boolean}
         */
        isBuffBeingSimulated(actionTypeHrid, buffTypeHrid) {
            const simSet = this.scrollSimulationByActionType[actionTypeHrid];
            if (!simSet?.has(buffTypeHrid)) return false;
            return (SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0) > this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
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
         * Get the current blocked character map { [characterId]: name }
         * @returns {Object} Blocked character map, or empty object if not available
         */
        getBlockedCharacterMap() {
            return this.characterData?.blockedCharacterMap || {};
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
            this.bossMonsterHrids.clear();

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

                // Track boss monster HRIDs
                for (const boss of bossMonsters) {
                    if (boss.combatMonsterHrid) {
                        this.bossMonsterHrids.add(boss.combatMonsterHrid);
                    }
                }

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
         * Find the combat zone actionHrid that contains a given monster
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/bear")
         * @returns {string|null} Zone actionHrid or null
         */
        getCombatZoneForMonster(monsterHrid) {
            if (!this.initClientData?.actionDetailMap) return null;

            for (const [zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
                if (action.type !== '/action_types/combat') continue;

                const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
                const bosses = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

                for (const spawn of [...spawns, ...bosses]) {
                    if (spawn.combatMonsterHrid === monsterHrid) {
                        return zoneHrid;
                    }
                }
            }
            return null;
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
         * Check if a monster is a boss (appears in bossSpawns of any combat zone)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/crystal_colossus")
         * @returns {boolean} True if the monster is a boss
         */
        isBossMonster(monsterHrid) {
            return this.bossMonsterHrids.has(monsterHrid);
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

            // Search for monster by display name (English or translated)
            for (const [hrid, monster] of Object.entries(this.initClientData.combatMonsterDetailMap)) {
                const displayName = getMonsterName(hrid, monster.name);
                if (displayName === monsterName || monster.name === monsterName) {
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
            const listeners = this.eventListeners.get(event);
            if (!listeners.includes(callback)) {
                listeners.push(callback);
            }
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
         * character_switching must run immediately for proper cleanup. `loot_opened` is also
         * dispatched synchronously: it is an accepted character-scoped event whose consumer must
         * capture the opening before a subsequent character cleanup can invalidate feature state.
         * All other events including character_switched and character_initialized are deferred.
         * @param {string} event - Event name
         * @param {*} data - Event data
         */
        emit(event, data) {
            // Snapshot at emit time. Lifecycle listeners commonly unregister themselves
            // during character_switching; iterating the live array would shift entries and
            // deterministically skip the next cleanup handler. Deferred events must also not
            // be delivered to listeners that subscribed after the event was emitted.
            const listeners = [...(this.eventListeners.get(event) || [])];

            // character_switching (cleanup) and loot_opened (accepted character-scoped event) must
            // run immediately. character_switched can be deferred - it just schedules re-init anyway.
            const isCritical = event === 'character_switching' || event === 'loot_opened';

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
     * English (source) strings for Toolasha's own UI text.
     *
     * Keys are dot-nested by feature, e.g. `t('settings.clearButton')`. A value may be a plain
     * string, or a `(params) => string` function for strings that need pluralization or other
     * params-driven branching (English pluralizes; most other locales don't need to).
     */
    var en = {
        dragToMoveTooltip: 'Drag to move',
        settings: {
            tabLabel: 'Toolasha',
            searchPlaceholder: 'Search settings...',
            clearButton: 'Clear',
            copySettingsToOthersButton: 'Copy Settings to Other Characters',
            fetchPricesButton: '🔄 Fetch Latest Prices',
            resetButton: 'Reset to Defaults',
            exportButton: 'Export Settings',
            importButton: 'Import Settings',
            allOffButton: 'All Off',
            restoreButton: 'Restore',
            pformanceButton: 'PFormance',
            refreshNotice: 'Some settings require a page refresh to take effect',
            toolashaTabTitle: (p) => `⚙️ Toolasha ${p.version ? `v${p.version} ` : ''}Settings (refresh to apply)`,
            nativeSettingsTabTitle: 'Settings',
            copySettingsToTitle: 'Copy Settings To',
            cancelButton: 'Cancel',
            copySettingsConfirmButton: 'Copy Settings',
            characterFallbackName: (p) => `Character ${p.id}`,
            fetchingStatus: '⏳ Fetching...',
            updatedStatus: '✅ Updated!',
            failedStatus: '❌ Failed',
            errorStatus: '❌ Error',
            onlyOneCharacterAlert: 'You only have one character. Settings are already saved for this character.',
            syncSuccessAlert: (p) => `Settings copied to ${p.count} character${p.count !== 1 ? 's' : ''}!`,
            syncFailureAlert: (p) => `Failed to copy settings: ${p.error}`,
            unknownErrorFallback: 'Unknown error',
            resetConfirm: 'Reset all settings to defaults? This cannot be undone.',
            resetDoneAlert: 'Settings reset to defaults. Please refresh the page.',
            messageTextLabel: 'Message text:',
            clickVariableHint: 'Click a variable to insert it at the cursor:',
            saveButton: 'Save',
            editTemplateButton: 'Edit Template',
            addTextButton: '+ Add Text',
            enterTextPrompt: 'Enter text:',
            restoreDefaultButton: 'Restore to Default',
            resetTemplateConfirm: 'Reset template to default? This will discard your current template.',
            templateItemsHeader: 'Template Items (drag to reorder):',
            addVariableHeader: 'Add Variable:',
            removeTooltip: 'Remove',
            customPriceOverridesTitle: 'Custom Price Overrides',
            customPriceOverridesHelp:
                'Set custom buy/sell prices for items. Leave a field blank to use the marketplace price. ' +
                'Overridden prices show * in profit displays.',
            itemSearchPlaceholder: 'Search items...',
            itemLabel: 'Item',
            enhLabel: 'Enh',
            buyPriceLabel: 'Buy Price',
            sellPriceLabel: 'Sell Price',
            noOverridesMessage: 'No custom price overrides. Use the search bar above to add items.',
            clearAllButton: 'Clear All',
            manageOverridesButton: (p) => `Manage Overrides${p.count > 0 ? ` (${p.count})` : ''}`,
            configureButtonDefault: 'Configure...',
            unknownSettingType: (p) => `Unknown type: ${p.type}`,
            ironCowTitle: 'Iron Cow Mode',
            ironCowDescActive:
                'Disable all market &amp; profit features. ' +
                '<span style="color:#d4900a;font-weight:600;">ACTIVE — market features locked.</span>',
            ironCowDescInactive: 'Disable all market &amp; profit features for a no-marketplace playthrough.',
            enhanceSimStatsHeader: 'Computed Stats',
            enhanceSimEffectiveLevel: 'Effective Level:',
            enhanceSimToolSuccess: 'Tool Success:',
            enhanceSimSpeed: 'Speed:',
            enhanceSimDrinkConc: 'Drink Conc:',
            enhanceSimRareFind: 'Rare Find:',
            enhanceSimExperience: 'Experience:',
            enhanceSimStatsUnavailable: 'Stats unavailable (game data not loaded)',
            importSuccessAlert: (p) =>
                `Settings imported successfully (${p.imported} keys imported${
                p.skipped > 0 ? `, ${p.skipped} skipped from other characters` : ''
            }). Please refresh the page.`,
            importFailedFormatAlert: 'Failed to import settings. Please check the file format.',
            importFailedAlert: 'Failed to import settings.',
            clearAllOverridesConfirm: 'Remove all custom price overrides?',
        },
        externalLinks: {
            combatSim: 'Combat Sim',
            enhancelator: 'Enhancelator',
            milkonomy: 'Milkonomy',
            sockosCombatTracker: "Socko's Combat Tracker",
            mwilinks: 'mwilinks',
        },
        dungeonTrackerUi: {
            loadingPlaceholder: 'Loading...',
            elapsedLabel: 'Elapsed: ',
            elapsedTooltip: 'Time since dungeon started',
            chatLabel: 'Chat: ',
            chatTooltip: 'Using party chat timestamps (computer sleep detected)',
            waveCounter: (p) => `Wave ${p.current}/${p.max}`,
            collapseExpandTooltip: 'Collapse/Expand',
            headerLastRunLabel: 'Last Run: ',
            headerAvgClearLabel: 'Avg Clear: ',
            headerRunsLabel: 'Runs: ',
            headerKeysLabel: 'Keys: ',
            statAvgClear: 'Avg Clear',
            statLastRun: 'Last Run',
            statFastestRun: 'Fastest Run',
            statSlowestRun: 'Slowest Run',
            statAvgPerAttempt: 'Avg/Attempt',
            statFailRate: 'Fail Rate',
            runHistoryLabel: 'Run History',
            backfillButtonLabel: '⟳ Backfill',
            backfillButtonTooltip: 'Scan party chat and import historical runs',
            clearButtonLabel: '✕ Clear',
            clearButtonTooltip: 'Clear all runs',
            groupByLabel: 'Group by:',
            groupByTeamOption: 'Team',
            groupByDungeonOption: 'Dungeon',
            filterDungeonLabel: 'Dungeon:',
            filterDungeonAllOption: 'All Dungeons',
            filterTeamLabel: 'Team:',
            filterTeamAllOption: 'All Teams',
            noRunsYet: 'No runs yet',
            runChartLabel: '📊 Run Chart',
            popoutButtonLabel: '⇱ Pop-out',
            popoutButtonTooltip: 'Pop out chart',
            dungeonNameWithTier: (p) => `${p.name} (T${p.tier})`,
            dungeonLoading: 'Dungeon Loading...',
            characterNameFallback: 'You',
            noKeyDataYet: 'No key data yet',
            keyCounts: 'Key counts: ',
            clearAllRunsConfirm: 'Delete ALL run history data?\n\nThis cannot be undone!',
            clearAllRunsSuccessAlert: 'All run history cleared.',
            clearAllRunsFailedAlert: 'Failed to clear run history. Check console for details.',
            backfillProcessingLabel: '⟳ Processing...',
            backfillCompleteAlert: (p) => `Backfill complete!\n\nRuns added: ${p.runsAdded}\nTeams: ${p.teamsCount}`,
            backfillNoRunsAlert: 'No new runs found to backfill.',
            backfillFailedAlert: 'Backfill failed. Check console for details.',
            positionResetNotification: 'Dungeon Tracker position and size reset',
            resizeHandleTooltip: 'Drag to resize',
            soloRunsLabel: 'Solo Runs',
            unknownDungeonFallback: 'Unknown',
            noRunsMatchFilters: 'No runs match filters',
            errorLoadingRunHistory: 'Error loading run history',
            groupStatsSummary: (p) =>
                `Runs: ${p.totalRuns} | Avg Clear: ${p.avgTime} | Avg/Attempt: ${p.avgPerAttempt} | Best: ${p.bestTime} | Worst: ${p.worstTime}${p.failCount > 0 ? ` | Fails: ${p.failCount}` : ''}`,
            resultFailedBadge: 'FAILED',
            resultCanceledBadge: 'CANCELED',
            deleteRunButtonTitle: 'Delete this run',
            chartTitle: '📊 Dungeon Run Chart',
            chartAverageLabel: 'Average',
            chartDurationAxisLabel: 'Duration (minutes)',
            chartFastestLabel: 'Fastest',
            chartRunLabel: (p) => `Run ${p.number}`,
            chartRunNumberAxisLabel: 'Run Number',
            chartRunTimesLabel: 'Run Times',
            chartSlowestLabel: 'Slowest',
        },
        openableAnalytics: {
            title: 'Openable Analytics',
            closeAriaLabel: 'Close',
            sessionScopeLabel: 'Session',
            lifetimeScopeLabel: 'Lifetime',
            emptyStateSession: 'No tracked chest, crate, or cache openings this session.',
            emptyStateLifetime: 'No chest, crate, or cache history yet.<br>Open one to start tracking.<br>',
            importHistoryLabel: 'Import History',
            includesImportedDataTooltip: 'Includes imported historical data',
            actualLabel: 'Actual',
            expectedLabel: 'Expected',
            partialLabel: '[Partial]',
            partialTooltip: 'One or more openings/imports could not be fully priced',
            luckLabel: 'Luck ⓘ',
            luckTooltip:
                'Luck is Actual loot value minus Expected loot value. It does not include the container/key cost and is not opening profit.',
            importedDataNote:
                'Includes imported historical data: imported raw counts are recalculated using current Toolasha prices/loot model at import time, and imported/live periods may overlap.',
            deleteContainerButton: (p) => `Delete ${p.containerName} Data…`,
            lootHeading: 'Loot',
            noItemsMessage: 'No items gained in this scope.',
            itemColumnHeader: 'Item',
            qtyColumnHeader: 'Qty',
            valueColumnHeader: 'Value',
            valueColumnTooltip: 'Values are the amounts recorded at each opening/import, not current market value.',
            manageDataHeading: 'Manage Data',
            historicalImportsHeading: 'Historical Imports',
            noImportedSourcesMessage: 'No imported sources.',
            removeImportButton: 'Remove Import',
            importFromEdibleButton: 'Import from Edible Tools',
            chooseJsonFileButton: 'Choose JSON File',
            fileReadErrorMessage: 'Could not read the selected file.',
            pasteJsonInsteadLabel: 'Paste JSON Instead',
            pasteJsonPlaceholder: 'Paste exported JSON here (Edible Tools or MWI Combat Suite).',
            previewImportButton: 'Preview Import',
            noDataToImportMessage: 'No data found to import.',
            ediblePlayerPickerLabel: 'This Edible Tools data has more than one player - which one is this character?',
            continueButton: 'Continue',
            importPreflightSummary: (p) =>
                `${p.sourceLabel}: ${p.openings} openings across ${p.containerCount} container${p.containerCount !== 1 ? 's' : ''} ready to import.`,
            ownerMismatchWarning: (p) =>
                `This export's recorded player ("${p.ownerName}") does not match the current character.`,
            ownerUnknownWarning: 'This export does not record which character it belongs to - please verify ownership.',
            overlapWarning: 'These cumulative histories may cover the same openings and cannot be reliably deduplicated.',
            importingButtonLabel: 'Importing…',
            replaceImportButtonLabel: 'Replace Import…',
            importButtonLabel: 'Import',
            importCompleteStatus: (p) =>
                `${p.replaced ? 'Replaced' : 'Imported'} ${p.sourceLabel} import: ${p.openings} openings across ${p.containerCount} container${p.containerCount !== 1 ? 's' : ''}.`,
            saveImportErrorMessage: 'Could not save Openable Analytics data. Current changes may not persist after reload.',
            removeImportErrorMessage: 'Could not remove the imported data. It may reappear after reload.',
            importRemovedStatus: (p) => `Removed ${p.sourceLabel} import. Live Toolasha history was kept.`,
            deleteContainerConfirm: (p) =>
                `Delete all Openable Analytics data for ${p.containerName} on this character? This cannot be undone.`,
            deletionSaveErrorMessage: 'Could not save this deletion. It may reappear after reload.',
            deleteAllButton: 'Delete All Analytics Data…',
            deleteAllConfirm: (p) => `Delete ALL Openable Analytics data for ${p.characterName}? This cannot be undone.`,
            thisCharacterFallback: 'this character',
            clickForDetailsTooltip: 'Click for details',
            cumulativeItemsHeader: 'Cumulative items received across all lifetime openings:',
            currentCardTitle: 'Current',
            dropValuationHeader: (p) =>
                `What this container can drop, valued at today's market prices for ${p.amount} opened:`,
            expectedIncomeLabel: 'Expected income',
            gainedItemPartialTooltip: 'One or more gained items could not be priced.',
            historyCardTitle: 'History',
            importAmbiguousFormat: 'This data matches more than one supported format and cannot be imported.',
            importGainedItemsInvalidCountsExcluded: (p) =>
                `${p.chestName}: one or more gained items had invalid counts and were excluded.`,
            importGainedItemsInvalidDataExcluded: (p) =>
                `${p.name}: one or more gained items had invalid data and were excluded.`,
            importParseFailedGeneric: 'Could not parse this text as JSON.',
            importSkippedInvalidContainerId: (p) => `Skipped an entry with an invalid item id: "${p.containerHrid}".`,
            importSkippedInvalidOpenedCount: (p) => `Skipped ${p.name}: invalid opened count.`,
            importSkippedMalformedGainedItemData: (p) => `Skipped ${p.chestName}: gained-item data is malformed.`,
            importSkippedMalformedLootData: (p) => `Skipped ${p.name}: loot data is malformed.`,
            importSkippedMissingGainedItemData: (p) =>
                `Skipped ${p.chestName}: opening count present but gained-item data is missing.`,
            importSkippedMissingLootData: (p) => `Skipped ${p.name}: opening count present but loot data is missing.`,
            importSkippedUnmatchedContainerName: (p) => `Skipped "${p.chestName}": could not match to a known item.`,
            importUnmatchedGainedItemsExcluded: (p) =>
                `${p.chestName}: ${p.count} gained item(s) could not be matched and were excluded.`,
            importUnrecognizedFormat: 'This does not match a supported Edible Tools or MWI Combat Suite export.',
            importUnsupportedFormat: 'This does not look like a supported export.',
            incomeLabel: 'Income',
            incomeRangeTooltip:
                'Actual income for a batch this size usually lands within this range of the expected amount',
            itemsReceivedHeader: 'Items received this opening:',
            luckShortLabel: 'Luck',
            luckUnavailableTooltip: (p) =>
                `Some required values are missing, so Luck can't be calculated. ${p.luckTooltip}`,
            moreDropsNotShown: (p) => `+ ${p.count} more possible drop(s) not shown`,
            moreItemsNotShown: (p) => `+ ${p.count} more item(s) not shown`,
            noDropDataMessage: 'No drop data available for this container.',
            noItemDataForOpeningMessage: 'No item data available for this opening.',
            noItemDataRecordedMessage: 'No item data recorded yet.',
            noPriceYetNote: '(no price yet)',
            openedLabel: 'Opened',
            partialBadgeLabel: '(partial)',
            profitLabel: 'Profit',
            viewAnalyticsLink: 'View Analytics',
            vsExpectedLabel: 'vs. expected',
            importJsonParseFailed: 'Could not parse the pasted/uploaded text as JSON.',
            importNoChestsData: 'No "chests" data found in this export.',
            importNoChestOpenData: 'No "Chest_Open_Data" found in this Edible Tools data.',
            importNoPlayerData: 'No player data found in this Edible Tools data.',
            importNoChestDataForPlayer: (p) => `No chest data found for ${p.name}.`,
            importNoChestNamesMatched: 'None of the chest names in this export could be matched to a known item.',
            importEmptyHistory: 'No opening history found in this export. Existing import was not changed.',
        },
        guildCreditValue: {
            returnTabLabel: '↩ Return',
            returnLabelFallback: 'Guild',
            tokensLabel: '(tokens)',
            rankingHeader: 'Gold cost per credit — click to sort',
            columnItem: 'Item',
            columnRate: 'Rate',
            columnAskEach: 'Ask ea.',
            columnBidEach: 'Bid ea.',
            columnAskPerCredit: 'Ask/credit',
            columnBidPerCredit: 'Bid/credit',
            tokenValueNote:
                'Guild Token value is the gold you’d otherwise spend on the cheapest item route, not a market price.',
            shrineForce: 'Force',
            shrineTempo: 'Tempo',
            shrineRarity: 'Rarity',
            shrineScholar: 'Scholar',
            shrineSpirit: 'Spirit',
            shrinePlannerHeader: 'Shrine Upgrade Planner',
            shrinePlannerEmptyHint: 'Set target levels above current to see costs',
            shrinePlannerTotalCostTitle: 'Total upgrade cost',
            guildTokensLabel: 'Guild Tokens',
            shrineSectionTitle: (p) => (p.cap ? `${p.shrine} Shrine (cap: ${p.cap})` : `${p.shrine} Shrine`),
            buffLabelCombat: 'Combat',
            buffLabelSkilling: 'Skilling',
            buffRowLabel: (p) => `${p.buffLabel} (lvl ${p.level})`,
            ownedSuffix: (p) => `(own ${p.count})`,
            advisorSelectItemHint: 'Select an item to see exchange advice',
            advisorNoConversionHint: 'Selected item has no conversion for this credit',
            advisorOptimalChoice: '✓ Optimal choice for this credit type',
            advisorNoPriceData: (p) => `Best: ${p.name} — no price data for comparison`,
            advisorBetterLabel: '↑ better',
            advisorWorseLabel: '↓ worse',
            advisorSellRebuyHeader: (p) => `Sell → rebuy best item (${p.taxPercent}% tax)`,
            advisorDirectExchangeLabel: 'Direct exchange',
            advisorSellProceedsLabel: 'Sell proceeds (after tax)',
            advisorBuyLabel: (p) => `Buy ${p.name} → credits`,
            advisorDifferenceLabel: 'Difference',
            creditsAmount: (p) => `${p.amount} credits`,
            differenceValue: (p) => `${p.sign}${p.amount} credits ${p.label}`,
            allButtonLabel: 'ALL',
            fillMaxTooltip: (p) => `Fill max: ${p.amount}`,
            copyListButtonLabel: 'Copy List',
            copiedButtonLabel: 'Copied!',
            totalRowLabel: 'Total',
            upgradeCostHeader: 'Gold cost of upgrade — click to sort',
            columnQty: 'Qty',
            columnAskCost: 'Ask cost',
            columnBidCost: 'Bid cost',
            unpricedItemsNote: '* some items have no market price data',
            missingMatsButtonLabel: 'Missing Mats Marketplace',
        },
        marketData: {
            outlierPriceWarningTooltip:
                "This price was outside the normal range vs. the game's own reference market value, so Toolasha substituted the reference value instead. Adjust or disable this in Settings → Pricing & Profit.",
        },

        marketHistory: {
            modalTitle: 'Market History',
            searchItemsPlaceholder: 'Search items...',
            allTypesOption: 'All Types',
            buyOrdersOption: 'Buy Orders',
            sellOrdersOption: 'Sell Orders',
            allStatusesOption: 'All Statuses',
            activeOnlyOption: 'Active Only',
            filledOnlyOption: 'Filled Only',
            filledOrActiveOption: 'Filled or Active',
            canceledOnlyOption: 'Canceled Only',
            expiredOnlyOption: 'Expired Only',
            unknownOnlyOption: 'Unknown Only',
            exportCsvButton: 'Export CSV',
            importDataButton: 'Import Market Data',
            clearHistoryButton: 'Clear History',
            kmbFormatLabel: 'K/M/B Format',
            totalListingsStats: (p) => `Total: ${p.count} listings`,
            dateFilterBadge: (p) => `Date: ${p.range}`,
            itemsSelectedBadge: (p) => `${p.count} items selected`,
            noEnhancementLabel: 'No Enhancement',
            enhLevelBadge: (p) => `Enh Lvl: ${p.level}`,
            enhLevelsSelectedBadge: (p) => `Enh Lvl: ${p.count} selected`,
            typeBadge: (p) => `Type: ${p.type}`,
            buyLabel: 'Buy',
            sellLabel: 'Sell',
            clearAllFiltersButton: 'Clear All Filters',
            columnDate: 'Date',
            columnItem: 'Item',
            columnEnhLvl: 'Enh Lvl',
            columnType: 'Type',
            columnStatus: 'Status',
            columnPrice: 'Price',
            columnQuantity: 'Quantity',
            columnFilled: 'Filled',
            columnTotal: 'Total',
            noListingsFound: 'No listings found',
            statusActive: 'Active',
            statusFilled: 'Filled',
            statusCanceled: 'Canceled',
            statusExpired: 'Expired',
            statusUnknown: 'Unknown',
            deleteListingTitle: 'Delete this listing',
            rowsPerPageLabel: 'Rows per page:',
            showAllLabel: 'Show All',
            pageInfo: (p) => `Page ${p.current} of ${p.total}`,
            showingAllListings: (p) => `Showing all ${p.count} listings`,
            csvEmptyError: 'CSV file is empty or invalid',
            importingFromCsv: (p) => `Importing ${p.count} listings from CSV...`,
            importCompleteAlert: (p) =>
                `Import complete!\n\nImported: ${p.imported} new listings\nSkipped: ${p.skipped} duplicates or invalid rows\nTotal: ${p.total} listings`,
            importFailedAlert: (p) => `Import failed: ${p.error}`,
            csvTruncatedError:
                'File appears to be truncated or incomplete. The JSON does not end properly. Try exporting from Edible Tools again, or export to CSV from the Market History Viewer and import that instead.',
            marketListArrayError: 'market_list must be an array or JSON string containing an array',
            unrecognizedFormatError:
                'Unrecognized format. Expected:\n- Direct array: [{listing1}, {listing2}, ...]\n- Object format: {"market_list": [...]}\n- Edible Tools format: {"market_list": "[...]"}',
            noListingsInFileError: 'No listings found in file or array is empty',
            importingListings: (p) => `Importing ${p.count} listings...`,
            importCompleteDuplicatesAlert: (p) =>
                `Import complete!\n\nImported: ${p.imported} new listings\nSkipped: ${p.skipped} duplicates\nTotal: ${p.total} listings`,
            clearHistoryConfirm: (p) =>
                `⚠️ WARNING: This will permanently delete ALL market history data!\nYou are about to delete ${p.count} listings.\nRECOMMENDATION: Export to CSV first using the "Export CSV" button.\nThis action CANNOT be undone!\nAre you absolutely sure you want to continue?`,
            clearHistorySuccessAlert: 'Market history cleared successfully.',
            clearHistoryFailedAlert: (p) => `Failed to clear history: ${p.error}`,
            filterByDateTitle: 'Filter by Date',
            availableRangeLabel: (p) => `Available: ${p.range}`,
            fromLabel: 'From:',
            toLabel: 'To:',
            applyButton: 'Apply',
            filterByItemTitle: 'Filter by Item',
            filterByEnhancementTitle: 'Filter by Enhancement Level',
            filterByTypeTitle: 'Filter by Type',
            csvHeaderEnhancement: 'Enhancement',
            csvHeaderId: 'ID',
        },
        labSim: {
            panelTitle: 'Lab Simulator',
            tabConfigure: 'Configure',
            tabMaxLevel: 'Max Level',
            tabUpgrade: 'Upgrade',
            tabSkilling: 'Skilling',
            monsterLabel: 'Monster',
            levelLabel: 'Level',
            hoursLabel: 'Hours',
            teaLabel: 'Tea',
            coffeeLabel: 'Coffee',
            foodLabel: 'Food',
            crateNone: 'None',
            crateBasic: 'Basic',
            crateAdvanced: 'Advanced',
            crateExpert: 'Expert',
            loadingLoadout: 'Loading loadout...',
            labyrinthBuffsHeader: 'Labyrinth Buffs',
            simulateButton: 'Simulate',
            findMaxLabel: 'Find Max',
            findMaxTooltip: 'Binary search for highest beatable level at the specified win rate threshold',
            stopButton: 'Stop',
            playerLabel: 'Player',
            analyzeButton: 'Analyze',
            roomLevelLabel: 'Room Level',
            calculateButton: 'Calculate',
            analyzeUpgradesButton: 'Analyze Upgrades',
            allSkillsOption: 'All Skills',
            skillWoodcutting: 'Woodcutting',
            skillForaging: 'Foraging',
            skillMilking: 'Milking',
            skillCooking: 'Cooking',
            skillBrewing: 'Brewing',
            skillCheesesmithing: 'Cheesesmithing',
            skillCrafting: 'Crafting',
            skillTailoring: 'Tailoring',
            skillAlchemy: 'Alchemy',
            skillEnhancing: 'Enhancing',
            statusDefault: 'Select a monster in Configure, then use Max Level or Upgrade to simulate.',
            statusSimCancelled: 'Labyrinth simulation cancelled.',
            playerFallbackName: (p) => `Player ${p.index}`,
            buffsUnavailable: 'No character data available.',
            buffGroupCombat: 'Combat',
            buffGroupSkilling: 'Skilling',
            buffGroupOther: 'Other',
            buffDamage: 'Damage',
            buffAtkSpeed: 'Atk Speed',
            buffCastSpeed: 'Cast Speed',
            buffCritRate: 'Crit Rate',
            buffSpeed: 'Speed',
            buffEfficiency: 'Efficiency',
            buffSuccess: 'Success',
            buffDouble: 'Double',
            buffExperience: 'Experience',
            buffCooldown: 'Cooldown',
            buffTorch: 'Torch',
            buffShroud: 'Shroud',
            buffBeacon: 'Beacon',
            buffAutomation: 'Automation',
            statusLoadoutUnavailable: (p) =>
                `Configured combat loadout unavailable: ${p.name}. Choose another loadout or Current Gear.`,
            statusSelectMonsterFirst: 'Select a monster first.',
            statusNoGameData: 'No game data available.',
            statusNoCharacterData: 'No character data available.',
            progressLevelStep: (p) => `Level ${p.level} — ${p.winRate}% (step ${p.step}/${p.total})`,
            statusSimFailed: (p) => `Simulation failed: ${p.error}`,
            resultMonsterLevel: (p) => `${p.monster} — Level ${p.level}`,
            winRateLabel: 'Win Rate:',
            encountersLabel: 'Encounters:',
            deathsLabel: 'Deaths:',
            simTimeLabel: 'Sim Time:',
            completedIn: (p) => `Completed in ${p.time}`,
            statusSimComplete: (p) => `Simulation complete — ${p.winRate}% win rate at level ${p.level}.`,
            resultFindMaxTitle: (p) => `${p.monster} — Find Max Result`,
            levelValue: (p) => `Level ${p.level}`,
            atLevelSuffix: (p) => `at level ${p.level}`,
            recommendedSkipLabel: 'Recommended skip:',
            completedInSteps: (p) => `Completed in ${p.time} (${p.steps} steps)`,
            statusMaxBeatableLevel: (p) => `Max beatable level: ${p.level} (${p.winRate}% win rate).`,
            statusSelectMonsterConfigureTab: 'Select a monster in the Configure tab first.',
            statusNoPlayerData: 'No player data available.',
            progressCurrentTotalDesc: (p) => `${p.current} / ${p.total}: ${p.description}`,
            statusUpgradeAnalysisFailed: (p) => `Upgrade analysis failed: ${p.error}`,
            noUpgradeCandidates: 'No upgrade candidates found.',
            xpAbbreviation: 'XP',
            tokenUpgradesHeader: 'Token Upgrades',
            colUpgrade: 'Upgrade',
            colTokens: 'Tokens',
            colRate: 'Rate',
            colDelta: 'Delta',
            colTokensPerPct: 'Tokens/1%',
            goldUpgradesHeader: 'Gold Upgrades',
            colCost: 'Cost',
            colWinRate: 'Win Rate',
            colGoldPerPct: 'Gold/1%',
            statusUpgradeCandidatesAnalyzed: (p) => `${p.count} upgrade candidates analyzed.`,
            skillLoadoutsHeader: 'Skill Loadouts',
            currentGearOption: 'Current Gear',
            unavailableSuffix: (p) => `${p.name} (Unavailable)`,
            allSuffix: (p) => `${p.name} (All)`,
            statusNoCharacterDataWaitEditor: 'No character data. Wait for editor to load.',
            statusSkillingLoadoutUnavailable: (p) =>
                `Selected skilling loadout unavailable: ${p.names}. Choose another loadout or Current Gear.`,
            skillingRoomLevelTitle: (p) => `Skilling Room Level ${p.level}`,
            avgClearLabel: 'Avg Clear:',
            colSkill: 'Skill',
            colLevel: 'Level',
            colEffLevel: 'Eff. Lvl',
            colSuccess: 'Success',
            colClear: 'Clear',
            colActions: 'Actions',
            statusSkillingClearRatesCalculated: (p) => `Skilling clear rates calculated for level ${p.level}.`,
            statusSkillingUpgradeAnalysisFailed: (p) => `Skilling upgrade analysis failed: ${p.error}`,
            statusNoSkillingUpgradeCandidates: 'No skilling upgrade candidates found.',
            colClearRate: 'Clear Rate',
            equipmentUpgradesHeader: 'Equipment Upgrades',
            baselineAvgClear: 'Baseline Avg Clear:',
            statusSkillingUpgradeCandidatesAnalyzed: (p) => `${p.count} skilling upgrade candidates analyzed.`,
            tabButtonLabel: 'Lab Sim',
        },
        combatSimUi: {
            panelTitle: 'Combat Simulator',
            tabConfigure: 'Configure',
            tabResults: 'Results',
            tabSeek: 'Seek',
            tabUpgrade: 'Upgrade',
            zoneLabel: 'Zone',
            tierLabel: 'Tier',
            hoursLabel: 'Hours',
            simulateButton: 'Simulate',
            simAllZonesLabel: 'Sim All Zones',
            simAllSoloLabel: 'Sim All Solo',
            skipWorseTiersLabel: 'Skip Worse Tiers',
            skipWorseTiersTooltip:
                'Stop simming higher tiers for a zone if both XP/hr and profit/hr declined vs the previous tier',
            loadingLoadout: 'Loading loadout...',
            stopButton: 'Stop',
            searchItemPlaceholder: 'Search item...',
            playerLabel: 'Player',
            modeLabel: 'Mode',
            equipmentOption: 'Equipment',
            abilityLevelsOption: 'Ability Levels',
            abilitySwapsOption: 'Ability Swaps',
            houseRoomsOption: 'House Rooms',
            incrementLevelsOption: '+Levels',
            targetLevelOption: 'Target Lv',
            levelsToAddTitle: 'Number of levels to add to each ability',
            absoluteTargetLevelTitle: 'Absolute target level for all abilities',
            exampleLevelPlaceholder: 'e.g. 80',
            skipBackLabel: 'Skip Back',
            analyzeButton: 'Analyze',
            statusSelectZoneSimulate: 'Select a zone and click Simulate.',
            dungeonZonePrefix: '[D] {{name}}',
            checkAllLabel: 'Check All',
            colTotalXpPerHr: 'Total XP/hr',
            colProfitPerDay: 'Profit/day',
            colStamina: 'Stam',
            colIntelligence: 'Int',
            colAttack: 'Atk',
            colMelee: 'Melee',
            colDefense: 'Def',
            colRanged: 'Ranged',
            colMagic: 'Magic',
            colZone: 'Zone',
            colTier: 'T',
            colEncPerHr: 'Enc/hr',
            colDeathsPerHr: 'Deaths/hr',
            colOom: 'OOM',
            colRevPerHr: 'Rev/hr',
            colCostPerHr: 'Cost/hr',
            colProfitPerHr: 'Profit/hr',
            noLabel: 'No',
            lessThanTenthPercent: '<0.1%',
            statusNoItemSelected: 'No item selected. Type a name and pick from the list.',
            statusNoGameData: 'No game data available.',
            noZonesDropItem: 'No zones drop this item.',
            statusNoCharacterData: 'No character data available.',
            statusSeeking: 'Seeking {{itemName}} in {{zoneCount}} zone/tiers... {{elapsed}}',
            statusSeekComplete: 'Seek complete in {{elapsed}}: {{count}} sources found for {{itemName}}',
            statusSeekCancelled: 'Seek cancelled.',
            statusSeekError: 'Seek error: {{message}}',
            noZonesDropItemNamed: 'No zones drop {{itemName}}.',
            colItemsPerHr: 'Items/hr',
            colCostPerDrop: 'Cost/Drop',
            bestSourcesFor: 'Best sources for {{itemName}}',
            statusSearchSeek: 'Search for a combat drop item, then click Seek.',
            statusSelectPlayerAnalyze: 'Select a player and click Analyze.',
            statusNoResultsYet: 'No results yet. Run a simulation first.',
            statusSimulationCancelled: 'Simulation cancelled.',
            statusNoZoneSelected: 'No zone selected.',
            warningMaxPlayers: 'Non-dungeon zones support max 3 players (you have {{count}}). Remove players to continue.',
            partyInfoLabel: (p) => `Party (${p.loaded} loaded${p.missing > 0 ? `, ${p.missing} missing` : ''})`,
            soloLabel: 'Solo',
            statusSimulating: 'Simulating ({{partyInfo}})... {{elapsed}}',
            currentGearLabel: 'Current Gear',
            pricingModeConservative: 'Buy: Ask / Sell: Bid',
            pricingModeHybrid: 'Buy: Ask / Sell: Ask',
            pricingModeOptimistic: 'Buy: Bid / Sell: Ask',
            pricingModePatientBuy: 'Buy: Bid / Sell: Bid',
            missingMembersNote: ' | Missing: {{names}} (open their profiles)',
            statusSimulationComplete:
                'Simulation complete in {{elapsed}}: {{hours}} hours · {{partyInfo}} · Pricing: {{modeLabel}}{{missingNote}}',
            statusSimulationError: 'Simulation error: {{message}}',
            statusNoZonesSelected: 'No zones selected.',
            statusSimulatingZones: 'Simulating {{count}} zones... {{elapsed}}',
            statusAllZonesComplete: 'All zones complete in {{elapsed}}: {{count}} zones · {{hours}} hours each',
            overviewHeading: 'Overview',
            manaRunOutLabel: 'Mana Run Out',
            yesLabel: 'Yes',
            runOutRatioLabel: 'Run Out Ratio',
            debuffOnLevelGapLabel: 'Debuff on Level Gap',
            partyDpsLabel: 'Party DPS',
            colDps: 'DPS',
            dungeonsCompletedPerHrLabel: 'Dungeons completed/hr',
            dungeonsFailedPerHrLabel: 'Dungeons failed/hr',
            totalCompletedFailedLabel: 'Total completed / failed',
            durationDecimalMinutes: '{{value}} min',
            durationMinutesSeconds: '{{minutes}}m {{seconds}}s',
            durationSeconds: '{{seconds}}s',
            avgCompletionTimeLabel: 'Avg completion time',
            maxWaveReachedLabel: 'Max wave reached',
            xpPerHrHeading: 'XP/hr',
            totalLabel: 'Total',
            dropsHeading: 'Drops',
            perHrHeader: '/hr',
            perDayHeader: '/day',
            goldPerHrHeader: 'Gold/hr',
            goldPerDayHeader: 'Gold/day',
            totalGoldHeader: 'Total Gold',
            totalRevenueLabel: 'Total Revenue',
            consumableCostsHeading: 'Consumable Costs',
            costPerDayHeader: 'Cost/day',
            totalCostHeader: 'Total Cost',
            totalExpensesLabel: 'Total Expenses',
            keyCostsHeading: 'Key Costs',
            totalKeyCostsLabel: 'Total Key Costs',
            netProfitHeading: 'Net Profit',
            profitLabel: 'Profit',
            wipeEventsHeading: 'Wipe Events ({{count}})',
            wipeEventLabel: 'Wipe #{{number}} — Wave {{wave}} @ {{time}}s',
            abilityAutoAttack: 'Auto Attack',
            abilityDot: 'DoT',
            abilityPhysicalThorns: 'Physical Thorns',
            abilityElementalThorns: 'Elemental Thorns',
            abilityRetaliation: 'Retaliation',
            combatLogLine: '{{source}} cast {{ability}} → {{target}} {{damage}} HP {{hpChange}}',
            playersHpLabel: 'Players HP: {{list}}',
            comparisonHeading: 'Comparison ({{count}} runs)',
            baselineLabel: 'Baseline:',
            colScenario: 'Scenario',
            colEph: 'EPH',
            colSuccess: 'Success',
            deleteResultTooltip: 'Delete result',
            removeFromComparisonTooltip: 'Remove from comparison',
            addSimToComparisonOption: '+ Add sim to comparison...',
            playerFallbackName: 'Player {{number}}',
            statusSelectZoneConfigureFirst: 'Select a zone in Configure tab first.',
            statusNoPlayerData: 'No player data available. Configure a simulation first.',
            statusAnalysisCancelled: 'Analysis cancelled.',
            statusAnalysisComplete: 'Analysis complete. {{count}} upgrades evaluated.',
            statusAnalysisFailed: 'Analysis failed: {{message}}',
            noUpgradeCandidates: 'No upgrade candidates found. Ensure equipment is configured.',
            colUpgrade: 'Upgrade',
            colCost: 'Cost',
            colGoldPerDps: 'Gold/0.1% DPS',
            colGoldPerExp: 'Gold/0.1% EXP',
            colGoldPerProfit: 'Gold/0.1% Profit',
            notAvailableLabel: 'N/A',
            notCombatRelevantLabel: 'not combat-relevant',
            colExpPerHr: 'EXP/hr',
            colDph: 'DPH',
            baselineSummaryLine: 'Baseline: DPS {{dps}} | EXP {{exp}} | Profit {{profit}} | EPH {{eph}} | DPH {{dph}}',
            statusRunningBaseline: 'Running baseline...',
            statusBaselineComplete: 'Baseline complete',
            statusComputingBaseline: 'Computing baseline...',
            statusSimulatingUpgrade: (p) => `Simulating: ${p.name}`,
            statusEvaluating: (p) => `Evaluating: ${p.name}`,
            statusBaselineWinRate: (p) => `Baseline: ${p.winRate}%`,
            statusBaselineClearRate: (p) => `Baseline: ${p.clearRate}%`,
            tabButtonLabel: 'Combat Sim',
        },
        skillingOptimizer: {
            actionLockedLabel: (p) => `${p.name} (lv ${p.level} — locked, may unlock via tea)`,
            actionsLabel: 'Actions:',
            alchemyAutoOption: '— Auto (from active action) —',
            alchemyBasisLabel: (p) => `Based on: ${p.typeName} ${p.itemName}${p.levelSuffix} (${p.source})`,
            alchemyBasisManualSource: 'manually selected',
            alchemyBasisNothingQueued:
                'Based on: nothing queued - XP is an item-agnostic estimate, Gold is unavailable. Pick an item above, or start an Alchemy action.',
            alchemyBasisQueueSource: 'from your active/queued action',
            alchemyEnhancementLevelTooltip: 'Enhancement level (ignored for Transmute)',
            alchemyItemHint:
                'Alchemy Gold/XP are priced against one item - pick one, or leave on Auto to use whatever your character is currently queued to Alchemize.',
            alchemyItemLabel: 'Alchemy Item:',
            alchemyTypeCoinify: 'Coinify',
            alchemyTypeDecompose: 'Decompose',
            alchemyTypeTransmute: 'Transmute',
            alchemyTypeUnrefine: 'Unrefine',
            alchemyUnsupportedNotice:
                'Alchemy scenario math is not item-aware yet, so a generic Results number here would misrepresent real Coinify/Decompose/Transmute economics. Unsupported for now.',
            allActionsCount: (p) => `All (${p.count})`,
            allActionsOption: 'All',
            alreadyOptimal: 'Already at optimal enhancement',
            avgGoldPerHourCompactStat: 'Avg Gold/hr',
            avgGoldPerHourStat: 'Avg Gold / hr',
            avgXpPerHourCompactStat: 'Avg XP/hr',
            avgXpPerHourStat: 'Avg XP / hr',
            compareGainNote: '% shows gain over your compared loadout item for each slot.',
            compareLabel: 'Compare:',
            compareLoadoutUnavailableWarning: (p) =>
                `Compare loadout “${p.name}” is unavailable. Comparison was not substituted with Current Gear.`,
            compareNoneOption: '— None —',
            emptyOption: '— Empty —',
            emptySlotCapitalized: 'Empty',
            emptySlotLower: 'empty',
            equipmentHeader: 'Equipment',
            equipmentProgressionHeader: 'Equipment Progression',
            forGoldLabel: 'For Gold',
            forXpLabel: 'For XP',
            goldPerHourStat: 'Gold / hr',
            houseRoomLabel: 'House Room',
            incompletePriceCostTooltip: 'A required market price is unresolved, so this cost is not exact.',
            incompletePriceRankingTooltip:
                'A required market price is unresolved, so this recommendation is not an exact ranking.',
            incompleteValueSuffix: (p) => `${p.value} (incomplete)`,
            levelLabel: 'Level:',
            levelLockedSeparator: '— Level locked —',
            loadoutLabel: 'Loadout:',
            loadoutUnavailableStatus: (p) => `Loadout “${p.name}” is unavailable and was not loaded.`,
            modeSimulator: 'Simulator',
            modeUpgrade: 'Upgrade',
            noCompareGainNote:
                '% shows gain over an empty slot. Select a loadout in Compare to see gains over your current gear.',
            noLoadoutOption: '— No loadout —',
            noRelevantEquipment: 'No relevant equipment found for this skill at the selected level.',
            optimalTeasHeader: 'Optimal Teas',
            optimizeButton: 'Optimize',
            optimizingButton: 'Optimizing…',
            refinedItemTooltip:
                'Refined item: has higher base stats than its non-refined counterpart, so a lower enhancement level can still outperform a higher-level non-refined item.',
            resultsHeader: 'Results',
            searchActionsPlaceholder: 'Search actions...',
            searchPlaceholder: 'Search…',
            selectedLoadoutFallbackName: 'Selected loadout',
            simulateButton: 'Simulate',
            simulatingButton: 'Simulating…',
            skillLabel: 'Skill:',
            sortBestValue: 'Best Value',
            sortCostCheapest: 'Cost (cheapest)',
            sortGoldGainPercent: 'Gold Gain %',
            sortLabel: 'Sort:',
            sortPaybackFastest: 'Payback (fastest)',
            sortProfitRatioCheapest: 'G/0.01% Profit (cheapest)',
            sortSlotOrder: 'Slot Order',
            sortXpGainPercent: 'XP Gain %',
            sortXpRatioCheapest: 'G/0.01% Exp/Hr (cheapest)',
            tabLabel: 'Skilling Sim',
            tableHeaderCost: 'Cost',
            tableHeaderPayback: 'Payback',
            tableHeaderProfitDelta: 'Profit Δ',
            tableHeaderProfitRatio: 'G/0.01% Profit',
            tableHeaderXpDelta: 'Exp/Hr Δ',
            tableHeaderXpRatio: 'G/0.01% Exp/Hr',
            teaCostPerHour: (p) => `Tea cost: ${p.cost}/hr`,
            teasHeader: 'Teas',
            teaSlotLabel: (p) => `TEA ${p.index}`,
            unavailableLabel: (p) => `${p.name} (Unavailable)`,
            xpPerHourStat: 'XP / hr',
        },
        riskOfRuinUi: {
            launcherButtonLabel: 'Risk of Ruin',
            panelTitle: 'Risk of Ruin Calculator',
            statusDefault: 'Choose a mode, set your target, and click Calculate.',
            modeLabel: 'Mode',
            modeChestOption: 'Dungeon Chest',
            modeAlchemyOption: 'Alchemy (Transmute)',
            modeEnhancingOption: 'Enhancing',
            startingGoldLabel: 'Starting gold',
            startingGoldPlaceholder: 'e.g. 5m, 1.2b',
            calculateButton: 'Calculate',
            chestTypeLabel: 'Chest type',
            chestsToOpenLabel: 'Chests to open',
            itemToTransmuteLabel: 'Item to Transmute',
            itemNamePlaceholder: 'Start typing an item name...',
            catalystLabel: 'Catalyst',
            catalystBestOption: 'Best available (auto)',
            catalystNoneOption: 'None',
            catalystTypeSpecificOption: 'Type-specific catalyst',
            catalystPrimeOption: 'Prime catalyst',
            actionsToAttemptLabel: 'Actions to attempt',
            itemToEnhanceLabel: 'Item to enhance',
            targetLevelLabel: 'Target level',
            startLevelLabel: 'Start level',
            protectFromLevelLabel: 'Protect from level (0 = never)',
            statusCalculating: 'Calculating…',
            statusErrorCalculation: 'Error during calculation.',
            statusInvalidTransmuteItem: 'Enter a valid transmutable item name.',
            statusInvalidEnhanceItem: 'Enter a valid enhanceable item name.',
            statusEnhancementModelFailed: 'Could not build an enhancement model for these parameters.',
            optimalCommitNotApplicable:
                'Optimal share of cash to commit: not applicable — enhancing has no revenue distribution to size a bet against, only a fixed cost toward the target level. Use the ruin probability above instead.',
            statusTrialsSimulated: (p) => `${p.trials} trials simulated.`,
            optimalCommitNoEdge:
                "<strong>Optimal share of cash to commit:</strong> 0% — this setup has no positive expected edge (E[R] ≤ 1), so sizing a bet against its variance isn't meaningful here.",
            optimalCommitWithEdge: (p) =>
                `<strong>Optimal share of cash to commit:</strong> ${p.percent} of bankroll (${p.gold} ≈ ${p.actions} actions)`,
            optimalCommitVarianceNote: `Variance-based cap only — ignores the downward price pressure from selling your own output. Toolasha shows an automatic "Sell depth" estimate on each tracked output's marketplace order-book page, but only once you've opened that item's page in-game this session — see which outputs are tracked below.`,
            trackingSellDepthNote: (p) =>
                `Tracking "Sell depth" for: ${p.names} — open that item's order-book page in the marketplace to see the estimate.`,
            untrackedOutputsNote: (p) => `Not tracked (no current sell price available to check against): ${p.names}.`,
            untradeableOutputNote: (p) => `${p.itemName} is untradeable, so no "Sell depth" check applies.`,
            ruinProbabilityLine: (p) =>
                `<strong>Ruin probability:</strong> ${p.probability} (95% CI: ${p.ciLow} – ${p.ciHigh})`,
            ruinPossibleAtActionLine: (p) => `<strong>Ruin becomes possible at action:</strong> ${p.value}`,
            neverRuinPossible: 'never (no single action can lose money)',
            peakRuinExposureLine: (p) => `<strong>Peak ruin exposure at action:</strong> ${p.value}`,
            noRuinOccurred: 'no ruin occurred in the simulation',
            avgActionsBeforeRuinLine: (p) => `<strong>Average actions before ruin (when it occurs):</strong> ${p.value}`,
            undecidedTrialsNote: (p) =>
                `${p.undecided} of ${p.total} trials neither ruined nor reached the target within the simulation's step cap — the result may be imprecise for this very long-horizon scenario.`,
            noSingleActionLoss: 'No single action can ever lose money here, so ruin never becomes possible.',
            ruinFormulaLine: (p) =>
                `<strong>Ruin becomes possible at action</strong> = ⌈starting gold ÷ max single-action loss⌉ = ⌈${p.startingGold} ÷ ${p.maxLoss}⌉ = ${p.minActions}`,
            entryKeyLine: (p) => `Entry key (${p.name}): ${p.price}`,
            chestKeyLine: (p) => `Chest key (${p.name}): ${p.price}`,
            totalCostPerOpenLine: (p) => `<strong>Total cost per open:</strong> ${p.total}`,
            guaranteedMinPayoutLine: (p) =>
                `Guaranteed minimum payout per open: ${p.amount} (the sum of every drop table entry with a 100% drop rate, at its minimum count — a real chest always drops at least this much, it is never actually 0)`,
            chestMaxLossLine: (p) =>
                `<strong>Max single-action loss:</strong> ${p.loss} = cost − guaranteed minimum payout = ${p.total} − ${p.min}`,
            guaranteedDropLabel: (p) => `${p.itemName} (guaranteed)`,
            costRiskDetailsSummary: 'Cost & risk details',
            dropTableSummary: (p) => `Drop table (${p.count} items)`,
            colItem: 'Item',
            colDropRate: 'Drop rate',
            colAvgCount: 'Avg count',
            colPrice: 'Price',
            colEv: 'EV',
            totalEvPerOpenLabel: 'Total EV per open',
            successRateLine: (p) => `Success rate: ${p.rate}`,
            materialCostLine: (p) => `Material cost (paid every attempt): ${p.cost}`,
            coinCostLine: (p) => `Coin cost (paid every attempt): ${p.cost}`,
            catalystCostLine: (p) => `Catalyst (${p.name}, paid only on success): ${p.cost}`,
            noCatalystUsed: 'No catalyst used.',
            dropTableExplanationNote: `The output drop table (below) is a single mutually-exclusive roll <em>given success</em> — each branch is its own separate outcome, not averaged together, so a rare high-value branch's real tail risk shows up in the simulation instead of being smoothed away.`,
            netOnFailureLine: (p) => `<strong>Net on failure:</strong> ${p.value}`,
            maxLossLine: (p) => `<strong>Max single-action loss:</strong> ${p.value}`,
            selfReturnLabel: (p) => `${p.itemName} (self-return)`,
            failureLabel: '(failure)',
            unpricedProbabilityNote: (p) =>
                `${p.percent} of the success-branch probability has no market price data and is treated as a 0-payout outcome (never inflated with a guess).`,
            bonusDropsSummary: (p) => `Bonus drops (${p.count}, independent of success/fail)`,
            colChancePerAttempt: 'Chance per attempt',
            colPayoutIfHit: 'Payout if hit',
            outputDropTableSummary: (p) => `Output drop table (${p.count} branches, one roll given success)`,
            colOutcome: 'Outcome',
            costPerAttemptLine: (p) => `<strong>Cost per attempt (materials, every attempt):</strong> ${p.value}`,
            protectionCostLine: (p) => `<strong>Protection cost (charged only on a protected failure):</strong> ${p.value}`,
            maxLossWithNoteLine: (p) =>
                `<strong>Max single-action loss:</strong> ${p.value} (worst case: an attempt fails at a protected level)`,
            costRiskDetailsLevelsSummary: (p) => `Cost & risk details (levels +${p.startLevel} to +${p.targetLevel})`,
            perLevelRatesSummary: (p) => `Per-level success rates & costs (${p.count} levels)`,
            colAttempt: 'Attempt',
            colSuccess: 'Success',
            colCost: 'Cost',
            colFailArrow: 'Fail →',
            colProtectionCost: 'Protection cost',
        },
        inventoryCountDisplay: {
            inInventorySuffix: (p) => `(${p.count} in inventory)`,
        },
        profitDisplay: {
            equippedLabel: 'Equipped',
            loadoutLabelDefault: (p) => `${p.name}${p.isDefault ? ' (Default)' : ''}`,
            loadoutUnavailable: (p) => `Equipped ⚠ (saved ${p.name} unavailable)`,
            genericLoadoutName: 'loadout',
            rareFindBonusSummary: (p) => `${p.value}% rare find`,
            hrSuffix: '/hr',
            actionSuffix: '/action',
            daySuffix: '/day',
            itemsUnit: 'items',
            dropsUnit: 'drops',
            drinksUnit: 'drinks',
            revenueHeader: (p) => `Revenue: ${p.label}`,
            costsHeader: (p) => `Costs: ${p.label}`,
            netProfitLine: (p) => `Net Profit: ${p.value}`,
            perHourPerDay: (p) => `${p.perHour}, ${p.perDay}`,
            totalProfitSummary: (p) => `${p.base} | Total profit: ${p.value}`,
            pricingModeLine: (p) => `Pricing Mode: ${p.mode}  •  Loadout: ${p.loadout}`,
            actionsEfficiencyLine: (p) => `Actions: ${p.actions} | Efficiency: +${p.efficiency}%`,
            actionsLine: (p) => `Actions: ${p.actions}`,
            revenueCostsSummary: (p) => `Revenue: ${p.revenue} | Costs: ${p.costs}`,
            baseOutputLine: (p) => `• ${p.name} (Base): ${p.rate} @ ${p.price}${p.missingNote} each → ${p.revenue}`,
            gourmetOutputLine: (p) =>
                `• ${p.name} (Gourmet ${p.pct}): ${p.rate} @ ${p.price}${p.missingNote} each → ${p.revenue}`,
            gourmetOutputLinePlus: (p) =>
                `• ${p.name} (Gourmet +${p.pct}): ${p.rate} @ ${p.price}${p.missingNote} each → ${p.revenue}`,
            processingConsumedLine: (p) => `• ${p.item} consumed: -${p.rate} @ ${p.price}${p.missingNote} → -${p.revenue}`,
            processingProducedLine: (p) => `• ${p.item} produced: ${p.rate} @ ${p.price}${p.missingNote} → ${p.revenue}`,
            processingSectionTitle: (p) => `• Processing (${p.pct} proc): Net ${p.net}`,
            primaryOutputsHeaderGathering: (p) =>
                `Primary Outputs: ${p.label} (${p.count} item${p.count !== 1 ? 's' : ''})`,
            primaryOutputsHeaderProduction: (p) => `Primary Outputs: ${p.label}${p.gourmetSuffix}`,
            gourmetSuffixParen: (p) => ` (${p.pct} gourmet)`,
            dropLine: (p) => `• ${p.itemName}: ${p.rate} (${p.pct}) → ${p.revenue}`,
            essenceDropsHeader: (p) =>
                `Essence Drops: ${p.label} (${p.count} item${p.count !== 1 ? 's' : ''}, ${p.pct}% essence find)`,
            rareFindsHeader: (p) => `Rare Finds: ${p.label} (${p.count} item${p.count !== 1 ? 's' : ''}, ${p.summary})`,
            drinkCostLineNoEach: (p) => `• ${p.name}: ${p.rate} @ ${p.price}${p.missingNote} → ${p.revenue}`,
            drinkCostLineEach: (p) => `• ${p.name}: ${p.rate} @ ${p.price}${p.missingNote} each → ${p.revenue}`,
            drinkCostsHeader: (p) => `Drink Costs: ${p.label} (${p.count} drink${p.count !== 1 ? 's' : ''})`,
            artisanReductionNote: (p) => ` (${p.baseAmount} base -${p.pct} 🍵)`,
            materialCostLine: (p) =>
                `• ${p.name}: ${p.rate}${p.artisanNote} @ ${p.price}${p.missingNote}${p.customNote} → ${p.revenue}`,
            materialCostsHeader: (p) => `Material Costs: ${p.label} (${p.count} material${p.count !== 1 ? 's' : ''})`,
            marketTaxLine: (p) => `• Market Tax: ${p.pct}% of revenue → ${p.label}`,
            marketTaxSectionTitle: (p) => `Market Tax: ${p.label} (${p.pct}%)`,
            marketTaxExcludedLabel: 'Excluded',
            marketTaxExcludedLine: '• Market Tax: Excluded (producing for personal use)',
            marketTaxExcludedSectionTitle: 'Market Tax: Excluded',
            sellTaxExcludedWarning: '⚠ Sell tax excluded — assumes you keep this output, not an actual sale price',
            modifierRow: (p) => `${p.icon}+${p.value}% ${p.label}`,
            levelAdvantageLabel: 'Level advantage',
            houseRoomLabel: 'House room',
            teaLabel: 'Tea',
            equipmentLabel: 'Equipment',
            communityBuffLabel: 'Community buff',
            achievementLabel: 'Achievement',
            scrollOfEfficiencyLabel: 'Scroll of Efficiency',
            scrollOfGatheringLabel: 'Scroll of Gathering',
            houseRoomsPluralLabel: 'House rooms',
            scrollOfRareFindLabel: 'Scroll of Rare Find',
            guildShrineLabel: 'Guild Shrine',
            efficiencyLabel: 'Efficiency',
            gatheringQuantityLabel: 'Gathering Quantity',
            rareFindLabel: 'Rare Find',
            modifierSectionTitle: (p) => `${p.title}: +${p.total}`,
            artisanSectionTitle: (p) => `Artisan: -${p.value}`,
            gourmetSectionTitle: (p) => `Gourmet: +${p.value}`,
            modifierSummaryEff: (p) => `+${p.value}% eff`,
            modifierSummaryGather: (p) => `+${p.value}% gather`,
            modifierSummaryRare: (p) => `+${p.value}% rare`,
            modifierSummaryArtisan: (p) => `-${p.value} artisan`,
            modifierSummaryGourmet: (p) => `+${p.value} gourmet`,
            artisanReductionSentence: (p) => `-${p.value} material requirement from Artisan Tea`,
            gourmetBonusSentence: (p) => `+${p.value} bonus items from Gourmet Tea`,
            modifiersHeader: 'Modifiers',
            perHourBreakdownTitle: 'Per hour breakdown',
            perActionBreakdownTitle: 'Per action breakdown',
            profitabilityTitle: 'Profitability',
            actionsCountBreakdownTitle: (p) => `${p.count} actions breakdown`,
        },
        customTabsUi: {
            emptyTabsMessage: 'No custom tabs yet. Click "+ Tab" to create one.',
            addTabButton: '+ Tab',
            exportButton: 'Export',
            importButton: 'Import',
            expandAllButton: 'Expand All',
            collapseAllButton: 'Collapse All',
            clearAllTabsButton: 'Clear All',
            clearAllTabsConfirm: 'Delete all tabs and their organization? This cannot be undone.',
            importCategoriesButton: 'Import Categories',
            invalidLayoutFileAlert: '[Toolasha] Invalid layout file.',
            failedReadLayoutFileAlert: '[Toolasha] Failed to read layout file.',
            editTabTooltip: 'Edit tab',
            addSubtabTooltip: 'Add subtab',
            deleteTabTooltip: 'Delete tab',
            itemsHiddenWarningTooltip:
                'Items are hidden — expand the relevant categories in the Inventory tab to show them here.',
            unorganizedHeaderLabel: (p) => `Unorganized (${p.count})`,
            editTabModalTitle: 'Edit Tab',
            nameFieldLabel: 'Name',
            colorFieldLabel: 'Color',
            addCategoryLabel: 'Add Category',
            allItemsCheckboxLabel: 'All items',
            fromLoadoutLabel: 'From Loadout',
            itemsFieldLabel: 'Items',
            searchItemsToAddPlaceholder: 'Search items to add...',
            catFilterAllOption: 'All',
            addLineBreakButton: '+ Line Break',
            deleteTabButton: 'Delete Tab',
            customColorTooltip: 'Custom color',
            confirmDeleteButton: 'Confirm Delete?',
            confirmClearButton: 'Confirm Clear?',
            addAllLevelsLabel: (p) => `+ Add all levels (+0–+${p.maxLevel})`,
            inInventoryTooltip: 'In inventory',
            noMatchingItemsMessage: 'No matching items found',
            noItemsAssignedMessage: 'No items assigned',
            lineBreakLabel: '─── Line Break ───',
            moveToTopTooltip: 'Move to top',
            moveToBottomTooltip: 'Move to bottom',
            removeCategoryTooltip: (p) => `Click to remove ${p.count} items from ${p.categoryName}`,
            addCategoryTooltip: (p) => `Add ${p.count} items from ${p.categoryName}`,
            noSavedLoadoutsMessage: 'No saved loadouts available.',
            loadoutButtonLabel: (p) => `${p.name} (${p.skillLabel})${p.unavailable ? ' — Unavailable' : ''}`,
            loadoutUnavailableTooltip: (p) => `Cannot add "${p.name}" while saved equipment is unavailable`,
            loadoutAllAddedTooltip: (p) => `All items from "${p.name}" already added`,
            loadoutAddItemsTooltip: (p) => `Add ${p.count} item(s) from "${p.name}"`,
            addToTabLabel: 'Add to Tab',
            addToTabTooltip: 'Add to this tab',
            removeFromTabTooltip: 'Remove from this tab',
            newTabDropdownOption: '+ New Tab',
            newTabDefaultName: 'New Tab',
            untitledTabNameFallback: 'Untitled',
        },
        combatStatsUi: {
            statisticsButtonLabel: 'Statistics',
            popupTitle: 'Combat Statistics',
            resetConsumableTrackingButton: 'Reset Consumable Tracking',
            resetConsumableTrackingConfirm:
                'Reset consumable tracking? This will clear all tracked consumption data and start fresh.',
            marketDataUnavailableAlert: 'Market data not available. Please try again.',
            noCombatDataAlert: 'No combat data available. Start a combat run first.',
            connectionInterruptedBanner:
                '⚠️ Connection was interrupted during this session — some events may have been missed, so these numbers may be incomplete.',
            defaultChatMessageTemplate: 'Combat Stats: {income} income | {dailyProfit} profit/d | {exp} exp/h',
            runwayNoUsage: 'No usage observed',
            runwayOutNow: 'Out now',
            runwayOverOneYear: '>1y',
            runwayMinutes: (p) => `~${p.minutes}m`,
            runwayHoursMinutes: (p) => `~${p.hours}h ${p.minutes}m`,
            runwayHours: (p) => `~${p.hours}h`,
            runwayDays: (p) => `~${p.days}d`,
            runwayDaysHours: (p) => `~${p.days}d ${p.hours}h`,
            durationFallback: '0s',
            durationLabel: 'Duration:',
            encountersPerHourLabel: 'Encounters/Hour:',
            incomeLabel: 'Income:',
            dailyIncomeLabel: 'Daily Income:',
            consumableCostsLabel: 'Consumable Costs:',
            dailyConsumableCostsLabel: 'Daily Consumable Costs:',
            lowestRunwayLabel: 'Lowest runway:',
            keyCostsLabel: 'Key Costs:',
            dailyKeyCostsLabel: 'Daily Key Costs:',
            dailyProfitLabel: 'Daily Profit:',
            actualRateLabel: 'Actual Rate:',
            expectedRateLabel: 'Expected Rate:',
            lootLuckLabel: 'Loot Luck:',
            actualProfitPerDayLabel: 'Actual Profit/day:',
            expectedProfitPerDayLabel: 'Expected Profit/day:',
            totalExpLabel: 'Total EXP:',
            expPerHourLabel: 'EXP/hour:',
            deathCountLabel: 'Death Count:',
            deathsPerHrLabel: 'Deaths/hr:',
            perDaySuffix: (p) => `${p.value}/d`,
            perHourSuffix: (p) => `${p.value}/h`,
            lootLuckSampleHeading: (p) => `Loot Luck sample · ${p.count} encounters · ${p.elapsed}`,
            recentSampleLabel: 'Recent sample',
            actualPerDayColumn: 'Actual/d',
            expectedPerDayColumn: 'Expected/d',
            valueDeltaColumn: 'Value Δ',
            noValuedItemsYetMessage: 'No valued items yet',
            partialCouldNotValueNote: (p) => `⚠ Partial - could not value ${p.count} item(s)`,
            pricingNoteLabel: (p) => `Pricing: ${p.label}`,
            chestColumnHeader: 'Chest',
            receivedColumnHeader: 'Received',
            evEachColumnHeader: 'EV Each',
            totalEvColumnHeader: 'Total EV',
            avgQtyColumnHeader: 'Avg Qty',
            evColumnHeader: 'EV',
            keyPricingLabelBid: 'Bid (patient buy)',
            keyPricingLabelCheapest: 'Cheapest (buy or craft)',
            keyPricingLabelAsk: 'Ask (instant buy)',
            consumedColumnHeader: 'Consumed',
            priceColumnHeader: 'Price',
            remainingLabel: (p) => `Remaining: ${p.runway}`,
            trackingSeconds: (p) => `${p.seconds}s`,
            trackingMinutes: (p) => `${p.minutes}m`,
            trackingHoursMinutes: (p) => `${p.hours}h ${p.minutes}m`,
            trackingHours: (p) => `${p.hours}h`,
            trackingMonthsDays: (p) => `${p.months}mo ${p.days}d`,
            trackingMonths: (p) => `${p.months}mo`,
            trackingDaysHours: (p) => `${p.days}d ${p.hours}h`,
            trackingDays: (p) => `${p.days}d`,
            noConsumptionYetNote: (p) => `📊 Tracked ${p.duration} - No consumption yet (rate decreases over time)`,
            blendNote: (p) => `📊 Tracked ${p.duration} - 90% actual + 10% baseline blend`,
            noConsumablesUsedMessage: 'No consumables used',
            dropsHeading: 'Drops',
            expectedValueHeading: 'EXPECTED VALUE',
            expectedReturnLabel: (p) => `Expected Return: ${p.value}`,
            allDropsLabel: 'All Drops',
            top5DropsLabel: 'Top 5 Drops',
            top10DropsLabel: 'Top 10 Drops',
            dropsHeaderWithTotal: (p) => `${p.headerLabel} (${p.total} total):`,
            dropLineNoPrice: (p) => `• ${p.itemName} (${p.dropRate}): ${p.avgCount} avg → No price data`,
            dropLineWithValue: (p) => `• ${p.itemName} (${p.dropRate}): ${p.avgCount} avg → ${p.value}`,
            totalFromDropsLabel: (p) => `Total from ${p.count} drops: ${p.value}`,
        },
        alchemyProfitDisplay: {
            profitPerHourPerDaySummary: '{{profit}}/hr, {{profitPerDay}}/day',
            revenueHeader: 'Revenue: {{revenue}}/hr',
            normalDropLine:
                '• {{itemName}}: {{drops}}/hr ({{dropRate}} × {{successRate}} success) @ {{price}} → {{revenue}}/hr',
            normalDropsSectionTitle: (p) => `Normal Drops: ${p.revenue}/hr (${p.count} item${p.count !== 1 ? 's' : ''})`,
            dropLineNoSuccessImpact:
                '• {{itemName}}: {{drops}}/hr ({{dropRate}}, not affected by success rate) @ {{price}} → {{revenue}}/hr',
            essenceDropsSectionTitle: (p) => `Essence Drops: ${p.revenue}/hr (${p.count} item${p.count !== 1 ? 's' : ''})`,
            rareDropLineWithBonus:
                '• {{itemName}}: {{drops}}/hr ({{baseRate}} base × {{bonus}} rare find = {{effectiveRate}}, not affected by success rate) @ {{price}} → {{revenue}}/hr',
            rareDropsSectionTitle: (p) => `Rare Drops: ${p.revenue}/hr (${p.count} item${p.count !== 1 ? 's' : ''})`,
            costsHeader: 'Costs: {{costs}}/hr',
            materialCostLineWithRecovery:
                '• {{itemName}}{{enh}}: {{amount}}/hr @ {{price}} → {{cost}}/hr (recovers {{recovered}}/hr, net {{net}}/hr)',
            materialCostLine: '• {{itemName}}{{enh}}: {{amount}}/hr (consumed on all attempts) @ {{price}} → {{cost}}/hr',
            materialCostsSectionTitle: (p) =>
                `Material Costs: ${p.cost}/hr (${p.count} material${p.count !== 1 ? 's' : ''})`,
            catalystCostLine:
                '• {{itemName}}: {{amount}}/hr (consumed only on success, {{successRate}}) @ {{price}} → {{cost}}/hr',
            catalystCostSectionTitle: 'Catalyst Cost: {{cost}}/hr',
            drinkCostLine: '• {{itemName}}: {{amount}}/hr @ {{price}} → {{cost}}/hr',
            drinkCostsSectionTitle: (p) => `Drink Costs: ${p.cost}/hr (${p.count} drink${p.count !== 1 ? 's' : ''})`,
            modifiersHeader: 'Modifiers:',
            baseSuccessRateLine: '• Base Success Rate: {{value}}',
            teaBonusMultiplicativeLine: '• Tea Bonus: +{{value}} (multiplicative)',
            successRateSectionTitle: 'Success Rate: {{value}}',
            successRateLine: '• Success Rate: {{value}}',
            levelBonusLine: '• Level Bonus: +{{value}}',
            houseBonusLine: '• House Bonus: +{{value}}',
            teaBonusLine: '• Tea Bonus: +{{value}}',
            equipmentBonusLine: '• Equipment Bonus: +{{value}}',
            communityBuffLine: '• Community Buff: +{{value}}',
            achievementBonusLine: '• Achievement Bonus: +{{value}}',
            efficiencySectionTitle: 'Efficiency: +{{value}}',
            actionSpeedSectionTitle: 'Action Speed: +{{value}}',
            rareFindSectionTitle: 'Rare Find: +{{value}}',
            essenceFindSectionTitle: 'Essence Find: +{{value}}',
            actionsSuccessRateLine: 'Actions: {{actions}}/hr | Success Rate: {{rate}}',
            netProfitLine: 'Net Profit: {{profit}}/hr, {{profitPerDay}}/day',
            pricingModeLine: 'Pricing Mode: {{mode}}',
            detailedBreakdownTitle: 'Detailed Breakdown',
            profitabilityTitle: 'Profitability',
            baseTimeLine: 'Base: {{base}}s → {{time}}s',
            actionsPerHourLine: '{{value}}/hr',
            speedBonusLine: 'Speed: +{{value}}',
            speedDetailLine: '  - {{name}}{{enh}}: +{{value}}',
            speedEquipmentFallbackLine: '  - Equipment: +{{value}}',
            speedTeaFallbackLine: '  - Tea: +{{value}}',
            efficiencyOutputLine: 'Efficiency: +{{efficiency}}% → Output: ×{{multiplier}} ({{actionsPerHour}}/hr)',
            effLevelDetailLine: '  - Level: +{{value}}%',
            effHouseDetailLine: '  - House: +{{value}}%',
            effEquipmentDetailLine: '  - Equipment: +{{value}}%',
            effTeaDetailLine: '  - Tea: +{{value}}%',
            effAchievementDetailLine: '  - Achievement: +{{value}}%',
            effCommunityDetailLine: '  - Community: +{{value}}%',
            totalTimeLine: 'Total time: {{time}}',
            speedTimeSummary: '{{actionsPerHour}}/hr | Total time: {{time}}',
            actionSpeedTimeTitle: 'Action Speed & Time',
            levelProgressTitle: 'Level Progress',
            currentLevelProgress: 'Current: Level {{level}} | {{percent}}% to Level {{nextLevel}}',
            xpPerActionLine: 'XP per action: {{base}} base → {{modified}} (×{{multiplier}})',
            expectedXpLine: '  Expected XP: {{xp}} ({{rate}} success, 10% XP on fail)',
            totalXpBonusLine: '  Total XP Bonus: +{{value}}%',
            xpItemBonusLine: '    • {{name}}{{enh}}: +{{value}}%',
            xpHouseRoomsLine: '    • House Rooms: +{{value}}%',
            xpCommunityBuffLine: '    • Community Buff: +{{value}}%',
            xpWisdomTeaLine: '    • Wisdom Tea: +{{value}}%',
            xpAchievementLine: '    • Achievement: +{{value}}%',
            xpMooPassLine: '    • MooPass: +{{value}}%',
            toLevelHeader: 'To Level {{level}}:',
            actionsCountLine: '  Actions: {{count}}',
            timeNeededLine: '  Time: {{time}}',
            targetLevelCalculatorHeader: 'Target Level Calculator:',
            toLevelPrefix: 'To level',
            actionsTimeResult: '{{actions}} actions | {{time}}',
            xpPerHourPerDayLine: 'XP/hour: {{perHour}} | XP/day: {{perDay}}',
            invalidLevelMessage: 'Invalid level',
            timeToLevelSummary: '{{time}} to Level {{level}}',
        },
        budgetCalculator: {
            modalTitle: 'Budget Calculator',
            budgetSummaryLine: (p) =>
                `Budget: <strong style="color:#fff;">${p.budget}</strong>&nbsp;→&nbsp;<strong style="color:#7ec87e;">${p.units} units</strong>`,
            noData: 'No data',
            colIngredient: 'Ingredient',
            colRequired: 'Required',
            colOnHand: 'On Hand',
            colToBuy: 'To Buy',
            colAskPrice: 'Ask Price',
            colTotalCost: 'Total Cost',
            perUnitCostLabel: 'Per unit cost (ask)',
            totalSpendLabel: 'Total spend',
            budgetInputPlaceholder: 'Budget (e.g. 50m)',
            calculateButton: 'Calculate',
            viewLastBreakdownTooltip: 'View last breakdown',
        },
        xpTracker: {
            tillNextLevel: (p) => `${p.time} till next level`,
            timeWeeks: (p) => `${p.n} week${p.n === 1 ? '' : 's'}`,
            timeDays: (p) => `${p.n} day${p.n === 1 ? '' : 's'}`,
            timeHours: (p) => `${p.n} hour${p.n === 1 ? '' : 's'}`,
            timeMinutes: (p) => `${p.n} minute${p.n === 1 ? '' : 's'}`,
            lessThanOneMinute: '< 1 minute',
            timePartSeparator: ' ',
        },
        // Units used by utils/formatters.js timeReadable()
        timeUnits: {
            years: (p) => `${p.n} year${p.n === 1 ? '' : 's'}`,
            months: (p) => `${p.n} month${p.n === 1 ? '' : 's'}`,
            days: (p) => `${p.n} day${p.n === 1 ? '' : 's'}`,
            hoursShort: (p) => `${p.n}h`,
            minutesShort: (p) => `${p.n}m`,
            secondsShort: (p) => `${p.n}s`,
            hms: (p) => `${p.h}h ${p.m}m ${p.s}s`,
            separator: ' ',
        },
        xphCalculator: {
            openButtonLabel: 'XPH Calc',
            panelTitle: 'Enhancement XPH Calculator',
            maxLevelLabel: 'Max level',
            protectFromLabel: 'Protect from',
            colItem: '# Item',
            colGoldPerXp: 'Gold/XP',
            statusDefault: 'Enter parameters and click Calculate.',
            statusResults: (p) =>
                `${p.count} item${p.count !== 1 ? 's' : ''} · ${p.withCost} with cost data.${p.hasPartial ? ' * = partial price data.' : ''}`,
        },
        lootLogStats: {
            durationSubSecond: (p) => `${p.seconds}s`,
            durationHoursUnit: (p) => `${p.value}h`,
            durationMinutesUnit: (p) => `${p.value}m`,
            durationSecondsUnit: (p) => `${p.value}s`,
            totalValueEmpty: 'Total Value: —',
            totalValueHeader: (p) => `▶ Total Value: ${p.ask}/${p.bid}`,
            totalXpLine: (p) => `Total XP: ${p.xp}`,
            coinsLabel: 'Coins',
            dailyOutputEmpty: 'Daily Output: —',
            dailyOutputValue: (p) => `Daily Output: ${p.ask}/${p.bid}`,
            historicalEntriesSeparator: (p) => `— Historical Entries (${p.count}) —`,
            showMoreButton: (p) => `Show more (${p.remaining} remaining)`,
            countSuffixParen: (p) => ` (${p.count})`,
            categoryDashName: (p) => (p.category ? `${p.category} - ${p.name}` : p.name) + p.suffix,
            startTimeLine: (p) => `Start Time: ${p.time}`,
            durationLine: (p) => `Duration: ${p.duration}`,
            unknownActionFallback: 'Unknown',
            analyticsButtonTooltip: 'Loot & XP Log Analytics (pivot table)',
            tierSuffixParen: (p) => ` (Tier ${p.tier})`,
            analyticsPanelTitle: '📊 Loot & XP Log Analytics',
            subtitleWithHistory: (p) =>
                `${p.actionCount} action${p.actionCount === 1 ? '' : 's'} across ${p.sessions} stored sessions`,
            subtitleSessionOnly: (p) =>
                `${p.actionCount} action${p.actionCount === 1 ? '' : 's'} from the current session only — enable Loot Log History for full historical coverage`,
            filterByActionPlaceholder: 'Filter by action name…',
            colAction: 'Action',
            colActions: 'Actions',
            colTotalTime: 'Total Time',
            colXp: 'XP',
            colValueAskBid: 'Value (ask/bid)',
            colGoldPerHour: 'Gold/hr',
            noActionsMatch: 'No actions match.',
            sessionsCountLabel: (p) => `${p.count} session${p.rawCount === 1 ? '' : 's'}`,
            perHourParen: (p) => ` (${p.value}/hr)`,
            totalColon: 'Total:',
            footerTotalActions: (p) => `Total: ${p.actions} actions over ${p.duration}`,
            footerTotalValue: (p) => `Total Value (ask/bid): ${p.ask}/${p.bid}`,
        },
        teaRecommendation: {
            xpButtonLabel: 'XP',
            goldButtonLabel: 'Gold',
            bothButtonLabel: 'Both',
            errorSkillNotDetected: 'Could not detect current skill',
            errorNoAlchemyItemSelected: 'No item selected in alchemy panel',
            dragToMoveTooltip: 'Drag to move',
            headerTitle: (p) =>
                `Optimal ${p.goalLabel}/hr for ${p.target}${p.dcPercent > 0 ? ` (${p.dcPercent}% DC)` : ''}`,
            alchemyTargetLabel: (p) => `${p.actionType}: ${p.itemName}`,
            noValidCombinationsMessage: 'No valid combinations with current constraints.',
            avgRateLine: (p) => `Avg ${p.goalLabel}/hr: ${p.value}`,
            levelBullet: (p) => `Level ${p.level} •`,
            backToAllActionsLabel: (p) => `← All ${p.skillName} actions`,
            goldActionsSummary: (p) =>
                `${p.profitableCount} profitable of ${p.totalCount}${p.excludedCount > 0 ? ` (+${p.excludedCount} excluded)` : ''}`,
            xpActionsSummary: (p) =>
                p.excludedCount > 0
                    ? `${p.totalCount} actions (+${p.excludedCount} excluded)`
                    : `${p.totalCount} actions evaluated`,
            clickToExpandTooltip: 'Click to expand',
            excludedActionsHeader: (p) => `Excluded (${p.count} - level too low)`,
            levelRequirementLabel: (p) => `Lvl ${p.level}`,
            expandedAlchemyLabel: (p) => `▼ ${p.target}`,
            expandedGoldLabel: (p) =>
                `▼ ${p.profitableCount} profitable${p.excludedCount > 0 ? ` (+${p.excludedCount})` : ''}`,
            expandedXpLabel: (p) =>
                p.excludedCount > 0 ? `▼ ${p.totalCount} (+${p.excludedCount})` : `▼ ${p.totalCount} actions`,
            teaCostLine: (p) => `Tea cost: ${p.cost}/hr ${p.arrow}`,
            costColTea: 'Tea',
            costColUnitsPerHour: 'Units/hr',
            costColUnitCost: 'Unit cost',
            costColCostPerHour: 'Cost/hr',
            alternativesHeader: 'Alternatives:',
            alternativeCostSuffix: (p) => ` · ${p.cost} cost/hr`,
            alternativeComboLine: (p) => `${p.teas} (${p.rate}/hr${p.costSuffix})`,
            teaConstraintsHeader: 'Tea Constraints:',
            removePinTooltip: 'Remove pin',
            pinTooltip: 'Pin (force include)',
            removeBanTooltip: 'Remove ban',
            banTooltip: 'Ban (force exclude)',
            optimalTeasForHeader: (p) => `Optimal Teas for ${p.target}`,
            ratePerHourLabel: (p) => `${p.goalLabel}/hr: ${p.value}`,
        },
        labyrinthClearRate: {
            errorLoadoutUnavailable: 'Configured loadout is unavailable',
            errorLoadoutChangedDuringSim: 'Configured loadout changed during simulation',
            loadoutFallbackName: (p) => `Loadout #${p.id}`,
            recommendButtonLabel: 'Recommend',
            recommendingProgress: 'Recommending... ({{current}}/{{total}})',
            recommendedBadgeText: 'Rec: {{value}}',
            recommendedBadgeTooltip: 'Recommended skip threshold for ≥{{percent}}% clear rate',
            applySkipSaving: 'Apply Skip (saving...)',
            applySkipButton: 'Apply Skip ({{count}})',
            targetWinPercentLabel: 'Target Win %',
            simHoursLabel: 'Sim Hours',
            liveClearEnhancing: ' [Clear {{pct}}% | +{{current}}/+{{target}} | {{left}} left]',
            liveClearSkilling: ' [Clear {{pct}}% | {{left}} left]',
            successDoubleLine: 'Success: {{success}}% | Double: {{double}}%',
            liveActionsLine: 'Actions: {{current}}/{{total}}',
            liveEnhanceLine: 'Enhance: +{{current}}/+{{target}}',
            liveProgressLine: 'Progress: {{current}}/{{target}}',
            simulatingCombatTooltip: 'Simulating combat...',
            loadoutUnavailableBadgeText: 'Loadout unavailable',
            badgePercentTime: '{{pct}}% {{time}}',
            tooltipActionsLine: 'Actions: {{attempts}} @ {{seconds}}s each',
            tooltipWorkPowerProgress: 'Work Power: {{workPower}} → Progress: {{progress}}/{{target}} per success',
            tooltipEffectiveLevel: 'Effective Level: {{level}} (base {{baseLevel}} + {{bonus}})',
            tooltipRoomLevelXp: 'Room Level: {{roomLevel}} | XP/room: {{xp}}',
            tooltipEnhancingTarget: 'Target: +{{targetLevel}} | Effective Level: {{level}}',
            tooltipRoomLevel: 'Room Level: {{roomLevel}}',
            tooltipCombatWinRate: 'Win Rate: {{winRate}}% | Avg Fight: {{avgFight}}s',
            tooltipCombatMonsterRoom: 'Monster: {{monster}} | Room Level: {{roomLevel}}',
            tooltipCombatLoadout: 'Loadout: "{{loadout}}"',
            tooltipFallback: 'Clear: {{pct}}% | Expected: {{time}} | Room level: {{roomLevel}}',
            timeApproxSeconds: '~{{seconds}}s',
        },
        combatScore: {
            hiddenEquipmentTooltip: 'Equipment is hidden in this profile, so it is not included in the Score.',
            scoreTooltip:
                'Estimated cost for you to reproduce this persistent build now, using current acquisition prices and your current Enhancing setup. Market values use current best Ask/unit estimates and are not order-book-depth adjusted.',
            combatScoreCalculatingLabel: 'Combat Score: Calculating…',
            skillerScoreCalculatingLabel: 'Skiller Score: Calculating…',
            combatScoreLine: (p) => `Combat Score: ${p.value}`,
            houseLine: (p) => `House: ${p.value}`,
            abilityLine: (p) => `Ability: ${p.value}`,
            equipmentLine: (p) => `Equipment: ${p.value}`,
            shrinesLine: (p) => `Shrines: ${p.value}`,
            skillerScoreLine: (p) => `Skiller Score: ${p.value}`,
            playerFallbackName: 'Player',
            viewCardButton: 'View Card',
            closeTooltip: 'Close',
            metzSimExportButton: 'Metz Sim Export',
            simCharacterButton: 'Sim Character',
            milkonomyExportButton: 'Milkonomy Export',
            exportFullPartyButton: 'Export Full Party',
            partyExportPreviewTitle: 'Export Full Party',
            partyExportCopyButton: 'Copy Party Export',
            partyExportYouLabel: 'You',
            partyExportAgeAgoLabel: (p) => `${p.age} ago`,
            partyExportMissingLabel: 'Missing (open profile)',
            partyExportUnknownMemberLabel: 'Unknown',
            noDataStatus: '✗ No Data',
            copiedStatus: '✓ Copied',
            failedStatus: '✗ Failed',
            abilitiesTriggersPanelTitle: (p) => `${p.playerName} - Abilities & Triggers`,
            expandCollapseTooltip: 'Expand / Collapse',
            showDetailsLabel: 'Show Details',
            hideDetailsLabel: 'Hide Details',
            collapseLabel: 'Collapse',
            expandLabel: 'Expand',
            dependencySelf: 'Self',
            dependencyTarget: 'Target',
            dependencyAllEnemies: 'All Enemies',
            dependencyAllAllies: 'All Allies',
            conditionHp: 'HP',
            conditionMissingHp: 'Missing HP',
            conditionMp: 'MP',
            conditionMissingMp: 'Missing MP',
            conditionActiveUnits: 'Active Units',
            comparatorIsActive: 'is active',
            comparatorIsInactive: 'is inactive',
            triggerConditionActive: (p) => `${p.dependency}: ${p.condition} ${p.comparator}`,
            triggerConditionValue: (p) => `${p.dependency}: ${p.condition} ${p.comparator} ${p.value}`,
            noTriggerLabel: 'No trigger',
            triggerAndSeparator: ' AND ',
            abilityAriaLabel: 'Ability',
            foodAndDrinksHeader: 'Food & Drinks',
            itemAriaLabel: 'Item',
        },
        alchemyHistoryViewer: {
            unifiedModalTitle: 'Alchemy History',
            historyTabTitle: (p) => `${p.actionName} History`,
            colSessionStart: 'Session Start',
            colInputItem: 'Input Item',
            colAttempts: 'Attempts',
            colSuccesses: 'Successes',
            colResults: 'Results',
            colEnhLevel: 'Enh. Level',
            colSuccessRate: 'Success Rate',
            colCoinsEarned: 'Coins Earned',
            colFailures: 'Failures',
            noTransmuteHistoryYet: 'No transmute history recorded yet.',
            noDecomposeHistoryYet: 'No decompose history recorded yet.',
            noCoinifyHistoryYet: 'No coinify history recorded yet.',
            noSessionsMatchFilters: 'No sessions match the current filters.',
            successesFailedLabel: (p) => `${p.successes} (${p.failures} failed)`,
            deleteSessionTitle: 'Delete this session',
            selfReturnResultLine: (p) => `${p.name} x${p.count} (self-return)`,
            resultLine: (p) => `${p.name} x${p.count} = ${p.total} (${p.each} each)`,
            sessionCountStat: (p) => `${p.count} session${p.count !== 1 ? 's' : ''}`,
            inputItemsCountLabel: (p) => `${p.count} input items`,
            inputFilterBadge: (p) => `Input: ${p.label}`,
            resultsFilterBadge: (p) => `Results: "${p.text}"`,
            showingAllSessions: (p) => `Showing all ${p.count} sessions`,
            filterByInputItemTitle: 'Filter by Input Item',
            filterByResultItemTitle: 'Filter by Result Item',
            itemNamePlaceholder: 'Item name...',
            clearHistoryConfirmWithWarning: (p) =>
                `⚠️ This will permanently delete ALL ${p.actionName} history (${p.count} sessions).\nThis cannot be undone.\n\nAre you sure?`,
            clearHistoryConfirmPlain: (p) =>
                `This will permanently delete ALL ${p.actionName} history (${p.count} sessions).\nThis cannot be undone.\n\nAre you sure?`,
            historyClearedAlert: (p) => `${p.actionName} history cleared.`,
            csvColEnhancementLevelFull: 'Enhancement Level',
            csvColItemUsedHeader: (p) => `${p.name} Used`,
        },
        pinnedActionsPage: {
            columnAction: 'Action',
            columnSkill: 'Skill',
            columnLevel: 'Lv',
            columnProfitPerHour: 'Profit/hr',
            columnExpPerHour: 'XP/hr',
            unknownSkill: 'Unknown',
            navButtonLabel: 'Pinned',
            pageTitle: 'Pinned Actions',
            tabOverview: 'Overview',
            tabMaterials: 'Materials',
            emptyStateTitle: 'No pinned actions',
            emptyStateHint: 'Pin actions using the 📌 icon on action tiles to see them here.',
            noFilterMatches: 'No actions match the current filter.',
            noProductionActionsPinned: 'No production actions pinned',
            canProduceLabel: (p) => `Can produce: ${p.count}`,
            filterBySkillTitle: 'Filter by Skill',
            applyButton: 'Apply',
            clearButton: 'Clear',
        },
        networthHistoryChart: {
            categoryGold: 'Gold',
            categoryInventory: 'Inventory',
            categoryEquipment: 'Equipment',
            categoryListings: 'Listings',
            categoryHouse: 'House',
            categoryAbilities: 'Abilities',
            range24hLabel: '24H',
            range7dLabel: '7D',
            range30dLabel: '30D',
            rangeAllLabel: 'All',
            rangeCustomLabel: 'Range',
            modalTitle: 'Net Worth History',
            connectGapsButton: 'Connect Gaps',
            showBarsButton: 'Show Bars',
            avgLabel: 'Avg:',
            movingAvgOffOption: 'Off',
            movingAvgCustomOption: 'Custom...',
            promptMovingAvgWindow: 'Enter moving average window in hours:',
            fromLabel: 'From:',
            toLabel: 'To:',
            totalChipLabel: 'Total',
            nonExcludedLabel: 'Non-Excluded',
            totalNetWorthDatasetLabel: 'Total Net Worth',
            barsDatasetLabel: 'Net Worth (bars)',
            movingAvgDatasetLabel: '{{window}} Moving Avg',
            categoryValueAxisTitle: 'Category Value',
            netWorthAxisTitle: 'Net Worth',
            noDataForRangeMessage: '<span style="color: #666;">No data available for this range</span>',
            currentTotalLine: 'Current: <strong style="color: {{color}};">{{value}}</strong>',
            clickForBreakdownTooltip: 'Click for item breakdown',
            lastRangeChangeLine:
                'Last {{range}}: <strong style="color: {{color}};">{{sign}}{{value}} ({{sign}}{{percent}}%)</strong>{{arrow}}',
            rateLine: 'Rate: <strong style="color: {{color}};">{{sign}}{{value}}/hr</strong>',
            nonExclCurrentLine:
                '<span style="color: #a78bfa;">Non-Excl</span>: <strong style="color: #a78bfa;">{{value}}</strong>',
            nonExclChangeSuffix:
                ' <span style="font-size: 11px; color: #aaa;">({{sign}}<span style="color: {{color}};">{{value}}</span> {{range}})</span>',
            rateSuffixSpan:
                ' <span style="font-size: 11px; color: #aaa;">{{sign}}<span style="color: {{color}};">{{value}}/hr</span></span>',
            categoryLastRangeLine:
                '{{label}}: <strong style="color: {{color}};">Last {{range}}: {{sign}}{{value}}</strong>',
            noLiveDataMessage: '<span style="color: #666;">No live data available</span>',
            noDetailSnapshotMessage:
                '<span style="color: #666;">No detail snapshot available yet (data collected hourly)</span>',
            sellListingItemLabel: 'Sell Listing: {{name}}',
            buyListingItemLabel: 'Buy Listing: {{name}}',
            noItemChangesMessage: '<span style="color: #666;">No item-level changes in the last 24h</span>',
            activityHeading: 'Activity',
            marketMovementHeading: 'Market Movement',
            roundingLabel: 'Rounding',
            otherHeading: 'Other',
            comparedToSnapshotLine:
                '<div style="color: #555; font-size: 10px; margin-top: 6px; text-align: right;">Compared to snapshot from {{hours}}h ago</div>',
            totalTooltipLine: '<div style="color:#4ade80;">&#9632; Total: {{value}}{{delta}}</div>',
            excludedLabel: 'Excluded',
            categoryTooltipLine: '<div style="color:#ccc; padding-left:12px;">{{label}}: {{value}}{{delta}}</div>',
            deletePointButton: 'Delete point',
            movingAvg12hOption: '12h',
            movingAvg24hOption: '24h',
            movingAvg3hOption: '3h',
            movingAvg48hOption: '48h',
            movingAvg6hOption: '6h',
            movingAvg7dOption: '7d',
            movingAvgCustomHoursOption: (p) => `${p.hours}h`,
        },
        simEditor: {
            loadoutUnavailableBlocked: (p) =>
                `Configured loadout "${p.name}" is unavailable. Simulation is blocked until you choose another loadout or Current Gear.`,
            loadoutUnavailablePreviousKept: (p) => `Loadout "${p.name}" is unavailable. Previous simulation kept.`,
            failedToLoadCharacterData: 'Failed to load character data.',
            noPlayersLoaded: 'No players loaded.',
            importPlayerButton: '+ Import Player',
            pasteExportPlaceholder: 'Paste Combat Sim Export JSON here...',
            pasteExportDataFirst: 'Paste export data first.',
            invalidFormatCombatSimExport: 'Invalid format. Paste a Combat Sim Export JSON.',
            invalidFormatShykaiExport: 'Invalid format. Paste a Shykai export JSON.',
            removePlayerTooltip: 'Remove player',
            importFromShykaiTooltip: 'Import players from Shykai export string',
            importPlusButton: '+ Import',
            pasteShykaiExportPlaceholder: 'Paste Shykai export JSON here...',
            loadoutLabel: 'Loadout',
            currentGearOption: '— Current Gear —',
            loadoutOptionLabel: (p) =>
                `${p.name}${p.allSkills ? ' (All Skills)' : ''}${p.unavailable ? ' (Unavailable)' : ''}`,
            resetToCurrentButton: 'Reset to Current',
            slotHead: 'Head',
            slotBody: 'Body',
            slotLegs: 'Legs',
            slotFeet: 'Feet',
            slotHands: 'Hands',
            slotMainHand: 'Main Hand',
            slotTwoHand: 'Two Hand',
            slotOffHand: 'Off Hand',
            slotPouch: 'Pouch',
            slotBack: 'Back',
            slotNeck: 'Neck',
            slotEarrings: 'Earrings',
            slotRing: 'Ring',
            slotCharm: 'Charm',
            equipmentSectionHeader: (p) => `Equipment (${p.count} items)`,
            addButton: 'add',
            changeButton: 'change',
            abilitiesSectionHeader: (p) => `Abilities (${p.count} equipped)`,
            abilitySpecialSlotLabel: 'Special',
            abilitySlotLabel: (p) => `Slot ${p.index}`,
            levelAbbreviation: 'Lv',
            consumablesSectionHeader: (p) => `Consumables (${p.food} food, ${p.drinks} drinks)`,
            drinksHeader: 'Drinks',
            drinkLabelSingular: 'Drink',
            categoryHpOverTime: 'HP Over Time',
            categoryHpInstant: 'HP Instant',
            categoryMpOverTime: 'MP Over Time',
            categoryMpInstant: 'MP Instant',
            categoryOther: 'Other',
            categoryAttack: 'Attack',
            categoryDefense: 'Defense',
            categoryRanged: 'Ranged',
            categoryMagic: 'Magic',
            categoryGeneral: 'General',
            categoryMelee: 'Melee',
            selectFoodHeader: 'Select Food',
            selectDrinkHeader: 'Select Drink',
            searchPlaceholder: 'Search...',
            emptyClearSlotOption: 'Empty (clear slot)',
            emptyRemoveSlotOption: 'Empty (remove slot)',
            levelTag: (p) => `Lv ${p.level}`,
            inUseLabel: '(in use)',
            moreItemsSuffix: (p) => `...${p.count} more`,
            selectEquipmentSlotHeader: (p) => `Select ${p.slot}`,
            specialAbilityLabel: 'Special Ability',
            abilitySlotNumberLabel: (p) => `Ability Slot ${p.index}`,
            selectAbilityHeader: (p) => `Select ${p.slotLabel}`,
            skillStamina: 'Stamina',
            skillIntelligence: 'Intelligence',
            skillAttack: 'Attack',
            skillMelee: 'Melee',
            skillDefense: 'Defense',
            skillRanged: 'Ranged',
            skillMagic: 'Magic',
            skillLevelsSectionHeader: 'Skill Levels',
            houseRoomsSectionHeader: 'House Rooms',
            activeCountLabel: (p) => `${p.count} active`,
            shrinesSectionHeader: 'Shrines',
            achievementsSectionHeader: 'Achievements',
            achievementModeCurrent: 'Current',
            achievementModeNone: 'None',
            achievementModeCustom: 'Custom',
            noCombatRelevantAchievementTiers: 'No combat-relevant Achievement Tiers found in current game data.',
            achievementSimulationOnlyNote: 'Simulation only - does not change your account.',
            achievementTierSummary: (p) => `${p.completed} / ${p.total}${p.buffText ? ` · ${p.buffText}` : ''}`,
            tokenSuccessRateLabel: 'Success Rate',
            tokenDoubleProgressLabel: 'Double Progress',
            tokenUpgradesSectionHeader: 'Token Upgrades',
            communityProdEfficiencyLabel: 'Prod. Efficiency',
            communityEnhancingSpeedLabel: 'Enhancing Speed',
            communityGatheringQtyLabel: 'Gathering Qty',
            communityBuffsSectionHeader: 'Community Buffs',
            noneLabel: 'None',
            itemSwapLabel: (p) => `${p.from} → ${p.to}`,
            enhancementChangeLabel: (p) => `${p.slot} +${p.from}→+${p.to}`,
            abilityLevelChangeLabel: (p) => `${p.name} Lv ${p.from}→${p.to}`,
            skillLevelChangeLabel: (p) => `${p.label} ${p.from}→${p.to}`,
            consumableChangeLabel: (p) => `${p.prefix} ${p.index}: ${p.from}→${p.to}`,
            tokenDoubleProgressShort: 'DblProg',
            tokenChangeLabel: (p) => `Token ${p.label} ${p.from}→${p.to}`,
            communityProdEffShort: 'ProdEff',
            communityEnhSpdShort: 'EnhSpd',
            communityGathQtyShort: 'GathQty',
            communityExpShort: 'Exp',
            communityBuffChangeLabel: (p) => `CB ${p.label} ${p.from}→${p.to}`,
            loadoutChangesSummary: (p) => `${p.prefix}: ${p.changes}`,
        },
        taskProfitDisplay: {
            goldPerHourUnit: 'gold/hr',
            tokensPerHourUnit: 'tokens/hr',
            missingPriceDataError: 'Missing price data',
            unableToCalculateProfit: 'Unable to calculate profit',
            estimateModeTooltip: 'Solo: simulate only target monster. Zone: simulate full zone spawn table.',
            zoneModeLabel: 'Zone',
            soloModeLabel: 'Solo',
            estimateButtonLabel: 'Estimate',
            couldNotIdentifyMonster: 'Could not identify monster.',
            noZoneFoundForMonster: 'No zone found for monster.',
            simulatingLabel: 'Simulating…',
            combatLoadoutUnavailableMessage: (p) =>
                `Loadout "${p.loadoutName}" is unavailable. Choose another loadout or Current Gear.`,
            estimateFailedLabel: 'Estimate failed.',
            retryLabel: 'Retry',
            taskProfitBreakdownTitle: 'Task Profit Breakdown',
            monsterKillsSummary: (p) => `Monster: ${p.monsterName} × ${p.count} kills (${p.rate}/hr)`,
            loadoutSummary: (p) => `Loadout: ${p.loadoutName}`,
            taskRewardsLabel: 'Task Rewards:',
            coinsLine: (p) => `Coins: ${p.value}`,
            taskTokensLine: (p) => `Task Tokens: ${p.value}`,
            tokensReceivedNote: (p) => `(${p.count} tokens @ ${p.value} each)`,
            giftPerTaskNote: (p) => `(${p.value} per task)`,
            dropsLabel: (p) => `Drops: ${p.value}`,
            consumablesLabel: (p) => `Consumables: ${p.value}`,
            rerunButtonLabel: 'Re-run',
            zoneFallbackLabel: 'Zone',
            zoneSummaryLine: (p) => `${p.zoneName}: ~${p.fights} fights | ${p.time} (bottleneck: ${p.bottleneckName})`,
            tokenValuesUnavailableNote: (p) => `${p.error} - Token values unavailable`,
            loadingEllipsis: 'Loading...',
            actionProfitLabel: 'Action Profit:',
            gatheringValueLabel: (p) => `Gathering Value: ${p.value}`,
            primaryOutputsLabel: (p) => `Primary Outputs: ${p.value}`,
            dropRateSuffix: (p) => ` (${p.pct} drop)`,
            baseOutputItemLine: (p) => `${p.name} (Base): ${p.items} items @ ${p.price}${p.missingNote} = ${p.total}`,
            gourmetOutputItemLine: (p) =>
                `${p.name} (Gourmet ${p.pct}): ${p.items} items @ ${p.price}${p.missingNote} = ${p.total}`,
            gourmetOutputItemLinePlus: (p) =>
                `${p.name} (Gourmet +${p.pct}): ${p.items} items @ ${p.price}${p.missingNote} = ${p.total}`,
            processingNetLine: (p) => `Processing (${p.pct} proc): Net ${p.label}`,
            materialConsumedLine: (p) =>
                `${p.name} consumed: -${p.amount} items @ ${p.price}${p.missingNote} = -${p.total}`,
            materialProducedLine: (p) => `${p.name} produced: ${p.amount} items @ ${p.price}${p.missingNote} = ${p.total}`,
            essenceDropsLabel: (p) => `Essence Drops: ${p.value}`,
            rareFindsLabel: (p) => `Rare Finds: ${p.value}`,
            dropLine: (p) => `${p.name}: ${p.drops} drops @ ${p.price}${p.missingNote} = ${p.total}`,
            perActionNote: (p) => `(${p.qty}× @ ${p.value} each)`,
            netProductionLabel: (p) => `Net Production: ${p.value}`,
            materialCostsLabel: (p) => `Material Costs: ${p.value}`,
            teaDrinksLine: (p) => `${p.name}: ${p.drinks} drinks @ ${p.price}${p.missingNote} = ${p.total}`,
            totalProfitLabel: (p) => `Total Profit: ${p.value}`,
            baseSpeedLine: (p) => `Base: ${p.base}s → ${p.after}s`,
            speedBonusLine: (p) => `Speed: +${p.pct} | ${p.rate}/hr`,
            scrollOfActionSpeedLine: (p) => `Scroll of Action Speed: +${p.pct}`,
            taskSpeedMultiplicativeLine: (p) => `Task Speed (multiplicative): +${p.pct}%`,
            efficiencyOutputLine: (p) => `Efficiency: +${p.pct}% → Output: ×${p.mult} (${p.rate}/hr)`,
            levelEfficiencyLine: (p) => `Level: +${p.pct}%`,
            rawLevelDeltaLine: (p) =>
                `Raw level delta: +${p.pct}% (${p.skillLevel} - ${p.baseRequirement} base requirement)`,
            levelImpactLine: (p) => `${p.name} impact: ${p.pct}% (raises requirement)`,
            drinkConcentrationLine: (p) => `Drink Concentration: ${p.pct}%`,
            unknownRoomLabel: 'Unknown Room',
            roomLevelLabel: (p) => `${p.roomName} level ${p.level}`,
            houseEfficiencyLine: (p) => `House: +${p.pct}% (${p.roomLabel})`,
            equipmentEfficiencyLine: (p) => `Equipment: +${p.pct}%`,
            achievementEfficiencyLine: (p) => `Achievement: +${p.pct}%`,
            communityEfficiencyLine: (p) => `Community: +${p.pct}% (Production Efficiency T${p.tier})`,
            sealEfficiencyLine: (p) => `Seal: +${p.pct}%`,
            totalTimeLine: (p) => `Total time: ${p.time}`,
            loadingMarketDataLabel: 'Loading market data...',
            activeIndicatorLabel: 'Active',
            queuedIndicatorLabel: 'Queued',
        },
        profileExportButton: {
            exportButtonLabel: 'Export to Clipboard',
            noDataAlert:
                "No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again\n\nIf viewing another player's profile, make sure you opened it in-game first.",
            clipboardAccessDeniedAlert: 'Clipboard access denied. Please allow clipboard permissions for this site.',
            exportFailedAlert: (p) => `Export failed: ${p.error}`,
        },
        philoCalculator: {
            launcherButtonLabel: 'Philo Gamba',
            panelTitle: "Philosopher's Stone Calculator",
            philoPriceLabel: 'Philo Price: ',
            catalystPriceLabel: 'Catalyst Price: ',
            usePrimeCatalystLabel: 'Use Prime Catalyst',
            catalyticTeaBoostLabel: (p) => `Catalytic Tea (${p.percent})`,
            catalyticTeaUnavailableLabel: 'Catalytic Tea (unavailable)',
            drinkConcentrationLabel: 'Drink Concentration: ',
            hideNegativeProfitLabel: 'Hide Negative Profit',
            filterLabel: 'Filter: ',
            refreshPricesButton: 'Refresh Prices',
            refreshingPricesStatus: 'Refreshing...',
            colPhiloChance: 'Philo %',
            colReturnChance: 'Return %',
            colBaseTransmuteChance: 'Base Xmute %',
            colEffTransmuteChance: 'Eff. Xmute %',
            colTransmuteCost: 'Xmute Cost',
            colItemsPerAction: 'Items/Act',
            colActionsPerPhilo: 'Acts/Philo',
            colItemsPerPhilo: 'Items/Philo',
            colProfitPerPhilo: 'Profit/Philo',
            colProfitMargin: 'Margin',
            colTimePerPhilo: 'Time/Philo',
            colProfitPerHour: 'Profit/Hr',
            colRevenuePerHour: 'Revenue/Hr',
            colCostPerHour: 'Cost/Hr',
        },
        alchemyBestItems: {
            tabLabel: 'Best Items',
            modalTitle: (p) => `Best Items — ${p.type}`,
            sortByLabel: 'Sort by:',
            profitableOnlyLabel: 'Profitable only',
            profitFilterLabel: 'Profit/hr:',
            itemPriceFilterLabel: 'Item price:',
            minPlaceholder: 'Min',
            maxPlaceholder: 'Max',
            colLvl: 'Lvl',
            catalystPrimeLabel: 'Prime',
            noEligibleItemsMessage: 'No eligible items found',
            showingTopItemsMessage: (p) => `Showing top ${p.max} of ${p.total} items`,
            noBreakdownDataMessage: 'No breakdown data available',
            materialLine: '• {{itemName}}: {{count}}× @ {{price}} → {{cost}}/hr',
            catalystLine: '• {{itemName}} @ {{price}} → {{cost}}/hr',
            teaLine: '• {{itemName}} → {{cost}}/hr',
            statsActionsPerHour: '{{value}}/hr',
            statsSuccessRate: '{{value}} success',
            statsEfficiency: '{{value}} efficiency',
        },
        taskTokenThreshold: {
            configureButtonTitle: 'Configure Task Token reroll threshold',
            popupTitle: 'Task Token Threshold',
            description: 'Flag tasks whose Task Token reward crosses this cutoff for reroll.',
            belowOption: 'Below',
            aboveOption: 'Above',
            thresholdPlaceholder: 'e.g. 8',
            tokensLabel: 'tokens',
            disableButton: 'Disable',
            highTokensFlag: 'High tokens!',
            lowTokensFlag: 'Low tokens!',
        },
        houseCostDisplay: {
            totalMarketValueLine: (p) => `Total Market Value: ${p.value}`,
            cumulativeToLevelLabel: 'Cumulative to Level:',
            missingAmountLabel: (p) => `Missing: ${p.value}`,
            returnToHouseTabLabel: '↩ Return to House',
        },
        skillCalculatorUi: {
            skillToLevelLabel: (p) => `${p.skillName} to level `,
            daysAfterLabel: 'days after',
            resultsHeaderToLevel: (p) => `${p.skillName} to level ${p.level} takes:`,
            noExperienceGainMessage: 'No experience gain (not trained in simulation)',
            alreadyAchievedMessage: 'Already achieved',
            invalidTargetLevelMessage: 'Invalid target level',
            resultsHeaderAfterDays: (p) => `After ${p.days} days:`,
            skillLevelPercentLine: (p) => `${p.skillName} level ${p.level} ${p.percentage}%`,
            combatLevelLine: (p) => `Combat level: ${p.level}`,
            unableToCalculateProjectionMessage: 'Unable to calculate projection',
        },
        quickInputButtons: {
            toggleAddModeTooltip: 'Toggle add mode: click to accumulate counts instead of setting them',
            doPrefixLabel: 'Do ',
            timesSuffixLabel: ' times',
            guildShrineBonusLine: (p) => `  - Guild Shrine: +${p.pct}%`,
            taskSpeedTimeChangeLine: (p) => `${p.before}s${p.clampSuffix} → ${p.after}s | ${p.rate}/hr`,
            xpScrollOfWisdomLine: 'Scroll of Wisdom: +{{value}}%',
            xpGuildShrineLine: 'Guild Shrine: +{{value}}%',
            actionsToLevelResult: '{{actions}} actions → Level {{level}} ({{percent}}% to next) | {{time}}',
        },
        combatSimIntegration: {
            importButtonLabel: 'Import from Toolasha',
            errorNoCharacterDataLabel: 'Error: No character data',
            noCharacterDataAlert:
                'No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again',
            importedLabel: '✓ Imported',
            importFailedLabel: 'Import Failed',
        },
        marketSort: {
            sortByProfitButton: 'Sort by Profit',
            resetOrderButton: 'Reset Order',
            sortingInProgress: (p) => `Sorting... ${p.arrow}`,
            sortByProfitWithArrow: (p) => `Sort by Profit ${p.arrow}`,
        },
        marketOrderTotals: {
            noOrdersTitle: 'No market orders',
            buyOrdersTooltip: 'Buy Orders (coins locked in buy orders)',
            buyOrdersLabel: 'BO:',
            sellOrdersTooltip: 'Sell Orders (expected proceeds after tax)',
            sellOrdersLabel: 'SO:',
            unclaimedTooltip: 'Unclaimed coins (waiting to be collected)',
        },
        craftingPlanDisplay: {
            pricingModeInstantBuy: 'Instant Buy',
            pricingModeInstantBuyPatientSell: 'Instant Buy / Patient Sell',
            pricingModePatientBuyPatientSell: 'Patient Buy / Patient Sell',
            pricingModePatientBuy: 'Patient Buy',
            artisanModeWorstCase: 'Worst-case',
            artisanModeHybrid: 'Hybrid',
            pricingPillLabel: 'Pricing:',
            artisanModePillLabel: 'Artisan mode:',
            artisanModeTooltip:
                'How Artisan Tea savings are rounded into material quantities:\n' +
                'Expected — pools the savings across the whole batch (average, may run short on a bad action).\n' +
                'Worst-case — rounds up every single action before multiplying (safest, may over-buy).\n' +
                'Hybrid — worst-case under 100 actions, expected at 100+.',
            matchQuantityLabel: 'Match action panel quantity',
            buyRawMaterialsOnlyLabel: 'Buy raw materials only',
            noProcessingLabel: 'No processing (buy intermediates)',
            taskModeLabel: 'Task mode (force last step)',
            factorTimeCostLabel: 'Factor in time cost',
            strategyBuyFromMarket: 'Buy from market',
            strategyCraftFromMaterials: 'Craft from materials',
            optimalStrategyLine: (p) => `Optimal: <strong>${p.strategy}</strong>`,
            unitCostPerEach: (p) => `${p.cost}/ea`,
            marketBuyLine: (p) => `Market buy: ${p.value}`,
            craftCostLine: (p) => `Craft cost: ${p.value}`,
            quantityLine: (p) => `Quantity: ${p.quantity}`,
            totalLine: (p) => `Total: ${p.value}`,
            bestCraftingPlanTitle: 'Best Crafting Plan',
            buyMissingMaterialsButton: 'Buy Missing Materials',
        },
        abilityBookCalculator: {
            currentLevelLabel: 'Current level:',
            toLevelLabel: 'To level: ',
            booksNeededLine: (p) => `Books needed: <strong>${p.books}</strong>`,
            costAskBidLine: (p) => `Cost: ${p.askCost} / ${p.bidCost} (ask / bid)`,
            buyOnMarketplaceButton: 'Buy on Marketplace',
        },
        missingMaterialsButton: {
            enterQuantityTooltip: 'Enter a quantity to check missing materials',
            noProtectionNeeded: 'No protection needed',
            protectFromLabel: (p) => `From: +${p.level}`,
        },
        labyrinthMissingSupplies: {
            buttonLabel: 'Buy Missing Supplies',
        },
        enhancementUi: {
            panelTitle: 'Enhancement Tracker',
            clearAllSessionsTooltip: 'Clear all sessions',
            clearAllSessionsConfirm: 'Clear all enhancement sessions?',
            collapsePanelTooltip: 'Collapse panel',
            expandPanelTooltip: 'Expand panel',
            unknownItemFallback: 'Unknown Item',
            collapsedSummaryStats: (p) => `${p.statusIcon} ${p.totalAttempts} attempts | ${p.successRate}% rate`,
            noSessionsMessage: 'Begin enhancing to populate data',
            invalidSessionMessage: 'Invalid session',
            statusCompleted: 'Completed',
            statusInProgress: 'In Progress',
            itemLabel: 'Item:',
            targetLabel: 'Target:',
            protLabel: 'Prot:',
            statusLabel: 'Status:',
            summaryStatsLine: (p) =>
                `Attempts ${p.totalAttempts} · Successes ${p.totalSuccess} · Blessed ${p.totalBlessed} · Failures ${p.totalFailure}`,
            protsUsedLabel: 'Prots Used:',
            expectedAttemptsLabel: 'Expected Attempts:',
            expectedProtsLabel: 'Expected Prots:',
            attemptFactorLabel: 'Attempt Factor:',
            protFactorLabel: 'Prot Factor:',
            totalXpGainedLabel: 'Total XP Gained:',
            sessionDurationLabel: 'Session Duration:',
            xpPerHourLabel: 'XP/Hour:',
            calculatingEllipsis: 'Calculating…',
            enhancingLuckLabel: 'Enhancing Luck:',
            luckTooltip: (p) => `${p.actualSuccesses} actual vs ${p.expectedSuccesses} expected successes`,
            noAttemptsRecordedMessage: 'No attempts recorded yet',
            colFail: 'Fail',
            colPercent: '%',
            colLuck: 'Luck',
            materialsLabel: 'Materials:',
            coinsCountLabel: (p) => `Coins (${p.count}×):`,
            protectionFallbackName: 'Protection',
            totalCostClickDetailsLabel: '💰 Total Cost (click for details)',
            durationHoursMinutesSeconds: (p) => `${p.hours}h ${p.minutes}m ${p.seconds}s`,
        },
        listingPriceDisplay: {
            topOrderPriceHeader: 'Top Order Price',
            topOrderAgeHeader: 'Top Order Age',
            topOrderAgeHeaderTooltip: 'Estimated age of the top competing order',
            totalPriceHeader: 'Total Price',
            listedHeader: 'Listed',
            clickToSortByTooltip: (p) => `Click to sort by ${p.text}`,
            progressColumnLabel: 'Progress',
            collectColumnLabel: 'Collect',
        },
        taskRerollProtection: {
            configureTooltip: 'Configure task reroll protection',
            protectedTaskWarning: 'Protected task! Unlocks in 3s...',
            rerollAtCapWarning: 'Reroll at cap! Unlocks in 3s...',
            confirmRerollMessage: 'Click reroll now to confirm.',
            popupTitle: 'Protected Tasks',
            searchPlaceholder: 'Search actions, monsters, zones...',
            noProtectedTasksMessage: 'No protected tasks yet. Search to add.',
            zoneTypeLabel: (p) => `Zone (${p.count})`,
            moreResultsRefineSearch: (p) => `...${p.count} more (refine search)`,
            blockRerollsAtLabel: 'Block rerolls at',
            blockRerollsAtCapLabel: 'Block rerolls at cap',
            capDisplayDefault: '320K💰 / 32🔔',
        },
        taskInventoryHighlighter: {
            highlightButtonLabel: 'Highlight Task Items',
            clearHighlightButtonLabel: 'Clear Highlight',
        },
        combatBattleCounter: {
            attemptLabel: (p) => `· Attempt #${p.attempt}`,
            dungeonBattleLabel: (p) => `· Wave ${p.wave} · Battle #${p.battle}`,
            battleLabel: (p) => `· Battle #${p.battle}`,
        },
        notificationLog: {
            tabLabel: 'Log',
            tabTooltip: 'Log of item trades, level-ups, guild events, and other notifications',
            mentionedByLine: (p) => `Mentioned by ${p.sender} in ${p.channel}: ${p.text}`,
            clearAllTooltip: 'Delete all logged notifications',
            clearAllConfirm: (p) => `Delete all ${p.count} logged notifications? This cannot be undone.`,
            noEntriesMatchFilters: 'No notifications match the current filters.',
            deleteEntryTooltip: 'Delete this notification',
            categoryCommunity: 'Community',
            categoryCosmetic: 'Cosmetic',
            categoryGuild: 'Guild',
            categoryHouse: 'House',
            categoryLabyrinth: 'Labyrinth',
            categoryLoadout: 'Loadout',
            categoryMentions: 'Mentions',
            categoryOther: 'Other',
            categoryParty: 'Party',
            categoryProgression: 'Progression',
            categoryPurchases: 'Purchases',
            categoryReferral: 'Referral',
            categorySocial: 'Social',
            categoryTrading: 'Trading',
        },
        mentionPopup: {
            titleWithChannel: (p) => `Mentions — ${p.channel}`,
            noMentionsMessage: 'No mentions',
        },
        taskRerollTracker: {
            rerollSpentPlaceholder: 'Reroll spent: –',
            rerollSpentLabel: (p) => `Reroll spent: ${p.value}`,
        },
        offlineProgressEconomics: {
            sourceLabelCoin: 'Coin face value',
            sourceLabelCowbell: 'Cowbell valuation',
            sourceLabelDungeonToken: 'Dungeon Token shop value',
            sourceLabelExpectedValue: 'Expected Value',
            sourceLabelCustom: 'Custom price override',
            sourceLabelMarket: 'Market price',
            sourceLabelTaskToken: 'Task Token shop value',
            pricingModeTooltip: (p) => `Pricing mode: ${p.mode}`,
            partialValuationNote: (p) =>
                ` | Partial - ${p.count} item${p.count === 1 ? '' : 's'} could not be valued: ${p.names}`,
            headerTitle: 'Offline Economics',
            headerTitlePartial: 'Offline Economics *',
            rowLabelRevenue: 'Revenue',
            rowLabelCost: 'Cost',
            rowLabelProfit: 'Profit',
            sellSideLabel: 'Sell',
            buySideLabel: 'Buy',
            sideTooltip: (p) => `${p.modeLabel} (${p.sideLabel} side)`,
            unvaluedItemLine: (p) => `${p.count}x ${p.name}${p.enhSuffix} - no price data`,
        },
        marketFilter: {
            levelMinLabel: 'Level >= ',
            levelMaxLabel: 'Level < ',
            classLabel: 'Class: ',
            slotLabel: 'Slot: ',
            othersOption: 'Others',
        },
        queueMonitorUi: {
            headerTitle: 'Queue Monitor',
            noOtherCharacterDataMessage: 'No other character data yet.<br>Switch characters to capture queue state.',
            idleLabel: 'Idle',
            doneLabel: 'Done',
            staleLabel: (p) => `Stale (>${p.hours}h ago)`,
        },
        networthExclusionPopup: {
            allEquippedItemsLabel: 'All Equipped Items',
            allMarketListingsLabel: 'All Market Listings',
            allHousesLabel: 'All Houses',
            allAbilitiesLabel: 'All Abilities',
            allAbilityBooksLabel: 'All Ability Books',
            allGuildShrinesLabel: 'All Guild Shrines',
            categoryNameSuffix: (p) => `${p.name} (category)`,
            loadoutNameLabel: (p) => `Loadout: ${p.name}`,
            popupTitle: 'Net Worth Exclusions',
            currentExclusionsLabel: 'Current Exclusions',
            noExclusionsConfiguredLabel: 'No exclusions configured',
            searchPlaceholder: 'Search items, categories, houses, loadouts...',
            noResultsMessage: 'No results',
            removeButtonLabel: '✕ Remove',
            excludeButtonLabel: '+ Exclude',
            removeExclusionTooltip: 'Remove exclusion',
        },
        networthDisplay: {
            goldLabelLine: (p) => `Gold: ${p.value}`,
            networthLoadingMessage: 'Networth: Loading...',
            netWorthLabel: (p) => `Net Worth: ${p.value}`,
            netWorthHistoryChartTooltip: 'Net Worth History Chart',
            configureExclusionsTooltip: 'Configure Net Worth Exclusions',
            currentAssetsLabel: (p) => `Current Assets: ${p.value}`,
            equipmentValueLabel: (p) => `Equipment value: ${p.value}`,
            inventoryValueLabel: (p) => `Inventory value: ${p.value}`,
            marketListingsLabel: (p) => `Market listings: ${p.value}`,
            fixedAssetsLabel: (p) => `Fixed Assets: ${p.value}`,
            housesLabel: (p) => `Houses: ${p.value}`,
            abilitiesLabel: (p) => `Abilities: ${p.value}`,
            equippedAbilitiesLabel: (p) => `Equipped (${p.count}): ${p.value}`,
            otherAbilitiesCountLabel: (p) => `Other (${p.count}): ${p.value}`,
            otherAbilitiesLabel: (p) => `Other Abilities: ${p.value}`,
            abilityBooksCountLabel: (p) => `Ability Books (${p.count}): ${p.value}`,
            abilityBooksLabel: (p) => `Ability Books: ${p.value}`,
            guildShrinesLabel: (p) => `Guild Shrines: ${p.value}`,
            excludedLabel: (p) => `Excluded: ${p.value}`,
            coinLabel: (p) => `Coin: ${p.value}`,
            noHousesBuiltMessage: 'No houses built',
            noAbilitiesMessage: 'No abilities',
            noAbilityBooksMessage: 'No ability books',
            noGuildShrineBuffsMessage: 'No guild shrine buffs purchased',
            noEquipmentMessage: 'No equipment',
            noMarketListingsMessage: 'No market listings',
            noInventoryMessage: 'No inventory',
            evPerChestLabel: (p) => `EV: ${p.value}/chest`,
            keyLabelWithName: (p) => `Key (${p.name})`,
            keyCostLabel: 'Key Cost',
            netPerChestLabel: (p) => `Net: ${p.value}/chest`,
        },
        alchemyActionProtection: {
            protectedCategoryWarning: (p) => `Protected category (${p.categoryName})! Unlocks in 3s...`,
            clickAgainToConfirm: 'Click again to confirm.',
            pinActionTooltip: 'Pin this action',
            unpinActionTooltip: 'Unpin this action',
            goldSummaryLine: (p) => `Gold for ${p.label}: ${p.needed} / ${p.balance}`,
            allCountLabel: 'all',
            popupTitle: 'Alchemy Action Protection',
            popupDescription:
                'Select which item categories to protect from each alchemy action. Protected items require a 3-second confirmation before the action proceeds.',
            categoryItemCountLabel: (p) => `${p.name} (${p.count} items)`,
        },
        enhancementProtectionMarketplace: {
            buyCheapestButtonLabel: '🛒 Buy Cheapest: {{name}} ({{price}})',
        },

        enhancementDisplay: {
            autoDetectModeLabel: '🔍 Auto',
            manualModeLabel: '✏️ Manual',
            modeToggleTooltip: 'Toggle between Auto-Detect and Manual modes',
            calculatorTitle: '⚙️ ENHANCEMENT CALCULATOR',
            itemLevelSuffix: (p) => `(Item Level ${p.itemLevel})`,
            yourStatsHeader: 'Your Enhancing Stats:',
            teaBonusSuffix: (p) => `(+${p.value} tea)`,
            houseLabel: 'House:',
            observatoryLevelValue: (p) => `Observatory Lvl ${p.level}`,
            toolLabel: 'Tool:',
            bodyLabel: 'Body:',
            legsLabel: 'Legs:',
            handsLabel: 'Hands:',
            successLabel: 'Success:',
            equipmentLabel: 'Equipment:',
            houseObservatoryLabel: 'House (Observatory):',
            achievementLabel: 'Achievement:',
            levelAdvantageLabel: 'Level advantage:',
            communityLabel: 'Community:',
            teaLabel: 'Tea:',
            labyrinthLabel: 'Labyrinth:',
            baseLabel: 'Base:',
            blessedLabel: 'Blessed:',
            blessedTeaLabel: 'Blessed Tea:',
            blessedTeaChanceLine: (p) => `${p.percent}% chance to skip a level`,
            houseRoomsLabel: 'House Rooms:',
            houseRoomsWisdomLabel: 'House Rooms (Wisdom):',
            communityWisdomLabel: (p) => `Community (Wisdom T${p.level}):`,
            wisdomTeaLabel: 'Wisdom Tea:',
            materialsPerAttemptHeader: 'Materials Per Attempt:',
            ifUsedSuffix: '(if used)',
            protectionActiveNote: (p) =>
                `• Protection active from +${p.level} onwards (enhancement level -1 on failure)<br>`,
            noProtectionNote: '• No protection used (all failures return to +0)<br>',
            statisticalAveragesNote: '• Attempts and time are statistical averages<br>',
            actionTimeNote: (p) => `• Action time: ${p.time}s (includes ${p.percent}% speed bonus)`,
            costsByLevelHeader: 'Costs by Enhancement Level:',
            viewFullTableTooltip: 'View full table',
            mirrorStrategyHeader: "💎 Philosopher's Mirror Strategy:",
            mirrorStrategyStartLevel: (p) => `• Use mirrors starting at <strong>+${p.level}</strong>`,
            mirrorStrategyTotalSavings: (p) => `• Total savings to +20: <strong>${p.savings}</strong> coins`,
            mirrorStrategyHighlightNote: 'Rows highlighted in gold show where mirror is cheaper',
            colTime: 'Time',
            colMirrorCost: 'Mirror Cost',
            costsModalTitle: '📊 Costs by Enhancement Level',
            costsModalSubtitle: 'Full breakdown of enhancement costs for all levels',
        },
        taskStatistics: {
            popupTitle: 'Task Statistics',
            taskSlotsHeader: 'Task Slots',
            slotsUsedLabel: 'Slots Used',
            availableLabel: 'Available',
            cooldownPerTaskValue: (p) => `${p.hours}h per task`,
            tasksFullMessage: 'Tasks full!',
            fullInLabel: 'Full in',
            fullAtLabel: 'Full at',
            expectedRewardsHeader: 'Expected Rewards',
            totalCoinsLabel: 'Total Coins',
            totalTaskTokensLabel: 'Total Task Tokens',
            tokenValueEachSuffix: (p) => `${p.value} each`,
            tokenValueLabel: 'Token Value',
            tokensValueLabel: 'Tokens Value',
            purpleGiftLabel: "Purple's Gift",
            totalRewardValueLabel: 'Total Reward Value',
            actionProfitHeader: 'Action Profit',
            combatNotApplicableLabel: 'N/A (combat)',
            totalActionProfitLabel: 'Total Action Profit',
            combinedTotalLabel: 'Combined Total',
            completionTimeHeader: 'Completion Time',
            progressSuffix: (p) => ` (${p.current}/${p.goal})`,
            totalNonCombatLabel: 'Total (non-combat)',
            characterInfoNotAvailable: 'Character info not available',
        },
        combatSimIntegrationMetz: {
            noCharacterDataAlert:
                'No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again',
        },
        scrollSimulatorUi: {
            headingWithDash: (p) => `Scroll Simulation — ${p.contextLabel}`,
            title: 'Scroll Simulation',
            noteForLoadout: 'These scrolls override the defaults when this loadout is active for a skill.',
            noteForDefaults:
                'Applied when no loadout matches the current skill (or automatic saved-loadout calculations are disabled).',
        },
        actionFilter: {
            modeLabel: (p) => `Mode: ${p.mode}`,
            noMatchingActions: 'No matching actions',
            craftOffLabel: 'Craft: Off',
            craftOnLabel: 'Craft: On',
            craftToggleTooltip:
                'When on, uses crafting cost for upgrade items if cheaper than market, and includes crafting time in profit/hr',
            sellTaxOnLabel: 'Tax: On',
            sellTaxOffLabel: '⚠ Tax: Off',
            sellTaxToggleTooltipOff:
                'Sell tax is included in profit calculations (the default - accurate if you plan to sell your output)',
            sellTaxToggleTooltipOn:
                "Sell tax is excluded from profit calculations - use this when producing for personal use (dungeon keys, food/drinks, labyrinth consumables). Profit numbers will be higher than what you'd actually get by selling the output.",
            filterPlaceholder: 'Filter actions...',
            sortDefaultLabel: 'Sort: Default',
            sortProfitLabel: 'Sort: Profit',
            sortProfitXpLabel: 'Sort: Profit/XP',
            sortXpLabel: 'Sort: XP',
            sortCraftableLabel: 'Sort: Craftable',
        },
        actionTimeDisplay: {
            unknownAction: '[Unknown action]',
            actionsCount: (p) => `(${p.count} actions)`,
            actionsPerHourWithItems: (p) => `${p.actionsPerHour} actions/hr (${p.itemsPerHour} items/hr)`,
            completeAt: (p) => `Complete at ${p.time}`,
            completeIn: (p) => `Complete in ${p.time}`,
            estWithRecycle: (p) => `Est. w/ recycle: ${p.text}`,
            estimatedValueLabel: 'Estimated value',
            limitLabelGold: 'gold',
            limitLabelGoldLimit: 'gold limit',
            limitLabelMat: 'mat',
            limitLabelMatLimit: 'mat limit',
            limitLabelMax: 'max',
            limitLabelUpgrade: 'upgrade',
            limitLabelUpgradeLimit: 'upgrade limit',
            matsLabel: 'Mats:',
            profitLabel: 'Profit:',
            protections: (p) => `~${p.count} protections`,
            queueActionProfit: (p) => `Profit: ${p.amount}`,
            queueTotalTime: (p) => `Total time: ${p.time}`,
            queueTotalTimeInfinite: 'Total time: [∞]',
            queueTotalTimeUnavailable: 'Total time: [?] (enhancement estimate unavailable)',
            queueTotalTimeWithInfinite: (p) => `Total time: ${p.time} + [∞]`,
            queueTotalTimeWithUnavailable: (p) => `Total time: ${p.time} + [?]`,
            queuedCount: (p) => `(${p.count} queued)`,
            remainingLabel: 'remaining',
            secondsPerAction: (p) => `${p.time}s/action`,
            successRate: (p) => `${p.rate}% success`,
            toTarget: (p) => `~${p.count} to target`,
            tooltipTotal: (p) => `Total: ${p.time}`,
            tooltipTotalInfinite: 'Total: [∞]',
            tooltipTotalUnavailable: 'Total: [?] (enhancement estimate unavailable)',
            tooltipTotalWithInfinite: (p) => `Total: ${p.time} + [∞]`,
            tooltipTotalWithUnavailable: (p) => `Total: ${p.time} + [?]`,
            totalProfitLabel: 'Total profit',
        },
        costSummary: {
            title: 'Cost Summary',
            bestCraftingPlanLabel: 'Best crafting plan',
            directRecipeCostLabel: 'Direct recipe cost',
            finishedItemMarketLabel: 'Finished item market',
            missingDirectMatsLabel: 'Missing direct mats',
            partialDataTooltip: 'Partial — some materials have no market data',
        },
        drinkTimer: {
            queueOutlastsWarning: (p) => `⚠ Queue (${p.queueTime}) outlasts ${p.drinkName} by ${p.shortfallTime}`,
        },
        requiredMaterials: {
            artisanTeaOutOfStock: '⚠ Artisan Tea out of stock — full material amounts shown',
            missingSuffix: (p) => ` | Missing: ${p.count}`,
            queuedSuffix: (p) => ` (${p.count} Q'd)`,
            requiredLine: (p) => `Required: ${p.required}${p.queuedSuffix}`,
        },
        chatCommands: {
            multipleMatchesMessage: (p) => `Multiple items match: ${p.matchList}. Please be more specific.`,
            featureUnavailableMessage: 'Feature unavailable after 2/21/26 game update',
            itemDictionaryOpenFailedMessage: 'Failed to open Item Dictionary',
            itemNotFoundMessage: (p) => `Item "${p.itemName}" not found in game data`,
            marketplaceOpenFailedMessage: 'Failed to open marketplace',
        },
        popOutChat: {
            sendButtonLabel: 'SEND',
            addPaneButtonLabel: '+ Pane',
            bestiaryLinkLabel: 'Bestiary:',
            closePaneTooltip: 'Close pane',
            collectionLinkLabel: 'Collection:',
            disconnectBannerText: '⚠ Disconnected from game tab',
            dragHandleTooltip: 'Drag to reorder',
            filterInputPlaceholder: 'text or /regex/',
            levelAbbreviation: 'Lv.',
            levelUpMessage: (p) => `🎉 ${p.name} reached ${p.skillName} ${p.level}!`,
            marketLinkBuyLabel: 'Buy',
            marketLinkSellLabel: 'Sell',
            messageInputPlaceholder: 'Type a message...',
            partyLinkLabel: 'Party:',
            popoutButtonTooltip: 'Pop out chat',
            verticalLabelText: 'Vertical',
            filterNoFilter: 'No filter',
            filterEnhancedBuy: 'Enhanced Buy',
            filterEnhancedSell: 'Enhanced Sell',
            filterBuyOnly: 'Buy only',
            filterSellOnly: 'Sell only',
            filterCustom: 'Custom…',
        },
        collectionFilters: {
            favoritesLabel: 'Favorites',
            notDungeon: 'Not dungeon',
            skillingOutfits: 'Skilling Outfits',
            uncollectedCharms: 'Uncollected Charms',
            uncollectedCelestials: 'Uncollected Celestials',
            alwaysShowFavorites: 'Always Show Favorites',
            sortLabel: 'Sort:',
            sortDefault: 'Default',
            sortItemsToNextTier: 'Items to next tier',
            sortGoldCostToNextTier: 'Gold cost to next tier',
            sortTimeToNextTier: 'Time to next tier',
            collectionDataNotLoaded: 'Collection data not yet loaded — visit Collections page to refresh',
            collectedUpdatedAgo: (p) => `${p.count} collected — updated ${p.relativeTime} ago`,
        },
        viewActionButton: {
            buttonLabel: 'View Action',
        },
        inventorySort: {
            sortLabel: 'Sort:',
            askButtonLabel: 'Ask',
            bidButtonLabel: 'Bid',
            noneButtonLabel: 'None',
        },
        estimatedListingAge: {
            ageColumnHeader: '~Age',
            unknownAgeLabel: '~Unknown',
            ageColumnHeaderTooltip: 'Estimated listing age (based on listing ID)',
            stalenessTooltip: (p) => `Order book data from ${p.relativeTime} ago - Visit market page to refresh`,
            stalenessTooltipUnknown: 'Order book data - Visit market page to refresh',
        },
        listingRefreshNavigator: {
            refreshButtonLabel: 'Refresh',
        },
        marketDepthCap: {
            sellDepthLabel: (p) => `Sell depth: ${p.hitBookEnd ? 'at least ' : '~'}${p.count} actions`,
            tooltipEstimate:
                "Estimated number of actions worth of this item the visible order book can absorb before the marginal sale price drops below cost. Ignores the marketplace's tradable range floor (not exposed in game data), so a large sell-off may hit that floor and queue with a delay before this estimate suggests.",
            tooltipHitBookEnd:
                "Every visible resting bid still clears cost — the true cap may be higher than shown. Ignores the marketplace's tradable range floor (not exposed in game data), so a large sell-off may hit that floor and queue with a delay before this estimate suggests.",
        },
        tooltipPrices: {
            noMarketDataLabel: 'No market data',
            allDropsHeader: (p) => `All Drops (${p.count} total):`,
            alternativeActionsHeader: 'Alternative Actions:',
            askHeader: 'Ask',
            bidHeader: 'Bid',
            buyItemName: (p) => `Buy ${p.itemName}`,
            costPerItemLine: (p) => `Cost: ${p.cost}/item`,
            countHeader: 'Count',
            craftItemName: (p) => `Craft ${p.itemName}`,
            decomposeValueLine: (p) => `Decompose Value: ${p.ask} / ${p.bid}`,
            dropNoPriceLine: (p) => `• ${p.itemName} (${p.dropRate}): ${p.avgCount} avg → No price data`,
            dropWithPriceLine: (p) => `• ${p.itemName} (${p.dropRate}%): ${p.avgCount} avg → ${p.value}`,
            effLine: (p) => `Eff: ${p.ask} / ${p.bid}`,
            expectedReturnLine: (p) => `Expected Return: ${p.value}`,
            expectedValueHeaderLabel: 'EXPECTED VALUE',
            foundInLabel: 'Found in:',
            gatheringHeaderLabel: 'GATHERING',
            itemsPerDayUnit: (p) => `${p.value} items/day`,
            itemsPerHourUnit: (p) => `${p.value} items/hr`,
            keyCostLine: (p) => `- Key Cost: ${p.value}`,
            keyCostNamedLine: (p) => `- Key Cost (${p.name}): ${p.value}`,
            learnedLabel: '✔ Learned',
            levelLine: (p) => `Level: ${p.level}`,
            materialHeader: 'Material',
            maxLevelReachedLabel: 'Max Level Reached',
            netAfterKeyLine: (p) => `Net after key: ${p.value}`,
            netLine: (p) => `Net: ${p.perHour}/hr (${p.perDay}/day)`,
            netValueLine: (p) => `Net Value: ${p.value}`,
            priceLine: (p) => `Price: ${p.ask} / ${p.bid}${p.total}`,
            priceNoDataLine: (p) => `Price: ${p.noData}`,
            profitHeaderLabel: 'PROFIT',
            profitSummaryLine: (p) => `Profit: ${p.perAction}/action, ${p.perHour}/hour, ${p.perDay}/day`,
            profitsHeader: 'Profits:',
            progressLine: (p) => `Progress: ${p.percent}`,
            soloActionLine: (p) =>
                `• ${p.actionName}: ${p.itemsPerHour} items/hr | ${p.profitPerHour}/hr (${p.profitPerDay}/day)`,
            soloLabel: 'Solo:',
            top10DropsHeader: (p) => `Top 10 Drops (${p.count} total):`,
            top5DropsHeader: (p) => `Top 5 Drops (${p.count} total):`,
            totalFromDropsLine: (p) => `Total from ${p.count} drops: ${p.value}`,
            totalLabel: 'Total',
            unlearnedLabel: '⚠ Unlearned',
            xpToNextLine: (p) => `XP to Next: ${p.xp}`,
            zoneActionLine: (p) => `• ${p.actionName}: ${p.itemsDisplay} (${p.dropRate}% drop)`,
        },
        craftingPlanTreeRenderer: {
            shoppingListHeader: 'Shopping List',
            craftingStepsHeader: 'Crafting Steps',
            totalCraftTimeLabel: 'Total craft time',
            totalMaterialCostLabel: 'Total material cost',
            totalXpLabel: 'Total XP',
        },
        performancePanel: {
            title: 'PFormance',
            noData: 'No data',
        },
        remainingXp: {
            xpLeftLabel: (p) => `${p.value} XP left`,
        },
        taskAutoReroll: {
            autoRerollListTitle: 'Auto-Reroll List',
            configTooltip: 'Configure task auto-reroll reminders',
            moreResultsRefineSearch: (p) => `...${p.count} more (refine search)`,
            noAutoRerollTasksMessage: 'No auto-reroll tasks yet. Search to add.',
            searchPlaceholder: 'Search actions, monsters, zones...',
            zoneTypeLabel: (p) => `Zone (${p.count})`,
        },
        taskIcons: {
            spriteWarning: '⚠ Combat icons unavailable - visit Combat to load sprites',
            spriteWarningTooltip: 'Combat monster sprites need to be loaded. Visit the Combat panel to load them.',
        },
        taskSorter: {
            sortTasksLabel: 'Sort Tasks',
        },
        characterActivity: {
            activityStatusOutdated: 'Activity status outdated',
            characterIsIdle: 'Character is idle',
            endTimeUnavailable: 'End time unavailable',
            futureActionEnds: 'Action ends',
            futureBuffExpiring: 'Buff expiring',
            futureCoinsRunOut: 'Coins run out',
            futureMaterialsRunOut: 'Materials run out',
            futureOfflineLimit: 'Offline limit',
            futureQueueEnds: 'Queue ends',
            futureUpgradeMaterialsRunOut: 'Upgrade materials run out',
            noActiveAction: 'No active action',
            noActiveActionExpected: 'No active action expected',
            noActivityDataYet: 'No activity data yet',
            openCharacterOnceToEnableStatus: 'Open character once to enable status',
            openCharacterToRefresh: 'Open character to refresh',
            pastActionEnded: 'Action ended',
            pastBuffExpired: 'Buff expired',
            pastCoinsRanOut: 'Coins ran out',
            pastMaterialsRanOut: 'Materials ran out',
            pastOfflineProgressStopped: 'Offline progress stopped',
            pastQueueEnded: 'Queue ended',
            pastUpgradeMaterialsRanOut: 'Upgrade materials ran out',
            queueInfiniteKnown: (p) => `Queue → ∞ · Offline limit · ${p.time}`,
            queueInfiniteUnavailable: 'Queue → ∞ · Offline ETA unavailable',
            queueInfiniteUncertain: 'Queue → ∞ · Offline limit uncertain',
            queueUncertain: 'Queue duration uncertain · ETA unavailable',
            queuedSuffix: (p) => `+${p.count} queued`,
            runsInfiniteKnown: (p) => `Runs ∞ · Offline limit · ${p.time}`,
            runsInfiniteUnavailable: 'Runs ∞ · Offline ETA unavailable',
            runsInfiniteUncertain: 'Runs ∞ · Offline limit uncertain',
            uncertainCombat: 'Variable duration · ETA unavailable',
            uncertainEnhancing: 'Stochastic outcome · ETA unavailable',
            uncertainLabyrinth: 'Variable duration · ETA unavailable',
            uncertainLoadoutUnavailable: 'Configured loadout unavailable · ETA unavailable',
            uncertainSpecial: 'Waiting for party · ETA unavailable',
        },
        combatLevelProgress: {
            decimalTooltip: (p) => `Combat Level from current whole skill levels · native display: ${p.nativeLevel}`,
        },
        combatStatsCalculator: {
            unknownItemFallback: 'Unknown',
        },
        combatSummary: {
            encountersPerHour: (p) => `Encounters/hour: ${p.value}`,
            revenuePerDay: (p) => `Revenue/day: ${p.ask} / ${p.bid}`,
            revenuePerHour: (p) => `Revenue/hour: ${p.ask} / ${p.bid}`,
            skillExpPerHour: (p) => `${p.skillName} exp/hour: ${p.value}`,
            totalExp: (p) => `Total exp: ${p.value}`,
            totalExpPerHour: (p) => `Total exp/hour: ${p.value}`,
            totalRevenue: (p) => `Total revenue: ${p.ask} / ${p.bid}`,
        },
        craftingPlanCalculator: {
            coinItemName: 'Coin',
        },
        dungeonTokenTooltips: {
            costColumnHeader: 'Cost',
            cowbellValueDetail: (p) => `= Bag of 10 Cowbells (${p.bagPrice}) ÷ 10`,
            goldPerTokenLabel: 'Gold/Token',
            guildCreditValueLabel: 'Guild Credit Value:',
            itemColumnHeader: 'Item',
            labyrinthShopValueLabel: 'Labyrinth Shop Value:',
            sealValueDetail: (p) => `= ${p.cost} Labyrinth Tokens × ${p.goldPerToken} gold/token`,
            taskShopValueLabel: 'Task Shop Value:',
            tokenShopValueLabel: 'Token Shop Value:',
            valueColumnHeader: 'Value',
            valueGoldTemplate: (p) => `Value: ${p.value} gold`,
        },
        dungeonTrackerChatAnnotations: {
            averageLabel: (p) => `Average: ${p.time}`,
            canceledLabel: 'canceled',
            failedLabel: 'FAILED',
            runNumberedLabel: (p) => `Run #${p.number}: ${p.label}`,
        },
        eliteAchievementReminder: {
            defaultMessage: 'Be Elite. Do your Elite achievements.',
            reminderTooltip: 'Remind about Elite achievements',
        },
        equipmentResolver: {
            noCompleteRouteReason: 'No complete acquisition route could be priced',
        },
        guildXpDisplay: {
            activityColumn: 'Activity',
            allSignedUp: 'All signed up ✓',
            anomalousSuffix: '(anomalous)',
            collectingData: 'collecting data',
            combatLabel: 'Combat',
            daysCount: (p) => `${p.count} day${p.count !== 1 ? 's' : ''}`,
            defaultWhisperTemplate: "/w {name} Why haven't you signed up for your trial(s) yet?!",
            etaBasedOnAverageTooltip: (p) => `ETA based on ${p.basis} average: ${p.rate} XP/h`,
            etaLine: (p) => `ETA: ${p.eta}`,
            gameModeColumn: 'Game Mode',
            gameModeIroncowAbbr: 'IC',
            gameModeLegacyIroncowAbbr: 'LC',
            gameModeStandardAbbr: 'MC',
            hoursCount: (p) => `${p.count} hour${p.count !== 1 ? 's' : ''}`,
            joinedColumn: 'Joined',
            justNow: 'just now',
            lastDayXph: 'Last day XP/h',
            lastHourXph: 'Last hour XP/h',
            lastWeekXph: 'Last week XP/h',
            lastXph: 'Last XP/h',
            lessThanOneMinute: '< 1 minute',
            minutesCount: (p) => `${p.count} minute${p.count !== 1 ? 's' : ''}`,
            nextGuildLevelSlotHeading: 'Next Guild Level Slot (+1)',
            noGuildXpGainedTooltip: (p) => `No guild XP gained in the last ${p.period}`,
            noRecentGains: 'no recent gains',
            noneLabel: 'None',
            notEnoughDataForChart: 'Not enough data for chart',
            offlineLabel: (p) => `Offline (${p.count})`,
            onlineIdleLabel: (p) => `Online — Idle (${p.count})`,
            period24Hours: '24 hours',
            periodOneHour: 'hour',
            skillingLabel: 'Skilling',
            toLevelXp: (p) => `To Lv ${p.level} · ${p.xp} XP`,
            unsignedListLabel: (p) => `${p.label} (${p.count} unsigned):`,
            weeksCount: (p) => `${p.count} week${p.count !== 1 ? 's' : ''}`,
        },
        inlineXpRate: {
            expectedPrefix: 'Expected: ',
            rateLine: (p) => `· ${p.prefix}${p.value} XP/hr`,
            rateTooltip: (p) => `${p.prefix}${p.value} XP/hr`,
        },
        labyrinthBestLevel: {
            bestLevelBadge: (p) => `Best: ${p.level}`,
            offsetSuffix: (p) => `(+${p.offset})`,
            tooltipBest: (p) => `Best: ${p.level}`,
            tooltipEffective: (p) => `Effective: ${p.level}`,
            tooltipExpertTeaCrate: (p) => `Expert Tea Crate: +${p.bonus}`,
            tooltipGap: (p) => `Gap: +${p.offset}`,
            tooltipYourLevel: (p) => `Your level: ${p.level}`,
        },
        listingNextNavigator: {
            backToMyListingsLabel: 'Back to My Listings',
            nextLabel: (p) => `Next (${p.index}/${p.total})`,
        },
        marketplaceShortcuts: {
            actionDropdownLabel: 'Marketplace Action',
            addModeToggleTooltip: 'Toggle add mode: click to accumulate counts instead of setting them',
            buyNowLabel: 'Buy Now',
            newBuyListingLabel: 'New Buy Listing',
            newSellListingLabel: 'New Sell Listing',
            ownedLabel: 'Owned:',
            sellNowLabel: 'Sell Now',
            topAskAgeSubtitle: (p) => `Top ask: ~${p.age}`,
        },
        maxProduceable: {
            canProduceLine: (p) => `Can produce: ${p.count}`,
            effXpPerHourLine: (p) => `Eff. XP/hr: ${p.value}`,
            expPerHourLine: (p) => `Exp/hr: ${p.value}`,
            goldNeutralTooltip: (p) => `Gold-neutral XP rate
This action: ${p.expPerHour} XP/hr, -${p.loss}/hr
Recovery: ${p.bestProfitName} (+${p.bestProfit}/hr, ${p.bestProfitExp} XP/hr)
Ratio: ${p.ratio}hr recovery per 1hr action
Blended: (${p.expPerHour} + ${p.ratio} × ${p.bestProfitExp}) / ${p.ratioPlus1} = ${p.effXp}`,
            pinTooltip: 'Pin this action to keep it visible',
            profitPerHourLine: (p) => `Profit/hr: ${p.sign}${p.value}${p.note}`,
            profitUnknownLine: 'Profit/hr: -- ⚠',
            sellTaxExcludedTooltip:
                'Sell tax excluded — assumes you keep this output, not an actual sale price. Toggle this off on the skill page if you plan to sell it.',
            unpinTooltip: 'Unpin this action',
        },
        mentionTracker: {
            channelGlobal: 'Global',
            channelGuild: 'Guild',
            channelLocal: 'Local',
            channelParty: 'Party',
            channelWhisper: 'Whisper',
        },
        networkAlert: {
            marketDataUnavailable: '⚠️ Market data unavailable',
            outdatedData: '⚠️ Using outdated market data',
        },
        networthCalculator: {
            guildBuffDisplayName: (p) => `Shrine of ${p.shrine} - ${p.type}`,
            otherCategoryFallbackLabel: 'Other',
            shrineFallbackLabel: 'Shrine',
        },
        notificationFormatter: {
            achievementCompleted: 'Achievement completed: $t(achievementNames.{{achievementHrid}})',
            addedFriend: 'Added friend: {{name}}',
            avatarBackgroundUnlocked: 'Unlocked new avatar background',
            avatarBorderUnlocked: 'Unlocked new avatar border',
            avatarOutfitUnlocked: 'Unlocked new avatar outfit',
            avatarUnlocked: 'Unlocked new avatar',
            blockedCharacter: 'Blocked character: {{name}}',
            boughtItem: 'Bought {{count}} $t(itemNames.{{itemHrid}})',
            buyListingProgress: 'Buy listing: $t(itemNames.{{itemHrid}}){{enhancement}} - Progress: {{filled}}/{{total}}',
            buyOrderCompleted: 'Bought {{count}} $t(itemNames.{{itemHrid}}){{enhancement}} - Spent {{coins}} Coins',
            characterLeveledUp: 'You have reached level {{level}} $t(skillNames.{{skillHrid}})!',
            chatIconUnlocked: 'Unlocked chat icon: $t(chatIconNames.{{iconHrid}})',
            chatReportSubmitted: 'Chat report submitted',
            communityBuffAdded: 'Added {{minutes}} minutes of community buff: $t(communityBuffTypeNames.{{buffHrid}})',
            cowbellPurchaseCompleted: 'Purchase completed: {{count}} Cowbells',
            creatorCodeSet: 'Creator code applied: {{code}}',
            guildApplicationAccepted: 'Your application was accepted by {{guildName}}',
            guildApplicationSent: 'Applied to guild: {{guildName}}',
            guildCreated: 'Created guild: {{guildName}}',
            guildDemotedTo: 'You have been demoted to guild $t(guildCharacterRoleNames.{{role}})',
            guildDisbanded: 'Disbanded guild: {{guildName}}',
            guildInviteCanceled: 'Guild invite canceled: {{name}}',
            guildInviteDeclined: 'Guild invite declined: {{guildName}}',
            guildInviteSent: 'Sent guild invite: {{name}}',
            guildInvited: 'Invited to guild: {{guildName}}',
            guildJoined: 'Guild joined: {{guildName}}',
            guildKicked: 'Kicked by guild: {{guildName}}',
            guildLeadershipPassed: 'Passed leadership to {{name}}',
            guildLeft: 'Left guild: {{guildName}}',
            guildMemberDemoted: 'Demoted {{name}} to $t(guildCharacterRoleNames.{{role}})',
            guildMemberPromoted: 'Promoted {{name}} to $t(guildCharacterRoleNames.{{role}})',
            guildMessagePinned: 'New guild pinned message',
            guildPromotedTo: 'You have been promoted to guild $t(guildCharacterRoleNames.{{role}})',
            guildTrialStarted: 'Your guild trial has started!',
            houseConstructed: 'Level {{level}} $t(houseRoomNames.{{roomHrid}}) constructed',
            kickedGuildMember: 'Kicked guild member: {{name}}',
            labyrinthShroudFailed: "Shroud failed! The room level exceeds the shroud's effective range.",
            listingPegged:
                '$t(itemNames.{{itemHrid}}){{enhancement}} currently listed at {{boundary}} - Your chosen limit: {{limit}}',
            loadoutCreated: 'Loadout created',
            loadoutDeleted: 'Loadout deleted',
            loadoutEquipped: 'Loadout equipped',
            loadoutUpdated: 'Loadout updated',
            mooPassGranted: 'Granted: {{days}} days of MooPass',
            mooPassPurchaseCompleted: 'Purchase completed: {{days}} days of MooPass',
            nameChanged: 'Name changed: {{name}}',
            nameColorUnlocked: 'Unlocked name color: $t(nameColorNames.{{colorHrid}})',
            newReferralBonus: 'New referral bonus granted',
            notReadyToBattle: 'You are not ready to battle',
            partyCreated: 'Party created',
            partyDisbanded: 'Party disbanded',
            partyJoined: 'You have joined the party',
            partyKicked: 'You have been kicked from the party',
            partyLeadershipChanged: 'Party leadership changed to {{name}}',
            partyLeft: 'You have left the party',
            partyMemberKicked: 'Kicked {{name}} from the party',
            partyOpenForRecruiting: 'Party is open for recruiting',
            partyOptionsSaved: 'Party options saved',
            readyToBattle: 'You are ready to battle',
            referralJoined: 'A new player joined with your referral link. Thanks for sharing!',
            removedFriend: 'Removed friend: {{name}}',
            sellListingProgress: 'Sell listing: $t(itemNames.{{itemHrid}}){{enhancement}} - Progress: {{filled}}/{{total}}',
            sellOrderCompleted: 'Sold {{count}} $t(itemNames.{{itemHrid}}){{enhancement}} - Received {{coins}} Coins',
            setupImportedToLoadout: 'Imported current setup to loadout',
            soldItem: 'Sold {{count}} $t(itemNames.{{itemHrid}})',
            steamCheckoutRequested: 'Steam checkout requested. Please wait...',
            unblockedCharacter: 'Unblocked character: {{name}}',
            updateSuccessful: 'Update successful',
            upgradePurchased: 'Upgrade purchased: $t(buyableUpgradeNames.{{upgradeHrid}}) (x{{count}})',
        },
        pricingMode: {
            instantBuyInstantSell: 'Instant Buy / Instant Sell',
            patientBuyInstantSell: 'Patient Buy / Instant Sell',
        },
        queueLengthEstimator: {
            bestBuyPriceTooltip: 'Total quantity at best buy price',
            bestSellPriceTooltip: 'Total quantity at best sell price',
            estimatedTooltip: (p) => `Estimated total queue depth (extrapolated from ${p.count} visible orders)`,
        },
        taskCardVisualState: {
            rerollBadgeText: 'Reroll!',
        },
        taskClaimCollector: {
            claimReward: 'Claim Reward',
            claimRewardWithCount: (p) => `Claim Reward (${p.count})`,
        },
        taskIconFilters: {
            battleFilterLabel: 'Battle',
        },
        taskProfitCalculator: {
            marketDataNotLoadedError: 'Market data not loaded',
        },
        taskSkillGroups: {
            otherTypeLabel: 'Other',
        },
        tooltipConsumables: {
            cooldownLine: (p) => `Cooldown: ${p.seconds}s (${p.uses} uses/day)`,
            costNoDataLabel: 'Cost: No market data',
            costPerPointLine: (p) => `Cost: ${p.cost} per ${p.type}`,
            dailyMaxLine: (p) => `Daily Max: ${p.amount} ${p.type}`,
            recoveryTimeLine: (p) => `Recovery Time: ${p.seconds}s`,
            restoresInstantLine: (p) => `Restores: ${p.amount} ${p.type} (instant)`,
            restoresPerSecondLine: (p) => `Restores: ${p.amount} ${p.type}/s`,
            statsHeaderLabel: 'CONSUMABLE STATS',
        },
        tooltipEnhancement: {
            askBidHeader: 'Ask / Bid',
            askHeader: 'Ask',
            askSuffixLabel: '(ask)',
            baseItemLabel: 'Base Item',
            bidHeader: 'Bid',
            bidSuffixLabel: '(bid)',
            buyItemLabel: 'Buy Item',
            countHeader: 'Count',
            craftCostHeader: 'Craft Cost',
            craftingCostSubtotalLabel: 'Crafting Cost',
            craftItemLabel: 'Craft Item',
            enhanceCostHeader: 'Enhance Cost',
            enhancingCostSubtotalLabel: 'Enhancing Cost',
            expectedAttemptsLine: (p) => `Expected Attempts: ${p.value}`,
            fromLevelLabel: (p) => `From +${p.level}`,
            levelHeader: 'Level',
            materialHeader: 'Material',
            milestonesHeaderLabel: 'Enhancement Milestones',
            minimumSellLabel: 'Minimum sell:',
            neverProtectionLabel: 'Never',
            noProtectionNeededLine: (p) => `No protection needed for +${p.targetLevel}`,
            pathHeaderLine: (p) => `ENHANCEMENT PATH (+0 → +${p.targetLevel})`,
            protectFromLine: (p) => `Protect from: ${p.label}`,
            protectionLabel: 'Protection',
            timeDaysLine: (p) => `Time: ~${p.value} days`,
            timeHoursLine: (p) => `Time: ~${p.value} hours`,
            timeMinutesLine: (p) => `Time: ~${p.value} minutes`,
            timeSecondsLine: (p) => `Time: ~${p.value} seconds`,
            totalLabel: 'Total',
            totalXpLine: (p) => `Total XP: ~${p.value}`,
            usesMirrorFromLine: (p) => `Uses ${p.mirrorName} from +${p.level}`,
            xpHeader: 'XP',
            xpPerHourLine: (p) => `XP/hr: ${p.value}`,
            yourRateLine: (p) => `Your rate: ${p.value}/hr`,
        },
        tradeHistoryDisplay: {
            buyPriceTooltip: 'Your last buy price',
            buyValueLabel: (p) => `Buy ${p.value}`,
            lastLabel: 'Last:',
            sellPriceTooltip: 'Your last sell price',
            sellValueLabel: (p) => `Sell ${p.value}`,
        },
        settingsSchema: {
            groups: {
                ironCow: { title: 'Iron Cow Mode' },
                general: { title: 'General Settings' },
                actionBar: { title: 'Action Bar' },
                skillPageTiles: { title: 'Skill Page & Tiles' },
                actionPanel: { title: 'Action Panel' },
                actionQueue: { title: 'Action Queue' },
                alchemy: { title: 'Alchemy' },
                missingMaterials: { title: 'Missing Materials & Crafting Plan' },
                lootLog: { title: 'Loot Log' },
                tooltips: { title: 'Item Tooltip Enhancements' },
                enhancementSimulator: { title: 'Enhancement Simulator Settings' },
                enhancementTracker: { title: 'Enhancement Tracker' },
                riskOfRuin: { title: 'Risk of Ruin' },
                marketplace: { title: 'Marketplace' },
                pricingProfit: { title: 'Pricing & Profit' },
                inventoryNetWorth: { title: 'Inventory & Net Worth' },
                inventoryTabs: { title: 'Custom Inventory Tabs' },
                skills: { title: 'Skills' },
                combat: { title: 'Combat Features' },
                tasks: { title: 'Tasks' },
                ui: { title: 'UI & Appearance' },
                guild: { title: 'Guild' },
                house: { title: 'House' },
                leaderboard: { title: 'Leaderboard' },
                notifications: { title: 'Notifications' },
                colors: { title: 'Color Customization' },
                collectionFilters: { title: 'Collection Filters' },
            },
            // Shared labels for enhanceGear tier dropdowns (values from settings-schema tiers)
            tierLabels: {
                cheese: 'Cheese',
                verdant: 'Verdant',
                azure: 'Azure',
                burble: 'Burble',
                crimson: 'Crimson',
                rainbow: 'Rainbow',
                holy: 'Holy',
                celestial: 'Celestial',
                philo: 'Philo',
                speed: 'Speed',
                rarefind: 'Rare Find',
                normal: 'Normal',
                refined: 'Refined',
                trainee: 'Trainee',
                basic: 'Basic',
                advanced: 'Advanced',
                expert: 'Expert',
                master: 'Master',
                grandmaster: 'Grandmaster',
            },
            // Suffix appended to unavailable options in select dropdowns (leading space intentional)
            selectUnavailableSuffix: ' (Unavailable)',
            settings: {
                ironCow_enabled: {
                    label: 'Iron Cow Mode',
                    help: 'Disable all market and profit features for a no-marketplace playthrough.',
                },
                chatCommands: {
                    label: 'Enable chat commands (/item, /wiki, /market)',
                    help: 'Type /item, /wiki, or /market followed by an item name in chat. Example: /item radiant fiber',
                },
                chat_mentionTracker: {
                    label: 'Show badge when mentioned in chat',
                    help: 'Displays a red badge on chat tabs when someone @mentions you',
                },
                chat_popOut: {
                    label: 'Enable Pop-out Chat Window button',
                    help: 'Adds a button to the chat panel to open chat in a separate browser window with multi-channel split view',
                },
                chatHistoryExtender: {
                    label: 'Chat: Extend chat history',
                    help: 'Preserves messages that the game removes from the live buffer, keeping them visible above the live chat',
                },
                chatHistoryExtender_maxHistory: { label: 'Chat: Max messages to retain per tab' },
                notificationLog: {
                    label: 'Chat: Add Log tab',
                    help: 'Adds a Log tab to the chat panel logging item trades, level-ups, guild events, and other in-game toasts',
                },
                notificationLog_maxEntries: {
                    label: 'Chat: Max notifications to keep',
                    help: 'How many notifications to keep in history, per character. Filtering in the tab only changes what is shown, not what is stored.',
                },
                chat_24hrTimestamps: {
                    label: 'Chat: Reformat message timestamps',
                    help: 'Reformats chat message timestamps using your Market date/time format settings instead of the browser default',
                },
                altClickNavigation: {
                    label: 'Alt+click items to navigate to crafting/gathering or dictionary',
                    help: 'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable',
                },
                collectionNavigation: {
                    label: 'Add navigation buttons to collection items',
                    help: 'Adds View Action and Item Dictionary buttons when clicking collection items',
                },
                queueMonitor: {
                    label: 'Cross-character queue monitor',
                    help: 'Shows estimated queue time remaining for your other characters in a floating widget',
                },
                characterActivityStatus: {
                    label: 'Character Select: Show activity status',
                    help: 'On Character Select, shows what each character is expected to be doing and the earliest point they may need attention (action/queue end, materials, or offline cap)',
                },
                actionBar_enabled: { label: 'Action bar: Enable action bar display' },
                actionBar_compactWidth: {
                    label: 'Action bar: Compact width (800px limit)',
                    help: 'Limits action bar width to 800px. Useful for wide monitors.',
                },
                actionBar_showQueueCount: { label: 'Action bar: Queue/remaining count' },
                actionBar_showActionDuration: { label: 'Action bar: Time per action (e.g. 14.94s/action)' },
                actionBar_showActionsPerHour: { label: 'Action bar: Actions/hr and items/hr' },
                actionBar_showTimeRemaining: {
                    label: 'Action bar: Time remaining display',
                    options: {
                        both: 'Time remaining and completion ETA',
                        relative: 'Time remaining only',
                        absolute: 'Completion ETA only',
                        none: 'Neither',
                    },
                },
                actionBar_showRecycleTime: {
                    label: 'Action bar: Transmute recycle time estimate',
                    help: 'Shows estimated total time accounting for self-return recycling during transmute actions',
                },
                actionBar_showProfit: {
                    label: 'Action bar: Show current action profit',
                    help: 'Displays profit/hr and remaining profit for the current action (gathering and production)',
                },
                actionPanel_liveCountdown: {
                    label: 'Action bar: Live countdown timer',
                    help: 'Replaces the static time display on the action progress bar with a live countdown in seconds',
                },
                actionPanel_showFilter: { label: 'Skill page: Filter actions input' },
                actionPanel_showSort: { label: 'Skill page: Sort button' },
                actionPanel_showPricingMode: { label: 'Skill page: Pricing mode button' },
                actionPanel_showCraftToggle: { label: 'Skill page: Craft toggle button' },
                actionPanel_showSellTaxToggle: { label: 'Skill page: Sell tax toggle button' },
                actionPanel_showProfitPerHour_gathering: {
                    label: 'Action page: Show profit/hr on gathering tiles',
                    help: 'Displays profit/hr on gathering action tiles (Foraging, Woodcutting, etc.)',
                },
                actionPanel_showProfitPerHour_production: {
                    label: 'Action page: Show profit/hr on production tiles',
                    help: 'Displays profit/hr on production action tiles (Crafting, Tailoring, etc.)',
                },
                actionPanel_showExpPerHour_gathering: {
                    label: 'Action page: Show exp/hr on gathering tiles',
                    help: 'Displays exp/hr on gathering action tiles (Foraging, Woodcutting, etc.)',
                },
                actionPanel_showExpPerHour_production: {
                    label: 'Action page: Show exp/hr on production tiles',
                    help: 'Displays exp/hr on production action tiles (Crafting, Tailoring, etc.)',
                },
                actionPanel_hideNegativeProfit: {
                    label: 'Action panel: Hide actions with negative profit',
                    help: 'Hides action panels that would result in a loss (negative profit/hr)',
                },
                inventoryCountDisplay: {
                    label: 'Action panels: Show current inventory count of output item',
                    help: 'Shows how many of the output item you currently own, on action tiles and in the action detail panel',
                },
                actions_pinnedPage: {
                    label: 'Pinned actions: Enable pinned actions page and pin icons',
                    help: 'Adds a Pinned button to the left nav bar showing all pinned actions, and shows pin icons on action tiles.',
                },
                actionPanel_totalTime: { label: 'Action panel: Total time, times to reach target level, exp/hour' },
                actionPanel_totalTime_quickInputs: {
                    label: 'Action panel: Quick input buttons (hours, count presets, Max)',
                },
                actionPanel_quickInputs_countPresets: {
                    label: 'Action panel: Custom count presets (comma-separated, e.g. 100,1000,1000000)',
                },
                actionPanel_quickInputs_hourPresets: {
                    label: 'Action panel: Custom hour presets (comma-separated, e.g. 0.5,1,24,168,720)',
                },
                actionPanel_foragingTotal: { label: 'Action panel: Overall profit for multi-outcome foraging' },
                actionPanel_outputTotals: {
                    label: 'Action panel: Show total expected outputs below per-action outputs',
                    help: 'Displays calculated totals when you enter a quantity in the action input',
                },
                actionPanel_maxProduceable: {
                    label: 'Action panel: Show max produceable count on crafting actions',
                    help: 'Displays how many items you can make based on current inventory',
                },
                actionPanel_showProfitDetail: {
                    label: 'Action panel: Show profitability detail',
                    help: 'Displays the profitability breakdown section inside gathering, production, and alchemy action panels',
                },
                actionPanel_showLevelProgress: {
                    label: 'Action panel: Show level progress',
                    help: 'Displays XP and level progress estimates inside action panels',
                },
                actionPanel_showSpeedTime: {
                    label: 'Action panel: Show action speed & time',
                    help: 'Displays speed breakdown, efficiency, and total time inside action panels',
                },
                requiredMaterials: {
                    label: 'Action panel: Show total required and missing materials',
                    help: 'Displays total materials needed and shortfall when entering quantity',
                },
                actionPanel_enhanceMatLimitProtections: {
                    label: 'Enhancement material limit: Include protection items',
                    help: 'When enabled, protection item availability is factored into the material limit estimate. Disable to see material limit based only on enhancement materials.',
                },
                actionQueue: { label: 'Queued actions: Show total time and completion time' },
                actionQueue_showValue: { label: 'Queued actions: Show profit/value for queued actions' },
                actionQueue_valueMode: {
                    label: 'Queued actions: Value calculation mode',
                    help: 'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).',
                    options: {
                        profit: 'Total Profit (revenue - all costs)',
                        estimated_value: 'Estimated Value (revenue after tax)',
                    },
                },
                actionQueue_completionTimeStyle: {
                    label: 'Queued actions: Completion display',
                    help: 'How queued-action completion is shown in the Queued Actions popup and hover tooltip',
                    options: {
                        absolute: 'Clock time only (Complete at 14:32)',
                        relative: 'Cumulative duration only (Complete in 3h 40m)',
                        both: 'Both',
                    },
                },
                alchemy_profitDisplay: {
                    label: 'Alchemy panel: Show profit calculator',
                    help: 'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices',
                },
                alchemy_bestItems: {
                    label: 'Alchemy panel: Show best items button',
                    help: 'Adds a button to see items ranked by profit or XP for each alchemy type.',
                },
                alchemy_transmuteHistory: {
                    label: 'Alchemy panel: Track and view transmute session history',
                    help: 'Records transmutation sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_coinifyHistory: {
                    label: 'Alchemy panel: Track and view coinify session history',
                    help: 'Records coinify sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_decomposeHistory: {
                    label: 'Alchemy panel: Track and view decompose session history',
                    help: 'Records decompose sessions and displays history in a viewer tab in the Alchemy panel',
                },
                alchemy_actionProtection: {
                    label: 'Alchemy panel: Protect categories from accidental alchemy actions',
                    help: 'Blocks alchemy action buttons for 3 seconds when the selected item belongs to a protected category. A shield icon appears in the alchemy panel to configure protected categories.',
                },
                alchemyItemDimming: { label: 'Alchemy panel: Dim items requiring higher level' },
                actions_missingMaterialsButton: {
                    label: 'Show "Missing Mats Marketplace" button on production panels',
                    help: 'Adds button to production panels that opens marketplace with tabs for missing materials',
                },
                actions_missingMaterialsButton_ignoreQueue: {
                    label: 'Ignore queued actions when calculating missing materials',
                    help: 'When enabled, missing materials calculation only considers current action request, ignoring materials already reserved by queued actions. Default (off) accounts for queue.',
                },
                actions_budgetCalculator: {
                    label: 'Action panel: Budget calculator',
                    help: 'Adds a budget input below the Missing Mats button. Enter a gold budget (e.g. 50m) to calculate how many units you can produce by buying missing tradeable materials at ask price.',
                },
                actions_costSummary: {
                    label: 'Action panel: Show cost summary',
                    help: 'Compact 4-line cost comparison for the selected produce quantity: direct recipe cost, missing direct mats, best crafting plan, and finished item market price.',
                },
                actionPanel_bestCraftingPlan: {
                    label: 'Action panel: Show best crafting plan',
                    help: 'Shows the cheapest way to obtain a crafted item by comparing buy vs craft at each material tier.',
                },
                actionPanel_craftingPlanBuyIntermediates: {
                    label: 'Action panel: Crafting plan buys raw materials only',
                    help: 'Always craft items that have a recipe — only buy uncraftable raw materials from the market.',
                },
                actionPanel_craftingPlanNoProcessing: {
                    label: 'Action panel: Crafting plan no processing',
                    help: 'Only craft the final item — buy all sub-materials from the market instead of processing them yourself.',
                },
                actionPanel_craftingPlanTaskMode: {
                    label: 'Action panel: Crafting plan task mode',
                    help: 'Forces the final craft step (for task credit) but allows buying intermediate materials if cheaper.',
                },
                actionPanel_craftingPlanTimeCost: {
                    label: 'Action panel: Crafting plan time cost',
                    help: 'Factor in the time cost of crafting when deciding buy vs craft. Uses your gold/hr value to determine if crafting is worth your time.',
                },
                actionPanel_craftingPlanGoldPerHour: {
                    label: 'Action panel: Crafting plan gold/hr value',
                    help: 'Your time value in gold per hour. Used to calculate if crafting intermediates is worth the time. Set to your typical hourly profit (e.g., 500000).',
                },
                actionPanel_craftingPlanMatchQuantity: {
                    label: 'Action panel: Crafting plan matches action quantity',
                    help: 'Scale the Best Crafting Plan (shopping list, craft steps, totals) to the quantity entered in the action panel instead of always planning for 1.',
                },
                actions_artisanMaterialMode: {
                    label: 'Missing materials: Artisan requirement mode',
                    help: 'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.',
                    options: {
                        expected: 'Expected value (average)',
                        'worst-case': 'Worst-case per action (ceil per craft)',
                        hybrid: 'Hybrid (ceil below 100 actions, average at 100+)',
                    },
                },
                lootLogStats: {
                    label: 'Loot Log Statistics',
                    help: 'Display total value, average time, and daily output in loot logs',
                },
                lootLogHistory: {
                    label: 'Loot Log: Persist and display historical entries',
                    help: 'Saves loot log entries and displays older entries below current ones in the loot log panel',
                },
                itemTooltip_prices: { label: 'Show 24-hour average market prices' },
                itemTooltip_effectivePrices: {
                    label: 'Show effective (after-tax) prices',
                    help: 'Shows what you actually receive after the 4% marketplace tax next to ask/bid prices in item tooltips',
                },
                itemTooltip_decomposeValue: {
                    label: 'Show decompose value',
                    help: 'Shows the market value of what you would get from decomposing this item (ask/bid), below the Price line. This is a raw value of the components only - not netted against catalyst/coin costs or the 60% success rate - so you can compare it directly against selling the item outright.',
                },
                itemTooltip_enhancingHourlyRate: {
                    label: 'Target hourly rate for enhancing (e.g. 50m)',
                    help: 'Adds a minimum sell price to the enhancement tooltip that covers total cost plus this rate for time spent. Leave blank to disable.',
                },
                itemTooltip_enhancingHourlyRateTax: {
                    label: 'Include marketplace tax in minimum sell price',
                    help: 'Accounts for the 4% marketplace seller tax so listing at minimum sell still nets your target rate after tax',
                },
                itemTooltip_artisanPrices: {
                    label: 'Adjust tooltip prices for Artisan Tea reduction',
                    help: 'When viewing a recipe on an action panel, adjusts the total price to reflect actual material cost after Artisan Tea reduction',
                },
                itemTooltip_profit: { label: 'Show production cost and profit' },
                itemTooltip_detailedProfit: {
                    label: 'Show detailed materials breakdown in profit display',
                    help: 'Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown',
                },
                itemTooltip_multiActionProfit: {
                    label: 'Show profit comparison for all item actions',
                    help: 'Displays best profit/hr highlighted, with other alternative actions (craft, coinify, decompose, transmute) summarized below',
                },
                itemTooltip_expectedValue: { label: 'Show expected value for openable containers' },
                expectedValue_showDrops: {
                    label: 'Expected value drop display',
                    options: {
                        'Top 5': 'Top 5',
                        'Top 10': 'Top 10',
                        All: 'All Drops',
                        None: 'Summary Only',
                    },
                },
                expectedValue_respectPricingMode: { label: 'Use pricing mode for expected value calculations' },
                expectedValue_includeCowbells: { label: 'Include cowbell value in expected value calculations' },
                showConsumTips: { label: 'HP/MP consumables: Restore speed, cost performance' },
                dungeonTokenTooltips: { label: 'Currency tooltips: Show shop values for tokens, seals, and cowbells' },
                itemTooltip_gathering: {
                    label: 'Show gathering sources and profit',
                    help: 'Shows gathering actions that produce this item (foraging, woodcutting, milking)',
                },
                itemTooltip_gatheringRareDrops: {
                    label: 'Show rare drops from gathering',
                    help: 'Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)',
                },
                itemTooltip_abilityStatus: {
                    label: 'Show ability book status',
                    help: 'Shows whether ability is learned and current level/progress on ability book tooltips',
                },
                abilityTooltip_effectiveTiming: {
                    label: 'Show effective cooldown/cast time (with your stats)',
                    help: 'Computes actual Cooldown/Cast Time from your current Ability Haste, Cast Speed, and Attack level, and shows it on ability tooltips when different from the base value.',
                },
                itemTooltip_enhancementMilestones: {
                    label: 'Show enhancement milestones (+5/+7/+10/+12)',
                    help: 'Shows expected cost and XP to reach +5, +7, +10, and +12 on unenhanced equipment tooltips',
                },
                itemTooltip_enhancementPath: {
                    label: 'Show enhancement path on enhanced items',
                    help: 'Shows the optimal enhancement path cost breakdown when hovering over enhanced (+1 to +20) items',
                },
                itemTooltip_pinTop: {
                    label: 'Pin tooltips to top-center of screen',
                    help: 'Forces item tooltips to always appear centered at the top of the screen instead of near the hovered item',
                },
                itemTooltip_hideInEnhanceSelector: {
                    label: 'Hide tooltip extras in enhance item selector',
                    help: 'Suppresses injected tooltip content (prices, profit, milestones) when browsing items in the enhancement selector',
                },
                itemDictionary_transmuteRates: {
                    label: 'Item Dictionary: Show transmutation success rates',
                    help: 'Displays success rate percentages in the "Transmuted From (Alchemy)" section',
                },
                itemDictionary_transmuteIncludeBaseRate: {
                    label: 'Item Dictionary: Include base success rate in transmutation percentages',
                    help: 'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching "Transmutes Into" section)',
                },
                enhanceSim: { label: 'Show enhancement simulator calculations' },
                enhanceSim_showConsumedItemsDetail: {
                    label: 'Enhancement tooltips: Show detailed breakdown for consumed items',
                    help: "When enabled, shows base/materials/protection breakdown for each consumed item in Philosopher's Mirror calculations",
                },
                enhanceSim_baseItemCraftingCost: {
                    label: 'Enhancement path: Use crafting cost for base item if cheaper',
                    help: 'When enabled, uses the lower of crafting cost or market price for the base item in enhancement path calculations, applied independently to both the Ask and Bid columns',
                },
                enhanceSim_autoTargetLevel: {
                    label: 'Enhancement: Auto-fill target level on panel open (0 = disabled)',
                    help: "When non-zero, automatically sets the Target Level input to this value whenever you open an item's enhancement panel. Re-applies each time you switch items.",
                },
                enhanceSim_autoProtectFrom: {
                    label: 'Enhancement: Auto-fill optimal protect-from level when protection item is set',
                    help: 'When enabled, automatically fills the Protect From Level input with the optimal (cheapest) value whenever a protection item is placed in the slot.',
                },
                enhanceSim_autoDetect: {
                    label: 'Auto-detect your stats (false = use settings below)',
                    help: 'Most players should leave this off to see realistic professional enhancer costs',
                },
                enhanceSim_protectionMarketplaceButton: {
                    label: 'Protection item picker: Show "Buy Cheapest" marketplace button',
                    help: 'Adds a button to the Protection item selector popup in the Enhancing panel that navigates to the Marketplace for the cheapest available protection option',
                },
                enhanceSim_enhancingLevel: {
                    label: 'Enhancing skill level',
                    help: 'Default: 140 (professional enhancer level)',
                },
                enhanceSim_houseLevel: { label: 'Observatory house room level', help: 'Default: 8 (max level)' },
                enhanceSim_achievement: {
                    label: 'Achievement bonus (+0.2%)',
                    help: 'Include enhancing achievement success bonus',
                },
                enhanceSim_gear_enhancer: { label: 'Enhancer' },
                enhanceSim_gear_gloves: { label: 'Gloves' },
                enhanceSim_gear_top: { label: 'Top' },
                enhanceSim_gear_bottoms: { label: 'Bottoms' },
                enhanceSim_gear_neck: { label: 'Neck' },
                enhanceSim_gear_ring: { label: 'Ring' },
                enhanceSim_gear_earring: { label: 'Earring' },
                enhanceSim_gear_cape: { label: 'Cape' },
                enhanceSim_gear_guzzling: { label: 'Guzzling' },
                enhanceSim_gear_charm: { label: 'Charm' },
                enhanceSim_tea: {
                    label: 'Enhancing tea',
                    help: 'Enhancing tea provides skill level bonus',
                    options: {
                        none: 'None',
                        basic: 'Enhancing Tea (+3)',
                        super: 'Super Enhancing Tea (+6)',
                        ultra: 'Ultra Enhancing Tea (+8)',
                    },
                },
                enhanceSim_blessedTea: {
                    label: 'Blessed Tea active',
                    help: 'Professional enhancers use this to reduce attempts',
                },
                enhanceSim_communityBuff: {
                    label: 'Community Buff',
                    help: 'Enhancing speed community buff. Checked = auto-detect from game.',
                },
                enhancementTracker: {
                    label: 'Enable Enhancement Tracker',
                    help: 'Track enhancement attempts, costs, and statistics',
                },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    label: 'Show tracker only on Enhancing screen',
                    help: 'Hide tracker when not on the Enhancing screen',
                },
                enhancementXPH: {
                    label: 'Enhancement: XPH calculator',
                    help: 'Ranks all enhanceable items by expected XP per hour at your current stats',
                },
                enhancementXPH_maxLevel: { label: 'Enhancement XPH: Default max enhancement level (1–20)' },
                enhancementXPH_protectFrom: { label: 'Enhancement XPH: Default protect from level (0 = no protection)' },
                riskOfRuin: {
                    label: 'Enable Risk of Ruin calculator',
                    help: 'Adds a standalone calculator estimating the chance of hitting 0 gold before reaching a target number of dungeon chests, alchemy Transmute actions, or an enhancement level.',
                },
                riskOfRuin_trials: {
                    label: 'Risk of Ruin: Monte Carlo trial count',
                    help: 'Higher trial counts give a more precise probability estimate at the cost of a slower calculation.',
                },
                sellQueue: {
                    label: 'Sell Queue (Shift+RightClick inventory items)',
                    help: 'Shift+RightClick an inventory item to open the marketplace and create a tab for it. Tabs close automatically when the item sells out.',
                },
                networkAlert: { label: 'Show alert when market price data cannot be fetched' },
                marketFilter: { label: 'Marketplace: Filter by level, class, slot' },
                marketSort: {
                    label: 'Marketplace: Sort items by profitability',
                    help: 'Adds a button to sort marketplace items by profit/hour. Items without profit data (drop-only) appear at the end.',
                },
                fillMarketOrderPrice: { label: 'Auto-fill marketplace orders with optimal price' },
                market_autoFillSellStrategy: {
                    label: 'Auto-fill sell price strategy',
                    help: 'When creating sell listings, choose whether to match or undercut the current best sell price',
                    options: {
                        match: 'Match best sell price',
                        undercut: 'Undercut by 1 (best sell - 1)',
                    },
                },
                market_autoFillBuyStrategy: {
                    label: 'Auto-fill buy price strategy',
                    help: 'When creating buy listings, choose whether to outbid, match, or undercut the current best buy price',
                    options: {
                        outbid: 'Outbid by 1 (best buy + 1)',
                        match: 'Match best buy price',
                        undercut: 'Undercut by 1 (best buy - 1)',
                    },
                },
                market_autoClickMax: {
                    label: 'Auto-click Max button on sell listing dialogs',
                    help: 'Automatically clicks the Max button in the quantity field when opening Sell listing dialogs',
                },
                market_quickInputButtons: {
                    label: 'Marketplace: Quick input buttons on order dialogs',
                    help: 'Adds 10, 100, 1000 preset quantity buttons to buy/sell dialogs',
                },
                market_quickInputButtons_presets: {
                    label: 'Marketplace: Custom quick input presets',
                    help: 'Comma-separated preset values (e.g. 50,500,5000). Leave blank for defaults (10, 100, 1000). Max 8 values.',
                },
                market_multiplierButtons: {
                    label: 'Marketplace: ÷2 and ×2 buttons on order dialogs',
                    help: 'Adds ÷2 and ×2 buttons to the price and quantity rows in buy/sell dialogs',
                },
                market_showOwnedInBuyModal: {
                    label: 'Marketplace: Show owned count in buy dialogs',
                    help: 'Displays how many of the item you currently own in Buy Now and Buy Listing modals',
                },
                market_marketplaceShortcuts: {
                    label: 'Marketplace: Show "Marketplace Action" button on item menus',
                    help: 'Adds a Marketplace Action dropdown to item menus with Sell Now, Buy Now, and listing shortcuts',
                },
                market_visibleItemCount: {
                    label: 'Market: Show inventory count on items',
                    help: 'Displays how many of each item you own when browsing the market',
                },
                market_visibleItemCountOpacity: {
                    label: 'Market: Opacity for items not in inventory',
                    help: 'How transparent item tiles appear when you own zero of that item',
                },
                market_visibleItemCountIncludeEquipped: {
                    label: 'Market: Count equipped items',
                    help: 'Include currently equipped items in the displayed count',
                },
                market_showListingPrices: {
                    label: 'Market: Show prices on individual listings',
                    help: 'Displays top order price and total value on each listing in My Listings table',
                },
                market_collectableListingsToTop: {
                    label: 'Market: Move collectable listings to top of My Listings',
                    help: 'Listings with something to collect are moved to the top so you can see what "Collect All" grabbed without scrolling. Manually sorting a column takes over until sort is cleared',
                },
                market_listingRefreshNavigator: {
                    label: 'Market: Show Refresh/Next buttons for cycling My Listings',
                    help: 'Adds a "Refresh" button on My Listings that opens your first listing\'s order book, then a "Next" button on each listing\'s page to move to the next one, ending in "Back to My Listings"',
                },
                market_tradeHistory: {
                    label: 'Market: Show personal trade history',
                    help: 'Displays your last buy/sell prices for items in marketplace',
                },
                market_tradeHistoryComparisonMode: {
                    label: 'Market: Trade history comparison mode',
                    help: 'Instant: Compare to instant buy/sell prices. Orders: Compare to buy/sell orders.',
                    options: {
                        instant: 'Instant',
                        listing: 'Orders',
                    },
                },
                market_listingPricePrecision: {
                    label: 'Market: Listing price decimal precision',
                    help: 'Number of decimal places to show for listing prices',
                },
                market_showListingAge: {
                    label: 'Market: Show listing age on My Listings',
                    help: 'Display how long ago each listing was created on the My Listings tab (e.g., "3h 45m")',
                },
                market_showTopOrderAge: {
                    label: 'Market: Show top order age on My Listings',
                    help: 'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)',
                },
                market_showEstimatedListingAge: {
                    label: 'Market: Show estimated age on order book',
                    help: 'Estimates creation time for all market listings using listing ID interpolation',
                },
                market_listingAgeFormat: {
                    label: 'Market: Listing age display format',
                    help: 'Choose how to display listing creation times',
                    options: {
                        elapsed: 'Elapsed Time (e.g., "3h 45m")',
                        datetime: 'Date/Time (e.g., "01-13 14:30")',
                    },
                },
                market_listingTimeFormat: {
                    label: 'Time format for date/time display',
                    help: 'Time format used in marketplace listings, action completion times, and chat timestamps',
                    options: {
                        '24hour': '24-hour (14:30)',
                        '12hour': '12-hour (2:30 PM)',
                    },
                },
                market_listingDateFormat: {
                    label: 'Date format for date/time display',
                    help: 'Date format used in marketplace listings, action completion times, and chat timestamps',
                    options: {
                        'MM-DD': 'MM-DD (01-13)',
                        'DD-MM': 'DD-MM (13-01)',
                    },
                },
                market_showOrderTotals: {
                    label: 'Market: Show order totals in header',
                    help: 'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold',
                },
                market_showHistoryViewer: {
                    label: 'Market: Show history viewer button in settings',
                    help: 'Adds "View Market History" button to settings panel for viewing and exporting all market listing history',
                },
                market_showPhiloCalculator: {
                    label: 'Market: Show Philo Gamba calculator button in settings',
                    help: 'Adds "Philo Gamba" button to settings panel for calculating transmutation ROI into Philosopher\'s Stones',
                },
                market_showQueueLength: {
                    label: 'Market: Show queue length estimates',
                    help: 'Displays total quantity at best price below Buy/Sell buttons. Estimated values (20+ orders at same price) are shown in a different color.',
                },
                market_depthCapEnabled: {
                    label: 'Market: Show sell depth cap (Risk of Ruin)',
                    help: "Shows how many actions worth of the currently-viewed item the order book can profitably absorb, based on the last Risk of Ruin calculation. Ignores the marketplace's tradable range floor, which isn't exposed in game data.",
                },
                marketData_outlierGuardEnabled: {
                    label: 'Guard against absurd marketplace listings',
                    help: "Applies everywhere Toolasha reads a market price (profit calculators, net worth, upgrade advisor, etc.). When a live ask/bid is wildly outside the band around the game's own reference market value, Toolasha substitutes the reference value instead and marks the affected number with a ⚠ so you can see where this happened.",
                },
                marketData_outlierBandMultiplier: {
                    label: 'Outlier band multiplier',
                    help: 'A live price counts as an outlier when it is more than this many times above or below the reference value (e.g. 3 = outside 1/3x-3x the reference). Only applies to items the reference dataset actually covers.',
                },
                profitCalc_pricingMode: {
                    label: 'Profit calculation pricing mode',
                    options: {
                        conservative: 'Buy: Ask / Sell: Bid (Instant Buy / Instant Sell)',
                        hybrid: 'Buy: Ask / Sell: Ask (Instant Buy / Patient Sell)',
                        optimistic: 'Buy: Bid / Sell: Ask (Patient Buy / Patient Sell)',
                        patientBuy: 'Buy: Bid / Sell: Bid (Patient Buy / Instant Sell)',
                    },
                },
                profitCalc_pricingNaming: {
                    label: 'Pricing mode naming convention',
                    help: 'Show pricing modes as "Instant Buy / Instant Sell" instead of "Buy: Ask / Sell: Bid"',
                },
                profitCalc_keyPricingMode: {
                    label: 'Key pricing mode',
                    help: 'How to value dungeon keys in tooltips, networth, and combat income calculations: ask (instant buy), bid (patient buy), or cheapest (compares buying to crafting the key yourself, using Best Crafting Plan’s engine and your Profit calculation pricing mode’s buy-side basis).',
                    options: {
                        ask: 'Ask (instant buy)',
                        bid: 'Bid (patient buy)',
                        cheapest: 'Cheapest (buy or craft)',
                    },
                },
                profitCalc_customPriceOverrides: {
                    label: 'Custom price overrides',
                    help: 'Set custom buy/sell prices for specific items. Overrides marketplace prices in profit calculations.',
                },
                profitCalc_craftUpgradeItems: {
                    label: 'Profit: Use crafting cost for upgrade items if cheaper',
                    help: 'When enabled, uses crafting cost instead of market price for upgrade items if cheaper, and factors crafting time into profit/hr calculations.',
                },
                profitCalc_excludeSellTax: {
                    label: 'Profit: Exclude sell tax (producing for personal use)',
                    help: "When enabled, Net Profit / Profit per hour assumes you keep what you produce instead of selling it, so the marketplace sell tax is not deducted from output value. Use for dungeon keys, food/drinks, labyrinth consumables, or anything else you don't plan to sell. This makes profit numbers higher than what you'd actually get by selling the output - a warning indicator appears while this is on.",
                },
                offlineProgressEconomics: {
                    label: 'Offline Progress: Show Revenue/Cost/Profit summary',
                    help: 'Adds a Revenue/Cost/Profit summary (with per-day projections) to the native Welcome Back modal, using your Pricing & Profit settings.',
                },
                networth: {
                    label: 'Top right: Show gold count',
                    help: 'Displays your current gold count next to Total Level in the page header',
                },
                invWorth: {
                    label: 'Below inventory: Show net worth breakdown',
                    help: 'Shows total net worth with a per-category breakdown (equipment, inventory, listings, houses, abilities) below the inventory panel',
                },
                invSort: { label: 'Sort inventory items by value' },
                invSort_showBadges: { label: 'Show stack value badges when sorting by Ask/Bid' },
                invSort_badgesOnNone: {
                    label: 'Badge type when "None" sort is selected',
                    options: {
                        None: 'None',
                        Ask: 'Ask',
                        Bid: 'Bid',
                    },
                },
                invSort_netOfTax: { label: 'Show badge values net of market tax' },
                invSort_sortEquipment: { label: 'Enable sorting for Equipment category' },
                invBadgePrices: {
                    label: 'Show price badges on item icons',
                    help: 'Displays per-item ask and bid prices on inventory items',
                },
                invCategoryTotals: {
                    label: 'Show category totals in inventory',
                    help: 'Displays the total market value of all items in each inventory category',
                },
                networth_pricingMode: {
                    label: 'Net worth pricing mode',
                    help: 'Ask shows what you could get by listing patiently. Bid shows what you could get by selling instantly.',
                    options: {
                        ask: 'Ask price (patient sell value)',
                        bid: 'Bid price (instant liquidation value)',
                    },
                },
                networth_highEnhancementUseCost: {
                    label: 'Use enhancement cost for highly enhanced items',
                    help: 'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.',
                },
                networth_highEnhancementMinLevel: {
                    label: 'Minimum enhancement level to use cost',
                    help: 'Enhancement level at which to stop trusting market prices',
                    options: {
                        10: '+10 and above',
                        11: '+11 and above',
                        12: '+12 and above',
                        13: '+13 and above (recommended)',
                        15: '+15 and above',
                    },
                },
                networth_includeCowbells: {
                    label: 'Include cowbells in net worth',
                    help: 'Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price',
                },
                networth_includeTaskTokens: {
                    label: 'Include task tokens in net worth',
                    help: 'Value task tokens based on expected value from Task Shop chests. Disable to exclude them from net worth.',
                },
                networth_abilityBooksAsInventory: {
                    label: 'Count ability books as inventory (Current Assets)',
                    help: 'Move ability books from Fixed Assets to Current Assets inventory value. Useful if you plan to sell them.',
                },
                networth_historyChart: {
                    label: 'Enable net worth history chart',
                    help: 'Records hourly net worth snapshots and shows a chart icon next to Total Net Worth. Disable to stop tracking and hide the chart button.',
                },
                autoAllButton: {
                    label: 'Auto-click "All" button when opening loot boxes',
                    help: 'Automatically clicks the "All" button when opening openable containers (crates, chests, caches)',
                },
                autoAllButton_excludeSeals: {
                    label: 'Auto-click "All": Skip Scroll of... items',
                    help: 'When enabled, Scroll of... items from the Labyrinth are not auto-opened',
                },
                openableAnalytics: {
                    label: 'Openable Analytics: Track Actual vs Expected Value + Luck',
                    help: 'Shows Actual Value, Expected Value, and Luck for chests/crates/caches you open, plus a character-scoped Analytics view with session/lifetime history',
                },
                openableAnalytics_sidePanel: {
                    label: 'Openable Analytics: Show Current/History side panel',
                    help: 'Pins a panel to the left of the Opened Loot window with Opened, Income, Profit, Luck, Expected income, and vs. expected for the current opening and its lifetime history',
                },
                inventoryTabs: {
                    label: 'Custom Inventory Tabs: Enable',
                    help: 'Adds a Toolasha tab to the character panel where you can organize inventory items into personal tabs.',
                },
                inventoryTabs_showUnorganized: {
                    label: 'Custom Inventory Tabs: Show Unorganized bucket',
                    help: 'Show an "Unorganized" section containing all items not assigned to any tab.',
                },
                inventoryTabs_categoryAddAll: {
                    label: 'Custom Inventory Tabs: Add all items when adding category',
                    help: 'When adding a category to a tab, add every item in that category (including items not in your inventory). When disabled, only items currently in your inventory are added.',
                },
                inventoryTabs_defaultTab: {
                    label: 'Custom Inventory Tabs: Show Toolasha tab by default',
                    help: 'Hides the native Inventory tab and automatically activates the Toolasha tab whenever the character panel opens.',
                },
                inventoryTabs_tileGap: {
                    label: 'Custom Inventory Tabs: Item spacing (px)',
                    help: 'Pixel gap between item tiles on the Toolasha tab.',
                },
                inventoryTabs_loadoutIncludeConsumables: {
                    label: 'Custom Inventory Tabs: Include food & drinks when adding from loadout',
                    help: 'When adding items from a loadout to a tab, also include food and drink items.',
                },
                inventoryTabs_topTabPriority: {
                    label: 'Custom Inventory Tabs: Items visible in topmost tab only',
                    help: 'When an item appears in multiple tabs, it only shows in the highest (topmost) tab that contains it. When disabled, collapsing a tab releases its items to lower tabs.',
                },
                simulateScrollEffects: {
                    label: 'Skills: Simulate missing scroll effects in calculations',
                    help: 'When enabled, profit/XP/speed calculations show hypothetical results as if selected scrolls were active. Configure default scrolls with the button; override per-loadout from the Loadouts panel.',
                },
                xpTracker: {
                    label: 'Left sidebar: Show XP/hr rate on skill bars',
                    help: 'Displays live XP/hr rate under each skill bar in the navigation panel',
                },
                xpTracker_timeTillLevel: {
                    label: 'Skill tooltip: Show time till next level',
                    help: 'Shows estimated time remaining until the next level in the skill hover tooltip (based on current XP/hr)',
                },
                skillRemainingXP: {
                    label: 'Left sidebar: Show remaining XP to next level',
                    help: 'Displays how much XP needed to reach the next level under skill progress bars',
                },
                skillRemainingXP_blackBorder: {
                    label: 'Remaining XP: Add black text border for better visibility',
                    help: 'Adds a black outline/shadow to the XP text for better readability against progress bars',
                },
                skillbook: {
                    label: 'Skill books: Show books needed to reach target level (in the ability book item dictionary window)',
                },
                drinkTimer: {
                    label: 'Drink timer: Show remaining tea time in consumables box',
                    help: 'Displays remaining drink supply time and queue coverage under the consumables slots on Gathering/Production, Alchemy, and Enhancing action panels.',
                },
                drinkTimer_warningThreshold: {
                    label: 'Drink timer: warning threshold (hours)',
                    help: 'Show an amber warning on drink time displays when remaining supply falls below this many hours.',
                },
                skillingOptimizer: { label: 'Skilling Simulator/Optimizer: Enable Optimizer tab in character panel' },
                combatScore: { label: 'Profile panel: Show gear score' },
                abilitiesTriggers: {
                    label: 'Profile panel: Show abilities & triggers',
                    help: 'Displays equipped abilities, consumables, and their combat triggers below the profile',
                },
                characterCard: {
                    label: 'Profile panel: Show View Card button',
                    help: 'Adds button to open character sheet in external viewer',
                },
                eliteAchievementReminder: {
                    label: 'Profile panel: Show Elite achievement reminder icon',
                    help: "Shows a ✉️ icon next to a player's name if they haven't completed Elite achievements; click to pre-fill a whisper.",
                },
                eliteAchievementReminderMessage: {
                    label: 'Elite achievement reminder: whisper message',
                    help: 'Message pre-filled into chat when the Elite achievement reminder icon is clicked.',
                },
                dungeonTracker: {
                    label: 'Dungeon Tracker: Real-time progress tracking',
                    help: 'Tracks dungeon runs with server-validated duration from party messages',
                },
                dungeonTrackerUI: {
                    label: 'Show Dungeon Tracker UI panel',
                    help: 'Displays dungeon progress panel with wave counter, run history, and statistics',
                },
                dungeonTrackerChatAnnotations: {
                    label: 'Show run time in party chat',
                    help: 'Adds colored timer annotations to "Key counts" messages (green if fast, red if slow)',
                },
                labyrinthTracker: {
                    label: 'Labyrinth best level tracker',
                    help: 'Tracks the highest recommended level enemy defeated per monster type and shows it in the Automation tab',
                },
                labyrinthShopPrices: {
                    label: 'Labyrinth Shop: Show market prices',
                    help: 'Shows ask/bid market prices on tradeable items in the Labyrinth Shop tab',
                },
                labyrinthClearRate: {
                    label: 'Labyrinth clear rate calculator',
                    help: 'Shows expected clear time and success rate on labyrinth skilling room tiles',
                },
                labyrinthMissingSuppliesButton: {
                    label: 'Labyrinth: Show "Buy Missing Supplies" button',
                    help: 'Adds a button next to the Supplies section that opens the marketplace with tabs for whatever Torch/Shroud/Beacon tier is short of its carry cap',
                },
                labyrinthRecommendTargetRate: {
                    label: 'Labyrinth: Recommend target clear rate (%)',
                    help: 'Default target clear rate for labyrinth skip threshold recommendations',
                },
                labyrinthRecommendSimHours: {
                    label: 'Labyrinth: Recommend sim hours per step',
                    help: 'Default hours of combat simulation per binary search step in recommendations',
                },
                labyrinthLiveProgress: {
                    label: 'Labyrinth: Show live clear chance',
                    help: 'Shows live clear chance during active labyrinth skilling/enhancing rooms',
                },
                combatBattleCounter: {
                    label: 'Show battle/wave counter in current action panel during combat',
                    help: 'Displays "Battle #N" for regular zones or "Wave N" for dungeons in the top-left action panel',
                },
                combatSummary: {
                    label: 'Combat Summary: Add rate stats to Battle Info panel',
                    help: 'Adds encounters/hour, revenue, and experience rates to the Battle Info panel for the currently-viewed unit',
                },
                combatSim: {
                    label: 'Combat Simulator',
                    help: 'Simulate combat encounters to estimate XP/hr, deaths, and consumable usage',
                },
                labSim: {
                    label: 'Lab Simulator',
                    help: 'Simulate labyrinth runs to estimate performance across skills and combat',
                },
                combatSim_defaultHours: {
                    label: 'Combat Simulator: Default hours (single zone)',
                    help: 'Default simulation duration in hours for single-zone runs',
                },
                combatSim_allZonesDefaultHours: {
                    label: 'Combat Simulator: Default hours (All Zones)',
                    help: 'Default simulation duration in hours for All Zones runs',
                },
                combatSim_seekDefaultHours: {
                    label: 'Combat Simulator: Default hours (Seek)',
                    help: 'Default simulation duration in hours for Seek Best Source runs',
                },
                combatSim_decimalMinutes: {
                    label: 'Combat Simulator: Show completion time as decimal minutes',
                    help: 'Display avg completion time as "X.XX min" instead of "Xm Ys"',
                },
                combatSim_defaultLoadout: {
                    label: 'Combat Simulator: Default loadout',
                    help: 'Loadout to use by default for combat estimates instead of currently equipped gear',
                    options: { _empty: 'Current Gear' },
                },
                combatSim_autoEstimate: {
                    label: 'Combat Simulator: Auto-run estimate on task cards',
                    help: 'Automatically run combat estimates using the default loadout when task cards appear',
                },
                combatSim_maxThreads: {
                    label: 'Combat Simulator: Max threads',
                    help: 'Maximum Web Worker threads for simulations (0 = auto, uses all available cores)',
                },
                combatSim_upgradeSkipSkillingRooms: {
                    label: 'Combat Simulator: Upgrade Advisor - skip skilling house rooms',
                    help: 'House Rooms Upgrade mode: skip simulating rooms with no combat stat bonus (Brewery, Garden, etc.) to save sim time. They still get a tiny Wisdom/Rare Find bonus like every room, so turn this off to see their (usually negligible) Gold/EXP and Gold/Profit values too.',
                },
                combatStats: {
                    label: 'Combat Statistics: Show Statistics tab in Combat panel',
                    help: 'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details',
                },
                combatStats_runwayWarningThreshold: {
                    label: 'Combat Statistics: consumable runway warning threshold (hours)',
                    help: 'Highlight combat consumables projected to run out within this many hours. Set to 0 to disable warnings.',
                },
                combatStats_showLootLuck: {
                    label: 'Combat Statistics: Show Loot Luck comparison',
                    help: 'Shows the Actual vs Expected drop-rate/profit comparison and Loot Luck delta in the Statistics panel.',
                },
                combatConsumableTimer: {
                    label: 'Combat consumable timer: Show remaining food/drink time during battle',
                    help: 'Shows each active combat food/drink\'s estimated remaining runway below its icon in the Consumables list during battle. Requires "Combat Statistics" to be enabled - the estimate comes from its consumption tracker.',
                },
                combatStatsChatMessage: {
                    label: 'Combat Statistics: Chat message format',
                    help: 'Message format when Ctrl+clicking player card in Statistics. Click "Edit Template" to customize.',
                },
                taskProfitCalculator: { label: 'Show total profit for gathering/production tasks' },
                taskSpeedBreakdown: {
                    label: 'Show expandable speed & time breakdown on tasks',
                    help: 'Displays an expandable action speed, efficiency, and timing breakdown on task cards.',
                },
                taskCombatEstimate: {
                    label: 'Show combat estimate on combat tasks',
                    help: 'Displays a loadout dropdown and estimate button on combat task cards.',
                },
                taskEfficiencyRating: {
                    label: 'Show task efficiency rating (tokens/profit per hour)',
                    help: 'Displays a color-graded efficiency score based on expected completion time.',
                },
                taskMaterialsIndicator: {
                    label: 'Show materials availability on production tasks',
                    help: 'Shows how many task actions you can complete with current inventory.',
                },
                taskEfficiencyRatingMode: {
                    label: 'Efficiency algorithm',
                    help: 'Choose whether to rate by task token payout or total profit.',
                    options: {
                        tokens: 'Task tokens per hour',
                        gold: 'Task profit per hour',
                    },
                },
                taskEfficiencyGradient: {
                    label: 'Use relative gradient colors',
                    help: 'Colors efficiency ratings relative to visible tasks.',
                },
                taskQueuedIndicator: {
                    label: 'Show "Queued" indicator on task cards',
                    help: 'Displays a status message on task cards when their action is in your action queue',
                },
                taskRerollTracker: {
                    label: 'Track task reroll costs',
                    help: 'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)',
                },
                taskMapIndex: { label: 'Show combat zone index numbers on tasks' },
                taskIcons: {
                    label: 'Show visual icons on task cards',
                    help: 'Displays semi-transparent item/monster icons on task cards',
                },
                taskIconsDungeons: {
                    label: 'Show dungeon icons on combat tasks',
                    help: 'Shows which dungeons contain the monster (requires Task Icons enabled)',
                },
                taskSorter_autoSort: {
                    label: 'Automatically sort tasks when opening task panel',
                    help: 'Automatically sorts tasks by skill type when you open the task panel',
                },
                taskSorter_hideButton: {
                    label: 'Hide Sort Tasks button',
                    help: 'Hides the Sort Tasks button while keeping auto-sort functional',
                },
                taskSorter_sortMode: {
                    label: 'Task sort mode',
                    help: 'How tasks are ordered when clicking Sort Tasks. "Time to Completion" sorts fastest tasks first; combat and completed tasks go to the bottom. "Protection" puts unprotected tasks first.',
                    options: {
                        skill: 'Skill / Zone',
                        time: 'Time to Completion',
                        protection: 'Protection (unprotected first)',
                    },
                },
                taskInventoryHighlighter: {
                    label: 'Enable Task Inventory Highlighter button',
                    help: 'Adds a button to dim inventory items not needed for your current non-combat tasks',
                },
                taskStatistics: {
                    label: 'Show task statistics button on Tasks panel',
                    help: 'Adds a Statistics button to the Tasks panel showing overflow time, expected rewards, and completion estimates',
                },
                taskClaimCollector: {
                    label: 'Move Claim Reward buttons to top of task list',
                    help: 'Moves all Claim Reward buttons to a stack at the top of the task list so you can click the same spot repeatedly to claim all completed tasks',
                },
                taskGoMerge: {
                    label: 'Merge duplicate tasks on Go',
                    help: 'When clicking Go on a task, combines the required amounts of all in-progress tasks for the same action into a single pre-filled count',
                },
                taskRerollProtection: {
                    label: 'Task reroll protection',
                    help: 'Protect specific tasks from accidental rerolling. Protected tasks get a green highlight and require a confirmation click before rerolling. A shield icon appears in the task panel to configure protected zones.',
                },
                taskRerollProtection_hideHighlight: {
                    label: 'Task reroll protection: Hide green highlight',
                    help: 'Removes the green outline/glow from protected tasks while keeping the reroll confirmation active.',
                },
                taskAutoReroll: {
                    label: 'Task auto-reroll reminder',
                    help: 'Highlights tasks you want to reroll with a red border and reminder badge. Configure per-character via the target icon in the task panel.',
                },
                taskTokenThreshold: {
                    label: 'Flag tasks by Task Token reward for reroll',
                    help: 'Highlights tasks whose Task Token reward crosses a configurable cutoff (below or above) with the same red border and reminder badge as auto-reroll. Does not click or reroll anything automatically. Configure the cutoff and direction per-character via the icon in the task panel.',
                },
                draggableModals: {
                    label: 'Draggable modals',
                    help: 'Makes game popup modals draggable. Position is remembered per modal type across sessions.',
                },
                formatting_useKMBFormat: {
                    label: 'Number format mode',
                    help: 'Controls how large numbers are displayed throughout the UI',
                    options: {
                        full: 'Full (1,250,000)',
                        threshold: 'Abbreviate after 4 digits (1,250K)',
                        compact: 'Always abbreviate (1.25M)',
                    },
                },
                formatting_precision: {
                    label: 'Abbreviation precision (decimal digits)',
                    help: 'Number of decimal places shown when numbers are abbreviated with K/M/B suffixes',
                    options: {
                        1: '1 digit (1.2M)',
                        2: '2 digits (1.25M)',
                        3: '3 digits (1.250M)',
                        4: '4 digits (1.2500M)',
                    },
                },
                ui_externalLinks: {
                    label: 'Left sidebar: Show external tool links',
                    help: 'Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy',
                },
                hideLabyrinthBadge: { label: 'Left sidebar: Hide Labyrinth ping badge' },
                hideGuildBadge: { label: 'Left sidebar: Hide Guild notification badge' },
                hideNavBarGlow: {
                    label: 'Left sidebar: Hide active skill glow effect',
                    help: "Removes the game's pulsing orange glow animation from the currently active skill's icon in the left navigation bar.",
                },
                tabReorder: {
                    label: 'Character panel: Drag-and-drop tab reordering',
                    help: 'Drag tabs to rearrange the order of Inventory, Toolasha, Equipment, Houses, Abilities, and Loadout. Order persists through refresh.',
                },
                expPercentage: { label: 'Left sidebar: Show skill XP percentages' },
                combatLevelProgress: {
                    label: 'Left sidebar: Show decimal Combat Level',
                    help: "Shows the unrounded Combat Level formula value from current whole skill levels (e.g. 133.2). MWI's native sidebar floors it to an integer for display.",
                },
                itemIconLevel: { label: 'Bottom left corner of icons: Show equipment level' },
                loadoutEnhancementDisplay: {
                    label: 'Loadout panel: Show highest-owned enhancement level on equipment icons',
                },
                loadoutSnapshot: {
                    label: 'Loadouts: Use saved loadouts in profit/action calculations',
                    help: "When you queue an action, Toolasha predicts its XP, time, and profit using the current saved game loadout for that skill (skill-default → all-skills-default → matching saved loadout → currently-equipped). 'Use highest enhancement level' is resolved from what you currently own. Unavailable saved equipment makes the prediction fall back to the proven currently-equipped setup; unavailable saved food/drinks do not invalidate the loadout and their missing slots are omitted. Disable to always predict using currently-equipped gear.",
                },
                showsKeyInfoInIcon: { label: 'Bottom left corner of key icons: Show zone index' },
                mapIndex: { label: 'Combat zones: Show zone index numbers' },
                guildXPTracker: {
                    label: 'Track guild and member XP over time',
                    help: 'Records guild and member XP data from WebSocket messages for XP/hr calculations on the Guild panel.',
                },
                guildXPDisplay: {
                    label: 'Show XP/hr stats on Guild panel',
                    help: 'Displays XP/hr rates, rankings, and a weekly chart on the Guild Overview, Members, and Guild Leaderboard tabs. Disable the standalone Guild XP/h userscript if using this.',
                },
                guildIdleDisplay: {
                    label: 'Guild Overview: Show idle members list',
                    help: 'Displays a list of guild members who are currently idle (not performing any action) on the Guild Overview tab.',
                },
                guildTrialSignupDisplay: {
                    label: 'Guild Trials: Show unsigned members list',
                    help: "Displays which guild members have not yet signed up for the current week's skilling and combat trials.",
                },
                guildTrialWhisperTemplate: {
                    label: 'Guild Trials: Whisper message when clicking a name',
                    help: "Message pre-filled in chat when clicking an unsigned member's name. Use {name} for the player's name.",
                },
                guildMembersActivityTab: {
                    label: 'Guild Members: Show Activity column on',
                    help: 'Controls where the Activity column appears. "Contributions tab only" hides the native column on Status and shows it on Contributions instead.',
                    options: {
                        status: 'Status tab only (native)',
                        contributions: 'Contributions tab only',
                        both: 'Both tabs',
                    },
                },
                guildMembersShowGameMode: {
                    label: 'Guild Members: Show Game Mode column',
                    help: 'Shows the MC/IC/LC game mode column (Status tab).',
                },
                guildMembersShowJoined: {
                    label: 'Guild Members: Show Joined column',
                    help: 'Shows the date each member joined the guild (Status tab).',
                },
                guildMembersShowLastXPH: {
                    label: 'Guild Members: Show Last XP/h column',
                    help: 'Shows recent XP/hr tracked by Toolasha (Contributions tab).',
                },
                guildMembersShowLastDayXPH: {
                    label: 'Guild Members: Show Last day XP/h column',
                    help: 'Shows 24-hour average XP/hr tracked by Toolasha (Contributions tab).',
                },
                guildCreditValue: {
                    label: 'Guild Shop: Show gold cost per credit table',
                    help: 'Injects a cost-efficiency table into each guild credit exchange modal, sorted cheapest first using your profit pricing mode.',
                },
                guildTokenValueComparison: {
                    label: 'Guild Shop: Show Guild Token gold-value comparison',
                    help: 'Adds a Guild Token row to the credit exchange cost table, and a Guild Credit Value table to the Guild Token tooltip, showing gold/token via the cheapest tradeable item route to each credit type.',
                },
                guildCreditExchangeAdvisor: {
                    label: 'Guild Shop: Show exchange advisor (sell → rebuy comparison)',
                    help: 'When the selected item is not the cheapest option, shows whether selling it and rebuying the best item would yield more credits (accounts for 4% seller tax).',
                },
                guildShrineUpgradePlanner: {
                    label: 'Guild Shop: Show shrine upgrade planner',
                    help: 'Adds a shrine upgrade planner to the guild credit exchange panel, showing total credit and token costs to upgrade from your current level to a target level.',
                },
                houseUpgradeCosts: { label: 'Show upgrade costs with market prices and inventory comparison' },
                leaderboardXPTracker: {
                    label: 'Track player XP over time from Leaderboard',
                    help: 'Records player XP from leaderboard WebSocket messages for XP/hr calculations on the Leaderboard panel.',
                },
                leaderboardXPDisplay: {
                    label: 'Show XP/hr columns on Leaderboard',
                    help: 'Adds Last XP/h and Last day XP/h columns to the player Leaderboard panel.',
                },
                notifiEmptyAction: {
                    label: 'Browser notification when action queue is empty',
                    help: 'Only works when the game page is open',
                },
                color_profit: {
                    label: 'Profit/Positive Values',
                    help: 'Color used for profit, gains, and positive values',
                },
                color_loss: { label: 'Loss/Negative Values', help: 'Color used for losses, costs, and negative values' },
                color_warning: { label: 'Warnings', help: 'Color used for warnings and important notices' },
                color_info: { label: 'Informational', help: 'Color used for informational text and highlights' },
                color_essence: { label: 'Essences', help: 'Color used for essence drops and essence-related text' },
                color_tooltip_profit: {
                    label: 'Tooltip Profit/Positive',
                    help: 'Color for profit/positive values in tooltips (light backgrounds)',
                },
                color_tooltip_loss: {
                    label: 'Tooltip Loss/Negative',
                    help: 'Color for loss/negative values in tooltips (light backgrounds)',
                },
                color_tooltip_info: {
                    label: 'Tooltip Informational',
                    help: 'Color for informational text in tooltips (light backgrounds)',
                },
                color_tooltip_warning: {
                    label: 'Tooltip Warnings',
                    help: 'Color for warnings in tooltips (light backgrounds)',
                },
                color_text_primary: { label: 'Primary Text', help: 'Main text color' },
                color_text_secondary: { label: 'Secondary Text', help: 'Dimmed/secondary text color' },
                color_border: { label: 'Borders', help: 'Border and separator color' },
                color_gold: { label: 'Gold/Currency', help: 'Color used for gold and currency displays' },
                color_mirror: {
                    label: "Philosopher's Mirror",
                    help: "Color for the Philosopher's Mirror usage line in enhancement tooltips",
                },
                color_listing_price_1m: {
                    label: 'Listing Total: 1M+',
                    help: 'Color for market listing total prices of 1 million or more',
                },
                color_listing_price_100k: {
                    label: 'Listing Total: 100K+',
                    help: 'Color for market listing total prices of 100K or more',
                },
                color_listing_price_10k: {
                    label: 'Listing Total: 10K+',
                    help: 'Color for market listing total prices of 10K or more',
                },
                color_listing_price_low: {
                    label: 'Listing Total: <10K',
                    help: 'Color for market listing total prices under 10K',
                },
                color_accent: {
                    label: 'Script Accent Color',
                    help: 'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)',
                },
                color_remaining_xp: {
                    label: 'Remaining XP Text',
                    help: 'Color for remaining XP text below skill bars in left navigation',
                },
                color_xp_rate: {
                    label: 'XP Rate Text',
                    help: 'Color for XP/hr rate text on skill bars in left navigation',
                },
                color_hours_to_level: {
                    label: 'Hours to Level Text',
                    help: 'Color for "hours till next level" text in skill tooltips',
                },
                color_inv_count: {
                    label: 'Inventory Count Text',
                    help: 'Color for inventory count shown on action tiles and in the action detail panel',
                },
                color_invBadge_ask: {
                    label: 'Inventory Badge: Ask Price',
                    help: 'Color for Ask price badges on inventory items (seller asking price - better selling value)',
                },
                color_invBadge_bid: {
                    label: 'Inventory Badge: Bid Price',
                    help: 'Color for Bid price badges on inventory items (buyer bid price - instant-sell value)',
                },
                color_transmute: {
                    label: 'Transmutation Rates',
                    help: 'Color used for transmutation success rate percentages in Item Dictionary',
                },
                color_queueLength_known: {
                    label: 'Queue Length: Known Value',
                    help: 'Color for known queue lengths (when all visible orders are counted)',
                },
                color_queueLength_estimated: {
                    label: 'Queue Length: Estimated Value',
                    help: 'Color for estimated queue lengths (extrapolated from 20+ orders at same price)',
                },
                collectionFilters: { label: 'Collection Filters: Count-range, dungeon, and skilling-outfit filters' },
                collectionFavorites: { label: 'Collection Favorites: Star (★) items to mark and filter favorites' },
                collectionFavoritesSection: { label: 'Collection Favorites: Show favorites section at top of grid' },
                collectionFilters_skillingBadges: {
                    label: 'Show collection count badges on skilling action tiles',
                    help: 'Displays your collection count on skilling actions (open Collections once to populate counts)',
                },
            },
        },
    };

    /**
     * zh batch a — settings namespaces.
     * Split from the former single zh.js; values here are Simplified Chinese UI strings.
     */
    var batchA = {
        settingsSchema: {
            groups: {
                ironCow: { title: '铁牛模式' },
                general: { title: '通用设置' },
                actionBar: { title: '动作栏' },
                skillPageTiles: { title: '技能页面与图块' },
                actionPanel: { title: '动作面板' },
                actionQueue: { title: '动作队列' },
                alchemy: { title: '炼金' },
                missingMaterials: { title: '缺失材料与制作方案' },
                lootLog: { title: '战利品记录' },
                tooltips: { title: '物品提示框增强' },
                enhancementSimulator: { title: '强化模拟器设置' },
                enhancementTracker: { title: '强化追踪器' },
                riskOfRuin: { title: '破产风险' },
                marketplace: { title: '市场' },
                pricingProfit: { title: '定价与利润' },
                inventoryNetWorth: { title: '物品栏与净资产' },
                inventoryTabs: { title: '自定义物品栏标签' },
                skills: { title: '技能' },
                combat: { title: '战斗功能' },
                tasks: { title: '任务' },
                ui: { title: '界面与外观' },
                guild: { title: '公会' },
                house: { title: '房屋' },
                leaderboard: { title: '排行榜' },
                notifications: { title: '通知' },
                colors: { title: '颜色自定义' },
                collectionFilters: { title: '收藏筛选' },
            },
            // 强化装备档位下拉的共享标签（值来自 settings-schema 的 tiers）
            tierLabels: {
                cheese: '奶酪',
                verdant: '翠绿',
                azure: '蔚蓝',
                burble: '深紫',
                crimson: '绛红',
                rainbow: '彩虹',
                holy: '神圣',
                celestial: '天堂',
                philo: '哲学',
                speed: '速度',
                rarefind: '稀有发现',
                normal: '普通',
                refined: '精制',
                trainee: '见习',
                basic: '基础',
                advanced: '高级',
                expert: '专家',
                master: '大师',
                grandmaster: '宗师',
            },
            // 下拉选项中不可用项的后缀
            selectUnavailableSuffix: '（不可用）',
            settings: {
                ironCow_enabled: { label: '铁牛模式', help: '禁用所有市场与利润相关功能，用于无市场玩法。' },
                chatCommands: {
                    label: '启用聊天命令（/item、/wiki、/market）',
                    help: '在聊天框输入 /item、/wiki 或 /market 并加上物品名称。例如：/item radiant fiber',
                },
                chat_mentionTracker: {
                    label: '聊天中被提及时显示徽标',
                    help: '当有人在聊天中 @提及你时，在聊天标签上显示红色徽标',
                },
                chat_popOut: {
                    label: '启用聊天窗口弹出按钮',
                    help: '在聊天面板添加按钮，可在独立浏览器窗口中打开聊天，支持多频道分屏显示',
                },
                chatHistoryExtender: {
                    label: '聊天：扩展聊天历史记录',
                    help: '保留游戏从实时缓冲区移除的消息，使其继续显示在实时聊天上方',
                },
                chatHistoryExtender_maxHistory: { label: '聊天：每个标签保留的最大消息数' },
                notificationLog: {
                    label: '聊天：添加日志标签',
                    help: '在聊天面板添加日志标签，记录物品交易、升级、公会事件及其他游戏内通知',
                },
                notificationLog_maxEntries: {
                    label: '聊天：保留的最大通知数',
                    help: '每个角色保留的通知历史数量。标签中的筛选只改变显示内容，不影响存储内容。',
                },
                chat_24hrTimestamps: {
                    label: '聊天：重新格式化消息时间戳',
                    help: '使用你的市场日期/时间格式设置来重新格式化聊天消息时间戳，而不是使用浏览器默认格式',
                },
                altClickNavigation: {
                    label: '按住 Alt 点击物品，跳转制作/采集页面或物品词典',
                    help: '按住 Alt/Option 点击任意物品，可跳转到其制作/采集页面；若该物品不可制作，则跳转到物品词典',
                },
                collectionNavigation: {
                    label: '为收藏物品添加导航按钮',
                    help: '点击收藏物品时，添加“查看动作”和“物品词典”按钮',
                },
                queueMonitor: { label: '跨角色队列监视器', help: '在悬浮窗中显示其他角色的预计队列剩余时间' },
                characterActivityStatus: {
                    label: '角色选择：显示活动状态',
                    help: '在角色选择界面显示每个角色预计正在进行的活动，以及最早可能需要关注的时间点（动作/队列结束、材料不足或离线上限）',
                },
                actionBar_enabled: { label: '动作栏：启用动作栏显示' },
                actionBar_compactWidth: {
                    label: '动作栏：紧凑宽度（限制 800px）',
                    help: '将动作栏宽度限制为 800px，适合宽屏显示器。',
                },
                actionBar_showQueueCount: { label: '动作栏：队列/剩余数量' },
                actionBar_showActionDuration: { label: '动作栏：单次动作耗时（例如 14.94s/action）' },
                actionBar_showActionsPerHour: { label: '动作栏：动作数/时与物品数/时' },
                actionBar_showTimeRemaining: {
                    label: '动作栏：剩余时间显示',
                    options: {
                        both: '剩余时间和预计完成时刻',
                        relative: '仅剩余时间',
                        absolute: '仅预计完成时刻',
                        none: '均不显示',
                    },
                },
                actionBar_showRecycleTime: {
                    label: '动作栏：转化循环时间估算',
                    help: '显示计入转化动作中材料自我返还循环后的预计总耗时',
                },
                actionBar_showProfit: {
                    label: '动作栏：显示当前动作利润',
                    help: '显示当前动作（采集与生产）的利润/时和剩余利润',
                },
                actionPanel_liveCountdown: {
                    label: '动作栏：实时倒计时',
                    help: '将动作进度条上的静态时间替换为按秒跳动的实时倒计时',
                },
                actionPanel_showFilter: { label: '技能页面：动作筛选输入框' },
                actionPanel_showSort: { label: '技能页面：排序按钮' },
                actionPanel_showPricingMode: { label: '技能页面：定价模式按钮' },
                actionPanel_showCraftToggle: { label: '技能页面：制作切换按钮' },
                actionPanel_showSellTaxToggle: { label: '技能页面：出售税切换按钮' },
                actionPanel_showProfitPerHour_gathering: {
                    label: '动作页面：在采集方块上显示利润/时',
                    help: '在采集类动作方块上显示利润/时（采集、伐木等）',
                },
                actionPanel_showProfitPerHour_production: {
                    label: '动作页面：在生产方块上显示利润/时',
                    help: '在生产类动作方块上显示利润/时（制作、裁缝等）',
                },
                actionPanel_showExpPerHour_gathering: {
                    label: '动作页面：在采集方块上显示经验/时',
                    help: '在采集类动作方块上显示经验/时（采集、伐木等）',
                },
                actionPanel_showExpPerHour_production: {
                    label: '动作页面：在生产方块上显示经验/时',
                    help: '在生产类动作方块上显示经验/时（制作、裁缝等）',
                },
                actionPanel_hideNegativeProfit: {
                    label: '动作面板：隐藏亏损动作',
                    help: '隐藏利润/时为负、会造成亏损的动作',
                },
                inventoryCountDisplay: {
                    label: '动作面板：显示产出物品的当前物品栏数量',
                    help: '在动作方块和动作详情面板中显示当前拥有的产出物品数量',
                },
                actions_pinnedPage: {
                    label: '固定动作：启用固定动作页面与图钉图标',
                    help: '在左侧导航栏添加“固定”按钮，显示所有已固定的动作，并在动作方块上显示图钉图标。',
                },
                actionPanel_totalTime: { label: '动作面板：总时间、达到目标等级所需次数、经验/时' },
                actionPanel_totalTime_quickInputs: { label: '动作面板：快捷输入按钮（小时、数量预设、最大值）' },
                actionPanel_quickInputs_countPresets: {
                    label: '动作面板：自定义数量预设（以逗号分隔，例如 100,1000,1000000）',
                },
                actionPanel_quickInputs_hourPresets: {
                    label: '动作面板：自定义小时预设（以逗号分隔，例如 0.5,1,24,168,720）',
                },
                actionPanel_foragingTotal: { label: '动作面板：多产物采集的总利润' },
                actionPanel_outputTotals: {
                    label: '动作面板：在单次产出下方显示预期总产出',
                    help: '在动作输入框中输入数量后，显示计算得出的总量',
                },
                actionPanel_maxProduceable: {
                    label: '动作面板：在制作动作上显示最大可制作数量',
                    help: '根据当前物品栏显示可制作的物品数量',
                },
                actionPanel_showProfitDetail: {
                    label: '动作面板：显示利润明细',
                    help: '在采集、生产和炼金动作面板中显示利润明细区块',
                },
                actionPanel_showLevelProgress: {
                    label: '动作面板：显示等级进度',
                    help: '在动作面板中显示经验和等级进度估算',
                },
                actionPanel_showSpeedTime: {
                    label: '动作面板：显示动作速度与时间',
                    help: '在动作面板中显示速度明细、效率和总时间',
                },
                requiredMaterials: { label: '动作面板：显示所需材料总量与缺口', help: '输入数量后显示所需材料总量及缺口' },
                actionPanel_enhanceMatLimitProtections: {
                    label: '强化材料上限：计入保护物品',
                    help: '启用后，强化材料上限估算会将保护物品的可用数量计入考虑；关闭则仅根据强化材料本身估算上限。',
                },
                actionQueue: { label: '队列中的动作：显示总时间与完成时间' },
                actionQueue_showValue: { label: '队列中的动作：显示队列动作的利润/价值' },
                actionQueue_valueMode: {
                    label: '队列中的动作：价值计算模式',
                    help: '选择队列动作总价值的计算方式。“利润”显示扣除材料和饮品后的净收益；“预估价值”显示扣除市场税后的毛收入（始终为正）。',
                    options: {
                        profit: '总利润（收入－全部成本）',
                        estimated_value: '预估价值（税后收入）',
                    },
                },
                actionQueue_completionTimeStyle: {
                    label: '队列中的动作：完成时间显示方式',
                    help: '队列动作弹窗及悬浮提示中完成时间的显示方式',
                    options: {
                        absolute: '仅时钟时间（14:32 完成）',
                        relative: '仅累计时长（3 小时 40 分后完成）',
                        both: '两者都显示',
                    },
                },
                alchemy_profitDisplay: {
                    label: '炼金面板：显示利润计算器',
                    help: '根据成功率和市场价格，显示炼金动作的利润/时和利润/天',
                },
                alchemy_bestItems: {
                    label: '炼金面板：显示最佳物品按钮',
                    help: '添加按钮，可按每种炼金类型查看以利润或经验排序的物品。',
                },
                alchemy_transmuteHistory: {
                    label: '炼金面板：追踪并查看转化会话历史',
                    help: '记录转化会话，并在炼金面板的查看器标签页中显示历史记录',
                },
                alchemy_coinifyHistory: {
                    label: '炼金面板：追踪并查看兑换金币会话历史',
                    help: '记录兑换金币会话，并在炼金面板的查看器标签页中显示历史记录',
                },
                alchemy_decomposeHistory: {
                    label: '炼金面板：追踪并查看分解会话历史',
                    help: '记录分解会话，并在炼金面板的查看器标签页中显示历史记录',
                },
                alchemy_actionProtection: {
                    label: '炼金面板：保护物品类别，防止误炼金',
                    help: '当所选物品属于受保护类别时，炼金动作按钮将锁定 3 秒。炼金面板中会显示盾牌图标，用于配置受保护的类别。',
                },
                alchemyItemDimming: { label: '炼金面板：使需要更高等级的物品变暗' },
                actions_missingMaterialsButton: {
                    label: '在生产面板显示“缺失材料市场”按钮',
                    help: '在生产面板添加按钮，点击后打开市场并自动创建缺失材料的标签页',
                },
                actions_missingMaterialsButton_ignoreQueue: {
                    label: '计算缺失材料时忽略队列中的动作',
                    help: '启用后，缺失材料计算仅考虑当前动作请求，忽略队列中动作已预留的材料。默认关闭（会计入队列）。',
                },
                actions_budgetCalculator: {
                    label: '动作面板：预算计算器',
                    help: '在“缺失材料”按钮下方添加预算输入框。输入金币预算（例如 50m），即可计算按卖价买齐缺失的可交易材料后能生产的数量。',
                },
                actions_costSummary: {
                    label: '动作面板：显示成本摘要',
                    help: '针对所选生产数量，以 4 行精简对比显示成本：直接配方成本、缺失的直接材料、最佳制作方案与成品市场价格。',
                },
                actionPanel_bestCraftingPlan: {
                    label: '动作面板：显示最佳制作方案',
                    help: '逐层比较各材料的购买与制作成本，显示获得该制作物品的最便宜方式。',
                },
                actionPanel_craftingPlanBuyIntermediates: {
                    label: '动作面板：制作方案仅购买原材料',
                    help: '有配方的物品始终自行制作，仅从市场购买无法制作的原材料。',
                },
                actionPanel_craftingPlanNoProcessing: {
                    label: '动作面板：制作方案不加工中间材料',
                    help: '仅制作最终物品，所有子材料均从市场购买而不自行加工。',
                },
                actionPanel_craftingPlanTaskMode: {
                    label: '动作面板：制作方案任务模式',
                    help: '强制执行最后一步制作（以获得任务进度），但若直接购买中间材料更便宜则允许购买。',
                },
                actionPanel_craftingPlanTimeCost: {
                    label: '动作面板：制作方案时间成本',
                    help: '在决定购买还是制作时计入制作的时间成本，用你的金币/时价值判断制作是否值得。',
                },
                actionPanel_craftingPlanGoldPerHour: {
                    label: '动作面板：制作方案金币/时估值',
                    help: '你的时间价值（金币/时），用于判断自行制作中间材料是否划算。请设为你的典型每小时利润（例如 500000）。',
                },
                actionPanel_craftingPlanMatchQuantity: {
                    label: '动作面板：制作方案匹配动作数量',
                    help: '将最佳制作方案（购物清单、制作步骤、总量）按动作面板中输入的数量缩放，而不是始终按 1 份规划。',
                },
                actions_artisanMaterialMode: {
                    label: '缺失材料：工匠需求模式',
                    help: '选择建议购买材料时，如何计入工匠茶带来的材料减免。',
                    options: {
                        expected: '期望值（平均）',
                        'worst-case': '单次动作最差情况（每次制作向上取整）',
                        hybrid: '混合（不足 100 次动作向上取整，100 次及以上取平均）',
                    },
                },
                lootLogStats: { label: '战利品日志统计', help: '在战利品日志中显示总价值、平均用时和每日产出' },
                lootLogHistory: {
                    label: '战利品日志：保存并显示历史条目',
                    help: '保存战利品日志条目，并在战利品日志面板中将较旧条目显示在当前条目下方',
                },
                itemTooltip_prices: { label: '显示 24 小时平均市场价格' },
                itemTooltip_effectivePrices: {
                    label: '显示实际到手价（税后）',
                    help: '在物品提示框的卖价/买价旁，显示扣除 4% 市场税后实际到手的金币',
                },
                itemTooltip_decomposeValue: {
                    label: '显示分解价值',
                    help: '在价格行下方显示分解此物品可获得的市场价值（卖价/买价）。这只是组件的原始价值，未扣除催化剂/金币成本，也未计入 60% 的成功率，因此可直接与直接出售该物品的收益比较。',
                },
                itemTooltip_enhancingHourlyRate: {
                    label: '强化目标时薪（例如 50m）',
                    help: '在强化提示框中添加最低出售价：该价格可覆盖总成本，并让所花时间达到此时薪。留空则禁用。',
                },
                itemTooltip_enhancingHourlyRateTax: {
                    label: '最低出售价计入市场税',
                    help: '计入 4% 的市场卖家税，使按最低价挂单后税后仍能达到目标时薪',
                },
                itemTooltip_artisanPrices: {
                    label: '提示框价格按工匠茶减免调整',
                    help: '在动作面板查看配方时，调整总价以反映工匠茶减免后的实际材料成本',
                },
                itemTooltip_profit: { label: '显示生产成本与利润' },
                itemTooltip_detailedProfit: {
                    label: '在利润显示中显示详细材料明细',
                    help: '显示材料成本表格，包含卖价/买价、每小时动作次数和利润明细',
                },
                itemTooltip_multiActionProfit: {
                    label: '显示该物品所有动作的利润对比',
                    help: '高亮最佳利润/时，并在下方汇总其他可选动作（制作、兑换金币、分解、转化）',
                },
                itemTooltip_expectedValue: { label: '显示可开启容器的期望值' },
                expectedValue_showDrops: {
                    label: '期望值掉落显示',
                    options: {
                        'Top 5': '前 5',
                        'Top 10': '前 10',
                        All: '全部掉落',
                        None: '仅摘要',
                    },
                },
                expectedValue_respectPricingMode: { label: '期望值计算使用定价模式' },
                expectedValue_includeCowbells: { label: '期望值计算包含牛铃价值' },
                showConsumTips: { label: 'HP/MP 消耗品：恢复速度、性价比' },
                dungeonTokenTooltips: { label: '货币提示框：显示代币、封印、牛铃的商店价值' },
                itemTooltip_gathering: {
                    label: '显示采集来源与利润',
                    help: '显示可产出此物品的采集类动作（采集、伐木、挤奶）',
                },
                itemTooltip_gatheringRareDrops: {
                    label: '显示采集稀有掉落',
                    help: '显示采集区域中的稀有发现掉落（例如 Asteroid Belt 掉落的 Thread of Expertise）',
                },
                itemTooltip_abilityStatus: {
                    label: '显示能力书状态',
                    help: '在能力书提示框中显示能力是否已学习，以及当前等级/进度',
                },
                abilityTooltip_effectiveTiming: {
                    label: '显示实际冷却/施法时间（基于你的属性）',
                    help: '根据当前的能力急速、施法速度和攻击等级计算实际冷却/施法时间，与基础值不同时显示在能力提示框中。',
                },
                itemTooltip_enhancementMilestones: {
                    label: '显示强化里程碑（+5/+7/+10/+12）',
                    help: '在未强化装备的提示框中显示达到 +5、+7、+10 和 +12 所需的预期花费与经验',
                },
                itemTooltip_enhancementPath: {
                    label: '在已强化物品上显示强化路径',
                    help: '鼠标悬停在已强化物品（+1 至 +20）上时，显示最优强化路径的费用明细',
                },
                itemTooltip_pinTop: {
                    label: '将提示框固定在屏幕顶部中央',
                    help: '强制物品提示框始终显示在屏幕顶部中央，而不是悬停物品附近',
                },
                itemTooltip_hideInEnhanceSelector: {
                    label: '在强化物品选择器中隐藏提示框附加信息',
                    help: '在强化选择器中浏览物品时，隐藏注入的提示框内容（价格、利润、里程碑）',
                },
                itemDictionary_transmuteRates: {
                    label: '物品词典：显示转化成功率',
                    help: '在“转化自（炼金）”部分显示成功率百分比',
                },
                itemDictionary_transmuteIncludeBaseRate: {
                    label: '物品词典：转化百分比包含基础成功率',
                    help: '启用时显示总概率（基础成功率 × 掉落率）；禁用时显示条件概率（仅掉落率，与“转化成（炼金）”部分一致）',
                },
                enhanceSim: { label: '显示强化模拟器计算结果' },
                enhanceSim_showConsumedItemsDetail: {
                    label: '强化提示框：显示消耗物品的详细明细',
                    help: '启用后，在贤者之镜计算中显示每个消耗物品的基础/材料/保护费用明细',
                },
                enhanceSim_baseItemCraftingCost: {
                    label: '强化路径：制作成本更低时以其作为基础物品价格',
                    help: '启用后，强化路径计算中基础物品价格取制作成本与市场价格中的较低者，对卖价和买价两列分别独立应用。',
                },
                enhanceSim_autoTargetLevel: {
                    label: '强化：打开面板时自动填入目标等级（0 = 禁用）',
                    help: '设为非零值后，每次打开物品的强化面板都会自动将目标等级输入框设为该值，切换物品时也会重新应用。',
                },
                enhanceSim_autoProtectFrom: {
                    label: '强化：设置保护物品时自动填入最佳保护起点等级',
                    help: '启用后，每当槽位中放入保护物品，都会自动将保护起点等级输入框填为最佳（最便宜）的值。',
                },
                enhanceSim_autoDetect: {
                    label: '自动检测你的属性（关闭 = 使用下方设置）',
                    help: '大多数玩家应保持关闭，以查看符合实际的专业强化师费用',
                },
                enhanceSim_protectionMarketplaceButton: {
                    label: '保护物品选择器：显示“购买最便宜”市场按钮',
                    help: '在强化面板的保护物品选择弹窗中添加按钮，点击后跳转到市场购买最便宜的可用保护物品',
                },
                enhanceSim_enhancingLevel: { label: '强化技能等级', help: '默认 140（专业强化师等级）' },
                enhanceSim_houseLevel: { label: '天文台房屋房间等级', help: '默认 8（最高等级）' },
                enhanceSim_achievement: { label: '成就加成（+0.2%）', help: '计入强化成就带来的成功率加成' },
                enhanceSim_gear_enhancer: { label: '强化器' },
                enhanceSim_gear_gloves: { label: '手套' },
                enhanceSim_gear_top: { label: '上衣' },
                enhanceSim_gear_bottoms: { label: '下装' },
                enhanceSim_gear_neck: { label: '项链' },
                enhanceSim_gear_ring: { label: '戒指' },
                enhanceSim_gear_earring: { label: '耳环' },
                enhanceSim_gear_cape: { label: '披风' },
                enhanceSim_gear_guzzling: { label: '暴饮' },
                enhanceSim_gear_charm: { label: '护符' },
                enhanceSim_tea: {
                    label: '强化茶',
                    help: '强化茶可提供技能等级加成',
                    options: {
                        none: '无',
                        basic: '强化茶（+3）',
                        super: '超级强化茶（+6）',
                        ultra: '究极强化茶（+8）',
                    },
                },
                enhanceSim_blessedTea: { label: '祝福茶已激活', help: '专业强化师用它来减少尝试次数' },
                enhanceSim_communityBuff: { label: '社区增益', help: '强化速度社区增益。勾选 = 从游戏自动检测。' },
                enhancementTracker: { label: '启用强化追踪器', help: '追踪强化尝试次数、花费与统计数据' },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    label: '仅在强化界面显示追踪器',
                    help: '不在强化界面时隐藏追踪器',
                },
                enhancementXPH: {
                    label: '强化：经验/时计算器',
                    help: '根据当前属性，按预期经验/时对所有可强化物品排名',
                },
                enhancementXPH_maxLevel: { label: '强化经验/时：默认最高强化等级（1–20）' },
                enhancementXPH_protectFrom: { label: '强化经验/时：默认保护起点等级（0 = 不保护）' },
                riskOfRuin: {
                    label: '启用破产风险计算器',
                    help: '新增独立计算器，估算在达到目标地下城宝箱数量、炼金转化次数或强化等级之前金币归零的概率。',
                },
                riskOfRuin_trials: {
                    label: '破产风险：蒙特卡洛试验次数',
                    help: '试验次数越多，概率估算越精确，但计算速度越慢。',
                },
                sellQueue: {
                    label: '出售队列（Shift+右键点击物品栏物品）',
                    help: '按住 Shift 右键点击物品栏物品，即可打开市场并为该物品创建标签页；物品售罄后标签页自动关闭。',
                },
                networkAlert: { label: '无法获取市场价格数据时显示提醒' },
                marketFilter: { label: '市场：按等级、职业、槽位筛选' },
                marketSort: {
                    label: '市场：按利润对物品排序',
                    help: '新增按钮，可按利润/时对市场物品排序；没有利润数据（仅掉落获得）的物品排在最后。',
                },
                fillMarketOrderPrice: { label: '自动以最优价格填入市场订单' },
                market_autoFillSellStrategy: {
                    label: '自动填充出售价格策略',
                    help: '创建卖单时，选择与当前最优卖价持平还是低其一档',
                    options: {
                        match: '与最优卖价持平',
                        undercut: '低 1 金币（最优卖价 - 1）',
                    },
                },
                market_autoFillBuyStrategy: {
                    label: '自动填充购买价格策略',
                    help: '创建买单时，选择高于、持平或低于当前最优买价',
                    options: {
                        outbid: '高 1 金币（最优买价 + 1）',
                        match: '与最优买价持平',
                        undercut: '低 1 金币（最优买价 - 1）',
                    },
                },
                market_autoClickMax: {
                    label: '在卖单窗口自动点击最大按钮',
                    help: '打开卖单窗口时，自动点击数量栏中的“最大”按钮',
                },
                market_quickInputButtons: {
                    label: '市场：订单窗口中的快捷输入按钮',
                    help: '在购买/出售窗口新增 10、100、1000 的预设数量按钮',
                },
                market_quickInputButtons_presets: {
                    label: '市场：自定义快捷输入预设值',
                    help: '以英文逗号分隔的预设值（例如 50,500,5000）。留空则使用默认值（10、100、1000），最多 8 个值。',
                },
                market_multiplierButtons: {
                    label: '市场：订单窗口中的 ÷2 和 ×2 按钮',
                    help: '在购买/出售窗口的价格与数量栏中新增 ÷2 和 ×2 按钮',
                },
                market_showOwnedInBuyModal: {
                    label: '市场：在购买窗口显示持有数量',
                    help: '在“立即购买”和“购买挂单”弹窗中显示当前持有该物品的数量',
                },
                market_marketplaceShortcuts: {
                    label: '市场：在物品菜单显示“市场操作”按钮',
                    help: '在物品菜单新增“市场操作”下拉菜单，包含立即出售、立即购买及挂单快捷方式',
                },
                market_visibleItemCount: {
                    label: '市场：在物品上显示物品栏数量',
                    help: '浏览市场时显示你拥有的每种物品的数量',
                },
                market_visibleItemCountOpacity: {
                    label: '市场：未持有物品的不透明度',
                    help: '当某物品持有数量为零时，物品方块的透明程度',
                },
                market_visibleItemCountIncludeEquipped: {
                    label: '市场：计入已装备物品',
                    help: '显示数量时计入当前已装备的物品',
                },
                market_showListingPrices: {
                    label: '市场：在单条挂单上显示价格',
                    help: '在“我的挂单”表格中为每条挂单显示最优订单价格与总价值',
                },
                market_collectableListingsToTop: {
                    label: '市场：将可领取的挂单置顶于“我的挂单”',
                    help: '有可领取内容的挂单会被移到顶部，无需滚动即可看到“全部领取”收取了什么；手动按列排序后会覆盖此行为，直到清除排序为止',
                },
                market_listingRefreshNavigator: {
                    label: '市场：显示循环浏览“我的挂单”的刷新/下一个按钮',
                    help: '在“我的挂单”新增“刷新”按钮，用于打开第一条挂单的订单簿；每条挂单页面再提供“下一个”按钮以切换到下一条，最后以“返回我的挂单”结束',
                },
                market_tradeHistory: {
                    label: '市场：显示个人交易历史',
                    help: '在市场中显示你各物品最近一次的购买/出售价格',
                },
                market_tradeHistoryComparisonMode: {
                    label: '市场：交易历史对比模式',
                    help: '即时：与即时购买/出售价格对比。挂单：与买单/卖单对比。',
                    options: {
                        instant: '即时',
                        listing: '挂单',
                    },
                },
                market_listingPricePrecision: { label: '市场：挂单价格小数精度', help: '挂单价格显示的小数位数' },
                market_showListingAge: {
                    label: '市场：在“我的挂单”显示挂单时长',
                    help: '在“我的挂单”标签页中显示每条挂单创建至今的时长（例如“3h 45m”）',
                },
                market_showTopOrderAge: {
                    label: '市场：在“我的挂单”显示最优竞争订单时长',
                    help: '显示你每条挂单对应的最优竞争订单的估算时长（需启用“估算挂单时长”功能）',
                },
                market_showEstimatedListingAge: {
                    label: '市场：在订单簿中显示估算时长',
                    help: '通过挂单 ID 插值估算所有市场挂单的创建时间',
                },
                market_listingAgeFormat: {
                    label: '市场：挂单时长显示格式',
                    help: '选择挂单创建时间的显示方式',
                    options: {
                        elapsed: '已用时间（例如“3h 45m”）',
                        datetime: '日期/时间（例如“01-13 14:30”）',
                    },
                },
                market_listingTimeFormat: {
                    label: '时间显示格式',
                    help: '用于市场挂单、动作完成时间和聊天时间戳的时间格式',
                    options: {
                        '24hour': '24 小时制（14:30）',
                        '12hour': '12 小时制（2:30 PM）',
                    },
                },
                market_listingDateFormat: {
                    label: '日期显示格式',
                    help: '用于市场挂单、动作完成时间和聊天时间戳的日期格式',
                    options: {
                        'MM-DD': 'MM-DD（01-13）',
                        'DD-MM': 'DD-MM（13-01）',
                    },
                },
                market_showOrderTotals: {
                    label: '市场：在页眉显示订单总计',
                    help: '在金币下方的页眉区域显示买单（BO）、卖单（SO）和未领取金币（💰）',
                },
                market_showHistoryViewer: {
                    label: '市场：在设置中显示历史查看器按钮',
                    help: '在设置面板新增“查看市场历史”按钮，用于查看和导出全部市场挂单历史',
                },
                market_showPhiloCalculator: {
                    label: '市场：在设置中显示 Philo Gamba 计算器按钮',
                    help: '在设置面板新增“Philo Gamba”按钮，用于计算转化为贤者之石的投资回报率',
                },
                market_showQueueLength: {
                    label: '市场：显示队列长度估算',
                    help: '在购买/出售按钮下方显示最优价格处的总数量；估算值（同价位 20 个以上订单）以不同颜色显示。',
                },
                market_depthCapEnabled: {
                    label: '市场：显示出售深度上限（破产风险）',
                    help: '根据上一次破产风险计算结果，显示订单簿能够有利润地吸纳当前查看物品的动作次数；此计算忽略市场可交易区间下限，因为该数据未在游戏数据中公开。',
                },
                marketData_outlierGuardEnabled: {
                    label: '防护异常市场挂单',
                    help: '适用于 Toolasha 读取市场价格的所有场景（利润计算器、净资产、升级顾问等）。当实时买价/卖价大幅偏离游戏官方参考市场价值的区间时，Toolasha 会改用参考价值，并在受影响的数值旁标注 ⚠ 以提示发生了替换。',
                },
                marketData_outlierBandMultiplier: {
                    label: '异常值区间倍数',
                    help: '当实时价格高于或低于参考价值超过该倍数时视为异常值（例如 3 表示超出参考价值的 1/3 至 3 倍区间）。仅适用于参考数据集中实际收录的物品。',
                },
                profitCalc_pricingMode: {
                    label: '利润计算定价模式',
                    options: {
                        conservative: '购买：卖价 / 出售：买价（即时购买 / 即时出售）',
                        hybrid: '购买：卖价 / 出售：卖价（即时购买 / 耐心出售）',
                        optimistic: '购买：买价 / 出售：卖价（耐心购买 / 耐心出售）',
                        patientBuy: '购买：买价 / 出售：买价（耐心购买 / 即时出售）',
                    },
                },
                profitCalc_pricingNaming: {
                    label: '定价模式命名方式',
                    help: '以“即时购买 / 即时出售”的形式显示定价模式，而不是“购买：卖价 / 出售：买价”',
                },
                profitCalc_keyPricingMode: {
                    label: '钥匙定价模式',
                    help: '在提示框、净资产和战斗收入计算中如何为地下城钥匙估值：卖价（即时购买）、买价（耐心购买），或最低价（比较直接购买与自行制作的费用，制作时使用“最佳制作方案”引擎，并按你利润计算定价模式的购买基准计价）。',
                    options: {
                        ask: '卖价（即时购买）',
                        bid: '买价（耐心购买）',
                        cheapest: '最低价（购买或制作）',
                    },
                },
                profitCalc_customPriceOverrides: {
                    label: '自定义价格覆盖',
                    help: '为特定物品设置自定义购买/出售价格，在利润计算中覆盖市场价格。',
                },
                profitCalc_craftUpgradeItems: {
                    label: '利润：升级材料在制作成本更低时使用制作成本',
                    help: '启用后，若升级材料的制作成本更低，则使用制作成本代替市场价格，并将制作时间计入利润/时的计算。',
                },
                profitCalc_excludeSellTax: {
                    label: '利润：排除出售税（自用生产）',
                    help: '启用后，净利润/每小时利润将假设你保留生产的物品而不出售，因此不从产出价值中扣除市场出售税。适用于地下城钥匙、食物/饮品、迷宫消耗品，或任何你不打算出售的物品。这会使利润数值高于实际出售产出物所得，启用期间会显示警告标志。',
                },
                offlineProgressEconomics: {
                    label: '离线进度：显示收入/成本/利润摘要',
                    help: '在原生“欢迎回来”弹窗中加入收入/成本/利润摘要（含每日预测），使用你的“价格与利润”设置计算。',
                },
                networth: { label: '右上角：显示金币数量', help: '在页面顶部的总等级旁显示当前金币数量' },
                invWorth: {
                    label: '物品栏下方：显示净资产明细',
                    help: '在物品栏面板下方显示总净资产，并按类别（装备、物品栏、挂单、房屋、能力）列出明细',
                },
                invSort: { label: '按价值排序物品栏物品' },
                invSort_showBadges: { label: '按卖价/买价排序时显示堆叠价值徽标' },
                invSort_badgesOnNone: {
                    label: '选择“无”排序时的徽标类型',
                    options: {
                        None: '无',
                        Ask: '卖价',
                        Bid: '买价',
                    },
                },
                invSort_netOfTax: { label: '徽标数值显示扣除市场税后的净值' },
                invSort_sortEquipment: { label: '启用装备类别的排序' },
                invBadgePrices: { label: '在物品图标上显示价格徽标', help: '在物品栏物品上显示单个物品的卖价和买价' },
                invCategoryTotals: { label: '在物品栏显示类别总计', help: '显示物品栏中每个类别内所有物品的市场总价值' },
                networth_pricingMode: {
                    label: '净资产定价模式',
                    help: '卖价显示耐心挂单可获得的金额，买价显示立即出售可获得的金额。',
                    options: {
                        ask: '卖价（耐心出售价值）',
                        bid: '买价（即时清算价值）',
                    },
                },
                networth_highEnhancementUseCost: {
                    label: '高强化物品使用强化成本计价',
                    help: '高强化物品（+13 及以上）的市场价格不可靠，改用计算得出的强化成本代替。',
                },
                networth_highEnhancementMinLevel: {
                    label: '使用成本计价的最低强化等级',
                    help: '从该强化等级开始不再信任市场价格',
                    options: {
                        10: '+10 及以上',
                        11: '+11 及以上',
                        12: '+12 及以上',
                        13: '+13 及以上（推荐）',
                        15: '+15 及以上',
                    },
                },
                networth_includeCowbells: {
                    label: '净资产中包含牛铃',
                    help: '牛铃不可交易，但其价值基于“10个牛铃袋”的市场价格计算',
                },
                networth_includeTaskTokens: {
                    label: '净资产中包含任务代币',
                    help: '根据任务商店宝箱的期望值估算任务代币价值，关闭则将其排除在净资产之外。',
                },
                networth_abilityBooksAsInventory: {
                    label: '将能力书计入物品栏（流动资产）',
                    help: '将能力书从固定资产移至流动资产的物品栏价值中，适合打算出售能力书时使用。',
                },
                networth_historyChart: {
                    label: '启用净资产历史图表',
                    help: '每小时记录一次净资产快照，并在“总净资产”旁显示图表图标。关闭后将停止记录并隐藏图表按钮。',
                },
                autoAllButton: {
                    label: '开启战利品箱时自动点击“全部”按钮',
                    help: '打开可开启容器（箱子、宝箱、密藏）时自动点击“全部”按钮',
                },
                autoAllButton_excludeSeals: {
                    label: '自动点击“全部”：跳过“卷轴”类物品',
                    help: '启用后，迷宫中的各类卷轴不会被自动开启',
                },
                openableAnalytics: {
                    label: '开箱分析：追踪实际与期望价值对比及幸运值',
                    help: '显示你开启的宝箱/箱子/密藏的实际价值、期望价值和幸运值，并提供按角色区分的分析视图，包含本次会话与历史记录',
                },
                openableAnalytics_sidePanel: {
                    label: '开箱分析：显示当前/历史侧边面板',
                    help: '在“已开启战利品”窗口左侧固定一个面板，显示本次开启及历史记录的已开启数量、收入、利润、幸运值、预期收入和与预期的对比',
                },
                inventoryTabs: {
                    label: '自定义物品栏标签：启用',
                    help: '在角色面板中添加 Toolasha 标签页，你可以在其中把物品栏物品整理到个人标签中。',
                },
                inventoryTabs_showUnorganized: {
                    label: '自定义物品栏标签：显示“未整理”分区',
                    help: '显示“未整理”区域，包含所有未分配到任何标签的物品。',
                },
                inventoryTabs_categoryAddAll: {
                    label: '自定义物品栏标签：添加类别时加入全部物品',
                    help: '将某个类别添加到标签时，加入该类别中的所有物品（包括物品栏中没有的物品）。关闭后仅添加当前物品栏中已有的物品。',
                },
                inventoryTabs_defaultTab: {
                    label: '自定义物品栏标签：默认显示 Toolasha 标签页',
                    help: '隐藏原生“物品栏”标签，并在每次打开角色面板时自动激活 Toolasha 标签页。',
                },
                inventoryTabs_tileGap: {
                    label: '自定义物品栏标签：物品间距（像素）',
                    help: 'Toolasha 标签页中物品格之间的像素间距。',
                },
                inventoryTabs_loadoutIncludeConsumables: {
                    label: '自定义物品栏标签：从配装添加时包含食物和饮品',
                    help: '从配装向标签添加物品时，同时包含食物和饮品物品。',
                },
                inventoryTabs_topTabPriority: {
                    label: '自定义物品栏标签：物品仅在最上层标签中显示',
                    help: '当一个物品出现在多个标签中时，仅在包含该物品的最上层标签中显示。关闭后，收起某个标签会将其物品释放给下层标签。',
                },
                simulateScrollEffects: {
                    label: '技能：在计算中模拟缺失的卷轴效果',
                    help: '启用后，利润/经验/速度计算会显示假设所选卷轴生效时的结果。可通过按钮配置默认卷轴，也可在“配装”面板中为单个配装单独设置覆盖。',
                },
                xpTracker: {
                    label: '左侧栏：在技能条上显示经验/时速率',
                    help: '在导航面板的每个技能条下方实时显示经验/时速率',
                },
                xpTracker_timeTillLevel: {
                    label: '技能提示框：显示距下一等级的剩余时间',
                    help: '在技能悬停提示框中显示距下一等级的预计剩余时间（基于当前经验/时）',
                },
                skillRemainingXP: {
                    label: '左侧栏：显示距下一等级所需经验',
                    help: '在技能进度条下方显示升到下一等级所需的经验值',
                },
                skillRemainingXP_blackBorder: {
                    label: '剩余经验：添加黑色文字描边以提高可见度',
                    help: '为经验文字添加黑色描边/阴影，使其在进度条上更清晰易读',
                },
                skillbook: { label: '能力书：显示达到目标等级所需的书籍数量（在能力书物品词典窗口中）' },
                drinkTimer: {
                    label: '饮品计时器：在消耗品栏显示饮品剩余时间',
                    help: '在采集/生产、炼金和强化动作面板的消耗品槽位下方，显示饮品剩余供应时间及队列覆盖情况。',
                },
                drinkTimer_warningThreshold: {
                    label: '饮品计时器：警告阈值（小时）',
                    help: '当剩余供应时间低于此小时数时，饮品时间显示黄色警告。',
                },
                skillingOptimizer: { label: '生活技能模拟器/优化器：在角色面板启用优化器标签页' },
                combatScore: { label: '资料面板：显示装备评分' },
                abilitiesTriggers: {
                    label: '资料面板：显示能力与触发器',
                    help: '在资料下方显示已装备的能力、消耗品及其战斗触发条件',
                },
                characterCard: { label: '资料面板：显示“查看卡片”按钮', help: '添加按钮，可在外部查看器中打开角色卡' },
                eliteAchievementReminder: {
                    label: '资料面板：显示精英成就提醒图标',
                    help: '若玩家尚未完成精英成就，则在其名字旁显示 ✉️ 图标；点击可预填一条私聊消息。',
                },
                eliteAchievementReminderMessage: {
                    label: '精英成就提醒：私聊消息',
                    help: '点击精英成就提醒图标时预填入聊天框的消息内容。',
                },
                dungeonTracker: {
                    label: '地下城追踪器：实时进度追踪',
                    help: '通过队伍消息中经服务器验证的时长追踪地下城记录',
                },
                dungeonTrackerUI: {
                    label: '显示地下城追踪器界面面板',
                    help: '显示地下城进度面板，包含波次计数、通关记录和统计数据',
                },
                dungeonTrackerChatAnnotations: {
                    label: '在队伍聊天中显示通关时间',
                    help: '为“钥匙数量”消息添加彩色计时标注（快则绿色，慢则红色）',
                },
                labyrinthTracker: {
                    label: '迷宫最高等级追踪器',
                    help: '追踪每种怪物类型已击败的最高推荐等级，并在自动化标签页中显示',
                },
                labyrinthShopPrices: {
                    label: '迷宫商店：显示市场价格',
                    help: '在迷宫商店标签页中为可交易物品显示卖价/买价市场价格',
                },
                labyrinthClearRate: { label: '迷宫通关率计算器', help: '在迷宫生产房间的方块上显示预计通关时间和成功率' },
                labyrinthMissingSuppliesButton: {
                    label: '迷宫：显示“购买缺少的补给”按钮',
                    help: '在补给区域旁添加一个按钮，打开市场并显示低于携带上限的火把/寿衣/信标标签',
                },
                labyrinthRecommendTargetRate: {
                    label: '迷宫：建议目标通关率（%）',
                    help: '迷宫跳过阈值建议所使用的默认目标通关率',
                },
                labyrinthRecommendSimHours: {
                    label: '迷宫：每步建议的模拟小时数',
                    help: '建议计算中二分查找每一步所使用的默认战斗模拟小时数',
                },
                labyrinthLiveProgress: {
                    label: '迷宫：显示实时通关概率',
                    help: '在进行中的迷宫生产/强化房间内显示实时通关概率',
                },
                combatBattleCounter: {
                    label: '战斗时在当前动作面板显示战斗/波次计数',
                    help: '在左上角动作面板中显示普通区域的“战斗 #N”或地下城的“第 N 波”',
                },
                combatSummary: {
                    label: '战斗摘要：为战斗信息面板添加速率统计',
                    help: '为当前查看单位的战斗信息面板添加遭遇数/时、收入和经验速率',
                },
                combatSim: { label: '战斗模拟器', help: '模拟战斗遭遇，估算经验/时、死亡次数和消耗品用量' },
                labSim: { label: '迷宫模拟器', help: '模拟迷宫通关，估算各技能及战斗的表现' },
                combatSim_defaultHours: { label: '战斗模拟器：默认小时数（单区域）', help: '单区域模拟的默认时长（小时）' },
                combatSim_allZonesDefaultHours: {
                    label: '战斗模拟器：默认小时数（全部区域）',
                    help: '全部区域模拟的默认时长（小时）',
                },
                combatSim_seekDefaultHours: {
                    label: '战斗模拟器：默认小时数（探寻）',
                    help: '“探寻最佳来源”模拟的默认时长（小时）',
                },
                combatSim_decimalMinutes: {
                    label: '战斗模拟器：以小数分钟显示完成时间',
                    help: '将平均完成时间显示为“X.XX min”而非“Xm Ys”',
                },
                combatSim_defaultLoadout: {
                    label: '战斗模拟器：默认配装',
                    help: '战斗估算默认使用的配装，而非当前已装备的装备',
                    options: { _empty: '当前装备' },
                },
                combatSim_autoEstimate: {
                    label: '战斗模拟器：在任务卡片上自动运行估算',
                    help: '任务卡片出现时，使用默认配装自动运行战斗估算',
                },
                combatSim_maxThreads: {
                    label: '战斗模拟器：最大线程数',
                    help: '模拟使用的最大 Web Worker 线程数（0 = 自动，使用所有可用核心）',
                },
                combatSim_upgradeSkipSkillingRooms: {
                    label: '战斗模拟器：升级顾问 - 跳过生产类房屋房间',
                    help: '房屋房间升级模式：跳过模拟没有战斗属性加成的房间（酿造坊、花园等）以节省模拟时间。这些房间仍会像所有房间一样获得微小的智慧/稀有发现加成，因此关闭此选项也能查看它们（通常可忽略不计）的金币/经验和金币/利润数值。',
                },
                combatStats: {
                    label: '战斗统计：在战斗面板显示统计标签页',
                    help: '在战斗面板添加统计按钮，显示收入、利润、消耗品花费、经验和掉落详情',
                },
                combatStats_runwayWarningThreshold: {
                    label: '战斗统计：消耗品可用时长警告阈值（小时）',
                    help: '高亮预计在此小时数内耗尽的战斗消耗品。设为 0 可关闭警告。',
                },
                combatStats_showLootLuck: {
                    label: '战斗统计：显示战利品幸运值对比',
                    help: '在统计面板中显示实际与预期掉落率/利润的对比，以及战利品幸运值差值。',
                },
                combatConsumableTimer: {
                    label: '战斗消耗品计时器：战斗中显示食物/饮品剩余时间',
                    help: '战斗期间，在消耗品列表中每个生效中的战斗食物/饮品图标下方显示预计剩余可用时间。需启用“战斗统计”，该估算数据来自其消耗追踪器。',
                },
                combatStatsChatMessage: {
                    label: '战斗统计：聊天消息格式',
                    help: '在统计面板中按住 Ctrl 点击玩家卡片时使用的消息格式。点击“编辑模板”进行自定义。',
                },
                taskProfitCalculator: { label: '显示采集/生产任务的总利润' },
                taskSpeedBreakdown: {
                    label: '在任务上显示可展开的速度与时间明细',
                    help: '在任务卡片上显示可展开的动作速度、效率和用时明细。',
                },
                taskCombatEstimate: {
                    label: '在战斗任务上显示战斗估算',
                    help: '在战斗任务卡片上显示配装下拉菜单和估算按钮。',
                },
                taskEfficiencyRating: {
                    label: '显示任务效率评分（每时代币/利润）',
                    help: '根据预计完成时间显示颜色分级的效率评分。',
                },
                taskMaterialsIndicator: {
                    label: '在生产任务上显示材料可用情况',
                    help: '显示以当前物品栏可完成多少次任务动作。',
                },
                taskEfficiencyRatingMode: {
                    label: '效率算法',
                    help: '选择按任务代币产出还是按总利润评分。',
                    options: {
                        tokens: '每小时任务代币',
                        gold: '每小时任务利润',
                    },
                },
                taskEfficiencyGradient: { label: '使用相对渐变颜色', help: '根据当前可见任务的相对情况为效率评分着色。' },
                taskQueuedIndicator: {
                    label: '在任务卡片上显示“已排队”标记',
                    help: '当任务对应的动作在你的动作队列中时，在任务卡片上显示状态消息',
                },
                taskRerollTracker: {
                    label: '追踪任务重掷花费',
                    help: '追踪重掷每个任务所花费的金币/牛铃（实验性功能，可能导致界面卡顿）',
                },
                taskMapIndex: { label: '在任务上显示战斗区域索引号' },
                taskIcons: { label: '在任务卡片上显示视觉图标', help: '在任务卡片上显示半透明的物品/怪物图标' },
                taskIconsDungeons: {
                    label: '在战斗任务上显示地下城图标',
                    help: '显示该怪物出现在哪些地下城中（需启用任务图标）',
                },
                taskSorter_autoSort: { label: '打开任务面板时自动排序任务', help: '打开任务面板时按技能类型自动排序任务' },
                taskSorter_hideButton: { label: '隐藏任务排序按钮', help: '隐藏任务排序按钮，同时保留自动排序功能' },
                taskSorter_sortMode: {
                    label: '任务排序模式',
                    help: '点击任务排序时的排序方式。“完成所需时间”将最快完成的任务排在最前，战斗任务和已完成任务排在最后；“保护”将未受保护的任务排在最前。',
                    options: {
                        skill: '技能 / 区域',
                        time: '完成所需时间',
                        protection: '保护（未受保护优先）',
                    },
                },
                taskInventoryHighlighter: {
                    label: '启用任务物品栏高亮按钮',
                    help: '添加按钮，用于淡化当前非战斗任务不需要的物品栏物品',
                },
                taskStatistics: {
                    label: '在任务面板显示任务统计按钮',
                    help: '在任务面板添加统计按钮，显示溢出时间、预期奖励和完成时间估算',
                },
                taskClaimCollector: {
                    label: '将领取奖励按钮移至任务列表顶部',
                    help: '将所有领取奖励按钮集中堆叠到任务列表顶部，这样你可以反复点击同一位置领取所有已完成的任务',
                },
                taskGoMerge: {
                    label: '点击前往时合并重复任务',
                    help: '点击某个任务的前往按钮时，将同一动作所有进行中任务的所需数量合并为一个预填数值',
                },
                taskRerollProtection: {
                    label: '任务重掷保护',
                    help: '保护特定任务，防止意外重掷。受保护的任务显示绿色高亮，重掷前需再次点击确认。任务面板中会出现盾牌图标，用于配置受保护的区域。',
                },
                taskRerollProtection_hideHighlight: {
                    label: '任务重掷保护：隐藏绿色高亮',
                    help: '移除受保护任务的绿色描边/光效，同时保留重掷确认功能。',
                },
                taskAutoReroll: {
                    label: '任务自动重掷提醒',
                    help: '用红色边框和提醒徽标高亮你想要重掷的任务。可通过任务面板中的目标图标按角色配置。',
                },
                taskTokenThreshold: {
                    label: '按任务代币奖励标记需要重掷的任务',
                    help: '当任务的任务代币奖励超出可配置临界值（低于或高于）时，用与自动重掷相同的红色边框和提醒徽标高亮该任务。此功能不会自动点击或重掷任何内容。可通过任务面板中的图标按角色配置临界值和方向。',
                },
                draggableModals: {
                    label: '可拖动的弹窗',
                    help: '使游戏弹出窗口可拖动。每种弹窗类型的位置会跨会话保留。',
                },
                formatting_useKMBFormat: {
                    label: '数字格式模式',
                    help: '控制整个界面中大数字的显示方式',
                    options: {
                        full: '完整（1,250,000）',
                        threshold: '超过 4 位后缩写（1,250K）',
                        compact: '始终缩写（1.25M）',
                    },
                },
                formatting_precision: {
                    label: '缩写精度（小数位数）',
                    help: '数字使用 K/M/B 后缀缩写时显示的小数位数',
                    options: {
                        1: '1 位（1.2M）',
                        2: '2 位（1.25M）',
                        3: '3 位（1.250M）',
                        4: '4 位（1.2500M）',
                    },
                },
                ui_externalLinks: {
                    label: '左侧栏：显示外部工具链接',
                    help: '添加战斗模拟器、市场追踪器、强化计算器和 Milkonomy 的快捷链接',
                },
                hideLabyrinthBadge: { label: '左侧栏：隐藏迷宫提示徽标' },
                hideGuildBadge: { label: '左侧栏：隐藏公会通知徽标' },
                hideNavBarGlow: {
                    label: '左侧栏：隐藏当前技能光效',
                    help: '移除游戏左侧导航栏中当前激活技能图标上的橙色脉动光效动画。',
                },
                tabReorder: {
                    label: '角色面板：拖放重排标签顺序',
                    help: '拖动标签以重新排列物品栏、Toolasha、装备、房屋、能力和配装的顺序，刷新后仍会保留。',
                },
                expPercentage: { label: '左侧栏：显示技能经验百分比' },
                combatLevelProgress: {
                    label: '左侧栏：显示小数战斗等级',
                    help: '根据当前整数技能等级显示未四舍五入的战斗等级公式值（例如 133.2）。游戏原生侧栏显示时会向下取整为整数。',
                },
                itemIconLevel: { label: '图标左下角：显示装备等级' },
                loadoutEnhancementDisplay: { label: '配装面板：在装备图标上显示拥有的最高强化等级' },
                loadoutSnapshot: {
                    label: '配装：在利润/动作计算中使用已保存的配装',
                    help: '当你把一个动作加入队列时，Toolasha 会使用该技能当前已保存的游戏配装（技能默认 → 全技能默认 → 匹配的已保存配装 → 当前已装备）来预测其经验、时间和利润。“使用最高强化等级”会根据你当前拥有的物品解析。若已保存的装备不可用，预测会回退到当前已装备的配置；若已保存的食物/饮品不可用，配装不会失效，其缺失槽位会被省略。禁用此项将始终使用当前已装备的装备进行预测。',
                },
                showsKeyInfoInIcon: { label: '钥匙图标左下角：显示区域索引' },
                mapIndex: { label: '战斗区域：显示区域索引号' },
                guildXPTracker: {
                    label: '随时间追踪公会与成员经验',
                    help: '从 WebSocket 消息中记录公会和成员经验数据，用于公会面板的经验/时计算。',
                },
                guildXPDisplay: {
                    label: '在公会面板显示经验/时统计',
                    help: '在公会概览、成员和公会排行榜标签页上显示经验/时速率、排名和每周图表。若使用此功能，请禁用独立的 Guild XP/h 用户脚本。',
                },
                guildIdleDisplay: {
                    label: '公会概览：显示空闲成员列表',
                    help: '在公会概览标签页上显示当前处于空闲状态（未执行任何动作）的公会成员列表。',
                },
                guildTrialSignupDisplay: {
                    label: '公会试炼：显示未报名成员列表',
                    help: '显示哪些公会成员尚未报名本周的生活技能和战斗试炼。',
                },
                guildTrialWhisperTemplate: {
                    label: '公会试炼：点击名字时的私聊消息',
                    help: '点击未报名成员的名字时预填到聊天框中的消息。使用 {name} 代表该玩家的名字。',
                },
                guildMembersActivityTab: {
                    label: '公会成员：活动列的显示位置',
                    help: '控制活动列显示的位置。“仅贡献标签页”会隐藏状态标签页上的原生列，并改在贡献标签页上显示。',
                    options: {
                        status: '仅状态标签页（原生）',
                        contributions: '仅贡献标签页',
                        both: '两个标签页都显示',
                    },
                },
                guildMembersShowGameMode: {
                    label: '公会成员：显示游戏模式列',
                    help: '显示 MC/IC/LC 游戏模式列（状态标签页）。',
                },
                guildMembersShowJoined: {
                    label: '公会成员：显示加入日期列',
                    help: '显示每位成员加入公会的日期（状态标签页）。',
                },
                guildMembersShowLastXPH: {
                    label: '公会成员：显示最近经验/时列',
                    help: '显示由 Toolasha 追踪的最近经验/时（贡献标签页）。',
                },
                guildMembersShowLastDayXPH: {
                    label: '公会成员：显示最近一天经验/时列',
                    help: '显示由 Toolasha 追踪的 24 小时平均经验/时（贡献标签页）。',
                },
                guildCreditValue: {
                    label: '公会商店：显示每信用点的金币成本表',
                    help: '在每个公会信用点兑换弹窗中插入成本效率表，按你的利润定价模式从最便宜开始排序。',
                },
                guildTokenValueComparison: {
                    label: '公会商店：显示公会代币金币价值对比',
                    help: '在信用点兑换成本表中添加公会代币行，并在公会代币提示框中添加公会信用点价值表，通过通往每种信用点类型最便宜的可交易物品路线显示金币/代币价值。',
                },
                guildCreditExchangeAdvisor: {
                    label: '公会商店：显示兑换顾问（出售 → 回购对比）',
                    help: '当所选物品不是最便宜的选项时，显示出售该物品并回购最优物品能否获得更多信用点（计入 4% 卖家税）。',
                },
                guildShrineUpgradePlanner: {
                    label: '公会商店：显示神殿升级规划器',
                    help: '在公会信用点兑换面板添加神殿升级规划器，显示从当前等级升级到目标等级所需的信用点和代币总成本。',
                },
                houseUpgradeCosts: { label: '显示升级成本，并对比市场价格与物品栏' },
                leaderboardXPTracker: {
                    label: '随时间从排行榜追踪玩家经验',
                    help: '从排行榜 WebSocket 消息中记录玩家经验，用于排行榜面板的经验/时计算。',
                },
                leaderboardXPDisplay: {
                    label: '在排行榜显示经验/时列',
                    help: '在玩家排行榜面板添加最近经验/时和最近一天经验/时列。',
                },
                notifiEmptyAction: { label: '动作队列为空时发送浏览器通知', help: '仅在游戏页面保持打开时有效' },
                color_profit: { label: '利润/正值', help: '用于利润、收益和正值的颜色' },
                color_loss: { label: '亏损/负值', help: '用于亏损、成本和负值的颜色' },
                color_warning: { label: '警告', help: '用于警告和重要提示的颜色' },
                color_info: { label: '信息提示', help: '用于信息文本和高亮的颜色' },
                color_essence: { label: '精华', help: '用于精华掉落和精华相关文本的颜色' },
                color_tooltip_profit: { label: '提示框 利润/正值', help: '提示框中利润/正值的颜色（浅色背景）' },
                color_tooltip_loss: { label: '提示框 亏损/负值', help: '提示框中亏损/负值的颜色（浅色背景）' },
                color_tooltip_info: { label: '提示框 信息提示', help: '提示框中信息文本的颜色（浅色背景）' },
                color_tooltip_warning: { label: '提示框 警告', help: '提示框中警告的颜色（浅色背景）' },
                color_text_primary: { label: '主要文本', help: '主要文本颜色' },
                color_text_secondary: { label: '次要文本', help: '暗淡/次要文本颜色' },
                color_border: { label: '边框', help: '边框与分隔线颜色' },
                color_gold: { label: '金币/货币', help: '用于金币和货币显示的颜色' },
                color_mirror: { label: '贤者之镜', help: '强化提示框中贤者之镜用量行的颜色' },
                color_listing_price_1m: { label: '挂单总额：100 万以上', help: '市场挂单总价为 100 万或以上时的颜色' },
                color_listing_price_100k: { label: '挂单总额：10 万以上', help: '市场挂单总价为 10 万或以上时的颜色' },
                color_listing_price_10k: { label: '挂单总额：1 万以上', help: '市场挂单总价为 1 万或以上时的颜色' },
                color_listing_price_low: { label: '挂单总额：低于 1 万', help: '市场挂单总价低于 1 万时的颜色' },
                color_accent: {
                    label: '脚本主题色',
                    help: '脚本界面元素（按钮、标题、区域编号、经验百分比等）的主要主题色',
                },
                color_remaining_xp: { label: '剩余经验文本', help: '左侧导航栏中技能条下方剩余经验文本的颜色' },
                color_xp_rate: { label: '经验速率文本', help: '左侧导航栏技能条上经验/时速率文本的颜色' },
                color_hours_to_level: { label: '升级所需时间文本', help: '技能提示框中“距下一等级所需小时数”文本的颜色' },
                color_inv_count: { label: '物品栏数量文本', help: '动作方块和动作详情面板中显示的物品栏数量的颜色' },
                color_invBadge_ask: {
                    label: '物品栏徽标：卖价',
                    help: '物品栏物品上卖价徽标的颜色（卖家挂价，对应较好的出售价值）',
                },
                color_invBadge_bid: {
                    label: '物品栏徽标：买价',
                    help: '物品栏物品上买价徽标的颜色（买家出价，对应即时出售价值）',
                },
                color_transmute: { label: '转化成功率', help: '物品词典中转化成功率百分比所使用的颜色' },
                color_queueLength_known: {
                    label: '队列长度：已知值',
                    help: '已知队列长度（所有可见订单均已计数时）的颜色',
                },
                color_queueLength_estimated: {
                    label: '队列长度：估算值',
                    help: '估算队列长度（根据同一价格下 20 个以上订单推算）的颜色',
                },
                collectionFilters: { label: '收藏筛选：数量范围、地下城和生活技能套装筛选' },
                collectionFavorites: { label: '收藏夹：为物品加星（★）以标记和筛选收藏' },
                collectionFavoritesSection: { label: '收藏夹：在网格顶部显示收藏区' },
                collectionFilters_skillingBadges: {
                    label: '在生活技能动作方块上显示收藏数量徽标',
                    help: '在生活技能动作上显示你的收藏数量（请先打开一次收藏页面以填充数量）',
                },
            },
        },
        settings: {
            tabLabel: 'Toolasha',
            searchPlaceholder: '搜索设置…',
            clearButton: '清除',
            copySettingsToOthersButton: '复制设置到其他角色',
            fetchPricesButton: '🔄 获取最新价格',
            resetButton: '重置为默认值',
            exportButton: '导出设置',
            importButton: '导入设置',
            allOffButton: '全部关闭',
            restoreButton: '恢复',
            pformanceButton: 'PFormance',
            refreshNotice: '部分设置需刷新页面后生效',
            toolashaTabTitle: (p) => `⚙️ Toolasha ${p.version ? `v${p.version} ` : ''}设置（刷新后生效）`,
            nativeSettingsTabTitle: '设置',
            copySettingsToTitle: '复制设置至',
            cancelButton: '取消',
            copySettingsConfirmButton: '复制设置',
            characterFallbackName: (p) => `角色 ${p.id}`,
            fetchingStatus: '⏳ 获取中…',
            updatedStatus: '✅ 已更新！',
            failedStatus: '❌ 失败',
            errorStatus: '❌ 错误',
            onlyOneCharacterAlert: '你只有一个角色，该角色的设置已保存。',
            syncSuccessAlert: (p) => `设置已复制到 ${p.count} 个角色！`,
            syncFailureAlert: (p) => `复制设置失败：${p.error}`,
            unknownErrorFallback: '未知错误',
            resetConfirm: '将所有设置重置为默认值？此操作无法撤销。',
            resetDoneAlert: '设置已重置为默认值，请刷新页面。',
            messageTextLabel: '消息文本：',
            clickVariableHint: '点击变量以插入到光标位置：',
            saveButton: '保存',
            editTemplateButton: '编辑模板',
            addTextButton: '+ 添加文本',
            enterTextPrompt: '请输入文本：',
            restoreDefaultButton: '恢复默认',
            resetTemplateConfirm: '将模板重置为默认值？这会丢弃当前模板。',
            templateItemsHeader: '模板项目（拖动以重新排序）：',
            addVariableHeader: '添加变量：',
            removeTooltip: '移除',
            customPriceOverridesTitle: '自定义价格覆盖',
            customPriceOverridesHelp:
                '为物品设置自定义购买/出售价格。留空则使用市场价格。被覆盖的价格会在利润显示中标注 *。',
            itemSearchPlaceholder: '搜索物品…',
            itemLabel: '物品',
            enhLabel: '强化',
            buyPriceLabel: '购买价',
            sellPriceLabel: '出售价',
            noOverridesMessage: '暂无自定义价格覆盖，请使用上方搜索栏添加物品。',
            clearAllButton: '全部清除',
            manageOverridesButton: (p) => `管理覆盖项${p.count > 0 ? `（${p.count}）` : ''}`,
            configureButtonDefault: '配置…',
            unknownSettingType: (p) => `未知类型：${p.type}`,
            ironCowTitle: '铁牛模式',
            ironCowDescActive:
                '禁用所有市场与利润相关功能。<span style="color:#d4900a;font-weight:600;">已开启——市场功能已锁定。</span>',
            ironCowDescInactive: '禁用所有市场与利润相关功能，用于无市场玩法。',
            enhanceSimStatsHeader: '计算属性统计',
            enhanceSimEffectiveLevel: '有效等级：',
            enhanceSimToolSuccess: '工具成功率：',
            enhanceSimSpeed: '速度：',
            enhanceSimDrinkConc: '饮品浓度：',
            enhanceSimRareFind: '稀有发现：',
            enhanceSimExperience: '经验：',
            enhanceSimStatsUnavailable: '统计数据不可用（游戏数据未加载）',
            importSuccessAlert: (p) =>
                `设置导入成功（已导入 ${p.imported} 项${p.skipped > 0 ? `，跳过了其他角色的 ${p.skipped} 项` : ''}），请刷新页面。`,
            importFailedFormatAlert: '导入设置失败，请检查文件格式。',
            importFailedAlert: '导入设置失败。',
            clearAllOverridesConfirm: '移除所有自定义价格覆盖？',
        },
    };

    /**
     * zh batch b — combat namespaces.
     * Split from the former single zh.js; values here are Simplified Chinese UI strings.
     */
    var batchB = {
        combatSimUi: {
            panelTitle: '战斗模拟器',
            tabConfigure: '配置',
            tabResults: '结果',
            tabSeek: '探寻',
            tabUpgrade: '升级',
            zoneLabel: '区域',
            tierLabel: '层级',
            hoursLabel: '小时',
            simulateButton: '模拟',
            simAllZonesLabel: '模拟全部区域',
            simAllSoloLabel: '模拟全部（单人）',
            skipWorseTiersLabel: '跳过较差层级',
            skipWorseTiersTooltip: '若某区域更高层级的经验/时和利润/时均低于上一层级，则停止模拟该区域的更高层级',
            loadingLoadout: '正在加载配装...',
            stopButton: '停止',
            searchItemPlaceholder: '搜索物品...',
            playerLabel: '玩家',
            modeLabel: '模式',
            equipmentOption: '装备',
            abilityLevelsOption: '能力等级',
            abilitySwapsOption: '能力替换',
            houseRoomsOption: '房屋房间',
            incrementLevelsOption: '+等级',
            targetLevelOption: '目标等级',
            levelsToAddTitle: '为每个能力增加的等级数',
            absoluteTargetLevelTitle: '所有能力的绝对目标等级',
            exampleLevelPlaceholder: '例如 80',
            skipBackLabel: '跳过背部',
            analyzeButton: '分析',
            statusSelectZoneSimulate: '请选择区域，然后点击“模拟”。',
            dungeonZonePrefix: '[D] {{name}}',
            checkAllLabel: '全选',
            colTotalXpPerHr: '总经验/时',
            colProfitPerDay: '利润/天',
            colStamina: '体力',
            colIntelligence: '智力',
            colAttack: '攻击',
            colMelee: '近战',
            colDefense: '防御',
            colRanged: '远程',
            colMagic: '魔法',
            colZone: '区域',
            colTier: 'T',
            colEncPerHr: '遭遇/时',
            colDeathsPerHr: '死亡/时',
            colOom: 'OOM',
            colRevPerHr: '收益/时',
            colCostPerHr: '花费/时',
            colProfitPerHr: '利润/时',
            noLabel: '否',
            lessThanTenthPercent: '<0.1%',
            statusNoItemSelected: '未选择物品，请输入名称并从列表中选择。',
            statusNoGameData: '暂无游戏数据。',
            noZonesDropItem: '没有区域掉落该物品。',
            statusNoCharacterData: '暂无角色数据。',
            statusSeeking: '正在 {{zoneCount}} 个区域/层级中探寻 {{itemName}}... {{elapsed}}',
            statusSeekComplete: '探寻完成（用时 {{elapsed}}）：为 {{itemName}} 找到 {{count}} 个来源',
            statusSeekCancelled: '探寻已取消。',
            statusSeekError: '探寻出错：{{message}}',
            noZonesDropItemNamed: '没有区域掉落 {{itemName}}。',
            colItemsPerHr: '物品/时',
            colCostPerDrop: '花费/掉落',
            bestSourcesFor: '{{itemName}} 的最佳来源',
            statusSearchSeek: '搜索战斗掉落物品，然后点击“探寻”。',
            statusSelectPlayerAnalyze: '请选择一名玩家，然后点击“分析”。',
            statusNoResultsYet: '暂无结果，请先运行一次模拟。',
            statusSimulationCancelled: '模拟已取消。',
            statusNoZoneSelected: '未选择区域。',
            warningMaxPlayers: '非地下城区域最多支持 3 名玩家（当前为 {{count}} 名），请移除部分玩家后继续。',
            partyInfoLabel: (p) => `队伍（已加载 ${p.loaded} 人${p.missing > 0 ? `，缺失 ${p.missing} 人` : ''}）`,
            soloLabel: '单人',
            statusSimulating: '正在模拟（{{partyInfo}}）... {{elapsed}}',
            currentGearLabel: '当前装备',
            pricingModeConservative: '购买：卖价 / 出售：买价',
            pricingModeHybrid: '购买：卖价 / 出售：卖价',
            pricingModeOptimistic: '购买：买价 / 出售：卖价',
            pricingModePatientBuy: '购买：买价 / 出售：买价',
            missingMembersNote: ' | 缺失：{{names}}（请打开其资料页）',
            statusSimulationComplete:
                '模拟完成（用时 {{elapsed}}）：{{hours}} 小时 · {{partyInfo}} · 定价：{{modeLabel}}{{missingNote}}',
            statusSimulationError: '模拟出错：{{message}}',
            statusNoZonesSelected: '未选择任何区域。',
            statusSimulatingZones: '正在模拟 {{count}} 个区域... {{elapsed}}',
            statusAllZonesComplete: '全部区域模拟完成（用时 {{elapsed}}）：{{count}} 个区域，每个 {{hours}} 小时',
            overviewHeading: '概览',
            manaRunOutLabel: '法力耗尽',
            yesLabel: '是',
            runOutRatioLabel: '耗尽占比',
            debuffOnLevelGapLabel: '等级差减益',
            partyDpsLabel: '队伍 DPS',
            colDps: 'DPS',
            dungeonsCompletedPerHrLabel: '地下城通关/时',
            dungeonsFailedPerHrLabel: '地下城失败/时',
            totalCompletedFailedLabel: '总通关/失败次数',
            durationDecimalMinutes: '{{value}} 分钟',
            durationMinutesSeconds: '{{minutes}}分{{seconds}}秒',
            durationSeconds: '{{seconds}}秒',
            avgCompletionTimeLabel: '平均通关时间',
            maxWaveReachedLabel: '最高到达波次',
            xpPerHrHeading: '经验/时',
            totalLabel: '总计',
            dropsHeading: '掉落',
            perHrHeader: '/时',
            perDayHeader: '/天',
            goldPerHrHeader: '金币/时',
            goldPerDayHeader: '金币/天',
            totalGoldHeader: '金币总计',
            totalRevenueLabel: '总收益',
            consumableCostsHeading: '消耗品花费',
            costPerDayHeader: '花费/天',
            totalCostHeader: '总花费',
            totalExpensesLabel: '总支出',
            keyCostsHeading: '钥匙花费',
            totalKeyCostsLabel: '钥匙总花费',
            netProfitHeading: '净利润',
            profitLabel: '利润',
            wipeEventsHeading: '团灭事件（{{count}}）',
            wipeEventLabel: '团灭 #{{number}} — 第 {{wave}} 波 · {{time}} 秒',
            abilityAutoAttack: '自动攻击',
            abilityDot: '持续伤害',
            abilityPhysicalThorns: '物理反伤',
            abilityElementalThorns: '元素反伤',
            abilityRetaliation: '反击',
            combatLogLine: '{{source}} 对 {{target}} 施放 {{ability}} → 造成 {{damage}}，生命变化 {{hpChange}}',
            playersHpLabel: '玩家生命：{{list}}',
            comparisonHeading: '对比（{{count}} 次模拟）',
            baselineLabel: '基准：',
            colScenario: '场景',
            colEph: 'EPH',
            colSuccess: '成功率',
            deleteResultTooltip: '删除结果',
            removeFromComparisonTooltip: '从对比中移除',
            addSimToComparisonOption: '+ 添加模拟到对比...',
            playerFallbackName: '玩家 {{number}}',
            statusSelectZoneConfigureFirst: '请先在“配置”标签页中选择区域。',
            statusNoPlayerData: '暂无玩家数据，请先配置一次模拟。',
            statusAnalysisCancelled: '分析已取消。',
            statusAnalysisComplete: '分析完成，共评估 {{count}} 个升级项。',
            statusAnalysisFailed: '分析失败：{{message}}',
            noUpgradeCandidates: '未找到可升级项，请确认装备已配置。',
            colUpgrade: '升级项',
            colCost: '花费',
            colGoldPerDps: '金币/0.1% DPS',
            colGoldPerExp: '金币/0.1% 经验',
            colGoldPerProfit: '金币/0.1% 利润',
            notAvailableLabel: '不适用',
            notCombatRelevantLabel: '与战斗无关',
            colExpPerHr: '经验/时',
            colDph: 'DPH',
            baselineSummaryLine: '基准：DPS {{dps}} | 经验 {{exp}} | 利润 {{profit}} | EPH {{eph}} | DPH {{dph}}',
            statusRunningBaseline: '正在运行基准模拟...',
            statusBaselineComplete: '基准模拟完成',
            statusComputingBaseline: '正在计算基准...',
            statusSimulatingUpgrade: (p) => `模拟中：${p.name}`,
            statusEvaluating: (p) => `评估中：${p.name}`,
            statusBaselineWinRate: (p) => `基准：${p.winRate}%`,
            statusBaselineClearRate: (p) => `基准：${p.clearRate}%`,
            tabButtonLabel: '战斗模拟',
        },
        labSim: {
            panelTitle: '迷宫模拟器',
            tabConfigure: '配置',
            tabMaxLevel: '最高等级',
            tabUpgrade: '升级',
            tabSkilling: '生产',
            monsterLabel: '怪物',
            levelLabel: '等级',
            hoursLabel: '小时',
            teaLabel: '茶',
            coffeeLabel: '咖啡',
            foodLabel: '食物',
            crateNone: '无',
            crateBasic: '基础',
            crateAdvanced: '高级',
            crateExpert: '专家',
            loadingLoadout: '正在加载配装...',
            labyrinthBuffsHeader: '迷宫增益',
            simulateButton: '模拟',
            findMaxLabel: '查找最高等级',
            findMaxTooltip: '在指定胜率阈值下，二分查找可击败的最高等级',
            stopButton: '停止',
            playerLabel: '玩家',
            analyzeButton: '分析',
            roomLevelLabel: '房间等级',
            calculateButton: '计算',
            analyzeUpgradesButton: '分析升级',
            allSkillsOption: '所有技能',
            skillWoodcutting: '伐木',
            skillForaging: '采集',
            skillMilking: '挤奶',
            skillCooking: '烹饪',
            skillBrewing: '酿造',
            skillCheesesmithing: '制奶酪',
            skillCrafting: '制作',
            skillTailoring: '裁缝',
            skillAlchemy: '炼金',
            skillEnhancing: '强化',
            statusDefault: '请在“配置”中选择怪物，然后使用“最高等级”或“升级”进行模拟。',
            statusSimCancelled: '迷宫模拟已取消。',
            playerFallbackName: (p) => `玩家 ${p.index}`,
            buffsUnavailable: '暂无角色数据。',
            buffGroupCombat: '战斗',
            buffGroupSkilling: '生产',
            buffGroupOther: '其他',
            buffDamage: '伤害',
            buffAtkSpeed: '攻速',
            buffCastSpeed: '施法速度',
            buffCritRate: '暴击率',
            buffSpeed: '速度',
            buffEfficiency: '效率',
            buffSuccess: '成功率',
            buffDouble: '双倍',
            buffExperience: '经验',
            buffCooldown: '冷却',
            buffTorch: '火炬',
            buffShroud: '遮罩',
            buffBeacon: '信标',
            buffAutomation: '自动化',
            statusLoadoutUnavailable: (p) => `所选战斗配装不可用：${p.name}，请选择其他配装或当前装备。`,
            statusSelectMonsterFirst: '请先选择一个怪物。',
            statusNoGameData: '暂无游戏数据。',
            statusNoCharacterData: '暂无角色数据。',
            progressLevelStep: (p) => `等级 ${p.level} — ${p.winRate}%（第 ${p.step}/${p.total} 步）`,
            statusSimFailed: (p) => `模拟失败：${p.error}`,
            resultMonsterLevel: (p) => `${p.monster} — 等级 ${p.level}`,
            winRateLabel: '胜率：',
            encountersLabel: '遭遇次数：',
            deathsLabel: '死亡次数：',
            simTimeLabel: '模拟用时：',
            completedIn: (p) => `完成用时 ${p.time}`,
            statusSimComplete: (p) => `模拟完成 — 等级 ${p.level}，胜率 ${p.winRate}%。`,
            resultFindMaxTitle: (p) => `${p.monster} — 最高等级查找结果`,
            levelValue: (p) => `等级 ${p.level}`,
            atLevelSuffix: (p) => `等级 ${p.level}`,
            recommendedSkipLabel: '建议跳过：',
            completedInSteps: (p) => `完成用时 ${p.time}（共 ${p.steps} 步）`,
            statusMaxBeatableLevel: (p) => `可击败的最高等级：${p.level}（胜率 ${p.winRate}%）。`,
            statusSelectMonsterConfigureTab: '请先在“配置”标签页中选择一个怪物。',
            statusNoPlayerData: '暂无玩家数据。',
            progressCurrentTotalDesc: (p) => `${p.current} / ${p.total}：${p.description}`,
            statusUpgradeAnalysisFailed: (p) => `升级分析失败：${p.error}`,
            noUpgradeCandidates: '未找到可升级项。',
            xpAbbreviation: 'XP',
            tokenUpgradesHeader: '代币升级',
            colUpgrade: '升级项',
            colTokens: '代币',
            colRate: '比率',
            colDelta: '增量',
            colTokensPerPct: '代币/1%',
            goldUpgradesHeader: '金币升级',
            colCost: '花费',
            colWinRate: '胜率',
            colGoldPerPct: '金币/1%',
            statusUpgradeCandidatesAnalyzed: (p) => `已分析 ${p.count} 个升级项。`,
            skillLoadoutsHeader: '技能配装',
            currentGearOption: '当前装备',
            unavailableSuffix: (p) => `${p.name}（不可用）`,
            allSuffix: (p) => `${p.name}（全部技能）`,
            statusNoCharacterDataWaitEditor: '暂无角色数据，请等待编辑器加载完成。',
            statusSkillingLoadoutUnavailable: (p) => `所选生产配装不可用：${p.names}，请选择其他配装或当前装备。`,
            skillingRoomLevelTitle: (p) => `生产房间等级 ${p.level}`,
            avgClearLabel: '平均通关率：',
            colSkill: '技能',
            colLevel: '等级',
            colEffLevel: '有效等级',
            colSuccess: '成功率',
            colClear: '通关',
            colActions: '次数',
            statusSkillingClearRatesCalculated: (p) => `已计算等级 ${p.level} 的生产通关率。`,
            statusSkillingUpgradeAnalysisFailed: (p) => `生产升级分析失败：${p.error}`,
            statusNoSkillingUpgradeCandidates: '未找到生产升级项。',
            colClearRate: '通关率',
            equipmentUpgradesHeader: '装备升级',
            baselineAvgClear: '基准平均通关率：',
            statusSkillingUpgradeCandidatesAnalyzed: (p) => `已分析 ${p.count} 个生产升级项。`,
            tabButtonLabel: '迷宫模拟',
        },
        simEditor: {
            loadoutUnavailableBlocked: (p) => `配装“${p.name}”不可用。在选择其他配装或当前装备之前，模拟将被阻止。`,
            loadoutUnavailablePreviousKept: (p) => `配装“${p.name}”不可用，已保留之前的模拟结果。`,
            failedToLoadCharacterData: '角色数据加载失败。',
            noPlayersLoaded: '尚未加载玩家。',
            importPlayerButton: '+ 导入玩家',
            pasteExportPlaceholder: '在此粘贴战斗模拟导出 JSON...',
            pasteExportDataFirst: '请先粘贴导出数据。',
            invalidFormatCombatSimExport: '格式无效，请粘贴战斗模拟导出 JSON。',
            invalidFormatShykaiExport: '格式无效，请粘贴 Shykai 导出 JSON。',
            removePlayerTooltip: '移除玩家',
            importFromShykaiTooltip: '从 Shykai 导出字符串导入玩家',
            importPlusButton: '+ 导入',
            pasteShykaiExportPlaceholder: '在此粘贴 Shykai 导出 JSON...',
            loadoutLabel: '配装',
            currentGearOption: '— 当前装备 —',
            loadoutOptionLabel: (p) => `${p.name}${p.allSkills ? '（全部技能）' : ''}${p.unavailable ? '（不可用）' : ''}`,
            resetToCurrentButton: '重置为当前',
            slotHead: '头部',
            slotBody: '身体',
            slotLegs: '腿部',
            slotFeet: '脚部',
            slotHands: '手部',
            slotMainHand: '主手',
            slotTwoHand: '双手',
            slotOffHand: '副手',
            slotPouch: '袋子',
            slotBack: '背部',
            slotNeck: '项链',
            slotEarrings: '耳环',
            slotRing: '戒指',
            slotCharm: '护符',
            equipmentSectionHeader: (p) => `装备（${p.count} 件）`,
            addButton: '添加',
            changeButton: '更换',
            abilitiesSectionHeader: (p) => `能力（已装备 ${p.count} 个）`,
            abilitySpecialSlotLabel: '特殊',
            abilitySlotLabel: (p) => `槽位 ${p.index}`,
            levelAbbreviation: 'Lv',
            consumablesSectionHeader: (p) => `消耗品（${p.food} 食物，${p.drinks} 饮品）`,
            drinksHeader: '饮品',
            drinkLabelSingular: '饮品',
            categoryHpOverTime: '持续回血',
            categoryHpInstant: '即时回血',
            categoryMpOverTime: '持续回蓝',
            categoryMpInstant: '即时回蓝',
            categoryOther: '其他',
            categoryAttack: '攻击',
            categoryDefense: '防御',
            categoryRanged: '远程',
            categoryMagic: '魔法',
            categoryGeneral: '通用',
            categoryMelee: '近战',
            selectFoodHeader: '选择食物',
            selectDrinkHeader: '选择饮品',
            searchPlaceholder: '搜索...',
            emptyClearSlotOption: '空（清空槽位）',
            emptyRemoveSlotOption: '空（移除槽位）',
            levelTag: (p) => `Lv ${p.level}`,
            inUseLabel: '（使用中）',
            moreItemsSuffix: (p) => `...还有 ${p.count} 个`,
            selectEquipmentSlotHeader: (p) => `选择${p.slot}`,
            specialAbilityLabel: '特殊能力',
            abilitySlotNumberLabel: (p) => `能力槽位 ${p.index}`,
            selectAbilityHeader: (p) => `选择${p.slotLabel}`,
            skillStamina: '体力',
            skillIntelligence: '智力',
            skillAttack: '攻击',
            skillMelee: '近战',
            skillDefense: '防御',
            skillRanged: '远程',
            skillMagic: '魔法',
            skillLevelsSectionHeader: '技能等级',
            houseRoomsSectionHeader: '房屋房间',
            activeCountLabel: (p) => `${p.count} 个已激活`,
            shrinesSectionHeader: '神殿',
            achievementsSectionHeader: '成就',
            achievementModeCurrent: '当前',
            achievementModeNone: '无',
            achievementModeCustom: '自定义',
            noCombatRelevantAchievementTiers: '当前游戏数据中未找到与战斗相关的成就等级。',
            achievementSimulationOnlyNote: '仅用于模拟，不会更改你的账号。',
            achievementTierSummary: (p) => `${p.completed} / ${p.total}${p.buffText ? ` · ${p.buffText}` : ''}`,
            tokenSuccessRateLabel: '成功率',
            tokenDoubleProgressLabel: '双倍进度',
            tokenUpgradesSectionHeader: '代币升级',
            communityProdEfficiencyLabel: '生产效率',
            communityEnhancingSpeedLabel: '强化速度',
            communityGatheringQtyLabel: '采集数量',
            communityBuffsSectionHeader: '社区增益',
            noneLabel: '无',
            itemSwapLabel: (p) => `${p.from} → ${p.to}`,
            enhancementChangeLabel: (p) => `${p.slot} +${p.from}→+${p.to}`,
            abilityLevelChangeLabel: (p) => `${p.name} Lv ${p.from}→${p.to}`,
            skillLevelChangeLabel: (p) => `${p.label} ${p.from}→${p.to}`,
            consumableChangeLabel: (p) => `${p.prefix} ${p.index}：${p.from}→${p.to}`,
            tokenDoubleProgressShort: '双倍',
            tokenChangeLabel: (p) => `代币 ${p.label} ${p.from}→${p.to}`,
            communityProdEffShort: '效率',
            communityEnhSpdShort: '强化',
            communityGathQtyShort: '采集',
            communityExpShort: '经验',
            communityBuffChangeLabel: (p) => `社区 ${p.label} ${p.from}→${p.to}`,
            loadoutChangesSummary: (p) => `${p.prefix}：${p.changes}`,
        },
        combatStatsUi: {
            statisticsButtonLabel: '统计',
            popupTitle: '战斗统计',
            resetConsumableTrackingButton: '重置消耗品追踪',
            resetConsumableTrackingConfirm: '确定重置消耗品追踪吗？这将清除所有已追踪的消耗数据并重新开始。',
            marketDataUnavailableAlert: '市场数据不可用，请重试。',
            noCombatDataAlert: '暂无战斗数据，请先开始一场战斗。',
            connectionInterruptedBanner: '⚠️ 本次会话期间连接曾中断，部分事件可能已丢失，因此这些数据可能不完整。',
            defaultChatMessageTemplate: '战斗统计：{income} 收入 | {dailyProfit} 利润/天 | {exp} 经验/时',
            runwayNoUsage: '暂无消耗记录',
            runwayOutNow: '已耗尽',
            runwayOverOneYear: '>1年',
            runwayMinutes: (p) => `~${p.minutes}分`,
            runwayHoursMinutes: (p) => `~${p.hours}时${p.minutes}分`,
            runwayHours: (p) => `~${p.hours}时`,
            runwayDays: (p) => `~${p.days}天`,
            runwayDaysHours: (p) => `~${p.days}天${p.hours}时`,
            durationFallback: '0秒',
            durationLabel: '持续时间：',
            encountersPerHourLabel: '遭遇/时：',
            incomeLabel: '收入：',
            dailyIncomeLabel: '每日收入：',
            consumableCostsLabel: '消耗品花费：',
            dailyConsumableCostsLabel: '每日消耗品花费：',
            lowestRunwayLabel: '最低续航：',
            keyCostsLabel: '钥匙花费：',
            dailyKeyCostsLabel: '每日钥匙花费：',
            dailyProfitLabel: '每日利润：',
            actualRateLabel: '实际速率：',
            expectedRateLabel: '预期速率：',
            lootLuckLabel: '掉落幸运值：',
            actualProfitPerDayLabel: '实际利润/天：',
            expectedProfitPerDayLabel: '预期利润/天：',
            totalExpLabel: '总经验：',
            expPerHourLabel: '经验/时：',
            deathCountLabel: '死亡次数：',
            deathsPerHrLabel: '死亡/时：',
            perDaySuffix: (p) => `${p.value}/天`,
            perHourSuffix: (p) => `${p.value}/时`,
            lootLuckSampleHeading: (p) => `掉落幸运值样本 · ${p.count} 次遭遇 · ${p.elapsed}`,
            recentSampleLabel: '近期样本',
            actualPerDayColumn: '实际/天',
            expectedPerDayColumn: '预期/天',
            valueDeltaColumn: '价值 Δ',
            noValuedItemsYetMessage: '暂无已计价物品',
            partialCouldNotValueNote: (p) => `⚠ 数据不完整 - ${p.count} 个物品无法计价`,
            pricingNoteLabel: (p) => `定价：${p.label}`,
            chestColumnHeader: '宝箱',
            receivedColumnHeader: '获得数量',
            evEachColumnHeader: '单件期望值',
            totalEvColumnHeader: '期望总值',
            avgQtyColumnHeader: '平均数量',
            evColumnHeader: '期望值',
            keyPricingLabelBid: '买价（耐心购买）',
            keyPricingLabelCheapest: '最低价（购买或制作）',
            keyPricingLabelAsk: '卖价（即时购买）',
            consumedColumnHeader: '已消耗',
            priceColumnHeader: '价格',
            remainingLabel: (p) => `剩余：${p.runway}`,
            trackingSeconds: (p) => `${p.seconds}秒`,
            trackingMinutes: (p) => `${p.minutes}分钟`,
            trackingHoursMinutes: (p) => `${p.hours}时${p.minutes}分`,
            trackingHours: (p) => `${p.hours}时`,
            trackingMonthsDays: (p) => `${p.months}个月${p.days}天`,
            trackingMonths: (p) => `${p.months}个月`,
            trackingDaysHours: (p) => `${p.days}天${p.hours}时`,
            trackingDays: (p) => `${p.days}天`,
            noConsumptionYetNote: (p) => `📊 已追踪 ${p.duration} - 尚无消耗（消耗率会随时间下降）`,
            blendNote: (p) => `📊 已追踪 ${p.duration} - 90% 实际 + 10% 基准混合`,
            noConsumablesUsedMessage: '未使用任何消耗品',
            dropsHeading: '掉落',
            expectedValueHeading: '预期价值',
            expectedReturnLabel: (p) => `预期回报：${p.value}`,
            allDropsLabel: '全部掉落',
            top5DropsLabel: '掉落前 5',
            top10DropsLabel: '掉落前 10',
            dropsHeaderWithTotal: (p) => `${p.headerLabel}（共 ${p.total} 项）：`,
            dropLineNoPrice: (p) => `• ${p.itemName}（${p.dropRate}）：平均 ${p.avgCount} 个 → 无价格数据`,
            dropLineWithValue: (p) => `• ${p.itemName}（${p.dropRate}）：平均 ${p.avgCount} 个 → ${p.value}`,
            totalFromDropsLabel: (p) => `${p.count} 项掉落总计：${p.value}`,
        },
        combatScore: {
            hiddenEquipmentTooltip: '此资料页中的装备已隐藏，因此不计入评分。',
            scoreTooltip:
                '按当前购买价格和你现有的强化设置，估算现在复刻这套账号配装所需的成本。市场价值按当前最优卖价单价估算，未根据挂单深度调整。',
            combatScoreCalculatingLabel: '战斗评分：计算中…',
            skillerScoreCalculatingLabel: '技能评分：计算中…',
            combatScoreLine: (p) => `战斗评分：${p.value}`,
            houseLine: (p) => `房屋：${p.value}`,
            abilityLine: (p) => `能力：${p.value}`,
            equipmentLine: (p) => `装备：${p.value}`,
            shrinesLine: (p) => `神殿：${p.value}`,
            skillerScoreLine: (p) => `技能评分：${p.value}`,
            playerFallbackName: '玩家',
            viewCardButton: '查看卡片',
            closeTooltip: '关闭',
            metzSimExportButton: 'Metz 模拟器导出',
            simCharacterButton: '模拟角色',
            milkonomyExportButton: 'Milkonomy 导出',
            exportFullPartyButton: '导出整支队伍',
            partyExportPreviewTitle: '导出整支队伍',
            partyExportCopyButton: '复制队伍导出',
            partyExportYouLabel: '你',
            partyExportAgeAgoLabel: (p) => `${p.age}前`,
            partyExportMissingLabel: '缺失（请打开资料页）',
            partyExportUnknownMemberLabel: '未知',
            noDataStatus: '✗ 无数据',
            copiedStatus: '✓ 已复制',
            failedStatus: '✗ 失败',
            abilitiesTriggersPanelTitle: (p) => `${p.playerName} - 能力与触发器`,
            expandCollapseTooltip: '展开/收起',
            showDetailsLabel: '显示详情',
            hideDetailsLabel: '隐藏详情',
            collapseLabel: '收起',
            expandLabel: '展开',
            dependencySelf: '自身',
            dependencyTarget: '目标',
            dependencyAllEnemies: '所有敌人',
            dependencyAllAllies: '所有队友',
            conditionHp: '生命',
            conditionMissingHp: '已损失生命',
            conditionMp: '法力',
            conditionMissingMp: '已损失法力',
            conditionActiveUnits: '存活单位数',
            comparatorIsActive: '生效中',
            comparatorIsInactive: '未生效',
            triggerConditionActive: (p) => `${p.dependency}：${p.condition} ${p.comparator}`,
            triggerConditionValue: (p) => `${p.dependency}：${p.condition} ${p.comparator} ${p.value}`,
            noTriggerLabel: '无触发条件',
            triggerAndSeparator: ' 且 ',
            abilityAriaLabel: '能力',
            foodAndDrinksHeader: '食物与饮品',
            itemAriaLabel: '物品',
        },
        combatSummary: {
            encountersPerHour: (p) => `遭遇/时：${p.value}`,
            revenuePerDay: (p) => `收益/天：${p.ask} / ${p.bid}`,
            revenuePerHour: (p) => `收益/时：${p.ask} / ${p.bid}`,
            skillExpPerHour: (p) => `${p.skillName} 经验/时：${p.value}`,
            totalExp: (p) => `总经验：${p.value}`,
            totalExpPerHour: (p) => `总经验/时：${p.value}`,
            totalRevenue: (p) => `总收益：${p.ask} / ${p.bid}`,
        },
        combatSimIntegration: {
            importButtonLabel: '从 Toolasha 导入',
            errorNoCharacterDataLabel: '错误：无角色数据',
            noCharacterDataAlert: '未找到角色数据。请：\n1. 刷新游戏页面\n2. 等待页面完全加载\n3. 重新尝试',
            importedLabel: '✓ 已导入',
            importFailedLabel: '导入失败',
        },
        combatSimIntegrationMetz: {
            noCharacterDataAlert: '未找到角色数据。请：\n1. 刷新游戏页面\n2. 等待页面完全加载\n3. 重新尝试',
        },
        scrollSimulatorUi: {
            headingWithDash: (p) => `卷轴模拟 — ${p.contextLabel}`,
            title: '卷轴模拟',
            noteForLoadout: '当此配装对某个技能生效时，这些卷轴会覆盖默认配置。',
            noteForDefaults: '当没有配装匹配当前技能（或自动配装计算已禁用）时，应用此配置。',
        },
        combatBattleCounter: {
            attemptLabel: (p) => `· 第 ${p.attempt} 次尝试`,
            dungeonBattleLabel: (p) => `· 第 ${p.wave} 波 · 战斗 #${p.battle}`,
            battleLabel: (p) => `· 战斗 #${p.battle}`,
        },
        combatLevelProgress: {
            decimalTooltip: (p) => `按当前技能整数等级计算的战斗等级 · 游戏原生显示：${p.nativeLevel}`,
        },
        combatStatsCalculator: {
            unknownItemFallback: '未知',
        },
        dungeonTrackerUi: {
            loadingPlaceholder: '加载中...',
            elapsedLabel: '已用时间：',
            elapsedTooltip: '地下城开始后经过的时间',
            chatLabel: '聊天：',
            chatTooltip: '使用队伍聊天时间戳（已检测到计算机休眠）',
            waveCounter: (p) => `第 ${p.current}/${p.max} 波`,
            collapseExpandTooltip: '收起/展开',
            headerLastRunLabel: '上次通关：',
            headerAvgClearLabel: '平均通关：',
            headerRunsLabel: '次数：',
            headerKeysLabel: '钥匙：',
            statAvgClear: '平均通关',
            statLastRun: '上次通关',
            statFastestRun: '最快通关',
            statSlowestRun: '最慢通关',
            statAvgPerAttempt: '平均每次尝试',
            statFailRate: '失败率',
            runHistoryLabel: '通关记录',
            backfillButtonLabel: '⟳ 回溯导入',
            backfillButtonTooltip: '扫描队伍聊天并导入历史通关记录',
            clearButtonLabel: '✕ 清除',
            clearButtonTooltip: '清除所有通关记录',
            groupByLabel: '分组方式：',
            groupByTeamOption: '队伍',
            groupByDungeonOption: '地下城',
            filterDungeonLabel: '地下城：',
            filterDungeonAllOption: '所有地下城',
            filterTeamLabel: '队伍：',
            filterTeamAllOption: '所有队伍',
            noRunsYet: '暂无通关记录',
            runChartLabel: '📊 通关图表',
            popoutButtonLabel: '⇱ 弹出',
            popoutButtonTooltip: '弹出图表',
            dungeonNameWithTier: (p) => `${p.name}（T${p.tier}）`,
            dungeonLoading: '地下城加载中...',
            characterNameFallback: '你',
            noKeyDataYet: '暂无钥匙数据',
            keyCounts: '钥匙数量：',
            clearAllRunsConfirm: '确定删除所有通关记录数据？\n\n此操作无法撤销！',
            clearAllRunsSuccessAlert: '所有通关记录已清除。',
            clearAllRunsFailedAlert: '清除通关记录失败，请查看控制台了解详情。',
            backfillProcessingLabel: '⟳ 处理中...',
            backfillCompleteAlert: (p) => `回溯导入完成！\n\n新增记录：${p.runsAdded}\n队伍：${p.teamsCount}`,
            backfillNoRunsAlert: '未找到可回溯导入的新记录。',
            backfillFailedAlert: '回溯导入失败，请查看控制台了解详情。',
            positionResetNotification: '地下城追踪器位置和大小已重置',
            resizeHandleTooltip: '拖动以调整大小',
            soloRunsLabel: '单人记录',
            unknownDungeonFallback: '未知地下城',
            noRunsMatchFilters: '没有符合筛选条件的记录',
            errorLoadingRunHistory: '加载通关记录出错',
            groupStatsSummary: (p) =>
                `次数：${p.totalRuns} | 平均通关：${p.avgTime} | 平均每次尝试：${p.avgPerAttempt} | 最快：${p.bestTime} | 最慢：${p.worstTime}${p.failCount > 0 ? ` | 失败：${p.failCount}` : ''}`,
            resultFailedBadge: '失败',
            resultCanceledBadge: '已取消',
            deleteRunButtonTitle: '删除此条记录',
            chartTitle: '📊 地下城通关图表',
            chartAverageLabel: '平均',
            chartDurationAxisLabel: '时长（分钟）',
            chartFastestLabel: '最快',
            chartRunLabel: (p) => `第 ${p.number} 次`,
            chartRunNumberAxisLabel: '次数',
            chartRunTimesLabel: '通关用时',
            chartSlowestLabel: '最慢',
        },
        dungeonTrackerChatAnnotations: {
            averageLabel: (p) => `平均：${p.time}`,
            canceledLabel: '已取消',
            failedLabel: '失败',
            runNumberedLabel: (p) => `第 ${p.number} 次：${p.label}`,
        },
        labyrinthMissingSupplies: {
            buttonLabel: '购买缺少的补给',
        },
        labyrinthClearRate: {
            errorLoadoutUnavailable: '所选配装不可用',
            errorLoadoutChangedDuringSim: '模拟过程中更换了配装',
            loadoutFallbackName: (p) => `配装 #${p.id}`,
            recommendButtonLabel: '推荐',
            recommendingProgress: '推荐计算中...（{{current}}/{{total}}）',
            recommendedBadgeText: '推荐：{{value}}',
            recommendedBadgeTooltip: '达到 ≥{{percent}}% 通关率的推荐跳过阈值',
            applySkipSaving: '应用跳过（保存中...）',
            applySkipButton: '应用跳过（{{count}}）',
            targetWinPercentLabel: '目标胜率 %',
            simHoursLabel: '模拟小时数',
            liveClearEnhancing: ' [通关率 {{pct}}% | +{{current}}/+{{target}} | 剩余 {{left}}]',
            liveClearSkilling: ' [通关率 {{pct}}% | 剩余 {{left}}]',
            successDoubleLine: '成功率：{{success}}% | 双倍：{{double}}%',
            liveActionsLine: '次数：{{current}}/{{total}}',
            liveEnhanceLine: '强化：+{{current}}/+{{target}}',
            liveProgressLine: '进度：{{current}}/{{target}}',
            simulatingCombatTooltip: '正在模拟战斗...',
            loadoutUnavailableBadgeText: '配装不可用',
            badgePercentTime: '{{pct}}% {{time}}',
            tooltipActionsLine: '行动：{{attempts}} 次，每次 {{seconds}} 秒',
            tooltipWorkPowerProgress: '工作力：{{workPower}} → 进度：每次成功 {{progress}}/{{target}}',
            tooltipEffectiveLevel: '有效等级：{{level}}（基础 {{baseLevel}} + {{bonus}}）',
            tooltipRoomLevelXp: '房间等级：{{roomLevel}} | 每房经验：{{xp}}',
            tooltipEnhancingTarget: '目标：+{{targetLevel}} | 有效等级：{{level}}',
            tooltipRoomLevel: '房间等级：{{roomLevel}}',
            tooltipCombatWinRate: '胜率：{{winRate}}% | 平均战斗时长：{{avgFight}} 秒',
            tooltipCombatMonsterRoom: '怪物：{{monster}} | 房间等级：{{roomLevel}}',
            tooltipCombatLoadout: '配装："{{loadout}}"',
            tooltipFallback: '通关率：{{pct}}% | 预期用时：{{time}} | 房间等级：{{roomLevel}}',
            timeApproxSeconds: '~{{seconds}}秒',
        },
        labyrinthBestLevel: {
            bestLevelBadge: (p) => `最佳层数：${p.level}`,
            offsetSuffix: (p) => `(+${p.offset})`,
            tooltipBest: (p) => `最佳层数：${p.level}`,
            tooltipEffective: (p) => `有效层数：${p.level}`,
            tooltipExpertTeaCrate: (p) => `专家茶箱：+${p.bonus}`,
            tooltipGap: (p) => `差距：+${p.offset}`,
            tooltipYourLevel: (p) => `你的等级：${p.level}`,
        },
    };

    /**
     * zh batch c — production-enhancement namespaces.
     * Split from the former single zh.js; values here are Simplified Chinese UI strings.
     */
    var batchC = {
        openableAnalytics: {
            title: '开箱分析',
            closeAriaLabel: '关闭',
            sessionScopeLabel: '本次会话',
            lifetimeScopeLabel: '历史总计',
            emptyStateSession: '本次会话尚未记录任何宝箱、箱子或密藏的开启。',
            emptyStateLifetime: '暂无宝箱、箱子或密藏的历史记录。<br>打开一个即可开始记录。<br>',
            importHistoryLabel: '导入历史记录',
            includesImportedDataTooltip: '包含已导入的历史数据',
            actualLabel: '实际',
            expectedLabel: '预期',
            partialLabel: '[部分]',
            partialTooltip: '一次或多次开启/导入无法完全计价',
            luckLabel: '幸运值 ⓘ',
            luckTooltip: '幸运值 = 实际战利品价值 − 预期战利品价值，不含容器/钥匙成本，也不是开箱利润。',
            importedDataNote:
                '包含已导入的历史数据：导入的原始数量会按导入时的 Toolasha 现行价格/掉落模型重新计算，且导入数据与实时数据的时间段可能重叠。',
            deleteContainerButton: (p) => `删除${p.containerName}数据…`,
            lootHeading: '战利品',
            noItemsMessage: '此范围内未获得任何物品。',
            itemColumnHeader: '物品',
            qtyColumnHeader: '数量',
            valueColumnHeader: '价值',
            valueColumnTooltip: '这些金额记录于每次开启/导入时，并非当前市场价值。',
            manageDataHeading: '管理数据',
            historicalImportsHeading: '历史导入记录',
            noImportedSourcesMessage: '暂无导入来源。',
            removeImportButton: '移除导入',
            importFromEdibleButton: '从 Edible Tools 导入',
            chooseJsonFileButton: '选择 JSON 文件',
            fileReadErrorMessage: '无法读取所选文件。',
            pasteJsonInsteadLabel: '改为粘贴 JSON',
            pasteJsonPlaceholder: '在此粘贴导出的 JSON（Edible Tools 或 MWI Combat Suite）。',
            previewImportButton: '预览导入',
            noDataToImportMessage: '未找到可导入的数据。',
            ediblePlayerPickerLabel: '这份 Edible Tools 数据包含多个角色，哪一个是当前角色？',
            continueButton: '继续',
            importPreflightSummary: (p) =>
                `${p.sourceLabel}：共 ${p.openings} 次开启、${p.containerCount} 个容器，可导入。`,
            ownerMismatchWarning: (p) => `此导出记录所属角色（“${p.ownerName}”）与当前角色不匹配。`,
            ownerUnknownWarning: '此导出未记录所属角色，请自行核实归属。',
            overlapWarning: '这些累计历史记录可能包含相同的开启记录，且无法可靠去重。',
            importingButtonLabel: '导入中…',
            replaceImportButtonLabel: '替换导入…',
            importButtonLabel: '导入',
            importCompleteStatus: (p) =>
                `已${p.replaced ? '替换' : '导入'}${p.sourceLabel} 数据：共 ${p.openings} 次开启、${p.containerCount} 个容器。`,
            saveImportErrorMessage: '无法保存开箱分析数据，刷新后当前更改可能丢失。',
            removeImportErrorMessage: '无法移除已导入的数据，刷新后可能重新出现。',
            importRemovedStatus: (p) => `已移除 ${p.sourceLabel} 的导入数据，Toolasha 实时历史记录予以保留。`,
            deleteContainerConfirm: (p) => `确定删除此角色 ${p.containerName} 的全部开箱分析数据？此操作无法撤销。`,
            deletionSaveErrorMessage: '此删除操作无法保存，刷新后可能重新出现。',
            deleteAllButton: '删除全部分析数据…',
            deleteAllConfirm: (p) => `确定删除 ${p.characterName} 的全部开箱分析数据？此操作无法撤销。`,
            thisCharacterFallback: '此角色',
            clickForDetailsTooltip: '点击查看详情',
            cumulativeItemsHeader: '所有历史开启累计获得的物品：',
            currentCardTitle: '当前',
            dropValuationHeader: (p) => `开启 ${p.amount} 次该容器时，可能掉落物品按今日市价计算的价值：`,
            expectedIncomeLabel: '预期收入',
            gainedItemPartialTooltip: '一件或多件获得物品无法计价。',
            historyCardTitle: '历史',
            importAmbiguousFormat: '此数据同时匹配多种受支持的格式，无法导入。',
            importGainedItemsInvalidCountsExcluded: (p) => `${p.chestName}：一件或多件获得物品的数量无效，已被排除。`,
            importGainedItemsInvalidDataExcluded: (p) => `${p.name}：一件或多件获得物品的数据无效，已被排除。`,
            importParseFailedGeneric: '无法将此文本解析为 JSON。',
            importSkippedInvalidContainerId: (p) => `已跳过物品 id 无效的条目：“${p.containerHrid}”。`,
            importSkippedInvalidOpenedCount: (p) => `已跳过 ${p.name}：开启次数无效。`,
            importSkippedMalformedGainedItemData: (p) => `已跳过 ${p.chestName}：获得物品数据格式错误。`,
            importSkippedMalformedLootData: (p) => `已跳过 ${p.name}：战利品数据格式错误。`,
            importSkippedMissingGainedItemData: (p) => `已跳过 ${p.chestName}：有开启次数但缺少获得物品数据。`,
            importSkippedMissingLootData: (p) => `已跳过 ${p.name}：有开启次数但缺少战利品数据。`,
            importSkippedUnmatchedContainerName: (p) => `已跳过“${p.chestName}”：无法匹配到已知物品。`,
            importUnmatchedGainedItemsExcluded: (p) => `${p.chestName}：${p.count} 件获得物品无法匹配，已被排除。`,
            importUnrecognizedFormat: '这不符合受支持的 Edible Tools 或 MWI Combat Suite 导出格式。',
            importUnsupportedFormat: '这似乎不是受支持的导出格式。',
            incomeLabel: '收入',
            incomeRangeTooltip: '此批量规模下，实际收入通常落在预期值的该区间内',
            itemsReceivedHeader: '本次开启获得的物品：',
            luckShortLabel: '幸运值',
            luckUnavailableTooltip: (p) => `缺少部分必要数值，无法计算幸运值。${p.luckTooltip}`,
            moreDropsNotShown: (p) => `+ 另有 ${p.count} 种可能掉落未显示`,
            moreItemsNotShown: (p) => `+ 另有 ${p.count} 件物品未显示`,
            noDropDataMessage: '此容器暂无掉落数据。',
            noItemDataForOpeningMessage: '此次开启暂无物品数据。',
            noItemDataRecordedMessage: '尚未记录任何物品数据。',
            noPriceYetNote: '（暂无价格）',
            openedLabel: '已开启',
            partialBadgeLabel: '（部分）',
            profitLabel: '利润',
            viewAnalyticsLink: '查看分析',
            vsExpectedLabel: '对比预期',
            importJsonParseFailed: '无法将粘贴/上传的文本解析为 JSON。',
            importNoChestsData: '此导出中未找到“chests”数据。',
            importNoChestOpenData: '此 Edible Tools 数据中未找到“Chest_Open_Data”。',
            importNoPlayerData: '此 Edible Tools 数据中未找到玩家数据。',
            importNoChestDataForPlayer: (p) => `未找到 ${p.name} 的开箱数据。`,
            importNoChestNamesMatched: '此导出中的宝箱名称均无法匹配到已知物品。',
            importEmptyHistory: '此导出中未找到开箱历史记录，现有导入数据保持不变。',
        },
        riskOfRuinUi: {
            launcherButtonLabel: '破产风险',
            panelTitle: '破产风险计算器',
            statusDefault: '选择模式、设定目标，然后点击“计算”。',
            modeLabel: '模式',
            modeChestOption: '地下城宝箱',
            modeAlchemyOption: '炼金（转化）',
            modeEnhancingOption: '强化',
            startingGoldLabel: '起始金币',
            startingGoldPlaceholder: '例如 5m、1.2b',
            calculateButton: '计算',
            chestTypeLabel: '宝箱类型',
            chestsToOpenLabel: '开箱数量',
            itemToTransmuteLabel: '要转化的物品',
            itemNamePlaceholder: '输入物品名称...',
            catalystLabel: '催化剂',
            catalystBestOption: '最佳可用（自动）',
            catalystNoneOption: '无',
            catalystTypeSpecificOption: '特定类型催化剂',
            catalystPrimeOption: '主催化剂',
            actionsToAttemptLabel: '操作次数',
            itemToEnhanceLabel: '要强化的物品',
            targetLevelLabel: '目标等级',
            startLevelLabel: '起始等级',
            protectFromLevelLabel: '保护起始等级（0 = 从不保护）',
            statusCalculating: '计算中…',
            statusErrorCalculation: '计算出错。',
            statusInvalidTransmuteItem: '请输入有效的可转化物品名称。',
            statusInvalidEnhanceItem: '请输入有效的可强化物品名称。',
            statusEnhancementModelFailed: '无法根据这些参数构建强化模型。',
            optimalCommitNotApplicable:
                '最佳资金投入比例：不适用 —— 强化没有可用于衡量下注规模的收益分布，只有通往目标等级的固定成本，请改用上方的破产概率。',
            statusTrialsSimulated: (p) => `已模拟 ${p.trials} 次。`,
            optimalCommitNoEdge:
                '<strong>最佳资金投入比例：</strong>0% —— 此方案没有正期望优势（E[R] ≤ 1），按其方差确定下注规模没有意义。',
            optimalCommitWithEdge: (p) =>
                `<strong>最佳资金投入比例：</strong>资金的 ${p.percent}（${p.gold} ≈ ${p.actions} 次操作）`,
            optimalCommitVarianceNote:
                '仅为基于方差的上限 —— 未考虑出售自身产出物造成的价格下行压力。Toolasha 会在每个受追踪产出物的市场订单簿页面自动显示“出售深度”估算，但仅在你本次会话曾于游戏内打开过该物品页面之后生效，受追踪的产出物见下方。',
            trackingSellDepthNote: (p) =>
                `正在追踪以下物品的“出售深度”：${p.names} —— 在市场打开该物品的订单簿页面即可查看估算。`,
            untrackedOutputsNote: (p) => `未追踪（当前没有可用于比对的出售价格数据）：${p.names}。`,
            untradeableOutputNote: (p) => `${p.itemName} 不可交易，因此不适用“出售深度”检查。`,
            ruinProbabilityLine: (p) =>
                `<strong>破产概率：</strong>${p.probability}（95% 置信区间：${p.ciLow} – ${p.ciHigh}）`,
            ruinPossibleAtActionLine: (p) => `<strong>首次可能破产的操作：</strong>第 ${p.value} 次`,
            neverRuinPossible: '永不（没有任何一次操作会亏损）',
            peakRuinExposureLine: (p) => `<strong>破产风险峰值出现于：</strong>第 ${p.value} 次操作`,
            noRuinOccurred: '模拟中未发生破产',
            avgActionsBeforeRuinLine: (p) => `<strong>破产前平均操作次数（发生破产时）：</strong>${p.value}`,
            undecidedTrialsNote: (p) =>
                `${p.undecided} / ${p.total} 次模拟在步数上限内既未破产也未达到目标 —— 对于这种超长周期场景，结果可能不够精确。`,
            noSingleActionLoss: '这里没有任何一次操作会亏损，因此破产永远不会发生。',
            ruinFormulaLine: (p) =>
                `<strong>首次可能破产的操作次数</strong> = ⌈起始金币 ÷ 单次操作最大亏损⌉ = ⌈${p.startingGold} ÷ ${p.maxLoss}⌉ = ${p.minActions}`,
            entryKeyLine: (p) => `入场钥匙（${p.name}）：${p.price}`,
            chestKeyLine: (p) => `宝箱钥匙（${p.name}）：${p.price}`,
            totalCostPerOpenLine: (p) => `<strong>每次开箱总成本：</strong>${p.total}`,
            guaranteedMinPayoutLine: (p) =>
                `每次开箱保底最低产出：${p.amount}（所有掉落率为 100% 的掉落表条目按最小数量之和 —— 真实宝箱的产出永远不低于此数，绝不会真的为 0）`,
            chestMaxLossLine: (p) =>
                `<strong>单次操作最大亏损：</strong>${p.loss} = 成本 − 保底最低产出 = ${p.total} − ${p.min}`,
            guaranteedDropLabel: (p) => `${p.itemName}（保底）`,
            costRiskDetailsSummary: '成本与风险详情',
            dropTableSummary: (p) => `掉落表（${p.count} 项物品）`,
            colItem: '物品',
            colDropRate: '掉落率',
            colAvgCount: '平均数量',
            colPrice: '价格',
            colEv: '期望值',
            totalEvPerOpenLabel: '每次开箱总期望值',
            successRateLine: (p) => `成功率：${p.rate}`,
            materialCostLine: (p) => `材料成本（每次尝试都支付）：${p.cost}`,
            coinCostLine: (p) => `金币成本（每次尝试都支付）：${p.cost}`,
            catalystCostLine: (p) => `催化剂（${p.name}，仅成功时支付）：${p.cost}`,
            noCatalystUsed: '未使用催化剂。',
            dropTableExplanationNote:
                '下方的产出掉落表是<em>成功后</em>的一次互斥抽取 —— 每个分支都是独立结果，不会被合并平均，因此稀有高价值分支真实的尾部风险会体现在模拟结果中，而不会被抹平。',
            netOnFailureLine: (p) => `<strong>失败时净值：</strong>${p.value}`,
            maxLossLine: (p) => `<strong>单次操作最大亏损：</strong>${p.value}`,
            selfReturnLabel: (p) => `${p.itemName}（原物返还）`,
            failureLabel: '（失败）',
            unpricedProbabilityNote: (p) =>
                `成功分支概率中有 ${p.percent} 缺少市场价格数据，按 0 产出处理（绝不会以猜测值虚增）。`,
            bonusDropsSummary: (p) => `额外掉落（${p.count} 项，与成功/失败无关）`,
            colChancePerAttempt: '每次尝试概率',
            colPayoutIfHit: '触发时产出',
            outputDropTableSummary: (p) => `产出掉落表（${p.count} 个分支，成功后抽取一次）`,
            colOutcome: '结果',
            costPerAttemptLine: (p) => `<strong>每次尝试成本（材料，每次尝试均消耗）：</strong>${p.value}`,
            protectionCostLine: (p) => `<strong>保护成本（仅在受保护失败时收取）：</strong>${p.value}`,
            maxLossWithNoteLine: (p) =>
                `<strong>单次操作最大亏损：</strong>${p.value}（最坏情况：某次尝试在受保护等级失败）`,
            costRiskDetailsLevelsSummary: (p) => `成本与风险详情（等级 +${p.startLevel} 至 +${p.targetLevel}）`,
            perLevelRatesSummary: (p) => `各等级成功率与成本（共 ${p.count} 级）`,
            colAttempt: '尝试',
            colSuccess: '成功',
            colCost: '成本',
            colFailArrow: '失败 →',
            colProtectionCost: '保护成本',
        },
        skillingOptimizer: {
            actionLockedLabel: (p) => `${p.name}（等级 ${p.level} —— 已锁定，可能通过茶解锁）`,
            actionsLabel: '动作：',
            alchemyAutoOption: '—— 自动（使用当前动作）——',
            alchemyBasisLabel: (p) => `基于：${p.typeName} ${p.itemName}${p.levelSuffix}（${p.source}）`,
            alchemyBasisManualSource: '手动选择',
            alchemyBasisNothingQueued:
                '基于：当前没有排队动作 —— 经验值为与物品无关的估算值，金币数据不可用。请在上方选择物品，或开始一个炼金动作。',
            alchemyBasisQueueSource: '来自你当前/排队中的动作',
            alchemyEnhancementLevelTooltip: '强化等级（转化时忽略）',
            alchemyItemHint: '炼金金币/经验值按单一物品计价 —— 选择一个物品，或保持自动以使用角色当前排队炼金的物品。',
            alchemyItemLabel: '炼金物品：',
            alchemyTypeCoinify: '兑换金币',
            alchemyTypeDecompose: '分解',
            alchemyTypeTransmute: '转化',
            alchemyTypeUnrefine: '反精炼',
            alchemyUnsupportedNotice:
                '炼金场景的计算尚未区分具体物品，此处显示通用结果数值会歪曲兑换金币/分解/转化的真实经济收益，暂不支持。',
            allActionsCount: (p) => `全部（${p.count}）`,
            allActionsOption: '全部',
            alreadyOptimal: '已处于最佳强化等级',
            avgGoldPerHourCompactStat: '平均金币/时',
            avgGoldPerHourStat: '平均金币 / 时',
            avgXpPerHourCompactStat: '平均经验/时',
            avgXpPerHourStat: '平均经验 / 时',
            compareGainNote: '百分比为各槽位相对于所比较配装中物品的提升幅度。',
            compareLabel: '比较：',
            compareLoadoutUnavailableWarning: (p) => `比较配装“${p.name}”不可用，比较项未替换为当前装备。`,
            compareNoneOption: '—— 无 ——',
            emptyOption: '—— 空 ——',
            emptySlotCapitalized: '空',
            emptySlotLower: '空',
            equipmentHeader: '装备',
            equipmentProgressionHeader: '装备进阶',
            forGoldLabel: '金币方向',
            forXpLabel: '经验方向',
            goldPerHourStat: '金币 / 时',
            houseRoomLabel: '房屋房间',
            incompletePriceCostTooltip: '一项必要的市场价格尚未确定，因此该费用并不精确。',
            incompletePriceRankingTooltip: '一项必要的市场价格尚未确定，因此该推荐排名并不精确。',
            incompleteValueSuffix: (p) => `${p.value}（不完整）`,
            levelLabel: '等级：',
            levelLockedSeparator: '—— 等级锁定 ——',
            loadoutLabel: '配装：',
            loadoutUnavailableStatus: (p) => `配装“${p.name}”不可用，未予加载。`,
            modeSimulator: '模拟器',
            modeUpgrade: '升级',
            noCompareGainNote: '百分比为相对于空槽位的提升幅度。在“比较”中选择一个配装，可查看相对于当前装备的提升。',
            noLoadoutOption: '—— 无配装 ——',
            noRelevantEquipment: '在所选等级下，未找到该技能的相关装备。',
            optimalTeasHeader: '最佳茶饮',
            optimizeButton: '优化',
            optimizingButton: '优化中…',
            refinedItemTooltip:
                '精炼物品的基础属性高于对应的非精炼物品，因此较低的强化等级仍可能胜过较高等级的非精炼物品。',
            resultsHeader: '结果',
            searchActionsPlaceholder: '搜索动作...',
            searchPlaceholder: '搜索…',
            selectedLoadoutFallbackName: '所选配装',
            simulateButton: '模拟',
            simulatingButton: '模拟中…',
            skillLabel: '技能：',
            sortBestValue: '最佳性价比',
            sortCostCheapest: '费用（最低）',
            sortGoldGainPercent: '金币提升 %',
            sortLabel: '排序：',
            sortPaybackFastest: '回本时间（最快）',
            sortProfitRatioCheapest: 'G/0.01% 利润（最低）',
            sortSlotOrder: '槽位顺序',
            sortXpGainPercent: '经验提升 %',
            sortXpRatioCheapest: 'G/0.01% 经验/时（最低）',
            tabLabel: '技能模拟器',
            tableHeaderCost: '费用',
            tableHeaderPayback: '回本时间',
            tableHeaderProfitDelta: '利润 Δ',
            tableHeaderProfitRatio: 'G/0.01% 利润',
            tableHeaderXpDelta: '经验/时 Δ',
            tableHeaderXpRatio: 'G/0.01% 经验/时',
            teaCostPerHour: (p) => `茶饮成本：${p.cost}/时`,
            teasHeader: '茶饮',
            teaSlotLabel: (p) => `茶饮 ${p.index}`,
            unavailableLabel: (p) => `${p.name}（不可用）`,
            xpPerHourStat: '经验 / 时',
        },
        alchemyProfitDisplay: {
            profitPerHourPerDaySummary: '{{profit}}/时，{{profitPerDay}}/天',
            revenueHeader: '收入：{{revenue}}/时',
            normalDropLine:
                '• {{itemName}}：{{drops}}/时（{{dropRate}} × 成功率 {{successRate}}）@ {{price}} → {{revenue}}/时',
            normalDropsSectionTitle: (p) => `普通掉落：${p.revenue}/时（${p.count} 件物品）`,
            dropLineNoSuccessImpact:
                '• {{itemName}}：{{drops}}/时（{{dropRate}}，不受成功率影响）@ {{price}} → {{revenue}}/时',
            essenceDropsSectionTitle: (p) => `精华掉落：${p.revenue}/时（${p.count} 件物品）`,
            rareDropLineWithBonus:
                '• {{itemName}}：{{drops}}/时（基础 {{baseRate}} × 稀有发现 {{bonus}} = {{effectiveRate}}，不受成功率影响）@ {{price}} → {{revenue}}/时',
            rareDropsSectionTitle: (p) => `稀有掉落：${p.revenue}/时（${p.count} 件物品）`,
            costsHeader: '成本：{{costs}}/时',
            materialCostLineWithRecovery:
                '• {{itemName}}{{enh}}：{{amount}}/时 @ {{price}} → {{cost}}/时（回收 {{recovered}}/时，净额 {{net}}/时）',
            materialCostLine: '• {{itemName}}{{enh}}：{{amount}}/时（每次尝试均消耗）@ {{price}} → {{cost}}/时',
            materialCostsSectionTitle: (p) => `材料成本：${p.cost}/时（${p.count} 种材料）`,
            catalystCostLine: '• {{itemName}}：{{amount}}/时（仅成功时消耗，{{successRate}}）@ {{price}} → {{cost}}/时',
            catalystCostSectionTitle: '催化剂成本：{{cost}}/时',
            drinkCostLine: '• {{itemName}}：{{amount}}/时 @ {{price}} → {{cost}}/时',
            drinkCostsSectionTitle: (p) => `饮品成本：${p.cost}/时（${p.count} 种饮品）`,
            modifiersHeader: '加成：',
            baseSuccessRateLine: '• 基础成功率：{{value}}',
            teaBonusMultiplicativeLine: '• 茶加成：+{{value}}（乘算）',
            successRateSectionTitle: '成功率：{{value}}',
            successRateLine: '• 成功率：{{value}}',
            levelBonusLine: '• 等级加成：+{{value}}',
            houseBonusLine: '• 房屋加成：+{{value}}',
            teaBonusLine: '• 茶加成：+{{value}}',
            equipmentBonusLine: '• 装备加成：+{{value}}',
            communityBuffLine: '• 社区增益：+{{value}}',
            achievementBonusLine: '• 成就加成：+{{value}}',
            efficiencySectionTitle: '效率：+{{value}}',
            actionSpeedSectionTitle: '行动速度：+{{value}}',
            rareFindSectionTitle: '稀有发现：+{{value}}',
            essenceFindSectionTitle: '精华发现：+{{value}}',
            actionsSuccessRateLine: '动作数：{{actions}}/时 | 成功率：{{rate}}',
            netProfitLine: '净利润：{{profit}}/时，{{profitPerDay}}/天',
            pricingModeLine: '定价模式：{{mode}}',
            detailedBreakdownTitle: '详细明细',
            profitabilityTitle: '盈利能力',
            baseTimeLine: '基础：{{base}} 秒 → {{time}} 秒',
            actionsPerHourLine: '{{value}}/时',
            speedBonusLine: '速度：+{{value}}',
            speedDetailLine: '  - {{name}}{{enh}}：+{{value}}',
            speedEquipmentFallbackLine: '  - 装备：+{{value}}',
            speedTeaFallbackLine: '  - 茶：+{{value}}',
            efficiencyOutputLine: '效率：+{{efficiency}}% → 产出：×{{multiplier}}（{{actionsPerHour}}/时）',
            effLevelDetailLine: '  - 等级：+{{value}}%',
            effHouseDetailLine: '  - 房屋：+{{value}}%',
            effEquipmentDetailLine: '  - 装备：+{{value}}%',
            effTeaDetailLine: '  - 茶：+{{value}}%',
            effAchievementDetailLine: '  - 成就：+{{value}}%',
            effCommunityDetailLine: '  - 社区：+{{value}}%',
            totalTimeLine: '总时间：{{time}}',
            speedTimeSummary: '{{actionsPerHour}}/时 | 总时间：{{time}}',
            actionSpeedTimeTitle: '行动速度与时间',
            levelProgressTitle: '等级进度',
            currentLevelProgress: '当前：等级 {{level}} | 距等级 {{nextLevel}} 还差 {{percent}}%',
            xpPerActionLine: '每次动作经验：基础 {{base}} → {{modified}}（×{{multiplier}}）',
            expectedXpLine: '  预期经验：{{xp}}（成功率 {{rate}}，失败获得 10% 经验）',
            totalXpBonusLine: '  总经验加成：+{{value}}%',
            xpItemBonusLine: '    • {{name}}{{enh}}：+{{value}}%',
            xpHouseRoomsLine: '    • 房屋房间：+{{value}}%',
            xpCommunityBuffLine: '    • 社区增益：+{{value}}%',
            xpWisdomTeaLine: '    • 智慧茶：+{{value}}%',
            xpAchievementLine: '    • 成就：+{{value}}%',
            xpMooPassLine: '    • MooPass：+{{value}}%',
            toLevelHeader: '升至等级 {{level}}：',
            actionsCountLine: '  动作数：{{count}}',
            timeNeededLine: '  时间：{{time}}',
            targetLevelCalculatorHeader: '目标等级计算器：',
            toLevelPrefix: '升至等级',
            actionsTimeResult: '{{actions}} 个动作 | {{time}}',
            xpPerHourPerDayLine: '经验/时：{{perHour}} | 经验/天：{{perDay}}',
            invalidLevelMessage: '无效等级',
            timeToLevelSummary: '{{time}} 后到达等级 {{level}}',
        },
        alchemyHistoryViewer: {
            unifiedModalTitle: '炼金历史',
            historyTabTitle: (p) => `${p.actionName}历史记录`,
            colSessionStart: '会话开始',
            colInputItem: '输入物品',
            colAttempts: '尝试次数',
            colSuccesses: '成功次数',
            colResults: '结果',
            colEnhLevel: '强化等级',
            colSuccessRate: '成功率',
            colCoinsEarned: '获得金币',
            colFailures: '失败次数',
            noTransmuteHistoryYet: '暂无转化历史记录。',
            noDecomposeHistoryYet: '暂无分解历史记录。',
            noCoinifyHistoryYet: '暂无兑换金币历史记录。',
            noSessionsMatchFilters: '没有符合当前筛选条件的会话。',
            successesFailedLabel: (p) => `${p.successes}（失败 ${p.failures} 次）`,
            deleteSessionTitle: '删除此会话',
            selfReturnResultLine: (p) => `${p.name} x${p.count}（原物返还）`,
            resultLine: (p) => `${p.name} x${p.count} = ${p.total}（${p.each}/个）`,
            sessionCountStat: (p) => `${p.count} 个会话`,
            inputItemsCountLabel: (p) => `${p.count} 件输入物品`,
            inputFilterBadge: (p) => `输入：${p.label}`,
            resultsFilterBadge: (p) => `结果：“${p.text}”`,
            showingAllSessions: (p) => `共显示 ${p.count} 个会话`,
            filterByInputItemTitle: '按输入物品筛选',
            filterByResultItemTitle: '按结果物品筛选',
            itemNamePlaceholder: '物品名称...',
            clearHistoryConfirmWithWarning: (p) =>
                `⚠️ 此操作将永久删除全部${p.actionName}历史记录（${p.count} 个会话）。\n此操作无法撤销。\n\n确定要继续吗？`,
            clearHistoryConfirmPlain: (p) =>
                `此操作将永久删除全部${p.actionName}历史记录（${p.count} 个会话）。\n此操作无法撤销。\n\n确定要继续吗？`,
            historyClearedAlert: (p) => `${p.actionName}历史记录已清除。`,
            csvColEnhancementLevelFull: '强化等级',
            csvColItemUsedHeader: (p) => `${p.name}使用量`,
        },
        alchemyBestItems: {
            tabLabel: '最佳物品',
            modalTitle: (p) => `最佳物品 —— ${p.type}`,
            sortByLabel: '排序方式：',
            profitableOnlyLabel: '仅盈利',
            profitFilterLabel: '利润/时：',
            itemPriceFilterLabel: '物品价格：',
            minPlaceholder: '最小',
            maxPlaceholder: '最大',
            colLvl: '等级',
            catalystPrimeLabel: '主',
            noEligibleItemsMessage: '未找到符合条件的物品',
            showingTopItemsMessage: (p) => `显示前 ${p.max} 项（共 ${p.total} 项物品）`,
            noBreakdownDataMessage: '暂无明细数据',
            materialLine: '• {{itemName}}：{{count}}× @ {{price}} → {{cost}}/时',
            catalystLine: '• {{itemName}} @ {{price}} → {{cost}}/时',
            teaLine: '• {{itemName}} → {{cost}}/时',
            statsActionsPerHour: '{{value}}/时',
            statsSuccessRate: '{{value}} 成功率',
            statsEfficiency: '{{value}} 效率',
        },
        alchemyActionProtection: {
            protectedCategoryWarning: (p) => `受保护分类（${p.categoryName}）！3 秒后解锁…`,
            clickAgainToConfirm: '再次点击以确认。',
            pinActionTooltip: '固定此动作',
            unpinActionTooltip: '取消固定此动作',
            goldSummaryLine: (p) => `${p.label}所需金币：${p.needed} / ${p.balance}`,
            allCountLabel: '全部',
            popupTitle: '炼金动作保护',
            popupDescription: '选择要为每个炼金动作保护的物品分类。受保护物品需经 3 秒确认后，动作才会执行。',
            categoryItemCountLabel: (p) => `${p.name}（${p.count} 件物品）`,
        },
        xpTracker: {
            tillNextLevel: (p) => `距下一等级还需 ${p.time}`,
            timeWeeks: (p) => `${p.n} 周`,
            timeDays: (p) => `${p.n} 天`,
            timeHours: (p) => `${p.n} 小时`,
            timeMinutes: (p) => `${p.n} 分钟`,
            lessThanOneMinute: '不到 1 分钟',
            timePartSeparator: '',
        },
        // Units used by utils/formatters.js timeReadable()
        timeUnits: {
            years: (p) => `${p.n} 年`,
            months: (p) => `${p.n} 个月`,
            days: (p) => `${p.n} 天`,
            hoursShort: (p) => `${p.n} 小时`,
            minutesShort: (p) => `${p.n} 分`,
            secondsShort: (p) => `${p.n} 秒`,
            hms: (p) => `${p.h} 时 ${p.m} 分 ${p.s} 秒`,
            separator: ' ',
        },
        xphCalculator: {
            openButtonLabel: '强化经验计算',
            panelTitle: '强化经验/时计算器',
            maxLevelLabel: '最高等级',
            protectFromLabel: '保护起始等级',
            colItem: '# 物品',
            colGoldPerXp: '金币/经验',
            statusDefault: '输入参数后点击计算。',
            statusResults: (p) =>
                `共 ${p.count} 件物品，${p.withCost} 件含花费数据${p.hasPartial ? '；* = 价格数据不完整。' : '。'}`,
        },
        enhancementDisplay: {
            autoDetectModeLabel: '🔍 自动',
            manualModeLabel: '✏️ 手动',
            modeToggleTooltip: '切换自动检测与手动模式',
            calculatorTitle: '⚙️ 强化计算器',
            itemLevelSuffix: (p) => `（物品等级 ${p.itemLevel}）`,
            yourStatsHeader: '你的强化属性：',
            teaBonusSuffix: (p) => `（茶 +${p.value}）`,
            houseLabel: '房屋：',
            observatoryLevelValue: (p) => `天文台等级 ${p.level}`,
            toolLabel: '工具：',
            bodyLabel: '身体：',
            legsLabel: '腿部：',
            handsLabel: '手部：',
            successLabel: '成功率：',
            equipmentLabel: '装备：',
            houseObservatoryLabel: '房屋（天文台）：',
            achievementLabel: '成就：',
            levelAdvantageLabel: '等级优势：',
            communityLabel: '社区：',
            teaLabel: '茶：',
            labyrinthLabel: '迷宫：',
            baseLabel: '基础：',
            blessedLabel: '祝福：',
            blessedTeaLabel: '祝福茶：',
            blessedTeaChanceLine: (p) => `${p.percent}% 概率跳过一级`,
            houseRoomsLabel: '房屋房间：',
            houseRoomsWisdomLabel: '房屋房间（智慧）：',
            communityWisdomLabel: (p) => `社区（智慧 T${p.level}）：`,
            wisdomTeaLabel: '智慧茶：',
            materialsPerAttemptHeader: '每次尝试所需材料：',
            ifUsedSuffix: '（若使用）',
            protectionActiveNote: (p) => `• 从 +${p.level} 起启用保护（失败时强化等级 −1）<br>`,
            noProtectionNote: '• 未使用保护（所有失败都会回到 +0）<br>',
            statisticalAveragesNote: '• 尝试次数与时间均为统计平均值<br>',
            actionTimeNote: (p) => `• 动作时间：${p.time} 秒（含 ${p.percent}% 速度加成）`,
            costsByLevelHeader: '各强化等级花费：',
            viewFullTableTooltip: '查看完整表格',
            mirrorStrategyHeader: '💎 贤者之镜策略：',
            mirrorStrategyStartLevel: (p) => `• 从 <strong>+${p.level}</strong> 起使用镜子`,
            mirrorStrategyTotalSavings: (p) => `• 到 +20 累计节省：<strong>${p.savings}</strong> 金币`,
            mirrorStrategyHighlightNote: '金色高亮行表示该处使用镜子更便宜',
            colTime: '时间',
            colMirrorCost: '镜子成本',
            costsModalTitle: '📊 各强化等级花费',
            costsModalSubtitle: '全部等级强化花费的完整明细',
        },
        enhancementUi: {
            panelTitle: '强化追踪器',
            clearAllSessionsTooltip: '清除所有会话',
            clearAllSessionsConfirm: '清除所有强化会话？',
            collapsePanelTooltip: '收起面板',
            expandPanelTooltip: '展开面板',
            unknownItemFallback: '未知物品',
            collapsedSummaryStats: (p) => `${p.statusIcon} ${p.totalAttempts} 次尝试 | 成功率 ${p.successRate}%`,
            noSessionsMessage: '开始强化即可生成数据',
            invalidSessionMessage: '无效会话',
            statusCompleted: '已完成',
            statusInProgress: '进行中',
            itemLabel: '物品：',
            targetLabel: '目标：',
            protLabel: '保护：',
            statusLabel: '状态：',
            summaryStatsLine: (p) =>
                `尝试 ${p.totalAttempts} · 成功 ${p.totalSuccess} · 祝福 ${p.totalBlessed} · 失败 ${p.totalFailure}`,
            protsUsedLabel: '已用保护：',
            expectedAttemptsLabel: '预期尝试次数：',
            expectedProtsLabel: '预期保护次数：',
            attemptFactorLabel: '尝试系数：',
            protFactorLabel: '保护系数：',
            totalXpGainedLabel: '总获得经验：',
            sessionDurationLabel: '会话时长：',
            xpPerHourLabel: '经验/时：',
            calculatingEllipsis: '计算中…',
            enhancingLuckLabel: '强化幸运值：',
            luckTooltip: (p) => `实际成功 ${p.actualSuccesses} 次，预期成功 ${p.expectedSuccesses} 次`,
            noAttemptsRecordedMessage: '尚无尝试记录',
            colFail: '失败',
            colPercent: '%',
            colLuck: '幸运',
            materialsLabel: '材料：',
            coinsCountLabel: (p) => `金币（${p.count}×）：`,
            protectionFallbackName: '保护',
            totalCostClickDetailsLabel: '💰 总花费（点击查看详情）',
            durationHoursMinutesSeconds: (p) => `${p.hours}时${p.minutes}分${p.seconds}秒`,
        },
        tooltipEnhancement: {
            askBidHeader: '卖价 / 买价',
            askHeader: '卖价',
            askSuffixLabel: '（卖价）',
            baseItemLabel: '基础物品',
            bidHeader: '买价',
            bidSuffixLabel: '（买价）',
            buyItemLabel: '购买物品',
            countHeader: '数量',
            craftCostHeader: '制作花费',
            craftingCostSubtotalLabel: '制作花费',
            craftItemLabel: '制作物品',
            enhanceCostHeader: '强化花费',
            enhancingCostSubtotalLabel: '强化花费',
            expectedAttemptsLine: (p) => `预期尝试次数：${p.value}`,
            fromLevelLabel: (p) => `从 +${p.level}`,
            levelHeader: '等级',
            materialHeader: '材料',
            milestonesHeaderLabel: '强化里程碑',
            minimumSellLabel: '最低售价：',
            neverProtectionLabel: '从不',
            noProtectionNeededLine: (p) => `+${p.targetLevel} 无需保护`,
            pathHeaderLine: (p) => `强化路径（+0 → +${p.targetLevel}）`,
            protectFromLine: (p) => `保护起点：${p.label}`,
            protectionLabel: '保护',
            timeDaysLine: (p) => `时间：约 ${p.value} 天`,
            timeHoursLine: (p) => `时间：约 ${p.value} 小时`,
            timeMinutesLine: (p) => `时间：约 ${p.value} 分钟`,
            timeSecondsLine: (p) => `时间：约 ${p.value} 秒`,
            totalLabel: '总计',
            totalXpLine: (p) => `总经验：约 ${p.value}`,
            usesMirrorFromLine: (p) => `从 +${p.level} 起使用 ${p.mirrorName}`,
            xpHeader: '经验',
            xpPerHourLine: (p) => `经验/时：${p.value}`,
            yourRateLine: (p) => `你的速率：${p.value}/时`,
        },
        enhancementProtectionMarketplace: {
            buyCheapestButtonLabel: '🛒 购买最便宜：{{name}}（{{price}}）',
        },
        skillCalculatorUi: {
            skillToLevelLabel: (p) => `${p.skillName} 升到`,
            daysAfterLabel: '天后',
            resultsHeaderToLevel: (p) => `${p.skillName} 升到 ${p.level} 级所需时间：`,
            noExperienceGainMessage: '无经验增长（模拟中未训练）',
            alreadyAchievedMessage: '已达成',
            invalidTargetLevelMessage: '无效的目标等级',
            resultsHeaderAfterDays: (p) => `${p.days} 天后：`,
            skillLevelPercentLine: (p) => `${p.skillName} ${p.level} 级 ${p.percentage}%`,
            combatLevelLine: (p) => `战斗等级：${p.level}`,
            unableToCalculateProjectionMessage: '无法计算预测',
        },
        abilityBookCalculator: {
            currentLevelLabel: '当前等级：',
            toLevelLabel: '目标等级：',
            booksNeededLine: (p) => `所需书本数：<strong>${p.books}</strong>`,
            costAskBidLine: (p) => `花费：${p.askCost} / ${p.bidCost}（卖价 / 买价）`,
            buyOnMarketplaceButton: '在市场购买',
        },
    };

    /**
     * zh batch d — market-economy namespaces.
     * Split from the former single zh.js; values here are Simplified Chinese UI strings.
     */
    var batchD = {
        inventoryCountDisplay: {
            inInventorySuffix: (p) => `（${p.count} 在物品栏中）`,
        },
        profitDisplay: {
            equippedLabel: '已装备',
            loadoutLabelDefault: (p) => `${p.name}${p.isDefault ? '（默认）' : ''}`,
            loadoutUnavailable: (p) => `已装备 ⚠（已保存的配装${p.name}不可用）`,
            genericLoadoutName: '配装',
            rareFindBonusSummary: (p) => `${p.value}% 稀有发现`,
            hrSuffix: '/时',
            actionSuffix: '/次',
            daySuffix: '/天',
            itemsUnit: '个',
            dropsUnit: '次',
            drinksUnit: '份',
            revenueHeader: (p) => `收入：${p.label}`,
            costsHeader: (p) => `成本：${p.label}`,
            netProfitLine: (p) => `净利润：${p.value}`,
            perHourPerDay: (p) => `${p.perHour}，${p.perDay}`,
            totalProfitSummary: (p) => `${p.base} | 总利润：${p.value}`,
            pricingModeLine: (p) => `定价模式：${p.mode}  •  配装：${p.loadout}`,
            actionsEfficiencyLine: (p) => `操作次数：${p.actions} | 效率：+${p.efficiency}%`,
            actionsLine: (p) => `操作次数：${p.actions}`,
            revenueCostsSummary: (p) => `收入：${p.revenue} | 成本：${p.costs}`,
            baseOutputLine: (p) => `• ${p.name}（基础）：${p.rate} @ ${p.price}${p.missingNote}/个 → ${p.revenue}`,
            gourmetOutputLine: (p) =>
                `• ${p.name}（美食 ${p.pct}）：${p.rate} @ ${p.price}${p.missingNote}/个 → ${p.revenue}`,
            gourmetOutputLinePlus: (p) =>
                `• ${p.name}（美食 +${p.pct}）：${p.rate} @ ${p.price}${p.missingNote}/个 → ${p.revenue}`,
            processingConsumedLine: (p) => `• 消耗 ${p.item}：-${p.rate} @ ${p.price}${p.missingNote} → -${p.revenue}`,
            processingProducedLine: (p) => `• 产出 ${p.item}：${p.rate} @ ${p.price}${p.missingNote} → ${p.revenue}`,
            processingSectionTitle: (p) => `• 加工（加工加成 ${p.pct}）：净额 ${p.net}`,
            primaryOutputsHeaderGathering: (p) => `主要产出：${p.label}（${p.count} 项）`,
            primaryOutputsHeaderProduction: (p) => `主要产出：${p.label}${p.gourmetSuffix}`,
            gourmetSuffixParen: (p) => `（美食 ${p.pct}）`,
            dropLine: (p) => `• ${p.itemName}：${p.rate}（${p.pct}） → ${p.revenue}`,
            essenceDropsHeader: (p) => `精华掉落：${p.label}（${p.count} 项，精华发现 ${p.pct}%）`,
            rareFindsHeader: (p) => `稀有掉落：${p.label}（${p.count} 项，${p.summary}）`,
            drinkCostLineNoEach: (p) => `• ${p.name}：${p.rate} @ ${p.price}${p.missingNote} → ${p.revenue}`,
            drinkCostLineEach: (p) => `• ${p.name}：${p.rate} @ ${p.price}${p.missingNote}/份 → ${p.revenue}`,
            drinkCostsHeader: (p) => `饮品成本：${p.label}（${p.count} 种）`,
            artisanReductionNote: (p) => `（基础 ${p.baseAmount}，工匠茶 -${p.pct} 🍵）`,
            materialCostLine: (p) =>
                `• ${p.name}：${p.rate}${p.artisanNote} @ ${p.price}${p.missingNote}${p.customNote} → ${p.revenue}`,
            materialCostsHeader: (p) => `材料成本：${p.label}（${p.count} 种）`,
            marketTaxLine: (p) => `• 市场税：收入的 ${p.pct}% → ${p.label}`,
            marketTaxSectionTitle: (p) => `市场税：${p.label}（${p.pct}%）`,
            marketTaxExcludedLabel: '已排除',
            marketTaxExcludedLine: '• 市场税：已排除（自产自用）',
            marketTaxExcludedSectionTitle: '市场税：已排除',
            sellTaxExcludedWarning: '⚠ 已排除出售税——假设你自留此产出物，而非按实际出售价格计价',
            modifierRow: (p) => `${p.icon}+${p.value}% ${p.label}`,
            levelAdvantageLabel: '等级优势',
            houseRoomLabel: '房屋房间',
            teaLabel: '茶',
            equipmentLabel: '装备',
            communityBuffLabel: '社群增益',
            achievementLabel: '成就',
            scrollOfEfficiencyLabel: '效率卷轴',
            scrollOfGatheringLabel: '采集卷轴',
            houseRoomsPluralLabel: '房屋房间',
            scrollOfRareFindLabel: '稀有发现卷轴',
            guildShrineLabel: '公会神殿',
            efficiencyLabel: '效率',
            gatheringQuantityLabel: '采集数量',
            rareFindLabel: '稀有发现',
            modifierSectionTitle: (p) => `${p.title}：+${p.total}`,
            artisanSectionTitle: (p) => `工匠：-${p.value}`,
            gourmetSectionTitle: (p) => `美食：+${p.value}`,
            modifierSummaryEff: (p) => `+${p.value}% 效率`,
            modifierSummaryGather: (p) => `+${p.value}% 采集`,
            modifierSummaryRare: (p) => `+${p.value}% 稀有`,
            modifierSummaryArtisan: (p) => `-${p.value} 工匠`,
            modifierSummaryGourmet: (p) => `+${p.value} 美食`,
            artisanReductionSentence: (p) => `工匠茶：材料需求 -${p.value}`,
            gourmetBonusSentence: (p) => `美食茶：额外产出 +${p.value}`,
            modifiersHeader: '加成',
            perHourBreakdownTitle: '每小时明细',
            perActionBreakdownTitle: '每次操作明细',
            profitabilityTitle: '盈利能力',
            actionsCountBreakdownTitle: (p) => `${p.count} 次操作明细`,
        },
        marketHistory: {
            modalTitle: '市场历史',
            searchItemsPlaceholder: '搜索物品…',
            allTypesOption: '全部类型',
            buyOrdersOption: '买单',
            sellOrdersOption: '卖单',
            allStatusesOption: '全部状态',
            activeOnlyOption: '仅活跃',
            filledOnlyOption: '仅已成交',
            filledOrActiveOption: '已成交或活跃',
            canceledOnlyOption: '仅已取消',
            expiredOnlyOption: '仅已过期',
            unknownOnlyOption: '仅未知',
            exportCsvButton: '导出 CSV',
            importDataButton: '导入市场数据',
            clearHistoryButton: '清空历史',
            kmbFormatLabel: 'K/M/B 格式',
            totalListingsStats: (p) => `共 ${p.count} 条挂单`,
            dateFilterBadge: (p) => `日期：${p.range}`,
            itemsSelectedBadge: (p) => `已选 ${p.count} 项物品`,
            noEnhancementLabel: '无强化',
            enhLevelBadge: (p) => `强化等级：${p.level}`,
            enhLevelsSelectedBadge: (p) => `强化等级：已选 ${p.count} 项`,
            typeBadge: (p) => `类型：${p.type}`,
            buyLabel: '购买',
            sellLabel: '出售',
            clearAllFiltersButton: '清除全部筛选',
            columnDate: '日期',
            columnItem: '物品',
            columnEnhLvl: '强化等级',
            columnType: '类型',
            columnStatus: '状态',
            columnPrice: '价格',
            columnQuantity: '数量',
            columnFilled: '已成交',
            columnTotal: '总计',
            noListingsFound: '未找到挂单',
            statusActive: '活跃',
            statusFilled: '已成交',
            statusCanceled: '已取消',
            statusExpired: '已过期',
            statusUnknown: '未知',
            deleteListingTitle: '删除此挂单',
            rowsPerPageLabel: '每页条数：',
            showAllLabel: '显示全部',
            pageInfo: (p) => `第 ${p.current}/${p.total} 页`,
            showingAllListings: (p) => `正在显示全部 ${p.count} 条挂单`,
            csvEmptyError: 'CSV 文件为空或无效',
            importingFromCsv: (p) => `正在从 CSV 导入 ${p.count} 条挂单…`,
            importCompleteAlert: (p) =>
                `导入完成！\n\n新增挂单：${p.imported} 条\n跳过：${p.skipped} 条重复或无效记录\n挂单总数：${p.total} 条`,
            importFailedAlert: (p) => `导入失败：${p.error}`,
            csvTruncatedError:
                '文件似乎被截断或不完整，JSON 未正常结束。请重新从 Edible Tools 导出，或改用市场历史查看器导出为 CSV 后再导入。',
            marketListArrayError: 'market_list 必须是数组，或是包含数组的 JSON 字符串',
            unrecognizedFormatError:
                '无法识别的格式。支持的格式：\n- 直接数组：[{listing1}, {listing2}, ...]\n- 对象格式：{"market_list": [...]}\n- Edible Tools 格式：{"market_list": "[...]"}',
            noListingsInFileError: '文件中未找到挂单，或数组为空',
            importingListings: (p) => `正在导入 ${p.count} 条挂单…`,
            importCompleteDuplicatesAlert: (p) =>
                `导入完成！\n\n新增挂单：${p.imported} 条\n跳过：${p.skipped} 条重复记录\n挂单总数：${p.total} 条`,
            clearHistoryConfirm: (p) =>
                `⚠️ 警告：此操作将永久删除全部市场历史数据！\n你即将删除 ${p.count} 条挂单。\n建议：先点击“导出 CSV”按钮备份数据。\n此操作无法撤销！\n确定要继续吗？`,
            clearHistorySuccessAlert: '市场历史已清空。',
            clearHistoryFailedAlert: (p) => `清空历史失败：${p.error}`,
            filterByDateTitle: '按日期筛选',
            availableRangeLabel: (p) => `可选范围：${p.range}`,
            fromLabel: '开始：',
            toLabel: '结束：',
            applyButton: '应用',
            filterByItemTitle: '按物品筛选',
            filterByEnhancementTitle: '按强化等级筛选',
            filterByTypeTitle: '按类型筛选',
            csvHeaderEnhancement: '强化',
            csvHeaderId: 'ID',
        },
        tooltipPrices: {
            noMarketDataLabel: '暂无市场数据',
            allDropsHeader: (p) => `全部掉落物（共 ${p.count} 项）：`,
            alternativeActionsHeader: '备选操作：',
            askHeader: '卖价',
            bidHeader: '买价',
            buyItemName: (p) => `购买 ${p.itemName}`,
            costPerItemLine: (p) => `成本：${p.cost}/个`,
            countHeader: '数量',
            craftItemName: (p) => `制作 ${p.itemName}`,
            decomposeValueLine: (p) => `分解价值：${p.ask} / ${p.bid}`,
            dropNoPriceLine: (p) => `• ${p.itemName}（${p.dropRate}）：平均 ${p.avgCount} → 暂无价格数据`,
            dropWithPriceLine: (p) => `• ${p.itemName}（${p.dropRate}%）：平均 ${p.avgCount} → ${p.value}`,
            effLine: (p) => `有效：${p.ask} / ${p.bid}`,
            expectedReturnLine: (p) => `预期回报：${p.value}`,
            expectedValueHeaderLabel: '预期价值',
            foundInLabel: '出现于：',
            gatheringHeaderLabel: '采集',
            itemsPerDayUnit: (p) => `${p.value} 个/天`,
            itemsPerHourUnit: (p) => `${p.value} 个/时`,
            keyCostLine: (p) => `- 钥匙成本：${p.value}`,
            keyCostNamedLine: (p) => `- 钥匙成本（${p.name}）：${p.value}`,
            learnedLabel: '✔ 已学习',
            levelLine: (p) => `等级：${p.level}`,
            materialHeader: '材料',
            maxLevelReachedLabel: '已达最高等级',
            netAfterKeyLine: (p) => `扣除钥匙后净值：${p.value}`,
            netLine: (p) => `净值：${p.perHour}/时（${p.perDay}/天）`,
            netValueLine: (p) => `净值：${p.value}`,
            priceLine: (p) => `价格：${p.ask} / ${p.bid}${p.total}`,
            priceNoDataLine: (p) => `价格：${p.noData}`,
            profitHeaderLabel: '利润',
            profitSummaryLine: (p) => `利润：${p.perAction}/次，${p.perHour}/时，${p.perDay}/天`,
            profitsHeader: '利润：',
            progressLine: (p) => `进度：${p.percent}`,
            soloActionLine: (p) =>
                `• ${p.actionName}：${p.itemsPerHour} 个/时 | ${p.profitPerHour}/时（${p.profitPerDay}/天）`,
            soloLabel: '单人：',
            top10DropsHeader: (p) => `掉落物前 10（共 ${p.count} 项）：`,
            top5DropsHeader: (p) => `掉落物前 5（共 ${p.count} 项）：`,
            totalFromDropsLine: (p) => `${p.count} 项掉落物合计：${p.value}`,
            totalLabel: '总计',
            unlearnedLabel: '⚠ 未学习',
            xpToNextLine: (p) => `距下一级还需经验：${p.xp}`,
            zoneActionLine: (p) => `• ${p.actionName}：${p.itemsDisplay}（${p.dropRate}% 掉落）`,
        },
        philoCalculator: {
            launcherButtonLabel: 'Philo Gamba',
            panelTitle: '贤者之石计算器',
            philoPriceLabel: '贤者之石价格：',
            catalystPriceLabel: '催化剂价格：',
            usePrimeCatalystLabel: '使用上等催化剂',
            catalyticTeaBoostLabel: (p) => `催化茶（${p.percent}）`,
            catalyticTeaUnavailableLabel: '催化茶（不可用）',
            drinkConcentrationLabel: '饮品浓度：',
            hideNegativeProfitLabel: '隐藏负利润项',
            filterLabel: '筛选：',
            refreshPricesButton: '刷新价格',
            refreshingPricesStatus: '刷新中…',
            colPhiloChance: '贤者石 %',
            colReturnChance: '返还 %',
            colBaseTransmuteChance: '基础转化 %',
            colEffTransmuteChance: '有效转化 %',
            colTransmuteCost: '转化成本',
            colItemsPerAction: '物品/次',
            colActionsPerPhilo: '次数/贤者石',
            colItemsPerPhilo: '物品/贤者石',
            colProfitPerPhilo: '利润/贤者石',
            colProfitMargin: '利润率',
            colTimePerPhilo: '耗时/贤者石',
            colProfitPerHour: '利润/时',
            colRevenuePerHour: '收入/时',
            colCostPerHour: '成本/时',
        },
        marketplaceShortcuts: {
            actionDropdownLabel: '市场操作',
            addModeToggleTooltip: '切换累加模式：点击后数量累加，而非直接设置',
            buyNowLabel: '立即购买',
            newBuyListingLabel: '新建买单',
            newSellListingLabel: '新建卖单',
            ownedLabel: '拥有：',
            sellNowLabel: '立即出售',
            topAskAgeSubtitle: (p) => `最优卖价：~${p.age}`,
        },
        tooltipConsumables: {
            cooldownLine: (p) => `冷却：${p.seconds} 秒（每日 ${p.uses} 次）`,
            costNoDataLabel: '花费：暂无市场数据',
            costPerPointLine: (p) => `花费：每点 ${p.type} ${p.cost}`,
            dailyMaxLine: (p) => `每日上限：${p.amount} ${p.type}`,
            recoveryTimeLine: (p) => `恢复时间：${p.seconds} 秒`,
            restoresInstantLine: (p) => `恢复：${p.amount} ${p.type}（立即）`,
            restoresPerSecondLine: (p) => `恢复：${p.amount} ${p.type}/秒`,
            statsHeaderLabel: '消耗品属性',
        },
        listingPriceDisplay: {
            topOrderPriceHeader: '最优订单价格',
            topOrderAgeHeader: '最优订单时长',
            topOrderAgeHeaderTooltip: '预估最优竞争订单的挂单时长',
            totalPriceHeader: '总价',
            listedHeader: '挂单时长',
            clickToSortByTooltip: (p) => `点击按${p.text}排序`,
            progressColumnLabel: '进度',
            collectColumnLabel: '领取',
        },
        marketOrderTotals: {
            noOrdersTitle: '暂无市场订单',
            buyOrdersTooltip: '买单（锁定在买单中的金币）',
            buyOrdersLabel: '买单：',
            sellOrdersTooltip: '卖单（税后预期收益）',
            sellOrdersLabel: '卖单：',
            unclaimedTooltip: '待领取的金币',
        },
        marketFilter: {
            levelMinLabel: '等级 ≥ ',
            levelMaxLabel: '等级 < ',
            classLabel: '职业：',
            slotLabel: '槽位：',
            othersOption: '其他',
        },
        estimatedListingAge: {
            ageColumnHeader: '~时长',
            unknownAgeLabel: '~未知',
            ageColumnHeaderTooltip: '挂单预计时长（根据挂单 ID 推算）',
            stalenessTooltip: (p) => `订单簿数据为 ${p.relativeTime} 前的记录——请前往市场页面刷新`,
            stalenessTooltipUnknown: '订单簿数据——请前往市场页面刷新',
        },
        tradeHistoryDisplay: {
            buyPriceTooltip: '你的最近购买价',
            buyValueLabel: (p) => `购买 ${p.value}`,
            lastLabel: '最近：',
            sellPriceTooltip: '你的最近出售价',
            sellValueLabel: (p) => `出售 ${p.value}`,
        },
        marketSort: {
            sortByProfitButton: '按利润排序',
            resetOrderButton: '重置排序',
            sortingInProgress: (p) => `排序中… ${p.arrow}`,
            sortByProfitWithArrow: (p) => `按利润排序 ${p.arrow}`,
        },
        marketDepthCap: {
            sellDepthLabel: (p) => `出售深度：${p.hitBookEnd ? '至少 ' : '约'}${p.count} 次操作`,
            tooltipEstimate:
                '预估可见订单簿在边际卖价跌破成本前，能够吸纳的该物品操作次数。未计入市场可交易范围的下限（游戏数据未公开），因此大规模抛售可能会先触及该下限、进入队列延迟，早于本估算的提示。',
            tooltipHitBookEnd:
                '所有可见挂买单仍高于成本——实际上限可能高于显示值。未计入市场可交易范围的下限（游戏数据未公开），因此大规模抛售可能会先触及该下限、进入队列延迟，早于本估算的提示。',
        },
        queueLengthEstimator: {
            bestBuyPriceTooltip: '最优买价处的挂单总量',
            bestSellPriceTooltip: '最优卖价处的挂单总量',
            estimatedTooltip: (p) => `预估队列总深度（根据 ${p.count} 个可见订单外推）`,
        },
        networthCalculator: {
            guildBuffDisplayName: (p) => `${p.shrine}神殿 - ${p.type}`,
            otherCategoryFallbackLabel: '其他',
            shrineFallbackLabel: '神殿',
        },
        pricingMode: {
            instantBuyInstantSell: '即时购买 / 即时出售',
            patientBuyInstantSell: '耐心购买 / 即时出售',
        },
        listingNextNavigator: {
            backToMyListingsLabel: '返回我的挂单',
            nextLabel: (p) => `下一个（${p.index}/${p.total}）`,
        },
        networkAlert: {
            marketDataUnavailable: '⚠️ 市场数据不可用',
            outdatedData: '⚠️ 正在使用过期的市场数据',
        },
        marketData: {
            outlierPriceWarningTooltip:
                '该价格明显偏离游戏官方参考市场价值的正常区间，因此 Toolasha 已改用参考价值。可在“设置 → 定价与利润”中调整或关闭此功能。',
        },
        listingRefreshNavigator: {
            refreshButtonLabel: '刷新',
        },
        inventorySort: {
            sortLabel: '排序：',
            askButtonLabel: '卖价',
            bidButtonLabel: '买价',
            noneButtonLabel: '无',
        },
        requiredMaterials: {
            artisanTeaOutOfStock: '⚠ 工匠茶已耗尽——显示完整材料数量',
            missingSuffix: (p) => ` | 缺少：${p.count}`,
            queuedSuffix: (p) => `（已排队 ${p.count}）`,
            requiredLine: (p) => `需要：${p.required}${p.queuedSuffix}`,
        },
        budgetCalculator: {
            modalTitle: '预算计算器',
            budgetSummaryLine: (p) =>
                `预算：<strong style="color:#fff;">${p.budget}</strong>&nbsp;→&nbsp;<strong style="color:#7ec87e;">${p.units} 单位</strong>`,
            noData: '暂无数据',
            colIngredient: '原料',
            colRequired: '所需',
            colOnHand: '现有',
            colToBuy: '待购',
            colAskPrice: '卖单价',
            colTotalCost: '总成本',
            perUnitCostLabel: '单位成本（按卖价）',
            totalSpendLabel: '总支出',
            budgetInputPlaceholder: '预算（如 50m）',
            calculateButton: '计算',
            viewLastBreakdownTooltip: '查看上次明细',
        },
        costSummary: {
            title: '成本汇总',
            bestCraftingPlanLabel: '最佳制作方案',
            directRecipeCostLabel: '配方直接成本',
            finishedItemMarketLabel: '成品市场价',
            missingDirectMatsLabel: '缺少直接材料',
            partialDataTooltip: '数据不完整——部分材料暂无市场数据',
        },
        drinkTimer: {
            queueOutlastsWarning: (p) =>
                `⚠ 队列时长（${p.queueTime}）将超过${p.drinkName}的持续时间，超出 ${p.shortfallTime}`,
        },
        equipmentResolver: {
            noCompleteRouteReason: '无法为完整获取路线定价',
        },
        remainingXp: {
            xpLeftLabel: (p) => `剩余 ${p.value} 经验`,
        },
        inlineXpRate: {
            expectedPrefix: '预计：',
            rateLine: (p) => `· ${p.prefix}${p.value} 经验/时`,
            rateTooltip: (p) => `${p.prefix}${p.value} 经验/时`,
        },
        quickInputButtons: {
            toggleAddModeTooltip: '切换累加模式：点击后数量累加，而非直接设置',
            doPrefixLabel: '执行 ',
            timesSuffixLabel: ' 次',
            guildShrineBonusLine: (p) => `  - 公会神殿：+${p.pct}%`,
            taskSpeedTimeChangeLine: (p) => `${p.before} 秒${p.clampSuffix} → ${p.after} 秒 | ${p.rate}/时`,
            xpScrollOfWisdomLine: '智慧卷轴：+{{value}}%',
            xpGuildShrineLine: '公会神殿：+{{value}}%',
            actionsToLevelResult: '{{actions}} 次操作 → 等级 {{level}}（距下一级 {{percent}}%）| {{time}}',
        },
        maxProduceable: {
            canProduceLine: (p) => `可生产：${p.count}`,
            effXpPerHourLine: (p) => `有效经验/时：${p.value}`,
            expPerHourLine: (p) => `经验/时：${p.value}`,
            goldNeutralTooltip: (p) => `金币中性经验速率
本操作：${p.expPerHour} 经验/时，-${p.loss}/时
回补：${p.bestProfitName}（+${p.bestProfit}/时，${p.bestProfitExp} 经验/时）
比例：每操作 1 小时需 ${p.ratio} 小时回补
综合：(${p.expPerHour} + ${p.ratio} × ${p.bestProfitExp}) / ${p.ratioPlus1} = ${p.effXp}`,
            pinTooltip: '固定此操作以保持显示',
            profitPerHourLine: (p) => `利润/时：${p.sign}${p.value}${p.note}`,
            profitUnknownLine: '利润/时：-- ⚠',
            sellTaxExcludedTooltip:
                '已排除出售税——假设你自留此产出物，而非按实际出售价格计价。若打算出售，请在技能页面关闭此开关。',
            unpinTooltip: '取消固定此操作',
        },
        houseCostDisplay: {
            totalMarketValueLine: (p) => `市场总价值：${p.value}`,
            cumulativeToLevelLabel: '升至该级累计：',
            missingAmountLabel: (p) => `缺少：${p.value}`,
            returnToHouseTabLabel: '↩ 返回房屋',
        },
        guildCreditValue: {
            returnTabLabel: '↩ 返回',
            returnLabelFallback: '公会',
            tokensLabel: '（代币）',
            rankingHeader: '每点信用点的金币成本——点击排序',
            columnItem: '物品',
            columnRate: '比率',
            columnAskEach: '卖价/个',
            columnBidEach: '买价/个',
            columnAskPerCredit: '卖价/信用点',
            columnBidPerCredit: '买价/信用点',
            tokenValueNote: '公会代币价值是指：若改走最便宜的物品兑换路线，原本需要花费的金币，而非市场价格。',
            shrineForce: '力量',
            shrineTempo: '节奏',
            shrineRarity: '稀有',
            shrineScholar: '学者',
            shrineSpirit: '精神',
            shrinePlannerHeader: '神殿升级规划',
            shrinePlannerEmptyHint: '将目标等级设为高于当前等级即可查看成本',
            shrinePlannerTotalCostTitle: '升级总成本',
            guildTokensLabel: '公会代币',
            shrineSectionTitle: (p) => (p.cap ? `${p.shrine}神殿（上限：${p.cap}）` : `${p.shrine}神殿`),
            buffLabelCombat: '战斗',
            buffLabelSkilling: '生产',
            buffRowLabel: (p) => `${p.buffLabel}（等级 ${p.level}）`,
            ownedSuffix: (p) => `（拥有 ${p.count}）`,
            advisorSelectItemHint: '选择物品以查看兑换建议',
            advisorNoConversionHint: '所选物品无法兑换此类信用点',
            advisorOptimalChoice: '✓ 此类信用点的最优选择',
            advisorNoPriceData: (p) => `最优：${p.name}——暂无价格数据可供比较`,
            advisorBetterLabel: '↑ 更优',
            advisorWorseLabel: '↓ 更差',
            advisorSellRebuyHeader: (p) => `出售后回购最优物品（税率 ${p.taxPercent}%）`,
            advisorDirectExchangeLabel: '直接兑换',
            advisorSellProceedsLabel: '出售所得（税后）',
            advisorBuyLabel: (p) => `购买 ${p.name} → 信用点`,
            advisorDifferenceLabel: '差额',
            creditsAmount: (p) => `${p.amount} 点信用点`,
            differenceValue: (p) => `${p.sign}${p.amount} 点信用点，${p.label}`,
            allButtonLabel: '全部',
            fillMaxTooltip: (p) => `填入最大值：${p.amount}`,
            copyListButtonLabel: '复制列表',
            copiedButtonLabel: '已复制！',
            totalRowLabel: '总计',
            upgradeCostHeader: '升级的金币成本——点击排序',
            columnQty: '数量',
            columnAskCost: '卖价成本',
            columnBidCost: '买价成本',
            unpricedItemsNote: '* 部分物品暂无市场价格数据',
            missingMatsButtonLabel: '缺失材料市场',
        },
        networthHistoryChart: {
            categoryGold: '金币',
            categoryInventory: '物品栏',
            categoryEquipment: '装备',
            categoryListings: '挂单',
            categoryHouse: '房屋',
            categoryAbilities: '能力',
            range24hLabel: '24时',
            range7dLabel: '7天',
            range30dLabel: '30天',
            rangeAllLabel: '全部',
            rangeCustomLabel: '区间',
            modalTitle: '净资产历史',
            connectGapsButton: '连接断点',
            showBarsButton: '显示柱状图',
            avgLabel: '均值：',
            movingAvgOffOption: '关闭',
            movingAvgCustomOption: '自定义…',
            promptMovingAvgWindow: '请输入移动平均窗口（小时）：',
            fromLabel: '从：',
            toLabel: '到：',
            totalChipLabel: '总计',
            nonExcludedLabel: '未排除',
            totalNetWorthDatasetLabel: '总净资产',
            barsDatasetLabel: '净资产（柱状图）',
            movingAvgDatasetLabel: '{{window}} 移动平均',
            categoryValueAxisTitle: '分类价值',
            netWorthAxisTitle: '净资产',
            noDataForRangeMessage: '<span style="color: #666;">该时间范围内暂无数据</span>',
            currentTotalLine: '当前：<strong style="color: {{color}};">{{value}}</strong>',
            clickForBreakdownTooltip: '点击查看物品明细',
            lastRangeChangeLine:
                '近 {{range}}：<strong style="color: {{color}};">{{sign}}{{value}}（{{sign}}{{percent}}%）</strong>{{arrow}}',
            rateLine: '速率：<strong style="color: {{color}};">{{sign}}{{value}}/时</strong>',
            nonExclCurrentLine:
                '<span style="color: #a78bfa;">未排除</span>：<strong style="color: #a78bfa;">{{value}}</strong>',
            nonExclChangeSuffix:
                ' <span style="font-size: 11px; color: #aaa;">（{{sign}}<span style="color: {{color}};">{{value}}</span> {{range}}）</span>',
            rateSuffixSpan:
                ' <span style="font-size: 11px; color: #aaa;">{{sign}}<span style="color: {{color}};">{{value}}/时</span></span>',
            categoryLastRangeLine: '{{label}}：<strong style="color: {{color}};">近 {{range}}：{{sign}}{{value}}</strong>',
            noLiveDataMessage: '<span style="color: #666;">暂无实时数据</span>',
            noDetailSnapshotMessage: '<span style="color: #666;">暂无详细快照（数据每小时收集一次）</span>',
            sellListingItemLabel: '卖单：{{name}}',
            buyListingItemLabel: '买单：{{name}}',
            noItemChangesMessage: '<span style="color: #666;">过去 24 小时内无物品级变化</span>',
            activityHeading: '活动',
            marketMovementHeading: '市场波动',
            roundingLabel: '舍入',
            otherHeading: '其他',
            comparedToSnapshotLine:
                '<div style="color: #555; font-size: 10px; margin-top: 6px; text-align: right;">与 {{hours}} 小时前的快照对比</div>',
            totalTooltipLine: '<div style="color:#4ade80;">&#9632; 总计：{{value}}{{delta}}</div>',
            excludedLabel: '已排除',
            categoryTooltipLine: '<div style="color:#ccc; padding-left:12px;">{{label}}：{{value}}{{delta}}</div>',
            deletePointButton: '删除此数据点',
            movingAvg12hOption: '12小时',
            movingAvg24hOption: '24小时',
            movingAvg3hOption: '3小时',
            movingAvg48hOption: '48小时',
            movingAvg6hOption: '6小时',
            movingAvg7dOption: '7天',
            movingAvgCustomHoursOption: (p) => `${p.hours}小时`,
        },
        networthDisplay: {
            goldLabelLine: (p) => `金币：${p.value}`,
            networthLoadingMessage: '净资产加载中…',
            netWorthLabel: (p) => `净资产：${p.value}`,
            netWorthHistoryChartTooltip: '净资产历史图表',
            configureExclusionsTooltip: '配置净资产排除项',
            currentAssetsLabel: (p) => `当前资产：${p.value}`,
            equipmentValueLabel: (p) => `装备价值：${p.value}`,
            inventoryValueLabel: (p) => `物品栏价值：${p.value}`,
            marketListingsLabel: (p) => `市场挂单：${p.value}`,
            fixedAssetsLabel: (p) => `固定资产：${p.value}`,
            housesLabel: (p) => `房屋：${p.value}`,
            abilitiesLabel: (p) => `能力：${p.value}`,
            equippedAbilitiesLabel: (p) => `已装备（${p.count}）：${p.value}`,
            otherAbilitiesCountLabel: (p) => `其他（${p.count}）：${p.value}`,
            otherAbilitiesLabel: (p) => `其他能力：${p.value}`,
            abilityBooksCountLabel: (p) => `能力书（${p.count}）：${p.value}`,
            abilityBooksLabel: (p) => `能力书：${p.value}`,
            guildShrinesLabel: (p) => `公会神殿：${p.value}`,
            excludedLabel: (p) => `已排除：${p.value}`,
            coinLabel: (p) => `金币：${p.value}`,
            noHousesBuiltMessage: '尚未建造房屋',
            noAbilitiesMessage: '暂无能力',
            noAbilityBooksMessage: '暂无能力书',
            noGuildShrineBuffsMessage: '未购买任何公会神殿增益',
            noEquipmentMessage: '暂无装备',
            noMarketListingsMessage: '暂无市场挂单',
            noInventoryMessage: '物品栏为空',
            evPerChestLabel: (p) => `期望值：${p.value}/箱`,
            keyLabelWithName: (p) => `钥匙（${p.name}）`,
            keyCostLabel: '钥匙成本',
            netPerChestLabel: (p) => `净值：${p.value}/箱`,
        },
        networthExclusionPopup: {
            allEquippedItemsLabel: '所有已装备物品',
            allMarketListingsLabel: '所有市场挂单',
            allHousesLabel: '所有房屋',
            allAbilitiesLabel: '所有能力',
            allAbilityBooksLabel: '所有能力书',
            allGuildShrinesLabel: '所有公会神殿',
            categoryNameSuffix: (p) => `${p.name}（分类）`,
            loadoutNameLabel: (p) => `配装：${p.name}`,
            popupTitle: '净资产排除项',
            currentExclusionsLabel: '当前排除项',
            noExclusionsConfiguredLabel: '尚未配置排除项',
            searchPlaceholder: '搜索物品、分类、房屋、配装…',
            noResultsMessage: '无匹配结果',
            removeButtonLabel: '✕ 移除',
            excludeButtonLabel: '+ 排除',
            removeExclusionTooltip: '移除此排除项',
        },
        guildXpDisplay: {
            activityColumn: '活动',
            allSignedUp: '全部已报名 ✓',
            anomalousSuffix: '（异常）',
            collectingData: '数据收集中',
            combatLabel: '战斗',
            daysCount: (p) => `${p.count} 天`,
            defaultWhisperTemplate: '/w {name} 你怎么还没报名试炼？！',
            etaBasedOnAverageTooltip: (p) => `预计耗时（基于${p.basis}平均值）：${p.rate} 经验/时`,
            etaLine: (p) => `预计：${p.eta}`,
            gameModeColumn: '游戏模式',
            gameModeIroncowAbbr: 'IC',
            gameModeLegacyIroncowAbbr: 'LC',
            gameModeStandardAbbr: 'MC',
            hoursCount: (p) => `${p.count} 小时`,
            joinedColumn: '加入时间',
            justNow: '刚刚',
            lastDayXph: '近一天经验/时',
            lastHourXph: '近一小时经验/时',
            lastWeekXph: '近一周经验/时',
            lastXph: '最近经验/时',
            lessThanOneMinute: '< 1 分钟',
            minutesCount: (p) => `${p.count} 分钟`,
            nextGuildLevelSlotHeading: '下一公会等级槽位 (+1)',
            noGuildXpGainedTooltip: (p) => `过去${p.period}内未获得公会经验`,
            noRecentGains: '近期无收益',
            noneLabel: '无',
            notEnoughDataForChart: '数据不足，无法生成图表',
            offlineLabel: (p) => `离线（${p.count}）`,
            onlineIdleLabel: (p) => `在线——闲置（${p.count}）`,
            period24Hours: '24 小时',
            periodOneHour: '一小时',
            skillingLabel: '生产',
            toLevelXp: (p) => `距 Lv ${p.level} · ${p.xp} 经验`,
            unsignedListLabel: (p) => `${p.label}（${p.count} 人未报名）：`,
            weeksCount: (p) => `${p.count} 周`,
        },
    };

    /**
     * zh batch e — tasks-actions-misc namespaces.
     * Split from the former single zh.js; values here are Simplified Chinese UI strings.
     */
    var batchE = {
        dragToMoveTooltip: '拖动以移动',
        externalLinks: {
            combatSim: 'Combat Sim',
            enhancelator: 'Enhancelator',
            milkonomy: 'Milkonomy',
            sockosCombatTracker: "Socko's Combat Tracker",
            mwilinks: 'mwilinks',
        },
        customTabsUi: {
            emptyTabsMessage: '还没有自定义标签页，点击“+ 标签页”创建一个。',
            addTabButton: '+ 标签页',
            exportButton: '导出',
            importButton: '导入',
            expandAllButton: '展开全部',
            collapseAllButton: '收起全部',
            clearAllTabsButton: '清空全部',
            clearAllTabsConfirm: '确定删除所有标签页及其分类结构吗？此操作无法撤销。',
            importCategoriesButton: '导入分类',
            invalidLayoutFileAlert: '[Toolasha] 布局文件无效。',
            failedReadLayoutFileAlert: '[Toolasha] 读取布局文件失败。',
            editTabTooltip: '编辑标签页',
            addSubtabTooltip: '添加子标签页',
            deleteTabTooltip: '删除标签页',
            itemsHiddenWarningTooltip: '这些物品处于隐藏状态——请在物品栏标签页中展开对应分类，即可在此显示。',
            unorganizedHeaderLabel: (p) => `未分类（${p.count}）`,
            editTabModalTitle: '编辑标签页',
            nameFieldLabel: '名称',
            colorFieldLabel: '颜色',
            addCategoryLabel: '添加分类',
            allItemsCheckboxLabel: '所有物品',
            fromLoadoutLabel: '从配装添加',
            itemsFieldLabel: '物品',
            searchItemsToAddPlaceholder: '搜索要添加的物品…',
            catFilterAllOption: '全部',
            addLineBreakButton: '+ 换行',
            deleteTabButton: '删除标签页',
            customColorTooltip: '自定义颜色',
            confirmDeleteButton: '确认删除？',
            confirmClearButton: '确认清空？',
            addAllLevelsLabel: (p) => `+ 添加全部等级（+0 – +${p.maxLevel}）`,
            inInventoryTooltip: '在物品栏中',
            noMatchingItemsMessage: '未找到匹配的物品',
            noItemsAssignedMessage: '尚未分配任何物品',
            lineBreakLabel: '─── 换行 ───',
            moveToTopTooltip: '移到顶部',
            moveToBottomTooltip: '移到底部',
            removeCategoryTooltip: (p) => `点击以从${p.categoryName}移除 ${p.count} 个物品`,
            addCategoryTooltip: (p) => `从${p.categoryName}添加 ${p.count} 个物品`,
            noSavedLoadoutsMessage: '暂无已保存的配装。',
            loadoutButtonLabel: (p) => `${p.name}（${p.skillLabel}）${p.unavailable ? ' — 不可用' : ''}`,
            loadoutUnavailableTooltip: (p) => `已保存的装备不可用，无法添加“${p.name}”`,
            loadoutAllAddedTooltip: (p) => `“${p.name}”中的所有物品均已添加`,
            loadoutAddItemsTooltip: (p) => `从“${p.name}”添加 ${p.count} 个物品`,
            addToTabLabel: '添加到标签页',
            addToTabTooltip: '添加到此标签页',
            removeFromTabTooltip: '从此标签页移除',
            newTabDropdownOption: '+ 新建标签页',
            newTabDefaultName: '新标签页',
            untitledTabNameFallback: '未命名',
        },
        lootLogStats: {
            durationSubSecond: (p) => `${p.seconds}秒`,
            durationHoursUnit: (p) => `${p.value}时`,
            durationMinutesUnit: (p) => `${p.value}分`,
            durationSecondsUnit: (p) => `${p.value}秒`,
            totalValueEmpty: '总价值：—',
            totalValueHeader: (p) => `▶ 总价值：${p.ask}/${p.bid}`,
            totalXpLine: (p) => `总经验：${p.xp}`,
            coinsLabel: '金币',
            dailyOutputEmpty: '每日产出：—',
            dailyOutputValue: (p) => `每日产出：${p.ask}/${p.bid}`,
            historicalEntriesSeparator: (p) => `— 历史记录（${p.count}）—`,
            showMoreButton: (p) => `显示更多（剩余 ${p.remaining} 条）`,
            countSuffixParen: (p) => `（${p.count}）`,
            categoryDashName: (p) => (p.category ? `${p.category} - ${p.name}` : p.name) + p.suffix,
            startTimeLine: (p) => `开始时间：${p.time}`,
            durationLine: (p) => `持续时间：${p.duration}`,
            unknownActionFallback: '未知',
            analyticsButtonTooltip: '掉落与经验日志分析（透视表）',
            tierSuffixParen: (p) => `（层级 ${p.tier}）`,
            analyticsPanelTitle: '📊 掉落与经验日志分析',
            subtitleWithHistory: (p) => `${p.actionCount} 个动作，来自 ${p.sessions} 个已存储会话`,
            subtitleSessionOnly: (p) => `${p.actionCount} 个动作，仅来自当前会话——启用“掉落日志历史”即可查看完整历史数据`,
            filterByActionPlaceholder: '按动作名称筛选…',
            colAction: '动作',
            colActions: '次数',
            colTotalTime: '总时间',
            colXp: '经验',
            colValueAskBid: '价值（卖价/买价）',
            colGoldPerHour: '金币/时',
            noActionsMatch: '没有匹配的动作。',
            sessionsCountLabel: (p) => `${p.count} 次会话`,
            perHourParen: (p) => `（${p.value}/时）`,
            totalColon: '总计：',
            footerTotalActions: (p) => `总计：${p.actions} 个动作，耗时 ${p.duration}`,
            footerTotalValue: (p) => `总价值（卖价/买价）：${p.ask}/${p.bid}`,
        },
        teaRecommendation: {
            xpButtonLabel: '经验',
            goldButtonLabel: '金币',
            bothButtonLabel: '两者',
            errorSkillNotDetected: '无法检测当前技能',
            errorNoAlchemyItemSelected: '炼金面板中未选择物品',
            dragToMoveTooltip: '拖动以移动',
            headerTitle: (p) =>
                `${p.target}的最优${p.goalLabel}/时${p.dcPercent > 0 ? `（饮品浓度 ${p.dcPercent}%）` : ''}`,
            alchemyTargetLabel: (p) => `${p.actionType}：${p.itemName}`,
            noValidCombinationsMessage: '在当前限制条件下没有有效的组合。',
            avgRateLine: (p) => `平均${p.goalLabel}/时：${p.value}`,
            levelBullet: (p) => `等级 ${p.level} •`,
            backToAllActionsLabel: (p) => `← 返回全部${p.skillName}动作`,
            goldActionsSummary: (p) =>
                `${p.profitableCount}/${p.totalCount} 个盈利${p.excludedCount > 0 ? `（+${p.excludedCount} 个已排除）` : ''}`,
            xpActionsSummary: (p) =>
                p.excludedCount > 0
                    ? `共 ${p.totalCount} 个动作（+${p.excludedCount} 个已排除）`
                    : `已评估 ${p.totalCount} 个动作`,
            clickToExpandTooltip: '点击展开',
            excludedActionsHeader: (p) => `已排除（${p.count} 个——等级过低）`,
            levelRequirementLabel: (p) => `等级 ${p.level}`,
            expandedAlchemyLabel: (p) => `▼ ${p.target}`,
            expandedGoldLabel: (p) =>
                `▼ ${p.profitableCount} 个盈利${p.excludedCount > 0 ? `（+${p.excludedCount}）` : ''}`,
            expandedXpLabel: (p) =>
                p.excludedCount > 0 ? `▼ ${p.totalCount}（+${p.excludedCount}）` : `▼ ${p.totalCount} 个动作`,
            teaCostLine: (p) => `茶饮成本：${p.cost}/时 ${p.arrow}`,
            costColTea: '茶饮',
            costColUnitsPerHour: '数量/时',
            costColUnitCost: '单价',
            costColCostPerHour: '花费/时',
            alternativesHeader: '备选方案：',
            alternativeCostSuffix: (p) => ` · 成本 ${p.cost}/时`,
            alternativeComboLine: (p) => `${p.teas}（${p.rate}/时${p.costSuffix}）`,
            teaConstraintsHeader: '茶饮限制：',
            removePinTooltip: '取消固定',
            pinTooltip: '固定（强制包含）',
            removeBanTooltip: '取消禁用',
            banTooltip: '禁用（强制排除）',
            optimalTeasForHeader: (p) => `${p.target}的最佳茶饮`,
            ratePerHourLabel: (p) => `${p.goalLabel}/时：${p.value}`,
        },
        pinnedActionsPage: {
            columnAction: '动作',
            columnSkill: '技能',
            columnLevel: '等级',
            columnProfitPerHour: '利润/时',
            columnExpPerHour: '经验/时',
            unknownSkill: '未知',
            navButtonLabel: '已固定',
            pageTitle: '已固定动作',
            tabOverview: '概览',
            tabMaterials: '材料',
            emptyStateTitle: '暂无已固定的动作',
            emptyStateHint: '点击动作图块上的 📌 图标即可固定，固定后会显示在这里。',
            noFilterMatches: '没有动作符合当前筛选条件。',
            noProductionActionsPinned: '尚未固定任何生产类动作',
            canProduceLabel: (p) => `可生产：${p.count}`,
            filterBySkillTitle: '按技能筛选',
            applyButton: '应用',
            clearButton: '清除',
        },
        taskProfitDisplay: {
            goldPerHourUnit: '金币/时',
            tokensPerHourUnit: '代币/时',
            missingPriceDataError: '缺少价格数据',
            unableToCalculateProfit: '无法计算利润',
            estimateModeTooltip: '单人：仅模拟目标怪物。区域：模拟整个区域的刷怪表。',
            zoneModeLabel: '区域',
            soloModeLabel: '单人',
            estimateButtonLabel: '估算',
            couldNotIdentifyMonster: '无法识别怪物。',
            noZoneFoundForMonster: '未找到该怪物所在的区域。',
            simulatingLabel: '模拟中…',
            combatLoadoutUnavailableMessage: (p) => `配装“${p.loadoutName}”不可用。请选择其他配装或当前装备。`,
            estimateFailedLabel: '估算失败。',
            retryLabel: '重试',
            taskProfitBreakdownTitle: '任务利润明细',
            monsterKillsSummary: (p) => `怪物：${p.monsterName} × ${p.count} 次击杀（${p.rate}/时）`,
            loadoutSummary: (p) => `配装：${p.loadoutName}`,
            taskRewardsLabel: '任务奖励：',
            coinsLine: (p) => `金币：${p.value}`,
            taskTokensLine: (p) => `任务代币：${p.value}`,
            tokensReceivedNote: (p) => `（${p.count} 个代币 @ ${p.value}/个）`,
            giftPerTaskNote: (p) => `（每个任务 ${p.value}）`,
            dropsLabel: (p) => `掉落物：${p.value}`,
            consumablesLabel: (p) => `消耗品：${p.value}`,
            rerunButtonLabel: '重新运行',
            zoneFallbackLabel: '区域',
            zoneSummaryLine: (p) => `${p.zoneName}：约 ${p.fights} 场战斗 | ${p.time}（瓶颈：${p.bottleneckName}）`,
            tokenValuesUnavailableNote: (p) => `${p.error}——代币价值不可用`,
            loadingEllipsis: '加载中…',
            actionProfitLabel: '动作利润：',
            gatheringValueLabel: (p) => `采集价值：${p.value}`,
            primaryOutputsLabel: (p) => `主要产出：${p.value}`,
            dropRateSuffix: (p) => `（${p.pct}% 掉落率）`,
            baseOutputItemLine: (p) => `${p.name}（基础）：${p.items} 个物品 @ ${p.price}${p.missingNote} = ${p.total}`,
            gourmetOutputItemLine: (p) =>
                `${p.name}（美食 ${p.pct}）：${p.items} 个物品 @ ${p.price}${p.missingNote} = ${p.total}`,
            gourmetOutputItemLinePlus: (p) =>
                `${p.name}（美食 +${p.pct}）：${p.items} 个物品 @ ${p.price}${p.missingNote} = ${p.total}`,
            processingNetLine: (p) => `加工（${p.pct}% 加工率）：净 ${p.label}`,
            materialConsumedLine: (p) => `${p.name} 消耗：-${p.amount} 个物品 @ ${p.price}${p.missingNote} = -${p.total}`,
            materialProducedLine: (p) => `${p.name} 产出：${p.amount} 个物品 @ ${p.price}${p.missingNote} = ${p.total}`,
            essenceDropsLabel: (p) => `精华掉落：${p.value}`,
            rareFindsLabel: (p) => `稀有发现：${p.value}`,
            dropLine: (p) => `${p.name}：${p.drops} 次掉落 @ ${p.price}${p.missingNote} = ${p.total}`,
            perActionNote: (p) => `（${p.qty}× @ ${p.value}/次）`,
            netProductionLabel: (p) => `净产出：${p.value}`,
            materialCostsLabel: (p) => `材料成本：${p.value}`,
            teaDrinksLine: (p) => `${p.name}：${p.drinks} 杯 @ ${p.price}${p.missingNote} = ${p.total}`,
            totalProfitLabel: (p) => `总利润：${p.value}`,
            baseSpeedLine: (p) => `基础：${p.base}秒 → ${p.after}秒`,
            speedBonusLine: (p) => `速度：+${p.pct} | ${p.rate}/时`,
            scrollOfActionSpeedLine: (p) => `动作速度卷轴：+${p.pct}`,
            taskSpeedMultiplicativeLine: (p) => `任务速度（乘算）：+${p.pct}%`,
            efficiencyOutputLine: (p) => `效率：+${p.pct}% → 产出：×${p.mult}（${p.rate}/时）`,
            levelEfficiencyLine: (p) => `等级：+${p.pct}%`,
            rawLevelDeltaLine: (p) => `原始等级差：+${p.pct}%（${p.skillLevel} - ${p.baseRequirement} 基础需求）`,
            levelImpactLine: (p) => `${p.name} 影响：${p.pct}%（提高需求）`,
            drinkConcentrationLine: (p) => `饮品浓度：${p.pct}%`,
            unknownRoomLabel: '未知房间',
            roomLevelLabel: (p) => `${p.roomName} · ${p.level} 级`,
            houseEfficiencyLine: (p) => `房屋：+${p.pct}%（${p.roomLabel}）`,
            equipmentEfficiencyLine: (p) => `装备：+${p.pct}%`,
            achievementEfficiencyLine: (p) => `成就：+${p.pct}%`,
            communityEfficiencyLine: (p) => `社区：+${p.pct}%（生产效率 T${p.tier}）`,
            sealEfficiencyLine: (p) => `封印：+${p.pct}%`,
            totalTimeLine: (p) => `总时间：${p.time}`,
            loadingMarketDataLabel: '正在加载市场数据…',
            activeIndicatorLabel: '进行中',
            queuedIndicatorLabel: '排队中',
        },
        profileExportButton: {
            exportButtonLabel: '导出到剪贴板',
            noDataAlert:
                '未找到角色数据。请：\n1. 刷新游戏页面\n2. 等待页面完全加载\n3. 重试\n\n如果你正在查看其他玩家的档案，请确保已在游戏内打开过该档案。',
            clipboardAccessDeniedAlert: '剪贴板访问被拒绝，请允许此网站使用剪贴板权限。',
            exportFailedAlert: (p) => `导出失败：${p.error}`,
        },
        taskTokenThreshold: {
            configureButtonTitle: '配置任务代币重掷阈值',
            popupTitle: '任务代币阈值',
            description: '当任务的任务代币奖励越过此临界值时标记该任务，提醒你进行重掷。',
            belowOption: '低于',
            aboveOption: '高于',
            thresholdPlaceholder: '例如 8',
            tokensLabel: '代币',
            disableButton: '禁用',
            highTokensFlag: '代币过多！',
            lowTokensFlag: '代币过少！',
        },
        craftingPlanDisplay: {
            pricingModeInstantBuy: '即时购买',
            pricingModeInstantBuyPatientSell: '即时购买 / 耐心出售',
            pricingModePatientBuyPatientSell: '耐心购买 / 耐心出售',
            pricingModePatientBuy: '耐心购买',
            artisanModeWorstCase: '最坏情况',
            artisanModeHybrid: '混合',
            pricingPillLabel: '定价：',
            artisanModePillLabel: '工匠模式：',
            artisanModeTooltip:
                '工匠茶节省量如何取整并计入材料数量：\n' +
                '预期——将节省量分摊到整批（平均值，遇到运气差的动作可能不够用）。\n' +
                '最坏情况——先对每个动作单独向上取整再乘以数量（最稳妥，但可能多买）。\n' +
                '混合——少于 100 个动作时按最坏情况，达到 100 个及以上时按预期。',
            matchQuantityLabel: '与动作面板数量一致',
            buyRawMaterialsOnlyLabel: '仅购买原材料',
            noProcessingLabel: '不加工（购买中间材料）',
            taskModeLabel: '任务模式（强制最后一步）',
            factorTimeCostLabel: '计入时间成本',
            strategyBuyFromMarket: '从市场购买',
            strategyCraftFromMaterials: '用材料制作',
            optimalStrategyLine: (p) => `最优方案：<strong>${p.strategy}</strong>`,
            unitCostPerEach: (p) => `${p.cost}/个`,
            marketBuyLine: (p) => `市场购买：${p.value}`,
            craftCostLine: (p) => `制作成本：${p.value}`,
            quantityLine: (p) => `数量：${p.quantity}`,
            totalLine: (p) => `总计：${p.value}`,
            bestCraftingPlanTitle: '最佳制作方案',
            buyMissingMaterialsButton: '购买缺少材料',
        },
        missingMaterialsButton: {
            enterQuantityTooltip: '输入数量以检查缺少的材料',
            noProtectionNeeded: '无需保护',
            protectFromLabel: (p) => `保护起点：+${p.level}`,
        },
        taskRerollProtection: {
            configureTooltip: '配置任务重掷保护',
            protectedTaskWarning: '受保护的任务！3 秒后解锁…',
            rerollAtCapWarning: '已达重掷上限！3 秒后解锁…',
            confirmRerollMessage: '再次点击重掷以确认。',
            popupTitle: '受保护的任务',
            searchPlaceholder: '搜索动作、怪物、区域…',
            noProtectedTasksMessage: '暂无受保护的任务，搜索以添加。',
            zoneTypeLabel: (p) => `区域（${p.count}）`,
            moreResultsRefineSearch: (p) => `…还有 ${p.count} 项（请细化搜索）`,
            blockRerollsAtLabel: '在此阈值阻止重掷',
            blockRerollsAtCapLabel: '达到上限时阻止重掷',
            capDisplayDefault: '320K💰 / 32🔔',
        },
        taskInventoryHighlighter: {
            highlightButtonLabel: '高亮任务物品',
            clearHighlightButtonLabel: '清除高亮',
        },
        notificationLog: {
            tabLabel: '日志',
            tabTooltip: '物品交易、升级、公会事件等通知的记录',
            mentionedByLine: (p) => `${p.sender} 在 ${p.channel} 中提到了你：${p.text}`,
            clearAllTooltip: '删除所有已记录的通知',
            clearAllConfirm: (p) => `确定删除全部 ${p.count} 条已记录的通知吗？此操作无法撤销。`,
            noEntriesMatchFilters: '没有符合当前筛选条件的通知。',
            deleteEntryTooltip: '删除此通知',
            categoryCommunity: '社区',
            categoryCosmetic: '外观',
            categoryGuild: '公会',
            categoryHouse: '房屋',
            categoryLabyrinth: '迷宫',
            categoryLoadout: '配装',
            categoryMentions: '提及',
            categoryOther: '其他',
            categoryParty: '队伍',
            categoryProgression: '进度',
            categoryPurchases: '购买',
            categoryReferral: '推荐',
            categorySocial: '社交',
            categoryTrading: '交易',
        },
        mentionPopup: {
            titleWithChannel: (p) => `提及——${p.channel}`,
            noMentionsMessage: '暂无提及',
        },
        taskRerollTracker: {
            rerollSpentPlaceholder: '重掷花费：–',
            rerollSpentLabel: (p) => `重掷花费：${p.value}`,
        },
        offlineProgressEconomics: {
            sourceLabelCoin: '金币面值',
            sourceLabelCowbell: '牛铃估值',
            sourceLabelDungeonToken: '地下城代币商店价值',
            sourceLabelExpectedValue: '预期价值',
            sourceLabelCustom: '自定义价格覆盖',
            sourceLabelMarket: '市场价格',
            sourceLabelTaskToken: '任务代币商店价值',
            pricingModeTooltip: (p) => `定价模式：${p.mode}`,
            partialValuationNote: (p) => ` | 部分数据——${p.count} 个物品无法计价：${p.names}`,
            headerTitle: '离线经济',
            headerTitlePartial: '离线经济 *',
            rowLabelRevenue: '收入',
            rowLabelCost: '成本',
            rowLabelProfit: '利润',
            sellSideLabel: '出售',
            buySideLabel: '购买',
            sideTooltip: (p) => `${p.modeLabel}（${p.sideLabel}方）`,
            unvaluedItemLine: (p) => `${p.count}x ${p.name}${p.enhSuffix}——无价格数据`,
        },
        queueMonitorUi: {
            headerTitle: '队列监控',
            noOtherCharacterDataMessage: '暂无其他角色的数据。<br>切换角色即可捕获队列状态。',
            idleLabel: '空闲',
            doneLabel: '完成',
            staleLabel: (p) => `过时（>${p.hours} 小时前）`,
        },
        taskStatistics: {
            popupTitle: '任务统计',
            taskSlotsHeader: '任务槽位',
            slotsUsedLabel: '已占用槽位',
            availableLabel: '可用',
            cooldownPerTaskValue: (p) => `每个任务 ${p.hours} 小时`,
            tasksFullMessage: '任务已满！',
            fullInLabel: '距全满还需',
            fullAtLabel: '全满时间',
            expectedRewardsHeader: '预期奖励',
            totalCoinsLabel: '金币总计',
            totalTaskTokensLabel: '任务代币总计',
            tokenValueEachSuffix: (p) => `每枚 ${p.value}`,
            tokenValueLabel: '单枚代币价值',
            tokensValueLabel: '代币总价值',
            purpleGiftLabel: '紫色礼物',
            totalRewardValueLabel: '奖励总价值',
            actionProfitHeader: '动作利润',
            combatNotApplicableLabel: '不适用（战斗）',
            totalActionProfitLabel: '动作总利润',
            combinedTotalLabel: '合计',
            completionTimeHeader: '完成时间',
            progressSuffix: (p) => `（${p.current}/${p.goal}）`,
            totalNonCombatLabel: '合计（非战斗）',
            characterInfoNotAvailable: '角色信息不可用',
        },
        actionFilter: {
            modeLabel: (p) => `模式：${p.mode}`,
            noMatchingActions: '没有匹配的动作',
            craftOffLabel: '制作：关',
            craftOnLabel: '制作：开',
            craftToggleTooltip: '开启后，若升级材料自行制作比市场购买更便宜，则按制作成本计算，并将制作时间计入每小时利润',
            sellTaxOnLabel: '税：开',
            sellTaxOffLabel: '⚠ 税：关',
            sellTaxToggleTooltipOff: '利润计算包含出售税（默认设置——如果你打算出售产出物，此设置更准确）',
            sellTaxToggleTooltipOn:
                '利润计算不包含出售税——适用于自用生产（地下城钥匙、食物/饮品、迷宫消耗品）。此时利润数值会高于实际出售产出物所能获得的收益。',
            filterPlaceholder: '筛选动作…',
            sortDefaultLabel: '排序：默认',
            sortProfitLabel: '排序：利润',
            sortProfitXpLabel: '排序：利润/经验',
            sortXpLabel: '排序：经验',
            sortCraftableLabel: '排序：可制作数',
        },
        actionTimeDisplay: {
            unknownAction: '[未知动作]',
            actionsCount: (p) => `（${p.count} 个动作）`,
            actionsPerHourWithItems: (p) => `${p.actionsPerHour} 个动作/时（${p.itemsPerHour} 个物品/时）`,
            completeAt: (p) => `完成于 ${p.time}`,
            completeIn: (p) => `将在 ${p.time} 后完成`,
            estWithRecycle: (p) => `预估（含回收）：${p.text}`,
            estimatedValueLabel: '预估价值',
            limitLabelGold: '金币',
            limitLabelGoldLimit: '金币上限',
            limitLabelMat: '材料',
            limitLabelMatLimit: '材料上限',
            limitLabelMax: '最大',
            limitLabelUpgrade: '升级',
            limitLabelUpgradeLimit: '升级上限',
            matsLabel: '材料：',
            profitLabel: '利润：',
            protections: (p) => `约 ${p.count} 次保护`,
            queueActionProfit: (p) => `利润：${p.amount}`,
            queueTotalTime: (p) => `总时间：${p.time}`,
            queueTotalTimeInfinite: '总时间：[∞]',
            queueTotalTimeUnavailable: '总时间：[?]（强化预估不可用）',
            queueTotalTimeWithInfinite: (p) => `总时间：${p.time} + [∞]`,
            queueTotalTimeWithUnavailable: (p) => `总时间：${p.time} + [?]`,
            queuedCount: (p) => `（已排队 ${p.count}）`,
            remainingLabel: '剩余',
            secondsPerAction: (p) => `${p.time} 秒/动作`,
            successRate: (p) => `${p.rate}% 成功率`,
            toTarget: (p) => `约 ${p.count} 次达到目标`,
            tooltipTotal: (p) => `总计：${p.time}`,
            tooltipTotalInfinite: '总计：[∞]',
            tooltipTotalUnavailable: '总计：[?]（强化预估不可用）',
            tooltipTotalWithInfinite: (p) => `总计：${p.time} + [∞]`,
            tooltipTotalWithUnavailable: (p) => `总计：${p.time} + [?]`,
            totalProfitLabel: '总利润',
        },
        chatCommands: {
            multipleMatchesMessage: (p) => `匹配到多个物品：${p.matchList}。请提供更具体的名称。`,
            featureUnavailableMessage: '2/21/26 游戏更新后此功能不可用',
            itemDictionaryOpenFailedMessage: '打开物品词典失败',
            itemNotFoundMessage: (p) => `在游戏数据中未找到物品“${p.itemName}”`,
            marketplaceOpenFailedMessage: '打开市场失败',
        },
        popOutChat: {
            sendButtonLabel: '发送',
            addPaneButtonLabel: '+ 面板',
            bestiaryLinkLabel: '图鉴：',
            closePaneTooltip: '关闭面板',
            collectionLinkLabel: '收藏：',
            disconnectBannerText: '⚠ 与游戏标签页的连接已断开',
            dragHandleTooltip: '拖动以重新排序',
            filterInputPlaceholder: '文本或 /正则表达式/',
            levelAbbreviation: 'Lv.',
            levelUpMessage: (p) => `🎉 ${p.name} 的 ${p.skillName} 达到了 ${p.level} 级！`,
            marketLinkBuyLabel: '购买',
            marketLinkSellLabel: '出售',
            messageInputPlaceholder: '输入消息…',
            partyLinkLabel: '队伍：',
            popoutButtonTooltip: '弹出聊天窗口',
            verticalLabelText: '垂直',
            filterNoFilter: '无筛选',
            filterEnhancedBuy: '强化品购买',
            filterEnhancedSell: '强化品出售',
            filterBuyOnly: '仅购买',
            filterSellOnly: '仅出售',
            filterCustom: '自定义…',
        },
        collectionFilters: {
            favoritesLabel: '收藏',
            notDungeon: '非地下城',
            skillingOutfits: '生活技能套装',
            uncollectedCharms: '未收集护符',
            uncollectedCelestials: '未收集圣物',
            alwaysShowFavorites: '始终显示收藏',
            sortLabel: '排序：',
            sortDefault: '默认',
            sortItemsToNextTier: '距下一档所需物品',
            sortGoldCostToNextTier: '升至下一档的金币成本',
            sortTimeToNextTier: '升至下一档所需时间',
            collectionDataNotLoaded: '收藏数据尚未加载——请访问收藏页面刷新',
            collectedUpdatedAgo: (p) => `已收集 ${p.count} 个——${p.relativeTime}前更新`,
        },
        viewActionButton: {
            buttonLabel: '查看动作',
        },
        craftingPlanTreeRenderer: {
            shoppingListHeader: '采购清单',
            craftingStepsHeader: '制作步骤',
            totalCraftTimeLabel: '总制作时间',
            totalMaterialCostLabel: '材料总成本',
            totalXpLabel: '总经验',
        },
        performancePanel: {
            title: 'PFormance',
            noData: '暂无数据',
        },
        taskAutoReroll: {
            autoRerollListTitle: '自动重掷列表',
            configTooltip: '配置任务自动重掷提醒',
            moreResultsRefineSearch: (p) => `…还有 ${p.count} 个（请细化搜索）`,
            noAutoRerollTasksMessage: '暂无自动重掷任务，搜索以添加。',
            searchPlaceholder: '搜索动作、怪物、区域…',
            zoneTypeLabel: (p) => `区域（${p.count}）`,
        },
        taskIcons: {
            spriteWarning: '⚠ 战斗图标不可用——请前往战斗页面加载图集',
            spriteWarningTooltip: '需要加载战斗怪物图标。请前往战斗面板加载。',
        },
        taskSorter: {
            sortTasksLabel: '排序任务',
        },
        characterActivity: {
            activityStatusOutdated: '活动状态已过期',
            characterIsIdle: '角色空闲中',
            endTimeUnavailable: '结束时间不可用',
            futureActionEnds: '动作结束',
            futureBuffExpiring: 'Buff 即将到期',
            futureCoinsRunOut: '金币耗尽',
            futureMaterialsRunOut: '材料耗尽',
            futureOfflineLimit: '离线上限',
            futureQueueEnds: '队列结束',
            futureUpgradeMaterialsRunOut: '升级材料耗尽',
            noActiveAction: '没有进行中的动作',
            noActiveActionExpected: '预计没有进行中的动作',
            noActivityDataYet: '暂无活动数据',
            openCharacterOnceToEnableStatus: '打开一次角色以启用状态',
            openCharacterToRefresh: '打开角色以刷新',
            pastActionEnded: '动作已结束',
            pastBuffExpired: 'Buff 已到期',
            pastCoinsRanOut: '金币已耗尽',
            pastMaterialsRanOut: '材料已耗尽',
            pastOfflineProgressStopped: '离线进度已停止',
            pastQueueEnded: '队列已结束',
            pastUpgradeMaterialsRanOut: '升级材料已耗尽',
            queueInfiniteKnown: (p) => `队列 → ∞ · 离线上限 · ${p.time}`,
            queueInfiniteUnavailable: '队列 → ∞ · 离线预计完成时间不可用',
            queueInfiniteUncertain: '队列 → ∞ · 离线上限不确定',
            queueUncertain: '队列持续时间不确定 · 预计完成时间不可用',
            queuedSuffix: (p) => `+${p.count} 排队中`,
            runsInfiniteKnown: (p) => `运行 ∞ 次 · 离线上限 · ${p.time}`,
            runsInfiniteUnavailable: '运行 ∞ 次 · 离线预计完成时间不可用',
            runsInfiniteUncertain: '运行 ∞ 次 · 离线上限不确定',
            uncertainCombat: '时长不固定 · 预计完成时间不可用',
            uncertainEnhancing: '结果随机 · 预计完成时间不可用',
            uncertainLabyrinth: '时长不固定 · 预计完成时间不可用',
            uncertainLoadoutUnavailable: '配置的配装不可用 · 预计完成时间不可用',
            uncertainSpecial: '等待队伍 · 预计完成时间不可用',
        },
        craftingPlanCalculator: {
            coinItemName: '金币',
        },
        dungeonTokenTooltips: {
            costColumnHeader: '成本',
            cowbellValueDetail: (p) => `= 10 个装牛铃袋（${p.bagPrice}）÷ 10`,
            goldPerTokenLabel: '金币/代币',
            guildCreditValueLabel: '公会信用点价值：',
            itemColumnHeader: '物品',
            labyrinthShopValueLabel: '迷宫商店价值：',
            sealValueDetail: (p) => `= ${p.cost} 个迷宫代币 × ${p.goldPerToken} 金币/代币`,
            taskShopValueLabel: '任务商店价值：',
            tokenShopValueLabel: '代币商店价值：',
            valueColumnHeader: '价值',
            valueGoldTemplate: (p) => `价值：${p.value} 金币`,
        },
        eliteAchievementReminder: {
            defaultMessage: '成为精英——完成你的精英成就。',
            reminderTooltip: '提醒完成精英成就',
        },
        mentionTracker: {
            channelGlobal: '全局',
            channelGuild: '公会',
            channelLocal: '本地',
            channelParty: '队伍',
            channelWhisper: '私聊',
        },
        notificationFormatter: {
            achievementCompleted: '成就完成：$t(achievementNames.{{achievementHrid}})',
            addedFriend: '已添加好友：{{name}}',
            avatarBackgroundUnlocked: '解锁了新的头像背景',
            avatarBorderUnlocked: '解锁了新的头像边框',
            avatarOutfitUnlocked: '解锁了新的头像装扮',
            avatarUnlocked: '解锁了新的头像',
            blockedCharacter: '已屏蔽角色：{{name}}',
            boughtItem: '购买了 {{count}} 个 $t(itemNames.{{itemHrid}})',
            buyListingProgress: '购买挂单：$t(itemNames.{{itemHrid}}){{enhancement}} — 进度：{{filled}}/{{total}}',
            buyOrderCompleted: '购买 {{count}} 个 $t(itemNames.{{itemHrid}}){{enhancement}} — 花费 {{coins}} 金币',
            characterLeveledUp: '你的 $t(skillNames.{{skillHrid}}) 已达到 {{level}} 级！',
            chatIconUnlocked: '解锁了聊天图标：$t(chatIconNames.{{iconHrid}})',
            chatReportSubmitted: '聊天举报已提交',
            communityBuffAdded: '获得了 {{minutes}} 分钟社区增益：$t(communityBuffTypeNames.{{buffHrid}})',
            cowbellPurchaseCompleted: '完成购买：{{count}} 个牛铃',
            creatorCodeSet: '已应用创作者代码：{{code}}',
            guildApplicationAccepted: '你的加入申请已被 {{guildName}} 接受',
            guildApplicationSent: '已申请加入公会：{{guildName}}',
            guildCreated: '已创建公会：{{guildName}}',
            guildDemotedTo: '你已被降职为$t(guildCharacterRoleNames.{{role}})',
            guildDisbanded: '已解散公会：{{guildName}}',
            guildInviteCanceled: '已取消公会邀请：{{name}}',
            guildInviteDeclined: '公会邀请已被拒绝：{{guildName}}',
            guildInviteSent: '已发送公会邀请：{{name}}',
            guildInvited: '你已被邀请加入公会：{{guildName}}',
            guildJoined: '已加入公会：{{guildName}}',
            guildKicked: '已被公会踢出：{{guildName}}',
            guildLeadershipPassed: '已将会长职位移交给 {{name}}',
            guildLeft: '已退出公会：{{guildName}}',
            guildMemberDemoted: '已将 {{name}} 降职为$t(guildCharacterRoleNames.{{role}})',
            guildMemberPromoted: '已将 {{name}} 晋升为$t(guildCharacterRoleNames.{{role}})',
            guildMessagePinned: '公会有新的置顶消息',
            guildPromotedTo: '你已被晋升为$t(guildCharacterRoleNames.{{role}})',
            guildTrialStarted: '你的公会试用期已开始！',
            houseConstructed: '已建造 {{level}} 级 $t(houseRoomNames.{{roomHrid}})',
            kickedGuildMember: '已踢出公会成员：{{name}}',
            labyrinthShroudFailed: '遮罩失败！房间等级超出了遮罩的有效范围。',
            listingPegged: '$t(itemNames.{{itemHrid}}){{enhancement}} 当前挂单价为 {{boundary}} — 你设置的限制：{{limit}}',
            loadoutCreated: '配装已创建',
            loadoutDeleted: '配装已删除',
            loadoutEquipped: '配装已装备',
            loadoutUpdated: '配装已更新',
            mooPassGranted: '已获赠 {{days}} 天 MooPass',
            mooPassPurchaseCompleted: '完成购买：{{days}} 天 MooPass',
            nameChanged: '名称已更改为：{{name}}',
            nameColorUnlocked: '解锁了名称颜色：$t(nameColorNames.{{colorHrid}})',
            newReferralBonus: '获得了新的推荐奖励',
            notReadyToBattle: '你尚未准备好战斗',
            partyCreated: '队伍已创建',
            partyDisbanded: '队伍已解散',
            partyJoined: '你已加入队伍',
            partyKicked: '你已被踢出队伍',
            partyLeadershipChanged: '队长已变更为 {{name}}',
            partyLeft: '你已离开队伍',
            partyMemberKicked: '已将 {{name}} 踢出队伍',
            partyOpenForRecruiting: '队伍已开放招募',
            partyOptionsSaved: '队伍设置已保存',
            readyToBattle: '你已准备好战斗',
            referralJoined: '一名新玩家通过你的推荐链接加入了游戏，感谢你的分享！',
            removedFriend: '已删除好友：{{name}}',
            sellListingProgress: '出售挂单：$t(itemNames.{{itemHrid}}){{enhancement}} — 进度：{{filled}}/{{total}}',
            sellOrderCompleted: '出售 {{count}} 个 $t(itemNames.{{itemHrid}}){{enhancement}} — 获得 {{coins}} 金币',
            setupImportedToLoadout: '已将当前装备导入配装',
            soldItem: '出售了 {{count}} 个 $t(itemNames.{{itemHrid}})',
            steamCheckoutRequested: '已请求 Steam 结账，请稍候……',
            unblockedCharacter: '已取消屏蔽角色：{{name}}',
            updateSuccessful: '更新成功',
            upgradePurchased: '已购买升级：$t(buyableUpgradeNames.{{upgradeHrid}}) (x{{count}})',
        },
        taskCardVisualState: {
            rerollBadgeText: '重掷！',
        },
        taskClaimCollector: {
            claimReward: '领取奖励',
            claimRewardWithCount: (p) => `领取奖励（${p.count}）`,
        },
        taskIconFilters: {
            battleFilterLabel: '战斗',
        },
        taskProfitCalculator: {
            marketDataNotLoadedError: '市场数据未加载',
        },
        taskSkillGroups: {
            otherTypeLabel: '其他',
        },
    };

    /**
     * Simplified Chinese (zh) strings for Toolasha's own UI text.
     *
     * Same dot-nested key shape as `en.js`. A key missing here falls back to the English string via
     * `core/i18n.js` — a translation gap degrades to English, it never crashes or renders a raw key.
     *
     * Split into per-area batch files under ./zh/ for parallel native-speaker review.
     */

    var zh = {
        ...batchA,
        ...batchB,
        ...batchC,
        ...batchD,
        ...batchE,
    };

    /**
     * i18n
     *
     * Resolves Toolasha's effective UI locale from the game's own language selection and exposes
     * translated strings via t(). MWI persists its selected language under
     * localStorage['i18nextLng'] (standard i18next-browser-languagedetector key); Toolasha mirrors
     * that choice rather than adding a separate language setting, since the game's own item/action/
     * monster names already come translated through dataManager once the player picks a language
     * in-game — Toolasha's own UI should follow the same choice.
     */

    const LOCALE_TABLES = { en, zh };
    const SUPPORTED_LOCALES = ['en', 'zh'];
    const DEFAULT_LOCALE = 'en';

    class I18n {
        /**
         * Effective locale for Toolasha's own UI strings and Intl formatting.
         * @returns {'en'|'zh'}
         */
        getLocale() {
            let raw = null;
            try {
                raw = window.localStorage.getItem('i18nextLng');
            } catch {
                raw = null;
            }

            if (!raw) return DEFAULT_LOCALE;

            const normalized = raw.toLowerCase();
            // MWI ships both zh (Simplified) and zh-TW (Traditional); Toolasha only has Simplified
            // strings for now, so any zh* variant maps to 'zh' rather than falling back to English.
            if (normalized.startsWith('zh')) return 'zh';
            return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;
        }

        /**
         * Look up a translated string by dot-nested key, e.g. t('settings.clearButton').
         * Falls back to the English string, then to the key itself, so a missing translation never
         * surfaces as undefined and never throws.
         * @param {string} key
         * @param {Object} [params] - Named placeholders substituted for `{{name}}` in string
         *   templates; passed through as-is to function templates (used for pluralization).
         * @returns {string}
         */
        t(key, params = {}) {
            const locale = this.getLocale();
            const template = this._lookup(LOCALE_TABLES[locale], key) ?? this._lookup(LOCALE_TABLES[DEFAULT_LOCALE], key);

            if (template === undefined) return key;
            if (typeof template === 'function') return template(params);
            return this._interpolate(template, params);
        }

        _lookup(table, key) {
            return key
                .split('.')
                .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), table);
        }

        _interpolate(template, params) {
            return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in params ? String(params[name]) : match));
        }
    }

    const i18n = new I18n();
    const t = (key, params) => i18n.t(key, params);

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
            this.COLOR_MIRROR = '#ffd700'; // Philosopher's Mirror highlight color
            this.COLOR_LISTING_PRICE_1M = '#ffd700'; // Listing total price 1M+
            this.COLOR_LISTING_PRICE_100K = '#22c55e'; // Listing total price 100K+
            this.COLOR_LISTING_PRICE_10K = '#ffffff'; // Listing total price 10K+
            this.COLOR_LISTING_PRICE_LOW = '#888888'; // Listing total price <10K
            this.COLOR_ACCENT = '#22c55e'; // Script accent color (green)
            this.COLOR_REMAINING_XP = '#FFFFFF'; // Remaining XP text color
            this.COLOR_XP_RATE = '#ffffff'; // XP/hr rate text color
            this.COLOR_HOURS_TO_LEVEL = '#ffffff'; // Hours to level text color
            this.COLOR_INV_COUNT = '#ffffff'; // Inventory count display color

            // Legacy color constants (mapped to COLOR_ACCENT)
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_ALERT = 'red';

            // Z-index tiers
            this.Z_HUD = 50; // In-game HUD overlays — below game interactive UI
            this.Z_FLOATING_PANEL = 1100; // Persistent panels — below MUI modals (game = ~1300)
            this.Z_POPUP = 9000; // Contextual popups / short-lived overlays
            this.Z_MODAL = 9000; // Full-screen intentional modals
            this.Z_NOTIFICATION = 99999; // Transient notifications (above everything)

            // Market API URL
            this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Settings loaded from settings-schema via settings-storage.js
            this.settingsMap = {};

            // Map of setting keys to callback functions
            this.settingChangeCallbacks = {};

            // Callbacks fired whenever loadSettings() repopulates settingsMap from storage,
            // regardless of the notifyChanges option. Long-lived infrastructure that is not
            // torn down/reinitialized by the feature registry (e.g. the persistent Action
            // Filter) uses this to resynchronize after a character switch, where per-setting
            // onSettingChange callbacks are intentionally suppressed.
            this.settingsLoadedCallbacks = [];

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
                tooltipArtisanPrices: {
                    enabled: true,
                    name: 'Artisan-Adjusted Tooltip Prices',
                    category: 'Market',
                    description: 'Adjusts tooltip price totals for Artisan Tea material reduction',
                    settingKey: 'itemTooltip_artisanPrices',
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
                dungeonTokenTooltips: {
                    enabled: true,
                    name: 'Currency Token Tooltips',
                    category: 'Inventory',
                    description: 'Shows shop values for tokens, seals, and cowbells',
                    settingKey: 'dungeonTokenTooltips',
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
                market_collectableListingsToTop: {
                    enabled: true,
                    name: 'Collectable Listings to Top',
                    category: 'Market',
                    description: 'Moves listings with something to collect to the top of My Listings',
                    settingKey: 'market_collectableListingsToTop',
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
                market_listingRefreshNavigator: {
                    enabled: true,
                    name: 'Listing Refresh Navigator',
                    category: 'Market',
                    description: 'Refresh on My Listings, then Next/Back to My Listings on each order-book page',
                    settingKey: 'market_listingRefreshNavigator',
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
                    settingKey: 'actionBar_enabled',
                },
                actionCountdown: {
                    enabled: true,
                    name: 'Action Bar Countdown',
                    category: 'Actions',
                    description: 'Live countdown timer on the action progress bar',
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

                drinkTimer: {
                    enabled: true,
                    name: 'Drink Timer',
                    category: 'Actions',
                    description: 'Shows remaining drink supply time and queue coverage in skill panels',
                    settingKey: 'drinkTimer',
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
                dungeonTrackerUI: {
                    enabled: true,
                    name: 'Show Dungeon Tracker UI panel',
                    category: 'Combat',
                    description: 'Displays dungeon progress panel with wave counter, run history, and statistics',
                    settingKey: 'dungeonTrackerUI',
                },
                combatStats: {
                    enabled: true,
                    name: 'Combat Statistics',
                    category: 'Combat',
                    description: 'Tracks combat data and consumable usage; shows Statistics tab in Combat panel',
                    settingKey: 'combatStats',
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
                combatLevelProgress: {
                    enabled: true,
                    name: 'Precise Combat Level Progress',
                    category: 'UI',
                    description: 'Shows weighted progress toward the next Combat Level in left sidebar',
                    settingKey: 'combatLevelProgress',
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
                skillingOptimizer: {
                    enabled: true,
                    name: 'Skilling Simulator/Optimizer',
                    category: 'Skills',
                    description: 'Optimizer tab in the character panel',
                    settingKey: 'skillingOptimizer',
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
         * @param {Object} options - Loading options
         * @param {boolean} options.notifyChanges - Fire setting callbacks for changed values
         * @returns {Promise<void>}
         */
        async loadSettings({ notifyChanges = true } = {}) {
            // Set character ID in settings storage for per-character settings
            const characterId = dataManager.getCurrentCharacterId();

            // Before character ID is known, only populate schema defaults (no storage access)
            // This prevents loading from the wrong storage key during early initialization
            if (!characterId) {
                this.settingsMap = settingsStorage.buildDefaults();
                return;
            }

            settingsStorage.setCharacterId(characterId, dataManager.getCurrentCharacterName());

            const previousMap = this.settingsMap;

            // Load settings from settings-storage (which uses settings-schema as source of truth)
            this.settingsMap = await settingsStorage.loadSettings();

            if (notifyChanges) {
                // Fire change callbacks for settings that differ from what was previously loaded.
                // Character switches intentionally suppress these callbacks because the feature
                // registry performs a full cleanup/reinitialize cycle with the new settings.
                for (const key of Object.keys(this.settingChangeCallbacks)) {
                    const prev = previousMap[key];
                    const curr = this.settingsMap[key];
                    if (!prev || !curr) continue;
                    const prevVal = prev.hasOwnProperty('value') ? prev.value : prev.isTrue;
                    const currVal = curr.hasOwnProperty('value') ? curr.value : curr.isTrue;
                    if (prevVal !== currVal) {
                        for (const cb of this.settingChangeCallbacks[key]) cb(currVal);
                    }
                }
            }

            // Fire regardless of notifyChanges: this signals settingsMap has been repopulated
            // from storage, which persistent infrastructure needs even when per-setting change
            // callbacks are intentionally suppressed (e.g. character switch reinitialization).
            for (const cb of this.settingsLoadedCallbacks) cb();
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
         * Get the display label for a pricing mode key, respecting the naming convention setting.
         * @param {string} mode - Pricing mode key ('conservative', 'hybrid', 'optimistic', 'patientBuy')
         * @returns {string} Display label
         */
        getPricingModeLabel(mode) {
            const useInstant = this.getSetting('profitCalc_pricingNaming');
            // hybrid/optimistic reuse craftingPlanDisplay's existing instant-naming labels; conservative/patientBuy
            // have no existing translated equivalent for the instant-naming variant, so they use new
            // pricingMode.* keys (see task output for the keys that still need adding to the locale files).
            const labels = useInstant
                ? {
                      conservative: t('pricingMode.instantBuyInstantSell'),
                      hybrid: t('craftingPlanDisplay.pricingModeInstantBuyPatientSell'),
                      optimistic: t('craftingPlanDisplay.pricingModePatientBuyPatientSell'),
                      patientBuy: t('pricingMode.patientBuyInstantSell'),
                  }
                : {
                      conservative: t('combatSimUi.pricingModeConservative'),
                      hybrid: t('combatSimUi.pricingModeHybrid'),
                      optimistic: t('combatSimUi.pricingModeOptimistic'),
                      patientBuy: t('combatSimUi.pricingModePatientBuy'),
                  };
            return labels[mode] || labels.hybrid;
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
                    for (const cb of this.settingChangeCallbacks[key]) cb(value);
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
                    for (const cb of this.settingChangeCallbacks[key]) cb(value);
                }
            }
        }

        /**
         * Register a callback to be called when a specific setting changes.
         * Multiple callbacks per key are supported.
         * @param {string} key - Setting key to watch
         * @param {Function} callback - Callback function to call when setting changes
         */
        onSettingChange(key, callback) {
            if (!this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key] = [];
            }
            this.settingChangeCallbacks[key].push(callback);
        }

        /**
         * Unregister a specific callback for a setting change
         * @param {string} key - Setting key to stop watching
         * @param {Function} callback - The exact callback reference to remove
         */
        offSettingChange(key, callback) {
            if (this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key] = this.settingChangeCallbacks[key].filter((cb) => cb !== callback);
            }
        }

        /**
         * Register a callback to be called whenever loadSettings() repopulates settingsMap from
         * storage, regardless of the notifyChanges option. Intended for long-lived infrastructure
         * that is not torn down/reinitialized by the feature registry on character switch.
         * @param {Function} callback - Callback function, called with no arguments
         */
        onSettingsLoaded(callback) {
            this.settingsLoadedCallbacks.push(callback);
        }

        /**
         * Unregister a specific callback registered via onSettingsLoaded
         * @param {Function} callback - The exact callback reference to remove
         */
        offSettingsLoaded(callback) {
            this.settingsLoadedCallbacks = this.settingsLoadedCallbacks.filter((cb) => cb !== callback);
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
        async resetToDefaults() {
            this.settingsMap = settingsStorage.buildDefaults();
            await settingsStorage.saveSettings(this.settingsMap);
            this.applyColorSettings();
        }

        /**
         * Sync current settings to all other characters
         * @returns {Promise<{success: boolean, count: number, error?: string}>} Result object
         */
        async syncSettingsToAllCharacters(targetIds) {
            try {
                const characterId = dataManager.getCurrentCharacterId();
                if (!characterId) {
                    return { success: false, count: 0, error: 'No character ID available' };
                }
                settingsStorage.setCharacterId(characterId, dataManager.getCurrentCharacterName());
                const syncedCount = await settingsStorage.syncSettingsToAllCharacters(this.settingsMap, targetIds);
                return { success: true, count: syncedCount };
            } catch (error) {
                console.error('[Config] Failed to sync settings:', error);
                return { success: false, count: 0, error: error.message };
            }
        }

        /**
         * Get list of known characters as [{id, name}] objects.
         * @returns {Promise<Array<{id: string, name: string}>>}
         */
        async getKnownCharacters() {
            try {
                return await settingsStorage.getKnownCharacters();
            } catch (error) {
                console.error('[Config] Failed to get known characters:', error);
                return [];
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
            this.COLOR_MIRROR = this.getSettingValue('color_mirror', '#ffd700');
            this.COLOR_LISTING_PRICE_1M = this.getSettingValue('color_listing_price_1m', '#ffd700');
            this.COLOR_LISTING_PRICE_100K = this.getSettingValue('color_listing_price_100k', '#22c55e');
            this.COLOR_LISTING_PRICE_10K = this.getSettingValue('color_listing_price_10k', '#ffffff');
            this.COLOR_LISTING_PRICE_LOW = this.getSettingValue('color_listing_price_low', '#888888');
            this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
            this.COLOR_REMAINING_XP = this.getSettingValue('color_remaining_xp', '#FFFFFF');
            this.COLOR_XP_RATE = this.getSettingValue('color_xp_rate', '#ffffff');
            this.COLOR_HOURS_TO_LEVEL = this.getSettingValue('color_hours_to_level', '#ffffff');
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
     * Performance Monitor
     * Tracks execution time of features and DOM observer handlers
     * using a rolling window for CPU percentage calculations.
     */

    const WINDOW_MS = 5000;

    class PerformanceMonitor {
        constructor() {
            this.measurements = new Map();
            this.snapshots = new Map();
            this.windowMs = WINDOW_MS;
            this.enabled = false;
            this._onVisibilityChange = () => {
                this._tabVisible = !document.hidden;
            };
            this._tabVisible = true;
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', this._onVisibilityChange);
            }
        }

        /**
         * Record a timing measurement
         * @param {string} name - Metric name (e.g. "dom:MarketFilter", "init:tooltipPrices")
         * @param {number} durationMs - Duration in milliseconds
         */
        record(name, durationMs) {
            if (!this.enabled || !this._tabVisible) return;
            if (!this.measurements.has(name)) {
                this.measurements.set(name, []);
            }
            this.measurements.get(name).push({ time: Date.now(), duration: durationMs });
        }

        /**
         * Store a one-time snapshot measurement that persists beyond the rolling window
         * @param {string} name - Metric name
         * @param {number} durationMs - Duration in milliseconds
         */
        snapshot(name, durationMs) {
            this.snapshots.set(name, { duration: durationMs, time: Date.now() });
        }

        /**
         * Wrap a function with automatic timing
         * @param {string} name - Metric name
         * @param {Function} fn - Function to wrap
         * @returns {Function} Wrapped function
         */
        wrap(name, fn) {
            const monitor = this;
            return function (...args) {
                if (!monitor.enabled || !monitor._tabVisible) return fn.apply(this, args);
                const start = performance.now();
                try {
                    const result = fn.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.finally(() => monitor.record(name, performance.now() - start));
                    }
                    monitor.record(name, performance.now() - start);
                    return result;
                } catch (error) {
                    monitor.record(name, performance.now() - start);
                    throw error;
                }
            };
        }

        /**
         * Get stats for a single metric within the rolling window
         * @param {string} name - Metric name
         * @returns {{ calls: number, totalMs: number, avgMs: number, cpuPercent: number } | null}
         */
        getStats(name) {
            const entries = this.measurements.get(name);
            if (!entries || entries.length === 0) return null;

            const cutoff = Date.now() - this.windowMs;
            let calls = 0;
            let totalMs = 0;

            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].time < cutoff) break;
                calls++;
                totalMs += entries[i].duration;
            }

            if (calls === 0) return null;

            return {
                calls,
                totalMs,
                avgMs: totalMs / calls,
                cpuPercent: Math.min((totalMs / this.windowMs) * 100, 100),
            };
        }

        /**
         * Get stats for all metrics, cleaning up stale data
         * @returns {Map<string, { calls: number, totalMs: number, avgMs: number, cpuPercent: number }>}
         */
        getAllStats() {
            this._cleanup();
            const result = new Map();

            for (const [name, entries] of this.measurements) {
                if (entries.length === 0) continue;
                const stats = this.getStats(name);
                if (stats) {
                    result.set(name, stats);
                }
            }

            return result;
        }

        /**
         * Remove measurements older than the rolling window
         * @private
         */
        _cleanup() {
            const cutoff = Date.now() - this.windowMs;
            for (const [name, entries] of this.measurements) {
                let firstValid = 0;
                while (firstValid < entries.length && entries[firstValid].time < cutoff) {
                    firstValid++;
                }
                if (firstValid > 0) {
                    entries.splice(0, firstValid);
                }
                if (entries.length === 0) {
                    this.measurements.delete(name);
                }
            }
        }

        /**
         * Get all snapshot measurements
         * @returns {Map<string, { duration: number, time: number }>}
         */
        getSnapshots() {
            return new Map(this.snapshots);
        }

        /**
         * Remove a single snapshot measurement, e.g. when a feature is torn down
         * @param {string} name - Metric name
         */
        clearSnapshot(name) {
            this.snapshots.delete(name);
        }

        /**
         * Clear all measurements
         */
        reset() {
            this.measurements.clear();
            this.snapshots.clear();
        }
    }

    const performanceMonitor = new PerformanceMonitor();

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
            this.readyHandlers = []; // Callbacks fired when the shared observer is actually attached to document.body
            this.isObserving = false;
            this.debounceTimers = new Map(); // Track debounce timers per handler
            this.debouncedLatest = new Map(); // Latest { node, mutation } per handler (O(1) per handler)
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
                                    } else if (performanceMonitor.enabled) {
                                        const start = performance.now();
                                        handler.callback(node, mutation);
                                        performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
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
                this.notifyReadyHandlers();
            };

            startObserver();
        }

        /**
         * Notify handlers that depend on the observer being attached to the current body.
         * Important for @run-at document-start: start() may have returned before document.body existed.
         * @private
         */
        notifyReadyHandlers() {
            for (const handler of [...this.readyHandlers]) {
                try {
                    const result = handler.callback();
                    if (result && typeof result.catch === 'function') {
                        result.catch((error) => {
                            console.error(`[DOM Observer] Ready handler error (${handler.name}):`, error);
                        });
                    }
                } catch (error) {
                    console.error(`[DOM Observer] Ready handler error (${handler.name}):`, error);
                }
            }
        }

        /**
         * Register a callback that runs whenever the centralized observer has actually attached to
         * document.body. If it is already attached, the callback runs immediately. This is a bounded
         * lifecycle/catch-up signal, not a polling mechanism.
         * @param {string} name - Handler name for diagnostics
         * @param {Function} callback - Called with no arguments when observing is ready
         * @returns {Function} Unregister function
         */
        onReady(name, callback) {
            const handler = { name, callback };
            this.readyHandlers.push(handler);

            if (this.isObserving) {
                try {
                    const result = callback();
                    if (result && typeof result.catch === 'function') {
                        result.catch((error) => {
                            console.error(`[DOM Observer] Ready handler error (${name}):`, error);
                        });
                    }
                } catch (error) {
                    console.error(`[DOM Observer] Ready handler error (${name}):`, error);
                }
            }

            return () => {
                const index = this.readyHandlers.indexOf(handler);
                if (index > -1) this.readyHandlers.splice(index, 1);
            };
        }

        /**
         * Debounced callback handler
         * Collects elements and fires callback after delay
         * @private
         */
        debouncedCallback(handler, node, mutation) {
            const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

            // Overwrite with the latest node/mutation — only the last one is ever used
            this.debouncedLatest.set(handler, { node, mutation });

            // Clear existing timer
            if (this.debounceTimers.has(handler)) {
                clearTimeout(this.debounceTimers.get(handler));
            }

            // Set new timer
            const timer = setTimeout(() => {
                const latest = this.debouncedLatest.get(handler);
                this.debouncedLatest.delete(handler);
                this.debounceTimers.delete(handler);

                if (latest) {
                    if (performanceMonitor.enabled) {
                        const start = performance.now();
                        handler.callback(latest.node, latest.mutation);
                        performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
                    } else {
                        handler.callback(latest.node, latest.mutation);
                    }
                }
            }, delay);

            this.debounceTimers.set(handler, timer);
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
            this.debouncedLatest.clear();

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
                    if (this.debounceTimers.has(handler)) {
                        clearTimeout(this.debounceTimers.get(handler));
                        this.debounceTimers.delete(handler);
                        this.debouncedLatest.delete(handler);
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

                    // Also check descendants when a container subtree is inserted.
                    // Only applies when the node has children — leaf nodes are skipped,
                    // which eliminates the bulk of querySelectorAll cost during React's
                    // init burst (thousands of individual leaf additions).
                    if (node.childElementCount > 0) {
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
                readyHandlerCount: this.readyHandlers.length,
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
     * Loadout State
     *
     * Canonical owner of saved MWI loadout state. Raw snapshots mirror the server payload;
     * effective snapshots are resolved on demand against the current character inventory.
     *
     * Important invariants:
     * - This is the only stateful loadout singleton in Toolasha.
     * - Constructors are side-effect free; startCapture() owns lifecycle subscriptions.
     * - Fresh server characterLoadoutMap always outranks IndexedDB cache, including an empty map.
     * - Inventory changes never mutate raw snapshots. Highest-enhancement mode is resolved at read time.
     * - Character switches clear the departing character synchronously and async cache hydration is generation-guarded.
     */


    const STORAGE_KEY_PREFIX = 'loadout_snapshots';
    const LOADOUT_STATE_IMPLEMENTATION_ID = 'toolasha-core-loadout-state-v1';

    function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object || {}, key);
    }

    function normalizeCharacterId(value) {
        if (value === null || value === undefined || value === '') return null;
        return String(value);
    }

    function normalizeSavedEnhancementLevel(value) {
        if (value === null || value === undefined || value === '') return null;
        const level = Number(value);
        // Enhancement levels are discrete, non-negative indices. A malformed cache/hash must fail
        // closed rather than becoming a plausible exact level through Number/parseInt coercion.
        return Number.isInteger(level) && level >= 0 ? level : null;
    }

    function getStorageKey(characterId) {
        return `${STORAGE_KEY_PREFIX}_${characterId}`;
    }

    function cloneJsonSafeValue(value) {
        if (Array.isArray(value)) return value.map((entry) => cloneJsonSafeValue(entry));
        if (value && typeof value === 'object') {
            const clone = {};
            for (const [key, entry] of Object.entries(value)) {
                clone[key] = cloneJsonSafeValue(entry);
            }
            return clone;
        }
        return value;
    }

    function cloneTriggerMap(triggerMap) {
        const clone = {};
        if (!triggerMap || typeof triggerMap !== 'object' || Array.isArray(triggerMap)) return clone;

        for (const [key, triggers] of Object.entries(triggerMap)) {
            // Native loadout trigger maps contain arrays. Reject malformed cache/server values
            // instead of retaining a mutable object reference or exposing a non-canonical shape.
            if (!Array.isArray(triggers)) continue;
            clone[key] = triggers.map((trigger) => cloneJsonSafeValue(trigger));
        }
        return clone;
    }

    /**
     * Parse a wearable hash string into a raw saved equipment entry.
     * Format: "characterId::/item_locations/location::/items/item_hrid::enhancementLevel".
     * @param {string} itemLocationHrid
     * @param {string} wearableHash
     * @returns {{itemLocationHrid: string, itemHrid: string, enhancementLevel: number|null, savedItemHash: string}|null}
     */
    function parseLoadoutWearable(itemLocationHrid, wearableHash) {
        if (!wearableHash || typeof wearableHash !== 'string') return null;

        const parts = wearableHash.split('::');
        const itemHrid = parts.find((part) => part.startsWith('/items/'));
        if (!itemHrid) return null;

        const lastPart = parts[parts.length - 1] || '';
        const enhancementLevel = lastPart.startsWith('/') ? null : normalizeSavedEnhancementLevel(lastPart);

        return { itemLocationHrid, itemHrid, enhancementLevel, savedItemHash: wearableHash };
    }

    /**
     * Convert one server loadout entry into Toolasha's raw snapshot shape.
     * The saved enhancement number is intentionally preserved even when useExactEnhancement=false;
     * it is historical server state, not the effective level to use in calculations.
     * @param {string} snapshotId
     * @param {Object} loadout
     * @returns {Object}
     */
    function buildRawLoadoutSnapshot(snapshotId, loadout) {
        const equipment = [];
        for (const [locationHrid, hash] of Object.entries(loadout?.wearableMap || {})) {
            const parsed = parseLoadoutWearable(locationHrid, hash);
            if (parsed) equipment.push(parsed);
        }

        const drinks = (loadout?.drinkItemHrids || []).map((itemHrid) => ({ itemHrid: itemHrid || '' }));
        const food = (loadout?.foodItemHrids || []).map((itemHrid) => ({ itemHrid: itemHrid || '' }));

        const abilities = [];
        for (const [slot, abilityHrid] of Object.entries(loadout?.abilityMap || {})) {
            if (!abilityHrid) continue;
            abilities.push({ abilityHrid, slot: Number.parseInt(slot, 10) || 0 });
        }
        abilities.sort((a, b) => a.slot - b.slot);

        return {
            snapshotId: String(snapshotId),
            name: loadout?.name || '',
            actionTypeHrid: loadout?.actionTypeHrid || '',
            isDefault: !!loadout?.isDefault,
            suppressValidation: !!loadout?.suppressValidation,
            useExactEnhancement: loadout?.useExactEnhancement === true,
            ordinal: loadout?.ordinal || 0,
            equipment,
            abilities,
            food,
            drinks,
            abilityCombatTriggersMap: cloneTriggerMap(loadout?.abilityCombatTriggersMap),
            consumableCombatTriggersMap: cloneTriggerMap(loadout?.consumableCombatTriggersMap),
            capturedAt: Date.now(),
        };
    }

    /**
     * Build current owned-enhancement information from characterItems.
     * Equipped entries without a count are owned; only an explicit count === 0 is absent.
     * A real +0 item is retained as a map entry, so +0 ownership is distinguishable from missing.
     * @param {Array<Object>|null|undefined} characterItems
     * @returns {Map<string, {highestEnhancementLevel: number, levels: Set<number>} >}
     */
    function buildOwnedEnhancementIndex(characterItems) {
        const index = new Map();

        for (const item of characterItems || []) {
            if (!item?.itemHrid || item.count === 0) continue;

            const level = Number.isFinite(Number(item.enhancementLevel)) ? Number(item.enhancementLevel) : 0;
            let entry = index.get(item.itemHrid);
            if (!entry) {
                entry = { highestEnhancementLevel: level, levels: new Set() };
                index.set(item.itemHrid, entry);
            } else if (level > entry.highestEnhancementLevel) {
                entry.highestEnhancementLevel = level;
            }
            entry.levels.add(level);
        }

        return index;
    }

    /**
     * Resolve saved food/drink slots against the same inventory-only presence semantics used by
     * MWI loadout validation. Empty slots are intentional and never treated as missing.
     * Validation checks the +0 inventory hash for consumables; equipped/non-inventory entries do
     * not satisfy a saved consumable slot. Only explicit count === 0 is absent.
     * @param {Array<Object>|null|undefined} entries
     * @param {Array<Object>|null|undefined} characterItems
     * @returns {Array<{slotIndex:number,itemHrid:string,isAvailable:boolean}>}
     */
    function resolveLoadoutConsumables(entries, characterItems) {
        const inventoryPresence = new Set();
        for (const item of characterItems || []) {
            if (!item?.itemHrid || item.itemLocationHrid !== '/item_locations/inventory' || item.count === 0) {
                continue;
            }
            const level = Number.isFinite(Number(item.enhancementLevel)) ? Number(item.enhancementLevel) : 0;
            if (level === 0) inventoryPresence.add(item.itemHrid);
        }

        return (entries || []).map((entry, slotIndex) => {
            const itemHrid = entry?.itemHrid || '';
            return {
                slotIndex,
                itemHrid,
                isAvailable: !itemHrid || inventoryPresence.has(itemHrid),
            };
        });
    }

    /**
     * Resolve raw saved equipment against current ownership.
     * Missing-item execution semantics are deliberately not guessed; the intended item remains
     * present with isAvailable=false so callers can surface/handle that state explicitly.
     * @param {Object} rawSnapshot
     * @param {Array<Object>|null|undefined} characterItems
     * @returns {Array<Object>}
     */
    function resolveLoadoutEquipment(rawSnapshot, characterItems) {
        const useExactEnhancement = rawSnapshot?.useExactEnhancement === true;

        return (rawSnapshot?.equipment || []).map((rawEquipment) => {
            // Native MWI loadout validation only considers the saved target equipment location
            // plus Inventory for this slot. The same item equipped in some *other* location is not
            // a valid source for this saved slot, so do not use the global itemHrid ownership map
            // here. This matters for equipment types that can appear in more than one location.
            const eligibleItems = (characterItems || []).filter((item) => {
                if (item?.itemHrid !== rawEquipment.itemHrid || item.count === 0) return false;

                // Native validation first accepts the exact raw wearable hash that was saved,
                // even if that item was equipped in a different source slot when the loadout was
                // authored. Replacement variants are then searched only in the loadout's target
                // location and Inventory. Preserve the raw hash internally so we can match that
                // behavior instead of broadening eligibility to arbitrary equipped locations.
                if (rawEquipment.savedItemHash && item.hash === rawEquipment.savedItemHash) return true;
                return (
                    item.itemLocationHrid === rawEquipment.itemLocationHrid ||
                    item.itemLocationHrid === '/item_locations/inventory'
                );
            });
            const eligibleOwnership = buildOwnedEnhancementIndex(eligibleItems);
            const owned = eligibleOwnership.get(rawEquipment.itemHrid);
            const savedEnhancementLevel = normalizeSavedEnhancementLevel(rawEquipment.enhancementLevel);
            const hasValidSavedEnhancementLevel = savedEnhancementLevel !== null;

            if (useExactEnhancement) {
                const isAvailable = hasValidSavedEnhancementLevel && !!owned?.levels.has(savedEnhancementLevel);
                return {
                    itemLocationHrid: rawEquipment.itemLocationHrid,
                    itemHrid: rawEquipment.itemHrid,
                    enhancementLevel: isAvailable ? savedEnhancementLevel : null,
                    isAvailable,
                };
            }

            if (owned) {
                return {
                    itemLocationHrid: rawEquipment.itemLocationHrid,
                    itemHrid: rawEquipment.itemHrid,
                    enhancementLevel: owned.highestEnhancementLevel,
                    isAvailable: true,
                };
            }

            // Fail closed. The historical saved level is raw server metadata, not an
            // effective level. Do not expose it as a numeric fallback when the item is
            // unavailable, because downstream `|| 0` / `?? 0` code could silently turn
            // an unresolved loadout into a plausible-but-false calculation.
            return {
                itemLocationHrid: rawEquipment.itemLocationHrid,
                itemHrid: rawEquipment.itemHrid,
                enhancementLevel: null,
                isAvailable: false,
            };
        });
    }

    function normalizeCachedSnapshots(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

        // Future-proof wrapped cache format while remaining backward compatible with the
        // existing plain { [loadoutId]: snapshot } cache already installed for users.
        // Cache is untrusted/stale input: rebuild the canonical raw schema explicitly rather
        // than spreading arbitrary legacy/effective fields back into Core truth state.
        const candidate = value.snapshots && typeof value.snapshots === 'object' ? value.snapshots : value;
        const normalized = {};

        for (const [snapshotId, snapshot] of Object.entries(candidate)) {
            if (!snapshot || typeof snapshot !== 'object' || !snapshot.name) continue;

            const equipment = [];
            for (const entry of Array.isArray(snapshot.equipment) ? snapshot.equipment : []) {
                if (!entry?.itemHrid || !entry?.itemLocationHrid) continue;
                equipment.push({
                    itemLocationHrid: entry.itemLocationHrid,
                    itemHrid: entry.itemHrid,
                    enhancementLevel: normalizeSavedEnhancementLevel(entry.enhancementLevel),
                    savedItemHash: typeof entry.savedItemHash === 'string' ? entry.savedItemHash : '',
                });
            }

            const abilities = [];
            for (const entry of Array.isArray(snapshot.abilities) ? snapshot.abilities : []) {
                if (!entry?.abilityHrid) continue;
                const parsedSlot = Number.parseInt(entry.slot, 10);
                abilities.push({
                    abilityHrid: entry.abilityHrid,
                    slot: Number.isFinite(parsedSlot) ? parsedSlot : 0,
                });
            }
            abilities.sort((a, b) => a.slot - b.slot);

            const normalizeConsumables = (entries) =>
                (Array.isArray(entries) ? entries : []).map((entry) => ({
                    itemHrid: typeof entry === 'string' ? entry : entry?.itemHrid || '',
                }));

            normalized[String(snapshotId)] = {
                snapshotId: String(snapshotId),
                name: snapshot.name,
                actionTypeHrid: snapshot.actionTypeHrid || '',
                isDefault: !!snapshot.isDefault,
                suppressValidation: !!snapshot.suppressValidation,
                useExactEnhancement: snapshot.useExactEnhancement === true,
                ordinal: snapshot.ordinal || 0,
                equipment,
                abilities,
                food: normalizeConsumables(snapshot.food),
                drinks: normalizeConsumables(snapshot.drinks),
                abilityCombatTriggersMap: cloneTriggerMap(snapshot.abilityCombatTriggersMap),
                consumableCombatTriggersMap: cloneTriggerMap(snapshot.consumableCombatTriggersMap),
                capturedAt: Number(snapshot.capturedAt ?? snapshot.savedAt) || Date.now(),
            };
        }

        return normalized;
    }

    class LoadoutState {
        constructor() {
            this.implementationId = LOADOUT_STATE_IMPLEMENTATION_ID;
            this.rawSnapshots = {};
            this.activeCharacterId = null;
            this.activeSocket = null;
            this.authority = 'none'; // none | cache | server
            this.generation = 0;
            this.captureStarted = false;
            this.persistenceReady = false;
            this.updateListeners = new Set();
            this.inventoryResolutionSignatures = new Map();
            // Effective snapshots are expensive to resolve: each equipment slot validates against
            // current ownership and consumables validate against inventory presence. Action-card
            // calculations can read the same saved loadout hundreds of times while mounting a
            // skill page, so resolving on every read turns a correct state model into a hot-path
            // performance regression. Keep one canonical effective snapshot per raw snapshot and
            // refresh it only when raw loadout state or relevant inventory semantics change.
            this.resolvedSnapshotCache = new Map();
            this.actionTypeSelectionIdCache = new Map();

            this.initCharacterDataHandler = (data, context) => this._onInitCharacterData(data, context);
            this.loadoutsUpdatedHandler = (data, context) => this._onLoadoutsUpdated(data, context);
            this.characterSwitchingHandler = (data) => this._onCharacterSwitching(data);
            this.itemsUpdatedHandler = (data) => this._onItemsUpdated(data);
        }

        /**
         * Start always-on capture. Must run once immediately after the WebSocket hook is installed.
         */
        startCapture() {
            if (this.captureStarted) return;
            this.captureStarted = true;

            webSocketHook.on('init_character_data', this.initCharacterDataHandler);
            webSocketHook.on('loadouts_updated', this.loadoutsUpdatedHandler);
            dataManager.on('character_switching', this.characterSwitchingHandler);
            dataManager.on('items_updated', this.itemsUpdatedHandler);

            // Defensive bootstrap for dev/hot-reload cases where character data predates capture.
            if (dataManager.characterData?.character?.id) {
                this._onInitCharacterData(dataManager.characterData);
            }
        }

        /**
         * Stop capture. Exposed for tests/debug teardown; normal Toolasha runtime keeps this service alive.
         */
        stopCapture() {
            if (!this.captureStarted) return;
            webSocketHook.off('init_character_data', this.initCharacterDataHandler);
            webSocketHook.off('loadouts_updated', this.loadoutsUpdatedHandler);
            dataManager.off('character_switching', this.characterSwitchingHandler);
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.captureStarted = false;
        }

        /**
         * Enable best-effort IndexedDB hydration/persistence after storage is initialized.
         * Server state already captured before this call must never be overwritten by cache.
         */
        async hydratePersistence() {
            this.persistenceReady = true;
            const characterId = this.activeCharacterId;
            if (!characterId) return;

            const generation = this.generation;
            if (this.authority === 'server') {
                await this._persistCurrent(characterId, generation);
                return;
            }

            await this._hydrateForCharacter(characterId, generation);
        }

        onUpdate(listener) {
            if (typeof listener === 'function') this.updateListeners.add(listener);
        }

        offUpdate(listener) {
            this.updateListeners.delete(listener);
        }

        /**
         * Expose Core-owned current-ownership semantics without forcing feature bundles to
         * import named helpers from this externalized module. Keeping the helper behind the
         * canonical service also prevents Rollup's IIFE global mapping from treating the
         * singleton object as a module namespace.
         * @param {Array<Object>|null|undefined} characterItems
         * @returns {Map<string, {highestEnhancementLevel: number, levels: Set<number>} >}
         */
        getOwnedEnhancementIndex(characterItems = dataManager.getInventory?.()) {
            return buildOwnedEnhancementIndex(characterItems);
        }

        /**
         * Fingerprint the inventory-dependent portion of one raw loadout. The signature excludes
         * counts that remain positive and includes only effective equipment levels/availability and
         * consumable availability. Raw/server changes still emit unconditionally.
         * @param {Object} rawSnapshot
         * @param {Array<Object>|null|undefined} inventory
         * @returns {string}
         * @private
         */
        _buildInventoryResolutionSignature(rawSnapshot, inventory = dataManager.getInventory?.()) {
            return this._buildResolutionSignature(this._resolveRawSnapshot(rawSnapshot, inventory));
        }

        _buildResolutionSignature(resolvedSnapshot) {
            if (!resolvedSnapshot) return '';
            const equipment = (resolvedSnapshot.equipment || [])
                .map((entry) => `${entry.itemLocationHrid}:${entry.itemHrid}:${entry.enhancementLevel}`)
                .join(',');
            const unavailableEquipment = (resolvedSnapshot.unavailableEquipment || [])
                .map((entry) => `${entry.itemLocationHrid}:${entry.itemHrid}:missing`)
                .join(',');
            const food = (resolvedSnapshot.food || []).map((entry) => entry.itemHrid || '').join(',');
            const drinks = (resolvedSnapshot.drinks || []).map((entry) => entry.itemHrid || '').join(',');
            const unavailableFood = (resolvedSnapshot.unavailableFood || [])
                .map((entry) => `${entry.slotIndex}:${entry.itemHrid}`)
                .join(',');
            const unavailableDrinks = (resolvedSnapshot.unavailableDrinks || [])
                .map((entry) => `${entry.slotIndex}:${entry.itemHrid}`)
                .join(',');
            return `${equipment}|${unavailableEquipment}|${food}|${drinks}|${unavailableFood}|${unavailableDrinks}`;
        }

        _refreshResolvedState() {
            const inventory = dataManager.getInventory?.();
            const nextSignatures = new Map();
            const nextResolved = new Map();
            for (const [snapshotId, rawSnapshot] of Object.entries(this.rawSnapshots)) {
                const resolved = this._resolveRawSnapshot(rawSnapshot, inventory);
                nextResolved.set(snapshotId, resolved);
                nextSignatures.set(snapshotId, this._buildResolutionSignature(resolved));
            }
            this.resolvedSnapshotCache = nextResolved;
            this.inventoryResolutionSignatures = nextSignatures;
            this.actionTypeSelectionIdCache.clear();
        }

        _emitUpdate() {
            for (const listener of [...this.updateListeners]) {
                try {
                    listener();
                } catch (error) {
                    console.error('[LoadoutState] Update listener failed:', error);
                }
            }
        }

        _onCharacterSwitching(_data) {
            this.generation += 1;
            this.activeCharacterId = null;
            this.activeSocket = null;
            this.authority = 'none';
            this.rawSnapshots = {};
            this.inventoryResolutionSignatures = new Map();
            this.resolvedSnapshotCache = new Map();
            this.actionTypeSelectionIdCache = new Map();

            // Do not broadcast a normal loadout update while the departing character's
            // feature listeners are still being synchronously torn down. Some consumers
            // persist derived bindings and could otherwise mistake the transient empty
            // state for "all loadouts were deleted". The incoming character's server/cache
            // state will emit after cleanup has begun/completed.
        }

        _onInitCharacterData(data, context = null) {
            const characterId = normalizeCharacterId(data?.character?.id);
            if (!characterId) {
                console.warn('[LoadoutState] Ignoring init_character_data without a character id');
                return;
            }

            // DataManager is registered on the WebSocket hook before LoadoutState and is the
            // authority for whether an init_character_data transition was accepted. In
            // particular, DataManager deliberately rejects rapid (<1s) cross-character
            // transitions as loop protection. Never ingest a payload that DataManager rejected,
            // otherwise loadouts from character C could be combined with inventory from B.
            const acceptedCharacterId = normalizeCharacterId(dataManager.getCurrentCharacterId?.());
            if (!acceptedCharacterId || acceptedCharacterId !== characterId) {
                console.warn('[LoadoutState] Ignoring init_character_data not accepted by DataManager');
                return;
            }

            const previousCharacterId = this.activeCharacterId;
            const characterChanged = previousCharacterId !== characterId;
            this.generation += 1;
            const generation = this.generation;
            this.activeCharacterId = characterId;

            // WebSocket messages are FIFO only within one socket. During a reconnect/character
            // switch, an old socket can still deliver a delayed loadouts_updated payload after the
            // new character is already active, and that payload does not reliably carry a character
            // id. Bind accepted server state to the socket that delivered init_character_data so
            // later cross-socket updates can be rejected without guessing from payload shape.
            if (context?.socket) this.activeSocket = context.socket;
            else if (characterChanged) this.activeSocket = null;

            if (hasOwn(data, 'characterLoadoutMap')) {
                this._replaceFromServer(data.characterLoadoutMap, characterId);
                this._persistCurrentBestEffort(characterId, generation);
                return;
            }

            // Never carry another character's snapshots through a payload that lacks loadout state.
            // Same-character resyncs may omit the map; in that case retain the already-known state.
            if (characterChanged) {
                this.rawSnapshots = {};
                this.authority = 'none';
                this._refreshResolvedState();
                this._emitUpdate();
            }

            if (this.persistenceReady && this.authority !== 'server') {
                void this._hydrateForCharacter(characterId, generation);
            }
        }

        _onItemsUpdated(data) {
            const changedHrids = new Set((data?.endCharacterItems || []).map((item) => item?.itemHrid).filter(Boolean));
            if (changedHrids.size === 0) return;

            // Effective highest-owned state changes with inventory/equipment, while raw saved
            // snapshots intentionally do not. Only notify consumers when a changed item is
            // actually referenced by a saved loadout, avoiding noise from normal gathering.
            const inventory = dataManager.getInventory?.();
            let effectiveStateChanged = false;

            for (const [snapshotId, snapshot] of Object.entries(this.rawSnapshots)) {
                const referencesChangedItem =
                    (snapshot.equipment || []).some((item) => changedHrids.has(item.itemHrid)) ||
                    (snapshot.food || []).some((item) => changedHrids.has(item.itemHrid)) ||
                    (snapshot.drinks || []).some((item) => changedHrids.has(item.itemHrid));
                if (!referencesChangedItem) continue;

                const nextResolved = this._resolveRawSnapshot(snapshot, inventory);
                const nextSignature = this._buildResolutionSignature(nextResolved);
                const previousSignature = this.inventoryResolutionSignatures.get(snapshotId);
                if (nextSignature !== previousSignature) {
                    this.inventoryResolutionSignatures.set(snapshotId, nextSignature);
                    this.resolvedSnapshotCache.set(snapshotId, nextResolved);
                    effectiveStateChanged = true;
                }
            }

            if (effectiveStateChanged) this._emitUpdate();
        }

        _onLoadoutsUpdated(data, context = null) {
            if (!hasOwn(data, 'characterLoadoutMap')) {
                console.warn('[LoadoutState] loadouts_updated received without characterLoadoutMap');
                return;
            }

            const currentCharacterId = normalizeCharacterId(dataManager.getCurrentCharacterId?.());
            if (!this.activeCharacterId || !currentCharacterId || this.activeCharacterId !== currentCharacterId) {
                console.warn('[LoadoutState] Ignoring loadouts_updated outside an active matching character context');
                return;
            }

            if (this.activeSocket && context?.socket !== this.activeSocket) {
                console.warn('[LoadoutState] Ignoring loadouts_updated from an unauthenticated or stale WebSocket');
                return;
            }

            const payloadCharacterId = normalizeCharacterId(
                data?.characterID ?? data?.characterId ?? data?.character?.id ?? null
            );
            if (payloadCharacterId && payloadCharacterId !== this.activeCharacterId) {
                console.warn('[LoadoutState] Ignoring loadouts_updated for a different character');
                return;
            }

            this.generation += 1;
            const generation = this.generation;
            this._replaceFromServer(data.characterLoadoutMap, this.activeCharacterId);
            this._persistCurrentBestEffort(this.activeCharacterId, generation);
        }

        _replaceFromServer(loadoutMap, characterId) {
            if (!loadoutMap || typeof loadoutMap !== 'object' || Array.isArray(loadoutMap)) {
                console.warn('[LoadoutState] Invalid characterLoadoutMap; treating it as empty server state');
                loadoutMap = {};
            }

            const snapshots = {};
            for (const [snapshotId, loadout] of Object.entries(loadoutMap)) {
                if (!loadout?.name) continue;
                snapshots[String(snapshotId)] = buildRawLoadoutSnapshot(snapshotId, loadout);
            }

            this.activeCharacterId = normalizeCharacterId(characterId);
            this.rawSnapshots = snapshots;
            this.authority = 'server';
            this._refreshResolvedState();
            this._emitUpdate();
        }

        async _hydrateForCharacter(characterId, generation) {
            if (!this.persistenceReady || !characterId) return;

            let cached;
            try {
                cached = await storage.getJSON(getStorageKey(characterId), 'settings', null);
            } catch (error) {
                console.error('[LoadoutState] Failed to read loadout cache:', error);
                return;
            }

            if (generation !== this.generation || this.activeCharacterId !== characterId || this.authority === 'server') {
                return;
            }

            if (cached === null || cached === undefined) return;

            this.rawSnapshots = normalizeCachedSnapshots(cached);
            this.authority = 'cache';
            this._refreshResolvedState();
            this._emitUpdate();
        }

        _persistCurrentBestEffort(characterId, generation) {
            if (!this.persistenceReady) return;
            void this._persistCurrent(characterId, generation);
        }

        async _persistCurrent(characterId, generation) {
            if (!this.persistenceReady || !characterId) return false;
            if (generation !== this.generation || this.activeCharacterId !== characterId) return false;

            const snapshots = this._cloneRawSnapshots();
            try {
                return await storage.setJSON(getStorageKey(characterId), snapshots, 'settings');
            } catch (error) {
                console.error('[LoadoutState] Failed to persist loadout cache:', error);
                return false;
            }
        }

        _cloneRawSnapshots() {
            const clone = {};
            for (const [snapshotId, snapshot] of Object.entries(this.rawSnapshots)) {
                // Persist only the canonical raw schema. Do not spread arbitrary future fields:
                // effective/resolved metadata must never become cache truth accidentally.
                clone[snapshotId] = {
                    snapshotId: String(snapshotId),
                    name: snapshot.name || '',
                    actionTypeHrid: snapshot.actionTypeHrid || '',
                    isDefault: !!snapshot.isDefault,
                    suppressValidation: !!snapshot.suppressValidation,
                    useExactEnhancement: snapshot.useExactEnhancement === true,
                    ordinal: snapshot.ordinal || 0,
                    equipment: (snapshot.equipment || []).map((entry) => ({
                        itemLocationHrid: entry.itemLocationHrid,
                        itemHrid: entry.itemHrid,
                        enhancementLevel: normalizeSavedEnhancementLevel(entry.enhancementLevel),
                        savedItemHash: typeof entry.savedItemHash === 'string' ? entry.savedItemHash : '',
                    })),
                    abilities: (snapshot.abilities || []).map((entry) => ({
                        abilityHrid: entry.abilityHrid,
                        slot: Number.parseInt(entry.slot, 10) || 0,
                    })),
                    food: (snapshot.food || []).map((entry) => ({ itemHrid: entry?.itemHrid || '' })),
                    drinks: (snapshot.drinks || []).map((entry) => ({ itemHrid: entry?.itemHrid || '' })),
                    abilityCombatTriggersMap: cloneTriggerMap(snapshot.abilityCombatTriggersMap),
                    consumableCombatTriggersMap: cloneTriggerMap(snapshot.consumableCombatTriggersMap),
                    capturedAt: Number(snapshot.capturedAt) || Date.now(),
                };
            }
            return clone;
        }

        _resolveRawSnapshot(rawSnapshot, inventory = dataManager.getInventory?.()) {
            if (!rawSnapshot) return null;
            const resolvedEquipment = resolveLoadoutEquipment(rawSnapshot, inventory);
            const resolvedFood = resolveLoadoutConsumables(rawSnapshot.food, inventory);
            const resolvedDrinks = resolveLoadoutConsumables(rawSnapshot.drinks, inventory);
            const unavailableEquipment = resolvedEquipment
                .filter((entry) => entry.isAvailable === false)
                .map((entry) => ({
                    itemLocationHrid: entry.itemLocationHrid,
                    itemHrid: entry.itemHrid,
                }));
            const unavailableFood = resolvedFood
                .filter((entry) => entry.itemHrid && entry.isAvailable === false)
                .map((entry) => ({ slotIndex: entry.slotIndex, itemHrid: entry.itemHrid }));
            const unavailableDrinks = resolvedDrinks
                .filter((entry) => entry.itemHrid && entry.isAvailable === false)
                .map((entry) => ({ slotIndex: entry.slotIndex, itemHrid: entry.itemHrid }));

            // Do not expose raw enhancement-mode metadata or unresolved numeric levels to
            // feature consumers. Public `equipment` contains only equipment Toolasha can
            // prove is currently available; missing entries are carried separately so UIs
            // can warn without calculations accidentally consuming historical levels.
            const {
                equipment: _rawEquipment,
                useExactEnhancement: _rawUseExactEnhancement,
                suppressValidation: _rawSuppressValidation,
                ...publicMetadata
            } = rawSnapshot;

            return {
                ...publicMetadata,
                equipment: resolvedEquipment.filter((entry) => entry.isAvailable !== false),
                unavailableEquipment,
                hasUnavailableEquipment: unavailableEquipment.length > 0,
                unavailableFood,
                unavailableDrinks,
                hasUnavailableConsumables: unavailableFood.length > 0 || unavailableDrinks.length > 0,
                // Missing consumables never gate usability: unlike equipment (which can be rare or
                // costly to reacquire), food/drinks are cheap and fast to rebuy, so a loadout missing
                // only consumables is still usable — the resolved food/drinks arrays already blank the
                // missing slots above rather than fabricating an item the character doesn't own.
                isUsableForCalculation: unavailableEquipment.length === 0,
                // The game only exposes drink slots for a specific action type; an All Skills loadout
                // (actionTypeHrid === '') can never have real drinks, so its always-blank drinks array
                // is a structural void, not a player choice, and must not be trusted as "no tea" the
                // way a skill-specific loadout's genuinely-empty drinks slot is.
                drinksApplicable: rawSnapshot.actionTypeHrid !== '',
                abilities: (rawSnapshot.abilities || []).map((entry) => ({ ...entry })),
                // Preserve native slot indices, including intentional holes. Missing consumables
                // are blanked in calculation-facing arrays and retained only in the explicit
                // unavailable* diagnostics so callers cannot accidentally simulate an item the
                // character does not own.
                food: resolvedFood.map((entry) => ({ itemHrid: entry.isAvailable ? entry.itemHrid : '' })),
                drinks: resolvedDrinks.map((entry) => ({ itemHrid: entry.isAvailable ? entry.itemHrid : '' })),
                abilityCombatTriggersMap: cloneTriggerMap(rawSnapshot.abilityCombatTriggersMap),
                consumableCombatTriggersMap: cloneTriggerMap(rawSnapshot.consumableCombatTriggersMap),
            };
        }

        _cloneResolvedSnapshot(snapshot) {
            return snapshot ? cloneJsonSafeValue(snapshot) : null;
        }

        /**
         * Resolve a raw/cached snapshot against current character state.
         * Effective state is maintained event-driven by loadouts_updated / items_updated and reads
         * are served from the canonical cache. Returning a defensive clone preserves the old public
         * contract: feature code can never mutate Core's cached truth by holding a snapshot object.
         * @param {Object|string|null} snapshotOrId
         * @returns {Object|null}
         */
        resolveSnapshot(snapshotOrId) {
            if (!snapshotOrId) return null;

            let snapshotId = null;
            if (typeof snapshotOrId === 'string' || typeof snapshotOrId === 'number') {
                snapshotId = String(snapshotOrId);
            } else if (hasOwn(snapshotOrId, 'snapshotId')) {
                // A previously resolved snapshot has stable identity. If that id was deleted, do
                // not silently rebind the stale object to a newly-created loadout that happens to
                // reuse the same display name. Callers that intentionally select by name use
                // getSnapshotByName()/getUsableSnapshotByName() explicitly.
                snapshotId = String(snapshotOrId.snapshotId);
            } else if (snapshotOrId.name) {
                const rawSnapshot = Object.values(this.rawSnapshots).find(
                    (snapshot) => snapshot.name === snapshotOrId.name
                );
                snapshotId = rawSnapshot?.snapshotId || null;
            }

            if (!snapshotId || !this.rawSnapshots[snapshotId]) return null;

            let resolved = this.resolvedSnapshotCache.get(snapshotId);
            if (!resolved) {
                resolved = this._resolveRawSnapshot(this.rawSnapshots[snapshotId]);
                this.resolvedSnapshotCache.set(snapshotId, resolved);
                this.inventoryResolutionSignatures.set(snapshotId, this._buildResolutionSignature(resolved));
            }
            return this._cloneResolvedSnapshot(resolved);
        }

        getSnapshotById(snapshotId) {
            return this.resolveSnapshot(String(snapshotId));
        }

        getSnapshotByName(name) {
            const rawSnapshot = Object.values(this.rawSnapshots).find((snapshot) => snapshot.name === name);
            return rawSnapshot ? this.resolveSnapshot(rawSnapshot) : null;
        }

        getUsableSnapshotById(snapshotId) {
            const snapshot = this.getSnapshotById(snapshotId);
            return snapshot?.isUsableForCalculation ? snapshot : null;
        }

        getUsableSnapshotByName(name) {
            const snapshot = this.getSnapshotByName(name);
            return snapshot?.isUsableForCalculation ? snapshot : null;
        }

        getSnapshotsById() {
            const result = {};
            for (const snapshotId of Object.keys(this.rawSnapshots)) {
                const resolved = this.getSnapshotById(snapshotId);
                if (resolved) result[snapshotId] = resolved;
            }
            return result;
        }

        getAllSnapshots() {
            return Object.keys(this.rawSnapshots)
                .map((snapshotId) => this.getSnapshotById(snapshotId))
                .filter(Boolean)
                .sort((a, b) => a.ordinal - b.ordinal);
        }

        _getSelectedSnapshotIdForActionType(actionTypeHrid) {
            if (this.actionTypeSelectionIdCache.has(actionTypeHrid)) {
                return this.actionTypeSelectionIdCache.get(actionTypeHrid);
            }

            let skillDefault = null;
            let allSkillsDefault = null;
            let skillNonDefault = null;
            let allSkillsNonDefault = null;

            for (const rawSnapshot of Object.values(this.rawSnapshots)) {
                if (rawSnapshot.actionTypeHrid === actionTypeHrid) {
                    if (rawSnapshot.isDefault) skillDefault = rawSnapshot.snapshotId;
                    else skillNonDefault = rawSnapshot.snapshotId;
                } else if (rawSnapshot.actionTypeHrid === '') {
                    if (rawSnapshot.isDefault) allSkillsDefault = rawSnapshot.snapshotId;
                    else allSkillsNonDefault = rawSnapshot.snapshotId;
                }
            }

            const selectedId = skillDefault || allSkillsDefault || skillNonDefault || allSkillsNonDefault || null;
            this.actionTypeSelectionIdCache.set(actionTypeHrid, selectedId);
            return selectedId;
        }

        /**
         * Lightweight saved-loadout lookup for action/profit hot paths. Unlike the descriptive
         * snapshot API, this intentionally copies only the fields calculations need and never
         * clones abilities/trigger maps. Effective equipment/consumable state still comes from the
         * same canonical cache and therefore preserves all Exact/Highest/availability semantics.
         * @param {string} actionTypeHrid
         * @returns {{status:string,snapshot:Object|null}}
         */
        findCalculationSelectionForActionType(actionTypeHrid) {
            const selectedId = this._getSelectedSnapshotIdForActionType(actionTypeHrid);
            if (!selectedId) return { status: 'none', snapshot: null };

            const resolved = this.resolvedSnapshotCache.get(selectedId);
            if (!resolved) return { status: 'none', snapshot: null };

            const snapshot = {
                snapshotId: resolved.snapshotId,
                name: resolved.name,
                equipment: (resolved.equipment || []).map((entry) => ({ ...entry })),
                drinks: (resolved.drinks || []).map((entry) => ({ ...entry })),
                drinksApplicable: resolved.drinksApplicable,
                hasUnavailableEquipment: resolved.hasUnavailableEquipment,
                hasUnavailableConsumables: resolved.hasUnavailableConsumables,
                isUsableForCalculation: resolved.isUsableForCalculation,
            };

            return {
                status: snapshot.isUsableForCalculation ? 'usable' : 'unavailable',
                snapshot,
            };
        }

        /**
         * Find the preferred saved loadout for an action type. This method is independent of the
         * user setting that controls automatic profit/action calculations; callers decide whether
         * saved loadouts should be used in their context.
         * @param {string} actionTypeHrid
         * @returns {Object|null}
         */
        findSnapshotSelectionForActionType(actionTypeHrid) {
            const selectedId = this._getSelectedSnapshotIdForActionType(actionTypeHrid);

            if (!selectedId) return { status: 'none', snapshot: null };

            const resolved = this.resolveSnapshot(selectedId);
            if (!resolved) return { status: 'none', snapshot: null };
            return {
                status: resolved.isUsableForCalculation ? 'usable' : 'unavailable',
                snapshot: resolved,
            };
        }

        findSnapshotForActionType(actionTypeHrid) {
            const selection = this.findSnapshotSelectionForActionType(actionTypeHrid);
            return selection.status === 'usable' ? selection.snapshot : null;
        }

        /**
         * Expose state metadata for diagnostics/tests without exposing mutable raw snapshots.
         */
        getStateInfo() {
            return {
                activeCharacterId: this.activeCharacterId,
                authority: this.authority,
                generation: this.generation,
                snapshotCount: Object.keys(this.rawSnapshots).length,
                captureStarted: this.captureStarted,
                persistenceReady: this.persistenceReady,
            };
        }
    }

    const loadoutState = new LoadoutState();

    /**
     * Marketplace Session Service
     * Shared cross-bundle session management for marketplace workflows.
     * Ensures only one owner can run a marketplace workflow at a time.
     * Exported to window.Toolasha.Core via src/libraries/core.js.
     */

    /**
     * Stable keys for marketplace session owners.
     * Use these constants — never compare raw strings.
     */
    const MARKETPLACE_OWNER = Object.freeze({
        ACTIONS: 'ACTIONS',
        CRAFTING_PLAN: 'CRAFTING_PLAN',
        HOUSE: 'HOUSE',
        GUILD: 'GUILD',
        ABILITY_BOOK: 'ABILITY_BOOK',
        SELL_QUEUE: 'SELL_QUEUE',
        SHORTCUTS: 'SHORTCUTS',
        LABYRINTH_SUPPLIES: 'LABYRINTH_SUPPLIES',
    });

    class MarketplaceSessionService {
        constructor() {
            this._active = null; // { sessionId, owner, onEnd, consumeOnFill }
            this._counter = 0;
        }

        /**
         * Start a new session, atomically replacing any existing session.
         * The previous session's onEnd callback is called synchronously (exception-safe)
         * before the new session is created.
         *
         * @param {Object} opts
         * @param {string} opts.owner - MARKETPLACE_OWNER constant
         * @param {Function} [opts.onEnd] - Called with reason ('replaced'|'ended') when session ends.
         *   Must not call start()/end() on this service.
         * @param {boolean} [opts.consumeOnFill] - If true, session ends after first successful autofill
         * @returns {number} sessionId — store this token; use isActive() to verify ownership
         */
        start({ owner, onEnd, consumeOnFill = false }) {
            const sessionId = ++this._counter;

            if (this._active) {
                const prev = this._active;
                this._active = null; // clear before onEnd to prevent re-entrance
                try {
                    prev.onEnd?.('replaced');
                } catch (err) {
                    console.error('[MarketplaceSession] onEnd threw during replacement:', err);
                }
            }

            this._active = { sessionId, owner, onEnd, consumeOnFill };
            return sessionId;
        }

        /**
         * End a session by token. No-op if the token does not match the active session.
         * Calls onEnd with reason 'ended'.
         * @param {number} sessionId
         * @returns {boolean} True when the active session was ended
         */
        end(sessionId) {
            if (!this._active || this._active.sessionId !== sessionId) return false;
            const current = this._active;
            this._active = null;
            try {
                current.onEnd?.('ended');
            } catch (err) {
                console.error('[MarketplaceSession] onEnd threw during end:', err);
            }
            return true;
        }

        /**
         * End any active session unconditionally (e.g., on character switch).
         * Calls onEnd with reason 'ended'.
         * @returns {boolean} True when an active session was ended
         */
        endAll() {
            if (!this._active) return false;
            const current = this._active;
            this._active = null;
            try {
                current.onEnd?.('ended');
            } catch (err) {
                console.error('[MarketplaceSession] onEnd threw during endAll:', err);
            }
            return true;
        }

        /**
         * Check if a session token is still the active session.
         * @param {number} sessionId
         * @returns {boolean}
         */
        isActive(sessionId) {
            return this._active?.sessionId === sessionId;
        }

        /**
         * Get the active session info (owner + sessionId only).
         * Returns null if no active session.
         * @returns {{ sessionId: number, owner: string }|null}
         */
        getActive() {
            if (!this._active) return null;
            return { sessionId: this._active.sessionId, owner: this._active.owner };
        }

        /**
         * Consume a one-shot session (consumeOnFill: true) after a successful autofill.
         * No-op if the session is not active or not one-shot.
         * @param {number} sessionId
         * @returns {boolean} True if consumed and ended
         */
        consume(sessionId) {
            if (!this._active || this._active.sessionId !== sessionId) return false;
            if (!this._active.consumeOnFill) return false;
            this.end(sessionId);
            return true;
        }

        /**
         * Remove all custom marketplace UI nodes from the DOM.
         * Call this on endAll / character switch to ensure a clean slate.
         */
        clearAllMarketplaceUI() {
            document.querySelectorAll('[data-mwi-custom-tab]').forEach((el) => el.remove());
            document.querySelectorAll('[data-mwi-shrine-tab]').forEach((el) => el.remove());
        }
    }

    const marketplaceSession = new MarketplaceSessionService();

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
     * Per-feature instance store: key → returned value from initialize()
     * Used to thread the instance into cleanup(instance) at teardown time.
     */
    const featureInstances = new Map();

    /**
     * Initialize all enabled features
     * @param {Object} [options] - Optional lifecycle guard
     * @param {Function} [options.shouldContinue] - Returns false when initialization has become stale
     * @returns {Promise<void>}
     */
    async function initializeFeatures({ shouldContinue = () => true } = {}) {
        // Block feature initialization during character switch
        if (dataManager.getIsCharacterSwitching() || !shouldContinue()) {
            return;
        }

        const errors = [];

        for (const feature of featureRegistry) {
            if (!shouldContinue()) {
                break;
            }

            // Unique provisional ownership token for this initialize() attempt. A plain sentinel
            // (e.g. `null`) cannot distinguish "still owned by this attempt" from "reclaimed by a
            // later attempt after cleanup ran" - only an object identity comparison against this
            // exact token can. Declared outside the try so the catch block can also identify it.
            let ownershipToken;

            try {
                const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

                if (!isEnabled) {
                    continue;
                }

                // Skip if already initialized (idempotency — same-character resync guard, and also
                // what stops a concurrent second init pass from starting the same feature twice).
                if (featureInstances.has(feature.key)) {
                    continue;
                }

                // Claim ownership synchronously, before awaiting, so cleanupFeatures() can find and
                // tear down this feature even if a character switch begins while initialize() is
                // still in flight - slow persistence inside a feature must never decide whether
                // cleanup can see it.
                ownershipToken = Symbol(feature.key);
                featureInstances.set(feature.key, ownershipToken);

                // Initialize feature; always await the result so async flag is not required for correctness
                const start = performance.now();
                const instance = await Promise.resolve(feature.initialize());
                const elapsed = performance.now() - start;
                performanceMonitor.snapshot(`init:${feature.key}`, elapsed);

                // A concurrent cleanupFeatures() may have already reclaimed and deleted this entry
                // (and possibly torn the feature back down), or a later attempt may have re-claimed
                // the key, while initialize() was in flight - only replace the entry if it's still
                // the exact token this attempt claimed; otherwise a stale resolve must not resurrect
                // or overwrite ownership that has since moved on.
                if (featureInstances.get(feature.key) === ownershipToken) {
                    featureInstances.set(feature.key, instance ?? null);
                }
            } catch (error) {
                // Release ownership on rejection only if this attempt's token still owns the key -
                // a concurrent cleanup/reclaim may have already replaced it, in which case leave it alone.
                if (ownershipToken !== undefined && featureInstances.get(feature.key) === ownershipToken) {
                    featureInstances.delete(feature.key);
                }
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
     * Tear down all initialized features, threading their stored instance into cleanup.
     * Clears the instance store so features can be re-initialized afterward.
     * @returns {Promise<void>}
     */
    async function cleanupFeatures() {
        const cleanupPromises = [];

        for (const feature of featureRegistry) {
            if (!featureInstances.has(feature.key)) continue;

            const rawEntry = featureInstances.get(feature.key);
            featureInstances.delete(feature.key);
            performanceMonitor.clearSnapshot(`init:${feature.key}`);

            // While initialize() is still pending, the stored entry is a provisional ownership
            // token (a Symbol), never a real feature instance - module cleanup must see "no instance
            // yet" (null), not leak the internal token as if it were the feature's returned value.
            const instance = typeof rawEntry === 'symbol' ? null : rawEntry;

            try {
                const featureModule = feature.module || feature;
                let result;

                if (typeof featureModule.cleanup === 'function') {
                    result = featureModule.cleanup(instance);
                } else if (typeof featureModule.disable === 'function') {
                    result = featureModule.disable(instance);
                } else if (instance && typeof instance.disable === 'function') {
                    result = instance.disable();
                } else if (instance && typeof instance.cleanup === 'function') {
                    result = instance.cleanup();
                }

                if (result && typeof result.then === 'function') {
                    cleanupPromises.push(
                        result.catch((error) => {
                            console.error(`[FeatureRegistry] Failed to clean up ${feature.name}:`, error);
                        })
                    );
                }
            } catch (error) {
                console.error(`[FeatureRegistry] Failed to clean up ${feature.name}:`, error);
            }
        }

        if (cleanupPromises.length > 0) {
            await Promise.all(cleanupPromises);
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
        // Character switch lifecycle work is serialized through one queue. A monotonic
        // generation lets stale reinits stop when a newer switch arrives (A → B → A).
        // This prevents both dropped switch events and late cleanup from touching the
        // newest character's freshly initialized features.
        let lifecycleGeneration = 0;
        let lifecycleQueue = Promise.resolve();

        const enqueueLifecycleTask = (label, task) => {
            lifecycleQueue = lifecycleQueue
                .catch((error) => {
                    console.error('[FeatureRegistry] Previous lifecycle task failed:', error);
                })
                .then(task)
                .catch((error) => {
                    console.error(`[FeatureRegistry] ${label} lifecycle task failed:`, error);
                });

            return lifecycleQueue;
        };

        // Handle character_switching event (cleanup phase)
        dataManager.on('character_switching', (_data) => {
            lifecycleGeneration += 1;

            // Clear config cache immediately, before any asynchronous cleanup starts,
            // so code still running from the departing character cannot read its settings.
            if (config && typeof config.clearSettingsCache === 'function') {
                config.clearSettingsCache();
            }

            // IMPORTANT: start teardown synchronously in the character_switching callback.
            // Toolasha observes init_character_data from the MessageEvent.data getter, so
            // deferring cleanup to a Promise job allows the game to consume the new-character
            // payload while departing-character DOM handlers are still live. That can make
            // those handlers touch transition UI such as the offline-rewards modal.
            //
            // cleanupFeatures() executes all synchronous cleanup hooks before its first await;
            // the returned Promise still represents any async teardown. We feed only that
            // completion into the serialized queue, preserving the A → B → A ownership fix
            // without moving teardown out of the critical switch phase.
            marketplaceSession.endAll();
            marketplaceSession.clearAllMarketplaceUI();
            const cleanupPromise = cleanupFeatures();

            return enqueueLifecycleTask('character cleanup', async () => {
                await cleanupPromise;
            });
        });

        // Handle character_switched event (re-initialization phase)
        dataManager.on('character_switched', (data) => {
            const generation = lifecycleGeneration;
            const targetCharacterId = data?.newId ? String(data.newId) : null;

            const isCurrentGeneration = () => {
                if (generation !== lifecycleGeneration) {
                    return false;
                }

                const currentCharacterId = dataManager.getCurrentCharacterId?.();
                if (targetCharacterId && currentCharacterId != null) {
                    return String(currentCharacterId) === targetCharacterId;
                }

                return true;
            };

            return enqueueLifecycleTask('character reinitialization', async () => {
                // A newer switch may have arrived while this task waited in the queue.
                if (!isCurrentGeneration()) {
                    return;
                }

                // CRITICAL: Load settings BEFORE any feature initialization
                // This ensures all features see the new character's settings
                await config.loadSettings({ notifyChanges: false });

                // Loading IndexedDB can take long enough for another character switch.
                // Never apply or initialize settings that no longer belong to the active character.
                if (!isCurrentGeneration()) {
                    return;
                }

                config.applyColorSettings();

                // Small delay to ensure game state is stable
                await new Promise((resolve) => setTimeout(resolve, 50));

                if (!isCurrentGeneration()) {
                    return;
                }

                // Now re-initialize all features with fresh settings
                await initializeFeatures({ shouldContinue: isCurrentGeneration });
            });
        });
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

            // Clear any stale entry so initializeFeatures won't skip it, then immediately reclaim
            // ownership with a fresh unique token (see initializeFeatures) so cleanupFeatures() can
            // still find this feature - and only this retry attempt can resolve its own claim - if a
            // character switch begins while this retry's initialize() is in flight.
            featureInstances.delete(feature.key);
            const ownershipToken = Symbol(feature.key);
            featureInstances.set(feature.key, ownershipToken);

            try {
                const instance = await Promise.resolve(feature.initialize());
                if (featureInstances.get(feature.key) === ownershipToken) {
                    featureInstances.set(feature.key, instance ?? null);
                }

                // Verify the retry actually worked by running health check
                if (feature.healthCheck) {
                    const healthResult = feature.healthCheck();
                    if (healthResult === false) {
                        console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                    }
                }
            } catch (error) {
                if (featureInstances.get(feature.key) === ownershipToken) {
                    featureInstances.delete(feature.key);
                }
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


    const TOOLTIP_OBSERVER_IMPLEMENTATION_ID = 'toolasha-core-tooltip-observer-v1';

    class TooltipObserver {
        constructor() {
            this.implementationId = TOOLTIP_OBSERVER_IMPLEMENTATION_ID;
            this.subscribers = new Map(); // name -> { callback, notifyClose }
            this.unregisterObserver = null;
            this.isInitialized = false;
            this.activeRemovalObservers = new Set();
            this.observedElements = new WeakSet();
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
         * @param {Function} callback - Function(element, eventType) to call when tooltip appears
         * @param {Object} options - Subscription options
         * @param {boolean} options.notifyClose - Observe and report tooltip removal (default false)
         */
        subscribe(name, callback, options = {}) {
            this.subscribers.set(name, {
                callback,
                notifyClose: options.notifyClose === true,
            });

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

            if (this.subscribers.size === 0) {
                this.disable();
            }
        }

        /**
         * Notify all subscribers that a tooltip appeared
         * @param {Element} element - The tooltip/popper element
         * @private
         */
        notifySubscribers(element) {
            const needsCloseNotification = Array.from(this.subscribers.values()).some(
                (subscriber) => subscriber.notifyClose
            );

            // Current production subscribers only need open notifications. Avoid creating
            // one MutationObserver per transient tooltip unless close events are requested.
            if (needsCloseNotification && !this.observedElements.has(element)) {
                const observationRoot = document.body || element.parentNode;
                if (observationRoot) {
                    this.observedElements.add(element);
                    const removalObserver = new MutationObserver(() => {
                        if (element.isConnected) return;

                        for (const [name, subscriber] of this.subscribers.entries()) {
                            if (!subscriber.notifyClose) continue;
                            try {
                                subscriber.callback(element, 'closed');
                            } catch (error) {
                                console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                            }
                        }

                        removalObserver.disconnect();
                        this.activeRemovalObservers.delete(removalObserver);
                        this.observedElements.delete(element);
                    });

                    this.activeRemovalObservers.add(removalObserver);
                    removalObserver.observe(observationRoot, {
                        childList: true,
                        subtree: true,
                    });
                }
            }

            // Notify subscribers that tooltip opened
            for (const [name, subscriber] of this.subscribers.entries()) {
                try {
                    subscriber.callback(element, 'opened');
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
            for (const observer of this.activeRemovalObservers) {
                observer.disconnect();
            }
            this.activeRemovalObservers.clear();
            this.observedElements = new WeakSet();
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
        show(message = t('networkAlert.marketDataUnavailable')) {
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
     * Timer Registry Utility
     * Centralized registration for intervals and timeouts.
     */

    /**
     * Create a timer registry for deterministic teardown.
     * @returns {{
     *   registerInterval: (intervalId: number) => void,
     *   registerTimeout: (timeoutId: number) => void,
     *   clearAll: () => void
     * }} Timer registry API
     */
    function createTimerRegistry() {
        const intervals = [];
        const timeouts = [];

        const registerInterval = (intervalId) => {
            if (!intervalId) {
                console.warn('[TimerRegistry] registerInterval called with invalid interval id');
                return;
            }

            intervals.push(intervalId);
        };

        const registerTimeout = (timeoutId) => {
            if (!timeoutId) {
                console.warn('[TimerRegistry] registerTimeout called with invalid timeout id');
                return;
            }

            timeouts.push(timeoutId);
        };

        const clearAll = () => {
            intervals.forEach((intervalId) => {
                try {
                    clearInterval(intervalId);
                } catch (error) {
                    console.error('[TimerRegistry] Failed to clear interval:', error);
                }
            });
            intervals.length = 0;

            timeouts.forEach((timeoutId) => {
                try {
                    clearTimeout(timeoutId);
                } catch (error) {
                    console.error('[TimerRegistry] Failed to clear timeout:', error);
                }
            });
            timeouts.length = 0;
        };

        return {
            registerInterval,
            registerTimeout,
            clearAll,
        };
    }

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

            // Periodic re-fetch so long-lived sessions don't run on a snapshot that's gone stale
            // for items nobody has viewed the order book for (see startAutoRefresh)
            this.timerRegistry = createTimerRegistry();
            this.autoRefreshStarted = false;
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
                networkAlert.show(t('networkAlert.outdatedData'));
                return this.marketData;
            }

            // Total failure - show alert
            console.error('[MarketAPI] ❌ No market data available');
            networkAlert.show(t('networkAlert.marketDataUnavailable'));
            return null;
        }

        /**
         * Start periodically re-checking the base snapshot so a long-lived tab doesn't keep serving
         * prices from whenever the page happened to load. fetch() (unforced) only hits the network
         * once CACHE_DURATION has actually elapsed - see getCachedData() - so this just makes sure
         * that check runs on a timer instead of never running again after the initial load. Safe to
         * call multiple times; only the first call starts the interval.
         */
        startAutoRefresh() {
            if (this.autoRefreshStarted) {
                return;
            }
            this.autoRefreshStarted = true;

            const intervalId = setInterval(() => {
                this.fetch().catch((error) => {
                    this.logError('Auto-refresh fetch failed', error);
                });
            }, this.CACHE_DURATION);

            this.timerRegistry.registerInterval(intervalId);
        }

        /**
         * Stop the periodic re-fetch started by startAutoRefresh().
         */
        stopAutoRefresh() {
            this.timerRegistry.clearAll();
            this.autoRefreshStarted = false;
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
     * Market Values API Module
     * Fetches and caches the game's own reference "market value" estimates
     * (https://www.milkywayidle.com/game_data/market_values.json) - the same endpoint the game
     * client itself fetches and caches. Each item maps to an array of one blended price estimate
     * per enhancement level (or a single entry for non-enhanceable items), distinct from the live
     * ask/bid order-book data in marketplace.js. Used as a last-resort fallback price source for
     * items with no live order-book data and no computable crafting/shop cost.
     */


    /**
     * MarketValuesAPI class handles fetching and caching the game's reference market values
     */
    class MarketValuesAPI {
        constructor() {
            this.API_URL = 'https://www.milkywayidle.com/game_data/market_values.json';

            // Cache settings - this is a slow-moving reference value, not live order-book data
            this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour
            this.CACHE_KEY_DATA = 'Toolasha_marketValuesAPI_json';
            this.CACHE_KEY_TIMESTAMP = 'Toolasha_marketValuesAPI_timestamp';

            // { "<bare_item_name>": [priceAtLvl0, priceAtLvl1, ...] | [price] }
            this.marketItemValues = null;
            this.marketValuesVersion = 0;

            this.timerRegistry = createTimerRegistry();
            this.autoRefreshStarted = false;
        }

        /**
         * Fetch market values from API or cache
         * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
         * @returns {Promise<Object|null>} marketItemValues object or null if unavailable
         */
        async fetch(forceFetch = false) {
            if (!forceFetch) {
                const cached = await this.getCachedData();
                if (cached) {
                    this.marketItemValues = cached.marketItemValues;
                    this.marketValuesVersion = cached.marketValuesVersion || 0;
                    return this.marketItemValues;
                }
            }

            try {
                const data = await this.fetchFromAPI();
                if (data) {
                    this.marketItemValues = data.marketItemValues;
                    this.marketValuesVersion = data.marketValuesVersion || 0;
                    this.cacheData(data);
                    return this.marketItemValues;
                }
            } catch (error) {
                console.error('[MarketValuesAPI] Fetch failed:', error);
            }

            // Fallback: expired cache is still better than nothing for a slow-moving reference value
            const expired = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (expired) {
                console.warn('[MarketValuesAPI] Using expired cache as fallback');
                this.marketItemValues = expired.marketItemValues;
                this.marketValuesVersion = expired.marketValuesVersion || 0;
                return this.marketItemValues;
            }

            return null;
        }

        /**
         * Start periodically re-checking the reference snapshot so a long-lived tab doesn't keep
         * serving values from whenever the page happened to load. Safe to call multiple times;
         * only the first call starts the interval.
         */
        startAutoRefresh() {
            if (this.autoRefreshStarted) {
                return;
            }
            this.autoRefreshStarted = true;

            const intervalId = setInterval(() => {
                this.fetch().catch((error) => {
                    console.error('[MarketValuesAPI] Auto-refresh fetch failed:', error);
                });
            }, this.CACHE_DURATION);

            this.timerRegistry.registerInterval(intervalId);
        }

        /**
         * Stop the periodic re-fetch started by startAutoRefresh().
         */
        stopAutoRefresh() {
            this.timerRegistry.clearAll();
            this.autoRefreshStarted = false;
        }

        /**
         * Fetch from the API endpoint
         * @returns {Promise<Object|null>} { marketValuesVersion, marketItemValues } or null
         */
        async fetchFromAPI() {
            const response = await fetch(this.API_URL);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.marketItemValues || typeof data.marketItemValues !== 'object') {
                throw new Error('Invalid API response structure');
            }

            return data;
        }

        /**
         * Get cached data if still within CACHE_DURATION
         * @returns {Promise<Object|null>} { marketValuesVersion, marketItemValues } or null
         */
        async getCachedData() {
            const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
            const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

            if (!cachedTimestamp || !cachedData) {
                return null;
            }

            if (Date.now() - cachedTimestamp > this.CACHE_DURATION) {
                return null;
            }

            return cachedData;
        }

        /**
         * Cache the fetched data
         * @param {Object} data - { marketValuesVersion, marketItemValues }
         */
        cacheData(data) {
            storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
            storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
        }

        /**
         * Get the game's reference market value for an item at a given enhancement level.
         * Not ask/bid - a single blended estimate, intended as a last-resort fallback.
         * @param {string} itemHrid - e.g. "/items/sinister_cape"
         * @param {number} enhancementLevel - 0-20 (default 0)
         * @returns {number|null} Reference price, or null if unavailable
         */
        getValue(itemHrid, enhancementLevel = 0) {
            if (!this.marketItemValues || !itemHrid) {
                return null;
            }

            const bareName = itemHrid.replace('/items/', '');
            const levels = this.marketItemValues[bareName];
            if (!Array.isArray(levels)) {
                return null;
            }

            const value = levels[enhancementLevel];
            return typeof value === 'number' && value > 0 ? value : null;
        }

        /**
         * Check whether a live price is an "outlier" relative to the reference value, and return
         * the value to use instead. Never flags anything when the guard is disabled, or when there's
         * no reference value for this item/level at all (the 872-item dataset doesn't cover
         * everything, so there's nothing to compare against - the raw price always passes through).
         * @param {string} itemHrid
         * @param {number} enhancementLevel
         * @param {number} rawValue - The live ask/bid value to check
         * @returns {{value: number, isOutlier: boolean}}
         */
        checkOutlier(itemHrid, enhancementLevel, rawValue) {
            if (typeof rawValue !== 'number' || rawValue <= 0) {
                return { value: rawValue, isOutlier: false };
            }

            if (!config.getSetting('marketData_outlierGuardEnabled')) {
                return { value: rawValue, isOutlier: false };
            }

            const reference = this.getValue(itemHrid, enhancementLevel);
            if (!reference) {
                return { value: rawValue, isOutlier: false };
            }

            const multiplier = Number(config.getSettingValue('marketData_outlierBandMultiplier', 3)) || 3;
            if (rawValue > reference * multiplier || rawValue < reference / multiplier) {
                return { value: reference, isOutlier: true };
            }

            return { value: rawValue, isOutlier: false };
        }
    }

    const marketValuesAPI = new MarketValuesAPI();

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
        loadoutState,
        featureRegistry: featureRegistry$1,
        settingsStorage,
        settingsGroups,
        tooltipObserver,
        i18n,
        profileManager: {
            setCurrentProfile,
            getCurrentProfile,
            clearCurrentProfile,
        },
        marketAPI,
        marketValuesAPI,
        performanceMonitor,
        marketplaceSession,
        MARKETPLACE_OWNER,
    };

    console.log('[Toolasha] Core library loaded');

})();
