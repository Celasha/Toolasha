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
import { parseTeaEfficiency, getDrinkConcentration, parseArtisanBonus, parseGourmetBonus, parseProcessingBonus, parseActionLevelBonus, parseTeaSkillLevelBonus } from '../../utils/tea-parser.js';
import expectedValueCalculator from './expected-value-calculator.js';
import { calculateBonusRevenue } from '../../utils/bonus-revenue-calculator.js';
import { getItemPrice } from '../../utils/market-data.js';

/**
 * ProfitCalculator class handles profit calculations for production actions
 */
class ProfitCalculator {
    constructor() {
        // Constants
        this.MARKET_TAX = 0.02; // 2% marketplace tax
        this.DRINKS_PER_HOUR = 12; // Average drink consumption per hour

        // Cached static game data (never changes during session)
        this._itemDetailMap = null;
        this._actionDetailMap = null;
        this._communityBuffMap = null;
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
     * Get action detail map (lazy-loaded and cached)
     * @returns {Object} Action details map from init_client_data
     */
    getActionDetailMap() {
        if (!this._actionDetailMap) {
            const initData = dataManager.getInitClientData();
            this._actionDetailMap = initData?.actionDetailMap || {};
        }
        return this._actionDetailMap;
    }

    /**
     * Get community buff map (lazy-loaded and cached)
     * @returns {Object} Community buff details map from init_client_data
     */
    getCommunityBuffMap() {
        if (!this._communityBuffMap) {
            const initData = dataManager.getInitClientData();
            this._communityBuffMap = initData?.communityBuffTypeDetailMap || {};
        }
        return this._communityBuffMap;
    }

    /**
     * Calculate profit for a crafted item
     * @param {string} itemHrid - Item HRID
     * @returns {Promise<Object|null>} Profit data or null if not craftable
     */
    async calculateProfit(itemHrid) {

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
        const itemDetailMap = this.getItemDetailMap();

        // Get Drink Concentration from equipment
        const drinkConcentration = getDrinkConcentration(
            characterEquipment,
            itemDetailMap
        );

        // Get active drinks for this action type
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);


        // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
        // This lowers the effective requirement, not increases skill level
        const actionLevelBonus = parseActionLevelBonus(
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate efficiency components
        // Action Level bonus increases the effective requirement
        const baseRequirement = actionDetails.levelRequirement?.level || 1;
        const effectiveRequirement = baseRequirement + actionLevelBonus;

        // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
        const teaSkillLevelBonus = parseTeaSkillLevelBonus(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Apply tea skill level bonus to effective player level
        const effectiveLevel = skillLevel + teaSkillLevelBonus;
        const levelEfficiency = Math.max(0, effectiveLevel - effectiveRequirement);

        const houseEfficiency = calculateHouseEfficiency(actionDetails.type);

        // Calculate equipment efficiency bonus
        const equipmentEfficiency = parseEquipmentEfficiencyBonuses(
            characterEquipment,
            actionDetails.type,
            itemDetailMap
        );

        // Calculate tea efficiency bonus
        const teaEfficiency = parseTeaEfficiency(
            actionDetails.type,
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate artisan material cost reduction
        const artisanBonus = parseArtisanBonus(
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate gourmet bonus (Brewing/Cooking extra items)
        const gourmetBonus = parseGourmetBonus(
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
        const processingBonus = parseProcessingBonus(
            activeDrinks,
            itemDetailMap,
            drinkConcentration
        );

        // Get community buff bonus (Production Efficiency)
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
        const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);


        // Total efficiency bonus (all sources additive)
        const efficiencyBonus = levelEfficiency + houseEfficiency + equipmentEfficiency + teaEfficiency + communityEfficiency;

        // Calculate equipment speed bonus
        const equipmentSpeedBonus = parseEquipmentSpeedBonuses(
            characterEquipment,
            actionDetails.type,
            itemDetailMap
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

        // Get market price for the item
        // Use fallback {ask: 0, bid: 0} if no market data exists (e.g., refined items)
        const itemPrice = marketAPI.getPrice(itemHrid, 0) || { ask: 0, bid: 0 };

        // Get output price based on pricing mode setting
        // Uses 'profit' context with 'sell' side to get correct sell price
        const outputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'sell' }) || 0;

        // Apply market tax (2% tax on sales)
        const priceAfterTax = outputPrice * (1 - this.MARKET_TAX);

        // Cost per item (without efficiency scaling)
        const costPerItem = totalMaterialCost / outputAmount;

        // Material costs per hour (accounting for efficiency multiplier)
        // Efficiency repeats the action, consuming materials each time
        const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

        // Revenue per hour (already accounts for efficiency in itemsPerHour calculation)
        const revenuePerHour = (itemsPerHour * priceAfterTax) + (gourmetBonusItems * priceAfterTax);

        // Calculate tea consumption costs (drinks consumed per hour)
        const teaCosts = this.calculateTeaCosts(actionDetails.type, actionsPerHour, drinkConcentration);
        const totalTeaCostPerHour = teaCosts.reduce((sum, tea) => sum + tea.totalCost, 0);

        // Total costs per hour (materials + teas)
        const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour;

        // Calculate bonus revenue from essence and rare find drops (before profit calculation)
        const bonusRevenue = calculateBonusRevenue(
            actionDetails,
            actionsPerHour,
            characterEquipment,
            itemDetailMap
        );

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

        // Profit per hour (revenue + bonus revenue - total costs)
        const profitPerHour = revenuePerHour + efficiencyBoostedBonusRevenue - totalCostPerHour;

        // Profit per item (for display)
        const profitPerItem = profitPerHour / totalItemsPerHour;

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
            materialCostPerHour,      // Material costs per hour (with efficiency)
            teaCosts,                 // Tea consumption costs breakdown
            totalTeaCostPerHour,      // Total tea costs per hour
            costPerItem,
            itemPrice,
            priceAfterTax,            // Output price after 2% tax (bid or ask based on mode)
            profitPerItem,
            profitPerHour,
            profitPerDay: profitPerHour * 24,  // Profit per day
            bonusRevenue,             // Bonus revenue from essences and rare finds
            efficiencyBonus,         // Total efficiency
            levelEfficiency,          // Level advantage efficiency
            houseEfficiency,          // House room efficiency
            equipmentEfficiency,      // Equipment efficiency
            teaEfficiency,            // Tea buff efficiency
            communityEfficiency,      // Community buff efficiency
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
        const actionDetailMap = this.getActionDetailMap();

        // Search through all actions for one that produces this item
        for (const [actionHrid, action] of Object.entries(actionDetailMap)) {
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

        // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
        if (actionDetails.upgradeItemHrid) {
            const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);

            if (itemDetails) {
                // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                let materialPrice = getItemPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' }) || 0;

                // Special case: Coins have no market price but have face value of 1
                if (actionDetails.upgradeItemHrid === '/items/coin' && materialPrice === 0) {
                    materialPrice = 1;
                }

                // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                const reducedAmount = 1;

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

                if (!itemDetails) {
                    continue;
                }

                // Use 'count' field (not 'amount')
                const baseAmount = input.count || input.amount || 1;

                // Apply artisan reduction
                const reducedAmount = baseAmount * (1 - artisanBonus);

                // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                let materialPrice = getItemPrice(input.itemHrid, { context: 'profit', side: 'buy' }) || 0;

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

    /**
     * Calculate community buff bonus for production efficiency
     * @param {number} buffLevel - Community buff level (0-20)
     * @param {string} actionTypeHrid - Action type to check if buff applies
     * @returns {number} Efficiency bonus percentage
     */
    calculateCommunityBuffBonus(buffLevel, actionTypeHrid) {
        if (buffLevel === 0) {
            return 0;
        }

        // Check if buff applies to this action type
        const communityBuffMap = this.getCommunityBuffMap();
        const buffDef = communityBuffMap['/community_buff_types/production_efficiency'];

        if (!buffDef?.usableInActionTypeMap?.[actionTypeHrid]) {
            return 0; // Buff doesn't apply to this skill
        }

        // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
        const baseBonus = buffDef.buff.flatBoost * 100; // 14%
        const levelBonus = (buffLevel - 1) * buffDef.buff.flatBoostLevelBonus * 100; // 0.3% per level

        return baseBonus + levelBonus;
    }

    /**
     * Calculate tea consumption costs
     * @param {string} actionTypeHrid - Action type HRID
     * @param {number} actionsPerHour - Actions per hour (not used, but kept for consistency)
     * @returns {Array} Array of tea cost objects
     */
    calculateTeaCosts(actionTypeHrid, actionsPerHour, drinkConcentration = 0) {
        const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);
        if (!activeDrinks || activeDrinks.length === 0) {
            return [];
        }

        const costs = [];

        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) continue;

            const itemDetails = dataManager.getItemDetails(drink.itemHrid);
            if (!itemDetails) continue;

            // Get tea price based on pricing mode (uses 'profit' context with 'buy' side)
            const teaPrice = getItemPrice(drink.itemHrid, { context: 'profit', side: 'buy' }) || 0;

            // Drink Concentration increases consumption rate: base 12/hour × (1 + DC%)
            const drinksPerHour = 12 * (1 + drinkConcentration);

            costs.push({
                itemHrid: drink.itemHrid,
                itemName: itemDetails.name,
                pricePerDrink: teaPrice,
                drinksPerHour: drinksPerHour,
                totalCost: teaPrice * drinksPerHour
            });
        }

        return costs;
    }
}

// Create and export singleton instance
const profitCalculator = new ProfitCalculator();

export default profitCalculator;
