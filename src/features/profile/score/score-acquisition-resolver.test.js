import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: null,
    askPrices: {}, // itemHrid -> ask
    shopCoinCosts: {}, // itemHrid -> coin cost
    specialCurrencyCosts: {}, // itemHrid -> {cost, complete}
    getSpecialCurrencyCallCount: {},
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => mocks.gameData),
        getEquipment: vi.fn(() => new Map()),
        getActionDrinkSlots: vi.fn(() => []),
    },
}));

vi.mock('../../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => mocks.askPrices[itemHrid] ?? -1),
}));

vi.mock('../../../utils/game-lookups.js', () => ({
    getShopCoinCost: vi.fn((itemHrid) => mocks.shopCoinCosts[itemHrid] ?? 0),
}));

vi.mock('./special-currency-valuation.js', () => ({
    getSpecialCurrencyAcquisitionCost: vi.fn((itemHrid) => {
        mocks.getSpecialCurrencyCallCount[itemHrid] = (mocks.getSpecialCurrencyCallCount[itemHrid] || 0) + 1;
        return mocks.specialCurrencyCosts[itemHrid] ?? { cost: null, complete: false };
    }),
}));

import {
    createAcquisitionContext,
    resolveItemAcquisitionCost,
    resolvePerAttemptMaterialCost,
} from './score-acquisition-resolver.js';
import { getSpecialCurrencyAcquisitionCost } from './special-currency-valuation.js';

const COIN = '/items/coin';

function resetMocks() {
    mocks.askPrices = {};
    mocks.shopCoinCosts = {};
    mocks.specialCurrencyCosts = {};
    mocks.getSpecialCurrencyCallCount = {};
    mocks.gameData = { itemDetailMap: {}, actionDetailMap: {} };
    getSpecialCurrencyAcquisitionCost.mockClear();
}

/** Register a production action: `itemHrid` <- inputs (+ optional upgradeItemHrid), producing `outputCount`. */
function addAction(hrid, itemHrid, inputItems, { upgradeItemHrid = '', outputCount = 1 } = {}) {
    mocks.gameData.actionDetailMap[hrid] = {
        type: '/action_types/crafting',
        inputItems,
        upgradeItemHrid,
        outputItems: [{ itemHrid, count: outputCount }],
    };
}

