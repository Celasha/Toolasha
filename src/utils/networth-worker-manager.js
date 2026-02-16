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
 * Calculate production cost from crafting/upgrading recipe
 * @param {string} itemHrid - Item HRID
 * @param {Object} priceMap - Price map
 * @param {Object} actionDetailMap - Action detail map from game data
 * @returns {number} Production cost
 */
function calculateProductionCost(itemHrid, priceMap, actionDetailMap) {
    // Find the action that produces this item
    let action = null;
    for (const actionHrid in actionDetailMap) {
        const actionData = actionDetailMap[actionHrid];
        if (actionData.outputItems && actionData.outputItems.length > 0) {
            if (actionData.outputItems[0].itemHrid === itemHrid) {
                action = actionData;
                break;
            }
        }
    }

    if (!action) {
        return 0;
    }

    let totalPrice = 0;

    // Sum up input material costs
    if (action.inputItems) {
        for (const input of action.inputItems) {
            // Match main thread: getItemPrice(input.itemHrid, { mode: 'ask' }) || 0
            let inputPrice = priceMap[input.itemHrid + ':0_ask'];
            if (inputPrice === undefined) inputPrice = priceMap[input.itemHrid + ':0'];
            if (inputPrice === null || inputPrice === undefined) inputPrice = 0;

            // Recursively calculate production cost if no market price (matches main thread)
            if (inputPrice === 0) {
                inputPrice = calculateProductionCost(input.itemHrid, priceMap, actionDetailMap);
            }

            totalPrice += inputPrice * input.count;
        }
    }

    // Apply Artisan Tea reduction (0.9x)
    totalPrice *= 0.9;

    // Add upgrade item cost if this is an upgrade recipe (for refined items)
    if (action.upgradeItemHrid) {
        // Match main thread: getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0
        let upgradePrice = priceMap[action.upgradeItemHrid + ':0_ask'];
        if (upgradePrice === undefined) upgradePrice = priceMap[action.upgradeItemHrid + ':0'];
        if (upgradePrice === null || upgradePrice === undefined) upgradePrice = 0;

        // Recursively calculate production cost if no market price (matches main thread)
        if (upgradePrice === 0) {
            upgradePrice = calculateProductionCost(action.upgradeItemHrid, priceMap, actionDetailMap);
        }

        totalPrice += upgradePrice;
    }

    return totalPrice;
}

/**
 * Calculate enhancement path cost using proper strategy optimization
 * @param {Object} params - Enhancement calculation parameters
 * @returns {number} Total cost
 */
function calculateEnhancementCost(params) {
    const { itemHrid, targetLevel, enhancementParams, itemDetails, priceMap, actionDetailMap } = params;

    if (!itemDetails.enhancementCosts || targetLevel < 1 || targetLevel > 20) {
        return null;
    }

    const itemLevel = itemDetails.itemLevel || 1;

    // Get base item cost using realistic pricing (matches main thread logic)
    const basePrice = getRealisticPrice(itemHrid, null, priceMap, actionDetailMap);

    // Build cost array for each level by testing all protection strategies
    const targetCosts = new Array(targetLevel + 1);
    targetCosts[0] = basePrice;

    for (let level = 1; level <= targetLevel; level++) {
        // Calculate per-attempt material cost (sum of ALL materials)
        let perAttemptMaterialCost = 0;
        if (itemDetails.enhancementCosts && itemDetails.enhancementCosts.length > 0) {
            for (const material of itemDetails.enhancementCosts) {
                let materialPrice = 0;

                // Special cases
                if (material.itemHrid.startsWith('/items/trainee_')) {
                    materialPrice = 250000; // Trainee charms are untradeable, fixed price
                } else if (material.itemHrid === '/items/coin') {
                    materialPrice = 1; // Coins have face value of 1
                } else {
                    // Get material details for sellPrice fallback
                    const materialDetail = itemDetails.enhancementCosts ?
                        (itemDetails.allItemDetails && itemDetails.allItemDetails[material.itemHrid]) : null;

                    // Try to get market price from priceMap
                    const hasMarketData = (material.itemHrid + ':0_ask') in priceMap || (material.itemHrid + ':0') in priceMap;

                    if (hasMarketData) {
                        let ask = priceMap[material.itemHrid + ':0_ask'];
                        if (ask === undefined) ask = priceMap[material.itemHrid + ':0'];
                        let bid = priceMap[material.itemHrid + ':0_bid'];

                        // Match MCS behavior: if one price is positive and other is negative, use positive for both
                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        // MCS uses just ask for material prices (matches main thread)
                        materialPrice = ask || 0;
                    } else {
                        // Fallback to sellPrice if no market data (matches main thread)
                        materialPrice = materialDetail?.sellPrice || 0;
                    }
                }

                perAttemptMaterialCost += materialPrice * material.count;
            }
        }

        // Test no protection (protectFrom = 0)
        let minCost = Infinity;
        const noProtResult = calculateStrategyRealCost(
            enhancementParams,
            itemLevel,
            level,
            0,
            perAttemptMaterialCost,
            basePrice,
            priceMap,
            itemDetails,
            itemHrid,
            actionDetailMap
        );
        if (noProtResult < minCost) {
            minCost = noProtResult;
        }

        // Test protection from level 2 to current level
        for (let protectFrom = 2; protectFrom <= level; protectFrom++) {
            const protResult = calculateStrategyRealCost(
                enhancementParams,
                itemLevel,
                level,
                protectFrom,
                perAttemptMaterialCost,
                basePrice,
                priceMap,
                itemDetails,
                itemHrid,
                actionDetailMap
            );
            if (protResult < minCost) {
                minCost = protResult;
            }
        }

        targetCosts[level] = minCost;
    }

    // Apply Philosopher's Mirror optimization
    let mirrorPrice = priceMap['/items/philosophers_mirror:0'] || 0;
    if (mirrorPrice === 0) {
        mirrorPrice = calculateProductionCost('/items/philosophers_mirror', priceMap, actionDetailMap);
    }

    if (mirrorPrice > 0) {
        for (let level = 3; level <= targetLevel; level++) {
            const traditionalCost = targetCosts[level];
            const mirrorCost = targetCosts[level - 2] + targetCosts[level - 1] + mirrorPrice;
            if (mirrorCost < traditionalCost) {
                targetCosts[level] = mirrorCost;
            }
        }
    }

    return targetCosts[targetLevel];
}

