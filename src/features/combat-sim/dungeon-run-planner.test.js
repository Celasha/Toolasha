import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ revenue: null, drops: new Map(), keyCosts: [] }));

vi.mock('./combat-sim-adapter.js', () => ({
    calculateSimRevenue: vi.fn((run, _gameData, _player, hours) => {
        mocks.lastRun = { run, hours };
        return mocks.revenue;
    }),
    calculateExpectedDrops: vi.fn(() => mocks.drops),
    calculateDungeonKeyCosts: vi.fn(() => mocks.keyCosts),
    resolveKeyPrice: vi.fn(),
}));

const { planDungeonRuns, communityDropQuantity } = await import('./dungeon-run-planner.js');
const adapter = await import('./combat-sim-adapter.js');

describe('communityDropQuantity', () => {
    const detail = { buff: { flatBoost: 0.2, flatBoostLevelBonus: 0.005 } };

    test('is the flat boost plus the level bonus for each level after the first', () => {
        expect(communityDropQuantity(detail, 1)).toBeCloseTo(0.2, 5);
        expect(communityDropQuantity(detail, 20)).toBeCloseTo(0.295, 5);
    });

    test('is nothing when the buff is not active or unknown', () => {
        expect(communityDropQuantity(detail, 0)).toBe(0);
        expect(communityDropQuantity(undefined, 5)).toBe(0);
    });
});

describe('planDungeonRuns', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.revenue = {
            revenuePerHour: 1000,
            keyCostPerHour: 100,
            hasMissingPrices: false,
            dropEntries: [{ name: 'Chest', countPerHour: 2, unitValue: 500, totalValue: 1000, isOutlier: false }],
        };
        mocks.keyCosts = [
            { itemHrid: '/items/entry_key', count: 30, unitCost: 10, totalCost: 300 },
            { itemHrid: '/items/chest_key', count: 30, unitCost: 20, totalCost: 600 },
        ];
    });

    const plan = (overrides = {}) =>
        planDungeonRuns({
            gameData: {},
            dungeonHrid: '/actions/combat/chimerical_den',
            tier: 1,
            players: 5,
            minutesPerRun: 30,
            dropQuantity: 0.295,
            ...overrides,
        });

    test('a run every 30 minutes is 48 runs a day, handed to the simulator maths as that many completions over 24 hours', () => {
        const result = plan();

        expect(result.runsPerDay).toBe(48);
        expect(mocks.lastRun.hours).toBe(24);
        expect(mocks.lastRun.run).toMatchObject({
            isDungeon: true,
            dungeonsCompleted: 48,
            zoneName: '/actions/combat/chimerical_den',
            numberOfPlayers: 5,
            difficultyTier: 1,
            combatDropQuantity: { player1: 0.295 },
        });
    });

    test('per day figures are the simulator per hour figures times 24, and net takes off keys and consumables', () => {
        const result = plan({ consumablesPerDay: 5000 });

        expect(result.chestValuePerDay).toBe(24000);
        expect(result.keyCostPerDay).toBe(2400);
        expect(result.netPerDay).toBe(24000 - 2400 - 5000);
        expect(result.keysPerDay).toBe(60);
        expect(result.drops[0]).toMatchObject({ name: 'Chest', countPerDay: 48, valuePerDay: 24000 });
    });

    test('keys are priced with the key pricing setting', () => {
        plan();

        expect(adapter.calculateDungeonKeyCosts).toHaveBeenCalledWith(mocks.drops, adapter.resolveKeyPrice);
    });

    test('a party size below 1 counts as solo, and a bad run length gives no plan', () => {
        plan({ players: 0 });
        expect(mocks.lastRun.run.numberOfPlayers).toBe(1);
        expect(plan({ minutesPerRun: 0 })).toBeNull();
        expect(plan({ minutesPerRun: NaN })).toBeNull();
    });

    test('passes along that some prices were missing', () => {
        mocks.revenue = { ...mocks.revenue, hasMissingPrices: true };

        expect(plan().hasMissingPrices).toBe(true);
    });
});
