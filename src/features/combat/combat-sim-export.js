/**
 * Combat Simulator Export Module
 * Constructs player data in Shykai Combat Simulator format
 *
 * Exports character data for solo or party simulation testing
 */

/**
 * Get saved character data from GM storage
 * @returns {Object|null} Parsed character data or null
 */
function getCharacterData() {
    try {
        if (typeof GM_getValue === 'undefined') {
            console.error('[Combat Sim Export] GM_getValue not available');
            return null;
        }

        const data = GM_getValue('toolasha_init_character_data', null);
        if (!data) {
            console.error('[Combat Sim Export] No character data found. Please refresh game page.');
            return null;
        }

        return JSON.parse(data);
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get character data:', error);
        return null;
    }
}

/**
 * Get saved battle data from GM storage
 * @returns {Object|null} Parsed battle data or null
 */
function getBattleData() {
    try {
        if (typeof GM_getValue === 'undefined') {
            return null;
        }

        const data = GM_getValue('toolasha_new_battle', null);
        if (!data) {
            return null; // No battle data (not in combat or solo)
        }

        return JSON.parse(data);
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get battle data:', error);
        return null;
    }
}

/**
 * Get init_client_data from GM storage
 * @returns {Object|null} Parsed client data or null
 */
function getClientData() {
    try {
        if (typeof GM_getValue === 'undefined') {
            return null;
        }

        const data = GM_getValue('toolasha_init_client_data', null);
        if (!data) {
            console.warn('[Combat Sim Export] No client data found');
            return null;
        }

        return JSON.parse(data);
    } catch (error) {
        console.error('[Combat Sim Export] Failed to get client data:', error);
        return null;
    }
}

/**
 * Get profile export list from GM storage
 * @returns {Array} List of saved profiles
 */
function getProfileList() {
    try {
        if (typeof GM_getValue === 'undefined') {
            return [];
        }

        const data = GM_getValue('toolasha_profile_export_list', '[]');
        return JSON.parse(data);
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
            equipment: []
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {}
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
                    enhancementLevel: item.enhancementLevel || 0
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
                enhancementLevel: item.enhancementLevel || 0
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
        playerObj.abilities[i] = { abilityHrid: '', level: '1' };
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
                level: String(ability.level || 1)
            };
        } else if (normalAbilityIndex < 5) {
            // Normal abilities go in slots 1-4
            playerObj.abilities[normalAbilityIndex++] = {
                abilityHrid: ability.abilityHrid,
                level: String(ability.level || 1)
            };
        }
    }

    // Extract trigger maps
    playerObj.triggerMap = {
        ...(characterObj.abilityCombatTriggersMap || {}),
        ...(characterObj.consumableCombatTriggersMap || {})
    };

    // Extract house room levels
    for (const house of Object.values(characterObj.characterHouseRoomMap || {})) {
        playerObj.houseRooms[house.houseRoomHrid] = house.level;
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
            equipment: []
        },
        food: { '/action_types/combat': [] },
        drinks: { '/action_types/combat': [] },
        abilities: [],
        triggerMap: {},
        houseRooms: {}
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
                enhancementLevel: item.enhancementLevel || 0
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
        battlePlayer = battleObj.players.find(p => p.character?.id === profile.characterID);
    }

    if (battlePlayer?.combatConsumables) {
        let foodIndex = 0;
        let drinkIndex = 0;

        // Intelligently separate food and drinks
        battlePlayer.combatConsumables.forEach(consumable => {
            const itemHrid = consumable.itemHrid;

            // Check if it's a drink
            const isDrink = itemHrid.includes('/drinks/') ||
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
        playerObj.abilities[i] = { abilityHrid: '', level: '1' };
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
                level: String(ability.level || 1)
            };
        } else if (normalAbilityIndex < 5) {
            // Normal abilities go in slots 1-4
            playerObj.abilities[normalAbilityIndex++] = {
                abilityHrid: ability.abilityHrid,
                level: String(ability.level || 1)
            };
        }
    }

    // Extract trigger maps (prefer battle data, fallback to profile)
    playerObj.triggerMap = {
        ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
        ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {})
    };

    // Extract house room levels from profile
    if (profile.profile?.characterHouseRoomMap) {
        for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
            playerObj.houseRooms[house.houseRoomHrid] = house.level;
        }
    }

    return playerObj;
}

/**
 * Construct full export object (solo or party)
 * @returns {Object} Export object with player data, IDs, positions, and zone info
 */
export function constructExportObject() {
    const characterObj = getCharacterData();
    if (!characterObj) {
        return null;
    }

    const clientObj = getClientData();
    const battleObj = getBattleData();
    const profileList = getProfileList();

    // Blank player template (as string, like MCS)
    const BLANK = '{"player":{"attackLevel":1,"magicLevel":1,"meleeLevel":1,"rangedLevel":1,"defenseLevel":1,"staminaLevel":1,"intelligenceLevel":1,"equipment":[]},"food":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"drinks":{"/action_types/combat":[{"itemHrid":""},{"itemHrid":""},{"itemHrid":""}]},"abilities":[{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"},{"abilityHrid":"","level":"1"}],"triggerMap":{},"houseRooms":{"/house_rooms/dairy_barn":0,"/house_rooms/garden":0,"/house_rooms/log_shed":0,"/house_rooms/forge":0,"/house_rooms/workshop":0,"/house_rooms/sewing_parlor":0,"/house_rooms/kitchen":0,"/house_rooms/brewery":0,"/house_rooms/laboratory":0,"/house_rooms/observatory":0,"/house_rooms/dining_room":0,"/house_rooms/library":0,"/house_rooms/dojo":0,"/house_rooms/gym":0,"/house_rooms/armory":0,"/house_rooms/archery_range":0,"/house_rooms/mystical_study":0}}';

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

    // Check if in party
    const hasParty = characterObj.partyInfo?.partySlotMap;

    if (!hasParty) {
        // === SOLO MODE ===
        console.log('[Combat Sim Export] Exporting solo character');

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
        // === PARTY MODE ===
        console.log('[Combat Sim Export] Exporting party');
        isParty = true;

        let slotIndex = 1;
        for (const member of Object.values(characterObj.partyInfo.partySlotMap)) {
            if (member.characterID) {
                if (member.characterID === characterObj.character.id) {
                    // This is you
                    exportObj[slotIndex] = JSON.stringify(constructSelfPlayer(characterObj, clientObj));
                    playerIDs[slotIndex - 1] = characterObj.character.name;
                    importedPlayerPositions[slotIndex - 1] = true;
                } else {
                    // Party member - try to get from profile list
                    const profile = profileList.find(p => p.characterID === member.characterID);
                    if (profile) {
                        exportObj[slotIndex] = JSON.stringify(constructPartyPlayer(profile, clientObj, battleObj));
                        playerIDs[slotIndex - 1] = profile.characterName;
                        importedPlayerPositions[slotIndex - 1] = true;
                    } else {
                        playerIDs[slotIndex - 1] = 'Open profile in game';
                        console.warn(`[Combat Sim Export] No profile found for party member ${member.characterID}. Open their profile in-game to capture data.`);
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

    return {
        exportObj,
        playerIDs,
        importedPlayerPositions,
        zone,
        isZoneDungeon,
        difficultyTier,
        isParty
    };
}
