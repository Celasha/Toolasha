/**
 * Market Depth Cap
 *
 * Live widget shown on the native marketplace order-book panel: given the last cost-per-action
 * and per-item output quantities computed by the Risk of Ruin calculator (dungeon chests, alchemy
 * Transmute — see risk-of-ruin-ui.js's getDepthCapContext()), estimates how many actions' worth
 * of the currently-viewed item the visible bid depth can absorb before the marginal sale price
 * drops below what that action costs to perform.
 *
 * Two hard limitations, both surfaced in the tooltip rather than hidden:
 * - This only ever sees the resting bid listings the game has already sent for whichever item's
 *   order book is currently open in-game — there is no on-demand fetch for an arbitrary item, so
 *   this widget is silent everywhere else.
 * - Per the 8/13/2026 marketplace update, items now trade within a tradable range (roughly
 *   +-10-20%) around an estimated market value, and no data anywhere in the game's WebSocket
 *   protocol exposes that range's actual floor. A large sell-off can hit that floor and start
 *   queuing with an estimated delay well before this estimate suggests — this widget has no way
 *   to detect or account for that, and never claims to.
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import riskOfRuinUI from '../risk-of-ruin/risk-of-ruin-ui.js';

/**
 * Walk resting bid listings (sorted best-to-worst, as the game sends them) to find how many
 * actions' worth of one item's expected output the visible book can absorb before the marginal
 * unit's price drops below the threshold needed to still clear costPerAction.
 * @param {Object} params
 * @param {Array<{price: number, quantity: number}>} params.bids
 * @param {number} params.costPerAction
 * @param {number} params.quantityPerAction - Expected units of this item per action.
 * @param {number} [params.marketTax]
 * @returns {{
 *   nstar: number,
 *   cumulativeQuantity: number,
 *   thresholdPrice: number|null,
 *   hitBookEnd: boolean,
 * }} hitBookEnd is true when every visible bid still cleared cost — the real cap may be higher
 *   than shown, since resting bids beyond the visible book aren't known.
 */
export function calculateDepthCap({ bids, costPerAction, quantityPerAction, marketTax = MARKET_TAX }) {
    if (!(quantityPerAction > 0) || !(costPerAction > 0) || !bids?.length) {
        return { nstar: 0, cumulativeQuantity: 0, thresholdPrice: null, hitBookEnd: false };
    }

    const thresholdPrice = costPerAction / ((1 - marketTax) * quantityPerAction);
    let cumulativeQuantity = 0;
    let hitBookEnd = true;
    for (const listing of bids) {
        if (listing.price < thresholdPrice) {
            hitBookEnd = false;
            break;
        }
        cumulativeQuantity += listing.quantity;
    }

    return {
        nstar: Math.floor(cumulativeQuantity / quantityPerAction),
        cumulativeQuantity,
        thresholdPrice,
        hitBookEnd,
    };
}

class MarketDepthCap {
    constructor() {
        this.isInitialized = false;
        this.cleanupRegistry = createCleanupRegistry();
        this.orderBooksCache = {}; // itemHrid -> { data: marketItemOrderBooks, lastUpdated }
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('market_depthCapEnabled')) return;

