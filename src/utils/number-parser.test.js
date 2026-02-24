import { parseItemCount } from './number-parser.js';

describe('parseItemCount', () => {
    describe('plain numbers', () => {
        test('parses simple integer', () => expect(parseItemCount('100')).toBe(100));
        test('parses large integer', () => expect(parseItemCount('1000000')).toBe(1000000));
    });

    describe('K/M/B suffixes', () => {
        test('parses K suffix', () => expect(parseItemCount('1.5K')).toBe(1500));
        test('parses M suffix', () => expect(parseItemCount('2M')).toBe(2000000));
        test('parses B suffix', () => expect(parseItemCount('1.2B')).toBe(1200000000));
        test('parses lowercase k', () => expect(parseItemCount('1.5k')).toBe(1500));
    });

    describe('comma as thousands separator', () => {
        test('1,000 → 1000', () => expect(parseItemCount('1,000')).toBe(1000));
        test('1,234,567 → 1234567', () => expect(parseItemCount('1,234,567')).toBe(1234567));
    });

    describe('comma as decimal separator', () => {
        test('1,5 → 1.5', () => expect(parseItemCount('1,5')).toBe(1.5));
        test('12,5 → 12.5', () => expect(parseItemCount('12,5')).toBe(12.5));
    });

    describe('period as thousands separator', () => {
        test('1.000 → 1000', () => expect(parseItemCount('1.000')).toBe(1000));
        test('1.234.567 → 1234567', () => expect(parseItemCount('1.234.567')).toBe(1234567));
    });

    describe('period as decimal separator', () => {
        test('1.5 → 1.5', () => expect(parseItemCount('1.5')).toBe(1.5));
        test('12.5 → 12.5', () => expect(parseItemCount('12.5')).toBe(12.5));
    });

    describe('space as thousands separator', () => {
        test('1 000 → 1000', () => expect(parseItemCount('1 000')).toBe(1000));
        test('1 234 567 → 1234567', () => expect(parseItemCount('1 234 567')).toBe(1234567));
    });

    describe('mixed separators (European format)', () => {
        test('1.234,56 → 1234.56', () => expect(parseItemCount('1.234,56')).toBe(1234.56));
        test('1.234.567,89 → 1234567.89', () => expect(parseItemCount('1.234.567,89')).toBe(1234567.89));
    });

    describe('mixed separators (US format)', () => {
        test('1,234.56 → 1234.56', () => expect(parseItemCount('1,234.56')).toBe(1234.56));
        test('1,234,567.89 → 1234567.89', () => expect(parseItemCount('1,234,567.89')).toBe(1234567.89));
    });

    describe('prefixed formats', () => {
        test('x5 → 5', () => expect(parseItemCount('x5')).toBe(5));
        test('x1,000 → 1000', () => expect(parseItemCount('x1,000')).toBe(1000));
    });

    describe('default value', () => {
        test('returns default on empty string', () => expect(parseItemCount('', 0)).toBe(0));
        test('returns default on null', () => expect(parseItemCount(null, 0)).toBe(0));
        test('returns default on unparseable', () => expect(parseItemCount('abc', 0)).toBe(0));
    });
});
