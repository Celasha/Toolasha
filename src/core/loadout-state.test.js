import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    wsHandlers: new Map(),
    dataHandlers: new Map(),
    currentCharacterId: null,
    characterData: null,
    inventory: [],
    storageGet: vi.fn(),
    storageSet: vi.fn(),
}));

vi.mock('./websocket.js', () => ({
    default: {
        on: vi.fn((event, handler) => mocks.wsHandlers.set(event, handler)),
        off: vi.fn((event, handler) => {
            if (mocks.wsHandlers.get(event) === handler) mocks.wsHandlers.delete(event);
        }),
    },
}));

vi.mock('./data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => mocks.dataHandlers.set(event, handler)),
        off: vi.fn((event, handler) => {
            if (mocks.dataHandlers.get(event) === handler) mocks.dataHandlers.delete(event);
        }),
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getInventory: vi.fn(() => mocks.inventory),
        get characterData() {
            return mocks.characterData;
        },
    },
}));

vi.mock('./storage.js', () => ({
    default: {
        getJSON: (...args) => mocks.storageGet(...args),
        setJSON: (...args) => mocks.storageSet(...args),
    },
}));

import webSocketHook from './websocket.js';
import dataManager from './data-manager.js';
import {
    LoadoutState,
    buildOwnedEnhancementIndex,
    buildRawLoadoutSnapshot,
    resolveLoadoutConsumables,
    resolveLoadoutEquipment,
} from './loadout-state.js';

const MAIN_HAND = '/item_locations/main_hand';
const OFF_HAND = '/item_locations/off_hand';
const INVENTORY = '/item_locations/inventory';
const SWORD = '/items/sword';

function serverLoadout({
    name = 'Test Loadout',
    savedLevel = 5,
    useExactEnhancement = false,
    suppressValidation = false,
    actionTypeHrid = '/action_types/crafting',
    drinks = [],
    wearableMap = null,
    abilityCombatTriggersMap = {},
    consumableCombatTriggersMap = {},
} = {}) {
    return {
        name,
        actionTypeHrid,
        isDefault: true,
        useExactEnhancement,
        suppressValidation,
        ordinal: 1,
        wearableMap: wearableMap ?? {
            [MAIN_HAND]: `123::${MAIN_HAND}::${SWORD}::${savedLevel}`,
        },
        drinkItemHrids: drinks,
        foodItemHrids: [],
        abilityMap: {},
        abilityCombatTriggersMap,
        consumableCombatTriggersMap,
    };
}

function initPayload(characterId, loadoutMap, includeMap = true) {
    const payload = { character: { id: characterId, name: characterId } };
    if (includeMap) payload.characterLoadoutMap = loadoutMap;
    return payload;
}

function setActiveCharacter(characterId, characterData = null) {
    mocks.currentCharacterId = characterId;
    mocks.characterData = characterData;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    mocks.wsHandlers.clear();
    mocks.dataHandlers.clear();
    mocks.currentCharacterId = null;
    mocks.characterData = null;
    mocks.inventory = [];
    mocks.storageGet.mockReset().mockResolvedValue(null);
    mocks.storageSet.mockReset().mockResolvedValue(true);
    vi.clearAllMocks();
});

