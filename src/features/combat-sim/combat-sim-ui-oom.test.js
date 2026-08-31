import { describe, expect, test } from 'vitest';
import combatSimUI from './combat-sim-ui.js';

describe('CombatSimUI._formatOomCell (UI-001 display contract)', () => {
    test('exact zero -> "No" in neutral color, never green', () => {
        const cell = combatSimUI._formatOomCell(0);
        expect(cell.text).toBe('No');
        expect(cell.color).not.toBe('#4caf50');
        expect(cell.color).not.toMatch(/4ade80|7ec87e/);
    });

    test('positive but below 0.1% -> "<0.1%" in the same neutral color as "No"', () => {
        const zero = combatSimUI._formatOomCell(0);
        const tiny = combatSimUI._formatOomCell(0.05);
        expect(tiny.text).toBe('<0.1%');
        expect(tiny.color).toBe(zero.color);
    });

    test('never renders a misleading "0.0%" for a real positive sub-0.1% value', () => {
        const cell = combatSimUI._formatOomCell(0.02);
        expect(cell.text).not.toBe('0.0%');
    });

    test('0.1% and above -> red, one decimal place', () => {
        expect(combatSimUI._formatOomCell(0.1)).toEqual({ text: '0.1%', color: '#f44336' });
        expect(combatSimUI._formatOomCell(3.7)).toEqual({ text: '3.7%', color: '#f44336' });
        expect(combatSimUI._formatOomCell(12.34)).toEqual({ text: '12.3%', color: '#f44336' });
    });

    test('null (no data) renders a plain dash, not a fabricated value', () => {
        const cell = combatSimUI._formatOomCell(null);
        expect(cell.text).toBe('—');
    });
});

describe('CombatSimUI._ensureHistoryMetrics - per-player keyed cache (UI-001 staleness fix)', () => {
    function makeSimResult(playerHrid, oomTimeNs) {
        return {
            encounters: 10,
            simulatedTime: 1000,
            totalDamageDealt: {},
            experienceGained: { [playerHrid]: { attack: 100 } },
            consumablesUsed: { [playerHrid]: {} },
            playerRanOutOfManaTime: {
                [playerHrid]: { isOutOfMana: false, startTimeForOutOfMana: 0, totalTimeForOutOfMana: oomTimeNs },
            },
        };
    }

    test("switching the active player recomputes metrics for the new player instead of reusing the first-computed player's cached values", () => {
        const simResult = {
            encounters: 10,
            simulatedTime: 1000,
            totalDamageDealt: {},
            experienceGained: { player1: { attack: 100 }, player2: { attack: 500 } },
            consumablesUsed: { player1: {}, player2: {} },
            playerRanOutOfManaTime: {
                player1: { isOutOfMana: false, startTimeForOutOfMana: 0, totalTimeForOutOfMana: 0 },
                player2: { isOutOfMana: false, startTimeForOutOfMana: 0, totalTimeForOutOfMana: 500 },
            },
        };
        combatSimUI._simHistory = [{ simResult, hours: 1, gameData: null, label: 'test' }];

        combatSimUI._ensureHistoryMetrics(simResult, 1, null, 'player1');
        combatSimUI._ensureHistoryMetrics(simResult, 1, null, 'player2');

        const entry = combatSimUI._simHistory[0];
        expect(entry.metricsByPlayer.player1.totalXpPerHr).toBe(100);
        expect(entry.metricsByPlayer.player2.totalXpPerHr).toBe(500);
        expect(entry.metricsByPlayer.player1).not.toEqual(entry.metricsByPlayer.player2);

        combatSimUI._simHistory = [];
    });

    test('each player gets its own independent metrics entry, not a single overwritten cache slot', () => {
        const simResult = makeSimResult('player1', 100);
        combatSimUI._simHistory = [{ simResult, hours: 1, gameData: null, label: 'test' }];

        combatSimUI._ensureHistoryMetrics(simResult, 1, null, 'player1');
        const entry = combatSimUI._simHistory[0];

        expect(Object.keys(entry.metricsByPlayer)).toEqual(['player1']);

        combatSimUI._simHistory = [];
    });
});
