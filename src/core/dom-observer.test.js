/* @vitest-environment jsdom */
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

describe('DOMObserver readiness lifecycle (TLA-025 reopen)', () => {
    let domObserver;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        const mod = await import('./dom-observer.js');
        domObserver = mod.default;
    });

    afterEach(() => {
        domObserver?.stop();
        vi.useRealTimers();
    });

    test('onReady registered before start is notified once observing actually starts', () => {
        const callback = vi.fn();
        const unregister = domObserver.onReady('late-body-catch-up', callback);

        // Do not depend on mutation delivery: readiness is a distinct lifecycle signal.
        domObserver.start();

        expect(domObserver.isObserving).toBe(true);
        expect(callback).toHaveBeenCalledTimes(1);
        unregister();
    });

    test('onReady registered after observer is active catches up immediately and unregisters cleanly', () => {
        domObserver.start();
        const callback = vi.fn();
        const unregister = domObserver.onReady('already-ready', callback);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(domObserver.getStats().readyHandlerCount).toBe(1);

        unregister();
        expect(domObserver.getStats().readyHandlerCount).toBe(0);
    });
});

describe('DOMObserver handler filter', () => {
    let domObserver;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        const mod = await import('./dom-observer.js');
        domObserver = mod.default;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        domObserver.stop();
        vi.useRealTimers();
    });

    const flush = async () => {
        await Promise.resolve();
        vi.runAllTimers();
    };

    test('only the default instance is exported, since the split libraries see nothing else', async () => {
        const mod = await import('./dom-observer.js');

        expect(Object.keys(mod)).toEqual(['default']);
    });

    test('touchesSelector matches the node, its ancestors and its descendants', () => {
        document.body.innerHTML = '<div class="Outer_x"><p><span class="Inner_y"></span></p></div>';
        const outer = document.querySelector('.Outer_x');
        const inner = document.querySelector('.Inner_y');

        expect(domObserver.touchesSelector(outer, '[class*="Inner_"]')).toBe(true);
        expect(domObserver.touchesSelector(inner, '[class*="Outer_"]')).toBe(true);
        expect(domObserver.touchesSelector(inner, '[class*="Inner_"]')).toBe(true);
        expect(domObserver.touchesSelector(outer, '[class*="Other_"]')).toBe(false);
    });

    test('a filtered handler only fires for relevant nodes, even when an irrelevant one follows in the burst', async () => {
        const callback = vi.fn();
        domObserver.register('filtered', callback, {
            debounce: true,
            debounceDelay: 50,
            filter: (node) => node.classList.contains('wanted'),
        });
        domObserver.start();

        const wanted = document.createElement('div');
        wanted.className = 'wanted';
        const other = document.createElement('div');
        document.body.append(wanted, other);
        await flush();
        await flush();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBe(wanted);
    });

    test('a handler with no filter still gets every added node', async () => {
        const callback = vi.fn();
        domObserver.register('open', callback);
        domObserver.start();

        document.body.append(document.createElement('div'), document.createElement('div'));
        await flush();

        expect(callback).toHaveBeenCalledTimes(2);
    });
});

