import { beforeAll, describe, expect, test } from 'vitest';
import * as mathJs from 'mathjs';

import { calculateScoreEnhancementExpectationTables } from './enhancement-expectation-kernel.js';
import { calculateEnhancement } from '../../../utils/enhancement-calculator.js';

beforeAll(() => {
    globalThis.math = mathJs;
});

/**
 * PSP-04: compare the pure kernel's two-RHS solve against the canonical
 * `enhancement-calculator.js#calculateEnhancement()` fundamental-matrix solve for a representative
 * sweep of target/start/protectFrom/tea/level combinations.
 */
function middleProtectFrom(targetLevel) {
    if (targetLevel < 2) return 0;
    return Math.max(2, Math.floor(targetLevel / 2));
}

function middleStart(targetLevel) {
    return Math.floor(targetLevel / 2);
}

const VIEWER_REGIMES = [
    { name: 'below item level', enhancingLevel: 50, itemLevel: 100, toolBonus: 0 },
    { name: 'at item level', enhancingLevel: 100, itemLevel: 100, toolBonus: 5 },
    { name: 'above item level', enhancingLevel: 150, itemLevel: 100, toolBonus: 10 },
];

const TARGETS = [1, 2, 5, 10, 15, 20];

describe('calculateScoreEnhancementExpectationTables - PSP-04 parity vs canonical calculateEnhancement', () => {
    for (const regime of VIEWER_REGIMES) {
        for (const blessedTea of [false, true]) {
            for (const guzzlingBonus of [1, 1.35]) {
                test(`${regime.name}, blessed=${blessedTea}, guzzling=${guzzlingBonus}`, () => {
                    const table = calculateScoreEnhancementExpectationTables({
                        enhancingLevel: regime.enhancingLevel,
                        toolBonus: regime.toolBonus,
                        itemLevel: regime.itemLevel,
                        blessedTea,
                        guzzlingBonus,
                    });

                    for (const targetLevel of TARGETS) {
                        const protectFromCandidates = new Set(
                            [0, middleProtectFrom(targetLevel), targetLevel].filter((p) => p === 0 || p >= 2)
                        );
                        const startCandidates = new Set([0, middleStart(targetLevel), targetLevel - 1]);

                        for (const protectFrom of protectFromCandidates) {
                            const strategy = table.targets[targetLevel].find((s) => s.protectFrom === protectFrom);
                            expect(strategy).toBeDefined();

                            for (const startLevel of startCandidates) {
                                const canonical = calculateEnhancement({
                                    enhancingLevel: regime.enhancingLevel,
                                    toolBonus: regime.toolBonus,
                                    itemLevel: regime.itemLevel,
                                    targetLevel,
                                    startLevel,
                                    protectFrom,
                                    blessedTea,
                                    guzzlingBonus,
                                });

                                const kernelAttempts = strategy.attemptsByStart[startLevel];
                                const kernelProtections = strategy.protectionsByStart[startLevel];

                                const attemptsScale = Math.max(1, Math.abs(canonical.attempts));
                                expect(Math.abs(kernelAttempts - canonical.attempts) / attemptsScale).toBeLessThan(
                                    1e-9
                                );

                                const protectionsScale = Math.max(1, Math.abs(canonical.protectionCount));
                                expect(
                                    Math.abs(kernelProtections - canonical.protectionCount) / protectionsScale
                                ).toBeLessThan(1e-9);
                            }
                        }
                    }
                });
            }
        }
    }
});

describe('calculateScoreEnhancementExpectationTables - PSP-05 one table covers every start K', () => {
    test('a single call returns correct statistics for every start level below the target, for every strategy', () => {
        const table = calculateScoreEnhancementExpectationTables({
            enhancingLevel: 140,
            toolBonus: 8,
            itemLevel: 100,
            blessedTea: true,
            guzzlingBonus: 1.2,
            maxTarget: 12,
        });

        const targetLevel = 12;
        for (const strategy of table.targets[targetLevel]) {
            expect(strategy.attemptsByStart).toHaveLength(targetLevel);
            expect(strategy.protectionsByStart).toHaveLength(targetLevel);

            for (let startLevel = 0; startLevel < targetLevel; startLevel++) {
                const canonical = calculateEnhancement({
                    enhancingLevel: 140,
                    toolBonus: 8,
                    itemLevel: 100,
                    targetLevel,
                    startLevel,
                    protectFrom: strategy.protectFrom,
                    blessedTea: true,
                    guzzlingBonus: 1.2,
                });

                const attemptsScale = Math.max(1, Math.abs(canonical.attempts));
                expect(
                    Math.abs(strategy.attemptsByStart[startLevel] - canonical.attempts) / attemptsScale
                ).toBeLessThan(1e-9);
            }
        }
    });

    test('one call computes tables for every target 1..maxTarget, not just the highest', () => {
        const table = calculateScoreEnhancementExpectationTables({
            enhancingLevel: 140,
            toolBonus: 8,
            itemLevel: 100,
            maxTarget: 20,
        });

        for (let targetLevel = 1; targetLevel <= 20; targetLevel++) {
            expect(table.targets[targetLevel]).toBeDefined();
            expect(table.targets[targetLevel].length).toBeGreaterThan(0);
        }
    });
});

describe('calculateScoreEnhancementExpectationTables - input validation', () => {
    test('throws on non-finite viewer parameters', () => {
        expect(() => calculateScoreEnhancementExpectationTables({ enhancingLevel: NaN, itemLevel: 100 })).toThrow();
    });

    test('throws on out-of-range maxTarget', () => {
        expect(() =>
            calculateScoreEnhancementExpectationTables({ enhancingLevel: 100, itemLevel: 100, maxTarget: 21 })
        ).toThrow();
        expect(() =>
            calculateScoreEnhancementExpectationTables({ enhancingLevel: 100, itemLevel: 100, maxTarget: 0 })
        ).toThrow();
    });
});
