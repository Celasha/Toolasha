/**
 * Combat Simulator Export Module
 * Constructs player data in Shykai Combat Simulator format
 *
 * Exports character data for solo or party simulation testing
 */

import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import { getCurrentProfile } from '../../core/profile-manager.js';

// Detect if we're running on Tampermonkey or Steam
const hasScriptManager = typeof GM_info !== 'undefined';

/**
 * Get saved character data from storage
 * @returns {Promise<Object|null>} Parsed character data or null
 */
async function getCharacterData() {
    try {
        // Tampermonkey: Use GM storage (cross-domain, persisted)
        if (hasScriptManager) {
            const data = await webSocketHook.loadFromStorage('toolasha_init_character_data', null);
            if (!data) {
                console.error('[Combat Sim Export] No character data found. Please refresh game page.');
                return null;
            }
            return JSON.parse(data);
        }

        // Steam: Use dataManager (which has its own fallback handling)
        const characterData = dataManager.characterData;

        if (!characterData) {
            console.error('[Combat Sim Export] No character data found. Please refresh game page.');
            return null;
        }
        return characterData;
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get character data:', error);
        return null;
    }
}

/**
 * Get saved battle data from storage
 * @returns {Promise<Object|null>} Parsed battle data or null
 */
async function getBattleData() {
    try {
        // Tampermonkey: Use GM storage
        if (hasScriptManager) {
            const data = await webSocketHook.loadFromStorage('toolasha_new_battle', null);
            if (!data) {
                return null; // No battle data (not in combat or solo)
            }
            return JSON.parse(data);
        }

        // Steam: Use dataManager (RAM only, no GM storage available)
        const battleData = dataManager.battleData;
        if (!battleData) {
            return null; // No battle data (not in combat or solo)
        }
        return battleData;
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get battle data:', error);
        return null;
    }
}

/**
 * Get init_client_data from storage
 * @returns {Promise<Object|null>} Parsed client data or null
 */
async function getClientData() {
    try {
        // Tampermonkey: Use GM storage (cross-domain, persisted)
        if (hasScriptManager) {
            const data = await webSocketHook.loadFromStorage('toolasha_init_client_data', null);
            if (!data) {
                console.warn('[Combat Sim Export] No client data found');
                return null;
            }
            return JSON.parse(data);
        }

        // Steam: Use dataManager (RAM only, no GM storage available)
        const clientData = dataManager.getInitClientData();
        if (!clientData) {
            console.warn('[Combat Sim Export] No client data found');
            return null;
        }
        return clientData;
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get client data:', error);
        return null;
    }
}

/**
 * Get profile export list from storage
 * @returns {Promise<Array>} List of saved profiles
 */
