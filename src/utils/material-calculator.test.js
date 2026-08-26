import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockGetActionDetails,
    mockGetCurrentActions,
    mockGetInventory,
    mockGetInitClientData,
    mockGetActionDrinkSlots,
    mockResolveActionContext,
    mockParseArtisanBonus,
} = vi.hoisted(() => ({
    mockGetActionDetails: vi.fn(),
    mockGetCurrentActions: vi.fn(),
    mockGetInventory: vi.fn(),
    mockGetInitClientData: vi.fn(),
    mockGetActionDrinkSlots: vi.fn(),
    mockResolveActionContext: vi.fn(),
    mockParseArtisanBonus: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn(() => 'expected'),
    },
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getActionDetails: mockGetActionDetails,
        getCurrentActions: mockGetCurrentActions,
        getInventory: mockGetInventory,
        getInitClientData: mockGetInitClientData,
        getActionDrinkSlots: mockGetActionDrinkSlots,
    },
}));

vi.mock('./tea-parser.js', () => ({
    parseArtisanBonus: mockParseArtisanBonus,
    getDrinkConcentration: vi.fn(() => 1),
}));

vi.mock('./action-context.js', () => ({
    resolveActionContext: mockResolveActionContext,
}));

vi.mock('./enhancement-config.js', () => ({ getEnhancingParams: vi.fn() }));
vi.mock('./enhancement-calculator.js', () => ({ calculateEnhancement: vi.fn() }));

import {
    calculateMaterialRequirements,
    calculateQueuedMaterialsForAction,
    isArtisanTeaOutOfStock,
} from './material-calculator.js';

const SUGAR = '/items/sugar';
const CAKE = '/actions/cooking/marsberry_cake';
const DONUT = '/actions/cooking/marsberry_donut';

describe('material-calculator queue reservations', () => {
    beforeEach(() => {
        mockGetActionDetails.mockImplementation((actionHrid) => {
            if (actionHrid === CAKE) {
                return {
                    hrid: CAKE,
                    type: '/action_types/cooking',
                    inputItems: [{ itemHrid: SUGAR, count: 2 }],
                };
            }
            if (actionHrid === DONUT) {
                return {
                    hrid: DONUT,
                    type: '/action_types/cooking',
                    inputItems: [{ itemHrid: SUGAR, count: 4 }],
                };
            }
            return null;
        });
        mockGetCurrentActions.mockReturnValue([
            {
                actionHrid: DONUT,
                hasMaxCount: true,
                maxCount: 1000,
                currentCount: 176,
            },
        ]);
        mockGetInventory.mockReturnValue([
            {
                itemHrid: SUGAR,
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 0,
                count: 4758,
            },
        ]);
        mockGetInitClientData.mockReturnValue({
            itemDetailMap: {
                [SUGAR]: { name: 'Sugar', isTradable: true },
            },
        });
        mockResolveActionContext.mockReturnValue({ equipment: new Map(), drinks: [], source: 'current' });
        mockParseArtisanBonus.mockReturnValue(0.1);
    });

    test('matches the reported Marsberry queue math exactly', () => {
        const queued = calculateQueuedMaterialsForAction();
        expect(queued.get(SUGAR)).toBe(2967); // ceil(824 remaining × 4 × 0.9)

        const [sugar] = calculateMaterialRequirements(CAKE, 1000, true);
        expect(sugar).toMatchObject({
            required: 1800,
            have: 4758,
            queued: 2967,
            available: 1791,
            missing: 9,
        });
    });

    test('ignoring the queue leaves the same inventory fully available', () => {
        const [sugar] = calculateMaterialRequirements(CAKE, 1000, false);
        expect(sugar).toMatchObject({
            required: 1800,
            have: 4758,
            queued: 0,
            available: 4758,
            missing: 0,
        });
    });
});

describe('isArtisanTeaOutOfStock', () => {
    const ARTISAN_TEA = '/items/artisan_tea';

    beforeEach(() => {
        mockGetActionDetails.mockReturnValue({ hrid: CAKE, type: '/action_types/cooking' });
        mockGetInitClientData.mockReturnValue({ itemDetailMap: { [ARTISAN_TEA]: { name: 'Artisan Tea' } } });
        mockGetActionDrinkSlots.mockReturnValue([{ itemHrid: ARTISAN_TEA }]);
    });

    test('reports out of stock when the same live drink slot resolves to no bonus (current gear)', () => {
        mockResolveActionContext.mockReturnValue({ equipment: new Map(), drinks: [], source: 'current' });
        // rawDrinks (slotted) has a bonus, inStockDrinks (stock-filtered) does not
        mockParseArtisanBonus.mockImplementation((drinks) => (drinks.length > 0 ? 0.1 : 0));

        expect(isArtisanTeaOutOfStock(CAKE)).toBe(true);
    });

    test('is never reported when the calculation is sourced from a saved loadout', () => {
        // A saved loadout can only be selected when every consumable slot is confirmed
        // available, so its own configured drinks can never legitimately be "out of stock".
        // Comparing them against the character's unrelated live drink slots is a false positive.
        mockResolveActionContext.mockReturnValue({
            equipment: new Map(),
            drinks: [{ itemHrid: '/items/other_tea' }],
            source: 'saved-loadout',
        });
        mockParseArtisanBonus.mockImplementation((drinks) =>
            drinks.some((d) => d.itemHrid === ARTISAN_TEA) ? 0.1 : 0
        );

        expect(isArtisanTeaOutOfStock(CAKE)).toBe(false);
    });

    test('reports false when the live drink slot is actually in stock', () => {
        mockResolveActionContext.mockReturnValue({
            equipment: new Map(),
            drinks: [{ itemHrid: ARTISAN_TEA }],
            source: 'current',
        });
        mockParseArtisanBonus.mockReturnValue(0.1);

        expect(isArtisanTeaOutOfStock(CAKE)).toBe(false);
    });
});
