// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetItemDetails, mockResolveSellSideValue, mockResolveBuySideValue, mockCalculateTaskTokenValue } =
    vi.hoisted(() => ({
        mockGetItemDetails: vi.fn(),
        mockResolveSellSideValue: vi.fn(),
        mockResolveBuySideValue: vi.fn(),
        mockCalculateTaskTokenValue: vi.fn(),
    }));

vi.mock('../core/data-manager.js', () => ({ default: { getItemDetails: mockGetItemDetails } }));
vi.mock('../features/market/expected-value-calculator.js', () => ({
    default: { resolveSellSideValue: mockResolveSellSideValue, resolveBuySideValue: mockResolveBuySideValue },
}));
vi.mock('../features/tasks/task-profit-calculator.js', () => ({
    calculateTaskTokenValue: mockCalculateTaskTokenValue,
}));

import { calculateOfflineEconomics } from './offline-economics-calculator.js';

const NOW = '2026-08-19T12:00:00.000Z';
const EIGHT_HOURS_AGO = '2026-08-19T04:00:00.000Z'; // 28,800s = 1/3 of a day

describe('calculateOfflineEconomics', () => {
    beforeEach(() => {
        mockGetItemDetails.mockReset().mockReturnValue({ isTradable: true });
        mockResolveSellSideValue.mockReset();
        mockResolveBuySideValue.mockReset();
        mockCalculateTaskTokenValue.mockReset().mockReturnValue({ error: 'Market data not loaded' });
    });

    test('gained item (positive offlineCount) is valued sell-side and taxed when needsTax is true', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/cheese', enhancementLevel: 0, offlineCount: 10 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(mockResolveSellSideValue).toHaveBeenCalledWith('/items/cheese', 0);
        expect(result.revenue).toBeCloseTo(10 * 100 * 0.95); // MARKET_TAX = 0.05
        expect(result.cost).toBe(0);
        expect(result.profit).toBeCloseTo(result.revenue);
        expect(result.isPartial).toBe(false);
    });

    test('consumed item (negative offlineCount) is valued buy-side and never taxed', () => {
        mockResolveBuySideValue.mockReturnValue({ value: 50, source: 'market' });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/log', enhancementLevel: 0, offlineCount: -4 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(mockResolveBuySideValue).toHaveBeenCalledWith('/items/log', 0);
        expect(result.cost).toBe(4 * 50);
        expect(result.revenue).toBe(0);
        expect(result.profit).toBe(-200);
    });

    test('mixed gained and consumed items compute Revenue, Cost, and Profit independently', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 10, source: 'market', needsTax: false });
        mockResolveBuySideValue.mockReturnValue({ value: 3, source: 'market' });

        const result = calculateOfflineEconomics({
            offlineItems: [
                { itemHrid: '/items/gained_a', enhancementLevel: 0, offlineCount: 5 },
                { itemHrid: '/items/consumed_a', enhancementLevel: 0, offlineCount: -2 },
            ],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(50);
        expect(result.cost).toBe(6);
        expect(result.profit).toBe(44);
    });

    test('a value with needsTax true is not taxed when the item is non-tradeable', () => {
        mockGetItemDetails.mockReturnValue({ isTradable: false });
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/bound_thing', enhancementLevel: 0, offlineCount: 1 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(100);
    });

    test('Coin gained and consumed are both valued at face value with no tax', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 1, source: 'coin', needsTax: false });
        mockResolveBuySideValue.mockReturnValue({ value: 1, source: 'coin' });

        const result = calculateOfflineEconomics({
            offlineItems: [
                { itemHrid: '/items/coin', enhancementLevel: 0, offlineCount: 1000 },
                { itemHrid: '/items/coin', enhancementLevel: 0, offlineCount: -200 },
            ],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(1000);
        expect(result.cost).toBe(200);
    });

    test('a gained openable container uses the resolver-provided expected value untaxed', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 5000, source: 'expectedValue', needsTax: false });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/large_treasure_chest', enhancementLevel: 0, offlineCount: 2 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(10000);
        expect(result.lines[0].source).toBe('expectedValue');
    });

    test('an item that cannot be valued is marked partial and excluded from Revenue/Cost, never treated as zero', () => {
        mockResolveSellSideValue.mockReturnValueOnce({ value: 100, source: 'market', needsTax: false });
        mockResolveSellSideValue.mockReturnValueOnce(null);

        const result = calculateOfflineEconomics({
            offlineItems: [
                { itemHrid: '/items/valuable', enhancementLevel: 0, offlineCount: 1 },
                { itemHrid: '/items/unvaluable', enhancementLevel: 2, offlineCount: 3 },
            ],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.isPartial).toBe(true);
        expect(result.unvaluedItems).toEqual([{ itemHrid: '/items/unvaluable', enhancementLevel: 2, offlineCount: 3 }]);
        expect(result.revenue).toBe(100);
    });

    test('zero-length offline window does not divide by zero and reports null per-day figures', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: false });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/cheese', enhancementLevel: 0, offlineCount: 1 }],
            currentTimestamp: NOW,
            lastOfflineTime: NOW,
        });

        expect(result.durationSeconds).toBe(0);
        expect(result.revenuePerDay).toBeNull();
        expect(result.costPerDay).toBeNull();
        expect(result.profitPerDay).toBeNull();
    });

    test('an invalid (negative) offline window does not divide by zero either', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: false });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/cheese', enhancementLevel: 0, offlineCount: 1 }],
            currentTimestamp: EIGHT_HOURS_AGO,
            lastOfflineTime: NOW,
        });

        expect(result.durationSeconds).toBe(0);
        expect(result.revenuePerDay).toBeNull();
    });

    test('per-day figures scale the wall-clock offline duration up to a full day', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: false });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/cheese', enhancementLevel: 0, offlineCount: 1 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO, // 8 hours = 1/3 of a day
        });

        expect(result.revenue).toBe(100);
        expect(result.revenuePerDay).toBeCloseTo(300);
    });

    test('enhancement level is propagated to the resolver, not hardcoded to 0', () => {
        mockResolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: false });

        calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/sword', enhancementLevel: 7, offlineCount: 1 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(mockResolveSellSideValue).toHaveBeenCalledWith('/items/sword', 7);
    });

    test('a gained Task Token uses the real task-profit-calculator value, not a fake zero', () => {
        mockCalculateTaskTokenValue.mockReturnValue({ tokenValue: 25000, error: null });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/task_token', enhancementLevel: 0, offlineCount: 2 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(50000);
        expect(result.isPartial).toBe(false);
        expect(mockResolveSellSideValue).not.toHaveBeenCalled();
    });

    test('a Task Token is marked partial when the market data is not yet loaded, not valued at zero', () => {
        mockCalculateTaskTokenValue.mockReturnValue({ tokenValue: null, error: 'Market data not loaded' });

        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/task_token', enhancementLevel: 0, offlineCount: 2 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.isPartial).toBe(true);
        expect(result.revenue).toBe(0);
        expect(result.unvaluedItems).toHaveLength(1);
    });

    test('an offlineCount of exactly 0 is skipped rather than misclassified', () => {
        const result = calculateOfflineEconomics({
            offlineItems: [{ itemHrid: '/items/log', enhancementLevel: 0, offlineCount: 0 }],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(mockResolveSellSideValue).not.toHaveBeenCalled();
        expect(mockResolveBuySideValue).not.toHaveBeenCalled();
        expect(result.lines).toHaveLength(0);
        expect(result.isPartial).toBe(false);
    });

    test('an empty offlineItems array produces a zero, non-partial result', () => {
        const result = calculateOfflineEconomics({
            offlineItems: [],
            currentTimestamp: NOW,
            lastOfflineTime: EIGHT_HOURS_AGO,
        });

        expect(result.revenue).toBe(0);
        expect(result.cost).toBe(0);
        expect(result.isPartial).toBe(false);
    });
});
