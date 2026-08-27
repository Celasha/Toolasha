/**
 * Openable Analytics Storage
 * Character-scoped IndexedDB persistence for lifetime aggregates and bounded detailed history.
 * Lifetime aggregates are updated incrementally at write time so pruning the detailed history
 * array never changes lifetime totals.
 */

import storage from '../../../core/storage.js';

const STORE_NAME = 'openableAnalytics';
const MAX_HISTORY_EVENTS = 500;

function lifetimeKey(characterId) {
    return `lifetime:${characterId}`;
}

function historyKey(characterId) {
    return `history:${characterId}`;
}

function importsKey(characterId) {
    return `imports:${characterId}`;
}

/**
 * Load the lifetime aggregate map (containerHrid -> aggregate) for one character.
 * @param {string} characterId
 * @returns {Promise<Object>} Map of containerHrid -> aggregate object
 */
export async function loadLifetime(characterId) {
    return storage.getJSON(lifetimeKey(characterId), STORE_NAME, {});
}

/**
 * Persist the lifetime aggregate map for one character.
 * @param {string} characterId
 * @param {Object} lifetime
 * @returns {Promise<boolean>}
 */
export async function saveLifetime(characterId, lifetime) {
    // Analytics mutation ordering is owned by the collector's persistence queue; do not
    // introduce a second Core Storage debounce that could coalesce distinct log snapshots or
    // resolve after a later reset/opening has already run.
    return storage.setJSON(lifetimeKey(characterId), lifetime, STORE_NAME, true);
}

/**
 * Load the bounded detailed opening history for one character (most recent last).
 * @param {string} characterId
 * @returns {Promise<Array>}
 */
export async function loadHistory(characterId) {
    return storage.getJSON(historyKey(characterId), STORE_NAME, []);
}

/**
 * Pure, synchronous append of one detailed opening record, pruning the oldest entries beyond
 * `MAX_HISTORY_EVENTS`. Does not touch the lifetime aggregate or persistence - callers that need
 * ordered/immediate persistence should follow with `saveHistory()` themselves (see the data
 * collector's persistence queue), so two overlapping callers never both derive their next state
 * from the same stale array.
 * @param {Array} history - Current in-memory history array
 * @param {Object} record - New detailed record to append
 * @returns {Array} The updated (possibly pruned) history array
 */
export function appendHistoryRecord(history, record) {
    const updated = [...history, record];
    return updated.length > MAX_HISTORY_EVENTS ? updated.slice(updated.length - MAX_HISTORY_EVENTS) : updated;
}

/**
 * Persist a character's detailed opening history immediately (not debounced) - reset must be
 * able to order itself unambiguously against opening/import writes.
 * @param {string} characterId
 * @param {Array} history
 * @returns {Promise<boolean>}
 */
export async function saveHistory(characterId, history) {
    return storage.setJSON(historyKey(characterId), history, STORE_NAME, true);
}

/**
 * Append one detailed opening record to a character's history and persist immediately. Kept as
 * a convenience wrapper around `appendHistoryRecord` + `saveHistory` for simple/test callers;
 * the data collector itself calls the two halves separately so it can commit in-memory state
 * before awaiting persistence.
 * @param {string} characterId
 * @param {Array} history - Current in-memory history array
 * @param {Object} record - New detailed record to append
 * @returns {Promise<Array>} The updated (possibly pruned) history array
 */
export async function appendHistory(characterId, history, record) {
    const pruned = appendHistoryRecord(history, record);
    await saveHistory(characterId, pruned);
    return pruned;
}

/**
 * Create an empty aggregate for a container that has never been recorded before.
 * @returns {Object}
 */
export function createEmptyAggregate() {
    return {
        eventsCount: 0,
        containersOpened: 0,
        actualValueTotal: 0,
        actualValueCompleteEvents: 0,
        actualValuePartialEvents: 0,
        expectedValueTotal: 0,
        expectedValueAvailableEvents: 0,
        expectedValueUnavailableEvents: 0,
        expectedValuePartialEvents: 0,
        valuationRecordCount: 0,
        luckEligibleRecordCount: 0,
        hasImportedData: false,
        grantedBuffEvents: 0,
        itemTotals: {},
        itemValueTotals: {},
    };
}

/**
 * Fold one normalized opening record into an aggregate (lifetime or session), returning a new
 * aggregate object. Never mutates the input.
 * @param {Object} aggregate - Existing aggregate (or a fresh `createEmptyAggregate()`)
 * @param {Object} record - Normalized opening record from `buildOpeningRecord`
 * @returns {Object} New aggregate reflecting the folded-in record
 */
