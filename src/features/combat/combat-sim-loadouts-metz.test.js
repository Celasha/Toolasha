/**
 * Tests for the Metz saved-loadouts builder. The three example pairs are Metz's own (each expected
 * output was also accepted by the site's parser against live game data on 2026-10-29).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    snapshots: [],
    abilities: [],
    characterId: 'char-1',
    listeners: new Set(),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return { characterAbilities: mocks.abilities };
        },
        getCurrentCharacterId: vi.fn(() => mocks.characterId),
    },
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getAllSnapshots: vi.fn(() => mocks.snapshots),
        onUpdate: vi.fn((fn) => mocks.listeners.add(fn)),
        offUpdate: vi.fn((fn) => mocks.listeners.delete(fn)),
    },
}));

import {
    buildMetzLoadouts,
    collectMetzLoadouts,
    getMetzLoadouts,
    startMetzLoadoutPublisher,
    stopMetzLoadoutPublisher,
} from './combat-sim-loadouts-metz.js';

const T = (dependencyHrid, conditionHrid, comparatorHrid, value) => ({
    dependencyHrid,
    conditionHrid,
    comparatorHrid,
    value,
});
const HP_BELOW_60 = T(
    '/combat_trigger_dependencies/self',
    '/combat_trigger_conditions/current_hp',
    '/combat_trigger_comparators/less_than_equal',
    0.6
);
const ENEMIES_2 = T(
    '/combat_trigger_dependencies/all_enemies',
    '/combat_trigger_conditions/number_of_active_units',
    '/combat_trigger_comparators/greater_than_equal',
    2
);

const EXAMPLES = [
    {
        title: 'a complete mage loadout: slots ordered, levels looked up, null for the cleared trigger list, tool slot and spare keys dropped',
        abilityLevels: {
            '/abilities/fireball': 120,
            '/abilities/flame_blast': 95,
            '/abilities/elemental_affinity': 88,
        },
        snapshots: [
            {
                snapshotId: '12',
                name: 'Dungeon',
                actionTypeHrid: '/action_types/combat',
                isDefault: false,
                ordinal: 3,
                isUsableForCalculation: true,
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/body',
                        itemHrid: '/items/royal_fire_robe_top',
                        enhancementLevel: 7,
                        isAvailable: true,
                    },
                    {
                        itemLocationHrid: '/item_locations/main_hand',
                        itemHrid: '/items/infernal_battlestaff',
                        enhancementLevel: 10,
                        isAvailable: true,
                    },
                    {
                        itemLocationHrid: '/item_locations/enhancing_tool',
                        itemHrid: '/items/celestial_enhancer',
                        enhancementLevel: 10,
                        isAvailable: true,
                    },
                ],
                abilities: [
                    { abilityHrid: '/abilities/flame_blast', slot: 2 },
                    { abilityHrid: '/abilities/fireball', slot: 1 },
                    { abilityHrid: '/abilities/elemental_affinity', slot: 5 },
                ],
                food: [{ itemHrid: '/items/spaceberry_cake' }, { itemHrid: '' }, { itemHrid: '' }],
                drinks: [
                    { itemHrid: '/items/ultra_magic_coffee' },
                    { itemHrid: '/items/wisdom_coffee' },
                    { itemHrid: '' },
                ],
                abilityCombatTriggersMap: { '/abilities/flame_blast': [ENEMIES_2], '/abilities/poke': [ENEMIES_2] },
                consumableCombatTriggersMap: { '/items/spaceberry_cake': [HP_BELOW_60] },
            },
        ],
        expected: [
            {
                id: '12',
                name: 'Dungeon',
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/body',
                        itemHrid: '/items/royal_fire_robe_top',
                        enhancementLevel: 7,
                    },
                    {
                        itemLocationHrid: '/item_locations/main_hand',
                        itemHrid: '/items/infernal_battlestaff',
                        enhancementLevel: 10,
                    },
                ],
                abilities: [
                    { abilityHrid: '/abilities/fireball', level: 120 },
                    { abilityHrid: '/abilities/flame_blast', level: 95 },
                    { abilityHrid: '/abilities/elemental_affinity', level: 88 },
                ],
                food: [{ itemHrid: '/items/spaceberry_cake' }],
                drinks: [{ itemHrid: '/items/ultra_magic_coffee' }, { itemHrid: '/items/wisdom_coffee' }],
                triggerMap: {
                    '/abilities/fireball': null, // the maps said nothing: "activate whenever ready"
                    '/abilities/flame_blast': [ENEMIES_2],
                    '/abilities/elemental_affinity': null,
                    '/items/spaceberry_cake': [HP_BELOW_60],
                    '/items/ultra_magic_coffee': null,
                    '/items/wisdom_coffee': null,
                    // "/abilities/poke" is not in the loadout, so its entry is not carried
                },
            },
        ],
    },
    {
        title: 'ordering and dropping: ordinal order, the all-skills loadout and the empty one left out, an unowned item left out, unknown ability level 1',
        abilityLevels: { '/abilities/poke': 30 },
        snapshots: [
            {
                snapshotId: '5',
                name: 'Everything',
                actionTypeHrid: '',
                ordinal: 1,
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/body',
                        itemHrid: '/items/cheese_plate_body',
                        enhancementLevel: 0,
                        isAvailable: true,
                    },
                ],
                abilities: [],
                food: [],
                drinks: [],
                abilityCombatTriggersMap: {},
                consumableCombatTriggersMap: {},
            },
            {
                snapshotId: '9',
                name: 'Second',
                actionTypeHrid: '/action_types/combat',
                ordinal: 2,
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/main_hand',
                        itemHrid: '/items/cheese_sword',
                        enhancementLevel: 3,
                        isAvailable: true,
                    },
                ],
                abilities: [
                    { abilityHrid: '/abilities/poke', slot: 1 },
                    { abilityHrid: '/abilities/scratch', slot: 2 },
                ],
                food: [],
                drinks: [],
                abilityCombatTriggersMap: { '/abilities/poke': [], '/abilities/scratch': [ENEMIES_2] },
                consumableCombatTriggersMap: {},
            },
            {
                snapshotId: '2',
                name: 'First',
                actionTypeHrid: '/action_types/combat',
                ordinal: 0,
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/body',
                        itemHrid: '/items/royal_fire_robe_top',
                        enhancementLevel: null,
                        isAvailable: false,
                    },
                    {
                        itemLocationHrid: '/item_locations/legs',
                        itemHrid: '/items/cheese_plate_legs',
                        enhancementLevel: 2,
                        isAvailable: true,
                    },
                ],
                abilities: [],
                food: [{ itemHrid: '/items/donut' }],
                drinks: [],
                abilityCombatTriggersMap: {},
                consumableCombatTriggersMap: {},
            },
            {
                snapshotId: '7',
                name: 'Fresh slot',
                actionTypeHrid: '/action_types/combat',
                ordinal: 3,
                equipment: [],
                abilities: [],
                food: [{ itemHrid: '/items/donut' }],
                drinks: [],
                abilityCombatTriggersMap: {},
                consumableCombatTriggersMap: {},
            },
        ],
        expected: [
            {
                id: '2',
                name: 'First',
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/legs',
                        itemHrid: '/items/cheese_plate_legs',
                        enhancementLevel: 2,
                    },
                ],
                abilities: [],
                food: [{ itemHrid: '/items/donut' }],
                drinks: [],
                triggerMap: { '/items/donut': null },
            },
            {
                id: '9',
                name: 'Second',
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/main_hand',
                        itemHrid: '/items/cheese_sword',
                        enhancementLevel: 3,
                    },
                ],
                abilities: [
                    { abilityHrid: '/abilities/poke', level: 30 },
                    { abilityHrid: '/abilities/scratch', level: 1 },
                ],
                food: [],
                drinks: [],
                triggerMap: { '/abilities/poke': [], '/abilities/scratch': [ENEMIES_2] },
            },
        ],
    },
    {
        title: 'defensive: no snapshots, junk entries, a missing name and id, gaps in the ability slots, a duplicate ability, a malformed trigger row',
        abilityLevels: null,
        snapshots: [
            null,
            'junk',
            { actionTypeHrid: '/action_types/combat' },
            {
                actionTypeHrid: '/action_types/combat',
                equipment: [
                    {
                        itemLocationHrid: '/item_locations/head',
                        itemHrid: '/items/cotton_hat',
                        enhancementLevel: '4',
                        isAvailable: true,
                    },
                ],
                abilities: [
                    { abilityHrid: '/abilities/poke', slot: 4 },
                    { abilityHrid: '/abilities/poke', slot: 1 },
                    { abilityHrid: '', slot: 2 },
                ],
                abilityCombatTriggersMap: {
                    '/abilities/poke': [ENEMIES_2, { conditionHrid: 'half a trigger' }, 'not a trigger'],
                },
            },
        ],
        expected: [
            {
                id: '1',
                name: 'Loadout 1',
                equipment: [
                    { itemLocationHrid: '/item_locations/head', itemHrid: '/items/cotton_hat', enhancementLevel: 4 },
                ],
                abilities: [{ abilityHrid: '/abilities/poke', level: 1 }],
                food: [],
                drinks: [],
                triggerMap: { '/abilities/poke': [ENEMIES_2] },
            },
        ],
    },
];

describe('buildMetzLoadouts', () => {
    for (const example of EXAMPLES) {
        test(example.title, () => {
            expect(buildMetzLoadouts(example.snapshots, example.abilityLevels)).toEqual(example.expected);
        });
    }

    test('no input gives an empty list and the input is never mutated', () => {
        expect(buildMetzLoadouts(undefined)).toEqual([]);
        expect(buildMetzLoadouts([], {})).toEqual([]);
        const snapshot = EXAMPLES[0].snapshots[0];
        const before = JSON.stringify(snapshot);
        buildMetzLoadouts([snapshot], EXAMPLES[0].abilityLevels);
        expect(JSON.stringify(snapshot)).toBe(before);
    });
});

describe('live and stored loadouts', () => {
    beforeEach(() => {
        mocks.snapshots = [];
        mocks.abilities = [];
        mocks.listeners.clear();
        delete globalThis.GM_getValue;
        delete globalThis.GM_setValue;
        stopMetzLoadoutPublisher();
    });

    const usable = { ...EXAMPLES[0].snapshots[0], isUsableForCalculation: true };

    test('collect skips loadouts that need gear the character does not own', () => {
        mocks.snapshots = [usable, { ...EXAMPLES[0].snapshots[0], snapshotId: '13', isUsableForCalculation: false }];
        mocks.abilities = [{ abilityHrid: '/abilities/fireball', level: 120 }];

        const loadouts = collectMetzLoadouts();

        expect(loadouts.map((l) => l.id)).toEqual(['12']);
        expect(loadouts[0].abilities.find((a) => a.abilityHrid === '/abilities/fireball').level).toBe(120);
    });

    test('getMetzLoadouts falls back to the stored copy for the same character only', () => {
        const stored = [{ id: '1', name: 'Stored' }];
        globalThis.GM_getValue = vi.fn(() => JSON.stringify({ characterId: 'char-1', loadouts: stored }));

        expect(getMetzLoadouts('char-1')).toEqual(stored);
        expect(getMetzLoadouts('char-2')).toEqual([]);
    });

    test('getMetzLoadouts prefers live loadout state over storage', () => {
        mocks.snapshots = [usable];
        globalThis.GM_getValue = vi.fn(() => JSON.stringify({ characterId: 'char-1', loadouts: [{ id: 'old' }] }));

        expect(getMetzLoadouts('char-1').map((l) => l.id)).toEqual(['12']);
    });

    test('the publisher stores the built loadouts once and not again when nothing changed', () => {
        vi.useFakeTimers();
        globalThis.GM_setValue = vi.fn();
        mocks.snapshots = [usable];

        startMetzLoadoutPublisher();
        vi.advanceTimersByTime(2100);
        expect(globalThis.GM_setValue).toHaveBeenCalledTimes(1);
        expect(JSON.parse(globalThis.GM_setValue.mock.calls[0][1]).characterId).toBe('char-1');

        [...mocks.listeners][0]();
        vi.advanceTimersByTime(2100);
        expect(globalThis.GM_setValue).toHaveBeenCalledTimes(1);

        stopMetzLoadoutPublisher();
        expect(mocks.listeners.size).toBe(0);
        vi.useRealTimers();
    });
});
