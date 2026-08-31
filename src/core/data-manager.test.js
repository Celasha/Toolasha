/**
 * Tests for DataManager event forwarding
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

let webSocketHandlers = new Map();

vi.mock('./websocket.js', () => {
    webSocketHandlers = new Map();

    return {
        default: {
            on: vi.fn((event, handler) => {
                webSocketHandlers.set(event, handler);
            }),
            off: vi.fn((event, handler) => {
                if (webSocketHandlers.get(event) === handler) {
                    webSocketHandlers.delete(event);
                }
            }),
            onSocketEvent: vi.fn(),
            offSocketEvent: vi.fn(),
        },
    };
});

vi.mock('./storage.js', () => ({
    default: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => true),
    },
}));

describe('DataManager', () => {
    test('forwards market item order book updates', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const listener = vi.fn();
        const payload = {
            marketItemOrderBooks: {
                itemHrid: '/items/gourmet_tea',
            },
        };

        dataManager.on('market_item_order_books_updated', listener);

        const handler = webSocketHandlers.get('market_item_order_books_updated');
        expect(typeof handler).toBe('function');

        handler(payload);

        // Wait for deferred emit (setTimeout in emit())
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(listener).toHaveBeenCalledWith(payload);
    });

    test('initial character data keeps equipped items without count and filters explicit zero-count records', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const equipped = {
            hash: 'character::main_hand::example_bow::10',
            itemHrid: '/items/example_bow',
            enhancementLevel: 10,
            itemLocationHrid: '/item_locations/main_hand',
        };
        const removed = {
            hash: 'character::inventory::removed_item::0',
            itemHrid: '/items/removed_item',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 0,
        };

        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
        dataManager.characterItems = null;
        dataManager.characterEquipment.clear();

        const handler = webSocketHandlers.get('init_character_data');
        expect(typeof handler).toBe('function');
        const payload = {
            character: { id: 'character-a', name: 'Character A' },
            characterSkills: [],
            characterItems: [equipped, removed],
            characterActions: [],
            characterQuests: [],
            characterHouseRoomMap: {},
            actionTypeDrinkSlotsMap: {},
            characterGuildBuffMap: {},
            guildBuildingLevelMap: {},
        };
        await handler(payload);

        expect(payload.characterItems).toEqual([equipped, removed]);
        expect(dataManager.getInventory()).toEqual([equipped]);
        expect(dataManager.characterData.characterItems).toBe(dataManager.characterItems);
        expect(dataManager.characterData.characterItems).toEqual([equipped]);
        expect(dataManager.getEquipment().get('/item_locations/main_hand')).toEqual(equipped);
    });

    test('incremental updates keep legacy characterData.characterItems consumers on the live item array', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const updateHandler = webSocketHandlers.get('items_updated');
        const initial = {
            hash: 'character::inventory::example_bow::5',
            itemHrid: '/items/example_bow',
            enhancementLevel: 5,
            itemLocationHrid: '/item_locations/inventory',
            count: 1,
        };
        const replacement = {
            hash: 'character::inventory::example_bow::10',
            itemHrid: '/items/example_bow',
            enhancementLevel: 10,
            itemLocationHrid: '/item_locations/inventory',
            count: 1,
        };

        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
        dataManager.characterItems = null;
        dataManager.characterEquipment.clear();

        await initHandler({
            character: { id: 'character-live-items', name: 'Character Live Items' },
            characterSkills: [],
            characterItems: [initial],
            characterActions: [],
            characterQuests: [],
            characterHouseRoomMap: {},
            actionTypeDrinkSlotsMap: {},
            characterGuildBuffMap: {},
            guildBuildingLevelMap: {},
        });

        updateHandler({
            endCharacterItems: [{ ...initial, count: 0 }, replacement],
        });

        expect(dataManager.characterData.characterItems).toBe(dataManager.characterItems);
        expect(dataManager.characterData.characterItems).toEqual([replacement]);
        expect(dataManager.getInventory()).toEqual([replacement]);
    });

    test('keeps a newly observed equipped item when items_updated omits count', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const payload = {
            endCharacterItems: [
                {
                    id: 'equipped-bow-10',
                    itemHrid: '/items/example_bow',
                    enhancementLevel: 10,
                    itemLocationHrid: '/item_locations/main_hand',
                },
            ],
        };

        dataManager.characterItems = [];
        dataManager.characterEquipment.clear();

        const handler = webSocketHandlers.get('items_updated');
        expect(typeof handler).toBe('function');

        handler(payload);

        expect(dataManager.getInventory()).toEqual(payload.endCharacterItems);
        expect(dataManager.getEquipment().get('/item_locations/main_hand')).toEqual(payload.endCharacterItems[0]);
    });

    test('still ignores a newly observed character-item record with explicit zero count', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const payload = {
            endCharacterItems: [
                {
                    id: 'removed-bow-10',
                    itemHrid: '/items/example_bow',
                    enhancementLevel: 10,
                    itemLocationHrid: '/item_locations/main_hand',
                    count: 0,
                },
            ],
        };

        dataManager.characterItems = [];
        dataManager.characterEquipment.clear();

        const handler = webSocketHandlers.get('items_updated');
        handler(payload);

        expect(dataManager.getInventory()).toEqual([]);
        expect(dataManager.getEquipment().has('/item_locations/main_hand')).toBe(false);
    });

    test.each([
        ['replacement before removal', true],
        ['removal before replacement', false],
    ])('keeps the replacement equipment regardless of batch order: %s', async (_label, replacementFirst) => {
        const { default: dataManager } = await import('./data-manager.js');
        const oldItem = {
            hash: 'character::main_hand::example_bow::5',
            id: 'legacy-record-id',
            itemHrid: '/items/example_bow',
            enhancementLevel: 5,
            itemLocationHrid: '/item_locations/main_hand',
        };
        const replacement = {
            hash: 'character::main_hand::example_bow::10',
            // Deliberately re-use the fallback id. Native `hash` identity must win.
            id: 'legacy-record-id',
            itemHrid: '/items/example_bow',
            enhancementLevel: 10,
            itemLocationHrid: '/item_locations/main_hand',
        };
        const removal = { ...oldItem, count: 0 };

        dataManager.characterItems = [oldItem];
        dataManager.updateEquipmentMap(dataManager.characterItems);

        const handler = webSocketHandlers.get('items_updated');
        handler({
            endCharacterItems: replacementFirst ? [replacement, removal] : [removal, replacement],
        });

        expect(dataManager.getInventory()).toEqual([replacement]);
        expect(dataManager.getEquipment().get('/item_locations/main_hand')).toEqual(replacement);
    });

    test('equipment location follows the last present hash update, not characterItems array order', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const oldItem = {
            hash: 'character::main_hand::example_bow::5',
            id: 'old-id',
            itemHrid: '/items/example_bow',
            enhancementLevel: 5,
            itemLocationHrid: '/item_locations/main_hand',
        };
        const replacement = {
            hash: 'character::main_hand::example_bow::10',
            id: 'new-id',
            itemHrid: '/items/example_bow',
            enhancementLevel: 10,
            itemLocationHrid: '/item_locations/main_hand',
        };
        dataManager.characterItems = [oldItem, replacement];
        dataManager.updateEquipmentMap(dataManager.characterItems);
        expect(dataManager.getEquipment().get('/item_locations/main_hand')).toEqual(replacement);

        const refreshedOld = { ...oldItem, durability: 123 };
        const handler = webSocketHandlers.get('items_updated');
        handler({ endCharacterItems: [refreshedOld] });

        // Native MWI sets characterEquipment[location] for every present update, even when
        // another live hash for that location occurs later in the item-map iteration order.
        expect(dataManager.getInventory()).toEqual([refreshedOld, replacement]);
        expect(dataManager.getEquipment().get('/item_locations/main_hand')).toEqual(refreshedOld);
    });

    test('hash-aware removal can clear an equipment record that originated from a legacy id-only cache entry', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const legacy = {
            id: 'legacy-equipped-id',
            itemHrid: '/items/example_bow',
            enhancementLevel: 5,
            itemLocationHrid: '/item_locations/main_hand',
        };
        dataManager.characterItems = [legacy];
        dataManager.updateEquipmentMap(dataManager.characterItems);

        const handler = webSocketHandlers.get('items_updated');
        handler({
            endCharacterItems: [
                {
                    ...legacy,
                    hash: 'character::main_hand::example_bow::5',
                    count: 0,
                },
            ],
        });

        expect(dataManager.getInventory()).toEqual([]);
        expect(dataManager.getEquipment().has('/item_locations/main_hand')).toBe(false);
    });

    test('a legacy id-only removal can remove a previously hash-aware record', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const existing = {
            hash: 'character::inventory::example_log::0',
            id: 'legacy-id',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 3,
        };
        dataManager.characterItems = [existing];

        const handler = webSocketHandlers.get('items_updated');
        handler({
            endCharacterItems: [
                {
                    id: 'legacy-id',
                    itemHrid: '/items/example_log',
                    enhancementLevel: 0,
                    itemLocationHrid: '/item_locations/inventory',
                    count: 0,
                },
            ],
        });

        expect(dataManager.getInventory()).toEqual([]);
    });

    test('a hash-aware update replaces a legacy id-only record without duplicating it', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const legacy = {
            id: 'legacy-id',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 2,
        };
        const current = {
            hash: 'character::inventory::example_log::0',
            id: 'legacy-id',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 7,
        };
        dataManager.characterItems = [legacy];

        const handler = webSocketHandlers.get('items_updated');
        handler({ endCharacterItems: [current] });

        expect(dataManager.getInventory()).toEqual([current]);
    });

    test('hash-aware updates replace the full record so omitted count cannot retain a stale value', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const existing = {
            hash: 'character::inventory::example_log::0',
            id: 'same-id',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 7,
        };
        const updateWithoutCount = {
            hash: existing.hash,
            id: existing.id,
            itemHrid: existing.itemHrid,
            enhancementLevel: 0,
            itemLocationHrid: existing.itemLocationHrid,
        };
        dataManager.characterItems = [existing];

        const handler = webSocketHandlers.get('items_updated');
        handler({ endCharacterItems: [updateWithoutCount] });

        expect(dataManager.getInventory()).toEqual([updateWithoutCount]);
        expect(Object.prototype.hasOwnProperty.call(dataManager.getInventory()[0], 'count')).toBe(false);
    });

    test('action_completed removes an inventory stack only on explicit zero count', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const existing = {
            hash: 'character::inventory::example_log::0',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
            count: 3,
        };
        dataManager.characterItems = [existing];
        dataManager.characterActions = [{ id: 'action-1', isDone: false }];

        const handler = webSocketHandlers.get('action_completed');
        handler({
            endCharacterAction: { id: 'action-1', isDone: false },
            endCharacterItems: [{ ...existing, count: 0 }],
        });

        expect(dataManager.getInventory()).toEqual([]);
    });

    test('action_completed keeps a new inventory stack when count is omitted', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const newItem = {
            hash: 'character::inventory::example_log::0',
            itemHrid: '/items/example_log',
            enhancementLevel: 0,
            itemLocationHrid: '/item_locations/inventory',
        };
        dataManager.characterItems = [];
        dataManager.characterActions = [{ id: 'action-1', isDone: false }];

        const handler = webSocketHandlers.get('action_completed');
        handler({
            endCharacterAction: { id: 'action-1', isDone: false },
            endCharacterItems: [newItem],
        });

        expect(dataManager.getInventory()).toEqual([newItem]);
    });

    test('actions_updated keeps the queue in native ordinal order after front-action swaps', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const actionsUpdated = webSocketHandlers.get('actions_updated');

        dataManager.activeSocket = null;
        dataManager.characterActions = [
            {
                id: 'moonstone',
                actionHrid: '/actions/alchemy/transmute',
                ordinal: 0,
                partyID: 0,
                isDone: false,
                currentCount: 0,
            },
            {
                id: 'pirate',
                actionHrid: '/actions/alchemy/coinify',
                ordinal: 1,
                partyID: 0,
                isDone: false,
                currentCount: 0,
            },
            {
                id: 'twilight',
                actionHrid: '/actions/combat/twilight_zone',
                ordinal: 2,
                partyID: 0,
                isDone: false,
                currentCount: 0,
            },
        ];

        // Player video: Pirate Essence is promoted ahead of Moonstone. The server update can
        // contain both changed rows; array insertion order must not become queue truth.
        actionsUpdated({
            endCharacterActions: [
                {
                    id: 'moonstone',
                    actionHrid: '/actions/alchemy/transmute',
                    ordinal: 1,
                    partyID: 0,
                    isDone: false,
                    currentCount: 0,
                },
                {
                    id: 'pirate',
                    actionHrid: '/actions/alchemy/coinify',
                    ordinal: 0,
                    partyID: 0,
                    isDone: false,
                    currentCount: 0,
                },
            ],
        });

        expect(dataManager.getCurrentActions().map((action) => action.id)).toEqual(['pirate', 'moonstone', 'twilight']);

        // Then Moonstone is promoted back ahead of Pirate Essence.
        actionsUpdated({
            endCharacterActions: [
                {
                    id: 'pirate',
                    actionHrid: '/actions/alchemy/coinify',
                    ordinal: 1,
                    partyID: 0,
                    isDone: false,
                    currentCount: 0,
                },
                {
                    id: 'moonstone',
                    actionHrid: '/actions/alchemy/transmute',
                    ordinal: 0,
                    partyID: 0,
                    isDone: false,
                    currentCount: 0,
                },
            ],
        });

        expect(dataManager.getCurrentActions().map((action) => action.id)).toEqual(['moonstone', 'pirate', 'twilight']);
    });

    test('actions_updated replaces existing rows without duplicates and removes completed rows', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const actionsUpdated = webSocketHandlers.get('actions_updated');

        dataManager.activeSocket = null;
        dataManager.characterActions = [
            { id: 'a', actionHrid: '/actions/alchemy/coinify', ordinal: 0, partyID: 0, isDone: false, currentCount: 0 },
            {
                id: 'b',
                actionHrid: '/actions/alchemy/transmute',
                ordinal: 1,
                partyID: 0,
                isDone: false,
                currentCount: 0,
            },
        ];

        actionsUpdated({
            endCharacterActions: [
                {
                    id: 'a',
                    actionHrid: '/actions/alchemy/coinify',
                    ordinal: 0,
                    partyID: 0,
                    isDone: false,
                    currentCount: 7,
                },
            ],
        });

        expect(dataManager.getCurrentActions()).toHaveLength(2);
        expect(dataManager.getCurrentActions().filter((action) => action.id === 'a')).toHaveLength(1);
        expect(dataManager.getCurrentActions()[0].currentCount).toBe(7);

        actionsUpdated({
            endCharacterActions: [
                {
                    id: 'a',
                    actionHrid: '/actions/alchemy/coinify',
                    ordinal: 0,
                    partyID: 0,
                    isDone: true,
                    currentCount: 7,
                },
            ],
        });

        expect(dataManager.getCurrentActions().map((action) => action.id)).toEqual(['b']);
    });

    test('actions_updated preserves native party-before-solo queue ordering', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const actionsUpdated = webSocketHandlers.get('actions_updated');

        dataManager.activeSocket = null;
        dataManager.characterActions = [];

        actionsUpdated({
            endCharacterActions: [
                { id: 'solo', ordinal: 0, partyID: 0, isDone: false, currentCount: 0 },
                { id: 'party', ordinal: 10, partyID: 123, isDone: false, currentCount: 0 },
            ],
        });

        expect(dataManager.getCurrentActions().map((action) => action.id)).toEqual(['party', 'solo']);
    });

    test('merges market listings updates and emits updated list', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const listener = vi.fn();
        const payload = {
            endMarketListings: [
                { id: 2, price: 250, isSell: true },
                { id: 3, price: 300, isSell: false },
            ],
        };

        dataManager.characterData = {
            myMarketListings: [
                { id: 1, price: 100, isSell: true },
                { id: 2, price: 200, isSell: true },
            ],
        };

        dataManager.on('market_listings_updated', listener);

        const handler = webSocketHandlers.get('market_listings_updated');
        expect(typeof handler).toBe('function');

        handler(payload);

        // Wait for deferred emit (setTimeout in emit())
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataManager.getMarketListings()).toEqual([
            { id: 1, price: 100, isSell: true },
            { id: 2, price: 250, isSell: true },
            { id: 3, price: 300, isSell: false },
        ]);
        expect(listener).toHaveBeenCalledWith({
            ...payload,
            myMarketListings: [
                { id: 1, price: 100, isSell: true },
                { id: 2, price: 250, isSell: true },
                { id: 3, price: 300, isSell: false },
            ],
        });
    });
});

describe('DataManager event listener snapshots', () => {
    test('does not register the same callback reference twice', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const listener = vi.fn();

        dataManager.on('dedup_test', listener);
        dataManager.on('dedup_test', listener);
        dataManager.emit('dedup_test', {});

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(listener).toHaveBeenCalledTimes(1);
        dataManager.off('dedup_test', listener);
    });

    test('character switching calls every listener when listeners remove themselves', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const calls = [];

        const first = () => {
            calls.push('first');
            dataManager.off('character_switching', first);
        };
        const second = () => {
            calls.push('second');
            dataManager.off('character_switching', second);
        };
        const third = () => {
            calls.push('third');
            dataManager.off('character_switching', third);
        };

        dataManager.on('character_switching', first);
        dataManager.on('character_switching', second);
        dataManager.on('character_switching', third);

        dataManager.emit('character_switching', {});

        expect(calls).toEqual(['first', 'second', 'third']);
    });

    test('deferred events use the listener set that existed when emit was called', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const first = vi.fn();
        const late = vi.fn();

        dataManager.on('snapshot_test', first);
        dataManager.emit('snapshot_test', { id: 1 });
        dataManager.off('snapshot_test', first);
        dataManager.on('snapshot_test', late);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(first).toHaveBeenCalledWith({ id: 1 });
        expect(late).not.toHaveBeenCalled();
        dataManager.off('snapshot_test', late);
    });
});

describe('DataManager action-unit progress boundary (TLA-015)', () => {
    /**
     * Minimal init_character_data-shaped payload. characterItems must be an array —
     * updateEquipmentMap() iterates it directly with no null-guard.
     */
    function makeCharacterPayload(characterId, actions) {
        return {
            character: { id: characterId, name: `char-${characterId}` },
            characterActions: actions,
            characterSkills: [],
            characterItems: [],
            characterQuests: [],
        };
    }

    function makeAction(id, ordinal, currentCount, overrides = {}) {
        return { id, ordinal, currentCount, hasMaxCount: true, maxCount: 999, isDone: false, ...overrides };
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('returns 0 elapsed when no boundary has ever been established (cold/unknown provenance)', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        expect(dataManager.getElapsedSecondsInCurrentUnit(999999, 0, 135)).toBe(0);
    });

    test('action_completed continuation of the front action establishes a fresh boundary reflecting real elapsed time', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const handler = webSocketHandlers.get('init_character_data');

        await handler(makeCharacterPayload(9001, [makeAction(501, 0, 3)]));

        // Cold: no prior boundary recorded for (501, 3) yet.
        expect(dataManager.getElapsedSecondsInCurrentUnit(501, 3, 135)).toBe(0);

        const completedHandler = webSocketHandlers.get('action_completed');
        // Unit (currentCount 3) finishes, action continues at currentCount 4 — a trustworthy boundary.
        completedHandler({ endCharacterAction: makeAction(501, 0, 4) });

        vi.setSystemTime(60000); // 60s later
        expect(dataManager.getElapsedSecondsInCurrentUnit(501, 4, 135)).toBe(60);
        // The just-superseded unit's key no longer matches — fails closed to 0, not a stale value.
        expect(dataManager.getElapsedSecondsInCurrentUnit(501, 3, 135)).toBe(0);
    });

    test('elapsed is clamped to the full unit duration, never exceeding one action', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const handler = webSocketHandlers.get('init_character_data');
        await handler(makeCharacterPayload(9002, [makeAction(502, 0, 0)]));

        const completedHandler = webSocketHandlers.get('action_completed');
        completedHandler({ endCharacterAction: makeAction(502, 0, 1) });

        vi.setSystemTime(999000); // far beyond a 135s action
        expect(dataManager.getElapsedSecondsInCurrentUnit(502, 1, 135)).toBe(135);
    });

    test('a new action taking the front slot resets the boundary — no carried-over progress from the old action', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const handler = webSocketHandlers.get('init_character_data');
        await handler(makeCharacterPayload(9003, [makeAction(503, 0, 0)]));

        const completedHandler = webSocketHandlers.get('action_completed');
        completedHandler({ endCharacterAction: makeAction(503, 0, 1) });
        vi.setSystemTime(60000);
        expect(dataManager.getElapsedSecondsInCurrentUnit(503, 1, 135)).toBe(60);

        // Action 503 is cancelled/replaced; a different action (504) becomes the new front action.
        const updatedHandler = webSocketHandlers.get('actions_updated');
        updatedHandler({ endCharacterActions: [{ ...makeAction(503, 0, 1), isDone: true }, makeAction(504, 0, 0)] });

        // The new front action's current unit just started — elapsed must be 0, not inherited.
        expect(dataManager.getElapsedSecondsInCurrentUnit(504, 0, 90)).toBe(0);
    });

    test('reordering the queue without changing the front action does not reset its boundary', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const handler = webSocketHandlers.get('init_character_data');
        await handler(makeCharacterPayload(9004, [makeAction(505, 0, 0)]));

        const completedHandler = webSocketHandlers.get('action_completed');
        completedHandler({ endCharacterAction: makeAction(505, 0, 1) });
        vi.setSystemTime(45000);

        // actions_updated fires (e.g. a new action queued behind it) but the front action (505, count 1)
        // is unchanged.
        const updatedHandler = webSocketHandlers.get('actions_updated');
        updatedHandler({ endCharacterActions: [makeAction(505, 0, 1), makeAction(506, 1, 0)] });

        expect(dataManager.getElapsedSecondsInCurrentUnit(505, 1, 135)).toBe(45);
    });

    test('reload invariant: a persisted boundary matching the live front action is restored, not reset to now', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const { default: storage } = await import('./storage.js');

        storage.get.mockResolvedValueOnce({ actionId: 507, currentCount: 2, unitStartTime: -60000 });

        const handler = webSocketHandlers.get('init_character_data');
        await handler(makeCharacterPayload(9005, [makeAction(507, 0, 2)]));

        // System time is 0; the persisted boundary started at -60000, so 60s have genuinely elapsed —
        // proving the old start time survived rather than being reset to "now" (which would give 0).
        expect(dataManager.getElapsedSecondsInCurrentUnit(507, 2, 135)).toBe(60);
    });

    test('a persisted boundary whose currentCount no longer matches is not trusted (unit progressed while unobserved)', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const { default: storage } = await import('./storage.js');

        // Persisted boundary is for currentCount 2, but the live action has already advanced to 5 —
        // at least one unit completed while this boundary was never observed/updated.
        storage.get.mockResolvedValueOnce({ actionId: 508, currentCount: 2, unitStartTime: -999000 });

        const handler = webSocketHandlers.get('init_character_data');
        await handler(makeCharacterPayload(9006, [makeAction(508, 0, 5)]));

        // Falls back to a fresh fail-closed boundary (elapsed 0) instead of the stale/mismatched one.
        expect(dataManager.getElapsedSecondsInCurrentUnit(508, 5, 135)).toBe(0);
    });

    test('character switch A -> B -> A: returning to A with an unchanged front action restores its persisted boundary', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const { default: storage } = await import('./storage.js');

        const initHandler = webSocketHandlers.get('init_character_data');

        // Character A loads, establishes a boundary via action_completed.
        await initHandler(makeCharacterPayload(9101, [makeAction(601, 0, 0)]));
        webSocketHandlers.get('action_completed')({ endCharacterAction: makeAction(601, 0, 1) });
        vi.setSystemTime(30000); // A has been running its current unit for 30s

        // Switch to character B.
        storage.get.mockResolvedValueOnce(null); // B has no persisted boundary
        await initHandler(makeCharacterPayload(9102, [makeAction(701, 0, 0)]));
        // A's old (actionId, currentCount) key no longer resolves once we've switched away.
        expect(dataManager.getElapsedSecondsInCurrentUnit(601, 1, 135)).toBe(0);

        // Switch back to A — its persisted boundary (actionId 601, currentCount 1) still matches.
        storage.get.mockResolvedValueOnce({ actionId: 601, currentCount: 1, unitStartTime: 0 });
        vi.setSystemTime(50000);
        await initHandler(makeCharacterPayload(9101, [makeAction(601, 0, 1)]));

        expect(dataManager.getElapsedSecondsInCurrentUnit(601, 1, 135)).toBe(50);
    });
});

