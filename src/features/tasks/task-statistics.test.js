/**
 * Tests for Task Statistics' Zone Task Progress section
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_TEXT_PRIMARY: '#ffffff',
        COLOR_TEXT_SECONDARY: '#888888',
        COLOR_ACCENT: '#22c55e',
        COLOR_GOLD: '#ffa500',
        COLOR_PROFIT: '#047857',
        COLOR_LOSS: '#f87171',
        COLOR_ESSENCE: '#c084fc',
        COLOR_INFO: '#60a5fa',
        onSettingChange: vi.fn(),
        getSetting: vi.fn(() => true),
    },
}));

vi.mock('../../core/i18n.js', () => {
    const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
    return { default: { t }, t };
});

vi.mock('../../core/data-manager.js', () => ({ default: { characterQuests: [] } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { isLoaded: vi.fn(() => true), fetch: vi.fn() } }));
vi.mock('./task-profit-calculator.js', () => ({
    calculateTaskProfit: vi.fn(),
    calculateTaskTokenValue: vi.fn(),
    calculateTaskRewardValue: vi.fn(),
}));
vi.mock('./task-profit-display.js', () => ({ calculateTaskCompletionSeconds: vi.fn() }));
const { mockComputeAllZoneProgress } = vi.hoisted(() => ({ mockComputeAllZoneProgress: vi.fn() }));
vi.mock('./task-zone-progress.js', () => ({ computeAllZoneProgress: mockComputeAllZoneProgress }));
vi.mock('../../utils/game-i18n.js', () => ({
    getActionName: (_hrid, fallback) => fallback,
    getMonsterName: (_hrid, fallback) => fallback,
}));

import taskStatistics from './task-statistics.js';
import marketAPI from '../../api/marketplace.js';
import * as taskProfitCalculator from './task-profit-calculator.js';
import { calculateTaskCompletionSeconds } from './task-profit-display.js';

describe('TaskStatistics.createZoneProgressSection', () => {
    beforeEach(() => {
        taskStatistics.overlay = null;
    });

    function makeZone(overrides = {}) {
        return {
            zoneHrid: '/actions/combat/zone_a',
            zoneName: 'Zone A',
            hoursNeeded: 2,
            fightsNeeded: 120,
            bottleneckName: 'Dragon',
            ...overrides,
        };
    }

    test('renders one row per zone with the zone name as the label', () => {
        const section = taskStatistics.createZoneProgressSection([makeZone()], '#ffffff');
        const rows = section.querySelectorAll('div > span:first-child');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toBe('Zone A');
    });

    test('row value carries the fights/time/bottleneck data via the locale key params', () => {
        const section = taskStatistics.createZoneProgressSection([makeZone()], '#ffffff');
        const valueSpan = section.querySelectorAll('div > span:last-child')[0];
        expect(valueSpan.textContent).toContain('taskStatistics.zoneProgressRowValue');
        expect(valueSpan.textContent).toContain('"fights":"120"');
        expect(valueSpan.textContent).toContain('"bottleneckName":"Dragon"');
    });

    test('shows ??? when the zone can never be cleared with current gear (Infinity hours/fights)', () => {
        const section = taskStatistics.createZoneProgressSection(
            [makeZone({ hoursNeeded: Infinity, fightsNeeded: Infinity })],
            '#ffffff'
        );
        const valueSpan = section.querySelectorAll('div > span:last-child')[0];
        expect(valueSpan.textContent).toContain('"fights":"???"');
        expect(valueSpan.textContent).toContain('"time":"???"');
    });

    test('clicking a row closes the popup and calls handleGoToAction with the zone hrid + fight count', () => {
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);
        taskStatistics.overlay = overlay;

        const handleGoToAction = vi.fn();
        const root = document.createElement('div');
        root.id = 'root';
        root._reactRootContainer = { current: { stateNode: { handleGoToAction }, sibling: null, child: null } };
        document.body.appendChild(root);

        const section = taskStatistics.createZoneProgressSection([makeZone()], '#ffffff');
        const row = section.children[1]; // children[0] is the section title
        row.onclick();

        expect(taskStatistics.overlay).toBe(null);
        expect(handleGoToAction).toHaveBeenCalledWith('/actions/combat/zone_a', 120);

        root.remove();
    });
});

describe('TaskStatistics progressive popup', () => {
    beforeEach(() => {
        marketAPI.isLoaded.mockReturnValue(true);
        marketAPI.fetch.mockResolvedValue(undefined);
        taskProfitCalculator.calculateTaskTokenValue.mockReturnValue(10);
        taskProfitCalculator.calculateTaskRewardValue.mockReturnValue({
            error: false,
            total: 1000,
            breakdown: { tokenValue: 10 },
            taskTokens: 500,
            purpleGift: 100,
        });
        taskProfitCalculator.calculateTaskProfit.mockResolvedValue(null);
        calculateTaskCompletionSeconds.mockReturnValue(null);
        mockComputeAllZoneProgress.mockResolvedValue([]);
        taskStatistics.overlay = null;
        taskStatistics.popupGeneration = 0;
    });

    afterEach(() => {
        taskStatistics.closePopup();
    });

    function makeZoneProgress() {
        return [
            {
                zoneHrid: '/actions/combat/eye_planet',
                zoneName: 'Eye Planet',
                hoursNeeded: 2,
                fightsNeeded: 120,
                bottleneckName: 'Compound Eye',
            },
        ];
    }

    test('opening the popup renders the overlay synchronously with placeholder rows', async () => {
        let resolveZone;
        mockComputeAllZoneProgress.mockReturnValue(new Promise((resolve) => (resolveZone = resolve)));

        const opening = taskStatistics.showPopup(); // 不 await —— 秒开断言的关键

        expect(taskStatistics.overlay).not.toBeNull();
        const content = taskStatistics.overlay.querySelector('.toolasha-task-stats-content');
        expect(content).not.toBeNull();
        expect(content.textContent).toContain('taskStatistics.computingPlaceholder');

        resolveZone([]);
        await opening;
    });

    test('task slots section shows real data immediately (no placeholder)', async () => {
        const opening = taskStatistics.showPopup();
        const overflowSection = taskStatistics.sections.overflow;
        expect(overflowSection.textContent).toContain('taskStatistics.taskSlotsHeader');
        expect(overflowSection.textContent).not.toContain('taskStatistics.computingPlaceholder');
        await opening;
    });

    test('reward sections fill in after calculateRewardsSummary resolves', async () => {
        await taskStatistics.showPopup();

        expect(taskStatistics.sections.rewards.textContent).toContain('taskStatistics.totalCoinsLabel');
        expect(taskStatistics.sections.rewards.textContent).not.toContain('taskStatistics.computingPlaceholder');
        expect(taskStatistics.sections.actionProfit.textContent).not.toContain('taskStatistics.computingPlaceholder');
        expect(taskStatistics.sections.completionTime.textContent).not.toContain('taskStatistics.computingPlaceholder');
    });

    test('zone progress section fills on result and is removed when result is empty', async () => {
        mockComputeAllZoneProgress.mockResolvedValue(makeZoneProgress());
        await taskStatistics.showPopup();
        expect(taskStatistics.sections.zoneProgress.textContent).toContain('Eye Planet');

        mockComputeAllZoneProgress.mockResolvedValue([]);
        await taskStatistics.showPopup();
        expect(taskStatistics.sections.zoneProgress).toBeNull();
    });

    test('stale async results from a closed popup never touch the new popup (generation token)', async () => {
        let resolveFirst;
        mockComputeAllZoneProgress.mockReturnValue(new Promise((r) => (resolveFirst = r)));

        const first = taskStatistics.showPopup();
        const firstGeneration = taskStatistics.popupGeneration;
        taskStatistics.closePopup();

        mockComputeAllZoneProgress.mockResolvedValue(makeZoneProgress());
        await taskStatistics.showPopup();
        const secondSectionHtml = taskStatistics.sections.zoneProgress.innerHTML;

        resolveFirst(makeZoneProgress());
        await first;

        expect(taskStatistics.popupGeneration).toBeGreaterThan(firstGeneration);
        expect(taskStatistics.sections.zoneProgress.innerHTML).toBe(secondSectionHtml);
    });

    test('a failing market fetch shows error rows instead of throwing', async () => {
        marketAPI.isLoaded.mockReturnValue(false);
        marketAPI.fetch.mockRejectedValue(new Error('network down'));

        await expect(taskStatistics.showPopup()).resolves.not.toThrow();
        expect(taskStatistics.sections.rewards.textContent).toContain('taskStatistics.computeFailedMessage');
        expect(taskStatistics.sections.actionProfit.textContent).toContain('taskStatistics.computeFailedMessage');
        expect(taskStatistics.sections.completionTime.textContent).toContain('taskStatistics.computeFailedMessage');
    });
});

describe('TaskStatistics combat row hiding', () => {
    beforeEach(() => {
        taskStatistics.overlay = null;
    });

    afterEach(() => {
        taskStatistics.closePopup();
    });

    function detail(overrides = {}) {
        return {
            name: 'Forage',
            isCombat: false,
            coinReward: 100,
            tokenReward: 5,
            actionProfit: 500,
            completionSeconds: 3600,
            goalCount: 10,
            currentCount: 0,
            ...overrides,
        };
    }

    function rewards(taskDetails) {
        return {
            totalCoins: 0,
            totalTokens: 0,
            tokenValue: 10,
            rewardValue: { error: false, total: 0, breakdown: { tokenValue: 10 }, taskTokens: 0, purpleGift: 0 },
            totalActionProfit: 500,
            totalCompletionSeconds: 3600,
            combinedTotal: 500,
            taskDetails,
        };
    }

    function rowLabels(section) {
        return [...section.querySelectorAll('div > span:first-child')].map((s) => s.textContent);
    }

    test('action profit header carries the not-applicable suffix and combat rows are hidden', () => {
        const section = taskStatistics.createActionProfitSection(
            rewards([detail(), detail({ name: 'Dragon', isCombat: true, actionProfit: null })])
        );
        expect(section.children[0].textContent).toBe(
            'taskStatistics.actionProfitHeader（taskStatistics.combatNotApplicableLabel）'
        );
        const labels = rowLabels(section);
        expect(labels).toContain('Forage');
        expect(labels).not.toContain('Dragon');
    });

    test('completion time hides combat rows too', () => {
        const section = taskStatistics.createCompletionTimeSection(
            rewards([detail(), detail({ name: 'Dragon', isCombat: true, completionSeconds: null })]),
            '#ffffff'
        );
        const labels = rowLabels(section);
        expect(labels).toContain('Forage');
        expect(labels).not.toContain('Dragon');
    });

    test('all-combat task list renders only the section title', () => {
        const profitSection = taskStatistics.createActionProfitSection(
            rewards([detail({ name: 'D', isCombat: true, actionProfit: null })])
        );
        const timeSection = taskStatistics.createCompletionTimeSection(
            rewards([detail({ name: 'D', isCombat: true, completionSeconds: null })]),
            '#ffffff'
        );
        expect(profitSection.children).toHaveLength(1);
        expect(timeSection.children).toHaveLength(1);
    });
});
