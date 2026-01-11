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
    '/actions/combat/pirate_cove': 65
};

class DungeonTrackerStorage {
    constructor() {
        this.storeName = 'dungeonRuns';
        this.teamRunsStoreName = 'teamRuns'; // Team-based runs (from backfill)
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
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        // Get max waves from nested combatZoneInfo.dungeonInfo.maxWaves
        let maxWaves = actionDetails.combatZoneInfo?.dungeonInfo?.maxWaves || 0;

        // Fallback to hardcoded values if not found in game data
        if (maxWaves === 0 && DUNGEON_MAX_WAVES[dungeonHrid]) {
            maxWaves = DUNGEON_MAX_WAVES[dungeonHrid];
        }

        return {
            name: actionDetails.name || name,
            maxWaves: maxWaves
        };
    }

    /**
     * Save a completed dungeon run
     * @param {Object} run - Run data
     * @param {string} run.dungeonHrid - Dungeon action HRID
     * @param {number} run.tier - Difficulty tier
     * @param {number} run.startTime - Run start timestamp (ms)
     * @param {number} run.endTime - Run end timestamp (ms)
     * @param {number} run.totalTime - Total run time (ms)
     * @param {number} run.avgWaveTime - Average wave time (ms)
     * @param {number} run.fastestWave - Fastest wave time (ms)
     * @param {number} run.slowestWave - Slowest wave time (ms)
     * @param {number} run.wavesCompleted - Number of waves completed
     * @param {Array<number>} run.waveTimes - Individual wave times (ms)
     * @returns {Promise<boolean>} Success status
     */
    async saveRun(run) {
        const key = this.getDungeonKey(run.dungeonHrid, run.tier);

        // Get existing runs for this dungeon+tier
        const existingRuns = await storage.getJSON(key, this.storeName, []);

        // Add new run to front of list
        existingRuns.unshift(run);

        // Save updated list (no limit - store all runs)
        return storage.setJSON(key, existingRuns, this.storeName, true);
    }

    /**
     * Get run history for a dungeon+tier
     * @param {string} dungeonHrid - Dungeon action HRID
     * @param {number} tier - Difficulty tier
     * @param {number} limit - Max runs to return (0 = all)
     * @returns {Promise<Array>} Run history
     */
    async getRunHistory(dungeonHrid, tier, limit = 0) {
        const key = this.getDungeonKey(dungeonHrid, tier);
        const runs = await storage.getJSON(key, this.storeName, []);

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
                avgWaveTime: 0
            };
        }

        const totalTime = runs.reduce((sum, run) => sum + run.totalTime, 0);
        const avgTime = totalTime / runs.length;
        const fastestTime = Math.min(...runs.map(r => r.totalTime));
        const slowestTime = Math.max(...runs.map(r => r.totalTime));

        const totalAvgWaveTime = runs.reduce((sum, run) => sum + run.avgWaveTime, 0);
        const avgWaveTime = totalAvgWaveTime / runs.length;

        return {
            totalRuns: runs.length,
            avgTime,
            fastestTime,
            slowestTime,
            avgWaveTime
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
        const key = this.getDungeonKey(dungeonHrid, tier);
        const runs = await storage.getJSON(key, this.storeName, []);

        if (runIndex < 0 || runIndex >= runs.length) {
            console.warn('[Dungeon Tracker Storage] Invalid run index:', runIndex);
            return false;
        }

        // Remove the run at the specified index
        runs.splice(runIndex, 1);

        // Save updated list
        return storage.setJSON(key, runs, this.storeName, true);
    }

    /**
     * Delete all run history for a dungeon+tier
     * @param {string} dungeonHrid - Dungeon action HRID
     * @param {number} tier - Difficulty tier
     * @returns {Promise<boolean>} Success status
     */
    async clearHistory(dungeonHrid, tier) {
        const key = this.getDungeonKey(dungeonHrid, tier);
        return storage.delete(key, this.storeName);
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
            .filter(([hrid, details]) =>
                hrid.startsWith('/actions/combat/') &&
                details.maxCount !== undefined
            )
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
                        runCount: runs.length
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
     * @param {number} run.timestamp - Run start timestamp (ISO string)
     * @param {number} run.duration - Run duration (ms)
     * @returns {Promise<boolean>} Success status
     */
    async saveTeamRun(teamKey, run) {
        // Get existing runs for this team
        const existingRuns = await storage.getJSON(teamKey, this.teamRunsStoreName, []);

        // Check for duplicates
        const isDuplicate = existingRuns.some(r =>
            r.timestamp === run.timestamp && r.duration === run.duration
        );

        if (!isDuplicate) {
            existingRuns.push(run);
            return storage.setJSON(teamKey, existingRuns, this.teamRunsStoreName, true);
        }

        return false;
    }

    /**
     * Get team run history
     * @param {string} teamKey - Team key (sorted player names)
     * @returns {Promise<Array>} Run history
     */
    async getTeamRunHistory(teamKey) {
        return storage.getJSON(teamKey, this.teamRunsStoreName, []);
    }

    /**
     * Get all teams with stored runs
     * @returns {Promise<Array>} Array of {teamKey, runCount, avgTime, bestTime, worstTime}
     */
    async getAllTeamStats() {
        const results = [];

        // Get all keys from IndexedDB for teamRuns store
        const allKeys = await storage.getAllKeys(this.teamRunsStoreName);

        for (const teamKey of allKeys) {
            const runs = await this.getTeamRunHistory(teamKey);

            if (runs.length > 0) {
                const durations = runs.map(r => r.duration);
                const avgTime = durations.reduce((a, b) => a + b, 0) / durations.length;
                const bestTime = Math.min(...durations);
                const worstTime = Math.max(...durations);

                results.push({
                    teamKey,
                    runCount: runs.length,
                    avgTime,
                    bestTime,
                    worstTime
                });
            }
        }

        return results;
    }

    /**
     * Clear all team runs for a specific team
     * @param {string} teamKey - Team key
     * @returns {Promise<boolean>} Success status
     */
    async clearTeamHistory(teamKey) {
        return storage.delete(teamKey, this.teamRunsStoreName);
    }
}

// Create and export singleton instance
const dungeonTrackerStorage = new DungeonTrackerStorage();

export default dungeonTrackerStorage;
export { DungeonTrackerStorage, TIERS };