describe('DataManager character ability live-state (TLA-016)', () => {
    function makeCharacterPayload(characterId, characterAbilities) {
        return {
            character: { id: characterId, name: `char-${characterId}` },
            characterActions: [],
            characterSkills: [],
            characterItems: [],
            characterQuests: [],
            characterAbilities,
        };
    }

    function findAbility(dataManager, abilityHrid) {
        return dataManager.characterData.characterAbilities.find((a) => a.abilityHrid === abilityHrid);
    }

    // Isolate from whatever character-switch state earlier describe blocks in this file left
    // behind (currentCharacterId, lastCharacterSwitchTime) so every test here starts as a
    // clean first load, regardless of suite ordering.
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
        dataManager.characterData = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('DM-1: init_character_data exposes the exact initial ability state', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const handler = webSocketHandlers.get('init_character_data');

        await handler(makeCharacterPayload(9201, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));

        expect(findAbility(dataManager, '/abilities/poke')).toEqual({
            abilityHrid: '/abilities/poke',
            level: 6,
            experience: 359,
        });
    });

    test('DM-2: abilities_updated merges an existing ability without losing unrelated abilities', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        await initHandler(
            makeCharacterPayload(9202, [
                { abilityHrid: '/abilities/poke', level: 6, experience: 359 },
                { abilityHrid: '/abilities/impale', level: 3, experience: 100 },
            ])
        );

        const abilitiesUpdatedHandler = webSocketHandlers.get('abilities_updated');
        abilitiesUpdatedHandler({
            endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        });

        expect(findAbility(dataManager, '/abilities/poke')).toEqual({
            abilityHrid: '/abilities/poke',
            level: 7,
            experience: 410,
        });
        expect(findAbility(dataManager, '/abilities/impale')).toEqual({
            abilityHrid: '/abilities/impale',
            level: 3,
            experience: 100,
        });
    });

    test('DM-3: a newly learned ability absent at init is added, not ignored', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        await initHandler(makeCharacterPayload(9203, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));

        const abilitiesUpdatedHandler = webSocketHandlers.get('abilities_updated');
        abilitiesUpdatedHandler({
            endCharacterAbilities: [{ abilityHrid: '/abilities/frenzy', level: 1, experience: 0 }],
        });

        expect(findAbility(dataManager, '/abilities/frenzy')).toEqual({
            abilityHrid: '/abilities/frenzy',
            level: 1,
            experience: 0,
        });
        // Original ability is preserved alongside the newly learned one.
        expect(findAbility(dataManager, '/abilities/poke')).toEqual({
            abilityHrid: '/abilities/poke',
            level: 6,
            experience: 359,
        });
    });

    test('DM-4: action_completed.endCharacterAbilities merges while preserving existing items/skills behavior', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        await initHandler(makeCharacterPayload(9204, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));
        dataManager.characterItems = [{ id: 1, count: 5, itemLocationHrid: '/item_locations/inventory' }];
        dataManager.characterSkills = [{ skillHrid: '/skills/attack', experience: 100, level: 1 }];

        const abilitiesListener = vi.fn();
        dataManager.on('abilities_updated', abilitiesListener);

        const completedHandler = webSocketHandlers.get('action_completed');
        completedHandler({
            endCharacterAction: { id: 1, isDone: false },
            endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
            endCharacterItems: [{ id: 1, count: 4, itemLocationHrid: '/item_locations/inventory' }],
            endCharacterSkills: [{ skillHrid: '/skills/attack', experience: 150, level: 2 }],
        });

        expect(findAbility(dataManager, '/abilities/poke')).toEqual({
            abilityHrid: '/abilities/poke',
            level: 7,
            experience: 410,
        });
        expect(dataManager.characterItems[0].count).toBe(4);
        expect(dataManager.characterSkills[0]).toEqual({ skillHrid: '/skills/attack', experience: 150, level: 2 });

        await vi.advanceTimersByTimeAsync(0); // 'abilities_updated' emit is deferred via setTimeout

        expect(abilitiesListener).toHaveBeenCalledWith({
            endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        });
        dataManager.off('abilities_updated', abilitiesListener);
    });

    test('DM-5: a partial update touches only the named ability, leaving unrelated abilities untouched', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        await initHandler(
            makeCharacterPayload(9205, [
                { abilityHrid: '/abilities/poke', level: 6, experience: 359 },
                { abilityHrid: '/abilities/impale', level: 3, experience: 100 },
                { abilityHrid: '/abilities/frenzy', level: 2, experience: 50 },
            ])
        );

        const impaleBefore = findAbility(dataManager, '/abilities/impale');
        const frenzyBefore = findAbility(dataManager, '/abilities/frenzy');

        webSocketHandlers.get('abilities_updated')({
            endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 7, experience: 410 }],
        });

        expect(findAbility(dataManager, '/abilities/impale')).toEqual(impaleBefore);
        expect(findAbility(dataManager, '/abilities/frenzy')).toEqual(frenzyBefore);
    });

    test('DM-6: character switch A -> B -> A isolates ability state per character', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');

        await initHandler(makeCharacterPayload(9301, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));
        expect(findAbility(dataManager, '/abilities/poke').level).toBe(6);

        vi.setSystemTime(2000);
        await initHandler(
            makeCharacterPayload(9302, [{ abilityHrid: '/abilities/poke', level: 20, experience: 9999 }])
        );
        expect(findAbility(dataManager, '/abilities/poke').level).toBe(20);

        vi.setSystemTime(4000);
        await initHandler(makeCharacterPayload(9301, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));
        expect(findAbility(dataManager, '/abilities/poke').level).toBe(6);
    });

    test('a late abilities_updated/action_completed ability update during the switch window (characterData cleared) is safely dropped', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');

        await initHandler(makeCharacterPayload(9401, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));

        dataManager.characterData = null; // simulate the brief character_switching window
        expect(() =>
            webSocketHandlers.get('abilities_updated')({
                endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 99, experience: 99999 }],
            })
        ).not.toThrow();

        vi.setSystemTime(2000);
        await initHandler(makeCharacterPayload(9401, [{ abilityHrid: '/abilities/poke', level: 6, experience: 359 }]));
        expect(findAbility(dataManager, '/abilities/poke').level).toBe(6);
    });
});

