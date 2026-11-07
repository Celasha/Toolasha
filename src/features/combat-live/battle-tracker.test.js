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

    test('mana spent belongs to the ability prepared before the update, not the one being wound up now', () => {
        const tracker = startBattle([player({ preparingAbilityHrid: '/abilities/fireball', attackAttemptCounter: 3 })]);

        const events = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 440, mMP: 500, atkCounter: 4, abilityHrid: '/abilities/poke' } })
        );

        expect(events).toContainEqual(
            expect.objectContaining({ type: 'mana-spend', amount: 60, abilityHrid: '/abilities/fireball' })
        );
    });

    test('a mana drop in an update where the unit did not act has no known ability', () => {
        const tracker = startBattle([player({ preparingAbilityHrid: '/abilities/fireball' })]);

        const [event] = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 440, mMP: 500, abilityHrid: '/abilities/fireball' } })
        );

        expect(event).toEqual(expect.objectContaining({ type: 'mana-spend', abilityHrid: '' }));
    });

    test('mana spent during an auto attack is not charged to an ability', () => {
        const tracker = startBattle([player({ isPreparingAutoAttack: true, attackAttemptCounter: 1 })]);

        const events = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 495, mMP: 500, atkCounter: 2, abilityHrid: '/abilities/poke' } })
        );

        expect(events).toContainEqual(expect.objectContaining({ type: 'mana-spend', abilityHrid: '' }));
    });

    test('mana going up is a gain', () => {
        const tracker = startBattle([player({ currentManapoints: 100 })]);

        const [event] = tracker.handleBattleUpdated(update({ 0: { cHP: 1000, mHP: 1000, cMP: 105, mMP: 500 } }));

        expect(event).toEqual(expect.objectContaining({ type: 'mana-gain', amount: 5 }));
    });

    test('an attack reports the ability that just ran and the one now being wound up', () => {
        const tracker = startBattle([player({ preparingAbilityHrid: '/abilities/fireball', attackAttemptCounter: 3 })]);

        const [event] = tracker.handleBattleUpdated(
            update({
                0: {
                    cHP: 1000,
                    mHP: 1000,
                    cMP: 500,
                    mMP: 500,
                    atkCounter: 4,
                    abilityHrid: '/abilities/poke',
                    int: 3e9,
                },
            })
        );

        expect(event).toEqual(
            expect.objectContaining({
                type: 'attack',
                auto: false,
                abilityHrid: '/abilities/fireball',
                nextAbilityHrid: '/abilities/poke',
                intervalMs: 3000,
            })
        );
    });

    test('an auto attack is reported as auto with no ability', () => {
        const tracker = startBattle([player({ isPreparingAutoAttack: true, attackAttemptCounter: 1 })]);

        const [event] = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 2, isAutoAtk: true } })
        );

        expect(event).toEqual(expect.objectContaining({ type: 'attack', auto: true, abilityHrid: '' }));
    });

    test('an action with nothing known prepared is unknown, not an auto attack', () => {
        const tracker = startBattle([player({ attackAttemptCounter: 1 })]);

        const [event] = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 2, abilityHrid: '/abilities/poke' } })
        );

        expect(event).toEqual(expect.objectContaining({ type: 'attack', auto: false, abilityHrid: '' }));
    });

    test('a counter that only repeats its value is not an action', () => {
        const tracker = startBattle([player({ attackAttemptCounter: 5 })]);

        const events = tracker.handleBattleUpdated(
            update({ 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 5 } })
        );

        expect(events).toEqual([]);
    });

    test('a counter tick with no baseline yet is not an action or a hit, so a battle starts clean', () => {
        const noCounters = {
            character: { id: 1, name: 'Alice' },
            currentHitpoints: 1000,
            maxHitpoints: 1000,
            currentManapoints: 500,
            maxManapoints: 500,
        };
        const tracker = startBattle(
            [noCounters],
            [{ hrid: '/monsters/fly', currentHitpoints: 300, maxHitpoints: 300 }]
        );

        const first = tracker.handleBattleUpdated(
            update(
                { 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 37 } },
                { 0: { cHP: 300, mHP: 300, dmgCounter: 12 } }
            )
        );
        const second = tracker.handleBattleUpdated(
            update(
                { 0: { cHP: 1000, mHP: 1000, cMP: 500, mMP: 500, atkCounter: 38 } },
                { 0: { cHP: 250, mHP: 300, dmgCounter: 13 } }
            )
        );

        expect(first).toEqual([]);
        expect(second.map((event) => event.type)).toEqual(['attack', 'damage']);
    });

    test('with no baseline a damaging update still counts as a hit', () => {
        const tracker = startBattle([player()], [{ hrid: '/monsters/fly', currentHitpoints: 300, maxHitpoints: 300 }]);

        const [event] = tracker.handleBattleUpdated(update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 5 } }));

        expect(event).toEqual(expect.objectContaining({ type: 'damage', amount: 50, hits: 1 }));
    });

    test('several hits on one target in a single update are counted', () => {
        const tracker = startBattle();

        const [event] = tracker.handleBattleUpdated(update({}, { 0: { cHP: 100, mHP: 300, dmgCounter: 3 } }));

        expect(event).toEqual(expect.objectContaining({ type: 'damage', amount: 200, hits: 3 }));
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

    test('mana spent is grouped by the ability that was cast', () => {
        const cast = (counter, mp, nextAbility) =>
            update({ 0: { cHP: 1000, mHP: 1000, cMP: mp, mMP: 500, atkCounter: counter, abilityHrid: nextAbility } });
        const caster = player({ preparingAbilityHrid: '/abilities/fireball' });

        const summary = run(
            [
                [0, cast(1, 440, '/abilities/fireball')],
                [1000, cast(2, 380, '/abilities/poke')],
                [2000, cast(3, 370, '')],
            ],
            [caster]
        );

        expect(summary.players[0].manaSpent).toBe(130);
        expect(summary.players[0].abilityMana).toEqual([
            expect.objectContaining({ abilityHrid: '/abilities/fireball', mana: 120, events: 2 }),
            expect.objectContaining({ abilityHrid: '/abilities/poke', mana: 10, events: 1 }),
        ]);
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

        test('says who each hit was credited to, and nobody when it has no owner', () => {
            const tracker = startBattle([player(), bob()], [monster()]);
            const stats = new BattleStats();
            stats.setPlayers(['Alice', 'Bob']);
            const owners = (message) => stats.record(tracker.handleBattleUpdated(message), 0);

            expect(owners(swing(1, 250, 1))).toEqual([
                { index: 0, amount: 50, crit: false, miss: false, player: 'Bob' },
            ]);
            // Nobody acted: damage over time has no owner in a party
            expect(owners(update({}, { 0: { cHP: 200, mHP: 300, dmgCounter: 2 } }))).toEqual([
                { index: 0, amount: 50, crit: false, miss: false, player: null },
            ]);
            expect(owners(update({ 0: { atkCounter: 1 } }, {}))).toEqual([]);
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

        test('a hit counts every counter step, so several hits in one update are all counted', () => {
            const summary = run([[0, update({}, { 0: { cHP: 200, mHP: 300, dmgCounter: 3 } })]]);

            expect(summary.party.hits).toBe(3);
            expect(summary.dealt[0]).toEqual(expect.objectContaining({ damage: 100, hits: 3 }));
        });
    });

    describe('damage by ability', () => {
        const bob = () => player({ character: { id: 2, name: 'Bob' } });
        const strike = (index, hp, dmgCounter, entry = {}) =>
            update({ [index]: { atkCounter: dmgCounter, ...entry } }, { 0: { cHP: hp, mHP: 300, dmgCounter } });

        test('each hit goes to the ability the player had prepared, then auto attack, then over time', () => {
            const caster = player({ preparingAbilityHrid: '/abilities/fireball' });

            const summary = run(
                [
                    [0, strike(0, 250, 1, { abilityHrid: '/abilities/poke' })],
                    [1000, strike(0, 200, 2, { isAutoAtk: true })],
                    [2000, strike(0, 150, 3)],
                    [3000, update({}, { 0: { cHP: 100, mHP: 300, dmgCounter: 4 } })],
                ],
                [caster]
            );

            const byKey = Object.fromEntries(summary.dealt[0].abilities.map((row) => [row.key, row.damage]));
            expect(byKey).toEqual({ '/abilities/fireball': 50, '/abilities/poke': 50, auto: 50, 'over-time': 50 });
            expect(summary.dealt[0].damage).toBe(200);
        });

        test("a party member's hit is credited to the ability that member had prepared", () => {
            const mage = player({ preparingAbilityHrid: '/abilities/fireball' });
            const archer = { ...bob(), isPreparingAutoAttack: true };

            const summary = run(
                [
                    [0, strike(1, 250, 1)],
                    [1000, strike(0, 200, 2)],
                ],
                [mage, archer]
            );

            const alice = summary.dealt.find((row) => row.name === 'Alice');
            const robert = summary.dealt.find((row) => row.name === 'Bob');
            expect(alice.abilities).toEqual([expect.objectContaining({ key: '/abilities/fireball', damage: 50 })]);
            expect(robert.abilities).toEqual([expect.objectContaining({ key: 'auto', damage: 50 })]);
        });

        test('a hit by a unit with nothing known prepared is credited as unknown, never as auto attack', () => {
            const summary = run([[0, strike(0, 250, 1)]], [player()]);

            expect(summary.dealt[0].abilities).toEqual([expect.objectContaining({ key: '', damage: 50 })]);
        });

        describe('damage over time', () => {
            const DOT = { '/abilities/firestorm': 6000, '/abilities/venom': 4000 };
            const tick = (hp, dmgCounter) => update({}, { 0: { cHP: hp, mHP: 300, dmgCounter } });
            const runDots = (steps, players) => {
                const tracker = startBattle(players);
                const stats = new BattleStats();
                stats.setDotLookup((hrid) => DOT[hrid] || 0);
                stats.setPlayers(players.map((unit) => unit.character.name));
                for (const [at, message] of steps) stats.record(tracker.handleBattleUpdated(message), at);
                return stats.getSummary();
            };
            const caster = () => player({ preparingAbilityHrid: '/abilities/firestorm' });

            test('ticks while one player has a damage-over-time ability running are theirs, under that ability', () => {
                const summary = runDots(
                    [
                        [0, strike(0, 250, 1)],
                        [3000, tick(220, 2)],
                        [6000, tick(190, 3)],
                    ],
                    [caster(), bob()]
                );

                const alice = summary.dealt.find((row) => row.name === 'Alice');
                expect(alice.abilities).toEqual([
                    expect.objectContaining({ key: '/abilities/firestorm', damage: 110 }),
                ]);
                expect(summary.unattributed.damage).toBe(0);
            });

            test('a tick after the effect has run out is over time again', () => {
                const summary = runDots(
                    [
                        [0, strike(0, 250, 1)],
                        [20000, tick(220, 2)],
                    ],
                    [caster(), bob()]
                );

                expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 30, overTime: 30 }));
            });

            test('with two players running damage over time, a tick is not given to either', () => {
                const venom = player({ character: { id: 2, name: 'Bob' }, preparingAbilityHrid: '/abilities/venom' });
                const summary = runDots(
                    [
                        [0, strike(0, 250, 1)],
                        [500, update({ 1: { atkCounter: 1 } }, { 0: { cHP: 230, mHP: 300, dmgCounter: 2 } })],
                        [3000, tick(200, 3)],
                    ],
                    [caster(), venom]
                );

                expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 30, overTime: 30 }));
            });

            test('a monster that acted in the same update still makes it reflected, not damage over time', () => {
                const summary = runDots(
                    [
                        [0, strike(0, 250, 1)],
                        [3000, update({}, { 0: { cHP: 220, mHP: 300, dmgCounter: 2, atkCounter: 1 } })],
                    ],
                    [caster(), bob()]
                );

                expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 30, reflected: 30 }));
            });
        });

        test('in a party, damage nobody acted for is over time, and it is not given to anyone', () => {
            const summary = run([[0, update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1 } })]], [player(), bob()]);

            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 50, overTime: 50, reflected: 0 }));
            expect(summary.dealt.map((row) => row.damage)).toEqual([0, 0]);
        });

        test('in a party, damage to a monster that attacked in the same update is reflected', () => {
            const reflected = update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1, atkCounter: 1 } });

            const summary = run([[0, reflected]], [player(), bob()]);

            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 50, reflected: 50, overTime: 0 }));
        });

        test('reflected damage goes to the one player the monster struck, a miss included', () => {
            const hitBack = (counter, hp, dmgCounter, playerHp) =>
                update(
                    { 1: { cHP: playerHp, mHP: 1000, dmgCounter: counter } },
                    { 0: { cHP: hp, mHP: 300, dmgCounter, atkCounter: dmgCounter } }
                );

            const summary = run(
                [
                    [0, hitBack(1, 250, 1, 900)],
                    [1000, hitBack(2, 200, 2, 900)],
                ],
                [player(), bob()]
            );

            const robert = summary.dealt.find((row) => row.name === 'Bob');
            expect(robert.abilities).toEqual([expect.objectContaining({ key: 'reflect', damage: 100 })]);
            expect(summary.unattributed.damage).toBe(0);
        });

        test('when several were struck, the only known reflecter is credited, marked as an estimate', () => {
            const hitBack = (hp, dmgCounter) =>
                update(
                    { 1: { cHP: 900, mHP: 1000, dmgCounter } },
                    { 0: { cHP: hp, mHP: 300, dmgCounter, atkCounter: dmgCounter } }
                );
            const everyone = (hp, dmgCounter) =>
                update(
                    { 0: { cHP: 900, mHP: 1000, dmgCounter }, 1: { cHP: 900, mHP: 1000, dmgCounter } },
                    { 0: { cHP: hp, mHP: 300, dmgCounter, atkCounter: dmgCounter } }
                );

            const summary = run(
                [
                    [0, everyone(250, 1)],
                    [1000, hitBack(200, 2)],
                    [2000, everyone(150, 3)],
                ],
                [player(), bob()]
            );

            const robert = summary.dealt.find((row) => row.name === 'Bob');
            const byKey = Object.fromEntries(robert.abilities.map((row) => [row.key, row.damage]));
            // The first one came before Bob was known to reflect, so it stays unassigned
            expect(byKey).toEqual({ reflect: 50, 'reflect-guess': 50 });
            expect(summary.unattributed.reflected).toBe(50);
        });

        test('with two known reflecters nothing is guessed', () => {
            const struck = (index, hp, monsterCounter) =>
                update(
                    { [index]: { cHP: 900, mHP: 1000, dmgCounter: 1 } },
                    { 0: { cHP: hp, mHP: 300, dmgCounter: monsterCounter, atkCounter: monsterCounter } }
                );
            const everyone = update(
                { 0: { cHP: 900, mHP: 1000, dmgCounter: 2 }, 1: { cHP: 900, mHP: 1000, dmgCounter: 2 } },
                { 0: { cHP: 150, mHP: 300, dmgCounter: 3, atkCounter: 3 } }
            );

            const summary = run(
                [
                    [0, struck(0, 250, 1)],
                    [1000, struck(1, 200, 2)],
                    [2000, everyone],
                ],
                [player(), bob()]
            );

            expect(summary.unattributed.reflected).toBe(50);
        });

        test('reflected damage stays unassigned when several players were struck', () => {
            const both = update(
                { 0: { cHP: 900, mHP: 1000, dmgCounter: 1 }, 1: { cHP: 900, mHP: 1000, dmgCounter: 1 } },
                { 0: { cHP: 250, mHP: 300, dmgCounter: 1, atkCounter: 1 } }
            );

            const summary = run([[0, both]], [player(), bob()]);

            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 50, reflected: 50 }));
        });

        test('alone, over-time and reflected damage are still yours, under their own labels', () => {
            const reflected = update({}, { 0: { cHP: 250, mHP: 300, dmgCounter: 1, atkCounter: 1 } });
            const overTime = update({}, { 0: { cHP: 200, mHP: 300, dmgCounter: 2, atkCounter: 1 } });

            const summary = run([
                [0, reflected],
                [1000, overTime],
            ]);

            const byKey = Object.fromEntries(summary.dealt[0].abilities.map((row) => [row.key, row.damage]));
            expect(byKey).toEqual({ reflect: 50, 'over-time': 50 });
            expect(summary.unattributed.damage).toBe(0);
        });

        test('an unclear update where several players acted is not given to anyone', () => {
            const both = update(
                { 0: { atkCounter: 1 }, 1: { atkCounter: 1 } },
                { 0: { cHP: 250, mHP: 300, dmgCounter: 1 } }
            );

            const summary = run([[0, both]], [player(), bob()]);

            expect(summary.unattributed).toEqual(expect.objectContaining({ damage: 50, unclear: 50 }));
        });
    });
});

