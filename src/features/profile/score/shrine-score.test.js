import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    itemDetailMap: {},
    guildBuffDetailMap: {},
    buildCheapestPerCredit: vi.fn(),
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            itemDetailMap: mocks.itemDetailMap,
            guildBuffDetailMap: mocks.guildBuffDetailMap,
        })),
    },
}));

vi.mock('../../../utils/guild-credit-conversion.js', () => ({ buildCheapestPerCredit: mocks.buildCheapestPerCredit }));

vi.mock('../../networth/networth-calculator.js', () => ({
    buildGuildBuffDisplayName: (hrid, buff) => `Shrine (${buff.isCombat ? 'Combat' : 'Skilling'})`,
}));

import { calculateShrineScore } from './shrine-score.js';

const buildCheapestPerCredit = mocks.buildCheapestPerCredit;

const GUILD_TOKEN = '/items/guild_token';

describe('calculateShrineScore - F-12: Guild Token opportunity value uses MAXIMUM foregone alternative', () => {
    test('gold-credit path wins (1,166.67 coins/token) over cheaper-looking paths, proving max not min', () => {
        mocks.itemDetailMap = {
            [GUILD_TOKEN]: {
                guildCreditConversions: [
                    { creditItemHrid: '/items/brown_guild_credit', itemCount: 1, creditCount: 10 },
                    { creditItemHrid: '/items/purple_guild_credit', itemCount: 1, creditCount: 1 },
                    { creditItemHrid: '/items/silver_guild_credit', itemCount: 10, creditCount: 1 },
                    { creditItemHrid: '/items/gold_guild_credit', itemCount: 60, creditCount: 1 },
                ],
            },
        };
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': {
                isCombat: true,
                levelCosts: { 1: { guildTokenCost: 60, creditCosts: [] } },
            },
        };
        buildCheapestPerCredit.mockReturnValue({
            sell: {
                '/items/brown_guild_credit': 100,
                '/items/purple_guild_credit': 900,
                '/items/silver_guild_credit': 8000,
                '/items/gold_guild_credit': 70000,
            },
        });

        const result = calculateShrineScore({ profile: { guildBuffLevelMap: { '/guild_buffs/force_combat': 1 } } });

        // Alternatives: brown 1000, purple 900, silver 800/token, gold 1166.67/token -> max wins.
        // levelCosts[1].guildTokenCost = 60 -> cost = 60 * 1166.67 = 70,000.02
        expect(result.combat.score).toBeCloseTo(70000.02 / 1_000_000, 3);
    });

    test('excludes Guild Token itself when building the credit value table (regression against circularity)', () => {
        buildCheapestPerCredit.mockClear();
        mocks.itemDetailMap = { [GUILD_TOKEN]: { guildCreditConversions: [] } };
        mocks.guildBuffDetailMap = {};
        calculateShrineScore({ profile: { guildBuffLevelMap: {} } });

        expect(buildCheapestPerCredit).toHaveBeenCalledWith(mocks.itemDetailMap, [GUILD_TOKEN]);
    });

    test('PB-44: the natural Guild Token count is preserved in the breakdown label alongside the coin-equivalent Score', () => {
        mocks.itemDetailMap = {
            [GUILD_TOKEN]: {
                guildCreditConversions: [{ creditItemHrid: '/items/gold_guild_credit', itemCount: 60, creditCount: 1 }],
            },
        };
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': {
                isCombat: true,
                levelCosts: { 1: { guildTokenCost: 400, creditCosts: [] } },
            },
        };
        buildCheapestPerCredit.mockReturnValue({ sell: { '/items/gold_guild_credit': 70000 } });

        const result = calculateShrineScore({ profile: { guildBuffLevelMap: { '/guild_buffs/force_combat': 1 } } });

        expect(result.combat.breakdown[0].name).toContain('400 tokens');
    });
});

describe('calculateShrineScore - level cost summing and completeness', () => {
    test('sums levelCosts[1..viewedLevel], splitting Combat/Skiller via isCombat', () => {
        mocks.itemDetailMap = { [GUILD_TOKEN]: { guildCreditConversions: [] } };
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': {
                isCombat: true,
                levelCosts: {
                    1: { guildTokenCost: 0, creditCosts: [{ itemHrid: '/items/brown_guild_credit', count: 100 }] },
                    2: { guildTokenCost: 0, creditCosts: [{ itemHrid: '/items/brown_guild_credit', count: 200 }] },
                },
            },
            '/guild_buffs/wisdom_skilling': {
                isCombat: false,
                levelCosts: {
                    1: { guildTokenCost: 0, creditCosts: [{ itemHrid: '/items/brown_guild_credit', count: 50 }] },
                },
            },
        };
        buildCheapestPerCredit.mockReturnValue({ sell: { '/items/brown_guild_credit': 100 } });

        const result = calculateShrineScore({
            profile: {
                guildBuffLevelMap: { '/guild_buffs/force_combat': 2, '/guild_buffs/wisdom_skilling': 1 },
            },
        });

        expect(result.combat.score).toBeCloseTo((100 * 100 + 200 * 100) / 1_000_000);
        expect(result.skiller.score).toBeCloseTo((50 * 100) / 1_000_000);
    });

    test('a buff at level 0 (not purchased) is skipped entirely', () => {
        mocks.itemDetailMap = { [GUILD_TOKEN]: { guildCreditConversions: [] } };
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': { isCombat: true, levelCosts: { 1: { guildTokenCost: 0, creditCosts: [] } } },
        };
        buildCheapestPerCredit.mockReturnValue({ sell: {} });

        const result = calculateShrineScore({ profile: { guildBuffLevelMap: {} } });
        expect(result.combat.breakdown).toEqual([]);
    });

    test('an unresolvable credit value marks the buff (and category) partial, not zero-filled (PB-46)', () => {
        mocks.itemDetailMap = { [GUILD_TOKEN]: { guildCreditConversions: [] } };
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': {
                isCombat: true,
                levelCosts: {
                    1: { guildTokenCost: 0, creditCosts: [{ itemHrid: '/items/brown_guild_credit', count: 100 }] },
                },
            },
        };
        buildCheapestPerCredit.mockReturnValue({ sell: {} }); // brown credit unresolved

        const result = calculateShrineScore({ profile: { guildBuffLevelMap: { '/guild_buffs/force_combat': 1 } } });
        expect(result.combat.complete).toBe(false);
    });

    test('an unresolvable Guild Token value marks the buff partial when a level requires tokens', () => {
        mocks.itemDetailMap = { [GUILD_TOKEN]: { guildCreditConversions: [] } }; // no conversions -> tokenValue stays 0
        mocks.guildBuffDetailMap = {
            '/guild_buffs/force_combat': {
                isCombat: true,
                levelCosts: { 1: { guildTokenCost: 400, creditCosts: [] } },
            },
        };
        buildCheapestPerCredit.mockReturnValue({ sell: {} });

        const result = calculateShrineScore({ profile: { guildBuffLevelMap: { '/guild_buffs/force_combat': 1 } } });
        expect(result.combat.complete).toBe(false);
    });
});
