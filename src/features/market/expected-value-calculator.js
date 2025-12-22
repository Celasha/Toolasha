/**
 * Expected Value Calculator Module
 * Calculates expected value for openable containers
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import { numberFormatter } from '../../utils/formatters.js';

/**
 * ExpectedValueCalculator class handles EV calculations for openable containers
 */
class ExpectedValueCalculator {
    constructor() {
        // Constants
        this.MARKET_TAX = 0.02; // 2% marketplace tax
        this.CONVERGENCE_ITERATIONS = 4; // Nested container convergence

        // Cache for container EVs
        this.containerCache = new Map();

        // Special item HRIDs
        this.COIN_HRID = '/items/coin';
        this.COWBELL_HRID = '/items/cowbell';
        this.COWBELL_BAG_HRID = '/items/bag_of_10_cowbells';

        // Flag to track if initialized
        this.isInitialized = false;
    }

    /**
     * Initialize the calculator
     * Pre-calculates all openable containers with nested convergence
     */
    async initialize() {
        if (!dataManager.getInitClientData()) {
            console.warn('[ExpectedValueCalculator] Init data not available');
            return false;
        }

        // Wait for market data to load
        if (!marketAPI.isLoaded()) {
            console.log('[ExpectedValueCalculator] Waiting for market data...');
            await marketAPI.fetch(true); // Force fresh fetch on init
        }

        // Calculate all containers with 4-iteration convergence for nesting
        this.calculateNestedContainers();

        this.isInitialized = true;
        console.log('[ExpectedValueCalculator] ✅ Initialized with', this.containerCache.size, 'containers');
        return true;
    }

