/**
 * House Cost Calculator Utility
 * Calculates the total cost to build house rooms to specific levels
 * Used for combat score calculation
 */

import dataManager from '../core/data-manager.js';
import marketAPI from '../api/marketplace.js';
import marketValuesAPI from '../api/market-values.js';
import { getItemPriceOutlierInfo } from './market-data.js';

/**
 * Calculate the total cost to build a house room to a specific level
 * @param {string} houseRoomHrid - House room HRID (e.g., '/house_rooms/dojo')
 * @param {number} currentLevel - Target level (1-8)
 * @returns {{cost: number, isOutlier: boolean}} Total build cost in coins, and whether any
 *   contributing material price was substituted by the market-data outlier guard
 */
export function calculateHouseBuildCost(houseRoomHrid, currentLevel) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return { cost: 0, isOutlier: false };

    const houseRoomDetailMap = gameData.houseRoomDetailMap;
    if (!houseRoomDetailMap) return { cost: 0, isOutlier: false };

    const houseDetail = houseRoomDetailMap[houseRoomHrid];
    if (!houseDetail) return { cost: 0, isOutlier: false };

    const upgradeCostsMap = houseDetail.upgradeCostsMap;
    if (!upgradeCostsMap) return { cost: 0, isOutlier: false };

    let totalCost = 0;
    let isOutlier = false;

    // Sum costs for all levels from 1 to current
    for (let level = 1; level <= currentLevel; level++) {
        const levelUpgrades = upgradeCostsMap[level];
        if (!levelUpgrades) continue;

        // Add cost for each material required at this level
        for (const item of levelUpgrades) {
            // Special case: Coins have face value of 1 (no market price)
            if (item.itemHrid === '/items/coin') {
                const itemCost = item.count * 1;
                totalCost += itemCost;
                continue;
            }

            const rawPrices = marketAPI.getPrice(item.itemHrid, 0);
            if (!rawPrices) continue;

            // Match MCS behavior: if one price is positive and other is negative, use positive for both
            let ask = rawPrices.ask;
            let bid = rawPrices.bid;

            if (ask > 0 && bid < 0) {
                bid = ask;
            }
            if (bid > 0 && ask < 0) {
                ask = bid;
            }

            const askResult = marketValuesAPI.checkOutlier(item.itemHrid, 0, ask);
            const bidResult = marketValuesAPI.checkOutlier(item.itemHrid, 0, bid);
            if (askResult.isOutlier || bidResult.isOutlier) {
                isOutlier = true;
            }

            // Use weighted average
            const weightedPrice = (askResult.value + bidResult.value) / 2;

            const itemCost = item.count * weightedPrice;
            totalCost += itemCost;
        }
    }

    return { cost: totalCost, isOutlier };
}

/**
 * Calculate total cost for all battle houses
 * @param {Object} characterHouseRooms - Map of character house rooms from profile data
 * @returns {Object} {totalCost, breakdown: [{name, level, cost, isOutlier}]}
 */
export function calculateBattleHousesCost(characterHouseRooms) {
    const battleHouses = ['dining_room', 'library', 'dojo', 'gym', 'armory', 'archery_range', 'mystical_study'];

    const gameData = dataManager.getInitClientData();
    if (!gameData) return { totalCost: 0, breakdown: [] };

    const houseRoomDetailMap = gameData.houseRoomDetailMap;
    if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

    let totalCost = 0;
    const breakdown = [];

    for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
        // Check if this is a battle house
        const isBattleHouse = battleHouses.some((battleHouse) => houseRoomHrid.includes(battleHouse));

        if (!isBattleHouse) continue;

        const level = houseData.level || 0;
        if (level === 0) continue;

        const { cost, isOutlier } = calculateHouseBuildCost(houseRoomHrid, level);
        totalCost += cost;

        // Get human-readable name
        const houseDetail = houseRoomDetailMap[houseRoomHrid];
        const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

        breakdown.push({
            name: houseName,
            level: level,
            cost: cost,
            isOutlier,
        });
    }

    // Sort by cost descending
    breakdown.sort((a, b) => b.cost - a.cost);

    return { totalCost, breakdown };
}

/**
 * Determine whether a house room is Combat or Skiller domain, from actual game data
 * (`usableInActionTypeMap`) rather than a hardcoded room-name list (TLA-041 / PB-08).
 * @param {string} houseRoomHrid - House room HRID
 * @returns {'combat'|'skilling'|null} null if the room is unknown
 */
export function getHouseRoomDomain(houseRoomHrid) {
    const gameData = dataManager.getInitClientData();
    const houseDetail = gameData?.houseRoomDetailMap?.[houseRoomHrid];
    if (!houseDetail) return null;

    const usableInActionTypeMap = houseDetail.usableInActionTypeMap || {};
    return usableInActionTypeMap['/action_types/combat'] ? 'combat' : 'skilling';
}

/**
 * Calculate the cost to build a house room to a specific level using pure Ask pricing
 * (never `(ask+bid)/2` — TLA-041 / F-10). A required material with no positive Ask marks the
 * whole room incomplete instead of silently contributing 0.
 * @param {string} houseRoomHrid - House room HRID
 * @param {number} currentLevel - Target level
 * @returns {{cost: number, complete: boolean, isOutlier: boolean}}
 */
export function calculateHouseRoomCostAskOnly(houseRoomHrid, currentLevel) {
    const gameData = dataManager.getInitClientData();
    const upgradeCostsMap = gameData?.houseRoomDetailMap?.[houseRoomHrid]?.upgradeCostsMap;
    if (!upgradeCostsMap) return { cost: 0, complete: false, isOutlier: false };

    let cost = 0;
    let complete = true;
    let isOutlier = false;

    for (let level = 1; level <= currentLevel; level++) {
        const levelUpgrades = upgradeCostsMap[level];
        if (!levelUpgrades) {
            complete = false;
            continue;
        }

        for (const item of levelUpgrades) {
            if (item.itemHrid === '/items/coin') {
                cost += item.count;
                continue;
            }

            const askInfo = getItemPriceOutlierInfo(item.itemHrid, { mode: 'ask' });
            if (!(askInfo.value > 0)) {
                complete = false;
                continue;
            }
            if (askInfo.isOutlier) isOutlier = true;
            cost += item.count * askInfo.value;
        }
    }

    return { cost, complete, isOutlier };
}

/**
 * Sum Ask-only build cost across every owned room in the given domain.
 * @param {Object} characterHouseRooms - Map of character house rooms from profile data
 * @param {'combat'|'skilling'} domain
 * @returns {{totalCost: number, complete: boolean, breakdown: Array<{name: string, level: number, cost: number, isOutlier: boolean}>}}
 */
export function calculateHousesCostByDomain(characterHouseRooms, domain) {
    const gameData = dataManager.getInitClientData();
    const houseRoomDetailMap = gameData?.houseRoomDetailMap || {};

    let totalCost = 0;
    let complete = true;
    const breakdown = [];

    for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms || {})) {
        const level = houseData.level || 0;
        if (level === 0) continue;
        if (getHouseRoomDomain(houseRoomHrid) !== domain) continue;

        const { cost, complete: roomComplete, isOutlier } = calculateHouseRoomCostAskOnly(houseRoomHrid, level);
        totalCost += cost;
        complete = complete && roomComplete;

        const houseName = houseRoomDetailMap[houseRoomHrid]?.name || houseRoomHrid.replace('/house_rooms/', '');
        breakdown.push({ name: houseName, level, cost, complete: roomComplete, isOutlier });
    }

    breakdown.sort((a, b) => b.cost - a.cost);
    return { totalCost, complete, breakdown };
}
