/**
 * Combat Simulator Export Module
 * Constructs player data in Shykai Combat Simulator format
 *
 * Exports character data for solo or party simulation testing
 */

import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';

/**
 * Get character data from dataManager (in-memory, always current).
 * Falls back to GM storage when running on the Shykai page (dataManager is empty cross-domain).
 * @returns {Object|null}
 */
function getCharacterData() {
    const data = dataManager.characterData;
    if (data) return data;
    // Cross-domain fallback: read from GM storage (saved by game page)
    if (typeof GM_getValue !== 'undefined') {
        try {
            const raw = GM_getValue('toolasha_init_character_data', null);
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
    }
    console.error('[Combat Sim Export] No character data found. Please refresh game page.');
    return null;
}

/**
 * Get battle data from dataManager (null if not in combat).
 * Falls back to GM storage when running on the Shykai page.
 * @returns {Object|null}
 */
function getBattleData() {
    if (dataManager.battleData) return dataManager.battleData;
    if (typeof GM_getValue !== 'undefined') {
        try {
            const raw = GM_getValue('toolasha_new_battle', null);
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
    }
    return null;
}

/**
 * Get init_client_data from dataManager (in-memory, always current).
 * Falls back to GM storage when running on the Shykai page.
 * @returns {Object|null}
 */
function getClientData() {
    const data = dataManager.getInitClientData();
    if (data) return data;
    if (typeof GM_getValue !== 'undefined') {
        try {
            const raw = GM_getValue('toolasha_init_client_data', null);
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
    }
    return null;
}

/**
 * Get profile list from IndexedDB (cross-session) with GM storage fallback (cross-domain for Shykai).
 * @returns {Promise<Array>}
 */
async function getProfileList() {
    if (storage.available) {
        try {
            const list = await storage.getJSON('profile_list', 'combatExport', null);
            if (list && list.length > 0) return list;
        } catch (error) {
            console.error('[Combat Sim Export] Failed to get profile list from IndexedDB:', error);
        }
    }
    // Cross-domain fallback: read from GM storage (saved by game page)
    if (typeof GM_getValue !== 'undefined') {
        try {
            const raw = GM_getValue('toolasha_profile_list', null);
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
    }
    return [];
}

/**
 * Construct player export object from own character data
 * @param {Object} characterObj - Character data from init_character_data
 * @param {Object} clientObj - Client data (optional)
 * @returns {Object} Player export object
 */
function constructSelfPlayer(characterObj, clientObj) {
    const playerObj = {
        player: {
            attackLevel: 1,
            magicLevel: 1,
            meleeLevel: 1,
            rangedLevel: 1,
            defenseLevel: 1,
            staminaLevel: 1,
            intelligenceLevel: 1,
            equipment: [],
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {},
    };

    // Extract combat skill levels
    for (const skill of characterObj.characterSkills || []) {
        const skillName = skill.skillHrid.split('/').pop();
        if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
            playerObj.player[skillName + 'Level'] = skill.level;
        }
    }

    // Extract equipped items — prefer the always-current characterEquipment Map
    // (updated on every items_updated WS message) over the characterItems array
    // which can lose enhancementLevel when items are swapped mid-session.
    const equipmentMap = dataManager.characterEquipment;
    if (equipmentMap && equipmentMap.size > 0) {
        for (const [locationHrid, item] of equipmentMap) {
            playerObj.player.equipment.push({
                itemLocationHrid: locationHrid,
                itemHrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            });
        }
    } else if (Array.isArray(characterObj.characterItems)) {
        // Fallback: array format (cross-domain or Map not yet populated)
        for (const item of characterObj.characterItems) {
            if (item.itemLocationHrid && !item.itemLocationHrid.includes('/item_locations/inventory')) {
                playerObj.player.equipment.push({
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                });
            }
        }
    } else if (characterObj.characterEquipment) {
        // Fallback: object format (cross-domain Shykai page)
        for (const key in characterObj.characterEquipment) {
            const item = characterObj.characterEquipment[key];
            playerObj.player.equipment.push({
                itemLocationHrid: item.itemLocationHrid,
                itemHrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            });
        }
    }

    // Initialize food and drink slots
    for (let i = 0; i < 3; i++) {
        playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
        playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
    }

    // Extract food slots
    const foodSlots = characterObj.actionTypeFoodSlotsMap?.['/action_types/combat'];
    if (Array.isArray(foodSlots)) {
        foodSlots.forEach((item, i) => {
            if (i < 3 && item?.itemHrid) {
                playerObj.food['/action_types/combat'][i] = { itemHrid: item.itemHrid };
            }
        });
    }

    // Extract drink slots
    const drinkSlots = characterObj.actionTypeDrinkSlotsMap?.['/action_types/combat'];
    if (Array.isArray(drinkSlots)) {
        drinkSlots.forEach((item, i) => {
            if (i < 3 && item?.itemHrid) {
                playerObj.drinks['/action_types/combat'][i] = { itemHrid: item.itemHrid };
            }
        });
    }

    // Initialize abilities (5 slots)
    for (let i = 0; i < 5; i++) {
        playerObj.abilities[i] = { abilityHrid: '', level: 1 };
    }

    // Extract equipped abilities from combatUnit.combatAbilities (the live equipped state).
    // When abilityDetailMap is available (game page), use isSpecialAbility for precise detection.
    // On Shykai (cross-domain, no clientObj), fall back to the convention that combatAbilities[0]
    // is the special/aura ability when 4 or more abilities are present.
    const combatAbilities = characterObj.combatUnit?.combatAbilities || [];
    const hasDetailMap = !!clientObj?.abilityDetailMap;
    let normalAbilityIndex = 1;

    for (let i = 0; i < combatAbilities.length; i++) {
        const ability = combatAbilities[i];
        if (!ability?.abilityHrid) continue;

        let isSpecial;
        if (hasDetailMap) {
            isSpecial = clientObj.abilityDetailMap[ability.abilityHrid]?.isSpecialAbility || false;
        } else {
            // Cross-domain fallback: treat first entry as special when kit is full-sized
            isSpecial = i === 0 && combatAbilities.length >= 4;
        }

        if (isSpecial) {
            playerObj.abilities[0] = { abilityHrid: ability.abilityHrid, level: ability.level || 1 };
        } else if (normalAbilityIndex < 5) {
            playerObj.abilities[normalAbilityIndex++] = {
                abilityHrid: ability.abilityHrid,
                level: ability.level || 1,
            };
        }
    }

    // Extract trigger maps
    playerObj.triggerMap = {
        ...(characterObj.abilityCombatTriggersMap || {}),
        ...(characterObj.consumableCombatTriggersMap || {}),
    };

    // Extract house room levels
    for (const house of Object.values(characterObj.characterHouseRoomMap || {})) {
        playerObj.houseRooms[house.houseRoomHrid] = house.level;
    }

    // Extract completed achievements
    playerObj.achievements = {};
    if (characterObj.characterAchievements) {
        for (const achievement of characterObj.characterAchievements) {
            if (achievement.achievementHrid && achievement.isCompleted) {
                playerObj.achievements[achievement.achievementHrid] = true;
            }
        }
    }

    return playerObj;
}

/**
 * Construct party member data from profile share
 * @param {Object} profile - Profile data from profile_shared message
 * @param {Object} clientObj - Client data (optional)
 * @param {Object} battleObj - Battle data (optional, for consumables)
 * @returns {Object} Player export object
 */
function constructPartyPlayer(profile, clientObj, battleObj) {
    const playerObj = {
        player: {
            attackLevel: 1,
            magicLevel: 1,
            meleeLevel: 1,
            rangedLevel: 1,
            defenseLevel: 1,
            staminaLevel: 1,
            intelligenceLevel: 1,
            equipment: [],
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {},
    };

    // Extract skill levels from profile
    for (const skill of profile.profile?.characterSkills || []) {
        const skillName = skill.skillHrid?.split('/').pop();
        if (skillName && playerObj.player[skillName + 'Level'] !== undefined) {
            playerObj.player[skillName + 'Level'] = skill.level || 1;
        }
    }

    // Extract equipment from profile
    if (profile.profile?.wearableItemMap) {
        for (const key in profile.profile.wearableItemMap) {
            const item = profile.profile.wearableItemMap[key];
            playerObj.player.equipment.push({
                itemLocationHrid: item.itemLocationHrid,
                itemHrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0,
            });
        }
    }

    // Initialize food and drink slots
    for (let i = 0; i < 3; i++) {
        playerObj.food['/action_types/combat'][i] = { itemHrid: '' };
        playerObj.drinks['/action_types/combat'][i] = { itemHrid: '' };
    }

    // Get consumables from battle data if available
    let battlePlayer = null;
    if (battleObj?.players) {
        battlePlayer = battleObj.players.find((p) => p.character?.id === profile.characterID);
    }

    if (battlePlayer?.combatConsumables) {
        let foodIndex = 0;
        let drinkIndex = 0;

        // Intelligently separate food and drinks
        battlePlayer.combatConsumables.forEach((consumable) => {
            const itemHrid = consumable.itemHrid;

            // Check if it's a drink
            const isDrink =
                itemHrid.includes('/drinks/') ||
                itemHrid.includes('coffee') ||
                clientObj?.itemDetailMap?.[itemHrid]?.type === 'drink';

            if (isDrink && drinkIndex < 3) {
                playerObj.drinks['/action_types/combat'][drinkIndex++] = { itemHrid: itemHrid };
            } else if (!isDrink && foodIndex < 3) {
                playerObj.food['/action_types/combat'][foodIndex++] = { itemHrid: itemHrid };
            }
        });
    } else {
        // Fallback: Get consumables from profile trigger map (for non-party members)
        // The keys of consumableCombatTriggersMap are the equipped consumable HRIDs
        const consumableHrids = Object.keys(profile.profile?.consumableCombatTriggersMap || {});

        if (consumableHrids.length > 0) {
            let foodIndex = 0;
            let drinkIndex = 0;

            consumableHrids.forEach((itemHrid) => {
                // Check if it's a drink
                const isDrink =
                    itemHrid.includes('/drinks/') ||
                    itemHrid.includes('coffee') ||
                    clientObj?.itemDetailMap?.[itemHrid]?.type === 'drink';

                if (isDrink && drinkIndex < 3) {
                    playerObj.drinks['/action_types/combat'][drinkIndex++] = { itemHrid: itemHrid };
                } else if (!isDrink && foodIndex < 3) {
                    playerObj.food['/action_types/combat'][foodIndex++] = { itemHrid: itemHrid };
                }
            });
        }
    }

    // Initialize abilities (5 slots)
    for (let i = 0; i < 5; i++) {
        playerObj.abilities[i] = { abilityHrid: '', level: 1 };
    }

    // Extract equipped abilities from profile.
    // When abilityDetailMap is available (game page), use isSpecialAbility for precise detection.
    // On Shykai (cross-domain, no clientObj), fall back to the convention that equippedAbilities[0]
    // is the special/aura ability when 4 or more abilities are present.
    const equippedAbilities = profile.profile?.equippedAbilities || [];
    const hasProfileDetailMap = !!clientObj?.abilityDetailMap;
    let profileNormalIndex = 1;

    for (let i = 0; i < equippedAbilities.length; i++) {
        const ability = equippedAbilities[i];
        if (!ability?.abilityHrid) continue;

        let isSpecial;
        if (hasProfileDetailMap) {
            isSpecial = clientObj.abilityDetailMap[ability.abilityHrid]?.isSpecialAbility || false;
        } else {
            isSpecial = i === 0 && equippedAbilities.length >= 4;
        }

        if (isSpecial) {
            playerObj.abilities[0] = { abilityHrid: ability.abilityHrid, level: ability.level || 1 };
        } else if (profileNormalIndex < 5) {
            playerObj.abilities[profileNormalIndex++] = {
                abilityHrid: ability.abilityHrid,
                level: ability.level || 1,
            };
        }
    }

    // Extract trigger maps (prefer battle data, fallback to profile)
    playerObj.triggerMap = {
        ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
        ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {}),
    };

    // Extract house room levels from profile
    if (profile.profile?.characterHouseRoomMap) {
        for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
            playerObj.houseRooms[house.houseRoomHrid] = house.level;
        }
    }

    // Extract completed achievements from profile
    playerObj.achievements = {};
    if (profile.profile?.characterAchievements) {
        for (const achievement of profile.profile.characterAchievements) {
            if (achievement.achievementHrid && achievement.isCompleted) {
                playerObj.achievements[achievement.achievementHrid] = true;
            }
        }
    }

    return playerObj;
}

/**
 * Construct full export object (solo or party)
 * @param {string|null} externalProfileId - Optional profile ID (for viewing other players' profiles)
 * @param {boolean} singlePlayerFormat - If true, returns player object instead of multi-player format
 * @returns {Object} Export object with player data, IDs, positions, and zone info
 */
export async function constructExportObject(externalProfileId = null, singlePlayerFormat = false) {
    const characterObj = getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = getClientData();
    const battleObj = getBattleData();
    const profileList = await getProfileList();

    // Blank player template (as string, like MCS)
    const BLANK =
        '{"player":{"attackLevel":1,"magicLevel":1,"meleeLevel":1,"rangedLevel":1,"defenseLevel":1,"staminaLevel":1,"intelligenceLevel":1,"equipment":[]},"food":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"drinks":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"abilities":[{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1}],"triggerMap":{},"zone":"/actions/combat/fly","houseRooms":{"/house_rooms/dairy_barn":0,"/house_rooms/garden":0,"/house_rooms/log_shed":0,"/house_rooms/forge":0,"/house_rooms/workshop":0,"/house_rooms/sewing_parlor":0,"/house_rooms/kitchen":0,"/house_rooms/brewery":0,"/house_rooms/laboratory":0,"/house_rooms/observatory":0,"/house_rooms/dining_room":0,"/house_rooms/library":0,"/house_rooms/dojo":0,"/house_rooms/gym":0,"/house_rooms/armory":0,"/house_rooms/archery_range":0,"/house_rooms/mystical_study":0},"achievements":{}}';

    // Check if exporting another player's profile
    if (externalProfileId && externalProfileId !== characterObj.character.id) {
        const profile = profileList.find((p) => p.characterID === externalProfileId);

        if (!profile) {
            console.error('[Combat Sim Export] Profile not found for:', externalProfileId);
            return null; // Profile not in cache
        }

        // Construct the player object
        const playerObj = constructPartyPlayer(profile, clientObj, battleObj);

        // If single-player format requested, return player object directly
        if (singlePlayerFormat) {
            // Add required fields for solo format
            playerObj.name = profile.characterName;
            playerObj.zone = '/actions/combat/fly';

            return {
                exportObj: playerObj,
                playerIDs: [profile.characterName, t('Player 2'), t('Player 3'), t('Player 4'), t('Player 5')],
                importedPlayerPositions: [true, false, false, false, false],
                zone: '/actions/combat/fly',
                isZoneDungeon: false,
                difficultyTier: 0,
                isParty: false,
            };
        }

        // Multi-player format (for auto-import storage)
        const exportObj = {};
        exportObj[1] = JSON.stringify(playerObj);

        // Fill other slots with blanks
        for (let i = 2; i <= 5; i++) {
            exportObj[i] = BLANK;
        }

        return {
            exportObj,
            playerIDs: [profile.characterName, t('Player 2'), t('Player 3'), t('Player 4'), t('Player 5')],
            importedPlayerPositions: [true, false, false, false, false],
            zone: '/actions/combat/fly',
            isZoneDungeon: false,
            difficultyTier: 0,
            isParty: false,
        };
    }

    // Export YOUR data (solo or party) - existing logic below
    const exportObj = {};
    for (let i = 1; i <= 5; i++) {
        exportObj[i] = BLANK;
    }

    const playerIDs = [t('Player 1'), t('Player 2'), t('Player 3'), t('Player 4'), t('Player 5')];
    const importedPlayerPositions = [false, false, false, false, false];
    let zone = '/actions/combat/fly';
    let isZoneDungeon = false;
    let difficultyTier = 0;
    let isParty = false;
    let yourSlotIndex = 1; // Track which slot contains YOUR data (for party mode)

    // Check if in party
    const hasParty = characterObj.partyInfo?.partySlotMap;

    if (!hasParty) {
        exportObj[1] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
        playerIDs[0] = characterObj.character?.name || t('Player 1');
        importedPlayerPositions[0] = true;

        // Get current combat zone and tier
        for (const action of characterObj.characterActions || []) {
            if (action && action.actionHrid.includes('/actions/combat/')) {
                zone = action.actionHrid;
                difficultyTier = action.difficultyTier || 0;
                isZoneDungeon = clientObj?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
                break;
            }
        }
    } else {
        let slotIndex = 1;
        for (const member of Object.values(characterObj.partyInfo.partySlotMap)) {
            if (member.characterID) {
                if (member.characterID === characterObj.character.id) {
                    // This is you
                    yourSlotIndex = slotIndex; // Remember your slot
                    exportObj[slotIndex] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
                    playerIDs[slotIndex - 1] = characterObj.character.name;
                    importedPlayerPositions[slotIndex - 1] = true;
                } else {
                    // Party member - try to get from profile list
                    const profile = profileList.find((p) => p.characterID === member.characterID);
                    if (profile) {
                        exportObj[slotIndex] = JSON.stringify(constructPartyPlayer(profile, clientObj, battleObj));
                        playerIDs[slotIndex - 1] = profile.characterName;
                        importedPlayerPositions[slotIndex - 1] = true;
                    } else {
                        console.warn(
                            '[Combat Sim Export] No profile found for party member',
                            member.characterID,
                            '- profiles have:',
                            profileList.map((p) => p.characterID)
                        );
                        playerIDs[slotIndex - 1] = t('Open profile in game');
                    }
                }
                slotIndex++;
            }
        }

        // Only enable party (5-slot) mode in the sim when the party is full (5 players).
        // Smaller parties fit within the sim's default 3-slot mode without needing dungeon toggle.
        isParty = slotIndex - 1 === 5;

        // Get party zone and tier
        zone = characterObj.partyInfo?.party?.actionHrid || '/actions/combat/fly';
        difficultyTier = characterObj.partyInfo?.party?.difficultyTier || 0;
        isZoneDungeon = clientObj?.actionDetailMap?.[zone]?.combatZoneInfo?.isDungeon || false;
    }

    // If single-player format requested, return just the player object
    if (singlePlayerFormat && exportObj[yourSlotIndex]) {
        // Always use yourSlotIndex — defaults to 1 for solo, set to actual slot in any party size
        const slotToExport = yourSlotIndex;

        // Parse the player JSON string back to an object
        const playerObj = JSON.parse(exportObj[slotToExport]);

        // Add required fields for solo format
        playerObj.name = playerIDs[slotToExport - 1];
        playerObj.zone = zone;

        return {
            exportObj: playerObj, // Single player object instead of multi-player format
            playerIDs,
            importedPlayerPositions,
            zone,
            isZoneDungeon,
            difficultyTier,
            isParty: false, // Single player export is never party format
        };
    }

    return {
        exportObj,
        playerIDs,
        importedPlayerPositions,
        zone,
        isZoneDungeon,
        difficultyTier,
        isParty,
    };
}
