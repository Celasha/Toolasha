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
        valuationRecordCount: 0,
        luckEligibleRecordCount: 0,
        eventsCount: 0,
        hasImportedData: false,
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
    container.innerHTML =
        itemCount > 0
            ? `<div class="Inventory_header__1">Opened Loot</div><div class="Inventory_gainedItems__abc"><div class="Inventory_label__x">You found:</div>${itemsHtml}</div><button>Close</button>`
            : `<div class="Inventory_header__1">Opened Loot</div><button>Close</button>`;
    document.body.appendChild(container);
    return container;
}

function itemContainersOf(modal) {
    return modal.querySelectorAll(`[class*="${ITEM_CONTAINER_CLASS}"]`);
}

function monetaryRecord(overrides = {}) {
    return {
        containerHrid: '/items/chest',
        containerCount: 6,
        gainedItems: [
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 42938 },
            { itemHrid: '/items/shard_of_protection', enhancementLevel: 0, count: 8 },
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 1 },
        ],
        actualValue: 1470000,
        actualValueComplete: true,
        actualValueBreakdown: [
            { itemHrid: '/items/coin', enhancementLevel: 0, count: 42938, value: 42938, resolved: true },
            { itemHrid: '/items/shard_of_protection', enhancementLevel: 0, count: 8, value: 400000, resolved: true },
            { itemHrid: '/items/pearl', enhancementLevel: 0, count: 1, value: 1062, resolved: true },
        ],
        expectedValue: 2190000,
        expectedValueAvailable: true,
        expectedValueComplete: true,
        luckValue: -720000,
        luckPercent: -32.9,
        ...overrides,
    };
}

beforeEach(() => {
    mocks.registrations = [];
    mocks.unsubscribeCollectorCallbacks = [];
    mocks.latestRecord = monetaryRecord();
    mocks.lifetimeAggregate = {
        containersOpened: 10,
        actualValueTotal: 5000000,
        expectedValueTotal: 6300000,
        valuationRecordCount: 4,
        luckEligibleRecordCount: 4,
        eventsCount: 4,
        hasImportedData: false,
    };
    document.body.innerHTML = '';
    openableAnalyticsModalInjector.cleanup();
    openableAnalyticsModalInjector.initialize();
});

