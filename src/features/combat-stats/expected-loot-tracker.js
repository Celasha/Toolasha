/**
 * Expected Loot Tracker
 * Accumulates real completed-encounter monster kill counts (regular zones) and dungeon
 * completions for the current zone, then feeds the exact same canonical drop-math helper
 * Combat Sim uses (`calculateExpectedDrops`) so Actual and Expected never disagree because of
 * duplicated formulas.
 *
 * Encounters/runs are bucketed by their exact modifier signature (difficulty, party size, Combat
 * Drop Rate/Rare Find/Drop Quantity, level-gap debuff) and each bucket is run through the
 * canonical helper independently, then summed - a modifier change mid-sample (gear swap, party
 * change, difficulty change) must never retroactively reprice encounters that already completed
 * under the old modifiers.
 */

import { calculateExpectedDrops } from '../combat-sim/combat-sim-adapter.js';

const REGULAR_MODIFIER_KEYS = [
    'difficultyTier',
    'numberOfPlayers',
    'dropRateMultiplier',
    'rareFindMultiplier',
    'combatDropQuantity',
    'debuffOnLevelGap',
];
const DUNGEON_MODIFIER_KEYS = ['difficultyTier', 'numberOfPlayers', 'combatDropQuantity'];

function bucketKey(modifiers, keys) {
    return keys.map((key) => modifiers[key]).join('|');
}

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
        /** @type {Map<string, {modifiers: Object, deaths: Object, dungeonsCompleted: number}>} */
        this.buckets = new Map();
        this.completedEncounterCount = 0;
        this.sampleStartTime = null;
        this.sampleEndTime = null;
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
     * Establish the sample's start boundary the instant the Actual-loot baseline is captured,
     * decoupled from the first *completed* encounter - the first encounter can legitimately take
     * a long time to finish, and that whole duration must still count toward the sample window
     * (otherwise the denominator excludes it while the numerator includes it once it completes).
     * @param {string} zoneHrid - Current action HRID
     * @param {boolean} isDungeon - Whether the current zone is a dungeon
     */
    markSampleStart(zoneHrid, isDungeon) {
        this._syncZone(zoneHrid, isDungeon);
        if (this.sampleStartTime === null) {
            this.sampleStartTime = Date.now();
        }
    }

    /**
     * @param {Object} modifiers - Modifier signature for this bucket
     * @param {Array<string>} keys - Which modifier fields identify this bucket's signature
     * @returns {{modifiers: Object, deaths: Object, dungeonsCompleted: number}}
     */
    _bucketFor(modifiers, keys) {
        const key = bucketKey(modifiers, keys);
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = { modifiers, deaths: {}, dungeonsCompleted: 0 };
            this.buckets.set(key, bucket);
        }
        return bucket;
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
        if (this.sampleStartTime === null) {
            this.sampleStartTime = Date.now();
        }

        const bucket = this._bucketFor(
            {
                difficultyTier,
                numberOfPlayers,
                dropRateMultiplier,
                rareFindMultiplier,
                combatDropQuantity,
                debuffOnLevelGap,
            },
            REGULAR_MODIFIER_KEYS
        );
        for (const monsterHrid of monsterHrids) {
            bucket.deaths[monsterHrid] = (bucket.deaths[monsterHrid] || 0) + 1;
        }

        this.completedEncounterCount += 1;
        this.sampleEndTime = Date.now();
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
        if (this.sampleStartTime === null) {
            this.sampleStartTime = Date.now();
        }

        const bucket = this._bucketFor({ difficultyTier, numberOfPlayers, combatDropQuantity }, DUNGEON_MODIFIER_KEYS);
        bucket.dungeonsCompleted += 1;

        this.completedEncounterCount += 1;
        this.sampleEndTime = Date.now();
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
     * Merged kill-count view across every modifier bucket - read-only introspection only;
     * `getExpectedDrops()` always computes per-bucket so a modifier change never retroactively
     * reprices encounters that completed under different modifiers.
     * @returns {Object} monsterHrid -> total kill count across all buckets
     */
    get deaths() {
        const merged = {};
        for (const bucket of this.buckets.values()) {
            for (const [hrid, count] of Object.entries(bucket.deaths)) {
                merged[hrid] = (merged[hrid] || 0) + count;
            }
        }
        return merged;
    }

    /**
     * @returns {number} Total completed dungeon runs across all modifier buckets
     */
    get dungeonsCompleted() {
        let total = 0;
        for (const bucket of this.buckets.values()) {
            total += bucket.dungeonsCompleted;
        }
        return total;
    }

    /**
     * Real wall-clock time actually covered by the accumulated sample: from the moment the
     * Actual-loot baseline was captured to the moment the most recently included encounter/run
     * was confirmed completed. Deliberately NOT `Date.now() - sampleStartTime` - Expected only
     * advances at a completed-encounter boundary, so using the current instant as the end would
     * let the denominator keep growing after the last included sample, silently deflating the
     * displayed rate the longer the user waits before checking.
     * @returns {number} Seconds between the sample's start and last-completed boundary
     */
    getElapsedSeconds() {
        if (this.sampleStartTime === null || this.sampleEndTime === null) {
            return 0;
        }
        return Math.max(0, (this.sampleEndTime - this.sampleStartTime) / 1000);
    }

    /**
     * Compute expected drops for everything accumulated so far, using the exact same helper
     * Combat Sim uses for simulated runs - once per modifier bucket, then summed, so a modifier
     * change mid-sample never retroactively recalculates already-completed encounters.
     * @param {Object} gameData - `dataManager.getInitClientData()` result (combatMonsterDetailMap/actionDetailMap)
     * @returns {Map<string, number>} itemHrid -> expected total drop count
     */
    getExpectedDrops(gameData) {
        const totals = new Map();
        if (!this.hasData()) {
            return totals;
        }

        for (const bucket of this.buckets.values()) {
            const simResult = this.isDungeon
                ? {
                      isDungeon: true,
                      zoneName: this.zoneHrid,
                      dungeonsCompleted: bucket.dungeonsCompleted,
                      numberOfPlayers: bucket.modifiers.numberOfPlayers || 1,
                      difficultyTier: bucket.modifiers.difficultyTier || 0,
                      dropRateMultiplier: { player1: 1 },
                      combatDropQuantity: { player1: bucket.modifiers.combatDropQuantity || 0 },
                  }
                : {
                      isDungeon: false,
                      zoneName: this.zoneHrid,
                      deaths: bucket.deaths,
                      numberOfPlayers: bucket.modifiers.numberOfPlayers || 1,
                      difficultyTier: bucket.modifiers.difficultyTier || 0,
                      dropRateMultiplier: { player1: bucket.modifiers.dropRateMultiplier || 1 },
                      rareFindMultiplier: { player1: bucket.modifiers.rareFindMultiplier || 1 },
                      combatDropQuantity: { player1: bucket.modifiers.combatDropQuantity || 0 },
                      debuffOnLevelGap: { player1: bucket.modifiers.debuffOnLevelGap || 0 },
                  };

            const bucketDrops = calculateExpectedDrops(simResult, gameData, 'player1');
            for (const [itemHrid, count] of bucketDrops) {
                totals.set(itemHrid, (totals.get(itemHrid) || 0) + count);
            }
        }

        return totals;
    }
}

export default ExpectedLootTracker;
