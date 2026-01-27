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

import dataManager from '../../core/data-manager.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import {
    parseTeaEfficiency,
    parseGourmetBonus,
    parseProcessingBonus,
    parseGatheringBonus,
    getDrinkConcentration,
    parseTeaSkillLevelBonus,
} from '../../utils/tea-parser.js';
import { stackAdditive } from '../../utils/efficiency.js';
import { formatWithSeparator, formatPercentage } from '../../utils/formatters.js';
import { calculateBonusRevenue } from '../../utils/bonus-revenue-calculator.js';
import { getItemPrice } from '../../utils/market-data.js';
import { GATHERING_TYPES, PRODUCTION_TYPES, MARKET_TAX } from '../../utils/profit-constants.js';
import {
    calculateEfficiencyMultiplier,
    calculateProfitPerAction,
    calculateProfitPerDay,
    calculateDrinksPerHour,
    calculateActionsPerHour,
} from '../../utils/profit-helpers.js';

/**
 * Cache for processing action conversions (inputItemHrid → conversion data)
 * Built once per game data load to avoid O(n) searches through action map
 */
let processingConversionCache = null;

/**
 * Build processing conversion cache from game data
 * @param {Object} gameData - Game data from dataManager
 * @returns {Map} Map of inputItemHrid → {actionHrid, outputItemHrid, conversionRatio}
 */
