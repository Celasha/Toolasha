import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetActionDetails, mockGetCurrentActions, mockGetInventory, mockGetInitClientData } = vi.hoisted(() => ({
    mockGetActionDetails: vi.fn(),
    mockGetCurrentActions: vi.fn(),
    mockGetInventory: vi.fn(),
    mockGetInitClientData: vi.fn(),
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
    },
}));

vi.mock('./tea-parser.js', () => ({
    parseArtisanBonus: vi.fn(() => 0.1),
    getDrinkConcentration: vi.fn(() => 1),
}));

vi.mock('./action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [] })),
}));

vi.mock('./enhancement-config.js', () => ({ getEnhancingParams: vi.fn() }));
vi.mock('./enhancement-calculator.js', () => ({ calculateEnhancement: vi.fn() }));

import { calculateMaterialRequirements, calculateQueuedMaterialsForAction } from './material-calculator.js';

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
