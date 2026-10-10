// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fakeDataManager = vi.hoisted(() => {
    const listeners = new Map();
    return {
        characterData: {},
        getInventory: vi.fn(() => []),
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        on: (event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        },
        off: (event, handler) => {
            listeners.get(event)?.delete(handler);
        },
        emit: (event, data) => {
            for (const handler of Array.from(listeners.get(event) || [])) handler(data);
        },
    };
});

const mockMarketplaceSession = vi.hoisted(() => ({
    isActive: vi.fn(() => true),
    start: vi.fn(() => 1),
    end: vi.fn(),
}));

function renderBadgeText(tab, material) {
    const badge = document.createElement('span');
    badge.className = 'TabsComponent_badge';
    badge.textContent = material.missing > 0 ? `Missing: ${material.missing}` : `Sufficient (${material.required})`;
    tab.innerHTML = '';
    tab.appendChild(badge);
    tab.setAttribute('data-missing-quantity', material.missing.toString());
}

const mockMarketplaceTabs = vi.hoisted(() => ({
    createMaterialTab: vi.fn((material, referenceTab) => {
        const tab = referenceTab.cloneNode(true);
        tab.setAttribute('data-item-hrid', material.itemHrid);
        renderBadgeText(tab, material);
        return tab;
    }),
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(),
    setupMarketplaceCleanupObserver: vi.fn(() => vi.fn()),
    navigateToMarketplace: vi.fn(() => true),
    watchNativeTabExit: vi.fn(() => vi.fn()),
    clickMarketplaceNavigationButton: vi.fn(() => true),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => true),
    updateTabBadge: vi.fn((tab, material) => renderBadgeText(tab, material)),
}));

const mockAutofillManager = vi.hoisted(() => ({
    initialize: vi.fn(),
    cleanup: vi.fn(),
    startSession: vi.fn(),
    arm: vi.fn(() => true),
    exitSession: vi.fn(),
}));

vi.mock('../../core/data-manager.js', () => ({ default: fakeDataManager }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../core/marketplace-session.js', () => ({
    marketplaceSession: mockMarketplaceSession,
    MARKETPLACE_OWNER: { LABYRINTH_SUPPLIES: 'LABYRINTH_SUPPLIES' },
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({ createAutofillManager: () => mockAutofillManager }));
vi.mock('../../utils/marketplace-tabs.js', () => mockMarketplaceTabs);
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({ registerTimeout: vi.fn(), clearAll: vi.fn() }),
}));

const { calculateMissingSupplies, injectButton, handleClick } = await import('./labyrinth-missing-supplies.js');

