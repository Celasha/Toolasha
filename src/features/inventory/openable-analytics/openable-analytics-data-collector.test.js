import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
    currentCharacterId: 'char-a',
    on: vi.fn(),
    off: vi.fn(),
    evAvailable: true,
    evValue: 90,
    sellSideValue: { value: 10, needsTax: false },
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
    },
}));

vi.mock('../../../core/websocket.js', () => ({
    default: { on: mocks.on, off: mocks.off, onSocketEvent: vi.fn(), offSocketEvent: vi.fn() },
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
        calculateExpectedValue: vi.fn(() => (mocks.evAvailable ? { expectedValue: mocks.evValue } : null)),
    },
}));

const { default: openableAnalyticsDataCollector } = await import('./openable-analytics-data-collector.js');

function lootOpenedMessage(overrides = {}) {
    return {
        openedItem: { itemHrid: '/items/chimerical_chest', enhancementLevel: 0, count: 1 },
        gainedItems: [{ itemHrid: '/items/coin', enhancementLevel: 0, count: 100 }],
        grantedBuffs: [],
        ...overrides,
    };
}

beforeEach(async () => {
    mocks.values.clear();
    mocks.currentCharacterId = 'char-a';
    mocks.evAvailable = true;
    mocks.evValue = 90;
    mocks.on.mockClear();
    mocks.off.mockClear();
    openableAnalyticsDataCollector.cleanup();
    await openableAnalyticsDataCollector.initialize();
});

describe('loot_opened ingestion', () => {
    test('registers exactly one handler for loot_opened on initialize', () => {
        expect(mocks.on).toHaveBeenCalledWith('loot_opened', expect.any(Function));
    });

    test('a direct loot_opened message is recorded into the latest record and session aggregate', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.containerHrid).toBe('/items/chimerical_chest');
        expect(record.containerCount).toBe(1);

        const session = openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest');
        expect(session.eventsCount).toBe(1);
    });

    test('openedItem.count > 1 increments container count correctly', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage({ openedItem: { itemHrid: '/items/chimerical_chest', count: 100 } }));

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.containerCount).toBe(100);

        const session = openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest');
        expect(session.containersOpened).toBe(100);
    });

    test('a message with no openedItem is ignored, not recorded as a broken event', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler({ gainedItems: [], grantedBuffs: [] });

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
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());

        expect(mocks.values.has('lifetime:char-a')).toBe(true);
        expect(mocks.values.get('lifetime:char-a')['/items/chimerical_chest'].eventsCount).toBe(1);
    });
});

describe('session reset on character/page lifecycle', () => {
    test('re-initializing (character switch or page reload) clears the in-memory session aggregate', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(1);

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(0);
    });

    test('a stale handler continuation from before cleanup() cannot record after a new initialize()', async () => {
        const staleHandler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];

        openableAnalyticsDataCollector.cleanup();
        await openableAnalyticsDataCollector.initialize();

        // Simulate the old WebSocket listener firing one more time before it was unregistered.
        await staleHandler(lootOpenedMessage());

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
    });
});

describe('granted-buff / non-monetary openings', () => {
    test('can be counted (session aggregate increments) without fake Luck', async () => {
        mocks.evAvailable = false;
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(
            lootOpenedMessage({
                openedItem: { itemHrid: '/items/seal_of_rare_find', count: 1 },
                gainedItems: [],
                grantedBuffs: [{ typeHrid: '/buff_types/rare_find', duration: 3600 }],
            })
        );

        const record = openableAnalyticsDataCollector.getLatestRecord();
        expect(record.expectedValueAvailable).toBe(false);
        expect(record.luckValue).toBeNull();

        const session = openableAnalyticsDataCollector.getSessionAggregate('/items/seal_of_rare_find');
        expect(session.eventsCount).toBe(1);
        expect(session.grantedBuffEvents).toBe(1);
    });
});

describe('update listeners', () => {
    test('onUpdate subscribers are notified with the new record, and can unsubscribe', async () => {
        const seen = [];
        const unsubscribe = openableAnalyticsDataCollector.onUpdate((record) => seen.push(record));

        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());
        expect(seen).toHaveLength(1);

        unsubscribe();
        await handler(lootOpenedMessage());
        expect(seen).toHaveLength(1);
    });
});

describe('reset controls', () => {
    test('resetAll clears session, lifetime, and latest record for the current character', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());

        await openableAnalyticsDataCollector.resetAll();

        expect(openableAnalyticsDataCollector.getLatestRecord()).toBeNull();
        expect(openableAnalyticsDataCollector.getSessionAggregate('/items/chimerical_chest').eventsCount).toBe(0);
        expect(openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest').eventsCount).toBe(0);
    });
});

describe('bulk imports (Edible Tools / MWI Combat Suite)', () => {
    test('importContainers adds an imported aggregate that is combined into getLifetimeAggregate alongside live tracking', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage()); // 1 live event, 100 coin

        await openableAnalyticsDataCollector.importContainers('import:mwi-combat-suite', [
            { containerHrid: '/items/chimerical_chest', containerCount: 500, itemTotals: { '/items/coin': 50000 } },
        ]);

        const combined = openableAnalyticsDataCollector.getLifetimeAggregate('/items/chimerical_chest');
        expect(combined.containersOpened).toBe(501);
        expect(combined.itemTotals['/items/coin']).toBe(50100);
    });

    test('getLiveLifetimeAggregate excludes imports (only live-tracked openings)', async () => {
        const handler = mocks.on.mock.calls.find(([type]) => type === 'loot_opened')[1];
        await handler(lootOpenedMessage());

        await openableAnalyticsDataCollector.importContainers('import:edible', [
            { containerHrid: '/items/chimerical_chest', containerCount: 999, itemTotals: {} },
        ]);

        expect(
            openableAnalyticsDataCollector.getLiveLifetimeAggregate('/items/chimerical_chest').containersOpened
        ).toBe(1);
    });

    test('re-importing the same source replaces (does not add to) its previous per-container total', async () => {
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
});
