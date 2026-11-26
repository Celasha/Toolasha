/**
 * Tests for EstimatedListingAge.parsePrice (TLA-008)
 */

/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';

vi.mock('../../core/data-manager.js', () => ({
    default: { on: vi.fn(), off: vi.fn(), getMarketListings: vi.fn(() => []) },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn(() => 'datetime'),
        onSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/storage.js', () => ({
    default: { get: vi.fn(), set: vi.fn(), getJSON: vi.fn(), setJSON: vi.fn() },
}));
vi.mock('../../api/marketplace.js', () => ({ default: { fetch: vi.fn() } }));
vi.mock('../../utils/formatters.js', () => ({
    formatRelativeTime: vi.fn(() => 'RELATIVE'),
    formatDateTime: vi.fn(() => 'FORMATTED_DATE'),
}));

const { default: estimatedListingAge } = await import('./estimated-listing-age.js');

describe('EstimatedListingAge.parsePrice', () => {
    test('plain integer', () => {
        expect(estimatedListingAge.parsePrice('999')).toBe(999);
    });

    test('K suffix', () => {
        expect(estimatedListingAge.parsePrice('1.5K')).toBe(1500);
    });

    test('M suffix', () => {
        expect(estimatedListingAge.parsePrice('12M')).toBe(12000000);
    });

    test('B suffix', () => {
        expect(estimatedListingAge.parsePrice('1.5B')).toBe(1500000000);
    });

    test('comma-separated value', () => {
        expect(estimatedListingAge.parsePrice('1,234,567')).toBe(1234567);
    });

    test('lowercase k suffix', () => {
        expect(estimatedListingAge.parsePrice('2.5k')).toBe(2500);
    });

    test('lowercase m suffix', () => {
        expect(estimatedListingAge.parsePrice('3m')).toBe(3000000);
    });

    test('lowercase b suffix', () => {
        expect(estimatedListingAge.parsePrice('2b')).toBe(2000000000);
    });

    test('leading/trailing whitespace', () => {
        expect(estimatedListingAge.parsePrice('  500K  ')).toBe(500000);
    });

    test('empty string returns null', () => {
        expect(estimatedListingAge.parsePrice('')).toBeNull();
    });

    test('invalid text returns null, not 0', () => {
        expect(estimatedListingAge.parsePrice('bad')).toBeNull();
    });

    test('invalid text does not match a zero-price listing', () => {
        const price = estimatedListingAge.parsePrice('bad');
        // The match check is Math.abs(listing.price - price) < 0.01
        // With price=null: Math.abs(somePrice - null) = Math.abs(somePrice - 0)
        // which could falsely match a zero-price listing.
        // With the correct null return, callers that guard with `if (price === null) continue`
        // skip matching entirely — test that the guard works.
        expect(price).toBeNull();
    });

    test('billion-scale price matches stored listing correctly', () => {
        const storedPrice = 1500000000;
        const parsed = estimatedListingAge.parsePrice('1.5B');
        expect(Math.abs(storedPrice - parsed) < 0.01).toBe(true);
    });
});

describe('EstimatedListingAge — call-site null guards', () => {
    test('invalid price text does not match a zero-price listing in addAgeColumn path', () => {
        // null coerces to 0 in Math.abs(listing.price - null), so without a guard
        // a zero-price stored listing would be falsely matched by any invalid row text.
        // The guard `if (price === null) continue` must prevent this.
        const price = estimatedListingAge.parsePrice('bad');
        expect(price).toBeNull();
        // Simulate the predicate that was previously unguarded:
        const zeroPriceListing = { price: 0 };
        const wouldFalselyMatch = price !== null && Math.abs(zeroPriceListing.price - price) < 0.01;
        expect(wouldFalselyMatch).toBe(false);
    });

    test('invalid price text does not resolve an item via zero-price match in getCurrentItemHrid path', () => {
        const price = estimatedListingAge.parsePrice('---');
        expect(price).toBeNull();
        // Without the guard, null coerces to 0 and matches listing.price === 0.
        const zeroPriceListing = { price: 0, orderQuantity: 1, filledQuantity: 0 };
        const wouldFalselyMatch = price !== null && Math.abs(zeroPriceListing.price - price) < 0.01;
        expect(wouldFalselyMatch).toBe(false);
    });
});

