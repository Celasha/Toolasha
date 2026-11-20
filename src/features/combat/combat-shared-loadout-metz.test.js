import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profiles: [], character: null }));

vi.mock('../combat-sim/combat-sim-adapter.js', () => ({
    mapLoadoutAbilitiesToNativeSlots: vi.fn((abilities, _detail, map) => {
        const slots = [null, null, null, null, null];
        for (const ability of abilities) slots[ability.slot - 1] = map(ability);
        return slots;
    }),
}));
vi.mock('../../core/i18n.js', () => ({ t: vi.fn((key, params) => `${key}:${params?.when ?? ''}`) }));
vi.mock('./combat-sim-export.js', () => ({
    getProfileList: vi.fn(async () => mocks.profiles),
    getCharacterData: vi.fn(() => mocks.character),
    getClientData: vi.fn(() => ({
        itemDetailMap: {
            '/items/ultra_magic_coffee': { categoryHrid: '/item_categories/drink', name: 'Ultra Magic Coffee' },
            '/items/spaceberry_cake': { name: 'Spaceberry Cake' },
            '/items/staff': { name: 'Staff' },
            '/items/enchanted_cloak_refined': { name: 'Cloak' },
        },
        abilityDetailMap: { '/abilities/insanity': { name: 'Insanity' }, '/abilities/water_strike': { name: 'Water' } },
    })),
}));

const { buildSharedMetzLoadout, getSharedLoadoutCharacterId, saveSharedLoadoutForMetz, getStoredSharedLoadouts } =
    await import('./combat-shared-loadout-metz.js');
const {
    getPartyLoadoutId,
    isOwnSharedLoadout,
    withOwnGroupLoadout,
    buildOverrideFromSharedLoadout,
    findSharedLoadoutProfile,
    getSharedMetzLoadouts,
    clearSharedLoadouts,
    describeMetzImport,
} = await import('./combat-shared-loadout-metz.js');

const clientObj = {
    itemDetailMap: {
        '/items/ultra_magic_coffee': { categoryHrid: '/item_categories/drink' },
        '/items/staff': { name: 'Staff' },
    },
};

const trigger = {
    dependencyHrid: '/combat_trigger_dependencies/self',
    conditionHrid: 'c',
    comparatorHrid: 'k',
    value: 1,
};

const loadout = {
    sharableCharacter: { name: 'Tester' },
    actionTypeHrid: '/action_types/combat',
    wearableItemMap: {
        '/item_locations/back': {
            characterID: 28656,
            itemLocationHrid: '/item_locations/back',
            itemHrid: '/items/enchanted_cloak_refined',
            enhancementLevel: 20,
        },
        '/item_locations/two_hand': {
            characterID: 28656,
            itemLocationHrid: '/item_locations/two_hand',
            itemHrid: '/items/staff',
            enhancementLevel: 5,
        },
    },
    equippedAbilities: [
        { characterID: 28656, abilityHrid: '/abilities/water_strike', level: 150, slotNumber: 5 },
        { characterID: 28656, abilityHrid: '/abilities/insanity', level: 200, slotNumber: 1 },
    ],
    combatConsumables: [{ itemHrid: '/items/spaceberry_cake' }, { itemHrid: '/items/ultra_magic_coffee' }],
    abilityCombatTriggersMap: { '/abilities/insanity': [trigger] },
    consumableCombatTriggersMap: { '/items/spaceberry_cake': [trigger] },
    slottedTalismans: [{ slotIndex: 1 }],
};

