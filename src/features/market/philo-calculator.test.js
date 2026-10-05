import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPriceOutlierInfo: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: vi.fn() } }));
vi.mock('../../core/storage.js', () => ({ default: { getJSON: vi.fn(), setJSON: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: { fetch: vi.fn(), isLoaded: vi.fn(() => true) } }));
vi.mock('../../utils/market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));

import philoCalculator from './philo-calculator.js';

const PHILO_HRID = '/items/philosophers_stone';

function itemDetails(overrides = {}) {
    return {
        sellPrice: 100,
        alchemyDetail: {
            transmuteSuccessRate: 0.5,
            bulkMultiplier: 1,
            transmuteDropTable: [{ itemHrid: PHILO_HRID, dropRate: 0.1, minCount: 1, maxCount: 1 }],
        },
        ...overrides,
    };
}

describe('PhiloCalculator - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        philoCalculator.useCatalyst = false;
        philoCalculator.useCatalyticTea = false;
        philoCalculator.philoPrice = 1000;
        philoCalculator.philoPriceIsOutlier = false;
        philoCalculator.catalystPrice = 0;
        philoCalculator.catalystPriceIsOutlier = false;
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 500, isOutlier: false });
    });

    test('loadDefaultPrices stores isOutlier flags for philo and catalyst prices', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((hrid) =>
            hrid === PHILO_HRID ? { value: 1000, isOutlier: true } : { value: 500, isOutlier: false }
        );

        philoCalculator.loadDefaultPrices();

        expect(philoCalculator.philoPrice).toBe(1000);
        expect(philoCalculator.philoPriceIsOutlier).toBe(true);
        expect(philoCalculator.catalystPrice).toBe(500);
        expect(philoCalculator.catalystPriceIsOutlier).toBe(false);
    });

    test('flags a row as outlier when the item cost (ask price) was substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 500, isOutlier: true });

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(true);
    });

    test('flags a row as outlier when a non-philo drop price was substituted', () => {
        mocks.getItemPriceOutlierInfo.mockImplementation((hrid, opts) => {
            if (opts.mode === 'ask') return { value: 500, isOutlier: false }; // item cost, clean
            return { value: 50, isOutlier: true }; // drop bid price, substituted
        });
        const details = itemDetails({
            alchemyDetail: {
                transmuteSuccessRate: 0.5,
                bulkMultiplier: 1,
                transmuteDropTable: [
                    { itemHrid: PHILO_HRID, dropRate: 0.1, minCount: 1, maxCount: 1 },
                    { itemHrid: '/items/byproduct', dropRate: 0.2, minCount: 1, maxCount: 1 },
                ],
            },
        });

        const row = philoCalculator.calculateRow('/items/ore', details);

        expect(row.isOutlier).toBe(true);
    });

    test('flags a row as outlier when the philo price itself was substituted', () => {
        philoCalculator.philoPriceIsOutlier = true;

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(true);
    });

    test('flags a row as outlier when the catalyst price was substituted and the catalyst is used', () => {
        philoCalculator.useCatalyst = true;
        philoCalculator.catalystPriceIsOutlier = true;

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(true);
    });

    test('ignores a substituted catalyst price when the catalyst is not being used', () => {
        philoCalculator.useCatalyst = false;
        philoCalculator.catalystPriceIsOutlier = true;

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(false);
    });

    test('does not flag a row when nothing was substituted', () => {
        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(false);
    });
});
