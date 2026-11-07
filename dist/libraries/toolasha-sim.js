/**
 * Toolasha Sim Library
 * Headless combat simulator (engine, adapter, runners, worker scripts) shared by the
 * Combat, UI and UI2 libraries so there is exactly one copy and one runner state
 * Version: 3.30.8
 * License: CC-BY-NC-SA-4.0
 */

(function (dataManager, storage, loadoutState, expectedValueCalculator, profitHelpers_js, profitConstants_js, config, marketData_js, i18n_js, domObserver, marketplaceSession_js, teaParser_js, actionCalculator_js, efficiency_js, materialCalculator_js, equipmentParser_js) {
    'use strict';

    /**
     * Combat Level formula helpers.
     *
     * MWI's official Combat Level formula (per the in-game Game Guide) is:
     *   raw = 0.1 * (Stamina + Intelligence + Attack + Defense + max(Melee, Ranged, Magic))
     *       + 0.5 * max(Attack, Defense, Melee, Ranged, Magic)
     *
     * Applied to current whole skill levels, `raw` naturally has at most one meaningful decimal
     * digit (the 0.1/0.5 coefficients on integer inputs cannot produce more). MWI's native sidebar
     * floors this to an integer for display; this module exposes the unfloored value so the decimal
     * sidebar display can show it (e.g. 133.2 next to a native 133). This same raw/unfloored value is
     * SERVER-CONFIRMED (direct MWI developer evidence) to also be the Level Malus mechanic input -
     * see calculateLevelGapDebuff()'s doc comment in combat-sim-adapter.js - not the floored native
     * integer.
     *
     * This must never be confused with XP-within-level interpolation: inventing a fractional skill
     * level from XP progress toward the next level is a different, invalid metric for this mechanic
     * and must not feed into this formula.
     */


    /**
     * Apply MWI's official Combat Level formula to a set of whole skill levels, rounded to one
     * decimal place. The rounding only clears IEEE-754 float noise from the 0.1/0.5 coefficients
     * (e.g. 0.1 * 3 === 0.30000000000000004 in JS) - it never discards real precision, since integer
     * inputs cannot produce more than one meaningful decimal digit.
     * @param {{stamina: number, intelligence: number, attack: number, defense: number, melee: number, ranged: number, magic: number}} levels
     * @returns {number}
     */
    function calculateRawCombatLevel(levels) {
        const { stamina, intelligence, attack, defense, melee, ranged, magic } = levels;
        const combatStyleMax = Math.max(melee, ranged, magic);
        const primaryMax = Math.max(attack, defense, melee, ranged, magic);
        const raw = 0.1 * (stamina + intelligence + attack + defense + combatStyleMax) + 0.5 * primaryMax;
        return Math.round(raw * 10) / 10;
    }

    /**
     * Game i18n Bridge
     *
     * Obtains the game's i18next instance from the React fiber tree and provides
     * locale-independent translation of game data names (items, actions, monsters,
     * skills, etc.). Falls back to the English name when the i18n instance is
     * unavailable or the key is missing.
     */

    let cachedI18n = null;

    /**
     * Walk the React fiber tree from #root to find the i18next instance.
     * @returns {import('i18next').i18n | null}
     */
    function getGameI18n() {
        if (cachedI18n) return cachedI18n;
        if (typeof document === 'undefined') return null;

        const root = document.getElementById('root');
        const fiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
        if (!fiber) return null;

        const stack = [fiber];
        while (stack.length > 0) {
            const f = stack.pop();
            if (!f) continue;
            try {
                const props = f.memoizedProps || {};
                if (props.i18n && typeof props.i18n.t === 'function') {
                    cachedI18n = props.i18n;
                    return cachedI18n;
                }
                if (props.value?.i18n && typeof props.value.i18n.t === 'function') {
                    cachedI18n = props.value.i18n;
                    return cachedI18n;
                }
            } catch (error) {
                console.error('[GameI18n] Fiber access error during tree walk:', error);
            }
            if (f.sibling) stack.push(f.sibling);
            if (f.child) stack.push(f.child);
        }
        return null;
    }

    /**
     * Translate a game data name via the game's i18next instance.
     * @param {string} namespace - i18n namespace (e.g. 'itemNames')
     * @param {string} hrid - Game data HRID (e.g. '/items/abyssal_essence')
     * @param {string} [fallback=''] - English name to fall back to
     * @returns {string} Translated name or fallback
     */
    function translateGameName(namespace, hrid, fallback = '') {
        if (!hrid) return fallback;
        const i18n = getGameI18n();
        if (!i18n) return fallback;

        const key = `${namespace}.${hrid}`;
        try {
            const translated = i18n.t(key);
            // i18next returns the key itself when no translation exists
            if (translated === key) return fallback;
            return translated;
        } catch (error) {
            console.error('[GameI18n] i18n.t() failed for key:', key, error);
            return fallback;
        }
    }

    const getItemName = (hrid, fallback = '') => translateGameName('itemNames', hrid, fallback);

    /**
     * Game Data Lookup Utilities
     *
     * Centralized functions for resolving display names to HRIDs, plus locale-independent
     * resolution via icon sprite references (see below) - prefer the sprite-based functions
     * over the name-based ones wherever a `<use>` element is reachable, since display names are
     * translated client-side and the name-based functions below only ever match the client's
     * English-language data, silently failing on any other game locale.
     */


    /**
     * Get the coin cost of an item from the in-game shop.
     * Returns 0 if the item is not available in the shop or not purchasable with coins.
     * @param {string} itemHrid - Item HRID
     * @returns {number} Coin cost, or 0 if not available in shop
     */
    function getShopCoinCost(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.shopItemDetailMap) return 0;

        for (const shopItem of Object.values(gameData.shopItemDetailMap)) {
            if (shopItem.itemHrid === itemHrid) {
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
     * Crafting Plan Calculator
     * Computes the optimal buy-vs-craft plan for a target item by recursively
     * comparing market price against crafting cost at each material tier.
     */


    const MAX_DEPTH = 15;

    /**
     * Find the production action that creates a given item.
     * @param {string} itemHrid
     * @returns {{ actionHrid: string, action: Object, outputCount: number } | null}
     */
    function findProductionAction(itemHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.actionDetailMap) return null;

        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!action.outputItems) continue;
            for (const output of action.outputItems) {
                if (output.itemHrid === itemHrid) {
                    return { actionHrid, action, outputCount: output.count || 1 };
                }
            }
        }
        return null;
    }

    /**
     * Get artisan tea material reduction bonus for an action type.
     * @param {string} actionType - e.g. '/action_types/brewing'
     * @returns {number} Reduction as decimal (e.g. 0.112 for 11.2%)
     */
    function getArtisanBonus(actionType) {
        try {
            const gameData = dataManager.getInitClientData();
            const equipment = dataManager.getEquipment();
            const itemDetailMap = gameData?.itemDetailMap || {};
            const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, itemDetailMap);
            const activeDrinks = dataManager.getActionDrinkSlots(actionType);
            return teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);
        } catch {
            return 0;
        }
    }

    /**
     * Compute the optimal crafting plan for an item.
     * At each node, decides whether buying from market or crafting is cheaper.
     *
     * @param {string} itemHrid - Target item
     * @param {number} quantity - How many needed
     * @param {string} [mode='ask'] - Pricing mode for market lookups
     * @param {Set} [visited] - Circular dependency guard
     * @param {Map} [memo] - Memoization cache (unit cost per itemHrid)
     * @param {number} [depth=0] - Current recursion depth
     * @param {number} [maxDepth=MAX_DEPTH] - Maximum recursion depth (1 = buy all sub-materials)
     * @param {boolean} [buyRawOnly=false] - When true, always craft items that have a recipe; only buy uncraftable items
     * @param {boolean} [forceRootCraft=false] - When true, forces the root item (depth 0) to be crafted
     * @param {number} [timeCostPerHour=0] - Gold value per hour of player time (0 = disabled)
     * @param {boolean} [skipProcessing=false] - When true, forces buy for processing actions (single input, no upgrade)
     * @returns {CraftingPlanNode}
     */
    function computeBestCraftingPlan(
        itemHrid,
        quantity = 1,
        mode = 'ask',
        visited = new Set(),
        memo = new Map(),
        depth = 0,
        maxDepth = MAX_DEPTH,
        buyRawOnly = false,
        forceRootCraft = false,
        timeCostPerHour = 0,
        skipProcessing = false
    ) {
        const itemDetails = dataManager.getItemDetails(itemHrid);
        const itemName = itemDetails?.name || itemHrid.split('/').pop();
        const isTradable = itemDetails?.isTradable ?? false;
        const artisanMode = materialCalculator_js.getArtisanMaterialMode();

        // Get market buy price (min of market ask and shop cost)
        let buyPrice = null;
        let buyPriceOutlier = false;
        if (isTradable) {
            const marketPriceInfo = marketData_js.getItemPriceOutlierInfo(itemHrid, { mode, context: 'profit', side: 'buy' });
            if (marketPriceInfo.value !== null && marketPriceInfo.value > 0) {
                buyPrice = marketPriceInfo.value;
                buyPriceOutlier = marketPriceInfo.isOutlier;
            }
        }
        const shopCost = getShopCoinCost(itemHrid);
        if (shopCost > 0 && (buyPrice === null || shopCost < buyPrice)) {
            buyPrice = shopCost;
            buyPriceOutlier = false; // Shop cost is a fixed vendor price, never a market outlier
        }

        // Coins always cost 1 each
        if (itemHrid === '/items/coin') {
            return {
                itemHrid,
                itemName: i18n_js.t('craftingPlanCalculator.coinItemName'),
                quantity,
                strategy: 'buy',
                unitCost: 1,
                totalCost: quantity,
                buyPrice: 1,
                isOutlier: false,
                craftCost: null,
                actionHrid: null,
                actionsNeeded: 0,
                children: [],
            };
        }

        // Check memo for previously computed unit cost
        if (memo.has(itemHrid)) {
            const cachedUnitCost = memo.get(itemHrid);
            const actionsNeeded =
                cachedUnitCost.strategy === 'craft' ? Math.ceil(quantity / (cachedUnitCost.outputCount || 1)) : 0;
            return {
                itemHrid,
                itemName,
                quantity,
                strategy: cachedUnitCost.strategy,
                unitCost: cachedUnitCost.unitCost,
                totalCost: cachedUnitCost.unitCost * quantity,
                buyPrice,
                isOutlier: buyPriceOutlier,
                craftCost: cachedUnitCost.craftCost,
                actionHrid: cachedUnitCost.actionHrid,
                actionsNeeded,
                children:
                    cachedUnitCost.strategy === 'craft'
                        ? cachedUnitCost.childrenTemplate.map((c) =>
                              computeBestCraftingPlan(
                                  c.itemHrid,
                                  c.isUpgrade
                                      ? actionsNeeded
                                      : materialCalculator_js.calculateTotalRequired(
                                            c.basePerAction,
                                            cachedUnitCost.artisanBonus,
                                            actionsNeeded,
                                            artisanMode
                                        ),
                                  mode,
                                  visited,
                                  memo,
                                  depth + 1,
                                  maxDepth,
                                  buyRawOnly,
                                  forceRootCraft,
                                  timeCostPerHour,
                                  skipProcessing
                              )
                          )
                        : [],
            };
        }

        // Circular dependency or depth limit — must buy
        if (visited.has(itemHrid) || depth >= maxDepth) {
            return {
                itemHrid,
                itemName,
                quantity,
                strategy: 'buy',
                unitCost: buyPrice ?? Infinity,
                totalCost: (buyPrice ?? Infinity) * quantity,
                buyPrice,
                isOutlier: buyPriceOutlier,
                craftCost: null,
                actionHrid: null,
                actionsNeeded: 0,
                children: [],
            };
        }

        // Find production action
        const production = findProductionAction(itemHrid);
        if (!production) {
            // No recipe — must buy
            const unitCost = buyPrice ?? 0;
            memo.set(itemHrid, {
                strategy: 'buy',
                unitCost,
                craftCost: null,
                actionHrid: null,
                outputCount: 1,
                childrenTemplate: [],
            });
            return {
                itemHrid,
                itemName,
                quantity,
                strategy: 'buy',
                unitCost,
                totalCost: unitCost * quantity,
                buyPrice,
                isOutlier: buyPriceOutlier,
                craftCost: null,
                actionHrid: null,
                actionsNeeded: 0,
                children: [],
            };
        }

        // Skip processing actions if flag is set
        // Processing = material conversion actions (milk → cheese, fiber → fabric, log → lumber)
        // Identified by category ending in /material or /lumber (vs equipment crafting like /feet, /crossbow)
        const isProcessingAction =
            production.action.category?.endsWith('/material') || production.action.category?.endsWith('/lumber');
        if (skipProcessing && isProcessingAction) {
            const unitCost = buyPrice ?? Infinity;
            memo.set(itemHrid, {
                strategy: 'buy',
                unitCost,
                craftCost: null,
                actionHrid: null,
                outputCount: 1,
                childrenTemplate: [],
            });
            return {
                itemHrid,
                itemName,
                quantity,
                strategy: 'buy',
                unitCost,
                totalCost: unitCost * quantity,
                buyPrice,
                isOutlier: buyPriceOutlier,
                craftCost: null,
                actionHrid: null,
                actionsNeeded: 0,
                children: [],
            };
        }

        // Recurse into crafting
        visited.add(itemHrid);
        const { actionHrid, action, outputCount } = production;
        const artisanBonus = getArtisanBonus(action.type);
        const actionsForOne = 1 / outputCount; // actions per 1 output item
        const actionsNeeded = Math.ceil(quantity / outputCount);

        let craftCostPerUnit = 0;
        const childrenTemplate = []; // { itemHrid, basePerAction, isUpgrade } for memo reconstruction

        // Input items (affected by artisan bonus)
        if (action.inputItems) {
            for (const input of action.inputItems) {
                const inputCountPerAction = input.count || 1;
                const qtyPerUnit = inputCountPerAction * (1 - artisanBonus) * actionsForOne;

                const inputQty = materialCalculator_js.calculateTotalRequired(inputCountPerAction, artisanBonus, actionsNeeded, artisanMode);
                const childPlan = computeBestCraftingPlan(
                    input.itemHrid,
                    inputQty,
                    mode,
                    visited,
                    memo,
                    depth + 1,
                    maxDepth,
                    buyRawOnly,
                    forceRootCraft,
                    timeCostPerHour,
                    skipProcessing
                );

                craftCostPerUnit += childPlan.unitCost * qtyPerUnit;
                childrenTemplate.push({ itemHrid: input.itemHrid, basePerAction: inputCountPerAction, isUpgrade: false });
            }
        }

        // Upgrade item (NOT affected by artisan bonus)
        if (action.upgradeItemHrid) {
            const qtyPerUnit = actionsForOne; // 1 upgrade per action
            const upgradePlan = computeBestCraftingPlan(
                action.upgradeItemHrid,
                actionsNeeded,
                mode,
                visited,
                memo,
                depth + 1,
                maxDepth,
                buyRawOnly,
                forceRootCraft,
                timeCostPerHour,
                skipProcessing
            );

            craftCostPerUnit += upgradePlan.unitCost * qtyPerUnit;
            childrenTemplate.push({ itemHrid: action.upgradeItemHrid, basePerAction: 1, isUpgrade: true });
        }

        visited.delete(itemHrid);

        // Add time cost to craft cost if enabled
        if (timeCostPerHour > 0) {
            const gameData = dataManager.getInitClientData();
            const actionDetails = gameData?.actionDetailMap?.[actionHrid];
            if (actionDetails) {
                const stats = actionCalculator_js.calculateActionStats(actionDetails, {
                    skills: dataManager.getSkills(),
                    equipment: dataManager.getEquipment(),
                    itemDetailMap: gameData.itemDetailMap,
                });
                const effMultiplier = efficiency_js.calculateEfficiencyMultiplier(stats.totalEfficiency);
                const timePerUnit = (stats.actionTime / effMultiplier) * actionsForOne;
                craftCostPerUnit += timePerUnit * (timeCostPerHour / 3600);
            }
        }

        // Buy vs craft decision
        // When buyRawOnly is true, always craft (we only reach here if a recipe exists)
        // When forceRootCraft is true and depth === 0, always craft the root item
        const shouldBuy =
            !buyRawOnly && !(forceRootCraft && depth === 0) && buyPrice !== null && buyPrice <= craftCostPerUnit;
        const strategy = shouldBuy ? 'buy' : 'craft';
        const unitCost = shouldBuy ? buyPrice : craftCostPerUnit;

        // Cache the decision
        memo.set(itemHrid, {
            strategy,
            unitCost,
            craftCost: craftCostPerUnit,
            actionHrid: strategy === 'craft' ? actionHrid : null,
            outputCount,
            artisanBonus,
            childrenTemplate: strategy === 'craft' ? childrenTemplate : [],
        });

        // Build children for the actual quantities
        let children = [];
        if (!shouldBuy) {
            children = [];
            if (action.inputItems) {
                for (const input of action.inputItems) {
                    const inputCountPerAction = input.count || 1;
                    const inputQty = materialCalculator_js.calculateTotalRequired(inputCountPerAction, artisanBonus, actionsNeeded, artisanMode);
                    children.push(
                        computeBestCraftingPlan(
                            input.itemHrid,
                            inputQty,
                            mode,
                            visited,
                            memo,
                            depth + 1,
                            maxDepth,
                            buyRawOnly,
                            forceRootCraft,
                            timeCostPerHour,
                            skipProcessing
                        )
                    );
                }
            }
            if (action.upgradeItemHrid) {
                children.push(
                    computeBestCraftingPlan(
                        action.upgradeItemHrid,
                        actionsNeeded,
                        mode,
                        visited,
                        memo,
                        depth + 1,
                        maxDepth,
                        buyRawOnly,
                        forceRootCraft,
                        timeCostPerHour,
                        skipProcessing
                    )
                );
            }
        }

        return {
            itemHrid,
            itemName,
            quantity,
            strategy,
            unitCost,
            totalCost: unitCost * quantity,
            buyPrice,
            isOutlier: buyPriceOutlier,
            craftCost: craftCostPerUnit,
            actionHrid: strategy === 'craft' ? actionHrid : null,
            actionsNeeded: strategy === 'craft' ? actionsNeeded : 0,
            children,
        };
    }

    /**
     * Dungeon Key Cost
     * Single entry point for pricing a dungeon key (entry key or chest key) under the
     * `profitCalc_keyPricingMode` setting — ask, bid, or "cheapest" (buy vs. craft, reusing Best
     * Crafting Plan's own buy-vs-craft engine headlessly, no action panel required).
     */


    const KEY_PRICING_MODE_CHEAPEST = 'cheapest';

    /**
     * Get the raw `profitCalc_keyPricingMode` setting value.
     * @returns {string} 'ask' | 'bid' | 'cheapest'
     */
    function getKeyPricingModeSetting() {
        return config.getSettingValue('profitCalc_keyPricingMode') || 'ask';
    }

    /**
     * Compute the cheapest way to acquire a dungeon key: buy from market, or craft it, using the
     * same buy-vs-craft decision Best Crafting Plan already makes for any item. The buy-side price
     * basis is derived from the global profit-pricing-mode setting (respecting whichever of
     * ask/bid the player already uses for buy-side profit math), not hardcoded.
     * @param {string} keyHrid
     * @param {number} [quantity=1]
     * @returns {{strategy: 'buy'|'craft', unitCost: number, isOutlier: boolean, plan: Object|null}}
     *   `plan` is the full Best Crafting Plan tree when crafting wins (for a materials/craft-steps
     *   breakdown), else null. `isOutlier` reflects whether the root item's own market price (shown
     *   regardless of which strategy won) was substituted by the market-data outlier guard.
     */
    function getCheapestKeyCost(keyHrid, quantity = 1) {
        const buyMode = marketData_js.getPricingMode('profit', 'buy');
        const plan = computeBestCraftingPlan(keyHrid, quantity, buyMode);
        return {
            strategy: plan.strategy,
            unitCost: plan.unitCost,
            isOutlier: plan.isOutlier || false,
            plan: plan.strategy === 'craft' ? plan : null,
        };
    }

    /**
     * Price a dungeon key under the player's selected key-pricing mode, along with whether that
     * price was substituted by the market-data outlier guard - the mirror of `getKeyPrice()` for
     * callers that want to show a warning icon.
     * @param {string} keyHrid
     * @returns {{price: number|null, isOutlier: boolean}}
     */
    function getKeyPriceInfo(keyHrid) {
        const mode = getKeyPricingModeSetting();

        if (mode === KEY_PRICING_MODE_CHEAPEST) {
            const { unitCost, isOutlier } = getCheapestKeyCost(keyHrid);
            return { price: Number.isFinite(unitCost) ? unitCost : null, isOutlier };
        }

        const priceInfo = marketData_js.getItemPriceOutlierInfo(keyHrid, { mode });
        if (priceInfo.value === null) return { price: null, isOutlier: false };
        return { price: priceInfo.value, isOutlier: priceInfo.isOutlier };
    }

    /**
     * Combat constants shared across bundles
     *
     * Stateless game-data tables that features outside the combat simulator also need (key costs for
     * chest analytics and risk of ruin, shrine hrids for the sim export). They live here, not in the
     * simulator adapter, so importing them never pulls the adapter and its dependencies into a bundle.
     */

    /**
     * The five current combat-relevant guild Shrines (CSIM-AUD-021, UI-002). Effect construction is
     * fully data-driven (see combat-sim/engine/shrine.js) - this list only identifies which shrine
     * hrids the Sim Editor and DTO builders should carry, never their formulas.
     */
    const COMBAT_SHRINE_HRIDS = [
        '/guild_shrines/force',
        '/guild_shrines/tempo',
        '/guild_shrines/spirit',
        '/guild_shrines/rarity',
        '/guild_shrines/scholar',
    ];

    /**
     * Resolve a shrine's own combat guild-buff hrid (e.g. "/guild_shrines/force" ->
     * "/guild_buffs/force_combat"). Shrine level evidence (purchased/active level, as opposed to the
     * shrine building's unlocked cap) is only ever exposed keyed by guild-buff hrid - never by shrine
     * hrid - in both `characterGuildBuffMap`/`getCharacterGuildBuffLevel` (self) and a shared
     * profile's `guildBuffLevelMap` (party members), so every caller needs this same resolution first.
     * @param {string} shrineHrid
     * @param {Object} guildBuffDetailMap
     * @returns {string|null}
     */
    function getCombatGuildBuffHridForShrine(shrineHrid, guildBuffDetailMap) {
        for (const [buffHrid, buff] of Object.entries(guildBuffDetailMap || {})) {
            if (buff.shrineHrid === shrineHrid && buff.isCombat) return buffHrid;
        }
        return null;
    }

    // Maps dungeon chest HRIDs to their required entry key HRIDs
    const DUNGEON_ENTRY_KEYS = {
        '/items/chimerical_chest': '/items/chimerical_entry_key',
        '/items/sinister_chest': '/items/sinister_entry_key',
        '/items/enchanted_chest': '/items/enchanted_entry_key',
        '/items/pirate_chest': '/items/pirate_entry_key',
    };

    // Maps dungeon chest HRIDs (regular + refinement) to their chest key HRIDs
    const DUNGEON_CHEST_KEYS = {
        '/items/chimerical_chest': '/items/chimerical_chest_key',
        '/items/sinister_chest': '/items/sinister_chest_key',
        '/items/enchanted_chest': '/items/enchanted_chest_key',
        '/items/pirate_chest': '/items/pirate_chest_key',
        '/items/chimerical_refinement_chest': '/items/chimerical_chest_key',
        '/items/sinister_refinement_chest': '/items/sinister_chest_key',
        '/items/enchanted_refinement_chest': '/items/enchanted_chest_key',
        '/items/pirate_refinement_chest': '/items/pirate_chest_key',
    };

    /**
     * Combat Simulator Adapter
     * Bridges Toolasha's live data to the combat sim engine.
     *
     * Extracts game data maps, builds player DTOs, and provides
     * combat zone metadata for the simulation UI.
     */


    /**
     * Extract all required game data maps from initClientData for the sim engine.
     * @returns {Object|null} Plain object with all 15 game data maps, or null if data unavailable
     */
    function buildGameDataPayload() {
        const clientData = dataManager.getInitClientData();
        if (!clientData) {
            console.error('[CombatSimAdapter] No initClientData available');
            return null;
        }

        return {
            itemDetailMap: clientData.itemDetailMap,
            actionDetailMap: clientData.actionDetailMap,
            abilityDetailMap: clientData.abilityDetailMap,
            combatMonsterDetailMap: clientData.combatMonsterDetailMap,
            combatStyleDetailMap: clientData.combatStyleDetailMap,
            damageTypeDetailMap: clientData.damageTypeDetailMap,
            houseRoomDetailMap: clientData.houseRoomDetailMap,
            combatTriggerDependencyDetailMap: clientData.combatTriggerDependencyDetailMap,
            combatTriggerConditionDetailMap: clientData.combatTriggerConditionDetailMap,
            combatTriggerComparatorDetailMap: clientData.combatTriggerComparatorDetailMap,
            enhancementLevelTotalBonusMultiplierTable: clientData.enhancementLevelTotalBonusMultiplierTable,
            abilitySlotsLevelRequirementList: clientData.abilitySlotsLevelRequirementList,
            openableLootDropMap: clientData.openableLootDropMap,
            labyrinthCrateDetailMap: clientData.labyrinthCrateDetailMap,
            guildBuffDetailMap: clientData.guildBuffDetailMap,
            guildShrineDetailMap: clientData.guildShrineDetailMap,
            achievementDetailMap: clientData.achievementDetailMap,
            achievementTierDetailMap: clientData.achievementTierDetailMap,
        };
    }

    /**
     * Resolve the current character's active Monster-task target hrids (CSIM-AUD-023). The sim runs
     * in a Web Worker with no access to the main-thread DataManager singleton, so eligibility must be
     * resolved here and threaded through the player DTO as plain data.
     * @returns {Array<string>} Monster hrids the current character has an active Monster task for
     */
    function resolveTaskEligibleMonsterHrids() {
        const quests = dataManager.characterQuests || [];
        return quests
            .filter(
                (quest) =>
                    quest.category === '/quest_category/random_task' &&
                    quest.type === '/quest_type/monster' &&
                    quest.status === '/quest_status/in_progress' &&
                    quest.monsterHrid
            )
            .map((quest) => quest.monsterHrid);
    }

    /**
     * Model the current character's active personal/scroll combat buffs for their real remaining
     * lifetime rather than as an eternal permanent buff (CSIM-AUD-019, TLA-039 defect C).
     * `personalActionTypeBuffsMap` is the already-aggregated buff magnitude total for the combat
     * action type and stays the canonical magnitude source; `characterBuffs[]` is the only
     * per-instance timing evidence available, each entry independently resolved via
     * `personalBuffTypeDetailMap[instance.hrid]` to its `buff.uniqueHrid` (the identity the
     * aggregate entries also carry) and its own `expiresAt` - never one shared earliest expiry
     * borrowed across unrelated buffs. Only instances usable in `/action_types/combat` are
     * considered; already-expired instances are ignored. Two active instances of the exact same
     * identity (an ambiguous stacking case with no way to split the already-summed magnitude between
     * them) conservatively keep the earliest of that pair's expiries rather than inventing a split.
     * A buff with no matching un-expired instance (e.g. stale cache) is kept permanent rather than
     * inventing an expiry from no evidence. Automatic scroll purchase/renewal is explicitly out of scope.
     * @returns {{buffs: Array<{buff: Object, remainingDurationNs: number|null}>}}
     */
    function getSelfPersonalCombatBuffContext() {
        const buffs = dataManager.personalActionTypeBuffsMap?.['/action_types/combat'] || [];
        if (buffs.length === 0) {
            return { buffs: [] };
        }

        const personalBuffTypeDetailMap = dataManager.getInitClientData()?.personalBuffTypeDetailMap || {};
        const characterBuffs = dataManager.characterData?.characterBuffs || [];
        const now = Date.now();

        const remainingNsByUniqueHrid = new Map();
        for (const instance of characterBuffs) {
            const detail = personalBuffTypeDetailMap[instance?.hrid];
            if (!detail?.usableInActionTypeMap?.['/action_types/combat']) continue;
            const uniqueHrid = detail.buff?.uniqueHrid;
            if (!uniqueHrid) continue;

            const remainingMs = new Date(instance.expiresAt).getTime() - now;
            if (!Number.isFinite(remainingMs) || remainingMs <= 0) continue;

            const remainingNs = remainingMs * 1e6;
            const existing = remainingNsByUniqueHrid.get(uniqueHrid);
            remainingNsByUniqueHrid.set(uniqueHrid, existing == null ? remainingNs : Math.min(existing, remainingNs));
        }

        return {
            buffs: buffs.map((buff) => ({
                buff,
                remainingDurationNs: remainingNsByUniqueHrid.get(buff.uniqueHrid) ?? null,
            })),
        };
    }

    /**
     * Build a player DTO from the current character data.
     * Outputs the format expected by Player.createFromDTO():
     *   { staminaLevel, ..., equipment: { '/equipment_types/head': {hrid, enhancementLevel}, ... },
     *     food: [{hrid, triggers}], drinks: [{hrid, triggers}],
     *     abilities: [{hrid, level, triggers}], houseRooms: {'/house_rooms/x': level},
     *     hrid: 'player1', debuffOnLevelGap: 0 }
     * @returns {Object|null} Player DTO in sim engine format, or null if data unavailable
     */
    function buildPlayerDTO() {
        const characterData = dataManager.characterData;
        const clientData = dataManager.getInitClientData();

        if (!characterData) {
            console.error('[CombatSimAdapter] No character data available');
            return null;
        }

        const dto = {
            staminaLevel: 1,
            intelligenceLevel: 1,
            attackLevel: 1,
            meleeLevel: 1,
            defenseLevel: 1,
            rangedLevel: 1,
            magicLevel: 1,
            woodcuttingLevel: 1,
            foragingLevel: 1,
            milkingLevel: 1,
            cookingLevel: 1,
            brewingLevel: 1,
            cheesesmithingLevel: 1,
            craftingLevel: 1,
            tailoringLevel: 1,
            alchemyLevel: 1,
            enhancingLevel: 1,
            hrid: 'player1',
            debuffOnLevelGap: 0,
            equipment: {},
            food: [],
            drinks: [],
            abilities: [],
            houseRooms: {},
            tokenUpgrades: { speed: 0, efficiency: 0, success: 0, doubleProgress: 0 },
            communityBuffLevels: { productionEfficiency: 0, enhancingSpeed: 0, gatheringQuantity: 0, experience: 0 },
            shrineLevels: {},
            hasMooPass: false,
            characterAchievements: [],
            personalCombatBuffs: { buffs: [] },
            taskEligibleMonsterHrids: [],
        };

        // Extract all skill levels (combat + skilling)
        for (const skill of characterData.characterSkills || []) {
            const skillName = skill.skillHrid.split('/').pop();
            const key = skillName + 'Level';
            if (dto[key] !== undefined) {
                dto[key] = skill.level;
            }
        }

        // Extract labyrinth token upgrades
        const info = characterData.characterInfo;
        if (info) {
            dto.tokenUpgrades = {
                speed: Math.max(0, Math.floor(Number(info.labyrinthSkillActionSpeedLevel) || 0)),
                efficiency: Math.max(0, Math.floor(Number(info.labyrinthSkillingEfficiencyLevel) || 0)),
                success: Math.max(0, Math.floor(Number(info.labyrinthSkillingSuccessLevel) || 0)),
                doubleProgress: Math.max(0, Math.floor(Number(info.labyrinthSkillingDoubleProgressLevel) || 0)),
            };
        }

        // Extract community buff levels
        dto.communityBuffLevels = {
            productionEfficiency: dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency') || 0,
            enhancingSpeed: dataManager.getCommunityBuffLevel('/community_buff_types/enhancing_speed') || 0,
            gatheringQuantity: dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity') || 0,
            experience: dataManager.getCommunityBuffLevel('/community_buff_types/experience') || 0,
        };

        // Extract self Shrine levels from live guild state. Effective shrine buffs are constructed
        // generically by the engine's Shrine class from these editable levels - never from the frozen
        // guildActionTypeBuffsMap snapshot, so the Sim Editor's Shrine section is the single canonical
        // source and cannot double-apply against a second baked-in path. Uses the character's
        // purchased/active guild-buff level (getCharacterGuildBuffLevel, from guild_buffs_updated),
        // clamped to the shrine building's unlocked cap (getGuildBuildingLevel, from guild_updated) -
        // a purchased level can never legitimately exceed the shrine's current cap for the guild
        // you're actually in, so if the two ever briefly disagree (e.g. a guild switch mid-session,
        // where the two live messages can land a moment apart), never simulate the higher figure.
        const guildBuffDetailMap = clientData.guildBuffDetailMap || {};
        for (const shrineHrid of COMBAT_SHRINE_HRIDS) {
            const combatBuffHrid = getCombatGuildBuffHridForShrine(shrineHrid, guildBuffDetailMap);
            if (!combatBuffHrid) continue;
            const purchasedLevel = dataManager.getCharacterGuildBuffLevel(combatBuffHrid);
            const unlockedCap = dataManager.getGuildBuildingLevel(shrineHrid);
            const level = Math.min(purchasedLevel, unlockedCap);
            if (level > 0) {
                dto.shrineLevels[shrineHrid] = level;
            }
        }

        dto.hasMooPass = (dataManager.getMooPassBuffs()?.length ?? 0) > 0;
        dto.characterAchievements = characterData.characterAchievements || [];
        dto.personalCombatBuffs = getSelfPersonalCombatBuffContext();
        dto.taskEligibleMonsterHrids = resolveTaskEligibleMonsterHrids();

        // Extract equipped items → keyed by equipment type
        // Prefer the always-current characterEquipment Map (updated on every items_updated WS message)
        // over characterItems array which can lose enhancementLevel when items are swapped mid-session.
        const itemDetailMap = clientData?.itemDetailMap || {};
        const equipmentMap = dataManager.characterEquipment;

        if (equipmentMap && equipmentMap.size > 0) {
            for (const [, item] of equipmentMap) {
                const itemDetail = itemDetailMap[item.itemHrid];
                if (!itemDetail?.equipmentDetail?.type) continue;
                dto.equipment[itemDetail.equipmentDetail.type] = {
                    hrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                };
            }
        } else if (Array.isArray(characterData.characterItems)) {
            // Fallback: array format (Map not yet populated)
            for (const item of characterData.characterItems) {
                if (!item.itemLocationHrid || item.itemLocationHrid.includes('/item_locations/inventory')) continue;
                const itemDetail = itemDetailMap[item.itemHrid];
                if (!itemDetail?.equipmentDetail?.type) continue;
                dto.equipment[itemDetail.equipmentDetail.type] = {
                    hrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                };
            }
        } else if (characterData.characterEquipment) {
            for (const key in characterData.characterEquipment) {
                const item = characterData.characterEquipment[key];
                const itemDetail = itemDetailMap[item.itemHrid];
                if (!itemDetail?.equipmentDetail?.type) continue;
                dto.equipment[itemDetail.equipmentDetail.type] = {
                    hrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                };
            }
        }

        // Build trigger map (ability + consumable triggers combined)
        const triggerMap = {
            ...(characterData.abilityCombatTriggersMap || {}),
            ...(characterData.consumableCombatTriggersMap || {}),
        };

        /**
         * Convert raw trigger data to DTOs for Trigger.createFromDTO.
         * @param {string} hrid - Ability or consumable HRID
         * @returns {Array<Object>} Trigger DTOs
         */
        const buildTriggerDTOs = (hrid) => {
            const rawTriggers = triggerMap[hrid];
            if (!Array.isArray(rawTriggers)) return null;

            return rawTriggers.map((t) => ({
                dependencyHrid: t.dependencyHrid,
                conditionHrid: t.conditionHrid,
                comparatorHrid: t.comparatorHrid,
                value: t.value || 0,
            }));
        };

        // Extract food slots → array of { hrid, triggers }
        const foodSlots = characterData.actionTypeFoodSlotsMap?.['/action_types/combat'] || [];
        for (let i = 0; i < 3; i++) {
            const item = foodSlots[i];
            if (item?.itemHrid) {
                dto.food.push({ hrid: item.itemHrid, triggers: buildTriggerDTOs(item.itemHrid) });
            } else {
                dto.food.push(null);
            }
        }

        // Extract drink slots → array of { hrid, triggers }
        const drinkSlots = characterData.actionTypeDrinkSlotsMap?.['/action_types/combat'] || [];
        for (let i = 0; i < 3; i++) {
            const item = drinkSlots[i];
            if (item?.itemHrid) {
                dto.drinks.push({ hrid: item.itemHrid, triggers: buildTriggerDTOs(item.itemHrid) });
            } else {
                dto.drinks.push(null);
            }
        }

        // Extract equipped abilities → array of { hrid, level, triggers, experience }
        // combatUnit.combatAbilities carries no slotNumber itself, so normal-slot order is resolved
        // against characterAbilities (the full learned-ability catalog, which does carry it) -
        // otherwise normal slots 1-4 would be ordered however the game happened to send
        // combatUnit.combatAbilities, which is not guaranteed to be slot order.
        const abilityExperienceByHrid = {};
        const slotNumberByHrid = {};
        for (const ability of characterData.characterAbilities || []) {
            if (ability?.abilityHrid) {
                abilityExperienceByHrid[ability.abilityHrid] = ability.experience || 0;
                slotNumberByHrid[ability.abilityHrid] = ability.slotNumber;
            }
        }
        const equippedAbilities = [...(characterData.combatUnit?.combatAbilities || [])].sort((a, b) => {
            const slotA = slotNumberByHrid[a?.abilityHrid];
            const slotB = slotNumberByHrid[b?.abilityHrid];
            if (slotA == null || slotB == null) return 0;
            return slotA - slotB;
        });
        // Slot 0 = special ability, slots 1-4 = normal abilities
        for (let i = 0; i < 5; i++) {
            dto.abilities.push(null);
        }

        let normalAbilityIndex = 1;
        for (const ability of equippedAbilities) {
            if (!ability?.abilityHrid) continue;

            const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
            const abilityDTO = {
                hrid: ability.abilityHrid,
                level: ability.level || 1,
                triggers: buildTriggerDTOs(ability.abilityHrid),
                experience: abilityExperienceByHrid[ability.abilityHrid] || 0,
            };

            if (isSpecial) {
                dto.abilities[0] = abilityDTO;
            } else if (normalAbilityIndex < 5) {
                dto.abilities[normalAbilityIndex++] = abilityDTO;
            }
        }

        // Extract house room levels
        for (const house of Object.values(characterData.characterHouseRoomMap || {})) {
            dto.houseRooms[house.houseRoomHrid] = house.level;
        }

        return dto;
    }

    /**
     * Build a player DTO from profile_shared data for the combat sim UI.
     * @param {Object} profileData - Profile data from profile_shared (with .profile and .characterID)
     * @returns {Object|null} Player DTO in sim engine format, or null if unavailable
     */
    function buildPlayerDTOFromProfile(profileData) {
        if (!profileData?.profile) return null;
        const clientData = dataManager.getInitClientData();
        if (!clientData) return null;
        return buildPartyMemberDTO(profileData, clientData, null);
    }

    /**
     * Parse a Shykai-format export string into player DTOs.
     * Accepts the multi-slot format: {"1": "{...}", "2": "{...}", ...}
     * Each slot is a stringified player object with player/food/drinks/abilities/triggerMap/houseRooms.
     * @param {string} jsonString - The pasted export string
     * @returns {{ players: Array<Object>, names: Array<string> }|null} Parsed DTOs, or null on error
     */
    function parseShykaiImport(jsonString) {
        const clientData = dataManager.getInitClientData();
        if (!clientData) return null;
        const itemDetailMap = clientData.itemDetailMap || {};

        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        } catch {
            return null;
        }

        // Detect format:
        // - Multi-slot: {"1": "{...}", "2": "{...}", ...}
        // - Single-player: {"player": {...}, "food": {...}, ...}
        let slotEntries;

        if (typeof parsed === 'object' && parsed['1']) {
            // Multi-slot format
            slotEntries = [];
            for (let i = 1; i <= 5; i++) {
                const slotStr = parsed[String(i)];
                if (!slotStr) continue;
                try {
                    const slotData = typeof slotStr === 'string' ? JSON.parse(slotStr) : slotStr;
                    slotEntries.push({ slot: i, data: slotData });
                } catch {
                    // Skip unparseable slots
                }
            }
        } else if (typeof parsed === 'object' && parsed.player) {
            // Single-player format
            slotEntries = [{ slot: 1, data: parsed }];
        } else {
            return null;
        }

        const players = [];
        const names = [];

        for (const { slot, data: slotData } of slotEntries) {
            const p = slotData.player;
            if (!p) continue;

            // Skip blank/empty players (all levels at 1 and no equipment)
            const hasEquipment = Array.isArray(p.equipment) ? p.equipment.some((e) => e.itemHrid) : false;
            const hasLevels = (p.staminaLevel || 1) > 1 || (p.attackLevel || 1) > 1;
            if (!hasEquipment && !hasLevels) continue;

            const dto = {
                staminaLevel: p.staminaLevel || 1,
                intelligenceLevel: p.intelligenceLevel || 1,
                attackLevel: p.attackLevel || 1,
                meleeLevel: p.meleeLevel || 1,
                defenseLevel: p.defenseLevel || 1,
                rangedLevel: p.rangedLevel || 1,
                magicLevel: p.magicLevel || 1,
                hrid: `player${slot}`,
                debuffOnLevelGap: 0,
                equipment: {},
                food: [],
                drinks: [],
                abilities: [],
                houseRooms: {},
                shrineLevels: {},
                characterAchievements: [],
            };

            // Achievements (TLA-044): Szerra/Shykai exports carry a per-slot completion map
            // (achievementHrid -> true/false) rather than Toolasha's native array-of-objects shape.
            // Normalize it into the same {achievementHrid, isCompleted} representation
            // buildPlayerDTO()/buildPartyMemberDTO() already produce, so the engine never needs
            // import-specific logic. Missing/malformed evidence stays the neutral empty array set
            // above rather than borrowing another player's/session's completion state.
            if (slotData.achievements && typeof slotData.achievements === 'object') {
                dto.characterAchievements = Object.entries(slotData.achievements).map(([achievementHrid, isCompleted]) => ({
                    achievementHrid,
                    isCompleted: !!isCompleted,
                }));
            }

            // Equipment: array format [{itemLocationHrid, itemHrid, enhancementLevel}]
            // (TLA-045) The export's itemLocationHrid is a raw Szerra/Shykai location (e.g.
            // /item_locations/two_hand), not Toolasha's canonical equipment slot. The engine's
            // slot-specific identity checks (weapon/pouch/charm) read canonical /equipment_types/*
            // keys, so the raw location must never be used as the final DTO key - only current
            // item metadata (the same authority buildPlayerDTO() uses for the live/self path) can
            // determine canonical slot ownership. An item that can't be resolved to valid equipment
            // metadata is skipped rather than guessed, so it fails closed instead of silently
            // landing under a noncanonical key.
            if (Array.isArray(p.equipment)) {
                for (const eq of p.equipment) {
                    if (!eq.itemHrid) continue;
                    const eqType = itemDetailMap[eq.itemHrid]?.equipmentDetail?.type;
                    if (eqType) {
                        dto.equipment[eqType] = {
                            hrid: eq.itemHrid,
                            enhancementLevel: eq.enhancementLevel || 0,
                        };
                    } else {
                        console.warn(
                            `[CombatSimAdapter] Shykai import: could not resolve equipment slot for itemHrid "${eq.itemHrid}" (itemLocationHrid "${eq.itemLocationHrid}"); skipping.`
                        );
                    }
                }
            }

            // Trigger map helper
            const triggerMap = slotData.triggerMap || {};
            const buildTriggers = (hrid) => {
                const raw = triggerMap[hrid];
                if (!Array.isArray(raw)) return null;
                return raw.map((t) => ({
                    dependencyHrid: t.dependencyHrid,
                    conditionHrid: t.conditionHrid,
                    comparatorHrid: t.comparatorHrid,
                    value: t.value || 0,
                }));
            };

            // Food
            const foodSlots = slotData.food?.['/action_types/combat'] || [];
            for (const slot of foodSlots) {
                if (slot.itemHrid) {
                    dto.food.push({ hrid: slot.itemHrid, triggers: buildTriggers(slot.itemHrid) });
                } else {
                    dto.food.push(null);
                }
            }

            // Drinks
            const drinkSlots = slotData.drinks?.['/action_types/combat'] || [];
            for (const slot of drinkSlots) {
                if (slot.itemHrid) {
                    dto.drinks.push({ hrid: slot.itemHrid, triggers: buildTriggers(slot.itemHrid) });
                } else {
                    dto.drinks.push(null);
                }
            }

            // Abilities
            const abilitySlots = slotData.abilities || [];
            for (const slot of abilitySlots) {
                if (slot.abilityHrid) {
                    dto.abilities.push({
                        hrid: slot.abilityHrid,
                        level: slot.level || 1,
                        triggers: buildTriggers(slot.abilityHrid),
                    });
                } else {
                    dto.abilities.push(null);
                }
            }

            // House rooms
            if (slotData.houseRooms) {
                dto.houseRooms = { ...slotData.houseRooms };
            }

            // Guild Shrines (guildCombatBuffLevels: {force, tempo, spirit, rarity, scholar}) - added
            // by Szerra's fork; Shykai's own exports omit this field, so its absence just leaves
            // shrineLevels empty rather than being treated as an error.
            if (slotData.guildCombatBuffLevels) {
                for (const shrineHrid of COMBAT_SHRINE_HRIDS) {
                    const level = slotData.guildCombatBuffLevels[shrineHrid.split('/').pop()];
                    if (Number.isFinite(level) && level > 0) {
                        dto.shrineLevels[shrineHrid] = level;
                    }
                }
            }

            players.push(dto);
            names.push(slotData.name || p.name || `Player ${slot}`);
        }

        if (!players.length) return null;

        return { players, names };
    }

    /**
     * Build a player DTO from a cached party member profile.
     * @param {Object} profile - Profile data with .profile sub-object
     * @param {Object} clientData - initClientData
     * @param {Object} battleData - Battle data (optional, for consumable detection)
     * @returns {Object} Player DTO in engine format
     */
    function buildPartyMemberDTO(profile, clientData, battleData) {
        const itemDetailMap = clientData?.itemDetailMap || {};

        const dto = {
            staminaLevel: 1,
            intelligenceLevel: 1,
            attackLevel: 1,
            meleeLevel: 1,
            defenseLevel: 1,
            rangedLevel: 1,
            magicLevel: 1,
            hrid: 'player',
            debuffOnLevelGap: 0,
            equipment: {},
            food: [],
            drinks: [],
            abilities: [],
            houseRooms: {},
            shrineLevels: {},
            hasMooPass: false,
            characterAchievements: [],
            personalCombatBuffs: { buffs: [] },
            taskEligibleMonsterHrids: [],
        };

        // Extract skill levels
        for (const skill of profile.profile?.characterSkills || []) {
            const skillName = skill.skillHrid?.split('/').pop();
            const key = skillName + 'Level';
            if (dto[key] !== undefined) {
                dto[key] = skill.level || 1;
            }
        }

        // Extract teammate context evidence already present in a shared-profile payload. This is
        // genuinely per-player evidence and must never fall back to the current/self player's values -
        // absent/malformed evidence stays neutral (shrineLevels empty, hasMooPass false,
        // characterAchievements empty) rather than being fabricated. Personal/scroll combat-buff
        // lifetime evidence is not exposed in a shared-profile payload, so it stays explicitly unknown.
        // A shared profile's guildBuffLevelMap is keyed by guild-buff hrid (e.g.
        // "/guild_buffs/force_combat"), never by shrine hrid, so it must be resolved the same way as
        // the self path above before indexing into it.
        const partyGuildBuffDetailMap = clientData?.guildBuffDetailMap || {};
        for (const shrineHrid of COMBAT_SHRINE_HRIDS) {
            const combatBuffHrid = getCombatGuildBuffHridForShrine(shrineHrid, partyGuildBuffDetailMap);
            if (!combatBuffHrid) continue;
            const level = profile.profile?.guildBuffLevelMap?.[combatBuffHrid];
            if (Number.isFinite(level) && level > 0) {
                dto.shrineLevels[shrineHrid] = level;
            }
        }
        dto.hasMooPass = profile.profile?.sharableCharacter?.hasMooPass ?? false;
        dto.characterAchievements = profile.profile?.characterAchievements || [];

        // Extract equipment from wearableItemMap → keyed by equipmentDetail.type
        if (profile.profile?.wearableItemMap) {
            for (const key in profile.profile.wearableItemMap) {
                const item = profile.profile.wearableItemMap[key];
                const itemDetail = itemDetailMap[item.itemHrid];
                if (!itemDetail?.equipmentDetail?.type) continue;
                dto.equipment[itemDetail.equipmentDetail.type] = {
                    hrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                };
            }
        }

        // Try to get consumables from battle data first
        let battlePlayer = null;
        if (battleData?.players) {
            battlePlayer = battleData.players.find((p) => p.character?.id === profile.characterID);
        }
        // Build trigger map — prefer battle data triggers over profile triggers (battle data is fresher)
        const triggerMap = {
            ...(battlePlayer?.abilityCombatTriggersMap || profile.profile?.abilityCombatTriggersMap || {}),
            ...(battlePlayer?.consumableCombatTriggersMap || profile.profile?.consumableCombatTriggersMap || {}),
        };

        const buildTriggerDTOs = (hrid) => {
            const rawTriggers = triggerMap[hrid];
            if (!Array.isArray(rawTriggers)) return null;
            return rawTriggers.map((t) => ({
                dependencyHrid: t.dependencyHrid,
                conditionHrid: t.conditionHrid,
                comparatorHrid: t.comparatorHrid,
                value: t.value || 0,
            }));
        };

        // Consumables: prefer battle data, fall back to trigger map keys
        if (battlePlayer?.combatConsumables) {
            let foodIndex = 0;
            let drinkIndex = 0;
            for (const consumable of battlePlayer.combatConsumables) {
                const hrid = consumable.itemHrid;
                const isDrink =
                    hrid.includes('/drinks/') ||
                    hrid.includes('coffee') ||
                    itemDetailMap[hrid]?.categoryHrid?.includes('drink');
                if (isDrink && drinkIndex < 3) {
                    dto.drinks.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                    drinkIndex++;
                } else if (!isDrink && foodIndex < 3) {
                    dto.food.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                    foodIndex++;
                }
            }
        } else {
            // Fall back to trigger map keys for consumable HRIDs
            const consumableHrids = Object.keys(profile.profile?.consumableCombatTriggersMap || {});
            let foodIndex = 0;
            let drinkIndex = 0;
            for (const hrid of consumableHrids) {
                const isDrink =
                    hrid.includes('/drinks/') ||
                    hrid.includes('coffee') ||
                    itemDetailMap[hrid]?.categoryHrid?.includes('drink');
                if (isDrink && drinkIndex < 3) {
                    dto.drinks.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                    drinkIndex++;
                } else if (!isDrink && foodIndex < 3) {
                    dto.food.push({ hrid, triggers: buildTriggerDTOs(hrid) });
                    foodIndex++;
                }
            }
        }

        // Pad remaining slots with null
        while (dto.food.length < 3) dto.food.push(null);
        while (dto.drinks.length < 3) dto.drinks.push(null);

        // Extract abilities
        for (let i = 0; i < 5; i++) dto.abilities.push(null);
        let normalAbilityIndex = 1;
        const equippedAbilities = profile.profile?.equippedAbilities || [];
        for (const ability of equippedAbilities) {
            if (!ability?.abilityHrid) continue;
            const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
            const abilityDTO = {
                hrid: ability.abilityHrid,
                level: ability.level || 1,
                triggers: buildTriggerDTOs(ability.abilityHrid),
            };
            if (isSpecial) {
                dto.abilities[0] = abilityDTO;
            } else if (normalAbilityIndex < 5) {
                dto.abilities[normalAbilityIndex++] = abilityDTO;
            }
        }

        // House rooms
        if (profile.profile?.characterHouseRoomMap) {
            for (const house of Object.values(profile.profile.characterHouseRoomMap)) {
                dto.houseRooms[house.houseRoomHrid] = house.level;
            }
        }

        return dto;
    }

    /**
     * Calculate the level-gap debuff for one party member given their combat level and the party's
     * highest combat level. Shared by Combat Sim (simulated party loadouts) and Combat Stats
     * (real live encounters) so both agree on the exact same eligibility rule.
     *
     * SERVER-CONFIRMED (direct MWI developer evidence): `combatLevel` and `maxCombatLevel` must be
     * the raw (unfloored) whole-skill Combat Level - see `calculateCombatLevelFromLevelFields()` -
     * not the native floored integer the game displays. The 20%-lower and 10-Combat-Level-lower
     * conditions combine into one effective threshold, the comparison is strict, and the penalty is
     * continuous (no 1%-step quantization). Supplied server implementation (Go):
     *   effectiveThreshold := max(1.2, (combatLevel+10)/combatLevel)
     *   if effectiveThreshold*combatLevel < topCombatLevel {
     *       multiplier = max(0.1, 1.0-3.0*(topCombatLevel/combatLevel-effectiveThreshold))
     *   }
     * @param {number} combatLevel - This player's raw (unfloored) combat level
     * @param {number} maxCombatLevel - The party's highest raw (unfloored) combat level
     * @returns {number} Debuff as a negative decimal (0 = no debuff, e.g. -0.3 = -30%)
     */
    function calculateLevelGapDebuff(combatLevel, maxCombatLevel) {
        const effectiveThreshold = Math.max(1.2, (combatLevel + 10) / combatLevel);
        if (!(effectiveThreshold * combatLevel < maxCombatLevel)) {
            return 0;
        }
        const multiplier = Math.max(0.1, 1.0 - 3.0 * (maxCombatLevel / combatLevel - effectiveThreshold));
        return multiplier - 1.0;
    }

    /**
     * Calculate the raw (unfloored) combat level from any object exposing the game's own
     * combatDetails-shaped whole-skill-level fields (staminaLevel, intelligenceLevel, attackLevel,
     * defenseLevel, meleeLevel, rangedLevel, magicLevel) - the same shape as a simulated player DTO
     * here in Combat Sim, and the same shape the server sends on live `combatDetails` objects.
     *
     * SERVER-CONFIRMED: this raw/unfloored value - not the native floored `combatDetails.combatLevel`
     * integer the game displays - is the actual mechanic input for Level Malus (see
     * `calculateLevelGapDebuff()`). Both Combat Sim (simulated party) and Combat Stats (live
     * encounters, deriving this from the same seven fields on real `combatDetails`) use this one
     * shared helper so they never disagree.
     * @param {{staminaLevel: number, intelligenceLevel: number, attackLevel: number, defenseLevel: number, meleeLevel: number, rangedLevel: number, magicLevel: number}} levelFields
     * @returns {number} Raw (unfloored) combat level
     */
    function calculateCombatLevelFromLevelFields(levelFields) {
        return calculateRawCombatLevel({
            stamina: levelFields.staminaLevel,
            intelligence: levelFields.intelligenceLevel,
            attack: levelFields.attackLevel,
            defense: levelFields.defenseLevel,
            melee: levelFields.meleeLevel,
            ranged: levelFields.rangedLevel,
            magic: levelFields.magicLevel,
        });
    }

    /**
     * Build player DTOs for all party members (or solo if not in a party).
     * Auto-detects party from characterData and loads cached profiles.
     * @returns {Promise<{players: Array, playerNames: Array<string>, missingMembers: Array<string>}>}
     */
    async function buildAllPlayerDTOs() {
        const characterData = dataManager.characterData;
        const clientData = dataManager.getInitClientData();

        if (!characterData) {
            return { players: [], playerInfo: [], selfHrid: 'player1', missingMembers: [] };
        }

        const hasParty = characterData.partyInfo?.partySlotMap;

        if (!hasParty) {
            // Solo mode
            const selfDTO = buildPlayerDTO();
            if (!selfDTO) return { players: [], playerInfo: [], selfHrid: 'player1', missingMembers: [] };
            return {
                players: [selfDTO],
                playerInfo: [{ hrid: selfDTO.hrid, name: characterData.character?.name || 'Player 1' }],
                selfHrid: selfDTO.hrid,
                missingMembers: [],
            };
        }

        // Party mode — load profile list from IndexedDB
        let profileList = [];
        try {
            profileList = (await storage.getJSON('profile_list', 'combatExport', null)) || [];
        } catch (error) {
            console.error('[CombatSimAdapter] Failed to load profile list:', error);
        }

        // Get battle data for consumable detection
        const battleData = dataManager.battleData || null;

        const players = [];
        const playerNames = [];
        const missingMembers = [];
        let selfHrid = null;
        let slotIndex = 1;

        for (const member of Object.values(characterData.partyInfo.partySlotMap)) {
            if (!member.characterID) continue;

            if (member.characterID === characterData.character.id) {
                // Self
                const selfDTO = buildPlayerDTO();
                if (selfDTO) {
                    selfDTO.hrid = 'player' + slotIndex;
                    selfHrid = selfDTO.hrid;
                    players.push(selfDTO);
                    playerNames.push(characterData.character.name || 'Player ' + slotIndex);
                }
            } else {
                // Party member — look up in profile list (IndexedDB, cross-session)
                const profile = profileList.find((p) => p.characterID === member.characterID);

                if (profile) {
                    const memberDTO = buildPartyMemberDTO(profile, clientData, battleData);
                    memberDTO.hrid = 'player' + slotIndex;
                    players.push(memberDTO);
                    playerNames.push(profile.characterName || 'Player ' + slotIndex);
                } else {
                    missingMembers.push(member.characterName || 'Unknown');
                }
            }
            slotIndex++;
        }

        // Calculate level gap debuff
        if (players.length > 1) {
            const levels = players.map((p) => calculateCombatLevelFromLevelFields(p));
            const maxCombatLevel = Math.max(...levels);

            for (let i = 0; i < players.length; i++) {
                players[i].debuffOnLevelGap = calculateLevelGapDebuff(levels[i], maxCombatLevel);
            }
        }

        // Build playerInfo: hrid → name mapping in player order, for tab rendering
        const playerInfo = players.map((p, i) => ({ hrid: p.hrid, name: playerNames[i] }));

        return { players, playerInfo, selfHrid: selfHrid || players[0]?.hrid || 'player1', missingMembers };
    }

    /**
     * Get a sorted list of combat zones for the zone dropdown.
     * @returns {Array<{hrid: string, name: string, isDungeon: boolean, maxSpawnCount: number, maxDifficulty: number, sortIndex: number}>} Sorted zone list
     */
    function getCombatZones() {
        const clientData = dataManager.getInitClientData();
        if (!clientData?.actionDetailMap) {
            return [];
        }

        const zones = [];

        for (const [hrid, action] of Object.entries(clientData.actionDetailMap)) {
            if (action.type !== '/action_types/combat') continue;

            zones.push({
                hrid,
                name: action.name,
                isDungeon: action.combatZoneInfo?.isDungeon || false,
                maxSpawnCount: action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount || 1,
                maxDifficulty: action.maxDifficulty || 0,
                sortIndex: action.sortIndex ?? 0,
            });
        }

        // Sort by sortIndex for consistent ordering
        zones.sort((a, b) => a.sortIndex - b.sortIndex);

        return zones;
    }

    /**
     * Get all labyrinth monsters sorted by name.
     * @returns {Array<{hrid: string, name: string}>}
     */
    function getLabyrinthMonsters() {
        const clientData = dataManager.getInitClientData();
        if (!clientData?.combatMonsterDetailMap) return [];

        return Object.values(clientData.combatMonsterDetailMap)
            .filter((m) => m.isLabyrinthMonster === true)
            .map((m) => ({ hrid: m.hrid, name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get labyrinth crate options grouped by category.
     * @returns {{coffee: Array, food: Array, tea: Array}}
     */
    function getLabyrinthCrates() {
        return {
            coffee: [
                { hrid: '/items/basic_coffee_crate', name: 'Basic Coffee' },
                { hrid: '/items/advanced_coffee_crate', name: 'Advanced Coffee' },
                { hrid: '/items/expert_coffee_crate', name: 'Expert Coffee' },
            ],
            food: [
                { hrid: '/items/basic_food_crate', name: 'Basic Food' },
                { hrid: '/items/advanced_food_crate', name: 'Advanced Food' },
                { hrid: '/items/expert_food_crate', name: 'Expert Food' },
            ],
            tea: [
                { hrid: '/items/basic_tea_crate', name: 'Basic Tea' },
                { hrid: '/items/advanced_tea_crate', name: 'Advanced Tea' },
                { hrid: '/items/expert_tea_crate', name: 'Expert Tea' },
            ],
        };
    }

    /**
     * Get the player's current combat zone and difficulty tier from characterActions.
     * @returns {{zoneHrid: string, difficultyTier: number, isDungeon: boolean}|null} Current zone info or null
     */
    function getCurrentCombatZone() {
        const characterData = dataManager.characterData;
        const clientData = dataManager.getInitClientData();

        if (!characterData?.characterActions) {
            return null;
        }

        for (const action of characterData.characterActions) {
            if (action && action.actionHrid?.includes('/actions/combat/')) {
                const isDungeon = clientData?.actionDetailMap?.[action.actionHrid]?.combatZoneInfo?.isDungeon || false;
                return {
                    zoneHrid: action.actionHrid,
                    difficultyTier: action.difficultyTier || 0,
                    isDungeon,
                };
            }
        }

        return null;
    }

    /**
     * Extract community buff levels from characterData for the simulation.
     * @returns {{comExp: number, comDrop: number}} Community buff levels (0 if not active)
     */
    function getCommunityBuffs() {
        const mooPassBuffs = dataManager.getMooPassBuffs();
        return {
            mooPass: mooPassBuffs && mooPassBuffs.length > 0,
            comExp: dataManager.getCommunityBuffLevel('/community_buff_types/experience') || 0,
            comDrop: dataManager.getCommunityBuffLevel('/community_buff_types/combat_drop_quantity') || 0,
        };
    }

    /**
     * Place saved loadout abilities into their native MWI slots (1..5 -> array 0..4).
     * Native slot identity is authoritative and intentional holes must survive every export path.
     * Legacy/invalid slot data falls back by special-vs-normal classification without compacting
     * any valid native slot.
     * @param {Array<Object>} abilities
     * @param {Object} abilityDetailMap
     * @param {(ability: Object) => any} mapAbility
     * @returns {Array<any|null>}
     */
    function mapLoadoutAbilitiesToNativeSlots(abilities, abilityDetailMap, mapAbility) {
        const result = [null, null, null, null, null];
        let fallbackNormalAbilityIndex = 1;

        for (const ability of abilities || []) {
            if (!ability?.abilityHrid) continue;
            const mappedAbility = mapAbility(ability);
            if (mappedAbility === null || mappedAbility === undefined) continue;

            const nativeSlot = Number.parseInt(ability.slot, 10);
            const nativeIndex = nativeSlot >= 1 && nativeSlot <= 5 ? nativeSlot - 1 : null;
            if (nativeIndex !== null) {
                result[nativeIndex] = mappedAbility;
                continue;
            }

            const isSpecial = abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;
            if (isSpecial) {
                // Invalid legacy slot metadata must not overwrite a valid native slot 1 that was
                // already reconstructed above. Fill the special slot only when it is genuinely free.
                if (result[0] === null) result[0] = mappedAbility;
                continue;
            }

            while (fallbackNormalAbilityIndex < 5 && result[fallbackNormalAbilityIndex]) {
                fallbackNormalAbilityIndex += 1;
            }
            if (fallbackNormalAbilityIndex < 5) {
                result[fallbackNormalAbilityIndex++] = mappedAbility;
            }
        }

        return result;
    }

    /**
     * Apply a named canonical saved loadout to a player DTO (mutates dto in place on success).
     * @param {Object} dto - Player DTO to mutate
     * @param {string} snapshotName - Loadout snapshot name
     * @param {Object} gameData - Game data payload from buildGameDataPayload()
     * @returns {boolean} True only when the complete usable snapshot was applied
     */
    function applyLoadoutSnapshotToDTO(dto, snapshotName, gameData) {
        const snapshot = loadoutState.getUsableSnapshotByName(snapshotName);
        if (!snapshot) return false;

        const itemDetailMap = gameData.itemDetailMap || {};
        const abilityDetailMap = gameData.abilityDetailMap || {};

        // Convert canonical resolved equipment: snapshot uses itemHrid, DTO keys by equipmentDetail.type.
        // Exact/highest enhancement semantics are owned exclusively by Core Loadout State.
        const characterData = dataManager.characterData;
        const newEquipment = {};
        for (const equip of snapshot.equipment || []) {
            const itemDetail = itemDetailMap[equip.itemHrid];
            const equipType = itemDetail?.equipmentDetail?.type;
            // Manual loadout application is all-or-nothing. Missing item metadata is just as
            // unsafe as an unresolved enhancement: silently omitting that slot would simulate a
            // different loadout while reporting success.
            if (!equipType || !Number.isFinite(equip.enhancementLevel)) return false;
            newEquipment[equipType] = {
                hrid: equip.itemHrid,
                enhancementLevel: equip.enhancementLevel,
            };
        }
        dto.equipment = newEquipment;

        // Ability levels come from current character (not the snapshot)
        // Use characterAbilities (all learned) not combatUnit.combatAbilities (equipped only)
        const currentAbilityLevels = {};
        for (const ability of characterData?.characterAbilities || []) {
            if (ability?.abilityHrid) {
                currentAbilityLevels[ability.abilityHrid] = ability.level || 1;
            }
        }

        const triggerMap = {
            ...(snapshot.abilityCombatTriggersMap || {}),
            ...(snapshot.consumableCombatTriggersMap || {}),
        };

        const buildTriggers = (hrid) => {
            const rawTriggers = triggerMap[hrid];
            if (!Array.isArray(rawTriggers)) return null;
            return rawTriggers.map((t) => ({
                dependencyHrid: t.dependencyHrid,
                conditionHrid: t.conditionHrid,
                comparatorHrid: t.comparatorHrid,
                value: t.value || 0,
            }));
        };

        // MWI saved loadout ability slots are 1..5 and Combat Sim uses the same ordering zero-based.
        // Preserve native holes instead of compacting saved abilities upward in the editor/DTO.
        dto.abilities = mapLoadoutAbilitiesToNativeSlots(snapshot.abilities, abilityDetailMap, (ab) => ({
            hrid: ab.abilityHrid,
            level: currentAbilityLevels[ab.abilityHrid] || 1,
            triggers: buildTriggers(ab.abilityHrid),
        }));

        // Convert food (3 slots)
        dto.food = [];
        for (let i = 0; i < 3; i++) {
            const foodItem = snapshot.food?.[i];
            if (foodItem?.itemHrid) {
                dto.food.push({ hrid: foodItem.itemHrid, triggers: buildTriggers(foodItem.itemHrid) });
            } else {
                dto.food.push(null);
            }
        }

        // Convert drinks (3 slots)
        dto.drinks = [];
        for (let i = 0; i < 3; i++) {
            const drinkItem = snapshot.drinks?.[i];
            if (drinkItem?.itemHrid) {
                dto.drinks.push({ hrid: drinkItem.itemHrid, triggers: buildTriggers(drinkItem.itemHrid) });
            } else {
                dto.drinks.push(null);
            }
        }

        return true;
    }

    /**
     * Compute the canonical time-based OOM percentage for one player (UI-001):
     * `actual time out of mana / simulated time * 100`. Reuses the exact same closed-plus-open-window
     * accounting already proven correct by the existing single-sim "Run Out Ratio" detail row - never
     * the historical count-based insufficient-MP-check ratio.
     * @param {Object} simResult - SimResult from runSimulation()
     * @param {string} playerHrid
     * @returns {number|null} OOM percentage (0-100), or null if there is no data for this player
     */
    function computeOomPercent(simResult, playerHrid) {
        const stat = simResult?.playerRanOutOfManaTime?.[playerHrid];
        if (!stat || !simResult.simulatedTime) return null;

        const openWindow = stat.isOutOfMana ? simResult.simulatedTime - stat.startTimeForOutOfMana : 0;
        const totalOomTime = stat.totalTimeForOutOfMana + openWindow;

        return (totalOomTime / simResult.simulatedTime) * 100;
    }

    /**
     * Calculate expected drops from simulation results for a specific player.
     * Uses deterministic expected-value math (no RNG rolls).
     * @param {Object} simResult - SimResult from the engine
     * @param {Object} gameData - Game data maps
     * @param {string} [playerHrid='player1'] - Which player's drop multipliers to use
     * @returns {Map<string, number>} itemHrid → expected total drop count
     */
    function calculateExpectedDrops(simResult, gameData, playerHrid = 'player1') {
        const combatMonsterDetailMap = gameData.combatMonsterDetailMap;
        // Fallback end-of-simulation snapshot, used only when kill-time context is unavailable
        // (e.g. a legacy/synthetic SimResult that never called recordMonsterKill/recordDungeonCompletion).
        const dropRateMultiplier = simResult.dropRateMultiplier[playerHrid] || 1;
        const rareFindMultiplier = simResult.rareFindMultiplier?.[playerHrid] || 1;
        const combatDropQuantity = simResult.combatDropQuantity?.[playerHrid] || 0;
        const debuffOnLevelGap = simResult.debuffOnLevelGap?.[playerHrid] || 0;
        const numberOfPlayers = simResult.numberOfPlayers || 1;
        const difficultyTier = simResult.difficultyTier || 0;

        const totalDropMap = new Map();

        if (simResult.isDungeon) {
            // Dungeons: only completion rewards, no per-monster drops
            if (simResult.dungeonsCompleted > 0) {
                const zoneHrid = simResult.zoneName;
                const actionDetailMap = gameData.actionDetailMap || {};
                const actionDetail = actionDetailMap[zoneHrid];
                const rewardDropTable = actionDetail?.combatZoneInfo?.dungeonInfo?.rewardDropTable;

                if (rewardDropTable) {
                    // Kill-time-context drop quantity (CSIM-AUD-011): average this player's
                    // combatDropQuantity across every completion actually recorded, instead of the
                    // single end-of-run snapshot value applied to every completion regardless of when
                    // a temporary buff/scroll was active.
                    const dungeonContext = simResult.dungeonCompletionDropContext;
                    const playerDungeonContext = dungeonContext?.byPlayer?.[playerHrid];
                    const avgCombatDropQuantity =
                        playerDungeonContext && dungeonContext.count > 0
                            ? playerDungeonContext.sumCombatDropQuantity / dungeonContext.count
                            : combatDropQuantity;

                    const baseChestCount = 5;
                    const chestsPerCompletion = (baseChestCount / numberOfPlayers) * (1 + avgCombatDropQuantity);

                    for (const drop of rewardDropTable) {
                        const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                        const adjustedRate = Math.min(1.0, Math.max(0, baseRate));
                        if (adjustedRate <= 0) continue;

                        const avgCount = (drop.minCount + drop.maxCount) / 2;
                        let expected;
                        if (adjustedRate >= 1.0) {
                            expected = simResult.dungeonsCompleted * chestsPerCompletion * avgCount;
                        } else {
                            expected = simResult.dungeonsCompleted * adjustedRate * avgCount;
                        }

                        totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                    }
                }
            }
        } else {
            // Regular zones: per-monster drops from kill counts
            const monsters = Object.keys(simResult.deaths).filter((hrid) => !hrid.startsWith('player'));

            for (const monsterHrid of monsters) {
                const monsterData = combatMonsterDetailMap[monsterHrid];
                if (!monsterData) continue;

                const killCount = simResult.deaths[monsterHrid];

                // Kill-time-context multipliers (CSIM-AUD-011): average this player's multiplier
                // across every kill actually recorded for this monster, instead of the single
                // end-of-run snapshot applied retroactively to every accumulated kill.
                const killContext = simResult.killDropContext?.[monsterHrid];
                const playerKillContext = killContext?.byPlayer?.[playerHrid];
                const hasKillContext = playerKillContext && killContext.killCount > 0;
                const avgDropRateMultiplier = hasKillContext
                    ? playerKillContext.sumDropRateMultiplier / killContext.killCount
                    : dropRateMultiplier;
                const avgRareFindMultiplier = hasKillContext
                    ? playerKillContext.sumRareFindMultiplier / killContext.killCount
                    : rareFindMultiplier;
                const avgCombatDropQuantity = hasKillContext
                    ? playerKillContext.sumCombatDropQuantity / killContext.killCount
                    : combatDropQuantity;

                // Regular drops
                if (monsterData.dropTable) {
                    for (const drop of monsterData.dropTable) {
                        if (drop.minDifficultyTier > difficultyTier) continue;

                        const tierMultiplier = 1.0 + 0.1 * difficultyTier;
                        const baseRate = drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier;
                        const adjustedRate = Math.min(1.0, tierMultiplier * baseRate * avgDropRateMultiplier);
                        if (adjustedRate <= 0) continue;

                        const avgCount = (drop.minCount + drop.maxCount) / 2;
                        const expected =
                            (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + avgCombatDropQuantity)) /
                            numberOfPlayers;

                        totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                    }
                }

                // Rare drops
                if (monsterData.rareDropTable) {
                    for (const drop of monsterData.rareDropTable) {
                        if (drop.minDifficultyTier > difficultyTier) continue;

                        const adjustedRate = drop.dropRate * avgRareFindMultiplier;
                        const avgCount = (drop.minCount + (drop.maxCount ?? drop.minCount)) / 2;
                        const expected =
                            (killCount * adjustedRate * avgCount * (1 + debuffOnLevelGap) * (1 + avgCombatDropQuantity)) /
                            numberOfPlayers;

                        totalDropMap.set(drop.itemHrid, (totalDropMap.get(drop.itemHrid) || 0) + expected);
                    }
                }
            }
        }

        return totalDropMap;
    }

    /**
     * Calculate dungeon key costs from a drop map.
     * Entry keys (1:1 with regular chests) + chest keys (1:1 with all chests).
     * @param {Map<string, number>} dropMap - itemHrid → expected count from calculateExpectedDrops
     * @param {Function} getBuyPrice - Function (itemHrid) => {value, isOutlier} to get the buy price for an item
     * @returns {Array<{itemHrid: string, name: string, count: number, unitCost: number, totalCost: number, isOutlier: boolean}>}
     */
    function calculateDungeonKeyCosts(dropMap, getBuyPrice) {
        const costs = [];
        if (!dropMap) return costs;

        const keyCounts = {};

        // Entry keys: 1 per regular chest
        for (const [chestHrid, count] of dropMap.entries()) {
            const entryKeyHrid = DUNGEON_ENTRY_KEYS[chestHrid];
            if (entryKeyHrid && count > 0) {
                keyCounts[entryKeyHrid] = (keyCounts[entryKeyHrid] || 0) + count;
            }
        }

        // Chest keys: 1 per chest (regular + refinement)
        for (const [chestHrid, count] of dropMap.entries()) {
            const chestKeyHrid = DUNGEON_CHEST_KEYS[chestHrid];
            if (chestKeyHrid && count > 0) {
                keyCounts[chestKeyHrid] = (keyCounts[chestKeyHrid] || 0) + count;
            }
        }

        for (const [keyHrid, count] of Object.entries(keyCounts)) {
            const { value: unitCost, isOutlier } = getBuyPrice(keyHrid);
            const keyDetails = dataManager.getItemDetails(keyHrid);
            costs.push({
                itemHrid: keyHrid,
                name: getItemName(keyHrid, keyDetails?.name || keyHrid.split('/').pop()),
                count,
                unitCost,
                totalCost: count * unitCost,
                isOutlier,
            });
        }

        return costs.sort((a, b) => b.totalCost - a.totalCost);
    }

    /**
     * Resolve the buy-side price for an item, outlier-guard aware (routes through
     * expectedValueCalculator.resolveBuySideValue instead of a raw marketAPI.getPrice lookup).
     * @param {string} itemHrid
     * @returns {{value: number, isOutlier: boolean}}
     */
    function resolveBuyPrice(itemHrid) {
        const resolved = expectedValueCalculator.resolveBuySideValue(itemHrid);
        return resolved ? { value: resolved.value, isOutlier: resolved.isOutlier } : { value: 0, isOutlier: false };
    }

    /**
     * Price a dungeon key the way the rest of Toolasha does: under the player's key pricing setting (ask,
     * bid, or the cheaper of buying and crafting), not as a plain market buy.
     * @param {string} keyHrid
     * @returns {{value: number, isOutlier: boolean}} 0 when the key cannot be priced
     */
    function resolveKeyPrice(keyHrid) {
        const { price, isOutlier } = getKeyPriceInfo(keyHrid);
        return { value: price ?? 0, isOutlier: Boolean(isOutlier) };
    }

    /**
     * Calculate revenue and consumable costs from a sim result.
     * Respects the user's profitCalc_pricingMode setting. Reuses the canonical sell-side valuation +
     * market tax contract (CSIM-AUD-012) instead of a Combat-Sim-specific formula, and folds dungeon
     * key cost into its own returned totals (CSIM-AUD-014) so every caller of this shared function -
     * not just the main Results detail view, which already computes key cost separately - sees a
     * complete profit number (e.g. All-Zones' "skip worse tiers" pruning, Upgrade Advisor).
     * @param {Object} simResult - SimResult from runSimulation()
     * @param {Object} gameData - Game data payload from buildGameDataPayload()
     * @param {string} playerHrid - Player HRID to read drop multipliers and consumables for
     * @param {number} hours - Number of hours simulated
     * @returns {{ revenuePerHour: number, costPerHour: number, netPerHour: number, keyCostPerHour: number,
     *             hasMissingPrices: boolean, dropEntries: Array, consumableEntries: Array }}
     */
    function calculateSimRevenue(simResult, gameData, playerHrid, hours) {
        let revenuePerHour = 0;
        let hasMissingPrices = false;
        const dropEntries = [];

        const dropMap = calculateExpectedDrops(simResult, gameData, playerHrid);
        for (const [itemHrid, total] of dropMap.entries()) {
            if (total <= 0) continue;
            const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid);
            if (!resolved) {
                hasMissingPrices = true;
                continue;
            }
            const unitValue = resolved.needsTax ? profitHelpers_js.calculatePriceAfterTax(resolved.value, profitConstants_js.MARKET_TAX) : resolved.value;
            const perHour = (total / hours) * unitValue;
            revenuePerHour += perHour;
            if (unitValue > 0) {
                const itemName = getItemName(
                    itemHrid,
                    dataManager.getItemDetails(itemHrid)?.name || itemHrid.split('/').pop()
                );
                dropEntries.push({
                    name: itemName,
                    countPerHour: total / hours,
                    unitValue,
                    totalValue: perHour,
                    isOutlier: resolved.isOutlier,
                });
            }
        }
        dropEntries.sort((a, b) => b.totalValue - a.totalValue);

        let costPerHour = 0;
        const consumableEntries = [];
        const consumablesUsed = simResult.consumablesUsed?.[playerHrid] || {};
        for (const [itemHrid, count] of Object.entries(consumablesUsed)) {
            const { value: unitCost, isOutlier } = resolveBuyPrice(itemHrid);
            const perHour = (count / hours) * unitCost;
            costPerHour += perHour;
            if (unitCost > 0) {
                const itemName = getItemName(
                    itemHrid,
                    dataManager.getItemDetails(itemHrid)?.name || itemHrid.split('/').pop()
                );
                consumableEntries.push({
                    name: itemName,
                    countPerHour: count / hours,
                    unitCost,
                    totalCost: perHour,
                    isOutlier,
                });
            }
        }

        let keyCostPerHour = 0;
        if (simResult.isDungeon) {
            const keyCosts = calculateDungeonKeyCosts(dropMap, resolveKeyPrice);
            for (const key of keyCosts) {
                keyCostPerHour += key.totalCost / hours;
            }
            costPerHour += keyCostPerHour;
        }

        return {
            revenuePerHour,
            costPerHour,
            netPerHour: revenuePerHour - costPerHour,
            keyCostPerHour,
            hasMissingPrices,
            dropEntries,
            consumableEntries,
        };
    }

    /**
     * Find all zone×tier combinations that drop the specified item.
     * Checks regular zone monster drop tables and dungeon reward drop tables.
     * @param {string} itemHrid - e.g. '/items/soul_hunter_crossbow'
     * @param {Object} gameData - Game data payload from buildGameDataPayload()
     * @returns {Array<{zoneHrid: string, difficultyTier: number, name: string}>} Sorted by sortIndex then tier
     */
    function getZonesThatDropItem(itemHrid, gameData) {
        const { actionDetailMap, combatMonsterDetailMap } = gameData;
        if (!actionDetailMap || !combatMonsterDetailMap) return [];

        const results = [];

        for (const [hrid, action] of Object.entries(actionDetailMap)) {
            if (action.type !== '/action_types/combat') continue;

            const maxDifficulty = action.maxDifficulty || 0;
            const isDungeon = action.combatZoneInfo?.isDungeon || false;

            if (isDungeon) {
                // Dungeon: item comes from the reward drop table (same table for all tiers)
                const rewardDropTable = action.combatZoneInfo?.dungeonInfo?.rewardDropTable;
                if (rewardDropTable?.some((drop) => drop.itemHrid === itemHrid)) {
                    for (let tier = 0; tier <= maxDifficulty; tier++) {
                        results.push({ zoneHrid: hrid, difficultyTier: tier, name: action.name });
                    }
                }
            } else {
                // Regular zone: check each monster's drop table and rare drop table
                const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
                const bossSpawns = action.combatZoneInfo?.fightInfo?.bossSpawns || [];
                const validTiers = new Set();

                for (const spawn of [...spawns, ...bossSpawns]) {
                    const monster = combatMonsterDetailMap[spawn.combatMonsterHrid];
                    if (!monster) continue;

                    for (const drop of monster.dropTable || []) {
                        if (drop.itemHrid !== itemHrid) continue;
                        const minTier = drop.minDifficultyTier || 0;
                        for (let tier = minTier; tier <= maxDifficulty; tier++) {
                            validTiers.add(tier);
                        }
                    }

                    for (const drop of monster.rareDropTable || []) {
                        if (drop.itemHrid !== itemHrid) continue;
                        const minTier = drop.minDifficultyTier || 0;
                        for (let tier = minTier; tier <= maxDifficulty; tier++) {
                            validTiers.add(tier);
                        }
                    }
                }

                for (const tier of validTiers) {
                    results.push({ zoneHrid: hrid, difficultyTier: tier, name: action.name });
                }
            }
        }

        results.sort((a, b) => {
            const aSortIndex = actionDetailMap[a.zoneHrid]?.sortIndex ?? 0;
            const bSortIndex = actionDetailMap[b.zoneHrid]?.sortIndex ?? 0;
            if (aSortIndex !== bSortIndex) return aSortIndex - bSortIndex;
            return a.difficultyTier - b.difficultyTier;
        });

        return results;
    }

    var combatSimAdapter = /*#__PURE__*/Object.freeze({
        __proto__: null,
        COMBAT_SHRINE_HRIDS: COMBAT_SHRINE_HRIDS,
        DUNGEON_CHEST_KEYS: DUNGEON_CHEST_KEYS,
        DUNGEON_ENTRY_KEYS: DUNGEON_ENTRY_KEYS,
        applyLoadoutSnapshotToDTO: applyLoadoutSnapshotToDTO,
        buildAllPlayerDTOs: buildAllPlayerDTOs,
        buildGameDataPayload: buildGameDataPayload,
        buildPlayerDTO: buildPlayerDTO,
        buildPlayerDTOFromProfile: buildPlayerDTOFromProfile,
        calculateCombatLevelFromLevelFields: calculateCombatLevelFromLevelFields,
        calculateDungeonKeyCosts: calculateDungeonKeyCosts,
        calculateExpectedDrops: calculateExpectedDrops,
        calculateLevelGapDebuff: calculateLevelGapDebuff,
        calculateSimRevenue: calculateSimRevenue,
        computeOomPercent: computeOomPercent,
        getCombatGuildBuffHridForShrine: getCombatGuildBuffHridForShrine,
        getCombatZones: getCombatZones,
        getCommunityBuffs: getCommunityBuffs,
        getCurrentCombatZone: getCurrentCombatZone,
        getLabyrinthCrates: getLabyrinthCrates,
        getLabyrinthMonsters: getLabyrinthMonsters,
        getZonesThatDropItem: getZonesThatDropItem,
        mapLoadoutAbilitiesToNativeSlots: mapLoadoutAbilitiesToNativeSlots,
        parseShykaiImport: parseShykaiImport,
        resolveKeyPrice: resolveKeyPrice
    });

    var WORKER_SCRIPT = "(function () {\n    'use strict';\n\n    /**\n     * Game Data Singleton\n     *\n     * Replaces static JSON imports across the ported combat simulator engine.\n     * Game data maps are set once per simulation run from Toolasha's live data.\n     */\n\n    let _gameData = null;\n\n    /**\n     * Set all game data maps for the simulation.\n     * @param {Object} data - Game data maps from dataManager.getInitClientData()\n     */\n    function setGameData(data) {\n        _gameData = data;\n    }\n\n    /**\n     * Get the current game data maps.\n     * @returns {Object} Game data maps\n     */\n    function getGameData() {\n        return _gameData;\n    }\n\n    class CombatUtilities {\n        /**\n         * Task Damage is only earned while undertaking the relevant task (CSIM-AUD-023): a player's\n         * taskDamage bonus applies against `opponent` only when `opponent` is that player's active\n         * Monster-task target. Non-player units (monsters) have no task concept, so their own\n         * (effectively always-zero) taskDamage stat is returned unconditionally rather than gated.\n         * @param {CombatUnit} unit - The unit whose taskDamage stat is being considered\n         * @param {CombatUnit} opponent - The unit on the other side of this damage exchange\n         * @returns {number}\n         */\n        static getEffectiveTaskDamage(unit, opponent) {\n            if (!unit.isPlayer) return unit.combatDetails.combatStats.taskDamage;\n            const isEligible = unit.taskEligibleMonsterHrids?.includes(opponent.hrid);\n            return isEligible ? unit.combatDetails.combatStats.taskDamage : 0;\n        }\n\n        static getTarget(enemies) {\n            if (!enemies) {\n                return null;\n            }\n            const target = enemies.find((enemy) => enemy.combatDetails.currentHitpoints > 0);\n\n            return target ?? null;\n        }\n\n        static randomInt(min, max) {\n            if (max < min) {\n                const temp = min;\n                min = max;\n                max = temp;\n            }\n\n            const minCeil = Math.ceil(min);\n            const maxFloor = Math.floor(max);\n\n            if (Math.floor(min) === maxFloor) {\n                return Math.floor((min + max) / 2 + Math.random());\n            }\n\n            const minTail = -1 * (min - minCeil);\n            const maxTail = max - maxFloor;\n\n            const balancedWeight = 2 * minTail + (maxFloor - minCeil);\n            const balancedAverage = (maxFloor + minCeil) / 2;\n            const average = (max + min) / 2;\n            const extraTailWeight = (balancedWeight * (average - balancedAverage)) / (maxFloor + 1 - average);\n            const extraTailChance = Math.abs(extraTailWeight / (extraTailWeight + balancedWeight));\n\n            if (Math.random() < extraTailChance) {\n                if (maxTail > minTail) {\n                    return Math.floor(maxFloor + 1);\n                } else {\n                    return Math.floor(minCeil - 1);\n                }\n            }\n\n            if (maxTail > minTail) {\n                return Math.floor(min + Math.random() * (maxFloor + minTail - min + 1));\n            } else {\n                return Math.floor(minCeil - maxTail + Math.random() * (max - (minCeil - maxTail) + 1));\n            }\n        }\n\n        static processAttack(source, target, abilityEffect = null) {\n            const combatStyle = abilityEffect\n                ? abilityEffect.combatStyleHrid\n                : source.combatDetails.combatStats.combatStyleHrid;\n            const damageType = abilityEffect ? abilityEffect.damageType : source.combatDetails.combatStats.damageType;\n\n            let sourceAccuracyRating = 1;\n            let sourceAutoAttackMaxDamage = 1;\n            let targetEvasionRating = 1;\n\n            switch (combatStyle) {\n                case '/combat_styles/stab':\n                    sourceAccuracyRating = source.combatDetails.stabAccuracyRating;\n                    sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;\n                    targetEvasionRating = target.combatDetails.stabEvasionRating;\n                    break;\n                case '/combat_styles/slash':\n                    sourceAccuracyRating = source.combatDetails.slashAccuracyRating;\n                    sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;\n                    targetEvasionRating = target.combatDetails.slashEvasionRating;\n                    break;\n                case '/combat_styles/smash':\n                    sourceAccuracyRating = source.combatDetails.smashAccuracyRating;\n                    sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;\n                    targetEvasionRating = target.combatDetails.smashEvasionRating;\n                    break;\n                case '/combat_styles/ranged':\n                    sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;\n                    sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;\n                    targetEvasionRating = target.combatDetails.rangedEvasionRating;\n                    break;\n                case '/combat_styles/magic':\n                    sourceAccuracyRating = source.combatDetails.magicAccuracyRating;\n                    sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;\n                    targetEvasionRating = target.combatDetails.magicEvasionRating;\n                    break;\n                default:\n                    throw new Error('Unknown combat style: ' + combatStyle);\n            }\n\n            let sourceDamageMultiplier = 1;\n            let sourceResistance = 0;\n            let sourcePenetration = 0;\n            let targetResistance = 0;\n            let targetThornPower = 0;\n            let targetPenetration = 0;\n            let thornType;\n\n            switch (damageType) {\n                case '/damage_types/physical':\n                    sourceDamageMultiplier = 1 + source.combatDetails.combatStats.physicalAmplify;\n                    sourceResistance = source.combatDetails.totalArmor;\n                    sourcePenetration = source.combatDetails.combatStats.armorPenetration;\n                    targetResistance = target.combatDetails.totalArmor;\n                    targetThornPower = target.combatDetails.combatStats.physicalThorns;\n                    targetPenetration = target.combatDetails.combatStats.armorPenetration;\n                    thornType = 'physicalThorns';\n                    break;\n                case '/damage_types/water':\n                    sourceDamageMultiplier = 1 + source.combatDetails.combatStats.waterAmplify;\n                    sourceResistance = source.combatDetails.totalWaterResistance;\n                    sourcePenetration = source.combatDetails.combatStats.waterPenetration;\n                    targetResistance = target.combatDetails.totalWaterResistance;\n                    targetThornPower = target.combatDetails.combatStats.elementalThorns;\n                    targetPenetration = target.combatDetails.combatStats.waterPenetration;\n                    thornType = 'elementalThorns';\n                    break;\n                case '/damage_types/nature':\n                    sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;\n                    sourceResistance = source.combatDetails.totalNatureResistance;\n                    sourcePenetration = source.combatDetails.combatStats.naturePenetration;\n                    targetResistance = target.combatDetails.totalNatureResistance;\n                    targetThornPower = target.combatDetails.combatStats.elementalThorns;\n                    targetPenetration = target.combatDetails.combatStats.naturePenetration;\n                    thornType = 'elementalThorns';\n                    break;\n                case '/damage_types/fire':\n                    sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;\n                    sourceResistance = source.combatDetails.totalFireResistance;\n                    sourcePenetration = source.combatDetails.combatStats.firePenetration;\n                    targetResistance = target.combatDetails.totalFireResistance;\n                    targetThornPower = target.combatDetails.combatStats.elementalThorns;\n                    targetPenetration = target.combatDetails.combatStats.firePenetration;\n                    thornType = 'elementalThorns';\n                    break;\n                default:\n                    throw new Error('Unknown damage type: ' + damageType);\n            }\n\n            let hitChance = 1;\n            let critChance = 0;\n            let isCrit = false;\n            const bonusCritChance = source.combatDetails.combatStats.criticalRate;\n            const bonusCritDamage = source.combatDetails.combatStats.criticalDamage;\n\n            if (abilityEffect) {\n                sourceAccuracyRating *= 1 + abilityEffect.bonusAccuracyRatio;\n            }\n\n            if (source.isWeakened) {\n                sourceAccuracyRating = sourceAccuracyRating - source.weakenPercentage * sourceAccuracyRating;\n            }\n\n            hitChance =\n                Math.pow(sourceAccuracyRating, 1.4) /\n                (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));\n\n            if (combatStyle === '/combat_styles/ranged') {\n                critChance = 0.3 * hitChance;\n            }\n\n            critChance = critChance + bonusCritChance;\n\n            const baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;\n            const baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;\n\n            const armorDamageRatioFlat = abilityEffect\n                ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor\n                : 0;\n\n            let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);\n            let sourceMaxDamage =\n                sourceDamageMultiplier *\n                (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);\n\n            if (Math.random() < critChance) {\n                sourceMaxDamage = sourceMaxDamage * (1 + bonusCritDamage);\n                sourceMinDamage = sourceMaxDamage;\n                isCrit = true;\n            }\n\n            let damageRoll = CombatUtilities.randomInt(sourceMinDamage, sourceMaxDamage);\n            damageRoll *= 1 + CombatUtilities.getEffectiveTaskDamage(source, target);\n            damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;\n            if (!abilityEffect) {\n                damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;\n            } else {\n                damageRoll *= 1 + source.combatDetails.combatStats.abilityDamage;\n            }\n\n            let damageDone = 0;\n            let thornDamageDone = 0;\n\n            let didHit = false;\n            if (Math.random() < hitChance) {\n                didHit = true;\n                let penetratedTargetResistance = targetResistance;\n\n                if (sourcePenetration > 0 && targetResistance > 0) {\n                    penetratedTargetResistance = targetResistance / (1 + sourcePenetration);\n                }\n\n                let targetDamageTakenRatio = 100 / (100 + penetratedTargetResistance);\n                if (penetratedTargetResistance < 0) {\n                    targetDamageTakenRatio = (100 - penetratedTargetResistance) / 100;\n                }\n\n                const mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);\n                damageDone = Math.min(mitigatedDamage, target.combatDetails.currentHitpoints);\n                target.combatDetails.currentHitpoints -= damageDone;\n            }\n\n            if (targetThornPower > 0.0 && targetResistance > -99) {\n                let penetratedSourceResistance = sourceResistance;\n\n                if (sourceResistance > 0) {\n                    penetratedSourceResistance = sourceResistance / (1 + targetPenetration);\n                }\n\n                let sourceDamageTakenRatio = 100.0 / (100 + penetratedSourceResistance);\n                if (penetratedSourceResistance < 0) {\n                    sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;\n                }\n\n                const targetTaskDamageMultiplier = 1.0 + CombatUtilities.getEffectiveTaskDamage(target, source);\n                const sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;\n                const targetDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;\n\n                const thornsDamageRoll = CombatUtilities.randomInt(\n                    1,\n                    targetDamageMultiplier *\n                        target.combatDetails.defensiveMaxDamage *\n                        (1.0 + targetResistance / 100.0) *\n                        targetThornPower\n                );\n\n                const mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);\n\n                thornDamageDone = Math.min(mitigatedThornsDamage, source.combatDetails.currentHitpoints);\n                source.combatDetails.currentHitpoints -= thornDamageDone;\n            }\n\n            let retaliationDamageDone = 0;\n            if (target.combatDetails.combatStats.retaliation > 0) {\n                const retaliationHitChance =\n                    Math.pow(target.combatDetails.smashAccuracyRating, 1.4) /\n                    (Math.pow(target.combatDetails.smashAccuracyRating, 1.4) +\n                        Math.pow(source.combatDetails.smashEvasionRating, 1.4));\n\n                if (retaliationHitChance > Math.random()) {\n                    let sourceEffectiveArmor = source.combatDetails.totalArmor;\n                    if (sourceEffectiveArmor > 0) {\n                        sourceEffectiveArmor =\n                            sourceEffectiveArmor / (1.0 + target.combatDetails.combatStats.armorPenetration);\n                    }\n\n                    let sourceDamageTakenRatio = 100.0 / (100.0 + sourceEffectiveArmor);\n                    if (sourceEffectiveArmor < 0) {\n                        sourceDamageTakenRatio = (100.0 - sourceEffectiveArmor) / 100.0;\n                    }\n\n                    const targetTaskDamageMultiplier = 1.0 + CombatUtilities.getEffectiveTaskDamage(target, source);\n                    const sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;\n                    const retaliationDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;\n\n                    let premitigatedDamage = damageRoll;\n                    premitigatedDamage = Math.min(premitigatedDamage, target.combatDetails.defensiveMaxDamage * 5);\n\n                    const retaliationMinDamage =\n                        retaliationDamageMultiplier * target.combatDetails.combatStats.retaliation * premitigatedDamage;\n                    const retaliationMaxDamage =\n                        retaliationDamageMultiplier *\n                        target.combatDetails.combatStats.retaliation *\n                        (target.combatDetails.defensiveMaxDamage + premitigatedDamage);\n\n                    const retaliationDamageRoll = CombatUtilities.randomInt(retaliationMinDamage, retaliationMaxDamage);\n                    const mitigatedRetaliationDamage = Math.ceil(sourceDamageTakenRatio * retaliationDamageRoll);\n                    retaliationDamageDone = Math.min(mitigatedRetaliationDamage, source.combatDetails.currentHitpoints);\n                    source.combatDetails.currentHitpoints -= retaliationDamageDone;\n                }\n            }\n\n            let lifeStealHeal = 0;\n            if (!abilityEffect && didHit && source.combatDetails.combatStats.lifeSteal > 0) {\n                lifeStealHeal = source.addHitpoints(Math.floor(source.combatDetails.combatStats.lifeSteal * damageDone));\n            }\n\n            let hpDrain = 0;\n            if (abilityEffect && didHit && abilityEffect.hpDrainRatio > 0) {\n                const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;\n                hpDrain = source.addHitpoints(Math.floor(abilityEffect.hpDrainRatio * damageDone * healingAmplify));\n            }\n\n            let manaLeechMana = 0;\n            if (!abilityEffect && didHit && source.combatDetails.combatStats.manaLeech > 0) {\n                manaLeechMana = source.addManapoints(Math.floor(source.combatDetails.combatStats.manaLeech * damageDone));\n            }\n\n            return {\n                damageDone,\n                didHit,\n                thornDamageDone,\n                thornType,\n                retaliationDamageDone,\n                lifeStealHeal,\n                hpDrain,\n                manaLeechMana,\n                isCrit,\n            };\n        }\n\n        static processHeal(source, abilityEffect, target) {\n            if (abilityEffect.combatStyleHrid !== '/combat_styles/magic') {\n                throw new Error('Heal ability effect not supported for combat style: ' + abilityEffect.combatStyleHrid);\n            }\n\n            const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;\n            const magicMaxDamage = source.combatDetails.magicMaxDamage;\n\n            const baseHealFlat = abilityEffect.damageFlat;\n            const baseHealRatio = abilityEffect.damageRatio;\n\n            const minHeal = healingAmplify * (1 + baseHealFlat);\n            const maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);\n\n            const heal = this.randomInt(minHeal, maxHeal);\n            const amountHealed = target.addHitpoints(heal);\n\n            return amountHealed;\n        }\n\n        static processRevive(source, abilityEffect, target) {\n            if (abilityEffect.combatStyleHrid !== '/combat_styles/magic') {\n                throw new Error('Heal ability effect not supported for combat style: ' + abilityEffect.combatStyleHrid);\n            }\n\n            const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;\n            const magicMaxDamage = source.combatDetails.magicMaxDamage;\n\n            const baseHealFlat = abilityEffect.damageFlat;\n            const baseHealRatio = abilityEffect.damageRatio;\n\n            const minHeal = healingAmplify * (1 + baseHealFlat);\n            const maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);\n\n            const heal = this.randomInt(minHeal, maxHeal);\n            const amountHealed = target.addHitpoints(heal);\n            target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;\n            target.clearCCs();\n\n            // target.clearBuffs();\n\n            return amountHealed;\n        }\n\n        static processSpendHp(source, abilityEffect) {\n            const currentHp = source.combatDetails.currentHitpoints;\n            const spendHpRatio = abilityEffect.spendHpRatio;\n\n            const spentHp = Math.floor(currentHp * spendHpRatio);\n\n            source.combatDetails.currentHitpoints -= spentHp;\n\n            return spentHp;\n        }\n\n        static calculateTickValue(totalValue, totalTicks, currentTick) {\n            const currentSum = Math.floor((currentTick * totalValue) / totalTicks);\n            const previousSum = Math.floor(((currentTick - 1) * totalValue) / totalTicks);\n\n            return currentSum - previousSum;\n        }\n    }\n\n    class CombatEvent {\n        constructor(type, time) {\n            this.type = type;\n            this.time = time;\n        }\n    }\n\n    class AutoAttackEvent extends CombatEvent {\n        static type = 'autoAttack';\n\n        constructor(time, source) {\n            super(AutoAttackEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class DamageOverTimeEvent extends CombatEvent {\n        static type = 'damageOverTime';\n\n        constructor(time, sourceRef, target, damage, totalTicks, currentTick, combatStyleHrid) {\n            super(DamageOverTimeEvent.type, time);\n\n            // Calling it 'source' would wrongly clear Damage Over Time when the source dies\n            this.sourceRef = sourceRef;\n            this.target = target;\n            this.damage = damage;\n            this.totalTicks = totalTicks;\n            this.currentTick = currentTick;\n            this.combatStyleHrid = combatStyleHrid;\n        }\n    }\n\n    class CheckBuffExpirationEvent extends CombatEvent {\n        static type = 'checkBuffExpiration';\n\n        constructor(time, source) {\n            super(CheckBuffExpirationEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class CombatStartEvent extends CombatEvent {\n        static type = 'combatStart';\n\n        constructor(time) {\n            super(CombatStartEvent.type, time);\n        }\n    }\n\n    class ConsumableTickEvent extends CombatEvent {\n        static type = 'consumableTick';\n\n        constructor(time, source, consumable, totalTicks, currentTick) {\n            super(ConsumableTickEvent.type, time);\n\n            this.source = source;\n            this.consumable = consumable;\n            this.totalTicks = totalTicks;\n            this.currentTick = currentTick;\n        }\n    }\n\n    class CooldownReadyEvent extends CombatEvent {\n        static type = 'cooldownReady';\n\n        constructor(time) {\n            super(CooldownReadyEvent.type, time);\n        }\n    }\n\n    class EnemyRespawnEvent extends CombatEvent {\n        static type = 'enemyRespawn';\n\n        constructor(time) {\n            super(EnemyRespawnEvent.type, time);\n        }\n    }\n\n    /**\n     * EventQueue — simple binary min-heap with linear scan queries.\n     *\n     * Optimized for the combat sim's access pattern: frequent add/remove (every tick)\n     * with rare queries (a few per encounter). The heap typically holds 10-30 events,\n     * making linear scans trivially fast and eliminating the overhead of maintaining\n     * secondary indexes on every mutation.\n     */\n\n    /**\n     * Binary min-heap with O(log n) removal via position tracking.\n     */\n    class IndexedMinHeap {\n        constructor() {\n            this.data = [];\n        }\n\n        get size() {\n            return this.data.length;\n        }\n\n        push(event) {\n            event._heapIndex = this.data.length;\n            this.data.push(event);\n            this._siftUp(this.data.length - 1);\n        }\n\n        pop() {\n            if (this.data.length === 0) return undefined;\n            const top = this.data[0];\n            const last = this.data.pop();\n            if (this.data.length > 0) {\n                last._heapIndex = 0;\n                this.data[0] = last;\n                this._siftDown(0);\n            }\n            top._heapIndex = -1;\n            return top;\n        }\n\n        remove(event) {\n            const idx = event._heapIndex;\n            if (idx === undefined || idx < 0 || idx >= this.data.length || this.data[idx] !== event) {\n                return false;\n            }\n\n            if (idx === this.data.length - 1) {\n                this.data.pop();\n                event._heapIndex = -1;\n                return true;\n            }\n\n            const last = this.data.pop();\n            last._heapIndex = idx;\n            this.data[idx] = last;\n            event._heapIndex = -1;\n\n            this._siftUp(idx);\n            this._siftDown(idx);\n            return true;\n        }\n\n        _siftUp(idx) {\n            const data = this.data;\n            while (idx > 0) {\n                const parent = (idx - 1) >> 1;\n                if (data[idx].time >= data[parent].time) break;\n                const tmp = data[parent];\n                data[parent] = data[idx];\n                data[idx] = tmp;\n                data[parent]._heapIndex = parent;\n                data[idx]._heapIndex = idx;\n                idx = parent;\n            }\n        }\n\n        _siftDown(idx) {\n            const data = this.data;\n            const len = data.length;\n            while (true) {\n                let smallest = idx;\n                const left = 2 * idx + 1;\n                const right = 2 * idx + 2;\n\n                if (left < len && data[left].time < data[smallest].time) smallest = left;\n                if (right < len && data[right].time < data[smallest].time) smallest = right;\n\n                if (smallest === idx) break;\n\n                const tmp = data[smallest];\n                data[smallest] = data[idx];\n                data[idx] = tmp;\n                data[smallest]._heapIndex = smallest;\n                data[idx]._heapIndex = idx;\n                idx = smallest;\n            }\n        }\n    }\n\n    /**\n     * EventQueue with O(log n) add/remove and linear scan queries.\n     */\n    class EventQueue {\n        constructor() {\n            this.minHeap = new IndexedMinHeap();\n        }\n\n        /**\n         * Add event to the queue.\n         * @param {Object} event\n         */\n        addEvent(event) {\n            this.minHeap.push(event);\n        }\n\n        /**\n         * Pop the earliest event.\n         * @returns {Object|undefined}\n         */\n        getNextEvent() {\n            return this.minHeap.pop();\n        }\n\n        /**\n         * Non-destructively read the earliest event without removing it.\n         * @returns {Object|undefined}\n         */\n        peekNextEvent() {\n            return this.minHeap.data[0];\n        }\n\n        /**\n         * Check if any event of the given type exists.\n         * @param {string} type\n         * @returns {boolean}\n         */\n        containsEventOfType(type) {\n            const data = this.minHeap.data;\n            for (let i = 0; i < data.length; i++) {\n                if (data[i].type === type) return true;\n            }\n            return false;\n        }\n\n        /**\n         * Check if an event of the given type and hrid exists.\n         * @param {string} type\n         * @param {string} hrid\n         * @returns {boolean}\n         */\n        containsEventOfTypeAndHrid(type, hrid) {\n            const data = this.minHeap.data;\n            for (let i = 0; i < data.length; i++) {\n                if (data[i].type === type && data[i].hrid === hrid) return true;\n            }\n            return false;\n        }\n\n        /**\n         * Get an event matching type + source.\n         * @param {string} type\n         * @param {Object} source\n         * @returns {Object|null}\n         */\n        getByTypeAndSource(type, source) {\n            const data = this.minHeap.data;\n            for (let i = 0; i < data.length; i++) {\n                if (data[i].type === type && data[i].source === source) return data[i];\n            }\n            return null;\n        }\n\n        /**\n         * Clear all events matching type + source.\n         * @param {string} type\n         * @param {Object} source\n         * @returns {boolean} true if any events were cleared\n         */\n        clearByTypeAndSource(type, source) {\n            let cleared = false;\n            const data = this.minHeap.data;\n            for (let i = data.length - 1; i >= 0; i--) {\n                if (data[i].type === type && data[i].source === source) {\n                    this.minHeap.remove(data[i]);\n                    cleared = true;\n                }\n            }\n            return cleared;\n        }\n\n        /**\n         * Clear all events matching type + hrid.\n         * @param {string} type\n         * @param {string} hrid\n         * @returns {boolean}\n         */\n        clearByTypeAndHrid(type, hrid) {\n            let cleared = false;\n            const data = this.minHeap.data;\n            for (let i = data.length - 1; i >= 0; i--) {\n                if (data[i].type === type && data[i].hrid === hrid) {\n                    this.minHeap.remove(data[i]);\n                    cleared = true;\n                }\n            }\n            return cleared;\n        }\n\n        /**\n         * Clear all events for a unit (as source OR target).\n         * @param {Object} unit\n         */\n        clearEventsForUnit(unit) {\n            const data = this.minHeap.data;\n            for (let i = data.length - 1; i >= 0; i--) {\n                if (data[i].source === unit || data[i].target === unit) {\n                    this.minHeap.remove(data[i]);\n                }\n            }\n        }\n\n        /**\n         * Clear all events of a given type.\n         * @param {string} type\n         */\n        clearEventsOfType(type) {\n            const data = this.minHeap.data;\n            for (let i = data.length - 1; i >= 0; i--) {\n                if (data[i].type === type) {\n                    this.minHeap.remove(data[i]);\n                }\n            }\n        }\n\n        /**\n         * Clear all events and reset.\n         */\n        clear() {\n            this.minHeap = new IndexedMinHeap();\n        }\n\n        /**\n         * Generic clearMatching for complex predicates.\n         * @param {Function} fn - Predicate\n         * @returns {boolean}\n         */\n        clearMatching(fn) {\n            let cleared = false;\n            const data = this.minHeap.data;\n            for (let i = data.length - 1; i >= 0; i--) {\n                if (fn(data[i])) {\n                    this.minHeap.remove(data[i]);\n                    cleared = true;\n                }\n            }\n            return cleared;\n        }\n\n        /**\n         * Generic getMatching for complex predicates.\n         * @param {Function} fn - Predicate\n         * @returns {Object|null}\n         */\n        getMatching(fn) {\n            const data = this.minHeap.data;\n            for (let i = 0; i < data.length; i++) {\n                if (fn(data[i])) return data[i];\n            }\n            return null;\n        }\n    }\n\n    class PlayerRespawnEvent extends CombatEvent {\n        static type = 'playerRespawn';\n\n        constructor(time, hrid) {\n            super(PlayerRespawnEvent.type, time);\n            this.hrid = hrid;\n        }\n    }\n\n    class RegenTickEvent extends CombatEvent {\n        static type = 'regenTick';\n\n        constructor(time) {\n            super(RegenTickEvent.type, time);\n        }\n    }\n\n    class StunExpirationEvent extends CombatEvent {\n        static type = 'stunExpiration';\n\n        constructor(time, source) {\n            super(StunExpirationEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class BlindExpirationEvent extends CombatEvent {\n        static type = 'blindExpiration';\n\n        constructor(time, source) {\n            super(BlindExpirationEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class SilenceExpirationEvent extends CombatEvent {\n        static type = 'silenceExpiration';\n\n        constructor(time, source) {\n            super(SilenceExpirationEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class CurseExpirationEvent extends CombatEvent {\n        static type = 'curseExpiration';\n        static maxCurseStacks = 5;\n\n        constructor(time, curseAmount, source) {\n            super(CurseExpirationEvent.type, time);\n\n            this.curseAmount = Math.min(curseAmount + 1, CurseExpirationEvent.maxCurseStacks);\n\n            this.source = source;\n        }\n    }\n\n    class WeakenExpirationEvent extends CombatEvent {\n        static type = 'weakenExpiration';\n        static maxWeakenStacks = 5;\n\n        constructor(time, weakenAmount, source) {\n            super(WeakenExpirationEvent.type, time);\n            this.weakenAmount = Math.min(weakenAmount + 1, WeakenExpirationEvent.maxWeakenStacks);\n            this.source = source;\n        }\n    }\n\n    class FuryExpirationEvent extends CombatEvent {\n        static type = 'furyExpiration';\n\n        constructor(time, furyAmount, source) {\n            super(FuryExpirationEvent.type, time);\n\n            this.furyAmount = furyAmount;\n            this.source = source;\n        }\n    }\n\n    class EnrageTickEvent extends CombatEvent {\n        static type = 'enrageTick';\n\n        constructor(time, encounterTime) {\n            super(EnrageTickEvent.type, time);\n\n            this.encounterTime = encounterTime;\n        }\n    }\n\n    class SimResult {\n        constructor(zone, numberOfPlayers) {\n            this.deaths = {};\n            this.experienceGained = {};\n            this.encounters = 0;\n            this.consumablesUsed = {};\n            this.hitpointsGained = {};\n            this.manapointsGained = {};\n            this.debuffOnLevelGap = {};\n            this.dropRateMultiplier = {};\n            this.rareFindMultiplier = {};\n            this.combatDropQuantity = {};\n            this.playerRanOutOfMana = {\n                player1: false,\n                player2: false,\n                player3: false,\n                player4: false,\n                player5: false,\n            };\n            this.playerRanOutOfManaTime = {};\n            this.manaUsed = {};\n            this.timeSpentAlive = [];\n            this.bossSpawns = [];\n            this.hitpointsSpent = {};\n            this.zoneName = zone.hrid;\n            this.difficultyTier = zone.difficultyTier;\n            this.isDungeon = false;\n            this.dungeonsCompleted = 0;\n            this.dungeonsFailed = 0;\n            this.maxWaveReached = 0;\n            this.numberOfPlayers = numberOfPlayers;\n            this.maxEnrageStack = 0;\n\n            this.wipeEvents = [];\n            this.totalDamageDealt = {}; // sourceHrid → total damage dealt\n\n            // Kill-time-context drop accounting (CSIM-AUD-011): per-monster, per-player running sums\n            // of each player's drop-rate/rare-find/quantity multiplier AT THE MOMENT of each kill,\n            // rather than a single end-of-simulation snapshot applied retroactively to every kill.\n            // { [monsterHrid]: { killCount, byPlayer: { [playerHrid]: { sumDropRateMultiplier, sumRareFindMultiplier, sumCombatDropQuantity } } } }\n            this.killDropContext = {};\n            // Same idea for dungeon completion rewards, which only use combatDropQuantity.\n            this.dungeonCompletionDropContext = { count: 0, byPlayer: {} };\n\n            // Sum of successful completed-run durations (terminal kill time - run start time), in ns\n            // (TLA-039 HZN). Excludes any unfinished final attempt and the inter-run restart interval,\n            // so totalDungeonCompletionDuration / dungeonsCompleted is a true average clear time.\n            this.totalDungeonCompletionDuration = 0;\n        }\n\n        /**\n         * Accumulate one successful dungeon run's duration, measured from that run's wave-1 start to\n         * its final-wave terminal kill (TLA-039 HZN).\n         * @param {number} durationNs\n         */\n        addDungeonCompletionDuration(durationNs) {\n            this.totalDungeonCompletionDuration += durationNs;\n        }\n\n        addWipeEvent(logs, simulationTime, wave) {\n            this.wipeEvents.push({\n                simulationTime: simulationTime,\n                logs: logs,\n                wave: wave,\n                timestamp: new Date().toISOString(),\n            });\n        }\n\n        addDeath(unit) {\n            if (!this.deaths[unit.hrid]) {\n                this.deaths[unit.hrid] = 0;\n            }\n\n            this.deaths[unit.hrid] += 1;\n        }\n\n        /**\n         * Accumulate each player's drop-rate/rare-find/quantity multiplier AT THE MOMENT this monster\n         * died (CSIM-AUD-011), instead of relying solely on a single end-of-simulation snapshot\n         * applied retroactively to every kill regardless of when temporary buffs/scrolls were active.\n         * @param {string} monsterHrid\n         * @param {Array<Player>} players\n         */\n        recordMonsterKill(monsterHrid, players) {\n            if (!this.killDropContext[monsterHrid]) {\n                this.killDropContext[monsterHrid] = { killCount: 0, byPlayer: {} };\n            }\n            const entry = this.killDropContext[monsterHrid];\n            entry.killCount += 1;\n\n            for (const player of players || []) {\n                if (!player) continue;\n                if (!entry.byPlayer[player.hrid]) {\n                    entry.byPlayer[player.hrid] = {\n                        sumDropRateMultiplier: 0,\n                        sumRareFindMultiplier: 0,\n                        sumCombatDropQuantity: 0,\n                    };\n                }\n                const stats = player.combatDetails.combatStats;\n                entry.byPlayer[player.hrid].sumDropRateMultiplier += 1 + stats.combatDropRate;\n                entry.byPlayer[player.hrid].sumRareFindMultiplier += 1 + stats.combatRareFind;\n                entry.byPlayer[player.hrid].sumCombatDropQuantity += stats.combatDropQuantity;\n            }\n        }\n\n        /**\n         * Same kill-time-context accounting as recordMonsterKill(), for dungeon completion rewards\n         * (which only use combatDropQuantity, not per-monster drop-rate/rare-find).\n         * @param {Array<Player>} players\n         */\n        recordDungeonCompletion(players) {\n            this.dungeonCompletionDropContext.count += 1;\n\n            for (const player of players || []) {\n                if (!player) continue;\n                if (!this.dungeonCompletionDropContext.byPlayer[player.hrid]) {\n                    this.dungeonCompletionDropContext.byPlayer[player.hrid] = { sumCombatDropQuantity: 0 };\n                }\n                this.dungeonCompletionDropContext.byPlayer[player.hrid].sumCombatDropQuantity +=\n                    player.combatDetails.combatStats.combatDropQuantity;\n            }\n        }\n\n        updateTimeSpentAlive(name, alive, time) {\n            const i = this.timeSpentAlive.findIndex((e) => e.name === name);\n            if (alive) {\n                if (i !== -1) {\n                    this.timeSpentAlive[i].alive = true;\n                    this.timeSpentAlive[i].spawnedAt = time;\n                } else {\n                    this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });\n                }\n            } else {\n                const timeAlive = time - this.timeSpentAlive[i].spawnedAt;\n                this.timeSpentAlive[i].alive = false;\n                this.timeSpentAlive[i].timeSpentAlive += timeAlive;\n                this.timeSpentAlive[i].count += 1;\n            }\n        }\n\n        addExperienceGain(unit, experience) {\n            if (!unit.isPlayer) {\n                return;\n            }\n\n            if (!this.experienceGained[unit.hrid]) {\n                this.experienceGained[unit.hrid] = {\n                    stamina: 0,\n                    intelligence: 0,\n                    attack: 0,\n                    melee: 0,\n                    defense: 0,\n                    ranged: 0,\n                    magic: 0,\n                };\n            }\n\n            const experienceGainedRate = {\n                stamina: 0,\n                intelligence: 0,\n                attack: 0,\n                melee: 0,\n                defense: 0,\n                ranged: 0,\n                magic: 0,\n            };\n\n            const primaryTraining = unit.combatDetails.combatStats.primaryTraining;\n            experienceGainedRate[primaryTraining.split('/')[2]] = 0.3;\n\n            const combatStyleDetailMap = getGameData().combatStyleDetailMap;\n            const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;\n            const skillExpMapLength = Object.keys(skillExpMap).length;\n\n            const focusTraining = unit.combatDetails.combatStats.focusTraining;\n            if (focusTraining && skillExpMap[focusTraining]) {\n                experienceGainedRate[focusTraining.split('/')[2]] += 0.7;\n            } else {\n                Object.keys(skillExpMap).forEach((skillHrid) => {\n                    experienceGainedRate[skillHrid.split('/')[2]] += 0.7 / skillExpMapLength;\n                });\n            }\n\n            for (const [type, rate] of Object.entries(experienceGainedRate)) {\n                if (rate <= 0) continue;\n\n                const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + 'Experience']);\n\n                this.experienceGained[unit.hrid][type] +=\n                    experience *\n                    (1 + unit.combatDetails.combatStats.combatExperience) *\n                    skillExperience *\n                    (1 + unit.debuffOnLevelGap);\n            }\n        }\n\n        addEncounterEnd() {\n            this.encounters++;\n        }\n\n        /**\n         * Accumulate total damage dealt (TLA-039 PERF). A per-attack exact-damage histogram\n         * (source -> target -> ability -> exact damage -> count) used to be written here too, but a\n         * full-repo consumer search found no reader of it - DPS/Upgrade Advisor only ever used\n         * totalDamageDealt - and a warmed benchmark showed the histogram writes were ~84% of this\n         * method's cost, so it was removed rather than kept as write-only dead weight.\n         * @param {CombatUnit} source\n         * @param {CombatUnit} _target\n         * @param {string} _ability\n         * @param {number|'miss'} hit\n         */\n        addAttack(source, _target, _ability, hit) {\n            if (hit !== 'miss') {\n                this.totalDamageDealt[source.hrid] = (this.totalDamageDealt[source.hrid] || 0) + hit;\n            }\n        }\n\n        addConsumableUse(unit, consumable) {\n            if (!this.consumablesUsed[unit.hrid]) {\n                this.consumablesUsed[unit.hrid] = {};\n            }\n            if (!this.consumablesUsed[unit.hrid][consumable.hrid]) {\n                this.consumablesUsed[unit.hrid][consumable.hrid] = 0;\n            }\n\n            this.consumablesUsed[unit.hrid][consumable.hrid] += 1;\n        }\n\n        addHitpointsGained(unit, source, amount) {\n            if (!this.hitpointsGained[unit.hrid]) {\n                this.hitpointsGained[unit.hrid] = {};\n            }\n            if (!this.hitpointsGained[unit.hrid][source]) {\n                this.hitpointsGained[unit.hrid][source] = 0;\n            }\n\n            this.hitpointsGained[unit.hrid][source] += amount;\n        }\n\n        addManapointsGained(unit, source, amount) {\n            if (!this.manapointsGained[unit.hrid]) {\n                this.manapointsGained[unit.hrid] = {};\n            }\n            if (!this.manapointsGained[unit.hrid][source]) {\n                this.manapointsGained[unit.hrid][source] = 0;\n            }\n\n            this.manapointsGained[unit.hrid][source] += amount;\n        }\n\n        setDropRateMultipliers(unit) {\n            if (!this.dropRateMultiplier[unit.hrid]) {\n                this.dropRateMultiplier[unit.hrid] = {};\n            }\n            this.dropRateMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;\n\n            if (!this.rareFindMultiplier[unit.hrid]) {\n                this.rareFindMultiplier[unit.hrid] = {};\n            }\n            this.rareFindMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;\n\n            if (!this.combatDropQuantity[unit.hrid]) {\n                this.combatDropQuantity[unit.hrid] = {};\n            }\n            this.combatDropQuantity[unit.hrid] = unit.combatDetails.combatStats.combatDropQuantity;\n\n            if (!this.debuffOnLevelGap[unit.hrid]) {\n                this.debuffOnLevelGap[unit.hrid] = {};\n            }\n            this.debuffOnLevelGap[unit.hrid] = unit.debuffOnLevelGap;\n        }\n\n        setManaUsed(unit) {\n            this.manaUsed[unit.hrid] = {};\n            for (const [key, value] of unit.abilityManaCosts.entries()) {\n                this.manaUsed[unit.hrid][key] = value;\n            }\n        }\n\n        addHitpointsSpent(unit, source, amount) {\n            if (!this.hitpointsSpent[unit.hrid]) {\n                this.hitpointsSpent[unit.hrid] = {};\n            }\n            if (!this.hitpointsSpent[unit.hrid][source]) {\n                this.hitpointsSpent[unit.hrid][source] = 0;\n            }\n\n            this.hitpointsSpent[unit.hrid][source] += amount;\n        }\n\n        addRanOutOfManaCount(unit, isOutOfMana, time) {\n            if (isOutOfMana) this.playerRanOutOfMana[unit.hrid] = true;\n\n            if (!this.playerRanOutOfManaTime[unit.hrid]) {\n                this.playerRanOutOfManaTime[unit.hrid] = {\n                    isOutOfMana: false,\n                    startTimeForOutOfMana: 0,\n                    totalTimeForOutOfMana: 0,\n                };\n            }\n\n            if (isOutOfMana) {\n                if (!this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {\n                    this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = true;\n                    this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana = time;\n                }\n            } else if (this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {\n                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = false;\n                this.playerRanOutOfManaTime[unit.hrid].totalTimeForOutOfMana +=\n                    time - this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana;\n            }\n        }\n    }\n\n    class AbilityCastEndEvent extends CombatEvent {\n        static type = 'abilityCastEndEvent';\n\n        constructor(time, source, ability) {\n            super(AbilityCastEndEvent.type, time);\n\n            this.source = source;\n            this.ability = ability;\n        }\n    }\n\n    class AwaitCooldownEvent extends CombatEvent {\n        static type = 'awaitCooldownEvent';\n\n        constructor(time, source) {\n            super(AwaitCooldownEvent.type, time);\n\n            this.source = source;\n        }\n    }\n\n    class Buff {\n        startTime;\n\n        constructor(buff, level = 1) {\n            this.uniqueHrid = buff.uniqueHrid;\n            this.typeHrid = buff.typeHrid;\n            this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;\n            this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;\n            this.duration = buff.duration;\n            this.multiplierForSkillHrid = buff.multiplierForSkillHrid ?? '';\n            this.multiplierPerSkillLevel = buff.multiplierPerSkillLevel ?? 0;\n        }\n    }\n\n    class Trigger {\n        constructor(dependencyHrid, conditionHrid, comparatorHrid, value = 0) {\n            this.dependencyHrid = dependencyHrid;\n            this.conditionHrid = conditionHrid;\n            this.comparatorHrid = comparatorHrid;\n            this.value = value;\n        }\n\n        static createFromDTO(dto) {\n            const trigger = new Trigger(dto.dependencyHrid, dto.conditionHrid, dto.comparatorHrid, dto.value);\n\n            return trigger;\n        }\n\n        isActive(source, target, friendlies, enemies, currentTime) {\n            const combatTriggerDependencyDetailMap = getGameData().combatTriggerDependencyDetailMap;\n            if (combatTriggerDependencyDetailMap[this.dependencyHrid].isSingleTarget) {\n                return this.isActiveSingleTarget(source, target, currentTime);\n            } else {\n                return this.isActiveMultiTarget(friendlies, enemies, currentTime);\n            }\n        }\n\n        isActiveSingleTarget(source, target, currentTime) {\n            let dependencyValue;\n            switch (this.dependencyHrid) {\n                case '/combat_trigger_dependencies/self':\n                    dependencyValue = this.getDependencyValue(source, currentTime);\n                    break;\n                case '/combat_trigger_dependencies/targeted_enemy':\n                    if (!target) {\n                        return false;\n                    }\n                    dependencyValue = this.getDependencyValue(target, currentTime);\n                    break;\n                default:\n                    throw new Error('Unknown dependencyHrid in trigger: ' + this.dependencyHrid);\n            }\n\n            return this.compareValue(dependencyValue);\n        }\n\n        isActiveMultiTarget(friendlies, enemies, currentTime) {\n            let dependency;\n            switch (this.dependencyHrid) {\n                case '/combat_trigger_dependencies/all_allies':\n                    if (!friendlies) {\n                        return false;\n                    }\n                    dependency = friendlies;\n                    break;\n                case '/combat_trigger_dependencies/all_enemies':\n                    if (!enemies) {\n                        return false;\n                    }\n                    dependency = enemies;\n                    break;\n                default:\n                    throw new Error('Unknown dependencyHrid in trigger: ' + this.dependencyHrid);\n            }\n\n            if (!dependency) {\n                return false;\n            }\n\n            let dependencyValue;\n            switch (this.conditionHrid) {\n                case '/combat_trigger_conditions/number_of_active_units':\n                    dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints > 0).length;\n                    break;\n                case '/combat_trigger_conditions/number_of_dead_units':\n                    dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints <= 0).length;\n                    break;\n                case '/combat_trigger_conditions/lowest_hp_percentage':\n                    dependencyValue =\n                        dependency\n                            .filter((unit) => unit.combatDetails.currentHitpoints > 0)\n                            .reduce((prev, curr) => {\n                                const currentHpPercentage =\n                                    curr.combatDetails.currentHitpoints / curr.combatDetails.maxHitpoints;\n                                return currentHpPercentage < prev ? currentHpPercentage : prev;\n                            }, 2) * 100;\n                    break;\n                default:\n                    dependencyValue = dependency\n                        .filter((unit) => unit.combatDetails.currentHitpoints > 0)\n                        .map((unit) => this.getDependencyValue(unit, currentTime))\n                        .reduce((prev, cur) => prev + cur, 0);\n                    break;\n            }\n\n            return this.compareValue(dependencyValue);\n        }\n\n        getDependencyValue(source, currentTime) {\n            switch (this.conditionHrid) {\n                case '/combat_trigger_conditions/berserk':\n                case '/combat_trigger_conditions/frenzy':\n                case '/combat_trigger_conditions/precision':\n                case '/combat_trigger_conditions/vampirism':\n                case '/combat_trigger_conditions/attack_coffee':\n                case '/combat_trigger_conditions/defense_coffee':\n                case '/combat_trigger_conditions/lucky_coffee':\n                case '/combat_trigger_conditions/magic_coffee':\n                case '/combat_trigger_conditions/melee_coffee':\n                case '/combat_trigger_conditions/ranged_coffee':\n                case '/combat_trigger_conditions/swiftness_coffee':\n                case '/combat_trigger_conditions/wisdom_coffee':\n                case '/combat_trigger_conditions/ice_spear':\n                case '/combat_trigger_conditions/puncture':\n                case '/combat_trigger_conditions/frost_surge':\n                case '/combat_trigger_conditions/elusiveness':\n                case '/combat_trigger_conditions/channeling_coffee':\n                case '/combat_trigger_conditions/fierce_aura':\n                case '/combat_trigger_conditions/invincible_armor':\n                case '/combat_trigger_conditions/invincible_fire_resistance':\n                case '/combat_trigger_conditions/invincible_nature_resistance':\n                case '/combat_trigger_conditions/invincible_water_resistance':\n                case '/combat_trigger_conditions/provoke':\n                case '/combat_trigger_conditions/taunt':\n                case '/combat_trigger_conditions/crippling_slash':\n                case '/combat_trigger_conditions/mana_spring':\n                case '/combat_trigger_conditions/retribution':\n                case '/combat_trigger_conditions/fracturing_impact':\n                case '/combat_trigger_conditions/maim':\n                case '/combat_trigger_conditions/curse':\n                case '/combat_trigger_conditions/weaken': {\n                    const buffHrid = '/buff_uniques' + this.conditionHrid.slice(this.conditionHrid.lastIndexOf('/'));\n                    return source.combatBuffs[buffHrid];\n                }\n                case '/combat_trigger_conditions/critical_aura':\n                case '/combat_trigger_conditions/critical_coffee':\n                case '/combat_trigger_conditions/intelligence_coffee':\n                case '/combat_trigger_conditions/stamina_coffee':\n                case '/combat_trigger_conditions/elemental_affinity':\n                case '/combat_trigger_conditions/fury':\n                case '/combat_trigger_conditions/guardian_aura':\n                case '/combat_trigger_conditions/insanity':\n                case '/combat_trigger_conditions/spike_shell':\n                case '/combat_trigger_conditions/toxic_pollen':\n                case '/combat_trigger_conditions/invincible':\n                case '/combat_trigger_conditions/mystic_aura':\n                case '/combat_trigger_conditions/pestilent_shot':\n                case '/combat_trigger_conditions/smoke_burst':\n                case '/combat_trigger_conditions/speed_aura':\n                case '/combat_trigger_conditions/toughness':\n                case '/combat_trigger_conditions/enrage': {\n                    const buffPrefix = '/buff_uniques' + this.conditionHrid.slice(this.conditionHrid.lastIndexOf('/'));\n                    const buffs = Object.keys(source.combatBuffs).filter((buff) => buff.startsWith(buffPrefix));\n                    return source.combatBuffs[buffs?.[0]];\n                }\n                case '/combat_trigger_conditions/current_hp':\n                    return source.combatDetails.currentHitpoints;\n                case '/combat_trigger_conditions/current_mp':\n                    return source.combatDetails.currentManapoints;\n                case '/combat_trigger_conditions/missing_hp':\n                    return source.combatDetails.maxHitpoints - source.combatDetails.currentHitpoints;\n                case '/combat_trigger_conditions/missing_mp':\n                    return source.combatDetails.maxManapoints - source.combatDetails.currentManapoints;\n                case '/combat_trigger_conditions/stun_status':\n                    // Replicate the game's behaviour of \"stun status active\" triggers activating\n                    // immediately after the stun has worn off\n                    return source.isStunned || source.stunExpireTime === currentTime;\n                case '/combat_trigger_conditions/blind_status':\n                    return source.isBlinded || source.blindExpireTime === currentTime;\n                case '/combat_trigger_conditions/silence_status':\n                    return source.isSilenced || source.silenceExpireTime === currentTime;\n                default:\n                    throw new Error('Unknown conditionHrid in trigger: ' + this.conditionHrid);\n            }\n        }\n\n        compareValue(dependencyValue) {\n            switch (this.comparatorHrid) {\n                case '/combat_trigger_comparators/greater_than_equal':\n                    return dependencyValue >= this.value;\n                case '/combat_trigger_comparators/less_than_equal':\n                    return dependencyValue <= this.value;\n                case '/combat_trigger_comparators/is_active':\n                    return !!dependencyValue;\n                case '/combat_trigger_comparators/is_inactive':\n                    return !dependencyValue;\n                default:\n                    throw new Error('Unknown comparatorHrid in trigger: ' + this.comparatorHrid);\n            }\n        }\n    }\n\n    const abilityFromCombatStat = {\n        blaze: {\n            hrid: '/abilities/blaze',\n            name: 'Blaze',\n            description: '',\n            isSpecialAbility: false,\n            manaCost: 0,\n            cooldownDuration: 0,\n            castDuration: 0,\n            abilityEffects: [\n                {\n                    targetType: 'allEnemies',\n                    effectType: '/ability_effect_types/damage',\n                    combatStyleHrid: '/combat_styles/magic',\n                    damageType: '/damage_types/fire',\n                    baseDamageFlat: 0,\n                    baseDamageFlatLevelBonus: 0.0,\n                    baseDamageRatio: 0.3,\n                    baseDamageRatioLevelBonus: 0,\n                    bonusAccuracyRatio: 0,\n                    bonusAccuracyRatioLevelBonus: 0,\n                    damageOverTimeRatio: 0,\n                    damageOverTimeDuration: 0,\n                    armorDamageRatio: 0,\n                    armorDamageRatioLevelBonus: 0,\n                    hpDrainRatio: 0,\n                    pierceChance: 0,\n                    blindChance: 0,\n                    blindDuration: 0,\n                    silenceChance: 0,\n                    silenceDuration: 0,\n                    stunChance: 0,\n                    stunDuration: 0,\n                    spendHpRatio: 0,\n                    buffs: null,\n                },\n            ],\n            defaultCombatTriggers: [\n                {\n                    dependencyHrid: '/combat_trigger_dependencies/all_enemies',\n                    conditionHrid: '/combat_trigger_conditions/number_of_active_units',\n                    comparatorHrid: '/combat_trigger_comparators/greater_than_equal',\n                    value: 1,\n                },\n                {\n                    dependencyHrid: '/combat_trigger_dependencies/all_enemies',\n                    conditionHrid: '/combat_trigger_conditions/current_hp',\n                    comparatorHrid: '/combat_trigger_comparators/greater_than_equal',\n                    value: 1,\n                },\n            ],\n        },\n        bloom: {\n            hrid: '/abilities/bloom',\n            name: 'Bloom',\n            description: '',\n            isSpecialAbility: false,\n            manaCost: 0,\n            cooldownDuration: 0,\n            castDuration: 0,\n            abilityEffects: [\n                {\n                    targetType: 'lowestHpAlly',\n                    effectType: '/ability_effect_types/heal',\n                    combatStyleHrid: '/combat_styles/magic',\n                    damageType: '',\n                    baseDamageFlat: 10,\n                    baseDamageFlatLevelBonus: 0,\n                    baseDamageRatio: 0.15,\n                    baseDamageRatioLevelBonus: 0,\n                    bonusAccuracyRatio: 0,\n                    bonusAccuracyRatioLevelBonus: 0,\n                    damageOverTimeRatio: 0,\n                    damageOverTimeDuration: 0,\n                    armorDamageRatio: 0,\n                    armorDamageRatioLevelBonus: 0,\n                    hpDrainRatio: 0,\n                    pierceChance: 0,\n                    blindChance: 0,\n                    blindDuration: 0,\n                    silenceChance: 0,\n                    silenceDuration: 0,\n                    stunChance: 0,\n                    stunDuration: 0,\n                    spendHpRatio: 0,\n                    buffs: null,\n                },\n            ],\n            defaultCombatTriggers: [\n                {\n                    dependencyHrid: '/combat_trigger_dependencies/all_allies',\n                    conditionHrid: '/combat_trigger_conditions/lowest_hp_percentage',\n                    comparatorHrid: '/combat_trigger_comparators/less_than_equal',\n                    value: 100,\n                },\n            ],\n        },\n    };\n\n    class Ability {\n        constructor(hrid, level = 1, triggers = null) {\n            this.hrid = hrid;\n            this.level = level;\n\n            const abilityDetailMap = getGameData().abilityDetailMap;\n            let gameAbility = abilityDetailMap[hrid];\n            if (!gameAbility) {\n                gameAbility = abilityFromCombatStat[hrid];\n            }\n            if (!gameAbility) {\n                throw new Error('No ability found for hrid: ' + this.hrid);\n            }\n\n            this.manaCost = gameAbility.manaCost;\n            this.cooldownDuration = gameAbility.cooldownDuration;\n            this.castDuration = gameAbility.castDuration;\n            this.isSpecialAbility = gameAbility.isSpecialAbility;\n\n            this.abilityEffects = [];\n\n            for (const effect of gameAbility.abilityEffects) {\n                const abilityEffect = {\n                    targetType: effect.targetType,\n                    effectType: effect.effectType,\n                    combatStyleHrid: effect.combatStyleHrid,\n                    damageType: effect.damageType,\n                    damageFlat: effect.baseDamageFlat + (this.level - 1) * effect.baseDamageFlatLevelBonus,\n                    damageRatio: effect.baseDamageRatio + (this.level - 1) * effect.baseDamageRatioLevelBonus,\n                    bonusAccuracyRatio: effect.bonusAccuracyRatio + (this.level - 1) * effect.bonusAccuracyRatioLevelBonus,\n                    damageOverTimeRatio: effect.damageOverTimeRatio,\n                    damageOverTimeDuration: effect.damageOverTimeDuration,\n                    armorDamageRatio: effect.armorDamageRatio + (this.level - 1) * effect.armorDamageRatioLevelBonus,\n                    hpDrainRatio: effect.hpDrainRatio,\n                    pierceChance: effect.pierceChance,\n                    blindChance: effect.blindChance,\n                    blindDuration: effect.blindDuration,\n                    silenceChance: effect.silenceChance,\n                    silenceDuration: effect.silenceDuration,\n                    stunChance: effect.stunChance,\n                    stunDuration: effect.stunDuration,\n                    spendHpRatio: effect.spendHpRatio,\n                    buffs: null,\n                };\n                if (effect.buffs) {\n                    abilityEffect.buffs = [];\n                    for (const buff of effect.buffs) {\n                        abilityEffect.buffs.push(new Buff(buff, this.level));\n                    }\n                }\n                this.abilityEffects.push(abilityEffect);\n            }\n\n            if (triggers) {\n                this.triggers = triggers;\n            } else {\n                this.triggers = [];\n                for (const defaultTrigger of gameAbility.defaultCombatTriggers) {\n                    const trigger = new Trigger(\n                        defaultTrigger.dependencyHrid,\n                        defaultTrigger.conditionHrid,\n                        defaultTrigger.comparatorHrid,\n                        defaultTrigger.value\n                    );\n                    this.triggers.push(trigger);\n                }\n            }\n\n            this.lastUsed = Number.MIN_SAFE_INTEGER;\n        }\n\n        static createFromDTO(dto) {\n            const triggers = dto.triggers ? dto.triggers.map((trigger) => Trigger.createFromDTO(trigger)) : null;\n            const ability = new Ability(dto.hrid, dto.level, triggers);\n\n            return ability;\n        }\n\n        shouldTrigger(currentTime, source, target, friendlies, enemies) {\n            if (source.isStunned) {\n                return false;\n            }\n\n            if (source.isSilenced) {\n                return false;\n            }\n\n            const haste = source.combatDetails.combatStats.abilityHaste;\n            let cooldownDuration = this.cooldownDuration;\n            if (haste > 0) {\n                cooldownDuration = (cooldownDuration * 100) / (100 + haste);\n            }\n\n            if (this.lastUsed + cooldownDuration > currentTime) {\n                return false;\n            }\n\n            if (this.triggers.length === 0) {\n                return true;\n            }\n\n            let shouldTrigger = true;\n            for (const trigger of this.triggers) {\n                if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {\n                    shouldTrigger = false;\n                }\n            }\n\n            return shouldTrigger;\n        }\n    }\n\n    class CombatUnit {\n        isPlayer;\n        isStunned = false;\n        stunExpireTime = null;\n        isBlinded = false;\n        blindExpireTime = null;\n        isSilenced = false;\n        silenceExpireTime = null;\n\n        isOutOfMana = false;\n\n        // Base levels which don't change after initialization\n        staminaLevel = 1;\n        intelligenceLevel = 1;\n        attackLevel = 1;\n        meleeLevel = 1;\n        defenseLevel = 1;\n        rangedLevel = 1;\n        magicLevel = 1;\n\n        experience = 0;\n        experienceRate = 0;\n        enrageTime = 0;\n\n        abilities = [null, null, null, null];\n        food = [null, null, null];\n        drinks = [null, null, null];\n        houseRooms = [];\n        shrines = [];\n        achievements = null;\n        dropTable = [];\n        rareDropTable = [];\n        abilityManaCosts = new Map();\n\n        // Calculated combat stats including temporary buffs\n        combatDetails = {\n            staminaLevel: 1,\n            intelligenceLevel: 1,\n            attackLevel: 1,\n            meleeLevel: 1,\n            defenseLevel: 1,\n            rangedLevel: 1,\n            magicLevel: 1,\n            maxHitpoints: 110,\n            currentHitpoints: 110,\n            maxManapoints: 110,\n            currentManapoints: 110,\n            stabAccuracyRating: 11,\n            slashAccuracyRating: 11,\n            smashAccuracyRating: 11,\n            rangedAccuracyRating: 11,\n            magicAccuracyRating: 11,\n            stabMaxDamage: 11,\n            slashMaxDamage: 11,\n            smashMaxDamage: 11,\n            rangedMaxDamage: 11,\n            magicMaxDamage: 11,\n            stabEvasionRating: 11,\n            slashEvasionRating: 11,\n            smashEvasionRating: 11,\n            rangedEvasionRating: 11,\n            magicEvasionRating: 11,\n            defensiveMaxDamage: 0,\n            totalArmor: 0.2,\n            totalWaterResistance: 0.4,\n            totalNatureResistance: 0.4,\n            totalFireResistance: 0.4,\n            abilityHaste: 0,\n            tenacity: 0,\n            totalThreat: 100,\n            combatStats: {\n                combatStyleHrid: '/combat_styles/smash',\n                damageType: '/damage_types/physical',\n                attackInterval: 3000000000,\n                autoAttackDamage: 0,\n                abilityDamage: 0,\n                criticalRate: 0,\n                criticalDamage: 0,\n                stabAccuracy: 0,\n                slashAccuracy: 0,\n                smashAccuracy: 0,\n                rangedAccuracy: 0,\n                magicAccuracy: 0,\n                stabDamage: 0,\n                slashDamage: 0,\n                smashDamage: 0,\n                rangedDamage: 0,\n                magicDamage: 0,\n                defensiveDamage: 0,\n                taskDamage: 0,\n                physicalAmplify: 0,\n                waterAmplify: 0,\n                natureAmplify: 0,\n                fireAmplify: 0,\n                healingAmplify: 0,\n                physicalThorns: 0,\n                elementalThorns: 0,\n                maxHitpoints: 0,\n                maxManapoints: 0,\n                stabEvasion: 0,\n                slashEvasion: 0,\n                smashEvasion: 0,\n                rangedEvasion: 0,\n                magicEvasion: 0,\n                armor: 0,\n                waterResistance: 0,\n                natureResistance: 0,\n                fireResistance: 0,\n                lifeSteal: 0,\n                hpRegenPer10: 0.01,\n                mpRegenPer10: 0.01,\n                combatDropRate: 0,\n                combatDropQuantity: 0,\n                combatRareFind: 0,\n                combatExperience: 0,\n                maxHitpointsRatio: 0,\n                maxManapointsRatio: 0,\n                foodSlots: 1,\n                drinkSlots: 1,\n                armorPenetration: 0,\n                waterPenetration: 0,\n                naturePenetration: 0,\n                firePenetration: 0,\n                manaLeech: 0,\n                castSpeed: 0,\n                threat: 100,\n                parry: 0,\n                mayhem: 0,\n                pierce: 0,\n                curse: 0,\n                ripple: 0,\n                bloom: 0,\n                blaze: 0,\n                weaken: 0,\n                fury: 0,\n                foodHaste: 0,\n                drinkConcentration: 0,\n                damageTaken: 0,\n                attackSpeed: 0,\n                armorDamageRatio: 0,\n                hpDrainRatio: 0,\n                primaryTraining: '',\n                focusTraining: '',\n                staminaExperience: 0,\n                intelligenceExperience: 0,\n                attackExperience: 0,\n                defenseExperience: 0,\n                meleeExperience: 0,\n                rangedExperience: 0,\n                magicExperience: 0,\n                retaliation: 0,\n            },\n        };\n        combatBuffs = {};\n        permanentBuffs = {};\n        zoneBuffs = {};\n        extraBuffs = {};\n        furyAmount = 0;\n        furyExpireTime = 0;\n        // Per-source registry for the official party Aura family only (CSIM-AUD-001):\n        // { [buffUniqueHrid]: { [casterHrid]: buffClone } }. Ordinary buffs never use this.\n        auraSources = {};\n\n        constructor() {}\n\n        updateCombatDetails() {\n            if (this.isPlayer) {\n                if (this.combatDetails.combatStats.hpRegenPer10 === 0) {\n                    this.combatDetails.combatStats.hpRegenPer10 = 0.01;\n                } else {\n                    this.combatDetails.combatStats.hpRegenPer10 = 0.01 + this.combatDetails.combatStats.hpRegenPer10;\n                }\n                if (this.combatDetails.combatStats.mpRegenPer10 === 0) {\n                    this.combatDetails.combatStats.mpRegenPer10 = 0.01;\n                } else {\n                    this.combatDetails.combatStats.mpRegenPer10 = 0.01 + this.combatDetails.combatStats.mpRegenPer10;\n                }\n            }\n\n            ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].forEach((stat) => {\n                this.combatDetails[stat + 'Level'] = this[stat + 'Level'];\n                const boosts = this.getBuffBoosts('/buff_types/' + stat + '_level');\n                boosts.forEach((buff) => {\n                    this.combatDetails[stat + 'Level'] += this[stat + 'Level'] * buff.ratioBoost;\n                    this.combatDetails[stat + 'Level'] += buff.flatBoost;\n                });\n            });\n\n            const maxHitpointsBoost = this.getBuffBoost('/buff_types/max_hitpoints');\n            const maxManapointsBoost = this.getBuffBoost('/buff_types/max_manapoints');\n            this.combatDetails.maxHitpoints = Math.floor(\n                (10 * (10 + this.combatDetails.staminaLevel) +\n                    this.combatDetails.combatStats.maxHitpoints +\n                    maxHitpointsBoost.flatBoost) *\n                    (1 + this.combatDetails.combatStats.maxHitpointsRatio + maxHitpointsBoost.ratioBoost)\n            );\n            this.combatDetails.maxManapoints = Math.floor(\n                (10 * (10 + this.combatDetails.intelligenceLevel) +\n                    this.combatDetails.combatStats.maxManapoints +\n                    maxManapointsBoost.flatBoost) *\n                    (1 + this.combatDetails.combatStats.maxManapointsRatio + maxManapointsBoost.ratioBoost)\n            );\n\n            const accuracyRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_accuracy').ratioBoost;\n            const damageRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_damage').ratioBoost;\n\n            const accuracyRatioBoost = this.getBuffBoost('/buff_types/accuracy').ratioBoost;\n            const damageRatioBoost = this.getBuffBoost('/buff_types/damage').ratioBoost;\n\n            ['stab', 'slash', 'smash'].forEach((style) => {\n                this.combatDetails[style + 'AccuracyRating'] =\n                    (10 + this.combatDetails.attackLevel) *\n                    (1 + this.combatDetails.combatStats[style + 'Accuracy']) *\n                    (1 + accuracyRatioBoost) *\n                    (1 + accuracyRatioBoostFromFury);\n                this.combatDetails[style + 'MaxDamage'] =\n                    (10 + this.combatDetails.meleeLevel) *\n                    (1 + this.combatDetails.combatStats[style + 'Damage']) *\n                    (1 + damageRatioBoost) *\n                    (1 + damageRatioBoostFromFury);\n                const baseEvasion =\n                    (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + 'Evasion']);\n                this.combatDetails[style + 'EvasionRating'] = baseEvasion;\n                const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');\n                for (const boost of evasionBoosts) {\n                    this.combatDetails[style + 'EvasionRating'] += boost.flatBoost;\n                    this.combatDetails[style + 'EvasionRating'] += baseEvasion * boost.ratioBoost;\n                }\n            });\n\n            this.combatDetails.defensiveMaxDamage =\n                (10 + this.combatDetails.defenseLevel) *\n                (1 + this.combatDetails.combatStats.defensiveDamage) *\n                (1 + damageRatioBoost) *\n                (1 + damageRatioBoostFromFury);\n\n            // when equiped bulwark\n            if (this.equipment?.['/equipment_types/two_hand']?.hrid.includes('bulwark')) {\n                this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;\n            }\n\n            this.combatDetails.rangedAccuracyRating =\n                (10 + this.combatDetails.attackLevel) *\n                (1 + this.combatDetails.combatStats.rangedAccuracy) *\n                (1 + accuracyRatioBoost) *\n                (1 + accuracyRatioBoostFromFury);\n            this.combatDetails.rangedMaxDamage =\n                (10 + this.combatDetails.rangedLevel) *\n                (1 + this.combatDetails.combatStats.rangedDamage) *\n                (1 + damageRatioBoost) *\n                (1 + damageRatioBoostFromFury);\n\n            const baseRangedEvasion =\n                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);\n            this.combatDetails.rangedEvasionRating = baseRangedEvasion;\n            const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');\n            for (const boost of evasionBoosts) {\n                this.combatDetails.rangedEvasionRating += boost.flatBoost;\n                this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;\n            }\n\n            this.combatDetails.combatStats.damageTaken = this.getBuffBoost('/buff_types/damage_taken').flatBoost;\n\n            this.combatDetails.magicAccuracyRating =\n                (10 + this.combatDetails.attackLevel) *\n                (1 + this.combatDetails.combatStats.magicAccuracy) *\n                (1 + accuracyRatioBoost) *\n                (1 + accuracyRatioBoostFromFury);\n            this.combatDetails.magicMaxDamage =\n                (10 + this.combatDetails.magicLevel) *\n                (1 + this.combatDetails.combatStats.magicDamage) *\n                (1 + damageRatioBoost) *\n                (1 + damageRatioBoostFromFury);\n\n            const baseMagicEvasion =\n                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);\n            this.combatDetails.magicEvasionRating = baseMagicEvasion;\n            for (const boost of evasionBoosts) {\n                this.combatDetails.magicEvasionRating += boost.flatBoost;\n                this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;\n            }\n\n            this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost('/buff_types/physical_amplify').flatBoost;\n            this.combatDetails.combatStats.waterAmplify += this.getBuffBoost('/buff_types/water_amplify').flatBoost;\n            this.combatDetails.combatStats.natureAmplify += this.getBuffBoost('/buff_types/nature_amplify').flatBoost;\n            this.combatDetails.combatStats.fireAmplify += this.getBuffBoost('/buff_types/fire_amplify').flatBoost;\n            this.combatDetails.combatStats.healingAmplify += this.getBuffBoost('/buff_types/healing_amplify').flatBoost;\n\n            this.combatDetails.combatStats.attackInterval /= 1 + this.combatDetails.attackLevel / 2000;\n\n            const baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;\n            this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;\n            const attackIntervalBoosts = this.getBuffBoosts('/buff_types/attack_speed');\n            const attackIntervalRatioBoost = attackIntervalBoosts\n                .map((boost) => boost.ratioBoost)\n                .reduce((prev, cur) => prev + cur, 0);\n            this.combatDetails.combatStats.attackInterval /= 1 + attackIntervalRatioBoost;\n\n            const baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;\n            this.combatDetails.totalArmor = baseArmor;\n            const armorBoosts = this.getBuffBoosts('/buff_types/armor');\n            for (const boost of armorBoosts) {\n                this.combatDetails.totalArmor += boost.flatBoost;\n                this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;\n            }\n\n            const baseWaterResistance =\n                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.waterResistance;\n            this.combatDetails.totalWaterResistance = baseWaterResistance;\n            const waterResistanceBoosts = this.getBuffBoosts('/buff_types/water_resistance');\n            for (const boost of waterResistanceBoosts) {\n                this.combatDetails.totalWaterResistance += boost.flatBoost;\n                this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;\n            }\n\n            const baseNatureResistance =\n                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.natureResistance;\n            this.combatDetails.totalNatureResistance = baseNatureResistance;\n            const natureResistanceBoosts = this.getBuffBoosts('/buff_types/nature_resistance');\n            for (const boost of natureResistanceBoosts) {\n                this.combatDetails.totalNatureResistance += boost.flatBoost;\n                this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;\n            }\n\n            const baseFireResistance =\n                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.fireResistance;\n            this.combatDetails.totalFireResistance = baseFireResistance;\n            const fireResistanceBoosts = this.getBuffBoosts('/buff_types/fire_resistance');\n            for (const boost of fireResistanceBoosts) {\n                this.combatDetails.totalFireResistance += boost.flatBoost;\n                this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;\n            }\n\n            const hpRegenBoosts = this.getBuffBoost('/buff_types/hp_regen');\n            this.combatDetails.combatStats.hpRegenPer10 +=\n                this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;\n            this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;\n\n            const mpRegenBoosts = this.getBuffBoost('/buff_types/mp_regen');\n            this.combatDetails.combatStats.mpRegenPer10 +=\n                this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;\n            this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;\n\n            this.combatDetails.combatStats.lifeSteal += this.getBuffBoost('/buff_types/life_steal').flatBoost;\n            this.combatDetails.combatStats.physicalThorns += this.getBuffBoost('/buff_types/physical_thorns').flatBoost;\n            this.combatDetails.combatStats.elementalThorns += this.getBuffBoost('/buff_types/elemental_thorns').flatBoost;\n            this.combatDetails.combatStats.combatExperience += this.getBuffBoost('/buff_types/wisdom').flatBoost;\n            this.combatDetails.combatStats.criticalRate += this.getBuffBoost('/buff_types/critical_rate').flatBoost;\n            this.combatDetails.combatStats.criticalDamage += this.getBuffBoost('/buff_types/critical_damage').flatBoost;\n\n            this.combatDetails.combatStats.castSpeed += this.getBuffBoost('/buff_types/cast_speed').flatBoost;\n            this.combatDetails.combatStats.castSpeed += this.combatDetails['attackLevel'] / 2000;\n\n            const combatDropRateBoosts = this.getBuffBoost('/buff_types/combat_drop_rate');\n            this.combatDetails.combatStats.combatDropRate +=\n                (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;\n            this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;\n            const combatRareFindBoosts = this.getBuffBoost('/buff_types/rare_find');\n            this.combatDetails.combatStats.combatRareFind +=\n                (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;\n            this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;\n            const combatDropQuantityBoosts = this.getBuffBoost('/buff_types/combat_drop_quantity');\n            this.combatDetails.combatStats.combatDropQuantity +=\n                (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;\n            this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;\n\n            const baseThreat = 100 + this.combatDetails.combatStats.threat;\n            const threatBoosts = this.getBuffBoost('/buff_types/threat');\n            const effectiveThreat = baseThreat * (1 + threatBoosts.ratioBoost) + threatBoosts.flatBoost;\n            this.combatDetails.totalThreat = effectiveThreat;\n            this.combatDetails.combatStats.threat = effectiveThreat;\n\n            this.combatDetails.combatStats.retaliation += this.getBuffBoost('/buff_types/retaliation').flatBoost;\n            this.combatDetails.combatStats.tenacity += this.getBuffBoost('/buff_types/tenacity').flatBoost;\n        }\n\n        addBuff(buff, currentTime) {\n            const ownedBuff = { ...buff, startTime: currentTime };\n            this.combatBuffs[ownedBuff.uniqueHrid] = ownedBuff;\n\n            this.updateCombatDetails();\n        }\n\n        /**\n         * Official party Aura family only (CSIM-AUD-001): strongest-source-wins with automatic\n         * fallback to the next-strongest still-active source when the winning source expires.\n         * Ordinary buffs must keep using addBuff()'s last-write-wins semantics.\n         * @param {Object} buff\n         * @param {string} sourceHrid - hrid of the casting unit\n         * @param {number} currentTime\n         */\n        addAuraBuff(buff, sourceHrid, currentTime) {\n            if (!this.auraSources[buff.uniqueHrid]) {\n                this.auraSources[buff.uniqueHrid] = {};\n            }\n            this.auraSources[buff.uniqueHrid][sourceHrid] = { ...buff, startTime: currentTime };\n            this._recomputeAuraBuff(buff.uniqueHrid);\n\n            this.updateCombatDetails();\n        }\n\n        /** @private */\n        _recomputeAuraBuff(uniqueHrid) {\n            const sources = Object.values(this.auraSources[uniqueHrid] || {});\n            if (sources.length === 0) {\n                delete this.combatBuffs[uniqueHrid];\n                return;\n            }\n            const strongest = sources.reduce((best, candidate) =>\n                candidate.ratioBoost + candidate.flatBoost > best.ratioBoost + best.flatBoost ? candidate : best\n            );\n            this.combatBuffs[uniqueHrid] = strongest;\n        }\n\n        removeBuff(buff) {\n            if (!this.combatBuffs[buff.uniqueHrid]) {\n                return;\n            }\n            delete this.combatBuffs[buff.uniqueHrid];\n\n            this.updateCombatDetails();\n        }\n\n        /**\n         * Update fury accuracy and damage buffs in a single batch, calling updateCombatDetails() once.\n         * @param {number} furyAmount - Current fury stack count (0-5)\n         * @param {number} furyStat - Fury combat stat value\n         * @param {number} currentTime - Simulation time for buff start\n         * @param {number} duration - Buff duration (fury expire time)\n         */\n        updateFuryBuffs(furyAmount, furyStat, currentTime, duration) {\n            if (furyAmount > 0) {\n                this.combatBuffs['/buff_uniques/fury_accuracy'] = {\n                    uniqueHrid: '/buff_uniques/fury_accuracy',\n                    typeHrid: '/buff_types/fury_accuracy',\n                    ratioBoost: furyAmount * furyStat,\n                    ratioBoostLevelBonus: 0,\n                    flatBoost: 0,\n                    flatBoostLevelBonus: 0,\n                    startTime: currentTime,\n                    duration: duration,\n                };\n                this.combatBuffs['/buff_uniques/fury_damage'] = {\n                    uniqueHrid: '/buff_uniques/fury_damage',\n                    typeHrid: '/buff_types/fury_damage',\n                    ratioBoost: furyAmount * furyStat,\n                    ratioBoostLevelBonus: 0,\n                    flatBoost: 0,\n                    flatBoostLevelBonus: 0,\n                    startTime: currentTime,\n                    duration: duration,\n                };\n            } else {\n                delete this.combatBuffs['/buff_uniques/fury_accuracy'];\n                delete this.combatBuffs['/buff_uniques/fury_damage'];\n            }\n            this.updateCombatDetails();\n        }\n\n        addPermanentBuff(buff) {\n            if (this.permanentBuffs[buff.typeHrid]) {\n                this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;\n                this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;\n            } else {\n                this.permanentBuffs[buff.typeHrid] = { ...buff };\n            }\n        }\n\n        generatePermanentBuffs() {\n            for (let i = 0; i < this.houseRooms.length; i++) {\n                const houseRoom = this.houseRooms[i];\n                houseRoom.buffs.forEach((buff) => {\n                    this.addPermanentBuff(buff);\n                });\n            }\n            for (let i = 0; i < this.shrines.length; i++) {\n                const shrine = this.shrines[i];\n                shrine.buffs.forEach((buff) => {\n                    this.addPermanentBuff(buff);\n                });\n            }\n            if (this.zoneBuffs) {\n                this.zoneBuffs.forEach((buff) => {\n                    this.addPermanentBuff(buff);\n                });\n            }\n            if (this.extraBuffs) {\n                this.extraBuffs.forEach((buff) => {\n                    this.addPermanentBuff(buff);\n                });\n            }\n            if (this.achievements) {\n                this.achievements.buffs.forEach((buff) => {\n                    this.addPermanentBuff(buff);\n                });\n            }\n        }\n\n        removeExpiredBuffs(currentTime) {\n            const expiredBuffs = Object.values(this.combatBuffs).filter(\n                (buff) => buff.startTime + buff.duration <= currentTime\n            );\n            expiredBuffs.forEach((buff) => {\n                delete this.combatBuffs[buff.uniqueHrid];\n            });\n\n            // Aura sources are tracked per-caster so the effective buff can fall back to the\n            // next-strongest still-active source instead of just disappearing when only the\n            // strongest source's contribution expires.\n            Object.keys(this.auraSources).forEach((uniqueHrid) => {\n                const sources = this.auraSources[uniqueHrid];\n                let changed = false;\n                Object.keys(sources).forEach((sourceHrid) => {\n                    const buff = sources[sourceHrid];\n                    if (buff.startTime + buff.duration <= currentTime) {\n                        delete sources[sourceHrid];\n                        changed = true;\n                    }\n                });\n                if (changed) {\n                    this._recomputeAuraBuff(uniqueHrid);\n                }\n            });\n\n            this.updateCombatDetails();\n        }\n\n        clearBuffs() {\n            this.combatBuffs = structuredClone(this.permanentBuffs);\n            this.auraSources = {};\n            this.furyAmount = 0;\n            this.furyExpireTime = 0;\n            this.updateCombatDetails();\n        }\n\n        clearCCs() {\n            this.isStunned = false;\n            this.stunExpireTime = null;\n            this.isSilenced = false;\n            this.silenceExpireTime = null;\n            this.isBlinded = false;\n            this.blindExpireTime = null;\n            this.combatDetails.combatStats.damageTaken = 0;\n        }\n\n        getBuffBoosts(type) {\n            const boosts = [];\n            Object.values(this.combatBuffs)\n                .filter((buff) => buff.typeHrid === type)\n                .forEach((buff) => {\n                    boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });\n                });\n\n            return boosts;\n        }\n\n        getBuffBoost(type) {\n            const boosts = this.getBuffBoosts(type);\n\n            const boost = {\n                ratioBoost: 0,\n                flatBoost: 0,\n            };\n\n            for (let i = 0; i < boosts.length; i++) {\n                boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;\n                boost.flatBoost += boosts[i]?.flatBoost ?? 0;\n            }\n\n            return boost;\n        }\n\n        reset(currentTime = 0) {\n            this.clearCCs();\n\n            if (currentTime === 0 || !this.isPlayer) {\n                // First combat start or enemy reset: full reset\n                this.clearBuffs();\n                this.resetCooldowns(currentTime);\n            } else {\n                // Dungeon wipe restart (players only): remove expired buffs, keep cooldowns\n                this.removeExpiredBuffs(currentTime);\n            }\n\n            this.updateCombatDetails();\n            this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;\n            this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;\n        }\n\n        resetCooldowns(currentTime = 0) {\n            this.food.filter((food) => food !== null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));\n            this.drinks.filter((drink) => drink !== null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));\n\n            const haste = this.combatDetails.combatStats.abilityHaste;\n\n            this.abilities\n                .filter((ability) => ability !== null)\n                .forEach((ability) => {\n                    if (this.isPlayer) {\n                        ability.lastUsed = Number.MIN_SAFE_INTEGER;\n                    } else {\n                        let cooldownDuration = ability.cooldownDuration;\n                        if (haste > 0) {\n                            cooldownDuration = (cooldownDuration * 100) / (100 + haste);\n                        }\n                        // Labyrinth monsters (roomLevel > 0) always start at exactly half their cooldown;\n                        // zone monsters start at a random point between half and full.\n                        const randomOffset = this.roomLevel > 0 ? 0 : Math.floor(Math.random() * cooldownDuration * 0.5);\n                        ability.lastUsed = currentTime - Math.floor(cooldownDuration * 0.5) + randomOffset;\n                    }\n                });\n        }\n\n        addHitpoints(hitpoints) {\n            let hitpointsAdded = 0;\n\n            if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {\n                return hitpointsAdded;\n            }\n\n            const newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);\n            hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;\n            this.combatDetails.currentHitpoints = newHitpoints;\n\n            return hitpointsAdded;\n        }\n\n        addManapoints(manapoints) {\n            let manapointsAdded = 0;\n\n            if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {\n                return manapointsAdded;\n            }\n\n            const newManapoints = Math.min(\n                this.combatDetails.currentManapoints + manapoints,\n                this.combatDetails.maxManapoints\n            );\n            manapointsAdded = newManapoints - this.combatDetails.currentManapoints;\n            this.combatDetails.currentManapoints = newManapoints;\n\n            return manapointsAdded;\n        }\n    }\n\n    class Drops {\n        constructor(itemHrid, dropRate, minCount, maxCount, difficultyTier) {\n            this.itemHrid = itemHrid;\n            this.dropRate = dropRate;\n            this.minCount = minCount;\n            this.maxCount = maxCount;\n            this.difficultyTier = difficultyTier;\n        }\n    }\n\n    const LABYRINTH_BASE_ROOM_LEVEL = 100;\n\n    class Monster extends CombatUnit {\n        difficultyTier = 0;\n        roomLevel = 0;\n\n        constructor(hrid, difficultyTier = 0, roomLevel = 0) {\n            super();\n\n            this.isPlayer = false;\n            this.hrid = hrid;\n            this.difficultyTier = difficultyTier;\n            this.roomLevel = roomLevel;\n\n            const combatMonsterDetailMap = getGameData().combatMonsterDetailMap;\n            const gameMonster = combatMonsterDetailMap[this.hrid];\n            if (!gameMonster) {\n                throw new Error('No monster found for hrid: ' + this.hrid);\n            }\n\n            this.enrageTime = gameMonster.enrageTime;\n\n            // Labyrinth scaling: ability levels scale by roomLevel / 100\n            const labyrinthScaleFactor = this.roomLevel > 0 ? this.roomLevel / LABYRINTH_BASE_ROOM_LEVEL : 1;\n\n            for (let i = 0; i < gameMonster.abilities.length; i++) {\n                if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {\n                    continue;\n                }\n                const baseLevel = gameMonster.abilities[i].level;\n                const scaledLevel = this.roomLevel > 0 ? Math.floor(baseLevel * labyrinthScaleFactor) : baseLevel;\n                this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, scaledLevel);\n            }\n            if (gameMonster.dropTable) {\n                for (let i = 0; i < gameMonster.dropTable.length; i++) {\n                    this.dropTable[i] = new Drops(\n                        gameMonster.dropTable[i].itemHrid,\n                        gameMonster.dropTable[i].dropRate,\n                        gameMonster.dropTable[i].minCount,\n                        gameMonster.dropTable[i].maxCount,\n                        gameMonster.dropTable[i].difficultyTier\n                    );\n                }\n            }\n            for (let i = 0; i < gameMonster.rareDropTable.length; i++) {\n                const dropTableItem =\n                    gameMonster.dropTable && i < gameMonster.dropTable.length ? gameMonster.dropTable[i] : null;\n                const difficultyTier = dropTableItem?.difficultyTier ?? gameMonster.rareDropTable[i].minDifficultyTier;\n\n                this.rareDropTable[i] = new Drops(\n                    gameMonster.rareDropTable[i].itemHrid,\n                    gameMonster.rareDropTable[i].dropRate,\n                    gameMonster.rareDropTable[i].minCount,\n                    difficultyTier\n                );\n            }\n        }\n\n        updateCombatDetails() {\n            const combatMonsterDetailMap = getGameData().combatMonsterDetailMap;\n            const gameMonster = combatMonsterDetailMap[this.hrid];\n\n            const levelMultiplier = 1.0 + 0.25 * this.difficultyTier;\n            const defLevelMultiplier = 1.0 + 0.15 * this.difficultyTier;\n            const levelBonus = 20.0 * this.difficultyTier;\n\n            // Labyrinth scaling: all levels multiply by roomLevel / 100\n            const labyrinthScaleFactor = this.roomLevel > 0 ? this.roomLevel / LABYRINTH_BASE_ROOM_LEVEL : 1;\n\n            this.staminaLevel =\n                levelMultiplier * (gameMonster.combatDetails.staminaLevel + levelBonus) * labyrinthScaleFactor;\n            this.intelligenceLevel =\n                levelMultiplier * (gameMonster.combatDetails.intelligenceLevel + levelBonus) * labyrinthScaleFactor;\n            this.attackLevel =\n                levelMultiplier * (gameMonster.combatDetails.attackLevel + levelBonus) * labyrinthScaleFactor;\n            this.meleeLevel = levelMultiplier * (gameMonster.combatDetails.meleeLevel + levelBonus) * labyrinthScaleFactor;\n            this.defenseLevel =\n                defLevelMultiplier * (gameMonster.combatDetails.defenseLevel + levelBonus) * labyrinthScaleFactor;\n            this.rangedLevel =\n                levelMultiplier * (gameMonster.combatDetails.rangedLevel + levelBonus) * labyrinthScaleFactor;\n            this.magicLevel = levelMultiplier * (gameMonster.combatDetails.magicLevel + levelBonus) * labyrinthScaleFactor;\n\n            const expMultiplier = 1.0 + 0.5 * this.difficultyTier;\n            const expBonus = 5.0 * this.difficultyTier;\n\n            this.experience = expMultiplier * (gameMonster.experience + expBonus);\n\n            this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];\n\n            for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {\n                this.combatDetails.combatStats[key] = value;\n            }\n\n            [\n                'stabAccuracy',\n                'slashAccuracy',\n                'smashAccuracy',\n                'rangedAccuracy',\n                'magicAccuracy',\n                'stabDamage',\n                'slashDamage',\n                'smashDamage',\n                'rangedDamage',\n                'magicDamage',\n                'defensiveDamage',\n                'taskDamage',\n                'physicalAmplify',\n                'waterAmplify',\n                'natureAmplify',\n                'fireAmplify',\n                'healingAmplify',\n                'stabEvasion',\n                'slashEvasion',\n                'smashEvasion',\n                'rangedEvasion',\n                'magicEvasion',\n                'armor',\n                'waterResistance',\n                'natureResistance',\n                'fireResistance',\n                'maxHitpoints',\n                'maxManapoints',\n                'lifeSteal',\n                'hpRegenPer10',\n                'mpRegenPer10',\n                'physicalThorns',\n                'elementalThorns',\n                'combatDropRate',\n                'combatRareFind',\n                'combatDropQuantity',\n                'combatExperience',\n                'criticalRate',\n                'criticalDamage',\n                'armorPenetration',\n                'waterPenetration',\n                'naturePenetration',\n                'firePenetration',\n                'abilityHaste',\n                'tenacity',\n                'manaLeech',\n                'castSpeed',\n                'threat',\n                'parry',\n                'mayhem',\n                'pierce',\n                'curse',\n                'fury',\n                'weaken',\n                'ripple',\n                'bloom',\n                'blaze',\n                'attackSpeed',\n                'foodHaste',\n                'drinkConcentration',\n                'autoAttackDamage',\n                'abilityDamage',\n                'retaliation',\n            ].forEach((stat) => {\n                if (gameMonster.combatDetails.combatStats[stat] == null) {\n                    this.combatDetails.combatStats[stat] = 0;\n                }\n            });\n\n            this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;\n\n            // Labyrinth room scaling applies once to the monster's base armor/resistance contributions.\n            // Defense level is already room-scaled above (labyrinthScaleFactor); scaling the derived\n            // totalArmor/totalXResistance again after super.updateCombatDetails() would double-apply it.\n            if (this.roomLevel > 0) {\n                this.combatDetails.combatStats.armor *= labyrinthScaleFactor;\n                this.combatDetails.combatStats.waterResistance *= labyrinthScaleFactor;\n                this.combatDetails.combatStats.natureResistance *= labyrinthScaleFactor;\n                this.combatDetails.combatStats.fireResistance *= labyrinthScaleFactor;\n            }\n\n            super.updateCombatDetails();\n        }\n    }\n\n    const ONE_SECOND = 1e9;\n    const HOT_TICK_INTERVAL = 5 * ONE_SECOND;\n    const DOT_TICK_INTERVAL = 3 * ONE_SECOND;\n    const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;\n    // Empirically measured from real gameplay captures (4,235 clean single-target auto-attack\n    // cycles across 3 independent sessions): the real post-kill respawn delay baseline is ~3024ms,\n    // not a flat 3000ms. A phase-dependent pattern also exists (some 10s windows in a 120s cycle run\n    // measurably longer), but our own captures didn't reproduce the same bins a third-party analysis\n    // (MWI Insight) published, so only this corrected constant is applied here, not a phase model.\n    const ENEMY_RESPAWN_INTERVAL = 3.024 * ONE_SECOND;\n    const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;\n    const RESTART_INTERVAL = 3 * ONE_SECOND;\n    const ENRAGE_TICK_INTERVAL = 60 * ONE_SECOND;\n\n    // The official party Aura family (CSIM-AUD-001) uses strongest-source-wins + fallback semantics.\n    // Every other buff/debuff intentionally keeps the ordinary last-write-wins replacement policy.\n    const OFFICIAL_AURA_ABILITY_HRIDS = new Set([\n        '/abilities/speed_aura',\n        '/abilities/guardian_aura',\n        '/abilities/fierce_aura',\n        '/abilities/critical_aura',\n        '/abilities/mystic_aura',\n    ]);\n\n    class CombatSimulator {\n        /**\n         * @param {Array} players\n         * @param {Object} zone\n         * @param {Function} [onProgress] - Optional progress callback receiving { zone, difficultyTier, progress }\n         * @param {Labyrinth} [labyrinth] - Optional labyrinth encounter manager (replaces zone encounter logic)\n         */\n        constructor(players, zone, onProgress, labyrinth) {\n            this.players = players;\n            this.zone = zone;\n            this.labyrinth = labyrinth || null;\n            this.onProgress = onProgress;\n            this.eventQueue = new EventQueue();\n            this.simResult = new SimResult(zone, players.length);\n            this.allPlayersDead = false;\n\n            this.wipeLogs = {\n                buffer: new Array(200),\n                index: 0,\n                count: 0,\n                maxSize: 200,\n            };\n        }\n\n        addToWipeLogs(logEntry) {\n            const { buffer, maxSize } = this.wipeLogs;\n\n            buffer[this.wipeLogs.index] = logEntry;\n            this.wipeLogs.index = (this.wipeLogs.index + 1) % maxSize;\n            this.wipeLogs.count = Math.min(this.wipeLogs.count + 1, maxSize);\n        }\n\n        logAndResetWipeLogs() {\n            const logs = this.getOrderedWipeLogs();\n\n            logs.forEach((log) => {\n                if (log.error) {\n                    console.log(log.error);\n                }\n            });\n\n            this.wipeLogs.index = 0;\n            this.wipeLogs.count = 0;\n        }\n\n        buildCombatLog(source, ability, target, damageDone) {\n            try {\n                const sourceHrid = source?.hrid || 'UNKNOWN_SOURCE';\n                const targetHrid = target?.hrid || 'UNKNOWN_TARGET';\n\n                const afterHp = target?.combatDetails?.currentHitpoints || 0;\n                const beforeHp = Math.max(0, afterHp + damageDone);\n\n                const playersHp = this.players.map((p) => ({\n                    hrid: p.hrid || 'UNKNOWN_PLAYER',\n                    current: p.combatDetails?.currentHitpoints ?? 0,\n                    max: p.combatDetails?.maxHitpoints ?? 0,\n                }));\n\n                return {\n                    time: this.simulationTime,\n                    wave: this.zone.encountersKilled - 1,\n                    source: sourceHrid,\n                    ability: ability,\n                    target: targetHrid,\n                    damage: damageDone,\n                    beforeHp: beforeHp,\n                    afterHp: afterHp,\n                    playersHp: playersHp,\n                    isCrit: false,\n                };\n            } catch (e) {\n                return {\n                    error: `[Log generation error] ${e.message}`,\n                };\n            }\n        }\n\n        generateCombatLog(source, ability, target, attackResult) {\n            try {\n                const sourceHrid = source?.hrid || 'UNKNOWN_SOURCE';\n                const targetHrid = target?.hrid || 'UNKNOWN_TARGET';\n                const damage = attackResult?.damageDone || 0;\n\n                const afterHp = target?.combatDetails?.currentHitpoints || 0;\n                const beforeHp = Math.max(0, afterHp + damage);\n\n                const playersHp = this.players.map((p) => ({\n                    hrid: p.hrid || 'UNKNOWN_PLAYER',\n                    current: p.combatDetails?.currentHitpoints ?? 0,\n                    max: p.combatDetails?.maxHitpoints ?? 0,\n                }));\n\n                return {\n                    time: this.simulationTime,\n                    wave: this.zone.encountersKilled - 1,\n                    source: sourceHrid,\n                    ability: ability,\n                    target: targetHrid,\n                    damage: damage,\n                    beforeHp: beforeHp,\n                    afterHp: afterHp,\n                    playersHp: playersHp,\n                    isCrit: attackResult?.isCrit || false,\n                };\n            } catch (e) {\n                return {\n                    error: `[Log generation error] ${e.message}`,\n                };\n            }\n        }\n\n        getOrderedWipeLogs() {\n            const { buffer, maxSize, count } = this.wipeLogs;\n            const logs = [];\n\n            for (let i = 0; i < count; i++) {\n                const idx = (this.wipeLogs.index - count + maxSize + i) % maxSize;\n                logs.push(buffer[idx]);\n            }\n\n            return logs;\n        }\n\n        saveWipeLogsToSimResult(wave) {\n            const logs = this.getOrderedWipeLogs();\n            this.simResult.addWipeEvent(logs, this.simulationTime, wave);\n        }\n\n        /**\n         * Run the combat simulation synchronously.\n         * @param {number} simulationTimeLimit - Simulation time limit in nanoseconds\n         * @returns {SimResult}\n         */\n        simulate(simulationTimeLimit) {\n            this.reset();\n\n            let ticks = 0;\n            let attemptCapReached = false;\n\n            const combatStartEvent = new CombatStartEvent(0);\n            this.eventQueue.addEvent(combatStartEvent);\n\n            // Strict horizon (TLA-039 HZN): an event later than the requested limit must never be\n            // processed, even if the previous event's time was still inside the horizon. Peeking\n            // before popping keeps that event out of the simulation entirely instead of overshooting.\n            while (true) {\n                const nextEvent = this.eventQueue.peekNextEvent();\n                if (!nextEvent || nextEvent.time > simulationTimeLimit) {\n                    break;\n                }\n                this.eventQueue.getNextEvent();\n                this.processEvent(nextEvent);\n\n                // Attempt-count labyrinth run: every requested attempt has finished, so stop here\n                // rather than at the (safety-ceiling) time horizon.\n                if (this.labyrinth && this.labyrinth.hasReachedAttemptCap()) {\n                    attemptCapReached = true;\n                    break;\n                }\n\n                ticks++;\n                if (ticks === 50000) {\n                    ticks = 0;\n                    if (this.onProgress) {\n                        this.onProgress({\n                            zone: this.zone.hrid,\n                            difficultyTier: this.zone.difficultyTier,\n                            progress: Math.min(this.simulationTime / simulationTimeLimit, 1),\n                        });\n                    }\n                }\n            }\n\n            this.simResult.isDungeon = this.zone.isDungeon;\n            if (this.simResult.isDungeon) {\n                this.simResult.dungeonsCompleted = this.zone.dungeonsCompleted;\n                this.simResult.dungeonsFailed = this.zone.dungeonsFailed;\n                if (this.simResult.dungeonsCompleted < 1) {\n                    this.simResult.maxWaveReached = 0;\n                    for (let i = 0; i <= this.zone.dungeonSpawnInfo.maxWaves; i++) {\n                        const waveName = '#' + i.toString();\n                        const idx = this.simResult.timeSpentAlive.findIndex((e) => e.name === waveName);\n                        if (idx === -1 || this.simResult.timeSpentAlive[idx].count === 0) {\n                            break;\n                        }\n                        this.simResult.maxWaveReached = i;\n                    }\n                } else {\n                    this.simResult.maxWaveReached = this.zone.dungeonSpawnInfo.maxWaves;\n                }\n            }\n\n            // Labyrinth result tracking\n            if (this.labyrinth) {\n                this.simResult.isLabyrinth = true;\n                // An attempt-count run reports only finished attempts; a time-horizon run keeps its\n                // historical count, which includes the attempt cut off by the horizon.\n                this.simResult.labyAttemptCount =\n                    this.labyrinth.maxAttempts !== null ? this.labyrinth.completedAttempts : this.labyrinth.attemptCount;\n                this.simResult.labyrinthMonsterHrid = this.labyrinth.monsterHrid;\n                this.simResult.roomLevel = this.labyrinth.roomLevel;\n            }\n\n            // Exact requested horizon (TLA-039 HZN-03), not the last processed event's time - rate/DPS\n            // consumers normalize against the full window that was actually requested.\n            this.simResult.simulatedTime = simulationTimeLimit;\n            if (attemptCapReached) {\n                // Stopped on the attempt count, so the window that was actually simulated ends at the\n                // last attempt's outcome, not at the safety-ceiling horizon.\n                this.simResult.simulatedTime = this.simulationTime;\n            }\n\n            for (let i = 0; i < this.players.length; i++) {\n                this.simResult.setDropRateMultipliers(this.players[i]);\n                this.simResult.setManaUsed(this.players[i]);\n            }\n\n            if (this.zone.isDungeon) {\n                Object.entries(this.zone.dungeonSpawnInfo.fixedSpawnsMap).forEach(([wave, monsters]) => {\n                    let waveName = '#' + wave.toString();\n                    monsters.forEach((monster) => {\n                        waveName += ',' + monster.combatMonsterHrid;\n                    });\n                    this.simResult.bossSpawns.push(waveName);\n                });\n            }\n            if (this.zone.monsterSpawnInfo.bossSpawns) {\n                for (const boss of this.zone.monsterSpawnInfo.bossSpawns) {\n                    this.simResult.bossSpawns.push(boss.combatMonsterHrid);\n                }\n            }\n\n            return this.simResult;\n        }\n\n        reset() {\n            this.simulationTime = 0;\n            this.dungeonRunStartTime = 0;\n            this.justCompletedDungeonRun = false;\n            this.eventQueue.clear();\n            this.simResult = new SimResult(this.zone, this.players.length);\n        }\n\n        processEvent(event) {\n            this.simulationTime = event.time;\n\n            switch (event.type) {\n                case CombatStartEvent.type:\n                    this.processCombatStartEvent(event);\n                    break;\n                case PlayerRespawnEvent.type:\n                    this.processPlayerRespawnEvent(event);\n                    break;\n                case EnemyRespawnEvent.type:\n                    this.processEnemyRespawnEvent(event);\n                    break;\n                case AutoAttackEvent.type:\n                    this.processAutoAttackEvent(event);\n                    break;\n                case ConsumableTickEvent.type:\n                    this.processConsumableTickEvent(event);\n                    break;\n                case DamageOverTimeEvent.type:\n                    this.processDamageOverTimeTickEvent(event);\n                    break;\n                case CheckBuffExpirationEvent.type:\n                    this.processCheckBuffExpirationEvent(event);\n                    break;\n                case RegenTickEvent.type:\n                    this.processRegenTickEvent(event);\n                    break;\n                case StunExpirationEvent.type:\n                    this.processStunExpirationEvent(event);\n                    break;\n                case BlindExpirationEvent.type:\n                    this.processBlindExpirationEvent(event);\n                    break;\n                case SilenceExpirationEvent.type:\n                    this.processSilenceExpirationEvent(event);\n                    break;\n                case CurseExpirationEvent.type:\n                    this.processCurseExpirationEvent(event);\n                    break;\n                case WeakenExpirationEvent.type:\n                    this.processWeakenExpirationEvent(event);\n                    break;\n                case FuryExpirationEvent.type:\n                    this.processFuryExpirationEvent(event);\n                    break;\n                case EnrageTickEvent.type:\n                    this.processEnrageTickEvent(event);\n                    break;\n                case AbilityCastEndEvent.type:\n                    this.tryUseAbility(event.source, event.ability);\n                    break;\n                case AwaitCooldownEvent.type:\n                    this.addNextAttackEvent(event.source);\n                    break;\n            }\n\n            this.checkTriggers();\n        }\n\n        processCombatStartEvent(event) {\n            for (let i = 0; i < this.players.length; i++) {\n                if (event.time === 0) {\n                    // First combat start event\n                    this.players[i].generatePermanentBuffs();\n                    this._applyPersonalPermanentCombatBuffs(this.players[i]);\n                }\n                if (this.labyrinth) {\n                    // Labyrinth: full reset every encounter (independent fights)\n                    this.players[i].reset(0);\n                } else {\n                    this.players[i].reset(this.simulationTime);\n                }\n                if (event.time === 0) {\n                    this._applyPersonalTimedCombatBuffs(this.players[i]);\n                }\n            }\n\n            const regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);\n            this.eventQueue.addEvent(regenTickEvent);\n\n            this.startNewEncounter();\n        }\n\n        processPlayerRespawnEvent(event) {\n            const respawningPlayer = this.players.find((player) => player.hrid === event.hrid);\n            respawningPlayer.combatDetails.currentHitpoints = respawningPlayer.combatDetails.maxHitpoints;\n            respawningPlayer.combatDetails.currentManapoints = respawningPlayer.combatDetails.maxManapoints;\n            respawningPlayer.clearBuffs();\n            respawningPlayer.clearCCs();\n            if (this.allPlayersDead) {\n                this.allPlayersDead = false;\n                this.startAttacks();\n            } else {\n                this.addNextAttackEvent(respawningPlayer);\n            }\n        }\n\n        processEnemyRespawnEvent(_event) {\n            this.startNewEncounter();\n        }\n\n        startNewEncounter() {\n            if (this.allPlayersDead) {\n                this.allPlayersDead = false;\n                // Dungeon failure is now counted immediately at the moment of the wipe itself\n                // (checkEncounterEnd), not here at the delayed restart - failWave()'s dungeonsFailed++\n                // would double-count it. Non-dungeon zones still reset their boss-cycle encountersKilled\n                // counter here exactly as before.\n                if (!this.labyrinth && !this.zone.isDungeon) {\n                    this.zone.failWave();\n                }\n            }\n\n            if (this.labyrinth) {\n                this.enemies = this.labyrinth.getMonster();\n                this.labyrinth.updateEncounterStartTime(this.simulationTime);\n            } else if (!this.zone.isDungeon) {\n                this.enemies = this.zone.getRandomEncounter();\n            } else {\n                // encountersKilled is reset to 1 immediately at the previous run's terminal kill/wipe\n                // (checkEncounterEnd), so seeing it here means wave 1 of a fresh attempt is starting now.\n                if (this.zone.encountersKilled === 1) {\n                    this.dungeonRunStartTime = this.simulationTime;\n                }\n                this.enemies = this.zone.getNextWave();\n                this.simResult.updateTimeSpentAlive(\n                    '#' + (this.zone.encountersKilled - 1).toString(),\n                    true,\n                    this.simulationTime\n                );\n                if (this.justCompletedDungeonRun) {\n                    this.justCompletedDungeonRun = false;\n                    for (let i = 0; i < this.players.length; i++) {\n                        this.players[i].combatDetails.currentHitpoints = this.players[i].combatDetails.maxHitpoints;\n                        this.players[i].combatDetails.currentManapoints = this.players[i].combatDetails.maxManapoints;\n                    }\n                }\n            }\n\n            this.enemies.forEach((enemy) => {\n                enemy.reset(this.simulationTime);\n                this.simResult.updateTimeSpentAlive(enemy.hrid, true, this.simulationTime);\n            });\n\n            this.eventQueue.clearEventsOfType(EnrageTickEvent.type);\n            const enrageTickEvent = new EnrageTickEvent(this.simulationTime + ENRAGE_TICK_INTERVAL, ENRAGE_TICK_INTERVAL);\n            this.eventQueue.addEvent(enrageTickEvent);\n            this.enrageBeginTime = this.simulationTime;\n\n            this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);\n\n            this.checkTriggers();\n            this.startAttacks();\n        }\n\n        startAttacks() {\n            const units = [...this.players];\n            if (this.enemies) {\n                units.push(...this.enemies);\n            }\n\n            for (const unit of units) {\n                if (unit.combatDetails.currentHitpoints <= 0) {\n                    continue;\n                }\n\n                this.addNextAttackEvent(unit);\n            }\n        }\n\n        checkParry(targets) {\n            const parryUnits = targets.filter(\n                (unit) => unit && unit.combatDetails.currentHitpoints > 0 && unit.combatDetails.combatStats.parry > 0\n            );\n            if (parryUnits.length <= 0) {\n                return undefined;\n            }\n            const randomIndex = Math.floor(Math.random() * parryUnits.length);\n            if (parryUnits[randomIndex].combatDetails.combatStats.parry > Math.random()) {\n                return parryUnits[randomIndex];\n            }\n            return undefined;\n        }\n\n        processAutoAttackEvent(event) {\n            const targets = event.source.isPlayer ? this.enemies : this.players;\n\n            if (!targets) {\n                return;\n            }\n\n            const aliveTargets = targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0);\n\n            for (let i = 0; i < aliveTargets.length; i++) {\n                let target = aliveTargets[i];\n                if (!event.source.isPlayer && aliveTargets.length > 1) {\n                    let cumulativeThreat = 0;\n                    const cumulativeRanges = [];\n                    aliveTargets.forEach((player) => {\n                        const playerThreat = player.combatDetails.combatStats.threat;\n                        cumulativeThreat += playerThreat;\n                        cumulativeRanges.push({\n                            player: player,\n                            rangeStart: cumulativeThreat - playerThreat,\n                            rangeEnd: cumulativeThreat,\n                        });\n                    });\n                    const randomValueHit = Math.random() * cumulativeThreat;\n                    target = cumulativeRanges.find(\n                        (range) => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd\n                    ).player;\n                }\n                let source = event.source;\n\n                const parryTarget = this.checkParry(targets);\n                if (parryTarget) {\n                    target = source;\n                    source = parryTarget;\n                }\n\n                const attackResult = CombatUtilities.processAttack(source, target);\n                if (this.zone.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {\n                    const log = this.generateCombatLog(source, 'autoAttack', target, attackResult);\n                    this.addToWipeLogs(log);\n                }\n\n                const mayhem = source.combatDetails.combatStats.mayhem > Math.random();\n\n                if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {\n                    const curseExpireTime = 15000000000;\n                    const currentCurseEvent = this.eventQueue.getByTypeAndSource(CurseExpirationEvent.type, target);\n                    let currentCurseAmount = 0;\n                    if (currentCurseEvent) currentCurseAmount = currentCurseEvent.curseAmount;\n                    this.eventQueue.clearByTypeAndSource(CurseExpirationEvent.type, target);\n\n                    const curseExpirationEvent = new CurseExpirationEvent(\n                        this.simulationTime + curseExpireTime,\n                        currentCurseAmount,\n                        target\n                    );\n                    const curseBuff = {\n                        uniqueHrid: '/buff_uniques/curse',\n                        typeHrid: '/buff_types/damage_taken',\n                        ratioBoost: 0,\n                        ratioBoostLevelBonus: 0,\n                        flatBoost: source.combatDetails.combatStats.curse * curseExpirationEvent.curseAmount,\n                        flatBoostLevelBonus: 0,\n                        startTime: '0001-01-01T00:00:00Z',\n                        duration: curseExpireTime,\n                    };\n                    target.addBuff(curseBuff, this.simulationTime);\n                    this.eventQueue.addEvent(curseExpirationEvent);\n                }\n\n                if (source.combatDetails.combatStats.fury > 0) {\n                    this._processFuryUpdate(source, attackResult.didHit);\n                }\n\n                if (target.combatDetails.combatStats.weaken > 0) {\n                    const weakenExpireTime = 15000000000;\n                    const currentWeakenEvent = this.eventQueue.getByTypeAndSource(WeakenExpirationEvent.type, source);\n                    let weakenAmount = 0;\n                    if (currentWeakenEvent) weakenAmount = currentWeakenEvent.weakenAmount;\n                    this.eventQueue.clearByTypeAndSource(WeakenExpirationEvent.type, source);\n                    const weakenExpirationEvent = new WeakenExpirationEvent(\n                        this.simulationTime + 15000000000,\n                        weakenAmount,\n                        source\n                    );\n                    const weakenBuff = {\n                        uniqueHrid: '/buff_uniques/weaken',\n                        typeHrid: '/buff_types/damage',\n                        ratioBoost: -1 * target.combatDetails.combatStats.weaken * weakenExpirationEvent.weakenAmount,\n                        ratioBoostLevelBonus: 0,\n                        flatBoost: 0,\n                        flatBoostLevelBonus: 0,\n                        startTime: '0001-01-01T00:00:00Z',\n                        duration: weakenExpireTime,\n                    };\n                    source.addBuff(weakenBuff, this.simulationTime);\n                    this.eventQueue.addEvent(weakenExpirationEvent);\n                }\n\n                if (!mayhem || (mayhem && attackResult.didHit) || (mayhem && i === aliveTargets.length - 1)) {\n                    this.simResult.addAttack(\n                        source,\n                        target,\n                        'autoAttack',\n                        attackResult.didHit ? attackResult.damageDone : 'miss'\n                    );\n                }\n\n                if (attackResult.lifeStealHeal > 0) {\n                    this.simResult.addHitpointsGained(source, 'lifesteal', attackResult.lifeStealHeal);\n                }\n\n                if (attackResult.manaLeechMana > 0) {\n                    this.simResult.addManapointsGained(source, 'manaLeech', attackResult.manaLeechMana);\n                }\n\n                if (attackResult.thornDamageDone > 0) {\n                    this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);\n                }\n                if (this.zone.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {\n                    const log = this.buildCombatLog(target, attackResult.thornType, source, attackResult.thornDamageDone);\n                    this.addToWipeLogs(log);\n                }\n\n                if (target.combatDetails.combatStats.retaliation > 0) {\n                    this.simResult.addAttack(\n                        target,\n                        source,\n                        'retaliation',\n                        attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : 'miss'\n                    );\n                }\n                if (this.zone.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {\n                    const log = this.buildCombatLog(target, 'retaliation', source, attackResult.retaliationDamageDone);\n                    this.addToWipeLogs(log);\n                }\n\n                if (target.combatDetails.currentHitpoints === 0) {\n                    this.eventQueue.clearEventsForUnit(target);\n                    this.simResult.addDeath(target);\n                    if (!target.isPlayer) {\n                        this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);\n                        this.simResult.recordMonsterKill(target.hrid, this.players);\n                    }\n                }\n\n                // Could die from reflect damage\n                if (\n                    source.combatDetails.currentHitpoints === 0 &&\n                    (attackResult.thornDamageDone !== 0 || attackResult.retaliationDamageDone !== 0)\n                ) {\n                    this.eventQueue.clearEventsForUnit(source);\n                    this.simResult.addDeath(source);\n                    if (!source.isPlayer) {\n                        this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);\n                        this.simResult.recordMonsterKill(source.hrid, this.players);\n                    }\n                    break;\n                }\n\n                if (mayhem && !attackResult.didHit) {\n                    continue;\n                }\n\n                if (!attackResult.didHit || parryTarget || source.combatDetails.combatStats.pierce <= Math.random()) {\n                    break;\n                }\n            }\n\n            if (!this.checkEncounterEnd()) {\n                this.addNextAttackEvent(event.source);\n            }\n        }\n\n        checkEncounterEnd() {\n            // Labyrinth timeout check\n            if (this.labyrinth && this.enemies && this.labyrinth.checkTimeout(this.simulationTime)) {\n                // Timeout = loss. Clear everything and immediately restart.\n                this.labyrinth.recordOutcome();\n                this.enemies = null;\n                this.eventQueue.clear();\n                const combatStartEvent = new CombatStartEvent(this.simulationTime);\n                this.eventQueue.addEvent(combatStartEvent);\n                return true;\n            }\n\n            if (this.enemies) {\n                const deadEnemies = this.enemies.filter(\n                    (enemy) => enemy.combatDetails.currentHitpoints <= 0 && enemy.experienceRate === 0\n                );\n                if (deadEnemies.length > 0) {\n                    deadEnemies.forEach((enemy) => {\n                        let aliveDuration = this.simulationTime - this.enrageBeginTime;\n                        if (aliveDuration > enemy.enrageTime) {\n                            aliveDuration = enemy.enrageTime;\n                        }\n                        enemy.experienceRate = 1.0 + aliveDuration / enemy.enrageTime;\n                    });\n                }\n            }\n\n            let encounterEnded = false;\n\n            if (this.enemies && !this.enemies.some((enemy) => enemy.combatDetails.currentHitpoints > 0)) {\n                this.eventQueue.clearEventsOfType(AutoAttackEvent.type);\n\n                if (this.labyrinth) {\n                    // Labyrinth win: immediate restart (no respawn delay)\n                    this.labyrinth.recordOutcome();\n                    this.enemies = null;\n                    this.simResult.addEncounterEnd();\n                    this.eventQueue.clear();\n                    const combatStartEvent = new CombatStartEvent(this.simulationTime);\n                    this.eventQueue.addEvent(combatStartEvent);\n                    return true;\n                }\n\n                const enemyRespawnEvent = new EnemyRespawnEvent(this.simulationTime + ENEMY_RESPAWN_INTERVAL);\n                this.eventQueue.addEvent(enemyRespawnEvent);\n\n                // calc exp before clear\n                if (this.enemies.some((enemy) => enemy.experienceRate <= 0)) {\n                    console.warn('[CombatSimulator] Some enemies have no experience rate');\n                }\n\n                const totalExp = this.enemies\n                    .map((enemy) => enemy.experience * enemy.experienceRate)\n                    .reduce((a, b) => a + b, 0);\n                this.players.forEach((player) => {\n                    this.simResult.addExperienceGain(player, totalExp / this.players.length);\n                });\n\n                this.enemies = null;\n\n                if (this.zone.isDungeon) {\n                    const killedWaveNum = this.zone.encountersKilled - 1;\n                    this.simResult.updateTimeSpentAlive('#' + killedWaveNum.toString(), false, this.simulationTime);\n\n                    // Terminal success (TLA-039 HZN): count the completion, its reward/drop context, and\n                    // its duration immediately at the final-wave kill, not ~3s later when the next\n                    // attempt's re-entry happens - a kill right at the horizon edge must still count even\n                    // if that re-entry falls outside the requested horizon and never runs.\n                    if (killedWaveNum === this.zone.dungeonSpawnInfo.maxWaves) {\n                        this.zone.dungeonsCompleted++;\n                        this.zone.encountersKilled = 1;\n                        this.simResult.recordDungeonCompletion(this.players);\n                        this.simResult.addDungeonCompletionDuration(this.simulationTime - this.dungeonRunStartTime);\n                        this.justCompletedDungeonRun = true;\n                    }\n                }\n                this.simResult.addEncounterEnd();\n\n                encounterEnded = true;\n            }\n\n            this.players.forEach((player) => {\n                if (\n                    player.combatDetails.currentHitpoints <= 0 &&\n                    !this.eventQueue.containsEventOfTypeAndHrid(PlayerRespawnEvent.type, player.hrid)\n                ) {\n                    if (!this.zone.isDungeon && !this.labyrinth) {\n                        const playerRespawnEvent = new PlayerRespawnEvent(\n                            this.simulationTime + PLAYER_RESPAWN_INTERVAL,\n                            player.hrid\n                        );\n                        this.eventQueue.addEvent(playerRespawnEvent);\n                    }\n                    this.simResult.addRanOutOfManaCount(player, false, this.simulationTime);\n                }\n            });\n\n            if (!this.players.some((player) => player.combatDetails.currentHitpoints > 0)) {\n                if (this.labyrinth) {\n                    // Labyrinth death = loss. Immediate restart.\n                    this.labyrinth.recordOutcome();\n                    this.enemies = null;\n                    this.eventQueue.clear();\n                    const combatStartEvent = new CombatStartEvent(this.simulationTime);\n                    this.eventQueue.addEvent(combatStartEvent);\n                    return true;\n                } else if (this.zone.isDungeon) {\n                    this.saveWipeLogsToSimResult(this.zone.encountersKilled - 1);\n                    this.wipeLogs.index = 0;\n                    this.wipeLogs.count = 0;\n\n                    // Terminal failure (TLA-039 HZN-07): count the wipe immediately, not ~3s later at\n                    // the delayed restart - a wipe right at the horizon edge must still count even if\n                    // that restart falls outside the requested horizon and never runs.\n                    this.zone.dungeonsFailed++;\n                    this.zone.encountersKilled = 1;\n\n                    // Clear combat events but preserve buff expiration and cooldown events\n                    this.eventQueue.clearEventsOfType(AutoAttackEvent.type);\n                    this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);\n                    this.eventQueue.clearEventsOfType(DamageOverTimeEvent.type);\n                    this.eventQueue.clearEventsOfType(ConsumableTickEvent.type);\n                    this.eventQueue.clearEventsOfType(RegenTickEvent.type);\n                    this.eventQueue.clearEventsOfType(EnrageTickEvent.type);\n                    this.eventQueue.clearEventsOfType(StunExpirationEvent.type);\n                    this.eventQueue.clearEventsOfType(BlindExpirationEvent.type);\n                    this.eventQueue.clearEventsOfType(SilenceExpirationEvent.type);\n                    this.eventQueue.clearEventsOfType(AwaitCooldownEvent.type);\n                    this.enemies = null;\n\n                    const combatStartEvent = new CombatStartEvent(this.simulationTime + RESTART_INTERVAL);\n                    this.eventQueue.addEvent(combatStartEvent);\n                } else {\n                    this.eventQueue.clearEventsOfType(AutoAttackEvent.type);\n                    this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);\n                }\n                encounterEnded = true;\n                this.allPlayersDead = true;\n            }\n\n            return encounterEnded;\n        }\n\n        addNextAttackEvent(source) {\n            // Check both event types via indexed lookups instead of O(n) getMatching\n            if (\n                this.eventQueue.getByTypeAndSource(AbilityCastEndEvent.type, source) ||\n                this.eventQueue.getByTypeAndSource(AutoAttackEvent.type, source)\n            ) {\n                return;\n            }\n\n            let target;\n            let friendlies;\n            let enemies;\n            if (source.isPlayer) {\n                target = CombatUtilities.getTarget(this.enemies);\n                friendlies = this.players;\n                enemies = this.enemies;\n            } else {\n                target = CombatUtilities.getTarget(this.players);\n                friendlies = this.enemies;\n                enemies = this.players;\n            }\n\n            let usedAbility = false;\n            let skipNextAbility = false;\n\n            source.abilities\n                .filter((ability) => ability != null)\n                .forEach((ability) => {\n                    if (\n                        !usedAbility &&\n                        !skipNextAbility &&\n                        ability.shouldTrigger(this.simulationTime, source, target, friendlies, enemies)\n                    ) {\n                        if (!this.canUseAbility(source, ability, true)) {\n                            skipNextAbility = true;\n                        }\n\n                        if (!skipNextAbility) {\n                            let castDuration = ability.castDuration;\n                            castDuration /= 1 + source.combatDetails.combatStats.castSpeed;\n                            const abilityCastEndEvent = new AbilityCastEndEvent(\n                                this.simulationTime + castDuration,\n                                source,\n                                ability\n                            );\n                            this.eventQueue.addEvent(abilityCastEndEvent);\n                            usedAbility = true;\n                        }\n                    }\n                });\n\n            if (usedAbility) {\n                source.isOutOfMana = false;\n                return;\n            }\n\n            if (!enemies) {\n                return;\n            }\n\n            if (!source.isBlinded) {\n                const autoAttackEvent = new AutoAttackEvent(\n                    this.simulationTime + source.combatDetails.combatStats.attackInterval,\n                    source\n                );\n                this.eventQueue.addEvent(autoAttackEvent);\n            } else {\n                source.isOutOfMana = true;\n            }\n        }\n\n        processConsumableTickEvent(event) {\n            if (event.consumable.hitpointRestore > 0) {\n                const tickValue = CombatUtilities.calculateTickValue(\n                    event.consumable.hitpointRestore,\n                    event.totalTicks,\n                    event.currentTick\n                );\n                const hitpointsAdded = event.source.addHitpoints(tickValue);\n                this.simResult.addHitpointsGained(event.source, event.consumable.hrid, hitpointsAdded);\n            }\n\n            if (event.consumable.manapointRestore > 0) {\n                const tickValue = CombatUtilities.calculateTickValue(\n                    event.consumable.manapointRestore,\n                    event.totalTicks,\n                    event.currentTick\n                );\n                const manapointsAdded = event.source.addManapoints(tickValue);\n                this.simResult.addManapointsGained(event.source, event.consumable.hrid, manapointsAdded);\n\n                // when oom check ability trigger\n                if (event.source.isOutOfMana) {\n                    const awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, event.source);\n                    this.eventQueue.addEvent(awaitCooldownEvent);\n                }\n            }\n\n            if (event.currentTick < event.totalTicks) {\n                const consumableTickEvent = new ConsumableTickEvent(\n                    this.simulationTime + HOT_TICK_INTERVAL,\n                    event.source,\n                    event.consumable,\n                    event.totalTicks,\n                    event.currentTick + 1\n                );\n                this.eventQueue.addEvent(consumableTickEvent);\n            }\n        }\n\n        processDamageOverTimeTickEvent(event) {\n            const tickDamage = CombatUtilities.calculateTickValue(event.damage, event.totalTicks, event.currentTick);\n            const damage = Math.min(tickDamage, event.target.combatDetails.currentHitpoints);\n\n            event.target.combatDetails.currentHitpoints -= damage;\n            this.simResult.addAttack(event.sourceRef, event.target, 'damageOverTime', damage);\n\n            const log = this.buildCombatLog('', 'damageOverTime', event.target, damage);\n            this.addToWipeLogs(log);\n\n            if (event.currentTick < event.totalTicks) {\n                const damageOverTimeTickEvent = new DamageOverTimeEvent(\n                    this.simulationTime + DOT_TICK_INTERVAL,\n                    event.sourceRef,\n                    event.target,\n                    event.damage,\n                    event.totalTicks,\n                    event.currentTick + 1,\n                    event.combatStyleHrid\n                );\n                this.eventQueue.addEvent(damageOverTimeTickEvent);\n            }\n\n            if (event.target.combatDetails.currentHitpoints === 0) {\n                this.eventQueue.clearEventsForUnit(event.target);\n                this.simResult.addDeath(event.target);\n                if (!event.target.isPlayer) {\n                    this.simResult.updateTimeSpentAlive(event.target.hrid, false, this.simulationTime);\n                    this.simResult.recordMonsterKill(event.target.hrid, this.players);\n                }\n            }\n\n            this.checkEncounterEnd();\n        }\n\n        processRegenTickEvent(_event) {\n            const units = [...this.players];\n            // Enemy regen is always 0 in game data — skip enemies\n\n            for (const unit of units) {\n                if (unit.combatDetails.currentHitpoints <= 0) {\n                    continue;\n                }\n\n                const hitpointRegen = Math.floor(\n                    unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.hpRegenPer10\n                );\n                const hitpointsAdded = unit.addHitpoints(hitpointRegen);\n                this.simResult.addHitpointsGained(unit, 'regen', hitpointsAdded);\n\n                const manapointRegen = Math.floor(\n                    unit.combatDetails.maxManapoints * unit.combatDetails.combatStats.mpRegenPer10\n                );\n                const manapointsAdded = unit.addManapoints(manapointRegen);\n                this.simResult.addManapointsGained(unit, 'regen', manapointsAdded);\n\n                // when oom check ability trigger\n                if (unit.isOutOfMana) {\n                    const awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, unit);\n                    this.eventQueue.addEvent(awaitCooldownEvent);\n                }\n            }\n\n            const regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);\n            this.eventQueue.addEvent(regenTickEvent);\n        }\n\n        processCheckBuffExpirationEvent(event) {\n            event.source.removeExpiredBuffs(this.simulationTime);\n        }\n\n        processStunExpirationEvent(event) {\n            event.source.isStunned = false;\n            this.addNextAttackEvent(event.source);\n        }\n\n        processBlindExpirationEvent(event) {\n            event.source.isBlinded = false;\n            this.addNextAttackEvent(event.source);\n        }\n\n        processSilenceExpirationEvent(event) {\n            event.source.isSilenced = false;\n        }\n\n        processCurseExpirationEvent(event) {\n            event.source.removeExpiredBuffs(this.simulationTime);\n        }\n\n        processWeakenExpirationEvent(event) {\n            event.source.removeExpiredBuffs(this.simulationTime);\n        }\n\n        processFuryExpirationEvent(event) {\n            event.source.furyAmount = 0;\n            event.source.furyExpireTime = 0;\n            event.source.updateFuryBuffs(0, 0, 0, 0);\n        }\n\n        _processFuryUpdate(source, didHit) {\n            const FURY_EXPIRE_TIME = 15000000000;\n            const MAX_FURY_STACK = 5;\n\n            const oldAmount = source.furyAmount;\n            const newAmount = didHit ? Math.min(oldAmount + 1, MAX_FURY_STACK) : oldAmount / 2;\n\n            source.furyAmount = newAmount;\n\n            // Always reschedule expiration (resets the 15s timer)\n            this.eventQueue.clearByTypeAndSource(FuryExpirationEvent.type, source);\n            if (newAmount > 0) {\n                source.furyExpireTime = this.simulationTime + FURY_EXPIRE_TIME;\n                this.eventQueue.addEvent(new FuryExpirationEvent(source.furyExpireTime, newAmount, source));\n            }\n\n            // Only recalculate combat stats if stacks actually changed\n            if (newAmount !== oldAmount) {\n                source.updateFuryBuffs(\n                    newAmount,\n                    source.combatDetails.combatStats.fury,\n                    this.simulationTime,\n                    FURY_EXPIRE_TIME\n                );\n            }\n        }\n\n        processEnrageTickEvent(event) {\n            if (!this.enemies) return;\n            const maxEnrageStack = 10;\n            this.enemies\n                .filter((enemy) => enemy.combatDetails.currentHitpoints > 0)\n                .forEach((enemy) => {\n                    const nowStack = Math.min(maxEnrageStack, Math.floor(event.encounterTime / enemy.enrageTime));\n\n                    if (nowStack <= 0) {\n                        return;\n                    }\n\n                    const enrageDamageBuff = {\n                        uniqueHrid: '/buff_uniques/enrage_damage',\n                        typeHrid: '/buff_types/damage',\n                        ratioBoost: nowStack * 0.1,\n                        ratioBoostLevelBonus: 0,\n                        flatBoost: 0,\n                        flatBoostLevelBonus: 0,\n                        startTime: '0001-01-01T00:00:00Z',\n                        duration: ENRAGE_TICK_INTERVAL,\n                    };\n                    const enrageAccuracyBuff = {\n                        uniqueHrid: '/buff_uniques/enrage_accuracy',\n                        typeHrid: '/buff_types/accuracy',\n                        ratioBoost: nowStack * 0.1,\n                        ratioBoostLevelBonus: 0,\n                        flatBoost: 0,\n                        flatBoostLevelBonus: 0,\n                        startTime: '0001-01-01T00:00:00Z',\n                        duration: ENRAGE_TICK_INTERVAL,\n                    };\n                    enemy.addBuff(enrageDamageBuff);\n                    enemy.addBuff(enrageAccuracyBuff);\n\n                    this.simResult.maxEnrageStack = Math.max(this.simResult.maxEnrageStack, nowStack);\n                });\n\n            const enrageTickEvent = new EnrageTickEvent(\n                this.simulationTime + ENRAGE_TICK_INTERVAL,\n                event.encounterTime + ENRAGE_TICK_INTERVAL\n            );\n            this.eventQueue.addEvent(enrageTickEvent);\n        }\n\n        checkTriggers() {\n            let triggeredSomething;\n\n            do {\n                triggeredSomething = false;\n\n                for (const player of this.players) {\n                    if (player.combatDetails.currentHitpoints > 0) {\n                        if (this.checkTriggersForUnit(player, this.players, this.enemies)) {\n                            triggeredSomething = true;\n                        }\n                    }\n                }\n\n                if (this.enemies) {\n                    for (const enemy of this.enemies) {\n                        if (enemy.combatDetails.currentHitpoints > 0) {\n                            if (this.checkTriggersForUnit(enemy, this.enemies, this.players)) {\n                                triggeredSomething = true;\n                            }\n                        }\n                    }\n                }\n            } while (triggeredSomething);\n        }\n\n        checkTriggersForUnit(unit, friendlies, enemies) {\n            if (unit.combatDetails.currentHitpoints <= 0) {\n                throw new Error('Checking triggers for a dead unit');\n            }\n\n            let triggeredSomething = false;\n            const target = CombatUtilities.getTarget(enemies);\n\n            for (const food of unit.food) {\n                if (food && food.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {\n                    const result = this.tryUseConsumable(unit, food);\n                    if (result) {\n                        triggeredSomething = true;\n                    }\n                }\n            }\n\n            for (const drink of unit.drinks) {\n                if (drink && drink.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {\n                    const result = this.tryUseConsumable(unit, drink);\n                    if (result) {\n                        triggeredSomething = true;\n                    }\n                }\n            }\n\n            return triggeredSomething;\n        }\n\n        tryUseConsumable(source, consumable) {\n            if (source.combatDetails.currentHitpoints <= 0) {\n                return false;\n            }\n\n            consumable.lastUsed = this.simulationTime;\n            let consumeCooldown = consumable.cooldownDuration;\n            if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes('drink')) {\n                consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.drinkConcentration);\n            } else if (source.combatDetails.combatStats.foodHaste > 0 && consumable.catagoryHrid.includes('food')) {\n                consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.foodHaste);\n            }\n            const cooldownReadyEvent = new CooldownReadyEvent(this.simulationTime + consumeCooldown);\n            this.eventQueue.addEvent(cooldownReadyEvent);\n\n            this.simResult.addConsumableUse(source, consumable);\n\n            if (consumable.recoveryDuration === 0) {\n                if (consumable.hitpointRestore > 0) {\n                    const hitpointsAdded = source.addHitpoints(consumable.hitpointRestore);\n                    this.simResult.addHitpointsGained(source, consumable.hrid, hitpointsAdded);\n                }\n\n                if (consumable.manapointRestore > 0) {\n                    const manapointsAdded = source.addManapoints(consumable.manapointRestore);\n                    this.simResult.addManapointsGained(source, consumable.hrid, manapointsAdded);\n\n                    // when oom check ability trigger\n                    if (source.isOutOfMana) {\n                        const awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, source);\n                        this.eventQueue.addEvent(awaitCooldownEvent);\n                    }\n                }\n            } else {\n                const consumableTickEvent = new ConsumableTickEvent(\n                    this.simulationTime + HOT_TICK_INTERVAL,\n                    source,\n                    consumable,\n                    consumable.recoveryDuration / HOT_TICK_INTERVAL,\n                    1\n                );\n                this.eventQueue.addEvent(consumableTickEvent);\n            }\n\n            for (const buff of consumable.buffs) {\n                const currentBuff = structuredClone(buff);\n                if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes('drink')) {\n                    currentBuff.ratioBoost *= 1 + source.combatDetails.combatStats.drinkConcentration;\n                    currentBuff.flatBoost *= 1 + source.combatDetails.combatStats.drinkConcentration;\n                    currentBuff.duration = currentBuff.duration / (1 + source.combatDetails.combatStats.drinkConcentration);\n                }\n                source.addBuff(currentBuff, this.simulationTime);\n                const checkBuffExpirationEvent = new CheckBuffExpirationEvent(\n                    this.simulationTime + currentBuff.duration,\n                    source\n                );\n                this.eventQueue.addEvent(checkBuffExpirationEvent);\n            }\n\n            return true;\n        }\n\n        canUseAbility(source, ability, oomCheck) {\n            if (source.combatDetails.currentHitpoints <= 0) {\n                return false;\n            }\n\n            if (source.combatDetails.currentManapoints < ability.manaCost) {\n                if (source.isPlayer && oomCheck) {\n                    this.simResult.addRanOutOfManaCount(source, true, this.simulationTime);\n                }\n                return false;\n            }\n            if (source.isPlayer && oomCheck) {\n                this.simResult.addRanOutOfManaCount(source, false, this.simulationTime);\n            }\n            return true;\n        }\n\n        tryUseAbility(source, ability) {\n            if (!this.canUseAbility(source, ability, true)) {\n                return false;\n            }\n\n            if (source.isPlayer) {\n                if (source.abilityManaCosts.has(ability.hrid)) {\n                    source.abilityManaCosts.set(ability.hrid, source.abilityManaCosts.get(ability.hrid) + ability.manaCost);\n                } else {\n                    source.abilityManaCosts.set(ability.hrid, ability.manaCost);\n                }\n            }\n\n            source.combatDetails.currentManapoints -= ability.manaCost;\n\n            ability.lastUsed = this.simulationTime;\n\n            source.combatDetails.combatStats.abilityHaste;\n            ability.cooldownDuration;\n\n            const todoAbilities = [ability];\n\n            if (source.combatDetails.combatStats.blaze > 0 && Math.random() < source.combatDetails.combatStats.blaze) {\n                todoAbilities.push(new Ability('blaze'));\n            }\n\n            if (source.combatDetails.combatStats.bloom > 0 && Math.random() < source.combatDetails.combatStats.bloom) {\n                todoAbilities.push(new Ability('bloom'));\n            }\n\n            for (const todoAbility of todoAbilities) {\n                for (const abilityEffect of todoAbility.abilityEffects) {\n                    switch (abilityEffect.effectType) {\n                        case '/ability_effect_types/buff':\n                            this.processAbilityBuffEffect(source, todoAbility, abilityEffect);\n                            break;\n                        case '/ability_effect_types/damage':\n                            this.processAbilityDamageEffect(source, todoAbility, abilityEffect);\n                            break;\n                        case '/ability_effect_types/heal':\n                            this.processAbilityHealEffect(source, todoAbility, abilityEffect);\n                            break;\n                        case '/ability_effect_types/spend_hp':\n                            this.processAbilitySpendHpEffect(source, todoAbility, abilityEffect);\n                            break;\n                        case '/ability_effect_types/revive':\n                            this.processAbilityReviveEffect(source, todoAbility, abilityEffect);\n                            break;\n                        case '/ability_effect_types/promote':\n                            this.eventQueue.clearEventsForUnit(source);\n                            source = this.processAbilityPromoteEffect(source, todoAbility, abilityEffect);\n                            this.addNextAttackEvent(source);\n                            break;\n                        default:\n                            throw new Error(\n                                'Unsupported effect type for ability: ' +\n                                    todoAbility.hrid +\n                                    ' effectType: ' +\n                                    abilityEffect.effectType\n                            );\n                    }\n                }\n            }\n\n            if (source.combatDetails.combatStats.ripple > 0 && Math.random() < source.combatDetails.combatStats.ripple) {\n                const manapointsAdded = source.addManapoints(10);\n                this.simResult.addManapointsGained(source, 'ripple', manapointsAdded);\n                for (const ab of source.abilities) {\n                    if (ab && ab.lastUsed) {\n                        const remainingCooldown = ab.lastUsed + ab.cooldownDuration - this.simulationTime;\n                        if (remainingCooldown > 0) {\n                            ab.lastUsed = Math.max(ab.lastUsed - ONE_SECOND * 2, this.simulationTime - ab.cooldownDuration);\n                        }\n                    }\n                }\n            }\n\n            this.addNextAttackEvent(source);\n\n            // Could die from reflect damage\n            if (source.combatDetails.currentHitpoints === 0) {\n                this.eventQueue.clearEventsForUnit(source);\n                this.simResult.addDeath(source);\n                if (!source.isPlayer) {\n                    this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);\n                    this.simResult.recordMonsterKill(source.hrid, this.players);\n                }\n            }\n\n            this.checkEncounterEnd();\n\n            return true;\n        }\n\n        processAbilityBuffEffect(source, ability, abilityEffect) {\n            if (abilityEffect.targetType === 'allAllies') {\n                const isOfficialAura = OFFICIAL_AURA_ABILITY_HRIDS.has(ability.hrid);\n                const targets = source.isPlayer ? this.players : this.enemies;\n                for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {\n                    for (const buff of abilityEffect.buffs) {\n                        let appliedBuff = buff;\n                        if (ability.isSpecialAbility && buff.multiplierForSkillHrid && buff.multiplierPerSkillLevel > 0) {\n                            const multiplier =\n                                1.0 +\n                                source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level'] *\n                                    buff.multiplierPerSkillLevel;\n                            const currentBuff = structuredClone(buff);\n                            currentBuff.flatBoost *= multiplier;\n                            currentBuff.ratioBoost *= multiplier;\n                            appliedBuff = currentBuff;\n                        }\n                        if (isOfficialAura) {\n                            target.addAuraBuff(appliedBuff, source.hrid, this.simulationTime);\n                        } else {\n                            target.addBuff(appliedBuff, this.simulationTime);\n                        }\n                        const checkBuffExpirationEvent = new CheckBuffExpirationEvent(\n                            this.simulationTime + buff.duration,\n                            target\n                        );\n                        this.eventQueue.addEvent(checkBuffExpirationEvent);\n                    }\n                }\n                return;\n            }\n\n            if (abilityEffect.targetType !== 'self') {\n                throw new Error('Unsupported target type for buff ability effect: ' + ability.hrid);\n            }\n\n            for (const buff of abilityEffect.buffs) {\n                source.addBuff(buff, this.simulationTime);\n                const checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, source);\n                this.eventQueue.addEvent(checkBuffExpirationEvent);\n            }\n        }\n\n        processAbilityDamageEffect(source, ability, abilityEffect) {\n            let targets;\n            switch (abilityEffect.targetType) {\n                case 'enemy':\n                case 'allEnemies':\n                    targets = source.isPlayer ? this.enemies : this.players;\n                    break;\n                default:\n                    throw new Error('Unsupported target type for damage ability effect: ' + ability.hrid);\n            }\n\n            if (!targets) {\n                return;\n            }\n\n            const avoidTarget = [];\n\n            let isSkipParry = false;\n\n            for (let target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {\n                let parryTarget;\n                if (!isSkipParry) {\n                    parryTarget = this.checkParry(targets);\n                    isSkipParry = true; // parry check only once on first target\n                }\n\n                if (parryTarget) {\n                    const tempTarget = source;\n                    const tempSource = parryTarget;\n\n                    const attackResult = CombatUtilities.processAttack(tempSource, tempTarget);\n\n                    this.simResult.addAttack(\n                        tempSource,\n                        tempTarget,\n                        'parry',\n                        attackResult.didHit ? attackResult.damageDone : 'miss'\n                    );\n\n                    if (attackResult.lifeStealHeal > 0) {\n                        this.simResult.addHitpointsGained(tempSource, 'lifesteal', attackResult.lifeStealHeal);\n                    }\n\n                    if (attackResult.manaLeechMana > 0) {\n                        this.simResult.addManapointsGained(tempSource, 'manaLeech', attackResult.manaLeechMana);\n                    }\n\n                    if (attackResult.thornDamageDone > 0) {\n                        this.simResult.addAttack(\n                            tempTarget,\n                            tempSource,\n                            attackResult.thornType,\n                            attackResult.thornDamageDone\n                        );\n                    }\n                    if (tempTarget.combatDetails.combatStats.retaliation > 0) {\n                        this.simResult.addAttack(\n                            tempTarget,\n                            tempSource,\n                            'retaliation',\n                            attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : 'miss'\n                        );\n                    }\n\n                    if (tempTarget.combatDetails.currentHitpoints === 0) {\n                        this.eventQueue.clearEventsForUnit(tempTarget);\n                        this.simResult.addDeath(tempTarget);\n                        if (!tempTarget.isPlayer) {\n                            this.simResult.updateTimeSpentAlive(tempTarget.hrid, false, this.simulationTime);\n                            this.simResult.recordMonsterKill(tempTarget.hrid, this.players);\n                        }\n                    }\n\n                    // Could die from reflect damage\n                    if (\n                        tempSource.combatDetails.currentHitpoints === 0 &&\n                        (attackResult.thornDamageDone !== 0 || attackResult.retaliationDamageDone !== 0)\n                    ) {\n                        this.eventQueue.clearEventsForUnit(tempSource);\n                        this.simResult.addDeath(tempSource);\n                        if (!tempSource.isPlayer) {\n                            this.simResult.updateTimeSpentAlive(tempSource.hrid, false, this.simulationTime);\n                            this.simResult.recordMonsterKill(tempSource.hrid, this.players);\n                        }\n                    }\n                } else {\n                    targets = targets.filter(\n                        (unit) => unit && !avoidTarget.includes(unit.hrid) && unit.combatDetails.currentHitpoints > 0\n                    );\n                    if (!source.isPlayer && targets.length > 0 && abilityEffect.targetType === 'enemy') {\n                        let cumulativeThreat = 0;\n                        const cumulativeRanges = [];\n                        targets.forEach((player) => {\n                            const playerThreat = player.combatDetails.combatStats.threat;\n                            cumulativeThreat += playerThreat;\n                            cumulativeRanges.push({\n                                player: player,\n                                rangeStart: cumulativeThreat - playerThreat,\n                                rangeEnd: cumulativeThreat,\n                            });\n                        });\n                        const randomValueHit = Math.random() * cumulativeThreat;\n                        target = cumulativeRanges.find(\n                            (range) => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd\n                        ).player;\n                        avoidTarget.push(target.hrid);\n                    }\n                    if (targets.length <= 0) {\n                        break;\n                    }\n\n                    const attackResult = CombatUtilities.processAttack(source, target, abilityEffect);\n\n                    if (this.zone.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {\n                        const log = this.generateCombatLog(source, ability.hrid, target, attackResult);\n                        this.addToWipeLogs(log);\n                    }\n\n                    if (attackResult.hpDrain > 0) {\n                        this.simResult.addHitpointsGained(source, ability.hrid, attackResult.hpDrain);\n                    }\n\n                    if (attackResult.didHit && abilityEffect.buffs) {\n                        for (const buff of abilityEffect.buffs) {\n                            target.addBuff(buff, this.simulationTime);\n                            const checkBuffExpirationEvent = new CheckBuffExpirationEvent(\n                                this.simulationTime + buff.duration,\n                                target\n                            );\n                            this.eventQueue.addEvent(checkBuffExpirationEvent);\n                        }\n                    }\n\n                    if (abilityEffect.damageOverTimeRatio > 0 && attackResult.damageDone > 0) {\n                        const damageOverTimeEvent = new DamageOverTimeEvent(\n                            this.simulationTime + DOT_TICK_INTERVAL,\n                            source,\n                            target,\n                            attackResult.damageDone * abilityEffect.damageOverTimeRatio,\n                            abilityEffect.damageOverTimeDuration / DOT_TICK_INTERVAL,\n                            1,\n                            abilityEffect.combatStyleHrid\n                        );\n                        this.eventQueue.addEvent(damageOverTimeEvent);\n                    }\n\n                    if (\n                        attackResult.didHit &&\n                        abilityEffect.stunChance > 0 &&\n                        Math.random() < (abilityEffect.stunChance * 100) / (100 + target.combatDetails.combatStats.tenacity)\n                    ) {\n                        target.isStunned = true;\n                        target.stunExpireTime = this.simulationTime + abilityEffect.stunDuration;\n                        // Clear all 3 event types via indexed lookups instead of O(n) clearMatching\n                        this.eventQueue.clearByTypeAndSource(AutoAttackEvent.type, target);\n                        this.eventQueue.clearByTypeAndSource(AbilityCastEndEvent.type, target);\n                        this.eventQueue.clearByTypeAndSource(StunExpirationEvent.type, target);\n                        const stunExpirationEvent = new StunExpirationEvent(target.stunExpireTime, target);\n                        this.eventQueue.addEvent(stunExpirationEvent);\n                    }\n\n                    if (\n                        attackResult.didHit &&\n                        abilityEffect.blindChance > 0 &&\n                        Math.random() <\n                            (abilityEffect.blindChance * 100) / (100 + target.combatDetails.combatStats.tenacity)\n                    ) {\n                        target.isBlinded = true;\n                        target.blindExpireTime = this.simulationTime + abilityEffect.blindDuration;\n                        this.eventQueue.clearByTypeAndSource(BlindExpirationEvent.type, target);\n                        if (this.eventQueue.clearByTypeAndSource(AutoAttackEvent.type, target)) {\n                            this.addNextAttackEvent(target);\n                        }\n                        const blindExpirationEvent = new BlindExpirationEvent(target.blindExpireTime, target);\n                        this.eventQueue.addEvent(blindExpirationEvent);\n                    }\n\n                    if (\n                        attackResult.didHit &&\n                        abilityEffect.silenceChance > 0 &&\n                        Math.random() <\n                            (abilityEffect.silenceChance * 100) / (100 + target.combatDetails.combatStats.tenacity)\n                    ) {\n                        target.isSilenced = true;\n                        target.silenceExpireTime = this.simulationTime + abilityEffect.silenceDuration;\n                        this.eventQueue.clearByTypeAndSource(SilenceExpirationEvent.type, target);\n                        if (this.eventQueue.clearByTypeAndSource(AbilityCastEndEvent.type, target)) {\n                            this.addNextAttackEvent(target);\n                        }\n                        const silenceExpirationEvent = new SilenceExpirationEvent(target.silenceExpireTime, target);\n                        this.eventQueue.addEvent(silenceExpirationEvent);\n                    }\n\n                    if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {\n                        const curseExpireTime = 15000000000;\n                        const currentCurseEvent = this.eventQueue.getByTypeAndSource(CurseExpirationEvent.type, target);\n                        let currentCurseAmount = 0;\n                        if (currentCurseEvent) currentCurseAmount = currentCurseEvent.curseAmount;\n                        this.eventQueue.clearByTypeAndSource(CurseExpirationEvent.type, target);\n\n                        const curseExpirationEvent = new CurseExpirationEvent(\n                            this.simulationTime + curseExpireTime,\n                            currentCurseAmount,\n                            target\n                        );\n                        const curseBuff = {\n                            uniqueHrid: '/buff_uniques/curse',\n                            typeHrid: '/buff_types/damage_taken',\n                            ratioBoost: 0,\n                            ratioBoostLevelBonus: 0,\n                            flatBoost: source.combatDetails.combatStats.curse * curseExpirationEvent.curseAmount,\n                            flatBoostLevelBonus: 0,\n                            startTime: '0001-01-01T00:00:00Z',\n                            duration: curseExpireTime,\n                        };\n                        target.addBuff(curseBuff, this.simulationTime);\n                        this.eventQueue.addEvent(curseExpirationEvent);\n                    }\n\n                    if (target.combatDetails.combatStats.weaken > 0) {\n                        const weakenExpireTime = 15000000000;\n                        source.weakenExpireTime = this.simulationTime + weakenExpireTime;\n                        const currentWeakenEvent = this.eventQueue.getByTypeAndSource(WeakenExpirationEvent.type, source);\n                        let weakenAmount = 0;\n                        if (currentWeakenEvent) weakenAmount = currentWeakenEvent.weakenAmount;\n                        this.eventQueue.clearByTypeAndSource(WeakenExpirationEvent.type, source);\n                        const weakenExpirationEvent = new WeakenExpirationEvent(\n                            this.simulationTime + weakenExpireTime,\n                            weakenAmount,\n                            source\n                        );\n                        const weakenBuff = {\n                            uniqueHrid: '/buff_uniques/weaken',\n                            typeHrid: '/buff_types/damage',\n                            ratioBoost: -1 * target.combatDetails.combatStats.weaken * weakenExpirationEvent.weakenAmount,\n                            ratioBoostLevelBonus: 0,\n                            flatBoost: 0,\n                            flatBoostLevelBonus: 0,\n                            startTime: '0001-01-01T00:00:00Z',\n                            duration: weakenExpireTime,\n                        };\n                        source.addBuff(weakenBuff, this.simulationTime);\n                        this.eventQueue.addEvent(weakenExpirationEvent);\n                    }\n\n                    if (source.combatDetails.combatStats.fury > 0) {\n                        this._processFuryUpdate(source, attackResult.didHit);\n                    }\n\n                    this.simResult.addAttack(\n                        source,\n                        target,\n                        ability.hrid,\n                        attackResult.didHit ? attackResult.damageDone : 'miss'\n                    );\n\n                    if (attackResult.thornDamageDone > 0) {\n                        this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);\n                    }\n                    if (this.zone.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {\n                        const log = this.buildCombatLog(\n                            target,\n                            attackResult.thornType,\n                            source,\n                            attackResult.thornDamageDone\n                        );\n                        this.addToWipeLogs(log);\n                    }\n\n                    if (target.combatDetails.combatStats.retaliation > 0) {\n                        this.simResult.addAttack(\n                            target,\n                            source,\n                            'retaliation',\n                            attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : 'miss'\n                        );\n                    }\n                    if (this.zone.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {\n                        const log = this.buildCombatLog(target, 'retaliation', source, attackResult.retaliationDamageDone);\n                        this.addToWipeLogs(log);\n                    }\n\n                    if (target.combatDetails.currentHitpoints === 0) {\n                        this.eventQueue.clearEventsForUnit(target);\n                        this.simResult.addDeath(target);\n                        if (!target.isPlayer) {\n                            this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);\n                            this.simResult.recordMonsterKill(target.hrid, this.players);\n                        }\n                    }\n\n                    if (attackResult.didHit && abilityEffect.pierceChance > Math.random()) {\n                        continue;\n                    }\n                }\n\n                if (parryTarget) {\n                    break;\n                }\n\n                if (abilityEffect.targetType === 'enemy') {\n                    break;\n                }\n            }\n        }\n\n        processAbilityHealEffect(source, ability, abilityEffect) {\n            if (abilityEffect.targetType === 'allAllies') {\n                const targets = source.isPlayer ? this.players : this.enemies;\n                for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {\n                    const amountHealed = CombatUtilities.processHeal(source, abilityEffect, target);\n                    this.simResult.addHitpointsGained(target, ability.hrid, amountHealed);\n                }\n                return;\n            }\n\n            if (abilityEffect.targetType === 'lowestHpAlly') {\n                const targets = source.isPlayer ? this.players : this.enemies;\n                let healTarget;\n                for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {\n                    if (!healTarget) {\n                        healTarget = target;\n                        continue;\n                    }\n                    if (\n                        target.combatDetails.currentHitpoints / target.combatDetails.maxHitpoints <\n                        healTarget.combatDetails.currentHitpoints / healTarget.combatDetails.maxHitpoints\n                    ) {\n                        healTarget = target;\n                    }\n                }\n\n                if (healTarget) {\n                    const amountHealed = CombatUtilities.processHeal(source, abilityEffect, healTarget);\n                    this.simResult.addHitpointsGained(healTarget, ability.hrid, amountHealed);\n                }\n                return;\n            }\n\n            if (abilityEffect.targetType !== 'self') {\n                throw new Error('Unsupported target type for heal ability effect: ' + ability.hrid);\n            }\n\n            const amountHealed = CombatUtilities.processHeal(source, abilityEffect, source);\n            this.simResult.addHitpointsGained(source, ability.hrid, amountHealed);\n        }\n\n        /**\n         * Death (via eventQueue.clearEventsForUnit) removes every scheduled event for the dying unit,\n         * including CheckBuffExpirationEvents for buffs that were still legitimately active. Re-schedule\n         * expiration for any surviving buff at its original absolute expiry so it cannot outlive its\n         * intended duration after revive.\n         * @param {CombatUnit} unit\n         */\n        _rescheduleSurvivingBuffExpirations(unit) {\n            Object.values(unit.combatBuffs).forEach((buff) => {\n                const remaining = buff.startTime + buff.duration - this.simulationTime;\n                if (Number.isFinite(remaining) && remaining > 0) {\n                    this.eventQueue.addEvent(new CheckBuffExpirationEvent(this.simulationTime + remaining, unit));\n                }\n            });\n        }\n\n        /**\n         * A current-character personal/scroll combat buff with no remaining-lifetime evidence is\n         * kept permanent (today's status-quo behavior) - added alongside generatePermanentBuffs()\n         * so it is baked into the combatBuffs snapshot the upcoming reset()/clearBuffs() copies from\n         * permanentBuffs (CSIM-AUD-019). Each entry is judged independently (TLA-039 defect C) - a\n         * timed sibling elsewhere in the same list never makes this one permanent or vice versa.\n         * @param {Player} player\n         */\n        _applyPersonalPermanentCombatBuffs(player) {\n            const entries = player.personalCombatBuffs?.buffs;\n            if (!entries?.length) return;\n            entries\n                .filter((entry) => entry.remainingDurationNs == null)\n                .forEach((entry) => player.addPermanentBuff(entry.buff));\n        }\n\n        /**\n         * A current-character personal/scroll combat buff with known remaining lifetime is modeled as\n         * a timed buff for exactly that many nanoseconds of simulated time, then expires on the same\n         * logical timeline - never as an eternal permanent buff. Applied AFTER reset()/clearBuffs()\n         * so it is not wiped by the permanentBuffs snapshot copy (CSIM-AUD-019). Each entry keeps its\n         * own independently-resolved duration (TLA-039 defect C) - one buff's expiry is never borrowed\n         * for another, so a 20m buff outlives a 10m buff exactly as their own evidence says.\n         * @param {Player} player\n         */\n        _applyPersonalTimedCombatBuffs(player) {\n            const entries = player.personalCombatBuffs?.buffs;\n            if (!entries?.length) return;\n            entries.forEach((entry, index) => {\n                if (entry.remainingDurationNs == null) return;\n                const buff = entry.buff;\n                const timedBuff = {\n                    uniqueHrid: buff.uniqueHrid || `/buff_uniques/personal_combat_${index}`,\n                    typeHrid: buff.typeHrid,\n                    ratioBoost: buff.ratioBoost || 0,\n                    flatBoost: buff.flatBoost || 0,\n                    duration: entry.remainingDurationNs,\n                };\n                player.addBuff(timedBuff, this.simulationTime);\n                this.eventQueue.addEvent(\n                    new CheckBuffExpirationEvent(this.simulationTime + entry.remainingDurationNs, player)\n                );\n            });\n        }\n\n        processAbilityReviveEffect(source, ability, abilityEffect) {\n            if (abilityEffect.targetType !== 'deadAlly') {\n                throw new Error('Unsupported target type for revive ability effect: ' + ability.hrid);\n            }\n\n            const targets = source.isPlayer ? this.players : this.enemies;\n            const reviveTarget = targets.find((unit) => unit && unit.combatDetails.currentHitpoints <= 0);\n\n            if (reviveTarget) {\n                this.eventQueue.clearByTypeAndHrid(PlayerRespawnEvent.type, reviveTarget.hrid);\n\n                reviveTarget.removeExpiredBuffs(this.simulationTime);\n                this._rescheduleSurvivingBuffExpirations(reviveTarget);\n\n                const amountHealed = CombatUtilities.processRevive(source, abilityEffect, reviveTarget);\n                this.simResult.addHitpointsGained(reviveTarget, ability.hrid, amountHealed);\n\n                this.addNextAttackEvent(reviveTarget);\n\n                if (!source.isPlayer) {\n                    this.simResult.updateTimeSpentAlive(reviveTarget.hrid, true, this.simulationTime);\n                }\n            }\n        }\n\n        processAbilityPromoteEffect(source, _ability, _abilityEffect) {\n            const promotionHrids = ['/monsters/enchanted_rook', '/monsters/enchanted_knight', '/monsters/enchanted_bishop'];\n            const randomPromotionIndex = Math.floor(Math.random() * promotionHrids.length);\n            return new Monster(promotionHrids[randomPromotionIndex], source.difficultyTier);\n        }\n\n        processAbilitySpendHpEffect(source, ability, abilityEffect) {\n            if (abilityEffect.targetType !== 'self') {\n                throw new Error('Unsupported target type for spend hp ability effect: ' + ability.hrid);\n            }\n\n            const hpSpent = CombatUtilities.processSpendHp(source, abilityEffect);\n            this.simResult.addHitpointsSpent(source, ability.hrid, hpSpent);\n        }\n    }\n\n    const LABYRINTH_TIMEOUT = 120 * 1e9; // 120 seconds in nanoseconds\n\n    /**\n     * Labyrinth encounter manager.\n     * Each encounter is a single monster at a given roomLevel.\n     * Timeout (120s) or player death = loss; enemy killed = win.\n     */\n    class Labyrinth {\n        /**\n         * @param {string} monsterHrid\n         * @param {number} roomLevel\n         * @param {string[]} [crateHrids]\n         * @param {number|null} [maxAttempts] - When set, the simulation stops once this many attempts\n         *   have finished (won, timed out, or died) instead of running to a time horizon.\n         */\n        constructor(monsterHrid, roomLevel, crateHrids = [], maxAttempts = null) {\n            this.monsterHrid = monsterHrid;\n            this.hrid = monsterHrid;\n            this.roomLevel = roomLevel;\n            this.buffs = [];\n            this.attemptCount = 0;\n            this.maxAttempts = maxAttempts > 0 ? maxAttempts : null;\n            this.completedAttempts = 0;\n            this.encounterStartTime = 0;\n\n            // Resolve crate buffs from game data\n            if (crateHrids.length > 0) {\n                const gameData = getGameData();\n                const crateMap = gameData.labyrinthCrateDetailMap;\n                if (crateMap) {\n                    for (const hrid of crateHrids) {\n                        if (crateMap[hrid]) {\n                            this.buffs = this.buffs.concat(crateMap[hrid]);\n                        }\n                    }\n                }\n            }\n        }\n\n        /**\n         * Spawn a new monster for the next encounter.\n         * @returns {Monster[]} Single-element array with the scaled monster\n         */\n        getMonster() {\n            this.attemptCount++;\n            return [new Monster(this.monsterHrid, 0, this.roomLevel)];\n        }\n\n        /**\n         * Record that an attempt finished with a definite outcome (win, timeout, or death). An\n         * attempt still in progress when a time horizon ends is never counted here.\n         */\n        recordOutcome() {\n            this.completedAttempts++;\n        }\n\n        /**\n         * Whether an attempt-count run has finished all of its attempts.\n         * @returns {boolean}\n         */\n        hasReachedAttemptCap() {\n            return this.maxAttempts !== null && this.completedAttempts >= this.maxAttempts;\n        }\n\n        /**\n         * Record when a new encounter begins.\n         * @param {number} time - Current simulation time in nanoseconds\n         */\n        updateEncounterStartTime(time) {\n            this.encounterStartTime = time;\n        }\n\n        /**\n         * Check if the current encounter has exceeded the 120s timeout.\n         * @param {number} currentTime - Current simulation time in nanoseconds\n         * @returns {boolean}\n         */\n        checkTimeout(currentTime) {\n            return currentTime - this.encounterStartTime > LABYRINTH_TIMEOUT;\n        }\n    }\n\n    /**\n     * Achievement Tier buffs are derived entirely from live game data (TLA-044): a tier's buff applies\n     * only when every achievement belonging to that tier (per achievementDetailMap's tierHrid) is\n     * completed for this specific player, and only when the tier itself is usable in\n     * /action_types/combat (per achievementTierDetailMap's usableInActionTypeMap). Mirrors the\n     * existing data-driven Shrine pattern - never a hardcoded Novice/Veteran/Elite list, HRID, or\n     * boost value.\n     */\n    class Achievement {\n        constructor(characterAchievements) {\n            const gameData = getGameData();\n            const achievementDetailMap = gameData.achievementDetailMap || {};\n            const achievementTierDetailMap = gameData.achievementTierDetailMap || {};\n\n            const completedHrids = new Set();\n            for (const achievement of characterAchievements || []) {\n                if (achievement?.isCompleted && achievement.achievementHrid) {\n                    completedHrids.add(achievement.achievementHrid);\n                }\n            }\n\n            const tierTotals = new Map();\n            const tierCompleted = new Map();\n            for (const [achievementHrid, detail] of Object.entries(achievementDetailMap)) {\n                const tierHrid = detail?.tierHrid;\n                if (!tierHrid) continue;\n                tierTotals.set(tierHrid, (tierTotals.get(tierHrid) || 0) + 1);\n                if (completedHrids.has(achievementHrid)) {\n                    tierCompleted.set(tierHrid, (tierCompleted.get(tierHrid) || 0) + 1);\n                }\n            }\n\n            this.buffs = [];\n            for (const [tierHrid, tierDetail] of Object.entries(achievementTierDetailMap)) {\n                if (!tierDetail?.buff) continue;\n                if (!tierDetail.usableInActionTypeMap?.['/action_types/combat']) continue;\n\n                // A tier with no resolvable achievement members must never vacuously grant its buff.\n                const total = tierTotals.get(tierHrid) || 0;\n                if (total === 0) continue;\n\n                const completed = tierCompleted.get(tierHrid) || 0;\n                if (completed !== total) continue;\n\n                this.buffs.push(new Buff(tierDetail.buff));\n            }\n        }\n    }\n\n    class Consumable {\n        constructor(hrid, triggers = null) {\n            this.hrid = hrid;\n\n            const itemDetailMap = getGameData().itemDetailMap;\n            const gameConsumable = itemDetailMap[this.hrid];\n            if (!gameConsumable) {\n                throw new Error('No consumable found for hrid: ' + this.hrid);\n            }\n\n            this.cooldownDuration = gameConsumable.consumableDetail.cooldownDuration;\n            this.hitpointRestore = gameConsumable.consumableDetail.hitpointRestore;\n            this.manapointRestore = gameConsumable.consumableDetail.manapointRestore;\n            this.recoveryDuration = gameConsumable.consumableDetail.recoveryDuration;\n            this.catagoryHrid = gameConsumable.categoryHrid;\n\n            this.buffs = [];\n            if (gameConsumable.consumableDetail.buffs) {\n                for (const consumableBuff of gameConsumable.consumableDetail.buffs) {\n                    const buff = new Buff(consumableBuff);\n                    this.buffs.push(buff);\n                }\n            }\n\n            if (triggers) {\n                this.triggers = triggers;\n            } else {\n                this.triggers = [];\n                for (const defaultTrigger of gameConsumable.consumableDetail.defaultCombatTriggers) {\n                    const trigger = new Trigger(\n                        defaultTrigger.dependencyHrid,\n                        defaultTrigger.conditionHrid,\n                        defaultTrigger.comparatorHrid,\n                        defaultTrigger.value\n                    );\n                    this.triggers.push(trigger);\n                }\n            }\n\n            this.lastUsed = Number.MIN_SAFE_INTEGER;\n        }\n\n        static createFromDTO(dto) {\n            const triggers = dto.triggers ? dto.triggers.map((trigger) => Trigger.createFromDTO(trigger)) : null;\n            const consumable = new Consumable(dto.hrid, triggers);\n\n            return consumable;\n        }\n\n        shouldTrigger(currentTime, source, target, friendlies, enemies) {\n            if (source.isStunned) {\n                return false;\n            }\n            let consumableHaste;\n            if (this.catagoryHrid.includes('food')) {\n                consumableHaste = source.combatDetails.combatStats.foodHaste;\n            } else {\n                consumableHaste = source.combatDetails.combatStats.drinkConcentration;\n            }\n            let cooldownDuration = this.cooldownDuration;\n            if (consumableHaste > 0) {\n                cooldownDuration = cooldownDuration / (1 + consumableHaste);\n            }\n\n            if (this.lastUsed + cooldownDuration > currentTime) {\n                return false;\n            }\n\n            if (this.triggers.length === 0) {\n                return true;\n            }\n\n            let shouldTrigger = true;\n            for (const trigger of this.triggers) {\n                if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {\n                    shouldTrigger = false;\n                }\n            }\n\n            return shouldTrigger;\n        }\n    }\n\n    class Equipment {\n        constructor(hrid, enhancementLevel) {\n            this.hrid = hrid;\n            const gameData = getGameData();\n            const gameItem = gameData.itemDetailMap[this.hrid];\n            if (!gameItem) {\n                throw new Error('No equipment found for hrid: ' + this.hrid);\n            }\n            this.gameItem = gameItem;\n            this.enhancementLevel = enhancementLevel;\n        }\n\n        static createFromDTO(dto) {\n            const equipment = new Equipment(dto.hrid, dto.enhancementLevel);\n\n            return equipment;\n        }\n\n        getCombatStat(combatStat) {\n            const gameData = getGameData();\n            const multiplier = gameData.enhancementLevelTotalBonusMultiplierTable[this.enhancementLevel];\n            if (this.gameItem.equipmentDetail.combatStats[combatStat]) {\n                const enhancementBonus = this.gameItem.equipmentDetail.combatEnhancementBonuses[combatStat] || 0;\n                const stat = this.gameItem.equipmentDetail.combatStats[combatStat] + multiplier * enhancementBonus;\n                return stat;\n            }\n            return 0;\n        }\n\n        getCombatStyle() {\n            return this.gameItem.equipmentDetail.combatStats.combatStyleHrids[0];\n        }\n\n        getDamageType() {\n            return this.gameItem.equipmentDetail.combatStats.damageType;\n        }\n\n        getPrimaryTraining() {\n            return this.gameItem.equipmentDetail.combatStats.primaryTraining;\n        }\n\n        getFocusTraining() {\n            return this.gameItem.equipmentDetail.combatStats.focusTraining;\n        }\n    }\n\n    /**\n     * A house room applies two kinds of buffs from the game's own houseRoomDetailMap:\n     * - actionBuffs: only meaningful for the room's own skill (e.g. Observatory's action_speed is\n     *   for Enhancing). The game data itself only marks this restriction at the room level, via\n     *   `usableInActionTypeMap` - individual buff entries carry no such field - so this class is a\n     *   combat unit, and must only include actionBuffs for a room whose usableInActionTypeMap\n     *   includes /action_types/combat (e.g. Armory, Dojo). Skilling-only rooms (Observatory,\n     *   Laboratory, Sewing Parlor, Workshop, etc.) contribute none.\n     * - globalBuffs: always wisdom + rare_find, with no action-type restriction in the game's own\n     *   data - these apply from every room regardless of its skill.\n     */\n    class HouseRoom {\n        constructor(hrid, level) {\n            this.hrid = hrid;\n            this.level = level;\n\n            const gameData = getGameData();\n            const gameHouseRoom = gameData.houseRoomDetailMap[this.hrid];\n            if (!gameHouseRoom) {\n                throw new Error('No house room found for hrid: ' + this.hrid);\n            }\n\n            this.buffs = [];\n            if (gameHouseRoom.actionBuffs && gameHouseRoom.usableInActionTypeMap?.['/action_types/combat']) {\n                for (const actionBuff of gameHouseRoom.actionBuffs) {\n                    const buff = new Buff(actionBuff, level);\n                    this.buffs.push(buff);\n                }\n            }\n            if (gameHouseRoom.globalBuffs) {\n                for (const globalBuff of gameHouseRoom.globalBuffs) {\n                    const buff = new Buff(globalBuff, level);\n                    this.buffs.push(buff);\n                }\n            }\n        }\n    }\n\n    /**\n     * A guild Shrine applies combat buffs constructed generically from the game's own\n     * guildBuffDetailMap, never a hardcoded shrine-specific formula. `guildBuffDetailMap` entries are\n     * grouped by `shrineHrid` and flagged `isCombat` - a shrine can have more than one combat buff\n     * entry (e.g. Tempo has attack_speed and cast_speed), so every matching entry contributes.\n     */\n    class Shrine {\n        constructor(hrid, level) {\n            this.hrid = hrid;\n            this.level = level;\n\n            const gameData = getGameData();\n            const guildBuffDetailMap = gameData.guildBuffDetailMap || {};\n\n            this.buffs = [];\n            for (const guildBuff of Object.values(guildBuffDetailMap)) {\n                if (guildBuff.shrineHrid !== hrid || !guildBuff.isCombat) continue;\n                for (const rawBuff of guildBuff.buffs || []) {\n                    this.buffs.push(new Buff(rawBuff, level));\n                }\n            }\n        }\n    }\n\n    class Player extends CombatUnit {\n        equipment = {\n            '/equipment_types/head': null,\n            '/equipment_types/body': null,\n            '/equipment_types/legs': null,\n            '/equipment_types/feet': null,\n            '/equipment_types/hands': null,\n            '/equipment_types/main_hand': null,\n            '/equipment_types/two_hand': null,\n            '/equipment_types/off_hand': null,\n            '/equipment_types/pouch': null,\n            '/equipment_types/back': null,\n            '/equipment_types/neck': null,\n            '/equipment_types/earrings': null,\n            '/equipment_types/ring': null,\n            '/equipment_types/charm': null,\n        };\n\n        constructor() {\n            super();\n\n            this.isPlayer = true;\n            this.hrid = 'player';\n        }\n\n        static createFromDTO(dto) {\n            const player = new Player();\n\n            player.staminaLevel = dto.staminaLevel;\n            player.intelligenceLevel = dto.intelligenceLevel;\n            player.attackLevel = dto.attackLevel;\n            player.meleeLevel = dto.meleeLevel;\n            player.defenseLevel = dto.defenseLevel;\n            player.rangedLevel = dto.rangedLevel;\n            player.magicLevel = dto.magicLevel;\n\n            player.hrid = dto.hrid;\n\n            for (const [key, value] of Object.entries(dto.equipment)) {\n                player.equipment[key] = value ? Equipment.createFromDTO(value) : null;\n            }\n\n            player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));\n            player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));\n            player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));\n            Object.entries(dto.houseRooms).forEach((houseRoom) => {\n                if (houseRoom[1] > 0) {\n                    player.houseRooms.push(new HouseRoom(houseRoom[0], houseRoom[1]));\n                }\n            });\n            Object.entries(dto.shrineLevels || {}).forEach(([shrineHrid, level]) => {\n                if (level > 0) {\n                    player.shrines.push(new Shrine(shrineHrid, level));\n                }\n            });\n\n            player.debuffOnLevelGap = dto.debuffOnLevelGap;\n            player.personalCombatBuffs = dto.personalCombatBuffs || { buffs: [] };\n            player.characterAchievements = dto.characterAchievements || [];\n            player.achievements = new Achievement(player.characterAchievements);\n            // Active Monster-task target hrids (CSIM-AUD-023) - explicitly empty/unknown for imported\n            // party members whose task state is unavailable, never inherited from another player.\n            player.taskEligibleMonsterHrids = dto.taskEligibleMonsterHrids || [];\n\n            return player;\n        }\n\n        updateCombatDetails() {\n            if (this.equipment['/equipment_types/main_hand']) {\n                this.combatDetails.combatStats.combatStyleHrid =\n                    this.equipment['/equipment_types/main_hand'].getCombatStyle();\n                this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/main_hand'].getDamageType();\n                this.combatDetails.combatStats.attackInterval =\n                    this.equipment['/equipment_types/main_hand'].getCombatStat('attackInterval');\n                this.combatDetails.combatStats.primaryTraining =\n                    this.equipment['/equipment_types/main_hand'].getPrimaryTraining();\n            } else if (this.equipment['/equipment_types/two_hand']) {\n                this.combatDetails.combatStats.combatStyleHrid =\n                    this.equipment['/equipment_types/two_hand'].getCombatStyle();\n                this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/two_hand'].getDamageType();\n                this.combatDetails.combatStats.attackInterval =\n                    this.equipment['/equipment_types/two_hand'].getCombatStat('attackInterval');\n                this.combatDetails.combatStats.primaryTraining =\n                    this.equipment['/equipment_types/two_hand'].getPrimaryTraining();\n            } else {\n                this.combatDetails.combatStats.combatStyleHrid = '/combat_styles/smash';\n                this.combatDetails.combatStats.damageType = '/damage_types/physical';\n                this.combatDetails.combatStats.attackInterval = 3000000000;\n                this.combatDetails.combatStats.primaryTraining = '/skills/melee';\n            }\n\n            if (this.equipment['/equipment_types/charm']) {\n                this.combatDetails.combatStats.focusTraining = this.equipment['/equipment_types/charm'].getFocusTraining();\n            } else {\n                this.combatDetails.combatStats.focusTraining = '';\n            }\n\n            [\n                'stabAccuracy',\n                'slashAccuracy',\n                'smashAccuracy',\n                'rangedAccuracy',\n                'magicAccuracy',\n                'stabDamage',\n                'slashDamage',\n                'smashDamage',\n                'rangedDamage',\n                'magicDamage',\n                'defensiveDamage',\n                'taskDamage',\n                'physicalAmplify',\n                'waterAmplify',\n                'natureAmplify',\n                'fireAmplify',\n                'healingAmplify',\n                'stabEvasion',\n                'slashEvasion',\n                'smashEvasion',\n                'rangedEvasion',\n                'magicEvasion',\n                'armor',\n                'waterResistance',\n                'natureResistance',\n                'fireResistance',\n                'maxHitpoints',\n                'maxManapoints',\n                'lifeSteal',\n                'hpRegenPer10',\n                'mpRegenPer10',\n                'physicalThorns',\n                'elementalThorns',\n                'combatDropRate',\n                'combatRareFind',\n                'combatDropQuantity',\n                'combatExperience',\n                'criticalRate',\n                'criticalDamage',\n                'armorPenetration',\n                'waterPenetration',\n                'naturePenetration',\n                'firePenetration',\n                'abilityHaste',\n                'tenacity',\n                'manaLeech',\n                'castSpeed',\n                'threat',\n                'parry',\n                'mayhem',\n                'pierce',\n                'curse',\n                'fury',\n                'weaken',\n                'ripple',\n                'bloom',\n                'blaze',\n                'attackSpeed',\n                'foodHaste',\n                'drinkConcentration',\n                'autoAttackDamage',\n                'abilityDamage',\n                'staminaExperience',\n                'intelligenceExperience',\n                'attackExperience',\n                'defenseExperience',\n                'meleeExperience',\n                'rangedExperience',\n                'magicExperience',\n                'retaliation',\n                'maxHitpointsRatio',\n                'maxManapointsRatio',\n            ].forEach((stat) => {\n                this.combatDetails.combatStats[stat] = Object.values(this.equipment)\n                    .filter((equipment) => equipment != null)\n                    .map((equipment) => equipment.getCombatStat(stat))\n                    .reduce((prev, cur) => prev + cur, 0);\n            });\n\n            if (this.equipment['/equipment_types/pouch']) {\n                this.combatDetails.combatStats.foodSlots =\n                    1 + this.equipment['/equipment_types/pouch'].getCombatStat('foodSlots');\n                this.combatDetails.combatStats.drinkSlots =\n                    1 + this.equipment['/equipment_types/pouch'].getCombatStat('drinkSlots');\n            } else {\n                this.combatDetails.combatStats.foodSlots = 1;\n                this.combatDetails.combatStats.drinkSlots = 1;\n            }\n\n            super.updateCombatDetails();\n        }\n    }\n\n    class Zone {\n        constructor(hrid, difficultyTier) {\n            this.hrid = hrid;\n            this.difficultyTier = difficultyTier;\n\n            const actionDetailMap = getGameData().actionDetailMap;\n            const gameZone = actionDetailMap[this.hrid];\n            this.monsterSpawnInfo = gameZone.combatZoneInfo.fightInfo;\n            this.dungeonSpawnInfo = gameZone.combatZoneInfo.dungeonInfo;\n            this.encountersKilled = 1;\n            this.buffs = gameZone.buffs;\n            this.isDungeon = gameZone.combatZoneInfo.isDungeon;\n            this.dungeonsCompleted = 0;\n            this.dungeonsFailed = 0;\n            this.finalWave = false;\n\n            if (this.monsterSpawnInfo) {\n                this.monsterSpawnInfo.battlesPerBoss = 10;\n            }\n        }\n\n        getRandomEncounter() {\n            if (!this.monsterSpawnInfo) {\n                return [];\n            }\n\n            if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled === this.monsterSpawnInfo.battlesPerBoss) {\n                this.encountersKilled = 1;\n                return this.monsterSpawnInfo.bossSpawns.map(\n                    (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)\n                );\n            }\n\n            if (!this.monsterSpawnInfo.randomSpawnInfo || !this.monsterSpawnInfo.randomSpawnInfo.spawns) {\n                this.encountersKilled++;\n                return [];\n            }\n\n            const totalWeight = this.monsterSpawnInfo.randomSpawnInfo.spawns.reduce((prev, cur) => prev + cur.rate, 0);\n\n            const encounterHrids = [];\n            let totalStrength = 0;\n\n            outer: for (let i = 0; i < this.monsterSpawnInfo.randomSpawnInfo.maxSpawnCount; i++) {\n                const randomWeight = totalWeight * Math.random();\n                let cumulativeWeight = 0;\n\n                for (const spawn of this.monsterSpawnInfo.randomSpawnInfo.spawns) {\n                    cumulativeWeight += spawn.rate;\n                    if (randomWeight <= cumulativeWeight) {\n                        totalStrength += spawn.strength;\n\n                        if (totalStrength <= this.monsterSpawnInfo.randomSpawnInfo.maxTotalStrength) {\n                            encounterHrids.push({ hrid: spawn.combatMonsterHrid, difficultyTier: spawn.difficultyTier });\n                        } else {\n                            break outer;\n                        }\n                        break;\n                    }\n                }\n            }\n            this.encountersKilled++;\n            return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.difficultyTier + this.difficultyTier));\n        }\n\n        failWave() {\n            this.dungeonsFailed++;\n            this.encountersKilled = 1;\n        }\n\n        getNextWave() {\n            const waveNum = this.encountersKilled;\n            const fixedSpawns = this.dungeonSpawnInfo.fixedSpawnsMap[waveNum.toString()];\n\n            if (fixedSpawns) {\n                this.encountersKilled++;\n                return fixedSpawns.map(\n                    (monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier)\n                );\n            }\n\n            // Random spawn path\n            const randomSpawnInfoMap = this.dungeonSpawnInfo.randomSpawnInfoMap;\n\n            if (!randomSpawnInfoMap || typeof randomSpawnInfoMap !== 'object') {\n                this.encountersKilled++;\n                return [];\n            }\n\n            const waveKeys = Object.keys(randomSpawnInfoMap)\n                .map(Number)\n                .sort((a, b) => a - b);\n\n            if (waveKeys.length === 0) {\n                this.encountersKilled++;\n                return [];\n            }\n\n            let monsterSpawns = null;\n\n            if (waveNum >= waveKeys[waveKeys.length - 1]) {\n                monsterSpawns = randomSpawnInfoMap[waveKeys[waveKeys.length - 1]];\n            } else {\n                for (let i = 0; i < waveKeys.length - 1; i++) {\n                    if (waveNum >= waveKeys[i] && waveNum < waveKeys[i + 1]) {\n                        monsterSpawns = randomSpawnInfoMap[waveKeys[i]];\n                        break;\n                    }\n                }\n            }\n\n            // Fallback to first available spawn info if no range matched\n            if (!monsterSpawns || !monsterSpawns.spawns) {\n                monsterSpawns = randomSpawnInfoMap[waveKeys[0]];\n            }\n\n            // Final safety — if still broken, skip wave instead of crashing\n            if (!monsterSpawns?.spawns) {\n                this.encountersKilled++;\n                return [];\n            }\n\n            const totalWeight = monsterSpawns.spawns.reduce((prev, cur) => prev + cur.rate, 0);\n\n            const encounterHrids = [];\n            let totalStrength = 0;\n\n            outer: for (let i = 0; i < monsterSpawns.maxSpawnCount; i++) {\n                const randomWeight = totalWeight * Math.random();\n                let cumulativeWeight = 0;\n\n                for (const spawn of monsterSpawns.spawns) {\n                    cumulativeWeight += spawn.rate;\n                    if (randomWeight <= cumulativeWeight) {\n                        totalStrength += spawn.strength;\n\n                        if (totalStrength <= monsterSpawns.maxTotalStrength) {\n                            encounterHrids.push({\n                                hrid: spawn.combatMonsterHrid,\n                                difficultyTier: spawn.difficultyTier,\n                            });\n                        } else {\n                            break outer;\n                        }\n                        break;\n                    }\n                }\n            }\n            this.encountersKilled++;\n            return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.difficultyTier + this.difficultyTier));\n        }\n    }\n\n    /**\n     * Combat Simulator Worker Entry\n     *\n     * This file is bundled into a string at build time by the workerBundlePlugin\n     * and runs inside a Web Worker. It receives simulation parameters via\n     * postMessage and returns results.\n     */\n\n\n    onmessage = function (event) {\n        const { type, taskId } = event.data;\n\n        if (type !== 'start_simulation') return;\n\n        try {\n            const {\n                gameData,\n                playerDTOs,\n                zoneHrid,\n                difficultyTier,\n                simulationTimeLimit,\n                extraBuffsByPlayer,\n                labyrinth: labyrinthData,\n            } = event.data;\n\n            // Set game data for the engine singleton\n            setGameData(gameData);\n\n            // Create Zone (used as fallback even in labyrinth mode for SimResult constructor)\n            const zone = new Zone(zoneHrid, difficultyTier);\n\n            // Create Labyrinth if specified\n            let labyrinth = null;\n            if (labyrinthData) {\n                labyrinth = new Labyrinth(\n                    labyrinthData.monsterHrid,\n                    labyrinthData.roomLevel,\n                    labyrinthData.crates || [],\n                    labyrinthData.maxAttempts || null\n                );\n            }\n\n            // Create Players\n            const players = playerDTOs.map((dto) => {\n                const cloned = structuredClone(dto);\n                if (labyrinth) {\n                    cloned.food = cloned.food.map(() => null);\n                    cloned.drinks = cloned.drinks.map(() => null);\n                }\n                const player = Player.createFromDTO(cloned);\n                // Labyrinth: crate buffs go to zoneBuffs; otherwise use zone buffs\n                player.zoneBuffs = labyrinth ? labyrinth.buffs : zone.buffs;\n                // Each player owns its own extraBuffs array (CSIM-AUD-019/020) - never one shared\n                // reference applied identically to every player.\n                player.extraBuffs = extraBuffsByPlayer?.[player.hrid] || [];\n                return player;\n            });\n\n            // Create simulator with progress callback\n            const combatSimulator = new CombatSimulator(\n                players,\n                zone,\n                (progressData) => {\n                    postMessage({\n                        type: 'progress',\n                        taskId,\n                        progress: Math.round(progressData.progress * 100),\n                    });\n                },\n                labyrinth\n            );\n\n            // Run simulation\n            const simResult = combatSimulator.simulate(simulationTimeLimit);\n\n            postMessage({\n                type: 'result',\n                taskId,\n                simResult,\n            });\n        } catch (error) {\n            postMessage({\n                type: 'error',\n                taskId,\n                error: error.message || String(error),\n            });\n        }\n    };\n\n})();\n";

    /**
     * Combat Simulator Runner
     * Runs one logical stateful simulation timeline in one Web Worker.
     *
     * Independent targets/zones may still be parallelized by their higher-level runners
     * (see all-zones-runner.js), but elapsed time from one stateful simulation must never
     * be split across fresh worker replicas and merged as if it were one timeline - buffs,
     * cooldowns, consumables, Fury, and OOM windows would silently reset at each split.
     */


    let workerBlobURL = null;
    let taskIdCounter = 0;

    // Checked against the production bundles by scripts/check-combat-sim-singleton.js: this worker state
    // must exist in exactly one library (toolasha-sim.js).
    const RUNNER_STATE_IMPLEMENTATION_ID = 'toolasha-sim-runner-state-v1';

    // Worker slots are scoped by channel. Starting a run cancels whatever is in flight on ITS channel
    // only, so independent features never abort each other's simulations. The Combat Sim UIs and the
    // labyrinth tools share the default channel (as they always have); the task estimates use their own.
    // This runner is now a single shared copy, so the isolation the task features used to get by
    // bundling their own copy of it has to be explicit.
    const CHANNEL_DEFAULT = 'default';
    const CHANNEL_TASKS = 'tasks';
    const slots = new Map(); // channel -> { workers: Worker[], rejects: Function[] }

    function getSlot(channel = CHANNEL_DEFAULT) {
        let slot = slots.get(channel);
        if (!slot) {
            slot = { workers: [], rejects: [] };
            slots.set(channel, slot);
        }
        return slot;
    }

    /**
     * Get or create the worker Blob URL (created once, reused).
     * @returns {string}
     */
    function getWorkerURL() {
        if (!workerBlobURL) {
            const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
            workerBlobURL = URL.createObjectURL(blob);
        }
        return workerBlobURL;
    }

    /**
     * Build one player's extra (non-house, non-shrine) buffs: genuinely global community buffs plus
     * that player's own MooPass status. Guild Shrine buffs are no longer carried here - they are
     * constructed generically by the engine's Shrine class from each player's own `shrineLevels`
     * (CSIM-AUD-021/UI-002), so there is exactly one canonical path and no double application.
     * @param {Object} communityBuffs - { comExp, comDrop } (genuinely server-wide, shared by every player)
     * @param {boolean} [hasMooPass] - Whether THIS specific player has MooPass active
     * @returns {Array<Object>}
     */
    function buildExtraBuffs(communityBuffs, hasMooPass) {
        const extraBuffs = [];

        if (hasMooPass) {
            extraBuffs.push({
                uniqueHrid: '/buff_uniques/experience_moo_pass_buff',
                typeHrid: '/buff_types/wisdom',
                ratioBoost: 0,
                ratioBoostLevelBonus: 0,
                flatBoost: 0.05,
                flatBoostLevelBonus: 0,
                startTime: '0001-01-01T00:00:00Z',
                duration: 0,
            });
        }

        if (communityBuffs?.comExp > 0) {
            extraBuffs.push({
                uniqueHrid: '/buff_uniques/experience_community_buff',
                typeHrid: '/buff_types/wisdom',
                ratioBoost: 0,
                ratioBoostLevelBonus: 0,
                flatBoost: 0.005 * (communityBuffs.comExp - 1) + 0.2,
                flatBoostLevelBonus: 0,
                startTime: '0001-01-01T00:00:00Z',
                duration: 0,
            });
        }

        if (communityBuffs?.comDrop > 0) {
            extraBuffs.push({
                uniqueHrid: '/buff_uniques/combat_community_buff',
                typeHrid: '/buff_types/combat_drop_quantity',
                ratioBoost: 0,
                ratioBoostLevelBonus: 0,
                flatBoost: 0.005 * (communityBuffs.comDrop - 1) + 0.2,
                flatBoostLevelBonus: 0,
                startTime: '0001-01-01T00:00:00Z',
                duration: 0,
            });
        }

        return extraBuffs;
    }

    /**
     * Build each player's own extra buffs (CSIM-AUD-019/020): community buffs are genuinely global
     * and shared identically, but MooPass is per-player. Every player gets its OWN array (never one
     * shared array reference across players), closing the CSIM-AUD-020B amplification vector at its
     * source in addition to the ownership fix in CombatUnit.addPermanentBuff().
     * @param {Array<Object>} playerDTOs
     * @param {Object} communityBuffs - { comExp, comDrop }
     * @returns {Object<string, Array<Object>>} playerHrid -> that player's own extraBuffs array
     */
    function buildExtraBuffsByPlayer(playerDTOs, communityBuffs) {
        const extraBuffsByPlayer = {};
        for (const dto of playerDTOs) {
            extraBuffsByPlayer[dto.hrid] = buildExtraBuffs(communityBuffs, dto.hasMooPass);
        }
        return extraBuffsByPlayer;
    }

    /**
     * Run a single simulation chunk in a Worker.
     * @param {Object} message - Worker message payload
     * @param {Function} [onProgress] - Progress callback (0-100 for this chunk)
     * @param {string} [channel] - Worker slot to register on (see CHANNEL_DEFAULT)
     * @returns {Promise<Object>} SimResult
     */
    function runWorkerChunk(message, onProgress, channel = CHANNEL_DEFAULT) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(getWorkerURL());
            const slot = getSlot(channel);
            slot.workers.push(worker);
            slot.rejects.push(reject);

            const cleanup = () => {
                slot.workers = slot.workers.filter((w) => w !== worker);
                slot.rejects = slot.rejects.filter((r) => r !== reject);
            };

            worker.onmessage = (event) => {
                const msg = event.data;
                if (msg.taskId !== message.taskId) return;

                if (msg.type === 'progress') {
                    if (onProgress) onProgress(msg.progress);
                } else if (msg.type === 'result') {
                    worker.terminate();
                    cleanup();
                    resolve(msg.simResult);
                } else if (msg.type === 'error') {
                    worker.terminate();
                    cleanup();
                    reject(new Error(msg.error));
                }
            };

            worker.onerror = (error) => {
                worker.terminate();
                cleanup();
                reject(new Error(error.message || 'Worker error'));
            };

            worker.postMessage(message);
        });
    }

    /**
     * Run a combat simulation as one continuous, full-duration stateful timeline (CSIM-AUD-006).
     * Independent targets/zones are parallelized by all-zones-runner.js at a higher level, never by
     * splitting one target's elapsed time across independent worker replicas.
     * @param {Object} params
     * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
     * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
     * @param {string} params.zoneHrid - Zone HRID
     * @param {number} params.difficultyTier - Difficulty tier (0+)
     * @param {number} params.hours - Hours to simulate
     * @param {Object} params.communityBuffs - { comExp, comDrop }
     * @param {Function} [onProgress] - Called with (percent: 0-100)
     * @param {Object} [options]
     * @param {string} [options.channel] - Worker slot; a new run only cancels runs on the same channel
     * @returns {Promise<Object>} SimResult
     */
    async function runSimulation(params, onProgress, options = {}) {
        const { gameData, playerDTOs, zoneHrid, difficultyTier, hours, communityBuffs } = params;
        const channel = options.channel ?? CHANNEL_DEFAULT;

        const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
        const ONE_HOUR_NS = 3600 * 1e9;

        // Cancel any previous run
        cancelSimulation(channel);

        const taskId = ++taskIdCounter;
        const message = {
            type: 'start_simulation',
            taskId,
            gameData,
            playerDTOs,
            zoneHrid,
            difficultyTier,
            // Preserve the exact requested duration, including fractional hours - one target's
            // simulation timeline must never be time-sliced.
            simulationTimeLimit: hours * ONE_HOUR_NS,
            extraBuffsByPlayer,
        };

        const result = await runWorkerChunk(message, onProgress, channel);

        if (onProgress) onProgress(100);

        return result;
    }

    /**
     * Build labyrinth crate buff arrays from crate item HRIDs.
     * @param {string[]} crateHrids - Array of crate item HRIDs (e.g., ['/items/expert_coffee_crate'])
     * @param {Object} gameData - Game data containing labyrinthCrateDetailMap
     * @returns {Array<Object>} Buff objects compatible with zoneBuffs
     */
    function buildCrateBuffs$1(crateHrids, gameData) {
        if (!crateHrids || crateHrids.length === 0) return [];

        const crateMap = gameData.labyrinthCrateDetailMap;
        if (!crateMap) return [];

        let buffs = [];
        for (const hrid of crateHrids) {
            if (crateMap[hrid]) {
                buffs = buffs.concat(crateMap[hrid]);
            }
        }
        return buffs;
    }

    /**
     * Run a labyrinth simulation.
     * @param {Object} params
     * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
     * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
     * @param {string} params.zoneHrid - Zone HRID (used for SimResult context; any combat zone works)
     * @param {string} params.monsterHrid - Labyrinth monster HRID
     * @param {number} params.roomLevel - Room level (scales monster stats)
     * @param {string[]} params.crates - Crate item HRIDs
     * @param {number} params.hours - Hours to simulate
     * @param {Object} params.communityBuffs - { mooPass, comExp, comDrop }
     * @param {Function} [onProgress] - Called with (percent: 0-100)
     * @returns {Promise<Object>} SimResult with labyrinth fields
     */
    async function runLabyrinthSimulation(params, onProgress) {
        const {
            gameData,
            playerDTOs,
            zoneHrid,
            monsterHrid,
            roomLevel,
            crates,
            hours,
            communityBuffs,
            labyrinthCombatBuffs,
        } = params;

        const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
        if (labyrinthCombatBuffs?.length) {
            // Labyrinth crate buffs are genuinely shared party-wide loot, unlike guild Shrines/MooPass.
            for (const dto of playerDTOs) {
                extraBuffsByPlayer[dto.hrid] = [...extraBuffsByPlayer[dto.hrid], ...labyrinthCombatBuffs];
            }
        }
        const ONE_HOUR_NS = 3600 * 1e9;

        // Cancel any previous run
        cancelSimulation();

        const taskId = ++taskIdCounter;
        const message = {
            type: 'start_simulation',
            taskId,
            gameData,
            playerDTOs,
            zoneHrid,
            difficultyTier: 0,
            simulationTimeLimit: hours * ONE_HOUR_NS,
            extraBuffsByPlayer,
            labyrinth: {
                monsterHrid,
                roomLevel,
                crates: crates || [],
            },
        };

        const result = await runWorkerChunk(message, onProgress);

        if (onProgress) onProgress(100);

        return result;
    }

    // Each labyrinth attempt ends within 120s of simulated time (win, death, or timeout), so this is
    // a ceiling the attempt count always reaches first - it only guards against a runaway loop.
    const LABYRINTH_ATTEMPT_CEILING_NS = 125 * 1e9;
    const MAX_ATTEMPT_WORKERS = 6;

    /**
     * Number of workers to spread labyrinth attempts over. Leaves one core for the game itself.
     * @returns {number}
     */
    function getAttemptWorkerCount() {
        const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
        return Math.max(1, Math.min((cores || 2) - 1, MAX_ATTEMPT_WORKERS));
    }

    /**
     * Split an attempt count as evenly as possible across workers, never giving one zero attempts.
     * @param {number} attempts
     * @param {number} workers
     * @returns {number[]} Per-worker attempt counts, summing to `attempts`
     */
    function splitAttempts(attempts, workers) {
        const count = Math.max(1, Math.min(Math.floor(workers), Math.floor(attempts)));
        const base = Math.floor(attempts / count);
        const remainder = attempts - base * count;
        return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
    }

    /**
     * Combine the results of independent labyrinth attempt batches into one. Attempts are fully
     * independent (the engine resets the player before each), so wins, attempts, elapsed simulated
     * time, and XP simply add.
     * @param {Array<Object>} results - Worker SimResults from attempt-count runs
     * @returns {{encounters: number, labyAttemptCount: number, simulatedTime: number, experienceGained: Object}}
     */
    function mergeLabyrinthResults(results) {
        const merged = { encounters: 0, labyAttemptCount: 0, simulatedTime: 0, experienceGained: {} };
        for (const result of results) {
            merged.encounters += result.encounters || 0;
            merged.labyAttemptCount += result.labyAttemptCount || 0;
            merged.simulatedTime += result.simulatedTime || 0;
            for (const [hrid, skills] of Object.entries(result.experienceGained || {})) {
                const target = (merged.experienceGained[hrid] = merged.experienceGained[hrid] || {});
                for (const [skill, xp] of Object.entries(skills)) {
                    target[skill] = (target[skill] || 0) + xp;
                }
            }
        }
        return merged;
    }

    /**
     * Run a fixed number of independent labyrinth attempts, spread across several workers.
     * `simulatedTime` in the result is the total simulated time across all workers (so dividing it by
     * the attempt count gives the average attempt length), not wall-clock time.
     * @param {Object} params - Same fields as runLabyrinthSimulation, with `attempts` instead of `hours`
     * @param {number} params.attempts - Number of attempts to run in total
     * @param {number} [params.workers] - Worker count (defaults to getAttemptWorkerCount())
     * @returns {Promise<Object>} Merged result (see mergeLabyrinthResults)
     */
    async function runLabyrinthAttempts(params) {
        const { gameData, playerDTOs, zoneHrid, monsterHrid, roomLevel, crates, attempts, communityBuffs } = params;

        const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
        if (params.labyrinthCombatBuffs?.length) {
            for (const dto of playerDTOs) {
                extraBuffsByPlayer[dto.hrid] = [...extraBuffsByPlayer[dto.hrid], ...params.labyrinthCombatBuffs];
            }
        }

        // Cancel any previous run
        cancelSimulation();

        const shares = splitAttempts(attempts, params.workers || getAttemptWorkerCount());
        const results = await Promise.all(
            shares.map((share) =>
                runWorkerChunk({
                    type: 'start_simulation',
                    taskId: ++taskIdCounter,
                    gameData,
                    playerDTOs,
                    zoneHrid,
                    difficultyTier: 0,
                    simulationTimeLimit: (share + 1) * LABYRINTH_ATTEMPT_CEILING_NS,
                    extraBuffsByPlayer,
                    labyrinth: { monsterHrid, roomLevel, crates: crates || [], maxAttempts: share },
                })
            )
        );

        return mergeLabyrinthResults(results);
    }

    /**
     * Terminate all active simulation workers on a channel and reject their pending promises.
     * @param {string} [channel] - Worker slot to cancel (default: the shared default channel)
     */
    function cancelSimulation(channel = CHANNEL_DEFAULT) {
        const slot = getSlot(channel);
        for (const worker of slot.workers) {
            worker.terminate();
        }
        slot.workers = [];

        const rejects = slot.rejects.slice();
        slot.rejects = [];
        for (const reject of rejects) {
            reject(new Error('Cancelled'));
        }
    }

    var combatSimRunner = /*#__PURE__*/Object.freeze({
        __proto__: null,
        CHANNEL_DEFAULT: CHANNEL_DEFAULT,
        CHANNEL_TASKS: CHANNEL_TASKS,
        RUNNER_STATE_IMPLEMENTATION_ID: RUNNER_STATE_IMPLEMENTATION_ID,
        buildCrateBuffs: buildCrateBuffs$1,
        buildExtraBuffs: buildExtraBuffs,
        buildExtraBuffsByPlayer: buildExtraBuffsByPlayer,
        cancelSimulation: cancelSimulation,
        getAttemptWorkerCount: getAttemptWorkerCount,
        getWorkerURL: getWorkerURL,
        mergeLabyrinthResults: mergeLabyrinthResults,
        runLabyrinthAttempts: runLabyrinthAttempts,
        runLabyrinthSimulation: runLabyrinthSimulation,
        runSimulation: runSimulation,
        runWorkerChunk: runWorkerChunk,
        splitAttempts: splitAttempts
    });

    var MULTI_WORKER_SCRIPT = "(function () {\n    'use strict';\n\n    /**\n     * Multi-Worker Entry for All-Zones Simulation\n     *\n     * This file is bundled into a string and runs inside a Web Worker.\n     * It receives all zones to simulate, creates a pool of child simulation workers,\n     * and processes zones via a task queue. Child workers are spawned from a Blob URL\n     * created from the simulation worker script passed in the init message.\n     *\n     * This matches Shykai's architecture: worker-spawned workers get different\n     * CPU scheduling from the browser than main-thread-spawned workers.\n     *\n     * When useEarlyExit is true, only T0 is seeded per zone initially. After each tier\n     * completes, a zone_tier_result message is sent to the main thread. The main thread\n     * compares XP/hr and profit/hr and responds with zone_tier_decision { skip }. If skip\n     * is false, the next tier is enqueued; if true, remaining tiers for that zone are skipped.\n     */\n\n    let simWorkerBlobURL = null;\n    let taskIdCounter = 0;\n\n    // Pending early-exit decisions: zoneHrid → resolve function\n    const pendingDecisions = new Map();\n\n    onmessage = async function (event) {\n        const { type } = event.data;\n\n        if (type === 'start_all_zones') {\n            const {\n                workerScript,\n                gameData,\n                playerDTOs,\n                zones,\n                simulationTimeLimit,\n                extraBuffsByPlayer,\n                maxWorkers,\n                useEarlyExit,\n            } = event.data;\n\n            // Create Blob URL for simulation workers from the bundled script string\n            const blob = new Blob([workerScript], { type: 'application/javascript' });\n            simWorkerBlobURL = URL.createObjectURL(blob);\n            const workerURL = simWorkerBlobURL;\n\n            const results = new Array(zones.length);\n\n            // Per-zone progress tracking\n            const zoneProgress = new Array(zones.length).fill(0);\n            const reportProgress = () => {\n                const total = zoneProgress.reduce((sum, p) => sum + p, 0);\n                postMessage({ type: 'progress', progress: total / zones.length });\n            };\n\n            // zoneInfoMap groups tiers by zone for early exit tracking\n            const zoneInfoMap = new Map(); // zoneHrid → { tiers: [{tier, index}], nextIdx }\n\n            // Build initial task queue\n            let taskQueue;\n            if (useEarlyExit) {\n                // Group zones by hrid, sort tiers ascending within each group\n                for (let i = 0; i < zones.length; i++) {\n                    const { zoneHrid, difficultyTier } = zones[i];\n                    if (!zoneInfoMap.has(zoneHrid)) {\n                        zoneInfoMap.set(zoneHrid, { tiers: [], nextIdx: 0 });\n                    }\n                    zoneInfoMap.get(zoneHrid).tiers.push({ tier: difficultyTier, index: i });\n                }\n                for (const info of zoneInfoMap.values()) {\n                    info.tiers.sort((a, b) => a.tier - b.tier);\n                }\n\n                // Seed only the first (lowest) tier per zone\n                taskQueue = [];\n                for (const [zoneHrid, info] of zoneInfoMap) {\n                    const first = info.tiers[0];\n                    taskQueue.push({ zoneHrid, difficultyTier: first.tier, index: first.index });\n                    info.nextIdx = 1;\n                }\n            } else {\n                taskQueue = [...zones.map((zone, index) => ({ ...zone, index }))];\n            }\n\n            const poolSize = Math.min(maxWorkers, taskQueue.length);\n\n            // Each pool slot processes tasks sequentially, one fresh worker per task\n            const processQueue = async () => {\n                while (taskQueue.length > 0) {\n                    const task = taskQueue.shift();\n                    if (!task) continue;\n                    const taskId = ++taskIdCounter;\n\n                    let simResult = null;\n                    try {\n                        simResult = await new Promise((resolve, reject) => {\n                            const worker = new Worker(workerURL);\n\n                            worker.onmessage = (e) => {\n                                const msg = e.data;\n                                if (msg.taskId !== taskId) return;\n\n                                if (msg.type === 'progress') {\n                                    zoneProgress[task.index] = msg.progress;\n                                    reportProgress();\n                                } else if (msg.type === 'result') {\n                                    worker.terminate();\n                                    resolve(msg.simResult);\n                                } else if (msg.type === 'error') {\n                                    worker.terminate();\n                                    reject(new Error(msg.error));\n                                }\n                            };\n\n                            worker.onerror = (error) => {\n                                worker.terminate();\n                                reject(new Error(error.message || 'Worker error'));\n                            };\n\n                            worker.postMessage({\n                                type: 'start_simulation',\n                                taskId,\n                                gameData,\n                                playerDTOs,\n                                zoneHrid: task.zoneHrid,\n                                difficultyTier: task.difficultyTier,\n                                simulationTimeLimit,\n                                extraBuffsByPlayer,\n                            });\n                        });\n                    } catch (error) {\n                        console.error(`[MultiWorker] Zone ${task.zoneHrid} T${task.difficultyTier} failed:`, error);\n                    }\n\n                    results[task.index] = simResult;\n                    zoneProgress[task.index] = 100;\n                    reportProgress();\n\n                    // Early exit: send tier result to main thread and await go/skip decision\n                    if (useEarlyExit && simResult) {\n                        const zoneInfo = zoneInfoMap.get(task.zoneHrid);\n                        if (zoneInfo && zoneInfo.nextIdx < zoneInfo.tiers.length) {\n                            postMessage({\n                                type: 'zone_tier_result',\n                                zoneHrid: task.zoneHrid,\n                                tier: task.difficultyTier,\n                                index: task.index,\n                                simResult,\n                            });\n\n                            const skip = await new Promise((resolve) => {\n                                pendingDecisions.set(task.zoneHrid, resolve);\n                            });\n\n                            if (skip) {\n                                // Mark remaining tiers for this zone as skipped (null result)\n                                for (let i = zoneInfo.nextIdx; i < zoneInfo.tiers.length; i++) {\n                                    results[zoneInfo.tiers[i].index] = null;\n                                    zoneProgress[zoneInfo.tiers[i].index] = 100;\n                                }\n                                zoneInfo.nextIdx = zoneInfo.tiers.length;\n                                reportProgress();\n                            } else {\n                                // Enqueue the next tier\n                                const next = zoneInfo.tiers[zoneInfo.nextIdx];\n                                zoneInfo.nextIdx++;\n                                taskQueue.push({\n                                    zoneHrid: task.zoneHrid,\n                                    difficultyTier: next.tier,\n                                    index: next.index,\n                                });\n                            }\n                        }\n                    }\n                }\n            };\n\n            try {\n                await Promise.all(\n                    Array(poolSize)\n                        .fill()\n                        .map(() => processQueue())\n                );\n                postMessage({ type: 'all_zones_result', results });\n            } catch (error) {\n                postMessage({ type: 'error', error: error.message || String(error) });\n            }\n\n            // Clean up\n            URL.revokeObjectURL(simWorkerBlobURL);\n            simWorkerBlobURL = null;\n        } else if (type === 'zone_tier_decision') {\n            // Main thread responded to an early-exit zone_tier_result\n            const { zoneHrid, skip } = event.data;\n            const resolve = pendingDecisions.get(zoneHrid);\n            if (resolve) {\n                pendingDecisions.delete(zoneHrid);\n                resolve(skip);\n            }\n        }\n    };\n\n})();\n";

    /**
     * All Zones Combat Simulator Runner
     * Uses a dedicated coordinator worker (multiWorker) that spawns child simulation workers.
     *
     * Worker-spawned workers get different CPU scheduling from the browser than
     * main-thread-spawned workers, matching Shykai's architecture for better
     * multi-zone throughput.
     */


    // Checked against the production bundles by scripts/check-combat-sim-singleton.js (one owner only)
    const ALL_ZONES_STATE_IMPLEMENTATION_ID = 'toolasha-sim-all-zones-state-v1';

    // Coordinator run per channel (see combat-sim-runner.js): a new run cancels only a run on its own channel
    const runs = new Map(); // channel -> { worker, reject }

    /**
     * Run simulations for all specified zones in parallel via a coordinator worker.
     * @param {Object} params
     * @param {Object} params.gameData - Game data maps from buildGameDataPayload()
     * @param {Array<Object>} params.playerDTOs - Player DTOs from buildAllPlayerDTOs()
     * @param {Array<{zoneHrid: string, difficultyTier: number}>} params.zones - Zones to simulate
     * @param {number} params.hours - Hours to simulate per zone
     * @param {Object} params.communityBuffs - { mooPass, comExp, comDrop }
     * @param {boolean} [params.useEarlyExit] - Skip higher tiers when both XP/hr and profit/hr decline
     * @param {Function} [onProgress] - Called with (percent: 0-100) for overall progress
     * @param {Object} [options]
     * @param {string} [options.channel] - Run slot; a new run only cancels a run on the same channel
     * @returns {Promise<Array<Object>>} Array of SimResults, one per zone (same order as input)
     */
    async function runAllZonesSimulation(params, onProgress, options = {}) {
        const { gameData, playerDTOs, zones, hours, communityBuffs, useEarlyExit } = params;
        const channel = options.channel ?? CHANNEL_DEFAULT;

        if (!zones.length) return [];

        // Cancel any previous run
        cancelAllZonesSimulation(channel);

        const extraBuffsByPlayer = buildExtraBuffsByPlayer(playerDTOs, communityBuffs);
        const ONE_HOUR_NS = 3600 * 1e9;
        const simulationTimeLimit = hours * ONE_HOUR_NS;

        const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
        const maxThreadsSetting = config.getSetting('combatSim_maxThreads') || 0;
        const maxWorkers = maxThreadsSetting > 0 ? Math.min(maxThreadsSetting, availableCores) : availableCores;

        return new Promise((resolve, reject) => {
            // Store reject so cancelAllZonesSimulation can unblock the promise
            const run = { worker: null, reject };
            runs.set(channel, run);

            // Create the coordinator worker
            const blob = new Blob([MULTI_WORKER_SCRIPT], { type: 'application/javascript' });
            const blobURL = URL.createObjectURL(blob);
            const worker = new Worker(blobURL);
            run.worker = worker;

            const cleanup = () => {
                // Only clear the slot if a newer run has not already replaced this one
                if (runs.get(channel) === run) runs.delete(channel);
                URL.revokeObjectURL(blobURL);
            };

            // Per-zone tier metrics for early exit comparison: zoneHrid → [{xpPerHour, profitPerHour}]
            const tierResultsByZone = new Map();

            worker.onmessage = (event) => {
                const msg = event.data;

                if (msg.type === 'progress') {
                    if (onProgress) onProgress(Math.round(msg.progress));
                } else if (msg.type === 'zone_tier_result') {
                    // Calculate XP/hr and profit/hr for this tier and decide whether to skip the next
                    const { zoneHrid, simResult } = msg;
                    const simHours = (simResult.simulatedTime || 0) / (3600 * 1e9) || hours;

                    // Sum XP across all players and all skills
                    let totalXP = 0;
                    for (const playerXP of Object.values(simResult.experienceGained || {})) {
                        for (const xp of Object.values(playerXP)) {
                            totalXP += xp;
                        }
                    }
                    const xpPerHour = totalXP / simHours;

                    let profitPerHour = 0;
                    try {
                        const revenue = calculateSimRevenue(simResult, gameData, 'player1', simHours);
                        profitPerHour = revenue.netPerHour;
                    } catch {
                        // Revenue calculation may fail if market data is unavailable
                    }

                    const prevResults = tierResultsByZone.get(zoneHrid) || [];
                    const currMetrics = { xpPerHour, profitPerHour };

                    let skip = false;
                    if (prevResults.length > 0) {
                        const prev = prevResults[prevResults.length - 1];
                        if (xpPerHour < prev.xpPerHour && profitPerHour < prev.profitPerHour) {
                            skip = true;
                        }
                    }

                    prevResults.push(currMetrics);
                    tierResultsByZone.set(zoneHrid, prevResults);

                    worker.postMessage({ type: 'zone_tier_decision', zoneHrid, skip });
                } else if (msg.type === 'all_zones_result') {
                    worker.terminate();
                    cleanup();
                    if (onProgress) onProgress(100);
                    resolve(msg.results);
                } else if (msg.type === 'error') {
                    worker.terminate();
                    cleanup();
                    reject(new Error(msg.error));
                }
            };

            worker.onerror = (error) => {
                worker.terminate();
                cleanup();
                reject(new Error(error.message || 'MultiWorker error'));
            };

            // Send the simulation worker script as a string so the multiWorker can spawn child workers
            worker.postMessage({
                type: 'start_all_zones',
                workerScript: WORKER_SCRIPT,
                gameData,
                playerDTOs,
                zones,
                simulationTimeLimit,
                extraBuffsByPlayer,
                maxWorkers,
                useEarlyExit: !!useEarlyExit,
            });
        });
    }

    /**
     * Terminate a channel's coordinator worker (kills all child workers too) and reject its pending promise.
     * @param {string} [channel] - Run slot to cancel (default: the shared default channel)
     */
    function cancelAllZonesSimulation(channel = CHANNEL_DEFAULT) {
        const run = runs.get(channel);
        if (!run) return;
        runs.delete(channel);
        if (run.worker) run.worker.terminate();
        run.reject(new Error('Cancelled'));
    }

    var allZonesRunner = /*#__PURE__*/Object.freeze({
        __proto__: null,
        ALL_ZONES_STATE_IMPLEMENTATION_ID: ALL_ZONES_STATE_IMPLEMENTATION_ID,
        cancelAllZonesSimulation: cancelAllZonesSimulation,
        runAllZonesSimulation: runAllZonesSimulation
    });

    /**
     * Game Data Singleton
     *
     * Replaces static JSON imports across the ported combat simulator engine.
     * Game data maps are set once per simulation run from Toolasha's live data.
     */

    let _gameData = null;

    /**
     * Set all game data maps for the simulation.
     * @param {Object} data - Game data maps from dataManager.getInitClientData()
     */
    function setGameData(data) {
        _gameData = data;
    }

    /**
     * Get the current game data maps.
     * @returns {Object} Game data maps
     */
    function getGameData() {
        return _gameData;
    }

    var engineGameData = /*#__PURE__*/Object.freeze({
        __proto__: null,
        getGameData: getGameData,
        setGameData: setGameData
    });

    class Buff {
        startTime;

        constructor(buff, level = 1) {
            this.uniqueHrid = buff.uniqueHrid;
            this.typeHrid = buff.typeHrid;
            this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
            this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
            this.duration = buff.duration;
            this.multiplierForSkillHrid = buff.multiplierForSkillHrid ?? '';
            this.multiplierPerSkillLevel = buff.multiplierPerSkillLevel ?? 0;
        }
    }

    class Trigger {
        constructor(dependencyHrid, conditionHrid, comparatorHrid, value = 0) {
            this.dependencyHrid = dependencyHrid;
            this.conditionHrid = conditionHrid;
            this.comparatorHrid = comparatorHrid;
            this.value = value;
        }

        static createFromDTO(dto) {
            const trigger = new Trigger(dto.dependencyHrid, dto.conditionHrid, dto.comparatorHrid, dto.value);

            return trigger;
        }

        isActive(source, target, friendlies, enemies, currentTime) {
            const combatTriggerDependencyDetailMap = getGameData().combatTriggerDependencyDetailMap;
            if (combatTriggerDependencyDetailMap[this.dependencyHrid].isSingleTarget) {
                return this.isActiveSingleTarget(source, target, currentTime);
            } else {
                return this.isActiveMultiTarget(friendlies, enemies, currentTime);
            }
        }

        isActiveSingleTarget(source, target, currentTime) {
            let dependencyValue;
            switch (this.dependencyHrid) {
                case '/combat_trigger_dependencies/self':
                    dependencyValue = this.getDependencyValue(source, currentTime);
                    break;
                case '/combat_trigger_dependencies/targeted_enemy':
                    if (!target) {
                        return false;
                    }
                    dependencyValue = this.getDependencyValue(target, currentTime);
                    break;
                default:
                    throw new Error('Unknown dependencyHrid in trigger: ' + this.dependencyHrid);
            }

            return this.compareValue(dependencyValue);
        }

        isActiveMultiTarget(friendlies, enemies, currentTime) {
            let dependency;
            switch (this.dependencyHrid) {
                case '/combat_trigger_dependencies/all_allies':
                    if (!friendlies) {
                        return false;
                    }
                    dependency = friendlies;
                    break;
                case '/combat_trigger_dependencies/all_enemies':
                    if (!enemies) {
                        return false;
                    }
                    dependency = enemies;
                    break;
                default:
                    throw new Error('Unknown dependencyHrid in trigger: ' + this.dependencyHrid);
            }

            if (!dependency) {
                return false;
            }

            let dependencyValue;
            switch (this.conditionHrid) {
                case '/combat_trigger_conditions/number_of_active_units':
                    dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints > 0).length;
                    break;
                case '/combat_trigger_conditions/number_of_dead_units':
                    dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints <= 0).length;
                    break;
                case '/combat_trigger_conditions/lowest_hp_percentage':
                    dependencyValue =
                        dependency
                            .filter((unit) => unit.combatDetails.currentHitpoints > 0)
                            .reduce((prev, curr) => {
                                const currentHpPercentage =
                                    curr.combatDetails.currentHitpoints / curr.combatDetails.maxHitpoints;
                                return currentHpPercentage < prev ? currentHpPercentage : prev;
                            }, 2) * 100;
                    break;
                default:
                    dependencyValue = dependency
                        .filter((unit) => unit.combatDetails.currentHitpoints > 0)
                        .map((unit) => this.getDependencyValue(unit, currentTime))
                        .reduce((prev, cur) => prev + cur, 0);
                    break;
            }

            return this.compareValue(dependencyValue);
        }

        getDependencyValue(source, currentTime) {
            switch (this.conditionHrid) {
                case '/combat_trigger_conditions/berserk':
                case '/combat_trigger_conditions/frenzy':
                case '/combat_trigger_conditions/precision':
                case '/combat_trigger_conditions/vampirism':
                case '/combat_trigger_conditions/attack_coffee':
                case '/combat_trigger_conditions/defense_coffee':
                case '/combat_trigger_conditions/lucky_coffee':
                case '/combat_trigger_conditions/magic_coffee':
                case '/combat_trigger_conditions/melee_coffee':
                case '/combat_trigger_conditions/ranged_coffee':
                case '/combat_trigger_conditions/swiftness_coffee':
                case '/combat_trigger_conditions/wisdom_coffee':
                case '/combat_trigger_conditions/ice_spear':
                case '/combat_trigger_conditions/puncture':
                case '/combat_trigger_conditions/frost_surge':
                case '/combat_trigger_conditions/elusiveness':
                case '/combat_trigger_conditions/channeling_coffee':
                case '/combat_trigger_conditions/fierce_aura':
                case '/combat_trigger_conditions/invincible_armor':
                case '/combat_trigger_conditions/invincible_fire_resistance':
                case '/combat_trigger_conditions/invincible_nature_resistance':
                case '/combat_trigger_conditions/invincible_water_resistance':
                case '/combat_trigger_conditions/provoke':
                case '/combat_trigger_conditions/taunt':
                case '/combat_trigger_conditions/crippling_slash':
                case '/combat_trigger_conditions/mana_spring':
                case '/combat_trigger_conditions/retribution':
                case '/combat_trigger_conditions/fracturing_impact':
                case '/combat_trigger_conditions/maim':
                case '/combat_trigger_conditions/curse':
                case '/combat_trigger_conditions/weaken': {
                    const buffHrid = '/buff_uniques' + this.conditionHrid.slice(this.conditionHrid.lastIndexOf('/'));
                    return source.combatBuffs[buffHrid];
                }
                case '/combat_trigger_conditions/critical_aura':
                case '/combat_trigger_conditions/critical_coffee':
                case '/combat_trigger_conditions/intelligence_coffee':
                case '/combat_trigger_conditions/stamina_coffee':
                case '/combat_trigger_conditions/elemental_affinity':
                case '/combat_trigger_conditions/fury':
                case '/combat_trigger_conditions/guardian_aura':
                case '/combat_trigger_conditions/insanity':
                case '/combat_trigger_conditions/spike_shell':
                case '/combat_trigger_conditions/toxic_pollen':
                case '/combat_trigger_conditions/invincible':
                case '/combat_trigger_conditions/mystic_aura':
                case '/combat_trigger_conditions/pestilent_shot':
                case '/combat_trigger_conditions/smoke_burst':
                case '/combat_trigger_conditions/speed_aura':
                case '/combat_trigger_conditions/toughness':
                case '/combat_trigger_conditions/enrage': {
                    const buffPrefix = '/buff_uniques' + this.conditionHrid.slice(this.conditionHrid.lastIndexOf('/'));
                    const buffs = Object.keys(source.combatBuffs).filter((buff) => buff.startsWith(buffPrefix));
                    return source.combatBuffs[buffs?.[0]];
                }
                case '/combat_trigger_conditions/current_hp':
                    return source.combatDetails.currentHitpoints;
                case '/combat_trigger_conditions/current_mp':
                    return source.combatDetails.currentManapoints;
                case '/combat_trigger_conditions/missing_hp':
                    return source.combatDetails.maxHitpoints - source.combatDetails.currentHitpoints;
                case '/combat_trigger_conditions/missing_mp':
                    return source.combatDetails.maxManapoints - source.combatDetails.currentManapoints;
                case '/combat_trigger_conditions/stun_status':
                    // Replicate the game's behaviour of "stun status active" triggers activating
                    // immediately after the stun has worn off
                    return source.isStunned || source.stunExpireTime === currentTime;
                case '/combat_trigger_conditions/blind_status':
                    return source.isBlinded || source.blindExpireTime === currentTime;
                case '/combat_trigger_conditions/silence_status':
                    return source.isSilenced || source.silenceExpireTime === currentTime;
                default:
                    throw new Error('Unknown conditionHrid in trigger: ' + this.conditionHrid);
            }
        }

        compareValue(dependencyValue) {
            switch (this.comparatorHrid) {
                case '/combat_trigger_comparators/greater_than_equal':
                    return dependencyValue >= this.value;
                case '/combat_trigger_comparators/less_than_equal':
                    return dependencyValue <= this.value;
                case '/combat_trigger_comparators/is_active':
                    return !!dependencyValue;
                case '/combat_trigger_comparators/is_inactive':
                    return !dependencyValue;
                default:
                    throw new Error('Unknown comparatorHrid in trigger: ' + this.comparatorHrid);
            }
        }
    }

    const abilityFromCombatStat = {
        blaze: {
            hrid: '/abilities/blaze',
            name: 'Blaze',
            description: '',
            isSpecialAbility: false,
            manaCost: 0,
            cooldownDuration: 0,
            castDuration: 0,
            abilityEffects: [
                {
                    targetType: 'allEnemies',
                    effectType: '/ability_effect_types/damage',
                    combatStyleHrid: '/combat_styles/magic',
                    damageType: '/damage_types/fire',
                    baseDamageFlat: 0,
                    baseDamageFlatLevelBonus: 0.0,
                    baseDamageRatio: 0.3,
                    baseDamageRatioLevelBonus: 0,
                    bonusAccuracyRatio: 0,
                    bonusAccuracyRatioLevelBonus: 0,
                    damageOverTimeRatio: 0,
                    damageOverTimeDuration: 0,
                    armorDamageRatio: 0,
                    armorDamageRatioLevelBonus: 0,
                    hpDrainRatio: 0,
                    pierceChance: 0,
                    blindChance: 0,
                    blindDuration: 0,
                    silenceChance: 0,
                    silenceDuration: 0,
                    stunChance: 0,
                    stunDuration: 0,
                    spendHpRatio: 0,
                    buffs: null,
                },
            ],
            defaultCombatTriggers: [
                {
                    dependencyHrid: '/combat_trigger_dependencies/all_enemies',
                    conditionHrid: '/combat_trigger_conditions/number_of_active_units',
                    comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
                    value: 1,
                },
                {
                    dependencyHrid: '/combat_trigger_dependencies/all_enemies',
                    conditionHrid: '/combat_trigger_conditions/current_hp',
                    comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
                    value: 1,
                },
            ],
        },
        bloom: {
            hrid: '/abilities/bloom',
            name: 'Bloom',
            description: '',
            isSpecialAbility: false,
            manaCost: 0,
            cooldownDuration: 0,
            castDuration: 0,
            abilityEffects: [
                {
                    targetType: 'lowestHpAlly',
                    effectType: '/ability_effect_types/heal',
                    combatStyleHrid: '/combat_styles/magic',
                    damageType: '',
                    baseDamageFlat: 10,
                    baseDamageFlatLevelBonus: 0,
                    baseDamageRatio: 0.15,
                    baseDamageRatioLevelBonus: 0,
                    bonusAccuracyRatio: 0,
                    bonusAccuracyRatioLevelBonus: 0,
                    damageOverTimeRatio: 0,
                    damageOverTimeDuration: 0,
                    armorDamageRatio: 0,
                    armorDamageRatioLevelBonus: 0,
                    hpDrainRatio: 0,
                    pierceChance: 0,
                    blindChance: 0,
                    blindDuration: 0,
                    silenceChance: 0,
                    silenceDuration: 0,
                    stunChance: 0,
                    stunDuration: 0,
                    spendHpRatio: 0,
                    buffs: null,
                },
            ],
            defaultCombatTriggers: [
                {
                    dependencyHrid: '/combat_trigger_dependencies/all_allies',
                    conditionHrid: '/combat_trigger_conditions/lowest_hp_percentage',
                    comparatorHrid: '/combat_trigger_comparators/less_than_equal',
                    value: 100,
                },
            ],
        },
    };

    class Ability {
        constructor(hrid, level = 1, triggers = null) {
            this.hrid = hrid;
            this.level = level;

            const abilityDetailMap = getGameData().abilityDetailMap;
            let gameAbility = abilityDetailMap[hrid];
            if (!gameAbility) {
                gameAbility = abilityFromCombatStat[hrid];
            }
            if (!gameAbility) {
                throw new Error('No ability found for hrid: ' + this.hrid);
            }

            this.manaCost = gameAbility.manaCost;
            this.cooldownDuration = gameAbility.cooldownDuration;
            this.castDuration = gameAbility.castDuration;
            this.isSpecialAbility = gameAbility.isSpecialAbility;

            this.abilityEffects = [];

            for (const effect of gameAbility.abilityEffects) {
                const abilityEffect = {
                    targetType: effect.targetType,
                    effectType: effect.effectType,
                    combatStyleHrid: effect.combatStyleHrid,
                    damageType: effect.damageType,
                    damageFlat: effect.baseDamageFlat + (this.level - 1) * effect.baseDamageFlatLevelBonus,
                    damageRatio: effect.baseDamageRatio + (this.level - 1) * effect.baseDamageRatioLevelBonus,
                    bonusAccuracyRatio: effect.bonusAccuracyRatio + (this.level - 1) * effect.bonusAccuracyRatioLevelBonus,
                    damageOverTimeRatio: effect.damageOverTimeRatio,
                    damageOverTimeDuration: effect.damageOverTimeDuration,
                    armorDamageRatio: effect.armorDamageRatio + (this.level - 1) * effect.armorDamageRatioLevelBonus,
                    hpDrainRatio: effect.hpDrainRatio,
                    pierceChance: effect.pierceChance,
                    blindChance: effect.blindChance,
                    blindDuration: effect.blindDuration,
                    silenceChance: effect.silenceChance,
                    silenceDuration: effect.silenceDuration,
                    stunChance: effect.stunChance,
                    stunDuration: effect.stunDuration,
                    spendHpRatio: effect.spendHpRatio,
                    buffs: null,
                };
                if (effect.buffs) {
                    abilityEffect.buffs = [];
                    for (const buff of effect.buffs) {
                        abilityEffect.buffs.push(new Buff(buff, this.level));
                    }
                }
                this.abilityEffects.push(abilityEffect);
            }

            if (triggers) {
                this.triggers = triggers;
            } else {
                this.triggers = [];
                for (const defaultTrigger of gameAbility.defaultCombatTriggers) {
                    const trigger = new Trigger(
                        defaultTrigger.dependencyHrid,
                        defaultTrigger.conditionHrid,
                        defaultTrigger.comparatorHrid,
                        defaultTrigger.value
                    );
                    this.triggers.push(trigger);
                }
            }

            this.lastUsed = Number.MIN_SAFE_INTEGER;
        }

        static createFromDTO(dto) {
            const triggers = dto.triggers ? dto.triggers.map((trigger) => Trigger.createFromDTO(trigger)) : null;
            const ability = new Ability(dto.hrid, dto.level, triggers);

            return ability;
        }

        shouldTrigger(currentTime, source, target, friendlies, enemies) {
            if (source.isStunned) {
                return false;
            }

            if (source.isSilenced) {
                return false;
            }

            const haste = source.combatDetails.combatStats.abilityHaste;
            let cooldownDuration = this.cooldownDuration;
            if (haste > 0) {
                cooldownDuration = (cooldownDuration * 100) / (100 + haste);
            }

            if (this.lastUsed + cooldownDuration > currentTime) {
                return false;
            }

            if (this.triggers.length === 0) {
                return true;
            }

            let shouldTrigger = true;
            for (const trigger of this.triggers) {
                if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
                    shouldTrigger = false;
                }
            }

            return shouldTrigger;
        }
    }

    /**
     * Achievement Tier buffs are derived entirely from live game data (TLA-044): a tier's buff applies
     * only when every achievement belonging to that tier (per achievementDetailMap's tierHrid) is
     * completed for this specific player, and only when the tier itself is usable in
     * /action_types/combat (per achievementTierDetailMap's usableInActionTypeMap). Mirrors the
     * existing data-driven Shrine pattern - never a hardcoded Novice/Veteran/Elite list, HRID, or
     * boost value.
     */
    class Achievement {
        constructor(characterAchievements) {
            const gameData = getGameData();
            const achievementDetailMap = gameData.achievementDetailMap || {};
            const achievementTierDetailMap = gameData.achievementTierDetailMap || {};

            const completedHrids = new Set();
            for (const achievement of characterAchievements || []) {
                if (achievement?.isCompleted && achievement.achievementHrid) {
                    completedHrids.add(achievement.achievementHrid);
                }
            }

            const tierTotals = new Map();
            const tierCompleted = new Map();
            for (const [achievementHrid, detail] of Object.entries(achievementDetailMap)) {
                const tierHrid = detail?.tierHrid;
                if (!tierHrid) continue;
                tierTotals.set(tierHrid, (tierTotals.get(tierHrid) || 0) + 1);
                if (completedHrids.has(achievementHrid)) {
                    tierCompleted.set(tierHrid, (tierCompleted.get(tierHrid) || 0) + 1);
                }
            }

            this.buffs = [];
            for (const [tierHrid, tierDetail] of Object.entries(achievementTierDetailMap)) {
                if (!tierDetail?.buff) continue;
                if (!tierDetail.usableInActionTypeMap?.['/action_types/combat']) continue;

                // A tier with no resolvable achievement members must never vacuously grant its buff.
                const total = tierTotals.get(tierHrid) || 0;
                if (total === 0) continue;

                const completed = tierCompleted.get(tierHrid) || 0;
                if (completed !== total) continue;

                this.buffs.push(new Buff(tierDetail.buff));
            }
        }
    }

    class CombatUnit {
        isPlayer;
        isStunned = false;
        stunExpireTime = null;
        isBlinded = false;
        blindExpireTime = null;
        isSilenced = false;
        silenceExpireTime = null;

        isOutOfMana = false;

        // Base levels which don't change after initialization
        staminaLevel = 1;
        intelligenceLevel = 1;
        attackLevel = 1;
        meleeLevel = 1;
        defenseLevel = 1;
        rangedLevel = 1;
        magicLevel = 1;

        experience = 0;
        experienceRate = 0;
        enrageTime = 0;

        abilities = [null, null, null, null];
        food = [null, null, null];
        drinks = [null, null, null];
        houseRooms = [];
        shrines = [];
        achievements = null;
        dropTable = [];
        rareDropTable = [];
        abilityManaCosts = new Map();

        // Calculated combat stats including temporary buffs
        combatDetails = {
            staminaLevel: 1,
            intelligenceLevel: 1,
            attackLevel: 1,
            meleeLevel: 1,
            defenseLevel: 1,
            rangedLevel: 1,
            magicLevel: 1,
            maxHitpoints: 110,
            currentHitpoints: 110,
            maxManapoints: 110,
            currentManapoints: 110,
            stabAccuracyRating: 11,
            slashAccuracyRating: 11,
            smashAccuracyRating: 11,
            rangedAccuracyRating: 11,
            magicAccuracyRating: 11,
            stabMaxDamage: 11,
            slashMaxDamage: 11,
            smashMaxDamage: 11,
            rangedMaxDamage: 11,
            magicMaxDamage: 11,
            stabEvasionRating: 11,
            slashEvasionRating: 11,
            smashEvasionRating: 11,
            rangedEvasionRating: 11,
            magicEvasionRating: 11,
            defensiveMaxDamage: 0,
            totalArmor: 0.2,
            totalWaterResistance: 0.4,
            totalNatureResistance: 0.4,
            totalFireResistance: 0.4,
            abilityHaste: 0,
            tenacity: 0,
            totalThreat: 100,
            combatStats: {
                combatStyleHrid: '/combat_styles/smash',
                damageType: '/damage_types/physical',
                attackInterval: 3000000000,
                autoAttackDamage: 0,
                abilityDamage: 0,
                criticalRate: 0,
                criticalDamage: 0,
                stabAccuracy: 0,
                slashAccuracy: 0,
                smashAccuracy: 0,
                rangedAccuracy: 0,
                magicAccuracy: 0,
                stabDamage: 0,
                slashDamage: 0,
                smashDamage: 0,
                rangedDamage: 0,
                magicDamage: 0,
                defensiveDamage: 0,
                taskDamage: 0,
                physicalAmplify: 0,
                waterAmplify: 0,
                natureAmplify: 0,
                fireAmplify: 0,
                healingAmplify: 0,
                physicalThorns: 0,
                elementalThorns: 0,
                maxHitpoints: 0,
                maxManapoints: 0,
                stabEvasion: 0,
                slashEvasion: 0,
                smashEvasion: 0,
                rangedEvasion: 0,
                magicEvasion: 0,
                armor: 0,
                waterResistance: 0,
                natureResistance: 0,
                fireResistance: 0,
                lifeSteal: 0,
                hpRegenPer10: 0.01,
                mpRegenPer10: 0.01,
                combatDropRate: 0,
                combatDropQuantity: 0,
                combatRareFind: 0,
                combatExperience: 0,
                maxHitpointsRatio: 0,
                maxManapointsRatio: 0,
                foodSlots: 1,
                drinkSlots: 1,
                armorPenetration: 0,
                waterPenetration: 0,
                naturePenetration: 0,
                firePenetration: 0,
                manaLeech: 0,
                castSpeed: 0,
                threat: 100,
                parry: 0,
                mayhem: 0,
                pierce: 0,
                curse: 0,
                ripple: 0,
                bloom: 0,
                blaze: 0,
                weaken: 0,
                fury: 0,
                foodHaste: 0,
                drinkConcentration: 0,
                damageTaken: 0,
                attackSpeed: 0,
                armorDamageRatio: 0,
                hpDrainRatio: 0,
                primaryTraining: '',
                focusTraining: '',
                staminaExperience: 0,
                intelligenceExperience: 0,
                attackExperience: 0,
                defenseExperience: 0,
                meleeExperience: 0,
                rangedExperience: 0,
                magicExperience: 0,
                retaliation: 0,
            },
        };
        combatBuffs = {};
        permanentBuffs = {};
        zoneBuffs = {};
        extraBuffs = {};
        furyAmount = 0;
        furyExpireTime = 0;
        // Per-source registry for the official party Aura family only (CSIM-AUD-001):
        // { [buffUniqueHrid]: { [casterHrid]: buffClone } }. Ordinary buffs never use this.
        auraSources = {};

        constructor() {}

        updateCombatDetails() {
            if (this.isPlayer) {
                if (this.combatDetails.combatStats.hpRegenPer10 === 0) {
                    this.combatDetails.combatStats.hpRegenPer10 = 0.01;
                } else {
                    this.combatDetails.combatStats.hpRegenPer10 = 0.01 + this.combatDetails.combatStats.hpRegenPer10;
                }
                if (this.combatDetails.combatStats.mpRegenPer10 === 0) {
                    this.combatDetails.combatStats.mpRegenPer10 = 0.01;
                } else {
                    this.combatDetails.combatStats.mpRegenPer10 = 0.01 + this.combatDetails.combatStats.mpRegenPer10;
                }
            }

            ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].forEach((stat) => {
                this.combatDetails[stat + 'Level'] = this[stat + 'Level'];
                const boosts = this.getBuffBoosts('/buff_types/' + stat + '_level');
                boosts.forEach((buff) => {
                    this.combatDetails[stat + 'Level'] += this[stat + 'Level'] * buff.ratioBoost;
                    this.combatDetails[stat + 'Level'] += buff.flatBoost;
                });
            });

            const maxHitpointsBoost = this.getBuffBoost('/buff_types/max_hitpoints');
            const maxManapointsBoost = this.getBuffBoost('/buff_types/max_manapoints');
            this.combatDetails.maxHitpoints = Math.floor(
                (10 * (10 + this.combatDetails.staminaLevel) +
                    this.combatDetails.combatStats.maxHitpoints +
                    maxHitpointsBoost.flatBoost) *
                    (1 + this.combatDetails.combatStats.maxHitpointsRatio + maxHitpointsBoost.ratioBoost)
            );
            this.combatDetails.maxManapoints = Math.floor(
                (10 * (10 + this.combatDetails.intelligenceLevel) +
                    this.combatDetails.combatStats.maxManapoints +
                    maxManapointsBoost.flatBoost) *
                    (1 + this.combatDetails.combatStats.maxManapointsRatio + maxManapointsBoost.ratioBoost)
            );

            const accuracyRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_accuracy').ratioBoost;
            const damageRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_damage').ratioBoost;

            const accuracyRatioBoost = this.getBuffBoost('/buff_types/accuracy').ratioBoost;
            const damageRatioBoost = this.getBuffBoost('/buff_types/damage').ratioBoost;

            ['stab', 'slash', 'smash'].forEach((style) => {
                this.combatDetails[style + 'AccuracyRating'] =
                    (10 + this.combatDetails.attackLevel) *
                    (1 + this.combatDetails.combatStats[style + 'Accuracy']) *
                    (1 + accuracyRatioBoost) *
                    (1 + accuracyRatioBoostFromFury);
                this.combatDetails[style + 'MaxDamage'] =
                    (10 + this.combatDetails.meleeLevel) *
                    (1 + this.combatDetails.combatStats[style + 'Damage']) *
                    (1 + damageRatioBoost) *
                    (1 + damageRatioBoostFromFury);
                const baseEvasion =
                    (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + 'Evasion']);
                this.combatDetails[style + 'EvasionRating'] = baseEvasion;
                const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
                for (const boost of evasionBoosts) {
                    this.combatDetails[style + 'EvasionRating'] += boost.flatBoost;
                    this.combatDetails[style + 'EvasionRating'] += baseEvasion * boost.ratioBoost;
                }
            });

            this.combatDetails.defensiveMaxDamage =
                (10 + this.combatDetails.defenseLevel) *
                (1 + this.combatDetails.combatStats.defensiveDamage) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);

            // when equiped bulwark
            if (this.equipment?.['/equipment_types/two_hand']?.hrid.includes('bulwark')) {
                this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;
            }

            this.combatDetails.rangedAccuracyRating =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats.rangedAccuracy) *
                (1 + accuracyRatioBoost) *
                (1 + accuracyRatioBoostFromFury);
            this.combatDetails.rangedMaxDamage =
                (10 + this.combatDetails.rangedLevel) *
                (1 + this.combatDetails.combatStats.rangedDamage) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);

            const baseRangedEvasion =
                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
            this.combatDetails.rangedEvasionRating = baseRangedEvasion;
            const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
            for (const boost of evasionBoosts) {
                this.combatDetails.rangedEvasionRating += boost.flatBoost;
                this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
            }

            this.combatDetails.combatStats.damageTaken = this.getBuffBoost('/buff_types/damage_taken').flatBoost;

            this.combatDetails.magicAccuracyRating =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats.magicAccuracy) *
                (1 + accuracyRatioBoost) *
                (1 + accuracyRatioBoostFromFury);
            this.combatDetails.magicMaxDamage =
                (10 + this.combatDetails.magicLevel) *
                (1 + this.combatDetails.combatStats.magicDamage) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);

            const baseMagicEvasion =
                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);
            this.combatDetails.magicEvasionRating = baseMagicEvasion;
            for (const boost of evasionBoosts) {
                this.combatDetails.magicEvasionRating += boost.flatBoost;
                this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
            }

            this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost('/buff_types/physical_amplify').flatBoost;
            this.combatDetails.combatStats.waterAmplify += this.getBuffBoost('/buff_types/water_amplify').flatBoost;
            this.combatDetails.combatStats.natureAmplify += this.getBuffBoost('/buff_types/nature_amplify').flatBoost;
            this.combatDetails.combatStats.fireAmplify += this.getBuffBoost('/buff_types/fire_amplify').flatBoost;
            this.combatDetails.combatStats.healingAmplify += this.getBuffBoost('/buff_types/healing_amplify').flatBoost;

            this.combatDetails.combatStats.attackInterval /= 1 + this.combatDetails.attackLevel / 2000;

            const baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
            this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;
            const attackIntervalBoosts = this.getBuffBoosts('/buff_types/attack_speed');
            const attackIntervalRatioBoost = attackIntervalBoosts
                .map((boost) => boost.ratioBoost)
                .reduce((prev, cur) => prev + cur, 0);
            this.combatDetails.combatStats.attackInterval /= 1 + attackIntervalRatioBoost;

            const baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
            this.combatDetails.totalArmor = baseArmor;
            const armorBoosts = this.getBuffBoosts('/buff_types/armor');
            for (const boost of armorBoosts) {
                this.combatDetails.totalArmor += boost.flatBoost;
                this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
            }

            const baseWaterResistance =
                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.waterResistance;
            this.combatDetails.totalWaterResistance = baseWaterResistance;
            const waterResistanceBoosts = this.getBuffBoosts('/buff_types/water_resistance');
            for (const boost of waterResistanceBoosts) {
                this.combatDetails.totalWaterResistance += boost.flatBoost;
                this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
            }

            const baseNatureResistance =
                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.natureResistance;
            this.combatDetails.totalNatureResistance = baseNatureResistance;
            const natureResistanceBoosts = this.getBuffBoosts('/buff_types/nature_resistance');
            for (const boost of natureResistanceBoosts) {
                this.combatDetails.totalNatureResistance += boost.flatBoost;
                this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
            }

            const baseFireResistance =
                0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.fireResistance;
            this.combatDetails.totalFireResistance = baseFireResistance;
            const fireResistanceBoosts = this.getBuffBoosts('/buff_types/fire_resistance');
            for (const boost of fireResistanceBoosts) {
                this.combatDetails.totalFireResistance += boost.flatBoost;
                this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
            }

            const hpRegenBoosts = this.getBuffBoost('/buff_types/hp_regen');
            this.combatDetails.combatStats.hpRegenPer10 +=
                this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
            this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

            const mpRegenBoosts = this.getBuffBoost('/buff_types/mp_regen');
            this.combatDetails.combatStats.mpRegenPer10 +=
                this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
            this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

            this.combatDetails.combatStats.lifeSteal += this.getBuffBoost('/buff_types/life_steal').flatBoost;
            this.combatDetails.combatStats.physicalThorns += this.getBuffBoost('/buff_types/physical_thorns').flatBoost;
            this.combatDetails.combatStats.elementalThorns += this.getBuffBoost('/buff_types/elemental_thorns').flatBoost;
            this.combatDetails.combatStats.combatExperience += this.getBuffBoost('/buff_types/wisdom').flatBoost;
            this.combatDetails.combatStats.criticalRate += this.getBuffBoost('/buff_types/critical_rate').flatBoost;
            this.combatDetails.combatStats.criticalDamage += this.getBuffBoost('/buff_types/critical_damage').flatBoost;

            this.combatDetails.combatStats.castSpeed += this.getBuffBoost('/buff_types/cast_speed').flatBoost;
            this.combatDetails.combatStats.castSpeed += this.combatDetails['attackLevel'] / 2000;

            const combatDropRateBoosts = this.getBuffBoost('/buff_types/combat_drop_rate');
            this.combatDetails.combatStats.combatDropRate +=
                (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
            this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
            const combatRareFindBoosts = this.getBuffBoost('/buff_types/rare_find');
            this.combatDetails.combatStats.combatRareFind +=
                (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
            this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;
            const combatDropQuantityBoosts = this.getBuffBoost('/buff_types/combat_drop_quantity');
            this.combatDetails.combatStats.combatDropQuantity +=
                (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;
            this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;

            const baseThreat = 100 + this.combatDetails.combatStats.threat;
            const threatBoosts = this.getBuffBoost('/buff_types/threat');
            const effectiveThreat = baseThreat * (1 + threatBoosts.ratioBoost) + threatBoosts.flatBoost;
            this.combatDetails.totalThreat = effectiveThreat;
            this.combatDetails.combatStats.threat = effectiveThreat;

            this.combatDetails.combatStats.retaliation += this.getBuffBoost('/buff_types/retaliation').flatBoost;
            this.combatDetails.combatStats.tenacity += this.getBuffBoost('/buff_types/tenacity').flatBoost;
        }

        addBuff(buff, currentTime) {
            const ownedBuff = { ...buff, startTime: currentTime };
            this.combatBuffs[ownedBuff.uniqueHrid] = ownedBuff;

            this.updateCombatDetails();
        }

        /**
         * Official party Aura family only (CSIM-AUD-001): strongest-source-wins with automatic
         * fallback to the next-strongest still-active source when the winning source expires.
         * Ordinary buffs must keep using addBuff()'s last-write-wins semantics.
         * @param {Object} buff
         * @param {string} sourceHrid - hrid of the casting unit
         * @param {number} currentTime
         */
        addAuraBuff(buff, sourceHrid, currentTime) {
            if (!this.auraSources[buff.uniqueHrid]) {
                this.auraSources[buff.uniqueHrid] = {};
            }
            this.auraSources[buff.uniqueHrid][sourceHrid] = { ...buff, startTime: currentTime };
            this._recomputeAuraBuff(buff.uniqueHrid);

            this.updateCombatDetails();
        }

        /** @private */
        _recomputeAuraBuff(uniqueHrid) {
            const sources = Object.values(this.auraSources[uniqueHrid] || {});
            if (sources.length === 0) {
                delete this.combatBuffs[uniqueHrid];
                return;
            }
            const strongest = sources.reduce((best, candidate) =>
                candidate.ratioBoost + candidate.flatBoost > best.ratioBoost + best.flatBoost ? candidate : best
            );
            this.combatBuffs[uniqueHrid] = strongest;
        }

        removeBuff(buff) {
            if (!this.combatBuffs[buff.uniqueHrid]) {
                return;
            }
            delete this.combatBuffs[buff.uniqueHrid];

            this.updateCombatDetails();
        }

        /**
         * Update fury accuracy and damage buffs in a single batch, calling updateCombatDetails() once.
         * @param {number} furyAmount - Current fury stack count (0-5)
         * @param {number} furyStat - Fury combat stat value
         * @param {number} currentTime - Simulation time for buff start
         * @param {number} duration - Buff duration (fury expire time)
         */
        updateFuryBuffs(furyAmount, furyStat, currentTime, duration) {
            if (furyAmount > 0) {
                this.combatBuffs['/buff_uniques/fury_accuracy'] = {
                    uniqueHrid: '/buff_uniques/fury_accuracy',
                    typeHrid: '/buff_types/fury_accuracy',
                    ratioBoost: furyAmount * furyStat,
                    ratioBoostLevelBonus: 0,
                    flatBoost: 0,
                    flatBoostLevelBonus: 0,
                    startTime: currentTime,
                    duration: duration,
                };
                this.combatBuffs['/buff_uniques/fury_damage'] = {
                    uniqueHrid: '/buff_uniques/fury_damage',
                    typeHrid: '/buff_types/fury_damage',
                    ratioBoost: furyAmount * furyStat,
                    ratioBoostLevelBonus: 0,
                    flatBoost: 0,
                    flatBoostLevelBonus: 0,
                    startTime: currentTime,
                    duration: duration,
                };
            } else {
                delete this.combatBuffs['/buff_uniques/fury_accuracy'];
                delete this.combatBuffs['/buff_uniques/fury_damage'];
            }
            this.updateCombatDetails();
        }

        addPermanentBuff(buff) {
            if (this.permanentBuffs[buff.typeHrid]) {
                this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
                this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
            } else {
                this.permanentBuffs[buff.typeHrid] = { ...buff };
            }
        }

        generatePermanentBuffs() {
            for (let i = 0; i < this.houseRooms.length; i++) {
                const houseRoom = this.houseRooms[i];
                houseRoom.buffs.forEach((buff) => {
                    this.addPermanentBuff(buff);
                });
            }
            for (let i = 0; i < this.shrines.length; i++) {
                const shrine = this.shrines[i];
                shrine.buffs.forEach((buff) => {
                    this.addPermanentBuff(buff);
                });
            }
            if (this.zoneBuffs) {
                this.zoneBuffs.forEach((buff) => {
                    this.addPermanentBuff(buff);
                });
            }
            if (this.extraBuffs) {
                this.extraBuffs.forEach((buff) => {
                    this.addPermanentBuff(buff);
                });
            }
            if (this.achievements) {
                this.achievements.buffs.forEach((buff) => {
                    this.addPermanentBuff(buff);
                });
            }
        }

        removeExpiredBuffs(currentTime) {
            const expiredBuffs = Object.values(this.combatBuffs).filter(
                (buff) => buff.startTime + buff.duration <= currentTime
            );
            expiredBuffs.forEach((buff) => {
                delete this.combatBuffs[buff.uniqueHrid];
            });

            // Aura sources are tracked per-caster so the effective buff can fall back to the
            // next-strongest still-active source instead of just disappearing when only the
            // strongest source's contribution expires.
            Object.keys(this.auraSources).forEach((uniqueHrid) => {
                const sources = this.auraSources[uniqueHrid];
                let changed = false;
                Object.keys(sources).forEach((sourceHrid) => {
                    const buff = sources[sourceHrid];
                    if (buff.startTime + buff.duration <= currentTime) {
                        delete sources[sourceHrid];
                        changed = true;
                    }
                });
                if (changed) {
                    this._recomputeAuraBuff(uniqueHrid);
                }
            });

            this.updateCombatDetails();
        }

        clearBuffs() {
            this.combatBuffs = structuredClone(this.permanentBuffs);
            this.auraSources = {};
            this.furyAmount = 0;
            this.furyExpireTime = 0;
            this.updateCombatDetails();
        }

        clearCCs() {
            this.isStunned = false;
            this.stunExpireTime = null;
            this.isSilenced = false;
            this.silenceExpireTime = null;
            this.isBlinded = false;
            this.blindExpireTime = null;
            this.combatDetails.combatStats.damageTaken = 0;
        }

        getBuffBoosts(type) {
            const boosts = [];
            Object.values(this.combatBuffs)
                .filter((buff) => buff.typeHrid === type)
                .forEach((buff) => {
                    boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });
                });

            return boosts;
        }

        getBuffBoost(type) {
            const boosts = this.getBuffBoosts(type);

            const boost = {
                ratioBoost: 0,
                flatBoost: 0,
            };

            for (let i = 0; i < boosts.length; i++) {
                boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
                boost.flatBoost += boosts[i]?.flatBoost ?? 0;
            }

            return boost;
        }

        reset(currentTime = 0) {
            this.clearCCs();

            if (currentTime === 0 || !this.isPlayer) {
                // First combat start or enemy reset: full reset
                this.clearBuffs();
                this.resetCooldowns(currentTime);
            } else {
                // Dungeon wipe restart (players only): remove expired buffs, keep cooldowns
                this.removeExpiredBuffs(currentTime);
            }

            this.updateCombatDetails();
            this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
            this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
        }

        resetCooldowns(currentTime = 0) {
            this.food.filter((food) => food !== null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));
            this.drinks.filter((drink) => drink !== null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));

            const haste = this.combatDetails.combatStats.abilityHaste;

            this.abilities
                .filter((ability) => ability !== null)
                .forEach((ability) => {
                    if (this.isPlayer) {
                        ability.lastUsed = Number.MIN_SAFE_INTEGER;
                    } else {
                        let cooldownDuration = ability.cooldownDuration;
                        if (haste > 0) {
                            cooldownDuration = (cooldownDuration * 100) / (100 + haste);
                        }
                        // Labyrinth monsters (roomLevel > 0) always start at exactly half their cooldown;
                        // zone monsters start at a random point between half and full.
                        const randomOffset = this.roomLevel > 0 ? 0 : Math.floor(Math.random() * cooldownDuration * 0.5);
                        ability.lastUsed = currentTime - Math.floor(cooldownDuration * 0.5) + randomOffset;
                    }
                });
        }

        addHitpoints(hitpoints) {
            let hitpointsAdded = 0;

            if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {
                return hitpointsAdded;
            }

            const newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);
            hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
            this.combatDetails.currentHitpoints = newHitpoints;

            return hitpointsAdded;
        }

        addManapoints(manapoints) {
            let manapointsAdded = 0;

            if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {
                return manapointsAdded;
            }

            const newManapoints = Math.min(
                this.combatDetails.currentManapoints + manapoints,
                this.combatDetails.maxManapoints
            );
            manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
            this.combatDetails.currentManapoints = newManapoints;

            return manapointsAdded;
        }
    }

    class Consumable {
        constructor(hrid, triggers = null) {
            this.hrid = hrid;

            const itemDetailMap = getGameData().itemDetailMap;
            const gameConsumable = itemDetailMap[this.hrid];
            if (!gameConsumable) {
                throw new Error('No consumable found for hrid: ' + this.hrid);
            }

            this.cooldownDuration = gameConsumable.consumableDetail.cooldownDuration;
            this.hitpointRestore = gameConsumable.consumableDetail.hitpointRestore;
            this.manapointRestore = gameConsumable.consumableDetail.manapointRestore;
            this.recoveryDuration = gameConsumable.consumableDetail.recoveryDuration;
            this.catagoryHrid = gameConsumable.categoryHrid;

            this.buffs = [];
            if (gameConsumable.consumableDetail.buffs) {
                for (const consumableBuff of gameConsumable.consumableDetail.buffs) {
                    const buff = new Buff(consumableBuff);
                    this.buffs.push(buff);
                }
            }

            if (triggers) {
                this.triggers = triggers;
            } else {
                this.triggers = [];
                for (const defaultTrigger of gameConsumable.consumableDetail.defaultCombatTriggers) {
                    const trigger = new Trigger(
                        defaultTrigger.dependencyHrid,
                        defaultTrigger.conditionHrid,
                        defaultTrigger.comparatorHrid,
                        defaultTrigger.value
                    );
                    this.triggers.push(trigger);
                }
            }

            this.lastUsed = Number.MIN_SAFE_INTEGER;
        }

        static createFromDTO(dto) {
            const triggers = dto.triggers ? dto.triggers.map((trigger) => Trigger.createFromDTO(trigger)) : null;
            const consumable = new Consumable(dto.hrid, triggers);

            return consumable;
        }

        shouldTrigger(currentTime, source, target, friendlies, enemies) {
            if (source.isStunned) {
                return false;
            }
            let consumableHaste;
            if (this.catagoryHrid.includes('food')) {
                consumableHaste = source.combatDetails.combatStats.foodHaste;
            } else {
                consumableHaste = source.combatDetails.combatStats.drinkConcentration;
            }
            let cooldownDuration = this.cooldownDuration;
            if (consumableHaste > 0) {
                cooldownDuration = cooldownDuration / (1 + consumableHaste);
            }

            if (this.lastUsed + cooldownDuration > currentTime) {
                return false;
            }

            if (this.triggers.length === 0) {
                return true;
            }

            let shouldTrigger = true;
            for (const trigger of this.triggers) {
                if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
                    shouldTrigger = false;
                }
            }

            return shouldTrigger;
        }
    }

    class Equipment {
        constructor(hrid, enhancementLevel) {
            this.hrid = hrid;
            const gameData = getGameData();
            const gameItem = gameData.itemDetailMap[this.hrid];
            if (!gameItem) {
                throw new Error('No equipment found for hrid: ' + this.hrid);
            }
            this.gameItem = gameItem;
            this.enhancementLevel = enhancementLevel;
        }

        static createFromDTO(dto) {
            const equipment = new Equipment(dto.hrid, dto.enhancementLevel);

            return equipment;
        }

        getCombatStat(combatStat) {
            const gameData = getGameData();
            const multiplier = gameData.enhancementLevelTotalBonusMultiplierTable[this.enhancementLevel];
            if (this.gameItem.equipmentDetail.combatStats[combatStat]) {
                const enhancementBonus = this.gameItem.equipmentDetail.combatEnhancementBonuses[combatStat] || 0;
                const stat = this.gameItem.equipmentDetail.combatStats[combatStat] + multiplier * enhancementBonus;
                return stat;
            }
            return 0;
        }

        getCombatStyle() {
            return this.gameItem.equipmentDetail.combatStats.combatStyleHrids[0];
        }

        getDamageType() {
            return this.gameItem.equipmentDetail.combatStats.damageType;
        }

        getPrimaryTraining() {
            return this.gameItem.equipmentDetail.combatStats.primaryTraining;
        }

        getFocusTraining() {
            return this.gameItem.equipmentDetail.combatStats.focusTraining;
        }
    }

    /**
     * A house room applies two kinds of buffs from the game's own houseRoomDetailMap:
     * - actionBuffs: only meaningful for the room's own skill (e.g. Observatory's action_speed is
     *   for Enhancing). The game data itself only marks this restriction at the room level, via
     *   `usableInActionTypeMap` - individual buff entries carry no such field - so this class is a
     *   combat unit, and must only include actionBuffs for a room whose usableInActionTypeMap
     *   includes /action_types/combat (e.g. Armory, Dojo). Skilling-only rooms (Observatory,
     *   Laboratory, Sewing Parlor, Workshop, etc.) contribute none.
     * - globalBuffs: always wisdom + rare_find, with no action-type restriction in the game's own
     *   data - these apply from every room regardless of its skill.
     */
    class HouseRoom {
        constructor(hrid, level) {
            this.hrid = hrid;
            this.level = level;

            const gameData = getGameData();
            const gameHouseRoom = gameData.houseRoomDetailMap[this.hrid];
            if (!gameHouseRoom) {
                throw new Error('No house room found for hrid: ' + this.hrid);
            }

            this.buffs = [];
            if (gameHouseRoom.actionBuffs && gameHouseRoom.usableInActionTypeMap?.['/action_types/combat']) {
                for (const actionBuff of gameHouseRoom.actionBuffs) {
                    const buff = new Buff(actionBuff, level);
                    this.buffs.push(buff);
                }
            }
            if (gameHouseRoom.globalBuffs) {
                for (const globalBuff of gameHouseRoom.globalBuffs) {
                    const buff = new Buff(globalBuff, level);
                    this.buffs.push(buff);
                }
            }
        }
    }

    /**
     * A guild Shrine applies combat buffs constructed generically from the game's own
     * guildBuffDetailMap, never a hardcoded shrine-specific formula. `guildBuffDetailMap` entries are
     * grouped by `shrineHrid` and flagged `isCombat` - a shrine can have more than one combat buff
     * entry (e.g. Tempo has attack_speed and cast_speed), so every matching entry contributes.
     */
    class Shrine {
        constructor(hrid, level) {
            this.hrid = hrid;
            this.level = level;

            const gameData = getGameData();
            const guildBuffDetailMap = gameData.guildBuffDetailMap || {};

            this.buffs = [];
            for (const guildBuff of Object.values(guildBuffDetailMap)) {
                if (guildBuff.shrineHrid !== hrid || !guildBuff.isCombat) continue;
                for (const rawBuff of guildBuff.buffs || []) {
                    this.buffs.push(new Buff(rawBuff, level));
                }
            }
        }
    }

    class Player extends CombatUnit {
        equipment = {
            '/equipment_types/head': null,
            '/equipment_types/body': null,
            '/equipment_types/legs': null,
            '/equipment_types/feet': null,
            '/equipment_types/hands': null,
            '/equipment_types/main_hand': null,
            '/equipment_types/two_hand': null,
            '/equipment_types/off_hand': null,
            '/equipment_types/pouch': null,
            '/equipment_types/back': null,
            '/equipment_types/neck': null,
            '/equipment_types/earrings': null,
            '/equipment_types/ring': null,
            '/equipment_types/charm': null,
        };

        constructor() {
            super();

            this.isPlayer = true;
            this.hrid = 'player';
        }

        static createFromDTO(dto) {
            const player = new Player();

            player.staminaLevel = dto.staminaLevel;
            player.intelligenceLevel = dto.intelligenceLevel;
            player.attackLevel = dto.attackLevel;
            player.meleeLevel = dto.meleeLevel;
            player.defenseLevel = dto.defenseLevel;
            player.rangedLevel = dto.rangedLevel;
            player.magicLevel = dto.magicLevel;

            player.hrid = dto.hrid;

            for (const [key, value] of Object.entries(dto.equipment)) {
                player.equipment[key] = value ? Equipment.createFromDTO(value) : null;
            }

            player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));
            player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));
            player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));
            Object.entries(dto.houseRooms).forEach((houseRoom) => {
                if (houseRoom[1] > 0) {
                    player.houseRooms.push(new HouseRoom(houseRoom[0], houseRoom[1]));
                }
            });
            Object.entries(dto.shrineLevels || {}).forEach(([shrineHrid, level]) => {
                if (level > 0) {
                    player.shrines.push(new Shrine(shrineHrid, level));
                }
            });

            player.debuffOnLevelGap = dto.debuffOnLevelGap;
            player.personalCombatBuffs = dto.personalCombatBuffs || { buffs: [] };
            player.characterAchievements = dto.characterAchievements || [];
            player.achievements = new Achievement(player.characterAchievements);
            // Active Monster-task target hrids (CSIM-AUD-023) - explicitly empty/unknown for imported
            // party members whose task state is unavailable, never inherited from another player.
            player.taskEligibleMonsterHrids = dto.taskEligibleMonsterHrids || [];

            return player;
        }

        updateCombatDetails() {
            if (this.equipment['/equipment_types/main_hand']) {
                this.combatDetails.combatStats.combatStyleHrid =
                    this.equipment['/equipment_types/main_hand'].getCombatStyle();
                this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/main_hand'].getDamageType();
                this.combatDetails.combatStats.attackInterval =
                    this.equipment['/equipment_types/main_hand'].getCombatStat('attackInterval');
                this.combatDetails.combatStats.primaryTraining =
                    this.equipment['/equipment_types/main_hand'].getPrimaryTraining();
            } else if (this.equipment['/equipment_types/two_hand']) {
                this.combatDetails.combatStats.combatStyleHrid =
                    this.equipment['/equipment_types/two_hand'].getCombatStyle();
                this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/two_hand'].getDamageType();
                this.combatDetails.combatStats.attackInterval =
                    this.equipment['/equipment_types/two_hand'].getCombatStat('attackInterval');
                this.combatDetails.combatStats.primaryTraining =
                    this.equipment['/equipment_types/two_hand'].getPrimaryTraining();
            } else {
                this.combatDetails.combatStats.combatStyleHrid = '/combat_styles/smash';
                this.combatDetails.combatStats.damageType = '/damage_types/physical';
                this.combatDetails.combatStats.attackInterval = 3000000000;
                this.combatDetails.combatStats.primaryTraining = '/skills/melee';
            }

            if (this.equipment['/equipment_types/charm']) {
                this.combatDetails.combatStats.focusTraining = this.equipment['/equipment_types/charm'].getFocusTraining();
            } else {
                this.combatDetails.combatStats.focusTraining = '';
            }

            [
                'stabAccuracy',
                'slashAccuracy',
                'smashAccuracy',
                'rangedAccuracy',
                'magicAccuracy',
                'stabDamage',
                'slashDamage',
                'smashDamage',
                'rangedDamage',
                'magicDamage',
                'defensiveDamage',
                'taskDamage',
                'physicalAmplify',
                'waterAmplify',
                'natureAmplify',
                'fireAmplify',
                'healingAmplify',
                'stabEvasion',
                'slashEvasion',
                'smashEvasion',
                'rangedEvasion',
                'magicEvasion',
                'armor',
                'waterResistance',
                'natureResistance',
                'fireResistance',
                'maxHitpoints',
                'maxManapoints',
                'lifeSteal',
                'hpRegenPer10',
                'mpRegenPer10',
                'physicalThorns',
                'elementalThorns',
                'combatDropRate',
                'combatRareFind',
                'combatDropQuantity',
                'combatExperience',
                'criticalRate',
                'criticalDamage',
                'armorPenetration',
                'waterPenetration',
                'naturePenetration',
                'firePenetration',
                'abilityHaste',
                'tenacity',
                'manaLeech',
                'castSpeed',
                'threat',
                'parry',
                'mayhem',
                'pierce',
                'curse',
                'fury',
                'weaken',
                'ripple',
                'bloom',
                'blaze',
                'attackSpeed',
                'foodHaste',
                'drinkConcentration',
                'autoAttackDamage',
                'abilityDamage',
                'staminaExperience',
                'intelligenceExperience',
                'attackExperience',
                'defenseExperience',
                'meleeExperience',
                'rangedExperience',
                'magicExperience',
                'retaliation',
                'maxHitpointsRatio',
                'maxManapointsRatio',
            ].forEach((stat) => {
                this.combatDetails.combatStats[stat] = Object.values(this.equipment)
                    .filter((equipment) => equipment != null)
                    .map((equipment) => equipment.getCombatStat(stat))
                    .reduce((prev, cur) => prev + cur, 0);
            });

            if (this.equipment['/equipment_types/pouch']) {
                this.combatDetails.combatStats.foodSlots =
                    1 + this.equipment['/equipment_types/pouch'].getCombatStat('foodSlots');
                this.combatDetails.combatStats.drinkSlots =
                    1 + this.equipment['/equipment_types/pouch'].getCombatStat('drinkSlots');
            } else {
                this.combatDetails.combatStats.foodSlots = 1;
                this.combatDetails.combatStats.drinkSlots = 1;
            }

            super.updateCombatDetails();
        }
    }

    /**
     * Ability Timing Calculator
     * Computes the current character's LIVE effective ability cooldown/cast time,
     * accounting for Ability Haste, Cast Speed, and Attack level - values the native
     * ability tooltip never applies (it only ever shows the static base numbers).
     */


    const COMBAT_ACTION_TYPE = '/action_types/combat';
    const CAST_SPEED_BUFF_TYPE = '/buff_types/cast_speed';

    // House and equipment are already reconstructed by Player.generatePermanentBuffs(), so summing
    // them again here would double-count. Only the remaining live buff-map sources are added.
    const LIVE_CAST_SPEED_BUFF_MAPS = [
        'consumableActionTypeBuffsMap',
        'personalActionTypeBuffsMap',
        'achievementActionTypeBuffsMap',
        'mooPassActionTypeBuffsMap',
        'communityActionTypeBuffsMap',
        'guildActionTypeBuffsMap',
    ];

    /**
     * Sum the /buff_types/cast_speed flat boost currently active for combat, across every live
     * buff-map source other than equipment/house (those are already covered by the reconstructed
     * Player's permanent buffs).
     * @param {Object} characterData - dataManager.characterData
     * @returns {number} Combined flat boost (e.g. 0.12 for Channeling Coffee)
     */
    function getLiveCastSpeedFlatBoost(characterData) {
        let total = 0;
        for (const mapName of LIVE_CAST_SPEED_BUFF_MAPS) {
            const buffs = characterData?.[mapName]?.[COMBAT_ACTION_TYPE];
            if (!Array.isArray(buffs)) continue;
            for (const buff of buffs) {
                if (buff?.typeHrid === CAST_SPEED_BUFF_TYPE) {
                    total += buff.flatBoost || 0;
                }
            }
        }
        return total;
    }

    /**
     * Compute the current character's live effective combat stats relevant to ability timing.
     * Reconstructs a Player instance from current equipment + house rooms (same engine Combat Sim
     * uses), then adds active temporary buffs (consumables, seals, achievements, moo pass,
     * community, guild) that the reconstruction itself doesn't cover.
     * @returns {{abilityHaste: number, castSpeed: number, attackLevel: number}|null}
     */
    function getCurrentAbilityTimingStats() {
        const gameData = buildGameDataPayload();
        if (!gameData) return null;

        const dto = buildPlayerDTO();
        if (!dto) return null;

        setGameData(gameData);
        const player = Player.createFromDTO(dto);
        // Base CombatUnit defaults zoneBuffs/extraBuffs to {} (not arrays); generatePermanentBuffs()
        // calls .forEach() on them, so they must be real arrays even though no zone/labyrinth is
        // in play here. Only equipment/house-room buffs are relevant to this standalone reconstruction.
        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
        player.clearBuffs();

        const liveCastSpeedBoost = getLiveCastSpeedFlatBoost(dataManager.characterData);

        return {
            abilityHaste: player.combatDetails.combatStats.abilityHaste,
            castSpeed: player.combatDetails.combatStats.castSpeed + liveCastSpeedBoost,
            attackLevel: player.attackLevel,
        };
    }

    /**
     * Compute effective cooldown/cast time (seconds) for an ability, given base durations in
     * nanoseconds (as stored in abilityDetailMap) and live combat stats.
     * @param {number} baseCooldownNs - abilityDetailMap.cooldownDuration (nanoseconds)
     * @param {number} baseCastDurationNs - abilityDetailMap.castDuration (nanoseconds)
     * @param {{abilityHaste: number, castSpeed: number}} stats - Live combat stats
     * @returns {{baseCooldown: number, effectiveCooldown: number, baseCastTime: number, effectiveCastTime: number}}
     */
    function calculateEffectiveAbilityTiming(baseCooldownNs, baseCastDurationNs, stats) {
        const baseCooldown = baseCooldownNs / 1e9;
        const baseCastTime = baseCastDurationNs / 1e9;

        const effectiveCooldown = stats.abilityHaste > 0 ? (baseCooldown * 100) / (100 + stats.abilityHaste) : baseCooldown;
        const effectiveCastTime = baseCastTime / (1 + stats.castSpeed);

        return { baseCooldown, effectiveCooldown, baseCastTime, effectiveCastTime };
    }

    var abilityTimingCalculator = /*#__PURE__*/Object.freeze({
        __proto__: null,
        calculateEffectiveAbilityTiming: calculateEffectiveAbilityTiming,
        getCurrentAbilityTimingStats: getCurrentAbilityTimingStats
    });

    /**
     * Skilling Sim Helpers
     * Pure functions that convert editor state into buff arrays
     * for use with LabyrinthClearRate.getSkillingMetricsFromOverrides().
     */


    const PRODUCTION_SKILLS = [
        '/action_types/alchemy',
        '/action_types/brewing',
        '/action_types/cheesesmithing',
        '/action_types/cooking',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    const GATHERING_SKILLS = ['/action_types/foraging', '/action_types/milking', '/action_types/woodcutting'];

    /**
     * Convert editor equipment DTO format to the Map format the equipment parser expects.
     * DTO: { '/equipment_types/body': { hrid, enhancementLevel } }
     * Parser: Map<'/item_locations/body', { itemHrid, enhancementLevel }>
     * @param {Object} editorEquipment - Equipment from DTO
     * @returns {Map}
     */
    function toEquipmentMap(editorEquipment) {
        const map = new Map();
        for (const [slot, item] of Object.entries(editorEquipment || {})) {
            if (!item?.hrid) continue;
            const locationKey = slot.replace('/equipment_types/', '/item_locations/');
            map.set(locationKey, { itemHrid: item.hrid, enhancementLevel: item.enhancementLevel || 0 });
        }
        return map;
    }

    /**
     * Build equipment buff array for a specific action type from editor equipment.
     * @param {Object} editorEquipment - { '/equipment_types/body': { hrid, enhancementLevel } }
     * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
     * @param {Object} itemDetailMap - From gameData
     * @returns {Array} Buff objects compatible with getSkillingMetricsFromOverrides()
     */
    function buildEquipmentBuffsForSkill(editorEquipment, actionTypeHrid, itemDetailMap) {
        const equipMap = toEquipmentMap(editorEquipment);
        const buffs = [];

        const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipMap, actionTypeHrid, itemDetailMap);
        if (speedBonus > 0) {
            buffs.push({ typeHrid: '/buff_types/action_speed', flatBoost: speedBonus, ratioBoost: 0 });
        }

        const efficiencyBonus = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipMap, actionTypeHrid, itemDetailMap);
        if (efficiencyBonus > 0) {
            buffs.push({ typeHrid: '/buff_types/efficiency', flatBoost: efficiencyBonus / 100, ratioBoost: 0 });
        }

        const successBonus = equipmentParser_js.parseEquipmentSuccessBonuses(equipMap, actionTypeHrid, itemDetailMap);
        if (successBonus > 0) {
            const skillId = actionTypeHrid.replace('/action_types/', '');
            buffs.push({ typeHrid: `/buff_types/${skillId}_success`, flatBoost: 0, ratioBoost: successBonus });
        }

        return buffs;
    }

    /**
     * Build community buff array for a specific action type from editor levels.
     * @param {Object} communityBuffLevels - { productionEfficiency, enhancingSpeed, gatheringQuantity, experience }
     * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
     * @returns {Array} Buff objects
     */
    function buildCommunityBuffsForSkill(communityBuffLevels, actionTypeHrid) {
        const buffs = [];
        if (!communityBuffLevels) return buffs;

        if (PRODUCTION_SKILLS.includes(actionTypeHrid) && communityBuffLevels.productionEfficiency > 0) {
            const level = communityBuffLevels.productionEfficiency;
            const value = 0.14 + (level - 1) * 0.003;
            buffs.push({ typeHrid: '/buff_types/efficiency', flatBoost: value, ratioBoost: 0 });
        }

        if (actionTypeHrid === '/action_types/enhancing' && communityBuffLevels.enhancingSpeed > 0) {
            const level = communityBuffLevels.enhancingSpeed;
            const value = 0.2 + (level - 1) * 0.005;
            buffs.push({ typeHrid: '/buff_types/action_speed', flatBoost: value, ratioBoost: 0 });
        }

        if (GATHERING_SKILLS.includes(actionTypeHrid) && communityBuffLevels.gatheringQuantity > 0) {
            const level = communityBuffLevels.gatheringQuantity;
            const value = 0.2 + (level - 1) * 0.005;
            buffs.push({ typeHrid: '/buff_types/gathering', flatBoost: value, ratioBoost: 0 });
        }

        return buffs;
    }

    /**
     * Build house buff array for a specific action type from editor house room levels.
     * The game's own houseRoomDetailMap only marks a room's actionBuffs restriction at the room
     * level via `usableInActionTypeMap` - individual buff entries carry no such field - so this
     * checks the room, not the buff.
     * @param {Object} editorHouseRooms - { '/house_rooms/brewery': level, ... }
     * @param {string} actionTypeHrid - e.g. "/action_types/brewing"
     * @param {Object} houseRoomDetailMap - From gameData
     * @returns {Array} Buff objects
     */
    function buildHouseBuffsForSkill(editorHouseRooms, actionTypeHrid, houseRoomDetailMap) {
        const buffs = [];
        if (!editorHouseRooms || !houseRoomDetailMap) return buffs;

        for (const [hrid, level] of Object.entries(editorHouseRooms)) {
            if (!level || level <= 0) continue;
            const roomDetail = houseRoomDetailMap[hrid];
            if (!roomDetail) continue;

            if (Array.isArray(roomDetail.actionBuffs) && roomDetail.usableInActionTypeMap?.[actionTypeHrid]) {
                for (const buff of roomDetail.actionBuffs) {
                    const flatBoost = (buff.flatBoostLevelBonus || 0) * level;
                    const ratioBoost = (buff.ratioBoostLevelBonus || 0) * level;
                    if (flatBoost === 0 && ratioBoost === 0) continue;
                    buffs.push({ typeHrid: buff.typeHrid, flatBoost, ratioBoost });
                }
            }

            if (Array.isArray(roomDetail.globalBuffs)) {
                for (const buff of roomDetail.globalBuffs) {
                    const flatBoost = (buff.flatBoostLevelBonus || 0) * level;
                    const ratioBoost = (buff.ratioBoostLevelBonus || 0) * level;
                    if (flatBoost === 0 && ratioBoost === 0) continue;
                    buffs.push({ typeHrid: buff.typeHrid, flatBoost, ratioBoost });
                }
            }
        }

        return buffs;
    }

    /**
     * Build crate buff array from selected crate HRIDs.
     * @param {string[]} crateHrids - Array of crate item HRIDs
     * @param {Object} labyrinthCrateDetailMap - From gameData
     * @returns {Array} Buff objects
     */
    function buildCrateBuffs(crateHrids, labyrinthCrateDetailMap) {
        const allBuffs = [];
        if (!labyrinthCrateDetailMap) return allBuffs;

        for (const hrid of crateHrids || []) {
            if (!hrid) continue;
            const buffs = labyrinthCrateDetailMap[hrid];
            if (Array.isArray(buffs)) {
                allBuffs.push(...buffs);
            }
        }
        return allBuffs;
    }

    /**
     * Build the full overrides object for a single skill from editor state.
     * @param {Object} editorState - { equipment, houseRooms, tokenUpgrades, communityBuffLevels }
     * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
     * @param {string[]} crateHrids - Selected crate HRIDs
     * @param {Object} gameData - { itemDetailMap, houseRoomDetailMap, labyrinthCrateDetailMap }
     * @returns {Object} Overrides for getSkillingMetricsFromOverrides()
     */
    function buildOverridesForSkill(editorState, actionTypeHrid, crateHrids, gameData) {
        return {
            equipmentBuffs: buildEquipmentBuffsForSkill(editorState.equipment, actionTypeHrid, gameData.itemDetailMap),
            communityBuffs: buildCommunityBuffsForSkill(editorState.communityBuffLevels, actionTypeHrid),
            houseBuffs: buildHouseBuffsForSkill(editorState.houseRooms, actionTypeHrid, gameData.houseRoomDetailMap),
            crateBuffs: buildCrateBuffs(crateHrids, gameData.labyrinthCrateDetailMap),
            tokenUpgrades: editorState.tokenUpgrades,
        };
    }

    var skillingSimHelpers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        buildCommunityBuffsForSkill: buildCommunityBuffsForSkill,
        buildCrateBuffs: buildCrateBuffs,
        buildEquipmentBuffsForSkill: buildEquipmentBuffsForSkill,
        buildHouseBuffsForSkill: buildHouseBuffsForSkill,
        buildOverridesForSkill: buildOverridesForSkill
    });

    /**
     * Sim Library
     * The headless combat simulator: engine, DTO adapter, worker runners and the inlined worker scripts.
     * The runners hold module-level worker state and the engine holds the game-data singleton, so this
     * library is their single owner. Combat, UI and UI2 reach them through Rollup externals
     * (Toolasha.Sim.*) instead of bundling private copies.
     *
     * Exports to: window.Toolasha.Sim
     *
     * Must be @required AFTER core, utils and market (it depends on them) and BEFORE actions, combat,
     * ui and ui2 (they depend on it). The simulator UIs stay in the Combat library: they import back
     * from Combat and enhancement code, which would make a cycle.
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Sim = {
        combatSimAdapter,
        combatSimRunner,
        allZonesRunner,
        abilityTimingCalculator,
        skillingSimHelpers,
        engineGameData,
        // Default-exported class: consumers import it as a default, so expose the class itself
        enginePlayer: Player,
    };

    console.log('[Toolasha] Sim library loaded');

})(Toolasha.Core.dataManager, Toolasha.Core.storage, Toolasha.Core.loadoutState, Toolasha.Market.expectedValueCalculator, Toolasha.Utils.profitHelpers, Toolasha.Utils.profitConstants, Toolasha.Core.config, Toolasha.Utils.marketData, Toolasha.Core.i18n, Toolasha.Core.domObserver, Toolasha.Core, Toolasha.Utils.teaParser, Toolasha.Utils.actionCalculator, Toolasha.Utils.efficiency, Toolasha.Utils.materialCalculator, Toolasha.Utils.equipmentParser);