describe('Core LoadoutState ownership and lifecycle', () => {
    test('constructor is side-effect free and startCapture/stopCapture own subscriptions exactly once', () => {
        const state = new LoadoutState();

        expect(webSocketHook.on).not.toHaveBeenCalled();
        expect(dataManager.on).not.toHaveBeenCalled();

        state.startCapture();
        state.startCapture();

        expect(webSocketHook.on).toHaveBeenCalledTimes(2);
        expect(webSocketHook.on).toHaveBeenCalledWith('init_character_data', expect.any(Function));
        expect(webSocketHook.on).toHaveBeenCalledWith('loadouts_updated', expect.any(Function));
        expect(dataManager.on).toHaveBeenCalledTimes(2);
        expect(dataManager.on).toHaveBeenCalledWith('character_switching', expect.any(Function));
        expect(dataManager.on).toHaveBeenCalledWith('items_updated', expect.any(Function));

        state.stopCapture();
        state.stopCapture();

        expect(webSocketHook.off).toHaveBeenCalledTimes(2);
        expect(dataManager.off).toHaveBeenCalledTimes(2);
    });

    test('fresh init_character_data server state is authoritative and an empty map stays empty', async () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');

        mocks.wsHandlers.get('init_character_data')(initPayload('A', {}));
        await state.hydratePersistence();

        expect(state.getAllSnapshots()).toEqual([]);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: 'A', authority: 'server', snapshotCount: 0 });
        expect(mocks.storageGet).not.toHaveBeenCalled();
        expect(mocks.storageSet).toHaveBeenCalledWith('loadout_snapshots_A', {}, 'settings');
    });

    test('server state wins even when an older cache read is already in flight', async () => {
        const read = deferred();
        mocks.storageGet.mockReturnValueOnce(read.promise);

        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', null, false));

        const hydration = state.hydratePersistence();

        const liveMap = { live: serverLoadout({ name: 'Fresh Server', savedLevel: 5 }) };
        mocks.wsHandlers.get('init_character_data')(initPayload('A', liveMap));
        read.resolve({
            stale: buildRawLoadoutSnapshot('stale', serverLoadout({ name: 'Stale Cache', savedLevel: 1 })),
        });
        await hydration;

        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['Fresh Server']);
        expect(state.getStateInfo().authority).toBe('server');
    });

    test('raw snapshots preserve validation mode while effective enhancement remains independently resolved', () => {
        const raw = buildRawLoadoutSnapshot(
            'suppressed',
            serverLoadout({ savedLevel: 5, useExactEnhancement: false, suppressValidation: true })
        );

        expect(raw).toMatchObject({
            suppressValidation: true,
            useExactEnhancement: false,
        });
        expect(
            resolveLoadoutEquipment(raw, [
                { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ])[0]
        ).toMatchObject({
            enhancementLevel: 10,
            isAvailable: true,
        });
    });

    test('legacy plain cache is a fallback only when the server map is absent', async () => {
        const cached = buildRawLoadoutSnapshot('old', serverLoadout({ name: 'Legacy', savedLevel: 5 }));
        mocks.storageGet.mockResolvedValueOnce({ old: cached });
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];

        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', null, false));
        await state.hydratePersistence();

        const snapshot = state.getSnapshotById('old');
        expect(state.getStateInfo().authority).toBe('cache');
        expect(snapshot.savedEnhancementLevel).toBeUndefined();
        expect(snapshot.equipment[0]).toMatchObject({
            enhancementLevel: 10,
            isAvailable: true,
        });
        expect(snapshot).toMatchObject({ hasUnavailableEquipment: false, unavailableEquipment: [] });
    });

    test('legacy cache is sanitized back to canonical raw schema before it can become truth state', async () => {
        mocks.storageGet.mockResolvedValueOnce({
            legacy: {
                snapshotId: 'stale-other-id',
                name: 'Legacy',
                actionTypeHrid: '/action_types/crafting',
                isDefault: true,
                useExactEnhancement: 'false', // malformed legacy truthy string must sanitize to Highest mode
                suppressValidation: true,
                ordinal: 3,
                savedAt: 12345,
                equipment: [
                    {
                        itemLocationHrid: MAIN_HAND,
                        itemHrid: SWORD,
                        enhancementLevel: 5,
                        isAvailable: false,
                        savedEnhancementLevel: 99,
                        enhancementResolution: 'legacy-effective-leak',
                    },
                ],
                abilities: [{ abilityHrid: '/abilities/test', slot: '2', transient: true }],
                food: ['/items/apple'],
                drinks: [{ itemHrid: '/items/tea', transient: true }],
                abilityCombatTriggersMap: { '/abilities/test': [{ typeHrid: '/trigger_types/test', value: 1 }] },
                consumableCombatTriggersMap: {},
                hasUnavailableEquipment: true,
                unavailableEquipment: [{ itemHrid: SWORD }],
                arbitraryLegacyField: 'must-not-survive',
            },
        });
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/apple', enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];

        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', null, false));
        await state.hydratePersistence();

        const snapshot = state.getSnapshotById('legacy');
        expect(snapshot).toMatchObject({
            snapshotId: 'legacy',
            name: 'Legacy',
            actionTypeHrid: '/action_types/crafting',
            ordinal: 3,
            capturedAt: 12345,
            equipment: [
                {
                    itemLocationHrid: MAIN_HAND,
                    itemHrid: SWORD,
                    enhancementLevel: 10,
                    isAvailable: true,
                },
            ],
            abilities: [{ abilityHrid: '/abilities/test', slot: 2 }],
            food: [{ itemHrid: '/items/apple' }],
            drinks: [{ itemHrid: '/items/tea' }],
            hasUnavailableEquipment: false,
        });
        expect(snapshot.arbitraryLegacyField).toBeUndefined();
        expect(snapshot.savedEnhancementLevel).toBeUndefined();
        expect(snapshot.enhancementResolution).toBeUndefined();
        expect(snapshot.suppressValidation).toBeUndefined();
        expect(snapshot.useExactEnhancement).toBeUndefined();
    });

    test('character switching clears the departing character synchronously', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { a: serverLoadout({ name: 'A Loadout', savedLevel: 5 }) })
        );
        expect(state.getAllSnapshots()).toHaveLength(1);
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.dataHandlers.get('character_switching')({ oldId: 'A', newId: 'B' });

        // Clearing must be synchronous for correctness, but it is a transient lifecycle
        // boundary, not a user-visible "all loadouts deleted" update.
        expect(listener).not.toHaveBeenCalled();
        expect(state.getAllSnapshots()).toEqual([]);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: null, authority: 'none', snapshotCount: 0 });
    });

    test('an init_character_data payload rejected by DataManager cannot switch loadout ownership', () => {
        const state = new LoadoutState();
        state.startCapture();

        setActiveCharacter('B');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('B', { b: serverLoadout({ name: 'B Loadout', savedLevel: 5 }) })
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Loadout']);

        // Model DataManager's rapid-switch loop protection: the C WebSocket payload is
        // delivered to later handlers, but DataManager deliberately remained on B.
        mocks.currentCharacterId = 'B';
        mocks.characterData = initPayload('B', {});
        mocks.wsHandlers.get('init_character_data')(
            initPayload('C', { c: serverLoadout({ name: 'C Loadout', savedLevel: 10 }) })
        );

        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Loadout']);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: 'B', authority: 'server' });
    });

    test('A -> B -> rejected rapid A -> accepted A never exposes mixed character ownership', () => {
        const state = new LoadoutState();
        state.startCapture();

        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { a1: serverLoadout({ name: 'A First', savedLevel: 5 }) })
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['A First']);

        mocks.dataHandlers.get('character_switching')({ oldId: 'A', newId: 'B' });
        expect(state.getAllSnapshots()).toEqual([]);
        setActiveCharacter('B');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('B', { b: serverLoadout({ name: 'B Loadout', savedLevel: 7 }) })
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Loadout']);

        // Model a rapid switch payload that DataManager rejected. Loadout State sees the
        // same WebSocket message later, but authoritative character ownership is still B.
        mocks.currentCharacterId = 'B';
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { staleA: serverLoadout({ name: 'Rejected A', savedLevel: 20 }) })
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Loadout']);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: 'B', authority: 'server' });

        mocks.dataHandlers.get('character_switching')({ oldId: 'B', newId: 'A' });
        expect(state.getAllSnapshots()).toEqual([]);
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { a2: serverLoadout({ name: 'A Fresh', savedLevel: 9 }) })
        );

        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['A Fresh']);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: 'A', authority: 'server' });
    });

    test('late cache hydration for character A cannot overwrite character B', async () => {
        const read = deferred();
        mocks.storageGet.mockReturnValueOnce(read.promise);

        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', null, false));
        const hydration = state.hydratePersistence();

        mocks.dataHandlers.get('character_switching')({ oldId: 'A', newId: 'B' });
        setActiveCharacter('B');
        mocks.wsHandlers.get('init_character_data')(initPayload('B', {}));

        read.resolve({ a: buildRawLoadoutSnapshot('a', serverLoadout({ name: 'A Loadout' })) });
        await hydration;

        expect(state.getAllSnapshots()).toEqual([]);
        expect(state.getStateInfo()).toMatchObject({ activeCharacterId: 'B', authority: 'server' });
    });

    test('loadouts_updated fully replaces state, including an empty map, and ignores another character', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', { one: serverLoadout({ name: 'One' }) }));

        mocks.wsHandlers.get('loadouts_updated')({
            characterID: 'B',
            characterLoadoutMap: { other: serverLoadout({ name: 'Other' }) },
        });
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['One']);

        mocks.wsHandlers.get('loadouts_updated')({ characterID: 'A', characterLoadoutMap: {} });
        expect(state.getAllSnapshots()).toEqual([]);
    });

    test('delayed loadouts_updated from an old socket cannot overwrite the active character without a payload character id', () => {
        const state = new LoadoutState();
        state.startCapture();
        const socketA = {};
        const socketB = {};

        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { a: serverLoadout({ name: 'A Loadout', savedLevel: 5 }) }),
            { socket: socketA }
        );

        mocks.dataHandlers.get('character_switching')({ oldId: 'A', newId: 'B' });
        setActiveCharacter('B');
        mocks.wsHandlers.get('init_character_data')(
            initPayload('B', { b: serverLoadout({ name: 'B Loadout', savedLevel: 7 }) }),
            { socket: socketB }
        );

        // Native MWI's loadouts_updated path only requires characterLoadoutMap, so do not
        // assume the payload carries a character id. The old A socket must still be rejected.
        mocks.wsHandlers.get('loadouts_updated')(
            { characterLoadoutMap: { staleA: serverLoadout({ name: 'Delayed A', savedLevel: 20 }) } },
            { socket: socketA }
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Loadout']);

        mocks.wsHandlers.get('loadouts_updated')(
            { characterLoadoutMap: { freshB: serverLoadout({ name: 'B Updated', savedLevel: 9 }) } },
            { socket: socketB }
        );
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['B Updated']);
    });

    test('storage failures never erase or block authoritative server state', async () => {
        mocks.storageSet.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.wsHandlers.get('init_character_data')(initPayload('A', { live: serverLoadout({ name: 'Live' }) }));

        await expect(state.hydratePersistence()).resolves.toBeUndefined();
        expect(state.getAllSnapshots().map((snapshot) => snapshot.name)).toEqual(['Live']);
        expect(state.getStateInfo().authority).toBe('server');
    });

    test('trigger maps are canonicalized and cannot leak mutable nested raw state to consumers', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [{ itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND }];
        const sourceTrigger = {
            dependencyHrid: '/combat_trigger_dependencies/self_hp',
            conditionHrid: '/combat_trigger_conditions/less_than',
            nestedFutureField: { values: [1, { flag: true }] },
        };
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', {
                one: serverLoadout({
                    name: 'One',
                    abilityCombatTriggersMap: {
                        '/abilities/test': [sourceTrigger],
                        '/abilities/malformed': { not: 'an array' },
                    },
                }),
            })
        );

        sourceTrigger.nestedFutureField.values[1].flag = false;
        const first = state.getSnapshotById('one');
        expect(first.abilityCombatTriggersMap['/abilities/malformed']).toBeUndefined();
        expect(first.abilityCombatTriggersMap['/abilities/test'][0].nestedFutureField.values[1].flag).toBe(true);

        first.abilityCombatTriggersMap['/abilities/test'][0].nestedFutureField.values[1].flag = false;
        const second = state.getSnapshotById('one');
        expect(second.abilityCombatTriggersMap['/abilities/test'][0].nestedFutureField.values[1].flag).toBe(true);
    });

    test('relevant inventory changes notify consumers without mutating raw server snapshots', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 2 }) })
        );
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(state.getSnapshotById('one').equipment[0]).toMatchObject({
            enhancementLevel: 10,
            isAvailable: true,
        });

        mocks.dataHandlers.get('items_updated')({ endCharacterItems: [{ itemHrid: '/items/log', count: 5 }] });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('init, item updates, and saved level displays scan a large inventory only once each', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        const apple = '/items/apple';
        const tea = '/items/tea';
        const snapshotCount = 40;
        const swordHash = `123::${INVENTORY}::${SWORD}::0`;
        const loadoutMap = Object.fromEntries(
            Array.from({ length: snapshotCount }, (_, i) => [
                `loadout-${i}`,
                {
                    ...serverLoadout({
                        name: 'Same Name',
                        useExactEnhancement: i % 2 === 0,
                        drinks: ['', tea],
                        wearableMap: { [MAIN_HAND]: swordHash, [OFF_HAND]: swordHash },
                    }),
                    foodItemHrids: [apple, ''],
                },
            ])
        );
        let unrelatedReads = 0;
        const unrelatedItems = Array.from({ length: 1000 }, (_, i) => ({
            get itemHrid() {
                unrelatedReads += 1;
                return `/items/unrelated_${i}`;
            },
            itemLocationHrid: INVENTORY,
            count: 1,
        }));
        const inInventory = (itemHrid, enhancementLevel, count = 1) => ({
            itemHrid,
            enhancementLevel,
            count,
            itemLocationHrid: INVENTORY,
        });
        const baseSword = inInventory(SWORD, 0);
        mocks.inventory = [
            ...unrelatedItems,
            baseSword,
            inInventory(SWORD, 8),
            inInventory(apple, 0),
            inInventory(tea, 1),
        ];

        const expectSnapshots = (highest, foodAvailable, drinkAvailable) => {
            const snapshots = state.getAllSnapshots();
            expect(snapshots).toHaveLength(snapshotCount);
            for (const [i, snapshot] of snapshots.entries()) {
                expect(snapshot).toMatchObject({
                    snapshotId: `loadout-${i}`,
                    equipment: [MAIN_HAND, OFF_HAND].map((itemLocationHrid) => ({
                        itemHrid: SWORD,
                        itemLocationHrid,
                        enhancementLevel: i % 2 === 0 ? 0 : highest,
                        isAvailable: true,
                    })),
                    food: [{ itemHrid: foodAvailable ? apple : '' }, { itemHrid: '' }],
                    drinks: [{ itemHrid: '' }, { itemHrid: drinkAvailable ? tea : '' }],
                    unavailableFood: foodAvailable ? [] : [{ slotIndex: 0, itemHrid: apple }],
                    unavailableDrinks: drinkAvailable ? [] : [{ slotIndex: 1, itemHrid: tea }],
                    isUsableForCalculation: true,
                });
            }
        };

        mocks.wsHandlers.get('init_character_data')(initPayload('A', loadoutMap));
        expectSnapshots(8, true, false);
        // Count reads of unrelated entries instead of relying on wall-clock timings.
        expect(unrelatedReads).toBe(unrelatedItems.length);
        const rawSnapshots = structuredClone(state.rawSnapshots);
        const listener = vi.fn();
        state.onUpdate(listener);

        unrelatedReads = 0;
        mocks.dataHandlers.get('items_updated')({ endCharacterItems: [{ itemHrid: '/items/unrelated_0' }] });
        expect(listener).not.toHaveBeenCalled();
        expect(unrelatedReads).toBe(0);

        const endCharacterItems = [inInventory(SWORD, 12), inInventory(apple, 0, 0), inInventory(tea, 0)];
        mocks.inventory = [...unrelatedItems, baseSword, ...endCharacterItems];
        mocks.dataHandlers.get('items_updated')({ endCharacterItems });
        expect(listener).toHaveBeenCalledTimes(1);
        expectSnapshots(12, false, true);
        expect(unrelatedReads).toBe(unrelatedItems.length);
        expect(state.rawSnapshots).toEqual(rawSnapshots);

        unrelatedReads = 0;
        const displays = state.getSavedLevelDisplays('Same Name');
        expect(displays).toHaveLength(snapshotCount);
        for (const [i, display] of displays.entries()) {
            expect(display.equipment).toEqual(
                [MAIN_HAND, OFF_HAND].map((itemLocationHrid) => ({
                    itemHrid: SWORD,
                    itemLocationHrid,
                    savedLevel: 0,
                    highestOwnedLevel: 12,
                    status: i % 2 === 0 ? 'higherIgnored' : 'higherEquipped',
                }))
            );
        }
        expect(unrelatedReads).toBe(unrelatedItems.length);
    });

    test('the cached effective resolution follows Highest downward, not only upward', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 2 }) })
        );
        expect(state.getSnapshotById('one').equipment[0].enhancementLevel).toBe(10);
        const listener = vi.fn();
        state.onUpdate(listener);

        // The +10 was the character's only sword and is now enhanced down to +5. A cached
        // resolution that only ever moved upward would incorrectly keep serving +10.
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(state.getSnapshotById('one').equipment[0]).toMatchObject({
            enhancementLevel: 5,
            isAvailable: true,
        });
    });

    test('referenced item count churn does not notify when effective loadout resolution is unchanged', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: SWORD, enhancementLevel: 5, count: 2, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 100, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 2, drinks: ['/items/tea'] }) })
        );
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 99, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
                {
                    itemHrid: '/items/tea',
                    enhancementLevel: 0,
                    count: 99,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ],
        });

        expect(listener).not.toHaveBeenCalled();
        expect(state.getSnapshotById('one')).toMatchObject({
            equipment: [expect.objectContaining({ enhancementLevel: 10 })],
            hasUnavailableConsumables: false,
            isUsableForCalculation: true,
        });

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 99, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 5, count: 0, itemLocationHrid: '/item_locations/inventory' },
            ],
        });

        expect(listener).not.toHaveBeenCalled();
        expect(state.getSnapshotById('one').equipment[0].enhancementLevel).toBe(10);
    });

    test('exact-mode availability changes notify even when the saved numeric enhancement itself is unchanged', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [{ itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND }];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', {
                one: serverLoadout({ name: 'Exact Five', savedLevel: 5, useExactEnhancement: true }),
            })
        );
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.inventory = [];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [{ itemHrid: SWORD, enhancementLevel: 5, count: 0, itemLocationHrid: MAIN_HAND }],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(state.getSnapshotById('one')).toMatchObject({
            equipment: [],
            unavailableEquipment: [{ itemLocationHrid: MAIN_HAND, itemHrid: SWORD }],
            isUsableForCalculation: false,
        });
    });

    test('inventory changes for saved consumables notify because effective availability can change', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', drinks: ['/items/tea'] }) })
        );
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.inventory = [{ itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND }];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                {
                    itemHrid: '/items/tea',
                    enhancementLevel: 0,
                    count: 0,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(state.getSnapshotById('one')).toMatchObject({
            hasUnavailableConsumables: true,
            unavailableDrinks: [{ slotIndex: 0, itemHrid: '/items/tea' }],
            isUsableForCalculation: true,
        });
    });

    test('restocking a saved consumable after stockout notifies and clears the unavailable state', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 0, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', drinks: ['/items/tea'] }) })
        );
        expect(state.getSnapshotById('one').hasUnavailableConsumables).toBe(true);
        const listener = vi.fn();
        state.onUpdate(listener);

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 5, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                {
                    itemHrid: '/items/tea',
                    enhancementLevel: 0,
                    count: 5,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(state.getSnapshotById('one')).toMatchObject({
            drinks: [{ itemHrid: '/items/tea' }],
            hasUnavailableConsumables: false,
            isUsableForCalculation: true,
        });

        // A later restock to a different positive count is the same effective state and must
        // not re-notify.
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 8, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                {
                    itemHrid: '/items/tea',
                    enhancementLevel: 0,
                    count: 8,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ],
        });
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('effective enhancement resolution contract', () => {
    const CURRENT_MWI_ENHANCEMENT_LEVELS = Array.from({ length: 21 }, (_, level) => level);

    test.each(CURRENT_MWI_ENHANCEMENT_LEVELS)(
        'highest mode ignores every saved level (+%i) and resolves from current ownership',
        (savedLevel) => {
            const raw = buildRawLoadoutSnapshot(
                `highest-${savedLevel}`,
                serverLoadout({ savedLevel, useExactEnhancement: false })
            );

            const representativeOwnedSets = [
                [{ itemHrid: SWORD, enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' }],
                [{ itemHrid: SWORD, enhancementLevel: 20, count: 1, itemLocationHrid: '/item_locations/inventory' }],
                [
                    { itemHrid: SWORD, enhancementLevel: 2, count: 1, itemLocationHrid: '/item_locations/inventory' },
                    { itemHrid: SWORD, enhancementLevel: 11, count: 1, itemLocationHrid: '/item_locations/inventory' },
                    { itemHrid: SWORD, enhancementLevel: 7, count: 1, itemLocationHrid: '/item_locations/inventory' },
                ],
                [
                    { itemHrid: SWORD, enhancementLevel: 6, itemLocationHrid: MAIN_HAND }, // equipped/no-count is owned
                    { itemHrid: SWORD, enhancementLevel: 19, count: 0, itemLocationHrid: '/item_locations/inventory' }, // explicit zero count is absent
                    { itemHrid: SWORD, enhancementLevel: 4, count: 2, itemLocationHrid: '/item_locations/inventory' },
                ],
                [
                    { itemHrid: SWORD, enhancementLevel: 13, count: 1, itemLocationHrid: '/item_locations/inventory' },
                    { itemHrid: SWORD, enhancementLevel: 13, count: 3, itemLocationHrid: '/item_locations/inventory' }, // duplicate level is harmless
                    { itemHrid: '/items/other', enhancementLevel: 20, count: 1 },
                ],
            ];
            const expectedHighest = [0, 20, 11, 6, 13];

            representativeOwnedSets.forEach((owned, index) => {
                const [resolved] = resolveLoadoutEquipment(raw, owned);
                expect(resolved).toMatchObject({
                    enhancementLevel: expectedHighest[index],
                    isAvailable: true,
                });
            });
        }
    );

    test.each(CURRENT_MWI_ENHANCEMENT_LEVELS)(
        'exact mode preserves every saved level (+%i) and reports exact-variant availability separately',
        (savedLevel) => {
            const raw = buildRawLoadoutSnapshot(
                `exact-${savedLevel}`,
                serverLoadout({ savedLevel, useExactEnhancement: true })
            );

            const exactOwned = [
                {
                    itemHrid: SWORD,
                    enhancementLevel: savedLevel,
                    count: 1,
                    itemLocationHrid: '/item_locations/inventory',
                },
                {
                    itemHrid: SWORD,
                    enhancementLevel: savedLevel === 20 ? 0 : 20,
                    count: 1,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ];
            const [available] = resolveLoadoutEquipment(raw, exactOwned);
            expect(available).toMatchObject({
                enhancementLevel: savedLevel,
                isAvailable: true,
            });

            const otherLevel = savedLevel === 20 ? 19 : savedLevel + 1;
            const [missingExact] = resolveLoadoutEquipment(raw, [
                {
                    itemHrid: SWORD,
                    enhancementLevel: otherLevel,
                    count: 1,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ]);
            expect(missingExact).toMatchObject({
                enhancementLevel: null,
                isAvailable: false,
            });
        }
    );

    test('resolution is not hard-coded to the current 0..20 examples', () => {
        const highest = buildRawLoadoutSnapshot(
            'future-highest',
            serverLoadout({ savedLevel: 20, useExactEnhancement: false })
        );
        const exact = buildRawLoadoutSnapshot(
            'future-exact',
            serverLoadout({ savedLevel: 27, useExactEnhancement: true })
        );

        expect(
            resolveLoadoutEquipment(highest, [
                { itemHrid: SWORD, enhancementLevel: 27, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ])[0].enhancementLevel
        ).toBe(27);
        expect(
            resolveLoadoutEquipment(exact, [
                { itemHrid: SWORD, enhancementLevel: 27, count: 1, itemLocationHrid: '/item_locations/inventory' },
                { itemHrid: SWORD, enhancementLevel: 31, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ])[0]
        ).toMatchObject({ enhancementLevel: 27, isAvailable: true });

        expect(
            resolveLoadoutEquipment(exact, [
                { itemHrid: SWORD, enhancementLevel: 31, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ])[0]
        ).toMatchObject({ enhancementLevel: null, isAvailable: false });
    });

    test('malformed saved enhancement cannot become an exact +0 calculation', () => {
        const raw = buildRawLoadoutSnapshot(
            'malformed-exact',
            serverLoadout({
                useExactEnhancement: true,
                wearableMap: {
                    [MAIN_HAND]: `123::${MAIN_HAND}::${SWORD}::not-a-level`,
                },
            })
        );

        expect(raw.equipment[0].enhancementLevel).toBeNull();
        expect(
            resolveLoadoutEquipment(raw, [
                {
                    itemHrid: SWORD,
                    enhancementLevel: 0,
                    count: 1,
                    itemLocationHrid: '/item_locations/inventory',
                },
            ])[0]
        ).toMatchObject({ enhancementLevel: null, isAvailable: false });
    });

    test.each(['5garbage', -1, 1.5])(
        'non-canonical saved enhancement %p fails closed instead of coercing to an exact level',
        (badLevel) => {
            const raw = buildRawLoadoutSnapshot('bad-level', {
                ...serverLoadout({ savedLevel: 0, useExactEnhancement: true }),
                wearableMap: { [MAIN_HAND]: `123::${MAIN_HAND}::${SWORD}::${badLevel}` },
            });
            const result = resolveLoadoutEquipment(raw, [
                {
                    itemHrid: SWORD,
                    enhancementLevel: Number.parseInt(String(badLevel), 10) || 0,
                    count: 1,
                    itemLocationHrid: MAIN_HAND,
                },
            ]);

            expect(raw.equipment[0].enhancementLevel).toBeNull();
            expect(result[0]).toMatchObject({ enhancementLevel: null, isAvailable: false });
        }
    );

    test('highest mode always ignores the stale saved level and uses highest currently owned', () => {
        const raw = buildRawLoadoutSnapshot('x', serverLoadout({ savedLevel: 5, useExactEnhancement: false }));
        const result = resolveLoadoutEquipment(raw, [
            { itemHrid: SWORD, enhancementLevel: 3, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);

        expect(result[0]).toMatchObject({
            enhancementLevel: 10,
            isAvailable: true,
        });
    });

    test('highest mode may resolve below the historical saved level after ownership changes', () => {
        const raw = buildRawLoadoutSnapshot('x', serverLoadout({ savedLevel: 10, useExactEnhancement: false }));
        const result = resolveLoadoutEquipment(raw, [
            { itemHrid: SWORD, enhancementLevel: 7, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);
        expect(result[0].enhancementLevel).toBe(7);
    });

    test('exact +5 remains +5 even when +10 is owned', () => {
        const raw = buildRawLoadoutSnapshot('x', serverLoadout({ savedLevel: 5, useExactEnhancement: true }));
        const result = resolveLoadoutEquipment(raw, [
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);
        expect(result[0]).toMatchObject({ enhancementLevel: 5, isAvailable: true });
    });

    test('exact +0 is a real exact level and is never promoted to highest owned', () => {
        const raw = buildRawLoadoutSnapshot('x', serverLoadout({ savedLevel: 0, useExactEnhancement: true }));
        const result = resolveLoadoutEquipment(raw, [
            { itemHrid: SWORD, enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);
        expect(result[0]).toMatchObject({ enhancementLevel: 0, isAvailable: true });
    });

    test('equipped items with no count are owned and can be the highest level', () => {
        const index = buildOwnedEnhancementIndex([
            { itemHrid: SWORD, enhancementLevel: 10, itemLocationHrid: MAIN_HAND },
            { itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);
        expect(index.get(SWORD)?.highestEnhancementLevel).toBe(10);
    });

    test('saved equipment resolves only from its target location or inventory, matching native MWI validation', () => {
        const raw = buildRawLoadoutSnapshot('slot-aware', serverLoadout({ savedLevel: 5, useExactEnhancement: false }));
        const result = resolveLoadoutEquipment(raw, [
            // Higher copy exists, but in a different equipped location. Native loadout
            // validation does not allow it to satisfy the saved main-hand slot.
            {
                itemHrid: SWORD,
                enhancementLevel: 15,
                itemLocationHrid: '/item_locations/off_hand',
            },
            {
                itemHrid: SWORD,
                enhancementLevel: 10,
                itemLocationHrid: '/item_locations/inventory',
                count: 1,
            },
            {
                itemHrid: SWORD,
                enhancementLevel: 7,
                itemLocationHrid: MAIN_HAND,
            },
        ]);

        expect(result[0]).toMatchObject({ enhancementLevel: 10, isAvailable: true });
    });

    test.each([
        [false, [7, 15, 7, null]],
        [true, [7, 0, null, null]],
    ])('duplicate equipment HRIDs preserve slot and saved hash eligibility in exact mode %s', (exact, levels) => {
        const head = '/item_locations/head';
        const body = '/item_locations/body';
        const missing = '/items/missing';
        const savedOtherSlotHash = `123::${head}::${SWORD}::7`;
        const zeroCountHash = `123::${OFF_HAND}::${SWORD}::20`;
        const raw = buildRawLoadoutSnapshot(
            'duplicate-slots',
            serverLoadout({
                useExactEnhancement: exact,
                wearableMap: {
                    [MAIN_HAND]: savedOtherSlotHash,
                    [OFF_HAND]: `123::${OFF_HAND}::${SWORD}::0`,
                    [head]: zeroCountHash,
                    [body]: `123::${body}::${missing}::4`,
                },
            })
        );
        const inventory = [
            { itemHrid: SWORD, itemLocationHrid: head, enhancementLevel: 7, hash: savedOtherSlotHash },
            { itemHrid: SWORD, itemLocationHrid: MAIN_HAND, enhancementLevel: 5 },
            { itemHrid: SWORD, itemLocationHrid: OFF_HAND, enhancementLevel: 15 },
            { itemHrid: SWORD, itemLocationHrid: INVENTORY, enhancementLevel: 0, count: 1 },
            { itemHrid: SWORD, itemLocationHrid: OFF_HAND, enhancementLevel: 20, count: 0, hash: zeroCountHash },
        ];

        expect(resolveLoadoutEquipment(raw, inventory)).toEqual(
            [MAIN_HAND, OFF_HAND, head, body].map((itemLocationHrid, i) => ({
                itemLocationHrid,
                itemHrid: i === 3 ? missing : SWORD,
                enhancementLevel: levels[i],
                isAvailable: levels[i] !== null,
            }))
        );
    });

    test('an exact variant equipped only in a different location remains unavailable for the saved slot', () => {
        const raw = buildRawLoadoutSnapshot(
            'slot-aware-exact',
            serverLoadout({ savedLevel: 5, useExactEnhancement: true })
        );
        const result = resolveLoadoutEquipment(raw, [
            {
                itemHrid: SWORD,
                enhancementLevel: 5,
                itemLocationHrid: '/item_locations/off_hand',
            },
        ]);

        expect(result[0]).toMatchObject({ enhancementLevel: null, isAvailable: false });
    });

    test('owned +0 remains a real map entry and is distinct from a missing item', () => {
        const index = buildOwnedEnhancementIndex([
            { itemHrid: SWORD, enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ]);
        expect(index.has(SWORD)).toBe(true);
        expect(index.get(SWORD)?.highestEnhancementLevel).toBe(0);
        expect(index.has('/items/missing')).toBe(false);
    });

    test('saved consumables use native inventory-only +0 presence semantics', () => {
        const entries = [{ itemHrid: '/items/tea' }, { itemHrid: '' }, { itemHrid: '/items/coffee' }];
        const resolved = resolveLoadoutConsumables(entries, [
            // Missing count is still present, matching native MWI character-item semantics.
            { itemHrid: '/items/tea', enhancementLevel: 0, itemLocationHrid: '/item_locations/inventory' },
            // Wrong enhancement and wrong location must not satisfy native consumable validation.
            { itemHrid: '/items/coffee', enhancementLevel: 1, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/coffee', enhancementLevel: 0, itemLocationHrid: '/item_locations/main_hand' },
        ]);

        expect(resolved).toEqual([
            { slotIndex: 0, itemHrid: '/items/tea', isAvailable: true },
            { slotIndex: 1, itemHrid: '', isAvailable: true },
            { slotIndex: 2, itemHrid: '/items/coffee', isAvailable: false },
        ]);
    });

    test('missing saved food/drinks do not make a snapshot unusable, but are still surfaced as diagnostics', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/apple', enhancementLevel: 0, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        const loadout = serverLoadout({
            drinks: ['/items/tea', ''],
            wearableMap: { [MAIN_HAND]: `123::${MAIN_HAND}::${SWORD}::5` },
        });
        loadout.foodItemHrids = ['/items/apple', ''];
        mocks.wsHandlers.get('init_character_data')(initPayload('A', { one: loadout }));

        const snapshot = state.getSnapshotById('one');
        expect(snapshot.food).toEqual([{ itemHrid: '/items/apple' }, { itemHrid: '' }]);
        expect(snapshot.drinks).toEqual([{ itemHrid: '' }, { itemHrid: '' }]);
        expect(snapshot.unavailableFood).toEqual([]);
        expect(snapshot.unavailableDrinks).toEqual([{ slotIndex: 0, itemHrid: '/items/tea' }]);
        expect(snapshot.hasUnavailableConsumables).toBe(true);
        expect(snapshot.isUsableForCalculation).toBe(true);
        expect(state.getUsableSnapshotById('one')).not.toBeNull();
        expect(state.findSnapshotSelectionForActionType('/action_types/crafting')).toMatchObject({
            status: 'usable',
            snapshot: { name: 'Test Loadout', hasUnavailableConsumables: true },
        });
        expect(state.findSnapshotForActionType('/action_types/crafting')).not.toBeNull();
    });

    test('suppressValidation never turns an unproven missing-item loadout into a usable calculation', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', {
                one: serverLoadout({
                    name: 'Suppressed',
                    savedLevel: 5,
                    useExactEnhancement: true,
                    suppressValidation: true,
                    drinks: ['/items/tea'],
                }),
            })
        );

        const snapshot = state.getSnapshotById('one');
        expect(snapshot.suppressValidation).toBeUndefined();
        expect(snapshot).toMatchObject({
            hasUnavailableEquipment: true,
            hasUnavailableConsumables: true,
            isUsableForCalculation: false,
        });
        expect(state.getUsableSnapshotById('one')).toBeNull();
    });

    test('missing exact/highest variants are marked unavailable without inventing server execution behavior', () => {
        const exact = buildRawLoadoutSnapshot('exact', serverLoadout({ savedLevel: 5, useExactEnhancement: true }));
        const highest = buildRawLoadoutSnapshot(
            'highest',
            serverLoadout({ savedLevel: 5, useExactEnhancement: false })
        );

        expect(
            resolveLoadoutEquipment(exact, [
                { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ])[0]
        ).toMatchObject({
            enhancementLevel: null,
            isAvailable: false,
        });
        expect(resolveLoadoutEquipment(highest, [])[0]).toMatchObject({
            enhancementLevel: null,
            isAvailable: false,
        });
    });

    test('public snapshots separate unavailable equipment so historical levels cannot leak into calculations', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 5, useExactEnhancement: false }) })
        );

        const descriptive = state.getSnapshotById('one');
        expect(descriptive.equipment).toEqual([]);
        expect(descriptive).toMatchObject({
            hasUnavailableEquipment: true,
            unavailableEquipment: [{ itemLocationHrid: MAIN_HAND, itemHrid: SWORD }],
        });
        expect(descriptive.useExactEnhancement).toBeUndefined();
        expect(descriptive.suppressValidation).toBeUndefined();
        expect(state.getUsableSnapshotById('one')).toBeNull();
        expect(state.getUsableSnapshotByName('One')).toBeNull();
        expect(state.findSnapshotForActionType('/action_types/crafting')).toBeNull();
    });

    test('a stale resolved snapshot cannot silently rebind to a new loadout that reuses its name', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            {
                itemHrid: SWORD,
                enhancementLevel: 5,
                count: 1,
                itemLocationHrid: '/item_locations/inventory',
            },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { old: serverLoadout({ name: 'Same Name', savedLevel: 5 }) })
        );
        const stale = state.getSnapshotById('old');

        mocks.wsHandlers.get('loadouts_updated')({
            characterLoadoutMap: { replacement: serverLoadout({ name: 'Same Name', savedLevel: 5 }) },
        });

        expect(state.resolveSnapshot(stale)).toBeNull();
        expect(state.getSnapshotByName('Same Name')?.snapshotId).toBe('replacement');
    });

    test('a previously resolved snapshot refreshes after the canonical items_updated invalidation path', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 5 }) })
        );

        const first = state.getSnapshotById('one');
        expect(first.equipment[0].enhancementLevel).toBe(10);

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 12, count: 1, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 12, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ],
        });
        const second = state.resolveSnapshot(first);
        expect(second.equipment[0]).toMatchObject({ enhancementLevel: 12, isAvailable: true });
    });

    test('repeated effective reads reuse the resolved cache instead of rescanning inventory', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 10, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 20, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 5, drinks: ['/items/tea'] }) })
        );

        dataManager.getInventory.mockClear();

        for (let i = 0; i < 100; i += 1) {
            expect(state.findSnapshotSelectionForActionType('/action_types/crafting')).toMatchObject({
                status: 'usable',
                snapshot: { equipment: [expect.objectContaining({ enhancementLevel: 10 })] },
            });
        }

        // The cache was populated when authoritative state arrived. Hot-path reads do not
        // touch inventory at all until a relevant items_updated invalidation occurs.
        expect(dataManager.getInventory).not.toHaveBeenCalled();

        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 12, count: 1, itemLocationHrid: '/item_locations/inventory' },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 20, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.dataHandlers.get('items_updated')({
            endCharacterItems: [
                { itemHrid: SWORD, enhancementLevel: 12, count: 1, itemLocationHrid: '/item_locations/inventory' },
            ],
        });

        expect(state.findSnapshotSelectionForActionType('/action_types/crafting')).toMatchObject({
            status: 'usable',
            snapshot: { equipment: [expect.objectContaining({ enhancementLevel: 12 })] },
        });
        expect(dataManager.getInventory).toHaveBeenCalledTimes(1);
    });

    test('the lightweight calculation-only selection never touches inventory on repeat and matches the descriptive resolution', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [
            { itemHrid: SWORD, enhancementLevel: 8, count: 1, itemLocationHrid: MAIN_HAND },
            { itemHrid: '/items/tea', enhancementLevel: 0, count: 3, itemLocationHrid: '/item_locations/inventory' },
        ];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 1, drinks: ['/items/tea'] }) })
        );

        const descriptive = state.findSnapshotSelectionForActionType('/action_types/crafting');
        dataManager.getInventory.mockClear();

        let calculationSelection;
        for (let i = 0; i < 50; i += 1) {
            calculationSelection = state.findCalculationSelectionForActionType('/action_types/crafting');
        }

        expect(dataManager.getInventory).not.toHaveBeenCalled();
        expect(calculationSelection.status).toBe('usable');
        expect(calculationSelection.snapshot.equipment).toEqual(descriptive.snapshot.equipment);
        expect(calculationSelection.snapshot.drinks).toEqual(descriptive.snapshot.drinks);
        expect(calculationSelection.snapshot.isUsableForCalculation).toBe(descriptive.snapshot.isUsableForCalculation);

        // The lightweight snapshot must be defensively copied too: mutating it cannot corrupt
        // the canonical cache read by the next hot-path or descriptive call.
        calculationSelection.snapshot.equipment[0].enhancementLevel = 999;
        expect(
            state.findCalculationSelectionForActionType('/action_types/crafting').snapshot.equipment[0]
        ).toMatchObject({ enhancementLevel: 8 });
    });

    test('an unavailable saved loadout is reported consistently by both the calculation-only and descriptive selectors', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', { one: serverLoadout({ name: 'One', savedLevel: 5, useExactEnhancement: true }) })
        );

        expect(state.findCalculationSelectionForActionType('/action_types/crafting')).toMatchObject({
            status: 'unavailable',
            snapshot: { hasUnavailableEquipment: true, isUsableForCalculation: false },
        });
    });

    test('no matching saved loadout reports none for both selectors without touching inventory', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');

        expect(state.findCalculationSelectionForActionType('/action_types/crafting')).toEqual({
            status: 'none',
            snapshot: null,
        });
    });

    test('an All Skills loadout selected as a fallback reports drinksApplicable: false even though its equipment is usable', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [{ itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND }];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', {
                allSkills: serverLoadout({ name: 'All Skills Default', actionTypeHrid: '', savedLevel: 5 }),
            })
        );

        const selection = state.findCalculationSelectionForActionType('/action_types/tailoring');

        expect(selection.status).toBe('usable');
        expect(selection.snapshot.drinksApplicable).toBe(false);
        expect(selection.snapshot.equipment).toEqual([expect.objectContaining({ enhancementLevel: 5 })]);
    });

    test('a skill-specific loadout with genuinely no drinks still reports drinksApplicable: true', () => {
        const state = new LoadoutState();
        state.startCapture();
        setActiveCharacter('A');
        mocks.inventory = [{ itemHrid: SWORD, enhancementLevel: 5, count: 1, itemLocationHrid: MAIN_HAND }];
        mocks.wsHandlers.get('init_character_data')(
            initPayload('A', {
                tailoring: serverLoadout({ name: 'Tailoring', actionTypeHrid: '/action_types/tailoring', drinks: [] }),
            })
        );

        const selection = state.findCalculationSelectionForActionType('/action_types/tailoring');

        expect(selection.status).toBe('usable');
        expect(selection.snapshot.drinksApplicable).toBe(true);
        expect(selection.snapshot.drinks).toEqual([]);
    });
});

