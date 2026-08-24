import { describe, expect, test, vi } from 'vitest';
import {
    buildSkillEquipmentResolution,
    resolveConfiguredLoadoutName,
    sanitizeSkillLoadoutAssignments,
} from './lab-sim-loadout-resolution.js';

describe('Lab Sim configured loadout identity', () => {
    test('resolves an existing native Labyrinth assignment to its saved name', () => {
        expect(resolveConfiguredLoadoutName(42, () => ({ name: 'Woodcutting' }))).toBe('Woodcutting');
    });

    test('preserves a deleted/missing native Labyrinth assignment as unavailable identity', () => {
        expect(resolveConfiguredLoadoutName(42, () => null)).toBe('Saved loadout #42');
    });

    test('empty native assignment remains explicit Current Gear', () => {
        const getSnapshotById = vi.fn();
        expect(resolveConfiguredLoadoutName(0, getSnapshotById)).toBe('');
        expect(getSnapshotById).not.toHaveBeenCalled();
    });
});

describe('Lab Sim skilling loadout resolution', () => {
    test('preserves a named persisted loadout even when it may currently be unavailable', () => {
        const result = sanitizeSkillLoadoutAssignments(
            {
                '/skills/woodcutting': 'Old Woodcutting',
                '/skills/foraging': 'Usable Foraging',
                '/skills/future_skill': 'Keep Me',
            },
            ['/skills/woodcutting', '/skills/foraging']
        );

        expect(result).toEqual({
            assignments: {
                '/skills/woodcutting': 'Old Woodcutting',
                '/skills/foraging': 'Usable Foraging',
                '/skills/future_skill': 'Keep Me',
            },
            changed: false,
        });
    });

    test('only normalizes malformed persisted assignment value types', () => {
        const result = sanitizeSkillLoadoutAssignments(
            { '/skills/woodcutting': null, '/skills/foraging': 'Foraging' },
            ['/skills/woodcutting', '/skills/foraging']
        );

        expect(result).toEqual({
            assignments: { '/skills/woodcutting': '', '/skills/foraging': 'Foraging' },
            changed: true,
        });
    });

    test('preserves an explicit Current Gear selection', () => {
        const result = sanitizeSkillLoadoutAssignments({ '/skills/woodcutting': '' }, ['/skills/woodcutting']);

        expect(result.changed).toBe(false);
        expect(result.assignments['/skills/woodcutting']).toBe('');
    });

    test('keeps an intentionally empty-equipment loadout distinct from Current Gear', () => {
        const getUsableSnapshotByName = vi.fn(() => ({ name: 'Naked', equipment: [] }));
        const result = buildSkillEquipmentResolution({ '/skills/woodcutting': 'Naked' }, {}, getUsableSnapshotByName);

        expect(result.unavailableSelections).toEqual([]);
        expect(result.equipmentMap).toEqual({ '/skills/woodcutting': {} });
    });

    test('reports a selected loadout that becomes unavailable instead of silently using current gear', () => {
        const result = buildSkillEquipmentResolution({ '/skills/woodcutting': 'Missing Loadout' }, {}, () => null);

        expect(result.equipmentMap).toEqual({});
        expect(result.unavailableSelections).toEqual([
            { skillHrid: '/skills/woodcutting', loadoutName: 'Missing Loadout' },
        ]);
    });

    test('fails closed instead of partially applying equipment with missing game metadata', () => {
        const result = buildSkillEquipmentResolution({ '/skills/woodcutting': 'Broken Metadata' }, {}, () => ({
            name: 'Broken Metadata',
            equipment: [{ itemHrid: '/items/axe', enhancementLevel: 12 }],
        }));

        expect(result.equipmentMap).toEqual({});
        expect(result.unavailableSelections).toEqual([
            { skillHrid: '/skills/woodcutting', loadoutName: 'Broken Metadata' },
        ]);
    });

    test('fails closed if a supposedly usable snapshot exposes a non-numeric enhancement', () => {
        const result = buildSkillEquipmentResolution(
            { '/skills/woodcutting': 'Broken Loadout' },
            {
                '/items/axe': { equipmentDetail: { type: '/equipment_types/main_hand' } },
            },
            () => ({
                name: 'Broken Loadout',
                equipment: [{ itemHrid: '/items/axe', enhancementLevel: null }],
            })
        );

        expect(result.equipmentMap).toEqual({});
        expect(result.unavailableSelections).toEqual([
            { skillHrid: '/skills/woodcutting', loadoutName: 'Broken Loadout' },
        ]);
    });

    test('maps resolved effective equipment without reinterpreting enhancement levels', () => {
        const getUsableSnapshotByName = vi.fn(() => ({
            name: 'Woodcutting',
            equipment: [{ itemHrid: '/items/axe', enhancementLevel: 17 }],
        }));
        const result = buildSkillEquipmentResolution(
            { '/skills/woodcutting': 'Woodcutting' },
            {
                '/items/axe': {
                    equipmentDetail: { type: '/equipment_types/main_hand' },
                },
            },
            getUsableSnapshotByName
        );

        expect(result.unavailableSelections).toEqual([]);
        expect(result.equipmentMap).toEqual({
            '/skills/woodcutting': {
                '/equipment_types/main_hand': {
                    hrid: '/items/axe',
                    enhancementLevel: 17,
                },
            },
        });
    });
});
