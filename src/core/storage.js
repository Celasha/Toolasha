/**
 * Storage Wrapper
 * Provides a clean API for persistent storage using GM_getValue/GM_setValue
 * Can be extended to support IndexedDB in the future
 */

/**
 * Storage class for managing persistent data
 * Currently uses Greasemonkey storage (GM_getValue/GM_setValue)
 */
class Storage {
    constructor() {
        // Check if GM functions are available
        if (typeof GM_getValue === 'undefined' || typeof GM_setValue === 'undefined') {
            console.error('GM storage functions not available. Storage will not persist.');
            this.available = false;
        } else {
            this.available = true;
        }
    }

    /**
     * Get a value from storage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} The stored value or default
     */
    get(key, defaultValue = null) {
        if (!this.available) {
            console.warn(`Storage not available, returning default for key: ${key}`);
            return defaultValue;
        }

        try {
            const value = GM_getValue(key, defaultValue);
            return value;
        } catch (error) {
            console.error(`Error reading from storage (key: ${key}):`, error);
            return defaultValue;
        }
    }

    /**
     * Set a value in storage
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @returns {boolean} Success status
     */
    set(key, value) {
        if (!this.available) {
            console.warn(`Storage not available, cannot save key: ${key}`);
            return false;
        }

        try {
            GM_setValue(key, value);
            return true;
        } catch (error) {
            console.error(`Error writing to storage (key: ${key}):`, error);
            return false;
        }
    }

    /**
     * Get a JSON object from storage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist or parse fails
     * @returns {*} The parsed object or default
     */
    getJSON(key, defaultValue = null) {
        const raw = this.get(key, null);

        if (raw === null) {
            return defaultValue;
        }

        // If it's already an object (GM storage can store objects directly in some implementations)
        if (typeof raw === 'object') {
            return raw;
        }

        // Otherwise, try to parse as JSON string
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.error(`Error parsing JSON from storage (key: ${key}):`, error);
            return defaultValue;
        }
    }

    /**
     * Set a JSON object in storage
     * @param {string} key - Storage key
     * @param {*} value - Object to store (will be JSON stringified)
     * @returns {boolean} Success status
     */
    setJSON(key, value) {
        try {
            // Try to stringify the value
            const json = JSON.stringify(value);
            return this.set(key, json);
        } catch (error) {
            console.error(`Error stringifying JSON for storage (key: ${key}):`, error);
            return false;
        }
    }

    /**
     * Delete a key from storage
     * @param {string} key - Storage key to delete
     * @returns {boolean} Success status
     */
    delete(key) {
        if (!this.available) {
            console.warn(`Storage not available, cannot delete key: ${key}`);
            return false;
        }

        try {
            GM_setValue(key, undefined);
            return true;
        } catch (error) {
            console.error(`Error deleting from storage (key: ${key}):`, error);
            return false;
        }
    }

    /**
     * Check if a key exists in storage
     * @param {string} key - Storage key to check
     * @returns {boolean} True if key exists
     */
    has(key) {
        if (!this.available) {
            return false;
        }

        try {
            const value = GM_getValue(key, '__STORAGE_CHECK__');
            return value !== '__STORAGE_CHECK__';
        } catch (error) {
            console.error(`Error checking storage (key: ${key}):`, error);
            return false;
        }
    }
}

// Create and export singleton instance
const storage = new Storage();

export default storage;

// Also export the class for testing
export { Storage };
