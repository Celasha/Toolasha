/**
 * Run loot luck (issue #779).
 *
 * Recomputes the expected loot of a whole regular-zone combat run from the counters the server
 * sends with every new_battle message (`battleId`, `combatStartTime`, `totalLootMap`), instead of
 * sampling encounter by encounter. `battleId` keeps advancing while the page is closed, so the run
 * is covered offline too. Everything here is pure: the collector snapshots the message and the UI
 * calls `buildRunLootData` to turn that snapshot into the shape the stats calculator consumes.
 *
 * Assumptions, all intentional and surfaced to the player:
 *  - Every wave is cleared (a wiped wave is counted as if it paid out).
 *  - Current modifiers (drop rate, rare find, drop quantity, party size, level gap) are applied to
 *    the whole run, so mid-run gear or buff changes reprice history.
 *  - Drop quantity is treated as its average. Only whether a drop happens is random in the
 *    variance, which is why the z-score is an approximation rather than an exact test.
 */

import { calculateExpectedDrops } from '../combat-sim/combat-sim-adapter.js';

/** |z| below the first limit reads as normal variance, at or above the second as a strong result. */
export const NORMAL_Z_LIMIT = 1;
export const STRONG_Z_LIMIT = 2;

/**
 * Expected number of each monster per regular wave. Mirrors the Combat Sim's spawn roll: up to
 * `maxSpawnCount` draws, each picking a spawn weighted by `rate`, stopping at the first draw that
 * would push the total strength past `maxTotalStrength` (that draw is discarded).
 * @param {{spawns: Array, maxSpawnCount: number, maxTotalStrength: number}|null|undefined} randomSpawnInfo
 * @returns {Map<string, number>} monsterHrid -> expected spawns per wave
 */
export function expectedSpawnsPerWave(randomSpawnInfo) {
    const expected = new Map();
    const spawns = (randomSpawnInfo?.spawns || []).filter((spawn) => spawn.rate > 0);
    const totalWeight = spawns.reduce((sum, spawn) => sum + spawn.rate, 0);
    if (spawns.length === 0 || totalWeight <= 0) return expected;

    const maxSpawnCount = randomSpawnInfo.maxSpawnCount || 0;
    const maxTotalStrength = randomSpawnInfo.maxTotalStrength;

    // Probability that the first i draws were all accepted with a given total strength
    let reachable = new Map([[0, 1]]);
    for (let draw = 0; draw < maxSpawnCount; draw++) {
        const next = new Map();
        for (const [strengthSoFar, probability] of reachable) {
            for (const spawn of spawns) {
                const strength = strengthSoFar + (spawn.strength || 0);
                if (strength > maxTotalStrength) continue;
                const transition = probability * (spawn.rate / totalWeight);
                next.set(strength, (next.get(strength) || 0) + transition);
                expected.set(spawn.combatMonsterHrid, (expected.get(spawn.combatMonsterHrid) || 0) + transition);
            }
        }
        reachable = next;
    }
    return expected;
}

/**
 * Expected kills of each monster over `completedWaves` waves of a regular zone.
 * Every `battlesPerBoss`-th wave is the boss wave, which spawns only the boss monsters.
 * @param {Object} params
 * @param {Object} params.fightInfo - actionDetail.combatZoneInfo.fightInfo of the zone
 * @param {number} params.completedWaves - Waves finished so far (`battleId - 1`)
 * @returns {Object} monsterHrid -> expected kills (fractional)
 */
export function expectedKillsForRun({ fightInfo, completedWaves }) {
    const deaths = {};
    if (!fightInfo || !(completedWaves > 0)) return deaths;

    const bossSpawns = fightInfo.bossSpawns || [];
    const battlesPerBoss = fightInfo.battlesPerBoss || 0;
    const hasBoss = battlesPerBoss > 0 && bossSpawns.length > 0;

    const bossWaves = hasBoss ? Math.floor(completedWaves / battlesPerBoss) : 0;
    const normalWaves = completedWaves - bossWaves;

    for (const [monsterHrid, perWave] of expectedSpawnsPerWave(fightInfo.randomSpawnInfo)) {
        deaths[monsterHrid] = (deaths[monsterHrid] || 0) + perWave * normalWaves;
    }
    for (const boss of bossSpawns) {
        if (!boss?.combatMonsterHrid) continue;
        deaths[boss.combatMonsterHrid] = (deaths[boss.combatMonsterHrid] || 0) + bossWaves;
    }
    return deaths;
}

/**
 * Per-item variance of the drop count, in units of (items)^2: sum over monsters and drops of
 * kills * p * (1 - p) * quantity^2. Uses the same rate and quantity formulas as
 * `calculateExpectedDrops`; the parity test keeps the two in step.
 * @param {Object} params
 * @param {Object} params.deaths - monsterHrid -> expected kills
 * @param {Object} params.gameData - Needs `combatMonsterDetailMap`
 * @param {Object} params.modifiers - See `buildRunLootData`
 * @returns {Map<string, number>} itemHrid -> variance in squared item counts
 */
