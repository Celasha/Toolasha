/**
 * Chinese-locale regression tests for character-sheet locale-aware helpers.
 *
 * BUG #13: the character share-modal parser used English literals to find
 * the Combat Level row, house room names, and achievement tier names.
 * The fix dual-matches both English and translated labels.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((_ns, _key, fallback) => {
        if (_ns === 'sharableProfile' && _key === 'combatLevel') return '战斗等级';
        if (_ns === 'achievementTierNames') {
            const tier = _key.split('/').pop();
            const zh = {
                beginner: '新手',
                novice: '初学者',
                adept: '熟手',
                veteran: '老手',
                elite: '精英',
                champion: '冠军',
            };
            return zh[tier] || fallback;
        }
        return fallback;
    }),
    getHouseRoomName: vi.fn((_hrid, fallback) => {
        const zh = {
            '/house_rooms/dining_room': '餐厅',
            '/house_rooms/library': '图书馆',
            '/house_rooms/dojo': '道场',
            '/house_rooms/armory': '军械库',
            '/house_rooms/gym': '健身房',
            '/house_rooms/archery_range': '射箭场',
            '/house_rooms/mystical_study': '神秘书房',
        };
        return zh[_hrid] || fallback;
    }),
}));

const { getCombatLevelLabels, getHousingKeyByName, getAchTierNameToOrder } = await import('./character-sheet.js');

describe('getCombatLevelLabels — zh client dual-match (BUG #13)', () => {
    test('Set contains both English and Chinese labels (lowercased)', () => {
        const labels = getCombatLevelLabels();
        expect(labels.has('combat level')).toBe(true);
        expect(labels.has('战斗等级')).toBe(true);
    });

    test('Set is cached across calls', () => {
        const a = getCombatLevelLabels();
        const b = getCombatLevelLabels();
        expect(a).toBe(b);
    });
});

describe('getHousingKeyByName — zh client dual-match (BUG #13)', () => {
    test('maps English "Dining Room" to "dining_room" key', () => {
        const map = getHousingKeyByName();
        expect(map.get('Dining Room')).toBe('dining_room');
    });

    test('maps Chinese "餐厅" to "dining_room" key', () => {
        const map = getHousingKeyByName();
        expect(map.get('餐厅')).toBe('dining_room');
    });

    test('maps Chinese "图书馆" to "library" key', () => {
        const map = getHousingKeyByName();
        expect(map.get('图书馆')).toBe('library');
    });

    test('returns undefined for unknown room name', () => {
        const map = getHousingKeyByName();
        expect(map.get('Unknown Room')).toBeUndefined();
    });
});

describe('getAchTierNameToOrder — zh client dual-match (BUG #13)', () => {
    test('maps English "Beginner" to order 0', () => {
        const map = getAchTierNameToOrder();
        expect(map.get('Beginner')).toBe(0);
    });

    test('maps Chinese "新手" to order 0', () => {
        const map = getAchTierNameToOrder();
        expect(map.get('新手')).toBe(0);
    });

    test('maps Chinese "冠军" to last order (5)', () => {
        const map = getAchTierNameToOrder();
        expect(map.get('冠军')).toBe(5);
    });

    test('returns undefined for unknown tier name', () => {
        const map = getAchTierNameToOrder();
        expect(map.get('UnknownTier')).toBeUndefined();
    });
});
