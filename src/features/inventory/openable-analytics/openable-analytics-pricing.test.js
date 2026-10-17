import { describe, test, expect, vi } from 'vitest';

vi.mock('../../../core/config.js', () => ({
    default: { getSetting: vi.fn() },
}));

const { default: config } = await import('../../../core/config.js');
const { allowIndirectPricing } = await import('./openable-analytics-pricing.js');

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
