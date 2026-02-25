/**
 * Mention Tracker
 * Tracks @mentions across all chat channels and displays badge counts on chat tabs
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import domObserver from '../../core/dom-observer.js';
import mentionPopup from './mention-popup.js';

class MentionTracker {
    constructor() {
        this.initialized = false;
        this.mentionLog = new Map(); // channel -> Array<{ sName, m, t }>
        this.characterName = null;
        this.handlers = {};
        this.unregisterObserver = null;
    }

    /**
     * Initialize the mention tracker
     */
    async initialize() {
        if (this.initialized) return;

        if (!config.getSetting('chat_mentionTracker')) {
            return;
        }

        this.initialized = true;

        // Get character name
        this.characterName = dataManager.getCurrentCharacterName();
        if (!this.characterName) {
            return;
        }

        // Listen for chat messages
        this.handlers.chatMessage = (data) => this.onChatMessage(data);
        webSocketHook.on('chat_message_received', this.handlers.chatMessage);

        // Observe chat tabs to inject badges and add click handlers
        this.unregisterObserver = domObserver.onClass(
            'MentionTracker',
            'Chat_tabsComponentContainer',
            (tabsContainer) => {
                this.setupTabBadges(tabsContainer);
            }
        );

        // Check for existing tabs
        const existingTabs = document.querySelector('.Chat_tabsComponentContainer__3ZoKe');
        if (existingTabs) {
            this.setupTabBadges(existingTabs);
        }
    }

    /**
     * Handle incoming chat message
     * @param {Object} data - WebSocket message data
     */
    onChatMessage(data) {
        const message = data.message;
        if (!message) return;

        // Skip system messages
        if (message.isSystemMessage || !message.sName) return;

        const text = message.m || '';
        const channel = message.chan || '';

        if (this.isMentioned(text)) {
            const log = this.mentionLog.get(channel) || [];
            log.push({ sName: message.sName, m: text, t: message.t });
            this.mentionLog.set(channel, log);
            this.updateBadge(channel);
        }
    }

    /**
     * Check if the message mentions the current player
     * @param {string} text - Message text
     * @returns {boolean} True if mentioned
     */
    isMentioned(text) {
        if (!text || !this.characterName) return false;

        // Check for @CharacterName (case insensitive)
        const escapedName = this.escapeRegex(this.characterName);
        const mentionPattern = new RegExp(`@${escapedName}\\b`, 'i');
        return mentionPattern.test(text);
    }

    /**
     * Escape special regex characters
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get display name for a channel
     * @param {string} channel - Channel HRID
     * @returns {string} Display name
     */
    getChannelDisplayName(channel) {
        const channelMap = {
            '/chat_channel_types/party': 'Party',
            '/chat_channel_types/guild': 'Guild',
            '/chat_channel_types/local': 'Local',
            '/chat_channel_types/whisper': 'Whisper',
            '/chat_channel_types/global': 'Global',
        };
        return channelMap[channel] || channel;
    }

    /**
     * Setup badges and click handlers on chat tabs
     * @param {HTMLElement} tabsContainer - The tabs container element
     */
    setupTabBadges(tabsContainer) {
        const tabButtons = tabsContainer.querySelectorAll('.MuiButtonBase-root');

        for (const button of tabButtons) {
            const tabName = button.textContent?.trim();
            if (!tabName) continue;

            // Find matching channel for this tab
            const channel = this.getChannelFromTabName(tabName);
            if (!channel) continue;

            // Store reference to button for this channel
            button.dataset.mentionChannel = channel;

            // Ensure button has relative positioning for badge
            if (getComputedStyle(button).position === 'static') {
                button.style.position = 'relative';
            }

            // Clicking the tab itself clears the mention badge for that channel
            if (!button.dataset.mentionClickBound) {
                button.dataset.mentionClickBound = '1';
                button.addEventListener('click', () => {
                    this.clearMentions(channel);
                });
            }

            // Update badge for this channel
            this.updateBadgeForButton(button, channel);
        }
    }

    /**
     * Get channel HRID from tab display name
     * @param {string} tabName - Tab display name (may have number suffix like "General2")
     * @returns {string|null} Channel HRID
     */
    getChannelFromTabName(tabName) {
        // Strip trailing numbers (unread counts) from tab name
        const cleanName = tabName.replace(/\d+$/, '');

        const nameMap = {
            Party: '/chat_channel_types/party',
            Guild: '/chat_channel_types/guild',
            Local: '/chat_channel_types/local',
            Whisper: '/chat_channel_types/whisper',
            Global: '/chat_channel_types/global',
            General: '/chat_channel_types/general',
            Trade: '/chat_channel_types/trade',
            Beginner: '/chat_channel_types/beginner',
            Recruit: '/chat_channel_types/recruit',
            Ironcow: '/chat_channel_types/ironcow',
            Mod: '/chat_channel_types/mod',
        };
        return nameMap[cleanName] || null;
    }

    /**
     * Update badge display for a channel
     * @param {string} channel - Channel HRID
     */
    updateBadge(channel) {
        const selector = `.Chat_tabsComponentContainer__3ZoKe .MuiButtonBase-root[data-mention-channel="${channel}"]`;
        const button = document.querySelector(selector);

        if (button) {
            this.updateBadgeForButton(button, channel);
        }
    }

    /**
     * Update badge on a specific button
     * @param {HTMLElement} button - Tab button element
     * @param {string} channel - Channel HRID
     */
    updateBadgeForButton(button, channel) {
        const count = (this.mentionLog.get(channel) || []).length;

        // Find the MuiBadge-root wrapper inside the button (where game puts its badge)
        const badgeRoot = button.querySelector('.MuiBadge-root');
        const container = badgeRoot || button;

        // Find or create badge
        let badge = container.querySelector('.mwi-mention-badge');

        if (count === 0) {
            if (badge) {
                badge.remove();
            }
            return;
        }

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'mwi-mention-badge';
            badge.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                transform: translate(-6px, -6px);
                min-width: 12px;
                height: 12px;
                padding: 0 3px;
                border-radius: 6px;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 9px;
                font-weight: 500;
                line-height: 12px;
                text-align: center;
                box-sizing: border-box;
                z-index: 1;
                background-color: #d32f2f;
                color: #e7e7e7;
                cursor: pointer;
            `;
            badge.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent tab switch
                const mentions = this.mentionLog.get(channel) || [];
                const displayName = this.getChannelDisplayName(channel);
                mentionPopup.open(channel, mentions, displayName, () => this.clearMentions(channel));
            });
            container.appendChild(badge);
        }

        // Update count display
        badge.textContent = count > 99 ? '99+' : count.toString();
    }

    /**
     * Clear mention count for a channel
     * @param {string} channel - Channel HRID
     */
    clearMentions(channel) {
        if (this.mentionLog.has(channel)) {
            this.mentionLog.set(channel, []);
            this.updateBadge(channel);
        }
    }

    /**
     * Cleanup the mention tracker
     */
    disable() {
        if (this.handlers.chatMessage) {
            webSocketHook.off('chat_message_received', this.handlers.chatMessage);
            this.handlers.chatMessage = null;
        }

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Close popup if open
        mentionPopup.close();

        // Remove all badges
        document.querySelectorAll('.mwi-mention-badge').forEach((el) => el.remove());

        // Clear log
        this.mentionLog.clear();

        this.initialized = false;
    }
}

const mentionTracker = new MentionTracker();

export default mentionTracker;
