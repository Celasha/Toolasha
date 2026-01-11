/**
 * Token Valuation Utility
 * Shared logic for calculating dungeon token and task token values
 */

import config from '../core/config.js';
import marketAPI from '../api/marketplace.js';
import dataManager from '../core/data-manager.js';

/**
 * Calculate dungeon token value based on best shop item value
 * Uses "best market value per token" approach: finds the shop item with highest (market price / token cost)
 * @param {string} tokenHrid - Token HRID (e.g., '/items/chimerical_token')
 * @param {string} pricingModeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
 * @param {string} respectModeSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
 * @returns {number|null} Value per token, or null if no data
 */
export function calculateDungeonTokenValue(tokenHrid, pricingModeSetting = 'profitCalc_pricingMode', respectModeSetting = 'expectedValue_respectPricingMode') {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return null;

    // Get all shop items for this token type
    const shopItems = Object.values(gameData.shopItemDetailMap || {}).filter(
        item => item.costs && item.costs[0]?.itemHrid === tokenHrid
    );

    if (shopItems.length === 0) return null;

    let bestValuePerToken = 0;

    // For each shop item, calculate market price / token cost
    for (const shopItem of shopItems) {
        const itemHrid = shopItem.itemHrid;
        const tokenCost = shopItem.costs[0].count;

        // Get market price for this item
        const prices = marketAPI.getPrice(itemHrid, 0);
        if (!prices) continue;

        // Use pricing mode to determine which price to use
        const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
        const respectPricingMode = config.getSettingValue(respectModeSetting, true);

        let marketPrice = 0;
        if (respectPricingMode) {
            // Conservative: Bid, Hybrid/Optimistic: Ask
            marketPrice = pricingMode === 'conservative' ? prices.bid : prices.ask;
        } else {
            // Always conservative
            marketPrice = prices.bid;
        }

        if (marketPrice <= 0) continue;

        // Calculate value per token
        const valuePerToken = marketPrice / tokenCost;

        // Keep track of best value
        if (valuePerToken > bestValuePerToken) {
            bestValuePerToken = valuePerToken;
        }
    }

    // Fallback to essence price if no shop items found
    if (bestValuePerToken === 0) {
        const essenceMap = {
            '/items/chimerical_token': '/items/chimerical_essence',
            '/items/sinister_token': '/items/sinister_essence',
            '/items/enchanted_token': '/items/enchanted_essence',
            '/items/pirate_token': '/items/pirate_essence'
        };

        const essenceHrid = essenceMap[tokenHrid];
        if (essenceHrid) {
            const essencePrice = marketAPI.getPrice(essenceHrid, 0);
            if (essencePrice) {
                const pricingMode = config.getSettingValue(pricingModeSetting, 'conservative');
                const respectPricingMode = config.getSettingValue(respectModeSetting, true);

                let marketPrice = 0;
                if (respectPricingMode) {
                    marketPrice = pricingMode === 'conservative' ? essencePrice.bid : essencePrice.ask;
                } else {
                    marketPrice = essencePrice.bid;
                }

                return marketPrice > 0 ? marketPrice : null;
            }
        }
    }

    return bestValuePerToken > 0 ? bestValuePerToken : null;
}

/**
 * Calculate task token value based on best chest expected value
 * @returns {number} Value per token, or 0 if no data
 */
export function calculateTaskTokenValue() {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    // Get all chest items (Large Artisan's Crate, Large Meteorite Cache, Large Treasure Chest)
    const chestHrids = [
        '/items/large_artisans_crate',
        '/items/large_meteorite_cache',
        '/items/large_treasure_chest'
    ];

    let bestChestValue = 0;

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
