import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    itemDetailMap: {},
    openableLootDropMap: {},
    currentCharacterId: null,
    currentCharacterName: null,
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({
            itemDetailMap: mocks.itemDetailMap,
            openableLootDropMap: mocks.openableLootDropMap,
        })),
        getItemDetails: vi.fn((hrid) => mocks.itemDetailMap[hrid] || null),
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getCurrentCharacterName: vi.fn(() => mocks.currentCharacterName),
    },
}));

const { buildItemNameToHridMap, detectImportSource, parseCombatSuiteExport, parseEdibleExport } =
    await import('./openable-analytics-import-parsers.js');

beforeEach(() => {
    mocks.itemDetailMap = {
        '/items/large_treasure_chest': { name: 'Large Treasure Chest' },
        '/items/coin': { name: 'Coin' },
        '/items/pearl': { name: 'Pearl' },
    };
    // A non-empty drop table so a resolved container with real itemTotals is never silently
    // treated as "known non-monetary with no loot" purely because a test's itemTotals is empty.
    mocks.openableLootDropMap = { '/items/large_treasure_chest': [{ itemHrid: '/items/coin', dropRate: 0.9 }] };
    mocks.currentCharacterId = null;
    mocks.currentCharacterName = null;
});

describe('buildItemNameToHridMap', () => {
    test('builds a lowercased name -> HRID map from current game data', () => {
        const map = buildItemNameToHridMap();

        expect(map['coin']).toBe('/items/coin');
        expect(map['large treasure chest']).toBe('/items/large_treasure_chest');
    });
});

