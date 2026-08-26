/**
 * Openable Analytics Calculator
 * Pure valuation math for one opening: Actual Value, Expected Value, and Luck (Actual - Expected).
 * Consumes Toolasha's existing Expected Value calculator and sell-side pricing stack rather than
 * duplicating drop/pricing formulas.
 */

import dataManager from '../../../core/data-manager.js';
import config from '../../../core/config.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';
import { calculatePriceAfterTax } from '../../../utils/profit-helpers.js';
import { MARKET_TAX } from '../../../utils/profit-constants.js';

/**
 * Value one gained item stack at event-time sell-side prices, applying market tax when the
 * resolved value source requires it (mirrors `resolveSellSideValue`'s own `needsTax` contract).
 * @param {string} itemHrid - Gained item HRID
 * @param {number} enhancementLevel - Enhancement level of the gained stack
 * @param {number} count - Number of this item gained
 * @returns {{value: number, resolved: boolean}} Value contribution and whether it could be priced
 */
function valueGainedItemStack(itemHrid, enhancementLevel, count) {
    const resolved = expectedValueCalculator.resolveSellSideValue(itemHrid, enhancementLevel || 0);
    if (!resolved) {
        return { value: 0, resolved: false };
    }

    const itemDetails = dataManager.getItemDetails(itemHrid);
    const isTradable = itemDetails?.isTradable !== false;
    const perUnit =
        resolved.needsTax && isTradable ? calculatePriceAfterTax(resolved.value, MARKET_TAX) : resolved.value;

    return { value: perUnit * (count || 0), resolved: true };
}

/**
 * Calculate the Actual Value of one opening from its gained items. Never treats a missing
 * price as zero silently - items that cannot be priced are excluded from the total and the
 * result is marked incomplete so callers/UI can surface a partial state instead of a false
 * precise number. Also returns a per-item breakdown (mirrors the totals) so callers can show or
 * snapshot individual item values, not just the aggregate.
 * @param {Array<{itemHrid: string, enhancementLevel?: number, count: number}>} gainedItems
 * @returns {{value: number, complete: boolean, breakdown: Array<{itemHrid: string, enhancementLevel: number, count: number, value: number, resolved: boolean}>}}
 */
export function calculateActualValue(gainedItems) {
    let total = 0;
    let complete = true;
    const breakdown = [];

    for (const item of gainedItems || []) {
        if (!item?.itemHrid) continue;
        const { value, resolved } = valueGainedItemStack(item.itemHrid, item.enhancementLevel, item.count);
        total += value;
        if (!resolved) complete = false;
        breakdown.push({
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
            count: item.count || 0,
            value,
            resolved,
        });
    }

    return { value: total, complete, breakdown };
}

/**
 * Calculate the Expected Value of one opening using Toolasha's existing container EV calculator.
 * Returns `available: false` (never a fake zero) when the opened item has no meaningful
 * monetary EV model - e.g. a not-yet-initialized calculator, or a buff-only openable that has
 * no entry in `openableLootDropMap`. `isOpenable` alone is broader than "has a monetary loot
 * model": Labyrinth Scroll/Seal items are openable because they grant a buff, so the underlying
 * drop table must be checked directly rather than trusting a non-negative EV total.
 * @param {string} containerHrid - Opened container item HRID
 * @param {number} containerCount - Number of containers opened by this event
 * @returns {{value: number|null, available: boolean, complete: boolean}}
 */
export function calculateExpectedValueForOpening(containerHrid, containerCount) {
    if (!containerHrid || !(containerCount > 0)) {
        return { value: null, available: false, complete: false };
    }

    const dropTable = dataManager.getInitClientData?.()?.openableLootDropMap?.[containerHrid];
    if (!Array.isArray(dropTable) || dropTable.length === 0) {
        return { value: null, available: false, complete: false };
    }

    const ev = expectedValueCalculator.calculateExpectedValue(containerHrid);
    if (!ev || !(ev.expectedValue >= 0)) {
        return { value: null, available: false, complete: false };
    }

    // The shared EV breakdown already reports per-drop hasPriceData. Keep the numeric subtotal
    // available as partial information, but never let it be treated as complete for Luck.
    const complete = !Array.isArray(ev.drops) || ev.drops.every((drop) => drop?.hasPriceData !== false);
    return { value: ev.expectedValue * containerCount, available: true, complete };
}

/**
 * Calculate Luck (Actual - Expected) and Luck % for one opening. Luck is only meaningful when
 * both sides of the comparison are complete: an incomplete Actual subtotal or a partial Expected
 * breakdown must never be presented as a precise, comparable Luck number.
 * @param {number} actualValue
 * @param {number|null} expectedValue
 * @param {boolean} expectedAvailable
 * @param {boolean} [actualComplete] - Whether the Actual subtotal priced every gained item
 * @param {boolean} [expectedComplete] - Whether every modeled Expected drop could be priced
 * @returns {{luckValue: number|null, luckPercent: number|null}}
 */
