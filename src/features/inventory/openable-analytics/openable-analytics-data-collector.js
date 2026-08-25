/**
 * Openable Analytics Data Collector
 * Listens for the native `loot_opened` WebSocket message, builds a normalized opening record via
 * the shared calculator, and maintains character-scoped session (in-memory) and lifetime
 * (persisted) aggregates plus a bounded detailed history.
 */

import webSocketHook from '../../../core/websocket.js';
import dataManager from '../../../core/data-manager.js';
import { buildOpeningRecord } from './openable-analytics-calculator.js';
import {
    loadLifetime,
    saveLifetime,
    loadHistory,
    appendHistory,
    foldRecordIntoAggregate,
    createEmptyAggregate,
    resetContainer as storageResetContainer,
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
        this.latestRecord = null;
        this.updateListeners = new Set();
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
        this.characterId = dataManager.getCurrentCharacterId();
        const generation = ++this.lifecycleGeneration;

        this.session = {};
        this.latestRecord = null;

        if (this.characterId) {
            this.lifetime = await loadLifetime(this.characterId);
            this.history = await loadHistory(this.characterId);
        } else {
            this.lifetime = {};
            this.history = [];
        }

        if (generation !== this.lifecycleGeneration || !this.isInitialized) return;

        this.lootOpenedHandler = (data) => this.onLootOpened(data, generation);
        webSocketHook.on('loot_opened', this.lootOpenedHandler);
    }

    /**
     * Handle a native `loot_opened` message: normalize, fold into session/lifetime aggregates,
     * persist, and notify UI listeners.
     * @param {Object} data - Raw `loot_opened` message payload
     * @param {number} generation - Lifecycle generation captured at registration time
     */
    async onLootOpened(data, generation) {
        if (generation !== this.lifecycleGeneration) return;
        if (!data?.openedItem?.itemHrid) return;

        await this.recordOpening(
            {
                containerHrid: data.openedItem.itemHrid,
                containerCount: data.openedItem.count || 1,
                gainedItems: data.gainedItems,
                grantedBuffs: data.grantedBuffs,
                timestamp: Date.now(),
                characterId: this.characterId,
            },
            { generation }
        );
    }

    /**
     * Build and record one opening from already-normalized input. This is the shared entry
     * point for both the live WebSocket path and any future historical-import adapter (Edible
     * Tools / MWI Combat Suite) - an importer can call this directly with `source: 'import:...'`
     * without needing to go through `loot_opened` at all.
     * @param {Object} input - See `buildOpeningRecord` for shape
     * @param {Object} [options]
     * @param {number} [options.generation] - Lifecycle generation to guard against a stale
     *      continuation resuming after `cleanup()`/a character switch
     * @returns {Promise<Object>} The normalized record that was recorded
     */
    async recordOpening(input, { generation = this.lifecycleGeneration } = {}) {
        const record = buildOpeningRecord(input);

        if (generation !== this.lifecycleGeneration) return record;

        this.session[record.containerHrid] = foldRecordIntoAggregate(this.session[record.containerHrid], record);
        this.latestRecord = record;
        this.notifyListeners(record);

        if (record.characterId) {
            this.lifetime = {
                ...this.lifetime,
                [record.containerHrid]: foldRecordIntoAggregate(this.lifetime[record.containerHrid], record),
            };
            this.history = await appendHistory(record.characterId, this.history, record);

            if (generation !== this.lifecycleGeneration) return record;
            await saveLifetime(record.characterId, this.lifetime);
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
     * @param {string} containerHrid
     * @returns {Object} Lifetime (persisted) aggregate
     */
    getLifetimeAggregate(containerHrid) {
        return this.lifetime[containerHrid] || createEmptyAggregate();
    }

    /**
     * @returns {Array<string>} Container HRIDs that have at least one lifetime opening recorded
     */
    getKnownContainers() {
        return Object.keys(this.lifetime);
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
     * Reset lifetime + history + in-memory session data for one container, current character.
     * @param {string} containerHrid
     */
    async resetContainer(containerHrid) {
        if (!this.characterId) return;
        const { lifetime, history } = await storageResetContainer(this.characterId, containerHrid);
        this.lifetime = lifetime;
        this.history = history;
        delete this.session[containerHrid];
        if (this.latestRecord?.containerHrid === containerHrid) {
            this.latestRecord = null;
        }
    }

    /**
     * Reset all Openable Analytics data (lifetime + history + in-memory session) for the
     * current character.
     */
    async resetAll() {
        if (!this.characterId) return;
        await storageResetAll(this.characterId);
        this.lifetime = {};
        this.history = [];
        this.session = {};
        this.latestRecord = null;
    }

    /**
     * Cleanup the collector's WebSocket subscription and in-memory state.
     */
    cleanup() {
        this.lifecycleGeneration += 1;

        if (this.lootOpenedHandler) {
            webSocketHook.off('loot_opened', this.lootOpenedHandler);
            this.lootOpenedHandler = null;
        }

        this.isInitialized = false;
        this.characterId = null;
        this.lifetime = {};
        this.history = [];
        this.session = {};
        this.latestRecord = null;
        this.updateListeners.clear();
    }
}

const openableAnalyticsDataCollector = new OpenableAnalyticsDataCollector();

export default openableAnalyticsDataCollector;
