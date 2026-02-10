/**
 * Marketplace Buy Modal Autofill Utility
 * Provides shared functionality for auto-filling quantity in marketplace buy modals
 * Used by missing materials features (actions, houses, etc.)
 */

import domObserver from '../core/dom-observer.js';

/**
 * Find the quantity input in the buy modal
 * For equipment items, there are multiple number inputs (enhancement level + quantity)
 * We need to find the correct one by checking parent containers for label text
 * @param {HTMLElement} modal - Modal container element
 * @returns {HTMLInputElement|null} Quantity input element or null
 */
function findQuantityInput(modal) {
    // Get all number inputs in the modal
    const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));

    if (allInputs.length === 0) {
        return null;
    }

    if (allInputs.length === 1) {
        // Only one input - must be quantity
        return allInputs[0];
    }

    // Multiple inputs - identify by checking CLOSEST parent first
    // Strategy 1: Check each parent level individually, prioritizing closer parents
    // This prevents matching on the outermost container that has all text
    for (let level = 0; level < 4; level++) {
        for (let i = 0; i < allInputs.length; i++) {
            const input = allInputs[i];
            let parent = input.parentElement;

            // Navigate to the specific level
            for (let j = 0; j < level && parent; j++) {
                parent = parent.parentElement;
            }

            if (!parent) continue;

            const text = parent.textContent;

            // At this specific level, check if it contains "Quantity" but NOT "Enhancement Level"
            if (text.includes('Quantity') && !text.includes('Enhancement Level')) {
                return input;
            }
        }
    }

    // Strategy 2: Exclude inputs that have "Enhancement Level" in close parents (level 0-2)
    for (let i = 0; i < allInputs.length; i++) {
        const input = allInputs[i];
        let parent = input.parentElement;
        let isEnhancementInput = false;

        // Check only the first 3 levels (not the outermost container)
        for (let j = 0; j < 3 && parent; j++) {
            const text = parent.textContent;

            if (text.includes('Enhancement Level') && !text.includes('Quantity')) {
                isEnhancementInput = true;
                break;
            }

            parent = parent.parentElement;
        }

        if (!isEnhancementInput) {
            return input;
        }
    }

    // Fallback: Return first input and log warning
    console.warn('[MarketplaceAutofill] Could not definitively identify quantity input, using first input');
    return allInputs[0];
}

/**
 * Handle buy modal appearance and auto-fill quantity if available
 * @param {HTMLElement} modal - Modal container element
 * @param {number|null} activeQuantity - Quantity to auto-fill (null if none)
 */
function handleBuyModal(modal, activeQuantity) {
    // Check if we have an active quantity to fill
    if (!activeQuantity || activeQuantity <= 0) {
        return;
    }

    // Check if this is a "Buy Now" modal
    const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
    if (!header) {
        return;
    }

    const headerText = header.textContent.trim();
    if (!headerText.includes('Buy Now')) {
        return;
    }

    // Find the quantity input - need to be specific to avoid enhancement level input
    const quantityInput = findQuantityInput(modal);
    if (!quantityInput) {
        return;
    }

    // Set the quantity value
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(quantityInput, activeQuantity.toString());

    // Trigger input event to notify React
    const inputEvent = new Event('input', { bubbles: true });
    quantityInput.dispatchEvent(inputEvent);
}

/**
 * Create an autofill manager instance
 * Manages storing quantity to autofill and observing buy modals
 * @param {string} observerId - Unique ID for this observer (e.g., 'MissingMats-Actions')
 * @returns {Object} Autofill manager with methods: setQuantity, clearQuantity, initialize, cleanup
 */
export function createAutofillManager(observerId) {
    let activeQuantity = null;
    let observerUnregister = null;

    return {
        /**
         * Set the quantity to auto-fill in the next buy modal
         * @param {number} quantity - Quantity to auto-fill
         */
        setQuantity(quantity) {
            activeQuantity = quantity;
        },

        /**
         * Clear the stored quantity (cancel autofill)
         */
        clearQuantity() {
            activeQuantity = null;
        },

        /**
         * Get the current active quantity
         * @returns {number|null} Current quantity or null
         */
        getQuantity() {
            return activeQuantity;
        },

        /**
         * Initialize buy modal observer
         * Sets up watching for buy modals to appear and auto-fills them
         */
        initialize() {
            observerUnregister = domObserver.onClass(observerId, 'Modal_modalContainer', (modal) => {
                handleBuyModal(modal, activeQuantity);
            });
        },

        /**
         * Cleanup observer
         * Stops watching for buy modals and clears quantity
         */
        cleanup() {
            if (observerUnregister) {
                observerUnregister();
                observerUnregister = null;
            }
            activeQuantity = null;
        },
    };
}
