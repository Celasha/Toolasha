// @vitest-environment jsdom
/**
 * TLA-033 regression: Buy Missing Materials must never arm the cleanup/exit observer until
 * its own navigation to the first missing material has been initiated. Models the reported
 * race: native Marketplace retained on "My Listings" at the moment the workflow starts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockDataManager, mockComputeBestCraftingPlan, mockFindActionInput, race } = vi.hoisted(() => ({
    mockComputeBestCraftingPlan: vi.fn(),
    mockFindActionInput: vi.fn(),
    race: {
        callOrder: [],
        marketListingsSelected: false,
        selectedAtObserverInstall: null,
        capturedOnTabsGone: null,
    },
    mockDataManager: {
        getInitClientData: vi.fn(),
        getSkills: vi.fn(() => new Map()),
        getEquipment: vi.fn(() => new Map()),
        getInventory: vi.fn(() => []),
        getItemDetails: vi.fn(() => ({ isTradable: true })),
        getActionDetails: vi.fn(() => ({ name: 'Craft Sword' })),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn(() => 'hybrid'),
        setSetting: vi.fn(),
        setSettingValue: vi.fn(),
    },
}));

let capturedPanelCallback = null;
vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_id, _className, callback) => {
            capturedPanelCallback = callback;
            return vi.fn();
        }),
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: mockDataManager }));

import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';

vi.mock('./crafting-plan-calculator.js', () => ({ computeBestCraftingPlan: mockComputeBestCraftingPlan }));
vi.mock('../../utils/ui-components.js', () => ({
    createCollapsibleSection: vi.fn((_a, _b, _c, content) => {
        const section = document.createElement('div');
        section.appendChild(content);
        return section;
    }),
}));
vi.mock('../../utils/formatters.js', () => ({
    formatKMB: vi.fn((v) => String(v)),
    formatWithSeparator: vi.fn((v) => String(v)),
    timeReadable: vi.fn((v) => `${v}s`),
}));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn(() => '/actions/crafting/sword') }));
vi.mock('../../utils/action-panel-helper.js', () => ({ findActionInput: mockFindActionInput }));

function buildMockTabContainer() {
    const container = document.createElement('div');
    const myListings = document.createElement('button');
    myListings.textContent = 'My Listings';
    container.appendChild(myListings);
    return container;
}

vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: vi.fn(() => document.createElement('button')),
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(() => buildMockTabContainer()),
    setupMarketplaceCleanupObserver: vi.fn((opts) => {
        race.callOrder.push('setupMarketplaceCleanupObserver');
        race.selectedAtObserverInstall = race.marketListingsSelected;
        race.capturedOnTabsGone = opts.onTabsGone;
        return vi.fn();
    }),
    navigateToMarketplace: vi.fn(() => {
        race.callOrder.push('navigateToMarketplace');
        race.marketListingsSelected = true;
        return true;
    }),
    updateTabBadge: vi.fn(),
    watchNativeTabExit: vi.fn(() => vi.fn()),
    clickMarketplaceNavigationButton: vi.fn(() => true),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => race.marketListingsSelected),
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: vi.fn(() => ({
        initialize: vi.fn(),
        startSession: vi.fn(),
        arm: vi.fn(() => true),
        exitSession: vi.fn(),
        cleanup: vi.fn(),
    })),
}));
vi.mock('../../utils/action-calculator.js', () => ({ calculateActionStats: vi.fn(() => ({ actionTime: 1 })) }));
vi.mock('../../utils/efficiency.js', () => ({ calculateEfficiencyMultiplier: vi.fn(() => 1) }));
vi.mock('../../utils/experience-calculator.js', () => ({ calculateExpPerHour: vi.fn(() => null) }));
vi.mock('../actions/production-tools-layout.js', () => ({ compactActionPanelSection: vi.fn((section) => section) }));

import craftingPlanDisplay from './crafting-plan-display.js';

function buildActionPanel() {
    document.body.innerHTML = `
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_name_xyz">Craft Sword</div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_skillActionDetail_abc');
}

beforeEach(() => {
    vi.useFakeTimers();
    capturedPanelCallback = null;
    race.callOrder = [];
    race.marketListingsSelected = false; // retained "My Listings" at workflow start
    race.selectedAtObserverInstall = null;
    race.capturedOnTabsGone = null;
    marketplaceSession.endAll();

    mockDataManager.getInitClientData.mockReturnValue({
        actionDetailMap: {
            '/actions/crafting/sword': {
                type: '/action_types/crafting',
                outputItems: [{ itemHrid: '/items/sword', count: 1 }],
            },
        },
        itemDetailMap: {},
    });
    mockFindActionInput.mockReturnValue({ value: '5' });
    mockComputeBestCraftingPlan.mockReturnValue({
        strategy: 'craft',
        craftCost: 100,
        buyPrice: 200,
        unitCost: 100,
        children: [
            {
                strategy: 'buy',
                itemHrid: '/items/mat',
                itemName: 'Mat',
                quantity: 5,
                unitCost: 10,
                totalCost: 50,
                children: [],
            },
        ],
    });
});

afterEach(() => {
    craftingPlanDisplay.disable();
    marketplaceSession.endAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function renderAndClickBuyButton() {
    const panel = buildActionPanel();
    craftingPlanDisplay.initialize();
    capturedPanelCallback();

    const buyButton = Array.from(panel.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Buy Missing Materials'
    );
    buyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return buyButton;
}

describe('Crafting Plan — Buy Missing Materials initialization/cleanup race (TLA-033)', () => {
    test('survives a retained "My Listings" native state and arms the observer only after its own navigation', async () => {
        renderAndClickBuyButton();

        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace', 'setupMarketplaceCleanupObserver']);
        expect(race.selectedAtObserverInstall).toBe(true);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
    });

    test('a genuine My Listings exit after activation still ends the session promptly', async () => {
        renderAndClickBuyButton();
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
        expect(race.capturedOnTabsGone).toBeTypeOf('function');

        race.marketListingsSelected = false;
        race.capturedOnTabsGone();

        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('fail-closed: a failed navigation ends the session and never arms the observer', async () => {
        const marketplaceTabs = await import('../../utils/marketplace-tabs.js');
        marketplaceTabs.navigateToMarketplace.mockImplementationOnce(() => {
            race.callOrder.push('navigateToMarketplace');
            return false;
        });

        renderAndClickBuyButton();
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace']);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});
