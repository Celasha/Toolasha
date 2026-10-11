/**
 * Tests for locale-aware materialization of combatStatsChatMessage in
 * SettingsStorage.loadSettings — created once per character in the then-current
 * game language, frozen afterwards, legacy English default migrated once.
 *
 * Storage shape contract: the template setting is persisted as a JSON STRING
 * (exactly what the settings UI editor saves), never a bare array. Legacy
 * equality checks must be shape-agnostic (parse string or accept array before
 * comparing). A frozenLocale stamp marks the entry as created/migrated/user-
 * owned so later loads never rewrite it. See spec 2026-10-11.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { buildCombatStatsChatTemplate } from './settings-schema.js';

const localeStore = new Map();
vi.stubGlobal('window', {
    localStorage: {
        getItem: (key) => (localeStore.has(key) ? localeStore.get(key) : null),
    },
});

const storageData = {};
vi.mock('./storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        setJSON: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
        delete: vi.fn(async () => {}),
    },
}));

// The schema test file locks COMBAT_STATS_CHAT_TEMPLATE_EN byte-for-byte against
// the pre-change default; deriving the legacy blob here from the factory keeps
// this file free of hand-typed literals.
const LEGACY_ENGLISH_CHAT_TEMPLATE = buildCombatStatsChatTemplate('en');

// Chinese first text segment, copied mechanically from
// COMBAT_STATS_CHAT_TEMPLATE_ZH in src/core/settings-schema.js (do NOT retype).
const ZH_FIRST_TEXT = '战斗统计：';

const CHAR_KEY = 'script_settingsMap_10000001';

const legacyBlob = () => JSON.stringify(LEGACY_ENGLISH_CHAT_TEMPLATE);
const zhBlob = () => JSON.stringify(buildCombatStatsChatTemplate('zh'));

describe('SettingsStorage.loadSettings — locale-aware chat template materialization', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        localeStore.clear();
        const mod = await import('./settings-storage.js');
        mod.default.setCharacterId('10000001');
    });

    test('fresh character in zh materializes the Chinese template as a JSON string and stamps it', async () => {
        localeStore.set('i18nextLng', 'zh');
        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toBe(zhBlob());
        expect(JSON.parse(settings.combatStatsChatMessage.value)[0].value).toBe(ZH_FIRST_TEXT);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(zhBlob());
        expect(persisted.frozenLocale).toBe('zh');
    });

    test('fresh character in en materializes the legacy-identical English template as a JSON string', async () => {
        localeStore.set('i18nextLng', 'en');
        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(JSON.parse(settings.combatStatsChatMessage.value)).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(legacyBlob());
        expect(persisted.frozenLocale).toBe('en');
    });

    test('customized stored string is stamped and never rewritten', async () => {
        localeStore.set('i18nextLng', 'zh');
        const custom = [{ type: 'text', value: 'mine' }];
        const customBlob = JSON.stringify(custom);
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: customBlob },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toBe(customBlob);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(customBlob);
        expect(persisted.frozenLocale).toBe('zh');
    });

    test('string-form legacy English default migrates once to current locale (zh)', async () => {
        localeStore.set('i18nextLng', 'zh');
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: legacyBlob() },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toBe(zhBlob());
        expect(JSON.parse(settings.combatStatsChatMessage.value)[0].value).toBe(ZH_FIRST_TEXT);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(zhBlob());
        expect(persisted.frozenLocale).toBe('zh');
    });

    test('string-form legacy English default with en locale stays content-equal and gets stamped', async () => {
        localeStore.set('i18nextLng', 'en');
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: legacyBlob() },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(JSON.parse(settings.combatStatsChatMessage.value)).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(JSON.parse(persisted.value)).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        expect(persisted.frozenLocale).toBe('en');
    });

    test('array-form legacy English default (pre-fix dev build residue) migrates to zh string', async () => {
        localeStore.set('i18nextLng', 'zh');
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: LEGACY_ENGLISH_CHAT_TEMPLATE },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toBe(zhBlob());
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(zhBlob());
        expect(persisted.frozenLocale).toBe('zh');
    });

    test('frozenLocale stamp freezes the entry regardless of stored form or locale', async () => {
        localeStore.set('i18nextLng', 'zh');
        const entry = { id: 'combatStatsChatMessage', value: legacyBlob(), frozenLocale: 'zh' };
        storageData[CHAR_KEY] = { combatStatsChatMessage: entry };
        const snapshotBefore = JSON.stringify(storageData[CHAR_KEY]);

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        // Content stays the English default even though the game language is zh.
        expect(JSON.parse(settings.combatStatsChatMessage.value)).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        // No persistence pass at all: load must be a pure no-op for frozen entries.
        expect(JSON.stringify(storageData[CHAR_KEY])).toBe(snapshotBefore);
    });

    test('no-stamp bare-array custom value is stamped and preserved as-is', async () => {
        localeStore.set('i18nextLng', 'zh');
        const custom = [{ type: 'text', value: 'raw-array-mine' }];
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: custom },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(JSON.parse(JSON.stringify(settings.combatStatsChatMessage.value))).toEqual(custom);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(JSON.parse(JSON.stringify(persisted.value))).toEqual(custom);
        expect(persisted.frozenLocale).toBe('zh');
    });

    test('unparseable string value is treated as user-owned: stamped and kept', async () => {
        localeStore.set('i18nextLng', 'zh');
        const junk = 'not-json{';
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: junk },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toBe(junk);
        const persisted = storageData[CHAR_KEY].combatStatsChatMessage;
        expect(persisted.value).toBe(junk);
        expect(persisted.frozenLocale).toBe('zh');
    });
});
