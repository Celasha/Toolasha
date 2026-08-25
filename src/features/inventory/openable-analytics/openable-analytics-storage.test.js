import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ values: new Map() }));

vi.mock('../../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _store, defaultValue = null) =>
            mocks.values.has(key) ? mocks.values.get(key) : defaultValue
        ),
        setJSON: vi.fn(async (key, value) => {
            mocks.values.set(key, value);
            return true;
        }),
        delete: vi.fn(async (key) => {
            mocks.values.delete(key);
            return true;
        }),
    },
}));

const storageModule = await import('./openable-analytics-storage.js');
const {
    loadLifetime,
    saveLifetime,
    loadHistory,
    appendHistory,
    createEmptyAggregate,
    foldRecordIntoAggregate,
    resetContainer,
    resetAll,
    OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS,
} = storageModule;

beforeEach(() => {
    mocks.values.clear();
});

function makeRecord(overrides = {}) {
    return {
        containerHrid: '/items/chest',
        containerCount: 1,
        gainedItems: [{ itemHrid: '/items/coin', enhancementLevel: 0, count: 100 }],
        grantedBuffs: [],
        actualValue: 100,
        actualValueComplete: true,
        expectedValue: 90,
        expectedValueAvailable: true,
        ...overrides,
    };
}

describe('character scoping', () => {
    test('lifetime and history are stored under different keys for different characters', async () => {
        await saveLifetime('char-a', { '/items/chest': createEmptyAggregate() });
        await saveLifetime('char-b', {});

        expect(await loadLifetime('char-a')).toEqual({ '/items/chest': createEmptyAggregate() });
        expect(await loadLifetime('char-b')).toEqual({});
    });

    test('a character with no data yet loads defaults, not another character’s data', async () => {
        await saveLifetime('char-a', { '/items/chest': createEmptyAggregate() });

        expect(await loadLifetime('char-c')).toEqual({});
        expect(await loadHistory('char-c')).toEqual([]);
    });
});

describe('foldRecordIntoAggregate', () => {
    test('accumulates events, containers, values, and item totals across records', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ containerCount: 2 }));
        aggregate = foldRecordIntoAggregate(
            aggregate,
            makeRecord({ containerCount: 3, actualValue: 50, expectedValue: 40 })
        );

        expect(aggregate.eventsCount).toBe(2);
        expect(aggregate.containersOpened).toBe(5);
        expect(aggregate.actualValueTotal).toBe(150);
        expect(aggregate.expectedValueTotal).toBe(130);
        expect(aggregate.itemTotals['/items/coin']).toBe(200);
    });

    test('does not mutate the input aggregate', () => {
        const original = createEmptyAggregate();
        const folded = foldRecordIntoAggregate(original, makeRecord());

        expect(original.eventsCount).toBe(0);
        expect(folded.eventsCount).toBe(1);
    });

    test('unavailable-EV records do not contribute to expectedValueTotal (never a fake zero counted as real)', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(
            aggregate,
            makeRecord({ expectedValue: null, expectedValueAvailable: false })
        );

        expect(aggregate.expectedValueTotal).toBe(0);
        expect(aggregate.expectedValueAvailableEvents).toBe(0);
        expect(aggregate.expectedValueUnavailableEvents).toBe(1);
    });

    test('partial actual-value records are tracked separately from complete ones', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ actualValueComplete: false }));

        expect(aggregate.actualValuePartialEvents).toBe(1);
        expect(aggregate.actualValueCompleteEvents).toBe(0);
    });
});

describe('appendHistory bounding', () => {
    test('history is capped at the configured max, dropping the oldest entries first', async () => {
        let history = [];
        for (let i = 0; i < OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS + 10; i++) {
            history = await appendHistory('char-a', history, makeRecord({ timestamp: i }));
        }

        expect(history).toHaveLength(OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS);
        expect(history[0].timestamp).toBe(10);
        expect(history[history.length - 1].timestamp).toBe(OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS + 9);
    });

    test('pruning detailed history does not change a separately-tracked lifetime aggregate', async () => {
        let aggregate = createEmptyAggregate();
        let history = [];
        for (let i = 0; i < OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS + 5; i++) {
            const record = makeRecord({ timestamp: i });
            aggregate = foldRecordIntoAggregate(aggregate, record);
            history = await appendHistory('char-a', history, record);
        }

        expect(history).toHaveLength(OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS);
        expect(aggregate.eventsCount).toBe(OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS + 5);
        expect(aggregate.actualValueTotal).toBe((OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS + 5) * 100);
    });
});

describe('reset controls', () => {
    test('resetContainer clears only the targeted container’s lifetime + history', async () => {
        await saveLifetime('char-a', {
            '/items/chest': createEmptyAggregate(),
            '/items/crate': createEmptyAggregate(),
        });
        await appendHistory('char-a', [], makeRecord({ containerHrid: '/items/chest' }));
        const historyAfterCrate = await appendHistory(
            'char-a',
            await loadHistory('char-a'),
            makeRecord({ containerHrid: '/items/crate' })
        );
        // Persist the combined history exactly as the collector would.
        mocks.values.set('history:char-a', historyAfterCrate);

        const { lifetime, history } = await resetContainer('char-a', '/items/chest');

        expect(lifetime).toEqual({ '/items/crate': createEmptyAggregate() });
        expect(history.every((r) => r.containerHrid !== '/items/chest')).toBe(true);
        expect(history.some((r) => r.containerHrid === '/items/crate')).toBe(true);
    });

    test('resetAll clears all Openable Analytics data for the character', async () => {
        await saveLifetime('char-a', { '/items/chest': createEmptyAggregate() });
        mocks.values.set('history:char-a', [makeRecord()]);

        await resetAll('char-a');

        expect(await loadLifetime('char-a')).toEqual({});
        expect(await loadHistory('char-a')).toEqual([]);
    });

    test('resetAll for one character does not affect another character’s data', async () => {
        await saveLifetime('char-a', { '/items/chest': createEmptyAggregate() });
        await saveLifetime('char-b', { '/items/chest': createEmptyAggregate() });

        await resetAll('char-a');

        expect(await loadLifetime('char-a')).toEqual({});
        expect(await loadLifetime('char-b')).toEqual({ '/items/chest': createEmptyAggregate() });
    });
});
