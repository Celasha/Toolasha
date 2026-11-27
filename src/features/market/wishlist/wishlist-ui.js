/**
 * Wishlist UI
 * A real "Wishlist" tab on the Marketplace: a cloned native tab button plus a panel of our own
 * inside the tabs' panel container. The game's two native panels are never touched - while the
 * wishlist is active a class on the tabs component hides them with CSS, and any click on another
 * tab (or the game switching tabs itself) turns it off again, so React's own state stays correct.
 */

import domObserver from '../../../core/dom-observer.js';
import dataManager from '../../../core/data-manager.js';
import { t } from '../../../core/i18n.js';
import { addStyles, removeStyles } from '../../../utils/dom.js';
import { formatWithSeparator } from '../../../utils/formatters.js';
import { getItemName } from '../../../utils/game-i18n.js';
import {
    getVisibleMarketplaceTabContainer,
    navigateToMarketplace,
    canOpenInMarketplace,
} from '../../../utils/marketplace-tabs.js';
import { getWishlistKey } from './wishlist-store.js';
import { getCoinBalance } from './wishlist-pricing.js';

const STYLE_ID = 'mwi-wishlist-styles';
const TAB_ATTR = 'data-mwi-wishlist-tab';
const PANEL_CLASS = 'mwi-wishlist-panel';
const ACTIVE_CLASS = 'mwi-wishlist-active';
const RESTYLED_ATTR = 'data-mwi-wishlist-restyled';

const CSS = `
    .${PANEL_CLASS} {
        display: none;
        padding: 12px 16px;
        overflow-y: auto;
        max-height: 100%;
    }
    .${ACTIVE_CLASS} > [class*="TabsComponent_tabPanelsContainer"] > [class*="TabPanel_tabPanel"]:not(.${PANEL_CLASS}) {
        display: none !important;
    }
    .${ACTIVE_CLASS} > [class*="TabsComponent_tabPanelsContainer"] > .${PANEL_CLASS} {
        display: block;
    }
    .${ACTIVE_CLASS} [class*="MuiTabs-indicator"] {
        display: none;
    }
    .mwi-wishlist-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 10px;
    }
    .mwi-wishlist-title { font-size: 1.1rem; font-weight: bold; }
    .mwi-wishlist-coins { opacity: 0.8; }
    .mwi-wishlist-empty { opacity: 0.75; padding: 24px 0; line-height: 1.5; }
    .mwi-wishlist-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        margin-bottom: 6px;
        background: rgba(255, 255, 255, 0.04);
    }
    .mwi-wishlist-row.mwi-wishlist-dragging { opacity: 0.4; }
    .mwi-wishlist-row.mwi-wishlist-drop-before { box-shadow: 0 -2px 0 0 #f59e0b; }
    .mwi-wishlist-row.mwi-wishlist-drop-after { box-shadow: 0 2px 0 0 #f59e0b; }
    .mwi-wishlist-handle { cursor: grab; opacity: 0.6; user-select: none; }
    .mwi-wishlist-name { flex: 1 1 auto; min-width: 0; }
    .mwi-wishlist-price { min-width: 110px; text-align: right; }
    .mwi-wishlist-est { opacity: 0.7; font-size: 0.75rem; margin-left: 4px; cursor: help; }
    .mwi-wishlist-afford { min-width: 140px; text-align: right; font-size: 0.85rem; }
    .mwi-wishlist-afford.mwi-wishlist-yes { color: #4ade80; }
    .mwi-wishlist-afford.mwi-wishlist-no { opacity: 0.75; }
    .mwi-wishlist-buy, .mwi-wishlist-remove {
        cursor: pointer;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        padding: 3px 10px;
    }
    .mwi-wishlist-buy:disabled { opacity: 0.4; cursor: not-allowed; }
    .mwi-wishlist-menu-btn { width: 100%; }
    .mwi-wishlist-tab-alert { margin-left: 4px; }
`;

/**
 * Items sprite URL, taken from any rendered item icon (it is content-hashed per game build)
 * @returns {string|null}
 */
function getItemsSpriteUrl() {
    const href = document.querySelector('use[href*="items_sprite"]')?.getAttribute('href');
    return href ? href.split('#')[0] : null;
}

class WishlistUI {
    /**
     * @param {Object} deps
     * @param {import('./wishlist-store.js').WishlistStore} deps.store
     * @param {Function} deps.getPrice - async (item) => {price, available, estimated}
     * @param {Function} [deps.onOpen] - Called when the wishlist panel becomes active
     */
    constructor({ store, getPrice, onOpen }) {
        this.store = store;
        this.getPrice = getPrice;
        this.onOpen = onOpen;

        this.active = false;
        this.tablist = null;
        this.tab = null;
        this.panel = null;
        this.tabsComponent = null;
        this.renderToken = 0;
        this.unregisterObserver = null;
        this.selectionObserver = null;
        this.tabClickHandler = null;
        this.draggedKey = null;
        this.tabAlert = false;
    }