        this.isInitialized = true;
        this.setupWebSocketListener();
        this.setupObserver();
    }

    setupWebSocketListener() {
        const handler = (data) => {
            if (!data.marketItemOrderBooks) return;
            const itemHrid = data.marketItemOrderBooks.itemHrid;
            if (itemHrid) {
                this.orderBooksCache[itemHrid] = { data: data.marketItemOrderBooks, lastUpdated: Date.now() };
            }

            document.querySelectorAll('.mwi-depth-cap-set').forEach((el) => el.classList.remove('mwi-depth-cap-set'));
            document
                .querySelectorAll('[class*="MarketplacePanel_orderBooksContainer"]')
                .forEach((container) => this.processOrderBook(container));
        };

        dataManager.on('market_item_order_books_updated', handler);
        this.cleanupRegistry.registerCleanup(() => dataManager.off('market_item_order_books_updated', handler));
    }

    setupObserver() {
        const unregister = domObserver.onClass(
            'MarketDepthCap',
            'MarketplacePanel_orderBooksContainer',
            (container) => {
                this.processOrderBook(container);
            }
        );
        this.cleanupRegistry.registerCleanup(unregister);
    }

    /**
     * @param {HTMLElement} _container - Order book container (unused - we query directly, same
     *   as queue-length-estimator.js).
     */
    processOrderBook(_container) {
        const buttonContainer = document.querySelector('.MarketplacePanel_newListingButtonsContainer__1MhKJ');
        if (!buttonContainer) return;
        if (buttonContainer.classList.contains('mwi-depth-cap-set')) return;

        const itemHrid = this.getCurrentItemHrid();
        if (!itemHrid) return;

        const depthContext = riskOfRuinUI.getDepthCapContext();
        const item = depthContext?.items.find((i) => i.itemHrid === itemHrid);
        const cached = this.orderBooksCache[itemHrid];
        if (!depthContext || !item || !cached) return;

        const enhancementLevel = this.getCurrentEnhancementLevel();
        const orderBookAtLevel = cached.data.orderBooks?.[enhancementLevel];
        const bids = orderBookAtLevel?.bids;
        if (!bids?.length) return;

        buttonContainer.classList.add('mwi-depth-cap-set');

        const result = calculateDepthCap({
            bids,
            costPerAction: depthContext.costPerAction,
            quantityPerAction: item.quantityPerAction,
        });

        this.renderDepthCap(buttonContainer, result);
    }

    renderDepthCap(buttonContainer, result) {
        const existing = buttonContainer.querySelector('.mwi-depth-cap');
        if (existing) existing.remove();
        if (result.nstar <= 0) return;

        const el = document.createElement('div');
        el.classList.add('mwi-depth-cap');
        el.style.fontSize = '0.95rem';
        el.style.textAlign = 'center';
        el.style.color = '#60a5fa';

        const prefix = result.hitBookEnd ? 'at least ' : '~';
        el.textContent = `Sell depth: ${prefix}${formatWithSeparator(result.nstar)} actions`;
        el.title =
            (result.hitBookEnd
                ? 'Every visible resting bid still clears cost — the true cap may be higher than shown. '
                : 'Estimated number of actions worth of this item the visible order book can absorb before the ' +
                  'marginal sale price drops below cost. ') +
            "Ignores the marketplace's tradable range floor (not exposed in game data), so a large sell-off " +
            'may hit that floor and queue with a delay before this estimate suggests.';

        buttonContainer.insertBefore(el, buttonContainer.lastChild);
    }

    /**
     * @returns {string|null} Item HRID currently open in the order book panel.
     */
    getCurrentItemHrid() {
        const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
        const useElement = currentItemElement?.querySelector('use');
        const href = useElement?.href?.baseVal;
        return href ? '/items/' + href.split('#')[1] : null;
    }

    /**
     * @returns {number} Enhancement level currently selected (0 for non-equipment).
     */
    getCurrentEnhancementLevel() {
        const currentItemElement = document.querySelector('.MarketplacePanel_currentItem__3ercC');
        const enhancementElement = currentItemElement?.querySelector('[class*="Item_enhancementLevel"]');
        const match = enhancementElement?.textContent.match(/\+(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    clearDisplays() {
        document.querySelectorAll('.mwi-depth-cap-set').forEach((el) => el.classList.remove('mwi-depth-cap-set'));
        document.querySelectorAll('.mwi-depth-cap').forEach((el) => el.remove());
    }

    disable() {
        this.clearDisplays();
        this.cleanupRegistry.cleanupAll();
        this.isInitialized = false;
    }

    cleanup() {
        this.disable();
    }
}

const marketDepthCap = new MarketDepthCap();

export default marketDepthCap;
