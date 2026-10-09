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
 *
 * It also accepts two optional richer blocks, read from Metz's own import parser
 * (server/zoneImport.mjs in metzlii/metz-combat-simulator): `skilling` (enhancing/alchemy level
 * + tool + speed gear, used by the Optimize tab's enhancement-cost math) and `owned` (spare
 * gear/abilities not currently equipped, used by the optimizer for alternate-loadout what-ifs).
 * Both are populated for the self character where the data is available (full inventory,
 * skills, ability catalog) and best-effort for party members from whatever a shared profile
 * happens to carry (enhancing/alchemy level and tool, skillExperience, speedGear from worn gear
 * only) - `owned` needs a full inventory a shared profile never exposes, so that stays self-only.
 *
 * Also adds `hasMooPass`, `inParty`, and `skillExperience` (total XP per combat skill), none of
 * which Shykai's own format carries.
 *
 * This module runs both in-page (the profile-box "Metz Sim Export" button) and cross-domain on
 * metzlii.github.io itself (the "Import from Toolasha" button on Metz's Setup screen - see
 * combat-sim-integration-metz.js). The live `dataManager` singleton is only ever populated on
 * the game domain, so any self-only read that needs it (inventory, MooPass expiry) must fall
 * back to the cross-domain GM-stored `characterObj` snapshot (same mechanism `getCharacterData()`
 * already uses) - see `getSelfInventoryItems`/`getSelfHasMooPass` below.
 */

import dataManager from '../../core/data-manager.js';
import { normalizeNativeTimestamp } from '../character-activity/native-timestamp.js';
import {
    getCharacterData,
    getClientData,
    getBattleData,
    getProfileList,
    constructSelfPlayer,
    constructPartyPlayer,
} from './combat-sim-export.js';

