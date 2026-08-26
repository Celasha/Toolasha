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
    appendHistoryRecord,
    saveHistory,
    loadImports,
    saveImports,
    createEmptyAggregate,
    foldRecordIntoAggregate,
    mergeAggregates,
    resetContainer,
    resetAll,
    OPENABLE_ANALYTICS_MAX_HISTORY_EVENTS,
} = storageModule;

const storageMock = (await import('../../../core/storage.js')).default;

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

    test('accumulates per-item value totals from actualValueBreakdown across records', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(
            aggregate,
            makeRecord({
                actualValueBreakdown: [
                    { itemHrid: '/items/coin', enhancementLevel: 0, count: 100, value: 100, resolved: true },
                    { itemHrid: '/items/pearl', enhancementLevel: 0, count: 3, value: 300, resolved: true },
                ],
            })
        );
        aggregate = foldRecordIntoAggregate(
            aggregate,
            makeRecord({
                actualValueBreakdown: [
                    { itemHrid: '/items/coin', enhancementLevel: 0, count: 50, value: 50, resolved: true },
                ],
            })
        );

        expect(aggregate.itemValueTotals['/items/coin']).toBe(150);
        expect(aggregate.itemValueTotals['/items/pearl']).toBe(300);
    });

    test('an unresolved item in the breakdown does not contribute a fake value to itemValueTotals', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(
            aggregate,
            makeRecord({
                actualValueBreakdown: [
                    { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
                ],
            })
        );

        expect(aggregate.itemValueTotals['/items/mystery']).toBeUndefined();
    });

    test('a record with no actualValueBreakdown (written before this field existed) folds without crashing', () => {
        const legacyRecord = makeRecord();
        delete legacyRecord.actualValueBreakdown;

        const aggregate = foldRecordIntoAggregate(createEmptyAggregate(), legacyRecord);

        expect(aggregate.itemTotals['/items/coin']).toBe(100);
        expect(aggregate.itemValueTotals).toEqual({});
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

    test('resetContainer clears only the targeted container’s imported data, leaving other sources/containers intact', async () => {
        await saveImports('char-a', {
            'import:edible': { '/items/chest': createEmptyAggregate(), '/items/crate': createEmptyAggregate() },
        });

        const { imports } = await resetContainer('char-a', '/items/chest');

        expect(imports['import:edible']['/items/chest']).toBeUndefined();
        expect(imports['import:edible']['/items/crate']).toEqual(createEmptyAggregate());
    });

    test('resetAll clears imported data too', async () => {
        await saveImports('char-a', { 'import:edible': { '/items/chest': createEmptyAggregate() } });

        await resetAll('char-a');

        expect(await loadImports('char-a')).toEqual({});
    });
});

describe('imports persistence', () => {
    test('imports are stored under a character-scoped key, separate from live-tracked lifetime', async () => {
        await saveImports('char-a', { 'import:mwi-combat-suite': { '/items/chest': createEmptyAggregate() } });
        await saveLifetime('char-a', {});

        expect(await loadImports('char-a')).toEqual({
            'import:mwi-combat-suite': { '/items/chest': createEmptyAggregate() },
        });
        expect(await loadLifetime('char-a')).toEqual({});
    });
});

describe('OA-4: immediate persistence (no debounce that can race reset ordering)', () => {
    test('saveLifetime, saveHistory, and saveImports all write immediately', async () => {
        storageMock.setJSON.mockClear();

        await saveLifetime('char-a', {});
        await saveHistory('char-a', []);
        await saveImports('char-a', {});

        for (const call of storageMock.setJSON.mock.calls) {
            expect(call[3]).toBe(true);
        }
        expect(storageMock.setJSON).toHaveBeenCalledTimes(3);
    });
});

