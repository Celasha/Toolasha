/**
 * Token Valuation Utility
 * Shared logic for calculating dungeon token and task token values
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import { getItemPriceOutlierInfo } from './market-data.js';

/**
 * The four dungeon currency tokens (Pirate Cove, Chimerical Dungeon, Sinister Dungeon,
 * Enchanted Dungeon) - none trade directly on the market, but each is spendable in its own
 * Token Shop for an item that does, so calculateDungeonTokenValue can derive a gold-per-token
 * rate for all four.
 */
export const DUNGEON_TOKEN_HRIDS = new Set([
    '/items/chimerical_token',
    '/items/sinister_token',
    '/items/enchanted_token',
    '/items/pirate_token',
]);

/**
 * Resolve which market price side the current pricing-mode settings select: bid for
 * Conservative/Patient Buy (buy-side-cheap convention), ask for Hybrid/Optimistic - or always
 * bid when mode-respect is disabled.
 * @param {string} pricingModeSetting - Config setting key for pricing mode
 * @param {string|null} respectModeSetting - Config setting key for the respect-mode flag (an unknown key or
 *     absent setting falls back to true, i.e. the pricing mode is respected)
 * @returns {'bid'|'ask'} The selected market price side
 */
export function resolvePricingSide(pricingModeSetting, respectModeSetting) {
    const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
    const respectPricingMode = config.getSettingValue(respectModeSetting, true);
    return !respectPricingMode ? 'bid' : pricingMode === 'conservative' || pricingMode === 'patientBuy' ? 'bid' : 'ask';
}

/**
 * Calculate dungeon token value based on best shop item value
 * Uses "best market value per token" approach: finds the shop item with highest (market price / token cost)
 * @param {string} tokenHrid - Token HRID (e.g., '/items/chimerical_token')
 * @param {string} pricingModeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
 * @param {string} respectModeSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
 * @returns {{value: number, isOutlier: boolean}|null} Value per token (outlier-guard clamped) and whether the
 *   winning shop item's/essence's price was substituted by the outlier guard, or null if no data
 */
export function calculateDungeonTokenValue(
    tokenHrid,
    pricingModeSetting = 'profitCalc_pricingMode',
    respectModeSetting = 'expectedValue_respectPricingMode'
) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return null;

    // Get all shop items for this token type
    const shopItems = Object.values(gameData.shopItemDetailMap || {}).filter(
        (item) => item.costs && item.costs[0]?.itemHrid === tokenHrid
    );

    if (shopItems.length === 0) return null;

    let bestValuePerToken = 0;
    let bestIsOutlier = false;

    // For each shop item, calculate market price / token cost
    for (const shopItem of shopItems) {
        const itemHrid = shopItem.itemHrid;
        const tokenCost = shopItem.costs[0].count;

        const mode = resolvePricingSide(pricingModeSetting, respectModeSetting);
        const priceInfo = getItemPriceOutlierInfo(itemHrid, { mode });
        const marketPrice = priceInfo.value || 0;
        if (marketPrice <= 0) continue;

        // Calculate value per token
        const valuePerToken = marketPrice / tokenCost;

        // Keep track of best value
        if (valuePerToken > bestValuePerToken) {
            bestValuePerToken = valuePerToken;
            bestIsOutlier = priceInfo.isOutlier;
        }
    }

    // Fallback to essence price if no shop items found
    if (bestValuePerToken === 0) {
        const essenceMap = {
            '/items/chimerical_token': '/items/chimerical_essence',
            '/items/sinister_token': '/items/sinister_essence',
            '/items/enchanted_token': '/items/enchanted_essence',
            '/items/pirate_token': '/items/pirate_essence',
        };

        const essenceHrid = essenceMap[tokenHrid];
        if (essenceHrid) {
            const mode = resolvePricingSide(pricingModeSetting, respectModeSetting);
            const essencePriceInfo = getItemPriceOutlierInfo(essenceHrid, { mode });
            const marketPrice = essencePriceInfo.value || 0;

            return marketPrice > 0 ? { value: marketPrice, isOutlier: essencePriceInfo.isOutlier } : null;
        }
    }

    return bestValuePerToken > 0 ? { value: bestValuePerToken, isOutlier: bestIsOutlier } : null;
}

