import { beforeEach, describe, expect, test, vi } from 'vitest';
import { normalizeGuildShrineReturnLabel } from './guild-marketplace-label.js';

const { mockGetItemPrice } = vi.hoisted(() => ({ mockGetItemPrice: vi.fn() }));

vi.mock('../../utils/market-data.js', () => ({ getItemPrice: mockGetItemPrice }));

import { findExchangeConversion, buildCreditRows } from './guild-credit-value.js';

describe('normalizeGuildShrineReturnLabel', () => {
    test.each([
        ['Shrine of ForceCombatLevel', 'Shrine of Force Combat Level'],
        ['Shrine of SpiritSkillingLevel', 'Shrine of Spirit Skilling Level'],
        ['Shrine of Wisdom Combat Level', 'Shrine of Wisdom Combat Level'],
    ])('normalizes %s', (source, expected) => {
        expect(normalizeGuildShrineReturnLabel(source)).toBe(expected);
    });

    test('falls back to the shrine name when the domain label is absent', () => {
        expect(normalizeGuildShrineReturnLabel('Upgrade Shrine of Force')).toBe('Shrine of Force');
    });

    test('falls back to Guild when no shrine identity is present', () => {
        expect(normalizeGuildShrineReturnLabel('Upgrade')).toBe('Guild');
    });
});

describe('findExchangeConversion', () => {
    const itemDetailMap = {
        '/items/abyssal_essence': {
            name: 'Abyssal Essence',
            guildCreditConversions: [{ creditItemHrid: '/items/blue_guild_credit', itemCount: 5, creditCount: 1 }],
        },
        '/items/verdant_essence': {
            name: 'Verdant Essence',
            guildCreditConversions: [{ creditItemHrid: '/items/green_guild_credit', itemCount: 3, creditCount: 1 }],
        },
        '/items/no_conversion_item': {
            name: 'No Conversion Item',
        },
    };

    test('finds the conversion rate for the selected item and credit type', () => {
        const result = findExchangeConversion(itemDetailMap, '/items/blue_guild_credit', 'Abyssal Essence');
        expect(result).toEqual({ hrid: '/items/abyssal_essence', itemCount: 5 });
    });

    test('returns null when the item has no conversion for this credit type', () => {
        const result = findExchangeConversion(itemDetailMap, '/items/green_guild_credit', 'Abyssal Essence');
        expect(result).toBeNull();
    });

    test('returns null when the item has no guildCreditConversions at all', () => {
        const result = findExchangeConversion(itemDetailMap, '/items/blue_guild_credit', 'No Conversion Item');
        expect(result).toBeNull();
    });

    test('returns null when no item matches the selected name', () => {
        const result = findExchangeConversion(itemDetailMap, '/items/blue_guild_credit', 'Unknown Item');
        expect(result).toBeNull();
    });
});

describe('buildCreditRows', () => {
    const SILVER_CREDIT = '/items/silver_guild_credit';
    const GUILD_TOKEN = '/items/guild_token';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('adds a synthetic Guild Token row using the cheapest item route as its opportunity cost', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === '/items/labyrinth_refinement_shard') return opts.mode === 'ask' ? 864_000 : 854_000;
            return 0;
        });

        const itemDetailMap = {
            '/items/labyrinth_refinement_shard': {
                name: 'Labyrinth Refinement Shard',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 1, creditCount: 16 }],
            },
            [GUILD_TOKEN]: {
                name: 'Guild Token',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 10, creditCount: 1 }],
            },
        };

        const rows = buildCreditRows(itemDetailMap, SILVER_CREDIT);

        const tokenRow = rows.find((r) => r.isToken);
        expect(tokenRow).toBeDefined();
        expect(tokenRow.sellPrice).toBeNull();
        expect(tokenRow.buyPrice).toBeNull();
        expect(tokenRow.sellGPC).toBeCloseTo(5_400); // 864,000/16 = 54,000/credit; /10 tokens = 5,400/token
        expect(tokenRow.buyGPC).toBeCloseTo(5_337.5); // 854,000/16 = 53,375/credit; /10 tokens = 5,337.5/token

        const itemRow = rows.find((r) => !r.isToken);
        expect(itemRow.sellGPC).toBeCloseTo(54_000);
    });

    test('omits the Guild Token row when no tradeable item resolves a value for this credit type', () => {
        mockGetItemPrice.mockReturnValue(0);
        const itemDetailMap = {
            [GUILD_TOKEN]: {
                name: 'Guild Token',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 10, creditCount: 1 }],
            },
        };

        expect(buildCreditRows(itemDetailMap, SILVER_CREDIT)).toEqual([]);
    });

    test('omits an item row with neither a sell nor a buy price (unpriced junk item)', () => {
        mockGetItemPrice.mockReturnValue(0);
        const itemDetailMap = {
            '/items/unpriced_item': {
                name: 'Unpriced Item',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 5, creditCount: 1 }],
            },
        };

        expect(buildCreditRows(itemDetailMap, SILVER_CREDIT)).toEqual([]);
    });

    test('omits the Guild Token row entirely when includeToken is false (guildTokenValueComparison setting off)', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid === '/items/labyrinth_refinement_shard') return opts.mode === 'ask' ? 864_000 : 854_000;
            return 0;
        });

        const itemDetailMap = {
            '/items/labyrinth_refinement_shard': {
                name: 'Labyrinth Refinement Shard',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 1, creditCount: 16 }],
            },
            [GUILD_TOKEN]: {
                name: 'Guild Token',
                guildCreditConversions: [{ creditItemHrid: SILVER_CREDIT, itemCount: 10, creditCount: 1 }],
            },
        };

        const rows = buildCreditRows(itemDetailMap, SILVER_CREDIT, { includeToken: false });

        expect(rows.some((r) => r.isToken)).toBe(false);
        expect(rows).toHaveLength(1);
    });
});
