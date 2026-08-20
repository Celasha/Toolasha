import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({
    default: {
        characterData: null,
        on: vi.fn(),
        off: vi.fn(),
        getInitClientData: vi.fn(() => null),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/storage.js', () => ({
    default: { get: vi.fn(() => ({})), set: vi.fn() },
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

import {
    calcTimeToLevel,
    calcNextMemberSlotLevel,
    calcXPRemainingForLevel,
    calcStableRate,
    resolveStableRate,
    calcNextMemberSlotETA,
} from './guild-xp-tracker.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('calcTimeToLevel - exact-threshold boundary', () => {
    test('does not return null when currentXP lands exactly on a level threshold', () => {
        // 76 is a real threshold in LEVEL_EXPERIENCE_TABLE (level 3 in the native table).
        // Landing exactly on it means "just reached this level" - there must still be a
        // well-defined ETA to the level after it, not a bogus null.
        const result = calcTimeToLevel(76, 100);
        expect(result).not.toBeNull();
        // Next threshold after 76 is 132: (132-76)/100 * 3600000
        expect(result).toBeCloseTo(((132 - 76) / 100) * 3600000, 0);
    });

    test('still returns the correct ETA for an ordinary in-between XP value', () => {
        const result = calcTimeToLevel(100, 100);
        expect(result).toBeCloseTo(((132 - 100) / 100) * 3600000, 0);
    });

    test('returns null when the rate is zero or negative', () => {
        expect(calcTimeToLevel(100, 0)).toBeNull();
        expect(calcTimeToLevel(100, -5)).toBeNull();
    });
});

describe('calcNextMemberSlotLevel', () => {
    test.each([
        [1, 3],
        [2, 3],
        [3, 6],
        [4, 6],
        [44, 45],
        [45, 48],
        [46, 48],
        [47, 48],
        [48, 51],
    ])('guild level %i targets level %i', (level, expected) => {
        expect(calcNextMemberSlotLevel(level)).toBe(expected);
    });
});

describe('calcXPRemainingForLevel', () => {
    const table = [0, 0, 33, 76, 132, 202];

    test('returns native-table XP remaining for a target level', () => {
        expect(calcXPRemainingForLevel(10, 3, table)).toBe(76 - 10);
    });

    test('exact current-XP-at-threshold does not return a negative or incorrect value', () => {
        expect(calcXPRemainingForLevel(76, 3, table)).toBe(0);
    });

    test('clamps to 0 rather than negative when currentXP already exceeds targetXP', () => {
        expect(calcXPRemainingForLevel(500, 3, table)).toBe(0);
    });

    test('returns null when the table has no entry for targetLevel (index out of range)', () => {
        expect(calcXPRemainingForLevel(10, 999, table)).toBeNull();
    });

    test('returns null when no table is supplied', () => {
        expect(calcXPRemainingForLevel(10, 3, undefined)).toBeNull();
    });
});

describe('calcStableRate', () => {
    test('is null with fewer than 2 points in the window', () => {
        expect(calcStableRate([{ t: Date.now(), xp: 100 }], DAY)).toBeNull();
    });

    test('is null when the two points span too little of the window (noisy sample)', () => {
        const now = Date.now();
        const arr = [
            { t: now - 2 * 60 * 1000, xp: 100 },
            { t: now, xp: 200 },
        ];
        // 2 minutes span inside a 24h window is far short of the 25% (6h) requirement.
        expect(calcStableRate(arr, DAY)).toBeNull();
    });

    test('computes a real rate when the span covers a meaningful fraction of the window', () => {
        const now = Date.now();
        const arr = [
            { t: now - 20 * HOUR, xp: 0 },
            { t: now, xp: 1000 },
        ];
        expect(calcStableRate(arr, DAY)).toBeCloseTo(50, 0); // 1000 xp / 20h = 50 xp/h
    });
});

describe('resolveStableRate', () => {
    test('prefers a stable 24h rate over a stable 1h rate', () => {
        const now = Date.now();
        const arr = [
            { t: now - 20 * HOUR, xp: 0 },
            { t: now - 40 * 60 * 1000, xp: 1000 },
            { t: now, xp: 1100 },
        ];
        const result = resolveStableRate(arr);
        expect(result.basis).toBe('24h');
    });

    test('falls back to a stable 1h rate when the 24h window is not stable', () => {
        const now = Date.now();
        const arr = [
            { t: now - 40 * 60 * 1000, xp: 0 },
            { t: now, xp: 100 },
        ];
        const result = resolveStableRate(arr);
        expect(result.basis).toBe('1h');
    });

    test('is null when neither window has a stable sample (collecting data)', () => {
        const now = Date.now();
        const arr = [
            { t: now - 2 * 60 * 1000, xp: 0 },
            { t: now, xp: 10 },
        ];
        expect(resolveStableRate(arr)).toBeNull();
    });

    test('a stable rate of exactly zero is still resolved (not treated as unstable)', () => {
        const now = Date.now();
        const arr = [
            { t: now - 20 * HOUR, xp: 500 },
            { t: now, xp: 500 },
        ];
        const result = resolveStableRate(arr);
        expect(result).not.toBeNull();
        expect(result.rate).toBe(0);
        expect(result.basis).toBe('24h');
    });
});

describe('calcNextMemberSlotETA', () => {
    const table = [0, 0, 33, 76, 132, 202, 286, 386, 503, 637, 791, 964, 1159, 1377, 1620, 1891];

    test('returns an ok ETA when a stable rate exists', () => {
        const now = Date.now();
        const history = [
            { t: now - 20 * HOUR, xp: 10 },
            { t: now, xp: 50 },
        ];
        const result = calcNextMemberSlotETA(2, 50, history, table);
        expect(result.status).toBe('ok');
        expect(result.targetLevel).toBe(3);
        expect(result.xpRemaining).toBe(table[3] - 50);
        expect(result.rateBasis).toBe('24h');
        expect(result.etaMs).toBeGreaterThan(0);
    });

    test('returns collecting-data status when no stable sample exists yet', () => {
        const now = Date.now();
        const history = [{ t: now - 60 * 1000, xp: 10 }];
        const result = calcNextMemberSlotETA(2, 10, history, table);
        expect(result.status).toBe('collecting-data');
        expect(result.targetLevel).toBe(3);
        expect(result).not.toHaveProperty('etaMs');
    });

    test('returns zero-rate status instead of a fake infinite ETA when the stable rate is 0', () => {
        const now = Date.now();
        const history = [
            { t: now - 20 * HOUR, xp: 10 },
            { t: now, xp: 10 },
        ];
        const result = calcNextMemberSlotETA(2, 10, history, table);
        expect(result.status).toBe('zero-rate');
        expect(result).not.toHaveProperty('etaMs');
    });

    test('a guild level already on a slot boundary targets the next boundary, not itself', () => {
        const result = calcNextMemberSlotETA(3, 0, [], table);
        expect(result.targetLevel).toBe(6);
    });

    test('Guild Hall / building levels play no role - only guild level feeds the target', () => {
        // No building-level parameter exists on this function at all; this is a documentation
        // test that the signature never grows one accidentally.
        expect(calcNextMemberSlotETA.length).toBe(4);
    });

    test('returns null when the level table has no entry for the target level', () => {
        const result = calcNextMemberSlotETA(2, 10, [], [0, 0, 33]);
        expect(result).toBeNull();
    });

    test('returns null when guildLevel is not a number', () => {
        expect(calcNextMemberSlotETA(null, 10, [], table)).toBeNull();
    });
});
