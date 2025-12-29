/**
 * Combat Score Calculator
 * Calculates player gear score based on:
 * - House Score: Cost of battle houses
 * - Ability Score: Cost to reach current ability levels
 * - Equipment Score: Cost to enhance equipped items
 */

import { calculateAbilityCost } from '../../utils/ability-cost-calculator.js';
import { calculateBattleHousesCost } from '../../utils/house-cost-calculator.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';

/**
 * Token-based item data for untradeable back slot items (capes/cloaks/quivers)
 * These items are purchased with dungeon tokens and have no market data
 */
const CAPE_ITEM_TOKEN_DATA = {
    '/items/chimerical_quiver': {
        tokenCost: 35000,
        tokenShopItems: [
            { hrid: '/items/griffin_leather', cost: 600 },
            { hrid: '/items/manticore_sting', cost: 1000 },
            { hrid: '/items/jackalope_antler', cost: 1200 },
            { hrid: '/items/dodocamel_plume', cost: 3000 },
            { hrid: '/items/griffin_talon', cost: 3000 }
        ]
    },
    '/items/sinister_cape': {
        tokenCost: 27000,
        tokenShopItems: [
            { hrid: '/items/acrobats_ribbon', cost: 2000 },
            { hrid: '/items/magicians_cloth', cost: 2000 },
            { hrid: '/items/chaotic_chain', cost: 3000 },
            { hrid: '/items/cursed_ball', cost: 3000 }
        ]
    },
    '/items/enchanted_cloak': {
        tokenCost: 27000,
        tokenShopItems: [
            { hrid: '/items/royal_cloth', cost: 2000 },
            { hrid: '/items/knights_ingot', cost: 2000 },
            { hrid: '/items/bishops_scroll', cost: 2000 },
            { hrid: '/items/regal_jewel', cost: 3000 },
            { hrid: '/items/sundering_jewel', cost: 3000 }
        ]
    }
};

/**
 * Calculate combat score from profile data
 * @param {Object} profileData - Profile data from game
 * @returns {Promise<Object>} {total, house, ability, equipment, breakdown}
 */
export async function calculateCombatScore(profileData) {
    try {
        // 1. Calculate House Score
        const houseResult = calculateHouseScore(profileData);

        // 2. Calculate Ability Score
        const abilityResult = calculateAbilityScore(profileData);

        // 3. Calculate Equipment Score
        const equipmentResult = calculateEquipmentScore(profileData);

        const totalScore = houseResult.score + abilityResult.score + equipmentResult.score;

        return {
            total: totalScore,
            house: houseResult.score,
            ability: abilityResult.score,
            equipment: equipmentResult.score,
            equipmentHidden: profileData.profile?.hideWearableItems || false,
            breakdown: {
                houses: houseResult.breakdown,
                abilities: abilityResult.breakdown,
                equipment: equipmentResult.breakdown
            }
        };
    } catch (error) {
        console.error('[CombatScore] Error calculating score:', error);
        return {
            total: 0,
            house: 0,
            ability: 0,
            equipment: 0,
            equipmentHidden: false,
            breakdown: { houses: [], abilities: [], equipment: [] }
        };
    }
}

/**
 * Calculate house score from battle houses
 * @param {Object} profileData - Profile data
 * @returns {Object} {score, breakdown}
 */
function calculateHouseScore(profileData) {
    const characterHouseRooms = profileData.profile?.characterHouseRoomMap || {};

    const { totalCost, breakdown } = calculateBattleHousesCost(characterHouseRooms);

    // Convert to score (cost / 1 million)
    const score = totalCost / 1_000_000;

    // Format breakdown for display
    const formattedBreakdown = breakdown.map(house => ({
        name: `${house.name} ${house.level}`,
        value: (house.cost / 1_000_000).toFixed(1)
    }));

    return { score, breakdown: formattedBreakdown };
}

/**
 * Calculate ability score from equipped abilities
 * @param {Object} profileData - Profile data
 * @returns {Object} {score, breakdown}
 */
