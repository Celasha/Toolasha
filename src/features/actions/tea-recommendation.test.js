/**
 * Regression tests for tea-recommendation.js skillKey threading (#750 review follow-up).
 *
 * Guards the fix that normalizes the game-localized skill display name (zh "伐木")
 * into the lowercase English key ("woodcutting") BEFORE it reaches the optimizer.
 * A refactor that reintroduces skillName.toLowerCase() would pass the localized
 * name straight into findOptimalTeas and crash the zh popup — these tests fail first.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const gameI18n = vi.hoisted(() => ({ translations: {} }));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (ns, hrid, fallback = '') => gameI18n.translations[`${ns}.${hrid}`] ?? fallback,
    getItemName: (hrid, fallback = '') => gameI18n.translations[`itemNames.${hrid}`] ?? fallback,
    getActionName: (hrid, fallback = '') => gameI18n.translations[`actionNames.${hrid}`] ?? fallback,
}));

vi.mock('../../core/i18n.js', () => ({
    t: (key) => key,
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        COLOR_INFO: '#4a9eff',
        COLOR_PROFIT: '#4ade80',
        COLOR_ACCENT: '#a78bfa',
        COLOR_BORDER: '#333333',
        COLOR_WARNING: '#facc15',
        COLOR_GOLD: '#fbbf24',
        COLOR_LOSS: '#f87171',
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({})),
        getItemDetails: vi.fn(() => null),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('./action-filter.js', () => ({
    default: {
        initialize: vi.fn(async () => {}),
        getCurrentSkillName: vi.fn(() => null),
    },
}));

vi.mock('../alchemy/alchemy-profit.js', () => ({
    default: {
        getCurrentActionHrid: vi.fn(() => null),
        extractRequirements: vi.fn(async () => []),
    },
}));

// Real optimizer, but with findOptimalTeas wrapped so tests can assert call args.
vi.mock('../../utils/tea-optimizer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, findOptimalTeas: vi.fn(actual.findOptimalTeas) };
});

const OPTIMAL_RESULT = {
    optimal: { teas: [], avgScore: 0, hasOutlierPrice: false, actionScores: [] },
    drinkConcentration: 0,
    actionsEvaluated: 0,
    playerLevel: 10,
    profitableActionsCount: 0,
    excludedActions: [],
    allResults: [],
    teaCostPerHour: { total: 0 },
};

describe('TeaRecommendation - skillKey threading (#750 review follow-up)', () => {
    let feature;
    let actionFilter;
    let teaOptimizer;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        gameI18n.translations = {};
        document.body.innerHTML = '';

        actionFilter = (await import('./action-filter.js')).default;
        teaOptimizer = await import('../../utils/tea-optimizer.js');
        teaOptimizer.findOptimalTeas.mockReturnValue(OPTIMAL_RESULT);

        ({ default: feature } = await import('./tea-recommendation.js'));
        await feature.initialize();
    });

    test('xp popup: zh skill display name reaches findOptimalTeas as the normalized English key', async () => {
        gameI18n.translations['skillNames./skills/woodcutting'] = '伐木';
        actionFilter.getCurrentSkillName.mockReturnValue('伐木');

        const button = document.createElement('button');
        await feature.showRecommendation('xp', button);

        expect(teaOptimizer.findOptimalTeas).toHaveBeenCalled();
        expect(teaOptimizer.findOptimalTeas.mock.calls[0][0]).toBe('woodcutting');
        for (const call of teaOptimizer.findOptimalTeas.mock.calls) {
            expect(call[0]).not.toBe('伐木');
        }
    });

    test('both popup: every optimizer call receives the normalized key', async () => {
        gameI18n.translations['skillNames./skills/woodcutting'] = '伐木';
        actionFilter.getCurrentSkillName.mockReturnValue('伐木');

        const button = document.createElement('button');
        await feature.showRecommendation('both', button);

        expect(teaOptimizer.findOptimalTeas).toHaveBeenCalledTimes(2);
        for (const call of teaOptimizer.findOptimalTeas.mock.calls) {
            expect(call[0]).toBe('woodcutting');
        }
    });

    test('unresolvable skill name: friendly error popup, optimizer never called', async () => {
        actionFilter.getCurrentSkillName.mockReturnValue('未知专业');

        const button = document.createElement('button');
        await feature.showRecommendation('xp', button);

        expect(teaOptimizer.findOptimalTeas).not.toHaveBeenCalled();
        const popup = document.querySelector('.mwi-tea-recommendation-popup');
        expect(popup?.textContent).toContain('teaRecommendation.errorSkillNotDetected');
    });
});
