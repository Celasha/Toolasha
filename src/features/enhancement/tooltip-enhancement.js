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
    const optimal = strategies[0];

    return {
        targetLevel: currentEnhancementLevel,
        itemLevel,
        optimalStrategy: optimal,
        allStrategies: strategies
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
                if (marketPrice && marketPrice.ask) {
                    price = marketPrice.ask;
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
    html += '<div>Expected Attempts: ' + numberFormatter(optimalStrategy.expectedAttempts.toFixed(1)) + '</div>';

    // Costs
    html += '<div style="margin-top: 4px;">';
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
    html += '</div>';

    // Time estimate
    const hours = optimalStrategy.totalTime / 3600;
    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        html += '<div style="margin-top: 4px;">Time: ~' + minutes + ' minutes</div>';
    } else if (hours < 24) {
        html += '<div style="margin-top: 4px;">Time: ~' + hours.toFixed(1) + ' hours</div>';
    } else {
        const days = hours / 24;
        html += '<div style="margin-top: 4px;">Time: ~' + days.toFixed(1) + ' days</div>';
    }

    html += '</div>'; // Close margin-left div
    html += '</div>'; // Close main container

    return html;
}
