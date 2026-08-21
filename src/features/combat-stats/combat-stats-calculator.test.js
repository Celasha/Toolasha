import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn(() => ({ ask: 500, bid: 400 })),
        on: vi.fn(),
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
        resolveSellSideValue: vi.fn(() => null),
    },
}));

import { calculateConsumableCosts, calculatePlayerStats, calculateValuedRevenue } from './combat-stats-calculator.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import dataManager from '../../core/data-manager.js';

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

describe('calculateValuedRevenue - shared Actual/Expected valuation semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        expectedValueCalculator.resolveSellSideValue.mockReset();
        dataManager.getItemDetails.mockReset().mockReturnValue({ name: 'Test Item', isTradable: true });
    });

    test('applies market tax when the resolver says needsTax is true', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const { revenue } = calculateValuedRevenue([{ itemHrid: '/items/log', count: 10 }]);

        expect(revenue).toBeCloseTo(100 * 0.95 * 10, 5); // MARKET_TAX = 0.05
    });

    test('does not apply tax for an openable valued via Expected Value (needsTax false)', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({
            value: 5000,
            source: 'expectedValue',
            needsTax: false,
        });

        const { revenue } = calculateValuedRevenue([{ itemHrid: '/items/chimerical_chest', count: 2 }]);

        expect(revenue).toBe(10000);
    });

    test('does not apply tax to a non-tradable item even when needsTax is true', () => {
        dataManager.getItemDetails.mockReturnValue({ name: 'Test Item', isTradable: false });
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: true });

        const { revenue } = calculateValuedRevenue([{ itemHrid: '/items/log', count: 10 }]);

        expect(revenue).toBe(1000);
    });

    test('marks the result partial and lists the item when valuation is unavailable, never treating it as a silent zero', () => {
        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) =>
            itemHrid === '/items/known' ? { value: 10, source: 'market', needsTax: false } : null
        );

        const { revenue, isPartial, unvaluedItemHrids } = calculateValuedRevenue([
            { itemHrid: '/items/known', count: 5 },
            { itemHrid: '/items/unknown', count: 3 },
        ]);

        expect(revenue).toBe(50);
        expect(isPartial).toBe(true);
        expect(unvaluedItemHrids).toEqual(['/items/unknown']);
    });

    test('is not partial when every item resolves successfully', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, source: 'market', needsTax: false });

        const { isPartial, unvaluedItemHrids } = calculateValuedRevenue([{ itemHrid: '/items/known', count: 1 }]);

        expect(isPartial).toBe(false);
        expect(unvaluedItemHrids).toEqual([]);
    });

    test('skips zero/falsy-count items without querying valuation', () => {
        calculateValuedRevenue([{ itemHrid: '/items/log', count: 0 }]);

        expect(expectedValueCalculator.resolveSellSideValue).not.toHaveBeenCalled();
    });
});

