/**
 * Networth History Tracker
 * Records hourly snapshots of networth breakdown to IndexedDB.
 * Used by the networth history chart for trend visualization.
 */

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import connectionState from '../../core/connection-state.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const STORE_NAME = 'networthHistory';
const SNAPSHOT_INTERVAL = 60 * 60 * 1000; // 1 hour
const MAX_DETAIL_SNAPSHOTS = 25; // ~24h of hourly snapshots + 1 buffer

/** Gap threshold for chart line breaks (2 hours) */
export const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000;

class NetworthHistory {
    constructor() {
        this.history = [];
        this.detailHistory = [];
        this.characterId = null;
        this.timerRegistry = createTimerRegistry();
        this.networthFeature = null;
    }

    /**
     * Initialize the history tracker
     * @param {Object} networthFeature - Reference to NetworthFeature instance (for currentData)
     */
    async initialize(networthFeature) {
        this.networthFeature = networthFeature;
        this.characterId = dataManager.getCurrentCharacterId();

        if (!this.characterId) {
            console.warn('[NetworthHistory] No character ID available');
            return;
        }

        // Load existing history from storage
        const storageKey = `networth_${this.characterId}`;
        this.history = await storage.get(storageKey, STORE_NAME, []);

        // Load existing detail history from storage
        const detailKey = `networthDetail_${this.characterId}`;
        this.detailHistory = await storage.get(detailKey, STORE_NAME, []);

        // Take an immediate first snapshot
        await this.takeSnapshot();

        // Start hourly interval
        const intervalId = setInterval(() => this.takeSnapshot(), SNAPSHOT_INTERVAL);
        this.timerRegistry.registerInterval(intervalId);
    }

    /**
     * Take a snapshot of the current networth data
     */
    async takeSnapshot() {
        if (!connectionState.isConnected()) return;
        if (!this.networthFeature?.currentData) return;
        if (!this.characterId) return;

        const data = this.networthFeature.currentData;

        const snapshot = {
            t: Date.now(),
            total: Math.round(data.totalNetworth + (data.excluded?.total ?? 0)),
            nonExcluded: Math.round(data.totalNetworth),
            gold: Math.round(data.coins),
            inventory: Math.round(data.currentAssets.inventory.value),
            equipment: Math.round(data.currentAssets.equipped.value),
            listings: Math.round(data.currentAssets.listings.value),
            house: Math.round(data.fixedAssets.houses.totalCost),
            abilities: Math.round(data.fixedAssets.abilities.totalCost + data.fixedAssets.abilityBooks.totalCost),
        };

        this.pushSnapshot(snapshot);

        // Take item-level detail snapshot for 24h breakdown
        this.takeDetailSnapshot(data);

        // Persist to storage
        const storageKey = `networth_${this.characterId}`;
        await storage.set(storageKey, this.history, STORE_NAME);

        const detailKey = `networthDetail_${this.characterId}`;
        await storage.set(detailKey, this.detailHistory, STORE_NAME);
    }

    /**
     * Append a snapshot and compact consecutive identical totals.
     * If 3+ consecutive entries share the same total, keep only the first and last.
     * @param {Object} snapshot - Snapshot object with t, total, and breakdown fields
     */
    pushSnapshot(snapshot) {
        this.history.push(snapshot);

        if (this.history.length < 3) return;

        // Count consecutive same-total entries from the end
        const currentTotal = snapshot.total;
        let runStart = this.history.length - 1;
        while (runStart > 0 && this.history[runStart - 1].total === currentTotal) {
            runStart--;
        }

        const runLength = this.history.length - runStart;
        // If run is 3+, remove all middle entries (keep first and last of run)
        if (runLength >= 3) {
            this.history.splice(runStart + 1, runLength - 2);
        }
    }

    /**
     * Take an item-level detail snapshot for 24h breakdown diffs.
     * Stores inventory + equipped items keyed by "itemHrid:enhancementLevel".
     * Rolling window of MAX_DETAIL_SNAPSHOTS entries.
     * @param {Object} data - Current networthData from calculateNetworth()
     */
    takeDetailSnapshot(data) {
        const items = {};

        // Gold
        items['/items/coin:0'] = { count: Math.round(data.coins), value: Math.round(data.coins) };

        // Inventory items
        for (const item of data.currentAssets.inventory.breakdown) {
            if (!item.itemHrid) continue;
            const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
            items[key] = { count: item.count || 0, value: Math.round(item.value || 0) };
        }

        // Equipped items
        for (const item of data.currentAssets.equipped.breakdown) {
            if (!item.itemHrid) continue;
            const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
            items[key] = { count: 1, value: Math.round(item.value || 0) };
        }

        this.detailHistory.push({ t: Date.now(), items });

        // Trim to rolling window
        if (this.detailHistory.length > MAX_DETAIL_SNAPSHOTS) {
            this.detailHistory.splice(0, this.detailHistory.length - MAX_DETAIL_SNAPSHOTS);
        }
    }

    /**
     * Get the detail snapshot closest to the target timestamp.
     * Used to find the ~24h ago snapshot for diffing.
     * @param {number} targetTs - Target timestamp to find closest snapshot to
     * @returns {Object|null} Detail snapshot { t, items } or null if none available
     */
    getDetailSnapshot(targetTs) {
        if (this.detailHistory.length === 0) return null;

        let closest = this.detailHistory[0];
        let closestDiff = Math.abs(closest.t - targetTs);

        for (let i = 1; i < this.detailHistory.length; i++) {
            const diff = Math.abs(this.detailHistory[i].t - targetTs);
            if (diff < closestDiff) {
                closest = this.detailHistory[i];
                closestDiff = diff;
            }
        }

        return closest;
    }

    /**
     * Get the full history array
     * @returns {Array} Array of snapshot objects
     */
    getHistory() {
        return this.history;
    }

    /**
     * Delete a snapshot by timestamp and persist the change to storage.
     * @param {number} timestamp - The `t` value of the snapshot to remove
     */
    async deleteSnapshot(timestamp) {
        const idx = this.history.findIndex((s) => s.t === timestamp);
        if (idx === -1) return;
        this.history.splice(idx, 1);
        const storageKey = `networth_${this.characterId}`;
        await storage.set(storageKey, this.history, STORE_NAME);
    }

    /**
     * Cleanup when disabled
     */
    disable() {
        this.timerRegistry.clearAll();
        this.history = [];
        this.detailHistory = [];
        this.characterId = null;
        this.networthFeature = null;
    }
}

const networthHistory = new NetworthHistory();

export default networthHistory;