describe('DataManager character-WebSocket ownership (TLA-018)', () => {
    function makePayload(characterId, overrides = {}) {
        return {
            character: { id: characterId, name: `char-${characterId}` },
            characterActions: [],
            characterSkills: [],
            characterItems: [],
            characterQuests: [],
            ...overrides,
        };
    }

    // Isolate from whatever character-switch/ownership state earlier describe blocks left
    // behind, regardless of suite ordering.
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
        dataManager.characterData = null;
        dataManager.characterItems = null;
        dataManager.characterSkills = null;
        dataManager.characterActions = [];
        dataManager.characterQuests = [];
        dataManager.characterHouseRooms.clear();
        dataManager.activeSocket = null;
        dataManager.initGeneration = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('a stale async init continuation cannot publish state or emit character_initialized after a newer init is accepted', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const { default: storage } = await import('./storage.js');
        const initHandler = webSocketHandlers.get('init_character_data');

        const socketA = {};
        const socketB = {};

        let resolveA;
        storage.get.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveA = resolve;
                })
        );

        const initializedListener = vi.fn();
        dataManager.on('character_initialized', initializedListener);

        // A begins init on socket A with a front action, so it must await storage.get(actionProgress).
        const pendingA = initHandler(
            makePayload(9501, {
                characterActions: [{ id: 5010, ordinal: 0, currentCount: 0 }],
                characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/a', level: 1 } },
            }),
            { socket: socketA }
        );

        // B arrives on a different socket while A's storage.get is still pending, and completes fully.
        storage.get.mockResolvedValueOnce(null);
        await initHandler(
            makePayload(9502, { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/b', level: 5 } } }),
            { socket: socketB }
        );
        await vi.advanceTimersByTimeAsync(0); // flush B's deferred character_initialized emit

        expect(dataManager.currentCharacterId).toBe(9502);
        expect(dataManager.getHouseRoomLevel('/house_rooms/b')).toBe(5);
        expect(initializedListener).toHaveBeenCalledTimes(1);
        expect(initializedListener.mock.calls[0][0].character.id).toBe(9502);

        // A's storage.get now resolves — this continuation must be dropped, not published.
        resolveA(null);
        await pendingA;
        await vi.advanceTimersByTimeAsync(0);

        expect(dataManager.currentCharacterId).toBe(9502);
        expect(dataManager.getHouseRoomLevel('/house_rooms/b')).toBe(5);
        expect(dataManager.getHouseRoomLevel('/house_rooms/a')).toBe(0);
        // No second character_initialized for the stale A continuation.
        expect(initializedListener).toHaveBeenCalledTimes(1);

        dataManager.off('character_initialized', initializedListener);
    });

    test('after an accepted init, character-scoped updates from a stale socket are ignored; the same updates from the current socket are applied', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socketA = {};
        const socketB = {};

        await initHandler(makePayload(9601), { socket: socketA });
        await initHandler(makePayload(9602), { socket: socketB });
        expect(dataManager.currentCharacterId).toBe(9602);

        // Stale socket A: abilities_updated must not merge.
        webSocketHandlers.get('abilities_updated')(
            { endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 99, experience: 1 }] },
            { socket: socketA }
        );
        expect(dataManager.characterData.characterAbilities).toBeUndefined();

        // Stale socket A: items_updated must not apply.
        dataManager.characterItems = [];
        webSocketHandlers.get('items_updated')(
            { endCharacterItems: [{ id: 1, count: 5, itemLocationHrid: '/item_locations/inventory' }] },
            { socket: socketA }
        );
        expect(dataManager.characterItems).toEqual([]);

        // Stale socket A: actions_updated must not apply.
        webSocketHandlers.get('actions_updated')(
            { endCharacterActions: [{ id: 777, isDone: false, ordinal: 0, currentCount: 0 }] },
            { socket: socketA }
        );
        expect(dataManager.characterActions.some((a) => a.id === 777)).toBe(false);

        // Stale socket A: house_rooms_updated must not apply.
        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/stale', level: 9 } } },
            { socket: socketA }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/stale')).toBe(0);

        // Stale socket A: skills_updated must not apply.
        webSocketHandlers.get('skills_updated')(
            { characterSkills: [{ skillHrid: '/skills/attack', level: 99, experience: 1 }] },
            { socket: socketA }
        );
        expect(dataManager.characterSkills).toEqual([]);

        // Current socket B: the same classes of update are applied normally.
        webSocketHandlers.get('abilities_updated')(
            { endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 10, experience: 500 }] },
            { socket: socketB }
        );
        expect(dataManager.characterData.characterAbilities).toEqual([
            { abilityHrid: '/abilities/poke', level: 10, experience: 500 },
        ]);

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/current', level: 3 } } },
            { socket: socketB }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/current')).toBe(3);
    });

    test('a delayed action_completed from a stale socket does not merge actions/items/skills/abilities', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socketA = {};
        const socketB = {};

        await initHandler(makePayload(9701), { socket: socketA });
        await initHandler(
            makePayload(9702, {
                characterActions: [{ id: 42, ordinal: 0, currentCount: 0 }],
                characterSkills: [{ skillHrid: '/skills/attack', level: 1, experience: 0 }],
                characterItems: [{ id: 1, count: 5, itemLocationHrid: '/item_locations/inventory' }],
            }),
            { socket: socketB }
        );

        webSocketHandlers.get('action_completed')(
            {
                endCharacterAction: { id: 42, isDone: false, ordinal: 0, currentCount: 1 },
                endCharacterItems: [{ id: 1, count: 1, itemLocationHrid: '/item_locations/inventory' }],
                endCharacterSkills: [{ skillHrid: '/skills/attack', level: 50, experience: 99999 }],
                endCharacterAbilities: [{ abilityHrid: '/abilities/poke', level: 50, experience: 1 }],
            },
            { socket: socketA }
        );

        expect(dataManager.characterItems.find((i) => i.id === 1).count).toBe(5);
        expect(dataManager.characterSkills.find((s) => s.skillHrid === '/skills/attack').level).toBe(1);
        expect(dataManager.characterData.characterAbilities).toBeUndefined();
        expect(dataManager.characterActions.find((a) => a.id === 42).currentCount).toBe(0);
    });

    test('a same-character reconnect on a new socket makes the old socket stale even though the character id is unchanged', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socket1 = {};
        const socket2 = {};

        await initHandler(makePayload(9801), { socket: socket1 });
        // Reconnect: same character, brand-new socket.
        await initHandler(makePayload(9801), { socket: socket2 });

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/old_socket', level: 9 } } },
            { socket: socket1 }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/old_socket')).toBe(0);

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/new_socket', level: 4 } } },
            { socket: socket2 }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/new_socket')).toBe(4);
    });

    test('an invalid init_character_data payload cannot steal socket ownership', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socketGood = {};
        const socketBad = {};

        await initHandler(makePayload(9901), { socket: socketGood });
        const generationBefore = dataManager.initGeneration;

        await initHandler({ character: { id: null, name: null } }, { socket: socketBad });

        expect(dataManager.activeSocket).toBe(socketGood);
        expect(dataManager.initGeneration).toBe(generationBefore);

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/bad', level: 1 } } },
            { socket: socketBad }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/bad')).toBe(0);
    });

    test('a rejected rapid-fire character switch cannot steal socket ownership', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socketA = {};
        const socketB = {};
        const socketRapid = {};

        vi.setSystemTime(0);
        await initHandler(makePayload(10001), { socket: socketA }); // first load, no rapid-switch check applies

        vi.setSystemTime(100);
        await initHandler(makePayload(10002), { socket: socketB }); // legitimate switch, accepted
        const generationAfterB = dataManager.initGeneration;

        vi.setSystemTime(200); // 100ms after the accepted switch — inside the 1s loop-protection window
        await initHandler(makePayload(10003), { socket: socketRapid }); // must be rejected

        expect(dataManager.currentCharacterId).toBe(10002);
        expect(dataManager.activeSocket).toBe(socketB);
        expect(dataManager.initGeneration).toBe(generationAfterB);

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/rapid', level: 1 } } },
            { socket: socketRapid }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/rapid')).toBe(0);

        webSocketHandlers.get('house_rooms_updated')(
            { characterHouseRoomMap: { r: { houseRoomHrid: '/house_rooms/b', level: 7 } } },
            { socket: socketB }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/b')).toBe(7);
    });

    test('loot_opened is emitted with the accepted character id only when it arrives on the active socket', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const lootHandler = webSocketHandlers.get('loot_opened');
        const socketA = {};
        const socketB = {};
        const listener = vi.fn();
        dataManager.on('loot_opened', listener);

        await initHandler(makePayload(11001), { socket: socketA });
        await initHandler(makePayload(11002), { socket: socketB });

        // OWN-1: A accepted -> B accepted -> delayed A loot_opened must be ignored.
        lootHandler({ openedItem: { itemHrid: '/items/chest', count: 1 } }, { socket: socketA });
        expect(listener).not.toHaveBeenCalled();

        // B's own opening is accepted and carries B's character id.
        lootHandler({ openedItem: { itemHrid: '/items/chest', count: 1 } }, { socket: socketB });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].characterId).toBe(11002);
        expect(listener.mock.calls[0][0].data.openedItem.itemHrid).toBe('/items/chest');

        dataManager.off('loot_opened', listener);
    });

    test('OWN-2: a same-character reconnect to a new socket makes the old socket stale for loot_opened too', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const lootHandler = webSocketHandlers.get('loot_opened');
        const socket1 = {};
        const socket2 = {};
        const listener = vi.fn();
        dataManager.on('loot_opened', listener);

        await initHandler(makePayload(11101), { socket: socket1 });
        await initHandler(makePayload(11101), { socket: socket2 }); // same character, new socket

        lootHandler({ openedItem: { itemHrid: '/items/crate', count: 1 } }, { socket: socket1 });
        expect(listener).not.toHaveBeenCalled();

        lootHandler({ openedItem: { itemHrid: '/items/crate', count: 1 } }, { socket: socket2 });
        expect(listener).toHaveBeenCalledTimes(1);

        dataManager.off('loot_opened', listener);
    });

    test('loot_opened is delivered synchronously (critical dispatch) so it cannot be lost to a following character_switching cleanup', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const lootHandler = webSocketHandlers.get('loot_opened');
        const socketA = {};
        const listener = vi.fn();
        dataManager.on('loot_opened', listener);

        await initHandler(makePayload(11201), { socket: socketA });
        lootHandler({ openedItem: { itemHrid: '/items/chest', count: 1 } }, { socket: socketA });

        // No need to flush timers: a critical/synchronous event must already be delivered.
        expect(listener).toHaveBeenCalledTimes(1);

        dataManager.off('loot_opened', listener);
    });

    test('loot_opened is ignored before any character is accepted', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const lootHandler = webSocketHandlers.get('loot_opened');
        const listener = vi.fn();
        dataManager.on('loot_opened', listener);

        lootHandler({ openedItem: { itemHrid: '/items/chest', count: 1 } }, { socket: {} });

        expect(listener).not.toHaveBeenCalled();
        dataManager.off('loot_opened', listener);
    });
});

