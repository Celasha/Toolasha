/**
 * Marketplace Buy Modal Autofill Utility
 * Session-aware autofill manager.  Each consumer calls createAutofillManager() to get
 * an instance, then drives it with startSession / arm / exitSession.
 *
 * Exported helpers:
 *   readMarketplaceRuntimeState()  — reads live Marketplace React component state via fiber
 *   readMarketplaceItemIdentity()  — @deprecated, DOM-based; absent selector in current client
 *   createAutofillManager(observerId)
 */

import domObserver from '../core/dom-observer.js';
import { marketplaceSession } from '../core/marketplace-session.js';

const MARKETPLACE_PANEL_SELECTOR = '[class*="MarketplacePanel_marketplacePanel"]';
const MARKETPLACE_STATE_KEYS = ['marketTabKey', 'marketListingsView', 'itemHrid', 'enhancementLevel', 'isSell'];
const REACT_FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'];
const MAX_REACT_TREE_FIBERS = 50000;
const MAX_REACT_OWNER_DEPTH = 256;

function hasMarketplaceStateSignature(state) {
    return state && typeof state === 'object' && MARKETPLACE_STATE_KEYS.every((key) => key in state);
}

function isElementVisible(element) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;

    for (let current = element; current; current = current.parentElement) {
        if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
            return false;
        }
    }

    return true;
}

function getReactRootFiber() {
    const rootElement = document.getElementById('root');
    const rootContainer = rootElement?._reactRootContainer;
    return rootContainer?.current || rootContainer?._internalRoot?.current || null;
}

function findReactFiberFromRoot(element) {
    const rootFiber = getReactRootFiber();
    if (!rootFiber || !element) return null;

    const stack = [rootFiber];
    const visited = new Set();
    let matchedFiber = null;

    while (stack.length > 0) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);

        if (visited.size > MAX_REACT_TREE_FIBERS) return null;

        if (fiber.stateNode === element) {
            if (matchedFiber && matchedFiber !== fiber) return null;
            matchedFiber = fiber;
        }

        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
    }

    return matchedFiber;
}

export function getReactFiberFromElement(element) {
    if (!element) return null;

    const directFibers = new Set(
        Object.getOwnPropertyNames(element)
            .filter((key) => REACT_FIBER_PREFIXES.some((prefix) => key.startsWith(prefix)))
            .map((key) => element[key])
            .filter(Boolean)
    );
    if (directFibers.size > 1) return null;
    if (directFibers.size === 1) return directFibers.values().next().value;

    // Current MWI builds no longer expose __reactFiber$ keys on DOM nodes.
    // Resolve the exact host fiber from the public React root instead.
    return findReactFiberFromRoot(element);
}

function normalizeMarketplaceState(state) {
    if (!hasMarketplaceStateSignature(state)) return null;
    if (typeof state.marketTabKey !== 'string' || typeof state.marketListingsView !== 'string') return null;
    if (state.itemHrid !== null && (typeof state.itemHrid !== 'string' || !state.itemHrid)) return null;
    if (!Number.isInteger(state.enhancementLevel) || state.enhancementLevel < 0) return null;
    if (typeof state.isSell !== 'boolean') return null;
    if (state.showPostListing !== undefined && typeof state.showPostListing !== 'boolean') return null;
    if (state.isPostNewListing !== undefined && typeof state.isPostNewListing !== 'boolean') return null;
    if (state.isInstantOrder !== undefined && typeof state.isInstantOrder !== 'boolean') return null;
    if (
        state.enhancementLevelInput !== undefined &&
        (!Number.isInteger(state.enhancementLevelInput) || state.enhancementLevelInput < 0)
    ) {
        return null;
    }

    return {
        marketTabKey: state.marketTabKey,
        marketListingsView: state.marketListingsView,
        itemHrid: state.itemHrid,
        enhancementLevel: state.enhancementLevel,
        enhancementLevelInput: state.enhancementLevelInput,
        isSell: state.isSell,
        showPostListing: state.showPostListing,
        isPostNewListing: state.isPostNewListing,
        isInstantOrder: state.isInstantOrder,
        quantityInput: state.quantityInput,
        priceInput: state.priceInput,
    };
}