describe('DOMObserver.onClass', () => {
    let domObserver;
    let performanceMonitor;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        domObserver = (await import('./dom-observer.js')).default;
        performanceMonitor = (await import('../utils/performance-monitor.js')).default;
        document.body.replaceChildren();
    });

    afterEach(() => {
        domObserver.stop();
        performanceMonitor.enabled = false;
        performanceMonitor.record.mockClear();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    test('a root match fires once and skips descendant lookup for that handler', async () => {
        const callback = vi.fn();
        domObserver.onClass('root', ['wanted', 'second'], callback);
        domObserver.start();

        const root = document.createElement('div');
        root.className = 'wanted second';
        root.innerHTML = '<span class="wanted"></span>';
        const walk = vi.spyOn(root, 'getElementsByTagName');
        const query = vi.spyOn(root, 'querySelectorAll');
        document.body.append(root);
        await Promise.resolve();

        expect(callback.mock.calls).toEqual([[root]]);
        expect(walk).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    test('shares a single walk across class handlers, in target order, including SVG descendants', async () => {
        const calls = [];
        domObserver.onClass('root', 'container', (element) => calls.push(['root', element]));
        domObserver.onClass('two-targets', ['target-b', 'target-a'], (element) => calls.push(['two', element]));
        domObserver.register('regular', (element) => calls.push(['regular', element]));
        domObserver.onClass('one-target', 'target-a', (element) => calls.push(['one', element]));
        domObserver.start();

        const root = document.createElement('div');
        root.className = 'container';
        root.innerHTML = `
            <span class="container target-a"></span>
            <svg><g class="target-b"></g></svg>
            <span class="target-a target-b"></span>
        `;
        const [first, svg, both] = root.children;
        const walk = vi.spyOn(root, 'getElementsByTagName');
        const query = vi.spyOn(root, 'querySelectorAll');
        document.body.append(root);
        await Promise.resolve();

        expect(walk).toHaveBeenCalledTimes(1);
        expect(query).not.toHaveBeenCalled();
        expect(calls).toEqual([
            ['root', root],
            ['two', svg.firstElementChild],
            ['two', both],
            ['two', first],
            ['two', both],
            ['regular', root],
            ['one', first],
            ['one', both],
        ]);
    });

    test('callbacks can remove descendants and change their classes without changing the snapshot', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="wanted"></span><span class="wanted"></span>';
        const [first, second] = root.children;
        const mutating = vi.fn((element) => {
            if (element === first) {
                second.className = '';
                root.replaceChildren();
            }
        });
        const next = vi.fn();
        domObserver.onClass('mutating', 'wanted', mutating);
        domObserver.onClass('next', 'wanted', next);
        domObserver.start();

        document.body.append(root);
        await Promise.resolve();
        await Promise.resolve();

        expect(root.childElementCount).toBe(0);
        expect(mutating.mock.calls).toEqual([[first], [second]]);
        expect(next.mock.calls).toEqual([[first], [second]]);
    });

    test('filters the added root and debounces before matching its current descendants', async () => {
        const callback = vi.fn();
        const filter = vi.fn((node) => node.hasAttribute('data-allowed'));
        const unregister = domObserver.onClass('deferred', 'wanted', callback, {
            debounce: true,
            debounceDelay: 30,
            filter,
        });
        domObserver.start();

        const accepted = document.createElement('div');
        accepted.setAttribute('data-allowed', '');
        accepted.innerHTML = '<span></span>';
        const rejected = document.createElement('div');
        rejected.innerHTML = '<span class="wanted"></span>';
        const walk = vi.spyOn(accepted, 'getElementsByTagName');
        document.body.append(accepted, rejected);
        await Promise.resolve();

        expect(filter.mock.calls).toEqual([[accepted], [rejected]]);
        expect(walk).not.toHaveBeenCalled();
        expect(domObserver.getStats()).toEqual({
            isObserving: true,
            handlerCount: 1,
            readyHandlerCount: 0,
            handlers: [{ name: 'deferred', debounced: true }],
            pendingCallbacks: 1,
        });
        accepted.firstElementChild.className = 'wanted';
        vi.advanceTimersByTime(29);
        expect(callback).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(callback.mock.calls).toEqual([[accepted.firstElementChild]]);

        document.body.append(accepted);
        await Promise.resolve();
        expect(domObserver.getStats().pendingCallbacks).toBe(1);
        unregister();
        vi.runAllTimers();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(domObserver.getStats()).toMatchObject({ handlerCount: 0, handlers: [], pendingCallbacks: 0 });
    });

    test('a later filter-accepted nonmatch replaces a pending match', async () => {
        const callback = vi.fn();
        domObserver.onClass('deferred', 'wanted', callback, { debounce: true });
        domObserver.start();

        const match = document.createElement('div');
        match.className = 'wanted';
        document.body.append(match);
        document.body.append(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();

        expect(callback).not.toHaveBeenCalled();
    });

    test('isolates class handler errors and records successful calls by handler name', async () => {
        performanceMonitor.enabled = true;
        const error = new Error('handler failed');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        domObserver.onClass('throwing', 'wanted', () => {
            throw error;
        });
        const next = vi.fn();
        domObserver.onClass('next', 'wanted', next);
        domObserver.start();

        const root = document.createElement('div');
        root.innerHTML = '<span class="wanted"></span><span class="wanted"></span>';
        document.body.append(root);
        await Promise.resolve();

        expect(log).toHaveBeenCalledWith('[DOM Observer] Handler error (throwing):', error);
        expect(next).toHaveBeenCalledTimes(2);
        expect(performanceMonitor.record.mock.calls).toEqual([['dom:next', expect.any(Number)]]);
    });

    test('regular handlers receive each added element with its own mutation record', async () => {
        const callback = vi.fn();
        const classCallback = vi.fn();
        domObserver.onClass('class', 'wanted', classCallback);
        domObserver.register('regular', callback);
        domObserver.start();

        const first = document.createElement('div');
        first.innerHTML = '<span class="wanted"></span>';
        const second = document.createElement('div');
        second.innerHTML = '<span class="wanted"></span>';
        const third = document.createElement('div');
        document.body.append(first, document.createTextNode('ignored'));
        document.body.append(second, third);
        await Promise.resolve();

        expect(classCallback.mock.calls).toEqual([[first.firstElementChild], [second.firstElementChild]]);
        expect(callback.mock.calls.map(([node]) => node)).toEqual([first, second, third]);
        const [, firstMutation] = callback.mock.calls[0];
        const [, secondMutation] = callback.mock.calls[1];
        expect(firstMutation.addedNodes[0]).toBe(first);
        expect(secondMutation.addedNodes[0]).toBe(second);
        expect(secondMutation).not.toBe(firstMutation);
        expect(callback.mock.calls[2][1]).toBe(secondMutation);
    });
});