describe('DPS chart data', () => {
    const bob = () => player({ character: { id: 2, name: 'Bob' } });
    const tick = (n, entry = {}) =>
        update({ 0: { atkCounter: n, ...entry } }, { 0: { cHP: 300 - 10 * n, mHP: 300, dmgCounter: n } });

    function fight(steps, players = [player()], self = null) {
        const tracker = startBattle(players);
        const stats = new BattleStats();
        stats.setPlayers(players.map((unit) => unit.character.name));
        stats.setSelf(self);
        for (const [at, message] of steps) stats.record(tracker.handleBattleUpdated(message), at);
        return stats;
    }

    test('alone, the chart follows you and counts every hit with its ability', () => {
        const stats = fight([
            [1000, tick(1)],
            [2000, tick(2)],
        ]);

        const chart = stats.getSummary(2000).chart;

        expect(chart.player).toBe('Alice');
        expect(chart.hits.map((hit) => hit.amount)).toEqual([10, 10]);
    });

    test("in a party it follows you, and never shows a teammate's hits", () => {
        const mage = player({ preparingAbilityHrid: '/abilities/fireball' });
        const stats = fight(
            [
                [1000, update({ 1: { atkCounter: 1 } }, { 0: { cHP: 290, mHP: 300, dmgCounter: 1 } })],
                [2000, update({ 0: { atkCounter: 1 } }, { 0: { cHP: 270, mHP: 300, dmgCounter: 2 } })],
            ],
            [mage, bob()],
            'Alice'
        );

        const chart = stats.getSummary(2000).chart;

        expect(chart.player).toBe('Alice');
        expect(chart.hits).toEqual([expect.objectContaining({ amount: 20, key: '/abilities/fireball' })]);
    });

    test('in a party every member gets their own chart, you first, each with only their own hits', () => {
        const mage = player({ preparingAbilityHrid: '/abilities/fireball' });
        const stats = fight(
            [
                [1000, update({ 1: { atkCounter: 1 } }, { 0: { cHP: 290, mHP: 300, dmgCounter: 1 } })],
                [2000, update({ 0: { atkCounter: 1 } }, { 0: { cHP: 270, mHP: 300, dmgCounter: 2 } })],
            ],
            [bob(), mage],
            'Alice'
        );

        const { charts } = stats.getSummary(2000);

        expect(charts.map((chart) => chart.player)).toEqual(['Alice', 'Bob']);
        expect(charts[0].hits.map((hit) => hit.amount)).toEqual([10]);
        expect(charts[1].hits.map((hit) => hit.amount)).toEqual([20]);
        expect(charts[1].bestDps).toBe(0);
    });

    test('alone there is just the one chart', () => {
        expect(fight([[1000, tick(1)]]).getSummary(1000).charts).toEqual([]);
    });

    test('in a party with nobody to follow there is no chart', () => {
        const stats = fight([[1000, tick(1)]], [player(), bob()], null);

        expect(stats.getSummary(1000).chart).toBeNull();
    });

    test('a crit and a miss are flagged on the hit, not mixed up', () => {
        const stats = fight([
            [1000, update({ 0: { atkCounter: 1 } }, { 0: { cHP: 290, mHP: 300, dmgCounter: 1, critCounter: 1 } })],
            [2000, update({ 0: { atkCounter: 2 } }, { 0: { cHP: 290, mHP: 300, dmgCounter: 2 } })],
        ]);

        const [crit, miss] = stats.getSummary(2000).chart.hits;

        expect(crit).toEqual(expect.objectContaining({ crit: true, miss: false }));
        expect(miss).toEqual(expect.objectContaining({ crit: false, miss: true }));
    });

    test('current DPS is the damage of the trailing window, and falls when the hitting stops', () => {
        const stats = fight([
            [0, tick(0)],
            [1000, tick(1)],
            [2000, tick(2)],
            [3000, tick(3)],
        ]);

        expect(stats.getSummary(3000).chart.currentDps).toBeCloseTo(10, 5);
        expect(stats.getSummary(30000).chart.currentDps).toBe(0);
    });

    test('the tape only holds the last minute', () => {
        const stats = fight([
            [1000, tick(1)],
            [4000, tick(2)],
            [8000, tick(3)],
        ]);

        expect(stats.getSummary(8000).chart.hits).toHaveLength(3);
        expect(stats.getSummary(65000).chart.hits.map((hit) => hit.t)).toEqual([8000]);
    });

    test('best DPS is not set by an early big hit and keeps its peak afterwards', () => {
        const hit = (n, amount) =>
            update({ 0: { atkCounter: n } }, { 0: { cHP: 300 - amount * n, mHP: 300, dmgCounter: n } });
        const early = fight([
            [0, hit(0, 1)],
            [1000, hit(1, 1)],
        ]);
        expect(early.getSummary(1000).chart.bestDps).toBe(0);

        const steps = [];
        for (let n = 0; n <= 20; n++) steps.push([n * 1000, hit(n, 1)]);
        const long = fight(steps);
        const best = long.getSummary(20000).chart.bestDps;
        expect(best).toBeGreaterThan(0);
        expect(long.getSummary(60000).chart.bestDps).toBe(best);
    });

    test('average DPS matches the damage dealt over the combat time', () => {
        const stats = fight([
            [0, tick(0)],
            [1000, tick(1)],
            [2000, tick(2)],
        ]);

        expect(stats.getSummary(2000).chart.averageDps).toBeCloseTo(stats.getSummary(2000).dealt[0].dps, 5);
    });

    test('keeps a bounded number of recent hits however long the fight runs', () => {
        const stats = new BattleStats();
        stats.setPlayers(['Alice']);
        const hits = Array.from({ length: 1000 }, () => ({
            side: 'm',
            type: 'damage',
            hrid: '/monsters/fly',
            amount: 1,
            hits: 1,
        }));
        for (let i = 0; i < 1000; i++) stats.record([hits[i]], 1000 + i);

        expect(stats.recentHits.length).toBeLessThanOrEqual(600);
    });
});

