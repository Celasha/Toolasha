/**
 * Empty Queue Notification
 * Sends browser notification when action queue becomes empty
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class EmptyQueueNotification {
    constructor() {
        this.wasEmpty = false;
        this.unregisterHandlers = [];
        this.permissionGranted = false;
        this.characterSwitchingHandler = null;
        this.timerRegistry = createTimerRegistry();
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

        this.characterSwitchingHandler = () => {
            this.disable();
        };

        dataManager.on('character_switching', this.characterSwitchingHandler);
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
                this.permissionGranted = permission === 'granted';
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
     * @param {Object} _data - WebSocket data (unused, but kept for handler signature)
     */
    checkActionQueue(_data) {
        if (!config.getSetting('notifiEmptyAction')) {
            return;
        }

        if (!this.permissionGranted) {
            return;
        }

        // Get current actions from dataManager (source of truth for all queued actions)
        const allActions = dataManager.getCurrentActions();
        const isEmpty = allActions.length === 0;

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
                requireInteraction: false,
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            notification.onerror = (error) => {
                console.error('[Empty Queue Notification] Notification error:', error);
            };

            // Auto-close after 5 seconds
            const closeTimeout = setTimeout(() => notification.close(), 5000);
            this.timerRegistry.registerTimeout(closeTimeout);
        } catch (error) {
            console.error('[Empty Queue Notification] Failed to send notification:', error);
        }
    }

    /**
     * Cleanup
     */
    disable() {
        if (this.characterSwitchingHandler) {
            dataManager.off('character_switching', this.characterSwitchingHandler);
            this.characterSwitchingHandler = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.wasEmpty = false;
        this.timerRegistry.clearAll();
    }
}

const emptyQueueNotification = new EmptyQueueNotification();

export default emptyQueueNotification;
