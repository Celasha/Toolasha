/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    showUnorganized: true,
    tileGap: 4,
}));

vi.mock('../../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((key, fallback) => {
            if (key === 'inventoryTabs_showUnorganized') return mocks.showUnorganized;
            if (key === 'inventoryTabs_tileGap') return mocks.tileGap;
            return fallback;
        }),
        getSetting: vi.fn(() => false),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
    },
}));

vi.mock('../../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getCurrentCharacterId: vi.fn(() => 'char-1'),
        getInitClientData: vi.fn(() => ({
            itemDetailMap: {
                '/items/apple_gummy': { name: 'Apple Gummy', categoryHrid: '/item_categories/food', sortIndex: 1 },
                '/items/milk': { name: 'Milk', categoryHrid: '/item_categories/food', sortIndex: 2 },
                '/items/egg': { name: 'Egg', categoryHrid: '/item_categories/food', sortIndex: 3 },
                '/items/sword': { name: 'Sword', categoryHrid: '/item_categories/weapon', sortIndex: 4 },
            },
            itemCategoryDetailMap: {
                '/item_categories/food': { sortIndex: 1 },
                '/item_categories/weapon': { sortIndex: 2 },
            },
        })),
    },
}));

vi.mock('../inventory-sort.js', () => ({
    default: { currentMode: 'none', onModeChange: vi.fn(() => () => {}) },
}));

vi.mock('../inventory-badge-manager.js', () => ({
    default: {
        currentInventoryElem: null,
        isRendering: false,
        isCalculating: false,
        lastRenderTime: 0,
        lastCalculationTime: 0,
        renderAllBadges: vi.fn(async () => {}),
    },
}));

vi.mock('../../combat/loadout-snapshot.js', () => ({
    default: { onSnapshotChange: vi.fn(() => () => {}), getSnapshot: vi.fn(() => null) },
}));

vi.mock('../../../utils/formatters.js', () => ({
    formatKMB: vi.fn((n) => `${n}`),
}));

import CustomTabsUI from './custom-tabs-ui.js';

/**
 * Build a fake game inventory tile matching the DOM shape _buildTileMap/_getHridFromTile expect:
 * an `[class*="Item_itemContainer"]` element containing an `svg[aria-label]` naming the item,
 * plus an optional `[class*="Item_enhancementLevel"]` badge for enhancement level.
 */
function makeTile(itemName, enhancementLevel = 0) {
    const tile = document.createElement('div');
    tile.className = 'Item_itemContainer_abc';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-label', itemName);
    tile.appendChild(svg);

    if (enhancementLevel > 0) {
        const enh = document.createElement('div');
        enh.className = 'Item_enhancementLevel_xyz';
        enh.textContent = `+${enhancementLevel}`;
        tile.appendChild(enh);
    }

    return tile;
}

function makeInvContainer(tiles) {
    const container = document.createElement('div');
    container.className = 'Inventory_items_container';
    for (const tile of tiles) container.appendChild(tile);
    document.body.appendChild(container);
    return container;
}

