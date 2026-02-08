/**
 * Trade History Display Module
 * Shows your last buy/sell prices in the marketplace panel
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import tradeHistory from './trade-history.js';
import { formatKMB3Digits } from '../../utils/formatters.js';

class TradeHistoryDisplay {
    constructor() {
        this.isActive = false;
        this.unregisterObserver = null;
        this.unregisterWebSocket = null;
        this.currentItemHrid = null;
        this.currentEnhancementLevel = 0;
        this.currentOrderBookData = null;
        this.isInitialized = false;
        this.needsPriceDataRetry = false; // Track if we need to retry due to missing price data
    }

    /**
     * Initialize the display system
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_tradeHistory')) {
            return;
        }

        this.isInitialized = true;
        this.setupWebSocketListener();
        this.setupSettingListener();
        this.isActive = true;
    }

    /**
     * Setup setting change listener to refresh display when comparison mode changes
     */
    setupSettingListener() {
        config.onSettingChange('market_tradeHistoryComparisonMode', () => {
            // Refresh display if currently viewing an item
            if (this.currentItemHrid) {
                const history = tradeHistory.getHistory(this.currentItemHrid, this.currentEnhancementLevel);
                this.updateDisplay(null, history);
            }
        });
    }

    /**
     * Setup WebSocket listener for order book updates
     */
    setupWebSocketListener() {
        const orderBookHandler = (data) => {
            if (data.marketItemOrderBooks) {
                // Store order book data for current item
                this.currentOrderBookData = data.marketItemOrderBooks;

                // Extract item info from WebSocket data
                const itemHrid = data.marketItemOrderBooks.itemHrid;

                // Get enhancement level from DOM
                const enhancementLevel = this.getCurrentEnhancementLevel();

                // Check if this is a different item
                if (itemHrid === this.currentItemHrid && enhancementLevel === this.currentEnhancementLevel) {
                    // Only update if we previously failed due to missing price data
                    if (!this.needsPriceDataRetry) {
                        return;
                    }
                }

                // Update tracking
                this.currentItemHrid = itemHrid;
                this.currentEnhancementLevel = enhancementLevel;

                // Get trade history for this item
                const history = tradeHistory.getHistory(itemHrid, enhancementLevel);

                // Update display (pass null for panel since we don't use it)
                this.updateDisplay(null, history);
            }
        };

        dataManager.on('market_item_order_books_updated', orderBookHandler);

        // Store unregister function for cleanup
        this.unregisterWebSocket = () => {
            dataManager.off('market_item_order_books_updated', orderBookHandler);
        };
    }

    /**
     * Get current enhancement level being viewed in order book
     * @returns {number} Enhancement level (0 for non-equipment)
     */
    getCurrentEnhancementLevel() {
        // Check for enhancement level indicator in the current item display
        const currentItemElement = document.querySelector('[class*="MarketplacePanel_currentItem"]');
        if (currentItemElement) {
            const enhancementElement = currentItemElement.querySelector('[class*="Item_enhancementLevel"]');
            if (enhancementElement) {
                const match = enhancementElement.textContent.match(/\+(\d+)/);
                if (match) {
                    return parseInt(match[1], 10);
                }
            }
        }

        // Default to enhancement level 0 (non-equipment or base equipment)
        return 0;
    }

    /**
     * Update trade history display
     * @param {HTMLElement} panel - Current item panel (unused, kept for signature compatibility)
     * @param {Object|null} history - Trade history { buy, sell } or null
     */
    updateDisplay(panel, history) {
        // Remove existing display
        const existing = document.querySelectorAll('.mwi-trade-history');
        existing.forEach((el) => el.remove());

        // Don't show anything if no history
        if (!history || (!history.buy && !history.sell)) {
            return;
        }

        // Get current top order prices from the DOM
        const currentPrices = this.extractCurrentPrices(panel);

        // Don't show display if we don't have current prices yet
        if (!currentPrices) {
            this.needsPriceDataRetry = true;
            return;
        }

        // Get comparison mode setting
        const comparisonMode = config.getSettingValue('market_tradeHistoryComparisonMode', 'instant');

        // Find the button container - it's outside the currentItem panel
        // Search in the entire document since button container is at a higher level
        const buttonContainer = document.querySelector('[class*="MarketplacePanel_marketNavButtonContainer"]');
        if (!buttonContainer) {
            return;
        }

        // Create history display
        const historyDiv = document.createElement('div');
        historyDiv.className = 'mwi-trade-history';

        historyDiv.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-left: 12px;
            font-size: 0.85rem;
            color: #888;
            padding: 6px 12px;
            background: rgba(0,0,0,0.8);
            border-radius: 4px;
            white-space: nowrap;
        `;

        // Build content
        const parts = [];
        parts.push(`<span style="color: #aaa; font-weight: 500;">Last:</span>`);

        if (history.buy) {
            const buyColor = this.getBuyColor(history.buy, currentPrices, comparisonMode);
            parts.push(
                `<span style="color: ${buyColor}; font-weight: 600;" title="Your last buy price">Buy ${formatKMB3Digits(history.buy)}</span>`
            );
        }

        if (history.buy && history.sell) {
            parts.push(`<span style="color: #555;">|</span>`);
        }

        if (history.sell) {
            const sellColor = this.getSellColor(history.sell, currentPrices, comparisonMode);
            parts.push(
                `<span style="color: ${sellColor}; font-weight: 600;" title="Your last sell price">Sell ${formatKMB3Digits(history.sell)}</span>`
            );
        }

        historyDiv.innerHTML = parts.join('');

        // Append to button container
        buttonContainer.appendChild(historyDiv);

        // Clear retry flag since we successfully displayed
        this.needsPriceDataRetry = false;
    }

    /**
     * Extract current top order prices from WebSocket order book data
     * @param {HTMLElement} panel - Current item panel (unused, kept for signature compatibility)
     * @returns {Object|null} { ask, bid } or null
     */
    extractCurrentPrices(_panel) {
        // Use WebSocket order book data instead of DOM scraping
        if (!this.currentOrderBookData || !this.currentOrderBookData.orderBooks) {
            return null;
        }

        // Get current enhancement level to find correct order book
        const enhancementLevel = this.getCurrentEnhancementLevel();

        // orderBooks is an array indexed by enhancement level
        const orderBook = this.currentOrderBookData.orderBooks[enhancementLevel];
        if (!orderBook) {
            return null;
        }

        // Extract top ask (lowest sell price) and top bid (highest buy price)
        const topAsk = orderBook.asks?.[0]?.price;
        const topBid = orderBook.bids?.[0]?.price;

        // Validate prices exist and are positive
        if (!topAsk || topAsk <= 0 || !topBid || topBid <= 0) {
            return null;
        }

        return {
            ask: topAsk,
            bid: topBid,
        };
    }

    /**
     * Get color for buy price based on comparison mode
     * @param {number} lastBuy - Your last buy price
     * @param {Object|null} currentPrices - Current market prices { ask, bid }
     * @param {string} comparisonMode - 'instant' or 'listing'
     * @returns {string} Color code
     */
    getBuyColor(lastBuy, currentPrices, comparisonMode) {
        if (!currentPrices) {
            return '#888'; // Grey if no market data
        }

        // Choose comparison price based on mode
        const comparePrice = comparisonMode === 'instant' ? currentPrices.ask : currentPrices.bid;

        if (!comparePrice || comparePrice === -1) {
            return '#888'; // Grey if no market data
        }

        if (comparisonMode === 'instant') {
            // Instant mode: Compare to ask (what you'd pay to instant-buy now)
            if (comparePrice > lastBuy) {
                return config.COLOR_LOSS; // Red - would pay more now
            } else if (comparePrice < lastBuy) {
                return config.COLOR_PROFIT; // Green - would pay less now
            }
        } else if (comparePrice > lastBuy) {
            // Listing mode: Compare to bid (what buyers are offering = what you could sell for)
            return config.COLOR_PROFIT; // Green - can sell for more than you bought (profit)
        } else if (comparePrice < lastBuy) {
            return config.COLOR_LOSS; // Red - can only sell for less than you bought (loss)
        }

        return '#888'; // Grey - same price
    }

    /**
     * Get color for sell price based on comparison mode
     * @param {number} lastSell - Your last sell price
     * @param {Object|null} currentPrices - Current market prices { ask, bid }
     * @param {string} comparisonMode - 'instant' or 'listing'
     * @returns {string} Color code
     */
    getSellColor(lastSell, currentPrices, comparisonMode) {
        if (!currentPrices) {
            return '#888'; // Grey if no market data
        }

        // Choose comparison price based on mode
        const comparePrice = comparisonMode === 'instant' ? currentPrices.bid : currentPrices.ask;

        if (!comparePrice || comparePrice === -1) {
            return '#888'; // Grey if no market data
        }

        if (comparisonMode === 'instant') {
            // Instant mode: Compare to bid (what you'd get to instant-sell now)
            if (comparePrice > lastSell) {
                return config.COLOR_PROFIT; // Green - would get more now
            } else if (comparePrice < lastSell) {
                return config.COLOR_LOSS; // Red - would get less now
            }
        } else if (comparePrice > lastSell) {
            // Listing mode: Compare to ask (what sellers are asking)
            return config.COLOR_LOSS; // Red - others selling for more (you sold too cheap)
        } else if (comparePrice < lastSell) {
            return config.COLOR_PROFIT; // Green - others selling for less (you sold well)
        }

        return '#888'; // Grey - same price
    }

    /**
     * Disable the display
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.unregisterWebSocket) {
            this.unregisterWebSocket();
            this.unregisterWebSocket = null;
        }

        // Remove all displays
        document.querySelectorAll('.mwi-trade-history').forEach((el) => el.remove());

        this.isActive = false;
        this.currentItemHrid = null;
        this.currentEnhancementLevel = 0;
        this.currentOrderBookData = null;
        this.isInitialized = false;
    }
}

const tradeHistoryDisplay = new TradeHistoryDisplay();

export default tradeHistoryDisplay;
