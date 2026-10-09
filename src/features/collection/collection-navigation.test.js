// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';
import { CollectionNavigation } from './collection-navigation.js';

const mocks = vi.hoisted(() => ({ gameData: null }));

vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => mocks.gameData) },
}));

// Localized (non-English) display names, e.g. translations['/items/griffin_leather'] = '狮鹫皮革'.
const translations = vi.hoisted(() => ({}));

vi.mock('../../utils/game-i18n.js', () => ({
    getItemName: (hrid, fallback) => translations[hrid] ?? fallback,
}));

afterEach(() => {
    document.body.innerHTML = '';
    for (const key of Object.keys(translations)) {
        delete translations[key];
    }
});

describe('CollectionNavigation tile lifecycle', () => {
    test('disable removes tile listeners and restores tile state', () => {
        const feature = new CollectionNavigation();
        const tile = document.createElement('div');
        tile.className = 'Collection_tierGray__test';
        tile.style.cursor = 'default';
        tile.innerHTML = '<svg><use href="#test_item"></use></svg>';
        document.body.appendChild(tile);
        const showPopover = vi.spyOn(feature, 'showPopover').mockImplementation(() => {});

        feature.handleCollectionTile(tile);
        tile.click();
        expect(showPopover).toHaveBeenCalledTimes(1);

        feature.disable();
        tile.click();

        expect(showPopover).toHaveBeenCalledTimes(1);
        expect(tile.dataset.mwiCollectionNav).toBeUndefined();
        expect(tile.style.cursor).toBe('default');
        expect(feature.tileClickHandlers.size).toBe(0);
    });

    test('prunes detached tile handler references', () => {
        const feature = new CollectionNavigation();
        const tile = document.createElement('div');
        tile.className = 'Collection_tierGray__test';
        tile.innerHTML = '<svg><use href="#test_item"></use></svg>';

        feature.handleCollectionTile(tile);
        expect(feature.tileClickHandlers.size).toBe(1);

        feature.pruneDetachedTileHandlers();
        expect(feature.tileClickHandlers.size).toBe(0);
    });
});

describe('localized name lookup', () => {
    test('extractItemHridFromName resolves localized names and ★ → (R) refined variants', () => {
        mocks.gameData = {
            itemDetailMap: {
                '/items/griffin_leather': { name: 'Griffin Leather' },
                '/items/griffin_bulwark_r': { name: 'Griffin Bulwark (R)' },
            },
        };
        translations['/items/griffin_leather'] = '狮鹫皮革';
        translations['/items/griffin_bulwark_r'] = '狮鹫壁垒 (R)';

        const feature = new CollectionNavigation();
        expect(feature.extractItemHridFromName('狮鹫皮革')).toBe('/items/griffin_leather');
        expect(feature.extractItemHridFromName('Griffin Leather')).toBe('/items/griffin_leather');
        // zh renders refined items with ★ while the data name carries "(R)".
        expect(feature.extractItemHridFromName('狮鹫壁垒 ★')).toBe('/items/griffin_bulwark_r');
        expect(feature.extractItemHridFromName('Griffin Bulwark ★')).toBe('/items/griffin_bulwark_r');
    });
});
