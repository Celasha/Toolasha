import { describe, expect, test } from 'vitest';
import {
    calculateFractionalSkillLevel,
    calculateWeightedCombatScore,
    clampDisplayCombatLevel,
    calculatePreciseCombatLevel,
} from './combat-level-progress-calculator.js';

const TABLE = [0, 0, 33, 76, 132, 202, 286, 386, 503, 637, 791];

describe('calculateFractionalSkillLevel', () => {
    test('computes exact fractional progress from the native XP table', () => {
        // Level 3 threshold is 76, level 4 threshold is 132. Halfway through: 76 + (132-76)/2 = 104
        const result = calculateFractionalSkillLevel(3, 104, TABLE);
        expect(result).toBeCloseTo(3.5, 5);
    });

    test('is zero progress exactly at a level threshold', () => {
        const result = calculateFractionalSkillLevel(3, 76, TABLE);
        expect(result).toBe(3);
    });

    test('approaches but never reaches the next integer level just below the next threshold', () => {
        const result = calculateFractionalSkillLevel(3, 131, TABLE);
        expect(result).toBeGreaterThan(3.9);
        expect(result).toBeLessThan(4);
    });

    test('falls back to the plain integer level at max level (no next-level entry)', () => {
        const shortTable = [0, 0, 33];
        const result = calculateFractionalSkillLevel(2, 40, shortTable);
        expect(result).toBe(2);
    });

    test('falls back to the plain integer level when no table is supplied', () => {
        expect(calculateFractionalSkillLevel(5, 999, undefined)).toBe(5);
    });
});

describe('calculateWeightedCombatScore', () => {
    function levels(overrides = {}) {
        return {
            stamina: 50,
            intelligence: 50,
            attack: 50,
            defense: 50,
            melee: 50,
            ranged: 30,
            magic: 30,
            ...overrides,
        };
    }

    test('the combat-style max (melee/ranged/magic) changes when fractional levels cross', () => {
        const base = calculateWeightedCombatScore(levels({ melee: 50.2, ranged: 50.1, magic: 30 }));
        const crossed = calculateWeightedCombatScore(levels({ melee: 50.2, ranged: 50.3, magic: 30 }));
        // Once ranged's fractional level overtakes melee's, it becomes the combat-style max,
        // strictly increasing the weighted score even though melee did not change.
        expect(crossed).toBeGreaterThan(base);
    });

    test('the primary max (attack/defense/combat-style) changes when a fractional level crosses it', () => {
        const base = calculateWeightedCombatScore(levels({ attack: 60, defense: 59.9 }));
        const crossed = calculateWeightedCombatScore(levels({ attack: 60, defense: 60.5 }));
        expect(crossed).toBeGreaterThan(base);
    });

    test('matches the plain native raw-score formula when given integer levels', () => {
        const intLevels = { stamina: 40, intelligence: 35, attack: 60, defense: 55, melee: 70, ranged: 20, magic: 15 };
        const expected = 0.1 * (40 + 35 + 60 + 55 + Math.max(70, 20, 15)) + 0.5 * Math.max(60, 55, 70, 20, 15);
        expect(calculateWeightedCombatScore(intLevels)).toBeCloseTo(expected, 10);
    });
});

describe('clampDisplayCombatLevel', () => {
    test('a continuous score below the native integer level cannot occur after clamping', () => {
        expect(clampDisplayCombatLevel(93.5, 94)).toBe(94);
    });

    test('a continuous score at or above the next native integer displays at most N.99', () => {
        expect(clampDisplayCombatLevel(96, 94)).toBe(94.99);
        expect(clampDisplayCombatLevel(95, 94)).toBe(94.99);
    });

    test('truncates rather than rounds, so N.995 never displays as N+1.00', () => {
        expect(clampDisplayCombatLevel(94.995, 94)).toBe(94.99);
    });

    test('truncates an in-range value down instead of rounding to the nearest cent', () => {
        // 94.986 would round to 94.99 with toFixed(2); truncation must give 94.98.
        expect(clampDisplayCombatLevel(94.986, 94)).toBe(94.98);
    });

    test('passes through an exact value with no truncation drift', () => {
        expect(clampDisplayCombatLevel(94.0, 94)).toBe(94);
    });
});

describe('calculatePreciseCombatLevel', () => {
    const table = [0, 0, 33, 76, 132, 202, 286, 386, 503, 637, 791, 964, 1159];

    function skill(hrid, level, experience) {
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
            skill('/skills/stamina', stamina, table[stamina] || 0),
            skill('/skills/intelligence', intelligence, table[intelligence] || 0),
            skill('/skills/attack', attack, table[attack] || 0),
            skill('/skills/defense', defense, table[defense] || 0),
            skill('/skills/melee', melee, table[melee] || 0),
            skill('/skills/ranged', ranged, table[ranged] || 0),
            skill('/skills/magic', magic, table[magic] || 0),
        ];
    }

    test('native level increasing (via higher integer skill levels) advances the displayed whole number', () => {
        const lower = calculatePreciseCombatLevel(makeSkills({ attack: 5 }), table);
        const higher = calculatePreciseCombatLevel(makeSkills({ attack: 10 }), table);
        expect(higher.nativeCombatLevel).toBeGreaterThan(lower.nativeCombatLevel);
        expect(higher.preciseValue).toBeGreaterThanOrEqual(higher.nativeCombatLevel);
    });

    test('is display-only: never mutates the skills array or its entries', () => {
        const skills = makeSkills();
        const snapshot = JSON.parse(JSON.stringify(skills));

        calculatePreciseCombatLevel(skills, table);

        expect(skills).toEqual(snapshot);
    });

    test('returns null when a required combat skill is missing from the live skills list', () => {
        const incomplete = makeSkills().filter((s) => s.skillHrid !== '/skills/magic');
        expect(calculatePreciseCombatLevel(incomplete, table)).toBeNull();
    });

    test('returns null when no skills are supplied', () => {
        expect(calculatePreciseCombatLevel(null, table)).toBeNull();
    });

    test('returns null when no level experience table is supplied', () => {
        expect(calculatePreciseCombatLevel(makeSkills(), undefined)).toBeNull();
    });

    test('the precise value never falls below the native integer level it is paired with', () => {
        const result = calculatePreciseCombatLevel(makeSkills({ attack: 8, defense: 7 }), table);
        expect(result.preciseValue).toBeGreaterThanOrEqual(result.nativeCombatLevel);
        expect(result.preciseValue).toBeLessThanOrEqual(result.nativeCombatLevel + 0.99);
    });
});
