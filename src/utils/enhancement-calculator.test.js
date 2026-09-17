import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as mathJs from 'mathjs';

import {
    calculateEnhancement,
    isMathJsAvailable,
    calculateSingleLevelSuccessChance,
} from './enhancement-calculator.js';

beforeAll(() => {
    globalThis.math = mathJs;
});

const BASE_PARAMS = Object.freeze({
    enhancingLevel: 1,
    houseLevel: 0,
    toolBonus: 0,
    speedBonus: 0,
    itemLevel: 1,
    blessedTea: false,
    guzzlingBonus: 1,
});

describe('calculateEnhancement non-zero starting level', () => {
    test('counts rebuild attempts below the initial enhancement after an unprotected failure', () => {
        const result = calculateEnhancement({
            ...BASE_PARAMS,
            startLevel: 1,
            targetLevel: 2,
            protectFrom: 0,
        });

        // From +1: success to +2 is 45%; failure returns to +0. Solving the
        // two-state recurrence gives E(+1 -> +2) = 14 / 3 attempts.
        expect(result.attempts).toBeCloseTo(14 / 3, 10);
        expect(result.attempts).toBeCloseTo(
            result.visitCounts.reduce((total, visits) => total + visits, 0),
            10
        );
        expect(result.visitCounts[0]).toBeGreaterThan(0);
    });

    test('keeps the level-zero result equal to the sum of all transient visits', () => {
        const result = calculateEnhancement({
            ...BASE_PARAMS,
            startLevel: 0,
            targetLevel: 6,
            protectFrom: 2,
        });

        expect(result.attempts).toBeCloseTo(
            result.visitCounts.reduce((total, visits) => total + visits, 0),
            10
        );
    });

    test('supports the maximum +20 target without writing outside the Markov matrix', () => {
        const result = calculateEnhancement({
            ...BASE_PARAMS,
            startLevel: 0,
            targetLevel: 20,
            protectFrom: 10,
        });

        expect(Number.isFinite(result.attempts)).toBe(true);
        expect(result.visitCounts).toHaveLength(20);
        expect(result.attempts).toBeGreaterThan(0);
    });

    test('merges Blessed Tea jump branches into the +20 absorbing target', () => {
        const result = calculateEnhancement({
            ...BASE_PARAMS,
            startLevel: 19,
            targetLevel: 20,
            protectFrom: 19,
            blessedTea: true,
            guzzlingBonus: 2,
        });

        expect(Number.isFinite(result.attempts)).toBe(true);
        expect(result.attempts).toBeGreaterThan(0);
    });

    test('rejects an invalid starting level instead of indexing outside the fundamental matrix', () => {
        expect(() =>
            calculateEnhancement({
                ...BASE_PARAMS,
                startLevel: 5,
                targetLevel: 5,
                protectFrom: 0,
            })
        ).toThrow(/Start level/);
    });
});

describe('calculateEnhancement when math.js failed to load (e.g. blocked cdnjs.cloudflare.com @require)', () => {
    afterEach(() => {
        globalThis.math = mathJs;
    });

    test('isMathJsAvailable reflects the missing global', () => {
        delete globalThis.math;
        expect(isMathJsAvailable()).toBe(false);
    });

    test('calculateEnhancement throws a distinctly-tagged error instead of a raw "math is not defined" ReferenceError', () => {
        delete globalThis.math;

        expect(() =>
            calculateEnhancement({
                ...BASE_PARAMS,
                startLevel: 0,
                targetLevel: 5,
                protectFrom: 0,
            })
        ).toThrow('math.js is not loaded');
    });
});

describe('calculateSingleLevelSuccessChance - no math.js dependency, used for Enhancing Luck', () => {
    test('matches the base rate exactly with no bonuses and no level advantage', () => {
        // Level 0 (+0->+1): base rate 50%. enhancingLevel === itemLevel, toolBonus 0 -> multiplier 1.
        const chance = calculateSingleLevelSuccessChance(0, 10, 0, 10);
        expect(chance).toBeCloseTo(0.5, 10);
    });

    test('a tool success bonus scales the base rate up', () => {
        // 45% base (+2) * 1.20 (20% tool bonus) = 54%
        const chance = calculateSingleLevelSuccessChance(1, 10, 20, 10);
        expect(chance).toBeCloseTo(0.54, 10);
    });

    test('being below the item level applies the deficit penalty', () => {
        const atLevel = calculateSingleLevelSuccessChance(0, 10, 0, 10);
        const belowLevel = calculateSingleLevelSuccessChance(0, 5, 0, 10);
        expect(belowLevel).toBeLessThan(atLevel);
    });

    test('is clamped to [0, 1] even with an extreme penalty or bonus', () => {
        const veryLow = calculateSingleLevelSuccessChance(0, 1, 0, 1000);
        expect(veryLow).toBeGreaterThanOrEqual(0);

        const veryHigh = calculateSingleLevelSuccessChance(0, 10000, 500, 1);
        expect(veryHigh).toBeLessThanOrEqual(1);
    });

    test('returns null for a level with no base rate (out of the modeled +1..+20 range)', () => {
        expect(calculateSingleLevelSuccessChance(20, 10, 0, 10)).toBeNull();
        expect(calculateSingleLevelSuccessChance(-1, 10, 0, 10)).toBeNull();
    });
});