describe('appendHistoryRecord (pure, synchronous half of history append)', () => {
    test('does not persist by itself - callers control ordering against saveHistory', async () => {
        storageMock.setJSON.mockClear();

        const updated = appendHistoryRecord([], makeRecord());

        expect(updated).toHaveLength(1);
        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('two overlapping callers deriving from the same prior array both survive once each is committed in order (OA-3)', () => {
        // Simulates two concurrent recordOpening() calls that both read `this.history` before
        // either await resolves: each starts from the same base array, and the caller (the data
        // collector) is responsible for committing both pure appends before persisting, rather
        // than letting a debounced write silently coalesce them.
        const base = [];
        const afterFirst = appendHistoryRecord(base, makeRecord({ containerHrid: '/items/chest' }));
        const afterSecond = appendHistoryRecord(afterFirst, makeRecord({ containerHrid: '/items/crate' }));

        expect(afterSecond).toHaveLength(2);
        expect(afterSecond.map((r) => r.containerHrid)).toEqual(['/items/chest', '/items/crate']);
    });
});

describe('opening-event vs. imported-container counting (section 3.1)', () => {
    test('a live loot_opened-sourced record increments eventsCount (Tracked opening events)', () => {
        const aggregate = foldRecordIntoAggregate(createEmptyAggregate(), makeRecord({ source: 'loot_opened' }));

        expect(aggregate.eventsCount).toBe(1);
        expect(aggregate.containersOpened).toBe(1);
    });

    test('an imported cumulative snapshot does not increment eventsCount, only containersOpened (AGG-2)', () => {
        const aggregate = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({ source: 'import:edible', containerCount: 500 })
        );

        expect(aggregate.eventsCount).toBe(0);
        expect(aggregate.containersOpened).toBe(500);
        expect(aggregate.hasImportedData).toBe(true);
    });

    test('mixing one live event and one imported snapshot only counts the live one as an opening event', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ source: 'loot_opened' }));
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ source: 'import:mwi-combat-suite' }));

        expect(aggregate.eventsCount).toBe(1);
        expect(aggregate.containersOpened).toBe(2);
        expect(aggregate.hasImportedData).toBe(true);
    });
});

describe('aggregate Luck fail-closed as a whole (section 3.2)', () => {
    test('every folded record Luck-eligible => luckEligibleRecordCount matches valuationRecordCount', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ luckValue: 10 }));
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ luckValue: -5 }));

        expect(aggregate.valuationRecordCount).toBe(2);
        expect(aggregate.luckEligibleRecordCount).toBe(2);
    });

    test('one record with no eligible Luck (partial/unavailable) makes the aggregate fail closed (AGG-1)', () => {
        let aggregate = createEmptyAggregate();
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ luckValue: 10 }));
        aggregate = foldRecordIntoAggregate(aggregate, makeRecord({ luckValue: null }));

        expect(aggregate.valuationRecordCount).toBe(2);
        expect(aggregate.luckEligibleRecordCount).toBe(1);
        // Consumers must treat luckEligibleRecordCount !== valuationRecordCount as "Luck N/A for
        // the whole aggregate", never subtract a partial Expected from a superset Actual.
    });

    test('a partial-Expected record is tracked separately from a fully unavailable one', () => {
        const aggregate = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({ expectedValueAvailable: true, expectedValueComplete: false, luckValue: null })
        );

        expect(aggregate.expectedValuePartialEvents).toBe(1);
        expect(aggregate.expectedValueUnavailableEvents).toBe(0);
    });
});

describe('mergeAggregates', () => {
    test('sums numeric fields and merges item totals across live + imported aggregates', () => {
        const live = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({ actualValue: 100, expectedValue: 90 })
        );
        const imported = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({
                actualValue: 5000,
                expectedValue: 4500,
                gainedItems: [{ itemHrid: '/items/coin', count: 900 }],
            })
        );

        const merged = mergeAggregates(live, imported);

        expect(merged.eventsCount).toBe(2);
        expect(merged.actualValueTotal).toBe(5100);
        expect(merged.expectedValueTotal).toBe(4590);
        expect(merged.itemTotals['/items/coin']).toBe(1000);
    });

    test('merges per-item value totals across aggregates too', () => {
        const live = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({
                actualValueBreakdown: [
                    { itemHrid: '/items/coin', enhancementLevel: 0, count: 100, value: 100, resolved: true },
                ],
            })
        );
        const imported = foldRecordIntoAggregate(
            createEmptyAggregate(),
            makeRecord({
                actualValueBreakdown: [
                    { itemHrid: '/items/coin', enhancementLevel: 0, count: 900, value: 900, resolved: true },
                ],
            })
        );

        const merged = mergeAggregates(live, imported);

        expect(merged.itemValueTotals['/items/coin']).toBe(1000);
    });

    test('ignores null/undefined aggregates (e.g. no imports for this container)', () => {
        const live = foldRecordIntoAggregate(createEmptyAggregate(), makeRecord());

        const merged = mergeAggregates(live, undefined, null);

        expect(merged).toEqual(live);
    });

    test('returns an empty aggregate when called with no real aggregates', () => {
        expect(mergeAggregates()).toEqual(createEmptyAggregate());
    });
});
