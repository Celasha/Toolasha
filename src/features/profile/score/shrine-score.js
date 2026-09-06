/**
 * Guild Shrine / Credit / Token Valuation (TLA-041)
 *
 * Prices the viewed character's personally purchased Shrine buff levels
 * (`profile.profile.guildBuffLevelMap`), splitting Combat/Skiller via `guildBuffDetail.isCombat`.
 * Guild Credits are priced via the cheapest Ask-side tradeable conversion, excluding Guild Token
 * itself as a source item to avoid a circular value (real risk: `/items/guild_token` carries its
 * own `guildCreditConversions`). Guild Token's own coin-equivalent value is the MAXIMUM foregone
 * native Token->Credit alternative (F-12), not the minimum.
 */

import dataManager from '../../../core/data-manager.js';
import { buildCheapestPerCredit } from '../../../utils/guild-credit-conversion.js';
import { buildGuildBuffDisplayName } from '../../networth/networth-calculator.js';
import { emptyCategory, attribute } from './score-result.js';

const GUILD_TOKEN_HRID = '/items/guild_token';

/**
 * @param {Object} itemDetailMap
 * @param {Object} creditValueTable - creditItemHrid -> coin value per credit
 * @returns {number} coin value per Guild Token (0 if unresolved)
 */
function calculateGuildTokenOpportunityValue(itemDetailMap, creditValueTable) {
    const tokenItem = itemDetailMap[GUILD_TOKEN_HRID];
    let best = 0;
    for (const conv of tokenItem?.guildCreditConversions || []) {
        const creditValue = creditValueTable[conv.creditItemHrid];
        if (!(creditValue > 0)) continue;
        const perToken = (conv.creditCount / conv.itemCount) * creditValue;
        if (perToken > best) best = perToken;
    }
    return best;
}

/**
 * Sum a buff's `levelCosts[1..level]` using the resolved credit/token coin values.
 * @returns {{cost: number, complete: boolean, tokenCount: number}}
 */
function sumLevelCosts(buff, level, creditValueTable, tokenValue) {
    let cost = 0;
    let complete = true;
    let tokenCount = 0;

    for (let lvl = 1; lvl <= level; lvl++) {
        const levelCost = buff.levelCosts?.[String(lvl)];
        if (!levelCost) {
            complete = false;
            continue;
        }

        for (const { itemHrid, count } of levelCost.creditCosts || []) {
            const perCredit = creditValueTable[itemHrid];
            if (!(perCredit > 0)) {
                complete = false;
                continue;
            }
            cost += perCredit * count;
        }

        if (levelCost.guildTokenCost > 0) {
            tokenCount += levelCost.guildTokenCost; // natural units, preserved regardless of pricing (PB-44)
            if (!(tokenValue > 0)) {
                complete = false;
            } else {
                cost += tokenValue * levelCost.guildTokenCost;
            }
        }
    }

    return { cost, complete, tokenCount };
}

/**
 * @param {Object} profileData - Profile data from game (of the VIEWED character)
 * @returns {{combat: Object, skiller: Object}}
 */
export function calculateShrineScore(profileData) {
    const gameData = dataManager.getInitClientData();
    const guildBuffDetailMap = gameData?.guildBuffDetailMap || {};
    const itemDetailMap = gameData?.itemDetailMap || {};
    const guildBuffLevelMap = profileData.profile?.guildBuffLevelMap || {};

    const { sell: creditValueTable } = buildCheapestPerCredit(itemDetailMap, [GUILD_TOKEN_HRID]);
    const tokenValue = calculateGuildTokenOpportunityValue(itemDetailMap, creditValueTable);

    const combat = emptyCategory();
    const skiller = emptyCategory();

    for (const [buffHrid, buff] of Object.entries(guildBuffDetailMap)) {
        const level = guildBuffLevelMap[buffHrid] || 0;
        if (level === 0) continue;

        const { cost, complete, tokenCount } = sumLevelCosts(buff, level, creditValueTable, tokenValue);
        const category = buff.isCombat ? combat : skiller;
        // Natural Guild Token count is preserved in the breakdown label even though the numeric
        // Score uses the coin-equivalent opportunity value (PB-44).
        const tokenSuffix = tokenCount > 0 ? ` (${tokenCount.toLocaleString()} tokens)` : '';
        attribute(category, {
            name: `${buildGuildBuffDisplayName(buffHrid, buff)} ${level}${tokenSuffix}`,
            cost,
            complete,
        });
    }

    return { combat, skiller };
}
