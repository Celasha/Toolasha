import { describe, expect, test } from 'vitest';
import * as constants from './combat-constants.js';

describe('combat constants', () => {
    test('every chest that needs an entry key also needs a chest key', () => {
        for (const chestHrid of Object.keys(constants.DUNGEON_ENTRY_KEYS)) {
            expect(constants.DUNGEON_CHEST_KEYS[chestHrid]).toBeTruthy();
        }
    });

    test('refinement chests share the chest key of their regular chest', () => {
        expect(constants.DUNGEON_CHEST_KEYS['/items/sinister_refinement_chest']).toBe(
            constants.DUNGEON_CHEST_KEYS['/items/sinister_chest']
        );
    });

    test('finds the combat guild buff for a shrine, and null when there is none', () => {
        const buffs = {
            '/guild_buffs/force_combat': { shrineHrid: '/guild_shrines/force', isCombat: true },
            '/guild_buffs/force_other': { shrineHrid: '/guild_shrines/force', isCombat: false },
        };

        expect(constants.getCombatGuildBuffHridForShrine('/guild_shrines/force', buffs)).toBe(
            '/guild_buffs/force_combat'
        );
        expect(constants.getCombatGuildBuffHridForShrine('/guild_shrines/tempo', buffs)).toBeNull();
        expect(constants.getCombatGuildBuffHridForShrine('/guild_shrines/force', null)).toBeNull();
    });

    test('the simulator adapter still re-exports the same tables for its own files', async () => {
        const adapter = await import('../features/combat-sim/combat-sim-adapter.js');

        expect(adapter.DUNGEON_ENTRY_KEYS).toBe(constants.DUNGEON_ENTRY_KEYS);
        expect(adapter.DUNGEON_CHEST_KEYS).toBe(constants.DUNGEON_CHEST_KEYS);
        expect(adapter.COMBAT_SHRINE_HRIDS).toBe(constants.COMBAT_SHRINE_HRIDS);
        expect(adapter.getCombatGuildBuffHridForShrine).toBe(constants.getCombatGuildBuffHridForShrine);
    });
});
