/**
 * Optimal Bankroll Share
 *
 * Second-order (mean-variance) Kelly approximation for how much of the current bankroll is safe
 * to commit to a batch of actionCount i.i.d. risky actions (dungeon chests, alchemy Transmute),
 * reusing the per-action net-value outcome distribution the Risk of Ruin adapters already build.
 *
 * This is a quick closed-form estimate, not a substitute for the Monte Carlo ruin probability
 * elsewhere in the panel — the quadratic approximation can overstate the safe size for skewed,
 * fat-tailed payout distributions (the same class of distribution risk-of-ruin-engine.js's own
 * Lundberg bound is careful to caveat). Not meaningful for enhancement: that activity has no
 * revenue distribution to size a bet against, only a pure cost sink toward a fixed goal — callers
 * should skip this module for that mode and rely on the ruin probability alone.
 */

/**
 * Mean and variance of the per-action gross return multiple R = 1 + net/costPerAction, derived
 * from a discrete outcome distribution of { prob, net } entries (net = revenue after tax, minus
 * cost — already computed by the chest/alchemy risk-of-ruin adapters).
 * @param {Array<{prob: number, net: number}>} outcomeDistribution
 * @param {number} costPerAction
 * @returns {{meanR: number, varianceR: number}}
 */
export function calculateReturnStats(outcomeDistribution, costPerAction) {
    if (!(costPerAction > 0) || !outcomeDistribution?.length) {
        return { meanR: 0, varianceR: 0 };
    }

    const rValues = outcomeDistribution.map((o) => ({ prob: o.prob, r: 1 + o.net / costPerAction }));
    const meanR = rValues.reduce((sum, o) => sum + o.prob * o.r, 0);
    const varianceR = rValues.reduce((sum, o) => sum + o.prob * (o.r - meanR) ** 2, 0);
    return { meanR, varianceR };
}

/**
 * Second-order Kelly approximation: fraction of bankroll optimal to allocate across actionCount
 * i.i.d. actions, given the batch's aggregate return statistics. Clamped to [0, 1] — a
 * non-positive edge recommends committing nothing, and this never recommends more than the full
 * bankroll (no leverage).
 * @param {Object} params
 * @param {number} params.actionCount
 * @param {number} params.meanR
 * @param {number} params.varianceR
 * @returns {number} fstar, in [0, 1]
 */
export function calculateOptimalBankrollFraction({ actionCount, meanR, varianceR }) {
    if (!(varianceR > 0) || !(actionCount > 0) || meanR <= 1) return 0;
    const fstar = (actionCount * (meanR - 1)) / varianceR;
    return Math.min(1, Math.max(0, fstar));
}

/**
 * Combines the above into the figures a UI displays: the safe bankroll fraction/amount for the
 * chosen batch size, and whether the activity has positive edge at all.
 * @param {Object} params
 * @param {Array<{prob: number, net: number}>} params.outcomeDistribution
 * @param {number} params.costPerAction
 * @param {number} params.actionCount
 * @param {number} params.bankroll
 * @returns {{
 *   meanR: number,
 *   varianceR: number,
 *   fstar: number,
 *   recommendedCommit: number,
 *   recommendedActionCount: number,
 *   hasEdge: boolean,
 * }}
 */
export function calculateOptimalCommit({ outcomeDistribution, costPerAction, actionCount, bankroll }) {
    const { meanR, varianceR } = calculateReturnStats(outcomeDistribution, costPerAction);
    const fstar = calculateOptimalBankrollFraction({ actionCount, meanR, varianceR });
    const recommendedCommit = fstar * (bankroll || 0);
    const recommendedActionCount = costPerAction > 0 ? Math.floor(recommendedCommit / costPerAction) : 0;

    return {
        meanR,
        varianceR,
        fstar,
        recommendedCommit,
        recommendedActionCount,
        hasEdge: meanR > 1,
    };
}
