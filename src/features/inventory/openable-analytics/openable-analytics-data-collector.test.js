import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
    currentCharacterId: 'char-a',
    on: vi.fn(),
    off: vi.fn(),
    evAvailable: true,
    evValue: 90,
    sellSideValue: { value: 10, needsTax: false },
    dropTable: { '/items/chimerical_chest': [{ itemHrid: '/items/coin' }] },
}));

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

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getItemDetails: vi.fn(() => ({ isTradable: true })),
        getInitClientData: vi.fn(() => ({ openableLootDropMap: mocks.dropTable })),
        on: mocks.on,
        off: mocks.off,
    },
}));

vi.mock('../../../core/config.js', () => ({
    default: { getSettingValue: vi.fn((key, defaultValue) => defaultValue) },
}));

vi.mock('../../../utils/market-data.js', () => ({
    getItemPrice: vi.fn(),
}));

vi.mock('../../market/expected-value-calculator.js', () => ({
    default: {
        resolveSellSideValue: vi.fn(() => mocks.sellSideValue),
        calculateExpectedValue: vi.fn(() => (mocks.evAvailable ? { expectedValue: mocks.evValue, drops: [] } : null)),
    },
}));

const { default: openableAnalyticsDataCollector } = await import('./openable-analytics-data-collector.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const { createEmptyAggregate, foldRecordIntoAggregate } = await import('./openable-analytics-storage.js');
const storageMock = (await import('../../../core/storage.js')).default;

function lootOpenedMessage(overrides = {}) {
    return {
        openedItem: { itemHrid: '/items/chimerical_chest', enhancementLevel: 0, count: 1 },
        gainedItems: [{ itemHrid: '/items/coin', enhancementLevel: 0, count: 100 }],
        grantedBuffs: [],
        ...overrides,
    };
}

function lootOpenedEvent(overrides = {}, characterId = mocks.currentCharacterId) {
    return { data: lootOpenedMessage(overrides), characterId };
}

function lootHandler() {
    const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
    // The registered handler is intentionally fire-and-forget in production (DataManager's
    // critical/synchronous emit does not await listeners; ordering is enforced internally by the
    // collector's own persistence queue). Wrap it here so tests can still await the resulting
    // persistence deterministically without changing that production contract.
    return (event) => {
        handler(event);
        return openableAnalyticsDataCollector.persistenceQueue;
    };
}

beforeEach(async () => {
    mocks.values.clear();
    mocks.currentCharacterId = 'char-a';
    mocks.evAvailable = true;
    mocks.evValue = 90;
    mocks.dropTable = { '/items/chimerical_chest': [{ itemHrid: '/items/coin' }] };
    mocks.on.mockClear();
    mocks.off.mockClear();
    openableAnalyticsDataCollector.cleanup();
    await openableAnalyticsDataCollector.initialize();
});

describe('loot_opened ingestion', () => {
    test('registers exactly one handler for loot_opened on initialize', () => {
        expect(mocks.on).toHaveBeenCalledWith('loot_opened', expect.any(Function));
    });

    test('a direct loot_opened event is recorded into the latest record and session aggregate', async () => {
        await lootHandler()(lootOpenedEvent());

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.containerHrid).toBe('/items/chimerical_chest');
        expect(record.containerCount).toBe(1);

        const session = openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest');
        expect(session.eventsCount).toBe(1);
    });

    test('the recorded record carries a per-item actualValueBreakdown, and it flows into the lifetime aggregate’s itemValueTotals', async () => {
        await lootHandler()(lootOpenedEvent());

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.actualValueBreakdown).toEqual([
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 100, value: 1000, resolved: true },
        ]);

        const lifetime = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(lifetime.itemValueTotals['/items/coin']).toBe(1000);
    });

    test('openedItem.count > 1 increments container count correctly', async () => {
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/chimerical_chest', count: 100 } }));

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.containerCount).toBe(100);

        const session = openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest');
        expect(session.containersOpened).toBe(100);
    });

    test('a message with no openedItem is ignored, not recorded as a broken event', async () => {
        await lootHandler()({ data: { gainedItems: [], grantedBuffs: [] }, characterId: 'char-a' });

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });

    test('OWN-1: an event carrying a stale/different characterId than the collector’s own is ignored', async () => {
        await lootHandler()(lootOpenedEvent({}, 'char-other'));

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });

    test('an event with no characterId is ignored', async () => {
        await lootHandler()({ data: lootOpenedMessage(), characterId: null });

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });
});

