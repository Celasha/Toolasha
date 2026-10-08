/**
 * Chinese-locale regression tests for task-profit-display dual-match helpers.
 *
 * BUG #15: the "Defeat - Monster" task description fallback regex used a
 * hardcoded English literal. The fix dual-matches both English ("Defeat") and
 * the game's translated template (zh: "击败{{monster}}"). This test mocks the
 * game-i18n bridge to return the Chinese template and verifies the helper
 * extracts the monster name from both English and Chinese descriptions.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((_ns, _key, fallback) => {
        // Simulate zh client: randomTask.defeat template renders as "击败{{monster}}"
        if (_ns === 'randomTask' && _key === 'defeat') return '击败{{monster}}';
        return fallback;
    }),
}));

const { matchDefeatDescription } = await import('./task-profit-display.js');

describe('matchDefeatDescription — zh client dual-match (BUG #15)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('matches English "Defeat - Goblin" task description', () => {
        expect(matchDefeatDescription('Defeat - Goblin')).toBe('Goblin');
    });

    test('matches Chinese "击败 - 野猪" task description', () => {
        expect(matchDefeatDescription('击败 - 野猪')).toBe('野猪');
    });

    test('matches Chinese template "击败{{monster}}" prefix without trimming monster', () => {
        expect(matchDefeatDescription('击败 - Skeleton King')).toBe('Skeleton King');
    });

    test('returns null for non-combat task description', () => {
        expect(matchDefeatDescription('Gather 100 Wood')).toBeNull();
    });

    test('returns null for empty input', () => {
        expect(matchDefeatDescription('')).toBeNull();
        expect(matchDefeatDescription(null)).toBeNull();
        expect(matchDefeatDescription(undefined)).toBeNull();
    });
});
