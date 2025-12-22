/**
 * Gathering Profit Calculator
 *
 * Calculates comprehensive profit/hour for gathering actions (Foraging, Woodcutting, Milking) including:
 * - All drop table items at market prices
 * - Drink consumption costs
 * - Equipment speed bonuses
 * - Efficiency buffs (level, house, tea, equipment)
 * - Gourmet tea bonus items (production skills only)
 * - Market tax (2%)
 */

import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import { parseEquipmentSpeedBonuses, parseEssenceFindBonus, parseRareFindBonus } from '../../utils/equipment-parser.js';
import { parseTeaEfficiency, parseGourmetBonus, parseProcessingBonus, parseGatheringBonus, getDrinkConcentration } from '../../utils/tea-parser.js';
import { calculateHouseRareFind } from '../../utils/house-efficiency.js';
import { stackAdditive } from '../../utils/efficiency.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';

/**
 * Processing Tea conversions (raw → processed)
 * 19 total conversions: 5 Foraging, 7 Woodcutting, 7 Milking
 */
const PROCESSING_CONVERSIONS = {
    // Foraging (5)
    '/items/cotton': '/items/cotton_fabric',
    '/items/flax': '/items/linen_fabric',
    '/items/bamboo_branch': '/items/bamboo_fabric',
    '/items/cocoon': '/items/silk_fabric',
    '/items/radiant_fiber': '/items/radiant_fabric',

    // Woodcutting (7)
    '/items/log': '/items/lumber',
    '/items/arcane_log': '/items/arcane_lumber',
    '/items/birch_log': '/items/birch_lumber',
    '/items/cedar_log': '/items/cedar_lumber',
    '/items/ginkgo_log': '/items/ginkgo_lumber',
    '/items/purpleheart_log': '/items/purpleheart_lumber',
    '/items/redwood_log': '/items/redwood_lumber',

    // Milking (7)
    '/items/milk': '/items/cheese',
    '/items/azure_milk': '/items/azure_cheese',
    '/items/burble_milk': '/items/burble_cheese',
    '/items/crimson_milk': '/items/crimson_cheese',
    '/items/holy_milk': '/items/holy_cheese',
    '/items/rainbow_milk': '/items/rainbow_cheese',
    '/items/verdant_milk': '/items/verdant_cheese'
};

/**
 * Action types for gathering skills (3 skills)
 */
const GATHERING_TYPES = [
    '/action_types/foraging',
    '/action_types/woodcutting',
    '/action_types/milking'
];

/**
 * Action types for production skills that benefit from Gourmet Tea (5 skills)
 */
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring'
];

/**
 * Calculate comprehensive profit for a gathering action
 * @param {string} actionHrid - Action HRID (e.g., "/actions/foraging/asteroid_belt")
 * @returns {Object|null} Profit data or null if not applicable
 */
