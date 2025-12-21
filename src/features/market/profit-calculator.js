/**
 * Profit Calculator Module
 * Calculates production costs and profit for crafted items
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import * as efficiency from '../../utils/efficiency.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from '../../utils/equipment-parser.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { parseTeaEfficiency, getDrinkConcentration, parseArtisanBonus, parseGourmetBonus, parseProcessingBonus, parseActionLevelBonus } from '../../utils/tea-parser.js';

/**
 * ProfitCalculator class handles profit calculations for production actions
 */
class ProfitCalculator {
    constructor() {
        // Constants
        this.MARKET_TAX = 0.02; // 2% marketplace tax
        this.DRINKS_PER_HOUR = 12; // Average drink consumption per hour
    }

    /**
     * Calculate profit for a crafted item
     * @param {string} itemHrid - Item HRID
     * @returns {Object|null} Profit data or null if not craftable
     */
    calculateProfit(itemHrid) {
        // Get item details
        const itemDetails = dataManager.getItemDetails(itemHrid);
        if (!itemDetails) {
            return null;
        }

        // Find the action that produces this item
        const action = this.findProductionAction(itemHrid);
        if (!action) {
            return null; // Not a craftable item
        }

        // Get character skills for efficiency calculations
        const skills = dataManager.getSkills();
        if (!skills) {
            return null;
        }

        // Get action details
        const actionDetails = dataManager.getActionDetails(action.actionHrid);
        if (!actionDetails) {
            return null;
        }

        // Calculate base action time
        // Game uses NANOSECONDS (1e9 = 1 second)
        const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

        // Get character level for the action's skill
        const skillLevel = this.getSkillLevel(skills, actionDetails.type);

        // Get equipped items for efficiency bonus calculation
        const characterEquipment = dataManager.getEquipment();
        const initData = dataManager.getInitClientData();

        // Get Drink Concentration from equipment
        const drinkConcentration = getDrinkConcentration(
            characterEquipment,
            initData?.itemDetailMap || {}
        );

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

        // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
        // This lowers the effective requirement, not increases skill level
        const actionLevelBonus = parseActionLevelBonus(
            activeDrinks,
            initData?.itemDetailMap || {},
            drinkConcentration
        );

        // Calculate efficiency components
        // Action Level bonus increases the effective requirement
        const baseRequirement = actionDetails.levelRequirement?.level || 1;
        const effectiveRequirement = baseRequirement + actionLevelBonus;
        const levelEfficiency = Math.max(0, skillLevel - effectiveRequirement);
        const houseEfficiency = calculateHouseEfficiency(actionDetails.type);

        // Calculate equipment efficiency bonus
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
            characterEquipment,
            actionDetails.type,
            initData?.itemDetailMap || {}
        );

        // Calculate tea efficiency bonus
        const teaEfficiency = parseTeaEfficiency(
            actionDetails.type,
            activeDrinks,
            initData?.itemDetailMap || {},
            drinkConcentration
        );

        // Calculate artisan material cost reduction
        const artisanBonus = parseArtisanBonus(
            activeDrinks,
            initData?.itemDetailMap || {},
            drinkConcentration
        );

        // Calculate gourmet bonus (Brewing/Cooking extra items)
        const gourmetBonus = parseGourmetBonus(
            activeDrinks,
            initData?.itemDetailMap || {},
            drinkConcentration
        );

        // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
        const processingBonus = parseProcessingBonus(
            activeDrinks,
            initData?.itemDetailMap || {},
            drinkConcentration
        );

        // Total efficiency bonus (all sources additive)
        const efficiencyBonus = levelEfficiency + houseEfficiency + equipmentEfficiency + teaEfficiency;

        // Calculate equipment speed bonus
        const equipmentSpeedBonus = parseEquipmentSpeedBonuses(
            characterEquipment,
            actionDetails.type,
            initData?.itemDetailMap || {}
        );

        // Calculate action time with ONLY speed bonuses
        // Efficiency does NOT reduce time - it gives bonus actions
        // Formula: baseTime / (1 + speedBonus)
        // Example: 60s / (1 + 0.15) = 52.17s
        const actionTime = baseTime / (1 + equipmentSpeedBonus);

        // Build time breakdown for display
        const timeBreakdown = this.calculateTimeBreakdown(
            baseTime,
            equipmentSpeedBonus
        );

        // Actions per hour (base rate without efficiency)
        const actionsPerHour = 3600 / actionTime;

        // Get output amount (how many items per action)
        // Use 'count' field from action output
        const outputAmount = action.count || action.baseAmount || 1;

