import Buff from './buff.js';
import { getGameData } from './game-data.js';

/**
 * A house room applies two kinds of buffs from the game's own houseRoomDetailMap:
 * - actionBuffs: only meaningful for the room's own skill (e.g. Observatory's action_speed is
 *   for Enhancing). The game data itself only marks this restriction at the room level, via
 *   `usableInActionTypeMap` - individual buff entries carry no such field - so this class is a
 *   combat unit, and must only include actionBuffs for a room whose usableInActionTypeMap
 *   includes /action_types/combat (e.g. Armory, Dojo). Skilling-only rooms (Observatory,
 *   Laboratory, Sewing Parlor, Workshop, etc.) contribute none.
 * - globalBuffs: always wisdom + rare_find, with no action-type restriction in the game's own
 *   data - these apply from every room regardless of its skill.
 */
class HouseRoom {
    constructor(hrid, level) {
        this.hrid = hrid;
        this.level = level;

        const gameData = getGameData();
        const gameHouseRoom = gameData.houseRoomDetailMap[this.hrid];
        if (!gameHouseRoom) {
            throw new Error('No house room found for hrid: ' + this.hrid);
        }

        this.buffs = [];
        if (gameHouseRoom.actionBuffs && gameHouseRoom.usableInActionTypeMap?.['/action_types/combat']) {
            for (const actionBuff of gameHouseRoom.actionBuffs) {
                const buff = new Buff(actionBuff, level);
                this.buffs.push(buff);
            }
        }
        if (gameHouseRoom.globalBuffs) {
            for (const globalBuff of gameHouseRoom.globalBuffs) {
                const buff = new Buff(globalBuff, level);
                this.buffs.push(buff);
            }
        }
    }
}

export default HouseRoom;
