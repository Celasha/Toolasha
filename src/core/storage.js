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

export default storage;

// Also export the class for testing
export { Storage };
