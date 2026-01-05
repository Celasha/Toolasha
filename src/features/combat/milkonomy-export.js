/**
 * Milkonomy Export Module
 * Constructs player data in Milkonomy format for external tools
 */

import dataManager from '../../core/data-manager.js';

/**
 * Get character data from GM storage
 * @returns {Object|null} Character data or null
 */
function getCharacterData() {
    try {
        if (typeof GM_getValue === 'undefined') {
            console.error('[Milkonomy Export] GM_getValue not available');
            return null;
        }

        const data = GM_getValue('toolasha_init_character_data', null);
        if (!data) {
            console.error('[Milkonomy Export] No character data found');
            return null;
        }

        return JSON.parse(data);
    } catch (error) {
        console.error('[Milkonomy Export] Failed to get character data:', error);
        return null;
    }
}

/**
 * Map equipment slot types to Milkonomy format
 * @param {string} slotType - Game slot type
 * @returns {string} Milkonomy slot name
 */
function mapSlotType(slotType) {
    const mapping = {
        '/equipment_types/milking_tool': 'milking_tool',
        '/equipment_types/foraging_tool': 'foraging_tool',
        '/equipment_types/woodcutting_tool': 'woodcutting_tool',
        '/equipment_types/cheesesmithing_tool': 'cheesesmithing_tool',
        '/equipment_types/crafting_tool': 'crafting_tool',
        '/equipment_types/tailoring_tool': 'tailoring_tool',
        '/equipment_types/cooking_tool': 'cooking_tool',
        '/equipment_types/brewing_tool': 'brewing_tool',
        '/equipment_types/alchemy_tool': 'alchemy_tool',
        '/equipment_types/enhancing_tool': 'enhancing_tool',
        '/equipment_types/legs': 'legs',
        '/equipment_types/body': 'body',
        '/equipment_types/charm': 'charm',
        '/equipment_types/off_hand': 'off_hand',
        '/equipment_types/head': 'head',
        '/equipment_types/hands': 'hands',
        '/equipment_types/feet': 'feet',
        '/equipment_types/neck': 'neck',
        '/equipment_types/earrings': 'earrings',
        '/equipment_types/ring': 'ring',
        '/equipment_types/pouch': 'pouch'
    };
    return mapping[slotType] || slotType;
}

/**
 * Get skill level by action type
 * @param {Array} skills - Character skills array
 * @param {string} actionType - Action type HRID (e.g., '/action_types/milking')
 * @returns {number} Skill level
 */
function getSkillLevel(skills, actionType) {
    const skillHrid = actionType.replace('/action_types/', '/skills/');
    const skill = skills.find(s => s.skillHrid === skillHrid);
    return skill?.level || 1;
}

/**
 * Map item location HRID to equipment slot type HRID
 * @param {string} locationHrid - Item location HRID (e.g., '/item_locations/brewing_tool')
 * @returns {string|null} Equipment slot type HRID or null
 */
function locationToSlotType(locationHrid) {
    // Map item locations to equipment slot types
    // Location format: /item_locations/X
    // Slot type format: /equipment_types/X
    if (!locationHrid || !locationHrid.startsWith('/item_locations/')) {
        return null;
    }

    const slotName = locationHrid.replace('/item_locations/', '');
    return `/equipment_types/${slotName}`;
}

/**
 * Check if an item has stats for a specific skill
 * @param {Object} itemDetail - Item detail from game data
 * @param {string} skillName - Skill name (e.g., 'brewing', 'enhancing')
 * @returns {boolean} True if item has stats for this skill
 */
function itemHasSkillStats(itemDetail, skillName) {
    if (!itemDetail || !itemDetail.equipmentDetail || !itemDetail.equipmentDetail.noncombatStats) {
        return false;
    }

    const stats = itemDetail.equipmentDetail.noncombatStats;

    // Check if any stat key contains the skill name (e.g., brewingSpeed, brewingEfficiency, brewingRareFind)
    for (const statKey of Object.keys(stats)) {
        if (statKey.toLowerCase().startsWith(skillName.toLowerCase())) {
            return true;
        }
    }

    return false;
}

/**
 * Get best equipment for a specific skill and slot from entire inventory
 * @param {Array} inventory - Full inventory array from dataManager
 * @param {Object} gameData - Game data (initClientData)
 * @param {string} skillName - Skill name (e.g., 'brewing', 'enhancing')
 * @param {string} slotType - Equipment slot type (e.g., '/equipment_types/brewing_tool')
 * @returns {Object} Equipment object or empty object with just type
 */
