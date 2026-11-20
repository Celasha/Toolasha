/**
 * Shared loadouts for the Metz export
 *
 * The game answers a party member's "View Loadout" with a `loadout_shared` message: the loadout's
 * gear, abilities, food, drinks and triggers, but no skill levels, houses, guild buffs or
 * achievements (those come from the character's cached shared profile). Each viewed loadout is
 * turned into one of Metz's `loadouts` entries and kept per character in GM storage, which is how
 * the Metz site, where the import button runs, can see it.
 *
 * "View Loadout" always shows the loadout the member has selected for GROUP COMBAT, whatever they are
 * doing right now, while their profile shows what they are wearing at that moment (a solo or skilling
 * set, as often as not). So the newest viewing is exported with Metz's `groupCombat: true` mark (Metz
 * 1.0.42+): the site puts that loadout on the player at import, as the baseline its edit marks and
 * Reset measure against, and keeps the profile's equipped gear in the picker as "Profile Loadout".
 * Older viewings are exported unmarked and show as extra picks.
 *
 * The message carries no loadout id. The party data does: every slot of partyInfo.partySlotMap has
 * `characterLoadoutID`, the loadout its member has selected (see getPartyLoadoutId). Your own id names
 * one of your saved loadouts, so your group loadout is marked from it with no viewing at all; your own
 * "View Loadout" is only the fallback, matched by content. A teammate's id cannot be turned into gear,
 * but it is kept with their viewing, and a different id later means they have changed their selection
 * and the viewing is out of date.
 */

import { t } from '../../core/i18n.js';
import { getCharacterData, getClientData, getProfileList } from './combat-sim-export.js';
import { buildMetzLoadouts, getMetzLoadouts } from './combat-sim-loadouts-metz.js';
import { mapLoadoutAbilitiesToNativeSlots } from '../combat-sim/combat-sim-adapter.js';

const DRINK_CATEGORY = '/item_categories/drink';
const WEAPON_LOCATIONS = ['/item_locations/two_hand', '/item_locations/main_hand'];
const GM_SHARED_LOADOUTS_KEY = 'toolasha_shared_loadouts';
const MAX_LOADOUTS_PER_CHARACTER = 5;
// Metz labels the entry with this id "Group Loadout" in its picker (any other marked entry reads
// "<name> · Group Loadout")
const GROUP_LOADOUT_ID = 'group-combat';

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
 * Reshape a shared loadout into the parameters applyLoadoutOverrideToMetzCharacter takes, for copying
 * a character with this loadout worn.
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

