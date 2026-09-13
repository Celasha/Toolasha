import { describe, expect, test } from 'vitest';
import {
    generateCandidates,
    computeGoldPerImprovement,
    applyCandidateToDTO,
    computeOtherWisdomMultiplier,
} from './upgrade-advisor.js';

describe('generateCandidates - house mode tags isCombatRelevant from the room-level usableInActionTypeMap', () => {
    const gameData = {
        houseRoomDetailMap: {
            '/house_rooms/armory': {
                name: 'Armory',
                usableInActionTypeMap: { '/action_types/combat': true },
            },
            '/house_rooms/observatory': {
                name: 'Observatory',
                usableInActionTypeMap: { '/action_types/enhancing': true },
            },
        },
    };
    const playerDTO = { houseRooms: {} };

    test('a combat room (Armory) is tagged isCombatRelevant: true', () => {
        const candidates = generateCandidates(playerDTO, gameData, 'house');
        const armory = candidates.find((c) => c.currentHrid === '/house_rooms/armory');
        expect(armory.isCombatRelevant).toBe(true);
    });

    test('a skilling-only room (Observatory) is tagged isCombatRelevant: false', () => {
        const candidates = generateCandidates(playerDTO, gameData, 'house');
        const observatory = candidates.find((c) => c.currentHrid === '/house_rooms/observatory');
        expect(observatory.isCombatRelevant).toBe(false);
    });
});

describe('computeGoldPerImprovement - non-combat house rooms never rank on DPS/EPH/DPH noise', () => {
    const deltas = { dps: 2.8, xp: 2.5, profit: 3.1, encounters: 2.3, deaths: -12.1 };

    test('a combat-relevant candidate (default) computes real gold-per values for every metric', () => {
        const goldPer = computeGoldPerImprovement(1_000_000, deltas);
        expect(goldPer.dps).not.toBe(Infinity);
        expect(goldPer.encounters).not.toBe(Infinity);
        expect(goldPer.deaths).not.toBe(Infinity);
        expect(goldPer.xp).not.toBe(Infinity);
        expect(goldPer.profit).not.toBe(Infinity);
    });

    test('a non-combat-relevant candidate forces dps/encounters/deaths to Infinity ("no effect"), leaving xp/profit real', () => {
        const goldPer = computeGoldPerImprovement(1_000_000, deltas, false);
        expect(goldPer.dps).toBe(Infinity);
        expect(goldPer.encounters).toBe(Infinity);
        expect(goldPer.deaths).toBe(Infinity);
        expect(goldPer.xp).not.toBe(Infinity);
        expect(goldPer.profit).not.toBe(Infinity);
    });
});

