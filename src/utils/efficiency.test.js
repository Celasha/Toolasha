/**
 * Tests for Efficiency Utilities
 * Testing game mechanics calculations (efficiency, buffs, time)
 */

import { describe, test, expect } from 'vitest';
import {
    calculateEfficiency,
    calculateExpectedOutput,
    calculateActionTime,
    calculateTotalTime,
    calculateActionsForTarget,
    calculateXpPerHour,
    calculateLevelProgress,
    stackAdditive,
    stackMultiplicative,
} from './efficiency.js';

describe('calculateEfficiency', () => {
    test('calculates efficiency with no bonus (0%)', () => {
        const result = calculateEfficiency(0);
        expect(result).toEqual({
            guaranteed: 1,
            chanceForMore: 0,
            min: 1,
            max: 1,
        });
    });

    test('calculates efficiency with 50% bonus', () => {
        const result = calculateEfficiency(50);
        expect(result).toEqual({
            guaranteed: 1,
            chanceForMore: 50,
            min: 1,
            max: 2,
        });
    });

    test('calculates efficiency with 150% bonus', () => {
        const result = calculateEfficiency(150);
        expect(result).toEqual({
            guaranteed: 2,
            chanceForMore: 50,
            min: 2,
            max: 3,
        });
    });

    test('calculates efficiency with exactly 100%', () => {
        const result = calculateEfficiency(100);
        expect(result).toEqual({
            guaranteed: 2,
            chanceForMore: 0,
            min: 2,
            max: 2,
        });
    });

    test('calculates efficiency with 250%', () => {
        const result = calculateEfficiency(250);
        expect(result).toEqual({
            guaranteed: 3,
            chanceForMore: 50,
            min: 3,
            max: 4,
        });
    });

    test('calculates efficiency with 99%', () => {
        const result = calculateEfficiency(99);
        expect(result).toEqual({
            guaranteed: 1,
            chanceForMore: 99,
            min: 1,
            max: 2,
        });
    });
});

describe('calculateExpectedOutput', () => {
    test('calculates expected output with 0% efficiency', () => {
        expect(calculateExpectedOutput(0, 1)).toBe(1);
    });

    test('calculates expected output with 50% efficiency', () => {
        expect(calculateExpectedOutput(50, 1)).toBe(1.5);
    });

    test('calculates expected output with 150% efficiency', () => {
        expect(calculateExpectedOutput(150, 1)).toBe(2.5);
    });

    test('calculates expected output with 100% efficiency', () => {
        expect(calculateExpectedOutput(100, 1)).toBe(2);
    });

    test('respects baseOutput parameter', () => {
        expect(calculateExpectedOutput(50, 2)).toBe(3); // 1.5 actions × 2 output
        expect(calculateExpectedOutput(100, 3)).toBe(6); // 2 actions × 3 output
    });

    test('uses default baseOutput of 1', () => {
        expect(calculateExpectedOutput(50)).toBe(1.5);
    });
});

describe('calculateActionTime', () => {
    test('calculates action time with no speed bonus', () => {
        expect(calculateActionTime(6, 0)).toBe(6);
    });

    test('calculates action time with 30% speed bonus', () => {
        const result = calculateActionTime(6, 30);
        expect(result).toBeCloseTo(4.615, 3);
    });

    test('calculates action time with 50% speed bonus', () => {
        expect(calculateActionTime(10, 50)).toBe(10 / 1.5);
    });

    test('calculates action time with 100% speed bonus', () => {
        expect(calculateActionTime(8, 100)).toBe(4);
    });

    test('handles decimal base times', () => {
        expect(calculateActionTime(5.5, 20)).toBeCloseTo(4.583, 3);
    });
});

describe('calculateTotalTime', () => {
    test('calculates total time with no efficiency', () => {
        expect(calculateTotalTime(5, 100, 0)).toBe(500);
    });

    test('calculates total time with 50% efficiency', () => {
        const result = calculateTotalTime(5, 100, 50);
        expect(result).toBeCloseTo(333.33, 2);
    });

    test('calculates total time with 100% efficiency', () => {
        expect(calculateTotalTime(5, 100, 100)).toBe(250);
    });

    test('uses default efficiency of 0', () => {
        expect(calculateTotalTime(5, 100)).toBe(500);
    });

    test('handles decimal action times', () => {
        const result = calculateTotalTime(4.5, 50, 50);
        expect(result).toBeCloseTo(150, 1);
    });
});

