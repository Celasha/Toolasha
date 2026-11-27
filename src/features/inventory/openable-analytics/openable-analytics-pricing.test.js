import { describe, test, expect, vi } from 'vitest';

vi.mock('../../../core/config.js', () => ({
    default: { getSetting: vi.fn() },
}));

const { default: config } = await import('../../../core/config.js');
const { allowIndirectPricing, allowOtherSidePricing, openableValuationOptions } =
    await import('./openable-analytics-pricing.js');

describe('allowIndirectPricing', () => {
    test('is on when the setting is on', () => {
        config.getSetting.mockReturnValue(true);
        expect(allowIndirectPricing()).toBe(true);
    });

    test('is off only when the setting is explicitly off', () => {
        config.getSetting.mockReturnValue(false);
        expect(allowIndirectPricing()).toBe(false);
    });

    test('stays on when the setting is missing', () => {
        config.getSetting.mockReturnValue(undefined);
        expect(allowIndirectPricing()).toBe(true);
    });
});

describe('allowOtherSidePricing', () => {
    test('is on when the setting is on or missing', () => {
        config.getSetting.mockReturnValue(true);
        expect(allowOtherSidePricing()).toBe(true);
        config.getSetting.mockReturnValue(undefined);
        expect(allowOtherSidePricing()).toBe(true);
    });

    test('is off only when the setting is explicitly off', () => {
        config.getSetting.mockReturnValue(false);
        expect(allowOtherSidePricing()).toBe(false);
    });

    test('is independent of the untradeable-valuation setting', () => {
        config.getSetting.mockImplementation((key) => key !== 'openableAnalytics_valueUntradeables');
        expect(openableValuationOptions()).toEqual({ allowIndirect: false, allowOtherSide: true });
        config.getSetting.mockReset();
    });
});