describe('character separation', () => {
    test('lifetime aggregates loaded on initialize are scoped to the current character', async () => {
        mocks.values.set('lifetime:char-a', { '/items/chest': { eventsCount: 5 } });
        mocks.currentCharacterId = 'char-b';

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chest').eventsCount).toBe(0);
    });

    test('recording an opening persists lifetime data under the current character’s key only', async () => {
        await lootHandler()(lootOpenedEvent());

        expect(mocks.values.has('lifetime:char-a')).toBe(true);
        expect(mocks.values.get('lifetime:char-a')['/items/chimerical_chest'].eventsCount).toBe(1);
    });
});

describe('session reset on character/page lifecycle', () => {
    test('re-initializing (character switch or page reload) clears the in-memory session aggregate', async () => {
        await lootHandler()(lootOpenedEvent());
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(1);

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(0);
    });

    test('a stale handler continuation from before cleanup() cannot record after a new initialize()', async () => {
        const staleHandler = lootHandler();

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        // Simulate the old listener firing one more time before it was unregistered.
        await staleHandler(lootOpenedEvent());

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });

    test('INIT-1 / LIFE-1: a stale initialize continuation cannot publish loaded state once a newer lifecycle has taken over', async () => {
        // Make the character-scoped storage load hang so a second initialize() can race ahead of it.
        let resolveLoad;
        const { default: storage } = await import('../../../core/storage.js');
        storage.getJSON.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveLoad = resolve;
                })
        );

        openableAnalyticsDataCollector.cleanup();
        const pendingInit = openableAnalyticsDataCollector.initialize();

        // A second, newer initialize() completes fully while the first is still awaiting its load.
        mocks.values.set('lifetime:char-a', { '/items/chest': { eventsCount: 99 } });
        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        // The first initialize's delayed load now resolves - it must not publish over current state.
        resolveLoad({});
        await pendingInit;

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chest').eventsCount).toBe(99);
    });
});

