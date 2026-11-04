/**
 * Combat Live history
 *
 * The last finished sessions, kept so a fight can be looked at again after the meters have been reset
 * (by hand or because a new combat started). Each entry is the summary the panel showed, so reopening
 * it needs no recomputing. Plain sessions are capped; starred ones are kept longer.
 */

import storage from '../../core/storage.js';

const STORAGE_KEY = 'combatLive_history';
const STORAGE_STORE = 'settings';
// Fights shorter than this, or that dealt nothing, are not worth keeping
export const MIN_SECONDS = 30;
export const MAX_PLAIN = 10;
export const MAX_FAVORITES = 30;

/**
 * The part of a summary worth keeping: everything the tabs show, without the live chart data.
 * @param {Object} summary - BattleStats.getSummary()
 * @returns {Object}
 */
export function slimSummary(summary) {
    const { chart: _chart, charts: _charts, ...rest } = summary;
    return JSON.parse(JSON.stringify(rest));
}

export class CombatLiveHistory {
    constructor() {
        this.entries = [];
        this.loaded = null;
        this.listeners = new Set();
    }

    /**
     * Read the saved entries once.
     * @returns {Promise<void>}
     */
    load() {
        if (!this.loaded) {
            this.loaded = (async () => {
                const saved = await storage.get(STORAGE_KEY, STORAGE_STORE, []);
                this.entries = Array.isArray(saved) ? saved.filter((entry) => entry?.summary) : [];
            })();
        }
        return this.loaded;
    }

    /**
     * @param {function(): void} listener - Called whenever the list changes
     * @returns {function(): void} Unsubscribe
     */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * @returns {Object[]} Entries, newest first
     */
    list() {
        return [...this.entries].sort((a, b) => b.date - a.date);
    }

    /**
     * Keep a finished session, if it was big enough to matter.
     * @param {Object} summary - BattleStats.getSummary() at the end of the session
     * @param {number} [at] - When it ended, in ms
     * @returns {Promise<?Object>} The new entry, or null when it was not kept
     */
    async archive(summary, at = Date.now()) {
        if (!summary || !(summary.seconds >= MIN_SECONDS) || !(summary.party?.damage > 0)) return null;
        await this.load();
        const entry = {
            id: `${at}-${Math.random().toString(36).slice(2, 7)}`,
            date: at,
            label: '',
            favorite: false,
            summary: slimSummary(summary),
        };
        this.entries.push(entry);
        this.trim();
        await this.persist();
        return entry;
    }

    /**
     * Drop the oldest plain entries beyond the cap, and the oldest stars beyond theirs.
     */
    trim() {
        const dropOldest = (entries, max) => {
            const keep = new Set(
                [...entries]
                    .sort((a, b) => b.date - a.date)
                    .slice(0, max)
                    .map((entry) => entry.id)
            );
            return entries.filter((entry) => keep.has(entry.id));
        };
        this.entries = [
            ...dropOldest(
                this.entries.filter((entry) => !entry.favorite),
                MAX_PLAIN
            ),
            ...dropOldest(
                this.entries.filter((entry) => entry.favorite),
                MAX_FAVORITES
            ),
        ];
    }

    async toggleFavorite(id) {
        const entry = this.entries.find((item) => item.id === id);
        if (!entry) return;
        entry.favorite = !entry.favorite;
        this.trim();
        await this.persist();
    }

    async rename(id, label) {
        const entry = this.entries.find((item) => item.id === id);
        if (!entry) return;
        entry.label = String(label || '').slice(0, 60);
        await this.persist();
    }

    /**
     * Remove every entry that is not starred.
     */
    async clearPlain() {
        this.entries = this.entries.filter((entry) => entry.favorite);
        await this.persist();
    }

    async persist() {
        await storage.set(STORAGE_KEY, this.entries, STORAGE_STORE);
        for (const listener of this.listeners) listener();
    }
}

export default CombatLiveHistory;