export function dropVarianceUnits({ deaths, gameData, modifiers }) {
    const variance = new Map();
    const difficultyTier = modifiers.difficultyTier || 0;
    const numberOfPlayers = modifiers.numberOfPlayers || 1;
    const dropRateMultiplier = modifiers.dropRateMultiplier || 1;
    const rareFindMultiplier = modifiers.rareFindMultiplier || 1;
    const combatDropQuantity = modifiers.combatDropQuantity || 0;
    const debuffOnLevelGap = modifiers.debuffOnLevelGap || 0;
    const tierMultiplier = 1 + 0.1 * difficultyTier;

    const add = (itemHrid, kills, probability, averageCount) => {
        const p = Math.min(1, Math.max(0, probability));
        if (p <= 0 || p >= 1) return;
        const quantity = (averageCount * (1 + debuffOnLevelGap) * (1 + combatDropQuantity)) / numberOfPlayers;
        variance.set(itemHrid, (variance.get(itemHrid) || 0) + kills * p * (1 - p) * quantity * quantity);
    };

    for (const [monsterHrid, kills] of Object.entries(deaths)) {
        const monster = gameData?.combatMonsterDetailMap?.[monsterHrid];
        if (!monster) continue;

        for (const drop of monster.dropTable || []) {
            if (drop.minDifficultyTier > difficultyTier) continue;
            const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
            add(
                drop.itemHrid,
                kills,
                tierMultiplier * baseRate * dropRateMultiplier,
                (drop.minCount + drop.maxCount) / 2
            );
        }
        for (const drop of monster.rareDropTable || []) {
            if (drop.minDifficultyTier > difficultyTier) continue;
            add(
                drop.itemHrid,
                kills,
                drop.dropRate * rareFindMultiplier,
                (drop.minCount + (drop.maxCount ?? drop.minCount)) / 2
            );
        }
    }
    return variance;
}

/**
 * Turn a collector snapshot into the loot data the stats calculator expects.
 * @param {Object|null} snapshot - Collector's run luck snapshot
 * @param {string} snapshot.zoneHrid
 * @param {number} snapshot.completedWaves - `battleId - 1`
 * @param {number} snapshot.elapsedSeconds - From `combatStartTime` to when the snapshot was taken
 * @param {Array<{itemHrid: string, count: number}>} snapshot.actualLoot - The player's `totalLootMap`
 * @param {Object} snapshot.modifiers - difficultyTier, numberOfPlayers, dropRateMultiplier (1 = none),
 *   rareFindMultiplier (1 = none), combatDropQuantity (0 = none), debuffOnLevelGap (<= 0)
 * @param {Object} gameData - `dataManager.getInitClientData()`
 * @param {Object|null} fightInfo - The zone's `combatZoneInfo.fightInfo`
 * @returns {Object|null} Null when the run cannot be evaluated
 */
export function buildRunLootData(snapshot, gameData, fightInfo) {
    if (!snapshot || !gameData || !fightInfo || !(snapshot.completedWaves > 0) || !(snapshot.elapsedSeconds > 0)) {
        return null;
    }

    const { modifiers } = snapshot;
    const deaths = expectedKillsForRun({ fightInfo, completedWaves: snapshot.completedWaves });

    const expectedDropsMap = calculateExpectedDrops(
        {
            isDungeon: false,
            zoneName: snapshot.zoneHrid,
            deaths,
            numberOfPlayers: modifiers.numberOfPlayers || 1,
            difficultyTier: modifiers.difficultyTier || 0,
            dropRateMultiplier: { player1: modifiers.dropRateMultiplier || 1 },
            rareFindMultiplier: { player1: modifiers.rareFindMultiplier || 1 },
            combatDropQuantity: { player1: modifiers.combatDropQuantity || 0 },
            debuffOnLevelGap: { player1: modifiers.debuffOnLevelGap || 0 },
        },
        gameData,
        'player1'
    );

    return {
        expectedDropsMap,
        varianceUnits: dropVarianceUnits({ deaths, gameData, modifiers }),
        sampleSize: snapshot.completedWaves,
        elapsedSeconds: snapshot.elapsedSeconds,
        actualLoot: snapshot.actualLoot,
        modifiers,
        isDungeon: false,
    };
}

/**
 * z-score of the actual value against the expected value.
 * @param {number} actualValue
 * @param {number} expectedValue
 * @param {number} variance - In squared value units
 * @returns {number|null} Null when there is no variance to measure against
 */
export function calculateZScore(actualValue, expectedValue, variance) {
    if (!(variance > 0)) return null;
    return (actualValue - expectedValue) / Math.sqrt(variance);
}

/**
 * @param {number|null} z
 * @returns {'normal'|'lucky'|'veryLucky'|'unlucky'|'veryUnlucky'|null}
 */
export function classifyLuck(z) {
    if (z === null || !Number.isFinite(z)) return null;
    if (Math.abs(z) < NORMAL_Z_LIMIT) return 'normal';
    if (z > 0) return z >= STRONG_Z_LIMIT ? 'veryLucky' : 'lucky';
    return z <= -STRONG_Z_LIMIT ? 'veryUnlucky' : 'unlucky';
}
