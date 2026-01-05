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

        console.log('[WebSocket Hook] Installing hook at:', new Date().toISOString());

        // Capture hook instance for listener closure
        const hookInstance = this;

        // Get original WebSocket from unsafeWindow (game's context)
        const OriginalWebSocket = unsafeWindow.WebSocket;

        // Create wrapper class
        class WrappedWebSocket extends OriginalWebSocket {
            constructor(...args) {
                super(...args);

                // Only hook MWI game server WebSocket
                if (this.url.startsWith("wss://api.milkywayidle.com/ws") ||
                    this.url.startsWith("wss://api-test.milkywayidle.com/ws")) {

                    console.log('[WebSocket Hook] Subscribing to game WebSocket');

                    // Add message listener - fires exactly once per message
                    this.addEventListener("message", (event) => {
                        hookInstance.processMessage(event.data);
                    });
                }
            }
        }

        // Preserve static properties (required by game's connection health check)
        // Use Object.defineProperty because class properties are read-only by default
        Object.defineProperty(WrappedWebSocket, 'CONNECTING', {
            value: OriginalWebSocket.CONNECTING,
            writable: false,
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(WrappedWebSocket, 'OPEN', {
            value: OriginalWebSocket.OPEN,
            writable: false,
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(WrappedWebSocket, 'CLOSED', {
            value: OriginalWebSocket.CLOSED,
            writable: false,
            enumerable: true,
            configurable: true
        });

        // Replace window.WebSocket in game's context
        unsafeWindow.WebSocket = WrappedWebSocket;

        this.isHooked = true;
        console.log('[WebSocket Hook] Hook successfully installed');
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
                console.log('[WebSocket Hook] init_character_data received and saved at:', new Date().toISOString());
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
     * Uses official game API to avoid manual decompression
     */
    captureClientDataFromLocalStorage() {
        try {
            if (typeof GM_setValue === 'undefined') {
                return;
            }

            // Use official game API instead of manual localStorage access
            if (typeof localStorageUtil === 'undefined' ||
                typeof localStorageUtil.getInitClientData !== 'function') {
                // API not ready yet, retry
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }

            // API returns parsed object and handles decompression automatically
            const clientDataObj = localStorageUtil.getInitClientData();
            if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
                // Data not available yet, retry
                setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
                return;
            }

            // Verify it's init_client_data
            if (clientDataObj?.type === 'init_client_data') {
                // Save as JSON string for Combat Sim export
                const clientDataStr = JSON.stringify(clientDataObj);
                GM_setValue('toolasha_init_client_data', clientDataStr);
                console.log('[Toolasha] Client data captured from localStorage via official API');
            }
        } catch (error) {
            console.error('[WebSocket] Failed to capture client data from localStorage:', error);
            // Retry on error
            setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
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

export default webSocketHook;

// Also export the class for testing
export { WebSocketHook };
