/**
 * Wishlist Store
 * The player's per-character list of items they want to buy, in the order they want them.
 * Persisted in the settings store under `wishlist_<characterId>`. Each entry is an item at a
 * specific enhancement level (equipment upgrades are usually enhanced).
 */

import storage from '../../../core/storage.js';

const STORE_NAME = 'settings';

/**
 * Stable identity of a wishlist entry
 * @param {string} itemHrid - Item HRID
 * @param {number} [enhancementLevel=0] - Enhancement level
 * @returns {string} e.g. "/items/expert_torch:0"
 */
export function getWishlistKey(itemHrid, enhancementLevel = 0) {
    return `${itemHrid}:${enhancementLevel || 0}`;
}

class WishlistStore {
    constructor() {
        this.characterId = null;
        this.items = [];
        this.listeners = new Set();
    }

    storageKey() {
        return `wishlist_${this.characterId}`;
    }

    /**
     * Load the list for a character. A load that finishes after a character switch is dropped.
     * @param {string|number|null} characterId
     */
    async load(characterId) {
        this.characterId = characterId;
        this.items = [];
        if (!characterId) return;

        let stored = null;
        try {
            stored = await storage.getJSON(this.storageKey(), STORE_NAME, []);
        } catch (error) {
            console.error('[Wishlist] Failed to load wishlist:', error);
        }
        if (this.characterId !== characterId) return;

        const seen = new Set();
        this.items = (Array.isArray(stored) ? stored : [])
            .filter((entry) => entry && typeof entry.itemHrid === 'string')
            .map((entry) => ({
                itemHrid: entry.itemHrid,
                enhancementLevel: entry.enhancementLevel || 0,
                addedAt: entry.addedAt || Date.now(),
            }))
            .filter((entry) => {
                const key = getWishlistKey(entry.itemHrid, entry.enhancementLevel);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        this.emit();
    }

    /**
     * @returns {Array<{itemHrid: string, enhancementLevel: number, addedAt: number}>} Copy of the list
     */
    getItems() {
        return this.items.map((entry) => ({ ...entry }));
    }

    has(itemHrid, enhancementLevel = 0) {
        const key = getWishlistKey(itemHrid, enhancementLevel);
        return this.items.some((entry) => getWishlistKey(entry.itemHrid, entry.enhancementLevel) === key);
    }

    /**
     * Add an item at the end of the list. No-op when it is already there.
     * @returns {Promise<boolean>} True when the item was added
     */
    async add(itemHrid, enhancementLevel = 0) {
        if (!this.characterId || !itemHrid || this.has(itemHrid, enhancementLevel)) return false;
        this.items.push({ itemHrid, enhancementLevel: enhancementLevel || 0, addedAt: Date.now() });
        await this.save();
        this.emit();
        return true;
    }

    /**
     * @returns {Promise<boolean>} True when the item was in the list
     */
    async remove(itemHrid, enhancementLevel = 0) {
        const key = getWishlistKey(itemHrid, enhancementLevel);
        const index = this.items.findIndex((entry) => getWishlistKey(entry.itemHrid, entry.enhancementLevel) === key);
        if (index === -1) return false;
        this.items.splice(index, 1);
        await this.save();
        this.emit();
        return true;
    }

    /**
     * Reorder the list. Unknown keys are ignored; entries not named keep their relative order at
     * the end, so a stale drag can never lose an item.
     * @param {string[]} orderedKeys - Wishlist keys in the desired order
     */
    async reorder(orderedKeys) {
        const byKey = new Map(
            this.items.map((entry) => [getWishlistKey(entry.itemHrid, entry.enhancementLevel), entry])
        );
        const next = [];
        for (const key of orderedKeys) {
            const entry = byKey.get(key);
            if (entry) {
                next.push(entry);
                byKey.delete(key);
            }
        }
        next.push(...byKey.values());

        const unchanged = next.length === this.items.length && next.every((entry, i) => entry === this.items[i]);
        if (unchanged) return;
        this.items = next;
        await this.save();
        this.emit();
    }

    async save() {
        if (!this.characterId) return;
        try {
            await storage.setJSON(this.storageKey(), this.items, STORE_NAME, true);
        } catch (error) {
            console.error('[Wishlist] Failed to save wishlist:', error);
        }
    }

    /**
     * @param {Function} listener - Called after every change
     * @returns {Function} Unsubscribe
     */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (error) {
                console.error('[Wishlist] Change listener failed:', error);
            }
        }
    }

    /** Forget the loaded character (character switch / feature disable). Listeners are kept. */
    reset() {
        this.characterId = null;
        this.items = [];
    }
}

const wishlistStore = new WishlistStore();

export default wishlistStore;
export { WishlistStore };
