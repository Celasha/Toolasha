/**
 * Toolasha Market Library
 * Market, inventory, and economy features
 * Version: 0.26.3
 * License: CC-BY-NC-SA-4.0
 */

(function (config, dataManager, domObserver, marketAPI, equipmentParser_js, houseEfficiency_js, efficiency_js, teaParser_js, bonusRevenueCalculator_js, marketData_js, profitConstants_js, profitHelpers_js, buffParser_js, actionCalculator_js, tokenValuation_js, enhancementCalculator_js, formatters_js, enhancementConfig_js, dom, timerRegistry_js, storage, cleanupRegistry_js, domObserverHelpers_js, enhancementMultipliers_js, webSocketHook, abilityCostCalculator_js, houseCostCalculator_js) {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

    /**
     * Profit Calculator Module
     * Calculates production costs and profit for crafted items
     */


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
            const priceCache = new Map();
            const getCachedPrice = (itemHridParam, options) => {
                const side = options?.side || '';
                const enhancementLevelParam = options?.enhancementLevel ?? '';
                const cacheKey = `${itemHridParam}|${side}|${enhancementLevelParam}`;

                if (priceCache.has(cacheKey)) {
                    return priceCache.get(cacheKey);
                }

                const price = marketData_js.getItemPrice(itemHridParam, options);
                priceCache.set(cacheKey, price);
                return price;
            };

            // Calculate base action time
            // Game uses NANOSECONDS (1e9 = 1 second)
            const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

            // Get character level for the action's skill
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);

            // Get equipped items for efficiency bonus calculation
            const characterEquipment = dataManager.getEquipment();
            const itemDetailMap = this.getItemDetailMap();

            // Get Drink Concentration from equipment
            const drinkConcentration = teaParser_js.getDrinkConcentration(characterEquipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
            // This lowers the effective requirement, not increases skill level
            const actionLevelBonus = teaParser_js.parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate efficiency components
            // Action Level bonus increases the effective requirement
            const baseRequirement = actionDetails.levelRequirement?.level || 1;
            // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate artisan material cost reduction
            const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate gourmet bonus (Brewing/Cooking extra items)
            const gourmetBonus = teaParser_js.parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
            const processingBonus = teaParser_js.parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Get community buff bonus (Production Efficiency)
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);

            // Total efficiency bonus (all sources additive)
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionDetails.type);

            // Calculate equipment efficiency bonus
            const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate tea efficiency bonus
            const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);

            const achievementEfficiency =
                dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

            const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
                requiredLevel: baseRequirement,
                skillLevel,
                teaSkillLevelBonus,
                actionLevelBonus,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency,
                achievementEfficiency,
            });

            const totalEfficiency = efficiencyBreakdown.totalEfficiency;
            const levelEfficiency = efficiencyBreakdown.levelEfficiency;
            const effectiveRequirement = efficiencyBreakdown.effectiveRequirement;

            // Calculate equipment speed bonus
            const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(characterEquipment, actionDetails.type, itemDetailMap);

            // Calculate action time with ONLY speed bonuses
            // Efficiency does NOT reduce time - it gives bonus actions
            // Formula: baseTime / (1 + speedBonus)
            // Example: 60s / (1 + 0.15) = 52.17s
            const actionTime = baseTime / (1 + equipmentSpeedBonus);

            // Build time breakdown for display
            const timeBreakdown = this.calculateTimeBreakdown(baseTime, equipmentSpeedBonus);

            // Actions per hour (base rate without efficiency)
            const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

            // Get output amount (how many items per action)
            // Use 'count' field from action output
            const outputAmount = action.count || action.baseAmount || 1;

            // Calculate efficiency multiplier
            // Formula matches original MWI Tools: 1 + efficiency%
            // Example: 150% efficiency → 1 + 1.5 = 2.5x multiplier
            const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

            // Items produced per hour (with efficiency multiplier)
            const itemsPerHour = actionsPerHour * outputAmount * efficiencyMultiplier;

            // Extra items from Gourmet (Brewing/Cooking bonus)
            // Statistical average: itemsPerHour × gourmetChance
            const gourmetBonusItems = itemsPerHour * gourmetBonus;

            // Total items per hour (base + gourmet bonus)
            const totalItemsPerHour = itemsPerHour + gourmetBonusItems;

            // Calculate material costs (with artisan reduction if applicable)
            const materialCosts = this.calculateMaterialCosts(actionDetails, artisanBonus, getCachedPrice);

            // Total material cost per action
            const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

            // Get market price for the item
            // Use fallback {ask: 0, bid: 0} if no market data exists (e.g., refined items)
            const itemPrice = marketAPI.getPrice(itemHrid, 0) || { ask: 0, bid: 0 };

            // Get output price based on pricing mode setting
            // Uses 'profit' context with 'sell' side to get correct sell price
            const rawOutputPrice = getCachedPrice(itemHrid, { context: 'profit', side: 'sell' });
            const outputPriceMissing = rawOutputPrice === null;
            const outputPrice = outputPriceMissing ? 0 : rawOutputPrice;

            // Apply market tax (2% tax on sales)
            const priceAfterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);

            // Cost per item (without efficiency scaling)
            const costPerItem = totalMaterialCost / outputAmount;

            // Material costs per hour (accounting for efficiency multiplier)
            // Efficiency repeats the action, consuming materials each time
            const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

            // Revenue per hour (gross, before tax)
            const revenuePerHour = itemsPerHour * outputPrice + gourmetBonusItems * outputPrice;

            // Calculate tea consumption costs (drinks consumed per hour)
            const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                drinkSlots: activeDrinks,
                drinkConcentration,
                itemDetailMap,
                getItemPrice: getCachedPrice,
            });
            const teaCosts = teaCostData.costs;
            const totalTeaCostPerHour = teaCostData.totalCostPerHour;

            // Calculate bonus revenue from essence and rare find drops (before profit calculation)
            const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap);

            const hasMissingPrices =
                outputPriceMissing ||
                materialCosts.some((material) => material.missingPrice) ||
                teaCostData.hasMissingPrices ||
                (bonusRevenue?.hasMissingPrices ?? false);

            // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
            const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

            // Calculate market tax (2% of gross revenue including bonus revenue)
            const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * profitConstants_js.MARKET_TAX;

            // Total costs per hour (materials + teas + market tax)
            const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour + marketTax;

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
                totalItemsPerHour, // Items/hour including Gourmet bonus
                gourmetBonusItems, // Extra items from Gourmet
                outputAmount,
                materialCosts,
                totalMaterialCost,
                materialCostPerHour, // Material costs per hour (with efficiency)
                teaCosts, // Tea consumption costs breakdown
                totalTeaCostPerHour, // Total tea costs per hour
                costPerItem,
                itemPrice,
                outputPrice, // Output price before tax (bid or ask based on mode)
                outputPriceMissing,
                priceAfterTax, // Output price after 2% tax (bid or ask based on mode)
                revenuePerHour,
                profitPerItem,
                profitPerHour,
                profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
                profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
                bonusRevenue, // Bonus revenue from essences and rare finds
                hasMissingPrices,
                totalEfficiency, // Total efficiency percentage
                levelEfficiency, // Level advantage efficiency
                houseEfficiency, // House room efficiency
                equipmentEfficiency, // Equipment efficiency
                teaEfficiency, // Tea buff efficiency
                communityEfficiency, // Community buff efficiency
                achievementEfficiency, // Achievement buff efficiency
                actionLevelBonus, // Action Level bonus from teas (e.g., Artisan Tea)
                artisanBonus, // Artisan material cost reduction
                gourmetBonus, // Gourmet bonus item chance
                processingBonus, // Processing conversion chance
                drinkConcentration, // Drink Concentration stat
                efficiencyMultiplier,
                equipmentSpeedBonus,
                skillLevel,
                baseRequirement, // Base requirement level
                effectiveRequirement, // Requirement after Action Level bonus
                requiredLevel: effectiveRequirement, // For backwards compatibility
                timeBreakdown,
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
         * @param {Function} getCachedPrice - Price lookup function with caching
         * @returns {Array} Array of material cost objects
         */
        calculateMaterialCosts(actionDetails, artisanBonus = 0, getCachedPrice) {
            const costs = [];

            // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
            if (actionDetails.upgradeItemHrid) {
                const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);

                if (itemDetails) {
                    // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                    const materialPrice = getCachedPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (actionDetails.upgradeItemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1;
                        isMissing = false;
                    }

                    // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                    const reducedAmount = 1;

                    costs.push({
                        itemHrid: actionDetails.upgradeItemHrid,
                        itemName: itemDetails.name,
                        baseAmount: 1,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
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
                    const materialPrice = getCachedPrice(input.itemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (input.itemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1; // 1 coin = 1 gold value
                        isMissing = false;
                    }

                    costs.push({
                        itemHrid: input.itemHrid,
                        itemName: itemDetails.name,
                        baseAmount: baseAmount,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
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
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionTypeHrid);

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
                    actionsPerHour: profitHelpers_js.calculateActionsPerHour(finalTime),
                };
            }

            // No modifiers - final time is base time
            return {
                baseTime: baseTime,
                steps: [],
                finalTime: baseTime,
                actionsPerHour: profitHelpers_js.calculateActionsPerHour(baseTime),
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

    /**
     * Expected Value Calculator Module
     * Calculates expected value for openable containers
     */


    /**
     * ExpectedValueCalculator class handles EV calculations for openable containers
     */
    class ExpectedValueCalculator {
        constructor() {
            // Constants
            this.MARKET_TAX = 0.02; // 2% marketplace tax
            this.CONVERGENCE_ITERATIONS = 4; // Nested container convergence

            // Cache for container EVs
            this.containerCache = new Map();

            // Special item HRIDs
            this.COIN_HRID = '/items/coin';
            this.COWBELL_HRID = '/items/cowbell';
            this.COWBELL_BAG_HRID = '/items/bag_of_10_cowbells';

            // Dungeon token HRIDs
            this.DUNGEON_TOKENS = [
                '/items/chimerical_token',
                '/items/sinister_token',
                '/items/enchanted_token',
                '/items/pirate_token',
            ];

            // Flag to track if initialized
            this.isInitialized = false;

            // Retry handler reference for cleanup
            this.retryHandler = null;
        }

        /**
         * Initialize the calculator
         * Pre-calculates all openable containers with nested convergence
         */
        async initialize() {
            if (!dataManager.getInitClientData()) {
                // Init data not yet available - set up retry on next character update
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        this.initialize(); // Retry initialization
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
                return false;
            }

            // Data is available - remove retry handler if it exists
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Calculate all containers with 4-iteration convergence for nesting
            this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence
         * Iterates 4 times to resolve nested container values
         */
        calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                for (const containerHrid of containerHrids) {
                    // Calculate and cache EV for this container (pass cached initData)
                    const ev = this.calculateSingleContainer(containerHrid, initData);
                    if (ev !== null) {
                        this.containerCache.set(containerHrid, ev);
                    }
                }
            }
        }

        /**
         * Calculate expected value for a single container
         * @param {string} containerHrid - Container item HRID
         * @param {Object} initData - Cached game data (optional, will fetch if not provided)
         * @returns {number|null} Expected value or null if unavailable
         */
        calculateSingleContainer(containerHrid, initData = null) {
            // Use cached data if provided, otherwise fetch
            if (!initData) {
                initData = dataManager.getInitClientData();
            }
            if (!initData || !initData.openableLootDropMap) {
                return null;
            }

            // Get drop table for this container
            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable || dropTable.length === 0) {
                return null;
            }

            let totalExpectedValue = 0;

            // Calculate expected value for each drop
            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                // Skip invalid drops
                if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
                    continue;
                }

                // Calculate average drop count
                const avgCount = (minCount + maxCount) / 2;

                // Get price for this drop
                const price = this.getDropPrice(itemHrid);

                if (price === null) {
                    continue; // Skip drops with missing data
                }

                // Check if item is tradeable (for tax calculation)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const canBeSold = itemDetails?.tradeable !== false;
                const dropValue = canBeSold
                    ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                    : avgCount * dropRate * price;
                totalExpectedValue += dropValue;
            }

            // Cache the result for future lookups
            if (totalExpectedValue > 0) {
                this.containerCache.set(containerHrid, totalExpectedValue);
            }

            return totalExpectedValue;
        }

        /**
         * Get price for a drop item
         * Handles special cases (Coin, Cowbell, Dungeon Tokens, nested containers)
         * @param {string} itemHrid - Item HRID
         * @returns {number|null} Price or null if unavailable
         */
        getDropPrice(itemHrid) {
            // Special case: Coin (face value = 1)
            if (itemHrid === this.COIN_HRID) {
                return 1;
            }

            // Special case: Cowbell (use bag price ÷ 10, with 18% tax)
            if (itemHrid === this.COWBELL_HRID) {
                // Get Cowbell Bag price using profit context (sell side - you're selling the bag)
                const bagValue = marketData_js.getItemPrice(this.COWBELL_BAG_HRID, { context: 'profit', side: 'sell' }) || 0;

                if (bagValue > 0) {
                    // Apply 18% market tax (Cowbell Bag only), then divide by 10
                    return profitHelpers_js.calculatePriceAfterTax(bagValue, 0.18) / 10;
                }
                return null; // No bag price available
            }

            // Special case: Dungeon Tokens (calculate value from shop items)
            if (this.DUNGEON_TOKENS.includes(itemHrid)) {
                return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', 'expectedValue_respectPricingMode');
            }

            // Check if this is a nested container (use cached EV)
            if (this.containerCache.has(itemHrid)) {
                return this.containerCache.get(itemHrid);
            }

            // Regular market item - get price based on pricing mode (sell side - you're selling drops)
            const dropPrice = marketData_js.getItemPrice(itemHrid, { enhancementLevel: 0, context: 'profit', side: 'sell' });
            return dropPrice > 0 ? dropPrice : null;
        }

        /**
         * Calculate expected value for an openable container
         * @param {string} itemHrid - Container item HRID
         * @returns {Object|null} EV data or null
         */
        calculateExpectedValue(itemHrid) {
            if (!this.isInitialized) {
                console.warn('[ExpectedValueCalculator] Not initialized');
                return null;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Verify this is an openable container
            if (!itemDetails.isOpenable) {
                return null; // Not an openable container
            }

            // Get detailed drop breakdown (calculates with fresh market prices)
            const drops = this.getDropBreakdown(itemHrid);

            // Calculate total expected value from fresh drop data
            const expectedReturn = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);

            return {
                itemName: itemDetails.name,
                itemHrid,
                expectedValue: expectedReturn,
                drops,
            };
        }

        /**
         * Get cached expected value for a container (for use by other modules)
         * @param {string} itemHrid - Container item HRID
         * @returns {number|null} Cached EV or null
         */
        getCachedValue(itemHrid) {
            return this.containerCache.get(itemHrid) || null;
        }

        /**
         * Get detailed drop breakdown for display
         * @param {string} containerHrid - Container HRID
         * @returns {Array} Array of drop objects
         */
        getDropBreakdown(containerHrid) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return [];
            }

            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable) {
                return [];
            }

            const drops = [];

            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                if (dropRate <= 0) {
                    continue;
                }

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Calculate average count
                const avgCount = (minCount + maxCount) / 2;

                // Get price
                const price = this.getDropPrice(itemHrid);

                // Calculate expected value for this drop
                const itemCanBeSold = itemDetails.tradeable !== false;
                const dropValue =
                    price !== null
                        ? itemCanBeSold
                            ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                            : avgCount * dropRate * price
                        : 0;

                drops.push({
                    itemHrid,
                    itemName: itemDetails.name,
                    dropRate,
                    avgCount,
                    priceEach: price || 0,
                    expectedValue: dropValue,
                    hasPriceData: price !== null,
                });
            }

            // Sort by expected value (highest first)
            drops.sort((a, b) => b.expectedValue - a.expectedValue);

            return drops;
        }

        /**
         * Invalidate cache (call when market data refreshes)
         */
        invalidateCache() {
            this.containerCache.clear();
            this.isInitialized = false;

            // Re-initialize if data is available
            if (dataManager.getInitClientData() && marketAPI.isLoaded()) {
                this.initialize();
            }
        }

        /**
         * Cleanup calculator state and handlers
         */
        cleanup() {
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            this.containerCache.clear();
            this.isInitialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const expectedValueCalculator = new ExpectedValueCalculator();

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


    // Base success rates for alchemy actions
    const BASE_SUCCESS_RATES = {
        COINIFY: 0.7, // 70%
        DECOMPOSE: 0.6, // 60%
        // TRANSMUTE: varies by item (from alchemyDetail.transmuteSuccessRate)
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
        const essenceFindBonus = equipmentParser_js.parseEssenceFindBonus(equipment, itemDetailMap);

        const equipmentRareFindBonus = equipmentParser_js.parseRareFindBonus(equipment, '/action_types/alchemy', itemDetailMap);
        const houseRareFindBonus = houseEfficiency_js.calculateHouseRareFind();
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
         * @returns {Object} Success rate breakdown { total, base, tea }
         */
        calculateSuccessRateBreakdown(baseRate) {
            try {
                // Get alchemy success bonus from active buffs
                const teaBonus = buffParser_js.getAlchemySuccessBonus();

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
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration calculation
                const equipment = dataManager.getEquipment();

                // Get drink concentration separately (not in breakdown from calculateActionStats)
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const baseSuccessRate = BASE_SUCCESS_RATES.COINIFY;
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Calculate input cost (material cost)
                const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;
                const pricePerItem = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
                if (pricePerItem === null) {
                    return null; // No market data
                }
                const materialCost = pricePerItem * bulkMultiplier;

                // Coinify has no catalyst (catalyst is 0 for coinify)
                const catalystPrice = 0;

                // Get coin cost per action attempt
                const coinCost = actionDetails.coinCost || 0;

                // Calculate cost per attempt (materials consumed on all attempts)
                const costPerAttempt = materialCost + coinCost;

                // Calculate output value (coins produced)
                // Formula: sellPrice × bulkMultiplier × 5
                const coinsProduced = (itemDetails.sellPrice || 0) * bulkMultiplier * 5;

                // Revenue per attempt (coins are always 1:1, only get coins on success)
                // Note: efficiency is applied to NET PROFIT, not revenue
                const revenuePerAttempt = coinsProduced * successRate;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Actions per hour (for display breakdown) - includes efficiency for display purposes
                // Convert efficiency from percentage to decimal (81.516% -> 0.81516)
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                const materialCostPerHour = (materialCost + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for coinify
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                // Formula: (netProfit × (1 + efficiency)) / actionTime × 3600 + bonusRevenue - teaCost
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

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
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

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
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration calculation
                const equipment = dataManager.getEquipment();
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const baseSuccessRate = BASE_SUCCESS_RATES.DECOMPOSE;
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Get input cost (market price of the item being decomposed)
                const inputPrice = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType, enhancementLevel });
                if (inputPrice === null) {
                    return null; // No market data
                }

                // Calculate output value
                let outputValue = 0;
                const dropDetails = [];

                // 1. Base decompose items (always received on success)
                for (const output of itemDetails.alchemyDetail.decomposeItems) {
                    const outputPrice = marketData_js.getItemPrice(output.itemHrid, { context: 'profit', side: sellType });
                    if (outputPrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);
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

                    const essencePrice = marketData_js.getItemPrice('/items/enhancing_essence', { context: 'profit', side: sellType });
                    if (essencePrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(essencePrice);
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

                // Get coin cost per action attempt
                const coinCost = actionDetails.coinCost || 0;

                // Cost per attempt (input consumed on every attempt)
                const costPerAttempt = inputPrice + coinCost;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Convert efficiency from percentage to decimal
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                const materialCostPerHour = (inputPrice + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for decompose
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

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
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

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
                // Alchemy uses item level (not action requirement) for efficiency calculation
                const actionStats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                    includeCommunityBuff: true,
                    includeBreakdown: true,
                    levelRequirementOverride: itemDetails.itemLevel || 1,
                });

                const { actionTime, totalEfficiency, efficiencyBreakdown } = actionStats;

                // Get equipment for drink concentration calculation
                const equipment = dataManager.getEquipment();
                const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

                // Calculate success rate with breakdown
                const successRateBreakdown = this.calculateSuccessRateBreakdown(baseSuccessRate);
                const successRate = successRateBreakdown.total;

                // Get input cost (market price of the item being transmuted)
                const inputPrice = marketData_js.getItemPrice(itemHrid, { context: 'profit', side: buyType });
                if (inputPrice === null) {
                    return null; // No market data
                }

                // Calculate expected value of outputs
                let expectedOutputValue = 0;
                const dropDetails = [];

                for (const drop of itemDetails.alchemyDetail.transmuteDropTable) {
                    const outputPrice = marketData_js.getItemPrice(drop.itemHrid, { context: 'profit', side: sellType });
                    if (outputPrice !== null) {
                        const afterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);
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

                // Get bulk multiplier (number of items consumed per action)
                const bulkMultiplier = itemDetails.alchemyDetail?.bulkMultiplier || 1;
                const materialCost = inputPrice * bulkMultiplier;

                // Get coin cost per action attempt
                const coinCost = actionDetails.coinCost || 0;

                // Cost per attempt (input consumed on every attempt)
                const costPerAttempt = materialCost + coinCost;

                // Net profit per attempt (before efficiency)
                const netProfitPerAttempt = revenuePerAttempt - costPerAttempt;

                // Calculate tea costs
                const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                    drinkSlots: dataManager.getActionDrinkSlots('/action_types/alchemy'),
                    drinkConcentration,
                    itemDetailMap: gameData.itemDetailMap,
                    getItemPrice: (hrid) => marketData_js.getItemPrice(hrid, { context: 'profit', side: buyType }),
                });

                // Calculate per-hour values
                // Convert efficiency from percentage to decimal
                const efficiencyDecimal = totalEfficiency / 100;
                const actionsPerHourWithEfficiency = profitHelpers_js.calculateActionsPerHour(actionTime) * (1 + efficiencyDecimal);

                // Calculate bonus revenue (essences + rares) from item level
                const itemLevel = itemDetails.itemLevel || 1;
                const alchemyBonus = calculateAlchemyBonusDrops(
                    itemLevel,
                    actionsPerHourWithEfficiency,
                    equipment,
                    gameData.itemDetailMap
                );

                // Material and revenue calculations (for breakdown display)
                const materialCostPerHour = (materialCost + coinCost) * actionsPerHourWithEfficiency;
                const catalystCostPerHour = 0; // No catalyst for transmute
                const revenuePerHour = revenuePerAttempt * actionsPerHourWithEfficiency + alchemyBonus.totalBonusRevenue;

                // Profit calculation (matches OLD system formula)
                const profitPerSecond = (netProfitPerAttempt * (1 + efficiencyDecimal)) / actionTime;
                const profitPerHour =
                    profitPerSecond * profitConstants_js.SECONDS_PER_HOUR + alchemyBonus.totalBonusRevenue - teaCostData.totalCostPerHour;
                const profitPerDay = profitHelpers_js.calculateProfitPerDay(profitPerHour);

                // Build detailed breakdowns
                const requirementCosts = [
                    {
                        itemHrid,
                        count: bulkMultiplier,
                        price: inputPrice,
                        costPerAction: materialCost,
                        costPerHour: materialCost * actionsPerHourWithEfficiency,
                        enhancementLevel: 0,
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

                // Add alchemy essence and rare drops
                for (const drop of alchemyBonus.bonusDrops) {
                    dropRevenues.push(drop);
                }

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
                    materialCost,
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
                    rareFindBreakdown: alchemyBonus.rareFindBreakdown,
                    essenceFindBreakdown: alchemyBonus.essenceFindBreakdown,

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

    /**
     * Enhancement Tooltip Module
     *
     * Provides enhancement analysis for item tooltips.
     * Calculates optimal enhancement path and total costs for reaching current enhancement level.
     *
     * This module is part of Phase 2 of Option D (Hybrid Approach):
     * - Enhancement panel: Shows 20-level enhancement table
     * - Item tooltips: Shows optimal path to reach current enhancement level
     */


    /**
     * Calculate optimal enhancement path for an item
     * Matches Enhancelator's algorithm exactly:
     * 1. Test all protection strategies for each level
     * 2. Pick minimum cost for each level (mixed strategies)
     * 3. Apply mirror optimization to mixed array
     *
     * @param {string} itemHrid - Item HRID (e.g., '/items/cheese_sword')
     * @param {number} currentEnhancementLevel - Current enhancement level (1-20)
     * @param {Object} config - Enhancement configuration from enhancement-config.js
     * @returns {Object|null} Enhancement analysis or null if not enhanceable
     */
    function calculateEnhancementPath(itemHrid, currentEnhancementLevel, config) {
        // Validate inputs
        if (!itemHrid || currentEnhancementLevel < 1 || currentEnhancementLevel > 20) {
            return null;
        }

        // Get item details
        const gameData = dataManager.getInitClientData();
        if (!gameData) return null;

        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails) return null;

        // Check if item is enhanceable
        if (!itemDetails.enhancementCosts || itemDetails.enhancementCosts.length === 0) {
            return null;
        }

        const itemLevel = itemDetails.itemLevel || 1;

        // Step 1: Build 2D matrix like Enhancelator (all_results)
        // For each target level (1 to currentEnhancementLevel)
        // Test all protection strategies (0, 2, 3, ..., targetLevel)
        // Result: allResults[targetLevel][protectFrom] = cost data

        const allResults = [];

        for (let targetLevel = 1; targetLevel <= currentEnhancementLevel; targetLevel++) {
            const resultsForLevel = [];

            // Test "never protect" (0)
            const neverProtect = calculateCostForStrategy(itemHrid, targetLevel, 0, itemLevel, config);
            if (neverProtect) {
                resultsForLevel.push({ protectFrom: 0, ...neverProtect });
            }

            // Test all "protect from X" strategies (2 through targetLevel)
            for (let protectFrom = 2; protectFrom <= targetLevel; protectFrom++) {
                const result = calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config);
                if (result) {
                    resultsForLevel.push({ protectFrom, ...result });
                }
            }

            allResults.push(resultsForLevel);
        }

        // Step 2: Build target_costs array (minimum cost for each level)
        // Like Enhancelator line 451-453
        const targetCosts = new Array(currentEnhancementLevel + 1);
        targetCosts[0] = getRealisticBaseItemPrice(itemHrid); // Level 0: base item

        for (let level = 1; level <= currentEnhancementLevel; level++) {
            const resultsForLevel = allResults[level - 1];
            const minCost = Math.min(...resultsForLevel.map((r) => r.totalCost));
            targetCosts[level] = minCost;
        }

        // Step 3: Apply Philosopher's Mirror optimization (single pass, in-place)
        // Like Enhancelator lines 456-465
        const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
        let mirrorStartLevel = null;

        if (mirrorPrice > 0) {
            for (let level = 3; level <= currentEnhancementLevel; level++) {
                const traditionalCost = targetCosts[level];
                const mirrorCost = targetCosts[level - 2] + targetCosts[level - 1] + mirrorPrice;

                if (mirrorCost < traditionalCost) {
                    if (mirrorStartLevel === null) {
                        mirrorStartLevel = level;
                    }
                    targetCosts[level] = mirrorCost;
                }
            }
        }

        // Step 4: Build final result with breakdown
        targetCosts[currentEnhancementLevel];

        // Find which protection strategy was optimal for final level (before mirrors)
        const finalLevelResults = allResults[currentEnhancementLevel - 1];
        const optimalTraditional = finalLevelResults.reduce((best, curr) =>
            curr.totalCost < best.totalCost ? curr : best
        );

        let optimalStrategy;

        if (mirrorStartLevel !== null) {
            // Mirror was used - build mirror-optimized result
            optimalStrategy = buildMirrorOptimizedResult(
                itemHrid,
                currentEnhancementLevel,
                mirrorStartLevel,
                targetCosts,
                optimalTraditional,
                mirrorPrice);
        } else {
            // No mirror used - return traditional result
            optimalStrategy = {
                protectFrom: optimalTraditional.protectFrom,
                label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
                expectedAttempts: optimalTraditional.expectedAttempts,
                totalTime: optimalTraditional.totalTime,
                baseCost: optimalTraditional.baseCost,
                materialCost: optimalTraditional.materialCost,
                protectionCost: optimalTraditional.protectionCost,
                protectionItemHrid: optimalTraditional.protectionItemHrid,
                protectionCount: optimalTraditional.protectionCount,
                totalCost: optimalTraditional.totalCost,
                usedMirror: false,
                mirrorStartLevel: null,
            };
        }

        return {
            targetLevel: currentEnhancementLevel,
            itemLevel,
            optimalStrategy,
            allStrategies: [optimalStrategy], // Only return optimal
        };
    }

    /**
     * Calculate cost for a single protection strategy to reach a target level
     * @private
     */
    function calculateCostForStrategy(itemHrid, targetLevel, protectFrom, itemLevel, config) {
        try {
            const params = {
                enhancingLevel: config.enhancingLevel,
                houseLevel: config.houseLevel,
                toolBonus: config.toolBonus || 0,
                speedBonus: config.speedBonus || 0,
                itemLevel,
                targetLevel,
                protectFrom,
                blessedTea: config.teas.blessed,
                guzzlingBonus: config.guzzlingBonus,
            };

            // Calculate enhancement statistics
            const result = enhancementCalculator_js.calculateEnhancement(params);

            if (!result || typeof result.attempts !== 'number' || typeof result.totalTime !== 'number') {
                console.error('[Enhancement Tooltip] Invalid result from calculateEnhancement:', result);
                return null;
            }

            // Calculate costs
            const costs = calculateTotalCost(itemHrid, targetLevel, protectFrom, config);

            return {
                expectedAttempts: result.attempts,
                totalTime: result.totalTime,
                ...costs,
            };
        } catch (error) {
            console.error('[Enhancement Tooltip] Strategy calculation error:', error);
            return null;
        }
    }

    /**
     * Build mirror-optimized result with Fibonacci quantities
     * @private
     */
    function buildMirrorOptimizedResult(
        itemHrid,
        targetLevel,
        mirrorStartLevel,
        targetCosts,
        optimalTraditional,
        mirrorPrice,
        _config
    ) {
        const gameData = dataManager.getInitClientData();
        gameData.itemDetailMap[itemHrid];

        // Calculate Fibonacci quantities for consumed items
        const n = targetLevel - mirrorStartLevel;
        const numLowerTier = fib(n); // Quantity of (mirrorStartLevel - 2) items
        const numUpperTier = fib(n + 1); // Quantity of (mirrorStartLevel - 1) items
        const numMirrors = mirrorFib(n); // Quantity of Philosopher's Mirrors

        const lowerTierLevel = mirrorStartLevel - 2;
        const upperTierLevel = mirrorStartLevel - 1;

        // Get cost of one item at each level from targetCosts
        const costLowerTier = targetCosts[lowerTierLevel];
        const costUpperTier = targetCosts[upperTierLevel];

        // Calculate total costs for consumed items and mirrors
        const totalLowerTierCost = numLowerTier * costLowerTier;
        const totalUpperTierCost = numUpperTier * costUpperTier;
        const totalMirrorsCost = numMirrors * mirrorPrice;

        // Build consumed items array for display
        const consumedItems = [
            {
                level: lowerTierLevel,
                quantity: numLowerTier,
                costEach: costLowerTier,
                totalCost: totalLowerTierCost,
            },
            {
                level: upperTierLevel,
                quantity: numUpperTier,
                costEach: costUpperTier,
                totalCost: totalUpperTierCost,
            },
        ];

        // For mirror phase: ONLY consumed items + mirrors
        // The consumed item costs from targetCosts already include base/materials/protection
        // NO separate base/materials/protection for main item!

        return {
            protectFrom: optimalTraditional.protectFrom,
            label: optimalTraditional.protectFrom === 0 ? 'Never' : `From +${optimalTraditional.protectFrom}`,
            expectedAttempts: optimalTraditional.expectedAttempts,
            totalTime: optimalTraditional.totalTime,
            baseCost: 0, // Not applicable for mirror phase
            materialCost: 0, // Not applicable for mirror phase
            protectionCost: 0, // Not applicable for mirror phase
            protectionItemHrid: null,
            protectionCount: 0,
            consumedItemsCost: totalLowerTierCost + totalUpperTierCost,
            philosopherMirrorCost: totalMirrorsCost,
            totalCost: targetCosts[targetLevel], // Use recursive formula result for consistency
            mirrorStartLevel: mirrorStartLevel,
            usedMirror: true,
            traditionalCost: optimalTraditional.totalCost,
            consumedItems: consumedItems,
            mirrorCount: numMirrors,
        };
    }

    /**
     * Calculate total cost for enhancement path
     * Matches original MWI Tools v25.0 cost calculation
     * @private
     */
    function calculateTotalCost(itemHrid, targetLevel, protectFrom, config) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];
        const itemLevel = itemDetails.itemLevel || 1;

        // Calculate total attempts for full path (0 to targetLevel)
        const pathResult = enhancementCalculator_js.calculateEnhancement({
            enhancingLevel: config.enhancingLevel,
            houseLevel: config.houseLevel,
            toolBonus: config.toolBonus || 0,
            speedBonus: config.speedBonus || 0,
            itemLevel,
            targetLevel,
            protectFrom,
            blessedTea: config.teas.blessed,
            guzzlingBonus: config.guzzlingBonus,
        });

        // Calculate per-action material cost (same for all enhancement levels)
        // enhancementCosts is a flat array of materials needed per attempt
        let perActionCost = 0;
        if (itemDetails.enhancementCosts) {
            for (const material of itemDetails.enhancementCosts) {
                const materialDetail = gameData.itemDetailMap[material.itemHrid];
                let price;

                // Special case: Trainee charms have fixed 250k price (untradeable)
                if (material.itemHrid.startsWith('/items/trainee_')) {
                    price = 250000;
                } else if (material.itemHrid === '/items/coin') {
                    price = 1; // Coins have face value of 1
                } else {
                    const marketPrice = marketData_js.getItemPrices(material.itemHrid, 0);
                    if (marketPrice) {
                        let ask = marketPrice.ask;
                        let bid = marketPrice.bid;

                        // Match MCS behavior: if one price is positive and other is negative, use positive for both
                        if (ask > 0 && bid < 0) {
                            bid = ask;
                        }
                        if (bid > 0 && ask < 0) {
                            ask = bid;
                        }

                        // MCS uses just ask for material prices
                        price = ask;
                    } else {
                        // Fallback to sellPrice if no market data
                        price = materialDetail?.sellPrice || 0;
                    }
                }
                perActionCost += price * material.count;
            }
        }

        // Total material cost = per-action cost × total attempts
        const materialCost = perActionCost * pathResult.attempts;

        // Protection cost = cheapest protection option × protection count
        let protectionCost = 0;
        let protectionItemHrid = null;
        let protectionCount = 0;
        if (protectFrom > 0 && pathResult.protectionCount > 0) {
            const protectionInfo = getCheapestProtectionPrice(itemHrid);
            if (protectionInfo.price > 0) {
                protectionCost = protectionInfo.price * pathResult.protectionCount;
                protectionItemHrid = protectionInfo.itemHrid;
                protectionCount = pathResult.protectionCount;
            }
        }

        // Base item cost (initial investment) using realistic pricing
        const baseCost = getRealisticBaseItemPrice(itemHrid);

        return {
            baseCost,
            materialCost,
            protectionCost,
            protectionItemHrid,
            protectionCount,
            totalCost: baseCost + materialCost + protectionCost,
        };
    }

    /**
     * Get realistic base item price with production cost fallback
     * Matches original MWI Tools v25.0 getRealisticBaseItemPrice logic
     * @private
     */
    function getRealisticBaseItemPrice(itemHrid) {
        const marketPrice = marketData_js.getItemPrices(itemHrid, 0);
        const ask = marketPrice?.ask > 0 ? marketPrice.ask : 0;
        const bid = marketPrice?.bid > 0 ? marketPrice.bid : 0;

        // Calculate production cost as fallback
        const productionCost = getProductionCost(itemHrid);

        // If both ask and bid exist
        if (ask > 0 && bid > 0) {
            // If ask is significantly higher than bid (>30% markup), use max(bid, production)
            if (ask / bid > 1.3) {
                return Math.max(bid, productionCost);
            }
            // Otherwise use ask (normal market)
            return ask;
        }

        // If only ask exists
        if (ask > 0) {
            // If ask is inflated compared to production, use production
            if (productionCost > 0 && ask / productionCost > 1.3) {
                return productionCost;
            }
            // Otherwise use max of ask and production
            return Math.max(ask, productionCost);
        }

        // If only bid exists, use max(bid, production)
        if (bid > 0) {
            return Math.max(bid, productionCost);
        }

        // No market data - use production cost as fallback
        return productionCost;
    }

    /**
     * Calculate production cost from crafting recipe
     * Matches original MWI Tools v25.0 getBaseItemProductionCost logic
     * @private
     */
    function getProductionCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        if (!itemDetails || !itemDetails.name) {
            return 0;
        }

        // Find the action that produces this item
        let actionHrid = null;
        for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (action.outputItems && action.outputItems.length > 0) {
                const output = action.outputItems[0];
                if (output.itemHrid === itemHrid) {
                    actionHrid = hrid;
                    break;
                }
            }
        }

        if (!actionHrid) {
            return 0;
        }

        const action = gameData.actionDetailMap[actionHrid];
        let totalPrice = 0;

        // Sum up input material costs
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputPrice = marketData_js.getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
                totalPrice += inputPrice * input.count;
            }
        }

        // Apply Artisan Tea reduction (0.9x)
        totalPrice *= 0.9;

        // Add upgrade item cost if this is an upgrade recipe (for refined items)
        if (action.upgradeItemHrid) {
            const upgradePrice = marketData_js.getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
            totalPrice += upgradePrice;
        }

        return totalPrice;
    }

    /**
     * Get cheapest protection item price
     * Tests: item itself, mirror of protection, and specific protection items
     * @private
     */
    function getCheapestProtectionPrice(itemHrid) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData.itemDetailMap[itemHrid];

        // Build list of protection options: [item itself, mirror, ...specific items]
        const protectionOptions = [itemHrid, '/items/mirror_of_protection'];

        // Add specific protection items if they exist
        if (itemDetails.protectionItemHrids && itemDetails.protectionItemHrids.length > 0) {
            protectionOptions.push(...itemDetails.protectionItemHrids);
        }

        // Find cheapest option
        let cheapestPrice = Infinity;
        let cheapestItemHrid = null;
        for (const protectionHrid of protectionOptions) {
            const price = getRealisticBaseItemPrice(protectionHrid);
            if (price > 0 && price < cheapestPrice) {
                cheapestPrice = price;
                cheapestItemHrid = protectionHrid;
            }
        }

        return {
            price: cheapestPrice === Infinity ? 0 : cheapestPrice,
            itemHrid: cheapestItemHrid,
        };
    }

    /**
     * Fibonacci calculation for item quantities (from Enhancelator)
     * @private
     */
    function fib(n) {
        if (n === 0 || n === 1) {
            return 1;
        }
        return fib(n - 1) + fib(n - 2);
    }

    /**
     * Mirror Fibonacci calculation for mirror quantities (from Enhancelator)
     * @private
     */
    function mirrorFib(n) {
        if (n === 0) {
            return 1;
        }
        if (n === 1) {
            return 2;
        }
        return mirrorFib(n - 1) + mirrorFib(n - 2) + 1;
    }

    /**
     * Build HTML for enhancement tooltip section
     * @param {Object} enhancementData - Enhancement analysis from calculateEnhancementPath()
     * @returns {string} HTML string
     */
    function buildEnhancementTooltipHTML(enhancementData) {
        if (!enhancementData || !enhancementData.optimalStrategy) {
            return '';
        }

        const { targetLevel, optimalStrategy } = enhancementData;

        // Validate required fields
        if (
            typeof optimalStrategy.expectedAttempts !== 'number' ||
            typeof optimalStrategy.totalTime !== 'number' ||
            typeof optimalStrategy.materialCost !== 'number' ||
            typeof optimalStrategy.totalCost !== 'number'
        ) {
            console.error('[Enhancement Tooltip] Missing required fields in optimal strategy:', optimalStrategy);
            return '';
        }

        let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin-top: 8px; padding-top: 8px;">';
        html += '<div style="font-weight: bold; margin-bottom: 4px;">ENHANCEMENT PATH (+0 → +' + targetLevel + ')</div>';
        html += '<div style="font-size: 0.9em; margin-left: 8px;">';

        // Optimal strategy
        html += '<div>Strategy: ' + optimalStrategy.label + '</div>';

        // Show Philosopher's Mirror usage if applicable
        if (optimalStrategy.usedMirror && optimalStrategy.mirrorStartLevel) {
            html +=
                '<div style="color: #ffd700;">Uses Philosopher\'s Mirror from +' +
                optimalStrategy.mirrorStartLevel +
                '</div>';
        }

        html += '<div>Expected Attempts: ' + formatters_js.formatLargeNumber(optimalStrategy.expectedAttempts.toFixed(1)) + '</div>';

        // Costs
        html += '<div>';

        // Check if using mirror optimization
        if (optimalStrategy.usedMirror && optimalStrategy.consumedItems && optimalStrategy.consumedItems.length > 0) {
            // Mirror-optimized breakdown
            // For mirror phase, we ONLY show consumed items and mirrors (no base/materials/protection)
            // Consumed items section (Fibonacci-based quantities)
            html += "Consumed Items (Philosopher's Mirror):";
            html += '<div style="margin-left: 12px;">';

            // Show consumed items in descending order (higher level first), filter out zero quantities
            const sortedConsumed = [...optimalStrategy.consumedItems]
                .filter((item) => item.quantity > 0)
                .sort((a, b) => b.level - a.level);
            sortedConsumed.forEach((item, index) => {
                if (index > 0) html += '<br>'; // Add line break before items after the first
                html +=
                    '+' +
                    item.level +
                    ': ' +
                    item.quantity +
                    ' × ' +
                    formatters_js.formatLargeNumber(item.costEach) +
                    ' = ' +
                    formatters_js.formatLargeNumber(item.totalCost);
            });

            html += '</div>';
            // Philosopher's Mirror cost
            if (optimalStrategy.philosopherMirrorCost > 0) {
                const mirrorPrice = getRealisticBaseItemPrice('/items/philosophers_mirror');
                html += "Philosopher's Mirror: " + formatters_js.formatLargeNumber(optimalStrategy.philosopherMirrorCost);
                if (optimalStrategy.mirrorCount > 0 && mirrorPrice > 0) {
                    html += ' (' + optimalStrategy.mirrorCount + 'x @ ' + formatters_js.formatLargeNumber(mirrorPrice) + ' each)';
                }
            }

            html +=
                '<br><span style="font-weight: bold;">Total: ' + formatters_js.formatLargeNumber(optimalStrategy.totalCost) + '</span>';
        } else {
            // Traditional (non-mirror) breakdown
            html += 'Base Item: ' + formatters_js.formatLargeNumber(optimalStrategy.baseCost);
            html += '<br>Materials: ' + formatters_js.formatLargeNumber(optimalStrategy.materialCost);

            if (optimalStrategy.protectionCost > 0) {
                let protectionDisplay = formatters_js.formatLargeNumber(optimalStrategy.protectionCost);

                // Show protection count and item name if available
                if (optimalStrategy.protectionCount > 0) {
                    protectionDisplay += ' (' + optimalStrategy.protectionCount.toFixed(1) + '×';

                    if (optimalStrategy.protectionItemHrid) {
                        const gameData = dataManager.getInitClientData();
                        const itemDetails = gameData?.itemDetailMap[optimalStrategy.protectionItemHrid];
                        if (itemDetails?.name) {
                            protectionDisplay += ' ' + itemDetails.name;
                        }
                    }

                    protectionDisplay += ')';
                }

                html += '<br>Protection: ' + protectionDisplay;
            }

            html +=
                '<br><span style="font-weight: bold;">Total: ' + formatters_js.formatLargeNumber(optimalStrategy.totalCost) + '</span>';
        }

        html += '</div>';

        // Time estimate
        const totalSeconds = optimalStrategy.totalTime;

        if (totalSeconds < 60) {
            // Less than 1 minute: show seconds
            html += '<div>Time: ~' + Math.round(totalSeconds) + ' seconds</div>';
        } else if (totalSeconds < 3600) {
            // Less than 1 hour: show minutes
            const minutes = Math.round(totalSeconds / 60);
            html += '<div>Time: ~' + minutes + ' minutes</div>';
        } else if (totalSeconds < 86400) {
            // Less than 1 day: show hours
            const hours = (totalSeconds / 3600).toFixed(1);
            html += '<div>Time: ~' + hours + ' hours</div>';
        } else {
            // 1 day or more: show days
            const days = (totalSeconds / 86400).toFixed(1);
            html += '<div>Time: ~' + days + ' days</div>';
        }

        html += '</div>'; // Close margin-left div
        html += '</div>'; // Close main container

        return html;
    }

    /**
     * Gathering Profit Calculator
     *
     * Calculates comprehensive profit/hour for gathering actions (Foraging, Woodcutting, Milking) including:
     * - All drop table items at market prices
     * - Drink consumption costs
     * - Equipment speed bonuses
     * - Efficiency buffs (level, house, tea, equipment)
     * - Gourmet tea bonus items (production skills only)
     * - Market tax (2%)
     */


    /**
     * Cache for processing action conversions (inputItemHrid → conversion data)
     * Built once per game data load to avoid O(n) searches through action map
     */
    let processingConversionCache = null;

    /**
     * Build processing conversion cache from game data
     * @param {Object} gameData - Game data from dataManager
     * @returns {Map} Map of inputItemHrid → {actionHrid, outputItemHrid, conversionRatio}
     */
    function buildProcessingConversionCache(gameData) {
        const cache = new Map();
        const validProcessingTypes = [
            '/action_types/cheesesmithing', // Milk → Cheese conversions
            '/action_types/crafting', // Log → Lumber conversions
            '/action_types/tailoring', // Cotton/Flax/Bamboo/Cocoon/Radiant → Fabric conversions
        ];

        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!validProcessingTypes.includes(action.type)) {
                continue;
            }

            const inputItem = action.inputItems?.[0];
            const outputItem = action.outputItems?.[0];

            if (inputItem && outputItem) {
                cache.set(inputItem.itemHrid, {
                    actionHrid: actionHrid,
                    outputItemHrid: outputItem.itemHrid,
                    conversionRatio: inputItem.count,
                });
            }
        }

        return cache;
    }

    /**
     * Calculate comprehensive profit for a gathering action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/foraging/asteroid_belt")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateGatheringProfit(actionHrid) {
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process gathering actions (Foraging, Woodcutting, Milking) with drop tables
        if (!profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.dropTable) {
            return null; // No drop table - nothing to calculate
        }

        // Build processing conversion cache once (lazy initialization)
        if (!processingConversionCache) {
            processingConversionCache = buildProcessingConversionCache(gameData);
        }

        const priceCache = new Map();
        const getCachedPrice = (itemHrid, options) => {
            const side = options?.side || '';
            const enhancementLevel = options?.enhancementLevel ?? '';
            const cacheKey = `${itemHrid}|${side}|${enhancementLevel}`;

            if (priceCache.has(cacheKey)) {
                return priceCache.get(cacheKey);
            }

            const price = marketData_js.getItemPrice(itemHrid, options);
            priceCache.set(cacheKey, price);
            return price;
        };

        // Note: Market API is pre-loaded by caller (max-produceable.js)
        // No need to check or fetch here

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const houseRooms = Array.from(dataManager.getHouseRooms().values());

        // Calculate action time per action (with speed bonuses)
        const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
        const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
        const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus);

        // Calculate actions per hour
        const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actualTimePerActionSec);

        // Get character's actual equipped drink slots for this action type (from WebSocket data)
        const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

        // Get drink concentration from equipment
        const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

        // Parse tea buffs
        const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetail.type, drinkSlots, gameData.itemDetailMap, drinkConcentration);

        // Gourmet Tea only applies to production skills (Brewing, Cooking, Cheesesmithing, Crafting, Tailoring)
        // NOT gathering skills (Foraging, Woodcutting, Milking)
        const gourmetBonus = profitConstants_js.PRODUCTION_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        const processingBonus = profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Gathering Quantity: Increases item drop amounts (min/max)
        // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        let totalGathering = 0;
        let gatheringTea = 0;
        let communityGathering = 0;
        let achievementGathering = 0;
        if (profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            // Parse Gathering Tea bonus
            gatheringTea = teaParser_js.parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

            // Get Community Buff level for gathering quantity
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

            // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
            achievementGathering = dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/gathering');

            // Stack all bonuses additively
            totalGathering = gatheringTea + communityGathering + achievementGathering;
        }

        const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
            drinkSlots,
            drinkConcentration,
            itemDetailMap: gameData.itemDetailMap,
            getItemPrice: getCachedPrice,
        });
        const drinkCostPerHour = teaCostData.totalCostPerHour;
        const drinkCosts = teaCostData.costs.map((tea) => ({
            name: tea.itemName,
            priceEach: tea.pricePerDrink,
            drinksPerHour: tea.drinksPerHour,
            costPerHour: tea.totalCost,
            missingPrice: tea.missingPrice,
        }));

        // Calculate level efficiency bonus
        const requiredLevel = actionDetail.levelRequirement?.level || 1;
        const skillHrid = actionDetail.levelRequirement?.skillHrid;
        let currentLevel = requiredLevel;
        for (const skill of skills) {
            if (skill.skillHrid === skillHrid) {
                currentLevel = skill.level;
                break;
            }
        }

        // Calculate tea skill level bonus (e.g., +5 Foraging from Ultra Foraging Tea)
        const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
            actionDetail.type,
            drinkSlots,
            gameData.itemDetailMap,
            drinkConcentration
        );

        // Calculate house efficiency bonus
        let houseEfficiency = 0;
        for (const room of houseRooms) {
            const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionDetail.type]) {
                houseEfficiency += (room.level || 0) * 1.5;
            }
        }

        // Calculate equipment efficiency bonus (uses equipment-parser utility)
        const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        const achievementEfficiency =
            dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/efficiency') * 100;

        const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: currentLevel,
            teaSkillLevelBonus,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            achievementEfficiency,
        });
        const totalEfficiency = efficiencyBreakdown.totalEfficiency;
        const levelEfficiency = efficiencyBreakdown.levelEfficiency;

        // Calculate efficiency multiplier (matches production profit calculator pattern)
        // Efficiency "repeats the action" - we apply it to item outputs, not action rate
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate revenue from drop table
        // Processing happens PER ACTION (before efficiency multiplies the count)
        // So we calculate per-action outputs, then multiply by actionsPerHour and efficiency
        let baseRevenuePerHour = 0;
        let gourmetRevenueBonus = 0;
        let gourmetRevenueBonusPerAction = 0;
        let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
        let processingRevenueBonusPerAction = 0; // Per-action processing revenue
        const processingConversions = []; // Track conversion details for display
        const baseOutputs = []; // Baseline outputs (before gourmet and processing)
        const gourmetBonuses = []; // Gourmet bonus outputs (display-only)
        const dropTable = actionDetail.dropTable;

        for (const drop of dropTable) {
            const rawPrice = getCachedPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
            const rawPriceMissing = rawPrice === null;
            const resolvedRawPrice = rawPriceMissing ? 0 : rawPrice;
            // Apply gathering quantity bonus to drop amounts
            const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
            const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

            // Check if this item has a Processing Tea conversion (using cache for O(1) lookup)
            // Processing Tea only applies to: Milk→Cheese, Log→Lumber, Cotton/Flax/Bamboo/Cocoon/Radiant→Fabric
            const conversionData = processingConversionCache.get(drop.itemHrid);
            const processedItemHrid = conversionData?.outputItemHrid || null;
            conversionData?.actionHrid || null;

            // Per-action calculations (efficiency will be applied when converting to items per hour)
            let rawPerAction = 0;
            let processedPerAction = 0;

            const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            const baseItemsPerHour = actionsPerHour * drop.dropRate * avgAmountPerAction * efficiencyMultiplier;
            const baseItemsPerAction = drop.dropRate * avgAmountPerAction;
            const baseRevenuePerAction = baseItemsPerAction * resolvedRawPrice;
            const baseRevenueLine = baseItemsPerHour * resolvedRawPrice;
            baseRevenuePerHour += baseRevenueLine;
            baseOutputs.push({
                name: rawItemName,
                itemsPerHour: baseItemsPerHour,
                itemsPerAction: baseItemsPerAction,
                dropRate: drop.dropRate,
                priceEach: resolvedRawPrice,
                revenuePerHour: baseRevenueLine,
                revenuePerAction: baseRevenuePerAction,
                missingPrice: rawPriceMissing,
            });

            if (processedItemHrid && processingBonus > 0) {
                // Get conversion ratio from cache (e.g., 1 Milk → 1 Cheese)
                const conversionRatio = conversionData.conversionRatio;

                // Processing Tea check happens per action:
                // If procs (processingBonus% chance): Convert to processed + leftover
                const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);
                const rawLeftoverIfProcs = avgAmountPerAction % conversionRatio;

                // If doesn't proc: All stays raw
                const rawIfNoProc = avgAmountPerAction;

                // Expected value per action
                processedPerAction = processingBonus * processedIfProcs;
                rawPerAction = processingBonus * rawLeftoverIfProcs + (1 - processingBonus) * rawIfNoProc;

                const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                const processedPriceMissing = processedPrice === null;
                const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;

                const processedItemsPerHour = actionsPerHour * drop.dropRate * processedPerAction * efficiencyMultiplier;
                const processedItemsPerAction = drop.dropRate * processedPerAction;

                // Track processing details
                const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';

                // Value gain per conversion = cheese value - cost of milk used
                const costOfMilkUsed = conversionRatio * resolvedRawPrice;
                const valueGainPerConversion = resolvedProcessedPrice - costOfMilkUsed;
                const revenueFromConversion = processedItemsPerHour * valueGainPerConversion;
                const rawConsumedPerHour = processedItemsPerHour * conversionRatio;
                const rawConsumedPerAction = processedItemsPerAction * conversionRatio;

                processingRevenueBonus += revenueFromConversion;
                processingRevenueBonusPerAction += processedItemsPerAction * valueGainPerConversion;
                processingConversions.push({
                    rawItem: rawItemName,
                    processedItem: processedItemName,
                    valueGain: valueGainPerConversion,
                    conversionsPerHour: processedItemsPerHour,
                    conversionsPerAction: processedItemsPerAction,
                    rawConsumedPerHour,
                    rawConsumedPerAction,
                    rawPriceEach: resolvedRawPrice,
                    processedPriceEach: resolvedProcessedPrice,
                    revenuePerHour: revenueFromConversion,
                    revenuePerAction: processedItemsPerAction * valueGainPerConversion,
                    missingPrice: rawPriceMissing || processedPriceMissing,
                });
            } else {
                // No processing - simple calculation
                rawPerAction = avgAmountPerAction;
            }

            // Gourmet tea bonus (only for production skills, not gathering)
            if (gourmetBonus > 0) {
                const totalPerAction = rawPerAction + processedPerAction;
                const bonusPerAction = totalPerAction * (gourmetBonus / 100);
                const bonusItemsPerHour = actionsPerHour * drop.dropRate * bonusPerAction * efficiencyMultiplier;
                const bonusItemsPerAction = drop.dropRate * bonusPerAction;

                // Use weighted average price for gourmet bonus
                if (processedItemHrid && processingBonus > 0) {
                    const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                    const processedPriceMissing = processedPrice === null;
                    const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;
                    const weightedPrice =
                        (rawPerAction * resolvedRawPrice + processedPerAction * resolvedProcessedPrice) /
                        (rawPerAction + processedPerAction);
                    const bonusRevenue = bonusItemsPerHour * weightedPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * weightedPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: weightedPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * weightedPrice,
                        missingPrice: rawPriceMissing || processedPriceMissing,
                    });
                } else {
                    const bonusRevenue = bonusItemsPerHour * resolvedRawPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * resolvedRawPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: resolvedRawPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * resolvedRawPrice,
                        missingPrice: rawPriceMissing,
                    });
                }
            }
        }

        // Calculate bonus revenue from essence and rare find drops
        const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetail, actionsPerHour, equipment, gameData.itemDetailMap);

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;

        const revenuePerHour =
            baseRevenuePerHour + gourmetRevenueBonus + processingRevenueBonus + efficiencyBoostedBonusRevenue;

        const hasMissingPrices =
            drinkCosts.some((drink) => drink.missingPrice) ||
            baseOutputs.some((output) => output.missingPrice) ||
            gourmetBonuses.some((output) => output.missingPrice) ||
            processingConversions.some((conversion) => conversion.missingPrice) ||
            (bonusRevenue?.hasMissingPrices ?? false);

        // Calculate market tax (2% of gross revenue)
        const marketTax = revenuePerHour * profitConstants_js.MARKET_TAX;

        // Calculate net profit (revenue - market tax - drink costs)
        const profitPerHour = revenuePerHour - marketTax - drinkCostPerHour;

        return {
            profitPerHour,
            profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
            profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
            revenuePerHour,
            drinkCostPerHour,
            drinkCosts, // Array of individual drink costs {name, priceEach, costPerHour}
            actionsPerHour, // Base actions per hour (without efficiency)
            baseOutputs, // Display-only base outputs {name, itemsPerHour, dropRate, priceEach, revenuePerHour}
            gourmetBonuses, // Display-only gourmet bonus outputs
            totalEfficiency, // Total efficiency percentage
            efficiencyMultiplier, // Efficiency as multiplier (1 + totalEfficiency / 100)
            speedBonus,
            bonusRevenue, // Essence and rare find details
            gourmetBonus, // Gourmet bonus percentage
            processingBonus, // Processing Tea chance (as decimal)
            processingRevenueBonus, // Extra revenue from Processing conversions
            processingConversions, // Array of conversion details {rawItem, processedItem, valueGain}
            processingRevenueBonusPerAction, // Processing bonus per action
            gourmetRevenueBonus, // Gourmet bonus revenue per hour
            gourmetRevenueBonusPerAction, // Gourmet bonus revenue per action
            gatheringQuantity: totalGathering, // Total gathering quantity bonus (as decimal) - renamed for display consistency
            hasMissingPrices,
            details: {
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                achievementEfficiency,
                gourmetBonus,
                communityBuffQuantity: communityGathering, // Community Buff component (as decimal)
                gatheringTeaBonus: gatheringTea, // Gathering Tea component (as decimal)
                achievementGathering: achievementGathering, // Achievement Tier component (as decimal)
            },
        };
    }

    /**
     * Market Tooltip Prices Feature
     * Adds market prices to item tooltips
     */


    // Compiled regex patterns (created once, reused for performance)
    const REGEX_ENHANCEMENT_LEVEL = /\+(\d+)$/;
    const REGEX_ENHANCEMENT_STRIP = /\s*\+\d+$/;
    const REGEX_AMOUNT = /x([\d,]+)|Amount:\s*([\d,]+)/i;
    const REGEX_COMMA = /,/g;

    /**
     * Format price for tooltip display based on user setting
     * @param {number} num - The number to format
     * @returns {string} Formatted number
     */
    function formatTooltipPrice(num) {
        const useKMB = config.getSetting('formatting_useKMBFormat');
        return useKMB ? formatters_js.networthFormatter(num) : formatters_js.numberFormatter(num);
    }

    /**
     * TooltipPrices class handles injecting market prices into item tooltips
     */
    class TooltipPrices {
        constructor() {
            this.unregisterObserver = null;
            this.isActive = false;
            this.isInitialized = false;
            this.itemNameToHridCache = null; // Lazy-loaded reverse lookup cache
            this.itemNameToHridCacheSource = null; // Track source for invalidation
        }

        /**
         * Initialize the tooltip prices feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('itemTooltip_prices')) {
                return;
            }

            this.isInitialized = true;

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Add CSS to prevent tooltip cutoff
            this.addTooltipStyles();

            // Register with centralized DOM observer
            this.setupObserver();
        }

        /**
         * Add CSS styles to prevent tooltip cutoff
         *
         * CRITICAL: CSS alone is not enough! MUI uses JavaScript to position tooltips
         * with transform3d(), which can place them off-screen. We need both:
         * 1. CSS: Enables scrolling when tooltip is taller than viewport
         * 2. JavaScript: Repositions tooltip when it extends beyond viewport (see fixTooltipOverflow)
         */
        addTooltipStyles() {
            // Check if styles already exist (might be added by tooltip-consumables)
            if (document.getElementById('mwi-tooltip-fixes')) {
                return; // Already added
            }

            const css = `
            /* Ensure tooltip content is scrollable if too tall */
            .MuiTooltip-tooltip {
                max-height: calc(100vh - 20px) !important;
                overflow-y: auto !important;
            }

            /* Also target the popper container */
            .MuiTooltip-popper {
                max-height: 100vh !important;
            }

            /* Add subtle scrollbar styling */
            .MuiTooltip-tooltip::-webkit-scrollbar {
                width: 6px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
        `;

            dom.addStyles(css, 'mwi-tooltip-fixes');
        }

        /**
         * Set up observer to watch for tooltip elements
         */
        setupObserver() {
            // Register with centralized DOM observer to watch for tooltip poppers
            this.unregisterObserver = domObserver.onClass('TooltipPrices', 'MuiTooltip-popper', (tooltipElement) => {
                this.handleTooltip(tooltipElement);
            });

            this.isActive = true;
        }

        /**
         * Handle a tooltip element
         * @param {Element} tooltipElement - The tooltip popper element
         */
        async handleTooltip(tooltipElement) {
            // Guard against duplicate processing
            if (tooltipElement.dataset.pricesProcessed) {
                return;
            }
            tooltipElement.dataset.pricesProcessed = 'true';

            // Check if it's a collection tooltip
            const collectionContent = tooltipElement.querySelector('div.Collection_tooltipContent__2IcSJ');
            const isCollectionTooltip = !!collectionContent;

            // Check if it's a regular item tooltip
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            const isItemTooltip = !!nameElement;

            if (!isCollectionTooltip && !isItemTooltip) {
                return; // Not a tooltip we can enhance
            }

            // Extract item name from appropriate element
            let itemName;
            if (isCollectionTooltip) {
                const collectionNameElement = tooltipElement.querySelector('div.Collection_name__10aep');
                if (!collectionNameElement) {
                    return; // No name element in collection tooltip
                }
                itemName = collectionNameElement.textContent.trim();
            } else {
                itemName = nameElement.textContent.trim();
            }

            // Get the item HRID from the name
            const itemHrid = this.extractItemHridFromName(itemName);

            if (!itemHrid) {
                return;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!itemDetails) {
                return;
            }

            // Check if this is an openable container first (they have no market price)
            if (itemDetails.isOpenable && config.getSetting('itemTooltip_expectedValue')) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData) {
                    this.injectExpectedValueDisplay(tooltipElement, evData, isCollectionTooltip);
                }
                // Fix tooltip overflow before returning
                dom.fixTooltipOverflow(tooltipElement);
                return; // Skip price/profit display for containers
            }

            // Only check enhancement level for regular item tooltips (not collection tooltips)
            let enhancementLevel = 0;
            if (isItemTooltip && !isCollectionTooltip) {
                enhancementLevel = this.extractEnhancementLevel(tooltipElement);
            }

            // Get market price for the specific enhancement level (0 for base items, 1-20 for enhanced)
            const price = marketData_js.getItemPrices(itemHrid, enhancementLevel);

            // Inject price display only if we have market data
            if (price && (price.ask > 0 || price.bid > 0)) {
                // Get item amount from tooltip (for stacks)
                const amount = this.extractItemAmount(tooltipElement);
                this.injectPriceDisplay(tooltipElement, price, amount, isCollectionTooltip);
            }

            // Always show detailed craft profit if enabled
            if (config.getSetting('itemTooltip_profit') && enhancementLevel === 0) {
                // Original single-action craft profit display
                // Only run for base items (enhancementLevel = 0), not enhanced items
                // Enhanced items show their cost in the enhancement path section instead
                const profitData = await profitCalculator.calculateProfit(itemHrid);
                if (profitData) {
                    this.injectProfitDisplay(tooltipElement, profitData, isCollectionTooltip);
                }
            }

            // Optionally show alternative alchemy actions below craft profit
            if (config.getSetting('itemTooltip_multiActionProfit')) {
                // Multi-action profit display (alchemy actions only - craft shown above)
                await this.injectMultiActionProfitDisplay(tooltipElement, itemHrid, enhancementLevel, isCollectionTooltip);
            }

            // Check for gathering sources (Foraging, Woodcutting, Milking)
            if (config.getSetting('itemTooltip_gathering') && enhancementLevel === 0) {
                const gatheringData = await this.findGatheringSources(itemHrid);
                if (gatheringData && (gatheringData.soloActions.length > 0 || gatheringData.zoneActions.length > 0)) {
                    this.injectGatheringDisplay(tooltipElement, gatheringData, isCollectionTooltip);
                }
            }

            // Show enhancement path for enhanced items (1-20)
            if (enhancementLevel > 0) {
                // Get enhancement configuration
                const enhancementConfig = enhancementConfig_js.getEnhancingParams();
                if (enhancementConfig) {
                    // Calculate optimal enhancement path
                    const enhancementData = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementConfig);

                    if (enhancementData) {
                        // Inject enhancement analysis into tooltip
                        this.injectEnhancementDisplay(tooltipElement, enhancementData);
                    }
                }
            }

            // Fix tooltip overflow (ensure it stays in viewport)
            dom.fixTooltipOverflow(tooltipElement);
        }

        /**
         * Extract enhancement level from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {number} Enhancement level (0 if not enhanced)
         */
        extractEnhancementLevel(tooltipElement) {
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return 0;
            }

            const itemName = nameElement.textContent.trim();

            // Match "+X" at end of name
            const match = itemName.match(REGEX_ENHANCEMENT_LEVEL);
            if (match) {
                return parseInt(match[1], 10);
            }

            return 0;
        }

        /**
         * Inject enhancement display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} enhancementData - Enhancement analysis data
         */
        injectEnhancementDisplay(tooltipElement, enhancementData) {
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.market-enhancement-injected')) {
                return;
            }

            // Create enhancement display container
            const enhancementDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO },
                '',
                'market-enhancement-injected'
            );

            // Build HTML using the tooltip-enhancement module
            enhancementDiv.innerHTML = buildEnhancementTooltipHTML(enhancementData);

            tooltipText.appendChild(enhancementDiv);
        }

        /**
         * Extract item HRID from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {string|null} Item HRID or null
         */
        extractItemHrid(tooltipElement) {
            // Try to find the item HRID from the tooltip's data attributes or content
            // The game uses React, so we need to find the HRID from the displayed name

            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return null;
            }

            let itemName = nameElement.textContent.trim();

            // Strip enhancement level (e.g., "+10" from "Griffin Bulwark +10")
            // This is critical - enhanced items need to lookup the base item
            itemName = itemName.replace(REGEX_ENHANCEMENT_STRIP, '');

            return this.extractItemHridFromName(itemName);
        }

        /**
         * Extract item HRID from item name
         * @param {string} itemName - Item name
         * @returns {string|null} Item HRID or null
         */
        extractItemHridFromName(itemName) {
            // Strip enhancement level (e.g., "+10" from "Griffin Bulwark +10")
            // This is critical - enhanced items need to lookup the base item
            itemName = itemName.replace(REGEX_ENHANCEMENT_STRIP, '');

            const initData = dataManager.getInitClientData();
            if (!initData || !initData.itemDetailMap) {
                return null;
            }

            // Return cached map if source data hasn't changed (handles character switch)
            if (this.itemNameToHridCache && this.itemNameToHridCacheSource === initData.itemDetailMap) {
                return this.itemNameToHridCache.get(itemName) || null;
            }

            // Build itemName -> HRID map
            const map = new Map();
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                map.set(item.name, hrid);
            }

            // Only cache if we got actual entries (avoid poisoning with empty map)
            if (map.size > 0) {
                this.itemNameToHridCache = map;
                this.itemNameToHridCacheSource = initData.itemDetailMap;
            }

            // Return result from newly built map
            return map.get(itemName) || null;
        }

        /**
         * Extract item amount from tooltip (for stacks)
         * @param {Element} tooltipElement - Tooltip element
         * @returns {number} Item amount (default 1)
         */
        extractItemAmount(tooltipElement) {
            // Look for amount text in tooltip (e.g., "x5", "Amount: 5", "Amount: 4,900")
            const text = tooltipElement.textContent;
            const match = text.match(REGEX_AMOUNT);

            if (match) {
                // Strip commas before parsing
                const amountStr = (match[1] || match[2]).replace(REGEX_COMMA, '');
                return parseInt(amountStr, 10);
            }

            return 1; // Default to 1 if not found
        }

        /**
         * Inject price display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} price - { ask, bid }
         * @param {number} amount - Item amount
         * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
         */
        injectPriceDisplay(tooltipElement, price, amount, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                console.warn('[TooltipPrices] Could not find tooltip text container');
                return;
            }

            if (tooltipText.querySelector('.market-price-injected')) {
                return;
            }

            // Create price display
            const priceDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'market-price-injected');

            // Show message if no market data at all
            if (price.ask <= 0 && price.bid <= 0) {
                priceDiv.innerHTML = `Price: <span style="color: ${config.COLOR_TEXT_SECONDARY}; font-style: italic;">No market data</span>`;
                tooltipText.appendChild(priceDiv);
                return;
            }

            // Format prices, using "-" for missing values
            const askDisplay = price.ask > 0 ? formatTooltipPrice(price.ask) : '-';
            const bidDisplay = price.bid > 0 ? formatTooltipPrice(price.bid) : '-';

            // Calculate totals (only if both prices valid and amount > 1)
            let totalDisplay = '';
            if (amount > 1 && price.ask > 0 && price.bid > 0) {
                const totalAsk = price.ask * amount;
                const totalBid = price.bid * amount;
                totalDisplay = ` (${formatTooltipPrice(totalAsk)} / ${formatTooltipPrice(totalBid)})`;
            }

            // Format: "Price: 1,200 / 950" or "Price: 1,200 / -" or "Price: - / 950"
            priceDiv.innerHTML = `Price: ${askDisplay} / ${bidDisplay}${totalDisplay}`;

            tooltipText.appendChild(priceDiv);
        }

        /**
         * Inject profit display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} profitData - Profit calculation data
         * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
         */
        injectProfitDisplay(tooltipElement, profitData, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.market-profit-injected')) {
                return;
            }

            // Create profit display container
            const profitDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
                '',
                'market-profit-injected'
            );

            // Check if detailed view is enabled
            const showDetailed = config.getSetting('itemTooltip_detailedProfit');

            // Build profit display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            if (profitData.itemPrice.bid > 0 && profitData.itemPrice.ask > 0) {
                // Market data available - show profit
                html += '<div style="font-weight: bold; margin-bottom: 4px;">PROFIT</div>';
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                const profitPerDay = profitData.profitPerDay;
                const profitColor = profitData.profitPerHour >= 0 ? config.COLOR_TOOLTIP_PROFIT : config.COLOR_TOOLTIP_LOSS;

                html += `<div style="color: ${profitColor}; font-weight: bold;">Net: ${formatters_js.numberFormatter(profitData.profitPerHour)}/hr (${formatters_js.formatKMB(profitPerDay)}/day)</div>`;

                // Show detailed breakdown if enabled
                if (showDetailed) {
                    html += this.buildDetailedProfitDisplay(profitData);
                }
            } else {
                // No market data - show cost
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                const teaCostPerItem = profitData.totalTeaCostPerHour / profitData.itemsPerHour;
                const productionCost = profitData.totalMaterialCost + teaCostPerItem;

                html += `<div style="font-weight: bold; color: ${config.COLOR_TOOLTIP_INFO};">Cost: ${formatters_js.numberFormatter(productionCost)}/item</div>`;
                html += `<div style="color: ${config.COLOR_TEXT_SECONDARY}; font-style: italic; margin-top: 4px;">No market data available</div>`;
            }

            html += '</div>';
            html += '</div>';

            profitDiv.innerHTML = html;
            tooltipText.appendChild(profitDiv);
        }

        /**
         * Build detailed profit display with materials table
         * @param {Object} profitData - Profit calculation data
         * @returns {string} HTML string for detailed display
         */
        buildDetailedProfitDisplay(profitData) {
            let html = '';

            // Materials table
            if (profitData.materialCosts && profitData.materialCosts.length > 0) {
                html += '<div style="margin-top: 8px;">';
                html += `<table style="width: 100%; border-collapse: collapse; font-size: 0.85em; color: ${config.COLOR_TOOLTIP_INFO};">`;

                // Table header
                html += `<tr style="border-bottom: 1px solid ${config.COLOR_BORDER};">`;
                html += '<th style="padding: 2px 4px; text-align: left;">Material</th>';
                html += '<th style="padding: 2px 4px; text-align: center;">Count</th>';
                html += '<th style="padding: 2px 4px; text-align: right;">Ask</th>';
                html += '<th style="padding: 2px 4px; text-align: right;">Bid</th>';
                html += '</tr>';

                // Fetch market prices for all materials (profit calculator only stores one price based on mode)
                const materialsWithPrices = profitData.materialCosts.map((material) => {
                    const itemHrid = material.itemHrid;
                    const marketPrice = marketAPI.getPrice(itemHrid, 0);

                    return {
                        ...material,
                        askPrice: marketPrice?.ask && marketPrice.ask > 0 ? marketPrice.ask : 0,
                        bidPrice: marketPrice?.bid && marketPrice.bid > 0 ? marketPrice.bid : 0,
                    };
                });

                // Calculate totals using actual amounts (not count - materialCosts uses 'amount' field)
                const totalCount = materialsWithPrices.reduce((sum, m) => sum + m.amount, 0);
                const totalAsk = materialsWithPrices.reduce((sum, m) => sum + m.askPrice * m.amount, 0);
                const totalBid = materialsWithPrices.reduce((sum, m) => sum + m.bidPrice * m.amount, 0);

                // Total row
                html += `<tr style="border-bottom: 1px solid ${config.COLOR_BORDER};">`;
                html += '<td style="padding: 2px 4px; font-weight: bold;">Total</td>';
                html += `<td style="padding: 2px 4px; text-align: center;">${totalCount.toFixed(1)}</td>`;
                html += `<td style="padding: 2px 4px; text-align: right;">${formatters_js.formatKMB(totalAsk)}</td>`;
                html += `<td style="padding: 2px 4px; text-align: right;">${formatters_js.formatKMB(totalBid)}</td>`;
                html += '</tr>';

                // Material rows
                for (const material of materialsWithPrices) {
                    html += '<tr>';
                    html += `<td style="padding: 2px 4px;">${material.itemName}</td>`;
                    html += `<td style="padding: 2px 4px; text-align: center;">${material.amount.toFixed(1)}</td>`;
                    html += `<td style="padding: 2px 4px; text-align: right;">${formatters_js.formatKMB(material.askPrice)}</td>`;
                    html += `<td style="padding: 2px 4px; text-align: right;">${formatters_js.formatKMB(material.bidPrice)}</td>`;
                    html += '</tr>';
                }

                html += '</table>';
                html += '</div>';
            }

            // Detailed profit breakdown
            html += '<div style="margin-top: 8px; font-size: 0.85em;">';
            const profitPerAction = profitData.profitPerAction;
            const profitPerDay = profitData.profitPerDay;
            const profitColor = profitData.profitPerHour >= 0 ? config.COLOR_TOOLTIP_PROFIT : config.COLOR_TOOLTIP_LOSS;

            html += `<div style="color: ${profitColor};">Profit: ${formatters_js.numberFormatter(profitPerAction)}/action, ${formatters_js.numberFormatter(profitData.profitPerHour)}/hour, ${formatters_js.formatKMB(profitPerDay)}/day</div>`;
            html += '</div>';

            return html;
        }

        /**
         * Inject expected value display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} evData - Expected value calculation data
         * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
         */
        injectExpectedValueDisplay(tooltipElement, evData, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.market-ev-injected')) {
                return;
            }

            // Create EV display container
            const evDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
                '',
                'market-ev-injected'
            );

            // Build EV display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            // Header
            html += '<div style="font-weight: bold; margin-bottom: 4px;">EXPECTED VALUE</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // Expected value (simple display)
            html += `<div style="color: ${config.COLOR_TOOLTIP_PROFIT}; font-weight: bold;">Expected Return: ${formatTooltipPrice(evData.expectedValue)}</div>`;

            html += '</div>'; // Close summary section

            // Drop breakdown (if configured to show)
            const showDropsSetting = config.getSettingValue('expectedValue_showDrops', 'All');

            if (showDropsSetting !== 'None' && evData.drops.length > 0) {
                html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 8px 0;"></div>';

                // Determine how many drops to show
                let dropsToShow = evData.drops;
                let headerLabel = 'All Drops';

                if (showDropsSetting === 'Top 5') {
                    dropsToShow = evData.drops.slice(0, 5);
                    headerLabel = 'Top 5 Drops';
                } else if (showDropsSetting === 'Top 10') {
                    dropsToShow = evData.drops.slice(0, 10);
                    headerLabel = 'Top 10 Drops';
                }

                html += `<div style="font-weight: bold; margin-bottom: 4px;">${headerLabel} (${evData.drops.length} total):</div>`;
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';

                // List each drop
                for (const drop of dropsToShow) {
                    if (!drop.hasPriceData) {
                        // Show item without price data in gray
                        html += `<div style="color: ${config.COLOR_TEXT_SECONDARY};">• ${drop.itemName} (${formatters_js.formatPercentage(drop.dropRate, 2)}): ${drop.avgCount.toFixed(2)} avg → No price data</div>`;
                    } else {
                        // Format drop rate percentage
                        const dropRatePercent = formatters_js.formatPercentage(drop.dropRate, 2);

                        // Show full drop breakdown
                        html += `<div>• ${drop.itemName} (${dropRatePercent}%): ${drop.avgCount.toFixed(2)} avg → ${formatTooltipPrice(drop.expectedValue)}</div>`;
                    }
                }

                html += '</div>'; // Close drops list

                // Show total
                html += '<div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 4px 0;"></div>';
                html += `<div style="font-size: 0.9em; margin-left: 8px; font-weight: bold;">Total from ${evData.drops.length} drops: ${formatTooltipPrice(evData.expectedValue)}</div>`;
            }

            html += '</div>'; // Close main container

            evDiv.innerHTML = html;

            tooltipText.appendChild(evDiv);
        }

        /**
         * Find gathering sources for an item
         * @param {string} itemHrid - Item HRID
         * @returns {Object|null} { soloActions: [...], zoneActions: [...] }
         */
        async findGatheringSources(itemHrid) {
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.actionDetailMap) {
                return null;
            }

            const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

            const soloActions = [];
            const zoneActions = [];

            // Search through all actions
            for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
                // Skip non-gathering actions
                if (!GATHERING_TYPES.includes(action.type)) {
                    continue;
                }

                // Check if this action produces our item
                let foundInDrop = false;
                let dropRate = 0;
                let isSolo = false;

                // Check drop table (both solo and zone actions)
                if (action.dropTable) {
                    for (const drop of action.dropTable) {
                        if (drop.itemHrid === itemHrid) {
                            foundInDrop = true;
                            dropRate = drop.dropRate;
                            // Solo gathering has 100% drop rate (dropRate === 1)
                            // Zone gathering has < 100% drop rate
                            isSolo = dropRate === 1;
                            break;
                        }
                    }
                }

                // Check rare drop table (rare finds - always zone actions)
                if (!foundInDrop && action.rareDropTable) {
                    for (const drop of action.rareDropTable) {
                        if (drop.itemHrid === itemHrid) {
                            foundInDrop = true;
                            dropRate = drop.dropRate;
                            isSolo = false; // Rare drops are never solo
                            break;
                        }
                    }
                }

                if (foundInDrop || isSolo) {
                    const actionData = {
                        actionHrid,
                        actionName: action.name,
                        dropRate,
                    };

                    if (isSolo) {
                        soloActions.push(actionData);
                    } else {
                        zoneActions.push(actionData);
                    }
                }
            }

            // Only return if we found something
            if (soloActions.length === 0 && zoneActions.length === 0) {
                return null;
            }

            // Calculate profit for solo actions
            for (const action of soloActions) {
                const profitData = await calculateGatheringProfit(action.actionHrid);
                if (profitData) {
                    action.itemsPerHour = profitData.baseOutputs?.[0]?.itemsPerHour || 0;
                    action.profitPerHour = profitData.profitPerHour || 0;
                }
            }

            // Calculate items/hr for zone actions (no profit)
            for (const action of zoneActions) {
                const actionDetail = gameData.actionDetailMap[action.actionHrid];
                if (!actionDetail) {
                    continue;
                }

                // Calculate base actions per hour
                const baseTimeCost = actionDetail.baseTimeCost; // in nanoseconds
                const timeInSeconds = baseTimeCost / 1e9;
                const actionsPerHour = profitHelpers_js.calculateActionsPerHour(timeInSeconds);

                // Calculate items per hour
                const itemsPerHour = actionsPerHour * action.dropRate;

                // For rare drops (< 1%), store items/day instead for better readability
                // For regular drops (>= 1%), store items/hr
                if (action.dropRate < 0.01) {
                    action.itemsPerDay = itemsPerHour * 24;
                    action.isRareDrop = true;
                } else {
                    action.itemsPerHour = itemsPerHour;
                    action.isRareDrop = false;
                }
            }

            return { soloActions, zoneActions };
        }

        /**
         * Inject gathering display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} gatheringData - { soloActions: [...], zoneActions: [...] }
         * @param {boolean} isCollectionTooltip - True if collection tooltip
         */
        injectGatheringDisplay(tooltipElement, gatheringData, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.market-gathering-injected')) {
                return;
            }

            // Filter out rare drops if setting is disabled
            const showRareDrops = config.getSetting('itemTooltip_gatheringRareDrops');
            let zoneActions = gatheringData.zoneActions;
            if (!showRareDrops) {
                zoneActions = zoneActions.filter((action) => !action.isRareDrop);
            }

            // Skip if no actions to show
            if (gatheringData.soloActions.length === 0 && zoneActions.length === 0) {
                return;
            }

            // Create gathering display container
            const gatheringDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
                '',
                'market-gathering-injected'
            );

            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';
            html += '<div style="font-weight: bold; margin-bottom: 4px;">GATHERING</div>';

            // Solo actions section
            if (gatheringData.soloActions.length > 0) {
                html += '<div style="font-size: 0.9em; margin-left: 8px; margin-bottom: 6px;">';
                html += '<div style="font-weight: 500; margin-bottom: 2px;">Solo:</div>';

                for (const action of gatheringData.soloActions) {
                    const itemsPerHourStr = action.itemsPerHour ? Math.round(action.itemsPerHour) : '?';
                    const profitStr = action.profitPerHour ? formatters_js.formatKMB(Math.round(action.profitPerHour)) : '?';

                    html += `<div style="margin-left: 8px;">• ${action.actionName}: ${itemsPerHourStr} items/hr | ${profitStr} gold/hr</div>`;
                }

                html += '</div>';
            }

            // Zone actions section
            if (zoneActions.length > 0) {
                html += '<div style="font-size: 0.9em; margin-left: 8px;">';
                html += '<div style="font-weight: 500; margin-bottom: 2px;">Found in:</div>';

                for (const action of zoneActions) {
                    // Use more decimal places for very rare drops (< 0.1%)
                    const percentValue = action.dropRate * 100;
                    const dropRatePercent = percentValue < 0.1 ? percentValue.toFixed(4) : percentValue.toFixed(1);

                    // Show items/day for rare drops (< 1%), items/hr for regular drops
                    let itemsDisplay;
                    if (action.isRareDrop) {
                        const itemsPerDayStr = action.itemsPerDay ? action.itemsPerDay.toFixed(2) : '?';
                        itemsDisplay = `${itemsPerDayStr} items/day`;
                    } else {
                        const itemsPerHourStr = action.itemsPerHour ? Math.round(action.itemsPerHour) : '?';
                        itemsDisplay = `${itemsPerHourStr} items/hr`;
                    }

                    html += `<div style="margin-left: 8px;">• ${action.actionName}: ${itemsDisplay} (${dropRatePercent}% drop)</div>`;
                }

                html += '</div>';
            }

            html += '</div>'; // Close main container

            gatheringDiv.innerHTML = html;

            tooltipText.appendChild(gatheringDiv);
        }

        /**
         * Inject multi-action profit display into tooltip
         * Shows all profitable actions (craft, coinify, decompose, transmute) with best highlighted
         * @param {Element} tooltipElement - Tooltip element
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
         */
        async injectMultiActionProfitDisplay(tooltipElement, itemHrid, enhancementLevel, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.market-multi-action-injected')) {
                return;
            }

            // Collect alchemy profit data (craft profit is shown separately via injectProfitDisplay)
            const allProfits = [];

            // Try alchemy profits (coinify, decompose, transmute)
            const alchemyProfits = alchemyProfitCalculator.calculateAllProfits(itemHrid, enhancementLevel);

            if (alchemyProfits.coinify) {
                allProfits.push(alchemyProfits.coinify);
            }
            if (alchemyProfits.decompose) {
                allProfits.push(alchemyProfits.decompose);
            }
            if (alchemyProfits.transmute) {
                allProfits.push(alchemyProfits.transmute);
            }

            // If no profitable actions found, return
            if (allProfits.length === 0) {
                return;
            }

            // Sort by profitPerHour descending
            allProfits.sort((a, b) => b.profitPerHour - a.profitPerHour);

            // Check if item is craftable (has a production action)
            const isCraftable = profitCalculator.findProductionAction(itemHrid) !== null;

            // Create profit display container
            const profitDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
                '',
                'market-multi-action-injected'
            );

            // Build display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            // Show heading based on whether item is craftable
            const heading = isCraftable ? 'Alternative Actions:' : 'Profits:';
            html += `<div style="font-weight: bold; margin-bottom: 4px;">${heading}</div>`;
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            for (let i = 0; i < allProfits.length; i++) {
                const profit = allProfits[i];
                const label = profit.actionType.charAt(0).toUpperCase() + profit.actionType.slice(1);
                const color = profit.profitPerHour >= 0 ? config.COLOR_TOOLTIP_INFO : config.COLOR_TOOLTIP_LOSS;
                html += `<div style="color: ${color};">• ${label}: ${formatters_js.numberFormatter(profit.profitPerHour)}/hr`;

                // Show success rate for alchemy actions
                if (profit.successRate !== undefined) {
                    html += ` <span style="opacity: 0.7;">(${(profit.successRate * 100).toFixed(0)}% success)</span>`;
                }

                html += '</div>';
            }

            html += '</div>';

            html += '</div>';

            profitDiv.innerHTML = html;
            tooltipText.appendChild(profitDiv);
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const tooltipPrices = new TooltipPrices();

    /**
     * Consumable Tooltips Feature
     * Adds HP/MP restoration stats to food/drink tooltips
     */


    /**
     * TooltipConsumables class handles injecting consumable stats into item tooltips
     */
    class TooltipConsumables {
        constructor() {
            this.unregisterObserver = null;
            this.isActive = false;
            this.isInitialized = false;
            this.itemNameToHridCache = null; // Lazy-loaded reverse lookup cache
            this.itemNameToHridCacheSource = null; // Track source for invalidation
        }

        /**
         * Initialize the consumable tooltips feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('showConsumTips')) {
                return;
            }

            this.isInitialized = true;

            // Wait for market data to load (needed for cost calculations)
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true);
            }

            // Add CSS to prevent tooltip cutoff (if not already added)
            this.addTooltipStyles();

            // Register with centralized DOM observer
            this.setupObserver();
        }

        /**
         * Add CSS styles to prevent tooltip cutoff
         *
         * CRITICAL: CSS alone is not enough! MUI uses JavaScript to position tooltips
         * with transform3d(), which can place them off-screen. We need both:
         * 1. CSS: Enables scrolling when tooltip is taller than viewport
         * 2. JavaScript: Repositions tooltip when it extends beyond viewport (see fixTooltipOverflow)
         */
        addTooltipStyles() {
            // Check if styles already exist (might be added by tooltip-prices)
            if (document.getElementById('mwi-tooltip-fixes')) {
                return; // Already added
            }

            const css = `
            /* Ensure tooltip content is scrollable if too tall */
            .MuiTooltip-tooltip {
                max-height: calc(100vh - 20px) !important;
                overflow-y: auto !important;
            }

            /* Also target the popper container */
            .MuiTooltip-popper {
                max-height: 100vh !important;
            }

            /* Add subtle scrollbar styling */
            .MuiTooltip-tooltip::-webkit-scrollbar {
                width: 6px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }

            .MuiTooltip-tooltip::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
        `;

            dom.addStyles(css, 'mwi-tooltip-fixes');
        }

        /**
         * Set up observer to watch for tooltip elements
         */
        setupObserver() {
            // Register with centralized DOM observer to watch for tooltip poppers
            this.unregisterObserver = domObserver.onClass('TooltipConsumables', 'MuiTooltip-popper', (tooltipElement) => {
                this.handleTooltip(tooltipElement);
            });

            this.isActive = true;
        }

        /**
         * Handle a tooltip element
         * @param {Element} tooltipElement - The tooltip popper element
         */
        async handleTooltip(tooltipElement) {
            // Guard against duplicate processing
            if (tooltipElement.dataset.consumablesProcessed) {
                return;
            }
            tooltipElement.dataset.consumablesProcessed = 'true';

            // Check if it's an item tooltip
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');

            if (!nameElement) {
                return; // Not an item tooltip
            }

            // Get the item HRID from the tooltip
            const itemHrid = this.extractItemHrid(tooltipElement);

            if (!itemHrid) {
                return;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);

            if (!itemDetails || !itemDetails.consumableDetail) {
                return; // Not a consumable
            }

            // Calculate consumable stats
            const consumableStats = this.calculateConsumableStats(itemHrid, itemDetails);

            if (!consumableStats) {
                return; // No stats to show
            }

            // Inject consumable display
            this.injectConsumableDisplay(tooltipElement, consumableStats);

            // Fix tooltip overflow (ensure it stays in viewport)
            dom.fixTooltipOverflow(tooltipElement);
        }

        /**
         * Extract item HRID from tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @returns {string|null} Item HRID or null
         */
        extractItemHrid(tooltipElement) {
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            if (!nameElement) {
                return null;
            }

            const itemName = nameElement.textContent.trim();

            const initData = dataManager.getInitClientData();
            if (!initData || !initData.itemDetailMap) {
                return null;
            }

            // Return cached map if source data hasn't changed (handles character switch)
            if (this.itemNameToHridCache && this.itemNameToHridCacheSource === initData.itemDetailMap) {
                return this.itemNameToHridCache.get(itemName) || null;
            }

            // Build itemName -> HRID map
            const map = new Map();
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                map.set(item.name, hrid);
            }

            // Only cache if we got actual entries (avoid poisoning with empty map)
            if (map.size > 0) {
                this.itemNameToHridCache = map;
                this.itemNameToHridCacheSource = initData.itemDetailMap;
            }

            // Return result from newly built map
            return map.get(itemName) || null;
        }

        /**
         * Calculate consumable stats
         * @param {string} itemHrid - Item HRID
         * @param {Object} itemDetails - Item details from game data
         * @returns {Object|null} Consumable stats or null
         */
        calculateConsumableStats(itemHrid, itemDetails) {
            const consumable = itemDetails.consumableDetail;

            if (!consumable) {
                return null;
            }

            // Get the restoration type and amount
            let restoreType = null;
            let restoreAmount = 0;

            // Check for HP restoration
            if (consumable.hitpointRestore) {
                restoreType = 'HP';
                restoreAmount = consumable.hitpointRestore;
            }
            // Check for MP restoration
            else if (consumable.manapointRestore) {
                restoreType = 'MP';
                restoreAmount = consumable.manapointRestore;
            }

            if (!restoreType || restoreAmount === 0) {
                return null; // No restoration stats
            }

            // Track BOTH durations separately
            const recoveryDuration = consumable.recoveryDuration ? consumable.recoveryDuration / 1e9 : 0;
            const cooldownDuration = consumable.cooldownDuration ? consumable.cooldownDuration / 1e9 : 0;

            // Restore per second (for over-time items)
            const restorePerSecond = recoveryDuration > 0 ? restoreAmount / recoveryDuration : 0;

            // Get market price for cost calculations
            const price = marketAPI.getPrice(itemHrid, 0);
            const askPrice = price?.ask || 0;

            // Cost per HP or MP
            const costPerPoint = askPrice > 0 ? askPrice / restoreAmount : 0;

            // Daily max based on COOLDOWN, not recovery duration
            const usesPerDay = cooldownDuration > 0 ? (24 * 60 * 60) / cooldownDuration : 0;
            const dailyMax = restoreAmount * usesPerDay;

            return {
                restoreType,
                restoreAmount,
                restorePerSecond,
                recoveryDuration, // How long healing takes
                cooldownDuration, // How often you can use it
                askPrice,
                costPerPoint,
                dailyMax,
                usesPerDay,
            };
        }

        /**
         * Inject consumable display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Object} stats - Consumable stats
         */
        injectConsumableDisplay(tooltipElement, stats) {
            const tooltipText = tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.consumable-stats-injected')) {
                return;
            }

            // Create consumable display container
            const consumableDiv = dom.createStyledDiv(
                { color: config.COLOR_TOOLTIP_INFO, marginTop: '8px' },
                '',
                'consumable-stats-injected'
            );

            // Build consumable display
            let html = '<div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';

            // CONSUMABLE STATS section
            html += '<div style="font-weight: bold; margin-bottom: 4px;">CONSUMABLE STATS</div>';
            html += '<div style="font-size: 0.9em; margin-left: 8px;">';

            // Restores line
            if (stats.recoveryDuration > 0) {
                html += `<div>Restores: ${formatters_js.numberFormatter(stats.restorePerSecond, 1)} ${stats.restoreType}/s</div>`;
            } else {
                html += `<div>Restores: ${formatters_js.numberFormatter(stats.restoreAmount)} ${stats.restoreType} (instant)</div>`;
            }

            // Cost efficiency line
            if (stats.costPerPoint > 0) {
                html += `<div>Cost: ${formatters_js.numberFormatter(stats.costPerPoint, 1)} per ${stats.restoreType}</div>`;
            } else if (stats.askPrice === 0) {
                html += `<div style="color: gray; font-style: italic;">Cost: No market data</div>`;
            }

            // Daily maximum line - ALWAYS show (based on cooldown)
            if (stats.dailyMax > 0) {
                html += `<div>Daily Max: ${formatters_js.numberFormatter(stats.dailyMax)} ${stats.restoreType}</div>`;
            }

            // Recovery duration line - ONLY for over-time items
            if (stats.recoveryDuration > 0) {
                html += `<div>Recovery Time: ${stats.recoveryDuration}s</div>`;
            }

            // Cooldown line - ALWAYS show
            if (stats.cooldownDuration > 0) {
                html += `<div>Cooldown: ${stats.cooldownDuration}s (${formatters_js.numberFormatter(stats.usesPerDay)} uses/day)</div>`;
            }

            html += '</div>';
            html += '</div>';

            consumableDiv.innerHTML = html;

            tooltipText.appendChild(consumableDiv);
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const tooltipConsumables = new TooltipConsumables();

    /**
     * Market Filter
     * Adds filter dropdowns to marketplace to filter by level, class (skill requirement), and equipment slot
     */


    class MarketFilter {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.isInitialized = false;

            // Filter state
            this.minLevel = 1;
            this.maxLevel = 1000;
            this.skillRequirement = 'all';
            this.equipmentSlot = 'all';

            // Filter container reference
            this.filterContainer = null;
        }

        /**
         * Initialize market filter
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('marketFilter')) {
                return;
            }

            this.isInitialized = true;

            // Register DOM observer for marketplace panel
            this.registerDOMObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers for marketplace panel
         */
        registerDOMObservers() {
            // Watch for marketplace panel appearing
            const unregister = domObserver.onClass(
                'market-filter-container',
                'MarketplacePanel_itemFilterContainer',
                (filterContainer) => {
                    this.injectFilterUI(filterContainer);
                }
            );

            this.unregisterHandlers.push(unregister);

            // Watch for market items appearing/updating
            const unregisterItems = domObserver.onClass(
                'market-filter-items',
                'MarketplacePanel_marketItems',
                (_marketItemsContainer) => {
                    this.applyFilters();
                }
            );

            this.unregisterHandlers.push(unregisterItems);

            // Also check immediately in case marketplace is already open
            const existingFilterContainer = document.querySelector('div[class*="MarketplacePanel_itemFilterContainer"]');
            if (existingFilterContainer) {
                this.injectFilterUI(existingFilterContainer);
            }
        }

        /**
         * Inject filter UI into marketplace panel
         * @param {HTMLElement} _oriFilterContainer - Original filter container
         */
        injectFilterUI(_oriFilterContainer) {
            // Check if already injected
            if (document.querySelector('#toolasha-market-filters')) {
                return;
            }

            // Create filter container
            const filterDiv = document.createElement('div');
            filterDiv.id = 'toolasha-market-filters';
            filterDiv.style.cssText = 'display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;';

            // Add level range filters
            filterDiv.appendChild(this.createLevelFilter('min'));
            filterDiv.appendChild(this.createLevelFilter('max'));

            // Add class (skill requirement) filter
            filterDiv.appendChild(this.createClassFilter());

            // Add slot (equipment type) filter
            filterDiv.appendChild(this.createSlotFilter());

            // Insert after the original filter container
            _oriFilterContainer.parentElement.insertBefore(filterDiv, _oriFilterContainer.nextSibling);

            this.filterContainer = filterDiv;

            // Apply initial filters
            this.applyFilters();
        }

        /**
         * Create level filter dropdown
         * @param {string} type - 'min' or 'max'
         * @returns {HTMLElement} Filter element
         */
        createLevelFilter(type) {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = type === 'min' ? 'Level >= ' : 'Level < ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = `toolasha-level-${type}`;
            select.style.cssText =
                'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            // Level options
            const levels =
                type === 'min'
                    ? [1, 10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100]
                    : [10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100, 1000];

            levels.forEach((level) => {
                const option = document.createElement('option');
                option.value = level;
                option.textContent = level === 1000 ? 'All' : level;
                if ((type === 'min' && level === 1) || (type === 'max' && level === 1000)) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            // Event listener
            select.addEventListener('change', () => {
                if (type === 'min') {
                    this.minLevel = parseInt(select.value);
                } else {
                    this.maxLevel = parseInt(select.value);
                }
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Create class (skill requirement) filter dropdown
         * @returns {HTMLElement} Filter element
         */
        createClassFilter() {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = 'Class: ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = 'toolasha-class-filter';
            select.style.cssText =
                'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            const classes = [
                { value: 'all', label: 'All' },
                { value: 'attack', label: 'Attack' },
                { value: 'melee', label: 'Melee' },
                { value: 'defense', label: 'Defense' },
                { value: 'ranged', label: 'Ranged' },
                { value: 'magic', label: 'Magic' },
                { value: 'others', label: 'Others' },
            ];

            classes.forEach((cls) => {
                const option = document.createElement('option');
                option.value = cls.value;
                option.textContent = cls.label;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                this.skillRequirement = select.value;
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Create slot (equipment type) filter dropdown
         * @returns {HTMLElement} Filter element
         */
        createSlotFilter() {
            const container = document.createElement('span');
            container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const label = document.createElement('label');
            label.textContent = 'Slot: ';
            label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

            const select = document.createElement('select');
            select.id = 'toolasha-slot-filter';
            select.style.cssText =
                'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

            const slots = [
                { value: 'all', label: 'All' },
                { value: 'main_hand', label: 'Main Hand' },
                { value: 'off_hand', label: 'Off Hand' },
                { value: 'two_hand', label: 'Two Hand' },
                { value: 'head', label: 'Head' },
                { value: 'body', label: 'Body' },
                { value: 'hands', label: 'Hands' },
                { value: 'legs', label: 'Legs' },
                { value: 'feet', label: 'Feet' },
                { value: 'neck', label: 'Neck' },
                { value: 'earrings', label: 'Earrings' },
                { value: 'ring', label: 'Ring' },
                { value: 'pouch', label: 'Pouch' },
                { value: 'back', label: 'Back' },
            ];

            slots.forEach((slot) => {
                const option = document.createElement('option');
                option.value = slot.value;
                option.textContent = slot.label;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                this.equipmentSlot = select.value;
                this.applyFilters();
            });

            container.appendChild(label);
            container.appendChild(select);
            return container;
        }

        /**
         * Apply filters to all market items
         */
        applyFilters() {
            const marketItemsContainer = document.querySelector('div[class*="MarketplacePanel_marketItems"]');
            if (!marketItemsContainer) {
                return;
            }

            // Get game data
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.itemDetailMap) {
                return;
            }

            // Find all item divs
            const itemDivs = marketItemsContainer.querySelectorAll('div[class*="Item_itemContainer"]');

            itemDivs.forEach((itemDiv) => {
                // Get item HRID from SVG use element (same as MWI Tools)
                const useElement = itemDiv.querySelector('use');
                if (!useElement) {
                    return;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    return;
                }

                // Extract HRID from href (e.g., #azure_sword -> /items/azure_sword)
                const hrefName = href.split('#')[1];
                if (!hrefName) {
                    return;
                }

                const itemHrid = `/items/${hrefName}`;
                const itemData = gameData.itemDetailMap[itemHrid];

                if (!itemData) {
                    itemDiv.style.display = '';
                    return;
                }

                if (!itemData.equipmentDetail) {
                    // Not equipment, hide if any non-"all" filter is active
                    if (
                        this.minLevel > 1 ||
                        this.maxLevel < 1000 ||
                        this.skillRequirement !== 'all' ||
                        this.equipmentSlot !== 'all'
                    ) {
                        itemDiv.style.display = 'none';
                    } else {
                        itemDiv.style.display = '';
                    }
                    return;
                }

                // Check if item passes all filters
                const passesFilters = this.checkItemFilters(itemData);
                itemDiv.style.display = passesFilters ? '' : 'none';
            });
        }

        /**
         * Check if item passes all current filters
         * @param {Object} itemData - Item data from game
         * @returns {boolean} True if item should be shown
         */
        checkItemFilters(itemData) {
            const itemLevel = itemData.itemLevel || 0;
            const equipmentDetail = itemData.equipmentDetail;

            // Level filter
            if (itemLevel < this.minLevel || itemLevel >= this.maxLevel) {
                return false;
            }

            // Slot filter
            if (this.equipmentSlot !== 'all') {
                const itemType = equipmentDetail.type || '';
                if (!itemType.includes(this.equipmentSlot)) {
                    return false;
                }
            }

            // Class (skill requirement) filter
            if (this.skillRequirement !== 'all') {
                const levelRequirements = equipmentDetail.levelRequirements || [];

                if (this.skillRequirement === 'others') {
                    // "Others" means non-combat skills
                    const combatSkills = ['attack', 'melee', 'defense', 'ranged', 'magic'];
                    const hasCombatReq = levelRequirements.some((req) =>
                        combatSkills.some((skill) => req.skillHrid.includes(skill))
                    );
                    if (hasCombatReq) {
                        return false;
                    }
                } else {
                    // Specific skill requirement
                    const hasRequirement = levelRequirements.some((req) => req.skillHrid.includes(this.skillRequirement));
                    if (!hasRequirement) {
                        return false;
                    }
                }
            }

            return true;
        }

        /**
         * Cleanup on disable
         */
        disable() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            // Remove filter UI
            if (this.filterContainer) {
                this.filterContainer.remove();
                this.filterContainer = null;
            }

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const marketFilter = new MarketFilter();

    /**
     * Auto-Fill Market Price
     * Automatically fills marketplace order forms with optimal competitive pricing
     */


    class AutoFillPrice {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedModals = new WeakSet(); // Track processed modals to prevent duplicates
            this.isInitialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize auto-fill price feature
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('fillMarketOrderPrice')) {
                return;
            }

            this.isInitialized = true;

            // Register DOM observer for marketplace order modals
            this.registerDOMObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers for order modals
         */
        registerDOMObservers() {
            // Watch for order modals appearing
            const unregister = domObserver.onClass('auto-fill-price', 'Modal_modalContainer', (modal) => {
                // Check if this is a marketplace order modal (not instant buy/sell)
                const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
                if (!header) return;

                const headerText = header.textContent.trim();

                // Skip instant buy/sell modals (contain "Now" in title)
                if (headerText.includes(' Now')) {
                    return;
                }

                // Handle the order modal
                this.handleOrderModal(modal);
            });

            this.unregisterHandlers.push(unregister);
        }

        /**
         * Handle new order modal
         * @param {HTMLElement} modal - Modal container element
         */
        handleOrderModal(modal) {
            // Prevent duplicate processing (dom-observer can fire multiple times for same modal)
            if (this.processedModals.has(modal)) {
                return;
            }
            this.processedModals.add(modal);

            // Find the "Best Price" button/label
            const bestPriceLabel = modal.querySelector('span[class*="MarketplacePanel_bestPrice"]');
            if (!bestPriceLabel) {
                return;
            }

            // Determine if this is a buy or sell order
            const labelParent = bestPriceLabel.parentElement;
            const labelText = labelParent.textContent.toLowerCase();

            const isBuyOrder = labelText.includes('best buy');
            const isSellOrder = labelText.includes('best sell');

            if (!isBuyOrder && !isSellOrder) {
                return;
            }

            // Click the best price label to populate the suggested price
            bestPriceLabel.click();

            // Adjust price after clicking to be optimally competitive
            // For buy orders: increment by 1 to outbid
            // For sell orders: depends on user setting (match or undercut)
            const adjustTimeout = setTimeout(() => {
                this.adjustPrice(modal, isBuyOrder, isSellOrder);
            }, 50);
            this.timerRegistry.registerTimeout(adjustTimeout);
        }

        /**
         * Adjust the price to be optimally competitive
         * @param {HTMLElement} modal - Modal container element
         * @param {boolean} isBuyOrder - True if buy order
         * @param {boolean} isSellOrder - True if sell order
         */
        adjustPrice(modal, isBuyOrder, isSellOrder) {
            // Find the price input container
            const inputContainer = modal.querySelector(
                'div[class*="MarketplacePanel_inputContainer"] div[class*="MarketplacePanel_priceInputs"]'
            );
            if (!inputContainer) {
                return;
            }

            // Find the increment/decrement buttons
            const buttonContainers = inputContainer.querySelectorAll('div[class*="MarketplacePanel_buttonContainer"]');

            if (buttonContainers.length < 3) {
                return;
            }

            if (isBuyOrder) {
                // For buy orders: click the 3rd button container's button (increment)
                const targetContainer = buttonContainers[2];
                const button = targetContainer.querySelector('div button');
                if (button) {
                    button.click();
                }
            } else if (isSellOrder) {
                // For sell orders: check user setting
                const sellStrategy = config.getSettingValue('market_autoFillSellStrategy', 'match');

                if (sellStrategy === 'undercut') {
                    // Click the 2nd button container's button (decrement)
                    const targetContainer = buttonContainers[1];
                    const button = targetContainer.querySelector('div button');
                    if (button) {
                        button.click();
                    }
                }
                // If 'match', do nothing (use best sell price as-is)
            }
        }

        /**
         * Cleanup on disable
         */
        disable() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.timerRegistry.clearAll();
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const autoFillPrice = new AutoFillPrice();

    /**
     * Auto-Click Max Button
     * Automatically clicks the "Max" button in market listing dialogs
     */


    class AutoClickMax {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedModals = new WeakSet();
            this.isInitialized = false;
        }

        /**
         * Initialize the auto-click max feature
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.isFeatureEnabled('market_autoClickMax')) {
                return;
            }

            this.isActive = true;
            this.registerDOMObservers();
            this.isInitialized = true;
        }

        /**
         * Register DOM observers to watch for market listing modals
         */
        registerDOMObservers() {
            const unregister = domObserver.onClass('auto-click-max', 'Modal_modalContainer', (modal) => {
                this.handleOrderModal(modal);
            });
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Handle market order modal appearance
         * @param {HTMLElement} modal - Modal container element
         */
        handleOrderModal(modal) {
            if (!this.isActive || !modal || this.processedModals.has(modal)) {
                return;
            }

            // Check if this is a Buy/Sell listing modal (not Instant Buy/Sell)
            const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
            if (!header) {
                return;
            }

            const headerText = header.textContent;

            // Skip Instant Buy/Sell modals (they don't have Max button for quantity)
            if (headerText.includes('Now')) {
                return;
            }

            // Only process Buy Listing or Sell Listing modals
            if (!headerText.includes('Listing')) {
                return;
            }

            // Determine if this is a sell order by checking header text
            // Only auto-click Max for sell orders (not buy orders)
            const isSellOrder = headerText.includes('Sell Listing');

            if (!isSellOrder) {
                return; // Skip buy orders
            }

            // Mark as processed
            this.processedModals.add(modal);

            // Click the Max button
            this.findAndClickMaxButton(modal);
        }

        /**
         * Find and click the Max button in the modal
         * @param {HTMLElement} modal - Modal container element
         */
        findAndClickMaxButton(modal) {
            if (!modal) {
                return;
            }

            // Strategy 1: Find Max button by text content
            const allButtons = modal.querySelectorAll('button');
            const maxButton = Array.from(allButtons).find((btn) => {
                const text = btn.textContent.trim();
                return text === 'Max';
            });

            if (!maxButton) {
                return;
            }

            // Don't click if button is disabled
            if (maxButton.disabled) {
                return;
            }

            // Click the Max button
            try {
                maxButton.click();
            } catch (error) {
                console.error('[AutoClickMax] Failed to click Max button:', error);
            }
        }

        /**
         * Disable and cleanup
         */
        disable() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.processedModals = new WeakSet();
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const autoClickMax = new AutoClickMax();

    /**
     * Market Item Count Display Module
     *
     * Shows inventory count on market item tiles
     * Ported from Ranged Way Idle's visibleItemCountMarket feature
     */


    class ItemCountDisplay {
        constructor() {
            this.unregisterObserver = null;
            this.isInitialized = false;
        }

        /**
         * Initialize the item count display
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_visibleItemCount')) {
                return;
            }

            this.isInitialized = true;
            this.setupObserver();
        }

        /**
         * Setup DOM observer to watch for market panels
         */
        setupObserver() {
            // Watch for market items container
            this.unregisterObserver = domObserver.onClass(
                'ItemCountDisplay',
                'MarketplacePanel_marketItems',
                (marketContainer) => {
                    this.updateItemCounts(marketContainer);
                }
            );

            // Check for existing market container
            const existingContainer = document.querySelector('[class*="MarketplacePanel_marketItems"]');
            if (existingContainer) {
                this.updateItemCounts(existingContainer);
            }
        }

        /**
         * Update item counts for all items in market container
         * @param {HTMLElement} marketContainer - The market items container
         */
        updateItemCounts(marketContainer) {
            // Build item count map from inventory
            const itemCountMap = this.buildItemCountMap();

            // Find all clickable item tiles
            const itemTiles = marketContainer.querySelectorAll('[class*="Item_clickable"]');

            for (const itemTile of itemTiles) {
                this.updateSingleItem(itemTile, itemCountMap);
            }
        }

        /**
         * Build a map of itemHrid → count from inventory
         * @returns {Object} Map of item HRIDs to counts
         */
        buildItemCountMap() {
            const itemCountMap = {};
            const inventory = dataManager.getInventory();
            const includeEquipped = config.getSetting('market_visibleItemCountIncludeEquipped');

            if (!inventory) {
                return itemCountMap;
            }

            // Count inventory items (sum across all enhancement levels)
            for (const item of inventory) {
                if (!item.itemHrid) continue;
                itemCountMap[item.itemHrid] = (itemCountMap[item.itemHrid] || 0) + (item.count || 0);
            }

            // Optionally include equipped items
            if (includeEquipped) {
                const equipment = dataManager.getEquipment();
                if (equipment) {
                    for (const slot of Object.values(equipment)) {
                        if (slot && slot.itemHrid) {
                            itemCountMap[slot.itemHrid] = (itemCountMap[slot.itemHrid] || 0) + 1;
                        }
                    }
                }
            }

            return itemCountMap;
        }

        /**
         * Update a single item tile with count
         * @param {HTMLElement} itemTile - The item tile element
         * @param {Object} itemCountMap - Map of item HRIDs to counts
         */
        updateSingleItem(itemTile, itemCountMap) {
            // Extract item HRID from SVG use element
            const useElement = itemTile.querySelector('use');
            if (!useElement || !useElement.href || !useElement.href.baseVal) {
                return;
            }

            // Extract item ID from href (e.g., "#iron_bar" -> "iron_bar")
            const itemId = useElement.href.baseVal.split('#')[1];
            if (!itemId) {
                return;
            }

            const itemHrid = `/items/${itemId}`;
            const itemCount = itemCountMap[itemHrid] || 0;

            // Find or create count display element
            let countDiv = itemTile.querySelector('.mwi-item-count');
            if (!countDiv) {
                countDiv = document.createElement('div');
                countDiv.className = 'mwi-item-count';
                itemTile.appendChild(countDiv);

                // Set positioning (only on first creation)
                itemTile.style.position = 'relative';
                countDiv.style.position = 'absolute';
                countDiv.style.bottom = '-1px';
                countDiv.style.right = '2px';
                countDiv.style.textAlign = 'right';
                countDiv.style.fontSize = '0.85em';
                countDiv.style.fontWeight = 'bold';
                countDiv.style.pointerEvents = 'none';
            }

            // Get opacity setting (use getSettingValue for non-boolean settings)
            const opacity = config.getSettingValue('market_visibleItemCountOpacity', 0.25);

            // Update display based on count
            if (itemCount === 0) {
                // No items: dim the tile, hide the count text
                itemTile.style.opacity = opacity.toString();
                countDiv.textContent = '';
            } else {
                // Has items: full opacity, show count
                itemTile.style.opacity = '1.0';
                countDiv.textContent = itemCount.toString();
            }
        }

        /**
         * Disable the item count display
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all injected count displays and reset opacity
            document.querySelectorAll('.mwi-item-count').forEach((el) => el.remove());
            document.querySelectorAll('[class*="Item_clickable"]').forEach((tile) => {
                tile.style.opacity = '1.0';
            });

            this.isInitialized = false;
        }
    }

    const itemCountDisplay = new ItemCountDisplay();

    /**
     * Estimated Listing Age Module
     *
     * Estimates creation times for all market listings using listing ID interpolation
     * - Collects known listing IDs with timestamps (from your own listings)
     * - Uses linear interpolation/regression to estimate ages for unknown listings
     * - Displays estimated ages on the main Market Listings (order book) tab
     */


    class EstimatedListingAge {
        constructor() {
            this.knownListings = []; // Array of {id, timestamp, createdTimestamp, enhancementLevel, ...} sorted by id
            this.orderBooksCache = {}; // Cache of order book data from WebSocket
            this.currentItemHrid = null; // Track current item from WebSocket
            this.unregisterWebSocket = null;
            this.unregisterObserver = null;
            this.storageKey = 'marketListingTimestamps';
            this.orderBooksCacheKey = 'marketOrderBooksCache';
            this.isInitialized = false;
        }

        /**
         * Format timestamp based on user settings
         * @param {number} timestamp - Timestamp in milliseconds
         * @returns {string} Formatted time string
         */
        formatTimestamp(timestamp) {
            const ageFormat = config.getSettingValue('market_listingAgeFormat', 'datetime');

            if (ageFormat === 'elapsed') {
                // Show elapsed time (e.g., "3h 45m")
                const ageMs = Date.now() - timestamp;
                return formatters_js.formatRelativeTime(ageMs);
            } else {
                // Show date/time (e.g., "01-13 14:30:45" or "01-13 2:30:45 PM")
                const timeFormat = config.getSettingValue('market_listingTimeFormat', '24hour');
                const dateFormat = config.getSettingValue('market_listingDateFormat', 'MM-DD');
                const use12Hour = timeFormat === '12hour';

                const date = new Date(timestamp);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const datePart = dateFormat === 'DD-MM' ? `${day}-${month}` : `${month}-${day}`;

                const timePart = date
                    .toLocaleString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: use12Hour,
                    })
                    .trim();

                return `${datePart} ${timePart}`;
            }
        }

        /**
         * Initialize the estimated listing age feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_showEstimatedListingAge')) {
                return;
            }

            this.isInitialized = true;

            // Load historical data from storage
            await this.loadHistoricalData();

            // Load cached order books from storage
            await this.loadOrderBooksCache();

            // Load initial listings from dataManager
            this.loadInitialListings();

            // Setup WebSocket listeners to collect your listing IDs
            this.setupWebSocketListeners();

            // Setup DOM observer for order book table
            this.setupObserver();
        }

        /**
         * Load initial listings from dataManager (already received via init_character_data)
         */
        loadInitialListings() {
            const listings = dataManager.getMarketListings();

            for (const listing of listings) {
                if (listing.id && listing.createdTimestamp) {
                    this.recordListing(listing);
                }
            }
        }

        /**
         * Load historical listing data from IndexedDB
         */
        async loadHistoricalData() {
            try {
                const stored = await storage.getJSON(this.storageKey, 'marketListings', []);

                // Load all historical data (no time-based filtering)
                this.knownListings = stored.sort((a, b) => a.id - b.id);

                // Add hardcoded seed listings for baseline estimation accuracy
                // These are anchor points from RWI script author's data
                const seedListings = [
                    { id: 106442952, timestamp: 1763409373481 },
                    { id: 106791533, timestamp: 1763541486867 },
                    { id: 107530218, timestamp: 1763842767083 },
                    { id: 107640371, timestamp: 1763890560819 },
                    { id: 107678558, timestamp: 1763904036320 },
                ];

                // Add seeds only if they don't already exist in stored data
                for (const seed of seedListings) {
                    if (!this.knownListings.find((l) => l.id === seed.id)) {
                        this.knownListings.push(seed);
                    }
                }

                // Re-sort after adding seeds
                this.knownListings.sort((a, b) => a.id - b.id);
            } catch (error) {
                console.error('[EstimatedListingAge] Failed to load historical data:', error);
                this.knownListings = [];
            }
        }

        /**
         * Load cached order books from IndexedDB
         */
        async loadOrderBooksCache() {
            try {
                const stored = await storage.getJSON(this.orderBooksCacheKey, 'marketListings', {});
                this.orderBooksCache = stored || {};
            } catch (error) {
                console.error('[EstimatedListingAge] Failed to load order books cache:', error);
                this.orderBooksCache = {};
            }
        }

        /**
         * Save listing data to IndexedDB
         */
        async saveHistoricalData() {
            try {
                await storage.setJSON(this.storageKey, this.knownListings, 'marketListings', true);
            } catch (error) {
                console.error('[EstimatedListingAge] Failed to save historical data:', error);
            }
        }

        /**
         * Save order books cache to IndexedDB
         */
        async saveOrderBooksCache() {
            try {
                await storage.setJSON(this.orderBooksCacheKey, this.orderBooksCache, 'marketListings', true);
            } catch (error) {
                console.error('[EstimatedListingAge] Failed to save order books cache:', error);
            }
        }

        /**
         * Setup WebSocket listeners to collect your listing IDs and order book data
         */
        setupWebSocketListeners() {
            // Handle initial character data
            const initHandler = (data) => {
                if (data.myMarketListings) {
                    for (const listing of data.myMarketListings) {
                        this.recordListing(listing);
                    }
                }
            };

            // Handle listing updates
            const updateHandler = (data) => {
                if (data.endMarketListings) {
                    for (const listing of data.endMarketListings) {
                        this.recordListing(listing);
                    }
                }
            };

            // Handle order book updates (contains listing IDs for ALL listings)
            const orderBookHandler = (data) => {
                if (data.marketItemOrderBooks) {
                    const itemHrid = data.marketItemOrderBooks.itemHrid;

                    // Store with timestamp for staleness tracking
                    this.orderBooksCache[itemHrid] = {
                        data: data.marketItemOrderBooks,
                        lastUpdated: Date.now(),
                    };

                    this.currentItemHrid = itemHrid; // Track current item

                    // Save to storage (debounced)
                    this.saveOrderBooksCache();

                    // Clear processed flags to re-render with new data
                    const containers = document.querySelectorAll('.mwi-estimated-age-set');
                    containers.forEach((container) => {
                        container.classList.remove('mwi-estimated-age-set');
                    });

                    // Also clear listing price display flags so Top Order Age updates
                    document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
                        table.classList.remove('mwi-listing-prices-set');
                    });

                    // Manually re-process any existing containers (handles race condition where
                    // container appeared before WebSocket data arrived)
                    const existingContainers = document.querySelectorAll('[class*="MarketplacePanel_orderBooksContainer"]');
                    existingContainers.forEach((container) => {
                        this.processOrderBook(container);
                    });
                }
            };

            dataManager.on('character_initialized', initHandler);
            dataManager.on('market_listings_updated', updateHandler);
            dataManager.on('market_item_order_books_updated', orderBookHandler);

            // Store for cleanup
            this.unregisterWebSocket = () => {
                dataManager.off('character_initialized', initHandler);
                dataManager.off('market_listings_updated', updateHandler);
                dataManager.off('market_item_order_books_updated', orderBookHandler);
            };
        }

        /**
         * Record a listing with its full data
         * @param {Object} listing - Full listing object from WebSocket
         */
        recordListing(listing) {
            if (!listing.createdTimestamp) {
                return;
            }

            const timestamp = new Date(listing.createdTimestamp).getTime();

            // Check if we already have this listing
            const existingIndex = this.knownListings.findIndex((entry) => entry.id === listing.id);

            // Add new entry with full data
            const entry = {
                id: listing.id,
                timestamp: timestamp,
                createdTimestamp: listing.createdTimestamp, // ISO string for display
                itemHrid: listing.itemHrid,
                enhancementLevel: listing.enhancementLevel || 0, // For accurate row matching
                price: listing.price,
                orderQuantity: listing.orderQuantity,
                filledQuantity: listing.filledQuantity,
                isSell: listing.isSell,
            };

            if (existingIndex !== -1) {
                // Update existing entry (in case it had incomplete data)
                this.knownListings[existingIndex] = entry;
            } else {
                // Add new entry
                this.knownListings.push(entry);
            }

            // Re-sort by ID
            this.knownListings.sort((a, b) => a.id - b.id);

            // Save to storage (debounced)
            this.saveHistoricalData();
        }

        /**
         * Setup DOM observer to watch for order book table
         */
        setupObserver() {
            // Observe the main order book container
            this.unregisterObserver = domObserver.onClass(
                'EstimatedListingAge',
                'MarketplacePanel_orderBooksContainer',
                (container) => {
                    this.processOrderBook(container);
                }
            );
        }

        /**
         * Process the order book container and inject age estimates
         * @param {HTMLElement} container - Order book container
         */
        processOrderBook(container) {
            if (container.classList.contains('mwi-estimated-age-set')) {
                return;
            }

            // Find the buy and sell tables
            const tables = container.querySelectorAll('table');

            if (tables.length < 2) {
                return; // Need both buy and sell tables
            }

            // Mark as processed
            container.classList.add('mwi-estimated-age-set');

            // Process both tables
            tables.forEach((table) => {
                this.addAgeColumn(table);
            });
        }

        /**
         * Add estimated age column to order book table
         * @param {HTMLElement} table - Order book table
         */
        addAgeColumn(table) {
            const thead = table.querySelector('thead tr');
            const tbody = table.querySelector('tbody');

            if (!thead || !tbody) {
                return;
            }

            // Remove existing age column elements if they exist (RWI pattern)
            thead.querySelectorAll('.mwi-estimated-age-header').forEach((el) => el.remove());
            tbody.querySelectorAll('.mwi-estimated-age-cell').forEach((el) => el.remove());

            // Get current item and order book data
            const currentItemHrid = this.getCurrentItemHrid();

            if (!currentItemHrid || !this.orderBooksCache[currentItemHrid]) {
                return;
            }

            const cacheEntry = this.orderBooksCache[currentItemHrid];
            // Support both old format (direct data) and new format ({data, lastUpdated})
            const orderBookData = cacheEntry.data || cacheEntry;

            // Get current enhancement level being viewed
            const enhancementLevel = this.getCurrentEnhancementLevel();

            // Determine if this is buy or sell table (asks = sell, bids = buy)
            const isSellTable =
                table.closest('[class*="orderBookTableContainer"]') ===
                table.closest('[class*="orderBooksContainer"]')?.children[0];

            // Access orderBooks by enhancement level (orderBooks is an object, not array)
            // For non-equipment items, only level 0 exists
            // For equipment, there can be orderBooks[0], orderBooks[1], etc.
            const orderBookAtLevel = orderBookData.orderBooks?.[enhancementLevel];

            if (!orderBookAtLevel) {
                // No order book data for this enhancement level
                return;
            }

            const listings = isSellTable ? orderBookAtLevel.asks || [] : orderBookAtLevel.bids || [];

            // Add header
            const header = document.createElement('th');
            header.classList.add('mwi-estimated-age-header');
            header.textContent = '~Age';
            header.title = 'Estimated listing age (based on listing ID)';
            thead.appendChild(header);

            // Track which of user's listings have been matched to prevent duplicates
            const usedListingIds = new Set();

            // Add age cells to each row
            const rows = tbody.querySelectorAll('tr');
            let index = 0;

            rows.forEach((row) => {
                const cell = document.createElement('td');
                cell.classList.add('mwi-estimated-age-cell');

                if (index < listings.length) {
                    // Top 20 listings from order book (use positional indexing like RWI)
                    const listing = listings[index];
                    const listingId = listing.listingId;

                    // Check if this is YOUR listing (and not already matched)
                    const yourListing = this.knownListings.find(
                        (known) => known.id === listingId && !usedListingIds.has(known.id)
                    );

                    if (yourListing) {
                        // Mark this listing as used
                        usedListingIds.add(yourListing.id);

                        // Exact timestamp for your listing
                        const formatted = this.formatTimestamp(yourListing.timestamp);
                        cell.textContent = formatted; // No tilde for exact timestamps
                        cell.style.color = '#00FF00'; // Green for YOUR listing
                        cell.style.fontSize = '0.9em';
                    } else {
                        // Estimated timestamp for other listings
                        const estimatedTimestamp = this.estimateTimestamp(listingId);
                        const formatted = this.formatTimestamp(estimatedTimestamp);
                        cell.textContent = `~${formatted}`;
                        cell.style.color = '#999999'; // Gray to indicate estimate
                        cell.style.fontSize = '0.9em';
                    }
                } else if (index === listings.length) {
                    // Ellipsis row
                    cell.textContent = '· · ·';
                    cell.style.color = '#666666';
                    cell.style.fontSize = '0.9em';
                } else {
                    // Beyond top 20 - YOUR listings only
                    const hasCancel = row.textContent.includes('Cancel');
                    if (hasCancel) {
                        // Extract price and quantity for matching
                        const priceText = row.querySelector('[class*="price"]')?.textContent || '';
                        const quantityText = row.children[0]?.textContent || '';
                        const price = this.parsePrice(priceText);
                        const quantity = this.parseQuantity(quantityText);

                        // Match from knownListings (filtering out already-used and top-20 listings)
                        const allOrderBookIds = new Set(listings.map((l) => l.listingId));
                        const matchedListing = this.knownListings.find((listing) => {
                            if (usedListingIds.has(listing.id)) return false;
                            if (allOrderBookIds.has(listing.id)) return false; // Skip top 20

                            const itemMatch = listing.itemHrid === currentItemHrid;
                            const priceMatch = Math.abs(listing.price - price) < 0.01;
                            const qtyMatch = listing.orderQuantity - listing.filledQuantity === quantity;
                            return itemMatch && priceMatch && qtyMatch;
                        });

                        if (matchedListing) {
                            usedListingIds.add(matchedListing.id);
                            const formatted = this.formatTimestamp(matchedListing.timestamp);
                            cell.textContent = formatted;
                            cell.style.color = '#00FF00'; // Green for YOUR listing
                            cell.style.fontSize = '0.9em';
                        } else {
                            cell.textContent = '~Unknown';
                            cell.style.color = '#666666';
                            cell.style.fontSize = '0.9em';
                        }
                    } else {
                        cell.textContent = '· · ·';
                        cell.style.color = '#666666';
                        cell.style.fontSize = '0.9em';
                    }
                }

                row.appendChild(cell);
                index++;
            });
        }

        /**
         * Get current item HRID being viewed in order book
         * @returns {string|null} Item HRID or null
         */
        getCurrentItemHrid() {
            // PRIMARY: Check for current item element (same as RWI approach)
            const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
            if (currentItemElement) {
                const useElement = currentItemElement.querySelector('use');
                if (useElement && useElement.href && useElement.href.baseVal) {
                    const itemHrid = '/items/' + useElement.href.baseVal.split('#')[1];
                    return itemHrid;
                }
            }

            // SECONDARY: Use WebSocket tracked item
            if (this.currentItemHrid) {
                return this.currentItemHrid;
            }

            // TERTIARY: Try to find from YOUR listings in the order book
            const orderBookContainer = document.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
            if (!orderBookContainer) {
                return null;
            }

            const tables = orderBookContainer.querySelectorAll('table');
            for (const table of tables) {
                const rows = table.querySelectorAll('tbody tr');
                for (const row of rows) {
                    const hasCancel = row.textContent.includes('Cancel');
                    if (hasCancel) {
                        const priceText = row.querySelector('[class*="price"]')?.textContent || '';
                        const quantityText = row.children[0]?.textContent || '';

                        const price = this.parsePrice(priceText);
                        const quantity = this.parseQuantity(quantityText);

                        // Find matching listing from YOUR listings
                        const matchedListing = this.knownListings.find((listing) => {
                            const priceMatch = Math.abs(listing.price - price) < 0.01;
                            const qtyMatch = listing.orderQuantity - listing.filledQuantity === quantity;
                            return priceMatch && qtyMatch;
                        });

                        if (matchedListing) {
                            return matchedListing.itemHrid;
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Get current enhancement level being viewed in order book
         * @returns {number} Enhancement level (0 for non-equipment)
         */
        getCurrentEnhancementLevel() {
            // Check for enhancement level indicator in the current item display
            const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
            if (currentItemElement) {
                const enhancementElement = currentItemElement.querySelector('[class*="Item_enhancementLevel"]');
                if (enhancementElement) {
                    const match = enhancementElement.textContent.match(/\+(\d+)/);
                    if (match) {
                        return parseInt(match[1], 10);
                    }
                }
            }

            // Default to enhancement level 0 (non-equipment or base equipment)
            return 0;
        }

        /**
         * Parse price from text (handles K/M suffixes)
         * @param {string} text - Price text
         * @returns {number} Price value
         */
        parsePrice(text) {
            let multiplier = 1;
            if (text.toUpperCase().includes('K')) {
                multiplier = 1000;
                text = text.replace(/K/gi, '');
            } else if (text.toUpperCase().includes('M')) {
                multiplier = 1000000;
                text = text.replace(/M/gi, '');
            }
            const numStr = text.replace(/[^0-9.]/g, '');
            return numStr ? Number(numStr) * multiplier : 0;
        }

        /**
         * Parse quantity from text (handles K/M suffixes)
         * @param {string} text - Quantity text
         * @returns {number} Quantity value
         */
        parseQuantity(text) {
            let multiplier = 1;
            if (text.toUpperCase().includes('K')) {
                multiplier = 1000;
                text = text.replace(/K/gi, '');
            } else if (text.toUpperCase().includes('M')) {
                multiplier = 1000000;
                text = text.replace(/M/gi, '');
            }
            const numStr = text.replace(/[^0-9.]/g, '');
            return numStr ? Number(numStr) * multiplier : 0;
        }

        /**
         * Get color based on data staleness
         * @param {number} lastUpdated - Timestamp when data was last updated
         * @returns {string} Color code for display
         */
        getStalenessColor(lastUpdated) {
            if (!lastUpdated) {
                return '#999999'; // Gray for unknown age
            }

            const age = Date.now() - lastUpdated;
            const minutes = age / (60 * 1000);
            const hours = age / (60 * 60 * 1000);

            if (minutes < 15) return '#00AA00'; // < 15 min: dark green (fresh)
            if (hours < 1) return '#00FF00'; // < 1 hour: light green (recent)
            if (hours < 4) return '#FFAA00'; // < 4 hours: yellow (moderate)
            if (hours < 12) return '#FF6600'; // < 12 hours: orange (stale)
            return '#FF0000'; // 12+ hours: red (very stale)
        }

        /**
         * Get tooltip text for staleness
         * @param {number} lastUpdated - Timestamp when data was last updated
         * @returns {string} Tooltip text
         */
        getStalenessTooltip(lastUpdated) {
            if (!lastUpdated) {
                return 'Order book data - Visit market page to refresh';
            }

            const age = Date.now() - lastUpdated;
            const relativeTime = formatters_js.formatRelativeTime(age);
            return `Order book data from ${relativeTime} ago - Visit market page to refresh`;
        }

        /**
         * Estimate timestamp for a listing ID
         * @param {number} listingId - Listing ID to estimate
         * @returns {number} Estimated timestamp in milliseconds
         */
        estimateTimestamp(listingId) {
            if (this.knownListings.length === 0) {
                // No data, assume recent (1 hour ago)
                return Date.now() - 60 * 60 * 1000;
            }

            if (this.knownListings.length === 1) {
                // Only one data point, use it
                return this.knownListings[0].timestamp;
            }

            const minId = this.knownListings[0].id;
            const maxId = this.knownListings[this.knownListings.length - 1].id;

            let estimate;
            // Check if ID is within known range
            if (listingId >= minId && listingId <= maxId) {
                estimate = this.linearInterpolation(listingId);
            } else {
                estimate = this.linearRegression(listingId);
            }

            // CRITICAL: Clamp to reasonable bounds
            const now = Date.now();

            // Never allow future timestamps (listings cannot be created in the future)
            if (estimate > now) {
                estimate = now;
            }

            return estimate;
        }

        /**
         * Linear interpolation for IDs within known range
         * @param {number} listingId - Listing ID
         * @returns {number} Estimated timestamp
         */
        linearInterpolation(listingId) {
            // Check for exact match
            const exact = this.knownListings.find((entry) => entry.id === listingId);
            if (exact) {
                return exact.timestamp;
            }

            // Find surrounding points
            let leftIndex = 0;
            let rightIndex = this.knownListings.length - 1;

            for (let i = 0; i < this.knownListings.length - 1; i++) {
                if (listingId >= this.knownListings[i].id && listingId <= this.knownListings[i + 1].id) {
                    leftIndex = i;
                    rightIndex = i + 1;
                    break;
                }
            }

            const left = this.knownListings[leftIndex];
            const right = this.knownListings[rightIndex];

            // Linear interpolation formula
            const idRange = right.id - left.id;
            const idOffset = listingId - left.id;
            const ratio = idOffset / idRange;

            return left.timestamp + ratio * (right.timestamp - left.timestamp);
        }

        /**
         * Linear regression for IDs outside known range
         * @param {number} listingId - Listing ID
         * @returns {number} Estimated timestamp
         */
        linearRegression(listingId) {
            // Calculate linear regression slope
            let sumX = 0,
                sumY = 0;
            for (const entry of this.knownListings) {
                sumX += entry.id;
                sumY += entry.timestamp;
            }

            const n = this.knownListings.length;
            const meanX = sumX / n;
            const meanY = sumY / n;

            let numerator = 0;
            let denominator = 0;
            for (const entry of this.knownListings) {
                numerator += (entry.id - meanX) * (entry.timestamp - meanY);
                denominator += (entry.id - meanX) * (entry.id - meanX);
            }

            const slope = numerator / denominator;

            // Get boundary points
            const minId = this.knownListings[0].id;
            const maxId = this.knownListings[this.knownListings.length - 1].id;
            const minTimestamp = this.knownListings[0].timestamp;
            const maxTimestamp = this.knownListings[this.knownListings.length - 1].timestamp;

            // Extrapolate from closest boundary (RWI approach)
            // This prevents drift from large intercept values
            if (listingId > maxId) {
                return slope * (listingId - maxId) + maxTimestamp;
            } else {
                return slope * (listingId - minId) + minTimestamp;
            }
        }

        /**
         * Clear all injected displays
         */
        clearDisplays() {
            document.querySelectorAll('.mwi-estimated-age-set').forEach((container) => {
                container.classList.remove('mwi-estimated-age-set');
            });
            document.querySelectorAll('.mwi-estimated-age-header').forEach((el) => el.remove());
            document.querySelectorAll('.mwi-estimated-age-cell').forEach((el) => el.remove());
        }

        /**
         * Disable the estimated listing age feature
         */
        disable() {
            if (this.unregisterWebSocket) {
                this.unregisterWebSocket();
                this.unregisterWebSocket = null;
            }

            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.clearDisplays();
            this.isInitialized = false;
        }
    }

    const estimatedListingAge = new EstimatedListingAge();

    /**
     * Market Listing Price Display Module
     *
     * Shows pricing information on individual market listings
     * - Top Order Price: Current best market price with competitive color coding
     * - Total Price: Total remaining value of the listing
     * Ported from Ranged Way Idle's showListingInfo feature
     */


    class ListingPriceDisplay {
        constructor() {
            this.allListings = {}; // Maintained listing state
            this.unregisterWebSocket = null;
            this.unregisterObserver = null;
            this.isInitialized = false;
            this.cleanupRegistry = cleanupRegistry_js.createCleanupRegistry();
            this.activeRefreshes = new WeakSet(); // Track tables being refreshed (debouncing)
            this.tbodyObservers = new WeakMap(); // Track MutationObservers per tbody
        }

        /**
         * Initialize the listing price display
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_showListingPrices')) {
                return;
            }

            this.isInitialized = true;

            // Load initial listings from dataManager
            this.loadInitialListings();

            this.setupWebSocketListeners();
            this.setupObserver();
        }

        /**
         * Load initial listings from dataManager (already received via init_character_data)
         */
        loadInitialListings() {
            const listings = dataManager.getMarketListings();

            for (const listing of listings) {
                this.handleListing(listing);
            }
        }

        /**
         * Setup WebSocket listeners for listing updates
         */
        setupWebSocketListeners() {
            // Handle initial character data
            const initHandler = (data) => {
                if (data.myMarketListings) {
                    for (const listing of data.myMarketListings) {
                        this.handleListing(listing);
                    }
                }
            };

            // Handle listing updates
            const updateHandler = (data) => {
                if (data.endMarketListings) {
                    for (const listing of data.endMarketListings) {
                        this.handleListing(listing);
                    }
                    // Clear existing displays to force refresh
                    this.clearDisplays();

                    // Wait for React to update DOM before re-processing
                    // (DOM observer won't fire because table element didn't appear/disappear)
                    const visibleTable = document.querySelector('[class*="MarketplacePanel_myListingsTable"]');
                    if (visibleTable) {
                        this.scheduleTableRefresh(visibleTable);
                    }
                }
            };

            dataManager.on('character_initialized', initHandler);
            dataManager.on('market_listings_updated', updateHandler);

            // Handle order book updates to re-render with populated cache (if Top Order Age enabled)
            let orderBookHandler = null;
            if (config.getSetting('market_showTopOrderAge')) {
                orderBookHandler = (data) => {
                    if (data.marketItemOrderBooks) {
                        // Delay re-render to let estimatedListingAge populate cache first (race condition)
                        setTimeout(() => {
                            document.querySelectorAll('[class*="MarketplacePanel_myListingsTable"]').forEach((table) => {
                                table.classList.remove('mwi-listing-prices-set');
                                this.updateTable(table);
                            });
                        }, 10);
                    }
                };
                dataManager.on('market_item_order_books_updated', orderBookHandler);
            }

            // Store for cleanup
            this.unregisterWebSocket = () => {
                dataManager.off('character_initialized', initHandler);
                dataManager.off('market_listings_updated', updateHandler);
                if (orderBookHandler) {
                    dataManager.off('market_item_order_books_updated', orderBookHandler);
                }
            };

            this.cleanupRegistry.registerCleanup(() => {
                if (this.unregisterWebSocket) {
                    this.unregisterWebSocket();
                    this.unregisterWebSocket = null;
                }
            });
        }

        /**
         * Setup DOM observer to watch for My Listings table
         */
        setupObserver() {
            this.unregisterObserver = domObserver.onClass(
                'ListingPriceDisplay',
                'MarketplacePanel_myListingsTable',
                (tableNode) => {
                    this.scheduleTableRefresh(tableNode);
                }
            );

            this.cleanupRegistry.registerCleanup(() => {
                if (this.unregisterObserver) {
                    this.unregisterObserver();
                    this.unregisterObserver = null;
                }
            });

            // Check for existing table
            const existingTable = document.querySelector('[class*="MarketplacePanel_myListingsTable"]');
            if (existingTable) {
                this.scheduleTableRefresh(existingTable);
            }
        }

        /**
         * Schedule a refresh to wait for React to populate table rows
         * Uses MutationObserver to detect when rows are added instead of polling
         * @param {HTMLElement} tableNode - The listings table element
         */
        scheduleTableRefresh(tableNode) {
            // Debouncing: prevent multiple concurrent refreshes on same table
            if (this.activeRefreshes.has(tableNode)) {
                return;
            }

            const tbody = tableNode.querySelector('tbody');
            if (!tbody) {
                return;
            }

            this.activeRefreshes.add(tableNode);

            // Check if we should process immediately (rows already match)
            const rowCount = tbody.querySelectorAll('tr').length;
            const listingCount = Object.keys(this.allListings).length;

            if (rowCount === listingCount && rowCount > 0) {
                this.updateTable(tableNode);
                this.activeRefreshes.delete(tableNode);
                return;
            }

            // Otherwise, watch for row additions using MutationObserver
            let observer = this.tbodyObservers.get(tbody);

            if (!observer) {
                observer = new MutationObserver(() => {
                    const currentRowCount = tbody.querySelectorAll('tr').length;
                    const currentListingCount = Object.keys(this.allListings).length;

                    if (currentRowCount === currentListingCount && currentRowCount > 0) {
                        // Rows match - process the table
                        this.updateTable(tableNode);
                        this.activeRefreshes.delete(tableNode);

                        // Disconnect observer until next refresh
                        observer.disconnect();
                    }
                });

                this.tbodyObservers.set(tbody, observer);

                this.cleanupRegistry.registerCleanup(() => {
                    observer.disconnect();
                    this.tbodyObservers.delete(tbody);
                });
            }

            // Start observing for row additions
            observer.observe(tbody, {
                childList: true,
                subtree: false,
            });

            // Safety timeout: if rows never match after 3 seconds, give up and process anyway
            const safetyTimeoutId = setTimeout(() => {
                observer.disconnect();
                this.activeRefreshes.delete(tableNode);

                // Process with whatever rows are available
                if (tbody.querySelectorAll('tr').length > 0) {
                    this.updateTable(tableNode);
                }
            }, 3000);

            this.cleanupRegistry.registerTimeout(safetyTimeoutId);
        }

        /**
         * Handle listing data from WebSocket
         * @param {Object} listing - Listing data
         */
        handleListing(listing) {
            // Filter out cancelled and fully claimed listings
            if (
                listing.status === '/market_listing_status/cancelled' ||
                (listing.status === '/market_listing_status/filled' &&
                    listing.unclaimedItemCount === 0 &&
                    listing.unclaimedCoinCount === 0)
            ) {
                delete this.allListings[listing.id];
                return;
            }

            // Store/update listing data
            this.allListings[listing.id] = {
                id: listing.id,
                isSell: listing.isSell,
                itemHrid: listing.itemHrid,
                enhancementLevel: listing.enhancementLevel,
                orderQuantity: listing.orderQuantity,
                filledQuantity: listing.filledQuantity,
                price: listing.price,
                createdTimestamp: listing.createdTimestamp,
                unclaimedCoinCount: listing.unclaimedCoinCount || 0,
                unclaimedItemCount: listing.unclaimedItemCount || 0,
            };
        }

        /**
         * Update the My Listings table with pricing columns
         * @param {HTMLElement} tableNode - The listings table element
         */
        updateTable(tableNode) {
            if (tableNode.classList.contains('mwi-listing-prices-set')) {
                return;
            }

            // Clear any existing price displays from this table before re-rendering
            tableNode.querySelectorAll('.mwi-listing-price-header').forEach((el) => el.remove());
            tableNode.querySelectorAll('.mwi-listing-price-cell').forEach((el) => el.remove());

            // Wait until row count matches listing count
            const tbody = tableNode.querySelector('tbody');
            if (!tbody) {
                return;
            }

            const rowCount = tbody.querySelectorAll('tr').length;
            const listingCount = Object.keys(this.allListings).length;

            if (rowCount !== listingCount) {
                return; // Table not fully populated yet
            }

            // OPTIMIZATION: Pre-fetch all market prices in one batch
            const itemsToPrice = Object.values(this.allListings).map((listing) => ({
                itemHrid: listing.itemHrid,
                enhancementLevel: listing.enhancementLevel,
            }));
            const priceCache = marketAPI.getPricesBatch(itemsToPrice);

            // Add table headers
            this.addTableHeaders(tableNode);

            // Add data to rows
            this.addDataToRows(tbody);

            // Add price displays to each row
            this.addPriceDisplays(tbody, priceCache);

            // Check if we should mark as fully processed
            let fullyProcessed = true;

            if (config.getSetting('market_showTopOrderAge')) {
                // Only mark as processed if cache has data for all listings
                for (const listing of Object.values(this.allListings)) {
                    const orderBookData = estimatedListingAge.orderBooksCache[listing.itemHrid];
                    if (!orderBookData || !orderBookData.orderBooks || orderBookData.orderBooks.length === 0) {
                        fullyProcessed = false;
                        break;
                    }
                }
            }

            // Only mark as processed if fully complete
            if (fullyProcessed) {
                tableNode.classList.add('mwi-listing-prices-set');
            }
        }

        /**
         * Add column headers to table head
         * @param {HTMLElement} tableNode - The listings table
         */
        addTableHeaders(tableNode) {
            const thead = tableNode.querySelector('thead tr');
            if (!thead) return;

            // Skip if headers already added
            if (thead.querySelector('.mwi-listing-price-header')) {
                return;
            }

            // Create "Top Order Price" header
            const topOrderHeader = document.createElement('th');
            topOrderHeader.classList.add('mwi-listing-price-header');
            topOrderHeader.textContent = 'Top Order Price';

            // Create "Top Order Age" header (if setting enabled)
            let topOrderAgeHeader = null;
            if (config.getSetting('market_showTopOrderAge')) {
                topOrderAgeHeader = document.createElement('th');
                topOrderAgeHeader.classList.add('mwi-listing-price-header');
                topOrderAgeHeader.textContent = 'Top Order Age';
                topOrderAgeHeader.title = 'Estimated age of the top competing order';
            }

            // Create "Total Price" header
            const totalPriceHeader = document.createElement('th');
            totalPriceHeader.classList.add('mwi-listing-price-header');
            totalPriceHeader.textContent = 'Total Price';

            // Create "Listed" header (if setting enabled)
            let listedHeader = null;
            if (config.getSetting('market_showListingAge')) {
                listedHeader = document.createElement('th');
                listedHeader.classList.add('mwi-listing-price-header');
                listedHeader.textContent = 'Listed';
            }

            // Insert headers (order: Top Order Price, Top Order Age, Total Price, Listed)
            let insertIndex = 4;
            thead.insertBefore(topOrderHeader, thead.children[insertIndex++]);
            if (topOrderAgeHeader) {
                thead.insertBefore(topOrderAgeHeader, thead.children[insertIndex++]);
            }
            thead.insertBefore(totalPriceHeader, thead.children[insertIndex++]);
            if (listedHeader) {
                thead.insertBefore(listedHeader, thead.children[insertIndex++]);
            }
        }

        /**
         * Add listing data to row datasets for matching
         * @param {HTMLElement} tbody - Table body element
         */
        addDataToRows(tbody) {
            const listings = Object.values(this.allListings);
            const used = new Set();

            for (const row of tbody.querySelectorAll('tr')) {
                const rowInfo = this.extractRowInfo(row);

                // Find matching listing with improved criteria
                const matchedListing = listings.find((listing) => {
                    if (used.has(listing.id)) return false;

                    // Basic matching criteria
                    const itemMatch = listing.itemHrid === rowInfo.itemHrid;
                    const enhancementMatch = listing.enhancementLevel === rowInfo.enhancementLevel;
                    const typeMatch = listing.isSell === rowInfo.isSell;
                    const priceMatch = !rowInfo.price || Math.abs(listing.price - rowInfo.price) < 0.01;

                    if (!itemMatch || !enhancementMatch || !typeMatch || !priceMatch) {
                        return false;
                    }

                    // If quantity info is available from row, use it for precise matching
                    if (rowInfo.filledQuantity !== null && rowInfo.orderQuantity !== null) {
                        const quantityMatch =
                            listing.filledQuantity === rowInfo.filledQuantity &&
                            listing.orderQuantity === rowInfo.orderQuantity;
                        return quantityMatch;
                    }

                    // Fallback to basic match if no quantity info
                    return true;
                });

                if (matchedListing) {
                    used.add(matchedListing.id);
                    // Store listing data in row dataset
                    row.dataset.listingId = matchedListing.id;
                    row.dataset.itemHrid = matchedListing.itemHrid;
                    row.dataset.enhancementLevel = matchedListing.enhancementLevel;
                    row.dataset.isSell = matchedListing.isSell;
                    row.dataset.price = matchedListing.price;
                    row.dataset.orderQuantity = matchedListing.orderQuantity;
                    row.dataset.filledQuantity = matchedListing.filledQuantity;
                    row.dataset.createdTimestamp = matchedListing.createdTimestamp;
                    row.dataset.unclaimedCoinCount = matchedListing.unclaimedCoinCount;
                    row.dataset.unclaimedItemCount = matchedListing.unclaimedItemCount;
                }
            }
        }

        /**
         * Extract listing info from table row for matching
         * @param {HTMLElement} row - Table row element
         * @returns {Object} Extracted row info
         */
        extractRowInfo(row) {
            // Extract itemHrid from SVG use element
            let itemHrid = null;
            const useElements = row.querySelectorAll('use');
            for (const use of useElements) {
                const href = use.href && use.href.baseVal ? use.href.baseVal : '';
                if (href.includes('#')) {
                    const idPart = href.split('#')[1];
                    if (idPart && !idPart.toLowerCase().includes('coin')) {
                        itemHrid = `/items/${idPart}`;
                        break;
                    }
                }
            }

            // Extract enhancement level
            let enhancementLevel = 0;
            const enhNode = row.querySelector('[class*="enhancementLevel"]');
            if (enhNode && enhNode.textContent) {
                const match = enhNode.textContent.match(/\+\s*(\d+)/);
                if (match) {
                    enhancementLevel = Number(match[1]);
                }
            }

            // Detect isSell from type cell (2nd cell)
            let isSell = null;
            const typeCell = row.children[1];
            if (typeCell) {
                const text = (typeCell.textContent || '').toLowerCase();
                if (text.includes('sell')) {
                    isSell = true;
                } else if (text.includes('buy')) {
                    isSell = false;
                }
            }

            // Extract quantity (3rd cell) - format: "filled / total"
            let filledQuantity = null;
            let orderQuantity = null;
            const quantityCell = row.children[2];
            if (quantityCell) {
                const text = quantityCell.textContent.trim();
                const match = text.match(/(\d+)\s*\/\s*(\d+)/);
                if (match) {
                    filledQuantity = Number(match[1]);
                    orderQuantity = Number(match[2]);
                }
            }

            // Extract price (4th cell before our inserts)
            let price = NaN;
            const priceNode = row.querySelector('[class*="price"]') || row.children[3];
            if (priceNode) {
                let text =
                    priceNode.firstChild && priceNode.firstChild.textContent
                        ? priceNode.firstChild.textContent
                        : priceNode.textContent;
                text = String(text).trim();

                // Handle K/M suffixes (e.g., "340K" = 340000, "1.5M" = 1500000)
                let multiplier = 1;
                if (text.toUpperCase().includes('K')) {
                    multiplier = 1000;
                    text = text.replace(/K/gi, '');
                } else if (text.toUpperCase().includes('M')) {
                    multiplier = 1000000;
                    text = text.replace(/M/gi, '');
                }

                // Parse number handling both locale formats:
                // US: "3,172" or "3,172.50" (comma = thousands, dot = decimal)
                // EU: "3.172" or "3.172,50" (dot = thousands, comma = decimal)
                // Strategy: Find last dot/comma (decimal separator), remove all others (thousand separators)
                const lastDotIndex = text.lastIndexOf('.');
                const lastCommaIndex = text.lastIndexOf(',');
                const lastSeparatorIndex = Math.max(lastDotIndex, lastCommaIndex);

                let numStr;
                if (lastSeparatorIndex === -1) {
                    // No separators, just extract digits
                    numStr = text.replace(/[^0-9]/g, '');
                } else {
                    // Has separator - determine if it's decimal or thousand separator
                    const beforeSeparator = text.substring(0, lastSeparatorIndex);
                    const afterSeparator = text.substring(lastSeparatorIndex + 1);

                    // If there are 1-2 digits after separator, it's likely a decimal point
                    // If there are exactly 3 digits after separator, it could be either (ambiguous)
                    // If there are more than 3 digits, it's definitely a decimal point
                    const digitsAfter = afterSeparator.replace(/[^0-9]/g, '').length;

                    if (digitsAfter <= 2 && digitsAfter > 0) {
                        // Decimal separator (e.g., "3,172.50" or "3.172,50")
                        numStr = beforeSeparator.replace(/[^0-9]/g, '') + '.' + afterSeparator.replace(/[^0-9]/g, '');
                    } else {
                        // Thousand separator or no decimal (e.g., "3,172" or "3.172")
                        numStr = text.replace(/[^0-9]/g, '');
                    }
                }

                price = numStr ? Number(numStr) * multiplier : NaN;
            }

            return { itemHrid, enhancementLevel, isSell, price, filledQuantity, orderQuantity };
        }

        /**
         * Add price display cells to each row
         * @param {HTMLElement} tbody - Table body element
         * @param {Map} priceCache - Pre-fetched price cache
         */
        addPriceDisplays(tbody, priceCache) {
            for (const row of tbody.querySelectorAll('tr')) {
                // Skip if displays already added
                if (row.querySelector('.mwi-listing-price-cell')) {
                    continue;
                }

                const dataset = row.dataset;
                const hasMatchedListing = !!dataset.listingId;

                // Insert at index 4 (same as headers) to maintain alignment
                const insertIndex = 4;
                const insertBeforeCell = row.children[insertIndex] || null;

                if (hasMatchedListing) {
                    // Matched row - create cells with actual data
                    const itemHrid = dataset.itemHrid;
                    const enhancementLevel = Number(dataset.enhancementLevel);
                    const isSell = dataset.isSell === 'true';
                    const price = Number(dataset.price);
                    const orderQuantity = Number(dataset.orderQuantity);
                    const filledQuantity = Number(dataset.filledQuantity);
                    const unclaimedCoinCount = Number(dataset.unclaimedCoinCount) || 0;
                    const unclaimedItemCount = Number(dataset.unclaimedItemCount) || 0;

                    // Create Top Order Price cell
                    const topOrderCell = this.createTopOrderPriceCell(
                        itemHrid,
                        enhancementLevel,
                        isSell,
                        price,
                        priceCache
                    );
                    row.insertBefore(topOrderCell, insertBeforeCell);

                    // Create Top Order Age cell (if setting enabled)
                    if (config.getSetting('market_showTopOrderAge')) {
                        const topOrderAgeCell = this.createTopOrderAgeCell(itemHrid, enhancementLevel, isSell);
                        row.insertBefore(topOrderAgeCell, row.children[insertIndex + 1]);
                    }

                    // Create Total Price cell
                    const currentInsertIndex = insertIndex + (config.getSetting('market_showTopOrderAge') ? 2 : 1);
                    const totalPriceCell = this.createTotalPriceCell(
                        itemHrid,
                        isSell,
                        price,
                        orderQuantity,
                        filledQuantity,
                        unclaimedCoinCount,
                        unclaimedItemCount
                    );
                    row.insertBefore(totalPriceCell, row.children[currentInsertIndex]);

                    // Create Listed Age cell (if setting enabled)
                    if (config.getSetting('market_showListingAge') && dataset.createdTimestamp) {
                        const listedInsertIndex = currentInsertIndex + 1;
                        const listedAgeCell = this.createListedAgeCell(dataset.createdTimestamp);
                        row.insertBefore(listedAgeCell, row.children[listedInsertIndex]);
                    }
                } else {
                    // Unmatched row - create placeholder cells to prevent column misalignment
                    const topOrderCell = this.createPlaceholderCell();
                    row.insertBefore(topOrderCell, insertBeforeCell);

                    if (config.getSetting('market_showTopOrderAge')) {
                        const topOrderAgeCell = this.createPlaceholderCell();
                        row.insertBefore(topOrderAgeCell, row.children[insertIndex + 1]);
                    }

                    const currentInsertIndex = insertIndex + (config.getSetting('market_showTopOrderAge') ? 2 : 1);
                    const totalPriceCell = this.createPlaceholderCell();
                    row.insertBefore(totalPriceCell, row.children[currentInsertIndex]);

                    if (config.getSetting('market_showListingAge')) {
                        const listedInsertIndex = currentInsertIndex + 1;
                        const listedAgeCell = this.createPlaceholderCell();
                        row.insertBefore(listedAgeCell, row.children[listedInsertIndex]);
                    }
                }
            }
        }

        /**
         * Create Top Order Price cell
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {boolean} isSell - Is sell order
         * @param {number} price - Listing price
         * @param {Map} priceCache - Pre-fetched price cache (fallback)
         * @returns {HTMLElement} Table cell element
         */
        createTopOrderPriceCell(itemHrid, enhancementLevel, isSell, price, priceCache) {
            const cell = document.createElement('td');
            cell.classList.add('mwi-listing-price-cell');

            const span = document.createElement('span');
            span.classList.add('mwi-listing-price-value');

            // PRIMARY: Get price from order book cache (same source as Top Order Age)
            let topOrderPrice = null;
            let lastUpdated = null;

            const cacheEntry = estimatedListingAge.orderBooksCache[itemHrid];
            if (cacheEntry) {
                const orderBookData = cacheEntry.data || cacheEntry;
                lastUpdated = cacheEntry.lastUpdated;

                if (orderBookData && orderBookData.orderBooks) {
                    // Find matching order book for this enhancement level
                    let orderBook = orderBookData.orderBooks.find((ob) => ob.enhancementLevel === enhancementLevel);

                    // For non-enhanceable items (enh level 0), use first entry
                    if (!orderBook && enhancementLevel === 0 && orderBookData.orderBooks.length > 0) {
                        orderBook = orderBookData.orderBooks[0];
                    }

                    if (orderBook) {
                        const topOrders = isSell ? orderBook.asks : orderBook.bids;
                        if (topOrders && topOrders.length > 0) {
                            topOrderPrice = topOrders[0].price;
                        }
                    }
                }
            }

            // FALLBACK: Use market API if no order book data
            if (topOrderPrice === null) {
                const key = `${itemHrid}:${enhancementLevel}`;
                const marketPrice = priceCache.get(key);
                topOrderPrice = marketPrice ? (isSell ? marketPrice.ask : marketPrice.bid) : null;
            }

            if (topOrderPrice === null || topOrderPrice === -1) {
                span.textContent = formatters_js.coinFormatter(null);
                span.style.color = '#004FFF'; // Blue for no data
            } else {
                span.textContent = formatters_js.coinFormatter(topOrderPrice);

                // Color coding based on competitiveness
                if (isSell) {
                    // Sell order: green if our price is lower (better), red if higher (undercut)
                    span.style.color = topOrderPrice < price ? '#FF0000' : '#00FF00';
                } else {
                    // Buy order: green if our price is higher (better), red if lower (undercut)
                    span.style.color = topOrderPrice > price ? '#FF0000' : '#00FF00';
                }

                // Add staleness indicator via tooltip if using order book cache
                if (lastUpdated) {
                    span.title = estimatedListingAge.getStalenessTooltip(lastUpdated);
                }
            }

            cell.appendChild(span);
            return cell;
        }

        /**
         * Create Top Order Age cell
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {boolean} isSell - Is sell order
         * @returns {HTMLElement} Table cell element
         */
        createTopOrderAgeCell(itemHrid, enhancementLevel, isSell) {
            const cell = document.createElement('td');
            cell.classList.add('mwi-listing-price-cell');

            const span = document.createElement('span');
            span.classList.add('mwi-listing-price-value');

            // Get order book data from estimatedListingAge module (shared cache)
            const cacheEntry = estimatedListingAge.orderBooksCache[itemHrid];

            if (!cacheEntry) {
                // No order book data available
                span.textContent = 'N/A';
                span.style.color = '#666666';
                span.style.fontSize = '0.9em';
                cell.appendChild(span);
                return cell;
            }

            // Support both old format (direct data) and new format ({data, lastUpdated})
            const orderBookData = cacheEntry.data || cacheEntry;
            const lastUpdated = cacheEntry.lastUpdated;

            if (!orderBookData || !orderBookData.orderBooks || orderBookData.orderBooks.length === 0) {
                // No order book data available
                span.textContent = 'N/A';
                span.style.color = '#666666';
                span.style.fontSize = '0.9em';
                cell.appendChild(span);
                return cell;
            }

            // Find matching order book for this enhancement level
            let orderBook = orderBookData.orderBooks.find((ob) => ob.enhancementLevel === enhancementLevel);

            // For non-enhanceable items (enh level 0), orderBook won't have enhancementLevel field
            // Just use the first (and only) orderBook entry
            if (!orderBook && enhancementLevel === 0 && orderBookData.orderBooks.length > 0) {
                orderBook = orderBookData.orderBooks[0];
            }

            if (!orderBook) {
                span.textContent = 'N/A';
                span.style.color = '#666666';
                span.style.fontSize = '0.9em';
                cell.appendChild(span);
                return cell;
            }

            // Get top order (first in array)
            const topOrders = isSell ? orderBook.asks : orderBook.bids;

            if (!topOrders || topOrders.length === 0) {
                // No competing orders
                span.textContent = 'None';
                span.style.color = '#00FF00'; // Green = you're the only one
                span.style.fontSize = '0.9em';
                cell.appendChild(span);
                return cell;
            }

            const topOrder = topOrders[0];
            const topListingId = topOrder.listingId;

            // Estimate timestamp using existing logic
            const estimatedTimestamp = estimatedListingAge.estimateTimestamp(topListingId);

            // Format as elapsed time
            const ageMs = Date.now() - estimatedTimestamp;
            const formatted = formatters_js.formatRelativeTime(ageMs);

            span.textContent = `~${formatted}`;

            // Apply staleness color based on when order book data was fetched
            span.style.color = estimatedListingAge.getStalenessColor(lastUpdated);
            span.style.fontSize = '0.9em';

            // Add tooltip with staleness info
            if (lastUpdated) {
                span.title = estimatedListingAge.getStalenessTooltip(lastUpdated);
            }

            cell.appendChild(span);
            return cell;
        }

        /**
         * Create Total Price cell
         * @param {string} itemHrid - Item HRID
         * @param {boolean} isSell - Is sell order
         * @param {number} price - Unit price
         * @param {number} orderQuantity - Total quantity ordered
         * @param {number} filledQuantity - Quantity already filled
         * @param {number} unclaimedCoinCount - Unclaimed coins (for filled sell orders)
         * @param {number} unclaimedItemCount - Unclaimed items (for filled buy orders)
         * @returns {HTMLElement} Table cell element
         */
        createTotalPriceCell(
            itemHrid,
            isSell,
            price,
            orderQuantity,
            filledQuantity,
            unclaimedCoinCount,
            unclaimedItemCount
        ) {
            const cell = document.createElement('td');
            cell.classList.add('mwi-listing-price-cell');

            const span = document.createElement('span');
            span.classList.add('mwi-listing-price-value');

            let totalPrice;

            // For filled listings, show unclaimed amount
            if (filledQuantity === orderQuantity) {
                if (isSell) {
                    // Sell order: show unclaimed coins
                    totalPrice = unclaimedCoinCount;
                } else {
                    // Buy order: show value of unclaimed items
                    totalPrice = unclaimedItemCount * price;
                }
            } else {
                // For active listings, calculate remaining value
                // Calculate tax rate (0.18 for cowbells, 0.02 for others, 0.0 for buy orders)
                const taxRate = isSell ? (itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.02) : 0;
                totalPrice = (orderQuantity - filledQuantity) * Math.floor(profitHelpers_js.calculatePriceAfterTax(price, taxRate));
            }

            // Format and color code
            span.textContent = formatters_js.coinFormatter(totalPrice);

            // Color based on amount
            span.style.color = this.getAmountColor(totalPrice);

            cell.appendChild(span);
            return cell;
        }

        /**
         * Create Listed Age cell
         * @param {string} createdTimestamp - ISO timestamp when listing was created
         * @returns {HTMLElement} Table cell element
         */
        createListedAgeCell(createdTimestamp) {
            const cell = document.createElement('td');
            cell.classList.add('mwi-listing-price-cell');

            const span = document.createElement('span');
            span.classList.add('mwi-listing-price-value');

            // Calculate age in milliseconds
            const createdDate = new Date(createdTimestamp);
            const ageMs = Date.now() - createdDate.getTime();

            // Format relative time
            span.textContent = formatters_js.formatRelativeTime(ageMs);
            span.style.color = '#AAAAAA'; // Gray for time display

            cell.appendChild(span);
            return cell;
        }

        /**
         * Create placeholder cell for unmatched rows
         * @returns {HTMLElement} Empty table cell element
         */
        createPlaceholderCell() {
            const cell = document.createElement('td');
            cell.classList.add('mwi-listing-price-cell');

            const span = document.createElement('span');
            span.classList.add('mwi-listing-price-value');
            span.textContent = 'N/A';
            span.style.color = '#666666'; // Gray for placeholder
            span.style.fontSize = '0.9em';

            cell.appendChild(span);
            return cell;
        }

        /**
         * Get color for amount based on magnitude
         * @param {number} amount - Amount value
         * @returns {string} Color code
         */
        getAmountColor(amount) {
            if (amount >= 1000000) return '#FFD700'; // Gold for 1M+
            if (amount >= 100000) return '#00FF00'; // Green for 100K+
            if (amount >= 10000) return '#FFFFFF'; // White for 10K+
            return '#AAAAAA'; // Gray for small amounts
        }

        /**
         * Clear all injected displays
         */
        clearDisplays() {
            document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
                table.classList.remove('mwi-listing-prices-set');
            });
            document.querySelectorAll('.mwi-listing-price-header').forEach((el) => el.remove());
            document.querySelectorAll('.mwi-listing-price-cell').forEach((el) => el.remove());
        }

        /**
         * Disable the listing price display
         */
        disable() {
            console.log('[ListingPriceDisplay] 🧹 Cleaning up handlers');

            // Cleanup all MutationObservers
            for (const observer of this.tbodyObservers.values()) {
                observer.disconnect();
            }
            this.tbodyObservers.clear();

            this.cleanupRegistry.cleanupAll();
            this.clearDisplays();
            this.allListings = {};
            this.activeRefreshes = new WeakSet();
            this.isInitialized = false;
        }
    }

    const listingPriceDisplay = new ListingPriceDisplay();

    /**
     * Market Order Totals Module
     *
     * Displays market listing totals in the header area:
     * - Buy Orders (BO): Coins locked in buy orders
     * - Sell Orders (SO): Expected proceeds from sell orders
     * - Unclaimed (💰): Coins waiting to be collected
     */


    class MarketOrderTotals {
        constructor() {
            this.unregisterWebSocket = null;
            this.unregisterObserver = null;
            this.isInitialized = false;
            this.displayElement = null;
            this.marketplaceClickHandler = (event) => {
                event.preventDefault();
                this.openMarketplace();
            };
        }

        /**
         * Initialize the market order totals feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_showOrderTotals')) {
                return;
            }

            this.isInitialized = true;

            // Setup data listeners for listing updates
            this.setupDataListeners();

            // Setup DOM observer for header
            this.setupObserver();
        }

        /**
         * Setup WebSocket listeners to detect listing changes
         */
        setupDataListeners() {
            const updateHandler = () => {
                this.updateDisplay();
            };

            dataManager.on('market_listings_updated', updateHandler);
            dataManager.on('character_initialized', updateHandler);

            this.unregisterWebSocket = () => {
                dataManager.off('market_listings_updated', updateHandler);
                dataManager.off('character_initialized', updateHandler);
            };
        }

        /**
         * Setup DOM observer for header area
         */
        setupObserver() {
            // 1. Check if element already exists (handles late initialization)
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.injectDisplay(existingElem);
            }

            // 2. Watch for future additions (handles SPA navigation, page reloads)
            this.unregisterObserver = domObserver.onClass('MarketOrderTotals', 'Header_totalLevel', (totalLevelElem) => {
                this.injectDisplay(totalLevelElem);
            });
        }

        /**
         * Calculate market order totals from all listings
         * @returns {Object} Totals object with buyOrders, sellOrders, unclaimed
         */
        calculateTotals() {
            const listings = dataManager.getMarketListings();

            let buyOrders = 0;
            let sellOrders = 0;
            let unclaimed = 0;

            for (const listing of listings) {
                if (!listing) {
                    continue;
                }

                // Unclaimed coins
                unclaimed += listing.unclaimedCoinCount || 0;

                // Skip cancelled or fully claimed listings
                if (
                    listing.status === '/market_listing_status/cancelled' ||
                    (listing.status === '/market_listing_status/filled' &&
                        (listing.unclaimedItemCount || 0) === 0 &&
                        (listing.unclaimedCoinCount || 0) === 0)
                ) {
                    continue;
                }

                if (listing.isSell) {
                    // Sell orders: Calculate expected proceeds after tax
                    if (listing.status === '/market_listing_status/filled') {
                        continue;
                    }

                    const tax = listing.itemHrid === '/items/bag_of_10_cowbells' ? 0.82 : 0.98;
                    const remainingQuantity = Math.max(0, listing.orderQuantity - listing.filledQuantity);

                    if (remainingQuantity > 0) {
                        sellOrders += remainingQuantity * Math.floor(listing.price * tax);
                    }
                } else {
                    // Buy orders: Prepaid coins locked in the order
                    buyOrders += listing.coinsAvailable || 0;
                }
            }

            return {
                buyOrders,
                sellOrders,
                unclaimed,
            };
        }

        /**
         * Inject display element into header
         * @param {HTMLElement} totalLevelElem - Total level element
         */
        injectDisplay(totalLevelElem) {
            // Skip if already injected
            if (this.displayElement && document.body.contains(this.displayElement)) {
                return;
            }

            // Create display container
            this.displayElement = document.createElement('div');
            this.displayElement.classList.add('mwi-market-order-totals');
            this.displayElement.style.cssText = `
            display: flex;
            gap: 12px;
            font-size: 0.85em;
            color: #aaa;
            margin-top: 4px;
            padding: 2px 0;
        `;

            // Find the networth header (if it exists) and insert after it
            // Otherwise insert after total level
            const networthHeader = document.querySelector('.mwi-networth-header');
            if (networthHeader) {
                networthHeader.insertAdjacentElement('afterend', this.displayElement);
            } else {
                totalLevelElem.insertAdjacentElement('afterend', this.displayElement);
            }

            // Initial update
            this.updateDisplay();
        }

        /**
         * Update the display with current totals
         */
        updateDisplay() {
            if (!this.displayElement || !document.body.contains(this.displayElement)) {
                const headerElement = document.querySelector('[class*="Header_totalLevel"]');
                if (headerElement) {
                    this.injectDisplay(headerElement);
                }

                if (!this.displayElement || !document.body.contains(this.displayElement)) {
                    return;
                }
            }

            const totals = this.calculateTotals();

            // Check if we have no data yet (all zeros)
            const hasNoData = totals.buyOrders === 0 && totals.sellOrders === 0 && totals.unclaimed === 0;

            this.displayElement.style.justifyContent = hasNoData ? 'flex-end' : 'flex-start';
            this.displayElement.style.width = hasNoData ? '100%' : '';

            if (hasNoData) {
                const marketplaceIcon = this.getMarketplaceIcon();
                this.displayElement.innerHTML = `
                <button
                    type="button"
                    class="mwi-market-order-totals-link"
                    title="Open Marketplace"
                    aria-label="Open Marketplace"
                    style="background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center;"
                >
                    ${marketplaceIcon}
                </button>
            `;

                const linkButton = this.displayElement.querySelector('.mwi-market-order-totals-link');
                if (linkButton) {
                    linkButton.addEventListener('click', this.marketplaceClickHandler);
                }

                return;
            }

            // Format values for display
            const boDisplay = `<span style="color: #ffd700;">${formatters_js.formatKMB(totals.buyOrders)}</span>`;
            const soDisplay = `<span style="color: #ffd700;">${formatters_js.formatKMB(totals.sellOrders)}</span>`;
            const unclaimedDisplay = `<span style="color: #ffd700;">${formatters_js.formatKMB(totals.unclaimed)}</span>`;

            // Update display
            this.displayElement.innerHTML = `
            <div style="display: flex; align-items: center; gap: 4px;" title="Buy Orders (coins locked in buy orders)">
                <span style="color: #888; font-weight: 500;">BO:</span>
                ${boDisplay}
            </div>
            <div style="display: flex; align-items: center; gap: 4px;" title="Sell Orders (expected proceeds after tax)">
                <span style="color: #888; font-weight: 500;">SO:</span>
                ${soDisplay}
            </div>
            <div style="display: flex; align-items: center; gap: 4px;" title="Unclaimed coins (waiting to be collected)">
                <span style="font-weight: 500;">💰:</span>
                ${unclaimedDisplay}
            </div>
        `;
        }

        /**
         * Open the marketplace view
         */
        openMarketplace() {
            try {
                const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
                const marketplaceButton = Array.from(navButtons).find((nav) => {
                    const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
                    return svg !== null;
                });

                if (!marketplaceButton) {
                    console.error('[MarketOrderTotals] Marketplace navbar button not found');
                    return;
                }

                marketplaceButton.click();
            } catch (error) {
                console.error('[MarketOrderTotals] Failed to open marketplace:', error);
            }
        }

        /**
         * Build marketplace icon markup using navbar icon (fallback to emoji).
         * @returns {string} HTML string for icon
         */
        getMarketplaceIcon() {
            const navIcon = document.querySelector('svg[aria-label="navigationBar.marketplace"]');
            if (navIcon) {
                const clonedIcon = navIcon.cloneNode(true);
                clonedIcon.setAttribute('width', '16');
                clonedIcon.setAttribute('height', '16');
                clonedIcon.setAttribute('aria-hidden', 'true');
                return clonedIcon.outerHTML;
            }

            return '<span aria-hidden="true">🏪</span>';
        }

        /**
         * Clear all displays
         */
        clearDisplay() {
            if (this.displayElement) {
                this.displayElement.remove();
                this.displayElement = null;
            }
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterWebSocket) {
                this.unregisterWebSocket();
                this.unregisterWebSocket = null;
            }

            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.clearDisplay();
            this.isInitialized = false;
        }
    }

    const marketOrderTotals = new MarketOrderTotals();

    /**
     * Market History Viewer Module
     *
     * Displays a comprehensive table of all market listings with:
     * - Sortable columns
     * - Search/filter functionality
     * - Pagination with user-configurable rows per page
     * - CSV export
     * - Summary statistics
     */


    class MarketHistoryViewer {
        constructor() {
            this.isInitialized = false;
            this.modal = null;
            this.listings = [];
            this.filteredListings = [];
            this.currentPage = 1;
            this.rowsPerPage = 50;
            this.showAll = false;
            this.sortColumn = 'createdTimestamp';
            this.sortDirection = 'desc'; // Most recent first
            this.searchTerm = '';
            this.typeFilter = 'all'; // 'all', 'buy', 'sell'
            this.useKMBFormat = false; // K/M/B formatting toggle
            this.storageKey = 'marketListingTimestamps';
            this.timerRegistry = timerRegistry_js.createTimerRegistry();

            // Column filters
            this.filters = {
                dateFrom: null, // Date object or null
                dateTo: null, // Date object or null
                selectedItems: [], // Array of itemHrids
                selectedEnhLevels: [], // Array of enhancement levels (numbers)
                selectedTypes: [], // Array of 'buy' and/or 'sell'
            };
            this.activeFilterPopup = null; // Track currently open filter popup
            this.popupCloseHandler = null; // Track the close handler to clean it up properly

            // Marketplace tab tracking
            this.marketplaceTab = null;
            this.tabCleanupObserver = null;
        }

        /**
         * Get the current items sprite URL from the DOM
         * @returns {string|null} Items sprite URL or null if not found
         */
        getItemsSpriteUrl() {
            const itemIcon = document.querySelector('use[href*="items_sprite"]');
            if (!itemIcon) {
                return null;
            }
            const href = itemIcon.getAttribute('href');
            return href ? href.split('#')[0] : null;
        }

        /**
         * Initialize the feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_showHistoryViewer')) {
                return;
            }

            this.isInitialized = true;

            // Load K/M/B format preference
            this.useKMBFormat = await storage.get('marketHistoryKMBFormat', 'settings', false);

            // Load saved filters
            await this.loadFilters();

            // Add marketplace tab
            this.addMarketplaceTab();
        }

        /**
         * Load saved filters from storage
         */
        async loadFilters() {
            try {
                const savedFilters = await storage.getJSON('marketHistoryFilters', 'settings', null);
                if (savedFilters) {
                    // Convert date strings back to Date objects
                    this.filters.dateFrom = savedFilters.dateFrom ? new Date(savedFilters.dateFrom) : null;
                    this.filters.dateTo = savedFilters.dateTo ? new Date(savedFilters.dateTo) : null;
                    this.filters.selectedItems = savedFilters.selectedItems || [];
                    this.filters.selectedEnhLevels = savedFilters.selectedEnhLevels || [];
                    this.filters.selectedTypes = savedFilters.selectedTypes || [];
                }
            } catch (error) {
                console.error('[MarketHistoryViewer] Failed to load filters:', error);
            }
        }

        /**
         * Save filters to storage
         */
        async saveFilters() {
            try {
                // Convert Date objects to strings for storage
                const filtersToSave = {
                    dateFrom: this.filters.dateFrom ? this.filters.dateFrom.toISOString() : null,
                    dateTo: this.filters.dateTo ? this.filters.dateTo.toISOString() : null,
                    selectedItems: this.filters.selectedItems,
                    selectedEnhLevels: this.filters.selectedEnhLevels,
                    selectedTypes: this.filters.selectedTypes,
                };
                await storage.setJSON('marketHistoryFilters', filtersToSave, 'settings', true);
            } catch (error) {
                console.error('[MarketHistoryViewer] Failed to save filters:', error);
            }
        }

        /**
         * Add "Market History" tab to marketplace tabs
         */
        addMarketplaceTab() {
            const ensureTabExists = () => {
                // Get tabs container
                const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                if (!tabsContainer) return;

                // Verify this is the marketplace tabs (check for Market Listings tab)
                const hasMarketListingsTab = Array.from(tabsContainer.children).some((btn) =>
                    btn.textContent.includes('Market Listings')
                );
                if (!hasMarketListingsTab) return;

                // Check if tab already exists
                if (tabsContainer.querySelector('[data-mwi-market-history-tab="true"]')) {
                    return;
                }

                // Get reference tab (My Listings) to clone structure
                const referenceTab = Array.from(tabsContainer.children).find((btn) =>
                    btn.textContent.includes('My Listings')
                );
                if (!referenceTab) return;

                // Clone reference tab
                const tab = referenceTab.cloneNode(true);

                // Mark as market history tab
                tab.setAttribute('data-mwi-market-history-tab', 'true');

                // Update badge content
                const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
                if (badgeSpan) {
                    badgeSpan.innerHTML = `
                    <div style="text-align: center;">
                        <div>Market History</div>
                    </div>
                `;
                }

                // Remove selected state
                tab.classList.remove('Mui-selected');
                tab.setAttribute('aria-selected', 'false');
                tab.setAttribute('tabindex', '-1');

                // Add click handler
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });

                // Insert before any missing materials custom tabs (data-mwi-custom-tab="true")
                const firstCustomTab = Array.from(tabsContainer.children).find(
                    (btn) => btn.getAttribute('data-mwi-custom-tab') === 'true'
                );

                if (firstCustomTab) {
                    firstCustomTab.before(tab);
                } else {
                    // No custom tabs, append to end
                    tabsContainer.appendChild(tab);
                }

                this.marketplaceTab = tab;
            };

            // Watch for marketplace tabs container to appear
            if (!this.tabCleanupObserver) {
                this.tabCleanupObserver = domObserverHelpers_js.createMutationWatcher(
                    document.body,
                    () => {
                        // Check if marketplace is still active
                        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                        if (!tabsContainer) {
                            // Marketplace closed, clean up tab
                            if (this.marketplaceTab && !document.body.contains(this.marketplaceTab)) {
                                this.marketplaceTab = null;
                            }
                            return;
                        }

                        // Check if this is still the marketplace (Market Listings tab exists)
                        const hasMarketListingsTab = Array.from(tabsContainer.children).some((btn) =>
                            btn.textContent.includes('Market Listings')
                        );

                        if (!hasMarketListingsTab) {
                            // No longer on marketplace, clean up
                            if (this.marketplaceTab && document.body.contains(this.marketplaceTab)) {
                                this.marketplaceTab.remove();
                                this.marketplaceTab = null;
                            }
                            return;
                        }

                        // Try to ensure tab exists
                        ensureTabExists();
                    },
                    { childList: true, subtree: true }
                );
            }

            // Initial attempt
            ensureTabExists();
        }

        /**
         * Load listings from storage
         */
        async loadListings() {
            try {
                const stored = await storage.getJSON(this.storageKey, 'marketListings', []);
                // Filter out listings without itemHrid (e.g., seed listings from estimated-listing-age)
                this.listings = stored.filter((listing) => listing && listing.itemHrid);
                this.cachedDateRange = null; // Clear cache when loading new data
                this.applyFilters();
            } catch (error) {
                console.error('[MarketHistoryViewer] Failed to load listings:', error);
                this.listings = [];
                this.filteredListings = [];
            }
        }

        /**
         * Apply filters and search to listings
         */
        applyFilters() {
            let filtered = [...this.listings];

            // Clear cached date range when filters change
            this.cachedDateRange = null;

            // Apply type filter (legacy - kept for backwards compatibility)
            if (this.typeFilter === 'buy') {
                filtered = filtered.filter((listing) => !listing.isSell);
            } else if (this.typeFilter === 'sell') {
                filtered = filtered.filter((listing) => listing.isSell);
            }

            // Apply search term (search in item name)
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                filtered = filtered.filter((listing) => {
                    const itemName = this.getItemName(listing.itemHrid).toLowerCase();
                    return itemName.includes(term);
                });
            }

            // Apply date range filter
            if (this.filters.dateFrom || this.filters.dateTo) {
                filtered = filtered.filter((listing) => {
                    const listingDate = new Date(listing.createdTimestamp || listing.timestamp);

                    if (this.filters.dateFrom && listingDate < this.filters.dateFrom) {
                        return false;
                    }

                    if (this.filters.dateTo) {
                        // Set dateTo to end of day (23:59:59.999)
                        const endOfDay = new Date(this.filters.dateTo);
                        endOfDay.setHours(23, 59, 59, 999);
                        if (listingDate > endOfDay) {
                            return false;
                        }
                    }

                    return true;
                });
            }

            // Apply item filter
            if (this.filters.selectedItems.length > 0) {
                filtered = filtered.filter((listing) => this.filters.selectedItems.includes(listing.itemHrid));
            }

            // Apply enhancement level filter
            if (this.filters.selectedEnhLevels.length > 0) {
                filtered = filtered.filter((listing) => this.filters.selectedEnhLevels.includes(listing.enhancementLevel));
            }

            // Apply type filter (column filter)
            if (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2) {
                // Only filter if not both selected (both selected = show all)
                const showBuy = this.filters.selectedTypes.includes('buy');
                const showSell = this.filters.selectedTypes.includes('sell');

                filtered = filtered.filter((listing) => {
                    if (showBuy && !listing.isSell) return true;
                    if (showSell && listing.isSell) return true;
                    return false;
                });
            }

            // Apply sorting
            filtered.sort((a, b) => {
                let aVal = a[this.sortColumn];
                let bVal = b[this.sortColumn];

                // Handle timestamp sorting
                if (this.sortColumn === 'createdTimestamp') {
                    aVal = a.timestamp; // Use numeric timestamp for sorting
                    bVal = b.timestamp;
                }

                // Handle item name sorting
                if (this.sortColumn === 'itemHrid') {
                    aVal = this.getItemName(a.itemHrid);
                    bVal = this.getItemName(b.itemHrid);
                }

                // Handle total (price × filled) sorting
                if (this.sortColumn === 'total') {
                    aVal = a.price * a.filledQuantity;
                    bVal = b.price * b.filledQuantity;
                }

                if (typeof aVal === 'string') {
                    return this.sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                } else {
                    return this.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }
            });

            this.filteredListings = filtered;
            this.currentPage = 1; // Reset to first page when filters change

            // Auto-cleanup invalid filter selections (only on first pass to prevent infinite recursion)
            if (!this._cleanupInProgress) {
                this._cleanupInProgress = true;
                const cleaned = this.cleanupInvalidSelections();

                if (cleaned) {
                    // Selections were cleaned - re-apply filters with the cleaned selections
                    this.applyFilters();
                }

                this._cleanupInProgress = false;

                // Re-render table if modal is open and cleanup happened (only on outermost call)
                if (cleaned && this.modal && this.modal.style.display !== 'none') {
                    this.renderTable();
                }
            }
        }

        /**
         * Remove filter selections that yield no results with current filters
         * @returns {boolean} True if any selections were cleaned up
         */
        cleanupInvalidSelections() {
            let changed = false;

            // Check item selections
            if (this.filters.selectedItems.length > 0) {
                const validItems = new Set(this.filteredListings.map((l) => l.itemHrid));
                const originalLength = this.filters.selectedItems.length;
                this.filters.selectedItems = this.filters.selectedItems.filter((hrid) => validItems.has(hrid));

                if (this.filters.selectedItems.length !== originalLength) {
                    changed = true;
                }
            }

            // Check enhancement level selections
            if (this.filters.selectedEnhLevels.length > 0) {
                const validLevels = new Set(this.filteredListings.map((l) => l.enhancementLevel));
                const originalLength = this.filters.selectedEnhLevels.length;
                this.filters.selectedEnhLevels = this.filters.selectedEnhLevels.filter((level) => validLevels.has(level));

                if (this.filters.selectedEnhLevels.length !== originalLength) {
                    changed = true;
                }
            }

            // Check type selections
            if (this.filters.selectedTypes.length > 0) {
                const hasBuy = this.filteredListings.some((l) => !l.isSell);
                const hasSell = this.filteredListings.some((l) => l.isSell);
                const originalLength = this.filters.selectedTypes.length;

                this.filters.selectedTypes = this.filters.selectedTypes.filter((type) => {
                    if (type === 'buy') return hasBuy;
                    if (type === 'sell') return hasSell;
                    return false;
                });

                if (this.filters.selectedTypes.length !== originalLength) {
                    changed = true;
                }
            }

            // Save changes to storage
            if (changed) {
                this.saveFilters();
            }

            return changed;
        }

        /**
         * Get item name from HRID
         */
        getItemName(itemHrid) {
            const itemDetails = dataManager.getItemDetails(itemHrid);
            return itemDetails?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
        }

        /**
         * Format number based on K/M/B toggle
         * @param {number} num - Number to format
         * @returns {string} Formatted number
         */
        formatNumber(num) {
            return this.useKMBFormat ? formatters_js.formatKMB(num, 1) : formatters_js.formatWithSeparator(num);
        }

        /**
         * Get paginated listings for current page
         */
        getPaginatedListings() {
            if (this.showAll) {
                return this.filteredListings;
            }

            const start = (this.currentPage - 1) * this.rowsPerPage;
            const end = start + this.rowsPerPage;
            return this.filteredListings.slice(start, end);
        }

        /**
         * Get total pages
         */
        getTotalPages() {
            if (this.showAll) {
                return 1;
            }
            return Math.ceil(this.filteredListings.length / this.rowsPerPage);
        }

        /**
         * Open the market history modal
         */
        async openModal() {
            // Load listings
            await this.loadListings();

            // Create modal if it doesn't exist
            if (!this.modal) {
                this.createModal();
            }

            // Show modal
            this.modal.style.display = 'flex';

            // Render table
            this.renderTable();
        }

        /**
         * Close the modal
         */
        closeModal() {
            if (this.modal) {
                this.modal.style.display = 'none';
            }
        }

        /**
         * Create modal structure
         */
        createModal() {
            // Modal overlay
            this.modal = document.createElement('div');
            this.modal.className = 'mwi-market-history-modal';
            this.modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

            // Modal content
            const content = document.createElement('div');
            content.className = 'mwi-market-history-content';
            content.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            max-width: 95%;
            max-height: 90%;
            overflow: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

            // Header
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        `;

            const title = document.createElement('h2');
            title.textContent = 'Market History';
            title.style.cssText = `
            margin: 0;
            color: #fff;
        `;

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #fff;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
        `;
            closeBtn.addEventListener('click', () => this.closeModal());

            header.appendChild(title);
            header.appendChild(closeBtn);

            // Controls container
            const controls = document.createElement('div');
            controls.className = 'mwi-market-history-controls';
            controls.style.cssText = `
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
        `;

            content.appendChild(header);
            content.appendChild(controls);

            // Table container
            const tableContainer = document.createElement('div');
            tableContainer.className = 'mwi-market-history-table-container';
            content.appendChild(tableContainer);

            // Pagination container
            const pagination = document.createElement('div');
            pagination.className = 'mwi-market-history-pagination';
            pagination.style.cssText = `
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
            content.appendChild(pagination);

            this.modal.appendChild(content);
            document.body.appendChild(this.modal);

            // Close on background click
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });
        }

        /**
         * Render controls (search, filters, export)
         */
        renderControls() {
            const controls = this.modal.querySelector('.mwi-market-history-controls');

            // Only render if controls are empty (prevents re-rendering on every keystroke)
            if (controls.children.length > 0) {
                // Just update the stats text
                this.updateStats();
                return;
            }

            // Left group: Search and filters
            const leftGroup = document.createElement('div');
            leftGroup.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
        `;

            // Search box
            const searchBox = document.createElement('input');
            searchBox.type = 'text';
            searchBox.placeholder = 'Search items...';
            searchBox.value = this.searchTerm;
            searchBox.className = 'mwi-search-box';
            searchBox.style.cssText = `
            padding: 6px 12px;
            border: 1px solid #555;
            border-radius: 4px;
            background: #1a1a1a;
            color: #fff;
            min-width: 200px;
        `;
            searchBox.addEventListener('input', (e) => {
                this.searchTerm = e.target.value;
                this.applyFilters();
                this.renderTable();
            });

            // Type filter
            const typeFilter = document.createElement('select');
            typeFilter.style.cssText = `
            padding: 6px 12px;
            border: 1px solid #555;
            border-radius: 4px;
            background: #1a1a1a;
            color: #fff;
        `;
            const typeOptions = [
                { value: 'all', label: 'All Types' },
                { value: 'buy', label: 'Buy Orders' },
                { value: 'sell', label: 'Sell Orders' },
            ];
            typeOptions.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === this.typeFilter) {
                    option.selected = true;
                }
                typeFilter.appendChild(option);
            });
            typeFilter.addEventListener('change', (e) => {
                this.typeFilter = e.target.value;
                this.applyFilters();
                this.renderTable();
            });

            leftGroup.appendChild(searchBox);
            leftGroup.appendChild(typeFilter);

            // Middle group: Active filter badges
            const middleGroup = document.createElement('div');
            middleGroup.className = 'mwi-active-filters';
            middleGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            flex: 1;
            min-height: 32px;
        `;

            // Action buttons group
            const actionGroup = document.createElement('div');
            actionGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
        `;

            // Export button
            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Export CSV';
            exportBtn.style.cssText = `
            padding: 6px 12px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
            exportBtn.addEventListener('click', () => this.exportCSV());

            // Import button
            const importBtn = document.createElement('button');
            importBtn.textContent = 'Import Market Data';
            importBtn.style.cssText = `
            padding: 6px 12px;
            background: #9b59b6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
            importBtn.addEventListener('click', () => this.showImportDialog());

            // Clear History button (destructive action - red)
            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear History';
            clearBtn.style.cssText = `
            padding: 6px 12px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
            clearBtn.addEventListener('mouseenter', () => {
                clearBtn.style.background = '#b91c1c';
            });
            clearBtn.addEventListener('mouseleave', () => {
                clearBtn.style.background = '#dc2626';
            });
            clearBtn.addEventListener('click', () => this.clearHistory());

            actionGroup.appendChild(exportBtn);
            actionGroup.appendChild(importBtn);
            actionGroup.appendChild(clearBtn);

            // Right group: Options and stats
            const rightGroup = document.createElement('div');
            rightGroup.style.cssText = `
            display: flex;
            gap: 12px;
            align-items: center;
            margin-left: auto;
        `;

            // K/M/B Format checkbox
            const kmbCheckbox = document.createElement('input');
            kmbCheckbox.type = 'checkbox';
            kmbCheckbox.checked = this.useKMBFormat;
            kmbCheckbox.id = 'mwi-kmb-format';
            kmbCheckbox.style.cssText = `
            cursor: pointer;
        `;
            kmbCheckbox.addEventListener('change', (e) => {
                this.useKMBFormat = e.target.checked;
                // Save preference to storage
                storage.set('marketHistoryKMBFormat', this.useKMBFormat, 'settings');
                this.renderTable(); // Re-render to apply formatting
            });

            const kmbLabel = document.createElement('label');
            kmbLabel.htmlFor = 'mwi-kmb-format';
            kmbLabel.textContent = 'K/M/B Format';
            kmbLabel.style.cssText = `
            cursor: pointer;
            color: #aaa;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
            kmbLabel.prepend(kmbCheckbox);

            // Summary stats
            const stats = document.createElement('div');
            stats.className = 'mwi-market-history-stats';
            stats.style.cssText = `
            color: #aaa;
            font-size: 14px;
            white-space: nowrap;
        `;
            stats.textContent = `Total: ${this.filteredListings.length} listings`;

            rightGroup.appendChild(kmbLabel);
            rightGroup.appendChild(stats);

            controls.appendChild(leftGroup);
            controls.appendChild(middleGroup);
            controls.appendChild(actionGroup);
            controls.appendChild(rightGroup);

            // Add Clear All Filters button if needed (handled dynamically)
            this.updateClearFiltersButton();

            // Render active filter badges
            this.renderActiveFilters();
        }

        /**
         * Update just the stats text (without re-rendering controls)
         */
        updateStats() {
            const stats = this.modal.querySelector('.mwi-market-history-stats');
            if (stats) {
                stats.textContent = `Total: ${this.filteredListings.length} listings`;
            }

            // Update Clear All Filters button visibility
            this.updateClearFiltersButton();

            // Update active filter badges
            this.renderActiveFilters();
        }

        /**
         * Render active filter badges in the middle section
         */
        renderActiveFilters() {
            const container = this.modal.querySelector('.mwi-active-filters');
            if (!container) return;

            // Explicitly remove all children to ensure SVG elements are garbage collected
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            const badges = [];

            // Date filter
            if (this.filters.dateFrom || this.filters.dateTo) {
                const dateText = [];
                if (this.filters.dateFrom) {
                    dateText.push(this.filters.dateFrom.toLocaleDateString());
                }
                if (this.filters.dateTo) {
                    dateText.push(this.filters.dateTo.toLocaleDateString());
                }
                badges.push({
                    label: `Date: ${dateText.join(' - ')}`,
                    onRemove: () => {
                        this.filters.dateFrom = null;
                        this.filters.dateTo = null;
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            }

            // Item filters
            if (this.filters.selectedItems.length > 0) {
                if (this.filters.selectedItems.length === 1) {
                    badges.push({
                        label: this.getItemName(this.filters.selectedItems[0]),
                        icon: this.filters.selectedItems[0],
                        onRemove: () => {
                            this.filters.selectedItems = [];
                            this.saveFilters();
                            this.applyFilters();
                            this.renderTable();
                        },
                    });
                } else {
                    badges.push({
                        label: `${this.filters.selectedItems.length} items selected`,
                        icon: this.filters.selectedItems[0], // Show first item's icon
                        onRemove: () => {
                            this.filters.selectedItems = [];
                            this.saveFilters();
                            this.applyFilters();
                            this.renderTable();
                        },
                    });
                }
            }

            // Enhancement level filters
            if (this.filters.selectedEnhLevels.length > 0) {
                const levels = this.filters.selectedEnhLevels.sort((a, b) => a - b);
                if (levels.length === 1) {
                    const levelText = levels[0] > 0 ? `+${levels[0]}` : 'No Enhancement';
                    badges.push({
                        label: `Enh Lvl: ${levelText}`,
                        onRemove: () => {
                            this.filters.selectedEnhLevels = [];
                            this.saveFilters();
                            this.applyFilters();
                            this.renderTable();
                        },
                    });
                } else {
                    badges.push({
                        label: `Enh Lvl: ${levels.length} selected`,
                        onRemove: () => {
                            this.filters.selectedEnhLevels = [];
                            this.saveFilters();
                            this.applyFilters();
                            this.renderTable();
                        },
                    });
                }
            }

            // Type filters
            if (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2) {
                badges.push({
                    label: `Type: ${this.filters.selectedTypes.includes('buy') ? 'Buy' : 'Sell'}`,
                    onRemove: () => {
                        this.filters.selectedTypes = [];
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            }

            // Render badges
            badges.forEach((badge) => {
                const badgeEl = document.createElement('div');
                badgeEl.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                background: #3a3a3a;
                border: 1px solid #555;
                border-radius: 4px;
                color: #aaa;
                font-size: 13px;
            `;

                // Add icon if provided
                if (badge.icon) {
                    const itemsSpriteUrl = this.getItemsSpriteUrl();
                    if (itemsSpriteUrl) {
                        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.setAttribute('width', '16');
                        svg.setAttribute('height', '16');
                        svg.style.flexShrink = '0';

                        // Extract icon name and create use element with external sprite reference
                        const iconName = badge.icon.split('/').pop();
                        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                        use.setAttribute('href', `${itemsSpriteUrl}#${iconName}`);
                        svg.appendChild(use);
                        badgeEl.appendChild(svg);
                    }
                }

                const label = document.createElement('span');
                label.textContent = badge.label;

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.style.cssText = `
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                padding: 0;
                font-size: 14px;
                line-height: 1;
            `;
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.color = '#fff';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.color = '#aaa';
                });
                removeBtn.addEventListener('click', badge.onRemove);

                badgeEl.appendChild(label);
                badgeEl.appendChild(removeBtn);
                container.appendChild(badgeEl);
            });
        }

        /**
         * Update Clear All Filters button visibility based on filter state
         */
        updateClearFiltersButton() {
            const controls = this.modal.querySelector('.mwi-market-history-controls');
            if (!controls) return;

            const hasActiveFilters =
                this.filters.dateFrom !== null ||
                this.filters.dateTo !== null ||
                this.filters.selectedItems.length > 0 ||
                this.filters.selectedEnhLevels.length > 0 ||
                (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2);

            const existingBtn = controls.querySelector('.mwi-clear-filters-button');

            if (hasActiveFilters && !existingBtn) {
                // Create button
                const clearFiltersBtn = document.createElement('button');
                clearFiltersBtn.className = 'mwi-clear-filters-button';
                clearFiltersBtn.textContent = 'Clear All Filters';
                clearFiltersBtn.style.cssText = `
                padding: 6px 12px;
                background: #e67e22;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                white-space: nowrap;
            `;
                clearFiltersBtn.addEventListener('mouseenter', () => {
                    clearFiltersBtn.style.background = '#d35400';
                });
                clearFiltersBtn.addEventListener('mouseleave', () => {
                    clearFiltersBtn.style.background = '#e67e22';
                });
                clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());

                // Insert into right group (before K/M/B checkbox)
                const rightGroup = controls.children[3]; // Fourth child is rightGroup
                if (rightGroup) {
                    rightGroup.insertBefore(clearFiltersBtn, rightGroup.firstChild);
                }
            } else if (!hasActiveFilters && existingBtn) {
                // Remove button
                existingBtn.remove();
            }
        }

        /**
         * Render table with listings
         */
        renderTable() {
            this.renderControls();

            const tableContainer = this.modal.querySelector('.mwi-market-history-table-container');

            // Explicitly remove all children to ensure SVG elements are garbage collected
            while (tableContainer.firstChild) {
                tableContainer.removeChild(tableContainer.firstChild);
            }

            const table = document.createElement('table');
            table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            color: #fff;
        `;

            // Header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            headerRow.style.cssText = `
            background: #1a1a1a;
        `;

            const columns = [
                { key: 'createdTimestamp', label: 'Date' },
                { key: 'itemHrid', label: 'Item' },
                { key: 'enhancementLevel', label: 'Enh Lvl' },
                { key: 'isSell', label: 'Type' },
                { key: 'price', label: 'Price' },
                { key: 'orderQuantity', label: 'Quantity' },
                { key: 'filledQuantity', label: 'Filled' },
                { key: 'total', label: 'Total' },
            ];

            columns.forEach((col) => {
                const th = document.createElement('th');
                th.style.cssText = `
                padding: 10px;
                text-align: left;
                border-bottom: 2px solid #555;
                user-select: none;
                position: relative;
            `;

                // Create header content container
                const headerContent = document.createElement('div');
                headerContent.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
            `;

                // Label and sort indicator
                const labelSpan = document.createElement('span');
                labelSpan.textContent = col.label;
                labelSpan.style.cursor = 'pointer';

                // Sort indicator
                if (this.sortColumn === col.key) {
                    labelSpan.textContent += this.sortDirection === 'asc' ? ' ▲' : ' ▼';
                }

                // Sort click handler
                labelSpan.addEventListener('click', () => {
                    if (this.sortColumn === col.key) {
                        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.sortColumn = col.key;
                        this.sortDirection = 'desc';
                    }
                    this.applyFilters();
                    this.renderTable();
                });

                headerContent.appendChild(labelSpan);

                // Add filter button for filterable columns
                const filterableColumns = ['createdTimestamp', 'itemHrid', 'enhancementLevel', 'isSell'];
                if (filterableColumns.includes(col.key)) {
                    const filterBtn = document.createElement('button');
                    filterBtn.textContent = '⋮';
                    filterBtn.style.cssText = `
                    background: none;
                    border: none;
                    color: #aaa;
                    cursor: pointer;
                    font-size: 16px;
                    padding: 2px 4px;
                    font-weight: bold;
                `;

                    // Check if filter is active
                    const hasActiveFilter = this.hasActiveFilter(col.key);
                    if (hasActiveFilter) {
                        filterBtn.style.color = '#4a90e2';
                        filterBtn.textContent = '⋮';
                    }

                    filterBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showFilterPopup(col.key, filterBtn);
                    });

                    headerContent.appendChild(filterBtn);
                }

                th.appendChild(headerContent);
                headerRow.appendChild(th);
            });

            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');
            const paginatedListings = this.getPaginatedListings();

            if (paginatedListings.length === 0) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = columns.length;
                cell.textContent = 'No listings found';
                cell.style.cssText = `
                padding: 20px;
                text-align: center;
                color: #888;
            `;
                row.appendChild(cell);
                tbody.appendChild(row);
            } else {
                paginatedListings.forEach((listing, index) => {
                    const row = document.createElement('tr');
                    row.style.cssText = `
                    border-bottom: 1px solid #333;
                    background: ${index % 2 === 0 ? '#2a2a2a' : '#252525'};
                `;

                    // Date
                    const dateCell = document.createElement('td');
                    // Use createdTimestamp if available, otherwise fall back to numeric timestamp
                    const dateValue = listing.createdTimestamp || listing.timestamp;
                    dateCell.textContent = new Date(dateValue).toLocaleString();
                    dateCell.style.padding = '4px 10px';
                    row.appendChild(dateCell);

                    // Item (with icon)
                    const itemCell = document.createElement('td');
                    itemCell.style.cssText = `
                    padding: 4px 10px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;

                    // Create SVG icon
                    const itemsSpriteUrl = this.getItemsSpriteUrl();
                    if (itemsSpriteUrl) {
                        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.setAttribute('width', '20');
                        svg.setAttribute('height', '20');

                        // Extract icon name and create use element with external sprite reference
                        const iconName = listing.itemHrid.split('/').pop();
                        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                        use.setAttribute('href', `${itemsSpriteUrl}#${iconName}`);
                        svg.appendChild(use);

                        // Add icon
                        itemCell.appendChild(svg);
                    }

                    // Add text
                    const textSpan = document.createElement('span');
                    textSpan.textContent = this.getItemName(listing.itemHrid);
                    itemCell.appendChild(textSpan);

                    row.appendChild(itemCell);

                    // Enhancement
                    const enhCell = document.createElement('td');
                    enhCell.textContent = listing.enhancementLevel > 0 ? `+${listing.enhancementLevel}` : '-';
                    enhCell.style.padding = '4px 10px';
                    row.appendChild(enhCell);

                    // Type
                    const typeCell = document.createElement('td');
                    typeCell.textContent = listing.isSell ? 'Sell' : 'Buy';
                    typeCell.style.cssText = `
                    padding: 4px 10px;
                    color: ${listing.isSell ? '#4ade80' : '#60a5fa'};
                `;
                    row.appendChild(typeCell);

                    // Price
                    const priceCell = document.createElement('td');
                    priceCell.textContent = this.formatNumber(listing.price);
                    priceCell.style.padding = '4px 10px';
                    row.appendChild(priceCell);

                    // Quantity
                    const qtyCell = document.createElement('td');
                    qtyCell.textContent = this.formatNumber(listing.orderQuantity);
                    qtyCell.style.padding = '4px 10px';
                    row.appendChild(qtyCell);

                    // Filled
                    const filledCell = document.createElement('td');
                    filledCell.textContent = this.formatNumber(listing.filledQuantity);
                    filledCell.style.padding = '4px 10px';
                    row.appendChild(filledCell);

                    // Total (Price × Filled)
                    const totalCell = document.createElement('td');
                    const totalValue = listing.price * listing.filledQuantity;
                    totalCell.textContent = this.formatNumber(totalValue);
                    totalCell.style.padding = '4px 10px';
                    row.appendChild(totalCell);

                    tbody.appendChild(row);
                });
            }

            table.appendChild(tbody);
            tableContainer.appendChild(table);

            // Render pagination
            this.renderPagination();
        }

        /**
         * Render pagination controls
         */
        renderPagination() {
            const pagination = this.modal.querySelector('.mwi-market-history-pagination');

            // Explicitly remove all children to ensure proper cleanup
            while (pagination.firstChild) {
                pagination.removeChild(pagination.firstChild);
            }

            // Left side: Rows per page
            const leftSide = document.createElement('div');
            leftSide.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            color: #aaa;
        `;

            const label = document.createElement('span');
            label.textContent = 'Rows per page:';

            const rowsInput = document.createElement('input');
            rowsInput.type = 'number';
            rowsInput.value = this.rowsPerPage;
            rowsInput.min = '1';
            rowsInput.disabled = this.showAll;
            rowsInput.style.cssText = `
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #555;
            border-radius: 4px;
            background: ${this.showAll ? '#333' : '#1a1a1a'};
            color: ${this.showAll ? '#666' : '#fff'};
        `;
            rowsInput.addEventListener('change', (e) => {
                this.rowsPerPage = Math.max(1, parseInt(e.target.value) || 50);
                this.currentPage = 1;
                this.renderTable();
            });

            const showAllCheckbox = document.createElement('input');
            showAllCheckbox.type = 'checkbox';
            showAllCheckbox.checked = this.showAll;
            showAllCheckbox.style.cssText = `
            cursor: pointer;
        `;
            showAllCheckbox.addEventListener('change', (e) => {
                this.showAll = e.target.checked;
                rowsInput.disabled = this.showAll;
                rowsInput.style.background = this.showAll ? '#333' : '#1a1a1a';
                rowsInput.style.color = this.showAll ? '#666' : '#fff';
                this.currentPage = 1;
                this.renderTable();
            });

            const showAllLabel = document.createElement('label');
            showAllLabel.textContent = 'Show All';
            showAllLabel.style.cssText = `
            cursor: pointer;
            color: #aaa;
        `;
            showAllLabel.prepend(showAllCheckbox);

            leftSide.appendChild(label);
            leftSide.appendChild(rowsInput);
            leftSide.appendChild(showAllLabel);

            // Right side: Page navigation
            const rightSide = document.createElement('div');
            rightSide.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            color: #aaa;
        `;

            if (!this.showAll) {
                const totalPages = this.getTotalPages();

                const prevBtn = document.createElement('button');
                prevBtn.textContent = '◀';
                prevBtn.disabled = this.currentPage === 1;
                prevBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage === 1 ? '#333' : '#4a90e2'};
                color: ${this.currentPage === 1 ? '#666' : 'white'};
                border: none;
                border-radius: 4px;
                cursor: ${this.currentPage === 1 ? 'default' : 'pointer'};
            `;
                prevBtn.addEventListener('click', () => {
                    if (this.currentPage > 1) {
                        this.currentPage--;
                        this.renderTable();
                    }
                });

                const pageInfo = document.createElement('span');
                pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;

                const nextBtn = document.createElement('button');
                nextBtn.textContent = '▶';
                nextBtn.disabled = this.currentPage === totalPages;
                nextBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage === totalPages ? '#333' : '#4a90e2'};
                color: ${this.currentPage === totalPages ? '#666' : 'white'};
                border: none;
                border-radius: 4px;
                cursor: ${this.currentPage === totalPages ? 'default' : 'pointer'};
            `;
                nextBtn.addEventListener('click', () => {
                    if (this.currentPage < totalPages) {
                        this.currentPage++;
                        this.renderTable();
                    }
                });

                rightSide.appendChild(prevBtn);
                rightSide.appendChild(pageInfo);
                rightSide.appendChild(nextBtn);
            } else {
                const showingInfo = document.createElement('span');
                showingInfo.textContent = `Showing all ${this.filteredListings.length} listings`;
                rightSide.appendChild(showingInfo);
            }

            pagination.appendChild(leftSide);
            pagination.appendChild(rightSide);
        }

        /**
         * Export listings to CSV
         */
        exportCSV() {
            const headers = ['Date', 'Item', 'Enhancement', 'Type', 'Price', 'Quantity', 'Filled', 'Total', 'ID'];
            const rows = this.filteredListings.map((listing) => [
                new Date(listing.createdTimestamp || listing.timestamp).toISOString(),
                this.getItemName(listing.itemHrid),
                listing.enhancementLevel || 0,
                listing.isSell ? 'Sell' : 'Buy',
                listing.price,
                listing.orderQuantity,
                listing.filledQuantity,
                listing.price * listing.filledQuantity, // Total
                listing.id,
            ]);

            const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `market-history-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }

        /**
         * Import listings from CSV
         */
        async importCSV(csvText) {
            try {
                // Parse CSV
                const lines = csvText.trim().split('\n');
                if (lines.length < 2) {
                    throw new Error('CSV file is empty or invalid');
                }

                // Parse header
                const _headerLine = lines[0];
                const _expectedHeaders = [
                    'Date',
                    'Item',
                    'Enhancement',
                    'Type',
                    'Price',
                    'Quantity',
                    'Filled',
                    'Total',
                    'ID',
                ];

                // Show progress message
                const progressMsg = document.createElement('div');
                progressMsg.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                padding: 20px;
                border-radius: 8px;
                color: #fff;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            `;
                progressMsg.textContent = `Importing ${lines.length - 1} listings from CSV...`;
                document.body.appendChild(progressMsg);

                // Load existing listings
                const existingListings = await storage.getJSON(this.storageKey, 'marketListings', []);
                const existingIds = new Set(existingListings.map((l) => l.id));

                let imported = 0;
                let skipped = 0;

                // Build item name to HRID map
                const itemNameToHrid = {};
                const gameData = dataManager.getInitClientData();
                if (gameData?.itemDetailMap) {
                    for (const [hrid, details] of Object.entries(gameData.itemDetailMap)) {
                        if (details.name) {
                            itemNameToHrid[details.name] = hrid;
                        }
                    }
                }

                // Process each line
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    // Parse CSV row (handle quoted fields)
                    const fields = [];
                    let currentField = '';
                    let inQuotes = false;

                    for (let j = 0; j < line.length; j++) {
                        const char = line[j];
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            fields.push(currentField);
                            currentField = '';
                        } else {
                            currentField += char;
                        }
                    }
                    fields.push(currentField); // Add last field

                    if (fields.length < 9) {
                        console.warn(`[MarketHistoryViewer] Skipping invalid CSV row ${i}: ${line}`);
                        continue;
                    }

                    const [dateStr, itemName, enhStr, typeStr, priceStr, qtyStr, filledStr, _totalStr, idStr] = fields;

                    // Parse ID
                    const id = parseInt(idStr);
                    if (isNaN(id)) {
                        console.warn(`[MarketHistoryViewer] Skipping row with invalid ID: ${idStr}`);
                        continue;
                    }

                    // Skip duplicates
                    if (existingIds.has(id)) {
                        skipped++;
                        continue;
                    }

                    // Find item HRID from name
                    const itemHrid = itemNameToHrid[itemName];
                    if (!itemHrid) {
                        console.warn(`[MarketHistoryViewer] Could not find HRID for item: ${itemName}`);
                        skipped++;
                        continue;
                    }

                    // Create listing object
                    const listing = {
                        id: id,
                        timestamp: new Date(dateStr).getTime(),
                        createdTimestamp: dateStr,
                        itemHrid: itemHrid,
                        enhancementLevel: parseInt(enhStr) || 0,
                        price: parseFloat(priceStr),
                        orderQuantity: parseFloat(qtyStr),
                        filledQuantity: parseFloat(filledStr),
                        isSell: typeStr.toLowerCase() === 'sell',
                    };

                    existingListings.push(listing);
                    imported++;
                }

                // Save to storage
                await storage.setJSON(this.storageKey, existingListings, 'marketListings', true);

                // Remove progress message
                document.body.removeChild(progressMsg);

                // Show success message
                alert(
                    `Import complete!\n\nImported: ${imported} new listings\nSkipped: ${skipped} duplicates or invalid rows\nTotal: ${existingListings.length} listings`
                );

                // Reload and render table
                await this.loadListings();
                this.renderTable();
            } catch (error) {
                console.error('[MarketHistoryViewer] CSV import error:', error);
                throw error;
            }
        }

        /**
         * Show import dialog
         */
        showImportDialog() {
            // Create file input
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.txt,.json,.csv';
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();

                    // Detect file type and use appropriate import method
                    if (file.name.endsWith('.csv')) {
                        await this.importCSV(text);
                    } else {
                        await this.importEdibleToolsData(text);
                    }
                } catch (error) {
                    console.error('[MarketHistoryViewer] Import failed:', error);
                    alert(`Import failed: ${error.message}`);
                }
            });

            document.body.appendChild(fileInput);
            fileInput.click();
            document.body.removeChild(fileInput);
        }

        /**
         * Import market listing data (supports Edible Tools format)
         */
        async importEdibleToolsData(jsonText) {
            try {
                // Check for truncated file
                if (!jsonText.trim().endsWith('}')) {
                    throw new Error(
                        'File appears to be truncated or incomplete. The JSON does not end properly. ' +
                            'Try exporting from Edible Tools again, or export to CSV from the Market History Viewer and import that instead.'
                    );
                }

                // Parse the storage file
                const data = JSON.parse(jsonText);

                if (!data.market_list) {
                    throw new Error('No market_list found in file. Expected format: {"market_list": "[...]"}');
                }

                // Parse the market_list JSON string
                const marketList = JSON.parse(data.market_list);

                if (!Array.isArray(marketList) || marketList.length === 0) {
                    throw new Error('market_list is empty or invalid');
                }

                // Show progress message
                const progressMsg = document.createElement('div');
                progressMsg.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                padding: 20px;
                border-radius: 8px;
                color: #fff;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            `;
                progressMsg.textContent = `Importing ${marketList.length} listings...`;
                document.body.appendChild(progressMsg);

                // Convert imported format to Toolasha format
                const existingListings = await storage.getJSON(this.storageKey, 'marketListings', []);
                const existingIds = new Set(existingListings.map((l) => l.id));

                let imported = 0;
                let skipped = 0;

                for (const etListing of marketList) {
                    // Skip if we already have this listing
                    if (existingIds.has(etListing.id)) {
                        skipped++;
                        continue;
                    }

                    // Convert to Toolasha format
                    const toolashaListing = {
                        id: etListing.id,
                        timestamp: new Date(etListing.createdTimestamp).getTime(),
                        createdTimestamp: etListing.createdTimestamp,
                        itemHrid: etListing.itemHrid,
                        enhancementLevel: etListing.enhancementLevel || 0,
                        price: etListing.price,
                        orderQuantity: etListing.orderQuantity,
                        filledQuantity: etListing.filledQuantity,
                        isSell: etListing.isSell,
                    };

                    existingListings.push(toolashaListing);
                    imported++;
                }

                // Save to storage
                await storage.setJSON(this.storageKey, existingListings, 'marketListings', true);

                // Remove progress message
                document.body.removeChild(progressMsg);

                // Show success message
                alert(
                    `Import complete!\n\nImported: ${imported} new listings\nSkipped: ${skipped} duplicates\nTotal: ${existingListings.length} listings`
                );

                // Reload and render table
                await this.loadListings();
                this.renderTable();
            } catch (error) {
                console.error('[MarketHistoryViewer] Import error:', error);
                throw error;
            }
        }

        /**
         * Clear all market history data
         */
        async clearHistory() {
            // Strong confirmation dialog
            const confirmed = confirm(
                `⚠️ WARNING: This will permanently delete ALL market history data!\n` +
                    `You are about to delete ${this.listings.length} listings.\n` +
                    `RECOMMENDATION: Export to CSV first using the "Export CSV" button.\n` +
                    `This action CANNOT be undone!\n` +
                    `Are you absolutely sure you want to continue?`
            );

            if (!confirmed) {
                return;
            }

            try {
                // Clear from storage
                await storage.setJSON(this.storageKey, [], 'marketListings', true);

                // Clear local data
                this.listings = [];
                this.filteredListings = [];

                // Show success message
                alert('Market history cleared successfully.');

                // Reload and render table (will show empty state)
                await this.loadListings();
                this.renderTable();
            } catch (error) {
                console.error('[MarketHistoryViewer] Failed to clear history:', error);
                alert(`Failed to clear history: ${error.message}`);
            }
        }

        /**
         * Get filtered listings excluding a specific filter type
         * Used for dynamic filter options - shows what's available given OTHER active filters
         * @param {string} excludeFilterType - Filter to exclude: 'date', 'item', 'enhancementLevel', 'type'
         * @returns {Array} Filtered listings
         */
        getFilteredListingsExcluding(excludeFilterType) {
            let filtered = [...this.listings];

            // Apply legacy type filter if set
            if (this.typeFilter === 'buy') {
                filtered = filtered.filter((listing) => !listing.isSell);
            } else if (this.typeFilter === 'sell') {
                filtered = filtered.filter((listing) => listing.isSell);
            }

            // Apply search term
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                filtered = filtered.filter((listing) => {
                    const itemName = this.getItemName(listing.itemHrid).toLowerCase();
                    return itemName.includes(term);
                });
            }

            // Apply date range filter (unless excluded)
            if (excludeFilterType !== 'date' && (this.filters.dateFrom || this.filters.dateTo)) {
                filtered = filtered.filter((listing) => {
                    const listingDate = new Date(listing.createdTimestamp || listing.timestamp);

                    if (this.filters.dateFrom && listingDate < this.filters.dateFrom) {
                        return false;
                    }

                    if (this.filters.dateTo) {
                        const endOfDay = new Date(this.filters.dateTo);
                        endOfDay.setHours(23, 59, 59, 999);
                        if (listingDate > endOfDay) {
                            return false;
                        }
                    }

                    return true;
                });
            }

            // Apply item filter (unless excluded)
            if (excludeFilterType !== 'item' && this.filters.selectedItems.length > 0) {
                filtered = filtered.filter((listing) => this.filters.selectedItems.includes(listing.itemHrid));
            }

            // Apply enhancement level filter (unless excluded)
            if (excludeFilterType !== 'enhancementLevel' && this.filters.selectedEnhLevels.length > 0) {
                filtered = filtered.filter((listing) => this.filters.selectedEnhLevels.includes(listing.enhancementLevel));
            }

            // Apply type filter (unless excluded)
            if (
                excludeFilterType !== 'type' &&
                this.filters.selectedTypes.length > 0 &&
                this.filters.selectedTypes.length < 2
            ) {
                const showBuy = this.filters.selectedTypes.includes('buy');
                const showSell = this.filters.selectedTypes.includes('sell');

                filtered = filtered.filter((listing) => {
                    if (showBuy && !listing.isSell) return true;
                    if (showSell && listing.isSell) return true;
                    return false;
                });
            }

            return filtered;
        }

        /**
         * Check if a column has an active filter
         * @param {string} columnKey - Column key to check
         * @returns {boolean} True if filter is active
         */
        hasActiveFilter(columnKey) {
            switch (columnKey) {
                case 'createdTimestamp':
                    return this.filters.dateFrom !== null || this.filters.dateTo !== null;
                case 'itemHrid':
                    return this.filters.selectedItems.length > 0;
                case 'enhancementLevel':
                    return this.filters.selectedEnhLevels.length > 0;
                case 'isSell':
                    return this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2;
                default:
                    return false;
            }
        }

        /**
         * Show filter popup for a column
         * @param {string} columnKey - Column key
         * @param {HTMLElement} buttonElement - Button that triggered popup
         */
        showFilterPopup(columnKey, buttonElement) {
            // If clicking the same button that opened the current popup, close it (toggle behavior)
            if (this.activeFilterPopup && this.activeFilterButton === buttonElement) {
                this.activeFilterPopup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
                if (this.popupCloseHandler) {
                    document.removeEventListener('click', this.popupCloseHandler);
                    this.popupCloseHandler = null;
                }
                return;
            }

            // Close any existing popup and remove its event listener
            if (this.activeFilterPopup) {
                this.activeFilterPopup.remove();
                this.activeFilterPopup = null;
            }
            if (this.popupCloseHandler) {
                document.removeEventListener('click', this.popupCloseHandler);
                this.popupCloseHandler = null;
            }

            // Create popup based on column type
            let popup;
            switch (columnKey) {
                case 'createdTimestamp':
                    popup = this.createDateFilterPopup();
                    break;
                case 'itemHrid':
                    popup = this.createItemFilterPopup();
                    break;
                case 'enhancementLevel':
                    popup = this.createEnhancementFilterPopup();
                    break;
                case 'isSell':
                    popup = this.createTypeFilterPopup();
                    break;
                default:
                    return;
            }

            // Position popup below button
            const buttonRect = buttonElement.getBoundingClientRect();
            popup.style.position = 'fixed';
            popup.style.top = `${buttonRect.bottom + 5}px`;
            popup.style.left = `${buttonRect.left}px`;
            popup.style.zIndex = '10002';

            document.body.appendChild(popup);
            this.activeFilterPopup = popup;
            this.activeFilterButton = buttonElement; // Track which button opened this popup

            // Close popup when clicking outside
            this.popupCloseHandler = (e) => {
                // Don't close if clicking on date inputs or their calendar pickers
                if (e.target.type === 'date' || e.target.closest('input[type="date"]')) {
                    return;
                }

                if (!popup.contains(e.target) && e.target !== buttonElement) {
                    popup.remove();
                    this.activeFilterPopup = null;
                    this.activeFilterButton = null;
                    document.removeEventListener('click', this.popupCloseHandler);
                    this.popupCloseHandler = null;
                }
            };
            const popupTimeout = setTimeout(() => document.addEventListener('click', this.popupCloseHandler), 10);
            this.timerRegistry.registerTimeout(popupTimeout);
        }

        /**
         * Create date filter popup
         * @returns {HTMLElement} Popup element
         */
        createDateFilterPopup() {
            const popup = document.createElement('div');
            popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 250px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Title
            const title = document.createElement('div');
            title.textContent = 'Filter by Date';
            title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
            popup.appendChild(title);

            // Get date range from filtered listings (excluding date filter itself)
            // Cache the result to avoid recalculating on every popup open
            if (!this.cachedDateRange) {
                const filteredListings = this.getFilteredListingsExcluding('date');

                if (filteredListings.length > 0) {
                    // Use timestamps directly to avoid creating Date objects unnecessarily
                    const timestamps = filteredListings.map((l) => l.timestamp || new Date(l.createdTimestamp).getTime());
                    this.cachedDateRange = {
                        minDate: new Date(Math.min(...timestamps)),
                        maxDate: new Date(Math.max(...timestamps)),
                    };
                } else {
                    this.cachedDateRange = { minDate: null, maxDate: null };
                }
            }

            const { minDate, maxDate } = this.cachedDateRange;

            if (minDate && maxDate) {
                // Show available date range
                const rangeInfo = document.createElement('div');
                rangeInfo.style.cssText = `
                color: #aaa;
                font-size: 11px;
                margin-bottom: 10px;
                padding: 6px;
                background: #1a1a1a;
                border-radius: 3px;
            `;
                rangeInfo.textContent = `Available: ${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
                popup.appendChild(rangeInfo);
            }

            // From date
            const fromLabel = document.createElement('label');
            fromLabel.textContent = 'From:';
            fromLabel.style.cssText = `
            display: block;
            color: #aaa;
            margin-bottom: 4px;
            font-size: 12px;
        `;

            const fromInput = document.createElement('input');
            fromInput.type = 'date';
            fromInput.value = this.filters.dateFrom ? this.filters.dateFrom.toISOString().split('T')[0] : '';
            if (minDate) fromInput.min = minDate.toISOString().split('T')[0];
            if (maxDate) fromInput.max = maxDate.toISOString().split('T')[0];
            fromInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 10px;
        `;

            // To date
            const toLabel = document.createElement('label');
            toLabel.textContent = 'To:';
            toLabel.style.cssText = `
            display: block;
            color: #aaa;
            margin-bottom: 4px;
            font-size: 12px;
        `;

            const toInput = document.createElement('input');
            toInput.type = 'date';
            toInput.value = this.filters.dateTo ? this.filters.dateTo.toISOString().split('T')[0] : '';
            if (minDate) toInput.min = minDate.toISOString().split('T')[0];
            if (maxDate) toInput.max = maxDate.toISOString().split('T')[0];
            toInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 10px;
        `;

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 10px;
        `;

            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply';
            applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            applyBtn.addEventListener('click', () => {
                this.filters.dateFrom = fromInput.value ? new Date(fromInput.value) : null;
                this.filters.dateTo = toInput.value ? new Date(toInput.value) : null;
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            clearBtn.addEventListener('click', () => {
                this.filters.dateFrom = null;
                this.filters.dateTo = null;
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            buttonContainer.appendChild(applyBtn);
            buttonContainer.appendChild(clearBtn);

            popup.appendChild(fromLabel);
            popup.appendChild(fromInput);
            popup.appendChild(toLabel);
            popup.appendChild(toInput);
            popup.appendChild(buttonContainer);

            return popup;
        }

        /**
         * Create item filter popup
         * @returns {HTMLElement} Popup element
         */
        createItemFilterPopup() {
            const popup = document.createElement('div');
            popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 300px;
            max-height: 400px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Title
            const title = document.createElement('div');
            title.textContent = 'Filter by Item';
            title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
            popup.appendChild(title);

            // Search box
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search items...';
            searchInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 8px;
        `;

            popup.appendChild(searchInput);

            // Get unique items from filtered listings (excluding item filter itself)
            const filteredListings = this.getFilteredListingsExcluding('item');
            const itemHrids = [...new Set(filteredListings.map((l) => l.itemHrid))];
            const itemsWithNames = itemHrids.map((hrid) => ({
                hrid,
                name: this.getItemName(hrid),
            }));
            itemsWithNames.sort((a, b) => a.name.localeCompare(b.name));

            // Checkboxes container
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            margin-bottom: 10px;
            max-height: 250px;
        `;

            const renderCheckboxes = (filterText = '') => {
                // Explicitly remove all children to ensure proper cleanup
                while (checkboxContainer.firstChild) {
                    checkboxContainer.removeChild(checkboxContainer.firstChild);
                }

                const filtered = filterText
                    ? itemsWithNames.filter((item) => item.name.toLowerCase().includes(filterText.toLowerCase()))
                    : itemsWithNames;

                filtered.forEach((item) => {
                    const label = document.createElement('label');
                    label.style.cssText = `
                    display: block;
                    color: #fff;
                    padding: 4px;
                    cursor: pointer;
                `;

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = this.filters.selectedItems.includes(item.hrid);
                    checkbox.style.marginRight = '6px';

                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode(item.name));
                    checkboxContainer.appendChild(label);

                    checkbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            if (!this.filters.selectedItems.includes(item.hrid)) {
                                this.filters.selectedItems.push(item.hrid);
                            }
                        } else {
                            const index = this.filters.selectedItems.indexOf(item.hrid);
                            if (index > -1) {
                                this.filters.selectedItems.splice(index, 1);
                            }
                        }
                    });
                });
            };

            renderCheckboxes();
            searchInput.addEventListener('input', (e) => renderCheckboxes(e.target.value));

            popup.appendChild(checkboxContainer);

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply';
            applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            applyBtn.addEventListener('click', () => {
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            clearBtn.addEventListener('click', () => {
                this.filters.selectedItems = [];
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            buttonContainer.appendChild(applyBtn);
            buttonContainer.appendChild(clearBtn);
            popup.appendChild(buttonContainer);

            return popup;
        }

        /**
         * Create enhancement level filter popup
         * @returns {HTMLElement} Popup element
         */
        createEnhancementFilterPopup() {
            const popup = document.createElement('div');
            popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Title
            const title = document.createElement('div');
            title.textContent = 'Filter by Enhancement Level';
            title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
            popup.appendChild(title);

            // Get unique enhancement levels from filtered listings (excluding enhancement filter itself)
            const filteredListings = this.getFilteredListingsExcluding('enhancementLevel');
            const enhLevels = [...new Set(filteredListings.map((l) => l.enhancementLevel))];
            enhLevels.sort((a, b) => a - b);

            // Checkboxes
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.cssText = `
            max-height: 250px;
            overflow-y: auto;
            margin-bottom: 10px;
        `;

            enhLevels.forEach((level) => {
                const label = document.createElement('label');
                label.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
            `;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = this.filters.selectedEnhLevels.includes(level);
                checkbox.style.marginRight = '6px';

                const levelText = level > 0 ? `+${level}` : 'No Enhancement';

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(levelText));
                checkboxContainer.appendChild(label);

                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!this.filters.selectedEnhLevels.includes(level)) {
                            this.filters.selectedEnhLevels.push(level);
                        }
                    } else {
                        const index = this.filters.selectedEnhLevels.indexOf(level);
                        if (index > -1) {
                            this.filters.selectedEnhLevels.splice(index, 1);
                        }
                    }
                });
            });

            popup.appendChild(checkboxContainer);

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply';
            applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            applyBtn.addEventListener('click', () => {
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            clearBtn.addEventListener('click', () => {
                this.filters.selectedEnhLevels = [];
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            buttonContainer.appendChild(applyBtn);
            buttonContainer.appendChild(clearBtn);
            popup.appendChild(buttonContainer);

            return popup;
        }

        /**
         * Create type filter popup (Buy/Sell)
         * @returns {HTMLElement} Popup element
         */
        createTypeFilterPopup() {
            const popup = document.createElement('div');
            popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 150px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

            // Title
            const title = document.createElement('div');
            title.textContent = 'Filter by Type';
            title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
            popup.appendChild(title);

            // Check which types exist in filtered listings (excluding type filter itself)
            const filteredListings = this.getFilteredListingsExcluding('type');
            const hasBuyOrders = filteredListings.some((l) => !l.isSell);
            const hasSellOrders = filteredListings.some((l) => l.isSell);

            // Buy checkbox
            if (hasBuyOrders) {
                const buyLabel = document.createElement('label');
                buyLabel.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
                margin-bottom: 6px;
            `;

                const buyCheckbox = document.createElement('input');
                buyCheckbox.type = 'checkbox';
                buyCheckbox.checked = this.filters.selectedTypes.includes('buy');
                buyCheckbox.style.marginRight = '6px';

                buyLabel.appendChild(buyCheckbox);
                buyLabel.appendChild(document.createTextNode('Buy Orders'));
                popup.appendChild(buyLabel);

                buyCheckbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!this.filters.selectedTypes.includes('buy')) {
                            this.filters.selectedTypes.push('buy');
                        }
                    } else {
                        const index = this.filters.selectedTypes.indexOf('buy');
                        if (index > -1) {
                            this.filters.selectedTypes.splice(index, 1);
                        }
                    }
                });
            }

            // Sell checkbox
            if (hasSellOrders) {
                const sellLabel = document.createElement('label');
                sellLabel.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
            `;

                const sellCheckbox = document.createElement('input');
                sellCheckbox.type = 'checkbox';
                sellCheckbox.checked = this.filters.selectedTypes.includes('sell');
                sellCheckbox.style.marginRight = '6px';

                sellLabel.appendChild(sellCheckbox);
                sellLabel.appendChild(document.createTextNode('Sell Orders'));
                popup.appendChild(sellLabel);

                sellCheckbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!this.filters.selectedTypes.includes('sell')) {
                            this.filters.selectedTypes.push('sell');
                        }
                    } else {
                        const index = this.filters.selectedTypes.indexOf('sell');
                        if (index > -1) {
                            this.filters.selectedTypes.splice(index, 1);
                        }
                    }
                });
            }

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 10px;
        `;

            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply';
            applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            applyBtn.addEventListener('click', () => {
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
            clearBtn.addEventListener('click', () => {
                this.filters.selectedTypes = [];
                this.saveFilters();
                this.applyFilters();
                this.renderTable();
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            });

            buttonContainer.appendChild(applyBtn);
            buttonContainer.appendChild(clearBtn);
            popup.appendChild(buttonContainer);

            return popup;
        }

        /**
         * Clear all active filters
         */
        async clearAllFilters() {
            this.filters.dateFrom = null;
            this.filters.dateTo = null;
            this.filters.selectedItems = [];
            this.filters.selectedEnhLevels = [];
            this.filters.selectedTypes = [];

            await this.saveFilters();
            this.applyFilters();
            this.renderTable();
        }

        /**
         * Disable the feature
         */
        disable() {
            // Note: We don't need to disconnect observer since we're using the shared settings UI observer

            // Clean up any active filter popup and its event listener
            if (this.activeFilterPopup) {
                this.activeFilterPopup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
            }
            if (this.popupCloseHandler) {
                document.removeEventListener('click', this.popupCloseHandler);
                this.popupCloseHandler = null;
            }

            this.timerRegistry.clearAll();

            // Remove modal and all its event listeners
            if (this.modal) {
                this.modal.remove();
                this.modal = null;
            }

            // Remove settings button
            const button = document.querySelector('.mwi-market-history-button');
            if (button) {
                button.remove();
            }

            // Clear data references
            this.listings = [];
            this.filteredListings = [];
            this.cachedDateRange = null;

            this.isInitialized = false;
        }
    }

    const marketHistoryViewer = new MarketHistoryViewer();

    /**
     * Philosopher's Stone Transmutation Calculator
     *
     * Calculates expected value and ROI for transmuting items into Philosopher's Stones.
     * Shows a sortable table of all items that can transmute into philos with live market data.
     */


    const PHILO_HRID = '/items/philosophers_stone';
    const PRIME_CATALYST_HRID = '/items/prime_catalyst';
    const PRIME_CATALYST_ADDITIVE_BONUS = 0.25; // 25% additive boost
    const TRANSMUTE_ACTION_TIME_SECONDS = 20;
    const CATALYTIC_TEA_BUFF_TYPE = '/buff_types/alchemy_success';

    class PhiloCalculator {
        constructor() {
            this.isInitialized = false;
            this.modal = null;
            this.sortColumn = 'cost';
            this.sortDirection = 'desc';

            // User-editable inputs
            this.philoPrice = 0;
            this.catalystPrice = 0;
            this.useCatalyst = true;
            this.useCatalyticTea = false;
            this.catalyticTeaRatioBoost = 0;
            this.drinkConcentrationLevel = 0; // 0-20
            this.hideNegativeProfitItems = true;
            this.filterText = '';

            // Cached row data
            this.rows = [];
        }

        /**
         * Initialize the feature
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_showPhiloCalculator')) {
                return;
            }

            this.isInitialized = true;
            this.addSettingsButton();
        }

        /**
         * Disable / cleanup the feature
         */
        disable() {
            if (this.modal) {
                this.modal.remove();
                this.modal = null;
            }
            this.isInitialized = false;
        }

        /**
         * Add "Philo Gamba" button to settings panel
         */
        addSettingsButton() {
            const ensureButtonExists = () => {
                const settingsPanel = document.querySelector('[class*="SettingsPanel"]');
                if (!settingsPanel) return;

                if (settingsPanel.querySelector('.mwi-philo-calc-button')) {
                    return;
                }

                const button = document.createElement('button');
                button.className = 'mwi-philo-calc-button';
                button.textContent = 'Philo Gamba';
                button.style.cssText = `
                margin: 10px;
                padding: 8px 16px;
                background: #4a90e2;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            `;

                button.addEventListener('mouseenter', () => {
                    button.style.background = '#357abd';
                });

                button.addEventListener('mouseleave', () => {
                    button.style.background = '#4a90e2';
                });

                button.addEventListener('click', () => {
                    this.openModal();
                });

                // Insert after the market history button if it exists, otherwise at top
                const historyButton = settingsPanel.querySelector('.mwi-market-history-button');
                if (historyButton) {
                    historyButton.after(button);
                } else {
                    settingsPanel.insertBefore(button, settingsPanel.firstChild);
                }
            };

            const settingsUI = window.Toolasha?.UI?.settingsUI;
            if (settingsUI && typeof settingsUI.onSettingsPanelAppear === 'function') {
                settingsUI.onSettingsPanelAppear(ensureButtonExists);
            }

            ensureButtonExists();
        }

        /**
         * Get item name from game data
         * @param {string} itemHrid - Item HRID
         * @returns {string} Item name
         */
        getItemName(itemHrid) {
            const initData = dataManager.getInitClientData();
            const itemData = initData?.itemDetailMap?.[itemHrid];
            return itemData?.name || itemHrid.replace('/items/', '').replaceAll('_', ' ');
        }

        /**
         * Load default prices from market data
         */
        loadDefaultPrices() {
            const philoPriceData = marketAPI.getPrice(PHILO_HRID, 0);
            this.philoPrice = philoPriceData?.bid || 0;

            const catalystPriceData = marketAPI.getPrice(PRIME_CATALYST_HRID, 0);
            this.catalystPrice = catalystPriceData?.ask || 0;
        }

        /**
         * Calculate catalytic tea base bonus from game data (item definition)
         * @returns {number} Base ratioBoost from item definition
         */
        calculateCatalyticTeaRatioBoost() {
            try {
                const gameData = dataManager.getInitClientData();
                if (!gameData?.itemDetailMap) return 0;

                const teaItem = gameData.itemDetailMap['/items/catalytic_tea'];
                if (!teaItem?.consumableDetail?.buffs) return 0;

                // Find alchemy success buff
                for (const buff of teaItem.consumableDetail.buffs) {
                    if (buff.typeHrid === CATALYTIC_TEA_BUFF_TYPE) {
                        return buff.ratioBoost || 0;
                    }
                }

                return 0;
            } catch (error) {
                console.error('[PhiloCalculator] Failed to calculate catalytic tea ratio boost:', error);
                return 0;
            }
        }

        /**
         * Load settings from storage
         */
        async loadSettings() {
            try {
                const saved = await storage.getJSON('philoCalculatorSettings', 'settings', null);
                if (saved) {
                    this.useCatalyst = saved.useCatalyst !== false;
                    this.useCatalyticTea = saved.useCatalyticTea || false;
                    this.drinkConcentrationLevel = saved.drinkConcentrationLevel || 0;
                    this.hideNegativeProfitItems = saved.hideNegativeProfitItems !== false;
                    this.filterText = saved.filterText || '';
                }
            } catch (error) {
                console.error('[PhiloCalculator] Failed to load settings:', error);
            }
        }

        /**
         * Save settings to storage
         */
        async saveSettings() {
            try {
                await storage.setJSON(
                    'philoCalculatorSettings',
                    {
                        useCatalyst: this.useCatalyst,
                        useCatalyticTea: this.useCatalyticTea,
                        drinkConcentrationLevel: this.drinkConcentrationLevel,
                        hideNegativeProfitItems: this.hideNegativeProfitItems,
                        filterText: this.filterText,
                    },
                    'settings',
                    true
                );
            } catch (error) {
                console.error('[PhiloCalculator] Failed to save settings:', error);
            }
        }

        /**
         * Get drink concentration for a given enhancement level
         * @param {number} enhancementLevel - Enhancement level (0-20)
         * @returns {number} Drink concentration as decimal (e.g., 0.1032 for 10.32%)
         */
        getDrinkConcentrationForLevel(enhancementLevel) {
            try {
                const gameData = dataManager.getInitClientData();
                const equipment = dataManager.getEquipment();
                if (!equipment || !gameData?.itemDetailMap) return 0;

                let totalConcentration = 0;
                const baseConcentrationByLevel = new Map();

                // Scan equipment for drink concentration items and their base values
                for (const [_slotHrid, equippedItem] of equipment) {
                    const itemDetails = gameData.itemDetailMap[equippedItem.itemHrid];
                    if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

                    const baseConcentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
                    baseConcentrationByLevel.set(equippedItem.itemHrid, baseConcentration);
                }

                // If we have drink concentration items, apply the requested enhancement level
                for (const [itemHrid, baseConcentration] of baseConcentrationByLevel) {
                    const itemDetails = gameData.itemDetailMap[itemHrid];
                    const multiplier = enhancementMultipliers_js.getEnhancementMultiplier(itemDetails, enhancementLevel);
                    totalConcentration += baseConcentration * multiplier;
                }

                return totalConcentration;
            } catch (error) {
                console.error('[PhiloCalculator] Failed to get drink concentration:', error);
                return 0;
            }
        }

        /**
         * Scan itemDetailMap for all items that can transmute into Philosopher's Stone
         * @returns {Array} Array of { itemHrid, itemDetails } objects
         */
        findPhiloTransmuteItems() {
            const gameData = dataManager.getInitClientData();
            if (!gameData?.itemDetailMap) return [];

            const results = [];

            for (const [itemHrid, itemDetails] of Object.entries(gameData.itemDetailMap)) {
                const alchemy = itemDetails?.alchemyDetail;
                if (!alchemy?.transmuteDropTable || !alchemy.transmuteSuccessRate) continue;

                const hasPhilo = alchemy.transmuteDropTable.some((drop) => drop.itemHrid === PHILO_HRID);
                if (hasPhilo) {
                    results.push({ itemHrid, itemDetails });
                }
            }

            return results;
        }

        /**
         * Calculate all columns for a single item
         * @param {string} itemHrid - Item HRID
         * @param {Object} itemDetails - Item detail object
         * @returns {Object|null} Row data or null if price unavailable
         */
        calculateRow(itemHrid, itemDetails) {
            const alchemy = itemDetails.alchemyDetail;
            const baseTransmuteRate = alchemy.transmuteSuccessRate;

            // Calculate additive bonuses
            let totalBonus = 0;

            // Catalytic tea bonus
            if (this.useCatalyticTea && this.catalyticTeaRatioBoost > 0) {
                const drinkConcentration = this.getDrinkConcentrationForLevel(this.drinkConcentrationLevel);
                totalBonus += this.catalyticTeaRatioBoost * (1 + drinkConcentration);
            }

            // Prime catalyst bonus (additive, not multiplicative)
            if (this.useCatalyst) {
                totalBonus += PRIME_CATALYST_ADDITIVE_BONUS;
            }

            const successRate = Math.min(1.0, baseTransmuteRate * (1 + totalBonus));
            const bulkMultiplier = alchemy.bulkMultiplier || 1;

            // Find philo drop rate
            const philoDrop = alchemy.transmuteDropTable.find((d) => d.itemHrid === PHILO_HRID);
            if (!philoDrop) return null;

            const philoDropRate = philoDrop.dropRate;
            const philoChance = successRate * philoDropRate;

            // Get item cost (market ask price)
            const priceData = marketAPI.getPrice(itemHrid, 0);
            const itemCost = priceData?.ask;
            if (itemCost === null || itemCost === undefined) return null;

            // Catalyst cost per action (consumed only on success)
            const catalystCostPerAction = this.useCatalyst ? successRate * this.catalystPrice : 0;

            // Transmute coin cost from game data
            const gameData = dataManager.getInitClientData();
            const transmuteAction = gameData?.actionDetailMap?.['/actions/alchemy/transmute'];
            const coinCost = transmuteAction?.coinCost || 0;

            // Total cost per transmute action
            const totalCostPerAction = itemCost * bulkMultiplier + catalystCostPerAction + coinCost;

            // Calculate EV of all drops (including philo)
            let evPerAction = 0;
            for (const drop of alchemy.transmuteDropTable) {
                let dropValue;
                if (drop.itemHrid === PHILO_HRID) {
                    dropValue = this.philoPrice;
                } else {
                    const dropPrice = marketAPI.getPrice(drop.itemHrid, 0);
                    dropValue = dropPrice?.bid;
                    if (dropValue === null || dropValue === undefined) continue;
                }

                const avgCount = (drop.minCount + drop.maxCount) / 2;
                evPerAction += successRate * drop.dropRate * avgCount * dropValue;
            }

            // Profit per action (EV now includes philo value)
            const profitPerAction = evPerAction - totalCostPerAction;

            // Actions and items needed per philo
            const actionsPerPhilo = 1 / philoChance;

            // Net items consumed per action (input minus expected self-returns)
            const selfDrop = alchemy.transmuteDropTable.find((d) => d.itemHrid === itemHrid);
            const selfDropRate = selfDrop ? selfDrop.dropRate : 0;
            const avgSelfCount = selfDrop ? (selfDrop.minCount + selfDrop.maxCount) / 2 : 0;
            const returnChance = successRate * selfDropRate;
            const itemsPerAction = bulkMultiplier - returnChance * avgSelfCount;

            // Items needed per philo (net items consumed × actions needed)
            const itemsPerPhilo = actionsPerPhilo * itemsPerAction;

            // Profit per philo obtained
            const profitPerPhilo = profitPerAction * actionsPerPhilo;

            // Profit margin
            const profitMargin = profitPerAction / totalCostPerAction;

            // Time per philo
            const timePerPhiloSeconds = actionsPerPhilo * TRANSMUTE_ACTION_TIME_SECONDS;

            // Profit per hour
            const actionsPerHour = 3600 / TRANSMUTE_ACTION_TIME_SECONDS;
            const profitPerHour = profitPerAction * actionsPerHour;

            // Revenue and cost per hour
            const revenuePerHour = evPerAction * actionsPerHour;
            const costPerHour = totalCostPerAction * actionsPerHour;

            return {
                itemHrid,
                name: this.getItemName(itemHrid),
                cost: itemCost,
                philoChance,
                returnChance,
                transmuteChance: baseTransmuteRate,
                effectiveTransmuteChance: successRate,
                transmuteCost: totalCostPerAction,
                ev: evPerAction,
                itemsPerAction,
                actionsPerPhilo,
                itemsPerPhilo,
                profitPerPhilo,
                profitMargin,
                timePerPhiloSeconds,
                profitPerHour,
                revenuePerHour,
                costPerHour,
            };
        }

        /**
         * Calculate all rows
         */
        calculateAllRows() {
            const items = this.findPhiloTransmuteItems();
            this.rows = [];

            for (const { itemHrid, itemDetails } of items) {
                const row = this.calculateRow(itemHrid, itemDetails);
                if (row) {
                    this.rows.push(row);
                }
            }

            this.sortRows();
        }

        /**
         * Sort rows by current sort column and direction
         */
        sortRows() {
            const col = this.sortColumn;
            const dir = this.sortDirection === 'asc' ? 1 : -1;

            this.rows.sort((a, b) => {
                const aVal = a[col];
                const bVal = b[col];

                if (typeof aVal === 'string') {
                    return dir * aVal.localeCompare(bVal);
                }
                return dir * (aVal - bVal);
            });
        }

        /**
         * Handle column header click for sorting
         * @param {string} column - Column key to sort by
         */
        toggleSort(column) {
            if (this.sortColumn === column) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortColumn = column;
                this.sortDirection = 'desc';
            }
            this.sortRows();
            this.renderTable();
        }

        /**
         * Open the calculator modal
         */
        async openModal() {
            if (this.modal) {
                this.modal.remove();
            }

            // Load saved settings first
            await this.loadSettings();

            this.loadDefaultPrices();
            this.catalyticTeaRatioBoost = this.calculateCatalyticTeaRatioBoost();

            // Set default drink concentration level (only if not previously saved)
            if (this.drinkConcentrationLevel === 0) {
                let currentDrinkEnhancementLevel = 0;
                const gameData = dataManager.getInitClientData();
                const equipment = dataManager.getEquipment();
                if (equipment && gameData?.itemDetailMap) {
                    for (const [_slotHrid, equippedItem] of equipment) {
                        const itemDetails = gameData.itemDetailMap[equippedItem.itemHrid];
                        if (itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) {
                            currentDrinkEnhancementLevel = equippedItem.enhancementLevel || 0;
                            break;
                        }
                    }
                }
                this.drinkConcentrationLevel = currentDrinkEnhancementLevel;
            }

            this.calculateAllRows();

            this.modal = document.createElement('div');
            this.modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
            background: #2a2a2a;
            color: #ffffff;
            border-radius: 8px;
            width: 95%;
            max-width: 1200px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

            // Header
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #444;
        `;
            header.innerHTML = `
            <span style="font-size: 18px; font-weight: bold;">Philosopher's Stone Calculator</span>
        `;

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '\u00D7';
            closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #fff;
            font-size: 24px;
            cursor: pointer;
            padding: 0 4px;
        `;
            closeBtn.addEventListener('click', () => {
                this.modal.remove();
                this.modal = null;
            });
            header.appendChild(closeBtn);

            // Controls
            const controls = this.createControls();

            // Table container
            const tableContainer = document.createElement('div');
            tableContainer.className = 'philo-calc-table-container';
            tableContainer.style.cssText = `
            overflow: auto;
            flex: 1;
            padding: 0 20px 20px;
        `;

            dialog.appendChild(header);
            dialog.appendChild(controls);
            dialog.appendChild(tableContainer);
            this.modal.appendChild(dialog);

            // Close on backdrop click
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.modal.remove();
                    this.modal = null;
                }
            });

            // Close on Escape key
            const escHandler = (e) => {
                if (e.key === 'Escape' && this.modal) {
                    this.modal.remove();
                    this.modal = null;
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            document.body.appendChild(this.modal);
            this.renderTable();
        }

        /**
         * Create the input controls section (philo price, catalyst price, checkbox)
         * @returns {HTMLElement} Controls container
         */
        createControls() {
            const container = document.createElement('div');
            container.style.cssText = `
            padding: 12px 20px;
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
            border-bottom: 1px solid #444;
        `;

            // Philo price input
            const philoLabel = document.createElement('label');
            philoLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
            philoLabel.textContent = 'Philo Price: ';
            const philoInput = document.createElement('input');
            philoInput.type = 'text';
            philoInput.value = this.philoPrice.toLocaleString();
            philoInput.style.cssText = `
            width: 130px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
            philoInput.addEventListener('change', () => {
                const parsed = parseInt(philoInput.value.replaceAll(',', '').replaceAll('.', ''), 10);
                if (!isNaN(parsed)) {
                    this.philoPrice = parsed;
                    this.recalculate();
                }
            });
            philoLabel.appendChild(philoInput);

            // Catalyst price input
            const catLabel = document.createElement('label');
            catLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
            catLabel.textContent = 'Catalyst Price: ';
            const catInput = document.createElement('input');
            catInput.type = 'text';
            catInput.value = this.catalystPrice.toLocaleString();
            catInput.style.cssText = `
            width: 130px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
            catInput.addEventListener('change', () => {
                const parsed = parseInt(catInput.value.replaceAll(',', '').replaceAll('.', ''), 10);
                if (!isNaN(parsed)) {
                    this.catalystPrice = parsed;
                    this.recalculate();
                }
            });
            catLabel.appendChild(catInput);

            // Use catalyst checkbox
            const checkLabel = document.createElement('label');
            checkLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.useCatalyst;
            checkbox.style.cursor = 'pointer';
            checkbox.addEventListener('change', () => {
                this.useCatalyst = checkbox.checked;
                this.recalculate();
                this.saveSettings();
            });
            checkLabel.appendChild(checkbox);
            checkLabel.appendChild(document.createTextNode('Use Prime Catalyst'));

            container.appendChild(philoLabel);
            container.appendChild(catLabel);
            container.appendChild(checkLabel);

            // Catalytic Tea checkbox
            const teaCheckLabel = document.createElement('label');
            teaCheckLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
            const teaCheckbox = document.createElement('input');
            teaCheckbox.type = 'checkbox';
            teaCheckbox.checked = this.useCatalyticTea;
            teaCheckbox.style.cursor = 'pointer';
            teaCheckbox.addEventListener('change', () => {
                this.useCatalyticTea = teaCheckbox.checked;
                this.recalculate();
                this.saveSettings();
            });
            teaCheckLabel.appendChild(teaCheckbox);

            // Display base ratioBoost if available
            const boostText =
                this.catalyticTeaRatioBoost > 0
                    ? ` (${formatters_js.formatPercentage(this.catalyticTeaRatioBoost, 1)})`
                    : ' (unavailable)';
            teaCheckLabel.appendChild(document.createTextNode(`Catalytic Tea${boostText}`));
            container.appendChild(teaCheckLabel);

            // Drink Concentration Dropdown
            const drinkLabel = document.createElement('label');
            drinkLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
            drinkLabel.textContent = 'Drink Concentration: ';
            const drinkSelect = document.createElement('select');
            drinkSelect.style.cssText = `
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;

            // Populate dropdown with enhancement levels +0 through +20
            for (let level = 0; level <= 20; level++) {
                const concentration = this.getDrinkConcentrationForLevel(level);
                const option = document.createElement('option');
                option.value = level;
                option.textContent = `+${level} (${formatters_js.formatPercentage(concentration, 2)})`;
                if (level === this.drinkConcentrationLevel) {
                    option.selected = true;
                }
                drinkSelect.appendChild(option);
            }

            drinkSelect.addEventListener('change', () => {
                this.drinkConcentrationLevel = parseInt(drinkSelect.value, 10);
                this.recalculate();
                this.saveSettings();
            });
            drinkLabel.appendChild(drinkSelect);
            container.appendChild(drinkLabel);

            // Hide negative profit checkbox
            const hideNegCheckLabel = document.createElement('label');
            hideNegCheckLabel.style.cssText =
                'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
            const hideNegCheckbox = document.createElement('input');
            hideNegCheckbox.type = 'checkbox';
            hideNegCheckbox.checked = this.hideNegativeProfitItems;
            hideNegCheckbox.style.cursor = 'pointer';
            hideNegCheckbox.addEventListener('change', () => {
                this.hideNegativeProfitItems = hideNegCheckbox.checked;
                this.renderTable();
                this.saveSettings();
            });
            hideNegCheckLabel.appendChild(hideNegCheckbox);
            hideNegCheckLabel.appendChild(document.createTextNode('Hide Negative Profit'));
            container.appendChild(hideNegCheckLabel);

            // Filter label
            const filterLabel = document.createElement('label');
            filterLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
            filterLabel.textContent = 'Filter: ';
            const filterInput = document.createElement('input');
            filterInput.type = 'text';
            filterInput.placeholder = 'Item name...';
            filterInput.value = this.filterText;
            filterInput.style.cssText = `
            width: 140px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
            filterInput.addEventListener('input', () => {
                this.filterText = filterInput.value;
                this.renderTable();
                this.saveSettings();
            });
            filterLabel.appendChild(filterInput);
            container.appendChild(filterLabel);

            // Refresh prices button
            const refreshBtn = document.createElement('button');
            refreshBtn.textContent = 'Refresh Prices';
            refreshBtn.style.cssText = `
            padding: 4px 12px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        `;
            refreshBtn.addEventListener('mouseenter', () => {
                refreshBtn.style.background = '#357abd';
            });
            refreshBtn.addEventListener('mouseleave', () => {
                refreshBtn.style.background = '#4a90e2';
            });
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Refreshing...';
                refreshBtn.style.opacity = '0.6';
                try {
                    await marketAPI.fetch(true);
                    this.loadDefaultPrices();
                    // Update the price inputs to reflect new data
                    const inputs = container.querySelectorAll('input[type="text"]');
                    if (inputs[0]) inputs[0].value = this.philoPrice.toLocaleString();
                    if (inputs[1]) inputs[1].value = this.catalystPrice.toLocaleString();
                    this.recalculate();
                } catch (error) {
                    console.error('[PhiloCalculator] Failed to refresh prices:', error);
                }
                refreshBtn.disabled = false;
                refreshBtn.textContent = 'Refresh Prices';
                refreshBtn.style.opacity = '1';
            });
            container.appendChild(refreshBtn);

            return container;
        }

        /**
         * Recalculate all rows and re-render
         */
        recalculate() {
            this.calculateAllRows();
            this.renderTable();
        }

        /**
         * Render the results table
         */
        renderTable() {
            const container = this.modal?.querySelector('.philo-calc-table-container');
            if (!container) return;

            const columns = [
                { key: 'name', label: 'Item', align: 'left' },
                { key: 'cost', label: 'Cost' },
                { key: 'philoChance', label: 'Philo %' },
                { key: 'returnChance', label: 'Return %' },
                { key: 'transmuteChance', label: 'Base Xmute %' },
                { key: 'effectiveTransmuteChance', label: 'Eff. Xmute %' },
                { key: 'transmuteCost', label: 'Xmute Cost' },
                { key: 'ev', label: 'EV' },
                { key: 'itemsPerAction', label: 'Items/Act' },
                { key: 'actionsPerPhilo', label: 'Acts/Philo' },
                { key: 'itemsPerPhilo', label: 'Items/Philo' },
                { key: 'profitPerPhilo', label: 'Profit/Philo' },
                { key: 'profitMargin', label: 'Margin' },
                { key: 'timePerPhiloSeconds', label: 'Time/Philo' },
                { key: 'profitPerHour', label: 'Profit/Hr' },
                { key: 'revenuePerHour', label: 'Revenue/Hr' },
                { key: 'costPerHour', label: 'Cost/Hr' },
            ];

            const table = document.createElement('table');
            table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        `;

            // Header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            for (const col of columns) {
                const th = document.createElement('th');
                th.style.cssText = `
                padding: 8px 6px;
                text-align: ${col.align || 'right'};
                border-bottom: 2px solid #555;
                cursor: pointer;
                user-select: none;
                white-space: nowrap;
                position: sticky;
                top: 0;
                background: #2a2a2a;
                z-index: 1;
            `;

                const arrow = this.sortColumn === col.key ? (this.sortDirection === 'asc' ? ' \u25B2' : ' \u25BC') : '';
                th.textContent = col.label + arrow;

                th.addEventListener('click', () => this.toggleSort(col.key));
                headerRow.appendChild(th);
            }

            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');

            // Apply item name filter
            const filterLower = this.filterText.toLowerCase();
            let filteredRows = filterLower
                ? this.rows.filter((row) => row.name.toLowerCase().includes(filterLower))
                : this.rows;

            // Apply negative profit filter
            if (this.hideNegativeProfitItems) {
                filteredRows = filteredRows.filter((row) => row.profitPerPhilo >= 0);
            }

            for (let i = 0; i < filteredRows.length; i++) {
                const row = filteredRows[i];
                const tr = document.createElement('tr');
                const bgColor = i % 2 === 0 ? '#2a2a2a' : '#252525';
                tr.style.cssText = `background: ${bgColor};`;

                for (const col of columns) {
                    const td = document.createElement('td');
                    td.style.cssText = `
                    padding: 6px;
                    text-align: ${col.align || 'right'};
                    white-space: nowrap;
                `;

                    const value = row[col.key];

                    // Format based on column type
                    switch (col.key) {
                        case 'name':
                            td.textContent = value;
                            break;
                        case 'philoChance':
                        case 'returnChance':
                        case 'transmuteChance':
                        case 'effectiveTransmuteChance':
                            td.textContent = formatters_js.formatPercentage(value, 2);
                            break;
                        case 'profitMargin':
                            td.textContent = formatters_js.formatPercentage(value, 1);
                            td.style.color = value >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                            break;
                        case 'timePerPhiloSeconds':
                            td.textContent = formatters_js.timeReadable(value);
                            break;
                        case 'profitPerPhilo':
                        case 'profitPerHour':
                            td.textContent = formatters_js.formatLargeNumber(Math.round(value));
                            td.style.color = value >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                            break;
                        case 'revenuePerHour':
                        case 'costPerHour':
                            td.textContent = formatters_js.formatLargeNumber(Math.round(value));
                            break;
                        case 'actionsPerPhilo':
                        case 'itemsPerPhilo':
                            td.textContent = formatters_js.formatLargeNumber(Math.round(value));
                            break;
                        case 'itemsPerAction':
                            td.textContent = value.toFixed(2);
                            break;
                        default:
                            td.textContent = formatters_js.formatLargeNumber(Math.round(value));
                            break;
                    }

                    tr.appendChild(td);
                }

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);

            container.innerHTML = '';
            container.appendChild(table);
        }
    }

    const philoCalculator = new PhiloCalculator();

    /**
     * Personal Trade History Module
     * Tracks your buy/sell prices for marketplace items
     */


    /**
     * TradeHistory class manages personal buy/sell price tracking
     */
    class TradeHistory {
        constructor() {
            this.history = {}; // itemHrid:enhancementLevel -> { buy, sell }
            this.isInitialized = false;
            this.isLoaded = false;
            this.characterId = null;
            this.marketUpdateHandler = null; // Store handler reference for cleanup
        }

        /**
         * Get character-specific storage key
         * @returns {string} Storage key with character ID suffix
         */
        getStorageKey() {
            if (this.characterId) {
                return `tradeHistory_${this.characterId}`;
            }
            return 'tradeHistory'; // Fallback for no character ID
        }

        /**
         * Setup setting listener for feature toggle
         */
        setupSettingListener() {
            config.onSettingChange('market_tradeHistory', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });
        }

        /**
         * Initialize trade history tracking
         */
        async initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_tradeHistory')) {
                return;
            }

            // Get current character ID
            this.characterId = dataManager.getCurrentCharacterId();

            // Load existing history from storage
            await this.loadHistory();

            this.marketUpdateHandler = (data) => {
                this.handleMarketUpdate(data);
            };

            // Hook into data manager for market listing updates
            dataManager.on('market_listings_updated', this.marketUpdateHandler);

            this.isInitialized = true;
        }

        /**
         * Load trade history from storage
         */
        async loadHistory() {
            try {
                const storageKey = this.getStorageKey();
                const saved = await storage.getJSON(storageKey, 'settings', {});
                this.history = saved || {};
                this.isLoaded = true;
            } catch (error) {
                console.error('[TradeHistory] Failed to load history:', error);
                this.history = {};
                this.isLoaded = true;
            }
        }

        /**
         * Save trade history to storage
         */
        async saveHistory() {
            try {
                const storageKey = this.getStorageKey();
                await storage.setJSON(storageKey, this.history, 'settings', true);
            } catch (error) {
                console.error('[TradeHistory] Failed to save history:', error);
            }
        }

        /**
         * Handle market_listings_updated WebSocket message
         * @param {Object} data - Market update data
         */
        handleMarketUpdate(data) {
            if (!data.endMarketListings) return;

            let hasChanges = false;

            // Process each completed order
            data.endMarketListings.forEach((order) => {
                // Only track orders that actually filled
                if (order.filledQuantity === 0) return;

                const key = `${order.itemHrid}:${order.enhancementLevel}`;

                // Get existing history for this item or create new
                const itemHistory = this.history[key] || {};

                // Update buy or sell price
                if (order.isSell) {
                    itemHistory.sell = order.price;
                } else {
                    itemHistory.buy = order.price;
                }

                this.history[key] = itemHistory;
                hasChanges = true;
            });

            // Save to storage if any changes
            if (hasChanges) {
                this.saveHistory();
            }
        }

        /**
         * Get trade history for a specific item
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level (default 0)
         * @returns {Object|null} { buy, sell } or null if no history
         */
        getHistory(itemHrid, enhancementLevel = 0) {
            const key = `${itemHrid}:${enhancementLevel}`;
            return this.history[key] || null;
        }

        /**
         * Check if history data is loaded
         * @returns {boolean}
         */
        isReady() {
            return this.isLoaded;
        }

        /**
         * Clear all trade history
         */
        async clearHistory() {
            this.history = {};
            await this.saveHistory();
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.marketUpdateHandler) {
                dataManager.off('market_listings_updated', this.marketUpdateHandler);
                this.marketUpdateHandler = null;
            }

            // Don't clear history data, just stop tracking
            this.isInitialized = false;
        }

        /**
         * Handle character switch - clear old data and reinitialize
         */
        async handleCharacterSwitch() {
            // Disable first to clean up old handlers
            this.disable();

            // Clear old character's data from memory
            this.history = {};
            this.isLoaded = false;

            // Reinitialize with new character
            await this.initialize();
        }
    }

    const tradeHistory = new TradeHistory();
    tradeHistory.setupSettingListener();

    // Setup character switch handler
    dataManager.on('character_switched', () => {
        if (config.getSetting('market_tradeHistory')) {
            tradeHistory.handleCharacterSwitch();
        }
    });

    /**
     * Trade History Display Module
     * Shows your last buy/sell prices in the marketplace panel
     */


    class TradeHistoryDisplay {
        constructor() {
            this.isActive = false;
            this.unregisterObserver = null;
            this.unregisterWebSocket = null;
            this.currentItemHrid = null;
            this.currentEnhancementLevel = 0;
            this.currentOrderBookData = null;
            this.isInitialized = false;
            this.needsPriceDataRetry = false; // Track if we need to retry due to missing price data
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('market_tradeHistory')) {
                return;
            }

            this.isInitialized = true;
            this.setupWebSocketListener();
            this.setupSettingListener();
            this.isActive = true;
        }

        /**
         * Setup setting change listener to refresh display when comparison mode changes
         */
        setupSettingListener() {
            config.onSettingChange('market_tradeHistoryComparisonMode', () => {
                // Refresh display if currently viewing an item
                if (this.currentItemHrid) {
                    const history = tradeHistory.getHistory(this.currentItemHrid, this.currentEnhancementLevel);
                    this.updateDisplay(null, history);
                }
            });
        }

        /**
         * Setup WebSocket listener for order book updates
         */
        setupWebSocketListener() {
            const orderBookHandler = (data) => {
                if (data.marketItemOrderBooks) {
                    // Store order book data for current item
                    this.currentOrderBookData = data.marketItemOrderBooks;

                    // Extract item info from WebSocket data
                    const itemHrid = data.marketItemOrderBooks.itemHrid;

                    // Get enhancement level from DOM
                    const enhancementLevel = this.getCurrentEnhancementLevel();

                    // Check if this is a different item
                    if (itemHrid === this.currentItemHrid && enhancementLevel === this.currentEnhancementLevel) {
                        // Only update if we previously failed due to missing price data
                        if (!this.needsPriceDataRetry) {
                            return;
                        }
                    }

                    // Update tracking
                    this.currentItemHrid = itemHrid;
                    this.currentEnhancementLevel = enhancementLevel;

                    // Get trade history for this item
                    const history = tradeHistory.getHistory(itemHrid, enhancementLevel);

                    // Update display (pass null for panel since we don't use it)
                    this.updateDisplay(null, history);
                }
            };

            dataManager.on('market_item_order_books_updated', orderBookHandler);

            // Store unregister function for cleanup
            this.unregisterWebSocket = () => {
                dataManager.off('market_item_order_books_updated', orderBookHandler);
            };
        }

        /**
         * Get current enhancement level being viewed in order book
         * @returns {number} Enhancement level (0 for non-equipment)
         */
        getCurrentEnhancementLevel() {
            // Check for enhancement level indicator in the current item display
            const currentItemElement = document.querySelector('[class*="MarketplacePanel_currentItem"]');
            if (currentItemElement) {
                const enhancementElement = currentItemElement.querySelector('[class*="Item_enhancementLevel"]');
                if (enhancementElement) {
                    const match = enhancementElement.textContent.match(/\+(\d+)/);
                    if (match) {
                        return parseInt(match[1], 10);
                    }
                }
            }

            // Default to enhancement level 0 (non-equipment or base equipment)
            return 0;
        }

        /**
         * Update trade history display
         * @param {HTMLElement} panel - Current item panel (unused, kept for signature compatibility)
         * @param {Object|null} history - Trade history { buy, sell } or null
         */
        updateDisplay(panel, history) {
            // Remove existing display
            const existing = document.querySelectorAll('.mwi-trade-history');
            existing.forEach((el) => el.remove());

            // Don't show anything if no history
            if (!history || (!history.buy && !history.sell)) {
                return;
            }

            // Get current top order prices from the DOM
            const currentPrices = this.extractCurrentPrices(panel);

            // Don't show display if we don't have current prices yet
            if (!currentPrices) {
                this.needsPriceDataRetry = true;
                return;
            }

            // Get comparison mode setting
            const comparisonMode = config.getSettingValue('market_tradeHistoryComparisonMode', 'instant');

            // Find the button container - it's outside the currentItem panel
            // Search in the entire document since button container is at a higher level
            const buttonContainer = document.querySelector('[class*="MarketplacePanel_marketNavButtonContainer"]');
            if (!buttonContainer) {
                return;
            }

            // Create history display
            const historyDiv = document.createElement('div');
            historyDiv.className = 'mwi-trade-history';

            historyDiv.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-left: 12px;
            font-size: 0.85rem;
            color: #888;
            padding: 6px 12px;
            background: rgba(0,0,0,0.8);
            border-radius: 4px;
            white-space: nowrap;
        `;

            // Build content
            const parts = [];
            parts.push(`<span style="color: #aaa; font-weight: 500;">Last:</span>`);

            if (history.buy) {
                const buyColor = this.getBuyColor(history.buy, currentPrices, comparisonMode);
                parts.push(
                    `<span style="color: ${buyColor}; font-weight: 600;" title="Your last buy price">Buy ${formatters_js.formatKMB3Digits(history.buy)}</span>`
                );
            }

            if (history.buy && history.sell) {
                parts.push(`<span style="color: #555;">|</span>`);
            }

            if (history.sell) {
                const sellColor = this.getSellColor(history.sell, currentPrices, comparisonMode);
                parts.push(
                    `<span style="color: ${sellColor}; font-weight: 600;" title="Your last sell price">Sell ${formatters_js.formatKMB3Digits(history.sell)}</span>`
                );
            }

            historyDiv.innerHTML = parts.join('');

            // Append to button container
            buttonContainer.appendChild(historyDiv);

            // Clear retry flag since we successfully displayed
            this.needsPriceDataRetry = false;
        }

        /**
         * Extract current top order prices from WebSocket order book data
         * @param {HTMLElement} panel - Current item panel (unused, kept for signature compatibility)
         * @returns {Object|null} { ask, bid } or null
         */
        extractCurrentPrices(_panel) {
            // Use WebSocket order book data instead of DOM scraping
            if (!this.currentOrderBookData || !this.currentOrderBookData.orderBooks) {
                return null;
            }

            // Get current enhancement level to find correct order book
            const enhancementLevel = this.getCurrentEnhancementLevel();

            // orderBooks is an array indexed by enhancement level
            const orderBook = this.currentOrderBookData.orderBooks[enhancementLevel];
            if (!orderBook) {
                return null;
            }

            // Extract top ask (lowest sell price) and top bid (highest buy price)
            const topAsk = orderBook.asks?.[0]?.price;
            const topBid = orderBook.bids?.[0]?.price;

            // Validate prices exist and are positive
            if (!topAsk || topAsk <= 0 || !topBid || topBid <= 0) {
                return null;
            }

            return {
                ask: topAsk,
                bid: topBid,
            };
        }

        /**
         * Get color for buy price based on comparison mode
         * @param {number} lastBuy - Your last buy price
         * @param {Object|null} currentPrices - Current market prices { ask, bid }
         * @param {string} comparisonMode - 'instant' or 'listing'
         * @returns {string} Color code
         */
        getBuyColor(lastBuy, currentPrices, comparisonMode) {
            if (!currentPrices) {
                return '#888'; // Grey if no market data
            }

            // Choose comparison price based on mode
            const comparePrice = comparisonMode === 'instant' ? currentPrices.ask : currentPrices.bid;

            if (!comparePrice || comparePrice === -1) {
                return '#888'; // Grey if no market data
            }

            if (comparisonMode === 'instant') {
                // Instant mode: Compare to ask (what you'd pay to instant-buy now)
                if (comparePrice > lastBuy) {
                    return config.COLOR_LOSS; // Red - would pay more now
                } else if (comparePrice < lastBuy) {
                    return config.COLOR_PROFIT; // Green - would pay less now
                }
            } else if (comparePrice > lastBuy) {
                // Listing mode: Compare to bid (what buyers are offering = what you could sell for)
                return config.COLOR_PROFIT; // Green - can sell for more than you bought (profit)
            } else if (comparePrice < lastBuy) {
                return config.COLOR_LOSS; // Red - can only sell for less than you bought (loss)
            }

            return '#888'; // Grey - same price
        }

        /**
         * Get color for sell price based on comparison mode
         * @param {number} lastSell - Your last sell price
         * @param {Object|null} currentPrices - Current market prices { ask, bid }
         * @param {string} comparisonMode - 'instant' or 'listing'
         * @returns {string} Color code
         */
        getSellColor(lastSell, currentPrices, comparisonMode) {
            if (!currentPrices) {
                return '#888'; // Grey if no market data
            }

            // Choose comparison price based on mode
            const comparePrice = comparisonMode === 'instant' ? currentPrices.bid : currentPrices.ask;

            if (!comparePrice || comparePrice === -1) {
                return '#888'; // Grey if no market data
            }

            if (comparisonMode === 'instant') {
                // Instant mode: Compare to bid (what you'd get to instant-sell now)
                if (comparePrice > lastSell) {
                    return config.COLOR_PROFIT; // Green - would get more now
                } else if (comparePrice < lastSell) {
                    return config.COLOR_LOSS; // Red - would get less now
                }
            } else if (comparePrice > lastSell) {
                // Listing mode: Compare to ask (what sellers are asking)
                return config.COLOR_LOSS; // Red - others selling for more (you sold too cheap)
            } else if (comparePrice < lastSell) {
                return config.COLOR_PROFIT; // Green - others selling for less (you sold well)
            }

            return '#888'; // Grey - same price
        }

        /**
         * Disable the display
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            if (this.unregisterWebSocket) {
                this.unregisterWebSocket();
                this.unregisterWebSocket = null;
            }

            // Remove all displays
            document.querySelectorAll('.mwi-trade-history').forEach((el) => el.remove());

            this.isActive = false;
            this.currentItemHrid = null;
            this.currentEnhancementLevel = 0;
            this.currentOrderBookData = null;
            this.isInitialized = false;
        }
    }

    const tradeHistoryDisplay = new TradeHistoryDisplay();

    /**
     * Network Alert Display
     * Shows a warning message when market data cannot be fetched
     */


    class NetworkAlert {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.isVisible = false;
        }

        /**
         * Initialize network alert display
         */
        initialize() {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            // 1. Check if header exists already
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.prepareContainer(existingElem);
            }

            // 2. Watch for header to appear (handles SPA navigation)
            const unregister = domObserver.onClass('NetworkAlert', 'Header_totalLevel', (elem) => {
                this.prepareContainer(elem);
            });
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Prepare container but don't show yet
         * @param {Element} totalLevelElem - Total level element
         */
        prepareContainer(totalLevelElem) {
            // Check if already prepared
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container (hidden by default)
            this.container = document.createElement('div');
            this.container.className = 'mwi-network-alert';
            this.container.style.cssText = `
            display: none;
            font-size: 0.875rem;
            font-weight: 500;
            color: #ff4444;
            text-wrap: nowrap;
            margin-left: 16px;
        `;

            // Insert after total level (or after networth if it exists)
            const networthElem = totalLevelElem.parentElement.querySelector('.mwi-networth-header');
            if (networthElem) {
                networthElem.insertAdjacentElement('afterend', this.container);
            } else {
                totalLevelElem.insertAdjacentElement('afterend', this.container);
            }
        }

        /**
         * Show the network alert
         * @param {string} message - Alert message to display
         */
        show(message = '⚠️ Market data unavailable') {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            if (!this.container || !document.body.contains(this.container)) {
                // Try to prepare container if not ready
                const totalLevelElem = document.querySelector('[class*="Header_totalLevel"]');
                if (totalLevelElem) {
                    this.prepareContainer(totalLevelElem);
                } else {
                    // Header not found, fallback to console
                    console.warn('[Network Alert]', message);
                    return;
                }
            }

            if (this.container) {
                this.container.textContent = message;
                this.container.style.display = 'block';
                this.isVisible = true;
            }
        }

        /**
         * Hide the network alert
         */
        hide() {
            if (this.container && document.body.contains(this.container)) {
                this.container.style.display = 'none';
                this.isVisible = false;
            }
        }

        /**
         * Cleanup
         */
        disable() {
            this.hide();

            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
        }
    }

    const networkAlert = new NetworkAlert();

    const CONNECTION_STATES = {
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        RECONNECTING: 'reconnecting',
    };

    class ConnectionState {
        constructor() {
            this.state = CONNECTION_STATES.RECONNECTING;
            this.eventListeners = new Map();
            this.lastDisconnectedAt = null;
            this.lastConnectedAt = null;

            this.setupListeners();
        }

        /**
         * Get current connection state
         * @returns {string} Connection state (connected, disconnected, reconnecting)
         */
        getState() {
            return this.state;
        }

        /**
         * Check if currently connected
         * @returns {boolean} True if connected
         */
        isConnected() {
            return this.state === CONNECTION_STATES.CONNECTED;
        }

        /**
         * Register a listener for connection events
         * @param {string} event - Event name (disconnected, reconnected)
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister a connection event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Notify connection state from character initialization
         * @param {Object} data - Character initialization payload
         */
        handleCharacterInitialized(data) {
            if (!data) {
                return;
            }

            this.setConnected('character_initialized');
        }

        setupListeners() {
            webSocketHook.onSocketEvent('open', () => {
                this.setReconnecting('socket_open', { allowConnected: true });
            });

            webSocketHook.onSocketEvent('close', (event) => {
                this.setDisconnected('socket_close', event);
            });

            webSocketHook.onSocketEvent('error', (event) => {
                this.setDisconnected('socket_error', event);
            });

            webSocketHook.on('init_character_data', () => {
                this.setConnected('init_character_data');
            });
        }

        setReconnecting(reason, options = {}) {
            if (this.state === CONNECTION_STATES.CONNECTED && !options.allowConnected) {
                return;
            }

            this.updateState(CONNECTION_STATES.RECONNECTING, {
                reason,
            });
        }

        setDisconnected(reason, event) {
            if (this.state === CONNECTION_STATES.DISCONNECTED) {
                return;
            }

            this.lastDisconnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.DISCONNECTED, {
                reason,
                event,
                disconnectedAt: this.lastDisconnectedAt,
            });
        }

        setConnected(reason) {
            if (this.state === CONNECTION_STATES.CONNECTED) {
                return;
            }

            this.lastConnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.CONNECTED, {
                reason,
                disconnectedAt: this.lastDisconnectedAt,
                connectedAt: this.lastConnectedAt,
            });
        }

        updateState(nextState, details) {
            if (this.state === nextState) {
                return;
            }

            const previousState = this.state;
            this.state = nextState;

            if (nextState === CONNECTION_STATES.DISCONNECTED) {
                this.emit('disconnected', {
                    previousState,
                    ...details,
                });
                return;
            }

            if (nextState === CONNECTION_STATES.CONNECTED) {
                this.emit('reconnected', {
                    previousState,
                    ...details,
                });
            }
        }

        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error('[ConnectionState] Listener error:', error);
                }
            }
        }
    }

    const connectionState = new ConnectionState();

    /**
     * Task Profit Calculator
     * Calculates total profit for gathering and production tasks
     * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
     */


    /**
     * Calculate Task Token value from Task Shop items
     * Uses same approach as Ranged Way Idle - find best Task Shop item
     * @returns {Object} Token value breakdown or error state
     */
    function calculateTaskTokenValue() {
        // Return error state if expected value calculator isn't ready
        if (!expectedValueCalculator.isInitialized) {
            return {
                tokenValue: null,
                giftPerTask: null,
                totalPerToken: null,
                error: 'Market data not loaded',
            };
        }

        const taskShopItems = [
            '/items/large_meteorite_cache',
            '/items/large_artisans_crate',
            '/items/large_treasure_chest',
        ];

        // Get expected value of each Task Shop item (all cost 30 tokens)
        const expectedValues = taskShopItems.map((itemHrid) => {
            const result = expectedValueCalculator.calculateExpectedValue(itemHrid);
            return result?.expectedValue || 0;
        });

        // Use best (highest value) item
        const bestValue = Math.max(...expectedValues);

        // Task Token value = best chest value / 30 (cost in tokens)
        const taskTokenValue = bestValue / 30;

        // Calculate Purple's Gift prorated value (divide by 50 tasks)
        const giftResult = expectedValueCalculator.calculateExpectedValue('/items/purples_gift');
        const giftValue = giftResult?.expectedValue || 0;
        const giftPerTask = giftValue / 50;

        return {
            tokenValue: taskTokenValue,
            giftPerTask: giftPerTask,
            totalPerToken: taskTokenValue + giftPerTask,
            error: null,
        };
    }

    /**
     * Networth Cache
     * LRU cache for expensive enhancement cost calculations
     * Prevents recalculating the same enhancement paths repeatedly
     */

    class NetworthCache {
        constructor(maxSize = 100) {
            this.maxSize = maxSize;
            this.cache = new Map();
            this.marketDataHash = null;
        }

        /**
         * Generate cache key for enhancement calculation
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @returns {string} Cache key
         */
        generateKey(itemHrid, enhancementLevel) {
            return `${itemHrid}_${enhancementLevel}`;
        }

        /**
         * Generate hash of market data for cache invalidation
         * Uses first 10 items' prices as a simple hash
         * @param {Object} marketData - Market data object
         * @returns {string} Hash string
         */
        generateMarketHash(marketData) {
            if (!marketData || !marketData.marketData) return 'empty';

            // Sample first 10 items for hash (performance vs accuracy tradeoff)
            const items = Object.entries(marketData.marketData).slice(0, 10);
            const hashParts = items.map(([hrid, data]) => {
                const ask = data[0]?.a || 0;
                const bid = data[0]?.b || 0;
                return `${hrid}:${ask}:${bid}`;
            });

            return hashParts.join('|');
        }

        /**
         * Check if market data has changed and invalidate cache if needed
         * @param {Object} marketData - Current market data
         */
        checkAndInvalidate(marketData) {
            const newHash = this.generateMarketHash(marketData);

            if (this.marketDataHash !== null && this.marketDataHash !== newHash) {
                // Market data changed, invalidate entire cache
                this.clear();
            }

            this.marketDataHash = newHash;
        }

        /**
         * Get cached enhancement cost
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @returns {number|null} Cached cost or null if not found
         */
        get(itemHrid, enhancementLevel) {
            const key = this.generateKey(itemHrid, enhancementLevel);

            if (!this.cache.has(key)) {
                return null;
            }

            // Move to end (most recently used)
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);

            return value;
        }

        /**
         * Set cached enhancement cost
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {number} cost - Enhancement cost
         */
        set(itemHrid, enhancementLevel, cost) {
            const key = this.generateKey(itemHrid, enhancementLevel);

            // Delete if exists (to update position)
            if (this.cache.has(key)) {
                this.cache.delete(key);
            }

            // Add to end
            this.cache.set(key, cost);

            // Evict oldest if over size limit
            if (this.cache.size > this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
        }

        /**
         * Clear entire cache
         */
        clear() {
            this.cache.clear();
            this.marketDataHash = null;
        }

        /**
         * Get cache statistics
         * @returns {Object} {size, maxSize, hitRate}
         */
        getStats() {
            return {
                size: this.cache.size,
                maxSize: this.maxSize,
                marketDataHash: this.marketDataHash,
            };
        }
    }

    const networthCache = new NetworthCache();

    /**
     * Networth Calculator
     * Calculates total character networth including:
     * - Equipped items
     * - Inventory items
     * - Market listings
     * - Houses (all 17)
     * - Abilities (equipped + others)
     */


    /**
     * Calculate the value of a single item
     * @param {Object} item - Item data {itemHrid, enhancementLevel, count}
     * @param {Map} priceCache - Optional price cache from getPricesBatch()
     * @returns {number} Total value in coins
     */
    async function calculateItemValue(item, priceCache = null) {
        const { itemHrid, enhancementLevel = 0, count = 1 } = item;

        let itemValue = 0;

        // Check if high enhancement cost mode is enabled
        const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
        const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;

        // For enhanced items (1+)
        if (enhancementLevel >= 1) {
            // For high enhancement levels, use cost instead of market price (if enabled)
            if (useHighEnhancementCost && enhancementLevel >= minLevel) {
                // Check cache first
                const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                if (cachedCost !== null) {
                    itemValue = cachedCost;
                } else {
                    // Calculate enhancement cost (ignore market price)
                    const enhancementParams = enhancementConfig_js.getEnhancingParams();
                    const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                    if (enhancementPath && enhancementPath.optimalStrategy) {
                        itemValue = enhancementPath.optimalStrategy.totalCost;
                        // Cache the result
                        networthCache.set(itemHrid, enhancementLevel, itemValue);
                    } else {
                        // Enhancement calculation failed, fallback to base item price
                        console.warn('[Networth] Enhancement calculation failed for:', itemHrid, '+' + enhancementLevel);
                        itemValue = getMarketPrice(itemHrid, 0, priceCache);
                    }
                }
            } else {
                // Normal logic for lower enhancement levels: try market price first, then calculate
                const marketPrice = getMarketPrice(itemHrid, enhancementLevel, priceCache);

                if (marketPrice > 0) {
                    itemValue = marketPrice;
                } else {
                    // No market data, calculate enhancement cost
                    const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                    if (cachedCost !== null) {
                        itemValue = cachedCost;
                    } else {
                        const enhancementParams = enhancementConfig_js.getEnhancingParams();
                        const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                        if (enhancementPath && enhancementPath.optimalStrategy) {
                            itemValue = enhancementPath.optimalStrategy.totalCost;
                            networthCache.set(itemHrid, enhancementLevel, itemValue);
                        } else {
                            console.warn(
                                '[Networth] Enhancement calculation failed for:',
                                itemHrid,
                                '+' + enhancementLevel
                            );
                            itemValue = getMarketPrice(itemHrid, 0, priceCache);
                        }
                    }
                }
            }
        } else {
            // Unenhanced items: use market price or crafting cost
            itemValue = getMarketPrice(itemHrid, enhancementLevel, priceCache);
        }

        return itemValue * count;
    }

    /**
     * Get market price for an item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     * @param {Map} priceCache - Optional price cache from getPricesBatch()
     * @returns {number} Price per item (always uses ask price)
     */
    function getMarketPrice(itemHrid, enhancementLevel, priceCache = null) {
        // Special handling for currencies
        const currencyValue = calculateCurrencyValue(itemHrid);
        if (currencyValue !== null) {
            return currencyValue;
        }

        let prices;

        // Use cache if provided, otherwise fetch directly
        if (priceCache) {
            const key = `${itemHrid}:${enhancementLevel}`;
            prices = priceCache.get(key);
        } else {
            prices = marketData_js.getItemPrices(itemHrid, enhancementLevel);
        }

        // Try ask price first
        const ask = prices?.ask;
        if (ask && ask > 0) {
            return ask;
        }

        // No valid ask price - try fallbacks (only for base items)
        // Enhanced items should calculate via enhancement path, not crafting cost
        if (enhancementLevel === 0) {
            // Check if it's an openable container (crates, caches, chests)
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (itemDetails?.isOpenable && expectedValueCalculator.isInitialized) {
                const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                if (evData && evData.expectedValue > 0) {
                    return evData.expectedValue;
                }
            }

            // Try crafting cost as fallback
            const craftingCost = calculateCraftingCost(itemHrid);
            if (craftingCost > 0) {
                return craftingCost;
            }

            // Try shop cost as final fallback (for shop-only items)
            const shopCost = getShopCost(itemHrid);
            if (shopCost > 0) {
                return shopCost;
            }
        }

        return 0;
    }

    /**
     * Get shop cost for an item (if purchaseable with coins)
     * @param {string} itemHrid - Item HRID
     * @returns {number} Coin cost, or 0 if not in shop or not purchaseable with coins
     */
    function getShopCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Find shop item for this itemHrid
        for (const shopItem of Object.values(gameData.shopItemDetailMap || {})) {
            if (shopItem.itemHrid === itemHrid) {
                // Check if purchaseable with coins
                if (shopItem.costs && shopItem.costs.length > 0) {
                    const coinCost = shopItem.costs.find((cost) => cost.itemHrid === '/items/coin');
                    if (coinCost) {
                        return coinCost.count;
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Calculate value for currency items
     * @param {string} itemHrid - Item HRID
     * @returns {number|null} Currency value per unit, or null if not a currency
     */
    function calculateCurrencyValue(itemHrid) {
        // Coins: Face value (1 coin = 1 value)
        if (itemHrid === '/items/coin') {
            return 1;
        }

        // Cowbells: Market value of Bag of 10 Cowbells / 10 (if enabled)
        if (itemHrid === '/items/cowbell') {
            // Check if cowbells should be included in net worth
            const includeCowbells = config.getSetting('networth_includeCowbells');
            if (!includeCowbells) {
                return null; // Don't include cowbells in net worth
            }

            const bagPrice = marketData_js.getItemPrice('/items/bag_of_10_cowbells', { mode: 'ask' }) || 0;
            if (bagPrice > 0) {
                return bagPrice / 10;
            }
            // Fallback: vendor value
            return 100000;
        }

        // Task Tokens: Expected value from Task Shop chests
        if (itemHrid === '/items/task_token') {
            const includeTaskTokens = config.getSetting('networth_includeTaskTokens');
            if (includeTaskTokens === false) {
                return null; // Don't include task tokens in net worth
            }

            const tokenData = calculateTaskTokenValue();
            if (tokenData && tokenData.tokenValue > 0) {
                return tokenData.tokenValue;
            }
            // Fallback if market data not loaded: 30K (approximate)
            return 30000;
        }

        // Dungeon tokens: Best market value per token approach
        // Calculate based on best shop item value (similar to task tokens)
        // Uses profitCalc_pricingMode which defaults to 'hybrid' (ask price)
        if (itemHrid === '/items/chimerical_token') {
            return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
        }
        if (itemHrid === '/items/sinister_token') {
            return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
        }
        if (itemHrid === '/items/enchanted_token') {
            return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
        }
        if (itemHrid === '/items/pirate_token') {
            return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
        }

        return null; // Not a currency
    }

    /**
     * Calculate crafting cost for an item (simple version without efficiency bonuses)
     * Applies Artisan Tea reduction (0.9x) to input materials
     * @param {string} itemHrid - Item HRID
     * @returns {number} Total material cost or 0 if not craftable
     */
    function calculateCraftingCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        // Find the action that produces this item
        for (const action of Object.values(gameData.actionDetailMap || {})) {
            if (action.outputItems) {
                for (const output of action.outputItems) {
                    if (output.itemHrid === itemHrid) {
                        // Found the crafting action, calculate material costs
                        let inputCost = 0;

                        // Add input items
                        if (action.inputItems && action.inputItems.length > 0) {
                            for (const input of action.inputItems) {
                                const inputPrice = getMarketPrice(input.itemHrid, 0, null);
                                inputCost += inputPrice * input.count;
                            }
                        }

                        // Apply Artisan Tea reduction (0.9x) to input materials
                        inputCost *= 0.9;

                        // Add upgrade item cost (not affected by Artisan Tea)
                        let upgradeCost = 0;
                        if (action.upgradeItemHrid) {
                            const upgradePrice = getMarketPrice(action.upgradeItemHrid, 0, null);
                            upgradeCost = upgradePrice;
                        }

                        const totalCost = inputCost + upgradeCost;

                        // Divide by output count to get per-item cost
                        return totalCost / (output.count || 1);
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Calculate total value of all houses (all 17)
     * @param {Object} characterHouseRooms - Map of character house rooms
     * @returns {Object} {totalCost, breakdown: [{name, level, cost}]}
     */
    function calculateAllHousesCost(characterHouseRooms) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return { totalCost: 0, breakdown: [] };

        const houseRoomDetailMap = gameData.houseRoomDetailMap;
        if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

        let totalCost = 0;
        const breakdown = [];

        for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
            const level = houseData.level || 0;
            if (level === 0) continue;

            const cost = houseCostCalculator_js.calculateHouseBuildCost(houseRoomHrid, level);
            totalCost += cost;

            // Get human-readable name
            const houseDetail = houseRoomDetailMap[houseRoomHrid];
            const houseName = houseDetail?.name || houseRoomHrid.replace('/house_rooms/', '');

            breakdown.push({
                name: houseName,
                level: level,
                cost: cost,
            });
        }

        // Sort by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);

        return { totalCost, breakdown };
    }

    /**
     * Calculate total value of all abilities
     * @param {Array} characterAbilities - Array of character abilities
     * @param {Object} abilityCombatTriggersMap - Map of equipped abilities
     * @returns {Object} {totalCost, equippedCost, breakdown, equippedBreakdown, otherBreakdown}
     */
    function calculateAllAbilitiesCost(characterAbilities, abilityCombatTriggersMap) {
        if (!characterAbilities || characterAbilities.length === 0) {
            return {
                totalCost: 0,
                equippedCost: 0,
                breakdown: [],
                equippedBreakdown: [],
                otherBreakdown: [],
            };
        }

        let totalCost = 0;
        let equippedCost = 0;
        const breakdown = [];
        const equippedBreakdown = [];
        const otherBreakdown = [];

        // Create set of equipped ability HRIDs from abilityCombatTriggersMap keys
        const equippedHrids = new Set(Object.keys(abilityCombatTriggersMap || {}));

        for (const ability of characterAbilities) {
            if (!ability.abilityHrid || ability.level === 0) continue;

            const cost = abilityCostCalculator_js.calculateAbilityCost(ability.abilityHrid, ability.level);
            totalCost += cost;

            // Format ability name for display
            const abilityName = ability.abilityHrid
                .replace('/abilities/', '')
                .split('_')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            const abilityData = {
                name: `${abilityName} ${ability.level}`,
                cost: cost,
            };

            breakdown.push(abilityData);

            // Categorize as equipped or other
            if (equippedHrids.has(ability.abilityHrid)) {
                equippedCost += cost;
                equippedBreakdown.push(abilityData);
            } else {
                otherBreakdown.push(abilityData);
            }
        }

        // Sort all breakdowns by cost descending
        breakdown.sort((a, b) => b.cost - a.cost);
        equippedBreakdown.sort((a, b) => b.cost - a.cost);
        otherBreakdown.sort((a, b) => b.cost - a.cost);

        return {
            totalCost,
            equippedCost,
            breakdown,
            equippedBreakdown,
            otherBreakdown,
        };
    }

    /**
     * Calculate total networth
     * @returns {Promise<Object>} Networth data with breakdowns
     */
    async function calculateNetworth() {
        const gameData = dataManager.getCombinedData();
        if (!gameData) {
            console.error('[Networth] No game data available');
            return createEmptyNetworthData();
        }

        // Ensure market data is loaded (check in-memory first to avoid storage reads)
        if (!marketAPI.isLoaded()) {
            const marketData = await marketAPI.fetch();
            if (!marketData) {
                console.error('[Networth] Failed to fetch market data');
                return createEmptyNetworthData();
            }
        }

        // Invalidate cache if market data changed (wrap for cache compatibility)
        networthCache.checkAndInvalidate({ marketData: marketAPI.marketData });

        const characterItems = gameData.characterItems || [];
        const marketListings = gameData.myMarketListings || [];
        const characterHouseRooms = gameData.characterHouseRoomMap || {};
        const characterAbilities = gameData.characterAbilities || [];
        const abilityCombatTriggersMap = gameData.abilityCombatTriggersMap || {};

        // OPTIMIZATION: Pre-fetch all market prices in one batch
        const itemsToPrice = [];

        // Collect all items that need pricing
        for (const item of characterItems) {
            itemsToPrice.push({ itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 });
        }

        // Collect market listings items
        for (const listing of marketListings) {
            itemsToPrice.push({ itemHrid: listing.itemHrid, enhancementLevel: listing.enhancementLevel || 0 });
        }

        // Batch fetch all prices at once (eliminates ~400 redundant lookups)
        const priceCache = marketAPI.getPricesBatch(itemsToPrice);

        // Calculate equipped items value
        let equippedValue = 0;
        const equippedBreakdown = [];

        for (const item of characterItems) {
            if (item.itemLocationHrid === '/item_locations/inventory') continue;

            const value = await calculateItemValue(item, priceCache);
            equippedValue += value;

            // Add to breakdown
            const itemDetails = gameData.itemDetailMap[item.itemHrid];
            const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
            const displayName = item.enhancementLevel > 0 ? `${itemName} +${item.enhancementLevel}` : itemName;

            equippedBreakdown.push({
                name: displayName,
                value,
            });
        }

        // Calculate inventory items value
        let inventoryValue = 0;
        const inventoryBreakdown = [];
        const inventoryByCategory = {};

        // Separate ability books for Fixed Assets section
        let abilityBooksValue = 0;
        const abilityBooksBreakdown = [];

        // Track gold coins separately for header display
        let coinCount = 0;

        for (const item of characterItems) {
            if (item.itemLocationHrid !== '/item_locations/inventory') continue;

            // Extract coin count for header display
            if (item.itemHrid === '/items/coin') {
                coinCount = item.count || 0;
            }

            const value = await calculateItemValue(item, priceCache);

            // Add to breakdown
            const itemDetails = gameData.itemDetailMap[item.itemHrid];
            const itemName = itemDetails?.name || item.itemHrid.replace('/items/', '');
            const displayName = item.enhancementLevel > 0 ? `${itemName} +${item.enhancementLevel}` : itemName;

            const itemData = {
                name: displayName,
                value,
                count: item.count,
            };

            // Check if this is an ability book
            const categoryHrid = itemDetails?.categoryHrid || '/item_categories/other';
            const isAbilityBook = categoryHrid === '/item_categories/ability_book';
            const booksAsInventory = config.getSetting('networth_abilityBooksAsInventory') === true;

            if (isAbilityBook && !booksAsInventory) {
                // Add to ability books (Fixed Assets)
                abilityBooksValue += value;
                abilityBooksBreakdown.push(itemData);
            } else {
                // Add to regular inventory (Current Assets)
                inventoryValue += value;
                inventoryBreakdown.push(itemData);

                // Categorize item
                const categoryName = gameData.itemCategoryDetailMap?.[categoryHrid]?.name || 'Other';

                if (!inventoryByCategory[categoryName]) {
                    inventoryByCategory[categoryName] = {
                        items: [],
                        totalValue: 0,
                    };
                }

                inventoryByCategory[categoryName].items.push(itemData);
                inventoryByCategory[categoryName].totalValue += value;
            }
        }

        // Sort items within each category by value descending
        for (const category of Object.values(inventoryByCategory)) {
            category.items.sort((a, b) => b.value - a.value);
        }

        // Sort ability books by value descending
        abilityBooksBreakdown.sort((a, b) => b.value - a.value);

        // Calculate market listings value
        let listingsValue = 0;
        const listingsBreakdown = [];

        for (const listing of marketListings) {
            const quantity = listing.orderQuantity - listing.filledQuantity;
            const enhancementLevel = listing.enhancementLevel || 0;

            if (listing.isSell) {
                // Selling: value is locked in listing + unclaimed coins
                // Apply marketplace fee (2% for normal items, 18% for cowbells)
                const fee = listing.itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.02;

                const value = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: quantity },
                    priceCache
                );

                listingsValue += value * (1 - fee) + listing.unclaimedCoinCount;
            } else {
                // Buying: value is locked coins + unclaimed items
                const unclaimedValue = await calculateItemValue(
                    { itemHrid: listing.itemHrid, enhancementLevel, count: listing.unclaimedItemCount },
                    priceCache
                );

                listingsValue += quantity * listing.price + unclaimedValue;
            }
        }

        // Calculate houses value
        const housesData = calculateAllHousesCost(characterHouseRooms);

        // Calculate abilities value
        const abilitiesData = calculateAllAbilitiesCost(characterAbilities, abilityCombatTriggersMap);

        // Calculate totals
        const currentAssetsTotal = equippedValue + inventoryValue + listingsValue;
        const fixedAssetsTotal = housesData.totalCost + abilitiesData.totalCost + abilityBooksValue;
        const totalNetworth = currentAssetsTotal + fixedAssetsTotal;

        // Sort breakdowns by value descending
        equippedBreakdown.sort((a, b) => b.value - a.value);
        inventoryBreakdown.sort((a, b) => b.value - a.value);

        return {
            totalNetworth,
            coins: coinCount,
            currentAssets: {
                total: currentAssetsTotal,
                equipped: { value: equippedValue, breakdown: equippedBreakdown },
                inventory: {
                    value: inventoryValue,
                    breakdown: inventoryBreakdown,
                    byCategory: inventoryByCategory,
                },
                listings: { value: listingsValue, breakdown: listingsBreakdown },
            },
            fixedAssets: {
                total: fixedAssetsTotal,
                houses: housesData,
                abilities: abilitiesData,
                abilityBooks: {
                    totalCost: abilityBooksValue,
                    breakdown: abilityBooksBreakdown,
                },
            },
        };
    }

    /**
     * Create empty networth data structure
     * @returns {Object} Empty networth data
     */
    function createEmptyNetworthData() {
        return {
            totalNetworth: 0,
            coins: 0,
            currentAssets: {
                total: 0,
                equipped: { value: 0, breakdown: [] },
                inventory: { value: 0, breakdown: [], byCategory: {} },
                listings: { value: 0, breakdown: [] },
            },
            fixedAssets: {
                total: 0,
                houses: { totalCost: 0, breakdown: [] },
                abilities: {
                    totalCost: 0,
                    equippedCost: 0,
                    breakdown: [],
                    equippedBreakdown: [],
                    otherBreakdown: [],
                },
                abilityBooks: {
                    totalCost: 0,
                    breakdown: [],
                },
            },
        };
    }

    /**
     * Networth Display Components
     * Handles UI rendering for networth in two locations:
     * 1. Header (top right) - Gold: [amount]
     * 2. Inventory Panel - Detailed breakdown with collapsible sections
     */


    /**
     * Header Display Component
     * Shows "Gold: [amount]" next to total level
     */
    class NetworthHeaderDisplay {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.isInitialized = false;
            this.networthFeature = null; // Reference to parent feature for recalculation
        }

        /**
         * Set reference to parent networth feature
         * @param {Object} feature - NetworthFeature instance
         */
        setNetworthFeature(feature) {
            this.networthFeature = feature;
        }

        /**
         * Get the current items sprite URL from the DOM
         * @returns {string|null} Items sprite URL or null if not found
         */
        getItemsSpriteUrl() {
            const itemIcon = document.querySelector('use[href*="items_sprite"]');
            if (!itemIcon) {
                return null;
            }
            const href = itemIcon.getAttribute('href');
            return href ? href.split('#')[0] : null;
        }

        /**
         * Clone SVG symbol from DOM into defs
         * @param {string} symbolId - Symbol ID to clone
         * @param {SVGDefsElement} defsElement - Defs element to append to
         * @returns {boolean} True if symbol was found and cloned
         */
        cloneSymbolToDefs(symbolId, defsElement) {
            // Check if already cloned
            if (defsElement.querySelector(`symbol[id="${symbolId}"]`)) {
                return true;
            }

            // Find the symbol in the game's loaded sprites
            const symbol = document.querySelector(`symbol[id="${symbolId}"]`);
            if (!symbol) {
                console.warn('[NetworthHeaderDisplay] Symbol not found:', symbolId);
                return false;
            }

            // Clone and add to our defs
            const clonedSymbol = symbol.cloneNode(true);
            defsElement.appendChild(clonedSymbol);
            return true;
        }

        /**
         * Initialize header display
         */
        initialize() {
            // 1. Check if element already exists (handles late initialization)
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.renderHeader(existingElem);
            }

            // 2. Watch for future additions (handles SPA navigation, page reloads)
            const unregister = domObserver.onClass('NetworthHeader', 'Header_totalLevel', (elem) => {
                this.renderHeader(elem);
            });
            this.unregisterHandlers.push(unregister);

            this.isInitialized = true;
        }

        /**
         * Render header display
         * @param {Element} totalLevelElem - Total level element
         */
        renderHeader(totalLevelElem) {
            // Check if already rendered
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container
            this.container = document.createElement('div');
            this.container.className = 'mwi-networth-header';
            this.container.style.cssText = `
            font-size: 0.875rem;
            font-weight: 500;
            color: ${config.COLOR_ACCENT};
            text-wrap: nowrap;
        `;

            // Insert after total level
            totalLevelElem.insertAdjacentElement('afterend', this.container);

            // Initial render with loading state
            this.renderGoldDisplay('Loading...');

            // Trigger recalculation immediately to update from "Loading..." to actual value
            if (this.networthFeature && typeof this.networthFeature.recalculate === 'function') {
                this.networthFeature.recalculate().catch((error) => {
                    console.error('[NetworthHeaderDisplay] Immediate recalculation failed:', error);
                });
            }
        }

        /**
         * Render gold display with icon and value
         * @param {string} value - Formatted value text
         */
        renderGoldDisplay(value) {
            this.container.innerHTML = '';

            // Create wrapper for icon + text
            const wrapper = document.createElement('span');
            wrapper.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
        `;

            // Get current items sprite URL from DOM
            const itemsSpriteUrl = this.getItemsSpriteUrl();

            // Create SVG icon using game's sprite
            if (itemsSpriteUrl) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '16');
                svg.style.cssText = `
                vertical-align: middle;
                fill: currentColor;
            `;

                // Create use element with external sprite reference
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                use.setAttribute('href', `${itemsSpriteUrl}#coin`);
                svg.appendChild(use);

                wrapper.appendChild(svg);
            }

            // Create text span
            const textSpan = document.createElement('span');
            textSpan.textContent = `Gold: ${value}`;

            // Assemble
            wrapper.appendChild(textSpan);
            this.container.appendChild(wrapper);
        }

        /**
         * Update header with networth data
         * @param {Object} networthData - Networth data from calculator
         */
        update(networthData) {
            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            const valueFormatted = formatters_js.networthFormatter(Math.round(networthData.coins));

            this.renderGoldDisplay(valueFormatted);
        }

        /**
         * Refresh colors on existing header element
         */
        refresh() {
            if (this.container && document.body.contains(this.container)) {
                this.container.style.color = config.COLOR_ACCENT;
            }
        }

        /**
         * Disable and cleanup
         */
        disable() {
            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.isInitialized = false;
        }
    }

    /**
     * Inventory Panel Display Component
     * Shows detailed networth breakdown below inventory search bar
     */
    class NetworthInventoryDisplay {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.currentData = null;
            this.isInitialized = false;
        }

        /**
         * Initialize inventory panel display
         */
        initialize() {
            // 1. Check if element already exists (handles late initialization)
            const existingElem = document.querySelector('[class*="Inventory_items"]');
            if (existingElem) {
                this.renderPanel(existingElem);
            }

            // 2. Watch for future additions (handles SPA navigation, inventory panel reloads)
            const unregister = domObserver.onClass('NetworthInv', 'Inventory_items', (elem) => {
                this.renderPanel(elem);
            });
            this.unregisterHandlers.push(unregister);

            this.isInitialized = true;
        }

        /**
         * Render inventory panel
         * @param {Element} inventoryElem - Inventory items element
         */
        renderPanel(inventoryElem) {
            // Check if already rendered
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container
            this.container = document.createElement('div');
            this.container.className = 'mwi-networth-panel';
            this.container.style.cssText = `
            text-align: left;
            color: ${config.COLOR_ACCENT};
            font-size: 0.875rem;
            margin-bottom: 12px;
        `;

            // Insert before inventory items
            inventoryElem.insertAdjacentElement('beforebegin', this.container);

            // Initial render with loading state or current data
            if (this.currentData) {
                this.update(this.currentData);
            } else {
                this.container.innerHTML = `
                <div style="font-weight: bold; cursor: pointer;">
                    + Total Networth: Loading...
                </div>
            `;
            }
        }

        /**
         * Update panel with networth data
         * @param {Object} networthData - Networth data from calculator
         */
        update(networthData) {
            this.currentData = networthData;

            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            // Preserve expand/collapse states before updating
            const expandedStates = {};
            const sectionsToPreserve = [
                'mwi-networth-details',
                'mwi-current-assets-details',
                'mwi-equipment-breakdown',
                'mwi-inventory-breakdown',
                'mwi-fixed-assets-details',
                'mwi-houses-breakdown',
                'mwi-abilities-details',
                'mwi-equipped-abilities-breakdown',
                'mwi-other-abilities-breakdown',
                'mwi-ability-books-breakdown',
            ];

            // Also preserve inventory category states
            const inventoryCategories = Object.keys(networthData.currentAssets.inventory.byCategory || {});
            inventoryCategories.forEach((categoryName) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                sectionsToPreserve.push(categoryId);
            });

            sectionsToPreserve.forEach((id) => {
                const elem = this.container.querySelector(`#${id}`);
                if (elem) {
                    expandedStates[id] = elem.style.display !== 'none';
                }
            });

            const totalNetworth = formatters_js.networthFormatter(Math.round(networthData.totalNetworth));

            this.container.innerHTML = `
            <div style="cursor: pointer; font-weight: bold;" id="mwi-networth-toggle">
                + Total Networth: ${totalNetworth}
            </div>
            <div id="mwi-networth-details" style="display: none; margin-left: 20px;">
                <!-- Current Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-current-assets-toggle">
                    + Current Assets: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.total))}
                </div>
                <div id="mwi-current-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Equipment Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipment-toggle">
                        + Equipment value: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.equipped.value))}
                    </div>
                    <div id="mwi-equipment-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderEquipmentBreakdown(networthData.currentAssets.equipped.breakdown)}</div>

                    <!-- Inventory Value -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-inventory-toggle">
                        + Inventory value: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.inventory.value))}
                    </div>
                    <div id="mwi-inventory-breakdown" style="display: none; margin-left: 20px;">
                        ${this.renderInventoryBreakdown(networthData.currentAssets.inventory.byCategory)}
                    </div>

                    <div style="margin-top: 4px;">Market listings: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.listings.value))}</div>
                </div>

                <!-- Fixed Assets -->
                <div style="cursor: pointer; margin-top: 8px;" id="mwi-fixed-assets-toggle">
                    + Fixed Assets: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.total))}
                </div>
                <div id="mwi-fixed-assets-details" style="display: none; margin-left: 20px;">
                    <!-- Houses -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-houses-toggle">
                        + Houses: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}
                    </div>
                    <div id="mwi-houses-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderHousesBreakdown(networthData.fixedAssets.houses.breakdown)}</div>

                    <!-- Abilities -->
                    <div style="cursor: pointer; margin-top: 4px;" id="mwi-abilities-toggle">
                        + Abilities: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}
                    </div>
                    <div id="mwi-abilities-details" style="display: none; margin-left: 20px;">
                        <!-- Equipped Abilities -->
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-equipped-abilities-toggle">
                            + Equipped (${networthData.fixedAssets.abilities.equippedBreakdown.length}): ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}
                        </div>
                        <div id="mwi-equipped-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.equippedBreakdown)}</div>

                        <!-- Other Abilities -->
                        ${
                            networthData.fixedAssets.abilities.otherBreakdown.length > 0
                                ? `
                            <div style="cursor: pointer; margin-top: 4px;" id="mwi-other-abilities-toggle">
                                + Other (${networthData.fixedAssets.abilities.otherBreakdown.length}): ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}
                            </div>
                            <div id="mwi-other-abilities-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilitiesBreakdown(networthData.fixedAssets.abilities.otherBreakdown)}</div>
                        `
                                : ''
                        }
                    </div>

                    <!-- Ability Books -->
                    ${
                        networthData.fixedAssets.abilityBooks.breakdown.length > 0
                            ? `
                        <div style="cursor: pointer; margin-top: 4px;" id="mwi-ability-books-toggle">
                            + Ability Books (${networthData.fixedAssets.abilityBooks.breakdown.length}): ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilityBooks.totalCost))}
                        </div>
                        <div id="mwi-ability-books-breakdown" style="display: none; margin-left: 20px; font-size: 0.8rem; color: #bbb; white-space: pre-line;">${this.renderAbilityBooksBreakdown(networthData.fixedAssets.abilityBooks.breakdown)}</div>
                    `
                            : ''
                    }
                </div>
            </div>
        `;

            // Restore expand/collapse states after updating
            sectionsToPreserve.forEach((id) => {
                const elem = this.container.querySelector(`#${id}`);
                if (elem && expandedStates[id]) {
                    elem.style.display = 'block';

                    // Update the corresponding toggle button text (+ to -)
                    const toggleId = id.replace('-details', '-toggle').replace('-breakdown', '-toggle');
                    const toggleBtn = this.container.querySelector(`#${toggleId}`);
                    if (toggleBtn) {
                        const currentText = toggleBtn.textContent;
                        toggleBtn.textContent = currentText.replace('+ ', '- ');
                    }
                }
            });

            // Set up event listeners for all toggles
            this.setupToggleListeners(networthData);
        }

        /**
         * Render houses breakdown HTML
         * @param {Array} breakdown - Array of {name, level, cost}
         * @returns {string} HTML string
         */
        renderHousesBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No houses built</div>';
            }

            return breakdown
                .map((house) => {
                    return `${house.name} ${house.level}: ${formatters_js.networthFormatter(Math.round(house.cost))}`;
                })
                .join('\n');
        }

        /**
         * Render abilities breakdown HTML
         * @param {Array} breakdown - Array of {name, cost}
         * @returns {string} HTML string
         */
        renderAbilitiesBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No abilities</div>';
            }

            return breakdown
                .map((ability) => {
                    return `${ability.name}: ${formatters_js.networthFormatter(Math.round(ability.cost))}`;
                })
                .join('\n');
        }

        /**
         * Render ability books breakdown HTML
         * @param {Array} breakdown - Array of {name, value, count}
         * @returns {string} HTML string
         */
        renderAbilityBooksBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No ability books</div>';
            }

            return breakdown
                .map((book) => {
                    return `${book.name} (${formatters_js.formatKMB(book.count)}): ${formatters_js.networthFormatter(Math.round(book.value))}`;
                })
                .join('\n');
        }

        /**
         * Render equipment breakdown HTML
         * @param {Array} breakdown - Array of {name, value}
         * @returns {string} HTML string
         */
        renderEquipmentBreakdown(breakdown) {
            if (breakdown.length === 0) {
                return '<div>No equipment</div>';
            }

            return breakdown
                .map((item) => {
                    return `${item.name}: ${formatters_js.networthFormatter(Math.round(item.value))}`;
                })
                .join('\n');
        }

        /**
         * Render inventory breakdown HTML (grouped by category)
         * @param {Object} byCategory - Object with category names as keys
         * @returns {string} HTML string
         */
        renderInventoryBreakdown(byCategory) {
            if (!byCategory || Object.keys(byCategory).length === 0) {
                return '<div>No inventory</div>';
            }

            // Sort categories by total value descending
            const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1].totalValue - a[1].totalValue);

            return sortedCategories
                .map(([categoryName, categoryData]) => {
                    const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                    const categoryToggleId = `${categoryId}-toggle`;

                    // Build items HTML with newlines
                    const itemsHTML = categoryData.items
                        .map((item) => {
                            return `${item.name} x${formatters_js.formatKMB(item.count)}: ${formatters_js.networthFormatter(Math.round(item.value))}`;
                        })
                        .join('\n');

                    return `
                <div style="cursor: pointer; margin-top: 4px; font-size: 0.85rem;" id="${categoryToggleId}">
                    + ${categoryName}: ${formatters_js.networthFormatter(Math.round(categoryData.totalValue))}
                </div>
                <div id="${categoryId}" style="display: none; margin-left: 20px; font-size: 0.75rem; color: #999; white-space: pre-line;">
                    ${itemsHTML}
                </div>
            `;
                })
                .join('');
        }

        /**
         * Set up toggle event listeners
         * @param {Object} networthData - Networth data
         */
        setupToggleListeners(networthData) {
            // Main networth toggle
            this.setupToggle(
                'mwi-networth-toggle',
                'mwi-networth-details',
                `Total Networth: ${formatters_js.networthFormatter(Math.round(networthData.totalNetworth))}`
            );

            // Current assets toggle
            this.setupToggle(
                'mwi-current-assets-toggle',
                'mwi-current-assets-details',
                `Current Assets: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.total))}`
            );

            // Equipment toggle
            this.setupToggle(
                'mwi-equipment-toggle',
                'mwi-equipment-breakdown',
                `Equipment value: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.equipped.value))}`
            );

            // Inventory toggle
            this.setupToggle(
                'mwi-inventory-toggle',
                'mwi-inventory-breakdown',
                `Inventory value: ${formatters_js.networthFormatter(Math.round(networthData.currentAssets.inventory.value))}`
            );

            // Inventory category toggles
            const byCategory = networthData.currentAssets.inventory.byCategory || {};
            Object.entries(byCategory).forEach(([categoryName, categoryData]) => {
                const categoryId = `mwi-inventory-${categoryName.toLowerCase().replace(/\s+/g, '-')}`;
                const categoryToggleId = `${categoryId}-toggle`;
                this.setupToggle(
                    categoryToggleId,
                    categoryId,
                    `${categoryName}: ${formatters_js.networthFormatter(Math.round(categoryData.totalValue))}`
                );
            });

            // Fixed assets toggle
            this.setupToggle(
                'mwi-fixed-assets-toggle',
                'mwi-fixed-assets-details',
                `Fixed Assets: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.total))}`
            );

            // Houses toggle
            this.setupToggle(
                'mwi-houses-toggle',
                'mwi-houses-breakdown',
                `Houses: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.houses.totalCost))}`
            );

            // Abilities toggle
            this.setupToggle(
                'mwi-abilities-toggle',
                'mwi-abilities-details',
                `Abilities: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost))}`
            );

            // Equipped abilities toggle
            this.setupToggle(
                'mwi-equipped-abilities-toggle',
                'mwi-equipped-abilities-breakdown',
                `Equipped (${networthData.fixedAssets.abilities.equippedBreakdown.length}): ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.equippedCost))}`
            );

            // Other abilities toggle (if exists)
            if (networthData.fixedAssets.abilities.otherBreakdown.length > 0) {
                this.setupToggle(
                    'mwi-other-abilities-toggle',
                    'mwi-other-abilities-breakdown',
                    `Other Abilities: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilities.totalCost - networthData.fixedAssets.abilities.equippedCost))}`
                );
            }

            // Ability books toggle (if exists)
            if (networthData.fixedAssets.abilityBooks.breakdown.length > 0) {
                this.setupToggle(
                    'mwi-ability-books-toggle',
                    'mwi-ability-books-breakdown',
                    `Ability Books: ${formatters_js.networthFormatter(Math.round(networthData.fixedAssets.abilityBooks.totalCost))}`
                );
            }
        }

        /**
         * Set up a single toggle button
         * @param {string} toggleId - Toggle button element ID
         * @param {string} detailsId - Details element ID
         * @param {string} label - Label text (without +/- prefix)
         */
        setupToggle(toggleId, detailsId, label) {
            const toggleBtn = this.container.querySelector(`#${toggleId}`);
            const details = this.container.querySelector(`#${detailsId}`);

            if (!toggleBtn || !details) return;

            toggleBtn.addEventListener('click', () => {
                const isCollapsed = details.style.display === 'none';
                details.style.display = isCollapsed ? 'block' : 'none';
                toggleBtn.textContent = (isCollapsed ? '- ' : '+ ') + label;
            });
        }

        /**
         * Refresh colors on existing panel
         */
        refresh() {
            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            // Update main container color
            this.container.style.color = config.COLOR_ACCENT;
        }

        /**
         * Disable and cleanup
         */
        disable() {
            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.currentData = null;
            this.isInitialized = false;
        }
    }

    // Export both display components
    const networthHeaderDisplay = new NetworthHeaderDisplay();
    const networthInventoryDisplay = new NetworthInventoryDisplay();

    /**
     * Create a pause registry for deterministic pause/resume handling.
     * @param {{ connectionState?: { on: Function, off: Function } }} [options] - Optional dependency overrides.
     * @returns {{
     *   register: (id: string, pauseFn: Function, resumeFn: Function) => void,
     *   unregister: (id: string) => void,
     *   pauseAll: () => void,
     *   resumeAll: () => void,
     *   cleanup: () => void
     * }} Pause registry API
     */
    function createPauseRegistry(options = {}) {
        const registry = new Map();
        const connectionStateRef = options.connectionState || connectionState;
        let isPaused = false;

        const normalizeId = (id) => (typeof id === 'string' ? id.trim() : id);
        const isValidId = (id) => typeof id === 'string' && id.trim().length > 0;

        /**
         * Register pausable work by unique id.
         * @param {string} id - Unique identifier for the pausable work.
         * @param {Function} pauseFn - Callback invoked on pause.
         * @param {Function} resumeFn - Callback invoked on resume.
         */
        const register = (id, pauseFn, resumeFn) => {
            if (!isValidId(id) || typeof pauseFn !== 'function' || typeof resumeFn !== 'function') {
                console.warn('[PauseRegistry] register called with invalid arguments');
                return;
            }

            const normalizedId = normalizeId(id);
            if (registry.has(normalizedId)) {
                console.warn(`[PauseRegistry] register called with duplicate id: ${normalizedId}`);
            }

            registry.set(normalizedId, { pauseFn, resumeFn });

            if (isPaused) {
                try {
                    pauseFn();
                } catch (error) {
                    console.error(`[PauseRegistry] Failed to pause '${normalizedId}' during register:`, error);
                }
            }
        };

        /**
         * Unregister pausable work by id.
         * Note: Unregister does not auto-resume if currently paused.
         * @param {string} id - Identifier to remove.
         */
        const unregister = (id) => {
            if (!isValidId(id)) {
                console.warn('[PauseRegistry] unregister called with invalid id');
                return;
            }

            registry.delete(normalizeId(id));
        };

        const callAll = (actionLabel, handlerKey) => {
            for (const [entryId, entry] of registry.entries()) {
                const handler = entry[handlerKey];
                if (typeof handler !== 'function') {
                    continue;
                }

                try {
                    handler();
                } catch (error) {
                    console.error(`[PauseRegistry] Failed to ${actionLabel} '${entryId}':`, error);
                }
            }
        };

        /**
         * Pause all registered work.
         */
        const pauseAll = () => {
            if (isPaused) {
                return;
            }

            isPaused = true;
            callAll('pause', 'pauseFn');
        };

        /**
         * Resume all registered work.
         */
        const resumeAll = () => {
            if (!isPaused) {
                return;
            }

            isPaused = false;
            callAll('resume', 'resumeFn');
        };

        const handleDisconnected = () => {
            pauseAll();
        };

        const handleReconnected = () => {
            resumeAll();
        };

        if (connectionStateRef && typeof connectionStateRef.on === 'function') {
            connectionStateRef.on('disconnected', handleDisconnected);
            connectionStateRef.on('reconnected', handleReconnected);
        } else {
            console.warn('[PauseRegistry] connectionState unavailable; pause/resume events not wired');
        }

        /**
         * Cleanup registry subscriptions.
         */
        const cleanup = () => {
            if (!connectionStateRef || typeof connectionStateRef.off !== 'function') {
                return;
            }

            connectionStateRef.off('disconnected', handleDisconnected);
            connectionStateRef.off('reconnected', handleReconnected);
        };

        return {
            register,
            unregister,
            pauseAll,
            resumeAll,
            cleanup,
        };
    }

    /**
     * Networth Feature - Main Coordinator
     * Manages networth calculation and display updates
     */


    class NetworthFeature {
        constructor() {
            this.isActive = false;
            this.updateInterval = null;
            this.currentData = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.pauseRegistry = null;
        }

        /**
         * Initialize the networth feature
         */
        async initialize() {
            if (this.isActive) return;

            // Set reference in display components so they can trigger recalculation
            networthHeaderDisplay.setNetworthFeature(this);

            // Initialize header display (always enabled with networth feature)
            if (config.isFeatureEnabled('networth')) {
                networthHeaderDisplay.initialize();
            }

            // Initialize inventory panel display (separate toggle)
            if (config.isFeatureEnabled('inventorySummary')) {
                networthInventoryDisplay.initialize();
            }

            if (!this.pauseRegistry) {
                this.pauseRegistry = createPauseRegistry();
                this.pauseRegistry.register(
                    'networth-update-interval',
                    () => this.stopAutoRefresh(),
                    () => this.resumeAutoRefresh()
                );
            }

            // Start update interval (every 30 seconds)
            if (connectionState.isConnected()) {
                this.startAutoRefresh();
            }

            // Initial calculation
            if (connectionState.isConnected()) {
                await this.recalculate();
            }

            this.isActive = true;
        }

        /**
         * Recalculate networth and update displays
         */
        async recalculate() {
            if (!connectionState.isConnected()) {
                return;
            }

            try {
                // Calculate networth
                const networthData = await calculateNetworth();
                this.currentData = networthData;

                // Update displays
                if (config.isFeatureEnabled('networth')) {
                    networthHeaderDisplay.update(networthData);
                }

                if (config.isFeatureEnabled('inventorySummary')) {
                    networthInventoryDisplay.update(networthData);
                }
            } catch (error) {
                console.error('[Networth] Error calculating networth:', error);
            }
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.pauseRegistry) {
                this.pauseRegistry.unregister('networth-update-interval');
                this.pauseRegistry.cleanup();
                this.pauseRegistry = null;
            }

            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            this.timerRegistry.clearAll();

            networthHeaderDisplay.disable();
            networthInventoryDisplay.disable();

            this.currentData = null;
            this.isActive = false;
        }

        startAutoRefresh() {
            if (this.updateInterval) {
                return;
            }

            this.updateInterval = setInterval(() => this.recalculate(), 30000);
            this.timerRegistry.registerInterval(this.updateInterval);
        }

        stopAutoRefresh() {
            if (!this.updateInterval) {
                return;
            }

            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        resumeAutoRefresh() {
            this.startAutoRefresh();
            this.recalculate();
        }
    }

    const networthFeature = new NetworthFeature();

    /**
     * Inventory Badge Manager
     * Centralized management for all inventory item badges
     * Prevents race conditions with React re-renders by coordinating all badge rendering
     */


    /**
     * InventoryBadgeManager class manages all inventory item badges from multiple features
     */
    class InventoryBadgeManager {
        constructor() {
            this.providers = new Map(); // name -> { renderFn, priority }
            this.currentInventoryElem = null;
            this.unregisterHandlers = [];
            this.isInitialized = false;
            this.processedItems = new WeakSet(); // Track processed item containers
            this.warnedItems = new Set(); // Track items we've already warned about
            this.isCalculating = false; // Guard flag to prevent recursive calls
            this.lastCalculationTime = 0; // Timestamp of last calculation
            this.CALCULATION_COOLDOWN = 250; // 250ms minimum between calculations
            this.inventoryLookupCache = null; // Cached inventory lookup map
            this.inventoryLookupCacheTime = 0; // Timestamp when cache was built
            this.INVENTORY_CACHE_TTL = 500; // 500ms cache lifetime
        }

        /**
         * Initialize badge manager
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Check if inventory is already open
            const existingInv = document.querySelector('[class*="Inventory_items"]');
            if (existingInv) {
                this.currentInventoryElem = existingInv;
            }

            // Watch for inventory panel
            const unregister = domObserver.onClass('InventoryBadgeManager', 'Inventory_items', (elem) => {
                this.currentInventoryElem = elem;
            });
            this.unregisterHandlers.push(unregister);

            // Watch for DOM changes to refresh badges
            const badgeRefreshUnregister = domObserver.register(
                'InventoryBadgeManager-Refresh',
                () => {
                    if (this.currentInventoryElem) {
                        this.renderAllBadges();
                    }
                },
                { debounce: true, debounceDelay: 150 } // 150ms debounce to reduce calculation frequency
            );
            this.unregisterHandlers.push(badgeRefreshUnregister);
        }

        /**
         * Register a badge provider
         * @param {string} name - Unique provider name
         * @param {Function} renderFn - Function(itemElem) that renders badges for an item
         * @param {number} priority - Render order (lower = earlier, default 100)
         */
        registerProvider(name, renderFn, priority = 100) {
            this.providers.set(name, { renderFn, priority });
        }

        /**
         * Unregister a badge provider
         * @param {string} name - Provider name
         */
        unregisterProvider(name) {
            this.providers.delete(name);
        }

        /**
         * Clear processed tracking (forces re-render on next pass)
         */
        clearProcessedTracking() {
            this.processedItems = new WeakSet();
        }

        /**
         * Render all badges on all items from all providers
         */
        async renderAllBadges() {
            if (!this.currentInventoryElem) return;

            // Calculate prices for all items
            await this.calculatePricesForAllItems();

            const itemElems = this.currentInventoryElem.querySelectorAll('[class*="Item_itemContainer"]');

            // Sort providers by priority
            const sortedProviders = Array.from(this.providers.entries()).sort((a, b) => a[1].priority - b[1].priority);

            for (const itemElem of itemElems) {
                // Check if already processed AND badges still exist
                // React can destroy inner content while keeping container reference
                const wasProcessed = this.processedItems.has(itemElem);
                const hasBadges = this.itemHasBadges(itemElem);

                // Skip only if processed AND badges still exist
                if (wasProcessed && hasBadges) {
                    continue;
                }

                // Call each provider's render function for this item
                for (const [name, { renderFn }] of sortedProviders) {
                    try {
                        renderFn(itemElem);
                    } catch (error) {
                        console.error(`[InventoryBadgeManager] Error in provider "${name}":`, error);
                    }
                }

                // Mark as processed
                this.processedItems.add(itemElem);
            }
        }

        /**
         * Calculate prices for all items in inventory
         */
        async calculatePricesForAllItems() {
            if (!this.currentInventoryElem) return;

            // Prevent recursive calls
            if (this.isCalculating) return;

            // Cooldown check - prevent spamming during rapid events
            const now = Date.now();
            if (now - this.lastCalculationTime < this.CALCULATION_COOLDOWN) {
                return;
            }
            this.lastCalculationTime = now;

            this.isCalculating = true;

            const inventoryElem = this.currentInventoryElem;

            // Build inventory cache once if expired or missing (500ms TTL)
            let inventory = null;
            let inventoryLookup = null;

            const cacheAge = now - this.inventoryLookupCacheTime;
            if (this.inventoryLookupCache && cacheAge < this.INVENTORY_CACHE_TTL) {
                // Use cached data
                inventory = this.inventoryLookupCache.inventory;
                inventoryLookup = this.inventoryLookupCache.lookup;
            } else {
                // Rebuild cache
                inventory = dataManager.getInventory();
                if (inventory) {
                    inventoryLookup = new Map();
                    for (const item of inventory) {
                        if (item.itemLocationHrid === '/item_locations/inventory') {
                            const key = `${item.itemHrid}|${item.count}`;
                            inventoryLookup.set(key, item);
                        }
                    }
                    // Store in cache
                    this.inventoryLookupCache = { inventory, lookup: inventoryLookup };
                    this.inventoryLookupCacheTime = now;
                }
            }

            // Process each category
            for (const categoryDiv of inventoryElem.children) {
                const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');
                await this.calculateItemPrices(itemElems, inventory, inventoryLookup);
            }

            this.isCalculating = false;
        }

        /**
         * Calculate and store prices for all items (populates dataset.askValue/bidValue)
         * @param {NodeList} itemElems - Item elements
         * @param {Array} cachedInventory - Optional cached inventory data
         * @param {Map} cachedInventoryLookup - Optional cached inventory lookup map
         */
        async calculateItemPrices(itemElems, cachedInventory = null, cachedInventoryLookup = null) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                console.warn('[InventoryBadgeManager] Game data not available yet');
                return;
            }

            // Use cached inventory if provided, otherwise fetch fresh
            let inventory = cachedInventory;
            let inventoryLookup = cachedInventoryLookup;

            if (!inventory || !inventoryLookup) {
                // Get inventory data for enhancement level matching
                inventory = dataManager.getInventory();
                if (!inventory) {
                    console.warn('[InventoryBadgeManager] Inventory data not available yet');
                    return;
                }

                // Build lookup map: itemHrid|count -> inventory item
                inventoryLookup = new Map();
                for (const item of inventory) {
                    if (item.itemLocationHrid === '/item_locations/inventory') {
                        const key = `${item.itemHrid}|${item.count}`;
                        inventoryLookup.set(key, item);
                    }
                }
            }

            // OPTIMIZATION: Pre-fetch all market prices in one batch
            const itemsToPrice = [];
            for (const item of inventory) {
                if (item.itemLocationHrid === '/item_locations/inventory') {
                    itemsToPrice.push({
                        itemHrid: item.itemHrid,
                        enhancementLevel: item.enhancementLevel || 0,
                    });
                }
            }
            const priceCache = marketAPI.getPricesBatch(itemsToPrice);

            // Get settings for high enhancement cost mode
            const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
            const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;

            // Currency items to skip (actual currencies, not category)
            const currencyHrids = new Set([
                '/items/gold_coin',
                '/items/cowbell',
                '/items/task_token',
                '/items/chimerical_token',
                '/items/sinister_token',
                '/items/enchanted_token',
                '/items/pirate_token',
            ]);

            for (const itemElem of itemElems) {
                // Get item HRID from SVG aria-label
                const svg = itemElem.querySelector('svg');
                if (!svg) continue;

                const itemName = svg.getAttribute('aria-label');
                if (!itemName) continue;

                // Find item HRID
                const itemHrid = this.findItemHrid(itemName, gameData);
                if (!itemHrid) {
                    console.warn('[InventoryBadgeManager] Could not find HRID for item:', itemName);
                    continue;
                }

                // Skip actual currency items
                if (currencyHrids.has(itemHrid)) {
                    itemElem.dataset.askPrice = 0;
                    itemElem.dataset.bidPrice = 0;
                    itemElem.dataset.askValue = 0;
                    itemElem.dataset.bidValue = 0;
                    continue;
                }

                // Get item count
                const countElem = itemElem.querySelector('[class*="Item_count"]');
                if (!countElem) continue;

                let itemCount = countElem.textContent;
                itemCount = this.parseItemCount(itemCount);

                // Get item details (reused throughout)
                const itemDetails = gameData.itemDetailMap[itemHrid];

                // Handle trainee items (untradeable, no market data)
                if (itemHrid.includes('trainee_')) {
                    // EXCEPTION: Trainee charms should use vendor price
                    const equipmentType = itemDetails?.equipmentDetail?.type;
                    const isCharm = equipmentType === '/equipment_types/charm';
                    const sellPrice = itemDetails?.sellPrice;

                    if (isCharm && sellPrice) {
                        // Use sell price for trainee charms
                        itemElem.dataset.askPrice = sellPrice;
                        itemElem.dataset.bidPrice = sellPrice;
                        itemElem.dataset.askValue = sellPrice * itemCount;
                        itemElem.dataset.bidValue = sellPrice * itemCount;
                    } else {
                        // Other trainee items (weapons/armor) remain at 0
                        itemElem.dataset.askPrice = 0;
                        itemElem.dataset.bidPrice = 0;
                        itemElem.dataset.askValue = 0;
                        itemElem.dataset.bidValue = 0;
                    }
                    continue;
                }

                // Handle openable containers (chests, crates, caches)
                if (itemDetails?.isOpenable && expectedValueCalculator.isInitialized) {
                    const evData = expectedValueCalculator.calculateExpectedValue(itemHrid);
                    if (evData && evData.expectedValue > 0) {
                        // Use expected value for both ask and bid
                        itemElem.dataset.askPrice = evData.expectedValue;
                        itemElem.dataset.bidPrice = evData.expectedValue;
                        itemElem.dataset.askValue = evData.expectedValue * itemCount;
                        itemElem.dataset.bidValue = evData.expectedValue * itemCount;
                        continue;
                    }
                }

                // Match to inventory item to get enhancement level
                const key = `${itemHrid}|${itemCount}`;
                const inventoryItem = inventoryLookup.get(key);
                const enhancementLevel = inventoryItem?.enhancementLevel || 0;

                // Check if item is equipment
                const isEquipment = !!itemDetails?.equipmentDetail;

                let askPrice = 0;
                let bidPrice = 0;

                // Determine pricing method
                if (isEquipment && useHighEnhancementCost && enhancementLevel >= minLevel) {
                    // Use enhancement cost calculation for high-level equipment
                    const cachedCost = networthCache.get(itemHrid, enhancementLevel);

                    if (cachedCost !== null) {
                        // Use cached value for both ask and bid
                        askPrice = cachedCost;
                        bidPrice = cachedCost;
                    } else {
                        // Calculate enhancement cost
                        const enhancementParams = enhancementConfig_js.getEnhancingParams();
                        const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                        if (enhancementPath && enhancementPath.optimalStrategy) {
                            const enhancementCost = enhancementPath.optimalStrategy.totalCost;

                            // Cache the result
                            networthCache.set(itemHrid, enhancementLevel, enhancementCost);

                            // Use enhancement cost for both ask and bid
                            askPrice = enhancementCost;
                            bidPrice = enhancementCost;
                        } else {
                            // Enhancement calculation failed, fallback to market price
                            const key = `${itemHrid}:${enhancementLevel}`;
                            const marketPrice = priceCache.get(key);
                            if (marketPrice) {
                                askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                                bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                            }
                        }
                    }
                } else {
                    // Use market price (for non-equipment or low enhancement levels)
                    const key = `${itemHrid}:${enhancementLevel}`;
                    const marketPrice = priceCache.get(key);

                    // Start with whatever market data exists
                    if (marketPrice) {
                        askPrice = marketPrice.ask > 0 ? marketPrice.ask : 0;
                        bidPrice = marketPrice.bid > 0 ? marketPrice.bid : 0;
                    }

                    // For enhanced equipment, fill in missing prices with enhancement cost
                    if (isEquipment && enhancementLevel > 0 && (askPrice === 0 || bidPrice === 0)) {
                        // Check cache first
                        const cachedCost = networthCache.get(itemHrid, enhancementLevel);
                        let enhancementCost = cachedCost;

                        if (cachedCost === null) {
                            // Calculate enhancement cost
                            const enhancementParams = enhancementConfig_js.getEnhancingParams();
                            const enhancementPath = calculateEnhancementPath(itemHrid, enhancementLevel, enhancementParams);

                            if (enhancementPath && enhancementPath.optimalStrategy) {
                                enhancementCost = enhancementPath.optimalStrategy.totalCost;
                                networthCache.set(itemHrid, enhancementLevel, enhancementCost);
                            } else {
                                enhancementCost = null;
                            }
                        }

                        // Fill in missing prices
                        if (enhancementCost !== null) {
                            if (askPrice === 0) askPrice = enhancementCost;
                            if (bidPrice === 0) bidPrice = enhancementCost;
                        }
                    } else if (isEquipment && enhancementLevel === 0 && askPrice === 0 && bidPrice === 0) {
                        // For unenhanced equipment with no market data, use crafting cost
                        const craftingCost = this.calculateCraftingCost(itemHrid);
                        if (craftingCost > 0) {
                            askPrice = craftingCost;
                            bidPrice = craftingCost;
                        } else if (!this.warnedItems.has(itemHrid)) {
                            // No crafting recipe found (likely drop-only item)
                            console.warn(
                                '[InventoryBadgeManager] No market data or crafting recipe for equipment:',
                                itemName,
                                itemHrid
                            );
                            this.warnedItems.add(itemHrid);
                        }
                    } else if (!isEquipment && askPrice === 0 && bidPrice === 0) {
                        // Non-equipment with no market data
                        if (!this.warnedItems.has(itemHrid)) {
                            console.warn(
                                '[InventoryBadgeManager] No market data for non-equipment item:',
                                itemName,
                                itemHrid
                            );
                            this.warnedItems.add(itemHrid);
                        }
                        // Leave values at 0 (no badge will be shown)
                    }
                }

                // Store per-item prices (for badge display)
                itemElem.dataset.askPrice = askPrice;
                itemElem.dataset.bidPrice = bidPrice;

                // Store stack totals (for sorting and stack value badges)
                itemElem.dataset.askValue = askPrice * itemCount;
                itemElem.dataset.bidValue = bidPrice * itemCount;
            }
        }

        /**
         * Calculate crafting cost for an item (used for unenhanced equipment with no market data)
         * @param {string} itemHrid - Item HRID
         * @returns {number} Total material cost or 0 if not craftable
         */
        calculateCraftingCost(itemHrid) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) return 0;

            // Find the action that produces this item
            for (const action of Object.values(gameData.actionDetailMap || {})) {
                if (action.outputItems) {
                    for (const output of action.outputItems) {
                        if (output.itemHrid === itemHrid) {
                            // Found the crafting action, calculate material costs
                            let inputCost = 0;

                            // Add input items
                            if (action.inputItems && action.inputItems.length > 0) {
                                for (const input of action.inputItems) {
                                    const inputPrice = marketData_js.getItemPrice(input.itemHrid, { mode: 'ask' }) || 0;
                                    inputCost += inputPrice * input.count;
                                }
                            }

                            // Apply Artisan Tea reduction (0.9x) to input materials
                            inputCost *= 0.9;

                            // Add upgrade item cost (not affected by Artisan Tea)
                            let upgradeCost = 0;
                            if (action.upgradeItemHrid) {
                                const upgradePrice = marketData_js.getItemPrice(action.upgradeItemHrid, { mode: 'ask' }) || 0;
                                upgradeCost = upgradePrice;
                            }

                            const totalCost = inputCost + upgradeCost;

                            // Divide by output count to get per-item cost
                            return totalCost / (output.count || 1);
                        }
                    }
                }
            }

            return 0;
        }

        /**
         * Find item HRID from item name
         * @param {string} itemName - Item display name
         * @param {Object} gameData - Game data
         * @returns {string|null} Item HRID
         */
        findItemHrid(itemName, gameData) {
            // Direct lookup in itemDetailMap
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                if (item.name === itemName) {
                    return hrid;
                }
            }
            return null;
        }

        /**
         * Parse item count from text (handles K, M suffixes)
         * @param {string} text - Count text
         * @returns {number} Numeric count
         */
        parseItemCount(text) {
            text = text.toLowerCase().trim();

            if (text.includes('k')) {
                return parseFloat(text.replace('k', '')) * 1000;
            } else if (text.includes('m')) {
                return parseFloat(text.replace('m', '')) * 1000000;
            } else {
                return parseFloat(text) || 0;
            }
        }

        /**
         * Check if item has any badges
         * @param {Element} itemElem - Item container element
         * @returns {boolean} True if item has any badge elements
         */
        itemHasBadges(itemElem) {
            return !!(
                itemElem.querySelector('.mwi-badge-price-bid') ||
                itemElem.querySelector('.mwi-badge-price-ask') ||
                itemElem.querySelector('.mwi-stack-price')
            );
        }

        /**
         * Disable and cleanup
         */
        disable() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.providers.clear();
            this.processedItems = new WeakSet();
            this.currentInventoryElem = null;
            this.isInitialized = false;
        }
    }

    const inventoryBadgeManager = new InventoryBadgeManager();

    /**
     * Inventory Sort Module
     * Sorts inventory items by Ask/Bid price with optional stack value badges
     */


    /**
     * InventorySort class manages inventory sorting and price badges
     */
    class InventorySort {
        constructor() {
            this.currentMode = 'none'; // 'ask', 'bid', 'none'
            this.unregisterHandlers = [];
            this.controlsContainer = null;
            this.currentInventoryElem = null;
            this.warnedItems = new Set(); // Track items we've already warned about
            this.isCalculating = false; // Guard flag to prevent recursive calls
            this.isInitialized = false;
            this.itemsUpdatedHandler = null;
            this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
            this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('invSort', async (value) => {
                if (value) {
                    await this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize inventory sort feature
         */
        async initialize() {
            if (!config.getSetting('invSort')) {
                return;
            }

            if (this.unregisterHandlers.length > 0) {
                return;
            }

            // Load persisted settings
            await this.loadSettings();

            // Check if inventory is already open
            const existingInv = document.querySelector('[class*="Inventory_items"]');
            if (existingInv) {
                this.currentInventoryElem = existingInv;
                this.injectSortControls(existingInv);
                this.applyCurrentSort();
            }

            // Watch for inventory panel (for future opens/reloads)
            const unregister = domObserver.onClass('InventorySort', 'Inventory_items', (elem) => {
                this.currentInventoryElem = elem;
                this.injectSortControls(elem);
                this.applyCurrentSort();
            });
            this.unregisterHandlers.push(unregister);

            // Register with badge manager for coordinated rendering
            inventoryBadgeManager.registerProvider(
                'inventory-stack-price',
                (itemElem) => this.renderBadgesForItem(itemElem),
                50 // Priority: render before bid/ask badges (lower = earlier)
            );

            // Store handler reference for cleanup with debouncing
            this.itemsUpdatedHandler = () => {
                clearTimeout(this.itemsUpdatedDebounceTimer);
                this.itemsUpdatedDebounceTimer = setTimeout(() => {
                    if (this.currentInventoryElem) {
                        this.applyCurrentSort();
                    }
                }, this.DEBOUNCE_DELAY);
            };

            // Listen for inventory changes to recalculate prices
            dataManager.on('items_updated', this.itemsUpdatedHandler);

            // Listen for market data updates to refresh badges
            this.setupMarketDataListener();

            this.isInitialized = true;
        }

        /**
         * Setup listener for market data updates
         */
        setupMarketDataListener() {
            // If market data isn't loaded yet, retry periodically
            if (!marketAPI.isLoaded()) {
                let retryCount = 0;
                const maxRetries = 10;
                const retryInterval = 500; // 500ms between retries

                const retryCheck = setInterval(() => {
                    retryCount++;

                    if (marketAPI.isLoaded()) {
                        clearInterval(retryCheck);

                        // Refresh if inventory is still open
                        if (this.currentInventoryElem) {
                            this.applyCurrentSort();
                        }
                    } else if (retryCount >= maxRetries) {
                        console.warn('[InventorySort] Market data still not available after', maxRetries, 'retries');
                        clearInterval(retryCheck);
                    }
                }, retryInterval);

                this.timerRegistry.registerInterval(retryCheck);
            }
        }

        /**
         * Load settings from storage
         */
        async loadSettings() {
            try {
                const settings = await storage.getJSON('inventorySort', 'settings');
                if (settings && settings.mode) {
                    this.currentMode = settings.mode;
                }
            } catch (error) {
                console.error('[InventorySort] Failed to load settings:', error);
            }
        }

        /**
         * Save settings to storage
         */
        saveSettings() {
            try {
                storage.setJSON(
                    'inventorySort',
                    {
                        mode: this.currentMode,
                    },
                    'settings',
                    true // immediate write for user preference
                );
            } catch (error) {
                console.error('[InventorySort] Failed to save settings:', error);
            }
        }

        /**
         * Inject sort controls into inventory panel
         * @param {Element} inventoryElem - Inventory items container
         */
        injectSortControls(inventoryElem) {
            // Set current inventory element
            this.currentInventoryElem = inventoryElem;

            // Check if controls already exist
            if (this.controlsContainer && document.body.contains(this.controlsContainer)) {
                return;
            }

            // Create controls container
            this.controlsContainer = document.createElement('div');
            this.controlsContainer.className = 'mwi-inventory-sort-controls';
            this.controlsContainer.style.cssText = `
            color: ${config.COLOR_ACCENT};
            font-size: 0.875rem;
            text-align: left;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        `;

            // Sort label and buttons
            const sortLabel = document.createElement('span');
            sortLabel.textContent = 'Sort: ';

            const askButton = this.createSortButton('Ask', 'ask');
            const bidButton = this.createSortButton('Bid', 'bid');
            const noneButton = this.createSortButton('None', 'none');

            // Assemble controls
            this.controlsContainer.appendChild(sortLabel);
            this.controlsContainer.appendChild(askButton);
            this.controlsContainer.appendChild(bidButton);
            this.controlsContainer.appendChild(noneButton);

            // Insert before inventory
            inventoryElem.insertAdjacentElement('beforebegin', this.controlsContainer);

            // Update button states
            this.updateButtonStates();
        }

        /**
         * Create a sort button
         * @param {string} label - Button label
         * @param {string} mode - Sort mode
         * @returns {Element} Button element
         */
        createSortButton(label, mode) {
            const button = document.createElement('button');
            button.textContent = label;
            button.dataset.mode = mode;
            button.style.cssText = `
            border-radius: 3px;
            padding: 4px 12px;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        `;

            button.addEventListener('click', () => {
                this.setSortMode(mode);
            });

            return button;
        }

        /**
         * Update button visual states based on current mode
         */
        updateButtonStates() {
            if (!this.controlsContainer) return;

            const buttons = this.controlsContainer.querySelectorAll('button');
            buttons.forEach((button) => {
                const isActive = button.dataset.mode === this.currentMode;

                if (isActive) {
                    button.style.backgroundColor = config.COLOR_ACCENT;
                    button.style.color = 'black';
                    button.style.fontWeight = 'bold';
                } else {
                    button.style.backgroundColor = '#444';
                    button.style.color = '${config.COLOR_TEXT_SECONDARY}';
                    button.style.fontWeight = 'normal';
                }
            });
        }

        /**
         * Set sort mode and apply sorting
         * @param {string} mode - Sort mode ('ask', 'bid', 'none')
         */
        setSortMode(mode) {
            this.currentMode = mode;
            this.saveSettings();
            this.updateButtonStates();

            // Clear badge manager's processed tracking to force re-render with new mode
            inventoryBadgeManager.clearProcessedTracking();

            // Remove all existing stack price badges so they can be recreated with new settings
            const badges = document.querySelectorAll('.mwi-stack-price');
            badges.forEach((badge) => badge.remove());

            this.applyCurrentSort();
        }

        /**
         * Apply current sort mode to inventory
         */
        async applyCurrentSort() {
            if (!this.currentInventoryElem) return;

            // Prevent recursive calls (guard against DOM observer triggering during calculation)
            if (this.isCalculating) return;
            this.isCalculating = true;

            const inventoryElem = this.currentInventoryElem;

            // Trigger badge manager to calculate prices and render badges
            await inventoryBadgeManager.renderAllBadges();

            // Process each category
            for (const categoryDiv of inventoryElem.children) {
                // Get category name
                const categoryButton = categoryDiv.querySelector('[class*="Inventory_categoryButton"]');
                if (!categoryButton) continue;

                const categoryName = categoryButton.textContent.trim();

                // Equipment category: check setting for whether to enable sorting
                // Loots category: always disable sorting (but allow badges)
                const isEquipmentCategory = categoryName === 'Equipment';
                const isLootsCategory = categoryName === 'Loots';
                const shouldSort = isLootsCategory
                    ? false
                    : isEquipmentCategory
                      ? config.getSetting('invSort_sortEquipment')
                      : true;

                // Ensure category label stays at top
                const label = categoryDiv.querySelector('[class*="Inventory_label"]');
                if (label) {
                    label.style.order = Number.MIN_SAFE_INTEGER;
                }

                // Get all item elements
                const itemElems = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');

                if (shouldSort && this.currentMode !== 'none') {
                    // Sort by price (prices already calculated by badge manager)
                    this.sortItemsByPrice(itemElems, this.currentMode);
                } else {
                    // Reset to default order
                    itemElems.forEach((itemElem) => {
                        itemElem.style.order = 0;
                    });
                }
            }

            // Clear guard flag
            this.isCalculating = false;
        }

        /**
         * Sort items by price (ask or bid)
         * @param {NodeList} itemElems - Item elements
         * @param {string} mode - 'ask' or 'bid'
         */
        sortItemsByPrice(itemElems, mode) {
            // Convert NodeList to array with values
            const items = Array.from(itemElems).map((elem) => ({
                elem,
                value: parseFloat(elem.dataset[mode + 'Value']) || 0,
            }));

            // Sort by value descending (highest first)
            items.sort((a, b) => b.value - a.value);

            // Assign sequential order values (0, 1, 2, 3...)
            items.forEach((item, index) => {
                item.elem.style.order = index;
            });
        }

        /**
         * Render stack price badge for a single item (called by badge manager)
         * @param {Element} itemElem - Item container element
         */
        renderBadgesForItem(itemElem) {
            // Determine if badges should be shown and which value to use
            let showBadges = false;
            let badgeValueKey = null;

            if (this.currentMode === 'none') {
                // When sort mode is 'none', check invSort_badgesOnNone setting
                const badgesOnNone = config.getSettingValue('invSort_badgesOnNone', 'None');
                if (badgesOnNone !== 'None') {
                    showBadges = true;
                    badgeValueKey = badgesOnNone.toLowerCase() + 'Value'; // 'askValue' or 'bidValue'
                }
            } else {
                // When sort mode is 'ask' or 'bid', check invSort_showBadges setting
                const showBadgesSetting = config.getSetting('invSort_showBadges');
                if (showBadgesSetting) {
                    showBadges = true;
                    badgeValueKey = this.currentMode + 'Value'; // 'askValue' or 'bidValue'
                }
            }

            // Show badge if enabled and doesn't already exist
            if (showBadges && badgeValueKey) {
                const stackValue = parseFloat(itemElem.dataset[badgeValueKey]) || 0;

                if (stackValue > 0 && !itemElem.querySelector('.mwi-stack-price')) {
                    this.renderPriceBadge(itemElem, stackValue);
                }
            }
        }

        /**
         * Update price badges on all items (legacy method - now delegates to manager)
         */
        updatePriceBadges() {
            inventoryBadgeManager.renderAllBadges();
        }

        /**
         * Render price badge on item
         * @param {Element} itemElem - Item container element
         * @param {number} stackValue - Total stack value
         */
        renderPriceBadge(itemElem, stackValue) {
            // Ensure item has relative positioning
            itemElem.style.position = 'relative';

            // Create badge element
            const badge = document.createElement('div');
            badge.className = 'mwi-stack-price';
            badge.style.cssText = `
            position: absolute;
            top: 2px;
            right: 2px;
            z-index: 1;
            color: ${config.COLOR_ACCENT};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: right;
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
        `;
            badge.textContent = formatters_js.formatKMB(stackValue, 2);

            // Insert into item
            const itemInner = itemElem.querySelector('[class*="Item_item"]');
            if (itemInner) {
                itemInner.appendChild(badge);
            }
        }

        /**
         * Refresh badges (called when badge setting changes)
         */
        refresh() {
            // Update controls container color
            if (this.controlsContainer) {
                this.controlsContainer.style.color = config.COLOR_ACCENT;
            }

            // Update button states (which includes colors)
            this.updateButtonStates();

            // Update all price badge colors
            document.querySelectorAll('.mwi-stack-price').forEach((badge) => {
                badge.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable and cleanup
         */
        disable() {
            // Clear debounce timer
            clearTimeout(this.itemsUpdatedDebounceTimer);
            this.itemsUpdatedDebounceTimer = null;

            if (this.itemsUpdatedHandler) {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
                this.itemsUpdatedHandler = null;
            }

            this.timerRegistry.clearAll();

            // Unregister from badge manager
            inventoryBadgeManager.unregisterProvider('inventory-stack-price');

            // Remove controls
            if (this.controlsContainer) {
                this.controlsContainer.remove();
                this.controlsContainer = null;
            }

            // Remove all badges
            const badges = document.querySelectorAll('.mwi-stack-price');
            badges.forEach((badge) => badge.remove());

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            this.currentInventoryElem = null;
            this.isInitialized = false;
        }
    }

    const inventorySort = new InventorySort();
    inventorySort.setupSettingListener();

    /**
     * Inventory Badge Prices Module
     * Shows ask/bid price badges on inventory item icons
     * Works independently of inventory sorting feature
     */


    /**
     * InventoryBadgePrices class manages price badge overlays on inventory items
     */
    class InventoryBadgePrices {
        constructor() {
            this.unregisterHandlers = [];
            this.currentInventoryElem = null;
            this.warnedItems = new Set();
            this.isCalculating = false;
            this.isInitialized = false;
            this.itemsUpdatedHandler = null;
            this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
            this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup setting change listener (always active, even when feature is disabled)
         */
        setupSettingListener() {
            // Listen for main toggle changes
            config.onSettingChange('invBadgePrices', (enabled) => {
                if (enabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_invBadge_bid', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });

            config.onSettingChange('color_invBadge_ask', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize badge prices feature
         */
        initialize() {
            if (!config.getSetting('invBadgePrices')) {
                return;
            }

            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Check if inventory is already open
            const existingInv = document.querySelector('[class*="Inventory_items"]');
            if (existingInv) {
                this.currentInventoryElem = existingInv;
                this.updateBadges();
            }

            // Watch for inventory panel
            const unregister = domObserver.onClass('InventoryBadgePrices', 'Inventory_items', (elem) => {
                this.currentInventoryElem = elem;
                this.updateBadges();
            });
            this.unregisterHandlers.push(unregister);

            // Register with badge manager for coordinated rendering
            inventoryBadgeManager.registerProvider(
                'inventory-badge-prices',
                (itemElem) => this.renderBadgesForItem(itemElem),
                100 // Priority: render after stack prices
            );

            // Store handler reference for cleanup with debouncing
            this.itemsUpdatedHandler = () => {
                clearTimeout(this.itemsUpdatedDebounceTimer);
                this.itemsUpdatedDebounceTimer = setTimeout(() => {
                    if (this.currentInventoryElem) {
                        this.updateBadges();
                    }
                }, this.DEBOUNCE_DELAY);
            };

            // Listen for inventory changes to recalculate prices
            dataManager.on('items_updated', this.itemsUpdatedHandler);

            // Listen for market data updates
            this.setupMarketDataListener();
        }

        /**
         * Setup listener for market data updates
         */
        setupMarketDataListener() {
            if (!marketAPI.isLoaded()) {
                let retryCount = 0;
                const maxRetries = 10;
                const retryInterval = 500;

                const retryCheck = setInterval(() => {
                    retryCount++;

                    if (marketAPI.isLoaded()) {
                        clearInterval(retryCheck);
                        if (this.currentInventoryElem) {
                            this.updateBadges();
                        }
                    } else if (retryCount >= maxRetries) {
                        console.warn('[InventoryBadgePrices] Market data still not available after', maxRetries, 'retries');
                        clearInterval(retryCheck);
                    }
                }, retryInterval);

                this.timerRegistry.registerInterval(retryCheck);
            }
        }

        /**
         * Update all price badges (delegates to badge manager)
         * Skips rendering if InventorySort is active (it already handles badge rendering)
         */
        async updateBadges() {
            // Skip if InventorySort is active - it already calls renderAllBadges() in applyCurrentSort()
            // This prevents duplicate calculations when both modules are enabled
            if (inventorySort.isInitialized && config.getSetting('invSort')) {
                return;
            }

            await inventoryBadgeManager.renderAllBadges();
        }

        /**
         * Render price badges for a single item (called by badge manager)
         * @param {Element} itemElem - Item container element
         */
        renderBadgesForItem(itemElem) {
            // Get per-item prices from dataset
            const bidPrice = parseFloat(itemElem.dataset.bidPrice) || 0;
            const askPrice = parseFloat(itemElem.dataset.askPrice) || 0;

            // Show badges if they have values and don't already exist
            if (bidPrice > 0 && !itemElem.querySelector('.mwi-badge-price-bid')) {
                this.renderPriceBadge(itemElem, bidPrice, 'bid');
            }
            if (askPrice > 0 && !itemElem.querySelector('.mwi-badge-price-ask')) {
                this.renderPriceBadge(itemElem, askPrice, 'ask');
            }
        }

        /**
         * Render all badges (legacy method - now delegates to manager)
         */
        renderBadges() {
            inventoryBadgeManager.renderAllBadges();
        }

        /**
         * Render price badge on item
         * @param {Element} itemElem - Item container element
         * @param {number} price - Per-item price
         * @param {string} type - 'bid' or 'ask'
         */
        renderPriceBadge(itemElem, price, type) {
            itemElem.style.position = 'relative';

            const badge = document.createElement('div');
            badge.className = `mwi-badge-price-${type}`;

            // Position: vertically centered on left (ask) or right (bid)
            const isAsk = type === 'ask';
            const color = isAsk ? config.COLOR_INVBADGE_ASK : config.COLOR_INVBADGE_BID;

            badge.style.cssText = `
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            ${isAsk ? 'left: 2px;' : 'right: 2px;'}
            z-index: 1;
            color: ${color};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: ${isAsk ? 'left' : 'right'};
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
        `;
            badge.textContent = formatters_js.formatKMB(Math.round(price), 0);

            const itemInner = itemElem.querySelector('[class*="Item_item"]');
            if (itemInner) {
                itemInner.appendChild(badge);
            }
        }

        /**
         * Refresh badges (called when settings change)
         */
        refresh() {
            // Clear badge manager's processed tracking to force re-render
            inventoryBadgeManager.clearProcessedTracking();

            // Remove all existing badges so they can be recreated with new settings
            const badges = document.querySelectorAll('.mwi-badge-price-bid, .mwi-badge-price-ask');
            badges.forEach((badge) => badge.remove());

            // Trigger re-render
            this.updateBadges();
        }

        /**
         * Disable and cleanup
         */
        disable() {
            // Clear debounce timer
            clearTimeout(this.itemsUpdatedDebounceTimer);
            this.itemsUpdatedDebounceTimer = null;

            if (this.itemsUpdatedHandler) {
                dataManager.off('items_updated', this.itemsUpdatedHandler);
                this.itemsUpdatedHandler = null;
            }

            inventoryBadgeManager.unregisterProvider('inventory-badge-prices');

            const badges = document.querySelectorAll('.mwi-badge-price-bid, .mwi-badge-price-ask');
            badges.forEach((badge) => badge.remove());

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            this.timerRegistry.clearAll();

            this.currentInventoryElem = null;
            this.isInitialized = false;
        }
    }

    const inventoryBadgePrices = new InventoryBadgePrices();

    inventoryBadgePrices.setupSettingListener();

    /**
     * Dungeon Token Shop Tooltips
     * Adds shop item lists to dungeon token tooltips with market pricing
     */


    /**
     * Dungeon token HRIDs
     */
    const DUNGEON_TOKENS = {
        '/items/chimerical_token': 'Chimerical Token',
        '/items/sinister_token': 'Sinister Token',
        '/items/enchanted_token': 'Enchanted Token',
        '/items/pirate_token': 'Pirate Token',
    };

    /**
     * DungeonTokenTooltips class handles injecting shop item lists into dungeon token tooltips
     */
    class DungeonTokenTooltips {
        constructor() {
            this.unregisterObserver = null;
            this.isActive = false;
            this.isInitialized = false;
            this.itemNameToHridCache = null; // Lazy-loaded reverse lookup cache
            this.itemNameToHridCacheSource = null; // Track source for invalidation
        }

        /**
         * Initialize the dungeon token tooltips feature
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.isFeatureEnabled('dungeonTokenTooltips')) {
                return;
            }

            this.isInitialized = true;

            // Register with centralized DOM observer
            this.setupObserver();
        }

        /**
         * Set up observer to watch for tooltip elements
         */
        setupObserver() {
            // Register with centralized DOM observer to watch for tooltip poppers
            this.unregisterObserver = domObserver.onClass('DungeonTokenTooltips', 'MuiTooltip-popper', (tooltipElement) => {
                this.handleTooltip(tooltipElement);
            });

            this.isActive = true;
        }

        /**
         * Handle a tooltip element
         * @param {Element} tooltipElement - The tooltip popper element
         */
        async handleTooltip(tooltipElement) {
            // Guard against duplicate processing
            if (tooltipElement.dataset.dungeonProcessed) {
                return;
            }
            tooltipElement.dataset.dungeonProcessed = 'true';

            // Check if it's a collection tooltip
            const collectionContent = tooltipElement.querySelector('div.Collection_tooltipContent__2IcSJ');
            const isCollectionTooltip = !!collectionContent;

            // Check if it's a regular item tooltip
            const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
            const isItemTooltip = !!nameElement;

            if (!isCollectionTooltip && !isItemTooltip) {
                return; // Not a tooltip we can enhance
            }

            // Extract item name from appropriate element
            let itemName;
            if (isCollectionTooltip) {
                const collectionNameElement = tooltipElement.querySelector('div.Collection_name__10aep');
                if (!collectionNameElement) {
                    return;
                }
                itemName = collectionNameElement.textContent.trim();
            } else {
                itemName = nameElement.textContent.trim();
            }

            // Get the item HRID from the name
            const itemHrid = this.extractItemHridFromName(itemName);

            if (!itemHrid) {
                return;
            }

            // Check if this is a dungeon token
            if (!DUNGEON_TOKENS[itemHrid]) {
                return; // Not a dungeon token
            }

            // Get shop items for this token
            const shopItems = this.getShopItemsForToken(itemHrid);

            if (!shopItems || shopItems.length === 0) {
                return; // No shop items found
            }

            // Inject shop items display
            this.injectShopItemsDisplay(tooltipElement, shopItems, isCollectionTooltip);

            // Fix tooltip overflow
            dom.fixTooltipOverflow(tooltipElement);
        }

        /**
         * Extract item HRID from item name
         * @param {string} itemName - Item name from tooltip
         * @returns {string|null} Item HRID or null if not found
         */
        extractItemHridFromName(itemName) {
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.itemDetailMap) {
                return null;
            }

            // Return cached map if source data hasn't changed (handles character switch)
            if (this.itemNameToHridCache && this.itemNameToHridCacheSource === gameData.itemDetailMap) {
                return this.itemNameToHridCache.get(itemName) || null;
            }

            // Build itemName -> HRID map
            const map = new Map();
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                map.set(item.name, hrid);
            }

            // Only cache if we got actual entries (avoid poisoning with empty map)
            if (map.size > 0) {
                this.itemNameToHridCache = map;
                this.itemNameToHridCacheSource = gameData.itemDetailMap;
            }

            // Return result from newly built map
            return map.get(itemName) || null;
        }

        /**
         * Get shop items purchasable with a specific token with market prices
         * @param {string} tokenHrid - Dungeon token HRID
         * @returns {Array} Array of shop items with pricing data (only tradeable items)
         */
        getShopItemsForToken(tokenHrid) {
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.shopItemDetailMap || !gameData.itemDetailMap) {
                return [];
            }

            // Filter shop items by token cost
            const shopItems = Object.values(gameData.shopItemDetailMap)
                .filter((shopItem) => shopItem.costs && shopItem.costs[0]?.itemHrid === tokenHrid)
                .map((shopItem) => {
                    const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
                    const tokenCost = shopItem.costs[0].count;

                    // Get market ask price (same as networth calculation)
                    const prices = marketData_js.getItemPrices(shopItem.itemHrid, 0);
                    const askPrice = prices?.ask || null;

                    // Only include tradeable items (items with ask prices)
                    if (!askPrice || askPrice <= 0) {
                        return null;
                    }

                    // Calculate gold per token efficiency
                    const goldPerToken = askPrice / tokenCost;

                    return {
                        name: itemDetails?.name || 'Unknown Item',
                        hrid: shopItem.itemHrid,
                        cost: tokenCost,
                        askPrice: askPrice,
                        goldPerToken: goldPerToken,
                    };
                })
                .filter((item) => item !== null) // Remove non-tradeable items
                .sort((a, b) => b.goldPerToken - a.goldPerToken); // Sort by efficiency (best first)

            return shopItems;
        }

        /**
         * Inject shop items display into tooltip
         * @param {Element} tooltipElement - Tooltip element
         * @param {Array} shopItems - Array of shop items with pricing data
         * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
         */
        injectShopItemsDisplay(tooltipElement, shopItems, isCollectionTooltip = false) {
            const tooltipText = isCollectionTooltip
                ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
                : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

            if (!tooltipText) {
                return;
            }

            if (tooltipText.querySelector('.dungeon-token-shop-injected')) {
                return;
            }

            // Create shop items display container
            const shopDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'dungeon-token-shop-injected');

            // Build table HTML content
            let html = '<div style="margin-top: 8px;"><strong>Token Shop Value:</strong></div>';
            html += '<table style="width: 100%; margin-top: 4px; font-size: 12px;">';
            html += '<tr style="border-bottom: 1px solid #444;">';
            html += '<th style="text-align: left; padding: 2px 4px;">Item</th>';
            html += '<th style="text-align: right; padding: 2px 4px;">Cost</th>';
            html += '<th style="text-align: right; padding: 2px 4px;">Ask Price</th>';
            html += '<th style="text-align: right; padding: 2px 4px;">Gold/Token</th>';
            html += '</tr>';

            shopItems.forEach((item) => {
                // Highlight all items with the best gold/token value
                const bestGoldPerToken = shopItems[0].goldPerToken;
                const isBestValue = item.goldPerToken === bestGoldPerToken;
                const rowStyle = isBestValue ? 'background-color: rgba(4, 120, 87, 0.2);' : '';

                html += `<tr style="${rowStyle}">`;
                html += `<td style="padding: 2px 4px;">${item.name}</td>`;
                html += `<td style="text-align: right; padding: 2px 4px;">${formatters_js.numberFormatter(item.cost)}</td>`;
                html += `<td style="text-align: right; padding: 2px 4px;">${formatters_js.numberFormatter(item.askPrice)}</td>`;
                html += `<td style="text-align: right; padding: 2px 4px; font-weight: ${isBestValue ? 'bold' : 'normal'};">${formatters_js.numberFormatter(Math.floor(item.goldPerToken))}</td>`;
                html += '</tr>';
            });

            html += '</table>';

            shopDiv.innerHTML = html;

            tooltipText.appendChild(shopDiv);
        }

        /**
         * Cleanup
         */
        cleanup() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            this.isActive = false;
            this.isInitialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const dungeonTokenTooltips = new DungeonTokenTooltips();

    var dungeonTokenTooltips$1 = {
        name: 'Dungeon Token Tooltips',
        initialize: async () => {
            await dungeonTokenTooltips.initialize();
        },
        cleanup: () => {
            dungeonTokenTooltips.cleanup();
        },
        disable: () => {
            dungeonTokenTooltips.disable();
        },
    };

    /**
     * Market Library
     * Market, inventory, and economy features
     *
     * Exports to: window.Toolasha.Market
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Market = {
        tooltipPrices,
        expectedValueCalculator,
        tooltipConsumables,
        marketFilter,
        autoFillPrice,
        autoClickMax,
        itemCountDisplay,
        listingPriceDisplay,
        estimatedListingAge,
        marketOrderTotals,
        marketHistoryViewer,
        philoCalculator,
        tradeHistory,
        tradeHistoryDisplay,
        networkAlert,
        profitCalculator,
        alchemyProfitCalculator,
        networthFeature,
        inventoryBadgeManager,
        inventorySort,
        inventoryBadgePrices,
        dungeonTokenTooltips: dungeonTokenTooltips$1,
    };

    console.log('[Toolasha] Market library loaded');

})(Toolasha.Core.config, Toolasha.Core.dataManager, Toolasha.Core.domObserver, Toolasha.Core.marketAPI, Toolasha.Utils.equipmentParser, Toolasha.Utils.houseEfficiency, Toolasha.Utils.efficiency, Toolasha.Utils.teaParser, Toolasha.Utils.bonusRevenueCalculator, Toolasha.Utils.marketData, Toolasha.Utils.profitConstants, Toolasha.Utils.profitHelpers, Toolasha.Utils.buffParser, Toolasha.Utils.actionCalculator, Toolasha.Utils.tokenValuation, Toolasha.Utils.enhancementCalculator, Toolasha.Utils.formatters, Toolasha.Utils.enhancementConfig, Toolasha.Utils.dom, Toolasha.Utils.timerRegistry, Toolasha.Core.storage, Toolasha.Utils.cleanupRegistry, Toolasha.Utils.domObserverHelpers, Toolasha.Utils.enhancementMultipliers, Toolasha.Core.webSocketHook, Toolasha.Utils.abilityCalc, Toolasha.Utils.houseCostCalculator);
