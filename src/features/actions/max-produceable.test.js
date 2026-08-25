/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dataHandlers: new Map(),
    settingHandlers: new Map(),
    loadoutUpdateHandlers: new Set(),
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => mocks.dataHandlers.set(event, handler)),
        off: vi.fn((event, handler) => {
            if (mocks.dataHandlers.get(event) === handler) mocks.dataHandlers.delete(event);
        }),
        getInventory: vi.fn(() => []),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn(() => vi.fn()),
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        onSettingChange: vi.fn((key, handler) => mocks.settingHandlers.set(key, handler)),
        offSettingChange: vi.fn((key, handler) => {
            if (mocks.settingHandlers.get(key) === handler) mocks.settingHandlers.delete(key);
        }),
    },
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        onUpdate: vi.fn((handler) => mocks.loadoutUpdateHandlers.add(handler)),
        offUpdate: vi.fn((handler) => mocks.loadoutUpdateHandlers.delete(handler)),
    },
}));

vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), off: vi.fn() } }));

vi.mock('./action-panel-sort.js', () => ({
    default: { initialize: vi.fn(async () => {}), clearAllPanels: vi.fn() },
}));

vi.mock('./action-filter.js', () => ({ default: {} }));

import config from '../../core/config.js';
import loadoutState from '../../core/loadout-state.js';
import maxProduceable from './max-produceable.js';

describe('MaxProduceable saved-loadout hot-path refresh wiring', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.dataHandlers.clear();
        mocks.settingHandlers.clear();
        mocks.loadoutUpdateHandlers.clear();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await maxProduceable.disable();
        vi.useRealTimers();
    });

    test('initialize subscribes to LoadoutState updates and the loadoutSnapshot setting', async () => {
        await maxProduceable.initialize();

        expect(loadoutState.onUpdate).toHaveBeenCalledTimes(1);
        expect(config.onSettingChange).toHaveBeenCalledWith('loadoutSnapshot', expect.any(Function));
    });

    test('a LoadoutState update schedules exactly one debounced refresh', async () => {
        await maxProduceable.initialize();
        const updateAllCounts = vi.spyOn(maxProduceable, 'updateAllCounts').mockImplementation(() => {});

        for (const handler of mocks.loadoutUpdateHandlers) handler();
        expect(updateAllCounts).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(updateAllCounts).toHaveBeenCalledTimes(1);
    });

    test('toggling loadoutSnapshot refreshes immediately', async () => {
        await maxProduceable.initialize();
        const updateAllCounts = vi.spyOn(maxProduceable, 'updateAllCounts').mockImplementation(() => {});

        mocks.settingHandlers.get('loadoutSnapshot')();
        expect(updateAllCounts).toHaveBeenCalledTimes(1);
    });

    test('an items_updated event and a LoadoutState update in the same tick coalesce into one refresh', async () => {
        await maxProduceable.initialize();
        const updateAllCounts = vi.spyOn(maxProduceable, 'updateAllCounts').mockImplementation(() => {});

        mocks.dataHandlers.get('items_updated')();
        for (const handler of mocks.loadoutUpdateHandlers) handler();

        vi.advanceTimersByTime(300);
        expect(updateAllCounts).toHaveBeenCalledTimes(1);
    });

    test('disable unsubscribes from LoadoutState updates and the setting symmetrically', async () => {
        await maxProduceable.initialize();
        const handler = [...mocks.loadoutUpdateHandlers][0];

        await maxProduceable.disable();

        expect(loadoutState.offUpdate).toHaveBeenCalledWith(handler);
        expect(config.offSettingChange).toHaveBeenCalledWith('loadoutSnapshot', expect.any(Function));
        expect(mocks.loadoutUpdateHandlers.size).toBe(0);
        expect(mocks.settingHandlers.has('loadoutSnapshot')).toBe(false);
    });
});
