/**
 * Openable Analytics Data Collector
 * Consumes the character-scoped, socket-ownership-gated `loot_opened` event that DataManager
 * derives from the native WebSocket message (TLA-018), builds a normalized opening record via
 * the shared calculator, and maintains character-scoped session (in-memory) and lifetime
 * (persisted) aggregates plus a bounded detailed history.
 */

import dataManager from '../../../core/data-manager.js';
import { buildOpeningRecord, buildImportedAggregateRecord } from './openable-analytics-calculator.js';
import {
    loadLifetime,
    saveLifetime,
    loadHistory,
    appendHistoryRecord,
    saveHistory,
    loadImports,
    saveImports,
    foldRecordIntoAggregate,
    createEmptyAggregate,
    mergeAggregates,
    resetAll as storageResetAll,
} from './openable-analytics-storage.js';

class OpenableAnalyticsDataCollector {
    constructor() {
        this.isInitialized = false;
        this.characterId = null;
        this.lifecycleGeneration = 0;
        this.lootOpenedHandler = null;
        this.lifetime = {};
        this.history = [];
        this.session = {};
        this.imports = {};
        this.latestRecord = null;
        this.updateListeners = new Set();
        this.stateChangeListeners = new Set();
        // One ordered persistence lane for opening/import/reset mutations. It intentionally
        // survives cleanup()/reinitialize so an accepted write cannot be overtaken by a later
        // reset, and initialize() waits on it so a same-character re-enable never loads a
        // pre-write snapshot (OA-3, OA-4, OA-11).
        this.persistenceQueue = Promise.resolve();
    }

    /**
     * Queue one persistence operation behind every earlier one, current lifecycle or not. A
     * later opening/reset therefore always lands after everything queued before it. `task` must
     * resolve to a boolean success flag (Core Storage often resolves `false` on IndexedDB
     * failure rather than rejecting) - a failed task still lets subsequent queued work run.
     * @param {Function} task - Async function returning a boolean success flag
     * @returns {Promise<boolean>} Whether this operation's persistence succeeded
     */
    enqueuePersistence(task) {
        const run = this.persistenceQueue.then(task, task).catch((error) => {
            console.error('[OpenableAnalytics] Persistence operation threw:', error);
            return false;
        });
        this.persistenceQueue = run.then(() => {});
        return run;
    }

    /**
     * Initialize the collector for the current character. Session aggregates always start
     * empty here - Session is page/character-lifecycle scoped, never manually started/resumed.
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;
        // Do not load a stale pre-write snapshot if this feature was toggled/reinitialized while
        // an accepted persistence operation from the previous lifecycle is still finishing.
        await this.persistenceQueue.catch(() => {});

        const characterId = dataManager.getCurrentCharacterId();
        const generation = ++this.lifecycleGeneration;

        const [lifetime, history, imports] = characterId
            ? await Promise.all([loadLifetime(characterId), loadHistory(characterId), loadImports(characterId)])
            : [{}, [], {}];

        if (
            generation !== this.lifecycleGeneration ||
            !this.isInitialized ||
            dataManager.getCurrentCharacterId() !== characterId
        ) {
            return;
        }

        // Commit the loaded snapshot only after every async load has completed and ownership is
        // still valid - no partially loaded stale lifecycle is ever published into singleton
        // state (OA-11).
        this.characterId = characterId;
        this.lifetime = lifetime;
        this.history = history;
        this.imports = imports;
        this.session = {};
        this.latestRecord = null;

        this.lootOpenedHandler = (event) => {
            this.onLootOpened(event, generation).catch((error) => {
                console.error('[OpenableAnalytics] Failed to record loot_opened:', error);
            });
        };
        dataManager.on('loot_opened', this.lootOpenedHandler);
    }

    /**
     * Handle a character-scoped `loot_opened` event from DataManager (already filtered to the
     * accepted active socket - TLA-018). Ignores an event whose captured characterId no longer
     * matches this collector's current character, which also protects against a stale
     * continuation resuming after a character switch even though DataManager's own ownership
     * check already covers the common case.
     * @param {Object} event - `{data, characterId}` as emitted by DataManager
     * @param {number} generation - Lifecycle generation captured at registration time
     */
    async onLootOpened(event, generation) {
        if (generation !== this.lifecycleGeneration) return;
        const data = event?.data;
        const characterId = event?.characterId;
        if (!characterId || characterId !== this.characterId) return;
        if (!data?.openedItem?.itemHrid) return;

        await this.recordOpening(
            {
                containerHrid: data.openedItem.itemHrid,
                containerCount: data.openedItem.count || 1,
                gainedItems: data.gainedItems,
                grantedBuffs: data.grantedBuffs,
                timestamp: Date.now(),
                characterId,
            },
            { generation }
        );
    }

