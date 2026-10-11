/**
 * Tests for locale-aware materialization of combatStatsChatMessage in
 * SettingsStorage.loadSettings — created once per character in the then-current
 * game language, frozen afterwards, legacy English default migrated once.
 * See spec 2026-10-11.
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

describe('SettingsStorage.loadSettings — locale-aware chat template materialization', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        localeStore.clear();
        const mod = await import('./settings-storage.js');
        mod.default.setCharacterId('10000001');
    });

    test('fresh character in zh materializes and persists the Chinese template', async () => {
        localeStore.set('i18nextLng', 'zh');
        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toEqual(buildCombatStatsChatTemplate('zh'));
        expect(settings.combatStatsChatMessage.value[0].value).toBe(ZH_FIRST_TEXT);
        expect(storageData[CHAR_KEY].combatStatsChatMessage.value[0].value).toBe(ZH_FIRST_TEXT);
    });

    test('fresh character in en materializes the legacy-identical English template', async () => {
        localeStore.set('i18nextLng', 'en');
        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        expect(storageData[CHAR_KEY].combatStatsChatMessage.value).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
    });

    test('customized stored template is never rewritten', async () => {
        localeStore.set('i18nextLng', 'zh');
        const custom = [{ type: 'text', value: 'mine' }];
        storageData[CHAR_KEY] = { combatStatsChatMessage: { id: 'combatStatsChatMessage', value: custom } };
        const expectedSnapshot = JSON.parse(JSON.stringify(custom));

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toEqual(expectedSnapshot);
        expect(storageData[CHAR_KEY].combatStatsChatMessage.value).toEqual(expectedSnapshot);
    });

    test('stored legacy English default migrates once to current locale (zh)', async () => {
        localeStore.set('i18nextLng', 'zh');
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: LEGACY_ENGLISH_CHAT_TEMPLATE },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toEqual(buildCombatStatsChatTemplate('zh'));
        expect(settings.combatStatsChatMessage.value[0].value).toBe(ZH_FIRST_TEXT);
        expect(storageData[CHAR_KEY].combatStatsChatMessage.value[0].value).toBe(ZH_FIRST_TEXT);
    });

    test('stored legacy English default with en locale stays content-equal', async () => {
        localeStore.set('i18nextLng', 'en');
        storageData[CHAR_KEY] = {
            combatStatsChatMessage: { id: 'combatStatsChatMessage', value: LEGACY_ENGLISH_CHAT_TEMPLATE },
        };

        const mod = await import('./settings-storage.js');
        const settings = await mod.default.loadSettings();

        expect(settings.combatStatsChatMessage.value).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
        expect(storageData[CHAR_KEY].combatStatsChatMessage.value).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
    });
});
