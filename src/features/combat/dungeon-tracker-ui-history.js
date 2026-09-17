/**
 * Dungeon Tracker UI Run History Display
 * Handles grouping, filtering, and rendering of run history
 */

import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import storage from '../../core/storage.js';
import { formatDateTime } from '../../utils/formatters.js';

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
     * Calculate stats for a set of runs. Failed/canceled attempts cost real time but aren't
     * clears, so the clear-only stats (avg/fastest/slowest) stay unaffected by them while
     * avgTimePerAttempt/failCount surface the real time cost.
     * @param {Array} allAttempts - Array of runs (successes + fails/cancels)
     * @returns {Object} Stats object
     */
    calculateStatsForRuns(allAttempts) {
        const runs = (allAttempts || []).filter((r) => !r.result || r.result === 'success');
        const failedAttempts = (allAttempts || []).filter((r) => r.result === 'fail' || r.result === 'cancel');

        if (runs.length === 0) {
            return {
                totalRuns: 0,
                avgTime: 0,
                fastestTime: 0,
                slowestTime: 0,
                avgTimePerAttempt: 0,
                failCount: failedAttempts.length,
                totalAttempts: failedAttempts.length,
            };
        }

        const durations = runs.map((r) => r.duration);
        const total = durations.reduce((sum, d) => sum + d, 0);
        const failedTotal = failedAttempts.reduce((sum, r) => sum + (r.duration || 0), 0);

        return {
            totalRuns: runs.length,
            avgTime: Math.floor(total / runs.length),
            fastestTime: Math.min(...durations),
            slowestTime: Math.max(...durations),
            avgTimePerAttempt: Math.floor((total + failedTotal) / runs.length),
            failCount: failedAttempts.length,
            totalAttempts: runs.length + failedAttempts.length,
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
            dungeonFilter.innerHTML =
                '<option value="all">All Dungeons</option>' +
                dungeons.map((dungeon) => `<option value="${dungeon}">${dungeon}</option>`).join('');
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
            teamFilter.innerHTML =
                '<option value="all">All Teams</option>' +
                teams.map((team) => `<option value="${team}">${team}</option>`).join('');
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
            const avgPerAttempt = this.formatTime(group.stats.avgTimePerAttempt);
            const failSummary = group.stats.failCount > 0 ? ` | Fails: ${group.stats.failCount}` : '';

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
                                Runs: ${group.stats.totalRuns} | Avg Clear: ${avgTime} | Avg/Attempt: ${avgPerAttempt} | Best: ${bestTime} | Worst: ${worstTime}${failSummary}
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
            const dateTime = formatDateTime(dateObj);
            const dungeonLabel = run.dungeonName || 'Unknown';
            const isFailed = run.result === 'fail' || run.result === 'cancel';
            const resultBadge = isFailed
                ? `<span style="color: ${run.result === 'fail' ? '#ff6b6b' : '#ffd700'}; font-size: 9px; font-weight: bold; margin-right: 4px;">${run.result === 'fail' ? 'FAILED' : 'CANCELED'}</span>`
                : '';

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
                    <span style="color: ${isFailed ? '#888' : '#fff'}; flex: 1; text-align: center;">
                        ${resultBadge}${timeStr} <span style="color: #888; font-size: 9px;">(${dateTime})</span>
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

export default DungeonTrackerUIHistory;
