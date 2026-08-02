// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { observerCallbacks, mockOnClass } = vi.hoisted(() => {
    const observerCallbacks = new Map();
    const mockOnClass = vi.fn((id, _className, callback) => {
        observerCallbacks.set(id, callback);
        return vi.fn(() => observerCallbacks.delete(id));
    });
    return { observerCallbacks, mockOnClass };
});

vi.mock('../core/dom-observer.js', () => ({
    default: { onClass: mockOnClass },
}));

import { marketplaceSession, MARKETPLACE_OWNER } from '../core/marketplace-session.js';
import { createAutofillManager, readMarketplaceRuntimeStateFromElement } from './marketplace-autofill.js';

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

function attachReactComponent(element, component) {
    Object.defineProperty(element, '__reactFiber$test', {
        configurable: true,
        value: {
            stateNode: null,
            return: {
                stateNode: component,
                return: null,
            },
        },
    });
}

function attachReactRootComponent(element, component) {
    const rootElement = document.createElement('div');
    rootElement.id = 'root';
    document.body.prepend(rootElement);

    const ownerFiber = { stateNode: component, child: null, sibling: null, return: null };
    const hostFiber = { stateNode: element, child: null, sibling: null, return: ownerFiber };
    ownerFiber.child = hostFiber;
    const rootFiber = { stateNode: null, child: ownerFiber, sibling: null, return: null };

    Object.defineProperty(rootElement, '_reactRootContainer', {
        configurable: true,
        value: { current: rootFiber },
    });
}

