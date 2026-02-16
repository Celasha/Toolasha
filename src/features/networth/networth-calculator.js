/**
 * Networth Calculator
 * Calculates total character networth including:
 * - Equipped items
 * - Inventory items
 * - Market listings
 * - Houses (all 17)
 * - Abilities (equipped + others)
 */

import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateAbilityCost } from '../../utils/ability-cost-calculator.js';
import { calculateHouseBuildCost } from '../../utils/house-cost-calculator.js';
import { calculateEnhancementPath } from '../enhancement/tooltip-enhancement.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { calculateTaskTokenValue } from '../tasks/task-profit-calculator.js';
import { calculateDungeonTokenValue } from '../../utils/token-valuation.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import config from '../../core/config.js';
import networthCache from './networth-cache.js';
import { getItemPrice, getItemPrices } from '../../utils/market-data.js';
import { calculateItemValueBatch } from '../../utils/networth-worker-manager.js';

/**
 * Calculate the value of a single item
 * @param {Object} item - Item data {itemHrid, enhancementLevel, count}
 * @param {Map} priceCache - Optional price cache from getPricesBatch()
 * @returns {number} Total value in coins
 */
export async function calculateItemValue(item, priceCache = null) {
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
                const enhancementParams = getEnhancingParams();
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
                    const enhancementParams = getEnhancingParams();
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
        prices = getItemPrices(itemHrid, enhancementLevel);
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

        const bagPrice = getItemPrice('/items/bag_of_10_cowbells', { mode: 'ask' }) || 0;
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
        return calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
    }
    if (itemHrid === '/items/sinister_token') {
        return calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
    }
    if (itemHrid === '/items/enchanted_token') {
        return calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
    }
    if (itemHrid === '/items/pirate_token') {
        return calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', null) || 0;
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
export function calculateAllHousesCost(characterHouseRooms) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return { totalCost: 0, breakdown: [] };

    const houseRoomDetailMap = gameData.houseRoomDetailMap;
    if (!houseRoomDetailMap) return { totalCost: 0, breakdown: [] };

    let totalCost = 0;
    const breakdown = [];

    for (const [houseRoomHrid, houseData] of Object.entries(characterHouseRooms)) {
        const level = houseData.level || 0;
        if (level === 0) continue;

        const cost = calculateHouseBuildCost(houseRoomHrid, level);
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
export function calculateAllAbilitiesCost(characterAbilities, abilityCombatTriggersMap) {
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

        const cost = calculateAbilityCost(ability.abilityHrid, ability.level);
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
 * Calculate values for multiple items in parallel using workers
 * @param {Array} items - Array of items to value
 * @param {Map} priceCache - Price cache
 * @param {Object} gameData - Game data
 * @returns {Promise<Array>} Array of values in same order as items
 */
async function calculateItemValuesParallel(items, priceCache, gameData) {
    // Prepare configuration options
    const useHighEnhancementCost = config.getSetting('networth_highEnhancementUseCost');
    const minLevel = config.getSetting('networth_highEnhancementMinLevel') || 13;
    const enhancementParams = getEnhancingParams();

    // Separate items into those that need workers vs those that don't
    const itemsNeedingWorkers = [];
    const itemsNotNeedingWorkers = [];
    const itemMapping = []; // Track which original index goes where

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const enhancementLevel = item.enhancementLevel || 0;

        // Check if this specific item needs worker processing
        let needsWorker = false;

        if (enhancementLevel >= 1) {
            // Check if high enhancement cost mode applies
            if (useHighEnhancementCost && enhancementLevel >= minLevel) {
                needsWorker = true;
            } else {
                // Check if market price is missing
                const priceKey = `${item.itemHrid}:${enhancementLevel}`;
                const prices = priceCache ? priceCache.get(priceKey) : null;
                const hasMarketPrice =
                    prices && ((typeof prices === 'number' && prices > 0) || (prices.ask && prices.ask > 0));

                if (!hasMarketPrice) {
                    needsWorker = true;
                }
            }
        }

        if (needsWorker) {
            itemMapping.push({ originalIndex: i, workerIndex: itemsNeedingWorkers.length, useWorker: true });
            itemsNeedingWorkers.push(item);
        } else {
            itemMapping.push({ originalIndex: i, sequentialIndex: itemsNotNeedingWorkers.length, useWorker: false });
            itemsNotNeedingWorkers.push(item);
        }
    }

    // Calculate both groups in parallel
    const [workerResults, sequentialResults] = await Promise.all([
        // Worker group
        itemsNeedingWorkers.length > 0
            ? (async () => {
                  const priceMap = {};
                  if (priceCache) {
                      for (const [key, prices] of priceCache.entries()) {
                          if (typeof prices === 'number') {
                              priceMap[key] = prices;
                          } else if (prices && typeof prices === 'object') {
                              // Store ask and bid WITHOUT coalescing null to 0 (preserve null for "no data" vs "0 price")
                              priceMap[key + '_ask'] = prices.ask;
                              priceMap[key + '_bid'] = prices.bid;
                              // Also store ask at the base key for backward compatibility
                              priceMap[key] = prices.ask;
                          } else {
                              priceMap[key] = 0;
                          }
                      }
                  }

                  try {
                      const values = await calculateItemValueBatch(
                          itemsNeedingWorkers,
                          priceMap,
                          { useHighEnhancementCost, minLevel, enhancementParams },
                          gameData
                      );
                      return values;
                  } catch {
                      // Fallback to sequential for worker items
                      const values = [];
                      for (const item of itemsNeedingWorkers) {
                          values.push(await calculateItemValue(item, priceCache));
                      }
                      return values;
                  }
              })()
            : Promise.resolve([]),

        // Sequential group
        itemsNotNeedingWorkers.length > 0
            ? (async () => {
                  const values = [];
                  for (const item of itemsNotNeedingWorkers) {
                      const value = await calculateItemValue(item, priceCache);
                      values.push(value);
                  }
                  return values;
              })()
            : Promise.resolve([]),
    ]);

    // Reconstruct results in original order
    const finalResults = new Array(items.length);
    for (const mapping of itemMapping) {
        if (mapping.useWorker) {
            finalResults[mapping.originalIndex] = workerResults[mapping.workerIndex];
        } else {
            finalResults[mapping.originalIndex] = sequentialResults[mapping.sequentialIndex];
        }
    }

    return finalResults;
}

/**
 * Calculate total networth
 * @returns {Promise<Object>} Networth data with breakdowns
 */
export async function calculateNetworth() {
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
    const itemsToFetch = new Set();

    // Helper to recursively add upgrade items
    const addItemWithUpgrades = (itemHrid) => {
        if (itemsToFetch.has(itemHrid)) return; // Already added
        itemsToFetch.add(itemHrid);

        // Find the crafting action for this item
        for (const actionHrid in gameData.actionDetailMap) {
            const action = gameData.actionDetailMap[actionHrid];
            if (action.outputItems && action.outputItems.length > 0 && action.outputItems[0].itemHrid === itemHrid) {
                // Add all input materials to price fetch list
                if (action.inputItems) {
                    for (const input of action.inputItems) {
                        if (!itemsToFetch.has(input.itemHrid)) {
                            itemsToFetch.add(input.itemHrid);
                        }
                    }
                }

                // If this item has an upgrade item (e.g., refined items), recursively fetch that too
                if (action.upgradeItemHrid) {
                    addItemWithUpgrades(action.upgradeItemHrid); // Recursive call
                }
                break;
            }
        }
    };

    // Collect all items that need pricing
    for (const item of characterItems) {
        itemsToPrice.push({ itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 });
        addItemWithUpgrades(item.itemHrid); // Add upgrade chain
    }

    // Collect market listings items
    for (const listing of marketListings) {
        itemsToPrice.push({ itemHrid: listing.itemHrid, enhancementLevel: listing.enhancementLevel || 0 });
        addItemWithUpgrades(listing.itemHrid); // Add upgrade chain
    }

    // Add all collected base items at enhancement level 0
    for (const itemHrid of itemsToFetch) {
        itemsToPrice.push({ itemHrid, enhancementLevel: 0 });
    }

    // Batch fetch all prices at once (eliminates ~400 redundant lookups)
    const priceCache = marketAPI.getPricesBatch(itemsToPrice);

    // Calculate equipped items value using workers
    let equippedValue = 0;
    const equippedBreakdown = [];

    const equippedItems = characterItems.filter((item) => item.itemLocationHrid !== '/item_locations/inventory');
    const equippedValues = await calculateItemValuesParallel(equippedItems, priceCache, gameData);

    for (let i = 0; i < equippedItems.length; i++) {
        const item = equippedItems[i];
        const value = equippedValues[i];
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

    // Calculate inventory items value using workers
    let inventoryValue = 0;
    const inventoryBreakdown = [];
    const inventoryByCategory = {};

    // Separate ability books for Fixed Assets section
    let abilityBooksValue = 0;
    const abilityBooksBreakdown = [];

    // Track gold coins separately for header display
    let coinCount = 0;

    const inventoryItems = characterItems.filter((item) => item.itemLocationHrid === '/item_locations/inventory');
    const inventoryValues = await calculateItemValuesParallel(inventoryItems, priceCache, gameData);

    for (let i = 0; i < inventoryItems.length; i++) {
        const item = inventoryItems[i];
        const value = inventoryValues[i];

        // Extract coin count for header display
        if (item.itemHrid === '/items/coin') {
            coinCount = item.count || 0;
        }

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
