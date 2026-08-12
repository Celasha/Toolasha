/**
 * Risk of Ruin Engine
 *
 * Pure statistical core for "how likely am I to hit 0 gold before reaching my target?".
 * Has zero knowledge of chests/alchemy/enhancing — callers (adapters) supply a per-action
 * outcome generator (stepFn) and a target-reached check (isTargetReached); everything here
 * operates on plain { balance, ...custom } state objects.
 *
 * Two independent estimates are provided:
 * - simulateRuin(): Monte Carlo point estimate + confidence interval.
 * - lundbergBound() / lundbergBoundVarying(): closed-form upper bound (Lundberg inequality).
 */

/**
 * Deterministic PRNG (mulberry32) so simulations are reproducible for a given seed.
 * @param {number} seed
 * @returns {function(): number} Generator of floats in [0, 1)
 */
export function createSeededRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draw a random outcome from a discrete distribution of { prob, ...payload } entries.
 * Probabilities need not sum to exactly 1 (floating point); the last entry catches the remainder.
 * @param {Array<{prob: number}>} distribution
 * @param {function(): number} rng
 * @returns {Object} The chosen entry
 */
export function drawFromDistribution(distribution, rng) {
    const roll = rng();
    let cumulative = 0;
    for (let i = 0; i < distribution.length; i++) {
        cumulative += distribution[i].prob;
        if (roll < cumulative || i === distribution.length - 1) {
            return distribution[i];
        }
    }
    return distribution[distribution.length - 1];
}

/**
 * Run a Monte Carlo simulation of repeated actions against a starting balance.
 * @param {Object} params
 * @param {number} params.startingBalance - Gold on hand before the first action.
 * @param {number} params.trials - Number of independent simulated walks.
 * @param {function(state: Object, rng: function(): number): Object} params.stepFn -
 *   Returns the next state (must include an updated `balance`) after one action.
 * @param {function(state: Object): boolean} params.isTargetReached - True once the goal is met.
 * @param {Object} [params.initialState] - Extra domain fields merged into the starting state.
 * @param {number} [params.maxSteps] - Safety cap on actions per trial.
 * @param {number} [params.rngSeed] - Seed for reproducibility.
 * @returns {{
 *   ruinProbability: number,
 *   ruinCount: number,
 *   trials: number,
 *   ruinStepCounts: number[],
 *   meanStepsToRuin: number|null,
 *   undecidedCount: number,
 * }}
 */
export function simulateRuin({
    startingBalance,
    trials,
    stepFn,
    isTargetReached,
    initialState = {},
    maxSteps = 100000,
    rngSeed = 1,
}) {
    if (startingBalance <= 0) {
        return {
            ruinProbability: 1,
            ruinCount: trials,
            trials,
            ruinStepCounts: [0],
            meanStepsToRuin: 0,
            undecidedCount: 0,
        };
    }

    const rng = createSeededRng(rngSeed);
    const ruinStepCounts = [];
    let ruinCount = 0;
    let undecidedCount = 0;
    let totalRuinSteps = 0;

    for (let trial = 0; trial < trials; trial++) {
        let state = { balance: startingBalance, ...initialState };
        let step = 0;
        let ruined = false;

        while (step < maxSteps && !isTargetReached(state)) {
            state = stepFn(state, rng);
            step += 1;
            if (state.balance <= 0) {
                ruined = true;
                break;
            }
        }

        if (ruined) {
            ruinCount += 1;
            totalRuinSteps += step;
            ruinStepCounts[step] = (ruinStepCounts[step] || 0) + 1;
        } else if (!isTargetReached(state)) {
            undecidedCount += 1;
        }
    }

    return {
        ruinProbability: ruinCount / trials,
        ruinCount,
        trials,
        ruinStepCounts,
        meanStepsToRuin: ruinCount > 0 ? totalRuinSteps / ruinCount : null,
        undecidedCount,
    };
}

/**
 * Wilson score confidence interval for a binomial proportion — more reliable than the Wald
 * interval when the estimated probability is near 0 or 1, which is the common case here.
 * @param {number} successCount
 * @param {number} trials
 * @param {number} [z] - Z-score (1.96 = 95% CI)
 * @returns {{low: number, high: number}}
 */
export function wilsonConfidenceInterval(successCount, trials, z = 1.96) {
    if (trials === 0) return { low: 0, high: 1 };
    const p = successCount / trials;
    const z2 = z * z;
    const denom = 1 + z2 / trials;
    const center = p + z2 / (2 * trials);
    const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
    return {
        low: Math.max(0, (center - margin) / denom),
        high: Math.min(1, (center + margin) / denom),
    };
}

/**
 * The last action count at which ruin is still analytically impossible, computed from the
 * worst single-action loss rather than simulated — cheap and exact, no trials needed.
 * @param {number} startingBalance
 * @param {number} maxSinglePossibleLoss - Largest possible net loss from one action.
 * @returns {number} First action count at which risk becomes non-zero (Infinity if it never can).
 */
export function minActionsForNonZeroRisk(startingBalance, maxSinglePossibleLoss) {
    if (maxSinglePossibleLoss <= 0) return Infinity;
    return Math.ceil(startingBalance / maxSinglePossibleLoss);
}