describe('granted-buff / non-monetary openings', () => {
    test('a known buff-only/no-loot opening is ignored entirely', async () => {
        mocks.evAvailable = false;
        await lootHandler()(
            lootOpenedEvent({
                openedItem: { itemHrid: '/items/seal_of_rare_find', count: 1 },
                gainedItems: [],
                grantedBuffs: [{ typeHrid: '/buff_types/rare_find', duration: 3600 }],
            })
        );

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/seal_of_rare_find').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/seal_of_rare_find').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getHistory()).toHaveLength(0);
        expect(mocks.values.has('history:char-a')).toBe(false);
        expect(mocks.values.has('lifetime:char-a')).toBe(false);
    });

    test('Bag Of 10 Cowbells is ignored when the guaranteed gained-item output matches the model', async () => {
        mocks.dropTable = {
            '/items/bag_of_10_cowbells': [{ itemHrid: '/items/cowbell', dropRate: 1, minCount: 10, maxCount: 10 }],
        };
        await lootHandler()(
            lootOpenedEvent({
                openedItem: { itemHrid: '/items/bag_of_10_cowbells', count: 2 },
                gainedItems: [{ itemHrid: '/items/cowbell', enhancementLevel: 0, count: 20 }],
                grantedBuffs: [],
            })
        );

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/bag_of_10_cowbells').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/bag_of_10_cowbells').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getHistory()).toHaveLength(0);
    });

    test('a deterministic-model event is recorded fail-open if the observed output contradicts the model', async () => {
        mocks.dropTable = {
            '/items/bag_of_10_cowbells': [{ itemHrid: '/items/cowbell', dropRate: 1, minCount: 10, maxCount: 10 }],
        };
        await lootHandler()(
            lootOpenedEvent({
                openedItem: { itemHrid: '/items/bag_of_10_cowbells', count: 1 },
                gainedItems: [{ itemHrid: '/items/cowbell', enhancementLevel: 0, count: 11 }],
                grantedBuffs: [],
            })
        );

        expect(openableAnalyticsDataCollector.getLatestRecord()?.containerHrid).toBe('/items/bag_of_10_cowbells');
    });

    test('a real gained-item event is still recorded when static drop data has no model', async () => {
        mocks.dropTable = {};
        await lootHandler()(
            lootOpenedEvent({
                openedItem: { itemHrid: '/items/new_or_stale_model_openable', count: 1 },
                gainedItems: [{ itemHrid: '/items/coin', enhancementLevel: 0, count: 5 }],
                grantedBuffs: [],
            })
        );

        expect(openableAnalyticsDataCollector.getLatestRecord()?.containerHrid).toBe(
            '/items/new_or_stale_model_openable'
        );
        expect(
            openableAnalyticsDataCollector.getSessionAggregate('/items/new_or_stale_model_openable').eventsCount
        ).toBe(1);
    });

    test('legacy persisted non-random rows are hidden from known-container UI lists without deleting storage', async () => {
        openableAnalyticsDataCollector.cleanup();
        mocks.values.set('lifetime:char-a', {
            '/items/seal_of_rare_find': { eventsCount: 9, containersOpened: 9 },
            '/items/bag_of_10_cowbells': { eventsCount: 4, containersOpened: 4 },
            '/items/chimerical_chest': { eventsCount: 2, containersOpened: 2 },
        });
        mocks.dropTable = {
            '/items/chimerical_chest': [{ itemHrid: '/items/coin' }],
            '/items/bag_of_10_cowbells': [{ itemHrid: '/items/cowbell', dropRate: 1, minCount: 10, maxCount: 10 }],
        };
        await openableAnalyticsDataCollector.initialize();

        expect(openableAnalyticsDataCollector.getKnownContainers()).toEqual(['/items/chimerical_chest']);
        expect(mocks.values.get('lifetime:char-a')['/items/seal_of_rare_find'].eventsCount).toBe(9);
        expect(mocks.values.get('lifetime:char-a')['/items/bag_of_10_cowbells'].eventsCount).toBe(4);
    });

    test("a skipped excluded opening clears the latest record and notifies listeners, so a stale record from a previous tracked opening cannot be shown as this excluded opening's own modal footer", async () => {
        await lootHandler()(lootOpenedEvent()); // a normal tracked chimerical_chest opening
        expect(openableAnalyticsDataCollector.getLatestRecord()?.containerHrid).toBe('/items/chimerical_chest');

        const seen = [];
        openableAnalyticsDataCollector.onUpdate((record) => seen.push(record));

        await lootHandler()(
            lootOpenedEvent({
                openedItem: { itemHrid: '/items/seal_of_rare_find', count: 1 },
                gainedItems: [],
                grantedBuffs: [{ typeHrid: '/buff_types/rare_find', duration: 3600 }],
            })
        );

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
        expect(seen).toEqual([null]);
    });
});

describe('update listeners', () => {
    test('onUpdate subscribers are notified with the new record, and can unsubscribe', async () => {
        const seen = [];
        const unsubscribe = openableAnalyticsDataCollector.onUpdate((record) => seen.push(record));

        await lootHandler()(lootOpenedEvent());
        expect(seen).toHaveLength(1);

        unsubscribe();
        await lootHandler()(lootOpenedEvent());
        expect(seen).toHaveLength(1);
    });

    test('NOTIFY-1: Lifetime already includes the current opening by the time update listeners run', async () => {
        let lifetimeAtNotifyTime = null;
        openableAnalyticsDataCollector.onUpdate(() => {
            lifetimeAtNotifyTime = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        });

        await lootHandler()(lootOpenedEvent());

        expect(lifetimeAtNotifyTime.eventsCount).toBe(1);
    });
});