describe('DPS and kill time per enemy', () => {
    const strike = (index, hp, counter) =>
        update({ 0: { atkCounter: counter } }, { [index]: { cHP: hp, mHP: 300, dmgCounter: counter } });

    function wave(steps, monsters = [monster()]) {
        const tracker = startBattle([player()], monsters);
        const stats = new BattleStats();
        stats.setPlayers(['Alice']);
        stats.beginWave(0);
        for (const [at, message] of steps) stats.record(tracker.handleBattleUpdated(message), at);
        return { tracker, stats };
    }

    test('DPS is the damage taken by the ones that died over the time they were alive', () => {
        const { stats } = wave([
            [2000, strike(0, 200, 1)],
            [4000, strike(0, 0, 2)],
        ]);

        const [fly] = stats.getSummary(4000).monsters;

        expect(fly).toEqual(
            expect.objectContaining({ kills: 1, killedDamage: 300, aliveSeconds: 4, dps: 75, killTime: 4 })
        );
    });

    test('kill time is the average over the kills of that type', () => {
        const first = wave([[2000, strike(0, 0, 1)]]);
        first.stats.beginWave(10000);
        first.tracker.handleNewBattle({ battleId: 7, players: [player()], monsters: [monster()] });
        first.stats.record(first.tracker.handleBattleUpdated(strike(0, 0, 2)), 16000);

        expect(first.stats.getSummary(16000).monsters[0].killTime).toBe(4);
    });

    test('damage to one that is still alive does not count towards DPS', () => {
        const { stats } = wave(
            [
                [1000, strike(0, 0, 1)],
                [2000, strike(1, 200, 2)],
            ],
            [monster(), monster()]
        );

        const [fly] = stats.getSummary(2000).monsters;

        expect(fly.damage).toBe(400);
        expect(fly.killedDamage).toBe(300);
        expect(fly.kills).toBe(1);
    });

    test('with no wave start known there is no DPS or kill time to claim', () => {
        const tracker = startBattle();
        const stats = new BattleStats();
        stats.setPlayers(['Alice']);

        stats.record(tracker.handleBattleUpdated(strike(0, 0, 1)), 3000);

        expect(stats.getSummary(3000).monsters[0]).toEqual(
            expect.objectContaining({ kills: 1, dps: 0, killTime: null })
        );
    });

    test('a new wave starts its own clock and damage tally', () => {
        const { tracker, stats } = wave([[1000, strike(0, 200, 1)]]);
        stats.beginWave(5000);
        tracker.handleNewBattle({ battleId: 7, players: [player()], monsters: [monster()] });

        stats.record(tracker.handleBattleUpdated(strike(0, 0, 2)), 7000);

        // 300 in the new wave over its 2 s, not the 100 dealt before it
        expect(stats.getSummary(7000).monsters[0]).toEqual(
            expect.objectContaining({ killedDamage: 300, aliveSeconds: 2, dps: 150 })
        );
    });
});

