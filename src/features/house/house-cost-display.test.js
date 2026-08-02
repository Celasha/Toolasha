// @vitest-environment jsdom
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be initialised before vi.mock factories run
// ---------------------------------------------------------------------------

const {
    mockArm,
    mockExitSession,
    mockAutofillManager,
    mockIsActive,
    mockEnd,
    mockStart,
    mockRemoveMaterialTabsForOwner,
    mockNavigateToMarketplace,
    mockGetVisibleTabContainer,
    mockSetupCleanupObserver,
    mockWatchNativeTabExit,
    mockCreateMaterialTab,
    capturedCallbacksRef,
    capturedNativeExitRef,
} = vi.hoisted(() => {
    const capturedCallbacksRef = { current: [] };
    const capturedNativeExitRef = { current: null };

    const mockNativeTabExitCleanup = vi.fn();
    const mockWatchNativeTabExit = vi.fn((container, onExit) => {
        capturedNativeExitRef.current = onExit;
        return mockNativeTabExitCleanup;
    });

    const mockCreateMaterialTab = vi.fn((material, _ref, callback) => {
        const tab = document.createElement('button');
        tab.setAttribute('data-mwi-custom-tab', 'true');
        tab.setAttribute('data-item-hrid', material.itemHrid ?? '');
        tab.setAttribute('data-missing-quantity', String(material.missing ?? 0));
        tab.textContent = material.itemName ?? '';
        tab._simulateClick = (mat) => callback(new MouseEvent('click'), mat ?? material);
        capturedCallbacksRef.current.push({ material, callback, tab });
        return tab;
    });

    const mockArm = vi.fn();
    const mockExitSession = vi.fn();
    const mockAutofillManager = {
        initialize: vi.fn(),
        arm: mockArm,
        exitSession: mockExitSession,
        startSession: vi.fn(),
        cleanup: vi.fn(),
    };

    const mockIsActive = vi.fn();
    const mockEnd = vi.fn();
    const mockStart = vi.fn();
    const mockRemoveMaterialTabsForOwner = vi.fn();
    const mockNavigateToMarketplace = vi.fn();
    const mockGetVisibleTabContainer = vi.fn();
    const mockSetupCleanupObserver = vi.fn(() => vi.fn());

    return {
        mockArm,
        mockExitSession,
        mockAutofillManager,
        mockIsActive,
        mockEnd,
        mockStart,
        mockRemoveMaterialTabsForOwner,
        mockNavigateToMarketplace,
        mockGetVisibleTabContainer,
        mockSetupCleanupObserver,
        mockWatchNativeTabExit,
        mockCreateMaterialTab,
        capturedCallbacksRef,
        capturedNativeExitRef,
    };
});

// ---------------------------------------------------------------------------
// vi.mock factories
// ---------------------------------------------------------------------------

vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: vi.fn(() => mockAutofillManager),
}));

vi.mock('../../core/marketplace-session.js', () => ({
    MARKETPLACE_OWNER: {
        HOUSE: 'HOUSE',
        ACTIONS: 'ACTIONS',
        CRAFTING_PLAN: 'CRAFTING_PLAN',
        GUILD: 'GUILD',
        ABILITY_BOOK: 'ABILITY_BOOK',
        SELL_QUEUE: 'SELL_QUEUE',
    },
    marketplaceSession: {
        start: mockStart,
        end: mockEnd,
        isActive: mockIsActive,
        getActive: vi.fn(),
        consume: vi.fn(),
        endAll: vi.fn(),
        clearAllMarketplaceUI: vi.fn(),
    },
}));

vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: mockCreateMaterialTab,
    removeMaterialTabsForOwner: mockRemoveMaterialTabsForOwner,
    watchNativeTabExit: mockWatchNativeTabExit,
    navigateToMarketplace: mockNavigateToMarketplace,
    getVisibleMarketplaceTabContainer: mockGetVisibleTabContainer,
    setupMarketplaceCleanupObserver: mockSetupCleanupObserver,
    updateTabBadge: vi.fn(),
    removeMaterialTabs: vi.fn(),
}));

vi.mock('./house-cost-calculator.js', () => ({
    default: {
        initialize: vi.fn(),
        getCurrentRoomLevel: vi.fn(() => 3),
        getInventoryCount: vi.fn(() => 0),
        getItemName: vi.fn(() => 'Test Item'),
        calculateCumulativeCost: vi.fn(async () => ({ coins: 0, materials: [], totalValue: 0 })),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getInitClientData: vi.fn(() => ({ houseRoomDetailMap: {}, itemDetailMap: {}, actionDetailMap: {} })),
        getInventory: vi.fn(() => []),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        onSettingChange: vi.fn(),
        COLOR_ACCENT: '#5b8def',
        COLOR_TEXT_SECONDARY: '#888',
        COLOR_BORDER: '#444',
        SCRIPT_COLOR_MAIN: '#fff',
        COLOR_TEXT: '#fff',
    },
}));

vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({
        registerTimeout: vi.fn((t) => t),
        registerInterval: vi.fn((i) => i),
        clearAll: vi.fn(),
    }),
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('../../utils/formatters.js', () => ({
    coinFormatter: vi.fn((n) => String(n)),
    formatWithSeparator: vi.fn((n) => String(n)),
}));

