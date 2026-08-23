import { describe, expect, test } from 'vitest';
import { generateCandidates, computeGoldPerImprovement } from './upgrade-advisor.js';

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
