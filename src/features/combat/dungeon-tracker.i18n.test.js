/**
 * Chinese-locale regression tests for dungeon-tracker chat markers.
 *
 * BUG #9: parsing party chat history used hardcoded English prefixes
 * ("Battle started:", "Key counts:", "Battle ended:", "Party failed on wave N").
 * The fix dual-matches both English and translated templates via the
 * game's systemChatMessage i18n namespace.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((_ns, _key, fallback) => {
        if (_ns !== 'systemChatMessage') return fallback;
        const zh = {
            partyBattleStarted: '战斗开始：{{party}}',
            partyBattleEnded: '战斗结束：{{party}}',
            partyKeyCount: '钥匙数量：{{party}}',
            partyWaveFailed: '队伍在第 {{wave}} 波失败',
        };
        return zh[_key] || fallback;
    }),
}));

const { isBattleStartedText, isKeyCountsText, isBattleEndedText, isWaveFailedText } =
    await import('./dungeon-tracker.js');

describe('chat marker helpers — zh client dual-match (BUG #9)', () => {
    test('isBattleStartedText matches English and Chinese', () => {
        expect(isBattleStartedText('Battle started: TestParty')).toBe(true);
        expect(isBattleStartedText('战斗开始：TestParty')).toBe(true);
        expect(isBattleStartedText('Some other text')).toBe(false);
    });

    test('isKeyCountsText matches English and Chinese', () => {
        expect(isKeyCountsText('Key counts: TestParty')).toBe(true);
        expect(isKeyCountsText('钥匙数量：TestParty')).toBe(true);
        expect(isKeyCountsText('Not key counts')).toBe(false);
    });

    test('isBattleEndedText matches English and Chinese', () => {
        expect(isBattleEndedText('Battle ended: TestParty')).toBe(true);
        expect(isBattleEndedText('战斗结束：TestParty')).toBe(true);
        expect(isBattleEndedText('Not ended text')).toBe(false);
    });

    test('isWaveFailedText matches English and Chinese wave-failed messages', () => {
        expect(isWaveFailedText('Party failed on wave 3')).toBe(true);
        expect(isWaveFailedText('队伍在第 3 波失败')).toBe(true);
        expect(isWaveFailedText('Party succeeded')).toBe(false);
    });
});
