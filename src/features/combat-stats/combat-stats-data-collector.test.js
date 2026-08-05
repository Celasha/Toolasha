import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
    currentCharacterId: 'character-a',
    on: vi.fn(),
    off: vi.fn(),
}));

vi.mock('../../core/storage.js', () => ({
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

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: mocks.on,
        off: mocks.off,
    },
}));

import storage from '../../core/storage.js';
import { CombatStatsDataCollector } from './combat-stats-data-collector.js';

beforeEach(() => {
    mocks.values.clear();
    mocks.currentCharacterId = 'character-a';
    mocks.on.mockClear();
    mocks.off.mockClear();
    vi.clearAllMocks();
});

describe('CombatStatsDataCollector character-scoped persistence', () => {
    test('loads a fresh in-memory tracker when the next character has no saved state', async () => {
        const collector = new CombatStatsDataCollector();
        mocks.values.set('consumableTracker:character-a', {
            actualConsumed: { '/items/coffee': 8 },
            defaultConsumed: { '/items/coffee': 2 },
            inventoryAmount: { '/items/coffee': 90 },
            elapsedMs: 1000,
            saveTimestamp: Date.now(),
        });

        await collector.loadConsumableTracking('character-a');
        expect(collector.consumableTracker.actualConsumed['/items/coffee']).toBe(8);

        await collector.loadConsumableTracking('character-b');
        expect(collector.consumableTracker.actualConsumed).toEqual({});
        expect(collector.consumableTracker.defaultConsumed).toEqual({});
        expect(collector.partyConsumableTrackers).toEqual({});
        expect(collector.partyConsumableSnapshots).toEqual({});
    });

    test('migrates legacy unscoped data once to the active character', async () => {
        const collector = new CombatStatsDataCollector();
        const legacyTracker = {
            actualConsumed: { '/items/coffee': 3 },
            defaultConsumed: { '/items/coffee': 2 },
            inventoryAmount: { '/items/coffee': 20 },
            elapsedMs: 500,
            saveTimestamp: Date.now(),
        };
        const legacyRun = { battleId: 17, players: [] };
        mocks.values.set('consumableTracker', legacyTracker);
        mocks.values.set('partyConsumableTrackers', {});
        mocks.values.set('partyConsumableSnapshots', {});
        mocks.values.set('latestCombatRun', legacyRun);

        await collector.loadConsumableTracking('character-a');
        await collector.loadLatestData('character-a');

        expect(mocks.values.get('consumableTracker:character-a')).toBe(legacyTracker);
        expect(mocks.values.get('latestCombatRun:character-a')).toBe(legacyRun);
        expect(mocks.values.has('consumableTracker')).toBe(false);
        expect(mocks.values.has('latestCombatRun')).toBe(false);

        await collector.loadConsumableTracking('character-b');
        expect(collector.consumableTracker.actualConsumed).toEqual({});
    });

    test('writes every combat-stat record under the captured character ID', async () => {
        const collector = new CombatStatsDataCollector();
        collector.characterId = 'character-a';
        collector.lifecycleGeneration = 4;
        collector.consumableTracker.actualConsumed = { '/items/coffee': 4 };
        collector.consumableTracker.defaultConsumed = { '/items/coffee': 2 };
        collector.consumableTracker.inventoryAmount = { '/items/coffee': 40 };
        collector.consumableTracker.startTime = Date.now() - 1000;

        await collector.saveConsumableTracking('character-a', 4);

        expect(storage.setJSON).toHaveBeenCalledWith(
            'consumableTracker:character-a',
            expect.objectContaining({ actualConsumed: { '/items/coffee': 4 } }),
            'combatStats'
        );
        expect(mocks.values.has('consumableTracker')).toBe(false);
        expect(mocks.values.has('partyConsumableTrackers:character-a')).toBe(true);
        expect(mocks.values.has('partyConsumableSnapshots:character-a')).toBe(true);
    });

    test('invalidates an in-flight lifecycle generation before it writes', async () => {
        const collector = new CombatStatsDataCollector();
        collector.characterId = 'character-a';
        collector.lifecycleGeneration = 2;

        await collector.saveConsumableTracking('character-a', 1);

        expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('cleanup invalidates registered handlers before the next character initializes', async () => {
        const collector = new CombatStatsDataCollector();
        await collector.initialize();
        const generation = collector.lifecycleGeneration;

        collector.cleanup();

        expect(collector.lifecycleGeneration).toBe(generation + 1);
        expect(collector.isInitialized).toBe(false);
        expect(mocks.off).toHaveBeenCalledTimes(2);
    });
});