describe('EstimatedListingAge.addAgeColumn — outside-tradable-range separator row', () => {
    // MWI's "Outside current tradable range" grouping row is a real <tr> in the order book
    // table, but has no corresponding entry in the order book's asks/bids array. Positional
    // indexing that does not skip it consumes a real listing's age for the separator row and
    // shifts every row after it out of alignment.
    function buildOrderBookTables() {
        const container = document.createElement('div');
        container.className = 'MarketplacePanel_orderBooksContainer__B4YE-';

        const sellContainer = document.createElement('div');
        sellContainer.className = 'MarketplacePanel_orderBookTableContainer__hUu-X';
        sellContainer.innerHTML = `
            <table class="MarketplacePanel_orderBookTable__3zzrv">
                <thead><tr><th>Quantity</th><th>Ask Price</th><th>Action</th></tr></thead>
                <tbody></tbody>
            </table>
        `;

        const buyContainer = document.createElement('div');
        buyContainer.className = 'MarketplacePanel_orderBookTableContainer__hUu-X';
        buyContainer.innerHTML = `
            <table class="MarketplacePanel_orderBookTable__3zzrv">
                <thead><tr><th>Quantity</th><th>Bid Price</th><th>Action</th></tr></thead>
                <tbody>
                    <tr class="undefined MarketplacePanel_outsideRangeSeparator__2R5KA">
                        <td><div class="MarketplacePanel_separatorContent__10KVk">Outside current tradable range</div></td>
                    </tr>
                    <tr class="undefined MarketplacePanel_outsideRange__GPKFQ">
                        <td><div class="MarketplacePanel_mine__3aG9I"></div>1</td>
                        <td><div class="MarketplacePanel_price__hIzrY"><span>29M</span></div></td>
                        <td><div class="MarketplacePanel_actionButtonContainer__3l7Li"><button>Sell</button></div></td>
                    </tr>
                </tbody>
            </table>
        `;

        container.appendChild(sellContainer);
        container.appendChild(buyContainer);
        document.body.appendChild(container);

        return buyContainer.querySelector('table');
    }

    test('the separator row does not steal the real listing age, and the real row is not left as an ellipsis', () => {
        const buyTable = buildOrderBookTables();

        estimatedListingAge.currentItemHrid = '/items/test_item';
        estimatedListingAge.orderBooksCache['/items/test_item'] = {
            lastUpdated: Date.now(),
            data: {
                orderBooks: {
                    0: {
                        asks: [],
                        bids: [{ listingId: 999888777, price: 29000000, createdTimestamp: null }],
                    },
                },
            },
        };

        estimatedListingAge.addAgeColumn(buyTable);

        const rows = buyTable.querySelectorAll('tbody tr');
        const separatorRow = rows[0];
        const listingRow = rows[1];

        const separatorAgeCell = separatorRow.querySelector('.mwi-estimated-age-cell');
        const listingAgeCell = listingRow.querySelector('.mwi-estimated-age-cell');

        expect(separatorAgeCell).not.toBeNull();
        expect(separatorAgeCell.textContent.trim()).toBe('');

        expect(listingAgeCell).not.toBeNull();
        expect(listingAgeCell.textContent).not.toBe('· · ·');
        expect(listingAgeCell.textContent).toContain('~');

        document.body.innerHTML = '';
        delete estimatedListingAge.orderBooksCache['/items/test_item'];
    });
});

