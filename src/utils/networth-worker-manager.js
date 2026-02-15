/**
 * Networth Item Valuation Worker Manager
 * Manages parallel item valuation calculations including enhancement paths
 */

import WorkerPool from './worker-pool.js';

// Worker pool instance
let workerPool = null;

// Worker script as inline string
const WORKER_SCRIPT = `
// Import math.js library for enhancement calculations
importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js');

// Cache for item valuations
const valuationCache = new Map();

// Enhancement calculation BASE_SUCCESS_RATES
const BASE_SUCCESS_RATES = [50,45,45,40,40,40,35,35,35,35,30,30,30,30,30,30,30,30,30,30];

/**
 * Calculate enhancement path cost (simplified version for worker)
 * @param {Object} params - Enhancement calculation parameters
 * @returns {number} Total cost
 */
function calculateEnhancementCost(params) {
    const { itemHrid, targetLevel, enhancementParams, itemDetails, priceMap } = params;

    if (!itemDetails.enhancementCosts || targetLevel < 1 || targetLevel > 20) {
        return null;
    }

    const itemLevel = itemDetails.itemLevel || 1;
    let totalCost = 0;

    // Get base item cost
    const basePrice = priceMap[itemHrid + ':0'] || 0;
    totalCost += basePrice;

    // Calculate material costs for all levels
    for (let level = 1; level <= targetLevel; level++) {
        const enhCost = itemDetails.enhancementCosts[level - 1];
        if (!enhCost || !enhCost.itemHrid) continue;

        const materialPrice = priceMap[enhCost.itemHrid + ':0'] || 0;
        const materialCount = enhCost.count || 1;

        // Calculate attempts needed (simplified - use protection at level - 2)
        const protectFrom = Math.max(0, level - 2);
        const attempts = calculateAttempts(enhancementParams, itemLevel, level, protectFrom);

        totalCost += materialPrice * materialCount * attempts;
    }

    // Add protection costs (simplified)
    const protections = Math.max(0, targetLevel - 2) * 2; // Rough estimate
    totalCost += protections * 50000; // 50k per protection

    return totalCost;
}

/**
 * Calculate expected attempts for enhancement level (simplified)
 */
function calculateAttempts(enhancementParams, itemLevel, targetLevel, protectFrom) {
    const { enhancingLevel, toolBonus } = enhancementParams;

    // Calculate success multiplier
    let totalBonus;
    if (enhancingLevel >= itemLevel) {
        const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
        totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
    } else {
        totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
    }

    // Build Markov chain (same as main enhancement calculator)
    const markov = math.zeros(20, 20);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = baseSuccessRate * totalBonus;
        const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

        markov.set([i, i + 1], successChance);
        markov.set([i, failureDestination], 1.0 - successChance);
    }

    markov.set([targetLevel, targetLevel], 1.0);

    // Solve for expected attempts
    const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    let attempts = 0;
    for (let i = 0; i < targetLevel; i++) {
        attempts += M.get([0, i]);
    }

    return Math.round(attempts);
}

/**
 * Calculate value for a single item
 * @param {Object} data - Item data
 * @returns {Object} {itemIndex, value}
 */
function calculateItemValue(data) {
    const { itemIndex, item, priceMap, useHighEnhancementCost, minLevel, enhancementParams, itemDetails } = data;
    const { itemHrid, enhancementLevel = 0, count = 1 } = item;

    let itemValue = 0;

    // For enhanced items (1+)
    if (enhancementLevel >= 1) {
        // For high enhancement levels, use cost instead of market price (if enabled)
        if (useHighEnhancementCost && enhancementLevel >= minLevel) {
            // Calculate enhancement cost
            const cost = calculateEnhancementCost({
                itemHrid,
                targetLevel: enhancementLevel,
                enhancementParams,
                itemDetails,
                priceMap
            });

            if (cost !== null && cost > 0) {
                itemValue = cost;
            } else {
                // Fallback to base item price
                itemValue = priceMap[itemHrid + ':0'] || 0;
            }
        } else {
            // Normal logic: try market price first
            const marketPrice = priceMap[itemHrid + ':' + enhancementLevel] || 0;

            if (marketPrice > 0) {
                itemValue = marketPrice;
            } else {
                // No market data, calculate enhancement cost
                const cost = calculateEnhancementCost({
                    itemHrid,
                    targetLevel: enhancementLevel,
                    enhancementParams,
                    itemDetails,
                    priceMap
                });

                if (cost !== null && cost > 0) {
                    itemValue = cost;
                } else {
                    itemValue = priceMap[itemHrid + ':0'] || 0;
                }
            }
        }
    } else {
        // Unenhanced items: use market price
        itemValue = priceMap[itemHrid + ':0'] || 0;
    }

    return { itemIndex, value: itemValue * count };
}

/**
 * Calculate values for a batch of items
 * @param {Array} items - Array of item data objects
 * @returns {Array} Array of {itemIndex, value} results
 */
function calculateItemValueBatch(items) {
    const results = [];

    for (const itemData of items) {
        const result = calculateItemValue(itemData);
        results.push(result);
    }

    return results;
}

self.onmessage = function (e) {
    const { taskId, data } = e.data;
    try {
        const { action, params } = data;

        if (action === 'calculateBatch') {
            const results = calculateItemValueBatch(params.items);
            self.postMessage({ taskId, result: results });
        } else if (action === 'clearCache') {
            valuationCache.clear();
            self.postMessage({ taskId, result: { success: true, message: 'Cache cleared' } });
        } else {
            throw new Error(\`Unknown action: \${action}\`);
        }
    } catch (error) {
        self.postMessage({ taskId, error: error.message || String(error) });
    }
};
`;

