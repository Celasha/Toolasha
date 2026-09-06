import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetItemPrice } = vi.hoisted(() => ({ mockGetItemPrice: vi.fn() }));

vi.mock('./market-data.js', () => ({ getItemPrice: mockGetItemPrice }));

import { buildCheapestPerCredit } from './guild-credit-conversion.js';

const CREDIT = '/items/brown_guild_credit';
const ITEM_A = '/items/coal';
const ITEM_B = '/items/iron_ore';

describe('buildCheapestPerCredit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns empty maps when no items have credit conversions', () => {
        const { sell, buy } = buildCheapestPerCredit({ [ITEM_A]: {} });
        expect(sell).toEqual({});
        expect(buy).toEqual({});
    });

    test('computes gold-per-credit for both sell (ask) and buy (bid) sides', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (hrid !== ITEM_A) return 0;
            return opts.mode === 'ask' ? 100 : 40;
        });

        const { sell, buy } = buildCheapestPerCredit({
            [ITEM_A]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
        });

        expect(sell[CREDIT]).toBeCloseTo(10); // 100 * 1 / 10
        expect(buy[CREDIT]).toBeCloseTo(4); // 40 * 1 / 10
    });

    test('picks the cheapest conversion item across multiple candidates', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (opts.mode !== 'ask') return 0;
            if (hrid === ITEM_A) return 100; // 100/10 = 10 gold/credit
            if (hrid === ITEM_B) return 20; // 20/10 = 2 gold/credit (cheaper)
            return 0;
        });

        const { sell } = buildCheapestPerCredit({
            [ITEM_A]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
            [ITEM_B]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
        });

        expect(sell[CREDIT]).toBeCloseTo(2);
    });

    test('ignores items with no market price for that side', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (opts.mode === 'ask') return 0;
            return 5;
        });

        const { sell, buy } = buildCheapestPerCredit({
            [ITEM_A]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
        });

        expect(sell[CREDIT]).toBeUndefined();
        expect(buy[CREDIT]).toBeCloseTo(0.5);
    });

    test('excludeHrids skips a source item entirely, e.g. Guild Token pricing itself into the credit table (TLA-041)', () => {
        const GUILD_TOKEN = '/items/guild_token';
        mockGetItemPrice.mockImplementation((hrid, opts) => {
            if (opts.mode !== 'ask') return 0;
            if (hrid === GUILD_TOKEN) return 1; // would win as "cheapest" if not excluded
            if (hrid === ITEM_A) return 100;
            return 0;
        });

        const itemDetailMap = {
            [GUILD_TOKEN]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
            [ITEM_A]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
        };

        const withoutExclusion = buildCheapestPerCredit(itemDetailMap);
        expect(withoutExclusion.sell[CREDIT]).toBeCloseTo(0.1); // guild_token's own price leaks in

        const { sell } = buildCheapestPerCredit(itemDetailMap, [GUILD_TOKEN]);
        expect(sell[CREDIT]).toBeCloseTo(10); // only ITEM_A considered
    });

    test('default excludeHrids ([]) preserves existing behavior for the sole existing caller', () => {
        mockGetItemPrice.mockImplementation((hrid, opts) => (opts.mode === 'ask' ? 100 : 0));
        const itemDetailMap = {
            [ITEM_A]: { guildCreditConversions: [{ creditItemHrid: CREDIT, itemCount: 1, creditCount: 10 }] },
        };
        expect(buildCheapestPerCredit(itemDetailMap)).toEqual(buildCheapestPerCredit(itemDetailMap, []));
    });
});
