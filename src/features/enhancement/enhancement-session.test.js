import { describe, expect, test } from 'vitest';
import {
    createSession,
    recordSuccess,
    recordFailure,
    normalizeSession,
    getLevelEnhancingLuck,
    getOverallEnhancingLuck,
} from './enhancement-session.js';

describe('recordSuccess - Blessed tea tracking', () => {
    test('a normal +1 success increments success, not Blessed', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 1, false);

        expect(session.totalSuccesses).toBe(1);
        expect(session.totalBlessed).toBe(0);
        expect(session.attemptsPerLevel[0].success).toBe(1);
        expect(session.attemptsPerLevel[0].blessed).toBe(0);
    });

    test('a +2 success increments both success and Blessed, exactly once', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 2, true);

        expect(session.totalSuccesses).toBe(1);
        expect(session.totalBlessed).toBe(1);
        expect(session.attemptsPerLevel[0].success).toBe(1);
        expect(session.attemptsPerLevel[0].blessed).toBe(1);
    });

    test('Blessed is never counted as an additional success or attempt on top of the success', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 2, true);

        // totalAttempts/totalSuccesses must match a plain success exactly - Blessed only
        // annotates it via a separate counter, never adds a second attempt/success.
        expect(session.totalAttempts).toBe(1);
        expect(session.totalSuccesses).toBe(1);
    });

    test('a failure increments neither Blessed nor success', () => {
        const session = createSession('/items/sword', 'Sword', 1, 5, 0);

        recordFailure(session, 1, 0);

        expect(session.totalSuccesses).toBe(0);
        expect(session.totalBlessed).toBe(0);
        expect(session.totalFailures).toBe(1);
    });

    test('protected failure behavior remains unchanged (level stays same, still counted as a failure)', () => {
        const session = createSession('/items/sword', 'Sword', 3, 5, 1);

        recordFailure(session, 3, 3);

        expect(session.totalFailures).toBe(1);
        expect(session.totalSuccesses).toBe(0);
        expect(session.totalBlessed).toBe(0);
        expect(session.currentLevel).toBe(3);
    });

    test('per-level and total Blessed aggregates stay consistent across multiple levels', () => {
        const session = createSession('/items/sword', 'Sword', 0, 10, 0);

        recordSuccess(session, 0, 1, false);
        recordSuccess(session, 1, 3, true);
        recordSuccess(session, 3, 4, false);
        recordSuccess(session, 4, 6, true);

        expect(session.totalBlessed).toBe(2);
        expect(session.attemptsPerLevel[1].blessed).toBe(1);
        expect(session.attemptsPerLevel[4].blessed).toBe(1);
        expect(session.attemptsPerLevel[0].blessed).toBe(0);
        expect(session.attemptsPerLevel[3].blessed).toBe(0);

        const totalBlessedAcrossLevels = Object.values(session.attemptsPerLevel).reduce(
            (sum, level) => sum + level.blessed,
            0
        );
        expect(totalBlessedAcrossLevels).toBe(session.totalBlessed);
    });
});

describe('normalizeSession - backward compatibility', () => {
    test('an older session with no Blessed field at all loads as zero', () => {
        const legacySession = createSession('/items/sword', 'Sword', 0, 5, 0);
        delete legacySession.totalBlessed;
        legacySession.attemptsPerLevel[0] = { success: 3, fail: 1, successRate: 0.75 };

        normalizeSession(legacySession);

        expect(legacySession.totalBlessed).toBe(0);
        expect(legacySession.attemptsPerLevel[0].blessed).toBe(0);
    });

    test('an existing session with real Blessed data is left untouched', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);
        recordSuccess(session, 0, 2, true);

        normalizeSession(session);

        expect(session.totalBlessed).toBe(1);
        expect(session.attemptsPerLevel[0].blessed).toBe(1);
    });

    test('does not destructively reset any other session field', () => {
        const legacySession = createSession('/items/sword', 'Sword', 0, 5, 0);
        delete legacySession.totalBlessed;
        legacySession.totalSuccesses = 12;
        legacySession.totalXP = 4500;

        normalizeSession(legacySession);

        expect(legacySession.totalSuccesses).toBe(12);
        expect(legacySession.totalXP).toBe(4500);
    });
});

describe('Enhancing Luck: actual vs. expected successes', () => {
    test('a run of successes at exactly the modeled chance produces ~0% luck', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 1, false, 0.5);
        recordFailure(session, 0, 0, 0.5);

        const luck = getLevelEnhancingLuck(session, 0);
        expect(luck.actualSuccesses).toBe(1);
        expect(luck.expectedSuccesses).toBeCloseTo(1, 5);
        expect(luck.luckPercent).toBeCloseTo(0, 5);
    });

    test('more successes than the modeled chance predicted is positive luck', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        // 4 attempts, each modeled at 25% -> expected 1 success. All 4 succeed.
        recordSuccess(session, 0, 1, false, 0.25);
        recordSuccess(session, 0, 1, false, 0.25);
        recordSuccess(session, 0, 1, false, 0.25);
        recordSuccess(session, 0, 1, false, 0.25);

        const luck = getLevelEnhancingLuck(session, 0);
        expect(luck.actualSuccesses).toBe(4);
        expect(luck.expectedSuccesses).toBeCloseTo(1, 5);
        expect(luck.luckPercent).toBeCloseTo(300, 5); // 4x expected = +300%
    });

    test('fewer successes than modeled is negative luck', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordFailure(session, 0, 0, 0.5);
        recordFailure(session, 0, 0, 0.5);

        const luck = getLevelEnhancingLuck(session, 0);
        expect(luck.actualSuccesses).toBe(0);
        expect(luck.expectedSuccesses).toBeCloseTo(1, 5);
        expect(luck.luckPercent).toBeCloseTo(-100, 5);
    });

    test('an attempt with no expectedChance (null) still counts toward success/fail totals but not luck', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 1, false, null);

        expect(session.attemptsPerLevel[0].success).toBe(1);
        expect(getLevelEnhancingLuck(session, 0)).toBeNull();
    });

    test('a level with zero recorded expected chance returns null rather than dividing by zero', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);
        expect(getLevelEnhancingLuck(session, 0)).toBeNull();
    });

    test('overall luck aggregates across levels the same way as per-level luck', () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);

        recordSuccess(session, 0, 1, false, 0.5);
        recordSuccess(session, 1, 2, false, 0.4);
        recordFailure(session, 2, 1, 0.4);

        const luck = getOverallEnhancingLuck(session);
        expect(luck.actualSuccesses).toBe(2);
        expect(luck.expectedSuccesses).toBeCloseTo(1.3, 5);
        expect(luck.luckPercent).toBeCloseTo((2 / 1.3 - 1) * 100, 5);
    });

    test('normalizeSession backfills expectedSuccessSum for legacy sessions/levels missing it', () => {
        const legacySession = createSession('/items/sword', 'Sword', 0, 5, 0);
        delete legacySession.totalExpectedSuccesses;
        legacySession.attemptsPerLevel[0] = { success: 3, fail: 1, successRate: 0.75 };

        normalizeSession(legacySession);

        expect(legacySession.totalExpectedSuccesses).toBe(0);
        expect(legacySession.attemptsPerLevel[0].expectedSuccessSum).toBe(0);
        // Legacy data with no expected chance recorded must not report a misleading luck value.
        expect(getLevelEnhancingLuck(legacySession, 0)).toBeNull();
    });
});
