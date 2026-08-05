// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';
import { CollectionNavigation } from './collection-navigation.js';

afterEach(() => {
    document.body.innerHTML = '';
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
