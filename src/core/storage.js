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
        this.dbVersion = 8; // Bumped for combatStats store
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

export default storage;
