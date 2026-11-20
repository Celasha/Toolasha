/**
 * Metz export for a loadout shared from a party member's window ("View Loadout")
 *
 * The game answers "View Loadout" with a `loadout_shared` message: the loadout's gear, abilities,
 * food, drinks and triggers, but none of the character's skill levels, houses, guild buffs or
 * achievements. Those come from the character's cached shared profile, so the export is that
 * profile's Metz character with the shared loadout laid over its gear. Without a cached profile
 * there is nothing honest to export (levels would be guesses), so it says so instead.
 */

import { getProfileList, getClientData } from './combat-sim-export.js';
import { constructMetzCharacterExport, applyLoadoutOverrideToMetzCharacter } from './combat-sim-export-metz.js';
import { mapLoadoutAbilitiesToNativeSlots } from '../combat-sim/combat-sim-adapter.js';

const DRINK_CATEGORY = '/item_categories/drink';

/**
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @returns {string|number|null} The character id, which only the loadout's items carry
 */
export function getSharedLoadoutCharacterId(loadout) {
    const sources = [
        ...Object.values(loadout?.wearableItemMap || {}),
        ...(loadout?.equippedAbilities || []),
        ...(loadout?.combatConsumables || []),
    ];
    return sources.find((entry) => entry?.characterID)?.characterID ?? null;
}

/**
 * Reshape a shared loadout into the parameters applyLoadoutOverrideToMetzCharacter takes.
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @param {Object} [clientObj] - Client data, for ability and item details
 * @returns {{equipment: Array<Object>, abilities: Array<Object|null>, triggerMap: Object, food: Array<Object>, drinks: Array<Object>}}
 */
export function buildOverrideFromSharedLoadout(loadout, clientObj) {
    const equipment = Object.values(loadout?.wearableItemMap || {})
        .filter((item) => item?.itemHrid && item.itemLocationHrid)
        .map((item) => ({
            itemLocationHrid: item.itemLocationHrid,
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
        }));

    const abilities = mapLoadoutAbilitiesToNativeSlots(
        (loadout?.equippedAbilities || []).map((ability) => ({ ...ability, slot: ability.slotNumber })),
        clientObj?.abilityDetailMap || {},
        (ability) => ({ abilityHrid: ability.abilityHrid, level: ability.level || 1 })
    );

    const food = [];
    const drinks = [];
    for (const consumable of loadout?.combatConsumables || []) {
        if (!consumable?.itemHrid) continue;
        const isDrink = clientObj?.itemDetailMap?.[consumable.itemHrid]?.categoryHrid === DRINK_CATEGORY;
        (isDrink ? drinks : food).push({ itemHrid: consumable.itemHrid });
    }

    return {
        equipment,
        abilities,
        triggerMap: {
            ...(loadout?.abilityCombatTriggersMap || {}),
            ...(loadout?.consumableCombatTriggersMap || {}),
        },
        food,
        drinks,
    };
}

/**
 * Build the Metz character for a shared loadout.
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @returns {Promise<{character: Object|null, reason: string|null}>} reason is 'noProfile' when the
 *     character has no cached profile to take levels from, 'noData' when there is no game data
 */
export async function constructMetzCharacterFromSharedLoadout(loadout) {
    const clientObj = getClientData();
    if (!loadout || !clientObj) return { character: null, reason: 'noData' };

    const characterId = getSharedLoadoutCharacterId(loadout);
    const name = loadout.sharableCharacter?.name;
    const profileList = await getProfileList();
    const profile = profileList.find(
        (entry) =>
            (characterId != null && String(entry.characterID) === String(characterId)) ||
            (characterId == null && name && entry.characterName === name)
    );
    if (!profile) return { character: null, reason: 'noProfile' };

    const base = await constructMetzCharacterExport(profile.characterID);
    if (!base) return { character: null, reason: 'noData' };

    return {
        character: applyLoadoutOverrideToMetzCharacter(base, buildOverrideFromSharedLoadout(loadout, clientObj)),
        reason: null,
    };
}