describe('getSavedLevelDisplays (display-only saved level vs ownership)', () => {
    const inv = (...levels) =>
        levels.map((enhancementLevel) => ({
            itemHrid: SWORD,
            enhancementLevel,
            count: 1,
            itemLocationHrid: '/item_locations/inventory',
        }));

    function statusFor({ savedLevel, useExactEnhancement, owned }) {
        const state = new LoadoutState();
        state.rawSnapshots = {
            one: buildRawLoadoutSnapshot('one', serverLoadout({ name: 'Mine', savedLevel, useExactEnhancement })),
        };
        mocks.inventory = owned;
        const [display] = state.getSavedLevelDisplays('Mine');
        return display.equipment[0];
    }

    test('returns nothing for a name no loadout has', () => {
        const state = new LoadoutState();
        state.rawSnapshots = { one: buildRawLoadoutSnapshot('one', serverLoadout({ name: 'Mine' })) };

        expect(state.getSavedLevelDisplays('Other')).toEqual([]);
    });

    test('returns every loadout sharing the name, with the saved level untouched', () => {
        const state = new LoadoutState();
        state.rawSnapshots = {
            a: buildRawLoadoutSnapshot('a', serverLoadout({ name: 'Same', savedLevel: 3 })),
            b: buildRawLoadoutSnapshot('b', serverLoadout({ name: 'Same', savedLevel: 7 })),
        };
        mocks.inventory = inv(7);

        const displays = state.getSavedLevelDisplays('Same');

        expect(displays.map((d) => [d.snapshotId, d.equipment[0].savedLevel])).toEqual([
            ['a', 3],
            ['b', 7],
        ]);
    });

    test.each([
        ['no copy owned', { savedLevel: 5, useExactEnhancement: false, owned: [] }, 'notOwned'],
        ['saved is the best copy', { savedLevel: 5, useExactEnhancement: false, owned: inv(5, 2) }, 'current'],
        [
            'highest mode with a higher copy',
            { savedLevel: 5, useExactEnhancement: false, owned: inv(5, 9) },
            'higherEquipped',
        ],
        [
            'exact mode with a higher copy',
            { savedLevel: 5, useExactEnhancement: true, owned: inv(5, 9) },
            'higherIgnored',
        ],
        [
            'exact mode, saved level not owned',
            { savedLevel: 5, useExactEnhancement: true, owned: inv(9) },
            'missingExact',
        ],
        [
            'highest mode, best copy below saved',
            { savedLevel: 8, useExactEnhancement: false, owned: inv(3) },
            'lowerOwned',
        ],
        [
            'exact +0 is a valid saved level',
            { savedLevel: 0, useExactEnhancement: true, owned: inv(0, 4) },
            'higherIgnored',
        ],
    ])('%s', (_label, scenario, expected) => {
        expect(statusFor(scenario).status).toBe(expected);
    });

    test('reports the best owned level next to the saved one', () => {
        expect(statusFor({ savedLevel: 5, useExactEnhancement: false, owned: inv(5, 9) })).toMatchObject({
            itemHrid: SWORD,
            savedLevel: 5,
            highestOwnedLevel: 9,
        });
    });
});
