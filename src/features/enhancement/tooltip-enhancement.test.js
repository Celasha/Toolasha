/**
 * Tests for the enhancement tooltip's minimum-sell-price calculation
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const settingsMap = {};

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_TOOLTIP_INFO: '#2563eb',
        COLOR_TOOLTIP_PROFIT: '#047857',
        COLOR_TOOLTIP_LOSS: '#dc2626',
        COLOR_MIRROR: '#ffd700',
        isFeatureEnabled: () => false,
        // Boolean-only accessor, mirrors the real config.js: reads .isTrue, defaults to false.
        // A text-type setting has no .isTrue, so this must NOT be used to read its value.
        getSetting: (key) => settingsMap[key]?.isTrue ?? false,
        // Value accessor for non-boolean settings, mirrors the real config.js: reads .value.
        getSettingValue: (key, defaultValue = null) => settingsMap[key]?.value ?? defaultValue,
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: () => ({ itemDetailMap: {} }) },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: () => 0,
    getItemPrices: () => ({ ask: 400_000_000, bid: 390_000_000 }),
}));

const marketPrices = {};
vi.mock('../../api/marketplace.js', () => ({
    default: { getPrice: (itemHrid) => marketPrices[itemHrid], on: () => {} },
}));

const { buildEnhancementTooltipHTML, calculateMinimumSellPrice, calculatePerAttemptMaterialCost } =
    await import('./tooltip-enhancement.js');

function makeEnhancementData(overrides = {}) {
    return {
        itemHrid: '/items/test_item',
        targetLevel: 10,
        xpPerHour: null,
        totalExpectedXP: null,
        optimalStrategy: {
            protectFrom: 0,
            label: 'Never',
            expectedAttempts: 100,
            totalTime: 3600,
            baseCost: 1_000_000,
            baseAskPrice: 1_000_000,
            baseBidPrice: 900_000,
            baseAskIsCrafted: false,
            baseBidIsCrafted: false,
            materialCost: 4_000_000,
            materialBreakdown: [],
            protectionCost: 0,
            protectionItemHrid: null,
            protectionCount: 0,
            protectionAskPrice: 0,
            protectionBidPrice: 0,
            totalCost: 5_000_000,
            usedMirror: false,
            mirrorStartLevel: null,
            ...overrides,
        },
    };
}

describe('buildEnhancementTooltipHTML — minimum sell row', () => {
    beforeEach(() => {
        for (const key of Object.keys(settingsMap)) delete settingsMap[key];
    });

    test('reads the rate through getSettingValue, not getSetting (regression: getSetting only returns booleans)', () => {
        settingsMap.itemTooltip_enhancingHourlyRate = { value: '5000000' };
        settingsMap.itemTooltip_enhancingHourlyRateTax = { isTrue: false };

        const html = buildEnhancementTooltipHTML(makeEnhancementData());

        expect(html).toContain('Your rate:');
        expect(html).toContain('Minimum sell:');
    });

    test('hides the row entirely when the rate setting is blank', () => {
        settingsMap.itemTooltip_enhancingHourlyRate = { value: '' };

        const html = buildEnhancementTooltipHTML(makeEnhancementData());

        expect(html).not.toContain('Your rate:');
        expect(html).not.toContain('Minimum sell:');
    });

    test('hides the row entirely when the rate setting is unset', () => {
        const html = buildEnhancementTooltipHTML(makeEnhancementData());

        expect(html).not.toContain('Your rate:');
        expect(html).not.toContain('Minimum sell:');
    });
});

describe('calculateMinimumSellPrice', () => {
    test('returns total cost plus rate-for-time when tax is excluded', () => {
        // 1 hour of time at a 10M/hr rate on top of a 5M total cost
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, false);
        expect(result).toBe(15_000_000);
    });

    test('grosses up by the 2% marketplace tax when included', () => {
        const breakeven = 15_000_000;
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, true);
        expect(result).toBeCloseTo(breakeven / 0.98, 5);
    });

    test('scales the rate contribution by fractional hours', () => {
        // 30 minutes at 10M/hr = 5M added to a 5M cost
        const result = calculateMinimumSellPrice(5_000_000, 1800, 10_000_000, false);
        expect(result).toBe(10_000_000);
    });

    test('returns just the total cost when hourly rate is zero', () => {
        const result = calculateMinimumSellPrice(5_000_000, 3600, 0, false);
        expect(result).toBe(5_000_000);
    });

    test('returns just the total cost when no time has elapsed', () => {
        const result = calculateMinimumSellPrice(5_000_000, 0, 10_000_000, false);
        expect(result).toBe(5_000_000);
    });
});

describe('calculatePerAttemptMaterialCost', () => {
    beforeEach(() => {
        for (const key of Object.keys(marketPrices)) delete marketPrices[key];
    });

    test('sums coin line items 1:1 and priced materials at ask, marking hasCost true', () => {
        marketPrices['/items/enhancing_essence'] = { ask: 1000, bid: 900 };
        const itemDetails = {
            enhancementCosts: [
                { itemHrid: '/items/coin', count: 5000 },
                { itemHrid: '/items/enhancing_essence', count: 3 },
            ],
        };

        const result = calculatePerAttemptMaterialCost(itemDetails);

        expect(result.cost).toBe(5000 + 3 * 1000);
        expect(result.hasCost).toBe(true);
        expect(result.costPartial).toBe(false);
    });

    test('flags costPartial when a material has no ask price, without discarding priced materials', () => {
        marketPrices['/items/priced_material'] = { ask: 200, bid: 150 };
        const itemDetails = {
            enhancementCosts: [
                { itemHrid: '/items/priced_material', count: 2 },
                { itemHrid: '/items/unpriced_material', count: 1 },
            ],
        };

        const result = calculatePerAttemptMaterialCost(itemDetails);

        expect(result.cost).toBe(400);
        expect(result.hasCost).toBe(true);
        expect(result.costPartial).toBe(true);
    });

    test('returns a zero-cost, non-partial result when there are no enhancement costs', () => {
        const result = calculatePerAttemptMaterialCost({ enhancementCosts: [] });

        expect(result).toEqual({ cost: 0, hasCost: false, costPartial: false });
    });
});