    /**
     * Build and record one opening from already-normalized input. This is the shared entry
     * point for both the live WebSocket path and the historical-import adapters (Edible Tools /
     * MWI Combat Suite) - an importer can call this directly with `source: 'import:...'` without
     * needing to go through `loot_opened` at all.
     * @param {Object} input - See `buildOpeningRecord` for shape
     * @param {Object} [options]
     * @param {number} [options.generation] - Lifecycle generation to guard against a stale
     *      continuation resuming after `cleanup()`/a character switch
     * @returns {Promise<Object>} The normalized record that was recorded
     */
    async recordOpening(input, { generation = this.lifecycleGeneration } = {}) {
        const record = buildOpeningRecord(input);

        if (generation !== this.lifecycleGeneration) return record;

        // Commit every in-memory view synchronously, in this exact order, before notifying
        // listeners. This guarantees two overlapping openings each derive their history append
        // from the collector's own latest in-memory array rather than a shared stale snapshot
        // (OA-3), and that a mounted modal's data-driven refresh always sees Lifetime already
        // including the opening that triggered it (OA-10).
        this.session[record.containerHrid] = foldRecordIntoAggregate(this.session[record.containerHrid], record);
        if (record.characterId) {
            this.lifetime = {
                ...this.lifetime,
                [record.containerHrid]: foldRecordIntoAggregate(this.lifetime[record.containerHrid], record),
            };
            this.history = appendHistoryRecord(this.history, record);
        }

        this.latestRecord = record;
        this.notifyListeners(record);
        this.notifyStateChange();

        if (!record.characterId) return record;

        // Queue persistence behind everything already queued (including any earlier opening or
        // a reset). A later reset therefore cannot resurrect this opening, and this opening
        // cannot be lost to a reset that was already in flight when it arrived (OA-4).
        const characterId = record.characterId;
        const historySnapshot = this.history;
        const lifetimeSnapshot = this.lifetime;
        const persisted = await this.enqueuePersistence(async () => {
            const historyOk = await saveHistory(characterId, historySnapshot);
            const lifetimeOk = await saveLifetime(characterId, lifetimeSnapshot);
            return historyOk && lifetimeOk;
        });
        if (!persisted) {
            console.error('[OpenableAnalytics] Could not save this opening. It may not persist after reload.');
        }

        return record;
    }

    /**
     * Subscribe to newly recorded openings (used by the modal-line injector to update
     * immediately, without waiting for a DOM-mount fallback).
     * @param {Function} callback - Called with the new normalized record
     * @returns {Function} Unsubscribe function
     */
    onUpdate(callback) {
        this.updateListeners.add(callback);
        return () => this.updateListeners.delete(callback);
    }

    notifyListeners(record) {
        for (const callback of this.updateListeners) {
            try {
                callback(record);
            } catch (error) {
                console.error('[OpenableAnalytics] Update listener error:', error);
            }
        }
    }

    /**
     * Subscribe to any in-memory analytics mutation (live opening, import, replace, remove
     * import, delete container, delete all) - used by Full Analytics to refresh only while it is
     * currently mounted. Fired immediately after the in-memory commit, before persistence.
     * @param {Function} callback - Called with no arguments
     * @returns {Function} Unsubscribe function
     */
    onStateChange(callback) {
        this.stateChangeListeners.add(callback);
        return () => this.stateChangeListeners.delete(callback);
    }

    notifyStateChange() {
        for (const callback of this.stateChangeListeners) {
            try {
                callback();
            } catch (error) {
                console.error('[OpenableAnalytics] State-change listener error:', error);
            }
        }
    }

    /**
     * @returns {Object|null} The most recently recorded normalized opening record, if any
     */
    getLatestRecord() {
        return this.latestRecord;
    }

