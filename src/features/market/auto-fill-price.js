/**
 * Auto-Fill Market Price
 * Automatically fills marketplace order forms with optimal competitive pricing
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class AutoFillPrice {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = [];
        this.processedModals = new WeakSet(); // Track processed modals to prevent duplicates
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize auto-fill price feature
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('fillMarketOrderPrice')) {
            return;
        }

        this.isInitialized = true;

        // Register DOM observer for marketplace order modals
        this.registerDOMObservers();

        this.isActive = true;
    }

    /**
     * Register DOM observers for order modals
     */
    registerDOMObservers() {
        // Watch for order modals appearing
        const unregister = domObserver.onClass('auto-fill-price', 'Modal_modalContainer', (modal) => {
            // Check if this is a marketplace order modal (not instant buy/sell)
            const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
            if (!header) return;

            const headerText = header.textContent.trim();

            // Skip instant buy/sell modals (contain "Now" in title)
            if (headerText.includes(' Now')) {
                return;
            }

            // Handle the order modal
            this.handleOrderModal(modal);
        });

        this.unregisterHandlers.push(unregister);
    }

    /**
     * Handle new order modal
     * @param {HTMLElement} modal - Modal container element
     */
    handleOrderModal(modal) {
        // Prevent duplicate processing (dom-observer can fire multiple times for same modal)
        if (this.processedModals.has(modal)) {
            return;
        }
        this.processedModals.add(modal);

        // Find the "Best Price" button/label
        const bestPriceLabel = modal.querySelector('span[class*="MarketplacePanel_bestPrice"]');
        if (!bestPriceLabel) {
            return;
        }

        // Determine if this is a buy or sell order
        const labelParent = bestPriceLabel.parentElement;
        const labelText = labelParent.textContent.toLowerCase();

        const isBuyOrder = labelText.includes('best buy');
        const isSellOrder = labelText.includes('best sell');

        if (!isBuyOrder && !isSellOrder) {
            return;
        }

        // Click the best price label to populate the suggested price
        bestPriceLabel.click();

        // Adjust price after clicking to be optimally competitive
        // For buy orders: increment by 1 to outbid
        // For sell orders: depends on user setting (match or undercut)
        const adjustTimeout = setTimeout(() => {
            this.adjustPrice(modal, isBuyOrder, isSellOrder);
        }, 50);
        this.timerRegistry.registerTimeout(adjustTimeout);
    }

    /**
     * Adjust the price to be optimally competitive
     * @param {HTMLElement} modal - Modal container element
     * @param {boolean} isBuyOrder - True if buy order
     * @param {boolean} isSellOrder - True if sell order
     */
    adjustPrice(modal, isBuyOrder, isSellOrder) {
        // Find the price input container
        const inputContainer = modal.querySelector(
            'div[class*="MarketplacePanel_inputContainer"] div[class*="MarketplacePanel_priceInputs"]'
        );
        if (!inputContainer) {
            return;
        }

        // Find the increment/decrement buttons
        const buttonContainers = inputContainer.querySelectorAll('div[class*="MarketplacePanel_buttonContainer"]');

        if (buttonContainers.length < 3) {
            return;
        }

        if (isBuyOrder) {
            // For buy orders: click the 3rd button container's button (increment)
            const targetContainer = buttonContainers[2];
            const button = targetContainer.querySelector('div button');
            if (button) {
                button.click();
            }
        } else if (isSellOrder) {
            // For sell orders: check user setting
            const sellStrategy = config.getSettingValue('market_autoFillSellStrategy', 'match');

            if (sellStrategy === 'undercut') {
                // Click the 2nd button container's button (decrement)
                const targetContainer = buttonContainers[1];
                const button = targetContainer.querySelector('div button');
                if (button) {
                    button.click();
                }
            }
            // If 'match', do nothing (use best sell price as-is)
        }
    }

    /**
     * Cleanup on disable
     */
    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.timerRegistry.clearAll();
        this.isActive = false;
        this.isInitialized = false;
    }
}

const autoFillPrice = new AutoFillPrice();

export default autoFillPrice;
