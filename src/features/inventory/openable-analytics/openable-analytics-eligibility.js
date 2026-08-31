/**
 * Openable Analytics eligibility
 *
 * Openable Analytics is useful only when an opening has outcome variance to analyze. Known
 * buff-only/no-item-loot activations and fully deterministic fixed-output openables are excluded.
 * Unknown/incomplete current game data fails open so newly-added or temporarily unresolved
 * randomized openables are never silently discarded.
 */

import dataManager from '../../../core/data-manager.js';

export const OPENABLE_MODEL_STATUS = Object.freeze({
    RANDOMIZED: 'randomized',
    DETERMINISTIC: 'deterministic',
    NO_ITEM_LOOT: 'no_item_loot',
    UNKNOWN: 'unknown',
});

function getCurrentDropTable(containerHrid) {
    if (!containerHrid || !dataManager.getItemDetails(containerHrid)) return { status: 'unknown', dropTable: null };

    const openableLootDropMap = dataManager.getInitClientData?.()?.openableLootDropMap;
    if (!openableLootDropMap || typeof openableLootDropMap !== 'object') {
        return { status: 'unknown', dropTable: null };
    }

    const dropTable = openableLootDropMap[containerHrid];
    if (!Array.isArray(dropTable) || dropTable.length === 0) {
        return { status: 'no_item_loot', dropTable: [] };
    }

    return { status: 'present', dropTable };
}

/**
 * Classify one openable against the current authoritative client data.
 *
 * A deterministic model means every active drop is guaranteed (`dropRate === 1`) and has a fixed
 * quantity (`minCount === maxCount`). Any probability below 1 or quantity range makes the opening
 * randomized. Incomplete/malformed model data is UNKNOWN and therefore fails open.
 * @param {string} containerHrid
 * @returns {'randomized'|'deterministic'|'no_item_loot'|'unknown'}
 */
export function getOpenableModelStatus(containerHrid) {
    const { status, dropTable } = getCurrentDropTable(containerHrid);
    if (status === 'unknown') return OPENABLE_MODEL_STATUS.UNKNOWN;
    if (status === 'no_item_loot') return OPENABLE_MODEL_STATUS.NO_ITEM_LOOT;

    let activeDrops = 0;
    let randomized = false;

    for (const drop of dropTable) {
        const rate = drop?.dropRate;
        if (!Number.isFinite(rate)) return OPENABLE_MODEL_STATUS.UNKNOWN;
        if (rate <= 0) continue;

        activeDrops += 1;
        if (!drop?.itemHrid) return OPENABLE_MODEL_STATUS.UNKNOWN;

        const minCount = drop?.minCount;
        const maxCount = drop?.maxCount;
        if (!Number.isFinite(minCount) || !Number.isFinite(maxCount)) {
            // A probability below 1 already proves variance even if count metadata is incomplete.
            if (rate !== 1) {
                randomized = true;
                continue;
            }
            return OPENABLE_MODEL_STATUS.UNKNOWN;
        }

        if (rate !== 1 || minCount !== maxCount) randomized = true;
    }

    if (activeDrops === 0) return OPENABLE_MODEL_STATUS.NO_ITEM_LOOT;
    return randomized ? OPENABLE_MODEL_STATUS.RANDOMIZED : OPENABLE_MODEL_STATUS.DETERMINISTIC;
}

function getDeterministicExpectedTotals(containerHrid, containerCount) {
    if (!Number.isSafeInteger(containerCount) || containerCount <= 0) return null;
    if (getOpenableModelStatus(containerHrid) !== OPENABLE_MODEL_STATUS.DETERMINISTIC) return null;

    const { dropTable } = getCurrentDropTable(containerHrid);
    const totals = {};
    for (const drop of dropTable) {
        if (!(drop?.dropRate > 0)) continue;
        const count = drop.minCount * containerCount;
        if (!Number.isSafeInteger(count) || count < 0) return null;
        totals[drop.itemHrid] = (totals[drop.itemHrid] || 0) + count;
    }
    return totals;
}

function normalizeObservedTotals(gainedItems) {
    const totals = {};
    for (const item of gainedItems || []) {
        if (!item?.itemHrid) return null;
        const count = item.count;
        if (!Number.isSafeInteger(count) || count < 0) return null;
        if (count === 0) continue;
        totals[item.itemHrid] = (totals[item.itemHrid] || 0) + count;
    }
    return totals;
}

function normalizedTotalsEqual(left, right) {
    if (!left || !right) return false;
    const leftKeys = Object.keys(left)
        .filter((key) => left[key] !== 0)
        .sort();
    const rightKeys = Object.keys(right)
        .filter((key) => right[key] !== 0)
        .sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

/**
 * Decide whether one live opening should enter Openable Analytics.
 *
 * - randomized / unknown model -> track;
 * - known no-item-loot + no gained items -> exclude;
 * - deterministic fixed-output + exact expected output -> exclude;
 * - any runtime outcome contradicting the static non-random model -> fail open and track.
 * @param {string} containerHrid
 * @param {number} containerCount
 * @param {Array<{itemHrid?: string, count?: number}>} [gainedItems]
 * @returns {boolean}
 */
export function shouldTrackOpenableOpening(containerHrid, containerCount, gainedItems = []) {
    const modelStatus = getOpenableModelStatus(containerHrid);
    if (modelStatus === OPENABLE_MODEL_STATUS.RANDOMIZED || modelStatus === OPENABLE_MODEL_STATUS.UNKNOWN) {
        return true;
    }

    const observedTotals = normalizeObservedTotals(gainedItems);
    if (modelStatus === OPENABLE_MODEL_STATUS.NO_ITEM_LOOT) {
        return observedTotals === null || Object.keys(observedTotals).length > 0;
    }

    const expectedTotals = getDeterministicExpectedTotals(containerHrid, containerCount);
    return !normalizedTotalsEqual(observedTotals, expectedTotals);
}

/**
 * Decide whether a historical aggregate from an import source carries analytical information.
 * The same fail-open rule applies: an exact deterministic outcome is skipped, but contradictory
 * source data is preserved for review instead of being silently discarded.
 * @param {string} containerHrid
 * @param {number} containerCount
 * @param {Object<string, number>} itemTotals
 * @returns {boolean}
 */
export function shouldTrackImportedOpenable(containerHrid, containerCount, itemTotals = {}) {
    const gainedItems = Object.entries(itemTotals || {}).map(([itemHrid, count]) => ({ itemHrid, count }));
    return shouldTrackOpenableOpening(containerHrid, containerCount, gainedItems);
}

/**
 * Whether a persisted/session container should be exposed in Analytics UI lists. Known non-random
 * current models are hidden without destructively rewriting the user's IndexedDB history.
 * Unknown/incomplete game data remains visible (fail open).
 * @param {string} containerHrid
 * @returns {boolean}
 */
export function shouldExposeOpenableContainer(containerHrid) {
    const modelStatus = getOpenableModelStatus(containerHrid);
    return modelStatus === OPENABLE_MODEL_STATUS.RANDOMIZED || modelStatus === OPENABLE_MODEL_STATUS.UNKNOWN;
}
