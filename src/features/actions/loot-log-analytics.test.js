/**
 * Tests for loot-log-analytics.js's pure pivot-table aggregation math.
 */

import { describe, test, expect } from 'vitest';
import {
    getEntryDurationMs,
    mergeCurrentAndHistoricalEntries,
    buildActionGroupKey,
    aggregatePivotRows,
} from './loot-log-analytics.js';

describe('getEntryDurationMs', () => {
    test('uses totalActiveMillis when present and positive, matching the game’s own Duration display', () => {
        const entry = {
            totalActiveMillis: 5000,
            startTime: '2026-08-01T00:00:00Z',
            endTime: '2026-08-01T01:00:00Z', // would be 3,600,000ms if wall-clock were used
        };
        expect(getEntryDurationMs(entry)).toBe(5000);
    });

    test('falls back to endTime - startTime when totalActiveMillis is missing or zero', () => {
        const entry = { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-01T01:00:00Z' };
        expect(getEntryDurationMs(entry)).toBe(3_600_000);

        const zeroActive = { ...entry, totalActiveMillis: 0 };
        expect(getEntryDurationMs(zeroActive)).toBe(3_600_000);
    });

    test('returns 0 for missing timestamps or a non-positive wall-clock span, never NaN/negative', () => {
        expect(getEntryDurationMs({})).toBe(0);
        expect(getEntryDurationMs({ startTime: '2026-08-01T01:00:00Z', endTime: '2026-08-01T00:00:00Z' })).toBe(0);
    });
});

describe('mergeCurrentAndHistoricalEntries', () => {
    test('dedupes by characterActionId, preferring the current-session copy on overlap', () => {
        const historical = [{ characterActionId: 1, actionCount: 10 }];
        const current = [
            { characterActionId: 1, actionCount: 15 },
            { characterActionId: 2, actionCount: 5 },
        ];

        const merged = mergeCurrentAndHistoricalEntries(current, historical);

        expect(merged).toHaveLength(2);
        expect(merged.find((e) => e.characterActionId === 1).actionCount).toBe(15);
        expect(merged.find((e) => e.characterActionId === 2).actionCount).toBe(5);
    });

    test('entries without a characterActionId are silently dropped rather than colliding under undefined', () => {
        const merged = mergeCurrentAndHistoricalEntries([{ actionCount: 1 }], [{ actionCount: 2 }]);
        expect(merged).toHaveLength(0);
    });

    test('handles missing/empty arrays on either side', () => {
        expect(mergeCurrentAndHistoricalEntries(null, [{ characterActionId: 1 }])).toHaveLength(1);
        expect(mergeCurrentAndHistoricalEntries([{ characterActionId: 1 }], undefined)).toHaveLength(1);
        expect(mergeCurrentAndHistoricalEntries(null, null)).toHaveLength(0);
    });
});

describe('buildActionGroupKey', () => {
    test('same actionHrid with different difficultyTier values produces distinct keys', () => {
        const a = buildActionGroupKey({ actionHrid: '/actions/combat/x', difficultyTier: 1 });
        const b = buildActionGroupKey({ actionHrid: '/actions/combat/x', difficultyTier: 2 });
        expect(a).not.toBe(b);
    });

    test('a missing difficultyTier normalizes to the same key regardless of null vs undefined', () => {
        const a = buildActionGroupKey({ actionHrid: '/actions/woodcutting/arcane_tree', difficultyTier: null });
        const b = buildActionGroupKey({ actionHrid: '/actions/woodcutting/arcane_tree' });
        expect(a).toBe(b);
    });
});

describe('aggregatePivotRows', () => {
    function arcaneEntry(overrides = {}) {
        return {
            characterActionId: Math.random(),
            actionHrid: '/actions/woodcutting/arcane_tree',
            actionCount: 100,
            startTime: '2026-08-01T00:00:00Z',
            endTime: '2026-08-01T01:00:00Z',
            totalActiveMillis: 3_600_000,
            drops: { '/items/arcane_log::0': 100 },
            xpGains: { '/skills/woodcutting': 5000 },
            ...overrides,
        };
    }

    test('sums actionCount, time, drops, and XP across every entry sharing the same action', () => {
        const entries = [
            arcaneEntry(),
            arcaneEntry({
                startTime: '2026-08-02T00:00:00Z',
                endTime: '2026-08-02T02:00:00Z',
                totalActiveMillis: 7_200_000,
                drops: { '/items/arcane_log::0': 200 },
                xpGains: { '/skills/woodcutting': 10000 },
            }),
        ];

        const [row] = aggregatePivotRows(entries);

        expect(row.actionHrid).toBe('/actions/woodcutting/arcane_tree');
        expect(row.entryCount).toBe(2);
        expect(row.actionCount).toBe(200);
        expect(row.totalTimeMs).toBe(10_800_000);
        expect(row.drops['/items/arcane_log::0']).toBe(300);
        expect(row.xpGains['/skills/woodcutting']).toBe(15000);
        expect(row.earliestStartMs).toBe(new Date('2026-08-01T00:00:00Z').getTime());
        expect(row.latestEndMs).toBe(new Date('2026-08-02T02:00:00Z').getTime());
    });

    test('different actions produce separate rows, and different difficultyTiers of the same action never merge', () => {
        const entries = [
            arcaneEntry(),
            arcaneEntry({ actionHrid: '/actions/foraging/berries', drops: { '/items/berry::0': 50 } }),
            { ...arcaneEntry(), actionHrid: '/actions/combat/dungeon', difficultyTier: 1 },
            { ...arcaneEntry(), actionHrid: '/actions/combat/dungeon', difficultyTier: 2 },
        ];

        const rows = aggregatePivotRows(entries);

        expect(rows).toHaveLength(4);
        const dungeonRows = rows.filter((r) => r.actionHrid === '/actions/combat/dungeon');
        expect(dungeonRows).toHaveLength(2);
        expect(dungeonRows.map((r) => r.difficultyTier).sort()).toEqual([1, 2]);
    });

    test('excludes /skills/total_level from summed XP, matching the native panel’s own filter', () => {
        const entries = [arcaneEntry({ xpGains: { '/skills/woodcutting': 5000, '/skills/total_level': 5000 } })];
        const [row] = aggregatePivotRows(entries);
        expect(row.xpGains['/skills/total_level']).toBeUndefined();
        expect(row.xpGains['/skills/woodcutting']).toBe(5000);
    });

    test('excludes enhancement actions entirely, consistent with the rest of Loot Log Stats', () => {
        const entries = [arcaneEntry({ actionHrid: '/actions/enhancing/enhance' })];
        expect(aggregatePivotRows(entries)).toHaveLength(0);
    });

    test('an entry with no xpGains/drops fields still aggregates without throwing', () => {
        const entries = [arcaneEntry({ drops: undefined, xpGains: undefined })];
        expect(() => aggregatePivotRows(entries)).not.toThrow();
        const [row] = aggregatePivotRows(entries);
        expect(row.drops).toEqual({});
        expect(row.xpGains).toEqual({});
    });
});
