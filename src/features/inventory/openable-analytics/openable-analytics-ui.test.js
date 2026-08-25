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
    default: { onClass: vi.fn(() => vi.fn()) },
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

const { default: openableAnalyticsUI } = await import('./openable-analytics-ui.js');

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