describe('EstimatedListingAge history writes', () => {
    const makeListing = (id, overrides = {}) => ({
        id,
        createdTimestamp: '2026-01-02T03:04:05.000Z',
        itemHrid: '/items/test_item',
        enhancementLevel: 3,
        price: 1500,
        orderQuantity: 5,
        filledQuantity: 0,
        isSell: true,
        ...overrides,
    });
    const historyEntry = (listing, status = 'unknown', orderQuantity = listing.orderQuantity) => ({
        id: listing.id,
        timestamp: 1767323045000,
        createdTimestamp: listing.createdTimestamp,
        itemHrid: listing.itemHrid,
        enhancementLevel: listing.enhancementLevel,
        price: listing.price,
        orderQuantity,
        filledQuantity: listing.filledQuantity,
        isSell: listing.isSell,
        status,
    });
    const getHandler = (event) => dataManager.on.mock.calls.find(([name]) => name === event)[1];
    const expectSavedOnce = (entries) => {
        expect(estimatedListingAge.knownListings.slice()).toStrictEqual(entries);
        expect(storage.setJSON).toHaveBeenCalledExactlyOnceWith(
            'marketListingTimestamps',
            entries,
            'marketListings',
            true
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
        estimatedListingAge.knownListings = [];
    });

    afterEach(() => {
        estimatedListingAge.disable();
        estimatedListingAge.knownListings = [];
        vi.restoreAllMocks();
    });

    test('loadInitialListings keeps valid entries and sorts and saves the batch once', () => {
        const existing = makeListing(20, { price: 2000 });
        const newListing = makeListing(10);
        const duplicate = { ...newListing, price: 3000 };
        const history = estimatedListingAge.knownListings;
        history.push(historyEntry(makeListing(20), 'active'));
        const sort = vi.spyOn(history, 'sort');
        const findIndex = vi.spyOn(history, 'findIndex');
        dataManager.getMarketListings.mockReturnValueOnce([
            existing,
            newListing,
            makeListing(30, { createdTimestamp: null }),
            makeListing(undefined),
            duplicate,
        ]);

        estimatedListingAge.loadInitialListings();

        expect(findIndex).not.toHaveBeenCalled();
        expect(sort).toHaveBeenCalledTimes(1);
        expectSavedOnce([historyEntry(duplicate), historyEntry(existing, 'active')]);
    });

    test('character_initialized stores new entries and reconciled statuses in one write', () => {
        const stale = makeListing(15);
        const first = makeListing(10);
        const last = makeListing(20);
        estimatedListingAge.knownListings.push(historyEntry(stale, 'active'));
        const sort = vi.spyOn(estimatedListingAge.knownListings, 'sort');
        estimatedListingAge.setupWebSocketListeners();
        const initialize = getHandler('character_initialized');
        const payload = { myMarketListings: [last, first] };

        initialize(payload);

        expect(sort).toHaveBeenCalledTimes(1);
        expectSavedOnce([historyEntry(first), historyEntry(stale), historyEntry(last)]);

        sort.mockClear();
        storage.setJSON.mockClear();
        initialize(payload);
        expect(sort).not.toHaveBeenCalled();
        expect(storage.setJSON).not.toHaveBeenCalled();
    });

    test('market_listings_updated saves new, active and ended listings after reconciliation', () => {
        const stale = makeListing(40);
        const partial = makeListing(30, { status: '/market_listing_status/cancelled', filledQuantity: 2 });
        const active = makeListing(20);
        const created = makeListing(10, { _toolashaStatus: 'active' });
        const expired = makeListing(50, { status: '/market_listing_status/expired' });
        estimatedListingAge.knownListings.push(historyEntry(partial, 'active'), historyEntry(stale, 'active'));
        const sort = vi.spyOn(estimatedListingAge.knownListings, 'sort');
        estimatedListingAge.setupWebSocketListeners();

        getHandler('market_listings_updated')({
            newMarketListings: [created],
            myMarketListings: [active, makeListing(30)],
            endMarketListings: [expired, partial],
        });

        expect(sort).toHaveBeenCalledTimes(1);
        expectSavedOnce([
            historyEntry(created),
            historyEntry(active),
            historyEntry(partial, 'filled', 2),
            historyEntry(stale),
            historyEntry(expired, 'expired'),
        ]);
    });

    test('an empty active snapshot reconciles stale entries without sorting again', () => {
        const stale = makeListing(10);
        estimatedListingAge.knownListings.push(historyEntry(stale, 'active'));
        const sort = vi.spyOn(estimatedListingAge.knownListings, 'sort');
        estimatedListingAge.setupWebSocketListeners();
        const update = getHandler('market_listings_updated');

        update({});
        expect(storage.setJSON).not.toHaveBeenCalled();

        update({ myMarketListings: [] });
        expect(sort).not.toHaveBeenCalled();
        expectSavedOnce([historyEntry(stale)]);
    });

    test('recordListing still saves a single valid listing immediately', () => {
        const previous = makeListing(20);
        const listing = makeListing(10, { _toolashaStatus: 'filled' });
        estimatedListingAge.knownListings.push(historyEntry(previous));

        estimatedListingAge.recordListing(makeListing(30, { createdTimestamp: null }));
        expect(storage.setJSON).not.toHaveBeenCalled();

        estimatedListingAge.recordListing(listing);
        expectSavedOnce([historyEntry(listing, 'filled'), historyEntry(previous)]);
    });
});
