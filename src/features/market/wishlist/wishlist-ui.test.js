/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    observerCallback: null,
    unregister: vi.fn(),
    navigateToMarketplace: vi.fn(() => true),
    canOpenInMarketplace: vi.fn(() => true),
    coins: 1000,
}));

vi.mock('../../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, _classes, callback) => {
            mocks.observerCallback = callback;
            return mocks.unregister;
        }),
    },
}));
vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getInventory: vi.fn(() => [{ itemHrid: '/items/coin', count: mocks.coins }]),
        getItemDetails: vi.fn((hrid) => ({ name: hrid.split('/').pop() })),
    },
}));
vi.mock('../../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    default: { getLocale: () => 'en' },
}));
vi.mock('../../../utils/game-i18n.js', () => ({ getItemName: (_hrid, fallback) => fallback }));
vi.mock('../../../utils/marketplace-tabs.js', () => ({
    getVisibleMarketplaceTabContainer: () => document.querySelector('[role="tablist"]'),
    navigateToMarketplace: mocks.navigateToMarketplace,
    canOpenInMarketplace: mocks.canOpenInMarketplace,
}));

const { WishlistStore, getWishlistKey } = await import('./wishlist-store.js');
const { default: WishlistUI, TAB_ATTR, PANEL_CLASS, ACTIVE_CLASS } = await import('./wishlist-ui.js');

vi.mock('../../../core/storage.js', () => ({
    default: { getJSON: vi.fn(async (_k, _s, fallback) => fallback), setJSON: vi.fn(async () => {}) },
}));

