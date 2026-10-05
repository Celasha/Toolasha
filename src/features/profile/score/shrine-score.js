/**
 * Guild Shrine / Credit / Token Valuation (TLA-041)
 *
 * Prices the viewed character's personally purchased Shrine buff levels
 * (`profile.profile.guildBuffLevelMap`), splitting Combat/Skiller via `guildBuffDetail.isCombat`.
 * Guild Credits are priced via the cheapest Ask-side tradeable conversion, excluding Guild Token
 * itself as a source item to avoid a circular value (real risk: `/items/guild_token` carries its
 * own `guildCreditConversions`). Guild Token's own coin-equivalent value is the MAXIMUM foregone
 * native Token->Credit alternative (F-12), not the minimum — see
 * `calculateGuildTokenOpportunityValue` in utils/guild-credit-conversion.js, shared with the
 * Guild Credit exchange modal and Guild Token tooltip.
 */

import dataManager from '../../../core/data-manager.js';
import {
    buildCheapestPerCredit,
    buildGuildTokenValueByCredit,
    GUILD_TOKEN_HRID,
} from '../../../utils/guild-credit-conversion.js';
import { buildGuildBuffDisplayName } from '../../networth/networth-calculator.js';
import { emptyCategory, attribute } from './score-result.js';

/**
 * Sum a buff's `levelCosts[1..level]` using the resolved credit/token coin values.
 * @returns {{cost: number, complete: boolean, tokenCount: number, isOutlier: boolean}}
 */
function sumLevelCosts(buff, level, creditValueTable, creditOutlierTable, tokenValue, tokenIsOutlier) {
    let cost = 0;
    let complete = true;
    let tokenCount = 0;
    let isOutlier = false;

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
            if (creditOutlierTable?.[itemHrid]) isOutlier = true;
            cost += perCredit * count;
        }

        if (levelCost.guildTokenCost > 0) {
            tokenCount += levelCost.guildTokenCost; // natural units, preserved regardless of pricing (PB-44)
            if (!(tokenValue > 0)) {
                complete = false;
            } else {
                if (tokenIsOutlier) isOutlier = true;
                cost += tokenValue * levelCost.guildTokenCost;
            }
        }
    }

    return { cost, complete, tokenCount, isOutlier };
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

    const { sell: creditValueTable, sellOutlier: creditOutlierTable } = buildCheapestPerCredit(itemDetailMap, [
        GUILD_TOKEN_HRID,
    ]);
    const bestTokenRow = buildGuildTokenValueByCredit(itemDetailMap, creditValueTable, creditOutlierTable)[0];
    const tokenValue = bestTokenRow?.goldPerToken || 0;
    const tokenIsOutlier = bestTokenRow?.isOutlier || false;

    const combat = emptyCategory();
    const skiller = emptyCategory();

    for (const [buffHrid, buff] of Object.entries(guildBuffDetailMap)) {
        const level = guildBuffLevelMap[buffHrid] || 0;
        if (level === 0) continue;

        const { cost, complete, tokenCount, isOutlier } = sumLevelCosts(
            buff,
            level,
            creditValueTable,
            creditOutlierTable,
            tokenValue,
            tokenIsOutlier
        );
        const category = buff.isCombat ? combat : skiller;
        // Natural Guild Token count is preserved in the breakdown label even though the numeric
        // Score uses the coin-equivalent opportunity value (PB-44).
        const tokenSuffix = tokenCount > 0 ? ` (${tokenCount.toLocaleString()} tokens)` : '';
        attribute(category, {
            name: `${buildGuildBuffDisplayName(buffHrid, buff)} ${level}${tokenSuffix}`,
            cost,
            complete,
            isOutlier,
        });
    }

    return { combat, skiller };
}
