/**
 * Crafting Plan Calculator
 * Computes the optimal buy-vs-craft plan for a target item by recursively
 * comparing market price against crafting cost at each material tier.
 */

import dataManager from '../../core/data-manager.js';
import { getItemPrice } from '../../utils/market-data.js';
import { parseArtisanBonus, getDrinkConcentration } from '../../utils/tea-parser.js';

const MAX_DEPTH = 15;

/**
 * Find the production action that creates a given item.
 * @param {string} itemHrid
 * @returns {{ actionHrid: string, action: Object, outputCount: number } | null}
 */
function findProductionAction(itemHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) return null;

    for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (!action.outputItems) continue;
        for (const output of action.outputItems) {
            if (output.itemHrid === itemHrid) {
                return { actionHrid, action, outputCount: output.count || 1 };
            }
        }
    }
    return null;
}

/**
 * Get artisan tea material reduction bonus for an action type.
 * @param {string} actionType - e.g. '/action_types/brewing'
 * @returns {number} Reduction as decimal (e.g. 0.112 for 11.2%)
 */
function getArtisanBonus(actionType) {
    try {
        const gameData = dataManager.getInitClientData();
        const equipment = dataManager.getEquipment();
        const itemDetailMap = gameData?.itemDetailMap || {};
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
        const activeDrinks = dataManager.getActionDrinkSlots(actionType);
        return parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);
    } catch {
        return 0;
    }
}

/**
 * Compute the optimal crafting plan for an item.
 * At each node, decides whether buying from market or crafting is cheaper.
 *
 * @param {string} itemHrid - Target item
 * @param {number} quantity - How many needed
 * @param {string} [mode='ask'] - Pricing mode for market lookups
 * @param {Set} [visited] - Circular dependency guard
 * @param {Map} [memo] - Memoization cache (unit cost per itemHrid)
 * @param {number} [depth=0] - Current recursion depth
 * @param {number} [maxDepth=MAX_DEPTH] - Maximum recursion depth (1 = buy all sub-materials)
 * @returns {CraftingPlanNode}
 */
