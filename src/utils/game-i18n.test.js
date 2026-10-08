import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the i18n instance
const mockT = vi.fn((key) => {
    const map = {
        'itemNames./items/test_item': '测试物品',
        'actionNames./actions/test_action': '测试动作',
        'equipmentTypeNames./equipment_types/main_hand': '主手',
        'equipmentTypeNames./equipment_types/milking_tool': '挤奶工具',
    };
    return map[key] ?? key;
});

// Mock document.getElementById and the fiber tree
vi.stubGlobal('document', {
    getElementById: vi.fn(() => ({
        _reactRootContainer: {
            current: {
                memoizedProps: { i18n: { t: mockT } },
                sibling: null,
                child: null,
            },
        },
    })),
});

// We need to import after mocking
let translateGameName, getItemName, getActionName, getItemLocationName;

describe('game-i18n', () => {
    beforeEach(async () => {
        mockT.mockClear();
        // Reset module cache to re-evaluate with fresh mocks
        vi.resetModules();
        const mod = await import('./game-i18n.js');
        translateGameName = mod.translateGameName;
        getItemName = mod.getItemName;
        getActionName = mod.getActionName;
        getItemLocationName = mod.getItemLocationName;
    });

    it('returns translated name when key exists', () => {
        expect(getItemName('/items/test_item', 'Test Item')).toBe('测试物品');
    });

    it('returns fallback when key does not exist', () => {
        expect(getItemName('/items/missing', 'Missing Item')).toBe('Missing Item');
    });

    it('returns fallback when hrid is falsy', () => {
        expect(getItemName('', 'fallback')).toBe('fallback');
        expect(getItemName(null, 'fallback')).toBe('fallback');
    });

    it('getActionName uses actionNames namespace', () => {
        expect(getActionName('/actions/test_action', 'Test Action')).toBe('测试动作');
    });

    it('translateGameName passes correct namespace', () => {
        translateGameName('monsterNames', '/monsters/test', 'Monster');
        expect(mockT).toHaveBeenCalledWith('monsterNames./monsters/test');
    });

    it('getItemLocationName maps item location HRIDs to equipment type names', () => {
        expect(getItemLocationName('/item_locations/main_hand', 'Main Hand')).toBe('主手');
        expect(mockT).toHaveBeenCalledWith('equipmentTypeNames./equipment_types/main_hand');

        expect(getItemLocationName('/item_locations/milking_tool', 'Milking Tool')).toBe('挤奶工具');
    });

    it('getItemLocationName accepts equipment type HRIDs directly', () => {
        expect(getItemLocationName('/equipment_types/main_hand', 'Main Hand')).toBe('主手');
    });

    it('getItemLocationName returns fallback for slots without equipment types', () => {
        expect(getItemLocationName('/item_locations/inventory', 'Inventory')).toBe('Inventory');
        expect(getItemLocationName('', 'fallback')).toBe('fallback');
    });
});
