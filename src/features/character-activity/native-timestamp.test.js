import { describe, expect, test } from 'vitest';
import { normalizeNativeTimestamp } from './native-timestamp.js';

describe('normalizeNativeTimestamp', () => {
    test('a finite epoch-ms number passes through unchanged', () => {
        expect(normalizeNativeTimestamp(1700000000000)).toBe(1700000000000);
        expect(normalizeNativeTimestamp(0)).toBe(0);
        expect(normalizeNativeTimestamp(-500)).toBe(-500);
    });

    test('a valid Date object normalizes to its finite epoch ms', () => {
        const date = new Date('2026-01-15T12:00:00.000Z');
        expect(normalizeNativeTimestamp(date)).toBe(date.getTime());
    });

    test('a valid ISO date string normalizes to a finite epoch ms', () => {
        const result = normalizeNativeTimestamp('2026-01-15T12:00:00.000Z');
        expect(result).toBe(new Date('2026-01-15T12:00:00.000Z').getTime());
    });

    test('a valid native (non-ISO) date string normalizes to a finite epoch ms', () => {
        const result = normalizeNativeTimestamp('Thu Jan 15 2026 12:00:00 GMT+0000');
        expect(Number.isFinite(result)).toBe(true);
    });

    test('null/undefined normalize to null', () => {
        expect(normalizeNativeTimestamp(null)).toBeNull();
        expect(normalizeNativeTimestamp(undefined)).toBeNull();
    });

    test('empty/whitespace-only string normalizes to null', () => {
        expect(normalizeNativeTimestamp('')).toBeNull();
        expect(normalizeNativeTimestamp('   ')).toBeNull();
    });

    test('an invalid date string normalizes to null', () => {
        expect(normalizeNativeTimestamp('not-a-date')).toBeNull();
        expect(normalizeNativeTimestamp('2026-99-99')).toBeNull();
    });

    test('a Date object constructed from an invalid string normalizes to null', () => {
        expect(normalizeNativeTimestamp(new Date('not-a-date'))).toBeNull();
    });

    test('NaN/Infinity/-Infinity normalize to null', () => {
        expect(normalizeNativeTimestamp(NaN)).toBeNull();
        expect(normalizeNativeTimestamp(Infinity)).toBeNull();
        expect(normalizeNativeTimestamp(-Infinity)).toBeNull();
    });

    test('unsupported types normalize to null', () => {
        expect(normalizeNativeTimestamp(true)).toBeNull();
        expect(normalizeNativeTimestamp(false)).toBeNull();
        expect(normalizeNativeTimestamp({})).toBeNull();
        expect(normalizeNativeTimestamp([])).toBeNull();
        expect(normalizeNativeTimestamp(() => {})).toBeNull();
    });

    test('never uses implicit numeric coercion (a numeric string is parsed as a date, not as Number())', () => {
        // "1000" parses via `new Date(...)` as the year 1000, proving this never takes the
        // `+value`/`Number(value)` shortcut, which would silently produce the epoch-ms number 1000.
        const result = normalizeNativeTimestamp('1000');
        expect(result).not.toBe(1000);
        expect(result).toBe(new Date('1000').getTime());
    });
});