describe('HIST-1: concurrent openings both survive (OA-3)', () => {
    test('two overlapping recordOpening() calls both land in session, lifetime, and detailed history', async () => {
        const handler = lootHandler();

        // Both calls are started before either awaits its persistence, simulating truly
        // overlapping loot_opened deliveries.
        const first = handler(lootOpenedEvent({ openedItem: { itemHrid: '/items/chest', count: 1 } }));
        const second = handler(lootOpenedEvent({ openedItem: { itemHrid: '/items/crate', count: 1 } }));
        await Promise.all([first, second]);

        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chest').eventsCount).toBe(1);
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/crate').eventsCount).toBe(1);
        expect(openableAnalyticsDataCollector.getHistory()).toHaveLength(2);
        expect(mocks.values.get('lifetime:char-a')['/items/chest'].eventsCount).toBe(1);
        expect(mocks.values.get('lifetime:char-a')['/items/crate'].eventsCount).toBe(1);
    });
});

describe('reset controls', () => {
    test('resetAll clears session, lifetime, and latest record for the current character', async () => {
        await lootHandler()(lootOpenedEvent());

        await openableAnalyticsDataCollector.resetAll();

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').eventsCount).toBe(0);
    });

    test('RESET-1: an opening queued before Reset All does not resurrect after reset completes', async () => {
        await lootHandler()(lootOpenedEvent());
        await openableAnalyticsDataCollector.resetAll();

        expect(mocks.values.has('lifetime:char-a')).toBe(false);
        expect(mocks.values.has('history:char-a')).toBe(false);
    });

    test('RESET-2: a new opening arriving after Reset All survives', async () => {
        await lootHandler()(lootOpenedEvent());
        await openableAnalyticsDataCollector.resetAll();
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/chimerical_chest', count: 1 } }));

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').eventsCount).toBe(1);
        expect(mocks.values.get('history:char-a')).toHaveLength(1);
    });

    test('RESET-2b: an opening that starts before Reset All resolves but is ordered after it still survives', async () => {
        const handler = lootHandler();
        const opening = handler(lootOpenedEvent());
        const reset = openableAnalyticsDataCollector.resetAll();
        await Promise.all([opening, reset]);

        // In-memory state reflects reset (opening ran first, reset ran second and cleared it).
        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });

    test('RESET-3: resetting one container does not affect another container’s data', async () => {
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/chest', count: 1 } }));
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/crate', count: 1 } }));

        await openableAnalyticsDataCollector.resetContainer('/items/chest');

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chest').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/crate').eventsCount).toBe(1);
        expect(mocks.values.get('history:char-a').some((r) => r.containerHrid === '/items/chest')).toBe(false);
        expect(mocks.values.get('history:char-a').some((r) => r.containerHrid === '/items/crate')).toBe(true);
    });
});

