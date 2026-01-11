/**
 * Dungeon Tracker UI
 * Displays dungeon progress in the top bar
 */

import dungeonTracker from './dungeon-tracker.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dungeonTrackerChat from './dungeon-tracker-chat.js';
import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';

class DungeonTrackerUI {
    constructor() {
        this.container = null;
        this.updateInterval = null;
        this.isCollapsed = false;
        this.isKeysExpanded = false;
        this.isRunHistoryExpanded = false;
        this.isTeamHistoryExpanded = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = null; // { x, y } or null for default
    }

    /**
     * Initialize UI
     */
    async initialize() {
        // Load saved state
        await this.loadState();

        // Create UI elements
        this.createUI();

        // Initialize chat annotations
        dungeonTrackerChat.initialize();

        // Register for dungeon tracker updates
        dungeonTracker.onUpdate((currentRun, completedRun) => {
            // Check if UI is enabled
            if (!config.isFeatureEnabled('dungeonTrackerUI')) {
                this.hide();
                return;
            }

            if (completedRun) {
                // Dungeon completed - trigger chat annotation update
                setTimeout(() => dungeonTrackerChat.annotateAllMessages(), 200);
                this.hide();
            } else if (currentRun) {
                // Dungeon in progress
                this.show();
                this.update(currentRun);
            } else {
                // No active dungeon
                this.hide();
            }
        });

        // Start update loop (updates current wave time every second)
        this.startUpdateLoop();
    }

    /**
     * Load saved state from storage
     */
    async loadState() {
        const savedState = await storage.getJSON('dungeonTracker_uiState', 'settings', null);
        if (savedState) {
            this.isCollapsed = savedState.isCollapsed || false;
            this.isKeysExpanded = savedState.isKeysExpanded || false;
            this.isRunHistoryExpanded = savedState.isRunHistoryExpanded || false;
            this.isTeamHistoryExpanded = savedState.isTeamHistoryExpanded || false;
            this.position = savedState.position || null;
        }
    }

    /**
     * Save current state to storage
     */
    async saveState() {
        await storage.setJSON('dungeonTracker_uiState', {
            isCollapsed: this.isCollapsed,
            isKeysExpanded: this.isKeysExpanded,
            isRunHistoryExpanded: this.isRunHistoryExpanded,
            isTeamHistoryExpanded: this.isTeamHistoryExpanded,
            position: this.position
        }, 'settings', true);
    }

    /**
     * Create UI elements
     */
    createUI() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'mwi-dungeon-tracker';

        // Apply saved position or default
        this.updatePosition();

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
                        <span style="font-size: 12px; color: #aaa;">Elapsed: </span>
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

                <!-- Run history section -->
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
                    <div id="mwi-dt-run-list" style="
                        display: none;
                        max-height: 150px;
                        overflow-y: auto;
                        font-size: 11px;
                        color: #ccc;
                    ">
                        <!-- Run list populated dynamically -->
                        <div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs yet</div>
                    </div>
                </div>

