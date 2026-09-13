import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/data-manager.js', () => ({
    default: { getItemDetails: vi.fn() },
}));
vi.mock('../../market/expected-value-calculator.js', () => ({
    default: { resolveBuySideValue: vi.fn() },
}));

const { default: dataManager } = await import('../../../core/data-manager.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const { calculateOpeningCost } = await import('./openable-analytics-cost.js');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('calculateOpeningCost', () => {
    test('a container with no key requirement costs nothing and is complete', () => {
        dataManager.getItemDetails.mockReturnValue({});

        expect(calculateOpeningCost('/items/large_treasure_chest', 5)).toEqual({ cost: 0, complete: true });
        expect(expectedValueCalculator.resolveBuySideValue).not.toHaveBeenCalled();
    });

    test("a container requiring a key costs that key's buy price times the number opened", () => {
        dataManager.getItemDetails.mockReturnValue({ openKeyItemHrid: '/items/chimerical_chest_key' });
        expectedValueCalculator.resolveBuySideValue.mockReturnValue({ value: 1000 });

        expect(calculateOpeningCost('/items/chimerical_chest', 3)).toEqual({ cost: 3000, complete: true });
        expect(expectedValueCalculator.resolveBuySideValue).toHaveBeenCalledWith('/items/chimerical_chest_key');
    });

    test('an unpriced key marks the cost incomplete rather than fabricating zero', () => {
        dataManager.getItemDetails.mockReturnValue({ openKeyItemHrid: '/items/chimerical_chest_key' });
        expectedValueCalculator.resolveBuySideValue.mockReturnValue(null);

        expect(calculateOpeningCost('/items/chimerical_chest', 3)).toEqual({ cost: 0, complete: false });
    });

    test('a non-positive container count costs nothing and is complete', () => {
        expect(calculateOpeningCost('/items/chimerical_chest', 0)).toEqual({ cost: 0, complete: true });
        expect(dataManager.getItemDetails).not.toHaveBeenCalled();
    });
});
