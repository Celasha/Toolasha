/**
 * Alchemy Transmute Risk-of-Ruin Adapter
 *
 * Builds the exact per-attempt cost/payout model for a Transmute action, from
 * alchemyProfitCalculator.calculateTransmuteProfit() — the same per-attempt economics
 * (material cost net of self-return, catalyst cost, output drop-table EV, success rate) the
 * live action panel and best-item ranking already use, not a re-derived approximation.
 *
 * A real transmute's output drop table (itemDetails.alchemyDetail.transmuteDropTable) is a
 * MUTUALLY EXCLUSIVE categorical roll GIVEN success — its dropRates sum to exactly 1.0 (e.g.
 * Sunstone: 25% star fragment, 30% moonstone, 44.9% self-return, 0.1% philosopher's stone,
 * confirmed against the live game reference data). Collapsing that into one blended "average
 * success value" would discard exactly the variance a risk calculator needs — a 0.1% chance of
 * a huge hit is a very different risk shape than its smoothed mean — so every branch is kept as
 * its own separate outcome. Every transmutable item's drop table has at most a few (2-10 in
 * practice) branches, so the exact cross product with the independent essence/rare bonus-drop
 * layer (below) is always small; no sampling is needed here, unlike the chest adapter.
 *
 * Alongside that categorical roll, calculateTransmuteProfit() also reports two bonus drops
 * (Alchemy Essence, an Artisan's Crate) that are independent per-attempt Bernoulli events
 * occurring regardless of whether the transmute itself succeeds or fails ("not affected by
 * success rate" — see alchemy-profit-display.js and calculateAlchemyBonusDrops()'s own
 * actionsPerHour-based, successRate-independent rate calculation).
 *
 * Catalyst is consumed only on success (per alchemy-profit-display.js's own label: "consumed
 * only on success"), so it is charged on every success branch, never on failure. Materials —
 * including any direct coin cost — are consumed on every attempt regardless of outcome.
 */

import alchemyProfitCalculator from '../../features/market/alchemy-profit-calculator.js';
import { drawFromDistribution } from '../risk-of-ruin-engine.js';

/**
 * Recover the per-occurrence payout for one categorical drop-table branch (excluding the
 * essence/rare bonus layer, handled separately), un-scaling calculateTransmuteProfit()'s
 * successRate-blended revenuePerAttempt/selfReturnValue fields back to "value if this branch
 * is the one that happens".
 */
function mainBranchPayout(drop, profit) {
    if (drop.dropRate <= 0) return 0;
    if (drop.isSelfReturn) {
        // selfReturnValue = inputPrice * selfReturnRate(=drop.dropRate) * successRate * selfReturnCount
        return profit.selfReturnValue / (profit.successRate * drop.dropRate);
    }
    // revenuePerAttempt = (afterTaxPrice * avgCount * bulkMultiplier) * dropRate * successRate
    return drop.revenuePerAttempt / (profit.successRate * drop.dropRate);
}

/**
 * Build the exact per-attempt outcome distribution: failure, plus one branch per categorical
 * drop-table entry (each independently crossed with the essence/rare bonus-drop Bernoulli
 * layer, since that layer applies regardless of success/failure).
 * @returns {Array<{prob: number, net: number}>}
 */
function buildOutcomeDistribution(profit, attemptCost, catalystCostOnSuccess) {
    const dropRevenues = profit.dropRevenues || [];
    const mainDrops = dropRevenues.filter((d) => !d.isEssence && !d.isRare);
    const bonusDrops = dropRevenues.filter((d) => d.isEssence || d.isRare);

    const mainBranches = [{ prob: 1 - profit.successRate, payout: 0, isSuccess: false }];
    let coveredDropRate = 0;
    for (const drop of mainDrops) {
        if (!(drop.dropRate > 0)) continue;
        coveredDropRate += drop.dropRate;
        mainBranches.push({
            prob: profit.successRate * drop.dropRate,
            payout: mainBranchPayout(drop, profit),
            isSuccess: true,
        });
    }
    // A drop-table entry the calculator couldn't price (getItemPrice returned null) is silently
    // dropped upstream, leaving a gap in dropRate coverage. Fold that residual probability mass
    // into a zero-payout branch rather than losing it — conservative (never invents a value),
    // and keeps probabilities summing to exactly 1.
    const residualDropRate = Math.max(0, 1 - coveredDropRate);
    if (residualDropRate > 0) {
        mainBranches.push({ prob: profit.successRate * residualDropRate, payout: 0, isSuccess: true });
    }

    // Essence/rare bonus drops are independent per-attempt Bernoulli events, unaffected by
    // success/failure - cross every combination of them into its own outcome.
    let bonusOutcomes = [{ prob: 1, payout: 0 }];
    for (const bonus of bonusDrops) {
        if (!(bonus.dropRate > 0)) continue;
        const hitPayout = bonus.revenuePerAttempt / bonus.dropRate;
        const next = [];
        for (const outcome of bonusOutcomes) {
            next.push({ prob: outcome.prob * (1 - bonus.dropRate), payout: outcome.payout });
            next.push({ prob: outcome.prob * bonus.dropRate, payout: outcome.payout + hitPayout });
        }
        bonusOutcomes = next;
    }

    const outcomeDistribution = [];
    for (const main of mainBranches) {
        const cost = attemptCost + (main.isSuccess ? catalystCostOnSuccess : 0);
        for (const bonus of bonusOutcomes) {
            const prob = main.prob * bonus.prob;
            if (prob <= 0) continue;
            outcomeDistribution.push({ prob, net: -cost + main.payout + bonus.payout });
        }
    }

    return outcomeDistribution;
}