describe('casts refused for lack of mana', () => {
    const COSTS = {
        '/abilities/big': { manaCost: 80, cooldownMs: 10000 },
        '/abilities/small': { manaCost: 35, cooldownMs: 5000 },
        '/abilities/free': { manaCost: 0, cooldownMs: 5000 },
    };
    const caster = (overrides = {}) =>
        player({
            currentManapoints: 200,
            maxManapoints: 500,
            attackAttemptCounter: 1,
            isPreparingAutoAttack: false,
            preparingAbilityHrid: '/abilities/big',
            combatAbilities: [
                { abilityHrid: '/abilities/big' },
                { abilityHrid: '/abilities/small' },
                { abilityHrid: '/abilities/free' },
            ],
            ...overrides,
        });

    function run(steps, unit = caster()) {
        const tracker = startBattle([unit]);
        const stats = new BattleStats();
        stats.setAbilityLookup((hrid) => COSTS[hrid] || null);
        stats.setPlayers([unit.character.name]);
        stats.setLoadouts(tracker.players);
        for (const [at, message] of steps) stats.record(tracker.handleBattleUpdated(message), at);
        return stats.getSummary(steps[steps.length - 1][0]);
    }

    // The unit acts (counter up) and now prepares what the entry says; mp is its mana after the action
    const act = (counter, mp, prepared = {}) => update({ 0: { atkCounter: counter, cMP: mp, ...prepared } });
    const auto = { isAutoAtk: true };

    test('the tracker reads the curse stat a unit brings, and none as 0', () => {
        const tracker = startBattle([
            caster({ combatDetails: { combatStats: { curse: 0.022 } } }),
            caster({ combatDetails: { combatStats: {} } }),
        ]);

        expect(tracker.players.map((unit) => unit.curse)).toEqual([0.022, 0]);
    });

    test('the tracker reads the loadout, the haste and the mana the unit had when it acted', () => {
        const tracker = startBattle([caster({ combatDetails: { combatStats: { abilityHaste: 30 } } })]);
        const [unit] = tracker.players;
        expect(unit.abilities).toEqual(['/abilities/big', '/abilities/small', '/abilities/free']);
        expect(unit.abilityHaste).toBe(30);

        const attack = tracker.handleBattleUpdated(act(2, 120, auto)).find((event) => event.type === 'attack');
        expect(attack.manaBefore).toBe(200);
    });

    test('an auto attack while a ready ability costs more than the mana is a refused cast, for that ability', () => {
        const summary = run([
            // Casts the big ability (cost 80), paying for it, and is left on 20 mana preparing an auto attack
            [0, act(2, 20, { ...auto })],
            // Auto attacks 20s later on 20 mana: the big ability is off cooldown and costs 80
            [20000, act(3, 20, { ...auto })],
            [23000, act(4, 23, { ...auto })],
        ]);

        const row = summary.players.find((p) => p.name === 'Alice');
        expect(row.refusedCasts).toBe(2);
        expect(row.abilityMana.find((a) => a.abilityHrid === '/abilities/big').refused).toBe(2);
    });

    test('nothing is refused while the ability is still on cooldown, or when the mana covers it', () => {
        const summary = run([
            [0, act(2, 20, { ...auto })],
            // 2s later the big ability is still cooling down
            [2000, act(3, 20, { ...auto })],
        ]);
        expect(summary.players.find((p) => p.name === 'Alice').refusedCasts).toBe(0);

        const rich = run([
            [0, act(2, 150, { ...auto })],
            // Off cooldown, but 150 mana covers it: an auto attack here is a trigger or priority matter
            [30000, act(3, 150, { ...auto })],
        ]);
        expect(rich.players.find((p) => p.name === 'Alice').refusedCasts).toBe(0);
    });

    test('only abilities the player has cast count, and a free ability can never be refused', () => {
        const summary = run([
            // The only cast was the big ability; the small one was never used, so it is never counted
            [0, act(2, 20, { ...auto })],
            [20000, act(3, 20, { ...auto })],
        ]);

        const row = summary.players.find((p) => p.name === 'Alice');
        expect(row.abilityMana.map((a) => a.abilityHrid)).toEqual(['/abilities/big']);
    });

    test('haste shortens the cooldown, so an ability is ready sooner', () => {
        const hasted = caster({ combatDetails: { combatStats: { abilityHaste: 100 } } });
        const steps = [
            [0, act(2, 20, { ...auto })],
            // 6s: base cooldown 10s is still running, but with 100 haste it is 5s and already over
            [6000, act(3, 20, { ...auto })],
        ];

        expect(run(steps, hasted).players.find((p) => p.name === 'Alice').refusedCasts).toBe(1);
        expect(run(steps).players.find((p) => p.name === 'Alice').refusedCasts).toBe(0);
    });
});

