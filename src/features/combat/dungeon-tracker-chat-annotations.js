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
        this.cumulativeStatsByDungeon = {}; // Persistent cumulative stats for color thresholds and averages
        this.storedRunNumbers = {}; // timestamp (ms) → run number, per statsKey, from storage
        this.processedMessages = new Map(); // Track processed messages to prevent duplicate counting
        this.initComplete = false; // Flag to ensure storage loads before annotation
        this.timerRegistry = createTimerRegistry();
        this.tabClickHandlers = new Map(); // Store tab click handlers for cleanup
        this._pendingAnnotateTimeout = null; // Debounce timer for annotateAllMessages
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
            // Scrub outlier runs before seeding averages
            await dungeonTrackerStorage.scrubOutlierRuns();

            // Get all runs from unified storage
            const allRuns = await dungeonTrackerStorage.getAllRuns();

            // Group runs by statsKey (teamKey::dungeonName), sorted oldest→newest
            const groupedRuns = {};
            for (const run of allRuns) {
                if (!run.teamKey || !run.dungeonName) continue;
                const duration = run.duration || run.totalTime;
                if (!duration || duration <= 0) continue;

                const key = `${run.teamKey}::${run.dungeonName}`;
                if (!groupedRuns[key]) groupedRuns[key] = [];
                groupedRuns[key].push(run);
            }

            // For each group: sort oldest→newest, assign 1-based run numbers,
            // build timestamp lookup map, and seed color-threshold stats
            for (const [key, runs] of Object.entries(groupedRuns)) {
                runs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                this.storedRunNumbers[key] = {};
                this.cumulativeStatsByDungeon[key] = {
                    runCount: runs.length,
                    totalTime: 0,
                    fastestTime: Infinity,
                    slowestTime: 0,
                };

                for (let i = 0; i < runs.length; i++) {
                    const run = runs[i];
                    const ts = new Date(run.timestamp).getTime();
                    this.storedRunNumbers[key][ts] = i + 1; // 1-based

                    const duration = run.duration || run.totalTime;
                    this.cumulativeStatsByDungeon[key].totalTime += duration;
                    if (duration < this.cumulativeStatsByDungeon[key].fastestTime) {
                        this.cumulativeStatsByDungeon[key].fastestTime = duration;
                    }
                    if (duration > this.cumulativeStatsByDungeon[key].slowestTime) {
                        this.cumulativeStatsByDungeon[key].slowestTime = duration;
                    }
                }
            }

            this.initComplete = true;
        } catch (error) {
            console.error('[Dungeon Tracker] Failed to load run counts from storage:', error);
            this.initComplete = true; // Continue anyway
        }
    }

    /**
     * Refresh run counts after backfill or clear operation
     * Resets all in-memory state and DOM annotation state, then re-annotates from scratch
     */
    async refreshRunCounts() {
        this.cumulativeStatsByDungeon = {};
        this.storedRunNumbers = {};
        this.processedMessages.clear();
        this.initComplete = false;

        // Remove existing annotation spans and reset DOM flags so messages can be re-annotated
        document.querySelectorAll('[class^="ChatMessage_chatMessage"]').forEach((msg) => {
            msg.querySelectorAll('.dungeon-timer-annotation, .dungeon-timer-average').forEach((s) => s.remove());
            delete msg.dataset.timerAppended;
            delete msg.dataset.avgAppended;
            delete msg.dataset.processed;
        });

        // Reload run numbers from storage before re-annotating
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
                // Remove old listener if exists
                const oldHandler = this.tabClickHandlers.get(button);
                if (oldHandler) {
                    button.removeEventListener('click', oldHandler);
                }

                // Create new handler
                const handler = () => {
                    // Delay to let DOM update
                    const annotateTimeout = setTimeout(() => this.annotateAllMessages(), 300);
                    this.timerRegistry.registerTimeout(annotateTimeout);
                };

                // Store and add new listener
                this.tabClickHandlers.set(button, handler);
                button.addEventListener('click', handler);
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
                let hasNewMessage = false;
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;

                        const msg = node.matches?.('[class^="ChatMessage_chatMessage"]')
                            ? node
                            : node.querySelector?.('[class^="ChatMessage_chatMessage"]');

                        if (msg) {
                            hasNewMessage = true;
                            break;
                        }
                    }
                    if (hasNewMessage) break;
                }

                if (!hasNewMessage) return;

                // Debounce: clear any pending call and schedule a single new one
                if (this._pendingAnnotateTimeout) {
                    clearTimeout(this._pendingAnnotateTimeout);
                }
                this._pendingAnnotateTimeout = setTimeout(() => {
                    this._pendingAnnotateTimeout = null;
                    this.annotateAllMessages();
                }, 100);
                this.timerRegistry.registerTimeout(this._pendingAnnotateTimeout);
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

        // Pre-pass: collect all successful key→key chat run timestamps grouped by statsKey.
        // Used to merge stored run history with visible chat runs and assign each visible run
        // a number based on its absolute chronological position across both populations.
        // This prevents the "two sequences" problem caused by gaps in backfill storage —
        // unbackfilled runs get a number based on where they fall in time, not appended after
        // the last stored run.
        const chatRunsByStatsKey = {};
        for (let pi = 0; pi < events.length; pi++) {
            const pe = events[pi];
            if (pe.type !== 'key') continue;

            let pnext = null;
            for (let pj = pi + 1; pj < events.length; pj++) {
                const ev = events[pj];
                if (ev.type === 'battle_start') break;
                if (ev.type === 'key' || ev.type === 'fail' || ev.type === 'cancel') {
                    pnext = ev;
                    break;
                }
            }
            if (!pnext || pnext.type !== 'key') continue;

            const pDungeonName = this.getDungeonNameWithFallback(events, pi);
            const pTeamKey = dungeonTrackerStorage.getTeamKey(pe.team);
            const pStatsKey = `${pTeamKey}::${pDungeonName}`;
            if (!chatRunsByStatsKey[pStatsKey]) chatRunsByStatsKey[pStatsKey] = [];
            chatRunsByStatsKey[pStatsKey].push(pe.timestamp.getTime());
        }

        // Build a chronological run number map for each statsKey.
        // Stored-only runs (not visible in chat) occupy number slots so that visible runs
        // reflect their true position in the full run history.
        const precomputedRunNumbers = {}; // statsKey → Map<chatTimestamp, runNumber>
        const chatRunsMatchedStorage = {}; // statsKey → Set<chatTimestamp> matched to a stored run
        for (const [pStatsKey, chatTsList] of Object.entries(chatRunsByStatsKey)) {
            const tsMap = this.storedRunNumbers[pStatsKey] || {};
            const storedTsList = Object.keys(tsMap)
                .map(Number)
                .sort((a, b) => a - b);

            // Match each chat run to a stored run within 10s tolerance
            const matchedChatSet = new Set();
            const matchedStoredSet = new Set();
            for (const chatTs of chatTsList) {
                const matchedSt = storedTsList.find((st) => Math.abs(st - chatTs) < 10000);
                if (matchedSt !== undefined) {
                    matchedStoredSet.add(matchedSt);
                    matchedChatSet.add(chatTs);
                }
            }

            // Stored runs not visible in chat still count toward the running total
            const storedOnlyTsList = storedTsList.filter((st) => !matchedStoredSet.has(st));

            // Merge and sort all runs chronologically
            const merged = [
                ...storedOnlyTsList.map((ts) => ({ ts, isChatRun: false })),
                ...chatTsList.map((ts) => ({ ts, isChatRun: true })),
            ].sort((a, b) => a.ts - b.ts);

            // Assign 1-based sequential numbers; stored-only runs occupy slots but aren't mapped
            const numMap = new Map();
            for (let mi = 0; mi < merged.length; mi++) {
                if (merged[mi].isChatRun) {
                    numMap.set(merged[mi].ts, mi + 1);
                }
            }
            precomputedRunNumbers[pStatsKey] = numMap;
            chatRunsMatchedStorage[pStatsKey] = matchedChatSet;
        }

        // Continue with visual annotations
        const runDurations = [];

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type !== 'key') continue;

            // Find the next relevant event, stopping at any battle_start (session boundary).
            // This prevents cross-session pairings caused by overnight gaps or mid-run rejoins.
            let next = null;
            let hitBattleStart = false;
            for (let j = i + 1; j < events.length; j++) {
                const ev = events[j];
                if (ev.type === 'battle_start') {
                    hitBattleStart = true;
                    break;
                }
                if (ev.type === 'key' || ev.type === 'fail' || ev.type === 'cancel') {
                    next = ev;
                    break;
                }
            }

            let label = null;
            let diff = null;
            let color = null;

            // Get dungeon name with hybrid fallback (handles chat scrolling)
            const dungeonName = this.getDungeonNameWithFallback(events, i);

            // Composite key: team + dungeon so each team's runs are numbered independently
            const teamKey = dungeonTrackerStorage.getTeamKey(e.team);
            const statsKey = `${teamKey}::${dungeonName}`;

            if (next?.type === 'key') {
                // Calculate duration between consecutive key counts
                diff = next.timestamp - e.timestamp;
                if (diff < 0) {
                    diff += 24 * 60 * 60 * 1000; // Handle midnight rollover
                }

                label = this.formatTime(diff);

                // Color run relative to the running cumulative average for this team+dungeon.
                // Green = faster than average, red = slower, neutral = no history yet.
                const teamStats = this.cumulativeStatsByDungeon[statsKey];
                if (teamStats && teamStats.runCount > 0) {
                    const avg = teamStats.totalTime / teamStats.runCount;
                    if (diff < avg) {
                        color = config.COLOR_PROFIT || '#5fda5f'; // Green — faster than average
                    } else if (diff > avg) {
                        color = config.COLOR_LOSS || '#ff6b6b'; // Red — slower than average
                    } else {
                        color = '#90ee90'; // Exactly on average
                    }
                } else {
                    color = '#90ee90'; // No history yet — neutral
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
            } else if (hitBattleStart) {
                // No key/fail/cancel before the next battle_start — player left the party,
                // ending the run without a completion key count.
                label = 'canceled';
                color = '#ffd700'; // Gold
            }

            if (label) {
                const isSuccessfulRun = diff && dungeonName && dungeonName !== 'Unknown';

                if (isSuccessfulRun) {
                    // Create unique message ID to prevent duplicate annotation on re-runs
                    const messageId = `${e.timestamp.getTime()}_${statsKey}`;

                    // Initialize team+dungeon stats if needed
                    if (!this.cumulativeStatsByDungeon[statsKey]) {
                        this.cumulativeStatsByDungeon[statsKey] = {
                            runCount: 0,
                            totalTime: 0,
                            fastestTime: Infinity,
                            slowestTime: 0,
                        };
                    }

                    const dungeonStats = this.cumulativeStatsByDungeon[statsKey];

                    let runNumber;
                    if (this.processedMessages.has(messageId)) {
                        // Already annotated — reuse stored run number
                        runNumber = this.processedMessages.get(messageId);
                    } else {
                        // Look up number from pre-computed chronological position map
                        const msgTs = e.timestamp.getTime();
                        runNumber = precomputedRunNumbers[statsKey]?.get(msgTs);
                        if (runNumber === undefined) {
                            // Edge case: live run arrived after the pre-pass completed
                            runNumber = (dungeonStats.runCount || 0) + 1;
                        }

                        // Only add to the running total for new (unmatched) runs.
                        // Storage-matched runs are already counted in the seed from
                        // loadRunCountsFromStorage — adding their time again would cause
                        // the average to climb on every annotation pass regardless of
                        // actual run performance.
                        if (!chatRunsMatchedStorage[statsKey]?.has(msgTs)) {
                            dungeonStats.runCount++;
                            dungeonStats.totalTime += diff;
                        }

                        if (diff < dungeonStats.fastestTime) dungeonStats.fastestTime = diff;
                        if (diff > dungeonStats.slowestTime) dungeonStats.slowestTime = diff;
                        this.processedMessages.set(messageId, runNumber);

                        // Register in storedRunNumbers so future annotateAllMessages()
                        // calls include it in the merge and don't reuse its number slot
                        if (!this.storedRunNumbers[statsKey]) this.storedRunNumbers[statsKey] = {};
                        this.storedRunNumbers[statsKey][msgTs] = runNumber;
                    }

                    label = `Run #${runNumber}: ${label}`;
                }

                // Mark as processed BEFORE inserting (matches working DRT script)
                e.msg.dataset.processed = '1';

                this.insertAnnotation(label, color, e.msg, false);

                // Add cumulative average if this is a successful run
                if (isSuccessfulRun) {
                    const dungeonStats = this.cumulativeStatsByDungeon[statsKey];

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

            // Find next relevant event, stopping at any battle_start (session boundary).
            let next = null;
            for (let j = i + 1; j < events.length; j++) {
                const ev = events[j];
                if (ev.type === 'battle_start') break;
                if (ev.type === 'key' || ev.type === 'fail' || ev.type === 'cancel') {
                    next = ev;
                    break;
                }
            }
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
     * @returns {Object} Stats keyed by "teamKey::dungeonName"
     */
    calculateStatsFromEvents(events) {
        const statsByKey = {};

        // Loop through events and collect all completed runs
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type !== 'key') continue;

            // Find next relevant event, stopping at any battle_start (session boundary).
            let next = null;
            for (let j = i + 1; j < events.length; j++) {
                const ev = events[j];
                if (ev.type === 'battle_start') break;
                if (ev.type === 'key' || ev.type === 'fail' || ev.type === 'cancel') {
                    next = ev;
                    break;
                }
            }
            if (!next || next.type !== 'key') continue; // Only key→key pairs (successful runs)

            // Calculate duration
            let duration = next.timestamp - event.timestamp;
            if (duration < 0) duration += 24 * 60 * 60 * 1000; // Midnight rollover

            // Get dungeon name and team key
            const dungeonName = this.getDungeonNameWithFallback(events, i);
            if (!dungeonName || dungeonName === 'Unknown') continue;

            const teamKey = dungeonTrackerStorage.getTeamKey(event.team);
            const statsKey = `${teamKey}::${dungeonName}`;

            // Initialize stats entry if needed
            if (!statsByKey[statsKey]) {
                statsByKey[statsKey] = { durations: [] };
            }

            // Add this run duration
            statsByKey[statsKey].durations.push(duration);
        }

        // Calculate stats for each team+dungeon combination
        const result = {};
        for (const [key, data] of Object.entries(statsByKey)) {
            const durations = data.durations;
            if (durations.length === 0) continue;

            const total = durations.reduce((sum, d) => sum + d, 0);
            result[key] = {
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
                // Do NOT mark battle_start as processed — it must persist across passes
                // as a session boundary for the forward-scan pairing logic.
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
                // Do NOT mark fail as processed — must persist as session context.
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
                // Do NOT mark cancel as processed — must persist as session context.
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
     * Handles American (M/D HH:MM:SS AM/PM), international (DD-M HH:MM:SS),
     * and European dot (D.M. HH:MM:SS) formats
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
            // Try European dot format: [D.M. HH:MM:SS] (24-hour, trailing dot optional)
            match = text.match(/\[(\d{1,2})\.(\d{1,2})\.?\s*(\d{1,2}):(\d{2}):(\d{2})\]/);
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
            // American format: M/D — but if first part > 12 it must be DD/MM (e.g. "16/07")
            [, month, day, hour, min, sec, period] = match;
            month = parseInt(month, 10);
            day = parseInt(day, 10);
            if (month > 12) {
                // Swap: first part is day, second part is month
                [month, day] = [day, month];
            }
        } else {
            // International format: D-M or D.M.
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
        // Check for existing annotation spans in the DOM (authoritative deduplication)
        const spanClass = isAverage ? 'dungeon-timer-average' : 'dungeon-timer-annotation';
        if (msg.querySelector('.' + spanClass)) {
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

        // Remove tab click listeners
        for (const [button, handler] of this.tabClickHandlers) {
            button.removeEventListener('click', handler);
        }
        this.tabClickHandlers.clear();

        // Clear pending annotation debounce
        if (this._pendingAnnotateTimeout) {
            clearTimeout(this._pendingAnnotateTimeout);
            this._pendingAnnotateTimeout = null;
        }

        this.timerRegistry.clearAll();

        // Clear cached state
        this.lastSeenDungeonName = null;
        this.cumulativeStatsByDungeon = {}; // Reset cumulative counters
        this.storedRunNumbers = {}; // Reset storage lookup map
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
