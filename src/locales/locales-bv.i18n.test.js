/**
 * Locale alignment tests for the `bv` (Battle Verifier) namespace.
 *
 * Guards the bilingual guarantee: every en key has a zh counterpart and vice versa, and
 * interpolation placeholders ({{name}}) match between locales so a translation can never
 * drop or rename a parameter at runtime.
 */
import { describe, test, expect } from 'vitest';
import en from './en.js';
import zh from './zh.js';

/**
 * Recursively collect leaf-key paths of a namespace table.
 * @param {Object} node
 * @param {string} [prefix]
 * @returns {string[]}
 */
function leafKeys(node, prefix = '') {
    return Object.entries(node).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') {
            return leafKeys(value, path);
        }
        return [path];
    });
}

/**
 * Extract {{placeholder}} names from a template string.
 * @param {string} text
 * @returns {string[]}
 */
function placeholders(text) {
    return [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

const enBv = en.bv;
const zhBv = zh.bv;
const enKeys = leafKeys(enBv).sort();
const zhKeys = leafKeys(zhBv).sort();

describe('bv locale alignment', () => {
    test('en and zh define the same key set', () => {
        expect(zhKeys).toEqual(enKeys);
    });

    test('every key is a non-empty string in both locales', () => {
        for (const key of enKeys) {
            const enValue = key.split('.').reduce((node, part) => node[part], enBv);
            const zhValue = key.split('.').reduce((node, part) => node[part], zhBv);
            expect(enValue, `en:${key}`).toBeTypeOf('string');
            expect(enValue.length, `en:${key}`).toBeGreaterThan(0);
            expect(zhValue, `zh:${key}`).toBeTypeOf('string');
            expect(zhValue.length, `zh:${key}`).toBeGreaterThan(0);
        }
    });

    test('placeholders match between locales for every key', () => {
        for (const key of enKeys) {
            const enValue = key.split('.').reduce((node, part) => node[part], enBv);
            const zhValue = key.split('.').reduce((node, part) => node[part], zhBv);
            expect(placeholders(zhValue), `zh:${key}`).toEqual(placeholders(enValue));
        }
    });

    test('core entry keys exist', () => {
        for (const key of ['btnTitle', 'loaded', 'g1Done', 'g2Done', 'allDone', 'step.idle.title', 'duration.zero']) {
            expect(enKeys, `en:${key}`).toContain(key);
            expect(zhKeys, `zh:${key}`).toContain(key);
        }
    });
});