/**
 * Calculate real cost for a specific protection strategy
 * Now includes support for Blessed Tea
 */
function calculateStrategyRealCost(
    enhancementParams,
    itemLevel,
    targetLevel,
    protectFrom,
    perAttemptMaterialCost,
    baseItemPrice,
    priceMap,
    itemDetails,
    itemHrid,
    actionDetailMap
) {
    const { enhancingLevel, toolBonus, blessedTea = false, guzzlingBonus = 1.0 } = enhancementParams;

    // Calculate success multiplier
    let totalBonus;
    if (enhancingLevel >= itemLevel) {
        const levelAdvantage = 0.05 * (enhancingLevel - itemLevel);
        totalBonus = 1 + (toolBonus + levelAdvantage) / 100;
    } else {
        totalBonus = 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;
    }

    // Build Markov chain with Blessed Tea support
    const markov = math.zeros(20, 20);

    for (let i = 0; i < targetLevel; i++) {
        const baseSuccessRate = BASE_SUCCESS_RATES[i] / 100.0;
        const successChance = baseSuccessRate * totalBonus;
        const failureDestination = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

        if (blessedTea) {
            // Blessed Tea: 1% base chance to jump +2, scaled by guzzling bonus
            const skipChance = successChance * 0.01 * guzzlingBonus;
            const remainingSuccess = successChance * (1 - 0.01 * guzzlingBonus);

            if (i + 2 <= targetLevel) {
                markov.set([i, i + 2], skipChance);
            }
            markov.set([i, i + 1], remainingSuccess);
            markov.set([i, failureDestination], 1 - successChance);
        } else {
            markov.set([i, i + 1], successChance);
            markov.set([i, failureDestination], 1.0 - successChance);
        }
    }

    markov.set([targetLevel, targetLevel], 1.0);

    // Solve for expected attempts and protections
    const Q = markov.subset(math.index(math.range(0, targetLevel), math.range(0, targetLevel)));
    const I = math.identity(targetLevel);
    const M = math.inv(math.subtract(I, Q));

    let attempts = 0;
    for (let i = 0; i < targetLevel; i++) {
        attempts += M.get([0, i]);
    }

    // Calculate expected protection uses
    let protections = 0;
    if (protectFrom > 0 && protectFrom < targetLevel) {
        for (let i = protectFrom; i < targetLevel; i++) {
            const timesAtLevel = M.get([0, i]);
            const failureChance = markov.get([i, i - 1]);
            protections += timesAtLevel * failureChance;
        }
    }

    // Get protection item price using realistic pricing (like main thread)
    let protectionPrice = 0;
    if (protections > 0) {
        protectionPrice = getRealisticPrice(itemHrid, baseItemPrice, priceMap, actionDetailMap);

        // Check mirror of protection
        const mirrorPrice = getRealisticPrice('/items/mirror_of_protection', null, priceMap, actionDetailMap);
        if (mirrorPrice > 0 && mirrorPrice < protectionPrice) {
            protectionPrice = mirrorPrice;
        }

        // Check specific protection items
        if (itemDetails.protectionItemHrids && itemDetails.protectionItemHrids.length > 0) {
            for (const protHrid of itemDetails.protectionItemHrids) {
                const protPrice = getRealisticPrice(protHrid, null, priceMap, actionDetailMap);
                if (protPrice > 0 && protPrice < protectionPrice) {
                    protectionPrice = protPrice;
                }
            }
        }
    }

    const materialCost = perAttemptMaterialCost * attempts;
    const protectionCost = protectionPrice * protections;

    return baseItemPrice + materialCost + protectionCost;
}

