/**
 * Chinese-locale regression tests for combat-summary.parseCombatInfo.
 *
 * BUG #22: parsing the BattlePanel_combatInfo text used hardcoded English
 * labels ("Combat Duration", "Battles", "Deaths"). The fix dual-matches both
 * English and translated labels, plus a structure-only fallback regex that
 * works regardless of locale.
 *
 * The real battlePanel.{combatDuration,battles,deaths} game i18n keys are
 * templated strings with an embedded {{placeholder}} (e.g.
 * "战斗时间: {{duration}}"), not plain labels — translateGameName must have
 * the placeholder stripped before use, or the dual-match regex never matches
 * real DOM text (see stripInterpolationTemplate in combat-summary.js).
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    // Real strings pulled from the game client bundle's zh-Hans locale chunk —
    // each key's value is a template, not a plain label.
    translateGameName: vi.fn((_ns, _key, fallback) => {
        if (_ns !== 'battlePanel') return fallback;
        const zh = {
            combatDuration: '战斗时间: {{duration}}',
            battles: '交战: {{battleId}}',
            deaths: '战败: {{deathCount}}',
        };
        return zh[_key] ?? fallback;
    }),
}));

const { parseCombatInfo } = await import('./combat-summary.js');

describe('parseCombatInfo — zh client dual-match (BUG #22)', () => {
    test('parses English combat info', () => {
        const text = 'Combat Duration: 1d 2h 30m 15s. Battles: 150. Deaths: 3.';
        const result = parseCombatInfo(text);
        expect(result).toEqual({
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 15,
            battles: 150,
            deaths: 3,
        });
    });

    // Uses a Chinese full-width "。" separator instead of ASCII "." between segments.
    // The structure-only fallback regex requires a literal ASCII "." between groups, so
    // it cannot match this input — only the label-based dual-match regex can, which
    // pins down that the dual-match (and its placeholder-stripping) actually works,
    // rather than being silently rescued by the generic structural fallback.
    test('parses Chinese combat info using the real templated labels', () => {
        const text = '战斗时间: 1d 2h 30m 15s。交战: 150。战败: 3。';
        const result = parseCombatInfo(text);
        expect(result).toEqual({
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 15,
            battles: 150,
            deaths: 3,
        });
    });

    test('falls back to structure-only regex when labels are unknown', () => {
        // Simulate a locale where translateGameName returns the fallback (English)
        // but the actual DOM has different text. The structure-only regex still matches.
        const text = 'XYZ: 1d 2h 30m 15s. ABC: 150. DEF: 3.';
        const result = parseCombatInfo(text);
        expect(result).toEqual({
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 15,
            battles: 150,
            deaths: 3,
        });
    });

    test('returns null for unparseable text', () => {
        expect(parseCombatInfo('garbage text')).toBeNull();
        expect(parseCombatInfo('')).toBeNull();
        expect(parseCombatInfo(null)).toBeNull();
    });
});
