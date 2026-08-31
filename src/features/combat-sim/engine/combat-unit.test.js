import { describe, expect, test } from 'vitest';
import CombatUnit from './combat-unit.js';

function makeUnit() {
    const unit = new CombatUnit();
    unit.isPlayer = true;
    // Real callers always assign an array before generatePermanentBuffs() runs
    // (combat-sim-worker-entry.js:52); the class field default is a plain object.
    unit.zoneBuffs = [];
    return unit;
}

describe('CombatUnit.addBuff ownership (CSIM-AUD-020A)', () => {
    test('stores a clone instead of mutating/storing the caller-owned buff object', () => {
        const unit = makeUnit();
        const sourceBuff = {
            uniqueHrid: '/buff_uniques/test_buff',
            typeHrid: '/buff_types/damage',
            ratioBoost: 0.1,
            flatBoost: 0,
        };

        unit.addBuff(sourceBuff, 1000);

        expect(sourceBuff.startTime).toBeUndefined();
        expect(unit.combatBuffs['/buff_uniques/test_buff']).not.toBe(sourceBuff);
        expect(unit.combatBuffs['/buff_uniques/test_buff'].startTime).toBe(1000);
    });

    test('two units adding the same source buff object at different times do not corrupt each other', () => {
        const unitA = makeUnit();
        const unitB = makeUnit();
        const sourceBuff = {
            uniqueHrid: '/buff_uniques/test_buff',
            typeHrid: '/buff_types/damage',
            ratioBoost: 0.1,
            flatBoost: 0,
        };

        unitA.addBuff(sourceBuff, 1000);
        unitB.addBuff(sourceBuff, 2000);

        expect(unitA.combatBuffs['/buff_uniques/test_buff'].startTime).toBe(1000);
        expect(unitB.combatBuffs['/buff_uniques/test_buff'].startTime).toBe(2000);
        expect(sourceBuff.startTime).toBeUndefined();
    });
});

describe('CombatUnit.addPermanentBuff ownership (CSIM-AUD-020B)', () => {
    test('three identical players sharing one extraBuffs array reference all end at the same total, never +30/+55/+80 by party order', () => {
        // Mirrors combat-sim-worker-entry.js assigning the SAME extraBuffs array reference to
        // every player: two extra-buff sources of the same typeHrid (e.g. MooPass + Scholar Shrine
        // Wisdom), both flowing into every player's generatePermanentBuffs() in turn.
        const sharedExtraBuffs = [
            { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }, // MooPass
            { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 }, // Scholar Shrine
        ];

        const players = [makeUnit(), makeUnit(), makeUnit()];
        players.forEach((player) => {
            player.extraBuffs = sharedExtraBuffs;
            player.generatePermanentBuffs();
        });

        for (const player of players) {
            expect(player.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.1);
        }
        // The shared source array itself must be untouched by any player's accumulation.
        expect(sharedExtraBuffs[0].flatBoost).toBe(0.05);
        expect(sharedExtraBuffs[1].flatBoost).toBe(0.05);
    });

    test("reversing player processing order does not change any player's effective total", () => {
        const sharedExtraBuffs = [
            { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 },
            { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 },
        ];

        const players = [makeUnit(), makeUnit(), makeUnit()];
        [...players].reverse().forEach((player) => {
            player.extraBuffs = sharedExtraBuffs;
            player.generatePermanentBuffs();
        });

        for (const player of players) {
            expect(player.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.1);
        }
    });

    test('accumulates correctly for multiple distinct sources on the same player without leaking into another player', () => {
        const playerA = makeUnit();
        const playerB = makeUnit();
        const buffA = { typeHrid: '/buff_types/wisdom', flatBoost: 0.05, ratioBoost: 0 };
        const buffB = { typeHrid: '/buff_types/wisdom', flatBoost: 0.2, ratioBoost: 0 };

        playerA.addPermanentBuff(buffA);
        playerA.addPermanentBuff(buffB);
        playerB.addPermanentBuff(buffA);

        expect(playerA.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.25);
        expect(playerB.permanentBuffs['/buff_types/wisdom'].flatBoost).toBeCloseTo(0.05);
        expect(buffA.flatBoost).toBe(0.05);
        expect(buffB.flatBoost).toBe(0.2);
    });
});

