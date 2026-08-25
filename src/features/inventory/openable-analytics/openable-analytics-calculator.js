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
 * precise number.
 * @param {Array<{itemHrid: string, enhancementLevel?: number, count: number}>} gainedItems
 * @returns {{value: number, complete: boolean}} Actual value and whether every item was priced
 */
export function calculateActualValue(gainedItems) {
    let total = 0;
    let complete = true;

    for (const item of gainedItems || []) {
        if (!item?.itemHrid) continue;
        const { value, resolved } = valueGainedItemStack(item.itemHrid, item.enhancementLevel, item.count);
        total += value;
        if (!resolved) complete = false;
    }

    return { value: total, complete };
}

/**
 * Calculate the Expected Value of one opening using Toolasha's existing container EV calculator.
 * Returns `available: false` (never a fake zero) when the opened item has no meaningful
 * monetary EV model - e.g. a not-yet-initialized calculator, or a buff-only openable that has
 * no entry in `openableLootDropMap`.
 * @param {string} containerHrid - Opened container item HRID
 * @param {number} containerCount - Number of containers opened by this event
 * @returns {{value: number|null, available: boolean}}
 */
export function calculateExpectedValueForOpening(containerHrid, containerCount) {
    if (!containerHrid || !(containerCount > 0)) {
        return { value: null, available: false };
    }

    const ev = expectedValueCalculator.calculateExpectedValue(containerHrid);
    if (!ev || !(ev.expectedValue >= 0)) {
        return { value: null, available: false };
    }

    return { value: ev.expectedValue * containerCount, available: true };
}

/**
 * Calculate Luck (Actual - Expected) and Luck % for one opening. Luck is only meaningful when
 * Expected Value is available; otherwise both fields are `null`, never a fabricated zero.
 * @param {number} actualValue
 * @param {number|null} expectedValue
 * @param {boolean} expectedAvailable
 * @returns {{luckValue: number|null, luckPercent: number|null}}
 */
export function calculateLuck(actualValue, expectedValue, expectedAvailable) {
    if (!expectedAvailable || expectedValue === null) {
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
}) {
    const normalizedGainedItems = (gainedItems || [])
        .filter((item) => item?.itemHrid)
        .map((item) => ({
            itemHrid: item.itemHrid,
            enhancementLevel: item.enhancementLevel || 0,
            count: item.count || 0,
        }));

    const { value: actualValue, complete: actualValueComplete } = calculateActualValue(normalizedGainedItems);
    const { value: expectedValue, available: expectedValueAvailable } = calculateExpectedValueForOpening(
        containerHrid,
        containerCount
    );
    const { luckValue, luckPercent } = calculateLuck(actualValue, expectedValue, expectedValueAvailable);

    return {
        timestamp,
        characterId,
        containerHrid,
        containerCount,
        gainedItems: normalizedGainedItems,
        grantedBuffs: (grantedBuffs || []).map((buff) => ({ typeHrid: buff.typeHrid, duration: buff.duration })),
        actualValue,
        actualValueComplete,
        expectedValue,
        expectedValueAvailable,
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
 * @returns {Object} Normalized opening record (enhancementLevel always 0 - imports don't track it)
 */
export function buildImportedAggregateRecord({
    containerHrid,
    containerCount,
    itemTotals,
    timestamp,
    characterId,
    source,
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
    });
}
