/**
 * Profit Calculator Module
 * Calculates production costs and profit for crafted items
 */

import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import * as efficiency from '../../utils/efficiency.js';

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

        // Calculate efficiency bonus
        const efficiencyBonus = this.calculateEfficiencyBonus(
            skillLevel,
            actionDetails.levelRequirement?.level || 1
        );

        // Calculate action time with efficiency
        const actionTime = baseTime / (1 + efficiencyBonus / 100);

        // Actions per hour
        const actionsPerHour = 3600 / actionTime;

        // Get output amount (how many items per action)
        // Use 'count' field from action output
        const outputAmount = action.count || action.baseAmount || 1;

        // Items produced per hour (before efficiency multiplier)
        const itemsPerHour = actionsPerHour * outputAmount;

        // Calculate material costs
        const materialCosts = this.calculateMaterialCosts(actionDetails);

        // Total material cost per action
        const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

        // Cost per item
        const costPerItem = totalMaterialCost / outputAmount;

        // Get market price for the item
        const itemPrice = marketAPI.getPrice(itemHrid, 0);
        if (!itemPrice) {
            return null; // No market data
        }

        // Bid price after 2% tax
        const bidAfterTax = itemPrice.bid * (1 - this.MARKET_TAX);

        // Profit per item
        const profitPerItem = bidAfterTax - costPerItem;

        // Profit per hour
        const profitPerHour = profitPerItem * itemsPerHour;

        return {
            itemName: itemDetails.name,
            itemHrid,
            actionTime,
            actionsPerHour,
            itemsPerHour,
            outputAmount,
            materialCosts,
            totalMaterialCost,
            costPerItem,
            itemPrice,
            bidAfterTax,
            profitPerItem,
            profitPerHour,
            efficiencyBonus,
            skillLevel,
            requiredLevel: actionDetails.levelRequirement?.level || 1
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
     * @returns {Array} Array of material cost objects
     */
    calculateMaterialCosts(actionDetails) {
        if (!actionDetails.inputItems || actionDetails.inputItems.length === 0) {
            return [];
        }

        const costs = [];

        for (const input of actionDetails.inputItems) {
            const itemDetails = dataManager.getItemDetails(input.itemHrid);
            const price = marketAPI.getPrice(input.itemHrid, 0);

            if (!itemDetails) {
                continue;
            }

            // Use 'count' field (not 'amount')
            const amount = input.count || input.amount || 1;

            costs.push({
                itemHrid: input.itemHrid,
                itemName: itemDetails.name,
                amount: amount,
                askPrice: price?.ask || 0,
                totalCost: (price?.ask || 0) * amount
            });
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
     * Calculate efficiency bonus from level advantage
     * @param {number} characterLevel - Character's skill level
     * @param {number} requiredLevel - Action's required level
     * @returns {number} Efficiency bonus percentage
     */
    calculateEfficiencyBonus(characterLevel, requiredLevel) {
        // +1% efficiency per level above requirement
        const levelAdvantage = Math.max(0, characterLevel - requiredLevel);
        return levelAdvantage * 1.0;

        // TODO: Add house room efficiency bonus
        // TODO: Add tea efficiency bonus
        // TODO: Add equipment efficiency bonus
    }
}

// Create and export singleton instance
const profitCalculator = new ProfitCalculator();

export default profitCalculator;
