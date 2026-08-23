import { describe, expect, test } from 'vitest';
import HouseRoom from './house-room.js';
import { setGameData } from './game-data.js';

function makeRoom({ usableInActionTypeMap, actionBuffs, globalBuffs }) {
    return {
        hrid: '/house_rooms/test_room',
        usableInActionTypeMap,
        actionBuffs,
        globalBuffs,
    };
}

describe('HouseRoom - actionBuffs must be gated by the room-level usableInActionTypeMap', () => {
    test('a skilling-only room (e.g. Observatory/Enhancing) contributes no actionBuffs to a combat unit', () => {
        setGameData({
            houseRoomDetailMap: {
                '/house_rooms/observatory': makeRoom({
                    usableInActionTypeMap: { '/action_types/enhancing': true },
                    actionBuffs: [
                        {
                            uniqueHrid: '/buff_uniques/house_action_speed',
                            typeHrid: '/buff_types/action_speed',
                            flatBoost: 0.01,
                            flatBoostLevelBonus: 0.01,
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                    globalBuffs: [
                        {
                            uniqueHrid: '/buff_uniques/house_rare_find',
                            typeHrid: '/buff_types/rare_find',
                            flatBoost: 0.002,
                            flatBoostLevelBonus: 0.002,
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                }),
            },
        });

        const room = new HouseRoom('/house_rooms/observatory', 4);

        expect(room.buffs.some((b) => b.typeHrid === '/buff_types/action_speed')).toBe(false);
        // globalBuffs must still be present - they have no action-type restriction in the game's own data.
        expect(room.buffs.some((b) => b.typeHrid === '/buff_types/rare_find')).toBe(true);
    });

    test('a combat room (e.g. Armory) still contributes its actionBuffs to a combat unit', () => {
        setGameData({
            houseRoomDetailMap: {
                '/house_rooms/armory': makeRoom({
                    usableInActionTypeMap: { '/action_types/combat': true },
                    actionBuffs: [
                        {
                            uniqueHrid: '/buff_uniques/house_defense_level',
                            typeHrid: '/buff_types/defense_level',
                            flatBoost: 1,
                            flatBoostLevelBonus: 1,
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                    globalBuffs: [
                        {
                            uniqueHrid: '/buff_uniques/house_rare_find',
                            typeHrid: '/buff_types/rare_find',
                            flatBoost: 0.002,
                            flatBoostLevelBonus: 0.002,
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                }),
            },
        });

        const room = new HouseRoom('/house_rooms/armory', 4);

        expect(room.buffs.some((b) => b.typeHrid === '/buff_types/defense_level')).toBe(true);
    });

    test('a room with no usableInActionTypeMap at all contributes no actionBuffs (fails closed, not open)', () => {
        setGameData({
            houseRoomDetailMap: {
                '/house_rooms/mystery_room': makeRoom({
                    usableInActionTypeMap: undefined,
                    actionBuffs: [
                        {
                            uniqueHrid: '/buff_uniques/x',
                            typeHrid: '/buff_types/action_speed',
                            flatBoost: 1,
                            flatBoostLevelBonus: 1,
                            ratioBoost: 0,
                            ratioBoostLevelBonus: 0,
                            duration: 0,
                        },
                    ],
                    globalBuffs: [],
                }),
            },
        });

        const room = new HouseRoom('/house_rooms/mystery_room', 4);

        expect(room.buffs).toEqual([]);
    });
});
