/**
 * Tests for locale-aware template defaults in settings-schema.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// i18n.getLocale() reads window.localStorage['i18nextLng']; stub it so tests
// can switch the effective locale without a browser environment.
const localeStore = new Map();
// NOTE: vi.stubGlobal runs after ESM module evaluation (imports hoist first); this only works
// because i18n.js reads window.localStorage lazily inside getLocale().
vi.stubGlobal('window', {
    localStorage: {
        getItem: (key) => (localeStore.has(key) ? localeStore.get(key) : null),
    },
});

import {
    settingsGroups,
    buildCombatStatsChatTemplate,
    resolveSettingDefault,
    resolveTemplateVariableLabel,
    resolveTemplateVariableDescription,
} from './settings-schema.js';
import zhPack from '../locales/zh.js';

// Byte-exact copy of the pre-change English default (schema L1940-1958).
// Keep in sync manually; the factory's 'en' branch must stay equal to this.
const LEGACY_ENGLISH_CHAT_TEMPLATE = [
    { type: 'text', value: 'Combat Stats: ' },
    { type: 'variable', key: '{duration}', label: 'Duration' },
    { type: 'text', value: ' duration | ' },
    { type: 'variable', key: '{encountersPerHour}', label: 'Encounters/Hour' },
    { type: 'text', value: ' EPH | ' },
    { type: 'variable', key: '{income}', label: 'Total Income' },
    { type: 'text', value: ' income | ' },
    { type: 'variable', key: '{dailyIncome}', label: 'Daily Income' },
    { type: 'text', value: ' income/d | ' },
    { type: 'variable', key: '{dailyConsumableCosts}', label: 'Daily Consumable Costs' },
    { type: 'text', value: ' consumables/d | ' },
    { type: 'variable', key: '{dailyProfit}', label: 'Daily Profit' },
    { type: 'text', value: ' profit/d | ' },
    { type: 'variable', key: '{exp}', label: 'EXP/Hour' },
    { type: 'text', value: ' exp/h | ' },
    { type: 'variable', key: '{deathCount}', label: 'Deaths' },
    { type: 'text', value: ' deaths' },
];

const variableKeysOf = (template) => template.filter((item) => item.type === 'variable').map((item) => item.key);

describe('buildCombatStatsChatTemplate', () => {
    beforeEach(() => {
        localeStore.clear();
    });

    test("'en' output is byte-equal to the legacy English default", () => {
        expect(buildCombatStatsChatTemplate('en')).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
    });

    test("'zh' output uses Chinese text segments", () => {
        const zh = buildCombatStatsChatTemplate('zh');
        expect(zh[0]).toEqual({ type: 'text', value: '战斗统计：' });
        expect(zh.some((item) => item.type === 'text' && item.value === ' 时长 | ')).toBe(true);
        expect(zh.some((item) => item.type === 'text' && item.value === ' 死亡')).toBe(true);
    });

    test("'zh' variable key sequence matches 'en' exactly", () => {
        expect(variableKeysOf(buildCombatStatsChatTemplate('zh'))).toEqual(
            variableKeysOf(buildCombatStatsChatTemplate('en'))
        );
    });

    test("unknown locales fall back to 'en'", () => {
        expect(buildCombatStatsChatTemplate('fr')).toEqual(LEGACY_ENGLISH_CHAT_TEMPLATE);
    });

    test('returns a fresh clone each call (callers may mutate)', () => {
        const a = buildCombatStatsChatTemplate('en');
        a[0].value = 'mutated';
        expect(buildCombatStatsChatTemplate('en')[0].value).toBe('Combat Stats: ');
    });

    test('no-arg call uses i18n locale (zh via localStorage stub)', () => {
        localeStore.set('i18nextLng', 'zh');
        expect(buildCombatStatsChatTemplate()[0].value).toBe('战斗统计：');
        localeStore.set('i18nextLng', 'en');
        expect(buildCombatStatsChatTemplate()[0].value).toBe('Combat Stats: ');
    });

    test("raw BCP-47 tags starting with 'zh' select the Chinese template", () => {
        expect(buildCombatStatsChatTemplate('zh-CN')[0].value).toBe('战斗统计：');
        expect(buildCombatStatsChatTemplate('ZH-TW')[0].value).toBe('战斗统计：');
    });
});

describe('resolveSettingDefault', () => {
    test('invokes factory defaults', () => {
        expect(resolveSettingDefault({ default: () => ({ a: 1 }) })).toEqual({ a: 1 });
    });

    test('passes literal defaults through', () => {
        expect(resolveSettingDefault({ default: [1, 2] })).toEqual([1, 2]);
        expect(resolveSettingDefault({ default: true })).toBe(true);
    });

    test('returns undefined when no default is defined', () => {
        expect(resolveSettingDefault({})).toBeUndefined();
    });
});

describe('schema combatStatsChatMessage', () => {
    test('default is a factory (function), not a static array', () => {
        const def = settingsGroups.combat.settings.combatStatsChatMessage;
        expect(typeof def.default).toBe('function');
    });

    test('resolver applied to the schema definition yields the English template array', () => {
        localeStore.set('i18nextLng', 'en');
        expect(resolveSettingDefault(settingsGroups.combat.settings.combatStatsChatMessage)).toEqual(
            LEGACY_ENGLISH_CHAT_TEMPLATE
        );
    });
});

describe('resolveTemplateVariableLabel / resolveTemplateVariableDescription', () => {
    // Expected zh strings are read from the zh pack itself instead of being
    // retyped here — immune to source drift and self-maintaining.
    const zhVars = zhPack.settingsSchema.settings.combatStatsChatMessage.variables;

    const settingDef = {
        id: 'combatStatsChatMessage',
        templateVariables: [{ key: '{duration}', label: 'Duration', description: 'Combat session duration' }],
    };

    test('resolves zh label/description from the locale pack', () => {
        localeStore.set('i18nextLng', 'zh');
        const item = { type: 'variable', key: '{duration}' };
        expect(resolveTemplateVariableLabel(settingDef, item)).toBe(zhVars.duration.label);
        expect(resolveTemplateVariableDescription(settingDef, item)).toBe(zhVars.duration.description);
    });

    test('falls back to schema English when the locale pack has no entry', () => {
        localeStore.set('i18nextLng', 'en');
        const item = { type: 'variable', key: '{duration}' };
        expect(resolveTemplateVariableLabel(settingDef, item)).toBe('Duration');
        expect(resolveTemplateVariableDescription(settingDef, item)).toBe('Combat session duration');
    });

    test('falls back to stored item label, then the raw key; description falls to empty string', () => {
        localeStore.set('i18nextLng', 'en');
        const unknownDef = { id: 'x', templateVariables: [] };
        expect(resolveTemplateVariableLabel(unknownDef, { key: '{legacy}', label: 'Stored' })).toBe('Stored');
        expect(resolveTemplateVariableLabel(unknownDef, { key: '{legacy}' })).toBe('{legacy}');
        expect(resolveTemplateVariableDescription(unknownDef, { key: '{legacy}', description: 'D' })).toBe('D');
        expect(resolveTemplateVariableDescription(unknownDef, { key: '{legacy}' })).toBe('');
    });

    test('returns empty label for items without a key', () => {
        expect(resolveTemplateVariableLabel(settingDef, {})).toBe('');
        expect(resolveTemplateVariableDescription(settingDef, {})).toBe('');
    });
});
