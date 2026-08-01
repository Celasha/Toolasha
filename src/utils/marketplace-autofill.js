/**
 * Marketplace Buy Modal Autofill Utility
 * Session-aware autofill manager.  Each consumer calls createAutofillManager() to get
 * an instance, then drives it with startSession / setItem / setQuantityProvider / exitSession.
 *
 * Exported helpers:
 *   readMarketplaceItemIdentity()  — reads the currently displayed marketplace item
 *   createAutofillManager(observerId)
 */

import domObserver from '../core/dom-observer.js';
import { marketplaceSession } from '../core/marketplace-session.js';

/**
 * Read the item identity currently shown in the marketplace buy/browse panel.
 * Returns null when no item is displayed or the panel is not visible.
 * @returns {{ itemHrid: string, enhancementLevel: number }|null}
 */
export function readMarketplaceItemIdentity() {
    // Look for the active marketplace item header area
    const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
    if (!panel) return null;

    // The item name appears in a header with an SVG icon whose aria-label is the item name,
    // or via a link element that encodes the item HRID.
    // Primary signal: <a href="/items/..."> or SVG <use href="#..."> within the panel header
    const itemLink = panel.querySelector('[class*="MarketplacePanel_listingsHeader"] a[href*="/items/"]');
    if (itemLink) {
        const match = itemLink.getAttribute('href')?.match(/\/items\/(.+?)(?:\/|$|\?)/);
        if (match) {
            const itemHrid = `/items/${match[1]}`;
            // Enhancement level: look for a nearby text like "+3" or an input labelled Enhancement Level
            const enhInput = panel.querySelector(
                '[class*="MarketplacePanel_listingsHeader"] input[type="number"],' +
                    '[class*="MarketplacePanel_listingsHeader"] [class*="enhancementLevel"]'
            );
            const enhancementLevel = enhInput ? parseInt(enhInput.value || '0', 10) : 0;
            return { itemHrid, enhancementLevel: isNaN(enhancementLevel) ? 0 : enhancementLevel };
        }
    }

    // Fallback: find <use href="#item_name"> in the panel heading area
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
 * Fails closed — returns null when the input cannot be positively identified.
 * @param {HTMLElement} modal
 * @returns {HTMLInputElement|null}
 */
function findQuantityInput(modal) {
    const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));
    if (allInputs.length === 0) return null;
    if (allInputs.length === 1) return allInputs[0];

    // Multiple inputs: identify the quantity input by proximity to label text.
    // Walk up 0–3 levels, looking for a container that mentions "Quantity" but not
    // "Enhancement Level" — stop at the first (most specific) match.
    for (let level = 0; level < 4; level++) {
        for (const input of allInputs) {
            let parent = input.parentElement;
            for (let j = 0; j < level && parent; j++) parent = parent.parentElement;
            if (!parent) continue;
            const text = parent.textContent;
            if (text.includes('Quantity') && !text.includes('Enhancement Level')) return input;
        }
    }

    // Exclude inputs whose close parents (0–2 levels) mention "Enhancement Level" only.
    for (const input of allInputs) {
        let parent = input.parentElement;
        let isEnh = false;
        for (let j = 0; j < 3 && parent; j++) {
            if (parent.textContent.includes('Enhancement Level') && !parent.textContent.includes('Quantity')) {
                isEnh = true;
                break;
            }
            parent = parent.parentElement;
        }
        if (!isEnh) return input;
    }

    // Could not positively identify — fail closed
    return null;
}

/**
 * Create an autofill manager instance for one marketplace workflow owner.
 *
 * Lifecycle:
 *   initialize()          — call once at feature startup; installs the buy-modal observer
 *   startSession(opts)    — arm for a workflow; returns sessionId
 *   setItem(hrid, enh)    — record the item this session expects
 *   setQuantityProvider(fn, sessionId) — set the lazy quantity callback for a session
 *   exitSession(sessionId) — disarm without ending the marketplace session token
 *   cleanup()             — call on feature disable; removes observer
 *
 * @param {string} observerId
 * @returns {Object}
 */
export function createAutofillManager(observerId) {
    let observerUnregister = null;

    // Per-session state
    let activeSessionId = null;
    let expectedItemHrid = null;
    let expectedEnhancementLevel = 0;
    let quantityProvider = null; // () => number|null

    /**
     * Arm the autofill manager for a new session.
     * Clears any previous session state.
     * @param {Object} [opts]
     * @param {string} [opts.itemHrid] - Expected marketplace item HRID
     * @param {number} [opts.enhancementLevel] - Expected enhancement level (default 0)
     * @param {number} [opts.sessionId] - The marketplaceSession token for this workflow
     * @param {Function} [opts.quantityProvider] - () => number|null
     */
    function startSession({
        itemHrid = null,
        enhancementLevel = 0,
        sessionId = null,
        quantityProvider: qp = null,
    } = {}) {
        activeSessionId = sessionId;
        expectedItemHrid = itemHrid;
        expectedEnhancementLevel = enhancementLevel;
        quantityProvider = qp;
    }

    function setItem(itemHrid, enhancementLevel = 0) {
        expectedItemHrid = itemHrid;
        expectedEnhancementLevel = enhancementLevel;
    }

    function setQuantityProvider(fn, sessionId) {
        // Guard: only accept if sessionId matches (prevents stale callers from arming)
        if (sessionId !== undefined && sessionId !== activeSessionId) return;
        quantityProvider = fn;
    }

    function exitSession(sessionId) {
        if (sessionId !== undefined && sessionId !== activeSessionId) return;
        activeSessionId = null;
        expectedItemHrid = null;
        expectedEnhancementLevel = 0;
        quantityProvider = null;
    }

    function handleBuyModal(modal) {
        // Must have a quantity provider
        if (!quantityProvider) return;

        // Must have a valid session token
        if (activeSessionId === null) return;
        if (!marketplaceSession.isActive(activeSessionId)) {
            // Session was replaced externally — disarm
            activeSessionId = null;
            quantityProvider = null;
            return;
        }

        // Must be a Buy Now / Buy Listing modal
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;
        const headerText = header.textContent.trim();
        if (!headerText.includes('Buy Now') && !headerText.includes('Buy Listing')) return;

        // Item identity check — fail closed
        if (expectedItemHrid !== null) {
            const identity = readMarketplaceItemIdentity();
            if (!identity) return; // Cannot confirm item — do not write
            if (identity.itemHrid !== expectedItemHrid) return;
            if (identity.enhancementLevel !== expectedEnhancementLevel) return;
        }

        const quantity = quantityProvider();
        if (!quantity || quantity <= 0) return;

        const quantityInput = findQuantityInput(modal);
        if (!quantityInput) return;

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(quantityInput, quantity.toString());
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Consume one-shot session
        marketplaceSession.consume(activeSessionId);
    }

    return {
        /** Install the buy-modal observer. Call once at feature startup. */
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
        setItem,
        setQuantityProvider,
        exitSession,

        /** Remove observer and disarm. Call at feature disable. */
        cleanup() {
            if (observerUnregister) {
                observerUnregister();
                observerUnregister = null;
            }
            activeSessionId = null;
            expectedItemHrid = null;
            expectedEnhancementLevel = 0;
            quantityProvider = null;
        },
    };
}