function buildProcessingConversionCache(gameData) {
    const cache = new Map();
    const validProcessingTypes = [
        '/action_types/cheesesmithing', // Milk → Cheese conversions
        '/action_types/crafting', // Log → Lumber conversions
        '/action_types/tailoring', // Cotton/Flax/Bamboo/Cocoon/Radiant → Fabric conversions
    ];

    for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (!validProcessingTypes.includes(action.type)) {
            continue;
        }

        const inputItem = action.inputItems?.[0];
        const outputItem = action.outputItems?.[0];

        if (inputItem && outputItem) {
            cache.set(inputItem.itemHrid, {
                actionHrid: actionHrid,
                outputItemHrid: outputItem.itemHrid,
                conversionRatio: inputItem.count,
            });
        }
    }

    return cache;
}

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

    // Build processing conversion cache once (lazy initialization)
    if (!processingConversionCache) {
        processingConversionCache = buildProcessingConversionCache(gameData);
    }

    const priceCache = new Map();
    const getCachedPrice = (itemHrid, options) => {
        const side = options?.side || '';
        const enhancementLevel = options?.enhancementLevel ?? '';
        const cacheKey = `${itemHrid}|${side}|${enhancementLevel}`;

        if (priceCache.has(cacheKey)) {
            return priceCache.get(cacheKey);
        }

        const price = getItemPrice(itemHrid, options);
        priceCache.set(cacheKey, price);
        return price;
    };

    // Note: Market API is pre-loaded by caller (max-produceable.js)
    // No need to check or fetch here

    // Get character data
    const equipment = dataManager.getEquipment();
    const skills = dataManager.getSkills();
    const houseRooms = Array.from(dataManager.getHouseRooms().values());
    const _activeBuffs = []; // Not currently used

    // Calculate action time per action (with speed bonuses)
    const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
    const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
    // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
    const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus);

    // Calculate actions per hour
    const actionsPerHour = calculateActionsPerHour(actualTimePerActionSec);

    // Get character's actual equipped drink slots for this action type (from WebSocket data)
    const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

    // Get drink concentration from equipment
    const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

    // Parse tea buffs
    const teaEfficiency = parseTeaEfficiency(actionDetail.type, drinkSlots, gameData.itemDetailMap, drinkConcentration);

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
    let achievementGathering = 0;
    if (GATHERING_TYPES.includes(actionDetail.type)) {
        // Parse Gathering Tea bonus
        gatheringTea = parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

        // Get Community Buff level for gathering quantity
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
        communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

        // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
        const achievementBuffs = dataManager.getAchievementBuffs(actionDetail.type);

        // achievementBuffs is an array of buff objects
        // Find the gathering buff (typeHrid: "/buff_types/gathering") and get its flatBoost value
        if (Array.isArray(achievementBuffs)) {
            const gatheringBuff = achievementBuffs.find((buff) => buff.typeHrid === '/buff_types/gathering');
            achievementGathering = gatheringBuff?.flatBoost || 0;
        } else {
            achievementGathering = 0;
        }

        // Stack all bonuses additively
        totalGathering = gatheringTea + communityGathering + achievementGathering;
    }

    // Calculate drink consumption costs
    const drinksPerHour = calculateDrinksPerHour(drinkConcentration);
    let drinkCostPerHour = 0;
    const drinkCosts = [];
    for (const drink of drinkSlots) {
        if (!drink || !drink.itemHrid) {
            continue;
        }
        const drinkPrice = getCachedPrice(drink.itemHrid, { context: 'profit', side: 'buy' });
        const isPriceMissing = drinkPrice === null;
        const resolvedPrice = isPriceMissing ? 0 : drinkPrice;
        const costPerHour = resolvedPrice * drinksPerHour;
        drinkCostPerHour += costPerHour;

        // Store individual drink cost details
        const drinkName = gameData.itemDetailMap[drink.itemHrid]?.name || 'Unknown';
        drinkCosts.push({
            name: drinkName,
            priceEach: resolvedPrice,
            drinksPerHour: drinksPerHour,
            costPerHour: costPerHour,
            missingPrice: isPriceMissing,
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

    // Calculate tea skill level bonus (e.g., +5 Foraging from Ultra Foraging Tea)
    const teaSkillLevelBonus = parseTeaSkillLevelBonus(
        actionDetail.type,
        drinkSlots,
        gameData.itemDetailMap,
        drinkConcentration
    );

    // Apply tea skill level bonus to effective player level
    const effectiveLevel = currentLevel + teaSkillLevelBonus;
    const levelEfficiency = Math.max(0, effectiveLevel - requiredLevel);

    // Calculate house efficiency bonus
    let houseEfficiency = 0;
    for (const room of houseRooms) {
        const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
        if (roomDetail?.usableInActionTypeMap?.[actionDetail.type]) {
            houseEfficiency += (room.level || 0) * 1.5;
        }
    }

    // Calculate equipment efficiency bonus (uses equipment-parser utility)
    const equipmentEfficiency = parseEquipmentEfficiencyBonuses(equipment, actionDetail.type, gameData.itemDetailMap);

    // Total efficiency (all additive)
    const totalEfficiency = stackAdditive(levelEfficiency, houseEfficiency, teaEfficiency, equipmentEfficiency);

    // Calculate efficiency multiplier (matches production profit calculator pattern)
    // Efficiency "repeats the action" - we apply it to item outputs, not action rate
    const efficiencyMultiplier = calculateEfficiencyMultiplier(totalEfficiency);

    // Calculate revenue from drop table
    // Processing happens PER ACTION (before efficiency multiplies the count)
    // So we calculate per-action outputs, then multiply by actionsPerHour and efficiency
    let revenuePerHour = 0;
    let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
    let processingRevenueBonusPerAction = 0; // Per-action processing revenue
    const processingConversions = []; // Track conversion details for display
    const baseOutputs = []; // Display-only base item outputs (not used for totals)
    const dropTable = actionDetail.dropTable;

    for (const drop of dropTable) {
        const rawPrice = getCachedPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
        const rawPriceMissing = rawPrice === null;
        const resolvedRawPrice = rawPriceMissing ? 0 : rawPrice;
        // Apply gathering quantity bonus to drop amounts
        const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
        const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

        // Check if this item has a Processing Tea conversion (using cache for O(1) lookup)
        // Processing Tea only applies to: Milk→Cheese, Log→Lumber, Cotton/Flax/Bamboo/Cocoon/Radiant→Fabric
        const conversionData = processingConversionCache.get(drop.itemHrid);
        const processedItemHrid = conversionData?.outputItemHrid || null;
        const _processingActionHrid = conversionData?.actionHrid || null;

        // Per-action calculations (efficiency will be applied when converting to items per hour)
        let rawPerAction = 0;
        let processedPerAction = 0;

        if (processedItemHrid && processingBonus > 0) {
            // Get conversion ratio from cache (e.g., 1 Milk → 1 Cheese)
            const conversionRatio = conversionData.conversionRatio;

            // Processing Tea check happens per action:
            // If procs (processingBonus% chance): Convert to processed + leftover
            const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);
            const rawLeftoverIfProcs = avgAmountPerAction % conversionRatio;

            // If doesn't proc: All stays raw
            const rawIfNoProc = avgAmountPerAction;

            // Expected value per action
            processedPerAction = processingBonus * processedIfProcs;
            rawPerAction = processingBonus * rawLeftoverIfProcs + (1 - processingBonus) * rawIfNoProc;

            // Revenue per hour = per-action × actionsPerHour × efficiency
            const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
            const processedPriceMissing = processedPrice === null;
            const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;

            const rawItemsPerHour = actionsPerHour * drop.dropRate * rawPerAction * efficiencyMultiplier;
            const processedItemsPerHour = actionsPerHour * drop.dropRate * processedPerAction * efficiencyMultiplier;
            const rawItemsPerAction = drop.dropRate * rawPerAction;
            const processedItemsPerAction = drop.dropRate * processedPerAction;

            revenuePerHour += rawItemsPerHour * resolvedRawPrice;
            revenuePerHour += processedItemsPerHour * resolvedProcessedPrice;

            // Track processing details
            const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';

            // Value gain per conversion = cheese value - cost of milk used
            const costOfMilkUsed = conversionRatio * resolvedRawPrice;
            const valueGainPerConversion = resolvedProcessedPrice - costOfMilkUsed;
            const revenueFromConversion = processedItemsPerHour * valueGainPerConversion;

            processingRevenueBonus += revenueFromConversion;
            processingRevenueBonusPerAction += processedItemsPerAction * valueGainPerConversion;
            processingConversions.push({
                rawItem: rawItemName,
                processedItem: processedItemName,
                valueGain: valueGainPerConversion,
                conversionsPerHour: processedItemsPerHour,
                conversionsPerAction: processedItemsPerAction,
                revenuePerHour: revenueFromConversion,
                revenuePerAction: processedItemsPerAction * valueGainPerConversion,
                missingPrice: rawPriceMissing || processedPriceMissing,
            });

            // Store combined raw + processed revenue (processing bonus shown separately as extra value)
            baseOutputs.push({
                name: rawItemName,
                itemsPerHour: rawItemsPerHour,
                itemsPerAction: rawItemsPerAction,
                dropRate: drop.dropRate,
                priceEach: resolvedRawPrice,
                revenuePerHour: rawItemsPerHour * resolvedRawPrice + processedItemsPerHour * resolvedProcessedPrice,
                revenuePerAction:
                    rawItemsPerAction * resolvedRawPrice + processedItemsPerAction * resolvedProcessedPrice,
                missingPrice: rawPriceMissing,
            });
        } else {
            // No processing - simple calculation
            rawPerAction = avgAmountPerAction;
            const rawItemsPerHour = actionsPerHour * drop.dropRate * rawPerAction * efficiencyMultiplier;
            const rawItemsPerAction = drop.dropRate * rawPerAction;
            revenuePerHour += rawItemsPerHour * resolvedRawPrice;

            const itemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            baseOutputs.push({
                name: itemName,
                itemsPerHour: rawItemsPerHour,
                itemsPerAction: rawItemsPerAction,
                dropRate: drop.dropRate,
                priceEach: resolvedRawPrice,
                revenuePerHour: rawItemsPerHour * resolvedRawPrice,
                revenuePerAction: rawItemsPerAction * resolvedRawPrice,
                missingPrice: rawPriceMissing,
            });
        }

        // Gourmet tea bonus (only for production skills, not gathering)
        if (gourmetBonus > 0) {
            const totalPerAction = rawPerAction + processedPerAction;
            const bonusPerAction = totalPerAction * (gourmetBonus / 100);
            const bonusItemsPerHour = actionsPerHour * drop.dropRate * bonusPerAction * efficiencyMultiplier;

            // Use weighted average price for gourmet bonus
            if (processedItemHrid && processingBonus > 0) {
                const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                const resolvedProcessedPrice = processedPrice === null ? 0 : processedPrice;
                const weightedPrice =
                    (rawPerAction * resolvedRawPrice + processedPerAction * resolvedProcessedPrice) /
                    (rawPerAction + processedPerAction);
                revenuePerHour += bonusItemsPerHour * weightedPrice;
            } else {
                revenuePerHour += bonusItemsPerHour * resolvedRawPrice;
            }
        }
    }

    // Calculate bonus revenue from essence and rare find drops
    const bonusRevenue = calculateBonusRevenue(actionDetail, actionsPerHour, equipment, gameData.itemDetailMap);

    // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
    const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;

    // Add bonus revenue to total revenue
    revenuePerHour += efficiencyBoostedBonusRevenue;

    const hasMissingPrices =
        drinkCosts.some((drink) => drink.missingPrice) ||
        baseOutputs.some((output) => output.missingPrice) ||
        processingConversions.some((conversion) => conversion.missingPrice) ||
        (bonusRevenue?.hasMissingPrices ?? false);

    // Calculate market tax (2% of gross revenue)
    const marketTax = revenuePerHour * MARKET_TAX;

    // Calculate net profit (revenue - market tax - drink costs)
    const profitPerHour = revenuePerHour - marketTax - drinkCostPerHour;

    return {
        profitPerHour,
        profitPerAction: calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
        profitPerDay: calculateProfitPerDay(profitPerHour), // Profit per day
        revenuePerHour,
        drinkCostPerHour,
        drinkCosts, // Array of individual drink costs {name, priceEach, costPerHour}
        actionsPerHour, // Base actions per hour (without efficiency)
        baseOutputs, // Display-only base outputs {name, itemsPerHour, dropRate, priceEach, revenuePerHour}
        totalEfficiency, // Total efficiency percentage
        efficiencyMultiplier, // Efficiency as multiplier (1 + totalEfficiency / 100)
        speedBonus,
        bonusRevenue, // Essence and rare find details
        processingBonus, // Processing Tea chance (as decimal)
        processingRevenueBonus, // Extra revenue from Processing conversions
        processingConversions, // Array of conversion details {rawItem, processedItem, valueGain}
        processingRevenueBonusPerAction, // Processing bonus per action
        gatheringQuantity: totalGathering, // Total gathering quantity bonus (as decimal) - renamed for display consistency
        hasMissingPrices,
        details: {
            levelEfficiency,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            communityBuffQuantity: communityGathering, // Community Buff component (as decimal)
            gatheringTeaBonus: gatheringTea, // Gathering Tea component (as decimal)
            achievementGathering: achievementGathering, // Achievement Tier component (as decimal)
        },
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
                lines.push(
                    `• ${output.name}: ~${output.itemsPerHour.toFixed(decimals)}/hour (${formatPercentage(output.dropRate, 1)} drop rate)`
                );
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
                lines.push(
                    `• ${drink.name}: ${formatWithSeparator(Math.round(drink.priceEach))} each × ${drink.drinksPerHour.toFixed(1)}/hour → ${formatWithSeparator(Math.round(drink.costPerHour))}/hour`
                );
                lines.push(`</span>`);
            }
        }
    }

    // Show bonus revenue breakdown (essences and rare finds)
    if (profitData.bonusRevenue && profitData.bonusRevenue.totalBonusRevenue > 0) {
        lines.push(
            `<br>Bonus revenue: ${formatWithSeparator(Math.round(profitData.bonusRevenue.totalBonusRevenue))}/hour`
        );

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
                const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                lines.push(
                    `• ${drop.itemName}: ${dropRatePct} drop, ~${drop.dropsPerHour.toFixed(decimals)}/hour → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hour`
                );
                lines.push(`</span>`);
            }
        }
    }

    // Show Processing Tea bonus (conversions: raw → processed)
    if (profitData.processingBonus > 0 && profitData.processingRevenueBonus > 0) {
        lines.push(`<br>Processing: +${formatWithSeparator(Math.round(profitData.processingRevenueBonus))}/hour`);
        lines.push(` (${formatPercentage(profitData.processingBonus, 1)} conversion)`);

        // Show individual conversions
        if (profitData.processingConversions && profitData.processingConversions.length > 0) {
            for (const conversion of profitData.processingConversions) {
                lines.push(`<br><span style="font-size: 0.85em; opacity: 0.7; margin-left: 10px;">`);
                const decimals = conversion.conversionsPerHour < 1 ? 2 : 1;
                lines.push(
                    `• ${conversion.rawItem} → ${conversion.processedItem}: ~${conversion.conversionsPerHour.toFixed(decimals)} converted/hour, +${formatWithSeparator(Math.round(conversion.valueGain))} per conversion → ${formatWithSeparator(Math.round(conversion.revenuePerHour))}/hour`
                );
                lines.push(`</span>`);
            }
        }
    }

    // Show Gathering Quantity bonus (increases item drops)
    if (profitData.totalGathering > 0) {
        const gatheringParts = [];
        if (profitData.gatheringTea > 0) {
            gatheringParts.push(`${formatPercentage(profitData.gatheringTea, 1)} tea`);
        }
        if (profitData.communityGathering > 0) {
            gatheringParts.push(`${formatPercentage(profitData.communityGathering, 1)} community`);
        }
        if (profitData.achievementGathering > 0) {
            gatheringParts.push(`${formatPercentage(profitData.achievementGathering, 1)} achievement`);
        }

        lines.push(`<br>Gathering: +${formatPercentage(profitData.totalGathering, 1)} quantity`);
        if (gatheringParts.length > 0) {
            lines.push(` (${gatheringParts.join(' + ')})`);
        }
    }

    lines.push(`</div>`);

    return lines.join('');
}