describe('CombatUnit.updateCombatDetails - effective Threat (CSIM-AUD-022)', () => {
    test('no gear threat, no buff -> 100', () => {
        const unit = makeUnit();
        unit.combatDetails.combatStats.threat = 0;
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.threat).toBe(100);
        expect(unit.combatDetails.totalThreat).toBe(100);
    });

    test('Taunt-style ratioBoost 2.5 with no gear threat -> 350', () => {
        const unit = makeUnit();
        unit.combatDetails.combatStats.threat = 0;
        unit.combatBuffs['/buff_uniques/taunt'] = { typeHrid: '/buff_types/threat', ratioBoost: 2.5, flatBoost: 0 };
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.threat).toBe(350);
        expect(unit.combatDetails.totalThreat).toBe(350);
    });

    test('Provoke-style ratioBoost 5.0 with no gear threat -> 600', () => {
        const unit = makeUnit();
        unit.combatDetails.combatStats.threat = 0;
        unit.combatBuffs['/buff_uniques/provoke'] = { typeHrid: '/buff_types/threat', ratioBoost: 5.0, flatBoost: 0 };
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.threat).toBe(600);
    });

    test('equipment flat threat + ratio buff compose once: (100+50)*(1+2.5) = 525', () => {
        const unit = makeUnit();
        unit.combatDetails.combatStats.threat = 50;
        unit.combatBuffs['/buff_uniques/taunt'] = { typeHrid: '/buff_types/threat', ratioBoost: 2.5, flatBoost: 0 };
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.threat).toBe(525);
    });

    test('flat threat buff composes after the ratio: (100+0)*(1+0)+10 = 110', () => {
        const unit = makeUnit();
        unit.combatDetails.combatStats.threat = 0;
        unit.combatBuffs['/buff_uniques/flat_threat'] = {
            typeHrid: '/buff_types/threat',
            ratioBoost: 0,
            flatBoost: 10,
        };
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.threat).toBe(110);
    });

    test('repeated updateCombatDetails() calls stay idempotent when the gear-derived stat is freshly reset each time (mirrors the Player/Monster contract)', () => {
        const unit = makeUnit();
        unit.combatBuffs['/buff_uniques/taunt'] = { typeHrid: '/buff_types/threat', ratioBoost: 2.5, flatBoost: 0 };

        unit.combatDetails.combatStats.threat = 0;
        unit.updateCombatDetails();
        const first = unit.combatDetails.combatStats.threat;

        unit.combatDetails.combatStats.threat = 0;
        unit.updateCombatDetails();
        const second = unit.combatDetails.combatStats.threat;

        expect(first).toBe(350);
        expect(second).toBe(350);
    });
});

describe('CombatUnit.updateCombatDetails - generic max HP/MP buff application (CSIM-AUD-021)', () => {
    function baseUnit() {
        const unit = makeUnit();
        // 10*(10+100) = 1100 base HP/MP with zero flat/ratio contribution from equipment.
        unit.staminaLevel = 100;
        unit.intelligenceLevel = 100;
        unit.combatDetails.staminaLevel = 100;
        unit.combatDetails.intelligenceLevel = 100;
        return unit;
    }

    test('0% boost leaves base HP/MP unchanged', () => {
        const unit = baseUnit();
        unit.updateCombatDetails();
        expect(unit.combatDetails.maxHitpoints).toBe(1100);
        expect(unit.combatDetails.maxManapoints).toBe(1100);
    });

    test('+20% max_hitpoints/max_manapoints (Spirit shrine level 20) turns 1100/1100 into 1320/1320', () => {
        const unit = baseUnit();
        unit.combatBuffs['/buff_uniques/max_hitpoints_guild_buff'] = {
            typeHrid: '/buff_types/max_hitpoints',
            ratioBoost: 0.2,
            flatBoost: 0,
        };
        unit.combatBuffs['/buff_uniques/max_manapoints_guild_buff'] = {
            typeHrid: '/buff_types/max_manapoints',
            ratioBoost: 0.2,
            flatBoost: 0,
        };
        unit.updateCombatDetails();
        expect(unit.combatDetails.maxHitpoints).toBe(1320);
        expect(unit.combatDetails.maxManapoints).toBe(1320);
    });

    test('repeated updateCombatDetails() calls do not compound the boost', () => {
        const unit = baseUnit();
        unit.combatBuffs['/buff_uniques/max_hitpoints_guild_buff'] = {
            typeHrid: '/buff_types/max_hitpoints',
            ratioBoost: 0.2,
            flatBoost: 0,
        };
        unit.updateCombatDetails();
        unit.updateCombatDetails();
        unit.updateCombatDetails();
        expect(unit.combatDetails.maxHitpoints).toBe(1320);
    });

    test('different per-player Spirit levels remain isolated', () => {
        const unitA = baseUnit();
        const unitB = baseUnit();
        unitA.combatBuffs['/buff_uniques/max_hitpoints_guild_buff'] = {
            typeHrid: '/buff_types/max_hitpoints',
            ratioBoost: 0.2,
            flatBoost: 0,
        };
        unitA.updateCombatDetails();
        unitB.updateCombatDetails();
        expect(unitA.combatDetails.maxHitpoints).toBe(1320);
        expect(unitB.combatDetails.maxHitpoints).toBe(1100);
    });
});

