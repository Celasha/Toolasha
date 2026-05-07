/**
 * Combat Simulator Adapter
 * Bridges Toolasha's live data to the combat sim engine.
 *
 * Extracts game data maps, builds player DTOs, and provides
 * combat zone metadata for the simulation UI.
 */

import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';

/**
 * Extract all required game data maps from initClientData for the sim engine.
 * @returns {Object|null} Plain object with all 13 game data maps, or null if data unavailable
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
    };
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
        hrid: 'player1',
        debuffOnLevelGap: 0,
        equipment: {},
        food: [],
        drinks: [],
        abilities: [],
        houseRooms: {},
    };

    // Extract combat skill levels
    for (const skill of characterData.characterSkills || []) {
        const skillName = skill.skillHrid.split('/').pop();
        const key = skillName + 'Level';
        if (dto[key] !== undefined) {
            dto[key] = skill.level;
        }
    }

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

    // Extract equipped abilities → array of { hrid, level, triggers }
    const equippedAbilities = characterData.combatUnit?.combatAbilities || [];
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
    };

    // Extract skill levels
    for (const skill of profile.profile?.characterSkills || []) {
        const skillName = skill.skillHrid?.split('/').pop();
        const key = skillName + 'Level';
        if (dto[key] !== undefined) {
            dto[key] = skill.level || 1;
        }
    }

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
 * Calculate combat level for level gap debuff.
 * @param {Object} dto - Player DTO
 * @returns {number} Combat level
 */
