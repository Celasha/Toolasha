// @vitest-environment jsdom
/**
 * TLA-033 regression: the cleanup/exit observer for Production and Enhancing Missing Mats
 * must never be armed until this workflow's own initial navigation to the first missing
 * material has been initiated. Models the reported race: native Marketplace retained on
 * "My Listings" at the moment the workflow starts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeDataManager, mockCalculateMaterialRequirements, mockCalculateEnhancementMaterialRequirements, race } =
    vi.hoisted(() => {
        const listeners = new Map();
        return {
            mockCalculateMaterialRequirements: vi.fn(),
            mockCalculateEnhancementMaterialRequirements: vi.fn(),
            race: {
                callOrder: [],
                marketListingsSelected: false,
                selectedAtObserverInstall: null,
                capturedOnTabsGone: null,
            },
            fakeDataManager: {
                on: (event, handler) => {
                    if (!listeners.has(event)) listeners.set(event, new Set());
                    listeners.get(event).add(handler);
                },
                off: (event, handler) => {
                    listeners.get(event)?.delete(handler);
                },
                getInitClientData: vi.fn(),
                getCurrentActions: vi.fn(() => []),
                getInventory: vi.fn(() => []),
                getActionDetails: vi.fn(),
                getItemDetails: vi.fn(() => ({ name: 'Item' })),
                getCurrentCharacterId: vi.fn(() => 'char-1'),
            },
        };
    });

vi.mock('../../core/data-manager.js', () => ({ default: fakeDataManager }));
vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn((key) => key !== 'actions_missingMaterialsButton_ignoreQueue') },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));

// The real MarketplaceSessionService — no external deps, exercised genuinely so
// session-active/end semantics are real, not mocked.
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';

vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: mockCalculateMaterialRequirements,
    calculateEnhancementMaterialRequirements: mockCalculateEnhancementMaterialRequirements,
}));
vi.mock('../../utils/formatters.js', () => ({ formatWithSeparator: vi.fn((n) => String(n)) }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({ registerTimeout: vi.fn(), clearAll: vi.fn() }),
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: () => ({
        initialize: vi.fn(),
        cleanup: vi.fn(),
        startSession: vi.fn(),
        arm: vi.fn(() => true),
        exitSession: vi.fn(),
    }),
    getReactFiberFromElement: vi.fn(() => null),
}));

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
        // Models a successful native navigation: the native tablist will (eventually)
        // reflect Market Listings as selected.
        race.marketListingsSelected = true;
        return true;
    }),
    watchNativeTabExit: vi.fn(() => vi.fn()),
    isElementActuallyVisible: vi.fn(() => true),
    clickMarketplaceNavigationButton: vi.fn(() => true),
    updateTabBadge: vi.fn(),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => race.marketListingsSelected),
}));
vi.mock('./enhancement-display.js', () => ({
    getProtectionItemFromUI: vi.fn(() => null),
    getProtectFromLevelFromUI: vi.fn(() => 0),
}));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn(() => null) }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => ({})) }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn(() => '/actions/crafting/sword') }));
vi.mock('./production-tools-layout.js', () => ({
    getOrCreateProductionToolsBlock: vi.fn(() => null),
    normalizeProductionToolsBlock: vi.fn(),
}));

import missingMaterialsButton from './missing-materials-button.js';

function buildProductionPanel(inputValue) {
    document.body.innerHTML = `
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_name_xyz">Craft Sword</div>
            <div class="maxActionCountInput_123"><input value="${inputValue}" /></div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_skillActionDetail_abc');
}

function buildEnhancingPanel(itemHrid, targetLevel) {
    document.body.innerHTML = `
        <div class="SkillActionDetail_enhancingComponent_abc">
            <div>
                <span>Target Level</span>
                <input type="number" value="${targetLevel}" />
            </div>
        </div>
    `;
    const panel = document.querySelector('.SkillActionDetail_enhancingComponent_abc');
    panel.dataset.mwiItemHrid = itemHrid;
    return panel;
}

beforeEach(() => {
    vi.useFakeTimers();
    race.callOrder = [];
    race.marketListingsSelected = false; // retained "My Listings" at workflow start
    race.selectedAtObserverInstall = null;
    race.capturedOnTabsGone = null;
    marketplaceSession.endAll();
    fakeDataManager.getInitClientData.mockReturnValue({
        actionDetailMap: {
            '/actions/crafting/sword': {
                type: '/action_types/crafting',
                inputItems: [{ itemHrid: '/items/log', count: 1 }],
            },
        },
    });
});

afterEach(() => {
    missingMaterialsButton.cleanup();
    marketplaceSession.endAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('Production Missing Mats — initialization/cleanup race (TLA-033)', () => {
    test('survives a retained "My Listings" native state and arms the observer only after its own navigation', async () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', itemName: 'Log', isTradeable: true, missing: 10, required: 10 },
        ]);

        buildProductionPanel('5');
        missingMaterialsButton.initialize();

        const button = document.querySelector('#mwi-missing-mats-button');
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace', 'setupMarketplaceCleanupObserver']);
        expect(race.selectedAtObserverInstall).toBe(true);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.ACTIONS);
    });

    test('a genuine My Listings exit after activation still ends the session promptly', async () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', itemName: 'Log', isTradeable: true, missing: 10, required: 10 },
        ]);

        buildProductionPanel('5');
        missingMaterialsButton.initialize();
        document.querySelector('#mwi-missing-mats-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.ACTIONS);
        expect(race.capturedOnTabsGone).toBeTypeOf('function');

        // User genuinely switches back to native My Listings.
        race.marketListingsSelected = false;
        race.capturedOnTabsGone();

        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('fail-closed: a failed navigation ends the session and never arms the observer', async () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', itemName: 'Log', isTradeable: true, missing: 10, required: 10 },
        ]);
        const marketplaceTabs = await import('../../utils/marketplace-tabs.js');
        marketplaceTabs.navigateToMarketplace.mockImplementationOnce(() => {
            race.callOrder.push('navigateToMarketplace');
            return false;
        });

        buildProductionPanel('5');
        missingMaterialsButton.initialize();
        document.querySelector('#mwi-missing-mats-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace']);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});

describe('Enhancing Missing Mats — initialization/cleanup race (TLA-033)', () => {
    test('survives a retained "My Listings" native state and arms the observer only after its own navigation', async () => {
        mockCalculateEnhancementMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/enh_mat', itemName: 'Enh Mat', isTradeable: true, missing: 3, required: 3 },
        ]);

        buildEnhancingPanel('/items/sword', 5);
        missingMaterialsButton.initialize();
        await vi.advanceTimersByTimeAsync(0);

        const button = document.querySelector('#mwi-missing-mats-button');
        expect(button).toBeTruthy();
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(race.callOrder).toEqual(['navigateToMarketplace', 'setupMarketplaceCleanupObserver']);
        expect(race.selectedAtObserverInstall).toBe(true);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.ACTIONS);
    });

    test('a genuine My Listings exit after activation still ends the session promptly', async () => {
        mockCalculateEnhancementMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/enh_mat', itemName: 'Enh Mat', isTradeable: true, missing: 3, required: 3 },
        ]);

        buildEnhancingPanel('/items/sword', 5);
        missingMaterialsButton.initialize();
        await vi.advanceTimersByTimeAsync(0);

        document
            .querySelector('#mwi-missing-mats-button')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.ACTIONS);
        race.marketListingsSelected = false;
        race.capturedOnTabsGone();

        expect(marketplaceSession.getActive()).toBeNull();
    });
});
