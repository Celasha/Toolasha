/**
 * Tests for SettingsStorage.importSettings character isolation
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('./settings-schema.js', () => ({ settingsGroups: [] }));

const storageData = {};
vi.mock('./storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        setJSON: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
    },
}));

// settings-storage.js exports a singleton. We test via importSettings on that singleton
// after patching its state directly (currentCharacterId, storageData), rather than
// instantiating the class in isolation.

describe('SettingsStorage.importSettings — character isolation', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
    });

    test('skips other character keys when known list uses current object format (six-digit IDs)', async () => {
        storageData['known_character_ids'] = [
            { id: '111111', name: 'Alice' },
            { id: '222222', name: 'Bob' },
        ];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            script_settingsMap_111111: { a: 1 },
            script_settingsMap_222222: { b: 2 },
            script_settingsMap: { c: 3 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.imported).toBe(2); // global + own character
        expect(result.skipped).toBe(1); // other character
        expect(storageData['script_settingsMap_222222']).toBeUndefined();
    });

    test('skips other character keys when known list uses legacy scalar format (six-digit IDs)', async () => {
        storageData['known_character_ids'] = ['111111', '222222'];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            script_settingsMap_111111: { a: 1 },
            script_settingsMap_222222: { b: 2 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.imported).toBe(1);
        expect(result.skipped).toBe(1);
        expect(storageData['script_settingsMap_222222']).toBeUndefined();
    });

    test('handles imported known_character_ids in object format', async () => {
        storageData['known_character_ids'] = [];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            known_character_ids: [
                { id: '111111', name: 'Alice' },
                { id: '222222', name: 'Bob' },
            ],
            script_settingsMap_111111: { a: 1 },
            script_settingsMap_222222: { b: 2 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.skipped).toBe(1);
        expect(storageData['script_settingsMap_222222']).toBeUndefined();
    });

    test('handles imported known_character_ids in legacy scalar format', async () => {
        storageData['known_character_ids'] = [];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            known_character_ids: ['111111', '222222'],
            script_settingsMap_111111: { a: 1 },
            script_settingsMap_222222: { b: 2 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.skipped).toBe(1);
        expect(storageData['script_settingsMap_222222']).toBeUndefined();
    });

    test('numeric and string representations of the same ID are treated identically', async () => {
        storageData['known_character_ids'] = [{ id: '111111', name: 'Alice' }];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.setCharacterId(111111); // numeric — should be normalized to string

        const importData = {
            script_settingsMap_111111: { a: 1 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.imported).toBe(1);
        expect(result.skipped).toBe(0);
        expect(storageData['script_settingsMap_111111']).toEqual({ a: 1 });
    });

    test('24-character hex IDs are still recognized and skipped for other characters', async () => {
        storageData['known_character_ids'] = [];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = 'aabbccddeeff001122334455';

        const importData = {
            script_settingsMap_aabbccddeeff001122334455: { mine: true },
            script_settingsMap_000000000000000000000000: { theirs: true },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.imported).toBe(1);
        expect(result.skipped).toBe(1);
        expect(storageData['script_settingsMap_000000000000000000000000']).toBeUndefined();
    });

    test('global key is imported for active character', async () => {
        storageData['known_character_ids'] = [{ id: '111111', name: 'Alice' }];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            script_settingsMap: { globalSetting: true },
            script_settingsMap_111111: { charSetting: true },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        expect(result.imported).toBe(2);
        expect(result.skipped).toBe(0);
    });

    test('imported and skipped counts match actual writes', async () => {
        storageData['known_character_ids'] = [
            { id: '111111', name: 'Alice' },
            { id: '222222', name: 'Bob' },
            { id: '333333', name: 'Carol' },
        ];
        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const importData = {
            script_settingsMap: { g: 1 },
            script_settingsMap_111111: { a: 1 },
            script_settingsMap_222222: { b: 2 },
            script_settingsMap_333333: { c: 3 },
        };
        const result = await s.importSettings(JSON.stringify(importData));

        const writtenKeys = Object.keys(storageData).filter((k) => k.startsWith('script_settingsMap'));
        expect(result.imported).toBe(2);
        expect(result.skipped).toBe(2);
        expect(writtenKeys).not.toContain('script_settingsMap_222222');
        expect(writtenKeys).not.toContain('script_settingsMap_333333');
    });
});

describe('SettingsStorage.syncSettingsToAllCharacters — task data copy', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
    });

    test('copies protected-task list and auto-reroll targets to selected characters', async () => {
        storageData['known_character_ids'] = [
            { id: '111111', name: 'Alice' },
            { id: '222222', name: 'Bob' },
        ];
        storageData['taskProtectedHrids_111111'] = ['/monsters/a', '/monsters/b'];
        storageData['taskAutoRerollHrids_111111'] = ['/actions/gathering/x'];

        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        const count = await s.syncSettingsToAllCharacters({ some: 'setting' }, ['222222']);

        expect(count).toBe(1);
        expect(storageData['taskProtectedHrids_222222']).toEqual(['/monsters/a', '/monsters/b']);
        expect(storageData['taskAutoRerollHrids_222222']).toEqual(['/actions/gathering/x']);
        expect(storageData['script_settingsMap_222222']).toEqual({ some: 'setting' });
    });

    test('does not write task keys the current character has none of', async () => {
        storageData['known_character_ids'] = [
            { id: '111111', name: 'Alice' },
            { id: '222222', name: 'Bob' },
        ];
        // No taskProtectedHrids_111111 / taskAutoRerollHrids_111111 set.

        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        await s.syncSettingsToAllCharacters({}, ['222222']);

        expect(storageData['taskProtectedHrids_222222']).toBeUndefined();
        expect(storageData['taskAutoRerollHrids_222222']).toBeUndefined();
    });

    test('never writes task keys back onto the current character', async () => {
        storageData['known_character_ids'] = [
            { id: '111111', name: 'Alice' },
            { id: '222222', name: 'Bob' },
        ];
        storageData['taskProtectedHrids_111111'] = ['/monsters/a'];

        const mod = await import('./settings-storage.js');
        const s = mod.default;
        s.currentCharacterId = '111111';

        await s.syncSettingsToAllCharacters({}, ['111111', '222222']);

        expect(storageData['taskProtectedHrids_111111']).toEqual(['/monsters/a']);
        expect(storageData['taskProtectedHrids_222222']).toEqual(['/monsters/a']);
    });
});
