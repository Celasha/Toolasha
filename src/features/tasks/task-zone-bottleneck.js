/**
 * Combat Zone Bottleneck
 *
 * Given the active combat quests mapped to one zone and that zone's combat-sim SimResult,
 * finds the quest that takes longest to finish (the "bottleneck") and the total number of
 * fights needed in the zone to clear every quest there, since the player keeps fighting at
 * the zone's natural spawn mix until the slowest-progressing quest completes.
 */

/**
 * P(X >= k) for X ~ Binomial(n, q), 0 < q < 1. Sums the lower tail in log space so large n
 * with small q cannot underflow the starting term.
 * @param {number} n - Number of fights
 * @param {number} q - Per-fight kill probability of the bottleneck monster
 * @param {number} k - Kills needed
 * @returns {number}
 */
export function binomialAtLeast(n, q, k) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    const logRatio = Math.log(q) - Math.log1p(-q);
    let logPmf = n * Math.log1p(-q);
    let lowerTail = Math.exp(logPmf);
    for (let i = 0; i < k - 1; i++) {
        logPmf += Math.log((n - i) / (i + 1)) + logRatio;
        lowerTail += Math.exp(logPmf);
    }
    return Math.max(0, 1 - lowerTail);
}

/**
 * Smallest number of fights after which the bottleneck monster has been killed at least
 * `remaining` times with probability >= `probability`, assuming it appears at most once per
 * fight with per-fight probability `q`.
 * @param {number} remaining - Kills still needed
 * @param {number} q - Per-fight kill probability (kills / encounters from the sim result)
 * @param {number} probability - Target coverage in (0, 1), e.g. 0.9
 * @returns {number|null} Null when the model does not apply (q <= 0 or q >= 1)
 */
export function fightsForQuantile(remaining, q, probability) {
    if (!(q > 0 && q < 1)) return null;
    if (remaining <= 0) return 0;

    let hi = Math.max(remaining, Math.ceil(remaining / q));
    for (let i = 0; i < 60 && binomialAtLeast(hi, q, remaining) < probability; i++) hi *= 2;

    let lo = remaining;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (binomialAtLeast(mid, q, remaining) >= probability) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/**
 * The game credits each kill to a single task, so several tasks on the same monster share one
 * kill stream: their remaining kills add up rather than progressing in parallel.
 * @param {Array<{hrid: string, name: string, remaining: number, killsPerHour: number, hoursNeeded: number}>} zoneTasks
 * @returns {Array<{hrid: string, name: string, remaining: number, killsPerHour: number, hoursNeeded: number}>}
 */
function mergeTasksByMonster(zoneTasks) {
    const byMonster = new Map();
    for (const task of zoneTasks) {
        const existing = byMonster.get(task.hrid);
        if (!existing) {
            byMonster.set(task.hrid, { ...task });
            continue;
        }
        existing.remaining += task.remaining;
        existing.hoursNeeded = existing.killsPerHour > 0 ? existing.remaining / existing.killsPerHour : Infinity;
    }
    return [...byMonster.values()];
}

/**
 * @param {Array<{hrid: string, name: string, remaining: number, killsPerHour: number, hoursNeeded: number}>} zoneTasks
 *   Active combat quests mapped to this zone.
 * @param {Object} simResult - SimResult for this zone (must have an `encounters` count: total
 *   finished encounters, kill or wipe, party-wide).
 * @param {number} simHours - Hours the sim represented by simResult actually ran for.
 * @param {number|null} [percentile] - Coverage to report for the bottleneck (0.5 = median,
 *   0.9 = 90%). Omitted/null, or when the binomial model does not apply (the monster averages one
 *   or more kills per fight), reports the mean-based estimate instead.
 * @returns {{hoursNeeded: number, fightsNeeded: number, percentile: number|null, medianFightsNeeded: number|null,
 *   medianHoursNeeded: number|null, bottleneckHrid: string, bottleneckName: string}|null}
 *   Null when there are no quests in the zone. `percentile` is the coverage actually used for
 *   `fightsNeeded`/`hoursNeeded`, or null when the mean-based fallback was used.
 */
export function computeZoneBottleneck(zoneTasks, simResult, simHours, percentile = null) {
    if (!zoneTasks.length) return null;

    const bottleneck = mergeTasksByMonster(zoneTasks).reduce((a, b) => (a.hoursNeeded > b.hoursNeeded ? a : b));
    // encounters (not deaths) is the true fight count: deaths excludes wipes with zero kills and
    // includes the player's own death entries, which would otherwise inflate this total.
    const totalFightsPerHour = (simResult.encounters || 0) / simHours;
    const meanFights = totalFightsPerHour > 0 ? Math.round(totalFightsPerHour * bottleneck.hoursNeeded) : Infinity;

    const killsPerFight = totalFightsPerHour > 0 ? bottleneck.killsPerHour / totalFightsPerHour : 0;
    const chosenFights =
        percentile !== null && percentile !== undefined
            ? fightsForQuantile(bottleneck.remaining, killsPerFight, percentile)
            : null;
    const medianFights = fightsForQuantile(bottleneck.remaining, killsPerFight, 0.5);

    return {
        hoursNeeded: chosenFights !== null ? chosenFights / totalFightsPerHour : bottleneck.hoursNeeded,
        fightsNeeded: chosenFights !== null ? chosenFights : meanFights,
        percentile: chosenFights !== null ? percentile : null,
        medianFightsNeeded: medianFights,
        medianHoursNeeded: medianFights !== null ? medianFights / totalFightsPerHour : null,
        bottleneckHrid: bottleneck.hrid,
        bottleneckName: bottleneck.name,
    };
}
