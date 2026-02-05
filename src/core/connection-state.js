import webSocketHook from './websocket.js';

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

export default connectionState;
