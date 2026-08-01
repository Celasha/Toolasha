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
const MAX_FIBER_ANCESTRY = 64;

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

function getReactFiberFromElement(element) {
    const fiberKey = Object.getOwnPropertyNames(element).find((key) =>
        REACT_FIBER_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    return fiberKey ? element[fiberKey] : null;
}

function normalizeMarketplaceState(state) {
    if (!hasMarketplaceStateSignature(state)) return null;
    if (typeof state.marketTabKey !== 'string' || typeof state.marketListingsView !== 'string') return null;
    if (state.itemHrid !== null && (typeof state.itemHrid !== 'string' || !state.itemHrid)) return null;
    if (!Number.isInteger(state.enhancementLevel) || state.enhancementLevel < 0) return null;
    if (typeof state.isSell !== 'boolean') return null;

    return {
        marketTabKey: state.marketTabKey,
        marketListingsView: state.marketListingsView,
        itemHrid: state.itemHrid,
        enhancementLevel: state.enhancementLevel,
        isSell: state.isSell,
        quantityInput: state.quantityInput,
        priceInput: state.priceInput,
    };
}

/**
 * Read the live Marketplace React component state from the unique visible Marketplace panel.
 * The selected component must be on that panel host fiber's bounded return ancestry.
 *
 * @returns {{ marketTabKey: string, marketListingsView: string, itemHrid: string|null,
 *             enhancementLevel: number, isSell: boolean,
 *             quantityInput: *, priceInput: * }|null}
 */
export function readMarketplaceRuntimeState() {
    const visiblePanels = Array.from(document.querySelectorAll(MARKETPLACE_PANEL_SELECTOR)).filter(isElementVisible);
    if (visiblePanels.length !== 1) return null;

    let fiber = getReactFiberFromElement(visiblePanels[0]);
    if (!fiber) return null;

    const candidates = [];
    const seenStateNodes = new Set();
    let depth = 0;

    while (fiber && depth < MAX_FIBER_ANCESTRY) {
        const stateNode = fiber.stateNode;
        const state = stateNode?.state;
        if (hasMarketplaceStateSignature(state) && !seenStateNodes.has(stateNode)) {
            seenStateNodes.add(stateNode);
            candidates.push(state);
        }
        fiber = fiber.return;
        depth += 1;
    }

    // Fail closed if the ancestry exceeds the explicit bound or is ambiguous.
    if (fiber || candidates.length !== 1) return null;
    return normalizeMarketplaceState(candidates[0]);
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
 * Find the quantity input in the buy modal.
 * Requires exactly one input under MarketplacePanel_quantityInputs — fails closed otherwise.
 * @param {HTMLElement} modal
 * @returns {HTMLInputElement|null}
 */
function findQuantityInput(modal) {
    const inputs = modal.querySelectorAll('[class*="MarketplacePanel_quantityInputs"] input[type="number"]');
    if (inputs.length !== 1) return null;
    return inputs[0];
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

    function invalidateTarget() {
        targetGeneration += 1;
        activeTarget = null;
        legacyDraft = null;
    }

    function clearTargetIfCurrent(target) {
        if (activeTarget === target) invalidateTarget();
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

    /**
     * Atomically install one immutable autofill target generation.
     * An invalid arm for the current session disarms the previous target.
     * A stale session token is a no-op and cannot clear a newer target.
     *
     * @param {Object} opts
     * @returns {boolean} True when a new target was armed
     */
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

        const generation = ++targetGeneration;
        activeTarget = Object.freeze({
            generation,
            sessionId,
            itemHrid,
            enhancementLevel,
            modalMode,
            quantityProvider,
        });
        legacyDraft = null;
        return true;
    }

    /**
     * @deprecated Use arm(). Temporary compatibility wrapper for staged consumer migration.
     * Requires the exact active session token and does not mutate the live target.
     */
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

    /**
     * @deprecated Use arm(). Installs a target only when paired with a token-scoped setItem().
     */
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

    function handleBuyModal(modal) {
        const target = activeTarget;
        if (!target) return;

        if (activeSessionId !== target.sessionId || !marketplaceSession.isActive(target.sessionId)) {
            clearTargetIfCurrent(target);
            return;
        }

        const runtimeState = readMarketplaceRuntimeState();
        if (
            !runtimeState ||
            runtimeState.isSell !== false ||
            runtimeState.marketTabKey !== 'MarketListings' ||
            runtimeState.marketListingsView !== 'OrderBook' ||
            runtimeState.itemHrid !== target.itemHrid ||
            runtimeState.enhancementLevel !== target.enhancementLevel
        ) {
            clearTargetIfCurrent(target);
            return;
        }

        const quantityInput = findQuantityInput(modal);
        if (!quantityInput) {
            clearTargetIfCurrent(target);
            return;
        }

        let quantity;
        try {
            quantity = target.quantityProvider();
        } catch (error) {
            console.error('[MarketplaceAutofill] quantityProvider failed:', error);
            clearTargetIfCurrent(target);
            return;
        }

        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
            clearTargetIfCurrent(target);
            return;
        }

        // The provider may synchronously re-arm, exit, or replace the session.
        // Recheck the captured generation and token immediately before writing.
        if (activeTarget !== target || activeTarget.generation !== target.generation) return;
        if (activeSessionId !== target.sessionId || !marketplaceSession.isActive(target.sessionId)) {
            clearTargetIfCurrent(target);
            return;
        }

        if (!quantityInput.isConnected || !modal.contains(quantityInput)) {
            clearTargetIfCurrent(target);
            return;
        }

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (typeof nativeInputValueSetter !== 'function') {
            clearTargetIfCurrent(target);
            return;
        }

        nativeInputValueSetter.call(quantityInput, quantity.toString());
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        marketplaceSession.consume(target.sessionId);
    }

    return {
        initialize() {
            if (observerUnregister) {
                observerUnregister();
                observerUnregister = null;
            }
            observerUnregister = domObserver.onClass(observerId, 'Modal_modalContainer', (modal) => {
                handleBuyModal(modal);
            });
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
