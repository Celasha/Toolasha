/**
 * Inventory-Aware Missing Materials Fulfillment (TLA-042)
 *
 * The displayed Best Crafting Plan (`computeBestCraftingPlan`) answers an inventory-independent
 * question — "what is the economically preferred route to reproduce this item?" — and its
 * displayed economics must not change in this ticket.
 *
 * "Buy Missing Materials" answers a different question: for the exact selected root action count
 * and the inventory already owned, what still needs to be acquired to execute the chosen route?
 * That requires inventory awareness at *every* intermediate node, not just the final raw-material
 * leaves — otherwise an owned intermediate (e.g. Umbral Leather) gets re-expanded into its own raw
 * materials (e.g. Umbral Hide) as if none of it were owned at all.
 *
 * This walks the same buy-vs-craft decisions `computeBestCraftingPlan` would make (reusing it as a
 * quantity-independent strategy oracle, since a given item's buy/craft decision is memoized and
 * does not depend on the quantity requested), but drives its own recursion with one shared,
 * mutable projected inventory ledger: every requirement first consumes from the ledger, only the
 * remaining deficit is priced/recursed, and any batch surplus from an intermediate craft is
 * credited back to the ledger for later branches to reuse.
 */

import dataManager from '../../core/data-manager.js';
import { computeBestCraftingPlan, getArtisanBonus, MAX_DEPTH } from './crafting-plan-calculator.js';

/**
 * Build the initial projected inventory ledger from the player's current unenhanced inventory.
 * @returns {Map<string, number>}
 */
function buildInventoryLedger() {
    const ledger = new Map();
    const inventory = dataManager.getInventory() || [];
    for (const invItem of inventory) {
        if (invItem.itemLocationHrid !== '/item_locations/inventory' || invItem.enhancementLevel) continue;
        ledger.set(invItem.itemHrid, (ledger.get(invItem.itemHrid) || 0) + (invItem.count || 0));
    }
    return ledger;
}

/**
 * Resolve one level of recipe data for a craft node from real action data.
 * @param {Object} actionDetailMap
 * @param {string} actionHrid
 * @param {string} itemHrid
 * @returns {{outputCount: number, artisanBonus: number, inputItems: Array, upgradeItemHrid: string|null}|null}
 */
function resolveRecipe(actionDetailMap, actionHrid, itemHrid) {
    const actionDetail = actionDetailMap[actionHrid];
    if (!actionDetail) return null;

    const outputItem = actionDetail.outputItems?.find((o) => o.itemHrid === itemHrid) || actionDetail.outputItems?.[0];
    return {
        outputCount: outputItem?.count || 1,
        artisanBonus: getArtisanBonus(actionDetail.type),
        inputItems: actionDetail.inputItems || [],
        upgradeItemHrid: actionDetail.upgradeItemHrid || null,
    };
}

/**
 * Compute the inventory-aware missing-materials leaf list for a Best Crafting Plan root selection.
 *
 * The root is always crafted for the exact requested `numActions` — owning finished copies of the
 * root output must never reduce the player's requested production actions (they explicitly asked
 * to craft this many).
 *
 * @param {Object} params
 * @param {string} params.rootActionHrid - Action producing the selected root item
 * @param {string} params.rootItemHrid - Root output item
 * @param {number} params.rootOutputCount - Output count per root action
 * @param {number} params.numActions - Exact selected root action count
 * @param {string} params.mode - Pricing mode passed through to the strategy oracle
 * @param {boolean} params.buyRawOnly - "Buy raw materials only" setting
 * @param {boolean} params.forceRootCraft - Task mode; applies only to the root, never recursive deficits
 * @param {number} params.timeCostPerHour - Gold value per hour of player time (0 = disabled)
 * @param {boolean} params.skipProcessing - "No processing" setting
 * @returns {{itemHrid: string, itemName: string, required: number, missing: number, isTradeable: boolean}[]}
 */
