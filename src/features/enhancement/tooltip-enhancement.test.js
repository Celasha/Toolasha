/**
 * Tests for the enhancement tooltip's minimum-sell-price calculation
 */

import { describe, test, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as mathJs from 'mathjs';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';

beforeAll(() => {
    globalThis.math = mathJs;
});

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

const itemDetailMap = {};
vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: () => ({ itemDetailMap }) },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn(() => 0),
    getItemPrices: vi.fn(() => ({ ask: 400_000_000, bid: 390_000_000 })),
}));

const marketPrices = {};
vi.mock('../../api/marketplace.js', () => ({
    default: { getPrice: (itemHrid) => marketPrices[itemHrid], on: () => {} },
}));

import { getItemPrices } from '../../utils/market-data.js';

const {
    buildEnhancementTooltipHTML,
    calculateMinimumSellPrice,
    calculatePerAttemptMaterialCost,
    calculateDirectEnhancementCost,
} = await import('./tooltip-enhancement.js');

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

    test('distinguishes nearby billion-scale rates instead of rounding them all to the same label', () => {
        settingsMap.itemTooltip_enhancingHourlyRateTax = { isTrue: false };

        settingsMap.itemTooltip_enhancingHourlyRate = { value: '1200000000' };
        const html1200m = buildEnhancementTooltipHTML(makeEnhancementData());

        settingsMap.itemTooltip_enhancingHourlyRate = { value: '1250000000' };
        const html1250m = buildEnhancementTooltipHTML(makeEnhancementData());

        settingsMap.itemTooltip_enhancingHourlyRate = { value: '1290000000' };
        const html1290m = buildEnhancementTooltipHTML(makeEnhancementData());

        expect(html1200m).toContain('Your rate: 1.20B/hr');
        expect(html1250m).toContain('Your rate: 1.25B/hr');
        expect(html1290m).toContain('Your rate: 1.29B/hr');
    });
});