// Short stable id from the loadout's contents, so viewing the same loadout again replaces its entry
function hashContent(value) {
    const text = JSON.stringify(value);
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

/**
 * Turn a shared loadout into one of Metz's `loadouts` entries.
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @param {Object} clientObj - Client data, for item names and the food/drink split
 * @param {number} [viewedAt] - When it was viewed, in ms
 * @returns {Object|null} {id, name, equipment, abilities, food, drinks, triggerMap, viewedAt}, null when it is
 *     not a combat loadout or holds no gear and no abilities
 */
export function buildSharedMetzLoadout(loadout, clientObj, viewedAt = Date.now()) {
    const worn = Object.values(loadout?.wearableItemMap || {})
        .filter((item) => item?.itemHrid && item.itemLocationHrid)
        .map((item) => ({
            itemLocationHrid: item.itemLocationHrid,
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
        }))
        .sort((a, b) => a.itemLocationHrid.localeCompare(b.itemLocationHrid));

    const food = [];
    const drinks = [];
    for (const consumable of loadout?.combatConsumables || []) {
        if (!consumable?.itemHrid) continue;
        const isDrink = clientObj?.itemDetailMap?.[consumable.itemHrid]?.categoryHrid === DRINK_CATEGORY;
        (isDrink ? drinks : food).push({ itemHrid: consumable.itemHrid });
    }

    const slotted = loadout?.equippedAbilities || [];
    const abilityLevels = {};
    for (const ability of slotted) {
        if (ability?.abilityHrid) abilityLevels[ability.abilityHrid] = ability.level || 1;
    }

    const snapshot = {
        actionTypeHrid: loadout?.actionTypeHrid,
        equipment: worn,
        abilities: slotted
            .filter((ability) => ability?.abilityHrid)
            .map((ability) => ({ abilityHrid: ability.abilityHrid, slot: ability.slotNumber })),
        food,
        drinks,
        abilityCombatTriggersMap: loadout?.abilityCombatTriggersMap || {},
        consumableCombatTriggersMap: loadout?.consumableCombatTriggersMap || {},
    };
    const [built] = buildMetzLoadouts([snapshot], abilityLevels);
    if (!built) return null;

    const weapon = findWeapon(worn);
    const weaponName = weapon ? clientObj?.itemDetailMap?.[weapon.itemHrid]?.name : null;
    const when = new Date(viewedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
    const name = t('sharedLoadoutsMetz.loadoutName', { when });

    return {
        ...built,
        id: `shared-${hashContent({ ...built, id: null, name: null })}`,
        name: weaponName ? `${name} · ${weaponName}` : name,
        viewedAt,
    };
}

function findWeapon(equipment) {
    for (const location of WEAPON_LOCATIONS) {
        const item = equipment?.find((entry) => entry.itemLocationHrid === location);
        if (item) return item;
    }
    return null;
}

function readStore() {
    if (typeof GM_getValue === 'undefined') return {};
    try {
        const parsed = JSON.parse(GM_getValue(GM_SHARED_LOADOUTS_KEY, null) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.error('[SharedLoadoutsMetz] Failed to read stored loadouts:', error);
        return {};
    }
}

function writeStore(store) {
    if (typeof GM_setValue === 'undefined') return false;
    try {
        GM_setValue(GM_SHARED_LOADOUTS_KEY, JSON.stringify(store));
        return true;
    } catch (error) {
        console.error('[SharedLoadoutsMetz] Failed to store loadouts:', error);
        return false;
    }
}

/**
 * @param {string|number} characterId
 * @returns {Array<Object>} The loadouts stored for that character, newest first, with `viewedAt`
 */
export function getStoredSharedLoadouts(characterId) {
    const entry = readStore()[String(characterId)];
    return Array.isArray(entry?.loadouts) ? entry.loadouts : [];
}

/**
 * @param {string|number} characterId
 * @returns {Array<Object>} The loadouts viewed for that character as Metz takes them, newest first, without the
 *     stored bookkeeping. The newest is their group combat loadout: it carries Metz's `groupCombat` mark and the
 *     id Metz names "Group Loadout". The older ones are exported unmarked.
 */
export function getSharedMetzLoadouts(characterId) {
    return getStoredSharedLoadouts(characterId).map(
        // eslint-disable-next-line no-unused-vars
        ({ viewedAt, slotLoadoutId, ...loadout }, index) =>
            index === 0 ? { ...loadout, id: GROUP_LOADOUT_ID, groupCombat: true } : loadout
    );
}

/**
 * The id of the loadout a party member has selected for group combat. Every slot of
 * partyInfo.partySlotMap carries `characterLoadoutID` beside `characterID`.
 * @param {Object} characterObj - Character data, with partyInfo
 * @param {string|number} characterId
 * @returns {string|number|null} null outside a party, or when the member has none selected
 */
export function getPartyLoadoutId(characterObj, characterId) {
    for (const slot of Object.values(characterObj?.partyInfo?.partySlotMap || {})) {
        if (slot?.characterID != null && String(slot.characterID) === String(characterId)) {
            return slot.characterLoadoutID || null;
        }
    }
    return null;
}

/**
 * Two loadouts with the same gear (item and enhancement level), abilities, food and drinks are the same
 * loadout. Never the item location: a saved loadout's rows can name where the item sat when the loadout was
 * saved (the inventory), a viewed one names the slot, and with the location in the comparison a saved loadout
 * never matches its own viewed copy.
 * @param {Object} loadout - One of Metz's `loadouts` entries
 * @returns {string}
 */
function loadoutSignature(loadout) {
    const sorted = (rows, toKey) => (Array.isArray(rows) ? rows : []).map(toKey).sort();
    return JSON.stringify([
        sorted(loadout?.equipment, (item) => `${item.itemHrid}|${Number(item.enhancementLevel) || 0}`),
        sorted(loadout?.abilities, (ability) => ability.abilityHrid),
        sorted(loadout?.food, (item) => item.itemHrid),
        sorted(loadout?.drinks, (item) => item.itemHrid),
    ]);
}

/**
 * Mark which of your own saved loadouts is the one selected for group combat: `groupCombat: true` on that
 * entry, which keeps its name and id. Your party slot's loadout id decides when it names one of the saved
 * loadouts (a saved loadout's `id` is the game's loadout id). Otherwise your own "View Loadout" is matched by
 * content; when that matches none (it was edited since, or needs gear you no longer own) the viewed loadout
 * joins the list itself. At most one entry carries the mark.
 * @param {Array<Object>} saved - Your saved loadouts, from getMetzLoadouts
 * @param {Object|null} group - Your viewed group loadout, when it still applies
 * @param {string|number|null} selectedId - Your party slot's loadout id
 * @returns {Array<Object>}
 */
function markGroupLoadout(saved, group, selectedId) {
    // eslint-disable-next-line no-unused-vars
    const unmarked = (Array.isArray(saved) ? saved : []).map(({ groupCombat, ...loadout }) => loadout);
    const mark = (index) => unmarked.map((loadout, i) => (i === index ? { ...loadout, groupCombat: true } : loadout));
    if (selectedId != null) {
        const selected = unmarked.findIndex((loadout) => String(loadout.id) === String(selectedId));
        if (selected >= 0) return mark(selected);
    }
    if (!group) return unmarked;
    const signature = loadoutSignature(group);
    const index = unmarked.findIndex((loadout) => loadoutSignature(loadout) === signature);
    return index < 0 ? [...unmarked, group] : mark(index);
}

/**
 * Your saved loadouts for the export, with the one selected for group combat marked.
 * @param {Array<Object>} saved - Your saved loadouts, from getMetzLoadouts
 * @param {Object} characterObj - Your character data
 * @returns {Array<Object>}
 */
export function withOwnGroupLoadout(saved, characterObj) {
    const selfId = characterObj?.character?.id;
    const selectedId = getPartyLoadoutId(characterObj, selfId);
    const [viewing] = getStoredSharedLoadouts(selfId);
    // A viewing from before you changed your party selection no longer says what is selected
    const current =
        viewing &&
        (selectedId == null || viewing.slotLoadoutId == null || String(viewing.slotLoadoutId) === String(selectedId));
    return markGroupLoadout(saved, current ? getSharedMetzLoadouts(selfId)[0] : null, selectedId);
}

/**
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @returns {boolean} Whether it is your own character's loadout
 */
export function isOwnSharedLoadout(loadout) {
    const selfId = getCharacterData()?.character?.id;
    const sharedId = getSharedLoadoutCharacterId(loadout);
    return selfId != null && sharedId != null && String(selfId) === String(sharedId);
}

/**
 * Forget the loadouts stored for one character.
 * @param {string|number} characterId
 */
export function clearSharedLoadouts(characterId) {
    const store = readStore();
    delete store[String(characterId)];
    writeStore(store);
}

/**
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @returns {Promise<Object|null>} The cached shared profile of the character it belongs to
 */
export async function findSharedLoadoutProfile(loadout) {
    const characterId = getSharedLoadoutCharacterId(loadout);
    const name = loadout?.sharableCharacter?.name;
    const profileList = await getProfileList();
    return (
        profileList.find(
            (entry) =>
                (characterId != null && String(entry.characterID) === String(characterId)) ||
                (characterId == null && name && entry.characterName === name)
        ) || null
    );
}

/**
 * Store a viewed loadout under its character, with the loadout id their party slot names right now. A
 * teammate needs a cached profile, since the export has nothing to take their levels from otherwise; your
 * own character does not.
 * @param {Object} loadout - The `loadout` object of a loadout_shared message
 * @returns {Promise<{saved: boolean, reason: string|null}>} reason is 'noProfile' without a cached profile,
 *     'noData' when there is no game data or the loadout holds nothing usable, 'noStorage' when it could not be
 *     written
 */
export async function saveSharedLoadoutForMetz(loadout) {
    const clientObj = getClientData();
    if (!loadout || !clientObj) return { saved: false, reason: 'noData' };

    const characterObj = getCharacterData();
    const self = characterObj?.character;
    const profile = isOwnSharedLoadout(loadout)
        ? { characterID: self.id, characterName: self.name }
        : await findSharedLoadoutProfile(loadout);
    if (!profile) return { saved: false, reason: 'noProfile' };

    const entry = buildSharedMetzLoadout(loadout, clientObj);
    if (!entry) return { saved: false, reason: 'noData' };
    // A different id on their slot later means they changed their selection since this viewing
    entry.slotLoadoutId = getPartyLoadoutId(characterObj, profile.characterID);

    const store = readStore();
    const key = String(profile.characterID);
    const kept = (store[key]?.loadouts || []).filter((existing) => existing.id !== entry.id);
    store[key] = {
        characterName: profile.characterName,
        loadouts: [entry, ...kept].slice(0, MAX_LOADOUTS_PER_CHARACTER),
    };
    return writeStore(store) ? { saved: true, reason: null } : { saved: false, reason: 'noStorage' };
}

function summarize(loadout, clientObj) {
    const itemName = (hrid) => clientObj?.itemDetailMap?.[hrid]?.name || hrid;
    const weapon = findWeapon(loadout.equipment);
    const abilities = (loadout.abilities || []).map(
        (ability) => clientObj?.abilityDetailMap?.[ability.abilityHrid]?.name || ability.abilityHrid
    );
    const consumables = [...(loadout.food || []), ...(loadout.drinks || [])].map((item) => itemName(item.itemHrid));
    return [weapon ? itemName(weapon.itemHrid) : null, abilities.join(', '), consumables.join(', ')]
        .filter(Boolean)
        .join(' · ');
}

/**
 * What the next import will contain, for the Metz site's details panel.
 * @returns {Promise<{self: {name: string, loadoutCount: number, groupLoadoutName: string|null}, members:
 *     Array<Object>}|null>} null without character data; each member has {characterID, name, hasProfile,
 *     profileAt, loadouts: [{id, name, viewedAt, summary, isGroup, changed}]}, newest first, the newest being the
 *     group loadout that is exported as their baseline
 */
export async function describeMetzImport() {
    const characterObj = getCharacterData();
    if (!characterObj) return null;

    const clientObj = getClientData();
    const profileList = await getProfileList();
    const selfId = characterObj.character?.id;

    const members = [];
    for (const member of Object.values(characterObj.partyInfo?.partySlotMap || {})) {
        if (!member.characterID || member.characterID === selfId) continue;
        const profile = profileList.find((entry) => entry.characterID === member.characterID);
        members.push({
            characterID: member.characterID,
            name: profile?.characterName || member.characterName || null,
            hasProfile: !!profile,
            profileAt: profile?.timestamp || null,
            loadouts: getStoredSharedLoadouts(member.characterID).map((loadout, index) => ({
                id: loadout.id,
                name: loadout.name,
                viewedAt: loadout.viewedAt,
                summary: summarize(loadout, clientObj),
                isGroup: index === 0,
                // Their slot names another loadout than at the viewing. No claim when either id is unknown.
                changed:
                    index === 0 &&
                    loadout.slotLoadoutId != null &&
                    !!member.characterLoadoutID &&
                    String(member.characterLoadoutID) !== String(loadout.slotLoadoutId),
            })),
        });
    }

    const ownLoadouts = withOwnGroupLoadout(getMetzLoadouts(selfId), characterObj);
    return {
        self: {
            name: characterObj.character?.name || '',
            loadoutCount: getMetzLoadouts(selfId).length,
            groupLoadoutName: ownLoadouts.find((loadout) => loadout.groupCombat)?.name || null,
        },
        members,
    };
}
