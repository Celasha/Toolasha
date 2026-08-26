import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ itemDetailMap: {} }));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })),
    },
}));

const { buildItemNameToHridMap, parseCombatSuiteExport, parseEdibleExport } =
    await import('./openable-analytics-import-parsers.js');

beforeEach(() => {
    mocks.itemDetailMap = {
        '/items/large_treasure_chest': { name: 'Large Treasure Chest' },
        '/items/coin': { name: 'Coin' },
        '/items/pearl': { name: 'Pearl' },
    };
});

describe('buildItemNameToHridMap', () => {
    test('builds a lowercased name -> HRID map from current game data', () => {
        const map = buildItemNameToHridMap();

        expect(map['coin']).toBe('/items/coin');
        expect(map['large treasure chest']).toBe('/items/large_treasure_chest');
    });
});

describe('parseCombatSuiteExport', () => {
    function exportJson(overrides = {}) {
        return JSON.stringify({
            player: 'Celasha',
            chests: {
                '/items/large_treasure_chest': {
                    name: 'Large Treasure Chest',
                    total: {
                        opened: 3671,
                        actualValue: 689082381,
                        expectedValue: 687488727.6,
                        luck: '0.2%',
                        loot: {
                            '/items/coin': { name: 'Coin', count: 246365372, unitPrice: 1, totalValue: 246365372 },
                            '/items/pearl': { name: 'Pearl', count: 4479, unitPrice: 12544, totalValue: 56184576 },
                        },
                    },
                },
                ...overrides,
            },
        });
    }

    test('reads cumulative opened count and item totals, ignoring the source’s own valuation fields', () => {
        const { containers, warnings } = parseCombatSuiteExport(exportJson());

        expect(warnings).toHaveLength(0);
        expect(containers).toHaveLength(1);
        expect(containers[0]).toEqual({
            containerHrid: '/items/large_treasure_chest',
            containerCount: 3671,
            itemTotals: { '/items/coin': 246365372, '/items/pearl': 4479 },
            sourceDataComplete: true,
        });
    });

    test('skips a chest with zero/missing opened count and warns', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            exportJson({ '/items/purples_gift': { name: 'Purples Gift', total: { opened: 0, loot: {} } } })
        );

        expect(containers).toHaveLength(1);
        expect(warnings.some((w) => w.includes('Purples Gift'))).toBe(true);
    });

    test('returns an empty result with a warning for invalid JSON', () => {
        const { containers, warnings } = parseCombatSuiteExport('not json');

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });

    test('returns an empty result with a warning when there is no "chests" key', () => {
        const { containers, warnings } = parseCombatSuiteExport(JSON.stringify({ player: 'x' }));

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });
});

describe('parseEdibleExport', () => {
    function edibleJson(overrides = {}) {
        return JSON.stringify({
            Chest_Open_Data: {
                p1: {
                    玩家昵称: 'Celasha',
                    开箱数据: {
                        'Large Treasure Chest': {
                            总计开箱数量: 100,
                            获得物品: {
                                Coin: { 数量: 5000 },
                                Pearl: { 数量: 12 },
                            },
                        },
                    },
                },
                ...overrides,
            },
        });
    }

    test('resolves chest and item display names to HRIDs via the current game data', () => {
        const { containers, warnings } = parseEdibleExport(edibleJson());

        expect(warnings).toHaveLength(0);
        expect(containers).toEqual([
            {
                containerHrid: '/items/large_treasure_chest',
                containerCount: 100,
                itemTotals: { '/items/coin': 5000, '/items/pearl': 12 },
                sourceDataComplete: true,
            },
        ]);
    });

    test('skips and warns about a chest name that cannot be matched to a known item', () => {
        const { containers, warnings } = parseEdibleExport(
            edibleJson({
                p2: {
                    玩家昵称: 'Other',
                    开箱数据: { 'Some Unknown Chest': { 总计开箱数量: 10, 获得物品: {} } },
                },
            })
        );

        // Two players present with no playerId specified -> needs a player picker instead.
        expect(containers).toHaveLength(0);
        expect(warnings).toHaveLength(0);
    });

    test('requests player selection when the export has more than one player and none is specified', () => {
        const result = parseEdibleExport(edibleJson({ p2: { 玩家昵称: 'Other', 开箱数据: {} } }));

        expect(result.needsPlayerSelection).toBe(true);
        expect(result.players).toEqual([
            { id: 'p1', name: 'Celasha' },
            { id: 'p2', name: 'Other' },
        ]);
    });

    test('imports the specified player’s data when playerId is provided among multiple players', () => {
        const raw = edibleJson({ p2: { 玩家昵称: 'Other', 开箱数据: {} } });
        const result = parseEdibleExport(raw, { playerId: 'p1' });

        expect(result.needsPlayerSelection).toBeFalsy();
        expect(result.containers).toHaveLength(1);
    });

    test('skips and warns about an unmatched gained-item name while still importing the container', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: {
                    玩家昵称: 'Celasha',
                    开箱数据: {
                        'Large Treasure Chest': {
                            总计开箱数量: 100,
                            获得物品: { Coin: { 数量: 5000 }, 'Some Unknown Item': { 数量: 3 } },
                        },
                    },
                },
            },
        });

        const { containers, warnings } = parseEdibleExport(raw);

        expect(containers[0].itemTotals).toEqual({ '/items/coin': 5000 });
        expect(warnings.some((w) => w.includes('1 gained item'))).toBe(true);
    });

    test('IMPORT-3 / OA-9: an unmatched gained item marks the container sourceDataComplete: false, not a falsely complete import', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: {
                    玩家昵称: 'Celasha',
                    开箱数据: {
                        'Large Treasure Chest': {
                            总计开箱数量: 100,
                            获得物品: { Coin: { 数量: 5000 }, 'Some Unknown Item': { 数量: 3 } },
                        },
                    },
                },
            },
        });

        const { containers } = parseEdibleExport(raw);

        expect(containers[0].sourceDataComplete).toBe(false);
    });

    test('a container with every gained item matched is sourceDataComplete: true', () => {
        const { containers } = parseEdibleExport(edibleJson());

        expect(containers[0].sourceDataComplete).toBe(true);
    });

    test('returns an empty result with a warning for invalid JSON', () => {
        const { containers, warnings } = parseEdibleExport('not json');

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });

    test('returns an empty result with a warning when there is no Chest_Open_Data', () => {
        const { containers, warnings } = parseEdibleExport(JSON.stringify({ Edible_Tools_Set: {} }));

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });
});
