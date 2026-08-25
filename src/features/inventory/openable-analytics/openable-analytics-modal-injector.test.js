/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registrations: [],
    unsubscribeCollectorCallbacks: [],
    latestRecord: null,
    lifetimeAggregate: {
        containersOpened: 0,
        actualValueTotal: 0,
        expectedValueTotal: 0,
        expectedValueAvailableEvents: 0,
    },
}));

vi.mock('../../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, classNames, callback) => {
            mocks.registrations.push({ classNames, callback });
            return vi.fn();
        }),
    },
}));

vi.mock('../../../core/config.js', () => ({
    default: { COLOR_PROFIT: '#047857', COLOR_LOSS: '#f87171', COLOR_TEXT_SECONDARY: '#888888' },
}));

vi.mock('./openable-analytics-data-collector.js', () => ({
    default: {
        getLatestRecord: vi.fn(() => mocks.latestRecord),
        getLifetimeAggregate: vi.fn(() => mocks.lifetimeAggregate),
        onUpdate: vi.fn((callback) => {
            mocks.unsubscribeCollectorCallbacks.push(callback);
            return vi.fn();
        }),
    },
}));

const {
    default: openableAnalyticsModalInjector,
    MODAL_CONTENT_CLASS,
    LINE_CLASS,
    ITEM_CONTAINER_CLASS,
    ITEM_VALUE_LABEL_CLASS,
} = await import('./openable-analytics-modal-injector.js');

function modalCallbacks() {
    return mocks.registrations.filter((r) => r.classNames === MODAL_CONTENT_CLASS).map((r) => r.callback);
}

function itemCallbacks() {
    return mocks.registrations.filter((r) => r.classNames === ITEM_CONTAINER_CLASS).map((r) => r.callback);
}

function buildModal(itemCount = 3) {
    const container = document.createElement('div');
    container.className = `Inventory_modalContent__3ObSx`;
    const itemsHtml = Array.from(
        { length: itemCount },
        (_, i) => `<div class="Item_itemContainer__x7kH1" data-index="${i}"></div>`
    ).join('');
    container.innerHTML = `<div class="Inventory_header__1">Loot Gained!</div><div>item icon</div><div class="Inventory_gainedItems__abc">${itemsHtml}</div>`;
    document.body.appendChild(container);
    return container;
}

function itemContainersOf(modal) {
    return modal.querySelectorAll(`[class*="${ITEM_CONTAINER_CLASS}"]`);
}

beforeEach(() => {
    mocks.registrations = [];
    mocks.unsubscribeCollectorCallbacks = [];
    mocks.latestRecord = {
        containerHrid: '/items/chest',
        containerCount: 6,
        actualValue: 1470000,
        actualValueComplete: true,
        actualValueBreakdown: [
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 42938, value: 42938, resolved: true },
            { itemHrid: '/items/shard_of_protection', enhancementLevel: 0, count: 8, value: 400000, resolved: true },
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 1, value: 1062, resolved: true },
        ],
        expectedValue: 2190000,
        expectedValueAvailable: true,
        luckValue: -720000,
        luckPercent: -32.9,
    };
    document.body.innerHTML = '';
    openableAnalyticsModalInjector.cleanup();
    openableAnalyticsModalInjector.initialize();
});

describe('idempotent modal injection', () => {
    test('injects exactly one summary line on first mount', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('6 opened');
    });

    test('remounting the modal for a second opening replaces the line in place rather than duplicating it', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        mocks.latestRecord = { ...mocks.latestRecord, containerCount: 3, actualValue: 500000 };
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('3 opened');
        expect(modal.textContent).not.toContain('6 opened');
    });

    test('a data-driven update to an already-mounted modal (no remount) updates the line in place', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        mocks.latestRecord = { ...mocks.latestRecord, containerCount: 42 };
        mocks.unsubscribeCollectorCallbacks.forEach((cb) => cb(mocks.latestRecord));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('42 opened');
    });

    test('does not touch a modalContent node from an unrelated class match', () => {
        const other = document.createElement('div');
        other.className = 'SomeOtherPanel_modalContent__abc';
        document.body.appendChild(other);

        modalCallbacks().forEach((cb) => cb(other));

        expect(other.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('never injects before any record exists (no crash, no line)', () => {
        mocks.latestRecord = null;
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('shows Expected: N/A without a Luck value when EV is unavailable for the opened container', () => {
        mocks.latestRecord = {
            containerHrid: '/items/seal_of_rare_find',
            containerCount: 1,
            actualValue: 0,
            actualValueComplete: true,
            actualValueBreakdown: [],
            expectedValue: null,
            expectedValueAvailable: false,
            luckValue: null,
            luckPercent: null,
        };
        const modal = buildModal(0);
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('Expected N/A');
        expect(modal.textContent).not.toContain('Luck');
    });
});

describe('per-item value labels', () => {
    test('stamps a value label on each gained-item icon, matched positionally to the breakdown', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));

        const items = itemContainersOf(modal);
        expect(items[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('42K');
        expect(items[1].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('400K');
        expect(items[2].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('1,062');
    });

    test('shows N/A for an unresolved item instead of a fabricated value', () => {
        mocks.latestRecord = {
            ...mocks.latestRecord,
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
            ],
        };
        const modal = buildModal(1);
        modalCallbacks().forEach((cb) => cb(modal));

        expect(itemContainersOf(modal)[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('N/A');
    });

    test('re-rendering updates the same label in place rather than adding a second one', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        modalCallbacks().forEach((cb) => cb(modal));

        const items = itemContainersOf(modal);
        expect(items[0].querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`)).toHaveLength(1);
    });

    test('skips labeling entirely (no crash, no mismatched values) when the icon count does not match the breakdown', () => {
        const modal = buildModal(5); // 5 icons but the mocked record's breakdown has 3 entries

        expect(() => modalCallbacks().forEach((cb) => cb(modal))).not.toThrow();
        itemContainersOf(modal).forEach((item) => {
            expect(item.querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull();
        });
    });

    test('the item-level observer relabels using the current DOM state when new item icons are inserted directly', () => {
        const modal = buildModal(3);
        // Simulate the "modal stays mounted, content updates in place" path: item icons are
        // (re)inserted without the modal container itself being re-added, so only the
        // item-level observer fires, not the modal-level one.
        itemCallbacks().forEach((cb) => cb(itemContainersOf(modal)[0]));

        const items = itemContainersOf(modal);
        expect(items[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('42K');
    });

    test('the item-level observer ignores an item icon outside any tracked Openable Analytics modal', () => {
        const strayItem = document.createElement('div');
        strayItem.className = 'Item_itemContainer__x7kH1';
        document.body.appendChild(strayItem);

        expect(() => itemCallbacks().forEach((cb) => cb(strayItem))).not.toThrow();
        expect(strayItem.querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull();
    });
});

test('MODAL_CONTENT_CLASS targets the Inventory panel modal content class', () => {
    expect(MODAL_CONTENT_CLASS).toBe('Inventory_modalContent');
});
