/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settings: { marketWishlist: true },
    callbacks: {},
    coins: 0,
    marketListeners: [],
    settingCallbacks: {},
    uiInstances: [],
    connected: true,
    marketLoaded: true,
    prices: {},
    details: { '/items/sword': { isTradable: true }, '/items/bound': { isTradable: false } },
}));

vi.mock('../../../core/config.js', () => ({
    default: {
        getSetting: (key) => mocks.settings[key],
        onSettingChange: (key, cb) => {
            (mocks.settingCallbacks[key] ||= []).push(cb);
        },
        offSettingChange: (key, cb) => {
            mocks.settingCallbacks[key] = (mocks.settingCallbacks[key] || []).filter((fn) => fn !== cb);
        },
    },
}));
vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: () => 'char-1',
        getItemDetails: (hrid) => mocks.details[hrid],
        on: vi.fn(),
        off: vi.fn(),
    },
}));
vi.mock('../../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((name, _classes, callback) => {
            mocks.callbacks[name] = callback;
            return vi.fn();
        }),
    },
}));
vi.mock('../../../core/connection-state.js', () => ({ default: { isConnected: () => mocks.connected } }));
vi.mock('../../../api/marketplace.js', () => ({
    default: {
        isLoaded: () => mocks.marketLoaded,
        on: (cb) => mocks.marketListeners.push(cb),
        off: (cb) => {
            mocks.marketListeners = mocks.marketListeners.filter((fn) => fn !== cb);
        },
    },
}));
vi.mock('../../../core/i18n.js', () => ({ t: (key) => key, default: { getLocale: () => 'en' } }));
vi.mock('../../../utils/game-lookups.js', () => ({
    getItemHridFromName: (name) => ({ Sword: '/items/sword', Bound: '/items/bound' })[name] ?? null,
}));
vi.mock('../../../utils/marketplace-tabs.js', () => ({ isElementActuallyVisible: () => true }));
vi.mock('./wishlist-pricing.js', () => ({
    getCoinBalance: () => mocks.coins,
    getWishlistPrice: vi.fn(
        async (item) =>
            mocks.prices[`${item.itemHrid}:${item.enhancementLevel || 0}`] ?? {
                price: 0,
                available: false,
                estimated: false,
            }
    ),
}));
vi.mock('./wishlist-ui.js', () => ({
    default: class {
        constructor(deps) {
            this.deps = deps;
            this.start = vi.fn();
            this.stop = vi.fn();
            this.render = vi.fn();
            this.setTabAlert = vi.fn();
            this.active = false;
            mocks.uiInstances.push(this);
        }
    },
}));
vi.mock('../../../core/storage.js', () => ({
    default: { getJSON: vi.fn(async (_k, _s, fallback) => fallback), setJSON: vi.fn(async () => {}) },
}));

const { MarketWishlist } = await import('./wishlist.js');
const { default: wishlistStore } = await import('./wishlist-store.js');
const { default: wishlistHistory } = await import('./wishlist-history.js');

function buildMenu({ name = 'Sword', enhancement = '' } = {}) {
    document.body.innerHTML = `
        <div class="MarketplacePanel_marketplacePanel__x"></div>
        <div class="Item_actionMenu__x">
            <div class="Item_name__x">${name}</div>
            ${enhancement ? `<div class="Item_enhancementLevel__x">${enhancement}</div>` : ''}
            <button class="Button_button__x">Open Item Dictionary</button>
            <button class="Button_button__x">Add to Tab</button>
        </div>`;
    return document.querySelector('.Item_actionMenu__x');
}

