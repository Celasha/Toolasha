/**
 * Marketplace Wishlist
 * Keep a per-character list of items you want to buy (equipment upgrades and the like), in the
 * order you want them. Items are added from the item action menu in the Marketplace, shown on a
 * "Wishlist" tab with their current price (net worth's pricing rules, so items with no sell
 * listing still get an estimate), and a price history is recorded from the moment each is added.
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import domObserver from '../../../core/dom-observer.js';
import connectionState from '../../../core/connection-state.js';
import marketAPI from '../../../api/marketplace.js';
import { t } from '../../../core/i18n.js';
import { createTimerRegistry } from '../../../utils/timer-registry.js';
import { getItemHridFromName } from '../../../utils/game-lookups.js';
import { isElementActuallyVisible } from '../../../utils/marketplace-tabs.js';
import wishlistStore, { getWishlistKey } from './wishlist-store.js';
import wishlistHistory from './wishlist-history.js';
import { getWishlistPrice, getCoinBalance } from './wishlist-pricing.js';
import { setNavAlert } from './wishlist-alert.js';
import WishlistUI from './wishlist-ui.js';

const SETTING_KEY = 'marketWishlist';
const SAMPLE_INTERVAL = 60 * 60 * 1000; // 1 hour, like the net worth history
const MIN_SAMPLE_GAP = 10 * 60 * 1000; // opening the tab never samples more often than this
const MENU_BUTTON_CLASS = 'mwi-wishlist-menu-btn';
const ALERT_TAB_SETTING = 'marketWishlist_alertTab';
const ALERT_NAV_SETTING = 'marketWishlist_alertNav';

class MarketWishlist {
    constructor() {
        this.isInitialized = false;
        this.ui = null;
        this.timerRegistry = createTimerRegistry();
        this.unregisterMenu = null;
        this.unsubscribeStore = null;
        this.itemsUpdatedHandler = null;
        this.itemsRefreshTimeout = null;
        this.knownKeys = new Set();
        this.alertToken = 0;
        this.navAlert = false;
        this.unregisterNav = null;
        this.priceUpdateHandler = null;
        this.alertSettingHandler = null;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting(SETTING_KEY)) return;
        this.isInitialized = true;

        const characterId = dataManager.getCurrentCharacterId();
        if (!characterId) {
            console.warn('[Wishlist] No character ID available');
            this.isInitialized = false;
            return;
        }

        await Promise.all([wishlistStore.load(characterId), wishlistHistory.load(characterId)]);
        if (!this.isInitialized) return; // disabled while loading
        this.knownKeys = this.currentKeys();

        this.ui = new WishlistUI({
            store: wishlistStore,
            getPrice: getWishlistPrice,
            onOpen: () => this.sampleAll(MIN_SAMPLE_GAP),
        });
        this.ui.start();

        this.unsubscribeStore = wishlistStore.onChange(() => this.handleStoreChange());

        this.unregisterMenu = domObserver.onClass('MarketWishlist_itemAction', 'Item_actionMenu', (menu) =>
            this.injectMenuButton(menu)
        );

        // Coins change as the player earns and spends, which changes what they can afford
        this.itemsUpdatedHandler = () => {
            if (this.itemsRefreshTimeout) return;
            this.itemsRefreshTimeout = setTimeout(() => {
                this.itemsRefreshTimeout = null;
                if (this.ui?.active) this.ui.render();
                this.refreshAlert();
            }, 500);
        };
        dataManager.on('items_updated', this.itemsUpdatedHandler);

        // The ❗ follows prices (market data refreshes), the list, and the two alert settings
        this.priceUpdateHandler = () => this.refreshAlert();
        marketAPI.on(this.priceUpdateHandler);
        this.alertSettingHandler = () => this.refreshAlert();
        config.onSettingChange(ALERT_TAB_SETTING, this.alertSettingHandler);
        config.onSettingChange(ALERT_NAV_SETTING, this.alertSettingHandler);
        // The sidebar re-renders now and then and drops our ❗; put it back
        this.unregisterNav = domObserver.onClass('MarketWishlist_nav', 'NavigationBar_navigationLink', () => {
            if (this.navAlert) setNavAlert(true);
        });

        this.timerRegistry.registerInterval(setInterval(() => this.sampleAll(), SAMPLE_INTERVAL));
        this.sampleAll();
        this.refreshAlert();
    }

    currentKeys() {
        return new Set(wishlistStore.getItems().map((item) => getWishlistKey(item.itemHrid, item.enhancementLevel)));
    }

    /**
     * A change to the list: drop history for removed items, start a series for new ones, redraw
     */
    handleStoreChange() {
        const keys = this.currentKeys();
        for (const key of this.knownKeys) {
            if (!keys.has(key)) wishlistHistory.removeKey(key);
        }
        const added = [...keys].some((key) => !this.knownKeys.has(key));
        this.knownKeys = keys;

        if (added) this.sampleAll();
        this.ui?.render();
        this.refreshAlert();
    }

    /**
     * Show the ❗ (on the tab and/or the sidebar Marketplace link, each behind its own setting)
     * while the player has enough coins for the first item on the list.
     */
    async refreshAlert() {
        const tabOn = !!config.getSetting(ALERT_TAB_SETTING);
        const navOn = !!config.getSetting(ALERT_NAV_SETTING);
        const token = ++this.alertToken;

        let affordable = false;
        const first = wishlistStore.getItems()[0];
        if ((tabOn || navOn) && first) {
            const price = await getWishlistPrice(first);
            affordable = price.available && getCoinBalance() >= price.price;
        }
        if (token !== this.alertToken || !this.isInitialized) return;

        this.navAlert = navOn && affordable;
        this.ui?.setTabAlert(tabOn && affordable);
        setNavAlert(this.navAlert);
    }

    /**
     * Record the current price of every wishlist item.
     * @param {number} [minGap=0] - Skip when a sample was taken more recently than this
     */
    async sampleAll(minGap = 0) {
        if (!connectionState.isConnected() || !marketAPI.isLoaded()) return;
        if (minGap && Date.now() - wishlistHistory.lastRecordedAt < minGap) return;

        const items = wishlistStore.getItems();
        if (items.length === 0) return;

        const now = Date.now();
        for (const item of items) {
            const price = await getWishlistPrice(item);
            if (price.available) {
                wishlistHistory.record(
                    getWishlistKey(item.itemHrid, item.enhancementLevel),
                    price.price,
                    price.estimated,
                    now
                );
            }
        }
        wishlistHistory.lastRecordedAt = now;
        await wishlistHistory.save();
    }

    /**
     * Add an Add/Remove Wishlist button to an item action menu opened in the Marketplace
     * @param {HTMLElement} menu - The Item_actionMenu element
     */
    injectMenuButton(menu) {
        if (!config.getSetting(SETTING_KEY) || !this.isInitialized) return;
        if (menu.querySelector(`.${MENU_BUTTON_CLASS}`)) return;

        const marketplace = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (!marketplace || !isElementActuallyVisible(marketplace)) return;

        const nameEl = menu.querySelector('[class*="Item_name"]');
        if (!nameEl) return;
        const itemHrid = getItemHridFromName(nameEl.textContent.trim());
        if (!itemHrid) return;
        if (dataManager.getItemDetails(itemHrid)?.isTradable !== true) return;

        let enhancementLevel = 0;
        const enhEl = menu.querySelector('[class*="Item_enhancementLevel"]');
        const match = enhEl?.textContent.match(/\+(\d+)/);
        if (match) enhancementLevel = parseInt(match[1], 10);

        const buttons = menu.querySelectorAll('button');
        const lastButton = buttons[buttons.length - 1];
        if (!lastButton) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${lastButton.className} ${MENU_BUTTON_CLASS}`;
        const label = () =>
            t(
                wishlistStore.has(itemHrid, enhancementLevel)
                    ? 'marketWishlist.removeFromMenu'
                    : 'marketWishlist.addToMenu'
            );
        button.textContent = label();
        button.addEventListener('click', async () => {
            if (wishlistStore.has(itemHrid, enhancementLevel)) {
                await wishlistStore.remove(itemHrid, enhancementLevel);
            } else {
                await wishlistStore.add(itemHrid, enhancementLevel);
            }
            button.textContent = label();
        });
        lastButton.insertAdjacentElement('afterend', button);
    }

    cleanup() {
        this.isInitialized = false;

        this.ui?.stop();
        this.ui = null;

        this.unregisterMenu?.();
        this.unregisterMenu = null;
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;

        this.alertToken++;
        this.unregisterNav?.();
        this.unregisterNav = null;
        if (this.priceUpdateHandler) {
            marketAPI.off(this.priceUpdateHandler);
            this.priceUpdateHandler = null;
        }
        if (this.alertSettingHandler) {
            config.offSettingChange(ALERT_TAB_SETTING, this.alertSettingHandler);
            config.offSettingChange(ALERT_NAV_SETTING, this.alertSettingHandler);
            this.alertSettingHandler = null;
        }
        this.navAlert = false;
        setNavAlert(false);

        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }
        clearTimeout(this.itemsRefreshTimeout);
        this.itemsRefreshTimeout = null;

        this.timerRegistry.clearAll();
        document.querySelectorAll(`.${MENU_BUTTON_CLASS}`).forEach((el) => el.remove());
        wishlistStore.reset();
        wishlistHistory.reset();
        this.knownKeys = new Set();
    }

    disable() {
        this.cleanup();
    }
}

const marketWishlist = new MarketWishlist();

export default marketWishlist;
export { MarketWishlist };
