/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    registerFloatingPanel: vi.fn(),
    unregisterFloatingPanel: vi.fn(),
    bringPanelToFront: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: { Z_FLOATING_PANEL: 1100 },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { on: mocks.on, off: mocks.off },
}));

vi.mock('../../core/storage.js', () => ({
    default: { get: mocks.get, set: mocks.set },
}));

vi.mock('../../utils/formatters.js', () => ({
    timeReadable: vi.fn((seconds) => `${seconds}s`),
}));

vi.mock('../../utils/panel-z-index.js', () => ({
    registerFloatingPanel: mocks.registerFloatingPanel,
    unregisterFloatingPanel: mocks.unregisterFloatingPanel,
    bringPanelToFront: mocks.bringPanelToFront,
}));

vi.mock('./queue-snapshot.js', () => ({
    default: { getOtherCharacterSnapshots: vi.fn(() => []) },
}));

import { QueueMonitorUI } from './queue-monitor-ui.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
});

describe('QueueMonitorUI lifecycle', () => {
    test('rejects a stale async initialization after disable and re-enable', async () => {
        let resolveFirstLoad;
        mocks.get
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirstLoad = resolve;
                    })
            )
            .mockResolvedValueOnce(false);

        const ui = new QueueMonitorUI();
        const staleInitialization = ui.initialize();

        ui.disable();
        await ui.initialize();
        resolveFirstLoad(true);
        await staleInitialization;

        expect(document.querySelectorAll('#toolasha-queue-monitor')).toHaveLength(1);
        expect(mocks.on).toHaveBeenCalledTimes(1);
        expect(ui.isInitialized).toBe(true);
        expect(ui.isInitializing).toBe(false);
    });

    test('cancels the delayed character refresh during disable', async () => {
        mocks.get.mockResolvedValue(false);
        const ui = new QueueMonitorUI();
        const updateSpy = vi.spyOn(ui, '_updateDisplay');
        await ui.initialize();
        updateSpy.mockClear();

        const initHandler = mocks.on.mock.calls[0][1];
        initHandler();
        ui.disable();
        await vi.advanceTimersByTimeAsync(500);

        expect(updateSpy).not.toHaveBeenCalled();
        expect(ui.bodyEl).toBeNull();
        expect(mocks.off).toHaveBeenCalledTimes(1);
    });
});
