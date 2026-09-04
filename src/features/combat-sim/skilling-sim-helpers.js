/**
 * Skilling Sim Helpers
 * Pure functions that convert editor state into buff arrays
 * for use with LabyrinthClearRate.getSkillingMetricsFromOverrides().
 */

import {
    parseEquipmentSpeedBonuses,
    parseEquipmentEfficiencyBonuses,
    parseEquipmentSuccessBonuses,
} from '../../utils/equipment-parser.js';

const PRODUCTION_SKILLS = [
    '/action_types/alchemy',
    '/action_types/brewing',
    '/action_types/cheesesmithing',
    '/action_types/cooking',
    '/action_types/crafting',
    '/action_types/tailoring',
];

const GATHERING_SKILLS = ['/action_types/foraging', '/action_types/milking', '/action_types/woodcutting'];

/**
 * Convert editor equipment DTO format to the Map format the equipment parser expects.
 * DTO: { '/equipment_types/body': { hrid, enhancementLevel } }
 * Parser: Map<'/item_locations/body', { itemHrid, enhancementLevel }>
 * @param {Object} editorEquipment - Equipment from DTO
 * @returns {Map}
 */
function toEquipmentMap(editorEquipment) {
    const map = new Map();
    for (const [slot, item] of Object.entries(editorEquipment || {})) {
        if (!item?.hrid) continue;
        const locationKey = slot.replace('/equipment_types/', '/item_locations/');
        map.set(locationKey, { itemHrid: item.hrid, enhancementLevel: item.enhancementLevel || 0 });
    }
    return map;
}

/**
 * Build equipment buff array for a specific action type from editor equipment.
 * @param {Object} editorEquipment - { '/equipment_types/body': { hrid, enhancementLevel } }
 * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
 * @param {Object} itemDetailMap - From gameData
 * @returns {Array} Buff objects compatible with getSkillingMetricsFromOverrides()
 */
export function buildEquipmentBuffsForSkill(editorEquipment, actionTypeHrid, itemDetailMap) {
    const equipMap = toEquipmentMap(editorEquipment);
    const buffs = [];

    const speedBonus = parseEquipmentSpeedBonuses(equipMap, actionTypeHrid, itemDetailMap);
    if (speedBonus > 0) {
        buffs.push({ typeHrid: '/buff_types/action_speed', flatBoost: speedBonus, ratioBoost: 0 });
    }

    const efficiencyBonus = parseEquipmentEfficiencyBonuses(equipMap, actionTypeHrid, itemDetailMap);
    if (efficiencyBonus > 0) {
        buffs.push({ typeHrid: '/buff_types/efficiency', flatBoost: efficiencyBonus / 100, ratioBoost: 0 });
    }

    const successBonus = parseEquipmentSuccessBonuses(equipMap, actionTypeHrid, itemDetailMap);
    if (successBonus > 0) {
        const skillId = actionTypeHrid.replace('/action_types/', '');
        buffs.push({ typeHrid: `/buff_types/${skillId}_success`, flatBoost: 0, ratioBoost: successBonus });
    }

    return buffs;
}

/**
 * Build community buff array for a specific action type from editor levels.
 * @param {Object} communityBuffLevels - { productionEfficiency, enhancingSpeed, gatheringQuantity, experience }
 * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
 * @returns {Array} Buff objects
 */
export function buildCommunityBuffsForSkill(communityBuffLevels, actionTypeHrid) {
    const buffs = [];
    if (!communityBuffLevels) return buffs;

    if (PRODUCTION_SKILLS.includes(actionTypeHrid) && communityBuffLevels.productionEfficiency > 0) {
        const level = communityBuffLevels.productionEfficiency;
        const value = 0.14 + (level - 1) * 0.003;
        buffs.push({ typeHrid: '/buff_types/efficiency', flatBoost: value, ratioBoost: 0 });
    }

    if (actionTypeHrid === '/action_types/enhancing' && communityBuffLevels.enhancingSpeed > 0) {
        const level = communityBuffLevels.enhancingSpeed;
        const value = 0.2 + (level - 1) * 0.005;
        buffs.push({ typeHrid: '/buff_types/action_speed', flatBoost: value, ratioBoost: 0 });
    }

    if (GATHERING_SKILLS.includes(actionTypeHrid) && communityBuffLevels.gatheringQuantity > 0) {
        const level = communityBuffLevels.gatheringQuantity;
        const value = 0.2 + (level - 1) * 0.005;
        buffs.push({ typeHrid: '/buff_types/gathering', flatBoost: value, ratioBoost: 0 });
    }

    return buffs;
}