describe('calculateMissingSupplies', () => {
    beforeEach(() => {
        fakeDataManager.characterData = {};
        fakeDataManager.getInventory.mockReturnValue([]);
        fakeDataManager.getInitClientData.mockReturnValue({
            itemDetailMap: {
                '/items/expert_torch': { name: 'Expert Torch', isTradable: true },
                '/items/expert_shroud': { name: 'Expert Shroud', isTradable: true },
                '/items/expert_beacon': { name: 'Expert Beacon', isTradable: true },
            },
        });
    });

    test('computes missing = cap - owned for each selected supply tier', () => {
        fakeDataManager.characterData = {
            characterSetting: {
                labyrinthTorchHrid: '/items/expert_torch',
                labyrinthShroudHrid: '/items/expert_shroud',
            },
            characterInfo: { labyrinthTorchCap: 320, labyrinthShroudCap: 10 },
        };
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 44 },
        ]);

        const result = calculateMissingSupplies();

        expect(result).toEqual([
            {
                itemHrid: '/items/expert_torch',
                itemName: 'Expert Torch',
                missing: 320 - 44,
                queued: 0,
                isTradeable: true,
                required: 320,
            },
            {
                itemHrid: '/items/expert_shroud',
                itemName: 'Expert Shroud',
                missing: 10,
                queued: 0,
                isTradeable: true,
                required: 10,
            },
        ]);
    });

    test('falls back to the client base cap when characterInfo has no override', () => {
        fakeDataManager.characterData = {
            characterSetting: { labyrinthBeaconHrid: '/items/expert_beacon' },
            characterInfo: {},
        };

        const result = calculateMissingSupplies();

        // Base beacon cap is 5 with nothing owned.
        expect(result).toEqual([
            {
                itemHrid: '/items/expert_beacon',
                itemName: 'Expert Beacon',
                missing: 5,
                queued: 0,
                isTradeable: true,
                required: 5,
            },
        ]);
    });

    test('skips a category when no tier is currently selected', () => {
        fakeDataManager.characterData = { characterSetting: {}, characterInfo: {} };

        expect(calculateMissingSupplies()).toEqual([]);
    });

    test('clamps missing at 0 when owned already exceeds the cap', () => {
        fakeDataManager.characterData = {
            characterSetting: { labyrinthTorchHrid: '/items/expert_torch' },
            characterInfo: { labyrinthTorchCap: 100 },
        };
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 150 },
        ]);

        expect(calculateMissingSupplies()).toEqual([]);
    });

    test('ignores an enhanced stack of the same item hrid (torches are only ever +0)', () => {
        fakeDataManager.characterData = {
            characterSetting: { labyrinthTorchHrid: '/items/expert_torch' },
            characterInfo: { labyrinthTorchCap: 100 },
        };
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 1, count: 100 },
        ]);

        expect(calculateMissingSupplies()[0].missing).toBe(100);
    });
});

describe('injectButton', () => {
    function buildSuppliesSection() {
        const wrapper = document.createElement('div');
        wrapper.className = 'LabyrinthPanel_supplies__3n0yg';
        const label = document.createElement('div');
        label.className = 'LabyrinthPanel_label__2p7tI';
        label.textContent = 'Supplies';
        const grid = document.createElement('div');
        grid.className = 'LabyrinthPanel_suppliesGrid__30Vqz';
        wrapper.appendChild(label);
        wrapper.appendChild(grid);
        document.body.appendChild(wrapper);
        return { wrapper, grid, label };
    }

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('inserts the button immediately after the Supplies label', () => {
        const { wrapper, label } = buildSuppliesSection();
        injectButton(wrapper.querySelector('[class*="LabyrinthPanel_suppliesGrid"]'));

        expect(label.nextElementSibling.className).toBe('mwi-labyrinth-missing-supplies-button');
    });

    test('does not insert a second button on repeated calls for the same panel', () => {
        const { wrapper } = buildSuppliesSection();
        const grid = wrapper.querySelector('[class*="LabyrinthPanel_suppliesGrid"]');

        injectButton(grid);
        injectButton(grid);

        expect(wrapper.querySelectorAll('.mwi-labyrinth-missing-supplies-button')).toHaveLength(1);
    });

    test('does nothing when the Supplies label is not present', () => {
        const grid = document.createElement('div');
        grid.className = 'LabyrinthPanel_suppliesGrid__30Vqz';
        const wrapper = document.createElement('div');
        wrapper.appendChild(grid);
        document.body.appendChild(wrapper);

        injectButton(grid);

        expect(wrapper.querySelector('.mwi-labyrinth-missing-supplies-button')).toBeNull();
    });
});