export async function calculateGatheringProfit(actionHrid) {
    // Get action details
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];

    if (!actionDetail) {
        return null;
    }

    // Only process gathering actions (Foraging, Woodcutting, Milking) with drop tables
    if (!GATHERING_TYPES.includes(actionDetail.type)) {
        return null;
    }

    if (!actionDetail.dropTable) {
        return null; // No drop table - nothing to calculate
    }

    // Ensure market data is loaded
    const marketData = await marketAPI.fetch();
    if (!marketData) {
        return null;
    }

    // Get character data
    const equipment = dataManager.getEquipment();
    const skills = dataManager.getSkills();
    const houseRooms = Array.from(dataManager.getHouseRooms().values());
    const activeBuffs = []; // Not currently used

    // Calculate action time per action (with speed bonuses)
    const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
    const speedBonus = parseEquipmentSpeedBonuses(
        equipment,
        actionDetail.type,
        gameData.itemDetailMap
    );
    const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus / 100);

    // Calculate actions per hour
    let actionsPerHour = 3600 / actualTimePerActionSec;

    // Get character's actual equipped drink slots for this action type (from WebSocket data)
    const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

    // Get drink concentration from equipment
    const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

    // Parse tea buffs
    const teaEfficiency = parseTeaEfficiency(
        actionDetail.type,
        drinkSlots,
        gameData.itemDetailMap,
        drinkConcentration
    );

    // Gourmet Tea only applies to production skills (Brewing, Cooking, Cheesesmithing, Crafting, Tailoring)
    // NOT gathering skills (Foraging, Woodcutting, Milking)
    const gourmetBonus = PRODUCTION_TYPES.includes(actionDetail.type)
        ? parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
        : 0;

    // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
    // Only applies to gathering skills (Foraging, Woodcutting, Milking)
    const processingBonus = GATHERING_TYPES.includes(actionDetail.type)
        ? parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
        : 0;

    // Gathering Quantity: Increases item drop amounts (min/max)
    // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
    // Only applies to gathering skills (Foraging, Woodcutting, Milking)
    let totalGathering = 0;
    let gatheringTea = 0;
    let communityGathering = 0;
    if (GATHERING_TYPES.includes(actionDetail.type)) {
        // Parse Gathering Tea bonus
        gatheringTea = parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

        // Get Community Buff level for gathering quantity
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
        communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel * 0.005) : 0;

        // TODO: Add achievement tier bonus when available
        // const achievementGathering = ...

        // Stack all bonuses additively
        totalGathering = gatheringTea + communityGathering;
    }

    // Calculate drink consumption costs
    // Drink Concentration increases consumption rate: base 12/hour × (1 + DC%)
    const drinksPerHour = 12 * (1 + drinkConcentration);
    let drinkCostPerHour = 0;
    const drinkCosts = [];
    for (const drink of drinkSlots) {
        if (!drink || !drink.itemHrid) {
            continue;
        }
        const askPrice = marketData[drink.itemHrid]?.[0]?.a || 0;
        const costPerHour = askPrice * drinksPerHour;
        drinkCostPerHour += costPerHour;

        // Store individual drink cost details
        const drinkName = gameData.itemDetailMap[drink.itemHrid]?.name || 'Unknown';
        drinkCosts.push({
            name: drinkName,
            priceEach: askPrice,
            drinksPerHour: drinksPerHour,
            costPerHour: costPerHour
        });
    }

    // Calculate level efficiency bonus
    const requiredLevel = actionDetail.levelRequirement?.level || 1;
    const skillHrid = actionDetail.levelRequirement?.skillHrid;
    let currentLevel = requiredLevel;
    for (const skill of skills) {
        if (skill.skillHrid === skillHrid) {
            currentLevel = skill.level;
            break;
        }
    }
    const levelEfficiency = Math.max(0, currentLevel - requiredLevel);

    // Calculate house efficiency bonus
    let houseEfficiency = 0;
    for (const room of houseRooms) {
        const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
        if (roomDetail?.actionTypeWhitelist?.includes(actionDetail.type)) {
            houseEfficiency += (room.level || 0) * 1.5;
        }
    }

    // Calculate equipment efficiency bonus (specific items like gathering charms)
    // Extract skill name from action type (e.g., "/action_types/foraging" -> "foraging")
    const skillName = actionDetail.type.replace('/action_types/', '');
    const skillEfficiencyStat = `${skillName}Efficiency`; // e.g., "foragingEfficiency"

    let equipmentEfficiency = 0;
    for (const [slot, equippedItem] of Object.entries(equipment)) {
        if (!equippedItem?.itemHrid) continue;

        const itemDetail = gameData.itemDetailMap[equippedItem.itemHrid];
        if (!itemDetail?.equipmentDetail?.noncombatStats) continue;

        const stats = itemDetail.equipmentDetail.noncombatStats;

        // Check for both generic efficiency and skill-specific efficiency
        let efficiency = 0;
        if (stats.efficiency) {
            efficiency += stats.efficiency; // Generic efficiency (all skills)
        }
        if (stats[skillEfficiencyStat]) {
            efficiency += stats[skillEfficiencyStat]; // Skill-specific (e.g., foragingEfficiency)
        }

        if (efficiency > 0) {
            // Apply enhancement scaling (only accessories/charms get 5x)
            const slotType = itemDetail.equipmentDetail.slot;
            const isAccessory = [
                '/equipment_types/charm',
                '/equipment_types/neck',
                '/equipment_types/earrings',
                '/equipment_types/ring',
                '/equipment_types/back',
                '/equipment_types/trinket'
            ].includes(slotType);

            const enhancementLevel = equippedItem.enhancementLevel || 0;
            if (enhancementLevel > 0) {
                const enhancementBonus = getEnhancementBonus(enhancementLevel);
                const multiplier = isAccessory ? 5 : 1;
                efficiency *= (1 + (enhancementBonus / 100) * multiplier);
            }

            equipmentEfficiency += efficiency;
        }
    }

    // Total efficiency (all additive)
    const totalEfficiency = stackAdditive(
        levelEfficiency,
        houseEfficiency,
        teaEfficiency,
        equipmentEfficiency
    );

    // Apply efficiency to actions per hour
    actionsPerHour *= (1 + totalEfficiency / 100);

    // Calculate revenue from drop table
    let revenuePerHour = 0;
    let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
    const processingConversions = []; // Track conversion details for display
    const baseOutputs = []; // Track base item outputs for display
    const dropTable = actionDetail.dropTable;

    for (const drop of dropTable) {
        const rawBidPrice = marketData[drop.itemHrid]?.[0]?.b || 0;

        // Apply gathering quantity bonus to drop amounts (Gathering Tea + Community Buff + Achievements)
        const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
        const avgAmount = baseAvgAmount * (1 + totalGathering);

        const itemsPerHour = actionsPerHour * drop.dropRate * avgAmount;

        // Store base output details for display
        const itemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
        baseOutputs.push({
            name: itemName,
            itemsPerHour: itemsPerHour,
            dropRate: drop.dropRate
        });

        // Apply market tax (2%)
        const rawPriceAfterTax = rawBidPrice * 0.98;

        // Check if this item has a Processing conversion (e.g., Bamboo Branch → Bamboo Fabric)
        const processedItemHrid = PROCESSING_CONVERSIONS[drop.itemHrid];
        let effectivePrice = rawPriceAfterTax;

        if (processedItemHrid && processingBonus > 0) {
            // Processing Tea: weighted average of raw vs processed
            const processedBidPrice = marketData[processedItemHrid]?.[0]?.b || 0;
            const processedPriceAfterTax = processedBidPrice * 0.98;

            // Expected value = (1 - processingChance) × rawPrice + processingChance × processedPrice
            effectivePrice = (1 - processingBonus) * rawPriceAfterTax + processingBonus * processedPriceAfterTax;

            // Track the extra revenue from Processing
            const processingDelta = effectivePrice - rawPriceAfterTax;
            processingRevenueBonus += itemsPerHour * processingDelta;

            // Store conversion details for display
            const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';
            const valueGainPerConversion = processedPriceAfterTax - rawPriceAfterTax;
            const conversionsPerHour = itemsPerHour * processingBonus;
            const revenueFromConversion = conversionsPerHour * valueGainPerConversion;

            processingConversions.push({
                rawItem: rawItemName,
                processedItem: processedItemName,
                valueGain: valueGainPerConversion,
                conversionsPerHour: conversionsPerHour,
                revenuePerHour: revenueFromConversion
            });
        }

        revenuePerHour += itemsPerHour * effectivePrice;

        // Add Gourmet tea bonus items (only for production skills, not gathering)
        if (gourmetBonus > 0) {
            const bonusItemsPerHour = itemsPerHour * (gourmetBonus / 100);
            revenuePerHour += bonusItemsPerHour * effectivePrice;
        }
    }

    // Calculate bonus revenue from essence and rare find drops
    const bonusRevenue = calculateBonusRevenue(
        actionDetail,
        actionsPerHour,
        equipment,
        gameData.itemDetailMap
    );

    // Add bonus revenue to total revenue
    revenuePerHour += bonusRevenue.totalBonusRevenue;

    // Calculate net profit
    const profitPerHour = revenuePerHour - drinkCostPerHour;
    const profitPerDay = profitPerHour * 24;

    return {
        profitPerHour,
        profitPerDay,
        revenuePerHour,
        drinkCostPerHour,
        drinkCosts,                // Array of individual drink costs {name, priceEach, costPerHour}
        actionsPerHour,
        baseOutputs,               // Array of base item outputs {name, itemsPerHour, dropRate}
        totalEfficiency,
        speedBonus,
        bonusRevenue,              // Essence and rare find details
        processingBonus,           // Processing Tea chance (as decimal)
        processingRevenueBonus,    // Extra revenue from Processing conversions
        processingConversions,     // Array of conversion details {rawItem, processedItem, valueGain}
        totalGathering,            // Total gathering quantity bonus (as decimal)
        gatheringTea,              // Gathering Tea component (as decimal)
        communityGathering,        // Community Buff component (as decimal)
        details: {
            levelEfficiency,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            gourmetBonus
        }
    };
}

