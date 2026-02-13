/**
 * Queue Length Estimator Module
 *
 * Displays total quantity available at the best price in order books
 * - Shows below Buy/Sell buttons on the market order book page
 * - Estimates total queue depth when all 20 visible listings have the same price
 * - Uses listing timestamps to extrapolate queue length
 * Ported from Ranged Way Idle's estimateQueueLength feature
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import estimatedListingAge from './estimated-listing-age.js';
import { formatKMB } from '../../utils/formatters.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';

class QueueLengthEstimator {
    constructor() {
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.isInitialized = false;
        this.cleanupRegistry = createCleanupRegistry();
    }

    /**
     * Initialize the queue length estimator
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showQueueLength')) {
            return;
        }

        // Dependency check - requires estimated listing age feature
        if (!config.getSetting('market_showEstimatedListingAge')) {
            console.warn('[QueueLengthEstimator] Requires "Market: Show estimated listing age" to be enabled');
            return;
        }

        this.isInitialized = true;

        this.setupWebSocketListeners();
        this.setupObserver();
    }

    /**
     * Setup WebSocket listeners for order book updates
     */
    setupWebSocketListeners() {
        const orderBookHandler = (data) => {
            if (data.marketItemOrderBooks) {
                // Clear processed flags to re-render with new data
                document.querySelectorAll('.mwi-queue-length-set').forEach((container) => {
                    container.classList.remove('mwi-queue-length-set');
                });

                // Manually re-process any existing containers
                const existingContainers = document.querySelectorAll('[class*="MarketplacePanel_orderBooksContainer"]');
                existingContainers.forEach((container) => {
                    this.processOrderBook(container);
                });
            }
        };

        dataManager.on('market_item_order_books_updated', orderBookHandler);

        this.unregisterWebSocket = () => {
            dataManager.off('market_item_order_books_updated', orderBookHandler);
        };

        this.cleanupRegistry.registerCleanup(() => {
            if (this.unregisterWebSocket) {
                this.unregisterWebSocket();
                this.unregisterWebSocket = null;
            }
        });
    }

    /**
     * Setup DOM observer to watch for order book container
     */
    setupObserver() {
        this.unregisterObserver = domObserver.onClass(
            'QueueLengthEstimator',
            'MarketplacePanel_orderBooksContainer',
            (container) => {
                this.processOrderBook(container);
            }
        );

        this.cleanupRegistry.registerCleanup(() => {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
        });
    }

    /**
     * Process the order book container and inject queue length displays
     * @param {HTMLElement} _container - Order book container (unused - we query directly)
     */
    processOrderBook(_container) {
        // Find the button container where we'll inject the queue lengths
        const buttonContainer = document.querySelector('.MarketplacePanel_newListingButtonsContainer__1MhKJ');
        if (!buttonContainer) {
            return;
        }

        // Check if already processed
        if (buttonContainer.classList.contains('mwi-queue-length-set')) {
            return;
        }

        // Get current item and order book data from estimated-listing-age module
        const currentItemHrid = this.getCurrentItemHrid();
        if (!currentItemHrid) {
            return;
        }

        const orderBooksCache = estimatedListingAge.orderBooksCache;
        if (!orderBooksCache[currentItemHrid]) {
            return;
        }

        const cacheEntry = orderBooksCache[currentItemHrid];
        const orderBookData = cacheEntry.data || cacheEntry;

        // Get current enhancement level
        const enhancementLevel = this.getCurrentEnhancementLevel();
        const orderBookAtLevel = orderBookData.orderBooks?.[enhancementLevel];

        if (!orderBookAtLevel) {
            return;
        }

        // Mark as processed
        buttonContainer.classList.add('mwi-queue-length-set');

        // Calculate and display queue lengths
        this.displayQueueLength(buttonContainer, orderBookAtLevel.asks, true);
        this.displayQueueLength(buttonContainer, orderBookAtLevel.bids, false);
    }

    /**
     * Calculate and display queue length for asks or bids
     * @param {HTMLElement} buttonContainer - Button container element
     * @param {Array} listings - Array of listings (asks or bids)
     * @param {boolean} isAsk - True for asks (sell side), false for bids (buy side)
     */
    displayQueueLength(buttonContainer, listings, isAsk) {
        if (!listings || listings.length === 0) {
            return;
        }

        // Calculate visible count at top price
        const topPrice = listings[0].price;
        let visibleCount = 0;
        for (const listing of listings) {
            if (listing.price === topPrice) {
                visibleCount += listing.quantity;
            }
        }

        // Check if we should estimate (all 20 visible listings at same price)
        let queueLength = visibleCount;
        let isEstimated = false;

        if (listings.length === 20 && listings[19].price === topPrice) {
            // All 20 visible listings are at the same price - estimate total queue
            const firstTimestamp = new Date(listings[0].createdTimestamp).getTime();
            const lastTimestamp = new Date(listings[19].createdTimestamp).getTime();
            const now = Date.now();

            const timeSpan = lastTimestamp - firstTimestamp;
            const timeSinceNow = now - lastTimestamp;

            if (timeSpan > 0) {
                // RWI formula: 1 + 19/20 * (timeSinceNow / timeSpan)
                // This extrapolates based on the assumption that listings arrive at a constant rate
                const queueMultiplier = 1 + (19 / 20) * (timeSinceNow / timeSpan);
                queueLength = visibleCount * queueMultiplier;
                isEstimated = true;
            }
        }

        // Create or update the display element
        const existingElement = buttonContainer.querySelector(`.mwi-queue-length-${isAsk ? 'ask' : 'bid'}`);

        if (existingElement) {
            existingElement.remove();
        }

        const displayElement = document.createElement('div');
        displayElement.classList.add('mwi-queue-length', `mwi-queue-length-${isAsk ? 'ask' : 'bid'}`);
        displayElement.style.fontSize = '1.2rem';
        displayElement.style.textAlign = 'center';

        // Format the count
        const formattedCount = formatKMB(queueLength, 1);
        displayElement.textContent = formattedCount;

        // Apply color based on whether it's estimated
        const colorSetting = isEstimated ? 'color_queueLength_estimated' : 'color_queueLength_known';
        const color = config.getSettingValue(colorSetting, isEstimated ? '#60a5fa' : '#ffffff');
        displayElement.style.color = color;

        // Add tooltip
        if (isEstimated) {
            displayElement.title = `Estimated total queue depth (extrapolated from ${listings.length} visible orders)`;
        } else {
            displayElement.title = `Total quantity at best ${isAsk ? 'sell' : 'buy'} price`;
        }

        // Insert into button container
        // Ask goes before the first button (sell button), bid goes before the last button (buy button)
        if (isAsk) {
            // Insert before the second child (between first button and sell button)
            buttonContainer.insertBefore(displayElement, buttonContainer.children[1]);
        } else {
            // Insert before the last child (before buy button)
            buttonContainer.insertBefore(displayElement, buttonContainer.lastChild);
        }
    }

    /**
     * Get current item HRID being viewed in order book
     * @returns {string|null} Item HRID or null
     */
    getCurrentItemHrid() {
        const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
        if (currentItemElement) {
            const useElement = currentItemElement.querySelector('use');
            if (useElement && useElement.href && useElement.href.baseVal) {
                const itemHrid = '/items/' + useElement.href.baseVal.split('#')[1];
                return itemHrid;
            }
        }
        return null;
    }

    /**
     * Get current enhancement level being viewed in order book
     * @returns {number} Enhancement level (0 for non-equipment)
     */
    getCurrentEnhancementLevel() {
        const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
        if (currentItemElement) {
            const enhancementElement = currentItemElement.querySelector('[class*="Item_enhancementLevel"]');
            if (enhancementElement) {
                const match = enhancementElement.textContent.match(/\+(\d+)/);
                if (match) {
                    return parseInt(match[1], 10);
                }
            }
        }
        return 0;
    }

    /**
     * Clear all injected displays
     */
    clearDisplays() {
        document.querySelectorAll('.mwi-queue-length-set').forEach((container) => {
            container.classList.remove('mwi-queue-length-set');
        });
        document.querySelectorAll('.mwi-queue-length').forEach((el) => el.remove());
    }

    /**
     * Disable the queue length estimator
     */
    disable() {
        this.clearDisplays();
        this.cleanupRegistry.cleanup();
        this.isInitialized = false;
    }

    /**
     * Cleanup when feature is disabled or character switches
     */
    cleanup() {
        this.disable();
    }
}

const queueLengthEstimator = new QueueLengthEstimator();

export default queueLengthEstimator;
