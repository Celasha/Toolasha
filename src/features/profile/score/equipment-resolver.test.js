import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shopItemDetailMap: {},
    askPrices: {}, // key: `${itemHrid}|${enhancementLevel ?? 0}` -> ask price
    shopCoinCost: 0,
    productionCost: 0,
    perAttemptCost: { cost: 0, hasCost: false, costPartial: false },
    protectionPrice: { price: 0, itemHrid: null },
    table: { targets: [] },
    tableError: null,
    getTableCalls: 0,
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
    calculatePerAttemptMaterialCost: vi.fn(() => mocks.perAttemptCost),
    getCheapestProtectionPrice: vi.fn(() => mocks.protectionPrice),
}));

vi.mock('./score-enhancement-worker.js', () => ({
    getScoreEnhancementExpectationTable: vi.fn(() => {
        mocks.getTableCalls += 1;
        if (mocks.tableError) return Promise.reject(mocks.tableError);
        return Promise.resolve(mocks.table);
    }),
}));

import { resolveEquipmentItemCost } from './equipment-resolver.js';
import { getScoreEnhancementExpectationTable } from './score-enhancement-worker.js';

const ITEM = '/items/cheese_sword';
const itemDetails = { itemLevel: 50, enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }] };
const ENHANCING_PARAMS = { enhancingLevel: 140, toolBonus: 8, teas: { blessed: true }, guzzlingBonus: 1.2 };

/** Build a single-strategy (protectFrom: 0) table entry at `targetLevel`, with `attemptsByStart[K] = attempts` pairs. */
function tableWithLeg(targetLevel, attemptsByK) {
    const attemptsByStart = [];
    for (const [k, attempts] of Object.entries(attemptsByK)) attemptsByStart[Number(k)] = attempts;
    const protectionsByStart = attemptsByStart.map(() => 0);
    const targets = [];
    targets[targetLevel] = [{ protectFrom: 0, attemptsByStart, protectionsByStart }];
    return { targets };
}

function resetMocks() {
    mocks.shopItemDetailMap = {};
    mocks.askPrices = {};
    mocks.shopCoinCost = 0;
    mocks.productionCost = 0;
    mocks.perAttemptCost = { cost: 1, hasCost: true, costPartial: false };
    mocks.protectionPrice = { price: 0, itemHrid: null };
    mocks.table = { targets: [] };
    mocks.tableError = null;
    mocks.getTableCalls = 0;
    getScoreEnhancementExpectationTable.mockClear();
}

describe('resolveEquipmentItemCost - N=0 degeneration', () => {
    beforeEach(resetMocks);

    test('at +0, only the base-item acquisition leg applies (no enhancement candidates)', async () => {
        mocks.askPrices[`${ITEM}|0`] = 5_000_000;
        const result = await resolveEquipmentItemCost(ITEM, 0, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 5_000_000, complete: true });
        expect(getScoreEnhancementExpectationTable).not.toHaveBeenCalled();
    });

    test('+0 with no priceable source anywhere is incomplete, not zero', async () => {
        const result = await resolveEquipmentItemCost(ITEM, 0, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: null, complete: false });
    });
});