describe('modal ownership (section 5)', () => {
    test('proven monetary result modal: footer is inserted after native reward content, before the native Close button', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        const children = [...modal.children];
        const lineIndex = children.findIndex((el) => el.classList.contains(LINE_CLASS));
        expect(lineIndex).toBe(children.length - 2); // immediately before the trailing <button>Close</button>
    });

    test('does not touch a modalContent node from an unrelated class match', () => {
        const other = document.createElement('div');
        other.className = 'SomeOtherPanel_modalContent__abc';
        document.body.appendChild(other);

        modalCallbacks().forEach((cb) => cb(other));

        expect(other.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('a real Inventory_modalContent that structurally has no gained-items section gets no OA footer', () => {
        const modal = buildModal(0); // no Inventory_gainedItems section at all

        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('never injects before any record exists (no crash, no footer)', () => {
        mocks.latestRecord = null;
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('pure buff-only openable (no gained items) never gets a monetary OA footer', () => {
        mocks.latestRecord = {
            containerHrid: '/items/seal_of_rare_find',
            containerCount: 1,
            gainedItems: [],
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

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
        expect(modal.textContent).not.toContain('Actual');
    });

    test('monetary -> buff-only modal reuse removes the stale monetary footer/labels', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);

        // React reuses the same modalContent node for a later buff-only result.
        modal.querySelector(`[class*="Inventory_gainedItems"]`)?.remove();
        mocks.latestRecord = {
            containerHrid: '/items/seal_of_rare_find',
            containerCount: 1,
            gainedItems: [],
            actualValue: 0,
            actualValueComplete: true,
            actualValueBreakdown: [],
            expectedValue: null,
            expectedValueAvailable: false,
            luckValue: null,
            luckPercent: null,
        };
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
        expect(modal.querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`)).toHaveLength(0);
    });
});

describe('footer UI contract (section 6)', () => {
    test('normal monetary opening shows Actual/Expected/Luck without opened-count wording', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('Actual');
        expect(modal.textContent).toContain('Expected');
        expect(modal.textContent).toContain('Luck');
        expect(modal.textContent).not.toMatch(/\d+ opened/);
    });

    test('negative Luck includes an explicit minus sign and percent', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('-720K');
        expect(modal.textContent).toContain('-32.9%');
    });

    test('positive Luck includes an explicit plus sign in both value and percent', () => {
        mocks.latestRecord = monetaryRecord({ luckValue: 720000, luckPercent: 32.9 });
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('+720K');
        expect(modal.textContent).toContain('+32.9%');
    });

    test('rounded -0.0% luck percent is normalized to 0.0%, not shown as negative', () => {
        mocks.latestRecord = monetaryRecord({ luckValue: 0, luckPercent: -0.02 });
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).not.toContain('-0.0%');
        expect(modal.textContent).toContain('0.0%');
    });

    test('monetary incomplete valuation shows [Partial] and Luck as an explicit unavailable dash, not N/A', () => {
        mocks.latestRecord = monetaryRecord({ actualValueComplete: false, luckValue: null, luckPercent: null });
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('[Partial]');
        expect(modal.textContent).not.toContain('N/A');
        expect(modal.querySelector(`.${LINE_CLASS}`).textContent).toMatch(/Luck\s*—/);
    });

    test('first tracked event with no other Lifetime history suppresses a redundant Lifetime row', () => {
        mocks.lifetimeAggregate = {
            containersOpened: 6,
            actualValueTotal: 1470000,
            expectedValueTotal: 2190000,
            valuationRecordCount: 1,
            luckEligibleRecordCount: 1,
            eventsCount: 1,
            hasImportedData: false,
        };
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toContain('View Analytics');
        expect(modal.textContent).not.toMatch(/Lifetime/);
    });

    test('prior live history still shows a Lifetime row', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toMatch(/Lifetime ×10/);
    });

    test('imported-only Lifetime history (this is the first live event) still shows a Lifetime row', () => {
        mocks.lifetimeAggregate = {
            containersOpened: 501,
            actualValueTotal: 1470000,
            expectedValueTotal: 2190000,
            valuationRecordCount: 2,
            luckEligibleRecordCount: 2,
            eventsCount: 1,
            hasImportedData: true,
        };
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toMatch(/Lifetime ×501/);
    });

    test('AGG-1: Lifetime Luck is hidden when one folded valuation record is not Luck-eligible', () => {
        mocks.lifetimeAggregate = {
            containersOpened: 10,
            actualValueTotal: 500,
            expectedValueTotal: 400,
            valuationRecordCount: 3,
            luckEligibleRecordCount: 2,
            eventsCount: 3,
            hasImportedData: false,
        };
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        expect(modal.textContent).toMatch(/Lifetime ×10/);
        expect(modal.textContent).not.toMatch(/Lifetime.*Luck/);
    });

    test('Luck has an explanatory tooltip that does not claim to be profitability', () => {
        const modal = buildModal();
        modalCallbacks().forEach((cb) => cb(modal));

        const luckSpan = [...modal.querySelectorAll('span')].find((el) => el.textContent === 'Luck');
        expect(luckSpan.title.toLowerCase()).toContain('actual loot value minus expected loot value');
        expect(luckSpan.title.toLowerCase()).toContain('is not opening profit');
    });
});

describe('per-item value labels (section 7)', () => {
    test('normal resolved items get a compact approximate label; Coin never gets one', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));

        const items = itemContainersOf(modal);
        expect(items[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull(); // Coin
        expect(items[1].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('≈400K');
        expect(items[2].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('≈1.06K');
    });

    test('resolved value of exactly zero shows ≈0, not unavailable', () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [
                { itemHrid: '/items/worthless_item', enhancementLevel: 0, count: 1, value: 0, resolved: true },
            ],
        });
        const modal = buildModal(1);
        modalCallbacks().forEach((cb) => cb(modal));

        expect(itemContainersOf(modal)[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('≈0');
    });

    test('an unresolved item renders no tiny label at all (not a fabricated N/A)', () => {
        mocks.latestRecord = monetaryRecord({
            actualValueBreakdown: [
                { itemHrid: '/items/mystery', enhancementLevel: 0, count: 1, value: 0, resolved: false },
            ],
        });
        const modal = buildModal(1);
        modalCallbacks().forEach((cb) => cb(modal));

        expect(itemContainersOf(modal)[0].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull();
    });

    test('re-rendering updates labels in place rather than adding a second one', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        modalCallbacks().forEach((cb) => cb(modal));

        const items = itemContainersOf(modal);
        expect(items[1].querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`)).toHaveLength(1);
    });

    test('DOM item-count/breakdown mismatch clears any previously stamped labels before failing closed', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        expect(itemContainersOf(modal)[1].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).not.toBeNull();

        // A rare special-cased render adds a 4th icon the breakdown doesn't account for.
        const extra = document.createElement('div');
        extra.className = 'Item_itemContainer__extra';
        modal.querySelector('[class*="Inventory_gainedItems"]').appendChild(extra);

        expect(() => modalCallbacks().forEach((cb) => cb(modal))).not.toThrow();
        itemContainersOf(modal).forEach((item) => {
            expect(item.querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull();
        });
    });

    test('the item-level observer relabels using the current DOM state when new item icons are inserted directly', () => {
        const modal = buildModal(3);
        itemCallbacks().forEach((cb) => cb(itemContainersOf(modal)[0]));

        const items = itemContainersOf(modal);
        expect(items[1].querySelector(`.${ITEM_VALUE_LABEL_CLASS}`).textContent).toBe('≈400K');
    });

    test('the item-level observer ignores an item icon outside any tracked Openable Analytics modal', () => {
        const strayItem = document.createElement('div');
        strayItem.className = 'Item_itemContainer__x7kH1';
        document.body.appendChild(strayItem);

        expect(() => itemCallbacks().forEach((cb) => cb(strayItem))).not.toThrow();
        expect(strayItem.querySelector(`.${ITEM_VALUE_LABEL_CLASS}`)).toBeNull();
    });
});

describe('cleanup and stale callback safety (section 8)', () => {
    test('cleanup removes the footer and all item labels from the DOM', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(1);
        expect(modal.querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`).length).toBeGreaterThan(0);

        openableAnalyticsModalInjector.cleanup();

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
        expect(modal.querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`)).toHaveLength(0);
    });

    test('a stale modal-observer callback captured before cleanup cannot reinject after cleanup', () => {
        const staleModalCallback = modalCallbacks()[0];
        openableAnalyticsModalInjector.cleanup();

        const modal = buildModal(3);
        expect(() => staleModalCallback(modal)).not.toThrow();

        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });

    test('a stale item-observer callback captured before cleanup cannot reinject after cleanup', () => {
        const staleItemCallback = itemCallbacks()[0];
        openableAnalyticsModalInjector.cleanup();

        const modal = buildModal(3);
        expect(() => staleItemCallback(itemContainersOf(modal)[0])).not.toThrow();

        expect(modal.querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`)).toHaveLength(0);
    });

    test('a stale data-driven update captured before cleanup cannot reinject after cleanup', () => {
        const modal = buildModal(3);
        modalCallbacks().forEach((cb) => cb(modal));
        openableAnalyticsModalInjector.cleanup();

        expect(() => mocks.unsubscribeCollectorCallbacks.forEach((cb) => cb(mocks.latestRecord))).not.toThrow();
        expect(modal.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    });
});

test('MODAL_CONTENT_CLASS targets the Inventory panel modal content class', () => {
    expect(MODAL_CONTENT_CLASS).toBe('Inventory_modalContent');
});
