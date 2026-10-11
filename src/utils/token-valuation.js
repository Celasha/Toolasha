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
