/**
 * Dungeon Tracker Chat Annotations
 * Adds colored timer annotations to "Key counts" party chat messages
 */

import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dungeonTracker from './dungeon-tracker.js';
import config from '../../core/config.js';

class DungeonTrackerChatAnnotations {
    constructor() {
        this.enabled = true;
        this.observer = null;
        this.annotatedMessages = new Set(); // Track which messages we've already annotated
    }

    /**
     * Initialize chat annotation monitor
     */
    initialize() {
        // Wait for chat to be available
        this.waitForChat();
    }

    /**
     * Wait for chat container to be available
     */
    waitForChat() {
        const chatContainer = document.querySelector('[class^="Chat_chatMessagesContainer"]');
        if (chatContainer) {
            this.startMonitoring(chatContainer);
        } else {
            // Retry in 1 second
            setTimeout(() => this.waitForChat(), 1000);
        }
    }

    /**
     * Start monitoring chat for new messages
     * @param {HTMLElement} chatContainer - Chat messages container
     */
    startMonitoring(chatContainer) {
        // Stop existing observer if any
        if (this.observer) {
            this.observer.disconnect();
        }

        // Create mutation observer to watch for new messages
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) {
                        this.processNewMessage(node);
                    }
                }
            }
        });

        // Start observing
        this.observer.observe(chatContainer, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Process a newly added chat message
     * @param {HTMLElement} node - New message node
     */
    async processNewMessage(node) {
        // Check if enabled (both local flag and config setting)
        if (!this.enabled || !config.isFeatureEnabled('dungeonTrackerChatAnnotations')) {
            return;
        }

        // Find message element
        const messageElement = node.matches?.('[class^="ChatMessage_chatMessage"]')
            ? node
            : node.querySelector?.('[class^="ChatMessage_chatMessage"]');

        if (!messageElement) {
            return;
        }

        // Check if already annotated
        if (this.annotatedMessages.has(messageElement)) {
            return;
        }

        // Get message text
        const messageText = messageElement.textContent || '';

        // Check if this is a "Key counts" message
        if (!messageText.includes('Key counts:')) {
            return;
        }

        // Parse timestamp from message (format: [MM/DD HH:MM:SS])
        const timestampMatch = messageText.match(/\[(\d{1,2}\/\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\]/);
        if (!timestampMatch) {
            return;
        }

        // Check if dungeon tracker is currently tracking
        const currentRun = dungeonTracker.getCurrentRun();
        if (!currentRun) {
            return;
        }

        // Get the server-validated duration from party messages
        const duration = dungeonTracker.getPartyMessageDuration();
        if (!duration) {
            // This is the first "Key counts" message - no duration yet
            return;
        }

        // This is the completion message - annotate it
        await this.annotateMessage(messageElement, currentRun, duration);

        // Mark as annotated
        this.annotatedMessages.add(messageElement);
    }

    /**
     * Annotate a message with colored timer
     * @param {HTMLElement} messageElement - Message DOM element
     * @param {Object} currentRun - Current run data
     * @param {number} duration - Run duration in milliseconds
     */
    async annotateMessage(messageElement, currentRun, duration) {
        // Get statistics for color determination
        const stats = await dungeonTrackerStorage.getStats(currentRun.dungeonHrid, currentRun.tier);

        // Determine color based on performance (Option B from user preference)
        let color = config.COLOR_DEFAULT || '#fff'; // Default white

        if (stats.fastestTime > 0 && stats.slowestTime > 0) {
            const fastestThreshold = stats.fastestTime * 1.10; // Within 10% of fastest
            const slowestThreshold = stats.slowestTime * 0.90; // Within 10% of slowest

            if (duration <= fastestThreshold) {
                // Green: within 10% of fastest
                color = config.COLOR_PROFIT || '#5fda5f';
            } else if (duration >= slowestThreshold) {
                // Red: within 10% of slowest
                color = config.COLOR_LOSS || '#ff6b6b';
            }
        }

        // Format duration
        const formattedDuration = this.formatTime(duration);

        // Find the message text span (usually second span in the message)
        const spans = messageElement.querySelectorAll('span');
        if (spans.length < 2) {
            return;
        }

        const messageSpan = spans[1];

        // Create timer annotation span
        const timerSpan = document.createElement('span');
        timerSpan.textContent = ` [${formattedDuration}]`;
        timerSpan.style.color = color;
        timerSpan.style.fontWeight = 'bold';
        timerSpan.style.marginLeft = '4px';
        timerSpan.classList.add('dungeon-timer-annotation');

        // Append to message
        messageSpan.appendChild(timerSpan);
    }

    /**
     * Format time in milliseconds to Mm Ss format
     * @param {number} ms - Time in milliseconds
     * @returns {string} Formatted time (e.g., "4m 32s")
     */
    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Enable chat annotations
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable chat annotations
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Check if chat annotations are enabled
     * @returns {boolean} Enabled status
     */
    isEnabled() {
        return this.enabled;
    }
}

// Create and export singleton instance
const dungeonTrackerChatAnnotations = new DungeonTrackerChatAnnotations();

export default dungeonTrackerChatAnnotations;
export { DungeonTrackerChatAnnotations };
