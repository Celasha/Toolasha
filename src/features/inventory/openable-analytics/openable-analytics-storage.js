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
    return storage.setJSON(lifetimeKey(characterId), lifetime, STORE_NAME);
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
 * Append one detailed opening record to a character's history, pruning the oldest entries
 * beyond `MAX_HISTORY_EVENTS`. Does not touch the lifetime aggregate.
 * @param {string} characterId
 * @param {Array} history - Current in-memory history array
 * @param {Object} record - New detailed record to append
 * @returns {Promise<Array>} The updated (possibly pruned) history array
 */
export async function appendHistory(characterId, history, record) {
    const updated = [...history, record];
    const pruned = updated.length > MAX_HISTORY_EVENTS ? updated.slice(updated.length - MAX_HISTORY_EVENTS) : updated;
    await storage.setJSON(historyKey(characterId), pruned, STORE_NAME);
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

    return {
        eventsCount: base.eventsCount + 1,
        containersOpened: base.containersOpened + record.containerCount,
        actualValueTotal: base.actualValueTotal + record.actualValue,
        actualValueCompleteEvents: base.actualValueCompleteEvents + (record.actualValueComplete ? 1 : 0),
        actualValuePartialEvents: base.actualValuePartialEvents + (record.actualValueComplete ? 0 : 1),
        expectedValueTotal: base.expectedValueTotal + (record.expectedValueAvailable ? record.expectedValue : 0),
        expectedValueAvailableEvents: base.expectedValueAvailableEvents + (record.expectedValueAvailable ? 1 : 0),
        expectedValueUnavailableEvents: base.expectedValueUnavailableEvents + (record.expectedValueAvailable ? 0 : 1),
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
    return storage.setJSON(importsKey(characterId), imports, STORE_NAME);
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
    await storage.setJSON(historyKey(characterId), filtered, STORE_NAME);

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
 * @returns {Promise<void>}
 */
export async function resetAll(characterId) {
    await storage.delete(lifetimeKey(characterId), STORE_NAME);
    await storage.delete(historyKey(characterId), STORE_NAME);
    await storage.delete(importsKey(characterId), STORE_NAME);
}

export const OPENABLE_ANALYTICS_STORE = STORE_NAME;
export const OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS = MAX_HISTORY_EVENTS;
