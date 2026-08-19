/**
 * Offline Economics Calculator
 * Values the Revenue/Cost/Profit of a Welcome Back offline session using Toolasha's existing
 * pricing-mode-aware valuation stack, so results stay consistent with every other profit number
 * shown elsewhere in Toolasha.
 */

import dataManager from '../core/data-manager.js';
import expectedValueCalculator from '../features/market/expected-value-calculator.js';
import { calculateTaskTokenValue } from '../features/tasks/task-profit-calculator.js';
import { calculatePriceAfterTax } from './profit-helpers.js';
import { MARKET_TAX } from './profit-constants.js';

const TASK_TOKEN_HRID = '/items/task_token';

/**
 * Resolve one item's unit economic value for a given transaction side.
 * @param {string} itemHrid - Item HRID
 * @param {number} enhancementLevel - Enhancement level
 * @param {'sell'|'buy'} side - 'sell' for a gained item, 'buy' for a consumed item
 * @param {Object|null} itemDetails - dataManager.getItemDetails(itemHrid) result
 * @returns {{value: number, source: string}|null} Resolved unit value or null if unavailable
 */
function resolveUnitValue(itemHrid, enhancementLevel, side, itemDetails) {
    if (itemHrid === TASK_TOKEN_HRID) {
        const tokenData = calculateTaskTokenValue();
        if (tokenData.error || !(tokenData.tokenValue > 0)) return null;
        return { value: tokenData.tokenValue, source: 'taskToken' };
    }

    if (side === 'sell') {
        const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid, enhancementLevel);
        if (!resolved) return null;
        const value =
            resolved.needsTax && itemDetails?.isTradable !== false
                ? calculatePriceAfterTax(resolved.value, MARKET_TAX)
                : resolved.value;
        return { value, source: resolved.source };
    }

    const resolved = expectedValueCalculator.resolveBuySideValue(itemHrid, enhancementLevel);
    return resolved ? { value: resolved.value, source: resolved.source } : null;
}

/**
 * Calculate the economic result of a Welcome Back offline session.
 * @param {Object} params
 * @param {Array<{itemHrid: string, enhancementLevel?: number, offlineCount: number}>} params.offlineItems
 *   - Signed offline item deltas: positive offlineCount = gained, negative = consumed
 * @param {string} params.currentTimestamp - ISO timestamp from the init_character_data payload
 * @param {string} params.lastOfflineTime - ISO timestamp the character went offline (character.lastOfflineTime)
 * @returns {Object} { revenue, cost, profit, revenuePerDay, costPerDay, profitPerDay,
 *   durationSeconds, isPartial, unvaluedItems, lines }
 */
export function calculateOfflineEconomics({ offlineItems, currentTimestamp, lastOfflineTime }) {
    let revenue = 0;
    let cost = 0;
    let isPartial = false;
    const unvaluedItems = [];
    const lines = [];

    for (const item of offlineItems || []) {
        const { itemHrid, offlineCount } = item;
        const enhancementLevel = item.enhancementLevel || 0;
        if (!itemHrid || !offlineCount) continue;

        const side = offlineCount > 0 ? 'sell' : 'buy';
        const quantity = Math.abs(offlineCount);
        const itemDetails = dataManager.getItemDetails(itemHrid);

        const resolved = resolveUnitValue(itemHrid, enhancementLevel, side, itemDetails);
        if (!resolved) {
            isPartial = true;
            unvaluedItems.push({ itemHrid, enhancementLevel, offlineCount });
            continue;
        }

        const totalValue = resolved.value * quantity;
        if (side === 'sell') {
            revenue += totalValue;
        } else {
            cost += totalValue;
        }

        lines.push({
            itemHrid,
            enhancementLevel,
            quantity,
            side,
            unitValue: resolved.value,
            totalValue,
            source: resolved.source,
        });
    }

    const profit = revenue - cost;

    const durationMs = new Date(currentTimestamp).getTime() - new Date(lastOfflineTime).getTime();
    const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;
    const perDay = (value) => (durationSeconds > 0 ? (value * 86400) / durationSeconds : null);

    return {
        revenue,
        cost,
        profit,
        revenuePerDay: perDay(revenue),
        costPerDay: perDay(cost),
        profitPerDay: perDay(profit),
        durationSeconds,
        isPartial,
        unvaluedItems,
        lines,
    };
}
