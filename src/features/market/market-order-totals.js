/**
 * Market Order Totals Module
 *
 * Displays market listing totals in the header area:
 * - Buy Orders (BO): Coins locked in buy orders
 * - Sell Orders (SO): Expected proceeds from sell orders
 * - Unclaimed (💰): Coins waiting to be collected
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import webSocketHook from '../../core/websocket.js';
import { formatKMB } from '../../utils/formatters.js';

class MarketOrderTotals {
    constructor() {
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.isInitialized = false;
        this.displayElement = null;
    }

    /**
     * Initialize the market order totals feature
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showOrderTotals')) {
            return;
        }

        this.isInitialized = true;

        // Setup WebSocket listeners for listing updates
        this.setupWebSocketListeners();

        // Setup DOM observer for header
        this.setupObserver();
    }

    /**
     * Setup WebSocket listeners to detect listing changes
     */
    setupWebSocketListeners() {
        const updateHandler = () => {
            this.updateDisplay();
        };

        webSocketHook.on('market_listings_updated', updateHandler);
        webSocketHook.on('init_character_data', updateHandler);

        this.unregisterWebSocket = () => {
            webSocketHook.off('market_listings_updated', updateHandler);
            webSocketHook.off('init_character_data', updateHandler);
        };
    }

    /**
     * Setup DOM observer for header area
     */
    setupObserver() {
        // 1. Check if element already exists (handles late initialization)
        const existingElem = document.querySelector('[class*="Header_totalLevel"]');
        if (existingElem) {
            this.injectDisplay(existingElem);
        }

        // 2. Watch for future additions (handles SPA navigation, page reloads)
        this.unregisterObserver = domObserver.onClass('MarketOrderTotals', 'Header_totalLevel', (totalLevelElem) => {
            this.injectDisplay(totalLevelElem);
        });
    }

    /**
     * Calculate market order totals from all listings
     * @returns {Object} Totals object with buyOrders, sellOrders, unclaimed
     */
    calculateTotals() {
        const listings = dataManager.getMarketListings();

        let buyOrders = 0;
        let sellOrders = 0;
        let unclaimed = 0;

        for (const listing of listings) {
            // Unclaimed coins
            unclaimed += listing.unclaimedCoinCount || 0;

            if (listing.isSell) {
                // Sell orders: Calculate expected proceeds after tax
                const tax = listing.itemHrid === '/items/bag_of_10_cowbells' ? 0.82 : 0.98;
                const remainingQuantity = listing.orderQuantity - listing.filledQuantity;
                sellOrders += remainingQuantity * Math.floor(listing.price * tax);
            } else {
                // Buy orders: Prepaid coins locked in the order
                buyOrders += listing.coinsAvailable || 0;
            }
        }

        return {
            buyOrders,
            sellOrders,
            unclaimed,
        };
    }

    /**
     * Inject display element into header
     * @param {HTMLElement} totalLevelElem - Total level element
     */
    injectDisplay(totalLevelElem) {
        // Skip if already injected
        if (this.displayElement && document.body.contains(this.displayElement)) {
            return;
        }

        // Create display container
        this.displayElement = document.createElement('div');
        this.displayElement.classList.add('mwi-market-order-totals');
        this.displayElement.style.cssText = `
            display: flex;
            gap: 12px;
            font-size: 0.85em;
            color: #aaa;
            margin-top: 4px;
            padding: 2px 0;
        `;

        // Find the networth header (if it exists) and insert after it
        // Otherwise insert after total level
        const networthHeader = document.querySelector('.mwi-networth-header');
        if (networthHeader) {
            networthHeader.insertAdjacentElement('afterend', this.displayElement);
        } else {
            totalLevelElem.insertAdjacentElement('afterend', this.displayElement);
        }

        // Initial update
        this.updateDisplay();
    }

    /**
     * Update the display with current totals
     */
    updateDisplay() {
        if (!this.displayElement || !document.body.contains(this.displayElement)) {
            return;
        }

        const totals = this.calculateTotals();

        // Check if we have no data yet (all zeros)
        const hasNoData = totals.buyOrders === 0 && totals.sellOrders === 0 && totals.unclaimed === 0;

        // Format values or show marketplace icon
        const boDisplay = hasNoData
            ? '<svg width="16" height="16"><use href="/static/media/misc_sprite.f614f988.svg#marketplace"></use></svg>'
            : `<span style="color: #ffd700;">${formatKMB(totals.buyOrders)}</span>`;

        const soDisplay = hasNoData
            ? '<svg width="16" height="16"><use href="/static/media/misc_sprite.f614f988.svg#marketplace"></use></svg>'
            : `<span style="color: #ffd700;">${formatKMB(totals.sellOrders)}</span>`;

        const unclaimedDisplay = hasNoData
            ? '<svg width="16" height="16"><use href="/static/media/misc_sprite.f614f988.svg#marketplace"></use></svg>'
            : `<span style="color: #ffd700;">${formatKMB(totals.unclaimed)}</span>`;

        // Update display
        this.displayElement.innerHTML = `
            <div style="display: flex; align-items: center; gap: 4px;" title="Buy Orders (coins locked in buy orders)">
                <span style="color: #888; font-weight: 500;">BO:</span>
                ${boDisplay}
            </div>
            <div style="display: flex; align-items: center; gap: 4px;" title="Sell Orders (expected proceeds after tax)">
                <span style="color: #888; font-weight: 500;">SO:</span>
                ${soDisplay}
            </div>
            <div style="display: flex; align-items: center; gap: 4px;" title="Unclaimed coins (waiting to be collected)">
                <span style="font-weight: 500;">💰:</span>
                ${unclaimedDisplay}
            </div>
        `;
    }

    /**
     * Clear all displays
     */
    clearDisplay() {
        if (this.displayElement) {
            this.displayElement.remove();
            this.displayElement = null;
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.unregisterWebSocket) {
            this.unregisterWebSocket();
            this.unregisterWebSocket = null;
        }

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        this.clearDisplay();
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const marketOrderTotals = new MarketOrderTotals();

export default marketOrderTotals;