/**
 * Read the live Marketplace React component state from the unique visible Marketplace panel.
 * The selected component must be on that panel host fiber's bounded return ancestry.
 *
 * @returns {{ marketTabKey: string, marketListingsView: string, itemHrid: string|null,
 *             enhancementLevel: number, enhancementLevelInput: number|undefined, isSell: boolean,
 *             showPostListing: boolean|undefined, isPostNewListing: boolean|undefined,
 *             isInstantOrder: boolean|undefined, quantityInput: *, priceInput: * }|null}
 */
export function getMarketplaceRuntimeComponentFromElement(element) {
    let fiber = getReactFiberFromElement(element);
    let depth = 0;
    const candidates = [];
    const seen = new Set();

    while (fiber && depth < MAX_REACT_OWNER_DEPTH) {
        const stateNode = fiber.stateNode;
        if (
            stateNode &&
            !seen.has(stateNode) &&
            typeof stateNode.setState === 'function' &&
            typeof stateNode.handleQuantityInputChanged === 'function' &&
            hasMarketplaceStateSignature(stateNode.state)
        ) {
            seen.add(stateNode);
            candidates.push(stateNode);
        }
        fiber = fiber.return;
        depth += 1;
    }

    // Fail closed when the ancestry is unexpectedly deeper than the bound or
    // contains more than one Marketplace-like owner. The quantity input must
    // identify one exact live component before we write to a controlled input.
    if (fiber || candidates.length !== 1) return null;
    return candidates[0];
}

/**
 * Read Marketplace state from the exact DOM element that belongs to the live component.
 * @param {HTMLElement} element
 * @returns {ReturnType<typeof normalizeMarketplaceState>}
 */
export function readMarketplaceRuntimeStateFromElement(element) {
    return normalizeMarketplaceState(getMarketplaceRuntimeComponentFromElement(element)?.state);
}

export function readMarketplaceRuntimeState() {
    const visiblePanels = Array.from(document.querySelectorAll(MARKETPLACE_PANEL_SELECTOR)).filter(isElementVisible);
    if (visiblePanels.length !== 1) return null;
    return readMarketplaceRuntimeStateFromElement(visiblePanels[0]);
}

/**
 * @deprecated Use readMarketplaceRuntimeState() instead.
 * MarketplacePanel_listingsHeader is absent in the current client — this function
 * will return null in production. Retained for test continuity only.
 * @returns {{ itemHrid: string, enhancementLevel: number }|null}
 */
export function readMarketplaceItemIdentity() {
    const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
    if (!panel) return null;

    const itemLink = panel.querySelector('[class*="MarketplacePanel_listingsHeader"] a[href*="/items/"]');
    if (itemLink) {
        const match = itemLink.getAttribute('href')?.match(/\/items\/(.+?)(?:\/|$|\?)/);
        if (match) {
            const itemHrid = `/items/${match[1]}`;
            const enhInput = panel.querySelector(
                '[class*="MarketplacePanel_listingsHeader"] input[type="number"],' +
                    '[class*="MarketplacePanel_listingsHeader"] [class*="enhancementLevel"]'
            );
            const enhancementLevel = enhInput ? parseInt(enhInput.value || '0', 10) : 0;
            return { itemHrid, enhancementLevel: isNaN(enhancementLevel) ? 0 : enhancementLevel };
        }
    }

    const svgUse = panel.querySelector(
        '[class*="MarketplacePanel_listingsHeader"] use[href*="items_sprite"], ' +
            '[class*="MarketplacePanel_listingsHeader"] use[href^="#"]'
    );
    if (svgUse) {
        const href = svgUse.getAttribute('href') || '';
        const fragment = href.includes('#') ? href.split('#')[1] : href;
        if (fragment) {
            return { itemHrid: `/items/${fragment}`, enhancementLevel: 0 };
        }
    }

    return null;
}

/**
 * Create an autofill manager instance for one marketplace workflow owner.
 *
 * Lifecycle:
 *   initialize()      — call once at feature startup; installs the buy-modal observer
 *   startSession(opts) — claim a session slot by sessionId
 *   arm(opts)         — atomically set target; only 'buy' modalMode is accepted
 *   setItem()         — @deprecated, use arm()
 *   setQuantityProvider() — @deprecated, use arm()
 *   exitSession(sessionId) — disarm without ending the marketplace session token
 *   cleanup()         — call on feature disable; removes observer
 *
 * @param {string} observerId
 * @returns {Object}
 */
