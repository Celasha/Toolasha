import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { calculateNetworth, onDataEvent } = vi.hoisted(() => ({ calculateNetworth: vi.fn(), onDataEvent: vi.fn() }));
vi.mock('./networth-calculator.js', () => ({ calculateNetworth }));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: () => false,
        isFeatureEnabled: () => false,
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/connection-state.js', () => ({ default: { isConnected: () => true } }));
vi.mock('../../core/data-manager.js', () => ({ default: { on: onDataEvent, off: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../utils/pause-registry.js', () => ({
    createPauseRegistry: () => ({ register: vi.fn(), unregister: vi.fn(), cleanup: vi.fn() }),
}));
vi.mock('./networth-display.js', () => ({
    networthHeaderDisplay: { setNetworthFeature: vi.fn(), disable: vi.fn() },
    networthInventoryDisplay: { setNetworthFeature: vi.fn(), disable: vi.fn() },
}));
vi.mock('./networth-exclusions.js', () => ({ initExclusions: vi.fn() }));
vi.mock('./networth-exclusion-popup.js', () => ({ default: { refresh: vi.fn(), close: vi.fn() } }));
vi.mock('./networth-history.js', () => ({ default: { disable: vi.fn() } }));
vi.mock('./networth-history-chart.js', () => ({ default: { closeModal: vi.fn() } }));
import feature from './index.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    calculateNetworth.mockResolvedValue({ totalNetworth: 1 });
});

afterEach(() => {
    feature.disable();
    vi.useRealTimers();
});

test('refreshes after 30 seconds of continuous updates and after 500 ms of quiet', async () => {
    await feature.initialize();
    const onItemsUpdated = onDataEvent.mock.calls.find(([event]) => event === 'items_updated')[1];
    for (let elapsed = 0; elapsed < 30_000; elapsed += 400) {
        onItemsUpdated();
        expect(calculateNetworth).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(400);
    }
    expect(calculateNetworth).toHaveBeenCalledTimes(2);

    onItemsUpdated();
    await vi.advanceTimersByTimeAsync(500);
    expect(calculateNetworth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calculateNetworth).toHaveBeenCalledTimes(3);
});

test('coalesces concurrent requests into one follow-up calculation', async () => {
    let finishFirst;
    const firstCalculation = new Promise((resolve) => {
        finishFirst = resolve;
    });
    const latest = { totalNetworth: 20 };
    calculateNetworth.mockReturnValueOnce(firstCalculation).mockResolvedValueOnce(latest);

    const first = feature.recalculate();
    const second = feature.recalculate();
    const third = feature.recalculate();
    expect(calculateNetworth).toHaveBeenCalledTimes(1);
    finishFirst({ totalNetworth: 10 });
    await Promise.all([first, second, third]);
    expect(calculateNetworth).toHaveBeenCalledTimes(2);
    expect(feature.currentData).toBe(latest);
});