describe('DPS over time', () => {
    const tick = (n, hp) => update({ 0: { atkCounter: n } }, { 0: { cHP: hp, mHP: 3000, dmgCounter: n } });

    test('the chart carries a smoothed DPS series for the followed player, and none for other charts', () => {
        const players = [player(), player({ character: { id: 2, name: 'Bob' } })];
        const tracker = startBattle(players, [monster({ currentHitpoints: 3000, maxHitpoints: 3000 })]);
        const stats = new BattleStats();
        stats.setPlayers(['Alice', 'Bob']);
        stats.setSelf('Alice');
        // Alice hits for 100 once a second for 8 seconds
        for (let n = 1; n <= 8; n++) stats.record(tracker.handleBattleUpdated(tick(n, 3000 - 100 * n)), n * 1000);

        const summary = stats.getSummary(10000);

        // Finished 2s steps from the first hit's step (0-2s) to the one before the step in progress (10-12s)
        expect(summary.chart.series.length).toBeGreaterThan(0);
        expect(Math.max(...summary.chart.series)).toBeGreaterThan(0);
        expect(summary.charts.find((chart) => chart.player === 'Bob').series).toEqual([]);
    });

    test('a reset forgets the series', () => {
        const tracker = startBattle([player()], [monster({ currentHitpoints: 3000, maxHitpoints: 3000 })]);
        const stats = new BattleStats();
        stats.setPlayers(['Alice']);
        stats.record(tracker.handleBattleUpdated(tick(1, 2900)), 1000);

        stats.reset();
        stats.setPlayers(['Alice']);

        expect(stats.getSummary(10000).chart.series).toEqual([]);
    });
});

