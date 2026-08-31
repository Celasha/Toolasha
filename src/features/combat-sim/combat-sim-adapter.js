/**
 * Combat Simulator Adapter
 * Bridges Toolasha's live data to the combat sim engine.
 *
 * Extracts game data maps, builds player DTOs, and provides
 * combat zone metadata for the simulation UI.
 */

import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import loadoutState from '../../core/loadout-state.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculatePriceAfterTax } from '../../utils/profit-helpers.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import { calculateRawCombatLevel } from '../../utils/combat-level-progress-calculator.js';

/**
 * The five current combat-relevant guild Shrines (CSIM-AUD-021, UI-002). Effect construction is
 * fully data-driven (see engine/shrine.js) - this list only identifies which shrine hrids the
 * Sim Editor and DTO builders should carry, never their formulas.
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

/**
 * Extract all required game data maps from initClientData for the sim engine.
 * @returns {Object|null} Plain object with all 15 game data maps, or null if data unavailable
 */
export function buildGameDataPayload() {
    const clientData = dataManager.getInitClientData();
    if (!clientData) {
        console.error('[CombatSimAdapter] No initClientData available');
        return null;
    }

    return {
        itemDetailMap: clientData.itemDetailMap,
        actionDetailMap: clientData.actionDetailMap,
        abilityDetailMap: clientData.abilityDetailMap,
        combatMonsterDetailMap: clientData.combatMonsterDetailMap,
        combatStyleDetailMap: clientData.combatStyleDetailMap,
        damageTypeDetailMap: clientData.damageTypeDetailMap,
        houseRoomDetailMap: clientData.houseRoomDetailMap,
        combatTriggerDependencyDetailMap: clientData.combatTriggerDependencyDetailMap,
        combatTriggerConditionDetailMap: clientData.combatTriggerConditionDetailMap,
        combatTriggerComparatorDetailMap: clientData.combatTriggerComparatorDetailMap,
        enhancementLevelTotalBonusMultiplierTable: clientData.enhancementLevelTotalBonusMultiplierTable,
        abilitySlotsLevelRequirementList: clientData.abilitySlotsLevelRequirementList,
        openableLootDropMap: clientData.openableLootDropMap,
        labyrinthCrateDetailMap: clientData.labyrinthCrateDetailMap,
        guildBuffDetailMap: clientData.guildBuffDetailMap,
        guildShrineDetailMap: clientData.guildShrineDetailMap,
    };
}

/**
 * Resolve the current character's active Monster-task target hrids (CSIM-AUD-023). The sim runs
 * in a Web Worker with no access to the main-thread DataManager singleton, so eligibility must be
 * resolved here and threaded through the player DTO as plain data.
 * @returns {Array<string>} Monster hrids the current character has an active Monster task for
 */
function resolveTaskEligibleMonsterHrids() {
    const quests = dataManager.characterQuests || [];
    return quests
        .filter(
            (quest) =>
                quest.category === '/quest_category/random_task' &&
                quest.type === '/quest_type/monster' &&
                quest.status === '/quest_status/in_progress' &&
                quest.monsterHrid
        )
        .map((quest) => quest.monsterHrid);
}

/**
 * Model the current character's active personal/scroll combat buffs for their real remaining
 * lifetime rather than as an eternal permanent buff (CSIM-AUD-019). `personalActionTypeBuffsMap`
 * is the already-aggregated buff total for the combat action type; `characterBuffs[].expiresAt`
 * is the only per-instance timing evidence available, so the combined aggregate is modeled as
 * expiring at the EARLIEST active personal buff's expiry - a conservative simplification that
 * never overstates the buff's simulated benefit. If no expiry evidence exists at all (e.g. stale
 * cache), the aggregate is kept permanent rather than inventing an expiry from no evidence.
 * Automatic scroll purchase/renewal is explicitly out of scope.
 * @returns {{buffs: Array<Object>, remainingDurationNs: number|null}}
 */
function getSelfPersonalCombatBuffContext() {
    const buffs = dataManager.personalActionTypeBuffsMap?.['/action_types/combat'] || [];
    if (buffs.length === 0) {
        return { buffs: [], remainingDurationNs: null };
    }

    const characterBuffs = dataManager.characterData?.characterBuffs || [];
    const now = Date.now();
    const remainingMs = characterBuffs
        .map((buff) => buff?.expiresAt)
        .map((expiresAt) => new Date(expiresAt).getTime() - now)
        .filter((ms) => Number.isFinite(ms) && ms > 0);

    if (remainingMs.length === 0) {
        return { buffs, remainingDurationNs: null };
    }

    return { buffs, remainingDurationNs: Math.min(...remainingMs) * 1e6 };
}

/**
 * Build a player DTO from the current character data.
 * Outputs the format expected by Player.createFromDTO():
 *   { staminaLevel, ..., equipment: { '/equipment_types/head': {hrid, enhancementLevel}, ... },
 *     food: [{hrid, triggers}], drinks: [{hrid, triggers}],
 *     abilities: [{hrid, level, triggers}], houseRooms: {'/house_rooms/x': level},
 *     hrid: 'player1', debuffOnLevelGap: 0 }
 * @returns {Object|null} Player DTO in sim engine format, or null if data unavailable
 */
