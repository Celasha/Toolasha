import { describe, expect, test } from 'vitest';
import { BattleEventTracker } from './battle-event-tracker.js';
import { BattleStats } from './battle-stats.js';

const player = (overrides = {}) => ({
    character: { id: 1, name: 'Alice' },
    currentHitpoints: 1000,
    maxHitpoints: 1000,
    currentManapoints: 500,
    maxManapoints: 500,
    damageSplatCounter: 0,
    criticalDamageSplatCounter: 0,
    attackAttemptCounter: 0,
    ...overrides,
});

const monster = (overrides = {}) => ({
    hrid: '/monsters/fly',
    currentHitpoints: 300,
    maxHitpoints: 300,
    currentManapoints: 0,
    maxManapoints: 0,
    damageSplatCounter: 0,
    criticalDamageSplatCounter: 0,
    attackAttemptCounter: 0,
    ...overrides,
});

const update = (pMap = {}, mMap = {}, battleId = 7) => ({ battleId, pMap, mMap });

function startBattle(players = [player()], monsters = [monster()]) {
    const tracker = new BattleEventTracker();
    tracker.handleNewBattle({ battleId: 7, wave: 0, combatStartTime: 'x', players, monsters });
    return tracker;
}

describe('BattleEventTracker', () => {
    test('damage is the HP lost when the damage counter moved', () => {
        const tracker = startBattle();

        const events = tracker.handleBattleUpdated(
            update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1, critCounter: 0 } })
        );

        expect(events).toEqual([
            expect.objectContaining({
                type: 'damage',
                side: 'm',
                hrid: '/monsters/fly',
                amount: 50,
                crit: false,
                miss: false,
            }),
        ]);
    });

    test('a hit is critical when the damage counter equals the critical counter', () => {
        const tracker = startBattle();

        const [event] = tracker.handleBattleUpdated(
            update({}, { 0: { cHP: 200, mHP: 300, dmgCounter: 1, critCounter: 1 } })
        );

        expect(event.crit).toBe(true);
    });

    test('a damage splat that took no HP is a miss', () => {
        const tracker = startBattle();

        const [event] = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, dmgCounter: 1 } })
        );

        expect(event).toEqual(expect.objectContaining({ type: 'damage', amount: 0, miss: true, side: 'p' }));
    });

    test('HP going up is a heal, but coming back from 0 HP is a respawn', () => {
        const tracker = startBattle([player({ currentHitpoints: 400 })]);
        const [heal] = tracker.handleBattleUpdated(update({ 0: { cHP: 450, mHP: 1000, cMP: 500, mMP: 500 } }));
        expect(heal).toEqual(expect.objectContaining({ type: 'heal', amount: 50 }));

        const dead = startBattle([player({ currentHitpoints: 0 })]);
        const [revive] = dead.handleBattleUpdated(update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500 } }));
        expect(revive.type).toBe('revive');
    });

    test('taking a unit to 0 HP is a death as well as a hit', () => {
        const tracker = startBattle();

        const events = tracker.handleBattleUpdated(
            update({}, { 0: { cHP: 0, mHP: 300, dmgCounter: 1, critCounter: 0 } })
        );

        expect(events.map((event) => event.type)).toEqual(['damage', 'death']);
    });

    test('mana spent is tied to the ability the same unit is preparing', () => {
        const tracker = startBattle();

        const events = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 440, mMP: 500, abilityHrid: '/abilities/fireball' } })
        );

        expect(events).toEqual([
            expect.objectContaining({ type: 'mana-spend', amount: 60, abilityHrid: '/abilities/fireball' }),
        ]);
    });

    test('mana going up is a gain', () => {
        const tracker = startBattle([player({ currentManapoints: 100 })]);

        const [event] = tracker.handleBattleUpdated(update({ 0: { cHP: 1000, mHP: 1000, cMP: 105, mMP: 500 } }));

        expect(event).toEqual(expect.objectContaining({ type: 'mana-gain', amount: 5 }));
    });

    test('a new attack attempt reports what the unit started preparing', () => {
        const tracker = startBattle();

        const [event] = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 1, isAutoAtk: true, int: 3e9 } })
        );

        expect(event).toEqual(expect.objectContaining({ type: 'attack', auto: true, intervalMs: 3000 }));
    });

    test('updates only touch the units they mention (maps are sparse)', () => {
        const tracker = startBattle([player()], [monster(), monster({ hrid: '/monsters/bee' })]);

        tracker.handleBattleUpdated(update({}, { 1: { cHP: 100, mHP: 300, dmgCounter: 1, critCounter: 0 } }));

        expect(tracker.getUnit('m', 0).hp).toBe(300);
        expect(tracker.getUnit('m', 1).hp).toBe(100);
    });

    test('ignores updates for a different battle, like the game client does', () => {
        const tracker = startBattle();

        const events = tracker.handleBattleUpdated(
            update({}, { 0: { cHP: 10, mHP: 300, dmgCounter: 1, critCounter: 0 } }, 99)
        );

        expect(events).toEqual([]);
        expect(tracker.getUnit('m', 0).hp).toBe(300);
    });

    test('a new_battle replaces the monsters, so the next wave starts fresh', () => {
        const tracker = startBattle();
        tracker.handleBattleUpdated(update({}, { 0: { cHP: 0, mHP: 300, dmgCounter: 1, critCounter: 0 } }));

        tracker.handleNewBattle({ battleId: 7, wave: 1, players: [player()], monsters: [monster()] });

        expect(tracker.getUnit('m', 0).hp).toBe(300);
    });

    test('reset forgets the battle', () => {
        const tracker = startBattle();

        tracker.reset();

        expect(tracker.handleBattleUpdated(update({}, { 0: { cHP: 1, mHP: 300, dmgCounter: 1 } }))).toEqual([]);
    });
});

