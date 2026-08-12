import { describe, expect, test, vi, beforeEach } from 'vitest';

const initData = { openableLootDropMap: {} };
const itemDetails = {};
const marketPrices = {};
let keyPricingMode = 'ask';
const dropPrices = {};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: () => initData,
        getItemDetails: (itemHrid) => itemDetails[itemHrid],
    },
}));

vi.mock('../../api/marketplace.js', () => ({
    default: { getPrice: (itemHrid) => marketPrices[itemHrid], on: () => {} },
}));

vi.mock('../../core/config.js', () => ({
    default: { getSettingValue: () => keyPricingMode },
}));

vi.mock('../../features/market/expected-value-calculator.js', () => ({
    default: { getDropPrice: (itemHrid) => (itemHrid in dropPrices ? dropPrices[itemHrid] : null) },
}));

vi.mock('../../features/combat-sim/combat-sim-adapter.js', () => ({
    DUNGEON_ENTRY_KEYS: { '/items/chimerical_chest': '/items/chimerical_entry_key' },
    DUNGEON_CHEST_KEYS: {
        '/items/chimerical_chest': '/items/chimerical_chest_key',
        '/items/chimerical_refinement_chest': '/items/chimerical_chest_key',
    },
}));

const { getChestOpenCost, getChestCostBreakdown, drawChestPayout, buildDungeonChestModel } =
    await import('./dungeon-chest-adapter.js');
const { createSeededRng } = await import('../risk-of-ruin-engine.js');

const COIN_HRID = '/items/coin';

function fixedRng(value) {
    return () => value;
}

beforeEach(() => {
    initData.openableLootDropMap = {};
    for (const key of Object.keys(itemDetails)) delete itemDetails[key];
    for (const key of Object.keys(marketPrices)) delete marketPrices[key];
    for (const key of Object.keys(dropPrices)) delete dropPrices[key];
    keyPricingMode = 'ask';
});

describe('getChestOpenCost', () => {
    test('sums entry key + chest key ask price for a regular chest', () => {
        marketPrices['/items/chimerical_entry_key'] = { ask: 1000, bid: 900 };
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };

        expect(getChestOpenCost('/items/chimerical_chest')).toBe(3000);
    });

    test('uses bid price when profitCalc_keyPricingMode is bid', () => {
        keyPricingMode = 'bid';
        marketPrices['/items/chimerical_entry_key'] = { ask: 1000, bid: 900 };
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };

        expect(getChestOpenCost('/items/chimerical_chest')).toBe(2700);
    });

    test('refinement chests have no entry key cost, only a chest key cost', () => {
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };

        expect(getChestOpenCost('/items/chimerical_refinement_chest')).toBe(2000);
    });

    test('is zero for a chest with no known key mapping', () => {
        expect(getChestOpenCost('/items/unmapped_chest')).toBe(0);
    });
});

describe('getChestCostBreakdown', () => {
    test('breaks a regular chest down into entry key + chest key line items', () => {
        marketPrices['/items/chimerical_entry_key'] = { ask: 1000, bid: 900 };
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };
        itemDetails['/items/chimerical_entry_key'] = { name: 'Chimerical Entry Key' };
        itemDetails['/items/chimerical_chest_key'] = { name: 'Chimerical Chest Key' };

        const breakdown = getChestCostBreakdown('/items/chimerical_chest');

        expect(breakdown).toEqual({
            entryKey: { hrid: '/items/chimerical_entry_key', name: 'Chimerical Entry Key', price: 1000 },
            chestKey: { hrid: '/items/chimerical_chest_key', name: 'Chimerical Chest Key', price: 2000 },
            total: 3000,
        });
    });

    test('has a null entryKey for refinement chests', () => {
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };
        itemDetails['/items/chimerical_chest_key'] = { name: 'Chimerical Chest Key' };

        const breakdown = getChestCostBreakdown('/items/chimerical_refinement_chest');

        expect(breakdown.entryKey).toBeNull();
        expect(breakdown.chestKey).toEqual({
            hrid: '/items/chimerical_chest_key',
            name: 'Chimerical Chest Key',
            price: 2000,
        });
        expect(breakdown.total).toBe(2000);
    });

    test('falls back to the hrid as a name when item details are unavailable', () => {
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };

        const breakdown = getChestCostBreakdown('/items/chimerical_refinement_chest');

        expect(breakdown.chestKey.name).toBe('/items/chimerical_chest_key');
    });
});

