/**
 * Alchemy Profit Calculator Module
 * Calculates profit for alchemy actions (Coinify, Decompose, Transmute) from game JSON data
 *
 * Success Rates (Base, Unmodified):
 * - Coinify: 70% (0.7)
 * - Decompose: 60% (0.6)
 * - Transmute: Varies by item (from item.alchemyDetail.transmuteSuccessRate)
 *
 * Success Rate Modifiers:
 * - Tea: Catalytic Tea provides /buff_types/alchemy_success (5% ratio boost, scales with Drink Concentration)
 * - Formula: finalRate = baseRate × (1 + teaBonus)
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { getDrinkConcentration } from '../../utils/tea-parser.js';
import { getItemPrice } from '../../utils/market-data.js';
import { SECONDS_PER_HOUR } from '../../utils/profit-constants.js';
import { getAlchemySuccessBonus } from '../../utils/buff-parser.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
import { parseEssenceFindBonus, parseRareFindBonus } from '../../utils/equipment-parser.js';
import { calculateHouseRareFind } from '../../utils/house-efficiency.js';
import marketAPI from '../../api/marketplace.js';
import expectedValueCalculator from './expected-value-calculator.js';
import {
    calculateActionsPerHour,
    calculatePriceAfterTax,
    calculateProfitPerDay,
    calculateTeaCostsPerHour,
} from '../../utils/profit-helpers.js';

// Base success rates for alchemy actions
const BASE_SUCCESS_RATES = {
    COINIFY: 0.7, // 70%
    DECOMPOSE: 0.6, // 60%
    // TRANSMUTE: varies by item (from alchemyDetail.transmuteSuccessRate)
};

/**
 * Calculate alchemy-specific bonus drops (essences + rares) from item level.
 * Alchemy actions don't have essenceDropTable/rareDropTable in game data,
 * so we compute them from the item's level using reverse-engineered formulas.
 *
 * Essence: baseRate = (100 + itemLevel) / 1800
 * Rare (Small, level 1-34):  baseRate = (100 + itemLevel) / 144000
 * Rare (Medium, level 35-69): baseRate = (65 + itemLevel) / 216000
 * Rare (Large, level 70+):    baseRate = (30 + itemLevel) / 288000
 *
 * @param {number} itemLevel - The item's level (from itemDetails.itemLevel)
 * @param {number} actionsPerHour - Actions per hour (with efficiency)
 * @param {Map} equipment - Character equipment map
 * @param {Object} itemDetailMap - Item details map
 * @returns {Object} Bonus drop data with drops array and breakdowns
 */
