/**
 * Tests for Efficiency Utilities
 */

import { describe, test, expect } from 'vitest';
import { calculateEfficiencyBreakdown, calculateEfficiencyMultiplier, stackAdditive } from './efficiency.js';

describe('calculateEfficiencyMultiplier', () => {
    test('calculates multiplier from efficiency percentage', () => {
        expect(calculateEfficiencyMultiplier(0)).toBe(1);
        expect(calculateEfficiencyMultiplier(50)).toBe(1.5);
        expect(calculateEfficiencyMultiplier(100)).toBe(2);
        expect(calculateEfficiencyMultiplier(150)).toBe(2.5);
        expect(calculateEfficiencyMultiplier(250)).toBe(3.5);
    });

    test('handles null/undefined as 0%', () => {
        expect(calculateEfficiencyMultiplier(null)).toBe(1);
        expect(calculateEfficiencyMultiplier(undefined)).toBe(1);
    });

    test('handles fractional efficiency', () => {
        expect(calculateEfficiencyMultiplier(33.5)).toBe(1.335);
    });
});

describe('calculateEfficiencyBreakdown', () => {
    test('calculates level efficiency with action level bonus', () => {
        const result = calculateEfficiencyBreakdown({
            requiredLevel: 10,
            skillLevel: 15,
            actionLevelBonus: 2,
        });

        expect(result.effectiveRequirement).toBe(12);
        expect(result.effectiveLevel).toBe(15);
        expect(result.levelEfficiency).toBe(3);
        expect(result.totalEfficiency).toBe(3);
    });

    test('includes tea skill level bonus in effective level', () => {
        const result = calculateEfficiencyBreakdown({
            requiredLevel: 20,
            skillLevel: 18,
            teaSkillLevelBonus: 5,
        });

        expect(result.effectiveRequirement).toBe(20);
        expect(result.effectiveLevel).toBe(25);
        expect(result.levelEfficiency).toBe(5);
    });

    test('clamps skill level to required level', () => {
        const result = calculateEfficiencyBreakdown({
            requiredLevel: 30,
            skillLevel: 10,
            teaSkillLevelBonus: 2,
        });

        expect(result.effectiveRequirement).toBe(30);
        expect(result.effectiveLevel).toBe(32);
        expect(result.levelEfficiency).toBe(2);
    });

    test('stacks efficiency sources additively', () => {
        const result = calculateEfficiencyBreakdown({
            requiredLevel: 10,
            skillLevel: 12,
            houseEfficiency: 6,
            equipmentEfficiency: 4,
            teaEfficiency: 2.5,
            communityEfficiency: 3,
            achievementEfficiency: 1,
        });

        expect(result.levelEfficiency).toBe(2);
        expect(result.totalEfficiency).toBeCloseTo(18.5, 6);
    });

    test('handles missing inputs with defaults', () => {
        const result = calculateEfficiencyBreakdown({});

        expect(result.effectiveRequirement).toBe(0);
        expect(result.effectiveLevel).toBe(0);
        expect(result.levelEfficiency).toBe(0);
        expect(result.totalEfficiency).toBe(0);
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