describe('CustomTabsUI layout invalidation', () => {
    let ui;

    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.showUnorganized = true;
        mocks.tileGap = 4;
        ui = new CustomTabsUI();
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        // Bypass DOM lookups unrelated to the layout pass itself.
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
        vi.spyOn(ui, '_injectActionButtons').mockReturnValue(null);
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
    });

    test('self-heals when the Unorganized header loses its identifying class while still attached', () => {
        // areInjectedLayoutElementsAttached() only checks that injected elements are still
        // DOM-attached (element.parentElement === container); it does not check that they still
        // carry the class every selector-based lookup relies on. If something strips or replaces
        // the header's className while the node itself stays attached (and composition/tile
        // count are unchanged, so neither existing invalidation check fires), the pre-existing
        // "injected elements attached" guard reports everything fine while
        // `.toolasha-ct-unorg-header` can no longer find it — reproducing "header absent while
        // unassigned tiles exist and remain hidden" without a page reload.
        const container = makeInvContainer([makeTile('Milk'), makeTile('Egg')]);

        ui._applyLayoutSync(container);
        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();

        // Strip the identifying class without detaching the node — it remains a child of
        // invContainer (and remains the same object reference inside ui._injectedEls), so the
        // structural attachment check alone cannot detect anything wrong.
        header.className = '';
        expect(container.querySelector('.toolasha-ct-unorg-header')).toBeNull();

        ui._applyLayoutSync(container);
        const restored = container.querySelector('.toolasha-ct-unorg-header');
        expect(restored).not.toBeNull();
        expect(restored.textContent).toContain('Unorganized (2)');
        expect(container.querySelectorAll('.toolasha-ct-visible').length).toBe(2);
    });

    test('does not recreate an Unorganized header when there is nothing unassigned', () => {
        const container = makeInvContainer([makeTile('Milk')]);
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
            selectedTabId: null,
        };

        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header')).toBeNull();
    });

    test('detects a same-count identity swap and rebuilds instead of reusing stale layout', () => {
        // Reproduces the evidence-backed hazard from the report: a production event can replace
        // one inventory identity with another (a material's last unit consumed while a new
        // output item appears) while the total tile DOM node count stays exactly the same. A
        // count-only invalidation check would miss this and reuse stale header/order state.
        const container = makeInvContainer([makeTile('Milk'), makeTile('Egg')]);
        ui._applyLayoutSync(container);

        const rebuildSpy = vi.spyOn(ui, '_injectActionButtons');
        rebuildSpy.mockClear();

        // Swap Egg out for Apple Gummy without changing the tile count.
        container.querySelector('svg[aria-label="Egg"]').closest('.Item_itemContainer_abc').remove();
        container.appendChild(makeTile('Apple Gummy'));
        expect(container.querySelectorAll('[class*="Item_itemContainer"]').length).toBe(2);

        ui._applyLayoutSync(container);

        // A full rebuild re-invokes _injectActionButtons; the lightweight path never does.
        expect(rebuildSpy).toHaveBeenCalled();
        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header.textContent).toContain('Unorganized (2)');
        const visibleNames = [...container.querySelectorAll('.toolasha-ct-visible')].map((tile) =>
            tile.querySelector('svg[aria-label]').getAttribute('aria-label')
        );
        expect(visibleNames.sort()).toEqual(['Apple Gummy', 'Milk']);
    });

    test('an enhancement-level-only identity change at constant tile count invalidates correctly', () => {
        const container = makeInvContainer([makeTile('Sword', 0)]);
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (1)');

        // React swaps the base Sword tile for a +3 Sword tile (enhancement completed) — same
        // count, different identity.
        container.querySelector('.Item_itemContainer_abc').remove();
        container.appendChild(makeTile('Sword', 3));

        const rebuildSpy = vi.spyOn(ui, '_injectActionButtons');
        rebuildSpy.mockClear();
        ui._applyLayoutSync(container);

        expect(rebuildSpy).toHaveBeenCalled();
        // Note: the Unorganized header's displayed count for an enhanced, still-unassigned tile
        // is a separate pre-existing defect (unrelated to this fix) — _buildTileMap registers an
        // enhanced tile under both its base and enhanced hrid keys, so _injectUnorganized's
        // remaining-entries loop double-counts it. What this test asserts, and what this fix is
        // responsible for, is that the identity change is detected and triggers a rebuild (not a
        // stale lightweight update) so the tile is at least present and visible under Unorganized.
        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        const swordTile = container.querySelector('svg[aria-label="Sword"]').closest('.Item_itemContainer_abc');
        expect(swordTile.classList.contains('toolasha-ct-visible')).toBe(true);
    });

    test('new unassigned item becomes visible under Unorganized with a correct count', () => {
        const container = makeInvContainer([makeTile('Milk')]);
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (1)');

        container.appendChild(makeTile('Apple Gummy'));
        ui._applyLayoutSync(container);

        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (2)');
        expect(container.querySelectorAll('.toolasha-ct-visible').length).toBe(2);
    });

    test('Unorganized membership changing without a tile-count change updates header/visibility', () => {
        const container = makeInvContainer([makeTile('Milk'), makeTile('Egg')]);
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (2)');

        // Assign Milk to a tab without adding/removing any tile DOM nodes.
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
            selectedTabId: null,
        };
        ui._applyLayoutSync(container);

        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (1)');
        const milkTile = container.querySelector('svg[aria-label="Milk"]').closest('.Item_itemContainer_abc');
        expect(milkTile.dataset.toolashaTabId).toBe('tab-1');
    });

    test('does not create an Unorganized header when the setting is disabled', () => {
        mocks.showUnorganized = false;
        const container = makeInvContainer([makeTile('Milk')]);
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header')).toBeNull();
    });

    test('0 -> 1 and 1 -> 0 unassigned boundaries create/remove the header at constant tile count', () => {
        const container = makeInvContainer([makeTile('Milk')]);
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
            selectedTabId: null,
        };
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header')).toBeNull();

        // Unassign Milk (composition/count unchanged, only config changed) — 0 -> 1 unassigned.
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (1)');

        // Re-assign Milk — 1 -> 0 unassigned.
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
            selectedTabId: null,
        };
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header')).toBeNull();
    });

    test('ordinary quantity-only updates (no identity/composition change) do not trigger a full rebuild', () => {
        const container = makeInvContainer([makeTile('Milk'), makeTile('Egg')]);
        ui._applyLayoutSync(container);

        const rebuildSpy = vi.spyOn(ui, '_injectActionButtons');
        rebuildSpy.mockClear();

        // No DOM changes at all — simulates an items_updated event carrying only a quantity
        // change that doesn't touch tile identity/composition.
        ui._applyLayoutSync(container);

        expect(rebuildSpy).not.toHaveBeenCalled();
    });
});
