/**
 * Auto-Click Max Button
 * Automatically clicks the "Max" button in market listing dialogs
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';

class AutoClickMax {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = [];
        this.processedModals = new WeakSet();
        this.isInitialized = false;
    }

    /**
     * Initialize the auto-click max feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.isFeatureEnabled('market_autoClickMax')) {
            return;
        }

        this.isActive = true;
        this.registerDOMObservers();
        this.isInitialized = true;
    }

    /**
     * Register DOM observers to watch for market listing modals
     */
    registerDOMObservers() {
        const unregister = domObserver.onClass('auto-click-max', 'Modal_modalContainer', (modal) => {
            this.handleOrderModal(modal);
        });
        this.unregisterHandlers.push(unregister);
    }

    /**
     * Handle market order modal appearance
     * @param {HTMLElement} modal - Modal container element
     */
    handleOrderModal(modal) {
        if (!this.isActive || !modal || this.processedModals.has(modal)) {
            return;
        }

        // Check if this is a market modal
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) {
            return;
        }

        const headerText = header.textContent;

        // Skip all buy modals (Buy Listing, Buy Now)
        if (headerText.includes('Buy')) {
            return;
        }

        // Only process sell modals (Sell Listing, Sell Now)
        if (!headerText.includes('Sell')) {
            return;
        }

        // Mark as processed
        this.processedModals.add(modal);

        // Click the Max/All button
        this.findAndClickMaxButton(modal);
    }

    /**
     * Find and click the Max or All button in the modal
     * @param {HTMLElement} modal - Modal container element
     */
    findAndClickMaxButton(modal) {
        if (!modal) {
            return;
        }

        // Find Max button (Sell Listing) or All button (Sell Now)
        const allButtons = modal.querySelectorAll('button');
        const maxButton = Array.from(allButtons).find((btn) => {
            const text = btn.textContent.trim();
            return text === 'Max' || text === 'All';
        });

        if (!maxButton) {
            return;
        }

        // Don't click if button is disabled
        if (maxButton.disabled) {
            return;
        }

        // Click the Max/All button
        try {
            maxButton.click();
        } catch (error) {
            console.error('[AutoClickMax] Failed to click Max/All button:', error);
        }
    }

    /**
     * Disable and cleanup
     */
    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.processedModals = new WeakSet();
        this.isActive = false;
        this.isInitialized = false;
    }
}

const autoClickMax = new AutoClickMax();

export default autoClickMax;
