/**
 * Bonus Revenue Calculator Utility
 * Calculates revenue from essence and rare find drops
 * Shared by both gathering and production profit calculators
 */

import marketAPI from '../api/marketplace.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import { parseEssenceFindBonus, parseRareFindBonus } from './equipment-parser.js';
import { calculateHouseRareFind } from './house-efficiency.js';

/**
 * Calculate bonus revenue from essence and rare find drops
 * @param {Object} actionDetails - Action details from game data
 * @param {number} actionsPerHour - Base actions per hour (efficiency not applied)
 * @param {Map} characterEquipment - Equipment map
 * @param {Object} itemDetailMap - Item details map
 * @returns {Object} Bonus revenue data with essence and rare find drops
 */
export function calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap) {
    // Get Essence Find bonus from equipment
    const essenceFindBonus = parseEssenceFindBonus(characterEquipment, itemDetailMap);

    // Get Rare Find bonus from BOTH equipment and house rooms
    const equipmentRareFindBonus = parseRareFindBonus(characterEquipment, actionDetails.type, itemDetailMap);
    const houseRareFindBonus = calculateHouseRareFind();
    const rareFindBonus = equipmentRareFindBonus + houseRareFindBonus;

    const bonusDrops = [];
    let totalBonusRevenue = 0;

    // Process essence drops
    if (actionDetails.essenceDropTable && actionDetails.essenceDropTable.length > 0) {
        for (const drop of actionDetails.essenceDropTable) {
            const itemDetails = itemDetailMap[drop.itemHrid];
            if (!itemDetails) continue;

            // Calculate average drop count
            const avgCount = (drop.minCount + drop.maxCount) / 2;

            // Apply Essence Find multiplier to drop rate
            const finalDropRate = drop.dropRate * (1 + essenceFindBonus / 100);

            // Expected drops per hour
            const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

            // Get price: Check if openable container (use EV), otherwise market price
            let itemPrice = 0;
            if (itemDetails.isOpenable) {
                // Use expected value for openable containers
                itemPrice = expectedValueCalculator.getCachedValue(drop.itemHrid) || 0;
            } else {
                // Use market price for regular items
                const price = marketAPI.getPrice(drop.itemHrid, 0);
                itemPrice = price?.bid || 0; // Use bid price (instant sell)
            }

            // Revenue per hour from this drop
            const revenuePerHour = dropsPerHour * itemPrice;

            bonusDrops.push({
                itemHrid: drop.itemHrid,
                itemName: itemDetails.name,
                dropRate: finalDropRate,
                dropsPerHour,
                priceEach: itemPrice,
                revenuePerHour,
                type: 'essence',
            });

            totalBonusRevenue += revenuePerHour;
        }
    }

    // Process rare find drops
    if (actionDetails.rareDropTable && actionDetails.rareDropTable.length > 0) {
        for (const drop of actionDetails.rareDropTable) {
            const itemDetails = itemDetailMap[drop.itemHrid];
            if (!itemDetails) continue;

            // Calculate average drop count
            const avgCount = (drop.minCount + drop.maxCount) / 2;

            // Apply Rare Find multiplier to drop rate
            const finalDropRate = drop.dropRate * (1 + rareFindBonus / 100);

            // Expected drops per hour
            const dropsPerHour = actionsPerHour * finalDropRate * avgCount;

            // Get price: Check if openable container (use EV), otherwise market price
            let itemPrice = 0;
            if (itemDetails.isOpenable) {
                // Use expected value for openable containers
                itemPrice = expectedValueCalculator.getCachedValue(drop.itemHrid) || 0;
            } else {
                // Use market price for regular items
                const price = marketAPI.getPrice(drop.itemHrid, 0);
                itemPrice = price?.bid || 0; // Use bid price (instant sell)
            }

            // Revenue per hour from this drop
            const revenuePerHour = dropsPerHour * itemPrice;

            bonusDrops.push({
                itemHrid: drop.itemHrid,
                itemName: itemDetails.name,
                dropRate: finalDropRate,
                dropsPerHour,
                priceEach: itemPrice,
                revenuePerHour,
                type: 'rare_find',
            });

            totalBonusRevenue += revenuePerHour;
        }
    }

    return {
        essenceFindBonus, // Essence Find % from equipment
        rareFindBonus, // Rare Find % from equipment + house rooms (combined)
        bonusDrops, // Array of all bonus drops with details
        totalBonusRevenue, // Total revenue/hour from all bonus drops
    };
}
