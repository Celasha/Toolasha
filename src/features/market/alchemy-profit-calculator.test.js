import { describe, expect, test, vi } from 'vitest';
import { MARKET_TAX } from '../../utils/profit-constants.js';

const marketPrices = {};

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: (hrid) => (hrid in marketPrices ? marketPrices[hrid] : null),
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
vi.mock('../../core/config.js', () => ({ default: { getSettingValue: (_key, def) => def, getSetting: () => false } }));
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

describe('calculateDecomposeProfit', () => {
    // Some raw materials (e.g. Holy Milk) consume more than one copy of the item per decompose
    // action - alchemyDetail.bulkMultiplier. Regression coverage for the bug where that
    // multiplier was applied everywhere else (Coinify, Transmute) but silently dropped here,
    // undercounting both material cost and decompose output by the multiplier's factor.
    const ITEM_HRID = '/items/test_bulk_resource';
    const OUTPUT_HRID = '/items/test_bulk_essence';

    function setup({ bulkMultiplier }) {
        const itemDetailMap = {
            [ITEM_HRID]: {
                itemLevel: 10,
                sellPrice: 40,
                alchemyDetail: {
                    bulkMultiplier,
                    decomposeItems: [{ itemHrid: OUTPUT_HRID, count: 10 }],
                },
            },
        };
        const actionDetailMap = {
            '/actions/alchemy/decompose': {
                type: '/action_types/alchemy',
                baseTimeCost: 20e9,
                levelRequirement: { level: 1 },
            },
        };

        dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[ITEM_HRID]);
        dataManagerMock.getSkills.mockReturnValue([{ skillHrid: '/skills/alchemy', level: 10 }]);

        marketPrices[ITEM_HRID] = 1000;
        marketPrices[OUTPUT_HRID] = 500;
        // Priced high enough that no catalyst ever wins the profit-maximizing search below,
        // keeping successRate pinned at the base 60% so the math stays exact and simple.
        marketPrices['/items/catalyst_of_decomposition'] = 1e9;
        marketPrices['/items/prime_catalyst'] = 1e9;
    }

    test('scales material cost by bulkMultiplier (2 items consumed per action)', () => {
        setup({ bulkMultiplier: 2 });

        const profit = alchemyProfitCalculator.calculateDecomposeProfit(ITEM_HRID, 0, false, 0);

        expect(profit.successRate).toBe(0.6); // base decompose rate, no catalyst/tea won
        expect(profit.requirementCosts[0]).toMatchObject({
            itemHrid: ITEM_HRID,
            count: 2,
            price: 1000,
            costPerAction: 2000, // 1000 × 2, not 1000
        });
        expect(profit.materialCost).toBe(2000);
    });

    test('scales decompose output by bulkMultiplier (20 essence, not 10)', () => {
        setup({ bulkMultiplier: 2 });

        const profit = alchemyProfitCalculator.calculateDecomposeProfit(ITEM_HRID, 0, false, 0);

        const outputDrop = profit.dropRevenues.find((d) => d.itemHrid === OUTPUT_HRID);
        expect(outputDrop.count).toBe(20); // 10 × 2, not 10
        // afterTax(500) × 20 × successRate(0.6)
        expect(outputDrop.revenuePerAttempt).toBeCloseTo(500 * (1 - MARKET_TAX) * 20 * 0.6, 8);
    });

    test('bulkMultiplier of 1 leaves cost and output unscaled (regular equipment/items)', () => {
        setup({ bulkMultiplier: 1 });

        const profit = alchemyProfitCalculator.calculateDecomposeProfit(ITEM_HRID, 0, false, 0);

        expect(profit.requirementCosts[0]).toMatchObject({ count: 1, costPerAction: 1000 });
        const outputDrop = profit.dropRevenues.find((d) => d.itemHrid === OUTPUT_HRID);
        expect(outputDrop.count).toBe(10);
    });
});
