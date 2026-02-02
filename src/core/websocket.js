/**
 * WebSocket Hook Module
 * Intercepts WebSocket messages from the MWI game server
 *
 * Uses WebSocket constructor wrapper for better performance than MessageEvent.prototype.data hooking
 */

import { setCurrentProfile } from '../features/combat/profile-cache.js';

class WebSocketHook {
    constructor() {
        this.isHooked = false;
        this.messageHandlers = new Map();
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
            GM_setValue(key, value);
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
            if (
                socket.url.indexOf('api.milkywayidle.com/ws') === -1 &&
                socket.url.indexOf('api-test.milkywayidle.com/ws') === -1
            ) {
                return originalGet.call(this);
            }

            const message = originalGet.call(this);

            // Anti-loop: define data property so we don't hook our own access
            Object.defineProperty(this, 'data', { value: message });

            // Process message in our hook
            hookInstance.processMessage(message);

            return message;
        };

        Object.defineProperty(MessageEvent.prototype, 'data', dataProperty);

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
     * Cleanup any pending retry timeouts
     */
    cleanup() {
        this.clearClientDataRetry();
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

const webSocketHook = new WebSocketHook();

export default webSocketHook;
