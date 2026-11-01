/**
 * Combat constants shared across bundles
 *
 * Stateless game-data tables that features outside the combat simulator also need (key costs for
 * chest analytics and risk of ruin, shrine hrids for the sim export). They live here, not in the
 * simulator adapter, so importing them never pulls the adapter and its dependencies into a bundle.
 */

/**
 * The five current combat-relevant guild Shrines (CSIM-AUD-021, UI-002). Effect construction is
 * fully data-driven (see combat-sim/engine/shrine.js) - this list only identifies which shrine
 * hrids the Sim Editor and DTO builders should carry, never their formulas.
 */
export const COMBAT_SHRINE_HRIDS = [
    '/guild_shrines/force',
    '/guild_shrines/tempo',
    '/guild_shrines/spirit',
    '/guild_shrines/rarity',
    '/guild_shrines/scholar',
];

/**
 * Resolve a shrine's own combat guild-buff hrid (e.g. "/guild_shrines/force" ->
 * "/guild_buffs/force_combat"). Shrine level evidence (purchased/active level, as opposed to the
 * shrine building's unlocked cap) is only ever exposed keyed by guild-buff hrid - never by shrine
 * hrid - in both `characterGuildBuffMap`/`getCharacterGuildBuffLevel` (self) and a shared
 * profile's `guildBuffLevelMap` (party members), so every caller needs this same resolution first.
 * @param {string} shrineHrid
 * @param {Object} guildBuffDetailMap
 * @returns {string|null}
 */
export function getCombatGuildBuffHridForShrine(shrineHrid, guildBuffDetailMap) {
    for (const [buffHrid, buff] of Object.entries(guildBuffDetailMap || {})) {
        if (buff.shrineHrid === shrineHrid && buff.isCombat) return buffHrid;
    }
    return null;
}

// Maps dungeon chest HRIDs to their required entry key HRIDs
export const DUNGEON_ENTRY_KEYS = {
    '/items/chimerical_chest': '/items/chimerical_entry_key',
    '/items/sinister_chest': '/items/sinister_entry_key',
    '/items/enchanted_chest': '/items/enchanted_entry_key',
    '/items/pirate_chest': '/items/pirate_entry_key',
};

// Maps dungeon chest HRIDs (regular + refinement) to their chest key HRIDs
export const DUNGEON_CHEST_KEYS = {
    '/items/chimerical_chest': '/items/chimerical_chest_key',
    '/items/sinister_chest': '/items/sinister_chest_key',
    '/items/enchanted_chest': '/items/enchanted_chest_key',
    '/items/pirate_chest': '/items/pirate_chest_key',
    '/items/chimerical_refinement_chest': '/items/chimerical_chest_key',
    '/items/sinister_refinement_chest': '/items/sinister_chest_key',
    '/items/enchanted_refinement_chest': '/items/enchanted_chest_key',
    '/items/pirate_refinement_chest': '/items/pirate_chest_key',
};
