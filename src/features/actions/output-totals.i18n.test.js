/**
 * Chinese-locale regression tests for output-totals essence detection.
 *
 * BUG #21: the essence-drop detection used a hardcoded English literal
 * ("essence"). The fix dual-matches both English and translated labels.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    getItemCategoryName: vi.fn((_hrid, fallback) => {
        if (_hrid === '/item_categories/essences') return '精华';
        return fallback;
    }),
}));

const { getEssenceLabels, textIncludesEssence } = await import('./output-totals.js');

describe('getEssenceLabels — zh client dual-match (BUG #21)', () => {
    test('returns array containing both English and Chinese labels', () => {
        const labels = getEssenceLabels();
        expect(labels).toContain('essence');
        expect(labels).toContain('精华');
    });
});

describe('textIncludesEssence — zh client dual-match (BUG #21)', () => {
    test('matches English "essence" substring (case-insensitive)', () => {
        expect(textIncludesEssence('1.5 - 3.9 Essence')).toBe(true);
        expect(textIncludesEssence('some essence drops')).toBe(true);
    });

    test('matches Chinese "精华" substring', () => {
        expect(textIncludesEssence('1.5 - 3.9 精华')).toBe(true);
        expect(textIncludesEssence('掉落：精华')).toBe(true);
    });

    test('returns false for non-essence text', () => {
        expect(textIncludesEssence('1.5 - 3.9 Flax')).toBe(false);
        expect(textIncludesEssence('普通物品')).toBe(false);
    });

    test('returns false for empty/falsy input', () => {
        expect(textIncludesEssence('')).toBe(false);
        expect(textIncludesEssence(null)).toBe(false);
        expect(textIncludesEssence(undefined)).toBe(false);
    });
});
