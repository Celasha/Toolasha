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
import { getItemPrice, getItemPrices } from '../../utils/market-data.js';

/**
 * Calculate optimal enhancement path for an item
 * Matches Enhancelator's algorithm exactly:
 * 1. Test all protection strategies for each level
 * 2. Pick minimum cost for each level (mixed strategies)
 * 3. Apply mirror optimization to mixed array
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

    const itemLevel = itemDetails.itemLevel || 1;

    // Step 1: Build 2D matrix like Enhancelator (all_results)
    // For each target level (1 to currentEnhancementLevel)
    // Test all protection strategies (0, 2, 3, ..., targetLevel)
    // Result: allResults[targetLevel][protectFrom] = cost data

    const allResults = [];

    for (let targetLevel = 1; targetLevel <= currentEnhancementLevel; targetLevel++) {
        const resultsForLevel = [];

        // Test "never protect" (0)
        const neverProtect = calculateCostForStrategy(itemHrid, targetLevel, 0, itemLevel, config);
        if (neverProtect) {
            resultsForLevel.push({ protectFrom: 0, ...neverProtect });
        }

        // Test all "protect from X" strategies (2 through targetLevel)
        for (let protectFrom = 2; protectFrom <= targetLevel; protectFrom++) {
            const result = calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config);
            if (result) {
                resultsForLevel.push({ protectFrom, ...result });
            }
        }

        allResults.push(resultsForLevel);
    }

    // Step 2: Build target_costs array (minimum cost for each level)
    // Like Enhancelator line 451-453
    const targetCosts = new Array(currentEnhancementLevel + 1);
    targetCosts[0] = getRealisticBaseItemPrice(itemHrid); // Level 0: base item

    for (let level = 1; level <= currentEnhancementLevel; level++) {
        const resultsForLevel = allResults[level - 1];
        const minCost = Math.min(...resultsForLevel.map(r => r.totalCost));
        targetCosts[level] = minCost;
    }

    // Step 3: Apply Philosopher's Mirror optimization (single pass, in-place)
    // Like Enhancelator lines 456-465
    const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
    let mirrorStartLevel = null;

    if (mirrorPrice > 0) {
        for (let level = 3; level <= currentEnhancementLevel; level++) {
            const traditionalCost = targetCosts[level];
            const mirrorCost = targetCosts[level - 2] + targetCosts[level - 1] + mirrorPrice;

            if (mirrorCost < traditionalCost) {
                if (mirrorStartLevel === null) {
                    mirrorStartLevel = level;
                }
                targetCosts[level] = mirrorCost;
            }
        }
    }

    // Step 4: Build final result with breakdown
    const finalCost = targetCosts[currentEnhancementLevel];

    // Find which protection strategy was optimal for final level (before mirrors)
    const finalLevelResults = allResults[currentEnhancementLevel - 1];
    const optimalTraditional = finalLevelResults.reduce((best, curr) =>
        curr.totalCost < best.totalCost ? curr : best
    );

    let optimalStrategy;

    if (mirrorStartLevel !== null) {
        // Mirror was used - build mirror-optimized result
        optimalStrategy = buildMirrorOptimizedResult(
            itemHrid,
            currentEnhancementLevel,
            mirrorStartLevel,
            targetCosts,
            optimalTraditional,
            mirrorPrice,
            config
        );
    } else {
        // No mirror used - return traditional result
        optimalStrategy = {
            protectFrom: optimalTraditional.protectFrom,
            label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
            expectedAttempts: optimalTraditional.expectedAttempts,
            totalTime: optimalTraditional.totalTime,
            baseCost: optimalTraditional.baseCost,
            materialCost: optimalTraditional.materialCost,
            protectionCost: optimalTraditional.protectionCost,
            protectionItemHrid: optimalTraditional.protectionItemHrid,
            protectionCount: optimalTraditional.protectionCount,
            totalCost: optimalTraditional.totalCost,
            usedMirror: false,
            mirrorStartLevel: null
        };
    }

    return {
        targetLevel: currentEnhancementLevel,
        itemLevel,
        optimalStrategy,
        allStrategies: [optimalStrategy] // Only return optimal
    };
}

/**
 * Calculate cost for a single protection strategy to reach a target level
 * @private
 */
function calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config) {
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

        if (!result || typeof result.attempts !== 'number' || typeof result.totalTime !== 'number') {
            console.error('[Enhancement Tooltip] Invalid result from calculateEnhancement:', result);
            return null;
        }

        // Calculate costs
        const costs = calculateTotalCost(itemHrid, targetLevel, protectFrom, config);

        return {
            expectedAttempts: result.attempts,
            totalTime: result.totalTime,
            ...costs
        };
    } catch (error) {
        console.error('[Enhancement Tooltip] Strategy calculation error:', error);
        return null;
    }
}

/**
 * Build mirror-optimized result with Fibonacci quantities
 * @private
 */
function buildMirrorOptimizedResult(itemHrid, targetLevel, mirrorStartLevel, targetCosts, optimalTraditional, mirrorPrice, config) {
    const gameData = dataManager.getInitClientData();
    const itemDetails = gameData.itemDetailMap[itemHrid];

    // Calculate Fibonacci quantities for consumed items
    const n = targetLevel - mirrorStartLevel;
    const numLowerTier = fib(n);           // Quantity of (mirrorStartLevel - 2) items
    const numUpperTier = fib(n + 1);       // Quantity of (mirrorStartLevel - 1) items
    const numMirrors = mirrorFib(n);       // Quantity of Philosopher's Mirrors

    const lowerTierLevel = mirrorStartLevel - 2;
    const upperTierLevel = mirrorStartLevel - 1;

    // Get cost of one item at each level from targetCosts
    const costLowerTier = targetCosts[lowerTierLevel];
    const costUpperTier = targetCosts[upperTierLevel];

    // Calculate total costs for consumed items and mirrors
    const totalLowerTierCost = numLowerTier * costLowerTier;
    const totalUpperTierCost = numUpperTier * costUpperTier;
    const totalMirrorsCost = numMirrors * mirrorPrice;

    // Build consumed items array for display
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

    // For mirror phase: ONLY consumed items + mirrors
    // The consumed item costs from targetCosts already include base/materials/protection
    // NO separate base/materials/protection for main item!

    return {
        protectFrom: optimalTraditional.protectFrom,
        label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
        expectedAttempts: optimalTraditional.expectedAttempts,
        totalTime: optimalTraditional.totalTime,
        baseCost: 0,  // Not applicable for mirror phase
        materialCost: 0,  // Not applicable for mirror phase
        protectionCost: 0,  // Not applicable for mirror phase
        protectionItemHrid: null,
        protectionCount: 0,
        consumedItemsCost: totalLowerTierCost + totalUpperTierCost,
        philosopherMirrorCost: totalMirrorsCost,
        totalCost: targetCosts[targetLevel],  // Use recursive formula result for consistency
        mirrorStartLevel: mirrorStartLevel,
        usedMirror: true,
        traditionalCost: optimalTraditional.totalCost,
        consumedItems: consumedItems,
        mirrorCount: numMirrors
    };
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
                const marketPrice = getItemPrices(material.itemHrid, 0);
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
    const marketPrice = getItemPrices(itemHrid, 0);
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
            const inputPrice = getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
            totalPrice += inputPrice * input.count;
        }
    }

    // Apply Artisan Tea reduction (0.9x)
    totalPrice *= 0.9;

    // Add upgrade item cost if this is an upgrade recipe (for refined items)
    if (action.upgradeItemHrid) {
        const upgradePrice = getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
        totalPrice += upgradePrice;
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
        protectionOptions.push(...itemDetails.protectionItemHrids);
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
        // For mirror phase, we ONLY show consumed items and mirrors (no base/materials/protection)
        // Consumed items section (Fibonacci-based quantities)
        html += 'Consumed Items (Philosopher\'s Mirror):';
        html += '<div style="margin-left: 12px;">';

        // Show consumed items in descending order (higher level first), filter out zero quantities
        const sortedConsumed = [...optimalStrategy.consumedItems]
            .filter(item => item.quantity > 0)
            .sort((a, b) => b.level - a.level);
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
