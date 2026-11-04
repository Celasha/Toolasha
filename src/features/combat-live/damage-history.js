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
     * Damage per second in each finished step, oldest first, ending at the last step that is complete at
     * `now` and starting when the fight did (never more than five minutes back).
     * @param {string} player
     * @param {number} now - Timestamp in ms
     * @returns {number[]} Raw (unsmoothed) DPS per step, empty when there is nothing yet
     */
    series(player, now) {
        const row = this.players.get(player);
        if (!row || this.firstBucket === null) return [];
        const last = Math.floor(now / HISTORY_BUCKET_MS) - 1;
        const first = Math.max(this.firstBucket, last - HISTORY_BUCKETS + 1);
        const values = [];
        for (let index = first; index <= last; index++) {
            values.push((row.get(index) || 0) / (HISTORY_BUCKET_MS / 1000));
        }
        return values;
    }
}

export default DamageHistory;
