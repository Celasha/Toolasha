/**
 * Shop Token Values logic
 * Per-token value of one special-currency shop entry, and which entry is best for its currency.
 */

import { getAllSpecialCurrencyShopEntries } from '../../utils/special-currency-shop.js';
import { getItemPriceOutlierInfo } from '../../utils/market-data.js';
import { resolvePricingSide } from '../../utils/token-valuation.js';
import { getCapeBaseValue, isUntradableCape } from '../../utils/untradable-cape.js';

const PRICING_MODE_SETTING = 'profitCalc_pricingMode';
const RESPECT_MODE_SETTING = 'expectedValue_respectPricingMode';

/**
 * Value per currency unit of one shop entry: market price × outputCount ÷ tokenCost, on the same
 * price side as the profit settings. Untradable capes have no market price, so they use the cape
 * base value setting and are flagged `isAssumed`; those are display-only and never win "best".
 * @param {{itemHrid: string, tokenCost: number, outputCount: number}} entry
 * @returns {{perToken: number, isAssumed: boolean, assumedValue: number, isOutlier: boolean}|null}
 *   null when the item has no price and is not an untradable cape
 */
export function getShopRowValue(entry) {
    const outputCount = entry.outputCount || 1;

    if (isUntradableCape(entry.itemHrid)) {
        const assumedValue = getCapeBaseValue();
        return {
            perToken: assumedValue > 0 ? (assumedValue * outputCount) / entry.tokenCost : 0,
            isAssumed: true,
            assumedValue,
            isOutlier: false,
        };
    }

    const mode = resolvePricingSide(PRICING_MODE_SETTING, RESPECT_MODE_SETTING);
    const priceInfo = getItemPriceOutlierInfo(entry.itemHrid, { mode });
    if (!(priceInfo.value > 0)) {
        return null;
    }
    return {
        perToken: (priceInfo.value * outputCount) / entry.tokenCost,
        isAssumed: false,
        assumedValue: 0,
        isOutlier: Boolean(priceInfo.isOutlier),
    };
}

/**
 * Item HRID of the best-value entry (highest real per-token value) for every currency in the
 * given set. Computed over every entry of the currency, not just the tiles on screen.
 * @param {Set<string>|null} currencyHrids - Currencies to evaluate, or null for all
 * @returns {Map<string, string>} currencyHrid -> itemHrid of its best entry
 */
export function getBestEntryByCurrency(currencyHrids = null) {
    const best = new Map();
    const bestValue = new Map();
    for (const entry of getAllSpecialCurrencyShopEntries()) {
        if (currencyHrids && !currencyHrids.has(entry.currencyHrid)) {
            continue;
        }
        const row = getShopRowValue(entry);
        if (!row || row.isAssumed || !(row.perToken > 0)) {
            continue;
        }
        if (row.perToken > (bestValue.get(entry.currencyHrid) || 0)) {
            bestValue.set(entry.currencyHrid, row.perToken);
            best.set(entry.currencyHrid, entry.itemHrid);
        }
    }
    return best;
}
