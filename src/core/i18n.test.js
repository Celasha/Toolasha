/* @vitest-environment jsdom */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../locales/en.js', () => ({
    default: {
        greeting: 'Hello',
        withPlaceholder: 'Hello, {{name}}!',
        pluralized: (params) => `${params.count} item${params.count !== 1 ? 's' : ''}`,
        enOnly: 'Only in English',
    },
}));

vi.mock('../locales/zh.js', () => ({
    default: {
        greeting: '你好',
        withPlaceholder: '你好，{{name}}！',
        pluralized: (params) => `${params.count} 个物品`,
    },
}));

const { default: i18n, t } = await import('./i18n.js');

describe('i18n — getLocale', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('defaults to en when i18nextLng is unset', () => {
        expect(i18n.getLocale()).toBe('en');
    });

    test('maps a bare "zh" to zh', () => {
        window.localStorage.setItem('i18nextLng', 'zh');
        expect(i18n.getLocale()).toBe('zh');
    });

    test('maps zh-TW (Traditional) to zh, since Toolasha only has Simplified strings so far', () => {
        window.localStorage.setItem('i18nextLng', 'zh-TW');
        expect(i18n.getLocale()).toBe('zh');
    });

    test('maps an unsupported language (e.g. French) to the en default', () => {
        window.localStorage.setItem('i18nextLng', 'fr');
        expect(i18n.getLocale()).toBe('en');
    });

    test('is case-insensitive', () => {
        window.localStorage.setItem('i18nextLng', 'ZH');
        expect(i18n.getLocale()).toBe('zh');
    });
});

describe('i18n — t()', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('returns the English string when locale is en', () => {
        expect(t('greeting')).toBe('Hello');
    });

    test('returns the Chinese string when locale is zh', () => {
        window.localStorage.setItem('i18nextLng', 'zh');
        expect(t('greeting')).toBe('你好');
    });

    test('falls back to English when a key is missing from zh', () => {
        window.localStorage.setItem('i18nextLng', 'zh');
        expect(t('enOnly')).toBe('Only in English');
    });

    test('falls back to the raw key when missing from both locales', () => {
        expect(t('totally.missing.key')).toBe('totally.missing.key');
    });

    test('interpolates {{name}}-style placeholders', () => {
        expect(t('withPlaceholder', { name: 'Celasha' })).toBe('Hello, Celasha!');
    });

    test('interpolates placeholders in the Chinese template too', () => {
        window.localStorage.setItem('i18nextLng', 'zh');
        expect(t('withPlaceholder', { name: 'Celasha' })).toBe('你好，Celasha！');
    });

    test('leaves an unmatched placeholder token untouched', () => {
        expect(t('withPlaceholder', {})).toBe('Hello, {{name}}!');
    });

    test('calls a function-valued template with params, for pluralization', () => {
        expect(t('pluralized', { count: 1 })).toBe('1 item');
        expect(t('pluralized', { count: 3 })).toBe('3 items');
    });

    test('function-valued templates work in zh too, without needing to pluralize', () => {
        window.localStorage.setItem('i18nextLng', 'zh');
        expect(t('pluralized', { count: 3 })).toBe('3 个物品');
    });
});
