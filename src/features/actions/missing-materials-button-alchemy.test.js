// @vitest-environment jsdom
/**
 * Alchemy Missing Mats: button rendering from the selected item + Repeat count, coexistence with the
 * production refresh path, and the Return tab restoring the Alchemy item and count.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeDataManager, mockCalculateAlchemy, shared } = vi.hoisted(() => {
    const listeners = new Map();
    return {
        mockCalculateAlchemy: vi.fn(),
        shared: { tabContainer: null, settings: {} },
        fakeDataManager: {
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
            getInitClientData: vi.fn(() => ({ actionDetailMap: {} })),
            getCurrentActions: vi.fn(() => []),
            getInventory: vi.fn(() => []),
            getActionDetails: vi.fn(),
            getItemDetails: vi.fn(() => ({ name: 'Emp Tea Leaf' })),
            getCurrentCharacterId: vi.fn(() => 'char-1'),
        },
    };
});

vi.mock('../../core/data-manager.js', () => ({ default: fakeDataManager }));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => {
            if (key in shared.settings) return shared.settings[key];
            return key !== 'actions_missingMaterialsButton_ignoreQueue';
        }),
    },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));

import { marketplaceSession } from '../../core/marketplace-session.js';

vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: vi.fn(() => []),
    calculateEnhancementMaterialRequirements: vi.fn(() => []),
}));
vi.mock('../../utils/alchemy-material-calculator.js', () => ({
    calculateAlchemyMaterialRequirements: mockCalculateAlchemy,
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
vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: vi.fn(() => document.createElement('button')),
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(() => shared.tabContainer),
    setupMarketplaceCleanupObserver: vi.fn(() => vi.fn()),
    navigateToMarketplace: vi.fn(() => true),
    watchNativeTabExit: vi.fn(() => vi.fn()),
    isElementActuallyVisible: vi.fn(() => true),
    clickMarketplaceNavigationButton: vi.fn(() => true),
    updateTabBadge: vi.fn(),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => true),
}));
vi.mock('./enhancement-display.js', () => ({
    getProtectionItemFromUI: vi.fn(() => null),
    getProtectFromLevelFromUI: vi.fn(() => 0),
}));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn(() => null) }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => ({})) }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../../utils/game-lookups.js', () => ({
    getActionHridFromName: vi.fn(() => null),
    getActionHridFromFiber: vi.fn(() => null),
}));
vi.mock('./production-tools-layout.js', () => ({
    getOrCreateProductionToolsBlock: vi.fn(() => null),
    normalizeProductionToolsBlock: vi.fn(),
}));

import missingMaterialsButton from './missing-materials-button.js';

const LEAF = '/items/emp_tea_leaf';
const LEAF_HASH = `char-1::/item_locations/inventory::${LEAF}::0`;

function buildAlchemyPanel({ itemId = 'emp_tea_leaf', enhancement = '', repeat = '100', withItem = true } = {}) {
    document.body.innerHTML = `
        <div id="root"></div>
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_alchemyComponent_abc">
                <div class="SkillActionDetail_inputs_abc">
                    <div class="SkillActionDetail_maxActionCountInput_abc"><input value="${repeat}" /></div>
                </div>
                <div class="SkillActionDetail_info_abc">
                    <div class="SkillActionDetail_alchemyCosts_abc">
                        <div class="SkillActionDetail_itemRequirements_abc">
                            ${
                                withItem
                                    ? `<div class="Item_itemContainer_abc">
                                           <svg><use href="/static/items_sprite.svg#${itemId}"></use></svg>
                                           ${enhancement ? `<div class="Item_enhancementLevel_abc">${enhancement}</div>` : ''}
                                       </div>`
                                    : ''
                            }
                        </div>
                    </div>
                    <div class="mwi-alchemy-gold-summary">Gold for 100</div>
                </div>
            </div>
        </div>
    `;
    return document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
}

const missing = (overrides = {}) => [
    {
        itemHrid: LEAF,
        itemName: 'Emp Tea Leaf',
        required: 200,
        have: 100,
        queued: 0,
        missing: 100,
        isTradeable: true,
        ...overrides,
    },
];

beforeEach(() => {
    vi.useFakeTimers();
    shared.settings = {};
    shared.tabContainer = null;
    mockCalculateAlchemy.mockReset();
    mockCalculateAlchemy.mockReturnValue(missing());
    marketplaceSession.endAll();
});

afterEach(() => {
    missingMaterialsButton.cleanup();
    marketplaceSession.endAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

async function initializeWithPanel(options) {
    const panel = buildAlchemyPanel(options);
    missingMaterialsButton.initialize();
    await vi.advanceTimersByTimeAsync(0);
    return panel;
}

describe('Alchemy Missing Mats button', () => {
    test('renders an enabled button after the gold summary when materials are missing', async () => {
        const panel = await initializeWithPanel();

        const button = panel.querySelector('#mwi-missing-mats-button');
        expect(button).toBeTruthy();
        expect(button.disabled).toBe(false);
        expect(button.previousElementSibling.className).toBe('mwi-alchemy-gold-summary');
        expect(mockCalculateAlchemy).toHaveBeenCalledWith(LEAF, 100, true);
    });

    test('is disabled when nothing is missing', async () => {
        mockCalculateAlchemy.mockReturnValue(missing({ missing: 0 }));

        const panel = await initializeWithPanel();

        expect(panel.querySelector('#mwi-missing-mats-button').disabled).toBe(true);
    });

    test('is disabled with no calculation when Repeat is infinite', async () => {
        const panel = await initializeWithPanel({ repeat: '∞' });

        expect(panel.querySelector('#mwi-missing-mats-button').disabled).toBe(true);
        expect(mockCalculateAlchemy).not.toHaveBeenCalled();
    });

    test('is not rendered for an enhanced item, with no item, or when the setting is off', async () => {
        let panel = await initializeWithPanel({ enhancement: '+3' });
        expect(panel.querySelector('#mwi-missing-mats-button')).toBeNull();
        missingMaterialsButton.cleanup();

        panel = await initializeWithPanel({ withItem: false });
        expect(panel.querySelector('#mwi-missing-mats-button')).toBeNull();
        missingMaterialsButton.cleanup();

        shared.settings.actions_missingMaterialsButton = false;
        panel = await initializeWithPanel();
        expect(panel.querySelector('#mwi-missing-mats-button')).toBeNull();
    });

    test('ignoring the queue is passed through to the calculation', async () => {
        shared.settings.actions_missingMaterialsButton_ignoreQueue = true;

        await initializeWithPanel();

        expect(mockCalculateAlchemy).toHaveBeenCalledWith(LEAF, 100, false);
    });

    test('typing a new Repeat count refreshes the button', async () => {
        const panel = await initializeWithPanel();
        const input = panel.querySelector('input');
        mockCalculateAlchemy.mockReturnValue(missing({ required: 20, missing: 0 }));

        input.value = '10';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(100);

        expect(mockCalculateAlchemy).toHaveBeenLastCalledWith(LEAF, 10, true);
        expect(panel.querySelector('#mwi-missing-mats-button').disabled).toBe(true);
    });

    test('a queue change keeps the button (the production refresh path must not erase it)', async () => {
        const panel = await initializeWithPanel();

        fakeDataManager.emit('actions_updated', { endCharacterActions: [] });
        await vi.advanceTimersByTimeAsync(100);

        expect(panel.querySelectorAll('#mwi-missing-mats-button').length).toBe(1);
    });

    test('does not rebuild the button when nothing changed', async () => {
        const panel = await initializeWithPanel();
        const button = panel.querySelector('#mwi-missing-mats-button');

        fakeDataManager.emit('actions_updated', { endCharacterActions: [] });
        await vi.advanceTimersByTimeAsync(100);

        expect(panel.querySelector('#mwi-missing-mats-button')).toBe(button);
    });
});

describe('Alchemy Missing Mats Return tab', () => {
    function installGame({ itemSticks = true } = {}) {
        const alchemyComponent = {
            setState: vi.fn(),
            props: { actionDetail: { hrid: '/actions/alchemy/decompose' } },
            state: { primaryItemHash: null, hasMaxCount: false, maxActionCount: 0 },
            selectAlchemyItemHandler: vi.fn(function select(hash) {
                this.state.primaryItemHash = hash;
            }),
            maxActionCountChanged: vi.fn(function change({ target }) {
                this.state.hasMaxCount = true;
                this.state.maxActionCount = Number(target.value);
            }),
            unlimitedActionCountClicked: vi.fn(),
        };
        const game = {
            handleGoToAction: vi.fn(),
            handleAlchemizeItem: vi.fn((hash) => {
                if (itemSticks) alchemyComponent.state.primaryItemHash = hash;
            }),
        };
        const rootEl = document.getElementById('root');
        rootEl._reactRootContainer = {
            current: {
                stateNode: null,
                sibling: null,
                child: {
                    stateNode: game,
                    sibling: { stateNode: alchemyComponent, child: null, sibling: null },
                    child: null,
                },
            },
        };
        return { game, alchemyComponent };
    }

    async function openMarketplaceThenClickReturn() {
        shared.tabContainer = document.createElement('div');
        const myListings = document.createElement('button');
        myListings.innerHTML = '<span class="TabsComponent_badge_x">My Listings</span>';
        shared.tabContainer.appendChild(myListings);

        const panel = await initializeWithPanel({ repeat: '5000' });
        panel.querySelector('#mwi-missing-mats-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();

        const returnTab = shared.tabContainer.querySelector('[data-mwi-custom-tab]');
        expect(returnTab).toBeTruthy();
        return returnTab;
    }

    test('the workflow stores an Alchemy return context and shows a Return tab', async () => {
        const returnTab = await openMarketplaceThenClickReturn();

        expect(returnTab.textContent).toContain('Emp Tea Leaf');
        expect(returnTab.textContent).toContain('5000');
        expect(marketplaceSession.getActive()).not.toBeNull();
    });

    test('Return reselects the item, restores the Repeat count, then ends the session', async () => {
        const returnTab = await openMarketplaceThenClickReturn();
        const { game, alchemyComponent } = installGame();

        returnTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);

        expect(game.handleAlchemizeItem).toHaveBeenCalledWith(LEAF_HASH);
        expect(alchemyComponent.maxActionCountChanged).toHaveBeenCalledWith({ target: { value: '5000' } });
        expect(alchemyComponent.state.maxActionCount).toBe(5000);
        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('Return selects the item itself when the native override missed it', async () => {
        const returnTab = await openMarketplaceThenClickReturn();
        const { alchemyComponent } = installGame({ itemSticks: false });

        returnTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);

        expect(alchemyComponent.selectAlchemyItemHandler).toHaveBeenCalledWith(LEAF_HASH);
        expect(alchemyComponent.state.maxActionCount).toBe(5000);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});
