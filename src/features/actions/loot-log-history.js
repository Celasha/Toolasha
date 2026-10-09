/**
 * Loot Log History Storage
 * Persists loot log entries to IndexedDB for extended history
 */

import storage from '../../core/storage.js';
import dataManager from '../../core/data-manager.js';
import { buildEntryIdentityKey, isMoreCompleteEntry } from './loot-log-analytics.js';

const STORE_NAME = 'lootLogHistory';
const MAX_ENTRIES = 5000;

class LootLogHistory {
    _getKey() {
        const charId = dataManager.getCurrentCharacterId();
        return charId ? `lootLog_${charId}` : null;
    }

    /**
     * @returns {Promise<Array>}
     */
    async _load() {
        const key = this._getKey();
        if (!key) return [];
        return await storage.get(key, STORE_NAME, []);
    }

    /**
     * @param {Array} entries
     */
    async _save(entries) {
        const key = this._getKey();
        if (!key) return;
        await storage.set(key, entries, STORE_NAME, true);
    }

    /**
     * Merge new entries from a loot_log_updated message into stored history.
     *
     * Deduplicates by entry identity (actionHrid/difficultyTier/item hashes/partyId/startTime -
     * see buildEntryIdentityKey), not characterActionId: a single continuous action (e.g. an
     * interrupted-and-resumed labyrinth run) can have characterActionId reissued mid-session while
     * startTime stays stable, which previously caused one real run to be stored as several
     * separate, incomplete entries. When an incoming entry shares an identity with one already
     * stored, the more complete copy (higher actionCount, tie-broken by later endTime) replaces
     * the other instead of being discarded or duplicated. Sorted newest-first, capped at
     * MAX_ENTRIES.
     * @param {Array} lootLog - Array from the WebSocket message
     */
    async mergeAndSave(lootLog) {
        if (!lootLog || lootLog.length === 0) return;

        const existing = await this._load();
        const byKey = new Map(existing.map((e) => [buildEntryIdentityKey(e), e]));

        let changed = false;
        for (const entry of lootLog) {
            const key = buildEntryIdentityKey(entry);
            if (isMoreCompleteEntry(entry, byKey.get(key))) {
                byKey.set(key, entry);
                changed = true;
            }
        }
        if (!changed) return;

        const merged = Array.from(byKey.values());
        merged.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        await this._save(merged.slice(0, MAX_ENTRIES));
    }

    /**
     * Get entries that are in storage but not in the current game-provided set.
     * @param {Set<string>} currentKeys - identity keys (buildEntryIdentityKey) from the current
     *   loot_log_updated
     * @returns {Promise<Array>}
     */
    async getHistoricalEntries(currentKeys) {
        const all = await this._load();
        return all.filter((e) => !currentKeys.has(buildEntryIdentityKey(e)));
    }

    /**
     * Collapse any already-stored duplicate entries sharing the same identity key down to the
     * single most-complete copy. One-time self-heal for history written before entries were
     * deduplicated by identity instead of the unstable characterActionId - safe to call
     * repeatedly (a no-op once storage has no duplicates left).
     * @returns {Promise<number>} Number of duplicate entries removed
     */
    async dedupeStoredEntries() {
        const existing = await this._load();
        if (existing.length === 0) return 0;

        const byKey = new Map();
        for (const entry of existing) {
            const key = buildEntryIdentityKey(entry);
            if (isMoreCompleteEntry(entry, byKey.get(key))) {
                byKey.set(key, entry);
            }
        }

        const removedCount = existing.length - byKey.size;
        if (removedCount === 0) return 0;

        const deduped = Array.from(byKey.values());
        deduped.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        await this._save(deduped);
        return removedCount;
    }

    async clearHistory() {
        const key = this._getKey();
        if (!key) return;
        await storage.delete(key, STORE_NAME);
    }
}

const lootLogHistory = new LootLogHistory();
export default lootLogHistory;
