/**
 * House Efficiency Utility
 * Calculates efficiency bonuses from house rooms
 *
 * PART OF EFFICIENCY SYSTEM (Phase 2):
 * - House rooms provide +1.5% efficiency per level to matching actions
 * - Formula: houseLevel × 1.5%
 */

import config from '../core/config.js';

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
        '/action_types/alchemy': '/house_rooms/laboratory'
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

    // Get house room level from config
    const roomLevel = config.getHouseRoomLevel(houseRoomHrid);

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
        '/house_rooms/laboratory': 'Laboratory'
    };

    return names[houseRoomHrid] || 'Unknown';
}

export default {
    calculateHouseEfficiency,
    getHouseRoomName
};
