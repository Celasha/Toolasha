/* @vitest-environment jsdom */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true), getSettingValue: vi.fn(() => 'None') },
}));
vi.mock('./inventory-badge-manager.js', () => ({
    default: {
        currentInventoryElem: null,
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        clearProcessedTracking: vi.fn(),
    },
}));
vi.mock('./inventory-sort.js', () => ({ default: { currentMode: 'none' } }));

const { default: inventoryCategoryTotals } = await import('./inventory-category-totals.js');
const { default: inventoryBadgeManager } = await import('./inventory-badge-manager.js');

/**
 * Builds the real nested structure the game renders: Inventory_items wraps a TabsComponent
 * whose active TabPanel contains one Inventory_itemGrid per category (label + tiles as flat
 * siblings) - confirmed against a live DOM capture. A hidden sibling TabPanel (e.g. the
 * "Favorites" tab) carries a duplicate, stale set of grids that must NOT be counted.
 */
function buildInventoryDOM() {
    const inventoryItems = document.createElement('div');
    inventoryItems.className = 'Inventory_items__6SXv0';

    const tabPanelsContainer = document.createElement('div');
    tabPanelsContainer.className = 'TabsComponent_tabPanelsContainer__26mzo';

    function buildGrid(categoryName, tileValues) {
        const grid = document.createElement('div');
        grid.className = 'Inventory_itemGrid__20YAH';

        const label = document.createElement('div');
        label.className = 'Inventory_label__XEOAx';
        const categoryButton = document.createElement('span');
        categoryButton.className = 'Inventory_categoryButton__35s1x';
        categoryButton.textContent = categoryName;
        label.appendChild(categoryButton);
        grid.appendChild(label);

        for (const value of tileValues) {
            const tile = document.createElement('div');
            tile.className = 'Item_itemContainer__x7kH1';
            tile.dataset.askValue = String(value);
            grid.appendChild(tile);
        }

        return grid;
    }

    const visiblePanel = document.createElement('div');
    visiblePanel.className = 'TabPanel_tabPanel__tXMJF';
    visiblePanel.appendChild(buildGrid('Currencies', [999999]));
    visiblePanel.appendChild(buildGrid('Loots', [3455000, 4000000]));
    visiblePanel.appendChild(buildGrid('Labyrinth', [4558000]));

    const hiddenPanel = document.createElement('div');
    hiddenPanel.className = 'TabPanel_tabPanel__tXMJF TabPanel_hidden__26UM3';
    hiddenPanel.appendChild(buildGrid('Loots', [1]));

    tabPanelsContainer.appendChild(visiblePanel);
    tabPanelsContainer.appendChild(hiddenPanel);
    inventoryItems.appendChild(tabPanelsContainer);

    return inventoryItems;
}

describe('InventoryCategoryTotals.updateAllCategoryTotals', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('injects a total onto each visible category label, skipping Currencies', () => {
        const inventoryItems = buildInventoryDOM();
        document.body.appendChild(inventoryItems);
        inventoryBadgeManager.currentInventoryElem = inventoryItems;

        inventoryCategoryTotals.updateAllCategoryTotals();

        const labels = inventoryItems.querySelectorAll(
            '[class*="TabPanel_tabPanel"]:not([class*="TabPanel_hidden"]) [class*="Inventory_label"]'
        );
        const [currencies, loots, labyrinth] = labels;

        expect(currencies.querySelector('[data-mwi-category-total]')).toBeNull();
        expect(loots.querySelector('[data-mwi-category-total]').textContent).toBe('7.5M');
        expect(labyrinth.querySelector('[data-mwi-category-total]').textContent).toBe('4.6M');
    });

    test('does not count tiles from a hidden sibling tab panel', () => {
        const inventoryItems = buildInventoryDOM();
        document.body.appendChild(inventoryItems);
        inventoryBadgeManager.currentInventoryElem = inventoryItems;

        inventoryCategoryTotals.updateAllCategoryTotals();

        const visibleLootsLabel = inventoryItems.querySelector(
            '[class*="TabPanel_tabPanel"]:not([class*="TabPanel_hidden"]) [class*="Inventory_label"]:nth-of-type(1)'
        );
        // The visible "Loots" total (7.5M) must not include the hidden panel's stale 1-value tile.
        const lootsSpan = inventoryItems.querySelectorAll('[data-mwi-category-total]')[0];
        expect(lootsSpan.textContent).toBe('7.5M');
        expect(visibleLootsLabel).toBeTruthy();
    });

    test('does nothing when currentInventoryElem is not set', () => {
        expect(() => inventoryCategoryTotals.updateAllCategoryTotals()).not.toThrow();
    });
});
