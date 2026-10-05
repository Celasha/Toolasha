// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPrices: vi.fn(),
    capturedHandler: null,
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        COLOR_TEXT_PRIMARY: '#ffffff',
    },
}));

vi.mock('../../api/marketplace.js', () => ({
    default: {
        isLoaded: vi.fn(() => true),
        fetch: vi.fn(async () => ({})),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: vi.fn((messageType, handler) => {
            mocks.capturedHandler = handler;
        }),
        off: vi.fn(),
    },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: (...args) => mocks.getItemPrices(...args),
}));

import combatSummary from './combat-summary.js';

function battlePanelDom() {
    document.body.innerHTML = `
        <div class="BattlePanel_combatInfo_abc">Combat Duration: 1h 0m 0s. Battles: 11. Deaths: 0.</div>
        <div>
            <div class="BattlePanel_gainedExp_abc"></div>
        </div>
    `;
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('CombatSummary - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        mocks.capturedHandler = null;
        combatSummary.disable();
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: false, bidOutlier: false });
    });

    test('flags the revenue lines with the outlier warning when a loot item price was substituted', async () => {
        battlePanelDom();
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: true, bidOutlier: false });
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/gold_ore', count: 10 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv).not.toBeNull();
        expect(revenueDiv.innerHTML).toContain('⚠');

        const revenueHourDiv = document.querySelector('#mwi-combat-revenue-hour');
        expect(revenueHourDiv.innerHTML).toContain('⚠');

        const revenueDayDiv = document.querySelector('#mwi-combat-revenue-day');
        expect(revenueDayDiv.innerHTML).toContain('⚠');
    });

    test('does not flag the revenue lines when no loot item price was substituted', async () => {
        battlePanelDom();
        mocks.getItemPrices.mockReturnValue({ ask: 100, bid: 90, askOutlier: false, bidOutlier: false });
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/gold_ore', count: 10 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv.innerHTML).not.toContain('⚠');
    });

    test('coins never trigger the outlier guard (face value, no market lookup)', async () => {
        battlePanelDom();
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/coin', count: 1000 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        expect(mocks.getItemPrices).not.toHaveBeenCalled();
        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv.innerHTML).not.toContain('⚠');
    });
});
