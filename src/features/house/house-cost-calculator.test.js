import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetInitClientData, mockGetItemPrice } = vi.hoisted(() => ({
    mockGetInitClientData: vi.fn(),
    mockGetItemPrice: vi.fn(),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: mockGetInitClientData,
        getHouseRoomLevel: vi.fn(),
        getInventory: vi.fn(),
    },
}));
vi.mock('../../api/marketplace.js', () => ({
    default: {
        isLoaded: vi.fn(() => true),
        fetch: vi.fn(),
    },
}));
vi.mock('../../utils/market-data.js', () => ({ getItemPrice: mockGetItemPrice }));

import houseCostCalculator from './house-cost-calculator.js';

const ROOM = '/house_rooms/kitchen';
const SUGAR = '/items/sugar';

beforeEach(() => {
    vi.clearAllMocks();
    mockGetInitClientData.mockReturnValue({
        houseRoomDetailMap: {
            [ROOM]: {
                upgradeCostsMap: {
                    2: [
                        { itemHrid: '/items/coin', count: 2_000_000 },
                        { itemHrid: SUGAR, count: 8_000 },
                    ],
                    3: [
                        { itemHrid: '/items/coin', count: 5_000_000 },
                        { itemHrid: SUGAR, count: 20_000 },
                    ],
                },
            },
        },
        itemDetailMap: {
            [SUGAR]: { sellPrice: 2 },
        },
    });
    mockGetItemPrice.mockReturnValue(13);
});

describe('HouseCostCalculator market pricing', () => {
    test('uses ask prices for every purchased construction material', async () => {
        const result = await houseCostCalculator.calculateCumulativeCost(ROOM, 1, 3);

        expect(mockGetItemPrice).toHaveBeenCalledTimes(2);
        expect(mockGetItemPrice).toHaveBeenNthCalledWith(1, SUGAR, { mode: 'ask' });
        expect(mockGetItemPrice).toHaveBeenNthCalledWith(2, SUGAR, { mode: 'ask' });
        expect(result).toMatchObject({
            coins: 7_000_000,
            materials: [
                {
                    itemHrid: SUGAR,
                    count: 28_000,
                    marketPrice: 13,
                    totalValue: 364_000,
                },
            ],
            totalValue: 7_364_000,
        });
    });
});
