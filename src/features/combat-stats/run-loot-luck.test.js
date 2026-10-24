import { describe, expect, test, vi } from 'vitest';

// The real adapter pulls in marketplace/websocket modules that are not set up in this test, so it
// is mocked with the same drop formula (not a stub): the point of these tests is the run math.
vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    calculateExpectedDrops: (simResult, gameData) => {
        const totals = new Map();
        const tier = simResult.difficultyTier || 0;
        const dropRate = simResult.dropRateMultiplier.player1 || 1;
        const rareFind = simResult.rareFindMultiplier.player1 || 1;
        const quantity = simResult.combatDropQuantity.player1 || 0;
        const levelGap = simResult.debuffOnLevelGap.player1 || 0;
        for (const [hrid, kills] of Object.entries(simResult.deaths)) {
            const monster = gameData.combatMonsterDetailMap[hrid];
            for (const drop of monster?.dropTable || []) {
                const rate = Math.min(1, (1 + 0.1 * tier) * drop.dropRate * dropRate);
                const avg = (drop.minCount + drop.maxCount) / 2;
                totals.set(
                    drop.itemHrid,
                    (totals.get(drop.itemHrid) || 0) +
                        (kills * rate * avg * (1 + levelGap) * (1 + quantity)) / simResult.numberOfPlayers
                );
            }
            for (const drop of monster?.rareDropTable || []) {
                const avg = (drop.minCount + (drop.maxCount ?? drop.minCount)) / 2;
                totals.set(
                    drop.itemHrid,
                    (totals.get(drop.itemHrid) || 0) +
                        (kills * drop.dropRate * rareFind * avg * (1 + levelGap) * (1 + quantity)) /
                            simResult.numberOfPlayers
                );
            }
        }
        return totals;
    },
}));

import {
    expectedSpawnsPerWave,
    expectedKillsForRun,
    dropVarianceUnits,
    buildRunLootData,
    calculateZScore,
    classifyLuck,
} from './run-loot-luck.js';

const spawn = (hrid, strength, rate = 1) => ({ combatMonsterHrid: hrid, strength, rate, difficultyTier: 0 });

describe('expectedSpawnsPerWave', () => {
    test('one draw of one spawn is exactly one monster', () => {
        const result = expectedSpawnsPerWave({
            spawns: [spawn('/monsters/rat', 1)],
            maxSpawnCount: 1,
            maxTotalStrength: 1,
        });
        expect(result.get('/monsters/rat')).toBeCloseTo(1);
    });

    test('draws are weighted by rate', () => {
        const result = expectedSpawnsPerWave({
            spawns: [spawn('/monsters/a', 1, 3), spawn('/monsters/b', 1, 1)],
            maxSpawnCount: 1,
            maxTotalStrength: 10,
        });
        expect(result.get('/monsters/a')).toBeCloseTo(0.75);
        expect(result.get('/monsters/b')).toBeCloseTo(0.25);
    });

    test('the strength cap stops the draws, matching the sim (hand-worked case)', () => {
        // Draw 1: A .5, B .5. Draw 2: A .25+.25, B .25. Draw 3: nothing fits under 100.
        const result = expectedSpawnsPerWave({
            spawns: [spawn('/monsters/a', 40), spawn('/monsters/b', 60)],
            maxSpawnCount: 3,
            maxTotalStrength: 100,
        });
        expect(result.get('/monsters/a')).toBeCloseTo(1.0);
        expect(result.get('/monsters/b')).toBeCloseTo(0.75);
    });

    test('a zero-rate spawn never appears', () => {
        const result = expectedSpawnsPerWave({
            spawns: [spawn('/monsters/rat', 1), spawn('/monsters/boss', 0, 0)],
            maxSpawnCount: 2,
            maxTotalStrength: 5,
        });
        expect(result.has('/monsters/boss')).toBe(false);
    });

    test('missing spawn info yields nothing', () => {
        expect(expectedSpawnsPerWave(null).size).toBe(0);
        expect(expectedSpawnsPerWave({ spawns: [], maxSpawnCount: 3, maxTotalStrength: 9 }).size).toBe(0);
    });
});

describe('expectedKillsForRun', () => {
    const randomSpawnInfo = { spawns: [spawn('/monsters/rat', 1)], maxSpawnCount: 2, maxTotalStrength: 2 };

    test('a zone without a boss multiplies the per-wave composition by the waves', () => {
        const deaths = expectedKillsForRun({
            fightInfo: { randomSpawnInfo, bossSpawns: null, battlesPerBoss: 0 },
            completedWaves: 50,
        });
        expect(deaths['/monsters/rat']).toBeCloseTo(100);
    });

    test('every battlesPerBoss-th wave is the boss wave and spawns only the boss', () => {
        const deaths = expectedKillsForRun({
            fightInfo: {
                randomSpawnInfo,
                bossSpawns: [{ combatMonsterHrid: '/monsters/king_rat', difficultyTier: 0 }],
                battlesPerBoss: 10,
            },
            completedWaves: 25,
        });
        expect(deaths['/monsters/king_rat']).toBe(2);
        expect(deaths['/monsters/rat']).toBeCloseTo(23 * 2);
    });

    test('no completed waves means no kills', () => {
        expect(expectedKillsForRun({ fightInfo: { randomSpawnInfo }, completedWaves: 0 })).toEqual({});
        expect(expectedKillsForRun({ fightInfo: null, completedWaves: 10 })).toEqual({});
    });
});

