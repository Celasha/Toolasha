/**
 * Score Acquisition Resolver (TLA-041E)
 *
 * Completeness-aware replacement for the legacy, number-only
 * `tooltip-enhancement.js#getProductionCost()` for Profile Score's purposes. That legacy function
 * silently substitutes 0 for any input it can't price and keeps summing the recipe, so a mixed
 * recipe (e.g. Pathbreaker Boots: 10 Lodestones + ordinary Bear Shoes) could return a positive,
 * apparently-complete cost even though a required special-currency leg was actually unpriced. Score
 * needs every crafting candidate to carry `{cost, complete}` so a missing required input can never
 * silently become free (report's completeness-aware crafting requirement).
 *
 * `resolveItemAcquisitionCost` is the single recursive, memoized entry point used for BOTH a
 * top-level equipped item's base (+0) acquisition AND every material/upgrade input encountered while
 * pricing its production chain - the same "cheapest complete route" minimum (exact Ask / shop coin
 * cost / special-currency shop opportunity / crafted) applies at every layer, not just the top. A
 * repeated shared material (Task Crystal, Labyrinth Essence, a Lodestone, a Refinement Shard, a
 * dungeon Essence) is therefore resolved once per acquisition context and reused through every base/
 * refined/enhancement chain that needs it (TLA041E-30).
 */

import dataManager from '../../../core/data-manager.js';
import { getItemPrice } from '../../../utils/market-data.js';
import { getShopCoinCost } from '../../../utils/game-lookups.js';
import { getDrinkConcentration, parseArtisanBonus } from '../../../utils/tea-parser.js';
import { getSpecialCurrencyAcquisitionCost } from './special-currency-valuation.js';

let cachedActionIndex = null;
let cachedActionIndexSource = null;

/**
 * Index of "which action produces this item" over `actionDetailMap`, built once per game-data
 * snapshot (static data, safe to share across every acquisition context) instead of rescanning every
 * action for every unpriced material.
 * @param {Object} gameData
 * @returns {Map<string, Object>} itemHrid -> action
 */
function getActionOutputIndex(gameData) {
    if (cachedActionIndexSource === gameData) return cachedActionIndex;

    const index = new Map();
    for (const action of Object.values(gameData.actionDetailMap || {})) {
        const output = action.outputItems?.[0];
        if (output?.itemHrid && !index.has(output.itemHrid)) {
            index.set(output.itemHrid, action);
        }
    }

    cachedActionIndex = index;
    cachedActionIndexSource = gameData;
    return index;
}

/**
 * Create a fresh per-Score-generation acquisition context. Market prices/opportunity values are
 * never persisted across profile opens - a new context per `calculateEquipmentScore` call is
 * sufficient and safer than stale global state (report's own allowance).
 * @returns {{acquisitionCache: Map, opportunityCache: Map, resolving: Set}}
 */
export function createAcquisitionContext() {
    return {
        acquisitionCache: new Map(), // itemHrid -> {cost, complete}
        opportunityCache: new Map(), // currencyHrid -> {value, complete}
        resolving: new Set(), // itemHrid currently being resolved - cycle guard
    };
}

/**
 * Cheapest defensible acquisition cost for one unit of `itemHrid`, memoized per context: minimum
 * across every candidate that prices COMPLETELY (exact Ask, official shop coin cost, special-currency
 * shop opportunity, or a fully-priced crafting recipe). A candidate that only partially prices never
 * contributes 0 - it is simply excluded from the minimum.
 * @param {string} itemHrid
 * @param {{acquisitionCache: Map, opportunityCache: Map, resolving: Set}} context
 * @returns {{cost: number|null, complete: boolean}}
 */
export function resolveItemAcquisitionCost(itemHrid, context) {
    const cached = context.acquisitionCache.get(itemHrid);
    if (cached) return cached;

    if (context.resolving.has(itemHrid)) {
        // Defensive cycle guard - not cached, since a future call outside the cycle may still resolve.
        return { cost: null, complete: false };
    }

    context.resolving.add(itemHrid);
    let result;
    try {
        result = computeItemAcquisitionCost(itemHrid, context);
    } finally {
        context.resolving.delete(itemHrid);
    }

    context.acquisitionCache.set(itemHrid, result);
    return result;
}