const ENHANCING_TOOL_LOCATION = '/item_locations/enhancing_tool';
const ALCHEMY_TOOL_LOCATION = '/item_locations/alchemy_tool';
const TOOL_LOCATION_PATTERN = /_tool$/;
const INVENTORY_LOCATION = '/item_locations/inventory';
const SPEED_GEAR_STATS = ['enhancingSpeed', 'skillingSpeed'];
const COMBAT_SKILL_NAMES = new Set(['attack', 'magic', 'ranged', 'stamina', 'intelligence', 'defense', 'melee']);

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
 * Pull every `_tool`-suffixed location out of a Shykai-shape equipment array: the enhancing/
 * alchemy tool moves into `skilling` (used by the Optimize tab's enhancement-cost math), and
 * every other tool (tailoring, foraging, woodcutting, cooking, crafting, milking, brewing,
 * cheesesmithing) is dropped outright - none of them carry combat stats, and none have a home
 * in Metz's player.equipment shape. Previously only enhancing/alchemy were pulled out, on the
 * assumption Metz's own importer already regex-stripped the rest - that assumption was never
 * verified against Metz's actual parser, so this drops them explicitly instead.
 * @param {Array<Object>} equipment
 * @returns {{ equipment: Array<Object>, enhancingTool: Object|null, alchemyTool: Object|null }}
 */
function extractToolsFromEquipment(equipment) {
    const rest = [];
    let enhancingTool = null;
    let alchemyTool = null;

    for (const item of equipment || []) {
        if (item.itemLocationHrid === ENHANCING_TOOL_LOCATION) {
            enhancingTool = { itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 };
        } else if (item.itemLocationHrid === ALCHEMY_TOOL_LOCATION) {
            alchemyTool = { itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 };
        } else if (TOOL_LOCATION_PATTERN.test(item.itemLocationHrid || '')) {
            continue;
        } else {
            rest.push(item);
        }
    }

    return { equipment: rest, enhancingTool, alchemyTool };
}

/**
 * @param {Array<Object>} skills - characterSkills-shaped array (skillHrid + level)
 * @returns {{ enhancingLevel: number|null, alchemyLevel: number|null }}
 */
function extractSkillLevels(skills) {
    let enhancingLevel = null;
    let alchemyLevel = null;

    for (const skill of skills || []) {
        if (skill?.skillHrid === '/skills/enhancing') enhancingLevel = skill.level;
        else if (skill?.skillHrid === '/skills/alchemy') alchemyLevel = skill.level;
    }

    return { enhancingLevel, alchemyLevel };
}

/**
 * Build the `skilling` block plus the equipment array it was pulled out of.
 * @param {Object} params
 * @param {Array<Object>} [params.skills] - characterSkills-shaped array
 * @param {Array<Object>} params.equipment - Shykai-shape player.equipment (may include tools)
 * @param {Array<Object>} [params.speedGear] - Self-only; owned items with enhancing/skilling speed
 * @returns {{ equipment: Array<Object>, skilling: Object|null }}
 */
function buildSkillingBlock({ skills, equipment, speedGear }) {
    const { equipment: strippedEquipment, enhancingTool, alchemyTool } = extractToolsFromEquipment(equipment);
    const { enhancingLevel, alchemyLevel } = extractSkillLevels(skills);
    const hasSkilling =
        enhancingLevel != null || alchemyLevel != null || enhancingTool || alchemyTool || speedGear?.length > 0;

    return {
        equipment: strippedEquipment,
        skilling: hasSkilling
            ? {
                  ...(enhancingLevel != null && { enhancingLevel }),
                  ...(alchemyLevel != null && { alchemyLevel }),
                  enhancingTool,
                  alchemyTool,
                  speedGear: speedGear || [],
              }
            : null,
    };
}

/**
 * @param {Object} equipmentDetail
 * @returns {boolean} True if this item carries an enhancing/alchemy speed stat
 */
function hasSpeedStat(equipmentDetail) {
    const stats = equipmentDetail?.noncombatStats || {};
    return SPEED_GEAR_STATS.some((stat) => (stats[stat] || 0) > 0);
}

/**
 * Scan a list of items (self: worn + full inventory; teammate: worn only) for enhancing/skilling
 * speed items, matching exactly what Metz's own enhancement-cost formula reads
 * (server/enhanceCost.mjs: noncombatStats.enhancingSpeed + noncombatStats.skillingSpeed). One
 * row per distinct item hrid, keeping the highest enhancement level seen - the same item can
 * appear twice (worn + a spare in inventory, or two spares at different levels) for self, but
 * different items (e.g. chance_cape vs chance_cape_refined) are never collapsed together.
 * @param {Array<Object>} items
 * @param {Object} itemDetailMap
 * @returns {Array<Object>}
 */
function buildSpeedGear(items, itemDetailMap) {
    const bestLevelByHrid = new Map();
    for (const item of items || []) {
        const equipmentDetail = itemDetailMap?.[item.itemHrid]?.equipmentDetail;
        if (!equipmentDetail || !hasSpeedStat(equipmentDetail)) continue;
        const enhancementLevel = item.enhancementLevel || 0;
        const bestSoFar = bestLevelByHrid.get(item.itemHrid);
        if (bestSoFar === undefined || enhancementLevel > bestSoFar) {
            bestLevelByHrid.set(item.itemHrid, enhancementLevel);
        }
    }
    return Array.from(bestLevelByHrid, ([itemHrid, enhancementLevel]) => ({ itemHrid, enhancementLevel }));
}

/**
 * Teammate speedGear: worn gear only, via the shared profile's wearableItemMap - unlike self, a
 * shared profile never exposes a teammate's full inventory.
 * @param {Object} wearableItemMap
 * @param {Object} itemDetailMap
 * @returns {Array<Object>}
 */
function buildTeammateSpeedGear(wearableItemMap, itemDetailMap) {
    return buildSpeedGear(Object.values(wearableItemMap || {}), itemDetailMap);
}

/**
 * Self-only: live dataManager inventory when running on the game page, falling back to the
 * cross-domain GM-stored init snapshot (characterObj.characterItems) when running on a
 * third-party sim page (e.g. Metz's own Setup screen), where the live dataManager singleton is
 * never populated. getInventory() returns null specifically when the live cache was never
 * initialized (cross-domain) - a genuinely empty live inventory is `[]`, not null, and must not
 * trigger the fallback.
 * @param {Object} characterObj
 * @returns {Array<Object>}
 */
function getSelfInventoryItems(characterObj) {
    const liveInventory = dataManager.getInventory();
    if (liveInventory !== null) return liveInventory;
    return Array.isArray(characterObj.characterItems)
        ? characterObj.characterItems.filter((item) => item?.count !== 0)
        : [];
}

/**
 * Self-only hasMooPass, sourced from the server-resolved MooPass expiry rather than the live
 * `moo_pass_buffs_updated` buff list (which can legitimately be empty while MooPass is still
 * active). Falls back to the cross-domain GM-stored characterObj snapshot the same way
 * getSelfInventoryItems does, since dataManager.getMooPassExpireTime() is also only populated
 * on the game domain.
 * @param {Object} characterObj
 * @returns {boolean}
 */
function getSelfHasMooPass(characterObj) {
    const rawExpireTime = dataManager.getMooPassExpireTime() ?? characterObj.characterInfo?.mooPassExpireTime;
    const expireTime = normalizeNativeTimestamp(rawExpireTime);
    return expireTime != null && expireTime > Date.now();
}

/**
 * @param {Object} characterObj
 * @param {string} [characterId]
 * @returns {boolean} True if characterId is a member of the character's current party
 */
function isCurrentPartyMember(characterObj, characterId) {
    const partySlots = characterObj.partyInfo?.partySlotMap;
    if (!partySlots || !characterId) return false;
    return Object.values(partySlots).some((member) => member.characterID === characterId);
}

/**
 * Build the `skillExperience` block ({attack, magic, ranged, stamina, intelligence, defense,
 * melee} total XP) from a characterSkills-shaped array. The `experience` field is present on
 * both self (characterObj.characterSkills) and a teammate's shared profile
 * (profile.profile.characterSkills), so this works for either source unchanged.
 * @param {Array<Object>} [skills]
 * @returns {Object|null} null if no combat skill carried an experience value
 */
function buildSkillExperience(skills) {
    const experience = {};
    for (const skill of skills || []) {
        const skillName = skill?.skillHrid?.split('/').pop();
        if (skillName && COMBAT_SKILL_NAMES.has(skillName) && typeof skill.experience === 'number') {
            experience[skillName] = skill.experience;
        }
    }
    return Object.keys(experience).length > 0 ? experience : null;
}

/**
 * @param {string} itemHrid
 * @param {Object} itemDetailMap
 * @returns {boolean} True if this is wearable combat gear (not a production tool)
 */
function isCombatWearable(itemHrid, itemDetailMap) {
    const equipmentDetail = itemDetailMap?.[itemHrid]?.equipmentDetail;
    return !!equipmentDetail && !equipmentDetail.type?.endsWith('_tool');
}

/**
 * Self-only: build the `owned` block - spare (uncurrently-worn) combat gear and learned-but-
 * unequipped abilities, for Metz's optimizer to consider as alternate loadout pieces. Matches
 * server/zoneImport.mjs's `ownedOf()`, which drops tool-slotted entries and needs at least one
 * equipment or ability entry to keep the block at all.
 * @param {Object} params
 * @param {Array<Object>} params.inventoryItems - dataManager.getInventory()
 * @param {Object} params.itemDetailMap
 * @param {Array<Object>} params.characterAbilities - Full learned-ability catalog (hrid + level)
 * @param {Set<string>} params.equippedAbilityHrids - The 5 currently-equipped ability hrids
 * @returns {Object|null}
 */
function buildOwnedBlock({ inventoryItems, itemDetailMap, characterAbilities, equippedAbilityHrids }) {
    const equipment = [];
    for (const item of inventoryItems || []) {
        if (item.itemLocationHrid !== INVENTORY_LOCATION) continue; // already in player.equipment/skilling
        if (!isCombatWearable(item.itemHrid, itemDetailMap)) continue;
        equipment.push({
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
            count: item.count || 1,
            equipped: false,
        });
    }

    const abilities = [];
    for (const ability of characterAbilities || []) {
        if (!ability?.abilityHrid || equippedAbilityHrids.has(ability.abilityHrid)) continue;
        abilities.push({ abilityHrid: ability.abilityHrid, level: ability.level || 1, equipped: false });
    }

    if (!equipment.length && !abilities.length) return null;
    return { capturedAt: new Date().toISOString(), equipment, abilities };
}

/**
 * Reshape one Shykai-format player object (from constructSelfPlayer/constructPartyPlayer) into
 * a Metz character entry.
 * @param {string} name
 * @param {Object} shykaiPlayer
 * @param {Object} [extra]
 * @param {boolean} [extra.hasMooPass]
 * @param {boolean} [extra.inParty]
 * @param {Object|null} [extra.skillExperience] - see buildSkillExperience
 * @param {Array<Object>} [extra.skills] - characterSkills-shaped array, for skilling.enhancing/alchemyLevel
 * @param {Array<Object>} [extra.speedGear] - see buildSpeedGear/buildTeammateSpeedGear
 * @param {Object|null} [extra.owned] - Self-only, see buildOwnedBlock
 * @returns {Object}
 */
function toMetzCharacter(name, shykaiPlayer, extra = {}) {
    const { hasMooPass, inParty, skillExperience, skills, speedGear, owned, ...rest } = extra;
    const { equipment, skilling } = buildSkillingBlock({ skills, equipment: shykaiPlayer.player.equipment, speedGear });

    const character = {
        name,
        player: { ...shykaiPlayer.player, equipment },
        abilities: dropBlankSlots(shykaiPlayer.abilities, 'abilityHrid'),
        triggerMap: shykaiPlayer.triggerMap,
        houseRooms: shykaiPlayer.houseRooms,
        guildCombatBuffLevels: shykaiPlayer.guildCombatBuffLevels,
        food: { '/action_types/combat': dropBlankSlots(shykaiPlayer.food['/action_types/combat'], 'itemHrid') },
        drinks: { '/action_types/combat': dropBlankSlots(shykaiPlayer.drinks['/action_types/combat'], 'itemHrid') },
        ...(hasMooPass !== undefined && { hasMooPass }),
        ...(inParty !== undefined && { inParty }),
        ...rest,
    };
    if (skilling) character.skilling = skilling;
    if (owned) character.owned = owned;
    if (skillExperience) character.skillExperience = skillExperience;
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
    const itemDetailMap = clientObj?.itemDetailMap;
    const inventoryItems = getSelfInventoryItems(characterObj);
    const equippedAbilityHrids = new Set(
        (characterObj.combatUnit?.combatAbilities || []).map((ability) => ability.abilityHrid).filter(Boolean)
    );

    return toMetzCharacter(characterObj.character?.name || 'Player 1', selfPlayer, {
        hasMooPass: getSelfHasMooPass(characterObj),
        inParty: isCurrentPartyMember(characterObj, characterObj.character?.id),
        skills: characterObj.characterSkills,
        skillExperience: buildSkillExperience(characterObj.characterSkills),
        speedGear: buildSpeedGear(inventoryItems, itemDetailMap),
        owned: buildOwnedBlock({
            inventoryItems,
            itemDetailMap,
            characterAbilities: characterObj.characterAbilities,
            equippedAbilityHrids,
        }),
    });
}

/**
 * Build the toMetzCharacter `extra` object for a teammate, from their shared profile. Everything
 * here is best-effort evidence a shared profile actually exposes (hasMooPass, characterSkills,
 * worn equipment) - never backfilled from the self character's own values.
 * @param {Object} profile
 * @param {Object} clientObj
 * @param {boolean} inParty
 * @returns {Object}
 */
function buildTeammateExtra(profile, clientObj, inParty) {
    return {
        hasMooPass: profile.profile?.sharableCharacter?.hasMooPass ?? false,
        inParty,
        skills: profile.profile?.characterSkills,
        skillExperience: buildSkillExperience(profile.profile?.characterSkills),
        speedGear: buildTeammateSpeedGear(profile.profile?.wearableItemMap, clientObj?.itemDetailMap),
    };
}

/**
 * Build the array-of-characters export Metz's Setup screen accepts: your own character, plus
 * any party members Toolasha already has a cached profile for (the same profile cache the
 * Shykai export uses). Only your own character carries the `owned` block and inventory-sourced
 * speedGear entries - a teammate's shared profile never exposes full inventory, though it does
 * carry enhancing/alchemy level and tool, worn speedGear, hasMooPass, and skillExperience when
 * present, which still populate best-effort.
 * @param {Object|null} [selfLoadoutOverride] - If given, applied to your own character via
 *   applyLoadoutOverrideToMetzCharacter instead of exporting your live equipped state (used by
 *   the profile-box "Export Full Party" action, which exports a NAMED saved loadout for yourself).
 * @returns {Promise<Array<Object>|null>} null if no character data is available at all
 */
export async function constructMetzTeamExport(selfLoadoutOverride = null) {
    const characterObj = getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = getClientData();
    const battleObj = getBattleData();
    const profileList = await getProfileList();

    let selfCharacter = buildSelfMetzCharacter(characterObj, clientObj);
    if (selfLoadoutOverride) {
        selfCharacter = applyLoadoutOverrideToMetzCharacter(selfCharacter, selfLoadoutOverride);
    }
    const team = [selfCharacter];

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
            // inParty is always true here - this loop only reaches members already pulled out of
            // the live partySlotMap, by construction.
            team.push(
                toMetzCharacter(profile.characterName, partyPlayer, buildTeammateExtra(profile, clientObj, true))
            );
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
        const inParty = isCurrentPartyMember(characterObj, externalProfileId);
        return toMetzCharacter(profile.characterName, partyPlayer, buildTeammateExtra(profile, clientObj, inParty));
    }

    return buildSelfMetzCharacter(characterObj, clientObj);
}