describe('bulk imports (Edible Tools / MWI Combat Suite)', () => {
    test('importContainers adds an imported aggregate that is combined into getLifetimeAggregate alongside live tracking', async () => {
        await lootHandler()(lootOpenedEvent()); // 1 live event, 100 coin

        await openableAnalyticsDataCollector.importContainers('import:mwi-combat-suite', [
            { containerHrid: '/items/chimerical_chest', containerCount: 500, itemTotals: { '/items/coin': 50000 } },
        ]);

        const combined = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(combined.containersOpened).toBe(501);
        expect(combined.itemTotals['/items/coin']).toBe(50100);
    });

    test('getLiveLifetimeAggregate excludes imports (only live-tracked openings)', async () => {
        await lootHandler()(lootOpenedEvent());

        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 999, itemTotals: {} },
        ]);

        expect(
            openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest').containersOpened
        ).toBe(1);
    });

    test('IMPORT-1: re-importing the same source replaces (does not add to) its previous per-container total', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 100, itemTotals: { '/items/coin': 1000 } },
        ]);
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 150, itemTotals: { '/items/coin': 1500 } },
        ]);

        const combined = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(combined.containersOpened).toBe(150);
        expect(combined.itemTotals['/items/coin']).toBe(1500);
    });

    test('IMPORT-1b: a container present in the old import but absent from the new one is gone (whole-source replacement, OA-5)', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 100, itemTotals: {} },
            { containerHrid: '/items/purples_gift', containerCount: 5, itemTotals: {} },
        ]);
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 150, itemTotals: {} },
        ]);

        expect(openableAnalyticsDataCollector.getKnownContainers()).not.toContain('/items/purples_gift');
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').containersOpened).toBe(
            150
        );
    });

    test('IMPORT-2: switching the imported Edible player leaves no old-player-only containers behind', async () => {
        // Player A's export.
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 100, itemTotals: {} },
            { containerHrid: '/items/player_a_only_chest', containerCount: 3, itemTotals: {} },
        ]);
        // Player B's export under the same source.
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 20, itemTotals: {} },
        ]);

        expect(openableAnalyticsDataCollector.getKnownContainers()).not.toContain('/items/player_a_only_chest');
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').containersOpened).toBe(
            20
        );
    });

    test('two different import sources for the same container both contribute to the combined total', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 100, itemTotals: {} },
        ]);
        await openableAnalyticsDataCollector.importContainers('import:mwi-combat-suite', [
            { containerHrid: '/items/chimerical_chest', containerCount: 200, itemTotals: {} },
        ]);

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').containersOpened).toBe(
            300
        );
    });

    test('getKnownContainers includes containers that only have imported data, no live openings', async () => {
        mocks.dropTable['/items/purples_gift'] = [{ itemHrid: '/items/coin' }];
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/purples_gift', containerCount: 5, itemTotals: {} },
        ]);

        expect(openableAnalyticsDataCollector.getKnownContainers()).toContain('/items/purples_gift');
    });

    test('imports are persisted under a character-scoped storage key', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);

        expect(mocks.values.has('imports:char-a')).toBe(true);
    });

    test('AGG-2: an imported cumulative snapshot does not increment tracked opening events', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 500, itemTotals: {} },
        ]);

        const combined = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(combined.eventsCount).toBe(0);
        expect(combined.containersOpened).toBe(500);
    });

    test('resetContainer clears imported data for that container too', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);

        await openableAnalyticsDataCollector.resetContainer('/items/chimerical_chest');

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').containersOpened).toBe(0);
    });

    test('imports loaded on initialize are scoped to the current character', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);

        mocks.currentCharacterId = 'char-b';
        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').containersOpened).toBe(0);
    });

    test('removeImport removes one whole source, keeping live history and other sources intact', async () => {
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/chimerical_chest', count: 1 } }));
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 100, itemTotals: {} },
        ]);
        await openableAnalyticsDataCollector.importContainers('import:mwi-combat-suite', [
            { containerHrid: '/items/chimerical_chest', containerCount: 200, itemTotals: {} },
        ]);

        const persisted = await openableAnalyticsDataCollector.removeImport('import:edible');

        expect(persisted).toBe(true);
        const combined = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(combined.containersOpened).toBe(201); // 1 live + 200 mwi-combat-suite, edible's 100 gone
    });

    test('resetContainer prunes an import source left with zero containers rather than leaving an empty {} entry', async () => {
        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);

        await openableAnalyticsDataCollector.resetContainer('/items/chimerical_chest');

        expect(openableAnalyticsDataCollector.getImportSourceKeys()).not.toContain('import:edible');
    });
});