/**
 * Get or create the worker pool instance
 */
async function getWorkerPool() {
    if (workerPool) {
        return workerPool;
    }

    try {
        // Create worker blob from inline script
        const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });

        // Initialize worker pool with 2-4 workers
        workerPool = new WorkerPool(blob);
        await workerPool.initialize();

        return workerPool;
    } catch (error) {
        throw error;
    }
}

/**
 * Calculate values for multiple items in parallel
 * @param {Array} items - Array of item objects
 * @param {Object} priceMap - Price map for all items
 * @param {Object} config - Configuration options
 * @param {Object} gameData - Game data with item details
 * @returns {Promise<Array>} Array of values in same order as input
 */
export async function calculateItemValueBatch(items, priceMap, configOptions, gameData) {
    const pool = await getWorkerPool();

    // Prepare data for workers - need to include item details
    const itemsWithDetails = items.map((item, index) => {
        const itemDetails = gameData.itemDetailMap[item.itemHrid];
        return {
            itemIndex: index,
            item,
            priceMap,
            useHighEnhancementCost: configOptions.useHighEnhancementCost,
            minLevel: configOptions.minLevel,
            enhancementParams: configOptions.enhancementParams,
            itemDetails: itemDetails || {},
        };
    });

    // Split items into chunks for parallel processing
    const chunkSize = Math.ceil(itemsWithDetails.length / pool.getStats().poolSize);
    const chunks = [];

    for (let i = 0; i < itemsWithDetails.length; i += chunkSize) {
        chunks.push(itemsWithDetails.slice(i, i + chunkSize));
    }

    // Process chunks in parallel
    const tasks = chunks.map((chunk) => ({
        action: 'calculateBatch',
        params: { items: chunk },
    }));

    const results = await pool.executeAll(tasks);

    // Flatten results and sort by itemIndex to maintain order
    const flatResults = results.flat();
    flatResults.sort((a, b) => a.itemIndex - b.itemIndex);

    // Extract just the values
    return flatResults.map((r) => r.value);
}

/**
 * Clear the worker cache
 */
export async function clearItemValueCache() {
    if (!workerPool) {
        return;
    }

    const pool = await getWorkerPool();
    return pool.execute({
        action: 'clearCache',
    });
}

/**
 * Get worker pool statistics
 */
export function getItemValueWorkerStats() {
    return workerPool ? workerPool.getStats() : null;
}

/**
 * Terminate the worker pool
 */
export function terminateItemValueWorkerPool() {
    if (workerPool) {
        workerPool.terminate();
        workerPool = null;
    }
}
