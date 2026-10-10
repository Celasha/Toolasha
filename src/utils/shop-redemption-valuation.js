/**
 * Shop Redemption Valuation
 * Indirect pricing for items with no direct market price but an official special-currency shop
 * purchase (e.g. seals bought with labyrinth tokens): implied value = currency value × tokenCost
 * ÷ outputCount, where the currency itself is valued at its best tradeable redemption across the
 * special-currency shops. Consumers opt in through expected-value-calculator's `allowIndirect`
 * flag. This module must never import expected-value-calculator (circular dependency: it already
 * imports token-valuation).
 */

import { getItemPriceOutlierInfo } from './market-data.js';
import { calculateDungeonTokenValue, DUNGEON_TOKEN_HRIDS, resolvePricingSide } from './token-valuation.js';
import { findShopPurchaseInfo, getShopEntriesForCurrency } from './special-currency-shop.js';

const PRICING_MODE_SETTING = 'profitCalc_pricingMode';
const RESPECT_MODE_SETTING = 'expectedValue_respectPricingMode';

/**
 * Value one special currency at its best tradeable redemption across the special-currency shops.
 * Dungeon tokens reuse `calculateDungeonTokenValue` (outlier clamping + essence fallback); every
 * other currency takes the highest (price × outputCount ÷ tokenCost) over its own shop entries -
 * the same shape as the dungeon-token formula, which omits outputCount only because every dungeon
 * shop entry yields a single output.
 * @param {string} currencyHrid - e.g. '/items/labyrinth_token'
 * @returns {{value: number, isOutlier: boolean}|null} Value per currency unit, or null
 */
function resolveCurrencyValue(currencyHrid) {
    if (DUNGEON_TOKEN_HRIDS.has(currencyHrid)) {
        return calculateDungeonTokenValue(currencyHrid, PRICING_MODE_SETTING, RESPECT_MODE_SETTING);
    }

    const mode = resolvePricingSide(PRICING_MODE_SETTING, RESPECT_MODE_SETTING);
    let bestValuePerToken = 0;
    let bestIsOutlier = false;

    for (const entry of getShopEntriesForCurrency(currencyHrid)) {
        const priceInfo = getItemPriceOutlierInfo(entry.itemHrid, { mode });
        const marketPrice = priceInfo.value || 0;
        if (marketPrice <= 0) continue;
        const valuePerToken = (marketPrice * (entry.outputCount || 1)) / entry.tokenCost;
        if (valuePerToken > bestValuePerToken) {
            bestValuePerToken = valuePerToken;
            bestIsOutlier = priceInfo.isOutlier;
        }
    }

    return bestValuePerToken > 0 ? { value: bestValuePerToken, isOutlier: bestIsOutlier } : null;
}

/**
 * Resolve an item's implied value through its official special-currency shop purchase. Returns
 * null (never a fake zero) when the item is not shop-purchased or its currency cannot be priced.
 * The implied value is not taxed - shop-redeemed items cannot be relisted on the market, mirroring
 * how the dungeon-token special case is treated upstream.
 * @param {string} itemHrid - e.g. '/items/seal_of_efficiency'
 * @returns {{value: number, isOutlier: boolean, currencyHrid: string, tokenCost: number, outputCount: number}|null}
 */
export function resolveShopRedemptionValue(itemHrid) {
    const purchase = findShopPurchaseInfo(itemHrid);
    if (!purchase) return null;

    const currencyValue = resolveCurrencyValue(purchase.currencyHrid);
    if (!currencyValue || !(currencyValue.value > 0)) return null;

    const outputCount = purchase.outputCount || 1;
    return {
        value: (currencyValue.value * purchase.tokenCost) / outputCount,
        isOutlier: currencyValue.isOutlier || false,
        currencyHrid: purchase.currencyHrid,
        tokenCost: purchase.tokenCost,
        outputCount,
    };
}
