import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ values: new Map(), setJSONCalls: [] }));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _store, defaultValue = null) =>
            mocks.values.has(key) ? mocks.values.get(key) : defaultValue
        ),
        setJSON: vi.fn(async (key, value, storeName, immediate = false) => {
            mocks.values.set(key, value);
            mocks.setJSONCalls.push({ key, value, storeName, immediate });
            return true;
        }),
    },
}));

const {
    loadCharacterActivity,
    saveCharacterActivity,
    loadAccountPreferences,
    saveAccountPreferences,
    CHARACTER_ACTIVITY_SCHEMA_VERSION,
} = await import('./character-activity-storage.js');

beforeEach(() => {
    mocks.values.clear();
    mocks.setJSONCalls = [];
});

describe('character activity persistence', () => {
    test('v1 schema round-trips exactly', async () => {
        const record = {
            characterId: 'char-a',
            characterName: 'Alice',
            observedAt: 1000,
            offline: { hourCap: 10, mooPassExpireTime: null },
            projection: { segments: [], terminalCause: 'idle', terminalAt: 1000, certainty: 'trustworthy' },
        };

        await saveCharacterActivity('char-a', record);
        const loaded = await loadCharacterActivity('char-a');

        expect(loaded).toEqual({ ...record, version: CHARACTER_ACTIVITY_SCHEMA_VERSION });
    });

    test('returns null for a character that has never been observed', async () => {
        expect(await loadCharacterActivity('char-never-seen')).toBeNull();
    });

    test('a record with an unrecognized schema version is ignored, not guessed at', async () => {
        mocks.values.set('char-a', { version: 999, characterId: 'char-a' });

        expect(await loadCharacterActivity('char-a')).toBeNull();
    });

    test('multiple characters remain isolated by exact character ID', async () => {
        await saveCharacterActivity('char-a', { characterId: 'char-a', offline: {}, projection: {} });
        await saveCharacterActivity('char-b', { characterId: 'char-b', offline: {}, projection: {} });

        const a = await loadCharacterActivity('char-a');
        const b = await loadCharacterActivity('char-b');

        expect(a.characterId).toBe('char-a');
        expect(b.characterId).toBe('char-b');
    });
});

describe('account-level preferences', () => {
    test('returns schema defaults when nothing has ever been saved', async () => {
        const prefs = await loadAccountPreferences();

        expect(prefs).toEqual({ enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' });
    });

    test('save + load round-trips', async () => {
        await saveAccountPreferences({ enabled: true, dateFormat: 'DD-MM', timeFormat: '12hour' });

        expect(await loadAccountPreferences()).toEqual({ enabled: true, dateFormat: 'DD-MM', timeFormat: '12hour' });
    });

    test('a partial save merges onto existing preferences rather than replacing them', async () => {
        await saveAccountPreferences({ dateFormat: 'DD-MM', timeFormat: '12hour' });
        await saveAccountPreferences({ enabled: false });

        expect(await loadAccountPreferences()).toEqual({ enabled: false, dateFormat: 'DD-MM', timeFormat: '12hour' });
    });

    test('TLA-025 DEV4 fix: the immediate flag forwards to Storage while partial-merge semantics are preserved', async () => {
        await saveAccountPreferences({ dateFormat: 'DD-MM', timeFormat: '12hour' }, true);
        await saveAccountPreferences({ enabled: false }, true);

        expect(mocks.setJSONCalls.every((call) => call.immediate === true)).toBe(true);
        expect(await loadAccountPreferences()).toEqual({ enabled: false, dateFormat: 'DD-MM', timeFormat: '12hour' });
    });

    test('TLA-025 DEV4 fix: immediate defaults to false when omitted, matching prior debounced behavior', async () => {
        await saveAccountPreferences({ enabled: false });

        expect(mocks.setJSONCalls[0].immediate).toBe(false);
    });
});
