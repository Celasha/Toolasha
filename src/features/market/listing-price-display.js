/**
 * Market Listing Price Display Module
 *
 * Shows pricing information on individual market listings
 * - Top Order Price: Current best market price with competitive color coding
 * - Total Price: Total remaining value of the listing
 * Ported from Ranged Way Idle's showListingInfo feature
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import estimatedListingAge from './estimated-listing-age.js';
import { coinFormatter, formatRelativeTime } from '../../utils/formatters.js';
import { calculatePriceAfterTax } from '../../utils/profit-helpers.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';

class ListingPriceDisplay {
    constructor() {
        this.allListings = {}; // Maintained listing state
        this.unregisterWebSocket = null;
        this.unregisterObserver = null;
        this.isInitialized = false;
        this.cleanupRegistry = createCleanupRegistry();
    }

    /**
     * Initialize the listing price display
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showListingPrices')) {
            return;
        }

        this.isInitialized = true;

        // Load initial listings from dataManager
        this.loadInitialListings();

        this.setupWebSocketListeners();
        this.setupObserver();
    }

    /**
     * Load initial listings from dataManager (already received via init_character_data)
     */
    loadInitialListings() {
        const listings = dataManager.getMarketListings();

        for (const listing of listings) {
            this.handleListing(listing);
        }
    }

    /**
     * Setup WebSocket listeners for listing updates
     */
    setupWebSocketListeners() {
        // Handle initial character data
        const initHandler = (data) => {
            if (data.myMarketListings) {
                for (const listing of data.myMarketListings) {
                    this.handleListing(listing);
                }
            }
        };

        // Handle listing updates
        const updateHandler = (data) => {
            if (data.endMarketListings) {
                for (const listing of data.endMarketListings) {
                    this.handleListing(listing);
                }
                // Clear existing displays to force refresh
                this.clearDisplays();

                // Wait for React to update DOM before re-processing
                // (DOM observer won't fire because table element didn't appear/disappear)
                const visibleTable = document.querySelector('[class*="MarketplacePanel_myListingsTable"]');
                if (visibleTable) {
                    this.scheduleTableRefresh(visibleTable);
                }
            }
        };

        dataManager.on('character_initialized', initHandler);
        dataManager.on('market_listings_updated', updateHandler);

        // Handle order book updates to re-render with populated cache (if Top Order Age enabled)
        let orderBookHandler = null;
        if (config.getSetting('market_showTopOrderAge')) {
            orderBookHandler = (data) => {
                if (data.marketItemOrderBooks) {
                    // Delay re-render to let estimatedListingAge populate cache first (race condition)
                    setTimeout(() => {
                        document.querySelectorAll('[class*="MarketplacePanel_myListingsTable"]').forEach((table) => {
                            table.classList.remove('mwi-listing-prices-set');
                            this.updateTable(table);
                        });
                    }, 10);
                }
            };
            dataManager.on('market_item_order_books_updated', orderBookHandler);
        }

        // Store for cleanup
        this.unregisterWebSocket = () => {
            dataManager.off('character_initialized', initHandler);
            dataManager.off('market_listings_updated', updateHandler);
            if (orderBookHandler) {
                dataManager.off('market_item_order_books_updated', orderBookHandler);
            }
        };

        this.cleanupRegistry.registerCleanup(() => {
            if (this.unregisterWebSocket) {
                this.unregisterWebSocket();
                this.unregisterWebSocket = null;
            }
        });
    }

    /**
     * Setup DOM observer to watch for My Listings table
     */
    setupObserver() {
        this.unregisterObserver = domObserver.onClass(
            'ListingPriceDisplay',
            'MarketplacePanel_myListingsTable',
            (tableNode) => {
                this.scheduleTableRefresh(tableNode);
            }
        );

        this.cleanupRegistry.registerCleanup(() => {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
        });

        // Check for existing table
        const existingTable = document.querySelector('[class*="MarketplacePanel_myListingsTable"]');
        if (existingTable) {
            this.scheduleTableRefresh(existingTable);
        }
    }

    /**
     * Schedule a refresh to wait for React to populate table rows
     * @param {HTMLElement} tableNode - The listings table element
     */
    scheduleTableRefresh(tableNode) {
        const tbody = tableNode.querySelector('tbody');
        if (!tbody) {
            return;
        }

        let timeoutId = null;
        const maxAttempts = 20;
        let attempts = 0;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        this.cleanupRegistry.registerCleanup(cleanup);

        const checkAndProcess = () => {
            const rowCount = tbody.querySelectorAll('tr').length;
            const listingCount = Object.keys(this.allListings).length;

            if (rowCount === listingCount) {
                cleanup();
                this.updateTable(tableNode);
                return;
            }

            attempts += 1;
            if (attempts >= maxAttempts) {
                cleanup();
                console.error('[ListingPriceDisplay] Timeout waiting for React to update table');
                return;
            }

            timeoutId = setTimeout(checkAndProcess, 100);
            this.cleanupRegistry.registerTimeout(timeoutId);
        };

        checkAndProcess();
    }

    /**
     * Handle listing data from WebSocket
     * @param {Object} listing - Listing data
     */
    handleListing(listing) {
        // Filter out cancelled and fully claimed listings
        if (
            listing.status === '/market_listing_status/cancelled' ||
            (listing.status === '/market_listing_status/filled' &&
                listing.unclaimedItemCount === 0 &&
                listing.unclaimedCoinCount === 0)
        ) {
            delete this.allListings[listing.id];
            return;
        }

        // Store/update listing data
        this.allListings[listing.id] = {
            id: listing.id,
            isSell: listing.isSell,
            itemHrid: listing.itemHrid,
            enhancementLevel: listing.enhancementLevel,
            orderQuantity: listing.orderQuantity,
            filledQuantity: listing.filledQuantity,
            price: listing.price,
            createdTimestamp: listing.createdTimestamp,
            unclaimedCoinCount: listing.unclaimedCoinCount || 0,
            unclaimedItemCount: listing.unclaimedItemCount || 0,
        };
    }

    /**
     * Update the My Listings table with pricing columns
     * @param {HTMLElement} tableNode - The listings table element
     */
    updateTable(tableNode) {
        if (tableNode.classList.contains('mwi-listing-prices-set')) {
            return;
        }

        // Clear any existing price displays from this table before re-rendering
        tableNode.querySelectorAll('.mwi-listing-price-header').forEach((el) => el.remove());
        tableNode.querySelectorAll('.mwi-listing-price-cell').forEach((el) => el.remove());

        // Wait until row count matches listing count
        const tbody = tableNode.querySelector('tbody');
        if (!tbody) {
            return;
        }

        const rowCount = tbody.querySelectorAll('tr').length;
        const listingCount = Object.keys(this.allListings).length;

        if (rowCount !== listingCount) {
            return; // Table not fully populated yet
        }

        // OPTIMIZATION: Pre-fetch all market prices in one batch
        const itemsToPrice = Object.values(this.allListings).map((listing) => ({
            itemHrid: listing.itemHrid,
            enhancementLevel: listing.enhancementLevel,
        }));
        const priceCache = marketAPI.getPricesBatch(itemsToPrice);

        // Add table headers
        this.addTableHeaders(tableNode);

        // Add data to rows
        this.addDataToRows(tbody);

        // Add price displays to each row
        this.addPriceDisplays(tbody, priceCache);

        // Check if we should mark as fully processed
        let fullyProcessed = true;

        if (config.getSetting('market_showTopOrderAge')) {
            // Only mark as processed if cache has data for all listings
            for (const listing of Object.values(this.allListings)) {
                const orderBookData = estimatedListingAge.orderBooksCache[listing.itemHrid];
                if (!orderBookData || !orderBookData.orderBooks || orderBookData.orderBooks.length === 0) {
                    fullyProcessed = false;
                    break;
                }
            }
        }

        // Only mark as processed if fully complete
        if (fullyProcessed) {
            tableNode.classList.add('mwi-listing-prices-set');
        }
    }

    /**
     * Add column headers to table head
     * @param {HTMLElement} tableNode - The listings table
     */
    addTableHeaders(tableNode) {
        const thead = tableNode.querySelector('thead tr');
        if (!thead) return;

        // Skip if headers already added
        if (thead.querySelector('.mwi-listing-price-header')) {
            return;
        }

        // Create "Top Order Price" header
        const topOrderHeader = document.createElement('th');
        topOrderHeader.classList.add('mwi-listing-price-header');
        topOrderHeader.textContent = 'Top Order Price';

        // Create "Top Order Age" header (if setting enabled)
        let topOrderAgeHeader = null;
        if (config.getSetting('market_showTopOrderAge')) {
            topOrderAgeHeader = document.createElement('th');
            topOrderAgeHeader.classList.add('mwi-listing-price-header');
            topOrderAgeHeader.textContent = 'Top Order Age';
            topOrderAgeHeader.title = 'Estimated age of the top competing order';
        }

        // Create "Total Price" header
        const totalPriceHeader = document.createElement('th');
        totalPriceHeader.classList.add('mwi-listing-price-header');
        totalPriceHeader.textContent = 'Total Price';

        // Create "Listed" header (if setting enabled)
        let listedHeader = null;
        if (config.getSetting('market_showListingAge')) {
            listedHeader = document.createElement('th');
            listedHeader.classList.add('mwi-listing-price-header');
            listedHeader.textContent = 'Listed';
        }

        // Insert headers (order: Top Order Price, Top Order Age, Total Price, Listed)
        let insertIndex = 4;
        thead.insertBefore(topOrderHeader, thead.children[insertIndex++]);
        if (topOrderAgeHeader) {
            thead.insertBefore(topOrderAgeHeader, thead.children[insertIndex++]);
        }
        thead.insertBefore(totalPriceHeader, thead.children[insertIndex++]);
        if (listedHeader) {
            thead.insertBefore(listedHeader, thead.children[insertIndex++]);
        }
    }

    /**
     * Add listing data to row datasets for matching
     * @param {HTMLElement} tbody - Table body element
     */
    addDataToRows(tbody) {
        const listings = Object.values(this.allListings);
        const used = new Set();

        for (const row of tbody.querySelectorAll('tr')) {
            const rowInfo = this.extractRowInfo(row);

            // Find matching listing with improved criteria
            const matchedListing = listings.find((listing) => {
                if (used.has(listing.id)) return false;

                // Basic matching criteria
                const itemMatch = listing.itemHrid === rowInfo.itemHrid;
                const enhancementMatch = listing.enhancementLevel === rowInfo.enhancementLevel;
                const typeMatch = listing.isSell === rowInfo.isSell;
                const priceMatch = !rowInfo.price || Math.abs(listing.price - rowInfo.price) < 0.01;

                if (!itemMatch || !enhancementMatch || !typeMatch || !priceMatch) {
                    return false;
                }

                // If quantity info is available from row, use it for precise matching
                if (rowInfo.filledQuantity !== null && rowInfo.orderQuantity !== null) {
                    const quantityMatch =
                        listing.filledQuantity === rowInfo.filledQuantity &&
                        listing.orderQuantity === rowInfo.orderQuantity;
                    return quantityMatch;
                }

                // Fallback to basic match if no quantity info
                return true;
            });

            if (matchedListing) {
                used.add(matchedListing.id);
                // Store listing data in row dataset
                row.dataset.listingId = matchedListing.id;
                row.dataset.itemHrid = matchedListing.itemHrid;
                row.dataset.enhancementLevel = matchedListing.enhancementLevel;
                row.dataset.isSell = matchedListing.isSell;
                row.dataset.price = matchedListing.price;
                row.dataset.orderQuantity = matchedListing.orderQuantity;
                row.dataset.filledQuantity = matchedListing.filledQuantity;
                row.dataset.createdTimestamp = matchedListing.createdTimestamp;
                row.dataset.unclaimedCoinCount = matchedListing.unclaimedCoinCount;
                row.dataset.unclaimedItemCount = matchedListing.unclaimedItemCount;
            }
        }
    }

    /**
     * Extract listing info from table row for matching
     * @param {HTMLElement} row - Table row element
     * @returns {Object} Extracted row info
     */
    extractRowInfo(row) {
        // Extract itemHrid from SVG use element
        let itemHrid = null;
        const useElements = row.querySelectorAll('use');
        for (const use of useElements) {
            const href = use.href && use.href.baseVal ? use.href.baseVal : '';
            if (href.includes('#')) {
                const idPart = href.split('#')[1];
                if (idPart && !idPart.toLowerCase().includes('coin')) {
                    itemHrid = `/items/${idPart}`;
                    break;
                }
            }
        }

        // Extract enhancement level
        let enhancementLevel = 0;
        const enhNode = row.querySelector('[class*="enhancementLevel"]');
        if (enhNode && enhNode.textContent) {
            const match = enhNode.textContent.match(/\+\s*(\d+)/);
            if (match) {
                enhancementLevel = Number(match[1]);
            }
        }

        // Detect isSell from type cell (2nd cell)
        let isSell = null;
        const typeCell = row.children[1];
        if (typeCell) {
            const text = (typeCell.textContent || '').toLowerCase();
            if (text.includes('sell')) {
                isSell = true;
            } else if (text.includes('buy')) {
                isSell = false;
            }
        }

        // Extract quantity (3rd cell) - format: "filled / total"
        let filledQuantity = null;
        let orderQuantity = null;
        const quantityCell = row.children[2];
        if (quantityCell) {
            const text = quantityCell.textContent.trim();
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                filledQuantity = Number(match[1]);
                orderQuantity = Number(match[2]);
            }
        }

        // Extract price (4th cell before our inserts)
        let price = NaN;
        const priceNode = row.querySelector('[class*="price"]') || row.children[3];
        if (priceNode) {
            let text =
                priceNode.firstChild && priceNode.firstChild.textContent
                    ? priceNode.firstChild.textContent
                    : priceNode.textContent;
            text = String(text).trim();

            // Handle K/M suffixes (e.g., "340K" = 340000, "1.5M" = 1500000)
            let multiplier = 1;
            if (text.toUpperCase().includes('K')) {
                multiplier = 1000;
                text = text.replace(/K/gi, '');
            } else if (text.toUpperCase().includes('M')) {
                multiplier = 1000000;
                text = text.replace(/M/gi, '');
            }

            // Parse number handling both locale formats:
            // US: "3,172" or "3,172.50" (comma = thousands, dot = decimal)
            // EU: "3.172" or "3.172,50" (dot = thousands, comma = decimal)
            // Strategy: Find last dot/comma (decimal separator), remove all others (thousand separators)
            const lastDotIndex = text.lastIndexOf('.');
            const lastCommaIndex = text.lastIndexOf(',');
            const lastSeparatorIndex = Math.max(lastDotIndex, lastCommaIndex);

            let numStr;
            if (lastSeparatorIndex === -1) {
                // No separators, just extract digits
                numStr = text.replace(/[^0-9]/g, '');
            } else {
                // Has separator - determine if it's decimal or thousand separator
                const beforeSeparator = text.substring(0, lastSeparatorIndex);
                const afterSeparator = text.substring(lastSeparatorIndex + 1);

                // If there are 1-2 digits after separator, it's likely a decimal point
                // If there are exactly 3 digits after separator, it could be either (ambiguous)
                // If there are more than 3 digits, it's definitely a decimal point
                const digitsAfter = afterSeparator.replace(/[^0-9]/g, '').length;

                if (digitsAfter <= 2 && digitsAfter > 0) {
                    // Decimal separator (e.g., "3,172.50" or "3.172,50")
                    numStr = beforeSeparator.replace(/[^0-9]/g, '') + '.' + afterSeparator.replace(/[^0-9]/g, '');
                } else {
                    // Thousand separator or no decimal (e.g., "3,172" or "3.172")
                    numStr = text.replace(/[^0-9]/g, '');
                }
            }

            price = numStr ? Number(numStr) * multiplier : NaN;
        }

        return { itemHrid, enhancementLevel, isSell, price, filledQuantity, orderQuantity };
    }

    /**
     * Add price display cells to each row
     * @param {HTMLElement} tbody - Table body element
     * @param {Map} priceCache - Pre-fetched price cache
     */
    addPriceDisplays(tbody, priceCache) {
        for (const row of tbody.querySelectorAll('tr')) {
            // Skip if displays already added
            if (row.querySelector('.mwi-listing-price-cell')) {
                continue;
            }

            const dataset = row.dataset;
            const hasMatchedListing = !!dataset.listingId;

            // Insert at index 4 (same as headers) to maintain alignment
            const insertIndex = 4;
            const insertBeforeCell = row.children[insertIndex] || null;

            if (hasMatchedListing) {
                // Matched row - create cells with actual data
                const itemHrid = dataset.itemHrid;
                const enhancementLevel = Number(dataset.enhancementLevel);
                const isSell = dataset.isSell === 'true';
                const price = Number(dataset.price);
                const orderQuantity = Number(dataset.orderQuantity);
                const filledQuantity = Number(dataset.filledQuantity);
                const unclaimedCoinCount = Number(dataset.unclaimedCoinCount) || 0;
                const unclaimedItemCount = Number(dataset.unclaimedItemCount) || 0;

                // Create Top Order Price cell
                const topOrderCell = this.createTopOrderPriceCell(
                    itemHrid,
                    enhancementLevel,
                    isSell,
                    price,
                    priceCache
                );
                row.insertBefore(topOrderCell, insertBeforeCell);

                // Create Top Order Age cell (if setting enabled)
                if (config.getSetting('market_showTopOrderAge')) {
                    const topOrderAgeCell = this.createTopOrderAgeCell(itemHrid, enhancementLevel, isSell);
                    row.insertBefore(topOrderAgeCell, row.children[insertIndex + 1]);
                }

                // Create Total Price cell
                const currentInsertIndex = insertIndex + (config.getSetting('market_showTopOrderAge') ? 2 : 1);
                const totalPriceCell = this.createTotalPriceCell(
                    itemHrid,
                    isSell,
                    price,
                    orderQuantity,
                    filledQuantity,
                    unclaimedCoinCount,
                    unclaimedItemCount
                );
                row.insertBefore(totalPriceCell, row.children[currentInsertIndex]);

                // Create Listed Age cell (if setting enabled)
                if (config.getSetting('market_showListingAge') && dataset.createdTimestamp) {
                    const listedInsertIndex = currentInsertIndex + 1;
                    const listedAgeCell = this.createListedAgeCell(dataset.createdTimestamp);
                    row.insertBefore(listedAgeCell, row.children[listedInsertIndex]);
                }
            } else {
                // Unmatched row - create placeholder cells to prevent column misalignment
                const topOrderCell = this.createPlaceholderCell();
                row.insertBefore(topOrderCell, insertBeforeCell);

                if (config.getSetting('market_showTopOrderAge')) {
                    const topOrderAgeCell = this.createPlaceholderCell();
                    row.insertBefore(topOrderAgeCell, row.children[insertIndex + 1]);
                }

                const currentInsertIndex = insertIndex + (config.getSetting('market_showTopOrderAge') ? 2 : 1);
                const totalPriceCell = this.createPlaceholderCell();
                row.insertBefore(totalPriceCell, row.children[currentInsertIndex]);

                if (config.getSetting('market_showListingAge')) {
                    const listedInsertIndex = currentInsertIndex + 1;
                    const listedAgeCell = this.createPlaceholderCell();
                    row.insertBefore(listedAgeCell, row.children[listedInsertIndex]);
                }
            }
        }
    }

    /**
     * Create Top Order Price cell
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {boolean} isSell - Is sell order
     * @param {number} price - Listing price
     * @param {Map} priceCache - Pre-fetched price cache
     * @returns {HTMLElement} Table cell element
     */
    createTopOrderPriceCell(itemHrid, enhancementLevel, isSell, price, priceCache) {
        const cell = document.createElement('td');
        cell.classList.add('mwi-listing-price-cell');

        const span = document.createElement('span');
        span.classList.add('mwi-listing-price-value');

        // Get current market price from cache
        const key = `${itemHrid}:${enhancementLevel}`;
        const marketPrice = priceCache.get(key);
        const topOrderPrice = marketPrice ? (isSell ? marketPrice.ask : marketPrice.bid) : null;

        if (topOrderPrice === null || topOrderPrice === -1) {
            span.textContent = coinFormatter(null);
            span.style.color = '#004FFF'; // Blue for no data
        } else {
            span.textContent = coinFormatter(topOrderPrice);

            // Color coding based on competitiveness
            if (isSell) {
                // Sell order: green if our price is lower (better), red if higher (undercut)
                span.style.color = topOrderPrice < price ? '#FF0000' : '#00FF00';
            } else {
                // Buy order: green if our price is higher (better), red if lower (undercut)
                span.style.color = topOrderPrice > price ? '#FF0000' : '#00FF00';
            }
        }

        cell.appendChild(span);
        return cell;
    }

    /**
     * Create Top Order Age cell
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {boolean} isSell - Is sell order
     * @returns {HTMLElement} Table cell element
     */
    createTopOrderAgeCell(itemHrid, enhancementLevel, isSell) {
        const cell = document.createElement('td');
        cell.classList.add('mwi-listing-price-cell');

        const span = document.createElement('span');
        span.classList.add('mwi-listing-price-value');

        // Get order book data from estimatedListingAge module (shared cache)
        const orderBookData = estimatedListingAge.orderBooksCache[itemHrid];

        if (!orderBookData || !orderBookData.orderBooks || orderBookData.orderBooks.length === 0) {
            // No order book data available
            span.textContent = 'N/A';
            span.style.color = '#666666';
            span.style.fontSize = '0.9em';
            cell.appendChild(span);
            return cell;
        }

        // Find matching order book for this enhancement level
        let orderBook = orderBookData.orderBooks.find((ob) => ob.enhancementLevel === enhancementLevel);

        // For non-enhanceable items (enh level 0), orderBook won't have enhancementLevel field
        // Just use the first (and only) orderBook entry
        if (!orderBook && enhancementLevel === 0 && orderBookData.orderBooks.length > 0) {
            orderBook = orderBookData.orderBooks[0];
        }

        if (!orderBook) {
            span.textContent = 'N/A';
            span.style.color = '#666666';
            span.style.fontSize = '0.9em';
            cell.appendChild(span);
            return cell;
        }

        // Get top order (first in array)
        const topOrders = isSell ? orderBook.asks : orderBook.bids;

        if (!topOrders || topOrders.length === 0) {
            // No competing orders
            span.textContent = 'None';
            span.style.color = '#00FF00'; // Green = you're the only one
            span.style.fontSize = '0.9em';
            cell.appendChild(span);
            return cell;
        }

        const topOrder = topOrders[0];
        const topListingId = topOrder.listingId;

        // Estimate timestamp using existing logic
        const estimatedTimestamp = estimatedListingAge.estimateTimestamp(topListingId);

        // Format as elapsed time
        const ageMs = Date.now() - estimatedTimestamp;
        const formatted = formatRelativeTime(ageMs);

        span.textContent = `~${formatted}`;
        span.style.color = '#999999'; // Gray to indicate estimate
        span.style.fontSize = '0.9em';

        cell.appendChild(span);
        return cell;
    }

    /**
     * Create Total Price cell
     * @param {string} itemHrid - Item HRID
     * @param {boolean} isSell - Is sell order
     * @param {number} price - Unit price
     * @param {number} orderQuantity - Total quantity ordered
     * @param {number} filledQuantity - Quantity already filled
     * @param {number} unclaimedCoinCount - Unclaimed coins (for filled sell orders)
     * @param {number} unclaimedItemCount - Unclaimed items (for filled buy orders)
     * @returns {HTMLElement} Table cell element
     */
    createTotalPriceCell(
        itemHrid,
        isSell,
        price,
        orderQuantity,
        filledQuantity,
        unclaimedCoinCount,
        unclaimedItemCount
    ) {
        const cell = document.createElement('td');
        cell.classList.add('mwi-listing-price-cell');

        const span = document.createElement('span');
        span.classList.add('mwi-listing-price-value');

        let totalPrice;

        // For filled listings, show unclaimed amount
        if (filledQuantity === orderQuantity) {
            if (isSell) {
                // Sell order: show unclaimed coins
                totalPrice = unclaimedCoinCount;
            } else {
                // Buy order: show value of unclaimed items
                totalPrice = unclaimedItemCount * price;
            }
        } else {
            // For active listings, calculate remaining value
            // Calculate tax rate (0.18 for cowbells, 0.02 for others, 0.0 for buy orders)
            const taxRate = isSell ? (itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.02) : 0;
            totalPrice = (orderQuantity - filledQuantity) * Math.floor(calculatePriceAfterTax(price, taxRate));
        }

        // Format and color code
        span.textContent = coinFormatter(totalPrice);

        // Color based on amount
        span.style.color = this.getAmountColor(totalPrice);

        cell.appendChild(span);
        return cell;
    }

    /**
     * Create Listed Age cell
     * @param {string} createdTimestamp - ISO timestamp when listing was created
     * @returns {HTMLElement} Table cell element
     */
    createListedAgeCell(createdTimestamp) {
        const cell = document.createElement('td');
        cell.classList.add('mwi-listing-price-cell');

        const span = document.createElement('span');
        span.classList.add('mwi-listing-price-value');

        // Calculate age in milliseconds
        const createdDate = new Date(createdTimestamp);
        const ageMs = Date.now() - createdDate.getTime();

        // Format relative time
        span.textContent = formatRelativeTime(ageMs);
        span.style.color = '#AAAAAA'; // Gray for time display

        cell.appendChild(span);
        return cell;
    }

    /**
     * Create placeholder cell for unmatched rows
     * @returns {HTMLElement} Empty table cell element
     */
    createPlaceholderCell() {
        const cell = document.createElement('td');
        cell.classList.add('mwi-listing-price-cell');

        const span = document.createElement('span');
        span.classList.add('mwi-listing-price-value');
        span.textContent = 'N/A';
        span.style.color = '#666666'; // Gray for placeholder
        span.style.fontSize = '0.9em';

        cell.appendChild(span);
        return cell;
    }

    /**
     * Get color for amount based on magnitude
     * @param {number} amount - Amount value
     * @returns {string} Color code
     */
    getAmountColor(amount) {
        if (amount >= 1000000) return '#FFD700'; // Gold for 1M+
        if (amount >= 100000) return '#00FF00'; // Green for 100K+
        if (amount >= 10000) return '#FFFFFF'; // White for 10K+
        return '#AAAAAA'; // Gray for small amounts
    }

    /**
     * Clear all injected displays
     */
    clearDisplays() {
        document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
            table.classList.remove('mwi-listing-prices-set');
        });
        document.querySelectorAll('.mwi-listing-price-header').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-listing-price-cell').forEach((el) => el.remove());
    }

    /**
     * Disable the listing price display
     */
    disable() {
        console.log('[ListingPriceDisplay] 🧹 Cleaning up handlers');
        this.cleanupRegistry.cleanupAll();
        this.clearDisplays();
        this.allListings = {};
        this.isInitialized = false;
    }
}

const listingPriceDisplay = new ListingPriceDisplay();

export default listingPriceDisplay;
