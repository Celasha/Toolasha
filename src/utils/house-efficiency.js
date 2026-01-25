/**
 * House Efficiency Utility
 * Calculates efficiency bonuses from house rooms
 *
 * PART OF EFFICIENCY SYSTEM (Phase 2):
 * - House rooms provide +1.5% efficiency per level to matching actions
 * - Formula: houseLevel × 1.5%
 * - Data source: WebSocket (characterHouseRoomMap)
 */

import dataManager from '../core/data-manager.js';

/**
 * Map action type HRID to house room HRID
 * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
 * @returns {string|null} House room HRID or null
 */
function getHouseRoomForActionType(actionTypeHrid) {
    // Mapping matches original MWI Tools
    const actionTypeToHouseRoomMap = {
        '/action_types/brewing': '/house_rooms/brewery',
        '/action_types/cheesesmithing': '/house_rooms/forge',
        '/action_types/cooking': '/house_rooms/kitchen',
        '/action_types/crafting': '/house_rooms/workshop',
        '/action_types/foraging': '/house_rooms/garden',
        '/action_types/milking': '/house_rooms/dairy_barn',
        '/action_types/tailoring': '/house_rooms/sewing_parlor',
        '/action_types/woodcutting': '/house_rooms/log_shed',
        '/action_types/alchemy': '/house_rooms/laboratory',
    };

    return actionTypeToHouseRoomMap[actionTypeHrid] || null;
}

/**
 * Calculate house efficiency bonus for an action type
 * @param {string} actionTypeHrid - Action type HRID
 * @returns {number} Efficiency bonus percentage (e.g., 12 for 12%)
 *
 * @example
 * calculateHouseEfficiency("/action_types/brewing")
 * // Returns: 12 (if brewery is level 8: 8 × 1.5% = 12%)
 */
export function calculateHouseEfficiency(actionTypeHrid) {
    // Get the house room for this action type
    const houseRoomHrid = getHouseRoomForActionType(actionTypeHrid);

    if (!houseRoomHrid) {
        return 0; // No house room for this action type
    }

    // Get house room level from game data (via dataManager)
    const roomLevel = dataManager.getHouseRoomLevel(houseRoomHrid);

    // Formula: houseLevel × 1.5%
    // Returns as percentage (e.g., 12 for 12%)
    return roomLevel * 1.5;
}

/**
 * Get friendly name for house room
 * @param {string} houseRoomHrid - House room HRID
 * @returns {string} Friendly name
 */
export function getHouseRoomName(houseRoomHrid) {
    const names = {
        '/house_rooms/brewery': 'Brewery',
        '/house_rooms/forge': 'Forge',
        '/house_rooms/kitchen': 'Kitchen',
        '/house_rooms/workshop': 'Workshop',
        '/house_rooms/garden': 'Garden',
        '/house_rooms/dairy_barn': 'Dairy Barn',
        '/house_rooms/sewing_parlor': 'Sewing Parlor',
        '/house_rooms/log_shed': 'Log Shed',
        '/house_rooms/laboratory': 'Laboratory',
    };

    return names[houseRoomHrid] || 'Unknown';
}

/**
 * Calculate total Rare Find bonus from all house rooms
 * @returns {number} Total rare find bonus as percentage (e.g., 1.6 for 1.6%)
 *
 * @example
 * calculateHouseRareFind()
 * // Returns: 1.6 (if total house room levels = 8: 8 × 0.2% per level = 1.6%)
 *
 * Formula from game data:
 * - flatBoostLevelBonus: 0.2% per level
 * - Total: totalLevels × 0.2%
 * - Max: 8 rooms × 8 levels = 64 × 0.2% = 12.8%
 */
export function calculateHouseRareFind() {
    // Get all house rooms
    const houseRooms = dataManager.getHouseRooms();

    if (!houseRooms || houseRooms.size === 0) {
        return 0; // No house rooms
    }

    // Sum all house room levels
    let totalLevels = 0;
    for (const [_hrid, room] of houseRooms) {
        totalLevels += room.level || 0;
    }

    // Formula: totalLevels × flatBoostLevelBonus
    // flatBoostLevelBonus: 0.2% per level (no base bonus)
    const flatBoostLevelBonus = 0.2;

    return totalLevels * flatBoostLevelBonus;
}

export default {
    calculateHouseEfficiency,
    getHouseRoomName,
    calculateHouseRareFind,
};
