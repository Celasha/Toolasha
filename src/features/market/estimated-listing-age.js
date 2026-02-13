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
import marketAPI from '../../api/marketplace.js';
import { formatRelativeTime } from '../../utils/formatters.js';

class EstimatedListingAge {
    constructor() {
        this.knownListings = []; // Array of {id, timestamp, createdTimestamp, enhancementLevel, ...} sorted by id
        this.orderBooksCache = {}; // Cache of order book data from WebSocket
        this.currentItemHrid = null; // Track current item from WebSocket
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.storageKey = 'marketListingTimestamps';
        this.orderBooksCacheKey = 'marketOrderBooksCache';
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
            const dateFormat = config.getSettingValue('market_listingDateFormat', 'MM-DD');
            const use12Hour = timeFormat === '12hour';

            const date = new Date(timestamp);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const datePart = dateFormat === 'DD-MM' ? `${day}-${month}` : `${month}-${day}`;

            const timePart = date
                .toLocaleString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: use12Hour,
                })
                .trim();

            return `${datePart} ${timePart}`;
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

        // Load cached order books from storage
        await this.loadOrderBooksCache();

        // Load initial listings from dataManager
        this.loadInitialListings();

        // Setup WebSocket listeners to collect your listing IDs
        this.setupWebSocketListeners();

        // Setup DOM observer for order book table
        this.setupObserver();

        // Setup DOM observer for My Listings table (expired detection)
        this.setupMyListingsObserver();
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
     * Load cached order books from IndexedDB
     */
    async loadOrderBooksCache() {
        try {
            const stored = await storage.getJSON(this.orderBooksCacheKey, 'marketListings', {});
            this.orderBooksCache = stored || {};
        } catch (error) {
            console.error('[EstimatedListingAge] Failed to load order books cache:', error);
            this.orderBooksCache = {};
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
     * Save order books cache to IndexedDB
     */
    async saveOrderBooksCache() {
        try {
            await storage.setJSON(this.orderBooksCacheKey, this.orderBooksCache, 'marketListings', true);
        } catch (error) {
            console.error('[EstimatedListingAge] Failed to save order books cache:', error);
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
            // Handle newly created listings (user just placed an order)
            if (data.newMarketListings) {
                for (const listing of data.newMarketListings) {
                    // New listings should start as 'unknown' (will be marked 'active' by history viewer)
                    listing._toolashaStatus = 'unknown';
                    this.recordListing(listing);
                }
            }

            // Update all active listings (if provided)
            if (data.myMarketListings) {
                for (const listing of data.myMarketListings) {
                    // Active listings - record them but don't set status (let history viewer handle it)
                    this.recordListing(listing);
                }
            }

            // Handle endMarketListings (confusing name - contains both new AND ending listings)
            if (data.endMarketListings) {
                for (const listing of data.endMarketListings) {
                    // Use game's status HRID to determine what happened
                    if (listing.status === '/market_listing_status/active') {
                        // New listing being created - mark as unknown (history viewer will set to active)
                        listing._toolashaStatus = 'unknown';
                    } else if (listing.status === '/market_listing_status/cancelled') {
                        // User canceled the listing
                        listing._toolashaStatus = 'canceled';
                    } else if (listing.status === '/market_listing_status/filled') {
                        // Listing was filled
                        listing._toolashaStatus = 'filled';
                    } else if (listing.status === '/market_listing_status/expired') {
                        // Listing expired
                        listing._toolashaStatus = 'expired';
                    } else if (listing.filledQuantity >= listing.orderQuantity) {
                        // Unknown status - fallback to old logic
                        listing._toolashaStatus = 'filled';
                    } else {
                        listing._toolashaStatus = 'canceled';
                    }

                    this.recordListing(listing);
                }
            }
        };

        // Handle order book updates (contains listing IDs for ALL listings)
        const orderBookHandler = (data) => {
            if (data.marketItemOrderBooks) {
                const itemHrid = data.marketItemOrderBooks.itemHrid;
                const orderBooks = data.marketItemOrderBooks.orderBooks;

                // IMPORTANT: Populate createdTimestamp on all listings (for queue length estimator)
                // RWI does this in their saveOrderBooks function
                if (orderBooks) {
                    // Handle both array and object format
                    const orderBooksArray = Array.isArray(orderBooks) ? orderBooks : Object.values(orderBooks);

                    for (const orderBook of orderBooksArray) {
                        if (!orderBook) continue;

                        // Process asks
                        if (orderBook.asks) {
                            for (const listing of orderBook.asks) {
                                if (!listing.createdTimestamp && listing.listingId) {
                                    const estimatedTimestamp = this.estimateTimestamp(listing.listingId);
                                    listing.createdTimestamp = new Date(estimatedTimestamp).toISOString();
                                }
                            }
                        }

                        // Process bids
                        if (orderBook.bids) {
                            for (const listing of orderBook.bids) {
                                if (!listing.createdTimestamp && listing.listingId) {
                                    const estimatedTimestamp = this.estimateTimestamp(listing.listingId);
                                    listing.createdTimestamp = new Date(estimatedTimestamp).toISOString();
                                }
                            }
                        }
                    }
                }

                // Store with timestamp for staleness tracking
                this.orderBooksCache[itemHrid] = {
                    data: data.marketItemOrderBooks,
                    lastUpdated: Date.now(),
                };

                this.currentItemHrid = itemHrid; // Track current item

                // Update market API with fresh prices from order book
                if (orderBooks) {
                    // Handle both array and object format for orderBooks
                    if (Array.isArray(orderBooks)) {
                        // Enhancement level is the ARRAY INDEX
                        orderBooks.forEach((orderBook, enhancementLevel) => {
                            if (!orderBook) return; // Skip empty slots in sparse array
                            const topAsk = orderBook.asks?.[0]?.price ?? null;
                            const topBid = orderBook.bids?.[0]?.price ?? null;

                            // Only update if we have at least one price
                            if (topAsk !== null || topBid !== null) {
                                marketAPI.updatePrice(itemHrid, enhancementLevel, topAsk, topBid);
                            }
                        });
                    } else {
                        // Fallback: Handle object format { "0": {...}, "5": {...} }
                        for (const [level, orderBook] of Object.entries(orderBooks)) {
                            if (!orderBook) continue;
                            const enhancementLevel = parseInt(level, 10);
                            const topAsk = orderBook.asks?.[0]?.price ?? null;
                            const topBid = orderBook.bids?.[0]?.price ?? null;

                            if (topAsk !== null || topBid !== null) {
                                marketAPI.updatePrice(itemHrid, enhancementLevel, topAsk, topBid);
                            }
                        }
                    }
                }

                // Save to storage (debounced)
                this.saveOrderBooksCache();

                // Clear processed flags to re-render with new data
                const containers = document.querySelectorAll('.mwi-estimated-age-set');
                containers.forEach((container) => {
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

        // Determine status (NEVER use listing.status from game data - it's an HRID like "/market_listing_status/active")
        // Priority: new status update from WebSocket > existing status > default unknown
        let status;
        if (listing._toolashaStatus) {
            // Use explicitly set status from updateHandler (canceled/filled detection)
            // This takes priority over existing status (allows status updates)
            status = listing._toolashaStatus;
        } else if (existingIndex !== -1 && this.knownListings[existingIndex].status) {
            // Preserve existing tracked status if no new update
            status = this.knownListings[existingIndex].status;
        } else {
            // Default to unknown for new listings
            status = 'unknown';
        }

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
            status: status,
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
     * Setup DOM observer for My Listings table to detect expired listings
     */
    setupMyListingsObserver() {
        // Watch for the My Listings table container
        this.unregisterMyListingsObserver = domObserver.onClass(
            'EstimatedListingAge_MyListings',
            'MarketplacePanel_myListingsTableContainer__2s6pm',
            (container) => {
                this.checkForExpiredListings(container);
            }
        );

        // Also use polling as fallback - watch for visible table
        const checkInterval = setInterval(() => {
            const myListingsTable = document.querySelector('.MarketplacePanel_myListingsTableContainer__2s6pm');
            if (myListingsTable) {
                // Check if the table is actually visible (not display:none)
                const isVisible = myListingsTable.offsetParent !== null;
                if (isVisible) {
                    this.checkForExpiredListings(myListingsTable);
                }
            }
        }, 2000); // Check every 2 seconds

        // Store interval for cleanup
        this.myListingsCheckInterval = checkInterval;
    }

    /**
     * Check for expired listings in the My Listings table
     * @param {HTMLElement} container - My Listings table container
     */
    async checkForExpiredListings(container) {
        const tbody = container.querySelector('table tbody');
        if (!tbody) {
            return;
        }

        const rows = tbody.querySelectorAll('tr');

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];

            try {
                const allCells = row.querySelectorAll('td');

                // Get status cell (first td)
                const statusCell = allCells[0];
                if (!statusCell) continue;

                const statusText = statusCell.textContent.trim();

                if (statusText !== 'Expired') continue;

                // Extract Type (Buy/Sell)
                const typeCell = allCells[1];
                const typeText = typeCell?.textContent.trim();
                const isSell = typeText === 'Sell';

                // Extract Progress (e.g., "0 / 1")
                // The cell has multiple nested divs. The progress text is in the LAST div overall.
                const progressCell = allCells[2];
                const allDivsInCell = progressCell?.querySelectorAll('div');
                const progressDiv = allDivsInCell ? allDivsInCell[allDivsInCell.length - 1] : null;
                const progressText = progressDiv?.textContent.trim();

                const progressMatch = progressText?.match(/(\d+)\s*\/\s*(\d+)/);

                if (!progressMatch) continue;

                const filledQuantity = parseInt(progressMatch[1], 10);
                const orderQuantity = parseInt(progressMatch[2], 10);

                // Extract Price
                const priceCell = allCells[3];
                const priceText = priceCell?.textContent.trim();
                const price = this.parsePrice(priceText);

                if (price === null) continue;

                // Find matching listing in our stored data
                const matchingListing = this.knownListings.find(
                    (listing) =>
                        listing.isSell === isSell &&
                        listing.price === price &&
                        listing.orderQuantity === orderQuantity &&
                        listing.filledQuantity === filledQuantity
                );

                if (matchingListing && matchingListing.status !== 'expired') {
                    matchingListing.status = 'expired';
                    await this.saveHistoricalData();
                }
            } catch (error) {
                console.error(`[EstimatedListingAge] Error processing expired listing row:`, error);
            }
        }
    }

    /**
     * Parse price string (handles K/M/B suffixes)
     * @param {string} priceText - Price text (e.g., "12M", "1.5K", "100")
     * @returns {number|null} Parsed price or null if invalid
     */
    parsePrice(priceText) {
        if (!priceText) return null;

        const normalized = priceText.trim().toUpperCase();
        const match = normalized.match(/^([\d,.]+)([KMB])?$/);

        if (!match) return null;

        // Remove commas from number
        const value = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2];

        if (isNaN(value)) return null;

        switch (suffix) {
            case 'K':
                return Math.round(value * 1000);
            case 'M':
                return Math.round(value * 1000000);
            case 'B':
                return Math.round(value * 1000000000);
            default:
                return Math.round(value);
        }
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
        tables.forEach((table) => {
            this.addAgeColumn(table);
        });
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

        const cacheEntry = this.orderBooksCache[currentItemHrid];
        // Support both old format (direct data) and new format ({data, lastUpdated})
        const orderBookData = cacheEntry.data || cacheEntry;

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

                    // Get currently active listings to validate matches
                    const activeListings = dataManager.getMarketListings();
                    const activeListingIds = new Set(activeListings.map((l) => l.id));

                    // Match from knownListings (filtering out already-used and top-20 listings)
                    // Find ALL potential matches, then pick the newest one (highest ID)
                    const allOrderBookIds = new Set(listings.map((l) => l.listingId));
                    const potentialMatches = this.knownListings.filter((listing) => {
                        if (usedListingIds.has(listing.id)) return false;
                        if (allOrderBookIds.has(listing.id)) return false; // Skip top 20
                        if (!activeListingIds.has(listing.id)) return false; // Only match active listings

                        const itemMatch = listing.itemHrid === currentItemHrid;
                        const priceMatch = Math.abs(listing.price - price) < 0.01;
                        const qtyMatch = listing.orderQuantity - listing.filledQuantity === quantity;
                        const sideMatch = listing.isSell === isSellTable;
                        return itemMatch && priceMatch && qtyMatch && sideMatch;
                    });

                    // Pick the first match (oldest ID) to preserve DOM order
                    const matchedListing = potentialMatches.length > 0 ? potentialMatches[0] : null;

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
     * Get color based on data staleness
     * @param {number} lastUpdated - Timestamp when data was last updated
     * @returns {string} Color code for display
     */
    getStalenessColor(lastUpdated) {
        if (!lastUpdated) {
            return '#999999'; // Gray for unknown age
        }

        const age = Date.now() - lastUpdated;
        const minutes = age / (60 * 1000);
        const hours = age / (60 * 60 * 1000);

        if (minutes < 15) return '#00AA00'; // < 15 min: dark green (fresh)
        if (hours < 1) return '#00FF00'; // < 1 hour: light green (recent)
        if (hours < 4) return '#FFAA00'; // < 4 hours: yellow (moderate)
        if (hours < 12) return '#FF6600'; // < 12 hours: orange (stale)
        return '#FF0000'; // 12+ hours: red (very stale)
    }

    /**
     * Get tooltip text for staleness
     * @param {number} lastUpdated - Timestamp when data was last updated
     * @returns {string} Tooltip text
     */
    getStalenessTooltip(lastUpdated) {
        if (!lastUpdated) {
            return 'Order book data - Visit market page to refresh';
        }

        const age = Date.now() - lastUpdated;
        const relativeTime = formatRelativeTime(age);
        return `Order book data from ${relativeTime} ago - Visit market page to refresh`;
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

        if (this.unregisterMyListingsObserver) {
            this.unregisterMyListingsObserver();
            this.unregisterMyListingsObserver = null;
        }

        if (this.myListingsCheckInterval) {
            clearInterval(this.myListingsCheckInterval);
            this.myListingsCheckInterval = null;
        }

        this.clearDisplays();
        this.isInitialized = false;
    }
}

const estimatedListingAge = new EstimatedListingAge();

export default estimatedListingAge;