function getBestEquipmentForSkill(inventory, gameData, skillName, slotType) {
    if (!inventory || !gameData || !gameData.itemDetailMap) {
        return { type: mapSlotType(slotType) };
    }

    // Filter inventory for matching items
    const matchingItems = [];

    for (const invItem of inventory) {
        // Skip items without HRID
        if (!invItem.itemHrid) {
            continue;
        }

        const itemDetail = gameData.itemDetailMap[invItem.itemHrid];

        // Skip non-equipment items (resources, consumables, etc.)
        if (!itemDetail || !itemDetail.equipmentDetail) {
            continue;
        }

        // Check if item matches the slot type
        const itemSlotType = itemDetail.equipmentDetail.type;
        if (itemSlotType !== slotType) {
            continue;
        }

        // Check if item has stats for this skill
        if (!itemHasSkillStats(itemDetail, skillName)) {
            continue;
        }

        // Item matches! Add to candidates
        matchingItems.push({
            hrid: invItem.itemHrid,
            enhancementLevel: invItem.enhancementLevel || 0,
            name: itemDetail.name
        });
    }

    // Sort by enhancement level (descending) and pick the best
    if (matchingItems.length > 0) {
        matchingItems.sort((a, b) => b.enhancementLevel - a.enhancementLevel);
        const best = matchingItems[0];

        const equipment = {
            type: mapSlotType(slotType),
            hrid: best.hrid
        };

        // Only include enhanceLevel if the item can be enhanced (has the field)
        if (typeof best.enhancementLevel === 'number') {
            equipment.enhanceLevel = best.enhancementLevel > 0 ? best.enhancementLevel : null;
        }

        return equipment;
    }

    // No matching equipment found
    return { type: mapSlotType(slotType) };
}

/**
 * Get house room level for action type
 * @param {string} actionType - Action type HRID
 * @returns {number} House room level
 */
function getHouseLevel(actionType) {
    const roomMapping = {
        '/action_types/milking': '/house_rooms/dairy_barn',
        '/action_types/foraging': '/house_rooms/garden',
        '/action_types/woodcutting': '/house_rooms/log_shed',
        '/action_types/cheesesmithing': '/house_rooms/forge',
        '/action_types/crafting': '/house_rooms/workshop',
        '/action_types/tailoring': '/house_rooms/sewing_parlor',
        '/action_types/cooking': '/house_rooms/kitchen',
        '/action_types/brewing': '/house_rooms/brewery',
        '/action_types/alchemy': '/house_rooms/laboratory',
        '/action_types/enhancing': '/house_rooms/observatory'
    };

    const roomHrid = roomMapping[actionType];
    if (!roomHrid) return 0;

    return dataManager.getHouseRoomLevel(roomHrid) || 0;
}

/**
 * Get active teas for action type
 * @param {string} actionType - Action type HRID
 * @returns {Array} Array of tea item HRIDs
 */
function getActiveTeas(actionType) {
    const drinkSlots = dataManager.getActionDrinkSlots(actionType);
    if (!drinkSlots || drinkSlots.length === 0) return [];

    return drinkSlots
        .filter(slot => slot && slot.itemHrid)
        .map(slot => slot.itemHrid);
}

/**
 * Construct action config for a skill
 * @param {string} skillName - Skill name (e.g., 'milking')
 * @param {Object} skills - Character skills array
 * @param {Array} inventory - Full inventory array
 * @param {Object} gameData - Game data (initClientData)
 * @returns {Object} Action config object
 */
function constructActionConfig(skillName, skills, inventory, gameData) {
    const actionType = `/action_types/${skillName}`;
    const toolType = `/equipment_types/${skillName}_tool`;
    const legsType = '/equipment_types/legs';
    const bodyType = '/equipment_types/body';
    const charmType = '/equipment_types/charm';

    return {
        action: skillName,
        playerLevel: getSkillLevel(skills, actionType),
        tool: getBestEquipmentForSkill(inventory, gameData, skillName, toolType),
        legs: getBestEquipmentForSkill(inventory, gameData, skillName, legsType),
        body: getBestEquipmentForSkill(inventory, gameData, skillName, bodyType),
        charm: getBestEquipmentForSkill(inventory, gameData, skillName, charmType),
        houseLevel: getHouseLevel(actionType),
        tea: getActiveTeas(actionType)
    };
}

