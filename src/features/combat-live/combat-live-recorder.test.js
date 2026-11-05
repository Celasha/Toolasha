import { describe, expect, test } from 'vitest';
import { CombatLiveRecorder } from './combat-live-recorder.js';

describe('CombatLiveRecorder', () => {
    test("records a new battle with who is in it, which character is recording, and every unit's starting point", () => {
        const recorder = new CombatLiveRecorder();

        recorder.recordNewBattle(
            {
                battleId: 7,
                wave: 2,
                players: [
                    {
                        character: { id: 1, name: 'Alice' },
                        currentHitpoints: 900,
                        currentManapoints: 50,
                        attackAttemptCounter: 3,
                        preparingAbilityHrid: '/abilities/fireball',
                        isPreparingAutoAttack: false,
                        damageSplatCounter: 12,
                        criticalDamageSplatCounter: 4,
                        combatAbilities: [{ abilityHrid: '/abilities/fireball' }, { abilityHrid: '/abilities/poke' }],
                        combatDetails: { combatStats: { abilityHaste: 25 } },
                    },
                ],
                monsters: [
                    {
                        hrid: '/monsters/fly',
                        currentHitpoints: 300,
                        maxHitpoints: 400,
                        currentManapoints: 0,
                        isPreparingAutoAttack: true,
                        combatBuffMap: { '/buff_uniques/curse': { typeHrid: '/buff_types/damage_taken', duration: 8 } },
                    },
                ],
            },
            1000,
            1
        );

        expect(recorder.entries[0]).toEqual({
            k: 'nb',
            t: 1000,
            id: 7,
            w: 2,
            self: 1,
            cs: null,
            p: [
                {
                    n: 'Alice',
                    c: 1,
                    hp: 900,
                    mp: 50,
                    atk: 3,
                    ab: '/abilities/fireball',
                    auto: 0,
                    dmg: 12,
                    crit: 4,
                    la: ['/abilities/fireball', '/abilities/poke'],
                    hs: 25,
                    bm: null,
                },
            ],
            m: [
                {
                    h: '/monsters/fly',
                    hp: 300,
                    maxHp: 400,
                    mp: 0,
                    atk: null,
                    ab: '',
                    auto: 1,
                    dmg: null,
                    crit: null,
                    bm: [['/buff_uniques/curse', { typeHrid: '/buff_types/damage_taken', duration: 8 }]],
                },
            ],
            fields: {
                p: [
                    'character',
                    'currentHitpoints',
                    'currentManapoints',
                    'attackAttemptCounter',
                    'preparingAbilityHrid',
                    'isPreparingAutoAttack',
                    'damageSplatCounter',
                    'criticalDamageSplatCounter',
                    'combatAbilities',
                    'combatDetails',
                ],
                m: [
                    'hrid',
                    'currentHitpoints',
                    'maxHitpoints',
                    'currentManapoints',
                    'isPreparingAutoAttack',
                    'combatBuffMap',
                ],
            },
        });
    });

    test('records a tick as compact rows, keeping the unit index and attack fields', () => {
        const recorder = new CombatLiveRecorder();

        recorder.recordBattleUpdated(
            {
                battleId: 7,
                pMap: { 1: { cHP: 800, cMP: 40, atkCounter: 3, isAutoAtk: true, abilityHrid: '' } },
                mMap: { 0: { cHP: 250, dmgCounter: 4, critCounter: 1 } },
            },
            2000
        );

        expect(recorder.entries[0]).toEqual({
            k: 'bu',
            t: 2000,
            id: 7,
            p: { 1: [800, 40, 3, 1, '', null, null] },
            m: { 0: [250, null, null, 0, '', 4, 1] },
        });
    });

    test('keeps only the most recent entries once full', () => {
        const recorder = new CombatLiveRecorder(3);

        for (let at = 1; at <= 5; at++) recorder.recordBattleUpdated({ battleId: 1, pMap: {}, mMap: {} }, at);

        expect(recorder.entries.map((entry) => entry.t)).toEqual([3, 4, 5]);
    });

    test('exports a self-describing JSON document and can be cleared', () => {
        const recorder = new CombatLiveRecorder();
        recorder.recordBattleUpdated({ battleId: 1, pMap: {}, mMap: {} }, 1);

        const exported = JSON.parse(recorder.exportJSON(0));
        recorder.clear();

        expect(exported).toEqual(
            expect.objectContaining({
                format: 'toolasha-combat-live-recording',
                version: 2,
                recordedAt: '1970-01-01T00:00:00.000Z',
            })
        );
        expect(exported.entries).toHaveLength(1);
        expect(recorder.entries).toEqual([]);
    });
});