/**
 * Apply a saved-loadout override (equipment/abilities/food/drinks/triggers) onto an existing
 * Metz character object, reshaping into Metz's un-padded slot format. Used by the profile-box
 * "Metz Sim Export" loadout dropdown, which exports a NAMED saved loadout instead of the
 * character's live equipped state.
 *
 * Combat loadouts never include tool slots (enhancing/alchemy tools aren't part of a combat
 * loadout), so unlike toMetzCharacter's live equipment there's nothing to re-derive
 * skilling.enhancingTool/alchemyTool from here - character.skilling already reflects whatever
 * tools are currently equipped (from buildSelfMetzCharacter) and is left untouched, rather than
 * overwritten with null from an equipment array that was never going to carry tools.
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
    // Defensive only - strip any stray tool entry rather than assume a loadout can't have one.
    const { equipment: strippedEquipment } = extractToolsFromEquipment((equipment || []).map((item) => ({ ...item })));

    return {
        ...character,
        player: { ...character.player, equipment: strippedEquipment },
        abilities: dropBlankSlots(abilities, 'abilityHrid'),
        triggerMap: triggerMap || {},
        food: { '/action_types/combat': dropBlankSlots(food, 'itemHrid') },
        drinks: { '/action_types/combat': dropBlankSlots(drinks, 'itemHrid') },
    };
}
