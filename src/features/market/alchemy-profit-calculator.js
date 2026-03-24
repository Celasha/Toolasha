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
 * - Catalyst (type-specific): +15% multiplicative, consumed once per successful action
 * - Catalyst (prime): +25% multiplicative, consumed once per successful action
 * - Transmute under-level penalty: perLevel = 0.9 / itemLevel, applied when alchemyLevel < itemLevel
 * - Formula (coinify/decompose): finalRate = min(1, baseRate × (1 + catalystBonus) × (1 + teaBonus))
 * - Formula (transmute): finalRate = min(1, baseRate × (1 + catalyst + perLevel × (alchemyLvl - itemLvl)) × (1 + tea))
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { getDrinkConcentration } from '../../utils/tea-parser.js';
import { getItemPrice } from '../../utils/market-data.js';
import { SECONDS_PER_HOUR } from '../../utils/profit-constants.js';
import { getAlchemySuccessBonus } from '../../utils/buff-parser.js';
import {
    parseEquipmentSpeedBonuses,
    debugEquipmentSpeedBonuses,
    parseEssenceFindBonus,
    parseRareFindBonus,
} from '../../utils/equipment-parser.js';
import { calculateActionStats } from '../../utils/action-calculator.js';
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

// Catalyst item HRIDs — type-specific catalysts and the universal prime catalyst
const CATALYST_HRIDS = {
    coinify: '/items/catalyst_of_coinification',
    decompose: '/items/catalyst_of_decomposition',
    transmute: '/items/catalyst_of_transmutation',
    prime: '/items/prime_catalyst',
};

