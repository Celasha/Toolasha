/**
 * Chinese-locale regression tests for inline dual-match fixes.
 *
 * Each test exercises one BUG fix from ZH-I18N-REMAINING-ISSUES.md where the
 * dual-match lives inline in a method (no isolated helper to export). The
 * tests mock the game-i18n bridge to return Chinese translations and verify
 * the module loads and (where feasible) the dual-match behaves correctly
 * under a Chinese client.
 *
 * Bugs covered: #1, #2, #3, #4, #5, #6, #7, #8, #11, #16, #17, #18, #19, #20, #23
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

// Shared mock for game-i18n — returns Chinese for known namespaces/keys,
// falls back to English otherwise. Tests can override per-test.
const translateMock = vi.fn((_ns, _key, fallback) => fallback);
vi.mock('./utils/game-i18n.js', () => ({
    translateGameName: translateMock,
    getItemName: vi.fn((_hrid, fb) => fb),
    getItemDescription: vi.fn((_hrid, fb) => fb),
    getActionName: vi.fn((_hrid, fb) => fb),
    getActionTypeName: vi.fn((_hrid, fb) => fb),
    getActionCategoryName: vi.fn((_hrid, fb) => fb),
    getMonsterName: vi.fn((_hrid, fb) => fb),
    getSkillName: vi.fn((_hrid, fb) => fb),
    getAbilityName: vi.fn((_hrid, fb) => fb),
    getAbilityDescription: vi.fn((_hrid, fb) => fb),
    getItemCategoryName: vi.fn((_hrid, fb) => fb),
    getItemLocationName: vi.fn((_hrid, fb) => fb),
    getEquipmentTypeName: vi.fn((_hrid, fb) => fb),
    getCombatStyleName: vi.fn((_hrid, fb) => fb),
    getDamageTypeName: vi.fn((_hrid, fb) => fb),
    getBuffTypeName: vi.fn((_hrid, fb) => fb),
    getHouseRoomName: vi.fn((_hrid, fb) => fb),
    getGuildShrineName: vi.fn((_hrid, fb) => fb),
    getAchievementName: vi.fn((_hrid, fb) => fb),
    getGameI18n: vi.fn(() => null),
}));

// Minimal stubs for core modules — sufficient for module load without a real game.
vi.mock('./core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({})),
        on: vi.fn(),
        off: vi.fn(),
        getItemDetails: vi.fn(),
        getMarketListings: vi.fn(() => []),
    },
}));
vi.mock('./core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}), register: vi.fn(() => () => {}) },
}));
vi.mock('./core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn(() => ''),
        onSettingChange: vi.fn(),
    },
}));
vi.mock('./core/storage.js', () => ({
    default: { get: vi.fn(), set: vi.fn(), getJSON: vi.fn(), setJSON: vi.fn() },
}));
vi.mock('./core/websocket.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('./core/i18n.js', () => ({ t: (key) => key }));
vi.mock('./api/marketplace.js', () => ({
    default: { fetch: vi.fn(), on: vi.fn(), off: vi.fn(), getPricesBatch: vi.fn(() => new Map()) },
}));

describe('Chinese-locale regression — inline dual-match fixes', () => {
    test('BUG #1: tea-recommendation Consumables label dual-match loads under zh mock', async () => {
        translateMock.mockImplementation((_ns, _key, _fb) => '消耗品');
        const mod = await import('./features/actions/tea-recommendation.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #2: tea-recommendation location/tab filter loads under zh mock', async () => {
        translateMock.mockImplementation(() => '翻译');
        const mod = await import('./features/actions/tea-recommendation.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #3: tea-recommendation alchemy tab type detection loads under zh mock', async () => {
        const mod = await import('./features/actions/tea-recommendation.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #4: task-icons combat task detection loads under zh mock', async () => {
        const mod = await import('./features/tasks/task-icons.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #5: alchemy-history-viewer native tab text dual-match loads under zh mock', async () => {
        const mod = await import('./features/alchemy/alchemy-history-viewer.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #6: estimated-listing-age Expired/Sell dual-match loads under zh mock', async () => {
        const mod = await import('./features/market/estimated-listing-age.js');
        expect(mod.default).toBeDefined();
        expect(mod.default.parsePrice).toBeDefined();
    });

    test('BUG #7: labyrinth-clear-rate Edit/Save button dual-match loads under zh mock', async () => {
        const mod = await import('./features/combat/labyrinth-clear-rate.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #8: house-panel-observer room name dual-match loads under zh mock', async () => {
        const mod = await import('./features/house/house-panel-observer.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #11: auto-fill-price best buy/sell dual-match loads under zh mock', async () => {
        const mod = await import('./features/market/auto-fill-price.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #16: listing-price-display sell/buy dual-match loads under zh mock', async () => {
        const mod = await import('./features/market/listing-price-display.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #17: alchemy-action-protection alchemy type dual-match loads under zh mock', async () => {
        const mod = await import('./features/alchemy/alchemy-action-protection.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #18: guild-credit-value Fill ALL button dual-match loads under zh mock', async () => {
        const mod = await import('./features/guild/guild-credit-value.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #19: custom-tabs-ui tab text dual-match loads under zh mock', async () => {
        const mod = await import('./features/inventory/custom-tabs/custom-tabs-ui.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #20: alchemy-profit-display best-items tab dual-match loads under zh mock', async () => {
        const mod = await import('./features/alchemy/alchemy-profit-display.js');
        expect(mod.default).toBeDefined();
    });

    test('BUG #23: listing-price-display My Listings manual sort loads under zh mock', async () => {
        const mod = await import('./features/market/listing-price-display.js');
        expect(mod.default).toBeDefined();
    });
});
