import { describe, expect, test } from 'vitest';
import { calculateLevelGapDebuff } from './combat-sim-adapter.js';

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
});
