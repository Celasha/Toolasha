/**
 * WebSocket Hook Module
 * Intercepts WebSocket messages from the MWI game server
 *
 * Uses WebSocket constructor wrapper for better performance than MessageEvent.prototype.data hooking
 */

import { setCurrentProfile } from './profile-manager.js';
import storage from './storage.js';

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
        this.wrapWebSocketPrototype();

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
            hookInstance.processMessage(message);

            return message;
        };

        Object.defineProperty(pageMessageEvent.prototype, 'data', dataProperty);

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
            messageType === 'actions_updated' ||
            messageType === 'items_updated' ||
            messageType === 'market_item_order_books_updated' ||
            messageType === 'market_listings_updated' ||
            messageType === 'profile_shared' ||
            messageType === 'battle_consumable_ability_updated' ||
            messageType === 'battle_unit_fetched' ||
            messageType === 'action_type_consumable_slots_updated' ||
            messageType === 'consumable_buffs_updated' ||
            messageType === 'character_info_updated' ||
            messageType === 'labyrinth_updated' ||
            messageType === 'loadouts_updated' ||
            messageType === 'setting_updated' ||
            messageType === 'labyrinth_room_progress' ||
            messageType === 'leaderboard_updated';

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
                    const result = handler(data);
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
            const wildcardHandlers = this.messageHandlers.get('*') || [];
            for (const handler of wildcardHandlers) {
                try {
                    const result = handler(data);
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

export default webSocketHook;
