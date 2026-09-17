import { describe, expect, test } from 'vitest';
import { normalizeGuildShrineReturnLabel } from './guild-marketplace-label.js';
import { findExchangeConversion } from './guild-credit-value.js';

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
