import { describe, expect, test, vi } from 'vitest';

const marketPrices = {};

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: (hrid) => (hrid in marketPrices ? marketPrices[hrid] : null),
}));

vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: () => null, on: () => {} } }));
vi.mock('./expected-value-calculator.js', () => ({ default: {} }));

const { default: alchemyProfitCalculator } = await import('./alchemy-profit-calculator.js');

function baseParams(overrides = {}) {
    return {
        actionType: 'transmute',
        baseSuccessRate: 0.5,
        actionsPerHour: 100,
        efficiencyDecimal: 0,
        actionTime: 20,
        alchemyBonusRevenue: 0,
        computeNetProfit: (successRate) => 1000 * successRate,
        computeTeaCost: () => 0,
        teaBonusOverride: 0, // avoid needing to mock getAlchemySuccessBonus
        ...overrides,
    };
}

describe('_forcedCatalystCombo', () => {
    test('"none" applies no catalyst bonus or cost regardless of price data', () => {
        marketPrices['/items/catalyst_of_transmutation'] = 5000;
        marketPrices['/items/prime_catalyst'] = 50000;

        const combo = alchemyProfitCalculator._forcedCatalystCombo(baseParams({ catalystChoice: 'none' }));

        expect(combo.catalystHrid).toBeNull();
        expect(combo.catalystBonus).toBe(0);
        expect(combo.catalystPrice).toBe(0);
        expect(combo.successRateBreakdown.total).toBe(0.5); // unmodified base rate
    });

    test('"typeSpecific" forces the type-specific catalyst for the given actionType', () => {
        marketPrices['/items/catalyst_of_transmutation'] = 5000;

        const combo = alchemyProfitCalculator._forcedCatalystCombo(baseParams({ catalystChoice: 'typeSpecific' }));

        expect(combo.catalystHrid).toBe('/items/catalyst_of_transmutation');
        expect(combo.catalystBonus).toBe(0.15);
        expect(combo.catalystPrice).toBe(5000);
        expect(combo.successRateBreakdown.total).toBeCloseTo(0.5 * 1.15, 10);
    });

    test('"prime" forces the prime catalyst regardless of actionType', () => {
        marketPrices['/items/prime_catalyst'] = 50000;

        const combo = alchemyProfitCalculator._forcedCatalystCombo(baseParams({ catalystChoice: 'prime' }));

        expect(combo.catalystHrid).toBe('/items/prime_catalyst');
        expect(combo.catalystBonus).toBe(0.25);
        expect(combo.catalystPrice).toBe(50000);
        expect(combo.successRateBreakdown.total).toBeCloseTo(0.5 * 1.25, 10);
    });

    test('catalyst cost is charged per attempt scaled by the resulting success rate', () => {
        marketPrices['/items/prime_catalyst'] = 1000;

        const combo = alchemyProfitCalculator._forcedCatalystCombo(baseParams({ catalystChoice: 'prime' }));

        // successRate = 0.5 * 1.25 = 0.625; catalystCostPerAttempt = price * successRate
        expect(combo.catalystCostPerAttempt).toBeCloseTo(1000 * 0.625, 10);
    });

    test('does not choose a catalyst just because it is not the most profitable one', () => {
        // A forced "none" choice must be honored even when a catalyst would clearly be more
        // profitable - this method never searches for the best option, unlike _bestCatalystCombo.
        marketPrices['/items/prime_catalyst'] = 1; // trivially cheap, would win any search
        const combo = alchemyProfitCalculator._forcedCatalystCombo(
            baseParams({ catalystChoice: 'none', computeNetProfit: () => 1_000_000 })
        );

        expect(combo.catalystHrid).toBeNull();
    });
});
