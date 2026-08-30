/**
 * Tests for ability timing calculator: effective cooldown/cast time formulas and live-stat
 * aggregation (gear+house via Combat Sim reconstruction, plus active temporary buffs).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    characterData: null,
    gameDataPayload: null,
    playerDTO: null,
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return mocks.characterData;
        },
    },
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => mocks.gameDataPayload),
    buildPlayerDTO: vi.fn(() => mocks.playerDTO),
}));

const { getCurrentAbilityTimingStats, calculateEffectiveAbilityTiming } =
    await import('./ability-timing-calculator.js');

describe('calculateEffectiveAbilityTiming', () => {
    test('no Ability Haste and no Cast Speed/Attack contribution leaves both values unchanged', () => {
        const result = calculateEffectiveAbilityTiming(15_000_000_000, 2_000_000_000, {
            abilityHaste: 0,
            castSpeed: 0,
        });
        expect(result.baseCooldown).toBe(15);
        expect(result.effectiveCooldown).toBe(15);
        expect(result.baseCastTime).toBe(2);
        expect(result.effectiveCastTime).toBe(2);
    });

    test('Ability Haste reduces cooldown via BaseCooldown * 100 / (100 + AbilityHaste)', () => {
        // 20 ability haste -> 15 * 100 / 120 = 12.5
        const result = calculateEffectiveAbilityTiming(15_000_000_000, 2_000_000_000, {
            abilityHaste: 20,
            castSpeed: 0,
        });
        expect(result.effectiveCooldown).toBeCloseTo(12.5, 6);
    });

    test('Cast Speed (already inclusive of Attack level contribution) reduces cast time via BaseCastTime / (1 + CastSpeed)', () => {
        // castSpeed already includes attackLevel/2000 per the engine's own calculation
        const result = calculateEffectiveAbilityTiming(15_000_000_000, 2_000_000_000, {
            abilityHaste: 0,
            castSpeed: 0.25,
        });
        expect(result.effectiveCastTime).toBeCloseTo(2 / 1.25, 6);
    });

    test('nanosecond base values are converted to seconds', () => {
        const result = calculateEffectiveAbilityTiming(20_000_000_000, 500_000_000, {
            abilityHaste: 0,
            castSpeed: 0,
        });
        expect(result.baseCooldown).toBe(20);
        expect(result.baseCastTime).toBe(0.5);
    });
});

describe('getCurrentAbilityTimingStats', () => {
    beforeEach(() => {
        mocks.characterData = {};
        mocks.gameDataPayload = {
            itemDetailMap: {},
            abilityDetailMap: {},
            houseRoomDetailMap: {},
            enhancementLevelTotalBonusMultiplierTable: { 0: 1 },
        };
        mocks.playerDTO = {
            staminaLevel: 1,
            intelligenceLevel: 1,
            attackLevel: 50,
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
        };
    });

    test('returns null when game data payload is unavailable', () => {
        mocks.gameDataPayload = null;
        expect(getCurrentAbilityTimingStats()).toBeNull();
    });

    test('returns null when player DTO is unavailable', () => {
        mocks.playerDTO = null;
        expect(getCurrentAbilityTimingStats()).toBeNull();
    });

    test('no gear/buffs -> zero abilityHaste, castSpeed driven only by Attack level (attackLevel/2000)', () => {
        const stats = getCurrentAbilityTimingStats();
        expect(stats.abilityHaste).toBe(0);
        expect(stats.castSpeed).toBeCloseTo(50 / 2000, 9);
        expect(stats.attackLevel).toBe(50);
    });

    test('sums active consumable cast_speed buff (e.g. Channeling Coffee) on top of the reconstructed baseline', () => {
        mocks.characterData.consumableActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.12 }],
        };
        const stats = getCurrentAbilityTimingStats();
        expect(stats.castSpeed).toBeCloseTo(50 / 2000 + 0.12, 9);
    });

    test('sums cast_speed across every non-equipment/house live buff map without double counting other buff types', () => {
        mocks.characterData.personalActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.05 }],
        };
        mocks.characterData.achievementActionTypeBuffsMap = {
            '/action_types/combat': [
                { typeHrid: '/buff_types/cast_speed', flatBoost: 0.02 },
                { typeHrid: '/buff_types/rare_find', flatBoost: 0.5 }, // must be ignored
            ],
        };
        mocks.characterData.mooPassActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.01 }],
        };
        mocks.characterData.communityActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.01 }],
        };
        mocks.characterData.guildActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.01 }],
        };

        const stats = getCurrentAbilityTimingStats();
        expect(stats.castSpeed).toBeCloseTo(50 / 2000 + 0.05 + 0.02 + 0.01 + 0.01 + 0.01, 9);
    });

    test('ignores buffs for a different action type', () => {
        mocks.characterData.consumableActionTypeBuffsMap = {
            '/action_types/milking': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.5 }],
        };
        const stats = getCurrentAbilityTimingStats();
        expect(stats.castSpeed).toBeCloseTo(50 / 2000, 9);
    });

    test('does not double count house/equipment cast speed by re-reading their live buff maps', () => {
        // equipmentActionTypeBuffsMap / houseActionTypeBuffsMap are populated live for other
        // features (e.g. labyrinth-clear-rate.js), but this aggregator must ignore them since
        // Player.generatePermanentBuffs() already reconstructs those sources from equipment/houseRooms.
        mocks.characterData.equipmentActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.3 }],
        };
        mocks.characterData.houseActionTypeBuffsMap = {
            '/action_types/combat': [{ typeHrid: '/buff_types/cast_speed', flatBoost: 0.3 }],
        };
        const stats = getCurrentAbilityTimingStats();
        expect(stats.castSpeed).toBeCloseTo(50 / 2000, 9);
    });

    test('equipped gear granting Ability Haste is reflected via Player reconstruction', () => {
        mocks.gameDataPayload.itemDetailMap = {
            '/items/chrono_gloves': {
                equipmentDetail: {
                    type: '/equipment_types/hands',
                    combatStats: { abilityHaste: 6 },
                    combatEnhancementBonuses: {},
                },
            },
        };
        mocks.playerDTO.equipment = {
            '/equipment_types/hands': { hrid: '/items/chrono_gloves', enhancementLevel: 0 },
        };
        const stats = getCurrentAbilityTimingStats();
        expect(stats.abilityHaste).toBe(6);
    });
});
