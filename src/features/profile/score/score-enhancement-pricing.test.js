import { describe, expect, test } from 'vitest';

import { priceLegFromTable, buildTargetCostLadder, applyMirrorOptimization } from './score-enhancement-pricing.js';

/** Build a minimal synthetic table with hand-picked attempts/protections per strategy/target. */
function makeTable(strategiesByTarget) {
    const targets = [];
    for (const [targetLevel, strategies] of Object.entries(strategiesByTarget)) {
        targets[Number(targetLevel)] = strategies;
    }
    return { targets };
}

describe('priceLegFromTable', () => {
    test('picks the cheapest strategy across protectFrom candidates', () => {
        const table = makeTable({
            5: [
                { protectFrom: 0, attemptsByStart: [10], protectionsByStart: [0] },
                { protectFrom: 2, attemptsByStart: [6], protectionsByStart: [1] },
            ],
        });
        // protectFrom 0: 10 * 2 = 20; protectFrom 2: 6*2 + 1*3 = 15 -> cheaper
        const result = priceLegFromTable(table, 5, 0, 2, 3);
        expect(result).toEqual({ cost: 15, complete: true });
    });

    test('a strategy needing unpriceable protection is excluded, not zero-substituted', () => {
        const table = makeTable({
            5: [{ protectFrom: 2, attemptsByStart: [6], protectionsByStart: [1] }],
        });
        const result = priceLegFromTable(table, 5, 0, 2, null);
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('a strategy that never needs protection at this start level ignores an unpriced protection unit', () => {
        const table = makeTable({
            5: [{ protectFrom: 4, attemptsByStart: [8], protectionsByStart: [0] }],
        });
        const result = priceLegFromTable(table, 5, 0, 2, null);
        expect(result).toEqual({ cost: 16, complete: true });
    });

    test('reads the correct start-level column, not just start 0', () => {
        const table = makeTable({
            5: [{ protectFrom: 0, attemptsByStart: [10, 7, 3], protectionsByStart: [0, 0, 0] }],
        });
        const result = priceLegFromTable(table, 5, 2, 4, 0);
        expect(result).toEqual({ cost: 12, complete: true });
    });

    test('missing target in the table is incomplete', () => {
        const result = priceLegFromTable(makeTable({}), 5, 0, 2, 0);
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('unpriceable per-attempt material cost is incomplete', () => {
        const table = makeTable({ 5: [{ protectFrom: 0, attemptsByStart: [10], protectionsByStart: [0] }] });
        expect(priceLegFromTable(table, 5, 0, null, 0)).toEqual({ cost: null, complete: false });
    });
});

describe('buildTargetCostLadder', () => {
    test('costs[0] is the base and each level adds the best-priced 0-start leg', () => {
        const table = makeTable({
            1: [{ protectFrom: 0, attemptsByStart: [2], protectionsByStart: [0] }],
            2: [{ protectFrom: 0, attemptsByStart: [5], protectionsByStart: [0] }],
        });
        const ladder = buildTargetCostLadder(table, 2, 100, 3, 0);
        expect(ladder).toEqual([100, 106, 115]); // 100 + 2*3=106; 100 + 5*3=115
    });

    test('an unpriceable base makes every level null', () => {
        const table = makeTable({ 1: [{ protectFrom: 0, attemptsByStart: [2], protectionsByStart: [0] }] });
        const ladder = buildTargetCostLadder(table, 1, null, 3, 0);
        expect(ladder).toEqual([null, null]);
    });

    test('a level whose only strategies need unpriceable protection stays null without poisoning other levels', () => {
        const table = makeTable({
            1: [{ protectFrom: 0, attemptsByStart: [2], protectionsByStart: [0] }],
            2: [{ protectFrom: 2, attemptsByStart: [5], protectionsByStart: [1] }],
        });
        const ladder = buildTargetCostLadder(table, 2, 100, 3, null);
        expect(ladder).toEqual([100, 106, null]);
    });
});

describe('applyMirrorOptimization', () => {
    test('leaves the ladder untouched when Mirror is unpriced', () => {
        const ladder = [10, 20, 30, 40];
        expect(applyMirrorOptimization(ladder, null)).toEqual(ladder);
        expect(applyMirrorOptimization(ladder, 0)).toEqual(ladder);
    });

    test('substitutes a cheaper mirror route at the level it first becomes cheaper', () => {
        // level 3 traditional = 40; mirror = costs[1] + costs[2] + mirrorPrice = 20 + 30 + 5 = 55 -> traditional wins
        // level 4 traditional = 1000; mirror = costs[2] + costs[3] + mirrorPrice = 30 + 40 + 5 = 75 -> mirror wins
        const ladder = [10, 20, 30, 40, 1000];
        const optimized = applyMirrorOptimization(ladder, 5);
        expect(optimized[3]).toBe(40);
        expect(optimized[4]).toBe(75);
    });

    test('a later level compounds off an already-mirror-discounted earlier level', () => {
        // level 3 mirror = costs[1]+costs[2]+mirrorPrice = 20+30+5=55 vs traditional 60 -> mirror wins, optimized[3]=55
        // level 4 mirror = optimized[2]+optimized[3]+mirrorPrice = 30+55+5=90 vs traditional 200 -> mirror wins
        const ladder = [10, 20, 30, 60, 200];
        const optimized = applyMirrorOptimization(ladder, 5);
        expect(optimized[3]).toBe(55);
        expect(optimized[4]).toBe(90);
    });

    test('never rescues a null (unpriceable) level, and never poisons a priceable level from a null neighbor', () => {
        const ladder = [10, 20, null, 40];
        const optimized = applyMirrorOptimization(ladder, 5);
        expect(optimized[2]).toBeNull();
        expect(optimized[3]).toBe(40); // neighbor (level 2) is null -> mirror comparison skipped, traditional kept
    });
});
