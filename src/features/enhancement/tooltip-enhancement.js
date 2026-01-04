/**
 * Enhancement Tooltip Module
 *
 * Provides enhancement analysis for item tooltips.
 * Calculates optimal enhancement path and total costs for reaching current enhancement level.
 *
 * This module is part of Phase 2 of Option D (Hybrid Approach):
 * - Enhancement panel: Shows 20-level enhancement table
 * - Item tooltips: Shows optimal path to reach current enhancement level
 */

import { calculateEnhancement, calculatePerActionTime } from '../../utils/enhancement-calculator.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { numberFormatter } from '../../utils/formatters.js';
import config from '../../core/config.js';

/**
 * Calculate optimal enhancement path for an item
 * Tests all protection strategies and finds the cheapest one
 *
 * @param {string} itemHrid - Item HRID (e.g., '/items/cheese_sword')
 * @param {number} currentEnhancementLevel - Current enhancement level (1-20)
 * @param {Object} config - Enhancement configuration from enhancement-config.js
 * @returns {Object|null} Enhancement analysis or null if not enhanceable
 */
export function calculateEnhancementPath(itemHrid, currentEnhancementLevel, config) {
    // Validate inputs
    if (!itemHrid || currentEnhancementLevel < 1 || currentEnhancementLevel > 20) {
        return null;
    }

    // Get item details
    const gameData = dataManager.getInitClientData();
    if (!gameData) return null;

    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails) return null;

    // Check if item is enhanceable
    if (!itemDetails.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
        return null;
    }

    // Get enhancement parameters from config
    const itemLevel = itemDetails.itemLevel || 1;

    // Test all protection strategies (2 through target level)
    const strategies = [];

    // Strategy 0: Never protect (benchmark)
    const neverProtect = testProtectionStrategy(
        currentEnhancementLevel,
        0, // protectFrom = 0 (never)
        itemHrid,
        itemLevel,
        config
    );
    if (neverProtect) {
        strategies.push({
            protectFrom: 0,
            label: 'Never',
            ...neverProtect
        });
    }

    // Strategies 2 through target level
    for (let protectFrom = 2; protectFrom <= currentEnhancementLevel; protectFrom++) {
        const result = testProtectionStrategy(
            currentEnhancementLevel,
            protectFrom,
            itemHrid,
            itemLevel,
            config
        );

        if (result) {
            strategies.push({
                protectFrom,
                label: `From +${protectFrom}`,
                ...result
            });
        }
    }

    // Find cheapest strategy
    if (strategies.length === 0) return null;

    strategies.sort((a, b) => a.totalCost - b.totalCost);

    // Apply Philosopher's Mirror optimization
    const mirrorOptimized = applyPhilosopherMirrorOptimization(
        strategies,
        itemHrid,
        currentEnhancementLevel,
        config
    );

    return {
        targetLevel: currentEnhancementLevel,
        itemLevel,
        optimalStrategy: mirrorOptimized.optimal,
        allStrategies: mirrorOptimized.strategies
    };
}

/**
 * Test a single protection strategy
 * @private
 */
function testProtectionStrategy(targetLevel, protectFrom, itemHrid, itemLevel, config) {
    try {
        const params = {
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel,
            protectFrom,
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus
        };

        // Calculate enhancement statistics
        const result = calculateEnhancement(params);

        // Validate result
        if (!result || typeof result.attempts !== 'number' || typeof result.totalTime !== 'number') {
            console.error('[Enhancement Tooltip] Invalid result from calculateEnhancement:', result);
            console.error('[Enhancement Tooltip] Input params were:', params);
            return null;
        }

        // Calculate costs (use full config object, not params)
        const costs = calculateTotalCost(itemHrid, targetLevel, protectFrom, config);

        return {
            expectedAttempts: result.attempts,  // Rename attempts to expectedAttempts for tooltip display
            totalTime: result.totalTime,
            ...costs
        };
    } catch (error) {
        console.error('[Enhancement Tooltip] Strategy calculation error:', error);
        return null;
    }
}

