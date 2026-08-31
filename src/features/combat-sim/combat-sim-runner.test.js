import { describe, expect, test } from 'vitest';
import { buildExtraBuffs, buildExtraBuffsByPlayer } from './combat-sim-runner.js';

describe('buildExtraBuffs (CSIM-AUD-019/021) - no longer carries guild/Shrine buffs', () => {
    test('hasMooPass=true contributes the MooPass wisdom buff', () => {
        const buffs = buildExtraBuffs({}, true);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
    });

    test('hasMooPass=false contributes no MooPass buff', () => {
        const buffs = buildExtraBuffs({}, false);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(false);
    });

    test('community EXP/Drop buffs are genuinely global and always included regardless of hasMooPass', () => {
        const buffs = buildExtraBuffs({ comExp: 5, comDrop: 3 }, false);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/combat_community_buff')).toBe(true);
    });

    test('never accepts/emits guild combat buffs - Shrines are handled exclusively by the engine Shrine class', () => {
        // Old signature took a second guildCombatBuffs array param; confirm passing one has no effect.
        const buffs = buildExtraBuffs({}, [{ uniqueHrid: '/buff_uniques/should_be_ignored' }]);
        expect(buffs.some((b) => b.uniqueHrid === '/buff_uniques/should_be_ignored')).toBe(false);
    });
});

describe('buildExtraBuffsByPlayer - per-player ownership (CSIM-AUD-019/020)', () => {
    test('each player gets their own array, keyed by their own hrid, based on their own hasMooPass flag', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: true },
            { hrid: 'player2', hasMooPass: false },
            { hrid: 'player3', hasMooPass: true },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, {});

        expect(byPlayer.player1.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
        expect(byPlayer.player2.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(false);
        expect(byPlayer.player3.some((b) => b.uniqueHrid === '/buff_uniques/experience_moo_pass_buff')).toBe(true);
    });

    test('every player gets a distinct array reference - never one shared array applied to all players', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: true },
            { hrid: 'player2', hasMooPass: true },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, {});

        expect(byPlayer.player1).not.toBe(byPlayer.player2);
        expect(byPlayer.player1).toEqual(byPlayer.player2); // same content, different identity
    });

    test('community buffs are applied identically to every player (genuinely global)', () => {
        const playerDTOs = [
            { hrid: 'player1', hasMooPass: false },
            { hrid: 'player2', hasMooPass: false },
        ];

        const byPlayer = buildExtraBuffsByPlayer(playerDTOs, { comExp: 10 });

        expect(byPlayer.player1.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
        expect(byPlayer.player2.some((b) => b.uniqueHrid === '/buff_uniques/experience_community_buff')).toBe(true);
    });
});
