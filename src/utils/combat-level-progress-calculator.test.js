import { describe, expect, test } from 'vitest';
import { calculateRawCombatLevel, calculateCombatLevelFromSkills } from './combat-level-progress-calculator.js';

describe('calculateRawCombatLevel', () => {
    test('matches the player-reported example: whole skill levels -> 133.2, not 133.39', () => {
        // Stamina 125, Intelligence 124, Attack 130, Defense 125, Melee 105, Ranged 138, Magic 77
        const result = calculateRawCombatLevel({
            stamina: 125,
            intelligence: 124,
            attack: 130,
            defense: 125,
            melee: 105,
            ranged: 138,
            magic: 77,
        });
        expect(result).toBe(133.2);
    });

    test('an exact result has no float noise (e.g. 0.1 * 3 !== 0.30000000000000004)', () => {
        // stamina+intelligence+attack+defense+max(melee,ranged,magic) = 3, primaryMax = attack = 1
        const result = calculateRawCombatLevel({
            stamina: 1,
            intelligence: 1,
            attack: 1,
            defense: 0,
            melee: 0,
            ranged: 0,
            magic: 0,
        });
        expect(result).toBe(0.8);
    });

    test('the combat-style max is max(melee, ranged, magic)', () => {
        const base = calculateRawCombatLevel({
            stamina: 50,
            intelligence: 50,
            attack: 50,
            defense: 50,
            melee: 50,
            ranged: 30,
            magic: 30,
        });
        const higherRanged = calculateRawCombatLevel({
            stamina: 50,
            intelligence: 50,
            attack: 50,
            defense: 50,
            melee: 50,
            ranged: 90,
            magic: 30,
        });
        expect(higherRanged).toBeGreaterThan(base);
    });

    test('the primary max is max(attack, defense, melee, ranged, magic)', () => {
        const base = calculateRawCombatLevel({
            stamina: 40,
            intelligence: 35,
            attack: 60,
            defense: 55,
            melee: 20,
            ranged: 20,
            magic: 15,
        });
        const higherDefense = calculateRawCombatLevel({
            stamina: 40,
            intelligence: 35,
            attack: 60,
            defense: 90,
            melee: 20,
            ranged: 20,
            magic: 15,
        });
        expect(higherDefense).toBeGreaterThan(base);
    });

    test('matches the plain formula for a fresh/low character', () => {
        const result = calculateRawCombatLevel({
            stamina: 1,
            intelligence: 1,
            attack: 1,
            defense: 1,
            melee: 1,
            ranged: 1,
            magic: 1,
        });
        const expected = 0.1 * (1 + 1 + 1 + 1 + 1) + 0.5 * 1;
        expect(result).toBeCloseTo(expected, 10);
    });
});

describe('calculateCombatLevelFromSkills', () => {
    function skill(hrid, level, experience = 0) {
        return { skillHrid: hrid, level, experience };
    }

    function makeSkills({
        stamina = 5,
        intelligence = 5,
        attack = 5,
        defense = 5,
        melee = 5,
        ranged = 3,
        magic = 3,
    } = {}) {
        return [
            skill('/skills/stamina', stamina),
            skill('/skills/intelligence', intelligence),
            skill('/skills/attack', attack),
            skill('/skills/defense', defense),
            skill('/skills/melee', melee),
            skill('/skills/ranged', ranged),
            skill('/skills/magic', magic),
        ];
    }

    test('computes the raw CL from whole skill levels only', () => {
        const result = calculateCombatLevelFromSkills(
            makeSkills({
                stamina: 125,
                intelligence: 124,
                attack: 130,
                defense: 125,
                melee: 105,
                ranged: 138,
                magic: 77,
            })
        );
        expect(result).toBe(133.2);
    });

    test('changing XP while all whole skill levels remain unchanged does not change the result', () => {
        const skills = makeSkills();
        const withXpProgress = skills.map((s) => ({ ...s, experience: s.experience + 999 }));

        expect(calculateCombatLevelFromSkills(skills)).toBe(calculateCombatLevelFromSkills(withXpProgress));
    });

    test('a real whole-skill level-up changes the result according to the formula', () => {
        const before = calculateCombatLevelFromSkills(makeSkills({ attack: 5 }));
        const after = calculateCombatLevelFromSkills(makeSkills({ attack: 10 }));
        expect(after).toBeGreaterThan(before);
    });

    test('does not require a level/XP table - works from levels alone', () => {
        expect(calculateCombatLevelFromSkills(makeSkills())).not.toBeNull();
    });

    test('returns null when a required combat skill is missing from the live skills list', () => {
        const incomplete = makeSkills().filter((s) => s.skillHrid !== '/skills/magic');
        expect(calculateCombatLevelFromSkills(incomplete)).toBeNull();
    });

    test('returns null when no skills are supplied', () => {
        expect(calculateCombatLevelFromSkills(null)).toBeNull();
    });

    test('is display-only: never mutates the skills array or its entries', () => {
        const skills = makeSkills();
        const snapshot = JSON.parse(JSON.stringify(skills));

        calculateCombatLevelFromSkills(skills);

        expect(skills).toEqual(snapshot);
    });
});
