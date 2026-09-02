/* @vitest-environment jsdom */

/**
 * Regression coverage for the DOM-row-to-WebSocket-entry matching in LootLogStats.
 *
 * Previously this matched by reverse-parsing the displayed, locale-formatted start-time text
 * against a handful of hardcoded date regexes (CN/EN-US/DE) - any other browser locale (e.g.
 * en-CA's "2026-08-13, 7:13:20 a.m.") never matched, so Total Value/Daily Output were silently
 * never injected for those users, regardless of timing. Matching is now purely positional: the
 * native panel renders one row per lootLog array entry, newest first, so a row's index among
 * its siblings maps directly to an array index - no date parsing involved.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const itemPrices = {};

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => key === 'lootLogStats'),
        getSettingValue: vi.fn((key, defaultValue) => defaultValue),
        COLOR_GOLD: '#ffd700',
        COLOR_INFO: '#60a5fa',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn(() => null),
        getActionDetails: vi.fn(() => null),
        getInitClientData: vi.fn(() => ({ skillDetailMap: {} })),
    },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: vi.fn((hrid) => itemPrices[hrid] || null),
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: { isInitialized: false },
}));

vi.mock('./loot-log-history.js', () => ({
    default: { mergeAndSave: vi.fn(), getHistoricalEntries: vi.fn(async () => []), _load: vi.fn(async () => []) },
}));

const { default: lootLogStatsFeature } = await import('./loot-log-stats.js');

function buildActionLootRow() {
    const row = document.createElement('div');
    row.className = 'LootLogPanel_actionLoot__32gl_';

    const header = document.createElement('div');
    header.innerHTML = '<span>Combat - Golem Cave (5)</span>';

    const startTime = document.createElement('div');
    startTime.textContent = 'Start Time: 8/14/2026, 5:26:41 AM';

    const duration = document.createElement('div');
    duration.textContent = 'Duration: 1h 2m 3s';

    row.append(header, startTime, duration);
    return row;
}

describe('LootLogStats position-based matching', () => {
    let instance;

    beforeEach(async () => {
        document.body.innerHTML = '';
        for (const key of Object.keys(itemPrices)) delete itemPrices[key];
        instance = await lootLogStatsFeature.initialize();
    });

    test('maps DOM row index 0 (newest/topmost) to the LAST lootLog array entry, and index 1 to the second-to-last', () => {
        itemPrices['/items/older_drop'] = { ask: 100, bid: 90 };
        itemPrices['/items/newer_drop'] = { ask: 5, bid: 4 };

        const rowNewest = buildActionLootRow();
        const rowOlder = buildActionLootRow();
        document.body.append(rowNewest, rowOlder);

        instance.currentLootLogData = [
            {
                startTime: '2026-08-14T00:00:00Z',
                endTime: '2026-08-14T01:00:00Z',
                actionCount: 1,
                actionHrid: '/actions/combat/golem_cave',
                drops: { '/items/older_drop': 10 },
            },
            {
                startTime: '2026-08-14T02:00:00Z',
                endTime: '2026-08-14T03:00:00Z',
                actionCount: 2,
                actionHrid: '/actions/combat/golem_cave',
                drops: { '/items/newer_drop': 10 },
            },
        ];

        instance.processLootLogElement(rowNewest, 0, 2);
        instance.processLootLogElement(rowOlder, 1, 2);

        // rowNewest (index 0) must resolve to the array's LAST entry (newer_drop)...
        expect(rowNewest.textContent).toContain('newer drop');
        expect(rowNewest.textContent).not.toContain('older drop');

        // ...and rowOlder (index 1) to the second-to-last entry (older_drop).
        expect(rowOlder.textContent).toContain('older drop');
        expect(rowOlder.textContent).not.toContain('newer drop');
    });

    test('skips and does not mark processed when the rendered row count does not yet match the data length', () => {
        const row = buildActionLootRow();
        document.body.append(row);
        instance.currentLootLogData = [
            {
                startTime: '2026-08-14T00:00:00Z',
                endTime: '2026-08-14T01:00:00Z',
                actionCount: 1,
                actionHrid: '/actions/combat/golem_cave',
                drops: {},
            },
        ];

        // totalCount (3) doesn't match currentLootLogData.length (1) - e.g. mid-render.
        instance.processLootLogElement(row, 0, 3);

        expect(row.querySelector('.mwi-loot-log-value')).toBeNull();
        expect(instance.processedLogs.has(row)).toBe(false);

        // Retried later with the correct count once the DOM has caught up.
        instance.processLootLogElement(row, 0, 1);

        expect(row.querySelector('.mwi-loot-log-value')).not.toBeNull();
        expect(instance.processedLogs.has(row)).toBe(true);
    });

    test('skips enhancement actions but still marks the row processed', () => {
        const row = buildActionLootRow();
        document.body.append(row);
        instance.currentLootLogData = [
            {
                startTime: '2026-08-14T00:00:00Z',
                endTime: '2026-08-14T01:00:00Z',
                actionCount: 1,
                actionHrid: '/actions/enhancing/enhance',
                drops: {},
            },
        ];

        instance.processLootLogElement(row, 0, 1);

        expect(row.querySelector('.mwi-loot-log-value')).toBeNull();
        expect(instance.processedLogs.has(row)).toBe(true);
    });

    test('never re-processes a row once matched, even if called again with the same index', () => {
        const row = buildActionLootRow();
        document.body.append(row);
        instance.currentLootLogData = [
            {
                startTime: '2026-08-14T00:00:00Z',
                endTime: '2026-08-14T01:00:00Z',
                actionCount: 1,
                actionHrid: '/actions/combat/golem_cave',
                drops: {},
            },
        ];

        instance.processLootLogElement(row, 0, 1);
        const firstInjection = row.querySelector('.mwi-loot-log-value');
        expect(firstInjection).not.toBeNull();

        // Data changes, but the row was already matched - re-processing must be a no-op.
        instance.currentLootLogData = [];
        instance.processLootLogElement(row, 0, 0);

        expect(row.querySelector('.mwi-loot-log-value')).toBe(firstInjection);
    });
});

describe('LootLogStats Analytics (pivot table) button and panel', () => {
    let instance;

    function buildPanelHeader() {
        const panel = document.createElement('div');
        panel.className = 'LootLogPanel_lootLogPanel__2013X';
        const heading = document.createElement('h1');
        heading.textContent = 'Loot & XP Log';
        const refreshWrap = document.createElement('div');
        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Refresh';
        refreshWrap.appendChild(refreshBtn);
        panel.append(heading, refreshWrap);
        return panel;
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        instance = await lootLogStatsFeature.initialize();
    });

    test('injects a 📊 button immediately after the native Refresh button', () => {
        const panel = buildPanelHeader();
        document.body.appendChild(panel);

        instance.injectAnalyticsButton(panel);

        const btn = panel.querySelector('.mwi-loot-log-analytics-btn');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe('📊');
        expect(btn.previousElementSibling.textContent).toBe('Refresh');
    });

    test('never injects a second button into the same panel', () => {
        const panel = buildPanelHeader();
        document.body.appendChild(panel);

        instance.injectAnalyticsButton(panel);
        instance.injectAnalyticsButton(panel);

        expect(panel.querySelectorAll('.mwi-loot-log-analytics-btn')).toHaveLength(1);
    });

    test('does nothing if the panel has no Refresh button (e.g. mid-render)', () => {
        const panel = document.createElement('div');
        expect(() => instance.injectAnalyticsButton(panel)).not.toThrow();
        expect(panel.querySelector('.mwi-loot-log-analytics-btn')).toBeNull();
    });

    test('clicking the button opens an overlay attached to the document, and the close button removes it', async () => {
        const panel = buildPanelHeader();
        document.body.appendChild(panel);
        instance.injectAnalyticsButton(panel);

        panel.querySelector('.mwi-loot-log-analytics-btn').click();
        // openAnalyticsPanel is async (awaits lootLogHistory._load()) - flush microtasks.
        await Promise.resolve();
        await Promise.resolve();

        const overlay = document.querySelector('.mwi-loot-log-analytics-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.textContent).toContain('Loot & XP Log Analytics');

        overlay.querySelector('h2 + span').click();
        expect(document.querySelector('.mwi-loot-log-analytics-overlay')).toBeNull();
    });

    test('the pivot table aggregates current-session entries by action, summing time/XP/drops', async () => {
        instance.currentLootLogData = [
            {
                characterActionId: 1,
                actionHrid: '/actions/woodcutting/arcane_tree',
                actionCount: 100,
                startTime: '2026-08-01T00:00:00Z',
                endTime: '2026-08-01T01:00:00Z',
                totalActiveMillis: 3_600_000,
                drops: { '/items/arcane_log::0': 100 },
                xpGains: { '/skills/woodcutting': 5000 },
            },
            {
                characterActionId: 2,
                actionHrid: '/actions/woodcutting/arcane_tree',
                actionCount: 200,
                startTime: '2026-08-02T00:00:00Z',
                endTime: '2026-08-02T02:00:00Z',
                totalActiveMillis: 7_200_000,
                drops: { '/items/arcane_log::0': 200 },
                xpGains: { '/skills/woodcutting': 10000 },
            },
        ];

        await instance.openAnalyticsPanel();

        const overlay = document.querySelector('.mwi-loot-log-analytics-overlay');
        expect(overlay.textContent).toContain('1 action');
        // Combined actionCount across both entries (100 + 200).
        expect(overlay.textContent).toContain('300');
        // Combined active time (1h + 2h).
        expect(overlay.textContent).toContain('3h');
        // A single-skill action's total would just repeat the one XP chip - must not show one.
        expect(overlay.querySelector('.mwi-loot-log-xp-total')).toBeNull();

        instance.closeAnalyticsPanel();
    });

    test('a multi-skill action (e.g. Labyrinth) shows a Total XP/hr line summing every skill, aggregated across all sessions', async () => {
        instance.currentLootLogData = [
            {
                characterActionId: 1,
                actionHrid: '/actions/labyrinth/explore',
                actionCount: 10,
                startTime: '2026-08-01T00:00:00Z',
                endTime: '2026-08-01T01:00:00Z',
                totalActiveMillis: 3_600_000, // 1h
                drops: {},
                xpGains: { '/skills/stamina': 1000, '/skills/attack': 2000 },
            },
            {
                characterActionId: 2,
                actionHrid: '/actions/labyrinth/explore',
                actionCount: 10,
                startTime: '2026-08-02T00:00:00Z',
                endTime: '2026-08-02T01:00:00Z',
                totalActiveMillis: 3_600_000, // 1h - second stored session, same action
                drops: {},
                xpGains: { '/skills/stamina': 1000, '/skills/attack': 2000 },
            },
        ];

        await instance.openAnalyticsPanel();

        const overlay = document.querySelector('.mwi-loot-log-analytics-overlay');
        // Total time across both sessions is 2h; total XP across both skills per session is
        // 3000, summed across sessions is 6000 -> 3000/hr averaged over the whole 2h, not 6000/hr
        // as it would be if computed per single stored session.
        const totalChip = overlay.querySelector('.mwi-loot-log-xp-total');
        expect(totalChip).not.toBeNull();
        expect(totalChip.textContent).toContain('6.0K');
        expect(totalChip.textContent).toContain('(3.0K/hr)');

        instance.closeAnalyticsPanel();
    });

    test('cleanup removes any injected button and closes an open panel', async () => {
        const panel = buildPanelHeader();
        document.body.appendChild(panel);
        instance.injectAnalyticsButton(panel);
        await instance.openAnalyticsPanel();

        instance.cleanup();

        expect(document.querySelector('.mwi-loot-log-analytics-btn')).toBeNull();
        expect(document.querySelector('.mwi-loot-log-analytics-overlay')).toBeNull();
    });
});
