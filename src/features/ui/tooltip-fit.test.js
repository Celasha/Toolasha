/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callback: null, unregister: vi.fn(), fix: vi.fn() }));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, _classes, callback) => {
            mocks.callback = callback;
            return mocks.unregister;
        }),
    },
}));
vi.mock('../../utils/dom.js', () => ({ fixTooltipOverflow: mocks.fix }));

const { default: tooltipFit } = await import('./tooltip-fit.js');

function makePopper() {
    const popper = document.createElement('div');
    popper.className = 'MuiTooltip-popper';
    const inner = document.createElement('div');
    inner.className = 'MuiTooltip-tooltip';
    popper.appendChild(inner);
    document.body.appendChild(popper);
    return { popper, inner };
}

describe('tooltipFit', () => {
    let observers;

    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.fix.mockClear();
        mocks.unregister.mockClear();
        observers = [];
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback) {
                    this.callback = callback;
                    this.observe = vi.fn();
                    this.disconnect = vi.fn();
                    observers.push(this);
                }
            }
        );
        tooltipFit.initialize();
    });

    afterEach(() => {
        tooltipFit.disable();
        vi.unstubAllGlobals();
    });

    test('fits every tooltip popup as it appears', () => {
        const { popper } = makePopper();

        mocks.callback(popper);

        expect(mocks.fix).toHaveBeenCalledWith(popper);
    });

    test('fits again whenever the tooltip content changes size', () => {
        const { popper, inner } = makePopper();
        mocks.callback(popper);
        mocks.fix.mockClear();

        expect(observers[0].observe).toHaveBeenCalledWith(inner);
        observers[0].callback();

        expect(mocks.fix).toHaveBeenCalledTimes(1);
    });

    test('watches a popup only once', () => {
        const { popper } = makePopper();

        mocks.callback(popper);
        mocks.callback(popper);

        expect(mocks.fix).toHaveBeenCalledTimes(1);
        expect(observers).toHaveLength(1);
    });

    test('stops watching a tooltip that has been removed', () => {
        const { popper } = makePopper();
        mocks.callback(popper);
        mocks.fix.mockClear();

        popper.remove();
        observers[0].callback();

        expect(mocks.fix).not.toHaveBeenCalled();
        expect(observers[0].disconnect).toHaveBeenCalled();
        expect(tooltipFit.observers.size).toBe(0);
    });

    test('a popup without a tooltip body is fitted once without an observer', () => {
        const popper = document.createElement('div');
        popper.className = 'MuiTooltip-popper';
        document.body.appendChild(popper);

        mocks.callback(popper);

        expect(mocks.fix).toHaveBeenCalledTimes(1);
        expect(observers).toHaveLength(0);
    });

    test('disable unregisters and disconnects every observer', () => {
        mocks.callback(makePopper().popper);
        mocks.callback(makePopper().popper);

        tooltipFit.disable();

        expect(mocks.unregister).toHaveBeenCalled();
        expect(observers.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
        expect(tooltipFit.observers.size).toBe(0);
    });
});
