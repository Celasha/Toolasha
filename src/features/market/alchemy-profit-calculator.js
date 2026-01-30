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

import dataManager from '../../core/data-manager.js';
import { parseEquipmentSpeedBonuses } from '../../utils/equipment-parser.js';
import { getDrinkConcentration } from '../../utils/tea-parser.js';
import { getItemPrice } from '../../utils/market-data.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import { getAlchemySuccessBonus } from '../../utils/buff-parser.js';
import {
    calculateActionsPerHour,
    calculatePriceAfterTax,
    calculateProfitPerDay,
    calculateDrinksPerHour,
} from '../../utils/profit-helpers.js';

// Base success rates for alchemy actions
const BASE_SUCCESS_RATES = {
    COINIFY: 0.7, // 70%
    DECOMPOSE: 0.6, // 60%
    // TRANSMUTE: varies by item (from alchemyDetail.transmuteSuccessRate)
};

// Base action time for all alchemy actions (20 seconds)
const BASE_ALCHEMY_TIME_SECONDS = 20;

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
     * Calculate alchemy success rate with tea modifiers
     * Uses active character buffs for accurate success rate calculation
     * @param {number} baseRate - Base success rate (0-1)
     * @returns {number} Final success rate after modifiers
     */
    getAlchemySuccessRate(baseRate) {
        try {
            // Get alchemy success bonus from active buffs (already includes drink concentration scaling)
            const teaBonus = getAlchemySuccessBonus();

            // Calculate final success rate
            // Formula: total = base × (1 + tea_ratio_boost)
            const finalRate = baseRate * (1 + teaBonus);

            return Math.min(1.0, finalRate); // Cap at 100%
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate success rate:', error);
            return baseRate;
        }
    }

    /**
     * Calculate alchemy action time with speed bonuses
     * @returns {number} Action time in seconds
     */
    calculateAlchemyActionTime() {
        try {
            const gameData = dataManager.getInitClientData();
            const equipment = dataManager.getEquipment();
            const itemDetailMap = this.getItemDetailMap();

            if (!gameData || !equipment) {
                return BASE_ALCHEMY_TIME_SECONDS;
            }

            const actionTypeHrid = '/action_types/alchemy';

            // Get equipment speed bonus
            const equipmentSpeedBonus = parseEquipmentSpeedBonuses(equipment, actionTypeHrid, itemDetailMap);

            // Calculate action time with speed bonuses
            // Formula: baseTime / (1 + speedBonus)
            const actionTime = BASE_ALCHEMY_TIME_SECONDS / (1 + equipmentSpeedBonus);

            return actionTime;
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate action time:', error);
            return BASE_ALCHEMY_TIME_SECONDS;
        }
    }

    /**
     * Calculate tea costs per hour for alchemy actions
     * @returns {number} Tea cost per hour
     */
    calculateAlchemyTeaCosts() {
        try {
            const gameData = dataManager.getInitClientData();
            const equipment = dataManager.getEquipment();

            if (!gameData || !equipment) {
                return 0;
            }

            const actionTypeHrid = '/action_types/alchemy';
            const drinkSlots = dataManager.getActionDrinkSlots(actionTypeHrid);

            if (!drinkSlots || drinkSlots.length === 0) {
                return 0;
            }

            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);
            const drinksPerHour = calculateDrinksPerHour(drinkConcentration);

            let totalTeaCost = 0;

            for (const drink of drinkSlots) {
                if (!drink || !drink.itemHrid) continue;

                // Get tea price based on pricing mode
                const teaPrice = getItemPrice(drink.itemHrid, { context: 'profit', side: 'buy' });
                const resolvedPrice = teaPrice === null ? 0 : teaPrice;

                totalTeaCost += resolvedPrice;
            }

            return totalTeaCost * drinksPerHour;
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate tea costs:', error);
            return 0;
        }
    }

    /**
     * Calculate Coinify profit for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object|null} Profit data or null if not coinifiable
     */
    calculateCoinifyProfit(itemHrid, enhancementLevel = 0) {
        try {
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Check if item is coinifiable
            if (!itemDetails.alchemyDetail || itemDetails.alchemyDetail.isCoinifiable !== true) {
                return null;
            }

            // Get input cost (market price of the item)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'buy', enhancementLevel });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Get output value (sell price from item data)
            const outputValue = itemDetails.sellPrice || 0;

            // Get success rate
            const baseSuccessRate = BASE_SUCCESS_RATES.COINIFY;
            const successRate = this.getAlchemySuccessRate(baseSuccessRate);

            // Calculate action time and actions per hour
            const actionTime = this.calculateAlchemyActionTime();
            const actionsPerHour = calculateActionsPerHour(actionTime);

            // Calculate tea costs
            const teaCostPerHour = this.calculateAlchemyTeaCosts();

            // Revenue per attempt (only on success)
            const revenuePerAttempt = outputValue * successRate;

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice;

            // Net profit per attempt
            const profitPerAttempt = revenuePerAttempt - costPerAttempt;

            // Hourly calculations
            const profitPerHour = profitPerAttempt * actionsPerHour - teaCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            return {
                actionType: 'coinify',
                itemHrid,
                enhancementLevel,
                profitPerHour,
                profitPerDay,
                successRate,
                actionTime,
                actionsPerHour,
                inputCost: inputPrice,
                outputValue,
                teaCostPerHour,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate coinify profit:', error);
            return null;
        }
    }

    /**
     * Calculate Decompose profit for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object|null} Profit data or null if not decomposable
     */
    calculateDecomposeProfit(itemHrid, enhancementLevel = 0) {
        try {
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Check if item is decomposable
            if (!itemDetails.alchemyDetail || !itemDetails.alchemyDetail.decomposeItems) {
                return null;
            }

            // Get input cost (market price of the item being decomposed)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'buy', enhancementLevel });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Get success rate
            const baseSuccessRate = BASE_SUCCESS_RATES.DECOMPOSE;
            const successRate = this.getAlchemySuccessRate(baseSuccessRate);

            // Calculate output value
            let outputValue = 0;

            // 1. Base decompose items (always received on success)
            for (const output of itemDetails.alchemyDetail.decomposeItems) {
                const outputPrice = getItemPrice(output.itemHrid, { context: 'profit', side: 'sell' });
                if (outputPrice !== null) {
                    const afterTax = calculatePriceAfterTax(outputPrice);
                    outputValue += afterTax * output.count;
                }
            }

            // 2. Enhancing Essence (if item is enhanced)
            if (enhancementLevel > 0) {
                const itemLevel = itemDetails.itemLevel || 1;
                const essenceAmount = Math.round(
                    2 * (0.5 + 0.1 * Math.pow(1.05, itemLevel)) * Math.pow(2, enhancementLevel)
                );

                const essencePrice = getItemPrice('/items/enhancing_essence', { context: 'profit', side: 'sell' });
                if (essencePrice !== null) {
                    const afterTax = calculatePriceAfterTax(essencePrice);
                    outputValue += afterTax * essenceAmount;
                }
            }

            // Calculate action time and actions per hour
            const actionTime = this.calculateAlchemyActionTime();
            const actionsPerHour = calculateActionsPerHour(actionTime);

            // Calculate tea costs
            const teaCostPerHour = this.calculateAlchemyTeaCosts();

            // Revenue per attempt (only on success)
            const revenuePerAttempt = outputValue * successRate;

            // Calculate market tax (2% of gross revenue)
            const marketTaxPerAttempt = revenuePerAttempt * MARKET_TAX;

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice;

            // Net profit per attempt (revenue - costs - tax)
            const profitPerAttempt = revenuePerAttempt - costPerAttempt - marketTaxPerAttempt;

            // Hourly calculations
            const profitPerHour = profitPerAttempt * actionsPerHour - teaCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            return {
                actionType: 'decompose',
                itemHrid,
                enhancementLevel,
                profitPerHour,
                profitPerDay,
                successRate,
                actionTime,
                actionsPerHour,
                inputCost: inputPrice,
                outputValue,
                teaCostPerHour,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate decompose profit:', error);
            return null;
        }
    }

    /**
     * Calculate Transmute profit for an item
     * @param {string} itemHrid - Item HRID
     * @returns {Object|null} Profit data or null if not transmutable
     */
    calculateTransmuteProfit(itemHrid) {
        try {
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
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

            // Get input cost (market price of the item being transmuted)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'buy' });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Get success rate with modifiers
            const successRate = this.getAlchemySuccessRate(baseSuccessRate);

            // Calculate expected value of outputs
            let expectedOutputValue = 0;

            for (const drop of itemDetails.alchemyDetail.transmuteDropTable) {
                const outputPrice = getItemPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
                if (outputPrice !== null) {
                    const afterTax = calculatePriceAfterTax(outputPrice);
                    // Expected value: price × dropRate × averageCount
                    const averageCount = (drop.minCount + drop.maxCount) / 2;
                    expectedOutputValue += afterTax * drop.dropRate * averageCount;
                }
            }

            // Calculate action time and actions per hour
            const actionTime = this.calculateAlchemyActionTime();
            const actionsPerHour = calculateActionsPerHour(actionTime);

            // Calculate tea costs
            const teaCostPerHour = this.calculateAlchemyTeaCosts();

            // Revenue per attempt (expected value on success)
            const revenuePerAttempt = expectedOutputValue * successRate;

            // Cost per attempt (input consumed on every attempt)
            const costPerAttempt = inputPrice;

            // Net profit per attempt
            const profitPerAttempt = revenuePerAttempt - costPerAttempt;

            // Hourly calculations
            const profitPerHour = profitPerAttempt * actionsPerHour - teaCostPerHour;
            const profitPerDay = calculateProfitPerDay(profitPerHour);

            return {
                actionType: 'transmute',
                itemHrid,
                enhancementLevel: 0, // Transmute doesn't care about enhancement
                profitPerHour,
                profitPerDay,
                successRate,
                actionTime,
                actionsPerHour,
                inputCost: inputPrice,
                outputValue: expectedOutputValue,
                teaCostPerHour,
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

// Create and export singleton instance
const alchemyProfitCalculator = new AlchemyProfitCalculator();

export default alchemyProfitCalculator;
