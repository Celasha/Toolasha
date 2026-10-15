/**
 * Dungeon Key Runway
 *
 * Estimates how long the player's entry keys will last at their recent clear pace. A key is only
 * spent when a run is cleared (the chest is the cost), so failed and canceled attempts are not
 * counted and only successful clears feed the average.
 */

/** Number of most recent clears averaged for the estimate. */
export const KEY_RUNWAY_WINDOW = 20;

/** Fewest clears needed before an estimate is shown. */
export const KEY_RUNWAY_MIN_SAMPLES = 3;

/**
 * @param {Array<{timestamp: string|number, duration?: number, totalTime?: number}>} clears -
 *   Successful runs for one dungeon/team (durations in milliseconds), in any order
 * @param {number} keys - Entry keys currently held
 * @returns {{seconds: number, sampleSize: number}|null} Estimated seconds until the keys run
 *   out, or null when there are no keys or too few clears to estimate
 */
export function estimateKeyRunway(clears, keys) {
    if (!(keys > 0)) return null;

    const durations = [...clears]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, KEY_RUNWAY_WINDOW)
        .map((run) => run.duration || run.totalTime || 0)
        .filter((duration) => duration > 0);

    if (durations.length < KEY_RUNWAY_MIN_SAMPLES) return null;

    const averageMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    return { seconds: (averageMs / 1000) * keys, sampleSize: durations.length };
}
