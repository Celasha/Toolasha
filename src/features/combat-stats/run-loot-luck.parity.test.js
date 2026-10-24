import { describe, expect, test } from 'vitest';
import { buildRunLootData } from './run-loot-luck.js';

// Uses the real Combat Sim drop helper (no mock) so the variance can never drift from the
// probability and quantity it uses for the expected drops.
const GAME_DATA = {
    combatMonsterDetailMap: {
        '/monsters/rat': {
            dropTable: [
                { itemHrid: '/items/tail', dropRate: 0.25, dropRatePerDifficultyTier: 0.01, minCount: 1, maxCount: 4 },
            ],
            rareDropTable: [{ itemHrid: '/items/whisker', dropRate: 0.002, minCount: 1, maxCount: 1 }],
        },
    },
};
const FIGHT_INFO = {
    randomSpawnInfo: {
        spawns: [{ combatMonsterHrid: '/monsters/rat', strength: 1, rate: 1, difficultyTier: 0 }],
        maxSpawnCount: 1,
        maxTotalStrength: 1,
    },
};

describe('run loot luck parity with the real Combat Sim helper', () => {
    test('variance / expected equals (1 - p) * quantity for every item, under the same modifiers', () => {
        const modifiers = {
            difficultyTier: 2,
            numberOfPlayers: 3,
            dropRateMultiplier: 1.15,
            rareFindMultiplier: 1.4,
            combatDropQuantity: 0.2,
            debuffOnLevelGap: -0.1,
        };
        const data = buildRunLootData(
            { zoneHrid: '/actions/combat/rat', completedWaves: 500, elapsedSeconds: 3600, actualLoot: [], modifiers },
            GAME_DATA,
            FIGHT_INFO
        );

        const quantity = (average) => (average * 0.9 * 1.2) / 3;

        const tailP = 1.2 * (0.25 + 0.01 * 2) * 1.15;
        expect(data.varianceUnits.get('/items/tail') / data.expectedDropsMap.get('/items/tail')).toBeCloseTo(
            (1 - tailP) * quantity(2.5),
            10
        );

        const whiskerP = 0.002 * 1.4;
        expect(data.varianceUnits.get('/items/whisker') / data.expectedDropsMap.get('/items/whisker')).toBeCloseTo(
            (1 - whiskerP) * quantity(1),
            10
        );
    });
});
