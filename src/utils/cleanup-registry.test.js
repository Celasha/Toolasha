/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';
import { createCleanupRegistry } from './cleanup-registry.js';

describe('createCleanupRegistry — per-registration unregister', () => {
    test('registerListener returns an unregister that removes the listener and only itself', () => {
        const registry = createCleanupRegistry();
        const target = document.createElement('div');
        const handler = vi.fn();

        const unregister = registry.registerListener(target, 'click', handler);
        target.dispatchEvent(new Event('click'));
        expect(handler).toHaveBeenCalledTimes(1);

        unregister();
        target.dispatchEvent(new Event('click'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('registerObserver returns an unregister that disconnects only that observer', () => {
        const registry = createCleanupRegistry();
        const observerA = { disconnect: vi.fn() };
        const observerB = { disconnect: vi.fn() };

        registry.registerObserver(observerA);
        const unregisterB = registry.registerObserver(observerB);

        unregisterB();
        expect(observerB.disconnect).toHaveBeenCalledTimes(1);
        expect(observerA.disconnect).not.toHaveBeenCalled();

        registry.cleanupAll();
        expect(observerA.disconnect).toHaveBeenCalledTimes(1);
        // Already-unregistered observer must not be disconnected a second time by cleanupAll
        expect(observerB.disconnect).toHaveBeenCalledTimes(1);
    });

    test('registerCleanup returns an unregister that runs only that cleanup function', () => {
        const registry = createCleanupRegistry();
        const cleanupA = vi.fn();
        const cleanupB = vi.fn();

        registry.registerCleanup(cleanupA);
        const unregisterB = registry.registerCleanup(cleanupB);

        unregisterB();
        expect(cleanupB).toHaveBeenCalledTimes(1);
        expect(cleanupA).not.toHaveBeenCalled();

        registry.cleanupAll();
        expect(cleanupA).toHaveBeenCalledTimes(1);
        expect(cleanupB).toHaveBeenCalledTimes(1);
    });

    test('registerTimeout/registerInterval unregister clears only that timer', () => {
        vi.useFakeTimers();
        const registry = createCleanupRegistry();
        const fnA = vi.fn();
        const fnB = vi.fn();

        const timeoutA = setTimeout(fnA, 1000);
        const timeoutB = setTimeout(fnB, 1000);
        registry.registerTimeout(timeoutA);
        const unregisterB = registry.registerTimeout(timeoutB);

        unregisterB();
        vi.advanceTimersByTime(1000);

        expect(fnA).toHaveBeenCalledTimes(1);
        expect(fnB).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    test('calling an unregister function after cleanupAll is a safe no-op', () => {
        const registry = createCleanupRegistry();
        const observer = { disconnect: vi.fn() };
        const unregister = registry.registerObserver(observer);

        registry.cleanupAll();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);

        expect(() => unregister()).not.toThrow();
        expect(observer.disconnect).toHaveBeenCalledTimes(2); // disconnect is idempotent; harmless
    });

    test('invalid registerListener arguments return a no-op unregister instead of throwing', () => {
        const registry = createCleanupRegistry();
        const unregister = registry.registerListener(null, 'click', vi.fn());
        expect(() => unregister()).not.toThrow();
    });
});
