import { describe, expect, test } from 'vitest';
import { calculateLevelGapDebuff, calculateCombatLevelFromLevelFields } from './combat-sim-adapter.js';

describe('calculateLevelGapDebuff', () => {
    // SERVER-CONFIRMED (direct MWI developer evidence):
    //   effectiveThreshold := max(1.2, (combatLevel+10)/combatLevel)
    //   if effectiveThreshold*combatLevel < topCombatLevel {
    //       multiplier = max(0.1, 1.0-3.0*(topCombatLevel/combatLevel-effectiveThreshold))
    //   }
    // combatLevel/topCombatLevel are the raw (unfloored) whole-skill Combat Level.

    test('B: exact 20% boundary (CL 100 / top 120) -> no malus (strict comparison)', () => {
        expect(calculateLevelGapDebuff(100, 120)).toBe(0);
    });

    test('C: just above the 20% boundary (CL 100 / top 120.1) -> continuous, unquantized malus', () => {
        // effectiveThreshold = 1.2, multiplier = 1 - 3*(1.201-1.2) = 0.997 -> debuff -0.003
        expect(calculateLevelGapDebuff(100, 120.1)).toBeCloseTo(-0.003, 6);
    });

    test('D: exactly +10 below CL 50 (CL 40 / top 50.0) -> no malus (effectiveThreshold dominates)', () => {
        // effectiveThreshold = max(1.2, 50/40) = 1.25; 1.25*40 = 50, not < 50 -> no malus
        expect(calculateLevelGapDebuff(40, 50.0)).toBe(0);
    });

    test('E: just above +10 below CL 50 (CL 40 / top 50.1)', () => {
        // effectiveThreshold = 1.25, multiplier = 1 - 3*(50.1/40 - 1.25) = 0.9925 -> debuff -0.0075
        expect(calculateLevelGapDebuff(40, 50.1)).toBeCloseTo(-0.0075, 6);
    });

    test('F: below-50 penalty baseline uses effectiveThreshold, not a fixed 1.2 (CL 40 / top 51)', () => {
        // effectiveThreshold = 1.25, ratio = 1.275, multiplier = 1 - 3*0.025 = 0.925 -> debuff -0.075
        expect(calculateLevelGapDebuff(40, 51)).toBeCloseTo(-0.075, 6);
    });

    test('G: maximum penalty cap (CL 100 / top 150) -> -0.9, and larger gaps stay capped', () => {
        expect(calculateLevelGapDebuff(100, 150)).toBeCloseTo(-0.9, 6);
        expect(calculateLevelGapDebuff(100, 1000)).toBe(-0.9);
    });

    test("no debuff for the party's own highest-level player (ratio of exactly 1)", () => {
        expect(calculateLevelGapDebuff(150, 150)).toBe(0);
    });

    test('no debuff when below the 1.2 ratio and the +10 gap', () => {
        expect(calculateLevelGapDebuff(100, 110)).toBe(0);
    });

    test('is always 0 or negative, never a bonus', () => {
        for (const [level, maxLevel] of [
            [50, 50],
            [50, 55],
            [50, 60],
            [50, 100],
        ]) {
            expect(calculateLevelGapDebuff(level, maxLevel)).toBeLessThanOrEqual(0);
        }
    });

    test('H: unfloored raw Combat Level changes eligibility at a real discrete boundary', () => {
        // Developer example: self raw CL 133.2, top raw CL 159.9.
        // Raw ratio 159.9/133.2 > 1.2 -> malus applies (must not be quantized to zero).
        // If incorrectly floored to 133/159, 159/133 < 1.2 -> malus would incorrectly disappear.
        expect(calculateLevelGapDebuff(133.2, 159.9)).toBeCloseTo(-0.001351351351, 9);
        expect(calculateLevelGapDebuff(133, 159)).toBe(0);
    });
});

describe('calculateCombatLevelFromLevelFields', () => {
    test('A: computes the raw (unfloored) combat level from combatDetails-shaped whole-skill-level fields', () => {
        // Developer example: Stamina 125, Intelligence 124, Attack 130, Defense 125, Melee 105,
        // Ranged 138, Magic 77 -> raw formula = 133.2. SERVER-CONFIRMED: this raw value, not the
        // floored native 133, is the actual Level Malus mechanic input.
        const result = calculateCombatLevelFromLevelFields({
            staminaLevel: 125,
            intelligenceLevel: 124,
            attackLevel: 130,
            defenseLevel: 125,
            meleeLevel: 105,
            rangedLevel: 138,
            magicLevel: 77,
        });
        expect(result).toBe(133.2);
    });

    test('J: no XP-within-level regression - whole levels only, never a value like 133.39', () => {
        const result = calculateCombatLevelFromLevelFields({
            staminaLevel: 125,
            intelligenceLevel: 124,
            attackLevel: 130,
            defenseLevel: 125,
            meleeLevel: 105,
            rangedLevel: 138,
            magicLevel: 77,
        });
        expect(result).not.toBeCloseTo(133.39, 1);
        expect(result).toBe(133.2);
    });
});
