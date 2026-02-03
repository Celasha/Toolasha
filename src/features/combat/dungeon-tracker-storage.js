/**
 * Dungeon Tracker Storage
 * Manages IndexedDB storage for dungeon run history
 */

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';

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

export default dungeonTrackerStorage;
