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

        // Check if this is a Buy/Sell listing modal (not Instant Buy/Sell)
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) {
            return;
        }

        const headerText = header.textContent;

        // Skip Instant Buy/Sell modals (they don't have Max button for quantity)
        if (headerText.includes('Now')) {
            return;
        }

        // Only process Buy Listing or Sell Listing modals
        if (!headerText.includes('Listing')) {
            return;
        }

        // Determine if this is a sell order by checking the price label
        // Only auto-click Max for sell orders (not buy orders)
        const priceLabel = modal.querySelector('div[class*="MarketplacePanel_priceLabel"]');
        if (!priceLabel) {
            return;
        }

        const labelText = priceLabel.textContent.toLowerCase();
        const isSellOrder = labelText.includes('best sell');

        if (!isSellOrder) {
            return; // Skip buy orders
        }

        // Mark as processed
        this.processedModals.add(modal);

        // Click the Max button
        this.findAndClickMaxButton(modal);
    }

    /**
     * Find and click the Max button in the modal
     * @param {HTMLElement} modal - Modal container element
     */
    findAndClickMaxButton(modal) {
        if (!modal) {
            return;
        }

        // Strategy 1: Find Max button by text content
        const allButtons = modal.querySelectorAll('button');
        const maxButton = Array.from(allButtons).find((btn) => {
            const text = btn.textContent.trim();
            return text === 'Max';
        });

        if (!maxButton) {
            // Button might not be rendered yet or modal structure changed
            return;
        }

        // Don't click if button is disabled
        if (maxButton.disabled) {
            return;
        }

        // Click the Max button
        try {
            maxButton.click();
        } catch (error) {
            console.error('[AutoClickMax] Failed to click Max button:', error);
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
