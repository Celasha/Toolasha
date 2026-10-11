/**
 * Tests for Task Profit Calculator's description-text fallback path (used when no
 * locale-independent questInfo is available, e.g. a completed task card - see #771).
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const gameI18nTranslations = vi.hoisted(() => ({}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => ({ actionDetailMap: {}, combatMonsterDetailMap: {} })) },
}));

vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (namespace, key, fallback) => gameI18nTranslations[`${namespace}.${key}`] ?? fallback,
}));

let calculateTaskProfit;

describe('calculateTaskProfit - description-text fallback for combat tasks (#771)', () => {
    beforeEach(async () => {
        // game-lookups.js caches its defeat-description regexes at module scope on first use,
        // so each test needs a fresh module instance to pick up a different mocked translation.
        vi.resetModules();
        for (const key of Object.keys(gameI18nTranslations)) delete gameI18nTranslations[key];
        ({ calculateTaskProfit } = await import('./task-profit-calculator.js'));
    });

    test('returns null (routing to the combat estimate UI) for an English "Defeat - Monster" description with no questInfo', async () => {
        const result = await calculateTaskProfit({ description: 'Defeat - Goblin', quantity: 10, currentProgress: 10 });
        expect(result).toBeNull();
    });

    test('returns null for a zh "击败 - Monster" description with no questInfo, instead of an unparseable-error state', async () => {
        gameI18nTranslations['randomTask.defeat'] = '击败{{monster}}';
        const result = await calculateTaskProfit({
            description: '击败 - 骷髅王',
            quantity: 10,
            currentProgress: 10,
        });
        expect(result).toBeNull();
    });
});
