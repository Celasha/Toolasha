/**
 * Instant Order Gap
 *
 * A Buy Now / Sell Now order fills at the other side's best price, so when the best sell offer and the best
 * buy offer are more than one price step apart, listing instead would have done noticeably better. This adds
 * a line to those dialogs saying how many steps apart the two are and what the gap costs, and stays out of
 * the way when they are adjacent.
 *
 * The step is the game's own price bin (`binGap` in the client), which grows with the price and is five times
 * wider for enhanced items, so the same gold amount can be one step on one item and ten on another.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { getMarketplaceRuntimeComponentFromElement } from '../../utils/marketplace-autofill.js';

// The game's price bins: [upper bound of the leading two digits, step unit]; 40 above the last bound
const BIN_GAP_UNIT_TIERS = [
    [12, 4],
    [15, 5],
    [18, 6],
    [24, 8],
    [30, 10],
    [36, 12],
    [48, 16],
    [60, 20],
    [75, 25],
    [90, 30],
];
const BIN_GAP_UNIT_TOP = 40;
// A bad book can put the two prices very far apart; there is no point counting every step
const MAX_STEPS = 999;
const SHOW_DELAY_MS = 150;

/**
 * @param {number} price
 * @param {number} enhancementLevel
 * @returns {number} The price step the game uses at this price
 */
export function binGap(price, enhancementLevel) {
    const digits = String(price);
    const length = digits.length;
    if (length <= 2) return 1;
    if (length === 3) {
        const lead = digits[0];
        if (enhancementLevel > 0) return lead === '1' ? 2 : lead <= '3' ? 5 : lead <= '7' ? 10 : 20;
        return lead <= '3' ? 1 : lead <= '7' ? 2 : 4;
    }
    const lead = parseInt(digits.slice(0, 2), 10);
    const unit = (BIN_GAP_UNIT_TIERS.find(([bound]) => lead < bound) || [0, BIN_GAP_UNIT_TOP])[1];
    const step = unit * Math.pow(10, length - 4);
    return enhancementLevel > 0 ? 5 * step : step;
}

/**
 * The price one click of the game's "+" button up from this one.
 * @param {number} price
 * @param {number} enhancementLevel
 * @returns {number}
 */
export function nextPrice(price, enhancementLevel) {
    const target = price + 1;
    const gap = binGap(target, enhancementLevel);
    return Math.ceil(target / gap) * gap;
}

/**
 * @param {number} low - The lower price
 * @param {number} high - The higher price
 * @param {number} [enhancementLevel]
 * @returns {number} How many "+" clicks it takes to get from low to high, capped at MAX_STEPS
 */
export function countPriceSteps(low, high, enhancementLevel = 0) {
    let steps = 0;
    let price = low;
    while (price < high && steps < MAX_STEPS) {
        price = nextPrice(price, enhancementLevel);
        steps += 1;
    }
    return steps;
}

/**
 * @param {string} text - What is typed in the quantity box, which accepts compact values like 5k
 * @returns {number} The quantity, 0 when it is empty or not a number
 */
export function parseQuantity(text) {
    const match = String(text || '')
        .trim()
        .toLowerCase()
        .replace(/,/g, '')
        .match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
    if (!match) return 0;
    const unit = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[match[2]];
    return Math.floor(parseFloat(match[1]) * unit);
}

/**
 * @param {{asks?: Array<{price: number}>, bids?: Array<{price: number}>}|undefined} book - One enhancement
 *     level of an item's order book
 * @param {number} enhancementLevel
 * @returns {{ask: number, bid: number, steps: number}|null} The gap between the best offers, null when either
 *     side is empty
 */
export function measureGap(book, enhancementLevel) {
    const ask = book?.asks?.[0]?.price;
    const bid = book?.bids?.[0]?.price;
    if (!(ask > 0) || !(bid > 0) || ask <= bid) return null;
    return { ask, bid, steps: countPriceSteps(bid, ask, enhancementLevel) };
}

class InstantOrderGap {
    constructor() {
        this.isInitialized = false;
        this.cleanupRegistry = createCleanupRegistry();
        this.processedModals = new WeakSet();
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('market_instantOrderGap')) return;

        this.isInitialized = true;
        const unregister = domObserver.onClass('instant-order-gap', 'Modal_modalContainer', (modal) => {
            this.handleModal(modal);
        });
        this.cleanupRegistry.registerCleanup(unregister);
    }

    /**
     * @param {HTMLElement} modal - Modal container element
     */
    handleModal(modal) {
        if (this.processedModals.has(modal)) return;
        if (!modal.querySelector('div[class*="MarketplacePanel_header"]')) return;
        this.processedModals.add(modal);

        // Let the dialog finish rendering before reading its state
        this.cleanupRegistry.registerTimeout(setTimeout(() => this.show(modal), SHOW_DELAY_MS));
    }

    /**
     * @param {HTMLElement} modal
     */
    show(modal) {
        if (!modal.isConnected || modal.querySelector('.mwi-instant-order-gap')) return;

        // The live Marketplace state says whether this is an instant order, locale-independent, and carries
        // the order book the game is showing for this very item
        const state = getMarketplaceRuntimeComponentFromElement(modal)?.state;
        if (!state?.isInstantOrder) return;
        const books = state.marketItemOrderBooks;
        if (!books || books.itemHrid !== state.itemHrid) return;

        const level = state.enhancementLevelInput || 0;
        const gap = measureGap(books.orderBooks?.[level], level);
        if (!gap || gap.steps < 2) return;

        const el = document.createElement('div');
        el.className = 'mwi-instant-order-gap';
        el.style.cssText = `text-align: center; font-size: 13px; margin: 4px 0; color: ${config.COLOR_WARNING};`;

        const quantityInput = modal.querySelector('[class*="MarketplacePanel_quantityInputs"] input');
        const render = () => {
            const quantity = parseQuantity(quantityInput?.value);
            const each = gap.ask - gap.bid;
            const params = {
                steps: gap.steps,
                each: formatWithSeparator(each),
                quantity: formatWithSeparator(quantity),
                total: formatWithSeparator(each * quantity),
            };
            const key = state.isSell ? 'instantOrderGap.sell' : 'instantOrderGap.buy';
            el.textContent = t(key, params) + (quantity > 1 ? t('instantOrderGap.totalSuffix', params) : '');
        };
        render();
        // The listener goes with the dialog when the game removes it
        quantityInput?.addEventListener('input', render);

        const quantityRow = quantityInput?.closest('div')?.parentElement?.parentElement;
        if (quantityRow) quantityRow.insertAdjacentElement('beforebegin', el);
        else modal.appendChild(el);
    }

    disable() {
        document.querySelectorAll('.mwi-instant-order-gap').forEach((el) => el.remove());
        this.cleanupRegistry.cleanupAll();
        this.processedModals = new WeakSet();
        this.isInitialized = false;
    }

    cleanup() {
        this.disable();
    }
}

const instantOrderGap = new InstantOrderGap();

export default instantOrderGap;
