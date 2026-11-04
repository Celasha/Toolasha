import { describe, expect, test } from 'vitest';
import { BuffTracker } from './buff-tracker.js';

const SEC = 1e9;
const EFFECTS = {
    '/abilities/berserk': [
        {
            targetType: 'self',
            buffs: [{ uniqueHrid: '/buff_uniques/berserk', typeHrid: '/buff_types/damage', duration: 20 * SEC }],
        },
    ],
    '/abilities/aura': [
        {
            targetType: 'allAllies',
            buffs: [{ uniqueHrid: '/buff_uniques/aura', typeHrid: '/buff_types/speed', duration: 120 * SEC }],
        },
    ],
    '/abilities/crippling': [
        {
            targetType: 'allEnemies',
            buffs: [{ uniqueHrid: '/buff_uniques/crippled', typeHrid: '/buff_types/slow', duration: 12 * SEC }],
        },
    ],
    '/abilities/spear': [
        {
            targetType: 'enemy',
            buffs: [{ uniqueHrid: '/buff_uniques/pierced', typeHrid: '/buff_types/armor', duration: 8 * SEC }],
        },
    ],
    '/abilities/invincible': [
        {
            targetType: 'self',
            buffs: [
                { uniqueHrid: '/buff_uniques/inv_a', typeHrid: '/buff_types/armor', duration: 120 * SEC },
                { uniqueHrid: '/buff_uniques/inv_b', typeHrid: '/buff_types/resist', duration: 120 * SEC },
                { uniqueHrid: '/buff_uniques/inv_c', typeHrid: '/buff_types/tenacity', duration: 120 * SEC },
            ],
        },
    ],
    '/abilities/firestorm': [{ targetType: 'allEnemies', damageOverTimeRatio: 1, damageOverTimeDuration: 6 * SEC }],
    '/abilities/stunning_blow': [{ targetType: 'enemy', stunChance: 0.7, stunDuration: 3 * SEC }],
};

const roster = () => ({
    p: [
        { index: 0, hp: 100 },
        { index: 1, hp: 100 },
        { index: 2, hp: 0 },
    ],
    m: [
        { index: 0, hp: 50 },
        { index: 1, hp: 50 },
    ],
});
const cast = (side, index, abilityHrid) => ({ type: 'attack', side, index, abilityHrid, auto: false });
const hit = (side, index, amount = 10) => ({ type: 'damage', side, index, amount, miss: false });

function tracker() {
    const buffs = new BuffTracker();
    buffs.setEffectsLookup((hrid) => EFFECTS[hrid] || []);
    return buffs;
}

