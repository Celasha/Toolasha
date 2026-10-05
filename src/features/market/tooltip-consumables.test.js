import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPriceOutlierInfo: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { isLoaded: vi.fn(() => true), fetch: vi.fn() } }));
vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../utils/market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));

import tooltipConsumables from './tooltip-consumables.js';

function hpConsumable(restoreAmount = 100) {
    return { consumableDetail: { hitpointRestore: restoreAmount, cooldownDuration: 10e9 } };
}

describe('TooltipConsumables.calculateConsumableStats - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('flags isOutlier when the ask price was substituted by the outlier guard', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: true });

        const stats = tooltipConsumables.calculateConsumableStats('/items/potion', hpConsumable(100));

        expect(stats.costPerPoint).toBeCloseTo(0.5);
        expect(stats.isOutlier).toBe(true);
    });

    test('does not flag isOutlier when the ask price was not substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: false });

        const stats = tooltipConsumables.calculateConsumableStats('/items/potion', hpConsumable(100));

        expect(stats.isOutlier).toBe(false);
    });

    test('does not flag isOutlier when there is no market price at all', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });

        const stats = tooltipConsumables.calculateConsumableStats('/items/potion', hpConsumable(100));

        expect(stats.askPrice).toBe(0);
        expect(stats.isOutlier).toBe(false);
    });
});
