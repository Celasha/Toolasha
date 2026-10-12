// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPrices: vi.fn(),
    getItemDetails: vi.fn(),
    getCachedValue: vi.fn(),
    calculateSingleContainer: vi.fn(),
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

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: (...args) => mocks.getItemDetails(...args),
    },
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: {
        getCachedValue: (...args) => mocks.getCachedValue(...args),
        calculateSingleContainer: (...args) => mocks.calculateSingleContainer(...args),
    },
}));

import combatSummary from './combat-summary.js';
import { formatLargeNumber } from '../../utils/formatters.js';

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
        mocks.getItemDetails.mockReturnValue({});
        mocks.getCachedValue.mockReturnValue(null);
        mocks.calculateSingleContainer.mockReturnValue(null);
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

    test('values openable containers by expected value instead of market price', async () => {
        battlePanelDom();
        mocks.getItemDetails.mockImplementation((hrid) => (hrid === '/items/purple_chest' ? { isOpenable: true } : {}));
        mocks.getCachedValue.mockImplementation((hrid) => (hrid === '/items/purple_chest' ? 1000000 : null));
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/purple_chest', count: 3 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        expect(mocks.getItemPrices).not.toHaveBeenCalled();
        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv.textContent).toContain(formatLargeNumber(3000000));
    });

    test('falls back to calculating the container expected value when it is not cached', async () => {
        battlePanelDom();
        mocks.getItemDetails.mockReturnValue({ isOpenable: true });
        mocks.getCachedValue.mockReturnValue(null);
        mocks.calculateSingleContainer.mockReturnValue(500000);
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/purple_chest', count: 2 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv.textContent).toContain(formatLargeNumber(1000000));
    });

    test('contributes nothing for an openable with no resolvable expected value', async () => {
        battlePanelDom();
        mocks.getItemDetails.mockReturnValue({ isOpenable: true });
        combatSummary.initialize();

        await mocks.capturedHandler({
            unit: {
                totalLootMap: { a: { itemHrid: '/items/purple_chest', count: 2 } },
                totalSkillExperienceMap: {},
            },
        });
        await flushMicrotasks();

        expect(mocks.getItemPrices).not.toHaveBeenCalled();
        const revenueDiv = document.querySelector('#mwi-combat-revenue');
        expect(revenueDiv.textContent).toContain(formatLargeNumber(0));
    });
});
