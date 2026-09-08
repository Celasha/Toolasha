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
        getActionDetails: vi.fn(() => null),
        getEquipment: vi.fn(() => new Map()),
        getActionDrinkSlots: vi.fn(() => []),
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
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
import dataManager from '../../core/data-manager.js';
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

    test('subscribes to the common buffs_updated event (TLA-028) and schedules a debounced refresh', async () => {
        await maxProduceable.initialize();
        expect(mocks.dataHandlers.has('buffs_updated')).toBe(true);

        const updateAllCounts = vi.spyOn(maxProduceable, 'updateAllCounts').mockImplementation(() => {});
        mocks.dataHandlers.get('buffs_updated')();
        expect(updateAllCounts).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(updateAllCounts).toHaveBeenCalledTimes(1);
    });

    test('disable unsubscribes the buffs_updated handler', async () => {
        await maxProduceable.initialize();

        await maxProduceable.disable();

        expect(mocks.dataHandlers.has('buffs_updated')).toBe(false);
    });
});

describe('MaxProduceable.calculateMaxProduceable - upgrade item enhancement-level collision', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataManager.getEquipment.mockReturnValue(new Map());
        dataManager.getActionDrinkSlots.mockReturnValue([]);
        dataManager.getInitClientData.mockReturnValue({ itemDetailMap: {} });
        dataManager.getActionDetails.mockReturnValue({
            type: '/action_types/tailoring',
            inputItems: [{ itemHrid: '/items/icy_cloth', count: 6 }],
            upgradeItemHrid: '/items/bamboo_robe_top',
        });
    });

    test('a single owned +5 upgrade item never masks a much larger +0 stack of the same item', () => {
        dataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/icy_cloth', itemLocationHrid: '/item_locations/inventory', count: 999999 },
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 0,
                count: 13545,
            },
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 5,
                count: 1,
            },
        ]);

        expect(maxProduceable.calculateMaxProduceable('/actions/tailoring/icy_robe_top')).toBe(13545);
    });

    test('array order does not change which stack is counted - the +0 stack always wins', () => {
        dataManager.getInventory.mockReturnValue([
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 5,
                count: 1,
            },
            { itemHrid: '/items/icy_cloth', itemLocationHrid: '/item_locations/inventory', count: 999999 },
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 0,
                count: 13545,
            },
        ]);

        expect(maxProduceable.calculateMaxProduceable('/actions/tailoring/icy_robe_top')).toBe(13545);
    });

    test('owning only an enhanced copy (no +0) is treated as having none of the upgrade item', () => {
        dataManager.getInventory.mockReturnValue([
            { itemHrid: '/items/icy_cloth', itemLocationHrid: '/item_locations/inventory', count: 999999 },
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 5,
                count: 1,
            },
        ]);

        expect(maxProduceable.calculateMaxProduceable('/actions/tailoring/icy_robe_top')).toBe(0);
    });

    test('the same collision protection applies to an ordinary (non-upgrade) input item', () => {
        dataManager.getActionDetails.mockReturnValue({
            type: '/action_types/tailoring',
            inputItems: [{ itemHrid: '/items/bamboo_robe_top', count: 1 }],
        });
        dataManager.getInventory.mockReturnValue([
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 0,
                count: 13545,
            },
            {
                itemHrid: '/items/bamboo_robe_top',
                itemLocationHrid: '/item_locations/inventory',
                enhancementLevel: 5,
                count: 1,
            },
        ]);

        expect(maxProduceable.calculateMaxProduceable('/actions/tailoring/icy_robe_top')).toBe(13545);
    });
});
