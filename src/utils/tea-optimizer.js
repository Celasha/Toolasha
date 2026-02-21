/**
 * Tea Optimizer Utility
 * Calculates optimal tea combinations for XP or Gold optimization
 */

import dataManager from '../core/data-manager.js';
import { calculateEfficiencyBreakdown, calculateEfficiencyMultiplier } from './efficiency.js';
import { calculateExperienceMultiplier } from './experience-parser.js';
import { getDrinkConcentration } from './tea-parser.js';
import { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } from './equipment-parser.js';
import { calculateActionsPerHour, calculateEffectiveActionsPerHour, calculateDrinksPerHour } from './profit-helpers.js';
import { getItemPrice } from './market-data.js';
import { calculateBonusRevenue } from './bonus-revenue-calculator.js';

// Skill name to action type mapping
const SKILL_TO_ACTION_TYPE = {
    milking: '/action_types/milking',
    foraging: '/action_types/foraging',
    woodcutting: '/action_types/woodcutting',
    cheesesmithing: '/action_types/cheesesmithing',
    crafting: '/action_types/crafting',
    tailoring: '/action_types/tailoring',
    cooking: '/action_types/cooking',
    brewing: '/action_types/brewing',
    alchemy: '/action_types/alchemy',
};

const GATHERING_SKILLS = ['milking', 'foraging', 'woodcutting'];
const PRODUCTION_SKILLS = ['cheesesmithing', 'crafting', 'tailoring', 'cooking', 'brewing', 'alchemy'];

/**
 * Get all relevant teas for a skill and optimization goal
 * Returns teas grouped by exclusivity (skill teas are mutually exclusive)
 * @param {string} skillName - Skill name (e.g., 'milking')
 * @param {string} goal - 'xp' or 'gold'
 * @returns {Object} { skillTeas: [], generalTeas: [] }
 */
function getRelevantTeas(skillName, goal) {
    const skill = skillName.toLowerCase();
    const isGathering = GATHERING_SKILLS.includes(skill);

    // Skill-specific teas (mutually exclusive - can only equip ONE)
    const skillTeas = [`/items/${skill}_tea`, `/items/super_${skill}_tea`, `/items/ultra_${skill}_tea`];

    // General teas (can equip any combination)
    const generalTeas = new Set();

    // Universal efficiency tea
    generalTeas.add('/items/efficiency_tea');

    // Artisan tea - action level helps everyone, artisan buff helps production gold
    generalTeas.add('/items/artisan_tea');

    if (goal === 'xp') {
        // Wisdom tea for XP multiplier
        generalTeas.add('/items/wisdom_tea');
    } else if (goal === 'gold') {
        if (isGathering) {
            // Gathering-specific gold teas
            generalTeas.add('/items/gathering_tea');
            generalTeas.add('/items/processing_tea');
        } else if (skill === 'cooking' || skill === 'brewing') {
            // Gourmet tea only applies to cooking and brewing
            generalTeas.add('/items/gourmet_tea');
        }
    }

    // Filter to only teas that exist in game data
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) {
        return { skillTeas: [], generalTeas: [] };
    }

    return {
        skillTeas: skillTeas.filter((hrid) => gameData.itemDetailMap[hrid]),
        generalTeas: Array.from(generalTeas).filter((hrid) => gameData.itemDetailMap[hrid]),
    };
}

/**
 * Generate all valid tea combinations respecting exclusivity rules
 * - Can only use ONE skill-specific tea (mutually exclusive)
 * - Can use any combination of general teas
 * - Max 3 teas total
 * @param {Object} teaGroups - { skillTeas: [], generalTeas: [] }
 * @returns {Array<Array<string>>} Array of valid tea combinations
 */
function generateCombinations(teaGroups) {
    const { skillTeas, generalTeas } = teaGroups;
    const combinations = [];

    // Helper to add combination if valid
    const addCombo = (combo) => {
        if (combo.length > 0 && combo.length <= 3) {
            combinations.push(combo);
        }
    };

    // Option 1: No skill tea, only general teas (1-3 general teas)
    for (let i = 0; i < generalTeas.length; i++) {
        addCombo([generalTeas[i]]);
        for (let j = i + 1; j < generalTeas.length; j++) {
            addCombo([generalTeas[i], generalTeas[j]]);
            for (let k = j + 1; k < generalTeas.length; k++) {
                addCombo([generalTeas[i], generalTeas[j], generalTeas[k]]);
            }
        }
    }

    // Option 2: One skill tea + general teas (1 skill + 0-2 general)
    for (const skillTea of skillTeas) {
        // Just skill tea alone
        addCombo([skillTea]);

        // Skill tea + 1 general tea
        for (let i = 0; i < generalTeas.length; i++) {
            addCombo([skillTea, generalTeas[i]]);

            // Skill tea + 2 general teas
            for (let j = i + 1; j < generalTeas.length; j++) {
                addCombo([skillTea, generalTeas[i], generalTeas[j]]);
            }
        }
    }

    return combinations;
}