/**
 * Calculate total cost for enhancement path
 * Matches original MWI Tools v25.0 cost calculation
 * @private
 */
function calculateTotalCost(itemHrid, targetLevel, protectFrom, config) {
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];
    const itemLevel = itemDetails.itemLevel || 1;

    // Calculate total attempts for full path (0 to targetLevel)
    const pathResult = calculateEnhancement({
        enhancingLevel: config.enhancingLevel,
        houseLevel: config.houseLevel,
        toolBonus: config.toolBonus || 0,
        speedBonus: config.speedBonus || 0,
        itemLevel,
        targetLevel,
        protectFrom,
        blessedTea: config.teas.blessed,
        guzzlingBonus: config.guzzlingBonus
    });

    // Calculate per-action material cost (same for all enhancement levels)
    // enhancementCosts is a flat array of materials needed per attempt
    let perActionCost = 0;
    if (itemDetails.enhancementCosts) {
        for (const material of itemDetails.enhancementCosts) {
            const materialDetail = gameData.itemDetailMap[material.itemHrid];
            let price;

            // Special case: Trainee charms have fixed 250k price (untradeable)
            if (material.itemHrid.startsWith('/items/trainee_')) {
                price = 250000;
            } else if (material.itemHrid === '/items/coin') {
                price = 1; // Coins have face value of 1
            } else {
                const marketPrice = marketAPI.getPrice(material.itemHrid, 0);
                if (marketPrice) {
                    let ask = marketPrice.ask;
                    let bid = marketPrice.bid;

                    // Match MCS behavior: if one price is positive and other is negative, use positive for both
                    if (ask > 0 && bid < 0) {
                        bid = ask;
                    }
                    if (bid > 0 && ask < 0) {
                        ask = bid;
                    }

                    // MCS uses just ask for material prices
                    price = ask;
                } else {
                    // Fallback to sellPrice if no market data
                    price = materialDetail?.sellPrice || 0;
                }
            }
            perActionCost += price * material.count;
        }
    }

    // Total material cost = per-action cost × total attempts
    const materialCost = perActionCost * pathResult.attempts;

    // Protection cost = cheapest protection option × protection count
    let protectionCost = 0;
    let protectionItemHrid = null;
    let protectionCount = 0;
    if (protectFrom > 0 && pathResult.protectionCount > 0) {
        const protectionInfo = getCheapestProtectionPrice(itemHrid);
        if (protectionInfo.price > 0) {
            protectionCost = protectionInfo.price * pathResult.protectionCount;
            protectionItemHrid = protectionInfo.itemHrid;
            protectionCount = pathResult.protectionCount;
        }
    }

    // Base item cost (initial investment) using realistic pricing
    const baseCost = getRealisticBaseItemPrice(itemHrid);

    return {
        baseCost,
        materialCost,
        protectionCost,
        protectionItemHrid,
        protectionCount,
        totalCost: baseCost + materialCost + protectionCost
    };
}

/**
 * Get realistic base item price with production cost fallback
 * Matches original MWI Tools v25.0 getRealisticBaseItemPrice logic
 * @private
 */
function getRealisticBaseItemPrice(itemHrid) {
    const marketPrice = marketAPI.getPrice(itemHrid, 0);
    const ask = marketPrice?.ask > 0 ? marketPrice.ask : 0;
    const bid = marketPrice?.bid > 0 ? marketPrice.bid : 0;

    // Calculate production cost as fallback
    const productionCost = getProductionCost(itemHrid);

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

    // No market data - use production cost as fallback
    return productionCost;
}

/**
 * Calculate production cost from crafting recipe
 * Matches original MWI Tools v25.0 getBaseItemProductionCost logic
 * @private
 */
