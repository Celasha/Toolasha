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
    default: { getItemDetails: vi.fn(() => null) },
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrices: vi.fn((hrid) => itemPrices[hrid] || null),
}));

vi.mock('../market/expected-value-calculator.js', () => ({
    default: { isInitialized: false },
}));

vi.mock('./loot-log-history.js', () => ({
    default: { mergeAndSave: vi.fn(), getHistoricalEntries: vi.fn(async () => []) },
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
