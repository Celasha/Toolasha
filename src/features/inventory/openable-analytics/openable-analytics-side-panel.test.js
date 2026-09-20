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
    itemsSpriteUrl: 'https://example.com/items-sprite.svg',
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

vi.mock('../../../utils/asset-manifest.js', () => ({
    default: { getSpriteUrl: vi.fn(async () => mocks.itemsSpriteUrl) },
}));

const { default: openableAnalyticsSidePanel, PANEL_ID } = await import('./openable-analytics-side-panel.js');
const { default: assetManifest } = await import('../../../utils/asset-manifest.js');
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
    mocks.lifetimeAggregate = {
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
    };
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

    test('TLA-071: a modal hidden via CSS instead of being removed from the DOM is still cleaned up, via the periodic poll', () => {
        vi.useFakeTimers();
        try {
            const modal = buildModal();
            modalCallback()(modal);
            expect(document.getElementById(PANEL_ID)).not.toBeNull();

            // Modal stays in the DOM (no childList mutation ever fires) but is hidden in place -
            // the MutationObserver fast path can never catch this, only the poll safety net.
            modal.style.display = 'none';
            vi.advanceTimersByTime(1000);

            expect(document.getElementById(PANEL_ID)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    test('TLA-071: the visibility poll is stopped once the panel is removed, so it never fires again', () => {
        vi.useFakeTimers();
        try {
            const modal = buildModal();
            modalCallback()(modal);
            expect(vi.getTimerCount()).toBeGreaterThan(0);

            mocks.isMonetaryRewardModal.mockReturnValue(false);
            modalCallback()(modal);
            expect(document.getElementById(PANEL_ID)).toBeNull();

            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
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

    test('"Expected income" breakdown merges multiple drop-table rows for the same item into one', () => {
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
            {
                itemHrid: '/items/foo',
                itemName: 'Foo',
                dropRate: 0.1,
                avgCount: 1,
                priceEach: 100,
                expectedValue: 25,
                hasPriceData: true,
            },
        ]);
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-expected"]').click();
        const content = document.querySelector('[data-content-key="current-expected"]');

        expect(content.textContent.match(/Foo/g)).toHaveLength(1);
        // monetaryRecord() defaults containerCount to 6; merged expectedValue (100 + 25) × 6 = 750.
        expect(content.textContent).toContain('750');
    });

    test('"Income" is expandable on both Current (per-opening) and History (cumulative lifetime)', () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [{ itemHrid: '/items/foo', count: 3, value: 300, resolved: true }],
        });
        mocks.lifetimeAggregate = {
            ...mocks.lifetimeAggregate,
            itemTotals: { '/items/foo': 12 },
            itemValueTotals: { '/items/foo': 1200 },
        };
        dataManager.getItemDetails.mockReturnValue({ name: 'Foo' });
        const modal = buildModal();
        modalCallback()(modal);

        const currentToggle = document.querySelector('[data-toggle-key="current-income"]');
        expect(currentToggle).not.toBeNull();
        currentToggle.click();
        const currentContent = document.querySelector('[data-content-key="current-income"]');
        expect(currentContent.textContent).toContain('Foo');
        expect(currentContent.textContent).toContain('this opening');

        const historyToggle = document.querySelector('[data-toggle-key="history-income"]');
        expect(historyToggle).not.toBeNull();
        historyToggle.click();
        const historyContent = document.querySelector('[data-content-key="history-income"]');
        expect(historyContent.textContent).toContain('Foo');
        expect(historyContent.textContent).toContain('×12');
        expect(historyContent.textContent).toContain('lifetime openings');
    });

    test('History Income breakdown flags an item that has never been resolved to a price', () => {
        mocks.lifetimeAggregate = {
            ...mocks.lifetimeAggregate,
            itemTotals: { '/items/mystery': 5 },
            itemValueTotals: {},
        };
        dataManager.getItemDetails.mockReturnValue({ name: 'Mystery Item' });
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="history-income"]').click();
        const content = document.querySelector('[data-content-key="history-income"]');
        expect(content.textContent).toContain('Mystery Item');
        expect(content.textContent).toContain('no price yet');
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

describe('OpenableAnalyticsSidePanel item icons', () => {
    afterEach(() => {
        openableAnalyticsSidePanel.cleanup();
    });

    // Flushes the async asset-manifest fetch kicked off by initialize() so itemsSpriteUrl is
    // cached before the panel renders, matching the real-world "manifest already resolved" case.
    async function flushSpriteUrlFetch() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    test('renders an item icon next to each row in the Expected income breakdown', async () => {
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
        await flushSpriteUrlFetch();
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-expected"]').click();
        const content = document.querySelector('[data-content-key="current-expected"]');
        const use = content.querySelector('svg use');
        expect(use.getAttribute('href')).toBe(`${mocks.itemsSpriteUrl}#foo`);
    });

    test('renders an item icon next to each row in the Income breakdown', async () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [{ itemHrid: '/items/foo', count: 3, value: 300, resolved: true }],
        });
        dataManager.getItemDetails.mockReturnValue({ name: 'Foo' });
        await flushSpriteUrlFetch();
        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-income"]').click();
        const content = document.querySelector('[data-content-key="current-income"]');
        const use = content.querySelector('svg use');
        expect(use.getAttribute('href')).toBe(`${mocks.itemsSpriteUrl}#foo`);
    });

    test('renders no icon (and no broken image) when the sprite manifest has not resolved yet', () => {
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
        // Re-initialize with a never-resolving fetch so itemsSpriteUrl deterministically stays
        // null at render time, instead of racing the mock's normally-immediate resolution.
        openableAnalyticsSidePanel.cleanup();
        assetManifest.getSpriteUrl.mockImplementationOnce(() => new Promise(() => {}));
        openableAnalyticsSidePanel.initialize();

        const modal = buildModal();
        modalCallback()(modal);

        document.querySelector('[data-toggle-key="current-expected"]').click();
        const content = document.querySelector('[data-content-key="current-expected"]');
        expect(content.querySelector('svg')).toBeNull();
        expect(content.textContent).toContain('Foo');
    });
});