/**
 * Parse tea buffs from a tea combination
 * @param {Array<string>} teaHrids - Array of tea item HRIDs
 * @param {Object} itemDetailMap - Item details from game data
 * @param {number} drinkConcentration - Drink concentration as decimal
 * @returns {Object} Aggregated buff values
 */
function parseTeaBuffs(teaHrids, itemDetailMap, drinkConcentration) {
    const buffs = {
        efficiency: 0,
        wisdom: 0,
        gathering: 0,
        processing: 0,
        artisan: 0,
        gourmet: 0,
        actionLevel: 0,
        skillLevels: {}, // skill name → level bonus
    };

    for (const teaHrid of teaHrids) {
        const itemDetails = itemDetailMap[teaHrid];
        if (!itemDetails?.consumableDetail?.buffs) continue;

        for (const buff of itemDetails.consumableDetail.buffs) {
            const baseValue = buff.flatBoost || 0;
            const scaledValue = baseValue * (1 + drinkConcentration);

            switch (buff.typeHrid) {
                case '/buff_types/efficiency':
                    buffs.efficiency += scaledValue * 100; // Convert to percentage
                    break;
                case '/buff_types/wisdom':
                    buffs.wisdom += scaledValue * 100;
                    break;
                case '/buff_types/gathering':
                    buffs.gathering += scaledValue;
                    break;
                case '/buff_types/processing':
                    buffs.processing += scaledValue;
                    break;
                case '/buff_types/artisan':
                    buffs.artisan += scaledValue;
                    break;
                case '/buff_types/gourmet':
                    buffs.gourmet += scaledValue;
                    break;
                case '/buff_types/action_level':
                    buffs.actionLevel += scaledValue;
                    break;
                default:
                    // Check for skill level buffs (e.g., /buff_types/milking_level)
                    if (buff.typeHrid.endsWith('_level')) {
                        const skillMatch = buff.typeHrid.match(/\/buff_types\/(\w+)_level/);
                        if (skillMatch) {
                            const skill = skillMatch[1];
                            buffs.skillLevels[skill] = (buffs.skillLevels[skill] || 0) + scaledValue;
                        }
                    }
            }
        }
    }

    return buffs;
}

/**
 * Calculate XP/hour for an action with a specific tea combination
 * @param {Object} actionDetails - Action details from game data
 * @param {Object} buffs - Parsed tea buffs
 * @param {number} playerLevel - Player's skill level
 * @param {Object} otherEfficiency - Other efficiency sources (house, equipment, etc.)
 * @param {Object} context - Additional context (equipment, itemDetailMap)
 * @returns {number} XP per hour
 */
function calculateXpPerHour(actionDetails, buffs, playerLevel, otherEfficiency, context) {
    if (!actionDetails.experienceGain?.value) {
        return 0;
    }

    const { equipment, itemDetailMap } = context;
    const requiredLevel = actionDetails.levelRequirement?.level || 1;
    const skillName = actionDetails.type.split('/').pop();

    // Calculate tea skill level bonus for this skill
    const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

    // Get equipment speed bonus
    const equipmentSpeedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Get equipment efficiency bonus
    const equipmentEfficiencyBonus = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Calculate efficiency breakdown
    const efficiencyData = calculateEfficiencyBreakdown({
        requiredLevel,
        skillLevel: playerLevel,
        teaSkillLevelBonus,
        actionLevelBonus: buffs.actionLevel,
        houseEfficiency: otherEfficiency.house || 0,
        equipmentEfficiency: equipmentEfficiencyBonus,
        teaEfficiency: buffs.efficiency,
        communityEfficiency: otherEfficiency.community || 0,
        achievementEfficiency: otherEfficiency.achievement || 0,
    });

    const totalEfficiency = efficiencyData.totalEfficiency;
    const efficiencyMultiplier = calculateEfficiencyMultiplier(totalEfficiency);

    // Calculate actions per hour with equipment speed bonus
    const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
    const actionTime = baseTime / (1 + equipmentSpeedBonus);
    const baseActionsPerHour = calculateActionsPerHour(actionTime);
    const actionsPerHour = calculateEffectiveActionsPerHour(baseActionsPerHour, efficiencyMultiplier);

    // Get the FULL XP multiplier from all sources
    const skillHrid = actionDetails.experienceGain.skillHrid;
    const currentXpData = calculateExperienceMultiplier(skillHrid, actionDetails.type);

    // Replace current tea wisdom with our calculated tea wisdom
    const currentTeaWisdom = currentXpData.breakdown?.consumableWisdom || 0;
    const baseWisdomWithoutTea = currentXpData.totalWisdom - currentTeaWisdom;
    const totalWisdomWithOurTea = baseWisdomWithoutTea + buffs.wisdom;
    const charmExperience = currentXpData.charmExperience || 0;
    const xpMultiplier = 1 + totalWisdomWithOurTea / 100 + charmExperience / 100;

    // XP per hour
    const baseXp = actionDetails.experienceGain.value;
    return actionsPerHour * baseXp * xpMultiplier;
}

