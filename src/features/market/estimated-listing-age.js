/**
 * Estimated Listing Age Module
 *
 * Estimates creation times for all market listings using listing ID interpolation
 * - Collects known listing IDs with timestamps (from your own listings)
 * - Uses linear interpolation/regression to estimate ages for unknown listings
 * - Displays estimated ages on the main Market Listings (order book) tab
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import webSocketHook from '../../core/websocket.js';
import storage from '../../core/storage.js';
import { formatRelativeTime } from '../../utils/formatters.js';

class EstimatedListingAge {
    constructor() {
        this.knownListings = []; // Array of {id, timestamp} sorted by id
        this.orderBooksCache = {}; // Cache of order book data from WebSocket
        this.currentItemHrid = null; // Track current item from WebSocket
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.storageKey = 'marketListingTimestamps';
        this.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
        this.isInitialized = false;
    }

    /**
     * Format timestamp based on user settings
     * @param {number} timestamp - Timestamp in milliseconds
     * @returns {string} Formatted time string
     */
    formatTimestamp(timestamp) {
        const ageFormat = config.getSettingValue('market_listingAgeFormat', 'datetime');

        if (ageFormat === 'elapsed') {
            // Show elapsed time (e.g., "3h 45m")
            const ageMs = Date.now() - timestamp;
            return formatRelativeTime(ageMs);
        } else {
            // Show date/time (e.g., "01-13 14:30" or "01-13 2:30 PM")
            const timeFormat = config.getSettingValue('market_listingTimeFormat', '24hour');
            const use12Hour = timeFormat === '12hour';

            const date = new Date(timestamp);
            const formatted = date.toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: use12Hour
            }).replace(/\//g, '-').replace(',', '');

            return formatted;
        }
    }

    /**
     * Initialize the estimated listing age feature
     */
    async initialize() {
        // Guard against duplicate initialization
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showEstimatedListingAge')) {
            return;
        }

        this.isInitialized = true;

        // Load historical data from storage
        await this.loadHistoricalData();

        // Load initial listings from dataManager
        this.loadInitialListings();

        // Setup WebSocket listeners to collect your listing IDs
        this.setupWebSocketListeners();

        // Setup DOM observer for order book table
        this.setupObserver();
    }

    /**
     * Load initial listings from dataManager (already received via init_character_data)
     */
    loadInitialListings() {
        const listings = dataManager.getMarketListings();

        for (const listing of listings) {
            if (listing.id && listing.createdTimestamp) {
                this.recordListing(listing);
            }
        }
    }

    /**
     * Load historical listing data from IndexedDB
     */
    async loadHistoricalData() {
        try {
            const stored = await storage.getJSON(this.storageKey, 'marketListings', []);

            // Filter out old entries (> 30 days)
            const now = Date.now();
            const filtered = stored.filter(entry => (now - entry.timestamp) < this.maxAge);

            this.knownListings = filtered.sort((a, b) => a.id - b.id);

            // Save cleaned data back if we filtered anything
            if (filtered.length < stored.length) {
                await this.saveHistoricalData();
            }
        } catch (error) {
            console.error('[EstimatedListingAge] Failed to load historical data:', error);
            this.knownListings = [];
        }
    }

    /**
     * Save listing data to IndexedDB
     */
    async saveHistoricalData() {
        try {
            await storage.setJSON(this.storageKey, this.knownListings, 'marketListings', true);
        } catch (error) {
            console.error('[EstimatedListingAge] Failed to save historical data:', error);
        }
    }

    /**
     * Setup WebSocket listeners to collect your listing IDs and order book data
     */
    setupWebSocketListeners() {
        // Handle initial character data
        const initHandler = (data) => {
            if (data.myMarketListings) {
                for (const listing of data.myMarketListings) {
                    this.recordListing(listing);
                }
            }
        };

        // Handle listing updates
        const updateHandler = (data) => {
            if (data.endMarketListings) {
                for (const listing of data.endMarketListings) {
                    this.recordListing(listing);
                }
            }
        };

        // Handle order book updates (contains listing IDs for ALL listings)
        const orderBookHandler = (data) => {
            if (data.marketItemOrderBooks) {
                const itemHrid = data.marketItemOrderBooks.itemHrid;
                this.orderBooksCache[itemHrid] = data.marketItemOrderBooks;
                this.currentItemHrid = itemHrid; // Track current item

                // Clear processed flags to re-render with new data
                document.querySelectorAll('.mwi-estimated-age-set').forEach(container => {
                    container.classList.remove('mwi-estimated-age-set');
                });

                // Also clear listing price display flags so Top Order Age updates
                document.querySelectorAll('.mwi-listing-prices-set').forEach(table => {
                    table.classList.remove('mwi-listing-prices-set');
                });
            }
        };

        webSocketHook.on('init_character_data', initHandler);
        webSocketHook.on('market_listings_updated', updateHandler);
        webSocketHook.on('market_item_order_books_updated', orderBookHandler);

        // Store for cleanup
        this.unregisterWebSocket = () => {
            webSocketHook.off('init_character_data', initHandler);
            webSocketHook.off('market_listings_updated', updateHandler);
            webSocketHook.off('market_item_order_books_updated', orderBookHandler);
        };
    }

    /**
     * Record a listing with its full data
     * @param {Object} listing - Full listing object from WebSocket
     */
    recordListing(listing) {
        if (!listing.createdTimestamp) {
            return;
        }

        const timestamp = new Date(listing.createdTimestamp).getTime();

        // Check if we already have this listing
        const existingIndex = this.knownListings.findIndex(entry => entry.id === listing.id);

        // Add new entry with full data
        const entry = {
            id: listing.id,
            timestamp: timestamp,
            itemHrid: listing.itemHrid,
            price: listing.price,
            orderQuantity: listing.orderQuantity,
            filledQuantity: listing.filledQuantity,
            isSell: listing.isSell
        };

        if (existingIndex !== -1) {
            // Update existing entry (in case it had incomplete data)
            this.knownListings[existingIndex] = entry;
        } else {
            // Add new entry
            this.knownListings.push(entry);
        }

        // Re-sort by ID
        this.knownListings.sort((a, b) => a.id - b.id);

        // Save to storage (debounced)
        this.saveHistoricalData();
    }

    /**
     * Setup DOM observer to watch for order book table
     */
    setupObserver() {
        // Observe the main order book container
        this.unregisterObserver = domObserver.onClass(
            'EstimatedListingAge',
            'MarketplacePanel_orderBooksContainer',
            (container) => {
                this.processOrderBook(container);
            }
        );
    }

    /**
     * Process the order book container and inject age estimates
     * @param {HTMLElement} container - Order book container
     */
    processOrderBook(container) {
        // Skip if already processed
        if (container.classList.contains('mwi-estimated-age-set')) {
            return;
        }

        // Find the buy and sell tables
        const tables = container.querySelectorAll('table');
        if (tables.length < 2) {
            return; // Need both buy and sell tables
        }

        // Mark as processed
        container.classList.add('mwi-estimated-age-set');

        // Process both tables
        tables.forEach(table => this.addAgeColumn(table));
    }

    /**
     * Add estimated age column to order book table
     * @param {HTMLElement} table - Order book table
     */
    addAgeColumn(table) {
        const thead = table.querySelector('thead tr');
        const tbody = table.querySelector('tbody');

        if (!thead || !tbody) {
            return;
        }

        // Get current item and order book data
        const currentItemHrid = this.getCurrentItemHrid();

        if (!currentItemHrid || !this.orderBooksCache[currentItemHrid]) {
            return;
        }

        const orderBookData = this.orderBooksCache[currentItemHrid];

        // Determine if this is buy or sell table (asks = sell, bids = buy)
        const isSellTable = table.closest('[class*="orderBookTableContainer"]') ===
                           table.closest('[class*="orderBooksContainer"]')?.children[0];

        const listings = isSellTable ?
                         orderBookData.orderBooks[0]?.asks || [] :
                         orderBookData.orderBooks[0]?.bids || [];

        // Add header
        const header = document.createElement('th');
        header.classList.add('mwi-estimated-age-header');
        header.textContent = '~Age';
        header.title = 'Estimated listing age (based on listing ID)';
        thead.appendChild(header);

        // Add age cells to each row
        const rows = tbody.querySelectorAll('tr');

        rows.forEach((row, rowIndex) => {
            const cell = document.createElement('td');
            cell.classList.add('mwi-estimated-age-cell');

            // Check if this row has data within the order book range
            if (rowIndex < listings.length) {
                const listing = listings[rowIndex];
                const listingId = listing.listingId;

                // Check if this is YOUR listing
                const yourListing = this.knownListings.find(known => known.id === listingId);

                if (yourListing) {
                    // Exact timestamp for your listing
                    const formatted = this.formatTimestamp(yourListing.timestamp);
                    cell.textContent = formatted; // No tilde for exact timestamps
                    cell.style.color = '#00FF00'; // Green for YOUR listing
                    cell.style.fontSize = '0.9em';
                } else {
                    // Estimated timestamp for other listings
                    const estimatedTimestamp = this.estimateTimestamp(listingId);
                    const formatted = this.formatTimestamp(estimatedTimestamp);
                    cell.textContent = `~${formatted}`;
                    cell.style.color = '#999999'; // Gray to indicate estimate
                    cell.style.fontSize = '0.9em';
                }
            } else {
                // Row beyond order book data (ellipsis row or YOUR listings not in top 20)
                const hasCancel = row.textContent.includes('Cancel');
                if (hasCancel) {
                    // This is YOUR listing beyond top 20
                    // Try to match by price + quantity
                    const priceText = row.querySelector('[class*="price"]')?.textContent || '';
                    const quantityText = row.children[0]?.textContent || '';

                    const price = this.parsePrice(priceText);
                    const quantity = this.parseQuantity(quantityText);

                    const matchedListing = this.knownListings.find(listing => {
                        const itemMatch = listing.itemHrid === currentItemHrid;
                        const priceMatch = Math.abs(listing.price - price) < 0.01;
                        const qtyMatch = (listing.orderQuantity - listing.filledQuantity) === quantity;
                        return itemMatch && priceMatch && qtyMatch;
                    });

                    if (matchedListing) {
                        const formatted = this.formatTimestamp(matchedListing.timestamp);
                        cell.textContent = formatted;
                        cell.style.color = '#00FF00'; // Green for YOUR listing
                        cell.style.fontSize = '0.9em';
                    } else {
                        cell.textContent = '~Unknown';
                        cell.style.color = '#666666';
                        cell.style.fontSize = '0.9em';
                    }
                } else {
                    // Ellipsis row or unknown
                    cell.textContent = '· · ·';
                    cell.style.color = '#666666';
                    cell.style.fontSize = '0.9em';
                }
            }

            row.appendChild(cell);
        });
    }

    /**
     * Get current item HRID being viewed in order book
     * @returns {string|null} Item HRID or null
     */
    getCurrentItemHrid() {
        // PRIMARY: Check for current item element (same as RWI approach)
        const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
        if (currentItemElement) {
            const useElement = currentItemElement.querySelector('use');
            if (useElement && useElement.href && useElement.href.baseVal) {
                const itemHrid = '/items/' + useElement.href.baseVal.split('#')[1];
                return itemHrid;
            }
        }

        // SECONDARY: Use WebSocket tracked item
        if (this.currentItemHrid) {
            return this.currentItemHrid;
        }

        // TERTIARY: Try to find from YOUR listings in the order book
        const orderBookContainer = document.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
        if (!orderBookContainer) {
            return null;
        }

        const tables = orderBookContainer.querySelectorAll('table');
        for (const table of tables) {
            const rows = table.querySelectorAll('tbody tr');
            for (const row of rows) {
                const hasCancel = row.textContent.includes('Cancel');
                if (hasCancel) {
                    const priceText = row.querySelector('[class*="price"]')?.textContent || '';
                    const quantityText = row.children[0]?.textContent || '';

                    const price = this.parsePrice(priceText);
                    const quantity = this.parseQuantity(quantityText);

                    // Match against stored listings
                    for (const listing of this.knownListings) {
                        const priceMatch = Math.abs(listing.price - price) < 0.01;
                        const qtyMatch = (listing.orderQuantity - listing.filledQuantity) === quantity;

                        if (priceMatch && qtyMatch) {
                            return listing.itemHrid;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Parse price from text (handles K/M suffixes)
     * @param {string} text - Price text
     * @returns {number} Price value
     */
    parsePrice(text) {
        let multiplier = 1;
        if (text.toUpperCase().includes('K')) {
            multiplier = 1000;
            text = text.replace(/K/gi, '');
        } else if (text.toUpperCase().includes('M')) {
            multiplier = 1000000;
            text = text.replace(/M/gi, '');
        }
        const numStr = text.replace(/[^0-9.]/g, '');
        return numStr ? Number(numStr) * multiplier : 0;
    }

    /**
     * Parse quantity from text
     * @param {string} text - Quantity text
     * @returns {number} Quantity value
     */
    parseQuantity(text) {
        // Remove emoji and parse number
        const numStr = text.replace(/[^0-9]/g, '');
        return numStr ? Number(numStr) : 0;
    }

    /**
     * Estimate timestamp for a listing ID
     * @param {number} listingId - Listing ID to estimate
     * @returns {number} Estimated timestamp in milliseconds
     */
    estimateTimestamp(listingId) {
        if (this.knownListings.length === 0) {
            // No data, assume recent (1 hour ago)
            return Date.now() - (60 * 60 * 1000);
        }

        if (this.knownListings.length === 1) {
            // Only one data point, use it
            return this.knownListings[0].timestamp;
        }

        const minId = this.knownListings[0].id;
        const maxId = this.knownListings[this.knownListings.length - 1].id;

        let estimate;
        // Check if ID is within known range
        if (listingId >= minId && listingId <= maxId) {
            estimate = this.linearInterpolation(listingId);
        } else {
            estimate = this.linearRegression(listingId);
        }

        // CRITICAL: Clamp to reasonable bounds
        const now = Date.now();
        const maxAgeTimestamp = now - this.maxAge; // 30 days ago

        // Never allow future timestamps (listings cannot be created in the future)
        if (estimate > now) {
            estimate = now;
        }

        // Never allow timestamps older than maxAge (we filter these out anyway)
        if (estimate < maxAgeTimestamp) {
            estimate = maxAgeTimestamp;
        }

        return estimate;
    }

    /**
     * Linear interpolation for IDs within known range
     * @param {number} listingId - Listing ID
     * @returns {number} Estimated timestamp
     */
    linearInterpolation(listingId) {
        // Check for exact match
        const exact = this.knownListings.find(entry => entry.id === listingId);
        if (exact) {
            return exact.timestamp;
        }

        // Find surrounding points
        let leftIndex = 0;
        let rightIndex = this.knownListings.length - 1;

        for (let i = 0; i < this.knownListings.length - 1; i++) {
            if (listingId >= this.knownListings[i].id && listingId <= this.knownListings[i + 1].id) {
                leftIndex = i;
                rightIndex = i + 1;
                break;
            }
        }

        const left = this.knownListings[leftIndex];
        const right = this.knownListings[rightIndex];

        // Linear interpolation formula
        const idRange = right.id - left.id;
        const idOffset = listingId - left.id;
        const ratio = idOffset / idRange;

        return left.timestamp + ratio * (right.timestamp - left.timestamp);
    }

    /**
     * Linear regression for IDs outside known range
     * @param {number} listingId - Listing ID
     * @returns {number} Estimated timestamp
     */
    linearRegression(listingId) {
        // Calculate linear regression coefficients
        let sumX = 0, sumY = 0;
        for (const entry of this.knownListings) {
            sumX += entry.id;
            sumY += entry.timestamp;
        }

        const n = this.knownListings.length;
        const meanX = sumX / n;
        const meanY = sumY / n;

        let numerator = 0;
        let denominator = 0;
        for (const entry of this.knownListings) {
            numerator += (entry.id - meanX) * (entry.timestamp - meanY);
            denominator += (entry.id - meanX) * (entry.id - meanX);
        }

        const slope = numerator / denominator;
        const intercept = meanY - slope * meanX;

        // Estimate timestamp using regression line
        return slope * listingId + intercept;
    }

    /**
     * Clear all injected displays
     */
    clearDisplays() {
        document.querySelectorAll('.mwi-estimated-age-set').forEach(container => {
            container.classList.remove('mwi-estimated-age-set');
        });
        document.querySelectorAll('.mwi-estimated-age-header').forEach(el => el.remove());
        document.querySelectorAll('.mwi-estimated-age-cell').forEach(el => el.remove());
    }

    /**
     * Disable the estimated listing age feature
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

        this.clearDisplays();
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const estimatedListingAge = new EstimatedListingAge();

export default estimatedListingAge;