/**
 * The action index at which trials most often actually went bust, read directly off the
 * ruin-step histogram produced by simulateRuin() — no extra simulation required.
 * @param {number[]} ruinStepCounts
 * @returns {number|null} Step index of peak exposure, or null if no trial ever ruined.
 */
export function findPeakExposureStep(ruinStepCounts) {
    let peakStep = null;
    let peakCount = 0;
    for (let step = 0; step < ruinStepCounts.length; step++) {
        const count = ruinStepCounts[step] || 0;
        if (count > peakCount) {
            peakCount = count;
            peakStep = step;
        }
    }
    return peakStep;
}

/**
 * Expected net gold change per action for a discrete outcome distribution.
 * @param {Array<{prob: number, net: number}>} outcomeDistribution
 * @returns {number}
 */
export function expectedNetPerAction(outcomeDistribution) {
    return outcomeDistribution.reduce((sum, o) => sum + o.prob * o.net, 0);
}

function outcomeMgf(outcomeDistribution, r) {
    return outcomeDistribution.reduce((sum, o) => sum + o.prob * Math.exp(-r * o.net), 0);
}

/**
 * Solve E[e^(-R*X)] = 1 for the positive adjustment coefficient R, where X is the per-action
 * net gold change. Only exists when the distribution has positive expected drift (a "safety
 * loading"); returns null otherwise, since the classical Lundberg bound is not meaningful
 * without positive drift (it would be trivially ~1).
 * @param {Array<{prob: number, net: number}>} outcomeDistribution
 * @returns {number|null}
 */
export function findAdjustmentCoefficient(outcomeDistribution) {
    if (expectedNetPerAction(outcomeDistribution) <= 0) return null;

    // f(R) = mgf(R) - 1. f(0) = 0 and f'(0) = -E[X] < 0, so f dips negative just above 0 then
    // rises back through 0 at the adjustment coefficient (as long as a loss outcome exists).
    let lower = 1e-9;
    let guard = 0;
    while (outcomeMgf(outcomeDistribution, lower) - 1 >= 0 && guard < 20) {
        lower *= 10;
        guard += 1;
    }

    let upper = Math.max(lower * 2, 1e-8);
    guard = 0;
    while (outcomeMgf(outcomeDistribution, upper) - 1 <= 0 && guard < 200) {
        upper *= 2;
        guard += 1;
    }
    if (outcomeMgf(outcomeDistribution, upper) - 1 <= 0) return null;

    for (let i = 0; i < 100; i++) {
        const mid = (lower + upper) / 2;
        if (outcomeMgf(outcomeDistribution, mid) - 1 > 0) {
            upper = mid;
        } else {
            lower = mid;
        }
    }
    return (lower + upper) / 2;
}

/**
 * Closed-form upper bound on ruin probability for an i.i.d. per-action distribution (chests,
 * alchemy Transmute). This bounds infinite-horizon ruin, which is itself an upper bound on our
 * finite-horizon question ("ruin before N actions" <= "ruin ever") — always a valid but
 * conservative bound, never an exact match to the Monte Carlo estimate.
 * @param {Object} params
 * @param {number} params.startingBalance
 * @param {Array<{prob: number, net: number}>} params.outcomeDistribution
 * @returns {{bound: number, meaningful: boolean, adjustmentCoefficient: number|null}}
 */
export function lundbergBound({ startingBalance, outcomeDistribution }) {
    const adjustmentCoefficient = findAdjustmentCoefficient(outcomeDistribution);
    if (adjustmentCoefficient === null) {
        return { bound: 1, meaningful: false, adjustmentCoefficient: null };
    }
    return {
        bound: Math.exp(-adjustmentCoefficient * startingBalance),
        meaningful: true,
        adjustmentCoefficient,
    };
}

/**
 * Approximate closed-form upper bound for a per-action distribution that varies by position
 * (enhancing: success rate and cost both change per level). The classical inequality assumes
 * i.i.d. increments, which doesn't strictly hold here — this is a documented approximation,
 * not a proven tight bound. It uses the single least-favorable level's distribution (the one
 * with the smallest adjustment coefficient, i.e. the most conservative/largest resulting bound)
 * as a stand-in for the whole walk.
 * @param {Object} params
 * @param {number} params.startingBalance
 * @param {Array<Array<{prob: number, net: number}>>} params.perStepDistributions
 * @returns {{bound: number, meaningful: boolean, adjustmentCoefficient: number|null}}
 */
export function lundbergBoundVarying({ startingBalance, perStepDistributions }) {
    let worstCoefficient = null;
    for (const distribution of perStepDistributions) {
        const coefficient = findAdjustmentCoefficient(distribution);
        if (coefficient === null) continue;
        if (worstCoefficient === null || coefficient < worstCoefficient) {
            worstCoefficient = coefficient;
        }
    }
    if (worstCoefficient === null) {
        return { bound: 1, meaningful: false, adjustmentCoefficient: null };
    }
    return {
        bound: Math.exp(-worstCoefficient * startingBalance),
        meaningful: true,
        adjustmentCoefficient: worstCoefficient,
    };
}
