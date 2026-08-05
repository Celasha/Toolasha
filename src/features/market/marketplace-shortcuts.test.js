// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import { MarketplaceShortcuts } from './marketplace-shortcuts.js';

function createActionMenu() {
    const menu = document.createElement('div');
    menu.innerHTML = '<button type="button">Existing action</button>';
    return menu;
}

function makeMarketplaceComponent(overrides = {}) {
    return {
        state: {
            marketTabKey: 'MarketListings',
            marketListingsView: 'OrderBook',
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            enhancementLevelInput: 0,
            isSell: false,
            showPostListing: true,
            isPostNewListing: false,
            isInstantOrder: true,
            quantityInput: 1,
            priceInput: 10,
            ...overrides,
        },
        setState: vi.fn(),
        handleQuantityInputChanged: vi.fn(),
    };
}

function makeModal(component, title = 'Buy Now') {
    const modal = document.createElement('div');
    modal.className = 'Modal_modalContainer__test';
    modal.innerHTML = `
        <div class="MarketplacePanel_header__test">${title}</div>
        <div class="MarketplacePanel_quantityInputs__test">
            <input type="number" value="1">
        </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('input');
    Object.defineProperty(input, '__reactFiber$test', {
        configurable: true,
        value: {
            stateNode: null,
            return: {
                stateNode: component,
                return: null,
            },
        },
    });
    return { modal, input };
}

beforeEach(() => {
    vi.useFakeTimers();
    marketplaceSession.endAll();
    document.body.innerHTML = '';
});

afterEach(() => {
    marketplaceSession.endAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('MarketplaceShortcuts dropdown lifecycle', () => {
    test('buildDropdown does not add a document listener per action menu', () => {
        const feature = new MarketplaceShortcuts();
        const addListenerSpy = vi.spyOn(document, 'addEventListener');

        feature.buildDropdown(createActionMenu(), '/items/test_item', 0);
        feature.buildDropdown(createActionMenu(), '/items/other_item', 0);

        expect(addListenerSpy).not.toHaveBeenCalledWith('click', expect.any(Function));
    });

    test('one shared close handler closes every rendered dropdown', () => {
        const feature = new MarketplaceShortcuts();
        const first = feature.buildDropdown(createActionMenu(), '/items/test_item', 0);
        const second = feature.buildDropdown(createActionMenu(), '/items/other_item', 0);
        document.body.append(first, second);

        first.querySelector('.mwi-marketplace-dropdown-toggle').click();
        second.querySelector('.mwi-marketplace-dropdown-toggle').click();
        expect(first.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('flex');
        expect(second.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('flex');

        feature.closeAllDropdowns();

        expect(first.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('none');
        expect(second.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('none');
    });
});

describe('MarketplaceShortcuts session-owned quantity autofill', () => {
    test('claims exclusive ownership and ends the previous marketplace workflow', () => {
        const previousEnd = vi.fn();
        marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: previousEnd });
        const feature = new MarketplaceShortcuts();

        feature.startPendingAutofill({
            quantity: 12,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'buy',
        });

        expect(previousEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.getActive()).toEqual({
            sessionId: feature.pendingAutofill.sessionId,
            owner: MARKETPLACE_OWNER.SHORTCUTS,
        });
        feature.endPendingAutofill();
    });

    test('fills only the exact item and mode, then ends its owned session', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 42,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'buy',
        });
        const component = makeMarketplaceComponent({ itemHrid: '/items/other_item' });
        const { modal, input } = makeModal(component);

        feature.autofillQuantity(modal);
        vi.advanceTimersByTime(100);
        expect(input.value).toBe('1');
        expect(feature.pendingAutofill).not.toBeNull();

        component.state.itemHrid = '/items/cheese';
        vi.advanceTimersByTime(150);

        expect(input.value).toBe('42');
        expect(feature.pendingAutofill).toBeNull();
        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('fails closed for a wrong enhancement level or modal mode', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 7,
            itemHrid: '/items/cheese',
            enhancementLevel: 2,
            actionType: 'buy',
        });
        const component = makeMarketplaceComponent({
            enhancementLevel: 2,
            enhancementLevelInput: 1,
        });
        const { modal, input } = makeModal(component);

        feature.autofillQuantity(modal);
        vi.advanceTimersByTime(1500);
        expect(input.value).toBe('1');
        expect(feature.pendingAutofill).not.toBeNull();

        modal.querySelector('[class*="MarketplacePanel_header"]').textContent = 'Buy Listing';
        component.state.enhancementLevelInput = 2;
        component.state.isPostNewListing = true;
        component.state.isInstantOrder = false;
        feature.autofillQuantity(modal);
        vi.advanceTimersByTime(1500);

        expect(input.value).toBe('1');
        expect(feature.pendingAutofill).not.toBeNull();
        feature.endPendingAutofill();
    });

    test('expires an unmatched shortcut session and clears every retry timer', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 7,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'buy',
        });
        const { modal } = makeModal(makeMarketplaceComponent({ itemHrid: '/items/other_item' }));

        feature.autofillQuantity(modal);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SHORTCUTS);

        vi.advanceTimersByTime(10000);

        expect(feature.pendingAutofill).toBeNull();
        expect(feature.pendingAutofillWriteTimers.size).toBe(0);
        expect(feature.pendingAutofillExpiryTimer).toBeNull();
        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('a replacing workflow cancels a scheduled write before it can reach the modal', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 42,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'buy',
        });
        const { modal, input } = makeModal(makeMarketplaceComponent());

        feature.autofillQuantity(modal);
        marketplaceSession.start({ owner: MARKETPLACE_OWNER.HOUSE });
        vi.advanceTimersByTime(100);

        expect(input.value).toBe('1');
        expect(feature.pendingAutofill).toBeNull();
    });

    test('retargets an unavailable instant order to the matching new-listing modal', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 9,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'sell',
        });
        feature.retargetPendingAutofill('sell-listing');
        const component = makeMarketplaceComponent({
            isSell: true,
            isPostNewListing: true,
            isInstantOrder: false,
        });
        const { modal, input } = makeModal(component, 'Sell Listing');

        feature.autofillQuantity(modal);
        vi.advanceTimersByTime(100);

        expect(input.value).toBe('9');
        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('a zero-quantity shortcut still owns the navigation but performs no write', () => {
        const feature = new MarketplaceShortcuts();
        feature.startPendingAutofill({
            quantity: 0,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            actionType: 'buy',
        });
        const { modal, input } = makeModal(makeMarketplaceComponent());

        feature.autofillQuantity(modal);
        vi.advanceTimersByTime(100);

        expect(input.value).toBe('1');
        expect(feature.pendingAutofill).toBeNull();
        expect(marketplaceSession.getActive()).toBeNull();
    });
});
