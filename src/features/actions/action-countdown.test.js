import { beforeEach, describe, expect, test, vi } from 'vitest';

const configMock = {
    getSetting: vi.fn(() => true),
    onSettingChange: vi.fn(),
};
const domObserverMock = {
    onClass: vi.fn(() => vi.fn()),
};
const dataManagerMock = {
    on: vi.fn(),
    off: vi.fn(),
};

vi.mock('../../core/config.js', () => ({ default: configMock }));
vi.mock('../../core/dom-observer.js', () => ({ default: domObserverMock }));
vi.mock('../../core/data-manager.js', () => ({ default: dataManagerMock }));

function makeProgressElements(text = '10.0s') {
    const span = {
        textContent: text,
        isConnected: true,
    };
    const progressBar = {};
    const barContainer = { parentElement: progressBar };
    const fillBar = {
        className: 'ProgressBar_innerBar',
        isConnected: true,
        parentElement: barContainer,
    };
    const innerContainer = {
        children: [fillBar],
    };
    const parent = {
        children: [innerContainer],
    };
    const textEl = {
        isConnected: true,
        parentElement: parent,
        querySelector: vi.fn(() => span),
    };

    return { span, progressBar, fillBar, textEl };
}

describe('ActionCountdown', () => {
    let actionCountdown;
    let rafCallbacks;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        rafCallbacks = [];

        globalThis.document = {
            querySelector: vi.fn(() => null),
        };
        globalThis.requestAnimationFrame = vi.fn((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        globalThis.cancelAnimationFrame = vi.fn();
        globalThis.getComputedStyle = vi.fn((element) => {
            if (element?.className === 'ProgressBar_innerBar') {
                return { transform: 'matrix(0.5, 0, 0, 1, 0, 0)' };
            }
            return {
                getPropertyValue: vi.fn(() => '10'),
            };
        });

        const mod = await import('./action-countdown.js');
        actionCountdown = mod.default;
        actionCountdown.disable();
    });

    test('parses the total duration from its own remaining / total rendering', () => {
        const { span, textEl } = makeProgressElements('4.5s / 10.0s');
        actionCountdown.textEl = textEl;
        actionCountdown.spanEl = span;

        actionCountdown._parseTotalTime();

        expect(actionCountdown.totalTime).toBe(10);
    });

    test('limits expensive countdown work to the 0.1 second display precision', () => {
        const { span, textEl } = makeProgressElements('10.0s');
        actionCountdown.textEl = textEl;
        actionCountdown.spanEl = span;
        actionCountdown.totalTime = 10;
        actionCountdown._startLoop();

        for (let timestamp = 0; timestamp <= 1000; timestamp += 1000 / 60) {
            const callback = rafCallbacks.shift();
            expect(callback).toBeTypeOf('function');
            callback(timestamp);
        }

        // About ten updates per second, not one update per animation frame.
        expect(globalThis.getComputedStyle.mock.calls.length).toBeLessThanOrEqual(22);
        expect(globalThis.getComputedStyle.mock.calls.length).toBeGreaterThanOrEqual(18);
        expect(span.textContent).toBe('5.0s / 10.0s');
    });

    test('stops scheduling frames when the observed progress element is detached', () => {
        const { textEl } = makeProgressElements();
        textEl.isConnected = false;
        actionCountdown.textEl = textEl;
        actionCountdown.rafId = 1;

        actionCountdown._tick(100);

        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
        expect(actionCountdown.rafId).toBeNull();
    });
});
