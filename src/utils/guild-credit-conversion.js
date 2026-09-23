/**
 * Guild Credit Conversion
 * Guild Credits (brown/white/red/silver/etc.) are non-tradeable currencies with no
 * direct market price. Their only gold-equivalent value comes from the cheapest
 * tradeable item that converts into them via item.guildCreditConversions.
 */

import { getItemPrice } from './market-data.js';

export const GUILD_TOKEN_HRID = '/items/guild_token';

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

/**
 * Guild Token's coin-equivalent value broken out per credit type it converts to, using the
 * cheapest per-credit value for each credit type (from buildCheapestPerCredit's sell or buy
 * map). Sorted best (highest goldPerToken) first, so callers wanting the single best figure
 * can just take index 0.
 * @param {Object} itemDetailMap
 * @param {Object} creditValueTable - creditItemHrid -> coin value per credit
 * @returns {Array<{creditItemHrid: string, itemCount: number, creditCount: number, goldPerToken: number}>}
 */
export function buildGuildTokenValueByCredit(itemDetailMap, creditValueTable) {
    const tokenItem = itemDetailMap[GUILD_TOKEN_HRID];
    const rows = [];
    for (const conv of tokenItem?.guildCreditConversions || []) {
        const creditValue = creditValueTable[conv.creditItemHrid];
        if (!(creditValue > 0)) continue;
        rows.push({
            creditItemHrid: conv.creditItemHrid,
            itemCount: conv.itemCount,
            creditCount: conv.creditCount,
            goldPerToken: (conv.creditCount / conv.itemCount) * creditValue,
        });
    }
    return rows.sort((a, b) => b.goldPerToken - a.goldPerToken);
}

/**
 * @param {Object} itemDetailMap
 * @param {Object} creditValueTable - creditItemHrid -> coin value per credit
 * @returns {number} coin value per Guild Token (0 if unresolved) — the MAXIMUM foregone
 * native Token->Credit alternative (F-12), not the minimum.
 */
export function calculateGuildTokenOpportunityValue(itemDetailMap, creditValueTable) {
    return buildGuildTokenValueByCredit(itemDetailMap, creditValueTable)[0]?.goldPerToken || 0;
}
