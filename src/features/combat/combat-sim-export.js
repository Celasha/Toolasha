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

        // Try to get from storage (may not be available on sim page)
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
 * Construct player export object from character data
 * @param {Object} characterObj - Character data from init_character_data
 * @param {Object} clientObj - Client data (optional)
 * @returns {Object} Player export object
 */
function constructPlayerObject(characterObj, clientObj) {
    const playerObj = {};
    playerObj.player = {};

    // Extract combat skill levels
    for (const skill of characterObj.characterSkills || []) {
        const skillName = skill.skillHrid.split('/').pop();

        if (skillName === 'stamina') {
            playerObj.player.staminaLevel = skill.level;
        } else if (skillName === 'intelligence') {
            playerObj.player.intelligenceLevel = skill.level;
        } else if (skillName === 'attack') {
            playerObj.player.attackLevel = skill.level;
        } else if (skillName === 'melee' || skillName === 'power') { // power was old name
            playerObj.player.meleeLevel = skill.level;
        } else if (skillName === 'defense') {
            playerObj.player.defenseLevel = skill.level;
        } else if (skillName === 'ranged') {
            playerObj.player.rangedLevel = skill.level;
        } else if (skillName === 'magic') {
            playerObj.player.magicLevel = skill.level;
        }
    }

    // Extract equipped items
    playerObj.player.equipment = [];
    for (const item of characterObj.characterItems || []) {
        if (!item.itemLocationHrid.includes('/item_locations/inventory')) {
            playerObj.player.equipment.push({
                itemLocationHrid: item.itemLocationHrid,
                itemHrid: item.itemHrid,
                enhancementLevel: item.enhancementLevel || 0
            });
        }
    }

    // Extract food slots (combat)
    playerObj.food = {
        '/action_types/combat': []
    };
    const foodSlots = characterObj.actionTypeFoodSlotsMap?.['/action_types/combat'] || [];
    for (let i = 0; i < 3; i++) {
        const food = foodSlots[i];
        playerObj.food['/action_types/combat'].push({
            itemHrid: food?.itemHrid || ''
        });
    }

    // Extract drink slots (combat)
    playerObj.drinks = {
        '/action_types/combat': []
    };
    const drinkSlots = characterObj.actionTypeDrinkSlotsMap?.['/action_types/combat'] || [];
    for (let i = 0; i < 3; i++) {
        const drink = drinkSlots[i];
        playerObj.drinks['/action_types/combat'].push({
            itemHrid: drink?.itemHrid || ''
        });
    }

    // Extract equipped abilities (special + 4 normal)
    playerObj.abilities = [];

    // Initialize with 5 blank slots
    for (let i = 0; i < 5; i++) {
        playerObj.abilities.push({
            abilityHrid: '',
            level: '1'
        });
    }

    // Fill with actual equipped abilities
    const equippedAbilities = characterObj.combatUnit?.combatAbilities || [];
    let normalAbilityIndex = 1;

    for (const ability of equippedAbilities) {
        if (!ability || !ability.abilityHrid) continue;

        // Check if special ability (if clientObj available)
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

    // Extract trigger maps (ability + consumable triggers)
    playerObj.triggerMap = {
        ...(characterObj.abilityCombatTriggersMap || {}),
        ...(characterObj.consumableCombatTriggersMap || {})
    };

    // Extract house room levels (all 17 houses)
    playerObj.houseRooms = {};
    const houseRoomMap = characterObj.characterHouseRoomMap || {};
    for (const house of Object.values(houseRoomMap)) {
        playerObj.houseRooms[house.houseRoomHrid] = house.level || 0;
    }

    // Ensure all 17 house rooms exist (fill missing with 0)
    const allHouseRooms = [
        '/house_rooms/dairy_barn',
        '/house_rooms/garden',
        '/house_rooms/log_shed',
        '/house_rooms/forge',
        '/house_rooms/workshop',
        '/house_rooms/sewing_parlor',
        '/house_rooms/kitchen',
        '/house_rooms/brewery',
        '/house_rooms/laboratory',
        '/house_rooms/observatory',
        '/house_rooms/dining_room',
        '/house_rooms/library',
        '/house_rooms/dojo',
        '/house_rooms/gym',
        '/house_rooms/armory',
        '/house_rooms/archery_range',
        '/house_rooms/mystical_study'
    ];

    for (const roomHrid of allHouseRooms) {
        if (!(roomHrid in playerObj.houseRooms)) {
            playerObj.houseRooms[roomHrid] = 0;
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

    // Blank player template
    const BLANK_PLAYER = {
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
        food: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] },
        drinks: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] },
        abilities: [
            { abilityHrid: '', level: '1' },
            { abilityHrid: '', level: '1' },
            { abilityHrid: '', level: '1' },
            { abilityHrid: '', level: '1' },
            { abilityHrid: '', level: '1' }
        ],
        triggerMap: {},
        houseRooms: {
            '/house_rooms/dairy_barn': 0,
            '/house_rooms/garden': 0,
            '/house_rooms/log_shed': 0,
            '/house_rooms/forge': 0,
            '/house_rooms/workshop': 0,
            '/house_rooms/sewing_parlor': 0,
            '/house_rooms/kitchen': 0,
            '/house_rooms/brewery': 0,
            '/house_rooms/laboratory': 0,
            '/house_rooms/observatory': 0,
            '/house_rooms/dining_room': 0,
            '/house_rooms/library': 0,
            '/house_rooms/dojo': 0,
            '/house_rooms/gym': 0,
            '/house_rooms/armory': 0,
            '/house_rooms/archery_range': 0,
            '/house_rooms/mystical_study': 0
        }
    };

    const exportObj = {};
    const playerIDs = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
    const importedPlayerPositions = [false, false, false, false, false];
    let zone = '/actions/combat/fly';
    let isZoneDungeon = false;
    let isParty = false;

    // Check if in party
    const hasParty = characterObj.partyInfo?.partySlotMap;

    if (!hasParty) {
        // === SOLO MODE ===
        console.log('[Combat Sim Export] Exporting solo character');

        // Slot 1: Your character
        exportObj[1] = constructPlayerObject(characterObj, clientObj);
        playerIDs[0] = characterObj.character?.name || 'Player 1';
        importedPlayerPositions[0] = true;

        // Slots 2-5: Blank
        for (let i = 2; i <= 5; i++) {
            exportObj[i] = { ...BLANK_PLAYER };
        }

        // Get current combat zone
        for (const action of characterObj.characterActions || []) {
            if (action && action.actionHrid.includes('/actions/combat/')) {
                zone = action.actionHrid;
                isZoneDungeon = clientObj?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
                break;
            }
        }
    } else {
        // === PARTY MODE ===
        console.log('[Combat Sim Export] Exporting party');
        isParty = true;

        // Fill blank slots first
        for (let i = 1; i <= 5; i++) {
            exportObj[i] = { ...BLANK_PLAYER };
        }

        // Fill actual party members
        let slotIndex = 1;
        for (const member of Object.values(characterObj.partyInfo.partySlotMap)) {
            if (member.characterID) {
                if (member.characterID === characterObj.character.id) {
                    // This is you
                    exportObj[slotIndex] = constructPlayerObject(characterObj, clientObj);
                    playerIDs[slotIndex - 1] = characterObj.character?.name || `Player ${slotIndex}`;
                    importedPlayerPositions[slotIndex - 1] = true;
                } else {
                    // Party member - try to get from battle data
                    if (battleObj && battleObj.players) {
                        const battlePlayer = battleObj.players.find(p => p.character?.id === member.characterID);
                        if (battlePlayer) {
                            // Extract party member data from battle snapshot
                            exportObj[slotIndex] = constructPartyMemberFromBattle(battlePlayer, clientObj);
                            playerIDs[slotIndex - 1] = battlePlayer.character?.name || `Player ${slotIndex}`;
                            importedPlayerPositions[slotIndex - 1] = true;
                        } else {
                            console.warn(`[Combat Sim Export] No battle data for party member ${member.characterID}`);
                            playerIDs[slotIndex - 1] = 'Unknown Player';
                        }
                    } else {
                        console.warn('[Combat Sim Export] No battle data available for party members');
                        playerIDs[slotIndex - 1] = 'Refresh in combat';
                    }
                }
            }
            slotIndex++;
        }

        // Get party zone
        zone = characterObj.partyInfo?.party?.actionHrid || '/actions/combat/fly';
        isZoneDungeon = clientObj?.actionDetailMap?.[zone]?.combatZoneInfo?.isDungeon || false;
    }

    return {
        exportObj,
        playerIDs,
        importedPlayerPositions,
        zone,
        isZoneDungeon,
        isParty
    };
}