export function computeBestCraftingPlan(
    itemHrid,
    quantity = 1,
    mode = 'ask',
    visited = new Set(),
    memo = new Map(),
    depth = 0,
    maxDepth = MAX_DEPTH
) {
    const itemDetails = dataManager.getItemDetails(itemHrid);
    const itemName = itemDetails?.name || itemHrid.split('/').pop();
    const isTradable = itemDetails?.isTradable ?? false;

    // Get market buy price
    let buyPrice = null;
    if (isTradable) {
        const marketPrice = getItemPrice(itemHrid, { mode, context: 'profit', side: 'buy' });
        if (marketPrice !== null && marketPrice > 0) {
            buyPrice = marketPrice;
        }
    }

    // Coins always cost 1 each
    if (itemHrid === '/items/coin') {
        return {
            itemHrid,
            itemName: 'Coin',
            quantity,
            strategy: 'buy',
            unitCost: 1,
            totalCost: quantity,
            buyPrice: 1,
            craftCost: null,
            actionHrid: null,
            actionsNeeded: 0,
            children: [],
        };
    }

    // Check memo for previously computed unit cost
    if (memo.has(itemHrid)) {
        const cachedUnitCost = memo.get(itemHrid);
        return {
            itemHrid,
            itemName,
            quantity,
            strategy: cachedUnitCost.strategy,
            unitCost: cachedUnitCost.unitCost,
            totalCost: cachedUnitCost.unitCost * quantity,
            buyPrice,
            craftCost: cachedUnitCost.craftCost,
            actionHrid: cachedUnitCost.actionHrid,
            actionsNeeded:
                cachedUnitCost.strategy === 'craft' ? Math.ceil(quantity / (cachedUnitCost.outputCount || 1)) : 0,
            children:
                cachedUnitCost.strategy === 'craft'
                    ? cachedUnitCost.childrenTemplate.map((c) =>
                          computeBestCraftingPlan(
                              c.itemHrid,
                              c.qtyPerUnit * quantity,
                              mode,
                              visited,
                              memo,
                              depth + 1,
                              maxDepth
                          )
                      )
                    : [],
        };
    }

    // Circular dependency or depth limit — must buy
    if (visited.has(itemHrid) || depth >= maxDepth) {
        return {
            itemHrid,
            itemName,
            quantity,
            strategy: 'buy',
            unitCost: buyPrice ?? Infinity,
            totalCost: (buyPrice ?? Infinity) * quantity,
            buyPrice,
            craftCost: null,
            actionHrid: null,
            actionsNeeded: 0,
            children: [],
        };
    }

    // Find production action
    const production = findProductionAction(itemHrid);
    if (!production) {
        // No recipe — must buy
        const unitCost = buyPrice ?? 0;
        memo.set(itemHrid, {
            strategy: 'buy',
            unitCost,
            craftCost: null,
            actionHrid: null,
            outputCount: 1,
            childrenTemplate: [],
        });
        return {
            itemHrid,
            itemName,
            quantity,
            strategy: 'buy',
            unitCost,
            totalCost: unitCost * quantity,
            buyPrice,
            craftCost: null,
            actionHrid: null,
            actionsNeeded: 0,
            children: [],
        };
    }

    // Recurse into crafting
    visited.add(itemHrid);
    const { actionHrid, action, outputCount } = production;
    const artisanBonus = getArtisanBonus(action.type);
    const actionsForOne = 1 / outputCount; // actions per 1 output item

    let craftCostPerUnit = 0;
    const childrenTemplate = []; // { itemHrid, qtyPerUnit } for memo reconstruction

    // Input items (affected by artisan bonus)
    if (action.inputItems) {
        for (const input of action.inputItems) {
            const inputCountPerAction = input.count || 1;
            const reducedCount = inputCountPerAction * (1 - artisanBonus);
            const qtyPerUnit = reducedCount * actionsForOne;

            const inputQty = Math.ceil(reducedCount * Math.ceil(quantity / outputCount));
            const childPlan = computeBestCraftingPlan(
                input.itemHrid,
                inputQty,
                mode,
                visited,
                memo,
                depth + 1,
                maxDepth
            );

            craftCostPerUnit += childPlan.unitCost * qtyPerUnit;
            childrenTemplate.push({ itemHrid: input.itemHrid, qtyPerUnit });
        }
    }

    // Upgrade item (NOT affected by artisan bonus)
    if (action.upgradeItemHrid) {
        const qtyPerUnit = actionsForOne; // 1 upgrade per action
        const upgradeQty = Math.ceil(quantity / outputCount);
        const upgradePlan = computeBestCraftingPlan(
            action.upgradeItemHrid,
            upgradeQty,
            mode,
            visited,
            memo,
            depth + 1,
            maxDepth
        );

        craftCostPerUnit += upgradePlan.unitCost * qtyPerUnit;
        childrenTemplate.push({ itemHrid: action.upgradeItemHrid, qtyPerUnit });
    }

    visited.delete(itemHrid);

    // Buy vs craft decision
    const shouldBuy = buyPrice !== null && buyPrice <= craftCostPerUnit;
    const strategy = shouldBuy ? 'buy' : 'craft';
    const unitCost = shouldBuy ? buyPrice : craftCostPerUnit;

    // Cache the decision
    memo.set(itemHrid, {
        strategy,
        unitCost,
        craftCost: craftCostPerUnit,
        actionHrid: strategy === 'craft' ? actionHrid : null,
        outputCount,
        childrenTemplate: strategy === 'craft' ? childrenTemplate : [],
    });

    // Build children for the actual quantities
    let children = [];
    if (!shouldBuy) {
        const actionsNeeded = Math.ceil(quantity / outputCount);
        children = [];
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputCountPerAction = input.count || 1;
                const reducedCount = inputCountPerAction * (1 - artisanBonus);
                const inputQty = Math.ceil(reducedCount * actionsNeeded);
                children.push(
                    computeBestCraftingPlan(input.itemHrid, inputQty, mode, visited, memo, depth + 1, maxDepth)
                );
            }
        }
        if (action.upgradeItemHrid) {
            children.push(
                computeBestCraftingPlan(action.upgradeItemHrid, actionsNeeded, mode, visited, memo, depth + 1, maxDepth)
            );
        }
    }

    return {
        itemHrid,
        itemName,
        quantity,
        strategy,
        unitCost,
        totalCost: unitCost * quantity,
        buyPrice,
        craftCost: craftCostPerUnit,
        actionHrid: strategy === 'craft' ? actionHrid : null,
        actionsNeeded: strategy === 'craft' ? Math.ceil(quantity / outputCount) : 0,
        children,
    };
}
