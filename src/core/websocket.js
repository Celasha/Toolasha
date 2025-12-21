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

        console.log('[WebSocket Hook] Installing...');

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
        console.log('[WebSocket Hook] ✅ Installed successfully');
    }

    /**
     * Process intercepted message
     * @param {string} message - JSON string from WebSocket
     */
    processMessage(message) {
        try {
            const data = JSON.parse(message);
            const messageType = data.type;

            // Log message type (for debugging)
            console.log(`[WebSocket] Received: ${messageType}`);

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
     * Register a handler for a specific message type
     * @param {string} messageType - Message type to handle (e.g., "init_character_data")
     * @param {Function} handler - Function to call when message received
     */
    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
        console.log(`[WebSocket Hook] Registered handler for: ${messageType}`);
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