describe('DataManager offline-progress cap / MooPass getters', () => {
    test('returns null before any character data has loaded (fails closed, no guessed default)', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.characterData = null;

        expect(dataManager.getOfflineHourCap()).toBeNull();
        expect(dataManager.getMooPassExpireTime()).toBeNull();
    });

    test('reads the exact server-resolved values, never reconstructed from purchases', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.characterData = { characterInfo: { offlineHourCap: 14, mooPassExpireTime: 1234567890 } };

        expect(dataManager.getOfflineHourCap()).toBe(14);
        expect(dataManager.getMooPassExpireTime()).toBe(1234567890);
    });

    test('returns null for mooPassExpireTime when the character has no MooPass', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.characterData = { characterInfo: { offlineHourCap: 10 } };

        expect(dataManager.getMooPassExpireTime()).toBeNull();
    });

    test('character_info_updated refreshes both getters with the new values', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.characterData = { characterInfo: { offlineHourCap: 10, mooPassExpireTime: null } };
        dataManager.activeSocket = null; // isolate from other tests' socket-ownership state in this shared singleton

        webSocketHandlers.get('character_info_updated')({
            characterInfo: { offlineHourCap: 15, mooPassExpireTime: 5000 },
        });

        expect(dataManager.getOfflineHourCap()).toBe(15);
        expect(dataManager.getMooPassExpireTime()).toBe(5000);
    });
});