function calcCombatLevel(dto) {
    const base = (dto.staminaLevel + dto.intelligenceLevel + dto.defenseLevel) / 4;
    const melee = (dto.attackLevel + dto.meleeLevel) / 2;
    const ranged = (dto.attackLevel + dto.rangedLevel) / 2;
    const magic = (dto.attackLevel + dto.magicLevel) / 2;
    return Math.floor(base + Math.max(melee, ranged, magic));
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
        let maxCombatLevel = 0;
        const levels = players.map((p) => {
            const level = calcCombatLevel(p);
            maxCombatLevel = Math.max(maxCombatLevel, level);
            return level;
        });

        for (let i = 0; i < players.length; i++) {
            const ratio = maxCombatLevel / levels[i];
            if (ratio > 1.2) {
                const maxDebuff = 0.9;
                const levelPercent = Math.floor((ratio - 1.2) * 100) / 100;
                players[i].debuffOnLevelGap = -1 * Math.min(maxDebuff, 3 * levelPercent);
            } else {
                players[i].debuffOnLevelGap = 0;
            }
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
 * Apply a named loadout snapshot to a player DTO (mutates dto in place).
 * Extracted from CombatSimUI._applyLoadoutToDTO so both the sim UI and task display can use it.
 * @param {Object} dto - Player DTO to mutate
 * @param {string} snapshotName - Loadout snapshot name
 * @param {Object} gameData - Game data payload from buildGameDataPayload()
 * @returns {boolean} True if snapshot was found and applied, false otherwise
 */
export function applyLoadoutSnapshotToDTO(dto, snapshotName, gameData) {
    const snapshots = loadoutSnapshot.getAllSnapshots();
    const snapshot = snapshots.find((s) => s.name === snapshotName);
    if (!snapshot) return false;

    const itemDetailMap = gameData.itemDetailMap || {};
    const abilityDetailMap = gameData.abilityDetailMap || {};

    // Convert equipment: snapshot uses itemHrid, DTO keys by equipmentDetail.type.
    // Cross-reference live data for accurate enhancement levels (loadouts with
    // useExactEnhancement=false store 0 for most levels in the wearable hash).
    const liveEquipment = dataManager.characterEquipment;
    const newEquipment = {};
    for (const equip of snapshot.equipment || []) {
        const itemDetail = itemDetailMap[equip.itemHrid];
        const equipType = itemDetail?.equipmentDetail?.type;
        if (equipType) {
            let enhancementLevel = equip.enhancementLevel || 0;
            if (enhancementLevel === 0 && liveEquipment) {
                for (const [, liveItem] of liveEquipment) {
                    if (liveItem.itemHrid === equip.itemHrid) {
                        enhancementLevel = liveItem.enhancementLevel || 0;
                        break;
                    }
                }
            }
            newEquipment[equipType] = {
                hrid: equip.itemHrid,
                enhancementLevel,
            };
        }
    }
    dto.equipment = newEquipment;

    // Ability levels come from current character (not the snapshot)
    const characterData = dataManager.characterData;
    const currentAbilityLevels = {};
    for (const ability of characterData?.combatUnit?.combatAbilities || []) {
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

    // Build abilities array (5 slots: 0=special, 1-4=normal)
    dto.abilities = [null, null, null, null, null];
    let normalAbilityIndex = 1;
    for (const ab of snapshot.abilities || []) {
        if (!ab.abilityHrid) continue;
        const isSpecial = abilityDetailMap[ab.abilityHrid]?.isSpecialAbility || false;
        const abilityDTO = {
            hrid: ab.abilityHrid,
            level: currentAbilityLevels[ab.abilityHrid] || 1,
            triggers: buildTriggers(ab.abilityHrid),
        };
        if (isSpecial) {
            dto.abilities[0] = abilityDTO;
        } else if (normalAbilityIndex < 5) {
            dto.abilities[normalAbilityIndex++] = abilityDTO;
        }
    }

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
 * Calculate expected drops from simulation results for a specific player.
 * Uses deterministic expected-value math (no RNG rolls).
 * @param {Object} simResult - SimResult from the engine
 * @param {Object} gameData - Game data maps
 * @param {string} [playerHrid='player1'] - Which player's drop multipliers to use
 * @returns {Map<string, number>} itemHrid → expected total drop count
 */
export function calculateExpectedDrops(simResult, gameData, playerHrid = 'player1') {
    const combatMonsterDetailMap = gameData.combatMonsterDetailMap;
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
                for (const drop of rewardDropTable) {
                    const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                    const adjustedRate = Math.min(1.0, Math.max(0, baseRate));
                    if (adjustedRate <= 0) continue;

                    const avgCount = (drop.minCount + drop.maxCount) / 2;
                    const expected = simResult.dungeonsCompleted * adjustedRate * avgCount;

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

            // Regular drops
            if (monsterData.dropTable) {
                for (const drop of monsterData.dropTable) {
                    if (drop.minDifficultyTier > difficultyTier) continue;

                    const tierMultiplier = 1.0 + 0.1 * difficultyTier;
                    const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                    const adjustedRate = Math.min(1.0, tierMultiplier * baseRate * dropRateMultiplier);
                    if (adjustedRate <= 0) continue;

                    const avgCount = (drop.minCount + drop.maxCount) / 2;
                    const expected =
                        (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + combatDropQuantity)) /
                        numberOfPlayers;

                    totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                }
            }

            // Rare drops
            if (monsterData.rareDropTable) {
                for (const drop of monsterData.rareDropTable) {
                    if (drop.minDifficultyTier > difficultyTier) continue;

                    const adjustedRate = drop.dropRate * rareFindMultiplier;
                    const avgCount = (drop.minCount + (drop.maxCount ?? drop.minCount)) / 2;
                    const expected =
                        (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + combatDropQuantity)) /
                        numberOfPlayers;

                    totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                }
            }
        }
    }

    return totalDropMap;
}

// Maps dungeon chest HRIDs to their required entry key HRIDs
const DUNGEON_ENTRY_KEYS = {
    '/items/chimerical_chest': '/items/chimerical_entry_key',
    '/items/sinister_chest': '/items/sinister_entry_key',
    '/items/enchanted_chest': '/items/enchanted_entry_key',
    '/items/pirate_chest': '/items/pirate_entry_key',
};

// Maps dungeon chest HRIDs (regular + refinement) to their chest key HRIDs
const DUNGEON_CHEST_KEYS = {
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
 * Get the sell price for an item based on the global pricing mode.
 * @param {Object|null} priceData - { bid, ask } from marketAPI.getPrice()
 * @returns {number}
 */
function getSellPrice(priceData) {
    if (!priceData) return 0;
    const mode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
    if (mode === 'conservative' || mode === 'patientBuy') {
        return priceData.bid > 0 ? priceData.bid : 0;
    }
    return priceData.ask > 0 ? priceData.ask : 0;
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
 * Respects the user's profitCalc_pricingMode setting.
 * @param {Object} simResult - SimResult from runSimulation()
 * @param {Object} gameData - Game data payload from buildGameDataPayload()
 * @param {string} playerHrid - Player HRID to read drop multipliers and consumables for
 * @param {number} hours - Number of hours simulated
 * @returns {{ revenuePerHour: number, costPerHour: number, netPerHour: number,
 *             dropEntries: Array, consumableEntries: Array }}
 */
export function calculateSimRevenue(simResult, gameData, playerHrid, hours) {
    let revenuePerHour = 0;
    const dropEntries = [];

    const dropMap = calculateExpectedDrops(simResult, gameData, playerHrid);
    for (const [itemHrid, total] of dropMap.entries()) {
        if (total <= 0) continue;
        let unitValue = itemHrid === '/items/coin' ? 1 : getSellPrice(marketAPI.getPrice(itemHrid));
        if (unitValue === 0) {
            const ev =
                expectedValueCalculator.getCachedValue(itemHrid) ||
                expectedValueCalculator.calculateSingleContainer(itemHrid);
            if (ev !== null && ev > 0) unitValue = ev;
        }
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

    return {
        revenuePerHour,
        costPerHour,
        netPerHour: revenuePerHour - costPerHour,
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
            const validTiers = new Set();

            for (const spawn of spawns) {
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
