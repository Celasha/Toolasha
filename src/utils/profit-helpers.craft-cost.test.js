import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
    actions: {},
    asks: {},
    bids: {},
    settings: {},
    productionCost: {},
    artisan: 0,
}));

vi.mock('../core/config.js', () => ({ default: { getSetting: (key) => state.settings[key] ?? false } }));
vi.mock('../core/data-manager.js', () => ({
    default: { getInitClientData: () => ({ actionDetailMap: state.actions }), getItemDetails: () => ({ name: 'x' }) },
}));
vi.mock('./material-calculator.js', () => ({ calculateArtisanBonus: () => state.artisan }));
vi.mock('./market-data.js', () => ({
    getItemPriceOutlierInfo: vi.fn((hrid, { mode }) => ({
        value: (mode === 'bid' ? state.bids : state.asks)[hrid] ?? null,
        isOutlier: false,
    })),
}));
vi.mock('../features/settings/custom-price-overrides.js', () => ({ getCustomPrice: () => null }));
vi.mock('./game-lookups.js', () => ({ getShopCoinCost: () => 0 }));
vi.mock('../core/i18n.js', () => ({ t: (key, params) => `${key}:${params?.itemName ?? ''}` }));
const planCalls = vi.hoisted(() => ({ calls: [], totalCost: 0 }));
vi.mock('../features/crafting-plan/crafting-plan-calculator.js', () => ({
    computeBestCraftingPlan: (...args) => {
        planCalls.calls.push(args);
        return { totalCost: planCalls.totalCost };
    },
}));
vi.mock('./game-i18n.js', () => ({ getItemName: (hrid, name) => name }));
vi.mock('../features/enhancement/tooltip-enhancement.js', () => ({
    getProductionCost: (hrid, mode) => state.productionCost[`${hrid}|${mode}`] ?? 0,
}));

const { calculateTooltipCraftCost, calculateOneLevelCraftCost, calculateCraftPlanCost } =
    await import('./profit-helpers.js');

describe('craft cost helpers', () => {
    beforeEach(() => {
        state.artisan = 0;
        state.settings = {};
        planCalls.calls = [];
        planCalls.totalCost = 0;
        state.productionCost = {};
        state.asks = { '/items/fang': 100, '/items/staff': 50, '/items/jackalope': 1000 };
        state.bids = { '/items/fang': 90, '/items/staff': 45, '/items/jackalope': 900 };
        state.actions = {
            '/actions/crafting/trident': {
                outputItems: [{ itemHrid: '/items/trident', count: 1 }],
                inputItems: [
                    { itemHrid: '/items/fang', count: 2 },
                    { itemHrid: '/items/staff', count: 4 },
                    { itemHrid: '/items/coin', count: 10 },
                ],
                upgradeItemHrid: '/items/jackalope',
            },
        };
    });

    test('sums direct inputs at market plus the upgrade item, without recursing into inputs', () => {
        // 2*100 + 4*50 + 10 coin + 1000 upgrade
        expect(calculateOneLevelCraftCost('/items/trident', 'ask')).toBe(1410);
        expect(calculateOneLevelCraftCost('/items/trident', 'bid')).toBe(2 * 90 + 4 * 45 + 10 + 900);
    });

    test('artisan reduces the inputs but not the upgrade item', () => {
        state.artisan = 0.1;
        expect(calculateOneLevelCraftCost('/items/trident', 'ask')).toBeCloseTo(0.9 * 410 + 1000, 5);
    });

    test('crafts the upgrade item only when the setting is on and crafting is cheaper', () => {
        state.productionCost = { '/items/jackalope|ask': 700, '/items/jackalope|bid': 650 };
        expect(calculateOneLevelCraftCost('/items/trident', 'ask')).toBe(1410);

        state.settings.profitCalc_craftUpgradeItems = true;
        expect(calculateOneLevelCraftCost('/items/trident', 'ask')).toBe(410 + 700);
        expect(calculateOneLevelCraftCost('/items/trident', 'bid')).toBe(2 * 90 + 4 * 45 + 10 + 650);
    });

    test('an item without a recipe has no craft cost', () => {
        expect(calculateOneLevelCraftCost('/items/fang', 'ask')).toBe(0);
    });

    test('the whole-tree cost always crafts the item itself and ignores task mode and time cost', () => {
        planCalls.totalCost = 900;
        state.settings = {
            actionPanel_craftingPlanBuyIntermediates: true,
            actionPanel_craftingPlanNoProcessing: true,
            actionPanel_craftingPlanTaskMode: true,
            actionPanel_craftingPlanTimeCost: true,
        };

        expect(calculateCraftPlanCost('/items/trident', 'bid')).toBe(900);

        const [hrid, quantity, mode, , , , , buyRawOnly, forceRootCraft, timeCost, skipProcessing] = planCalls.calls[0];
        expect([hrid, quantity, mode]).toEqual(['/items/trident', 1, 'bid']);
        expect(buyRawOnly).toBe(true);
        expect(skipProcessing).toBe(true);
        expect(forceRootCraft).toBe(true);
        expect(timeCost).toBe(0);
    });

    test('the tooltip craft cost follows the setting: whole tree when on, one level when off', () => {
        planCalls.totalCost = 900;

        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(1410);

        state.settings.itemTooltip_craftCostSubMaterials = true;
        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(900);
    });

    test('falls back to the one-level cost when the plan cannot price the item', () => {
        state.settings.itemTooltip_craftCostSubMaterials = true;
        planCalls.totalCost = Infinity;

        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(1410);
    });
});
