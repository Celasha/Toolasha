import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    houseRoomDetailMap: {},
    askPrices: {},
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ houseRoomDetailMap: mocks.houseRoomDetailMap })),
    },
}));

vi.mock('../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(() => ({ ask: -1, bid: -1 })),
    },
}));

vi.mock('./market-data.js', () => ({
    getItemPrice: vi.fn((itemHrid) => mocks.askPrices[itemHrid] ?? -1),
}));

import {
    getHouseRoomDomain,
    calculateHouseRoomCostAskOnly,
    calculateHousesCostByDomain,
} from './house-cost-calculator.js';

describe('getHouseRoomDomain - data-driven from usableInActionTypeMap (TLA-041 / PB-08)', () => {
    beforeEach(() => {
        mocks.houseRoomDetailMap = {
            '/house_rooms/dojo': { name: 'Dojo', usableInActionTypeMap: { '/action_types/combat': true } },
            '/house_rooms/garden': { name: 'Garden', usableInActionTypeMap: { '/action_types/foraging': true } },
        };
    });

    test('a room usable for combat classifies as combat', () => {
        expect(getHouseRoomDomain('/house_rooms/dojo')).toBe('combat');
    });

    test('a room usable only for a skilling action type classifies as skilling', () => {
        expect(getHouseRoomDomain('/house_rooms/garden')).toBe('skilling');
    });

    test('an unknown room returns null rather than guessing a domain', () => {
        expect(getHouseRoomDomain('/house_rooms/nonexistent')).toBeNull();
    });
});

describe('calculateHouseRoomCostAskOnly - pure Ask pricing (TLA-041 / F-10)', () => {
    beforeEach(() => {
        mocks.houseRoomDetailMap = {
            '/house_rooms/dojo': {
                name: 'Dojo',
                usableInActionTypeMap: { '/action_types/combat': true },
                upgradeCostsMap: { 1: [{ itemHrid: '/items/plank', count: 100 }] },
            },
        };
        mocks.askPrices = { '/items/plank': 1000 };
    });

    test('F-10: 100 units at Ask 1,000 (Bid 400 ignored) costs exactly 100,000, never the 70,000 midpoint', () => {
        const result = calculateHouseRoomCostAskOnly('/house_rooms/dojo', 1);
        expect(result).toEqual({ cost: 100000, complete: true });
    });

    test('coins are priced at face value 1, not looked up on the market', () => {
        mocks.houseRoomDetailMap['/house_rooms/dojo'].upgradeCostsMap = {
            1: [{ itemHrid: '/items/coin', count: 500 }],
        };
        const result = calculateHouseRoomCostAskOnly('/house_rooms/dojo', 1);
        expect(result).toEqual({ cost: 500, complete: true });
    });

    test('a required material with no positive Ask marks the room incomplete, not silently zero', () => {
        mocks.askPrices = {};
        const result = calculateHouseRoomCostAskOnly('/house_rooms/dojo', 1);
        expect(result.complete).toBe(false);
    });

    test('a missing level entry within the requested range marks the room incomplete', () => {
        const result = calculateHouseRoomCostAskOnly('/house_rooms/dojo', 2);
        expect(result.complete).toBe(false);
    });

    test('unknown room returns incomplete with zero cost', () => {
        expect(calculateHouseRoomCostAskOnly('/house_rooms/nonexistent', 1)).toEqual({ cost: 0, complete: false });
    });
});

describe('calculateHousesCostByDomain - sums only owned rooms in the requested domain', () => {
    beforeEach(() => {
        mocks.houseRoomDetailMap = {
            '/house_rooms/dojo': {
                name: 'Dojo',
                usableInActionTypeMap: { '/action_types/combat': true },
                upgradeCostsMap: { 1: [{ itemHrid: '/items/plank', count: 10 }] },
            },
            '/house_rooms/garden': {
                name: 'Garden',
                usableInActionTypeMap: { '/action_types/foraging': true },
                upgradeCostsMap: { 1: [{ itemHrid: '/items/seed', count: 10 }] },
            },
        };
        mocks.askPrices = { '/items/plank': 100, '/items/seed': 50 };
    });

    test('combat domain sums only the combat room, skilling room excluded', () => {
        const rooms = { '/house_rooms/dojo': { level: 1 }, '/house_rooms/garden': { level: 1 } };
        const result = calculateHousesCostByDomain(rooms, 'combat');
        expect(result.totalCost).toBe(1000);
        expect(result.breakdown).toEqual([{ name: 'Dojo', level: 1, cost: 1000, complete: true }]);
    });

    test('skilling domain sums only the skilling room, combat room excluded', () => {
        const rooms = { '/house_rooms/dojo': { level: 1 }, '/house_rooms/garden': { level: 1 } };
        const result = calculateHousesCostByDomain(rooms, 'skilling');
        expect(result.totalCost).toBe(500);
        expect(result.breakdown).toEqual([{ name: 'Garden', level: 1, cost: 500, complete: true }]);
    });

    test('a room owned at level 0 is not counted', () => {
        const rooms = { '/house_rooms/dojo': { level: 0 } };
        const result = calculateHousesCostByDomain(rooms, 'combat');
        expect(result.totalCost).toBe(0);
        expect(result.breakdown).toEqual([]);
    });

    test('an incomplete room propagates incompleteness to the domain total', () => {
        mocks.askPrices = {};
        const rooms = { '/house_rooms/dojo': { level: 1 } };
        const result = calculateHousesCostByDomain(rooms, 'combat');
        expect(result.complete).toBe(false);
    });
});
