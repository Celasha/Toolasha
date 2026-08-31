import Buff from './buff.js';
import { getGameData } from './game-data.js';

/**
 * A guild Shrine applies combat buffs constructed generically from the game's own
 * guildBuffDetailMap, never a hardcoded shrine-specific formula. `guildBuffDetailMap` entries are
 * grouped by `shrineHrid` and flagged `isCombat` - a shrine can have more than one combat buff
 * entry (e.g. Tempo has attack_speed and cast_speed), so every matching entry contributes.
 */
class Shrine {
    constructor(hrid, level) {
        this.hrid = hrid;
        this.level = level;

        const gameData = getGameData();
        const guildBuffDetailMap = gameData.guildBuffDetailMap || {};

        this.buffs = [];
        for (const guildBuff of Object.values(guildBuffDetailMap)) {
            if (guildBuff.shrineHrid !== hrid || !guildBuff.isCombat) continue;
            for (const rawBuff of guildBuff.buffs || []) {
                this.buffs.push(new Buff(rawBuff, level));
            }
        }
    }
}

export default Shrine;