describe('drawChestPayout', () => {
    test('applies market tax to a triggered, sellable drop at its realized count', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: '/items/widget', dropRate: 1, minCount: 5, maxCount: 5 },
        ];
        itemDetails['/items/widget'] = { isTradable: true };
        dropPrices['/items/widget'] = 100;

        const payout = drawChestPayout('/items/test_chest', fixedRng(0));
        expect(payout).toBeCloseTo(5 * 100 * 0.98, 6);
    });

    test('does not tax coin drops', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: COIN_HRID, dropRate: 1, minCount: 1000, maxCount: 1000 },
        ];
        dropPrices[COIN_HRID] = 1;

        expect(drawChestPayout('/items/test_chest', fixedRng(0))).toBe(1000);
    });

    test('does not tax untradeable drops', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: '/items/soulbound_thing', dropRate: 1, minCount: 3, maxCount: 3 },
        ];
        itemDetails['/items/soulbound_thing'] = { isTradable: false };
        dropPrices['/items/soulbound_thing'] = 50;

        expect(drawChestPayout('/items/test_chest', fixedRng(0))).toBe(150);
    });

    test('contributes nothing when the roll misses the drop rate', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: '/items/widget', dropRate: 0.1, minCount: 5, maxCount: 5 },
        ];
        itemDetails['/items/widget'] = { isTradable: true };
        dropPrices['/items/widget'] = 100;

        // rng() = 0.5 misses a 0.1 drop rate (0.5 >= 0.1)
        expect(drawChestPayout('/items/test_chest', fixedRng(0.5))).toBe(0);
    });

    test('contributes nothing when price data is unavailable', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: '/items/unpriced', dropRate: 1, minCount: 1, maxCount: 1 },
        ];

        expect(drawChestPayout('/items/test_chest', fixedRng(0))).toBe(0);
    });

    test('returns 0 when the container has no drop table', () => {
        expect(drawChestPayout('/items/unknown_chest', fixedRng(0))).toBe(0);
    });

    test('triggers roughly at the drop rate over many draws', () => {
        initData.openableLootDropMap['/items/test_chest'] = [
            { itemHrid: '/items/widget', dropRate: 0.5, minCount: 1, maxCount: 1 },
        ];
        itemDetails['/items/widget'] = { isTradable: true };
        dropPrices['/items/widget'] = 1;

        const rng = createSeededRng(123);
        let triggerCount = 0;
        const samples = 20000;
        for (let i = 0; i < samples; i++) {
            if (drawChestPayout('/items/test_chest', rng) > 0) triggerCount += 1;
        }
        expect(triggerCount / samples).toBeCloseTo(0.5, 1);
    });
});

describe('buildDungeonChestModel', () => {
    test('exposes cost, maxSinglePossibleLoss, and an empirical outcome distribution summing to 1', () => {
        marketPrices['/items/chimerical_entry_key'] = { ask: 1000, bid: 900 };
        marketPrices['/items/chimerical_chest_key'] = { ask: 2000, bid: 1800 };
        initData.openableLootDropMap['/items/chimerical_chest'] = [
            { itemHrid: '/items/widget', dropRate: 0.5, minCount: 1, maxCount: 1 },
        ];
        itemDetails['/items/widget'] = { isTradable: true };
        dropPrices['/items/widget'] = 100;

        const model = buildDungeonChestModel('/items/chimerical_chest', { sampleSize: 1000, rngSeed: 5 });

        expect(model.cost).toBe(3000);
        expect(model.maxSinglePossibleLoss).toBe(3000);
        expect(model.outcomeDistribution).toHaveLength(1000);
        const totalProb = model.outcomeDistribution.reduce((sum, o) => sum + o.prob, 0);
        expect(totalProb).toBeCloseTo(1, 10);
    });

    test('stepFn deducts cost and adds the realized payout for one open', () => {
        marketPrices['/items/chimerical_chest_key'] = { ask: 500, bid: 500 };
        initData.openableLootDropMap['/items/chimerical_refinement_chest'] = [
            { itemHrid: '/items/widget', dropRate: 1, minCount: 2, maxCount: 2 },
        ];
        itemDetails['/items/widget'] = { isTradable: true };
        dropPrices['/items/widget'] = 1000;

        const model = buildDungeonChestModel('/items/chimerical_refinement_chest');
        const nextState = model.stepFn({ balance: 10000 }, fixedRng(0));

        // cost = 500 (chest key only, no entry key for a refinement chest)
        // payout = 2 * 1000 * 0.98 = 1960
        expect(nextState.balance).toBeCloseTo(10000 - 500 + 1960, 6);
    });
});
