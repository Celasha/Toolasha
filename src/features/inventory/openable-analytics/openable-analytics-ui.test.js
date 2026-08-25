/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    aggregate: {
        eventsCount: 0,
        containersOpened: 0,
        actualValueTotal: 0,
        actualValuePartialEvents: 0,
        expectedValueTotal: 0,
        expectedValueAvailableEvents: 0,
        itemTotals: {},
        itemValueTotals: {},
    },
    knownContainers: ['/items/chest'],
    domObserverRegistrations: [],
}));

vi.mock('../../../core/config.js', () => ({
    default: { COLOR_PROFIT: '#047857', COLOR_LOSS: '#f87171', COLOR_TEXT_PRIMARY: '#fff' },
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn((hrid) => ({ name: hrid.split('/').pop() })),
    },
}));

vi.mock('../../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, classNames, callback) => {
            mocks.domObserverRegistrations.push({ classNames, callback });
            return vi.fn();
        }),
    },
}));

vi.mock('./openable-analytics-data-collector.js', () => ({
    default: {
        getKnownContainers: vi.fn(() => mocks.knownContainers),
        getSessionAggregate: vi.fn(() => mocks.aggregate),
        getLifetimeAggregate: vi.fn(() => mocks.aggregate),
        onUpdate: vi.fn(() => vi.fn()),
        getLatestRecord: vi.fn(() => null),
    },
}));

const {
    default: openableAnalyticsUI,
    INVENTORY_FILTER_CONTAINER_CLASS,
    INVENTORY_BUTTON_CLASS,
} = await import('./openable-analytics-ui.js');

beforeEach(() => {
    mocks.aggregate = {
        eventsCount: 1,
        containersOpened: 1,
        actualValueTotal: 489000,
        actualValuePartialEvents: 0,
        expectedValueTotal: 725000,
        expectedValueAvailableEvents: 1,
        itemTotals: { '/items/coin': 42938, '/items/shard_of_protection': 8, '/items/pearl': 1 },
        itemValueTotals: { '/items/coin': 42938, '/items/shard_of_protection': 400000 },
    };
    mocks.knownContainers = ['/items/chest'];
    mocks.domObserverRegistrations = [];
    document.body.innerHTML = '';
    openableAnalyticsUI.cleanup();
    openableAnalyticsUI.initialize();
    openableAnalyticsUI.selectedContainer = '/items/chest';
    openableAnalyticsUI.selectedScope = 'session';
});

describe('buildItemOutcomes', () => {
    test('shows each item’s count alongside its cumulative value', () => {
        const wrapper = openableAnalyticsUI.buildItemOutcomes();

        expect(wrapper.textContent).toContain('42938 (42K)');
        expect(wrapper.textContent).toContain('8 (400K)');
    });

    test('shows N/A for an item with a count but no resolved cumulative value', () => {
        const wrapper = openableAnalyticsUI.buildItemOutcomes();

        expect(wrapper.textContent).toContain('1 (N/A)');
    });

    test('sorts by count descending, unchanged from before this feature', () => {
        const wrapper = openableAnalyticsUI.buildItemOutcomes();
        const rows = [...wrapper.querySelectorAll('div')].filter((el) => el.children.length === 2);

        expect(rows[0].textContent).toContain('coin');
        expect(rows[1].textContent).toContain('shard_of_protection');
    });

    test('shows an empty-state message when there are no items in scope', () => {
        mocks.aggregate = { ...mocks.aggregate, itemTotals: {}, itemValueTotals: {} };

        const wrapper = openableAnalyticsUI.buildItemOutcomes();

        expect(wrapper.textContent).toContain('No items gained in this scope.');
    });
});

describe('persistent Inventory panel entry point', () => {
    function filterContainerCallbacks() {
        return mocks.domObserverRegistrations
            .filter((r) => r.classNames === INVENTORY_FILTER_CONTAINER_CLASS)
            .map((r) => r.callback);
    }

    test('injects a button into the Inventory panel search bar row', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);

        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        expect(filterContainer.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('does not inject a second button if one is already present (idempotent on re-render)', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);

        filterContainerCallbacks().forEach((cb) => cb(filterContainer));
        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        expect(filterContainer.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('clicking the button opens the Analytics popup even with no specific opening context', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);
        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        filterContainer.querySelector(`.${INVENTORY_BUTTON_CLASS}`).onclick();

        expect(document.querySelector('.toolasha-openable-analytics-popup')).not.toBeNull();
    });

    test('cleanup unregisters the observer so a later re-initialize does not double-register', () => {
        openableAnalyticsUI.cleanup();
        mocks.domObserverRegistrations = [];
        openableAnalyticsUI.initialize();

        expect(filterContainerCallbacks()).toHaveLength(1);
    });
});
