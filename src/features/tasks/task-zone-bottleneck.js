/**
 * Combat Zone Bottleneck
 *
 * Given the active combat quests mapped to one zone and that zone's combat-sim SimResult,
 * finds the quest that takes longest to finish (the "bottleneck") and the total number of
 * fights needed in the zone to clear every quest there, since the player keeps fighting at
 * the zone's natural spawn mix until the slowest-progressing quest completes.
 */

/**
 * @param {Array<{hrid: string, name: string, remaining: number, killsPerHour: number, hoursNeeded: number}>} zoneTasks
 *   Active combat quests mapped to this zone.
 * @param {Object} simResult - SimResult for this zone (must have a `deaths` map: monsterHrid -> kills).
 * @returns {{hoursNeeded: number, fightsNeeded: number, bottleneckHrid: string, bottleneckName: string}|null}
 *   Null when there are no quests in the zone.
 */
export function computeZoneBottleneck(zoneTasks, simResult) {
    if (!zoneTasks.length) return null;

    const bottleneck = zoneTasks.reduce((a, b) => (a.hoursNeeded > b.hoursNeeded ? a : b));
    const totalFightsPerHour = Object.values(simResult.deaths || {}).reduce((sum, v) => sum + v, 0);
    const fightsNeeded = totalFightsPerHour > 0 ? Math.round(totalFightsPerHour * bottleneck.hoursNeeded) : Infinity;

    return {
        hoursNeeded: bottleneck.hoursNeeded,
        fightsNeeded,
        bottleneckHrid: bottleneck.hrid,
        bottleneckName: bottleneck.name,
    };
}
