import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockGetInitClientData,
    mockGetItemDetails,
    mockGetItemPrice,
    mockParseArtisanBonus,
    mockCalculateTotalRequired,
    mockGetArtisanMaterialMode,
} = vi.hoisted(() => ({
    mockGetInitClientData: vi.fn(),
    mockGetItemDetails: vi.fn(),
    mockGetItemPrice: vi.fn(),
    mockParseArtisanBonus: vi.fn(),
    mockCalculateTotalRequired: vi.fn((basePerAction, artisanBonus, numActions, artisanMode) => {
        const materialsPerAction = basePerAction * (1 - artisanBonus);
        if (artisanMode === 'worst-case') return Math.ceil(materialsPerAction) * numActions;
        return Math.ceil(materialsPerAction * numActions);
    }),
    mockGetArtisanMaterialMode: vi.fn(() => 'expected'),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: mockGetInitClientData,
        getItemDetails: mockGetItemDetails,
        getEquipment: vi.fn(() => new Map()),
        getActionDrinkSlots: vi.fn(() => []),
        getSkills: vi.fn(() => new Map()),
    },
}));
vi.mock('../../utils/market-data.js', () => ({ getItemPrice: mockGetItemPrice }));
vi.mock('../../utils/game-lookups.js', () => ({ getShopCoinCost: vi.fn(() => 0) }));
vi.mock('../../utils/tea-parser.js', () => ({
    parseArtisanBonus: mockParseArtisanBonus,
    getDrinkConcentration: vi.fn(() => 1),
}));
vi.mock('../../utils/action-calculator.js', () => ({ calculateActionStats: vi.fn() }));
vi.mock('../../utils/efficiency.js', () => ({ calculateEfficiencyMultiplier: vi.fn(() => 1) }));
vi.mock('../../utils/material-calculator.js', () => ({
    calculateTotalRequired: mockCalculateTotalRequired,
    getArtisanMaterialMode: mockGetArtisanMaterialMode,
}));

import { computeBestCraftingPlan } from './crafting-plan-calculator.js';

const BOOTS = '/items/reptile_boots';
const LEATHER = '/items/leather';
const STRAP = '/items/strap';
const BOOTS_ACTION = '/actions/tailoring/reptile_boots';
const STRAP_ACTION = '/actions/tailoring/strap';

function setGameData(actionDetailMap, itemDetailMap) {
    mockGetInitClientData.mockReturnValue({ actionDetailMap, itemDetailMap });
    mockGetItemDetails.mockImplementation((itemHrid) => itemDetailMap[itemHrid] || null);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockCalculateTotalRequired.mockImplementation((basePerAction, artisanBonus, numActions, artisanMode) => {
        const materialsPerAction = basePerAction * (1 - artisanBonus);
        if (artisanMode === 'worst-case') return Math.ceil(materialsPerAction) * numActions;
        return Math.ceil(materialsPerAction * numActions);
    });
    mockGetItemPrice.mockReturnValue(100);
});

describe('artisan-mode-aware material quantities (16 leather, 10% artisan bonus)', () => {
    beforeEach(() => {
        setGameData(
            {
                [BOOTS_ACTION]: {
                    type: '/action_types/tailoring',
                    category: '/action_types/tailoring',
                    outputItems: [{ itemHrid: BOOTS, count: 1 }],
                    inputItems: [{ itemHrid: LEATHER, count: 16 }],
                },
            },
            {
                [BOOTS]: { name: 'Reptile Boots', isTradable: false },
                [LEATHER]: { name: 'Leather', isTradable: true },
            }
        );
        mockParseArtisanBonus.mockReturnValue(0.1);
    });

    test('expected mode pools the reduction across the whole batch: 2 boots need 29, not 30', () => {
        mockGetArtisanMaterialMode.mockReturnValue('expected');
        const plan = computeBestCraftingPlan(BOOTS, 2, 'ask');
        expect(plan.children[0]).toMatchObject({ itemHrid: LEATHER, quantity: 29 });
    });

    test('worst-case mode ceils per action before multiplying: 2 boots need 30', () => {
        mockGetArtisanMaterialMode.mockReturnValue('worst-case');
        const plan = computeBestCraftingPlan(BOOTS, 2, 'ask');
        expect(plan.children[0]).toMatchObject({ itemHrid: LEATHER, quantity: 30 });
    });

    test('a single boot needs 15 leather under worst-case, matching per-action rounding', () => {
        mockGetArtisanMaterialMode.mockReturnValue('worst-case');
        const plan = computeBestCraftingPlan(BOOTS, 1, 'ask');
        expect(plan.children[0]).toMatchObject({ itemHrid: LEATHER, quantity: 15 });
    });
});

describe('memo-hit reconstruction applies the same artisan mode as a fresh computation', () => {
    beforeEach(() => {
        // Two separate recipe rows request the same craftable intermediate (STRAP) at different
        // quantities, forcing the second call to hit computeBestCraftingPlan's memo cache instead
        // of recomputing STRAP's decision from scratch.
        setGameData(
            {
                [BOOTS_ACTION]: {
                    type: '/action_types/tailoring',
                    category: '/action_types/tailoring',
                    outputItems: [{ itemHrid: BOOTS, count: 1 }],
                    inputItems: [
                        { itemHrid: STRAP, count: 4 },
                        { itemHrid: STRAP, count: 6 },
                    ],
                },
                [STRAP_ACTION]: {
                    type: '/action_types/tailoring',
                    category: '/action_types/tailoring',
                    outputItems: [{ itemHrid: STRAP, count: 1 }],
                    inputItems: [{ itemHrid: LEATHER, count: 5 }],
                },
            },
            {
                [BOOTS]: { name: 'Reptile Boots', isTradable: false },
                [STRAP]: { name: 'Strap', isTradable: false },
                [LEATHER]: { name: 'Leather', isTradable: true },
            }
        );
        mockParseArtisanBonus.mockReturnValue(0.1);
        mockGetArtisanMaterialMode.mockReturnValue('worst-case');
    });

    test('recomputes the memoized child quantity from basePerAction + the new actionsNeeded', () => {
        const plan = computeBestCraftingPlan(BOOTS, 1, 'ask');

        const [firstStrap, secondStrap] = plan.children;
        expect(firstStrap).toMatchObject({ itemHrid: STRAP, quantity: 4 });
        expect(secondStrap).toMatchObject({ itemHrid: STRAP, quantity: 6 });

        // Fresh computation for the first STRAP node: ceil(5 * 0.9) * 4 = 5 * 4 = 20.
        expect(firstStrap.children[0]).toMatchObject({ itemHrid: LEATHER, quantity: 20 });
        // Memo-hit reconstruction for the second STRAP node: ceil(5 * 0.9) * 6 = 5 * 6 = 30,
        // not the old continuous qtyPerUnit(4.5) * 6 = 27.
        expect(secondStrap.children[0]).toMatchObject({ itemHrid: LEATHER, quantity: 30 });
    });
});