/**
 * Get enhancement bonus percentage for a given level
 * @param {number} level - Enhancement level (1-20)
 * @returns {number} Bonus percentage
 */
function getEnhancementBonus(level) {
    const bonuses = {
        1: 2.0, 2: 4.2, 3: 6.6, 4: 9.2, 5: 12.0,
        6: 15.0, 7: 18.2, 8: 21.6, 9: 25.2, 10: 29.0,
        11: 33.4, 12: 38.4, 13: 44.0, 14: 50.2, 15: 57.0,
        16: 64.4, 17: 72.4, 18: 81.0, 19: 90.2, 20: 100.0
    };
    return bonuses[level] || 0;
}

/**
 * Calculate bonus revenue from essence and rare find drops
 * @param {Object} actionDetails - Action details from game data
 * @param {number} actionsPerHour - Actions per hour
 * @param {Map} characterEquipment - Equipment map
 * @param {Object} itemDetailMap - Item details map
 * @returns {Object} Bonus revenue data with essence and rare find drops
 */
function calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap) {
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
                type: 'essence'
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
                type: 'rare_find'
            });

            totalBonusRevenue += revenuePerHour;
        }
    }

    return {
        essenceFindBonus,       // Essence Find % from equipment
        rareFindBonus,          // Rare Find % from equipment + house rooms (combined)
        bonusDrops,             // Array of all bonus drops with details
        totalBonusRevenue       // Total revenue/hour from all bonus drops
    };
}