export function createAutofillManager(observerId) {
    let observerUnregister = null;
    let activeSessionId = null;
    let targetGeneration = 0;
    let activeTarget = null;
    let legacyDraft = null;
    const modalRetryTimers = new Set();
    const filledModalGenerations = new WeakMap();

    function clearRetryTimers() {
        for (const timer of modalRetryTimers) clearTimeout(timer);
        modalRetryTimers.clear();
    }

    function invalidateTarget() {
        clearRetryTimers();
        targetGeneration += 1;
        activeTarget = null;
        legacyDraft = null;
    }

    function isValidItemHrid(itemHrid) {
        return typeof itemHrid === 'string' && itemHrid.startsWith('/items/') && itemHrid.length > 7;
    }

    function isValidEnhancementLevel(enhancementLevel) {
        return Number.isInteger(enhancementLevel) && enhancementLevel >= 0;
    }

    function startSession({
        itemHrid = null,
        enhancementLevel = 0,
        sessionId = null,
        quantityProvider = null,
        modalMode = 'buy',
    } = {}) {
        activeSessionId = marketplaceSession.isActive(sessionId) ? sessionId : null;
        invalidateTarget();

        if (activeSessionId !== null && (itemHrid !== null || quantityProvider !== null)) {
            arm({ sessionId, itemHrid, enhancementLevel, modalMode, quantityProvider });
        }
    }

    function arm(opts = {}) {
        const { sessionId, itemHrid = null, enhancementLevel = 0, modalMode = 'buy', quantityProvider } = opts || {};

        if (sessionId !== activeSessionId) return false;
        if (!marketplaceSession.isActive(sessionId)) {
            activeSessionId = null;
            invalidateTarget();
            return false;
        }

        if (
            modalMode !== 'buy' ||
            !isValidItemHrid(itemHrid) ||
            !isValidEnhancementLevel(enhancementLevel) ||
            typeof quantityProvider !== 'function'
        ) {
            invalidateTarget();
            return false;
        }

        activeTarget = Object.freeze({
            generation: ++targetGeneration,
            sessionId,
            itemHrid,
            enhancementLevel,
            modalMode,
            quantityProvider,
        });
        legacyDraft = null;
        return true;
    }

    /** @deprecated Use arm(). */
    function setItem(itemHrid, enhancementLevel = 0, sessionId) {
        if (sessionId === undefined) {
            invalidateTarget();
            return false;
        }
        if (sessionId !== activeSessionId) return false;
        if (!marketplaceSession.isActive(sessionId)) {
            activeSessionId = null;
            invalidateTarget();
            return false;
        }
        if (!isValidItemHrid(itemHrid) || !isValidEnhancementLevel(enhancementLevel)) {
            invalidateTarget();
            return false;
        }

        invalidateTarget();
        legacyDraft = Object.freeze({ sessionId, itemHrid, enhancementLevel });
        return true;
    }

    /** @deprecated Use arm(). */
    function setQuantityProvider(quantityProvider, sessionId) {
        if (sessionId === undefined) {
            invalidateTarget();
            return false;
        }
        if (sessionId !== activeSessionId) return false;
        if (!legacyDraft || legacyDraft.sessionId !== sessionId) {
            invalidateTarget();
            return false;
        }

        return arm({
            sessionId,
            itemHrid: legacyDraft.itemHrid,
            enhancementLevel: legacyDraft.enhancementLevel,
            modalMode: 'buy',
            quantityProvider,
        });
    }

    function exitSession(sessionId) {
        if (sessionId !== undefined && sessionId !== activeSessionId) return;
        activeSessionId = null;
        invalidateTarget();
    }

    function findWorkingQuantityInput(modal) {
        const structuralInputs = Array.from(
            modal.querySelectorAll('[class*="MarketplacePanel_quantityInputs"] input[type="number"]')
        );
        if (structuralInputs.length === 1) return structuralInputs[0];
        if (structuralInputs.length > 1) return null;

        const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));
        if (allInputs.length === 1) return allInputs[0];

        const labeled = allInputs.filter((input) => {
            let parent = input.parentElement;
            for (let depth = 0; parent && depth < 4; depth += 1) {
                const text = parent.textContent || '';
                if (text.includes('Enhancement Level') && !text.includes('Quantity')) return false;
                if (text.includes('Quantity') && !text.includes('Enhancement Level')) return true;
                parent = parent.parentElement;
            }
            return false;
        });
        return labeled.length === 1 ? labeled[0] : null;
    }

    function isVisibleBuyModal(modal) {
        if (!modal || !modal.isConnected || !isElementVisible(modal)) return false;
        const header = modal.querySelector('[class*="MarketplacePanel_header"]');
        if (!header) return false;
        const text = header.textContent?.trim() || '';
        return text.includes('Buy Now') || text.includes('Buy Listing');
    }

    function resolveQuantity(target) {
        try {
            const quantity = target.quantityProvider();
            return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0;
        } catch (error) {
            console.error('[MarketplaceAutofill] quantityProvider failed:', error);
            return 0;
        }
    }

    function targetMatchesInput(target, quantityInput) {
        const state = readMarketplaceRuntimeStateFromElement(quantityInput);
        return (
            state?.marketTabKey === 'MarketListings' &&
            state?.marketListingsView === 'OrderBook' &&
            state?.showPostListing === true &&
            state?.isPostNewListing === false &&
            state?.isSell === false &&
            state?.isInstantOrder === true &&
            state?.itemHrid === target.itemHrid &&
            state?.enhancementLevel === target.enhancementLevel &&
            state?.enhancementLevelInput === target.enhancementLevel
        );
    }

    function fillVerifiedModal(modal, target) {
        if (!target || activeTarget !== target) return false;
        if (activeSessionId !== target.sessionId || !marketplaceSession.isActive(target.sessionId)) return false;
        if (!isVisibleBuyModal(modal)) return false;
        const quantityInput = findWorkingQuantityInput(modal);
        if (!quantityInput || !targetMatchesInput(target, quantityInput)) return false;

        const quantity = resolveQuantity(target);
        if (quantity <= 0) return false;

        const previousFill = filledModalGenerations.get(modal);
        if (
            previousFill?.generation === target.generation &&
            previousFill.input === quantityInput &&
            previousFill.quantity === quantity &&
            Number(quantityInput.value) === quantity
        ) {
            return true;
        }

        // Re-check ownership after the provider call, immediately before the proven write path.
        if (activeTarget !== target || activeSessionId !== target.sessionId) return false;
        if (!marketplaceSession.isActive(target.sessionId) || !targetMatchesInput(target, quantityInput)) return false;

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (typeof nativeInputValueSetter !== 'function') return false;

        nativeInputValueSetter.call(quantityInput, quantity.toString());
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        filledModalGenerations.set(modal, { generation: target.generation, input: quantityInput, quantity });
        marketplaceSession.consume(target.sessionId);
        return true;
    }

    function handleObservedModal(modal) {
        const target = activeTarget;
        if (!target || !modal) return;

        // The Marketplace modal can mount before its owning React component has
        // converged on the selected item. Retry this observed modal for a bounded
        // 1.5-second window, but keep the verified workflow target armed afterward
        // so an unrelated or retained modal cannot destroy the next exact Buy fill.
        const delays = [0, 25, 75, 150, 300, 500, 750, 1000, 1500];
        delays.forEach((delay) => {
            const timer = setTimeout(() => {
                modalRetryTimers.delete(timer);
                if (!activeTarget || activeTarget.generation !== target.generation) return;
                if (fillVerifiedModal(modal, target)) {
                    clearRetryTimers();
                }
                // Keep the verified target armed after a bounded miss. A retained or unrelated
                // modal must not destroy the workflow; the next exact Buy modal can still fill.
            }, delay);
            modalRetryTimers.add(timer);
        });
    }

    return {
        initialize() {
            if (observerUnregister) observerUnregister();
            observerUnregister = domObserver.onClass(observerId, 'Modal_modalContainer', handleObservedModal);
        },
        startSession,
        arm,
        setItem,
        setQuantityProvider,
        exitSession,
        cleanup() {
            if (observerUnregister) {
                observerUnregister();
                observerUnregister = null;
            }
            activeSessionId = null;
            invalidateTarget();
        },
    };
}
