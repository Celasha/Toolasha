/**
 * Guild Credit Conversion
 * Guild Credits (brown/white/red/silver/etc.) are non-tradeable currencies with no
 * direct market price. Their only gold-equivalent value comes from the cheapest
 * tradeable item that converts into them via item.guildCreditConversions.
 */

import { getItemPrice } from './market-data.js';

/**
 * Build cheapest-gold-per-credit maps for both sell and buy sides.
 * @param {Object} itemDetailMap
 * @param {string[]} [excludeHrids=[]] - Source item hrids to skip (e.g. Guild Token itself, which
 *   carries its own guildCreditConversions and would otherwise create a circular credit value —
 *   TLA-041).
 * @returns {{ sell: Object, buy: Object }} Map of creditItemHrid -> cheapest gold cost per credit
 */
export function buildCheapestPerCredit(itemDetailMap, excludeHrids = []) {
    const sell = {};
    const buy = {};
    for (const [hrid, item] of Object.entries(itemDetailMap)) {
        if (excludeHrids.includes(hrid)) continue;
        for (const conv of item.guildCreditConversions || []) {
            const creditHrid = conv.creditItemHrid;
            const sellPrice = getItemPrice(hrid, { mode: 'ask' });
            const buyPrice = getItemPrice(hrid, { mode: 'bid' });
            if (sellPrice > 0) {
                const gpc = (sellPrice * conv.itemCount) / conv.creditCount;
                if (!sell[creditHrid] || gpc < sell[creditHrid]) sell[creditHrid] = gpc;
            }
            if (buyPrice > 0) {
                const gpc = (buyPrice * conv.itemCount) / conv.creditCount;
                if (!buy[creditHrid] || gpc < buy[creditHrid]) buy[creditHrid] = gpc;
            }
        }
    }
    return { sell, buy };
}
