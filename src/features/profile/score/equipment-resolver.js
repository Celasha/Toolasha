/**
 * Equipment Replacement Resolver (TLA-041 / TLA-041C / TLA-041E)
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
 * the pure arithmetic that turns that table into leg costs. Base acquisition and every crafting
 * material (including special-currency shop materials) go through the completeness-aware, per-
 * generation-memoized `score-acquisition-resolver.js` (TLA-041E) instead of the legacy number-only
 * `getProductionCost()`, so a missing required material can never silently become free.
 */

import { getItemPrice } from '../../../utils/market-data.js';
import { getCheapestProtectionPrice } from '../../enhancement/tooltip-enhancement.js';
import { findShopPurchaseInfo } from '../../../utils/special-currency-shop.js';
import { resolveItemAcquisitionCost, resolvePerAttemptMaterialCost } from './score-acquisition-resolver.js';
import { getScoreEnhancementExpectationTable } from './score-enhancement-worker.js';
import { priceLegFromTable, buildTargetCostLadder, applyMirrorOptimization } from './score-enhancement-pricing.js';

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
 * @param {{acquisitionCache: Map, opportunityCache: Map, resolving: Set}} context - one shared,
 *   per-Score-generation acquisition context from `createAcquisitionContext()` (TLA-041E)
 * @returns {Promise<{cost: number|null, complete: boolean, reason?: string}>}
 */
export async function resolveEquipmentItemCost(itemHrid, N, itemDetails, enhancingParams, context) {
    if (N === 0) {
        return resolveItemAcquisitionCost(itemHrid, context);
    }

    const isTokenItem = findShopPurchaseInfo(itemHrid) !== null;

    // Phase 1 (cheap, synchronous, no enhancement math): exact Ask, live lower-K Asks, base
    // acquisition price.
    const exactAsk = getItemPrice(itemHrid, { enhancementLevel: N, mode: 'ask' });
    const base = resolveItemAcquisitionCost(itemHrid, context);
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

        const { cost: perAttemptMaterialCost, complete: materialCostKnown } = resolvePerAttemptMaterialCost(
            itemDetails,
            context
        );

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
