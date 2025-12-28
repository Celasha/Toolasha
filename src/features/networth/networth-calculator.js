/**
 * Networth Calculator
 * Calculates total character networth including:
 * - Equipped items
 * - Inventory items
 * - Market listings
 * - Houses (all 17)
 * - Abilities (equipped + others)
 */

import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateAbilityCost } from '../../utils/ability-cost-calculator.js';
import { calculateHouseBuildCost } from '../../utils/house-cost-calculator.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import config from '../../core/config.js';
import networthCache from './networth-cache.js';

/**
 * Calculate the value of a single item
 * @param {Object} item - Item data {itemHrid, enhancementLevel, count}
 * @param {boolean} useAsk - Use ask prices (true) or bid prices (false)
 * @returns {number} Total value in coins
 */
export async function calculateItemValue(item, useAsk = true) {
    const { itemHrid, enhancementLevel = 0, count = 1 } = item;

    let itemValue = 0;

    // For enhanced items (2+), calculate enhancement cost
    if (enhancementLevel >= 2) {
        // Check cache first
        const cachedCost = networthCache.get(itemHrid, enhancementLevel);
        if (cachedCost !== null) {
            itemValue = cachedCost;
        } else {
            // Not in cache, calculate
            const enhancementParams = getEnhancingParams();
            const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

            if (enhancementPath && enhancementPath.optimalStrategy) {
                itemValue = enhancementPath.optimalStrategy.totalCost;
                // Cache the result
                networthCache.set(itemHrid, enhancementLevel, itemValue);
            } else {
                // Fallback to market price if enhancement calculation fails
                itemValue = getMarketPrice(itemHrid, enhancementLevel, useAsk);
            }
        }
    } else {
        // Unenhanced or +1 items use market price
        itemValue = getMarketPrice(itemHrid, enhancementLevel, useAsk);
    }

    return itemValue * count;
}

/**
 * Get market price for an item
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level
 * @param {boolean} useAsk - Use ask price (true) or bid price (false)
 * @returns {number} Price per item
 */
function getMarketPrice(itemHrid, enhancementLevel, useAsk) {
    const prices = marketAPI.getPrice(itemHrid, enhancementLevel);
    if (!prices) return 0;

    let ask = prices.ask || 0;
    let bid = prices.bid || 0;

    // Match MCS behavior: if one price is positive and other is negative, use positive for both
    if (ask > 0 && bid < 0) {
        bid = ask;
    }
    if (bid > 0 && ask < 0) {
        ask = bid;
    }

    return useAsk ? ask : bid;
}

/**
 * Calculate total value of all houses (all 17)
 * @param {Object} characterHouseRooms - Map of character house rooms
 * @returns {Object} {totalCost, breakdown: [{name, level, cost}]}
 */
export function calculateAllHousesCost(characterHouseRooms) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return { totalCost: 0, breakdown: [] };

    const houseRoomDetailMap = gameData.houseRoomDetailMap;
    if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

    let totalCost = 0;
    const breakdown = [];

    for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
        const level = houseData.level || 0;
        if (level === 0) continue;

        const cost = calculateHouseBuildCost(houseRoomHrid, level);
        totalCost += cost;

        // Get human-readable name
        const houseDetail = houseRoomDetailMap[houseRoomHrid];
        const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

        breakdown.push({
            name: houseName,
            level: level,
            cost: cost
        });
    }

    // Sort by cost descending
    breakdown.sort((a, b) => b.cost - a.cost);

    return { totalCost, breakdown };
}

/**
 * Calculate total value of all abilities
 * @param {Array} characterAbilities - Array of character abilities
 * @param {Array} equippedAbilities - Array of equipped abilities (for subtotal)
 * @returns {Object} {totalCost, equippedCost, breakdown, equippedBreakdown, otherBreakdown}
 */