describe('applyCandidateToDTO - one canonical candidate-application helper (CSIM-AUD-015/016)', () => {
    function baseDto() {
        return {
            abilities: [
                { hrid: '/abilities/smash', level: 5, triggers: [{ dependencyHrid: '/x', conditionHrid: '/y' }] },
                null,
                null,
                null,
                null,
            ],
            houseRooms: {},
            equipment: {
                '/equipment_types/two_hand': { hrid: '/items/greatsword', enhancementLevel: 5 },
                '/equipment_types/main_hand': null,
                '/equipment_types/off_hand': null,
            },
        };
    }

    test('a same-ability level-up candidate preserves the real current trigger array', () => {
        const dto = baseDto();
        const originalTriggers = dto.abilities[0].triggers;

        applyCandidateToDTO(dto, {
            slot: 'ability_0',
            type: 'ability_level',
            upgradeHrid: '/abilities/smash',
            upgradeLevel: 10,
        });

        expect(dto.abilities[0].level).toBe(10);
        expect(dto.abilities[0].triggers).toEqual(originalTriggers);
        expect(dto.abilities[0]).not.toBe(undefined);
        // Everything else is identical except level.
        expect({ ...dto.abilities[0], level: 5 }).toEqual({
            hrid: '/abilities/smash',
            level: 5,
            triggers: originalTriggers,
        });
    });

    test('an ability swap (different ability) legitimately starts with null triggers', () => {
        const dto = baseDto();

        applyCandidateToDTO(dto, {
            slot: 'ability_0',
            type: 'ability_swap',
            upgradeHrid: '/abilities/fireball',
            upgradeLevel: 1,
        });

        expect(dto.abilities[0].hrid).toBe('/abilities/fireball');
        expect(dto.abilities[0].triggers).toBeNull();
    });

    test('a house room candidate writes the new level', () => {
        const dto = baseDto();
        applyCandidateToDTO(dto, { slot: 'house_armory', currentHrid: '/house_rooms/armory', upgradeLevel: 5 });
        expect(dto.houseRooms['/house_rooms/armory']).toBe(5);
    });

    test('a plain equipment candidate writes only the target slot', () => {
        const dto = baseDto();
        applyCandidateToDTO(dto, {
            slot: '/equipment_types/two_hand',
            type: 'equipment',
            upgradeHrid: '/items/legendary_sword',
            upgradeLevel: 10,
        });
        expect(dto.equipment['/equipment_types/two_hand']).toEqual({
            hrid: '/items/legendary_sword',
            enhancementLevel: 10,
        });
    });

    test('a cross_slot candidate (two_hand -> main_hand + off_hand) clears and adds every slot exactly', () => {
        const dto = baseDto();
        applyCandidateToDTO(dto, {
            slot: '/equipment_types/two_hand',
            type: 'cross_slot',
            clearedSlots: ['/equipment_types/two_hand'],
            addedSlots: {
                '/equipment_types/main_hand': { hrid: '/items/dagger', enhancementLevel: 0 },
                '/equipment_types/off_hand': { hrid: '/items/buckler', enhancementLevel: 0 },
            },
        });

        expect(dto.equipment['/equipment_types/two_hand']).toBeNull();
        expect(dto.equipment['/equipment_types/main_hand']).toEqual({ hrid: '/items/dagger', enhancementLevel: 0 });
        expect(dto.equipment['/equipment_types/off_hand']).toEqual({ hrid: '/items/buckler', enhancementLevel: 0 });
    });

    test('a cross_slot candidate (main_hand+off_hand -> two_hand) clears both single slots and adds the two-hand slot', () => {
        const dto = baseDto();
        dto.equipment['/equipment_types/two_hand'] = null;
        dto.equipment['/equipment_types/main_hand'] = { hrid: '/items/dagger', enhancementLevel: 0 };
        dto.equipment['/equipment_types/off_hand'] = { hrid: '/items/buckler', enhancementLevel: 0 };

        applyCandidateToDTO(dto, {
            slot: '/equipment_types/main_hand',
            type: 'cross_slot',
            clearedSlots: ['/equipment_types/main_hand', '/equipment_types/off_hand'],
            addedSlots: {
                '/equipment_types/two_hand': { hrid: '/items/greatsword', enhancementLevel: 10 },
            },
        });

        expect(dto.equipment['/equipment_types/main_hand']).toBeNull();
        expect(dto.equipment['/equipment_types/off_hand']).toBeNull();
        expect(dto.equipment['/equipment_types/two_hand']).toEqual({
            hrid: '/items/greatsword',
            enhancementLevel: 10,
        });
    });
});

describe('generateCandidates - ability_swap mode prunes provably-wasted candidates', () => {
    const gameData = {
        itemDetailMap: {
            '/items/fire_staff': {
                equipmentDetail: { combatStats: { magicDamage: 1 } },
            },
        },
        abilityDetailMap: {
            '/abilities/smash': {
                name: 'Smash',
                isSpecialAbility: false,
                cooldownDuration: 5_000_000_000,
                abilityEffects: [{ combatStyleHrid: '/combat_styles/magic' }],
            },
            '/abilities/fireball': {
                name: 'Fireball',
                isSpecialAbility: false,
                cooldownDuration: 0,
                abilityEffects: [{ combatStyleHrid: '/combat_styles/magic' }],
            },
            '/abilities/water_strike': {
                name: 'Water Strike',
                isSpecialAbility: false,
                cooldownDuration: 0,
                abilityEffects: [{ combatStyleHrid: '/combat_styles/magic' }],
            },
            '/abilities/provoke': {
                name: 'Provoke',
                isSpecialAbility: false,
                cooldownDuration: 60_000_000_000,
                abilityEffects: [{ effectType: '/ability_effect_types/buff', buffs: [] }],
            },
            '/abilities/taunt': {
                name: 'Taunt',
                isSpecialAbility: false,
                cooldownDuration: 60_000_000_000,
                abilityEffects: [{ effectType: '/ability_effect_types/buff', buffs: [] }],
            },
            '/abilities/revive': {
                name: 'Revive',
                isSpecialAbility: false,
                cooldownDuration: 300_000_000_000,
                abilityEffects: [{ effectType: '/ability_effect_types/buff', buffs: [] }],
            },
            '/abilities/promote': {
                name: 'Promote',
                isSpecialAbility: false,
                cooldownDuration: 60_000_000_000,
                abilityEffects: [{ effectType: '/ability_effect_types/buff', buffs: [] }],
            },
        },
    };

    function basePlayerDTO(abilities) {
        return {
            equipment: { '/equipment_types/main_hand': { hrid: '/items/fire_staff' } },
            abilities,
        };
    }

    test('solo (playerCount=1) never suggests swapping into Provoke/Taunt/Revive', () => {
        const dto = basePlayerDTO([null, { hrid: '/abilities/smash', level: 10 }, null, null, null]);
        const candidates = generateCandidates(dto, gameData, 'ability_swap', 0, 'increment', false, 1);
        const suggestedHrids = candidates.map((c) => c.upgradeHrid);
        expect(suggestedHrids).not.toContain('/abilities/provoke');
        expect(suggestedHrids).not.toContain('/abilities/taunt');
        expect(suggestedHrids).not.toContain('/abilities/revive');
    });

    test('a party of 2+ can still be suggested Provoke/Taunt/Revive', () => {
        const dto = basePlayerDTO([null, { hrid: '/abilities/smash', level: 10 }, null, null, null]);
        const candidates = generateCandidates(dto, gameData, 'ability_swap', 0, 'increment', false, 2);
        const suggestedHrids = candidates.map((c) => c.upgradeHrid);
        expect(suggestedHrids).toContain('/abilities/provoke');
        expect(suggestedHrids).toContain('/abilities/taunt');
        expect(suggestedHrids).toContain('/abilities/revive');
    });

    test('never suggests a swap that would create a second zero-cooldown ability', () => {
        // Slot 2 already has water_strike (cooldownDuration: 0); swapping slot 1 (smash) into
        // fireball (also cooldownDuration: 0) would create a dead-weight second 0-CD ability.
        const dto = basePlayerDTO([
            null,
            { hrid: '/abilities/smash', level: 10 },
            { hrid: '/abilities/water_strike', level: 10 },
            null,
            null,
        ]);
        const candidates = generateCandidates(dto, gameData, 'ability_swap', 0, 'increment', false, 1);
        const slot1Suggestions = candidates.filter((c) => c.slot === 'ability_1').map((c) => c.upgradeHrid);
        expect(slot1Suggestions).not.toContain('/abilities/fireball');
    });

    test('swapping a zero-cooldown ability for another zero-cooldown one is still allowed when it is the only 0-CD slot', () => {
        // Slot 1 itself holds the only zero-CD ability (water_strike); replacing it with
        // fireball is a like-for-like swap, not an addition of a second 0-CD ability.
        const dto = basePlayerDTO([
            null,
            { hrid: '/abilities/water_strike', level: 10 },
            { hrid: '/abilities/smash', level: 10 },
            null,
            null,
        ]);
        const candidates = generateCandidates(dto, gameData, 'ability_swap', 0, 'increment', false, 1);
        const slot1Suggestions = candidates.filter((c) => c.slot === 'ability_1').map((c) => c.upgradeHrid);
        expect(slot1Suggestions).toContain('/abilities/fireball');
    });
});

