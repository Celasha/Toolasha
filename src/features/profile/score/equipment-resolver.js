/**
 * Equipment Replacement Resolver (TLA-041 / TLA-041C)
 *
 * For a viewed `Item +N`, computes the cheapest COMPLETE reproduction candidate using the
 * viewer's own current/manual Enhancing setup:
 *   (a) exact positive Ask for Item +N;
 *   (b) base-item acquisition + viewer-relative 0->N reconstruction (Mirror-aware for ordinary
 *       tradeable items; token items use a direct, non-mirror 0->N path on top of their real
 *       token-opportunity base value instead - see below);
 *   (c) for every actual live lower-enhancement Ask +K (0 < K < N): Ask(+K) + direct
 *       viewer-relative K->N enhancement (never a 0-based subtraction shortcut).
 * The minimum among candidates that price COMPLETELY wins. Zero complete candidates -> the item
 * is `{cost: null, complete: false}`; missing some candidates is not global failure as long as at
 * least one full candidate prices.
 *
 * (b) and (c) share one cached, off-main-thread enhancement expectation table per
 * itemLevel/viewer-params combination (`score-enhancement-worker.js`) instead of each performing
 * its own synchronous Markov matrix inversion (TLA-041C) - see `score-enhancement-pricing.js` for
 * the pure arithmetic that turns that table into leg costs.
 */

import dataManager from '../../../core/data-manager.js';
import { getItemPrice } from '../../../utils/market-data.js';
import { getShopCoinCost } from '../../../utils/game-lookups.js';
import {
    getProductionCost,
    calculatePerAttemptMaterialCost,
    getCheapestProtectionPrice,
} from '../../enhancement/tooltip-enhancement.js';
import { getScoreEnhancementExpectationTable } from './score-enhancement-worker.js';
import { priceLegFromTable, buildTargetCostLadder, applyMirrorOptimization } from './score-enhancement-pricing.js';

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
 * Resolve the cheapest complete reproduction cost for a viewed equipped item at enhancement +N.
 *
 * `async` because a complete reproduction may need one shared, cached, off-main-thread enhancement
 * expectation table (`score-enhancement-worker.js`) - the exact same Markov statistics the
 * canonical enhancement calculator produces, but solved once for every start level/target/strategy
 * combination instead of once per protection strategy per target level (TLA-041C). Exact pruning
 * (report §3.5 / PSP-14): once a known-complete candidate exists, any acquisition-origin candidate
 * whose own live Ask is already >= that candidate can never win (enhancement cost is non-negative),
 * so its enhancement math - and the shared table request itself - is skipped entirely.
 * @param {string} itemHrid
 * @param {number} N - Enhancement level (0-20)
 * @param {Object} itemDetails - gameData.itemDetailMap[itemHrid]
 * @param {Object} enhancingParams - Viewer's own params from getEnhancingParams()
 * @returns {Promise<{cost: number|null, complete: boolean, reason?: string}>}
 */
export async function resolveEquipmentItemCost(itemHrid, N, itemDetails, enhancingParams) {
    if (N === 0) {
        return resolveBaseItemCost(itemHrid);
    }

    const isTokenItem = getTokenPurchaseInfo(itemHrid) !== null;

    // Phase 1 (cheap, synchronous, no enhancement math): exact Ask, live lower-K Asks, base
    // acquisition price.
    const exactAsk = getItemPrice(itemHrid, { enhancementLevel: N, mode: 'ask' });
    const base = resolveBaseItemCost(itemHrid);
    const lowerAsks = [];
    if (itemDetails?.enhancementCosts?.length) {
        for (let K = 1; K < N; K++) {
            const kAsk = getItemPrice(itemHrid, { enhancementLevel: K, mode: 'ask' });
            if (kAsk > 0) lowerAsks.push({ K, ask: kAsk });
        }
    }

    const candidates = [];
    if (exactAsk > 0) candidates.push(exactAsk);
    const best = exactAsk > 0 ? exactAsk : Infinity;

    // Phase 2: exact pruning.
    const needsReconstruction = !(base.complete && base.cost >= best);
    const survivingLowerAsks = lowerAsks.filter(({ ask }) => ask < best);

    if (needsReconstruction || survivingLowerAsks.length > 0) {
        // Phase 3: only request the shared expectation table if something enhancement-dependent
        // survived pruning.
        let table = null;
        try {
            table = await getScoreEnhancementExpectationTable({
                enhancingLevel: enhancingParams.enhancingLevel,
                toolBonus: enhancingParams.toolBonus || 0,
                itemLevel: itemDetails?.itemLevel || 1,
                blessedTea: enhancingParams.teas?.blessed || false,
                guzzlingBonus: enhancingParams.guzzlingBonus || 1,
            });
        } catch (error) {
            // Worker failure fails closed for every enhancement-dependent candidate below - never a
            // synchronous fallback to the heavy legacy path.
            console.error('[EquipmentResolver] Enhancement expectation table request failed:', error);
        }

        const { cost: perAttemptMaterialCost, hasCost, costPartial } = calculatePerAttemptMaterialCost(itemDetails);
        const materialCostKnown = hasCost && !costPartial;

        if (table && materialCostKnown) {
            const { price: protectionUnitPrice } = getCheapestProtectionPrice(itemHrid);

            if (needsReconstruction && base.complete) {
                if (isTokenItem) {
                    // Token items skip Mirror entirely - their real value is in the token
                    // opportunity base, not a mirror-tier consumption chain (matches the existing
                    // direct-only token behavior, F-09).
                    const leg = priceLegFromTable(table, N, 0, perAttemptMaterialCost, protectionUnitPrice);
                    if (leg.complete) candidates.push(base.cost + leg.cost);
                } else {
                    // Never getRealisticBaseItemPrice() here - it mixes Bid data; the Score
                    // contract is Ask/acquisition-only (report's pricing guard).
                    const mirrorPrice = getItemPrice('/items/philosophers_mirror', { mode: 'ask' });
                    const ladder = buildTargetCostLadder(
                        table,
                        N,
                        base.cost,
                        perAttemptMaterialCost,
                        protectionUnitPrice
                    );
                    const optimized = applyMirrorOptimization(ladder, mirrorPrice);
                    if (optimized[N] !== null) candidates.push(optimized[N]);
                }
            }

            for (const { K, ask } of survivingLowerAsks) {
                const leg = priceLegFromTable(table, N, K, perAttemptMaterialCost, protectionUnitPrice);
                if (leg.complete) candidates.push(ask + leg.cost);
            }
        }
    }

    if (candidates.length === 0) {
        return { cost: null, complete: false, reason: 'No complete acquisition route could be priced' };
    }
    return { cost: Math.min(...candidates), complete: true };
}