describe('resolveItemAcquisitionCost - TLA041E-20: minimum across every complete route', () => {
    beforeEach(resetMocks);

    test('special-currency, ask, shop coin cost, and craft candidates all compete; cheapest complete wins', () => {
        const ITEM = '/items/widget';
        mocks.specialCurrencyCosts[ITEM] = { cost: 500, complete: true };
        mocks.askPrices[ITEM] = 300; // cheapest
        mocks.shopCoinCosts[ITEM] = 400;
        addAction('/actions/make_widget', ITEM, [{ itemHrid: '/items/ore', count: 1 }]);
        mocks.askPrices['/items/ore'] = 1000; // craft route = 1000, not cheapest

        const result = resolveItemAcquisitionCost(ITEM, createAcquisitionContext());
        expect(result).toEqual({ cost: 300, complete: true });
    });

    test('with no ask/shop/special route, a fully-priced craft recipe wins on its own', () => {
        const ITEM = '/items/widget';
        addAction('/actions/make_widget', ITEM, [
            { itemHrid: '/items/ore', count: 2 },
            { itemHrid: COIN, count: 50 },
        ]);
        mocks.askPrices['/items/ore'] = 1000;

        const result = resolveItemAcquisitionCost(ITEM, createAcquisitionContext());
        expect(result).toEqual({ cost: 2050, complete: true }); // 2*1000 + 50 coin
    });

    test('no candidate resolves anywhere -> incomplete, never zero', () => {
        const result = resolveItemAcquisitionCost('/items/unobtainium', createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveItemAcquisitionCost - TLA041E-19: completeness-aware crafting (Pathbreaker Boots shape)', () => {
    beforeEach(resetMocks);

    test('a mixed recipe with an unpriced special-currency leg is wholly incomplete, never dropping just that leg (never a false-complete positive number)', () => {
        const BOOTS = '/items/pathbreaker_boots';
        addAction('/actions/pathbreaker_boots', BOOTS, [
            { itemHrid: '/items/pathbreaker_lodestone', count: 10 },
            { itemHrid: '/items/holy_boots', count: 30 },
            { itemHrid: '/items/black_bear_shoes', count: 4 },
        ]);
        // Ordinary materials ARE priced...
        mocks.askPrices['/items/holy_boots'] = 1_000_000;
        mocks.askPrices['/items/black_bear_shoes'] = 500_000;
        // ...but the Lodestone (a special-currency material) has no priced route anywhere.
        // mocks.specialCurrencyCosts['/items/pathbreaker_lodestone'] left unset -> incomplete.

        const result = resolveItemAcquisitionCost(BOOTS, createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('once every leg (including the special-currency Lodestones) prices completely, the full mixed total is used', () => {
        const BOOTS = '/items/pathbreaker_boots';
        addAction('/actions/pathbreaker_boots', BOOTS, [
            { itemHrid: '/items/pathbreaker_lodestone', count: 10 },
            { itemHrid: '/items/holy_boots', count: 30 },
        ]);
        mocks.askPrices['/items/holy_boots'] = 1_000_000; // 30 * 1M = 30,000,000
        mocks.specialCurrencyCosts['/items/pathbreaker_lodestone'] = { cost: 20_000, complete: true }; // 10 * 20,000 = 200,000

        const result = resolveItemAcquisitionCost(BOOTS, createAcquisitionContext());
        expect(result).toEqual({ cost: 30_200_000, complete: true });
    });

    test('a missing ordinary (non-currency) input also fails the whole candidate closed, not just the currency leg', () => {
        const BOOTS = '/items/pathbreaker_boots';
        addAction('/actions/pathbreaker_boots', BOOTS, [
            { itemHrid: '/items/pathbreaker_lodestone', count: 10 },
            { itemHrid: '/items/holy_boots', count: 30 }, // no ask set -> unpriced ordinary leg
        ]);
        mocks.specialCurrencyCosts['/items/pathbreaker_lodestone'] = { cost: 20_000, complete: true };

        const result = resolveItemAcquisitionCost(BOOTS, createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveItemAcquisitionCost - TLA041E-06/07/08: Task Badge crafting chain', () => {
    beforeEach(resetMocks);

    test('TLA041E-06: Basic Task Badge = 1 Task Crystal, resolved through the special-currency route', () => {
        addAction('/actions/basic_task_badge', '/items/basic_task_badge', [
            { itemHrid: '/items/task_crystal', count: 1 },
        ]);
        mocks.specialCurrencyCosts['/items/task_crystal'] = { cost: 5000, complete: true };

        const result = resolveItemAcquisitionCost('/items/basic_task_badge', createAcquisitionContext());
        expect(result).toEqual({ cost: 5000, complete: true });
    });

    test('TLA041E-07: Advanced Task Badge = Basic Task Badge (upgrade) + 4 Task Crystals, never just the 4 crystals', () => {
        addAction('/actions/basic_task_badge', '/items/basic_task_badge', [
            { itemHrid: '/items/task_crystal', count: 1 },
        ]);
        addAction(
            '/actions/advanced_task_badge',
            '/items/advanced_task_badge',
            [{ itemHrid: '/items/task_crystal', count: 4 }],
            { upgradeItemHrid: '/items/basic_task_badge' }
        );
        mocks.specialCurrencyCosts['/items/task_crystal'] = { cost: 5000, complete: true };

        const result = resolveItemAcquisitionCost('/items/advanced_task_badge', createAcquisitionContext());
        // Basic Badge (upgrade item) = 1 crystal = 5000; + 4 more crystals = 20,000; total = 25,000
        expect(result).toEqual({ cost: 25_000, complete: true });
    });

    test('TLA041E-08: Expert Task Badge includes the full 21-crystal-from-scratch chain (Basic->Advanced->Expert)', () => {
        addAction('/actions/basic_task_badge', '/items/basic_task_badge', [
            { itemHrid: '/items/task_crystal', count: 1 },
        ]);
        addAction(
            '/actions/advanced_task_badge',
            '/items/advanced_task_badge',
            [{ itemHrid: '/items/task_crystal', count: 4 }],
            { upgradeItemHrid: '/items/basic_task_badge' }
        );
        addAction(
            '/actions/expert_task_badge',
            '/items/expert_task_badge',
            [{ itemHrid: '/items/task_crystal', count: 16 }],
            { upgradeItemHrid: '/items/advanced_task_badge' }
        );
        mocks.specialCurrencyCosts['/items/task_crystal'] = { cost: 5000, complete: true };

        const result = resolveItemAcquisitionCost('/items/expert_task_badge', createAcquisitionContext());
        expect(result).toEqual({ cost: 21 * 5000, complete: true }); // 1 + 4 + 16 = 21 crystals total
    });

    test('TLA041E-10: with no priceable Task Token opportunity anchor, Task Badge stays incomplete, never zero', () => {
        addAction('/actions/basic_task_badge', '/items/basic_task_badge', [
            { itemHrid: '/items/task_crystal', count: 1 },
        ]);
        // mocks.specialCurrencyCosts left empty -> Task Crystal itself unpriced.

        const result = resolveItemAcquisitionCost('/items/basic_task_badge', createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveItemAcquisitionCost - TLA041E-15: refined descendant chain (refinement shards)', () => {
    beforeEach(resetMocks);

    test('a refined item = base item (upgrade) + 100 x special-currency refinement shards, fully represented', () => {
        addAction('/actions/pathbreaker_boots', '/items/pathbreaker_boots', [
            { itemHrid: '/items/pathbreaker_lodestone', count: 10 },
        ]);
        addAction(
            '/actions/pathbreaker_boots_refined',
            '/items/pathbreaker_boots_refined',
            [{ itemHrid: '/items/labyrinth_refinement_shard', count: 100 }],
            { upgradeItemHrid: '/items/pathbreaker_boots' }
        );
        mocks.specialCurrencyCosts['/items/pathbreaker_lodestone'] = { cost: 20_000, complete: true }; // base = 200,000
        mocks.specialCurrencyCosts['/items/labyrinth_refinement_shard'] = { cost: 500_000, complete: true }; // 100 * 500,000 = 50,000,000

        const result = resolveItemAcquisitionCost('/items/pathbreaker_boots_refined', createAcquisitionContext());
        expect(result).toEqual({ cost: 200_000 + 50_000_000, complete: true });
    });
});

describe('resolveItemAcquisitionCost - TLA041E-30: recursive acquisition memoization', () => {
    beforeEach(resetMocks);

    test('a shared material used by two independent recipes in the same context is priced exactly once', () => {
        addAction('/actions/basic_task_badge', '/items/basic_task_badge', [
            { itemHrid: '/items/task_crystal', count: 1 },
        ]);
        addAction('/actions/other_crystal_item', '/items/other_item', [{ itemHrid: '/items/task_crystal', count: 3 }]);
        mocks.specialCurrencyCosts['/items/task_crystal'] = { cost: 5000, complete: true };

        const context = createAcquisitionContext();
        resolveItemAcquisitionCost('/items/basic_task_badge', context);
        resolveItemAcquisitionCost('/items/other_item', context);
        resolveItemAcquisitionCost('/items/basic_task_badge', context); // repeat request, same context

        expect(mocks.getSpecialCurrencyCallCount['/items/task_crystal']).toBe(1);
    });

    test('a repeated top-level request in the same context returns the cached result without recomputation', () => {
        mocks.askPrices['/items/widget'] = 42;
        const context = createAcquisitionContext();
        const first = resolveItemAcquisitionCost('/items/widget', context);
        const second = resolveItemAcquisitionCost('/items/widget', context);
        expect(first).toBe(second); // same cached object reference
    });

    test('a fresh context recomputes independently of a prior context (no cross-generation staleness)', () => {
        mocks.askPrices['/items/widget'] = 42;
        resolveItemAcquisitionCost('/items/widget', createAcquisitionContext());
        mocks.askPrices['/items/widget'] = 99; // price changed between "Score generations"
        const result = resolveItemAcquisitionCost('/items/widget', createAcquisitionContext());
        expect(result).toEqual({ cost: 99, complete: true });
    });
});

describe('resolveItemAcquisitionCost - defensive cycle guard', () => {
    beforeEach(resetMocks);

    test('a malformed cyclic recipe (A needs B, B needs A) fails closed instead of overflowing the stack', () => {
        addAction('/actions/make_a', '/items/item_a', [{ itemHrid: '/items/item_b', count: 1 }]);
        addAction('/actions/make_b', '/items/item_b', [{ itemHrid: '/items/item_a', count: 1 }]);

        const result = resolveItemAcquisitionCost('/items/item_a', createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolvePerAttemptMaterialCost - TLA041E-16: special-currency enhancement materials', () => {
    beforeEach(resetMocks);

    test('an enhancement material with no Ask can still price completely through the special-currency route', () => {
        const itemDetails = {
            enhancementCosts: [
                { itemHrid: '/items/labyrinth_essence', count: 8 },
                { itemHrid: COIN, count: 1345 },
            ],
        };
        mocks.specialCurrencyCosts['/items/labyrinth_essence'] = { cost: 20, complete: true };

        const result = resolvePerAttemptMaterialCost(itemDetails, createAcquisitionContext());
        expect(result).toEqual({ cost: 8 * 20 + 1345, complete: true });
    });

    test('a missing enhancement material (no Ask, no special-currency route) fails the whole per-attempt cost closed', () => {
        const itemDetails = {
            enhancementCosts: [
                { itemHrid: '/items/labyrinth_essence', count: 8 },
                { itemHrid: COIN, count: 1345 },
            ],
        };
        // No specialCurrencyCosts entry -> essence stays unpriced.

        const result = resolvePerAttemptMaterialCost(itemDetails, createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('an item with no enhancementCosts at all is incomplete, not a fabricated zero', () => {
        const result = resolvePerAttemptMaterialCost({}, createAcquisitionContext());
        expect(result).toEqual({ cost: null, complete: false });
    });
});