                <!-- Team History section (backfill) -->
                <div id="mwi-dt-team-history" style="padding-top: 8px; border-top: 1px solid #444;">
                    <div id="mwi-dt-team-history-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        padding: 4px 0;
                        margin-bottom: 8px;
                    ">
                        <span style="font-size: 12px; font-weight: bold; color: #ccc;">Team History <span id="mwi-dt-team-history-toggle" style="font-size: 10px;">▼</span></span>
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
                            <button id="mwi-dt-clear-team" style="
                                background: none;
                                border: 1px solid #ff6b6b;
                                color: #ff6b6b;
                                cursor: pointer;
                                font-size: 11px;
                                padding: 2px 8px;
                                border-radius: 3px;
                                font-weight: bold;
                            " title="Clear all team history">✕ Clear</button>
                        </div>
                    </div>
                    <div id="mwi-dt-team-list" style="
                        display: none;
                        max-height: 150px;
                        overflow-y: auto;
                        font-size: 11px;
                        color: #ccc;
                    ">
                        <!-- Team list populated dynamically -->
                        <div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No team runs yet</div>
                    </div>
                </div>
            </div>
        `;

        // Add to page
        document.body.appendChild(this.container);

        // Setup dragging
        this.setupDragging();

        // Setup collapse button
        this.setupCollapseButton();

        // Setup keys toggle
        this.setupKeysToggle();

        // Setup run history toggle
        this.setupRunHistoryToggle();

        // Setup team history toggle
        this.setupTeamHistoryToggle();

        // Setup clear all button
        this.setupClearAll();

        // Setup backfill button
        this.setupBackfillButton();

        // Setup clear team history button
        this.setupClearTeamHistory();

        // Load team history on initialization
        this.loadTeamHistory();

        // Apply initial collapsed state
        if (this.isCollapsed) {
            this.applyCollapsedState();
        }

        // Apply initial keys expanded state
        if (this.isKeysExpanded) {
            this.applyKeysExpandedState();
        }

        // Apply initial run history expanded state
        if (this.isRunHistoryExpanded) {
            this.applyRunHistoryExpandedState();
        }

        // Apply initial team history expanded state
        if (this.isTeamHistoryExpanded) {
            this.applyTeamHistoryExpandedState();
        }
    }

    /**
     * Update container position and styling
     */
    updatePosition() {
        const baseStyle = `
            display: none;
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
            this.container.style.cssText = `
                ${baseStyle}
                top: ${this.position.y}px;
                left: ${this.position.x}px;
                min-width: ${this.isCollapsed ? '250px' : '480px'};
            `;
        } else if (this.isCollapsed) {
            // Collapsed: top-left (near action time display)
            this.container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 10px;
                min-width: 250px;
            `;
        } else {
            // Expanded: top-center
            this.container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                min-width: 480px;
            `;
        }
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
                y: e.clientY - rect.top
            };
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;

            // Save position (disables default centering)
            this.position = { x, y };

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
                this.saveState();
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
            // Don't toggle if clicking the clear button
            if (e.target.id === 'mwi-dt-clear-all' || e.target.closest('#mwi-dt-clear-all')) return;
            this.toggleRunHistory();
        });
    }

    /**
     * Setup team history toggle
     */
    setupTeamHistoryToggle() {
        const teamHistoryHeader = this.container.querySelector('#mwi-dt-team-history-header');
        if (!teamHistoryHeader) return;

        teamHistoryHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking the backfill or clear button
            if (e.target.id === 'mwi-dt-backfill-btn' || e.target.closest('#mwi-dt-backfill-btn')) return;
            if (e.target.id === 'mwi-dt-clear-team' || e.target.closest('#mwi-dt-clear-team')) return;
            this.toggleTeamHistory();
        });
    }

    /**
     * Setup clear all button
     */
    setupClearAll() {
        const clearBtn = this.container.querySelector('#mwi-dt-clear-all');
        if (!clearBtn) return;

        clearBtn.addEventListener('click', async () => {
            const currentRun = dungeonTracker.getCurrentRun();
            if (!currentRun) return;

            const dungeonInfo = dungeonTrackerStorage.getDungeonInfo(currentRun.dungeonHrid);
            const dungeonName = dungeonInfo?.name || 'this dungeon';

            if (confirm(`Delete all run history for ${dungeonName} T${currentRun.tier}?`)) {
                await dungeonTrackerStorage.clearHistory(currentRun.dungeonHrid, currentRun.tier);
                // Refresh display
                this.update(currentRun);
            }
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

                // Refresh team history display
                await this.loadTeamHistory();
            } catch (error) {
                console.error('[Dungeon Tracker UI] Backfill error:', error);
                alert('Backfill failed. Check console for details.');
            } finally {
                // Reset button
                backfillBtn.textContent = '⟳ Backfill';
                backfillBtn.disabled = false;
            }
        });
    }

    /**
     * Setup clear team history button
     */
    setupClearTeamHistory() {
        const clearBtn = this.container.querySelector('#mwi-dt-clear-team');
        if (!clearBtn) return;

        clearBtn.addEventListener('click', async () => {
            if (confirm('Delete ALL team history data?\n\nThis cannot be undone!')) {
                try {
                    // Get all team run keys
                    const teamKeys = await storage.getAllKeys('teamRuns');

                    // Count total runs across all teams
                    let totalRuns = 0;
                    for (const key of teamKeys) {
                        const runs = await storage.getJSON(key, 'teamRuns', []);
                        totalRuns += runs.length;
                    }

                    // Delete each team
                    for (const key of teamKeys) {
                        await storage.delete(key, 'teamRuns');
                    }

                    alert(`Cleared ${teamKeys.length} team(s) with ${totalRuns} total run(s).`);

                    // Refresh team history display
                    await this.loadTeamHistory();
                } catch (error) {
                    console.error('[Dungeon Tracker UI] Clear team history error:', error);
                    alert('Failed to clear team history. Check console for details.');
                }
            }
        });
    }

    /**
     * Load and display team history
     */
    async loadTeamHistory() {
        const teamList = this.container.querySelector('#mwi-dt-team-list');
        if (!teamList) return;

        try {
            const teams = await dungeonTrackerStorage.getAllTeamStats();

            if (teams.length === 0) {
                teamList.innerHTML = '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No team runs yet</div>';
                return;
            }

            // Build team list HTML
            let html = '';
            for (const team of teams) {
                const avgTime = this.formatTime(team.avgTime);
                const bestTime = this.formatTime(team.bestTime);
                const worstTime = this.formatTime(team.worstTime);

                html += `
                    <div style="
                        padding: 8px;
                        margin-bottom: 4px;
                        border: 1px solid #444;
                        border-radius: 4px;
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                    " data-team-key="${team.teamKey}">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; color: #4a9eff; margin-bottom: 4px;">
                                ${team.teamKey}
                            </div>
                            <div style="font-size: 10px; color: #aaa;">
                                Runs: ${team.runCount} | Avg: ${avgTime} | Best: ${bestTime} | Worst: ${worstTime}
                            </div>
                        </div>
                        <button class="mwi-dt-delete-team" style="
                            background: none;
                            border: 1px solid #ff6b6b;
                            color: #ff6b6b;
                            cursor: pointer;
                            font-size: 10px;
                            padding: 2px 6px;
                            border-radius: 3px;
                            font-weight: bold;
                            flex-shrink: 0;
                        " title="Delete this team's history">✕</button>
                    </div>
                `;
            }

            teamList.innerHTML = html;

            // Attach delete handlers
            teamList.querySelectorAll('.mwi-dt-delete-team').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    const teamKey = e.target.closest('[data-team-key]').dataset.teamKey;
                    await dungeonTrackerStorage.clearTeamHistory(teamKey);
                    // Refresh display
                    await this.loadTeamHistory();
                });
            });
        } catch (error) {
            console.error('[Dungeon Tracker UI] Load team history error:', error);
            teamList.innerHTML = '<div style="color: #ff6b6b; text-align: center; padding: 8px;">Error loading team history</div>';
        }
    }

    /**
     * Toggle keys expanded state
     */
    toggleKeys() {
        this.isKeysExpanded = !this.isKeysExpanded;

        if (this.isKeysExpanded) {
            this.applyKeysExpandedState();
        } else {
            this.applyKeysCollapsedState();
        }

        this.saveState();
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
        this.isRunHistoryExpanded = !this.isRunHistoryExpanded;

        if (this.isRunHistoryExpanded) {
            this.applyRunHistoryExpandedState();
        } else {
            this.applyRunHistoryCollapsedState();
        }

        this.saveState();
    }

    /**
     * Apply run history expanded state
     */
    applyRunHistoryExpandedState() {
        const runList = this.container.querySelector('#mwi-dt-run-list');
        const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');

        if (runList) runList.style.display = 'block';
        if (runHistoryToggle) runHistoryToggle.textContent = '▲';
    }

    /**
     * Apply run history collapsed state
     */
    applyRunHistoryCollapsedState() {
        const runList = this.container.querySelector('#mwi-dt-run-list');
        const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');

        if (runList) runList.style.display = 'none';
        if (runHistoryToggle) runHistoryToggle.textContent = '▼';
    }

    /**
     * Toggle team history expanded state
     */
    toggleTeamHistory() {
        this.isTeamHistoryExpanded = !this.isTeamHistoryExpanded;

        if (this.isTeamHistoryExpanded) {
            this.applyTeamHistoryExpandedState();
        } else {
            this.applyTeamHistoryCollapsedState();
        }

        this.saveState();
    }

    /**
     * Apply team history expanded state
     */
    applyTeamHistoryExpandedState() {
        const teamList = this.container.querySelector('#mwi-dt-team-list');
        const teamHistoryToggle = this.container.querySelector('#mwi-dt-team-history-toggle');

        if (teamList) teamList.style.display = 'block';
        if (teamHistoryToggle) teamHistoryToggle.textContent = '▲';
    }

    /**
     * Apply team history collapsed state
     */
    applyTeamHistoryCollapsedState() {
        const teamList = this.container.querySelector('#mwi-dt-team-list');
        const teamHistoryToggle = this.container.querySelector('#mwi-dt-team-history-toggle');

        if (teamList) teamList.style.display = 'none';
        if (teamHistoryToggle) teamHistoryToggle.textContent = '▼';
    }

    /**
     * Toggle collapse state
     */
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;

        if (this.isCollapsed) {
            this.applyCollapsedState();
        } else {
            this.applyExpandedState();
        }

        // If no custom position, update to new default position
        if (!this.position) {
            this.updatePosition();
        } else {
            // Just update width for custom positions
            this.container.style.minWidth = this.isCollapsed ? '250px' : '480px';
        }

        this.saveState();
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
     * Update UI with current run data
     * @param {Object} run - Current run state
     */
    async update(run) {
        if (!run || !this.container) {
            return;
        }

        // Update dungeon name and tier
        const dungeonName = document.getElementById('mwi-dt-dungeon-name');
        if (dungeonName) {
            if (run.dungeonName && run.tier !== null) {
                dungeonName.textContent = `${run.dungeonName} (T${run.tier})`;
            } else {
                dungeonName.textContent = 'Dungeon Loading...';
            }
        }

        // Update wave counter
        const waveCounter = document.getElementById('mwi-dt-wave-counter');
        if (waveCounter && run.maxWaves) {
            waveCounter.textContent = `Wave ${run.currentWave}/${run.maxWaves}`;
        }

        // Update current elapsed time
        const currentTime = document.getElementById('mwi-dt-current-time');
        if (currentTime && run.totalElapsed !== undefined) {
            currentTime.textContent = this.formatTime(run.totalElapsed);
        }

        // Update progress bar
        const progressBar = document.getElementById('mwi-dt-progress-bar');
        const progressText = document.getElementById('mwi-dt-progress-text');
        if (progressBar && progressText && run.maxWaves) {
            const percent = Math.round((run.currentWave / run.maxWaves) * 100);
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `${percent}%`;
        }

        // Fetch run statistics for this dungeon+tier
        const stats = await dungeonTrackerStorage.getStats(run.dungeonHrid, run.tier);
        const runHistory = await dungeonTrackerStorage.getRunHistory(run.dungeonHrid, run.tier);

        // Get last completed run time (most recent in history)
        const lastRunTime = runHistory && runHistory.length > 0 ? runHistory[0].totalTime : 0;

        // Get character name from dataManager, or fallback to first player in key counts
        let characterName = dataManager.characterData?.character?.name;

        if (!characterName && run.keyCountsMap) {
            // Fallback: use first player name from key counts (usually you in small parties)
            const playerNames = Object.keys(run.keyCountsMap);
            if (playerNames.length > 0) {
                characterName = playerNames[0];
            }
        }

        if (!characterName) {
            characterName = 'You'; // Final fallback
        }

        // Update character name in Keys section
        const characterNameElement = document.getElementById('mwi-dt-character-name');
        if (characterNameElement) {
            characterNameElement.textContent = characterName;
        }

        // Update header stats (always visible)
        const headerLast = document.getElementById('mwi-dt-header-last');
        if (headerLast) {
            headerLast.textContent = lastRunTime > 0 ? this.formatTime(lastRunTime) : '--:--';
        }

        const headerAvg = document.getElementById('mwi-dt-header-avg');
        if (headerAvg) {
            headerAvg.textContent = stats.avgTime > 0 ? this.formatTime(stats.avgTime) : '--:--';
        }

        const headerRuns = document.getElementById('mwi-dt-header-runs');
        if (headerRuns) {
            headerRuns.textContent = stats.totalRuns.toString();
        }

        // Update header keys (always visible)
        const headerKeys = document.getElementById('mwi-dt-header-keys');
        if (headerKeys) {
            const selfKeyCount = (run.keyCountsMap && run.keyCountsMap[characterName]) || 0;
            headerKeys.textContent = selfKeyCount.toLocaleString();
        }

        // Update run-level stats in content area (2x2 grid)
        const avgTime = document.getElementById('mwi-dt-avg-time');
        if (avgTime) {
            avgTime.textContent = stats.avgTime > 0 ? this.formatTime(stats.avgTime) : '--:--';
        }

        const lastTime = document.getElementById('mwi-dt-last-time');
        if (lastTime) {
            lastTime.textContent = lastRunTime > 0 ? this.formatTime(lastRunTime) : '--:--';
        }

        const fastestTime = document.getElementById('mwi-dt-fastest-time');
        if (fastestTime) {
            fastestTime.textContent = stats.fastestTime > 0 ? this.formatTime(stats.fastestTime) : '--:--';
        }

        const slowestTime = document.getElementById('mwi-dt-slowest-time');
        if (slowestTime) {
            slowestTime.textContent = stats.slowestTime > 0 ? this.formatTime(stats.slowestTime) : '--:--';
        }

        // Update Keys section with party member key counts
        this.updateKeysDisplay(run.keyCountsMap || {}, characterName);

        // Update run history list
        this.updateRunHistory(run.dungeonHrid, run.tier, runHistory);
    }

    /**
     * Update Keys section display
     * @param {Object} keyCountsMap - Map of player names to key counts
     * @param {string} characterName - Current character name
     */
    updateKeysDisplay(keyCountsMap, characterName) {
        // Update self key count in header
        const selfKeyCount = keyCountsMap[characterName] || 0;
        const selfKeysElement = document.getElementById('mwi-dt-self-keys');
        if (selfKeysElement) {
            selfKeysElement.textContent = selfKeyCount.toString();
        }

        // Update expanded keys list
        const keysList = document.getElementById('mwi-dt-keys-list');
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
            keysList.innerHTML = '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No key data yet</div>';
            return;
        }

        // Build player list HTML
        playerNames.forEach(playerName => {
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
     * Update run history list
     * @param {string} dungeonHrid - Dungeon action HRID
     * @param {number} tier - Difficulty tier
     * @param {Array} runs - Run history array
     */
    updateRunHistory(dungeonHrid, tier, runs) {
        const runList = document.getElementById('mwi-dt-run-list');
        if (!runList) return;

        if (!runs || runs.length === 0) {
            runList.innerHTML = '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs yet</div>';
            return;
        }

        // Build run list HTML
        let html = '';
        runs.forEach((run, index) => {
            const runNumber = runs.length - index; // Count down from most recent
            const timeStr = this.formatTime(run.totalTime);

            // Determine validation icon and color
            let validationIcon = '';
            let validationColor = '';
            let validationTitle = '';

            if (run.validated) {
                validationIcon = '✓';
                validationColor = '#5fda5f'; // Green
                validationTitle = 'Server-validated duration';
            } else {
                validationIcon = '?';
                validationColor = '#888'; // Gray
                validationTitle = 'Duration unverified (solo run or no party messages)';
            }

            html += `
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 4px 8px;
                    border-bottom: 1px solid #333;
                " data-run-index="${index}">
                    <span style="color: #aaa; min-width: 30px;">#${runNumber}</span>
                    <span style="color: #fff; flex: 1; text-align: center;">
                        ${timeStr}
                        <span style="color: ${validationColor}; margin-left: 4px; font-weight: bold;" title="${validationTitle}">${validationIcon}</span>
                    </span>
                    <button class="mwi-dt-delete-run" style="
                        background: none;
                        border: 1px solid #ff6b6b;
                        color: #ff6b6b;
                        cursor: pointer;
                        font-size: 10px;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-weight: bold;
                    " title="Delete this run">✕</button>
                </div>
            `;
        });

        runList.innerHTML = html;

        // Attach delete handlers
        runList.querySelectorAll('.mwi-dt-delete-run').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const runIndex = parseInt(e.target.closest('[data-run-index]').dataset.runIndex);
                await dungeonTrackerStorage.deleteRun(dungeonHrid, tier, runIndex);

                // Refresh display
                const currentRun = dungeonTracker.getCurrentRun();
                if (currentRun) {
                    this.update(currentRun);
                }
            });
        });
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

// Create and export singleton instance
const dungeonTrackerUI = new DungeonTrackerUI();

export default dungeonTrackerUI;
export { DungeonTrackerUI };