describe('healing done', () => {
    const hurt = (name, id) =>
        player({
            character: { id, name },
            currentHitpoints: 500,
            maxHitpoints: 1000,
            preparingAbilityHrid: '/abilities/heal',
        });

    function run(steps) {
        const units = [hurt('Alice', 1), hurt('Bob', 2)];
        const tracker = startBattle(units);
        const stats = new BattleStats();
        stats.setPlayers(['Alice', 'Bob']);
        for (const [at, message] of steps) stats.record(tracker.handleBattleUpdated(message), at);
        return stats.getSummary(steps[steps.length - 1][0]);
    }

    const row = (summary, name) => summary.healers.find((healer) => healer.name === name);

    test('a heal on someone is credited to the player who acted, under the ability they used', () => {
        // Alice casts (counter up); Bob's HP rises by 100
        const summary = run([[1000, update({ 0: { atkCounter: 1 }, 1: { cHP: 600, mHP: 1000 } })]]);

        expect(row(summary, 'Alice').healing).toBe(100);
        expect(row(summary, 'Alice').abilities).toEqual([
            expect.objectContaining({ key: '/abilities/heal', healing: 100 }),
        ]);
        expect(row(summary, 'Bob').healing).toBe(0);
    });

    test('healing yourself counts too', () => {
        const summary = run([[1000, update({ 0: { atkCounter: 1, cHP: 650, mHP: 1000 } })]]);

        expect(row(summary, 'Alice').healing).toBe(150);
    });

    test('regeneration and food, with nobody acting, are not healing done', () => {
        const summary = run([[1000, update({ 1: { cHP: 560, mHP: 1000 } })]]);

        expect(summary.healers.every((healer) => healer.healing === 0)).toBe(true);
    });

    test('when several players acted nobody is credited', () => {
        const summary = run([[1000, update({ 0: { atkCounter: 1 }, 1: { atkCounter: 1, cHP: 600, mHP: 1000 } })]]);

        expect(summary.healers.every((healer) => healer.healing === 0)).toBe(true);
    });

    test('a revive is not healing, and HPS is over the session time', () => {
        const summary = run([
            [0, update({ 0: { atkCounter: 1 }, 1: { cHP: 600, mHP: 1000 } })],
            [4000, update({ 0: { atkCounter: 2 }, 1: { cHP: 700, mHP: 1000 } })],
        ]);

        expect(row(summary, 'Alice').healing).toBe(200);
        expect(row(summary, 'Alice').hps).toBeCloseTo(50, 5);
    });
});

