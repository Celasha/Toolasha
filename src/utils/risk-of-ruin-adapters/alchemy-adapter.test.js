import { describe, expect, test, vi } from 'vitest';

let mockProfit = null;

vi.mock('../../features/market/alchemy-profit-calculator.js', () => ({
    default: { calculateTransmuteProfit: () => mockProfit },
}));

const { buildAlchemyTransmuteModel } = await import('./alchemy-adapter.js');

function baseProfit(overrides = {}) {
    return {
        successRate: 0.5,
        grossMaterialCost: 1000,
        requirementCosts: [],
        catalystPrice: 0,
        incomePerAttempt: 300, // expectedOutputValue(600) * successRate(0.5)
        selfReturnValue: 0,
        ...overrides,
    };
}

describe('buildAlchemyTransmuteModel', () => {
    test('returns null when the item is not transmutable (no profit data)', () => {
        mockProfit = null;
        expect(buildAlchemyTransmuteModel('/items/not_transmutable')).toBeNull();
    });

    test('returns null when success rate is zero', () => {
        mockProfit = baseProfit({ successRate: 0 });
        expect(buildAlchemyTransmuteModel('/items/impossible')).toBeNull();
    });

    test('splits into a success/fail two-outcome distribution with materials lost on both', () => {
        mockProfit = baseProfit();
        const model = buildAlchemyTransmuteModel('/items/widget');

        expect(model.cost).toBe(1000);
        expect(model.outcomeDistribution).toEqual([
            { prob: 0.5, net: -1000 + 600 }, // success: -materials + output value given success
            { prob: 0.5, net: -1000 }, // failure: -materials only
        ]);
    });

    test('includes a direct coin line item in the per-attempt cost charged on both branches', () => {
        mockProfit = baseProfit({ requirementCosts: [{ itemHrid: '/items/coin', costPerAction: 50 }] });
        const model = buildAlchemyTransmuteModel('/items/widget');

        expect(model.cost).toBe(1050);
        expect(model.outcomeDistribution[0].net).toBe(-1050 + 600);
        expect(model.outcomeDistribution[1].net).toBe(-1050);
    });

    test('charges catalyst cost only on the success branch', () => {
        mockProfit = baseProfit({ catalystPrice: 200 });
        const model = buildAlchemyTransmuteModel('/items/widget');

        expect(model.outcomeDistribution[0].net).toBe(-1000 - 200 + 600); // success pays catalyst
        expect(model.outcomeDistribution[1].net).toBe(-1000); // failure does not
    });

    test('un-blends the hourly-scaled self-return value back to a given-success amount', () => {
        // selfReturnValue is already successRate-scaled by the real calculator: 0.4 * 100 = 40
        mockProfit = baseProfit({ successRate: 0.4, incomePerAttempt: 240, selfReturnValue: 40 });
        const model = buildAlchemyTransmuteModel('/items/widget');

        // outputValueGivenSuccess = 240 / 0.4 = 600; selfReturnGivenSuccess = 40 / 0.4 = 100
        expect(model.outcomeDistribution[0].net).toBeCloseTo(-1000 + 600 + 100, 6);
    });

    test('maxSinglePossibleLoss is the worst-case branch even when the success branch is the bigger loss', () => {
        // Expensive catalyst with a tiny output value makes success worse than failure.
        mockProfit = baseProfit({ catalystPrice: 5000, incomePerAttempt: 5 });
        const model = buildAlchemyTransmuteModel('/items/widget');

        const [successOutcome, failOutcome] = model.outcomeDistribution;
        expect(-successOutcome.net).toBeGreaterThan(-failOutcome.net);
        expect(model.maxSinglePossibleLoss).toBeCloseTo(-successOutcome.net, 6);
    });

    test('stepFn resolves via the outcome distribution using the supplied rng', () => {
        mockProfit = baseProfit();
        const model = buildAlchemyTransmuteModel('/items/widget');

        const successState = model.stepFn({ balance: 10000 }, () => 0);
        expect(successState.balance).toBe(10000 - 1000 + 600);

        const failState = model.stepFn({ balance: 10000 }, () => 0.99);
        expect(failState.balance).toBe(10000 - 1000);
    });
});
