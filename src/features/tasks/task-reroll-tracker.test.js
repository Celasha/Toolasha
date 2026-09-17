/**
 * Task Reroll Tracker - character-scoped storage regressions.
 *
 * taskRerollData was previously saved under one bare global key shared by every character on
 * the account - switching characters on a single tab silently commingled/overwrote reroll-cost
 * tracking. These tests cover the same character-scoping + legacy-migration + fail-closed
 * load pattern already applied to dungeon-tracker-storage.js.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    store: {},
    currentCharacterId: 'character-a',
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, storeName, defaultValue) => mocks.store[`${storeName}::${key}`] ?? defaultValue),
        setJSON: vi.fn(async (key, value, storeName) => {
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
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        on: vi.fn(),
        off: vi.fn(),
        characterData: null,
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('../../core/config.js', () => ({
    default: { COLOR_TEXT_SECONDARY: '#fff' },
}));

vi.mock('../../utils/dom.js', () => ({
    addStyles: vi.fn(),
}));

vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({
        registerInterval: vi.fn(),
        registerTimeout: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

const { default: taskRerollTracker } = await import('./task-reroll-tracker.js');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = {};
    mocks.currentCharacterId = 'character-a';
    taskRerollTracker.taskRerollData.clear();
    taskRerollTracker.characterId = null;
    taskRerollTracker._legacyMigrationDone = false;
});

describe('character-scoped storage', () => {
    test('getStorageKey() scopes by the current character id', () => {
        taskRerollTracker.characterId = 'character-a';
        expect(taskRerollTracker.getStorageKey()).toBe('taskRerollData_character-a');
    });

    test('getStorageKey() falls back to "default" when no character id is set yet', () => {
        taskRerollTracker.characterId = null;
        expect(taskRerollTracker.getStorageKey()).toBe('taskRerollData_default');
    });

    test('saveToStorage() writes under the character-scoped key, not the legacy global key', async () => {
        taskRerollTracker.characterId = 'character-a';
        taskRerollTracker.taskRerollData.set(1, { coinRerollCount: 2, cowbellRerollCount: 0 });

        await taskRerollTracker.saveToStorage();

        expect(mocks.store['rerollSpending::taskRerollData']).toBeUndefined();
        expect(mocks.store['rerollSpending::taskRerollData_character-a']).toEqual({
            1: { coinRerollCount: 2, cowbellRerollCount: 0 },
        });
    });

    test('loadFromStorage() clears in-memory data before loading (fails closed against a prior character)', async () => {
        taskRerollTracker.taskRerollData.set(999, { coinRerollCount: 5, cowbellRerollCount: 5 });
        taskRerollTracker.characterId = 'character-b';
        mocks.store['rerollSpending::taskRerollData_character-b'] = {
            1: { coinRerollCount: 1, cowbellRerollCount: 0 },
        };

        await taskRerollTracker.loadFromStorage();

        expect(taskRerollTracker.taskRerollData.has(999)).toBe(false);
        expect(taskRerollTracker.taskRerollData.get(1)).toEqual({ coinRerollCount: 1, cowbellRerollCount: 0 });
    });

    test('legacy unscoped data is migrated to the current character on first load', async () => {
        mocks.store['rerollSpending::taskRerollData'] = { 7: { coinRerollCount: 3, cowbellRerollCount: 1 } };
        taskRerollTracker.characterId = 'character-a';

        await taskRerollTracker.loadFromStorage();

        expect(taskRerollTracker.taskRerollData.get(7)).toEqual({ coinRerollCount: 3, cowbellRerollCount: 1 });
        expect(mocks.store['rerollSpending::taskRerollData_character-a']).toBeTruthy();
        // Cleared immediately so a second character never re-claims it.
        expect(mocks.store['rerollSpending::taskRerollData']).toBeUndefined();
    });

    test('legacy migration never overwrites data the current character already has', async () => {
        mocks.store['rerollSpending::taskRerollData'] = { 7: { coinRerollCount: 3, cowbellRerollCount: 1 } };
        mocks.store['rerollSpending::taskRerollData_character-a'] = {
            2: { coinRerollCount: 9, cowbellRerollCount: 9 },
        };
        taskRerollTracker.characterId = 'character-a';

        await taskRerollTracker.loadFromStorage();

        expect(taskRerollTracker.taskRerollData.get(2)).toEqual({ coinRerollCount: 9, cowbellRerollCount: 9 });
        expect(taskRerollTracker.taskRerollData.has(7)).toBe(false);
        expect(mocks.store['rerollSpending::taskRerollData']).toBeUndefined();
    });

    test('switching characters loads independent, non-commingled data', async () => {
        taskRerollTracker.characterId = 'character-a';
        taskRerollTracker.taskRerollData.set(1, { coinRerollCount: 1, cowbellRerollCount: 0 });
        await taskRerollTracker.saveToStorage();

        // Simulate a character switch: cleanup then re-init as character-b.
        taskRerollTracker.taskRerollData.clear();
        taskRerollTracker.characterId = 'character-b';
        taskRerollTracker.taskRerollData.set(2, { coinRerollCount: 4, cowbellRerollCount: 2 });
        await taskRerollTracker.saveToStorage();

        expect(mocks.store['rerollSpending::taskRerollData_character-a']).toEqual({
            1: { coinRerollCount: 1, cowbellRerollCount: 0 },
        });
        expect(mocks.store['rerollSpending::taskRerollData_character-b']).toEqual({
            2: { coinRerollCount: 4, cowbellRerollCount: 2 },
        });
    });
});

describe('calculateGoldSpent / calculateCowbellSpent', () => {
    test('gold cost doubles per reroll, capped at 320K', () => {
        expect(taskRerollTracker.calculateGoldSpent(0)).toBe(0);
        expect(taskRerollTracker.calculateGoldSpent(1)).toBe(10000);
        expect(taskRerollTracker.calculateGoldSpent(2)).toBe(30000);
        expect(taskRerollTracker.calculateGoldSpent(6)).toBe(10000 + 20000 + 40000 + 80000 + 160000 + 320000);
        // 7th reroll caps at 320K rather than doubling to 640K.
        expect(taskRerollTracker.calculateGoldSpent(7)).toBe(10000 + 20000 + 40000 + 80000 + 160000 + 320000 + 320000);
    });

    test('cowbell cost doubles per reroll, capped at 32', () => {
        expect(taskRerollTracker.calculateCowbellSpent(0)).toBe(0);
        expect(taskRerollTracker.calculateCowbellSpent(1)).toBe(1);
        expect(taskRerollTracker.calculateCowbellSpent(6)).toBe(1 + 2 + 4 + 8 + 16 + 32);
        expect(taskRerollTracker.calculateCowbellSpent(7)).toBe(1 + 2 + 4 + 8 + 16 + 32 + 32);
    });
});