export const LABYRINTH_TOKEN_HRID = '/items/labyrinth_token';

/**
 * The Labyrinth scrolls ("seals"). They cannot be traded, but each costs SCROLL_TOKEN_COST
 * Labyrinth Tokens in the Labyrinth shop.
 */
export const SCROLL_HRIDS = new Set([
    '/items/seal_of_action_speed',
    '/items/seal_of_attack_speed',
    '/items/seal_of_cast_speed',
    '/items/seal_of_combat_drop',
    '/items/seal_of_critical_rate',
    '/items/seal_of_damage',
    '/items/seal_of_efficiency',
    '/items/seal_of_gathering',
    '/items/seal_of_gourmet',
    '/items/seal_of_processing',
    '/items/seal_of_rare_find',
    '/items/seal_of_wisdom',
]);

export const SCROLL_TOKEN_COST = 30;

/** Items valued through the Labyrinth shop: the token itself and the scrolls. */
export const LABYRINTH_VALUED_HRIDS = new Set([LABYRINTH_TOKEN_HRID, ...SCROLL_HRIDS]);

/**
 * Value of one Labyrinth Token: the best market value per token among the Labyrinth shop's items
 * (price x output count / token cost), on the side the profit pricing mode selects.
 * @returns {{value: number, isOutlier: boolean}|null} null when no shop item has a market price
 */
function calculateLabyrinthTokenValue() {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return null;

    const mode = resolvePricingSide('profitCalc_pricingMode', null);
    let best = null;
    for (const shopItem of Object.values(gameData.labyrinthShopItemDetailMap || {})) {
        const tokenCost = shopItem.cost?.count || 0;
        if (tokenCost <= 0) continue;

        const priceInfo = getItemPriceOutlierInfo(shopItem.itemHrid, { mode });
        const marketPrice = priceInfo.value || 0;
        if (marketPrice <= 0) continue;

        const valuePerToken = (marketPrice * (shopItem.outputCount || 1)) / tokenCost;
        if (!best || valuePerToken > best.value) {
            best = { value: valuePerToken, isOutlier: priceInfo.isOutlier };
        }
    }
    return best;
}

/**
 * Value of one Labyrinth Token or one Labyrinth scroll (SCROLL_TOKEN_COST tokens' worth).
 * @param {string} itemHrid - A member of LABYRINTH_VALUED_HRIDS
 * @returns {{value: number, isOutlier: boolean}|null} null for other items or when there is no data
 */
export function calculateLabyrinthItemValue(itemHrid) {
    if (!LABYRINTH_VALUED_HRIDS.has(itemHrid)) return null;
    const token = calculateLabyrinthTokenValue();
    if (!token) return null;
    return itemHrid === LABYRINTH_TOKEN_HRID
        ? token
        : { value: token.value * SCROLL_TOKEN_COST, isOutlier: token.isOutlier };
}

/**
 * Calculate task token value based on best chest expected value
 * @returns {number} Value per token, or 0 if no data
 */
export function calculateTaskTokenValue() {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    // Get all chest items (Large Artisan's Crate, Large Meteorite Cache, Large Treasure Chest)
    const chestHrids = ['/items/large_artisans_crate', '/items/large_meteorite_cache', '/items/large_treasure_chest'];

    const bestChestValue = 0;

    for (const chestHrid of chestHrids) {
        const itemDetails = dataManager.getItemDetails(chestHrid);
        if (!itemDetails || !itemDetails.isOpenable) continue;

        // Calculate expected value for this chest
        // Note: This would require expectedValueCalculator, but to avoid circular dependency,
        // we'll let the caller handle this or import it locally where needed
        // For now, return 0 as placeholder
    }

    // Task Token cost for chests is 30
    const tokenCost = 30;

    return bestChestValue / tokenCost;
}
