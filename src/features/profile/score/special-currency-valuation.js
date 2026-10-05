/**
 * Special-Currency Valuation (TLA-041E)
 *
 * Generic, data-driven replacement for the old `TOKEN_SHOP_ALTERNATIVES` hardcoded three-item map in
 * `equipment-resolver.js`. Answers "what is one Task/Labyrinth/Dungeon token worth in gold?" using the
 * same economics `dungeon-token-tooltips.js` already applies (live Ask, expected-value for openable
 * Task Shop crates, official shop cost/`outputCount`), independently re-derived here as a pure,
 * unit-tested module so Profile Score can consume it without depending on that DOM-coupled tooltip
 * feature. Never uses a token-derived price as an input to that same token's own opportunity value
 * (report's anti-circularity rule) - every candidate below is sourced from live market Ask or the
 * existing expected-value calculator, never from this module's own output.
 *
 * Results are cached per acquisition context (see `score-acquisition-resolver.js`) so a Score
 * generation computes each currency's opportunity value, and each Task Shop openable's expected
 * value, at most once (TLA041E-28/29) no matter how many equipped items depend on it.
 */

import { getShopEntriesForCurrency, findShopPurchaseInfo } from '../../../utils/special-currency-shop.js';
import { getItemPriceOutlierInfo } from '../../../utils/market-data.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';

/**
 * Best independently-priceable native shop output value per unit of one special currency: the
 * maximum, across every official shop entry purchased with that currency, of
 * `(ask-or-EV * outputCount) / tokenCost`. Memoized on `context.opportunityCache`.
 * @param {string} currencyHrid
 * @param {{opportunityCache: Map}} context
 * @returns {{value: number|null, complete: boolean, isOutlier: boolean}}
 */
export function getCurrencyOpportunityValue(currencyHrid, context) {
    if (context.opportunityCache.has(currencyHrid)) return context.opportunityCache.get(currencyHrid);

    let bestValuePerUnit = 0;
    let bestIsOutlier = false;
    for (const entry of getShopEntriesForCurrency(currencyHrid)) {
        let itemValue = 0;
        let itemIsOutlier = false;

        const askInfo = getItemPriceOutlierInfo(entry.itemHrid, { mode: 'ask' });
        if (askInfo.value > 0) {
            itemValue = askInfo.value;
            itemIsOutlier = askInfo.isOutlier;
        }

        if (entry.isOpenable) {
            const evData = expectedValueCalculator.calculateExpectedValue(entry.itemHrid);
            if (evData?.expectedValue > itemValue) {
                itemValue = evData.expectedValue;
                itemIsOutlier = evData.hasOutlierPrices || false;
            }
        }

        if (!(itemValue > 0) || !(entry.tokenCost > 0)) continue;

        const valuePerUnit = (itemValue * entry.outputCount) / entry.tokenCost;
        if (valuePerUnit > bestValuePerUnit) {
            bestValuePerUnit = valuePerUnit;
            bestIsOutlier = itemIsOutlier;
        }
    }

    const result =
        bestValuePerUnit > 0
            ? { value: bestValuePerUnit, complete: true, isOutlier: bestIsOutlier }
            : { value: null, complete: false, isOutlier: false };
    context.opportunityCache.set(currencyHrid, result);
    return result;
}

/**
 * Coin-equivalent acquisition cost of one unit of `itemHrid`, if it is directly purchasable from an
 * official special-currency shop: `currency opportunity value * shop token cost / outputCount`.
 * @param {string} itemHrid
 * @param {{opportunityCache: Map}} context
 * @returns {{cost: number|null, complete: boolean, isOutlier: boolean}}
 */
export function getSpecialCurrencyAcquisitionCost(itemHrid, context) {
    const purchaseInfo = findShopPurchaseInfo(itemHrid);
    if (!purchaseInfo) return { cost: null, complete: false, isOutlier: false };

    const opportunity = getCurrencyOpportunityValue(purchaseInfo.currencyHrid, context);
    if (!opportunity.complete) return { cost: null, complete: false, isOutlier: false };

    return {
        cost: (opportunity.value * purchaseInfo.tokenCost) / purchaseInfo.outputCount,
        complete: true,
        isOutlier: opportunity.isOutlier,
    };
}