describe('calculateMinimumSellPrice', () => {
    test('returns total cost plus rate-for-time when tax is excluded', () => {
        // 1 hour of time at a 10M/hr rate on top of a 5M total cost
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, false);
        expect(result).toBe(15_000_000);
    });

    test('grosses up by the marketplace tax when included', () => {
        const breakeven = 15_000_000;
        const result = calculateMinimumSellPrice(5_000_000, 3600, 10_000_000, true);
        expect(result).toBeCloseTo(breakeven / (1 - MARKET_TAX), 5);
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

describe('calculateDirectEnhancementCost - K->N direct Markov cost (TLA-041 / F-04)', () => {
    const enhancingParams = {
        enhancingLevel: 50,
        toolBonus: 0,
        speedBonus: 0,
        teas: { blessed: false },
        guzzlingBonus: 1,
    };

    beforeEach(() => {
        for (const key of Object.keys(marketPrices)) delete marketPrices[key];
        for (const key of Object.keys(itemDetailMap)) delete itemDetailMap[key];
        getItemPrices.mockReturnValue({ ask: 400_000_000, bid: 390_000_000 });
    });

    test('returns incomplete for an item with no enhancementCosts, never a fake zero', () => {
        itemDetailMap['/items/no_enh'] = { itemLevel: 1, enhancementCosts: [] };
        const result = calculateDirectEnhancementCost('/items/no_enh', 1, 4, enhancingParams);
        expect(result).toEqual({ cost: null, complete: false, protectFrom: null });
    });

    test('returns incomplete when a required material has no ask price, instead of a partial number', () => {
        itemDetailMap['/items/partial'] = {
            itemLevel: 1,
            enhancementCosts: [{ itemHrid: '/items/unpriced', count: 1 }],
        };
        const result = calculateDirectEnhancementCost('/items/partial', 1, 4, enhancingParams);
        expect(result).toEqual({ cost: null, complete: false, protectFrom: null });
    });

    test('F-04: uses calculateEnhancement with startLevel set directly, never defaulting to a 0-based computation', () => {
        marketPrices['/items/mat'] = { ask: 1000, bid: 900 };
        itemDetailMap['/items/testitem'] = {
            itemLevel: 1,
            enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }],
        };

        const direct = calculateDirectEnhancementCost('/items/testitem', 1, 4, enhancingParams);
        expect(direct.complete).toBe(true);

        const baseParams = {
            enhancingLevel: enhancingParams.enhancingLevel,
            toolBonus: 0,
            speedBonus: 0,
            itemLevel: 1,
            targetLevel: 4,
            protectFrom: direct.protectFrom,
            blessedTea: false,
            guzzlingBonus: 1,
        };
        const attemptsFromK = calculateEnhancement({ ...baseParams, startLevel: 1 }).attempts;
        const attemptsFrom0 = calculateEnhancement({ ...baseParams, startLevel: 0 }).attempts;

        // startLevel actually changes the answer - ruling out a bug where it's silently ignored.
        expect(attemptsFromK).not.toBeCloseTo(attemptsFrom0, 2);

        // The function's result matches the real startLevel=K computation, never the startLevel=0 one.
        expect(direct.cost).toBeCloseTo(1000 * attemptsFromK, 5);
        expect(direct.cost).not.toBeCloseTo(1000 * attemptsFrom0, 0);
    });

    test('sweeps protectFrom and reports the winning strategy alongside the cost', () => {
        marketPrices['/items/mat'] = { ask: 1000, bid: 900 };
        itemDetailMap['/items/testitem'] = {
            itemLevel: 1,
            enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }],
        };

        const result = calculateDirectEnhancementCost('/items/testitem', 1, 4, enhancingParams);
        expect(result.complete).toBe(true);
        expect([0, 2, 3, 4]).toContain(result.protectFrom);
        expect(result.cost).toBeGreaterThan(0);
    });

    test('a protection-requiring strategy with no priceable protection item is excluded, not zero-substituted', () => {
        marketPrices['/items/mat'] = { ask: 1000, bid: 900 };
        itemDetailMap['/items/testitem'] = {
            itemLevel: 1,
            enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }],
            protectionItemHrids: [],
        };
        // No positive price anywhere -> getCheapestProtectionPrice resolves to 0 for every
        // candidate, so every protectFrom>0 strategy must be excluded, leaving only protectFrom=0.
        getItemPrices.mockReturnValue({ ask: 0, bid: 0 });

        const result = calculateDirectEnhancementCost('/items/testitem', 1, 4, enhancingParams);
        expect(result.complete).toBe(true);
        expect(result.protectFrom).toBe(0);
    });

    test('F-08 (Option B): a temporary Blessed Tea setup changes the expected cost, but its own purchase price is never added', () => {
        marketPrices['/items/mat'] = { ask: 1000, bid: 900 };
        itemDetailMap['/items/testitem'] = {
            itemLevel: 1,
            enhancementCosts: [{ itemHrid: '/items/mat', count: 1 }],
        };

        const withoutBlessed = calculateDirectEnhancementCost('/items/testitem', 1, 4, {
            ...enhancingParams,
            teas: { blessed: false },
        });
        const withBlessed = calculateDirectEnhancementCost('/items/testitem', 1, 4, {
            ...enhancingParams,
            teas: { blessed: true },
            guzzlingBonus: 2, // scales the blessed-tea skip chance, making the effect measurable
        });

        expect(withoutBlessed.complete).toBe(true);
        expect(withBlessed.complete).toBe(true);
        // The setup measurably changes the expected math...
        expect(withBlessed.cost).not.toBeCloseTo(withoutBlessed.cost, 5);
        // ...but the cost is still built purely from enhancementCosts materials (1000/attempt) -
        // no separate line item for the Blessed Tea's own purchase price was ever added, since
        // this function never reads/prices any tea item at all.
        marketPrices['/items/blessed_tea'] = { ask: 999_999_999, bid: 999_999_999 };
        const withBlessedAgain = calculateDirectEnhancementCost('/items/testitem', 1, 4, {
            ...enhancingParams,
            teas: { blessed: true },
            guzzlingBonus: 2,
        });
        expect(withBlessedAgain.cost).toBeCloseTo(withBlessed.cost, 5);
    });
});
