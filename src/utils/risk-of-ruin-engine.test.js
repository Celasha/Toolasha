import { describe, expect, test } from 'vitest';

import {
    createSeededRng,
    drawFromDistribution,
    simulateRuin,
    wilsonConfidenceInterval,
    minActionsForNonZeroRisk,
    findPeakExposureStep,
    expectedNetPerAction,
    findAdjustmentCoefficient,
    lundbergBound,
    lundbergBoundVarying,
} from './risk-of-ruin-engine.js';

// Simple asymmetric random walk: win prob p, +1 net; lose prob q=1-p, -1 net. With absorbing
// barriers at balance 0 (ruin) and balance N (target), the exact ruin probability starting at
// balance i is (r^N - r^i) / (r^N - 1) where r = q/p. This lets every engine primitive be
// checked against a hand-derivable closed form instead of just "runs without throwing".
function gamblersRuinStepFn(winProb) {
    return (state, rng) => {
        const net = rng() < winProb ? 1 : -1;
        return { balance: state.balance + net };
    };
}

describe('simulateRuin', () => {
    test('converges to the exact two-barrier gambler-ruin probability', () => {
        const winProb = 0.6;
        const startingBalance = 4;
        const target = 10; // absolute balance target (barrier), i.e. a gain of 6
        const r = (1 - winProb) / winProb;
        const exactRuinProbability = (r ** target - r ** startingBalance) / (r ** target - 1);

        const result = simulateRuin({
            startingBalance,
            trials: 500000,
            stepFn: gamblersRuinStepFn(winProb),
            isTargetReached: (state) => state.balance >= target,
            rngSeed: 42,
        });

        expect(Math.abs(result.ruinProbability - exactRuinProbability)).toBeLessThan(0.01);
        expect(result.ruinCount + result.undecidedCount).toBeLessThanOrEqual(result.trials);
        expect(result.meanStepsToRuin).toBeGreaterThan(0);
    });

    test('returns certain ruin when starting balance is already non-positive', () => {
        const result = simulateRuin({
            startingBalance: 0,
            trials: 100,
            stepFn: gamblersRuinStepFn(0.9),
            isTargetReached: () => false,
        });

        expect(result.ruinProbability).toBe(1);
        expect(result.ruinCount).toBe(100);
    });

    test('is deterministic for a fixed seed', () => {
        const options = {
            startingBalance: 5,
            trials: 1000,
            stepFn: gamblersRuinStepFn(0.55),
            isTargetReached: (state) => state.balance >= 15,
            rngSeed: 7,
        };

        expect(simulateRuin(options).ruinProbability).toBe(simulateRuin(options).ruinProbability);
    });
});

describe('createSeededRng / drawFromDistribution', () => {
    test('produces floats in [0, 1) deterministically for a given seed', () => {
        const rngA = createSeededRng(123);
        const rngB = createSeededRng(123);
        for (let i = 0; i < 10; i++) {
            const a = rngA();
            const b = rngB();
            expect(a).toBe(b);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThan(1);
        }
    });

    test('draws respect the given probabilities over many samples', () => {
        const distribution = [
            { prob: 0.2, label: 'a' },
            { prob: 0.8, label: 'b' },
        ];
        const rng = createSeededRng(99);
        let aCount = 0;
        const samples = 20000;
        for (let i = 0; i < samples; i++) {
            if (drawFromDistribution(distribution, rng).label === 'a') aCount += 1;
        }
        expect(aCount / samples).toBeCloseTo(0.2, 1);
    });
});

describe('wilsonConfidenceInterval', () => {
    test('brackets the point estimate and widens for small trial counts', () => {
        const large = wilsonConfidenceInterval(500, 1000);
        const small = wilsonConfidenceInterval(5, 10);

        expect(large.low).toBeLessThan(0.5);
        expect(large.high).toBeGreaterThan(0.5);
        expect(small.high - small.low).toBeGreaterThan(large.high - large.low);
    });

    test('clamps to [0, 1] at the extremes', () => {
        const allSuccess = wilsonConfidenceInterval(1000, 1000);
        expect(allSuccess.high).toBeLessThanOrEqual(1);
        const allFailure = wilsonConfidenceInterval(0, 1000);
        expect(allFailure.low).toBeGreaterThanOrEqual(0);
    });
});