describe('DataManager live buff WebSocket state parity (TLA-028)', () => {
    function makeCharacterPayload(characterId, overrides = {}) {
        return {
            character: { id: characterId, name: `char-${characterId}` },
            characterActions: [],
            characterSkills: [],
            characterItems: [],
            characterQuests: [],
            characterHouseRoomMap: {},
            actionTypeDrinkSlotsMap: {},
            characterGuildBuffMap: {},
            guildBuildingLevelMap: {},
            achievementActionTypeBuffsMap: {},
            mooPassBuffs: [],
            mooPassActionTypeBuffsMap: {},
            communityBuffs: [],
            communityActionTypeBuffsMap: {},
            consumableActionTypeBuffsMap: {},
            equipmentActionTypeBuffsMap: {},
            equipmentTaskActionBuffs: {},
            personalActionTypeBuffsMap: {},
            characterBuffs: [],
            guildActionTypeBuffsMap: {},
            ...overrides,
        };
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { default: dataManager } = await import('./data-manager.js');
        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
        dataManager.characterData = null;
        dataManager.characterItems = null;
        dataManager.characterSkills = null;
        dataManager.characterActions = [];
        dataManager.characterQuests = [];
        dataManager.characterHouseRooms.clear();
        dataManager.actionTypeDrinkSlotsMap.clear();
        dataManager.personalActionTypeBuffsMap = {};
        dataManager.characterGuildBuffMap = {};
        dataManager.guildBuildingLevelMap = {};
        dataManager.activeSocket = null;
        dataManager.initGeneration = 0;
        dataManager.achievementBuffCache = { source: null, byActionType: new Map() };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('mirrors the native replacement contract for the full live buff-state family before emitting semantic events', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const socket = {};
        await webSocketHandlers.get('init_character_data')(makeCharacterPayload(12001), { socket });

        const genericListener = vi.fn();
        dataManager.on('buffs_updated', genericListener);

        const houseRooms = { room: { houseRoomHrid: '/house_rooms/log_shed', level: 4 } };
        const houseBuffs = { '/action_types/woodcutting': [{ typeHrid: '/buff_types/efficiency', flatBoost: 0.06 }] };
        webSocketHandlers.get('house_rooms_updated')(
            {
                type: 'house_rooms_updated',
                characterHouseRoomMap: houseRooms,
                houseActionTypeBuffsMap: houseBuffs,
            },
            { socket }
        );
        expect(dataManager.getHouseRoomLevel('/house_rooms/log_shed')).toBe(4);
        expect(dataManager.characterData.characterHouseRoomMap).toBe(houseRooms);
        expect(dataManager.characterData.houseActionTypeBuffsMap).toBe(houseBuffs);

        const achievementBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.03 }],
        };
        webSocketHandlers.get('achievement_buffs_updated')(
            { type: 'achievement_buffs_updated', achievementActionTypeBuffsMap: achievementBuffs },
            { socket }
        );
        expect(dataManager.characterData.achievementActionTypeBuffsMap).toBe(achievementBuffs);
        expect(dataManager.getAchievementBuffFlatBoost('/action_types/woodcutting', '/buff_types/wisdom')).toBe(0.03);

        const mooPassBuffs = [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05 }];
        const mooPassActionBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.05 }],
        };
        webSocketHandlers.get('moo_pass_buffs_updated')(
            {
                type: 'moo_pass_buffs_updated',
                mooPassBuffs,
                mooPassActionTypeBuffsMap: mooPassActionBuffs,
            },
            { socket }
        );
        expect(dataManager.characterData.mooPassBuffs).toBe(mooPassBuffs);
        expect(dataManager.characterData.mooPassActionTypeBuffsMap).toBe(mooPassActionBuffs);
        expect(dataManager.getMooPassBuffs()).toBe(mooPassBuffs);

        const communityBuffs = [{ hrid: '/community_buff_types/gathering_quantity', level: 20 }];
        const communityActionBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/gathering', flatBoost: 0.295 }],
        };
        webSocketHandlers.get('community_buffs_updated')(
            {
                type: 'community_buffs_updated',
                communityBuffs,
                communityActionTypeBuffsMap: communityActionBuffs,
            },
            { socket }
        );
        expect(dataManager.characterData.communityBuffs).toBe(communityBuffs);
        expect(dataManager.characterData.communityActionTypeBuffsMap).toBe(communityActionBuffs);
        expect(dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity')).toBe(20);

        const consumableBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/efficiency', flatBoost: 0.1 }],
        };
        webSocketHandlers.get('consumable_buffs_updated')(
            { type: 'consumable_buffs_updated', consumableActionTypeBuffsMap: consumableBuffs },
            { socket }
        );
        expect(dataManager.characterData.consumableActionTypeBuffsMap).toBe(consumableBuffs);

        const equipmentBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/action_speed', flatBoost: 0.84 }],
        };
        const equipmentTaskBuffs = {
            '/actions/woodcutting/arcane_tree': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.01 }],
        };
        webSocketHandlers.get('equipment_buffs_updated')(
            {
                type: 'equipment_buffs_updated',
                equipmentActionTypeBuffsMap: equipmentBuffs,
                equipmentTaskActionBuffs: equipmentTaskBuffs,
            },
            { socket }
        );
        expect(dataManager.characterData.equipmentActionTypeBuffsMap).toBe(equipmentBuffs);
        expect(dataManager.characterData.equipmentTaskActionBuffs).toBe(equipmentTaskBuffs);

        const personalBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/efficiency', flatBoost: 0.07 }],
        };
        const characterBuffs = [{ typeHrid: '/buff_types/efficiency', flatBoost: 0.07 }];
        webSocketHandlers.get('personal_buffs_updated')(
            {
                type: 'personal_buffs_updated',
                personalActionTypeBuffsMap: personalBuffs,
                characterBuffs,
            },
            { socket }
        );
        expect(dataManager.personalActionTypeBuffsMap).toBe(personalBuffs);
        expect(dataManager.characterData.personalActionTypeBuffsMap).toBe(personalBuffs);
        expect(dataManager.characterData.characterBuffs).toBe(characterBuffs);
        expect(dataManager.getPersonalBuffFlatBoost('/action_types/woodcutting', '/buff_types/efficiency')).toBe(0.07);

        const characterGuildBuffs = { '/guild_buffs/woodcutting_speed': { level: 2 } };
        const guildActionBuffs = {
            '/action_types/woodcutting': [{ typeHrid: '/buff_types/action_speed', flatBoost: 0.02 }],
        };
        webSocketHandlers.get('guild_buffs_updated')(
            {
                type: 'guild_buffs_updated',
                characterGuildBuffMap: characterGuildBuffs,
                guildActionTypeBuffsMap: guildActionBuffs,
            },
            { socket }
        );
        expect(dataManager.characterGuildBuffMap).toBe(characterGuildBuffs);
        expect(dataManager.characterData.characterGuildBuffMap).toBe(characterGuildBuffs);
        expect(dataManager.characterData.guildActionTypeBuffsMap).toBe(guildActionBuffs);
        expect(dataManager.getCharacterGuildBuffLevel('/guild_buffs/woodcutting_speed')).toBe(2);

        await vi.advanceTimersByTimeAsync(0);
        expect(genericListener).toHaveBeenCalledTimes(8);
        expect(genericListener.mock.calls.map(([payload]) => payload.type)).toEqual([
            'house_rooms_updated',
            'achievement_buffs_updated',
            'moo_pass_buffs_updated',
            'community_buffs_updated',
            'consumable_buffs_updated',
            'equipment_buffs_updated',
            'personal_buffs_updated',
            'guild_buffs_updated',
        ]);

        dataManager.off('buffs_updated', genericListener);
    });

    test('replacement payloads clear old canonical buff state instead of merging it - empty {}/[] are meaningful, not ignored', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const socket = {};
        await webSocketHandlers.get('init_character_data')(
            makeCharacterPayload(12002, {
                achievementActionTypeBuffsMap: {
                    '/action_types/woodcutting': [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.2 }],
                },
                communityBuffs: [{ hrid: '/community_buff_types/experience', level: 10 }],
                communityActionTypeBuffsMap: { stale: [{ typeHrid: '/buff_types/wisdom', flatBoost: 0.1 }] },
                characterGuildBuffMap: { stale: { level: 9 } },
                guildActionTypeBuffsMap: { stale: [{ typeHrid: '/buff_types/action_speed', flatBoost: 0.9 }] },
            }),
            { socket }
        );

        // Prime the achievement cache against the old source object.
        expect(dataManager.getAchievementBuffFlatBoost('/action_types/woodcutting', '/buff_types/wisdom')).toBe(0.2);

        webSocketHandlers.get('achievement_buffs_updated')(
            { type: 'achievement_buffs_updated', achievementActionTypeBuffsMap: {} },
            { socket }
        );
        webSocketHandlers.get('community_buffs_updated')(
            { type: 'community_buffs_updated', communityBuffs: [], communityActionTypeBuffsMap: {} },
            { socket }
        );
        webSocketHandlers.get('guild_buffs_updated')(
            { type: 'guild_buffs_updated', characterGuildBuffMap: {}, guildActionTypeBuffsMap: {} },
            { socket }
        );

        expect(dataManager.characterData.achievementActionTypeBuffsMap).toEqual({});
        expect(dataManager.getAchievementBuffFlatBoost('/action_types/woodcutting', '/buff_types/wisdom')).toBe(0);
        expect(dataManager.characterData.communityBuffs).toEqual([]);
        expect(dataManager.characterData.communityActionTypeBuffsMap).toEqual({});
        expect(dataManager.characterGuildBuffMap).toEqual({});
        expect(dataManager.characterData.characterGuildBuffMap).toEqual({});
        expect(dataManager.characterData.guildActionTypeBuffsMap).toEqual({});
    });

    test('guild_updated refreshes the shrine building unlocked cap live, not just at init', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const socket = {};
        await webSocketHandlers.get('init_character_data')(
            makeCharacterPayload(12004, { guildBuildingLevelMap: { '/guild_shrines/force': 4 } }),
            { socket }
        );
        expect(dataManager.getGuildBuildingLevel('/guild_shrines/force')).toBe(4);

        // Simulates switching to a guild with different shrine levels mid-session, without a page
        // reload - before this handler existed, guildBuildingLevelMap had no live listener at all
        // and would have stayed frozen at the old guild's value indefinitely.
        const newGuildBuildingLevels = { '/guild_shrines/force': 1, '/guild_shrines/tempo': 2 };
        webSocketHandlers.get('guild_updated')(
            { type: 'guild_updated', guildBuildingLevelMap: newGuildBuildingLevels },
            { socket }
        );

        expect(dataManager.getGuildBuildingLevel('/guild_shrines/force')).toBe(1);
        expect(dataManager.getGuildBuildingLevel('/guild_shrines/tempo')).toBe(2);
        expect(dataManager.characterData.guildBuildingLevelMap).toBe(newGuildBuildingLevels);
    });

    test('TLA-018: stale-socket buff updates cannot overwrite the active character; same-character reconnect makes the old socket stale', async () => {
        const { default: dataManager } = await import('./data-manager.js');
        const initHandler = webSocketHandlers.get('init_character_data');
        const socketOld = {};
        const socketNew = {};

        await initHandler(makeCharacterPayload(12003), { socket: socketOld });
        await initHandler(makeCharacterPayload(12003), { socket: socketNew });

        webSocketHandlers.get('community_buffs_updated')(
            {
                type: 'community_buffs_updated',
                communityBuffs: [{ hrid: '/community_buff_types/experience', level: 99 }],
                communityActionTypeBuffsMap: { stale: [] },
            },
            { socket: socketOld }
        );
        webSocketHandlers.get('guild_buffs_updated')(
            {
                type: 'guild_buffs_updated',
                characterGuildBuffMap: { stale: { level: 99 } },
                guildActionTypeBuffsMap: { stale: [] },
            },
            { socket: socketOld }
        );
        webSocketHandlers.get('guild_updated')(
            { type: 'guild_updated', guildBuildingLevelMap: { stale: 99 } },
            { socket: socketOld }
        );
        webSocketHandlers.get('personal_buffs_updated')(
            {
                type: 'personal_buffs_updated',
                personalActionTypeBuffsMap: { stale: [] },
                characterBuffs: [{ typeHrid: '/buff_types/wisdom', flatBoost: 9 }],
            },
            { socket: socketOld }
        );

        expect(dataManager.characterData.communityBuffs).toEqual([]);
        expect(dataManager.characterGuildBuffMap).toEqual({});
        expect(dataManager.guildBuildingLevelMap).toEqual({});
        expect(dataManager.personalActionTypeBuffsMap).toEqual({});

        const currentCommunity = [{ hrid: '/community_buff_types/experience', level: 12 }];
        webSocketHandlers.get('community_buffs_updated')(
            {
                type: 'community_buffs_updated',
                communityBuffs: currentCommunity,
                communityActionTypeBuffsMap: { current: [] },
            },
            { socket: socketNew }
        );
        expect(dataManager.characterData.communityBuffs).toBe(currentCommunity);
    });
});
