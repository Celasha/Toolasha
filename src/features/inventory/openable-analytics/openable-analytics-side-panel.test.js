/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registrations: [],
    latestRecord: null,
    lifetimeAggregate: {
        containersOpened: 0,
        actualValueTotal: 0,
        actualValuePartialEvents: 0,
        expectedValueTotal: 0,
        expectedValueAvailableEvents: 0,
        expectedValuePartialEvents: 0,
        valuationRecordCount: 0,
        luckEligibleRecordCount: 0,
        eventsCount: 0,
        hasImportedData: false,
    },
    isMonetaryRewardModal: vi.fn(() => true),
    settings: { openableAnalytics_sidePanel: true },
    openingCost: { cost: 0, complete: true },
    incomeStdDev: 100,
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
    default: {
        COLOR_PROFIT: '#047857',
        COLOR_LOSS: '#f87171',
        COLOR_TEXT_SECONDARY: '#888888',
        Z_FLOATING_PANEL: 1100,
        getSetting: vi.fn((key) => mocks.settings[key]),
    },
}));

vi.mock('./openable-analytics-data-collector.js', () => ({
    default: {
        getLatestRecord: vi.fn(() => mocks.latestRecord),
        getLifetimeAggregate: vi.fn(() => mocks.lifetimeAggregate),
        onUpdate: vi.fn(() => vi.fn()),
    },
}));

vi.mock('./openable-analytics-modal-injector.js', () => ({
    isMonetaryRewardModal: (...args) => mocks.isMonetaryRewardModal(...args),
    MODAL_CONTENT_CLASS: 'Inventory_modalContent',
}));

vi.mock('./openable-analytics-cost.js', () => ({
    calculateOpeningCost: vi.fn(() => mocks.openingCost),
}));

vi.mock('./openable-analytics-variance.js', () => ({
    calculateIncomeStdDev: vi.fn(() => mocks.incomeStdDev),
}));

const { default: openableAnalyticsSidePanel, PANEL_ID } = await import('./openable-analytics-side-panel.js');

function monetaryRecord(overrides = {}) {
    return {
        containerHrid: '/items/chest',
        containerCount: 6,
        gainedItems: [{ itemHrid: '/items/coin', count: 100 }],
        actualValue: 1470000,
        actualValueComplete: true,
        expectedValue: 1200000,
        expectedValueAvailable: true,
        expectedValueComplete: true,
        luckValue: 270000,
        luckPercent: 22.5,
        ...overrides,
    };
}

function buildModal({ left = 500, top = 100 } = {}) {
    const container = document.createElement('div');
    container.className = 'Inventory_modalContent__3ObSx';
    document.body.appendChild(container);
    container.getBoundingClientRect = () => ({ left, top, right: left + 300, bottom: top + 400, width: 300 });
    return container;
}

beforeEach(() => {
    mocks.registrations = [];
    mocks.latestRecord = monetaryRecord();
    mocks.isMonetaryRewardModal.mockReturnValue(true);
    mocks.settings.openableAnalytics_sidePanel = true;
    mocks.openingCost = { cost: 0, complete: true };
    mocks.incomeStdDev = 100;
    document.body.innerHTML = '';
    openableAnalyticsSidePanel.cleanup();
    openableAnalyticsSidePanel.initialize();
});

function modalCallback() {
    return mocks.registrations.find((r) => r.classNames === 'Inventory_modalContent').callback;
}

describe('OpenableAnalyticsSidePanel', () => {
    test('renders a Current and History card into a body-appended panel for a monetary reward modal', () => {
        const modal = buildModal();
        modalCallback()(modal);

        const panel = document.getElementById(PANEL_ID);
        expect(panel).not.toBeNull();
        expect(panel.parentElement).toBe(document.body);
        expect(panel.textContent).toContain('Current');
        expect(panel.textContent).toContain('History');
    });

    test('does not render anything for a non-monetary modal (e.g. a buff-only opening)', () => {
        mocks.isMonetaryRewardModal.mockReturnValue(false);
        const modal = buildModal();
        modalCallback()(modal);

        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    test('does not render anything when the side-panel setting is disabled', () => {
        mocks.settings.openableAnalytics_sidePanel = false;
        const modal = buildModal();
        modalCallback()(modal);

        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    test('removes an existing panel when the modal stops being a monetary reward (e.g. re-rendered as buff-only)', () => {
        const modal = buildModal();
        modalCallback()(modal);
        expect(document.getElementById(PANEL_ID)).not.toBeNull();

        mocks.isMonetaryRewardModal.mockReturnValue(false);
        modalCallback()(modal);

        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    test('always anchors to the left of the modal when there is room', () => {
        const modal = buildModal({ left: 500 });
        modalCallback()(modal);

        const panel = document.getElementById(PANEL_ID);
        // panel.scrollWidth is 0 in jsdom (no real layout), so it falls back to NATURAL_PANEL_WIDTH (300)
        expect(panel.style.left).toBe(`${500 - 8 - 300}px`);
        expect(parseFloat(panel.style.left)).toBeLessThan(500);
    });

    test('shrinks the panel width rather than flipping to the right when the modal is near the left edge', () => {
        const modal = buildModal({ left: 50 });
        modalCallback()(modal);

        const panel = document.getElementById(PANEL_ID);
        // available room = 50 - 8(gap) - 10(margin) = 32, clamped up to MIN_PANEL_WIDTH (150)
        expect(panel.style.width).toBe('150px');
        expect(parseFloat(panel.style.left)).toBe(10); // clamped to the viewport margin, never negative
    });

    test('cleanup removes any rendered panel and stops watching', () => {
        const modal = buildModal();
        modalCallback()(modal);
        expect(document.getElementById(PANEL_ID)).not.toBeNull();

        openableAnalyticsSidePanel.cleanup();

        expect(document.getElementById(PANEL_ID)).toBeNull();
    });
});
