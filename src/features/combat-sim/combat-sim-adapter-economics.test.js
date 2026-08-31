import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    resolveSellSideValue: vi.fn(),
    marketPrices: {},
    itemDetails: {},
    combatMonsterDetailMap: {},
    actionDetailMap: {},
}));

vi.mock('../../api/marketplace.js', () => ({
    default: {
        getPrice: vi.fn((itemHrid) => mocks.marketPrices[itemHrid] || null),
        on: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn((itemHrid) => mocks.itemDetails[itemHrid] || null),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn(() => 'hybrid'),
    },
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: {
        resolveSellSideValue: (...args) => mocks.resolveSellSideValue(...args),
    },
}));

import { calculateSimRevenue } from './combat-sim-adapter.js';

function simResult(overrides = {}) {
    return {
        deaths: {},
        dropRateMultiplier: {},
        rareFindMultiplier: {},
        combatDropQuantity: {},
        debuffOnLevelGap: {},
        numberOfPlayers: 1,
        difficultyTier: 0,
        isDungeon: false,
        consumablesUsed: {},
        ...overrides,
    };
}

describe('calculateSimRevenue - canonical sell-side valuation + tax reuse (CSIM-AUD-012)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.marketPrices = {};
        mocks.itemDetails = {};
    });

    test('applies market tax to a resolved sell value that needsTax', () => {
        mocks.resolveSellSideValue.mockReturnValue({ value: 1000, source: 'market', needsTax: true });
        const gameData = { combatMonsterDetailMap: { '/monsters/bear': { dropTable: [] } } };
        const result = simResult({ deaths: { '/monsters/bear': 10 } });
        gameData.combatMonsterDetailMap['/monsters/bear'].dropTable = [
            { itemHrid: '/items/gold_ore', dropRate: 1, minCount: 1, maxCount: 1, minDifficultyTier: 0 },
        ];

        const revenue = calculateSimRevenue(result, gameData, 'player1', 10);

        // 10 kills * 1 gold_ore each = 10 total / 10 hours = 1/hr, * (1000 * 0.95 tax) = 950/hr
        expect(revenue.revenuePerHour).toBeCloseTo(950);
    });

    test('does not apply tax when resolveSellSideValue says needsTax is false (e.g. Coin)', () => {
        mocks.resolveSellSideValue.mockReturnValue({ value: 1, source: 'coin', needsTax: false });
        const gameData = {
            combatMonsterDetailMap: {
                '/monsters/bear': {
                    dropTable: [
                        { itemHrid: '/items/coin', dropRate: 1, minCount: 100, maxCount: 100, minDifficultyTier: 0 },
                    ],
                },
            },
        };
        const result = simResult({ deaths: { '/monsters/bear': 1 } });

        const revenue = calculateSimRevenue(result, gameData, 'player1', 1);
        expect(revenue.revenuePerHour).toBeCloseTo(100);
    });

    test('an unresolvable price is excluded from revenue and flags hasMissingPrices, never a silent exact-looking zero (CSIM-AUD-013)', () => {
        mocks.resolveSellSideValue.mockReturnValue(null);
        const gameData = {
            combatMonsterDetailMap: {
                '/monsters/bear': {
                    dropTable: [
                        { itemHrid: '/items/unpriced', dropRate: 1, minCount: 1, maxCount: 1, minDifficultyTier: 0 },
                    ],
                },
            },
        };
        const result = simResult({ deaths: { '/monsters/bear': 1 } });

        const revenue = calculateSimRevenue(result, gameData, 'player1', 1);
        expect(revenue.revenuePerHour).toBe(0);
        expect(revenue.hasMissingPrices).toBe(true);
    });

    test('hasMissingPrices is false when every drop resolves', () => {
        mocks.resolveSellSideValue.mockReturnValue({ value: 10, source: 'market', needsTax: false });
        const gameData = {
            combatMonsterDetailMap: {
                '/monsters/bear': {
                    dropTable: [
                        { itemHrid: '/items/log', dropRate: 1, minCount: 1, maxCount: 1, minDifficultyTier: 0 },
                    ],
                },
            },
        };
        const result = simResult({ deaths: { '/monsters/bear': 1 } });

        const revenue = calculateSimRevenue(result, gameData, 'player1', 1);
        expect(revenue.hasMissingPrices).toBe(false);
    });
});

describe('calculateSimRevenue - dungeon key cost included in own return (CSIM-AUD-014)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.marketPrices = { '/items/chimerical_entry_key': { ask: 50, bid: 40 } };
    });

    test('a dungeon result folds key cost into costPerHour/netPerHour and reports keyCostPerHour explicitly', () => {
        mocks.resolveSellSideValue.mockReturnValue({ value: 0, source: 'market', needsTax: false });
        const gameData = {
            actionDetailMap: {
                '/actions/combat/chimerical_dungeon': {
                    combatZoneInfo: {
                        dungeonInfo: {
                            rewardDropTable: [
                                {
                                    itemHrid: '/items/chimerical_chest',
                                    dropRate: 1,
                                    minCount: 1,
                                    maxCount: 1,
                                },
                            ],
                        },
                    },
                },
            },
        };
        const result = simResult({
            isDungeon: true,
            dungeonsCompleted: 10,
            zoneName: '/actions/combat/chimerical_dungeon',
            numberOfPlayers: 1,
        });

        const revenue = calculateSimRevenue(result, gameData, 'player1', 10);

        // Dungeon completion reward math: chestsPerCompletion = (5/numberOfPlayers)*(1+combatDropQuantity) = 5.
        // 10 dungeonsCompleted * 5 chests = 50 chimerical_chest -> 50 entry keys -> 50 * 50 ask = 2500 / 10hr = 250/hr.
        expect(revenue.keyCostPerHour).toBeCloseTo(250);
        expect(revenue.costPerHour).toBeGreaterThanOrEqual(revenue.keyCostPerHour);
    });

    test('a non-dungeon result has zero key cost', () => {
        mocks.resolveSellSideValue.mockReturnValue({ value: 0, source: 'market', needsTax: false });
        const gameData = { combatMonsterDetailMap: {} };
        const result = simResult({ isDungeon: false });

        const revenue = calculateSimRevenue(result, gameData, 'player1', 1);
        expect(revenue.keyCostPerHour).toBe(0);
    });
});