describe('DPS graph data', () => {
    const tick = (n, hp) => update({ 0: { atkCounter: n } }, { 0: { cHP: hp, mHP: 3000, dmgCounter: n } });

    function fightFor(players) {
        const tracker = startBattle(players, [monster({ currentHitpoints: 3000, maxHitpoints: 3000 })]);
        const stats = new BattleStats();
        stats.setPlayers(players.map((unit) => unit.character.name));
        stats.setSelf('Alice');
        stats.setBoss(false, 0);
        for (let n = 1; n <= 12; n++) stats.record(tracker.handleBattleUpdated(tick(n, 3000 - 100 * n)), n * 1000);
        return stats;
    }

    test('alone the graph has one line, for you', () => {
        const graph = fightFor([player()]).getSummary(16000).graph;

        expect(graph.lines.map((line) => line.name)).toEqual(['Alice']);
        expect(graph.lines[0].series.length).toBeGreaterThan(2);
        expect(graph.boss).toHaveLength(graph.lines[0].series.length);
    });

    test('in a party every member has a line of the same length, so they line up', () => {
        const graph = fightFor([player(), player({ character: { id: 2, name: 'Bob' } })]).getSummary(16000).graph;

        expect(graph.lines.map((line) => line.name)).toEqual(['Alice', 'Bob']);
        expect(graph.lines[0].series).toHaveLength(graph.lines[1].series.length);
        expect(Math.max(...graph.lines[1].series)).toBe(0);
    });

    test('a boss wave shows in the graph', () => {
        const tracker = startBattle([player()], [monster({ currentHitpoints: 3000, maxHitpoints: 3000 })]);
        const stats = new BattleStats();
        stats.setPlayers(['Alice']);
        stats.setSelf('Alice');
        stats.setBoss(true, 0);
        for (let n = 1; n <= 8; n++) stats.record(tracker.handleBattleUpdated(tick(n, 3000 - 100 * n)), n * 1000);

        expect(stats.getSummary(12000).graph.boss.every(Boolean)).toBe(true);
    });
});