describe('minActionsForNonZeroRisk', () => {
    test('computes the exact worst-case action count analytically', () => {
        expect(minActionsForNonZeroRisk(100, 25)).toBe(4);
        expect(minActionsForNonZeroRisk(101, 25)).toBe(5);
    });

    test('is infinite when no single action can ever lose money', () => {
        expect(minActionsForNonZeroRisk(100, 0)).toBe(Infinity);
    });
});

describe('findPeakExposureStep', () => {
    test('reads the mode directly off a ruin-step histogram', () => {
        const ruinStepCounts = [];
        ruinStepCounts[3] = 10;
        ruinStepCounts[7] = 50;
        ruinStepCounts[12] = 20;
        expect(findPeakExposureStep(ruinStepCounts)).toBe(7);
    });

    test('returns null when no trial ever ruined', () => {
        expect(findPeakExposureStep([])).toBeNull();
    });
});

describe('Lundberg bound', () => {
    // For the simple +-1 random walk, the adjustment coefficient has the closed form
    // R = ln(p/q), and e^(-R*u) is exactly (q/p)^u — a known special case where the Lundberg
    // bound is tight, not just an upper bound, giving a precise value to assert against.
    const winProb = 0.6;
    const distribution = [
        { prob: winProb, net: 1 },
        { prob: 1 - winProb, net: -1 },
    ];

    test('adjustment coefficient matches ln(p/q)', () => {
        const r = findAdjustmentCoefficient(distribution);
        expect(r).toBeCloseTo(Math.log(winProb / (1 - winProb)), 6);
    });

    test('bound matches the exact tight-case value (q/p)^startingBalance', () => {
        const startingBalance = 4;
        const result = lundbergBound({ startingBalance, outcomeDistribution: distribution });
        const exact = ((1 - winProb) / winProb) ** startingBalance;

        expect(result.meaningful).toBe(true);
        expect(result.bound).toBeCloseTo(exact, 6);
    });

    test('is not meaningful when expected drift is non-positive', () => {
        const losingDistribution = [
            { prob: 0.4, net: 1 },
            { prob: 0.6, net: -1 },
        ];
        expect(expectedNetPerAction(losingDistribution)).toBeLessThan(0);
        expect(findAdjustmentCoefficient(losingDistribution)).toBeNull();

        const result = lundbergBound({ startingBalance: 4, outcomeDistribution: losingDistribution });
        expect(result.meaningful).toBe(false);
        expect(result.bound).toBe(1);
    });

    test('varying-distribution bound picks the least-favorable level conservatively', () => {
        const favorableLevel = [
            { prob: 0.9, net: 1 },
            { prob: 0.1, net: -1 },
        ];
        const unfavorableLevel = distribution; // winProb 0.6, the worse of the two

        const result = lundbergBoundVarying({
            startingBalance: 4,
            perStepDistributions: [favorableLevel, unfavorableLevel],
        });
        const soloUnfavorable = lundbergBound({ startingBalance: 4, outcomeDistribution: unfavorableLevel });

        expect(result.meaningful).toBe(true);
        expect(result.bound).toBeCloseTo(soloUnfavorable.bound, 10);
    });

    test('varying-distribution bound is not meaningful when every level has non-positive drift', () => {
        const result = lundbergBoundVarying({
            startingBalance: 4,
            perStepDistributions: [
                [
                    { prob: 0.4, net: 1 },
                    { prob: 0.6, net: -1 },
                ],
            ],
        });
        expect(result.meaningful).toBe(false);
    });
});
