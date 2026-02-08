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
            const pricingMode = config.getSetting('profitCalc_pricingMode') || 'hybrid';
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
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
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

            // Calculate cost per attempt (materials consumed on all attempts)
            const costPerAttempt = materialCost;

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

            // Material and revenue calculations (for breakdown display)
            const materialCostPerHour = materialCost * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for coinify
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency;

            // Profit calculation (matches OLD system formula)
            // Formula: (netProfit × (1 + efficiency)) / actionTime × 3600 - teaCost
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour = profitPerSecond * SECONDS_PER_HOUR - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: bulkMultiplier,
                    price: pricePerItem,
                    costPerAction: materialCost,
                    costPerHour: materialCostPerHour,
                    enhancementLevel: enhancementLevel || 0,
                },
            ];

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
                    revenuePerHour,
                    dropsPerHour: coinsProduced * successRate * actionsPerHourWithEfficiency,
                },
            ];

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
                actionSpeedBreakdown: efficiencyBreakdown.speedBreakdown,

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
            const pricingMode = config.getSetting('profitCalc_pricingMode') || 'hybrid';
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
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
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

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice;

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

            // Material and revenue calculations (for breakdown display)
            const materialCostPerHour = inputPrice * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for decompose
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency;

            // Profit calculation (matches OLD system formula)
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour = profitPerSecond * SECONDS_PER_HOUR - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: 1,
                    price: inputPrice,
                    costPerAction: inputPrice,
                    costPerHour: materialCostPerHour,
                    enhancementLevel: enhancementLevel || 0,
                },
            ];

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
                actionSpeedBreakdown: efficiencyBreakdown.speedBreakdown,

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
            const pricingMode = config.getSetting('profitCalc_pricingMode') || 'hybrid';
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
            const actionStats = calculateActionStats(actionDetails, {
                skills: dataManager.getSkills(),
                equipment: dataManager.getEquipment(),
                itemDetailMap: gameData.itemDetailMap,
                includeCommunityBuff: true,
                includeBreakdown: true,
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

            // Calculate expected value of outputs
            let expectedOutputValue = 0;
            const dropDetails = [];

            for (const drop of itemDetails.alchemyDetail.transmuteDropTable) {
                const outputPrice = getItemPrice(drop.itemHrid, { context: 'profit', side: sellType });
                if (outputPrice !== null) {
                    const afterTax = calculatePriceAfterTax(outputPrice);
                    // Expected value: price × dropRate × averageCount
                    const averageCount = (drop.minCount + drop.maxCount) / 2;
                    const dropValue = afterTax * drop.dropRate * averageCount;
                    expectedOutputValue += dropValue;

                    dropDetails.push({
                        itemHrid: drop.itemHrid,
                        dropRate: drop.dropRate,
                        minCount: drop.minCount,
                        maxCount: drop.maxCount,
                        averageCount,
                        price: outputPrice,
                        expectedValue: dropValue,
                    });
                }
            }

            // Revenue per attempt (expected value on success)
            const revenuePerAttempt = expectedOutputValue * successRate;

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice;

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

            // Material and revenue calculations (for breakdown display)
            const materialCostPerHour = inputPrice * actionsPerHourWithEfficiency;
            const catalystCostPerHour = 0; // No catalyst for transmute
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency;

            // Profit calculation (matches OLD system formula)
            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour = profitPerSecond * SECONDS_PER_HOUR - teaCostData.totalCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            // Build detailed breakdowns
            const requirementCosts = [
                {
                    itemHrid,
                    count: 1,
                    price: inputPrice,
                    costPerAction: inputPrice,
                    costPerHour: materialCostPerHour,
                    enhancementLevel: 0,
                },
            ];

            const dropRevenues = dropDetails.map((drop) => ({
                itemHrid: drop.itemHrid,
                count: drop.averageCount,
                dropRate: drop.dropRate,
                effectiveDropRate: drop.dropRate,
                price: drop.price,
                isEssence: false,
                isRare: false,
                revenuePerAttempt: drop.expectedValue * successRate,
                revenuePerHour: drop.expectedValue * successRate * actionsPerHourWithEfficiency,
                dropsPerHour: drop.averageCount * drop.dropRate * successRate * actionsPerHourWithEfficiency,
            }));

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
                actionSpeedBreakdown: efficiencyBreakdown.speedBreakdown,

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