export function buildPlayerDTO() {
    const characterData = dataManager.characterData;
    const clientData = dataManager.getInitClientData();

    if (!characterData) {
        console.error('[CombatSimAdapter] No character data available');
        return null;
    }

    const dto = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        woodcuttingLevel: 1,
        foragingLevel: 1,
        milkingLevel: 1,
        cookingLevel: 1,
        brewingLevel: 1,
        cheesesmithingLevel: 1,
        craftingLevel: 1,
        tailoringLevel: 1,
        alchemyLevel: 1,
        enhancingLevel: 1,
        hrid: 'player1',
        debuffOnLevelGap: 0,
        equipment: {},
        food: [],
        drinks: [],
        abilities: [],
        houseRooms: {},
        tokenUpgrades: { speed: 0, efficiency: 0, success: 0, doubleProgress: 0 },
        communityBuffLevels: { productionEfficiency: 0, enhancingSpeed: 0, gatheringQuantity: 0, experience: 0 },
        shrineLevels: {},
        hasMooPass: false,
        characterAchievements: [],
        personalCombatBuffs: { buffs: [], remainingDurationNs: null },
        taskEligibleMonsterHrids: [],
    };

    // Extract all skill levels (combat + skilling)
    for (const skill of characterData.characterSkills || []) {
        const skillName = skill.skillHrid.split('/').pop();
        const key = skillName + 'Level';
        if (dto[key] !== undefined) {
            dto[key] = skill.level;
        }
    }

    // Extract labyrinth token upgrades
    const info = characterData.characterInfo;
    if (info) {
        dto.tokenUpgrades = {
            speed: Math.max(0, Math.floor(Number(info.labyrinthSkillActionSpeedLevel) || 0)),
            efficiency: Math.max(0, Math.floor(Number(info.labyrinthSkillingEfficiencyLevel) || 0)),
            success: Math.max(0, Math.floor(Number(info.labyrinthSkillingSuccessLevel) || 0)),
            doubleProgress: Math.max(0, Math.floor(Number(info.labyrinthSkillingDoubleProgressLevel) || 0)),
        };
    }

    // Extract community buff levels
    dto.communityBuffLevels = {
        productionEfficiency: dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency') || 0,
        enhancingSpeed: dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed') || 0,
        gatheringQuantity: dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity') || 0,
        experience: dataManager.getCommunityBuffLevel('/community_buff_types/experience') || 0,
    };

    // Extract self Shrine levels from live guild state. Effective shrine buffs are constructed
    // generically by the engine's Shrine class from these editable levels - never from the frozen
    // guildActionTypeBuffsMap snapshot, so the Sim Editor's Shrine section is the single canonical
    // source and cannot double-apply against a second baked-in path. Uses the character's
    // purchased/active guild-buff level (getCharacterGuildBuffLevel, from guild_buffs_updated),
    // clamped to the shrine building's unlocked cap (getGuildBuildingLevel, from guild_updated) -
    // a purchased level can never legitimately exceed the shrine's current cap for the guild
    // you're actually in, so if the two ever briefly disagree (e.g. a guild switch mid-session,
    // where the two live messages can land a moment apart), never simulate the higher figure.
    const guildBuffDetailMap = clientData.guildBuffDetailMap || {};
    for (const shrineHrid of COMBAT_SHRINE_HRIDS) {
        const combatBuffHrid = getCombatGuildBuffHridForShrine(shrineHrid, guildBuffDetailMap);
        if (!combatBuffHrid) continue;
        const purchasedLevel = dataManager.getCharacterGuildBuffLevel(combatBuffHrid);
        const unlockedCap = dataManager.getGuildBuildingLevel(shrineHrid);
        const level = Math.min(purchasedLevel, unlockedCap);
        if (level > 0) {
            dto.shrineLevels[shrineHrid] = level;
        }
    }

    dto.hasMooPass = (dataManager.getMooPassBuffs()?.length ?? 0) > 0;
    dto.characterAchievements = characterData.characterAchievements || [];
    dto.personalCombatBuffs = getSelfPersonalCombatBuffContext();
    dto.taskEligibleMonsterHrids = resolveTaskEligibleMonsterHrids();

    // Extract equipped items → keyed by equipment type
    // Prefer the always-current characterEquipment Map (updated on every items_updated WS message)
    // over characterItems array which can lose enhancementLevel when items are swapped mid-session.
    const itemDetailMap = clientData?.itemDetailMap || {};
    const equipmentMap = dataManager.characterEquipment;

    if (equipmentMap && equipmentMap.size > 0) {
        for (const [, item] of equipmentMap) {
            const itemDetail = itemDetailMap[item.itemHrid];
            if (!itemDetail?.equipmentDetail?.type) continue;
            dto.equipment[itemDetail.equipmentDetail.type] = {
                hrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            };
        }
    } else if (Array.isArray(characterData.characterItems)) {
        // Fallback: array format (Map not yet populated)
        for (const item of characterData.characterItems) {
            if (!item.itemLocationHrid || item.itemLocationHrid.includes('/item_locations/inventory')) continue;
            const itemDetail = itemDetailMap[item.itemHrid];
            if (!itemDetail?.equipmentDetail?.type) continue;
            dto.equipment[itemDetail.equipmentDetail.type] = {
                hrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            };
        }
    } else if (characterData.characterEquipment) {
        for (const key in characterData.characterEquipment) {
            const item = characterData.characterEquipment[key];
            const itemDetail = itemDetailMap[item.itemHrid];
            if (!itemDetail?.equipmentDetail?.type) continue;
            dto.equipment[itemDetail.equipmentDetail.type] = {
                hrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            };
        }
    }

    // Build trigger map (ability + consumable triggers combined)
    const triggerMap = {
        ...(characterData.abilityCombatTriggersMap || {}),
        ...(characterData.consumableCombatTriggersMap || {}),
    };

    /**
     * Convert raw trigger data to DTOs for Trigger.createFromDTO.
     * @param {string} hrid - Ability or consumable HRID
     * @returns {Array<Object>} Trigger DTOs
     */
    const buildTriggerDTOs = (hrid) => {
        const rawTriggers = triggerMap[hrid];
        if (!Array.isArray(rawTriggers)) return null;

        return rawTriggers.map((t) => ({
            dependencyHrid: t.dependencyHrid,
            conditionHrid: t.conditionHrid,
            comparatorHrid: t.comparatorHrid,
            value: t.value || 0,
        }));
    };

    // Extract food slots → array of { hrid, triggers }
    const foodSlots = characterData.actionTypeFoodSlotsMap?.['/action_types/combat'] || [];
    for (let i = 0; i < 3; i++) {
        const item = foodSlots[i];
        if (item?.itemHrid) {
            dto.food.push({ hrid: item.itemHrid, triggers: buildTriggerDTOs(item.itemHrid) });
        } else {
            dto.food.push(null);
        }
    }

    // Extract drink slots → array of { hrid, triggers }
    const drinkSlots = characterData.actionTypeDrinkSlotsMap?.['/action_types/combat'] || [];
    for (let i = 0; i < 3; i++) {
        const item = drinkSlots[i];
        if (item?.itemHrid) {
            dto.drinks.push({ hrid: item.itemHrid, triggers: buildTriggerDTOs(item.itemHrid) });
        } else {
            dto.drinks.push(null);
        }
    }

    // Extract equipped abilities → array of { hrid, level, triggers, experience }
    const equippedAbilities = characterData.combatUnit?.combatAbilities || [];
    // Live per-ability XP progress (CSIM-AUD-017) - combatUnit.combatAbilities carries level only;
    // characterAbilities is the same source AbilityBookCalculator already uses for live XP.
    const abilityExperienceByHrid = {};
    for (const ability of characterData.characterAbilities || []) {
        if (ability?.abilityHrid) {
            abilityExperienceByHrid[ability.abilityHrid] = ability.experience || 0;
        }
    }
    // Slot 0 = special ability, slots 1-4 = normal abilities
    for (let i = 0; i < 5; i++) {
        dto.abilities.push(null);
    }

    let normalAbilityIndex = 1;
    for (const ability of equippedAbilities) {
        if (!ability?.abilityHrid) continue;

        const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
        const abilityDTO = {
            hrid: ability.abilityHrid,
            level: ability.level || 1,
            triggers: buildTriggerDTOs(ability.abilityHrid),
            experience: abilityExperienceByHrid[ability.abilityHrid] || 0,
        };

        if (isSpecial) {
            dto.abilities[0] = abilityDTO;
        } else if (normalAbilityIndex < 5) {
            dto.abilities[normalAbilityIndex++] = abilityDTO;
        }
    }

    // Extract house room levels
    for (const house of Object.values(characterData.characterHouseRoomMap || {})) {
        dto.houseRooms[house.houseRoomHrid] = house.level;
    }

    return dto;
}

