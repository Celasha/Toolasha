/**
 * Chinese-locale regression tests for guild-marketplace-label shrine matcher.
 *
 * BUG #14: extracting the shrine name from a shrine modal used hardcoded
 * English regexes ("Shrine of X Combat Level"). The fix walks the game's
 * guildShrineDetailMap and matches either the English or translated name.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            guildShrineDetailMap: {
                '/guild_shrines/combat_giant': { name: 'Giant Combat Shrine' },
                '/guild_shrines/skilling_scholar': { name: 'Scholar Skilling Shrine' },
            },
        })),
    },
}));
vi.mock('../../core/i18n.js', () => ({ t: vi.fn(() => 'fallback') }));
vi.mock('../../utils/game-i18n.js', () => ({
    getGuildShrineName: vi.fn((_hrid, fallback) => {
        const zh = {
            '/guild_shrines/combat_giant': '巨人战斗神殿',
            '/guild_shrines/skilling_scholar': '学者技能神殿',
        };
        return zh[_hrid] || fallback;
    }),
}));

const { matchTranslatedShrineName, normalizeGuildShrineReturnLabel } = await import('./guild-marketplace-label.js');

describe('matchTranslatedShrineName — zh client dual-match (BUG #14)', () => {
    test('matches English shrine name in text', () => {
        expect(matchTranslatedShrineName('Giant Combat Shrine Level 5')).toBe('Giant Combat Shrine');
    });

    test('matches Chinese shrine name in text', () => {
        expect(matchTranslatedShrineName('巨人战斗神殿 5 级')).toBe('巨人战斗神殿');
    });

    test('returns empty string when no shrine name matches', () => {
        expect(matchTranslatedShrineName('Some unrelated text')).toBe('');
    });
});

describe('normalizeGuildShrineReturnLabel — zh client fallback (BUG #14)', () => {
    test('still extracts English "Shrine of X" form via regex', () => {
        expect(normalizeGuildShrineReturnLabel('Shrine of Giant Combat Level 5')).toBe('Shrine of Giant Combat Level');
    });

    test('falls back to translated shrine name when English regex misses', () => {
        expect(normalizeGuildShrineReturnLabel('巨人战斗神殿 5 级')).toBe('巨人战斗神殿');
    });

    test('returns generic fallback when nothing matches', () => {
        expect(normalizeGuildShrineReturnLabel('unrelated text')).toBe('fallback');
    });
});
