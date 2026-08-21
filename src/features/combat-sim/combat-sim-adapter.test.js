import { describe, expect, test } from 'vitest';
import { calculateLevelGapDebuff, calculateCombatLevelFromLevelFields } from './combat-sim-adapter.js';

describe('calculateLevelGapDebuff', () => {
    test('no debuff when ratio is exactly at the 1.2 threshold', () => {
        expect(calculateLevelGapDebuff(100, 120)).toBe(0);
    });

    test('no debuff when ratio is below the 1.2 threshold', () => {
        expect(calculateLevelGapDebuff(100, 110)).toBe(0);
    });

    test("no debuff for the party's own highest-level player (ratio of exactly 1)", () => {
        expect(calculateLevelGapDebuff(150, 150)).toBe(0);
    });

    test('applies a debuff just above the 1.2 threshold', () => {
        // ratio = 130/100 = 1.3 -> levelPercent = floor((1.3-1.2)*100)/100 = 0.1 -> -min(0.9, 0.3) = -0.3
        expect(calculateLevelGapDebuff(100, 130)).toBeCloseTo(-0.3, 5);
    });

    test('caps the debuff at -0.9 for very large level gaps', () => {
        // ratio = 1000/100 = 10 -> levelPercent = floor((10-1.2)*100)/100 = 8.8 -> -min(0.9, 26.4) = -0.9
        expect(calculateLevelGapDebuff(100, 1000)).toBe(-0.9);
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

    describe('the official 10-level-gap requirement (both ratio > 1.2 AND gap >= 10 are required)', () => {
        test('ratio above 1.2 but gap under 10 -> no malus', () => {
            // 49.9/40 = 1.2475 > 1.2, but the gap is only 9.9 levels
            expect(calculateLevelGapDebuff(40.0, 49.9)).toBe(0);
        });

        test('gap exactly 10 and ratio above 1.2 -> malus applies', () => {
            // 50/40 = 1.25 > 1.2, gap = 10.0 -> levelPercent = floor((1.25-1.2)*100)/100 = 0.05
            expect(calculateLevelGapDebuff(40.0, 50.0)).toBeCloseTo(-0.15, 5);
        });

        test('ratio exactly 1.2 -> no malus regardless of the absolute gap', () => {
            expect(calculateLevelGapDebuff(100.0, 120.0)).toBe(0);
        });

        test('flooring the canonical Combat Level (not a raw value) can flip Malus eligibility at the boundary', () => {
            // Raw combat levels 100.9 and 121.0: raw ratio = 121.0/100.9 ~= 1.1992 (<= 1.2), not
            // eligible. Floored (the value the game actually computes/displays) = 100 and 121:
            // floored ratio = 1.21 (> 1.2) and gap = 21 (>= 10), eligible. calculateLevelGapDebuff
            // itself is precision-agnostic - it's the caller's job to pass the canonical floored
            // value, which real call sites (Combat Sim, Combat Stats) now do.
            expect(calculateLevelGapDebuff(100.9, 121.0)).toBe(0);
            expect(calculateLevelGapDebuff(100, 121)).not.toBe(0);
        });
    });
});

describe('calculateCombatLevelFromLevelFields', () => {
    test('computes the canonical (floored) combat level from combatDetails-shaped whole-skill-level fields', () => {
        // Same example as the report: Stamina 125, Intelligence 124, Attack 130, Defense 125,
        // Melee 105, Ranged 138, Magic 77 -> raw formula = 133.2, floored to 133 to match the
        // game's own getCombatLevel()/combatDetails.combatLevel - there is no independent
        // evidence of a separate raw/pre-floor Combat Level used anywhere in the game.
        const result = calculateCombatLevelFromLevelFields({
            staminaLevel: 125,
            intelligenceLevel: 124,
            attackLevel: 130,
            defenseLevel: 125,
            meleeLevel: 105,
            rangedLevel: 138,
            magicLevel: 77,
        });
        expect(result).toBe(133);
    });
});
