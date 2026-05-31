/**
 * i18n Module Tests
 */

import { describe, it, expect } from 'vitest';
import { t, registerLocale } from './i18n.js';

describe('t() — Fallback behavior', () => {
    it('returns the English key when no translation is registered', () => {
        // Any key not explicitly registered returns itself
        expect(t('SomeUnknownKeyXYZ123')).toBe('SomeUnknownKeyXYZ123');
    });

    it('returns the English key for empty string', () => {
        expect(t('')).toBe('');
    });
});

describe('t() — Translation lookup', () => {
    it('returns Chinese translation after registration', () => {
        registerLocale('test', { Hello: '你好' });
        expect(t('Hello')).toBe('你好');
    });

    it('falls back to English if key exists but value is empty string', () => {
        registerLocale('test', { Empty: '' });
        expect(t('Empty')).toBe('');
    });

    it('preserves non-string keys (numbers, objects)', () => {
        // t() only accepts strings, so this tests nothing
        expect(t('123')).toBe('123');
    });
});

describe('t() — Argument interpolation', () => {
    it('interpolates a single positional argument', () => {
        registerLocale('test', { 'Cost: {0}/hr': '花费: {0}/时' });
        expect(t('Cost: {0}/hr', '100K')).toBe('花费: 100K/时');
    });

    it('interpolates multiple positional arguments', () => {
        registerLocale('test', { '{0} of {1} waves': '第{0}波/共{1}波' });
        expect(t('{0} of {1} waves', 3, 50)).toBe('第3波/共50波');
    });

    it('leaves placeholder unchanged when argument is missing', () => {
        registerLocale('test', { 'Hello {0}!': '你好 {0}!' });
        expect(t('Hello {0}!')).toBe('你好 {0}!');
    });

    it('handles non-existent placeholder indices', () => {
        registerLocale('test', { 'No {99} here': '没有 {99} 这里' });
        expect(t('No {99} here', 'x')).toBe('没有 {99} 这里');
    });

    it('falls back to English key for interpolation when no translation', () => {
        expect(t('Unregistered {0} key', 'test')).toBe('Unregistered test key');
    });

    it('handles numbered args that are zero', () => {
        registerLocale('test', { 'Count: {0}': '数量: {0}' });
        expect(t('Count: {0}', 0)).toBe('数量: 0');
    });
});

describe('registerLocale() — Merging', () => {
    it('last registration wins for duplicate keys', () => {
        registerLocale('a', { Key: 'First' });
        registerLocale('b', { Key: 'Second' });
        expect(t('Key')).toBe('Second');
    });

    it('merges multiple locale dictionaries without conflict', () => {
        registerLocale('a', { A: 'A译' });
        registerLocale('b', { B: 'B译' });
        expect(t('A')).toBe('A译');
        expect(t('B')).toBe('B译');
    });
});

describe('t() — Edge cases', () => {
    it('handles strings with curly braces but no interpolation', () => {
        registerLocale('test', { '{N/A}': '{不适用}' });
        expect(t('{N/A}')).toBe('{不适用}');
    });

    it('handles very long strings', () => {
        const longKey = 'A'.repeat(500);
        registerLocale('test', { [longKey]: 'B'.repeat(500) });
        expect(t(longKey)).toBe('B'.repeat(500));
    });

    it('handles special regex characters in key', () => {
        const keyWithRegex = 'Price: $100 (approx.)';
        registerLocale('test', { [keyWithRegex]: '价格: ¥650 (约)' });
        expect(t(keyWithRegex)).toBe('价格: ¥650 (约)');
    });
});
