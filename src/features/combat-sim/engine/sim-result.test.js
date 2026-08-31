import { describe, expect, test } from 'vitest';
import SimResult from './sim-result.js';

function makeZone() {
    return { hrid: '/actions/combat/test_zone', difficultyTier: 0 };
}

function makePlayer(hrid, dropRate, rareFind = 0, dropQuantity = 0) {
    return {
        hrid,
        combatDetails: {
            combatStats: { combatDropRate: dropRate, combatRareFind: rareFind, combatDropQuantity: dropQuantity },
        },
    };
}

describe('SimResult.recordMonsterKill - kill-time-context drop accounting (CSIM-AUD-011)', () => {
    test('accumulates one kill at whatever multiplier was active at that instant', () => {
        const simResult = new SimResult(makeZone(), 1);
        const player = makePlayer('player1', 0.5); // dropRateMultiplier = 1.5 at kill time

        simResult.recordMonsterKill('/monsters/bear', [player]);

        const context = simResult.killDropContext['/monsters/bear'];
        expect(context.killCount).toBe(1);
        expect(context.byPlayer.player1.sumDropRateMultiplier).toBeCloseTo(1.5);
    });

    test('a buff active for only part of the run produces a kill-weighted average, not the final snapshot', () => {
        const simResult = new SimResult(makeZone(), 1);

        // 5 kills at base rate (multiplier 1.0), then a +100% drop buff kicks in for 5 more kills (multiplier 2.0)
        const baselinePlayer = makePlayer('player1', 0);
        const boostedPlayer = makePlayer('player1', 1.0);
        for (let i = 0; i < 5; i++) simResult.recordMonsterKill('/monsters/bear', [baselinePlayer]);
        for (let i = 0; i < 5; i++) simResult.recordMonsterKill('/monsters/bear', [boostedPlayer]);

        const context = simResult.killDropContext['/monsters/bear'];
        const avgMultiplier = context.byPlayer.player1.sumDropRateMultiplier / context.killCount;

        // Average of 5x1.0 + 5x2.0 over 10 kills = 1.5, not the final snapshot's 2.0.
        expect(avgMultiplier).toBeCloseTo(1.5);
        expect(avgMultiplier).not.toBeCloseTo(2.0);
    });

    test('kills of different monsters are tracked independently', () => {
        const simResult = new SimResult(makeZone(), 1);
        const player = makePlayer('player1', 0);

        simResult.recordMonsterKill('/monsters/bear', [player]);
        simResult.recordMonsterKill('/monsters/rat', [player]);
        simResult.recordMonsterKill('/monsters/rat', [player]);

        expect(simResult.killDropContext['/monsters/bear'].killCount).toBe(1);
        expect(simResult.killDropContext['/monsters/rat'].killCount).toBe(2);
    });

    test('multiple players in a party each get their own tracked context for the same kill', () => {
        const simResult = new SimResult(makeZone(), 2);
        const p1 = makePlayer('player1', 0.2);
        const p2 = makePlayer('player2', 0.8);

        simResult.recordMonsterKill('/monsters/bear', [p1, p2]);

        const context = simResult.killDropContext['/monsters/bear'];
        expect(context.byPlayer.player1.sumDropRateMultiplier).toBeCloseTo(1.2);
        expect(context.byPlayer.player2.sumDropRateMultiplier).toBeCloseTo(1.8);
    });
});

describe('SimResult.recordDungeonCompletion - kill-time-context for dungeon rewards (CSIM-AUD-011)', () => {
    test('accumulates combatDropQuantity per completion, kill-weighted-average not end-snapshot', () => {
        const simResult = new SimResult(makeZone(), 1);
        const baselinePlayer = makePlayer('player1', 0, 0, 0);
        const boostedPlayer = makePlayer('player1', 0, 0, 1.0);

        simResult.recordDungeonCompletion([baselinePlayer]);
        simResult.recordDungeonCompletion([boostedPlayer]);

        const context = simResult.dungeonCompletionDropContext;
        const avg = context.byPlayer.player1.sumCombatDropQuantity / context.count;
        expect(avg).toBeCloseTo(0.5);
    });
});
