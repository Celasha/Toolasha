/**
 * Profit Calculator Module
 * Calculates production costs and profit for crafted items
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import * as efficiency from '../../utils/efficiency.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses, parseEssenceFindBonus, parseRareFindBonus } from '../../utils/equipment-parser.js';
import { calculateHouseEfficiency, calculateHouseRareFind } from '../../utils/house-efficiency.js';
import { parseTeaEfficiency, getDrinkConcentration, parseArtisanBonus, parseGourmetBonus, parseProcessingBonus, parseActionLevelBonus } from '../../utils/tea-parser.js';
import expectedValueCalculator from './expected-value-calculator.js';

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

        // Get community buff bonus (Production Efficiency)
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
        const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);

        // Total efficiency bonus (all sources additive)
        const efficiencyBonus = levelEfficiency + houseEfficiency + equipmentEfficiency + teaEfficiency + communityEfficiency;

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

        // Get market price for the item
        const itemPrice = marketAPI.getPrice(itemHrid, 0);
        if (!itemPrice) {
            return null; // No market data
        }

        // Check pricing mode setting
        const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

        // Get output price based on pricing mode
        // conservative: Bid price (instant sell)
        // hybrid/optimistic: Ask price (patient sell orders)
        let outputPrice = 0;
        if (pricingMode === 'conservative') {
            outputPrice = itemPrice.bid;
        } else {
            // hybrid or optimistic both use Ask for output
            outputPrice = itemPrice.ask;
        }

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
        const teaCosts = this.calculateTeaCosts(actionDetails.type, actionsPerHour);
        const totalTeaCostPerHour = teaCosts.reduce((sum, tea) => sum + tea.totalCost, 0);

        // Total costs per hour (materials + teas)
        const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour;

        // Profit per hour (revenue - total costs)
        const profitPerHour = revenuePerHour - totalCostPerHour;

        // Profit per item (for display)
        const profitPerItem = profitPerHour / totalItemsPerHour;

        // Calculate bonus revenue from essence and rare find drops
        const bonusRevenue = this.calculateBonusRevenue(
            actionDetails,
            actionsPerHour,
            characterEquipment,
            initData?.itemDetailMap || {}
        );

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
        const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

        // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
        if (actionDetails.upgradeItemHrid) {
            const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);
            const price = marketAPI.getPrice(actionDetails.upgradeItemHrid, 0);

            if (itemDetails) {
                // Get material price based on pricing mode
                // conservative/hybrid: Ask price (instant buy)
                // optimistic: Bid price (patient buy orders)
                let materialPrice = 0;
                if (pricingMode === 'optimistic') {
                    materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                } else {
                    // conservative or hybrid both use Ask for materials
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

                // Get material price based on pricing mode
                // conservative/hybrid: Ask price (instant buy)
                // optimistic: Bid price (patient buy orders)
                let materialPrice = 0;
                if (pricingMode === 'optimistic') {
                    materialPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
                } else {
                    // conservative or hybrid both use Ask for materials
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
        const initData = dataManager.getInitClientData();
        const buffDef = initData.communityBuffTypeDetailMap?.['/community_buff_types/production_efficiency'];

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
    calculateTeaCosts(actionTypeHrid, actionsPerHour) {
        const activeDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);
        if (!activeDrinks || activeDrinks.length === 0) {
            return [];
        }

        // Check pricing mode for tea costs
        const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'conservative');

        const costs = [];

        for (const drink of activeDrinks) {
            if (!drink || !drink.itemHrid) continue;

            const itemDetails = dataManager.getItemDetails(drink.itemHrid);
            if (!itemDetails) continue;

            // Get market price for the tea
            const price = marketAPI.getPrice(drink.itemHrid, 0);

            // Use same pricing mode logic as materials
            let teaPrice = 0;
            if (pricingMode === 'optimistic') {
                teaPrice = (price?.bid && price.bid > 0) ? price.bid : 0;
            } else {
                // conservative or hybrid both use Ask for costs
                teaPrice = (price?.ask && price.ask > 0) ? price.ask : 0;
            }

            // Tea consumption: 12 drinks per hour (constant)
            const drinksPerHour = this.DRINKS_PER_HOUR;

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

    /**
     * Calculate bonus revenue from essence and rare find drops
     * @param {Object} actionDetails - Action details from game data
     * @param {number} actionsPerHour - Actions per hour
     * @param {Map} characterEquipment - Equipment map
     * @param {Object} itemDetailMap - Item details map
     * @returns {Object} Bonus revenue data with essence and rare find drops
     */
    calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap) {
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
}

// Create and export singleton instance
const profitCalculator = new ProfitCalculator();

export default profitCalculator;
