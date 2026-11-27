/**
 * Wishlist Pricing
 * Prices a wishlist item with the same rules net worth uses (market price, then openable value,
 * crafting cost, shop cost, the game's reference value, and the enhancement path for enhanced items),
 * so a wishlist price always matches what net worth shows for that item.
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import { calculateItemValue } from '../../networth/networth-calculator.js';
import { getItemPrices } from '../../../utils/market-data.js';

/**
 * @typedef {Object} WishlistPrice
 * @property {number} price - Price per item (0 when nothing could price it)
 * @property {boolean} available - True when a price was found
 * @property {boolean} estimated - True when the price is a fallback, not a live market price
 */

/**
 * Price one wishlist item.
 * @param {{itemHrid: string, enhancementLevel?: number}} item
 * @returns {Promise<WishlistPrice>}
 */
export async function getWishlistPrice(item) {
    const enhancementLevel = item.enhancementLevel || 0;

    let price = 0;
    try {
        price = await calculateItemValue({ itemHrid: item.itemHrid, enhancementLevel, count: 1 });
    } catch (error) {
        console.error('[Wishlist] Pricing failed for', item.itemHrid, error);
    }
    if (!(price > 0)) return { price: 0, available: false, estimated: false };

    // The same price field net worth reads, so "live" means that field actually has a price
    const mode = config.getSettingValue('networth_pricingMode') || 'ask';
    const live = getItemPrices(item.itemHrid, enhancementLevel)?.[mode];

    return { price, available: true, estimated: !(live > 0) };
}

/**
 * Current coin balance
 * @returns {number}
 */
export function getCoinBalance() {
    const coin = dataManager.getInventory()?.find((item) => item.itemHrid === '/items/coin');
    return coin?.count || 0;
}
