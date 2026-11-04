import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saved: [] }));
vi.mock('../../core/storage.js', () => ({
    default: {
        get: vi.fn(async (_key, _store, fallback) => (mocks.saved === undefined ? fallback : mocks.saved)),
        set: vi.fn(async (_key, value) => {
            mocks.saved = value;
        }),
    },
}));

const { CombatLiveHistory, MAX_PLAIN, MAX_FAVORITES, slimSummary } = await import('./combat-live-history.js');

const summary = (overrides = {}) => ({
    seconds: 120,
    party: { damage: 5000, dps: 40, kills: 3 },
    chart: { hits: [1, 2, 3] },
    charts: [{ player: 'Alice' }],
    dealt: [{ name: 'Alice', damage: 5000 }],
    ...overrides,
});

describe('slimSummary', () => {
    test('drops the live chart data and copies the rest', () => {
        const slim = slimSummary(summary());

        expect(slim.chart).toBeUndefined();
        expect(slim.charts).toBeUndefined();
        expect(slim.dealt).toEqual([{ name: 'Alice', damage: 5000 }]);
    });
});

describe('CombatLiveHistory', () => {
    let history;

    beforeEach(() => {
        mocks.saved = [];
        history = new CombatLiveHistory();
    });

    test('keeps a session that was long enough and dealt damage, newest first', async () => {
        await history.archive(summary(), 1000);
        await history.archive(summary(), 2000);

        expect(history.list().map((entry) => entry.date)).toEqual([2000, 1000]);
        expect(mocks.saved).toHaveLength(2);
    });

    test('ignores a short session or one that dealt nothing', async () => {
        expect(await history.archive(summary({ seconds: 10 }), 1)).toBeNull();
        expect(await history.archive(summary({ party: { damage: 0 } }), 2)).toBeNull();
        expect(await history.archive(null, 3)).toBeNull();
        expect(history.list()).toEqual([]);
    });

    test('keeps only the newest plain sessions, but starred ones stay', async () => {
        const first = await history.archive(summary(), 1);
        await history.toggleFavorite(first.id);
        for (let i = 2; i < 2 + MAX_PLAIN + 3; i++) await history.archive(summary(), i);

        const dates = history.list().map((entry) => entry.date);
        expect(history.list().filter((entry) => !entry.favorite)).toHaveLength(MAX_PLAIN);
        expect(dates).toContain(1);
    });

    test('caps the stars too', async () => {
        for (let i = 1; i <= MAX_FAVORITES + 2; i++) {
            const entry = await history.archive(summary(), i);
            await history.toggleFavorite(entry.id);
        }

        expect(history.list().filter((entry) => entry.favorite)).toHaveLength(MAX_FAVORITES);
    });

    test('renames, and clearing keeps the starred ones', async () => {
        const a = await history.archive(summary(), 1);
        const b = await history.archive(summary(), 2);
        await history.rename(a.id, 'Zone 9 boss');
        await history.toggleFavorite(b.id);

        expect(history.list().find((entry) => entry.id === a.id).label).toBe('Zone 9 boss');
        await history.clearPlain();
        expect(history.list().map((entry) => entry.id)).toEqual([b.id]);
    });

    test('loads what was saved before, and ignores a broken save', async () => {
        mocks.saved = [{ id: 'x', date: 5, summary: { seconds: 60 } }, { id: 'broken' }];
        await history.load();
        expect(history.list().map((entry) => entry.id)).toEqual(['x']);

        mocks.saved = 'not a list';
        const other = new CombatLiveHistory();
        await other.load();
        expect(other.list()).toEqual([]);
    });

    test('tells listeners when the list changes', async () => {
        const listener = vi.fn();
        history.onChange(listener);

        await history.archive(summary(), 1);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