    /**
     * Calculate all containers with nested convergence
     * Iterates 4 times to resolve nested container values
     */
    calculateNestedContainers() {
        const initData = dataManager.getInitClientData();
        if (!initData || !initData.openableLootDropMap) {
            return;
        }

        // Get all openable container HRIDs
        const containerHrids = Object.keys(initData.openableLootDropMap);

        // Iterate 4 times for convergence (handles nesting depth)
        for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
            for (const containerHrid of containerHrids) {
                // Calculate and cache EV for this container
                const ev = this.calculateSingleContainer(containerHrid);
                if (ev !== null) {
                    this.containerCache.set(containerHrid, ev);
                }
            }
        }
    }

    /**
     * Calculate expected value for a single container
     * @param {string} containerHrid - Container item HRID
     * @returns {number|null} Expected value or null if unavailable
     */
    calculateSingleContainer(containerHrid) {
        const initData = dataManager.getInitClientData();
        if (!initData || !initData.openableLootDropMap) {
            return null;
        }

        // Get drop table for this container
        const dropTable = initData.openableLootDropMap[containerHrid];
        if (!dropTable || dropTable.length === 0) {
            return null;
        }

        let totalExpectedValue = 0;
        let missingDataCount = 0;

        // Calculate expected value for each drop
        for (const drop of dropTable) {
            const itemHrid = drop.itemHrid;
            const dropRate = drop.dropRate || 0;
            const minCount = drop.minCount || 0;
            const maxCount = drop.maxCount || 0;

            // Skip invalid drops
            if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
                continue;
            }

            // Calculate average drop count
            const avgCount = (minCount + maxCount) / 2;

            // Get price for this drop
            const price = this.getDropPrice(itemHrid);

            if (price === null) {
                missingDataCount++;
                continue; // Skip drops with missing data
            }

            // Check if item is tradeable (for tax calculation)
            const itemDetails = dataManager.getItemDetails(itemHrid);
            const canBeSold = itemDetails?.tradeable !== false;
            const taxFactor = canBeSold ? (1 - this.MARKET_TAX) : 1.0;

            // Calculate expected value: avgCount × dropRate × price × taxFactor
            const dropValue = avgCount * dropRate * price * taxFactor;
            totalExpectedValue += dropValue;
        }

        return totalExpectedValue;
    }

    /**
     * Get price for a drop item
     * Handles special cases (Coin, Cowbell, nested containers)
     * @param {string} itemHrid - Item HRID
     * @returns {number|null} Price or null if unavailable
     */
    getDropPrice(itemHrid) {
        // Special case: Coin (face value = 1)
        if (itemHrid === this.COIN_HRID) {
            return 1;
        }

        // Special case: Cowbell (use bag price ÷ 10, with 18% tax)
        if (itemHrid === this.COWBELL_HRID) {
            const bagPrice = marketAPI.getPrice(this.COWBELL_BAG_HRID, 0);
            if (bagPrice) {
                // Respect pricing mode for Cowbell Bag price
                const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');
                const respectPricingMode = config.getSettingValue('expectedValue_respectPricingMode', true);

                let bagValue = 0;
                if (respectPricingMode) {
                    // Conservative: Bid (instant sell), Hybrid/Optimistic: Ask (patient sell)
                    bagValue = pricingMode === 'conservative' ? bagPrice.bid : bagPrice.ask;
                } else {
                    // Always use conservative
                    bagValue = bagPrice.bid;
                }

                if (bagValue > 0) {
                    // Apply 18% market tax (Cowbell Bag only), then divide by 10
                    return (bagValue * 0.82) / 10;
                }
            }
            return null; // No bag price available
        }

        // Check if this is a nested container (use cached EV)
        if (this.containerCache.has(itemHrid)) {
            return this.containerCache.get(itemHrid);
        }

        // Regular market item - get price based on pricing mode
        const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');
        const respectPricingMode = config.getSettingValue('expectedValue_respectPricingMode', true);

        // Get market price
        const price = marketAPI.getPrice(itemHrid, 0);
        if (!price) {
            return null; // No market data
        }

        // Determine which price to use for drop revenue
        let dropPrice = 0;

        if (respectPricingMode) {
            // Conservative: Bid (instant sell)
            // Hybrid/Optimistic: Ask (patient sell)
            if (pricingMode === 'conservative') {
                dropPrice = price.bid;
            } else {
                dropPrice = price.ask;
            }
        } else {
            // Always use conservative (instant sell)
            dropPrice = price.bid;
        }

        return dropPrice > 0 ? dropPrice : null;
    }

    /**
     * Calculate expected value for an openable container
     * @param {string} itemHrid - Container item HRID
     * @returns {Object|null} EV data or null
     */
    calculateExpectedValue(itemHrid) {
        if (!this.isInitialized) {
            console.warn('[ExpectedValueCalculator] Not initialized');
            return null;
        }

        // Get item details
        const itemDetails = dataManager.getItemDetails(itemHrid);
        if (!itemDetails) {
            return null;
        }

        // Verify this is an openable container
        if (!itemDetails.isOpenable) {
            return null; // Not an openable container
        }

        // Get detailed drop breakdown (calculates with fresh market prices)
        const drops = this.getDropBreakdown(itemHrid);

        // Calculate total expected value from fresh drop data
        const expectedReturn = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);

        return {
            itemName: itemDetails.name,
            itemHrid,
            expectedValue: expectedReturn,
            drops
        };
    }

    /**
     * Get cached expected value for a container (for use by other modules)
     * @param {string} itemHrid - Container item HRID
     * @returns {number|null} Cached EV or null
     */
    getCachedValue(itemHrid) {
        return this.containerCache.get(itemHrid) || null;
    }

    /**
     * Get detailed drop breakdown for display
     * @param {string} containerHrid - Container HRID
     * @returns {Array} Array of drop objects
     */
    getDropBreakdown(containerHrid) {
        const initData = dataManager.getInitClientData();
        if (!initData || !initData.openableLootDropMap) {
            return [];
        }

        const dropTable = initData.openableLootDropMap[containerHrid];
        if (!dropTable) {
            return [];
        }

        const drops = [];

        for (const drop of dropTable) {
            const itemHrid = drop.itemHrid;
            const dropRate = drop.dropRate || 0;
            const minCount = drop.minCount || 0;
            const maxCount = drop.maxCount || 0;

            if (dropRate <= 0) {
                continue;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                continue;
            }

            // Calculate average count
            const avgCount = (minCount + maxCount) / 2;

            // Get price
            const price = this.getDropPrice(itemHrid);

            // Calculate expected value for this drop
            const itemCanBeSold = itemDetails.tradeable !== false;
            const taxFactor = itemCanBeSold ? (1 - this.MARKET_TAX) : 1.0;
            const dropValue = price !== null ? (avgCount * dropRate * price * taxFactor) : 0;

            drops.push({
                itemHrid,
                itemName: itemDetails.name,
                dropRate,
                avgCount,
                priceEach: price || 0,
                expectedValue: dropValue,
                hasPriceData: price !== null
            });
        }

        // Sort by expected value (highest first)
        drops.sort((a, b) => b.expectedValue - a.expectedValue);

        return drops;
    }

    /**
     * Invalidate cache (call when market data refreshes)
     */
    invalidateCache() {
        this.containerCache.clear();
        this.isInitialized = false;
        console.log('[ExpectedValueCalculator] Cache invalidated');

        // Re-initialize if data is available
        if (dataManager.getInitClientData() && marketAPI.isLoaded()) {
            this.initialize();
        }
    }
}

// Create and export singleton instance
const expectedValueCalculator = new ExpectedValueCalculator();

export default expectedValueCalculator;