export function calculateLuck(
    actualValue,
    expectedValue,
    expectedAvailable,
    actualComplete = true,
    expectedComplete = true
) {
    if (!actualComplete || !expectedAvailable || !expectedComplete || expectedValue === null) {
        return { luckValue: null, luckPercent: null };
    }

    const luckValue = actualValue - expectedValue;
    const luckPercent = expectedValue > 0 ? (luckValue / expectedValue) * 100 : null;

    return { luckValue, luckPercent };
}

/**
 * Build a fully normalized opening record from already-extracted opening data. This is the
 * shared seam for both the live `loot_opened` WebSocket path and any future historical-import
 * adapter (e.g. Edible Tools / MWI Combat Suite data) - a future importer only needs to map its
 * own data into this same `{containerHrid, containerCount, gainedItems, grantedBuffs, timestamp,
 * characterId, source}` shape and call this function, without needing to know about
 * `loot_opened` at all.
 * @param {Object} input
 * @param {string} input.containerHrid
 * @param {number} input.containerCount
 * @param {Array} input.gainedItems
 * @param {Array} [input.grantedBuffs]
 * @param {number} input.timestamp
 * @param {string} input.characterId
 * @param {string} [input.source] - Provenance tag, e.g. 'loot_opened' or a future 'import:*'
 * @param {boolean} [input.sourceDataComplete] - False when the caller already knows part of its
 *      own source data could not be resolved (e.g. an import parser that had to drop an unmatched
 *      gained-item name) - keeps that upstream gap from silently looking like a complete Actual.
 * @returns {Object} Normalized opening record
 */
export function buildOpeningRecord({
    containerHrid,
    containerCount,
    gainedItems,
    grantedBuffs,
    timestamp,
    characterId,
    source = 'loot_opened',
    sourceDataComplete = true,
}) {
    const normalizedGainedItems = (gainedItems || [])
        .filter((item) => item?.itemHrid)
        .map((item) => ({
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
            count: item.count || 0,
        }));

    const {
        value: actualValue,
        complete: actualValueComplete,
        breakdown: actualValueBreakdown,
    } = calculateActualValue(normalizedGainedItems);
    const effectiveActualComplete = actualValueComplete && sourceDataComplete;
    const {
        value: expectedValue,
        available: expectedValueAvailable,
        complete: expectedValueComplete,
    } = calculateExpectedValueForOpening(containerHrid, containerCount);
    const { luckValue, luckPercent } = calculateLuck(
        actualValue,
        expectedValue,
        expectedValueAvailable,
        effectiveActualComplete,
        expectedValueComplete
    );

    return {
        timestamp,
        characterId,
        containerHrid,
        containerCount,
        gainedItems: normalizedGainedItems,
        grantedBuffs: (grantedBuffs || []).map((buff) => ({ typeHrid: buff.typeHrid, duration: buff.duration })),
        actualValue,
        actualValueComplete: effectiveActualComplete,
        actualValueBreakdown,
        expectedValue,
        expectedValueAvailable,
        expectedValueComplete,
        sourceDataComplete,
        luckValue,
        luckPercent,
        pricingMode: config.getSettingValue('profitCalc_pricingMode', 'hybrid'),
        keyPricingMode: config.getSettingValue('profitCalc_keyPricingMode', 'ask'),
        source,
    };
}

/**
 * Build a normalized opening record from a bulk `{itemHrid: count}` map instead of an
 * individual `gainedItems` array. This is the seam for historical bulk-import sources (Edible
 * Tools, MWI Combat Suite) that only retain cumulative item totals per container, not
 * per-opening detail - the import produces one synthetic record representing the entire
 * imported total, valued through the exact same `buildOpeningRecord` math (and therefore
 * Toolasha's own pricing/EV, never the source tool's own stored numbers).
 * @param {Object} input
 * @param {string} input.containerHrid
 * @param {number} input.containerCount - Total containers opened, per the import source
 * @param {Object} input.itemTotals - Map of itemHrid -> cumulative count gained
 * @param {number} input.timestamp
 * @param {string} input.characterId
 * @param {string} input.source - e.g. 'import:edible' or 'import:mwi-combat-suite'
 * @param {boolean} [input.sourceDataComplete] - False when the import parser had to drop an
 *      unresolved gained-item name, so this synthetic record's Actual is only a subtotal.
 * @returns {Object} Normalized opening record (enhancementLevel always 0 - imports don't track it)
 */
export function buildImportedAggregateRecord({
    containerHrid,
    containerCount,
    itemTotals,
    timestamp,
    characterId,
    source,
    sourceDataComplete = true,
}) {
    const gainedItems = Object.entries(itemTotals || {}).map(([itemHrid, count]) => ({
        itemHrid,
        enhancementLevel: 0,
        count,
    }));

    return buildOpeningRecord({
        containerHrid,
        containerCount,
        gainedItems,
        grantedBuffs: [],
        timestamp,
        characterId,
        source,
        sourceDataComplete,
    });
}