    start() {
        addStyles(CSS, STYLE_ID);
        this.unregisterObserver = domObserver.onClass(
            'MarketWishlist',
            ['TabsComponent_tabPanelsContainer', 'MuiTabs-flexContainer'],
            () => this.ensureInstalled()
        );
        this.ensureInstalled();
    }

    stop() {
        this.unregisterObserver?.();
        this.unregisterObserver = null;
        this.uninstall();
        removeStyles(STYLE_ID);
    }

    /**
     * Make sure our tab and panel exist in the currently mounted marketplace. Idempotent.
     */
    ensureInstalled() {
        const tablist = getVisibleMarketplaceTabContainer();
        if (!tablist) return;

        const tabsComponent = tablist.closest('[class*="TabsComponent_tabsComponent"]');
        const panels = tabsComponent?.querySelector(':scope > [class*="TabsComponent_tabPanelsContainer"]');
        if (!tabsComponent || !panels) return;

        // A different tablist than the one we installed into means the marketplace was remounted
        if (this.tablist && this.tablist !== tablist) {
            this.uninstall();
        }

        let tab = tablist.querySelector(`[${TAB_ATTR}]`);
        if (!tab) {
            tab = this.createTab(tablist);
            if (!tab) return;
        }
        let panel = panels.querySelector(`:scope > .${PANEL_CLASS}`);
        if (!panel) {
            panel = document.createElement('div');
            panel.className = PANEL_CLASS;
            panels.appendChild(panel);
        }

        this.tablist = tablist;
        this.tab = tab;
        this.panel = panel;
        this.tabsComponent = tabsComponent;
        this.watchTabs(tablist);
        this.applyTabAlert();
    }

    /**
     * Show or hide the ❗ on the tab
     * @param {boolean} show
     */
    setTabAlert(show) {
        this.tabAlert = !!show;
        this.applyTabAlert();
    }

    applyTabAlert() {
        const alert = this.tab?.querySelector('.mwi-wishlist-tab-alert');
        if (alert) alert.hidden = !this.tabAlert;
    }