function calculateAlchemyBonusDrops(itemLevel, actionsPerHour, equipment, itemDetailMap) {
    const essenceFindBonus = parseEssenceFindBonus(equipment, itemDetailMap);

    const equipmentRareFindBonus = parseRareFindBonus(equipment, '/action_types/alchemy', itemDetailMap);
    const houseRareFindBonus = calculateHouseRareFind();
    const achievementRareFindBonus =
        dataManager.getAchievementBuffFlatBoost('/action_types/alchemy', '/buff_types/rare_find') * 100;
    const rareFindBonus = equipmentRareFindBonus + houseRareFindBonus + achievementRareFindBonus;

    const bonusDrops = [];
    let totalBonusRevenue = 0;

    // Essence drop: Alchemy Essence
    const baseEssenceRate = (100 + itemLevel) / 1800;
    const finalEssenceRate = baseEssenceRate * (1 + essenceFindBonus / 100);
    const essenceDropsPerHour = actionsPerHour * finalEssenceRate;

    let essencePrice = 0;
    const essenceItemDetails = itemDetailMap['/items/alchemy_essence'];
    if (essenceItemDetails?.isOpenable) {
        essencePrice = expectedValueCalculator.getCachedValue('/items/alchemy_essence') || 0;
    } else {
        const price = marketAPI.getPrice('/items/alchemy_essence', 0);
        essencePrice = price?.bid ?? 0;
    }

    const essenceRevenuePerHour = essenceDropsPerHour * essencePrice;
    bonusDrops.push({
        itemHrid: '/items/alchemy_essence',
        count: 1,
        dropRate: finalEssenceRate,
        effectiveDropRate: finalEssenceRate,
        price: essencePrice,
        isEssence: true,
        isRare: false,
        revenuePerAttempt: finalEssenceRate * essencePrice,
        revenuePerHour: essenceRevenuePerHour,
        dropsPerHour: essenceDropsPerHour,
    });
    totalBonusRevenue += essenceRevenuePerHour;

    // Rare drop: Artisan's Crate (size depends on item level)
    let baseRareRate;
    let crateHrid;
    if (itemLevel < 35) {
        baseRareRate = (100 + itemLevel) / 144000;
        crateHrid = '/items/small_artisans_crate';
    } else if (itemLevel < 70) {
        baseRareRate = (65 + itemLevel) / 216000;
        crateHrid = '/items/medium_artisans_crate';
    } else {
        baseRareRate = (30 + itemLevel) / 288000;
        crateHrid = '/items/large_artisans_crate';
    }

    const finalRareRate = baseRareRate * (1 + rareFindBonus / 100);
    const rareDropsPerHour = actionsPerHour * finalRareRate;

    let cratePrice = 0;
    const crateItemDetails = itemDetailMap[crateHrid];
    if (crateItemDetails?.isOpenable) {
        // Try cached EV first, then compute on-demand if cache is empty
        cratePrice =
            expectedValueCalculator.getCachedValue(crateHrid) ||
            expectedValueCalculator.calculateSingleContainer(crateHrid) ||
            0;
    } else {
        const price = marketAPI.getPrice(crateHrid, 0);
        cratePrice = price?.bid ?? 0;
    }

    const rareRevenuePerHour = rareDropsPerHour * cratePrice;
    bonusDrops.push({
        itemHrid: crateHrid,
        count: 1,
        dropRate: finalRareRate,
        effectiveDropRate: finalRareRate,
        price: cratePrice,
        isEssence: false,
        isRare: true,
        revenuePerAttempt: finalRareRate * cratePrice,
        revenuePerHour: rareRevenuePerHour,
        dropsPerHour: rareDropsPerHour,
    });
    totalBonusRevenue += rareRevenuePerHour;

    return {
        bonusDrops,
        totalBonusRevenue,
        essenceFindBonus,
        rareFindBonus,
        rareFindBreakdown: {
            equipment: equipmentRareFindBonus,
            house: houseRareFindBonus,
            achievement: achievementRareFindBonus,
            total: rareFindBonus,
        },
        essenceFindBreakdown: {
            equipment: essenceFindBonus,
            total: essenceFindBonus,
        },
    };
}

class AlchemyProfitCalculator {
    constructor() {
        // Cache for item detail map
        this._itemDetailMap = null;
    }

    /**
     * Get item detail map (lazy-loaded and cached)
     * @returns {Object} Item details map from init_client_data
     */
    getItemDetailMap() {
        if (!this._itemDetailMap) {
            const initData = dataManager.getInitClientData();
            this._itemDetailMap = initData?.itemDetailMap || {};
        }
        return this._itemDetailMap;
    }

    /**
     * Calculate success rate with detailed breakdown
     * @param {number} baseRate - Base success rate (0-1)
     * @returns {Object} Success rate breakdown { total, base, tea }
     */
    calculateSuccessRateBreakdown(baseRate) {
        try {
            // Get alchemy success bonus from active buffs
            const teaBonus = getAlchemySuccessBonus();

            // Calculate final success rate
            const total = Math.min(1.0, baseRate * (1 + teaBonus));

            return {
                total,
                base: baseRate,
                tea: teaBonus,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate success rate breakdown:', error);
            return {
                total: baseRate,
                base: baseRate,
                tea: 0,
            };
        }
    }

    /**
     * Calculate coinify profit for an item with full detailed breakdown
     * This is the SINGLE source of truth used by both tooltip and action panel
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object|null} Detailed profit data or null if not coinifiable
     */
    calculateCoinifyProfit(itemHrid, enhancementLevel = 0) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!gameData || !itemDetails) {
                return null;
            }

            // Check if item is coinifiable
            if (!itemDetails.alchemyDetail || itemDetails.alchemyDetail.isCoinifiable !== true) {
                return null;
            }