function getProductionCost(itemHrid) {
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];

    if (!itemDetails || !itemDetails.name) {
        return 0;
    }

    // Find the action that produces this item
    let actionHrid = null;
    for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (action.outputItems && action.outputItems.length > 0) {
            const output = action.outputItems[0];
            if (output.itemHrid === itemHrid) {
                actionHrid = hrid;
                break;
            }
        }
    }

    if (!actionHrid) {
        return 0;
    }

    const action = gameData.actionDetailMap[actionHrid];
    let totalPrice = 0;

    // Sum up input material costs
    if (action.inputItems) {
        for (const input of action.inputItems) {
            const inputPrice = marketAPI.getPrice(input.itemHrid, 0);
            const price = inputPrice?.ask > 0 ? inputPrice.ask : 0;
            totalPrice += price * input.count;
        }
    }

    // Apply Artisan Tea reduction (0.9x)
    totalPrice *= 0.9;

    // Add upgrade item cost if this is an upgrade recipe (for refined items)
    if (action.upgradeItemHrid) {
        const upgradePrice = marketAPI.getPrice(action.upgradeItemHrid, 0);
        const price = upgradePrice?.ask > 0 ? upgradePrice.ask : 0;
        totalPrice += price;
    }

    return totalPrice;
}

/**
 * Get cheapest protection item price
 * Tests: item itself, mirror of protection, and specific protection items
 * @private
 */
function getCheapestProtectionPrice(itemHrid) {
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];

    // Build list of protection options: [item itself, mirror, ...specific items]
    const protectionOptions = [
        itemHrid,
        '/items/mirror_of_protection'
    ];

    // Add specific protection items if they exist
    if (itemDetails.protectionItemHrids && itemDetails.protectionItemHrids.length > 0) {
        // protectionItemHrids is an array of arrays (one per level)
        // Flatten and deduplicate
        const allProtectionHrids = new Set();
        for (const levelProtections of itemDetails.protectionItemHrids) {
            if (Array.isArray(levelProtections)) {
                for (const hrid of levelProtections) {
                    allProtectionHrids.add(hrid);
                }
            }
        }
        protectionOptions.push(...Array.from(allProtectionHrids));
    }

    // Find cheapest option
    let cheapestPrice = Infinity;
    let cheapestItemHrid = null;
    for (const protectionHrid of protectionOptions) {
        const price = getRealisticBaseItemPrice(protectionHrid);
        if (price > 0 && price < cheapestPrice) {
            cheapestPrice = price;
            cheapestItemHrid = protectionHrid;
        }
    }

    return {
        price: cheapestPrice === Infinity ? 0 : cheapestPrice,
        itemHrid: cheapestItemHrid
    };
}

/**
 * Build array of costs to reach each enhancement level
 * Uses multiple calculator runs to get accurate per-level costs
 *
 * @param {Object} strategy - Enhancement strategy with protectFrom
 * @param {string} itemHrid - Item HRID
 * @param {number} targetLevel - Target enhancement level
 * @param {Object} config - Enhancement config parameters
 * @returns {Array} Cost to reach each level [0, 1, 2, ..., targetLevel]
 */
function buildLevelCostsArray(strategy, itemHrid, targetLevel, config) {
    const costs = new Array(targetLevel + 1);
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];
    const itemLevel = itemDetails.itemLevel || 1;

    // Level 0: base item cost
    costs[0] = getRealisticBaseItemPrice(itemHrid);

    // Calculate per-action material cost (same for all levels)
    let perActionMaterialCost = 0;
    if (itemDetails.enhancementCosts) {
        for (const material of itemDetails.enhancementCosts) {
            const materialDetail = gameData.itemDetailMap[material.itemHrid];
            let price;

            // Special case: Trainee charms have fixed 250k price
            if (material.itemHrid.startsWith('/items/trainee_')) {
                price = 250000;
            } else if (material.itemHrid === '/items/coin') {
                price = 1;
            } else {
                const marketPrice = marketAPI.getPrice(material.itemHrid, 0);
                if (marketPrice) {
                    let ask = marketPrice.ask;
                    let bid = marketPrice.bid;
                    if (ask > 0 && bid < 0) bid = ask;
                    if (bid > 0 && ask < 0) ask = bid;
                    price = ask;
                } else {
                    price = materialDetail?.sellPrice || 0;
                }
            }
            perActionMaterialCost += price * material.count;
        }
    }

    // Get protection price once (reused for all levels)
    const protectionInfo = getCheapestProtectionPrice(itemHrid);
    const protectionPrice = protectionInfo.price;

    // Levels 1 through targetLevel: run calculator for each
    for (let level = 1; level <= targetLevel; level++) {
        const result = calculateEnhancement({
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel: level,
            protectFrom: Math.min(strategy.protectFrom, level),
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus
        });

        // Calculate cost to reach this level
        const materialCost = perActionMaterialCost * result.attempts;

        let protectionCost = 0;
        if (strategy.protectFrom > 0 && result.protectionCount > 0) {
            protectionCost = protectionPrice * result.protectionCount;
        }

        costs[level] = costs[0] + materialCost + protectionCost;
    }

    return costs;
}