export function foldRecordIntoAggregate(aggregate, record) {
    const base = aggregate || createEmptyAggregate();
    const itemTotals = { ...base.itemTotals };
    const itemValueTotals = { ...base.itemValueTotals };

    for (const item of record.gainedItems || []) {
        itemTotals[item.itemHrid] = (itemTotals[item.itemHrid] || 0) + item.count;
    }
    // actualValueBreakdown may be absent on records written before this field existed - those
    // simply don't contribute a per-item value (their count is still reflected in itemTotals).
    for (const item of record.actualValueBreakdown || []) {
        if (!item.resolved) continue;
        itemValueTotals[item.itemHrid] = (itemValueTotals[item.itemHrid] || 0) + item.value;
    }

    // Imported sources expose a cumulative container total, not individual opening events - one
    // imported record must not be counted as one "opening event" (section 3.1).
    const isImported = typeof record.source === 'string' && record.source.startsWith('import:');
    // A record only qualifies as Luck-eligible when Actual is complete and Expected is both
    // available and complete - calculateLuck() already enforces this and reports it back as a
    // non-null luckValue, so aggregate Luck can fail closed as a whole (section 3.2) without
    // re-deriving the same completeness rules here.
    const expectedPartial = record.expectedValueAvailable && record.expectedValueComplete === false;
    const luckEligible = record.luckValue !== null && record.luckValue !== undefined;

    return {
        // Imported sources expose cumulative container totals, not individual opening events.
        eventsCount: base.eventsCount + (isImported ? 0 : 1),
        containersOpened: base.containersOpened + record.containerCount,
        actualValueTotal: base.actualValueTotal + record.actualValue,
        actualValueCompleteEvents: base.actualValueCompleteEvents + (record.actualValueComplete ? 1 : 0),
        actualValuePartialEvents: base.actualValuePartialEvents + (record.actualValueComplete ? 0 : 1),
        expectedValueTotal: base.expectedValueTotal + (record.expectedValueAvailable ? record.expectedValue : 0),
        expectedValueAvailableEvents: base.expectedValueAvailableEvents + (record.expectedValueAvailable ? 1 : 0),
        expectedValueUnavailableEvents: base.expectedValueUnavailableEvents + (record.expectedValueAvailable ? 0 : 1),
        expectedValuePartialEvents: (base.expectedValuePartialEvents || 0) + (expectedPartial ? 1 : 0),
        valuationRecordCount: (base.valuationRecordCount || 0) + 1,
        luckEligibleRecordCount: (base.luckEligibleRecordCount || 0) + (luckEligible ? 1 : 0),
        hasImportedData: Boolean(base.hasImportedData || isImported),
        grantedBuffEvents: base.grantedBuffEvents + (record.grantedBuffs?.length > 0 ? 1 : 0),
        itemTotals,
        itemValueTotals,
    };
}

/**
 * Load bulk-imported aggregates (Edible Tools / MWI Combat Suite / future sources) for one
 * character. Shape: `{ [source]: { [containerHrid]: aggregate } }`.
 * @param {string} characterId
 * @returns {Promise<Object>}
 */
export async function loadImports(characterId) {
    return storage.getJSON(importsKey(characterId), STORE_NAME, {});
}

/**
 * Persist bulk-imported aggregates for one character.
 * @param {string} characterId
 * @param {Object} imports
 * @returns {Promise<boolean>}
 */
export async function saveImports(characterId, imports) {
    return storage.setJSON(importsKey(characterId), imports, STORE_NAME, true);
}

/**
 * Sum any number of aggregates (live + one or more imported sources) into one combined
 * aggregate for display. Never mutates its inputs.
 * @param {...Object} aggregates
 * @returns {Object}
 */
export function mergeAggregates(...aggregates) {
    const merged = createEmptyAggregate();
    for (const aggregate of aggregates) {
        if (!aggregate) continue;
        merged.eventsCount += aggregate.eventsCount;
        merged.containersOpened += aggregate.containersOpened;
        merged.actualValueTotal += aggregate.actualValueTotal;
        merged.actualValueCompleteEvents += aggregate.actualValueCompleteEvents;
        merged.actualValuePartialEvents += aggregate.actualValuePartialEvents;
        merged.expectedValueTotal += aggregate.expectedValueTotal;
        merged.expectedValueAvailableEvents += aggregate.expectedValueAvailableEvents;
        merged.expectedValueUnavailableEvents += aggregate.expectedValueUnavailableEvents;
        merged.expectedValuePartialEvents += aggregate.expectedValuePartialEvents || 0;
        merged.valuationRecordCount += aggregate.valuationRecordCount || 0;
        merged.luckEligibleRecordCount += aggregate.luckEligibleRecordCount || 0;
        merged.hasImportedData = Boolean(merged.hasImportedData || aggregate.hasImportedData);
        merged.grantedBuffEvents += aggregate.grantedBuffEvents;
        for (const [itemHrid, count] of Object.entries(aggregate.itemTotals || {})) {
            merged.itemTotals[itemHrid] = (merged.itemTotals[itemHrid] || 0) + count;
        }
        for (const [itemHrid, value] of Object.entries(aggregate.itemValueTotals || {})) {
            merged.itemValueTotals[itemHrid] = (merged.itemValueTotals[itemHrid] || 0) + value;
        }
    }
    return merged;
}

/**
 * Reset (delete) lifetime + history data for one container for one character.
 * @param {string} characterId
 * @param {string} containerHrid
 * @returns {Promise<{lifetime: Object, history: Array}>} The updated lifetime map and history
 */
export async function resetContainer(characterId, containerHrid) {
    const lifetime = await loadLifetime(characterId);
    delete lifetime[containerHrid];
    await saveLifetime(characterId, lifetime);

    const history = await loadHistory(characterId);
    const filtered = history.filter((record) => record.containerHrid !== containerHrid);
    await saveHistory(characterId, filtered);

    const imports = await loadImports(characterId);
    for (const source of Object.keys(imports)) {
        delete imports[source][containerHrid];
    }
    await saveImports(characterId, imports);

    return { lifetime, history: filtered, imports };
}

/**
 * Reset (delete) all Openable Analytics data for one character.
 * @param {string} characterId
 * @returns {Promise<boolean>} Whether every delete succeeded
 */
export async function resetAll(characterId) {
    const lifetimeOk = await storage.delete(lifetimeKey(characterId), STORE_NAME);
    const historyOk = await storage.delete(historyKey(characterId), STORE_NAME);
    const importsOk = await storage.delete(importsKey(characterId), STORE_NAME);
    return lifetimeOk && historyOk && importsOk;
}

export const OPENABLE_ANALYTICS_STORE = STORE_NAME;
export const OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS = MAX_HISTORY_EVENTS;
