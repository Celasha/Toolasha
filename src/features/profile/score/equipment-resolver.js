/**
 * Equipment Replacement Resolver (TLA-041)
 *
 * For a viewed `Item +N`, computes the cheapest COMPLETE reproduction candidate using the
 * viewer's own current/manual Enhancing setup:
 *   (a) exact positive Ask for Item +N;
 *   (b) base-item acquisition + viewer-relative 0->N reconstruction (Mirror-aware where the
 *       shared enhancement-tooltip machinery applies; token items use a direct, non-mirror
 *       0->N path on top of their real token-opportunity base value instead - see below);
 *   (c) for every actual live lower-enhancement Ask +K (0 < K < N): Ask(+K) + direct
 *       viewer-relative K->N enhancement (never a 0-based subtraction shortcut).
 * The minimum among candidates that price COMPLETELY wins. Zero complete candidates -> the item
 * is `{cost: null, complete: false}`; missing some candidates is not global failure as long as at
 * least one full candidate prices.
 */

import dataManager from '../../../core/data-manager.js';
import { getItemPrice } from '../../../utils/market-data.js';
import { getShopCoinCost } from '../../../utils/game-lookups.js';
import {
    getProductionCost,
    calculateEnhancementPath,
    calculateDirectEnhancementCost,
} from '../../enhancement/tooltip-enhancement.js';

/**
 * Untradeable dungeon-shop back-slot items. Each item's own token PURCHASE COST is read
 * generically from `shopItemDetailMap` (PB-35) via `getTokenPurchaseInfo`; the list of
 * alternative token-shop items used to derive the best foregone value per token is kept as data
 * (discovering that set generically is out of scope for this ticket).
 */
const TOKEN_SHOP_ALTERNATIVES = {
    '/items/chimerical_quiver': [
        { hrid: '/items/griffin_leather', cost: 600 },
        { hrid: '/items/manticore_sting', cost: 1000 },
        { hrid: '/items/jackalope_antler', cost: 1200 },
        { hrid: '/items/dodocamel_plume', cost: 3000 },
        { hrid: '/items/griffin_talon', cost: 3000 },
    ],
    '/items/sinister_cape': [
        { hrid: '/items/acrobats_ribbon', cost: 2000 },
        { hrid: '/items/magicians_cloth', cost: 2000 },
        { hrid: '/items/chaotic_chain', cost: 3000 },
        { hrid: '/items/cursed_ball', cost: 3000 },
    ],
    '/items/enchanted_cloak': [
        { hrid: '/items/royal_cloth', cost: 2000 },
        { hrid: '/items/knights_ingot', cost: 2000 },
        { hrid: '/items/bishops_scroll', cost: 2000 },
        { hrid: '/items/regal_jewel', cost: 3000 },
        { hrid: '/items/sundering_jewel', cost: 3000 },
    ],
};

/**
 * @param {string} itemHrid
 * @returns {{tokenItemHrid: string, tokenCost: number}|null} null if not a token-shop-purchased item
 */
function getTokenPurchaseInfo(itemHrid) {
    const gameData = dataManager.getInitClientData();
    const shopItem = Object.values(gameData?.shopItemDetailMap || {}).find((s) => s.itemHrid === itemHrid);
    const cost = shopItem?.costs?.[0];
    if (!cost || cost.itemHrid === '/items/coin') return null;
    return { tokenItemHrid: cost.itemHrid, tokenCost: cost.count };
}

/**
 * Opportunity-equivalent value of a token-purchased item's base acquisition: best foregone
 * alternative use of the same tokens, times the item's own token cost.
 * @param {string} itemHrid
 * @returns {{cost: number|null, complete: boolean}}
 */
function calculateTokenOpportunityValue(itemHrid) {
    const purchaseInfo = getTokenPurchaseInfo(itemHrid);
    const alternatives = TOKEN_SHOP_ALTERNATIVES[itemHrid];
    if (!purchaseInfo || !alternatives) return { cost: null, complete: false };

    let bestValuePerToken = 0;
    for (const alt of alternatives) {
        const ask = getItemPrice(alt.hrid, { mode: 'ask' });
        if (ask > 0) {
            const perToken = ask / alt.cost;
            if (perToken > bestValuePerToken) bestValuePerToken = perToken;
        }
    }
    if (!(bestValuePerToken > 0)) return { cost: null, complete: false };
    return { cost: bestValuePerToken * purchaseInfo.tokenCost, complete: true };
}