export function calculateAllAbilitiesCost(characterAbilities, equippedAbilities) {
    if (!characterAbilities || characterAbilities.length === 0) {
        return {
            totalCost: 0,
            equippedCost: 0,
            breakdown: [],
            equippedBreakdown: [],
            otherBreakdown: []
        };
    }

    let totalCost = 0;
    let equippedCost = 0;
    const breakdown = [];
    const equippedBreakdown = [];
    const otherBreakdown = [];

    // Create set of equipped ability HRIDs for quick lookup
    const equippedHrids = new Set(
        equippedAbilities.map(a => a.abilityHrid).filter(Boolean)
    );

    for (const ability of characterAbilities) {
        if (!ability.abilityHrid || ability.level === 0) continue;

        const cost = calculateAbilityCost(ability.abilityHrid, ability.level);
        totalCost += cost;

        // Format ability name for display
        const abilityName = ability.abilityHrid
            .replace('/abilities/', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        const abilityData = {
            name: `${abilityName} ${ability.level}`,
            cost: cost
        };

        breakdown.push(abilityData);

        // Categorize as equipped or other
        if (equippedHrids.has(ability.abilityHrid)) {
            equippedCost += cost;
            equippedBreakdown.push(abilityData);
        } else {
            otherBreakdown.push(abilityData);
        }
    }

    // Sort all breakdowns by cost descending
    breakdown.sort((a, b) => b.cost - a.cost);
    equippedBreakdown.sort((a, b) => b.cost - a.cost);
    otherBreakdown.sort((a, b) => b.cost - a.cost);

    return {
        totalCost,
        equippedCost,
        breakdown,
        equippedBreakdown,
        otherBreakdown
    };
}

/**
 * Calculate total networth
 * @returns {Promise<Object>} Networth data with breakdowns
 */
export async function calculateNetworth() {
    const gameData = dataManager.getInitClientData();
    if (!gameData) {
        console.error('[Networth] No game data available');
        return createEmptyNetworthData();
    }

    // Fetch market data and invalidate cache if needed
    const marketData = await marketAPI.fetch();
    if (!marketData) {
        console.error('[Networth] Failed to fetch market data');
        return createEmptyNetworthData();
    }

    console.log('[Networth] Market data loaded, items count:', Object.keys(marketData).length);
    networthCache.checkAndInvalidate(marketData);

    const characterItems = gameData.characterItems || [];
    const marketListings = gameData.myMarketListings || [];
    const characterHouseRooms = gameData.characterHouseRoomMap || {};
    const characterAbilities = gameData.characterAbilities || [];
    const equippedAbilities = gameData.equippedAbilities || [];

    console.log('[Networth] Character data:', {
        items: characterItems.length,
        listings: marketListings.length,
        houses: Object.keys(characterHouseRooms).length,
        abilities: characterAbilities.length
    });

    // Test sample price to verify market data is working
    if (characterItems.length > 0) {
        const sampleItem = characterItems[0];
        const samplePrice = marketAPI.getPrice(sampleItem.itemHrid, sampleItem.enhancementLevel || 0);
        console.log('[Networth] Sample price check:', sampleItem.itemHrid, 'level', sampleItem.enhancementLevel || 0, '→', samplePrice);
    }

    // Calculate equipped items value
    let equippedAsk = 0;
    let equippedBid = 0;
    const equippedBreakdown = [];

    for (const item of characterItems) {
        if (item.itemLocationHrid === '/item_locations/inventory') continue;

        const askValue = await calculateItemValue(item, true);
        const bidValue = await calculateItemValue(item, false);

        equippedAsk += askValue;
        equippedBid += bidValue;

        // Add to breakdown
        const itemDetails = gameData.itemDetailMap[item.itemHrid];
        const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
        const displayName = item.enhancementLevel > 0
            ? `${itemName} +${item.enhancementLevel}`
            : itemName;

        equippedBreakdown.push({
            name: displayName,
            askValue,
            bidValue
        });
    }

    // Calculate inventory items value
    let inventoryAsk = 0;
    let inventoryBid = 0;
    const inventoryBreakdown = [];

    for (const item of characterItems) {
        if (item.itemLocationHrid !== '/item_locations/inventory') continue;

        const askValue = await calculateItemValue(item, true);
        const bidValue = await calculateItemValue(item, false);

        inventoryAsk += askValue;
        inventoryBid += bidValue;

        // Add to breakdown
        const itemDetails = gameData.itemDetailMap[item.itemHrid];
        const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
        const displayName = item.enhancementLevel > 0
            ? `${itemName} +${item.enhancementLevel}`
            : itemName;

        inventoryBreakdown.push({
            name: displayName,
            askValue,
            bidValue
        });
    }

    // Calculate market listings value
    let listingsAsk = 0;
    let listingsBid = 0;
    const listingsBreakdown = [];

    for (const listing of marketListings) {
        const quantity = listing.orderQuantity - listing.filledQuantity;
        const enhancementLevel = listing.enhancementLevel || 0;

        if (listing.isSell) {
            // Selling: value is locked in listing + unclaimed coins
            // Apply marketplace fee (2% for normal items, 18% for cowbells)
            const fee = listing.itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.02;

            const askValue = await calculateItemValue(
                { itemHrid: listing.itemHrid, enhancementLevel, count: quantity },
                true
            );
            const bidValue = await calculateItemValue(
                { itemHrid: listing.itemHrid, enhancementLevel, count: quantity },
                false
            );

            listingsAsk += askValue * (1 - fee) + listing.unclaimedCoinCount;
            listingsBid += bidValue * (1 - fee) + listing.unclaimedCoinCount;
        } else {
            // Buying: value is locked coins + unclaimed items
            const unclaimedAsk = await calculateItemValue(
                { itemHrid: listing.itemHrid, enhancementLevel, count: listing.unclaimedItemCount },
                true
            );
            const unclaimedBid = await calculateItemValue(
                { itemHrid: listing.itemHrid, enhancementLevel, count: listing.unclaimedItemCount },
                false
            );

            listingsAsk += quantity * listing.price + unclaimedAsk;
            listingsBid += quantity * listing.price + unclaimedBid;
        }
    }

    // Calculate houses value
    const housesData = calculateAllHousesCost(characterHouseRooms);

    // Calculate abilities value
    const abilitiesData = calculateAllAbilitiesCost(characterAbilities, equippedAbilities);

    // Calculate totals
    const totalAsk = equippedAsk + inventoryAsk + listingsAsk + housesData.totalCost + abilitiesData.totalCost;
    const totalBid = equippedBid + inventoryBid + listingsBid + housesData.totalCost + abilitiesData.totalCost;
    const totalNetworth = (totalAsk + totalBid) / 2;

    // Sort breakdowns by value descending
    equippedBreakdown.sort((a, b) => b.askValue - a.askValue);
    inventoryBreakdown.sort((a, b) => b.askValue - a.askValue);

    return {
        totalAsk,
        totalBid,
        totalNetworth,
        currentAssets: {
            ask: equippedAsk + inventoryAsk + listingsAsk,
            bid: equippedBid + inventoryBid + listingsBid,
            equipped: { ask: equippedAsk, bid: equippedBid, breakdown: equippedBreakdown },
            inventory: { ask: inventoryAsk, bid: inventoryBid, breakdown: inventoryBreakdown },
            listings: { ask: listingsAsk, bid: listingsBid, breakdown: listingsBreakdown }
        },
        fixedAssets: {
            total: housesData.totalCost + abilitiesData.totalCost,
            houses: housesData,
            abilities: abilitiesData
        }
    };
}

/**
 * Create empty networth data structure
 * @returns {Object} Empty networth data
 */
function createEmptyNetworthData() {
    return {
        totalAsk: 0,
        totalBid: 0,
        totalNetworth: 0,
        currentAssets: {
            ask: 0,
            bid: 0,
            equipped: { ask: 0, bid: 0, breakdown: [] },
            inventory: { ask: 0, bid: 0, breakdown: [] },
            listings: { ask: 0, bid: 0, breakdown: [] }
        },
        fixedAssets: {
            total: 0,
            houses: { totalCost: 0, breakdown: [] },
            abilities: {
                totalCost: 0,
                equippedCost: 0,
                breakdown: [],
                equippedBreakdown: [],
                otherBreakdown: []
            }
        }
    };
}
