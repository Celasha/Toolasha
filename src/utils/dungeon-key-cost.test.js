import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockGetSettingValue,
    mockGetPrice,
    mockGetPricingMode,
    mockGetItemPriceOutlierInfo,
    mockComputeBestCraftingPlan,
} = vi.hoisted(() => ({
    mockGetSettingValue: vi.fn(),
    mockGetPrice: vi.fn(),
    mockGetPricingMode: vi.fn(),
    mockGetItemPriceOutlierInfo: vi.fn(),
    mockComputeBestCraftingPlan: vi.fn(),
}));

vi.mock('../core/config.js', () => ({ default: { getSettingValue: mockGetSettingValue } }));
vi.mock('../api/marketplace.js', () => ({ default: { getPrice: mockGetPrice } }));
vi.mock('./market-data.js', () => ({
    getPricingMode: mockGetPricingMode,
    getItemPriceOutlierInfo: mockGetItemPriceOutlierInfo,
}));
vi.mock('../features/crafting-plan/crafting-plan-calculator.js', () => ({
    computeBestCraftingPlan: mockComputeBestCraftingPlan,
}));

import {
    getKeyPricingModeSetting,
    getCheapestKeyCost,
    getKeyPrice,
    KEY_PRICING_MODE_CHEAPEST,
} from './dungeon-key-cost.js';

const KEY_HRID = '/items/chimerical_entry_key';

beforeEach(() => {
    vi.clearAllMocks();
    mockGetPricingMode.mockReturnValue('ask');
});

describe('getKeyPricingModeSetting', () => {
    test('returns the raw setting value', () => {
        mockGetSettingValue.mockReturnValue('bid');
        expect(getKeyPricingModeSetting()).toBe('bid');
    });

    test('defaults to ask when unset', () => {
        mockGetSettingValue.mockReturnValue(undefined);
        expect(getKeyPricingModeSetting()).toBe('ask');
    });
});

describe('getCheapestKeyCost', () => {
    test('reports buy strategy with no plan when buying beats crafting', () => {
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'buy', unitCost: 500, children: [] });

        const result = getCheapestKeyCost(KEY_HRID);

        expect(mockComputeBestCraftingPlan).toHaveBeenCalledWith(KEY_HRID, 1, 'ask');
        expect(result).toEqual({ strategy: 'buy', unitCost: 500, isOutlier: false, plan: null });
    });

    test('reports craft strategy with the full plan when crafting is cheaper', () => {
        const plan = { strategy: 'craft', unitCost: 300, children: [{ itemHrid: '/items/blue_key_fragment' }] };
        mockComputeBestCraftingPlan.mockReturnValue(plan);

        const result = getCheapestKeyCost(KEY_HRID);

        expect(result).toEqual({ strategy: 'craft', unitCost: 300, isOutlier: false, plan });
    });

    test('reports isOutlier from the plan when the root item price was substituted', () => {
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'buy', unitCost: 500, isOutlier: true, children: [] });

        const result = getCheapestKeyCost(KEY_HRID);

        expect(result.isOutlier).toBe(true);
    });

    test('derives the buy-side price basis from the global profit pricing mode, not a hardcoded ask', () => {
        mockGetPricingMode.mockReturnValue('bid');
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'buy', unitCost: 100, children: [] });

        getCheapestKeyCost(KEY_HRID, 3);

        expect(mockGetPricingMode).toHaveBeenCalledWith('profit', 'buy');
        expect(mockComputeBestCraftingPlan).toHaveBeenCalledWith(KEY_HRID, 3, 'bid');
    });
});

describe('getKeyPrice', () => {
    test('ask mode reads the market ask price', () => {
        mockGetSettingValue.mockReturnValue('ask');
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 1000, isOutlier: false });

        expect(getKeyPrice(KEY_HRID)).toBe(1000);
        expect(mockGetItemPriceOutlierInfo).toHaveBeenCalledWith(KEY_HRID, { mode: 'ask' });
    });

    test('bid mode reads the market bid price', () => {
        mockGetSettingValue.mockReturnValue('bid');
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: 900, isOutlier: false });

        expect(getKeyPrice(KEY_HRID)).toBe(900);
        expect(mockGetItemPriceOutlierInfo).toHaveBeenCalledWith(KEY_HRID, { mode: 'bid' });
    });

    test('returns null when there is no market data at all (non-cheapest modes)', () => {
        mockGetSettingValue.mockReturnValue('ask');
        mockGetItemPriceOutlierInfo.mockReturnValue({ value: null, isOutlier: false });

        expect(getKeyPrice(KEY_HRID)).toBeNull();
    });

    test('cheapest mode returns the craft unit cost when crafting wins', () => {
        mockGetSettingValue.mockReturnValue(KEY_PRICING_MODE_CHEAPEST);
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'craft', unitCost: 250, children: [{}] });

        expect(getKeyPrice(KEY_HRID)).toBe(250);
        // Cheapest mode must never fall back to a flat market lookup.
        expect(mockGetPrice).not.toHaveBeenCalled();
    });

    test('cheapest mode returns the buy price when buying wins', () => {
        mockGetSettingValue.mockReturnValue(KEY_PRICING_MODE_CHEAPEST);
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'buy', unitCost: 1000, children: [] });

        expect(getKeyPrice(KEY_HRID)).toBe(1000);
    });

    test('cheapest mode returns null when neither buy nor craft is resolvable', () => {
        mockGetSettingValue.mockReturnValue(KEY_PRICING_MODE_CHEAPEST);
        mockComputeBestCraftingPlan.mockReturnValue({ strategy: 'buy', unitCost: Infinity, children: [] });

        expect(getKeyPrice(KEY_HRID)).toBeNull();
    });
});
