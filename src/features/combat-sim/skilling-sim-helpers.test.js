import { describe, expect, test } from 'vitest';
import { buildHouseBuffsForSkill, buildEquipmentBuffsForSkill } from './skilling-sim-helpers.js';

function makeRoom({ usableInActionTypeMap, actionBuffs, globalBuffs }) {
    return { usableInActionTypeMap, actionBuffs, globalBuffs };
}

describe('buildHouseBuffsForSkill - actionBuffs must be gated by the room-level usableInActionTypeMap', () => {
    test('a room usable for this skill contributes its actionBuffs', () => {
        const houseRoomDetailMap = {
            '/house_rooms/laboratory': makeRoom({
                usableInActionTypeMap: { '/action_types/alchemy': true },
                actionBuffs: [
                    {
                        uniqueHrid: '/buff_uniques/house_efficiency',
                        typeHrid: '/buff_types/efficiency',
                        flatBoost: 0,
                        flatBoostLevelBonus: 0.015,
                        ratioBoost: 0,
                        ratioBoostLevelBonus: 0,
                    },
                ],
                globalBuffs: [
                    {
                        uniqueHrid: '/buff_uniques/house_rare_find',
                        typeHrid: '/buff_types/rare_find',
                        flatBoost: 0,
                        flatBoostLevelBonus: 0.002,
                        ratioBoost: 0,
                        ratioBoostLevelBonus: 0,
                    },
                ],
            }),
        };

        const buffs = buildHouseBuffsForSkill(
            { '/house_rooms/laboratory': 4 },
            '/action_types/alchemy',
            houseRoomDetailMap
        );

        expect(buffs.some((b) => b.typeHrid === '/buff_types/efficiency')).toBe(true);
        expect(buffs.some((b) => b.typeHrid === '/buff_types/rare_find')).toBe(true);
    });

    test('a room NOT usable for this skill contributes no actionBuffs, but still contributes globalBuffs', () => {
        const houseRoomDetailMap = {
            '/house_rooms/laboratory': makeRoom({
                usableInActionTypeMap: { '/action_types/alchemy': true },
                actionBuffs: [
                    {
                        uniqueHrid: '/buff_uniques/house_efficiency',
                        typeHrid: '/buff_types/efficiency',
                        flatBoost: 0,
                        flatBoostLevelBonus: 0.015,
                        ratioBoost: 0,
                        ratioBoostLevelBonus: 0,
                    },
                ],
                globalBuffs: [
                    {
                        uniqueHrid: '/buff_uniques/house_rare_find',
                        typeHrid: '/buff_types/rare_find',
                        flatBoost: 0,
                        flatBoostLevelBonus: 0.002,
                        ratioBoost: 0,
                        ratioBoostLevelBonus: 0,
                    },
                ],
            }),
        };

        // Same Laboratory, but querying buffs for a different skill (crafting, not alchemy).
        const buffs = buildHouseBuffsForSkill(
            { '/house_rooms/laboratory': 4 },
            '/action_types/crafting',
            houseRoomDetailMap
        );

        expect(buffs.some((b) => b.typeHrid === '/buff_types/efficiency')).toBe(false);
        expect(buffs.some((b) => b.typeHrid === '/buff_types/rare_find')).toBe(true);
    });

    test('a room with no usableInActionTypeMap at all contributes no actionBuffs for any skill', () => {
        const houseRoomDetailMap = {
            '/house_rooms/mystery_room': makeRoom({
                usableInActionTypeMap: undefined,
                actionBuffs: [
                    {
                        uniqueHrid: '/buff_uniques/x',
                        typeHrid: '/buff_types/efficiency',
                        flatBoost: 0,
                        flatBoostLevelBonus: 1,
                        ratioBoost: 0,
                        ratioBoostLevelBonus: 0,
                    },
                ],
                globalBuffs: [],
            }),
        };

        const buffs = buildHouseBuffsForSkill(
            { '/house_rooms/mystery_room': 4 },
            '/action_types/alchemy',
            houseRoomDetailMap
        );

        expect(buffs).toEqual([]);
    });
});

describe('buildEquipmentBuffsForSkill - equipment success chance stats (e.g. Enhancer tools)', () => {
    test('an Enhancer tool contributes an enhancing_success buff', () => {
        const itemDetailMap = {
            '/items/celestial_enhancer': {
                equipmentDetail: {
                    type: '/equipment_types/tool',
                    noncombatStats: { enhancingSuccess: 0.042 },
                },
            },
        };
        const equipment = { '/equipment_types/tool': { hrid: '/items/celestial_enhancer', enhancementLevel: 0 } };

        const buffs = buildEquipmentBuffsForSkill(equipment, '/action_types/enhancing', itemDetailMap);

        const successBuff = buffs.find((b) => b.typeHrid === '/buff_types/enhancing_success');
        expect(successBuff).toBeDefined();
        expect(successBuff.ratioBoost).toBeCloseTo(0.042);
    });

    test('a tool with no success stat contributes no success buff for an unrelated skill', () => {
        const itemDetailMap = {
            '/items/celestial_hatchet': {
                equipmentDetail: {
                    type: '/equipment_types/tool',
                    noncombatStats: { woodcuttingSpeed: 0.1 },
                },
            },
        };
        const equipment = { '/equipment_types/tool': { hrid: '/items/celestial_hatchet', enhancementLevel: 0 } };

        const buffs = buildEquipmentBuffsForSkill(equipment, '/action_types/woodcutting', itemDetailMap);

        expect(buffs.some((b) => b.typeHrid.endsWith('_success'))).toBe(false);
    });
});