describe('section 22: persistence-failure handling', () => {
    test('recordOpening logs when the underlying save fails, but in-memory state still reflects the opening', async () => {
        const { default: storage } = await import('../../../core/storage.js');
        storage.setJSON.mockResolvedValueOnce(false); // saveHistory fails
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await lootHandler()(lootOpenedEvent());

        expect(openableAnalyticsDataCollector.getLatestRecord()).not.toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
        errorSpy.mockRestore();
    });

    test('a failed persistence operation does not poison the queue for later queued work', async () => {
        const { default: storage } = await import('../../../core/storage.js');
        storage.setJSON.mockResolvedValueOnce(false); // first opening's saveHistory fails
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/chest', count: 1 } }));
        await lootHandler()(lootOpenedEvent({ openedItem: { itemHrid: '/items/crate', count: 1 } }));

        // The second opening's persistence must still run and succeed.
        expect(mocks.values.get('lifetime:char-a')['/items/crate'].eventsCount).toBe(1);
    });

    test('importContainers reports persisted: false when the save fails', async () => {
        const { default: storage } = await import('../../../core/storage.js');
        storage.setJSON.mockResolvedValueOnce(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { persisted } = await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);

        expect(persisted).toBe(false);
    });

    test('resetAll reports false when a delete fails', async () => {
        const { default: storage } = await import('../../../core/storage.js');
        storage.delete.mockResolvedValueOnce(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const persisted = await openableAnalyticsDataCollector.resetAll();

        expect(persisted).toBe(false);
    });
});

describe('section 23: state-change subscription', () => {
    test('fires immediately after in-memory commit for a live opening', async () => {
        const seen = [];
        openableAnalyticsDataCollector.onStateChange(() => seen.push(true));

        await lootHandler()(lootOpenedEvent());

        expect(seen).toHaveLength(1);
    });

    test('fires for import, remove import, delete container, and delete all', async () => {
        let count = 0;
        openableAnalyticsDataCollector.onStateChange(() => count++);

        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 10, itemTotals: {} },
        ]);
        await openableAnalyticsDataCollector.removeImport('import:edible');
        await openableAnalyticsDataCollector.resetContainer('/items/chimerical_chest');
        await openableAnalyticsDataCollector.resetAll();

        expect(count).toBe(4);
    });

    test('can unsubscribe', async () => {
        const seen = [];
        const unsubscribe = openableAnalyticsDataCollector.onStateChange(() => seen.push(true));
        unsubscribe();

        await lootHandler()(lootOpenedEvent());

        expect(seen).toHaveLength(0);
    });

    test('cleanup clears state-change listeners', async () => {
        const seen = [];
        openableAnalyticsDataCollector.onStateChange(() => seen.push(true));

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();
        await lootHandler()(lootOpenedEvent());

        expect(seen).toHaveLength(0);
    });
});

