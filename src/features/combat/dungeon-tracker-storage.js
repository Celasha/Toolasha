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
        this._legacyMigrationDone = false;
    }

    /**
     * Character-scoped storage key for the run-history array. Falls back to 'default' if the
     * character id isn't resolvable yet, matching the fallback used elsewhere (e.g. labyrinth
     * tracker) rather than failing closed.
     * @returns {string}
     */
    getRunsKey() {
        const characterId = dataManager.getCurrentCharacterId() || 'default';
        return `allRuns_${characterId}`;
    }

    /**
     * One-time best-effort migration: runs saved before storage was character-scoped lived under
     * a single global 'allRuns' key shared by every character on the account. There's no way to
     * retroactively attribute old runs to a specific character, so the first character to load
     * after this upgrade claims that history; the legacy key is cleared immediately after so a
     * second character never re-claims (and duplicates) it.
     */
    async _migrateLegacyRunsIfNeeded() {
        if (this._legacyMigrationDone) return;
        this._legacyMigrationDone = true;

        const legacyRuns = await storage.getJSON('allRuns', this.unifiedStoreName, null);
        if (!legacyRuns) return;

        const scopedKey = this.getRunsKey();
        const existing = await storage.getJSON(scopedKey, this.unifiedStoreName, null);
        if (existing === null) {
            await storage.setJSON(scopedKey, legacyRuns, this.unifiedStoreName, true);
        }
        await storage.delete('allRuns', this.unifiedStoreName);
    }

    /**
     * Read the current character's run history array.
     * @returns {Promise<Array>}
     */
    async _readRuns() {
        await this._migrateLegacyRunsIfNeeded();
        return storage.getJSON(this.getRunsKey(), this.unifiedStoreName, []);
    }

    /**
     * Persist the current character's run history array.
     * @param {Array} runs
     * @returns {Promise<boolean>}
     */
    async _writeRuns(runs) {
        return storage.setJSON(this.getRunsKey(), runs, this.unifiedStoreName, true);
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
        const allRuns = await this._readRuns();

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
        const allRuns = await this._readRuns();
        const allAttempts = allRuns.filter((r) => r.dungeonName === dungeonName);

        // A run's duration is untrustworthy only when it's both unvalidated (wall-clock, not
        // server-timestamp-anchored) AND flagged for a sleep/background hibernation gap during
        // tracking - validated runs use a server-anchored duration immune to wall-clock drift.
        const unreliableAttempts = allAttempts.filter((r) => r.hibernationDetected && !r.validated);
        const reliableAttempts = allAttempts.filter((r) => !r.hibernationDetected || r.validated);

        // Runs saved before the result field existed have no result — treat as success (only
        // successful clears were ever saved back then).
        const runs = reliableAttempts.filter((r) => !r.result || r.result === 'success');
        const failedAttempts = reliableAttempts.filter((r) => r.result === 'fail' || r.result === 'cancel');

        if (runs.length === 0) {
            return {
                totalRuns: 0,
                avgTime: 0,
                fastestTime: 0,
                slowestTime: 0,
                avgWaveTime: 0,
                avgTimePerAttempt: 0,
                failCount: failedAttempts.length,
                totalAttempts: allAttempts.length,
                hibernationFlaggedCount: unreliableAttempts.length,
            };
        }

        // Use 'duration' field (chat-based) or 'totalTime' field (websocket-based)
        const durations = runs.map((r) => r.duration || r.totalTime || 0);
        const totalTime = durations.reduce((sum, d) => sum + d, 0);
        const avgTime = totalTime / runs.length;
        const fastestTime = Math.min(...durations);
        const slowestTime = Math.max(...durations);

        const avgWaveTime = runs.reduce((sum, run) => sum + (run.avgWaveTime || 0), 0) / runs.length;

        // Attempt-inclusive time cost: failed/canceled attempts still cost real time, but only
        // successful clears count as output, so the denominator stays the clear count.
        const failedTime = failedAttempts.reduce((sum, r) => sum + (r.duration || r.totalTime || 0), 0);
        const avgTimePerAttempt = (totalTime + failedTime) / runs.length;

        return {
            totalRuns: runs.length,
            avgTime,
            fastestTime,
            slowestTime,
            avgWaveTime,
            avgTimePerAttempt,
            failCount: failedAttempts.length,
            totalAttempts: allAttempts.length,
            hibernationFlaggedCount: unreliableAttempts.length,
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
        const allRuns = await this._readRuns();

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
        return this._writeRuns(allRuns);
    }

    /**
     * Delete all run history for a dungeon+tier
     * @param {string} dungeonHrid - Dungeon action HRID
     * @param {number} tier - Difficulty tier
     * @returns {Promise<boolean>} Success status
     */
    async clearHistory(dungeonHrid, tier) {
        // Get all runs from unified storage
        const allRuns = await this._readRuns();

        // Filter OUT the runs we want to delete
        const filteredRuns = allRuns.filter((r) => !(r.dungeonHrid === dungeonHrid && r.tier === tier));

        // Save back the filtered list
        return this._writeRuns(filteredRuns);
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
     * @param {string} [run.result] - 'success' | 'fail' | 'cancel'. Defaults to 'success'.
     * @param {number} [run.wavesCompleted] - Waves completed before the run ended.
     * @param {boolean} [run.validated] - Whether duration is anchored to a real server-side
     *   chat-message timestamp vs. a client-clock estimate. Defaults to true.
     * @param {boolean} [run.hibernationDetected] - Whether a sleep/background gap was detected
     *   during tracking. Only makes an unvalidated run's duration untrustworthy (a validated
     *   duration is server-timestamp-anchored and immune to wall-clock drift either way).
     * @returns {Promise<boolean>} Success status
     */
    async saveTeamRun(teamKey, run) {
        // Get all runs from unified storage
        const allRuns = await this._readRuns();

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
                validated: run.validated ?? true,
                source: 'chat',
                waveTimes: null,
                avgWaveTime: null,
                keyCountsMap: run.keyCountsMap || null, // Include key counts if available
                result: run.result || 'success',
                wavesCompleted: run.wavesCompleted ?? null,
                hibernationDetected: run.hibernationDetected ?? false,
            };

            // Add to front of list (most recent first)
            allRuns.unshift(unifiedRun);

            // Save to unified storage
            await this._writeRuns(allRuns);

            return true;
        }

        return false;
    }

    /**
     * Get all runs (unfiltered)
     * @returns {Promise<Array>} All runs
     */
    async getAllRuns() {
        return this._readRuns();
    }

    /**
     * Delete a single run by its exact timestamp (used by the history UI's per-run delete
     * button). Routes through the character-scoped read/write pair so it can never write back
     * to the legacy unscoped key.
     * @param {string} timestamp - ISO timestamp of the run to remove
     * @returns {Promise<boolean>} Success status
     */
    async deleteRunByTimestamp(timestamp) {
        const allRuns = await this._readRuns();
        const filtered = allRuns.filter((r) => r.timestamp !== timestamp);
        return this._writeRuns(filtered);
    }

    /**
     * Delete all run history for the current character.
     * @returns {Promise<boolean>} Success status
     */
    async clearAllRuns() {
        return this._writeRuns([]);
    }

    /**
     * Remove runs whose duration is more than 3× the median for their dungeon+team group.
     * Only scrubs groups with at least 5 runs (not enough data below that to be confident).
     * @returns {Promise<number>} Number of runs removed
     */
    async scrubOutlierRuns() {
        const allRuns = await this.getAllRuns();
        if (allRuns.length === 0) return 0;

        // Group by dungeonName + teamKey. Fail/cancel attempts are excluded — their durations
        // aren't drawn from the same distribution as clears, so mixing them in would skew the
        // median this scrub uses to flag outliers.
        const groups = new Map();
        for (let i = 0; i < allRuns.length; i++) {
            const run = allRuns[i];
            if (run.result === 'fail' || run.result === 'cancel') continue;
            const key = `${run.dungeonName}||${run.teamKey}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ run, index: i });
        }

        const outlierIndices = new Set();

        for (const [groupKey, entries] of groups) {
            if (entries.length < 5) continue;

            const durations = entries
                .map((e) => e.run.duration || e.run.totalTime || 0)
                .filter((d) => d > 0)
                .sort((a, b) => a - b);

            if (durations.length < 5) continue;

            const mid = Math.floor(durations.length / 2);
            const median = durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid];

            const threshold = median * 3;

            for (const { run, index } of entries) {
                const duration = run.duration || run.totalTime || 0;
                if (duration > threshold) {
                    outlierIndices.add(index);
                    console.warn(
                        `[DungeonTrackerStorage] Scrubbing outlier run: ${groupKey} ` +
                            `duration=${Math.round(duration)}s median=${Math.round(median)}s threshold=${Math.round(threshold)}s`
                    );
                }
            }
        }

        if (outlierIndices.size === 0) return 0;

        const cleaned = allRuns.filter((_, i) => !outlierIndices.has(i));
        await this._writeRuns(cleaned);
        console.log(`[DungeonTrackerStorage] Scrubbed ${outlierIndices.size} outlier run(s) from storage`);
        return outlierIndices.size;
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
     * @returns {Promise<Array>} Array of {teamKey, runCount, avgTime, bestTime, worstTime,
     *   avgTimePerAttempt, failCount, totalAttempts}
     */
    async getAllTeamStats() {
        // Get all runs from unified storage
        const allRuns = await this._readRuns();

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
        for (const [teamKey, allAttempts] of Object.entries(teamGroups)) {
            // Same hibernation-reliability split as getStatsByName - see comment there.
            const unreliableAttempts = allAttempts.filter((r) => r.hibernationDetected && !r.validated);
            const reliableAttempts = allAttempts.filter((r) => !r.hibernationDetected || r.validated);

            const runs = reliableAttempts.filter((r) => !r.result || r.result === 'success');
            const failedAttempts = reliableAttempts.filter((r) => r.result === 'fail' || r.result === 'cancel');
            if (runs.length === 0) continue;

            const durations = runs.map((r) => r.duration);
            const totalTime = durations.reduce((a, b) => a + b, 0);
            const avgTime = totalTime / durations.length;
            const bestTime = Math.min(...durations);
            const worstTime = Math.max(...durations);
            const failedTime = failedAttempts.reduce((sum, r) => sum + (r.duration || 0), 0);
            const avgTimePerAttempt = (totalTime + failedTime) / runs.length;

            results.push({
                teamKey,
                runCount: runs.length,
                avgTime,
                bestTime,
                worstTime,
                avgTimePerAttempt,
                failCount: failedAttempts.length,
                totalAttempts: allAttempts.length,
                hibernationFlaggedCount: unreliableAttempts.length,
            });
        }

        return results;
    }
}

const dungeonTrackerStorage = new DungeonTrackerStorage();

export default dungeonTrackerStorage;