export function computeInventoryAwareMissingMaterials({
    rootActionHrid,
    rootItemHrid,
    rootOutputCount,
    numActions,
    mode,
    buyRawOnly,
    forceRootCraft,
    timeCostPerHour,
    skipProcessing,
}) {
    const gameData = dataManager.getInitClientData();
    const actionDetailMap = gameData?.actionDetailMap || {};

    const ledger = buildInventoryLedger();
    const buyRequirements = new Map(); // itemHrid -> total missing
    const consumedByItem = new Map(); // itemHrid -> total consumed from the ledger
    const strategyMemo = new Map(); // shared across every computeBestCraftingPlan probe call

    function consume(itemHrid, quantity) {
        const have = ledger.get(itemHrid) || 0;
        const used = Math.min(have, quantity);
        ledger.set(itemHrid, have - used);
        if (used > 0) consumedByItem.set(itemHrid, (consumedByItem.get(itemHrid) || 0) + used);
        return quantity - used;
    }

    function credit(itemHrid, quantity) {
        if (!(quantity > 0)) return;
        ledger.set(itemHrid, (ledger.get(itemHrid) || 0) + quantity);
    }

    function addBuyRequirement(itemHrid, missingQuantity) {
        if (!(missingQuantity > 0)) return;
        buyRequirements.set(itemHrid, (buyRequirements.get(itemHrid) || 0) + missingQuantity);
    }

    function fulfill(itemHrid, quantity, depth, visited, isRoot, forcedActions) {
        if (!(quantity > 0)) return;

        let remaining = quantity;
        if (!isRoot) {
            remaining = consume(itemHrid, quantity);
            if (!(remaining > 0)) return;
        }

        // Circular dependency or depth limit — must buy, matching computeBestCraftingPlan's guard.
        if (!isRoot && (visited.has(itemHrid) || depth >= MAX_DEPTH)) {
            addBuyRequirement(itemHrid, remaining);
            return;
        }

        let actionHrid;
        if (isRoot) {
            actionHrid = rootActionHrid;
        } else {
            // Buy-vs-craft is a quantity-independent decision (memoized by computeBestCraftingPlan),
            // so probing at quantity 1 yields the same strategy this item would get at any quantity.
            const probe = computeBestCraftingPlan(
                itemHrid,
                1,
                mode,
                new Set(),
                strategyMemo,
                depth,
                MAX_DEPTH,
                buyRawOnly,
                forceRootCraft,
                timeCostPerHour,
                skipProcessing
            );
            actionHrid = probe.strategy === 'craft' ? probe.actionHrid : null;
        }

        const recipe = actionHrid ? resolveRecipe(actionDetailMap, actionHrid, itemHrid) : null;
        if (!recipe) {
            addBuyRequirement(itemHrid, remaining);
            return;
        }

        const actionsNeeded = isRoot ? forcedActions : Math.ceil(remaining / recipe.outputCount);

        visited.add(itemHrid);
        for (const input of recipe.inputItems) {
            // Preserve current Best Crafting Plan expected-material rounding semantics.
            const required = Math.ceil((input.count || 1) * (1 - recipe.artisanBonus) * actionsNeeded);
            fulfill(input.itemHrid, required, depth + 1, visited, false, null);
        }
        if (recipe.upgradeItemHrid) {
            // Upgrade item is one per action and is never Artisan-reduced.
            fulfill(recipe.upgradeItemHrid, actionsNeeded, depth + 1, visited, false, null);
        }
        visited.delete(itemHrid);

        if (!isRoot) {
            const produced = actionsNeeded * recipe.outputCount;
            credit(itemHrid, produced - remaining);
        }
    }

    fulfill(rootItemHrid, numActions * rootOutputCount, 0, new Set(), true, numActions);

    const materials = [];
    for (const [itemHrid, missing] of buyRequirements) {
        if (!(missing > 0)) continue;
        const itemDetails = dataManager.getItemDetails(itemHrid);
        materials.push({
            itemHrid,
            itemName: itemDetails?.name || itemHrid.split('/').pop(),
            required: missing + (consumedByItem.get(itemHrid) || 0),
            missing,
            isTradeable: itemDetails?.isTradable === true,
        });
    }
    return materials;
}
