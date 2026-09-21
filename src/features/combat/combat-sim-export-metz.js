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
 * happens to carry (enhancing/alchemy level and tool, when present) - speedGear/owned need a
 * full inventory a shared profile never exposes, so those stay self-only.
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

const ENHANCING_TOOL_LOCATION = '/item_locations/enhancing_tool';
const ALCHEMY_TOOL_LOCATION = '/item_locations/alchemy_tool';
const INVENTORY_LOCATION = '/item_locations/inventory';
const SPEED_GEAR_STATS = ['enhancingSpeed', 'skillingSpeed'];

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
 * Pull the enhancing/alchemy tool out of a Shykai-shape equipment array. Metz's own parser
 * already regex-drops any `_tool`-suffixed location from player.equipment, so this just moves
 * those two entries into `skilling` instead of relying on Metz to silently discard them.
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
 * Self-only: scan the full inventory (not just equipped) for items with an enhancing/skilling
 * speed stat, matching exactly what Metz's own enhancement-cost formula reads
 * (server/enhanceCost.mjs: noncombatStats.enhancingSpeed + noncombatStats.skillingSpeed).
 * @param {Array<Object>} inventoryItems - dataManager.getInventory()
 * @param {Object} itemDetailMap
 * @returns {Array<Object>}
 */
function buildSpeedGear(inventoryItems, itemDetailMap) {
    const speedGear = [];
    for (const item of inventoryItems || []) {
        const equipmentDetail = itemDetailMap?.[item.itemHrid]?.equipmentDetail;
        if (equipmentDetail && hasSpeedStat(equipmentDetail)) {
            speedGear.push({ itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 });
        }
    }
    return speedGear;
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
 * @param {boolean} [extra.hasMooPass] - Self-only
 * @param {Array<Object>} [extra.skills] - characterSkills-shaped array, for skilling.enhancing/alchemyLevel
 * @param {Array<Object>} [extra.speedGear] - Self-only, see buildSpeedGear
 * @param {Object|null} [extra.owned] - Self-only, see buildOwnedBlock
 * @returns {Object}
 */
function toMetzCharacter(name, shykaiPlayer, extra = {}) {
    const { hasMooPass, skills, speedGear, owned, ...rest } = extra;
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
        ...rest,
    };
    if (skilling) character.skilling = skilling;
    if (owned) character.owned = owned;
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
    const inventoryItems = dataManager.getInventory() || [];
    const equippedAbilityHrids = new Set(
        (characterObj.combatUnit?.combatAbilities || []).map((ability) => ability.abilityHrid).filter(Boolean)
    );

    return toMetzCharacter(characterObj.character?.name || 'Player 1', selfPlayer, {
        hasMooPass: (dataManager.getMooPassBuffs()?.length ?? 0) > 0,
        skills: characterObj.characterSkills,
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
 * Build the array-of-characters export Metz's Setup screen accepts: your own character, plus
 * any party members Toolasha already has a cached profile for (the same profile cache the
 * Shykai export uses). Only your own character carries hasMooPass and the owned/speedGear parts
 * of skilling - a teammate's shared profile never exposes full inventory, though it does carry
 * enhancing/alchemy level and tool when present, which still populate skilling best-effort.
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
            team.push(
                toMetzCharacter(profile.characterName, partyPlayer, { skills: profile.profile?.characterSkills })
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
        return toMetzCharacter(profile.characterName, partyPlayer, { skills: profile.profile?.characterSkills });
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
    const {
        equipment: strippedEquipment,
        enhancingTool,
        alchemyTool,
    } = extractToolsFromEquipment((equipment || []).map((item) => ({ ...item })));
    const existingSkilling = character.skilling || {};
    const skilling = { ...existingSkilling, enhancingTool, alchemyTool };
    const hasSkilling =
        skilling.enhancingLevel != null ||
        skilling.alchemyLevel != null ||
        enhancingTool ||
        alchemyTool ||
        skilling.speedGear?.length > 0;

    return {
        ...character,
        player: { ...character.player, equipment: strippedEquipment },
        abilities: dropBlankSlots(abilities, 'abilityHrid'),
        triggerMap: triggerMap || {},
        food: { '/action_types/combat': dropBlankSlots(food, 'itemHrid') },
        drinks: { '/action_types/combat': dropBlankSlots(drinks, 'itemHrid') },
        ...(hasSkilling ? { skilling } : {}),
    };
}
