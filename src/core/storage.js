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
        this.dbVersion = 17; // Bumped for leaderboardHistory store
        this.saveDebounceTimers = new Map(); // Per-key debounce timers
        this.pendingWrites = new Map(); // Per-key pending write data: {value, storeName}
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
                console.error('[Storage] Failed to open IndexedDB', request.error);
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

        const existing = this.pendingWrites.get(timerKey);
        const resolvers = existing?.resolvers || [];

        this.pendingWrites.set(timerKey, { value, storeName, resolvers });

        if (this.saveDebounceTimers.has(timerKey)) {
            clearTimeout(this.saveDebounceTimers.get(timerKey));
        }

        return new Promise((resolve) => {
            resolvers.push(resolve);

            const timer = setTimeout(async () => {
                const pending = this.pendingWrites.get(timerKey);
                this.pendingWrites.delete(timerKey);
                this.saveDebounceTimers.delete(timerKey);

                let success = false;
                if (pending) {
                    success = await this._saveToIndexedDB(key, pending.value, pending.storeName);
                }

                for (const r of pending?.resolvers || []) {
                    r(success);
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

        // Now execute all pending writes immediately and resolve their Promises
        const writes = Array.from(this.pendingWrites.entries());
        this.pendingWrites.clear();

        for (const [timerKey, pending] of writes) {
            const colonIndex = timerKey.indexOf(':');
            const key = timerKey.substring(colonIndex + 1);

            const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);
            for (const r of pending.resolvers || []) {
                r(success);
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

export default storage;
