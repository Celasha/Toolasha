/**
 * Dungeon Tracker Core
 * Tracks dungeon progress in real-time using WebSocket messages
 */

import webSocketHook from '../../core/websocket.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class DungeonTracker {
    constructor() {
        this.isTracking = false;
        this.isInitialized = false; // Guard flag
        this.currentRun = null;
        this.waveStartTime = null;
        this.waveTimes = [];
        this.updateCallbacks = [];
        this.pendingDungeonInfo = null; // Store dungeon info before tracking starts
        this.currentBattleId = null; // Current battle ID for persistence verification

        // Party message tracking for server-validated duration
        this.firstKeyCountTimestamp = null; // Timestamp from first "Key counts" message
        this.lastKeyCountTimestamp = null; // Timestamp from last "Key counts" message
        this.keyCountMessages = []; // Store all key count messages for this run
        this.battleStartedTimestamp = null; // Timestamp from "Battle started" message

        // Character ID for data isolation
        this.characterId = null;

        // WebSocket message history (last 100 party messages for reliable timestamp capture)
        this.recentChatMessages = [];

        // Hibernation detection (for UI time label switching)
        this.hibernationDetected = false;
        this.timerRegistry = createTimerRegistry();
        this.visibilityHandler = null;

        // Store handler references for cleanup
        this.handlers = {
            newBattle: null,
            actionCompleted: null,
            actionsUpdated: null,
            chatMessage: null,
        };
    }

    /**
     * Get character ID from URL
     * @returns {string|null} Character ID or null
     */
    getCharacterIdFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('characterId');
    }

    /**
     * Get namespaced storage key for this character
     * @param {string} key - Base key
     * @returns {string} Namespaced key
     */
    getCharacterKey(key) {
        if (!this.characterId) {
            return key;
        }
        return `${key}_${this.characterId}`;
    }

    /**
     * Check if an action is a dungeon action
     * @param {string} actionHrid - Action HRID to check
     * @returns {boolean} True if action is a dungeon
     */
    isDungeonAction(actionHrid) {
        if (!actionHrid || !actionHrid.startsWith('/actions/combat/')) {
            return false;
        }

        const actionDetails = dataManager.getActionDetails(actionHrid);
        return actionDetails?.combatZoneInfo?.isDungeon === true;
    }

    /**
     * Save in-progress run to IndexedDB
     * @returns {Promise<boolean>} Success status
     */
    async saveInProgressRun() {
        if (!this.isTracking || !this.currentRun || !this.currentBattleId) {
            return false;
        }

        const stateToSave = {
            battleId: this.currentBattleId,
            dungeonHrid: this.currentRun.dungeonHrid,
            tier: this.currentRun.tier,
            startTime: this.currentRun.startTime,
            currentWave: this.currentRun.currentWave,
            maxWaves: this.currentRun.maxWaves,
            wavesCompleted: this.currentRun.wavesCompleted,
            waveTimes: [...this.waveTimes],
            waveStartTime: this.waveStartTime?.getTime() || null,
            keyCountsMap: this.currentRun.keyCountsMap || {},
            lastUpdateTime: Date.now(),
            // Save timestamp tracking fields for completion detection
            firstKeyCountTimestamp: this.firstKeyCountTimestamp,
            lastKeyCountTimestamp: this.lastKeyCountTimestamp,
            battleStartedTimestamp: this.battleStartedTimestamp,
            keyCountMessages: this.keyCountMessages,
            hibernationDetected: this.hibernationDetected,
        };

        return storage.setJSON('dungeonTracker_inProgressRun', stateToSave, 'settings', true);
    }

    /**
     * Restore in-progress run from IndexedDB
     * @param {number} currentBattleId - Current battle ID from new_battle message
     * @returns {Promise<boolean>} True if restored successfully
     */
    async restoreInProgressRun(currentBattleId) {
        const saved = await storage.getJSON('dungeonTracker_inProgressRun', 'settings', null);

        if (!saved) {
            return false; // No saved state
        }

        // Verify battleId matches (same run)
        if (saved.battleId !== currentBattleId) {
            await this.clearInProgressRun();
            return false;
        }

        // Verify dungeon action is still active
        const currentActions = dataManager.getCurrentActions();
        const dungeonAction = currentActions.find((a) => this.isDungeonAction(a.actionHrid) && !a.isDone);

        if (!dungeonAction || dungeonAction.actionHrid !== saved.dungeonHrid) {
            await this.clearInProgressRun();
            return false;
        }

        // Check staleness (older than 10 minutes = likely invalid)
        const age = Date.now() - saved.lastUpdateTime;
        if (age > 10 * 60 * 1000) {
            await this.clearInProgressRun();
            return false;
        }

        // Restore state
        this.isTracking = true;
        this.currentBattleId = saved.battleId;
        this.waveTimes = saved.waveTimes || [];
        this.waveStartTime = saved.waveStartTime ? new Date(saved.waveStartTime) : null;

        // Restore timestamp tracking fields
        this.firstKeyCountTimestamp = saved.firstKeyCountTimestamp || null;
        this.lastKeyCountTimestamp = saved.lastKeyCountTimestamp || null;
        this.battleStartedTimestamp = saved.battleStartedTimestamp || null;
        this.keyCountMessages = saved.keyCountMessages || [];

        // Restore hibernation detection flag
        this.hibernationDetected = saved.hibernationDetected || false;

        this.currentRun = {
            dungeonHrid: saved.dungeonHrid,
            tier: saved.tier,
            startTime: saved.startTime,
            currentWave: saved.currentWave,
            maxWaves: saved.maxWaves,
            wavesCompleted: saved.wavesCompleted,
            keyCountsMap: saved.keyCountsMap || {},
            hibernationDetected: saved.hibernationDetected || false,
        };

        this.notifyUpdate();
        return true;
    }

    /**
     * Clear saved in-progress run from IndexedDB
     * @returns {Promise<boolean>} Success status
     */
    async clearInProgressRun() {
        return storage.delete('dungeonTracker_inProgressRun', 'settings');
    }

    /**
     * Initialize dungeon tracker
     */
    async initialize() {
        // Guard FIRST
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Get character ID from URL for data isolation
        this.characterId = this.getCharacterIdFromURL();

        // Create and store handler references for cleanup
        this.handlers.newBattle = (data) => this.onNewBattle(data);
        this.handlers.actionCompleted = (data) => this.onActionCompleted(data);
        this.handlers.actionsUpdated = (data) => this.onActionsUpdated(data);
        this.handlers.chatMessage = (data) => this.onChatMessage(data);

        // Listen for new_battle messages (wave start)
        webSocketHook.on('new_battle', this.handlers.newBattle);

        // Listen for action_completed messages (wave complete)
        webSocketHook.on('action_completed', this.handlers.actionCompleted);

        // Listen for actions_updated to detect flee/cancel
        webSocketHook.on('actions_updated', this.handlers.actionsUpdated);

        // Listen for party chat messages (for server-validated duration and battle started)
        webSocketHook.on('chat_message_received', this.handlers.chatMessage);

        // Setup hibernation detection using Visibility API
        this.setupHibernationDetection();

        // Check for active dungeon on page load and try to restore state
        const checkTimeout = setTimeout(() => this.checkForActiveDungeon(), 1000);
        this.timerRegistry.registerTimeout(checkTimeout);

        dataManager.on('character_switching', () => {
            this.cleanup();
        });
    }

    /**
     * Setup hibernation detection using Visibility API
     * Detects when computer sleeps/wakes to flag elapsed time as potentially inaccurate
     */
    setupHibernationDetection() {
        let wasHidden = false;

        this.visibilityHandler = () => {
            if (document.hidden) {
                // Tab hidden or computer going to sleep
                wasHidden = true;
            } else if (wasHidden && this.isTracking) {
                // Tab visible again after being hidden during active run
                // Mark hibernation detected (elapsed time may be wrong)
                this.hibernationDetected = true;
                if (this.currentRun) {
                    this.currentRun.hibernationDetected = true;
                }
                this.notifyUpdate();
                this.saveInProgressRun(); // Persist flag to IndexedDB
                wasHidden = false;
            }
        };

        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    /**
     * Check if there's an active dungeon on page load and restore tracking
     */
    async checkForActiveDungeon() {
        // Check if already tracking (shouldn't be, but just in case)
        if (this.isTracking) {
            return;
        }

        // Get current actions from dataManager
        const currentActions = dataManager.getCurrentActions();

        // Find active dungeon action
        const dungeonAction = currentActions.find((a) => this.isDungeonAction(a.actionHrid) && !a.isDone);

        if (!dungeonAction) {
            return;
        }

        // Try to restore saved state from IndexedDB
        const saved = await storage.getJSON('dungeonTracker_inProgressRun', 'settings', null);

        if (saved && saved.dungeonHrid === dungeonAction.actionHrid) {
            // Restore state immediately so UI appears
            this.isTracking = true;
            this.currentBattleId = saved.battleId;
            this.waveTimes = saved.waveTimes || [];
            this.waveStartTime = saved.waveStartTime ? new Date(saved.waveStartTime) : null;

            // Restore timestamp tracking fields
            this.firstKeyCountTimestamp = saved.firstKeyCountTimestamp || null;
            this.lastKeyCountTimestamp = saved.lastKeyCountTimestamp || null;
            this.battleStartedTimestamp = saved.battleStartedTimestamp || null;
            this.keyCountMessages = saved.keyCountMessages || [];

            this.currentRun = {
                dungeonHrid: saved.dungeonHrid,
                tier: saved.tier,
                startTime: saved.startTime,
                currentWave: saved.currentWave,
                maxWaves: saved.maxWaves,
                wavesCompleted: saved.wavesCompleted,
                keyCountsMap: saved.keyCountsMap || {},
            };

            // Trigger UI update to show immediately
            this.notifyUpdate();
        } else {
            // Store pending dungeon info for when new_battle fires
            this.pendingDungeonInfo = {
                dungeonHrid: dungeonAction.actionHrid,
                tier: dungeonAction.difficultyTier,
            };
        }
    }

    /**
     * Scan existing chat messages for "Battle started" and "Key counts" (in case we joined mid-dungeon)
     */
    scanExistingChatMessages() {
        if (!this.isTracking) {
            return;
        }

        try {
            let battleStartedFound = false;
            let latestKeyCountsMap = null;
            let latestTimestamp = null;

            // FIRST: Try to find messages in memory (most reliable)
            if (this.recentChatMessages.length > 0) {
                for (const message of this.recentChatMessages) {
                    // Look for "Battle started" messages
                    if (message.m === 'systemChatMessage.partyBattleStarted') {
                        const timestamp = new Date(message.t).getTime();
                        this.battleStartedTimestamp = timestamp;
                        battleStartedFound = true;
                    }

                    // Look for "Key counts" messages
                    if (message.m === 'systemChatMessage.partyKeyCount') {
                        const timestamp = new Date(message.t).getTime();

                        // Parse key counts from systemMetadata
                        try {
                            const metadata = JSON.parse(message.systemMetadata || '{}');
                            const keyCountString = metadata.keyCountString || '';
                            const keyCountsMap = this.parseKeyCountsFromMessage(keyCountString);

                            if (Object.keys(keyCountsMap).length > 0) {
                                latestKeyCountsMap = keyCountsMap;
                                latestTimestamp = timestamp;
                            }
                        } catch (error) {
                            console.warn('[Dungeon Tracker] Failed to parse Key counts from message history:', error);
                        }
                    }
                }
            }

            // FALLBACK: If no messages in memory, scan DOM (for messages that arrived before script loaded)
            if (!latestKeyCountsMap) {
                const messages = document.querySelectorAll('[class^="ChatMessage_chatMessage"]');

                // Scan all messages to find Battle started and most recent key counts
                for (const msg of messages) {
                    const text = msg.textContent || '';

                    // FILTER: Skip player messages
                    // Check for username element (player messages have a username child element)
                    const hasUsername = msg.querySelector('[class*="ChatMessage_username"]') !== null;
                    if (hasUsername) {
                        continue; // Skip player messages
                    }

                    // FALLBACK: Check if text starts with non-timestamp text followed by colon
                    if (/^[^[]+:/.test(text)) {
                        continue; // Skip player messages
                    }

                    // Look for "Battle started:" messages
                    if (text.includes('Battle started:')) {
                        // Try to extract timestamp
                        // Try to extract timestamp from message display format: [MM/DD HH:MM:SS AM/PM] or [DD-M HH:MM:SS]
                        const timestampMatch = text.match(
                            /\[(\d{1,2})([-/])(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/
                        );

                        if (timestampMatch) {
                            const part1 = parseInt(timestampMatch[1], 10);
                            const separator = timestampMatch[2];
                            const part2 = parseInt(timestampMatch[3], 10);
                            let hour = parseInt(timestampMatch[4], 10);
                            const min = parseInt(timestampMatch[5], 10);
                            const sec = parseInt(timestampMatch[6], 10);
                            const period = timestampMatch[7];

                            // Determine format based on separator
                            let month, day;
                            if (separator === '/') {
                                // MM/DD format
                                month = part1;
                                day = part2;
                            } else {
                                // DD-M format (dash separator)
                                day = part1;
                                month = part2;
                            }

                            // Handle AM/PM if present
                            if (period === 'PM' && hour < 12) hour += 12;
                            if (period === 'AM' && hour === 12) hour = 0;

                            // Create timestamp (assumes current year)
                            const now = new Date();
                            const timestamp = new Date(now.getFullYear(), month - 1, day, hour, min, sec, 0);

                            this.battleStartedTimestamp = timestamp.getTime();
                            battleStartedFound = true;
                        }
                    }

                    // Look for "Key counts:" messages
                    if (text.includes('Key counts:')) {
                        // Parse the message
                        const keyCountsMap = this.parseKeyCountsFromMessage(text);

                        if (Object.keys(keyCountsMap).length > 0) {
                            // Try to extract timestamp from message display format: [MM/DD HH:MM:SS AM/PM] or [DD-M HH:MM:SS]
                            const timestampMatch = text.match(
                                /\[(\d{1,2})([-/])(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/
                            );

                            if (timestampMatch) {
                                const part1 = parseInt(timestampMatch[1], 10);
                                const separator = timestampMatch[2];
                                const part2 = parseInt(timestampMatch[3], 10);
                                let hour = parseInt(timestampMatch[4], 10);
                                const min = parseInt(timestampMatch[5], 10);
                                const sec = parseInt(timestampMatch[6], 10);
                                const period = timestampMatch[7];

                                // Determine format based on separator
                                let month, day;
                                if (separator === '/') {
                                    // MM/DD format
                                    month = part1;
                                    day = part2;
                                } else {
                                    // DD-M format (dash separator)
                                    day = part1;
                                    month = part2;
                                }

                                // Handle AM/PM if present
                                if (period === 'PM' && hour < 12) hour += 12;
                                if (period === 'AM' && hour === 12) hour = 0;

                                // Create timestamp (assumes current year)
                                const now = new Date();
                                const timestamp = new Date(now.getFullYear(), month - 1, day, hour, min, sec, 0);

                                // Keep this as the latest (will be overwritten if we find a newer one)
                                latestKeyCountsMap = keyCountsMap;
                                latestTimestamp = timestamp.getTime();
                            } else {
                                console.warn(
                                    '[Dungeon Tracker] Found Key counts but could not parse timestamp from:',
                                    text.substring(0, 50)
                                );
                                latestKeyCountsMap = keyCountsMap;
                            }
                        }
                    }
                }
            }

            // Update current run with the most recent key counts found
            if (latestKeyCountsMap && this.currentRun) {
                this.currentRun.keyCountsMap = latestKeyCountsMap;

                // Set firstKeyCountTimestamp and lastKeyCountTimestamp from DOM scan
                // Priority: Use Battle started timestamp if found, otherwise use Key counts timestamp
                if (this.firstKeyCountTimestamp === null) {
                    if (battleStartedFound && this.battleStartedTimestamp) {
                        // Use battle started as anchor point, key counts as first run timestamp
                        this.firstKeyCountTimestamp = latestTimestamp;
                        this.lastKeyCountTimestamp = latestTimestamp;
                    } else if (latestTimestamp) {
                        this.firstKeyCountTimestamp = latestTimestamp;
                        this.lastKeyCountTimestamp = latestTimestamp;
                    }

                    // Store this message for history
                    if (this.firstKeyCountTimestamp) {
                        this.keyCountMessages.push({
                            timestamp: this.firstKeyCountTimestamp,
                            keyCountsMap: latestKeyCountsMap,
                            text:
                                'Key counts: ' +
                                Object.entries(latestKeyCountsMap)
                                    .map(([name, count]) => `[${name} - ${count}]`)
                                    .join(', '),
                        });
                    }
                }

                this.notifyUpdate();
                this.saveInProgressRun(); // Persist to IndexedDB
            } else if (!this.currentRun) {
                console.warn('[Dungeon Tracker] Current run is null, cannot update');
            }
        } catch (error) {
            console.error('[Dungeon Tracker] Error scanning existing messages:', error);
        }
    }

    /**
     * Handle actions_updated message (detect flee/cancel and dungeon start)
     * @param {Object} data - actions_updated message data
     */
    onActionsUpdated(data) {
        // Check if any dungeon action was added or removed
        if (data.endCharacterActions) {
            for (const action of data.endCharacterActions) {
                // Check if this is a dungeon action using explicit verification
                if (this.isDungeonAction(action.actionHrid)) {
                    if (action.isDone === false) {
                        // Dungeon action added to queue - store info for when new_battle fires
                        this.pendingDungeonInfo = {
                            dungeonHrid: action.actionHrid,
                            tier: action.difficultyTier,
                        };

                        // If already tracking (somehow), update immediately
                        if (this.isTracking && !this.currentRun.dungeonHrid) {
                            this.currentRun.dungeonHrid = action.actionHrid;
                            this.currentRun.tier = action.difficultyTier;

                            const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(action.actionHrid);
                            if (dungeonInfo) {
                                this.currentRun.maxWaves = dungeonInfo.maxWaves;
                                this.notifyUpdate();
                            }
                        }
                    } else if (action.isDone === true && this.isTracking && this.currentRun) {
                        // Dungeon action marked as done (completion or flee)

                        // If we don't have dungeon info yet, grab it from this action
                        if (!this.currentRun.dungeonHrid) {
                            this.currentRun.dungeonHrid = action.actionHrid;
                            this.currentRun.tier = action.difficultyTier;

                            const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(action.actionHrid);
                            if (dungeonInfo) {
                                this.currentRun.maxWaves = dungeonInfo.maxWaves;
                                // Update UI with the name before resetting
                                this.notifyUpdate();
                            }
                        }

                        // Check if this was a successful completion or early exit
                        const allWavesCompleted =
                            this.currentRun.maxWaves && this.currentRun.wavesCompleted >= this.currentRun.maxWaves;

                        if (!allWavesCompleted) {
                            // Early exit (fled, died, or failed)
                            this.resetTracking();
                        }
                        // If it was a successful completion, action_completed will handle it
                        return;
                    }
                }
            }
        }
    }

    /**
     * Handle chat_message_received (parse Key counts messages, Battle started, and Party failed)
     * @param {Object} data - chat_message_received message data
     */
    onChatMessage(data) {
        // Extract message object
        const message = data.message;
        if (!message) {
            return;
        }

        // Only process party chat messages
        if (message.chan !== '/chat_channel_types/party') {
            return;
        }

        // Store ALL party messages in memory (for reliable timestamp capture)
        this.recentChatMessages.push(message);
        if (this.recentChatMessages.length > 100) {
            this.recentChatMessages.shift(); // Keep last 100 only
        }

        // Only process system messages
        if (!message.isSystemMessage) {
            return;
        }

        // Extract timestamp from message (convert to milliseconds)
        const timestamp = new Date(message.t).getTime();

        // Handle "Battle started" messages
        if (message.m === 'systemChatMessage.partyBattleStarted') {
            this.onBattleStarted(timestamp, message);
            return;
        }

        // Handle "Party failed" messages
        if (message.m === 'systemChatMessage.partyFailed') {
            this.onPartyFailed(timestamp, message);
            return;
        }

        // Handle "Key counts" messages
        if (message.m === 'systemChatMessage.partyKeyCount') {
            this.onKeyCountsMessage(timestamp, message);
        }
    }

    /**
     * Handle "Battle started" message
     * @param {number} timestamp - Message timestamp in milliseconds
     * @param {Object} message - Message object
     */
    onBattleStarted(timestamp, message) {
        // Store battle started timestamp
        this.battleStartedTimestamp = timestamp;

        // If tracking and dungeonHrid is set, check if this is a different dungeon
        if (this.isTracking && this.currentRun && this.currentRun.dungeonHrid) {
            // Parse dungeon name from message to detect dungeon switching
            try {
                const metadata = JSON.parse(message.systemMetadata || '{}');
                const battleName = metadata.name || '';

                // Extract dungeon HRID from battle name (this is a heuristic)
                const currentDungeonName =
                    dungeonTrackerStorage.getDungeonInfo(this.currentRun.dungeonHrid)?.name || '';

                if (battleName && currentDungeonName && !battleName.includes(currentDungeonName)) {
                    this.resetTracking();
                }
            } catch (error) {
                console.error('[Dungeon Tracker] Error parsing battle started metadata:', error);
            }
        }
    }

    /**
     * Handle "Party failed" message
     * @param {number} _timestamp - Message timestamp in milliseconds
     * @param {Object} _message - Message object
     */
    onPartyFailed(_timestamp, _message) {
        if (!this.isTracking || !this.currentRun) {
            return;
        }

        // Mark run as failed and reset tracking
        this.resetTracking();
    }

    /**
     * Handle "Key counts" message
     * @param {number} timestamp - Message timestamp in milliseconds
     * @param {Object} message - Message object
     */
    onKeyCountsMessage(timestamp, message) {
        // Parse systemMetadata JSON to get keyCountString
        let keyCountString = '';
        try {
            const metadata = JSON.parse(message.systemMetadata);
            keyCountString = metadata.keyCountString || '';
        } catch (error) {
            console.error('[Dungeon Tracker] Failed to parse systemMetadata:', error);
            return;
        }

        // Parse key counts from the string
        const keyCountsMap = this.parseKeyCountsFromMessage(keyCountString);

        // If not tracking, ignore (probably from someone else's dungeon)
        if (!this.isTracking) {
            return;
        }

        // If we already have a lastKeyCountTimestamp, this is the COMPLETION message
        // (The first message sets both first and last to the same value)
        if (this.lastKeyCountTimestamp !== null && timestamp > this.lastKeyCountTimestamp) {
            // Check for midnight rollover
            let duration = timestamp - this.firstKeyCountTimestamp;
            if (duration < 0) {
                duration += 24 * 60 * 60 * 1000;
            }

            // Update last timestamp for duration calculation
            this.lastKeyCountTimestamp = timestamp;

            // Update key counts
            if (this.currentRun) {
                this.currentRun.keyCountsMap = keyCountsMap;
            }

            // Store completion message
            this.keyCountMessages.push({
                timestamp,
                keyCountsMap,
                text: keyCountString,
            });

            // Complete the dungeon
            this.completeDungeon();
            return;
        }

        // First "Key counts" message = dungeon start
        if (this.firstKeyCountTimestamp === null) {
            // FALLBACK: If we're already tracking and have a currentRun.startTime,
            // this is probably the COMPLETION message, not the start!
            // This happens when state was restored but first message wasn't captured.
            if (this.currentRun && this.currentRun.startTime) {
                // Use the currentRun.startTime as the first timestamp (best estimate)
                this.firstKeyCountTimestamp = this.currentRun.startTime;
                this.lastKeyCountTimestamp = timestamp; // Current message is completion

                // Check for midnight rollover
                let duration = timestamp - this.firstKeyCountTimestamp;
                if (duration < 0) {
                    duration += 24 * 60 * 60 * 1000;
                }

                // Update key counts
                if (this.currentRun) {
                    this.currentRun.keyCountsMap = keyCountsMap;
                }

                // Store completion message
                this.keyCountMessages.push({
                    timestamp,
                    keyCountsMap,
                    text: keyCountString,
                });

                // Complete the dungeon
                this.completeDungeon();
                return;
            }

            // Normal case: This is actually the first message
            this.firstKeyCountTimestamp = timestamp;
            this.lastKeyCountTimestamp = timestamp; // Set both to same value initially
        }

        // Update current run with latest key counts
        if (this.currentRun) {
            this.currentRun.keyCountsMap = keyCountsMap;
            this.notifyUpdate(); // Trigger UI update with new key counts
            this.saveInProgressRun(); // Persist to IndexedDB
        }

        // Store message data for history
        this.keyCountMessages.push({
            timestamp,
            keyCountsMap,
            text: keyCountString,
        });
    }

    /**
     * Parse key counts from message text
     * @param {string} messageText - Message text containing key counts
     * @returns {Object} Map of player names to key counts
     */
    parseKeyCountsFromMessage(messageText) {
        const keyCountsMap = {};

        // Regex to match [PlayerName - KeyCount] pattern (with optional comma separators)
        const regex = /\[([^[\]-]+?)\s*-\s*([\d,]+)\]/g;
        let match;

        while ((match = regex.exec(messageText)) !== null) {
            const playerName = match[1].trim();
            // Remove commas before parsing
            const keyCount = parseInt(match[2].replace(/,/g, ''), 10);
            keyCountsMap[playerName] = keyCount;
        }

        return keyCountsMap;
    }

    /**
     * Calculate server-validated duration from party messages
     * @returns {number|null} Duration in milliseconds, or null if no messages
     */
    getPartyMessageDuration() {
        if (!this.firstKeyCountTimestamp || !this.lastKeyCountTimestamp) {
            return null;
        }

        // Duration = last message - first message
        return this.lastKeyCountTimestamp - this.firstKeyCountTimestamp;
    }

    /**
     * Handle new_battle message (wave start)
     * @param {Object} data - new_battle message data
     */
    async onNewBattle(data) {
        // Only track if we have wave data
        if (data.wave === undefined) {
            return;
        }

        // Capture battleId for persistence
        const battleId = data.battleId;

        // Wave 0 = first wave = dungeon start
        if (data.wave === 0) {
            // Clear any stale saved state first (in case previous run didn't clear properly)
            await this.clearInProgressRun();

            // Start fresh dungeon
            this.startDungeon(data);
        } else if (!this.isTracking) {
            // Mid-dungeon start - try to restore first
            const restored = await this.restoreInProgressRun(battleId);
            if (!restored) {
                // No restore - initialize tracking anyway
                this.startDungeon(data);
            } else {
                // Restored in-progress run; continue tracking
            }
        } else {
            // Subsequent wave (already tracking)
            // Update battleId in case user logged out and back in (new battle instance)
            this.currentBattleId = data.battleId;
            this.startWave(data);
        }
    }

    /**
     * Start tracking a new dungeon run
     * @param {Object} data - new_battle message data
     */
    startDungeon(data) {
        // Get dungeon info - prioritize pending info from actions_updated
        let dungeonHrid = null;
        let tier = null;
        let maxWaves = null;

        if (this.pendingDungeonInfo) {
            // Verify this is actually a dungeon action before starting tracking
            if (!this.isDungeonAction(this.pendingDungeonInfo.dungeonHrid)) {
                console.warn(
                    '[Dungeon Tracker] Attempted to track non-dungeon action:',
                    this.pendingDungeonInfo.dungeonHrid
                );
                this.pendingDungeonInfo = null;
                return; // Don't start tracking
            }

            // Use info from actions_updated message
            dungeonHrid = this.pendingDungeonInfo.dungeonHrid;
            tier = this.pendingDungeonInfo.tier;

            const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(dungeonHrid);
            if (dungeonInfo) {
                maxWaves = dungeonInfo.maxWaves;
            }

            // Clear pending info
            this.pendingDungeonInfo = null;
        } else {
            // FALLBACK: Check current actions from dataManager
            const currentActions = dataManager.getCurrentActions();
            const dungeonAction = currentActions.find((a) => this.isDungeonAction(a.actionHrid) && !a.isDone);

            if (dungeonAction) {
                dungeonHrid = dungeonAction.actionHrid;
                tier = dungeonAction.difficultyTier;

                const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(dungeonHrid);
                if (dungeonInfo) {
                    maxWaves = dungeonInfo.maxWaves;
                }
            }
        }

        // Don't start tracking if we don't have dungeon info (not a dungeon)
        if (!dungeonHrid) {
            return;
        }

        this.isTracking = true;
        this.currentBattleId = data.battleId; // Store battleId for persistence
        this.waveStartTime = new Date(data.combatStartTime);
        this.waveTimes = [];

        // Reset party message tracking
        this.firstKeyCountTimestamp = null;
        this.lastKeyCountTimestamp = null;
        this.keyCountMessages = [];

        // Reset hibernation detection for new run
        this.hibernationDetected = false;

        this.currentRun = {
            dungeonHrid: dungeonHrid,
            tier: tier,
            startTime: this.waveStartTime.getTime(),
            currentWave: data.wave, // Use actual wave number (1-indexed)
            maxWaves: maxWaves,
            wavesCompleted: 0, // No waves completed yet (will update as waves complete)
            hibernationDetected: false, // Track if computer sleep detected during this run
        };

        this.notifyUpdate();

        // Save initial state to IndexedDB
        this.saveInProgressRun();

        // Scan existing chat messages NOW that we're tracking (key counts message already in chat)
        const scanTimeout = setTimeout(() => this.scanExistingChatMessages(), 100);
        this.timerRegistry.registerTimeout(scanTimeout);
    }

    /**
     * Start tracking a new wave
     * @param {Object} data - new_battle message data
     */
    startWave(data) {
        if (!this.isTracking) {
            return;
        }

        // Update current wave
        this.waveStartTime = new Date(data.combatStartTime);
        this.currentRun.currentWave = data.wave;

        this.notifyUpdate();

        // Save state after each wave start
        this.saveInProgressRun();
    }

    /**
     * Handle action_completed message (wave complete)
     * @param {Object} data - action_completed message data
     */
    onActionCompleted(data) {
        const action = data.endCharacterAction;

        if (!this.isTracking) {
            return;
        }

        // Verify this is a dungeon action
        if (!this.isDungeonAction(action.actionHrid)) {
            return;
        }

        // Ignore non-dungeon combat (zones don't have maxCount or wave field)
        if (action.wave === undefined) {
            return;
        }

        // Set dungeon info if not already set (fallback for mid-dungeon starts)
        if (!this.currentRun.dungeonHrid) {
            this.currentRun.dungeonHrid = action.actionHrid;
            this.currentRun.tier = action.difficultyTier;

            const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(action.actionHrid);
            if (dungeonInfo) {
                this.currentRun.maxWaves = dungeonInfo.maxWaves;
            }

            // Notify update now that we have dungeon name
            this.notifyUpdate();
        }

        // Calculate wave time
        const waveEndTime = Date.now();
        const waveTime = waveEndTime - this.waveStartTime.getTime();
        this.waveTimes.push(waveTime);

        // Update waves completed
        // BUGFIX: Wave 50 completion sends wave: 0, so use currentWave instead
        const actualWaveNumber = action.wave === 0 ? this.currentRun.currentWave : action.wave;
        this.currentRun.wavesCompleted = actualWaveNumber;

        // Save state after wave completion
        this.saveInProgressRun();

        // Check if dungeon is complete
        if (action.isDone) {
            // Check if this was a successful completion (all waves done) or early exit
            const allWavesCompleted =
                this.currentRun.maxWaves && this.currentRun.wavesCompleted >= this.currentRun.maxWaves;

            if (allWavesCompleted) {
                // Successful completion
                this.completeDungeon();
            } else {
                // Early exit (fled, died, or failed)
                this.resetTracking();
            }
        } else {
            this.notifyUpdate();
        }
    }

    /**
     * Complete the current dungeon run
     */
    async completeDungeon() {
        if (!this.currentRun || !this.isTracking) {
            return;
        }

        // Reset tracking immediately to prevent race condition with next dungeon
        this.isTracking = false;

        // Copy all state to local variables IMMEDIATELY so next dungeon can start clean
        const completedRunData = this.currentRun;
        const completedWaveTimes = [...this.waveTimes];
        const completedKeyCountMessages = [...this.keyCountMessages];
        const firstTimestamp = this.firstKeyCountTimestamp;
        const lastTimestamp = this.lastKeyCountTimestamp;

        // Clear ALL state immediately - next dungeon can now start without contamination
        this.currentRun = null;
        this.waveStartTime = null;
        this.waveTimes = [];
        this.firstKeyCountTimestamp = null;
        this.lastKeyCountTimestamp = null;
        this.keyCountMessages = [];
        this.currentBattleId = null;

        // Clear saved in-progress state immediately (before async saves)
        // This prevents race condition where next dungeon saves state, then we clear it
        await this.clearInProgressRun();

        const endTime = Date.now();
        const trackedTotalTime = endTime - completedRunData.startTime;

        // Get server-validated duration from party messages
        const partyMessageDuration = firstTimestamp && lastTimestamp ? lastTimestamp - firstTimestamp : null;
        const validated = partyMessageDuration !== null;

        // Use party message duration if available (authoritative), otherwise use tracked duration
        const totalTime = validated ? partyMessageDuration : trackedTotalTime;

        // Calculate statistics
        const avgWaveTime = completedWaveTimes.reduce((sum, time) => sum + time, 0) / completedWaveTimes.length;
        const fastestWave = Math.min(...completedWaveTimes);
        const slowestWave = Math.max(...completedWaveTimes);

        // Build complete run object
        const completedRun = {
            dungeonHrid: completedRunData.dungeonHrid,
            tier: completedRunData.tier,
            startTime: completedRunData.startTime,
            endTime,
            totalTime, // Authoritative duration (party message or tracked)
            trackedDuration: trackedTotalTime, // Wall-clock tracked duration
            partyMessageDuration, // Server-validated duration (null if solo)
            validated, // true if party messages available
            avgWaveTime,
            fastestWave,
            slowestWave,
            wavesCompleted: completedRunData.wavesCompleted,
            waveTimes: completedWaveTimes,
            keyCountMessages: completedKeyCountMessages, // Store key data for history
            keyCountsMap: completedRunData.keyCountsMap, // Include for backward compatibility
        };

        // Auto-save completed run to history if we have complete data
        // Only saves runs completed during live tracking (Option A)
        if (validated && completedRunData.keyCountsMap && completedRunData.dungeonHrid) {
            try {
                // Extract team from keyCountsMap
                const team = Object.keys(completedRunData.keyCountsMap).sort();
                const teamKey = dungeonTrackerStorage.getTeamKey(team);

                // Get dungeon name from HRID
                const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(completedRunData.dungeonHrid);
                const dungeonName = dungeonInfo ? dungeonInfo.name : 'Unknown';

                // Build run object in unified format
                const runToSave = {
                    timestamp: new Date(firstTimestamp).toISOString(), // Use party message timestamp
                    duration: partyMessageDuration, // Server-validated duration
                    dungeonName: dungeonName,
                    keyCountsMap: completedRunData.keyCountsMap, // Include key counts
                };

                // Save to database (with duplicate detection)
                await dungeonTrackerStorage.saveTeamRun(teamKey, runToSave);
            } catch (error) {
                console.error('[Dungeon Tracker] Failed to auto-save run:', error);
            }
        }

        // Notify completion
        this.notifyCompletion(completedRun);

        this.notifyUpdate();
    }

    /**
     * Format time in milliseconds to MM:SS
     * @param {number} ms - Time in milliseconds
     * @returns {string} Formatted time
     */
    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Reset tracking state (on completion, flee, or death)
     */
    async resetTracking() {
        this.isTracking = false;
        this.currentRun = null;
        this.waveStartTime = null;
        this.waveTimes = [];
        this.pendingDungeonInfo = null;
        this.currentBattleId = null;

        // Clear party message tracking
        this.firstKeyCountTimestamp = null;
        this.lastKeyCountTimestamp = null;
        this.keyCountMessages = [];
        this.battleStartedTimestamp = null;

        // Clear saved state (await to ensure it completes)
        await this.clearInProgressRun();

        this.notifyUpdate();
    }

    /**
     * Get current run state
     * @returns {Object|null} Current run state or null
     */
    getCurrentRun() {
        if (!this.isTracking || !this.currentRun) {
            return null;
        }

        // Calculate current elapsed time
        // Use firstKeyCountTimestamp (server-validated start) if available, otherwise use tracked start time
        const now = Date.now();
        const runStartTime = this.firstKeyCountTimestamp || this.currentRun.startTime;
        const totalElapsed = now - runStartTime;
        const currentWaveElapsed = now - this.waveStartTime.getTime();

        // Calculate average wave time so far
        const avgWaveTime =
            this.waveTimes.length > 0 ? this.waveTimes.reduce((sum, time) => sum + time, 0) / this.waveTimes.length : 0;

        // Calculate ETA
        const remainingWaves = this.currentRun.maxWaves - this.currentRun.wavesCompleted;
        const estimatedTimeRemaining = avgWaveTime > 0 ? avgWaveTime * remainingWaves : 0;

        // Calculate fastest/slowest wave times
        const fastestWave = this.waveTimes.length > 0 ? Math.min(...this.waveTimes) : 0;
        const slowestWave = this.waveTimes.length > 0 ? Math.max(...this.waveTimes) : 0;

        return {
            dungeonHrid: this.currentRun.dungeonHrid,
            dungeonName: this.currentRun.dungeonHrid
                ? dungeonTrackerStorage.getDungeonInfo(this.currentRun.dungeonHrid)?.name
                : 'Unknown',
            tier: this.currentRun.tier,
            currentWave: this.currentRun.currentWave, // Already 1-indexed from new_battle message
            maxWaves: this.currentRun.maxWaves,
            wavesCompleted: this.currentRun.wavesCompleted,
            totalElapsed,
            currentWaveElapsed,
            avgWaveTime,
            fastestWave,
            slowestWave,
            estimatedTimeRemaining,
            keyCountsMap: this.currentRun.keyCountsMap || {}, // Party member key counts
        };
    }

    /**
     * Register a callback for run updates
     * @param {Function} callback - Callback function
     */
    onUpdate(callback) {
        this.updateCallbacks.push(callback);
    }

    /**
     * Unregister a callback for run updates
     * @param {Function} callback - Callback function to remove
     */
    offUpdate(callback) {
        const index = this.updateCallbacks.indexOf(callback);
        if (index > -1) {
            this.updateCallbacks.splice(index, 1);
        }
    }

    /**
     * Notify all registered callbacks of an update
     */
    notifyUpdate() {
        for (const callback of this.updateCallbacks) {
            try {
                callback(this.getCurrentRun());
            } catch (error) {
                console.error('[Dungeon Tracker] Update callback error:', error);
            }
        }
    }

    /**
     * Notify all registered callbacks of completion
     * @param {Object} completedRun - Completed run data
     */
    notifyCompletion(completedRun) {
        for (const callback of this.updateCallbacks) {
            try {
                callback(null, completedRun);
            } catch (error) {
                console.error('[Dungeon Tracker] Completion callback error:', error);
            }
        }
    }

    /**
     * Check if currently tracking a dungeon
     * @returns {boolean} True if tracking
     */
    isTrackingDungeon() {
        return this.isTracking;
    }

    /**
     * Cleanup for character switching
     */
    async cleanup() {
        if (this.handlers.newBattle) {
            webSocketHook.off('new_battle', this.handlers.newBattle);
            this.handlers.newBattle = null;
        }
        if (this.handlers.actionCompleted) {
            webSocketHook.off('action_completed', this.handlers.actionCompleted);
            this.handlers.actionCompleted = null;
        }
        if (this.handlers.actionsUpdated) {
            webSocketHook.off('actions_updated', this.handlers.actionsUpdated);
            this.handlers.actionsUpdated = null;
        }
        if (this.handlers.chatMessage) {
            webSocketHook.off('chat_message_received', this.handlers.chatMessage);
            this.handlers.chatMessage = null;
        }

        // Reset all tracking state
        this.isTracking = false;
        this.currentRun = null;
        this.waveStartTime = null;
        this.waveTimes = [];
        this.pendingDungeonInfo = null;
        this.currentBattleId = null;

        // Clear party message tracking
        this.firstKeyCountTimestamp = null;
        this.lastKeyCountTimestamp = null;
        this.keyCountMessages = [];
        this.battleStartedTimestamp = null;
        this.recentChatMessages = [];

        // Reset hibernation detection
        this.hibernationDetected = false;

        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }

        // Clear character ID
        this.characterId = null;

        // Clear all callbacks
        this.updateCallbacks = [];

        this.timerRegistry.clearAll();

        // Clear saved in-progress run
        await this.clearInProgressRun();

        // Reset initialization flag
        this.isInitialized = false;
    }

    /**
     * Backfill team runs from party chat history
     * Scans all "Key counts:" messages and calculates run durations
     * @returns {Promise<{runsAdded: number, teams: Array<string>}>} Backfill results
     */
    async backfillFromChatHistory() {
        try {
            const messages = document.querySelectorAll('[class^="ChatMessage_chatMessage"]');
            const events = [];

            // Extract all relevant events: key counts, party failed, battle ended, battle started
            for (const msg of messages) {
                const text = msg.textContent || '';

                // FILTER: Skip player messages
                // Check for username element (player messages have a username child element)
                const hasUsername = msg.querySelector('[class*="ChatMessage_username"]') !== null;
                if (hasUsername) {
                    continue; // Skip player messages
                }

                // FALLBACK: Check if text starts with non-timestamp text followed by colon
                if (/^[^[]+:/.test(text)) {
                    continue; // Skip player messages
                }

                // Parse timestamp from message display format: [MM/DD HH:MM:SS AM/PM] or [DD-M HH:MM:SS]
                const timestampMatch = text.match(
                    /\[(\d{1,2})([-/])(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/
                );
                if (!timestampMatch) continue;

                const part1 = parseInt(timestampMatch[1], 10);
                const separator = timestampMatch[2];
                const part2 = parseInt(timestampMatch[3], 10);
                let hour = parseInt(timestampMatch[4], 10);
                const min = parseInt(timestampMatch[5], 10);
                const sec = parseInt(timestampMatch[6], 10);
                const period = timestampMatch[7];

                // Determine format based on separator
                let month, day;
                if (separator === '/') {
                    // MM/DD format
                    month = part1;
                    day = part2;
                } else {
                    // DD-M format (dash separator)
                    day = part1;
                    month = part2;
                }

                // Handle AM/PM if present
                if (period === 'PM' && hour < 12) hour += 12;
                if (period === 'AM' && hour === 12) hour = 0;

                // Create timestamp (assumes current year)
                const now = new Date();
                const timestamp = new Date(now.getFullYear(), month - 1, day, hour, min, sec, 0);

                // Extract "Battle started:" messages
                if (text.includes('Battle started:')) {
                    const dungeonName = text.split('Battle started:')[1]?.split(']')[0]?.trim();
                    if (dungeonName) {
                        events.push({
                            type: 'battle_start',
                            timestamp,
                            dungeonName,
                        });
                    }
                }
                // Extract "Key counts:" messages
                else if (text.includes('Key counts:')) {
                    // Parse team composition from key counts
                    const keyCountsMap = this.parseKeyCountsFromMessage(text);
                    const playerNames = Object.keys(keyCountsMap).sort();

                    if (playerNames.length > 0) {
                        events.push({
                            type: 'key',
                            timestamp,
                            team: playerNames,
                            keyCountsMap,
                        });
                    }
                }
                // Extract "Party failed" messages
                else if (text.match(/Party failed on wave \d+/)) {
                    events.push({
                        type: 'fail',
                        timestamp,
                    });
                }
                // Extract "Battle ended:" messages (fled/canceled)
                else if (text.includes('Battle ended:')) {
                    const dungeonName = text.split('Battle ended:')[1]?.split(']')[0]?.trim();
                    events.push({
                        type: 'cancel',
                        timestamp,
                        dungeonName,
                    });
                }
            }

            // Sort events by timestamp
            events.sort((a, b) => a.timestamp - b.timestamp);

            // Build runs from events - only count key→key pairs (skip key→fail and key→cancel)
            let runsAdded = 0;
            const teamsSet = new Set();

            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                if (event.type !== 'key') continue; // Only process key count events

                const next = events[i + 1];
                if (!next) break; // No next event

                // Only create run if next event is also a key count (successful completion)
                if (next.type === 'key') {
                    // Calculate duration (handle midnight rollover)
                    let duration = next.timestamp - event.timestamp;
                    if (duration < 0) {
                        duration += 24 * 60 * 60 * 1000; // Add 24 hours
                    }

                    // Find nearest battle_ended or battle_start before this run
                    // Prioritize battle_ended (appears right before key count completion)
                    const battleEnded = events
                        .slice(0, i)
                        .reverse()
                        .find((e) => e.type === 'cancel' && e.dungeonName);

                    const battleStart = events
                        .slice(0, i)
                        .reverse()
                        .find((e) => e.type === 'battle_start');

                    // Use battle_ended if available, otherwise fall back to battle_start
                    const dungeonName = battleEnded?.dungeonName || battleStart?.dungeonName || 'Unknown';

                    // Get team key
                    const teamKey = dungeonTrackerStorage.getTeamKey(event.team);
                    teamsSet.add(teamKey);

                    // Save team run with dungeon name
                    const run = {
                        timestamp: event.timestamp.toISOString(),
                        duration: duration,
                        dungeonName: dungeonName,
                    };

                    const saved = await dungeonTrackerStorage.saveTeamRun(teamKey, run);
                    if (saved) {
                        runsAdded++;
                    }
                }
                // If next event is 'fail' or 'cancel', skip this key count (not a completed run)
            }

            return {
                runsAdded,
                teams: Array.from(teamsSet),
            };
        } catch (error) {
            console.error('[Dungeon Tracker] Backfill error:', error);
            return {
                runsAdded: 0,
                teams: [],
            };
        }
    }
}

const dungeonTracker = new DungeonTracker();

export default dungeonTracker;