/**
 * Build a player DTO from profile_shared data for the combat sim UI.
 * @param {Object} profileData - Profile data from profile_shared (with .profile and .characterID)
 * @returns {Object|null} Player DTO in sim engine format, or null if unavailable
 */
export function buildPlayerDTOFromProfile(profileData) {
    if (!profileData?.profile) return null;
    const clientData = dataManager.getInitClientData();
    if (!clientData) return null;
    return buildPartyMemberDTO(profileData, clientData, null);
}

/**
 * Parse a Shykai-format export string into player DTOs.
 * Accepts the multi-slot format: {"1": "{...}", "2": "{...}", ...}
 * Each slot is a stringified player object with player/food/drinks/abilities/triggerMap/houseRooms.
 * @param {string} jsonString - The pasted export string
 * @returns {{ players: Array<Object>, names: Array<string> }|null} Parsed DTOs, or null on error
 */
export function parseShykaiImport(jsonString) {
    const clientData = dataManager.getInitClientData();
    if (!clientData) return null;
    const itemDetailMap = clientData.itemDetailMap || {};

    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch {
        return null;
    }

    // Detect format:
    // - Multi-slot: {"1": "{...}", "2": "{...}", ...}
    // - Single-player: {"player": {...}, "food": {...}, ...}
    let slotEntries;

    if (typeof parsed === 'object' && parsed['1']) {
        // Multi-slot format
        slotEntries = [];
        for (let i = 1; i <= 5; i++) {
            const slotStr = parsed[String(i)];
            if (!slotStr) continue;
            try {
                const slotData = typeof slotStr === 'string' ? JSON.parse(slotStr) : slotStr;
                slotEntries.push({ slot: i, data: slotData });
            } catch {
                // Skip unparseable slots
            }
        }
    } else if (typeof parsed === 'object' && parsed.player) {
        // Single-player format
        slotEntries = [{ slot: 1, data: parsed }];
    } else {
        return null;
    }

    const players = [];
    const names = [];

    for (const { slot, data: slotData } of slotEntries) {
        const p = slotData.player;
        if (!p) continue;

        // Skip blank/empty players (all levels at 1 and no equipment)
        const hasEquipment = Array.isArray(p.equipment) ? p.equipment.some((e) => e.itemHrid) : false;
        const hasLevels = (p.staminaLevel || 1) > 1 || (p.attackLevel || 1) > 1;
        if (!hasEquipment && !hasLevels) continue;

        const dto = {
            staminaLevel: p.staminaLevel || 1,
            intelligenceLevel: p.intelligenceLevel || 1,
            attackLevel: p.attackLevel || 1,
            meleeLevel: p.meleeLevel || 1,
            defenseLevel: p.defenseLevel || 1,
            rangedLevel: p.rangedLevel || 1,
            magicLevel: p.magicLevel || 1,
            hrid: `player${slot}`,
            debuffOnLevelGap: 0,
            equipment: {},
            food: [],
            drinks: [],
            abilities: [],
            houseRooms: {},
        };

        // Equipment: array format [{itemLocationHrid, itemHrid, enhancementLevel}]
        if (Array.isArray(p.equipment)) {
            for (const eq of p.equipment) {
                if (!eq.itemHrid) continue;
                // Map itemLocationHrid (e.g. /equipment_types/head) to equipment type
                const eqType = eq.itemLocationHrid || itemDetailMap[eq.itemHrid]?.equipmentDetail?.type;
                if (eqType) {
                    dto.equipment[eqType] = {
                        hrid: eq.itemHrid,
                        enhancementLevel: eq.enhancementLevel || 0,
                    };
                }
            }
        }

        // Trigger map helper
        const triggerMap = slotData.triggerMap || {};
        const buildTriggers = (hrid) => {
            const raw = triggerMap[hrid];
            if (!Array.isArray(raw)) return null;
            return raw.map((t) => ({
                dependencyHrid: t.dependencyHrid,
                conditionHrid: t.conditionHrid,
                comparatorHrid: t.comparatorHrid,
                value: t.value || 0,
            }));
        };

        // Food
        const foodSlots = slotData.food?.['/action_types/combat'] || [];
        for (const slot of foodSlots) {
            if (slot.itemHrid) {
                dto.food.push({ hrid: slot.itemHrid, triggers: buildTriggers(slot.itemHrid) });
            } else {
                dto.food.push(null);
            }
        }

        // Drinks
        const drinkSlots = slotData.drinks?.['/action_types/combat'] || [];
        for (const slot of drinkSlots) {
            if (slot.itemHrid) {
                dto.drinks.push({ hrid: slot.itemHrid, triggers: buildTriggers(slot.itemHrid) });
            } else {
                dto.drinks.push(null);
            }
        }

        // Abilities
        const abilitySlots = slotData.abilities || [];
        for (const slot of abilitySlots) {
            if (slot.abilityHrid) {
                dto.abilities.push({
                    hrid: slot.abilityHrid,
                    level: slot.level || 1,
                    triggers: buildTriggers(slot.abilityHrid),
                });
            } else {
                dto.abilities.push(null);
            }
        }

        // House rooms
        if (slotData.houseRooms) {
            dto.houseRooms = { ...slotData.houseRooms };
        }

        players.push(dto);
        names.push(slotData.name || p.name || `Player ${slot}`);
    }

    if (!players.length) return null;

    return { players, names };
}

/**
 * Build a player DTO from a cached party member profile.
 * @param {Object} profile - Profile data with .profile sub-object
 * @param {Object} clientData - initClientData
 * @param {Object} battleData - Battle data (optional, for consumable detection)
 * @returns {Object} Player DTO in engine format
 */