describe('MarketWishlist', () => {
    let feature;

    beforeEach(() => {
        mocks.settings = { marketWishlist: true };
        mocks.connected = true;
        mocks.marketLoaded = true;
        mocks.uiInstances = [];
        mocks.callbacks = {};
        mocks.coins = 0;
        mocks.marketListeners = [];
        mocks.settingCallbacks = {};
        mocks.prices = { '/items/sword:0': { price: 1000, available: true, estimated: false } };
        feature = new MarketWishlist();
    });

    afterEach(() => {
        feature.cleanup();
        document.body.innerHTML = '';
    });

    test('does nothing while the setting is off', async () => {
        mocks.settings.marketWishlist = false;

        await feature.initialize();

        expect(mocks.uiInstances).toHaveLength(0);
        expect(feature.isInitialized).toBe(false);
    });

    test('starts the tab UI when enabled', async () => {
        await feature.initialize();

        expect(mocks.uiInstances).toHaveLength(1);
        expect(mocks.uiInstances[0].start).toHaveBeenCalled();
    });

    test('adds an Add to Wishlist button to a marketplace item menu, after the last button', async () => {
        await feature.initialize();
        const menu = buildMenu();

        mocks.callbacks.MarketWishlist_itemAction(menu);

        const button = menu.querySelector('.mwi-wishlist-menu-btn');
        expect(button.textContent).toBe('marketWishlist.addToMenu');
        expect(button.previousElementSibling.textContent).toBe('Add to Tab');
        expect(button.className).toContain('Button_button__x');
    });

    test('clicking it adds the item (with its enhancement level) and the label becomes Remove', async () => {
        await feature.initialize();
        const menu = buildMenu({ enhancement: '+7' });
        mocks.callbacks.MarketWishlist_itemAction(menu);
        const button = menu.querySelector('.mwi-wishlist-menu-btn');

        button.click();
        await vi.waitFor(() => expect(button.textContent).toBe('marketWishlist.removeFromMenu'));
        expect(wishlistStore.has('/items/sword', 7)).toBe(true);

        button.click();
        await vi.waitFor(() => expect(button.textContent).toBe('marketWishlist.addToMenu'));
        expect(wishlistStore.has('/items/sword', 7)).toBe(false);
    });

    test('shows Remove right away for an item that is already listed', async () => {
        await feature.initialize();
        await wishlistStore.add('/items/sword', 0);
        const menu = buildMenu();

        mocks.callbacks.MarketWishlist_itemAction(menu);

        expect(menu.querySelector('.mwi-wishlist-menu-btn').textContent).toBe('marketWishlist.removeFromMenu');
    });

    test('does not add the button for an untradable item, an unknown item, or outside the marketplace', async () => {
        await feature.initialize();

        const bound = buildMenu({ name: 'Bound' });
        mocks.callbacks.MarketWishlist_itemAction(bound);
        expect(bound.querySelector('.mwi-wishlist-menu-btn')).toBeNull();

        const unknown = buildMenu({ name: 'Mystery' });
        mocks.callbacks.MarketWishlist_itemAction(unknown);
        expect(unknown.querySelector('.mwi-wishlist-menu-btn')).toBeNull();

        const noMarketplace = buildMenu();
        document.querySelector('.MarketplacePanel_marketplacePanel__x').remove();
        mocks.callbacks.MarketWishlist_itemAction(noMarketplace);
        expect(noMarketplace.querySelector('.mwi-wishlist-menu-btn')).toBeNull();
    });

    test('never adds the button twice to one menu', async () => {
        await feature.initialize();
        const menu = buildMenu();

        mocks.callbacks.MarketWishlist_itemAction(menu);
        mocks.callbacks.MarketWishlist_itemAction(menu);

        expect(menu.querySelectorAll('.mwi-wishlist-menu-btn')).toHaveLength(1);
    });

    test('adding an item starts its price history immediately', async () => {
        await feature.initialize();

        await wishlistStore.add('/items/sword', 0);
        await vi.waitFor(() => expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(1));

        expect(wishlistHistory.getSeries('/items/sword:0')[0].slice(1)).toEqual([1000, 0]);
    });

    test('removing an item deletes its history', async () => {
        await feature.initialize();
        await wishlistStore.add('/items/sword', 0);
        await vi.waitFor(() => expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(1));

        await wishlistStore.remove('/items/sword', 0);

        await vi.waitFor(() => expect(wishlistHistory.getSeries('/items/sword:0')).toEqual([]));
    });

    test('samples nothing while disconnected or before market data has loaded', async () => {
        await feature.initialize();
        await wishlistStore.add('/items/sword', 0);
        await vi.waitFor(() => expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(1));
        const before = wishlistHistory.getSeries('/items/sword:0').length;

        mocks.connected = false;
        mocks.prices['/items/sword:0'] = { price: 2000, available: true, estimated: false };
        await feature.sampleAll();
        mocks.connected = true;
        mocks.marketLoaded = false;
        await feature.sampleAll();

        expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(before);
    });

    test('opening the tab does not sample again within the minimum gap', async () => {
        await feature.initialize();
        await wishlistStore.add('/items/sword', 0);
        await vi.waitFor(() => expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(1));

        mocks.prices['/items/sword:0'] = { price: 2000, available: true, estimated: false };
        await feature.sampleAll(10 * 60 * 1000);

        expect(wishlistHistory.getSeries('/items/sword:0')).toHaveLength(1);
    });

    test('an item with no price is skipped, not recorded as zero', async () => {
        await feature.initialize();
        mocks.prices['/items/sword:0'] = { price: 0, available: false, estimated: false };

        await wishlistStore.add('/items/sword', 0);
        await feature.sampleAll();

        expect(wishlistHistory.getSeries('/items/sword:0')).toEqual([]);
    });

    test('cleanup stops the UI and removes menu buttons', async () => {
        await feature.initialize();
        const menu = buildMenu();
        mocks.callbacks.MarketWishlist_itemAction(menu);
        const ui = mocks.uiInstances[0];

        feature.cleanup();

        expect(ui.stop).toHaveBeenCalled();
        expect(menu.querySelector('.mwi-wishlist-menu-btn')).toBeNull();
        expect(feature.isInitialized).toBe(false);
    });

    describe('affordability alert', () => {
        const NAV_HTML = `
            <div class="NavigationBar_nav__x" id="other">
                <svg aria-label="navigationBar.tasks"></svg>
                <div class="NavigationBar_textContainer__x"><span>Tasks</span></div>
            </div>
            <div class="NavigationBar_nav__x" id="market">
                <svg aria-label="navigationBar.marketplace"></svg>
                <div class="NavigationBar_textContainer__x"><span>Marketplace</span></div>
            </div>`;
        const navAlerts = () => document.querySelectorAll('.mwi-wishlist-nav-alert');

        beforeEach(() => {
            document.body.innerHTML = NAV_HTML;
            mocks.prices['/items/sword:0'] = { price: 1000, available: true, estimated: false };
            mocks.prices['/items/shield:0'] = { price: 50, available: true, estimated: false };
            mocks.details['/items/shield'] = { isTradable: true };
        });

        async function start({ tab = true, nav = true } = {}) {
            mocks.settings.marketWishlist_alertTab = tab;
            mocks.settings.marketWishlist_alertNav = nav;
            await feature.initialize();
        }

        test('shows the tab ❗ and the sidebar ❗ once the first item is affordable', async () => {
            mocks.coins = 1500;
            await feature.initialize();
            await wishlistStore.add('/items/sword', 0);
            await start();
            await feature.refreshAlert();

            expect(mocks.uiInstances[0].setTabAlert).toHaveBeenLastCalledWith(true);
            expect(navAlerts()).toHaveLength(1);
            expect(document.querySelector('#market .mwi-wishlist-nav-alert')).not.toBeNull();
            expect(document.querySelector('#other .mwi-wishlist-nav-alert')).toBeNull();
        });

        test('shows nothing while the coins do not cover the first item', async () => {
            mocks.coins = 999;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();

            expect(mocks.uiInstances[0].setTabAlert).toHaveBeenLastCalledWith(false);
            expect(navAlerts()).toHaveLength(0);
        });

        test('only the first item in line counts, however cheap the others are', async () => {
            mocks.coins = 100;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await wishlistStore.add('/items/shield', 0);
            await feature.refreshAlert();

            expect(navAlerts()).toHaveLength(0);

            await wishlistStore.reorder(['/items/shield:0', '/items/sword:0']);
            await feature.refreshAlert();

            expect(navAlerts()).toHaveLength(1);
        });

        test('each ❗ is behind its own setting', async () => {
            mocks.coins = 5000;
            await start({ tab: true, nav: false });
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();

            expect(mocks.uiInstances[0].setTabAlert).toHaveBeenLastCalledWith(true);
            expect(navAlerts()).toHaveLength(0);

            mocks.settings.marketWishlist_alertTab = false;
            mocks.settings.marketWishlist_alertNav = true;
            mocks.settingCallbacks.marketWishlist_alertNav.forEach((cb) => cb());
            await vi.waitFor(() => expect(navAlerts()).toHaveLength(1));
            expect(mocks.uiInstances[0].setTabAlert).toHaveBeenLastCalledWith(false);
        });

        test('an empty list or an item with no price never alerts', async () => {
            mocks.coins = 1e9;
            await start();
            await feature.refreshAlert();
            expect(navAlerts()).toHaveLength(0);

            mocks.prices['/items/sword:0'] = { price: 0, available: false, estimated: false };
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();
            expect(navAlerts()).toHaveLength(0);
        });

        test('a market data refresh re-evaluates the alert', async () => {
            mocks.coins = 900;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();
            expect(navAlerts()).toHaveLength(0);

            mocks.prices['/items/sword:0'] = { price: 800, available: true, estimated: false };
            mocks.marketListeners.forEach((cb) => cb());

            await vi.waitFor(() => expect(navAlerts()).toHaveLength(1));
        });

        test('puts the sidebar ❗ back after the sidebar re-renders', async () => {
            mocks.coins = 5000;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();
            expect(navAlerts()).toHaveLength(1);

            document.body.innerHTML = NAV_HTML;
            mocks.callbacks.MarketWishlist_nav();

            expect(navAlerts()).toHaveLength(1);
        });

        test('never stacks a second sidebar ❗', async () => {
            mocks.coins = 5000;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();
            await feature.refreshAlert();
            mocks.callbacks.MarketWishlist_nav();

            expect(navAlerts()).toHaveLength(1);
        });

        test('cleanup removes the sidebar ❗ and stops listening', async () => {
            mocks.coins = 5000;
            await start();
            await wishlistStore.add('/items/sword', 0);
            await feature.refreshAlert();

            feature.cleanup();

            expect(navAlerts()).toHaveLength(0);
            expect(mocks.marketListeners).toHaveLength(0);
            expect(mocks.settingCallbacks.marketWishlist_alertNav).toHaveLength(0);
        });
    });
});
