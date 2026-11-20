import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profiles: [], base: null }));

vi.mock('./combat-sim-export.js', () => ({
    getProfileList: vi.fn(async () => mocks.profiles),
    getClientData: vi.fn(() => ({
        itemDetailMap: { '/items/ultra_magic_coffee': { categoryHrid: '/item_categories/drink' } },
        abilityDetailMap: { '/abilities/insanity': { isSpecialAbility: true } },
    })),
}));
vi.mock('./combat-sim-export-metz.js', () => ({
    constructMetzCharacterExport: vi.fn(async () => mocks.base),
    applyLoadoutOverrideToMetzCharacter: vi.fn((character, override) => ({ ...character, override })),
}));
vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    mapLoadoutAbilitiesToNativeSlots: vi.fn((abilities, _detail, map) => {
        const slots = [null, null, null, null, null];
        for (const ability of abilities) slots[ability.slot - 1] = map(ability);
        return slots;
    }),
}));

const { buildOverrideFromSharedLoadout, constructMetzCharacterFromSharedLoadout, getSharedLoadoutCharacterId } =
    await import('./combat-shared-loadout-metz.js');

const loadout = {
    sharableCharacter: { name: 'Tester' },
    wearableItemMap: {
        '/item_locations/back': {
            characterID: 28656,
            itemLocationHrid: '/item_locations/back',
            itemHrid: '/items/enchanted_cloak_refined',
            enhancementLevel: 20,
        },
    },
    equippedAbilities: [
        { characterID: 28656, abilityHrid: '/abilities/insanity', level: 200, slotNumber: 1 },
        { characterID: 28656, abilityHrid: '/abilities/water_strike', level: 150, slotNumber: 5 },
    ],
    combatConsumables: [{ itemHrid: '/items/spaceberry_cake' }, { itemHrid: '/items/ultra_magic_coffee' }],
    abilityCombatTriggersMap: { '/abilities/insanity': [{ conditionHrid: 'a' }] },
    consumableCombatTriggersMap: { '/items/spaceberry_cake': [{ conditionHrid: 'b' }] },
    slottedTalismans: [{ slotIndex: 1 }],
};

describe('buildOverrideFromSharedLoadout', () => {
    const override = buildOverrideFromSharedLoadout(loadout, {
        itemDetailMap: { '/items/ultra_magic_coffee': { categoryHrid: '/item_categories/drink' } },
        abilityDetailMap: {},
    });

    test('keeps worn gear with its location and enhancement', () => {
        expect(override.equipment).toEqual([
            {
                itemLocationHrid: '/item_locations/back',
                itemHrid: '/items/enchanted_cloak_refined',
                enhancementLevel: 20,
            },
        ]);
    });

    test('puts abilities in their native slots with their levels', () => {
        expect(override.abilities.map((a) => a?.abilityHrid ?? null)).toEqual([
            '/abilities/insanity',
            null,
            null,
            null,
            '/abilities/water_strike',
        ]);
        expect(override.abilities[4].level).toBe(150);
    });

    test('splits consumables into food and drinks and merges both trigger maps', () => {
        expect(override.food).toEqual([{ itemHrid: '/items/spaceberry_cake' }]);
        expect(override.drinks).toEqual([{ itemHrid: '/items/ultra_magic_coffee' }]);
        expect(Object.keys(override.triggerMap).sort()).toEqual(['/abilities/insanity', '/items/spaceberry_cake']);
    });

    test('does not carry talismans, which Metz has no field for', () => {
        expect(override).not.toHaveProperty('slottedTalismans');
    });
});

describe('getSharedLoadoutCharacterId', () => {
    test('reads the id off the loadout items', () => {
        expect(getSharedLoadoutCharacterId(loadout)).toBe(28656);
        expect(getSharedLoadoutCharacterId({})).toBeNull();
    });
});

describe('constructMetzCharacterFromSharedLoadout', () => {
    beforeEach(() => {
        mocks.profiles = [];
        mocks.base = { name: 'Tester' };
    });

    test('lays the loadout over the character built from the cached profile', async () => {
        mocks.profiles = [{ characterID: 28656, characterName: 'Tester' }];
        const { character, reason } = await constructMetzCharacterFromSharedLoadout(loadout);
        expect(reason).toBeNull();
        expect(character.name).toBe('Tester');
        expect(character.override.equipment).toHaveLength(1);
    });

    test('says so when the character has no cached profile', async () => {
        const result = await constructMetzCharacterFromSharedLoadout(loadout);
        expect(result).toEqual({ character: null, reason: 'noProfile' });
    });
});
