import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetInitClientData, mockGetCharacterGuildBuffLevel, mockGetItemPrice, mockGetSettingValue } = vi.hoisted(
    () => ({
        mockGetInitClientData: vi.fn(),
        mockGetCharacterGuildBuffLevel: vi.fn(),
        mockGetItemPrice: vi.fn(),
        mockGetSettingValue: vi.fn(),
    })
);

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: mockGetInitClientData,
        getCharacterGuildBuffLevel: mockGetCharacterGuildBuffLevel,
    },
}));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(),
        getSettingValue: mockGetSettingValue,
    },
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: mockGetItemPrice,
    getItemPrices: vi.fn(),
}));

import { calculateAllGuildShrinesCost, buildGuildBuffDisplayName } from './networth-calculator.js';

const FORCE_COMBAT = '/guild_buffs/force_combat';
const FORCE_SKILLING = '/guild_buffs/force_skilling';
const RARITY_COMBAT = '/guild_buffs/rarity_combat';
const CREDIT_BROWN = '/items/brown_guild_credit';
const CREDIT_WHITE = '/items/white_guild_credit';
const CONVERSION_ITEM = '/items/coal';

function buffDetail({ shrineHrid, isCombat, levelCosts }) {
    return { shrineHrid, isCombat, levelCosts };
}

describe('buildGuildBuffDisplayName', () => {
    test('formats known shrine + combat buff', () => {
        expect(buildGuildBuffDisplayName(FORCE_COMBAT, { shrineHrid: '/guild_shrines/force', isCombat: true })).toBe(
            'Shrine of Force - Combat'
        );
    });

    test('formats known shrine + skilling buff', () => {
        expect(buildGuildBuffDisplayName(FORCE_SKILLING, { shrineHrid: '/guild_shrines/force', isCombat: false })).toBe(
            'Shrine of Force - Skilling'
        );
    });

    test('falls back to slug for an unrecognized shrine hrid', () => {
        expect(
            buildGuildBuffDisplayName('/guild_buffs/mystery_combat', {
                shrineHrid: '/guild_shrines/mystery',
                isCombat: true,
            })
        ).toBe('Shrine of mystery - Combat');
    });
});

describe('calculateAllGuildShrinesCost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSettingValue.mockReturnValue('ask');
    });

    test('returns empty result when game data has no guildBuffDetailMap', () => {
        mockGetInitClientData.mockReturnValue({});
        const result = calculateAllGuildShrinesCost();
        expect(result).toEqual({ totalCost: 0, breakdown: [] });
    });

    test('skips buffs at level 0 (not purchased)', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({ shrineHrid: '/guild_shrines/force', isCombat: true, levelCosts: {} }),
            },
            itemDetailMap: {},
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(0);

        const result = calculateAllGuildShrinesCost();
        expect(result).toEqual({ totalCost: 0, breakdown: [] });
    });

    test('prices only the Guild Credit portion of each level, ignoring Guild Token cost entirely', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: {
                            guildTokenCost: 400,
                            creditCosts: [{ itemHrid: CREDIT_BROWN, count: 2000 }],
                        },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockImplementation((hrid) => (hrid === FORCE_COMBAT ? 1 : 0));
        // 1 coal -> 10 brown credits, priced at ask 50 -> 5 gold/credit
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === CONVERSION_ITEM && opts?.mode === 'ask') return 50;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // 2000 credits * 5 gold/credit = 10000; guildTokenCost (400) contributes nothing
        expect(result.totalCost).toBe(10000);
        expect(result.breakdown).toEqual([
            { hrid: FORCE_COMBAT, name: 'Shrine of Force - Combat', level: 1, cost: 10000 },
        ]);
    });

    test('sums costs across multiple levels for a single buff', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 2000 }] },
                        2: { guildTokenCost: 800, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 6000 }] },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(2);
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === CONVERSION_ITEM && opts?.mode === 'ask') return 50;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // level 1: 2000 * 5 = 10000; level 2: 6000 * 5 = 30000; total 40000
        expect(result.totalCost).toBe(40000);
        expect(result.breakdown[0].level).toBe(2);
        expect(result.breakdown[0].cost).toBe(40000);
    });

    test('a credit item with no priced conversion contributes zero without throwing', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_WHITE, count: 2000 }] },
                    },
                }),
            },
            itemDetailMap: {}, // no conversion items at all -> cheapestPerCredit map is empty
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);

        const result = calculateAllGuildShrinesCost();

        expect(result.totalCost).toBe(0);
        expect(result.breakdown).toEqual([{ hrid: FORCE_COMBAT, name: 'Shrine of Force - Combat', level: 1, cost: 0 }]);
    });

    test('uses bid pricing when networth_pricingMode is set to bid', () => {
        mockGetSettingValue.mockReturnValue('bid');
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: {
                        1: { guildTokenCost: 400, creditCosts: [{ itemHrid: CREDIT_BROWN, count: 100 }] },
                    },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid !== CONVERSION_ITEM) return null;
            if (opts?.mode === 'ask') return 100;
            if (opts?.mode === 'bid') return 40;
            return null;
        });

        const result = calculateAllGuildShrinesCost();

        // bid: 1 coal -> 10 credits at 40 gold -> 4 gold/credit; 100 credits * 4 = 400
        expect(result.totalCost).toBe(400);
    });

    test('aggregates multiple purchased buffs and sorts breakdown by cost descending', () => {
        mockGetInitClientData.mockReturnValue({
            guildBuffDetailMap: {
                [FORCE_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/force',
                    isCombat: true,
                    levelCosts: { 1: { creditCosts: [{ itemHrid: CREDIT_BROWN, count: 1000 }] } },
                }),
                [RARITY_COMBAT]: buffDetail({
                    shrineHrid: '/guild_shrines/rarity',
                    isCombat: true,
                    levelCosts: { 1: { creditCosts: [{ itemHrid: CREDIT_BROWN, count: 5000 }] } },
                }),
            },
            itemDetailMap: {
                [CONVERSION_ITEM]: {
                    guildCreditConversions: [{ creditItemHrid: CREDIT_BROWN, itemCount: 1, creditCount: 10 }],
                },
            },
        });
        mockGetCharacterGuildBuffLevel.mockReturnValue(1);
        mockGetItemPrice.mockImplementation((hrid, opts) => (opts?.mode === 'ask' ? 10 : null));

        const result = calculateAllGuildShrinesCost();

        expect(result.totalCost).toBe(1000 + 5000); // (1000*1) + (5000*1) at 1 gold/credit
        expect(result.breakdown.map((b) => b.hrid)).toEqual([RARITY_COMBAT, FORCE_COMBAT]);
    });
});
