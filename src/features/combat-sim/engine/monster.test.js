import { describe, expect, test } from 'vitest';
import Monster from './monster.js';
import { setGameData } from './game-data.js';

function makeGameMonster(overrides = {}) {
    return {
        enrageTime: 1000,
        abilities: [],
        dropTable: [],
        rareDropTable: [],
        experience: 100,
        combatDetails: {
            staminaLevel: 10,
            intelligenceLevel: 10,
            attackLevel: 10,
            meleeLevel: 10,
            defenseLevel: 10,
            rangedLevel: 10,
            magicLevel: 10,
            attackInterval: 3000000000,
            combatStats: {
                combatStyleHrids: ['/combat_styles/smash'],
                armor: 20,
                waterResistance: 10,
                natureResistance: 10,
                fireResistance: 10,
                ...overrides.combatStats,
            },
        },
    };
}

function buildMonsterAtRoomLevel(roomLevel) {
    setGameData({
        combatMonsterDetailMap: {
            '/monsters/test_monster': makeGameMonster(),
        },
    });
    const monster = new Monster('/monsters/test_monster', 0, roomLevel);
    monster.updateCombatDetails();
    return monster;
}

describe('Monster Labyrinth defense scaling (CSIM-AUD-005) - scale once, not twice', () => {
    test('totalArmor scales linearly with roomLevel/100, not squared', () => {
        const baseline = buildMonsterAtRoomLevel(100); // scaleFactor = 1
        const doubled = buildMonsterAtRoomLevel(200); // scaleFactor = 2
        const halved = buildMonsterAtRoomLevel(50); // scaleFactor = 0.5

        expect(doubled.combatDetails.totalArmor).toBeCloseTo(baseline.combatDetails.totalArmor * 2);
        expect(halved.combatDetails.totalArmor).toBeCloseTo(baseline.combatDetails.totalArmor * 0.5);

        // The pre-fix bug would have produced factor^2 (4x/0.25x) instead of factor (2x/0.5x).
        expect(doubled.combatDetails.totalArmor).not.toBeCloseTo(baseline.combatDetails.totalArmor * 4);
    });

    test('totalWaterResistance/totalNatureResistance/totalFireResistance also scale linearly once', () => {
        const baseline = buildMonsterAtRoomLevel(100);
        const veryHigh = buildMonsterAtRoomLevel(500); // scaleFactor = 5

        expect(veryHigh.combatDetails.totalWaterResistance).toBeCloseTo(
            baseline.combatDetails.totalWaterResistance * 5
        );
        expect(veryHigh.combatDetails.totalNatureResistance).toBeCloseTo(
            baseline.combatDetails.totalNatureResistance * 5
        );
        expect(veryHigh.combatDetails.totalFireResistance).toBeCloseTo(baseline.combatDetails.totalFireResistance * 5);
    });

    test('non-Labyrinth monsters (roomLevel 0) are unaffected by any scaling', () => {
        const monster = buildMonsterAtRoomLevel(0);
        // 0.2 * defenseLevel + combatStats.armor, with defLevelMultiplier=1, levelBonus=0, difficultyTier=0
        expect(monster.combatDetails.totalArmor).toBeCloseTo(0.2 * 10 + 20);
    });
});