function buildPartyMemberDTO(profile, clientData, battleData) {
    const itemDetailMap = clientData?.itemDetailMap || {};

    const dto = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        hrid: 'player',
        debuffOnLevelGap: 0,
        equipment: {},
        food: [],
        drinks: [],
        abilities: [],
        houseRooms: {},
        shrineLevels: {},
        hasMooPass: false,
        characterAchievements: [],
        personalCombatBuffs: { buffs: [], remainingDurationNs: null },
        taskEligibleMonsterHrids: [],
    };

    // Extract skill levels
    for (const skill of profile.profile?.characterSkills || []) {
        const skillName = skill.skillHrid?.split('/').pop();
        const key = skillName + 'Level';
        if (dto[key] !== undefined) {
            dto[key] = skill.level || 1;
        }
    }

    // Extract teammate context evidence already present in a shared-profile payload. This is
    // genuinely per-player evidence and must never fall back to the current/self player's values -
    // absent/malformed evidence stays neutral (shrineLevels empty, hasMooPass false,
    // characterAchievements empty) rather than being fabricated. Personal/scroll combat-buff
    // lifetime evidence is not exposed in a shared-profile payload, so it stays explicitly unknown.
    // A shared profile's guildBuffLevelMap is keyed by guild-buff hrid (e.g.
    // "/guild_buffs/force_combat"), never by shrine hrid, so it must be resolved the same way as
    // the self path above before indexing into it.
    const partyGuildBuffDetailMap = clientData?.guildBuffDetailMap || {};
    for (const shrineHrid of COMBAT_SHRINE_HRIDS) {
        const combatBuffHrid = getCombatGuildBuffHridForShrine(shrineHrid, partyGuildBuffDetailMap);
        if (!combatBuffHrid) continue;
        const level = profile.profile?.guildBuffLevelMap?.[combatBuffHrid];
        if (Number.isFinite(level) && level > 0) {
            dto.shrineLevels[shrineHrid] = level;
        }
    }
    dto.hasMooPass = profile.profile?.sharableCharacter?.hasMooPass ?? false;
    dto.characterAchievements = profile.profile?.characterAchievements || [];

    // Extract equipment from wearableItemMap → keyed by equipmentDetail.type
    if (profile.profile?.wearableItemMap) {
        for (const key in profile.profile.wearableItemMap) {
            const item = profile.profile.wearableItemMap[key];
            const itemDetail = itemDetailMap[item.itemHrid];
            if (!itemDetail?.equipmentDetail?.type) continue;
            dto.equipment[itemDetail.equipmentDetail.type] = {
                hrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            };
        }
    }

    // Try to get consumables from battle data first
    let battlePlayer = null;
    if (battleData?.players) {
        battlePlayer = battleData.players.find((p) => p.character?.id === profile.characterID);
    }
    // Build trigger map — prefer battle data triggers over profile triggers (battle data is fresher)
    const triggerMap = {
        ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
        ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {}),
    };

    const buildTriggerDTOs = (hrid) => {
        const rawTriggers = triggerMap[hrid];
        if (!Array.isArray(rawTriggers)) return null;
        return rawTriggers.map((t) => ({
            dependencyHrid: t.dependencyHrid,
            conditionHrid: t.conditionHrid,
            comparatorHrid: t.comparatorHrid,
            value: t.value || 0,
        }));
    };

    // Consumables: prefer battle data, fall back to trigger map keys
    if (battlePlayer?.combatConsumables) {
        let foodIndex = 0;
        let drinkIndex = 0;
        for (const consumable of battlePlayer.combatConsumables) {
            const hrid = consumable.itemHrid;
            const isDrink =
                hrid.includes('/drinks/') ||
                hrid.includes('coffee') ||
                itemDetailMap[hrid]?.categoryHrid?.includes('drink');
            if (isDrink && drinkIndex < 3) {
                dto.drinks.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                drinkIndex++;
            } else if (!isDrink && foodIndex < 3) {
                dto.food.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                foodIndex++;
            }
        }
    } else {
        // Fall back to trigger map keys for consumable HRIDs
        const consumableHrids = Object.keys(profile.profile?.consumableCombatTriggersMap || {});
        let foodIndex = 0;
        let drinkIndex = 0;
        for (const hrid of consumableHrids) {
            const isDrink =
                hrid.includes('/drinks/') ||
                hrid.includes('coffee') ||
                itemDetailMap[hrid]?.categoryHrid?.includes('drink');
            if (isDrink && drinkIndex < 3) {
                dto.drinks.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                drinkIndex++;
            } else if (!isDrink && foodIndex < 3) {
                dto.food.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                foodIndex++;
            }
        }
    }

    // Pad remaining slots with null
    while (dto.food.length < 3) dto.food.push(null);
    while (dto.drinks.length < 3) dto.drinks.push(null);

    // Extract abilities
    for (let i = 0; i < 5; i++) dto.abilities.push(null);
    let normalAbilityIndex = 1;
    const equippedAbilities = profile.profile?.equippedAbilities || [];
    for (const ability of equippedAbilities) {
        if (!ability?.abilityHrid) continue;
        const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
        const abilityDTO = {
            hrid: ability.abilityHrid,
            level: ability.level || 1,
            triggers: buildTriggerDTOs(ability.abilityHrid),
        };
        if (isSpecial) {
            dto.abilities[0] = abilityDTO;
        } else if (normalAbilityIndex < 5) {
            dto.abilities[normalAbilityIndex++] = abilityDTO;
        }
    }

    // House rooms
    if (profile.profile?.characterHouseRoomMap) {
        for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
            dto.houseRooms[house.houseRoomHrid] = house.level;
        }
    }

    return dto;
}

/**
 * Calculate the level-gap debuff for one party member given their combat level and the party's
 * highest combat level. Shared by Combat Sim (simulated party loadouts) and Combat Stats
 * (real live encounters) so both agree on the exact same eligibility rule.
 *
 * SERVER-CONFIRMED (direct MWI developer evidence): `combatLevel` and `maxCombatLevel` must be
 * the raw (unfloored) whole-skill Combat Level - see `calculateCombatLevelFromLevelFields()` -
 * not the native floored integer the game displays. The 20%-lower and 10-Combat-Level-lower
 * conditions combine into one effective threshold, the comparison is strict, and the penalty is
 * continuous (no 1%-step quantization). Supplied server implementation (Go):
 *   effectiveThreshold := max(1.2, (combatLevel+10)/combatLevel)
 *   if effectiveThreshold*combatLevel < topCombatLevel {
 *       multiplier = max(0.1, 1.0-3.0*(topCombatLevel/combatLevel-effectiveThreshold))
 *   }
 * @param {number} combatLevel - This player's raw (unfloored) combat level
 * @param {number} maxCombatLevel - The party's highest raw (unfloored) combat level
 * @returns {number} Debuff as a negative decimal (0 = no debuff, e.g. -0.3 = -30%)
 */
export function calculateLevelGapDebuff(combatLevel, maxCombatLevel) {
    const effectiveThreshold = Math.max(1.2, (combatLevel + 10) / combatLevel);
    if (!(effectiveThreshold * combatLevel < maxCombatLevel)) {
        return 0;
    }
    const multiplier = Math.max(0.1, 1.0 - 3.0 * (maxCombatLevel / combatLevel - effectiveThreshold));
    return multiplier - 1.0;
}

/**
 * Calculate the raw (unfloored) combat level from any object exposing the game's own
 * combatDetails-shaped whole-skill-level fields (staminaLevel, intelligenceLevel, attackLevel,
 * defenseLevel, meleeLevel, rangedLevel, magicLevel) - the same shape as a simulated player DTO
 * here in Combat Sim, and the same shape the server sends on live `combatDetails` objects.
 *
 * SERVER-CONFIRMED: this raw/unfloored value - not the native floored `combatDetails.combatLevel`
 * integer the game displays - is the actual mechanic input for Level Malus (see
 * `calculateLevelGapDebuff()`). Both Combat Sim (simulated party) and Combat Stats (live
 * encounters, deriving this from the same seven fields on real `combatDetails`) use this one
 * shared helper so they never disagree.
 * @param {{staminaLevel: number, intelligenceLevel: number, attackLevel: number, defenseLevel: number, meleeLevel: number, rangedLevel: number, magicLevel: number}} levelFields
 * @returns {number} Raw (unfloored) combat level
 */
