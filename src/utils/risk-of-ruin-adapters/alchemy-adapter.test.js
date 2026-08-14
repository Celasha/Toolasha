import { describe, expect, test, vi } from 'vitest';

let mockProfit = null;
const calculateTransmuteProfit = vi.fn(() => mockProfit);

vi.mock('../../features/market/alchemy-profit-calculator.js', () => ({
    default: { calculateTransmuteProfit: (...args) => calculateTransmuteProfit(...args) },
}));

const { buildAlchemyTransmuteModel } = await import('./alchemy-adapter.js');

function baseProfit(overrides = {}) {
    return {
        successRate: 0.5,
        grossMaterialCost: 1000,
        requirementCosts: [],
        catalystPrice: 0,
        dropRevenues: [],
        ...overrides,
    };
}

function sortByNet(outcomes) {
    return [...outcomes].sort((a, b) => a.net - b.net);
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

    test('keeps each categorical drop-table branch as its own outcome instead of averaging them', () => {
        // Mirrors the real Sunstone shape: two mutually-exclusive success branches (a priced
        // output and a self-return), not a single blended "success value".
        mockProfit = baseProfit({
            successRate: 0.5,
            dropRevenues: [
                // payout = revenuePerAttempt / (successRate * dropRate) = 150 / (0.5*0.6) = 500
                { itemHrid: '/items/output_a', dropRate: 0.6, revenuePerAttempt: 150, isEssence: false, isRare: false },
            ],
        });
        // Add the self-return branch via a second call shape below instead (selfReturnValue is
        // a top-level profit field, not part of dropRevenues' revenuePerAttempt for that entry).
        mockProfit.dropRevenues.push({
            itemHrid: '/items/widget',
            dropRate: 0.4,
            revenuePerAttempt: 0,
            isEssence: false,
            isRare: false,
            isSelfReturn: true,
        });
        mockProfit.selfReturnValue = 40; // payout = 40 / (0.5*0.4) = 200

        const model = buildAlchemyTransmuteModel('/items/widget');

        expect(model.cost).toBe(1000);
        const outcomes = sortByNet(model.outcomeDistribution);
        expect(outcomes).toEqual([
            { prob: 0.5, net: -1000 }, // failure
            { prob: 0.2, net: -1000 + 200 }, // success -> self-return (0.5 * 0.4)
            { prob: 0.3, net: -1000 + 500 }, // success -> output_a (0.5 * 0.6)
        ]);
        const totalProb = model.outcomeDistribution.reduce((sum, o) => sum + o.prob, 0);
        expect(totalProb).toBeCloseTo(1, 10);
    });

    test('folds unpriced drop-table coverage gaps into a zero-payout branch rather than dropping probability mass', () => {
        // Only 70% of the categorical space is priced/represented; the other 30% must still
        // sum to 1 overall, contributing 0 extra payout (never invents a value for it).
        mockProfit = baseProfit({
            successRate: 0.5,
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 0.7, revenuePerAttempt: 175, isEssence: false, isRare: false },
            ],
        });

        const model = buildAlchemyTransmuteModel('/items/widget');
        const totalProb = model.outcomeDistribution.reduce((sum, o) => sum + o.prob, 0);
        expect(totalProb).toBeCloseTo(1, 10);

        const residual = model.outcomeDistribution.find((o) => Math.abs(o.prob - 0.5 * 0.3) < 1e-9);
        expect(residual).toBeDefined();
        expect(residual.net).toBe(-1000); // 0 extra payout for the unpriced residual
    });

    test('crosses independent essence/rare bonus drops with every main branch (unaffected by success/fail)', () => {
        mockProfit = baseProfit({
            successRate: 0.5,
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 1, revenuePerAttempt: 250, isEssence: false, isRare: false },
                {
                    itemHrid: '/items/alchemy_essence',
                    dropRate: 0.5,
                    revenuePerAttempt: 100,
                    isEssence: true,
                    isRare: false,
                },
            ],
        });

        const model = buildAlchemyTransmuteModel('/items/widget');
        const outcomes = sortByNet(model.outcomeDistribution);

        expect(outcomes).toEqual([
            { prob: 0.25, net: -1000 }, // fail, no essence
            { prob: 0.25, net: -1000 + 200 }, // fail, essence hit (payout 100/0.5=200)
            { prob: 0.25, net: -1000 + 500 }, // success, no essence
            { prob: 0.25, net: -1000 + 500 + 200 }, // success, essence hit
        ]);
    });

    test('charges catalyst cost only on success branches, never on failure', () => {
        mockProfit = baseProfit({
            successRate: 0.5,
            catalystPrice: 300,
            catalystCost: { itemHrid: '/items/prime_catalyst' },
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 1, revenuePerAttempt: 250, isEssence: false, isRare: false },
            ],
        });

        const model = buildAlchemyTransmuteModel('/items/widget');
        const [failOutcome, successOutcome] = sortByNet(model.outcomeDistribution);

        expect(failOutcome.net).toBe(-1000); // no catalyst
        expect(successOutcome.net).toBe(-1000 - 300 + 500); // catalyst charged
    });

    test('includes a direct coin line item in the per-attempt cost charged on every branch', () => {
        mockProfit = baseProfit({
            successRate: 0.5,
            requirementCosts: [{ itemHrid: '/items/coin', costPerAction: 50 }],
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 1, revenuePerAttempt: 250, isEssence: false, isRare: false },
            ],
        });

        const model = buildAlchemyTransmuteModel('/items/widget');
        expect(model.cost).toBe(1050);
        const [failOutcome, successOutcome] = sortByNet(model.outcomeDistribution);
        expect(failOutcome.net).toBe(-1050);
        expect(successOutcome.net).toBe(-1050 + 500);
    });

    test('maxSinglePossibleLoss is the worst branch across the full distribution, not just fail', () => {
        // An expensive catalyst with a tiny output can make a success branch worse than failure.
        mockProfit = baseProfit({
            successRate: 0.5,
            catalystPrice: 5000,
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 1, revenuePerAttempt: 5, isEssence: false, isRare: false },
            ],
        });

        const model = buildAlchemyTransmuteModel('/items/widget');
        const successOutcome = model.outcomeDistribution.find((o) => o.net < -1000);
        expect(-successOutcome.net).toBeGreaterThan(1000);
        expect(model.maxSinglePossibleLoss).toBeCloseTo(-successOutcome.net, 6);
    });

    test('stepFn resolves via drawFromDistribution using the supplied rng', () => {
        mockProfit = baseProfit({
            successRate: 0.5,
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 1, revenuePerAttempt: 250, isEssence: false, isRare: false },
            ],
        });
        const model = buildAlchemyTransmuteModel('/items/widget');

        const failState = model.stepFn({ balance: 10000 }, () => 0);
        expect(failState.balance).toBe(10000 - 1000);

        const successState = model.stepFn({ balance: 10000 }, () => 0.99);
        expect(successState.balance).toBe(10000 - 1000 + 500);
    });

    test('breakdown exposes per-branch payouts for a details UI, excluding zero-drop-rate rows', () => {
        mockProfit = baseProfit({
            successRate: 0.5,
            catalystPrice: 300,
            catalystCost: { itemHrid: '/items/prime_catalyst' },
            requirementCosts: [{ itemHrid: '/items/coin', costPerAction: 50 }],
            dropRevenues: [
                { itemHrid: '/items/output_a', dropRate: 0.6, revenuePerAttempt: 150, isEssence: false, isRare: false },
                {
                    itemHrid: '/items/widget',
                    dropRate: 0.4,
                    revenuePerAttempt: 0,
                    isEssence: false,
                    isRare: false,
                    isSelfReturn: true,
                },
                {
                    itemHrid: '/items/alchemy_essence',
                    dropRate: 0.5,
                    revenuePerAttempt: 100,
                    isEssence: true,
                    isRare: false,
                },
                {
                    itemHrid: '/items/large_artisans_crate',
                    dropRate: 0,
                    revenuePerAttempt: 0,
                    isEssence: false,
                    isRare: true,
                },
            ],
            selfReturnValue: 40,
        });

        const model = buildAlchemyTransmuteModel('/items/widget');

        expect(model.breakdown.successRate).toBe(0.5);
        expect(model.breakdown.materialCost).toBe(1000);
        expect(model.breakdown.coinCost).toBe(50);
        expect(model.breakdown.catalystHrid).toBe('/items/prime_catalyst');
        expect(model.breakdown.catalystCostOnSuccess).toBe(300);
        expect(model.breakdown.netOnFail).toBe(-1050);

        expect(model.breakdown.mainBranches).toEqual([
            { itemHrid: '/items/output_a', dropRate: 0.6, payout: 500, isSelfReturn: false },
            { itemHrid: '/items/widget', dropRate: 0.4, payout: 200, isSelfReturn: true },
        ]);
        // The 0-drop-rate crate row is excluded, not shown as a misleading "0% chance" line.
        expect(model.breakdown.bonusDrops).toEqual([
            { itemHrid: '/items/alchemy_essence', dropRate: 0.5, payout: 200 },
        ]);
    });

    test('forwards catalystChoice through to calculateTransmuteProfit', () => {
        mockProfit = baseProfit({ dropRevenues: [] });
        calculateTransmuteProfit.mockClear();

        buildAlchemyTransmuteModel('/items/widget', { catalystChoice: 'prime' });

        expect(calculateTransmuteProfit).toHaveBeenCalledWith('/items/widget', false, null, 'prime');
    });
});
