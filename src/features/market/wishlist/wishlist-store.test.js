import { beforeEach, describe, expect, test, vi } from 'vitest';

const disk = vi.hoisted(() => ({ data: {} }));

vi.mock('../../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _store, fallback) => (key in disk.data ? disk.data[key] : fallback)),
        setJSON: vi.fn(async (key, value) => {
            disk.data[key] = JSON.parse(JSON.stringify(value));
        }),
    },
}));

const { WishlistStore, getWishlistKey } = await import('./wishlist-store.js');

describe('WishlistStore', () => {
    let store;

    beforeEach(() => {
        disk.data = {};
        store = new WishlistStore();
    });

    test('builds a stable key per item and enhancement level', () => {
        expect(getWishlistKey('/items/a')).toBe('/items/a:0');
        expect(getWishlistKey('/items/a', 7)).toBe('/items/a:7');
    });

    test('adds items in order, once, and persists them per character', async () => {
        await store.load('char-1');

        expect(await store.add('/items/a', 0)).toBe(true);
        expect(await store.add('/items/b', 5)).toBe(true);
        expect(await store.add('/items/a', 0)).toBe(false);

        expect(store.getItems().map((i) => getWishlistKey(i.itemHrid, i.enhancementLevel))).toEqual([
            '/items/a:0',
            '/items/b:5',
        ]);
        expect(disk.data['wishlist_char-1']).toHaveLength(2);

        const other = new WishlistStore();
        await other.load('char-2');
        expect(other.getItems()).toEqual([]);
    });

    test('the same item at different enhancement levels is two entries', async () => {
        await store.load('c');
        await store.add('/items/a', 0);
        await store.add('/items/a', 10);

        expect(store.getItems()).toHaveLength(2);
        expect(store.has('/items/a', 10)).toBe(true);
        expect(store.has('/items/a', 3)).toBe(false);
    });

    test('removes an item and reports whether it existed', async () => {
        await store.load('c');
        await store.add('/items/a', 0);

        expect(await store.remove('/items/a', 0)).toBe(true);
        expect(await store.remove('/items/a', 0)).toBe(false);
        expect(store.getItems()).toEqual([]);
    });

    test('reorder follows the given keys and never loses an entry', async () => {
        await store.load('c');
        await store.add('/items/a');
        await store.add('/items/b');
        await store.add('/items/c');

        await store.reorder(['/items/c:0', '/items/a:0']);

        expect(store.getItems().map((i) => i.itemHrid)).toEqual(['/items/c', '/items/a', '/items/b']);

        await store.reorder(['/items/gone:0', '/items/b:0']);
        expect(store.getItems().map((i) => i.itemHrid)).toEqual(['/items/b', '/items/c', '/items/a']);
    });

    test('reorder to the same order does not save or notify', async () => {
        await store.load('c');
        await store.add('/items/a');
        await store.add('/items/b');
        const listener = vi.fn();
        store.onChange(listener);

        await store.reorder(['/items/a:0', '/items/b:0']);

        expect(listener).not.toHaveBeenCalled();
    });

    test('notifies listeners on changes and stops after unsubscribe', async () => {
        await store.load('c');
        const listener = vi.fn();
        const unsubscribe = store.onChange(listener);

        await store.add('/items/a');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        await store.add('/items/b');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('loads saved entries, dropping malformed and duplicate ones', async () => {
        disk.data['wishlist_c'] = [
            { itemHrid: '/items/a', enhancementLevel: 2, addedAt: 5 },
            { itemHrid: '/items/a', enhancementLevel: 2, addedAt: 9 },
            { nope: true },
            null,
        ];

        await store.load('c');

        expect(store.getItems()).toEqual([{ itemHrid: '/items/a', enhancementLevel: 2, addedAt: 5 }]);
    });

    test('a load that finishes after a character switch is dropped', async () => {
        disk.data['wishlist_slow'] = [{ itemHrid: '/items/slow', enhancementLevel: 0, addedAt: 1 }];
        const slow = store.load('slow');
        await store.load('fast');
        await slow;

        expect(store.characterId).toBe('fast');
        expect(store.getItems()).toEqual([]);
    });

    test('does nothing without a loaded character', async () => {
        expect(await store.add('/items/a')).toBe(false);
        expect(store.getItems()).toEqual([]);
    });
});
