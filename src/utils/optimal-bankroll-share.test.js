import { describe, test, expect } from 'vitest';
import {
    calculateReturnStats,
    calculateOptimalBankrollFraction,
    calculateOptimalCommit,
} from './optimal-bankroll-share.js';

describe('calculateReturnStats', () => {
    test('computes mean and variance of R for a simple two-outcome distribution', () => {
        const outcomeDistribution = [
            { prob: 0.5, net: 100 },
            { prob: 0.5, net: -50 },
        ];
        const { meanR, varianceR } = calculateReturnStats(outcomeDistribution, 100);

        // R = 1 + net/cost -> {2, prob .5} and {0.5, prob .5}
        expect(meanR).toBeCloseTo(1.25, 10);
        expect(varianceR).toBeCloseTo(0.5625, 10);
    });

    test('returns zeros when costPerAction is not positive', () => {
        expect(calculateReturnStats([{ prob: 1, net: 10 }], 0)).toEqual({ meanR: 0, varianceR: 0 });
        expect(calculateReturnStats([{ prob: 1, net: 10 }], -5)).toEqual({ meanR: 0, varianceR: 0 });
    });

    test('returns zeros for an empty or missing distribution', () => {
        expect(calculateReturnStats([], 100)).toEqual({ meanR: 0, varianceR: 0 });
        expect(calculateReturnStats(null, 100)).toEqual({ meanR: 0, varianceR: 0 });
    });

    test('a certain outcome has zero variance', () => {
        const { meanR, varianceR } = calculateReturnStats([{ prob: 1, net: 20 }], 100);
        expect(meanR).toBeCloseTo(1.2, 10);
        expect(varianceR).toBe(0);
    });
});

describe('calculateOptimalBankrollFraction', () => {
    test('matches hand-computed fstar for a known mean/variance', () => {
        const fstar = calculateOptimalBankrollFraction({ actionCount: 1, meanR: 1.25, varianceR: 0.5625 });
        expect(fstar).toBeCloseTo(0.4444444444, 6);
    });

    test('scales linearly with actionCount', () => {
        const fstar1 = calculateOptimalBankrollFraction({ actionCount: 1, meanR: 1.1, varianceR: 1 });
        const fstar10 = calculateOptimalBankrollFraction({ actionCount: 10, meanR: 1.1, varianceR: 1 });
        expect(fstar10).toBeCloseTo(fstar1 * 10, 10);
    });

    test('is 0 when there is no edge (meanR <= 1)', () => {
        expect(calculateOptimalBankrollFraction({ actionCount: 100, meanR: 1, varianceR: 1 })).toBe(0);
        expect(calculateOptimalBankrollFraction({ actionCount: 100, meanR: 0.9, varianceR: 1 })).toBe(0);
    });

    test('is 0 when variance is 0 (no risk to size against)', () => {
        expect(calculateOptimalBankrollFraction({ actionCount: 100, meanR: 1.5, varianceR: 0 })).toBe(0);
    });

    test('is 0 for a non-positive actionCount', () => {
        expect(calculateOptimalBankrollFraction({ actionCount: 0, meanR: 1.5, varianceR: 1 })).toBe(0);
    });

    test('clamps at 1 (never recommends more than the full bankroll)', () => {
        const fstar = calculateOptimalBankrollFraction({ actionCount: 100000, meanR: 2, varianceR: 0.01 });
        expect(fstar).toBe(1);
    });
});

describe('calculateOptimalCommit', () => {
    test('combines return stats and fstar into a recommended coin commitment', () => {
        const outcomeDistribution = [
            { prob: 0.5, net: 100 },
            { prob: 0.5, net: -50 },
        ];
        const result = calculateOptimalCommit({
            outcomeDistribution,
            costPerAction: 100,
            actionCount: 1,
            bankroll: 10000,
        });

        expect(result.hasEdge).toBe(true);
        expect(result.fstar).toBeCloseTo(0.4444444444, 6);
        expect(result.recommendedCommit).toBeCloseTo(4444.444444, 3);
        expect(result.recommendedActionCount).toBe(Math.floor(result.recommendedCommit / 100));
    });

    test('recommends committing nothing when the activity has negative edge', () => {
        const outcomeDistribution = [
            { prob: 0.5, net: -10 },
            { prob: 0.5, net: -90 },
        ];
        const result = calculateOptimalCommit({
            outcomeDistribution,
            costPerAction: 100,
            actionCount: 50,
            bankroll: 10000,
        });

        expect(result.hasEdge).toBe(false);
        expect(result.fstar).toBe(0);
        expect(result.recommendedCommit).toBe(0);
        expect(result.recommendedActionCount).toBe(0);
    });

    test('handles a missing bankroll gracefully', () => {
        const outcomeDistribution = [
            { prob: 0.5, net: 100 },
            { prob: 0.5, net: -50 },
        ];
        const result = calculateOptimalCommit({
            outcomeDistribution,
            costPerAction: 100,
            actionCount: 1,
            bankroll: undefined,
        });

        expect(result.recommendedCommit).toBe(0);
        expect(result.recommendedActionCount).toBe(0);
    });
});
