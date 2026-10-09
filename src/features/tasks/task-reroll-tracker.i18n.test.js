/* @vitest-environment jsdom */

/**
 * Locale regression tests for task-card description matching (ZH-I18N-REMAINING-ISSUES #29).
 *
 * The task card is rendered by the game: in non-English locales the description contains the
 * localized monster/action name, so getTaskIdFromElement must match either the English data
 * name / HRID slug or the translated display name.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Localized display names, e.g. translations['monsterNames:/monsters/boar'] = '野猪'.
// Empty by default = English client (helpers fall back to the English data name).
const translations = vi.hoisted(() => ({}));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (ns, hrid, fallback = '') => translations[`${ns}:${hrid}`] ?? fallback,
    getMonsterName: (hrid, fallback = '') => translations[`monsterNames:${hrid}`] ?? fallback,
    getActionName: (hrid, fallback = '') => translations[`actionNames:${hrid}`] ?? fallback,
}));

const monsterDetailMap = vi.hoisted(() => ({}));
const actionDetailsMap = vi.hoisted(() => ({}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => 'character-a'),
        on: vi.fn(),
        off: vi.fn(),
        characterData: null,
        getInitClientData: vi.fn(() => ({ combatMonsterDetailMap: monsterDetailMap })),
        getActionDetails: vi.fn((hrid) => actionDetailsMap[hrid]),
    },
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (_key, _storeName, defaultValue) => defaultValue),
        setJSON: vi.fn(async () => true),
        delete: vi.fn(async () => true),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('../../core/config.js', () => ({
    default: { COLOR_TEXT_SECONDARY: '#fff' },
}));

vi.mock('../../utils/dom.js', () => ({
    addStyles: vi.fn(),
}));

vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({
        registerInterval: vi.fn(),
        registerTimeout: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

const { default: taskRerollTracker } = await import('./task-reroll-tracker.js');

/** Build a task card element mirroring the game's RandomTask markup. */
function makeTaskCard(description, progressText = '进度：0/25') {
    const card = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'RandomTask_name__abc';
    name.textContent = description;
    const progress = document.createElement('div');
    progress.textContent = progressText;
    card.appendChild(name);
    card.appendChild(progress);
    return card;
}

describe('TaskRerollTracker locale-aware task matching (#29)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        for (const key of Object.keys(translations)) delete translations[key];
        for (const key of Object.keys(monsterDetailMap)) delete monsterDetailMap[key];
        for (const key of Object.keys(actionDetailsMap)) delete actionDetailsMap[key];
        taskRerollTracker.taskRerollData.clear();
    });

    test('ZH monster task: description with the localized monster name matches', () => {
        monsterDetailMap['/monsters/boar'] = { name: 'Boar' };
        translations['monsterNames:/monsters/boar'] = '野猪';
        taskRerollTracker.taskRerollData.set(101, { goalCount: 25, monsterHrid: '/monsters/boar' });

        const card = makeTaskCard('击败 25 只野猪', '进度：0/25');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(101);
    });

    test('EN monster task: English data name still matches (no regression)', () => {
        monsterDetailMap['/monsters/boar'] = { name: 'Boar' };
        taskRerollTracker.taskRerollData.set(101, { goalCount: 25, monsterHrid: '/monsters/boar' });

        const card = makeTaskCard('Defeat 25 Boar', 'Progress: 0/25');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(101);
    });

    test('monster task without detail-map entry falls back to the HRID slug name', () => {
        taskRerollTracker.taskRerollData.set(101, { goalCount: 25, monsterHrid: '/monsters/cave_bat' });

        const card = makeTaskCard('击败 25 只 cave bat', '进度：0/25');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(101);
    });

    test('ZH action task: description with the localized action name matches via action details', () => {
        actionDetailsMap['/actions/gathering/fishing'] = { name: 'Fishing' };
        translations['actionNames:/actions/gathering/fishing'] = '钓鱼';
        taskRerollTracker.taskRerollData.set(102, { goalCount: 50, actionHrid: '/actions/gathering/fishing' });

        const card = makeTaskCard('完成 50 次钓鱼', '进度：0/50');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(102);
    });

    test('ZH action task without action details: translated name resolves from the HRID slug fallback', () => {
        translations['actionNames:/actions/gathering/woodcutting'] = '伐木';
        taskRerollTracker.taskRerollData.set(103, { goalCount: 50, actionHrid: '/actions/gathering/woodcutting' });

        const card = makeTaskCard('完成 50 次伐木', '进度：0/50');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(103);
    });

    test('EN action task: HRID slug name still matches (no regression)', () => {
        taskRerollTracker.taskRerollData.set(103, { goalCount: 50, actionHrid: '/actions/gathering/woodcutting' });

        const card = makeTaskCard('Do woodcutting 50 times', 'Progress: 0/50');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBe(103);
    });

    test('goal-count mismatch rejects even when the name would match', () => {
        monsterDetailMap['/monsters/boar'] = { name: 'Boar' };
        translations['monsterNames:/monsters/boar'] = '野猪';
        taskRerollTracker.taskRerollData.set(101, { goalCount: 30, monsterHrid: '/monsters/boar' });

        const card = makeTaskCard('击败 25 只野猪', '进度：0/25');

        expect(taskRerollTracker.getTaskIdFromElement(card)).toBeNull();
    });

    test('claimedIds prevents a stored task from matching two cards in one pass', () => {
        monsterDetailMap['/monsters/boar'] = { name: 'Boar' };
        translations['monsterNames:/monsters/boar'] = '野猪';
        taskRerollTracker.taskRerollData.set(101, { goalCount: 25, monsterHrid: '/monsters/boar' });
        taskRerollTracker.taskRerollData.set(104, { goalCount: 25, monsterHrid: '/monsters/boar' });

        const claimed = new Set();
        const cardA = makeTaskCard('击败 25 只野猪');
        const cardB = makeTaskCard('击败 25 只野猪');

        expect(taskRerollTracker.getTaskIdFromElement(cardA, claimed)).toBe(101);
        expect(taskRerollTracker.getTaskIdFromElement(cardB, claimed)).toBe(104);
    });
});
