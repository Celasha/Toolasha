/**
 * Tests for WebSocket hook listener semantics
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('./storage.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('./profile-manager.js', () => ({ setCurrentProfile: vi.fn() }));

// Minimal EventTarget-backed fake WebSocket
function makeFakeWebSocket(url = 'wss://api.milkywayidle.com/ws') {
    const target = new EventTarget();
    return {
        url,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target),
    };
}

function makeMessageEvent(data) {
    return Object.assign(new Event('message'), { data });
}

describe('WebSocket hook — native listener semantics preserved', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    test('add then remove: listener does not fire after removal', () => {
        const socket = makeFakeWebSocket();
        const cb = vi.fn();

        socket.addEventListener('message', cb);
        socket.removeEventListener('message', cb);
        socket.dispatchEvent(makeMessageEvent('{}'));

        expect(cb).not.toHaveBeenCalled();
    });

    test('adding the same listener twice fires it only once', () => {
        const socket = makeFakeWebSocket();
        const cb = vi.fn();

        socket.addEventListener('message', cb);
        socket.addEventListener('message', cb);
        socket.dispatchEvent(makeMessageEvent('{}'));

        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('non-MWI socket message does not reach processMessage', () => {
        const socket = makeFakeWebSocket('wss://unrelated.example.com/ws');
        const spy = vi.spyOn(webSocketHook, 'processMessage');

        socket.addEventListener('message', () => {});
        socket.dispatchEvent(makeMessageEvent('{"type":"test"}'));

        expect(spy).not.toHaveBeenCalled();
    });
});

describe('WebSocket hook — dispatch snapshots', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    test('all message handlers run when earlier handlers unregister during dispatch', () => {
        const calls = [];
        const first = () => {
            calls.push('first');
            webSocketHook.off('snapshot_dispatch', first);
        };
        const second = () => {
            calls.push('second');
            webSocketHook.off('snapshot_dispatch', second);
        };
        const third = () => calls.push('third');

        webSocketHook.on('snapshot_dispatch', first);
        webSocketHook.on('snapshot_dispatch', second);
        webSocketHook.on('snapshot_dispatch', third);
        webSocketHook.processMessage(JSON.stringify({ type: 'snapshot_dispatch', value: 1 }));

        expect(calls).toEqual(['first', 'second', 'third']);
    });

    test('all socket lifecycle handlers run when an earlier handler unregisters', () => {
        const calls = [];
        const first = () => {
            calls.push('first');
            webSocketHook.offSocketEvent('snapshot_open', first);
        };
        const second = () => calls.push('second');

        webSocketHook.onSocketEvent('snapshot_open', first);
        webSocketHook.onSocketEvent('snapshot_open', second);
        webSocketHook.emitSocketEvent('snapshot_open', {}, {});

        expect(calls).toEqual(['first', 'second']);
    });

    test('message handlers receive the originating socket as dispatch context', () => {
        const socket = makeFakeWebSocket();
        const handler = vi.fn();
        webSocketHook.on('socket_context', handler);

        webSocketHook.processMessage(JSON.stringify({ type: 'socket_context', value: 1 }), socket);

        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'socket_context', value: 1 }), { socket });
    });

    test('content-hash deduplication is scoped per socket', () => {
        const socketA = makeFakeWebSocket();
        const socketB = makeFakeWebSocket();
        const handler = vi.fn();
        webSocketHook.on('socket_dedup', handler);

        const prefix = 'x'.repeat(150);
        const first = JSON.stringify({ type: 'socket_dedup', prefix, value: 1 });
        const second = JSON.stringify({ type: 'socket_dedup', prefix, value: 2 });
        expect(first.substring(0, 100)).toBe(second.substring(0, 100));

        webSocketHook.processMessage(first, socketA);
        webSocketHook.processMessage(second, socketB);

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0].value).toBe(2);
    });
});

describe('WebSocket hook — guild_updated must not be dropped by content-hash dedup', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    // A real guild_updated payload's `id`/`name` alone fill the first 100 raw chars, so two
    // consecutive updates that differ only in `experience` (further into the object) hash
    // identically under the dedup-by-first-100-chars optimization — unless guild_updated is
    // exempted the same way leaderboard_updated/labyrinth_updated/etc. already are.
    function guildUpdatedMessage(experience) {
        const guild = {
            id: 'b6f1a2e4-8c3d-4a11-9f2b-7d5e6a8c9b10',
            name: 'The Testers Guild',
            level: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
            guildType: 'standard',
            currentWeekStartAt: '2026-08-01T00:00:00.000Z',
            experience,
        };
        return JSON.stringify({ type: 'guild_updated', guild });
    }

    test('a second guild_updated with a colliding 100-char hash still reaches handlers', () => {
        const handler = vi.fn();
        webSocketHook.on('guild_updated', handler);

        webSocketHook.processMessage(guildUpdatedMessage(2000));
        webSocketHook.processMessage(guildUpdatedMessage(2500));

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0].guild.experience).toBe(2500);
    });
});

describe('WebSocket hook — loot_opened dedup (OA-1)', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    // A real loot_opened payload's `openedItem` alone can fill the first 100 raw chars, so two
    // genuine consecutive openings of the same container that differ only in `gainedItems`
    // (further into the object) would hash identically under the lossy first-100-char dedup.
    function lootOpenedMessage(gainedItemCount) {
        const openedItem = { itemHrid: '/items/chimerical_chest', enhancementLevel: 0, count: 1 };
        return JSON.stringify({
            type: 'loot_opened',
            openedItem,
            gainedItems: [{ itemHrid: '/items/coin', enhancementLevel: 0, count: gainedItemCount }],
            grantedBuffs: [],
        });
    }

    test('DEDUP-1: two same-socket loot_opened messages sharing the first 100 chars but differing later both dispatch', () => {
        const handler = vi.fn();
        webSocketHook.on('loot_opened', handler);
        const socket = makeFakeWebSocket();

        const first = lootOpenedMessage(100);
        const second = lootOpenedMessage(200);
        expect(first.substring(0, 100)).toBe(second.substring(0, 100));

        webSocketHook.processMessage(first, socket);
        webSocketHook.processMessage(second, socket);

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0].gainedItems[0].count).toBe(200);
    });

    test('DEDUP-2: an exact duplicate interception of the same physical message collapses to one dispatch', () => {
        const handler = vi.fn();
        webSocketHook.on('loot_opened', handler);
        const socket = makeFakeWebSocket();
        const message = lootOpenedMessage(100);

        webSocketHook.processMessage(message, socket);
        webSocketHook.processMessage(message, socket);

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('DEDUP-3: the same raw content on a newly accepted socket is not suppressed by an old socket’s dedup state', () => {
        const handler = vi.fn();
        webSocketHook.on('loot_opened', handler);
        const socketA = makeFakeWebSocket();
        const socketB = makeFakeWebSocket();
        const message = lootOpenedMessage(100);

        webSocketHook.processMessage(message, socketA);
        webSocketHook.processMessage(message, socketB);

        expect(handler).toHaveBeenCalledTimes(2);
    });
});

describe('WebSocket hook — same-event double dispatch via attachSocketListeners (labyrinth Apply Skip regression)', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    // The real page also intercepts messages via a MessageEvent.prototype.data getter override
    // (installed by install(), not exercised in this fake-socket harness). Reading event.data
    // inside attachSocketListeners's own message listener can trigger that getter first, which
    // itself marks-and-processes the event before this listener reaches its own processMessage
    // call. Simulate that getter's side effect directly on a plain event so the listener's
    // ordering bug (or its fix) is exercised without mutating the real MessageEvent prototype.
    function messageEventWithSelfProcessingGetter(message, socket) {
        const event = new Event('message');
        Object.defineProperty(event, 'data', {
            configurable: true,
            get() {
                if (!webSocketHook.isMessageEventProcessed(event)) {
                    webSocketHook.markMessageEventProcessed(event);
                    webSocketHook.processMessage(message, socket);
                }
                return message;
            },
        });
        return event;
    }

    test('setting_updated is not dispatched twice when reading event.data itself already processed the message', () => {
        const handler = vi.fn();
        webSocketHook.on('setting_updated', handler);
        const socket = makeFakeWebSocket();
        webSocketHook.attachSocketListeners(socket);

        const message = JSON.stringify({ type: 'setting_updated', characterSetting: { labyrinthSkipMilking: 15 } });
        socket.dispatchEvent(messageEventWithSelfProcessingGetter(message, socket));

        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('WebSocket hook — live buff-state messages must not be dropped by prefix dedup (TLA-028)', () => {
    let webSocketHook;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('./websocket.js');
        webSocketHook = mod.default;
    });

    const cases = [
        ['house_rooms_updated', 'houseActionTypeBuffsMap'],
        ['achievement_buffs_updated', 'achievementActionTypeBuffsMap'],
        ['moo_pass_buffs_updated', 'mooPassActionTypeBuffsMap'],
        ['community_buffs_updated', 'communityActionTypeBuffsMap'],
        ['consumable_buffs_updated', 'consumableActionTypeBuffsMap'],
        ['equipment_buffs_updated', 'equipmentActionTypeBuffsMap'],
        ['personal_buffs_updated', 'personalActionTypeBuffsMap'],
        ['guild_buffs_updated', 'guildActionTypeBuffsMap'],
    ];

    function collidingMessage(type, mapField, flatBoost) {
        const actionType = '/action_types/woodcutting';
        return JSON.stringify({
            type,
            [mapField]: {
                [actionType]: [
                    {
                        typeHrid:
                            '/buff_types/this_intentionally_long_buff_type_name_keeps_the_changed_value_past_100_chars',
                        flatBoost,
                    },
                ],
            },
        });
    }

    test.each(cases)(
        '%s dispatches both genuine consecutive states even when their first 100 chars collide',
        (type, mapField) => {
            const handler = vi.fn();
            webSocketHook.on(type, handler);

            const first = collidingMessage(type, mapField, 0.1);
            const second = collidingMessage(type, mapField, 0.2);
            expect(first.substring(0, 100)).toBe(second.substring(0, 100));

            webSocketHook.processMessage(first);
            webSocketHook.processMessage(second);

            expect(handler).toHaveBeenCalledTimes(2);
            expect(handler.mock.calls[1][0][mapField]['/action_types/woodcutting'][0].flatBoost).toBe(0.2);
        }
    );
});