/**
 * Build breakdown array for each enhancement level
 * Similar to buildLevelCostsArray but tracks component costs separately
 * @private
 */
function buildLevelBreakdownsArray(strategy, itemHrid, targetLevel, config) {
    const breakdowns = new Array(targetLevel + 1);
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];
    const itemLevel = itemDetails.itemLevel || 1;

    // Level 0: just base item
    const baseItemCost = getRealisticBaseItemPrice(itemHrid);
    breakdowns[0] = {
        baseCost: baseItemCost,
        materialCost: 0,
        protectionCost: 0,
        consumedItemsCost: 0,
        philosopherMirrorCost: 0,
        totalCost: baseItemCost
    };

    // Calculate per-action material cost (same for all levels)
    let perActionMaterialCost = 0;
    if (itemDetails.enhancementCosts) {
        for (const material of itemDetails.enhancementCosts) {
            const materialDetail = gameData.itemDetailMap[material.itemHrid];
            let price;

            // Special case: Trainee charms have fixed 250k price
            if (material.itemHrid.startsWith('/items/trainee_')) {
                price = 250000;
            } else if (material.itemHrid === '/items/coin') {
                price = 1;
            } else {
                const marketPrice = marketAPI.getPrice(material.itemHrid, 0);
                if (marketPrice) {
                    let ask = marketPrice.ask;
                    let bid = marketPrice.bid;
                    if (ask > 0 && bid < 0) bid = ask;
                    if (bid > 0 && ask < 0) ask = bid;
                    price = ask;
                } else {
                    price = materialDetail?.sellPrice || 0;
                }
            }
            perActionMaterialCost += price * material.count;
        }
    }

    // Get protection price once (reused for all levels)
    const protectionInfo = getCheapestProtectionPrice(itemHrid);
    const protectionPrice = protectionInfo.price;

    // Levels 1 through targetLevel: run calculator for each
    for (let level = 1; level <= targetLevel; level++) {
        const result = calculateEnhancement({
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel: level,
            protectFrom: Math.min(strategy.protectFrom, level),
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus
        });

        // Calculate costs for this level
        const materialCost = perActionMaterialCost * result.attempts;

        let protectionCost = 0;
        if (strategy.protectFrom > 0 && result.protectionCount > 0) {
            protectionCost = protectionPrice * result.protectionCount;
        }

        breakdowns[level] = {
            baseCost: baseItemCost,
            materialCost: materialCost,
            protectionCost: protectionCost,
            consumedItemsCost: 0,
            philosopherMirrorCost: 0,
            totalCost: baseItemCost + materialCost + protectionCost
        };
    }

    return breakdowns;
}

/**
 * Fibonacci calculation for item quantities (from Enhancelator)
 * @private
 */
function fib(n) {
    if (n === 0 || n === 1) {
        return 1;
    }
    return fib(n - 1) + fib(n - 2);
}

/**
 * Mirror Fibonacci calculation for mirror quantities (from Enhancelator)
 * @private
 */
function mirrorFib(n) {
    if (n === 0) {
        return 1;
    }
    if (n === 1) {
        return 2;
    }
    return mirrorFib(n - 1) + mirrorFib(n - 2) + 1;
}

