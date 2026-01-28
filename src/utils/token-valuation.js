/**
 * Token Valuation Utility
 * Shared logic for calculating dungeon token and task token values
 */

import config from '../core/config.js';
import marketAPI from '../api/marketplace.js';
import dataManager from '../core/data-manager.js';

/**
 * Calculate simple crafting cost for an item (for price validation)
 * @param {string} itemHrid - Item HRID
 * @returns {number} Crafting cost or 0 if not craftable
 */
function calculateSimpleCraftingCost(itemHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    // Find the action that produces this item
    for (const action of Object.values(gameData.actionDetailMap || {})) {
        if (action.outputItems) {
            for (const output of action.outputItems) {
                if (output.itemHrid === itemHrid) {
                    // Found the crafting action, calculate material costs
                    let inputCost = 0;
                    let hasAllMaterialPrices = true;

                    // Add input items
                    if (action.inputItems && action.inputItems.length > 0) {
                        for (const input of action.inputItems) {
                            const inputPrices = marketAPI.getPrice(input.itemHrid, 0);
                            if (!inputPrices || inputPrices.ask <= 0) {
                                hasAllMaterialPrices = false;
                                break;
                            }
                            inputCost += inputPrices.ask * input.count;
                        }
                    }

                    if (!hasAllMaterialPrices) {
                        return 0;
                    }

                    // Apply Artisan Tea reduction (0.9x) to input materials
                    inputCost *= 0.9;

                    // Add upgrade item cost (not affected by Artisan Tea)
                    let upgradeCost = 0;
                    if (action.upgradeItemHrid) {
                        const upgradePrices = marketAPI.getPrice(action.upgradeItemHrid, 0);
                        if (!upgradePrices || upgradePrices.ask <= 0) {
                            return 0;
                        }
                        upgradeCost = upgradePrices.ask;
                    }

                    const totalCost = inputCost + upgradeCost;

                    // Divide by output count to get per-item cost
                    return totalCost / (output.count || 1);
                }
            }
        }
    }

    return 0;
}

/**
 * Get reliable market price with 1.5x safeguard
 * @param {string} itemHrid - Item HRID
 * @param {Object} prices - Market prices object {ask, bid}
 * @returns {Object} {ask, bid} with reliable prices
 */
function getReliableMarketPrice(itemHrid, prices) {
    if (!prices) return { ask: 0, bid: 0 };

    let reliableAsk = prices.ask || 0;
    let reliableBid = prices.bid || 0;

    // Check if ask price is unreliable (> 1.5x crafting cost)
    if (reliableAsk > 0) {
        const craftingCost = calculateSimpleCraftingCost(itemHrid);
        if (craftingCost > 0 && reliableAsk > craftingCost * 1.5) {
            // Market unreliable - use crafting cost
            reliableAsk = craftingCost;
        }
    }

    // Check bid price too
    if (reliableBid > 0) {
        const craftingCost = calculateSimpleCraftingCost(itemHrid);
        if (craftingCost > 0 && reliableBid > craftingCost * 1.5) {
            // Market unreliable - use crafting cost
            reliableBid = craftingCost;
        }
    }

    return { ask: reliableAsk, bid: reliableBid };
}

/**
 * Calculate dungeon token value based on best shop item value
 * Uses "best market value per token" approach: finds the shop item with highest (market price / token cost)
 * @param {string} tokenHrid - Token HRID (e.g., '/items/chimerical_token')
 * @param {string} pricingModeSetting - Config setting key for pricing mode (default: 'profitCalc_pricingMode')
 * @param {string} respectModeSetting - Config setting key for respect pricing mode flag (default: 'expectedValue_respectPricingMode')
 * @returns {number|null} Value per token, or null if no data
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

    // For each shop item, calculate market price / token cost
    for (const shopItem of shopItems) {
        const itemHrid = shopItem.itemHrid;
        const tokenCost = shopItem.costs[0].count;

        // Get market price for this item (with safeguards)
        const rawPrices = marketAPI.getPrice(itemHrid, 0);
        if (!rawPrices) continue;

        const prices = getReliableMarketPrice(itemHrid, rawPrices);

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
            '/items/pirate_token': '/items/pirate_essence',
        };

        const essenceHrid = essenceMap[tokenHrid];
        if (essenceHrid) {
            const rawEssencePrice = marketAPI.getPrice(essenceHrid, 0);
            if (rawEssencePrice) {
                const essencePrice = getReliableMarketPrice(essenceHrid, rawEssencePrice);
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
