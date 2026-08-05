/**
 * Tests for DOMObserver debounce behavior
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/performance-monitor.js', () => ({
    default: { enabled: false, record: vi.fn() },
}));

describe('DOMObserver debounce', () => {
    let domObserver;

    beforeEach(async () => {
        vi.useFakeTimers();
        // Re-import fresh instance each test
        vi.resetModules();
        const mod = await import('./dom-observer.js');
        domObserver = mod.default;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('retains O(1) state under 100,000 continuous events', () => {
        const nodes = [];
        for (let i = 0; i < 100000; i++) {
            nodes.push({ id: i });
        }

        const handler = { name: 'test-handler', debounce: true, debounceDelay: 50 };

        for (const node of nodes) {
            domObserver.debouncedCallback(handler, node, {});
        }

        // Only one entry retained, not 100,000
        expect(domObserver.debouncedLatest.size).toBe(1);
        expect(domObserver.debounceTimers.size).toBe(1);
    });

    test('callback receives the latest node when timer fires', () => {
        const callback = vi.fn();
        const handler = { name: 'test-latest', debounce: true, debounceDelay: 50, callback };

        const first = { id: 'first' };
        const last = { id: 'last' };

        domObserver.debouncedCallback(handler, first, { type: 'childList' });
        domObserver.debouncedCallback(handler, last, { type: 'childList' });

        vi.runAllTimers();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(last, { type: 'childList' });
    });

    test('two handlers maintain independent latest values', () => {
        const cbA = vi.fn();
        const cbB = vi.fn();
        const handlerA = { name: 'handler-a', debounce: true, debounceDelay: 50, callback: cbA };
        const handlerB = { name: 'handler-b', debounce: true, debounceDelay: 50, callback: cbB };

        const nodeA = { id: 'a' };
        const nodeB = { id: 'b' };

        domObserver.debouncedCallback(handlerA, nodeA, {});
        domObserver.debouncedCallback(handlerB, nodeB, {});

        vi.runAllTimers();

        expect(cbA).toHaveBeenCalledWith(nodeA, {});
        expect(cbB).toHaveBeenCalledWith(nodeB, {});
    });

    test('unregistering before timer fires cancels callback and clears state', async () => {
        const callback = vi.fn();
        const node = { id: 'x' };

        const unregister = domObserver.register('cancel-test', callback, { debounce: true, debounceDelay: 50 });

        // Simulate a debounced event by calling debouncedCallback directly
        const handler = domObserver.handlers.find((h) => h.name === 'cancel-test');
        domObserver.debouncedCallback(handler, node, {});

        unregister();

        vi.runAllTimers();

        expect(callback).not.toHaveBeenCalled();
        expect(domObserver.debouncedLatest.has(handler)).toBe(false);
        expect(domObserver.debounceTimers.has(handler)).toBe(false);
    });

    test('same-named handlers maintain independent debounce state', () => {
        const cbA = vi.fn();
        const cbB = vi.fn();
        const handlerA = { name: 'shared-name', debounce: true, debounceDelay: 50, callback: cbA };
        const handlerB = { name: 'shared-name', debounce: true, debounceDelay: 50, callback: cbB };

        domObserver.debouncedCallback(handlerA, { id: 'a' }, {});
        domObserver.debouncedCallback(handlerB, { id: 'b' }, {});

        expect(domObserver.debounceTimers.size).toBe(2);
        expect(domObserver.debouncedLatest.size).toBe(2);

        vi.runAllTimers();

        expect(cbA).toHaveBeenCalledWith({ id: 'a' }, {});
        expect(cbB).toHaveBeenCalledWith({ id: 'b' }, {});
    });

    test('stop() clears all pending debounce state', () => {
        const handlerA = { name: 'stop-a', debounce: true, debounceDelay: 50, callback: vi.fn() };
        const handlerB = { name: 'stop-b', debounce: true, debounceDelay: 50, callback: vi.fn() };

        domObserver.debouncedCallback(handlerA, {}, {});
        domObserver.debouncedCallback(handlerB, {}, {});

        domObserver.stop();

        expect(domObserver.debounceTimers.size).toBe(0);
        expect(domObserver.debouncedLatest.size).toBe(0);
    });
});
