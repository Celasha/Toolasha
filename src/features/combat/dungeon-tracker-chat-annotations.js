/**
 * Dungeon Tracker Chat Annotations
 * Adds colored timer annotations to party chat messages
 * Handles both real-time (new messages) and batch (historical messages) processing
 */

import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dungeonTracker from './dungeon-tracker.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

class DungeonTrackerChatAnnotations {
    constructor() {
        this.enabled = true;
        this.observer = null;
        this.lastSeenDungeonName = null; // Cache last known dungeon name
        this.cumulativeStatsByDungeon = {}; // Persistent cumulative counters for rolling averages
        this.processedMessages = new Map(); // Track processed messages to prevent duplicate counting
        this.initComplete = false; // Flag to ensure storage loads before annotation
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize chat annotation monitor
     */
    async initialize() {
        // Load run counts from storage to sync with UI
        await this.loadRunCountsFromStorage();

        // Wait for chat to be available
        this.waitForChat();

        dataManager.on('character_switching', () => {
            this.cleanup();
        });
    }

    /**
     * Load run counts from storage to keep chat and UI in sync
     */
    async loadRunCountsFromStorage() {
        try {
            // Get all runs from unified storage
            const allRuns = await dungeonTrackerStorage.getAllRuns();

            // Extract unique dungeon names
            const uniqueDungeonNames = [...new Set(allRuns.map((run) => run.dungeonName))];

            // Load stats for each dungeon
            for (const dungeonName of uniqueDungeonNames) {
                const stats = await dungeonTrackerStorage.getStatsByName(dungeonName);
                if (stats && stats.totalRuns > 0) {
                    this.cumulativeStatsByDungeon[dungeonName] = {
                        runCount: stats.totalRuns,
                        totalTime: stats.avgTime * stats.totalRuns, // Reconstruct total time
                    };
                }
            }

            this.initComplete = true;
        } catch (error) {
            console.error('[Dungeon Tracker] Failed to load run counts from storage:', error);
            this.initComplete = true; // Continue anyway
        }
    }

    /**
     * Refresh run counts after backfill operation
     */
    async refreshRunCounts() {
        this.cumulativeStatsByDungeon = {};
        this.processedMessages.clear();
        await this.loadRunCountsFromStorage();
        await this.annotateAllMessages();
    }

    /**
     * Wait for chat to be ready
     */
    waitForChat() {
        // Start monitoring immediately (doesn't need specific container)
        this.startMonitoring();

        // Initial annotation of existing messages (batch mode)
        const initialAnnotateTimeout = setTimeout(() => this.annotateAllMessages(), 1500);
        this.timerRegistry.registerTimeout(initialAnnotateTimeout);

        // Also trigger when switching to party chat
        this.observeTabSwitches();
    }

    /**
     * Observe chat tab switches to trigger batch annotation when user views party chat
     */
    observeTabSwitches() {
        // Find all chat tab buttons
        const tabButtons = document.querySelectorAll('.Chat_tabsComponentContainer__3ZoKe .MuiButtonBase-root');

        for (const button of tabButtons) {
            if (button.textContent.includes('Party')) {
                button.addEventListener('click', () => {
                    // Delay to let DOM update
                    const annotateTimeout = setTimeout(() => this.annotateAllMessages(), 300);
                    this.timerRegistry.registerTimeout(annotateTimeout);
                });
            }
        }
    }

    /**
     * Start monitoring chat for new messages
     */
    startMonitoring() {
        // Stop existing observer if any
        if (this.observer) {
            this.observer();
        }

        // Create mutation observer to watch for new messages
        this.observer = createMutationWatcher(
            document.body,
            (mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;

                        const msg = node.matches?.('[class^="ChatMessage_chatMessage"]')
                            ? node
                            : node.querySelector?.('[class^="ChatMessage_chatMessage"]');

                        if (!msg) continue;

                        // Re-run batch annotation on any new message (matches working DRT script)
                        const annotateTimeout = setTimeout(() => this.annotateAllMessages(), 100);
                        this.timerRegistry.registerTimeout(annotateTimeout);
                    }
                }
            },
            {
                childList: true,
                subtree: true,
            }
        );
    }

    /**
     * Batch process all chat messages (for historical messages)
     * Called on page load and when needed
     */
    async annotateAllMessages() {
        if (!this.enabled || !config.isFeatureEnabled('dungeonTracker')) {
            return;
        }

        // Wait for initialization to complete to ensure run counts are loaded
        if (!this.initComplete) {
            await new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.initComplete) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 50);

                this.timerRegistry.registerInterval(checkInterval);

                // Timeout after 5 seconds
                const initTimeout = setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                }, 5000);
                this.timerRegistry.registerTimeout(initTimeout);
            });
        }

        const events = this.extractChatEvents();

        // NOTE: Run saving is done manually via the Backfill button
        // Chat annotations only add visual time labels to messages

        // Calculate in-memory stats from visible chat messages (for color thresholds only)
        const inMemoryStats = this.calculateStatsFromEvents(events);

        // Continue with visual annotations
        const runDurations = [];

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type !== 'key') continue;

            const next = events[i + 1];
            let label = null;
            let diff = null;
            let color = null;

            // Get dungeon name with hybrid fallback (handles chat scrolling)
            const dungeonName = this.getDungeonNameWithFallback(events, i);

            if (next?.type === 'key') {
                // Calculate duration between consecutive key counts
                diff = next.timestamp - e.timestamp;
                if (diff < 0) {
                    diff += 24 * 60 * 60 * 1000; // Handle midnight rollover
                }

                label = this.formatTime(diff);

                // Determine color based on performance using dungeonName
                // Check storage first, fall back to in-memory stats
                if (dungeonName && dungeonName !== 'Unknown') {
                    const storageStats = await dungeonTrackerStorage.getStatsByName(dungeonName);
                    const stats = storageStats.totalRuns > 0 ? storageStats : inMemoryStats[dungeonName];

                    if (stats && stats.fastestTime > 0 && stats.slowestTime > 0) {
                        const fastestThreshold = stats.fastestTime * 1.1;
                        const slowestThreshold = stats.slowestTime * 0.9;

                        if (diff <= fastestThreshold) {
                            color = config.COLOR_PROFIT || '#5fda5f'; // Green
                        } else if (diff >= slowestThreshold) {
                            color = config.COLOR_LOSS || '#ff6b6b'; // Red
                        } else {
                            color = '#90ee90'; // Light green (normal)
                        }
                    } else {
                        color = '#90ee90'; // Light green (default)
                    }
                } else {
                    color = '#90ee90'; // Light green (fallback)
                }

                // Track run durations for average calculation
                runDurations.push({
                    msg: e.msg,
                    diff,
                    dungeonName,
                });
            } else if (next?.type === 'fail') {
                label = 'FAILED';
                color = '#ff4c4c'; // Red
            } else if (next?.type === 'cancel') {
                label = 'canceled';
                color = '#ffd700'; // Gold
            }

            if (label) {
                // Check if this is a successful run before inserting annotation
                const nextNext = events[i + 2];
                const nextRunWasCanceled = nextNext && (nextNext.type === 'fail' || nextNext.type === 'cancel');
                const isSuccessfulRun = diff && dungeonName && dungeonName !== 'Unknown' && !nextRunWasCanceled;

                if (isSuccessfulRun) {
                    // Create unique message ID to prevent duplicate counting on scroll
                    const messageId = `${e.timestamp.getTime()}_${dungeonName}`;

                    // Initialize dungeon tracking if needed
                    if (!this.cumulativeStatsByDungeon[dungeonName]) {
                        this.cumulativeStatsByDungeon[dungeonName] = {
                            runCount: 0,
                            totalTime: 0,
                        };
                    }

                    const dungeonStats = this.cumulativeStatsByDungeon[dungeonName];

                    // Check if this message was already counted
                    if (this.processedMessages.has(messageId)) {
                        // Already counted, use stored run number
                        const storedRunNumber = this.processedMessages.get(messageId);
                        label = `Run #${storedRunNumber}: ${label}`;
                    } else {
                        // New message, increment counter and store
                        dungeonStats.runCount++;
                        dungeonStats.totalTime += diff;
                        this.processedMessages.set(messageId, dungeonStats.runCount);
                        label = `Run #${dungeonStats.runCount}: ${label}`;
                    }
                }

                // Mark as processed BEFORE inserting (matches working DRT script)
                e.msg.dataset.processed = '1';

                this.insertAnnotation(label, color, e.msg, false);

                // Add cumulative average if this is a successful run
                if (isSuccessfulRun) {
                    const dungeonStats = this.cumulativeStatsByDungeon[dungeonName];

                    // Calculate cumulative average (average of all runs up to this point)
                    const cumulativeAvg = Math.floor(dungeonStats.totalTime / dungeonStats.runCount);

                    // Show cumulative average
                    const avgLabel = `Average: ${this.formatTime(cumulativeAvg)}`;
                    this.insertAnnotation(avgLabel, '#deb887', e.msg, true); // Tan color
                }
            }
        }
    }

    /**
     * Save runs from chat events to storage (Phase 5: authoritative source)
     * @param {Array} events - Chat events array
     */
    async saveRunsFromEvents(events) {
        // Build runs from events (only key→key pairs)
        const dungeonCounts = {};

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type !== 'key') continue;

            const next = events[i + 1];
            if (!next || next.type !== 'key') continue; // Only key→key pairs

            // Calculate duration
            let duration = next.timestamp - event.timestamp;
            if (duration < 0) duration += 24 * 60 * 60 * 1000; // Midnight rollover

            // Get dungeon name with hybrid fallback (handles chat scrolling)
            const dungeonName = this.getDungeonNameWithFallback(events, i);

            // Get team key
            const teamKey = dungeonTrackerStorage.getTeamKey(event.team);

            // Create run object
            const run = {
                timestamp: event.timestamp.toISOString(),
                duration: duration,
                dungeonName: dungeonName,
            };

            // Save team run (includes dungeon name from Phase 2)
            await dungeonTrackerStorage.saveTeamRun(teamKey, run);

            dungeonCounts[dungeonName] = (dungeonCounts[dungeonName] || 0) + 1;
        }
    }

    /**
     * Calculate stats from visible chat events (in-memory, no storage)
     * Used to show averages before backfill is done
     * @param {Array} events - Chat events array
     * @returns {Object} Stats by dungeon name { dungeonName: { totalRuns, avgTime, fastestTime, slowestTime } }
     */
    calculateStatsFromEvents(events) {
        const statsByDungeon = {};

        // Loop through events and collect all completed runs
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type !== 'key') continue;

            const next = events[i + 1];
            if (!next || next.type !== 'key') continue; // Only key→key pairs (successful runs)

            // Calculate duration
            let duration = next.timestamp - event.timestamp;
            if (duration < 0) duration += 24 * 60 * 60 * 1000; // Midnight rollover

            // Get dungeon name
            const dungeonName = this.getDungeonNameWithFallback(events, i);
            if (!dungeonName || dungeonName === 'Unknown') continue;

            // Initialize dungeon stats if needed
            if (!statsByDungeon[dungeonName]) {
                statsByDungeon[dungeonName] = {
                    durations: [],
                };
            }

            // Add this run duration
            statsByDungeon[dungeonName].durations.push(duration);
        }

        // Calculate stats for each dungeon
        const result = {};
        for (const [dungeonName, data] of Object.entries(statsByDungeon)) {
            const durations = data.durations;
            if (durations.length === 0) continue;

            const total = durations.reduce((sum, d) => sum + d, 0);
            result[dungeonName] = {
                totalRuns: durations.length,
                avgTime: Math.floor(total / durations.length),
                fastestTime: Math.min(...durations),
                slowestTime: Math.max(...durations),
            };
        }

        return result;
    }

    /**
     * Extract chat events from DOM
     * @returns {Array} Array of chat events with timestamps and types
     */
    extractChatEvents() {
        // Query ALL chat messages (matches working DRT script - no tab filtering)
        const nodes = [...document.querySelectorAll('[class^="ChatMessage_chatMessage"]')];
        const events = [];

        for (const node of nodes) {
            if (node.dataset.processed === '1') continue;

            const text = node.textContent.trim();

            // Check message relevance FIRST before parsing timestamp
            // Battle started message
            if (text.includes('Battle started:')) {
                const timestamp = this.getTimestampFromMessage(node);
                if (!timestamp) {
                    console.warn('[Dungeon Tracker Debug] Battle started message has no timestamp:', text);
                    continue;
                }

                const dungeonName = text.split('Battle started:')[1]?.split(']')[0]?.trim();
                if (dungeonName) {
                    // Cache the dungeon name (survives chat scrolling)
                    this.lastSeenDungeonName = dungeonName;

                    events.push({
                        type: 'battle_start',
                        timestamp,
                        dungeonName,
                        msg: node,
                    });
                }
                node.dataset.processed = '1';
            }
            // Key counts message (warn if timestamp fails - these should always have timestamps)
            else if (text.includes('Key counts:')) {
                const timestamp = this.getTimestampFromMessage(node, true);
                if (!timestamp) continue;

                const team = this.getTeamFromMessage(node);
                if (!team.length) continue;

                events.push({
                    type: 'key',
                    timestamp,
                    team,
                    msg: node,
                });
            }
            // Party failed message
            else if (text.match(/Party failed on wave \d+/)) {
                const timestamp = this.getTimestampFromMessage(node);
                if (!timestamp) continue;

                events.push({
                    type: 'fail',
                    timestamp,
                    msg: node,
                });
                node.dataset.processed = '1';
            }
            // Battle ended (canceled/fled)
            else if (text.includes('Battle ended:')) {
                const timestamp = this.getTimestampFromMessage(node);
                if (!timestamp) continue;

                events.push({
                    type: 'cancel',
                    timestamp,
                    msg: node,
                });
                node.dataset.processed = '1';
            }
        }

        return events;
    }

    /**
     * Get dungeon name with hybrid fallback strategy
     * Handles chat scrolling by using multiple sources
     * @param {Array} events - All chat events
     * @param {number} currentIndex - Current event index
     * @returns {string} Dungeon name or 'Unknown'
     */
    getDungeonNameWithFallback(events, currentIndex) {
        // 1st priority: Visible "Battle started:" message in chat
        const battleStart = events
            .slice(0, currentIndex)
            .reverse()
            .find((ev) => ev.type === 'battle_start');
        if (battleStart?.dungeonName) {
            return battleStart.dungeonName;
        }

        // 2nd priority: Currently active dungeon run
        const currentRun = dungeonTracker.getCurrentRun();
        if (currentRun?.dungeonName && currentRun.dungeonName !== 'Unknown') {
            return currentRun.dungeonName;
        }

        // 3rd priority: Cached last seen dungeon name
        if (this.lastSeenDungeonName) {
            return this.lastSeenDungeonName;
        }

        // Final fallback
        console.warn('[Dungeon Tracker Debug] ALL PRIORITIES FAILED for index', currentIndex, '-> Unknown');
        return 'Unknown';
    }

    /**
     * Check if party chat is currently selected
     * @returns {boolean} True if party chat is visible
     */
    isPartySelected() {
        const selectedTabEl = document.querySelector(
            `.Chat_tabsComponentContainer__3ZoKe .MuiButtonBase-root[aria-selected="true"]`
        );
        const tabsEl = document.querySelector(
            '.Chat_tabsComponentContainer__3ZoKe .TabsComponent_tabPanelsContainer__26mzo'
        );
        return (
            selectedTabEl &&
            tabsEl &&
            selectedTabEl.textContent.includes('Party') &&
            !tabsEl.classList.contains('TabsComponent_hidden__255ag')
        );
    }

    /**
     * Get timestamp from message DOM element
     * Handles both American (M/D HH:MM:SS AM/PM) and international (DD-M HH:MM:SS) formats
     * @param {HTMLElement} msg - Message element
     * @param {boolean} warnOnFailure - Whether to log warning if parsing fails (default: false)
     * @returns {Date|null} Parsed timestamp or null
     */
    getTimestampFromMessage(msg, warnOnFailure = false) {
        const text = msg.textContent.trim();

        // Try American format: [M/D HH:MM:SS AM/PM] or [M/D HH:MM:SS] (24-hour)
        // Use \s* to handle potential spacing variations
        let match = text.match(/\[(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/);
        let isAmerican = true;

        if (!match) {
            // Try international format: [DD-M HH:MM:SS] (24-hour)
            // Use \s* to handle potential spacing variations in dungeon chat
            match = text.match(/\[(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})\]/);
            isAmerican = false;
        }

        if (!match) {
            // Only warn if explicitly requested (for important messages like "Key counts:")
            if (warnOnFailure) {
                console.warn(
                    '[Dungeon Tracker] Found key counts but could not parse timestamp from:',
                    text.match(/\[.*?\]/)?.[0]
                );
            }
            return null;
        }

        let month, day, hour, min, sec, period;

        if (isAmerican) {
            // American format: M/D
            [, month, day, hour, min, sec, period] = match;
            month = parseInt(month, 10);
            day = parseInt(day, 10);
        } else {
            // International format: D-M
            [, day, month, hour, min, sec] = match;
            month = parseInt(month, 10);
            day = parseInt(day, 10);
        }

        hour = parseInt(hour, 10);
        min = parseInt(min, 10);
        sec = parseInt(sec, 10);

        // Handle AM/PM conversion (only for American format with AM/PM)
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
        const matches = [...text.matchAll(/\[([^[\]-]+?)\s*-\s*[\d,]+\]/g)];
        return matches.map((m) => m[1].trim()).sort();
    }

    /**
     * Insert annotation into chat message
     * @param {string} label - Timer label text
     * @param {string} color - CSS color for the label
     * @param {HTMLElement} msg - Message DOM element
     * @param {boolean} isAverage - Whether this is an average annotation
     */
    insertAnnotation(label, color, msg, isAverage = false) {
        // Check using dataset attribute (matches working DRT script pattern)
        const datasetKey = isAverage ? 'avgAppended' : 'timerAppended';
        if (msg.dataset[datasetKey] === '1') {
            return;
        }

        const spans = msg.querySelectorAll('span');
        if (spans.length < 2) return;

        const messageSpan = spans[1];
        const timerSpan = document.createElement('span');
        timerSpan.textContent = ` [${label}]`;
        timerSpan.classList.add(isAverage ? 'dungeon-timer-average' : 'dungeon-timer-annotation');
        timerSpan.style.color = color;
        timerSpan.style.fontWeight = isAverage ? 'normal' : 'bold';
        timerSpan.style.fontStyle = 'italic';
        timerSpan.style.marginLeft = '4px';

        messageSpan.appendChild(timerSpan);

        // Mark as appended (matches working DRT script)
        msg.dataset[datasetKey] = '1';
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
     * Cleanup for character switching
     */
    cleanup() {
        // Disconnect MutationObserver
        if (this.observer) {
            this.observer();
            this.observer = null;
        }

        this.timerRegistry.clearAll();

        // Clear cached state
        this.lastSeenDungeonName = null;
        this.cumulativeStatsByDungeon = {}; // Reset cumulative counters
        this.processedMessages.clear(); // Clear message deduplication map
        this.initComplete = false; // Reset init flag
        this.enabled = true; // Reset to default enabled state

        // Remove all annotations from DOM
        const annotations = document.querySelectorAll('.dungeon-timer-annotation, .dungeon-timer-average');
        annotations.forEach((annotation) => annotation.remove());

        // Clear processed markers from chat messages
        const processedMessages = document.querySelectorAll('[class^="ChatMessage_chatMessage"][data-processed="1"]');
        processedMessages.forEach((msg) => {
            delete msg.dataset.processed;
            delete msg.dataset.timerAppended;
            delete msg.dataset.avgAppended;
        });
    }

    /**
     * Check if chat annotations are enabled
     * @returns {boolean} Enabled status
     */
    isEnabled() {
        return this.enabled;
    }
}

const dungeonTrackerChatAnnotations = new DungeonTrackerChatAnnotations();

export default dungeonTrackerChatAnnotations;