        // Calculate efficiency multiplier
        // Formula matches original MWI Tools: 1 + efficiency%
        // Example: 150% efficiency → 1 + 1.5 = 2.5x multiplier
        const efficiencyMultiplier = 1 + (efficiencyBonus / 100);

        // Items produced per hour (with efficiency multiplier)
        const itemsPerHour = actionsPerHour * outputAmount * efficiencyMultiplier;

        // Extra items from Gourmet (Brewing/Cooking bonus)
        // Statistical average: itemsPerHour × gourmetChance
        const gourmetBonusItems = itemsPerHour * gourmetBonus;

        // Total items per hour (base + gourmet bonus)
        const totalItemsPerHour = itemsPerHour + gourmetBonusItems;

        // Calculate material costs (with artisan reduction if applicable)
        const materialCosts = this.calculateMaterialCosts(actionDetails, artisanBonus);

        // Total material cost per action
        const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

        // Cost per item
        const costPerItem = totalMaterialCost / outputAmount;

        // Get market price for the item
        const itemPrice = marketAPI.getPrice(itemHrid, 0);
        if (!itemPrice) {
            return null; // No market data
        }

        // Check pricing mode setting
        const useOptimistic = config.getSetting('profitCalc_optimisticPricing');

        // Get output price based on pricing mode
        // Conservative (default): Bid price (you receive when selling instantly)
        // Optimistic: Ask price (best case if you post sell orders and wait)
        let outputPrice = 0;
        if (useOptimistic) {
            outputPrice = itemPrice.ask;
        } else {
            outputPrice = itemPrice.bid;
        }

        // Apply market tax (2% tax on sales)
        const priceAfterTax = outputPrice * (1 - this.MARKET_TAX);

        // Profit per item
        const profitPerItem = priceAfterTax - costPerItem;

        // Profit per hour (includes Gourmet bonus items)
        // Base items at (sell - cost), Gourmet bonus items at full sell price
        const profitPerHour = (profitPerItem * itemsPerHour) + (gourmetBonusItems * priceAfterTax);