/**
 * Apply Philosopher's Mirror optimization to enhancement strategies
 *
 * Algorithm (matches Enhancelator):
 * 1. Build cost array for each level (0 through target)
 * 2. Find FIRST level where mirror becomes cheaper than traditional
 * 3. Apply mirror cost formula to that level and all subsequent levels
 *
 * Mirror Cost Formula: Cost(N) = Cost(N-2) + Cost(N-1) + Mirror_Price
 *
 * @param {Array} strategies - Traditional enhancement strategies
 * @param {string} itemHrid - Item HRID
 * @param {number} targetLevel - Target enhancement level
 * @param {Object} config - Enhancement config parameters
 * @returns {Object} { optimal, strategies } with mirror optimization applied
 */
function applyPhilosopherMirrorOptimization(strategies, itemHrid, targetLevel, config) {
    // Get Philosopher's Mirror price
    const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
    if (mirrorPrice <= 0) {
        // Mirror not available - return original strategies
        return {
            optimal: strategies[0],
            strategies: strategies
        };
    }

    // Optimize each strategy
    const optimizedStrategies = strategies.map(strategy => {
        // Build cost array: cost to reach each level using this strategy
        const levelCosts = buildLevelCostsArray(strategy, itemHrid, targetLevel, config);

        // Build breakdown array: component costs for each level
        const levelBreakdowns = buildLevelBreakdownsArray(strategy, itemHrid, targetLevel, config);

        // Find first level where mirror becomes beneficial (starts at +3)
        let mirrorStartLevel = null;
        for (let level = 3; level <= targetLevel; level++) {
            const traditionalCost = levelCosts[level];
            const mirrorCost = levelCosts[level - 2] + levelCosts[level - 1] + mirrorPrice;

            if (mirrorCost < traditionalCost) {
                mirrorStartLevel = level;
                break; // Found threshold - all subsequent levels will use mirrors
            }
        }

        // If mirror is beneficial, apply it from threshold level onward
        if (mirrorStartLevel !== null) {
            // Apply mirror optimization to costs
            for (let level = mirrorStartLevel; level <= targetLevel; level++) {
                levelCosts[level] = levelCosts[level - 2] + levelCosts[level - 1] + mirrorPrice;
            }

            // Apply mirror optimization to breakdowns
            for (let level = mirrorStartLevel; level <= targetLevel; level++) {
                const breakdown_N_minus_2 = levelBreakdowns[level - 2];
                const breakdown_N_minus_1 = levelBreakdowns[level - 1];

                // For mirror-optimized levels:
                // - Base cost: same as main item (only 1 base for main)
                // - Materials: same as traditional phase (main item only)
                // - Protection: same as traditional phase (main item only)
                // - Consumed items: total cost of (N-1) item WITHOUT its mirrors (to avoid double-counting)
                // - Philosopher's Mirror: accumulate ALL mirrors (including those in consumed items)

                levelBreakdowns[level] = {
                    baseCost: levelBreakdowns[0].baseCost, // Just main item's base
                    materialCost: levelBreakdowns[mirrorStartLevel - 1].materialCost, // Traditional phase only
                    protectionCost: levelBreakdowns[mirrorStartLevel - 1].protectionCost, // Traditional phase only
                    consumedItemsCost: breakdown_N_minus_1.totalCost - breakdown_N_minus_1.philosopherMirrorCost, // Exclude mirrors to avoid double-count
                    philosopherMirrorCost: breakdown_N_minus_2.philosopherMirrorCost + breakdown_N_minus_1.philosopherMirrorCost + mirrorPrice,
                    totalCost: levelCosts[level]
                };
            }

            // Calculate consumed item quantities using Fibonacci (Enhancelator approach)
            const n = targetLevel - mirrorStartLevel;
            const numLowerTier = fib(n);           // Quantity of (mirrorStartLevel - 2) items
            const numUpperTier = fib(n + 1) - 1;   // Quantity of (mirrorStartLevel - 1) items (minus 1 for main item)
            const numMirrors = mirrorFib(n);       // Quantity of Philosopher's Mirrors

            const lowerTierLevel = mirrorStartLevel - 2;
            const upperTierLevel = mirrorStartLevel - 1;

            // Get cost of one item at each level
            const costLowerTier = levelBreakdowns[lowerTierLevel].totalCost;
            const costUpperTier = levelBreakdowns[upperTierLevel].totalCost;

            // Calculate total costs
            const totalLowerTierCost = numLowerTier * costLowerTier;
            const totalUpperTierCost = numUpperTier * costUpperTier;
            const totalMirrorsCost = numMirrors * mirrorPrice;

            // Build consumed items array for display (only two levels)
            const consumedItems = [
                {
                    level: lowerTierLevel,
                    quantity: numLowerTier,
                    costEach: costLowerTier,
                    totalCost: totalLowerTierCost
                },
                {
                    level: upperTierLevel,
                    quantity: numUpperTier,
                    costEach: costUpperTier,
                    totalCost: totalUpperTierCost
                }
            ];

            // Get final breakdown for target level
            const finalBreakdown = levelBreakdowns[targetLevel];

            return {
                ...strategy,
                baseCost: finalBreakdown.baseCost,
                materialCost: finalBreakdown.materialCost,
                protectionCost: finalBreakdown.protectionCost,
                consumedItemsCost: totalLowerTierCost + totalUpperTierCost,
                philosopherMirrorCost: totalMirrorsCost,
                totalCost: finalBreakdown.totalCost,
                mirrorStartLevel: mirrorStartLevel,
                usedMirror: true,
                traditionalCost: strategy.totalCost,
                consumedItems: consumedItems, // Array of {level, quantity, costEach, totalCost}
                mirrorCount: numMirrors
            };
        }

        // Mirror not beneficial for this strategy
        return {
            ...strategy,
            mirrorStartLevel: null,
            usedMirror: false
        };
    });

    // Re-sort by optimized cost
    optimizedStrategies.sort((a, b) => a.totalCost - b.totalCost);

    return {
        optimal: optimizedStrategies[0],
        strategies: optimizedStrategies
    };
}

