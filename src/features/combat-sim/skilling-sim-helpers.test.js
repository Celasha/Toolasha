import { describe, expect, test } from 'vitest';
import { buildHouseBuffsForSkill } from './skilling-sim-helpers.js';

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
