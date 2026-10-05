import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    marketPrices: {},
    customPrices: {},
    outlierGuardEnabled: true,
    outlierBandMultiplier: 3,
    referenceValues: {},
}));

vi.mock('../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(
            (itemHrid, enhancementLevel = 0) => mocks.marketPrices[`${itemHrid}:${enhancementLevel}`] ?? null
        ),
    },
}));

vi.mock('../api/market-values.js', () => ({
    default: {
        getValue: vi.fn(
            (itemHrid, enhancementLevel = 0) => mocks.referenceValues[`${itemHrid}:${enhancementLevel}`] ?? null
        ),
        checkOutlier: vi.fn((itemHrid, enhancementLevel, rawValue) => {
            if (typeof rawValue !== 'number' || rawValue <= 0 || !mocks.outlierGuardEnabled) {
                return { value: rawValue, isOutlier: false };
            }
            const reference = mocks.referenceValues[`${itemHrid}:${enhancementLevel}`] ?? null;
            if (!reference) {
                return { value: rawValue, isOutlier: false };
            }
            const multiplier = mocks.outlierBandMultiplier;
            if (rawValue > reference * multiplier || rawValue < reference / multiplier) {
                return { value: reference, isOutlier: true };
            }
            return { value: rawValue, isOutlier: false };
        }),
    },
}));

vi.mock('../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn((key, fallback) => fallback),
    },
}));

vi.mock('../features/settings/custom-price-overrides.js', () => ({
    getCustomPrice: vi.fn(
        (itemHrid, enhancementLevel = 0) => mocks.customPrices[`${itemHrid}:${enhancementLevel}`] ?? null
    ),
}));

import { getItemPrice, getItemPrices, getItemPriceOutlierInfo, getItemPricesBatch } from './market-data.js';

function setPrice(itemHrid, enhancementLevel, ask, bid) {
    mocks.marketPrices[`${itemHrid}:${enhancementLevel}`] = { ask, bid };
}

function setReference(itemHrid, enhancementLevel, value) {
    mocks.referenceValues[`${itemHrid}:${enhancementLevel}`] = value;
}

beforeEach(() => {
    mocks.marketPrices = {};
    mocks.customPrices = {};
    mocks.referenceValues = {};
    mocks.outlierGuardEnabled = true;
    mocks.outlierBandMultiplier = 3;
});

describe('getItemPrice - normal (non-outlier) resolution unaffected', () => {
    test('returns the live ask price when within the reference band', () => {
        setPrice('/items/sword', 0, 1000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'ask' })).toBe(1000);
    });

    test('returns the live bid price when within the reference band', () => {
        setPrice('/items/sword', 0, 1000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'bid' })).toBe(900);
    });

    test('returns the average when both sides are within band', () => {
        setPrice('/items/sword', 0, 1000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'average' })).toBe(950);
    });

    test('returns null when there is no market data', () => {
        expect(getItemPrice('/items/unknown', { mode: 'ask' })).toBeNull();
    });

    test('custom price overrides bypass the outlier guard entirely', () => {
        mocks.customPrices['/items/sword:0'] = 55;
        setPrice('/items/sword', 0, 1_000_000_000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'ask' })).toBe(55);
    });

    test('an item with no reference value in the dataset is never flagged, however far the price moves', () => {
        setPrice('/items/no_reference_item', 0, 999_999_999, 1);
        // No setReference() call - nothing to compare against.

        expect(getItemPrice('/items/no_reference_item', { mode: 'ask' })).toBe(999_999_999);
        expect(getItemPriceOutlierInfo('/items/no_reference_item', { mode: 'ask' }).isOutlier).toBe(false);
    });
});

describe('getItemPrice - outlier substitution', () => {
    test('substitutes the reference value when ask is far above the band', () => {
        setPrice('/items/sword', 0, 1_000_000, 100);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'ask' })).toBe(1000);
    });

    test('substitutes the reference value when bid is far below the band', () => {
        setPrice('/items/sword', 0, 1000, 1);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'bid' })).toBe(1000);
    });

    test('average mode substitutes whichever side is an outlier, not both unconditionally', () => {
        setPrice('/items/sword', 0, 999_999_999, 950);
        setReference('/items/sword', 0, 1000);

        // ask (999,999,999) is corrected to 1000, bid (950) stays as-is -> average of 1000 and 950
        expect(getItemPrice('/items/sword', { mode: 'average' })).toBe(975);
    });

    test('does nothing when the outlier guard setting is disabled', () => {
        mocks.outlierGuardEnabled = false;
        setPrice('/items/sword', 0, 1_000_000, 100);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrice('/items/sword', { mode: 'ask' })).toBe(1_000_000);
    });
});

describe('getItemPriceOutlierInfo', () => {
    test('reports isOutlier: true when the ask price was substituted', () => {
        setPrice('/items/sword', 0, 1_000_000, 900);
        setReference('/items/sword', 0, 1000);

        const info = getItemPriceOutlierInfo('/items/sword', { mode: 'ask' });
        expect(info).toEqual({ value: 1000, isOutlier: true });
    });

    test('reports isOutlier: false for a normal price', () => {
        setPrice('/items/sword', 0, 1000, 900);
        setReference('/items/sword', 0, 1000);

        const info = getItemPriceOutlierInfo('/items/sword', { mode: 'ask' });
        expect(info).toEqual({ value: 1000, isOutlier: false });
    });

    test('reports isOutlier: false for a custom price override', () => {
        mocks.customPrices['/items/sword:0'] = 55;
        setPrice('/items/sword', 0, 1_000_000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPriceOutlierInfo('/items/sword', { mode: 'ask' })).toEqual({ value: 55, isOutlier: false });
    });
});

describe('getItemPrices', () => {
    test('returns askOutlier/bidOutlier flags alongside the (corrected) ask/bid/average', () => {
        setPrice('/items/sword', 0, 1_000_000, 1);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrices('/items/sword', 0)).toEqual({
            ask: 1000,
            bid: 1000,
            average: 1000,
            askOutlier: true,
            bidOutlier: true,
        });
    });

    test('both flags are false when nothing was substituted', () => {
        setPrice('/items/sword', 0, 1000, 900);
        setReference('/items/sword', 0, 1000);

        expect(getItemPrices('/items/sword', 0)).toEqual({
            ask: 1000,
            bid: 900,
            average: 950,
            askOutlier: false,
            bidOutlier: false,
        });
    });

    test('returns null when there is no market data, same as before', () => {
        expect(getItemPrices('/items/unknown', 0)).toBeNull();
    });
});

describe('getItemPricesBatch', () => {
    test('batch results are also outlier-corrected, since it delegates to getItemPrice()', () => {
        setPrice('/items/sword', 0, 1_000_000, 1);
        setReference('/items/sword', 0, 1000);
        setPrice('/items/shield', 0, 500, 400);
        setReference('/items/shield', 0, 500);

        const result = getItemPricesBatch([{ itemHrid: '/items/sword' }, { itemHrid: '/items/shield' }], {
            mode: 'ask',
        });

        expect(result.get('/items/sword:0')).toBe(1000);
        expect(result.get('/items/shield:0')).toBe(500);
    });
});
