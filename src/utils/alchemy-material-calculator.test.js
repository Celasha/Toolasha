import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetItemDetails, mockGetInventory, mockGetCurrentActions, mockQueuedMaterials } = vi.hoisted(() => ({
    mockGetItemDetails: vi.fn(),
    mockGetInventory: vi.fn(),
    mockGetCurrentActions: vi.fn(),
    mockQueuedMaterials: vi.fn(),
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getItemDetails: mockGetItemDetails,
        getInventory: mockGetInventory,
        getCurrentActions: mockGetCurrentActions,
    },
}));

vi.mock('./material-calculator.js', () => ({
    calculateQueuedMaterialsForAction: mockQueuedMaterials,
}));

import {
    calculateAlchemyMaterialRequirements,
    getAlchemyItemsPerAction,
    parseInventoryItemHash,
} from './alchemy-material-calculator.js';

const LEAF = '/items/emp_tea_leaf';

describe('alchemy-material-calculator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetItemDetails.mockReturnValue({
            name: 'Emp Tea Leaf',
            isTradable: true,
            alchemyDetail: { bulkMultiplier: 2 },
        });
        mockGetInventory.mockReturnValue([{ itemHrid: LEAF, count: 2798, enhancementLevel: 0 }]);
        mockGetCurrentActions.mockReturnValue([]);
        mockQueuedMaterials.mockReturnValue(new Map());
    });

    test('parseInventoryItemHash reads the item and enhancement level', () => {
        expect(parseInventoryItemHash(`123::/item_locations/inventory::${LEAF}::0`)).toEqual({
            itemHrid: LEAF,
            enhancementLevel: 0,
        });
        expect(parseInventoryItemHash('garbage')).toBeNull();
        expect(parseInventoryItemHash(null)).toBeNull();
    });

    test('items per action comes from bulkMultiplier and defaults to 1', () => {
        expect(getAlchemyItemsPerAction(LEAF)).toBe(2);
        mockGetItemDetails.mockReturnValue({ name: 'x', alchemyDetail: {} });
        expect(getAlchemyItemsPerAction(LEAF)).toBe(1);
        mockGetItemDetails.mockReturnValue(undefined);
        expect(getAlchemyItemsPerAction(LEAF)).toBe(1);
    });

    test('required is the repeat count times items per action and missing is the shortfall', () => {
        const [material] = calculateAlchemyMaterialRequirements(LEAF, 5000);

        expect(material).toMatchObject({
            itemHrid: LEAF,
            required: 10000,
            have: 2798,
            missing: 7202,
            isTradeable: true,
        });
    });

    test('nothing is missing when inventory covers the repeat count', () => {
        const [material] = calculateAlchemyMaterialRequirements(LEAF, 1000);

        expect(material.missing).toBe(0);
    });

    test('enhanced copies do not count toward the unenhanced requirement', () => {
        mockGetInventory.mockReturnValue([
            { itemHrid: LEAF, count: 10, enhancementLevel: 0 },
            { itemHrid: LEAF, count: 500, enhancementLevel: 3 },
        ]);

        const [material] = calculateAlchemyMaterialRequirements(LEAF, 100);

        expect(material.have).toBe(10);
        expect(material.missing).toBe(190);
    });

    test('queued reservations are subtracted only when accounting for the queue', () => {
        mockQueuedMaterials.mockReturnValue(new Map([[LEAF, 100]]));
        mockGetCurrentActions.mockReturnValue([
            {
                hasMaxCount: true,
                maxCount: 60,
                currentCount: 10,
                primaryItemHash: `1::/item_locations/inventory::${LEAF}::0`,
            },
            { hasMaxCount: false, primaryItemHash: `1::/item_locations/inventory::${LEAF}::0` },
            {
                hasMaxCount: true,
                maxCount: 9,
                currentCount: 0,
                primaryItemHash: `1::/item_locations/inventory::${LEAF}::2`,
            },
        ]);

        expect(calculateAlchemyMaterialRequirements(LEAF, 1500, false)[0].queued).toBe(0);
        const [material] = calculateAlchemyMaterialRequirements(LEAF, 1500, true);

        expect(material.queued).toBe(100 + 50 * 2);
        expect(material.available).toBe(2798 - 200);
        expect(material.missing).toBe(3000 - (2798 - 200));
    });

    test('returns nothing for an unknown item or a non-positive repeat count', () => {
        expect(calculateAlchemyMaterialRequirements(LEAF, 0)).toEqual([]);
        mockGetItemDetails.mockReturnValue(undefined);
        expect(calculateAlchemyMaterialRequirements(LEAF, 10)).toEqual([]);
    });
});
