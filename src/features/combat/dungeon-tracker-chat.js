/**
 * Dungeon Tracker Chat Annotations
 * Adds colored timing annotations to party chat messages
 */

import dungeonTracker from './dungeon-tracker.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';

class DungeonTrackerChat {
    constructor() {
        this.partyMessages = []; // Store last 100 party messages
        this.observer = null;
        this.annotationEnabled = true;
    }

    /**
     * Initialize chat annotations
     */
    initialize() {
        console.log('[Dungeon Tracker Chat] Initializing chat annotations...');

        // Start observing for new chat messages
        this.startChatObserver();

        // Initial annotation of existing messages
        setTimeout(() => this.annotateAllMessages(), 1500);
    }

    /**
     * Start MutationObserver to watch for new chat messages
     */
    startChatObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    const msg = node.matches?.('[class^="ChatMessage_chatMessage"]')
                        ? node
                        : node.querySelector?.('[class^="ChatMessage_chatMessage"]');

                    if (!msg) continue;

                    // Annotate the new message
                    setTimeout(() => this.annotateAllMessages(), 100);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        this.observer = observer;
    }

    /**
     * Check if party chat is currently selected
     * @returns {boolean} True if party chat is visible
     */
    isPartySelected() {
        const selectedTabEl = document.querySelector(`.Chat_tabsComponentContainer__3ZoKe .MuiButtonBase-root[aria-selected="true"]`);
        const tabsEl = document.querySelector('.Chat_tabsComponentContainer__3ZoKe .TabsComponent_tabPanelsContainer__26mzo');
        return selectedTabEl && tabsEl && selectedTabEl.textContent.includes('Party') && !tabsEl.classList.contains('TabsComponent_hidden__255ag');
    }

    /**
     * Extract chat events from DOM
     * @returns {Array} Array of chat events with timestamps and types
     */
    extractChatEvents() {
        if (!this.isPartySelected()) {
            return [];
        }

        const partyTabI = Array.from(document.querySelectorAll(`.Chat_tabsComponentContainer__3ZoKe .MuiButtonBase-root`))
            .findIndex((el) => el.textContent.includes('Party'));

        if (partyTabI === -1) {
            return [];
        }

        const nodes = [...document.querySelectorAll(`.TabPanel_tabPanel__tXMJF:nth-child(${partyTabI + 1}) .ChatHistory_chatHistory__1EiG3 > [class^="ChatMessage_chatMessage"]`)];
        const events = [];

        for (const node of nodes) {
            // Skip if already processed
            if (node.dataset.dtProcessed === '1') continue;

            const text = node.textContent.trim();
            const timestamp = this.getTimestampFromMessage(node);
            if (!timestamp) continue;

            // Key counts message
            if (text.includes('Key counts:')) {
                const team = this.getTeamFromMessage(node);
                if (!team.length) continue;

                events.push({
                    type: 'key',
                    timestamp,
                    team,
                    msg: node
                });
            }
            // Party failed message
            else if (text.match(/Party failed on wave \d+/)) {
                events.push({
                    type: 'fail',
                    timestamp,
                    msg: node
                });
                node.dataset.dtProcessed = '1';
            }
            // Battle ended (canceled/fled)
            else if (text.includes('Battle ended:')) {
                events.push({
                    type: 'cancel',
                    timestamp,
                    msg: node
                });
                node.dataset.dtProcessed = '1';
            }
            // Battle started
            else if (text.includes('Battle started:')) {
                events.push({
                    type: 'start',
                    timestamp,
                    msg: node
                });
                node.dataset.dtProcessed = '1';
            }
        }

        return events;
    }

    /**
     * Annotate all chat messages with timing
     */
    annotateAllMessages() {
        if (!this.annotationEnabled || !this.isPartySelected()) {
            return;
        }

        const events = this.extractChatEvents();
        const runDurations = [];

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type !== 'key') continue;

            const next = events[i + 1];
            let label = null;
            let diff = null;
            let color = null;

            if (next?.type === 'key') {
                // Calculate duration
                diff = next.timestamp - e.timestamp;
                if (diff < 0) {
                    diff += 24 * 60 * 60 * 1000; // Handle midnight rollover
                }

                label = this.formatDuration(diff);
                color = '#90ee90'; // Light green

                // Track run durations for average calculation
                runDurations.push({
                    msg: e.msg,
                    diff
                });
            } else if (next?.type === 'fail') {
                label = 'FAILED';
                color = '#ff4c4c'; // Red
            } else if (next?.type === 'cancel') {
                label = 'canceled';
                color = '#ffd700'; // Gold
            }

            if (label) {
                e.msg.dataset.dtProcessed = '1';
                this.insertDungeonTimer(label, color, e.msg);

                // Add average if we have multiple runs
                if (diff && runDurations.length > 1) {
                    const avg = runDurations.reduce((sum, r) => sum + r.diff, 0) / runDurations.length;
                    const avgLabel = `Average: ${this.formatDuration(avg)}`;
                    this.insertDungeonTimer(avgLabel, '#deb887', e.msg, true); // Tan color
                }
            }
        }
    }

    /**
     * Insert dungeon timer annotation into chat message
     * @param {string} label - Timer label text
     * @param {string} color - CSS color for the label
     * @param {HTMLElement} msg - Message DOM element
     * @param {boolean} isAverage - Whether this is an average annotation
     */
    insertDungeonTimer(label, color, msg, isAverage = false) {
        // Check if already annotated
        const existingClass = isAverage ? 'dungeon-timer-avg' : 'dungeon-timer';
        if (msg.querySelector(`.${existingClass}`)) {
            return;
        }

        const spans = msg.querySelectorAll('span');
        if (spans.length < 2) return;

        const messageSpan = spans[1];
        const timerSpan = document.createElement('span');
        timerSpan.textContent = ` [${label}]`;
        timerSpan.classList.add(existingClass);
        timerSpan.style.color = color;
        timerSpan.style.fontSize = '90%';
        timerSpan.style.fontStyle = 'italic';
        timerSpan.style.marginLeft = '4px';

        messageSpan.appendChild(timerSpan);
    }

    /**
     * Get timestamp from message DOM element
     * @param {HTMLElement} msg - Message element
     * @returns {Date|null} Parsed timestamp or null
     */
    getTimestampFromMessage(msg) {
        const text = msg.textContent.trim();
        const match = text.match(/\[(\d{1,2}\/\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/);
        if (!match) return null;

        let [, date, hour, min, sec, period] = match;
        const [month, day] = date.split('/').map(x => parseInt(x, 10));

        hour = parseInt(hour, 10);
        min = parseInt(min, 10);
        sec = parseInt(sec, 10);

        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;

        const now = new Date();
        const dateObj = new Date(now.getFullYear(), month - 1, day, hour, min, sec, 0);
        return dateObj;
    }

    /**
     * Get team composition from message
     * @param {HTMLElement} msg - Message element
     * @returns {Array<string>} Sorted array of player names
     */
    getTeamFromMessage(msg) {
        const text = msg.textContent.trim();
        const matches = [...text.matchAll(/\[([^\[\]-]+?)\s*-\s*[\d,]+\]/g)];
        return matches.map(m => m[1].trim()).sort();
    }

    /**
     * Format duration in milliseconds to "Xm Ys"
     * @param {number} ms - Duration in milliseconds
     * @returns {string} Formatted duration
     */
    formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Enable or disable chat annotations
     * @param {boolean} enabled - Whether annotations should be enabled
     */
    setAnnotationEnabled(enabled) {
        this.annotationEnabled = enabled;
        if (!enabled) {
            // Remove existing annotations
            document.querySelectorAll('.dungeon-timer, .dungeon-timer-avg').forEach(el => el.remove());
        } else {
            // Re-annotate all messages
            this.annotateAllMessages();
        }
    }
}

// Create and export singleton instance
const dungeonTrackerChat = new DungeonTrackerChat();

export default dungeonTrackerChat;
export { DungeonTrackerChat };