export function calculateCombatLevelFromLevelFields(levelFields) {
    return calculateRawCombatLevel({
        stamina: levelFields.staminaLevel,
        intelligence: levelFields.intelligenceLevel,
        attack: levelFields.attackLevel,
        defense: levelFields.defenseLevel,
        melee: levelFields.meleeLevel,
        ranged: levelFields.rangedLevel,
        magic: levelFields.magicLevel,
    });
}

/**
 * Build player DTOs for all party members (or solo if not in a party).
 * Auto-detects party from characterData and loads cached profiles.
 * @returns {Promise<{players: Array, playerNames: Array<string>, missingMembers: Array<string>}>}
 */
export async function buildAllPlayerDTOs() {
    const characterData = dataManager.characterData;
    const clientData = dataManager.getInitClientData();

    if (!characterData) {
        return { players: [], playerInfo: [], selfHrid: 'player1', missingMembers: [] };
    }

    const hasParty = characterData.partyInfo?.partySlotMap;

    if (!hasParty) {
        // Solo mode
        const selfDTO = buildPlayerDTO();
        if (!selfDTO) return { players: [], playerInfo: [], selfHrid: 'player1', missingMembers: [] };
        return {
            players: [selfDTO],
            playerInfo: [{ hrid: selfDTO.hrid, name: characterData.character?.name || 'Player 1' }],
            selfHrid: selfDTO.hrid,
            missingMembers: [],
        };
    }

    // Party mode — load profile list from IndexedDB
    let profileList = [];
    try {
        profileList = (await storage.getJSON('profile_list', 'combatExport', null)) || [];
    } catch (error) {
        console.error('[CombatSimAdapter] Failed to load profile list:', error);
    }

    // Get battle data for consumable detection
    const battleData = dataManager.battleData || null;

    const players = [];
    const playerNames = [];
    const missingMembers = [];
    let selfHrid = null;
    let slotIndex = 1;

    for (const member of Object.values(characterData.partyInfo.partySlotMap)) {
        if (!member.characterID) continue;

        if (member.characterID === characterData.character.id) {
            // Self
            const selfDTO = buildPlayerDTO();
            if (selfDTO) {
                selfDTO.hrid = 'player' + slotIndex;
                selfHrid = selfDTO.hrid;
                players.push(selfDTO);
                playerNames.push(characterData.character.name || 'Player ' + slotIndex);
            }
        } else {
            // Party member — look up in profile list (IndexedDB, cross-session)
            const profile = profileList.find((p) => p.characterID === member.characterID);

            if (profile) {
                const memberDTO = buildPartyMemberDTO(profile, clientData, battleData);
                memberDTO.hrid = 'player' + slotIndex;
                players.push(memberDTO);
                playerNames.push(profile.characterName || 'Player ' + slotIndex);
            } else {
                missingMembers.push(member.characterName || 'Unknown');
            }
        }
        slotIndex++;
    }

    // Calculate level gap debuff
    if (players.length > 1) {
        const levels = players.map((p) => calculateCombatLevelFromLevelFields(p));
        const maxCombatLevel = Math.max(...levels);

        for (let i = 0; i < players.length; i++) {
            players[i].debuffOnLevelGap = calculateLevelGapDebuff(levels[i], maxCombatLevel);
        }
    }

    // Build playerInfo: hrid → name mapping in player order, for tab rendering
    const playerInfo = players.map((p, i) => ({ hrid: p.hrid, name: playerNames[i] }));

    return { players, playerInfo, selfHrid: selfHrid || players[0]?.hrid || 'player1', missingMembers };
}

/**
 * Get a sorted list of combat zones for the zone dropdown.
 * @returns {Array<{hrid: string, name: string, isDungeon: boolean, maxSpawnCount: number, maxDifficulty: number, sortIndex: number}>} Sorted zone list
 */
export function getCombatZones() {
    const clientData = dataManager.getInitClientData();
    if (!clientData?.actionDetailMap) {
        return [];
    }

    const zones = [];

    for (const [hrid, action] of Object.entries(clientData.actionDetailMap)) {
        if (action.type !== '/action_types/combat') continue;

        zones.push({
            hrid,
            name: action.name,
            isDungeon: action.combatZoneInfo?.isDungeon || false,
            maxSpawnCount: action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount || 1,
            maxDifficulty: action.maxDifficulty || 0,
            sortIndex: action.sortIndex ?? 0,
        });
    }

    // Sort by sortIndex for consistent ordering
    zones.sort((a, b) => a.sortIndex - b.sortIndex);

    return zones;
}

/**
 * Get all labyrinth monsters sorted by name.
 * @returns {Array<{hrid: string, name: string}>}
 */