function calculateAbilityScore(profileData) {
    // Use equippedAbilities (not characterAbilities) to match MCS behavior
    const equippedAbilities = profileData.profile?.equippedAbilities || [];

    let totalCost = 0;
    const breakdown = [];

    for (const ability of equippedAbilities) {
        if (!ability.abilityHrid || ability.level === 0) continue;

        const cost = calculateAbilityCost(ability.abilityHrid, ability.level);
        totalCost += cost;

        // Format ability name for display
        const abilityName = ability.abilityHrid
            .replace('/abilities/', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        breakdown.push({
            name: `${abilityName} ${ability.level}`,
            value: (cost / 1_000_000).toFixed(1)
        });
    }

    // Convert to score (cost / 1 million)
    const score = totalCost / 1_000_000;

    // Sort by value descending
    breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

    return { score, breakdown };
}

/**
 * Calculate token-based item value for untradeable back slot items
 * @param {string} itemHrid - Item HRID
 * @returns {number} Item value in coins (0 if not a token-based item)
 */
function calculateTokenBasedItemValue(itemHrid) {
    const capeData = CAPE_ITEM_TOKEN_DATA[itemHrid];
    if (!capeData) {
        return 0; // Not a token-based item
    }

    // Find the best value per token from shop items
    let bestValuePerToken = 0;
    for (const shopItem of capeData.tokenShopItems) {
        const marketPrice = marketAPI.getPrice(shopItem.hrid, 0);
        if (!marketPrice) continue;

        // Use ask price for shop items (instant buy cost)
        const shopItemPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
        if (shopItemPrice > 0) {
            const valuePerToken = shopItemPrice / shopItem.cost;
            if (valuePerToken > bestValuePerToken) {
                bestValuePerToken = valuePerToken;
            }
        }
    }

    // Calculate total item value: best value per token × token cost
    return bestValuePerToken * capeData.tokenCost;
}

/**
 * Calculate equipment score from equipped items
 * @param {Object} profileData - Profile data
 * @returns {Object} {score, breakdown}
 */
function calculateEquipmentScore(profileData) {
    const equippedItems = profileData.profile?.wearableItemMap || {};
    const hideEquipment = profileData.profile?.hideWearableItems || false;

    // If equipment is hidden, return 0
    if (hideEquipment) {
        return { score: 0, breakdown: [] };
    }

    const gameData = dataManager.getInitClientData();
    if (!gameData) return { score: 0, breakdown: [] };

    let totalValue = 0;
    const breakdown = [];

    for (const [slot, itemData] of Object.entries(equippedItems)) {
        if (!itemData?.itemHrid) continue;

        const itemHrid = itemData.itemHrid;
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) continue;

        // Get enhancement level from itemData (separate field, not in HRID)
        const enhancementLevel = itemData.enhancementLevel || 0;

        let itemCost = 0;

        // First, check if this is a token-based back slot item (cape/cloak/quiver)
        const tokenValue = calculateTokenBasedItemValue(itemHrid);
        if (tokenValue > 0) {
            itemCost = tokenValue;
        } else {
            // Try market price (most items are purchased, not self-enhanced)
            const marketPrice = marketAPI.getPrice(itemHrid, enhancementLevel);

            if (marketPrice && marketPrice.ask > 0 && marketPrice.bid > 0) {
                // Good market data exists - use actual market price
                let ask = marketPrice.ask;
                let bid = marketPrice.bid;

                // Match MCS behavior: if one price is positive and other is negative, use positive for both
                if (ask > 0 && bid < 0) {
                    bid = ask;
                }
                if (bid > 0 && ask < 0) {
                    ask = bid;
                }

                itemCost = (ask + bid) / 2;
            } else if (enhancementLevel > 1) {
                // No market data or illiquid - calculate enhancement cost
                const enhancementParams = getEnhancingParams();
                const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                if (enhancementPath && enhancementPath.optimalStrategy) {
                    itemCost = enhancementPath.optimalStrategy.totalCost;
                } else {
                    // Fallback to base market price if enhancement calculation fails
                    const basePrice = marketAPI.getPrice(itemHrid, 0);
                    if (basePrice) {
                        let ask = basePrice.ask;
                        let bid = basePrice.bid;

                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        itemCost = (ask + bid) / 2;
                    }
                }
            } else {
                // Enhancement level 0 or 1, just use base market price
                const basePrice = marketAPI.getPrice(itemHrid, 0);
                if (basePrice) {
                    let ask = basePrice.ask;
                    let bid = basePrice.bid;

                    if (ask > 0 && bid < 0) {
                        bid = ask;
                    }
                    if (bid > 0 && ask < 0) {
                        ask = bid;
                    }

                    itemCost = (ask + bid) / 2;
                }
            }
        }

        totalValue += itemCost;

        // Format item name for display
        const itemName = itemDetails.name || itemHrid.replace('/items/', '');
        const displayName = enhancementLevel > 0 ? `${itemName} +${enhancementLevel}` : itemName;

        breakdown.push({
            name: displayName,
            value: (itemCost / 1_000_000).toFixed(1)
        });
    }

    // Convert to score (value / 1 million)
    const score = totalValue / 1_000_000;

    // Sort by value descending
    breakdown.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

    return { score, breakdown };
}