describe('status flags', () => {
    const flags = (entry = {}) => update({ 0: { atkCounter: 0, ...entry } });

    test('a flag going up or down is a status event, and a flag the entry leaves out is off', () => {
        const tracker = startBattle([player()]);

        const on = tracker.handleBattleUpdated(flags({ isStunned: true }));
        expect(on).toEqual([
            expect.objectContaining({ type: 'status', status: 'stunned', on: true, side: 'p', index: 0 }),
        ]);

        expect(tracker.handleBattleUpdated(flags({ isStunned: true }))).toEqual([]);

        const off = tracker.handleBattleUpdated(flags());
        expect(off).toEqual([expect.objectContaining({ type: 'status', status: 'stunned', on: false })]);
    });

    test('monsters have them too, and each status is its own event', () => {
        const tracker = startBattle([player()]);

        const events = tracker.handleBattleUpdated(update({}, { 0: { isBlinded: true, isSilenced: true } }));

        expect(events.map((event) => [event.side, event.status, event.on])).toEqual([
            ['m', 'blinded', true],
            ['m', 'silenced', true],
        ]);
    });

    test('a unit that starts a battle already stunned is not announced as a change', () => {
        const tracker = startBattle([player({ isStunned: true })]);

        expect(tracker.handleBattleUpdated(flags({ isStunned: true }))).toEqual([]);
    });
});

describe('BattleStats live clock', () => {
    test('rates keep falling between messages and ignore long silences', () => {
        const stats = new BattleStats();
        stats.activeMs = 10000;
        stats.lastAt = 100000;
        stats.dealt.set('A', { damage: 1000, hits: 1, crits: 0, misses: 0, abilities: new Map() });
        expect(stats.getBadge('A', 100000).dps).toBeCloseTo(100);
        expect(stats.getBadge('A', 102000).dps).toBeCloseTo(1000 / 12);
        expect(stats.getBadge('A', 160000).dps).toBeCloseTo(100);
    });

    test('shows nothing in the first second', () => {
        const stats = new BattleStats();
        stats.activeMs = 400;
        stats.lastAt = 1000;
        stats.dealt.set('A', { damage: 500, hits: 1, crits: 0, misses: 0, abilities: new Map() });
        expect(stats.getBadge('A', 1000).dps).toBe(0);
    });
});
