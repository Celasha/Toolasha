/**
 * Dungeon Tracker UI
 * Displays dungeon progress in the top bar
 */

import dungeonTracker from './dungeon-tracker.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dungeonTrackerChatAnnotations from './dungeon-tracker-chat-annotations.js';
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
        this.isChartExpanded = true; // Default: expanded
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = null; // { x, y } or null for default

        // Phase 4: Grouping and filtering state
        this.groupBy = 'team'; // 'team' or 'dungeon'
        this.filterDungeon = 'all'; // 'all' or specific dungeon name
        this.filterTeam = 'all'; // 'all' or specific team key

        // Track expanded groups to preserve state across refreshes
        this.expandedGroups = new Set();

        // Chart instance (Chart.js)
        this.chartInstance = null;
    }

    /**
     * Initialize UI
     */
    async initialize() {
        // Load saved state
        await this.loadState();

        // Create UI elements
        this.createUI();

        // Register for dungeon tracker updates
        dungeonTracker.onUpdate((currentRun, completedRun) => {
            // Check if UI is enabled
            if (!config.isFeatureEnabled('dungeonTrackerUI')) {
                this.hide();
                return;
            }

            if (completedRun) {
                // Dungeon completed - trigger chat annotation update and hide UI
                setTimeout(() => dungeonTrackerChatAnnotations.annotateAllMessages(), 200);
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
            this.position = savedState.position || null;

            // Phase 4: Load grouping/filtering state
            this.groupBy = savedState.groupBy || 'team';
            this.filterDungeon = savedState.filterDungeon || 'all';
            this.filterTeam = savedState.filterTeam || 'all';
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
            position: this.position,
            // Phase 4: Save grouping/filtering state
            groupBy: this.groupBy,
            filterDungeon: this.filterDungeon,
            filterTeam: this.filterTeam
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

        // Setup dragging
        this.setupDragging();

        // Setup collapse button
        this.setupCollapseButton();

        // Setup keys toggle
        this.setupKeysToggle();

        // Setup run history toggle
        this.setupRunHistoryToggle();

        // Setup grouping and filtering controls
        this.setupGroupingControls();

        // Setup backfill button
        this.setupBackfillButton();

        // Setup clear all button
        this.setupClearAll();

        // Setup chart toggle and pop-out
        this.setupChartToggle();
        this.setupChartPopout();

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

        // Apply initial chart expanded state
        if (this.isChartExpanded) {
            this.applyChartExpandedState();
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
            groupBySelect.value = this.groupBy;
            groupBySelect.addEventListener('change', (e) => {
                this.groupBy = e.target.value;
                this.saveState();
                // Clear expanded groups when grouping changes (different group labels)
                this.expandedGroups.clear();
                this.updateRunHistory();
                this.updateChart();
            });
        }

        // Filter dungeon dropdown
        const filterDungeonSelect = this.container.querySelector('#mwi-dt-filter-dungeon');
        if (filterDungeonSelect) {
            filterDungeonSelect.addEventListener('change', (e) => {
                this.filterDungeon = e.target.value;
                this.saveState();
                this.updateRunHistory();
                this.updateChart();
            });
        }

        // Filter team dropdown
        const filterTeamSelect = this.container.querySelector('#mwi-dt-filter-team');
        if (filterTeamSelect) {
            filterTeamSelect.addEventListener('change', (e) => {
                this.filterTeam = e.target.value;
                this.saveState();
                this.updateRunHistory();
                this.updateChart();
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
            if (confirm('Delete ALL run history data?\\n\\nThis cannot be undone!')) {
                try {
                    // Clear unified storage completely
                    await storage.setJSON('allRuns', [], 'unifiedRuns', true);
                    alert('All run history cleared.');

                    // Refresh display
                    await this.updateRunHistory();
                } catch (error) {
                    console.error('[Dungeon Tracker UI] Clear all history error:', error);
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
            this.createChartPopoutModal();
        });
    }

    /**
     * Toggle chart expanded/collapsed
     */
    toggleChart() {
        this.isChartExpanded = !this.isChartExpanded;

        if (this.isChartExpanded) {
            this.applyChartExpandedState();
        } else {
            this.applyChartCollapsedState();
        }

        this.saveState();
    }

    /**
     * Apply chart expanded state
     */
    applyChartExpandedState() {
        const chartContainer = this.container.querySelector('#mwi-dt-chart-container');
        const toggle = this.container.querySelector('#mwi-dt-chart-toggle');

        if (chartContainer) {
            chartContainer.style.display = 'block';
            // Render chart after becoming visible
            setTimeout(() => this.renderChart(), 100);
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
     * Render chart with filtered run data
     */
    async renderChart() {
        const canvas = this.container.querySelector('#mwi-dt-chart-canvas');
        if (!canvas) return;

        // Get filtered runs based on current filters
        const allRuns = await dungeonTrackerStorage.getAllRuns();
        let filteredRuns = allRuns;

        if (this.filterDungeon !== 'all') {
            filteredRuns = filteredRuns.filter(r => r.dungeonName === this.filterDungeon);
        }
        if (this.filterTeam !== 'all') {
            filteredRuns = filteredRuns.filter(r => r.teamKey === this.filterTeam);
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
        const labels = filteredRuns.map((_, i) => `Run ${i + 1}`);
        const durations = filteredRuns.map(r => (r.duration || r.totalTime || 0) / 60000); // Convert to minutes

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
                fill: false
            },
            {
                label: 'Average',
                data: new Array(durations.length).fill(avgDuration),
                borderColor: 'rgb(255, 159, 64)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            },
            {
                label: 'Fastest',
                data: new Array(durations.length).fill(fastestDuration),
                borderColor: 'rgb(75, 192, 75)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            },
            {
                label: 'Slowest',
                data: new Array(durations.length).fill(slowestDuration),
                borderColor: 'rgb(255, 99, 132)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            }
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
                datasets: datasets
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
                            padding: 15
                        },
                        onClick: (e, legendItem, legend) => {
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            const meta = ci.getDatasetMeta(index);

                            // Toggle visibility
                            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                            ci.update();
                        }
                    },
                    title: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                const minutes = Math.floor(value);
                                const seconds = Math.floor((value - minutes) * 60);
                                return `${label}: ${minutes}m ${seconds}s`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Run Number',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#999'
                        },
                        grid: {
                            color: '#333'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Duration (minutes)',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#999'
                        },
                        grid: {
                            color: '#333'
                        },
                        beginAtZero: false
                    }
                }
            }
        });
    }

    /**
     * Update chart (called when filters change)
     */
    async updateChart() {
        if (this.isChartExpanded) {
            await this.renderChart();
        }
    }

    /**
     * Create pop-out modal with larger chart
     */
    createChartPopoutModal() {
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
     */
    async renderModalChart(canvas) {
        // Get filtered runs (same as main chart)
        const allRuns = await dungeonTrackerStorage.getAllRuns();
        let filteredRuns = allRuns;

        if (this.filterDungeon !== 'all') {
            filteredRuns = filteredRuns.filter(r => r.dungeonName === this.filterDungeon);
        }
        if (this.filterTeam !== 'all') {
            filteredRuns = filteredRuns.filter(r => r.teamKey === this.filterTeam);
        }

        if (filteredRuns.length === 0) return;

        // Sort by timestamp
        filteredRuns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Prepare data (same as main chart)
        const labels = filteredRuns.map((_, i) => `Run ${i + 1}`);
        const durations = filteredRuns.map(r => (r.duration || r.totalTime || 0) / 60000);

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
                fill: false
            },
            {
                label: 'Average',
                data: new Array(durations.length).fill(avgDuration),
                borderColor: 'rgb(255, 159, 64)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            },
            {
                label: 'Fastest',
                data: new Array(durations.length).fill(fastestDuration),
                borderColor: 'rgb(75, 192, 75)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            },
            {
                label: 'Slowest',
                data: new Array(durations.length).fill(slowestDuration),
                borderColor: 'rgb(255, 99, 132)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0,
                fill: false
            }
        ];

        // Create chart
        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
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
                                size: 14
                            }
                        },
                        onClick: (e, legendItem, legend) => {
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            const meta = ci.getDatasetMeta(index);

                            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
                            ci.update();
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                const minutes = Math.floor(value);
                                const seconds = Math.floor((value - minutes) * 60);
                                return `${label}: ${minutes}m ${seconds}s`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Run Number',
                            color: '#ccc',
                            font: {
                                size: 14
                            }
                        },
                        ticks: {
                            color: '#999'
                        },
                        grid: {
                            color: '#333'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Duration (minutes)',
                            color: '#ccc',
                            font: {
                                size: 14
                            }
                        },
                        ticks: {
                            color: '#999'
                        },
                        grid: {
                            color: '#333'
                        },
                        beginAtZero: false
                    }
                }
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

                // Refresh run history display
                await this.updateRunHistory();
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

        // Update time label based on hibernation detection
        const timeLabel = document.getElementById('mwi-dt-time-label');
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
        const progressBar = document.getElementById('mwi-dt-progress-bar');
        const progressText = document.getElementById('mwi-dt-progress-text');
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

        // Apply dungeon filter (matches chart line 706-708)
        if (this.filterDungeon !== 'all') {
            runHistory = runHistory.filter(r => r.dungeonName === this.filterDungeon);
        }

        // Apply team filter (matches chart line 709-711)
        if (this.filterTeam !== 'all') {
            runHistory = runHistory.filter(r => r.teamKey === this.filterTeam);
        }

        // Calculate stats from filtered runs
        if (runHistory.length > 0) {
            // Sort by timestamp (matches chart line 723)
            runHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Descending for most recent first

            const durations = runHistory.map(r => r.duration || r.totalTime || 0);
            const total = durations.reduce((sum, d) => sum + d, 0);

            stats = {
                totalRuns: runHistory.length,
                avgTime: Math.floor(total / runHistory.length),
                fastestTime: Math.min(...durations),
                slowestTime: Math.max(...durations),
                avgWaveTime: 0 // Not used in UI
            };

            lastRunTime = durations[0]; // First run after sorting (most recent)
        } else {
            // No runs match filters
            stats = { totalRuns: 0, avgTime: 0, fastestTime: 0, slowestTime: 0, avgWaveTime: 0 };
            lastRunTime = 0;
        }

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

        // Update run history list (uses unified storage with grouping/filtering)
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
                    runs: []
                };
            }
            groups[key].runs.push(run);
        }

        // Convert to array and calculate stats
        return Object.values(groups).map(group => ({
            ...group,
            stats: this.calculateStatsForRuns(group.runs)
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
                    runs: []
                };
            }
            groups[key].runs.push(run);
        }

        // Convert to array and calculate stats
        return Object.values(groups).map(group => ({
            ...group,
            stats: this.calculateStatsForRuns(group.runs)
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
                slowestTime: 0
            };
        }

        const durations = runs.map(r => r.duration);
        const total = durations.reduce((sum, d) => sum + d, 0);

        return {
            totalRuns: runs.length,
            avgTime: Math.floor(total / runs.length),
            fastestTime: Math.min(...durations),
            slowestTime: Math.max(...durations)
        };
    }

    /**
     * Update run history display with grouping and filtering
     */
    async updateRunHistory() {
        const runList = document.getElementById('mwi-dt-run-list');
        if (!runList) return;

        try {
            // Get all runs from unified storage
            const allRuns = await dungeonTrackerStorage.getAllRuns();

            if (allRuns.length === 0) {
                runList.innerHTML = '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs yet</div>';
                // Update filter dropdowns with empty options
                this.updateFilterDropdowns([], []);
                return;
            }

            // Apply filters
            let filteredRuns = allRuns;
            if (this.filterDungeon !== 'all') {
                filteredRuns = filteredRuns.filter(r => r.dungeonName === this.filterDungeon);
            }
            if (this.filterTeam !== 'all') {
                filteredRuns = filteredRuns.filter(r => r.teamKey === this.filterTeam);
            }

            if (filteredRuns.length === 0) {
                runList.innerHTML = '<div style="color: #888; font-style: italic; text-align: center; padding: 8px;">No runs match filters</div>';
                return;
            }

            // Group runs
            const groups = this.groupBy === 'team'
                ? this.groupByTeam(filteredRuns)
                : this.groupByDungeon(filteredRuns);

            // Render grouped runs
            this.renderGroupedRuns(groups);

            // Update filter dropdowns
            const dungeons = [...new Set(allRuns.map(r => r.dungeonName).filter(Boolean))].sort();
            const teams = [...new Set(allRuns.map(r => r.teamKey).filter(Boolean))].sort();
            this.updateFilterDropdowns(dungeons, teams);

        } catch (error) {
            console.error('[Dungeon Tracker UI] Update run history error:', error);
            runList.innerHTML = '<div style="color: #ff6b6b; text-align: center; padding: 8px;">Error loading run history</div>';
        }
    }

    /**
     * Update filter dropdown options
     * @param {Array} dungeons - List of dungeon names
     * @param {Array} teams - List of team keys
     */
    updateFilterDropdowns(dungeons, teams) {
        // Update dungeon filter
        const dungeonFilter = document.getElementById('mwi-dt-filter-dungeon');
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
                this.filterDungeon = 'all';
            }
        }

        // Update team filter
        const teamFilter = document.getElementById('mwi-dt-filter-team');
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
                this.filterTeam = 'all';
            }
        }
    }

    /**
     * Render grouped runs
     * @param {Array} groups - Grouped runs with stats
     */
    renderGroupedRuns(groups) {
        const runList = document.getElementById('mwi-dt-run-list');
        if (!runList) return;

        let html = '';

        for (const group of groups) {
            const avgTime = this.formatTime(group.stats.avgTime);
            const bestTime = this.formatTime(group.stats.fastestTime);
            const worstTime = this.formatTime(group.stats.slowestTime);

            // Check if this group is expanded
            const isExpanded = this.expandedGroups.has(group.label);
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
                    this.expandedGroups.add(groupLabel);
                } else {
                    runsDiv.style.display = 'none';
                    toggle.textContent = '▼';
                    this.expandedGroups.delete(groupLabel);
                }
            });
        });

        // Attach delete handlers
        runList.querySelectorAll('.mwi-dt-delete-run').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const runTimestamp = e.target.closest('[data-run-timestamp]').dataset.runTimestamp;

                // Find and delete the run from unified storage
                const allRuns = await dungeonTrackerStorage.getAllRuns();
                const filteredRuns = allRuns.filter(r => r.timestamp !== runTimestamp);
                await storage.setJSON('allRuns', filteredRuns, 'unifiedRuns', true);

                // Refresh display
                await this.updateRunHistory();
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
            const date = new Date(run.timestamp).toLocaleDateString();
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
                        ${timeStr} <span style="color: #888; font-size: 9px;">(${date})</span>
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
     * Update run history list (OLD METHOD - KEPT FOR COMPATIBILITY)
     * @param {string} dungeonHrid - Dungeon action HRID
     * @param {number} tier - Difficulty tier
     * @param {Array} runs - Run history array
     */
    updateRunHistoryOld(dungeonHrid, tier, runs) {
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
