/**
 * Shop Token Values
 * Shows each special-currency shop entry's value per token (market price × outputCount ÷ token
 * cost) in the Dungeon shop and the Labyrinth shop, and marks the best-value entry per currency.
 * Untradable capes show the cape base value setting, flagged as assumed and never marked best.
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import domObserver from '../../core/dom-observer.js';
import { formatKMB } from '../../utils/formatters.js';
import { getAllSpecialCurrencyShopEntries } from '../../utils/special-currency-shop.js';
import { DUNGEON_TOKEN_HRIDS } from '../../utils/token-valuation.js';
import { getBestEntryByCurrency, getShopRowValue } from './shop-token-values-logic.js';

const LABYRINTH_TOKEN_HRID = '/items/labyrinth_token';
const VALUE_CLASS = 'mwi-shop-token-value';
const OBSERVER_NAME = 'ShopTokenValues';
const CATCHUP_DELAY_MS = 500;
const REFRESH_DEBOUNCE_MS = 100;

const DUNGEON_TILE_SELECTOR = '[class*="ShopPanel_shopItems"] [class*="ShopPanel_shopItem__"]';
const LABYRINTH_TILE_SELECTOR = '[class*="LabyrinthPanel_buyableGrid"] [class*="LabyrinthPanel_item"]';

class ShopTokenValues {
    constructor() {
        this.unregisterHandlers = [];
        this.timer = null;
        this.isInitialized = false;
    }

    initialize() {
        if (!config.getSetting('shopTokenValues') || this.isInitialized) {
            return;
        }
        this.isInitialized = true;

        for (const className of ['ShopPanel_shopItems', 'LabyrinthPanel_buyableGrid']) {
            this.unregisterHandlers.push(
                domObserver.onClass(`${OBSERVER_NAME}_${className}`, className, () => this.scheduleRefresh())
            );
        }
        this.scheduleRefresh(CATCHUP_DELAY_MS);
    }

    disable() {
        clearTimeout(this.timer);
        this.timer = null;
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        document.querySelectorAll(`.${VALUE_CLASS}`).forEach((el) => el.remove());
        this.isInitialized = false;
    }

    scheduleRefresh(delay = REFRESH_DEBOUNCE_MS) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.refreshAll();
        }, delay);
    }

    /**
     * @param {Element} tile
     * @returns {string|null} Item HRID from the tile's icon sprite
     */
    extractItemHrid(tile) {
        const href =
            tile.querySelector('use')?.getAttribute('href') || tile.querySelector('use')?.getAttribute('xlink:href');
        const slug = href?.split('#')[1];
        return slug ? `/items/${slug}` : null;
    }

    /**
     * @param {Element} tile
     * @returns {number|null} Token cost shown on the tile (locale-independent digits)
     */
    extractCost(tile) {
        const text = tile.querySelector('[class*="ShopPanel_costs"]')?.textContent || '';
        const match = text.match(/\d[\d,.\s]*/);
        const value = match ? Number(match[0].replace(/[^\d]/g, '')) : NaN;
        return value > 0 ? value : null;
    }

    refreshAll() {
        const entries = getAllSpecialCurrencyShopEntries();
        if (entries.length === 0) {
            return;
        }
        const bestByCurrency = getBestEntryByCurrency(new Set([...DUNGEON_TOKEN_HRIDS, LABYRINTH_TOKEN_HRID]));

        document.querySelectorAll(DUNGEON_TILE_SELECTOR).forEach((tile) => {
            const itemHrid = this.extractItemHrid(tile);
            const cost = this.extractCost(tile);
            // The cost must match a token entry, so coin-priced tiles (General tab) are ignored
            const entry = entries.find(
                (e) => e.itemHrid === itemHrid && e.tokenCost === cost && DUNGEON_TOKEN_HRIDS.has(e.currencyHrid)
            );
            this.renderTile(tile, entry, bestByCurrency);
        });

        document.querySelectorAll(LABYRINTH_TILE_SELECTOR).forEach((tile) => {
            const itemHrid = this.extractItemHrid(tile);
            const entry = entries.find((e) => e.itemHrid === itemHrid && e.currencyHrid === LABYRINTH_TOKEN_HRID);
            this.renderTile(tile, entry, bestByCurrency);
        });
    }

    renderTile(tile, entry, bestByCurrency) {
        const existing = tile.querySelector(`.${VALUE_CLASS}`);
        if (!entry) {
            existing?.remove();
            return;
        }
        const row = getShopRowValue(entry);
        if (!row) {
            existing?.remove();
            return;
        }

        const element = existing || document.createElement('div');
        if (!existing) {
            element.className = VALUE_CLASS;
            element.style.cssText = 'font-size: 0.7rem; text-align: center; margin-top: 2px; line-height: 1.3;';
            tile.appendChild(element);
        }

        const isBest = !row.isAssumed && bestByCurrency.get(entry.currencyHrid) === entry.itemHrid;
        const value = row.perToken > 0 ? formatKMB(row.perToken) : '—';
        const suffix = (row.isOutlier ? ' ⚠' : '') + (row.isAssumed ? '*' : '');
        element.textContent = `${isBest ? '★ ' : ''}${t('shopTokenValue.perToken', { value })}${suffix}`;
        element.style.color = isBest ? '#4ade80' : '#aaa';
        element.style.fontWeight = isBest ? '600' : '400';
        element.title = row.isAssumed
            ? t('shopTokenValue.assumedTooltip', { value: formatKMB(row.assumedValue) })
            : isBest
              ? t('shopTokenValue.bestTooltip')
              : '';
    }
}

const shopTokenValues = new ShopTokenValues();

export default {
    name: 'Shop Token Values',
    initialize: () => shopTokenValues.initialize(),
    cleanup: () => shopTokenValues.disable(),
};

export { ShopTokenValues };
