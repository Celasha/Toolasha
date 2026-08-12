/**
 * Dungeon Chest Risk-of-Ruin Adapter
 *
 * Builds a per-open cost/payout model for a dungeon chest, for the risk-of-ruin engine.
 *
 * A single chest open's payout is the SUM of many independent per-drop-entry
 * Bernoulli(dropRate) x Uniform(minCount, maxCount) draws (openableLootDropMap) - not one
 * categorical pick. The exact combined distribution has combinatorially many outcomes and
 * isn't enumerable in closed form, so a large empirical sample of realized payouts (drawn via
 * drawChestPayout) stands in as the outcome distribution for both:
 * - The Monte Carlo simulation itself (a bootstrap resample of the true distribution, valid
 *   for a large enough sample size, and the only form that's plain structured-clone-safe data
 *   a Web Worker can consume without access to dataManager/marketAPI/expectedValueCalculator).
 * - The Lundberg bound, which needs a discrete outcome-distribution input.
 */

import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import config from '../../core/config.js';
import expectedValueCalculator from '../../features/market/expected-value-calculator.js';
import { calculatePriceAfterTax } from '../profit-helpers.js';
import { createSeededRng, drawFromDistribution } from '../risk-of-ruin-engine.js';
import { DUNGEON_ENTRY_KEYS, DUNGEON_CHEST_KEYS } from '../../features/combat-sim/combat-sim-adapter.js';

const COIN_HRID = '/items/coin';
const DEFAULT_EMPIRICAL_SAMPLE_SIZE = 5000;

function getKeyPricingMode() {
    return config.getSettingValue('profitCalc_keyPricingMode') || 'ask';
}

function getKeyPrice(keyHrid) {
    const priceData = marketAPI.getPrice(keyHrid);
    if (!priceData) return 0;
    const priceKey = getKeyPricingMode();
    return priceData[priceKey] ?? priceData.ask ?? 0;
}

/**
 * Gold cost to open one chest: entry key (regular, non-refinement chests only) + chest key,
 * priced via the existing profitCalc_keyPricingMode setting — the same model
 * combat-stats-calculator.js's calculateKeyCosts() already uses.
 * @param {string} containerHrid
 * @returns {number}
 */
export function getChestOpenCost(containerHrid) {
    let cost = 0;

    const entryKeyHrid = DUNGEON_ENTRY_KEYS[containerHrid];
    if (entryKeyHrid) cost += getKeyPrice(entryKeyHrid);

    const chestKeyHrid = DUNGEON_CHEST_KEYS[containerHrid];
    if (chestKeyHrid) cost += getKeyPrice(chestKeyHrid);

    return cost;
}

/**
 * Draw one realized payout value for opening the given chest once. Prices each triggered drop
 * the same way expected-value-calculator.js's getDropBreakdown() prices its average — tax-aware
 * sell side, with coin/cowbell/dungeon-token/nested-container special cases handled by
 * getDropPrice() — but against the actually-realized random count, not the average.
 * @param {string} containerHrid
 * @param {function(): number} rng
 * @returns {number}
 */
export function drawChestPayout(containerHrid, rng) {
    const initData = dataManager.getInitClientData();
    const dropTable = initData?.openableLootDropMap?.[containerHrid];
    if (!dropTable) return 0;

    let payout = 0;
    for (const drop of dropTable) {
        const dropRate = drop.dropRate || 0;
        if (dropRate <= 0 || rng() >= dropRate) continue;

        const minCount = drop.minCount || 0;
        const maxCount = drop.maxCount || 0;
        if (minCount <= 0 && maxCount <= 0) continue;
        const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
        if (count <= 0) continue;

        const price = expectedValueCalculator.getDropPrice(drop.itemHrid);
        if (price === null) continue;

        if (drop.itemHrid === COIN_HRID) {
            payout += count * price;
            continue;
        }

        const itemDetails = dataManager.getItemDetails(drop.itemHrid);
        const canBeSold = itemDetails?.isTradable !== false;
        payout += canBeSold ? calculatePriceAfterTax(count * price) : count * price;
    }

    return payout;
}

/**
 * Build the full risk-of-ruin model for repeatedly opening one chest type. The Monte Carlo
 * simulation draws from the same empirical outcomeDistribution used for the Lundberg bound,
 * rather than re-running drawChestPayout() live every step (see module docblock for why).
 * @param {string} containerHrid
 * @param {Object} [options]
 * @param {number} [options.sampleSize] - Empirical sample count backing both the simulation and
 *   the Lundberg bound.
 * @param {number} [options.rngSeed] - Seed for the empirical sample.
 * @returns {{
 *   cost: number,
 *   maxSinglePossibleLoss: number,
 *   stepFn: function(state: Object, rng: function(): number): Object,
 *   outcomeDistribution: Array<{prob: number, net: number}>,
 * }}
 */
export function buildDungeonChestModel(
    containerHrid,
    { sampleSize = DEFAULT_EMPIRICAL_SAMPLE_SIZE, rngSeed = 1 } = {}
) {
    const cost = getChestOpenCost(containerHrid);

    const sampleRng = createSeededRng(rngSeed);
    const outcomeDistribution = [];
    for (let i = 0; i < sampleSize; i++) {
        const payout = drawChestPayout(containerHrid, sampleRng);
        outcomeDistribution.push({ prob: 1 / sampleSize, net: payout - cost });
    }

    return {
        cost,
        maxSinglePossibleLoss: cost,
        stepFn: (state, rng) => ({ balance: state.balance + drawFromDistribution(outcomeDistribution, rng).net }),
        outcomeDistribution,
    };
}
