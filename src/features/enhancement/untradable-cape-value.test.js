import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockIsUntradableCape, mockGetCapeBaseValue, mockCalculatePath, mockGetRealisticPrice, mockAutoParams } =
    vi.hoisted(() => ({
        mockIsUntradableCape: vi.fn(),
        mockGetCapeBaseValue: vi.fn(),
        mockCalculatePath: vi.fn(),
        mockGetRealisticPrice: vi.fn(),
        mockAutoParams: vi.fn(),
    }));

vi.mock('../../utils/untradable-cape.js', () => ({
    isUntradableCape: mockIsUntradableCape,
    isRefinedCape: (hrid) => hrid.endsWith('_refined'),
    getCapeBaseValue: mockGetCapeBaseValue,
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

const { getUntradableCapeValue } = await import('./untradable-cape-value.js');

describe('getUntradableCapeValue', () => {
    beforeEach(() => {
        mockIsUntradableCape.mockReset().mockReturnValue(true);
        mockGetCapeBaseValue.mockReset().mockReturnValue(0);
        mockCalculatePath.mockReset().mockReturnValue(null);
        mockGetRealisticPrice.mockReset().mockReturnValue(0);
        mockAutoParams.mockReset().mockReturnValue({ source: 'auto-detected' });
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
});
