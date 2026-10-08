/**
 * Labyrinth Shop Prices
 * Injects ask/bid market prices on tradeable items in the Labyrinth Shop tab
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { translateGameName } from '../../utils/game-i18n.js';
import { getItemPrices } from '../../utils/market-data.js';
import { formatKMB } from '../../utils/formatters.js';

// Labyrinth tab bar renders exactly four tabs/panels in this fixed order:
// Labyrinth (Xp), Room (Zp), Automation (eg), Labyrinth Shop (tg).
const LABYRINTH_TAB_COUNT = 4;
const SHOP_TAB_INDEX = 3;

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
     * Find the Labyrinth Shop tab button without relying on its translated label.
     * The game always mounts every panel (hidden via CSS when inactive), and the Shop
     * panel root carries the LabyrinthPanel_labyrinthShopTab class, so the panel index
     * maps directly to the tab button index.
     * @param {Element} container - The LabyrinthPanel_tabsComponentContainer element
     * @returns {HTMLButtonElement|null}
     */
    findShopTabButton(container) {
        const tabsRoot = container.querySelector(':scope > [class*="TabsComponent_tabsComponent"]');
        if (tabsRoot) {
            const panelsContainer = tabsRoot.querySelector(
                ':scope > [class*="TabsComponent_tabPanelsContainer"]'
            );
            const buttons = Array.from(
                tabsRoot.querySelectorAll(':scope > [class*="TabsComponent_tabsContainer"] [role="tab"]')
            );
            const panels = panelsContainer ? Array.from(panelsContainer.children) : [];

            const panelIndex = panels.findIndex((panel) =>
                panel.querySelector?.('[class*="LabyrinthPanel_labyrinthShopTab"]')
            );
            if (panelIndex !== -1 && buttons[panelIndex]) {
                return buttons[panelIndex];
            }

            // The Labyrinth tab bar always has exactly four tabs in a fixed order
            if (buttons.length === LABYRINTH_TAB_COUNT && buttons[SHOP_TAB_INDEX]) {
                return buttons[SHOP_TAB_INDEX];
            }
        }

        // Fallback: game-translated label ("Labyrinth Shop"), then English labels
        const fallbackButtons = Array.from(container.querySelectorAll('button[role="tab"]'));
        const translatedLabel = translateGameName('labyrinthPanel', 'labyrinthShop', 'Labyrinth Shop');
        return (
            fallbackButtons.find(
                (btn) =>
                    btn.textContent.trim().startsWith(translatedLabel) ||
                    btn.textContent.trim().startsWith('Labyrinth Shop') ||
                    btn.textContent.trim().startsWith('Shop')
            ) || null
        );
    }

    /**
     * Find the Shop tab button and attach a click listener to it
     * @param {Element} container - The LabyrinthPanel_tabsComponentContainer element
     */
    attachShopClickListener(container) {
        const shopBtn = this.findShopTabButton(container);

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
     * @param {{ ask: number, bid: number, askOutlier: boolean, bidOutlier: boolean }} price
     */
    injectPrice(itemEl, price) {
        const existing = itemEl.querySelector('.mwi-labyrinth-shop-price');

        if (existing) {
            existing.querySelector('.mwi-lsp-ask').textContent = formatKMB(price.ask) + (price.askOutlier ? ' ⚠' : '');
            existing.querySelector('.mwi-lsp-bid').textContent = formatKMB(price.bid) + (price.bidOutlier ? ' ⚠' : '');
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
        askSpan.textContent = formatKMB(price.ask) + (price.askOutlier ? ' ⚠' : '');

        const sepSpan = document.createElement('span');
        sepSpan.style.color = '#888';
        sepSpan.textContent = ' / ';

        const bidSpan = document.createElement('span');
        bidSpan.className = 'mwi-lsp-bid';
        bidSpan.style.color = config.COLOR_INVBADGE_BID;
        bidSpan.textContent = formatKMB(price.bid) + (price.bidOutlier ? ' ⚠' : '');

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

            const price = getItemPrices(itemHrid);
            if (!price) {
                return; // Not tradeable or no price data yet
            }

            this.injectPrice(itemEl, price);
        });
    }
}

const labyrinthShopPrices = new LabyrinthShopPrices();
export default labyrinthShopPrices;
