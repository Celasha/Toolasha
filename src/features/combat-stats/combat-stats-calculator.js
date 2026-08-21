/**
 * Combat Statistics Calculator
 * Calculates income, profit, consumable costs, and other statistics
 */

import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { calculatePriceAfterTax } from '../../utils/profit-helpers.js';

// Maps regular dungeon chest HRIDs to their required entry key HRIDs (1:1 relationship)
const DUNGEON_CHEST_KEYS = {
    '/items/chimerical_chest': '/items/chimerical_entry_key',
    '/items/sinister_chest': '/items/sinister_entry_key',
    '/items/enchanted_chest': '/items/enchanted_entry_key',
    '/items/pirate_chest': '/items/pirate_entry_key',
};

// Maps dungeon chest HRIDs (regular and refinement) to their required chest key HRIDs (1:1 relationship)
export const DUNGEON_CHEST_CHEST_KEYS = {
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
 * Calculate total income from loot
 * @param {Object} lootMap - totalLootMap from player data
 * @returns {Object} { ask: number, bid: number }
 */
export function calculateIncome(lootMap) {
    let totalAsk = 0;
    let totalBid = 0;

    if (!lootMap) {
        return { ask: 0, bid: 0 };
    }

    for (const loot of Object.values(lootMap)) {
        const itemCount = loot.count;

        // Coins are revenue at face value (1 coin = 1 gold)
        if (loot.itemHrid === '/items/coin') {
            totalAsk += itemCount;
            totalBid += itemCount;
        } else {
            const itemDetails = dataManager.getItemDetails(loot.itemHrid);
            if (itemDetails?.isOpenable) {
                // Openable containers (chests, crates, etc.): use expected value
                const ev =
                    expectedValueCalculator.getCachedValue(loot.itemHrid) ||
                    expectedValueCalculator.calculateSingleContainer(loot.itemHrid);
                if (ev !== null && ev > 0) {
                    totalAsk += ev * itemCount;
                    totalBid += ev * itemCount;
                }
            } else {
                // Other items: get market price
                const prices = marketAPI.getPrice(loot.itemHrid);
                if (prices) {
                    totalAsk += prices.ask * itemCount;
                    totalBid += prices.bid * itemCount;
                }
            }
        }
    }

    return { ask: totalAsk, bid: totalBid };
}

/**
 * Build per-chest income breakdown for expandable Income display
 * Only marks isDungeonRun when regular dungeon chests are present
 * @param {Object} lootMap - totalLootMap from player data
 * @returns {Object} { isDungeonRun: boolean, breakdown: Array }
 */
export function calculateIncomeBreakdown(lootMap) {
    if (!lootMap) {
        return { isDungeonRun: false, breakdown: [] };
    }

    let isDungeonRun = false;
    const breakdown = [];

    for (const loot of Object.values(lootMap)) {
        const itemDetails = dataManager.getItemDetails(loot.itemHrid);
        if (!itemDetails?.isOpenable) {
            continue;
        }

        if (DUNGEON_CHEST_KEYS[loot.itemHrid]) {
            isDungeonRun = true;
        }

        const evData = expectedValueCalculator.isInitialized
            ? expectedValueCalculator.calculateExpectedValue(loot.itemHrid)
            : null;
        const evPerChest = evData?.expectedValue ?? 0;
        const totalValue = evPerChest * loot.count;

        breakdown.push({
            itemHrid: loot.itemHrid,
            itemName: itemDetails.name,
            count: loot.count,
            evPerChest,
            totalValue,
            drops: evData?.drops ?? [],
        });
    }

    return { isDungeonRun, breakdown };
}

/**
 * Value a list of items using the exact same valuation semantics for every caller, so Actual
 * and Expected revenue never disagree because of two different pricing paths. Missing valuation
 * is never treated as a silent zero - the caller is told the total is partial instead.
 * @param {Array<{itemHrid: string, count: number, enhancementLevel?: number}>} items - Items to value
 * @returns {{revenue: number, isPartial: boolean, unvaluedItemHrids: Array<string>}} Valuation result
 */
export function calculateValuedRevenue(items) {
    let revenue = 0;
    let isPartial = false;
    const unvaluedItemHrids = [];

    for (const item of items || []) {
        if (!item?.count) continue;

        const resolved = expectedValueCalculator.resolveSellSideValue(item.itemHrid, item.enhancementLevel || 0);
        if (!resolved) {
            isPartial = true;
            unvaluedItemHrids.push(item.itemHrid);
            continue;
        }

        const itemDetails = dataManager.getItemDetails(item.itemHrid);
        const canBeSold = itemDetails?.isTradable !== false;
        const unitValue = resolved.needsTax && canBeSold ? calculatePriceAfterTax(resolved.value) : resolved.value;

        revenue += unitValue * item.count;
    }

    return { revenue, isPartial, unvaluedItemHrids };
}

/**
 * Calculate entry key costs from dungeon chests dropped
 * Each regular dungeon chest in the loot map represents one entry key consumed
 * @param {Object} lootMap - totalLootMap from player data
 * @param {number} durationSeconds - Combat duration in seconds (for daily rate)
 * @returns {Object} { ask: number, bid: number, dailyCost: number, breakdown: Array }
 */
export function calculateKeyCosts(lootMap, durationSeconds) {
    let totalCost = 0;
    const breakdown = [];

    if (!lootMap) {
        return { ask: 0, bid: 0, dailyCost: 0, breakdown: [] };
    }

    const keyPricingSetting = config.getSettingValue('profitCalc_keyPricingMode') || 'ask';

    for (const loot of Object.values(lootMap)) {
        const keyHrid = DUNGEON_CHEST_KEYS[loot.itemHrid];
        if (!keyHrid) continue;

        const chestCount = loot.count;
        const keyPrices = marketAPI.getPrice(keyHrid);
        if (!keyPrices) continue;

        const keyPrice = keyPrices[keyPricingSetting] ?? keyPrices.ask;
        const itemCost = keyPrice * chestCount;

        totalCost += itemCost;

        const keyDetails = dataManager.getItemDetails(keyHrid);
        const keyName = keyDetails?.name || keyHrid;

        const consumedPerDay = durationSeconds > 0 ? Math.ceil((chestCount / durationSeconds) * 86400) : 0;

        breakdown.push({
            itemHrid: keyHrid,
            itemName: keyName,
            count: chestCount,
            consumedPerDay,
            pricePerItem: keyPrice,
            totalCost: itemCost,
        });
    }

    // Second pass: aggregate chest key costs (regular + refinement chests share the same key)
    const chestKeyCounts = {};
    for (const loot of Object.values(lootMap)) {
        const keyHrid = DUNGEON_CHEST_CHEST_KEYS[loot.itemHrid];
        if (!keyHrid) continue;
        chestKeyCounts[keyHrid] = (chestKeyCounts[keyHrid] || 0) + loot.count;
    }

    for (const [keyHrid, count] of Object.entries(chestKeyCounts)) {
        const keyPrices = marketAPI.getPrice(keyHrid);
        if (!keyPrices) continue;

        const keyPrice = keyPrices[keyPricingSetting] ?? keyPrices.ask;
        const itemCost = keyPrice * count;

        totalCost += itemCost;

        const keyDetails = dataManager.getItemDetails(keyHrid);
        const keyName = keyDetails?.name || keyHrid;
        const consumedPerDay = durationSeconds > 0 ? Math.ceil((count / durationSeconds) * 86400) : 0;

        breakdown.push({
            itemHrid: keyHrid,
            itemName: keyName,
            count,
            consumedPerDay,
            pricePerItem: keyPrice,
            totalCost: itemCost,
        });
    }

    const finalDailyCost = durationSeconds > 0 ? calculateDailyRate(totalCost, durationSeconds) : 0;

    return { ask: totalCost, bid: totalCost, dailyCost: finalDailyCost, breakdown };
}

/**
 * Calculate consumable costs based on actual consumption with baseline estimates
 * Uses weighted average: 90% actual data + 10% baseline estimate (like MCS)
 * @param {Array} consumables - combatConsumables array from player data (with consumed field)
 * @param {number} durationSeconds - Combat duration in seconds
 * @returns {Object} { total: number, breakdown: Array } Total cost and per-item breakdown
 */
export function calculateConsumableCosts(consumables, durationSeconds) {
    if (!consumables || consumables.length === 0 || !durationSeconds || durationSeconds <= 0) {
        return { total: 0, breakdown: [] };
    }

    let totalCost = 0;
    const breakdown = [];

    for (const consumable of consumables) {
        const consumed = consumable.consumed || 0;
        const actualConsumed = consumable.actualConsumed || 0;
        const _elapsedSeconds = consumable.elapsedSeconds || 0;

        // Skip if no consumption (even estimated)
        if (consumed <= 0) {
            continue;
        }

        const prices = marketAPI.getPrice(consumable.itemHrid);
        const itemPrice = prices ? prices.ask : 500;
        const itemCost = itemPrice * consumed;

        totalCost += itemCost;

        // Get item name from data manager
        const itemDetails = dataManager.getItemDetails(consumable.itemHrid);
        const itemName = itemDetails?.name || consumable.itemHrid;

        breakdown.push({
            itemHrid: consumable.itemHrid,
            itemName: itemName,
            count: consumed,
            consumedPerDay: consumable.consumedPerDay || 0,
            pricePerItem: itemPrice,
            totalCost: itemCost,
            startingCount: consumable.startingCount,
            currentCount: consumable.currentCount,
            actualConsumed: actualConsumed,
            defaultConsumed: consumable.defaultConsumed || 0,
            consumptionRate: consumable.consumptionRate,
            elapsedSeconds: consumable.elapsedSeconds || 0,
            inventoryAmount: consumable.inventoryAmount ?? consumable.currentCount,
            timeToZeroSeconds: consumable.timeToZeroSeconds ?? Infinity,
        });
    }

    return { total: totalCost, breakdown };
}

/**
 * Calculate total experience
 * @param {Object} experienceMap - totalSkillExperienceMap from player data
 * @returns {number} Total experience
 */
export function calculateTotalExperience(experienceMap) {
    if (!experienceMap) {
        return 0;
    }

    let total = 0;
    for (const exp of Object.values(experienceMap)) {
        total += exp;
    }

    return total;
}

/**
 * Calculate daily rate
 * @param {number} total - Total value
 * @param {number} durationSeconds - Duration in seconds
 * @returns {number} Value per day
 */
export function calculateDailyRate(total, durationSeconds) {
    if (durationSeconds <= 0) {
        return 0;
    }

    const durationDays = durationSeconds / 86400; // 86400 seconds in a day
    return total / durationDays;
}

/**
 * Format loot items for display
 * @param {Object} lootMap - totalLootMap from player data
 * @returns {Array} Array of { count, itemHrid, itemName, rarity }
 */
export function formatLootList(lootMap) {
    if (!lootMap) {
        return [];
    }

    const items = [];

    for (const loot of Object.values(lootMap)) {
        const itemDetails = dataManager.getItemDetails(loot.itemHrid);

        let totalValue = 0;
        if (loot.itemHrid === '/items/coin') {
            totalValue = loot.count;
        } else if (itemDetails?.isOpenable) {
            const ev =
                expectedValueCalculator.getCachedValue(loot.itemHrid) ||
                expectedValueCalculator.calculateSingleContainer(loot.itemHrid);
            if (ev !== null && ev > 0) {
                totalValue = ev * loot.count;
            }
        } else {
            const prices = marketAPI.getPrice(loot.itemHrid);
            if (prices) {
                totalValue = prices.ask * loot.count;
            }
        }

        items.push({
            count: loot.count,
            itemHrid: loot.itemHrid,
            itemName: itemDetails?.name || 'Unknown',
            rarity: itemDetails?.rarity || 0,
            totalValue,
        });
    }

    // Sort by total value descending, then by name for ties
    items.sort((a, b) => {
        if (b.totalValue !== a.totalValue) {
            return b.totalValue - a.totalValue;
        }
        return a.itemName.localeCompare(b.itemName);
    });

    return items;
}

/**
 * Calculate all statistics for a player
 * @param {Object} playerData - Player data from combat data
 * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
 * @param {Object|null} expectedLootData - `{ expectedDropsMap, sampleSize, elapsedSeconds,
 *   actualLootSinceTracking }` for the current player only (Combat Sim's canonical drop math has
 *   no meaningful "expected" concept for a party member Toolasha did not simulate); null/omitted
 *   for every other player. `elapsedSeconds` is the tracker's own observed window, NOT the combat
 *   session duration; `actualLootSinceTracking` is loot gained only during that same window.
 * @returns {Object} Calculated statistics
 */
export function calculatePlayerStats(playerData, durationSeconds = null, expectedLootData = null) {
    // Calculate income
    const income = calculateIncome(playerData.loot);
    const incomeBreakdownData = calculateIncomeBreakdown(playerData.loot);

    // Use provided duration or default to 0 (will show 0 for rates if no duration)
    const duration = durationSeconds || 0;

    // Calculate daily income
    const dailyIncomeAsk = duration > 0 ? calculateDailyRate(income.ask, duration) : 0;
    const dailyIncomeBid = duration > 0 ? calculateDailyRate(income.bid, duration) : 0;

    // Calculate consumable costs based on ACTUAL consumption
    const consumableData = calculateConsumableCosts(playerData.consumables, duration);
    const consumableCosts = consumableData.total;
    const consumableBreakdown = consumableData.breakdown;

    // Calculate daily consumable costs using pre-calculated per-day rates (MCS-style)
    const dailyConsumableCosts = consumableBreakdown.reduce(
        (sum, item) => sum + (item.consumedPerDay || 0) * item.pricePerItem,
        0
    );

    // Calculate entry key costs (1:1 with regular dungeon chests dropped)
    const keyData = calculateKeyCosts(playerData.loot, duration);
    const keyCosts = { ask: keyData.ask, bid: keyData.bid };
    const dailyKeyCosts = keyData.dailyCost;
    const keyBreakdown = keyData.breakdown;

    // Calculate daily profit (income minus consumables and key costs)
    const dailyProfitAsk = dailyIncomeAsk - dailyConsumableCosts - dailyKeyCosts;
    const dailyProfitBid = dailyIncomeBid - dailyConsumableCosts - dailyKeyCosts;

    // Calculate total experience
    const totalExp = calculateTotalExperience(playerData.experience);

    // Calculate experience per hour
    const expPerHour = duration > 0 ? (totalExp / duration) * 3600 : 0;

    // Calculate deaths per hour
    const deathsPerHour = duration > 0 ? (playerData.deathCount / duration) * 3600 : 0;

    // Format loot list
    const lootList = formatLootList(playerData.loot);

    // First consumable projected to run out (finite runway only - never Infinity/unknown)
    const finiteRunwayItems = consumableBreakdown.filter((item) => Number.isFinite(item.timeToZeroSeconds));
    const firstToRunOut =
        finiteRunwayItems.length > 0
            ? finiteRunwayItems.reduce((soonest, item) =>
                  item.timeToZeroSeconds < soonest.timeToZeroSeconds ? item : soonest
              )
            : null;

    // Actual vs Expected loot / RNG Delta - current player only, and only once at least one
    // encounter has completed (never fabricated from zero completed samples). Dungeons are
    // excluded: the current player's totalLootMap (the only Actual-loot source Combat Stats
    // observes) never reflects a dungeon's completion reward - that reward is delivered via a
    // different field entirely, so an "Actual" baseline for dungeons cannot be proven correct.
    let actualVsExpected = null;
    if (
        expectedLootData &&
        !expectedLootData.isDungeon &&
        expectedLootData.sampleSize > 0 &&
        expectedLootData.elapsedSeconds > 0
    ) {
        // Both sides must cover the exact same window. Reusing the session-wide totalLootMap for
        // "Actual" would compare a short Expected sample against a much longer Actual window
        // (e.g. the script attaching mid-fight), silently mis-scaling the result - so Actual here
        // is the loot gained only since the expected-loot tracker itself started observing.
        const actualItems = expectedLootData.actualLootSinceTracking || [];
        const expectedItems = Array.from(expectedLootData.expectedDropsMap || [], ([itemHrid, count]) => ({
            itemHrid,
            count,
        }));

        const actualValuation = calculateValuedRevenue(actualItems);
        const expectedValuation = calculateValuedRevenue(expectedItems);

        // Both sides share the same elapsed-time denominator, since both now cover the same window.
        const actualRevenuePerDay = calculateDailyRate(actualValuation.revenue, expectedLootData.elapsedSeconds);
        const expectedRevenuePerDay = calculateDailyRate(expectedValuation.revenue, expectedLootData.elapsedSeconds);
        const rngDeltaValue = actualRevenuePerDay - expectedRevenuePerDay;
        const rngDeltaPercent = expectedRevenuePerDay !== 0 ? (rngDeltaValue / expectedRevenuePerDay) * 100 : 0;

        // Scale per-item quantities to the same /day basis as the headline figures above, so the
        // expandable table's rows actually sum to the headline Loot Luck delta instead of showing
        // raw window-total counts against a daily-rate summary.
        const dailyScale = 86400 / expectedLootData.elapsedSeconds;
        const scaleToDaily = (items) => items.map((item) => ({ ...item, count: item.count * dailyScale }));

        actualVsExpected = {
            actualRevenuePerDay,
            expectedRevenuePerDay,
            rngDeltaValue,
            rngDeltaPercent,
            actualProfitPerDay: actualRevenuePerDay - dailyConsumableCosts - dailyKeyCosts,
            expectedProfitPerDay: expectedRevenuePerDay - dailyConsumableCosts - dailyKeyCosts,
            sampleSize: expectedLootData.sampleSize,
            elapsedSeconds: expectedLootData.elapsedSeconds,
            isPartial: actualValuation.isPartial || expectedValuation.isPartial,
            unvaluedItemHrids: [...actualValuation.unvaluedItemHrids, ...expectedValuation.unvaluedItemHrids],
            itemDeltas: buildItemDeltas(scaleToDaily(actualItems), scaleToDaily(expectedItems)),
        };
    }

    return {
        name: playerData.name,
        income: {
            ask: income.ask,
            bid: income.bid,
        },
        dailyIncome: {
            ask: dailyIncomeAsk,
            bid: dailyIncomeBid,
        },
        consumableCosts,
        consumableBreakdown,
        dailyConsumableCosts,
        firstToRunOut,
        keyCosts,
        dailyKeyCosts,
        keyBreakdown,
        dailyProfit: {
            ask: dailyProfitAsk,
            bid: dailyProfitBid,
        },
        totalExp,
        expPerHour,
        deathCount: playerData.deathCount,
        deathsPerHour,
        lootList,
        incomeBreakdown: incomeBreakdownData.breakdown,
        isDungeonRun: incomeBreakdownData.isDungeonRun,
        duration,
        actualVsExpected,
    };
}

/**
 * Build a per-item Actual/Expected/Delta table, sorted by value delta (not percent) so
 * ultra-rare tiny expectations never dominate the table.
 * @param {Array<{itemHrid: string, count: number}>} actualItems - Actual loot items
 * @param {Array<{itemHrid: string, count: number}>} expectedItems - Expected drop items
 * @returns {Array<{itemHrid: string, itemName: string, actualCount: number, expectedCount: number, valueDelta: number}>}
 */
function buildItemDeltas(actualItems, expectedItems) {
    const actualCounts = new Map(actualItems.map((item) => [item.itemHrid, item.count]));
    const expectedCounts = new Map(expectedItems.map((item) => [item.itemHrid, item.count]));
    const allItemHrids = new Set([...actualCounts.keys(), ...expectedCounts.keys()]);

    const rows = [];
    for (const itemHrid of allItemHrids) {
        const actualCount = actualCounts.get(itemHrid) || 0;
        const expectedCount = expectedCounts.get(itemHrid) || 0;
        const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid);
        if (!resolved) continue;

        const itemDetails = dataManager.getItemDetails(itemHrid);
        const canBeSold = itemDetails?.isTradable !== false;
        const unitValue = resolved.needsTax && canBeSold ? calculatePriceAfterTax(resolved.value) : resolved.value;

        rows.push({
            itemHrid,
            itemName: itemDetails?.name || itemHrid,
            actualCount,
            expectedCount,
            valueDelta: (actualCount - expectedCount) * unitValue,
        });
    }

    rows.sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta));
    return rows;
}