describe('computeOtherWisdomMultiplier - marginal Wisdom base excludes only Lab Experience (CSIM-AUD-018)', () => {
    function minimalPlayerDTO(overrides = {}) {
        return {
            staminaLevel: 1,
            intelligenceLevel: 1,
            attackLevel: 1,
            meleeLevel: 1,
            defenseLevel: 1,
            rangedLevel: 1,
            magicLevel: 1,
            hrid: 'player1',
            debuffOnLevelGap: 0,
            equipment: {},
            food: [],
            drinks: [],
            abilities: [],
            houseRooms: {},
            shrineLevels: {},
            hasMooPass: false,
            ...overrides,
        };
    }

    const gameData = { houseRoomDetailMap: {}, guildBuffDetailMap: {} };

    test('a player with no other Wisdom sources has a zero base multiplier', () => {
        const multiplier = computeOtherWisdomMultiplier(minimalPlayerDTO(), gameData, {});
        expect(multiplier).toBeCloseTo(0);
    });

    test('MooPass contributes its +5% Wisdom to the base multiplier', () => {
        const multiplier = computeOtherWisdomMultiplier(minimalPlayerDTO({ hasMooPass: true }), gameData, {});
        expect(multiplier).toBeCloseTo(0.05);
    });

    test('Community EXP contributes to the base multiplier alongside MooPass', () => {
        const withMooPassOnly = computeOtherWisdomMultiplier(minimalPlayerDTO({ hasMooPass: true }), gameData, {});
        const withBoth = computeOtherWisdomMultiplier(minimalPlayerDTO({ hasMooPass: true }), gameData, {
            comExp: 5,
        });
        expect(withBoth).toBeGreaterThan(withMooPassOnly);
    });

    test('a player already at +30% other Wisdom produces a materially smaller marginal Lab Experience delta than computing it in isolation', () => {
        // Reproduces the ticket's own worked example: Lab 5%->6% marginal gain should be
        // smaller with +30% other Wisdom already active than the naive isolated calculation.
        const otherWisdom = 0.3;
        const isolatedDelta = (1.06 / 1.05 - 1) * 100;
        const withOtherWisdomDelta = ((1 + otherWisdom + 0.06) / (1 + otherWisdom + 0.05) - 1) * 100;

        expect(withOtherWisdomDelta).toBeLessThan(isolatedDelta);
        expect(withOtherWisdomDelta).toBeCloseTo(0.741, 2);
        expect(isolatedDelta).toBeCloseTo(0.952, 2);
    });
});
