import { describe, test, expect } from 'vitest';
import { parseChatTimestamp } from './chat-timestamp.js';

describe('parseChatTimestamp', () => {
    test('returns null when the text has no bracketed timestamp', () => {
        expect(parseChatTimestamp('no timestamp here')).toBeNull();
    });

    test('resolves an ambiguous hyphen date (both parts <=12) toward the reference date, not a hard-coded order', () => {
        // The exact reported bug: "[10-11 12:05:07 AM]" following a reference of Oct 10
        // 11:48:26 PM must resolve to Oct 11 (~17 minutes later), not Nov 10 (~30 days later).
        const reference = new Date(2026, 9, 10, 23, 48, 26); // Oct 10, 2026, 11:48:26 PM
        const result = parseChatTimestamp('[10-11 12:05:07 AM]', reference);

        expect(result.getMonth()).toBe(9); // October (0-indexed)
        expect(result.getDate()).toBe(11);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(5);
        expect(result.getSeconds()).toBe(7);
    });

    test('resolves an identical-digits hyphen date unambiguously', () => {
        const reference = new Date(2026, 9, 10, 12, 0, 0);
        const result = parseChatTimestamp('[10-10 7:34:50 PM]', reference);

        expect(result.getMonth()).toBe(9);
        expect(result.getDate()).toBe(10);
        expect(result.getHours()).toBe(19);
        expect(result.getMinutes()).toBe(34);
        expect(result.getSeconds()).toBe(50);
    });

    test('forces day-month order when the first part exceeds 12 (slash separator)', () => {
        const reference = new Date(2026, 6, 1); // July 2026
        const result = parseChatTimestamp('[16/07 09:00:00]', reference);

        expect(result.getMonth()).toBe(6); // July
        expect(result.getDate()).toBe(16);
    });

    test('forces month-day order when the second part exceeds 12 (hyphen separator)', () => {
        const reference = new Date(2026, 6, 1); // July 2026
        const result = parseChatTimestamp('[7-16 09:00:00]', reference);

        expect(result.getMonth()).toBe(6); // July
        expect(result.getDate()).toBe(16);
    });

    test('parses the European dot format with a trailing dot after the month', () => {
        const reference = new Date(2026, 9, 11, 10, 0, 0);
        const result = parseChatTimestamp('[11.10. 09:15:30]', reference);

        expect(result.getMonth()).toBe(9); // October
        expect(result.getDate()).toBe(11);
        expect(result.getHours()).toBe(9);
        expect(result.getMinutes()).toBe(15);
        expect(result.getSeconds()).toBe(30);
    });

    test('picks the neighboring year when that reading lands closer to the reference (Dec/Jan boundary)', () => {
        const reference = new Date(2027, 0, 1, 0, 10, 0); // Jan 1, 2027, 00:10:00
        const result = parseChatTimestamp('[12-31 11:55:00 PM]', reference);

        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(11); // December
        expect(result.getDate()).toBe(31);
    });

    test('defaults the reference date to now when not provided', () => {
        const result = parseChatTimestamp('[10-10 7:34:50 PM]');
        expect(result).toBeInstanceOf(Date);
    });
});
