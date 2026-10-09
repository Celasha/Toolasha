/**
 * Per-Zone Combat Task Progress
 *
 * Aggregates every active combat task by zone and computes, per zone, the total waves
 * ("fights") needed to clear every quest there and the time that will take, running one
 * combat sim per zone in parallel via the All Zones runner. Reuses the same bottleneck math
 * as the per-task "zone mode" combat estimate (see task-zone-bottleneck.js), just across every
 * zone with pending combat tasks at once instead of one zone at a time.
 */

import dataManager from '../../core/data-manager.js';
import { buildAllPlayerDTOs, buildGameDataPayload, getCommunityBuffs } from '../combat-sim/combat-sim-adapter.js';
import { runAllZonesSimulation } from '../combat-sim/all-zones-runner.js';
import { getActionName, getMonsterName } from '../../utils/game-i18n.js';
import { computeZoneBottleneck } from './task-zone-bottleneck.js';

const SIM_HOURS = 1;

/**
 * @returns {Promise<Array<{zoneHrid: string, zoneName: string, hoursNeeded: number, fightsNeeded: number, bottleneckName: string}>>}
 *   Sorted ascending by hoursNeeded (soonest-to-clear zone first). Empty array when there are
 *   no active combat quests - no simulation is run in that case.
 */
export async function computeAllZoneProgress() {
    const activeCombatQuests = (dataManager.characterQuests || []).filter(
        (q) => q.category === '/quest_category/random_task' && q.status === '/quest_status/in_progress' && q.monsterHrid
    );
    if (!activeCombatQuests.length) return [];

    // Group quests by zone, skipping any monster with no resolvable combat zone.
    const questsByZone = new Map();
    for (const quest of activeCombatQuests) {
        const zoneHrid = dataManager.getCombatZoneForMonster(quest.monsterHrid);
        if (!zoneHrid) continue;
        if (!questsByZone.has(zoneHrid)) questsByZone.set(zoneHrid, []);
        questsByZone.get(zoneHrid).push(quest);
    }

    const zoneHrids = [...questsByZone.keys()];
    if (!zoneHrids.length) return [];

    const gameData = buildGameDataPayload();
    if (!gameData) return [];

    const { players } = await buildAllPlayerDTOs();
    if (!players.length) return [];

    const communityBuffs = getCommunityBuffs();
    const monsterDetailMap = gameData.combatMonsterDetailMap || {};

    const simResults = await runAllZonesSimulation({
        gameData,
        playerDTOs: players,
        zones: zoneHrids.map((zoneHrid) => ({ zoneHrid, difficultyTier: 0 })),
        hours: SIM_HOURS,
        communityBuffs,
        useEarlyExit: false,
    });

    const results = [];
    for (let i = 0; i < zoneHrids.length; i++) {
        const zoneHrid = zoneHrids[i];
        const simResult = simResults[i];
        if (!simResult) continue;

        const zoneTasks = questsByZone.get(zoneHrid).map((quest) => {
            const remaining = Math.max((quest.goalCount ?? 0) - (quest.currentCount ?? 0), 0);
            const killsPerHour = (simResult.deaths?.[quest.monsterHrid] ?? 0) / SIM_HOURS;
            const hoursNeeded = killsPerHour > 0 ? remaining / killsPerHour : Infinity;
            const name = monsterDetailMap[quest.monsterHrid]?.name || quest.monsterHrid.split('/').pop();
            return { hrid: quest.monsterHrid, name, remaining, killsPerHour, hoursNeeded };
        });

        const bottleneck = computeZoneBottleneck(zoneTasks, simResult);
        if (!bottleneck) continue;

        const zoneName = getActionName(
            zoneHrid,
            gameData.actionDetailMap?.[zoneHrid]?.name || zoneHrid.split('/').pop()
        );
        const bottleneckName = getMonsterName(bottleneck.bottleneckHrid, bottleneck.bottleneckName);

        results.push({
            zoneHrid,
            zoneName,
            hoursNeeded: bottleneck.hoursNeeded,
            fightsNeeded: bottleneck.fightsNeeded,
            bottleneckName,
        });
    }

    results.sort((a, b) => a.hoursNeeded - b.hoursNeeded);
    return results;
}
