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

const { WishlistHistory, pushPoint, MAX_POINTS_PER_ITEM } = await import('./wishlist-history.js');

describe('pushPoint', () => {
    test('keeps only the first and last of a run of identical prices', () => {
        const series = [];
        for (let t = 1; t <= 6; t++) pushPoint(series, [t, 100, 0]);

        expect(series).toEqual([
            [1, 100, 0],
            [6, 100, 0],
        ]);
    });

    test('keeps every point while the price changes', () => {
        const series = [];
        [100, 110, 100, 110].forEach((price, i) => pushPoint(series, [i, price, 0]));

        expect(series).toHaveLength(4);
    });

    test('a different estimated flag breaks a run', () => {
        const series = [];
        pushPoint(series, [1, 100, 0]);
        pushPoint(series, [2, 100, 1]);
        pushPoint(series, [3, 100, 0]);

        expect(series).toHaveLength(3);
    });

    test('drops the oldest points past the cap', () => {
        const series = [];
        for (let i = 0; i < MAX_POINTS_PER_ITEM + 5; i++) pushPoint(series, [i, i + 1, 0]);

        expect(series).toHaveLength(MAX_POINTS_PER_ITEM);
        expect(series[0][0]).toBe(5);
    });
});

describe('WishlistHistory', () => {
    let history;

    beforeEach(() => {
        disk.data = {};
        history = new WishlistHistory();
    });

    test('records rounded prices per item and ignores non-positive ones', async () => {
        await history.load('c');

        history.record('/items/a:0', 1234.6, false, 10);
        history.record('/items/a:0', 0, false, 20);
        history.record('/items/a:0', -5, false, 30);

        expect(history.getSeries('/items/a:0')).toEqual([[10, 1235, 0]]);
        expect(history.getSeries('/items/unknown:0')).toEqual([]);
    });

    test('flags estimated prices', async () => {
        await history.load('c');
        history.record('/items/a:0', 500, true, 10);

        expect(history.getSeries('/items/a:0')[0][2]).toBe(1);
    });

    test('persists per character and removes a deleted item', async () => {
        await history.load('c');
        history.record('/items/a:0', 500, false, 10);
        history.record('/items/b:0', 700, false, 10);
        await history.save();

        expect(Object.keys(disk.data['wishlistHistory_c'])).toEqual(['/items/a:0', '/items/b:0']);

        await history.removeKey('/items/a:0');
        expect(Object.keys(disk.data['wishlistHistory_c'])).toEqual(['/items/b:0']);

        const reloaded = new WishlistHistory();
        await reloaded.load('c');
        expect(reloaded.getSeries('/items/b:0')).toEqual([[10, 700, 0]]);
    });

    test('records nothing without a loaded character', () => {
        history.record('/items/a:0', 500, false, 10);

        expect(history.getSeries('/items/a:0')).toEqual([]);
    });

    test('tolerates corrupt stored data', async () => {
        disk.data['wishlistHistory_c'] = ['not', 'an', 'object'];
        await history.load('c');

        expect(history.getSeries('/items/a:0')).toEqual([]);
    });
});