describe('dropVarianceUnits', () => {
    const gameData = {
        combatMonsterDetailMap: {
            '/monsters/rat': {
                dropTable: [{ itemHrid: '/items/tail', dropRate: 0.5, minCount: 1, maxCount: 3 }],
                rareDropTable: [{ itemHrid: '/items/whisker', dropRate: 0.01, minCount: 1, maxCount: 1 }],
            },
        },
    };

    test('is kills * p * (1 - p) * quantity^2 with the same modifiers as the expected drops (hand-worked)', () => {
        // p = 0.5 * 1.2 = 0.6, quantity = 2 * 1.1 / 2 players = 1.1, expected = 10 * 0.6 * 1.1 = 6.6
        const modifiers = { numberOfPlayers: 2, dropRateMultiplier: 1.2, combatDropQuantity: 0.1 };
        const variance = dropVarianceUnits({ deaths: { '/monsters/rat': 10 }, gameData, modifiers });
        expect(variance.get('/items/tail')).toBeCloseTo(10 * 0.6 * 0.4 * 1.1 * 1.1);

        const data = buildRunLootData(
            {
                zoneHrid: '/actions/combat/rat',
                completedWaves: 10,
                elapsedSeconds: 600,
                actualLoot: [],
                modifiers,
            },
            gameData,
            { randomSpawnInfo: { spawns: [spawn('/monsters/rat', 1)], maxSpawnCount: 1, maxTotalStrength: 1 } }
        );
        expect(data.expectedDropsMap.get('/items/tail')).toBeCloseTo(6.6);
    });

    test('a drop that always happens has no variance', () => {
        const certain = {
            combatMonsterDetailMap: {
                '/monsters/rat': { dropTable: [{ itemHrid: '/items/coin', dropRate: 1, minCount: 5, maxCount: 5 }] },
            },
        };
        const variance = dropVarianceUnits({ deaths: { '/monsters/rat': 100 }, gameData: certain, modifiers: {} });
        expect(variance.has('/items/coin')).toBe(false);
    });

    test('rare find scales the rare drop probability', () => {
        const base = dropVarianceUnits({ deaths: { '/monsters/rat': 1000 }, gameData, modifiers: {} });
        const boosted = dropVarianceUnits({
            deaths: { '/monsters/rat': 1000 },
            gameData,
            modifiers: { rareFindMultiplier: 2 },
        });
        expect(boosted.get('/items/whisker')).toBeGreaterThan(base.get('/items/whisker'));
    });
});

describe('buildRunLootData', () => {
    const fightInfo = {
        randomSpawnInfo: { spawns: [spawn('/monsters/rat', 1)], maxSpawnCount: 1, maxTotalStrength: 1 },
    };
    const gameData = {
        combatMonsterDetailMap: {
            '/monsters/rat': { dropTable: [{ itemHrid: '/items/tail', dropRate: 0.5, minCount: 1, maxCount: 1 }] },
        },
    };
    const snapshot = {
        zoneHrid: '/actions/combat/rat',
        completedWaves: 200,
        elapsedSeconds: 7200,
        actualLoot: [{ itemHrid: '/items/tail', count: 90 }],
        modifiers: { difficultyTier: 0, numberOfPlayers: 1, dropRateMultiplier: 1, combatDropQuantity: 0 },
    };

    test('expects waves x per-wave composition x drop rate and carries the run window through', () => {
        const data = buildRunLootData(snapshot, gameData, fightInfo);
        expect(data.expectedDropsMap.get('/items/tail')).toBeCloseTo(100);
        expect(data.sampleSize).toBe(200);
        expect(data.elapsedSeconds).toBe(7200);
        expect(data.actualLoot).toEqual(snapshot.actualLoot);
        expect(data.isDungeon).toBe(false);
    });

    test('cannot be evaluated without waves, a time window, game data or fight info', () => {
        expect(buildRunLootData(null, gameData, fightInfo)).toBeNull();
        expect(buildRunLootData({ ...snapshot, completedWaves: 0 }, gameData, fightInfo)).toBeNull();
        expect(buildRunLootData({ ...snapshot, elapsedSeconds: 0 }, gameData, fightInfo)).toBeNull();
        expect(buildRunLootData(snapshot, null, fightInfo)).toBeNull();
        expect(buildRunLootData(snapshot, gameData, null)).toBeNull();
    });
});

describe('z-score', () => {
    test('is the standardized difference, and null without variance', () => {
        expect(calculateZScore(90, 100, 25)).toBeCloseTo(-2);
        expect(calculateZScore(100, 100, 0)).toBeNull();
    });

    test('classification boundaries', () => {
        expect(classifyLuck(0.9)).toBe('normal');
        expect(classifyLuck(-0.9)).toBe('normal');
        expect(classifyLuck(1.5)).toBe('lucky');
        expect(classifyLuck(2)).toBe('veryLucky');
        expect(classifyLuck(-1.5)).toBe('unlucky');
        expect(classifyLuck(-2)).toBe('veryUnlucky');
        expect(classifyLuck(null)).toBeNull();
    });
});