/**
 * Build HTML for enhancement tooltip section
 * @param {Object} enhancementData - Enhancement analysis from calculateEnhancementPath()
 * @returns {string} HTML string
 */
export function buildEnhancementTooltipHTML(enhancementData) {
    if (!enhancementData || !enhancementData.optimalStrategy) {
        return '';
    }

    const { targetLevel, optimalStrategy } = enhancementData;

    // Validate required fields
    if (typeof optimalStrategy.expectedAttempts !== 'number' ||
        typeof optimalStrategy.totalTime !== 'number' ||
        typeof optimalStrategy.materialCost !== 'number' ||
        typeof optimalStrategy.totalCost !== 'number') {
        console.error('[Enhancement Tooltip] Missing required fields in optimal strategy:', optimalStrategy);
        return '';
    }

    let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin-top: 8px; padding-top: 8px;">';
    html += '<div style="font-weight: bold; margin-bottom: 4px;">ENHANCEMENT PATH (+0 → +' + targetLevel + ')</div>';
    html += '<div style="font-size: 0.9em; margin-left: 8px;">';

    // Optimal strategy
    html += '<div>Strategy: ' + optimalStrategy.label + '</div>';

    // Show Philosopher's Mirror usage if applicable
    if (optimalStrategy.usedMirror && optimalStrategy.mirrorStartLevel) {
        html += '<div style="color: #ffd700;">Uses Philosopher\'s Mirror from +' + optimalStrategy.mirrorStartLevel + '</div>';
    }

    html += '<div>Expected Attempts: ' + numberFormatter(optimalStrategy.expectedAttempts.toFixed(1)) + '</div>';

    // Costs
    html += '<div>';

    // Check if using mirror optimization
    if (optimalStrategy.usedMirror && optimalStrategy.consumedItems && optimalStrategy.consumedItems.length > 0) {
        // Mirror-optimized breakdown
        html += 'Base Item: ' + numberFormatter(optimalStrategy.baseCost);
        html += '<br>Materials: ' + numberFormatter(optimalStrategy.materialCost);

        if (optimalStrategy.protectionCost > 0) {
            let protectionDisplay = numberFormatter(optimalStrategy.protectionCost);

            // Show protection count and item name if available
            if (optimalStrategy.protectionCount > 0) {
                protectionDisplay += ' (' + optimalStrategy.protectionCount.toFixed(1) + '×';

                if (optimalStrategy.protectionItemHrid) {
                    const gameData = dataManager.getInitClientData();
                    const itemDetails = gameData?.itemDetailMap[optimalStrategy.protectionItemHrid];
                    if (itemDetails?.name) {
                        protectionDisplay += ' ' + itemDetails.name;
                    }
                }

                protectionDisplay += ')';
            }

            html += '<br>Protection: ' + protectionDisplay;
        }
        // Consumed items section (Fibonacci-based quantities)
        html += '<br>Consumed Items (Philosopher\'s Mirror):';
        html += '<div style="margin-left: 12px;">';

        // Show consumed items in descending order (higher level first)
        const sortedConsumed = [...optimalStrategy.consumedItems].sort((a, b) => b.level - a.level);
        sortedConsumed.forEach((item, index) => {
            if (index > 0) html += '<br>'; // Add line break before items after the first
            html += '+' + item.level + ': ' + item.quantity + ' × ' + numberFormatter(item.costEach) + ' = ' + numberFormatter(item.totalCost);
        });

        html += '</div>';
        // Philosopher's Mirror cost
        if (optimalStrategy.philosopherMirrorCost > 0) {
            const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
            html += 'Philosopher\'s Mirror: ' + numberFormatter(optimalStrategy.philosopherMirrorCost);
            if (optimalStrategy.mirrorCount > 0 && mirrorPrice > 0) {
                html += ' (' + optimalStrategy.mirrorCount + 'x @ ' + numberFormatter(mirrorPrice) + ' each)';
            }
        }

        html += '<br><span style="font-weight: bold;">Total: ' + numberFormatter(optimalStrategy.totalCost) + '</span>';
    } else {
        // Traditional (non-mirror) breakdown
        html += 'Base Item: ' + numberFormatter(optimalStrategy.baseCost);
        html += '<br>Materials: ' + numberFormatter(optimalStrategy.materialCost);

        if (optimalStrategy.protectionCost > 0) {
            let protectionDisplay = numberFormatter(optimalStrategy.protectionCost);

            // Show protection count and item name if available
            if (optimalStrategy.protectionCount > 0) {
                protectionDisplay += ' (' + optimalStrategy.protectionCount.toFixed(1) + '×';

                if (optimalStrategy.protectionItemHrid) {
                    const gameData = dataManager.getInitClientData();
                    const itemDetails = gameData?.itemDetailMap[optimalStrategy.protectionItemHrid];
                    if (itemDetails?.name) {
                        protectionDisplay += ' ' + itemDetails.name;
                    }
                }

                protectionDisplay += ')';
            }

            html += '<br>Protection: ' + protectionDisplay;
        }

        html += '<br><span style="font-weight: bold;">Total: ' + numberFormatter(optimalStrategy.totalCost) + '</span>';
    }

    html += '</div>';

    // Time estimate
    const totalSeconds = optimalStrategy.totalTime;

    if (totalSeconds < 60) {
        // Less than 1 minute: show seconds
        html += '<div>Time: ~' + Math.round(totalSeconds) + ' seconds</div>';
    } else if (totalSeconds < 3600) {
        // Less than 1 hour: show minutes
        const minutes = Math.round(totalSeconds / 60);
        html += '<div>Time: ~' + minutes + ' minutes</div>';
    } else if (totalSeconds < 86400) {
        // Less than 1 day: show hours
        const hours = (totalSeconds / 3600).toFixed(1);
        html += '<div>Time: ~' + hours + ' hours</div>';
    } else {
        // 1 day or more: show days
        const days = (totalSeconds / 86400).toFixed(1);
        html += '<div>Time: ~' + days + ' days</div>';
    }

    html += '</div>'; // Close margin-left div
    html += '</div>'; // Close main container

    return html;
}
