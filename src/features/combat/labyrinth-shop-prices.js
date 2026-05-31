/**
 * Labyrinth Shop Prices
 * Injects ask/bid market prices on tradeable items in the Labyrinth Shop tab
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import { formatKMB } from '../../utils/formatters.js';
import { t } from '../../core/i18n.js';

class LabyrinthShopPrices {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.shopClickHandler = null;
        this.shopButton = null;
        this.catchupTimer = null;
    }

    initialize() {
        if (!config.getSetting('labyrinthShopPrices')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        // Watch for the Labyrinth tab bar to appear, then attach click listener to Shop tab
        const unregister = domObserver.onClass(
            'LabyrinthShopPrices',
            'LabyrinthPanel_tabsComponentContainer',
            (container) => this.attachShopClickListener(container)
        );
        this.unregisterHandlers.push(unregister);

        // Watch for the buyable grid to appear (tab switch renders it fresh)
        const unregisterGrid = domObserver.onClass(
            'LabyrinthShopPrices_buyableGrid',
            'LabyrinthPanel_buyableGrid',
            () => this.refreshAll()
        );
        this.unregisterHandlers.push(unregisterGrid);

        // Catch content already in the DOM
        this.catchupTimer = setTimeout(() => this.refreshAll(), 500);

        this.isInitialized = true;
    }

    disable() {
        if (this.catchupTimer) {
            clearTimeout(this.catchupTimer);
            this.catchupTimer = null;
        }

        if (this.shopButton && this.shopClickHandler) {
            this.shopButton.removeEventListener('click', this.shopClickHandler);
            this.shopClickHandler = null;
            this.shopButton = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        document.querySelectorAll('.mwi-labyrinth-shop-price').forEach((el) => el.remove());

        this.isInitialized = false;
    }

    /**
     * Find the Shop tab button and attach a click listener to it
     * @param {Element} container - The LabyrinthPanel_tabsComponentContainer element
     */
    attachShopClickListener(container) {
        const buttons = Array.from(container.querySelectorAll('button[role="tab"]'));
        const shopBtn = buttons.find((btn) => btn.textContent.trim().startsWith('Shop'));

        if (!shopBtn) {
            return;
        }

        // Remove previous listener if panel re-mounted
        if (this.shopButton && this.shopClickHandler) {
            this.shopButton.removeEventListener('click', this.shopClickHandler);
        }

        this.shopButton = shopBtn;
        this.shopClickHandler = () => {
            setTimeout(() => this.refreshAll(), 100);
        };
        shopBtn.addEventListener('click', this.shopClickHandler);

        // If Shop tab is already active, inject immediately
        if (shopBtn.getAttribute('aria-selected') === 'true') {
            setTimeout(() => this.refreshAll(), 100);
        }
    }

    /**
     * Extract item HRID from an item element's SVG use href
     * @param {Element} itemEl
     * @returns {string|null}
     */
    extractItemHrid(itemEl) {
        const useEl = itemEl.querySelector('use');
        if (!useEl) {
            return null;
        }

        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
        if (!href) {
            return null;
        }

        const slug = href.split('#')[1];
        if (!slug) {
            return null;
        }

        return `/items/${slug}`;
    }

    /**
     * Inject or update the ask/bid price element inside an item
     * @param {Element} itemEl
     * @param {{ ask: number, bid: number }} price
     */
    injectPrice(itemEl, price) {
        const existing = itemEl.querySelector('.mwi-labyrinth-shop-price');

        if (existing) {
            existing.querySelector('.mwi-lsp-ask').textContent = formatKMB(price.ask);
            existing.querySelector('.mwi-lsp-bid').textContent = formatKMB(price.bid);
            return;
        }

        const container = document.createElement('div');
        container.className = 'mwi-labyrinth-shop-price';
        container.style.cssText = `
            font-size: 0.7rem;
            text-align: center;
            margin-top: 2px;
            line-height: 1.3;
            pointer-events: none;
        `;

        const askSpan = document.createElement('span');
        askSpan.className = 'mwi-lsp-ask';
        askSpan.style.color = config.COLOR_INVBADGE_ASK;
        askSpan.textContent = formatKMB(price.ask);

        const sepSpan = document.createElement('span');
        sepSpan.style.color = '#888';
        sepSpan.textContent = ' / ';

        const bidSpan = document.createElement('span');
        bidSpan.className = 'mwi-lsp-bid';
        bidSpan.style.color = config.COLOR_INVBADGE_BID;
        bidSpan.textContent = formatKMB(price.bid);

        container.appendChild(askSpan);
        container.appendChild(sepSpan);
        container.appendChild(bidSpan);
        itemEl.appendChild(container);
    }

    /**
     * Scan all visible shop items and inject prices for tradeable ones
     */
    refreshAll() {
        const items = document.querySelectorAll('[class*="LabyrinthPanel_buyableGrid"] [class*="LabyrinthPanel_item"]');
        items.forEach((itemEl) => {
            const itemHrid = this.extractItemHrid(itemEl);
            if (!itemHrid) {
                return;
            }

            const price = marketAPI.getPrice(itemHrid);
            if (!price) {
                return; // Not tradeable or no price data yet
            }

            this.injectPrice(itemEl, price);
        });
    }
}

const labyrinthShopPrices = new LabyrinthShopPrices();
export default labyrinthShopPrices;
