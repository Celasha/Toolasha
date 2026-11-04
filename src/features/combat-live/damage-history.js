/**
 * Damage history
 *
 * Damage per player in fixed 2-second steps, kept for the last five minutes, for the DPS line. The line
 * is smoothed with a rolling average over the last 16 seconds so a single big hit or the quiet seconds
 * between waves do not make it spike.
 *
 * Pure logic: times are whatever the caller passes (message timestamps in ms).
 */

export const HISTORY_BUCKET_MS = 2000;
export const HISTORY_BUCKETS = 150;
// 8 steps of 2s: the last 16 seconds
export const SMOOTH_BUCKETS = 8;
// A silence this long ends the series, so a new fight does not start with minutes of flat zeros
const SERIES_GAP_MS = 90000;

/**
 * Rolling average over the last `window` steps (fewer at the start).
 * @param {number[]} values
 * @param {number} [window]
 * @returns {number[]} Same length as `values`
 */
export function smoothSeries(values, window = SMOOTH_BUCKETS) {
    return values.map((_, index) => {
        const from = Math.max(0, index - window + 1);
        let sum = 0;
        for (let k = from; k <= index; k++) sum += values[k];
        return sum / (index - from + 1);
    });
}

export class DamageHistory {
    constructor() {
        this.reset();
    }

    reset() {
        this.players = new Map();
        this.firstBucket = null;
        this.lastAt = null;
        // When the fight became (or stopped being) a boss fight: [{at, boss}] in time order
        this.bossChanges = [];
    }

    /**
     * Note whether the wave starting now is a boss wave.
     * @param {boolean} boss
     * @param {number} at - Timestamp in ms
     */
    markBoss(boss, at) {
        const last = this.bossChanges[this.bossChanges.length - 1];
        if (!last || last.boss !== Boolean(boss)) this.bossChanges.push({ at, boss: Boolean(boss) });
    }

    /**
     * @param {string} player
     * @param {number} amount - Damage dealt
     * @param {number} at - Timestamp in ms
     */
    add(player, amount, at) {
        const index = Math.floor(at / HISTORY_BUCKET_MS);
        if (this.firstBucket === null || (this.lastAt !== null && at - this.lastAt > SERIES_GAP_MS)) {
            this.firstBucket = index;
        }
        this.lastAt = at;

        const row = this.players.get(player) || new Map();
        row.set(index, (row.get(index) || 0) + amount);
        this.players.set(player, row);

        // Steps that have fallen out of the window
        if (row.size > HISTORY_BUCKETS + 20) {
            for (const key of row.keys()) {
                if (key < index - HISTORY_BUCKETS) row.delete(key);
            }
        }
    }

    /**
     * The steps a series covers: the same for every player, so their lines line up.
     * @param {number} now - Timestamp in ms
     * @returns {{first: ?number, last: number}}
     */
    range(now) {
        const last = Math.floor(now / HISTORY_BUCKET_MS) - 1;
        if (this.firstBucket === null) return { first: null, last };
        return { first: Math.max(this.firstBucket, last - HISTORY_BUCKETS + 1), last };
    }

    /**
     * Whether each step of a series was in a boss fight.
     * @param {number} now - Timestamp in ms
     * @returns {boolean[]} One per step, matching `series`
     */
    bossSeries(now) {
        const { first, last } = this.range(now);
        if (first === null) return [];
        const flags = [];
        let cursor = 0;
        for (let index = first; index <= last; index++) {
            // A step counts as boss if the boss wave had started by the time it ended
            const end = (index + 1) * HISTORY_BUCKET_MS - 1;
            while (cursor + 1 < this.bossChanges.length && this.bossChanges[cursor + 1].at <= end) cursor++;
            const change = this.bossChanges[cursor];
            flags.push(Boolean(change && change.at <= end && change.boss));
        }
        return flags;
    }

    /**
     * Damage per second in each finished step, oldest first, ending at the last step that is complete at
     * `now` and starting when the fight did (never more than five minutes back).
     * @param {string} player
     * @param {number} now - Timestamp in ms
     * @returns {number[]} Raw (unsmoothed) DPS per step, empty when there is nothing yet
     */
    series(player, now) {
        // Someone who has not hit anything yet is a flat line at 0, so every player's series is the same length
        const row = this.players.get(player) || new Map();
        const { first, last } = this.range(now);
        if (first === null) return [];
        const values = [];
        for (let index = first; index <= last; index++) {
            values.push((row.get(index) || 0) / (HISTORY_BUCKET_MS / 1000));
        }
        return values;
    }
}

export default DamageHistory;
