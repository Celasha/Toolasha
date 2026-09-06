import { describe, expect, test } from 'vitest';
import Player from './player.js';
import { setGameData } from './game-data.js';

function baseDTO(overrides = {}) {
    return {
        staminaLevel: 100,
        intelligenceLevel: 100,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        hrid: 'player1',
        debuffOnLevelGap: 0,
        equipment: {},
        food: [],
        drinks: [],
        abilities: [],
        houseRooms: {},
        shrineLevels: {},
        ...overrides,
    };
}

function setSpiritShrineGameData() {
    setGameData({
        houseRoomDetailMap: {},
        guildBuffDetailMap: {
            '/guild_buffs/spirit_combat': {
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
                    },
                    {
                        uniqueHrid: '/buff_uniques/max_manapoints_guild_buff',
                        typeHrid: '/buff_types/max_manapoints',
                        ratioBoost: 0.01,
                        ratioBoostLevelBonus: 0.01,
                        flatBoost: 0,
                        flatBoostLevelBonus: 0,
                    },
                ],
            },
        },
    });
}

describe('Player.createFromDTO - Shrine wiring (UI-002)', () => {
    test('shrineLevels with level 0 contributes no Shrine instance', () => {
        setSpiritShrineGameData();
        const player = Player.createFromDTO(baseDTO({ shrineLevels: { '/guild_shrines/spirit': 0 } }));
        expect(player.shrines).toHaveLength(0);
    });

    test('a positive shrine level creates a Shrine instance and its buffs apply through generatePermanentBuffs', () => {
        setSpiritShrineGameData();
        const player = Player.createFromDTO(baseDTO({ shrineLevels: { '/guild_shrines/spirit': 20 } }));
        expect(player.shrines).toHaveLength(1);

        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
        player.clearBuffs(); // copies permanentBuffs into combatBuffs, mirrors reset() at combat start

        expect(player.permanentBuffs['/buff_types/max_hitpoints'].ratioBoost).toBeCloseTo(0.2);
        expect(player.combatDetails.maxHitpoints).toBe(1320);
        expect(player.combatDetails.maxManapoints).toBe(1320);
    });

    test("editing one player's shrine level changes only that player - no cross-player leakage", () => {
        setSpiritShrineGameData();
        const playerA = Player.createFromDTO(
            baseDTO({ hrid: 'player1', shrineLevels: { '/guild_shrines/spirit': 20 } })
        );
        const playerB = Player.createFromDTO(
            baseDTO({ hrid: 'player2', shrineLevels: { '/guild_shrines/spirit': 0 } })
        );

        playerA.zoneBuffs = [];
        playerA.extraBuffs = [];
        playerA.generatePermanentBuffs();
        playerA.clearBuffs();
        playerB.zoneBuffs = [];
        playerB.extraBuffs = [];
        playerB.generatePermanentBuffs();
        playerB.clearBuffs();

        expect(playerA.combatDetails.maxHitpoints).toBe(1320);
        expect(playerB.combatDetails.maxHitpoints).toBe(1100);
    });
});

describe('Player.createFromDTO - Achievement Tier wiring (TLA-044)', () => {
    function setAchievementGameData() {
        setGameData({
            houseRoomDetailMap: {},
            guildBuffDetailMap: {},
            achievementDetailMap: {
                '/achievements/damage_a': { tierHrid: '/achievement_tiers/damage_tier' },
                '/achievements/gathering_a': { tierHrid: '/achievement_tiers/gathering_tier' },
            },
            achievementTierDetailMap: {
                '/achievement_tiers/damage_tier': {
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
                },
                '/achievement_tiers/gathering_tier': {
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
                },
            },
        });
    }

    test('TLA044-13: completing a combat Damage tier increases resulting damage; a completed noncombat tier does not', () => {
        setAchievementGameData();

        const incomplete = Player.createFromDTO(baseDTO({ characterAchievements: [] }));
        incomplete.zoneBuffs = [];
        incomplete.extraBuffs = [];
        incomplete.generatePermanentBuffs();
        incomplete.clearBuffs();
        const baselineMaxDamage = incomplete.combatDetails.smashMaxDamage;

        const completeDamageOnly = Player.createFromDTO(
            baseDTO({
                characterAchievements: [{ achievementHrid: '/achievements/damage_a', isCompleted: true }],
            })
        );
        completeDamageOnly.zoneBuffs = [];
        completeDamageOnly.extraBuffs = [];
        completeDamageOnly.generatePermanentBuffs();
        completeDamageOnly.clearBuffs();

        expect(completeDamageOnly.combatDetails.smashMaxDamage).toBeGreaterThan(baselineMaxDamage);

        const completeGatheringOnly = Player.createFromDTO(
            baseDTO({
                characterAchievements: [{ achievementHrid: '/achievements/gathering_a', isCompleted: true }],
            })
        );
        completeGatheringOnly.zoneBuffs = [];
        completeGatheringOnly.extraBuffs = [];
        completeGatheringOnly.generatePermanentBuffs();
        completeGatheringOnly.clearBuffs();

        // A completed noncombat tier must change nothing about combat damage output.
        expect(completeGatheringOnly.combatDetails.smashMaxDamage).toBe(baselineMaxDamage);
    });

    test("editing one player's achievement completion changes only that player - no cross-player leakage", () => {
        setAchievementGameData();

        const playerA = Player.createFromDTO(
            baseDTO({
                hrid: 'player1',
                characterAchievements: [{ achievementHrid: '/achievements/damage_a', isCompleted: true }],
            })
        );
        const playerB = Player.createFromDTO(baseDTO({ hrid: 'player2', characterAchievements: [] }));

        playerA.zoneBuffs = [];
        playerA.extraBuffs = [];
        playerA.generatePermanentBuffs();
        playerA.clearBuffs();
        playerB.zoneBuffs = [];
        playerB.extraBuffs = [];
        playerB.generatePermanentBuffs();
        playerB.clearBuffs();

        expect(playerA.permanentBuffs['/buff_types/damage']?.ratioBoost).toBeCloseTo(0.02);
        expect(playerB.permanentBuffs['/buff_types/damage']).toBeUndefined();
    });
});