/**
 * Cheapest defensible base (+0) acquisition cost: direct comparison across every proven source,
 * never an inflated-Ask heuristic (TLA-041 base-item resolver rule: "If Ask=2.5B and a complete
 * reproduction path is 650M, use 650M").
 * @param {string} itemHrid
 * @returns {{cost: number|null, complete: boolean}}
 */
function resolveBaseItemCost(itemHrid) {
    const candidates = [];

    const tokenValue = calculateTokenOpportunityValue(itemHrid);
    if (tokenValue.complete) candidates.push(tokenValue.cost);

    const ask = getItemPrice(itemHrid, { mode: 'ask' });
    if (ask > 0) candidates.push(ask);

    const shopCost = getShopCoinCost(itemHrid);
    if (shopCost > 0) candidates.push(shopCost);

    const craftCost = getProductionCost(itemHrid, 'ask');
    if (craftCost > 0) candidates.push(craftCost);

    if (candidates.length === 0) return { cost: null, complete: false };
    return { cost: Math.min(...candidates), complete: true };
}

/**
 * Candidate (b): base acquisition + viewer-relative 0->N reconstruction.
 *
 * For ordinary tradeable items, prefers the shared Mirror-aware `calculateEnhancementPath` (its
 * own base-price heuristic is existing, shared, Net-Worth-tested logic - left untouched) but also
 * compares against our own min-based base cost + a direct (non-mirror) 0->N path, taking whichever
 * is cheaper.
 *
 * For token items, `calculateEnhancementPath`'s internal base pricing has no concept of token
 * opportunity value and would price the base leg near zero - using it would silently reintroduce
 * the F-09 bug. Token items therefore use ONLY the direct (non-mirror) path on top of the correct
 * token-opportunity base value.
 * @returns {{cost: number|null, complete: boolean}}
 */
function resolveBaseReconstructionCost(itemHrid, targetLevel, enhancingParams, isTokenItem) {
    const candidates = [];

    if (!isTokenItem) {
        try {
            const path = calculateEnhancementPath(itemHrid, targetLevel, enhancingParams);
            if (path?.optimalStrategy?.totalCost > 0) candidates.push(path.optimalStrategy.totalCost);
        } catch {
            // Not enhanceable via the shared path helper - fall through to the direct route below.
        }
    }

    const base = resolveBaseItemCost(itemHrid);
    if (base.complete) {
        const direct = calculateDirectEnhancementCost(itemHrid, 0, targetLevel, enhancingParams);
        if (direct.complete) candidates.push(base.cost + direct.cost);
    }

    if (candidates.length === 0) return { cost: null, complete: false };
    return { cost: Math.min(...candidates), complete: true };
}

/**
 * Resolve the cheapest complete reproduction cost for a viewed equipped item at enhancement +N.
 * @param {string} itemHrid
 * @param {number} N - Enhancement level (0-20)
 * @param {Object} itemDetails - gameData.itemDetailMap[itemHrid]
 * @param {Object} enhancingParams - Viewer's own params from getEnhancingParams()
 * @returns {{cost: number|null, complete: boolean}}
 */
export function resolveEquipmentItemCost(itemHrid, N, itemDetails, enhancingParams) {
    if (N === 0) {
        return resolveBaseItemCost(itemHrid);
    }

    const isTokenItem = getTokenPurchaseInfo(itemHrid) !== null;
    const candidates = [];

    const exactAsk = getItemPrice(itemHrid, { enhancementLevel: N, mode: 'ask' });
    if (exactAsk > 0) candidates.push(exactAsk);

    const reconstruction = resolveBaseReconstructionCost(itemHrid, N, enhancingParams, isTokenItem);
    if (reconstruction.complete) candidates.push(reconstruction.cost);

    if (itemDetails?.enhancementCosts?.length) {
        for (let K = 1; K < N; K++) {
            const kAsk = getItemPrice(itemHrid, { enhancementLevel: K, mode: 'ask' });
            if (!(kAsk > 0)) continue;
            const direct = calculateDirectEnhancementCost(itemHrid, K, N, enhancingParams);
            if (direct.complete) candidates.push(kAsk + direct.cost);
        }
    }

    if (candidates.length === 0) return { cost: null, complete: false };
    return { cost: Math.min(...candidates), complete: true };
}
