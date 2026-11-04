/**
 * Dungeon run planner
 *
 * A what-if for dungeon runs that needs no simulation: pick a dungeon and tier, say how long a run takes,
 * and get chest value, keys and net per day. It does not have a formula of its own. It builds the result
 * of an imaginary run of that many completions and hands it to the same functions the simulator uses for
 * drops, market tax and key pricing, so the two can never disagree about how a chest is worth.
 */

import {
    calculateDungeonKeyCosts,
    calculateExpectedDrops,
    calculateSimRevenue,
    resolveKeyPrice,
} from './combat-sim-adapter.js';

const PLAYER = 'player1';
const MINUTES_PER_DAY = 1440;

/**
 * The drop quantity bonus the community buff gives at a level, as the simulator engine works it out.
 * @param {Object} buffDetail - communityBuffTypeDetailMap entry for combat drop quantity
 * @param {number} level - Community buff level (0 when it is not active)
 * @returns {number} e.g. 0.295
 */
export function communityDropQuantity(buffDetail, level) {
    const buff = buffDetail?.buff;
    if (!buff || !(level > 0)) return 0;
    return (buff.flatBoost || 0) + (level - 1) * (buff.flatBoostLevelBonus || 0);
}

/**
 * Plan a day of runs.
 * @param {Object} options
 * @param {Object} options.gameData - From buildGameDataPayload()
 * @param {string} options.dungeonHrid
 * @param {number} options.tier - Difficulty tier
 * @param {number} options.players - Party size (the chest count is split between them)
 * @param {number} options.minutesPerRun
 * @param {number} options.dropQuantity - Total drop quantity bonus, e.g. 0.295
 * @param {number} [options.consumablesPerDay] - What food and drinks cost per day, entered by hand
 * @returns {?{runsPerDay: number, keysPerDay: number, chestValuePerDay: number, keyCostPerDay: number,
 *     consumablesPerDay: number, netPerDay: number, drops: Array, keys: Array, hasMissingPrices: boolean}}
 *     null when the run length is not a positive number
 */
export function planDungeonRuns({
    gameData,
    dungeonHrid,
    tier,
    players,
    minutesPerRun,
    dropQuantity,
    consumablesPerDay = 0,
}) {
    if (!(minutesPerRun > 0)) return null;
    const runsPerDay = MINUTES_PER_DAY / minutesPerRun;
    const run = {
        isDungeon: true,
        dungeonsCompleted: runsPerDay,
        zoneName: dungeonHrid,
        numberOfPlayers: Math.max(1, players),
        difficultyTier: tier,
        combatDropQuantity: { [PLAYER]: dropQuantity },
        dropRateMultiplier: { [PLAYER]: 1 },
        rareFindMultiplier: {},
        debuffOnLevelGap: {},
        deaths: {},
        consumablesUsed: {},
    };

    const revenue = calculateSimRevenue(run, gameData, PLAYER, 24);
    const keys = calculateDungeonKeyCosts(calculateExpectedDrops(run, gameData, PLAYER), resolveKeyPrice);

    const chestValuePerDay = revenue.revenuePerHour * 24;
    const keyCostPerDay = revenue.keyCostPerHour * 24;
    return {
        runsPerDay,
        keysPerDay: keys.reduce((sum, key) => sum + key.count, 0),
        chestValuePerDay,
        keyCostPerDay,
        consumablesPerDay,
        netPerDay: chestValuePerDay - keyCostPerDay - consumablesPerDay,
        drops: revenue.dropEntries.map((entry) => ({
            ...entry,
            countPerDay: entry.countPerHour * 24,
            valuePerDay: entry.totalValue * 24,
        })),
        keys,
        hasMissingPrices: revenue.hasMissingPrices,
    };
}

export default planDungeonRuns;