/**
 * Construct party member data from battle snapshot
 * @param {Object} battlePlayer - Player data from new_battle message
 * @param {Object} clientObj - Client data (optional)
 * @returns {Object} Player export object
 */
function constructPartyMemberFromBattle(battlePlayer, clientObj) {
    const playerObj = {};
    playerObj.player = {};

    // Extract levels from combatDetails
    const combatDetails = battlePlayer.combatDetails || {};
    playerObj.player.attackLevel = combatDetails.attackLevel || 1;
    playerObj.player.magicLevel = combatDetails.magicLevel || 1;
    playerObj.player.meleeLevel = combatDetails.meleeLevel || 1;
    playerObj.player.rangedLevel = combatDetails.rangedLevel || 1;
    playerObj.player.defenseLevel = combatDetails.defenseLevel || 1;
    playerObj.player.staminaLevel = combatDetails.staminaLevel || 1;
    playerObj.player.intelligenceLevel = combatDetails.intelligenceLevel || 1;

    // Extract equipment
    playerObj.player.equipment = [];
    const equipment = battlePlayer.equipmentDetails?.equipment || [];
    for (const item of equipment) {
        playerObj.player.equipment.push({
            itemLocationHrid: item.itemLocationHrid,
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0
        });
    }

    // Extract consumables (food/drinks)
    playerObj.food = { '/action_types/combat': [] };
    playerObj.drinks = { '/action_types/combat': [] };

    const foodItems = battlePlayer.consumableDetails?.foodItems || [];
    const drinkItems = battlePlayer.consumableDetails?.drinkItems || [];

    for (let i = 0; i < 3; i++) {
        playerObj.food['/action_types/combat'].push({
            itemHrid: foodItems[i]?.itemHrid || ''
        });
        playerObj.drinks['/action_types/combat'].push({
            itemHrid: drinkItems[i]?.itemHrid || ''
        });
    }

    // Extract abilities
    playerObj.abilities = [];
    for (let i = 0; i < 5; i++) {
        playerObj.abilities.push({ abilityHrid: '', level: '1' });
    }

    const combatAbilities = battlePlayer.combatDetails?.combatAbilities || [];
    let normalAbilityIndex = 1;

    for (const ability of combatAbilities) {
        if (!ability || !ability.abilityHrid) continue;

        const isSpecial = clientObj?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

        if (isSpecial) {
            playerObj.abilities[0] = {
                abilityHrid: ability.abilityHrid,
                level: String(ability.level || 1)
            };
        } else if (normalAbilityIndex < 5) {
            playerObj.abilities[normalAbilityIndex++] = {
                abilityHrid: ability.abilityHrid,
                level: String(ability.level || 1)
            };
        }
    }

    // Trigger maps (may not be available for party members)
    playerObj.triggerMap = {};

    // House rooms (use blank/default for party members)
    playerObj.houseRooms = {
        '/house_rooms/dairy_barn': 0,
        '/house_rooms/garden': 0,
        '/house_rooms/log_shed': 0,
        '/house_rooms/forge': 0,
        '/house_rooms/workshop': 0,
        '/house_rooms/sewing_parlor': 0,
        '/house_rooms/kitchen': 0,
        '/house_rooms/brewery': 0,
        '/house_rooms/laboratory': 0,
        '/house_rooms/observatory': 0,
        '/house_rooms/dining_room': 0,
        '/house_rooms/library': 0,
        '/house_rooms/dojo': 0,
        '/house_rooms/gym': 0,
        '/house_rooms/armory': 0,
        '/house_rooms/archery_range': 0,
        '/house_rooms/mystical_study': 0
    };

    return playerObj;
}
