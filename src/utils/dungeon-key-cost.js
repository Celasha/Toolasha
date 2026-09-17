/**
 * Dungeon Key Cost
 * Single entry point for pricing a dungeon key (entry key or chest key) under the
 * `profitCalc_keyPricingMode` setting — ask, bid, or "cheapest" (buy vs. craft, reusing Best
 * Crafting Plan's own buy-vs-craft engine headlessly, no action panel required).
 */

import config from '../core/config.js';
import marketAPI from '../api/marketplace.js';
import { getPricingMode } from './market-data.js';
import { computeBestCraftingPlan } from '../features/crafting-plan/crafting-plan-calculator.js';

export const KEY_PRICING_MODE_CHEAPEST = 'cheapest';

/**
 * Get the raw `profitCalc_keyPricingMode` setting value.
 * @returns {string} 'ask' | 'bid' | 'cheapest'
 */
export function getKeyPricingModeSetting() {
    return config.getSettingValue('profitCalc_keyPricingMode') || 'ask';
}

/**
 * Compute the cheapest way to acquire a dungeon key: buy from market, or craft it, using the
 * same buy-vs-craft decision Best Crafting Plan already makes for any item. The buy-side price
 * basis is derived from the global profit-pricing-mode setting (respecting whichever of
 * ask/bid the player already uses for buy-side profit math), not hardcoded.
 * @param {string} keyHrid
 * @param {number} [quantity=1]
 * @returns {{strategy: 'buy'|'craft', unitCost: number, plan: Object|null}} `plan` is the full
 *   Best Crafting Plan tree when crafting wins (for a materials/craft-steps breakdown), else null.
 */
export function getCheapestKeyCost(keyHrid, quantity = 1) {
    const buyMode = getPricingMode('profit', 'buy');
    const plan = computeBestCraftingPlan(keyHrid, quantity, buyMode);
    return {
        strategy: plan.strategy,
        unitCost: plan.unitCost,
        plan: plan.strategy === 'craft' ? plan : null,
    };
}

/**
 * Price a dungeon key under the player's selected key-pricing mode.
 * @param {string} keyHrid
 * @returns {number|null} Gold cost, or null if unresolvable (no market data and no recipe).
 */
export function getKeyPrice(keyHrid) {
    const mode = getKeyPricingModeSetting();

    if (mode === KEY_PRICING_MODE_CHEAPEST) {
        const { unitCost } = getCheapestKeyCost(keyHrid);
        return Number.isFinite(unitCost) ? unitCost : null;
    }

    const priceData = marketAPI.getPrice(keyHrid);
    if (!priceData) return null;
    return priceData[mode] ?? priceData.ask ?? 0;
}
