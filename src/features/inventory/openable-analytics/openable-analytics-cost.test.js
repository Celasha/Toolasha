import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/data-manager.js', () => ({
    default: { getItemDetails: vi.fn() },
}));
vi.mock('../../market/expected-value-calculator.js', () => ({
    default: { resolveBuySideValue: vi.fn() },
}));
vi.mock('../../combat-sim/combat-sim-adapter.js', () => ({
    DUNGEON_ENTRY_KEYS: {
        '/items/chimerical_chest': '/items/chimerical_entry_key',
    },
}));
vi.mock('../../../utils/dungeon-key-cost.js', () => ({
    getKeyPriceInfo: vi.fn(),
}));

const { default: dataManager } = await import('../../../core/data-manager.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');
const { getKeyPriceInfo } = await import('../../../utils/dungeon-key-cost.js');
const { calculateOpeningCost, calculateEntryKeyCost } = await import('./openable-analytics-cost.js');

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

describe('calculateEntryKeyCost', () => {
    test('a non-dungeon container is not applicable (null)', () => {
        expect(calculateEntryKeyCost('/items/large_treasure_chest', 5)).toBeNull();
        expect(getKeyPriceInfo).not.toHaveBeenCalled();
    });

    test('a refinement chest is not applicable (null) - no second key is spent for it', () => {
        expect(calculateEntryKeyCost('/items/chimerical_refinement_chest', 5)).toBeNull();
        expect(getKeyPriceInfo).not.toHaveBeenCalled();
    });

    test("a regular dungeon chest costs the entry key's price times the number opened", () => {
        getKeyPriceInfo.mockReturnValue({ price: 500, isOutlier: false });

        expect(calculateEntryKeyCost('/items/chimerical_chest', 4)).toEqual({ cost: 2000, complete: true });
        expect(getKeyPriceInfo).toHaveBeenCalledWith('/items/chimerical_entry_key');
    });

    test('an unpriced entry key marks the cost incomplete rather than fabricating zero', () => {
        getKeyPriceInfo.mockReturnValue({ price: null, isOutlier: false });

        expect(calculateEntryKeyCost('/items/chimerical_chest', 4)).toEqual({ cost: 0, complete: false });
    });

    test('a non-positive container count costs nothing and is complete without pricing', () => {
        expect(calculateEntryKeyCost('/items/chimerical_chest', 0)).toEqual({ cost: 0, complete: true });
        expect(getKeyPriceInfo).not.toHaveBeenCalled();
    });
});
