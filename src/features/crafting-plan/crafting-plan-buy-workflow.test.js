// @vitest-environment jsdom
/**
 * TLA-042 end-to-end: the real "Buy Missing Materials" click handler wired to the REAL
 * `computeBestCraftingPlan` and the REAL `computeInventoryAwareMissingMaterials`, using the exact
 * live Umbral Tunic fixture from the bug report. Only the data boundary (data-manager, market
 * data, marketplace UI plumbing) is mocked — this proves the fix reaches the user-visible
 * Marketplace tab/autofill quantities, not just the pure fulfillment function in isolation.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPrices = new Map();

const { mockDataManager, mockFindActionInput, mockCreateMaterialTab, mockUpdateTabBadge } = vi.hoisted(() => ({
    mockFindActionInput: vi.fn(),
    mockCreateMaterialTab: vi.fn((material, _referenceTab, _onClickCallback, owner) => {
        const tab = document.createElement('button');
        tab.setAttribute('data-mwi-custom-tab', 'true');
        tab.setAttribute('data-item-hrid', material.itemHrid);
        if (owner) tab.setAttribute('data-mwi-tab-owner', owner);
        tab.setAttribute('data-missing-quantity', String(material.missing));
        return tab;
    }),
    mockUpdateTabBadge: vi.fn(),
    mockDataManager: {
        getInitClientData: vi.fn(),
        getEquipment: vi.fn(() => new Map()),
        getActionDrinkSlots: vi.fn(() => []),
        getSkills: vi.fn(() => new Map()),
        getInventory: vi.fn(() => []),
        getItemDetails: vi.fn(),
        getActionDetails: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => key === 'actionPanel_bestCraftingPlan'),
        getSettingValue: vi.fn(() => 'ask'),
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

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => (mockPrices.has(itemHrid) ? mockPrices.get(itemHrid) : null)),
}));
vi.mock('../../utils/game-lookups.js', () => ({
    getShopCoinCost: vi.fn(() => 0),
    getActionHridFromName: vi.fn(() => '/actions/tailoring/umbral_tunic'),
}));
vi.mock('../../utils/action-calculator.js', () => ({ calculateActionStats: vi.fn(() => ({ actionTime: 1 })) }));
vi.mock('../../utils/efficiency.js', () => ({ calculateEfficiencyMultiplier: vi.fn(() => 1) }));
vi.mock('../../utils/experience-calculator.js', () => ({ calculateExpPerHour: vi.fn(() => null) }));

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
vi.mock('../../utils/action-panel-helper.js', () => ({ findActionInput: mockFindActionInput }));

function buildMockTabContainer() {
    const container = document.createElement('div');
    const myListings = document.createElement('button');
    myListings.textContent = 'My Listings';
    container.appendChild(myListings);
    document.body.appendChild(container);
    return container;
}

vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: mockCreateMaterialTab,
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(() => buildMockTabContainer()),
    setupMarketplaceCleanupObserver: vi.fn(() => vi.fn()),
    navigateToMarketplace: vi.fn(() => true),
    updateTabBadge: mockUpdateTabBadge,
    watchNativeTabExit: vi.fn(() => vi.fn()),
    clickMarketplaceNavigationButton: vi.fn(() => true),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => true),
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
vi.mock('../actions/production-tools-layout.js', () => ({ compactActionPanelSection: vi.fn((section) => section) }));

import craftingPlanDisplay from './crafting-plan-display.js';

const TUNIC = '/items/umbral_tunic';
const LEATHER = '/items/umbral_leather';
const HIDE = '/items/umbral_hide';
const BEAST_TUNIC = '/items/beast_tunic';
const TUNIC_ACTION = '/actions/tailoring/umbral_tunic';
const LEATHER_ACTION = '/actions/tailoring/umbral_leather';

function setInventory(counts) {
    mockDataManager.getInventory.mockReturnValue(
        Object.entries(counts).map(([itemHrid, count]) => ({
            itemHrid,
            count,
            itemLocationHrid: '/item_locations/inventory',
            enhancementLevel: 0,
        }))
    );
}

function buildActionPanel() {
    document.body.innerHTML = `
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_name_xyz">Umbral Tunic</div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_skillActionDetail_abc');
}

beforeEach(() => {
    vi.useFakeTimers();
    capturedPanelCallback = null;
    mockPrices.clear();
    marketplaceSession.endAll();

    const itemDetailMap = {
        [TUNIC]: { name: 'Umbral Tunic', isTradable: false },
        [LEATHER]: { name: 'Umbral Leather', isTradable: false },
        [HIDE]: { name: 'Umbral Hide', isTradable: true },
        [BEAST_TUNIC]: { name: 'Beast Tunic', isTradable: true },
    };
    const actionDetailMap = {
        [TUNIC_ACTION]: {
            type: '/action_types/tailoring',
            category: '/action_types/tailoring',
            outputItems: [{ itemHrid: TUNIC, count: 1 }],
            inputItems: [{ itemHrid: LEATHER, count: 144 }],
            upgradeItemHrid: BEAST_TUNIC,
        },
        [LEATHER_ACTION]: {
            type: '/action_types/tailoring',
            category: '/action_types/tailoring',
            outputItems: [{ itemHrid: LEATHER, count: 1 }],
            inputItems: [{ itemHrid: HIDE, count: 2 }],
            upgradeItemHrid: null,
        },
    };
    mockDataManager.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap });
    mockDataManager.getItemDetails.mockImplementation((itemHrid) => itemDetailMap[itemHrid] || null);
    mockDataManager.getActionDetails.mockImplementation((actionHrid) => actionDetailMap[actionHrid] || null);
    mockFindActionInput.mockReturnValue({ value: '1' });
    setInventory({ [LEATHER]: 136, [HIDE]: 1, [BEAST_TUNIC]: 1 });
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

describe('Crafting Plan — Buy Missing Materials end-to-end (TLA-042 CP-MM01/20/21)', () => {
    test('CP-MM01/CP-MM20: the live Umbral fixture creates a tab for 15 missing Hide, never 287', async () => {
        renderAndClickBuyButton();
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(mockCreateMaterialTab).toHaveBeenCalledTimes(1);
        const [material] = mockCreateMaterialTab.mock.calls[0];
        expect(material).toMatchObject({ itemHrid: HIDE, required: 16, missing: 15 });
        expect(material.missing).not.toBe(287);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
    });

    test('CP-MM21: buying some Hide converges the badge toward zero using the corrected required total', async () => {
        renderAndClickBuyButton();
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        // Player buys 10 Hide; inventory now has 11 total.
        setInventory({ [LEATHER]: 136, [HIDE]: 11, [BEAST_TUNIC]: 1 });
        const onHandler = mockDataManager.on.mock.calls.filter(([event]) => event === 'items_updated').at(-1)?.[1];
        expect(onHandler).toBeTypeOf('function');
        onHandler();

        expect(mockUpdateTabBadge).toHaveBeenCalled();
        const lastCall = mockUpdateTabBadge.mock.calls.at(-1);
        expect(lastCall[1]).toMatchObject({ itemHrid: HIDE, required: 16, missing: 5 });
    });
});