/**
 * Get equipment from currently equipped items (for special slots)
 * Only includes items that have noncombat (skilling) stats
 * @param {Map} equipmentMap - Currently equipped items map
 * @param {Object} gameData - Game data (initClientData)
 * @param {string} slotType - Equipment slot type (e.g., '/equipment_types/off_hand')
 * @returns {Object} Equipment object or empty object with just type
 */
function getEquippedItem(equipmentMap, gameData, slotType) {
    for (const [locationHrid, item] of equipmentMap) {
        // Derive the slot type from the location HRID
        const itemSlotType = locationToSlotType(locationHrid);

        if (itemSlotType === slotType) {
            // Check if item has any noncombat (skilling) stats
            const itemDetail = gameData.itemDetailMap[item.itemHrid];
            if (!itemDetail || !itemDetail.equipmentDetail) {
                // Skip items we can't look up
                continue;
            }

            const noncombatStats = itemDetail.equipmentDetail.noncombatStats;
            if (!noncombatStats || Object.keys(noncombatStats).length === 0) {
                // Item has no skilling stats (combat-only like Cheese Buckler) - skip it
                continue;
            }

            // Item has skilling stats - include it
            const equipment = {
                type: mapSlotType(slotType),
                hrid: item.itemHrid
            };

            // Only include enhanceLevel if the item has an enhancement level field
            if (typeof item.enhancementLevel === 'number') {
                equipment.enhanceLevel = item.enhancementLevel > 0 ? item.enhancementLevel : null;
            }

            return equipment;
        }
    }

    // No equipment in this slot (or only combat-only items)
    return { type: mapSlotType(slotType) };
}

/**
 * Construct Milkonomy export object
 * @returns {Object|null} Milkonomy export data or null
 */
export function constructMilkonomyExport() {
    try {
        const characterData = getCharacterData();
        if (!characterData) {
            console.error('[Milkonomy Export] No character data available');
            return null;
        }

        const skills = characterData.characterSkills || [];
        const inventory = dataManager.getInventory();
        const equipmentMap = dataManager.getEquipment();
        const gameData = dataManager.getInitClientData();

        if (!inventory) {
            console.error('[Milkonomy Export] No inventory data available');
            return null;
        }

        if (!gameData) {
            console.error('[Milkonomy Export] No game data available');
            return null;
        }

        // Character name and color
        const name = characterData.name || 'Player';
        const color = '#90ee90'; // Default color (light green)

        // Build action config map for all 10 skills
        const skillNames = [
            'milking',
            'foraging',
            'woodcutting',
            'cheesesmithing',
            'crafting',
            'tailoring',
            'cooking',
            'brewing',
            'alchemy',
            'enhancing'
        ];

        const actionConfigMap = {};
        for (const skillName of skillNames) {
            actionConfigMap[skillName] = constructActionConfig(skillName, skills, inventory, gameData);
        }

        // Build special equipment map (non-skill-specific equipment)
        // Use currently equipped items for these slots
        const specialEquipmentMap = {};
        const specialSlots = [
            '/equipment_types/off_hand',
            '/equipment_types/head',
            '/equipment_types/hands',
            '/equipment_types/feet',
            '/equipment_types/neck',
            '/equipment_types/earrings',
            '/equipment_types/ring',
            '/equipment_types/pouch'
        ];

        for (const slotType of specialSlots) {
            const slotName = mapSlotType(slotType);
            const equipment = getEquippedItem(equipmentMap, gameData, slotType);
            if (equipment.hrid) {
                specialEquipmentMap[slotName] = equipment;
            } else {
                specialEquipmentMap[slotName] = { type: slotName };
            }
        }

        // Build community buff map
        const communityBuffMap = {};
        const buffTypes = [
            'experience',
            'gathering_quantity',
            'production_efficiency',
            'enhancing_speed'
        ];

        for (const buffType of buffTypes) {
            const buffHrid = `/community_buff_types/${buffType}`;
            const level = dataManager.getCommunityBuffLevel(buffHrid) || 0;
            communityBuffMap[buffType] = {
                type: buffType,
                hrid: buffHrid,
                level: level
            };
        }

        // Construct final export object
        return {
            name,
            color,
            actionConfigMap,
            specialEquimentMap: specialEquipmentMap,
            communityBuffMap
        };

    } catch (error) {
        console.error('[Milkonomy Export] Export construction failed:', error);
        return null;
    }
}
