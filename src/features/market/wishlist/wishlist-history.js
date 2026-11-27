/**
 * Wishlist Price History
 * A per-character price series for every wishlist item, recorded from the moment the item is added
 * (the game exposes no historical prices, so nothing earlier can be reconstructed). Points are
 * [timestamp, price, estimated] where `estimated` is 1 when the price came from a fallback rather
 * than a live market price. Runs of identical points are compacted to their first and last.
 */

import storage from '../../../core/storage.js';

const STORE_NAME = 'settings';

/** Hard cap per item so a very long-lived entry cannot grow without bound */
export const MAX_POINTS_PER_ITEM = 20000;

/**
 * Append a point, compacting a run of 3+ identical consecutive values to its first and last.
 * @param {Array<Array<number>>} series - Existing series (mutated)
 * @param {Array<number>} point - [t, price, estimated]
 */
export function pushPoint(series, point) {
    series.push(point);

    const n = series.length;
    if (n >= 3) {
        const [, price, estimated] = point;
        const same = (p) => p[1] === price && p[2] === estimated;
        if (same(series[n - 2]) && same(series[n - 3])) {
            series.splice(n - 2, 1);
        }
    }

    if (series.length > MAX_POINTS_PER_ITEM) {
        series.splice(0, series.length - MAX_POINTS_PER_ITEM);
    }
}

class WishlistHistory {
    constructor() {
        this.characterId = null;
        this.data = {};
        this.lastRecordedAt = 0;
    }

    storageKey() {
        return `wishlistHistory_${this.characterId}`;
    }

    async load(characterId) {
        this.characterId = characterId;
        this.data = {};
        if (!characterId) return;

        let stored = null;
        try {
            stored = await storage.getJSON(this.storageKey(), STORE_NAME, {});
        } catch (error) {
            console.error('[Wishlist] Failed to load price history:', error);
        }
        if (this.characterId !== characterId) return;
        this.data = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    }

    /**
     * Record a price for an item.
     * @param {string} key - Wishlist key
     * @param {number} price - Price per item; non-positive prices are not recorded
     * @param {boolean} estimated - True when the price is a fallback estimate
     * @param {number} [now]
     */
    record(key, price, estimated, now = Date.now()) {
        if (!this.characterId || !(price > 0)) return;
        if (!this.data[key]) this.data[key] = [];
        pushPoint(this.data[key], [now, Math.round(price), estimated ? 1 : 0]);
        this.lastRecordedAt = now;
    }

    /**
     * @param {string} key - Wishlist key
     * @returns {Array<Array<number>>} Series (oldest first), empty when none
     */
    getSeries(key) {
        return this.data[key] || [];
    }

    async removeKey(key) {
        if (!(key in this.data)) return;
        delete this.data[key];
        await this.save();
    }

    async save() {
        if (!this.characterId) return;
        try {
            await storage.setJSON(this.storageKey(), this.data, STORE_NAME, true);
        } catch (error) {
            console.error('[Wishlist] Failed to save price history:', error);
        }
    }

    reset() {
        this.characterId = null;
        this.data = {};
        this.lastRecordedAt = 0;
    }
}

const wishlistHistory = new WishlistHistory();

export default wishlistHistory;
export { WishlistHistory };
