// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockConfig,
    mockDataManager,
    mockOnClass,
    mockCreateMaterialTab,
    mockGetVisibleMarketplaceTabContainer,
    mockNavigateToMarketplace,
    mockClickMarketplaceNavigationButton,
    mockSetupMarketplaceCleanupObserver,
    race,
} = vi.hoisted(() => ({
    mockConfig: {
        getSetting: vi.fn(() => true),
        onSettingChange: vi.fn(),
    },
    mockDataManager: {
        getInventory: vi.fn(),
        getInitClientData: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
    mockOnClass: vi.fn(),
    mockCreateMaterialTab: vi.fn(),
    mockGetVisibleMarketplaceTabContainer: vi.fn(),
    mockNavigateToMarketplace: vi.fn(() => true),
    mockClickMarketplaceNavigationButton: vi.fn(() => true),
    mockSetupMarketplaceCleanupObserver: vi.fn(() => vi.fn()),
    // TLA-033: tracks cleanup-observer arm timing relative to navigateToMarketplace calls.
    race: { callOrder: [], marketListingsSelected: true, selectedAtObserverInstall: null, capturedOnTabsGone: null },
}));

vi.mock('../../core/config.js', () => ({ default: mockConfig }));
vi.mock('../../core/data-manager.js', () => ({ default: mockDataManager }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: mockOnClass } }));
vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: mockCreateMaterialTab,
    removeMaterialTabsForOwner: vi.fn(),
    setupMarketplaceCleanupObserver: vi.fn((opts) => {
        race.callOrder.push('setupMarketplaceCleanupObserver');
        race.selectedAtObserverInstall = race.marketListingsSelected;
        race.capturedOnTabsGone = opts.onTabsGone;
        return mockSetupMarketplaceCleanupObserver(opts);
    }),
    navigateToMarketplace: (...args) => {
        race.callOrder.push('navigateToMarketplace');
        return mockNavigateToMarketplace(...args);
    },
    getVisibleMarketplaceTabContainer: mockGetVisibleMarketplaceTabContainer,
    clickMarketplaceNavigationButton: mockClickMarketplaceNavigationButton,
    watchNativeTabExit: vi.fn(() => vi.fn()),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => race.marketListingsSelected),
}));

import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import sellQueue from './sell-queue.js';

function makeMarketplaceTabs() {
    const tabs = document.createElement('div');
    const listings = document.createElement('button');
    listings.textContent = 'Market Listings';
    const myListings = document.createElement('button');
    myListings.textContent = 'My Listings';
    tabs.append(listings, myListings);
    document.body.appendChild(tabs);
    return tabs;
}

function emitTooltip(tooltipHandler, itemHrid) {
    const tooltip = document.createElement('div');
    const link = document.createElement('a');
    link.href = `https://www.milkywayidle.com/items/${itemHrid.split('/').pop()}`;
    tooltip.appendChild(link);
    tooltipHandler(tooltip);
}

function shiftRightClick(target) {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true }));
}

