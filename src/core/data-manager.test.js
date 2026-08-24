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