describe('handleClick', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMarketplaceSession.isActive.mockReturnValue(true);
        mockMarketplaceSession.start.mockReturnValue(1);
        mockMarketplaceTabs.clickMarketplaceNavigationButton.mockReturnValue(true);
        mockMarketplaceTabs.navigateToMarketplace.mockReturnValue(true);
        mockMarketplaceTabs.isMarketplaceMarketListingsSelected.mockReturnValue(true);
        mockAutofillManager.arm.mockReturnValue(true);

        const referenceTab = document.createElement('button');
        referenceTab.textContent = 'My Listings';
        const tabsContainer = document.createElement('div');
        tabsContainer.appendChild(referenceTab);
        mockMarketplaceTabs.getVisibleMarketplaceTabContainer.mockReturnValue(tabsContainer);

        fakeDataManager.characterData = {
            characterSetting: { labyrinthTorchHrid: '/items/expert_torch' },
            characterInfo: { labyrinthTorchCap: 320 },
        };
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 44 },
        ]);
        fakeDataManager.getInitClientData.mockReturnValue({
            itemDetailMap: { '/items/expert_torch': { name: 'Expert Torch', isTradable: true } },
        });
    });

    test('navigates to the marketplace and arms the quantity for the first missing item', async () => {
        await handleClick();

        expect(mockMarketplaceTabs.clickMarketplaceNavigationButton).toHaveBeenCalled();
        expect(mockAutofillManager.arm).toHaveBeenCalledWith(
            expect.objectContaining({ itemHrid: '/items/expert_torch', modalMode: 'buy' })
        );
        expect(mockMarketplaceTabs.navigateToMarketplace).toHaveBeenCalledWith('/items/expert_torch', 0);
    });

    test('does not touch the marketplace when nothing is missing', async () => {
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 320 },
        ]);

        await handleClick();

        expect(mockMarketplaceTabs.clickMarketplaceNavigationButton).not.toHaveBeenCalled();
        expect(mockMarketplaceSession.start).not.toHaveBeenCalled();
    });
});

describe('inventory update while the marketplace tabs are open', () => {
    let tabsContainer;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMarketplaceSession.isActive.mockReturnValue(true);
        mockMarketplaceSession.start.mockReturnValue(1);
        mockMarketplaceTabs.clickMarketplaceNavigationButton.mockReturnValue(true);
        mockMarketplaceTabs.navigateToMarketplace.mockReturnValue(true);
        mockMarketplaceTabs.isMarketplaceMarketListingsSelected.mockReturnValue(true);
        mockAutofillManager.arm.mockReturnValue(true);

        const referenceTab = document.createElement('button');
        referenceTab.textContent = 'My Listings';
        tabsContainer = document.createElement('div');
        tabsContainer.appendChild(referenceTab);
        mockMarketplaceTabs.getVisibleMarketplaceTabContainer.mockReturnValue(tabsContainer);

        fakeDataManager.characterData = {
            characterSetting: { labyrinthTorchHrid: '/items/expert_torch' },
            characterInfo: { labyrinthTorchCap: 100 },
        };
        fakeDataManager.getInitClientData.mockReturnValue({
            itemDetailMap: { '/items/expert_torch': { name: 'Expert Torch', isTradable: true } },
        });
    });

    // Regression test: a purchase while the tabs stay open must repaint the visible "Missing: N"
    // badge text via updateTabBadge, not just update the data-missing-quantity attribute used
    // internally for the click-time guard and autofill quantity.
    test('repaints the visible badge text (not just the data attribute) after a purchase', async () => {
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 3 },
        ]);

        await handleClick();

        const tab = tabsContainer.querySelector('[data-item-hrid="/items/expert_torch"]');
        expect(tab.textContent).toContain('Missing: 97');

        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 60 },
        ]);
        fakeDataManager.emit('items_updated', {});

        expect(mockMarketplaceTabs.updateTabBadge).toHaveBeenCalled();
        expect(tab.textContent).toContain('Missing: 40');
        expect(tab.textContent).not.toContain('Missing: 97');
        expect(tab.getAttribute('data-missing-quantity')).toBe('40');
    });

    test('repaints to "Sufficient" once the purchase fully covers the cap', async () => {
        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 3 },
        ]);

        await handleClick();

        const tab = tabsContainer.querySelector('[data-item-hrid="/items/expert_torch"]');

        fakeDataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/expert_torch', enhancementLevel: 0, count: 100 },
        ]);
        fakeDataManager.emit('items_updated', {});

        expect(tab.textContent).toContain('Sufficient (100)');
        expect(tab.getAttribute('data-missing-quantity')).toBe('0');
    });
});
