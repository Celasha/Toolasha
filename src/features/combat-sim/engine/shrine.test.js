import { describe, expect, test } from 'vitest';
import Shrine from './shrine.js';
import { setGameData } from './game-data.js';

function guildBuffEntry({ shrineHrid, isCombat, buffs }) {
    return { shrineHrid, isCombat, buffs };
}

describe('Shrine - buffs constructed generically from guildBuffDetailMap, never hardcoded', () => {
    test('Spirit shrine at level 20 (ratioBoost 0.01 + 19*0.01) yields the exact +20% max HP/MP fixture', () => {
        setGameData({
            guildBuffDetailMap: {
                '/guild_buffs/spirit_combat': guildBuffEntry({
                    shrineHrid: '/guild_shrines/spirit',
                    isCombat: true,
                    buffs: [
                        {
                            uniqueHrid: '/buff_uniques/max_hitpoints_guild_buff',
                            typeHrid: '/buff_types/max_hitpoints',
                            ratioBoost: 0.01,
                            ratioBoostLevelBonus: 0.01,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                            duration: 0,
                        },
                        {
                            uniqueHrid: '/buff_uniques/max_manapoints_guild_buff',
                            typeHrid: '/buff_types/max_manapoints',
                            ratioBoost: 0.01,
                            ratioBoostLevelBonus: 0.01,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                }),
                '/guild_buffs/spirit_skilling': guildBuffEntry({
                    shrineHrid: '/guild_shrines/spirit',
                    isCombat: false,
                    buffs: [
                        {
                            typeHrid: '/buff_types/skilling_only',
                            ratioBoost: 1,
                            ratioBoostLevelBonus: 1,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                        },
                    ],
                }),
            },
        });

        const shrine = new Shrine('/guild_shrines/spirit', 20);

        expect(shrine.buffs).toHaveLength(2);
        const maxHp = shrine.buffs.find((b) => b.typeHrid === '/buff_types/max_hitpoints');
        const maxMp = shrine.buffs.find((b) => b.typeHrid === '/buff_types/max_manapoints');
        expect(maxHp.ratioBoost).toBeCloseTo(0.2);
        expect(maxMp.ratioBoost).toBeCloseTo(0.2);
        // The skilling-only entry (isCombat: false) must never contribute.
        expect(shrine.buffs.some((b) => b.typeHrid === '/buff_types/skilling_only')).toBe(false);
    });

    test('a shrine with multiple combat buff entries (e.g. Tempo: attack_speed + cast_speed) includes all of them', () => {
        setGameData({
            guildBuffDetailMap: {
                '/guild_buffs/tempo_combat': guildBuffEntry({
                    shrineHrid: '/guild_shrines/tempo',
                    isCombat: true,
                    buffs: [
                        {
                            uniqueHrid: '/buff_uniques/tempo_attack_speed',
                            typeHrid: '/buff_types/attack_speed',
                            ratioBoost: 0.004,
                            ratioBoostLevelBonus: 0.004,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                        },
                        {
                            uniqueHrid: '/buff_uniques/tempo_cast_speed',
                            typeHrid: '/buff_types/cast_speed',
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            flatBoost: 0.004,
                            flatBoostLevelBonus: 0.004,
                        },
                    ],
                }),
            },
        });

        const shrine = new Shrine('/guild_shrines/tempo', 5);

        expect(shrine.buffs).toHaveLength(2);
        expect(shrine.buffs.some((b) => b.typeHrid === '/buff_types/attack_speed')).toBe(true);
        expect(shrine.buffs.some((b) => b.typeHrid === '/buff_types/cast_speed')).toBe(true);
    });

    test('level 0 (no shrine effect) still constructs, buff values reflect the base (level-1=-1 term unused since caller should skip level 0)', () => {
        setGameData({
            guildBuffDetailMap: {
                '/guild_buffs/force_combat': guildBuffEntry({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    buffs: [
                        {
                            uniqueHrid: '/buff_uniques/force_damage',
                            typeHrid: '/buff_types/damage',
                            ratioBoost: 0.003,
                            ratioBoostLevelBonus: 0.003,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                        },
                    ],
                }),
            },
        });

        const shrine = new Shrine('/guild_shrines/force', 1);
        expect(shrine.buffs[0].ratioBoost).toBeCloseTo(0.003);
    });

    test('an unrelated shrine hrid contributes no buffs', () => {
        setGameData({
            guildBuffDetailMap: {
                '/guild_buffs/force_combat': guildBuffEntry({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    buffs: [
                        {
                            typeHrid: '/buff_types/damage',
                            ratioBoost: 0.003,
                            ratioBoostLevelBonus: 0.003,
                            flatBoost: 0,
                            flatBoostLevelBonus: 0,
                        },
                    ],
                }),
            },
        });

        const shrine = new Shrine('/guild_shrines/rarity', 10);
        expect(shrine.buffs).toEqual([]);
    });
});
