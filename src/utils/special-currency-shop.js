/**
 * Special-Currency Shop Data (TLA-041E)
 *
 * Pure data normalization over the game's official special-currency shops
 * (`shopItemDetailMap` for dungeon tokens, `taskShopItemDetailMap`, `labyrinthShopItemDetailMap`).
 * No valuation logic lives here (no Ask/EV/opportunity math) - just "what can be bought, with which
 * currency, at what cost/outputCount" - so both Profile Score's acquisition resolver and the
 * existing Token Tooltip feature can read the same shop facts without duplicating the map-scanning.
 */

import dataManager from '../core/data-manager.js';

let cachedEntries = null;
let cachedSource = null;

/**
 * @param {Object} shopItem
 * @param {string} costItemHrid
 * @param {number} costCount
 * @param {number} outputCount
 * @param {Object} itemDetailMap
 * @returns {{itemHrid: string, currencyHrid: string, tokenCost: number, outputCount: number, isOpenable: boolean}}
 */
function normalizeEntry(shopItem, costItemHrid, costCount, outputCount, itemDetailMap) {
    return {
        itemHrid: shopItem.itemHrid,
        currencyHrid: costItemHrid,
        tokenCost: costCount,
        outputCount: outputCount || 1,
        isOpenable: !!itemDetailMap?.[shopItem.itemHrid]?.isOpenable,
    };
}

/**
 * @param {Object} gameData
 * @returns {Array<{itemHrid: string, currencyHrid: string, tokenCost: number, outputCount: number, isOpenable: boolean}>}
 */
function computeEntries(gameData) {
    const itemDetailMap = gameData.itemDetailMap || {};
    const entries = [];

    for (const shopItem of Object.values(gameData.shopItemDetailMap || {})) {
        const cost = shopItem.costs?.[0];
        if (!cost || !cost.itemHrid || cost.itemHrid === '/items/coin' || !(cost.count > 0)) continue;
        entries.push(normalizeEntry(shopItem, cost.itemHrid, cost.count, shopItem.outputCount, itemDetailMap));
    }

    for (const shopItem of Object.values(gameData.taskShopItemDetailMap || {})) {
        const cost = shopItem.cost;
        if (!cost?.itemHrid || !(cost.count > 0)) continue;
        entries.push(normalizeEntry(shopItem, cost.itemHrid, cost.count, shopItem.outputCount, itemDetailMap));
    }

    for (const shopItem of Object.values(gameData.labyrinthShopItemDetailMap || {})) {
        const cost = shopItem.cost;
        if (!cost?.itemHrid || !(cost.count > 0)) continue;
        entries.push(normalizeEntry(shopItem, cost.itemHrid, cost.count, shopItem.outputCount, itemDetailMap));
    }

    return entries;
}

/**
 * All official special-currency shop outputs across dungeon/task/labyrinth shops, normalized to one
 * shape. Cached per game-data snapshot (invalidated automatically when `dataManager` hands out a new
 * client-data object, e.g. on character switch), since these are static shop facts, not market prices.
 * @returns {Array<{itemHrid: string, currencyHrid: string, tokenCost: number, outputCount: number, isOpenable: boolean}>}
 */
export function getAllSpecialCurrencyShopEntries() {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return [];

    if (cachedSource === gameData) return cachedEntries;

    cachedEntries = computeEntries(gameData);
    cachedSource = gameData;
    return cachedEntries;
}

/**
 * @param {string} currencyHrid - e.g. '/items/task_token'
 * @returns {Array<{itemHrid: string, currencyHrid: string, tokenCost: number, outputCount: number, isOpenable: boolean}>}
 */
export function getShopEntriesForCurrency(currencyHrid) {
    return getAllSpecialCurrencyShopEntries().filter((entry) => entry.currencyHrid === currencyHrid);
}

/**
 * Look up an item's own official special-currency purchase, if it is directly buyable from any of
 * the three special-currency shops.
 * @param {string} itemHrid
 * @returns {{currencyHrid: string, tokenCost: number, outputCount: number}|null}
 */
export function findShopPurchaseInfo(itemHrid) {
    const entry = getAllSpecialCurrencyShopEntries().find((e) => e.itemHrid === itemHrid);
    if (!entry) return null;
    return { currencyHrid: entry.currencyHrid, tokenCost: entry.tokenCost, outputCount: entry.outputCount };
}