const MARKETPLACE_HTML = `
    <div class="MarketplacePanel_marketplacePanel__x">
        <div class="TabsComponent_tabsComponent__x" id="tabs">
            <div class="TabsComponent_tabsContainer__x">
                <div class="MuiTabs-root">
                    <div class="MuiTabs-scroller">
                        <div class="MuiTabs-flexContainer" role="tablist">
                            <button role="tab" class="MuiTab-root Mui-selected" aria-selected="true" id="t1" aria-controls="p1">
                                <span class="TabsComponent_badge__x">Market Listings</span>
                            </button>
                            <button role="tab" class="MuiTab-root" aria-selected="false" id="t2" aria-controls="p2">
                                <span class="TabsComponent_badge__x">My Listings <span class="MuiBadge-badge">0</span></span>
                            </button>
                            <button role="tab" class="MuiTab-root" aria-selected="false" data-mwi-market-history-tab="true">
                                <span class="TabsComponent_badge__x">Market History</span>
                            </button>
                        </div>
                        <span class="MuiTabs-indicator"></span>
                    </div>
                </div>
            </div>
            <div class="TabsComponent_tabPanelsContainer__x">
                <div class="TabPanel_tabPanel__x" id="p1"></div>
                <div class="TabPanel_tabPanel__x TabPanel_hidden__x" id="p2"></div>
            </div>
        </div>
    </div>`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WishlistUI', () => {
    let store;
    let ui;
    let prices;

    const tab = () => document.querySelector(`[${TAB_ATTR}]`);
    const panel = () => document.querySelector(`.${PANEL_CLASS}`);
    const rows = () => [...document.querySelectorAll('.mwi-wishlist-row')];

    beforeEach(async () => {
        document.body.innerHTML = MARKETPLACE_HTML;
        mocks.coins = 1000;
        mocks.navigateToMarketplace.mockClear();
        mocks.canOpenInMarketplace.mockReset().mockReturnValue(true);
        prices = {
            '/items/a:0': { price: 500, available: true, estimated: false },
            '/items/b:3': { price: 5000, available: true, estimated: true },
            '/items/c:0': { price: 0, available: false, estimated: false },
        };
        store = new WishlistStore();
        await store.load('c');
        await store.add('/items/a', 0);
        await store.add('/items/b', 3);
        ui = new WishlistUI({
            store,
            getPrice: async (item) => prices[getWishlistKey(item.itemHrid, item.enhancementLevel)],
        });
        ui.start();
    });

    afterEach(() => {
        ui.stop();
        document.body.innerHTML = '';
    });

    test('installs a tab after Market History and a panel of its own, leaving native elements alone', () => {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        expect(tabs.map((el) => el.textContent.trim())).toEqual([
            'Market Listings',
            'My Listings 0',
            'Market History',
            'marketWishlist.tabLabel❗',
        ]);
        expect(tab().querySelector('.mwi-wishlist-tab-label').textContent).toBe('marketWishlist.tabLabel');
        // A clone must not duplicate the native identity
        expect(tab().id).toBe('');
        expect(tab().hasAttribute('aria-controls')).toBe(false);
        expect(tab().getAttribute('aria-selected')).toBe('false');

        expect(panel().parentElement.className).toContain('tabPanelsContainer');
        expect(document.getElementById('p1').className).toBe('TabPanel_tabPanel__x');
        expect(document.getElementById('p2').className).toBe('TabPanel_tabPanel__x TabPanel_hidden__x');
    });

    test('the tab ❗ is hidden until asked for, and survives a remount', () => {
        const alert = () => tab().querySelector('.mwi-wishlist-tab-alert');
        expect(alert().hidden).toBe(true);

        ui.setTabAlert(true);
        expect(alert().hidden).toBe(false);

        document.body.innerHTML = MARKETPLACE_HTML;
        mocks.observerCallback();
        expect(alert().hidden).toBe(false);

        ui.setTabAlert(false);
        expect(alert().hidden).toBe(true);
    });

    test('is idempotent', () => {
        ui.ensureInstalled();
        ui.ensureInstalled();

        expect(document.querySelectorAll(`[${TAB_ATTR}]`)).toHaveLength(1);
        expect(document.querySelectorAll(`.${PANEL_CLASS}`)).toHaveLength(1);
    });

    test('clicking the tab activates it and renders the list in order', async () => {
        tab().click();
        await flush();

        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(true);
        expect(tab().classList.contains('Mui-selected')).toBe(true);
        expect(tab().getAttribute('aria-selected')).toBe('true');
        expect(rows().map((row) => row.dataset.wishlistKey)).toEqual(['/items/a:0', '/items/b:3']);
        expect(rows()[1].textContent).toContain('b +3');
        // The native tab that was selected stops looking selected, and is restored on exit
        expect(document.getElementById('t1').hasAttribute('data-mwi-wishlist-restyled')).toBe(true);
    });

    test('shows affordability against the current coins', async () => {
        tab().click();
        await flush();

        expect(rows()[0].querySelector('.mwi-wishlist-afford').textContent).toBe('marketWishlist.canAfford');
        expect(rows()[1].querySelector('.mwi-wishlist-afford').textContent).toContain('"amount":"4,000"');
        expect(document.querySelector('.mwi-wishlist-coins').textContent).toContain('"coins":"1,000"');
    });

    test('tags estimated prices and shows "no price" when nothing could price an item', async () => {
        await store.add('/items/c', 0);
        tab().click();
        await flush();

        expect(rows()[0].querySelector('.mwi-wishlist-est')).toBeNull();
        expect(rows()[1].querySelector('.mwi-wishlist-est')).not.toBeNull();
        expect(rows()[2].querySelector('.mwi-wishlist-price').textContent).toBe('marketWishlist.noPrice');
        expect(rows()[2].querySelector('.mwi-wishlist-afford').textContent).toBe('');
    });

    test('an empty list shows the empty message', async () => {
        await store.remove('/items/a', 0);
        await store.remove('/items/b', 3);
        tab().click();
        await flush();

        expect(rows()).toHaveLength(0);
        expect(document.querySelector('.mwi-wishlist-empty').textContent).toBe('marketWishlist.emptyMessage');
    });

    test('clicking a native tab deactivates the wishlist and restores the native look', async () => {
        tab().click();
        await flush();

        document.getElementById('t2').click();

        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(false);
        expect(tab().classList.contains('Mui-selected')).toBe(false);
        expect(document.getElementById('t1').hasAttribute('data-mwi-wishlist-restyled')).toBe(false);
        expect(document.getElementById('t1').style.color).toBe('');
    });

    test('clicking the Market History tab leaves the wishlist active', async () => {
        tab().click();
        await flush();

        document.querySelector('[data-mwi-market-history-tab]').click();

        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(true);
    });

    test('deactivates when the game itself selects another tab', async () => {
        tab().click();
        await flush();

        document.getElementById('t2').setAttribute('aria-selected', 'true');
        await flush();

        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(false);
    });

    test('Buy leaves the wishlist and opens the item in the marketplace at its enhancement level', async () => {
        tab().click();
        await flush();

        rows()[1].querySelector('.mwi-wishlist-buy').click();

        expect(mocks.navigateToMarketplace).toHaveBeenCalledWith('/items/b', 3);
        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(false);
    });

    test('Buy is disabled for an item that cannot be bought on the market', async () => {
        mocks.canOpenInMarketplace.mockReturnValue(false);
        tab().click();
        await flush();

        const buy = rows()[0].querySelector('.mwi-wishlist-buy');
        expect(buy.disabled).toBe(true);
        buy.click();
        expect(mocks.navigateToMarketplace).not.toHaveBeenCalled();
    });

    test('the remove button takes the item off the list', async () => {
        tab().click();
        await flush();

        rows()[0].querySelector('.mwi-wishlist-remove').click();
        await flush();

        expect(store.getItems().map((i) => i.itemHrid)).toEqual(['/items/b']);
    });

    test('dropping a row after another reorders the list', async () => {
        tab().click();
        await flush();
        const [first, second] = rows();
        second.getBoundingClientRect = () => ({ top: 0, height: 40 });

        first.dispatchEvent(new Event('dragstart', { bubbles: true }));
        const over = new Event('dragover', { bubbles: true, cancelable: true });
        over.clientY = 35;
        second.dispatchEvent(over);
        second.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
        await flush();

        expect(store.getItems().map((i) => i.itemHrid)).toEqual(['/items/b', '/items/a']);
    });

    test('a marketplace remount gets a fresh tab and panel', () => {
        document.body.innerHTML = MARKETPLACE_HTML;
        mocks.observerCallback();

        expect(document.querySelectorAll(`[${TAB_ATTR}]`)).toHaveLength(1);
        expect(document.querySelectorAll(`.${PANEL_CLASS}`)).toHaveLength(1);
    });

    test('stop removes everything it added', async () => {
        tab().click();
        await flush();

        ui.stop();

        expect(tab()).toBeNull();
        expect(panel()).toBeNull();
        expect(document.getElementById('tabs').classList.contains(ACTIVE_CLASS)).toBe(false);
        expect(document.getElementById('t1').style.color).toBe('');
        expect(mocks.unregister).toHaveBeenCalled();
    });
});
