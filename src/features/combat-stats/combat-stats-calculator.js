/**
 * Combat Statistics Calculator
 * Calculates income, profit, consumable costs, and other statistics
 */

import marketAPI from '../../api/marketplace.js';
import dataManager from '../../core/data-manager.js';

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
            // Other items: get market price
            const prices = marketAPI.getPrice(loot.itemHrid);
            if (prices) {
                totalAsk += prices.ask * itemCount;
                totalBid += prices.bid * itemCount;
            }
        }
    }

    return { ask: totalAsk, bid: totalBid };
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
            inventoryAmount: consumable.inventoryAmount || consumable.currentCount,
            timeToZeroSeconds: consumable.timeToZeroSeconds || Infinity,
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
        items.push({
            count: loot.count,
            itemHrid: loot.itemHrid,
            itemName: itemDetails?.name || 'Unknown',
            rarity: itemDetails?.rarity || 0,
        });
    }

    // Sort by rarity (descending), then by name
    items.sort((a, b) => {
        if (a.rarity !== b.rarity) {
            return b.rarity - a.rarity;
        }
        return a.itemName.localeCompare(b.itemName);
    });

    return items;
}

/**
 * Calculate all statistics for a player
 * @param {Object} playerData - Player data from combat data
 * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
 * @returns {Object} Calculated statistics
 */
export function calculatePlayerStats(playerData, durationSeconds = null) {
    // Calculate income
    const income = calculateIncome(playerData.loot);

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

    // Calculate daily profit
    const dailyProfitAsk = dailyIncomeAsk - dailyConsumableCosts;
    const dailyProfitBid = dailyIncomeBid - dailyConsumableCosts;

    // Calculate total experience
    const totalExp = calculateTotalExperience(playerData.experience);

    // Calculate experience per hour
    const expPerHour = duration > 0 ? (totalExp / duration) * 3600 : 0;

    // Calculate deaths per hour
    const deathsPerHour = duration > 0 ? (playerData.deathCount / duration) * 3600 : 0;

    // Format loot list
    const lootList = formatLootList(playerData.loot);

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
        dailyProfit: {
            ask: dailyProfitAsk,
            bid: dailyProfitBid,
        },
        totalExp,
        expPerHour,
        deathCount: playerData.deathCount,
        deathsPerHour,
        lootList,
        duration,
    };
}

/**
 * Calculate statistics for all players
 * @param {Object} combatData - Combat data from data collector
 * @param {number|null} durationSeconds - Combat duration in seconds (from DOM or null)
 * @returns {Array} Array of player statistics
 */
export function calculateAllPlayerStats(combatData, durationSeconds = null) {
    if (!combatData || !combatData.players) {
        return [];
    }

    // Calculate encounters per hour (EPH)
    const duration = durationSeconds || combatData.durationSeconds || 0;
    const battleId = combatData.battleId || 1;
    const encountersPerHour = duration > 0 ? (3600 * (battleId - 1)) / duration : 0;

    return combatData.players.map((player) => {
        const stats = calculatePlayerStats(player, durationSeconds);
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