/**
 * Calculate Gold/hour for a gathering action with a specific tea combination
 * @param {Object} actionDetails - Action details from game data
 * @param {Object} buffs - Parsed tea buffs
 * @param {number} playerLevel - Player's skill level
 * @param {Object} otherEfficiency - Other efficiency sources
 * @param {Object} gameData - Full game data
 * @param {Object} context - Additional context (equipment, itemDetailMap)
 * @returns {number} Gold per hour (profit after market tax)
 */
function calculateGatheringGoldPerHour(actionDetails, buffs, playerLevel, otherEfficiency, gameData, context) {
    const { equipment, itemDetailMap } = context;
    const requiredLevel = actionDetails.levelRequirement?.level || 1;
    const skillName = actionDetails.type.split('/').pop();

    // Calculate tea skill level bonus for this skill
    const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

    // Get equipment speed bonus
    const equipmentSpeedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Get equipment efficiency bonus
    const equipmentEfficiencyBonus = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Calculate efficiency
    const efficiencyData = calculateEfficiencyBreakdown({
        requiredLevel,
        skillLevel: playerLevel,
        teaSkillLevelBonus,
        actionLevelBonus: buffs.actionLevel,
        houseEfficiency: otherEfficiency.house || 0,
        equipmentEfficiency: equipmentEfficiencyBonus,
        teaEfficiency: buffs.efficiency,
        communityEfficiency: otherEfficiency.community || 0,
        achievementEfficiency: otherEfficiency.achievement || 0,
    });

    const totalEfficiency = efficiencyData.totalEfficiency;
    const efficiencyMultiplier = calculateEfficiencyMultiplier(totalEfficiency);

    // Calculate actions per hour (with speed bonus, WITHOUT efficiency - efficiency applied to outputs)
    const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
    const actionTime = baseTime / (1 + equipmentSpeedBonus);
    const actionsPerHour = calculateActionsPerHour(actionTime);

    // Calculate revenue from drops
    let totalRevenue = 0;
    const dropTable = actionDetails.dropTable || [];
    const gatheringBonus = 1 + buffs.gathering + (otherEfficiency.gathering || 0);

    for (const drop of dropTable) {
        const dropRate = drop.dropRate || 1;
        const minCount = drop.minCount || 1;
        const maxCount = drop.maxCount || minCount;
        const avgCount = (minCount + maxCount) / 2;

        // Apply gathering bonus to quantity
        const avgAmountPerAction = avgCount * gatheringBonus;

        // Get item details and check if tradeable
        // Tradeable items have isTradable: true, non-tradeable items don't have this property
        const dropItemDetails = gameData.itemDetailMap[drop.itemHrid];
        const isTradeable = dropItemDetails?.isTradable === true;

        // Get item price (use 'sell' side for output items to match tile calculation)
        // Non-tradeable items have no market value
        const rawPrice = isTradeable ? getItemPrice(drop.itemHrid, { context: 'profit', side: 'sell' }) || 0 : 0;

        // Check for processing conversion
        if (buffs.processing > 0 && isTradeable) {
            const processedData = findProcessingConversion(drop.itemHrid, gameData);
            if (processedData) {
                // Check if processed item is also tradeable
                const processedItemDetails = gameData.itemDetailMap[processedData.outputItemHrid];
                const processedIsTradeable = processedItemDetails?.isTradable === true;
                const processedPrice = processedIsTradeable
                    ? getItemPrice(processedData.outputItemHrid, { context: 'profit', side: 'sell' }) || 0
                    : 0;
                const conversionRatio = processedData.conversionRatio;

                // Processing Tea check happens per action:
                // If procs (processingBonus% chance): Convert to processed
                const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);

                // Expected processed items per action
                const processedPerAction = buffs.processing * processedIfProcs;

                // Net processing bonus = processed value - cost of raw converted
                const processingNetValue =
                    actionsPerHour *
                    dropRate *
                    efficiencyMultiplier *
                    (processedPerAction * (processedPrice - conversionRatio * rawPrice));

                // Total = base raw revenue + processing net gain
                const baseRawItemsPerHour = actionsPerHour * dropRate * avgAmountPerAction * efficiencyMultiplier;
                totalRevenue += baseRawItemsPerHour * rawPrice + processingNetValue;
                continue;
            }
        }

        // No processing - simple calculation
        const itemsPerHour = actionsPerHour * dropRate * avgAmountPerAction * efficiencyMultiplier;
        totalRevenue += itemsPerHour * rawPrice;
    }

    // Add bonus revenue from essence and rare find drops
    const bonusRevenue = calculateBonusRevenue(actionDetails, actionsPerHour, equipment, itemDetailMap);
    const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;
    totalRevenue += efficiencyBoostedBonusRevenue;

    // Apply market tax (2%)
    const MARKET_TAX = 0.02;
    const profitPerHour = totalRevenue * (1 - MARKET_TAX);

    return profitPerHour;
}