describe('buildSharedMetzLoadout', () => {
    const entry = buildSharedMetzLoadout(loadout, clientObj, 1000);

    test('keeps worn gear with its enhancement', () => {
        expect(entry.equipment).toEqual(
            expect.arrayContaining([
                {
                    itemLocationHrid: '/item_locations/back',
                    itemHrid: '/items/enchanted_cloak_refined',
                    enhancementLevel: 20,
                },
                { itemLocationHrid: '/item_locations/two_hand', itemHrid: '/items/staff', enhancementLevel: 5 },
            ])
        );
    });

    test('lists abilities in slot order with their levels', () => {
        expect(entry.abilities).toEqual([
            { abilityHrid: '/abilities/insanity', level: 200 },
            { abilityHrid: '/abilities/water_strike', level: 150 },
        ]);
    });

    test('splits consumables into food and drinks and merges both trigger maps', () => {
        expect(entry.food).toEqual([{ itemHrid: '/items/spaceberry_cake' }]);
        expect(entry.drinks).toEqual([{ itemHrid: '/items/ultra_magic_coffee' }]);
        expect(entry.triggerMap['/abilities/insanity']).toEqual([trigger]);
        expect(entry.triggerMap['/items/spaceberry_cake']).toEqual([trigger]);
    });

    test('is named for when it was viewed and its weapon, and carries a content-based id', () => {
        expect(entry.name).toContain('sharedLoadoutsMetz.loadoutName');
        expect(entry.name).toContain('Staff');
        expect(entry.viewedAt).toBe(1000);
        expect(buildSharedMetzLoadout(loadout, clientObj, 2000).id).toBe(entry.id);
        const other = { ...loadout, combatConsumables: [] };
        expect(buildSharedMetzLoadout(other, clientObj).id).not.toBe(entry.id);
    });

    test('does not carry talismans, which Metz has no field for', () => {
        expect(entry).not.toHaveProperty('slottedTalismans');
    });

    test('is nothing for a loadout that is not for combat or holds nothing', () => {
        expect(buildSharedMetzLoadout({ ...loadout, actionTypeHrid: '/action_types/foraging' }, clientObj)).toBeNull();
        expect(buildSharedMetzLoadout({ actionTypeHrid: '/action_types/combat' }, clientObj)).toBeNull();
    });
});

describe('buildOverrideFromSharedLoadout', () => {
    const override = buildOverrideFromSharedLoadout(loadout, clientObj);

    test('keeps worn gear with its location and puts abilities in their native slots', () => {
        expect(override.equipment).toHaveLength(2);
        expect(override.abilities.map((a) => a?.abilityHrid ?? null)).toEqual([
            '/abilities/insanity',
            null,
            null,
            null,
            '/abilities/water_strike',
        ]);
    });

    test('splits consumables and merges both trigger maps', () => {
        expect(override.food).toEqual([{ itemHrid: '/items/spaceberry_cake' }]);
        expect(override.drinks).toEqual([{ itemHrid: '/items/ultra_magic_coffee' }]);
        expect(Object.keys(override.triggerMap).sort()).toEqual(['/abilities/insanity', '/items/spaceberry_cake']);
    });
});

describe('findSharedLoadoutProfile', () => {
    test('finds the cached profile by character id, null without one', async () => {
        mocks.profiles = [{ characterID: 28656, characterName: 'Tester' }];
        expect((await findSharedLoadoutProfile(loadout)).characterName).toBe('Tester');
        mocks.profiles = [];
        expect(await findSharedLoadoutProfile(loadout)).toBeNull();
    });
});

describe('getSharedLoadoutCharacterId', () => {
    test('reads the id off the loadout items', () => {
        expect(getSharedLoadoutCharacterId(loadout)).toBe(28656);
        expect(getSharedLoadoutCharacterId({})).toBeNull();
    });
});

