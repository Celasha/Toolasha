import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockIsUntradableCape,
    mockGetCapeBaseValue,
    mockCalculatePath,
    mockGetRealisticPrice,
    mockAutoParams,
    mockCapeMode,
    mockOverrides,
    marketListeners,
} = vi.hoisted(() => ({
    mockIsUntradableCape: vi.fn(),
    mockGetCapeBaseValue: vi.fn(),
    mockCalculatePath: vi.fn(),
    mockGetRealisticPrice: vi.fn(),
    mockAutoParams: vi.fn(),
    mockCapeMode: vi.fn(),
    mockOverrides: vi.fn(),
    marketListeners: [],
}));

vi.mock('../../api/marketplace.js', () => ({ default: { on: (fn) => marketListeners.push(fn) } }));
vi.mock('../settings/custom-price-overrides.js', () => ({ getCustomPriceOverrides: mockOverrides }));

vi.mock('../../utils/untradable-cape.js', () => ({
    isUntradableCape: mockIsUntradableCape,
    isRefinedCape: (hrid) => hrid.endsWith('_refined'),
    getCapeBaseValue: mockGetCapeBaseValue,
    getCapeBaseValueMode: mockCapeMode,
}));
vi.mock('../../utils/enhancement-config.js', () => ({
    getAutoDetectedParams: mockAutoParams,
    getEnhancingParams: () => {
        throw new Error('manual enhancing params must not be used for untradable capes');
    },
}));
vi.mock('./tooltip-enhancement.js', () => ({
    calculateEnhancementPath: mockCalculatePath,
    getRealisticBaseItemPrice: mockGetRealisticPrice,
}));

const { getUntradableCapeValue, clearUntradableCapeValueCache } = await import('./untradable-cape-value.js');

describe('getUntradableCapeValue', () => {
    beforeEach(() => {
        mockIsUntradableCape.mockReset().mockReturnValue(true);
        mockGetCapeBaseValue.mockReset().mockReturnValue(0);
        mockCalculatePath.mockReset().mockReturnValue(null);
        mockGetRealisticPrice.mockReset().mockReturnValue(0);
        mockAutoParams.mockReset().mockReturnValue({ source: 'auto-detected' });
        mockCapeMode.mockReset().mockReturnValue('zero');
        mockOverrides.mockReset().mockReturnValue({});
        clearUntradableCapeValueCache();
    });

    test('is null for anything that is not an untradable cape', () => {
        mockIsUntradableCape.mockReturnValue(false);

        expect(getUntradableCapeValue('/items/cheese', 0)).toBeNull();
    });

    test('a base cape at +0 is the cape base value', () => {
        mockGetCapeBaseValue.mockReturnValue(9_500_000);

        expect(getUntradableCapeValue('/items/chance_cape', 0)).toBe(9_500_000);
    });

    test('a refined cape at +0 is its base cape plus refinement cost', () => {
        mockGetRealisticPrice.mockReturnValue(99_500_000);

        expect(getUntradableCapeValue('/items/chance_cape_refined')).toBe(99_500_000);
        expect(mockGetRealisticPrice).toHaveBeenCalledWith('/items/chance_cape_refined');
    });

    test("an enhanced cape costs the optimal enhancement path, worked out with the player's own stats", () => {
        mockCalculatePath.mockReturnValue({ optimalStrategy: { totalCost: 250_000_000 } });

        expect(getUntradableCapeValue('/items/chance_cape_refined', 8)).toBe(250_000_000);
        expect(mockCalculatePath).toHaveBeenCalledWith('/items/chance_cape_refined', 8, { source: 'auto-detected' });
    });

    test('falls back to the +0 value when the enhancement path cannot be worked out', () => {
        mockGetCapeBaseValue.mockReturnValue(9_500_000);

        expect(getUntradableCapeValue('/items/chance_cape', 5)).toBe(9_500_000);
    });

    test('falls back to the +0 value when the enhancement path throws', () => {
        mockGetCapeBaseValue.mockReturnValue(1234);
        mockCalculatePath.mockImplementation(() => {
            throw new Error('boom');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(getUntradableCapeValue('/items/chance_cape', 5)).toBe(1234);
        errorSpy.mockRestore();
    });

    describe('enhancement path caching', () => {
        beforeEach(() => {
            mockCalculatePath.mockReturnValue({ optimalStrategy: { totalCost: 250_000_000 } });
        });

        test('works out the same cape and level once', () => {
            getUntradableCapeValue('/items/chance_cape', 8);
            getUntradableCapeValue('/items/chance_cape', 8);

            expect(mockCalculatePath).toHaveBeenCalledTimes(1);
        });

        test('works out another level or cape separately', () => {
            getUntradableCapeValue('/items/chance_cape', 8);
            getUntradableCapeValue('/items/chance_cape', 9);
            getUntradableCapeValue('/items/gatherer_cape', 8);

            expect(mockCalculatePath).toHaveBeenCalledTimes(3);
        });

        test('works it out again when the equipped gear or teas change', () => {
            getUntradableCapeValue('/items/chance_cape', 8);
            mockAutoParams.mockReturnValue({ source: 'auto-detected', enhancingLevel: 140 });
            getUntradableCapeValue('/items/chance_cape', 8);

            expect(mockCalculatePath).toHaveBeenCalledTimes(2);
        });

        test('works it out again when the cape setting or custom prices change', () => {
            getUntradableCapeValue('/items/chance_cape', 8);
            mockCapeMode.mockReturnValue('mirror');
            getUntradableCapeValue('/items/chance_cape', 8);
            mockOverrides.mockReturnValue({ '/items/mirror_of_protection:0': { sell: 1 } });
            getUntradableCapeValue('/items/chance_cape', 8);

            expect(mockCalculatePath).toHaveBeenCalledTimes(3);
        });

        test('works it out again after a market price update', () => {
            getUntradableCapeValue('/items/chance_cape', 8);
            marketListeners.forEach((listener) => listener());
            getUntradableCapeValue('/items/chance_cape', 8);

            expect(mockCalculatePath).toHaveBeenCalledTimes(2);
        });

        test('remembers a failed path too, so it is not retried on every recalculation', () => {
            mockCalculatePath.mockReturnValue(null);
            mockGetCapeBaseValue.mockReturnValue(5);

            expect(getUntradableCapeValue('/items/chance_cape', 8)).toBe(5);
            expect(getUntradableCapeValue('/items/chance_cape', 8)).toBe(5);
            expect(mockCalculatePath).toHaveBeenCalledTimes(1);
        });
    });
});