/**
 * Calculate Gold/hour for a production action with a specific tea combination
 * @param {Object} actionDetails - Action details from game data
 * @param {Object} buffs - Parsed tea buffs
 * @param {number} playerLevel - Player's skill level
 * @param {Object} otherEfficiency - Other efficiency sources
 * @param {Object} gameData - Full game data
 * @param {Object} context - Additional context (equipment, itemDetailMap)
 * @returns {number} Gold per hour (profit after market tax)
 */
function calculateProductionGoldPerHour(actionDetails, buffs, playerLevel, otherEfficiency, gameData, context) {
    const { equipment, itemDetailMap } = context;
    const requiredLevel = actionDetails.levelRequirement?.level || 1;
    const skillName = actionDetails.type.split('/').pop();

    // Calculate tea skill level bonus for this skill
    const teaSkillLevelBonus = buffs.skillLevels[skillName] || 0;

    // Get equipment speed bonus
    const equipmentSpeedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Get equipment efficiency bonus
    const equipmentEfficiencyBonus = parseEquipmentEfficiencyBonuses(equipment, actionDetails.type, itemDetailMap) || 0;

    // Calculate efficiency
    const efficiencyData = calculateEfficiencyBreakdown({
        requiredLevel,
        skillLevel: playerLevel,
        teaSkillLevelBonus,
        actionLevelBonus: buffs.actionLevel,
        houseEfficiency: otherEfficiency.house || 0,
        equipmentEfficiency: equipmentEfficiencyBonus,
        teaEfficiency: buffs.efficiency,
        communityEfficiency: otherEfficiency.community || 0,
        achievementEfficiency: otherEfficiency.achievement || 0,
    });

    const totalEfficiency = efficiencyData.totalEfficiency;
    const efficiencyMultiplier = calculateEfficiencyMultiplier(totalEfficiency);

    // Calculate actions per hour (with speed bonus, WITHOUT efficiency - efficiency applied to outputs)
    const baseTime = (actionDetails.baseTimeCost || 3e9) / 1e9;
    const actionTime = baseTime / (1 + equipmentSpeedBonus);
    const actionsPerHour = calculateActionsPerHour(actionTime);

    // Calculate input costs (with artisan reduction for regular inputs)
    // Use 'buy' side for inputs to match tile calculation
    let inputCost = 0;
    const artisanReduction = 1 - buffs.artisan;

    // Add upgrade item cost (NOT affected by Artisan Tea)
    if (actionDetails.upgradeItemHrid) {
        let upgradePrice = getItemPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' }) || 0;
        // Special case: Coins have no market price but have face value of 1
        if (actionDetails.upgradeItemHrid === '/items/coin' && upgradePrice === 0) {
            upgradePrice = 1;
        }
        inputCost += upgradePrice; // Always 1 upgrade item, no artisan reduction
    }

    // Add regular input item costs (affected by Artisan Tea)
    for (const input of actionDetails.inputItems || []) {
        let price = getItemPrice(input.itemHrid, { context: 'profit', side: 'buy' }) || 0;
        // Special case: Coins have no market price but have face value of 1
        if (input.itemHrid === '/items/coin' && price === 0) {
            price = 1;
        }
        const effectiveCount = input.count * artisanReduction;
        inputCost += price * effectiveCount;
    }

    // Calculate output revenue (with gourmet bonus - only for cooking/brewing)
    // Use 'sell' side for outputs to match tile calculation
    let outputRevenue = 0;
    const isCookingOrBrewing =
        actionDetails.type === '/action_types/cooking' || actionDetails.type === '/action_types/brewing';
    const gourmetBonus = isCookingOrBrewing ? 1 + buffs.gourmet : 1;

    for (const output of actionDetails.outputItems || []) {
        // Check if output item is tradeable - non-tradeable items have no market value
        // Tradeable items have isTradable: true, non-tradeable items don't have this property
        const outputItemDetails = gameData.itemDetailMap[output.itemHrid];
        const isTradeable = outputItemDetails?.isTradable === true;

        const price = isTradeable ? getItemPrice(output.itemHrid, { context: 'profit', side: 'sell' }) || 0 : 0;

        const effectiveCount = output.count * gourmetBonus;
        outputRevenue += price * effectiveCount;
    }

    // Profit per action (before market tax)
    const profitPerAction = outputRevenue - inputCost;

    // Profit per hour (with efficiency applied once)
    const grossProfitPerHour = actionsPerHour * profitPerAction * efficiencyMultiplier;

    // Add bonus revenue from essence and rare find drops (same as tile calculation)
    const bonusRevenue = calculateBonusRevenue(actionDetails, actionsPerHour, equipment, itemDetailMap);
    const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

    // Apply market tax (2%) to revenue portion only (including bonus revenue)
    const MARKET_TAX = 0.02;
    const revenuePerHour = actionsPerHour * outputRevenue * efficiencyMultiplier;
    const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * MARKET_TAX;
    const netProfitPerHour = grossProfitPerHour + efficiencyBoostedBonusRevenue - marketTax;

    return netProfitPerHour;
}

