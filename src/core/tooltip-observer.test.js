import { beforeEach, describe, expect, test, vi } from 'vitest';

const unregisterObserver = vi.fn();
const domObserverMock = {
    onClass: vi.fn(() => unregisterObserver),
};

vi.mock('./dom-observer.js', () => ({ default: domObserverMock }));

class FakeMutationObserver {
    static instances = [];

    constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        FakeMutationObserver.instances.push(this);
    }
}

describe('TooltipObserver', () => {
    let tooltipObserver;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        FakeMutationObserver.instances = [];
        globalThis.MutationObserver = FakeMutationObserver;
        globalThis.document = { body: {} };

        const mod = await import('./tooltip-observer.js');
        tooltipObserver = mod.default;
        tooltipObserver.disable();
        unregisterObserver.mockClear();
        domObserverMock.onClass.mockClear();
    });

    test('does not allocate a per-tooltip observer for open-only subscribers', () => {
        const callback = vi.fn();
        const tooltip = { isConnected: true, parentNode: {} };

        tooltipObserver.subscribe('open-only', callback);
        tooltipObserver.notifySubscribers(tooltip);

        expect(callback).toHaveBeenCalledWith(tooltip, 'opened');
        expect(FakeMutationObserver.instances).toHaveLength(0);
    });

    test('tracks and disconnects close observers only when explicitly requested', () => {
        const callback = vi.fn();
        const tooltip = { isConnected: true, parentNode: {} };

        tooltipObserver.subscribe('with-close', callback, { notifyClose: true });
        tooltipObserver.notifySubscribers(tooltip);

        expect(FakeMutationObserver.instances).toHaveLength(1);
        const observer = FakeMutationObserver.instances[0];
        expect(observer.observe).toHaveBeenCalledWith(document.body, {
            childList: true,
            subtree: true,
        });

        tooltip.isConnected = false;
        observer.callback();

        expect(callback).toHaveBeenCalledWith(tooltip, 'closed');
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(tooltipObserver.activeRemovalObservers.size).toBe(0);
    });

    test('unsubscribing the final subscriber tears down the central observer', () => {
        tooltipObserver.subscribe('only-subscriber', vi.fn());

        tooltipObserver.unsubscribe('only-subscriber');

        expect(unregisterObserver).toHaveBeenCalledTimes(1);
        expect(tooltipObserver.isInitialized).toBe(false);
        expect(tooltipObserver.subscribers.size).toBe(0);
    });
});
