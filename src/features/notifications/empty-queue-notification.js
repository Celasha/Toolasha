/**
 * Empty Queue Notification
 * Sends browser notification when action queue becomes empty
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';

class EmptyQueueNotification {
    constructor() {
        this.wasEmpty = false;
        this.unregisterHandlers = [];
        this.permissionGranted = false;
    }

    /**
     * Initialize empty queue notification
     */
    async initialize() {
        if (!config.getSetting('notifiEmptyAction')) {
            return;
        }

        // Request notification permission
        await this.requestPermission();

        // Listen for action updates
        this.registerWebSocketListeners();

        // Listen for character switching to clean up
        dataManager.on('character_switching', () => {
            this.disable();
        });
    }

    /**
     * Request browser notification permission
     */
    async requestPermission() {
        if (!('Notification' in window)) {
            console.warn('[Empty Queue Notification] Browser notifications not supported');
            return;
        }

        if (Notification.permission === 'granted') {
            this.permissionGranted = true;
            return;
        }

        if (Notification.permission !== 'denied') {
            try {
                const permission = await Notification.requestPermission();
                this.permissionGranted = (permission === 'granted');
            } catch (error) {
                console.warn('[Empty Queue Notification] Permission request failed:', error);
            }
        }
    }

    /**
     * Register WebSocket message listeners
     */
    registerWebSocketListeners() {
        const actionsHandler = (data) => {
            this.checkActionQueue(data);
        };

        webSocketHook.on('actions_updated', actionsHandler);

        this.unregisterHandlers.push(() => {
            webSocketHook.off('actions_updated', actionsHandler);
        });
    }

    /**
     * Check if action queue is empty and send notification
     * @param {Object} data - WebSocket data
     */
    checkActionQueue(data) {
        if (!config.getSetting('notifiEmptyAction')) {
            return;
        }

        if (!this.permissionGranted) {
            return;
        }

        // Check if queue is empty
        // endCharacterActions contains actions, filter for those not done (isDone === false)
        const actions = data.endCharacterActions || [];
        const activeActions = actions.filter(action => action.isDone === false);
        const isEmpty = activeActions.length === 0;

        // Only notify on transition from not-empty to empty
        if (isEmpty && !this.wasEmpty) {
            this.sendNotification();
        }

        this.wasEmpty = isEmpty;
    }

    /**
     * Send browser notification
     */
    sendNotification() {
        try {
            if (typeof Notification === 'undefined') {
                console.error('[Empty Queue Notification] Notification API not available');
                return;
            }

            if (Notification.permission !== 'granted') {
                console.error('[Empty Queue Notification] Notification permission not granted');
                return;
            }

            // Use standard Notification API
            const notification = new Notification('Milky Way Idle', {
                body: 'Your action queue is empty!',
                icon: 'https://www.milkywayidle.com/favicon.ico',
                tag: 'empty-queue',
                requireInteraction: false
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            notification.onerror = (error) => {
                console.error('[Empty Queue Notification] Notification error:', error);
            };

            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        } catch (error) {
            console.error('[Empty Queue Notification] Failed to send notification:', error);
        }
    }

    /**
     * Cleanup
     */
    disable() {
        console.log('[Toolasha Empty Queue Notification] Cleaning up for character switch');

        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];
        this.wasEmpty = false;
    }
}

// Create and export singleton instance
const emptyQueueNotification = new EmptyQueueNotification();

export default emptyQueueNotification;