/**
 * Find processing conversion for an item
 * @param {string} itemHrid - Item HRID
 * @param {Object} gameData - Game data
 * @returns {Object|null} Conversion data or null
 */
function findProcessingConversion(itemHrid, gameData) {
    const validProcessingTypes = ['/action_types/cheesesmithing', '/action_types/crafting', '/action_types/tailoring'];

    for (const [_actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (!validProcessingTypes.includes(action.type)) continue;

        const inputItem = action.inputItems?.[0];
        const outputItem = action.outputItems?.[0];

        if (inputItem?.itemHrid === itemHrid && outputItem) {
            return {
                outputItemHrid: outputItem.itemHrid,
                conversionRatio: inputItem.count,
            };
        }
    }

    return null;
}

/**
 * Get all actions for a skill that the player can do
 * @param {string} skillName - Skill name
 * @param {number} playerLevel - Player's skill level
 * @returns {Array<Object>} Array of action details
 */
/**
 * Get all actions for a skill, separating available from excluded
 * @param {string} skillName - Skill name
 * @param {number} playerLevel - Player's skill level
 * @returns {Object} { available: [], excluded: [] } with exclusion reasons
 */
function getActionsForSkill(skillName, playerLevel) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) return { available: [], excluded: [] };

    const actionType = SKILL_TO_ACTION_TYPE[skillName.toLowerCase()];
    if (!actionType) return { available: [], excluded: [] };

    const available = [];
    const excluded = [];

    for (const [_hrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (action.type !== actionType) {
            continue;
        }

        const requiredLevel = action.levelRequirement?.level || 1;
        if (playerLevel >= requiredLevel) {
            available.push(action);
        } else {
            excluded.push({
                action,
                reason: 'level',
                requiredLevel,
            });
        }
    }

    return { available, excluded };
}

/**
 * Calculate tea consumption cost per hour for a tea combination
 * Uses the same pricing logic as the tile calculation
 * @param {Array<string>} teaHrids - Array of tea item HRIDs
 * @param {number} drinkConcentration - Drink concentration as decimal
 * @returns {number} Total tea cost per hour
 */
function calculateTeaCostPerHour(teaHrids, drinkConcentration) {
    const drinksPerHour = calculateDrinksPerHour(drinkConcentration);
    let totalCost = 0;

    for (const teaHrid of teaHrids) {
        // Use getItemPrice with 'profit' context and 'buy' side to match tile calculation
        const price = getItemPrice(teaHrid, { context: 'profit', side: 'buy' }) || 0;
        totalCost += price * drinksPerHour;
    }

    return totalCost;
}

/**
 * Get other efficiency sources (non-tea)
 * @param {string} actionType - Action type HRID
 * @returns {Object} Other efficiency values
 */
