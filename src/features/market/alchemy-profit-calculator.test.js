import { beforeEach, describe, expect, test, vi } from 'vitest';
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

describe('calculateUnrefineProfit', () => {
    const REFINED_ITEM = '/items/test_refined_item';
    const BASE_ITEM = '/items/test_base_item';
    const SHARD_ITEM = '/items/test_refinement_shard';
    const TEA_ITEM = '/items/test_alchemy_success_tea';

    function setup({ bulkMultiplier = 1, shardReturn = { itemHrid: SHARD_ITEM, count: 3 } } = {}) {
        const itemDetailMap = {
            [REFINED_ITEM]: {
                itemLevel: 10,
                alchemyDetail: {
                    bulkMultiplier,
                    unrefineDetail: { baseItemHrid: BASE_ITEM, shardReturn },
                },
            },
        };
        const actionDetailMap = {
            '/actions/alchemy/unrefine': {
                type: '/action_types/alchemy',
                baseTimeCost: 20e9,
                levelRequirement: { level: 1 },
            },
        };

        dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[REFINED_ITEM]);
        dataManagerMock.getSkills.mockReturnValue([{ skillHrid: '/skills/alchemy', level: 10 }]);

        marketPrices[REFINED_ITEM] = 1000;
        marketPrices[BASE_ITEM] = 400;
        marketPrices[SHARD_ITEM] = 20;
    }

    test('returns null for an item with no unrefineDetail (not a refined item)', () => {
        dataManagerMock.getInitClientData.mockReturnValue({
            itemDetailMap: { [REFINED_ITEM]: { itemLevel: 10, alchemyDetail: {} } },
            actionDetailMap: {},
        });
        dataManagerMock.getItemDetails.mockReturnValue({ itemLevel: 10, alchemyDetail: {} });

        expect(alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 5, false, 0)).toBeNull();
    });

    test('success rate is a fixed 100%, unaffected by a tea bonus that can only clamp back to the same max', () => {
        setup();

        const noTea = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0);
        const withTea = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0.5);

        expect(noTea.successRate).toBe(1);
        expect(withTea.successRate).toBe(1);
    });

    test('outputs the base item plus refinement shards, valued after market tax', () => {
        setup();

        const profit = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0);

        const baseDrop = profit.dropRevenues.find((d) => d.itemHrid === BASE_ITEM);
        const shardDrop = profit.dropRevenues.find((d) => d.itemHrid === SHARD_ITEM);
        expect(baseDrop.count).toBe(1);
        expect(baseDrop.price).toBe(400);
        expect(shardDrop.count).toBe(3);
        expect(shardDrop.price).toBe(20);
        // 100% success rate, so revenuePerAttempt = full after-tax value.
        expect(profit.incomePerAttempt).toBeCloseTo(400 * (1 - MARKET_TAX) + 3 * 20 * (1 - MARKET_TAX), 8);
    });

    test('with no shardReturn, only the base item is produced', () => {
        setup({ shardReturn: null });

        const profit = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0);

        expect(profit.dropRevenues.some((d) => d.itemHrid === SHARD_ITEM)).toBe(false);
        expect(profit.dropRevenues.some((d) => d.itemHrid === BASE_ITEM)).toBe(true);
    });

    test('bulkMultiplier scales the consumed input but NOT the base item/shard output (equipment is never bulk-processed)', () => {
        setup({ bulkMultiplier: 3 });

        const profit = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0);

        expect(profit.requirementCosts[0]).toMatchObject({ itemHrid: REFINED_ITEM, count: 3, costPerAction: 3000 });
        const baseDrop = profit.dropRevenues.find((d) => d.itemHrid === BASE_ITEM);
        const shardDrop = profit.dropRevenues.find((d) => d.itemHrid === SHARD_ITEM);
        expect(baseDrop.count).toBe(1); // not 3
        expect(shardDrop.count).toBe(3); // shardReturn's own count, not scaled by bulk (also 3)
    });

    test('a live/override alchemy_success tea is still deducted as a real cost, even though it cannot improve the already-maxed success rate', () => {
        setup();
        marketPrices[TEA_ITEM] = 1000;
        const context = { equipment: new Map(), drinks: [{ itemHrid: TEA_ITEM }] };

        const withoutTea = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0, context);
        const withTea = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0.5, context);

        expect(withoutTea.totalTeaCostPerHour).toBe(0);
        expect(withTea.totalTeaCostPerHour).toBeGreaterThan(0);
        // Same success rate (both 1.0), but the tea-drinking scenario is strictly worse by
        // exactly its own cost - never silently credited as if it helped.
        expect(withTea.profitPerHour).toBeCloseTo(withoutTea.profitPerHour - withTea.totalTeaCostPerHour, 6);
    });

    test('a missing market price for the consumed refined item returns null', () => {
        setup();
        delete marketPrices[REFINED_ITEM];

        expect(alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0)).toBeNull();
    });

    test('a missing market price for the produced base item returns null', () => {
        setup();
        delete marketPrices[BASE_ITEM];

        expect(alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0)).toBeNull();
    });

    test('has no catalyst - catalystCost/catalystPrice are explicitly zeroed, not a fabricated non-null value', () => {
        setup();

        const profit = alchemyProfitCalculator.calculateUnrefineProfit(REFINED_ITEM, 0, false, 0);

        expect(profit.catalystCost.itemHrid).toBeNull();
        expect(profit.catalystPrice).toBe(0);
        expect(profit.catalystCostPerHour).toBe(0);
    });
});

