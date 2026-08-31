import { describe, expect, test } from 'vitest';
import {
    calculateLevelGapDebuff,
    calculateCombatLevelFromLevelFields,
    computeOomPercent,
    calculateExpectedDrops,
} from './combat-sim-adapter.js';

describe('calculateLevelGapDebuff', () => {
    // SERVER-CONFIRMED (direct MWI developer evidence):
    //   effectiveThreshold := max(1.2, (combatLevel+10)/combatLevel)
    //   if effectiveThreshold*combatLevel < topCombatLevel {
    //       multiplier = max(0.1, 1.0-3.0*(topCombatLevel/combatLevel-effectiveThreshold))
    //   }
    // combatLevel/topCombatLevel are the raw (unfloored) whole-skill Combat Level.

    test('B: exact 20% boundary (CL 100 / top 120) -> no malus (strict comparison)', () => {
        expect(calculateLevelGapDebuff(100, 120)).toBe(0);
    });

    test('C: just above the 20% boundary (CL 100 / top 120.1) -> continuous, unquantized malus', () => {
        // effectiveThreshold = 1.2, multiplier = 1 - 3*(1.201-1.2) = 0.997 -> debuff -0.003
        expect(calculateLevelGapDebuff(100, 120.1)).toBeCloseTo(-0.003, 6);
    });

    test('D: exactly +10 below CL 50 (CL 40 / top 50.0) -> no malus (effectiveThreshold dominates)', () => {
        // effectiveThreshold = max(1.2, 50/40) = 1.25; 1.25*40 = 50, not < 50 -> no malus
        expect(calculateLevelGapDebuff(40, 50.0)).toBe(0);
    });

    test('E: just above +10 below CL 50 (CL 40 / top 50.1)', () => {
        // effectiveThreshold = 1.25, multiplier = 1 - 3*(50.1/40 - 1.25) = 0.9925 -> debuff -0.0075
        expect(calculateLevelGapDebuff(40, 50.1)).toBeCloseTo(-0.0075, 6);
    });

    test('F: below-50 penalty baseline uses effectiveThreshold, not a fixed 1.2 (CL 40 / top 51)', () => {
        // effectiveThreshold = 1.25, ratio = 1.275, multiplier = 1 - 3*0.025 = 0.925 -> debuff -0.075
        expect(calculateLevelGapDebuff(40, 51)).toBeCloseTo(-0.075, 6);
    });

    test('G: maximum penalty cap (CL 100 / top 150) -> -0.9, and larger gaps stay capped', () => {
        expect(calculateLevelGapDebuff(100, 150)).toBeCloseTo(-0.9, 6);
        expect(calculateLevelGapDebuff(100, 1000)).toBe(-0.9);
    });

    test("no debuff for the party's own highest-level player (ratio of exactly 1)", () => {
        expect(calculateLevelGapDebuff(150, 150)).toBe(0);
    });

    test('no debuff when below the 1.2 ratio and the +10 gap', () => {
        expect(calculateLevelGapDebuff(100, 110)).toBe(0);
    });

    test('is always 0 or negative, never a bonus', () => {
        for (const [level, maxLevel] of [
            [50, 50],
            [50, 55],
            [50, 60],
            [50, 100],
        ]) {
            expect(calculateLevelGapDebuff(level, maxLevel)).toBeLessThanOrEqual(0);
        }
    });

    test('H: unfloored raw Combat Level changes eligibility at a real discrete boundary', () => {
        // Developer example: self raw CL 133.2, top raw CL 159.9.
        // Raw ratio 159.9/133.2 > 1.2 -> malus applies (must not be quantized to zero).
        // If incorrectly floored to 133/159, 159/133 < 1.2 -> malus would incorrectly disappear.
        expect(calculateLevelGapDebuff(133.2, 159.9)).toBeCloseTo(-0.001351351351, 9);
        expect(calculateLevelGapDebuff(133, 159)).toBe(0);
    });
});

describe('calculateCombatLevelFromLevelFields', () => {
    test('A: computes the raw (unfloored) combat level from combatDetails-shaped whole-skill-level fields', () => {
        // Developer example: Stamina 125, Intelligence 124, Attack 130, Defense 125, Melee 105,
        // Ranged 138, Magic 77 -> raw formula = 133.2. SERVER-CONFIRMED: this raw value, not the
        // floored native 133, is the actual Level Malus mechanic input.
        const result = calculateCombatLevelFromLevelFields({
            staminaLevel: 125,
            intelligenceLevel: 124,
            attackLevel: 130,
            defenseLevel: 125,
            meleeLevel: 105,
            rangedLevel: 138,
            magicLevel: 77,
        });
        expect(result).toBe(133.2);
    });

    test('J: no XP-within-level regression - whole levels only, never a value like 133.39', () => {
        const result = calculateCombatLevelFromLevelFields({
            staminaLevel: 125,
            intelligenceLevel: 124,
            attackLevel: 130,
            defenseLevel: 125,
            meleeLevel: 105,
            rangedLevel: 138,
            magicLevel: 77,
        });
        expect(result).not.toBeCloseTo(133.39, 1);
        expect(result).toBe(133.2);
    });
});