function getOtherEfficiencySources(actionType) {
    const _equipment = dataManager.getEquipment();
    const houseRoomsMap = dataManager.getHouseRooms();
    const houseRooms = houseRoomsMap ? Array.from(houseRoomsMap.values()) : [];
    const gameData = dataManager.getInitClientData();

    const result = {
        house: 0,
        equipment: 0,
        community: 0,
        achievement: 0,
        wisdom: 0,
        gathering: 0,
    };

    if (!gameData) return result;

    // House efficiency
    if (houseRooms) {
        for (const room of houseRooms) {
            const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionType]) {
                result.house += (room.level || 0) * 1.5;
            }
        }
    }

    // Community efficiency buff - use production_efficiency for production skills
    // Match the tile's calculation from profit-calculator.js
    const isProductionType = PRODUCTION_SKILLS.some((skill) => actionType.includes(skill));
    const communityBuffType = isProductionType
        ? '/community_buff_types/production_efficiency'
        : '/community_buff_types/efficiency';
    const communityEffLevel = dataManager.getCommunityBuffLevel(communityBuffType);
    if (communityEffLevel) {
        // Get buff definition from game data for accurate calculation
        const buffDef = gameData.communityBuffTypeDetailMap?.[communityBuffType];
        if (buffDef?.usableInActionTypeMap?.[actionType] && buffDef?.buff) {
            // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
            const baseBonus = (buffDef.buff.flatBoost || 0) * 100;
            const levelBonus = (communityEffLevel - 1) * (buffDef.buff.flatBoostLevelBonus || 0) * 100;
            result.community = baseBonus + levelBonus;
        } else {
            // Fallback to old formula if buff doesn't apply to this action
            result.community = 0;
        }
    }

    // Community gathering buff
    const communityGatheringLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
    if (communityGatheringLevel) {
        result.gathering = 0.2 + (communityGatheringLevel - 1) * 0.005;
    }

    // Achievement gathering buff (stacks with community gathering)
    const achievementGathering = dataManager.getAchievementBuffFlatBoost(actionType, '/buff_types/gathering');
    result.gathering += achievementGathering;

    // Community wisdom buff
    const communityWisdomLevel = dataManager.getCommunityBuffLevel('/community_buff_types/experience');
    if (communityWisdomLevel) {
        result.wisdom = 20 + (communityWisdomLevel - 1) * 0.5;
    }

    // Achievement buffs
    result.achievement = dataManager.getAchievementBuffFlatBoost(actionType, '/buff_types/efficiency') * 100;

    // Equipment efficiency (simplified - would need full parser for accuracy)
    // For now, we'll skip this as it requires more complex parsing

    return result;
}

/**
 * Find optimal tea combination for a skill and goal
 * @param {string} skillName - Skill name (e.g., 'Milking')
 * @param {string} goal - 'xp' or 'gold'
 * @param {string|null} locationName - Optional location name to filter actions (e.g., "Silly Cow Valley")
 * @returns {Object} Optimization result
 */
