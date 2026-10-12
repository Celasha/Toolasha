/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('./task-profit-calculator.js', () => ({ calculateTaskProfit: vi.fn() }));
vi.mock('../../utils/game-lookups.js', () => ({ getQuestFromTaskCard: vi.fn() }));
vi.mock('../../utils/game-i18n.js', () => ({ translateGameName: vi.fn((name) => name) }));

const { default: config } = await import('../../core/config.js');
const { default: domObserver } = await import('../../core/dom-observer.js');
const { default: taskInventoryHighlighter } = await import('./task-inventory-highlighter.js');

describe('TaskInventoryHighlighter — taskInventoryHighlighter setting gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        taskInventoryHighlighter.initialized = false;
    });

    test('watches the task panel when the setting is on', () => {
        config.getSetting.mockReturnValue(true);

        taskInventoryHighlighter.initialize();

        expect(domObserver.onClass).toHaveBeenCalled();
    });

    test('does not watch the task panel when the setting is off', () => {
        config.getSetting.mockImplementation((key) => key !== 'taskInventoryHighlighter');

        taskInventoryHighlighter.initialize();

        expect(domObserver.onClass).not.toHaveBeenCalled();
    });
});
