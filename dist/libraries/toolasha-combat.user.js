// ==UserScript==
// @name         Toolasha Combat Library
// @namespace    http://tampermonkey.net/
// @version      0.14.3
// @description  Combat library for Toolasha - Combat, abilities, and combat stats features
// @author       Celasha
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js
// ==/UserScript==

(function (config, dataManager, domObserver, webSocketHook, storage, timerRegistry_js, domObserverHelpers_js, marketAPI, formatters_js, profileManager_js, reactInput_js, dom, abilityCostCalculator_js, houseCostCalculator_js, enhancementCalculator_js, marketData_js, enhancementConfig_js) {
    'use strict';

    /**
     * Combat Zone Indices
     * Shows index numbers on combat zone buttons and task cards
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_COMBAT_TASK = /(?:Kill|Defeat)\s*-\s*(.+)$/;

    /**
     * ZoneIndices class manages zone index display on maps and tasks
     */
    class ZoneIndices {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
            this.monsterZoneCache = null; // Cache monster name -> zone index mapping
            this.taskMapIndexEnabled = false;
            this.mapIndexEnabled = false;
            this.isInitialized = false;
        }

        /**
         * Setup setting change listener (always active, even when feature is disabled)
         */
        setupSettingListener() {
            // Listen for feature toggle changes
            config.onSettingChange('taskMapIndex', () => {
                this.taskMapIndexEnabled = config.getSetting('taskMapIndex');
                if (this.taskMapIndexEnabled || this.mapIndexEnabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('mapIndex', () => {
                this.mapIndexEnabled = config.getSetting('mapIndex');
                if (this.taskMapIndexEnabled || this.mapIndexEnabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize zone indices feature
         */
        initialize() {
            // Check if either feature is enabled
            this.taskMapIndexEnabled = config.getSetting('taskMapIndex');
            this.mapIndexEnabled = config.getSetting('mapIndex');

            if (!this.taskMapIndexEnabled && !this.mapIndexEnabled) {
                return;
            }

            if (this.isInitialized) {
                return;
            }

            // Build monster->zone cache once on initialization
            if (this.taskMapIndexEnabled) {
                this.buildMonsterZoneCache();
            }

            // Register with centralized observer with debouncing enabled
            this.unregisterObserver = domObserver.register(
                'ZoneIndices',
                () => {
                    if (this.taskMapIndexEnabled) {
                        this.addTaskIndices();
                    }
                    if (this.mapIndexEnabled) {
                        this.addMapIndices();
                    }
                },
                { debounce: true, debounceDelay: 100 } // Use centralized debouncing
            );

            // Process existing elements
            if (this.taskMapIndexEnabled) {
                this.addTaskIndices();
            }
            if (this.mapIndexEnabled) {
                this.addMapIndices();
            }

            this.isActive = true;
            this.isInitialized = true;
        }

        /**
         * Build a cache of monster names to zone indices
         * Run once on initialization to avoid repeated traversals
         */
        buildMonsterZoneCache() {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return;
            }

            this.monsterZoneCache = new Map();

            for (const action of Object.values(gameData.actionDetailMap)) {
                // Only check combat actions
                if (!action.hrid?.includes('/combat/')) {
                    continue;
                }

                const categoryHrid = action.category;
                if (!categoryHrid) {
                    continue;
                }

                const category = gameData.actionCategoryDetailMap[categoryHrid];
                const zoneIndex = category?.sortIndex;
                if (!zoneIndex) {
                    continue;
                }

                // Cache action name -> zone index
                if (action.name) {
                    this.monsterZoneCache.set(action.name.toLowerCase(), zoneIndex);
                }

                // Cache boss names -> zone index
                if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                    for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                        const bossHrid = boss.combatMonsterHrid;
                        if (bossHrid) {
                            const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                            this.monsterZoneCache.set(bossName.toLowerCase(), zoneIndex);
                        }
                    }
                }
            }
        }

        /**
         * Add zone indices to task cards
         * Shows "Z5" next to monster kill tasks
         */
        addTaskIndices() {
            // Find all task name elements
            const taskNameElements = document.querySelectorAll('div[class*="RandomTask_name"]');

            for (const nameElement of taskNameElements) {
                // Always remove any existing index first (in case task was rerolled)
                const existingIndex = nameElement.querySelector('span.script_taskMapIndex');
                if (existingIndex) {
                    existingIndex.remove();
                }

                const taskText = nameElement.textContent;

                // Check if this is a combat task (contains "Kill" or "Defeat")
                if (!taskText.includes('Kill') && !taskText.includes('Defeat')) {
                    continue; // Not a combat task, skip
                }

                // Extract monster name from task text
                // Format: "Defeat - Jerry" or "Kill - Monster Name"
                const match = taskText.match(REGEX_COMBAT_TASK);
                if (!match) {
                    continue; // Couldn't parse monster name
                }

                const monsterName = match[1].trim();

                // Find the combat action for this monster
                const zoneIndex = this.getZoneIndexForMonster(monsterName);

                if (zoneIndex) {
                    // Add index to the name element
                    nameElement.insertAdjacentHTML(
                        'beforeend',
                        `<span class="script_taskMapIndex" style="margin-left: 4px; color: ${config.SCRIPT_COLOR_MAIN};">Z${zoneIndex}</span>`
                    );
                }
            }
        }

        /**
         * Add sequential indices to combat zone buttons on maps page
         * Shows "1. Zone Name", "2. Zone Name", etc.
         */
        addMapIndices() {
            // Find all combat zone tab buttons
            // Target the vertical tabs in the combat panel
            const buttons = document.querySelectorAll(
                'div.MainPanel_subPanelContainer__1i-H9 div.CombatPanel_tabsComponentContainer__GsQlg div.MuiTabs-root.MuiTabs-vertical button.MuiButtonBase-root.MuiTab-root span.MuiBadge-root'
            );

            if (buttons.length === 0) {
                return;
            }

            let index = 1;
            for (const button of buttons) {
                // Skip if already has index
                if (button.querySelector('span.script_mapIndex')) {
                    continue;
                }

                // Add index at the beginning
                button.insertAdjacentHTML(
                    'afterbegin',
                    `<span class="script_mapIndex" style="color: ${config.SCRIPT_COLOR_MAIN};">${index}. </span>`
                );

                index++;
            }
        }

        /**
         * Get zone index for a monster name
         * @param {string} monsterName - Monster display name
         * @returns {number|null} Zone index or null if not found
         */
        getZoneIndexForMonster(monsterName) {
            // Use cache if available
            if (this.monsterZoneCache) {
                return this.monsterZoneCache.get(monsterName.toLowerCase()) || null;
            }

            // Fallback to direct lookup if cache not built (shouldn't happen)
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return null;
            }

            const normalizedName = monsterName.toLowerCase();

            for (const action of Object.values(gameData.actionDetailMap)) {
                if (!action.hrid?.includes('/combat/')) {
                    continue;
                }

                if (action.name?.toLowerCase() === normalizedName) {
                    const categoryHrid = action.category;
                    if (categoryHrid) {
                        const category = gameData.actionCategoryDetailMap[categoryHrid];
                        if (category?.sortIndex) {
                            return category.sortIndex;
                        }
                    }
                }

                if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                    for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                        const bossHrid = boss.combatMonsterHrid;
                        if (bossHrid) {
                            const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                            if (bossName === normalizedName) {
                                const categoryHrid = action.category;
                                if (categoryHrid) {
                                    const category = gameData.actionCategoryDetailMap[categoryHrid];
                                    if (category?.sortIndex) {
                                        return category.sortIndex;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Refresh colors (called when settings change)
         */
        refresh() {
            // Update all existing zone index spans with new color
            const taskIndices = document.querySelectorAll('span.script_taskMapIndex');
            taskIndices.forEach((span) => {
                span.style.color = config.COLOR_ACCENT;
            });

            const mapIndices = document.querySelectorAll('span.script_mapIndex');
            mapIndices.forEach((span) => {
                span.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all added indices
            const taskIndices = document.querySelectorAll('span.script_taskMapIndex');
            for (const span of taskIndices) {
                span.remove();
            }

            const mapIndices = document.querySelectorAll('span.script_mapIndex');
            for (const span of mapIndices) {
                span.remove();
            }

            // Clear cache
            this.monsterZoneCache = null;
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const zoneIndices = new ZoneIndices();

    zoneIndices.setupSettingListener();

    /**
     * Dungeon Tracker Storage
     * Manages IndexedDB storage for dungeon run history
     */


    const TIERS = [0, 1, 2];

    // Hardcoded max waves for each dungeon (fallback if maxCount is 0)
    const DUNGEON_MAX_WAVES = {
        '/actions/combat/chimerical_den': 50,
        '/actions/combat/sinister_circus': 60,
        '/actions/combat/enchanted_fortress': 65,
        '/actions/combat/pirate_cove': 65,
    };

    class DungeonTrackerStorage {
        constructor() {
            this.unifiedStoreName = 'unifiedRuns'; // Unified storage for all runs
        }

        /**
         * Get dungeon+tier key
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier (0-2)
         * @returns {string} Storage key
         */
        getDungeonKey(dungeonHrid, tier) {
            return `${dungeonHrid}::T${tier}`;
        }

        /**
         * Get dungeon info from game data
         * @param {string} dungeonHrid - Dungeon action HRID
         * @returns {Object|null} Dungeon info or null
         */
        getDungeonInfo(dungeonHrid) {
            const actionDetails = dataManager.getActionDetails(dungeonHrid);
            if (!actionDetails) {
                return null;
            }

            // Extract name from HRID (e.g., "/actions/combat/chimerical_den" -> "Chimerical Den")
            const namePart = dungeonHrid.split('/').pop();
            const name = namePart
                .split('_')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            // Get max waves from nested combatZoneInfo.dungeonInfo.maxWaves
            let maxWaves = actionDetails.combatZoneInfo?.dungeonInfo?.maxWaves || 0;

            // Fallback to hardcoded values if not found in game data
            if (maxWaves === 0 && DUNGEON_MAX_WAVES[dungeonHrid]) {
                maxWaves = DUNGEON_MAX_WAVES[dungeonHrid];
            }

            return {
                name: actionDetails.name || name,
                maxWaves: maxWaves,
            };
        }

        /**
         * Get run history for a dungeon+tier
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @param {number} limit - Max runs to return (0 = all)
         * @returns {Promise<Array>} Run history
         */
        async getRunHistory(dungeonHrid, tier, limit = 0) {
            // Get all runs from unified storage
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);

            // Filter by dungeon HRID and tier
            const runs = allRuns.filter((r) => r.dungeonHrid === dungeonHrid && r.tier === tier);

            if (limit > 0 && runs.length > limit) {
                return runs.slice(0, limit);
            }

            return runs;
        }

        /**
         * Get statistics for a dungeon+tier
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @returns {Promise<Object>} Statistics
         */
        async getStats(dungeonHrid, tier) {
            const runs = await this.getRunHistory(dungeonHrid, tier);

            if (runs.length === 0) {
                return {
                    totalRuns: 0,
                    avgTime: 0,
                    fastestTime: 0,
                    slowestTime: 0,
                    avgWaveTime: 0,
                };
            }

            const totalTime = runs.reduce((sum, run) => sum + run.totalTime, 0);
            const avgTime = totalTime / runs.length;
            const fastestTime = Math.min(...runs.map((r) => r.totalTime));
            const slowestTime = Math.max(...runs.map((r) => r.totalTime));

            const totalAvgWaveTime = runs.reduce((sum, run) => sum + run.avgWaveTime, 0);
            const avgWaveTime = totalAvgWaveTime / runs.length;

            return {
                totalRuns: runs.length,
                avgTime,
                fastestTime,
                slowestTime,
                avgWaveTime,
            };
        }

        /**
         * Get statistics for a dungeon by name (for chat-based runs)
         * @param {string} dungeonName - Dungeon display name
         * @returns {Promise<Object>} Statistics
         */
        async getStatsByName(dungeonName) {
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);
            const runs = allRuns.filter((r) => r.dungeonName === dungeonName);

            if (runs.length === 0) {
                return {
                    totalRuns: 0,
                    avgTime: 0,
                    fastestTime: 0,
                    slowestTime: 0,
                    avgWaveTime: 0,
                };
            }

            // Use 'duration' field (chat-based) or 'totalTime' field (websocket-based)
            const durations = runs.map((r) => r.duration || r.totalTime || 0);
            const totalTime = durations.reduce((sum, d) => sum + d, 0);
            const avgTime = totalTime / runs.length;
            const fastestTime = Math.min(...durations);
            const slowestTime = Math.max(...durations);

            const avgWaveTime = runs.reduce((sum, run) => sum + (run.avgWaveTime || 0), 0) / runs.length;

            return {
                totalRuns: runs.length,
                avgTime,
                fastestTime,
                slowestTime,
                avgWaveTime,
            };
        }

        /**
         * Get last N runs for a dungeon+tier
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @param {number} count - Number of runs to return
         * @returns {Promise<Array>} Last N runs
         */
        async getLastRuns(dungeonHrid, tier, count = 10) {
            return this.getRunHistory(dungeonHrid, tier, count);
        }

        /**
         * Get personal best for a dungeon+tier
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @returns {Promise<Object|null>} Personal best run or null
         */
        async getPersonalBest(dungeonHrid, tier) {
            const runs = await this.getRunHistory(dungeonHrid, tier);

            if (runs.length === 0) {
                return null;
            }

            // Find fastest run
            return runs.reduce((best, run) => {
                if (!best || run.totalTime < best.totalTime) {
                    return run;
                }
                return best;
            }, null);
        }

        /**
         * Delete a specific run from history
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @param {number} runIndex - Index of run to delete (0 = most recent)
         * @returns {Promise<boolean>} Success status
         */
        async deleteRun(dungeonHrid, tier, runIndex) {
            // Get all runs from unified storage
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);

            // Filter to this dungeon+tier
            const dungeonRuns = allRuns.filter((r) => r.dungeonHrid === dungeonHrid && r.tier === tier);

            if (runIndex < 0 || runIndex >= dungeonRuns.length) {
                console.warn('[Dungeon Tracker Storage] Invalid run index:', runIndex);
                return false;
            }

            // Find the run to delete in the full array
            const runToDelete = dungeonRuns[runIndex];
            const indexInAllRuns = allRuns.findIndex(
                (r) =>
                    r.timestamp === runToDelete.timestamp &&
                    r.dungeonHrid === runToDelete.dungeonHrid &&
                    r.tier === runToDelete.tier
            );

            if (indexInAllRuns === -1) {
                console.warn('[Dungeon Tracker Storage] Run not found in unified storage');
                return false;
            }

            // Remove the run
            allRuns.splice(indexInAllRuns, 1);

            // Save updated list
            return storage.setJSON('allRuns', allRuns, this.unifiedStoreName, true);
        }

        /**
         * Delete all run history for a dungeon+tier
         * @param {string} dungeonHrid - Dungeon action HRID
         * @param {number} tier - Difficulty tier
         * @returns {Promise<boolean>} Success status
         */
        async clearHistory(dungeonHrid, tier) {
            // Get all runs from unified storage
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);

            // Filter OUT the runs we want to delete
            const filteredRuns = allRuns.filter((r) => !(r.dungeonHrid === dungeonHrid && r.tier === tier));

            // Save back the filtered list
            return storage.setJSON('allRuns', filteredRuns, this.unifiedStoreName, true);
        }

        /**
         * Get all dungeon+tier combinations with stored data
         * @returns {Promise<Array>} Array of {dungeonHrid, tier, runCount}
         */
        async getAllDungeonStats() {
            const results = [];

            // Get all dungeon actions from game data
            const initData = dataManager.getInitClientData();
            if (!initData?.actionDetailMap) {
                return results;
            }

            // Find all dungeon actions (combat actions with maxCount field)
            const dungeonHrids = Object.entries(initData.actionDetailMap)
                .filter(([hrid, details]) => hrid.startsWith('/actions/combat/') && details.maxCount !== undefined)
                .map(([hrid]) => hrid);

            // Check each dungeon+tier combination
            for (const dungeonHrid of dungeonHrids) {
                for (const tier of TIERS) {
                    const runs = await this.getRunHistory(dungeonHrid, tier);
                    if (runs.length > 0) {
                        const dungeonInfo = this.getDungeonInfo(dungeonHrid);
                        results.push({
                            dungeonHrid,
                            tier,
                            dungeonName: dungeonInfo?.name || 'Unknown',
                            runCount: runs.length,
                        });
                    }
                }
            }

            return results;
        }

        /**
         * Get team key from sorted player names
         * @param {Array<string>} playerNames - Array of player names
         * @returns {string} Team key (sorted, comma-separated)
         */
        getTeamKey(playerNames) {
            return playerNames.sort().join(',');
        }

        /**
         * Save a team-based run (from backfill)
         * @param {string} teamKey - Team key (sorted player names)
         * @param {Object} run - Run data
         * @param {string} run.timestamp - Run start timestamp (ISO string)
         * @param {number} run.duration - Run duration (ms)
         * @param {string} run.dungeonName - Dungeon name (from Phase 2)
         * @returns {Promise<boolean>} Success status
         */
        async saveTeamRun(teamKey, run) {
            // Get all runs from unified storage
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);

            // Parse incoming timestamp
            const newTimestamp = new Date(run.timestamp).getTime();

            // Check for duplicates (same time window, team, and duration)
            const isDuplicate = allRuns.some((r) => {
                const existingTimestamp = new Date(r.timestamp).getTime();
                const timeDiff = Math.abs(existingTimestamp - newTimestamp);
                const durationDiff = Math.abs(r.duration - run.duration);

                // Consider duplicate if:
                // - Within 10 seconds of each other (handles timestamp precision differences)
                // - Same team
                // - Duration within 2 seconds (handles minor timing differences)
                return timeDiff < 10000 && r.teamKey === teamKey && durationDiff < 2000;
            });

            if (!isDuplicate) {
                // Create unified format run
                const team = teamKey.split(',').sort();
                const unifiedRun = {
                    timestamp: run.timestamp,
                    dungeonName: run.dungeonName || 'Unknown',
                    dungeonHrid: null,
                    tier: null,
                    team: team,
                    teamKey: teamKey,
                    duration: run.duration,
                    validated: true,
                    source: 'chat',
                    waveTimes: null,
                    avgWaveTime: null,
                    keyCountsMap: run.keyCountsMap || null, // Include key counts if available
                };

                // Add to front of list (most recent first)
                allRuns.unshift(unifiedRun);

                // Save to unified storage
                await storage.setJSON('allRuns', allRuns, this.unifiedStoreName, true);

                return true;
            }

            return false;
        }

        /**
         * Get all runs (unfiltered)
         * @returns {Promise<Array>} All runs
         */
        async getAllRuns() {
            return storage.getJSON('allRuns', this.unifiedStoreName, []);
        }

        /**
         * Get runs filtered by dungeon and/or team
         * @param {Object} filters - Filter options
         * @param {string} filters.dungeonName - Filter by dungeon name (optional)
         * @param {string} filters.teamKey - Filter by team key (optional)
         * @returns {Promise<Array>} Filtered runs
         */
        async getFilteredRuns(filters = {}) {
            const allRuns = await this.getAllRuns();

            let filtered = allRuns;

            if (filters.dungeonName && filters.dungeonName !== 'all') {
                filtered = filtered.filter((r) => r.dungeonName === filters.dungeonName);
            }

            if (filters.teamKey && filters.teamKey !== 'all') {
                filtered = filtered.filter((r) => r.teamKey === filters.teamKey);
            }

            return filtered;
        }

        /**
         * Get all teams with stored runs
         * @returns {Promise<Array>} Array of {teamKey, runCount, avgTime, bestTime, worstTime}
         */
        async getAllTeamStats() {
            // Get all runs from unified storage
            const allRuns = await storage.getJSON('allRuns', this.unifiedStoreName, []);

            // Group by teamKey
            const teamGroups = {};
            for (const run of allRuns) {
                if (!run.teamKey) continue; // Skip solo runs (no team)

                if (!teamGroups[run.teamKey]) {
                    teamGroups[run.teamKey] = [];
                }
                teamGroups[run.teamKey].push(run);
            }

            // Calculate stats for each team
            const results = [];
            for (const [teamKey, runs] of Object.entries(teamGroups)) {
                const durations = runs.map((r) => r.duration);
                const avgTime = durations.reduce((a, b) => a + b, 0) / durations.length;
                const bestTime = Math.min(...durations);
                const worstTime = Math.max(...durations);

                results.push({
                    teamKey,
                    runCount: runs.length,
                    avgTime,
                    bestTime,
                    worstTime,
                });
            }

            return results;
        }
    }

    const dungeonTrackerStorage = new DungeonTrackerStorage();

    /**
     * Dungeon Tracker Core
     * Tracks dungeon progress in real-time using WebSocket messages
     */


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
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
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
                timestamp - this.firstKeyCountTimestamp;

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
                    timestamp - this.firstKeyCountTimestamp;

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

    /**
     * Dungeon Tracker Chat Annotations
     * Adds colored timer annotations to party chat messages
     * Handles both real-time (new messages) and batch (historical messages) processing
     */


    class DungeonTrackerChatAnnotations {
        constructor() {
            this.enabled = true;
            this.observer = null;
            this.lastSeenDungeonName = null; // Cache last known dungeon name
            this.cumulativeStatsByDungeon = {}; // Persistent cumulative counters for rolling averages
            this.processedMessages = new Map(); // Track processed messages to prevent duplicate counting
            this.initComplete = false; // Flag to ensure storage loads before annotation
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
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
            this.observer = domObserverHelpers_js.createMutationWatcher(
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

    /**
     * Dungeon Tracker UI State Management
     * Handles loading, saving, and managing UI state
     */


    class DungeonTrackerUIState {
        constructor() {
            // Collapse/expand states
            this.isCollapsed = false;
            this.isKeysExpanded = false;
            this.isRunHistoryExpanded = false;
            this.isChartExpanded = true; // Default: expanded

            // Position state
            this.position = null; // { x, y } or null for default

            // Grouping and filtering state
            this.groupBy = 'team'; // 'team' or 'dungeon'
            this.filterDungeon = 'all'; // 'all' or specific dungeon name
            this.filterTeam = 'all'; // 'all' or specific team key

            // Track expanded groups to preserve state across refreshes
            this.expandedGroups = new Set();
        }

        /**
         * Load saved state from storage
         */
        async load() {
            const savedState = await storage.getJSON('dungeonTracker_uiState', 'settings', null);
            if (savedState) {
                this.isCollapsed = savedState.isCollapsed || false;
                this.isKeysExpanded = savedState.isKeysExpanded || false;
                this.isRunHistoryExpanded = savedState.isRunHistoryExpanded || false;
                this.position = savedState.position || null;

                // Load grouping/filtering state
                this.groupBy = savedState.groupBy || 'team';
                this.filterDungeon = savedState.filterDungeon || 'all';
                this.filterTeam = savedState.filterTeam || 'all';
            }
        }

        /**
         * Save current state to storage
         */
        async save() {
            await storage.setJSON(
                'dungeonTracker_uiState',
                {
                    isCollapsed: this.isCollapsed,
                    isKeysExpanded: this.isKeysExpanded,
                    isRunHistoryExpanded: this.isRunHistoryExpanded,
                    position: this.position,
                    groupBy: this.groupBy,
                    filterDungeon: this.filterDungeon,
                    filterTeam: this.filterTeam,
                },
                'settings',
                true
            );
        }

        /**
         * Update container position and styling
         * @param {HTMLElement} container - Container element
         */
        updatePosition(container) {
            const baseStyle = `
            position: fixed;
            z-index: 9999;
            background: rgba(0, 0, 0, 0.85);
            border: 2px solid #4a9eff;
            border-radius: 8px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            if (this.position) {
                // Custom position (user dragged it)
                container.style.cssText = `
                ${baseStyle}
                top: ${this.position.y}px;
                left: ${this.position.x}px;
                min-width: ${this.isCollapsed ? '250px' : '480px'};
            `;
            } else if (this.isCollapsed) {
                // Collapsed: top-left (near action time display)
                container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 10px;
                min-width: 250px;
            `;
            } else {
                // Expanded: top-center
                container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                min-width: 480px;
            `;
            }
        }
    }

    const dungeonTrackerUIState = new DungeonTrackerUIState();

    /**
     * Dungeon Tracker UI Chart Integration
     * Handles Chart.js rendering for dungeon run statistics
     */


    class DungeonTrackerUIChart {
        constructor(state, formatTimeFunc) {
            this.state = state;
            this.formatTime = formatTimeFunc;
            this.chartInstance = null;
        }

        /**
         * Render chart with filtered run data
         * @param {HTMLElement} container - Main container element
         */
        async render(container) {
            const canvas = container.querySelector('#mwi-dt-chart-canvas');
            if (!canvas) return;

            // Get filtered runs based on current filters
            const allRuns = await dungeonTrackerStorage.getAllRuns();
            let filteredRuns = allRuns;

            if (this.state.filterDungeon !== 'all') {
                filteredRuns = filteredRuns.filter((r) => r.dungeonName === this.state.filterDungeon);
            }
            if (this.state.filterTeam !== 'all') {
                filteredRuns = filteredRuns.filter((r) => r.teamKey === this.state.filterTeam);
            }

            if (filteredRuns.length === 0) {
                // Destroy existing chart
                if (this.chartInstance) {
                    this.chartInstance.destroy();
                    this.chartInstance = null;
                }
                return;
            }

            // Sort by timestamp (oldest to newest)
            filteredRuns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // Prepare data
            // Label runs in reverse chronological order to match list (newest = Run 1, oldest = Run N)
            const labels = filteredRuns.map((_, i) => `Run ${filteredRuns.length - i}`);
            const durations = filteredRuns.map((r) => (r.duration || r.totalTime || 0) / 60000); // Convert to minutes

            // Calculate stats
            const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
            const fastestDuration = Math.min(...durations);
            const slowestDuration = Math.max(...durations);

            // Create datasets
            const datasets = [
                {
                    label: 'Run Times',
                    data: durations,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.1,
                    fill: false,
                },
                {
                    label: 'Average',
                    data: new Array(durations.length).fill(avgDuration),
                    borderColor: 'rgb(255, 159, 64)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
                {
                    label: 'Fastest',
                    data: new Array(durations.length).fill(fastestDuration),
                    borderColor: 'rgb(75, 192, 75)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
                {
                    label: 'Slowest',
                    data: new Array(durations.length).fill(slowestDuration),
                    borderColor: 'rgb(255, 99, 132)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
            ];

            // Destroy existing chart
            if (this.chartInstance) {
                this.chartInstance.destroy();
            }

            // Create new chart
            const ctx = canvas.getContext('2d');
            this.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets,
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: '#ccc',
                                usePointStyle: true,
                                padding: 15,
                            },
                            onClick: (e, legendItem, legend) => {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                const meta = ci.getDatasetMeta(index);

                                // Toggle visibility
                                meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                                ci.update();
                            },
                        },
                        title: {
                            display: false,
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    const minutes = Math.floor(value);
                                    const seconds = Math.floor((value - minutes) * 60);
                                    return `${label}: ${minutes}m ${seconds}s`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Run Number',
                                color: '#ccc',
                            },
                            ticks: {
                                color: '#999',
                            },
                            grid: {
                                color: '#333',
                            },
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Duration (minutes)',
                                color: '#ccc',
                            },
                            ticks: {
                                color: '#999',
                            },
                            grid: {
                                color: '#333',
                            },
                            beginAtZero: false,
                        },
                    },
                },
            });
        }

        /**
         * Create pop-out modal with larger chart
         */
        createPopoutModal() {
            // Remove existing modal if any
            const existingModal = document.getElementById('mwi-dt-chart-modal');
            if (existingModal) {
                existingModal.remove();
            }

            // Create modal container
            const modal = document.createElement('div');
            modal.id = 'mwi-dt-chart-modal';
            modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 1200px;
            height: 80%;
            max-height: 700px;
            background: #1a1a1a;
            border: 2px solid #555;
            border-radius: 8px;
            padding: 20px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
        `;

            // Create header with close button
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        `;

            const title = document.createElement('h3');
            title.textContent = '📊 Dungeon Run Chart';
            title.style.cssText = 'color: #ccc; margin: 0; font-size: 18px;';

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `
            background: #a33;
            color: #fff;
            border: none;
            cursor: pointer;
            font-size: 20px;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: bold;
        `;
            closeBtn.addEventListener('click', () => modal.remove());

            header.appendChild(title);
            header.appendChild(closeBtn);

            // Create canvas container
            const canvasContainer = document.createElement('div');
            canvasContainer.style.cssText = `
            flex: 1;
            position: relative;
            min-height: 0;
        `;

            const canvas = document.createElement('canvas');
            canvas.id = 'mwi-dt-chart-modal-canvas';
            canvasContainer.appendChild(canvas);

            modal.appendChild(header);
            modal.appendChild(canvasContainer);
            document.body.appendChild(modal);

            // Render chart in modal
            this.renderModalChart(canvas);

            // Close on ESC key
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        }

        /**
         * Render chart in pop-out modal
         * @param {HTMLElement} canvas - Canvas element
         */
        async renderModalChart(canvas) {
            // Get filtered runs (same as main chart)
            const allRuns = await dungeonTrackerStorage.getAllRuns();
            let filteredRuns = allRuns;

            if (this.state.filterDungeon !== 'all') {
                filteredRuns = filteredRuns.filter((r) => r.dungeonName === this.state.filterDungeon);
            }
            if (this.state.filterTeam !== 'all') {
                filteredRuns = filteredRuns.filter((r) => r.teamKey === this.state.filterTeam);
            }

            if (filteredRuns.length === 0) return;

            // Sort by timestamp
            filteredRuns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // Prepare data (same as main chart)
            // Label runs in reverse chronological order to match list (newest = Run 1, oldest = Run N)
            const labels = filteredRuns.map((_, i) => `Run ${filteredRuns.length - i}`);
            const durations = filteredRuns.map((r) => (r.duration || r.totalTime || 0) / 60000);

            const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
            const fastestDuration = Math.min(...durations);
            const slowestDuration = Math.max(...durations);

            const datasets = [
                {
                    label: 'Run Times',
                    data: durations,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.1,
                    fill: false,
                },
                {
                    label: 'Average',
                    data: new Array(durations.length).fill(avgDuration),
                    borderColor: 'rgb(255, 159, 64)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
                {
                    label: 'Fastest',
                    data: new Array(durations.length).fill(fastestDuration),
                    borderColor: 'rgb(75, 192, 75)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
                {
                    label: 'Slowest',
                    data: new Array(durations.length).fill(slowestDuration),
                    borderColor: 'rgb(255, 99, 132)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
            ];

            // Create chart
            const ctx = canvas.getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets,
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: '#ccc',
                                usePointStyle: true,
                                padding: 15,
                                font: {
                                    size: 14,
                                },
                            },
                            onClick: (e, legendItem, legend) => {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                const meta = ci.getDatasetMeta(index);

                                meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                                ci.update();
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    const minutes = Math.floor(value);
                                    const seconds = Math.floor((value - minutes) * 60);
                                    return `${label}: ${minutes}m ${seconds}s`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Run Number',
                                color: '#ccc',
                                font: {
                                    size: 14,
                                },
                            },
                            ticks: {
                                color: '#999',
                            },
                            grid: {
                                color: '#333',
                            },
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Duration (minutes)',
                                color: '#ccc',
                                font: {
                                    size: 14,
                                },
                            },
                            ticks: {
                                color: '#999',
                            },
                            grid: {
                                color: '#333',
                            },
                            beginAtZero: false,
                        },
                    },
                },
            });
        }
    }

    /**
     * Dungeon Tracker UI Run History Display
     * Handles grouping, filtering, and rendering of run history
     */


    class DungeonTrackerUIHistory {
        constructor(state, formatTimeFunc) {
            this.state = state;
            this.formatTime = formatTimeFunc;
        }

        /**
         * Group runs by team
         * @param {Array} runs - Array of runs
         * @returns {Array} Grouped runs with stats
         */
        groupByTeam(runs) {
            const groups = {};

            for (const run of runs) {
                const key = run.teamKey || 'Solo';
                if (!groups[key]) {
                    groups[key] = {
                        key: key,
                        label: key === 'Solo' ? 'Solo Runs' : key,
                        runs: [],
                    };
                }
                groups[key].runs.push(run);
            }

            // Convert to array and calculate stats
            return Object.values(groups).map((group) => ({
                ...group,
                stats: this.calculateStatsForRuns(group.runs),
            }));
        }

        /**
         * Group runs by dungeon
         * @param {Array} runs - Array of runs
         * @returns {Array} Grouped runs with stats
         */
        groupByDungeon(runs) {
            const groups = {};

            for (const run of runs) {
                const key = run.dungeonName || 'Unknown';
                if (!groups[key]) {
                    groups[key] = {
                        key: key,
                        label: key,
                        runs: [],
                    };
                }
                groups[key].runs.push(run);
            }

            // Convert to array and calculate stats
            return Object.values(groups).map((group) => ({
                ...group,
                stats: this.calculateStatsForRuns(group.runs),
            }));
        }

        /**
         * Calculate stats for a set of runs
         * @param {Array} runs - Array of runs
         * @returns {Object} Stats object
         */
        calculateStatsForRuns(runs) {
            if (!runs || runs.length === 0) {
                return {
                    totalRuns: 0,
                    avgTime: 0,
                    fastestTime: 0,
                    slowestTime: 0,
                };
            }

            const durations = runs.map((r) => r.duration);
            const total = durations.reduce((sum, d) => sum + d, 0);

            return {
                totalRuns: runs.length,
                avgTime: Math.floor(total / runs.length),
                fastestTime: Math.min(...durations),
                slowestTime: Math.max(...durations),
            };
        }

        /**
         * Update run history display with grouping and filtering
         * @param {HTMLElement} container - Main container element
         */
        async update(container) {
            const runList = container.querySelector('#mwi-dt-run-list');
            if (!runList) return;

            try {
                // Get all runs from unified storage
                const allRuns = await dungeonTrackerStorage.getAllRuns();

                if (allRuns.length === 0) {
                    runList.innerHTML =
                        '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs yet</div>';
                    // Update filter dropdowns with empty options
                    this.updateFilterDropdowns(container, [], []);
                    return;
                }

                // Apply filters
                let filteredRuns = allRuns;
                if (this.state.filterDungeon !== 'all') {
                    filteredRuns = filteredRuns.filter((r) => r.dungeonName === this.state.filterDungeon);
                }
                if (this.state.filterTeam !== 'all') {
                    filteredRuns = filteredRuns.filter((r) => r.teamKey === this.state.filterTeam);
                }

                if (filteredRuns.length === 0) {
                    runList.innerHTML =
                        '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs match filters</div>';
                    return;
                }

                // Group runs
                const groups =
                    this.state.groupBy === 'team' ? this.groupByTeam(filteredRuns) : this.groupByDungeon(filteredRuns);

                // Render grouped runs
                this.renderGroupedRuns(runList, groups);

                // Update filter dropdowns
                const dungeons = [...new Set(allRuns.map((r) => r.dungeonName).filter(Boolean))].sort();
                const teams = [...new Set(allRuns.map((r) => r.teamKey).filter(Boolean))].sort();
                this.updateFilterDropdowns(container, dungeons, teams);
            } catch (error) {
                console.error('[Dungeon Tracker UI History] Update error:', error);
                runList.innerHTML =
                    '<div style="color: #ff6b6b; text-align: center; padding: 8px;">Error loading run history</div>';
            }
        }

        /**
         * Update filter dropdown options
         * @param {HTMLElement} container - Main container element
         * @param {Array} dungeons - List of dungeon names
         * @param {Array} teams - List of team keys
         */
        updateFilterDropdowns(container, dungeons, teams) {
            // Update dungeon filter
            const dungeonFilter = container.querySelector('#mwi-dt-filter-dungeon');
            if (dungeonFilter) {
                const currentValue = dungeonFilter.value;
                dungeonFilter.innerHTML = '<option value="all">All Dungeons</option>';
                for (const dungeon of dungeons) {
                    dungeonFilter.innerHTML += `<option value="${dungeon}">${dungeon}</option>`;
                }
                // Restore selection if still valid
                if (dungeons.includes(currentValue)) {
                    dungeonFilter.value = currentValue;
                } else {
                    this.state.filterDungeon = 'all';
                }
            }

            // Update team filter
            const teamFilter = container.querySelector('#mwi-dt-filter-team');
            if (teamFilter) {
                const currentValue = teamFilter.value;
                teamFilter.innerHTML = '<option value="all">All Teams</option>';
                for (const team of teams) {
                    teamFilter.innerHTML += `<option value="${team}">${team}</option>`;
                }
                // Restore selection if still valid
                if (teams.includes(currentValue)) {
                    teamFilter.value = currentValue;
                } else {
                    this.state.filterTeam = 'all';
                }
            }
        }

        /**
         * Render grouped runs
         * @param {HTMLElement} runList - Run list container
         * @param {Array} groups - Grouped runs with stats
         */
        renderGroupedRuns(runList, groups) {
            let html = '';

            for (const group of groups) {
                const avgTime = this.formatTime(group.stats.avgTime);
                const bestTime = this.formatTime(group.stats.fastestTime);
                const worstTime = this.formatTime(group.stats.slowestTime);

                // Check if this group is expanded
                const isExpanded = this.state.expandedGroups.has(group.label);
                const displayStyle = isExpanded ? 'block' : 'none';
                const toggleIcon = isExpanded ? '▲' : '▼';

                html += `
                <div class="mwi-dt-group" style="
                    margin-bottom: 8px;
                    border: 1px solid #444;
                    border-radius: 4px;
                    padding: 8px;
                ">
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 6px;
                        cursor: pointer;
                    " class="mwi-dt-group-header" data-group-label="${group.label}">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; color: #4a9eff; margin-bottom: 2px;">
                                ${group.label}
                            </div>
                            <div style="font-size: 10px; color: #aaa;">
                                Runs: ${group.stats.totalRuns} | Avg: ${avgTime} | Best: ${bestTime} | Worst: ${worstTime}
                            </div>
                        </div>
                        <span class="mwi-dt-group-toggle" style="color: #aaa; font-size: 10px;">${toggleIcon}</span>
                    </div>
                    <div class="mwi-dt-group-runs" style="
                        display: ${displayStyle};
                        border-top: 1px solid #444;
                        padding-top: 6px;
                        margin-top: 4px;
                    ">
                        ${this.renderRunList(group.runs)}
                    </div>
                </div>
            `;
            }

            runList.innerHTML = html;

            // Attach toggle handlers
            runList.querySelectorAll('.mwi-dt-group-header').forEach((header) => {
                header.addEventListener('click', () => {
                    const groupLabel = header.dataset.groupLabel;
                    const runsDiv = header.nextElementSibling;
                    const toggle = header.querySelector('.mwi-dt-group-toggle');

                    if (runsDiv.style.display === 'none') {
                        runsDiv.style.display = 'block';
                        toggle.textContent = '▲';
                        this.state.expandedGroups.add(groupLabel);
                    } else {
                        runsDiv.style.display = 'none';
                        toggle.textContent = '▼';
                        this.state.expandedGroups.delete(groupLabel);
                    }
                });
            });

            // Attach delete handlers
            runList.querySelectorAll('.mwi-dt-delete-run').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    const runTimestamp = e.target.closest('[data-run-timestamp]').dataset.runTimestamp;

                    // Find and delete the run from unified storage
                    const allRuns = await dungeonTrackerStorage.getAllRuns();
                    const filteredRuns = allRuns.filter((r) => r.timestamp !== runTimestamp);
                    await storage.setJSON('allRuns', filteredRuns, 'unifiedRuns', true);

                    // Trigger refresh via callback
                    if (this.onDeleteCallback) {
                        this.onDeleteCallback();
                    }
                });
            });
        }

        /**
         * Render individual run list
         * @param {Array} runs - Array of runs
         * @returns {string} HTML for run list
         */
        renderRunList(runs) {
            let html = '';
            runs.forEach((run, index) => {
                const runNumber = runs.length - index;
                const timeStr = this.formatTime(run.duration);
                const dateObj = new Date(run.timestamp);
                const dateTime = dateObj.toLocaleString();
                const dungeonLabel = run.dungeonName || 'Unknown';

                html += `
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 4px 0;
                    border-bottom: 1px solid #333;
                    font-size: 10px;
                " data-run-timestamp="${run.timestamp}">
                    <span style="color: #aaa; min-width: 25px;">#${runNumber}</span>
                    <span style="color: #fff; flex: 1; text-align: center;">
                        ${timeStr} <span style="color: #888; font-size: 9px;">(${dateTime})</span>
                    </span>
                    <span style="color: #888; margin-right: 6px; font-size: 9px;">${dungeonLabel}</span>
                    <button class="mwi-dt-delete-run" style="
                        background: none;
                        border: 1px solid #ff6b6b;
                        color: #ff6b6b;
                        cursor: pointer;
                        font-size: 9px;
                        padding: 1px 4px;
                        border-radius: 2px;
                        font-weight: bold;
                    " title="Delete this run">✕</button>
                </div>
            `;
            });
            return html;
        }

        /**
         * Set callback for when a run is deleted
         * @param {Function} callback - Callback function
         */
        onDelete(callback) {
            this.onDeleteCallback = callback;
        }
    }

    /**
     * Dungeon Tracker UI Interactions
     * Handles all user interactions: dragging, toggles, button clicks
     */


    class DungeonTrackerUIInteractions {
        constructor(state, chartRef, historyRef) {
            this.state = state;
            this.chart = chartRef;
            this.history = historyRef;
            this.isDragging = false;
            this.dragOffset = { x: 0, y: 0 };
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup all interactions
         * @param {HTMLElement} container - Main container element
         * @param {Object} callbacks - Callback functions {onUpdate, onUpdateChart, onUpdateHistory}
         */
        setupAll(container, callbacks) {
            this.container = container;
            this.callbacks = callbacks;

            this.setupDragging();
            this.setupCollapseButton();
            this.setupKeysToggle();
            this.setupRunHistoryToggle();
            this.setupGroupingControls();
            this.setupBackfillButton();
            this.setupClearAll();
            this.setupChartToggle();
            this.setupChartPopout();
            this.setupKeyboardShortcut();
        }

        /**
         * Setup dragging functionality
         */
        setupDragging() {
            const header = this.container.querySelector('#mwi-dt-header');
            if (!header) return;

            header.addEventListener('mousedown', (e) => {
                // Don't drag if clicking collapse button
                if (e.target.id === 'mwi-dt-collapse-btn') return;

                this.isDragging = true;
                const rect = this.container.getBoundingClientRect();
                this.dragOffset = {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                };
                header.style.cursor = 'grabbing';
            });

            document.addEventListener('mousemove', (e) => {
                if (!this.isDragging) return;

                let x = e.clientX - this.dragOffset.x;
                let y = e.clientY - this.dragOffset.y;

                // Apply position boundaries to keep tracker visible
                const containerRect = this.container.getBoundingClientRect();
                const minVisiblePx = 100; // Keep at least 100px visible

                // Constrain Y: header must be visible at top
                y = Math.max(0, y);
                y = Math.min(y, window.innerHeight - minVisiblePx);

                // Constrain X: keep at least 100px visible on either edge
                x = Math.max(-containerRect.width + minVisiblePx, x);
                x = Math.min(x, window.innerWidth - minVisiblePx);

                // Save position (disables default centering)
                this.state.position = { x, y };

                // Apply position
                this.container.style.left = `${x}px`;
                this.container.style.top = `${y}px`;
                this.container.style.transform = 'none'; // Disable centering transform
            });

            document.addEventListener('mouseup', () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    const header = this.container.querySelector('#mwi-dt-header');
                    if (header) header.style.cursor = 'move';
                    this.state.save();
                }
            });
        }

        /**
         * Setup collapse button
         */
        setupCollapseButton() {
            const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');
            if (!collapseBtn) return;

            collapseBtn.addEventListener('click', () => {
                this.toggleCollapse();
            });
        }

        /**
         * Setup keys toggle
         */
        setupKeysToggle() {
            const keysHeader = this.container.querySelector('#mwi-dt-keys-header');
            if (!keysHeader) return;

            keysHeader.addEventListener('click', () => {
                this.toggleKeys();
            });
        }

        /**
         * Setup run history toggle
         */
        setupRunHistoryToggle() {
            const runHistoryHeader = this.container.querySelector('#mwi-dt-run-history-header');
            if (!runHistoryHeader) return;

            runHistoryHeader.addEventListener('click', (e) => {
                // Don't toggle if clicking the clear or backfill buttons
                if (e.target.id === 'mwi-dt-clear-all' || e.target.closest('#mwi-dt-clear-all')) return;
                if (e.target.id === 'mwi-dt-backfill-btn' || e.target.closest('#mwi-dt-backfill-btn')) return;
                this.toggleRunHistory();
            });
        }

        /**
         * Setup grouping and filtering controls
         */
        setupGroupingControls() {
            // Group by dropdown
            const groupBySelect = this.container.querySelector('#mwi-dt-group-by');
            if (groupBySelect) {
                groupBySelect.value = this.state.groupBy;
                groupBySelect.addEventListener('change', (e) => {
                    this.state.groupBy = e.target.value;
                    this.state.save();
                    // Clear expanded groups when grouping changes (different group labels)
                    this.state.expandedGroups.clear();
                    if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                    if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
                });
            }

            // Filter dungeon dropdown
            const filterDungeonSelect = this.container.querySelector('#mwi-dt-filter-dungeon');
            if (filterDungeonSelect) {
                filterDungeonSelect.addEventListener('change', (e) => {
                    this.state.filterDungeon = e.target.value;
                    this.state.save();
                    if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                    if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
                });
            }

            // Filter team dropdown
            const filterTeamSelect = this.container.querySelector('#mwi-dt-filter-team');
            if (filterTeamSelect) {
                filterTeamSelect.addEventListener('change', (e) => {
                    this.state.filterTeam = e.target.value;
                    this.state.save();
                    if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                    if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
                });
            }
        }

        /**
         * Setup clear all button
         */
        setupClearAll() {
            const clearBtn = this.container.querySelector('#mwi-dt-clear-all');
            if (!clearBtn) return;

            clearBtn.addEventListener('click', async () => {
                if (confirm('Delete ALL run history data?\n\nThis cannot be undone!')) {
                    try {
                        // Clear unified storage completely
                        await storage.setJSON('allRuns', [], 'unifiedRuns', true);
                        alert('All run history cleared.');

                        // Refresh both history and chart display
                        if (this.callbacks.onUpdateHistory) await this.callbacks.onUpdateHistory();
                        if (this.callbacks.onUpdateChart) await this.callbacks.onUpdateChart();
                    } catch (error) {
                        console.error('[Dungeon Tracker UI Interactions] Clear all history error:', error);
                        alert('Failed to clear run history. Check console for details.');
                    }
                }
            });
        }

        /**
         * Setup chart toggle
         */
        setupChartToggle() {
            const chartHeader = this.container.querySelector('#mwi-dt-chart-header');
            if (!chartHeader) return;

            chartHeader.addEventListener('click', (e) => {
                // Don't toggle if clicking the pop-out button
                if (e.target.closest('#mwi-dt-chart-popout-btn')) return;

                this.toggleChart();
            });
        }

        /**
         * Setup chart pop-out button
         */
        setupChartPopout() {
            const popoutBtn = this.container.querySelector('#mwi-dt-chart-popout-btn');
            if (!popoutBtn) return;

            popoutBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent toggle
                this.chart.createPopoutModal();
            });
        }

        /**
         * Setup backfill button
         */
        setupBackfillButton() {
            const backfillBtn = this.container.querySelector('#mwi-dt-backfill-btn');
            if (!backfillBtn) return;

            backfillBtn.addEventListener('click', async () => {
                // Change button text to show loading
                backfillBtn.textContent = '⟳ Processing...';
                backfillBtn.disabled = true;

                try {
                    // Run backfill
                    const result = await dungeonTracker.backfillFromChatHistory();

                    // Show result message
                    if (result.runsAdded > 0) {
                        alert(`Backfill complete!\n\nRuns added: ${result.runsAdded}\nTeams: ${result.teams.length}`);
                    } else {
                        alert('No new runs found to backfill.');
                    }

                    // Refresh both history and chart display
                    if (this.callbacks.onUpdateHistory) await this.callbacks.onUpdateHistory();
                    if (this.callbacks.onUpdateChart) await this.callbacks.onUpdateChart();
                } catch (error) {
                    console.error('[Dungeon Tracker UI Interactions] Backfill error:', error);
                    alert('Backfill failed. Check console for details.');
                } finally {
                    // Reset button
                    backfillBtn.textContent = '⟳ Backfill';
                    backfillBtn.disabled = false;
                }
            });
        }

        /**
         * Toggle collapse state
         */
        toggleCollapse() {
            this.state.isCollapsed = !this.state.isCollapsed;

            if (this.state.isCollapsed) {
                this.applyCollapsedState();
            } else {
                this.applyExpandedState();
            }

            // If no custom position, update to new default position
            if (!this.state.position) {
                this.state.updatePosition(this.container);
            } else {
                // Just update width for custom positions
                this.container.style.minWidth = this.state.isCollapsed ? '250px' : '480px';
            }

            this.state.save();
        }

        /**
         * Apply collapsed state appearance
         */
        applyCollapsedState() {
            const content = this.container.querySelector('#mwi-dt-content');
            const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');

            if (content) content.style.display = 'none';
            if (collapseBtn) collapseBtn.textContent = '▲';
        }

        /**
         * Apply expanded state appearance
         */
        applyExpandedState() {
            const content = this.container.querySelector('#mwi-dt-content');
            const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');

            if (content) content.style.display = 'flex';
            if (collapseBtn) collapseBtn.textContent = '▼';
        }

        /**
         * Toggle keys expanded state
         */
        toggleKeys() {
            this.state.isKeysExpanded = !this.state.isKeysExpanded;

            if (this.state.isKeysExpanded) {
                this.applyKeysExpandedState();
            } else {
                this.applyKeysCollapsedState();
            }

            this.state.save();
        }

        /**
         * Apply keys expanded state
         */
        applyKeysExpandedState() {
            const keysList = this.container.querySelector('#mwi-dt-keys-list');
            const keysToggle = this.container.querySelector('#mwi-dt-keys-toggle');

            if (keysList) keysList.style.display = 'block';
            if (keysToggle) keysToggle.textContent = '▲';
        }

        /**
         * Apply keys collapsed state
         */
        applyKeysCollapsedState() {
            const keysList = this.container.querySelector('#mwi-dt-keys-list');
            const keysToggle = this.container.querySelector('#mwi-dt-keys-toggle');

            if (keysList) keysList.style.display = 'none';
            if (keysToggle) keysToggle.textContent = '▼';
        }

        /**
         * Toggle run history expanded state
         */
        toggleRunHistory() {
            this.state.isRunHistoryExpanded = !this.state.isRunHistoryExpanded;

            if (this.state.isRunHistoryExpanded) {
                this.applyRunHistoryExpandedState();
            } else {
                this.applyRunHistoryCollapsedState();
            }

            this.state.save();
        }

        /**
         * Apply run history expanded state
         */
        applyRunHistoryExpandedState() {
            const runList = this.container.querySelector('#mwi-dt-run-list');
            const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');
            const controls = this.container.querySelector('#mwi-dt-controls');

            if (runList) runList.style.display = 'block';
            if (runHistoryToggle) runHistoryToggle.textContent = '▲';
            if (controls) controls.style.display = 'block';
        }

        /**
         * Apply run history collapsed state
         */
        applyRunHistoryCollapsedState() {
            const runList = this.container.querySelector('#mwi-dt-run-list');
            const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');
            const controls = this.container.querySelector('#mwi-dt-controls');

            if (runList) runList.style.display = 'none';
            if (runHistoryToggle) runHistoryToggle.textContent = '▼';
            if (controls) controls.style.display = 'none';
        }

        /**
         * Toggle chart expanded/collapsed
         */
        toggleChart() {
            this.state.isChartExpanded = !this.state.isChartExpanded;

            if (this.state.isChartExpanded) {
                this.applyChartExpandedState();
            } else {
                this.applyChartCollapsedState();
            }

            this.state.save();
        }

        /**
         * Apply chart expanded state
         */
        applyChartExpandedState() {
            const chartContainer = this.container.querySelector('#mwi-dt-chart-container');
            const toggle = this.container.querySelector('#mwi-dt-chart-toggle');

            if (chartContainer) {
                chartContainer.style.display = 'block';
                // Render chart after becoming visible (longer delay for initial page load)
                if (this.callbacks.onUpdateChart) {
                    const chartTimeout = setTimeout(() => this.callbacks.onUpdateChart(), 300);
                    this.timerRegistry.registerTimeout(chartTimeout);
                }
            }
            if (toggle) toggle.textContent = '▼';
        }

        /**
         * Apply chart collapsed state
         */
        applyChartCollapsedState() {
            const chartContainer = this.container.querySelector('#mwi-dt-chart-container');
            const toggle = this.container.querySelector('#mwi-dt-chart-toggle');

            if (chartContainer) chartContainer.style.display = 'none';
            if (toggle) toggle.textContent = '▶';
        }

        /**
         * Apply initial states
         */
        applyInitialStates() {
            // Apply initial collapsed state
            if (this.state.isCollapsed) {
                this.applyCollapsedState();
            }

            // Apply initial keys expanded state
            if (this.state.isKeysExpanded) {
                this.applyKeysExpandedState();
            }

            // Apply initial run history expanded state
            if (this.state.isRunHistoryExpanded) {
                this.applyRunHistoryExpandedState();
            }

            // Apply initial chart expanded state
            if (this.state.isChartExpanded) {
                this.applyChartExpandedState();
            }
        }

        /**
         * Setup keyboard shortcut for resetting position
         * Ctrl+Shift+D to reset dungeon tracker to default position
         */
        setupKeyboardShortcut() {
            document.addEventListener('keydown', (e) => {
                // Ctrl+Shift+D - Reset dungeon tracker position
                if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                    e.preventDefault();
                    this.resetPosition();
                }
            });
        }

        /**
         * Reset dungeon tracker position to default (center)
         */
        resetPosition() {
            // Clear saved position (re-enables default centering)
            this.state.position = null;

            // Re-apply position styling
            this.state.updatePosition(this.container);

            // Save updated state
            this.state.save();

            // Show brief notification
            this.showNotification('Dungeon Tracker position reset');
        }

        /**
         * Show temporary notification message
         * @param {string} message - Notification text
         */
        showNotification(message) {
            const notification = document.createElement('div');
            notification.textContent = message;
            notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(74, 158, 255, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            font-family: 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 99999;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            pointer-events: none;
        `;

            document.body.appendChild(notification);

            // Fade out and remove after 2 seconds
            const removeTimeout = setTimeout(() => {
                notification.style.transition = 'opacity 0.3s ease';
                notification.style.opacity = '0';
                const cleanupTimeout = setTimeout(() => notification.remove(), 300);
                this.timerRegistry.registerTimeout(cleanupTimeout);
            }, 2000);
            this.timerRegistry.registerTimeout(removeTimeout);
        }

        cleanup() {
            this.timerRegistry.clearAll();
        }
    }

    /**
     * Dungeon Tracker UI Core
     * Main orchestrator for dungeon tracker UI display
     * Coordinates state, chart, history, and interaction modules
     */


    class DungeonTrackerUI {
        constructor() {
            this.container = null;
            this.updateInterval = null;
            this.isInitialized = false; // Guard against multiple initializations
            this.timerRegistry = timerRegistry_js.createTimerRegistry();

            // Module references (initialized in initialize())
            this.state = dungeonTrackerUIState;
            this.chart = null;
            this.history = null;
            this.interactions = null;

            // Callback references for cleanup
            this.dungeonUpdateHandler = null;
            this.characterSwitchingHandler = null;
            this.characterSelectObserver = null;
        }

        /**
         * Initialize UI
         */
        async initialize() {
            // Prevent multiple initializations (memory leak protection)
            if (this.isInitialized) {
                console.warn('[Toolasha Dungeon Tracker UI] Already initialized, skipping duplicate initialization');
                return;
            }
            this.isInitialized = true;

            // Load saved state
            await this.state.load();

            // Initialize modules with formatTime function
            this.chart = new DungeonTrackerUIChart(this.state, this.formatTime.bind(this));
            this.history = new DungeonTrackerUIHistory(this.state, this.formatTime.bind(this));
            this.interactions = new DungeonTrackerUIInteractions(this.state, this.chart, this.history);

            // Set up history delete callback
            this.history.onDelete(() => this.updateRunHistory());

            // Create UI elements
            this.createUI();

            // Hide UI initially - only show when dungeon is active
            this.hide();

            // Store callback reference for cleanup
            this.dungeonUpdateHandler = (currentRun, completedRun) => {
                // Check if UI is enabled
                if (!config.isFeatureEnabled('dungeonTrackerUI')) {
                    this.hide();
                    return;
                }

                if (completedRun) {
                    // Dungeon completed - trigger chat annotation update and hide UI
                    const annotateTimeout = setTimeout(() => dungeonTrackerChatAnnotations.annotateAllMessages(), 200);
                    this.timerRegistry.registerTimeout(annotateTimeout);
                    this.hide();
                } else if (currentRun) {
                    // Dungeon in progress
                    this.show();
                    this.update(currentRun);
                } else {
                    // No active dungeon
                    this.hide();
                }
            };

            // Register for dungeon tracker updates
            dungeonTracker.onUpdate(this.dungeonUpdateHandler);

            // Start update loop (updates current wave time every second)
            this.startUpdateLoop();

            // Store listener reference for cleanup
            this.characterSwitchingHandler = () => {
                this.cleanup();
            };

            dataManager.on('character_switching', this.characterSwitchingHandler);

            // Watch for character selection screen appearing (when user clicks "Switch Character")
            if (document.body) {
                this.characterSelectObserver = domObserverHelpers_js.createMutationWatcher(
                    document.body,
                    () => {
                        // Check if character selection screen is visible
                        const headings = document.querySelectorAll('h1, h2, h3');
                        for (const heading of headings) {
                            if (heading.textContent?.includes('Select Character')) {
                                this.hide();
                                break;
                            }
                        }
                    },
                    {
                        childList: true,
                        subtree: true,
                    }
                );
            }
        }

        /**
         * Create UI elements
         */
        createUI() {
            // Create container
            this.container = document.createElement('div');
            this.container.id = 'mwi-dungeon-tracker';

            // Apply saved position or default
            this.state.updatePosition(this.container);

            // Add HTML structure
            this.container.innerHTML = `
            <div id="mwi-dt-header" style="
                background: #2d3748;
                border-radius: 6px 6px 0 0;
                cursor: move;
                user-select: none;
            ">
                <!-- Header Line 1: Dungeon Name + Current Time + Wave -->
                <div style="
                    display: flex;
                    align-items: center;
                    padding: 6px 10px;
                ">
                    <div style="flex: 1;">
                        <span id="mwi-dt-dungeon-name" style="font-weight: bold; font-size: 14px; color: #4a9eff;">
                            Loading...
                        </span>
                    </div>
                    <div style="flex: 0; padding: 0 10px; white-space: nowrap;">
                        <span id="mwi-dt-time-label" style="font-size: 12px; color: #aaa;" title="Time since dungeon started">Elapsed: </span>
                        <span id="mwi-dt-current-time" style="font-size: 13px; color: #fff; font-weight: bold;">
                            00:00
                        </span>
                    </div>
                    <div style="flex: 1; display: flex; gap: 8px; align-items: center; justify-content: flex-end;">
                        <span id="mwi-dt-wave-counter" style="font-size: 13px; color: #aaa;">
                            Wave 1/50
                        </span>
                        <button id="mwi-dt-collapse-btn" style="
                            background: none;
                            border: none;
                            color: #aaa;
                            cursor: pointer;
                            font-size: 16px;
                            padding: 0 4px;
                            line-height: 1;
                        " title="Collapse/Expand">▼</button>
                    </div>
                </div>

                <!-- Header Line 2: Stats (always visible) -->
                <div id="mwi-dt-header-stats" style="
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 4px 10px 6px 10px;
                    font-size: 12px;
                    color: #ccc;
                    gap: 12px;
                ">
                    <span>Last Run: <span id="mwi-dt-header-last" style="color: #fff; font-weight: bold;">--:--</span></span>
                    <span>|</span>
                    <span>Avg Run: <span id="mwi-dt-header-avg" style="color: #fff; font-weight: bold;">--:--</span></span>
                    <span>|</span>
                    <span>Runs: <span id="mwi-dt-header-runs" style="color: #fff; font-weight: bold;">0</span></span>
                    <span>|</span>
                    <span>Keys: <span id="mwi-dt-header-keys" style="color: #fff; font-weight: bold;">0</span></span>
                </div>
            </div>

            <div id="mwi-dt-content" style="padding: 12px 20px; display: flex; flex-direction: column; gap: 12px;">
                <!-- Progress bar -->
                <div>
                    <div style="background: #333; border-radius: 4px; height: 20px; position: relative; overflow: hidden;">
                        <div id="mwi-dt-progress-bar" style="
                            background: linear-gradient(90deg, #4a9eff 0%, #6eb5ff 100%);
                            height: 100%;
                            width: 0%;
                            transition: width 0.3s ease;
                        "></div>
                        <div style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            right: 0;
                            bottom: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 11px;
                            font-weight: bold;
                            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                        " id="mwi-dt-progress-text">0%</div>
                    </div>
                </div>

                <!-- Run-level stats (2x2 grid) -->
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 11px; color: #ccc; padding-top: 4px; border-top: 1px solid #444;">
                    <div style="text-align: center;">
                        <div style="color: #aaa; font-size: 10px;">Avg Run</div>
                        <div id="mwi-dt-avg-time" style="color: #fff; font-weight: bold;">--:--</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #aaa; font-size: 10px;">Last Run</div>
                        <div id="mwi-dt-last-time" style="color: #fff; font-weight: bold;">--:--</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #aaa; font-size: 10px;">Fastest Run</div>
                        <div id="mwi-dt-fastest-time" style="color: #5fda5f; font-weight: bold;">--:--</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #aaa; font-size: 10px;">Slowest Run</div>
                        <div id="mwi-dt-slowest-time" style="color: #ff6b6b; font-weight: bold;">--:--</div>
                    </div>
                </div>

                <!-- Keys section (collapsible placeholder) -->
                <div id="mwi-dt-keys-section" style="padding-top: 8px; border-top: 1px solid #444;">
                    <div id="mwi-dt-keys-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        padding: 4px 0;
                        font-size: 12px;
                        color: #ccc;
                    ">
                        <span>Keys: <span id="mwi-dt-character-name">Loading...</span> (<span id="mwi-dt-self-keys">0</span>)</span>
                        <span id="mwi-dt-keys-toggle" style="font-size: 10px;">▼</span>
                    </div>
                    <div id="mwi-dt-keys-list" style="
                        display: none;
                        padding: 8px 0;
                        font-size: 11px;
                        color: #ccc;
                    ">
                        <!-- Keys will be populated dynamically -->
                    </div>
                </div>

                <!-- Run history section (unified with grouping/filtering) -->
                <div style="padding-top: 8px; border-top: 1px solid #444;">
                    <div id="mwi-dt-run-history-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        padding: 4px 0;
                        margin-bottom: 8px;
                    ">
                        <span style="font-size: 12px; font-weight: bold; color: #ccc;">Run History <span id="mwi-dt-run-history-toggle" style="font-size: 10px;">▼</span></span>
                        <div style="display: flex; gap: 4px;">
                            <button id="mwi-dt-backfill-btn" style="
                                background: none;
                                border: 1px solid #4a9eff;
                                color: #4a9eff;
                                cursor: pointer;
                                font-size: 11px;
                                padding: 2px 8px;
                                border-radius: 3px;
                                font-weight: bold;
                            " title="Scan party chat and import historical runs">⟳ Backfill</button>
                            <button id="mwi-dt-clear-all" style="
                                background: none;
                                border: 1px solid #ff6b6b;
                                color: #ff6b6b;
                                cursor: pointer;
                                font-size: 11px;
                                padding: 2px 8px;
                                border-radius: 3px;
                                font-weight: bold;
                            " title="Clear all runs">✕ Clear</button>
                        </div>
                    </div>

                    <!-- Grouping and filtering controls -->
                    <div id="mwi-dt-controls" style="
                        display: none;
                        padding: 8px 0;
                        font-size: 11px;
                        color: #ccc;
                        border-bottom: 1px solid #444;
                        margin-bottom: 8px;
                    ">
                        <div style="margin-bottom: 6px;">
                            <label style="margin-right: 6px;">Group by:</label>
                            <select id="mwi-dt-group-by" style="
                                background: #333;
                                color: #fff;
                                border: 1px solid #555;
                                border-radius: 3px;
                                padding: 2px 4px;
                                font-size: 11px;
                            ">
                                <option value="team">Team</option>
                                <option value="dungeon">Dungeon</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 12px;">
                            <div>
                                <label style="margin-right: 6px;">Dungeon:</label>
                                <select id="mwi-dt-filter-dungeon" style="
                                    background: #333;
                                    color: #fff;
                                    border: 1px solid #555;
                                    border-radius: 3px;
                                    padding: 2px 4px;
                                    font-size: 11px;
                                    min-width: 100px;
                                ">
                                    <option value="all">All Dungeons</option>
                                </select>
                            </div>
                            <div>
                                <label style="margin-right: 6px;">Team:</label>
                                <select id="mwi-dt-filter-team" style="
                                    background: #333;
                                    color: #fff;
                                    border: 1px solid #555;
                                    border-radius: 3px;
                                    padding: 2px 4px;
                                    font-size: 11px;
                                    min-width: 100px;
                                ">
                                    <option value="all">All Teams</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div id="mwi-dt-run-list" style="
                        display: none;
                        max-height: 200px;
                        overflow-y: auto;
                        font-size: 11px;
                        color: #ccc;
                    ">
                        <!-- Run list populated dynamically -->
                        <div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs yet</div>
                    </div>
                </div>

                <!-- Run Chart section (collapsible) -->
                <div style="padding-top: 8px; border-top: 1px solid #444;">
                    <div id="mwi-dt-chart-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        padding: 4px 0;
                        margin-bottom: 8px;
                    ">
                        <span style="font-size: 12px; font-weight: bold; color: #ccc;">📊 Run Chart <span id="mwi-dt-chart-toggle" style="font-size: 10px;">▼</span></span>
                        <button id="mwi-dt-chart-popout-btn" style="
                            background: none;
                            border: 1px solid #4a9eff;
                            color: #4a9eff;
                            cursor: pointer;
                            font-size: 11px;
                            padding: 2px 8px;
                            border-radius: 3px;
                            font-weight: bold;
                        " title="Pop out chart">⇱ Pop-out</button>
                    </div>
                    <div id="mwi-dt-chart-container" style="
                        display: block;
                        height: 300px;
                        position: relative;
                    ">
                        <canvas id="mwi-dt-chart-canvas"></canvas>
                    </div>
                </div>
            </div>
        `;

            // Add to page
            document.body.appendChild(this.container);

            // Setup all interactions with callbacks
            this.interactions.setupAll(this.container, {
                onUpdate: () => {
                    const currentRun = dungeonTracker.getCurrentRun();
                    if (currentRun) this.update(currentRun);
                },
                onUpdateChart: () => this.updateChart(),
                onUpdateHistory: () => this.updateRunHistory(),
            });

            // Apply initial states
            this.interactions.applyInitialStates();
        }

        /**
         * Update UI with current run data
         * @param {Object} run - Current run state
         */
        async update(run) {
            if (!run || !this.container) {
                return;
            }

            // Update dungeon name and tier
            const dungeonName = this.container.querySelector('#mwi-dt-dungeon-name');
            if (dungeonName) {
                if (run.dungeonName && run.tier !== null) {
                    dungeonName.textContent = `${run.dungeonName} (T${run.tier})`;
                } else {
                    dungeonName.textContent = 'Dungeon Loading...';
                }
            }

            // Update wave counter
            const waveCounter = this.container.querySelector('#mwi-dt-wave-counter');
            if (waveCounter && run.maxWaves) {
                waveCounter.textContent = `Wave ${run.currentWave}/${run.maxWaves}`;
            }

            // Update current elapsed time
            const currentTime = this.container.querySelector('#mwi-dt-current-time');
            if (currentTime && run.totalElapsed !== undefined) {
                currentTime.textContent = this.formatTime(run.totalElapsed);
            }

            // Update time label based on hibernation detection
            const timeLabel = this.container.querySelector('#mwi-dt-time-label');
            if (timeLabel) {
                if (run.hibernationDetected) {
                    timeLabel.textContent = 'Chat: ';
                    timeLabel.title = 'Using party chat timestamps (computer sleep detected)';
                } else {
                    timeLabel.textContent = 'Elapsed: ';
                    timeLabel.title = 'Time since dungeon started';
                }
            }

            // Update progress bar
            const progressBar = this.container.querySelector('#mwi-dt-progress-bar');
            const progressText = this.container.querySelector('#mwi-dt-progress-text');
            if (progressBar && progressText && run.maxWaves) {
                const percent = Math.round((run.currentWave / run.maxWaves) * 100);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent}%`;
            }

            // Fetch run statistics - respect ALL filters to match chart exactly
            let stats, runHistory, lastRunTime;

            // Get all runs and apply filters (EXACT SAME LOGIC as chart)
            const allRuns = await storage.getJSON('allRuns', 'unifiedRuns', []);
            runHistory = allRuns;

            // Apply dungeon filter
            if (this.state.filterDungeon !== 'all') {
                runHistory = runHistory.filter((r) => r.dungeonName === this.state.filterDungeon);
            }

            // Apply team filter
            if (this.state.filterTeam !== 'all') {
                runHistory = runHistory.filter((r) => r.teamKey === this.state.filterTeam);
            }

            // Calculate stats from filtered runs
            if (runHistory.length > 0) {
                // Sort by timestamp (descending for most recent first)
                runHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                const durations = runHistory.map((r) => r.duration || r.totalTime || 0);
                const total = durations.reduce((sum, d) => sum + d, 0);

                stats = {
                    totalRuns: runHistory.length,
                    avgTime: Math.floor(total / runHistory.length),
                    fastestTime: Math.min(...durations),
                    slowestTime: Math.max(...durations),
                };

                lastRunTime = durations[0]; // First run after sorting (most recent)
            } else {
                // No runs match filters
                stats = { totalRuns: 0, avgTime: 0, fastestTime: 0, slowestTime: 0 };
                lastRunTime = 0;
            }

            // Get character name from dataManager
            let characterName = dataManager.characterData?.character?.name;

            if (!characterName && run.keyCountsMap) {
                // Fallback: use first player name from key counts
                const playerNames = Object.keys(run.keyCountsMap);
                if (playerNames.length > 0) {
                    characterName = playerNames[0];
                }
            }

            if (!characterName) {
                characterName = 'You'; // Final fallback
            }

            // Update character name in Keys section
            const characterNameElement = this.container.querySelector('#mwi-dt-character-name');
            if (characterNameElement) {
                characterNameElement.textContent = characterName;
            }

            // Update header stats (always visible)
            const headerLast = this.container.querySelector('#mwi-dt-header-last');
            if (headerLast) {
                headerLast.textContent = lastRunTime > 0 ? this.formatTime(lastRunTime) : '--:--';
            }

            const headerAvg = this.container.querySelector('#mwi-dt-header-avg');
            if (headerAvg) {
                headerAvg.textContent = stats.avgTime > 0 ? this.formatTime(stats.avgTime) : '--:--';
            }

            const headerRuns = this.container.querySelector('#mwi-dt-header-runs');
            if (headerRuns) {
                headerRuns.textContent = stats.totalRuns.toString();
            }

            // Update header keys (always visible) - show current key count from current run
            const headerKeys = this.container.querySelector('#mwi-dt-header-keys');
            if (headerKeys) {
                const currentKeys = (run.keyCountsMap && run.keyCountsMap[characterName]) || 0;
                headerKeys.textContent = currentKeys.toLocaleString();
            }

            // Update run-level stats in content area (2x2 grid)
            const avgTime = this.container.querySelector('#mwi-dt-avg-time');
            if (avgTime) {
                avgTime.textContent = stats.avgTime > 0 ? this.formatTime(stats.avgTime) : '--:--';
            }

            const lastTime = this.container.querySelector('#mwi-dt-last-time');
            if (lastTime) {
                lastTime.textContent = lastRunTime > 0 ? this.formatTime(lastRunTime) : '--:--';
            }

            const fastestTime = this.container.querySelector('#mwi-dt-fastest-time');
            if (fastestTime) {
                fastestTime.textContent = stats.fastestTime > 0 ? this.formatTime(stats.fastestTime) : '--:--';
            }

            const slowestTime = this.container.querySelector('#mwi-dt-slowest-time');
            if (slowestTime) {
                slowestTime.textContent = stats.slowestTime > 0 ? this.formatTime(stats.slowestTime) : '--:--';
            }

            // Update Keys section with party member key counts
            this.updateKeysDisplay(run.keyCountsMap || {}, characterName);

            // Update run history list
            await this.updateRunHistory();
        }

        /**
         * Update Keys section display
         * @param {Object} keyCountsMap - Map of player names to key counts
         * @param {string} characterName - Current character name
         */
        updateKeysDisplay(keyCountsMap, characterName) {
            // Update self key count in header
            const selfKeyCount = keyCountsMap[characterName] || 0;
            const selfKeysElement = this.container.querySelector('#mwi-dt-self-keys');
            if (selfKeysElement) {
                selfKeysElement.textContent = selfKeyCount.toString();
            }

            // Update expanded keys list
            const keysList = this.container.querySelector('#mwi-dt-keys-list');
            if (!keysList) return;

            // Clear existing content
            keysList.innerHTML = '';

            // Get all players sorted (current character first, then alphabetically)
            const playerNames = Object.keys(keyCountsMap).sort((a, b) => {
                if (a === characterName) return -1;
                if (b === characterName) return 1;
                return a.localeCompare(b);
            });

            if (playerNames.length === 0) {
                keysList.innerHTML =
                    '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No key data yet</div>';
                return;
            }

            // Build player list HTML
            playerNames.forEach((playerName) => {
                const keyCount = keyCountsMap[playerName];
                const isCurrentPlayer = playerName === characterName;

                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '4px 8px';
                row.style.borderBottom = '1px solid #333';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = playerName;
                nameSpan.style.color = isCurrentPlayer ? '#4a9eff' : '#ccc';
                nameSpan.style.fontWeight = isCurrentPlayer ? 'bold' : 'normal';

                const keyCountSpan = document.createElement('span');
                keyCountSpan.textContent = keyCount.toLocaleString();
                keyCountSpan.style.color = '#fff';
                keyCountSpan.style.fontWeight = 'bold';

                row.appendChild(nameSpan);
                row.appendChild(keyCountSpan);
                keysList.appendChild(row);
            });
        }

        /**
         * Update run history display
         */
        async updateRunHistory() {
            await this.history.update(this.container);
        }

        /**
         * Update chart display
         */
        async updateChart() {
            if (this.state.isChartExpanded) {
                await this.chart.render(this.container);
            }
        }

        /**
         * Show the UI
         */
        show() {
            if (this.container) {
                this.container.style.display = 'block';
            }
        }

        /**
         * Hide the UI
         */
        hide() {
            if (this.container) {
                this.container.style.display = 'none';
            }
        }

        /**
         * Start the update loop (updates current wave time every second)
         */
        startUpdateLoop() {
            // Clear existing interval
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
            }

            // Update every second
            this.updateInterval = setInterval(() => {
                const currentRun = dungeonTracker.getCurrentRun();
                if (currentRun) {
                    this.update(currentRun);
                }
            }, 1000);

            this.timerRegistry.registerInterval(this.updateInterval);
        }

        /**
         * Cleanup for character switching
         */
        cleanup() {
            // Immediately hide UI to prevent visual artifacts during character switch
            this.hide();

            if (this.dungeonUpdateHandler) {
                dungeonTracker.offUpdate(this.dungeonUpdateHandler);
                this.dungeonUpdateHandler = null;
            }

            if (this.characterSwitchingHandler) {
                dataManager.off('character_switching', this.characterSwitchingHandler);
                this.characterSwitchingHandler = null;
            }

            // Disconnect character selection screen observer
            if (this.characterSelectObserver) {
                this.characterSelectObserver();
                this.characterSelectObserver = null;
            }

            // Clear update interval
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            this.timerRegistry.clearAll();

            // Force remove ALL dungeon tracker containers (handles duplicates from memory leak)
            const allContainers = document.querySelectorAll('#mwi-dungeon-tracker');
            if (allContainers.length > 1) {
                console.warn(
                    `[Toolasha Dungeon Tracker UI] Found ${allContainers.length} UI containers, removing all (memory leak detected)`
                );
            }
            allContainers.forEach((container) => container.remove());

            if (this.interactions && this.interactions.cleanup) {
                this.interactions.cleanup();
            }

            // Clear instance reference
            this.container = null;

            // Clean up module references
            if (this.chart) {
                this.chart = null;
            }
            if (this.history) {
                this.history = null;
            }
            if (this.interactions) {
                this.interactions = null;
            }

            // Reset initialization flag
            this.isInitialized = false;
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
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    const dungeonTrackerUI = new DungeonTrackerUI();

    /**
     * Combat Summary Module
     * Shows detailed statistics when returning from combat
     */


    /**
     * CombatSummary class manages combat completion statistics display
     */
    class CombatSummary {
        constructor() {
            this.isActive = false;
            this.isInitialized = false;
            this.battleUnitFetchedHandler = null; // Store handler reference for cleanup
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize combat summary feature
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('combatSummary')) {
                return;
            }

            this.isInitialized = true;

            this.battleUnitFetchedHandler = (data) => {
                this.handleBattleSummary(data);
            };

            // Listen for battle_unit_fetched WebSocket message
            webSocketHook.on('battle_unit_fetched', this.battleUnitFetchedHandler);

            this.isActive = true;
        }

        /**
         * Handle battle completion and display summary
         * @param {Object} message - WebSocket message data
         */
        async handleBattleSummary(message) {
            // Validate message structure
            if (!message || !message.unit) {
                console.warn('[Combat Summary] Invalid message structure:', message);
                return;
            }

            // Ensure market data is loaded
            if (!marketAPI.isLoaded()) {
                const marketData = await marketAPI.fetch();
                if (!marketData) {
                    console.error('[Combat Summary] Market data not available');
                    return;
                }
            }

            // Calculate total revenue from loot (with null check)
            let totalPriceAsk = 0;
            let totalPriceBid = 0;

            if (message.unit.totalLootMap) {
                for (const loot of Object.values(message.unit.totalLootMap)) {
                    const itemCount = loot.count;

                    // Coins are revenue at face value (1 coin = 1 gold)
                    if (loot.itemHrid === '/items/coin') {
                        totalPriceAsk += itemCount;
                        totalPriceBid += itemCount;
                    } else {
                        // Other items: get market price
                        const prices = marketAPI.getPrice(loot.itemHrid);
                        if (prices) {
                            totalPriceAsk += prices.ask * itemCount;
                            totalPriceBid += prices.bid * itemCount;
                        }
                    }
                }
            } else {
                console.warn('[Combat Summary] No totalLootMap in message');
            }

            // Calculate total experience (with null check)
            let totalSkillsExp = 0;
            if (message.unit.totalSkillExperienceMap) {
                for (const exp of Object.values(message.unit.totalSkillExperienceMap)) {
                    totalSkillsExp += exp;
                }
            } else {
                console.warn('[Combat Summary] No totalSkillExperienceMap in message');
            }

            // Wait for battle panel to appear and inject summary
            const tryTimes = 0;
            this.findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes);
        }

        /**
         * Find battle panel and inject summary stats
         * @param {Object} message - WebSocket message data
         * @param {number} totalPriceAsk - Total loot value at ask price
         * @param {number} totalPriceBid - Total loot value at bid price
         * @param {number} totalSkillsExp - Total experience gained
         * @param {number} tryTimes - Retry counter
         */
        findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes) {
            tryTimes++;

            // Find the experience section parent
            const elem = document.querySelector('[class*="BattlePanel_gainedExp"]')?.parentElement;

            if (elem) {
                // Get primary text color from settings
                const textColor = config.getSetting('color_text_primary') || config.COLOR_TEXT_PRIMARY;

                // Parse combat duration and battle count
                let battleDurationSec = null;
                const combatInfoElement = document.querySelector('[class*="BattlePanel_combatInfo"]');

                if (combatInfoElement) {
                    const matches = combatInfoElement.innerHTML.match(
                        /Combat Duration: (?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s).*?Battles: (\d+).*?Deaths: (\d+)/
                    );

                    if (matches) {
                        const days = parseInt(matches[1], 10) || 0;
                        const hours = parseInt(matches[2], 10) || 0;
                        const minutes = parseInt(matches[3], 10) || 0;
                        const seconds = parseInt(matches[4], 10) || 0;
                        const battles = parseInt(matches[5], 10) - 1; // Exclude current battle

                        battleDurationSec = days * 86400 + hours * 3600 + minutes * 60 + seconds;

                        // Calculate encounters per hour
                        const encountersPerHour = ((battles / battleDurationSec) * 3600).toFixed(1);

                        elem.insertAdjacentHTML(
                            'beforeend',
                            `<div id="mwi-combat-encounters" style="color: ${textColor};">Encounters/hour: ${encountersPerHour}</div>`
                        );
                    }
                }

                // Total revenue
                document
                    .querySelector('div#mwi-combat-encounters')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-revenue" style="color: ${textColor};">Total revenue: ${formatters_js.formatWithSeparator(Math.round(totalPriceAsk))} / ${formatters_js.formatWithSeparator(Math.round(totalPriceBid))}</div>`
                    );

                // Per-hour revenue
                if (battleDurationSec) {
                    const revenuePerHourAsk = totalPriceAsk / (battleDurationSec / 3600);
                    const revenuePerHourBid = totalPriceBid / (battleDurationSec / 3600);

                    document
                        .querySelector('div#mwi-combat-revenue')
                        ?.insertAdjacentHTML(
                            'afterend',
                            `<div id="mwi-combat-revenue-hour" style="color: ${textColor};">Revenue/hour: ${formatters_js.formatWithSeparator(Math.round(revenuePerHourAsk))} / ${formatters_js.formatWithSeparator(Math.round(revenuePerHourBid))}</div>`
                        );

                    // Per-day revenue
                    document
                        .querySelector('div#mwi-combat-revenue-hour')
                        ?.insertAdjacentHTML(
                            'afterend',
                            `<div id="mwi-combat-revenue-day" style="color: ${textColor};">Revenue/day: ${formatters_js.formatWithSeparator(Math.round(revenuePerHourAsk * 24))} / ${formatters_js.formatWithSeparator(Math.round(revenuePerHourBid * 24))}</div>`
                        );
                }

                // Total experience
                document
                    .querySelector('div#mwi-combat-revenue-day')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-total-exp" style="color: ${textColor};">Total exp: ${formatters_js.formatWithSeparator(Math.round(totalSkillsExp))}</div>`
                    );

                // Per-hour experience breakdowns
                if (battleDurationSec) {
                    const totalExpPerHour = totalSkillsExp / (battleDurationSec / 3600);

                    // Insert total exp/hour first
                    document
                        .querySelector('div#mwi-combat-total-exp')
                        ?.insertAdjacentHTML(
                            'afterend',
                            `<div id="mwi-combat-total-exp-hour" style="color: ${textColor};">Total exp/hour: ${formatters_js.formatWithSeparator(Math.round(totalExpPerHour))}</div>`
                        );

                    // Individual skill exp/hour
                    const skills = [
                        { skillHrid: '/skills/attack', name: 'Attack' },
                        { skillHrid: '/skills/magic', name: 'Magic' },
                        { skillHrid: '/skills/ranged', name: 'Ranged' },
                        { skillHrid: '/skills/defense', name: 'Defense' },
                        { skillHrid: '/skills/melee', name: 'Melee' },
                        { skillHrid: '/skills/intelligence', name: 'Intelligence' },
                        { skillHrid: '/skills/stamina', name: 'Stamina' },
                    ];

                    let lastElement = document.querySelector('div#mwi-combat-total-exp-hour');

                    // Only show individual skill exp if we have the data
                    if (message.unit.totalSkillExperienceMap) {
                        for (const skill of skills) {
                            const expGained = message.unit.totalSkillExperienceMap[skill.skillHrid];
                            if (expGained && lastElement) {
                                const expPerHour = expGained / (battleDurationSec / 3600);
                                lastElement.insertAdjacentHTML(
                                    'afterend',
                                    `<div style="color: ${textColor};">${skill.name} exp/hour: ${formatters_js.formatWithSeparator(Math.round(expPerHour))}</div>`
                                );
                                // Update lastElement to the newly inserted div
                                lastElement = lastElement.nextElementSibling;
                            }
                        }
                    }
                } else {
                    console.warn('[Combat Summary] Unable to display hourly stats due to null battleDurationSec');
                }
            } else if (tryTimes <= 10) {
                // Retry if element not found
                const retryTimeout = setTimeout(() => {
                    this.findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes);
                }, 200);
                this.timerRegistry.registerTimeout(retryTimeout);
            } else {
                console.error('[Combat Summary] Battle panel not found after 10 tries');
            }
        }

        /**
         * Disable the combat summary feature
         */
        disable() {
            if (this.battleUnitFetchedHandler) {
                webSocketHook.off('battle_unit_fetched', this.battleUnitFetchedHandler);
                this.battleUnitFetchedHandler = null;
            }

            this.timerRegistry.clearAll();
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const combatSummary = new CombatSummary();

    /**
     * Combat Simulator Export Module
     * Constructs player data in Shykai Combat Simulator format
     *
     * Exports character data for solo or party simulation testing
     */


    // Detect if we're running on Tampermonkey or Steam
    const hasScriptManager$1 = typeof GM_info !== 'undefined';

    /**
     * Get saved character data from storage
     * @returns {Promise<Object|null>} Parsed character data or null
     */
    async function getCharacterData$1() {
        try {
            // Tampermonkey: Use GM storage (cross-domain, persisted)
            if (hasScriptManager$1) {
                const data = await webSocketHook.loadFromStorage('toolasha_init_character_data', null);
                if (!data) {
                    console.error('[Combat Sim Export] No character data found. Please refresh game page.');
                    return null;
                }
                return JSON.parse(data);
            }

            // Steam: Use dataManager (which has its own fallback handling)
            const characterData = dataManager.characterData;

            if (!characterData) {
                console.error('[Combat Sim Export] No character data found. Please refresh game page.');
                return null;
            }
            return characterData;
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get character data:', error);
            return null;
        }
    }

    /**
     * Get saved battle data from storage
     * @returns {Promise<Object|null>} Parsed battle data or null
     */
    async function getBattleData() {
        try {
            // Tampermonkey: Use GM storage
            if (hasScriptManager$1) {
                const data = await webSocketHook.loadFromStorage('toolasha_new_battle', null);
                if (!data) {
                    return null; // No battle data (not in combat or solo)
                }
                return JSON.parse(data);
            }

            // Steam: Use dataManager (RAM only, no GM storage available)
            const battleData = dataManager.battleData;
            if (!battleData) {
                return null; // No battle data (not in combat or solo)
            }
            return battleData;
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get battle data:', error);
            return null;
        }
    }

    /**
     * Get init_client_data from storage
     * @returns {Promise<Object|null>} Parsed client data or null
     */
    async function getClientData() {
        try {
            // Tampermonkey: Use GM storage (cross-domain, persisted)
            if (hasScriptManager$1) {
                const data = await webSocketHook.loadFromStorage('toolasha_init_client_data', null);
                if (!data) {
                    console.warn('[Combat Sim Export] No client data found');
                    return null;
                }
                return JSON.parse(data);
            }

            // Steam: Use dataManager (RAM only, no GM storage available)
            const clientData = dataManager.getInitClientData();
            if (!clientData) {
                console.warn('[Combat Sim Export] No client data found');
                return null;
            }
            return clientData;
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get client data:', error);
            return null;
        }
    }

    /**
     * Get profile export list from storage
     * @returns {Promise<Array>} List of saved profiles
     */
    async function getProfileList() {
        try {
            // Read from GM storage (cross-origin accessible, matches pattern of other combat sim data)
            const profileListJson = await webSocketHook.loadFromStorage('toolasha_profile_list', '[]');
            return JSON.parse(profileListJson);
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get profile list:', error);
            return [];
        }
    }

    /**
     * Construct player export object from own character data
     * @param {Object} characterObj - Character data from init_character_data
     * @param {Object} clientObj - Client data (optional)
     * @returns {Object} Player export object
     */
    function constructSelfPlayer(characterObj, clientObj) {
        const playerObj = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: [],
            },
            food: { '/action_types/combat': [] },
            drinks: { '/action_types/combat': [] },
            abilities: [],
            triggerMap: {},
            houseRooms: {},
        };

        // Extract combat skill levels
        for (const skill of characterObj.characterSkills || []) {
            const skillName = skill.skillHrid.split('/').pop();
            if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
                playerObj.player[skillName + 'Level'] = skill.level;
            }
        }

        // Extract equipped items - handle both formats
        if (Array.isArray(characterObj.characterItems)) {
            // Array format (full inventory list)
            for (const item of characterObj.characterItems) {
                if (item.itemLocationHrid && !item.itemLocationHrid.includes('/item_locations/inventory')) {
                    playerObj.player.equipment.push({
                        itemLocationHrid: item.itemLocationHrid,
                        itemHrid: item.itemHrid,
                        enhancementLevel: item.enhancementLevel || 0,
                    });
                }
            }
        } else if (characterObj.characterEquipment) {
            // Object format (just equipped items)
            for (const key in characterObj.characterEquipment) {
                const item = characterObj.characterEquipment[key];
                playerObj.player.equipment.push({
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                });
            }
        }

        // Initialize food and drink slots
        for (let i = 0; i < 3; i++) {
            playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
            playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
        }

        // Extract food slots
        const foodSlots = characterObj.actionTypeFoodSlotsMap?.['/action_types/combat'];
        if (Array.isArray(foodSlots)) {
            foodSlots.forEach((item, i) => {
                if (i < 3 && item?.itemHrid) {
                    playerObj.food['/action_types/combat'][i] = { itemHrid: item.itemHrid };
                }
            });
        }

        // Extract drink slots
        const drinkSlots = characterObj.actionTypeDrinkSlotsMap?.['/action_types/combat'];
        if (Array.isArray(drinkSlots)) {
            drinkSlots.forEach((item, i) => {
                if (i < 3 && item?.itemHrid) {
                    playerObj.drinks['/action_types/combat'][i] = { itemHrid: item.itemHrid };
                }
            });
        }

        // Initialize abilities (5 slots)
        for (let i = 0; i < 5; i++) {
            playerObj.abilities[i] = { abilityHrid: '', level: 1 };
        }

        // Extract equipped abilities
        let normalAbilityIndex = 1;
        const equippedAbilities = characterObj.combatUnit?.combatAbilities || [];
        for (const ability of equippedAbilities) {
            if (!ability || !ability.abilityHrid) continue;

            // Check if special ability
            const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

            if (isSpecial) {
                // Special ability goes in slot 0
                playerObj.abilities[0] = {
                    abilityHrid: ability.abilityHrid,
                    level: ability.level || 1,
                };
            } else if (normalAbilityIndex < 5) {
                // Normal abilities go in slots 1-4
                playerObj.abilities[normalAbilityIndex++] = {
                    abilityHrid: ability.abilityHrid,
                    level: ability.level || 1,
                };
            }
        }

        // Extract trigger maps
        playerObj.triggerMap = {
            ...(characterObj.abilityCombatTriggersMap || {}),
            ...(characterObj.consumableCombatTriggersMap || {}),
        };

        // Extract house room levels
        for (const house of Object.values(characterObj.characterHouseRoomMap || {})) {
            playerObj.houseRooms[house.houseRoomHrid] = house.level;
        }

        // Extract completed achievements
        playerObj.achievements = {};
        if (characterObj.characterAchievements) {
            for (const achievement of characterObj.characterAchievements) {
                if (achievement.achievementHrid && achievement.isCompleted) {
                    playerObj.achievements[achievement.achievementHrid] = true;
                }
            }
        }

        return playerObj;
    }

    /**
     * Construct party member data from profile share
     * @param {Object} profile - Profile data from profile_shared message
     * @param {Object} clientObj - Client data (optional)
     * @param {Object} battleObj - Battle data (optional, for consumables)
     * @returns {Object} Player export object
     */
    function constructPartyPlayer(profile, clientObj, battleObj) {
        const playerObj = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: [],
            },
            food: { '/action_types/combat': [] },
            drinks: { '/action_types/combat': [] },
            abilities: [],
            triggerMap: {},
            houseRooms: {},
        };

        // Extract skill levels from profile
        for (const skill of profile.profile?.characterSkills || []) {
            const skillName = skill.skillHrid?.split('/').pop();
            if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
                playerObj.player[skillName + 'Level'] = skill.level || 1;
            }
        }

        // Extract equipment from profile
        if (profile.profile?.wearableItemMap) {
            for (const key in profile.profile.wearableItemMap) {
                const item = profile.profile.wearableItemMap[key];
                playerObj.player.equipment.push({
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                });
            }
        }

        // Initialize food and drink slots
        for (let i = 0; i < 3; i++) {
            playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
            playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
        }

        // Get consumables from battle data if available
        let battlePlayer = null;
        if (battleObj?.players) {
            battlePlayer = battleObj.players.find((p) => p.character?.id === profile.characterID);
        }

        if (battlePlayer?.combatConsumables) {
            let foodIndex = 0;
            let drinkIndex = 0;

            // Intelligently separate food and drinks
            battlePlayer.combatConsumables.forEach((consumable) => {
                const itemHrid = consumable.itemHrid;

                // Check if it's a drink
                const isDrink =
                    itemHrid.includes('/drinks/') ||
                    itemHrid.includes('coffee') ||
                    clientObj?.itemDetailMap?.[itemHrid]?.type === 'drink';

                if (isDrink && drinkIndex < 3) {
                    playerObj.drinks['/action_types/combat'][drinkIndex++] = { itemHrid: itemHrid };
                } else if (!isDrink && foodIndex < 3) {
                    playerObj.food['/action_types/combat'][foodIndex++] = { itemHrid: itemHrid };
                }
            });
        }

        // Initialize abilities (5 slots)
        for (let i = 0; i < 5; i++) {
            playerObj.abilities[i] = { abilityHrid: '', level: 1 };
        }

        // Extract equipped abilities from profile
        let normalAbilityIndex = 1;
        const equippedAbilities = profile.profile?.equippedAbilities || [];
        for (const ability of equippedAbilities) {
            if (!ability || !ability.abilityHrid) continue;

            // Check if special ability
            const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

            if (isSpecial) {
                // Special ability goes in slot 0
                playerObj.abilities[0] = {
                    abilityHrid: ability.abilityHrid,
                    level: ability.level || 1,
                };
            } else if (normalAbilityIndex < 5) {
                // Normal abilities go in slots 1-4
                playerObj.abilities[normalAbilityIndex++] = {
                    abilityHrid: ability.abilityHrid,
                    level: ability.level || 1,
                };
            }
        }

        // Extract trigger maps (prefer battle data, fallback to profile)
        playerObj.triggerMap = {
            ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
            ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {}),
        };

        // Extract house room levels from profile
        if (profile.profile?.characterHouseRoomMap) {
            for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
                playerObj.houseRooms[house.houseRoomHrid] = house.level;
            }
        }

        // Extract completed achievements from profile
        playerObj.achievements = {};
        if (profile.profile?.characterAchievements) {
            for (const achievement of profile.profile.characterAchievements) {
                if (achievement.achievementHrid && achievement.isCompleted) {
                    playerObj.achievements[achievement.achievementHrid] = true;
                }
            }
        }

        return playerObj;
    }

    /**
     * Construct full export object (solo or party)
     * @param {string|null} externalProfileId - Optional profile ID (for viewing other players' profiles)
     * @param {boolean} singlePlayerFormat - If true, returns player object instead of multi-player format
     * @returns {Object} Export object with player data, IDs, positions, and zone info
     */
    async function constructExportObject(externalProfileId = null, singlePlayerFormat = false) {
        const characterObj = await getCharacterData$1();
        if (!characterObj) {
            return null;
        }

        const clientObj = await getClientData();
        const battleObj = await getBattleData();
        const profileList = await getProfileList();

        // Blank player template (as string, like MCS)
        const BLANK =
            '{"player":{"attackLevel":1,"magicLevel":1,"meleeLevel":1,"rangedLevel":1,"defenseLevel":1,"staminaLevel":1,"intelligenceLevel":1,"equipment":[]},"food":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"drinks":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"abilities":[{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1}],"triggerMap":{},"zone":"/actions/combat/fly","simulationTime":"100","houseRooms":{"/house_rooms/dairy_barn":0,"/house_rooms/garden":0,"/house_rooms/log_shed":0,"/house_rooms/forge":0,"/house_rooms/workshop":0,"/house_rooms/sewing_parlor":0,"/house_rooms/kitchen":0,"/house_rooms/brewery":0,"/house_rooms/laboratory":0,"/house_rooms/observatory":0,"/house_rooms/dining_room":0,"/house_rooms/library":0,"/house_rooms/dojo":0,"/house_rooms/gym":0,"/house_rooms/armory":0,"/house_rooms/archery_range":0,"/house_rooms/mystical_study":0},"achievements":{}}';

        // Check if exporting another player's profile
        if (externalProfileId && externalProfileId !== characterObj.character.id) {
            // Try to find profile in GM storage first, then fall back to memory cache
            let profile = profileList.find((p) => p.characterID === externalProfileId);

            // If not found in GM storage, check memory cache (works on Steam)
            const cachedProfile = profileManager_js.getCurrentProfile();
            if (!profile && cachedProfile && cachedProfile.characterID === externalProfileId) {
                profile = cachedProfile;
            }

            if (!profile) {
                console.error('[Combat Sim Export] Profile not found for:', externalProfileId);
                return null; // Profile not in cache
            }

            // Construct the player object
            const playerObj = constructPartyPlayer(profile, clientObj, battleObj);

            // If single-player format requested, return player object directly
            if (singlePlayerFormat) {
                // Add name field and remove zone/simulationTime for single-player format
                playerObj.name = profile.characterName;
                delete playerObj.zone;
                delete playerObj.simulationTime;

                return {
                    exportObj: playerObj,
                    playerIDs: [profile.characterName, 'Player 2', 'Player 3', 'Player 4', 'Player 5'],
                    importedPlayerPositions: [true, false, false, false, false],
                    zone: '/actions/combat/fly',
                    isZoneDungeon: false,
                    difficultyTier: 0,
                    isParty: false,
                };
            }

            // Multi-player format (for auto-import storage)
            const exportObj = {};
            exportObj[1] = JSON.stringify(playerObj);

            // Fill other slots with blanks
            for (let i = 2; i <= 5; i++) {
                exportObj[i] = BLANK;
            }

            return {
                exportObj,
                playerIDs: [profile.characterName, 'Player 2', 'Player 3', 'Player 4', 'Player 5'],
                importedPlayerPositions: [true, false, false, false, false],
                zone: '/actions/combat/fly',
                isZoneDungeon: false,
                difficultyTier: 0,
                isParty: false,
            };
        }

        // Export YOUR data (solo or party) - existing logic below
        const exportObj = {};
        for (let i = 1; i <= 5; i++) {
            exportObj[i] = BLANK;
        }

        const playerIDs = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
        const importedPlayerPositions = [false, false, false, false, false];
        let zone = '/actions/combat/fly';
        let isZoneDungeon = false;
        let difficultyTier = 0;
        let isParty = false;
        let yourSlotIndex = 1; // Track which slot contains YOUR data (for party mode)

        // Check if in party
        const hasParty = characterObj.partyInfo?.partySlotMap;

        if (!hasParty) {
            exportObj[1] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
            playerIDs[0] = characterObj.character?.name || 'Player 1';
            importedPlayerPositions[0] = true;

            // Get current combat zone and tier
            for (const action of characterObj.characterActions || []) {
                if (action && action.actionHrid.includes('/actions/combat/')) {
                    zone = action.actionHrid;
                    difficultyTier = action.difficultyTier || 0;
                    isZoneDungeon = clientObj?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
                    break;
                }
            }
        } else {
            isParty = true;

            let slotIndex = 1;
            for (const member of Object.values(characterObj.partyInfo.partySlotMap)) {
                if (member.characterID) {
                    if (member.characterID === characterObj.character.id) {
                        // This is you
                        yourSlotIndex = slotIndex; // Remember your slot
                        exportObj[slotIndex] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
                        playerIDs[slotIndex - 1] = characterObj.character.name;
                        importedPlayerPositions[slotIndex - 1] = true;
                    } else {
                        // Party member - try to get from profile list
                        const profile = profileList.find((p) => p.characterID === member.characterID);
                        if (profile) {
                            exportObj[slotIndex] = JSON.stringify(constructPartyPlayer(profile, clientObj, battleObj));
                            playerIDs[slotIndex - 1] = profile.characterName;
                            importedPlayerPositions[slotIndex - 1] = true;
                        } else {
                            console.warn(
                                '[Combat Sim Export] No profile found for party member',
                                member.characterID,
                                '- profiles have:',
                                profileList.map((p) => p.characterID)
                            );
                            playerIDs[slotIndex - 1] = 'Open profile in game';
                        }
                    }
                    slotIndex++;
                }
            }

            // Get party zone and tier
            zone = characterObj.partyInfo?.party?.actionHrid || '/actions/combat/fly';
            difficultyTier = characterObj.partyInfo?.party?.difficultyTier || 0;
            isZoneDungeon = clientObj?.actionDetailMap?.[zone]?.combatZoneInfo?.isDungeon || false;
        }

        // If single-player format requested, return just the player object
        if (singlePlayerFormat && exportObj[1]) {
            // In party mode, export YOUR data (not necessarily slot 1)
            const slotToExport = isParty ? yourSlotIndex : 1;

            // Parse the player JSON string back to an object
            const playerObj = JSON.parse(exportObj[slotToExport]);

            // Add name field and remove zone/simulationTime for single-player format
            playerObj.name = playerIDs[slotToExport - 1];
            delete playerObj.zone;
            delete playerObj.simulationTime;

            return {
                exportObj: playerObj, // Single player object instead of multi-player format
                playerIDs,
                importedPlayerPositions,
                zone,
                isZoneDungeon,
                difficultyTier,
                isParty: false, // Single player export is never party format
            };
        }

        return {
            exportObj,
            playerIDs,
            importedPlayerPositions,
            zone,
            isZoneDungeon,
            difficultyTier,
            isParty,
        };
    }

    /**
     * Combat Simulator Integration Module
     * Injects import button on Shykai Combat Simulator page
     *
     * Automatically fills character/party data from game into simulator
     */


    /**
     * Check if running on Steam client (no extension manager)
     * @returns {boolean} True if on Steam client
     */
    function isSteamClient() {
        return typeof GM === 'undefined' && typeof GM_setValue === 'undefined';
    }

    const timerRegistry = timerRegistry_js.createTimerRegistry();
    const IMPORT_CONTAINER_ID = 'toolasha-import-container';

    /**
     * Initialize combat sim integration (runs on sim page only)
     */
    function initialize$1() {
        // Don't inject import button on Steam client (no cross-domain storage)
        if (isSteamClient()) {
            return;
        }

        disable();

        // Wait for simulator UI to load
        waitForSimulatorUI();
    }

    /**
     * Disable combat sim integration and cleanup injected UI
     */
    function disable() {
        timerRegistry.clearAll();

        const container = document.getElementById(IMPORT_CONTAINER_ID);
        if (container) {
            container.remove();
        }
    }

    /**
     * Wait for simulator's import/export button to appear
     */
    function waitForSimulatorUI() {
        const checkInterval = setInterval(() => {
            const exportButton = document.querySelector('button#buttonImportExport');
            if (exportButton) {
                clearInterval(checkInterval);
                injectImportButton(exportButton);
            }
        }, 200);

        timerRegistry.registerInterval(checkInterval);

        // Stop checking after 10 seconds
        const stopTimeout = setTimeout(() => clearInterval(checkInterval), 10000);
        timerRegistry.registerTimeout(stopTimeout);
    }

    /**
     * Inject "Import from Toolasha" button
     * @param {Element} exportButton - Reference element to insert after
     */
    function injectImportButton(exportButton) {
        // Check if button already exists
        if (document.getElementById('toolasha-import-button')) {
            return;
        }

        // Create container div
        const container = document.createElement('div');
        container.id = IMPORT_CONTAINER_ID;
        container.style.marginTop = '10px';

        // Create import button
        const button = document.createElement('button');
        button.id = 'toolasha-import-button';
        // Include hidden text for JIGS compatibility (JIGS searches for "Import solo/group")
        button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
        button.style.backgroundColor = config.COLOR_ACCENT;
        button.style.color = 'white';
        button.style.padding = '10px 20px';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.fontWeight = 'bold';
        button.style.width = '100%';

        // Add hover effect
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '0.8';
        });
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '1';
        });

        // Add click handler
        button.addEventListener('click', () => {
            importDataToSimulator(button);
        });

        container.appendChild(button);

        // Insert after export button's parent container
        exportButton.parentElement.parentElement.insertAdjacentElement('afterend', container);
    }

    /**
     * Import character/party data into simulator
     * @param {Element} button - Button element to update status
     */
    async function importDataToSimulator(button) {
        try {
            // Get export data from storage
            const exportData = await constructExportObject();

            if (!exportData) {
                button.textContent = 'Error: No character data';
                button.style.backgroundColor = '#dc3545'; // Red
                const resetTimeout = setTimeout(() => {
                    button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                    button.style.backgroundColor = config.COLOR_ACCENT;
                }, 3000);
                timerRegistry.registerTimeout(resetTimeout);
                console.error('[Toolasha Combat Sim] No export data available');
                alert(
                    'No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again'
                );
                return;
            }

            const { exportObj, playerIDs, importedPlayerPositions, zone, isZoneDungeon, difficultyTier, _isParty } =
                exportData;

            // Step 1: Switch to Group Combat tab
            const groupTab = document.querySelector('a#group-combat-tab');
            if (groupTab) {
                groupTab.click();
            } else {
                console.warn('[Toolasha Combat Sim] Group combat tab not found');
            }

            // Small delay to let tab switch complete
            const importTimeout = setTimeout(() => {
                // Step 2: Fill import field with JSON data
                const importInput = document.querySelector('input#inputSetGroupCombatAll');
                if (importInput) {
                    // exportObj already has JSON strings for each slot, just stringify once
                    reactInput_js.setReactInputValue(importInput, JSON.stringify(exportObj), { focus: false });
                } else {
                    console.error('[Toolasha Combat Sim] Import input field not found');
                }

                // Step 3: Click import button
                const importButton = document.querySelector('button#buttonImportSet');
                if (importButton) {
                    importButton.click();
                } else {
                    console.error('[Toolasha Combat Sim] Import button not found');
                }

                // Step 4: Set player names in tabs
                for (let i = 0; i < 5; i++) {
                    const tab = document.querySelector(`a#player${i + 1}-tab`);
                    if (tab) {
                        tab.textContent = playerIDs[i];
                    }
                }

                // Step 5: Select zone or dungeon
                if (zone) {
                    selectZone(zone, isZoneDungeon);
                }

                // Step 5.5: Set difficulty tier
                const difficultyTimeout = setTimeout(() => {
                    // Try both input and select elements
                    const difficultyElement =
                        document.querySelector('input#inputDifficulty') ||
                        document.querySelector('select#inputDifficulty') ||
                        document.querySelector('[id*="ifficulty"]');

                    if (difficultyElement) {
                        const tierValue = 'T' + difficultyTier;

                        // Handle select dropdown (set by value)
                        if (difficultyElement.tagName === 'SELECT') {
                            // Try to find option by value or text
                            for (let i = 0; i < difficultyElement.options.length; i++) {
                                const option = difficultyElement.options[i];
                                if (
                                    option.value === tierValue ||
                                    option.value === String(difficultyTier) ||
                                    option.text === tierValue ||
                                    option.text.includes('T' + difficultyTier)
                                ) {
                                    difficultyElement.selectedIndex = i;
                                    break;
                                }
                            }
                        } else {
                            // Handle text input
                            difficultyElement.value = tierValue;
                        }

                        difficultyElement.dispatchEvent(new Event('change'));
                        difficultyElement.dispatchEvent(new Event('input'));
                    } else {
                        console.warn('[Toolasha Combat Sim] Difficulty element not found');
                    }
                }, 250); // Increased delay to ensure zone loads first
                timerRegistry.registerTimeout(difficultyTimeout);

                // Step 6: Enable/disable player checkboxes
                for (let i = 0; i < 5; i++) {
                    const checkbox = document.querySelector(`input#player${i + 1}.form-check-input.player-checkbox`);
                    if (checkbox) {
                        checkbox.checked = importedPlayerPositions[i];
                        checkbox.dispatchEvent(new Event('change'));
                    }
                }

                // Step 7: Set simulation time to 24 hours (standard)
                const simTimeInput = document.querySelector('input#inputSimulationTime');
                if (simTimeInput) {
                    reactInput_js.setReactInputValue(simTimeInput, '24', { focus: false });
                }

                // Step 8: Get prices (refresh market data)
                const getPriceButton = document.querySelector('button#buttonGetPrices');
                if (getPriceButton) {
                    getPriceButton.click();
                }

                // Update button status
                button.textContent = '✓ Imported';
                button.style.backgroundColor = '#28a745'; // Green
                const successResetTimeout = setTimeout(() => {
                    button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                    button.style.backgroundColor = config.COLOR_ACCENT;
                }, 3000);
                timerRegistry.registerTimeout(successResetTimeout);
            }, 100);
            timerRegistry.registerTimeout(importTimeout);
        } catch (error) {
            console.error('[Toolasha Combat Sim] Import failed:', error);
            button.textContent = 'Import Failed';
            button.style.backgroundColor = '#dc3545'; // Red
            const failResetTimeout = setTimeout(() => {
                button.innerHTML = 'Import from Toolasha<span style="display:none;">Import solo/group</span>';
                button.style.backgroundColor = config.COLOR_ACCENT;
            }, 3000);
            timerRegistry.registerTimeout(failResetTimeout);
        }
    }

    /**
     * Select zone or dungeon in simulator
     * @param {string} zoneHrid - Zone action HRID
     * @param {boolean} isDungeon - Whether it's a dungeon
     */
    function selectZone(zoneHrid, isDungeon) {
        const dungeonToggle = document.querySelector('input#simDungeonToggle');

        if (isDungeon) {
            // Dungeon mode
            if (dungeonToggle) {
                dungeonToggle.checked = true;
                dungeonToggle.dispatchEvent(new Event('change'));
            }

            const dungeonTimeout = setTimeout(() => {
                const selectDungeon = document.querySelector('select#selectDungeon');
                if (selectDungeon) {
                    for (let i = 0; i < selectDungeon.options.length; i++) {
                        if (selectDungeon.options[i].value === zoneHrid) {
                            selectDungeon.options[i].selected = true;
                            selectDungeon.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
            }, 100);
            timerRegistry.registerTimeout(dungeonTimeout);
        } else {
            // Zone mode
            if (dungeonToggle) {
                dungeonToggle.checked = false;
                dungeonToggle.dispatchEvent(new Event('change'));
            }

            const zoneTimeout = setTimeout(() => {
                const selectZone = document.querySelector('select#selectZone');
                if (selectZone) {
                    for (let i = 0; i < selectZone.options.length; i++) {
                        if (selectZone.options[i].value === zoneHrid) {
                            selectZone.options[i].selected = true;
                            selectZone.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
            }, 100);
            timerRegistry.registerTimeout(zoneTimeout);
        }
    }

    var combatSimIntegration = /*#__PURE__*/Object.freeze({
        __proto__: null,
        disable: disable,
        initialize: initialize$1
    });

    /**
     * Milkonomy Export Module
     * Constructs player data in Milkonomy format for external tools
     */


    // Detect if we're running on Tampermonkey or Steam
    const hasScriptManager = typeof GM_info !== 'undefined';

    /**
     * Get character data from storage
     * @returns {Promise<Object|null>} Character data or null
     */
    async function getCharacterData() {
        try {
            // Tampermonkey: Use GM storage (cross-domain, persisted)
            if (hasScriptManager) {
                const data = await webSocketHook.loadFromStorage('toolasha_init_character_data', null);
                if (!data) {
                    console.error('[Milkonomy Export] No character data found');
                    return null;
                }
                return JSON.parse(data);
            }

            // Steam: Use dataManager (RAM only, no GM storage available)
            const characterData = dataManager.characterData;
            if (!characterData) {
                console.error('[Milkonomy Export] No character data found');
                return null;
            }
            return characterData;
        } catch (error) {
            console.error('[Milkonomy Export] Failed to get character data:', error);
            return null;
        }
    }

    /**
     * Map equipment slot types to Milkonomy format
     * @param {string} slotType - Game slot type
     * @returns {string} Milkonomy slot name
     */
    function mapSlotType(slotType) {
        const mapping = {
            '/equipment_types/milking_tool': 'milking_tool',
            '/equipment_types/foraging_tool': 'foraging_tool',
            '/equipment_types/woodcutting_tool': 'woodcutting_tool',
            '/equipment_types/cheesesmithing_tool': 'cheesesmithing_tool',
            '/equipment_types/crafting_tool': 'crafting_tool',
            '/equipment_types/tailoring_tool': 'tailoring_tool',
            '/equipment_types/cooking_tool': 'cooking_tool',
            '/equipment_types/brewing_tool': 'brewing_tool',
            '/equipment_types/alchemy_tool': 'alchemy_tool',
            '/equipment_types/enhancing_tool': 'enhancing_tool',
            '/equipment_types/legs': 'legs',
            '/equipment_types/body': 'body',
            '/equipment_types/charm': 'charm',
            '/equipment_types/off_hand': 'off_hand',
            '/equipment_types/head': 'head',
            '/equipment_types/hands': 'hands',
            '/equipment_types/feet': 'feet',
            '/equipment_types/neck': 'neck',
            '/equipment_types/earrings': 'earrings',
            '/equipment_types/ring': 'ring',
            '/equipment_types/pouch': 'pouch',
        };
        return mapping[slotType] || slotType;
    }

    /**
     * Get skill level by action type
     * @param {Array} skills - Character skills array
     * @param {string} actionType - Action type HRID (e.g., '/action_types/milking')
     * @returns {number} Skill level
     */
    function getSkillLevel(skills, actionType) {
        const skillHrid = actionType.replace('/action_types/', '/skills/');
        const skill = skills.find((s) => s.skillHrid === skillHrid);
        return skill?.level || 1;
    }

    /**
     * Map item location HRID to equipment slot type HRID
     * @param {string} locationHrid - Item location HRID (e.g., '/item_locations/brewing_tool')
     * @returns {string|null} Equipment slot type HRID or null
     */
    function locationToSlotType(locationHrid) {
        // Map item locations to equipment slot types
        // Location format: /item_locations/X
        // Slot type format: /equipment_types/X
        if (!locationHrid || !locationHrid.startsWith('/item_locations/')) {
            return null;
        }

        const slotName = locationHrid.replace('/item_locations/', '');
        return `/equipment_types/${slotName}`;
    }

    /**
     * Check if an item has stats for a specific skill
     * @param {Object} itemDetail - Item detail from game data
     * @param {string} skillName - Skill name (e.g., 'brewing', 'enhancing')
     * @returns {boolean} True if item has stats for this skill
     */
    function itemHasSkillStats(itemDetail, skillName) {
        if (!itemDetail || !itemDetail.equipmentDetail || !itemDetail.equipmentDetail.noncombatStats) {
            return false;
        }

        const stats = itemDetail.equipmentDetail.noncombatStats;

        // Check if any stat key contains the skill name (e.g., brewingSpeed, brewingEfficiency, brewingRareFind)
        for (const statKey of Object.keys(stats)) {
            if (statKey.toLowerCase().startsWith(skillName.toLowerCase())) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get best equipment for a specific skill and slot from entire inventory
     * @param {Array} inventory - Full inventory array from dataManager
     * @param {Object} gameData - Game data (initClientData)
     * @param {string} skillName - Skill name (e.g., 'brewing', 'enhancing')
     * @param {string} slotType - Equipment slot type (e.g., '/equipment_types/brewing_tool')
     * @returns {Object} Equipment object or empty object with just type
     */
    function getBestEquipmentForSkill(inventory, gameData, skillName, slotType) {
        if (!inventory || !gameData || !gameData.itemDetailMap) {
            return { type: mapSlotType(slotType) };
        }

        // Filter inventory for matching items
        const matchingItems = [];

        for (const invItem of inventory) {
            // Skip items without HRID
            if (!invItem.itemHrid) {
                continue;
            }

            const itemDetail = gameData.itemDetailMap[invItem.itemHrid];

            // Skip non-equipment items (resources, consumables, etc.)
            if (!itemDetail || !itemDetail.equipmentDetail) {
                continue;
            }

            // Check if item matches the slot type
            const itemSlotType = itemDetail.equipmentDetail.type;
            if (itemSlotType !== slotType) {
                continue;
            }

            // Check if item has stats for this skill
            if (!itemHasSkillStats(itemDetail, skillName)) {
                continue;
            }

            // Item matches! Add to candidates
            matchingItems.push({
                hrid: invItem.itemHrid,
                enhancementLevel: invItem.enhancementLevel || 0,
                name: itemDetail.name,
            });
        }

        // Sort by enhancement level (descending) and pick the best
        if (matchingItems.length > 0) {
            matchingItems.sort((a, b) => b.enhancementLevel - a.enhancementLevel);
            const best = matchingItems[0];

            const equipment = {
                type: mapSlotType(slotType),
                hrid: best.hrid,
            };

            // Only include enhanceLevel if the item can be enhanced (has the field)
            if (typeof best.enhancementLevel === 'number') {
                equipment.enhanceLevel = best.enhancementLevel > 0 ? best.enhancementLevel : null;
            }

            return equipment;
        }

        // No matching equipment found
        return { type: mapSlotType(slotType) };
    }

    /**
     * Get house room level for action type
     * @param {string} actionType - Action type HRID
     * @returns {number} House room level
     */
    function getHouseLevel(actionType) {
        const roomMapping = {
            '/action_types/milking': '/house_rooms/dairy_barn',
            '/action_types/foraging': '/house_rooms/garden',
            '/action_types/woodcutting': '/house_rooms/log_shed',
            '/action_types/cheesesmithing': '/house_rooms/forge',
            '/action_types/crafting': '/house_rooms/workshop',
            '/action_types/tailoring': '/house_rooms/sewing_parlor',
            '/action_types/cooking': '/house_rooms/kitchen',
            '/action_types/brewing': '/house_rooms/brewery',
            '/action_types/alchemy': '/house_rooms/laboratory',
            '/action_types/enhancing': '/house_rooms/observatory',
        };

        const roomHrid = roomMapping[actionType];
        if (!roomHrid) return 0;

        return dataManager.getHouseRoomLevel(roomHrid) || 0;
    }

    /**
     * Get active teas for action type
     * @param {string} actionType - Action type HRID
     * @returns {Array} Array of tea item HRIDs
     */
    function getActiveTeas(actionType) {
        const drinkSlots = dataManager.getActionDrinkSlots(actionType);
        if (!drinkSlots || drinkSlots.length === 0) return [];

        return drinkSlots.filter((slot) => slot && slot.itemHrid).map((slot) => slot.itemHrid);
    }

    /**
     * Construct action config for a skill
     * @param {string} skillName - Skill name (e.g., 'milking')
     * @param {Object} skills - Character skills array
     * @param {Array} inventory - Full inventory array
     * @param {Object} gameData - Game data (initClientData)
     * @returns {Object} Action config object
     */
    function constructActionConfig(skillName, skills, inventory, gameData) {
        const actionType = `/action_types/${skillName}`;
        const toolType = `/equipment_types/${skillName}_tool`;
        const legsType = '/equipment_types/legs';
        const bodyType = '/equipment_types/body';
        const charmType = '/equipment_types/charm';

        return {
            action: skillName,
            playerLevel: getSkillLevel(skills, actionType),
            tool: getBestEquipmentForSkill(inventory, gameData, skillName, toolType),
            legs: getBestEquipmentForSkill(inventory, gameData, skillName, legsType),
            body: getBestEquipmentForSkill(inventory, gameData, skillName, bodyType),
            charm: getBestEquipmentForSkill(inventory, gameData, skillName, charmType),
            houseLevel: getHouseLevel(actionType),
            tea: getActiveTeas(actionType),
        };
    }

    /**
     * Get equipment from currently equipped items (for special slots)
     * Only includes items that have noncombat (skilling) stats
     * @param {Map} equipmentMap - Currently equipped items map
     * @param {Object} gameData - Game data (initClientData)
     * @param {string} slotType - Equipment slot type (e.g., '/equipment_types/off_hand')
     * @returns {Object} Equipment object or empty object with just type
     */
    function getEquippedItem(equipmentMap, gameData, slotType) {
        for (const [locationHrid, item] of equipmentMap) {
            // Derive the slot type from the location HRID
            const itemSlotType = locationToSlotType(locationHrid);

            if (itemSlotType === slotType) {
                // Check if item has any noncombat (skilling) stats
                const itemDetail = gameData.itemDetailMap[item.itemHrid];
                if (!itemDetail || !itemDetail.equipmentDetail) {
                    // Skip items we can't look up
                    continue;
                }

                const noncombatStats = itemDetail.equipmentDetail.noncombatStats;
                if (!noncombatStats || Object.keys(noncombatStats).length === 0) {
                    // Item has no skilling stats (combat-only like Cheese Buckler) - skip it
                    continue;
                }

                // Item has skilling stats - include it
                const equipment = {
                    type: mapSlotType(slotType),
                    hrid: item.itemHrid,
                };

                // Only include enhanceLevel if the item has an enhancement level field
                if (typeof item.enhancementLevel === 'number') {
                    equipment.enhanceLevel = item.enhancementLevel > 0 ? item.enhancementLevel : null;
                }

                return equipment;
            }
        }

        // No equipment in this slot (or only combat-only items)
        return { type: mapSlotType(slotType) };
    }

    /**
     * Construct Milkonomy export object
     * @param {string|null} externalProfileId - Optional profile ID (for viewing other players' profiles)
     * @returns {Object|null} Milkonomy export data or null
     */
    async function constructMilkonomyExport(externalProfileId = null) {
        try {
            const characterData = await getCharacterData();
            if (!characterData) {
                console.error('[Milkonomy Export] No character data available');
                return null;
            }

            // Milkonomy export is only for your own character (no external profiles)
            if (externalProfileId) {
                console.error('[Milkonomy Export] External profile export not supported');
                alert(
                    'Milkonomy export is only available for your own profile.\n\nTo export another player:\n1. Use Combat Sim Export instead\n2. Or copy their profile link and open it separately'
                );
                return null;
            }

            const skills = characterData.characterSkills || [];
            const inventory = dataManager.getInventory();
            const equipmentMap = dataManager.getEquipment();
            const gameData = dataManager.getInitClientData();

            if (!inventory) {
                console.error('[Milkonomy Export] No inventory data available');
                return null;
            }

            if (!gameData) {
                console.error('[Milkonomy Export] No game data available');
                return null;
            }

            // Character name and color
            const name = characterData.name || 'Player';
            const color = '#90ee90'; // Default color (light green)

            // Build action config map for all 10 skills
            const skillNames = [
                'milking',
                'foraging',
                'woodcutting',
                'cheesesmithing',
                'crafting',
                'tailoring',
                'cooking',
                'brewing',
                'alchemy',
                'enhancing',
            ];

            const actionConfigMap = {};
            for (const skillName of skillNames) {
                actionConfigMap[skillName] = constructActionConfig(skillName, skills, inventory, gameData);
            }

            // Build special equipment map (non-skill-specific equipment)
            // Use currently equipped items for these slots
            const specialEquipmentMap = {};
            const specialSlots = [
                '/equipment_types/off_hand',
                '/equipment_types/head',
                '/equipment_types/hands',
                '/equipment_types/feet',
                '/equipment_types/neck',
                '/equipment_types/earrings',
                '/equipment_types/ring',
                '/equipment_types/pouch',
            ];

            for (const slotType of specialSlots) {
                const slotName = mapSlotType(slotType);
                const equipment = getEquippedItem(equipmentMap, gameData, slotType);
                if (equipment.hrid) {
                    specialEquipmentMap[slotName] = equipment;
                } else {
                    specialEquipmentMap[slotName] = { type: slotName };
                }
            }

            // Build community buff map
            const communityBuffMap = {};
            const buffTypes = ['experience', 'gathering_quantity', 'production_efficiency', 'enhancing_speed'];

            for (const buffType of buffTypes) {
                const buffHrid = `/community_buff_types/${buffType}`;
                const level = dataManager.getCommunityBuffLevel(buffHrid) || 0;
                communityBuffMap[buffType] = {
                    type: buffType,
                    hrid: buffHrid,
                    level: level,
                };
            }

            // Construct final export object
            return {
                name,
                color,
                actionConfigMap,
                specialEquimentMap: specialEquipmentMap,
                communityBuffMap,
            };
        } catch (error) {
            console.error('[Milkonomy Export] Export construction failed:', error);
            return null;
        }
    }

    /**
     * Combat Statistics Data Collector
     * Listens for new_battle WebSocket messages and stores combat data
     */


    class CombatStatsDataCollector {
        constructor() {
            this.isInitialized = false;
            this.newBattleHandler = null;
            this.consumableEventHandler = null; // NEW: for battle_consumable_ability_updated
            this.latestCombatData = null;
            this.currentBattleId = null;
            this.consumableActualConsumed = {}; // { characterId: { itemHrid: count } } - from consumption events
            this.trackingStartTime = {}; // { characterId: timestamp } - when we started tracking
        }

        /**
         * Initialize the data collector
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Store handler references for cleanup
            this.newBattleHandler = (data) => this.onNewBattle(data);
            this.consumableEventHandler = (data) => this.onConsumableUsed(data);

            // Listen for new_battle messages (fires during combat, continuously updated)
            webSocketHook.on('new_battle', this.newBattleHandler);

            // Listen for battle_consumable_ability_updated (fires on each consumable use)
            webSocketHook.on('battle_consumable_ability_updated', this.consumableEventHandler);
        }

        /**
         * Handle battle_consumable_ability_updated event (fires on each consumption)
         * NOTE: This event only fires for the CURRENT PLAYER (solo tracking)
         * @param {Object} data - Consumable update data
         */
        onConsumableUsed(data) {
            try {
                if (!data || !data.consumable || !data.consumable.itemHrid) {
                    return;
                }

                // Use 'current' key for solo player tracking (event only fires for current player)
                const characterId = 'current';

                // Initialize tracking for current player if needed
                if (!this.consumableActualConsumed[characterId]) {
                    this.consumableActualConsumed[characterId] = {};
                    this.trackingStartTime[characterId] = Date.now();
                }

                const itemHrid = data.consumable.itemHrid;

                // Initialize count for this item if first time seen
                if (!this.consumableActualConsumed[characterId][itemHrid]) {
                    this.consumableActualConsumed[characterId][itemHrid] = 0;
                }

                // Increment consumption count (this event fires once per use)
                this.consumableActualConsumed[characterId][itemHrid]++;
            } catch (error) {
                console.error('[Combat Stats] Error processing consumable event:', error);
            }
        }

        /**
         * Handle new_battle message (fires during combat)
         * @param {Object} data - new_battle message data
         */
        async onNewBattle(data) {
            try {
                // Only process if we have players data
                if (!data.players || data.players.length === 0) {
                    return;
                }

                // Detect new combat run (new battleId)
                const battleId = data.battleId || 0;

                // Only reset if we haven't initialized yet (first run after script load)
                // Don't reset on every battleId change since that happens every wave!

                // Calculate duration from combat start time
                const combatStartTime = new Date(data.combatStartTime).getTime() / 1000;
                const currentTime = Date.now() / 1000;
                const durationSeconds = currentTime - combatStartTime;

                // Extract combat data
                const combatData = {
                    timestamp: Date.now(),
                    battleId: battleId,
                    combatStartTime: data.combatStartTime,
                    durationSeconds: durationSeconds,
                    players: data.players.map((player, index) => {
                        const characterId = player.character.id;

                        // For the first player (current player), use event-based consumption tracking
                        // For other players (party members), we'd need snapshot-based tracking (TODO)
                        const trackingKey = index === 0 ? 'current' : characterId;

                        // Initialize tracking for this character if needed
                        if (!this.consumableActualConsumed[trackingKey]) {
                            this.consumableActualConsumed[trackingKey] = {};
                            this.trackingStartTime[trackingKey] = Date.now();
                        }

                        // Calculate time elapsed since we started tracking
                        const trackingStartTime = this.trackingStartTime[trackingKey] || Date.now();
                        const elapsedSeconds = (Date.now() - trackingStartTime) / 1000;

                        // Process consumables using event-based consumption data
                        const consumablesWithConsumed = [];
                        if (player.combatConsumables) {
                            for (const consumable of player.combatConsumables) {
                                // Get actual consumed count from consumption events
                                const totalActualConsumed =
                                    this.consumableActualConsumed[trackingKey]?.[consumable.itemHrid] || 0;

                                // MCS-style baseline: fixed item counts (not rates)
                                // Baseline assumes 2 drinks or 10 foods consumed in DEFAULT_TIME (600s)
                                const itemName = consumable.itemHrid.toLowerCase();
                                const isDrink = itemName.includes('coffee') || itemName.includes('drink');
                                const isFood =
                                    itemName.includes('donut') ||
                                    itemName.includes('cupcake') ||
                                    itemName.includes('cake') ||
                                    itemName.includes('gummy') ||
                                    itemName.includes('yogurt');

                                const defaultConsumed = isDrink ? 2 : isFood ? 10 : 0;

                                // MCS-style weighted average with DEFAULT_TIME constant
                                // Adds 10 minutes (600s) of baseline data to make estimates stable from start
                                const DEFAULT_TIME = 10 * 60; // 600 seconds
                                const actualRate = elapsedSeconds > 0 ? totalActualConsumed / elapsedSeconds : 0;
                                const combinedTotal = defaultConsumed + totalActualConsumed;
                                const combinedTime = DEFAULT_TIME + elapsedSeconds;
                                const combinedRate = combinedTotal / combinedTime;
                                // 90% actual rate + 10% combined (baseline+actual) rate
                                const consumptionRate = actualRate * 0.9 + combinedRate * 0.1;

                                // Estimate total consumed for the entire combat duration
                                const estimatedConsumed = consumptionRate * durationSeconds;

                                consumablesWithConsumed.push({
                                    itemHrid: consumable.itemHrid,
                                    currentCount: consumable.count,
                                    actualConsumed: totalActualConsumed,
                                    consumed: estimatedConsumed,
                                    consumptionRate: consumptionRate,
                                    elapsedSeconds: elapsedSeconds,
                                });
                            }
                        }

                        return {
                            name: player.character.name,
                            characterId: characterId,
                            loot: player.totalLootMap || {},
                            experience: player.totalSkillExperienceMap || {},
                            deathCount: player.deathCount || 0,
                            consumables: consumablesWithConsumed,
                            combatStats: {
                                combatDropQuantity: player.combatDetails?.combatStats?.combatDropQuantity || 0,
                                combatDropRate: player.combatDetails?.combatStats?.combatDropRate || 0,
                                combatRareFind: player.combatDetails?.combatStats?.combatRareFind || 0,
                                drinkConcentration: player.combatDetails?.combatStats?.drinkConcentration || 0,
                            },
                        };
                    }),
                };

                // Store in memory
                this.latestCombatData = combatData;

                // Store in IndexedDB (debounced - will update continuously during combat)
                await storage.setJSON('latestCombatRun', combatData, 'combatStats');
            } catch (error) {
                console.error('[Combat Stats] Error collecting combat data:', error);
            }
        }

        /**
         * Get the latest combat data
         * @returns {Object|null} Latest combat data
         */
        getLatestData() {
            return this.latestCombatData;
        }

        /**
         * Load latest combat data from storage
         * @returns {Promise<Object|null>} Latest combat data
         */
        async loadLatestData() {
            const data = await storage.getJSON('latestCombatRun', 'combatStats', null);
            if (data) {
                this.latestCombatData = data;
            }
            return data;
        }

        /**
         * Cleanup
         */
        cleanup() {
            if (this.newBattleHandler) {
                webSocketHook.off('new_battle', this.newBattleHandler);
                this.newBattleHandler = null;
            }

            if (this.consumableEventHandler) {
                webSocketHook.off('battle_consumable_ability_updated', this.consumableEventHandler);
                this.consumableEventHandler = null;
            }

            this.isInitialized = false;
            this.latestCombatData = null;
            this.currentBattleId = null;
            this.consumableActualConsumed = {};
            this.trackingStartTime = {};
        }
    }

    const combatStatsDataCollector = new CombatStatsDataCollector();

    /**
     * Combat Statistics Calculator
     * Calculates income, profit, consumable costs, and other statistics
     */


    /**
     * Calculate total income from loot
     * @param {Object} lootMap - totalLootMap from player data
     * @returns {Object} { ask: number, bid: number }
     */
    function calculateIncome(lootMap) {
        let totalAsk = 0;
        let totalBid = 0;

        if (!lootMap) {
            return { ask: 0, bid: 0 };
        }

        for (const loot of Object.values(lootMap)) {
            const itemCount = loot.count;

            // Coins are revenue at face value (1 coin = 1 gold)
            if (loot.itemHrid === '/items/coin') {
                totalAsk += itemCount;
                totalBid += itemCount;
            } else {
                // Other items: get market price
                const prices = marketAPI.getPrice(loot.itemHrid);
                if (prices) {
                    totalAsk += prices.ask * itemCount;
                    totalBid += prices.bid * itemCount;
                }
            }
        }

        return { ask: totalAsk, bid: totalBid };
    }

    /**
     * Calculate consumable costs based on actual consumption with baseline estimates
     * Uses weighted average: 90% actual data + 10% baseline estimate (like MCS)
     * @param {Array} consumables - combatConsumables array from player data (with consumed field)
     * @param {number} durationSeconds - Combat duration in seconds
     * @returns {Object} { total: number, breakdown: Array } Total cost and per-item breakdown
     */
    function calculateConsumableCosts(consumables, durationSeconds) {
        if (!consumables || consumables.length === 0 || !durationSeconds || durationSeconds <= 0) {
            return { total: 0, breakdown: [] };
        }

        let totalCost = 0;
        const breakdown = [];

        for (const consumable of consumables) {
            const consumed = consumable.consumed || 0;
            const actualConsumed = consumable.actualConsumed || 0;
            consumable.elapsedSeconds || 0;

            // Skip if no consumption (even estimated)
            if (consumed <= 0) {
                continue;
            }

            const prices = marketAPI.getPrice(consumable.itemHrid);
            const itemPrice = prices ? prices.ask : 500;
            const itemCost = itemPrice * consumed;

            totalCost += itemCost;

            // Get item name from data manager
            const itemDetails = dataManager.getItemDetails(consumable.itemHrid);
            const itemName = itemDetails?.name || consumable.itemHrid;

            breakdown.push({
                itemHrid: consumable.itemHrid,
                itemName: itemName,
                count: consumed, // Use estimated consumption
                pricePerItem: itemPrice,
                totalCost: itemCost,
                startingCount: consumable.startingCount,
                currentCount: consumable.currentCount,
                actualConsumed: actualConsumed,
                consumptionRate: consumable.consumptionRate,
                elapsedSeconds: consumable.elapsedSeconds || 0,
            });
        }

        return { total: totalCost, breakdown };
    }

    /**
     * Calculate total experience
     * @param {Object} experienceMap - totalSkillExperienceMap from player data
     * @returns {number} Total experience
     */
    function calculateTotalExperience(experienceMap) {
        if (!experienceMap) {
            return 0;
        }

        let total = 0;
        for (const exp of Object.values(experienceMap)) {
            total += exp;
        }

        return total;
    }

    /**
     * Calculate daily rate
     * @param {number} total - Total value
     * @param {number} durationSeconds - Duration in seconds
     * @returns {number} Value per day
     */
    function calculateDailyRate(total, durationSeconds) {
        if (durationSeconds <= 0) {
            return 0;
        }

        const durationDays = durationSeconds / 86400; // 86400 seconds in a day
        return total / durationDays;
    }

    /**
     * Format loot items for display
     * @param {Object} lootMap - totalLootMap from player data
     * @returns {Array} Array of { count, itemHrid, itemName, rarity }
     */
    function formatLootList(lootMap) {
        if (!lootMap) {
            return [];
        }

        const items = [];

        for (const loot of Object.values(lootMap)) {
            const itemDetails = dataManager.getItemDetails(loot.itemHrid);
            items.push({
                count: loot.count,
                itemHrid: loot.itemHrid,
                itemName: itemDetails?.name || 'Unknown',
                rarity: itemDetails?.rarity || 0,
            });
        }

        // Sort by rarity (descending), then by name
        items.sort((a, b) => {
            if (a.rarity !== b.rarity) {
                return b.rarity - a.rarity;
            }
            return a.itemName.localeCompare(b.itemName);
        });

        return items;
    }

    /**
     * Calculate all statistics for a player
     * @param {Object} playerData - Player data from combat data
     * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
     * @returns {Object} Calculated statistics
     */
    function calculatePlayerStats(playerData, durationSeconds = null) {
        // Calculate income
        const income = calculateIncome(playerData.loot);

        // Use provided duration or default to 0 (will show 0 for rates if no duration)
        const duration = durationSeconds || 0;

        // Calculate daily income
        const dailyIncomeAsk = duration > 0 ? calculateDailyRate(income.ask, duration) : 0;
        const dailyIncomeBid = duration > 0 ? calculateDailyRate(income.bid, duration) : 0;

        // Calculate consumable costs based on ACTUAL consumption
        const consumableData = calculateConsumableCosts(playerData.consumables, duration);
        const consumableCosts = consumableData.total;
        const consumableBreakdown = consumableData.breakdown;

        // Calculate daily consumable costs
        const dailyConsumableCosts = duration > 0 ? calculateDailyRate(consumableCosts, duration) : 0;

        // Calculate daily profit
        const dailyProfitAsk = dailyIncomeAsk - dailyConsumableCosts;
        const dailyProfitBid = dailyIncomeBid - dailyConsumableCosts;

        // Calculate total experience
        const totalExp = calculateTotalExperience(playerData.experience);

        // Calculate experience per hour
        const expPerHour = duration > 0 ? (totalExp / duration) * 3600 : 0;

        // Format loot list
        const lootList = formatLootList(playerData.loot);

        return {
            name: playerData.name,
            income: {
                ask: income.ask,
                bid: income.bid,
            },
            dailyIncome: {
                ask: dailyIncomeAsk,
                bid: dailyIncomeBid,
            },
            consumableCosts,
            consumableBreakdown,
            dailyConsumableCosts,
            dailyProfit: {
                ask: dailyProfitAsk,
                bid: dailyProfitBid,
            },
            totalExp,
            expPerHour,
            deathCount: playerData.deathCount,
            lootList,
            duration,
        };
    }

    /**
     * Calculate statistics for all players
     * @param {Object} combatData - Combat data from data collector
     * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
     * @returns {Array} Array of player statistics
     */
    function calculateAllPlayerStats(combatData, durationSeconds = null) {
        if (!combatData || !combatData.players) {
            return [];
        }

        // Calculate encounters per hour (EPH)
        const duration = durationSeconds || combatData.durationSeconds || 0;
        const battleId = combatData.battleId || 1;
        const encountersPerHour = duration > 0 ? (3600 * (battleId - 1)) / duration : 0;

        return combatData.players.map((player) => {
            const stats = calculatePlayerStats(player, durationSeconds);
            // Add EPH and formatted duration to each player's stats
            stats.encountersPerHour = encountersPerHour;
            stats.durationFormatted = formatDuration(duration);
            return stats;
        });
    }

    /**
     * Format duration in seconds to human-readable format
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration (e.g., "1h 23m", "3d 12h", "2mo 15d")
     */
    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) {
            return '0s';
        }

        if (seconds < 60) return `${Math.floor(seconds)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return m > 0 ? `${h}h ${m}m` : `${h}h`;
        }

        // Days
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        if (d >= 365) {
            const years = Math.floor(d / 365);
            const days = d % 365;
            if (days >= 30) {
                const months = Math.floor(days / 30);
                return `${years}y ${months}mo`;
            }
            return days > 0 ? `${years}y ${days}d` : `${years}y`;
        }
        if (d >= 30) {
            const months = Math.floor(d / 30);
            const days = d % 30;
            return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
        }
        return h > 0 ? `${d}d ${h}h` : `${d}d`;
    }

    /**
     * Combat Statistics UI
     * Injects button and displays statistics popup
     */


    class CombatStatsUI {
        constructor() {
            this.isInitialized = false;
            this.observer = null;
            this.popup = null;
        }

        /**
         * Initialize the UI
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Start observing for Combat panel
            this.startObserver();
        }

        /**
         * Start MutationObserver to watch for Combat panel
         */
        startObserver() {
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const addedNode of mutation.addedNodes) {
                        if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

                        // Check for Combat Panel appearing
                        if (addedNode.classList?.contains('MainPanel_subPanelContainer__1i-H9')) {
                            const combatPanel = addedNode.querySelector('[class*="CombatPanel_combatPanel"]');
                            if (combatPanel) {
                                this.injectButton();
                            }
                        }

                        // Check for initial page load
                        if (addedNode.classList?.contains('GamePage_contentPanel__Zx4FH')) {
                            const combatPanel = addedNode.querySelector('[class*="CombatPanel_combatPanel"]');
                            if (combatPanel) {
                                this.injectButton();
                            }
                        }
                    }
                }
            });

            this.observer.observe(document.body, { childList: true, subtree: true });

            // Try to inject button immediately if Combat panel is already visible
            setTimeout(() => this.injectButton(), 1000);
        }

        /**
         * Inject Statistics button into Combat panel tabs
         */
        injectButton() {
            // Find the tabs container
            const tabsContainer = document.querySelector(
                'div.GamePage_mainPanel__2njyb > div > div:nth-child(1) > div > div > div > div[class*="TabsComponent_tabsContainer"] > div > div > div'
            );

            if (!tabsContainer) {
                return;
            }

            // Check if button already exists
            if (tabsContainer.querySelector('.toolasha-combat-stats-btn')) {
                return;
            }

            // Create button
            const button = document.createElement('div');
            button.className =
                'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary css-1q2h7u5 toolasha-combat-stats-btn';
            button.textContent = 'Statistics';
            button.style.cursor = 'pointer';

            button.onclick = () => this.showPopup();

            // Insert button at the end
            const lastTab = tabsContainer.children[tabsContainer.children.length - 1];
            tabsContainer.insertBefore(button, lastTab.nextSibling);
        }

        /**
         * Share statistics to chat (triggered by Ctrl+Click on player card)
         * @param {Object} stats - Player statistics
         */
        shareStatsToChat(stats) {
            // Get chat message format from config (use getSettingValue for template type)
            const messageTemplate = config.getSettingValue('combatStatsChatMessage');

            // Convert array format to string if needed
            let message = '';
            if (Array.isArray(messageTemplate)) {
                // Format numbers
                const useKMB = config.getSetting('formatting_useKMBFormat');
                const formatNum = (num) => (useKMB ? formatters_js.coinFormatter(Math.round(num)) : formatters_js.formatWithSeparator(Math.round(num)));

                // Build message from array
                message = messageTemplate
                    .map((item) => {
                        if (item.type === 'variable') {
                            // Replace variable with actual value
                            switch (item.key) {
                                case '{income}':
                                    return formatNum(stats.income.bid);
                                case '{dailyIncome}':
                                    return formatNum(stats.dailyIncome.bid);
                                case '{dailyConsumableCosts}':
                                    return formatNum(stats.dailyConsumableCosts);
                                case '{dailyProfit}':
                                    return formatNum(stats.dailyProfit.bid);
                                case '{exp}':
                                    return formatNum(stats.expPerHour);
                                case '{deathCount}':
                                    return stats.deathCount.toString();
                                case '{encountersPerHour}':
                                    return formatNum(stats.encountersPerHour);
                                case '{duration}':
                                    return stats.durationFormatted || '0s';
                                default:
                                    return item.key;
                            }
                        } else {
                            // Plain text
                            return item.value;
                        }
                    })
                    .join('');
            } else {
                // Legacy string format (shouldn't happen, but handle it)
                const useKMB = config.getSetting('formatting_useKMBFormat');
                const formatNum = (num) => (useKMB ? formatters_js.coinFormatter(Math.round(num)) : formatters_js.formatWithSeparator(Math.round(num)));

                message = (messageTemplate || 'Combat Stats: {income} income | {dailyProfit} profit/d | {exp} exp/h')
                    .replace('{income}', formatNum(stats.income.bid))
                    .replace('{dailyIncome}', formatNum(stats.dailyIncome.bid))
                    .replace('{dailyProfit}', formatNum(stats.dailyProfit.bid))
                    .replace('{dailyConsumableCosts}', formatNum(stats.dailyConsumableCosts))
                    .replace('{exp}', formatNum(stats.expPerHour))
                    .replace('{deathCount}', stats.deathCount.toString());
            }

            // Insert into chat
            this.insertToChat(message);
        }

        /**
         * Insert text into chat input
         * @param {string} text - Text to insert
         */
        insertToChat(text) {
            const chatSelector =
                '#root > div > div > div.GamePage_gamePanel__3uNKN > div.GamePage_contentPanel__Zx4FH > div.GamePage_middlePanel__uDts7 > div.GamePage_chatPanel__mVaVt > div > div.Chat_chatInputContainer__2euR8 > form > input';
            const chatInput = document.querySelector(chatSelector);

            if (!chatInput) {
                console.error('[Combat Stats] Chat input not found');
                return;
            }

            // Use native value setter for React compatibility
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            const start = chatInput.selectionStart || 0;
            const end = chatInput.selectionEnd || 0;

            // Insert text at cursor position
            const newValue = chatInput.value.substring(0, start) + text + chatInput.value.substring(end);
            nativeInputValueSetter.call(chatInput, newValue);

            // Dispatch input event for React
            const event = new Event('input', {
                bubbles: true,
                cancelable: true,
            });
            chatInput.dispatchEvent(event);

            // Set cursor position after inserted text
            chatInput.selectionStart = chatInput.selectionEnd = start + text.length;
            chatInput.focus();
        }

        /**
         * Show statistics popup
         */
        async showPopup() {
            // Ensure market data is loaded
            if (!marketAPI.isLoaded()) {
                const marketData = await marketAPI.fetch();
                if (!marketData) {
                    console.error('[Combat Stats] Market data not available');
                    alert('Market data not available. Please try again.');
                    return;
                }
            }

            // Get latest combat data
            let combatData = combatStatsDataCollector.getLatestData();

            if (!combatData) {
                // Try to load from storage
                combatData = await combatStatsDataCollector.loadLatestData();
            }

            if (!combatData || !combatData.players || combatData.players.length === 0) {
                alert('No combat data available. Start a combat run first.');
                return;
            }

            // Recalculate duration from combat start time (updates in real-time during combat)
            let durationSeconds = null;
            if (combatData.combatStartTime) {
                const combatStartTime = new Date(combatData.combatStartTime).getTime() / 1000;
                const currentTime = Date.now() / 1000;
                durationSeconds = currentTime - combatStartTime;
            } else if (combatData.durationSeconds) {
                // Fallback to stored duration if no start time
                durationSeconds = combatData.durationSeconds;
            }

            if (!durationSeconds) {
                console.warn('[Combat Stats] No duration data available');
            }

            // Calculate statistics
            const playerStats = calculateAllPlayerStats(combatData, durationSeconds);

            // Create and show popup
            this.createPopup(playerStats);
        }

        /**
         * Create and display the statistics popup
         * @param {Array} playerStats - Array of player statistics
         */
        createPopup(playerStats) {
            // Remove existing popup if any
            if (this.popup) {
                this.closePopup();
            }

            // Get text color from config
            const textColor = config.getSetting('color_text_primary') || config.COLOR_TEXT_PRIMARY;

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'toolasha-combat-stats-overlay';
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

            // Create popup container
            const popup = document.createElement('div');
            popup.className = 'toolasha-combat-stats-popup';
            popup.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            max-width: 90%;
            max-height: 90%;
            overflow-y: auto;
            color: ${textColor};
        `;

            // Create header
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #3a3a3a;
            padding-bottom: 10px;
        `;

            const title = document.createElement('h2');
            title.textContent = 'Combat Statistics';
            title.style.cssText = `
            margin: 0;
            color: ${textColor};
            font-size: 24px;
        `;

            const closeButton = document.createElement('button');
            closeButton.textContent = '×';
            closeButton.style.cssText = `
            background: none;
            border: none;
            color: ${textColor};
            font-size: 32px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        `;
            closeButton.onclick = () => this.closePopup();

            header.appendChild(title);
            header.appendChild(closeButton);

            // Create player cards container
            const cardsContainer = document.createElement('div');
            cardsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            justify-content: center;
        `;

            // Create a card for each player
            for (const stats of playerStats) {
                const card = this.createPlayerCard(stats, textColor);
                cardsContainer.appendChild(card);
            }

            // Assemble popup
            popup.appendChild(header);
            popup.appendChild(cardsContainer);
            overlay.appendChild(popup);

            // Add to page
            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    this.closePopup();
                }
            };

            this.popup = overlay;
        }

        /**
         * Create a player statistics card
         * @param {Object} stats - Player statistics
         * @param {string} textColor - Text color
         * @returns {HTMLElement} Card element
         */
        createPlayerCard(stats, textColor) {
            const card = document.createElement('div');
            card.style.cssText = `
            background: #2a2a2a;
            border: 2px solid #4a4a4a;
            border-radius: 8px;
            padding: 15px;
            min-width: 300px;
            max-width: 400px;
            cursor: pointer;
        `;

            // Add Ctrl+Click handler to share to chat
            card.onclick = (e) => {
                if (e.ctrlKey || e.metaKey) {
                    this.shareStatsToChat(stats);
                    e.stopPropagation();
                }
            };

            // Player name
            const nameHeader = document.createElement('div');
            nameHeader.textContent = stats.name;
            nameHeader.style.cssText = `
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 15px;
            text-align: center;
            color: ${textColor};
            border-bottom: 1px solid #4a4a4a;
            padding-bottom: 8px;
        `;

            // Statistics rows
            // Use K/M/B formatting if enabled, otherwise use separators
            const useKMB = config.getSetting('formatting_useKMBFormat');
            const formatNum = (num) => (useKMB ? formatters_js.coinFormatter(Math.round(num)) : formatters_js.formatWithSeparator(Math.round(num)));

            const statsRows = [
                { label: 'Duration', value: stats.durationFormatted || '0s' },
                { label: 'Encounters/Hour', value: formatNum(stats.encountersPerHour) },
                { label: 'Income', value: formatNum(stats.income.bid) },
                { label: 'Daily Income', value: `${formatNum(stats.dailyIncome.bid)}/d` },
                {
                    label: 'Consumable Costs',
                    value: formatNum(stats.consumableCosts),
                    color: '#ff6b6b',
                    expandable: true,
                    breakdown: stats.consumableBreakdown,
                },
                {
                    label: 'Daily Consumable Costs',
                    value: `${formatNum(stats.dailyConsumableCosts)}/d`,
                    color: '#ff6b6b',
                    expandable: true,
                    breakdown: stats.consumableBreakdown,
                    isDaily: true,
                },
                {
                    label: 'Daily Profit',
                    value: `${formatNum(stats.dailyProfit.bid)}/d`,
                    color: stats.dailyProfit.bid >= 0 ? '#51cf66' : '#ff6b6b',
                },
                { label: 'Total EXP', value: formatNum(stats.totalExp) },
                { label: 'EXP/hour', value: `${formatNum(stats.expPerHour)}/h` },
                { label: 'Death Count', value: `${stats.deathCount}` },
            ];

            const statsContainer = document.createElement('div');
            statsContainer.style.cssText = 'margin-bottom: 15px;';

            for (const row of statsRows) {
                const rowDiv = document.createElement('div');
                rowDiv.style.cssText = `
                display: flex;
                justify-content: space-between;
                margin-bottom: 5px;
                font-size: 14px;
            `;

                const label = document.createElement('span');
                label.textContent = row.label + ':';
                label.style.color = textColor;

                const value = document.createElement('span');
                value.textContent = row.value;
                value.style.color = row.color || textColor;

                // Add expandable indicator if applicable
                if (row.expandable) {
                    rowDiv.style.cursor = 'pointer';
                    rowDiv.style.userSelect = 'none';
                    label.textContent = '▶ ' + row.label + ':';

                    let isExpanded = false;
                    let breakdownDiv = null;

                    rowDiv.onclick = () => {
                        isExpanded = !isExpanded;
                        label.textContent = (isExpanded ? '▼ ' : '▶ ') + row.label + ':';

                        if (isExpanded) {
                            // Create breakdown
                            breakdownDiv = document.createElement('div');
                            breakdownDiv.style.cssText = `
                            margin-left: 20px;
                            margin-top: 5px;
                            margin-bottom: 10px;
                            padding: 10px;
                            background: #1a1a1a;
                            border-left: 2px solid #4a4a4a;
                            font-size: 13px;
                        `;

                            if (row.breakdown && row.breakdown.length > 0) {
                                // Add header
                                const header = document.createElement('div');
                                header.style.cssText = `
                                display: grid;
                                grid-template-columns: 2fr 1fr 1fr 1fr;
                                gap: 10px;
                                font-weight: bold;
                                margin-bottom: 5px;
                                padding-bottom: 5px;
                                border-bottom: 1px solid #4a4a4a;
                                color: ${textColor};
                            `;
                                header.innerHTML = `
                                <span>Item</span>
                                <span style="text-align: right;">Consumed</span>
                                <span style="text-align: right;">Price</span>
                                <span style="text-align: right;">Cost</span>
                            `;
                                breakdownDiv.appendChild(header);

                                // Add each item
                                for (const item of row.breakdown) {
                                    const itemRow = document.createElement('div');
                                    itemRow.style.cssText = `
                                    display: grid;
                                    grid-template-columns: 2fr 1fr 1fr 1fr;
                                    gap: 10px;
                                    margin-bottom: 3px;
                                    color: ${textColor};
                                `;

                                    // For daily: show per-day quantities at same price
                                    // For total: show actual quantities and costs
                                    const displayQty = row.isDaily ? (item.count / stats.duration) * 86400 : item.count;

                                    const displayPrice = item.pricePerItem; // Price stays the same

                                    const displayCost = row.isDaily
                                        ? (item.totalCost / stats.duration) * 86400
                                        : item.totalCost;

                                    itemRow.innerHTML = `
                                    <span>${item.itemName}</span>
                                    <span style="text-align: right;">${formatNum(displayQty)}</span>
                                    <span style="text-align: right;">${formatNum(displayPrice)}</span>
                                    <span style="text-align: right; color: #ff6b6b;">${formatNum(displayCost)}</span>
                                `;
                                    breakdownDiv.appendChild(itemRow);
                                }

                                // Add total row
                                const totalRow = document.createElement('div');
                                totalRow.style.cssText = `
                                display: grid;
                                grid-template-columns: 2fr 1fr 1fr 1fr;
                                gap: 10px;
                                margin-top: 5px;
                                padding-top: 5px;
                                border-top: 1px solid #4a4a4a;
                                font-weight: bold;
                                color: ${textColor};
                            `;
                                totalRow.innerHTML = `
                                <span>Total</span>
                                <span></span>
                                <span></span>
                                <span style="text-align: right; color: #ff6b6b;">${row.value}</span>
                            `;
                                breakdownDiv.appendChild(totalRow);

                                // Add tracking info note
                                if (row.breakdown.length > 0) {
                                    const trackingNote = document.createElement('div');
                                    trackingNote.style.cssText = `
                                    margin-top: 8px;
                                    padding-top: 8px;
                                    border-top: 1px solid #3a3a3a;
                                    font-size: 11px;
                                    color: #888;
                                    font-style: italic;
                                `;

                                    // Format tracking duration
                                    const formatTrackingDuration = (seconds) => {
                                        if (seconds < 60) return `${seconds}s`;
                                        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
                                        if (seconds < 86400) {
                                            const h = Math.floor(seconds / 3600);
                                            const m = Math.floor((seconds % 3600) / 60);
                                            return m > 0 ? `${h}h ${m}m` : `${h}h`;
                                        }
                                        // Days
                                        const d = Math.floor(seconds / 86400);
                                        const h = Math.floor((seconds % 86400) / 3600);
                                        if (d >= 30) {
                                            const months = Math.floor(d / 30);
                                            const days = d % 30;
                                            return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
                                        }
                                        return h > 0 ? `${d}d ${h}h` : `${d}d`;
                                    };

                                    // Display tracking info with MCS-style calculation note
                                    const firstItem = row.breakdown[0];
                                    const trackingDuration = Math.floor(firstItem.elapsedSeconds || 0);
                                    const hasActualData = firstItem.actualConsumed > 0;

                                    if (!hasActualData) {
                                        trackingNote.textContent = `📊 Tracked ${formatTrackingDuration(trackingDuration)} - Using baseline rates (no consumption detected yet)`;
                                    } else {
                                        trackingNote.textContent = `📊 Tracked ${formatTrackingDuration(trackingDuration)} - Using 90% actual + 10% combined (baseline+actual)`;
                                    }

                                    breakdownDiv.appendChild(trackingNote);
                                }
                            } else if (breakdownDiv) {
                                breakdownDiv.textContent = 'No consumables used';
                                breakdownDiv.style.color = '#888';
                            }

                            rowDiv.after(breakdownDiv);
                        } else if (breakdownDiv) {
                            // Collapse - remove breakdown
                            breakdownDiv.remove();
                            breakdownDiv = null;
                        }
                    };
                }

                rowDiv.appendChild(label);
                rowDiv.appendChild(value);
                statsContainer.appendChild(rowDiv);
            }

            // Drop list
            if (stats.lootList && stats.lootList.length > 0) {
                const dropHeader = document.createElement('div');
                dropHeader.textContent = 'Drops';
                dropHeader.style.cssText = `
                font-weight: bold;
                margin-top: 10px;
                margin-bottom: 5px;
                color: ${textColor};
                border-top: 1px solid #4a4a4a;
                padding-top: 8px;
            `;

                const dropList = document.createElement('div');
                dropList.style.cssText = 'font-size: 13px;';

                // Show top 10 items
                const topItems = stats.lootList.slice(0, 10);
                for (const item of topItems) {
                    const itemDiv = document.createElement('div');
                    itemDiv.style.cssText = 'margin-bottom: 3px;';

                    const rarityColor = this.getRarityColor(item.rarity);
                    itemDiv.innerHTML = `<span style="color: ${textColor};">${item.count}</span> <span style="color: ${rarityColor};">× ${item.itemName}</span>`;

                    dropList.appendChild(itemDiv);
                }

                if (stats.lootList.length > 10) {
                    const moreDiv = document.createElement('div');
                    moreDiv.textContent = `... and ${stats.lootList.length - 10} more`;
                    moreDiv.style.cssText = `
                    font-style: italic;
                    color: #888;
                    margin-top: 5px;
                `;
                    dropList.appendChild(moreDiv);
                }

                statsContainer.appendChild(dropHeader);
                statsContainer.appendChild(dropList);
            }

            // Assemble card
            card.appendChild(nameHeader);
            card.appendChild(statsContainer);

            return card;
        }

        /**
         * Get color for item rarity
         * @param {number} rarity - Item rarity
         * @returns {string} Color hex code
         */
        getRarityColor(rarity) {
            switch (rarity) {
                case 6:
                    return '#64dbff'; // Mythic
                case 5:
                    return '#ff8888'; // Legendary
                case 4:
                    return '#ffa844'; // Epic
                case 3:
                    return '#e586ff'; // Rare
                case 2:
                    return '#a9d5ff'; // Uncommon
                case 1:
                    return '#b9f1be'; // Common
                default:
                    return '#b4b4b4'; // Normal
            }
        }

        /**
         * Close the popup
         */
        closePopup() {
            if (this.popup) {
                this.popup.remove();
                this.popup = null;
            }
        }

        /**
         * Cleanup
         */
        cleanup() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            this.closePopup();

            // Remove injected buttons
            const buttons = document.querySelectorAll('.toolasha-combat-stats-btn');
            for (const button of buttons) {
                button.remove();
            }

            this.isInitialized = false;
        }
    }

    const combatStatsUI = new CombatStatsUI();

    /**
     * Combat Statistics Feature
     * Main entry point for combat statistics tracking and display
     */


    /**
     * Initialize combat statistics feature
     */
    async function initialize() {
        // Initialize data collector (WebSocket listener)
        combatStatsDataCollector.initialize();

        // Initialize UI (button injection and popup)
        combatStatsUI.initialize();
    }

    /**
     * Cleanup combat statistics feature
     */
    function cleanup() {
        combatStatsDataCollector.cleanup();
        combatStatsUI.cleanup();
    }

    var combatStats = {
        name: 'Combat Statistics',
        initialize,
        cleanup,
    };

    /**
     * Ability Book Calculator
     * Shows number of books needed to reach target ability level
     * Appears in Item Dictionary when viewing ability books
     */


    /**
     * AbilityBookCalculator class handles ability book calculations in Item Dictionary
     */
    class AbilityBookCalculator {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
            this.isInitialized = false;
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('skillbook', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize the ability book calculator
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('skillbook')) {
                return;
            }

            this.isInitialized = true;

            // Register with centralized observer to watch for Item Dictionary modal
            this.unregisterObserver = domObserver.onClass(
                'AbilityBookCalculator',
                'ItemDictionary_modalContent__WvEBY',
                (dictContent) => {
                    this.handleItemDictionary(dictContent);
                }
            );

            this.isActive = true;
        }

        /**
         * Handle Item Dictionary modal
         * @param {Element} panel - Item Dictionary content element
         */
        async handleItemDictionary(panel) {
            try {
                // Extract ability HRID from modal title
                const abilityHrid = this.extractAbilityHrid(panel);
                if (!abilityHrid) {
                    return; // Not an ability book
                }

                // Get ability book data
                const itemHrid = abilityHrid.replace('/abilities/', '/items/');
                const gameData = dataManager.getInitClientData();
                if (!gameData) return;

                const itemDetails = gameData.itemDetailMap[itemHrid];
                if (!itemDetails?.abilityBookDetail) {
                    return; // Not an ability book
                }

                const xpPerBook = itemDetails.abilityBookDetail.experienceGain;

                // Get current ability level and XP
                const abilityData = this.getCurrentAbilityData(abilityHrid);

                // Inject calculator UI
                this.injectCalculator(panel, abilityData, xpPerBook, itemHrid);
            } catch (error) {
                console.error('[AbilityBookCalculator] Error handling dictionary:', error);
            }
        }

        /**
         * Extract ability HRID from modal title
         * @param {Element} panel - Item Dictionary content element
         * @returns {string|null} Ability HRID or null
         */
        extractAbilityHrid(panel) {
            const titleElement = panel.querySelector('h1.ItemDictionary_title__27cTd');
            if (!titleElement) return null;

            // Get the item name from title
            const itemName = titleElement.textContent.trim().toLowerCase().replaceAll(' ', '_').replaceAll("'", '');

            // Look up ability HRID from name
            const gameData = dataManager.getInitClientData();
            if (!gameData) return null;

            for (const abilityHrid of Object.keys(gameData.abilityDetailMap)) {
                if (abilityHrid.includes('/' + itemName)) {
                    return abilityHrid;
                }
            }

            return null;
        }

        /**
         * Get current ability level and XP from character data
         * @param {string} abilityHrid - Ability HRID
         * @returns {Object} {level, xp}
         */
        getCurrentAbilityData(abilityHrid) {
            // Get character abilities from live character data (NOT static game data)
            const characterData = dataManager.characterData;
            if (!characterData?.characterAbilities) {
                return { level: 0, xp: 0 };
            }

            // characterAbilities is an ARRAY of ability objects
            const ability = characterData.characterAbilities.find((a) => a.abilityHrid === abilityHrid);
            if (ability) {
                return {
                    level: ability.level || 0,
                    xp: ability.experience || 0,
                };
            }

            return { level: 0, xp: 0 };
        }

        /**
         * Calculate books needed to reach target level
         * @param {number} currentLevel - Current ability level
         * @param {number} currentXp - Current ability XP
         * @param {number} targetLevel - Target ability level
         * @param {number} xpPerBook - XP gained per book
         * @returns {number} Number of books needed
         */
        calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) return 0;

            const levelXpTable = gameData.levelExperienceTable;
            if (!levelXpTable) return 0;

            // Calculate XP needed to reach target level
            const targetXp = levelXpTable[targetLevel];
            const xpNeeded = targetXp - currentXp;

            // Calculate books needed
            let booksNeeded = xpNeeded / xpPerBook;

            // If starting from level 0, need +1 book to learn the ability initially
            if (currentLevel === 0) {
                booksNeeded += 1;
            }

            return booksNeeded;
        }

        /**
         * Inject calculator UI into Item Dictionary modal
         * @param {Element} panel - Item Dictionary content element
         * @param {Object} abilityData - {level, xp}
         * @param {number} xpPerBook - XP per book
         * @param {string} itemHrid - Item HRID for market prices
         */
        async injectCalculator(panel, abilityData, xpPerBook, itemHrid) {
            // Check if already injected
            if (panel.querySelector('.tillLevel')) {
                return;
            }

            const { level: currentLevel, xp: currentXp } = abilityData;
            const targetLevel = currentLevel + 1;

            // Calculate initial books needed
            const booksNeeded = this.calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook);

            // Get market prices
            const prices = marketAPI.getPrice(itemHrid, 0);
            const ask = prices?.ask || 0;
            const bid = prices?.bid || 0;

            // Create calculator HTML
            const calculatorDiv = dom.createStyledDiv(
                {
                    color: config.COLOR_ACCENT,
                    textAlign: 'left',
                    marginTop: '16px',
                    padding: '12px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px',
                },
                '',
                'tillLevel'
            );

            calculatorDiv.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 0.95em;">
                <strong>Current level:</strong> ${currentLevel}
            </div>
            <div style="margin-bottom: 8px;">
                <label for="tillLevelInput">To level: </label>
                <input
                    id="tillLevelInput"
                    type="number"
                    value="${targetLevel}"
                    min="${currentLevel + 1}"
                    max="200"
                    style="width: 60px; padding: 4px; background: #2a2a2a; color: white; border: 1px solid #555; border-radius: 3px;"
                >
            </div>
            <div id="tillLevelNumber" style="font-size: 0.95em;">
                Books needed: <strong>${formatters_js.numberFormatter(booksNeeded)}</strong>
                <br>
                Cost: ${formatters_js.numberFormatter(Math.ceil(booksNeeded * ask))} / ${formatters_js.numberFormatter(Math.ceil(booksNeeded * bid))} (ask / bid)
            </div>
            <div style="font-size: 0.85em; color: #999; margin-top: 8px; font-style: italic;">
                Refresh page to update current level
            </div>
        `;

            // Add event listeners for input changes
            const input = calculatorDiv.querySelector('#tillLevelInput');
            const display = calculatorDiv.querySelector('#tillLevelNumber');

            const updateDisplay = () => {
                const target = parseInt(input.value);

                if (target > currentLevel && target <= 200) {
                    const books = this.calculateBooksNeeded(currentLevel, currentXp, target, xpPerBook);
                    display.innerHTML = `
                    Books needed: <strong>${formatters_js.numberFormatter(books)}</strong>
                    <br>
                    Cost: ${formatters_js.numberFormatter(Math.ceil(books * ask))} / ${formatters_js.numberFormatter(Math.ceil(books * bid))} (ask / bid)
                `;
                } else {
                    display.innerHTML = '<span style="color: ${config.COLOR_LOSS};">Invalid target level</span>';
                }
            };

            input.addEventListener('change', updateDisplay);
            input.addEventListener('keyup', updateDisplay);

            // Try to find the left column by looking for the modal's main content structure
            // The Item Dictionary modal typically has its content in direct children of the panel
            const directChildren = Array.from(panel.children);

            // Look for a container that has exactly 2 children (two-column layout)
            for (const child of directChildren) {
                const grandchildren = Array.from(child.children).filter((c) => {
                    // Filter for visible elements that look like content columns
                    const style = window.getComputedStyle(c);
                    return style.display !== 'none' && c.offsetHeight > 50; // At least 50px tall
                });

                if (grandchildren.length === 2) {
                    // Found the two-column container! Use the left column (first child)
                    const leftColumn = grandchildren[0];
                    leftColumn.appendChild(calculatorDiv);
                    return;
                }
            }

            // Fallback: append to panel bottom (original behavior)
            panel.appendChild(calculatorDiv);
        }

        /**
         * Refresh colors on existing calculator displays
         */
        refresh() {
            // Update all .tillLevel elements
            document.querySelectorAll('.tillLevel').forEach((calc) => {
                calc.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const abilityBookCalculator = new AbilityBookCalculator();
    abilityBookCalculator.setupSettingListener();

    /**
     * Enhancement Tooltip Module
     *
     * Provides enhancement analysis for item tooltips.
     * Calculates optimal enhancement path and total costs for reaching current enhancement level.
     *
     * This module is part of Phase 2 of Option D (Hybrid Approach):
     * - Enhancement panel: Shows 20-level enhancement table
     * - Item tooltips: Shows optimal path to reach current enhancement level
     */


    /**
     * Calculate optimal enhancement path for an item
     * Matches Enhancelator's algorithm exactly:
     * 1. Test all protection strategies for each level
     * 2. Pick minimum cost for each level (mixed strategies)
     * 3. Apply mirror optimization to mixed array
     *
     * @param {string} itemHrid - Item HRID (e.g., '/items/cheese_sword')
     * @param {number} currentEnhancementLevel - Current enhancement level (1-20)
     * @param {Object} config - Enhancement configuration from enhancement-config.js
     * @returns {Object|null} Enhancement analysis or null if not enhanceable
     */
    function calculateEnhancementPath(itemHrid, currentEnhancementLevel, config) {
        // Validate inputs
        if (!itemHrid || currentEnhancementLevel < 1 || currentEnhancementLevel > 20) {
            return null;
        }

        // Get item details
        const gameData = dataManager.getInitClientData();
        if (!gameData) return null;

        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) return null;

        // Check if item is enhanceable
        if (!itemDetails.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
            return null;
        }

        const itemLevel = itemDetails.itemLevel || 1;

        // Step 1: Build 2D matrix like Enhancelator (all_results)
        // For each target level (1 to currentEnhancementLevel)
        // Test all protection strategies (0, 2, 3, ..., targetLevel)
        // Result: allResults[targetLevel][protectFrom] = cost data

        const allResults = [];

        for (let targetLevel = 1; targetLevel <= currentEnhancementLevel; targetLevel++) {
            const resultsForLevel = [];

            // Test "never protect" (0)
            const neverProtect = calculateCostForStrategy(itemHrid, targetLevel, 0, itemLevel, config);
            if (neverProtect) {
                resultsForLevel.push({ protectFrom: 0, ...neverProtect });
            }

            // Test all "protect from X" strategies (2 through targetLevel)
            for (let protectFrom = 2; protectFrom <= targetLevel; protectFrom++) {
                const result = calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config);
                if (result) {
                    resultsForLevel.push({ protectFrom, ...result });
                }
            }

            allResults.push(resultsForLevel);
        }

        // Step 2: Build target_costs array (minimum cost for each level)
        // Like Enhancelator line 451-453
        const targetCosts = new Array(currentEnhancementLevel + 1);
        targetCosts[0] = getRealisticBaseItemPrice(itemHrid); // Level 0: base item

        for (let level = 1; level <= currentEnhancementLevel; level++) {
            const resultsForLevel = allResults[level - 1];
            const minCost = Math.min(...resultsForLevel.map((r) => r.totalCost));
            targetCosts[level] = minCost;
        }

        // Step 3: Apply Philosopher's Mirror optimization (single pass, in-place)
        // Like Enhancelator lines 456-465
        const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
        let mirrorStartLevel = null;

        if (mirrorPrice > 0) {
            for (let level = 3; level <= currentEnhancementLevel; level++) {
                const traditionalCost = targetCosts[level];
                const mirrorCost = targetCosts[level - 2] + targetCosts[level - 1] + mirrorPrice;

                if (mirrorCost < traditionalCost) {
                    if (mirrorStartLevel === null) {
                        mirrorStartLevel = level;
                    }
                    targetCosts[level] = mirrorCost;
                }
            }
        }

        // Step 4: Build final result with breakdown
        targetCosts[currentEnhancementLevel];

        // Find which protection strategy was optimal for final level (before mirrors)
        const finalLevelResults = allResults[currentEnhancementLevel - 1];
        const optimalTraditional = finalLevelResults.reduce((best, curr) =>
            curr.totalCost < best.totalCost ? curr : best
        );

        let optimalStrategy;

        if (mirrorStartLevel !== null) {
            // Mirror was used - build mirror-optimized result
            optimalStrategy = buildMirrorOptimizedResult(
                itemHrid,
                currentEnhancementLevel,
                mirrorStartLevel,
                targetCosts,
                optimalTraditional,
                mirrorPrice);
        } else {
            // No mirror used - return traditional result
            optimalStrategy = {
                protectFrom: optimalTraditional.protectFrom,
                label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
                expectedAttempts: optimalTraditional.expectedAttempts,
                totalTime: optimalTraditional.totalTime,
                baseCost: optimalTraditional.baseCost,
                materialCost: optimalTraditional.materialCost,
                protectionCost: optimalTraditional.protectionCost,
                protectionItemHrid: optimalTraditional.protectionItemHrid,
                protectionCount: optimalTraditional.protectionCount,
                totalCost: optimalTraditional.totalCost,
                usedMirror: false,
                mirrorStartLevel: null,
            };
        }

        return {
            targetLevel: currentEnhancementLevel,
            itemLevel,
            optimalStrategy,
            allStrategies: [optimalStrategy], // Only return optimal
        };
    }

    /**
     * Calculate cost for a single protection strategy to reach a target level
     * @private
     */
    function calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config) {
        try {
            const params = {
                enhancingLevel: config.enhancingLevel,
                houseLevel: config.houseLevel,
                toolBonus: config.toolBonus || 0,
                speedBonus: config.speedBonus || 0,
                itemLevel,
                targetLevel,
                protectFrom,
                blessedTea: config.teas.blessed,
                guzzlingBonus: config.guzzlingBonus,
            };

            // Calculate enhancement statistics
            const result = enhancementCalculator_js.calculateEnhancement(params);

            if (!result || typeof result.attempts !== 'number' || typeof result.totalTime !== 'number') {
                console.error('[Enhancement Tooltip] Invalid result from calculateEnhancement:', result);
                return null;
            }

            // Calculate costs
            const costs = calculateTotalCost(itemHrid, targetLevel, protectFrom, config);

            return {
                expectedAttempts: result.attempts,
                totalTime: result.totalTime,
                ...costs,
            };
        } catch (error) {
            console.error('[Enhancement Tooltip] Strategy calculation error:', error);
            return null;
        }
    }

    /**
     * Build mirror-optimized result with Fibonacci quantities
     * @private
     */
    function buildMirrorOptimizedResult(
        itemHrid,
        targetLevel,
        mirrorStartLevel,
        targetCosts,
        optimalTraditional,
        mirrorPrice,
        _config
    ) {
        const gameData = dataManager.getInitClientData();
        gameData.itemDetailMap[itemHrid];

        // Calculate Fibonacci quantities for consumed items
        const n = targetLevel - mirrorStartLevel;
        const numLowerTier = fib(n); // Quantity of (mirrorStartLevel - 2) items
        const numUpperTier = fib(n + 1); // Quantity of (mirrorStartLevel - 1) items
        const numMirrors = mirrorFib(n); // Quantity of Philosopher's Mirrors

        const lowerTierLevel = mirrorStartLevel - 2;
        const upperTierLevel = mirrorStartLevel - 1;

        // Get cost of one item at each level from targetCosts
        const costLowerTier = targetCosts[lowerTierLevel];
        const costUpperTier = targetCosts[upperTierLevel];

        // Calculate total costs for consumed items and mirrors
        const totalLowerTierCost = numLowerTier * costLowerTier;
        const totalUpperTierCost = numUpperTier * costUpperTier;
        const totalMirrorsCost = numMirrors * mirrorPrice;

        // Build consumed items array for display
        const consumedItems = [
            {
                level: lowerTierLevel,
                quantity: numLowerTier,
                costEach: costLowerTier,
                totalCost: totalLowerTierCost,
            },
            {
                level: upperTierLevel,
                quantity: numUpperTier,
                costEach: costUpperTier,
                totalCost: totalUpperTierCost,
            },
        ];

        // For mirror phase: ONLY consumed items + mirrors
        // The consumed item costs from targetCosts already include base/materials/protection
        // NO separate base/materials/protection for main item!

        return {
            protectFrom: optimalTraditional.protectFrom,
            label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
            expectedAttempts: optimalTraditional.expectedAttempts,
            totalTime: optimalTraditional.totalTime,
            baseCost: 0, // Not applicable for mirror phase
            materialCost: 0, // Not applicable for mirror phase
            protectionCost: 0, // Not applicable for mirror phase
            protectionItemHrid: null,
            protectionCount: 0,
            consumedItemsCost: totalLowerTierCost + totalUpperTierCost,
            philosopherMirrorCost: totalMirrorsCost,
            totalCost: targetCosts[targetLevel], // Use recursive formula result for consistency
            mirrorStartLevel: mirrorStartLevel,
            usedMirror: true,
            traditionalCost: optimalTraditional.totalCost,
            consumedItems: consumedItems,
            mirrorCount: numMirrors,
        };
    }

    /**
     * Calculate total cost for enhancement path
     * Matches original MWI Tools v25.0 cost calculation
     * @private
     */
    function calculateTotalCost(itemHrid, targetLevel, protectFrom, config) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];
        const itemLevel = itemDetails.itemLevel || 1;

        // Calculate total attempts for full path (0 to targetLevel)
        const pathResult = enhancementCalculator_js.calculateEnhancement({
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel,
            protectFrom,
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus,
        });

        // Calculate per-action material cost (same for all enhancement levels)
        // enhancementCosts is a flat array of materials needed per attempt
        let perActionCost = 0;
        if (itemDetails.enhancementCosts) {
            for (const material of itemDetails.enhancementCosts) {
                const materialDetail = gameData.itemDetailMap[material.itemHrid];
                let price;

                // Special case: Trainee charms have fixed 250k price (untradeable)
                if (material.itemHrid.startsWith('/items/trainee_')) {
                    price = 250000;
                } else if (material.itemHrid === '/items/coin') {
                    price = 1; // Coins have face value of 1
                } else {
                    const marketPrice = marketData_js.getItemPrices(material.itemHrid, 0);
                    if (marketPrice) {
                        let ask = marketPrice.ask;
                        let bid = marketPrice.bid;

                        // Match MCS behavior: if one price is positive and other is negative, use positive for both
                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        // MCS uses just ask for material prices
                        price = ask;
                    } else {
                        // Fallback to sellPrice if no market data
                        price = materialDetail?.sellPrice || 0;
                    }
                }
                perActionCost += price * material.count;
            }
        }

        // Total material cost = per-action cost × total attempts
        const materialCost = perActionCost * pathResult.attempts;

        // Protection cost = cheapest protection option × protection count
        let protectionCost = 0;
        let protectionItemHrid = null;
        let protectionCount = 0;
        if (protectFrom > 0 && pathResult.protectionCount > 0) {
            const protectionInfo = getCheapestProtectionPrice(itemHrid);
            if (protectionInfo.price > 0) {
                protectionCost = protectionInfo.price * pathResult.protectionCount;
                protectionItemHrid = protectionInfo.itemHrid;
                protectionCount = pathResult.protectionCount;
            }
        }

        // Base item cost (initial investment) using realistic pricing
        const baseCost = getRealisticBaseItemPrice(itemHrid);

        return {
            baseCost,
            materialCost,
            protectionCost,
            protectionItemHrid,
            protectionCount,
            totalCost: baseCost + materialCost + protectionCost,
        };
    }

    /**
     * Get realistic base item price with production cost fallback
     * Matches original MWI Tools v25.0 getRealisticBaseItemPrice logic
     * @private
     */
    function getRealisticBaseItemPrice(itemHrid) {
        const marketPrice = marketData_js.getItemPrices(itemHrid, 0);
        const ask = marketPrice?.ask > 0 ? marketPrice.ask : 0;
        const bid = marketPrice?.bid > 0 ? marketPrice.bid : 0;

        // Calculate production cost as fallback
        const productionCost = getProductionCost(itemHrid);

        // If both ask and bid exist
        if (ask > 0 && bid > 0) {
            // If ask is significantly higher than bid (>30% markup), use max(bid, production)
            if (ask / bid > 1.3) {
                return Math.max(bid, productionCost);
            }
            // Otherwise use ask (normal market)
            return ask;
        }

        // If only ask exists
        if (ask > 0) {
            // If ask is inflated compared to production, use production
            if (productionCost > 0 && ask / productionCost > 1.3) {
                return productionCost;
            }
            // Otherwise use max of ask and production
            return Math.max(ask, productionCost);
        }

        // If only bid exists, use max(bid, production)
        if (bid > 0) {
            return Math.max(bid, productionCost);
        }

        // No market data - use production cost as fallback
        return productionCost;
    }

    /**
     * Calculate production cost from crafting recipe
     * Matches original MWI Tools v25.0 getBaseItemProductionCost logic
     * @private
     */
    function getProductionCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        if (!itemDetails || !itemDetails.name) {
            return 0;
        }

        // Find the action that produces this item
        let actionHrid = null;
        for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (action.outputItems && action.outputItems.length > 0) {
                const output = action.outputItems[0];
                if (output.itemHrid === itemHrid) {
                    actionHrid = hrid;
                    break;
                }
            }
        }

        if (!actionHrid) {
            return 0;
        }

        const action = gameData.actionDetailMap[actionHrid];
        let totalPrice = 0;

        // Sum up input material costs
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputPrice = marketData_js.getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
                totalPrice += inputPrice * input.count;
            }
        }

        // Apply Artisan Tea reduction (0.9x)
        totalPrice *= 0.9;

        // Add upgrade item cost if this is an upgrade recipe (for refined items)
        if (action.upgradeItemHrid) {
            const upgradePrice = marketData_js.getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
            totalPrice += upgradePrice;
        }

        return totalPrice;
    }

    /**
     * Get cheapest protection item price
     * Tests: item itself, mirror of protection, and specific protection items
     * @private
     */
    function getCheapestProtectionPrice(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        // Build list of protection options: [item itself, mirror, ...specific items]
        const protectionOptions = [itemHrid, '/items/mirror_of_protection'];

        // Add specific protection items if they exist
        if (itemDetails.protectionItemHrids && itemDetails.protectionItemHrids.length > 0) {
            protectionOptions.push(...itemDetails.protectionItemHrids);
        }

        // Find cheapest option
        let cheapestPrice = Infinity;
        let cheapestItemHrid = null;
        for (const protectionHrid of protectionOptions) {
            const price = getRealisticBaseItemPrice(protectionHrid);
            if (price > 0 && price < cheapestPrice) {
                cheapestPrice = price;
                cheapestItemHrid = protectionHrid;
            }
        }

        return {
            price: cheapestPrice === Infinity ? 0 : cheapestPrice,
            itemHrid: cheapestItemHrid,
        };
    }

    /**
     * Fibonacci calculation for item quantities (from Enhancelator)
     * @private
     */
    function fib(n) {
        if (n === 0 || n === 1) {
            return 1;
        }
        return fib(n - 1) + fib(n - 2);
    }

    /**
     * Mirror Fibonacci calculation for mirror quantities (from Enhancelator)
     * @private
     */
    function mirrorFib(n) {
        if (n === 0) {
            return 1;
        }
        if (n === 1) {
            return 2;
        }
        return mirrorFib(n - 1) + mirrorFib(n - 2) + 1;
    }

    /**
     * Combat Score Calculator
     * Calculates player gear score based on:
     * - House Score: Cost of battle houses
     * - Ability Score: Cost to reach current ability levels
     * - Equipment Score: Cost to enhance equipped items
     */


    /**
     * Token-based item data for untradeable back slot items (capes/cloaks/quivers)
     * These items are purchased with dungeon tokens and have no market data
     */
    const CAPE_ITEM_TOKEN_DATA = {
        '/items/chimerical_quiver': {
            tokenCost: 35000,
            tokenShopItems: [
                { hrid: '/items/griffin_leather', cost: 600 },
                { hrid: '/items/manticore_sting', cost: 1000 },
                { hrid: '/items/jackalope_antler', cost: 1200 },
                { hrid: '/items/dodocamel_plume', cost: 3000 },
                { hrid: '/items/griffin_talon', cost: 3000 },
            ],
        },
        '/items/sinister_cape': {
            tokenCost: 27000,
            tokenShopItems: [
                { hrid: '/items/acrobats_ribbon', cost: 2000 },
                { hrid: '/items/magicians_cloth', cost: 2000 },
                { hrid: '/items/chaotic_chain', cost: 3000 },
                { hrid: '/items/cursed_ball', cost: 3000 },
            ],
        },
        '/items/enchanted_cloak': {
            tokenCost: 27000,
            tokenShopItems: [
                { hrid: '/items/royal_cloth', cost: 2000 },
                { hrid: '/items/knights_ingot', cost: 2000 },
                { hrid: '/items/bishops_scroll', cost: 2000 },
                { hrid: '/items/regal_jewel', cost: 3000 },
                { hrid: '/items/sundering_jewel', cost: 3000 },
            ],
        },
    };

    /**
     * Calculate combat score from profile data
     * @param {Object} profileData - Profile data from game
     * @returns {Promise<Object>} {total, house, ability, equipment, breakdown}
     */
    async function calculateCombatScore(profileData) {
        try {
            // 1. Calculate House Score
            const houseResult = calculateHouseScore(profileData);

            // 2. Calculate Ability Score
            const abilityResult = calculateAbilityScore(profileData);

            // 3. Calculate Equipment Score
            const equipmentResult = calculateEquipmentScore(profileData);

            const totalScore = houseResult.score + abilityResult.score + equipmentResult.score;

            return {
                total: totalScore,
                house: houseResult.score,
                ability: abilityResult.score,
                equipment: equipmentResult.score,
                equipmentHidden: profileData.profile?.hideWearableItems || false,
                hasEquipmentData: equipmentResult.hasEquipmentData,
                breakdown: {
                    houses: houseResult.breakdown,
                    abilities: abilityResult.breakdown,
                    equipment: equipmentResult.breakdown,
                },
            };
        } catch (error) {
            console.error('[CombatScore] Error calculating score:', error);
            return {
                total: 0,
                house: 0,
                ability: 0,
                equipment: 0,
                equipmentHidden: false,
                hasEquipmentData: false,
                breakdown: { houses: [], abilities: [], equipment: [] },
            };
        }
    }

    /**
     * Get market price for an item with crafting cost fallback
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @returns {number} Price per item (always uses ask price, falls back to crafting cost)
     */
    function getMarketPriceWithFallback(itemHrid, enhancementLevel = 0) {
        const gameData = dataManager.getInitClientData();

        // Try ask price first
        const askPrice = marketData_js.getItemPrice(itemHrid, { enhancementLevel, mode: 'ask' });

        if (askPrice && askPrice > 0) {
            return askPrice;
        }

        // For base items (enhancement 0), try crafting cost fallback
        if (enhancementLevel === 0 && gameData) {
            // Find the action that produces this item
            for (const action of Object.values(gameData.actionDetailMap || {})) {
                if (action.outputItems) {
                    for (const output of action.outputItems) {
                        if (output.itemHrid === itemHrid) {
                            // Found the crafting action, calculate material costs
                            let inputCost = 0;

                            // Add input items
                            if (action.inputItems && action.inputItems.length > 0) {
                                for (const input of action.inputItems) {
                                    const inputPrice = getMarketPriceWithFallback(input.itemHrid, 0);
                                    inputCost += inputPrice * input.count;
                                }
                            }

                            // Apply Artisan Tea reduction (0.9x) to input materials
                            inputCost *= 0.9;

                            // Add upgrade item cost (not affected by Artisan Tea)
                            let upgradeCost = 0;
                            if (action.upgradeItemHrid) {
                                const upgradePrice = getMarketPriceWithFallback(action.upgradeItemHrid, 0);
                                upgradeCost = upgradePrice;
                            }

                            const totalCost = inputCost + upgradeCost;

                            // Divide by output count to get per-item cost
                            const perItemCost = totalCost / (output.count || 1);

                            if (perItemCost > 0) {
                                return perItemCost;
                            }
                        }
                    }
                }
            }

            // Try shop cost as final fallback (for shop-only items)
            const shopCost = getShopCost(itemHrid, gameData);
            if (shopCost > 0) {
                return shopCost;
            }
        }

        return 0;
    }

    /**
     * Get shop cost for an item (if purchaseable with coins)
     * @param {string} itemHrid - Item HRID
     * @param {Object} gameData - Game data object
     * @returns {number} Coin cost, or 0 if not in shop or not purchaseable with coins
     */
    function getShopCost(itemHrid, gameData) {
        if (!gameData) return 0;

        // Find shop item for this itemHrid
        for (const shopItem of Object.values(gameData.shopItemDetailMap || {})) {
            if (shopItem.itemHrid === itemHrid) {
                // Check if purchaseable with coins
                if (shopItem.costs && shopItem.costs.length > 0) {
                    const coinCost = shopItem.costs.find((cost) => cost.itemHrid === '/items/coin');
                    if (coinCost) {
                        return coinCost.count;
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Calculate house score from battle houses
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown}
     */
    function calculateHouseScore(profileData) {
        const characterHouseRooms = profileData.profile?.characterHouseRoomMap || {};

        const { totalCost, breakdown } = houseCostCalculator_js.calculateBattleHousesCost(characterHouseRooms);

        // Convert to score (cost / 1 million)
        const score = totalCost / 1_000_000;

        // Format breakdown for display
        const formattedBreakdown = breakdown.map((house) => ({
            name: `${house.name} ${house.level}`,
            value: (house.cost / 1_000_000).toFixed(1),
        }));

        return { score, breakdown: formattedBreakdown };
    }

    /**
     * Calculate ability score from equipped abilities
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown}
     */
    function calculateAbilityScore(profileData) {
        // Use equippedAbilities (not characterAbilities) to match MCS behavior
        const equippedAbilities = profileData.profile?.equippedAbilities || [];

        let totalCost = 0;
        const breakdown = [];

        for (const ability of equippedAbilities) {
            if (!ability.abilityHrid || ability.level === 0) continue;

            const cost = abilityCostCalculator_js.calculateAbilityCost(ability.abilityHrid, ability.level);
            totalCost += cost;

            // Format ability name for display
            const abilityName = ability.abilityHrid
                .replace('/abilities/', '')
                .split('_')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            breakdown.push({
                name: `${abilityName} ${ability.level}`,
                value: (cost / 1_000_000).toFixed(1),
            });
        }

        // Convert to score (cost / 1 million)
        const score = totalCost / 1_000_000;

        // Sort by value descending
        breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

        return { score, breakdown };
    }

    /**
     * Calculate token-based item value for untradeable back slot items
     * @param {string} itemHrid - Item HRID
     * @returns {number} Item value in coins (0 if not a token-based item)
     */
    function calculateTokenBasedItemValue(itemHrid) {
        const capeData = CAPE_ITEM_TOKEN_DATA[itemHrid];
        if (!capeData) {
            return 0; // Not a token-based item
        }

        // Find the best value per token from shop items
        let bestValuePerToken = 0;
        for (const shopItem of capeData.tokenShopItems) {
            // Use ask price for shop items (instant buy cost)
            const shopItemPrice = marketData_js.getItemPrice(shopItem.hrid, { mode: 'ask' }) || 0;
            if (shopItemPrice > 0) {
                const valuePerToken = shopItemPrice / shopItem.cost;
                if (valuePerToken > bestValuePerToken) {
                    bestValuePerToken = valuePerToken;
                }
            }
        }

        // Calculate total item value: best value per token × token cost
        return bestValuePerToken * capeData.tokenCost;
    }

    /**
     * Calculate equipment score from equipped items
     * @param {Object} profileData - Profile data
     * @returns {Object} {score, breakdown, hasEquipmentData}
     */
    function calculateEquipmentScore(profileData) {
        const equippedItems = profileData.profile?.wearableItemMap || {};
        const hideEquipment = profileData.profile?.hideWearableItems || false;

        // Check if equipment data is actually available
        // If wearableItemMap is populated, calculate score even if hideEquipment is true
        // (This happens when viewing party members - game sends equipment data despite privacy setting)
        const hasEquipmentData = Object.keys(equippedItems).length > 0;

        // If equipment is hidden AND no data available, return 0
        if (hideEquipment && !hasEquipmentData) {
            return { score: 0, breakdown: [], hasEquipmentData: false };
        }

        const gameData = dataManager.getInitClientData();
        if (!gameData) return { score: 0, breakdown: [], hasEquipmentData: false };

        let totalValue = 0;
        const breakdown = [];

        for (const [_slot, itemData] of Object.entries(equippedItems)) {
            if (!itemData?.itemHrid) continue;

            const itemHrid = itemData.itemHrid;
            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails) continue;

            // Get enhancement level from itemData (separate field, not in HRID)
            const enhancementLevel = itemData.enhancementLevel || 0;

            let itemCost = 0;

            // First, check if this is a token-based back slot item (cape/cloak/quiver)
            const tokenValue = calculateTokenBasedItemValue(itemHrid);
            if (tokenValue > 0) {
                itemCost = tokenValue;
            } else {
                // Check if high enhancement cost mode is enabled
                const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
                const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;

                // For high enhancement levels, use cost instead of market price (if enabled)
                if (enhancementLevel >= 1 && useHighEnhancementCost && enhancementLevel >= minLevel) {
                    // Calculate enhancement cost (ignore market price)
                    const enhancementParams = enhancementConfig_js.getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        itemCost = enhancementPath.optimalStrategy.totalCost;
                    } else {
                        // Enhancement calculation failed, fallback to base item price
                        console.warn(
                            '[Combat Score] Enhancement calculation failed for:',
                            itemHrid,
                            '+' + enhancementLevel
                        );
                        const basePrice = getMarketPriceWithFallback(itemHrid, 0);
                        itemCost = basePrice;
                    }
                } else {
                    // Try market price first (ask price with crafting cost fallback)
                    const marketPrice = getMarketPriceWithFallback(itemHrid, enhancementLevel);

                    if (marketPrice && marketPrice > 0) {
                        itemCost = marketPrice;
                    } else if (enhancementLevel > 1) {
                        // No market data - calculate enhancement cost
                        const enhancementParams = enhancementConfig_js.getEnhancingParams();
                        const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                        if (enhancementPath && enhancementPath.optimalStrategy) {
                            itemCost = enhancementPath.optimalStrategy.totalCost;
                        } else {
                            // Fallback to base market price if enhancement calculation fails
                            const basePrice = getMarketPriceWithFallback(itemHrid, 0);
                            itemCost = basePrice;
                        }
                    } else {
                        // Enhancement level 0 or 1, just use base market price with fallback
                        const basePrice = getMarketPriceWithFallback(itemHrid, 0);
                        itemCost = basePrice;
                    }
                }
            }

            totalValue += itemCost;

            // Format item name for display
            const itemName = itemDetails.name || itemHrid.replace('/items/', '');
            const displayName = enhancementLevel > 0 ? `${itemName} +${enhancementLevel}` : itemName;

            breakdown.push({
                name: displayName,
                value: (itemCost / 1_000_000).toFixed(1),
            });
        }

        // Convert to score (value / 1 million)
        const score = totalValue / 1_000_000;

        // Sort by value descending
        breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

        return { score, breakdown, hasEquipmentData };
    }

    /**
     * Combat Score Display
     * Shows player gear score in a floating panel next to profile modal
     */


    /**
     * CombatScore class manages combat score display on profiles
     */
    class CombatScore {
        constructor() {
            this.isActive = false;
            this.currentPanel = null;
            this.isInitialized = false;
            this.profileSharedHandler = null; // Store handler reference for cleanup
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('combatScore', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize combat score feature
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('combatScore')) {
                return;
            }

            this.isInitialized = true;

            this.profileSharedHandler = (data) => {
                this.handleProfileShared(data);
            };

            // Listen for profile_shared WebSocket messages
            webSocketHook.on('profile_shared', this.profileSharedHandler);

            this.isActive = true;
        }

        /**
         * Handle profile_shared WebSocket message
         * @param {Object} profileData - Profile data from WebSocket
         */
        async handleProfileShared(profileData) {
            // Extract character ID from profile data
            const characterId =
                profileData.profile.sharableCharacter?.id ||
                profileData.profile.characterSkills?.[0]?.characterID ||
                profileData.profile.character?.id;

            // Store the profile ID so export button can find it
            await storage.set('currentProfileId', characterId, 'combatExport', true);

            // Note: Memory cache is handled by websocket.js listener (don't duplicate here)

            // Wait for profile panel to appear in DOM
            const profilePanel = await this.waitForProfilePanel();
            if (!profilePanel) {
                console.error('[CombatScore] Could not find profile panel');
                return;
            }

            // Find the modal container
            const modalContainer =
                profilePanel.closest('.Modal_modalContent__Iw0Yv') ||
                profilePanel.closest('[class*="Modal"]') ||
                profilePanel.parentElement;

            if (modalContainer) {
                await this.handleProfileOpen(profileData, modalContainer);
            }
        }

        /**
         * Wait for profile panel to appear in DOM
         * @returns {Promise<Element|null>} Profile panel element or null if timeout
         */
        async waitForProfilePanel() {
            for (let i = 0; i < 20; i++) {
                const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
                if (panel) {
                    return panel;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return null;
        }

        /**
         * Handle profile modal opening
         * @param {Object} profileData - Profile data from WebSocket
         * @param {Element} modalContainer - Modal container element
         */
        async handleProfileOpen(profileData, modalContainer) {
            try {
                // Calculate combat score
                const scoreData = await calculateCombatScore(profileData);

                // Display score panel
                this.showScorePanel(profileData, scoreData, modalContainer);
            } catch (error) {
                console.error('[CombatScore] Error handling profile:', error);
            }
        }

        /**
         * Show combat score panel next to profile
         * @param {Object} profileData - Profile data
         * @param {Object} scoreData - Calculated score data
         * @param {Element} modalContainer - Modal container element
         */
        showScorePanel(profileData, scoreData, modalContainer) {
            // Remove existing panel if any
            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }

            const playerName = profileData.profile?.sharableCharacter?.name || 'Player';
            const equipmentHiddenText =
                scoreData.equipmentHidden && !scoreData.hasEquipmentData ? ' (Equipment hidden)' : '';

            // Create panel element
            const panel = document.createElement('div');
            panel.id = 'mwi-combat-score-panel';
            panel.style.cssText = `
            position: fixed;
            background: rgba(30, 30, 30, 0.98);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 12px;
            min-width: 180px;
            max-width: 280px;
            font-size: 0.875rem;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Build house breakdown HTML
            const houseBreakdownHTML = scoreData.breakdown.houses
                .map(
                    (item) =>
                        `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${formatters_js.numberFormatter(item.value)}</div>`
                )
                .join('');

            // Build ability breakdown HTML
            const abilityBreakdownHTML = scoreData.breakdown.abilities
                .map(
                    (item) =>
                        `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${formatters_js.numberFormatter(item.value)}</div>`
                )
                .join('');

            // Build equipment breakdown HTML
            const equipmentBreakdownHTML = scoreData.breakdown.equipment
                .map(
                    (item) =>
                        `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${formatters_js.numberFormatter(item.value)}</div>`
                )
                .join('');

            // Create panel HTML
            panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: bold; color: ${config.COLOR_ACCENT}; font-size: 0.9rem;">${playerName}</div>
                <span id="mwi-score-close-btn" style="
                    cursor: pointer;
                    font-size: 18px;
                    color: #aaa;
                    padding: 0 5px;
                    line-height: 1;
                " title="Close">×</span>
            </div>
            <div style="cursor: pointer; font-weight: bold; margin-bottom: 8px; color: ${config.COLOR_PROFIT};" id="mwi-score-toggle">
                + Combat Score: ${formatters_js.numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}
            </div>
            <div id="mwi-score-details" style="display: none; margin-left: 10px; color: ${config.COLOR_TEXT_PRIMARY};">
                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-house-toggle">
                    + House: ${formatters_js.numberFormatter(scoreData.house.toFixed(1))}
                </div>
                <div id="mwi-house-breakdown" style="display: none; margin-bottom: 6px;">
                    ${houseBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-ability-toggle">
                    + Ability: ${formatters_js.numberFormatter(scoreData.ability.toFixed(1))}
                </div>
                <div id="mwi-ability-breakdown" style="display: none; margin-bottom: 6px;">
                    ${abilityBreakdownHTML}
                </div>

                <div style="cursor: pointer; margin-bottom: 4px;" id="mwi-equipment-toggle">
                    + Equipment: ${formatters_js.numberFormatter(scoreData.equipment.toFixed(1))}
                </div>
                <div id="mwi-equipment-breakdown" style="display: none;">
                    ${equipmentBreakdownHTML}
                </div>
            </div>
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                <button id="mwi-combat-sim-export-btn" style="
                    padding: 8px 12px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    width: 100%;
                ">Combat Sim Export</button>
                <button id="mwi-milkonomy-export-btn" style="
                    padding: 8px 12px;
                    background: ${config.COLOR_ACCENT};
                    color: black;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.85rem;
                    width: 100%;
                ">Milkonomy Export</button>
            </div>
        `;

            document.body.appendChild(panel);
            this.currentPanel = panel;

            // Position panel next to modal
            this.positionPanel(panel, modalContainer);

            // Set up event listeners
            this.setupPanelEvents(panel, modalContainer, scoreData, equipmentHiddenText);

            // Set up cleanup observer
            this.setupCleanupObserver(panel, modalContainer);
        }

        /**
         * Position panel next to the modal
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         */
        positionPanel(panel, modal) {
            const modalRect = modal.getBoundingClientRect();
            const panelWidth = 220;
            const gap = 8;

            // Try right side first
            if (modalRect.right + gap + panelWidth < window.innerWidth) {
                panel.style.left = modalRect.right + gap + 'px';
            } else {
                // Fall back to left side
                panel.style.left = Math.max(10, modalRect.left - panelWidth - gap) + 'px';
            }

            panel.style.top = modalRect.top + 'px';
        }

        /**
         * Set up panel event listeners
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         * @param {Object} scoreData - Score data
         * @param {string} equipmentHiddenText - Equipment hidden text
         */
        setupPanelEvents(panel, modal, scoreData, equipmentHiddenText) {
            // Close button
            const closeBtn = panel.querySelector('#mwi-score-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    panel.remove();
                    this.currentPanel = null;
                });
                closeBtn.addEventListener('mouseover', () => {
                    closeBtn.style.color = '#fff';
                });
                closeBtn.addEventListener('mouseout', () => {
                    closeBtn.style.color = '#aaa';
                });
            }

            // Toggle main score details
            const toggleBtn = panel.querySelector('#mwi-score-toggle');
            const details = panel.querySelector('#mwi-score-details');
            if (toggleBtn && details) {
                toggleBtn.addEventListener('click', () => {
                    const isCollapsed = details.style.display === 'none';
                    details.style.display = isCollapsed ? 'block' : 'none';
                    toggleBtn.textContent =
                        (isCollapsed ? '- ' : '+ ') +
                        `Combat Score: ${formatters_js.numberFormatter(scoreData.total.toFixed(1))}${equipmentHiddenText}`;
                });
            }

            // Toggle house breakdown
            const houseToggle = panel.querySelector('#mwi-house-toggle');
            const houseBreakdown = panel.querySelector('#mwi-house-breakdown');
            if (houseToggle && houseBreakdown) {
                houseToggle.addEventListener('click', () => {
                    const isCollapsed = houseBreakdown.style.display === 'none';
                    houseBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    houseToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') + `House: ${formatters_js.numberFormatter(scoreData.house.toFixed(1))}`;
                });
            }

            // Toggle ability breakdown
            const abilityToggle = panel.querySelector('#mwi-ability-toggle');
            const abilityBreakdown = panel.querySelector('#mwi-ability-breakdown');
            if (abilityToggle && abilityBreakdown) {
                abilityToggle.addEventListener('click', () => {
                    const isCollapsed = abilityBreakdown.style.display === 'none';
                    abilityBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    abilityToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') + `Ability: ${formatters_js.numberFormatter(scoreData.ability.toFixed(1))}`;
                });
            }

            // Toggle equipment breakdown
            const equipmentToggle = panel.querySelector('#mwi-equipment-toggle');
            const equipmentBreakdown = panel.querySelector('#mwi-equipment-breakdown');
            if (equipmentToggle && equipmentBreakdown) {
                equipmentToggle.addEventListener('click', () => {
                    const isCollapsed = equipmentBreakdown.style.display === 'none';
                    equipmentBreakdown.style.display = isCollapsed ? 'block' : 'none';
                    equipmentToggle.textContent =
                        (isCollapsed ? '- ' : '+ ') + `Equipment: ${formatters_js.numberFormatter(scoreData.equipment.toFixed(1))}`;
                });
            }

            // Combat Sim Export button
            const combatSimBtn = panel.querySelector('#mwi-combat-sim-export-btn');
            if (combatSimBtn) {
                combatSimBtn.addEventListener('click', async () => {
                    await this.handleCombatSimExport(combatSimBtn);
                });
                combatSimBtn.addEventListener('mouseenter', () => {
                    combatSimBtn.style.opacity = '0.8';
                });
                combatSimBtn.addEventListener('mouseleave', () => {
                    combatSimBtn.style.opacity = '1';
                });
            }

            // Milkonomy Export button
            const milkonomyBtn = panel.querySelector('#mwi-milkonomy-export-btn');
            if (milkonomyBtn) {
                milkonomyBtn.addEventListener('click', async () => {
                    await this.handleMilkonomyExport(milkonomyBtn);
                });
                milkonomyBtn.addEventListener('mouseenter', () => {
                    milkonomyBtn.style.opacity = '0.8';
                });
                milkonomyBtn.addEventListener('mouseleave', () => {
                    milkonomyBtn.style.opacity = '1';
                });
            }
        }

        /**
         * Set up cleanup observer to remove panel when modal closes
         * @param {Element} panel - Score panel element
         * @param {Element} modal - Modal container element
         */
        setupCleanupObserver(panel, modal) {
            // Defensive check for document.body
            if (!document.body) {
                console.warn('[Combat Score] document.body not available for cleanup observer');
                return;
            }

            const cleanupObserver = domObserverHelpers_js.createMutationWatcher(
                document.body,
                () => {
                    if (
                        !document.body.contains(modal) ||
                        !document.querySelector('div.SharableProfile_overviewTab__W4dCV')
                    ) {
                        panel.remove();
                        this.currentPanel = null;
                        cleanupObserver();
                    }
                },
                {
                    childList: true,
                    subtree: true,
                }
            );
        }

        /**
         * Handle Combat Sim Export button click
         * @param {Element} button - Button element
         */
        async handleCombatSimExport(button) {
            const originalText = button.textContent;
            const originalBg = button.style.background;

            try {
                // Get current profile ID (if viewing someone else's profile)
                const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

                // Get export data in single-player format (for pasting into "Player 1 import" field)
                const exportData = await constructExportObject(currentProfileId, true);
                if (!exportData) {
                    button.textContent = '✗ No Data';
                    button.style.background = '${config.COLOR_LOSS}';
                    const resetTimeout = setTimeout(() => {
                        button.textContent = originalText;
                        button.style.background = originalBg;
                    }, 3000);
                    this.timerRegistry.registerTimeout(resetTimeout);
                    return;
                }

                const exportString = JSON.stringify(exportData.exportObj);
                await navigator.clipboard.writeText(exportString);

                button.textContent = '✓ Copied';
                button.style.background = '${config.COLOR_PROFIT}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
            } catch (error) {
                console.error('[Combat Score] Combat Sim export failed:', error);
                button.textContent = '✗ Failed';
                button.style.background = '${config.COLOR_LOSS}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
            }
        }

        /**
         * Handle Milkonomy Export button click
         * @param {Element} button - Button element
         */
        async handleMilkonomyExport(button) {
            const originalText = button.textContent;
            const originalBg = button.style.background;

            try {
                // Defensive: ensure currentProfileId is null when exporting own profile
                // This prevents stale data from blocking export
                await storage.set('currentProfileId', null, 'combatExport', true);
                profileManager_js.clearCurrentProfile();

                // Get current profile ID (should be null for own profile)
                const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

                // Get export data (pass profile ID if viewing external profile)
                const exportData = await constructMilkonomyExport(currentProfileId);
                if (!exportData) {
                    button.textContent = '✗ No Data';
                    button.style.background = '${config.COLOR_LOSS}';
                    const resetTimeout = setTimeout(() => {
                        button.textContent = originalText;
                        button.style.background = originalBg;
                    }, 3000);
                    this.timerRegistry.registerTimeout(resetTimeout);
                    return;
                }

                const exportString = JSON.stringify(exportData);
                await navigator.clipboard.writeText(exportString);

                button.textContent = '✓ Copied';
                button.style.background = '${config.COLOR_PROFIT}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
            } catch (error) {
                console.error('[Combat Score] Milkonomy export failed:', error);
                button.textContent = '✗ Failed';
                button.style.background = '${config.COLOR_LOSS}';
                const resetTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = originalBg;
                }, 3000);
                this.timerRegistry.registerTimeout(resetTimeout);
            }
        }

        /**
         * Refresh colors on existing panel
         */
        refresh() {
            if (!this.currentPanel) return;

            // Update title color
            const titleElem = this.currentPanel.querySelector('div[style*="font-weight: bold"]');
            if (titleElem) {
                titleElem.style.color = config.COLOR_ACCENT;
            }

            // Update both export buttons
            const buttons = this.currentPanel.querySelectorAll('button[id*="export-btn"]');
            buttons.forEach((button) => {
                button.style.background = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.profileSharedHandler) {
                webSocketHook.off('profile_shared', this.profileSharedHandler);
                this.profileSharedHandler = null;
            }

            this.timerRegistry.clearAll();

            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const combatScore = new CombatScore();
    combatScore.setupSettingListener();

    /**
     * Utilities to parse the MWI character share modal into a urpt string
     * for https://tib-san.github.io/mwi-character-sheet/. Food is not present in the modal, so it is
     * emitted as empty entries.
     *
     * Usage:
     *   import { buildCharacterSheetLink } from './character-sheet.js';
     *   const url = buildCharacterSheetLink(); // assumes modal is open in DOM
     */


    /**
     * Build character sheet segments from cached character data
     * @param {Object} characterData - Character data from dataManager or profile cache
     * @param {Object} clientData - Init client data for lookups
     * @param {Object} consumablesData - Optional character data containing consumables (for profile_shared data)
     * @returns {Object} Character sheet segments
     */
    function buildSegmentsFromCharacterData(characterData, clientData, consumablesData = null) {
        if (!characterData) {
            throw new Error('Character data is required');
        }

        // Use consumablesData if provided, otherwise try characterData
        const dataForConsumables = consumablesData || characterData;

        // Extract general info
        const character = characterData.sharableCharacter || characterData;
        const name = character.name || 'Player';

        // Avatar/outfit/icon - extract from sharableCharacter first, then fall back to items
        let avatar = 'person_default';
        let outfit = 'tshirt_default';
        let nameIcon = '';
        let nameColor = '';

        // Extract from sharableCharacter object (profile_shared data)
        if (character.avatarHrid) {
            avatar = character.avatarHrid.replace('/avatars/', '');
        }
        if (character.avatarOutfitHrid) {
            outfit = character.avatarOutfitHrid.replace('/avatar_outfits/', '');
        }
        if (character.chatIconHrid) {
            nameIcon = character.chatIconHrid.replace('/chat_icons/', '');
        }

        // Try to get avatar/outfit from character items
        if (characterData.characterItems) {
            for (const item of characterData.characterItems) {
                if (item.itemLocationHrid === '/item_locations/avatar') {
                    avatar = item.itemHrid.replace('/items/', '');
                } else if (item.itemLocationHrid === '/item_locations/outfit') {
                    outfit = item.itemHrid.replace('/items/', '');
                } else if (item.itemLocationHrid === '/item_locations/chat_icon') {
                    nameIcon = item.itemHrid.replace('/items/', '');
                }
            }
        }
        // Check wearableItemMap (for profile_shared data)
        else if (characterData.wearableItemMap) {
            if (characterData.wearableItemMap['/item_locations/avatar']) {
                avatar = characterData.wearableItemMap['/item_locations/avatar'].itemHrid.replace('/items/', '');
            }
            if (characterData.wearableItemMap['/item_locations/outfit']) {
                outfit = characterData.wearableItemMap['/item_locations/outfit'].itemHrid.replace('/items/', '');
            }
            if (characterData.wearableItemMap['/item_locations/chat_icon']) {
                nameIcon = characterData.wearableItemMap['/item_locations/chat_icon'].itemHrid.replace('/items/', '');
            }
        }

        // Name color - try to extract from character data
        if (character.chatBorderColorHrid) {
            nameColor = character.chatBorderColorHrid.replace('/chat_border_colors/', '');
        }

        const general = [name, avatar, outfit, nameIcon, nameColor].join(',');

        // Extract skills
        const skillMap = {};
        if (characterData.characterSkills) {
            for (const skill of characterData.characterSkills) {
                const skillName = skill.skillHrid.replace('/skills/', '');
                skillMap[skillName] = skill.level || 0;
            }
        }

        const skills = [
            skillMap.combat || '',
            skillMap.stamina || '',
            skillMap.intelligence || '',
            skillMap.attack || '',
            skillMap.defense || '',
            skillMap.melee || '',
            skillMap.ranged || '',
            skillMap.magic || '',
        ].join(',');

        // Extract equipment
        const equipmentSlots = {
            back: '',
            head: '',
            trinket: '',
            main_hand: '',
            body: '',
            off_hand: '',
            hands: '',
            legs: '',
            pouch: '',
            shoes: '',
            necklace: '',
            earrings: '',
            ring: '',
            charm: '',
        };

        const slotMapping = {
            // For characterItems (own character data)
            '/equipment_types/back': 'back',
            '/equipment_types/head': 'head',
            '/equipment_types/trinket': 'trinket',
            '/equipment_types/main_hand': 'main_hand',
            '/equipment_types/two_hand': 'main_hand',
            '/equipment_types/body': 'body',
            '/equipment_types/off_hand': 'off_hand',
            '/equipment_types/hands': 'hands',
            '/equipment_types/legs': 'legs',
            '/equipment_types/pouch': 'pouch',
            '/equipment_types/feet': 'shoes',
            '/equipment_types/neck': 'necklace',
            '/equipment_types/earrings': 'earrings',
            '/equipment_types/ring': 'ring',
            '/equipment_types/charm': 'charm',
            // For wearableItemMap (profile_shared data)
            '/item_locations/back': 'back',
            '/item_locations/head': 'head',
            '/item_locations/trinket': 'trinket',
            '/item_locations/main_hand': 'main_hand',
            '/item_locations/two_hand': 'main_hand',
            '/item_locations/body': 'body',
            '/item_locations/off_hand': 'off_hand',
            '/item_locations/hands': 'hands',
            '/item_locations/legs': 'legs',
            '/item_locations/pouch': 'pouch',
            '/item_locations/feet': 'shoes',
            '/item_locations/neck': 'necklace',
            '/item_locations/earrings': 'earrings',
            '/item_locations/ring': 'ring',
            '/item_locations/charm': 'charm',
        };

        if (characterData.characterItems) {
            for (const item of characterData.characterItems) {
                if (item.itemLocationHrid && item.itemLocationHrid.startsWith('/equipment_types/')) {
                    const slot = slotMapping[item.itemLocationHrid];
                    if (slot) {
                        const itemId = item.itemHrid.replace('/items/', '');
                        const enhancement = item.enhancementLevel || 0;
                        equipmentSlots[slot] = enhancement > 0 ? `${itemId}.${enhancement}` : `${itemId}.`;
                    }
                }
            }
        }
        // Check for wearableItemMap (profile data from other players)
        else if (characterData.wearableItemMap) {
            for (const key in characterData.wearableItemMap) {
                const item = characterData.wearableItemMap[key];
                const slot = slotMapping[item.itemLocationHrid];
                if (slot) {
                    const itemId = item.itemHrid.replace('/items/', '');
                    const enhancement = item.enhancementLevel || 0;
                    equipmentSlots[slot] = enhancement > 0 ? `${itemId}.${enhancement}` : `${itemId}.`;
                }
            }
        }

        const equipment = [
            equipmentSlots.back,
            equipmentSlots.head,
            equipmentSlots.trinket,
            equipmentSlots.main_hand,
            equipmentSlots.body,
            equipmentSlots.off_hand,
            equipmentSlots.hands,
            equipmentSlots.legs,
            equipmentSlots.pouch,
            equipmentSlots.shoes,
            equipmentSlots.necklace,
            equipmentSlots.earrings,
            equipmentSlots.ring,
            equipmentSlots.charm,
        ].join(',');

        // Extract abilities
        const abilitySlots = new Array(8).fill('');

        if (characterData.combatUnit?.combatAbilities || characterData.equippedAbilities) {
            // equippedAbilities (profile data) or combatUnit.combatAbilities (own character)
            const abilities = characterData.equippedAbilities || characterData.combatUnit?.combatAbilities || [];

            // Separate special and normal abilities
            let specialAbility = null;
            const normalAbilities = [];

            for (const ability of abilities) {
                if (!ability || !ability.abilityHrid) continue;

                const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

                if (isSpecial) {
                    specialAbility = ability;
                } else {
                    normalAbilities.push(ability);
                }
            }

            // Format abilities: slots 2-5 are normal abilities, slot 1 is special
            // But render-map expects them in order 1-8, so we need to rotate
            const orderedAbilities = [...normalAbilities.slice(0, 4)];
            if (specialAbility) {
                orderedAbilities.push(specialAbility);
            }

            orderedAbilities.forEach((ability, i) => {
                const abilityId = ability.abilityHrid.replace('/abilities/', '');
                const level = ability.level || 1;
                abilitySlots[i] = `${abilityId}.${level}`;
            });
        }

        const abilitiesStr = abilitySlots.join(',');

        // Extract food and drinks (consumables)
        // Use dataForConsumables (from parameter) instead of characterData
        const foodSlots = dataForConsumables.actionTypeFoodSlotsMap?.['/action_types/combat'];
        const drinkSlots = dataForConsumables.actionTypeDrinkSlotsMap?.['/action_types/combat'];
        const food = formatFoodData(foodSlots, drinkSlots);

        // Extract housing
        const housingLevels = {
            dining_room: '',
            library: '',
            dojo: '',
            armory: '',
            gym: '',
            archery_range: '',
            mystical_study: '',
        };

        const houseMapping = {
            '/house_rooms/dining_room': 'dining_room',
            '/house_rooms/library': 'library',
            '/house_rooms/dojo': 'dojo',
            '/house_rooms/armory': 'armory',
            '/house_rooms/gym': 'gym',
            '/house_rooms/archery_range': 'archery_range',
            '/house_rooms/mystical_study': 'mystical_study',
        };

        if (characterData.characterHouseRoomMap) {
            for (const [hrid, room] of Object.entries(characterData.characterHouseRoomMap)) {
                const key = houseMapping[hrid];
                if (key) {
                    housingLevels[key] = room.level || '';
                }
            }
        }

        const housing = [
            housingLevels.dining_room,
            housingLevels.library,
            housingLevels.dojo,
            housingLevels.armory,
            housingLevels.gym,
            housingLevels.archery_range,
            housingLevels.mystical_study,
        ].join(',');

        // Extract achievements (6 tiers: Beginner, Novice, Adept, Veteran, Elite, Champion)
        const achievementTiers = ['Beginner', 'Novice', 'Adept', 'Veteran', 'Elite', 'Champion'];
        const achievementFlags = new Array(6).fill('0');

        if (characterData.characterAchievements && clientData?.achievementDetailMap) {
            const tierCounts = {};

            // Count completed achievements by tier
            // characterAchievements only has achievementHrid and isCompleted
            // Need to look up tierHrid from achievementDetailMap
            for (const achievement of characterData.characterAchievements) {
                // Only count completed achievements
                if (!achievement.isCompleted || !achievement.achievementHrid) {
                    continue;
                }

                // Look up achievement details to get tier
                const achDetails = clientData.achievementDetailMap[achievement.achievementHrid];
                if (achDetails?.tierHrid) {
                    // Extract tier name from HRID: /achievement_tiers/veteran -> Veteran
                    const tierName = achDetails.tierHrid.replace('/achievement_tiers/', '');
                    const tierNameCapitalized = tierName.charAt(0).toUpperCase() + tierName.slice(1);
                    tierCounts[tierNameCapitalized] = (tierCounts[tierNameCapitalized] || 0) + 1;
                }
            }

            // Count total achievements per tier from achievementDetailMap
            const tierTotals = {};
            for (const achData of Object.values(clientData.achievementDetailMap)) {
                if (achData.tierHrid) {
                    // Extract tier name from HRID: /achievement_tiers/veteran -> Veteran
                    const tierName = achData.tierHrid.replace('/achievement_tiers/', '');
                    const tierNameCapitalized = tierName.charAt(0).toUpperCase() + tierName.slice(1);
                    tierTotals[tierNameCapitalized] = (tierTotals[tierNameCapitalized] || 0) + 1;
                }
            }

            // Set flags: 1 if tier is complete (have === total), 0 otherwise
            achievementTiers.forEach((tier, i) => {
                const have = tierCounts[tier] || 0;
                const total = tierTotals[tier] || 0;
                achievementFlags[i] = have > 0 && have === total ? '1' : '0';
            });
        }

        const achievements = achievementFlags.join('');

        return {
            general,
            skills,
            equipment,
            abilities: abilitiesStr,
            food,
            housing,
            achievements,
        };
    }

    function buildUrptString(segments) {
        if (!segments) throw new Error('Segments are required to build urpt');
        const { general, skills, equipment, abilities, food, housing, achievements } = segments;
        return [general, skills, equipment, abilities, food, housing, achievements].join(';');
    }

    /**
     * Format food and drink data for character sheet
     * @param {Array} foodSlots - Array of food items from actionTypeFoodSlotsMap
     * @param {Array} drinkSlots - Array of drink items from actionTypeDrinkSlotsMap
     * @returns {string} Comma-separated list of 6 item IDs (food 1-3, drink 1-3)
     */
    function formatFoodData(foodSlots, drinkSlots) {
        const slots = new Array(6).fill('');

        // Fill food slots (1-3)
        if (Array.isArray(foodSlots)) {
            foodSlots.slice(0, 3).forEach((item, i) => {
                if (item && item.itemHrid) {
                    // Strip '/items/' prefix
                    slots[i] = item.itemHrid.replace('/items/', '');
                }
            });
        }

        // Fill drink slots (4-6)
        if (Array.isArray(drinkSlots)) {
            drinkSlots.slice(0, 3).forEach((item, i) => {
                if (item && item.itemHrid) {
                    // Strip '/items/' prefix
                    slots[i + 3] = item.itemHrid.replace('/items/', '');
                }
            });
        }

        return slots.join(',');
    }

    /**
     * Extracts character data from the share modal and builds a render URL.
     * @param {Element} modal - Profile modal element (optional, for DOM fallback)
     * @param {string} baseUrl - Base URL for character sheet
     * @param {Object} characterData - Character data from cache (preferred)
     * @param {Object} clientData - Init client data for lookups
     * @param {Object} consumablesData - Optional character data containing consumables (for profile_shared data)
     * @returns {string} Character sheet URL
     */
    function buildCharacterSheetLink(
        _modal = document.querySelector('.SharableProfile_modal__2OmCQ'),
        baseUrl = 'https://tib-san.github.io/mwi-character-sheet/',
        characterData = null,
        clientData = null,
        consumablesData = null
    ) {
        let segments;

        // Prefer cached character data over DOM parsing
        if (characterData && clientData) {
            segments = buildSegmentsFromCharacterData(characterData, clientData, consumablesData);
        } else {
            // DOM parsing fallback not yet implemented
            throw new Error('Character data and client data are required (DOM parsing not implemented)');
        }

        const urpt = buildUrptString(segments);
        const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        return `${base}?urpt=${urpt}`;
    }

    /**
     * Character Card Button
     * Adds a "View Card" button to profile view that opens character sheet in new tab
     */


    /**
     * CharacterCardButton class manages character card export button on profiles
     */
    class CharacterCardButton {
        constructor() {
            this.isActive = false;
            this.isInitialized = false;
            this.currentProfileData = null; // Store profile data for food/drinks
            this.profileSharedHandler = null; // Store handler reference for cleanup
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('characterCard', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize character card button feature
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('characterCard')) {
                return;
            }

            this.isInitialized = true;

            this.profileSharedHandler = (data) => {
                this.handleProfileShared(data);
            };

            // Listen for profile_shared WebSocket messages
            webSocketHook.on('profile_shared', this.profileSharedHandler);

            this.isActive = true;
        }

        /**
         * Handle profile_shared WebSocket message
         * @param {Object} profileData - Profile data from WebSocket
         */
        async handleProfileShared(profileData) {
            // Store profile data for food/drinks extraction
            this.currentProfileData = profileData;

            // Wait for profile panel to appear in DOM
            const profilePanel = await this.waitForProfilePanel();
            if (!profilePanel) {
                console.error('[CharacterCardButton] Could not find profile panel');
                return;
            }

            // Inject the character card button
            this.injectButton(profilePanel);
        }

        /**
         * Wait for profile panel to appear in DOM
         * @returns {Promise<Element|null>} Profile panel element or null if timeout
         */
        async waitForProfilePanel() {
            for (let i = 0; i < 20; i++) {
                const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
                if (panel) {
                    return panel;
                }
                await new Promise((resolve) => {
                    const retryTimeout = setTimeout(resolve, 100);
                    this.timerRegistry.registerTimeout(retryTimeout);
                });
            }
            return null;
        }

        /**
         * Inject character card button into profile panel
         * @param {Element} _profilePanel - Profile panel element
         */
        injectButton(_profilePanel) {
            // Check if button already exists
            const existingButton = document.getElementById('mwi-character-card-btn');
            if (existingButton) {
                return;
            }

            // Find the combat score panel to inject button into
            const combatScorePanel = document.getElementById('mwi-combat-score-panel');
            if (!combatScorePanel) {
                console.warn('[CharacterCardButton] Combat score panel not found - button not injected');
                return;
            }

            // Find the button container (should be the div with both export buttons)
            const buttonContainer = combatScorePanel.querySelector('div[style*="margin-top: 12px"]');
            if (!buttonContainer) {
                console.warn('[CharacterCardButton] Button container not found in combat score panel');
                return;
            }

            // Create button element
            const button = document.createElement('button');
            button.id = 'mwi-character-card-btn';
            button.textContent = 'View Card';
            button.style.cssText = `
            padding: 8px 12px;
            background: ${config.COLOR_ACCENT};
            color: black;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 0.85rem;
            width: 100%;
        `;

            // Add click handler
            button.addEventListener('click', () => {
                this.handleButtonClick();
            });

            // Add hover effects
            button.addEventListener('mouseenter', () => {
                button.style.opacity = '0.8';
            });
            button.addEventListener('mouseleave', () => {
                button.style.opacity = '1';
            });

            // Append button to container
            buttonContainer.appendChild(button);
        }

        /**
         * Handle character card button click
         */
        handleButtonClick() {
            try {
                const clientData = dataManager.getInitClientData();

                // Determine if viewing own profile or someone else's
                let characterData = null;

                // If we have profile data from profile_shared event, use it (other player)
                if (this.currentProfileData?.profile) {
                    characterData = this.currentProfileData.profile;
                }
                // Otherwise use own character data from dataManager
                else {
                    characterData = dataManager.characterData;
                }

                if (!characterData) {
                    console.error('[CharacterCardButton] No character data available');
                    return;
                }

                // Determine consumables data source
                let consumablesData = null;

                // If viewing own profile, use own character data (has actionTypeFoodSlotsMap/actionTypeDrinkSlotsMap)
                if (!this.currentProfileData?.profile) {
                    consumablesData = dataManager.characterData;
                }
                // If viewing other player, check if they have combatConsumables (only visible in party)
                else if (characterData.combatConsumables && characterData.combatConsumables.length > 0) {
                    // Convert combatConsumables array to expected format
                    consumablesData = this.convertCombatConsumablesToSlots(characterData.combatConsumables, clientData);
                }
                // Otherwise leave consumables empty (can't see other player's consumables outside party)

                // Find the profile modal for fallback
                const _modal = document.querySelector('.SharableProfile_modal__2OmCQ');

                // Build character sheet link using cached data (preferred) or DOM fallback
                const url = buildCharacterSheetLink(
                    _modal,
                    'https://tib-san.github.io/mwi-character-sheet/',
                    characterData,
                    clientData,
                    consumablesData
                );

                // Open in new tab
                window.open(url, '_blank');
            } catch (error) {
                console.error('[CharacterCardButton] Failed to open character card:', error);
            }
        }

        /**
         * Convert combatConsumables array to actionTypeFoodSlotsMap/actionTypeDrinkSlotsMap format
         * @param {Array} combatConsumables - Array of consumable items from profile data
         * @param {Object} clientData - Init client data for item type lookups
         * @returns {Object} Object with actionTypeFoodSlotsMap and actionTypeDrinkSlotsMap
         */
        convertCombatConsumablesToSlots(combatConsumables, clientData) {
            const foodSlots = [];
            const drinkSlots = [];

            // Separate food and drinks (matching combat sim logic)
            combatConsumables.forEach((consumable) => {
                const itemHrid = consumable.itemHrid;

                // Check if it's a drink
                const isDrink =
                    itemHrid.includes('coffee') ||
                    itemHrid.includes('tea') ||
                    clientData?.itemDetailMap?.[itemHrid]?.tags?.includes('drink');

                if (isDrink && drinkSlots.length < 3) {
                    drinkSlots.push({ itemHrid });
                } else if (!isDrink && foodSlots.length < 3) {
                    foodSlots.push({ itemHrid });
                }
            });

            // Pad to 4 slots (3 used + 1 null)
            while (foodSlots.length < 4) foodSlots.push(null);
            while (drinkSlots.length < 4) drinkSlots.push(null);

            return {
                actionTypeFoodSlotsMap: {
                    '/action_types/combat': foodSlots,
                },
                actionTypeDrinkSlotsMap: {
                    '/action_types/combat': drinkSlots,
                },
            };
        }

        /**
         * Refresh colors on existing button
         */
        refresh() {
            const button = document.getElementById('mwi-character-card-btn');
            if (button) {
                button.style.background = config.COLOR_ACCENT;
            }
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.profileSharedHandler) {
                webSocketHook.off('profile_shared', this.profileSharedHandler);
                this.profileSharedHandler = null;
            }

            // Remove button from DOM
            const button = document.getElementById('mwi-character-card-btn');
            if (button) {
                button.remove();
            }

            this.currentProfileData = null;
            this.timerRegistry.clearAll();
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const characterCardButton = new CharacterCardButton();
    characterCardButton.setupSettingListener();

    /**
     * Combat Library
     * Combat, abilities, and combat stats features
     *
     * Exports to: window.Toolasha.Combat
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Combat = {
        zoneIndices,
        dungeonTracker,
        dungeonTrackerUI,
        dungeonTrackerChatAnnotations,
        combatSummary,
        combatSimIntegration,
        combatSimExport: {
            constructExportObject,
            constructMilkonomyExport,
        },
        combatStats,
        abilityBookCalculator,
        combatScore,
        characterCardButton,
    };

    console.log('[Toolasha] Combat library loaded');

})(Toolasha.Core.config, Toolasha.Core.dataManager, Toolasha.Core.domObserver, Toolasha.Core.webSocketHook, Toolasha.Core.storage, Toolasha.Utils.timerRegistry, Toolasha.Utils.domObserverHelpers, Toolasha.Core.marketAPI, Toolasha.Utils.formatters, Toolasha.Core.profileManager, Toolasha.Utils.reactInput, Toolasha.Utils.dom, Toolasha.Utils.abilityCalc, Toolasha.Utils.houseCostCalculator, Toolasha.Utils.enhancementCalculator, Toolasha.Utils.marketData, Toolasha.Utils.enhancementConfig);
