/**
 * Tests for calculateLevelFromActions (reverse of calculateMultiLevelProgress).
 *
 * The Target Level Calculator only propagated target-level -> actions-needed. Typing a
 * quantity directly into the queue input did not update the calculator's displayed level/xp
 * result. This function computes the reverse: given a fixed action budget, what level/xp is
 * reached.
 */

import { describe, test, expect } from 'vitest';
import { calculateMultiLevelProgress, calculateLevelFromActions } from './experience-calculator.js';

// Small synthetic xp table: index = level, value = cumulative xp required for that level.
const TABLE = [0, 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700];

describe('calculateLevelFromActions', () => {
    test('round-trips with calculateMultiLevelProgress: spending exactly actionsNeeded reaches the target level', () => {
        const currentLevel = 2;
        const currentXP = 100; // exactly at the level-2 threshold
        const targetLevel = 5;
        const baseEfficiency = 10;
        const actionTime = 3;
        const xpPerAction = 20;

        const forward = calculateMultiLevelProgress(
            currentLevel,
            currentXP,
            targetLevel,
            baseEfficiency,
            actionTime,
            xpPerAction,
            TABLE
        );

        const reverse = calculateLevelFromActions(
            currentLevel,
            currentXP,
            forward.actionsNeeded,
            baseEfficiency,
            actionTime,
            xpPerAction,
            TABLE
        );

        expect(reverse.finalLevel).toBe(targetLevel);
        expect(reverse.finalXP).toBe(TABLE[targetLevel]);
        expect(reverse.timeElapsed).toBe(forward.timeNeeded);
        expect(reverse.percentToNext).toBeCloseTo(0, 5);
    });

    test('a partial action budget makes progress within the current level without leveling up', () => {
        const currentLevel = 3;
        const currentXP = 250;
        const baseEfficiency = 0;
        const actionTime = 2;
        const xpPerAction = 10;

        // xpNeeded for level 4 is 450 - 250 = 200, so ~20 actions would clear it; spend far fewer.
        const result = calculateLevelFromActions(
            currentLevel,
            currentXP,
            5,
            baseEfficiency,
            actionTime,
            xpPerAction,
            TABLE
        );

        expect(result.finalLevel).toBe(currentLevel);
        expect(result.xpGained).toBeGreaterThan(0);
        expect(result.finalXP).toBeLessThan(TABLE[currentLevel + 1]);
        expect(result.percentToNext).toBeGreaterThan(0);
        expect(result.percentToNext).toBeLessThan(100);
    });

    test('an action budget spanning multiple levels advances through all of them', () => {
        const currentLevel = 2;
        const currentXP = 100;
        const baseEfficiency = 0;
        const actionTime = 1;
        const xpPerAction = 500; // large enough to clear several levels per action

        const result = calculateLevelFromActions(
            currentLevel,
            currentXP,
            10,
            baseEfficiency,
            actionTime,
            xpPerAction,
            TABLE
        );

        expect(result.finalLevel).toBeGreaterThan(currentLevel);
        expect(result.finalLevel).toBeLessThanOrEqual(10);
    });

    test('zero actions makes no progress', () => {
        const currentLevel = 4;
        const currentXP = 500;

        const result = calculateLevelFromActions(currentLevel, currentXP, 0, 0, 1, 10, TABLE);

        expect(result.finalLevel).toBe(currentLevel);
        expect(result.finalXP).toBe(currentXP);
        expect(result.xpGained).toBe(0);
        expect(result.timeElapsed).toBe(0);
    });

    test('a negative action count makes no progress (defensive, mirrors invalid-input guard)', () => {
        const result = calculateLevelFromActions(4, 500, -5, 0, 1, 10, TABLE);

        expect(result.finalLevel).toBe(4);
        expect(result.finalXP).toBe(500);
        expect(result.xpGained).toBe(0);
    });

    test('already at the max level in the table makes no further progress and reports 100% to next', () => {
        const maxLevel = TABLE.length - 1; // no TABLE[maxLevel + 1] entry
        const currentXP = TABLE[maxLevel];

        const result = calculateLevelFromActions(maxLevel, currentXP, 1000, 0, 1, 10, TABLE);

        expect(result.finalLevel).toBe(maxLevel);
        expect(result.finalXP).toBe(currentXP);
        expect(result.xpGained).toBe(0);
        expect(result.timeElapsed).toBe(0);
        expect(result.percentToNext).toBe(100);
    });

    test('excess actions beyond the max level are not spent past it', () => {
        const maxLevel = TABLE.length - 1;
        const currentLevel = maxLevel - 1;
        const currentXP = TABLE[currentLevel];

        const result = calculateLevelFromActions(currentLevel, currentXP, 100000, 0, 1, 10, TABLE);

        expect(result.finalLevel).toBe(maxLevel);
        expect(result.finalXP).toBe(TABLE[maxLevel]);
    });
});
