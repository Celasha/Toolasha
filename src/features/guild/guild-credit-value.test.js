import { beforeEach, describe, expect, test, vi } from 'vitest';
import { normalizeGuildShrineReturnLabel } from './guild-marketplace-label.js';

const { mockGetItemPrice, mockGetItemPriceOutlierInfo } = vi.hoisted(() => {
    const getItemPrice = vi.fn();
    return {
        mockGetItemPrice: getItemPrice,
        mockGetItemPriceOutlierInfo: vi.fn((hrid, opts) => ({ value: getItemPrice(hrid, opts), isOutlier: false })),
    };
});

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: mockGetItemPrice,
    getItemPriceOutlierInfo: mockGetItemPriceOutlierInfo,
}));

import { buildCreditRows } from './guild-credit-value.js';

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
        expect(tokenRow.tokenAskEach).toBeCloseTo(5_400); // 864,000/16 = 54,000/credit; /10 tokens = 5,400/token
        expect(tokenRow.tokenBidEach).toBeCloseTo(5_337.5); // 854,000/16 = 53,375/credit; /10 tokens = 5,337.5/token
        // Per-credit value must match the cheapest item route exactly, not the per-token value.
        expect(tokenRow.sellGPC).toBeCloseTo(54_000);
        expect(tokenRow.buyGPC).toBeCloseTo(53_375);

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
