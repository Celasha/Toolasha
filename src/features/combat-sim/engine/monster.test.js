import { afterEach, describe, expect, test, vi } from 'vitest';
import Monster from './monster.js';
import CombatUtilities from './combat-utilities.js';
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
            attackInterval: 2000000000,
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

describe('Monster attackInterval - resets from game data every call, not just when zero', () => {
    test('uses the monster-specific attackInterval from game data, not the CombatUnit class-field default', () => {
        const monster = buildMonsterAtRoomLevel(0);

        // The pre-fix bug gated this reset behind `=== 0`, but CombatUnit's class-field default is
        // 3000000000, never 0 - so the gate never fired and every monster was stuck using that
        // generic default instead of its own real attackInterval (2000000000 in this fixture,
        // divided once by the attackLevel speed formula from CombatUnit.updateCombatDetails()).
        expect(monster.combatDetails.combatStats.attackInterval).toBeCloseTo(2000000000 / (1 + 10 / 2000));
    });

    test('repeated updateCombatDetails() calls (e.g. from mid-fight buff churn) do not keep shrinking attackInterval', () => {
        const monster = buildMonsterAtRoomLevel(0);
        const afterFirstCall = monster.combatDetails.combatStats.attackInterval;

        // Simulate buff-driven recalculation happening again mid-fight (e.g. curse/enrage
        // triggering addBuff -> updateCombatDetails) with no actual stat change in between.
        monster.updateCombatDetails();
        monster.updateCombatDetails();
        monster.updateCombatDetails();

        // The pre-fix bug divided the already-shrunk value again on every call instead of
        // resetting to the true base first, so attackInterval ratcheted down with each call.
        expect(monster.combatDetails.combatStats.attackInterval).toBeCloseTo(afterFirstCall);
    });
});

describe('Monster initial ability cooldown - fixed half in the Labyrinth, random in zones', () => {
    const COOLDOWN = 20_000_000_000;
    const START = 5_000_000_000;

    function buildMonsterWithAbility(roomLevel) {
        setGameData({
            abilityDetailMap: {
                '/abilities/test_ability': {
                    manaCost: 0,
                    cooldownDuration: COOLDOWN,
                    castDuration: 0,
                    isSpecialAbility: false,
                    abilityEffects: [],
                    defaultCombatTriggers: [],
                },
            },
            combatMonsterDetailMap: {
                '/monsters/test_monster': {
                    ...makeGameMonster(),
                    abilities: [{ abilityHrid: '/abilities/test_ability', level: 1, minDifficultyTier: 0 }],
                },
            },
        });
        const monster = new Monster('/monsters/test_monster', 0, roomLevel);
        monster.updateCombatDetails();
        return monster;
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('Labyrinth monster is ready exactly half a cooldown after the encounter starts, whatever the RNG', () => {
        for (const roll of [0, 0.5, 0.999]) {
            vi.spyOn(Math, 'random').mockReturnValue(roll);
            const monster = buildMonsterWithAbility(100);
            monster.resetCooldowns(START);
            const ability = monster.abilities[0];
            expect(ability.lastUsed + ability.cooldownDuration - START).toBe(COOLDOWN / 2);
            vi.restoreAllMocks();
        }
    });

    test('zone monster keeps the random half-to-full initial cooldown', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const early = buildMonsterWithAbility(0);
        early.resetCooldowns(START);
        expect(early.abilities[0].lastUsed + COOLDOWN - START).toBe(COOLDOWN / 2);

        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        const late = buildMonsterWithAbility(0);
        late.resetCooldowns(START);
        expect(late.abilities[0].lastUsed + COOLDOWN - START).toBeGreaterThan(COOLDOWN * 0.99);
    });
});

describe('Monster auto-attack penalty (autoAttackDamage) is applied to monster auto-attacks', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function buildMonster(combatStats) {
        setGameData({
            combatMonsterDetailMap: {
                '/monsters/test_monster': makeGameMonster({ combatStats }),
            },
        });
        const monster = new Monster('/monsters/test_monster', 0, 0);
        monster.updateCombatDetails();
        return monster;
    }

    function makeTarget() {
        return {
            isPlayer: true,
            hrid: 'player1',
            taskEligibleMonsterHrids: [],
            isWeakened: false,
            combatDetails: {
                currentHitpoints: 1_000_000,
                totalArmor: 0,
                smashEvasionRating: 0,
                stabEvasionRating: 0,
                defensiveMaxDamage: 0,
                combatStats: { damageTaken: 0, physicalThorns: 0, retaliation: 0 },
            },
        };
    }

    function autoAttackDamage(monster) {
        // Guarantee a hit and a fixed roll so only the penalty can change the result.
        monster.combatDetails.smashAccuracyRating = 1_000_000;
        monster.combatDetails.smashMaxDamage = 100;
        monster.combatDetails.combatStats.criticalRate = 0;
        vi.spyOn(CombatUtilities, 'randomInt').mockReturnValue(100);
        return CombatUtilities.processAttack(monster, makeTarget()).damageDone;
    }

    test('keeps the -0.5 stat through updateCombatDetails and halves auto-attack damage', () => {
        const penalised = buildMonster({ autoAttackDamage: -0.5 });
        expect(penalised.combatDetails.combatStats.autoAttackDamage).toBe(-0.5);
        const penalisedDamage = autoAttackDamage(penalised);

        const unpenalised = buildMonster({});
        expect(unpenalised.combatDetails.combatStats.autoAttackDamage).toBe(0);
        const unpenalisedDamage = autoAttackDamage(unpenalised);

        expect(penalisedDamage).toBe(unpenalisedDamage / 2);
    });
});

describe('Monster per-style damage penalty (stabDamage) is applied to its attacks', () => {
    function buildStabMonster(combatStats) {
        setGameData({
            combatMonsterDetailMap: {
                '/monsters/test_monster': makeGameMonster({
                    combatStats: { combatStyleHrids: ['/combat_styles/stab'], ...combatStats },
                }),
            },
        });
        const monster = new Monster('/monsters/test_monster', 0, 0);
        monster.updateCombatDetails();
        return monster;
    }

    test('stabDamage -0.2 keeps the stat and lowers stab max damage by exactly 20%', () => {
        const penalised = buildStabMonster({ stabDamage: -0.2 });
        const unpenalised = buildStabMonster({});

        expect(penalised.combatDetails.combatStats.stabDamage).toBe(-0.2);
        expect(unpenalised.combatDetails.combatStats.stabDamage).toBe(0);
        expect(unpenalised.combatDetails.stabMaxDamage).toBeGreaterThan(0);
        expect(penalised.combatDetails.stabMaxDamage).toBeCloseTo(unpenalised.combatDetails.stabMaxDamage * 0.8);
    });
});