/**
 * Build the exact per-attempt risk-of-ruin model for repeatedly Transmuting one item.
 * @param {string} itemHrid - Item being transmuted.
 * @param {Object} [options]
 * @param {boolean} [options.useLiveSetup] - Use the currently-open action panel's live
 *   catalyst/tea selection instead of the automatically-best combination. Ignored when
 *   catalystChoice is given.
 * @param {'none'|'typeSpecific'|'prime'|null} [options.catalystChoice] - Force a specific
 *   catalyst instead of searching for the best one or reading the live panel.
 * @returns {{
 *   cost: number,
 *   maxSinglePossibleLoss: number,
 *   outcomeDistribution: Array<{prob: number, net: number}>,
 *   stepFn: function(state: Object, rng: function(): number): Object,
 *   breakdown: {
 *     successRate: number,
 *     materialCost: number,
 *     coinCost: number,
 *     catalystHrid: string|null,
 *     catalystCostOnSuccess: number,
 *     netOnFail: number,
 *     mainBranches: Array<{itemHrid: string, dropRate: number, payout: number, isSelfReturn: boolean}>,
 *     bonusDrops: Array<{itemHrid: string, dropRate: number, payout: number}>,
 *   },
 * }|null} null if the item isn't transmutable or has no usable market/success-rate data.
 */
export function buildAlchemyTransmuteModel(itemHrid, { useLiveSetup = false, catalystChoice = null } = {}) {
    const profit = alchemyProfitCalculator.calculateTransmuteProfit(itemHrid, useLiveSetup, null, catalystChoice);
    if (!profit || !(profit.successRate > 0)) return null;

    const coinCost = profit.requirementCosts.find((r) => r.itemHrid === '/items/coin')?.costPerAction ?? 0;
    const attemptCost = profit.grossMaterialCost + coinCost;
    const catalystCostOnSuccess = profit.catalystPrice || 0;
    const netOnFail = -attemptCost;

    const outcomeDistribution = buildOutcomeDistribution(profit, attemptCost, catalystCostOnSuccess);
    const maxSinglePossibleLoss = Math.max(0, ...outcomeDistribution.map((o) => -o.net));

    const dropRevenues = profit.dropRevenues || [];
    const mainBranches = dropRevenues
        .filter((d) => !d.isEssence && !d.isRare && d.dropRate > 0)
        .map((d) => ({
            itemHrid: d.itemHrid,
            dropRate: d.dropRate,
            payout: mainBranchPayout(d, profit),
            isSelfReturn: d.isSelfReturn || false,
        }));
    const bonusDrops = dropRevenues
        .filter((d) => (d.isEssence || d.isRare) && d.dropRate > 0)
        .map((d) => ({ itemHrid: d.itemHrid, dropRate: d.dropRate, payout: d.revenuePerAttempt / d.dropRate }));

    return {
        cost: attemptCost,
        maxSinglePossibleLoss,
        outcomeDistribution,
        stepFn: (state, rng) => ({ balance: state.balance + drawFromDistribution(outcomeDistribution, rng).net }),
        breakdown: {
            successRate: profit.successRate,
            materialCost: profit.grossMaterialCost,
            coinCost,
            catalystHrid: profit.catalystPrice ? profit.catalystCost?.itemHrid || null : null,
            catalystCostOnSuccess,
            netOnFail,
            mainBranches,
            bonusDrops,
        },
    };
}
