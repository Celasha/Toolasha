import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(() => ({ ask: 500, bid: 400 })),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn(() => ({ name: 'Test Item' })),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn(() => 'ask'),
    },
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: {
        isInitialized: false,
        getCachedValue: vi.fn(() => null),
        calculateSingleContainer: vi.fn(() => null),
        calculateExpectedValue: vi.fn(() => null),
    },
}));

import { calculateConsumableCosts, calculatePlayerStats } from './combat-stats-calculator.js';

describe('calculateConsumableCosts - timeToZeroSeconds zero-safe fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('preserves a legitimate timeToZeroSeconds of 0 (already out) instead of coercing to Infinity', () => {
        const consumables = [
            {
                itemHrid: '/items/coffee',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.001,
                elapsedSeconds: 3600,
                inventoryAmount: 0,
                timeToZeroSeconds: 0,
            },
        ];

        const { breakdown } = calculateConsumableCosts(consumables, 3600);

        expect(breakdown[0].timeToZeroSeconds).toBe(0);
    });

    test('still defaults to Infinity when timeToZeroSeconds is genuinely absent', () => {
        const consumables = [
            {
                itemHrid: '/items/coffee',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.001,
                elapsedSeconds: 3600,
                inventoryAmount: 400,
            },
        ];

        const { breakdown } = calculateConsumableCosts(consumables, 3600);

        expect(breakdown[0].timeToZeroSeconds).toBe(Infinity);
    });
});

describe('calculatePlayerStats - firstToRunOut', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function basePlayerData(consumables) {
        return {
            name: 'Self',
            loot: {},
            experience: {},
            deathCount: 0,
            consumables,
        };
    }

    test('picks the consumable with the soonest finite runway, ignoring Infinity entries', () => {
        const playerData = basePlayerData([
            {
                itemHrid: '/items/coffee',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.01,
                elapsedSeconds: 3600,
                inventoryAmount: 500,
                timeToZeroSeconds: 50000,
            },
            {
                itemHrid: '/items/yogurt',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.02,
                elapsedSeconds: 3600,
                inventoryAmount: 100,
                timeToZeroSeconds: 5000,
            },
            {
                itemHrid: '/items/tea',
                consumed: 0,
                actualConsumed: 0,
                consumedPerDay: 0,
                consumptionRate: 0,
                elapsedSeconds: 3600,
                inventoryAmount: 999,
                timeToZeroSeconds: Infinity,
            },
        ]);

        const stats = calculatePlayerStats(playerData, 3600);

        expect(stats.firstToRunOut.itemHrid).toBe('/items/yogurt');
        expect(stats.firstToRunOut.timeToZeroSeconds).toBe(5000);
    });

    test('is null when every consumable has an infinite/unknown runway', () => {
        const playerData = basePlayerData([
            {
                itemHrid: '/items/tea',
                consumed: 0,
                actualConsumed: 0,
                consumedPerDay: 0,
                consumptionRate: 0,
                elapsedSeconds: 3600,
                inventoryAmount: 999,
                timeToZeroSeconds: Infinity,
            },
        ]);

        const stats = calculatePlayerStats(playerData, 3600);

        expect(stats.firstToRunOut).toBeNull();
    });

    test('is null with no consumables at all', () => {
        const stats = calculatePlayerStats(basePlayerData([]), 3600);

        expect(stats.firstToRunOut).toBeNull();
    });

    test('a legitimate 0 (already out) beats a larger finite runway for soonest-to-run-out', () => {
        const playerData = basePlayerData([
            {
                itemHrid: '/items/coffee',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.01,
                elapsedSeconds: 3600,
                inventoryAmount: 500,
                timeToZeroSeconds: 50000,
            },
            {
                itemHrid: '/items/yogurt',
                consumed: 5,
                actualConsumed: 5,
                consumedPerDay: 10,
                consumptionRate: 0.02,
                elapsedSeconds: 3600,
                inventoryAmount: 0,
                timeToZeroSeconds: 0,
            },
        ]);

        const stats = calculatePlayerStats(playerData, 3600);

        expect(stats.firstToRunOut.itemHrid).toBe('/items/yogurt');
        expect(stats.firstToRunOut.timeToZeroSeconds).toBe(0);
    });
});