function makeBuyModal(component, { title = 'Buy Now', quantity = '1' } = {}) {
    const modal = document.createElement('div');
    modal.className = 'Modal_modalContainer__test';
    modal.innerHTML = `
        <div class="MarketplacePanel_header__test">${title}</div>
        <div class="MarketplacePanel_quantityInputs__test">
            <input type="number" value="${quantity}">
        </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('input');
    attachReactComponent(input, component);
    return { modal, input };
}

function startManager({ consumeOnFill = false, quantityProvider = () => 42 } = {}) {
    const manager = createAutofillManager('Autofill-Test');
    manager.initialize();
    const sessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, consumeOnFill });
    manager.startSession({ sessionId });
    expect(
        manager.arm({
            sessionId,
            itemHrid: '/items/cheese',
            enhancementLevel: 0,
            modalMode: 'buy',
            quantityProvider,
        })
    ).toBe(true);
    return { manager, sessionId };
}

function emitModal(modal) {
    const callback = observerCallbacks.get('Autofill-Test');
    expect(callback).toBeTypeOf('function');
    callback(modal);
    vi.advanceTimersByTime(0);
}

describe('marketplace-autofill', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        observerCallbacks.clear();
        mockOnClass.mockClear();
        marketplaceSession.endAll();
    });

    afterEach(() => {
        marketplaceSession.endAll();
        vi.clearAllTimers();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    test('reads exact Marketplace state from the quantity input ancestry', () => {
        const component = makeMarketplaceComponent();
        const { input } = makeBuyModal(component);

        expect(readMarketplaceRuntimeStateFromElement(input)).toEqual(component.state);
    });

    test('resolves the exact quantity-input owner from the React root when DOM fiber keys are absent', () => {
        const component = makeMarketplaceComponent();
        const { input } = makeBuyModal(component);
        delete input.__reactFiber$test;
        attachReactRootComponent(input, component);

        expect(readMarketplaceRuntimeStateFromElement(input)).toEqual(component.state);
    });

    test('fails closed when the quantity input ancestry contains two Marketplace-like owners', () => {
        const inner = makeMarketplaceComponent();
        const outer = makeMarketplaceComponent();
        const { input } = makeBuyModal(inner);
        const fiber = input.__reactFiber$test;
        fiber.return.return = { stateNode: outer, return: null };

        expect(readMarketplaceRuntimeStateFromElement(input)).toBeNull();
    });

    test('fails closed when Marketplace ownership lies beyond the 256-level ancestry bound', () => {
        const component = makeMarketplaceComponent();
        const { input } = makeBuyModal(component);
        let fiber = input.__reactFiber$test;
        fiber.return = null;
        for (let depth = 0; depth < 256; depth += 1) {
            fiber.return = { stateNode: null, return: null };
            fiber = fiber.return;
        }
        fiber.return = { stateNode: component, return: null };

        expect(readMarketplaceRuntimeStateFromElement(input)).toBeNull();
    });

    test('fills the exact matching Buy modal through the native input setter', () => {
        const { manager, sessionId } = startManager({ quantityProvider: () => 865 });
        const component = makeMarketplaceComponent();
        const { modal, input } = makeBuyModal(component);
        const inputEvents = vi.fn();
        input.addEventListener('input', inputEvents);

        emitModal(modal);

        expect(input.value).toBe('865');
        expect(inputEvents).toHaveBeenCalledTimes(1);
        expect(marketplaceSession.isActive(sessionId)).toBe(true);
        manager.cleanup();
    });

    test('does not fill a modal for a different item and keeps the exact target armed', () => {
        const { manager } = startManager({ quantityProvider: () => 865 });
        const component = makeMarketplaceComponent({ itemHrid: '/items/verdant_milk' });
        const { modal, input } = makeBuyModal(component);

        emitModal(modal);
        vi.advanceTimersByTime(1500);

        expect(input.value).toBe('1');

        // A later exact Buy modal in the same active workflow can still fill.
        component.state.itemHrid = '/items/cheese';
        emitModal(modal);
        expect(input.value).toBe('865');
        manager.cleanup();
    });

    test.each([
        ['Sell modal', { isSell: true }],
        ['wrong selected enhancement level', { enhancementLevel: 1 }],
        ['wrong modal enhancement level', { enhancementLevelInput: 1 }],
        ['closed post-listing modal state', { showPostListing: false }],
        ['new listing state', { isPostNewListing: true }],
        ['non-instant order state', { isInstantOrder: false }],
        ['wrong Marketplace view', { marketListingsView: 'ItemGrid' }],
    ])('rejects %s', (_label, stateOverride) => {
        const { manager } = startManager();
        const component = makeMarketplaceComponent(stateOverride);
        const { modal, input } = makeBuyModal(component);

        emitModal(modal);
        vi.advanceTimersByTime(1500);

        expect(input.value).toBe('1');
        manager.cleanup();
    });

    test('an unrelated modal does not destroy the armed Buy target', () => {
        const { manager } = startManager({ quantityProvider: () => 33 });
        const unrelated = document.createElement('div');
        unrelated.className = 'Modal_modalContainer__test';
        unrelated.innerHTML = '<div class="MarketplacePanel_header__test">Confirm</div>';
        document.body.appendChild(unrelated);

        emitModal(unrelated);
        vi.advanceTimersByTime(1500);

        const component = makeMarketplaceComponent();
        const { modal, input } = makeBuyModal(component);
        emitModal(modal);
        expect(input.value).toBe('33');
        manager.cleanup();
    });

    test('persistent workflow refills a reused modal when the live missing quantity changes', () => {
        let quantity = 20;
        const { manager } = startManager({ quantityProvider: () => quantity });
        const component = makeMarketplaceComponent();
        const { modal, input } = makeBuyModal(component);

        emitModal(modal);
        expect(input.value).toBe('20');

        // Model a second partial-purchase modal using the same retained DOM node.
        quantity = 7;
        input.value = '1';
        emitModal(modal);
        expect(input.value).toBe('7');
        manager.cleanup();
    });

    test('one-shot Ability Book workflow consumes its Core session after a successful fill', () => {
        const manager = createAutofillManager('Autofill-Test');
        manager.initialize();
        const sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
        });
        manager.startSession({ sessionId });
        expect(
            manager.arm({
                sessionId,
                itemHrid: '/items/cheese',
                enhancementLevel: 0,
                modalMode: 'buy',
                quantityProvider: () => 3,
            })
        ).toBe(true);

        const component = makeMarketplaceComponent();
        const { modal, input } = makeBuyModal(component);
        emitModal(modal);

        expect(input.value).toBe('3');
        expect(marketplaceSession.isActive(sessionId)).toBe(false);
        manager.cleanup();
    });

    test('re-arm replaces an older item target and only the newest generation can fill', () => {
        const { manager, sessionId } = startManager({ quantityProvider: () => 11 });
        expect(
            manager.arm({
                sessionId,
                itemHrid: '/items/verdant_milk',
                enhancementLevel: 0,
                modalMode: 'buy',
                quantityProvider: () => 22,
            })
        ).toBe(true);

        const oldComponent = makeMarketplaceComponent({ itemHrid: '/items/cheese' });
        const oldModal = makeBuyModal(oldComponent);
        emitModal(oldModal.modal);
        expect(oldModal.input.value).toBe('1');

        const newComponent = makeMarketplaceComponent({ itemHrid: '/items/verdant_milk' });
        const newModal = makeBuyModal(newComponent);
        emitModal(newModal.modal);
        expect(newModal.input.value).toBe('22');
        manager.cleanup();
    });
});