describe('BattleStats', () => {
    function run(steps, players = [player()], monsters = [monster()]) {
        const tracker = startBattle(players, monsters);
        const stats = new BattleStats();
        stats.setPlayers(players.map((unit) => unit.character.name));
        for (const [at, message] of steps) {
            stats.record(tracker.handleBattleUpdated(message), at);
        }
        return stats.getSummary();
    }

    test('party damage is what the monsters received, with crits and misses counted', () => {
        const summary = run([
            [0, update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1, critCounter: 0 } })],
            [1000, update({}, { 0: { cHP: 150, mHP: 300, dmgCounter: 2, critCounter: 2 } })],
            [2000, update({}, { 0: { cHP: 150, mHP: 300, dmgCounter: 3, critCounter: 2 } })],
        ]);

        expect(summary.party).toEqual(expect.objectContaining({ damage: 150, hits: 3, crits: 1, misses: 1 }));
        expect(summary.party.dps).toBe(75);
    });

    test('true DPS uses the max HP of what died, not the damage that landed', () => {
        const summary = run([
            [0, update({}, { 0: { cHP: 100, mHP: 300, dmgCounter: 1, critCounter: 0 } })],
            [2000, update({}, { 0: { cHP: 0, mHP: 300, dmgCounter: 2, critCounter: 0 } })],
        ]);

        expect(summary.party.kills).toBe(1);
        expect(summary.party.trueDps).toBe(150);
        expect(summary.monsters[0]).toEqual(expect.objectContaining({ hrid: '/monsters/fly', kills: 1, damage: 300 }));
    });

    test('a gap longer than the session gap is not counted as combat time', () => {
        const summary = run([
            [0, update({}, { 0: { cHP: 290, mHP: 300, dmgCounter: 1, critCounter: 0 } })],
            [1000, update({}, { 0: { cHP: 280, mHP: 300, dmgCounter: 2, critCounter: 0 } })],
            [601000, update({}, { 0: { cHP: 270, mHP: 300, dmgCounter: 3, critCounter: 0 } })],
        ]);

        expect(summary.seconds).toBe(1);
    });

    test('damage taken, deaths and healing are tracked per player', () => {
        const summary = run([
            [0, update({ 0: { cHP: 600, mHP: 1000, cMP: 500, mMP: 500, dmgCounter: 1 } })],
            [1000, update({ 0: { cHP: 650, mHP: 1000, cMP: 500, mMP: 500, dmgCounter: 1 } })],
            [2000, update({ 0: { cHP: 0, mHP: 1000, cMP: 500, mMP: 500, dmgCounter: 2 } })],
        ]);

        expect(summary.players[0]).toEqual(
            expect.objectContaining({ name: 'Alice', damage: 1050, hits: 2, healed: 50, deaths: 1 })
        );
    });

    test('mana spent is grouped by ability', () => {
        const spend = (mp, ability) => update({ 0: { cHP: 1000, mHP: 1000, cMP: mp, mMP: 500, abilityHrid: ability } });
        const summary = run([
            [0, spend(440, '/abilities/fireball')],
            [1000, spend(380, '/abilities/fireball')],
            [2000, spend(370, '/abilities/poke')],
        ]);

        expect(summary.players[0].manaSpent).toBe(130);
        expect(summary.players[0].abilityMana[0]).toEqual(
            expect.objectContaining({ abilityHrid: '/abilities/fireball', mana: 120, events: 2 })
        );
    });

    test('per-player damage is only exact when one player is in the battle', () => {
        expect(run([], [player()]).attributionExact).toBe(true);
        expect(run([], [player(), player({ character: { id: 2, name: 'Bob' } })]).attributionExact).toBe(false);
    });

    describe('who dealt the damage', () => {
        const bob = () => player({ character: { id: 2, name: 'Bob' } });
        const swing = (index, hp, dmgCounter) =>
            update({ [index]: { atkCounter: 1, isAutoAtk: true } }, { 0: { cHP: hp, mHP: 300, dmgCounter } });

        test('alone, every monster hit is yours and the figure is exact', () => {
            const summary = run([[0, update({}, { 0: { cHP: 200, mHP: 300, dmgCounter: 1 } })]]);

            expect(summary.attributionExact).toBe(true);
            expect(summary.dealt).toEqual([expect.objectContaining({ name: 'Alice', damage: 100, hits: 1 })]);
            expect(summary.unattributed.damage).toBe(0);
        });

        test('in a party, a hit goes to the one player who started an attack in the same message', () => {
            const summary = run(
                [
                    [0, swing(1, 250, 1)],
                    [1000, swing(0, 200, 2)],
                ],
                [player(), bob()]
            );

            expect(summary.attributionExact).toBe(false);
            expect(summary.dealt).toEqual([
                expect.objectContaining({ name: 'Alice', damage: 50 }),
                expect.objectContaining({ name: 'Bob', damage: 50 }),
            ]);
            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 0, share: 0 }));
        });

        test('when two players started attacks in the same message, the hit is left unattributed', () => {
            const both = update(
                { 0: { atkCounter: 1 }, 1: { atkCounter: 1 } },
                { 0: { cHP: 250, mHP: 300, dmgCounter: 1 } }
            );

            const summary = run([[0, both]], [player(), bob()]);

            expect(summary.dealt.map((row) => row.damage)).toEqual([0, 0]);
            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 50, hits: 1, share: 1 }));
        });

        test('a hit in a message where nobody started an attack is left unattributed', () => {
            const summary = run([[0, update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1 } })]], [player(), bob()]);

            expect(summary.unattributed.damage).toBe(50);
        });

        test('credited and unattributed damage always add up to the party total', () => {
            const summary = run(
                [
                    [0, swing(0, 250, 1)],
                    [1000, update({}, { 0: { cHP: 150, mHP: 300, dmgCounter: 2 } })],
                ],
                [player(), bob()]
            );

            const credited = summary.dealt.reduce((sum, row) => sum + row.damage, 0);
            expect(credited + summary.unattributed.damage).toBe(summary.party.damage);
        });

        test('a crit and a miss are credited like any other hit', () => {
            const swingCrit = update(
                { 0: { atkCounter: 1 } },
                { 0: { cHP: 200, mHP: 300, dmgCounter: 1, critCounter: 1 } }
            );
            const swingMiss = update(
                { 0: { atkCounter: 2 } },
                { 0: { cHP: 200, mHP: 300, dmgCounter: 2, critCounter: 1 } }
            );

            const summary = run(
                [
                    [0, swingCrit],
                    [1000, swingMiss],
                ],
                [player(), bob()]
            );

            expect(summary.dealt[0]).toEqual(expect.objectContaining({ name: 'Alice', hits: 2, crits: 1, misses: 1 }));
        });
    });
});
