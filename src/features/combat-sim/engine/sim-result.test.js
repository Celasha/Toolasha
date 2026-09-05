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

describe('SimResult.addDungeonCompletionDuration (TLA-039 HZN)', () => {
    test('accumulates successful completed-run durations, independent of dungeonsCompleted itself', () => {
        const simResult = new SimResult(makeZone(), 1);

        simResult.addDungeonCompletionDuration(4_000_000_000);
        simResult.addDungeonCompletionDuration(6_000_000_000);

        expect(simResult.totalDungeonCompletionDuration).toBe(10_000_000_000);
    });

    test('starts at zero for a fresh result', () => {
        const simResult = new SimResult(makeZone(), 1);
        expect(simResult.totalDungeonCompletionDuration).toBe(0);
    });
});

describe('SimResult.addAttack - totalDamageDealt accounting, no exact-damage histogram (TLA-039 PERF)', () => {
    function makeUnit(hrid) {
        return { hrid };
    }

    test('PERF-03/04: accumulates totalDamageDealt per source exactly as before, unaffected by the histogram removal', () => {
        const simResult = new SimResult(makeZone(), 1);
        const source = makeUnit('player1');
        const target = makeUnit('/monsters/bear');

        simResult.addAttack(source, target, 'autoAttack', 10);
        simResult.addAttack(source, target, 'autoAttack', 15);

        expect(simResult.totalDamageDealt.player1).toBe(25);
    });

    test('a miss contributes nothing to totalDamageDealt', () => {
        const simResult = new SimResult(makeZone(), 1);
        const source = makeUnit('player1');
        const target = makeUnit('/monsters/bear');

        simResult.addAttack(source, target, 'autoAttack', 'miss');

        expect(simResult.totalDamageDealt.player1).toBeUndefined();
    });

    test('multiple sources accumulate independently', () => {
        const simResult = new SimResult(makeZone(), 2);
        const target = makeUnit('/monsters/bear');

        simResult.addAttack(makeUnit('player1'), target, 'autoAttack', 10);
        simResult.addAttack(makeUnit('player2'), target, 'autoAttack', 20);

        expect(simResult.totalDamageDealt.player1).toBe(10);
        expect(simResult.totalDamageDealt.player2).toBe(20);
    });

    test('PERF-02: no per-attack exact-damage histogram is written or exposed - only totalDamageDealt is a public result', () => {
        const simResult = new SimResult(makeZone(), 1);
        simResult.addAttack(makeUnit('player1'), makeUnit('/monsters/bear'), 'autoAttack', 10);

        expect(simResult.attacks).toBeUndefined();
    });

    test('addAttack tolerates unused target/ability arguments (kept for call-site compatibility) without touching unrelated result fields', () => {
        const simResult = new SimResult(makeZone(), 1);
        simResult.addAttack(makeUnit('player1'), makeUnit('/monsters/bear'), 'retaliation', 5);

        expect(simResult.deaths).toEqual({});
        expect(simResult.experienceGained).toEqual({});
        expect(simResult.dungeonCompletionDropContext).toEqual({ count: 0, byPlayer: {} });
    });
});
