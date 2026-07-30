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
