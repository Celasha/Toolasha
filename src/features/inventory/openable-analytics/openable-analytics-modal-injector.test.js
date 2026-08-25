/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    onClassCallbacks: [],
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
        onClass: vi.fn((_name, _classNames, callback) => {
            mocks.onClassCallbacks.push(callback);
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
} = await import('./openable-analytics-modal-injector.js');

function buildModal() {
    const container = document.createElement('div');
    container.className = `Inventory_modalContent__3ObSx`;
    container.innerHTML = `<div class="Inventory_header__1">Loot Gained!</div><div>item icon</div>`;
    document.body.appendChild(container);
    return container;
}

beforeEach(() => {
    mocks.onClassCallbacks = [];
    mocks.unsubscribeCollectorCallbacks = [];
    mocks.latestRecord = {
        containerHrid: '/items/chest',
        containerCount: 6,
        actualValue: 1470000,
        actualValueComplete: true,
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
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('6 opened');
    });

    test('remounting the modal for a second opening replaces the line in place rather than duplicating it', () => {
        const modal = buildModal();
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        mocks.latestRecord = { ...mocks.latestRecord, containerCount: 3, actualValue: 500000 };
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('3 opened');
        expect(modal.textContent).not.toContain('6 opened');
    });

    test('a data-driven update to an already-mounted modal (no remount) updates the line in place', () => {
        const modal = buildModal();
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        mocks.latestRecord = { ...mocks.latestRecord, containerCount: 42 };
        mocks.unsubscribeCollectorCallbacks.forEach((cb) => cb(mocks.latestRecord));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.textContent).toContain('42 opened');
    });

    test('does not touch a modalContent node from an unrelated class match', () => {
        const other = document.createElement('div');
        other.className = 'SomeOtherPanel_modalContent__abc';
        document.body.appendChild(other);

        mocks.onClassCallbacks.forEach((cb) => cb(other));

        expect(other.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('never injects before any record exists (no crash, no line)', () => {
        mocks.latestRecord = null;
        const modal = buildModal();
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('shows Expected: N/A without a Luck value when EV is unavailable for the opened container', () => {
        mocks.latestRecord = {
            containerHrid: '/items/seal_of_rare_find',
            containerCount: 1,
            actualValue: 0,
            actualValueComplete: true,
            expectedValue: null,
            expectedValueAvailable: false,
            luckValue: null,
            luckPercent: null,
        };
        const modal = buildModal();
        mocks.onClassCallbacks.forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('Expected N/A');
        expect(modal.textContent).not.toContain('Luck');
    });
});

test('MODAL_CONTENT_CLASS targets the Inventory panel modal content class', () => {
    expect(MODAL_CONTENT_CLASS).toBe('Inventory_modalContent');
});
