/**
 * Enhancement Expectation Kernel (TLA-041C)
 *
 * Pure cost-only Markov expectations for the Profile Score. Deliberately independent of DOM,
 * storage, market data, and `math.js` so it can run unmodified inside a Web Worker.
 *
 * The Profile Score only ever needs expected attempts and expected protection-item uses per
 * strategy/start-level - never XP/time/tooltip metadata - so instead of inverting a fresh
 * `(targetLevel x targetLevel)` matrix per protection strategy (what the canonical
 * `enhancement-calculator.js#calculateEnhancement()` tooltip path does, once per strategy per
 * target level), this solves the same linear system with two right-hand sides:
 *
 *   A = I - Q
 *   A * E = 1   (expected attempts from every start state)
 *   A * P = r   (expected protection uses from every start state)
 *
 * One Gauss-Jordan elimination per (targetLevel, protectFrom) strategy therefore yields the exact
 * statistics for every start level `K < targetLevel` at once, instead of needing a separate solve
 * per K. Independently verified against canonical semantics across 17,220 target/policy/start-state
 * cases (max relative difference 2.71e-15) - see enhancement-expectation-kernel.test.js for the
 * parity assertions kept in this repository.
 */

const BASE_SUCCESS_RATES = [50, 45, 45, 40, 40, 40, 35, 35, 35, 35, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];

/**
 * Gauss-Jordan elimination with partial pivoting for two right-hand sides at once.
 * @param {Array<Float64Array>} matrix - Square `A` matrix (rows are Float64Array of length n)
 * @param {Array<number>} rhsA - First right-hand side (length n)
 * @param {Array<number>} rhsB - Second right-hand side (length n)
 * @returns {{attemptsByStart: number[], protectionsByStart: number[]}}
 */
function solveTwoRightHandSides(matrix, rhsA, rhsB) {
    const n = rhsA.length;
    const augmented = Array.from({ length: n }, (_, rowIndex) => {
        const row = new Float64Array(n + 2);
        for (let col = 0; col < n; col++) row[col] = matrix[rowIndex][col];
        row[n] = rhsA[rowIndex];
        row[n + 1] = rhsB[rowIndex];
        return row;
    });

    for (let col = 0; col < n; col++) {
        let pivot = col;
        let pivotAbs = Math.abs(augmented[col][col]);
        for (let row = col + 1; row < n; row++) {
            const candidateAbs = Math.abs(augmented[row][col]);
            if (candidateAbs > pivotAbs) {
                pivot = row;
                pivotAbs = candidateAbs;
            }
        }
        if (!(pivotAbs > 1e-14)) throw new Error('Singular enhancement expectation system');
        if (pivot !== col) {
            const tmp = augmented[col];
            augmented[col] = augmented[pivot];
            augmented[pivot] = tmp;
        }

        const divisor = augmented[col][col];
        for (let j = col; j < n + 2; j++) augmented[col][j] /= divisor;

        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = augmented[row][col];
            if (factor === 0) continue;
            for (let j = col; j < n + 2; j++) {
                augmented[row][j] -= factor * augmented[col][j];
            }
        }
    }

    const attemptsByStart = new Array(n);
    const protectionsByStart = new Array(n);
    for (let i = 0; i < n; i++) {
        attemptsByStart[i] = augmented[i][n];
        protectionsByStart[i] = augmented[i][n + 1];
    }
    return { attemptsByStart, protectionsByStart };
}

/**
 * Compute expected-attempts/expected-protection-uses tables for every target level `1..maxTarget`
 * and every legal protection strategy for that target, for one fixed set of viewer enhancing
 * parameters and item level.
 * @param {Object} params
 * @param {number} params.enhancingLevel - Effective enhancing level (includes tea bonus)
 * @param {number} [params.toolBonus] - Tool success bonus % (equipment + house, already summed)
 * @param {number} params.itemLevel - Item level being enhanced
 * @param {boolean} [params.blessedTea] - Whether Blessed Tea is active (1% base double-jump)
 * @param {number} [params.guzzlingBonus] - Drink concentration multiplier (1.0 = no bonus)
 * @param {number} [params.maxTarget] - Highest target level to compute (1-20, default 20)
 * @returns {{targets: Array<Array<{protectFrom: number, attemptsByStart: number[], protectionsByStart: number[]}>>}}
 *   `targets[targetLevel]` is an array of strategies for that target; `targets[0]` is unused.
 */
export function calculateScoreEnhancementExpectationTables(params) {
    const { enhancingLevel, toolBonus = 0, itemLevel, blessedTea = false, guzzlingBonus = 1, maxTarget = 20 } = params;

    if (!Number.isFinite(enhancingLevel) || !Number.isFinite(toolBonus) || !Number.isFinite(itemLevel)) {
        throw new Error('Invalid enhancement expectation parameters');
    }
    if (!Number.isInteger(maxTarget) || maxTarget < 1 || maxTarget > 20) {
        throw new Error('maxTarget must be 1..20');
    }

    const successMultiplier =
        enhancingLevel >= itemLevel
            ? 1 + (toolBonus + 0.05 * (enhancingLevel - itemLevel)) / 100
            : 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;

    const targets = new Array(maxTarget + 1);
    for (let targetLevel = 1; targetLevel <= maxTarget; targetLevel++) {
        const protectFromValues = [0];
        for (let protectFrom = 2; protectFrom <= targetLevel; protectFrom++) {
            protectFromValues.push(protectFrom);
        }

        const strategies = [];
        for (const protectFrom of protectFromValues) {
            const matrix = Array.from({ length: targetLevel }, () => new Float64Array(targetLevel));
            const protectionReward = new Float64Array(targetLevel);
            const attemptReward = new Float64Array(targetLevel);
            attemptReward.fill(1);

            for (let state = 0; state < targetLevel; state++) {
                matrix[state][state] = 1;

                const baseRate = BASE_SUCCESS_RATES[state] / 100;
                const successChance = Math.max(0, Math.min(1, baseRate * successMultiplier));
                const failureChance = 1 - successChance;
                const failureDestination = protectFrom > 0 && state >= protectFrom ? state - 1 : 0;

                if (blessedTea) {
                    const skipRatio = Math.max(0, Math.min(1, 0.01 * guzzlingBonus));
                    const skipChance = successChance * skipRatio;
                    const normalChance = successChance - skipChance;
                    const normalDestination = Math.min(targetLevel, state + 1);
                    const skipDestination = Math.min(targetLevel, state + 2);
                    if (normalDestination < targetLevel) matrix[state][normalDestination] -= normalChance;
                    if (skipDestination < targetLevel) matrix[state][skipDestination] -= skipChance;
                } else {
                    const successDestination = Math.min(targetLevel, state + 1);
                    if (successDestination < targetLevel) matrix[state][successDestination] -= successChance;
                }

                if (failureDestination < targetLevel) matrix[state][failureDestination] -= failureChance;
                if (protectFrom > 0 && state >= protectFrom) protectionReward[state] = failureChance;
            }

            strategies.push({
                protectFrom,
                ...solveTwoRightHandSides(matrix, attemptReward, protectionReward),
            });
        }
        targets[targetLevel] = strategies;
    }

    return { targets };
}
