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
import { t } from '../../core/i18n.js';
import { formatKMB } from '../../utils/formatters.js';
import { MARKET_TAX, COWBELL_BAG_HRID, COWBELL_BAG_TAX } from '../../utils/profit-constants.js';

class MarketOrderTotals {
    constructor() {
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.isInitialized = false;
        this.displayElement = null;
        this.marketplaceClickHandler = (event) => {
            event.preventDefault();
            this.openMarketplace();
        };
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

        // Setup data listeners for listing updates
        this.setupDataListeners();

        // Setup DOM observer for header
        this.setupObserver();
    }

    /**
     * Setup WebSocket listeners to detect listing changes
     */
    setupDataListeners() {
        const updateHandler = () => {
            this.updateDisplay();
        };

        dataManager.on('market_listings_updated', updateHandler);
        dataManager.on('character_initialized', updateHandler);

        this.unregisterWebSocket = () => {
            dataManager.off('market_listings_updated', updateHandler);
            dataManager.off('character_initialized', updateHandler);
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
            if (!listing) {
                continue;
            }

            // Unclaimed coins
            unclaimed += listing.unclaimedCoinCount || 0;

            // Skip cancelled or fully claimed listings
            if (
                listing.status === '/market_listing_status/cancelled' ||
                (listing.status === '/market_listing_status/filled' &&
                    (listing.unclaimedItemCount || 0) === 0 &&
                    (listing.unclaimedCoinCount || 0) === 0)
            ) {
                continue;
            }

            if (listing.isSell) {
                // Sell orders: Calculate expected proceeds after tax
                if (listing.status === '/market_listing_status/filled') {
                    continue;
                }

                const tax = listing.itemHrid === COWBELL_BAG_HRID ? 1 - COWBELL_BAG_TAX : 1 - MARKET_TAX;
                const remainingQuantity = Math.max(0, listing.orderQuantity - listing.filledQuantity);

                if (remainingQuantity > 0) {
                    sellOrders += remainingQuantity * Math.floor(listing.price * tax);
                }
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
            gap: 8px;
            font-size: 0.85em;
            color: #aaa;
            margin-top: 4px;
            padding: 2px 0;
            white-space: nowrap;
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
            const headerElement = document.querySelector('[class*="Header_totalLevel"]');
            if (headerElement) {
                this.injectDisplay(headerElement);
            }

            if (!this.displayElement || !document.body.contains(this.displayElement)) {
                return;
            }
        }

        const totals = this.calculateTotals();

        // Check if we have no data yet (all zeros)
        const hasNoData = totals.buyOrders === 0 && totals.sellOrders === 0 && totals.unclaimed === 0;

        this.displayElement.style.justifyContent = hasNoData ? 'flex-end' : 'flex-start';
        this.displayElement.style.width = hasNoData ? '100%' : '';

        if (hasNoData) {
            const marketplaceIcon = this.getMarketplaceIcon();
            const noOrdersTitle = t('marketOrderTotals.noOrdersTitle');
            this.displayElement.innerHTML = `
                <button
                    type="button"
                    class="mwi-market-order-totals-link"
                    title="${noOrdersTitle}"
                    aria-label="${noOrdersTitle}"
                    style="background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center;"
                >
                    ${marketplaceIcon}
                </button>
            `;

            const linkButton = this.displayElement.querySelector('.mwi-market-order-totals-link');
            if (linkButton) {
                linkButton.addEventListener('click', this.marketplaceClickHandler);
            }

            return;
        }

        // Format values for display
        const boValue = formatKMB(totals.buyOrders);
        const soValue = formatKMB(totals.sellOrders);
        const unclaimedValue = formatKMB(totals.unclaimed);

        const itemStyle = 'display: flex; align-items: center; gap: 4px;';
        const tileStyle =
            'display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 8px; font-size: 11px; flex: none;';

        // Brynless Mode drops the BO/SO icon tiles but keeps their text labels. The unclaimed tile
        // stays: it is the only thing identifying that number.
        const showOrderIcons = !config.getSetting('market_brynlessMode');
        const buyIcon = showOrderIcons
            ? `<span style="${tileStyle} background: rgba(124, 184, 255, 0.16);">🛒</span>`
            : '';
        const sellIcon = showOrderIcons
            ? `<span style="${tileStyle} background: rgba(74, 222, 128, 0.16);">🏷</span>`
            : '';

        // Update display
        this.displayElement.innerHTML = `
            <div style="${itemStyle}" title="${t('marketOrderTotals.buyOrdersTooltip')}">
                ${buyIcon}
                <span style="color: #888; font-weight: 500;">${t('marketOrderTotals.buyOrdersLabel')}</span>
                <span style="color: #7cb8ff; font-weight: 600;">${boValue}</span>
            </div>
            <div style="${itemStyle}" title="${t('marketOrderTotals.sellOrdersTooltip')}">
                ${sellIcon}
                <span style="color: #888; font-weight: 500;">${t('marketOrderTotals.sellOrdersLabel')}</span>
                <span style="color: #4ade80; font-weight: 600;">${soValue}</span>
            </div>
            <div style="${itemStyle}" title="${t('marketOrderTotals.unclaimedTooltip')}">
                <span style="${tileStyle} background: rgba(251, 191, 36, 0.16);">💰</span>
                <span style="color: #fbbf24; font-weight: 600;">${unclaimedValue}</span>
            </div>
        `;
    }

    /**
     * Open the marketplace view
     */
    openMarketplace() {
        try {
            const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
            const marketplaceButton = Array.from(navButtons).find((nav) => {
                const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
                return svg !== null;
            });

            if (!marketplaceButton) {
                console.error('[MarketOrderTotals] Marketplace navbar button not found');
                return;
            }

            marketplaceButton.click();
        } catch (error) {
            console.error('[MarketOrderTotals] Failed to open marketplace:', error);
        }
    }

    /**
     * Build marketplace icon markup using navbar icon (fallback to emoji).
     * @returns {string} HTML string for icon
     */
    getMarketplaceIcon() {
        const navIcon = document.querySelector('svg[aria-label="navigationBar.marketplace"]');
        if (navIcon) {
            const clonedIcon = navIcon.cloneNode(true);
            clonedIcon.setAttribute('width', '16');
            clonedIcon.setAttribute('height', '16');
            clonedIcon.setAttribute('aria-hidden', 'true');
            return clonedIcon.outerHTML;
        }

        return '<span aria-hidden="true">🏪</span>';
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

const marketOrderTotals = new MarketOrderTotals();

export default marketOrderTotals;
export { MarketOrderTotals };