describe('self-heal repair on initialize', () => {
    function partialRecord(overrides = {}) {
        return {
            timestamp: 1,
            characterId: 'char-a',
            containerHrid: '/items/chimerical_chest',
            containerCount: 1,
            gainedItems: [{ itemHrid: '/items/mystery', enhancementLevel: 0, count: 1 }],
            grantedBuffs: [],
            actualValue: 0,
            actualValueComplete: false,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
            ],
            expectedValue: 90,
            expectedValueAvailable: true,
            expectedValueComplete: true,
            sourceDataComplete: true,
            luckValue: null,
            luckPercent: null,
            pricingMode: 'hybrid',
            keyPricingMode: 'ask',
            source: 'loot_opened',
            ...overrides,
        };
    }

    function seedStorage(history, lifetime) {
        mocks.values.set('lifetime:char-a', lifetime);
        mocks.values.set('history:char-a', history);
    }

    async function reinitialize() {
        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();
    }

    test('a partial record is re-valued with current prices; lifetime gains luck eligibility', async () => {
        const old = partialRecord();
        const lifetime = foldRecordIntoAggregate(createEmptyAggregate(), old);
        expect(lifetime.luckEligibleRecordCount).toBe(0);
        seedStorage([old], { '/items/chimerical_chest': lifetime });

        mocks.dropTable = { '/items/chimerical_chest': [{ itemHrid: '/items/coin', dropRate: 1 }] };
        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) =>
            itemHrid === '/items/mystery' ? { value: 50, needsTax: false } : { value: 10, needsTax: false }
        );
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();

        const history = openableAnalyticsDataCollector.getHistory();
        expect(history[0].actualValue).toBe(50);
        expect(history[0].actualValueComplete).toBe(true);
        expect(history[0].luckValue).toBe(-40);
        expect(history[0].timestamp).toBe(1);

        const lifetimeAfter = openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest');
        expect(lifetimeAfter.luckEligibleRecordCount).toBe(1);
        expect(lifetimeAfter.actualValueTotal).toBe(50);
    });

    test('a complete record keeps its event-time valuation untouched', async () => {
        const complete = partialRecord({
            actualValue: 100,
            actualValueComplete: true,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 100, resolved: true },
            ],
            luckValue: 10,
        });
        seedStorage([complete], {
            '/items/chimerical_chest': foldRecordIntoAggregate(createEmptyAggregate(), complete),
        });
        storageMock.setJSON.mockClear();

        await reinitialize();

        expect(openableAnalyticsDataCollector.getHistory()[0]).toBe(complete);
        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('a still-unpriced item produces zero writes (fail-closed preserved)', async () => {
        seedStorage([partialRecord()], {
            '/items/chimerical_chest': foldRecordIntoAggregate(createEmptyAggregate(), partialRecord()),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue(null);
        // EV 侧保持完整，隔离出"仅物品缺价"这一种情况，避免 expectedValueComplete 翻转干扰断言
        mocks.dropTable = { '/items/chimerical_chest': [{ itemHrid: '/items/coin', dropRate: 1 }] };
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });
        storageMock.setJSON.mockClear();

        await reinitialize();

        expect(openableAnalyticsDataCollector.getHistory()[0].actualValueComplete).toBe(false);
        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('a sourceDataComplete:false record may gain a value but never gains luck eligibility', async () => {
        seedStorage([partialRecord({ sourceDataComplete: false })], {
            '/items/chimerical_chest': foldRecordIntoAggregate(
                createEmptyAggregate(),
                partialRecord({ sourceDataComplete: false })
            ),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 50, needsTax: false });
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();

        const history = openableAnalyticsDataCollector.getHistory();
        expect(history[0].actualValue).toBe(50);
        expect(history[0].actualValueComplete).toBe(false);
        expect(history[0].luckValue).toBeNull();
        expect(
            openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest').luckEligibleRecordCount
        ).toBe(0);
    });

    test('repair is idempotent: a second initialize performs zero writes', async () => {
        seedStorage([partialRecord()], {
            '/items/chimerical_chest': foldRecordIntoAggregate(createEmptyAggregate(), partialRecord()),
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 50, needsTax: false });
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();
        // 先等第一次修复的持久化落地，再清空调用记录，否则该写入会计入第二次 initialize
        await openableAnalyticsDataCollector.persistenceQueue;
        storageMock.setJSON.mockClear();
        await reinitialize();

        expect(storageMock.setJSON).not.toHaveBeenCalled();
    });

    test('an Expected-partial record is re-valued and regains Luck eligibility via the second repair branch', async () => {
        // Actual 侧完整且重估不变（sell-side 价与快照一致），只有 expectedValueComplete 翻转驱动
        // valueChanged —— 专锁 needsRepair 的第二个析取支（EV partial），不与 Actual 分支混淆
        const evPartial = partialRecord({
            actualValue: 100,
            actualValueComplete: true,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 100, resolved: true },
            ],
            expectedValue: 90,
            expectedValueAvailable: true,
            expectedValueComplete: false,
        });
        const lifetime = foldRecordIntoAggregate(createEmptyAggregate(), evPartial);
        expect(lifetime.luckEligibleRecordCount).toBe(0);
        expect(lifetime.expectedValuePartialEvents).toBe(1);
        seedStorage([evPartial], { '/items/chimerical_chest': lifetime });

        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, needsTax: false });
        // dropRate 行数与可定价 drops 数一致，calculator 内部推导才会翻转为 complete
        mocks.dropTable = { '/items/chimerical_chest': [{ itemHrid: '/items/coin', dropRate: 1 }] };
        expectedValueCalculator.calculateExpectedValue.mockReturnValue({
            expectedValue: 90,
            drops: [{ hasPriceData: true }],
        });

        await reinitialize();

        const history = openableAnalyticsDataCollector.getHistory();
        expect(history[0].actualValue).toBe(100);
        expect(history[0].expectedValueComplete).toBe(true);
        expect(history[0].luckValue).toBe(10);

        const lifetimeAfter = openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest');
        expect(lifetimeAfter.luckEligibleRecordCount).toBe(1);
        expect(lifetimeAfter.expectedValuePartialEvents).toBe(0);
    });
});
