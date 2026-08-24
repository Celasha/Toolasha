/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    showUnorganized: true,
    // Simulates config.settingsMap lacking 'inventoryTabs_showUnorganized' entirely — e.g. the
    // window between config.clearSettingsCache() and the next successful config.loadSettings()
    // during a character switch. Real Config.getSettingValue(key, defaultValue) returns
    // defaultValue verbatim when settingsMap[key] is absent; it has no schema-default fallback
    // the way getSetting() does.
    showUnorganizedCacheEmpty: false,
    tileGap: 4,
}));

vi.mock('../../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((key, fallback) => {
            if (key === 'inventoryTabs_showUnorganized') {
                return mocks.showUnorganizedCacheEmpty ? fallback : mocks.showUnorganized;
            }
            if (key === 'inventoryTabs_tileGap') return mocks.tileGap;
            return fallback;
        }),
        getSetting: vi.fn((key) => {
            // getSetting() has a schema-default fallback for boolean settings in real
            // production code, so — unlike the getSettingValue() branch above — it is
            // deliberately NOT affected by showUnorganizedCacheEmpty here: that's the whole
            // point of the fix this file's cache-empty-window tests verify.
            if (key === 'inventoryTabs_showUnorganized') return mocks.showUnorganized;
            return false;
        }),
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

vi.mock('../../../core/loadout-state.js', () => ({
    default: {
        onUpdate: vi.fn(),
        offUpdate: vi.fn(),
        getAllSnapshots: vi.fn(() => []),
        getSnapshotsById: vi.fn(() => ({})),
    },
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
        mocks.showUnorganizedCacheEmpty = false;
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
        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        expect(header.textContent).toContain('Unorganized (1)');
        const swordTile = container.querySelector('svg[aria-label="Sword"]').closest('.Item_itemContainer_abc');
        expect(swordTile.classList.contains('toolasha-ct-visible')).toBe(true);
    });

    test('a single unassigned enhanced physical tile is counted once in Unorganized, not once per key', () => {
        // _buildTileMap registers one physical enhanced tile under BOTH its base hrid
        // ('/items/sword') and its enhanced hrid ('/items/sword+3') keys — same DOM element,
        // two map entries. _injectUnorganized iterates every tileMap entry and pushes tiles from
        // each one into remainingEntries without deduplicating by tile identity, so a single
        // unassigned enhanced tile can be counted/processed twice: once via its base key, once
        // via its enhanced key.
        const container = makeInvContainer([makeTile('Sword', 3)]);
        ui._applyLayoutSync(container);

        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        // There is exactly one physical tile in the DOM — the header must say so.
        expect(header.textContent).toContain('Unorganized (1)');
        expect(container.querySelectorAll('.toolasha-ct-visible').length).toBe(1);
    });

    test('an enhanced tile assigned to a tab by its exact enhanced hrid does not leak into Unorganized', () => {
        const container = makeInvContainer([makeTile('Sword', 3), makeTile('Milk')]);
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Weapons', color: null, open: true, items: ['/items/sword+3'], children: [] }],
            selectedTabId: null,
        };
        ui._applyLayoutSync(container);

        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        // Only Milk is unassigned; the +3 Sword belongs to the Weapons tab.
        expect(header.textContent).toContain('Unorganized (1)');
        const swordTile = container.querySelector('svg[aria-label="Sword"]').closest('.Item_itemContainer_abc');
        expect(swordTile.dataset.toolashaTabId).toBe('tab-1');
        const milkTile = container.querySelector('svg[aria-label="Milk"]').closest('.Item_itemContainer_abc');
        expect(milkTile.classList.contains('toolasha-ct-visible')).toBe(true);
    });

    test('a mix of enhanced and unenhanced unassigned tiles all count correctly with no double-count', () => {
        const container = makeInvContainer([makeTile('Sword', 3), makeTile('Milk'), makeTile('Egg')]);
        ui._applyLayoutSync(container);

        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        expect(header.textContent).toContain('Unorganized (3)');
        expect(container.querySelectorAll('.toolasha-ct-visible').length).toBe(3);
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

    test('Unorganized still appears on a full rebuild that runs while the config cache is empty (2.87.9 recurrence)', () => {
        // Reproduces the confirmed 2.87.9 mechanism: config.clearSettingsCache() (fired during
        // character-switching, and again by an independent settings-ui.js character_initialized
        // listener that never repairs it) synchronously empties config.settingsMap.
        // custom-tabs-ui.js reads inventoryTabs_showUnorganized via getSettingValue() with NO
        // default argument at both call sites, so while settingsMap lacks the key it resolves
        // to whatever the caller passed as fallback (undefined here) — falsy — even though the
        // checkbox's schema default is true. getSetting() has a schema-fallback for exactly this
        // case; getSettingValue() does not, and that's the gap this exercises.
        mocks.showUnorganizedCacheEmpty = true;

        const container = makeInvContainer([makeTile('Milk')]);
        ui._applyLayoutSync(container);

        const header = container.querySelector('.toolasha-ct-unorg-header');
        expect(header).not.toBeNull();
        expect(header.textContent).toContain('Unorganized (1)');
        const milkTile = container.querySelector('svg[aria-label="Milk"]').closest('.Item_itemContainer_abc');
        expect(milkTile.classList.contains('toolasha-ct-visible')).toBe(true);
    });

    test('the Unorganized self-heal invariant on the lightweight path is not defeated by a config-cache-empty window', () => {
        // Exercises the OTHER getSettingValue('inventoryTabs_showUnorganized') call site — the
        // self-heal check gating a lightweight-path rebuild — not the full-rebuild injection
        // call site covered above.
        const container = makeInvContainer([makeTile('Milk'), makeTile('Egg')]);
        ui._applyLayoutSync(container);
        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (2)');

        // Assign Milk to a tab (membership change, no composition/count change) at the exact
        // moment the config cache happens to be empty.
        ui._config = {
            version: 1,
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
            selectedTabId: null,
        };
        mocks.showUnorganizedCacheEmpty = true;
        ui._applyLayoutSync(container);

        expect(container.querySelector('.toolasha-ct-unorg-header').textContent).toContain('Unorganized (1)');
    });
});