describe('actionContext atomicity for Coinify/Decompose/Transmute (TLA-027)', () => {
    // The Current Action Bar passes an explicit {equipment, drinks} context (resolveCurrentActionContext)
    // so these calculators must use it instead of independently reading dataManager's live equipment/drinks -
    // otherwise a caller supplying e.g. saved-loadout equipment could still get live drinks mixed in.
    const COINIFY_ITEM = '/items/test_context_coinify';
    const DECOMPOSE_ITEM = '/items/test_context_decompose';
    const TRANSMUTE_ITEM = '/items/test_context_transmute';
    const CONTEXT = { equipment: new Map(), drinks: [] };

    function baseActionDetailMap() {
        return {
            '/actions/alchemy/coinify': {
                type: '/action_types/alchemy',
                baseTimeCost: 20e9,
                levelRequirement: { level: 1 },
            },
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
    }

    beforeEach(() => {
        dataManagerMock.getEquipment.mockClear();
        dataManagerMock.getActionDrinkSlots.mockClear();
    });

    test('calculateCoinifyProfit uses the supplied actionContext instead of reading live equipment/drinks', () => {
        const itemDetailMap = {
            [COINIFY_ITEM]: { itemLevel: 5, sellPrice: 10, alchemyDetail: { isCoinifiable: true } },
        };
        dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap: baseActionDetailMap() });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[COINIFY_ITEM]);
        marketPrices[COINIFY_ITEM] = 5;

        const profit = alchemyProfitCalculator.calculateCoinifyProfit(COINIFY_ITEM, 0, false, null, CONTEXT);

        expect(profit).not.toBeNull();
        expect(dataManagerMock.getEquipment).not.toHaveBeenCalled();
        expect(dataManagerMock.getActionDrinkSlots).not.toHaveBeenCalled();
    });

    test('calculateDecomposeProfit uses the supplied actionContext instead of reading live equipment/drinks', () => {
        const itemDetailMap = {
            [DECOMPOSE_ITEM]: {
                itemLevel: 5,
                alchemyDetail: { decomposeItems: [{ itemHrid: '/items/output', count: 1 }] },
            },
        };
        dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap: baseActionDetailMap() });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[DECOMPOSE_ITEM]);
        marketPrices[DECOMPOSE_ITEM] = 5;

        const profit = alchemyProfitCalculator.calculateDecomposeProfit(DECOMPOSE_ITEM, 0, false, null, CONTEXT);

        expect(profit).not.toBeNull();
        expect(dataManagerMock.getEquipment).not.toHaveBeenCalled();
        expect(dataManagerMock.getActionDrinkSlots).not.toHaveBeenCalled();
    });

    test('calculateTransmuteProfit uses the supplied actionContext instead of reading live equipment/drinks', () => {
        const itemDetailMap = {
            [TRANSMUTE_ITEM]: {
                itemLevel: 5,
                alchemyDetail: {
                    transmuteDropTable: [{ itemHrid: '/items/output', dropRate: 0.5, minCount: 1, maxCount: 1 }],
                    transmuteSuccessRate: 0.5,
                },
            },
        };
        dataManagerMock.getInitClientData.mockReturnValue({ itemDetailMap, actionDetailMap: baseActionDetailMap() });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[TRANSMUTE_ITEM]);
        dataManagerMock.getSkills.mockReturnValue([{ skillHrid: '/skills/alchemy', level: 10 }]);
        marketPrices[TRANSMUTE_ITEM] = 5;

        const profit = alchemyProfitCalculator.calculateTransmuteProfit(TRANSMUTE_ITEM, false, null, null, CONTEXT);

        expect(profit).not.toBeNull();
        expect(dataManagerMock.getEquipment).not.toHaveBeenCalled();
        expect(dataManagerMock.getActionDrinkSlots).not.toHaveBeenCalled();
    });

    test('calculateUnrefineProfit uses the supplied actionContext instead of reading live equipment/drinks', () => {
        const UNREFINE_ITEM = '/items/test_context_unrefine';
        const itemDetailMap = {
            [UNREFINE_ITEM]: {
                itemLevel: 5,
                alchemyDetail: { unrefineDetail: { baseItemHrid: '/items/output' } },
            },
        };
        dataManagerMock.getInitClientData.mockReturnValue({
            itemDetailMap,
            actionDetailMap: {
                ...baseActionDetailMap(),
                '/actions/alchemy/unrefine': {
                    type: '/action_types/alchemy',
                    baseTimeCost: 20e9,
                    levelRequirement: { level: 1 },
                },
            },
        });
        dataManagerMock.getItemDetails.mockReturnValue(itemDetailMap[UNREFINE_ITEM]);
        marketPrices[UNREFINE_ITEM] = 5;
        marketPrices['/items/output'] = 5;

        const profit = alchemyProfitCalculator.calculateUnrefineProfit(UNREFINE_ITEM, 0, false, 0, CONTEXT);

        expect(profit).not.toBeNull();
        expect(dataManagerMock.getEquipment).not.toHaveBeenCalled();
        expect(dataManagerMock.getActionDrinkSlots).not.toHaveBeenCalled();
    });
});
