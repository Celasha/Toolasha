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
vi.mock('./game-i18n.js', () => ({ getItemName: (hrid, name) => name }));
vi.mock('../features/enhancement/tooltip-enhancement.js', () => ({
    getProductionCost: (hrid, mode) => state.productionCost[`${hrid}|${mode}`] ?? 0,
}));

const { calculateTooltipCraftCost } = await import('./profit-helpers.js');

describe('calculateTooltipCraftCost', () => {
    beforeEach(() => {
        state.artisan = 0;
        state.settings = {};
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
        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(1410);
        expect(calculateTooltipCraftCost('/items/trident', 'bid')).toBe(2 * 90 + 4 * 45 + 10 + 900);
    });

    test('artisan reduces the inputs but not the upgrade item', () => {
        state.artisan = 0.1;
        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBeCloseTo(0.9 * 410 + 1000, 5);
    });

    test('crafts the upgrade item only when the setting is on and crafting is cheaper', () => {
        state.productionCost = { '/items/jackalope|ask': 700, '/items/jackalope|bid': 650 };
        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(1410);

        state.settings.profitCalc_craftUpgradeItems = true;
        expect(calculateTooltipCraftCost('/items/trident', 'ask')).toBe(410 + 700);
        expect(calculateTooltipCraftCost('/items/trident', 'bid')).toBe(2 * 90 + 4 * 45 + 10 + 650);
    });

    test('an item without a recipe has no craft cost', () => {
        expect(calculateTooltipCraftCost('/items/fang', 'ask')).toBe(0);
    });
});