    /**
     * Clone an unselected native tab into a Wishlist tab
     * @param {HTMLElement} tablist
     * @returns {HTMLElement|null}
     */
    createTab(tablist) {
        const reference = Array.from(tablist.children).find(
            (el) =>
                el.getAttribute('role') === 'tab' &&
                !el.classList.contains('Mui-selected') &&
                !el.hasAttribute('data-mwi-custom-tab') &&
                !el.hasAttribute('data-mwi-shrine-tab') &&
                !el.hasAttribute('data-mwi-market-history-tab') &&
                !el.hasAttribute(TAB_ATTR)
        );
        if (!reference) return null;

        const tab = reference.cloneNode(true);
        tab.setAttribute(TAB_ATTR, 'true');
        // A clone must not duplicate the native tab/panel identity
        tab.removeAttribute('id');
        tab.removeAttribute('aria-controls');
        tab.classList.remove('Mui-selected');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');

        const badge = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badge) {
            badge.textContent = '';
            const label = document.createElement('span');
            label.className = 'mwi-wishlist-tab-label';
            label.textContent = t('marketWishlist.tabLabel');
            const alert = document.createElement('span');
            alert.className = 'mwi-wishlist-tab-alert';
            alert.textContent = '❗';
            alert.title = t('marketWishlist.alertTooltip');
            alert.hidden = true;
            badge.append(label, alert);
        }

        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.activate();
        });

        // After the Market History tab if present, else before the first material tab, else last
        const marketHistoryTab = tablist.querySelector('[data-mwi-market-history-tab]');
        const firstCustomTab = tablist.querySelector('[data-mwi-custom-tab]');
        if (marketHistoryTab) {
            marketHistoryTab.after(tab);
        } else if (firstCustomTab) {
            firstCustomTab.before(tab);
        } else {
            tablist.appendChild(tab);
        }
        return tab;
    }

    /**
     * Turn the wishlist off when another tab is clicked or the game switches tabs itself
     * @param {HTMLElement} tablist
     */
    watchTabs(tablist) {
        if (this.tabClickHandler && this.watchedTablist === tablist) return;
        this.unwatchTabs();

        this.watchedTablist = tablist;
        this.tabClickHandler = (e) => {
            const origin = typeof e.target?.closest === 'function' ? e.target : e.target?.parentElement;
            const clicked = origin?.closest('[role="tab"]');
            if (!clicked || !tablist.contains(clicked)) return;
            if (clicked.hasAttribute(TAB_ATTR) || clicked.hasAttribute('data-mwi-market-history-tab')) return;
            this.deactivate();
        };
        tablist.addEventListener('click', this.tabClickHandler, { capture: true });

        this.selectionObserver = new MutationObserver((mutations) => {
            if (!this.active) return;
            for (const mutation of mutations) {
                const el = mutation.target;
                if (el.hasAttribute?.(TAB_ATTR)) continue;
                if (el.getAttribute?.('aria-selected') === 'true') {
                    this.deactivate();
                    return;
                }
            }
        });
        this.selectionObserver.observe(tablist, {
            attributes: true,
            attributeFilter: ['aria-selected'],
            subtree: true,
        });
    }

    unwatchTabs() {
        if (this.watchedTablist && this.tabClickHandler) {
            this.watchedTablist.removeEventListener('click', this.tabClickHandler, { capture: true });
        }
        this.selectionObserver?.disconnect();
        this.selectionObserver = null;
        this.tabClickHandler = null;
        this.watchedTablist = null;
    }

    activate() {
        if (!this.tab || !this.tabsComponent || !this.tablist) return;
        this.active = true;

        // The native tab that is still marked selected must stop looking selected
        const nativeTabs = Array.from(this.tablist.querySelectorAll('[role="tab"]')).filter(
            (el) => !el.hasAttribute(TAB_ATTR) && !el.hasAttribute('data-mwi-custom-tab')
        );
        const unselected = nativeTabs.find((el) => !el.classList.contains('Mui-selected'));
        const unselectedColor = unselected ? window.getComputedStyle(unselected).color : '';
        const indicator = this.tablist.parentElement?.querySelector('[class*="MuiTabs-indicator"]');
        const indicatorColor = indicator ? window.getComputedStyle(indicator).backgroundColor : '';

        for (const el of nativeTabs) {
            if (el.classList.contains('Mui-selected') && unselectedColor) {
                el.style.color = unselectedColor;
                el.setAttribute(RESTYLED_ATTR, 'true');
            }
        }

        this.tabsComponent.classList.add(ACTIVE_CLASS);
        this.tab.classList.add('Mui-selected');
        this.tab.setAttribute('aria-selected', 'true');
        this.tab.setAttribute('tabindex', '0');
        if (indicatorColor) this.tab.style.boxShadow = `inset 0 -2px 0 ${indicatorColor}`;

        this.onOpen?.();
        this.render();
    }

    deactivate() {
        if (!this.active) return;
        this.active = false;
        this.renderToken++;

        this.tabsComponent?.classList.remove(ACTIVE_CLASS);
        if (this.tab) {
            this.tab.classList.remove('Mui-selected');
            this.tab.setAttribute('aria-selected', 'false');
            this.tab.setAttribute('tabindex', '-1');
            this.tab.style.boxShadow = '';
        }
        this.tablist?.querySelectorAll(`[${RESTYLED_ATTR}]`).forEach((el) => {
            el.style.color = '';
            el.removeAttribute(RESTYLED_ATTR);
        });
    }

    /** Remove everything we added to the marketplace */
    uninstall() {
        this.deactivate();
        this.unwatchTabs();
        this.tab?.remove();
        this.panel?.remove();
        this.tablist?.querySelectorAll(`[${TAB_ATTR}]`).forEach((el) => el.remove());
        this.tab = null;
        this.panel = null;
        this.tablist = null;
        this.tabsComponent = null;
    }

    /**
     * Rebuild the list. Prices are resolved first, so a render never shows half-filled rows;
     * a render superseded by a newer one is dropped.
     */
    async render() {
        if (!this.active || !this.panel) return;
        const token = ++this.renderToken;

        const items = this.store.getItems();
        const prices = await Promise.all(items.map((item) => this.getPrice(item)));
        if (token !== this.renderToken || !this.active || !this.panel) return;

        const coins = getCoinBalance();
        const header = document.createElement('div');
        header.className = 'mwi-wishlist-header';
        const title = document.createElement('div');
        title.className = 'mwi-wishlist-title';
        title.textContent = t('marketWishlist.panelTitle');
        const coinsEl = document.createElement('div');
        coinsEl.className = 'mwi-wishlist-coins';
        coinsEl.textContent = t('marketWishlist.coinsLabel', { coins: formatWithSeparator(coins) });
        header.append(title, coinsEl);

        const children = [header];
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mwi-wishlist-empty';
            empty.textContent = t('marketWishlist.emptyMessage');
            children.push(empty);
        } else {
            items.forEach((item, i) => children.push(this.buildRow(item, prices[i], coins)));
        }
        this.panel.replaceChildren(...children);
    }

    /**
     * @param {{itemHrid: string, enhancementLevel: number}} item
     * @param {import('./wishlist-pricing.js').WishlistPrice} price
     * @param {number} coins
     * @returns {HTMLElement}
     */
    buildRow(item, price, coins) {
        const key = getWishlistKey(item.itemHrid, item.enhancementLevel);
        const row = document.createElement('div');
        row.className = 'mwi-wishlist-row';
        row.dataset.wishlistKey = key;
        row.draggable = true;

        const handle = document.createElement('span');
        handle.className = 'mwi-wishlist-handle';
        handle.textContent = '⋮⋮';
        handle.title = t('marketWishlist.dragTooltip');
        row.appendChild(handle);

        const spriteUrl = getItemsSpriteUrl();
        if (spriteUrl) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '28');
            svg.setAttribute('height', '28');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `${spriteUrl}#${item.itemHrid.split('/').pop()}`);
            svg.appendChild(use);
            row.appendChild(svg);
        }

        const itemName = getItemName(item.itemHrid, dataManager.getItemDetails(item.itemHrid)?.name || item.itemHrid);
        const name = document.createElement('div');
        name.className = 'mwi-wishlist-name';
        name.textContent = item.enhancementLevel > 0 ? `${itemName} +${item.enhancementLevel}` : itemName;
        row.appendChild(name);

        const priceEl = document.createElement('div');
        priceEl.className = 'mwi-wishlist-price';
        if (price.available) {
            priceEl.textContent = formatWithSeparator(Math.round(price.price));
            if (price.estimated) {
                const est = document.createElement('span');
                est.className = 'mwi-wishlist-est';
                est.textContent = t('marketWishlist.estimatedTag');
                est.title = t('marketWishlist.estimatedTooltip');
                priceEl.appendChild(est);
            }
        } else {
            priceEl.textContent = t('marketWishlist.noPrice');
        }
        row.appendChild(priceEl);

        const afford = document.createElement('div');
        afford.className = 'mwi-wishlist-afford';
        if (price.available) {
            if (coins >= price.price) {
                afford.classList.add('mwi-wishlist-yes');
                afford.textContent = t('marketWishlist.canAfford');
            } else {
                afford.classList.add('mwi-wishlist-no');
                afford.textContent = t('marketWishlist.needMore', {
                    amount: formatWithSeparator(Math.ceil(price.price - coins)),
                });
            }
        }
        row.appendChild(afford);

        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'mwi-wishlist-buy';
        buy.textContent = t('marketWishlist.buyButton');
        if (canOpenInMarketplace(item.itemHrid)) {
            buy.addEventListener('click', () => {
                this.deactivate();
                navigateToMarketplace(item.itemHrid, item.enhancementLevel);
            });
        } else {
            buy.disabled = true;
            buy.title = t('marketWishlist.buyDisabledTooltip');
        }
        row.appendChild(buy);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mwi-wishlist-remove';
        remove.textContent = '✕';
        remove.title = t('marketWishlist.removeTooltip');
        remove.addEventListener('click', () => {
            this.store.remove(item.itemHrid, item.enhancementLevel);
        });
        row.appendChild(remove);

        this.attachDrag(row, key);
        return row;
    }

    /**
     * Native drag-and-drop reordering of the rows
     * @param {HTMLElement} row
     * @param {string} key
     */
    attachDrag(row, key) {
        const clearMarkers = () => {
            this.panel?.querySelectorAll('.mwi-wishlist-drop-before, .mwi-wishlist-drop-after').forEach((el) => {
                el.classList.remove('mwi-wishlist-drop-before', 'mwi-wishlist-drop-after');
            });
        };

        row.addEventListener('dragstart', (e) => {
            this.draggedKey = key;
            row.classList.add('mwi-wishlist-dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', key);
            }
        });
        row.addEventListener('dragend', () => {
            this.draggedKey = null;
            row.classList.remove('mwi-wishlist-dragging');
            clearMarkers();
        });
        row.addEventListener('dragover', (e) => {
            if (!this.draggedKey || this.draggedKey === key) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            clearMarkers();
            row.classList.add(after ? 'mwi-wishlist-drop-after' : 'mwi-wishlist-drop-before');
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('mwi-wishlist-drop-before', 'mwi-wishlist-drop-after');
        });
        row.addEventListener('drop', (e) => {
            if (!this.draggedKey || this.draggedKey === key) return;
            e.preventDefault();
            const after = row.classList.contains('mwi-wishlist-drop-after');
            const dragged = this.draggedKey;
            clearMarkers();

            const order = this.store
                .getItems()
                .map((item) => getWishlistKey(item.itemHrid, item.enhancementLevel))
                .filter((k) => k !== dragged);
            const targetIndex = order.indexOf(key);
            order.splice(after ? targetIndex + 1 : targetIndex, 0, dragged);
            this.store.reorder(order);
        });
    }
}

export default WishlistUI;
export { WishlistUI, TAB_ATTR, PANEL_CLASS, ACTIVE_CLASS };
