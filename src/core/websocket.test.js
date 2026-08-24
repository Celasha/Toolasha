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
