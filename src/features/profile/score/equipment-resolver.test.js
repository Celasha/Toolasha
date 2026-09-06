import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shopItemDetailMap: {},
    askPrices: {}, // key: `${itemHrid}|${enhancementLevel ?? 0}` -> ask price
    shopCoinCost: 0,
    productionCost: 0,
    enhancementPathResult: null,
    directEnhancementResults: {}, // key: `${startLevel}->${targetLevel}` -> {cost, complete}
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ shopItemDetailMap: mocks.shopItemDetailMap })),
    },
}));

vi.mock('../../../utils/market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid, opts = {}) => {
        const level = opts.enhancementLevel ?? 0;
        return mocks.askPrices[`${itemHrid}|${level}`] ?? -1;
    }),
}));

vi.mock('../../../utils/game-lookups.js', () => ({
    getShopCoinCost: vi.fn(() => mocks.shopCoinCost),
}));

vi.mock('../../enhancement/tooltip-enhancement.js', () => ({
    getProductionCost: vi.fn(() => mocks.productionCost),
    calculateEnhancementPath: vi.fn(() => mocks.enhancementPathResult),
    calculateDirectEnhancementCost: vi.fn((itemHrid, startLevel, targetLevel) => {
        const result = mocks.directEnhancementResults[`${startLevel}->${targetLevel}`];
        return result ?? { cost: null, complete: false, protectFrom: null };
    }),
}));

import { resolveEquipmentItemCost } from './equipment-resolver.js';

const ITEM = '/items/cheese_sword';
const itemDetails = { enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }] };

function resetMocks() {
    mocks.shopItemDetailMap = {};
    mocks.askPrices = {};
    mocks.shopCoinCost = 0;
    mocks.productionCost = 0;
    mocks.enhancementPathResult = null;
    mocks.directEnhancementResults = {};
}

describe('resolveEquipmentItemCost - N=0 degeneration', () => {
    beforeEach(resetMocks);

    test('at +0, only the base-item acquisition leg applies (no enhancement candidates)', () => {
        mocks.askPrices[`${ITEM}|0`] = 5_000_000;
        const result = resolveEquipmentItemCost(ITEM, 0, itemDetails, {});
        expect(result).toEqual({ cost: 5_000_000, complete: true });
    });

    test('+0 with no priceable source anywhere is incomplete, not zero', () => {
        const result = resolveEquipmentItemCost(ITEM, 0, itemDetails, {});
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveEquipmentItemCost - F-01: exact finished item wins', () => {
    beforeEach(resetMocks);

    test('exact Ask 400M beats base reconstruction 650M and lower+17 path 510M', () => {
        mocks.askPrices[`${ITEM}|20`] = 400_000_000;
        mocks.enhancementPathResult = { optimalStrategy: { totalCost: 650_000_000 } };
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        mocks.directEnhancementResults['17->20'] = { cost: 360_000_000, complete: true }; // 150M+360M=510M

        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: 400_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-02: lower enhancement wins when exact target absent', () => {
    beforeEach(resetMocks);

    test('missing +20 Ask -> Ask(+17) 150M + direct 17->20 260M = 410M beats base reconstruction 700M', () => {
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        mocks.directEnhancementResults['17->20'] = { cost: 260_000_000, complete: true };
        mocks.enhancementPathResult = { optimalStrategy: { totalCost: 700_000_000 } };

        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: 410_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-03: inflated exact target loses, no heuristic needed', () => {
    beforeEach(resetMocks);

    test('exact Ask 2.5B loses to Ask(+17)+direct(17->20)=610M by plain minimum-selection', () => {
        mocks.askPrices[`${ITEM}|20`] = 2_500_000_000;
        mocks.askPrices[`${ITEM}|17`] = 350_000_000;
        mocks.directEnhancementResults['17->20'] = { cost: 260_000_000, complete: true };

        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: 610_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-05: missing one candidate is not global failure', () => {
    beforeEach(resetMocks);

    test('+20 and +17 Ask both missing, but base reconstruction completes at 720M', () => {
        mocks.enhancementPathResult = { optimalStrategy: { totalCost: 720_000_000 } };

        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: 720_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-06: no complete path -> partial, never zero/base-only', () => {
    beforeEach(resetMocks);

    test('no exact ask, no lower ask, and no complete base reconstruction -> incomplete', () => {
        mocks.enhancementPathResult = null; // shared path helper found nothing enhanceable/priceable
        // resolveBaseItemCost also has nothing: no ask, no shop cost, no production cost, not a token item
        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: null, complete: false });
    });

    test('a live lower-K Ask with an unpriceable direct enhancement is excluded, not zero-substituted', () => {
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        mocks.directEnhancementResults['17->20'] = { cost: null, complete: false, protectFrom: null };
        const result = resolveEquipmentItemCost(ITEM, 20, itemDetails, {});
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveEquipmentItemCost - F-09: token equipment must include enhancement value', () => {
    const TOKEN_ITEM = '/items/chimerical_quiver';
    const tokenItemDetails = { enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }] };

    beforeEach(() => {
        resetMocks();
        mocks.shopItemDetailMap['/shop_items/chimerical_quiver'] = {
            itemHrid: TOKEN_ITEM,
            costs: [{ itemHrid: '/items/chimerical_token', count: 35000 }],
        };
        // Best token-shop alternative resolves to 100M / 35000 tokens = ~2857.14 coins/token opportunity value...
        // instead pin it directly: griffin_leather ask such that bestValuePerToken * 35000 == 100,000,000
        mocks.askPrices['/items/griffin_leather|0'] = (100_000_000 / 35000) * 600; // valuePerToken * shop cost 600
    });

    test('+0 token item prices at the token opportunity value alone', () => {
        const result = resolveEquipmentItemCost(TOKEN_ITEM, 0, tokenItemDetails, {});
        expect(result.complete).toBe(true);
        expect(result.cost).toBeCloseTo(100_000_000, -2);
    });

    test('+20 token item = token opportunity value (100M) + direct 0->20 enhancement (300M) = 400M, never collapsing to 100M', () => {
        mocks.directEnhancementResults['0->20'] = { cost: 300_000_000, complete: true };
        // calculateEnhancementPath must be ignored for token items (it has no concept of token value)
        mocks.enhancementPathResult = { optimalStrategy: { totalCost: 5_000_000 } };

        const result = resolveEquipmentItemCost(TOKEN_ITEM, 20, tokenItemDetails, {});
        expect(result.complete).toBe(true);
        expect(result.cost).toBeCloseTo(400_000_000, -2);
    });
});