export function findOptimalTeas(skillName, goal, locationName = null) {
    // DEBUG: Log when findOptimalTeas is called
    console.log(`[TEA-DEBUG] ========================================`);
    console.log(`[TEA-DEBUG] findOptimalTeas called:`);
    console.log(`[TEA-DEBUG]   skillName: ${skillName}`);
    console.log(`[TEA-DEBUG]   goal: ${goal}`);
    console.log(`[TEA-DEBUG]   locationName: ${locationName}`);
    console.log(`[TEA-DEBUG] ========================================`);

    const normalizedSkill = skillName.toLowerCase();
    const isGathering = GATHERING_SKILLS.includes(normalizedSkill);
    const isProduction = PRODUCTION_SKILLS.includes(normalizedSkill);

    if (!isGathering && !isProduction) {
        return { error: `Unknown skill: ${skillName}` };
    }

    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) {
        return { error: 'Game data not loaded' };
    }

    // Get player's skill level
    const skills = dataManager.getSkills();
    const skillHrid = `/skills/${normalizedSkill}`;
    let playerLevel = 1;
    for (const skill of skills || []) {
        if (skill.skillHrid === skillHrid) {
            playerLevel = skill.level;
            break;
        }
    }

    // Get drink concentration
    const equipment = dataManager.getEquipment();
    const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

    // Get relevant teas and generate combinations
    const relevantTeas = getRelevantTeas(normalizedSkill, goal);
    const combinations = generateCombinations(relevantTeas);

    // Get actions for this skill (available and excluded)
    const actionData = getActionsForSkill(normalizedSkill, playerLevel);
    let actions = actionData.available;
    let excludedActions = actionData.excluded;

    // Filter to specific location if provided (using game data category)
    if (locationName && gameData.actionCategoryDetailMap) {
        // Find the category HRID that matches this location name AND skill
        // Multiple skills can have categories with the same name (e.g., "Material" exists for both Tailoring and Cheesesmithing)
        // So we need to match the skill-specific category path
        let targetCategoryHrid = null;
        const skillPrefix = `/action_categories/${normalizedSkill}/`;

        for (const [categoryHrid, categoryDetail] of Object.entries(gameData.actionCategoryDetailMap)) {
            // Match both the category name AND ensure it's for the correct skill
            if (categoryDetail.name === locationName && categoryHrid.startsWith(skillPrefix)) {
                targetCategoryHrid = categoryHrid;
                break;
            }
        }

        // Filter actions to only those in this category
        if (targetCategoryHrid) {
            // Filter available actions
            actions = actions.filter((action) => action.category === targetCategoryHrid);

            // Also filter excluded actions to same category (so we only show relevant excluded items)
            excludedActions = excludedActions.filter((item) => item.action.category === targetCategoryHrid);
        }
    }

    // Check if there are no available actions (even if there are excluded ones)
    if (actions.length === 0) {
        const locationSuffix = locationName ? ` at ${locationName}` : '';
        if (excludedActions.length > 0) {
            const lowestLevel = Math.min(...excludedActions.map((item) => item.requiredLevel));
            return {
                error: `No actions available for ${skillName}${locationSuffix} at level ${playerLevel}. All actions require level ${lowestLevel}+.`,
            };
        } else {
            return { error: `No actions available for ${skillName}${locationSuffix} at level ${playerLevel}` };
        }
    }

    // Get other efficiency sources
    const actionType = SKILL_TO_ACTION_TYPE[normalizedSkill];
    const otherEfficiency = getOtherEfficiencySources(actionType);

    // Score each combination
    const results = [];

    // Create context for calculations
    const calcContext = {
        equipment,
        itemDetailMap: gameData.itemDetailMap,
    };

    // DEBUG: Log actions being evaluated
    console.log(`[TEA-DEBUG] Actions to evaluate (${actions.length}):`);
    actions.forEach((a, i) => {
        console.log(`[TEA-DEBUG]   ${i}: ${a.name} (${a.hrid})`);
        if (a.outputItems) {
            a.outputItems.forEach((o) => console.log(`[TEA-DEBUG]      output: ${o.itemHrid}`));
        }
    });

    for (const combo of combinations) {
        const buffs = parseTeaBuffs(combo, gameData.itemDetailMap, drinkConcentration);

        // Calculate tea cost per hour for this combo (only matters for gold goal)
        const teaCostPerHour = goal === 'gold' ? calculateTeaCostPerHour(combo, drinkConcentration) : 0;

        let totalScore = 0;
        let profitableCount = 0;
        const actionScores = [];

        // DEBUG: Only log detailed action processing for first combo to reduce spam
        const isFirstCombo = combo === combinations[0];
        if (isFirstCombo && goal === 'gold') {
            console.log(`[TEA-DEBUG] Processing first tea combo: ${combo.join(', ')}`);
        }

        for (const action of actions) {
            let score;
            if (goal === 'xp') {
                score = calculateXpPerHour(action, buffs, playerLevel, otherEfficiency, calcContext);
                totalScore += score;
            } else if (isGathering) {
                score = calculateGatheringGoldPerHour(
                    action,
                    buffs,
                    playerLevel,
                    otherEfficiency,
                    gameData,
                    calcContext
                );
                // Deduct tea costs from gold score
                score -= teaCostPerHour;
                // Only include profitable actions in gold calculations
                if (score > 0) {
                    totalScore += score;
                    profitableCount++;
                }
            } else {
                // DEBUG: Only log for first combo
                if (isFirstCombo) {
                    console.log(`[TEA-DEBUG] --- Calling calculateProductionGoldPerHour for: ${action.name} ---`);
                }
                score = calculateProductionGoldPerHour(
                    action,
                    buffs,
                    playerLevel,
                    otherEfficiency,
                    gameData,
                    calcContext
                );
                // Deduct tea costs from gold score
                score -= teaCostPerHour;

                // DEBUG: Log score for first combo
                if (isFirstCombo) {
                    console.log(`[TEA-DEBUG]   Final score for ${action.name}: ${score}`);
                }

                // Only include profitable actions in gold calculations
                if (score > 0) {
                    totalScore += score;
                    profitableCount++;
                }
            }

            actionScores.push({ action: action.name, score });
        }

        // DEBUG: Log summary for first combo
        if (isFirstCombo && goal === 'gold') {
            console.log(`[TEA-DEBUG] First combo summary:`);
            console.log(`[TEA-DEBUG]   totalScore: ${totalScore}`);
            console.log(`[TEA-DEBUG]   profitableCount: ${profitableCount}`);
        }

        // For gold, average across profitable actions only; for XP, average across all
        const avgDivisor = goal === 'gold' ? profitableCount || 1 : actions.length;

        results.push({
            teas: combo,
            totalScore,
            avgScore: totalScore / avgDivisor,
            actionScores,
            buffs,
            teaCostPerHour,
            profitableCount, // Track how many actions are profitable
        });
    }

    // Sort by total score (descending)
    results.sort((a, b) => b.totalScore - a.totalScore);

    // Get tea names for display
    const getTeaName = (hrid) => gameData.itemDetailMap[hrid]?.name || hrid;

    // Format excluded actions for display
    const excludedForDisplay = excludedActions
        .map((item) => ({
            action: item.action.name,
            reason: item.reason,
            requiredLevel: item.requiredLevel,
        }))
        .sort((a, b) => a.requiredLevel - b.requiredLevel);

    // Handle case where no actions are available (all excluded by level)
    if (results.length === 0 || !results[0]) {
        return {
            optimal: null,
            isConsistent: false,
            skill: skillName,
            goal,
            playerLevel,
            drinkConcentration,
            otherEfficiency,
            actionsEvaluated: 0,
            profitableActionsCount: 0,
            combinationsEvaluated: combinations.length,
            allResults: [],
            excludedActions: excludedForDisplay,
            teaCostPerHour: 0,
        };
    }

    // Check if top result is consistent across all actions
    const topResult = results[0];
    const isConsistent = topResult.actionScores.every((as, _i, _arr) => {
        return as.score > 0;
    });

    return {
        optimal: {
            teas: topResult.teas.map((hrid) => ({
                hrid,
                name: getTeaName(hrid),
            })),
            totalScore: topResult.totalScore,
            avgScore: topResult.avgScore,
            actionScores: topResult.actionScores,
            buffs: topResult.buffs, // Include for UI debugging
            profitableCount: topResult.profitableCount, // How many actions are profitable
        },
        isConsistent,
        skill: skillName,
        goal,
        playerLevel,
        drinkConcentration,
        otherEfficiency,
        actionsEvaluated: actions.length,
        profitableActionsCount: topResult.profitableCount, // For display in stats
        combinationsEvaluated: combinations.length,
        allResults: results.slice(0, 5).map((r) => ({
            teas: r.teas.map(getTeaName),
            avgScore: r.avgScore,
            teaCostPerHour: r.teaCostPerHour,
        })),
        excludedActions: excludedForDisplay, // Actions excluded due to level
        // Include top result's tea cost for debug
        teaCostPerHour: topResult.teaCostPerHour,
    };
}

