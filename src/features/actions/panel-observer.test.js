// @vitest-environment jsdom

/**
 * Tests for panel-observer.js's live-buff invalidation wiring (TLA-028).
 *
 * panel-observer.js owns the persistently-mounted Enhancement calculator's refresh lifecycle.
 * Before this fix it only refreshed on items_updated/consumables_updated, so an achievement
 * tier/community buff/house room/etc. change while the panel stayed open left success%, speed%,
 * rare-find% and XP/hr stale. It must now also refresh on the common buffs_updated event.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dataHandlers: new Map() }));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn((event, handler) => mocks.dataHandlers.set(event, handler)),
        off: vi.fn((event, handler) => {
            if (mocks.dataHandlers.get(event) === handler) mocks.dataHandlers.delete(event);
        }),
    },
}));

vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true) } }));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('./enhancement-display.js', () => ({
    displayEnhancementStats: vi.fn(),
    getProtectionItemFromUI: vi.fn(),
}));

vi.mock('./inline-xp-rate.js', () => ({ removeInlineXpRate: vi.fn() }));

vi.mock('./profit-display.js', () => ({
    displayGatheringProfit: vi.fn(),
    displayProductionProfit: vi.fn(),
}));

vi.mock('../../utils/dom.js', () => ({ getOriginalText: vi.fn() }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({ clearAll: vi.fn(), registerTimeout: vi.fn(), registerInterval: vi.fn() })),
}));
vi.mock('./action-filter.js', () => ({ default: { initialize: vi.fn(), cleanup: vi.fn() } }));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn(), getItemHridFromName: vi.fn() }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn() }));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn() }));

import dataManager from '../../core/data-manager.js';
import { initActionPanelObserver, disablePanelObserver } from './panel-observer.js';

describe('panel-observer enhancement refresh subscribes to the common buffs_updated event (TLA-028)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        mocks.dataHandlers.clear();
    });

    afterEach(() => {
        disablePanelObserver();
    });

    test('initActionPanelObserver registers a buffs_updated listener alongside items_updated/consumables_updated', () => {
        initActionPanelObserver();

        const subscribedEvents = dataManager.on.mock.calls.map(([event]) => event);
        expect(subscribedEvents).toContain('buffs_updated');
        expect(subscribedEvents).toContain('items_updated');
        expect(subscribedEvents).toContain('consumables_updated');
    });

    test('disablePanelObserver unregisters the buffs_updated listener', () => {
        initActionPanelObserver();

        disablePanelObserver();

        expect(dataManager.off).toHaveBeenCalledWith('buffs_updated', expect.any(Function));
        expect(mocks.dataHandlers.has('buffs_updated')).toBe(false);
    });

    test('re-initializing after disable does not register a duplicate buffs_updated listener', () => {
        initActionPanelObserver();
        disablePanelObserver();
        vi.clearAllMocks();

        initActionPanelObserver();

        const buffsUpdatedCalls = dataManager.on.mock.calls.filter(([event]) => event === 'buffs_updated');
        expect(buffsUpdatedCalls).toHaveLength(1);
    });
});