describe('stored shared loadouts', () => {
    let gm;
    beforeEach(() => {
        gm = {};
        globalThis.GM_getValue = vi.fn((key, fallback) => gm[key] ?? fallback);
        globalThis.GM_setValue = vi.fn((key, value) => {
            gm[key] = value;
        });
        mocks.profiles = [{ characterID: 28656, characterName: 'Tester', timestamp: Date.now() }];
        mocks.character = null;
    });

    test('is not saved without a cached profile, which the levels come from', async () => {
        mocks.profiles = [];
        expect(await saveSharedLoadoutForMetz(loadout)).toEqual({ saved: false, reason: 'noProfile' });
        expect(globalThis.GM_setValue).not.toHaveBeenCalled();
    });

    test('is kept under the character and handed to Metz without the viewed time', async () => {
        expect(await saveSharedLoadoutForMetz(loadout)).toEqual({ saved: true, reason: null });
        expect(getStoredSharedLoadouts(28656)[0].viewedAt).toBeGreaterThan(0);
        const [metz] = getSharedMetzLoadouts(28656);
        expect(metz).not.toHaveProperty('viewedAt');
        expect(metz.abilities).toHaveLength(2);
    });

    test('viewing the same loadout again does not add a copy, a different one does', async () => {
        await saveSharedLoadoutForMetz(loadout);
        await saveSharedLoadoutForMetz(loadout);
        expect(getStoredSharedLoadouts(28656)).toHaveLength(1);
        await saveSharedLoadoutForMetz({ ...loadout, combatConsumables: [] });
        const stored = getStoredSharedLoadouts(28656);
        expect(stored).toHaveLength(2);
        expect(stored[0].food).toEqual([]);
    });

    test('keeps only the newest few', async () => {
        for (let level = 1; level <= 7; level++) {
            const wearable = { ...loadout.wearableItemMap['/item_locations/back'], enhancementLevel: level };
            await saveSharedLoadoutForMetz({ ...loadout, wearableItemMap: { '/item_locations/back': wearable } });
        }
        const stored = getStoredSharedLoadouts(28656);
        expect(stored).toHaveLength(5);
        expect(stored[0].equipment[0].enhancementLevel).toBe(7);
    });

    test('can be cleared for one character', async () => {
        await saveSharedLoadoutForMetz(loadout);
        clearSharedLoadouts(28656);
        expect(getStoredSharedLoadouts(28656)).toEqual([]);
    });

    test('says when it cannot be written', async () => {
        delete globalThis.GM_setValue;
        expect(await saveSharedLoadoutForMetz(loadout)).toEqual({ saved: false, reason: 'noStorage' });
    });

    test('is described per party member for the import details', async () => {
        await saveSharedLoadoutForMetz(loadout);
        mocks.character = {
            character: { id: 1, name: 'Me' },
            partyInfo: { partySlotMap: { 1: { characterID: 1 }, 2: { characterID: 28656 }, 3: { characterID: 99 } } },
        };
        const details = await describeMetzImport();
        expect(details.self.name).toBe('Me');
        expect(details.members.map((m) => [m.characterID, m.hasProfile, m.loadouts.length])).toEqual([
            [28656, true, 1],
            [99, false, 0],
        ]);
        expect(details.members[0].loadouts[0].summary).toContain('Staff');
    });
});

