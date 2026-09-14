/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
    onUpdateCallback: null,
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
        COLOR_WARNING: '#ffa500',
        COLOR_TEXT_SECONDARY: '#888888',
        COLOR_TEXT_PRIMARY: '#ffffff',
        Z_FLOATING_PANEL: 1100,
        getSetting: vi.fn((key) => mocks.settings[key]),
    },
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: { getItemDetails: vi.fn() },
}));

vi.mock('../../market/expected-value-calculator.js', () => ({
    default: { getDropBreakdown: vi.fn(() => []) },
}));

vi.mock('./openable-analytics-data-collector.js', () => ({
    default: {
        getLatestRecord: vi.fn(() => mocks.latestRecord),
        getLifetimeAggregate: vi.fn(() => mocks.lifetimeAggregate),
        onUpdate: vi.fn((callback) => {
            mocks.onUpdateCallback = callback;
            return vi.fn();
        }),
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
const { default: dataManager } = await import('../../../core/data-manager.js');
const { default: expectedValueCalculator } = await import('../../market/expected-value-calculator.js');

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
    dataManager.getItemDetails.mockReset();
    expectedValueCalculator.getDropBreakdown.mockReset().mockReturnValue([]);
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

describe('OpenableAnalyticsSidePanel expandable breakdown rows', () => {
    afterEach(() => {
        openableAnalyticsSidePanel.cleanup();
    });

    test('clicking "Expected income" toggles its drop breakdown open and closed', () => {
        expectedValueCalculator.getDropBreakdown.mockReturnValue([
            {
                itemHrid: '/items/foo',
                itemName: 'Foo',
                dropRate: 0.5,
                avgCount: 2,
                priceEach: 100,
                expectedValue: 100,
                hasPriceData: true,
            },
        ]);
        const modal = buildModal();
        modalCallback()(modal);

        const toggle = document.querySelector('[data-toggle-key="current-expected"]');
        const content = document.querySelector('[data-content-key="current-expected"]');
        expect(toggle).not.toBeNull();
        expect(content.style.display).toBe('none');

        toggle.click();
        expect(content.style.display).toBe('block');
        expect(content.textContent).toContain('Foo');

        toggle.click();
        expect(content.style.display).toBe('none');
    });

    test('"Income" is expandable on Current with an item-by-item breakdown, but not on History', () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [{ itemHrid: '/items/foo', count: 3, value: 300, resolved: true }],
        });
        dataManager.getItemDetails.mockReturnValue({ name: 'Foo' });
        const modal = buildModal();
        modalCallback()(modal);

        const currentToggle = document.querySelector('[data-toggle-key="current-income"]');
        expect(currentToggle).not.toBeNull();
        currentToggle.click();
        expect(document.querySelector('[data-content-key="current-income"]').textContent).toContain('Foo');

        expect(document.querySelector('[data-toggle-key="history-income"]')).toBeNull();
    });

    test('an unpriced item in the Income breakdown is flagged instead of silently shown as priced', () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [{ itemHrid: '/items/mystery', count: 1, value: 0, resolved: false }],
        });
        dataManager.getItemDetails.mockReturnValue({ name: 'Mystery Item' });
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-income"]').click();
        const content = document.querySelector('[data-content-key="current-income"]');
        expect(content.textContent).toContain('Mystery Item');
        expect(content.textContent).toContain('no price yet');
    });

    test('expanded state survives a full re-render triggered by a data refresh', () => {
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-expected"]').click();
        expect(document.querySelector('[data-content-key="current-expected"]').style.display).toBe('block');

        mocks.onUpdateCallback();

        expect(document.querySelector('[data-content-key="current-expected"]').style.display).toBe('block');
    });
});
