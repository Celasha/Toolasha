// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';
import { TaskProfitDisplay } from './task-profit-display.js';

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('TaskProfitDisplay timeout lifecycle', () => {
    test('removes completed timeout IDs from the owned registry', () => {
        vi.useFakeTimers();
        const feature = new TaskProfitDisplay();
        const callback = vi.fn();

        feature._scheduleTimeout(callback, 250);
        expect(feature.pendingTimeouts.size).toBe(1);

        vi.advanceTimersByTime(250);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(feature.pendingTimeouts.size).toBe(0);
    });

    test('disable cancels pending callbacks so removed UI cannot be recreated', () => {
        vi.useFakeTimers();
        const feature = new TaskProfitDisplay();
        const callback = vi.fn();

        feature._scheduleTimeout(callback, 250);
        feature.disable();
        vi.advanceTimersByTime(250);

        expect(callback).not.toHaveBeenCalled();
        expect(feature.pendingTimeouts.size).toBe(0);
    });
});