describe('calculatePlayerStats - actualVsExpected (RNG Delta)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 100, source: 'market', needsTax: false });
        dataManager.getItemDetails.mockReturnValue({ name: 'Test Item', isTradable: true });
    });

    function basePlayerData(loot = {}) {
        return { name: 'Self', loot, experience: {}, deathCount: 0, consumables: [] };
    }

    test('is null when no expected-loot data is supplied (party members, or no completed encounters)', () => {
        const stats = calculatePlayerStats(basePlayerData(), 3600, null);
        expect(stats.actualVsExpected).toBeNull();
    });

    test('is null when the sample size is zero (no fabricated economics from zero completed encounters)', () => {
        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map(),
            sampleSize: 0,
            elapsedSeconds: 3600,
            actualLootSinceTracking: [],
        });
        expect(stats.actualVsExpected).toBeNull();
    });

    test('is null when elapsedSeconds is zero (tracker never actually observed a time window)', () => {
        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([['/items/log', 10]]),
            sampleSize: 5,
            elapsedSeconds: 0,
            actualLootSinceTracking: [{ itemHrid: '/items/log', count: 20 }],
        });

        expect(stats.actualVsExpected).toBeNull();
    });

    test('is null for dungeons even with a full sample - the current player totalLootMap Combat Stats observes never reflects a dungeon completion reward, so Actual cannot be proven correct there', () => {
        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([['/items/dungeon_reward', 2]]),
            sampleSize: 3,
            elapsedSeconds: 3600,
            actualLootSinceTracking: [],
            isDungeon: true,
        });

        expect(stats.actualVsExpected).toBeNull();
    });

    test('computes a positive RNG delta when actual loot outvalues expected loot over the same window', () => {
        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([['/items/log', 10]]),
            sampleSize: 5,
            elapsedSeconds: 3600,
            actualLootSinceTracking: [{ itemHrid: '/items/log', count: 20 }],
        });

        expect(stats.actualVsExpected.rngDeltaValue).toBeGreaterThan(0);
        expect(stats.actualVsExpected.sampleSize).toBe(5);
        expect(stats.actualVsExpected.elapsedSeconds).toBe(3600);
    });

    test('never uses the whole-session totalLootMap for Actual - only actualLootSinceTracking', () => {
        // playerData.loot represents a much longer whole-session total than the tracker's own
        // short observed window; the comparison must ignore it entirely and use only the
        // window-scoped actualLootSinceTracking, or Actual and Expected would cover different
        // samples again.
        const stats = calculatePlayerStats(
            basePlayerData({ '/items/log': { itemHrid: '/items/log', count: 999999 } }),
            3600,
            {
                expectedDropsMap: new Map([['/items/log', 10]]),
                sampleSize: 5,
                elapsedSeconds: 3600,
                actualLootSinceTracking: [{ itemHrid: '/items/log', count: 20 }],
            }
        );

        // 20 units * value 100 = 2000 over a 1-hour window, scaled to a full day: 2000 * 24 = 48000
        // (not 999999 * 100, which would be the whole-session totalLootMap the fix must ignore)
        expect(stats.actualVsExpected.actualRevenuePerDay).toBeCloseTo(48000, 0);
    });

    test('scales both Actual and Expected Revenue/day against the same tracker-observed window, not the whole combat session duration', () => {
        // The combat session has been running for 10 hours (e.g. the script attached mid-fight),
        // but the expected-loot tracker has only actually observed 60 seconds of that. Using the
        // session duration as the denominator for either side would mis-scale it relative to the
        // other by whatever ratio the two windows differ by.
        const sessionDurationSeconds = 10 * 3600;
        const trackerElapsedSeconds = 60;

        const stats = calculatePlayerStats(basePlayerData(), sessionDurationSeconds, {
            expectedDropsMap: new Map([['/items/log', 1]]),
            sampleSize: 1,
            elapsedSeconds: trackerElapsedSeconds,
            actualLootSinceTracking: [{ itemHrid: '/items/log', count: 1 }],
        });

        // 1 unit * value 100, scaled to a full day from a 60-second window: 100 * 86400/60 = 144000
        expect(stats.actualVsExpected.expectedRevenuePerDay).toBeCloseTo(144000, 0);
        expect(stats.actualVsExpected.actualRevenuePerDay).toBeCloseTo(144000, 0);
        expect(stats.actualVsExpected.rngDeltaValue).toBeCloseTo(0, 0);
    });

    test('sorts the item delta table by absolute value delta, not percent', () => {
        expectedValueCalculator.resolveSellSideValue.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/rare_tiny') return { value: 1000000, source: 'market', needsTax: false };
            return { value: 1, source: 'market', needsTax: false };
        });

        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([
                ['/items/common_bulk', 500],
                ['/items/rare_tiny', 0.001],
            ]),
            sampleSize: 5,
            elapsedSeconds: 3600,
            actualLootSinceTracking: [
                { itemHrid: '/items/common_bulk', count: 1000 },
                { itemHrid: '/items/rare_tiny', count: 1 },
            ],
        });

        // common_bulk delta = (1000-500)*1 = 500; rare_tiny delta = (1-0.001)*1e6 ~= 999000 - bigger, sorts first
        expect(stats.actualVsExpected.itemDeltas[0].itemHrid).toBe('/items/rare_tiny');
    });

    test('the item delta table is scaled to the same /day basis as the headline, so its rows sum to the Loot Luck delta', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, source: 'market', needsTax: false });

        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([['/items/log', 5]]),
            sampleSize: 3,
            elapsedSeconds: 1800, // 30-minute window
            actualLootSinceTracking: [{ itemHrid: '/items/log', count: 8 }],
        });

        const tableSum = stats.actualVsExpected.itemDeltas.reduce((sum, item) => sum + item.valueDelta, 0);

        expect(tableSum).toBeCloseTo(stats.actualVsExpected.rngDeltaValue, 5);
    });

    test('scaling to /day surfaces a small fractional expected quantity instead of rounding it away', () => {
        expectedValueCalculator.resolveSellSideValue.mockReturnValue({ value: 10, source: 'market', needsTax: false });

        // Over a 2-minute window, a rare drop expected only 0.001 times still exists at that
        // window scale - scaled to /day (x720) it becomes a visible, non-zero quantity.
        const stats = calculatePlayerStats(basePlayerData(), 3600, {
            expectedDropsMap: new Map([['/items/rare_drop', 0.001]]),
            sampleSize: 1,
            elapsedSeconds: 120,
            actualLootSinceTracking: [],
        });

        const row = stats.actualVsExpected.itemDeltas.find((item) => item.itemHrid === '/items/rare_drop');
        expect(row.expectedCount).toBeCloseTo(0.72, 5);
    });
});
