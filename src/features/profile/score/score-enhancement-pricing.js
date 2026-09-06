/**
 * Score Enhancement Pricing (TLA-041C)
 *
 * Pure arithmetic that turns one resolved expectation table (from
 * `enhancement-expectation-kernel.js` / `score-enhancement-worker.js`) plus current market
 * prices into enhancement leg costs - kept separate from `equipment-resolver.js` so the Mirror
 * recursion has one home and is independently unit-testable. Never touches the network/DOM/market
 * modules directly; callers pass in already-resolved unit prices.
 */

/**
 * Price a direct `startLevel -> targetLevel` enhancement leg from a resolved expectation table,
 * picking the cheapest protection strategy - mirrors the semantics of the existing
 * `tooltip-enhancement.js#calculateDirectEnhancementCost` exactly (a strategy that needs
 * protection but has no priced protection item is unusable, not zero-substituted).
 * @param {{targets: Array}} table
 * @param {number} targetLevel
 * @param {number} startLevel
 * @param {number} perAttemptMaterialCost - Cost of one enhancement attempt's consumed materials
 * @param {number|null} protectionUnitPrice - Cheapest priced protection item, or null/0 if none
 * @returns {{cost: number|null, complete: boolean}}
 */
export function priceLegFromTable(table, targetLevel, startLevel, perAttemptMaterialCost, protectionUnitPrice) {
    if (!Number.isFinite(perAttemptMaterialCost) || perAttemptMaterialCost < 0) return { cost: null, complete: false };

    const strategies = table?.targets?.[targetLevel];
    if (!strategies?.length) return { cost: null, complete: false };

    let best = null;
    for (const strategy of strategies) {
        const attempts = strategy.attemptsByStart[startLevel];
        if (!Number.isFinite(attempts)) continue;

        let cost = perAttemptMaterialCost * attempts;
        if (strategy.protectFrom > 0) {
            const protections = strategy.protectionsByStart[startLevel];
            if (protections > 0) {
                if (!(protectionUnitPrice > 0)) continue; // protection needed but unpriceable
                cost += protectionUnitPrice * protections;
            }
        }

        if (best === null || cost < best) best = cost;
    }

    return best === null ? { cost: null, complete: false } : { cost: best, complete: true };
}

/**
 * Build the `0..maxLevel` "cost to reach this level from scratch" ladder for one item, the same
 * shape `tooltip-enhancement.js#calculateEnhancementPath`'s `targetCosts` array has, but every
 * entry is a cheap table lookup instead of an independent matrix inversion. `costs[0]` is the base
 * acquisition cost; a `null` entry means that level could not be priced completely (base
 * unpriceable, or every protection strategy needing protection has no priced protection item).
 * @param {{targets: Array}} table
 * @param {number} maxLevel
 * @param {number|null} baseCost
 * @param {number} perAttemptMaterialCost
 * @param {number|null} protectionUnitPrice
 * @returns {Array<number|null>} length `maxLevel + 1`
 */
export function buildTargetCostLadder(table, maxLevel, baseCost, perAttemptMaterialCost, protectionUnitPrice) {
    const costs = new Array(maxLevel + 1).fill(null);
    if (!Number.isFinite(baseCost) || baseCost < 0) return costs;

    costs[0] = baseCost;
    for (let level = 1; level <= maxLevel; level++) {
        const leg = priceLegFromTable(table, level, 0, perAttemptMaterialCost, protectionUnitPrice);
        costs[level] = leg.complete ? baseCost + leg.cost : null;
    }
    return costs;
}

/**
 * Apply the same single-pass Philosopher's Mirror optimization as
 * `tooltip-enhancement.js#calculateEnhancementPath` (lines ~123-138), ported verbatim since it's
 * already-correct cheap arithmetic once a cost ladder exists: for every level `>= 3`, compare the
 * traditional cost against consuming a mirror-tier of lower/upper-tier items (already possibly
 * mirror-discounted themselves) plus one Philosopher's Mirror, keeping whichever is cheaper. A
 * `null` ladder entry (unpriceable at that level, or an unpriceable neighbor) is left untouched -
 * Mirror can only ever make a price cheaper, never rescue an incomplete one.
 * @param {Array<number|null>} costs - `0..maxLevel` cost ladder from `buildTargetCostLadder`
 * @param {number|null} mirrorPrice - Ask price of one Philosopher's Mirror, or null/0 if unpriced
 * @returns {Array<number|null>} a new ladder, mirror-optimized where cheaper
 */
export function applyMirrorOptimization(costs, mirrorPrice) {
    const optimized = [...costs];
    if (!(mirrorPrice > 0)) return optimized;

    for (let level = 3; level < optimized.length; level++) {
        if (optimized[level] === null) continue;
        const lower = optimized[level - 2];
        const upper = optimized[level - 1];
        if (lower === null || upper === null) continue;

        const mirrorCost = lower + upper + mirrorPrice;
        if (mirrorCost < optimized[level]) {
            optimized[level] = mirrorCost;
        }
    }

    return optimized;
}
