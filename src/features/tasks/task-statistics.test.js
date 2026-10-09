/**
 * Tests for Task Statistics' Zone Task Progress section
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

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
vi.mock('./task-zone-progress.js', () => ({ computeAllZoneProgress: vi.fn(async () => []) }));
vi.mock('../../utils/game-i18n.js', () => ({
    getActionName: (_hrid, fallback) => fallback,
    getMonsterName: (_hrid, fallback) => fallback,
}));

import taskStatistics from './task-statistics.js';

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