        return {
            itemName: itemDetails.name,
            itemHrid,
            actionTime,
            actionsPerHour,
            itemsPerHour,
            totalItemsPerHour,        // Items/hour including Gourmet bonus
            gourmetBonusItems,        // Extra items from Gourmet
            outputAmount,
            materialCosts,
            totalMaterialCost,
            costPerItem,
            itemPrice,
            priceAfterTax,            // Output price after 2% tax (bid or ask based on mode)
            profitPerItem,
            profitPerHour,
            efficiencyBonus,         // Total efficiency
            levelEfficiency,          // Level advantage efficiency
            houseEfficiency,          // House room efficiency
            equipmentEfficiency,      // Equipment efficiency
            teaEfficiency,            // Tea buff efficiency
            actionLevelBonus,         // Action Level bonus from teas (e.g., Artisan Tea)
            artisanBonus,             // Artisan material cost reduction
            gourmetBonus,             // Gourmet bonus item chance
            processingBonus,          // Processing conversion chance
            drinkConcentration,       // Drink Concentration stat
            efficiencyMultiplier,
            equipmentSpeedBonus,
            skillLevel,
            baseRequirement,          // Base requirement level
            effectiveRequirement,     // Requirement after Action Level bonus
            requiredLevel: effectiveRequirement, // For backwards compatibility
            timeBreakdown
        };
    }

    /**
     * Find the action that produces a given item
     * @param {string} itemHrid - Item HRID
     * @returns {Object|null} Action output data or null
     */
    findProductionAction(itemHrid) {
        const initData = dataManager.getInitClientData();
        if (!initData) {
            return null;
        }

        // Search through all actions for one that produces this item
        for (const [actionHrid, action] of Object.entries(initData.actionDetailMap)) {
            if (action.outputItems) {
                for (const output of action.outputItems) {
                    if (output.itemHrid === itemHrid) {
                        return {
                            actionHrid,
                            ...output
                        };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Calculate material costs for an action
     * @param {Object} actionDetails - Action details from game data
     * @param {number} artisanBonus - Artisan material reduction (0 to 1, e.g., 0.112 for 11.2% reduction)
     * @returns {Array} Array of material cost objects
     */
    calculateMaterialCosts(actionDetails, artisanBonus = 0) {
        const costs = [];

        // Check pricing mode setting
        const useOptimistic = config.getSetting('profitCalc_optimisticPricing');

        // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
        if (actionDetails.upgradeItemHrid) {
            const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);
            const price = marketAPI.getPrice(actionDetails.upgradeItemHrid, 0);

            if (itemDetails) {
                // Get market price based on pricing mode
                // Conservative (default): Ask price (you pay when buying instantly)
                // Optimistic: Bid price (best case if you post buy orders and wait)
                let materialPrice = 0;
                if (useOptimistic) {
                    materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                } else {
                    materialPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
                }

                // Special case: Coins have no market price but have face value of 1
                if (actionDetails.upgradeItemHrid === '/items/coin' && materialPrice === 0) {
                    materialPrice = 1;
                }

                // Apply artisan reduction (upgrade items count as 1 item)
                const reducedAmount = 1 * (1 - artisanBonus);

                costs.push({
                    itemHrid: actionDetails.upgradeItemHrid,
                    itemName: itemDetails.name,
                    baseAmount: 1,
                    amount: reducedAmount,
                    askPrice: materialPrice,
                    totalCost: materialPrice * reducedAmount
                });
            }
        }

        // Process regular input items
        if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
            for (const input of actionDetails.inputItems) {
                const itemDetails = dataManager.getItemDetails(input.itemHrid);
                const price = marketAPI.getPrice(input.itemHrid, 0);

                if (!itemDetails) {
                    continue;
                }

                // Use 'count' field (not 'amount')
                const baseAmount = input.count || input.amount || 1;

                // Apply artisan reduction
                const reducedAmount = baseAmount * (1 - artisanBonus);

                // Get market price based on pricing mode
                // Conservative (default): Ask price (you pay when buying instantly)
                // Optimistic: Bid price (best case if you post buy orders and wait)
                let materialPrice = 0;
                if (useOptimistic) {
                    materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                } else {
                    materialPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
                }

                // Special case: Coins have no market price but have face value of 1
                if (input.itemHrid === '/items/coin' && materialPrice === 0) {
                    materialPrice = 1; // 1 coin = 1 gold value
                }

                costs.push({
                    itemHrid: input.itemHrid,
                    itemName: itemDetails.name,
                    baseAmount: baseAmount,
                    amount: reducedAmount,
                    askPrice: materialPrice,
                    totalCost: materialPrice * reducedAmount
                });
            }
        }

        return costs;
    }

    /**
     * Get character skill level for a skill type
     * @param {Array} skills - Character skills array
     * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
     * @returns {number} Skill level
     */
    getSkillLevel(skills, skillType) {
        // Map action type to skill HRID
        // e.g., "/action_types/cheesesmithing" -> "/skills/cheesesmithing"
        const skillHrid = skillType.replace('/action_types/', '/skills/');

        const skill = skills.find(s => s.skillHrid === skillHrid);
        return skill?.level || 1;
    }

    /**
     * Calculate efficiency bonus from multiple sources
     * @param {number} characterLevel - Character's skill level
     * @param {number} requiredLevel - Action's required level
     * @param {string} actionTypeHrid - Action type HRID for house room matching
     * @returns {number} Total efficiency bonus percentage
     */
    calculateEfficiencyBonus(characterLevel, requiredLevel, actionTypeHrid) {
        // Level efficiency: +1% per level above requirement
        const levelEfficiency = Math.max(0, characterLevel - requiredLevel);

        // House room efficiency: houseLevel × 1.5%
        const houseEfficiency = calculateHouseEfficiency(actionTypeHrid);

        // Total efficiency (sum of all sources)
        const totalEfficiency = levelEfficiency + houseEfficiency;

        return totalEfficiency;

        // TODO: Add tea efficiency bonus (Phase 3)
        // TODO: Add equipment efficiency bonus
    }

    /**
     * Calculate time breakdown showing how modifiers affect action time
     * @param {number} baseTime - Base action time in seconds
     * @param {number} equipmentSpeedBonus - Equipment speed bonus as decimal (e.g., 0.15 for 15%)
     * @returns {Object} Time breakdown with steps
     */
    calculateTimeBreakdown(baseTime, equipmentSpeedBonus) {
        const steps = [];

        // Equipment Speed step (if > 0)
        if (equipmentSpeedBonus > 0) {
            const finalTime = baseTime / (1 + equipmentSpeedBonus);
            const reduction = baseTime - finalTime;

            steps.push({
                name: 'Equipment Speed',
                bonus: equipmentSpeedBonus * 100, // convert to percentage
                reduction: reduction, // seconds saved
                timeAfter: finalTime // final time
            });

            return {
                baseTime: baseTime,
                steps: steps,
                finalTime: finalTime,
                actionsPerHour: 3600 / finalTime
            };
        }

        // No modifiers - final time is base time
        return {
            baseTime: baseTime,
            steps: [],
            finalTime: baseTime,
            actionsPerHour: 3600 / baseTime
        };
    }
}

// Create and export singleton instance
const profitCalculator = new ProfitCalculator();

export default profitCalculator;
