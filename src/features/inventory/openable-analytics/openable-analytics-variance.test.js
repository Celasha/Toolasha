import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn(() => ({ isTradable: true })),
        getInitClientData: vi.fn(() => ({ openableLootDropMap: {} })),
    },
}));
vi.mock('../../market/expected-value-calculator.js', () => ({
    default: {
        COIN_HRID: '/items/coin',
        resolveSellSideValue: vi.fn(),
    },
}));

const { default: dataManager } = await import('../../../core/data-manager.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const { calculatePerOpeningVariance, calculateIncomeStdDev } = await import('./openable-analytics-variance.js');

beforeEach(() => {
    vi.clearAllMocks();
    dataManager.getItemDetails.mockReturnValue({ isTradable: true });
    dataManager.getInitClientData.mockReturnValue({ openableLootDropMap: {} });
});

describe('calculatePerOpeningVariance', () => {
    test('returns null when the container has no drop table to model', () => {
        expect(calculatePerOpeningVariance('/items/unknown_box')).toBeNull();
    });

    test('a guaranteed drop with a fixed count contributes zero variance', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 1, minCount: 5, maxCount: 5 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10 });

        expect(calculatePerOpeningVariance('/items/box')).toBe(0);
    });

    test('a coin-flip drop with a fixed count contributes variance from the Bernoulli occurrence, taxed', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 0.5, minCount: 10, maxCount: 10 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100 });

        // perUnit = 100 * 0.95 = 95; Var = 95^2 * (0.5*0 + 0.5*0.5*10^2) = 9025 * 25 = 225625
        expect(calculatePerOpeningVariance('/items/box')).toBeCloseTo(225625);
    });

    test('a guaranteed drop with a variable count contributes variance from the count spread alone', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 1, minCount: 0, maxCount: 2 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10 });

        // perUnit = 10 * 0.95 = 9.5; n=3, Var[Q] = (9-1)/12 = 0.6667
        // Var = 9.5^2 * (1*0.6667 + 1*0*1) ≈ 60.17
        expect(calculatePerOpeningVariance('/items/box')).toBeCloseTo(60.17, 1);
    });

    test('coin drops are never taxed', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/coin', dropRate: 0.5, minCount: 10, maxCount: 10 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 1 });

        // perUnit = 1 (no tax); Var = 1^2 * (0.5*0.5*100) = 25
        expect(calculatePerOpeningVariance('/items/box')).toBeCloseTo(25);
    });

    test('non-tradable items are never taxed', () => {
        dataManager.getItemDetails.mockReturnValue({ isTradable: false });
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 0.5, minCount: 10, maxCount: 10 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100 });

        // perUnit = 100 (no tax); Var = 100^2 * (0.5*0.5*100) = 250000
        expect(calculatePerOpeningVariance('/items/box')).toBeCloseTo(250000);
    });

    test('an unpriced drop contributes zero variance rather than throwing', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/mystery', dropRate: 0.5, minCount: 1, maxCount: 1 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue(null);

        expect(calculatePerOpeningVariance('/items/box')).toBe(0);
    });

    test('sums variance across multiple independent drop table rows', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [
                    { itemHrid: '/items/gem', dropRate: 0.5, minCount: 10, maxCount: 10 },
                    { itemHrid: '/items/coin', dropRate: 0.5, minCount: 10, maxCount: 10 },
                ],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockImplementation((hrid) =>
            hrid === '/items/coin' ? { value: 1 } : { value: 100 }
        );

        // 225625 (gem, taxed) + 25 (coin, untaxed)
        expect(calculatePerOpeningVariance('/items/box')).toBeCloseTo(225650);
    });
});

describe('calculateIncomeStdDev', () => {
    test('scales with the square root of container count (variance is additive over i.i.d. openings)', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 0.5, minCount: 10, maxCount: 10 }],
            },
        });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100 });

        const oneOpening = calculateIncomeStdDev('/items/box', 1);
        const fourOpenings = calculateIncomeStdDev('/items/box', 4);

        expect(oneOpening).toBeCloseTo(475);
        expect(fourOpenings).toBeCloseTo(950);
    });

    test('returns null when there is no drop table to model', () => {
        expect(calculateIncomeStdDev('/items/unknown_box', 10)).toBeNull();
    });

    test('returns null for a non-positive container count', () => {
        dataManager.getInitClientData.mockReturnValue({
            openableLootDropMap: {
                '/items/box': [{ itemHrid: '/items/gem', dropRate: 0.5, minCount: 10, maxCount: 10 }],
            },
        });

        expect(calculateIncomeStdDev('/items/box', 0)).toBeNull();
    });
});