describe('CustomTabsUI action buttons survive removal of the piggybacked sort-controls row', () => {
    let ui;

    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.showUnorganized = true;
        mocks.tileGap = 4;
        ui = new CustomTabsUI();
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        // Real _injectActionButtons() runs in this describe block (not mocked out), since the
        // bug lives inside it. Only bypass DOM lookups unrelated to the button-injection path.
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
    });

    function makeSortControls() {
        const sortControls = document.createElement('div');
        sortControls.className = 'mwi-inventory-sort-controls';
        document.body.appendChild(sortControls);
        return sortControls;
    }

    test('action buttons are appended into an existing sort-controls row instead of a standalone topbar', () => {
        makeSortControls();
        const container = makeInvContainer([makeTile('Milk')]);

        ui._applyLayoutSync(container);

        const actionBtns = document.querySelector('.toolasha-ct-action-btns');
        expect(actionBtns).not.toBeNull();
        expect(actionBtns.parentElement.className).toBe('mwi-inventory-sort-controls');
        // No fallback topbar was created inside the inventory container.
        expect(container.querySelector('.toolasha-ct-topbar')).toBeNull();
    });

    test('removing the sort-controls row (e.g. toggling "Sort inventory items by value" off) does not permanently delete the tab action buttons', () => {
        // Reproduces the reported bug: inventory-sort.js's disable() removes the whole
        // .mwi-inventory-sort-controls element it owns, with no awareness that Custom Tabs
        // piggybacked its +Tab/Export/Import/Expand All/Collapse All buttons inside it.
        // Because _injectActionButtons() returns null when it merges into that row,
        // _applyLayoutSync's dirty-check (_injectedEls / areInjectedLayoutElementsAttached)
        // never learns the buttons exist, so it can't detect they went missing and never
        // re-injects them on the next layout pass.
        const sortControls = makeSortControls();
        const container = makeInvContainer([makeTile('Milk')]);
        ui._applyLayoutSync(container);
        expect(document.querySelector('.toolasha-ct-action-btns')).not.toBeNull();

        // Simulate InventorySort.disable() tearing down the row it owns.
        sortControls.remove();
        expect(document.querySelector('.toolasha-ct-action-btns')).toBeNull();

        // The next layout pass (e.g. the items_updated → _applyLayout path, or the
        // MutationObserver-driven _applyLayoutSync path) must restore the buttons.
        ui._applyLayoutSync(container);

        expect(document.querySelector('.toolasha-ct-action-btns')).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Loadout binding effective-enhancement parity
// ---------------------------------------------------------------------------

describe('CustomTabsUI loadout binding enhancement resolution', () => {
    let ui;
    let loadoutState;

    beforeEach(async () => {
        loadoutState = (await import('../../../core/loadout-state.js')).default;
        vi.clearAllMocks();
        ui = new CustomTabsUI();
        ui._isActive = false;
        ui._config = {
            version: 1,
            selectedTabId: 'tab-1',
            tabs: [
                {
                    id: 'tab-1',
                    name: 'Bound',
                    items: ['/items/sword+5'],
                    loadoutBindings: { Combat: ['/items/sword+5'] },
                    children: [],
                },
            ],
        };
        vi.spyOn(ui, '_save').mockImplementation(() => {});
    });

    test('full sync tracks a canonical effective upgrade without mutating loadout truth', () => {
        loadoutState.getSnapshotsById.mockReturnValue({
            one: {
                name: 'Combat',
                equipment: [{ itemHrid: '/items/sword', enhancementLevel: 10, isAvailable: true }],
                unavailableEquipment: [],
                food: [],
                drinks: [],
            },
        });

        ui._onLoadoutSnapshotUpdate();

        expect(ui._config.tabs[0].items).toEqual(['/items/sword+10']);
        expect(ui._config.tabs[0].loadoutBindings.Combat).toEqual(['/items/sword+10']);
        expect(ui._save).toHaveBeenCalled();
    });

    test('full sync tracks a canonical effective downgrade from +10 to +7', () => {
        ui._config.tabs[0].items = ['/items/sword+10'];
        ui._config.tabs[0].loadoutBindings.Combat = ['/items/sword+10'];
        loadoutState.getSnapshotsById.mockReturnValue({
            one: {
                name: 'Combat',
                equipment: [{ itemHrid: '/items/sword', enhancementLevel: 7, isAvailable: true }],
                unavailableEquipment: [],
                food: [],
                drinks: [],
            },
        });

        ui._onLoadoutSnapshotUpdate();

        expect(ui._config.tabs[0].items).toEqual(['/items/sword+7']);
        expect(ui._config.tabs[0].loadoutBindings.Combat).toEqual(['/items/sword+7']);
        expect(ui._save).toHaveBeenCalled();
    });

    test('full sync preserves an existing binding when Core reports that saved equipment is unavailable', () => {
        ui._config.tabs[0].items = ['/items/sword+10'];
        ui._config.tabs[0].loadoutBindings.Combat = ['/items/sword+10'];
        loadoutState.getSnapshotsById.mockReturnValue({
            one: {
                name: 'Combat',
                equipment: [],
                unavailableEquipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/sword' }],
                hasUnavailableEquipment: true,
                food: [],
                drinks: [],
            },
        });

        ui._onLoadoutSnapshotUpdate();

        expect(ui._config.tabs[0].items).toEqual(['/items/sword+10']);
        expect(ui._config.tabs[0].loadoutBindings.Combat).toEqual(['/items/sword+10']);
        expect(ui._save).not.toHaveBeenCalled();
    });

    test('full sync retains intended consumable identity during a temporary stockout', async () => {
        const { default: config } = await import('../../../core/config.js');
        config.getSetting.mockImplementationOnce(() => true);

        ui._config.tabs[0].items = ['/items/sword+10', '/items/apple_gummy'];
        ui._config.tabs[0].loadoutBindings.Combat = ['/items/sword+10', '/items/apple_gummy'];
        loadoutState.getSnapshotsById.mockReturnValue({
            one: {
                name: 'Combat',
                equipment: [{ itemHrid: '/items/sword', enhancementLevel: 10, isAvailable: true }],
                unavailableEquipment: [],
                food: [{ itemHrid: '' }],
                drinks: [],
                unavailableFood: [{ slotIndex: 0, itemHrid: '/items/apple_gummy' }],
                unavailableDrinks: [],
            },
        });

        ui._onLoadoutSnapshotUpdate();

        expect(ui._config.tabs[0].items).toEqual(['/items/sword+10', '/items/apple_gummy']);
        expect(ui._config.tabs[0].loadoutBindings.Combat).toEqual(['/items/sword+10', '/items/apple_gummy']);
        expect(ui._save).not.toHaveBeenCalled();
    });

    test('a new loadout binding fails closed instead of adding only the currently available subset', () => {
        ui._config.tabs[0].items = [];
        ui._config.tabs[0].loadoutBindings = {};
        loadoutState.getSnapshotsById.mockReturnValue({
            one: {
                name: 'Partial',
                actionTypeHrid: '/action_types/combat',
                equipment: [{ itemHrid: '/items/sword', enhancementLevel: 10, isAvailable: true }],
                unavailableEquipment: [{ itemLocationHrid: '/item_locations/off_hand', itemHrid: '/items/shield' }],
                food: [],
                drinks: [],
                unavailableFood: [],
                unavailableDrinks: [],
            },
        });
        const container = document.createElement('div');

        ui._renderLoadoutButtons(container, 'tab-1');

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Unavailable');
        button.click();
        expect(ui._config.tabs[0].items).toEqual([]);
        expect(ui._config.tabs[0].loadoutBindings).toEqual({});
        expect(ui._save).not.toHaveBeenCalled();
    });
});