describe('Sell Queue marketplace lifecycle', () => {
    let tooltipHandler;
    let marketTabs;
    let marketplaceVisible;
    let inventoryTarget;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        marketplaceSession.endAll();
        marketplaceVisible = false;
        marketTabs = makeMarketplaceTabs();
        inventoryTarget = document.createElement('button');
        const inventory = document.createElement('div');
        inventory.className = 'Inventory_items__test';
        inventory.appendChild(inventoryTarget);
        document.body.appendChild(inventory);

        mockConfig.getSetting.mockReturnValue(true);
        mockDataManager.getInventory.mockReturnValue([
            {
                itemHrid: '/items/cheese',
                itemLocationHrid: '/item_locations/inventory',
                count: 10,
            },
            {
                itemHrid: '/items/log',
                itemLocationHrid: '/item_locations/inventory',
                count: 20,
            },
        ]);
        mockDataManager.getInitClientData.mockReturnValue({
            itemDetailMap: {
                '/items/cheese': { name: 'Cheese', isTradable: true },
                '/items/log': { name: 'Log', isTradable: true },
            },
        });
        mockGetVisibleMarketplaceTabContainer.mockImplementation(() => (marketplaceVisible ? marketTabs : null));
        mockOnClass.mockImplementation((_id, _className, callback) => {
            tooltipHandler = callback;
            return vi.fn();
        });
        mockCreateMaterialTab.mockImplementation((material, _reference, _callback, owner) => {
            const tab = document.createElement('button');
            tab.setAttribute('data-mwi-custom-tab', 'true');
            tab.setAttribute('data-mwi-tab-owner', owner);
            tab.setAttribute('data-item-hrid', material.itemHrid);
            tab.innerHTML = '<span class="TabsComponent_badge__test"></span>';
            return tab;
        });
        mockCreateMaterialTab.mockClear();
        mockNavigateToMarketplace.mockClear();
        mockClickMarketplaceNavigationButton.mockClear();
        mockSetupMarketplaceCleanupObserver.mockClear();
        mockDataManager.on.mockClear();
        mockDataManager.off.mockClear();
        race.callOrder = [];
        race.marketListingsSelected = true;
        race.selectedAtObserverInstall = null;
        race.capturedOnTabsGone = null;

        sellQueue.initialize();
    });

    afterEach(() => {
        sellQueue.cleanup();
        marketplaceSession.endAll();
        vi.clearAllTimers();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    test('claims ownership even when Marketplace is already visible', async () => {
        const previousEnd = vi.fn();
        marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: previousEnd });
        marketplaceVisible = true;

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();

        expect(previousEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
        expect(mockCreateMaterialTab).toHaveBeenCalledTimes(1);
        expect(mockNavigateToMarketplace).toHaveBeenCalledWith('/items/cheese', 0);
    });

    test('rapid additions while Marketplace is already visible rebuild tabs from the live queue', async () => {
        marketplaceVisible = true;

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        emitTooltip(tooltipHandler, '/items/log');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const latestTwoMaterials = mockCreateMaterialTab.mock.calls.slice(-2).map(([material]) => material.itemHrid);
        expect(latestTwoMaterials).toEqual(['/items/cheese', '/items/log']);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
    });

    test('rapid additions share one pending Marketplace navigation without clearing the queue', async () => {
        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        emitTooltip(tooltipHandler, '/items/log');
        shiftRightClick(inventoryTarget);

        expect(mockClickMarketplaceNavigationButton).toHaveBeenCalledTimes(1);
        marketplaceVisible = true;
        await vi.advanceTimersByTimeAsync(300);
        await Promise.resolve();

        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
        const itemHrids = mockCreateMaterialTab.mock.calls.map(([material]) => material.itemHrid);
        expect(itemHrids).toContain('/items/cheese');
        expect(itemHrids).toContain('/items/log');
        expect(mockNavigateToMarketplace).toHaveBeenCalledWith('/items/cheese', 0);
        expect(mockNavigateToMarketplace).toHaveBeenCalledWith('/items/log', 0);
    });

    test('survives a retained "My Listings" native state and arms the observer only after its own navigation (TLA-033)', async () => {
        marketplaceVisible = true;
        race.marketListingsSelected = false; // retained "My Listings" at workflow start

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace', 'setupMarketplaceCleanupObserver']);
        expect(race.selectedAtObserverInstall).toBe(false);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
    });

    test('a genuine My Listings exit after activation still ends the session promptly (TLA-033)', async () => {
        marketplaceVisible = true;

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();

        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
        expect(race.capturedOnTabsGone).toBeTypeOf('function');

        race.marketListingsSelected = false;
        race.capturedOnTabsGone();

        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('rapid additions never install more than one cleanup observer (TLA-033)', async () => {
        marketplaceVisible = true;

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        emitTooltip(tooltipHandler, '/items/log');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(race.callOrder.filter((call) => call === 'setupMarketplaceCleanupObserver')).toHaveLength(1);
    });

    test('fail-closed: a failed first-item navigation ends the session and never arms the observer (TLA-033)', async () => {
        marketplaceVisible = true;
        mockNavigateToMarketplace.mockReturnValueOnce(false);

        emitTooltip(tooltipHandler, '/items/cheese');
        shiftRightClick(inventoryTarget);
        await Promise.resolve();
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace']);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});