/**
 * Get realistic price for an item (matches main thread logic)
 * Handles inflation detection and fallbacks
 */
function getRealisticPrice(itemHrid, knownBasePrice, priceMap, actionDetailMap) {
    let ask = priceMap[itemHrid + ':0_ask'];
    if (ask === undefined) ask = priceMap[itemHrid + ':0'];
    if (ask === null || ask === undefined) ask = 0;

    let bid = priceMap[itemHrid + ':0_bid'];
    if (bid === null || bid === undefined) bid = 0;

    // Calculate production cost as fallback
    const productionCost = calculateProductionCost(itemHrid, priceMap, actionDetailMap);

    // If both ask and bid exist
    if (ask > 0 && bid > 0) {
        // If ask is significantly higher than bid (>30% markup), use max(bid, production)
        if (ask / bid > 1.3) {
            return Math.max(bid, productionCost);
        }
        // Otherwise use ask (normal market)
        return ask;
    }

    // If only ask exists
    if (ask > 0) {
        // If ask is inflated compared to production, use production
        if (productionCost > 0 && ask / productionCost > 1.3) {
            return productionCost;
        }
        // Otherwise use max of ask and production
        return Math.max(ask, productionCost);
    }

    // If only bid exists, use max(bid, production)
    if (bid > 0) {
        return Math.max(bid, productionCost);
    }

    // No market data - use production cost or known base price
    return productionCost > 0 ? productionCost : (knownBasePrice || 0);
}

/**
 * Calculate value for a single item
 * @param {Object} data - Item data
 * @returns {Object} {itemIndex, value}
 */
function calculateItemValue(data) {
    const { itemIndex, item, priceMap, useHighEnhancementCost, minLevel, enhancementParams, itemDetails, actionDetailMap } = data;
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
                priceMap,
                actionDetailMap
            });

            if (cost !== null && cost > 0) {
                itemValue = cost;
            } else {
                // Fallback to base item price or production cost
                let basePrice = priceMap[itemHrid + ':0'] || 0;
                if (basePrice === 0) {
                    basePrice = calculateProductionCost(itemHrid, priceMap, actionDetailMap);
                }
                itemValue = basePrice;
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
                    priceMap,
                    actionDetailMap
                });

                if (cost !== null && cost > 0) {
                    itemValue = cost;
                } else {
                    let basePrice = priceMap[itemHrid + ':0'] || 0;
                    if (basePrice === 0) {
                        basePrice = calculateProductionCost(itemHrid, priceMap, actionDetailMap);
                    }
                    itemValue = basePrice;
                }
            }
        }
    } else {
        // Unenhanced items: use market price or production cost
        itemValue = priceMap[itemHrid + ':0'] || 0;
        if (itemValue === 0) {
            itemValue = calculateProductionCost(itemHrid, priceMap, actionDetailMap);
        }
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

    // Prepare data for workers - need to include item details, material details, and actionDetailMap
    const itemsWithDetails = items.map((item, index) => {
        const itemDetails = gameData.itemDetailMap[item.itemHrid];

        // Include material item details for sellPrice fallback
        const allItemDetails = {};
        if (itemDetails && itemDetails.enhancementCosts) {
            for (const material of itemDetails.enhancementCosts) {
                const materialDetail = gameData.itemDetailMap[material.itemHrid];
                if (materialDetail) {
                    allItemDetails[material.itemHrid] = {
                        sellPrice: materialDetail.sellPrice,
                        name: materialDetail.name,
                    };
                }
            }
        }

        return {
            itemIndex: index,
            item,
            priceMap,
            useHighEnhancementCost: configOptions.useHighEnhancementCost,
            minLevel: configOptions.minLevel,
            enhancementParams: configOptions.enhancementParams,
            itemDetails: itemDetails ? { ...itemDetails, allItemDetails } : {},
            actionDetailMap: gameData.actionDetailMap,
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