    /**
     * @param {string} containerHrid
     * @returns {Object} Session (in-memory, page/character lifecycle-scoped) aggregate
     */
    getSessionAggregate(containerHrid) {
        return this.session[containerHrid] || createEmptyAggregate();
    }

    /**
     * @returns {Array<string>} Container HRIDs that actually exist in the current in-memory
     *      Session - never containers that only have Lifetime/imported history.
     */
    getSessionContainers() {
        return Object.keys(this.session);
    }

    /**
     * @param {string} containerHrid
     * @returns {Object} Lifetime (persisted, live-tracked) aggregate, excluding bulk imports -
     *      use `getLifetimeAggregate` for the combined total shown in the UI.
     */
    getLiveLifetimeAggregate(containerHrid) {
        return this.lifetime[containerHrid] || createEmptyAggregate();
    }

    /**
     * @param {string} containerHrid
     * @returns {Object} Lifetime aggregate combining live-tracked openings with any bulk-imported
     *      historical totals (Edible Tools / MWI Combat Suite / future sources) for this container.
     */
    getLifetimeAggregate(containerHrid) {
        const importedAggregates = Object.values(this.imports)
            .map((bySource) => bySource[containerHrid])
            .filter(Boolean);
        return mergeAggregates(this.lifetime[containerHrid], ...importedAggregates);
    }

    /**
     * @returns {Array<string>} Container HRIDs with at least one lifetime opening, live or imported
     */
    getKnownContainers() {
        const containers = new Set(Object.keys(this.lifetime));
        for (const bySource of Object.values(this.imports)) {
            for (const containerHrid of Object.keys(bySource)) {
                containers.add(containerHrid);
            }
        }
        return [...containers];
    }

    /**
     * @returns {Array<string>} Import source keys that currently have at least one container
     */
    getImportSourceKeys() {
        return Object.entries(this.imports)
            .filter(([, byContainer]) => Object.keys(byContainer).length > 0)
            .map(([source]) => source);
    }

    /**
     * @param {string} source
     * @returns {Set<string>} Container HRIDs currently imported under this source
     */
    getImportedContainerHrids(source) {
        return new Set(Object.keys(this.imports[source] || {}));
    }

    /**
     * Import a batch of bulk historical containers from an external source (Edible Tools, MWI
     * Combat Suite, or a future source), recomputing Actual/Expected/Luck via Toolasha's own
     * valuation from the raw item counts rather than trusting the source's own stored numbers.
     * Re-importing the same source atomically replaces that source's entire snapshot - containers
     * present in an older export but absent from the new one do not survive (OA-5), which matters
     * for Edible multi-player exports where switching the selected player must not leave the
     * previous player's containers mixed into the current `import:edible` snapshot.
     * @param {string} source - e.g. 'import:edible' or 'import:mwi-combat-suite'
     * @param {Array<{containerHrid: string, containerCount: number, itemTotals: Object, sourceDataComplete?: boolean}>} containers
     * @returns {Promise<{results: Array<Object>, persisted: boolean}>} Resulting per-container
     *      aggregates and whether the import was actually saved
     */
    async importContainers(source, containers) {
        if (!this.characterId) return { results: [], persisted: false };

        const bySource = {};
        const results = [];

        for (const { containerHrid, containerCount, itemTotals, sourceDataComplete = true } of containers) {
            const record = buildImportedAggregateRecord({
                containerHrid,
                containerCount,
                itemTotals,
                timestamp: Date.now(),
                characterId: this.characterId,
                source,
                sourceDataComplete,
            });
            const aggregate = foldRecordIntoAggregate(createEmptyAggregate(), record);
            bySource[containerHrid] = aggregate;
            results.push({ containerHrid, aggregate });
        }

        const characterId = this.characterId;
        this.imports = { ...this.imports, [source]: bySource };
        const importsSnapshot = this.imports;
        this.notifyStateChange();

        const persisted = await this.enqueuePersistence(() => saveImports(characterId, importsSnapshot));
        if (!persisted) {
            console.error('[OpenableAnalytics] Could not save the imported data. It may not persist after reload.');
        }

        return { results, persisted };
    }