describe('BuffTracker', () => {
    test('a self buff goes on the caster for the length the ability data gives', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/berserk')], 1000, roster());

        const [berserk] = buffs.getUnit('p', 0, 6000);
        expect(berserk).toMatchObject({ kind: 'buff', abilityHrid: '/abilities/berserk', remainingMs: 15000 });
        expect(buffs.getUnit('p', 1, 6000)).toEqual([]);
    });

    test('an aura goes on every living ally and not on the dead', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/aura')], 0, roster());

        expect(buffs.getUnit('p', 0, 1000)).toHaveLength(1);
        expect(buffs.getUnit('p', 1, 1000)).toHaveLength(1);
        expect(buffs.getUnit('p', 2, 1000)).toEqual([]);
        expect(buffs.getUnit('m', 0, 1000)).toEqual([]);
    });

    test('a debuff on all enemies lands on each monster, as a debuff', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/crippling')], 0, roster());

        expect(buffs.getUnit('m', 0, 1000)[0].kind).toBe('debuff');
        expect(buffs.getUnit('m', 1, 1000)[0].kind).toBe('debuff');
    });

    test('a single-target debuff lands on the monster that was hit in the same message', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/spear'), hit('m', 1)], 0, roster());

        expect(buffs.getUnit('m', 1, 1000)).toHaveLength(1);
        expect(buffs.getUnit('m', 0, 1000)).toEqual([]);
    });

    test('a single-target debuff with no hit in the message goes nowhere', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/spear')], 0, roster());

        expect(buffs.getUnit('m', 0, 1000)).toEqual([]);
    });

    test('a monster casting at the party puts the debuff on the players it hit', () => {
        const buffs = tracker();
        buffs.record([cast('m', 0, '/abilities/spear'), hit('p', 1)], 0, roster());

        expect(buffs.getUnit('p', 1, 1000)[0].kind).toBe('debuff');
    });

    test('damage over time shows as a burn on the enemies for its duration', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/firestorm')], 0, roster());

        expect(buffs.getUnit('m', 0, 2000)[0]).toMatchObject({ kind: 'dot', remainingMs: 4000 });
        expect(buffs.getUnit('m', 0, 7000)).toEqual([]);
    });

    test('casting again refreshes the timer instead of stacking another icon', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/berserk')], 0, roster());
        buffs.record([cast('p', 0, '/abilities/berserk')], 10000, roster());

        const list = buffs.getUnit('p', 0, 12000);
        expect(list).toHaveLength(1);
        expect(list[0].remainingMs).toBe(18000);
    });

    test('a stun is only shown when the flag goes up, with the length the ability gives', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/stunning_blow'), hit('m', 0)], 1000, roster());
        expect(buffs.getUnit('m', 0, 1500)).toEqual([]);

        buffs.record([{ type: 'status', side: 'm', index: 0, status: 'stunned', on: true }], 1100, roster());
        expect(buffs.getUnit('m', 0, 2000)[0]).toMatchObject({ kind: 'status', status: 'stunned', remainingMs: 2100 });

        buffs.record([{ type: 'status', side: 'm', index: 0, status: 'stunned', on: false }], 3000, roster());
        expect(buffs.getUnit('m', 0, 3100)).toEqual([]);
    });

    test('a status with no cast behind it is shown without a countdown while the flag is up', () => {
        const buffs = tracker();
        buffs.record([{ type: 'status', side: 'm', index: 1, status: 'enraged', on: true }], 0, roster());

        const [status] = buffs.getUnit('m', 1, 999999);
        expect(status).toMatchObject({ kind: 'status', status: 'enraged', remainingMs: null });
    });

    test('a death clears what was on the unit, and a new wave clears the monsters but not the players', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/berserk'), cast('p', 1, '/abilities/crippling')], 0, roster());
        buffs.record([{ type: 'death', side: 'p', index: 0 }], 1000, roster());
        expect(buffs.getUnit('p', 0, 2000)).toEqual([]);

        buffs.record([cast('p', 1, '/abilities/berserk')], 1500, roster());
        buffs.beginWave();
        expect(buffs.getUnit('m', 0, 2000)).toEqual([]);
        expect(buffs.getUnit('p', 1, 2000)).toHaveLength(1);
    });

    test('buffs come first, then the one running out soonest', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/aura'), cast('p', 0, '/abilities/berserk')], 0, roster());

        expect(buffs.getUnit('p', 0, 1000).map((entry) => entry.abilityHrid)).toEqual([
            '/abilities/berserk',
            '/abilities/aura',
        ]);
    });

    test('an unknown ability, or the auto attack, adds nothing', () => {
        const buffs = tracker();
        buffs.record(
            [cast('p', 0, '/abilities/nope'), { type: 'attack', side: 'p', index: 1, auto: true, abilityHrid: '' }],
            0,
            roster()
        );

        expect(buffs.getUnit('p', 0, 100)).toEqual([]);
        expect(buffs.getUnit('p', 1, 100)).toEqual([]);
    });

    test('an ability that applies several effects shows as one icon', () => {
        const buffs = tracker();
        buffs.record([cast('p', 0, '/abilities/invincible')], 1000, roster());
        const icons = buffs.getUnit('p', 0, 2000);
        expect(icons).toHaveLength(1);
        expect(icons[0].abilityHrid).toBe('/abilities/invincible');
        expect(icons[0].remainingMs).toBe(119000);
    });
});