            // Get alchemy action details
            const actionDetails = gameData.actionDetailMap['/actions/alchemy/coinify'];
            if (!actionDetails) {
                return null;
            }

            // Get pricing mode
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
            let buyType, sellType;
            if (pricingMode === 'conservative') {
                buyType = 'ask';
                sellType = 'bid';
            } else if (pricingMode === 'hybrid') {
                buyType = 'ask';
                sellType = 'ask';
            } else {
                buyType = 'bid';
                sellType = 'ask';
            }

            // Calculate action stats (time + efficiency) using shared helper
            // Alchemy uses item level (not action requirement) for efficiency calculation
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
                levelRequirementOverride: itemDetails.itemLevel || 1,
            });

            const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

            // Get equipment for drink concentration calculation
            const equipment = dataManager.getEquipment();

            // Get drink concentration separately (not in breakdown from calculateActionStats)
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Calculate success rate with breakdown
            const baseSuccessRate = BASE_SUCCESS_RATES.COINIFY;
            const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
            const successRate = successRateBreakdown.total;

            // Calculate input cost (material cost)
            const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;
            const pricePerItem = getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
            if (pricePerItem === null) {
                return null; // No market data
            }
            const materialCost = pricePerItem * bulkMultiplier;

            // Coinify has no catalyst (catalyst is 0 for coinify)
            const catalystPrice = 0;

            // Get coin cost per action attempt
            // If not in action data, calculate as 1/5 of item's sell price per item
            const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2) * bulkMultiplier;

            // Calculate cost per attempt (materials consumed on all attempts)
            const costPerAttempt = materialCost + coinCost;

            // Calculate output value (coins produced)
            // Formula: sellPrice × bulkMultiplier × 5
            const coinsProduced = (itemDetails.sellPrice || 0) * bulkMultiplier * 5;

            // Revenue per attempt (coins are always 1:1, only get coins on success)
            // Note: efficiency is applied to NET PROFIT, not revenue
            const revenuePerAttempt = coinsProduced * successRate;

            // Net profit per attempt (before efficiency)
            const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

            // Calculate tea costs
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: buyType }),
            });

            // Calculate per-hour values
            // Actions per hour (for display breakdown) - includes efficiency for display purposes
            // Convert efficiency from percentage to decimal (81.516% -> 0.81516)
            const efficiencyDecimal = totalEfficiency / 100;
            const actionsPerHourWithEfficiency = calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

            // Calculate bonus revenue (essences + rares) from item level
            const itemLevel = itemDetails.itemLevel || 1;
            const alchemyBonus = calculateAlchemyBonusDrops(
                itemLevel,
                actionsPerHourWithEfficiency,
                equipment,
                gameData.itemDetailMap
            );

            // Material and revenue calculations (for breakdown display)
            const materialCostPerHour = (materialCost + coinCost) * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for coinify
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            // Profit calculation (matches OLD system formula)
            // Formula: (netProfit × (1 + efficiency)) / actionTime × 3600 + bonusRevenue - teaCost
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour =
                profitPerSecond * SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: bulkMultiplier,
                    price: pricePerItem,
                    costPerAction: materialCost,
                    costPerHour: materialCost * actionsPerHourWithEfficiency,
                    enhancementLevel: enhancementLevel || 0,
                },
            ];

            // Add coin cost entry if applicable
            if (coinCost > 0) {
                requirementCosts.push({
                    itemHrid: '/items/coin',
                    count: coinCost,
                    price: 1,
                    costPerAction: coinCost,
                    costPerHour: coinCost * actionsPerHourWithEfficiency,
                    enhancementLevel: 0,
                });
            }

            const coinRevenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency;

            const dropRevenues = [
                {
                    itemHrid: '/items/coin',
                    count: coinsProduced,
                    dropRate: 1.0, // Coins always drop
                    effectiveDropRate: 1.0,
                    price: 1, // Coins are 1:1
                    isEssence: false,
                    isRare: false,
                    revenuePerAttempt,
                    revenuePerHour: coinRevenuePerHour,
                    dropsPerHour: coinsProduced * successRate * actionsPerHourWithEfficiency,
                },
            ];

            // Add alchemy essence and rare drops
            for (const drop of alchemyBonus.bonusDrops) {
                dropRevenues.push(drop);
            }

            const catalystCost = {
                itemHrid: null,
                price: 0,
                costPerSuccess: 0,
                costPerAttempt: 0,
                costPerHour: 0,
            };

            const consumableCosts = teaCostData.costs.map((cost) => ({
                itemHrid: cost.itemHrid,
                price: cost.pricePerDrink,
                drinksPerHour: cost.drinksPerHour,
                costPerHour: cost.totalCost,
            }));

            // Return comprehensive data matching what action panel needs
            return {
                // Basic info
                actionType: 'coinify',
                itemHrid,
                enhancementLevel,

                // Summary totals
                profitPerHour,
                profitPerDay,
                revenuePerHour,

                // Actions and rates
                actionsPerHour: actionsPerHourWithEfficiency,
                actionTime,

                // Per-attempt economics
                materialCost,
                catalystPrice,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostData.totalCostPerHour,

                // Detailed breakdowns
                requirementCosts,
                dropRevenues,
                catalystCost,
                consumableCosts,

                // Core stats
                successRate,
                efficiency: efficiencyDecimal, // Decimal form (0.81516 for 81.516%)

                // Modifier breakdowns
                successRateBreakdown,
                efficiencyBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Pricing info
                pricingMode,
                buyType,
                sellType,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate coinify profit:', error);
            return null;
        }
    }

    /**
     * Calculate Decompose profit for an item with full detailed breakdown
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object|null} Profit data or null if not decomposable
     */
    calculateDecomposeProfit(itemHrid, enhancementLevel = 0) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!gameData || !itemDetails) {
                return null;
            }

            // Check if item is decomposable
            if (!itemDetails.alchemyDetail || !itemDetails.alchemyDetail.decomposeItems) {
                return null;
            }

            // Get alchemy action details
            const actionDetails = gameData.actionDetailMap['/actions/alchemy/decompose'];
            if (!actionDetails) {
                return null;
            }

            // Get pricing mode
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
            let buyType, sellType;
            if (pricingMode === 'conservative') {
                buyType = 'ask';
                sellType = 'bid';
            } else if (pricingMode === 'hybrid') {
                buyType = 'ask';
                sellType = 'ask';
            } else {
                buyType = 'bid';
                sellType = 'ask';
            }

            // Calculate action stats (time + efficiency) using shared helper
            // Alchemy uses item level (not action requirement) for efficiency calculation
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
                levelRequirementOverride: itemDetails.itemLevel || 1,
            });

            const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

            // Get equipment for drink concentration calculation
            const equipment = dataManager.getEquipment();
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Calculate success rate with breakdown
            const baseSuccessRate = BASE_SUCCESS_RATES.DECOMPOSE;
            const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
            const successRate = successRateBreakdown.total;

            // Get input cost (market price of the item being decomposed)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Calculate output value
            let outputValue = 0;
            const dropDetails = [];

            // 1. Base decompose items (always received on success)
            for (const output of itemDetails.alchemyDetail.decomposeItems) {
                const outputPrice = getItemPrice(output.itemHrid, { context: 'profit', side: sellType });
                if (outputPrice !== null) {
                    const afterTax = calculatePriceAfterTax(outputPrice);
                    const dropValue = afterTax * output.count;
                    outputValue += dropValue;

                    dropDetails.push({
                        itemHrid: output.itemHrid,
                        count: output.count,
                        price: outputPrice,
                        afterTax,
                        isEssence: false,
                        expectedValue: dropValue,
                    });
                }
            }

            // 2. Enhancing Essence (if item is enhanced)
            let essenceAmount = 0;
            if (enhancementLevel > 0) {
                const itemLevel = itemDetails.itemLevel || 1;
                essenceAmount = Math.round(2 * (0.5 + 0.1 * Math.pow(1.05, itemLevel)) * Math.pow(2, enhancementLevel));

                const essencePrice = getItemPrice('/items/enhancing_essence', { context: 'profit', side: sellType });
                if (essencePrice !== null) {
                    const afterTax = calculatePriceAfterTax(essencePrice);
                    const dropValue = afterTax * essenceAmount;
                    outputValue += dropValue;

                    dropDetails.push({
                        itemHrid: '/items/enhancing_essence',
                        count: essenceAmount,
                        price: essencePrice,
                        afterTax,
                        isEssence: true,
                        expectedValue: dropValue,
                    });
                }
            }

            // Revenue per attempt (only on success)
            const revenuePerAttempt = outputValue * successRate;

            // Get coin cost per action attempt
            // If not in action data, calculate as 1/5 of item's sell price
            const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2);

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice + coinCost;

            // Net profit per attempt (before efficiency)
            const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

            // Calculate tea costs
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: buyType }),
            });

            // Calculate per-hour values
            // Convert efficiency from percentage to decimal
            const efficiencyDecimal = totalEfficiency / 100;
            const actionsPerHourWithEfficiency = calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

            // Calculate bonus revenue (essences + rares) from item level
            const itemLevel = itemDetails.itemLevel || 1;
            const alchemyBonus = calculateAlchemyBonusDrops(
                itemLevel,
                actionsPerHourWithEfficiency,
                equipment,
                gameData.itemDetailMap
            );

            // Material and revenue calculations (for breakdown display)
            const materialCostPerHour = (inputPrice + coinCost) * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for decompose
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            // Profit calculation (matches OLD system formula)
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour =
                profitPerSecond * SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: 1,
                    price: inputPrice,
                    costPerAction: inputPrice,
                    costPerHour: inputPrice * actionsPerHourWithEfficiency,
                    enhancementLevel: enhancementLevel || 0,
                },
            ];

            // Add coin cost entry if applicable
            if (coinCost > 0) {
                requirementCosts.push({
                    itemHrid: '/items/coin',
                    count: coinCost,
                    price: 1,
                    costPerAction: coinCost,
                    costPerHour: coinCost * actionsPerHourWithEfficiency,
                    enhancementLevel: 0,
                });
            }

            const dropRevenues = dropDetails.map((drop) => ({
                itemHrid: drop.itemHrid,
                count: drop.count,
                dropRate: 1.0, // Decompose drops are guaranteed on success
                effectiveDropRate: 1.0,
                price: drop.price,
                isEssence: drop.isEssence,
                isRare: false,
                revenuePerAttempt: drop.expectedValue * successRate,
                revenuePerHour: drop.expectedValue * successRate * actionsPerHourWithEfficiency,
                dropsPerHour: drop.count * successRate * actionsPerHourWithEfficiency,
            }));

            // Add alchemy essence and rare drops
            for (const drop of alchemyBonus.bonusDrops) {
                dropRevenues.push(drop);
            }

            const catalystCost = {
                itemHrid: null,
                price: 0,
                costPerSuccess: 0,
                costPerAttempt: 0,
                costPerHour: 0,
            };

            const consumableCosts = teaCostData.costs.map((cost) => ({
                itemHrid: cost.itemHrid,
                price: cost.pricePerDrink,
                drinksPerHour: cost.drinksPerHour,
                costPerHour: cost.totalCost,
            }));

            // Return comprehensive data matching what action panel needs
            return {
                // Basic info
                actionType: 'decompose',
                itemHrid,
                enhancementLevel,

                // Summary totals
                profitPerHour,
                profitPerDay,
                revenuePerHour,

                // Actions and rates
                actionsPerHour: actionsPerHourWithEfficiency,
                actionTime,

                // Per-attempt economics
                materialCost: inputPrice,
                catalystPrice: 0,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostData.totalCostPerHour,

                // Detailed breakdowns
                requirementCosts,
                dropRevenues,
                catalystCost,
                consumableCosts,

                // Core stats
                successRate,
                efficiency: efficiencyDecimal,

                // Modifier breakdowns
                successRateBreakdown,
                efficiencyBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Pricing info
                pricingMode,
                buyType,
                sellType,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate decompose profit:', error);
            return null;
        }
    }

    /**
     * Calculate Transmute profit for an item with full detailed breakdown
     * @param {string} itemHrid - Item HRID
     * @returns {Object|null} Profit data or null if not transmutable
     */
    calculateTransmuteProfit(itemHrid) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!gameData || !itemDetails) {
                return null;
            }

            // Check if item is transmutable
            if (!itemDetails.alchemyDetail || !itemDetails.alchemyDetail.transmuteDropTable) {
                return null;
            }

            // Get base success rate from item
            const baseSuccessRate = itemDetails.alchemyDetail.transmuteSuccessRate || 0;
            if (baseSuccessRate === 0) {
                return null; // Cannot transmute
            }

            // Get alchemy action details
            const actionDetails = gameData.actionDetailMap['/actions/alchemy/transmute'];
            if (!actionDetails) {
                return null;
            }

            // Get pricing mode
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');
            let buyType, sellType;
            if (pricingMode === 'conservative') {
                buyType = 'ask';
                sellType = 'bid';
            } else if (pricingMode === 'hybrid') {
                buyType = 'ask';
                sellType = 'ask';
            } else {
                buyType = 'bid';
                sellType = 'ask';
            }

            // Calculate action stats (time + efficiency) using shared helper
            // Alchemy uses item level (not action requirement) for efficiency calculation
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
                levelRequirementOverride: itemDetails.itemLevel || 1,
            });

            const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

            // Get equipment for drink concentration calculation
            const equipment = dataManager.getEquipment();
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Calculate success rate with breakdown
            const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
            const successRate = successRateBreakdown.total;

            // Get input cost (market price of the item being transmuted)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: buyType });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Get bulk multiplier (number of items consumed AND produced per action)
            const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;

            // Calculate expected value of outputs, excluding self-returns (Milkonomy-style)
            // Self-returns are when you get the same item back - these don't count as income
            let expectedOutputValue = 0;
            let selfReturnRate = 0;
            let selfReturnCount = 0;
            const dropDetails = [];

            for (const drop of itemDetails.alchemyDetail.transmuteDropTable) {
                const isSelfReturn = drop.itemHrid === itemHrid;
                const averageCount = (drop.minCount + drop.maxCount) / 2;

                if (isSelfReturn) {
                    // Track self-return for cost adjustment
                    selfReturnRate = drop.dropRate;
                    selfReturnCount = averageCount * bulkMultiplier;
                }

                const outputPrice = getItemPrice(drop.itemHrid, { context: 'profit', side: sellType });
                if (outputPrice !== null) {
                    const afterTax = calculatePriceAfterTax(outputPrice);
                    // Expected value: price × dropRate × averageCount × bulkMultiplier
                    const dropValue = afterTax * drop.dropRate * averageCount * bulkMultiplier;

                    // Only add to revenue if NOT a self-return
                    if (!isSelfReturn) {
                        expectedOutputValue += dropValue;
                    }

                    dropDetails.push({
                        itemHrid: drop.itemHrid,
                        dropRate: drop.dropRate,
                        minCount: drop.minCount,
                        maxCount: drop.maxCount,
                        averageCount,
                        price: outputPrice,
                        expectedValue: isSelfReturn ? 0 : dropValue, // Self-return has 0 effective value
                        isSelfReturn,
                    });
                }
            }

            // Revenue per attempt (expected value on success, excluding self-returns)
            const revenuePerAttempt = expectedOutputValue * successRate;

            // Material cost calculation with self-return adjustment
            // Gross cost = input price × bulk
            // Self-return value = input price × self return rate × success rate × bulk
            // Net cost = gross - self-return value
            const grossMaterialCost = inputPrice * bulkMultiplier;
            const selfReturnValue = inputPrice * selfReturnRate * successRate * selfReturnCount;
            const netMaterialCost = grossMaterialCost - selfReturnValue;

            // Get coin cost per action attempt
            // If not in action data, calculate as 1/5 of item's sell price per item
            const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2) * bulkMultiplier;

            // Cost per attempt (net material cost after self-return + coin cost)
            const costPerAttempt = netMaterialCost + coinCost;

            // Net profit per attempt (before efficiency)
            const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

            // Calculate tea costs
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: buyType }),
            });

            // Calculate per-hour values
            // Convert efficiency from percentage to decimal
            const efficiencyDecimal = totalEfficiency / 100;
            const actionsPerHourWithEfficiency = calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

            // Calculate bonus revenue (essences + rares) from item level
            const itemLevel = itemDetails.itemLevel || 1;
            const alchemyBonus = calculateAlchemyBonusDrops(
                itemLevel,
                actionsPerHourWithEfficiency,
                equipment,
                gameData.itemDetailMap
            );

            // Material and revenue calculations (for breakdown display)
            // Use net material cost (after self-return adjustment)
            const materialCostPerHour = (netMaterialCost + coinCost) * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for transmute
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            // Profit calculation (matches OLD system formula)
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour =
                profitPerSecond * SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: bulkMultiplier,
                    price: inputPrice,
                    costPerAction: netMaterialCost, // Net cost after self-return
                    costPerHour: netMaterialCost * actionsPerHourWithEfficiency,
                    enhancementLevel: 0,
                    selfReturnRate: selfReturnRate > 0 ? selfReturnRate : undefined,
                    selfReturnValue: selfReturnValue > 0 ? selfReturnValue : undefined,
                },
            ];

            // Add coin cost entry if applicable
            if (coinCost > 0) {
                requirementCosts.push({
                    itemHrid: '/items/coin',
                    count: coinCost,
                    price: 1,
                    costPerAction: coinCost,
                    costPerHour: coinCost * actionsPerHourWithEfficiency,
                    enhancementLevel: 0,
                });
            }

            const dropRevenues = dropDetails.map((drop) => ({
                itemHrid: drop.itemHrid,
                count: drop.averageCount * bulkMultiplier,
                dropRate: drop.dropRate,
                effectiveDropRate: drop.dropRate,
                price: drop.price,
                isEssence: false,
                isRare: false,
                isSelfReturn: drop.isSelfReturn || false,
                revenuePerAttempt: drop.expectedValue * successRate,
                revenuePerHour: drop.expectedValue * successRate * actionsPerHourWithEfficiency,
                dropsPerHour:
                    drop.averageCount * bulkMultiplier * drop.dropRate * successRate * actionsPerHourWithEfficiency,
            }));

            // Add alchemy essence and rare drops
            for (const drop of alchemyBonus.bonusDrops) {
                dropRevenues.push(drop);
            }

            const catalystCost = {
                itemHrid: null,
                price: 0,
                costPerSuccess: 0,
                costPerAttempt: 0,
                costPerHour: 0,
            };

            const consumableCosts = teaCostData.costs.map((cost) => ({
                itemHrid: cost.itemHrid,
                price: cost.pricePerDrink,
                drinksPerHour: cost.drinksPerHour,
                costPerHour: cost.totalCost,
            }));

            // Return comprehensive data matching what action panel needs
            return {
                // Basic info
                actionType: 'transmute',
                itemHrid,
                enhancementLevel: 0, // Transmute doesn't care about enhancement

                // Summary totals
                profitPerHour,
                profitPerDay,
                revenuePerHour,

                // Actions and rates
                actionsPerHour: actionsPerHourWithEfficiency,
                actionTime,

                // Per-attempt economics
                materialCost: netMaterialCost, // Net cost after self-return adjustment
                grossMaterialCost,
                selfReturnValue,
                catalystPrice: 0,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostData.totalCostPerHour,

                // Detailed breakdowns
                requirementCosts,
                dropRevenues,
                catalystCost,
                consumableCosts,

                // Core stats
                successRate,
                efficiency: efficiencyDecimal,

                // Modifier breakdowns
                successRateBreakdown,
                efficiencyBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Pricing info
                pricingMode,
                buyType,
                sellType,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate transmute profit:', error);
            return null;
        }
    }

    /**
     * Calculate all applicable profits for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object} Object with all applicable profit calculations
     */
    calculateAllProfits(itemHrid, enhancementLevel = 0) {
        const results = {};

        // Try coinify
        const coinifyProfit = this.calculateCoinifyProfit(itemHrid, enhancementLevel);
        if (coinifyProfit) {
            results.coinify = coinifyProfit;
        }

        // Try decompose
        const decomposeProfit = this.calculateDecomposeProfit(itemHrid, enhancementLevel);
        if (decomposeProfit) {
            results.decompose = decomposeProfit;
        }

        // Try transmute (only for base items)
        if (enhancementLevel === 0) {
            const transmuteProfit = this.calculateTransmuteProfit(itemHrid);
            if (transmuteProfit) {
                results.transmute = transmuteProfit;
            }
        }

        return results;
    }
}

const alchemyProfitCalculator = new AlchemyProfitCalculator();

export default alchemyProfitCalculator;
