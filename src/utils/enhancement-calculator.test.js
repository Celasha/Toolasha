import { beforeAll, describe, expect, test } from 'vitest';
import * as mathJs from 'mathjs';

import { calculateEnhancement } from './enhancement-calculator.js';

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