import houseCostDisplay from './house-cost-display.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTabsContainer(texts = ['My Listings']) {
    const panel = document.createElement('div');
    panel.className = 'MarketplacePanel_marketplacePanel__test';

    const container = document.createElement('div');
    container.className = 'MuiTabs-flexContainer';
    container.setAttribute('role', 'tablist');
    for (const text of texts) {
        const btn = document.createElement('button');
        btn.textContent = text;
        container.appendChild(btn);
    }

    panel.appendChild(container);
    document.body.appendChild(panel);
    return container;
}

function makeMaterial(overrides = {}) {
    return { itemHrid: '/items/wood', itemName: 'Wood', missing: 10, isTradeable: true, ...overrides };
}

function makeHouseComponent(overrides = {}) {
    const component = {
        handleHouseRoomClicked: vi.fn(),
        handleCloseModal: vi.fn(),
        state: { selectedHouseRoomHrid: '/house_rooms/library' },
        ...overrides,
    };
    component.handleCloseModal.mockImplementation(() => {
        component.state.selectedHouseRoomHrid = null;
    });
    return component;
}

function makeMarketplaceComponent() {
    return { handleCloseMarketplaceModal: vi.fn() };
}

function resetInstanceState() {
    houseCostDisplay._houseSessionId = null;
    houseCostDisplay._nativeTabExitCleanup = null;
    houseCostDisplay._houseReturnGeneration = 0;
    houseCostDisplay.activeWorkflowModel = null;
    houseCostDisplay.currentMaterialsTabs = [];
    houseCostDisplay.cleanupObserver = null;
    houseCostDisplay._cumulativeState = null;
    houseCostDisplay._costContext = null;
}

function makeConnectedDropdown(values = ['4', '5', '6']) {
    const dropdown = document.createElement('select');
    for (const val of values) {
        const opt = document.createElement('option');
        opt.value = val;
        dropdown.appendChild(opt);
    }
    document.body.appendChild(dropdown);
    return dropdown;
}

function makeConnectedCostContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HouseCostDisplay — Section 3 Rev2 correction', () => {
    beforeEach(() => {
        capturedCallbacksRef.current = [];
        capturedNativeExitRef.current = null;
        vi.clearAllMocks();
        mockArm.mockReturnValue(true);
        mockIsActive.mockReturnValue(true);
        mockStart.mockReturnValue(1);
        resetInstanceState();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // =========================================================================
    // exitHouseMarketplaceSession
    // =========================================================================

    describe('exitHouseMarketplaceSession', () => {
        it('calls marketplaceSession.end with the captured ID', () => {
            houseCostDisplay.exitHouseMarketplaceSession(42);
            expect(mockEnd).toHaveBeenCalledWith(42);
        });

        it('returns false and does not call end when ID is null', () => {
            const result = houseCostDisplay.exitHouseMarketplaceSession(null);
            expect(result).toBe(false);
            expect(mockEnd).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // teardownHouseMarketplaceSession
    // =========================================================================

    describe('teardownHouseMarketplaceSession', () => {
        it('increments _houseReturnGeneration to invalidate in-flight Returns', () => {
            houseCostDisplay._houseReturnGeneration = 3;
            houseCostDisplay.teardownHouseMarketplaceSession();
            expect(houseCostDisplay._houseReturnGeneration).toBe(4);
        });

        it('captures sessionIdToDisarm from _houseSessionId before nulling it', () => {
            houseCostDisplay._houseSessionId = 7;
            houseCostDisplay.activeWorkflowModel = null;
            houseCostDisplay.teardownHouseMarketplaceSession();
            expect(mockExitSession).toHaveBeenCalledWith(7);
            expect(houseCostDisplay._houseSessionId).toBeNull();
        });

        it('calls and clears _nativeTabExitCleanup', () => {
            const cleanup = vi.fn();
            houseCostDisplay._nativeTabExitCleanup = cleanup;
            houseCostDisplay._houseSessionId = 1;
            houseCostDisplay.teardownHouseMarketplaceSession();
            expect(cleanup).toHaveBeenCalledOnce();
            expect(houseCostDisplay._nativeTabExitCleanup).toBeNull();
        });

        it('does not call marketplaceSession.end — it IS the onEnd handler', () => {
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.teardownHouseMarketplaceSession();
            expect(mockEnd).not.toHaveBeenCalled();
        });

        it('falls back to activeWorkflowModel.sessionId when _houseSessionId is null', () => {
            houseCostDisplay._houseSessionId = null;
            houseCostDisplay.activeWorkflowModel = { sessionId: 99 };
            houseCostDisplay.teardownHouseMarketplaceSession();
            expect(mockExitSession).toHaveBeenCalledWith(99);
        });
    });

    // =========================================================================
    // _getMarketplaceComponent
    // =========================================================================

    describe('_getMarketplaceComponent', () => {
        it('returns null when zero connected panels exist', () => {
            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });

        it('returns null when multiple connected panels exist', () => {
            for (let i = 0; i < 2; i++) {
                const p = document.createElement('div');
                p.className = 'MarketplacePanel_marketplacePanel__x';
                document.body.appendChild(p);
            }
            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });

        it('returns null when panel has no React fiber key', () => {
            const p = document.createElement('div');
            p.className = 'MarketplacePanel_marketplacePanel__x';
            document.body.appendChild(p);
            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });

        it('returns null when ancestor walk finds multiple matching components', () => {
            const p = document.createElement('div');
            p.className = 'MarketplacePanel_marketplacePanel__x';
            document.body.appendChild(p);
            const comp1 = { handleCloseMarketplaceModal: vi.fn() };
            const comp2 = { handleCloseMarketplaceModal: vi.fn() };
            const fiber2 = { stateNode: comp2, return: null };
            const fiber1 = { stateNode: comp1, return: fiber2 };
            p['__reactFiber$abc'] = fiber1;
            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });

        it('returns the component when exactly one connected panel and one fiber ancestor match', () => {
            const p = document.createElement('div');
            p.className = 'MarketplacePanel_marketplacePanel__x';
            document.body.appendChild(p);
            const comp = { handleCloseMarketplaceModal: vi.fn() };
            const fiber = { stateNode: comp, return: null };
            p['__reactFiber$abc'] = fiber;
            expect(houseCostDisplay._getMarketplaceComponent()).toBe(comp);
        });

        it('rejects a connected but hidden Marketplace panel', () => {
            const p = document.createElement('div');
            p.className = 'MarketplacePanel_marketplacePanel__x';
            p.style.display = 'none';
            document.body.appendChild(p);
            const comp = { handleCloseMarketplaceModal: vi.fn() };
            p['__reactFiber$abc'] = { stateNode: comp, return: null };

            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });

        it('ignores a hidden stale panel when exactly one visible panel exists', () => {
            const hidden = document.createElement('div');
            hidden.className = 'MarketplacePanel_marketplacePanel__stale';
            hidden.style.display = 'none';
            hidden['__reactFiber$stale'] = {
                stateNode: { handleCloseMarketplaceModal: vi.fn() },
                return: null,
            };
            document.body.appendChild(hidden);

            const visible = document.createElement('div');
            visible.className = 'MarketplacePanel_marketplacePanel__current';
            const current = { handleCloseMarketplaceModal: vi.fn() };
            visible['__reactFiber$current'] = { stateNode: current, return: null };
            document.body.appendChild(visible);

            expect(houseCostDisplay._getMarketplaceComponent()).toBe(current);
        });

        it('fails closed when Marketplace ancestry exceeds the 64-fiber budget', () => {
            const p = document.createElement('div');
            p.className = 'MarketplacePanel_marketplacePanel__x';
            document.body.appendChild(p);

            const comp = { handleCloseMarketplaceModal: vi.fn() };
            let fiber = { stateNode: comp, return: null };
            const first = fiber;
            for (let i = 0; i < 64; i++) {
                fiber.return = { stateNode: null, return: null };
                fiber = fiber.return;
            }
            p['__reactFiber$abc'] = first;

            expect(houseCostDisplay._getMarketplaceComponent()).toBeNull();
        });
    });

    // =========================================================================
    // _getHouseComponent
    // =========================================================================

    describe('_getHouseComponent', () => {
        function makePanelWithFiber(component, ancestorDepth = 0) {
            const el = document.createElement('div');
            el.className = 'HousePanel_something__test';
            document.body.appendChild(el);

            // Build the fiber chain: panel fiber → (depth intermediate fibers) → component fiber
            const componentFiber = { stateNode: component, return: null };
            let chain = componentFiber;
            for (let i = 0; i < ancestorDepth; i++) {
                chain = { stateNode: null, return: chain };
            }
            el['__reactFiber$test'] = chain;
            return el;
        }

        it('returns null when no [class*="HousePanel_"] element is visible', () => {
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
        });

        it('returns null when no candidate has the full behavioral signature', () => {
            const partial = { handleHouseRoomClicked: vi.fn() }; // missing handleCloseModal, state
            const el = makePanelWithFiber(partial);
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el.remove();
        });

        it('returns null when handleCloseModal is missing', () => {
            const node = {
                handleHouseRoomClicked: vi.fn(),
                state: { selectedHouseRoomHrid: '/house_rooms/a' },
                // no handleCloseModal
            };
            const el = makePanelWithFiber(node);
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el.remove();
        });

        it('returns null when state.selectedHouseRoomHrid is absent', () => {
            const node = {
                handleHouseRoomClicked: vi.fn(),
                handleCloseModal: vi.fn(),
                state: { otherProp: true }, // no selectedHouseRoomHrid
            };
            const el = makePanelWithFiber(node);
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el.remove();
        });

        it('returns null when multiple candidates have the full signature', () => {
            const el1 = makePanelWithFiber(makeHouseComponent({ state: { selectedHouseRoomHrid: null } }));
            const el2 = makePanelWithFiber(makeHouseComponent({ state: { selectedHouseRoomHrid: null } }));
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el1.remove();
            el2.remove();
        });

        it('returns the component when exactly one candidate matches full signature', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = makePanelWithFiber(node);
            expect(houseCostDisplay._getHouseComponent()).toBe(node);
            el.remove();
        });

        it('resolves when component is found via return ancestry (not at panel fiber directly)', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = makePanelWithFiber(node, 5); // 5 intermediate fibers
            expect(houseCostDisplay._getHouseComponent()).toBe(node);
            el.remove();
        });

        it('returns null when room filter finds no matching room', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/kitchen' } });
            const el = makePanelWithFiber(node);
            expect(houseCostDisplay._getHouseComponent('/house_rooms/library')).toBeNull();
            el.remove();
        });

        it('returns component when room filter matches exactly one candidate', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/library' } });
            const el = makePanelWithFiber(node);
            expect(houseCostDisplay._getHouseComponent('/house_rooms/library')).toBe(node);
            el.remove();
        });

        it('resolves correctly in a fixture with more than 2000 unrelated fiber ancestors', () => {
            // The old DFS approach would fail at 2000 nodes — the new anchor approach is unaffected
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = document.createElement('div');
            el.className = 'HousePanel_something__test';
            document.body.appendChild(el);

            // Build a very long .return chain (2100 nodes) with the component at the end
            const componentFiber = { stateNode: node, return: null };
            let chain = componentFiber;
            for (let i = 0; i < 2100; i++) {
                chain = { stateNode: null, return: chain };
            }
            // Depth limit is 64, so this chain exceeds the depth limit and component won't be found
            // (This verifies that depth limit works as expected — long chains are truncated)
            el['__reactFiber$test'] = chain;
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el.remove();
        });

        it('resolves when component is within the 64-ancestor depth limit', () => {
            // Component at exactly depth 63 (within limit)
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = makePanelWithFiber(node, 63);
            expect(houseCostDisplay._getHouseComponent()).toBe(node);
            el.remove();
        });

        it('fails closed when panel element is hidden (not visible)', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = makePanelWithFiber(node);
            el.style.display = 'none';
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
            el.remove();
        });

        it('fails closed when panel element is detached from document', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const el = document.createElement('div');
            el.className = 'HousePanel_something__test';
            // Not appended to document.body — detached
            const fiber = { stateNode: node, return: null };
            el['__reactFiber$test'] = fiber;
            // Detached element is not visible (_isElementActuallyVisible checks isConnected)
            expect(houseCostDisplay._getHouseComponent()).toBeNull();
        });

        it('deduplicates the same component reached via multiple HousePanel_ elements', () => {
            const node = makeHouseComponent({ state: { selectedHouseRoomHrid: null } });
            const componentFiber = { stateNode: node, return: null };

            const el1 = document.createElement('div');
            el1.className = 'HousePanel_a__test';
            el1['__reactFiber$test'] = { stateNode: null, return: componentFiber };
            document.body.appendChild(el1);

            const el2 = document.createElement('div');
            el2.className = 'HousePanel_b__test';
            el2['__reactFiber$test'] = { stateNode: null, return: componentFiber };
            document.body.appendChild(el2);

            // Same component reached from two panels — deduplicated → exactly one candidate
            expect(houseCostDisplay._getHouseComponent()).toBe(node);
            el1.remove();
            el2.remove();
        });
    });

    // =========================================================================
    // createMissingMaterialTabs — session capture and lifecycle
    // =========================================================================

    describe('createMissingMaterialTabs', () => {
        it('captures session token before watchNativeTabExit — stale listener cannot end newer session', () => {
            makeTabsContainer();
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = { sessionId: 5, materials: [], returnContext: null };

            houseCostDisplay.createMissingMaterialTabs([]);

            // Simulate session rotating to a new one
            houseCostDisplay._houseSessionId = 99;

            // Fire the captured old listener
            capturedNativeExitRef.current();

            // Must have called end with 5 (the captured ID), NOT 99
            expect(mockEnd).toHaveBeenCalledWith(5);
            expect(mockEnd).not.toHaveBeenCalledWith(99);
        });

        it('native-tab exit callback calls marketplaceSession.end (not just exitSession)', () => {
            makeTabsContainer();
            houseCostDisplay._houseSessionId = 7;
            houseCostDisplay.activeWorkflowModel = { sessionId: 7, materials: [], returnContext: null };

            houseCostDisplay.createMissingMaterialTabs([]);
            capturedNativeExitRef.current();

            expect(mockEnd).toHaveBeenCalledWith(7);
        });

        it('cleans up previous _nativeTabExitCleanup before installing a new one', () => {
            const previous = vi.fn();
            houseCostDisplay._nativeTabExitCleanup = previous;
            makeTabsContainer();
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = { sessionId: 5, materials: [], returnContext: null };

            houseCostDisplay.createMissingMaterialTabs([]);

            expect(previous).toHaveBeenCalledOnce();
        });

        it('arm() uses model-based quantity provider that reads from activeWorkflowModel', () => {
            makeTabsContainer();
            const mat = makeMaterial({ missing: 42 });
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 5,
                materials: [{ ...mat, missing: 42 }],
                returnContext: null,
            };

            houseCostDisplay.createMissingMaterialTabs([mat]);
            capturedCallbacksRef.current[0].callback(new MouseEvent('click'), mat);

            const provider = mockArm.mock.calls[0][0].quantityProvider;
            expect(provider()).toBe(42);
        });

        it('model-based provider returns 0 when sessionId does not match', () => {
            makeTabsContainer();
            const mat = makeMaterial({ missing: 10 });
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 5,
                materials: [{ ...mat, missing: 10 }],
                returnContext: null,
            };

            houseCostDisplay.createMissingMaterialTabs([mat]);
            capturedCallbacksRef.current[0].callback(new MouseEvent('click'), mat);

            // Rotate session
            houseCostDisplay.activeWorkflowModel = { sessionId: 99, materials: [] };
            const provider = mockArm.mock.calls[0][0].quantityProvider;
            expect(provider()).toBe(0);
        });

        it('provider returns updated missing quantity after model update', () => {
            makeTabsContainer();
            const mat = makeMaterial({ missing: 10 });
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 5,
                materials: [{ ...mat, missing: 10 }],
                returnContext: null,
            };

            houseCostDisplay.createMissingMaterialTabs([mat]);
            capturedCallbacksRef.current[0].callback(new MouseEvent('click'), mat);

            // Inventory update reduces missing
            houseCostDisplay.activeWorkflowModel.materials = [{ ...mat, missing: 3 }];
            const provider = mockArm.mock.calls[0][0].quantityProvider;
            expect(provider()).toBe(3);
        });

        it('Return tab is a dedicated cloneNode, not a createMaterialTab call', () => {
            makeTabsContainer();
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 5,
                materials: [],
                returnContext: Object.freeze({
                    houseRoomHrid: '/house_rooms/library',
                    currentLevel: 3,
                    targetLevel: 5,
                    sessionId: 5,
                }),
            };

            houseCostDisplay.createMissingMaterialTabs([]);

            // createMaterialTab should NOT have been called for Return
            expect(mockCreateMaterialTab).not.toHaveBeenCalled();

            // Return tab should be in currentMaterialsTabs with the right attribute
            const returnTab = houseCostDisplay.currentMaterialsTabs.find((t) =>
                t.hasAttribute('data-mwi-house-return')
            );
            expect(returnTab).toBeTruthy();
            expect(returnTab.getAttribute('data-mwi-custom-tab')).toBe('true');
            expect(returnTab.getAttribute('data-mwi-tab-owner')).toBe('HOUSE');
        });

        it('does not add Return tab when returnContext is null', () => {
            makeTabsContainer();
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay.activeWorkflowModel = { sessionId: 5, materials: [], returnContext: null };

            houseCostDisplay.createMissingMaterialTabs([makeMaterial()]);

            const returnTab = houseCostDisplay.currentMaterialsTabs.find((t) =>
                t.hasAttribute('data-mwi-house-return')
            );
            expect(returnTab).toBeUndefined();
        });
    });

    // =========================================================================
    // _reinjectHouseMarketplaceTabs
    // =========================================================================

    describe('_reinjectHouseMarketplaceTabs', () => {
        it('uses the passed-in capturedSessionId for arm(), not _houseSessionId', () => {
            const container = makeTabsContainer();
            const mat = makeMaterial({ itemHrid: '/items/stone', missing: 5 });
            houseCostDisplay._houseSessionId = 99; // different from captured
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 3,
                materials: [{ ...mat, missing: 5 }],
                returnContext: null,
            };

            houseCostDisplay._reinjectHouseMarketplaceTabs(container, 3);
            capturedCallbacksRef.current[0].callback(new MouseEvent('click'), mat);

            expect(mockArm).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 3 }));
        });

        it('uses capturedSessionId for watchNativeTabExit — stale listener cannot end newer session', () => {
            const container = makeTabsContainer();
            houseCostDisplay._houseSessionId = 99;
            houseCostDisplay.activeWorkflowModel = { sessionId: 3, materials: [], returnContext: null };

            houseCostDisplay._reinjectHouseMarketplaceTabs(container, 3);
            capturedNativeExitRef.current();

            expect(mockEnd).toHaveBeenCalledWith(3);
            expect(mockEnd).not.toHaveBeenCalledWith(99);
        });

        it('adds exactly one Return tab when returnContext is present', () => {
            const container = makeTabsContainer();
            houseCostDisplay._houseSessionId = 3;
            houseCostDisplay.activeWorkflowModel = {
                sessionId: 3,
                materials: [makeMaterial()],
                returnContext: Object.freeze({
                    houseRoomHrid: '/house_rooms/bedroom',
                    currentLevel: 2,
                    targetLevel: 5,
                    sessionId: 3,
                }),
            };

            houseCostDisplay._reinjectHouseMarketplaceTabs(container, 3);

            const returnTabs = houseCostDisplay.currentMaterialsTabs.filter((t) =>
                t.hasAttribute('data-mwi-house-return')
            );
            expect(returnTabs).toHaveLength(1);
        });

        it('returns early when session is not active', () => {
            const container = makeTabsContainer();
            houseCostDisplay._houseSessionId = 3;
            houseCostDisplay.activeWorkflowModel = { sessionId: 3, materials: [makeMaterial()], returnContext: null };
            mockIsActive.mockReturnValue(false);

            houseCostDisplay._reinjectHouseMarketplaceTabs(container, 3);

            expect(mockCreateMaterialTab).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // _updateMarketplaceTabs — skips Return tab
    // =========================================================================

    describe('_updateMarketplaceTabs', () => {
        it('does not rewrite the Return tab badge', async () => {
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay._costContext = {
                houseRoomHrid: '/house_rooms/kitchen',
                currentLevel: 2,
                targetLevel: 4,
            };
            houseCostDisplay.activeWorkflowModel = { sessionId: 5, materials: [] };
            mockIsActive.mockReturnValue(true);

            const returnTab = document.createElement('button');
            returnTab.setAttribute('data-mwi-house-return', 'true');
            returnTab.textContent = '↩ Return to House';
            houseCostDisplay.currentMaterialsTabs = [returnTab];

            await houseCostDisplay._updateMarketplaceTabs();

            // The Return tab text must be untouched
            expect(returnTab.textContent).toBe('↩ Return to House');
        });

        it('stale calculation: older result resolving after session rotation does not update model', async () => {
            houseCostDisplay._houseSessionId = 5;
            houseCostDisplay._costContext = {
                houseRoomHrid: '/house_rooms/kitchen',
                currentLevel: 2,
                targetLevel: 4,
            };
            houseCostDisplay.activeWorkflowModel = { sessionId: 5, materials: [] };
            mockIsActive.mockReturnValue(true);
            houseCostDisplay.currentMaterialsTabs = [];

            // Trigger update, then rotate session before await resolves
            const updatePromise = houseCostDisplay._updateMarketplaceTabs();
            houseCostDisplay._houseSessionId = 99; // session rotated
            await updatePromise;

            // activeWorkflowModel.materials must NOT have been updated
            expect(houseCostDisplay.activeWorkflowModel.materials).toHaveLength(0);
        });
    });

    // =========================================================================
    // handleMissingMaterialsClick — activation and overlay
    // =========================================================================

    describe('handleMissingMaterialsClick', () => {
        it('fails closed without starting a session when _costContext has no houseRoomHrid', async () => {
            houseCostDisplay._costContext = null;

            await houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);

            expect(mockStart).not.toHaveBeenCalled();
        });

        it('stores immutable returnContext with currentLevel before any await', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(true);

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            // returnContext stored synchronously before navigation
            expect(houseCostDisplay.activeWorkflowModel.returnContext.houseRoomHrid).toBe('/house_rooms/hall');
            expect(houseCostDisplay.activeWorkflowModel.returnContext.currentLevel).toBe(2);
            expect(houseCostDisplay.activeWorkflowModel.returnContext.targetLevel).toBe(4);
            expect(houseCostDisplay.activeWorkflowModel.returnContext.sessionId).toBe(10);

            await vi.runAllTimersAsync();
            await p;
            vi.useRealTimers();
        });

        it('calls handleCloseModal before Marketplace navigation', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);
            mockIsActive.mockReturnValue(true);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            const getHouseSpy = vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            const navSpy = vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(true);

            const callOrder = [];
            houseComp.handleCloseModal.mockImplementation(() => {
                callOrder.push('close');
                houseComp.state.selectedHouseRoomHrid = null;
            });
            navSpy.mockImplementation(async () => {
                callOrder.push('nav');
                return true;
            });

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            expect(callOrder.indexOf('close')).toBeLessThan(callOrder.indexOf('nav'));
            vi.useRealTimers();
            getHouseSpy.mockRestore();
        });

        it('fails closed (exits session) when House component is absent or ambiguous', async () => {
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);

            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(null);

            await houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);

            expect(mockEnd).toHaveBeenCalledWith(10);
        });

        it('does not navigate when the captured House modal never closes', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);
            mockIsActive.mockReturnValue(true);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            houseComp.handleCloseModal.mockImplementation(() => {});
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            const navSpy = vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(true);

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            expect(navSpy).not.toHaveBeenCalled();
            expect(mockEnd).toHaveBeenCalledWith(10);
            vi.useRealTimers();
        });

        it('ends the captured session when visible Marketplace tabs cannot be installed', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);
            mockIsActive.mockReturnValue(true);
            vi.spyOn(houseCostDisplay, '_getVisibleMarketplaceTabContainer').mockReturnValue(null);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(true);

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            expect(mockEnd).toHaveBeenCalledWith(10);
            vi.useRealTimers();
        });

        it('navigation failure restores the room and ends the Core token', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);
            mockIsActive.mockReturnValue(true);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(false);

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            expect(houseComp.handleHouseRoomClicked).toHaveBeenCalledWith('/house_rooms/hall');
            expect(mockEnd).toHaveBeenCalledWith(10);
            vi.useRealTimers();
        });

        it('does not restore room when session replaced during navigation', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);

            // Session becomes inactive (replaced) during navigation
            const navSpy = vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockImplementation(async () => {
                houseCostDisplay._houseSessionId = 99; // session replaced
                mockIsActive.mockReturnValue(false);
                return false;
            });

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            expect(houseComp.handleHouseRoomClicked).not.toHaveBeenCalled();
            navSpy.mockRestore();
            vi.useRealTimers();
        });
    });

    // =========================================================================
    // _handleHouseReturn — Return race and identity
    // =========================================================================

    describe('_handleHouseReturn', () => {
        function makeReturnContext(overrides = {}) {
            return Object.freeze({
                houseRoomHrid: '/house_rooms/library',
                currentLevel: 3,
                targetLevel: 5,
                sessionId: 9,
                ...overrides,
            });
        }

        it('is a no-op when sessionId does not match _houseSessionId', async () => {
            houseCostDisplay._houseSessionId = 10;
            await houseCostDisplay._handleHouseReturn(makeReturnContext({ sessionId: 9 }));
            expect(mockEnd).not.toHaveBeenCalled();
        });

        it('is a no-op when session is no longer active', async () => {
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(false);
            await houseCostDisplay._handleHouseReturn(makeReturnContext());
            expect(mockEnd).not.toHaveBeenCalled();
        });

        it('does NOT end session before Marketplace close is confirmed (end comes after restoration)', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const mktComp = makeMarketplaceComponent();
            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(mktComp);

            // House component resolve returns null so Return ends early after Marketplace close
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(null);

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());

            // Before any timers advance, session must NOT be ended yet
            expect(mockEnd).not.toHaveBeenCalled();

            await vi.runAllTimersAsync();
            await p;

            // Now it ends — but only because House component was missing (failure path)
            expect(mockEnd).toHaveBeenCalledWith(9);
            vi.useRealTimers();
        });

        it('calls handleCloseMarketplaceModal before handleHouseRoomClicked', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const mktComp = makeMarketplaceComponent();
            const houseComp = makeHouseComponent();
            const callOrder = [];
            mktComp.handleCloseMarketplaceModal.mockImplementation(() => callOrder.push('closeMarket'));
            houseComp.handleHouseRoomClicked.mockImplementation(() => callOrder.push('roomClick'));

            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(mktComp);
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);

            // Make poll conditions pass immediately
            houseCostDisplay._pollUntil = vi.fn().mockResolvedValue(true);
            houseCostDisplay._cumulativeState = {
                houseRoomHrid: '/house_rooms/library',
                dropdown: makeConnectedDropdown(['5', '6']),
                costContainer: makeConnectedCostContainer(),
            };
            houseComp.state.selectedHouseRoomHrid = '/house_rooms/library';

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            expect(callOrder.indexOf('closeMarket')).toBeLessThan(callOrder.indexOf('roomClick'));
            vi.useRealTimers();
        });

        it('a stale rejected Return does not advance generation or cancel current work', async () => {
            houseCostDisplay._houseSessionId = 10;
            houseCostDisplay._houseReturnGeneration = 7;
            mockIsActive.mockReturnValue(true);

            await houseCostDisplay._handleHouseReturn(makeReturnContext({ sessionId: 9 }));

            expect(houseCostDisplay._houseReturnGeneration).toBe(7);
            expect(mockEnd).not.toHaveBeenCalled();
        });

        it('does not reopen House when Marketplace remains visible after the close timeout', async () => {
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const mktComp = makeMarketplaceComponent();
            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(mktComp);
            const houseComp = makeHouseComponent();
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            vi.spyOn(houseCostDisplay, '_pollUntil').mockResolvedValue(false);

            await houseCostDisplay._handleHouseReturn(makeReturnContext());

            expect(houseComp.handleHouseRoomClicked).not.toHaveBeenCalled();
            expect(mockEnd).toHaveBeenCalledWith(9);
        });

        it('fails closed when Marketplace component is absent or ambiguous', async () => {
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);
            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(null);

            await houseCostDisplay._handleHouseReturn(makeReturnContext());

            expect(mockEnd).toHaveBeenCalledWith(9);
        });

        it('generation guard: newer Return supersedes older one after Marketplace close', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const mktComp = makeMarketplaceComponent();
            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(mktComp);

            const houseComp = makeHouseComponent();
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);

            // Wrap _pollUntil so we can interject between polls
            let pollCount = 0;
            houseCostDisplay._pollUntil = vi.fn(async () => {
                pollCount++;
                if (pollCount === 1) {
                    // Simulate a newer Return starting (increments generation) during the Marketplace-close poll
                    houseCostDisplay._houseReturnGeneration++;
                }
                return true;
            });

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            // Old Return was superseded — should NOT click the room
            expect(houseComp.handleHouseRoomClicked).not.toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('generation guard: newer Return supersedes older one after handleHouseRoomClicked', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const mktComp = makeMarketplaceComponent();
            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(mktComp);

            const houseComp = makeHouseComponent();
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);

            let pollCount = 0;
            const dropdown = makeConnectedDropdown(['5', '6']);
            houseCostDisplay._cumulativeState = {
                houseRoomHrid: '/house_rooms/library',
                dropdown,
                costContainer: makeConnectedCostContainer(),
            };
            houseComp.state.selectedHouseRoomHrid = '/house_rooms/library';
            const changeSpy = vi.fn();
            dropdown.addEventListener('change', changeSpy);

            houseCostDisplay._pollUntil = vi.fn(async () => {
                pollCount++;
                if (pollCount === 2) {
                    // Supersede after room click poll
                    houseCostDisplay._houseReturnGeneration++;
                }
                return true;
            });

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            // Superseded — dropdown must NOT be written
            expect(changeSpy).not.toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('disconnected stale dropdown is never written', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(makeMarketplaceComponent());
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(makeHouseComponent());

            houseCostDisplay._pollUntil = vi.fn().mockResolvedValue(true);

            // Dropdown is NOT connected (detached node)
            const dropdown = document.createElement('select');
            const opt = document.createElement('option');
            opt.value = '5';
            dropdown.appendChild(opt);
            // NOT appended to document.body — disconnected
            const changeSpy = vi.fn();
            dropdown.addEventListener('change', changeSpy);

            houseCostDisplay._cumulativeState = {
                houseRoomHrid: '/house_rooms/library',
                dropdown,
                costContainer: makeConnectedCostContainer(),
            };

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            expect(changeSpy).not.toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('missing target option fails closed without writing dropdown', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(makeMarketplaceComponent());
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(makeHouseComponent());

            houseCostDisplay._pollUntil = vi.fn().mockResolvedValue(true);

            // Dropdown only has option '4', not '5'
            const dropdown = makeConnectedDropdown(['4']);
            const changeSpy = vi.fn();
            dropdown.addEventListener('change', changeSpy);

            houseCostDisplay._cumulativeState = {
                houseRoomHrid: '/house_rooms/library',
                dropdown,
                costContainer: makeConnectedCostContainer(),
            };

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext({ targetLevel: 5 }));
            await vi.runAllTimersAsync();
            await p;

            expect(changeSpy).not.toHaveBeenCalled();
            expect(mockEnd).toHaveBeenCalledWith(9); // session still ended on failure
            vi.useRealTimers();
        });

        it('successful Return: writes dropdown then ends the Core session', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(makeMarketplaceComponent());
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(
                makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/library' } })
            );

            houseCostDisplay._pollUntil = vi.fn().mockResolvedValue(true);

            const dropdown = makeConnectedDropdown(['4', '5', '6']);
            const changeSpy = vi.fn();
            dropdown.addEventListener('change', changeSpy);
            const callOrder = [];
            changeSpy.mockImplementation(() => callOrder.push('change'));
            mockEnd.mockImplementation(() => callOrder.push('end'));

            houseCostDisplay._cumulativeState = {
                houseRoomHrid: '/house_rooms/library',
                dropdown,
                costContainer: makeConnectedCostContainer(),
            };

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            expect(dropdown.value).toBe('5');
            expect(changeSpy).toHaveBeenCalledOnce();
            expect(mockEnd).toHaveBeenCalledWith(9);
            expect(callOrder.indexOf('change')).toBeLessThan(callOrder.indexOf('end'));
            vi.useRealTimers();
        });

        it('cancels cleanupObserver before closing Marketplace to prevent premature session end', async () => {
            vi.useFakeTimers();
            houseCostDisplay._houseSessionId = 9;
            mockIsActive.mockReturnValue(true);

            const cleanupObserver = vi.fn();
            houseCostDisplay.cleanupObserver = cleanupObserver;

            vi.spyOn(houseCostDisplay, '_getMarketplaceComponent').mockReturnValue(makeMarketplaceComponent());
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(null); // fail early

            const p = houseCostDisplay._handleHouseReturn(makeReturnContext());
            await vi.runAllTimersAsync();
            await p;

            expect(cleanupObserver).toHaveBeenCalledOnce();
            expect(houseCostDisplay.cleanupObserver).toBeNull();
            vi.useRealTimers();
        });
    });

    // =========================================================================
    // handleMissingMaterialsClick — overlay close/cleanup observer ends Core token
    // =========================================================================

    describe('handleMissingMaterialsClick — cleanup observer lifecycle', () => {
        it('overlay close / no tab container ends the captured Core token', async () => {
            vi.useFakeTimers();
            houseCostDisplay._costContext = { houseRoomHrid: '/house_rooms/hall', currentLevel: 2, targetLevel: 4 };
            mockStart.mockReturnValue(10);
            mockIsActive.mockReturnValue(true);

            const houseComp = makeHouseComponent({ state: { selectedHouseRoomHrid: '/house_rooms/hall' } });
            vi.spyOn(houseCostDisplay, '_getHouseComponent').mockReturnValue(houseComp);
            vi.spyOn(houseCostDisplay, 'navigateToMarketplace').mockResolvedValue(true);

            // Provide a real container for the initial tab install so createMissingMaterialTabs
            // returns true and the cleanup observer is installed. After that, return null to
            // simulate the overlay having closed (no tab container when onTabsGone fires).
            const fakeContainer = document.createElement('div');
            const myListingsBtn = document.createElement('button');
            myListingsBtn.textContent = 'My Listings';
            fakeContainer.appendChild(myListingsBtn);
            vi.spyOn(houseCostDisplay, '_getVisibleMarketplaceTabContainer')
                .mockReturnValueOnce(fakeContainer) // install succeeds
                .mockReturnValue(null); // observer fires: no container

            let capturedOnTabsGone;
            mockSetupCleanupObserver.mockImplementation(({ onTabsGone }) => {
                capturedOnTabsGone = onTabsGone;
                return vi.fn();
            });

            const p = houseCostDisplay.handleMissingMaterialsClick([makeMaterial()]);
            await vi.runAllTimersAsync();
            await p;

            // Simulate overlay close with no tab container
            capturedOnTabsGone();

            expect(mockEnd).toHaveBeenCalledWith(10);
            vi.useRealTimers();
        });
    });

    // =========================================================================
    // _createHouseReturnTab
    // =========================================================================

    describe('_createHouseReturnTab', () => {
        it('has all required attributes and text', () => {
            const ref = document.createElement('button');
            ref.id = 'native-tab-id';
            ref.setAttribute('aria-controls', 'native-panel');
            ref.setAttribute('aria-selected', 'true');
            ref.setAttribute('tabindex', '0');
            ref.classList.add('Mui-selected');
            const ctx = Object.freeze({
                houseRoomHrid: '/house_rooms/hall',
                currentLevel: 3,
                targetLevel: 5,
                sessionId: 1,
            });
            const tab = houseCostDisplay._createHouseReturnTab(ref, ctx);

            expect(tab.getAttribute('data-mwi-custom-tab')).toBe('true');
            expect(tab.getAttribute('data-mwi-tab-owner')).toBe('HOUSE');
            expect(tab.getAttribute('data-mwi-house-return')).toBe('true');
            expect(tab.textContent).toBe('↩ Return to House');
            expect(tab.hasAttribute('data-item-hrid')).toBe(false);
            expect(tab.hasAttribute('data-missing-quantity')).toBe(false);
            expect(tab.hasAttribute('id')).toBe(false);
            expect(tab.hasAttribute('aria-controls')).toBe(false);
            expect(tab.classList.contains('Mui-selected')).toBe(false);
            expect(tab.getAttribute('aria-selected')).toBe('false');
            expect(tab.getAttribute('tabindex')).toBe('-1');
        });

        it('click invokes _handleHouseReturn with the returnContext', () => {
            const ref = document.createElement('button');
            const ctx = Object.freeze({
                houseRoomHrid: '/house_rooms/hall',
                currentLevel: 3,
                targetLevel: 5,
                sessionId: 1,
            });
            const returnSpy = vi.spyOn(houseCostDisplay, '_handleHouseReturn').mockResolvedValue(undefined);
            const tab = houseCostDisplay._createHouseReturnTab(ref, ctx);

            tab.click();
            expect(returnSpy).toHaveBeenCalledWith(ctx);
            returnSpy.mockRestore();
        });
    });
});