describe('resolveEquipmentItemCost - F-01: exact finished item wins', () => {
    beforeEach(resetMocks);

    test('exact Ask 400M beats base reconstruction 650M and lower+17 path 510M', async () => {
        mocks.askPrices[`${ITEM}|20`] = 400_000_000;
        mocks.askPrices[`${ITEM}|0`] = 50_000_000; // base ask
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        // 0->20: base 50M + attempts 600M = 650M; 17->20: attempts 360M (+150M ask = 510M)
        mocks.table = tableWithLeg(20, { 0: 600_000_000, 17: 360_000_000 });

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 400_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-02: lower enhancement wins when exact target absent', () => {
    beforeEach(resetMocks);

    test('missing +20 Ask -> Ask(+17) 150M + direct 17->20 260M = 410M beats base reconstruction 700M', async () => {
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        mocks.askPrices[`${ITEM}|0`] = 100_000_000; // base ask
        mocks.table = tableWithLeg(20, { 0: 600_000_000, 17: 260_000_000 }); // 0->20 = 700M; 17->20 = 260M

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 410_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-03: inflated exact target loses, no heuristic needed', () => {
    beforeEach(resetMocks);

    test('exact Ask 2.5B loses to Ask(+17)+direct(17->20)=610M by plain minimum-selection', async () => {
        mocks.askPrices[`${ITEM}|20`] = 2_500_000_000;
        mocks.askPrices[`${ITEM}|17`] = 350_000_000;
        mocks.table = tableWithLeg(20, { 17: 260_000_000 });

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 610_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-05: missing one candidate is not global failure', () => {
    beforeEach(resetMocks);

    test('+20 and +17 Ask both missing, but base reconstruction completes at 720M', async () => {
        mocks.askPrices[`${ITEM}|0`] = 20_000_000;
        mocks.table = tableWithLeg(20, { 0: 700_000_000 });

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 720_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - F-06: no complete path -> partial, never zero/base-only', () => {
    beforeEach(resetMocks);

    test('no exact ask, no lower ask, and no complete base reconstruction -> incomplete', async () => {
        // resolveBaseItemCost has nothing: no ask, no shop cost, no production cost, not a token item.
        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({
            cost: null,
            complete: false,
            reason: 'No complete acquisition route could be priced',
        });
    });

    test('a live lower-K Ask with an unpriceable direct enhancement is excluded, not zero-substituted', async () => {
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        // table has no entry at all for target 20 -> every leg is incomplete
        mocks.table = { targets: [] };
        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({
            cost: null,
            complete: false,
            reason: 'No complete acquisition route could be priced',
        });
    });
});

describe('resolveEquipmentItemCost - F-09: token equipment must include enhancement value', () => {
    const TOKEN_ITEM = '/items/chimerical_quiver';
    const tokenItemDetails = { itemLevel: 50, enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }] };

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

    test('+0 token item prices at the token opportunity value alone', async () => {
        const result = await resolveEquipmentItemCost(TOKEN_ITEM, 0, tokenItemDetails, ENHANCING_PARAMS);
        expect(result.complete).toBe(true);
        expect(result.cost).toBeCloseTo(100_000_000, -2);
    });

    test('+20 token item = token opportunity value (100M) + direct 0->20 enhancement (300M) = 400M, never collapsing to 100M, and never uses a Mirror chain', async () => {
        mocks.table = tableWithLeg(20, { 0: 300_000_000 });
        mocks.askPrices['/items/philosophers_mirror|0'] = 1; // priced Mirror must still be ignored for token items

        const result = await resolveEquipmentItemCost(TOKEN_ITEM, 20, tokenItemDetails, ENHANCING_PARAMS);
        expect(result.complete).toBe(true);
        expect(result.cost).toBeCloseTo(400_000_000, -2);
    });
});

describe("resolveEquipmentItemCost - PSP-12: Philosopher's Mirror remains available where valid", () => {
    beforeEach(resetMocks);

    test('a priced Mirror substitutes a cheaper route at +20 than the traditional ladder', async () => {
        mocks.askPrices[`${ITEM}|0`] = 0; // no ask on base; use production instead
        mocks.productionCost = 10_000_000;
        mocks.askPrices['/items/philosophers_mirror|0'] = 5_000_000;

        // Traditional +20 (attempts 0->20) is deliberately huge; +18/+19 legs are cheap, so Mirror
        // (costs[18] + costs[19] + mirrorPrice) undercuts it.
        const table = { targets: [] };
        table.targets[18] = [{ protectFrom: 0, attemptsByStart: [10_000_000], protectionsByStart: [0] }];
        table.targets[19] = [{ protectFrom: 0, attemptsByStart: [10_000_000, 10_000_000], protectionsByStart: [0, 0] }];
        table.targets[20] = [{ protectFrom: 0, attemptsByStart: [1_000_000_000], protectionsByStart: [0] }];
        mocks.table = table;

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        // base 10M; costs[18] = 10M + 10M = 20M; costs[19] = 10M + 10M = 20M;
        // mirror at 20 = costs[18] + costs[19] + mirrorPrice = 20M + 20M + 5M = 45M, vs traditional
        // costs[20] = 10M + 1000M = 1010M -> Mirror wins.
        expect(result).toEqual({ cost: 45_000_000, complete: true });
    });
});

describe('resolveEquipmentItemCost - PSP-14: exact pruning skips the table entirely once already beaten', () => {
    beforeEach(resetMocks);

    test('exact Ask already best, and every other acquisition-origin price is >= it -> no table request', async () => {
        mocks.askPrices[`${ITEM}|20`] = 100_000_000; // best
        mocks.askPrices[`${ITEM}|0`] = 200_000_000; // base alone already >= best
        mocks.askPrices[`${ITEM}|17`] = 150_000_000; // K-ask alone already >= best

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 100_000_000, complete: true });
        expect(getScoreEnhancementExpectationTable).not.toHaveBeenCalled();
    });

    test('one lower-K Ask beats the current best -> the table is requested and that route is evaluated', async () => {
        mocks.askPrices[`${ITEM}|20`] = 100_000_000;
        mocks.askPrices[`${ITEM}|0`] = 200_000_000; // still prunable
        mocks.askPrices[`${ITEM}|17`] = 50_000_000; // beats 100M alone -> must be evaluated
        mocks.table = tableWithLeg(20, { 17: 10_000_000 }); // 50M + 10M = 60M < 100M

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 60_000_000, complete: true });
        expect(getScoreEnhancementExpectationTable).toHaveBeenCalledTimes(1);
    });
});

describe('resolveEquipmentItemCost - PSP-15: worker failure fails closed, never falls back synchronously', () => {
    beforeEach(resetMocks);

    test('a rejected table request keeps the exact Ask usable but drops every enhancement-dependent route', async () => {
        mocks.askPrices[`${ITEM}|20`] = 400_000_000;
        mocks.askPrices[`${ITEM}|0`] = 50_000_000;
        mocks.askPrices[`${ITEM}|17`] = 150_000_000;
        mocks.tableError = new Error('worker exploded');

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({ cost: 400_000_000, complete: true });
    });

    test('a rejected table request with no exact Ask leaves the item wholly incomplete', async () => {
        mocks.askPrices[`${ITEM}|0`] = 50_000_000;
        mocks.tableError = new Error('worker exploded');

        const result = await resolveEquipmentItemCost(ITEM, 20, itemDetails, ENHANCING_PARAMS);
        expect(result).toEqual({
            cost: null,
            complete: false,
            reason: 'No complete acquisition route could be priced',
        });
    });
});
