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
        getInventory: vi.fn(() => []),
        getInitClientData: vi.fn(() => ({
            itemDetailMap: {
                '/items/apple_gummy': { name: 'Apple Gummy', categoryHrid: '/item_categories/food', sortIndex: 1 },
                '/items/milk': { name: 'Milk', categoryHrid: '/item_categories/food', sortIndex: 2 },
                '/items/egg': { name: 'Egg', categoryHrid: '/item_categories/food', sortIndex: 3 },
                '/items/sword': { name: 'Sword', categoryHrid: '/item_categories/weapon', sortIndex: 4 },
            },
            itemCategoryDetailMap: {
                '/item_categories/food': { name: 'Food', sortIndex: 1 },
                '/item_categories/weapon': { name: 'Weapon', sortIndex: 2 },
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
// Native category tab selection (game's per-category TabPanel nesting)
// ---------------------------------------------------------------------------

/**
 * Build a fake native category tab strip matching the shape
 * _selectNativeAllCategoryTab/_restoreNativeCategoryTab expect: a TabsComponent_tabsContainer
 * wrapping [role="tab"] buttons, each containing an svg[aria-label] naming the category. A
 * click handler mimics the game's own behavior of moving aria-selected to the clicked tab.
 */
function makeCategoryTabStrip(labels, selectedIndex) {
    const strip = document.createElement('div');
    strip.className = 'TabsComponent_tabsContainer_abc';
    const buttons = [];
    labels.forEach((label, i) => {
        const btn = document.createElement('button');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(i === selectedIndex));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-label', label);
        btn.appendChild(svg);
        strip.appendChild(btn);
        buttons.push(btn);
    });
    buttons.forEach((btn, i) => {
        btn.addEventListener('click', () => {
            buttons.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
        });
    });
    return { strip, buttons };
}

describe('CustomTabsUI native category tab selection', () => {
    let ui;

    beforeEach(() => {
        document.body.innerHTML = '';
        ui = new CustomTabsUI();
    });

    test('switches to "All Items" and remembers the previously selected tab', () => {
        const container = makeInvContainer([]);
        const { strip, buttons } = makeCategoryTabStrip(['All Items', 'Equipment', 'Resources'], 1);
        container.appendChild(strip);

        const switched = ui._selectNativeAllCategoryTab(container);

        expect(switched).toBe(true);
        expect(buttons[0].getAttribute('aria-selected')).toBe('true');
        expect(buttons[1].getAttribute('aria-selected')).toBe('false');
        expect(ui._savedCategoryTabLabel).toBe('Equipment');
    });

    test('does nothing and reports no switch when "All Items" is already selected', () => {
        const container = makeInvContainer([]);
        const { buttons } = makeCategoryTabStrip(['All Items', 'Equipment'], 0);
        container.appendChild(buttons[0].parentElement);

        const switched = ui._selectNativeAllCategoryTab(container);

        expect(switched).toBe(false);
        expect(ui._savedCategoryTabLabel).toBeNull();
    });

    test('a repeated call while already on "All Items" does not overwrite the saved tab', () => {
        const container = makeInvContainer([]);
        const { strip } = makeCategoryTabStrip(['All Items', 'Equipment', 'Resources'], 1);
        container.appendChild(strip);

        ui._selectNativeAllCategoryTab(container);
        expect(ui._savedCategoryTabLabel).toBe('Equipment');

        // Second pass: already on "All Items" now, must not clobber the saved label.
        const switchedAgain = ui._selectNativeAllCategoryTab(container);
        expect(switchedAgain).toBe(false);
        expect(ui._savedCategoryTabLabel).toBe('Equipment');
    });

    test('restores the originally selected tab and clears the saved state', () => {
        const container = makeInvContainer([]);
        const { strip, buttons } = makeCategoryTabStrip(['All Items', 'Equipment', 'Resources'], 1);
        container.appendChild(strip);
        ui._selectNativeAllCategoryTab(container);

        ui._restoreNativeCategoryTab(container);

        expect(buttons[1].getAttribute('aria-selected')).toBe('true');
        expect(buttons[0].getAttribute('aria-selected')).toBe('false');
        expect(ui._savedCategoryTabLabel).toBeNull();
    });

    test('restoring is a no-op when nothing was ever switched', () => {
        const container = makeInvContainer([]);
        const { strip, buttons } = makeCategoryTabStrip(['All Items', 'Equipment'], 0);
        container.appendChild(strip);
        const clickSpy = vi.spyOn(buttons[0], 'click');

        ui._restoreNativeCategoryTab(container);

        expect(clickSpy).not.toHaveBeenCalled();
    });

    test("a full activate/deactivate layout cycle restores the player's original category tab", () => {
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
        vi.spyOn(ui, '_injectActionButtons').mockReturnValue(null);

        const container = makeInvContainer([makeTile('Milk')]);
        const { strip, buttons } = makeCategoryTabStrip(['All Items', 'Equipment', 'Resources'], 2);
        container.appendChild(strip);

        ui._applyLayoutSync(container);
        expect(buttons[0].getAttribute('aria-selected')).toBe('true');

        ui._clearLayout();

        expect(buttons[2].getAttribute('aria-selected')).toBe('true');
        expect(ui._savedCategoryTabLabel).toBeNull();
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
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

// ---------------------------------------------------------------------------
// "Add to Tab" item-menu dropdown
// ---------------------------------------------------------------------------

/**
 * Build a fake native item action menu matching the DOM shape _injectAddToTabButton expects:
 * an existing button (to copy styling from), an [class*="Item_name"] element, and an optional
 * [class*="Item_enhancementLevel"] badge.
 */
function makeActionMenu(itemName, enhancementLevel = 0) {
    const menu = document.createElement('div');
    menu.className = 'Item_actionMenu_abc';

    const existingBtn = document.createElement('button');
    existingBtn.className = 'Item_actionButton_xyz';
    existingBtn.textContent = 'View Item';
    menu.appendChild(existingBtn);

    const nameEl = document.createElement('div');
    nameEl.className = 'Item_name_abc';
    nameEl.textContent = itemName;
    menu.appendChild(nameEl);

    if (enhancementLevel > 0) {
        const enhEl = document.createElement('div');
        enhEl.className = 'Item_enhancementLevel_xyz';
        enhEl.textContent = `+${enhancementLevel}`;
        menu.appendChild(enhEl);
    }

    document.body.appendChild(menu);
    return menu;
}

describe('CustomTabsUI "Add to Tab" item-menu dropdown', () => {
    let ui;

    beforeEach(() => {
        document.body.innerHTML = '';
        ui = new CustomTabsUI();
        ui._isActive = false;
        ui._config = {
            version: 1,
            selectedTabId: null,
            tabs: [
                { id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] },
                { id: 'tab-2', name: 'Weapons', color: null, open: true, items: [], children: [] },
            ],
        };
        vi.spyOn(ui, '_save').mockImplementation(() => {});
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
        document.body.innerHTML = '';
    });

    test('opening the dropdown renders it as a body-appended, fixed-position portal (not clipped by the native menu)', () => {
        const menu = makeActionMenu('Milk');
        ui._injectAddToTabButton(menu);

        const toggle = menu.querySelector('.toolasha-ct-add-to-tab button');
        expect(toggle).not.toBeNull();
        toggle.click();

        const panel = document.body.querySelector('.toolasha-ct-add-to-tab-panel');
        expect(panel).not.toBeNull();
        expect(panel.parentElement).toBe(document.body);
        expect(menu.contains(panel)).toBe(false);
        expect(panel.style.position).toBe('fixed');
        expect(panel.style.display).toBe('flex');
    });

    test('clicking a tab not yet containing the item adds it and keeps the dropdown open', () => {
        const menu = makeActionMenu('Sword');
        ui._injectAddToTabButton(menu);
        menu.querySelector('.toolasha-ct-add-to-tab button').click();

        const panel = document.body.querySelector('.toolasha-ct-add-to-tab-panel');
        const weaponsBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Weapons'));
        expect(weaponsBtn).toBeDefined();

        weaponsBtn.click();

        expect(ui._config.tabs[1].items).toContain('/items/sword');
        expect(ui._save).toHaveBeenCalled();
        // The dropdown must stay open so the player can toggle multiple tabs in one visit.
        expect(panel.style.display).toBe('flex');
        expect(document.body.contains(panel)).toBe(true);
    });

    test('clicking a tab the item is already in removes it (toggle) and keeps the dropdown open', () => {
        const menu = makeActionMenu('Milk');
        ui._injectAddToTabButton(menu);
        menu.querySelector('.toolasha-ct-add-to-tab button').click();

        const panel = document.body.querySelector('.toolasha-ct-add-to-tab-panel');
        const foodBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Food'));
        expect(foodBtn.textContent).toContain('✓');

        foodBtn.click();

        expect(ui._config.tabs[0].items).not.toContain('/items/milk');
        expect(ui._save).toHaveBeenCalled();
        expect(panel.style.display).toBe('flex');
    });

    test("removing an item also clears it from loadout bindings, mirroring the tab editor's remove button", () => {
        ui._config.tabs[0].loadoutBindings = { Combat: ['/items/milk'] };
        const menu = makeActionMenu('Milk');
        ui._injectAddToTabButton(menu);
        menu.querySelector('.toolasha-ct-add-to-tab button').click();

        const panel = document.body.querySelector('.toolasha-ct-add-to-tab-panel');
        const foodBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Food'));
        foodBtn.click();

        expect(ui._config.tabs[0].loadoutBindings).toEqual({});
    });

    test('the "New Tab" entry creates a root-level tab, adds the item, closes the native menu, and opens the editor', () => {
        const menu = makeActionMenu('Sword');
        ui._injectAddToTabButton(menu);
        menu.querySelector('.toolasha-ct-add-to-tab button').click();

        const openEditorSpy = vi.spyOn(ui, '_openEditor').mockImplementation(() => {});
        const escapeListener = vi.fn();
        document.addEventListener('keydown', escapeListener);

        const panel = document.body.querySelector('.toolasha-ct-add-to-tab-panel');
        const newTabBtn = [...panel.querySelectorAll('button')].at(-1);
        expect(newTabBtn.textContent).toContain('New Tab');

        newTabBtn.click();
        document.removeEventListener('keydown', escapeListener);

        expect(ui._config.tabs).toHaveLength(3);
        const created = ui._config.tabs[2];
        expect(created.items).toContain('/items/sword');
        expect(ui._save).toHaveBeenCalled();
        expect(escapeListener).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
        expect(openEditorSpy).toHaveBeenCalledWith(created.id);
        // Unlike add/remove toggles, creating a tab closes the dropdown since the editor modal
        // takes over from here.
        expect(panel.style.display).toBe('none');
    });

    test('cleanup() removes body-portaled dropdown panels left open across item menus', () => {
        const menu = makeActionMenu('Milk');
        ui._injectAddToTabButton(menu);
        menu.querySelector('.toolasha-ct-add-to-tab button').click();
        expect(document.body.querySelector('.toolasha-ct-add-to-tab-panel')).not.toBeNull();

        ui.cleanup();

        expect(document.body.querySelector('.toolasha-ct-add-to-tab-panel')).toBeNull();
    });

    test('does nothing when there are no tabs configured yet', () => {
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        const menu = makeActionMenu('Milk');
        ui._injectAddToTabButton(menu);

        expect(menu.querySelector('.toolasha-ct-add-to-tab')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Toolbar: Clear All / Import Native Categories
// ---------------------------------------------------------------------------

describe('CustomTabsUI toolbar: Clear All tabs', () => {
    let ui;

    beforeEach(() => {
        document.body.innerHTML = '';
        ui = new CustomTabsUI();
        ui._isActive = false;
        ui._config = {
            version: 1,
            selectedTabId: 'tab-1',
            tabs: [{ id: 'tab-1', name: 'Food', color: null, open: true, items: ['/items/milk'], children: [] }],
        };
        vi.spyOn(ui, '_save').mockImplementation(() => Promise.resolve());
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
        vi.restoreAllMocks();
    });

    test('does nothing when declined via confirm()', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        ui._onClearAllTabs();

        expect(ui._config.tabs).toHaveLength(1);
        expect(ui._save).not.toHaveBeenCalled();
    });

    test('empties all tabs and persists when confirmed', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        ui._onClearAllTabs();

        expect(ui._config.tabs).toEqual([]);
        expect(ui._config.selectedTabId).toBeNull();
        expect(ui._save).toHaveBeenCalled();
    });

    test('is a no-op and does not prompt when there are no tabs to clear', () => {
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        const confirmSpy = vi.spyOn(window, 'confirm');

        ui._onClearAllTabs();

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(ui._save).not.toHaveBeenCalled();
    });
});

describe('CustomTabsUI toolbar: Import Native Categories', () => {
    let ui;

    beforeEach(async () => {
        document.body.innerHTML = '';
        const { default: config } = await import('../../../core/config.js');
        config.getSettingValue.mockImplementation((key, fallback) =>
            key === 'inventoryTabs_categoryAddAll' ? true : fallback
        );
        ui = new CustomTabsUI();
        ui._isActive = false;
        ui._config = { version: 1, tabs: [], selectedTabId: null };
        vi.spyOn(ui, '_save').mockImplementation(() => Promise.resolve());
        vi.spyOn(ui, '_findContentContainer').mockReturnValue(null);
    });

    afterEach(() => {
        ui._tileObserver?.disconnect();
    });

    test('creates one top-level tab per non-empty native category, populated with its items', () => {
        ui._onImportNativeCategories();

        const names = ui._config.tabs.map((tab) => tab.name);
        expect(names).toEqual(['Food', 'Weapon']);

        const foodTab = ui._config.tabs.find((tab) => tab.name === 'Food');
        expect(foodTab.items).toEqual(['/items/apple_gummy', '/items/milk', '/items/egg']);

        const weaponTab = ui._config.tabs.find((tab) => tab.name === 'Weapon');
        expect(weaponTab.items).toEqual(['/items/sword']);

        expect(ui._save).toHaveBeenCalled();
    });

    test('clicking a second time does not duplicate tabs for categories that already have one', () => {
        ui._onImportNativeCategories();
        const firstPassTabIds = ui._config.tabs.map((tab) => tab.id);

        ui._onImportNativeCategories();

        expect(ui._config.tabs.map((tab) => tab.id)).toEqual(firstPassTabIds);
        expect(ui._config.tabs).toHaveLength(2);
    });

    test('re-importing after a category tab was renamed creates a fresh tab under the original category name', () => {
        ui._onImportNativeCategories();
        const foodTab = ui._config.tabs.find((tab) => tab.name === 'Food');
        foodTab.name = 'My Food Stash';

        ui._onImportNativeCategories();

        const names = ui._config.tabs.map((tab) => tab.name).sort();
        expect(names).toEqual(['Food', 'My Food Stash', 'Weapon']);
    });
});
