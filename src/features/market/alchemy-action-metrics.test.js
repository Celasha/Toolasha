// @vitest-environment jsdom

/**
 * Tests for AlchemyProfitCalculator.calculateAlchemyActionMetrics (TLA-026).
 *
 * This is the price-independent Alchemy metrics builder: actionTime, efficiency,
 * actionSpeedBreakdown and successRate, computed without ever looking up the market price of
 * the item being processed. It backs inline XP/hr, Action Speed & Time and Level Progress when
 * calculateCoinifyProfit/DecomposeProfit/TransmuteProfit return null due to missing market data
 * (a marketless Iron Cow character, or any item with no listed price).
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

const marketPrices = {};

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((hrid) => (hrid in marketPrices ? marketPrices[hrid] : null)),
}));

const dataManagerMock = {
    getSkills: vi.fn(() => []),
    getEquipment: vi.fn(() => []),
    getInitClientData: vi.fn(() => ({})),
    getItemDetails: vi.fn(() => null),
    getPersonalBuffFlatBoost: vi.fn(() => 0),
    getAchievementBuffFlatBoost: vi.fn(() => 0),
    getCommunityBuffLevel: vi.fn(() => 0),
    getHouseRoomLevel: vi.fn(() => 0),
    getHouseRooms: vi.fn(() => new Map()),
    getActionDrinkSlots: vi.fn(() => []),
    getInventory: vi.fn(() => []),
    isTaskAction: vi.fn(() => false),
    characterData: {},
};

vi.mock('../../core/data-manager.js', () => ({ default: dataManagerMock }));
vi.mock('../../core/config.js', () => ({
    default: { getSettingValue: (_key, def) => def, getSetting: () => false },
}));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: () => null, on: () => {} } }));
vi.mock('./expected-value-calculator.js', () => ({ default: {} }));

const { default: alchemyProfitCalculator } = await import('./alchemy-profit-calculator.js');
const { getItemPrice } = await import('../../utils/market-data.js');

const ITEM_HRID = '/items/test_metrics_item';
const ACTION_DETAIL_MAP = {
    '/actions/alchemy/coinify': { type: '/action_types/alchemy', baseTimeCost: 20e9, levelRequirement: { level: 1 } },
    '/actions/alchemy/decompose': {
        type: '/action_types/alchemy',
        baseTimeCost: 20e9,
        levelRequirement: { level: 1 },
    },
    '/actions/alchemy/transmute': {
        type: '/action_types/alchemy',
        baseTimeCost: 20e9,
        levelRequirement: { level: 1 },
    },
};

function setup({ alchemyDetail, itemLevel = 10, alchemyLevel = 10, sellPrice = 0 }) {
    document.body.innerHTML = '';
    const itemDetails = { itemLevel, sellPrice, alchemyDetail };
    const itemDetailMap = { [ITEM_HRID]: itemDetails };

    dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap: ACTION_DETAIL_MAP });
    dataManagerMock.getItemDetails.mockReturnValue(itemDetails);
    dataManagerMock.getSkills.mockReturnValue([{ skillHrid: '/skills/alchemy', level: alchemyLevel }]);
}

describe('calculateAlchemyActionMetrics (TLA-026)', () => {
    beforeEach(() => {
        for (const key of Object.keys(marketPrices)) delete marketPrices[key];
        getItemPrice.mockClear();
    });

    test('computes coinify metrics with no market price lookup for the item at all', () => {
        setup({ alchemyDetail: { isCoinifiable: true } });

        const metrics = alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'coinify');

        expect(metrics).not.toBeNull();
        expect(metrics.actionType).toBe('coinify');
        expect(metrics.itemHrid).toBe(ITEM_HRID);
        expect(metrics.successRate).toBeCloseTo(0.7, 10); // base coinify rate, no catalyst/tea
        expect(metrics.actionTime).toBeGreaterThan(0);
        expect(metrics.efficiencyBreakdown).toBeDefined();
        expect(metrics.actionSpeedBreakdown).toBeDefined();
        expect(getItemPrice).not.toHaveBeenCalled();
    });

    test('computes decompose metrics with no market price lookup for the item at all', () => {
        setup({ alchemyDetail: { decomposeItems: [{ itemHrid: '/items/output', count: 1 }] } });

        const metrics = alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'decompose');

        expect(metrics).not.toBeNull();
        expect(metrics.successRate).toBeCloseTo(0.6, 10); // base decompose rate, no catalyst/tea
        expect(getItemPrice).not.toHaveBeenCalled();
    });

    test('computes transmute metrics from the item own success rate and under-level penalty, with no market price lookup', () => {
        setup({
            alchemyDetail: {
                transmuteDropTable: [{ itemHrid: '/items/output', dropRate: 0.5, minCount: 1, maxCount: 1 }],
                transmuteSuccessRate: 0.4,
            },
            itemLevel: 20,
            alchemyLevel: 10, // under-leveled -> penalty applies
        });

        const metrics = alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'transmute');

        const perLevel = 0.9 / 20;
        const levelPenalty = perLevel * (10 - 20);
        const expectedSuccessRate = Math.max(0, Math.min(1, 0.4 * (1 + levelPenalty)));

        expect(metrics).not.toBeNull();
        expect(metrics.successRate).toBeCloseTo(expectedSuccessRate, 10);
        expect(getItemPrice).not.toHaveBeenCalled();
    });

    test('returns null when the item is not coinifiable', () => {
        setup({ alchemyDetail: { isCoinifiable: false } });

        expect(alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'coinify')).toBeNull();
    });

    test('returns null for transmute when the item has no positive success rate', () => {
        setup({ alchemyDetail: { transmuteDropTable: [{ itemHrid: '/items/output' }], transmuteSuccessRate: 0 } });

        expect(alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'transmute')).toBeNull();
    });

    test('returns null when game/item data is unavailable', () => {
        dataManagerMock.getInitClientData.mockReturnValue(null);
        dataManagerMock.getItemDetails.mockReturnValue(null);

        expect(alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'coinify')).toBeNull();
    });

    test('returns null for an unsupported actionType', () => {
        setup({ alchemyDetail: { isCoinifiable: true } });

        expect(alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'bogus')).toBeNull();
    });

    test('math parity: actionTime/efficiency/successRate/actionSpeedBreakdown match calculateCoinifyProfit exactly when market data happens to be available too', () => {
        setup({ alchemyDetail: { isCoinifiable: true }, itemLevel: 15, sellPrice: 100 });
        marketPrices[ITEM_HRID] = 50;

        const fullProfit = alchemyProfitCalculator.calculateCoinifyProfit(ITEM_HRID, 0, true);
        const pureMetrics = alchemyProfitCalculator.calculateAlchemyActionMetrics(ITEM_HRID, 'coinify');

        expect(fullProfit).not.toBeNull();
        expect(pureMetrics).not.toBeNull();
        expect(pureMetrics.actionTime).toBe(fullProfit.actionTime);
        expect(pureMetrics.efficiency).toBe(fullProfit.efficiency);
        expect(pureMetrics.successRate).toBe(fullProfit.successRate);
        expect(pureMetrics.actionSpeedBreakdown).toEqual(fullProfit.actionSpeedBreakdown);
    });
});
