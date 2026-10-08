/**
 * Chinese-locale regression tests for inventory-category-totals.
 *
 * BUG #10: the "Currencies" category skip used a hardcoded English literal.
 * The fix builds a Set of both English and translated labels and uses Set.has.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    getItemCategoryName: vi.fn((_hrid, fallback) => {
        if (_hrid === '/item_categories/currencies') return '货币';
        return fallback;
    }),
}));

const { isCurrenciesLabel } = await import('./inventory-category-totals.js');

describe('isCurrenciesLabel — zh client dual-match (BUG #10)', () => {
    test('matches English "Currencies" label (case-insensitive)', () => {
        expect(isCurrenciesLabel('Currencies')).toBe(true);
        expect(isCurrenciesLabel('currencies')).toBe(true);
    });

    test('matches Chinese "货币" label', () => {
        expect(isCurrenciesLabel('货币')).toBe(true);
    });

    test('returns false for non-Currencies labels', () => {
        expect(isCurrenciesLabel('Equipment')).toBe(false);
        expect(isCurrenciesLabel('装备')).toBe(false);
        expect(isCurrenciesLabel('Loots')).toBe(false);
    });
});
