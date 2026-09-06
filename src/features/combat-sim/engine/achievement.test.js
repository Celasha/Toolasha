import { describe, expect, test } from 'vitest';
import Achievement from './achievement.js';
import { setGameData } from './game-data.js';

// Mirrors the real game's shape: achievementDetailMap keys hrid -> {tierHrid}, achievementTierDetailMap
// keys tierHrid -> {buff, usableInActionTypeMap}. Tests never hardcode Novice/Veteran/Elite semantics -
// tier names below are arbitrary labels chosen only for test readability.
function gameData({ achievementDetailMap, achievementTierDetailMap }) {
    return { achievementDetailMap, achievementTierDetailMap };
}

const COMBAT_DAMAGE_TIER = {
    buff: {
        uniqueHrid: '/buff_uniques/tier_damage',
        typeHrid: '/buff_types/damage',
        ratioBoost: 0.02,
        ratioBoostLevelBonus: 0,
        flatBoost: 0,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/combat': true },
};

const COMBAT_WISDOM_TIER = {
    buff: {
        uniqueHrid: '/buff_uniques/tier_wisdom',
        typeHrid: '/buff_types/wisdom',
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.02,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/combat': true },
};

const COMBAT_RARE_FIND_TIER = {
    buff: {
        uniqueHrid: '/buff_uniques/tier_rare_find',
        typeHrid: '/buff_types/rare_find',
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.02,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/combat': true },
};

const NONCOMBAT_TIER = {
    buff: {
        uniqueHrid: '/buff_uniques/tier_gathering',
        typeHrid: '/buff_types/gathering',
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.02,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/foraging': true },
};

describe('Achievement - tier buffs constructed generically from achievementDetailMap/achievementTierDetailMap (TLA-044)', () => {
    test('TLA044-02: only one of two achievements in a combat tier completed -> no tier buff', () => {
        setGameData(
            gameData({
                achievementDetailMap: {
                    '/achievements/a': { tierHrid: '/achievement_tiers/damage_tier' },
                    '/achievements/b': { tierHrid: '/achievement_tiers/damage_tier' },
                },
                achievementTierDetailMap: { '/achievement_tiers/damage_tier': COMBAT_DAMAGE_TIER },
            })
        );

        const achievement = new Achievement([{ achievementHrid: '/achievements/a', isCompleted: true }]);
        expect(achievement.buffs).toHaveLength(0);
    });

    test('TLA044-03: every achievement in a combat tier completed -> its raw data-driven buff is present', () => {
        setGameData(
            gameData({
                achievementDetailMap: {
                    '/achievements/a': { tierHrid: '/achievement_tiers/damage_tier' },
                    '/achievements/b': { tierHrid: '/achievement_tiers/damage_tier' },
                },
                achievementTierDetailMap: { '/achievement_tiers/damage_tier': COMBAT_DAMAGE_TIER },
            })
        );

        const achievement = new Achievement([
            { achievementHrid: '/achievements/a', isCompleted: true },
            { achievementHrid: '/achievements/b', isCompleted: true },
        ]);
        expect(achievement.buffs).toHaveLength(1);
        expect(achievement.buffs[0].typeHrid).toBe('/buff_types/damage');
        expect(achievement.buffs[0].ratioBoost).toBeCloseTo(0.02);
    });

    test('TLA044-04: exact buff semantics - the raw damage buff carries the game-data ratioBoost, no hardcoded arithmetic', () => {
        setGameData(
            gameData({
                achievementDetailMap: { '/achievements/a': { tierHrid: '/achievement_tiers/damage_tier' } },
                achievementTierDetailMap: { '/achievement_tiers/damage_tier': COMBAT_DAMAGE_TIER },
            })
        );

        const achievement = new Achievement([{ achievementHrid: '/achievements/a', isCompleted: true }]);
        expect(achievement.buffs[0]).toMatchObject({
            uniqueHrid: '/buff_uniques/tier_damage',
            typeHrid: '/buff_types/damage',
            ratioBoost: 0.02,
            flatBoost: 0,
        });
    });

    test('TLA044-05: combat Wisdom and Rare Find tiers each produce their own raw buff', () => {
        setGameData(
            gameData({
                achievementDetailMap: {
                    '/achievements/wisdom_a': { tierHrid: '/achievement_tiers/wisdom_tier' },
                    '/achievements/rare_find_a': { tierHrid: '/achievement_tiers/rare_find_tier' },
                },
                achievementTierDetailMap: {
                    '/achievement_tiers/wisdom_tier': COMBAT_WISDOM_TIER,
                    '/achievement_tiers/rare_find_tier': COMBAT_RARE_FIND_TIER,
                },
            })
        );

        const achievement = new Achievement([
            { achievementHrid: '/achievements/wisdom_a', isCompleted: true },
            { achievementHrid: '/achievements/rare_find_a', isCompleted: true },
        ]);

        expect(achievement.buffs).toHaveLength(2);
        expect(achievement.buffs.some((b) => b.typeHrid === '/buff_types/wisdom' && b.flatBoost === 0.02)).toBe(true);
        expect(achievement.buffs.some((b) => b.typeHrid === '/buff_types/rare_find' && b.flatBoost === 0.02)).toBe(
            true
        );
    });

    test('TLA044-06: a completed tier not usable in combat contributes no Combat Sim buff', () => {
        setGameData(
            gameData({
                achievementDetailMap: { '/achievements/a': { tierHrid: '/achievement_tiers/gathering_tier' } },
                achievementTierDetailMap: { '/achievement_tiers/gathering_tier': NONCOMBAT_TIER },
            })
        );

        const achievement = new Achievement([{ achievementHrid: '/achievements/a', isCompleted: true }]);
        expect(achievement.buffs).toHaveLength(0);
    });

    test('TLA044-07: a tier with no resolvable achievement members never vacuously grants a buff', () => {
        setGameData(
            gameData({
                achievementDetailMap: {},
                achievementTierDetailMap: { '/achievement_tiers/empty_tier': COMBAT_DAMAGE_TIER },
            })
        );

        const achievement = new Achievement([]);
        expect(achievement.buffs).toHaveLength(0);
    });

    test("TLA044-09: per-player isolation - one Achievement instance never reflects another player's completion evidence", () => {
        setGameData(
            gameData({
                achievementDetailMap: { '/achievements/a': { tierHrid: '/achievement_tiers/damage_tier' } },
                achievementTierDetailMap: { '/achievement_tiers/damage_tier': COMBAT_DAMAGE_TIER },
            })
        );

        const complete = new Achievement([{ achievementHrid: '/achievements/a', isCompleted: true }]);
        const incomplete = new Achievement([{ achievementHrid: '/achievements/a', isCompleted: false }]);

        expect(complete.buffs).toHaveLength(1);
        expect(incomplete.buffs).toHaveLength(0);
    });

    test('missing/malformed characterAchievements input stays neutral rather than throwing', () => {
        setGameData(
            gameData({
                achievementDetailMap: { '/achievements/a': { tierHrid: '/achievement_tiers/damage_tier' } },
                achievementTierDetailMap: { '/achievement_tiers/damage_tier': COMBAT_DAMAGE_TIER },
            })
        );

        expect(new Achievement(undefined).buffs).toHaveLength(0);
        expect(new Achievement(null).buffs).toHaveLength(0);
        expect(new Achievement([]).buffs).toHaveLength(0);
    });
});