export function getLabyrinthMonsters() {
    const clientData = dataManager.getInitClientData();
    if (!clientData?.combatMonsterDetailMap) return [];

    return Object.values(clientData.combatMonsterDetailMap)
        .filter((m) => m.isLabyrinthMonster === true)
        .map((m) => ({ hrid: m.hrid, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get labyrinth crate options grouped by category.
 * @returns {{coffee: Array, food: Array, tea: Array}}
 */
export function getLabyrinthCrates() {
    return {
        coffee: [
            { hrid: '/items/basic_coffee_crate', name: 'Basic Coffee' },
            { hrid: '/items/advanced_coffee_crate', name: 'Advanced Coffee' },
            { hrid: '/items/expert_coffee_crate', name: 'Expert Coffee' },
        ],
        food: [
            { hrid: '/items/basic_food_crate', name: 'Basic Food' },
            { hrid: '/items/advanced_food_crate', name: 'Advanced Food' },
            { hrid: '/items/expert_food_crate', name: 'Expert Food' },
        ],
        tea: [
            { hrid: '/items/basic_tea_crate', name: 'Basic Tea' },
            { hrid: '/items/advanced_tea_crate', name: 'Advanced Tea' },
            { hrid: '/items/expert_tea_crate', name: 'Expert Tea' },
        ],
    };
}

/**
 * Get the player's current combat zone and difficulty tier from characterActions.
 * @returns {{zoneHrid: string, difficultyTier: number, isDungeon: boolean}|null} Current zone info or null
 */
export function getCurrentCombatZone() {
    const characterData = dataManager.characterData;
    const clientData = dataManager.getInitClientData();

    if (!characterData?.characterActions) {
        return null;
    }

    for (const action of characterData.characterActions) {
        if (action && action.actionHrid?.includes('/actions/combat/')) {
            const isDungeon = clientData?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
            return {
                zoneHrid: action.actionHrid,
                difficultyTier: action.difficultyTier || 0,
                isDungeon,
            };
        }
    }

    return null;
}

/**
 * Extract community buff levels from characterData for the simulation.
 * @returns {{comExp: number, comDrop: number}} Community buff levels (0 if not active)
 */
export function getCommunityBuffs() {
    const mooPassBuffs = dataManager.getMooPassBuffs();
    return {
        mooPass: mooPassBuffs && mooPassBuffs.length > 0,
        comExp: dataManager.getCommunityBuffLevel('/community_buff_types/experience') || 0,
        comDrop: dataManager.getCommunityBuffLevel('/community_buff_types/combat_drop_quantity') || 0,
    };
}

/**
 * Place saved loadout abilities into their native MWI slots (1..5 -> array 0..4).
 * Native slot identity is authoritative and intentional holes must survive every export path.
 * Legacy/invalid slot data falls back by special-vs-normal classification without compacting
 * any valid native slot.
 * @param {Array<Object>} abilities
 * @param {Object} abilityDetailMap
 * @param {(ability: Object) => any} mapAbility
 * @returns {Array<any|null>}
 */
export function mapLoadoutAbilitiesToNativeSlots(abilities, abilityDetailMap, mapAbility) {
    const result = [null, null, null, null, null];
    let fallbackNormalAbilityIndex = 1;

    for (const ability of abilities || []) {
        if (!ability?.abilityHrid) continue;
        const mappedAbility = mapAbility(ability);
        if (mappedAbility === null || mappedAbility === undefined) continue;

        const nativeSlot = Number.parseInt(ability.slot, 10);
        const nativeIndex = nativeSlot >= 1 && nativeSlot <= 5 ? nativeSlot - 1 : null;
        if (nativeIndex !== null) {
            result[nativeIndex] = mappedAbility;
            continue;
        }

        const isSpecial = abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
        if (isSpecial) {
            // Invalid legacy slot metadata must not overwrite a valid native slot 1 that was
            // already reconstructed above. Fill the special slot only when it is genuinely free.
            if (result[0] === null) result[0] = mappedAbility;
            continue;
        }

        while (fallbackNormalAbilityIndex < 5 && result[fallbackNormalAbilityIndex]) {
            fallbackNormalAbilityIndex += 1;
        }
        if (fallbackNormalAbilityIndex < 5) {
            result[fallbackNormalAbilityIndex++] = mappedAbility;
        }
    }

    return result;
}

/**
 * Apply a named canonical saved loadout to a player DTO (mutates dto in place on success).
 * @param {Object} dto - Player DTO to mutate
 * @param {string} snapshotName - Loadout snapshot name
 * @param {Object} gameData - Game data payload from buildGameDataPayload()
 * @returns {boolean} True only when the complete usable snapshot was applied
 */
export function applyLoadoutSnapshotToDTO(dto, snapshotName, gameData) {
    const snapshot = loadoutState.getUsableSnapshotByName(snapshotName);
    if (!snapshot) return false;

    const itemDetailMap = gameData.itemDetailMap || {};
    const abilityDetailMap = gameData.abilityDetailMap || {};

    // Convert canonical resolved equipment: snapshot uses itemHrid, DTO keys by equipmentDetail.type.
    // Exact/highest enhancement semantics are owned exclusively by Core Loadout State.
    const characterData = dataManager.characterData;
    const newEquipment = {};
    for (const equip of snapshot.equipment || []) {
        const itemDetail = itemDetailMap[equip.itemHrid];
        const equipType = itemDetail?.equipmentDetail?.type;
        // Manual loadout application is all-or-nothing. Missing item metadata is just as
        // unsafe as an unresolved enhancement: silently omitting that slot would simulate a
        // different loadout while reporting success.
        if (!equipType || !Number.isFinite(equip.enhancementLevel)) return false;
        newEquipment[equipType] = {
            hrid: equip.itemHrid,
            enhancementLevel: equip.enhancementLevel,
        };
    }
    dto.equipment = newEquipment;

    // Ability levels come from current character (not the snapshot)
    // Use characterAbilities (all learned) not combatUnit.combatAbilities (equipped only)
    const currentAbilityLevels = {};
    for (const ability of characterData?.characterAbilities || []) {
        if (ability?.abilityHrid) {
            currentAbilityLevels[ability.abilityHrid] = ability.level || 1;
        }
    }

    const triggerMap = {
        ...(snapshot.abilityCombatTriggersMap || {}),
        ...(snapshot.consumableCombatTriggersMap || {}),
    };

    const buildTriggers = (hrid) => {
        const rawTriggers = triggerMap[hrid];
        if (!Array.isArray(rawTriggers)) return null;
        return rawTriggers.map((t) => ({
            dependencyHrid: t.dependencyHrid,
            conditionHrid: t.conditionHrid,
            comparatorHrid: t.comparatorHrid,
            value: t.value || 0,
        }));
    };

    // MWI saved loadout ability slots are 1..5 and Combat Sim uses the same ordering zero-based.
    // Preserve native holes instead of compacting saved abilities upward in the editor/DTO.
    dto.abilities = mapLoadoutAbilitiesToNativeSlots(snapshot.abilities, abilityDetailMap, (ab) => ({
        hrid: ab.abilityHrid,
        level: currentAbilityLevels[ab.abilityHrid] || 1,
        triggers: buildTriggers(ab.abilityHrid),
    }));

    // Convert food (3 slots)
    dto.food = [];
    for (let i = 0; i < 3; i++) {
        const foodItem = snapshot.food?.[i];
        if (foodItem?.itemHrid) {
            dto.food.push({ hrid: foodItem.itemHrid, triggers: buildTriggers(foodItem.itemHrid) });
        } else {
            dto.food.push(null);
        }
    }

    // Convert drinks (3 slots)
    dto.drinks = [];
    for (let i = 0; i < 3; i++) {
        const drinkItem = snapshot.drinks?.[i];
        if (drinkItem?.itemHrid) {
            dto.drinks.push({ hrid: drinkItem.itemHrid, triggers: buildTriggers(drinkItem.itemHrid) });
        } else {
            dto.drinks.push(null);
        }
    }

    return true;
}

/**
 * Compute the canonical time-based OOM percentage for one player (UI-001):
 * `actual time out of mana / simulated time * 100`. Reuses the exact same closed-plus-open-window
 * accounting already proven correct by the existing single-sim "Run Out Ratio" detail row - never
 * the historical count-based insufficient-MP-check ratio.
 * @param {Object} simResult - SimResult from runSimulation()
 * @param {string} playerHrid
 * @returns {number|null} OOM percentage (0-100), or null if there is no data for this player
 */
export function computeOomPercent(simResult, playerHrid) {
    const stat = simResult?.playerRanOutOfManaTime?.[playerHrid];
    if (!stat || !simResult.simulatedTime) return null;

    const openWindow = stat.isOutOfMana ? simResult.simulatedTime - stat.startTimeForOutOfMana : 0;
    const totalOomTime = stat.totalTimeForOutOfMana + openWindow;

    return (totalOomTime / simResult.simulatedTime) * 100;
}

/**
 * Calculate expected drops from simulation results for a specific player.
 * Uses deterministic expected-value math (no RNG rolls).
 * @param {Object} simResult - SimResult from the engine
 * @param {Object} gameData - Game data maps
 * @param {string} [playerHrid='player1'] - Which player's drop multipliers to use
 * @returns {Map<string, number>} itemHrid → expected total drop count
 */
export function calculateExpectedDrops(simResult, gameData, playerHrid = 'player1') {
    const combatMonsterDetailMap = gameData.combatMonsterDetailMap;
    // Fallback end-of-simulation snapshot, used only when kill-time context is unavailable
    // (e.g. a legacy/synthetic SimResult that never called recordMonsterKill/recordDungeonCompletion).
    const dropRateMultiplier = simResult.dropRateMultiplier[playerHrid] || 1;
    const rareFindMultiplier = simResult.rareFindMultiplier?.[playerHrid] || 1;
    const combatDropQuantity = simResult.combatDropQuantity?.[playerHrid] || 0;
    const debuffOnLevelGap = simResult.debuffOnLevelGap?.[playerHrid] || 0;
    const numberOfPlayers = simResult.numberOfPlayers || 1;
    const difficultyTier = simResult.difficultyTier || 0;

    const totalDropMap = new Map();

    if (simResult.isDungeon) {
        // Dungeons: only completion rewards, no per-monster drops
        if (simResult.dungeonsCompleted > 0) {
            const zoneHrid = simResult.zoneName;
            const actionDetailMap = gameData.actionDetailMap || {};
            const actionDetail = actionDetailMap[zoneHrid];
            const rewardDropTable = actionDetail?.combatZoneInfo?.dungeonInfo?.rewardDropTable;

            if (rewardDropTable) {
                // Kill-time-context drop quantity (CSIM-AUD-011): average this player's
                // combatDropQuantity across every completion actually recorded, instead of the
                // single end-of-run snapshot value applied to every completion regardless of when
                // a temporary buff/scroll was active.
                const dungeonContext = simResult.dungeonCompletionDropContext;
                const playerDungeonContext = dungeonContext?.byPlayer?.[playerHrid];
                const avgCombatDropQuantity =
                    playerDungeonContext && dungeonContext.count > 0
                        ? playerDungeonContext.sumCombatDropQuantity / dungeonContext.count
                        : combatDropQuantity;

                const baseChestCount = 5;
                const chestsPerCompletion = (baseChestCount / numberOfPlayers) * (1 + avgCombatDropQuantity);

                for (const drop of rewardDropTable) {
                    const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                    const adjustedRate = Math.min(1.0, Math.max(0, baseRate));
                    if (adjustedRate <= 0) continue;

                    const avgCount = (drop.minCount + drop.maxCount) / 2;
                    let expected;
                    if (adjustedRate >= 1.0) {
                        expected = simResult.dungeonsCompleted * chestsPerCompletion * avgCount;
                    } else {
                        expected = simResult.dungeonsCompleted * adjustedRate * avgCount;
                    }

                    totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                }
            }
        }
    } else {
        // Regular zones: per-monster drops from kill counts
        const monsters = Object.keys(simResult.deaths).filter((hrid) => !hrid.startsWith('player'));

        for (const monsterHrid of monsters) {
            const monsterData = combatMonsterDetailMap[monsterHrid];
            if (!monsterData) continue;

            const killCount = simResult.deaths[monsterHrid];

            // Kill-time-context multipliers (CSIM-AUD-011): average this player's multiplier
            // across every kill actually recorded for this monster, instead of the single
            // end-of-run snapshot applied retroactively to every accumulated kill.
            const killContext = simResult.killDropContext?.[monsterHrid];
            const playerKillContext = killContext?.byPlayer?.[playerHrid];
            const hasKillContext = playerKillContext && killContext.killCount > 0;
            const avgDropRateMultiplier = hasKillContext
                ? playerKillContext.sumDropRateMultiplier / killContext.killCount
                : dropRateMultiplier;
            const avgRareFindMultiplier = hasKillContext
                ? playerKillContext.sumRareFindMultiplier / killContext.killCount
                : rareFindMultiplier;
            const avgCombatDropQuantity = hasKillContext
                ? playerKillContext.sumCombatDropQuantity / killContext.killCount
                : combatDropQuantity;

            // Regular drops
            if (monsterData.dropTable) {
                for (const drop of monsterData.dropTable) {
                    if (drop.minDifficultyTier > difficultyTier) continue;

                    const tierMultiplier = 1.0 + 0.1 * difficultyTier;
                    const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                    const adjustedRate = Math.min(1.0, tierMultiplier * baseRate * avgDropRateMultiplier);
                    if (adjustedRate <= 0) continue;

                    const avgCount = (drop.minCount + drop.maxCount) / 2;
                    const expected =
                        (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + avgCombatDropQuantity)) /
                        numberOfPlayers;

                    totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                }
            }

            // Rare drops
            if (monsterData.rareDropTable) {
                for (const drop of monsterData.rareDropTable) {
                    if (drop.minDifficultyTier > difficultyTier) continue;

                    const adjustedRate = drop.dropRate * avgRareFindMultiplier;
                    const avgCount = (drop.minCount + (drop.maxCount ?? drop.minCount)) / 2;
                    const expected =
                        (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + avgCombatDropQuantity)) /
                        numberOfPlayers;

                    totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                }
            }
        }
    }

    return totalDropMap;
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

/**
 * Calculate dungeon key costs from a drop map.
 * Entry keys (1:1 with regular chests) + chest keys (1:1 with all chests).
 * @param {Map<string, number>} dropMap - itemHrid → expected count from calculateExpectedDrops
 * @param {Function} getBuyPrice - Function to get buy price for an item (from UI)
 * @returns {Array<{itemHrid: string, name: string, count: number, unitCost: number, totalCost: number}>}
 */
export function calculateDungeonKeyCosts(dropMap, getBuyPrice) {
    const costs = [];
    if (!dropMap) return costs;

    const keyCounts = {};

    // Entry keys: 1 per regular chest
    for (const [chestHrid, count] of dropMap.entries()) {
        const entryKeyHrid = DUNGEON_ENTRY_KEYS[chestHrid];
        if (entryKeyHrid && count > 0) {
            keyCounts[entryKeyHrid] = (keyCounts[entryKeyHrid] || 0) + count;
        }
    }

    // Chest keys: 1 per chest (regular + refinement)
    for (const [chestHrid, count] of dropMap.entries()) {
        const chestKeyHrid = DUNGEON_CHEST_KEYS[chestHrid];
        if (chestKeyHrid && count > 0) {
            keyCounts[chestKeyHrid] = (keyCounts[chestKeyHrid] || 0) + count;
        }
    }

    for (const [keyHrid, count] of Object.entries(keyCounts)) {
        const unitCost = getBuyPrice(keyHrid);
        const keyDetails = dataManager.getItemDetails(keyHrid);
        costs.push({
            itemHrid: keyHrid,
            name: keyDetails?.name || keyHrid.split('/').pop(),
            count,
            unitCost,
            totalCost: count * unitCost,
        });
    }

    return costs.sort((a, b) => b.totalCost - a.totalCost);
}

/**
 * Get the buy price for an item based on the global pricing mode.
 * @param {Object|null} priceData - { bid, ask } from marketAPI.getPrice()
 * @returns {number}
 */
function getBuyPrice(priceData) {
    if (!priceData) return 0;
    const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
    if (mode === 'optimistic' || mode === 'patientBuy') {
        return priceData.bid > 0 ? priceData.bid : 0;
    }
    return priceData.ask > 0 ? priceData.ask : 0;
}

/**
 * Calculate revenue and consumable costs from a sim result.
 * Respects the user's profitCalc_pricingMode setting. Reuses the canonical sell-side valuation +
 * market tax contract (CSIM-AUD-012) instead of a Combat-Sim-specific formula, and folds dungeon
 * key cost into its own returned totals (CSIM-AUD-014) so every caller of this shared function -
 * not just the main Results detail view, which already computes key cost separately - sees a
 * complete profit number (e.g. All-Zones' "skip worse tiers" pruning, Upgrade Advisor).
 * @param {Object} simResult - SimResult from runSimulation()
 * @param {Object} gameData - Game data payload from buildGameDataPayload()
 * @param {string} playerHrid - Player HRID to read drop multipliers and consumables for
 * @param {number} hours - Number of hours simulated
 * @returns {{ revenuePerHour: number, costPerHour: number, netPerHour: number, keyCostPerHour: number,
 *             hasMissingPrices: boolean, dropEntries: Array, consumableEntries: Array }}
 */
export function calculateSimRevenue(simResult, gameData, playerHrid, hours) {
    let revenuePerHour = 0;
    let hasMissingPrices = false;
    const dropEntries = [];

    const dropMap = calculateExpectedDrops(simResult, gameData, playerHrid);
    for (const [itemHrid, total] of dropMap.entries()) {
        if (total <= 0) continue;
        const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid);
        if (!resolved) {
            hasMissingPrices = true;
            continue;
        }
        const unitValue = resolved.needsTax ? calculatePriceAfterTax(resolved.value, MARKET_TAX) : resolved.value;
        const perHour = (total / hours) * unitValue;
        revenuePerHour += perHour;
        if (unitValue > 0) {
            const itemName = dataManager.getItemDetails(itemHrid)?.name || itemHrid.split('/').pop();
            dropEntries.push({ name: itemName, countPerHour: total / hours, unitValue, totalValue: perHour });
        }
    }
    dropEntries.sort((a, b) => b.totalValue - a.totalValue);

    let costPerHour = 0;
    const consumableEntries = [];
    const consumablesUsed = simResult.consumablesUsed?.[playerHrid] || {};
    for (const [itemHrid, count] of Object.entries(consumablesUsed)) {
        const unitCost = getBuyPrice(marketAPI.getPrice(itemHrid));
        const perHour = (count / hours) * unitCost;
        costPerHour += perHour;
        if (unitCost > 0) {
            const itemName = dataManager.getItemDetails(itemHrid)?.name || itemHrid.split('/').pop();
            consumableEntries.push({ name: itemName, countPerHour: count / hours, unitCost, totalCost: perHour });
        }
    }

    let keyCostPerHour = 0;
    if (simResult.isDungeon) {
        const keyCosts = calculateDungeonKeyCosts(dropMap, (keyHrid) => getBuyPrice(marketAPI.getPrice(keyHrid)));
        for (const key of keyCosts) {
            keyCostPerHour += key.totalCost / hours;
        }
        costPerHour += keyCostPerHour;
    }

    return {
        revenuePerHour,
        costPerHour,
        netPerHour: revenuePerHour - costPerHour,
        keyCostPerHour,
        hasMissingPrices,
        dropEntries,
        consumableEntries,
    };
}

/**
 * Find all zone×tier combinations that drop the specified item.
 * Checks regular zone monster drop tables and dungeon reward drop tables.
 * @param {string} itemHrid - e.g. '/items/soul_hunter_crossbow'
 * @param {Object} gameData - Game data payload from buildGameDataPayload()
 * @returns {Array<{zoneHrid: string, difficultyTier: number, name: string}>} Sorted by sortIndex then tier
 */
export function getZonesThatDropItem(itemHrid, gameData) {
    const { actionDetailMap, combatMonsterDetailMap } = gameData;
    if (!actionDetailMap || !combatMonsterDetailMap) return [];

    const results = [];

    for (const [hrid, action] of Object.entries(actionDetailMap)) {
        if (action.type !== '/action_types/combat') continue;

        const maxDifficulty = action.maxDifficulty || 0;
        const isDungeon = action.combatZoneInfo?.isDungeon || false;

        if (isDungeon) {
            // Dungeon: item comes from the reward drop table (same table for all tiers)
            const rewardDropTable = action.combatZoneInfo?.dungeonInfo?.rewardDropTable;
            if (rewardDropTable?.some((drop) => drop.itemHrid === itemHrid)) {
                for (let tier = 0; tier <= maxDifficulty; tier++) {
                    results.push({ zoneHrid: hrid, difficultyTier: tier, name: action.name });
                }
            }
        } else {
            // Regular zone: check each monster's drop table and rare drop table
            const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
            const bossSpawns = action.combatZoneInfo?.fightInfo?.bossSpawns || [];
            const validTiers = new Set();

            for (const spawn of [...spawns, ...bossSpawns]) {
                const monster = combatMonsterDetailMap[spawn.combatMonsterHrid];
                if (!monster) continue;

                for (const drop of monster.dropTable || []) {
                    if (drop.itemHrid !== itemHrid) continue;
                    const minTier = drop.minDifficultyTier || 0;
                    for (let tier = minTier; tier <= maxDifficulty; tier++) {
                        validTiers.add(tier);
                    }
                }

                for (const drop of monster.rareDropTable || []) {
                    if (drop.itemHrid !== itemHrid) continue;
                    const minTier = drop.minDifficultyTier || 0;
                    for (let tier = minTier; tier <= maxDifficulty; tier++) {
                        validTiers.add(tier);
                    }
                }
            }

            for (const tier of validTiers) {
                results.push({ zoneHrid: hrid, difficultyTier: tier, name: action.name });
            }
        }
    }

    results.sort((a, b) => {
        const aSortIndex = actionDetailMap[a.zoneHrid]?.sortIndex ?? 0;
        const bSortIndex = actionDetailMap[b.zoneHrid]?.sortIndex ?? 0;
        if (aSortIndex !== bSortIndex) return aSortIndex - bSortIndex;
        return a.difficultyTier - b.difficultyTier;
    });

    return results;
}