async function getProfileList() {
    try {
        // Read from GM storage (cross-origin accessible, matches pattern of other combat sim data)
        const profileListJson = await webSocketHook.loadFromStorage('toolasha_profile_list', '[]');
        return JSON.parse(profileListJson);
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get profile list:', error);
        return [];
    }
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

    // Extract equipped items - handle both formats
    if (Array.isArray(characterObj.characterItems)) {
        // Array format (full inventory list)
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
        // Object format (just equipped items)
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

    // Extract equipped abilities
    let normalAbilityIndex = 1;
    const equippedAbilities = characterObj.combatUnit?.combatAbilities || [];
    for (const ability of equippedAbilities) {
        if (!ability || !ability.abilityHrid) continue;

        // Check if special ability
        const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

        if (isSpecial) {
            // Special ability goes in slot 0
            playerObj.abilities[0] = {
                abilityHrid: ability.abilityHrid,
                level: ability.level || 1,
            };
        } else if (normalAbilityIndex < 5) {
            // Normal abilities go in slots 1-4
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
    }

    // Initialize abilities (5 slots)
    for (let i = 0; i < 5; i++) {
        playerObj.abilities[i] = { abilityHrid: '', level: 1 };
    }

    // Extract equipped abilities from profile
    let normalAbilityIndex = 1;
    const equippedAbilities = profile.profile?.equippedAbilities || [];
    for (const ability of equippedAbilities) {
        if (!ability || !ability.abilityHrid) continue;

        // Check if special ability
        const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

        if (isSpecial) {
            // Special ability goes in slot 0
            playerObj.abilities[0] = {
                abilityHrid: ability.abilityHrid,
                level: ability.level || 1,
            };
        } else if (normalAbilityIndex < 5) {
            // Normal abilities go in slots 1-4
            playerObj.abilities[normalAbilityIndex++] = {
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
    const characterObj = await getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = await getClientData();
    const battleObj = await getBattleData();
    const profileList = await getProfileList();

    // Blank player template (as string, like MCS)
    const BLANK =
        '{"player":{"attackLevel":1,"magicLevel":1,"meleeLevel":1,"rangedLevel":1,"defenseLevel":1,"staminaLevel":1,"intelligenceLevel":1,"equipment":[]},"food":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"drinks":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"abilities":[{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1},{"abilityHrid":"","level":1}],"triggerMap":{},"zone":"/actions/combat/fly","simulationTime":"100","houseRooms":{"/house_rooms/dairy_barn":0,"/house_rooms/garden":0,"/house_rooms/log_shed":0,"/house_rooms/forge":0,"/house_rooms/workshop":0,"/house_rooms/sewing_parlor":0,"/house_rooms/kitchen":0,"/house_rooms/brewery":0,"/house_rooms/laboratory":0,"/house_rooms/observatory":0,"/house_rooms/dining_room":0,"/house_rooms/library":0,"/house_rooms/dojo":0,"/house_rooms/gym":0,"/house_rooms/armory":0,"/house_rooms/archery_range":0,"/house_rooms/mystical_study":0},"achievements":{}}';

    // Check if exporting another player's profile
    if (externalProfileId && externalProfileId !== characterObj.character.id) {
        // Try to find profile in GM storage first, then fall back to memory cache
        let profile = profileList.find((p) => p.characterID === externalProfileId);

        // If not found in GM storage, check memory cache (works on Steam)
        const cachedProfile = getCurrentProfile();
        if (!profile && cachedProfile && cachedProfile.characterID === externalProfileId) {
            profile = cachedProfile;
        }

        if (!profile) {
            console.error('[Combat Sim Export] Profile not found for:', externalProfileId);
            return null; // Profile not in cache
        }

        // Construct the player object
        const playerObj = constructPartyPlayer(profile, clientObj, battleObj);

        // If single-player format requested, return player object directly
        if (singlePlayerFormat) {
            // Add name field and remove zone/simulationTime for single-player format
            playerObj.name = profile.characterName;
            delete playerObj.zone;
            delete playerObj.simulationTime;

            return {
                exportObj: playerObj,
                playerIDs: [profile.characterName, 'Player 2', 'Player 3', 'Player 4', 'Player 5'],
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
            playerIDs: [profile.characterName, 'Player 2', 'Player 3', 'Player 4', 'Player 5'],
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

    const playerIDs = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
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
        playerIDs[0] = characterObj.character?.name || 'Player 1';
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
        isParty = true;

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
                        playerIDs[slotIndex - 1] = 'Open profile in game';
                    }
                }
                slotIndex++;
            }
        }

        // Get party zone and tier
        zone = characterObj.partyInfo?.party?.actionHrid || '/actions/combat/fly';
        difficultyTier = characterObj.partyInfo?.party?.difficultyTier || 0;
        isZoneDungeon = clientObj?.actionDetailMap?.[zone]?.combatZoneInfo?.isDungeon || false;
    }

    // If single-player format requested, return just the player object
    if (singlePlayerFormat && exportObj[1]) {
        // In party mode, export YOUR data (not necessarily slot 1)
        const slotToExport = isParty ? yourSlotIndex : 1;

        // Parse the player JSON string back to an object
        const playerObj = JSON.parse(exportObj[slotToExport]);

        // Add name field and remove zone/simulationTime for single-player format
        playerObj.name = playerIDs[slotToExport - 1];
        delete playerObj.zone;
        delete playerObj.simulationTime;

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
