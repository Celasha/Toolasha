/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    on: vi.fn(),
    off: vi.fn(),
    currentCharacterId: 'char-a',
    currentCharacterName: 'Alice',
    offlineHourCap: 10,
    mooPassExpireTime: null,
    liveProjection: { segments: [], terminalCause: 'idle', terminalAt: 1000, certainty: 'trustworthy' },
    savedRecords: new Map(),
    savedPrefs: null,
    settingValue: true,
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: mocks.on,
        off: mocks.off,
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getCurrentCharacterName: vi.fn(() => mocks.currentCharacterName),
        getOfflineHourCap: vi.fn(() => mocks.offlineHourCap),
        getMooPassExpireTime: vi.fn(() => mocks.mooPassExpireTime),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => mocks.settingValue),
        getSettingValue: vi.fn((key, defaultValue) => defaultValue),
    },
}));

vi.mock('./character-activity-projection.js', () => ({
    computeLiveProjection: vi.fn(() => mocks.liveProjection),
}));

vi.mock('./character-activity-storage.js', () => ({
    saveCharacterActivity: vi.fn(async (characterId, record, immediate) => {
        mocks.savedRecords.set(characterId, { record, immediate });
        return true;
    }),
    saveAccountPreferences: vi.fn(async (prefs) => {
        mocks.savedPrefs = prefs;
        return true;
    }),
}));

const { default: characterActivityCollector } = await import('./character-activity-collector.js');

beforeEach(() => {
    mocks.on.mockClear();
    mocks.off.mockClear();
    mocks.currentCharacterId = 'char-a';
    mocks.currentCharacterName = 'Alice';
    mocks.savedRecords.clear();
    mocks.savedPrefs = null;
    characterActivityCollector.cleanup();
});

describe('lifecycle registration', () => {
    test('initialize registers actions_updated, character_info_updated, and character_switching handlers', async () => {
        await characterActivityCollector.initialize();

        expect(mocks.on).toHaveBeenCalledWith('actions_updated', expect.any(Function));
        expect(mocks.on).toHaveBeenCalledWith('character_info_updated', expect.any(Function));
        expect(mocks.on).toHaveBeenCalledWith('character_switching', expect.any(Function));
    });

    test('initialize persists an initial projection for the current character', async () => {
        await characterActivityCollector.initialize();

        expect(mocks.savedRecords.has('char-a')).toBe(true);
        expect(mocks.savedRecords.get('char-a').record.characterId).toBe('char-a');
        expect(mocks.savedRecords.get('char-a').record.projection).toBe(mocks.liveProjection);
    });

    test('persisted record captures the current offline cap and MooPass expiry', async () => {
        mocks.offlineHourCap = 14;
        mocks.mooPassExpireTime = 99999;

        await characterActivityCollector.initialize();

        expect(mocks.savedRecords.get('char-a').record.offline).toEqual({ hourCap: 14, mooPassExpireTime: 99999 });
    });

    test('also mirrors the account-level enabled/date-time preferences on persist', async () => {
        await characterActivityCollector.initialize();

        expect(mocks.savedPrefs).toEqual({
            enabled: true,
            dateFormat: 'MM-DD',
            timeFormat: '24hour',
        });
    });
});

describe('refresh triggers', () => {
    test('actions_updated recomputes and persists a fresh record (debounced write, not immediate)', async () => {
        await characterActivityCollector.initialize();
        const handler = mocks.on.mock.calls.find(([event]) => event === 'actions_updated')[1];

        mocks.savedRecords.clear();
        await handler();

        expect(mocks.savedRecords.get('char-a').immediate).toBe(false);
    });

    test('character_switching flushes immediately (not debounced) before the character changes', async () => {
        await characterActivityCollector.initialize();
        const handler = mocks.on.mock.calls.find(([event]) => event === 'character_switching')[1];

        mocks.savedRecords.clear();
        await handler();

        expect(mocks.savedRecords.get('char-a').immediate).toBe(true);
    });
});

describe('lifecycle generation guard', () => {
    test('a stale handler from before cleanup() cannot persist after a new initialize()', async () => {
        await characterActivityCollector.initialize();
        const staleHandler = mocks.on.mock.calls.find(([event]) => event === 'actions_updated')[1];

        characterActivityCollector.cleanup();
        mocks.currentCharacterId = 'char-b';
        await characterActivityCollector.initialize();
        mocks.savedRecords.clear();

        await staleHandler();

        expect(mocks.savedRecords.has('char-a')).toBe(false);
    });

    test('cleanup unregisters every handler it registered', async () => {
        await characterActivityCollector.initialize();
        characterActivityCollector.cleanup();

        expect(mocks.off).toHaveBeenCalledWith('actions_updated', expect.any(Function));
        expect(mocks.off).toHaveBeenCalledWith('character_info_updated', expect.any(Function));
        expect(mocks.off).toHaveBeenCalledWith('character_switching', expect.any(Function));
    });
});
