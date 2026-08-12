import { describe, expect, test } from 'vitest';

import {
    runFixedOutcomeTrials,
    runLevelWalkTrials,
    runBatch,
    buildChunkTasks,
    mergeRuinChunks,
} from './risk-of-ruin-worker-manager.js';
import { createSeededRng } from './risk-of-ruin-engine.js';

describe('runFixedOutcomeTrials', () => {
    test('matches the exact two-barrier gambler-ruin probability (cross-checks the main engine)', () => {
        const winProb = 0.6;
        const startingBalance = 4;
        const target = 6; // action count, since fixedOutcome walks a step count, not a balance barrier
        const outcomeDistribution = [
            { prob: winProb, net: 1 },
            { prob: 1 - winProb, net: -1 },
        ];

        const rng = createSeededRng(42);
        const result = runFixedOutcomeTrials(
            { startingBalance, trials: 200000, maxSteps: 100000, outcomeDistribution, targetActionCount: target },
            rng
        );

        // Exact ruin probability via DP over (step, balance) alive-mass, absorbing at balance
        // <= 0. A naive bitmask enumeration over all 2^6 win/loss sequences overcounts early-
        // ruin paths (it double-counts "irrelevant" trailing flips that never actually happen
        // once the walk is absorbed), so this DP is the correct hand-checkable reference.
        let alive = new Map([[startingBalance, 1]]);
        let exactRuin = 0;
        for (let step = 0; step < target; step++) {
            const next = new Map();
            for (const [balance, p] of alive) {
                for (const { prob, net } of outcomeDistribution) {
                    const nextBalance = balance + net;
                    const nextProb = p * prob;
                    if (nextBalance <= 0) {
                        exactRuin += nextProb;
                    } else {
                        next.set(nextBalance, (next.get(nextBalance) || 0) + nextProb);
                    }
                }
            }
            alive = next;
        }

        expect(Math.abs(result.ruinCount / result.trials - exactRuin)).toBeLessThan(0.005);
    });

    test('reports undecided when neither ruin nor the target is reached within maxSteps', () => {
        const rng = createSeededRng(1);
        const result = runFixedOutcomeTrials(
            {
                startingBalance: 1000,
                trials: 10,
                maxSteps: 3,
                outcomeDistribution: [{ prob: 1, net: -1 }],
                targetActionCount: 100,
            },
            rng
        );

        expect(result.ruinCount).toBe(0);
        expect(result.undecidedCount).toBe(10);
    });
});

describe('runLevelWalkTrials', () => {
    test('always ruins immediately when the only outcome is a guaranteed loss exceeding balance', () => {
        const rng = createSeededRng(1);
        const result = runLevelWalkTrials(
            {
                startingBalance: 50,
                trials: 100,
                maxSteps: 10,
                perLevelOutcomeDistributions: [[{ prob: 1, nextLevel: 1, net: -100 }]],
                targetLevel: 1,
                startLevel: 0,
            },
            rng
        );

        expect(result.ruinCount).toBe(100);
        expect(result.ruinStepCounts[1]).toBe(100);
    });

    test('always succeeds when the only outcome is a guaranteed win reaching target level', () => {
        const rng = createSeededRng(1);
        const result = runLevelWalkTrials(
            {
                startingBalance: 50,
                trials: 100,
                maxSteps: 10,
                perLevelOutcomeDistributions: [[{ prob: 1, nextLevel: 1, net: -10 }]],
                targetLevel: 1,
                startLevel: 0,
            },
            rng
        );

        expect(result.ruinCount).toBe(0);
        expect(result.undecidedCount).toBe(0);
    });
});

describe('runBatch', () => {
    test('is certain ruin when starting balance is already non-positive', () => {
        const result = runBatch({ startingBalance: 0, trials: 42, type: 'fixedOutcome' });
        expect(result.ruinCount).toBe(42);
        expect(result.trials).toBe(42);
    });

    test('dispatches to the level-walk path for type "levelWalk"', () => {
        const result = runBatch({
            startingBalance: 50,
            trials: 5,
            maxSteps: 10,
            rngSeed: 1,
            type: 'levelWalk',
            perLevelOutcomeDistributions: [[{ prob: 1, nextLevel: 1, net: -100 }]],
            targetLevel: 1,
            startLevel: 0,
        });
        expect(result.ruinCount).toBe(5);
    });

    test('dispatches to the fixed-outcome path for any other type', () => {
        const result = runBatch({
            startingBalance: 50,
            trials: 5,
            maxSteps: 10,
            rngSeed: 1,
            type: 'fixedOutcome',
            outcomeDistribution: [{ prob: 1, net: -100 }],
            targetActionCount: 10,
        });
        expect(result.ruinCount).toBe(5);
    });
});

describe('buildChunkTasks', () => {
    test('splits trials evenly across the pool with a distinct rngSeed per chunk', () => {
        const tasks = buildChunkTasks({ trials: 100, rngSeed: 1 }, 4);
        expect(tasks).toHaveLength(4);
        expect(tasks.map((t) => t.model.trials)).toEqual([25, 25, 25, 25]);
        const seeds = tasks.map((t) => t.model.rngSeed);
        expect(new Set(seeds).size).toBe(4);
    });

    test('distributes the remainder across the first chunks', () => {
        const tasks = buildChunkTasks({ trials: 10, rngSeed: 1 }, 3);
        expect(tasks.map((t) => t.model.trials)).toEqual([4, 3, 3]);
    });

    test('never creates more chunks than there are trials', () => {
        const tasks = buildChunkTasks({ trials: 2, rngSeed: 1 }, 8);
        expect(tasks).toHaveLength(2);
        expect(tasks.every((t) => t.model.trials === 1)).toBe(true);
    });
});

describe('mergeRuinChunks', () => {
    test('sums counts and merges the ruin-step histogram index-wise', () => {
        const merged = mergeRuinChunks([
            { ruinCount: 3, trials: 10, totalRuinSteps: 9, undecidedCount: 1, ruinStepCounts: [, 2, 1] },
            { ruinCount: 2, trials: 10, totalRuinSteps: 4, undecidedCount: 0, ruinStepCounts: [, 1, , 1] },
        ]);

        expect(merged.ruinCount).toBe(5);
        expect(merged.trials).toBe(20);
        expect(merged.undecidedCount).toBe(1);
        expect(merged.ruinProbability).toBe(0.25);
        expect(merged.meanStepsToRuin).toBe((9 + 4) / 5);
        expect(merged.ruinStepCounts[1]).toBe(3);
        expect(merged.ruinStepCounts[2]).toBe(1);
        expect(merged.ruinStepCounts[3]).toBe(1);
    });

    test('reports null meanStepsToRuin when nothing ever ruined', () => {
        const merged = mergeRuinChunks([
            { ruinCount: 0, trials: 5, totalRuinSteps: 0, undecidedCount: 5, ruinStepCounts: [] },
        ]);
        expect(merged.meanStepsToRuin).toBeNull();
        expect(merged.ruinProbability).toBe(0);
    });
});
