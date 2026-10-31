import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getItemPriceOutlierInfo: vi.fn(),
    getCustomPrice: vi.fn(() => null),
    getCustomPriceOverrides: vi.fn(() => ({})),
    setCustomPriceOverride: vi.fn(async () => {}),
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));
vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: vi.fn() } }));
vi.mock('../../core/storage.js', () => ({ default: { getJSON: vi.fn(), setJSON: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: { fetch: vi.fn(), isLoaded: vi.fn(() => true) } }));
vi.mock('../settings/custom-price-overrides.js', () => ({
    getCustomPrice: (...args) => mocks.getCustomPrice(...args),
    getCustomPriceOverrides: (...args) => mocks.getCustomPriceOverrides(...args),
    setCustomPriceOverride: (...args) => mocks.setCustomPriceOverride(...args),
}));
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
        philoCalculator.catalystHrid = '';
        philoCalculator.useCatalyticTea = false;
        philoCalculator.philoPrice = 1000;
        philoCalculator.philoPriceIsOutlier = false;
        philoCalculator.catalystPrice = 0;
        philoCalculator.catalystPriceIsOutlier = false;
        mocks.getCustomPrice.mockReturnValue(null);
        mocks.getCustomPriceOverrides.mockReturnValue({});
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 500, isOutlier: false });
    });

    test('loadDefaultPrices stores isOutlier flags for philo and catalyst prices', () => {
        philoCalculator.catalystHrid = '/items/prime_catalyst';
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
        philoCalculator.catalystHrid = '/items/prime_catalyst';
        philoCalculator.catalystPriceIsOutlier = true;

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(true);
    });

    test('ignores a substituted catalyst price when the catalyst is not being used', () => {
        philoCalculator.catalystHrid = '';
        philoCalculator.catalystPriceIsOutlier = true;

        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(false);
    });

    test('does not flag a row when nothing was substituted', () => {
        const row = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(row.isOutlier).toBe(false);
    });
});

describe('PhiloCalculator - catalyst choice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        philoCalculator.useCatalyticTea = false;
        philoCalculator.philoPrice = 1000;
        philoCalculator.catalystPrice = 0;
        philoCalculator.catalystPriceIsOutlier = false;
        mocks.getCustomPrice.mockReturnValue(null);
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 500, isOutlier: false });
    });

    test('each catalyst adds its own success bonus', () => {
        philoCalculator.catalystHrid = '';
        const none = philoCalculator.calculateRow('/items/ore', itemDetails());
        philoCalculator.catalystHrid = '/items/catalyst_of_transmutation';
        const transmutation = philoCalculator.calculateRow('/items/ore', itemDetails());
        philoCalculator.catalystHrid = '/items/prime_catalyst';
        const prime = philoCalculator.calculateRow('/items/ore', itemDetails());

        expect(none.effectiveTransmuteChance).toBeCloseTo(0.5);
        expect(transmutation.effectiveTransmuteChance).toBeCloseTo(0.5 * 1.15);
        expect(prime.effectiveTransmuteChance).toBeCloseTo(0.5 * 1.25);
    });

    test('loadDefaultPrices prices the selected catalyst, and nothing when none is chosen', () => {
        philoCalculator.catalystHrid = '/items/catalyst_of_transmutation';
        philoCalculator.loadDefaultPrices();
        expect(mocks.getItemPriceOutlierInfo).toHaveBeenCalledWith('/items/catalyst_of_transmutation', {
            mode: 'ask',
        });

        mocks.getItemPriceOutlierInfo.mockClear();
        philoCalculator.catalystHrid = '';
        philoCalculator.loadDefaultPrices();
        expect(mocks.getItemPriceOutlierInfo).not.toHaveBeenCalledWith('', expect.anything());
        expect(philoCalculator.catalystPrice).toBe(0);
    });
});

describe('PhiloCalculator - untradable items and editable cost', () => {
    const noPrice = { value: null, isOutlier: false };

    beforeEach(() => {
        vi.clearAllMocks();
        philoCalculator.catalystHrid = '';
        philoCalculator.useCatalyticTea = false;
        philoCalculator.philoPrice = 1000;
        mocks.getCustomPrice.mockReturnValue(null);
        mocks.getCustomPriceOverrides.mockReturnValue({});
        mocks.getItemPriceOutlierInfo.mockImplementation((hrid, opts) =>
            hrid === '/items/cape' && opts.mode === 'ask' ? noPrice : { value: 500, isOutlier: false }
        );
    });

    test('an untradable item with no price is kept, with cost-derived figures blank', () => {
        const row = philoCalculator.calculateRow('/items/cape', itemDetails({ isTradable: undefined }));

        expect(row.needsPrice).toBe(true);
        expect(row.cost).toBeNull();
        expect(row.profitPerPhilo).toBeNull();
        expect(row.profitPerHour).toBeNull();
        expect(row.ev).toBeGreaterThan(0);
    });

    test('a tradable item with no market data is still dropped', () => {
        expect(philoCalculator.calculateRow('/items/cape', itemDetails({ isTradable: true }))).toBeNull();
    });

    test('a custom price makes the item a normal priced row', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 2000, isOutlier: false });
        mocks.getCustomPrice.mockReturnValue(2000);

        const row = philoCalculator.calculateRow('/items/cape', itemDetails({ isTradable: undefined }));

        expect(row.needsPrice).toBe(false);
        expect(row.cost).toBe(2000);
        expect(row.hasCustomCost).toBe(true);
        expect(row.profitPerPhilo).not.toBeNull();
    });

    test('unpriced rows sort last in both directions', () => {
        philoCalculator.sortColumn = 'profitPerPhilo';
        philoCalculator.rows = [
            { name: 'a', profitPerPhilo: null },
            { name: 'b', profitPerPhilo: 5 },
            { name: 'c', profitPerPhilo: 9 },
        ];
        philoCalculator.sortDirection = 'desc';
        philoCalculator.sortRows();
        expect(philoCalculator.rows.map((r) => r.name)).toEqual(['c', 'b', 'a']);
        philoCalculator.sortDirection = 'asc';
        philoCalculator.sortRows();
        expect(philoCalculator.rows.map((r) => r.name)).toEqual(['b', 'c', 'a']);
    });

    test('typing a cost saves a sell override and keeps an existing buy price', async () => {
        mocks.getCustomPriceOverrides.mockReturnValue({ '/items/cape:0': { buy: 7 } });
        const recalc = vi.spyOn(philoCalculator, 'recalculate').mockImplementation(() => {});

        await philoCalculator.setItemCost('/items/cape', '1,500,000');

        expect(mocks.setCustomPriceOverride).toHaveBeenCalledWith('/items/cape', 0, 7, 1500000);
        expect(recalc).toHaveBeenCalled();
        recalc.mockRestore();
    });

    test('clearing the cost removes the sell override; junk input is ignored', async () => {
        const recalc = vi.spyOn(philoCalculator, 'recalculate').mockImplementation(() => {});
        const render = vi.spyOn(philoCalculator, 'renderTable').mockImplementation(() => {});

        await philoCalculator.setItemCost('/items/cape', '  ');
        expect(mocks.setCustomPriceOverride).toHaveBeenCalledWith('/items/cape', 0, null, null);

        mocks.setCustomPriceOverride.mockClear();
        await philoCalculator.setItemCost('/items/cape', 'abc');
        expect(mocks.setCustomPriceOverride).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalled();
        recalc.mockRestore();
        render.mockRestore();
    });
});