describe('group combat loadout', () => {
    let gm;
    const party = (selfSlotId, teammateSlotId) => ({
        character: { id: 28656, name: 'Tester' },
        partyInfo: {
            partySlotMap: {
                1: { characterID: 28656, characterLoadoutID: selfSlotId },
                2: { characterID: 99, characterLoadoutID: teammateSlotId },
            },
        },
    });
    const savedLoadout = (id, enhancementLevel, location = '/item_locations/inventory') => ({
        id,
        name: `Saved ${id}`,
        equipment: [{ itemLocationHrid: location, itemHrid: '/items/enchanted_cloak_refined', enhancementLevel }],
        abilities: [],
        food: [],
        drinks: [],
        triggerMap: {},
    });
    const viewed = (enhancementLevel) => ({
        ...loadout,
        wearableItemMap: {
            '/item_locations/back': { ...loadout.wearableItemMap['/item_locations/back'], enhancementLevel },
        },
        equippedAbilities: [],
        combatConsumables: [],
        abilityCombatTriggersMap: {},
        consumableCombatTriggersMap: {},
    });

    beforeEach(() => {
        gm = {};
        globalThis.GM_getValue = vi.fn((key, fallback) => gm[key] ?? fallback);
        globalThis.GM_setValue = vi.fn((key, value) => {
            gm[key] = value;
        });
        mocks.profiles = [{ characterID: 99, characterName: 'Mate', timestamp: Date.now() }];
        mocks.character = party(500, 600);
    });

    test('reads the loadout id a party slot names', () => {
        expect(getPartyLoadoutId(mocks.character, 28656)).toBe(500);
        expect(getPartyLoadoutId(mocks.character, 99)).toBe(600);
        expect(getPartyLoadoutId({ partyInfo: null }, 99)).toBeNull();
    });

    test('exports the newest viewing as the group loadout and the older ones unmarked', async () => {
        const mate = (level) => ({
            ...viewed(level),
            wearableItemMap: {
                '/item_locations/back': {
                    characterID: 99,
                    itemLocationHrid: '/item_locations/back',
                    itemHrid: '/items/enchanted_cloak_refined',
                    enhancementLevel: level,
                },
            },
        });
        await saveSharedLoadoutForMetz(mate(5));
        await saveSharedLoadoutForMetz(mate(7));

        const [group, older] = getSharedMetzLoadouts(99);
        expect(group).toMatchObject({ id: 'group-combat', groupCombat: true });
        expect(group.equipment[0].enhancementLevel).toBe(7);
        expect(older).not.toHaveProperty('groupCombat');
        expect(older.id).not.toBe('group-combat');
        expect(group).not.toHaveProperty('slotLoadoutId');
        expect(group).not.toHaveProperty('viewedAt');
    });

    test('keeps the loadout id their slot named at the viewing, and says when it has changed since', async () => {
        const mate = {
            ...viewed(5),
            wearableItemMap: {
                b: {
                    characterID: 99,
                    itemLocationHrid: '/item_locations/back',
                    itemHrid: '/items/staff',
                    enhancementLevel: 5,
                },
            },
        };
        await saveSharedLoadoutForMetz(mate);
        expect(getStoredSharedLoadouts(99)[0].slotLoadoutId).toBe(600);

        expect((await describeMetzImport()).members[0].loadouts[0].changed).toBe(false);
        mocks.character = party(500, 601);
        expect((await describeMetzImport()).members[0].loadouts[0]).toMatchObject({ changed: true, isGroup: true });
    });

    test('makes no claim of change when either id is unknown', async () => {
        mocks.character = party(500, null);
        await saveSharedLoadoutForMetz({
            ...viewed(5),
            wearableItemMap: {
                b: { characterID: 99, itemLocationHrid: '/item_locations/back', itemHrid: '/items/staff' },
            },
        });
        mocks.character = party(500, 601);
        expect((await describeMetzImport()).members[0].loadouts[0].changed).toBe(false);
    });

    test('marks your own saved loadout the party slot names', () => {
        const saved = [savedLoadout('400', 1), savedLoadout('500', 2)];
        const result = withOwnGroupLoadout(saved, mocks.character);
        expect(result.map((l) => [l.id, !!l.groupCombat])).toEqual([
            ['400', false],
            ['500', true],
        ]);
    });

    test('falls back to your own viewing matched by content, ignoring where the item sat', async () => {
        mocks.character = party(null, 600);
        await saveSharedLoadoutForMetz(viewed(20));
        const result = withOwnGroupLoadout([savedLoadout('400', 1), savedLoadout('401', 20)], mocks.character);
        expect(result.map((l) => [l.id, !!l.groupCombat])).toEqual([
            ['400', false],
            ['401', true],
        ]);
    });

    test('adds your own viewing when it matches no saved loadout', async () => {
        mocks.character = party(null, 600);
        await saveSharedLoadoutForMetz(viewed(20));
        const result = withOwnGroupLoadout([savedLoadout('400', 1)], mocks.character);
        expect(result).toHaveLength(2);
        expect(result[1]).toMatchObject({ id: 'group-combat', groupCombat: true });
    });

    test('does not use your own viewing once the slot names a different loadout than at the viewing', async () => {
        mocks.character = party(500, 600);
        await saveSharedLoadoutForMetz(viewed(20));
        mocks.character = party(501, 600);
        const result = withOwnGroupLoadout([savedLoadout('400', 1)], mocks.character);
        expect(result).toEqual([expect.not.objectContaining({ groupCombat: true })]);
    });

    test('saves your own viewing without a cached profile', async () => {
        mocks.profiles = [];
        expect(isOwnSharedLoadout(loadout)).toBe(true);
        expect(await saveSharedLoadoutForMetz(loadout)).toEqual({ saved: true, reason: null });
        expect(getStoredSharedLoadouts(28656)).toHaveLength(1);
    });

    test('describes which of your loadouts is the group one', async () => {
        const details = await describeMetzImport();
        expect(details.self.groupLoadoutName).toBeNull();
    });
});