/**
 * Get buff description for a tea
 * @param {string} teaHrid - Tea item HRID
 * @returns {string} Human-readable buff description
 */
export function getTeaBuffDescription(teaHrid, drinkConcentration = 0) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) return '';

    const itemDetails = gameData.itemDetailMap[teaHrid];
    if (!itemDetails?.consumableDetail?.buffs) return '';

    const dcMultiplier = 1 + drinkConcentration;
    const descriptions = [];

    for (const buff of itemDetails.consumableDetail.buffs) {
        const baseValue = buff.flatBoost || 0;
        const scaledValue = baseValue * dcMultiplier;
        const dcBonus = baseValue * drinkConcentration;

        switch (buff.typeHrid) {
            case '/buff_types/efficiency':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% eff', true));
                break;
            case '/buff_types/wisdom':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% XP', true));
                break;
            case '/buff_types/gathering':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% gathering', true));
                break;
            case '/buff_types/processing':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% processing', true));
                break;
            case '/buff_types/artisan':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% mat savings', true));
                break;
            case '/buff_types/gourmet':
                descriptions.push(formatBuffWithDC(scaledValue * 100, dcBonus * 100, '% extra output', true));
                break;
            case '/buff_types/action_level':
                descriptions.push(formatBuffWithDC(scaledValue, dcBonus, ' action lvl', false));
                break;
            default:
                if (buff.typeHrid.endsWith('_level')) {
                    const skill = buff.typeHrid.match(/\/buff_types\/(\w+)_level/)?.[1];
                    if (skill) {
                        descriptions.push(formatBuffWithDC(scaledValue, dcBonus, ` ${skill}`, false));
                    }
                }
        }
    }

    return descriptions.join(', ');
}

/**
 * Format a buff value with optional drink concentration bonus
 * @param {number} scaledValue - Total value including DC
 * @param {number} dcBonus - Just the DC bonus portion
 * @param {string} suffix - Unit suffix (e.g., '% eff', ' tailoring')
 * @param {boolean} isPercent - Whether to format as percentage
 * @returns {string} Formatted string like "+8.8 tailoring (+.8)"
 */
function formatBuffWithDC(scaledValue, dcBonus, suffix, isPercent) {
    // Format the main value
    const mainFormatted = isPercent
        ? `+${Number.isInteger(scaledValue) ? scaledValue : scaledValue.toFixed(1)}${suffix}`
        : `+${Number.isInteger(scaledValue) ? scaledValue : scaledValue.toFixed(1)}${suffix}`;

    // If no DC bonus, just return the main value
    if (dcBonus === 0) {
        return mainFormatted;
    }

    // Format the DC bonus (with % suffix if percentage)
    const dcFormatted = isPercent
        ? `(+${dcBonus < 1 ? dcBonus.toFixed(1) : dcBonus.toFixed(0)}%)`
        : `(+${dcBonus < 1 ? dcBonus.toFixed(1) : dcBonus.toFixed(0)})`;

    return `${mainFormatted} ${dcFormatted}`;
}

export default {
    findOptimalTeas,
    getTeaBuffDescription,
};