describe('detectImportSource (section 16)', () => {
    test('recognizes an MWI Combat Suite export by its chests shape', () => {
        const result = detectImportSource(JSON.stringify({ chests: {} }));

        expect(result.source).toBe('mwi-combat-suite');
    });

    test('recognizes an Edible Tools export by its Chest_Open_Data shape', () => {
        const result = detectImportSource(JSON.stringify({ Chest_Open_Data: {} }));

        expect(result.source).toBe('edible');
    });

    test('rejects invalid JSON', () => {
        const result = detectImportSource('not json');

        expect(result.source).toBeNull();
        expect(result.error).toBeTruthy();
    });

    test('rejects a JSON shape matching neither supported format', () => {
        const result = detectImportSource(JSON.stringify({ foo: 'bar' }));

        expect(result.source).toBeNull();
        expect(result.error).toBeTruthy();
    });

    test('rejects an array at the top level', () => {
        const result = detectImportSource(JSON.stringify([1, 2, 3]));

        expect(result.source).toBeNull();
    });

    test('rejects an ambiguous export matching both shapes', () => {
        const result = detectImportSource(JSON.stringify({ chests: {}, Chest_Open_Data: {} }));

        expect(result.source).toBeNull();
        expect(result.error).toBeTruthy();
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
        const { status, containers, warnings } = parseCombatSuiteExport(exportJson());

        expect(status).toBe('ready');
        expect(warnings).toHaveLength(0);
        expect(containers).toHaveLength(1);
        expect(containers[0]).toEqual({
            containerHrid: '/items/large_treasure_chest',
            containerCount: 3671,
            itemTotals: { '/items/coin': 246365372, '/items/pearl': 4479 },
            sourceDataComplete: true,
        });
    });

    test('reads top-level player metadata for ownership preflight', () => {
        const result = parseCombatSuiteExport(exportJson());

        expect(result.ownerName).toBe('Celasha');
    });

    test('section 19: owner matches current character -> no mismatch warning', () => {
        mocks.currentCharacterName = 'Celasha';
        const result = parseCombatSuiteExport(exportJson());

        expect(result.ownerMismatch).toBe(false);
    });

    test('section 19: owner differs from current character -> explicit mismatch flag', () => {
        mocks.currentCharacterName = 'SomeoneElse';
        const result = parseCombatSuiteExport(exportJson());

        expect(result.ownerMismatch).toBe(true);
    });

    test('section 19: owner metadata absent -> neither matched nor mismatched, caller must warn explicitly', () => {
        const result = parseCombatSuiteExport(JSON.stringify({ chests: JSON.parse(exportJson()).chests }));

        expect(result.ownerName).toBeNull();
        expect(result.ownerMismatch).toBeNull();
    });

    test('section 17: a chest with zero/missing opened count is silently ignored, not a warning', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            exportJson({ '/items/purples_gift': { name: 'Purples Gift', total: { opened: 0, loot: {} } } })
        );

        expect(containers).toHaveLength(1);
        expect(warnings).toHaveLength(0);
    });

    test('invalid JSON is reported as an explicit invalid state, not empty', () => {
        const result = parseCombatSuiteExport('not json');

        expect(result.status).toBe('invalid');
        expect(result.containers).toHaveLength(0);
        expect(result.message).toBeTruthy();
    });

    test('no "chests" key is reported as invalid', () => {
        const result = parseCombatSuiteExport(JSON.stringify({ player: 'x' }));

        expect(result.status).toBe('invalid');
    });

    test('section 17: a syntactically valid export with no relevant opening history is a safe no-op, not implicit deletion', () => {
        const result = parseCombatSuiteExport(
            JSON.stringify({ chests: { '/items/large_treasure_chest': { total: { opened: 0, loot: {} } } } })
        );

        expect(result.status).toBe('empty');
        expect(result.containers).toHaveLength(0);
        expect(result.message).toMatch(/not.*changed/i);
    });

    test('section 18: rejects a malformed HRID key rather than importing it', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({ chests: { 'not-a-real-hrid': { total: { opened: 5, loot: {} } } } })
        );

        expect(containers).toHaveLength(0);
        expect(warnings.some((w) => w.includes('invalid item id'))).toBe(true);
    });

    test('section 18: rejects array-shaped "chests" rather than coercing it', () => {
        const result = parseCombatSuiteExport(JSON.stringify({ chests: [] }));

        expect(result.status).toBe('invalid');
    });

    test('section 18: rejects a string count instead of coercing "100" to 100', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({
                chests: { '/items/large_treasure_chest': { total: { opened: '100', loot: {} } } },
            })
        );

        expect(containers).toHaveLength(0);
        expect(warnings.some((w) => w.includes('invalid opened count'))).toBe(true);
    });

    test('section 18: rejects a negative count', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({ chests: { '/items/large_treasure_chest': { total: { opened: -5, loot: {} } } } })
        );

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });

    test('section 18: rejects a fractional count', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({ chests: { '/items/large_treasure_chest': { total: { opened: 5.5, loot: {} } } } })
        );

        expect(containers).toHaveLength(0);
        expect(warnings.length).toBeGreaterThan(0);
    });

    test('section 18: a missing loot block on a real opened count fails closed rather than becoming Actual 0 / huge Expected', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({ chests: { '/items/large_treasure_chest': { total: { opened: 100 } } } })
        );

        expect(containers).toHaveLength(0);
        expect(warnings.some((w) => w.includes('loot data is missing'))).toBe(true);
    });

    test('section 18: an explicitly present empty loot map is a legitimate zero-loot import, not corruption', () => {
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({
                chests: { '/items/purples_gift': { total: { opened: 100, loot: {} } } },
            })
        );

        expect(warnings.filter((w) => w.includes('missing') || w.includes('malformed'))).toHaveLength(0);
        expect(containers[0]).toMatchObject({ containerHrid: '/items/purples_gift', containerCount: 100 });
    });

    test('section 19: a syntactically valid unknown historical HRID is preserved, not discarded', () => {
        const { containers } = parseCombatSuiteExport(
            JSON.stringify({
                chests: {
                    '/items/long_removed_chest': {
                        total: { opened: 10, loot: { '/items/coin': { count: 100 } } },
                    },
                },
            })
        );

        expect(containers).toHaveLength(1);
        expect(containers[0].containerHrid).toBe('/items/long_removed_chest');
    });

    test('section 19: a current-known non-monetary container with empty imported loot is silently skipped', () => {
        mocks.openableLootDropMap = {}; // /items/large_treasure_chest has no drop model
        const { containers, warnings } = parseCombatSuiteExport(
            JSON.stringify({ chests: { '/items/large_treasure_chest': { total: { opened: 5, loot: {} } } } })
        );

        expect(containers).toHaveLength(0);
        expect(warnings).toHaveLength(0);
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
        const { status, containers, warnings } = parseEdibleExport(edibleJson());

        expect(status).toBe('ready');
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

    test('requests player selection when the export has more than one player and none can be resolved automatically', () => {
        const result = parseEdibleExport(edibleJson({ p2: { 玩家昵称: 'Other', 开箱数据: {} } }));

        expect(result.needsPlayerSelection).toBe(true);
        expect(result.players).toEqual([
            { id: 'p1', name: 'Celasha' },
            { id: 'p2', name: 'Other' },
        ]);
    });

    test('section 20: resolves the player automatically via an exact current-character-ID match', () => {
        mocks.currentCharacterId = 'p2';
        const result = parseEdibleExport(edibleJson({ p2: { 玩家昵称: 'Other', 开箱数据: {} } }));

        expect(result.needsPlayerSelection).toBeFalsy();
    });

    test('section 20: resolves the player automatically via a unique exact current-character-name match', () => {
        mocks.currentCharacterName = 'Other';
        const result = parseEdibleExport(edibleJson({ p2: { 玩家昵称: 'Other', 开箱数据: {} } }));

        expect(result.needsPlayerSelection).toBeFalsy();
    });

    test('section 20: an ambiguous name match (two players share the current character name) still requires a picker', () => {
        mocks.currentCharacterName = 'Celasha';
        const result = parseEdibleExport(edibleJson({ p2: { 玩家昵称: 'Celasha', 开箱数据: {} } }));

        expect(result.needsPlayerSelection).toBe(true);
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

    test('invalid JSON is reported as an explicit invalid state', () => {
        const result = parseEdibleExport('not json');

        expect(result.status).toBe('invalid');
        expect(result.containers).toHaveLength(0);
    });

    test('no Chest_Open_Data is reported as invalid', () => {
        const result = parseEdibleExport(JSON.stringify({ Edible_Tools_Set: {} }));

        expect(result.status).toBe('invalid');
    });

    test('section 20: no resolvable chest/item names at all is an explicit locale/format failure, not valid-empty', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: { 玩家昵称: 'Celasha', 开箱数据: { 'Coffre Inconnu': { 总计开箱数量: 5, 获得物品: {} } } },
            },
        });

        const result = parseEdibleExport(raw);

        expect(result.status).toBe('invalid');
    });

    test('section 17: a syntactically valid export with no relevant opening history is a safe no-op', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: {
                    玩家昵称: 'Celasha',
                    开箱数据: { 'Large Treasure Chest': { 总计开箱数量: 0, 获得物品: {} } },
                },
            },
        });

        const result = parseEdibleExport(raw);

        expect(result.status).toBe('empty');
        expect(result.message).toMatch(/not.*changed/i);
    });

    test('section 18: rejects a string count instead of coercing "100" to 100', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: {
                    玩家昵称: 'Celasha',
                    开箱数据: { 'Large Treasure Chest': { 总计开箱数量: '100', 获得物品: {} } },
                },
            },
        });

        const { containers, warnings } = parseEdibleExport(raw);

        expect(containers).toHaveLength(0);
        expect(warnings.some((w) => w.includes('invalid opened count'))).toBe(true);
    });

    test('section 18: a missing gained-item block on a real opened count fails closed', () => {
        const raw = JSON.stringify({
            Chest_Open_Data: {
                p1: { 玩家昵称: 'Celasha', 开箱数据: { 'Large Treasure Chest': { 总计开箱数量: 100 } } },
            },
        });

        const { containers, warnings } = parseEdibleExport(raw);

        expect(containers).toHaveLength(0);
        expect(warnings.some((w) => w.includes('missing'))).toBe(true);
    });
});
