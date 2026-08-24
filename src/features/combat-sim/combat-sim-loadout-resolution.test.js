import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    snapshot: null,
    characterData: { characterAbilities: [] },
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotByName: vi.fn(() => mocks.snapshot),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return mocks.characterData;
        },
        getMooPassBuffs: vi.fn(() => []),
        getCommunityBuffLevel: vi.fn(() => 0),
    },
}));

import loadoutState from '../../core/loadout-state.js';
import { applyLoadoutSnapshotToDTO, mapLoadoutAbilitiesToNativeSlots } from './combat-sim-adapter.js';

const gameData = {
    itemDetailMap: {
        '/items/sword': { equipmentDetail: { type: '/equipment_types/main_hand' } },
    },
    abilityDetailMap: {
        '/abilities/aura': { isSpecialAbility: true },
        '/abilities/normal_a': { isSpecialAbility: false },
        '/abilities/normal_b': { isSpecialAbility: false },
    },
};

function resolvedSnapshot(level) {
    return {
        name: 'Combat',
        equipment: [
            {
                itemLocationHrid: '/item_locations/main_hand',
                itemHrid: '/items/sword',
                enhancementLevel: level,
                isAvailable: true,
            },
        ],
        abilities: [],
        food: [],
        drinks: [],
        abilityCombatTriggersMap: {},
        consumableCombatTriggersMap: {},
    };
}

describe('Combat Sim consumes canonical resolved loadout equipment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.characterData = { characterAbilities: [] };
    });

    test('uses a resolved highest-owned +10 directly instead of re-reading inventory', () => {
        mocks.snapshot = resolvedSnapshot(10);
        const dto = {};

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(true);
        expect(loadoutState.getUsableSnapshotByName).toHaveBeenCalledWith('Combat');
        expect(dto.equipment['/equipment_types/main_hand']).toEqual({
            hrid: '/items/sword',
            enhancementLevel: 10,
        });
    });

    test('preserves an exact resolved +0 and never treats zero as a highest-mode sentinel', () => {
        mocks.snapshot = resolvedSnapshot(0);
        const dto = {};

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(true);
        expect(dto.equipment['/equipment_types/main_hand'].enhancementLevel).toBe(0);
    });

    test('fails closed instead of partially applying equipment with missing game metadata', () => {
        mocks.snapshot = {
            ...resolvedSnapshot(10),
            equipment: [
                ...resolvedSnapshot(10).equipment,
                {
                    itemLocationHrid: '/item_locations/off_hand',
                    itemHrid: '/items/unknown_shield',
                    enhancementLevel: 8,
                    isAvailable: true,
                },
            ],
        };
        const dto = { equipment: { existing: { hrid: '/items/existing', enhancementLevel: 3 } } };

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(false);
        expect(dto.equipment).toEqual({ existing: { hrid: '/items/existing', enhancementLevel: 3 } });
    });

    test('fails closed instead of coercing a broken resolved enhancement to +0', () => {
        mocks.snapshot = resolvedSnapshot(null);
        const dto = { equipment: { existing: { hrid: '/items/existing', enhancementLevel: 3 } } };

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(false);
        expect(dto.equipment).toEqual({ existing: { hrid: '/items/existing', enhancementLevel: 3 } });
    });

    test('preserves native saved ability slot holes (MWI 1..5 -> Combat Sim 0..4)', () => {
        mocks.characterData = {
            characterAbilities: [
                { abilityHrid: '/abilities/aura', level: 9 },
                { abilityHrid: '/abilities/normal_a', level: 12 },
                { abilityHrid: '/abilities/normal_b', level: 15 },
            ],
        };
        mocks.snapshot = {
            ...resolvedSnapshot(10),
            abilities: [
                { abilityHrid: '/abilities/aura', slot: 1 },
                // Native slot 2 intentionally empty.
                { abilityHrid: '/abilities/normal_a', slot: 3 },
                { abilityHrid: '/abilities/normal_b', slot: 5 },
            ],
        };
        const dto = {};

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(true);
        expect(dto.abilities.map((ability) => ability?.hrid || null)).toEqual([
            '/abilities/aura',
            null,
            '/abilities/normal_a',
            null,
            '/abilities/normal_b',
        ]);
    });

    test('invalid legacy special-slot metadata cannot overwrite a valid native slot 1', () => {
        const result = mapLoadoutAbilitiesToNativeSlots(
            [
                { abilityHrid: '/abilities/aura', slot: 1 },
                { abilityHrid: '/abilities/legacy_special', slot: 0 },
            ],
            {
                ...gameData.abilityDetailMap,
                '/abilities/legacy_special': { isSpecialAbility: true },
            },
            (ability) => ability.abilityHrid
        );

        expect(result[0]).toBe('/abilities/aura');
    });

    test('fails closed when Core reports the requested loadout as unusable', () => {
        mocks.snapshot = null;
        const dto = { equipment: { existing: { hrid: '/items/existing', enhancementLevel: 3 } } };

        expect(applyLoadoutSnapshotToDTO(dto, 'Combat', gameData)).toBe(false);
        expect(dto.equipment).toEqual({ existing: { hrid: '/items/existing', enhancementLevel: 3 } });
    });
});
