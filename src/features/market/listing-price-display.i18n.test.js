/**
 * Chinese-locale regression test for the sortable-header column mapping.
 *
 * BUG #23: 4 of 9 sortable columns ("Top Order Price/Age", "Total Price", "Listed") are
 * headers Toolasha injects itself — they have no key in the game's own i18n catalog, so
 * translating them via translateGameName('marketplacePanel', ...) silently never matches,
 * and clicking those headers to sort does nothing on a non-English client. The fix derives
 * their translated label from Toolasha's own t() (the same call that renders them) instead.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

// Real zh strings, from src/locales/zh/batch-d.js (Toolasha's own locale) — the headers this
// module itself renders. These do NOT exist in the game's own i18n catalog at all.
const zhToolashaStrings = {
    'listingPriceDisplay.topOrderPriceHeader': '最优订单价格',
    'listingPriceDisplay.topOrderAgeHeader': '最优订单时长',
    'listingPriceDisplay.totalPriceHeader': '总价',
    'listingPriceDisplay.listedHeader': '挂单时长',
};

// Real zh strings for the actual game-rendered marketplace table columns.
const zhGameStrings = {
    status: '状态',
    type: '类型',
    progress: '进度',
    price: '价格',
    collect: '领取',
};

vi.mock('../../core/data-manager.js', () => ({ default: { getMarketListings: vi.fn(() => []) } }));
vi.mock('../../core/dom-observer.js', () => ({ default: { register: vi.fn() } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => false) } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => zhToolashaStrings[key] ?? key }));
vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (_namespace, key, fallback) => zhGameStrings[key] ?? fallback,
}));
vi.mock('../../api/marketplace.js', () => ({
    default: { getPricesBatch: vi.fn(() => new Map()), on: vi.fn(), off: vi.fn() },
}));
vi.mock('./estimated-listing-age.js', () => ({
    default: {
        orderBooksCache: {},
        getStalenessTooltip: vi.fn(),
        getStalenessColor: vi.fn(),
        estimateTimestamp: vi.fn(),
    },
}));

const { default: listingPriceDisplay } = await import('./listing-price-display.js');

describe('_textToColKey — zh client (BUG #23)', () => {
    test.each([
        ['最优订单价格', 'topOrderPrice'],
        ['最优订单时长', 'topOrderAge'],
        ['总价', 'totalPrice'],
        ['挂单时长', 'listed'],
        ['状态', 'status'],
        ['类型', 'type'],
        ['进度', 'progress'],
        ['价格', 'price'],
        ['领取', 'collect'],
    ])('resolves Chinese header "%s" to colKey "%s"', (chineseText, expectedColKey) => {
        listingPriceDisplay._colKeyMap = null; // force rebuild under this test's mocks
        expect(listingPriceDisplay._textToColKey(chineseText)).toBe(expectedColKey);
    });

    test('still resolves the English headers too', () => {
        listingPriceDisplay._colKeyMap = null;
        expect(listingPriceDisplay._textToColKey('total price')).toBe('totalPrice');
        expect(listingPriceDisplay._textToColKey('listed')).toBe('listed');
    });
});