/**
 * Format profit data into HTML for display
 * @param {Object} profitData - Profit data from calculateForagingProfit
 * @returns {string} HTML string
 */
export function formatProfitDisplay(profitData) {
    if (!profitData) {
        return '';
    }

    const lines = [];
    lines.push(`<div style="color: var(--script-color); text-align: left; margin-top: 8px;">`);
    lines.push(`<strong>Overall Profit:</strong>`);
    lines.push(`<br>${formatWithSeparator(Math.round(profitData.profitPerHour))}/hour`);

    // Only show per day if profit is positive
    if (profitData.profitPerHour > 0) {
        lines.push(`, ${formatWithSeparator(Math.round(profitData.profitPerDay))}/day`);
    }

    // Show efficiency breakdown
    lines.push(`<br><span style="font-size: 0.9em; opacity: 0.8;">`);
    lines.push(`(+${profitData.totalEfficiency.toFixed(1)}% efficiency: `);

    const effParts = [];
    if (profitData.details.levelEfficiency > 0) {
        effParts.push(`${profitData.details.levelEfficiency}% level`);
    }
    if (profitData.details.houseEfficiency > 0) {
        effParts.push(`${profitData.details.houseEfficiency.toFixed(1)}% house`);
    }
    if (profitData.details.teaEfficiency > 0) {
        effParts.push(`${profitData.details.teaEfficiency.toFixed(1)}% tea`);
    }
    if (profitData.details.equipmentEfficiency > 0) {
        effParts.push(`${profitData.details.equipmentEfficiency.toFixed(1)}% equip`);
    }
    if (profitData.details.gourmetBonus > 0) {
        effParts.push(`${profitData.details.gourmetBonus.toFixed(1)}% gourmet`);
    }

    lines.push(effParts.join(', '));
    lines.push(`)</span>`);

    // Show actions per hour
    lines.push(`<br>Actions: ${profitData.actionsPerHour.toFixed(1)}/hour`);

    // Show base output quantities
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        lines.push(`<br>Output:`);
        for (const output of profitData.baseOutputs) {
            lines.push(`<br><span style="font-size: 0.85em; opacity: 0.7; margin-left: 10px;">`);
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            if (output.dropRate < 1.0) {
                lines.push(`• ${output.name}: ~${output.itemsPerHour.toFixed(decimals)}/hour (${(output.dropRate * 100).toFixed(1)}% drop rate)`);
            } else {
                lines.push(`• ${output.name}: ~${output.itemsPerHour.toFixed(decimals)}/hour`);
            }
            lines.push(`</span>`);
        }
    }

    // Show drink costs breakdown
    if (profitData.drinkCostPerHour > 0) {
        lines.push(`<br>Drink costs: -${formatWithSeparator(Math.round(profitData.drinkCostPerHour))}/hour`);

        // Show individual drink costs
        if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
            for (const drink of profitData.drinkCosts) {
                lines.push(`<br><span style="font-size: 0.85em; opacity: 0.7; margin-left: 10px;">`);
                lines.push(`• ${drink.name}: ${formatWithSeparator(Math.round(drink.priceEach))} each × ${drink.drinksPerHour.toFixed(1)}/hour → ${formatWithSeparator(Math.round(drink.costPerHour))}/hour`);
                lines.push(`</span>`);
            }
        }
    }

    // Show bonus revenue breakdown (essences and rare finds)
    if (profitData.bonusRevenue && profitData.bonusRevenue.totalBonusRevenue > 0) {
        lines.push(`<br>Bonus revenue: ${formatWithSeparator(Math.round(profitData.bonusRevenue.totalBonusRevenue))}/hour`);

        const bonusParts = [];
        if (profitData.bonusRevenue.essenceFindBonus > 0) {
            bonusParts.push(`${profitData.bonusRevenue.essenceFindBonus.toFixed(1)}% essence find`);
        }
        if (profitData.bonusRevenue.rareFindBonus > 0) {
            bonusParts.push(`${profitData.bonusRevenue.rareFindBonus.toFixed(1)}% rare find`);
        }

        if (bonusParts.length > 0) {
            lines.push(` (${bonusParts.join(', ')})`);
        }

        // Show individual bonus drops
        if (profitData.bonusRevenue.bonusDrops && profitData.bonusRevenue.bonusDrops.length > 0) {
            for (const drop of profitData.bonusRevenue.bonusDrops) {
                lines.push(`<br><span style="font-size: 0.85em; opacity: 0.7; margin-left: 10px;">`);
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                lines.push(`• ${drop.itemName}: ${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}% drop, ~${drop.dropsPerHour.toFixed(decimals)}/hour → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hour`);
                lines.push(`</span>`);
            }
        }
    }

    // Show Processing Tea bonus (conversions: raw → processed)
    if (profitData.processingBonus > 0 && profitData.processingRevenueBonus > 0) {
        lines.push(`<br>Processing: +${formatWithSeparator(Math.round(profitData.processingRevenueBonus))}/hour`);
        lines.push(` (${(profitData.processingBonus * 100).toFixed(1)}% conversion)`);

        // Show individual conversions
        if (profitData.processingConversions && profitData.processingConversions.length > 0) {
            for (const conversion of profitData.processingConversions) {
                lines.push(`<br><span style="font-size: 0.85em; opacity: 0.7; margin-left: 10px;">`);
                const decimals = conversion.conversionsPerHour < 1 ? 2 : 1;
                lines.push(`• ${conversion.rawItem} → ${conversion.processedItem}: ~${conversion.conversionsPerHour.toFixed(decimals)} converted/hour, +${formatWithSeparator(Math.round(conversion.valueGain))} per conversion → ${formatWithSeparator(Math.round(conversion.revenuePerHour))}/hour`);
                lines.push(`</span>`);
            }
        }
    }

    // Show Gathering Quantity bonus (increases item drops)
    if (profitData.totalGathering > 0) {
        const gatheringParts = [];
        if (profitData.gatheringTea > 0) {
            gatheringParts.push(`${(profitData.gatheringTea * 100).toFixed(1)}% tea`);
        }
        if (profitData.communityGathering > 0) {
            gatheringParts.push(`${(profitData.communityGathering * 100).toFixed(1)}% community`);
        }

        lines.push(`<br>Gathering: +${(profitData.totalGathering * 100).toFixed(1)}% quantity`);
        if (gatheringParts.length > 0) {
            lines.push(` (${gatheringParts.join(' + ')})`);
        }
    }

    lines.push(`</div>`);

    return lines.join('');
}