describe('calculateActionsForTarget', () => {
    test('calculates actions needed with 0% efficiency', () => {
        const result = calculateActionsForTarget(100, 0);
        expect(result).toEqual({
            min: 100,
            max: 100,
            expected: 100,
        });
    });

    test('calculates actions needed with 150% efficiency', () => {
        const result = calculateActionsForTarget(100, 150);
        expect(result).toEqual({
            min: 34, // Best case: always 3 output
            max: 50, // Worst case: always 2 output
            expected: 40, // Average: 2.5 output
        });
    });

    test('calculates actions needed with 50% efficiency', () => {
        const result = calculateActionsForTarget(100, 50);
        expect(result).toEqual({
            min: 50, // Best case: always 2 output
            max: 100, // Worst case: always 1 output
            expected: 67, // Average: 1.5 output
        });
    });

    test('handles targets that do not divide evenly', () => {
        const result = calculateActionsForTarget(99, 150);
        expect(result.min).toBe(33); // ceil(99/3)
        expect(result.max).toBe(50); // ceil(99/2)
        expect(result.expected).toBe(40); // ceil(99/2.5)
    });
});

describe('calculateXpPerHour', () => {
    test('calculates XP per hour from JSDoc example', () => {
        expect(calculateXpPerHour(50, 5)).toBe(36000);
    });

    test('calculates XP per hour with different values', () => {
        expect(calculateXpPerHour(100, 10)).toBe(36000);
        expect(calculateXpPerHour(25, 2)).toBe(45000);
    });

    test('handles decimal action times', () => {
        expect(calculateXpPerHour(50, 4.5)).toBeCloseTo(40000, 1);
    });

    test('handles decimal XP values', () => {
        expect(calculateXpPerHour(33.5, 6)).toBeCloseTo(20100, 1);
    });
});

describe('calculateLevelProgress', () => {
    test('calculates progress percentage', () => {
        expect(calculateLevelProgress(50, 100)).toBe(50);
        expect(calculateLevelProgress(25, 100)).toBe(25);
        expect(calculateLevelProgress(75, 100)).toBe(75);
    });

    test('handles 0 XP needed (max level)', () => {
        expect(calculateLevelProgress(0, 0)).toBe(100);
        expect(calculateLevelProgress(100, 0)).toBe(100);
    });

    test('caps at 100%', () => {
        expect(calculateLevelProgress(150, 100)).toBe(100);
        expect(calculateLevelProgress(200, 100)).toBe(100);
    });

    test('handles 0 current XP', () => {
        expect(calculateLevelProgress(0, 100)).toBe(0);
    });

    test('handles decimal values', () => {
        expect(calculateLevelProgress(33.5, 100)).toBe(33.5);
        expect(calculateLevelProgress(66.7, 100)).toBeCloseTo(66.7, 1);
    });
});

describe('stackAdditive', () => {
    test('stacks bonuses additively from JSDoc example', () => {
        expect(stackAdditive(10, 20, 5)).toBe(35);
    });

    test('handles single bonus', () => {
        expect(stackAdditive(10)).toBe(10);
    });

    test('handles two bonuses', () => {
        expect(stackAdditive(15, 25)).toBe(40);
    });

    test('handles many bonuses', () => {
        expect(stackAdditive(5, 10, 15, 20, 25)).toBe(75);
    });

    test('handles zero bonuses', () => {
        expect(stackAdditive(0, 0, 0)).toBe(0);
    });

    test('handles negative bonuses', () => {
        expect(stackAdditive(10, -5, 15)).toBe(20);
    });

    test('handles decimal bonuses', () => {
        expect(stackAdditive(10.5, 20.3, 5.2)).toBeCloseTo(36, 1);
    });
});

describe('stackMultiplicative', () => {
    test('stacks bonuses multiplicatively from JSDoc example', () => {
        expect(stackMultiplicative(10, 20)).toBeCloseTo(32, 10);
    });

    test('handles single bonus', () => {
        expect(stackMultiplicative(10)).toBeCloseTo(10, 10);
    });

    test('handles two bonuses', () => {
        expect(stackMultiplicative(50, 50)).toBe(125); // 1.5 × 1.5 = 2.25 (125%)
    });

    test('handles three bonuses', () => {
        const result = stackMultiplicative(10, 10, 10);
        expect(result).toBeCloseTo(33.1, 1); // 1.1 × 1.1 × 1.1 = 1.331 (33.1%)
    });

    test('handles zero bonuses', () => {
        expect(stackMultiplicative(0, 0, 0)).toBe(0);
    });

    test('handles 100% bonus', () => {
        expect(stackMultiplicative(100)).toBe(100);
        expect(stackMultiplicative(100, 100)).toBe(300); // 2 × 2 = 4 (300%)
    });

    test('handles decimal bonuses', () => {
        const result = stackMultiplicative(12.5, 15.5);
        expect(result).toBeCloseTo(29.94, 2); // 1.125 × 1.155 = 1.299375
    });
});