/**
 * Calculate statistics for all players
 * @param {Object} combatData - Combat data from data collector
 * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
 * @param {Object|null} expectedLootData - `{ expectedDropsMap, sampleSize, elapsedSeconds, actualLootSinceTracking }` for the current player
 * @returns {Array} Array of player statistics
 */
export function calculateAllPlayerStats(combatData, durationSeconds = null, expectedLootData = null) {
    if (!combatData || !combatData.players) {
        return [];
    }

    // Calculate encounters per hour (EPH)
    const duration = durationSeconds || combatData.durationSeconds || 0;
    const battleId = combatData.battleId || 1;
    const encountersPerHour = duration > 0 ? (3600 * (battleId - 1)) / duration : 0;

    return combatData.players.map((player) => {
        const stats = calculatePlayerStats(player, durationSeconds, player.isCurrentPlayer ? expectedLootData : null);
        // Add EPH and formatted duration to each player's stats
        stats.encountersPerHour = encountersPerHour;
        stats.durationFormatted = formatDuration(duration);
        return stats;
    });
}

/**
 * Format duration in seconds to human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1h 23m", "3d 12h", "2mo 15d")
 */
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) {
        return '0s';
    }

    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    // Days
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    if (d >= 365) {
        const years = Math.floor(d / 365);
        const days = d % 365;
        if (days >= 30) {
            const months = Math.floor(days / 30);
            return `${years}y ${months}mo`;
        }
        return days > 0 ? `${years}y ${days}d` : `${years}y`;
    }
    if (d >= 30) {
        const months = Math.floor(d / 30);
        const days = d % 30;
        return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
    }
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