/**
 * Build house buff array for a specific action type from editor house room levels.
 * The game's own houseRoomDetailMap only marks a room's actionBuffs restriction at the room
 * level via `usableInActionTypeMap` - individual buff entries carry no such field - so this
 * checks the room, not the buff.
 * @param {Object} editorHouseRooms - { '/house_rooms/brewery': level, ... }
 * @param {string} actionTypeHrid - e.g. "/action_types/brewing"
 * @param {Object} houseRoomDetailMap - From gameData
 * @returns {Array} Buff objects
 */
export function buildHouseBuffsForSkill(editorHouseRooms, actionTypeHrid, houseRoomDetailMap) {
    const buffs = [];
    if (!editorHouseRooms || !houseRoomDetailMap) return buffs;

    for (const [hrid, level] of Object.entries(editorHouseRooms)) {
        if (!level || level <= 0) continue;
        const roomDetail = houseRoomDetailMap[hrid];
        if (!roomDetail) continue;

        if (Array.isArray(roomDetail.actionBuffs) && roomDetail.usableInActionTypeMap?.[actionTypeHrid]) {
            for (const buff of roomDetail.actionBuffs) {
                const flatBoost = (buff.flatBoostLevelBonus || 0) * level;
                const ratioBoost = (buff.ratioBoostLevelBonus || 0) * level;
                if (flatBoost === 0 && ratioBoost === 0) continue;
                buffs.push({ typeHrid: buff.typeHrid, flatBoost, ratioBoost });
            }
        }

        if (Array.isArray(roomDetail.globalBuffs)) {
            for (const buff of roomDetail.globalBuffs) {
                const flatBoost = (buff.flatBoostLevelBonus || 0) * level;
                const ratioBoost = (buff.ratioBoostLevelBonus || 0) * level;
                if (flatBoost === 0 && ratioBoost === 0) continue;
                buffs.push({ typeHrid: buff.typeHrid, flatBoost, ratioBoost });
            }
        }
    }

    return buffs;
}

/**
 * Build crate buff array from selected crate HRIDs.
 * @param {string[]} crateHrids - Array of crate item HRIDs
 * @param {Object} labyrinthCrateDetailMap - From gameData
 * @returns {Array} Buff objects
 */
export function buildCrateBuffs(crateHrids, labyrinthCrateDetailMap) {
    const allBuffs = [];
    if (!labyrinthCrateDetailMap) return allBuffs;

    for (const hrid of crateHrids || []) {
        if (!hrid) continue;
        const buffs = labyrinthCrateDetailMap[hrid];
        if (Array.isArray(buffs)) {
            allBuffs.push(...buffs);
        }
    }
    return allBuffs;
}

/**
 * Build the full overrides object for a single skill from editor state.
 * @param {Object} editorState - { equipment, houseRooms, tokenUpgrades, communityBuffLevels }
 * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
 * @param {string[]} crateHrids - Selected crate HRIDs
 * @param {Object} gameData - { itemDetailMap, houseRoomDetailMap, labyrinthCrateDetailMap }
 * @returns {Object} Overrides for getSkillingMetricsFromOverrides()
 */
export function buildOverridesForSkill(editorState, actionTypeHrid, crateHrids, gameData) {
    return {
        equipmentBuffs: buildEquipmentBuffsForSkill(editorState.equipment, actionTypeHrid, gameData.itemDetailMap),
        communityBuffs: buildCommunityBuffsForSkill(editorState.communityBuffLevels, actionTypeHrid),
        houseBuffs: buildHouseBuffsForSkill(editorState.houseRooms, actionTypeHrid, gameData.houseRoomDetailMap),
        crateBuffs: buildCrateBuffs(crateHrids, gameData.labyrinthCrateDetailMap),
        tokenUpgrades: editorState.tokenUpgrades,
    };
}
