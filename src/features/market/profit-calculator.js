/**
 * Profit Calculator Module
 * Calculates production costs and profit for crafted items
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateHouseEfficiency } from '../../utils/house-efficiency.js';
import { getActionEfficiencyContext } from '../../utils/efficiency.js';
import { calculateBonusRevenue } from '../../utils/bonus-revenue-calculator.js';
import { getItemPrice } from '../../utils/market-data.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import {
    calculateActionsPerHour,
    calculatePriceAfterTax,
    calculateProfitPerAction,
    calculateProfitPerDay,
    calculateTeaCostsPerHour,
    createPriceCache,
    resolveItemPrice,
} from '../../utils/profit-helpers.js';

/**
 * ProfitCalculator class handles profit calculations for production actions
 */
class ProfitCalculator {
    constructor() {
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

        const actionDetails = dataManager.getActionDetails(action.actionHrid);
        if (!actionDetails) {
            return null;
        }

        // Initialize price cache for this calculation
        const getCachedPrice = createPriceCache(getItemPrice);

        // Calculate base action time
        // Game uses NANOSECONDS (1e9 = 1 second)
        const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

        // Get character level for the action's skill
        const skillLevel = this.getSkillLevel(skills, actionDetails.type);

        // Community efficiency must be computed here (uses class-internal cache)
        const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
        const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);

        const effCtx = getActionEfficiencyContext(actionDetails, {
            isProduction: true,
            communityEfficiency,
        });

        const {
            equipment: characterEquipment,
            drinkSlots: activeDrinks,
            drinkConcentration,
            itemDetailMap,
            actionTime,
            artisanBonus,
            gourmetBonus,
            processingBonus,
            equipmentEfficiency,
            equipmentEfficiencyItems,
            houseEfficiency,
            teaEfficiency,
            achievementEfficiency,
            personalEfficiency,
            actionLevelBonus,
            teaSkillLevelBonus,
            baseRequirement,
            speedBonus: equipmentSpeedBonus,
            personalSpeedBonus,
            efficiencyBreakdown,
            efficiencyMultiplier,
        } = effCtx;

        const { totalEfficiency, levelEfficiency, effectiveRequirement } = efficiencyBreakdown;

        // Build time breakdown for display
        const timeBreakdown = this.calculateTimeBreakdown(baseTime, equipmentSpeedBonus + personalSpeedBonus);

        // Actions per hour (base rate without efficiency)
        const actionsPerHour = calculateActionsPerHour(actionTime);

        // Get output amount (how many items per action)
        // Use 'count' field from action output
        const outputAmount = action.count || action.baseAmount || 1;

        // efficiencyMultiplier comes from effCtx destructuring above

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
        const rawOutputPrice = getCachedPrice(itemHrid, { context: 'profit', side: 'sell' });
        const outputPriceMissing = rawOutputPrice === null;
        const craftingFallback = outputPriceMissing ? this.calculateCraftingCostFallback(itemHrid, getCachedPrice) : 0;
        const outputPriceEstimated = outputPriceMissing && craftingFallback > 0;
        const outputPrice = outputPriceMissing ? craftingFallback : rawOutputPrice;

        // Apply market tax (2% tax on sales)
        const priceAfterTax = calculatePriceAfterTax(outputPrice);

        // Cost per item (without efficiency scaling)
        const costPerItem = totalMaterialCost / outputAmount;

        // Material costs per hour (accounting for efficiency multiplier)
        // Efficiency repeats the action, consuming materials each time
        const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

        // Revenue per hour (gross, before tax)
        const revenuePerHour = itemsPerHour * outputPrice + gourmetBonusItems * outputPrice;

        // Calculate tea consumption costs (drinks consumed per hour)
        const teaCostData = calculateTeaCostsPerHour({
            drinkSlots: activeDrinks,
            drinkConcentration,
            itemDetailMap,
            getItemPrice: getCachedPrice,
        });
        const teaCosts = teaCostData.costs;
        const totalTeaCostPerHour = teaCostData.totalCostPerHour;