    /**
     * Remove one whole external source snapshot (e.g. 'import:edible'), keeping live Toolasha
     * history, current Session, and every other import source untouched.
     * @param {string} source
     * @returns {Promise<boolean>} Whether the removal was actually saved
     */
    async removeImport(source) {
        if (!this.characterId) return false;

        const characterId = this.characterId;
        const imports = { ...this.imports };
        delete imports[source];
        this.imports = imports;
        this.notifyStateChange();

        const persisted = await this.enqueuePersistence(() => saveImports(characterId, imports));
        if (!persisted) {
            console.error('[OpenableAnalytics] Could not remove the imported data. It may reappear after reload.');
        }

        return persisted;
    }

    /**
     * @param {string} [containerHrid] - If provided, filter history to this container only
     * @returns {Array<Object>} Detailed history records, most recent last
     */
    getHistory(containerHrid) {
        if (!containerHrid) return this.history;
        return this.history.filter((record) => record.containerHrid === containerHrid);
    }

    /**
     * Reset lifetime + history + imports + in-memory session data for one container, current
     * character. Commits in-memory state immediately and queues its persistence behind every
     * earlier opening/import/reset, so a later opening for a *different* container is unaffected
     * and a later opening for *this* container (arriving after this call returns) is never
     * overwritten by this reset (OA-4). Prunes any import source left with zero containers so an
     * empty `{ [source]: {} }` entry can never appear as an existing source.
     * @param {string} containerHrid
     * @returns {Promise<boolean>} Whether the reset was actually saved
     */
    async resetContainer(containerHrid) {
        if (!this.characterId) return false;

        const characterId = this.characterId;
        const lifetime = { ...this.lifetime };
        delete lifetime[containerHrid];
        const history = this.history.filter((record) => record.containerHrid !== containerHrid);
        const imports = Object.fromEntries(
            Object.entries(this.imports)
                .map(([source, byContainer]) => {
                    const next = { ...byContainer };
                    delete next[containerHrid];
                    return [source, next];
                })
                .filter(([, byContainer]) => Object.keys(byContainer).length > 0)
        );

        this.lifetime = lifetime;
        this.history = history;
        this.imports = imports;
        delete this.session[containerHrid];
        if (this.latestRecord?.containerHrid === containerHrid) {
            this.latestRecord = null;
        }
        this.notifyStateChange();

        const persisted = await this.enqueuePersistence(async () => {
            const lifetimeOk = await saveLifetime(characterId, lifetime);
            const historyOk = await saveHistory(characterId, history);
            const importsOk = await saveImports(characterId, imports);
            return lifetimeOk && historyOk && importsOk;
        });
        if (!persisted) {
            console.error('[OpenableAnalytics] Could not save this deletion. It may reappear after reload.');
        }

        return persisted;
    }

    /**
     * Reset all Openable Analytics data (lifetime + history + imports + in-memory session) for
     * the current character. Commits in-memory state immediately and queues the deletion behind
     * every earlier write, so an opening that arrives after this call starts still persists once
     * this reset's queued deletion has run (OA-4).
     * @returns {Promise<boolean>} Whether the reset was actually saved
     */
    async resetAll() {
        if (!this.characterId) return false;
        const characterId = this.characterId;
        this.lifetime = {};
        this.history = [];
        this.imports = {};
        this.session = {};
        this.latestRecord = null;
        this.notifyStateChange();

        const persisted = await this.enqueuePersistence(() => storageResetAll(characterId));
        if (!persisted) {
            console.error('[OpenableAnalytics] Could not save this deletion. It may reappear after reload.');
        }

        return persisted;
    }

    /**
     * Cleanup the collector's `loot_opened` subscription and in-memory state.
     */
    cleanup() {
        this.lifecycleGeneration += 1;

        if (this.lootOpenedHandler) {
            dataManager.off('loot_opened', this.lootOpenedHandler);
            this.lootOpenedHandler = null;
        }

        this.isInitialized = false;
        this.characterId = null;
        this.lifetime = {};
        this.history = [];
        this.imports = {};
        this.session = {};
        this.latestRecord = null;
        this.updateListeners.clear();
        this.stateChangeListeners.clear();
        // Deliberately do not reset persistenceQueue: an accepted old-lifecycle write must
        // finish under its captured character key, and initialize() waits on this same lane
        // before loading so it can never load a snapshot from before that write landed.
    }
}

const openableAnalyticsDataCollector = new OpenableAnalyticsDataCollector();

export default openableAnalyticsDataCollector;
