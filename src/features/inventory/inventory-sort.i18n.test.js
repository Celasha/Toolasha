/**
 * Chinese-locale regression tests for inventory-sort category-name helpers.
 *
 * BUG #12: Equipment/Loots category detection used hardcoded English literals.
 * The fix dual-matches both English and translated labels via Set.has.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    getItemCategoryName: vi.fn((_hrid, fallback) => {
        if (_hrid === '/item_categories/equipment') return '装备';
        if (_hrid === '/item_categories/loots') return '掉落物';
        return fallback;
    }),
}));

const { isEquipmentCategoryName, isLootsCategoryName } = await import('./inventory-sort.js');

describe('isEquipmentCategoryName — zh client dual-match (BUG #12)', () => {
    test('matches English "Equipment"', () => {
        expect(isEquipmentCategoryName('Equipment')).toBe(true);
    });

    test('matches Chinese "装备"', () => {
        expect(isEquipmentCategoryName('装备')).toBe(true);
    });

    test('rejects non-Equipment labels', () => {
        expect(isEquipmentCategoryName('Loots')).toBe(false);
        expect(isEquipmentCategoryName('掉落物')).toBe(false);
    });
});

describe('isLootsCategoryName — zh client dual-match (BUG #12)', () => {
    test('matches English "Loots"', () => {
        expect(isLootsCategoryName('Loots')).toBe(true);
    });

    test('matches Chinese "掉落物"', () => {
        expect(isLootsCategoryName('掉落物')).toBe(true);
    });

    test('rejects non-Loots labels', () => {
        expect(isLootsCategoryName('Equipment')).toBe(false);
        expect(isLootsCategoryName('装备')).toBe(false);
    });
});