        // Calculate bonus revenue from essence and rare find drops (before profit calculation)
        const bonusRevenue = calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap);

        const hasMissingPrices =
            (outputPriceMissing && !outputPriceEstimated) ||
            materialCosts.some((material) => material.missingPrice) ||
            teaCostData.hasMissingPrices ||
            (bonusRevenue?.hasMissingPrices ?? false);

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

        // Calculate market tax (2% of gross revenue including bonus revenue)
        const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * MARKET_TAX;

        // Total costs per hour (materials + teas + market tax)
        const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour + marketTax;

        // Total costs per action (fixed, unaffected by efficiency)
        const totalCostPerAction =
            totalMaterialCost + totalTeaCostPerHour / actionsPerHour + marketTax / actionsPerHour;

        // Profit per hour (revenue + bonus revenue - total costs)
        const profitPerHour = revenuePerHour + efficiencyBoostedBonusRevenue - totalCostPerHour;

        // Profit per item (for display)
        const profitPerItem = profitPerHour / totalItemsPerHour;

        const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');

        return {
            itemName: itemDetails.name,
            itemHrid,
            actionTime,
            actionsPerHour,
            itemsPerHour,
            totalItemsPerHour, // Items/hour including Gourmet bonus
            gourmetBonusItems, // Extra items from Gourmet
            outputAmount,
            materialCosts,
            totalMaterialCost,
            materialCostPerHour, // Material costs per hour (with efficiency)
            totalCostPerAction, // Total cost per action (materials + tea + tax, no efficiency)
            teaCosts, // Tea consumption costs breakdown
            totalTeaCostPerHour, // Total tea costs per hour
            costPerItem,
            itemPrice,
            outputPrice, // Output price before tax (bid or ask based on mode)
            outputPriceMissing,
            outputPriceEstimated, // True when outputPriceMissing but crafting cost fallback resolved a price
            priceAfterTax, // Output price after 2% tax (bid or ask based on mode)
            revenuePerHour,
            profitPerItem,
            profitPerHour,
            profitPerAction: calculateProfitPerAction(profitPerHour, actionsPerHour * efficiencyMultiplier), // Profit per action
            profitPerDay: calculateProfitPerDay(profitPerHour), // Profit per day
            bonusRevenue, // Bonus revenue from essences and rare finds
            hasMissingPrices,
            totalEfficiency, // Total efficiency percentage
            levelEfficiency, // Level advantage efficiency
            houseEfficiency, // House room efficiency
            equipmentEfficiency, // Equipment efficiency
            equipmentEfficiencyItems, // Per-item equipment efficiency breakdown
            teaEfficiency, // Tea buff efficiency
            communityEfficiency, // Community buff efficiency
            achievementEfficiency, // Achievement buff efficiency
            personalEfficiency, // Personal buff (seal) efficiency
            actionLevelBonus, // Action Level bonus from teas (e.g., Artisan Tea)
            artisanBonus, // Artisan material cost reduction
            gourmetBonus, // Gourmet bonus item chance
            processingBonus, // Processing conversion chance
            drinkConcentration, // Drink Concentration stat
            teaSkillLevelBonus, // Tea skill level bonus (e.g., +8 from Ultra Cheesesmithing Tea)
            efficiencyMultiplier,
            equipmentSpeedBonus,
            personalSpeedBonus, // Personal buff (seal) speed bonus
            skillLevel,
            baseRequirement, // Base requirement level
            effectiveRequirement, // Requirement after Action Level bonus
            requiredLevel: effectiveRequirement, // For backwards compatibility
            timeBreakdown,
            pricingMode, // Pricing mode for display
        };
    }

    /**
     * Estimate an item's value from the cost of its crafting inputs.
     * Used as a fallback when the item has no market listing (e.g. refined items).
     * @param {string} itemHrid - Item HRID to estimate
     * @param {Function} getCachedPrice - Price lookup function
     * @returns {number} Estimated price (0 if no crafting action found)
     */
    calculateCraftingCostFallback(itemHrid, getCachedPrice) {
        const actionDetailMap = this.getActionDetailMap();
        for (const action of Object.values(actionDetailMap)) {
            if (!action.outputItems) continue;
            const output = action.outputItems.find((o) => o.itemHrid === itemHrid);
            if (!output) continue;
            let totalCost = 0;
            if (action.upgradeItemHrid) {
                const price = getCachedPrice(action.upgradeItemHrid, { context: 'profit', side: 'buy' }) ?? 0;
                totalCost += price;
            }
            for (const input of action.inputItems || []) {
                const price = getCachedPrice(input.itemHrid, { context: 'profit', side: 'buy' }) ?? 0;
                totalCost += price * (input.count || 1);
            }
            return totalCost / (output.count || 1);
        }
        return 0;
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
                            ...output,
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
                let resolved;
                if (actionDetails.upgradeItemHrid === '/items/coin') {
                    resolved = { price: 1, custom: false, missing: false };
                } else {
                    resolved = resolveItemPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' });
                }

                // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                const reducedAmount = 1;

                costs.push({
                    itemHrid: actionDetails.upgradeItemHrid,
                    itemName: itemDetails.name,
                    baseAmount: 1,
                    amount: reducedAmount,
                    askPrice: resolved.price,
                    totalCost: resolved.price * reducedAmount,
                    missingPrice: resolved.missing,
                    customPrice: resolved.custom,
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

                let resolved;
                if (input.itemHrid === '/items/coin') {
                    resolved = { price: 1, custom: false, missing: false };
                } else {
                    resolved = resolveItemPrice(input.itemHrid, { context: 'profit', side: 'buy' });
                }

                costs.push({
                    itemHrid: input.itemHrid,
                    itemName: itemDetails.name,
                    baseAmount: baseAmount,
                    amount: reducedAmount,
                    askPrice: resolved.price,
                    totalCost: resolved.price * reducedAmount,
                    missingPrice: resolved.missing,
                    customPrice: resolved.custom,
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

        const skill = skills.find((s) => s.skillHrid === skillHrid);
        if (!skill) {
            console.error(`[ProfitCalculator] Skill not found: ${skillHrid}`);
        }
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
                timeAfter: finalTime, // final time
            });

            return {
                baseTime: baseTime,
                steps: steps,
                finalTime: finalTime,
                actionsPerHour: calculateActionsPerHour(finalTime),
            };
        }

        // No modifiers - final time is base time
        return {
            baseTime: baseTime,
            steps: [],
            finalTime: baseTime,
            actionsPerHour: calculateActionsPerHour(baseTime),
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
}

const profitCalculator = new ProfitCalculator();

export default profitCalculator;
