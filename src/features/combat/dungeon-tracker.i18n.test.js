/**
 * Chinese-locale regression tests for dungeon-tracker chat markers.
 *
 * BUG #9: parsing party chat history used hardcoded English prefixes
 * ("Battle started:", "Key counts:", "Battle ended:", "Party failed on wave N").
 * The fix dual-matches both English and translated templates via the
 * game's systemChatMessage i18n namespace.
 *
 * All mocked templates below are the REAL runtime shapes captured from the
 * live zh client (2026-10-09), not invented strings:
 *   - i18n.t() consumes the "$t(" nesting wrapper, so partyBattleStarted
 *     returns "战斗开始: actionNames.{{actionHrid}}" (namespace residue leaked);
 *   - rendered chat messages resolve the nesting, e.g. "战斗开始: 地狱深渊";
 *   - keyCount / waveFailed templates have no nesting and are returned as-is.
 * These tests pin the prefix-stripping logic that recovers the visible
 * prefix from the residue-poisoned template.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((_ns, _key, fallback) => {
        if (_ns !== 'systemChatMessage') return fallback;
        const zh = {
            partyBattleStarted: '战斗开始: actionNames.{{actionHrid}}',
            partyBattleEnded: '战斗结束: actionNames.{{actionHrid}}',
            partyKeyCount: '钥匙数量: {{keyCountString}}',
            partyWaveFailed: '队伍在第{{wave}}波失败。',
        };
        return zh[_key] || fallback;
    }),
}));

const { isBattleStartedText, isKeyCountsText, isBattleEndedText, isWaveFailedText, getChatMarkers } =
    await import('./dungeon-tracker.js');

describe('chat marker helpers — zh client dual-match (BUG #9)', () => {
    test('isBattleStartedText matches English and real rendered zh messages', () => {
        expect(isBattleStartedText('Battle started: Hells Abyss')).toBe(true);
        // Real message captured from the live zh client party chat.
        expect(isBattleStartedText('战斗开始: 地狱深渊')).toBe(true);
        expect(isBattleStartedText('Some other text')).toBe(false);
    });

    test('isKeyCountsText matches English and real rendered zh messages', () => {
        expect(isKeyCountsText('Key counts: 2x bronze key')).toBe(true);
        expect(isKeyCountsText('钥匙数量: 钥匙 x2')).toBe(true);
        expect(isKeyCountsText('Not key counts')).toBe(false);
    });

    test('isBattleEndedText matches English and real rendered zh messages', () => {
        expect(isBattleEndedText('Battle ended: Hells Abyss')).toBe(true);
        expect(isBattleEndedText('战斗结束: 地狱深渊')).toBe(true);
        expect(isBattleEndedText('Not ended text')).toBe(false);
    });

    test('isWaveFailedText matches English and real rendered zh messages', () => {
        expect(isWaveFailedText('Party failed on wave 3')).toBe(true);
        expect(isWaveFailedText('队伍在第3波失败。')).toBe(true);
        expect(isWaveFailedText('Party succeeded')).toBe(false);
    });
});

describe('getChatMarkers strips leaked i18n namespace residue (runtime regression)', () => {
    test('battleStarted/battleEnded prefixes have no "actionNames." residue', () => {
        const markers = getChatMarkers();
        expect(markers.battleStarted).toContain('战斗开始:');
        expect(markers.battleStarted).toContain('Battle started:');
        expect(markers.battleEnded).toContain('战斗结束:');
        expect(markers.battleEnded).toContain('Battle ended:');
        for (const prefix of [...markers.battleStarted, ...markers.battleEnded]) {
            expect(prefix.includes('actionNames.')).toBe(false);
            expect(prefix.includes('{{')).toBe(false);
        }
        // The stripped prefix must actually match the rendered message.
        expect('战斗开始: 地狱深渊'.includes(markers.battleStarted.find((p) => p !== 'Battle started:'))).toBe(true);
    });

    test('keyCounts prefix keeps its visible colon (no residue to strip)', () => {
        const markers = getChatMarkers();
        expect(markers.keyCounts).toContain('钥匙数量:');
        expect('钥匙数量: 钥匙 x2'.includes('钥匙数量:')).toBe(true);
    });

    test('zh wave-failed regex matches the real rendered message', () => {
        const markers = getChatMarkers();
        const zhRegex = markers.waveFailed.find((r) => r.source.includes('队伍'));
        expect(zhRegex).toBeDefined();
        expect(zhRegex.test('队伍在第3波失败。')).toBe(true);
        expect(zhRegex.test('战斗开始: 地狱深渊')).toBe(false);
    });
});

describe('dungeon-tracker-chat-annotations _getChatMarkers (same stripping logic)', () => {
    test('prototype helper produces the same clean prefixes', async () => {
        const { default: annotations } = await import('./dungeon-tracker-chat-annotations.js');
        const markers = annotations._getChatMarkers();
        expect(markers.battleStarted).toContain('战斗开始:');
        expect(markers.battleEnded).toContain('战斗结束:');
        for (const prefix of [...markers.battleStarted, ...markers.battleEnded]) {
            expect(prefix.includes('actionNames.')).toBe(false);
        }
        expect('战斗结束: 巫师之塔'.includes(markers.battleEnded.find((p) => p !== 'Battle ended:'))).toBe(true);
    });
});
