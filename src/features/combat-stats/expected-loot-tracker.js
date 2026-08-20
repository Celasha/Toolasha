/**
 * Expected Loot Tracker
 * Accumulates real completed-encounter monster kill counts (regular zones) and dungeon
 * completions for the current zone, then feeds the exact same canonical drop-math helper
 * Combat Sim uses (`calculateExpectedDrops`) so Actual and Expected never disagree because of
 * duplicated formulas.
 */

import { calculateExpectedDrops } from '../combat-sim/combat-sim-adapter.js';

class ExpectedLootTracker {
    constructor() {
        this.reset();
    }

    /**
     * Clear all accumulated state (new zone, new session, or character switch)
     */
    reset() {
        this.zoneHrid = null;
        this.isDungeon = false;
        this.deaths = {};
        this.dungeonsCompleted = 0;
        this.completedEncounterCount = 0;
        this.trackingStartTime = null;
        this.latest = {
            difficultyTier: 0,
            numberOfPlayers: 1,
            dropRateMultiplier: 1,
            rareFindMultiplier: 1,
            combatDropQuantity: 0,
            debuffOnLevelGap: 0,
        };
    }

    /**
     * Reset tracked state if the active zone/action changed, so Actual and Expected always
     * cover the same sample window (never mixing kills from a previous zone into this one).
     * @param {string} zoneHrid - Current action HRID
     * @param {boolean} isDungeon - Whether the current zone is a dungeon
     */
    _syncZone(zoneHrid, isDungeon) {
        if (this.zoneHrid !== null && (this.zoneHrid !== zoneHrid || this.isDungeon !== isDungeon)) {
            this.reset();
        }
        this.zoneHrid = zoneHrid;
        this.isDungeon = isDungeon;
    }

    /**
     * Record one completed regular-zone encounter (never the currently-active one).
     * @param {Object} params - Completed encounter data
     * @param {string} params.zoneHrid - Current action HRID
     * @param {Array<string>} params.monsterHrids - Monster HRIDs present in the completed encounter
     * @param {number} params.difficultyTier - Zone difficulty tier
     * @param {number} params.numberOfPlayers - Party size
     * @param {number} params.dropRateMultiplier - Live Combat Drop Rate multiplier (1 = no bonus)
     * @param {number} params.rareFindMultiplier - Live Combat Rare Find multiplier (1 = no bonus)
     * @param {number} params.combatDropQuantity - Live Combat Drop Quantity bonus (0 = no bonus)
     * @param {number} params.debuffOnLevelGap - Level-gap debuff (negative or 0)
     */
    recordCompletedEncounter({
        zoneHrid,
        monsterHrids,
        difficultyTier,
        numberOfPlayers,
        dropRateMultiplier,
        rareFindMultiplier,
        combatDropQuantity,
        debuffOnLevelGap,
    }) {
        this._syncZone(zoneHrid, false);
        if (this.trackingStartTime === null) {
            this.trackingStartTime = Date.now();
        }

        for (const monsterHrid of monsterHrids) {
            this.deaths[monsterHrid] = (this.deaths[monsterHrid] || 0) + 1;
        }
        this.completedEncounterCount += 1;

        this.latest = {
            difficultyTier,
            numberOfPlayers,
            dropRateMultiplier,
            rareFindMultiplier,
            combatDropQuantity,
            debuffOnLevelGap,
        };
    }

    /**
     * Record one completed dungeon run (completion rewards only, never per-monster drops).
     * @param {Object} params - Completed dungeon data
     * @param {string} params.zoneHrid - Dungeon action HRID
     * @param {number} params.difficultyTier - Dungeon tier
     * @param {number} params.numberOfPlayers - Party size at completion
     * @param {number} params.combatDropQuantity - Live Combat Drop Quantity bonus (0 = no bonus)
     */
    recordDungeonCompletion({ zoneHrid, difficultyTier, numberOfPlayers, combatDropQuantity }) {
        this._syncZone(zoneHrid, true);
        if (this.trackingStartTime === null) {
            this.trackingStartTime = Date.now();
        }

        this.dungeonsCompleted += 1;
        this.completedEncounterCount += 1;
        this.latest = { ...this.latest, difficultyTier, numberOfPlayers, combatDropQuantity };
    }

    /**
     * @returns {boolean} True once at least one encounter/dungeon run has completed
     */
    hasData() {
        return this.completedEncounterCount > 0;
    }

    /**
     * @returns {number} Number of completed encounters/dungeon runs contributing to the sample
     */
    getSampleSize() {
        return this.completedEncounterCount;
    }

    /**
     * Real wall-clock time actually covered by the accumulated sample - NOT the whole combat
     * session's duration, which may have started long before this tracker began observing
     * (e.g. the script attached mid-fight). Using the session duration here would silently
     * understate the expected daily rate by whatever ratio the two windows differ by.
     * @returns {number} Seconds since the first completed encounter/dungeon run in this sample
     */
    getElapsedSeconds() {
        if (this.trackingStartTime === null) {
            return 0;
        }
        return Math.max(0, (Date.now() - this.trackingStartTime) / 1000);
    }

    /**
     * Compute expected drops for everything accumulated so far, using the exact same helper
     * Combat Sim uses for simulated runs.
     * @param {Object} gameData - `dataManager.getInitClientData()` result (combatMonsterDetailMap/actionDetailMap)
     * @returns {Map<string, number>} itemHrid -> expected total drop count
     */
    getExpectedDrops(gameData) {
        if (!this.hasData()) {
            return new Map();
        }

        const simResult = {
            isDungeon: this.isDungeon,
            zoneName: this.zoneHrid,
            deaths: this.deaths,
            dungeonsCompleted: this.dungeonsCompleted,
            numberOfPlayers: this.latest.numberOfPlayers || 1,
            difficultyTier: this.latest.difficultyTier || 0,
            dropRateMultiplier: { player1: this.latest.dropRateMultiplier || 1 },
            rareFindMultiplier: { player1: this.latest.rareFindMultiplier || 1 },
            combatDropQuantity: { player1: this.latest.combatDropQuantity || 0 },
            debuffOnLevelGap: { player1: this.latest.debuffOnLevelGap || 0 },
        };

        return calculateExpectedDrops(simResult, gameData, 'player1');
    }
}

export default ExpectedLootTracker;
