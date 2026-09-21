/**
 * Combat Simulator Export Module (Metz)
 *
 * Reshapes Toolasha's own Shykai-format player export into the array-of-characters shape the
 * Metz Combat Simulator's Setup screen accepts (https://metzlii.github.io/metz-combat-simulator/).
 * Metz's importer takes an array of character objects; each one is field-for-field the same
 * shape Shykai's importer takes (player skills+equipment, abilities, triggerMap, houseRooms,
 * guildCombatBuffLevels, food/drinks, achievements), except abilities/food/drinks list only
 * what is actually equipped (no blank-slot padding), and name/hasMooPass sit on the character
 * object directly instead of alongside it.
 */

import dataManager from '../../core/data-manager.js';
import {
    getCharacterData,
    getClientData,
    getBattleData,
    getProfileList,
    constructSelfPlayer,
    constructPartyPlayer,
} from './combat-sim-export.js';

/**
 * Drop Shykai's fixed-length blank-slot padding, keeping only genuinely equipped/set entries.
 * @param {Array<Object>} slots
 * @param {string} hridField - 'abilityHrid' or 'itemHrid'
 * @returns {Array<Object>}
 */
function dropBlankSlots(slots, hridField) {
    return (slots || []).filter((slot) => slot && slot[hridField]);
}

/**
 * Reshape one Shykai-format player object (from constructSelfPlayer/constructPartyPlayer) into
 * a Metz character entry.
 * @param {string} name
 * @param {Object} shykaiPlayer
 * @param {Object} [extra] - Fields only available for your own character (e.g. hasMooPass)
 * @returns {Object}
 */
function toMetzCharacter(name, shykaiPlayer, extra = {}) {
    const character = {
        name,
        player: shykaiPlayer.player,
        abilities: dropBlankSlots(shykaiPlayer.abilities, 'abilityHrid'),
        triggerMap: shykaiPlayer.triggerMap,
        houseRooms: shykaiPlayer.houseRooms,
        guildCombatBuffLevels: shykaiPlayer.guildCombatBuffLevels,
        food: { '/action_types/combat': dropBlankSlots(shykaiPlayer.food['/action_types/combat'], 'itemHrid') },
        drinks: { '/action_types/combat': dropBlankSlots(shykaiPlayer.drinks['/action_types/combat'], 'itemHrid') },
        ...extra,
    };
    if (shykaiPlayer.achievements && Object.keys(shykaiPlayer.achievements).length) {
        character.achievements = shykaiPlayer.achievements;
    }
    return character;
}

/**
 * Build the Metz character entry for your own character.
 * @param {Object} characterObj
 * @param {Object} clientObj
 * @returns {Object}
 */
function buildSelfMetzCharacter(characterObj, clientObj) {
    const selfPlayer = constructSelfPlayer(characterObj, clientObj);
    return toMetzCharacter(characterObj.character?.name || 'Player 1', selfPlayer, {
        hasMooPass: (dataManager.getMooPassBuffs()?.length ?? 0) > 0,
    });
}

/**
 * Build the array-of-characters export Metz's Setup screen accepts: your own character, plus
 * any party members Toolasha already has a cached profile for (the same profile cache the
 * Shykai export uses). Only your own character carries hasMooPass - a teammate's shared
 * profile does not expose it the same reliable way.
 *
 * Note: Metz's "Optimize" upgrade-finder tab also reads a per-character `owned`/`skilling`
 * block (spare gear, alchemy/enhancing setup) that this does not populate - only what Setup's
 * zone simulation needs is built here.
 * @returns {Promise<Array<Object>|null>} null if no character data is available at all
 */
export async function constructMetzTeamExport() {
    const characterObj = getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = getClientData();
    const battleObj = getBattleData();
    const profileList = await getProfileList();

    const team = [buildSelfMetzCharacter(characterObj, clientObj)];

    const partySlots = characterObj.partyInfo?.partySlotMap;
    if (partySlots) {
        for (const member of Object.values(partySlots)) {
            if (!member.characterID || member.characterID === characterObj.character.id) {
                continue;
            }
            const profile = profileList.find((p) => p.characterID === member.characterID);
            if (!profile) {
                continue;
            }
            const partyPlayer = constructPartyPlayer(profile, clientObj, battleObj);
            team.push(toMetzCharacter(profile.characterName, partyPlayer));
        }
    }

    return team;
}

/**
 * Build a single Metz character entry - your own character, or (if externalProfileId is given
 * and differs from your own id) a cached party/profile member. Mirrors constructExportObject's
 * singlePlayerFormat mode for Shykai, for the profile-box "Metz Sim Export" button.
 * @param {string|null} [externalProfileId]
 * @returns {Promise<Object|null>} null if no character data, or no cached profile for that id
 */
export async function constructMetzCharacterExport(externalProfileId = null) {
    const characterObj = getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = getClientData();

    if (externalProfileId && externalProfileId !== characterObj.character?.id) {
        const profileList = await getProfileList();
        const profile = profileList.find((p) => p.characterID === externalProfileId);
        if (!profile) {
            return null;
        }
        const battleObj = getBattleData();
        const partyPlayer = constructPartyPlayer(profile, clientObj, battleObj);
        return toMetzCharacter(profile.characterName, partyPlayer);
    }

    return buildSelfMetzCharacter(characterObj, clientObj);
}

/**
 * Apply a saved-loadout override (equipment/abilities/food/drinks/triggers) onto an existing
 * Metz character object, reshaping into Metz's un-padded slot format. Used by the profile-box
 * "Metz Sim Export" loadout dropdown, which exports a NAMED saved loadout instead of the
 * character's live equipped state.
 * @param {Object} character - A Metz character object (e.g. from constructMetzCharacterExport)
 * @param {Object} overrides
 * @param {Array<Object>} overrides.equipment
 * @param {Array<Object|null>} overrides.abilities - Native-slot-mapped (0..4), holes as null/undefined
 * @param {Object} overrides.triggerMap
 * @param {Array<Object>} overrides.food
 * @param {Array<Object>} overrides.drinks
 * @returns {Object} A new character object with the overrides applied
 */
export function applyLoadoutOverrideToMetzCharacter(character, { equipment, abilities, triggerMap, food, drinks }) {
    return {
        ...character,
        player: { ...character.player, equipment: (equipment || []).map((item) => ({ ...item })) },
        abilities: dropBlankSlots(abilities, 'abilityHrid'),
        triggerMap: triggerMap || {},
        food: { '/action_types/combat': dropBlankSlots(food, 'itemHrid') },
        drinks: { '/action_types/combat': dropBlankSlots(drinks, 'itemHrid') },
    };
}