describe('computeOomPercent (UI-001) - time-based OOM %, not count-based', () => {
    test('exact zero OOM time returns exactly 0', () => {
        const simResult = {
            simulatedTime: 1000,
            playerRanOutOfManaTime: {
                player1: { isOutOfMana: false, startTimeForOutOfMana: 0, totalTimeForOutOfMana: 0 },
            },
        };
        expect(computeOomPercent(simResult, 'player1')).toBe(0);
    });

    test('a closed OOM window computes the exact percentage', () => {
        const simResult = {
            simulatedTime: 1000,
            playerRanOutOfManaTime: {
                player1: { isOutOfMana: false, startTimeForOutOfMana: 0, totalTimeForOutOfMana: 50 },
            },
        };
        expect(computeOomPercent(simResult, 'player1')).toBeCloseTo(5);
    });

    test('an open final OOM window includes only [start, simulatedTime)', () => {
        const simResult = {
            simulatedTime: 1000,
            playerRanOutOfManaTime: {
                player1: { isOutOfMana: true, startTimeForOutOfMana: 900, totalTimeForOutOfMana: 0 },
            },
        };
        // Open window contributes (1000 - 900) = 100ns on top of the 0 closed total.
        expect(computeOomPercent(simResult, 'player1')).toBeCloseTo(10);
    });

    test('closed + open windows combine correctly', () => {
        const simResult = {
            simulatedTime: 1000,
            playerRanOutOfManaTime: {
                player1: { isOutOfMana: true, startTimeForOutOfMana: 950, totalTimeForOutOfMana: 20 },
            },
        };
        // (20 closed + 50 open) / 1000 = 7%
        expect(computeOomPercent(simResult, 'player1')).toBeCloseTo(7);
    });

    test('missing data for a player returns null rather than a fabricated 0', () => {
        const simResult = { simulatedTime: 1000, playerRanOutOfManaTime: {} };
        expect(computeOomPercent(simResult, 'player1')).toBeNull();
    });
});

describe('calculateExpectedDrops - kill-time-context multipliers used when available (CSIM-AUD-011)', () => {
    function baseSimResult(overrides = {}) {
        return {
            deaths: { '/monsters/bear': 10 },
            dropRateMultiplier: { player1: 2.0 }, // stale end-of-run snapshot
            rareFindMultiplier: { player1: 1 },
            combatDropQuantity: { player1: 0 },
            debuffOnLevelGap: { player1: 0 },
            numberOfPlayers: 1,
            difficultyTier: 0,
            isDungeon: false,
            ...overrides,
        };
    }

    const gameData = {
        combatMonsterDetailMap: {
            '/monsters/bear': {
                dropTable: [{ itemHrid: '/items/log', dropRate: 0.5, minCount: 1, maxCount: 1, minDifficultyTier: 0 }],
            },
        },
    };

    test('falls back to the end-of-run snapshot when no kill-time context is present (legacy SimResult)', () => {
        const result = baseSimResult();
        const drops = calculateExpectedDrops(result, gameData, 'player1');
        // 10 kills * rate(0.5) * 2.0 snapshot multiplier * avgCount(1) = 10
        expect(drops.get('/items/log')).toBeCloseTo(10);
    });

    test('uses the kill-weighted average from killDropContext instead of the stale end-of-run snapshot', () => {
        const result = baseSimResult({
            killDropContext: {
                '/monsters/bear': {
                    killCount: 10,
                    byPlayer: {
                        // 5 kills at 1.0x + 5 kills at 2.0x = kill-weighted average 1.5x, not the 2.0 snapshot.
                        player1: {
                            sumDropRateMultiplier: 5 * 1.0 + 5 * 2.0,
                            sumRareFindMultiplier: 10,
                            sumCombatDropQuantity: 0,
                        },
                    },
                },
            },
        });

        const drops = calculateExpectedDrops(result, gameData, 'player1');
        // 10 kills * rate(0.5) * 1.5 average multiplier * avgCount(1) = 7.5, not 10.
        expect(drops.get('/items/log')).toBeCloseTo(7.5);
    });
});