/**
 * @param {string} itemHrid
 * @param {Object} context
 * @returns {{cost: number|null, complete: boolean}}
 */
function computeItemAcquisitionCost(itemHrid, context) {
    const candidates = [];

    const special = getSpecialCurrencyAcquisitionCost(itemHrid, context);
    if (special.complete) candidates.push(special.cost);

    const ask = getItemPrice(itemHrid, { mode: 'ask' });
    if (ask > 0) candidates.push(ask);

    const shopCost = getShopCoinCost(itemHrid);
    if (shopCost > 0) candidates.push(shopCost);

    const craft = resolveProductionCraftCost(itemHrid, context);
    if (craft.complete) candidates.push(craft.cost);

    if (candidates.length === 0) return { cost: null, complete: false };
    return { cost: Math.min(...candidates), complete: true };
}

/**
 * Completeness-aware production cost: recursively prices every required input material and upgrade
 * item via `resolveItemAcquisitionCost` (so special-currency materials, and materials that are
 * themselves crafted, resolve through the same cheapest-complete-route logic) and requires every one
 * of them to price completely - a missing required input excludes the whole candidate rather than
 * contributing 0 (report's completeness-aware crafting requirement / TLA041E-19).
 * @param {string} itemHrid
 * @param {Object} context
 * @returns {{cost: number|null, complete: boolean}}
 */
function resolveProductionCraftCost(itemHrid, context) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return { cost: null, complete: false };

    const action = getActionOutputIndex(gameData).get(itemHrid);
    if (!action) return { cost: null, complete: false };

    const outputCount = action.outputItems?.[0]?.count || 1;

    let artisanBonus = 0;
    try {
        const equipment = dataManager.getEquipment();
        const itemDetailMap = gameData.itemDetailMap || {};
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
        const activeDrinks = dataManager.getActionDrinkSlots(action.type);
        artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);
    } catch {
        // Fall back to no reduction if viewer equipment/drink data is unavailable.
    }

    let total = 0;
    let complete = true;

    for (const input of action.inputItems || []) {
        if (input.itemHrid === '/items/coin') {
            total += input.count * (1 - artisanBonus);
            continue;
        }

        const materialCost = resolveItemAcquisitionCost(input.itemHrid, context);
        if (!materialCost.complete) {
            complete = false;
            continue;
        }
        total += materialCost.cost * input.count * (1 - artisanBonus);
    }

    if (action.upgradeItemHrid) {
        const upgradeCost = resolveItemAcquisitionCost(action.upgradeItemHrid, context);
        if (!upgradeCost.complete) {
            complete = false;
        } else {
            total += upgradeCost.cost;
        }
    }

    if (!complete) return { cost: null, complete: false };
    return { cost: total / outputCount, complete: true };
}

/**
 * Completeness-aware replacement for `tooltip-enhancement.js#calculatePerAttemptMaterialCost` for
 * Score's purposes: a missing-Ask enhancement material (e.g. Task Crystal, Labyrinth/dungeon Essence)
 * can still resolve through the same special-currency/crafting acquisition logic instead of forcing
 * the whole enhancement leg to N/A.
 * @param {Object} itemDetails - Item details containing `enhancementCosts`
 * @param {Object} context
 * @returns {{cost: number|null, complete: boolean}}
 */
export function resolvePerAttemptMaterialCost(itemDetails, context) {
    if (!itemDetails?.enhancementCosts?.length) return { cost: null, complete: false };

    let cost = 0;
    let complete = true;

    for (const material of itemDetails.enhancementCosts) {
        if (material.itemHrid === '/items/coin') {
            cost += material.count;
            continue;
        }

        const materialCost = resolveItemAcquisitionCost(material.itemHrid, context);
        if (!materialCost.complete) {
            complete = false;
            continue;
        }
        cost += material.count * materialCost.cost;
    }

    if (!complete) return { cost: null, complete: false };
    return { cost, complete: true };
}
