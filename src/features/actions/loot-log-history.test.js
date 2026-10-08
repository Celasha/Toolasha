/**
 * Loot Log History Storage - identity-key dedup regressions.
 *
 * The game can reissue characterActionId mid-session for a single continuous action (observed on
 * labyrinth runs that span an interrupt/resume), while startTime stays stable for the whole
 * session. Storing by characterActionId alone previously caused one real run to be persisted as
 * several separate, incomplete entries. These tests cover the fix: merging/deleting by entry
 * identity (actionHrid/difficultyTier/item hashes/partyId/startTime) instead, with an upsert that
 * keeps whichever copy is more complete, plus a one-time cleanup pass for history written before
 * the fix.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    store: {},
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        get: vi.fn(async (key, storeName, defaultValue) => mocks.store[`${storeName}::${key}`] ?? defaultValue),
        set: vi.fn(async (key, value, storeName) => {
            mocks.store[`${storeName}::${key}`] = value;
            return true;
        }),
        delete: vi.fn(async (key, storeName) => {
            delete mocks.store[`${storeName}::${key}`];
            return true;
        }),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterId: vi.fn(() => 'test-character') },
}));

const { default: lootLogHistory } = await import('./loot-log-history.js');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = {};
});

function labyrinthEntry(overrides = {}) {
    return {
        characterActionId: 123,
        actionHrid: '/actions/labyrinth/explore',
        startTime: '2026-10-07T07:50:12.000Z',
        endTime: '2026-10-07T10:00:00.000Z',
        actionCount: 123,
        drops: { '/items/labyrinth_token::0': 182 },
        xpGains: {},
        ...overrides,
    };
}

describe('mergeAndSave', () => {
    test('stores a brand-new entry', async () => {
        await lootLogHistory.mergeAndSave([labyrinthEntry()]);
        const stored = await lootLogHistory._load();
        expect(stored).toHaveLength(1);
        expect(stored[0].actionCount).toBe(123);
    });

    test('a labyrinth run reissued under a different characterActionId mid-session replaces the earlier snapshot instead of duplicating it', async () => {
        await lootLogHistory.mergeAndSave([labyrinthEntry({ characterActionId: 123, actionCount: 123 })]);
        await lootLogHistory.mergeAndSave([
            labyrinthEntry({
                characterActionId: 148,
                actionCount: 148,
                drops: { '/items/labyrinth_token::0': 289 },
            }),
        ]);

        const stored = await lootLogHistory._load();
        expect(stored).toHaveLength(1);
        expect(stored[0].actionCount).toBe(148);
        expect(stored[0].drops['/items/labyrinth_token::0']).toBe(289);
    });

    test('an incoming entry with a lower actionCount than what is already stored does not regress the stored copy', async () => {
        await lootLogHistory.mergeAndSave([labyrinthEntry({ actionCount: 148 })]);
        await lootLogHistory.mergeAndSave([labyrinthEntry({ actionCount: 50 })]);

        const stored = await lootLogHistory._load();
        expect(stored).toHaveLength(1);
        expect(stored[0].actionCount).toBe(148);
    });

    test('entries with different startTime (genuinely separate runs) are both kept', async () => {
        await lootLogHistory.mergeAndSave([labyrinthEntry({ startTime: '2026-10-07T07:50:12.000Z' })]);
        await lootLogHistory.mergeAndSave([labyrinthEntry({ startTime: '2026-10-08T07:50:12.000Z' })]);

        const stored = await lootLogHistory._load();
        expect(stored).toHaveLength(2);
    });

    test('does nothing when given an empty or missing lootLog array', async () => {
        await lootLogHistory.mergeAndSave([]);
        await lootLogHistory.mergeAndSave(null);
        expect(await lootLogHistory._load()).toHaveLength(0);
    });
});

describe('getHistoricalEntries', () => {
    test('excludes entries whose identity key is in the current set', async () => {
        await lootLogHistory.mergeAndSave([
            labyrinthEntry({ characterActionId: 1, startTime: 't1' }),
            labyrinthEntry({ characterActionId: 2, startTime: 't2' }),
        ]);

        const { buildEntryIdentityKey } = await import('./loot-log-analytics.js');
        const liveKeys = new Set([buildEntryIdentityKey(labyrinthEntry({ startTime: 't1' }))]);

        const historical = await lootLogHistory.getHistoricalEntries(liveKeys);
        expect(historical).toHaveLength(1);
        expect(historical[0].startTime).toBe('t2');
    });
});

describe('dedupeStoredEntries', () => {
    test('collapses duplicate stored entries (pre-fix history) down to the most complete copy per identity', async () => {
        // Simulate history written before the fix: four snapshots of one labyrinth run, each
        // under a different characterActionId, same startTime - exactly the screenshot scenario.
        await lootLogHistory._save([
            labyrinthEntry({ characterActionId: 123, actionCount: 123, drops: { '/items/labyrinth_token::0': 182 } }),
            labyrinthEntry({ characterActionId: 136, actionCount: 136, drops: { '/items/labyrinth_token::0': 235 } }),
            labyrinthEntry({ characterActionId: 138, actionCount: 138, drops: { '/items/labyrinth_token::0': 236 } }),
            labyrinthEntry({ characterActionId: 148, actionCount: 148, drops: { '/items/labyrinth_token::0': 289 } }),
        ]);

        const removedCount = await lootLogHistory.dedupeStoredEntries();

        expect(removedCount).toBe(3);
        const stored = await lootLogHistory._load();
        expect(stored).toHaveLength(1);
        expect(stored[0].actionCount).toBe(148);
    });

    test('is a no-op when storage has no duplicates', async () => {
        await lootLogHistory.mergeAndSave([
            labyrinthEntry({ characterActionId: 1, startTime: 't1' }),
            labyrinthEntry({ characterActionId: 2, startTime: 't2' }),
        ]);

        const removedCount = await lootLogHistory.dedupeStoredEntries();

        expect(removedCount).toBe(0);
        expect(await lootLogHistory._load()).toHaveLength(2);
    });

    test('is safe to call on empty storage', async () => {
        expect(await lootLogHistory.dedupeStoredEntries()).toBe(0);
    });
});

describe('clearHistory', () => {
    test('removes all stored entries for the current character', async () => {
        await lootLogHistory.mergeAndSave([labyrinthEntry()]);
        await lootLogHistory.clearHistory();
        expect(await lootLogHistory._load()).toHaveLength(0);
    });
});
