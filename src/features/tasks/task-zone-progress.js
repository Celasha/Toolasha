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
 * Build the spawn monster set for every non-dungeon combat zone.
 * A zone's set is the union of its regular spawns and boss spawns.
 * @param {Object} actionDetailMap - Game data action map
 * @returns {Map<string, Set<string>>} zoneHrid -> Set of monster HRIDs
 */
export function buildZoneSpawnSets(actionDetailMap) {
    const sets = new Map();
    for (const [zoneHrid, action] of Object.entries(actionDetailMap || {})) {
        if (action?.type !== '/action_types/combat') continue;
        if (action.combatZoneInfo?.isDungeon) continue;
        const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
        const bosses = action.combatZoneInfo?.fightInfo?.bossSpawns || [];
        const set = new Set();
        for (const spawn of [...spawns, ...bosses]) {
            if (spawn.combatMonsterHrid) set.add(spawn.combatMonsterHrid);
        }
        if (set.size > 0) sets.set(zoneHrid, set);
    }
    return sets;
}

/**
 * A zone is a "planet" when its spawn set strictly contains another zone's spawn set
 * (the planet zone spawns every monster of its member zones, plus bosses every 10
 * fights). Planet detection is purely data-driven from the game's spawn tables.
 * @param {Map<string, Set<string>>} zoneSpawnSets - From buildZoneSpawnSets()
 * @returns {Set<string>} Planet zone HRIDs
 */
function findPlanetHrids(zoneSpawnSets) {
    const planets = new Set();
    for (const [hrid, set] of zoneSpawnSets) {
        for (const [otherHrid, otherSet] of zoneSpawnSets) {
            if (otherHrid === hrid) continue;
            let isSubset = true;
            for (const monster of otherSet) {
                if (!set.has(monster)) {
                    isSubset = false;
                    break;
                }
            }
            // strict superset only: equal sets do not make planets of each other
            if (isSubset && otherSet.size < set.size) {
                planets.add(hrid);
                break;
            }
        }
    }
    return planets;
}

/**
 * Find the smallest planet zone whose spawn set contains the monster.
 * @param {string} monsterHrid - Monster HRID
 * @param {Map<string, Set<string>>} zoneSpawnSets - From buildZoneSpawnSets()
 * @returns {string|null} Planet zone HRID, or null when no planet contains it
 */
export function findPlanetForMonster(monsterHrid, zoneSpawnSets) {
    const planets = findPlanetHrids(zoneSpawnSets);
    let best = null;
    for (const planetHrid of planets) {
        if (!zoneSpawnSets.get(planetHrid).has(monsterHrid)) continue;
        if (best === null || zoneSpawnSets.get(planetHrid).size < zoneSpawnSets.get(best).size) {
            best = planetHrid;
        }
    }
    return best;
}

/**
 * Pick the monster that best anchors a "go fight here" jump for the planet: its game-side
 * jump handler takes a monster (not a zone), so we need a monster that lives only in this
 * planet - otherwise the game would open the window centered on a member zone instead.
 * Regular exclusive spawns win (every fight counts); exclusive bosses are the fallback
 * (only 1-in-battlesPerBoss fights spawn the boss, so counts must be converted).
 * @param {string} planetHrid - Planet zone HRID
 * @param {Object} actionDetailMap - Game data action map
 * @returns {{monsterHrid: string, isBoss: boolean, battlesPerBoss: number}|null} Anchor, or null when the planet has no exclusive monster
 */
export function findPlanetAnchorMonster(planetHrid, actionDetailMap) {
    const planet = actionDetailMap?.[planetHrid];
    const fightInfo = planet?.combatZoneInfo?.fightInfo;
    if (!fightInfo) return null;
    const spawns = (fightInfo.randomSpawnInfo?.spawns || []).map((s) => s.combatMonsterHrid).filter(Boolean);
    const bosses = (fightInfo.bossSpawns || []).map((s) => s.combatMonsterHrid).filter(Boolean);

    const others = new Set();
    for (const [zoneHrid, action] of Object.entries(actionDetailMap || {})) {
        if (zoneHrid === planetHrid || action?.type !== '/action_types/combat') continue;
        for (const spawn of action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || []) {
            if (spawn.combatMonsterHrid) others.add(spawn.combatMonsterHrid);
        }
        for (const spawn of action.combatZoneInfo?.fightInfo?.bossSpawns || []) {
            if (spawn.combatMonsterHrid) others.add(spawn.combatMonsterHrid);
        }
    }

    const exclusiveSpawn = spawns.find((monster) => !others.has(monster));
    if (exclusiveSpawn) return { monsterHrid: exclusiveSpawn, isBoss: false, battlesPerBoss: 1 };
    const exclusiveBoss = bosses.find((monster) => !others.has(monster));
    if (exclusiveBoss)
        return { monsterHrid: exclusiveBoss, isBoss: true, battlesPerBoss: fightInfo.battlesPerBoss || 10 };
    return null;
}

/**
 * @returns {Promise<Array<{zoneHrid: string, zoneName: string, hoursNeeded: number, fightsNeeded: number, bottleneckName: string, anchor: {monsterHrid: string, isBoss: boolean, battlesPerBoss: number}}>>}
 *   Sorted ascending by hoursNeeded (soonest-to-clear zone first). Empty array when there are
 *   no active combat quests - no simulation is run in that case.
 */
export async function computeAllZoneProgress() {
    const activeCombatQuests = (dataManager.characterQuests || []).filter(
        (q) => q.category === '/quest_category/random_task' && q.status === '/quest_status/in_progress' && q.monsterHrid
    );
    if (!activeCombatQuests.length) return [];

    const gameData = buildGameDataPayload();
    if (!gameData) return [];

    // Group quests by their display zone: the planet zone when one contains the
    // monster (fighting the planet progresses every member task at once), else the
    // legacy first-match combat zone for the monster.
    const zoneSpawnSets = buildZoneSpawnSets(gameData.actionDetailMap);
    const questsByZone = new Map();
    for (const quest of activeCombatQuests) {
        let zoneHrid = findPlanetForMonster(quest.monsterHrid, zoneSpawnSets);
        if (!zoneHrid) {
            zoneHrid = dataManager.getCombatZoneForMonster(quest.monsterHrid);
            if (!zoneHrid) continue;
        }
        if (!questsByZone.has(zoneHrid)) questsByZone.set(zoneHrid, []);
        questsByZone.get(zoneHrid).push(quest);
    }

    const zoneHrids = [...questsByZone.keys()];
    if (!zoneHrids.length) return [];

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
            anchor: findPlanetAnchorMonster(zoneHrid, gameData.actionDetailMap) || {
                monsterHrid: bottleneck.bottleneckHrid,
                isBoss: false,
                battlesPerBoss: 1,
            },
        });
    }

    results.sort((a, b) => a.hoursNeeded - b.hoursNeeded);
    return results;
}
