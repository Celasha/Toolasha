/**
 * Dungeon Tracker UI Core
 * Main orchestrator for dungeon tracker UI display
 * Coordinates state, chart, history, and interaction modules
 */

import dungeonTracker from './dungeon-tracker.js';
import dungeonTrackerChatAnnotations from './dungeon-tracker-chat-annotations.js';
import dungeonTrackerUIState from './dungeon-tracker-ui-state.js';
import DungeonTrackerUIChart from './dungeon-tracker-ui-chart.js';
import DungeonTrackerUIHistory from './dungeon-tracker-ui-history.js';
import DungeonTrackerUIInteractions from './dungeon-tracker-ui-interactions.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import config from '../../core/config.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

class DungeonTrackerUI {
    constructor() {
        this.container = null;
        this.updateInterval = null;
        this.isInitialized = false; // Guard against multiple initializations
        this.timerRegistry = createTimerRegistry();

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
            this.characterSelectObserver = createMutationWatcher(
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

export default dungeonTrackerUI;