describe('CombatUnit timed-buff expiry contract (CSIM-AUD-002)', () => {
    test('a Curse/Weaken-shaped buff added with a real simulation time expires exactly at startTime + duration', () => {
        const unit = makeUnit();
        const curseBuff = {
            uniqueHrid: '/buff_uniques/curse',
            typeHrid: '/buff_types/damage_taken',
            ratioBoost: 0,
            flatBoost: 5,
            duration: 15000000000,
        };

        unit.addBuff(curseBuff, 1000);
        expect(unit.combatBuffs['/buff_uniques/curse']).toBeDefined();

        unit.removeExpiredBuffs(1000 + 15000000000 - 1);
        expect(unit.combatBuffs['/buff_uniques/curse']).toBeDefined();

        unit.removeExpiredBuffs(1000 + 15000000000);
        expect(unit.combatBuffs['/buff_uniques/curse']).toBeUndefined();
    });

    test('a buff added without a simulation time (undefined startTime) never auto-expires via removeExpiredBuffs - it relies solely on its own dedicated expiration event', () => {
        // Documents the existing, intentional contract for engine callers (e.g. Enrage) that are
        // out of TLA-029's scope and still register buffs without a time argument: removeExpiredBuffs
        // must not silently drop or crash on a non-finite startTime, it just leaves the buff alone.
        const unit = makeUnit();
        const enrageBuff = {
            uniqueHrid: '/buff_uniques/enrage_damage',
            typeHrid: '/buff_types/damage',
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 15000000000,
        };

        unit.addBuff(enrageBuff);
        expect(unit.combatBuffs['/buff_uniques/enrage_damage'].startTime).toBeUndefined();

        unit.removeExpiredBuffs(Number.MAX_SAFE_INTEGER);
        expect(unit.combatBuffs['/buff_uniques/enrage_damage']).toBeDefined();
    });
});

describe('CombatUnit.addAuraBuff - official party Aura strongest-source-wins (CSIM-AUD-001)', () => {
    function speedAuraBuff(ratioBoost, duration = 120000000000) {
        return {
            uniqueHrid: '/buff_uniques/speed_aura_attack_speed',
            typeHrid: '/buff_types/attack_speed',
            ratioBoost,
            flatBoost: 0,
            duration,
        };
    }

    test('a weaker Aura cast after a stronger one does not replace the effective value', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.5), 'player1', 0);
        target.addAuraBuff(speedAuraBuff(0.2), 'player2', 100);

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.5);
    });

    test('a stronger Aura cast after a weaker one replaces the effective value', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.2), 'player1', 0);
        target.addAuraBuff(speedAuraBuff(0.5), 'player2', 100);

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.5);
    });

    test('when the stronger source expires, the effective buff falls back to a still-active weaker source', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.2, 1000), 'player1', 0); // expires at 1000
        target.addAuraBuff(speedAuraBuff(0.5, 500), 'player2', 0); // expires at 500

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.5);

        target.removeExpiredBuffs(600); // stronger source (player2) has expired, weaker (player1) has not

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.2);
    });

    test('when every source expires, the buff is fully removed', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.5, 500), 'player1', 0);

        target.removeExpiredBuffs(600);

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeUndefined();
    });

    test('recasting from the same source updates that source without creating a duplicate entry', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.2, 1000), 'player1', 0);
        target.addAuraBuff(speedAuraBuff(0.3, 1000), 'player1', 100); // player1 recasts at a higher level

        expect(Object.keys(target.auraSources['/buff_uniques/speed_aura_attack_speed'])).toEqual(['player1']);
        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.3);
    });

    test('multiple party members each casting keeps only the strongest, and ordinary non-Aura buffs are unaffected', () => {
        const target = makeUnit();
        target.addAuraBuff(speedAuraBuff(0.1), 'player1', 0);
        target.addAuraBuff(speedAuraBuff(0.4), 'player2', 0);
        target.addAuraBuff(speedAuraBuff(0.3), 'player3', 0);
        target.addBuff(
            {
                uniqueHrid: '/buff_uniques/ordinary',
                typeHrid: '/buff_types/damage',
                ratioBoost: 0.05,
                flatBoost: 0,
                duration: 1000,
            },
            0
        );

        expect(target.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBe(0.4);
        expect(target.combatBuffs['/buff_uniques/ordinary'].ratioBoost).toBe(0.05);
    });
});