// Multiplicative success rate bonuses for catalysts (hardcoded — not in game data structures)
const CATALYST_BONUSES = {
    typeSpecific: 0.15, // 15% multiplicative
    prime: 0.25, // 25% multiplicative
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
     * @param {number} catalystBonus - Catalyst multiplicative bonus (0, 0.15, or 0.25)
     * @param {number|null} teaBonusOverride - If provided, use this instead of reading live buffs
     * @param {number} levelPenalty - Under-level penalty term (negative when below item level, 0 otherwise)
     * @returns {Object} Success rate breakdown { total, base, tea, catalyst, levelPenalty }
     */
    calculateSuccessRateBreakdown(baseRate, catalystBonus = 0, teaBonusOverride = null, levelPenalty = 0) {
        try {
            const teaBonus = teaBonusOverride !== null ? teaBonusOverride : getAlchemySuccessBonus();

            // Calculate final success rate:
            // base × (1 + catalyst + levelPenalty) × (1 + tea)
            // levelPenalty is 0 when at or above item level
            const total = Math.min(1.0, baseRate * (1 + catalystBonus + levelPenalty) * (1 + teaBonus));

            return {
                total: Math.max(0, total),
                base: baseRate,
                tea: teaBonus,
                catalyst: catalystBonus,
                levelPenalty,
            };
        } catch (error) {
            console.error('[AlchemyProfitCalculator] Failed to calculate success rate breakdown:', error);
            return {
                total: baseRate,
                base: baseRate,
                tea: 0,
                catalyst: 0,
            };
        }
    }

    /**
     * Find the best catalyst+tea combination for an alchemy action.
     * Evaluates 6 combinations (no/type/prime catalyst × no/live tea) and returns
     * the combo that yields the highest profitPerHour.
     *
     * @param {Object} params
     * @param {string} params.actionType - 'coinify' | 'decompose' | 'transmute'
     * @param {number} params.baseSuccessRate - Base success rate before modifiers
     * @param {number} params.actionsPerHour - Actions per hour (with efficiency)
     * @param {number} params.efficiencyDecimal - Efficiency as decimal
     * @param {number} params.actionTime - Action time in seconds
     * @param {number} params.alchemyBonusRevenue - Bonus revenue per hour (essences + rares)
     * @param {Function} params.computeNetProfit - fn(successRate) => netProfitPerAttempt
     * @param {Function} params.computeTeaCost - fn(teaBonus) => totalTeaCostPerHour
     * @param {number} [params.levelPenalty=0] - Under-level penalty for transmute
     * @returns {Object} { catalystBonus, catalystHrid, catalystPrice, teaBonus, teaCostPerHour, successRateBreakdown }
     */
    _bestCatalystCombo({
        actionType,
        baseSuccessRate,
        actionsPerHour,
        efficiencyDecimal,
        actionTime,
        alchemyBonusRevenue,
        computeNetProfit,
        computeTeaCost,
        levelPenalty = 0,
    }) {
        const liveTeaBonus = getAlchemySuccessBonus();
        const typeSpecificHrid = CATALYST_HRIDS[actionType];
        const primeCatalystHrid = CATALYST_HRIDS.prime;
        const typeSpecificPrice = getItemPrice(typeSpecificHrid, { context: 'profit', side: 'buy' }) ?? 0;
        const primeCatalystPrice = getItemPrice(primeCatalystHrid, { context: 'profit', side: 'buy' }) ?? 0;

        const combinations = [
            { catalystBonus: 0, catalystHrid: null, catalystPrice: 0, teaBonus: liveTeaBonus },
            { catalystBonus: 0, catalystHrid: null, catalystPrice: 0, teaBonus: 0 },
            {
                catalystBonus: CATALYST_BONUSES.typeSpecific,
                catalystHrid: typeSpecificHrid,
                catalystPrice: typeSpecificPrice,
                teaBonus: liveTeaBonus,
            },
            {
                catalystBonus: CATALYST_BONUSES.typeSpecific,
                catalystHrid: typeSpecificHrid,
                catalystPrice: typeSpecificPrice,
                teaBonus: 0,
            },
            {
                catalystBonus: CATALYST_BONUSES.prime,
                catalystHrid: primeCatalystHrid,
                catalystPrice: primeCatalystPrice,
                teaBonus: liveTeaBonus,
            },
            {
                catalystBonus: CATALYST_BONUSES.prime,
                catalystHrid: primeCatalystHrid,
                catalystPrice: primeCatalystPrice,
                teaBonus: 0,
            },
        ];

        let best = null;
        let bestProfitPerHour = -Infinity;

        for (const combo of combinations) {
            const successRateBreakdown = this.calculateSuccessRateBreakdown(
                baseSuccessRate,
                combo.catalystBonus,
                combo.teaBonus,
                levelPenalty
            );
            const successRate = successRateBreakdown.total;

            // Catalyst cost: consumed once per successful action
            const catalystCostPerAttempt = combo.catalystPrice * successRate;
            const catalystCostPerHour = catalystCostPerAttempt * actionsPerHour;

            const netProfitPerAttempt = computeNetProfit(successRate) - catalystCostPerAttempt;
            const teaCostPerHour = combo.teaBonus > 0 ? computeTeaCost(combo.teaBonus) : 0;

            const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
            const profitPerHour =
                profitPerSecond * SECONDS_PER_HOUR + alchemyBonusRevenue - teaCostPerHour - catalystCostPerHour;

            if (profitPerHour > bestProfitPerHour) {
                bestProfitPerHour = profitPerHour;
                best = {
                    ...combo,
                    successRateBreakdown,
                    successRate,
                    catalystCostPerAttempt,
                    catalystCostPerHour,
                    teaCostPerHour,
                    netProfitPerAttempt,
                    profitPerHour,
                };
            }
        }

        return best;
    }

    _liveSetupCombo({
        baseSuccessRate,
        actionsPerHour,
        efficiencyDecimal,
        actionTime,
        alchemyBonusRevenue,
        computeNetProfit,
        computeTeaCost,
        levelPenalty = 0,
    }) {
        const liveTeaBonus = getAlchemySuccessBonus();
        const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate, 0, liveTeaBonus, levelPenalty);
        const successRate = successRateBreakdown.total;
        const catalystCostPerAttempt = 0;
        const catalystCostPerHour = 0;
        const teaCostPerHour = liveTeaBonus > 0 ? computeTeaCost(liveTeaBonus) : 0;
        const netProfitPerAttempt = computeNetProfit(successRate);
        const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
        const profitPerHour = profitPerSecond * SECONDS_PER_HOUR + alchemyBonusRevenue - teaCostPerHour;
        return {
            catalystBonus: 0,
            catalystHrid: null,
            catalystPrice: 0,
            teaBonus: liveTeaBonus,
            successRateBreakdown,
            successRate,
            catalystCostPerAttempt,
            catalystCostPerHour,
            teaCostPerHour,
            netProfitPerAttempt,
            profitPerHour,
        };
    }

    /**
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (default 0)
     * @returns {Object|null} Detailed profit data or null if not coinifiable
     */
    calculateCoinifyProfit(itemHrid, enhancementLevel = 0, useLiveSetup = false) {
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

            // Get equipment for drink concentration and speed calculation
            const equipment = dataManager.getEquipment();

            // Calculate action speed breakdown with details
            const _baseTime = actionDetails.baseTimeCost / 1e9;
            const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

            // Get detailed equipment speed breakdown
            const allSpeedBonuses = debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
            const skillName = actionDetails.type.replace('/action_types/', '');
            const skillSpecificSpeed = skillName + 'Speed';
            const relevantSpeeds = allSpeedBonuses.filter((item) => {
                return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
            });

            // TODO: Add tea speed bonuses when tea-parser supports it
            const teaSpeed = 0;
            const actionSpeedBreakdown = {
                total: speedBonus + teaSpeed,
                equipment: speedBonus,
                tea: teaSpeed,
                equipmentDetails: relevantSpeeds.map((item) => ({
                    name: item.itemName,
                    enhancementLevel: item.enhancementLevel,
                    speedBonus: item.scaledBonus,
                })),
                teaDetails: [], // TODO: Add when tea speed is supported
            };

            // Get drink concentration separately (not in breakdown from calculateActionStats)
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Calculate input cost (material cost)
            const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;
            const pricePerItem = getItemPrice(itemHrid, { context: 'profit', side: 'buy', enhancementLevel });
            if (pricePerItem === null) {
                return null; // No market data
            }
            const materialCost = pricePerItem * bulkMultiplier;

            // Coinify has no coin cost — items go in, coins come out
            const coinCost = 0;

            // Calculate output value (coins produced)
            // Formula: sellPrice × bulkMultiplier × 5
            const coinsProduced = (itemDetails.sellPrice || 0) * bulkMultiplier * 5;

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

            // Calculate live tea cost (used for tea combinations)
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: 'buy' }),
            });

            // Find the best catalyst+tea combination (tooltip) or use live setup (action page)
            const _comboFn = useLiveSetup ? this._liveSetupCombo.bind(this) : this._bestCatalystCombo.bind(this);
            const combo = _comboFn({
                actionType: 'coinify',
                baseSuccessRate: BASE_SUCCESS_RATES.COINIFY,
                actionsPerHour: actionsPerHourWithEfficiency,
                efficiencyDecimal,
                actionTime,
                alchemyBonusRevenue: alchemyBonus.totalBonusRevenue,
                computeNetProfit: (successRate) => coinsProduced * successRate - (materialCost + coinCost),
                computeTeaCost: () => teaCostData.totalCostPerHour,
            });

            const {
                successRateBreakdown,
                successRate,
                catalystCostPerAttempt,
                catalystCostPerHour,
                teaCostPerHour,
                netProfitPerAttempt,
                profitPerHour: comboProfitPerHour,
            } = combo;

            // Revenue per attempt using winning combo's success rate
            const revenuePerAttempt = coinsProduced * successRate;
            const costPerAttempt = materialCost + coinCost + catalystCostPerAttempt;

            // Per-hour totals
            const materialCostPerHour = (materialCost + coinCost) * actionsPerHourWithEfficiency;
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            const profitPerHour = comboProfitPerHour;
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
                itemHrid: combo.catalystHrid,
                price: combo.catalystPrice,
                costPerSuccess: combo.catalystPrice,
                costPerAttempt: catalystCostPerAttempt,
                costPerHour: catalystCostPerHour,
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
                catalystPrice: combo.catalystPrice,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostPerHour,

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
                actionSpeedBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Winning catalyst/tea combo indicators (for tooltip icons)
                winningCatalystHrid: combo.catalystHrid,
                winningTeaUsed: combo.teaBonus > 0,

                // Pricing info
                pricingMode,
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
    calculateDecomposeProfit(itemHrid, enhancementLevel = 0, useLiveSetup = false) {
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

            // Get equipment for drink concentration and speed calculation
            const equipment = dataManager.getEquipment();

            // Calculate action speed breakdown with details
            const _baseTime = actionDetails.baseTimeCost / 1e9;
            const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

            // Get detailed equipment speed breakdown
            const allSpeedBonuses = debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
            const skillName = actionDetails.type.replace('/action_types/', '');
            const skillSpecificSpeed = skillName + 'Speed';
            const relevantSpeeds = allSpeedBonuses.filter((item) => {
                return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
            });

            // TODO: Add tea speed bonuses when tea-parser supports it
            const teaSpeed = 0;
            const actionSpeedBreakdown = {
                total: speedBonus + teaSpeed,
                equipment: speedBonus,
                tea: teaSpeed,
                equipmentDetails: relevantSpeeds.map((item) => ({
                    name: item.itemName,
                    enhancementLevel: item.enhancementLevel,
                    speedBonus: item.scaledBonus,
                })),
                teaDetails: [], // TODO: Add when tea speed is supported
            };
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Get input cost (market price of the item being decomposed)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'buy', enhancementLevel });
            if (inputPrice === null) {
                return null; // No market data
            }

            // Calculate output value
            let outputValue = 0;
            const dropDetails = [];

            // 1. Base decompose items (always received on success)
            for (const output of itemDetails.alchemyDetail.decomposeItems) {
                const outputPrice = getItemPrice(output.itemHrid, { context: 'profit', side: 'sell' });
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

                const essencePrice = getItemPrice('/items/enhancing_essence', { context: 'profit', side: 'sell' });
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

            // Get coin cost per action attempt
            // If not in action data, calculate as 1/5 of item's sell price
            const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2);

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

            // Calculate live tea cost (used for tea combinations)
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: 'buy' }),
            });

            // Find the best catalyst+tea combination (tooltip) or use live setup (action page)
            const _comboFn = useLiveSetup ? this._liveSetupCombo.bind(this) : this._bestCatalystCombo.bind(this);
            const combo = _comboFn({
                actionType: 'decompose',
                baseSuccessRate: BASE_SUCCESS_RATES.DECOMPOSE,
                actionsPerHour: actionsPerHourWithEfficiency,
                efficiencyDecimal,
                actionTime,
                alchemyBonusRevenue: alchemyBonus.totalBonusRevenue,
                computeNetProfit: (successRate) => outputValue * successRate - (inputPrice + coinCost),
                computeTeaCost: () => teaCostData.totalCostPerHour,
            });

            const {
                successRateBreakdown,
                successRate,
                catalystCostPerAttempt,
                catalystCostPerHour,
                teaCostPerHour,
                netProfitPerAttempt,
                profitPerHour: comboProfitPerHour,
            } = combo;

            // Revenue and cost using winning combo's success rate
            const revenuePerAttempt = outputValue * successRate;
            const costPerAttempt = inputPrice + coinCost + catalystCostPerAttempt;

            // Per-hour totals
            const materialCostPerHour = (inputPrice + coinCost) * actionsPerHourWithEfficiency;
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            const profitPerHour = comboProfitPerHour;
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
                itemHrid: combo.catalystHrid,
                price: combo.catalystPrice,
                costPerSuccess: combo.catalystPrice,
                costPerAttempt: catalystCostPerAttempt,
                costPerHour: catalystCostPerHour,
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
                catalystPrice: combo.catalystPrice,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostPerHour,

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
                actionSpeedBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Winning catalyst/tea combo indicators (for tooltip icons)
                winningCatalystHrid: combo.catalystHrid,
                winningTeaUsed: combo.teaBonus > 0,

                // Pricing info
                pricingMode,
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
    calculateTransmuteProfit(itemHrid, useLiveSetup = false) {
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

            // Calculate under-level penalty for transmute
            // Formula: perLevel × (alchemyLevel - itemLevel) where perLevel = 0.9 / itemLevel
            const itemLevel = itemDetails.itemLevel || 1;
            const skills = dataManager.getSkills();
            const alchemySkill = skills?.find((s) => s.skillHrid === '/skills/alchemy');
            const alchemyLevel = alchemySkill?.level || 1;
            const levelPenalty = alchemyLevel < itemLevel ? (0.9 / itemLevel) * (alchemyLevel - itemLevel) : 0;

            // Get alchemy action details
            const actionDetails = gameData.actionDetailMap['/actions/alchemy/transmute'];
            if (!actionDetails) {
                return null;
            }

            // Get pricing mode
            const pricingMode = config.getSettingValue('profitCalc_pricingMode', 'hybrid');

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

            // Get equipment for drink concentration and speed calculation
            const equipment = dataManager.getEquipment();

            // Calculate action speed breakdown with details
            const _baseTime = actionDetails.baseTimeCost / 1e9;
            const speedBonus = parseEquipmentSpeedBonuses(equipment, actionDetails.type, gameData.itemDetailMap);

            // Get detailed equipment speed breakdown
            const allSpeedBonuses = debugEquipmentSpeedBonuses(equipment, gameData.itemDetailMap);
            const skillName = actionDetails.type.replace('/action_types/', '');
            const skillSpecificSpeed = skillName + 'Speed';
            const relevantSpeeds = allSpeedBonuses.filter((item) => {
                return item.speedType === skillSpecificSpeed || item.speedType === 'skillingSpeed';
            });

            // TODO: Add tea speed bonuses when tea-parser supports it
            const teaSpeed = 0;
            const actionSpeedBreakdown = {
                total: speedBonus + teaSpeed,
                equipment: speedBonus,
                tea: teaSpeed,
                equipmentDetails: relevantSpeeds.map((item) => ({
                    name: item.itemName,
                    enhancementLevel: item.enhancementLevel,
                    speedBonus: item.scaledBonus,
                })),
                teaDetails: [], // TODO: Add when tea speed is supported
            };
            const drinkConcentration = getDrinkConcentration(equipment, gameData.itemDetailMap);

            // Get input cost (market price of the item being transmuted)
            const inputPrice = getItemPrice(itemHrid, { context: 'profit', side: 'buy' });
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

                const outputPrice = getItemPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
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

            // Get coin cost per action attempt
            // If not in action data, calculate as 1/5 of item's sell price per item
            const coinCost = actionDetails.coinCost || Math.floor((itemDetails.sellPrice || 0) * 0.2) * bulkMultiplier;

            // Gross material cost (before self-return adjustment)
            const grossMaterialCost = inputPrice * bulkMultiplier;

            // Calculate per-hour values
            // Convert efficiency from percentage to decimal
            const efficiencyDecimal = totalEfficiency / 100;
            const actionsPerHourWithEfficiency = calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

            // Calculate bonus revenue (essences + rares) from item level
            const alchemyBonus = calculateAlchemyBonusDrops(
                itemLevel,
                actionsPerHourWithEfficiency,
                equipment,
                gameData.itemDetailMap
            );

            // Calculate live tea cost (used for tea combinations)
            const teaCostData = calculateTeaCostsPerHour({
                drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                drinkConcentration,
                itemDetailMap: gameData.itemDetailMap,
                getItemPrice: (hrid) => getItemPrice(hrid, { context: 'profit', side: 'buy' }),
            });

            // Find the best catalyst+tea combination (tooltip) or use live setup (action page).
            // Note: selfReturnValue depends on successRate so it must be computed inside the combo loop.
            const _comboFn = useLiveSetup ? this._liveSetupCombo.bind(this) : this._bestCatalystCombo.bind(this);
            const combo = _comboFn({
                actionType: 'transmute',
                baseSuccessRate,
                actionsPerHour: actionsPerHourWithEfficiency,
                efficiencyDecimal,
                actionTime,
                alchemyBonusRevenue: alchemyBonus.totalBonusRevenue,
                computeNetProfit: (successRate) => {
                    const selfReturnVal = inputPrice * selfReturnRate * successRate * selfReturnCount;
                    const netMat = grossMaterialCost - selfReturnVal;
                    return expectedOutputValue * successRate - (netMat + coinCost);
                },
                computeTeaCost: () => teaCostData.totalCostPerHour,
                levelPenalty,
            });

            const {
                successRateBreakdown,
                successRate,
                catalystCostPerAttempt,
                catalystCostPerHour,
                teaCostPerHour,
                netProfitPerAttempt,
                profitPerHour: comboProfitPerHour,
            } = combo;

            // Compute final self-return and material cost using winning combo's success rate
            const selfReturnValue = inputPrice * selfReturnRate * successRate * selfReturnCount;
            const netMaterialCost = grossMaterialCost - selfReturnValue;

            // Revenue and cost using winning combo
            const revenuePerAttempt = expectedOutputValue * successRate;
            const costPerAttempt = netMaterialCost + coinCost + catalystCostPerAttempt;

            // Per-hour totals
            const materialCostPerHour = (netMaterialCost + coinCost) * actionsPerHourWithEfficiency;
            const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

            const profitPerHour = comboProfitPerHour;
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
                itemHrid: combo.catalystHrid,
                price: combo.catalystPrice,
                costPerSuccess: combo.catalystPrice,
                costPerAttempt: catalystCostPerAttempt,
                costPerHour: catalystCostPerHour,
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
                catalystPrice: combo.catalystPrice,
                costPerAttempt,
                incomePerAttempt: revenuePerAttempt,
                netProfitPerAttempt,

                // Per-hour costs
                materialCostPerHour,
                catalystCostPerHour,
                totalTeaCostPerHour: teaCostPerHour,

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
                actionSpeedBreakdown,
                rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

                // Winning catalyst/tea combo indicators (for tooltip icons)
                winningCatalystHrid: combo.catalystHrid,
                winningTeaUsed: combo.teaBonus > 0,

                // Pricing info
                pricingMode,
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
