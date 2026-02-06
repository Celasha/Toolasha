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
import storage from '../../core/storage.js';
import { formatRelativeTime } from '../../utils/formatters.js';

class EstimatedListingAge {
    constructor() {
        this.knownListings = []; // Array of {id, timestamp, createdTimestamp, enhancementLevel, ...} sorted by id
        this.orderBooksCache = {}; // Cache of order book data from WebSocket
        this.currentItemHrid = null; // Track current item from WebSocket
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.storageKey = 'marketListingTimestamps';
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
            // Show date/time (e.g., "01-13 14:30:45" or "01-13 2:30:45 PM")
            const timeFormat = config.getSettingValue('market_listingTimeFormat', '24hour');
            const use12Hour = timeFormat === '12hour';

            const date = new Date(timestamp);
            const formatted = date
                .toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: use12Hour,
                })
                .replace(/\//g, '-')
                .replace(',', '');

            return formatted;
        }
    }

    /**
     * Initialize the estimated listing age feature
     */
    async initialize() {
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

            // Load all historical data (no time-based filtering)
            this.knownListings = stored.sort((a, b) => a.id - b.id);

            // Add hardcoded seed listings for baseline estimation accuracy
            // These are anchor points from RWI script author's data
            const seedListings = [
                { id: 106442952, timestamp: 1763409373481 },
                { id: 106791533, timestamp: 1763541486867 },
                { id: 107530218, timestamp: 1763842767083 },
                { id: 107640371, timestamp: 1763890560819 },
                { id: 107678558, timestamp: 1763904036320 },
            ];

            // Add seeds only if they don't already exist in stored data
            for (const seed of seedListings) {
                if (!this.knownListings.find((l) => l.id === seed.id)) {
                    this.knownListings.push(seed);
                }
            }

            // Re-sort after adding seeds
            this.knownListings.sort((a, b) => a.id - b.id);
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
                document.querySelectorAll('.mwi-estimated-age-set').forEach((container) => {
                    container.classList.remove('mwi-estimated-age-set');
                });

                // Also clear listing price display flags so Top Order Age updates
                document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
                    table.classList.remove('mwi-listing-prices-set');
                });

                // Manually re-process any existing containers (handles race condition where
                // container appeared before WebSocket data arrived)
                const existingContainers = document.querySelectorAll('[class*="MarketplacePanel_orderBooksContainer"]');
                existingContainers.forEach((container) => {
                    this.processOrderBook(container);
                });
            }
        };

        dataManager.on('character_initialized', initHandler);
        dataManager.on('market_listings_updated', updateHandler);
        dataManager.on('market_item_order_books_updated', orderBookHandler);

        // Store for cleanup
        this.unregisterWebSocket = () => {
            dataManager.off('character_initialized', initHandler);
            dataManager.off('market_listings_updated', updateHandler);
            dataManager.off('market_item_order_books_updated', orderBookHandler);
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
        const existingIndex = this.knownListings.findIndex((entry) => entry.id === listing.id);

        // Add new entry with full data
        const entry = {
            id: listing.id,
            timestamp: timestamp,
            createdTimestamp: listing.createdTimestamp, // ISO string for display
            itemHrid: listing.itemHrid,
            enhancementLevel: listing.enhancementLevel || 0, // For accurate row matching
            price: listing.price,
            orderQuantity: listing.orderQuantity,
            filledQuantity: listing.filledQuantity,
            isSell: listing.isSell,
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
        tables.forEach((table) => this.addAgeColumn(table));
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

        // Remove existing age column elements if they exist (RWI pattern)
        thead.querySelectorAll('.mwi-estimated-age-header').forEach((el) => el.remove());
        tbody.querySelectorAll('.mwi-estimated-age-cell').forEach((el) => el.remove());

        // Get current item and order book data
        const currentItemHrid = this.getCurrentItemHrid();

        if (!currentItemHrid || !this.orderBooksCache[currentItemHrid]) {
            return;
        }

        const orderBookData = this.orderBooksCache[currentItemHrid];

        // Get current enhancement level being viewed
        const enhancementLevel = this.getCurrentEnhancementLevel();

        // Determine if this is buy or sell table (asks = sell, bids = buy)
        const isSellTable =
            table.closest('[class*="orderBookTableContainer"]') ===
            table.closest('[class*="orderBooksContainer"]')?.children[0];

        // Access orderBooks by enhancement level (orderBooks is an object, not array)
        // For non-equipment items, only level 0 exists
        // For equipment, there can be orderBooks[0], orderBooks[1], etc.
        const orderBookAtLevel = orderBookData.orderBooks?.[enhancementLevel];

        if (!orderBookAtLevel) {
            // No order book data for this enhancement level
            return;
        }

        const listings = isSellTable ? orderBookAtLevel.asks || [] : orderBookAtLevel.bids || [];

        // Add header
        const header = document.createElement('th');
        header.classList.add('mwi-estimated-age-header');
        header.textContent = '~Age';
        header.title = 'Estimated listing age (based on listing ID)';
        thead.appendChild(header);

        // Track which of user's listings have been matched to prevent duplicates
        const usedListingIds = new Set();

        // Add age cells to each row
        const rows = tbody.querySelectorAll('tr');
        let index = 0;

        rows.forEach((row) => {
            const cell = document.createElement('td');
            cell.classList.add('mwi-estimated-age-cell');

            if (index < listings.length) {
                // Top 20 listings from order book (use positional indexing like RWI)
                const listing = listings[index];
                const listingId = listing.listingId;

                // Check if this is YOUR listing (and not already matched)
                const yourListing = this.knownListings.find(
                    (known) => known.id === listingId && !usedListingIds.has(known.id)
                );

                if (yourListing) {
                    // Mark this listing as used
                    usedListingIds.add(yourListing.id);

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
            } else if (index === listings.length) {
                // Ellipsis row
                cell.textContent = '· · ·';
                cell.style.color = '#666666';
                cell.style.fontSize = '0.9em';
            } else {
                // Beyond top 20 - YOUR listings only
                const hasCancel = row.textContent.includes('Cancel');
                if (hasCancel) {
                    // Extract price and quantity for matching
                    const priceText = row.querySelector('[class*="price"]')?.textContent || '';
                    const quantityText = row.children[0]?.textContent || '';
                    const price = this.parsePrice(priceText);
                    const quantity = this.parseQuantity(quantityText);

                    // Match from knownListings (filtering out already-used and top-20 listings)
                    const allOrderBookIds = new Set(listings.map((l) => l.listingId));
                    const matchedListing = this.knownListings.find((listing) => {
                        if (usedListingIds.has(listing.id)) return false;
                        if (allOrderBookIds.has(listing.id)) return false; // Skip top 20

                        const itemMatch = listing.itemHrid === currentItemHrid;
                        const priceMatch = Math.abs(listing.price - price) < 0.01;
                        const qtyMatch = listing.orderQuantity - listing.filledQuantity === quantity;
                        return itemMatch && priceMatch && qtyMatch;
                    });

                    if (matchedListing) {
                        usedListingIds.add(matchedListing.id);
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
                    cell.textContent = '· · ·';
                    cell.style.color = '#666666';
                    cell.style.fontSize = '0.9em';
                }
            }

            row.appendChild(cell);
            index++;
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

                    // Find matching listing from YOUR listings
                    const matchedListing = this.knownListings.find((listing) => {
                        const priceMatch = Math.abs(listing.price - price) < 0.01;
                        const qtyMatch = listing.orderQuantity - listing.filledQuantity === quantity;
                        return priceMatch && qtyMatch;
                    });

                    if (matchedListing) {
                        return matchedListing.itemHrid;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Get current enhancement level being viewed in order book
     * @returns {number} Enhancement level (0 for non-equipment)
     */
    getCurrentEnhancementLevel() {
        // Check for enhancement level indicator in the current item display
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

        // Default to enhancement level 0 (non-equipment or base equipment)
        return 0;
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
     * Parse quantity from text (handles K/M suffixes)
     * @param {string} text - Quantity text
     * @returns {number} Quantity value
     */
    parseQuantity(text) {
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
     * Estimate timestamp for a listing ID
     * @param {number} listingId - Listing ID to estimate
     * @returns {number} Estimated timestamp in milliseconds
     */
    estimateTimestamp(listingId) {
        if (this.knownListings.length === 0) {
            // No data, assume recent (1 hour ago)
            return Date.now() - 60 * 60 * 1000;
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

        // Never allow future timestamps (listings cannot be created in the future)
        if (estimate > now) {
            estimate = now;
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
        const exact = this.knownListings.find((entry) => entry.id === listingId);
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
        // Calculate linear regression slope
        let sumX = 0,
            sumY = 0;
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

        // Get boundary points
        const minId = this.knownListings[0].id;
        const maxId = this.knownListings[this.knownListings.length - 1].id;
        const minTimestamp = this.knownListings[0].timestamp;
        const maxTimestamp = this.knownListings[this.knownListings.length - 1].timestamp;

        // Extrapolate from closest boundary (RWI approach)
        // This prevents drift from large intercept values
        if (listingId > maxId) {
            return slope * (listingId - maxId) + maxTimestamp;
        } else {
            return slope * (listingId - minId) + minTimestamp;
        }
    }

    /**
     * Clear all injected displays
     */
    clearDisplays() {
        document.querySelectorAll('.mwi-estimated-age-set').forEach((container) => {
            container.classList.remove('mwi-estimated-age-set');
        });
        document.querySelectorAll('.mwi-estimated-age-header').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-estimated-age-cell').forEach((el) => el.remove());
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

const estimatedListingAge = new EstimatedListingAge();

export default estimatedListingAge;
