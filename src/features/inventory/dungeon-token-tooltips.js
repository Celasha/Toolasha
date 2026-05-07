/**
 * Currency Token Shop Tooltips
 * Adds shop item lists and valuations to currency token tooltips with market pricing.
 * Supports dungeon tokens, task tokens, labyrinth tokens, seals, and cowbells.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import dom from '../../utils/dom.js';
import { formatKMB } from '../../utils/formatters.js';
import { getItemPrices } from '../../utils/market-data.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';

/**
 * Token types and their shop data sources
 */
const DUNGEON_TOKENS = new Set([
    '/items/chimerical_token',
    '/items/sinister_token',
    '/items/enchanted_token',
    '/items/pirate_token',
]);

const TASK_TOKEN = '/items/task_token';
const LABYRINTH_TOKEN = '/items/labyrinth_token';
const COWBELL = '/items/cowbell';
const BAG_OF_COWBELLS = '/items/bag_of_10_cowbells';

/**
 * All seal HRIDs (cost 30 labyrinth tokens each)
 */
const SEAL_HRIDS = new Set([
    '/items/seal_of_action_speed',
    '/items/seal_of_attack_speed',
    '/items/seal_of_cast_speed',
    '/items/seal_of_combat_drop',
    '/items/seal_of_critical_rate',
    '/items/seal_of_damage',
    '/items/seal_of_efficiency',
    '/items/seal_of_gathering',
    '/items/seal_of_gourmet',
    '/items/seal_of_processing',
    '/items/seal_of_rare_find',
    '/items/seal_of_wisdom',
]);

const SEAL_TOKEN_COST = 30;

/**
 * DungeonTokenTooltips class handles injecting shop item lists into currency token tooltips
 */
class DungeonTokenTooltips {
    constructor() {
        this.unregisterObserver = null;
        this.isActive = false;
        this.isInitialized = false;
        this.itemNameToHridCache = null;
        this.itemNameToHridCacheSource = null;
    }

    /**
     * Initialize the dungeon token tooltips feature
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.isFeatureEnabled('dungeonTokenTooltips')) {
            return;
        }

        this.isInitialized = true;
        this.setupObserver();
    }

    /**
     * Set up observer to watch for tooltip elements
     */
    setupObserver() {
        this.unregisterObserver = domObserver.onClass('DungeonTokenTooltips', 'MuiTooltip-popper', (tooltipElement) => {
            this.handleTooltip(tooltipElement);
        });

        this.isActive = true;
    }

    /**
     * Handle a tooltip element
     * @param {Element} tooltipElement - The tooltip popper element
     */
    async handleTooltip(tooltipElement) {
        if (!config.isFeatureEnabled('dungeonTokenTooltips')) {
            return;
        }

        if (tooltipElement.dataset.dungeonProcessed) {
            return;
        }
        tooltipElement.dataset.dungeonProcessed = 'true';

        const collectionContent = tooltipElement.querySelector('div.Collection_tooltipContent__2IcSJ');
        const isCollectionTooltip = !!collectionContent;

        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
        const isItemTooltip = !!nameElement;

        if (!isCollectionTooltip && !isItemTooltip) {
            return;
        }

        let itemName;
        if (isCollectionTooltip) {
            const collectionNameElement = tooltipElement.querySelector('div.Collection_name__10aep');
            if (!collectionNameElement) {
                return;
            }
            itemName = collectionNameElement.textContent.trim();
        } else {
            itemName = nameElement.textContent.trim();
        }

        const itemHrid = this.extractItemHridFromName(itemName);
        if (!itemHrid) {
            return;
        }

        // Route to appropriate handler
        if (DUNGEON_TOKENS.has(itemHrid)) {
            this._handleDungeonToken(tooltipElement, itemHrid, isCollectionTooltip);
        } else if (itemHrid === TASK_TOKEN) {
            this._handleTaskToken(tooltipElement, isCollectionTooltip);
        } else if (itemHrid === LABYRINTH_TOKEN) {
            this._handleLabyrinthToken(tooltipElement, isCollectionTooltip);
        } else if (SEAL_HRIDS.has(itemHrid)) {
            this._handleSeal(tooltipElement, isCollectionTooltip);
        } else if (itemHrid === COWBELL) {
            this._handleCowbell(tooltipElement, isCollectionTooltip);
        }
    }

    /**
     * Handle dungeon token tooltip — shop table from shopItemDetailMap
     */
    _handleDungeonToken(tooltipElement, tokenHrid, isCollectionTooltip) {
        const shopItems = this._getDungeonShopItems(tokenHrid);
        if (!shopItems || shopItems.length === 0) return;

        this._injectShopTable(tooltipElement, shopItems, 'Token Shop Value:', 'Gold/Token', isCollectionTooltip);
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Handle task token tooltip — shop table from taskShopItemDetailMap
     * Uses expected value for openable chests
     */
    _handleTaskToken(tooltipElement, isCollectionTooltip) {
        const shopItems = this._getTaskShopItems();
        if (!shopItems || shopItems.length === 0) return;

        this._injectShopTable(tooltipElement, shopItems, 'Task Shop Value:', 'Gold/Token', isCollectionTooltip);
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Handle labyrinth token tooltip — shop table from labyrinthShopItemDetailMap
     */
    _handleLabyrinthToken(tooltipElement, isCollectionTooltip) {
        const shopItems = this._getLabyrinthShopItems();
        if (!shopItems || shopItems.length === 0) return;

        this._injectShopTable(tooltipElement, shopItems, 'Labyrinth Shop Value:', 'Gold/Token', isCollectionTooltip);
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Handle seal tooltip — show value based on labyrinth token cost
     */
    _handleSeal(tooltipElement, isCollectionTooltip) {
        const labyrinthItems = this._getLabyrinthShopItems();
        if (!labyrinthItems || labyrinthItems.length === 0) return;

        // Best gold per labyrinth token
        const bestGoldPerToken = labyrinthItems[0].goldPerToken;
        const sealValue = Math.floor(SEAL_TOKEN_COST * bestGoldPerToken);

        if (sealValue <= 0) return;

        this._injectSimpleValue(
            tooltipElement,
            `Value: ${formatKMB(sealValue)} gold`,
            `= ${SEAL_TOKEN_COST} Labyrinth Tokens × ${formatKMB(Math.floor(bestGoldPerToken))} gold/token`,
            isCollectionTooltip
        );
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Handle cowbell tooltip — show value based on bag of 10 cowbells market price
     */
    _handleCowbell(tooltipElement, isCollectionTooltip) {
        const prices = getItemPrices(BAG_OF_COWBELLS, 0);
        const bagPrice = prices?.ask > 0 ? prices.ask : prices?.bid > 0 ? prices.bid : 0;
        if (bagPrice <= 0) return;

        const cowbellValue = Math.floor(bagPrice / 10);

        this._injectSimpleValue(
            tooltipElement,
            `Value: ${formatKMB(cowbellValue)} gold`,
            `= Bag of 10 Cowbells (${formatKMB(bagPrice)}) ÷ 10`,
            isCollectionTooltip
        );
        dom.fixTooltipOverflow(tooltipElement);
    }

    /**
     * Extract item HRID from item name
     * @param {string} itemName - Item name from tooltip
     * @returns {string|null} Item HRID or null if not found
     */
    extractItemHridFromName(itemName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.itemDetailMap) {
            return null;
        }

        if (this.itemNameToHridCache && this.itemNameToHridCacheSource === gameData.itemDetailMap) {
            return this.itemNameToHridCache.get(itemName) || null;
        }

        const map = new Map();
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            map.set(item.name, hrid);
        }

        if (map.size > 0) {
            this.itemNameToHridCache = map;
            this.itemNameToHridCacheSource = gameData.itemDetailMap;
        }

        return map.get(itemName) || null;
    }

    /**
     * Get shop items from shopItemDetailMap (dungeon tokens)
     * @param {string} tokenHrid - Dungeon token HRID
     * @returns {Array} Shop items with pricing data
     */
    _getDungeonShopItems(tokenHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.shopItemDetailMap || !gameData?.itemDetailMap) return [];

        return Object.values(gameData.shopItemDetailMap)
            .filter((shopItem) => shopItem.costs && shopItem.costs[0]?.itemHrid === tokenHrid)
            .map((shopItem) => {
                const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
                const tokenCost = shopItem.costs[0].count;

                const prices = getItemPrices(shopItem.itemHrid, 0);
                const askPrice = prices?.ask || null;

                if (!askPrice || askPrice <= 0) return null;

                return {
                    name: itemDetails?.name || 'Unknown Item',
                    cost: tokenCost,
                    askPrice,
                    goldPerToken: askPrice / tokenCost,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.goldPerToken - a.goldPerToken);
    }

    /**
     * Get shop items from taskShopItemDetailMap (task tokens)
     * Uses expected value for openable items, market price for tradeable items
     * @returns {Array} Shop items with pricing data
     */
    _getTaskShopItems() {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.taskShopItemDetailMap || !gameData?.itemDetailMap) return [];

        return Object.values(gameData.taskShopItemDetailMap)
            .map((shopItem) => {
                const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
                const tokenCost = shopItem.cost?.count || 0;
                if (tokenCost <= 0) return null;

                let itemValue = 0;
                let valueSource = '';

                // Try market price first (tradeable items like Task Crystal)
                const prices = getItemPrices(shopItem.itemHrid, 0);
                if (prices?.ask > 0) {
                    itemValue = prices.ask;
                    valueSource = 'ask';
                }

                // For openable items, use expected value if higher
                if (itemDetails?.isOpenable) {
                    const evData = expectedValueCalculator.calculateExpectedValue(shopItem.itemHrid);
                    if (evData?.expectedValue > 0) {
                        if (evData.expectedValue > itemValue) {
                            itemValue = evData.expectedValue;
                            valueSource = 'EV';
                        }
                    }
                }

                if (itemValue <= 0) return null;

                return {
                    name: itemDetails?.name || 'Unknown Item',
                    cost: tokenCost,
                    askPrice: itemValue,
                    goldPerToken: itemValue / tokenCost,
                    valueSource,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.goldPerToken - a.goldPerToken);
    }

    /**
     * Get shop items from labyrinthShopItemDetailMap (labyrinth tokens)
     * Only includes items with market value (tradeable items)
     * Accounts for outputCount (e.g., 1 token → 10 essences)
     * @returns {Array} Shop items with pricing data
     */
    _getLabyrinthShopItems() {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.labyrinthShopItemDetailMap || !gameData?.itemDetailMap) return [];

        return Object.values(gameData.labyrinthShopItemDetailMap)
            .map((shopItem) => {
                const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
                const tokenCost = shopItem.cost?.count || 0;
                const outputCount = shopItem.outputCount || 1;
                if (tokenCost <= 0) return null;

                const prices = getItemPrices(shopItem.itemHrid, 0);
                const askPrice = prices?.ask || null;

                if (!askPrice || askPrice <= 0) return null;

                // Total value = ask price × output count
                const totalValue = askPrice * outputCount;

                return {
                    name: itemDetails?.name || 'Unknown Item',
                    cost: tokenCost,
                    askPrice: totalValue,
                    goldPerToken: totalValue / tokenCost,
                    outputCount,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.goldPerToken - a.goldPerToken);
    }

    /**
     * Inject a shop table into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Array} shopItems - Shop items with pricing data
     * @param {string} title - Table title
     * @param {string} efficiencyLabel - Label for the efficiency column
     * @param {boolean} isCollectionTooltip - True if collection tooltip
     */
    _injectShopTable(tooltipElement, shopItems, title, efficiencyLabel, isCollectionTooltip = false) {
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText || tooltipText.querySelector('.dungeon-token-shop-injected')) return;

        const shopDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'dungeon-token-shop-injected');

        let html = `<div style="margin-top: 8px;"><strong>${title}</strong></div>`;
        html += '<table style="width: 100%; margin-top: 4px; font-size: 12px;">';
        html += '<tr style="border-bottom: 1px solid #444;">';
        html += '<th style="text-align: left; padding: 2px 4px;">Item</th>';
        html += '<th style="text-align: right; padding: 2px 4px;">Cost</th>';
        html += '<th style="text-align: right; padding: 2px 4px;">Value</th>';
        html += `<th style="text-align: right; padding: 2px 4px;">${efficiencyLabel}</th>`;
        html += '</tr>';

        const bestGoldPerToken = shopItems[0].goldPerToken;

        for (const item of shopItems) {
            const isBestValue = item.goldPerToken === bestGoldPerToken;
            const rowStyle = isBestValue ? 'background-color: rgba(4, 120, 87, 0.2);' : '';
            const fontWeight = isBestValue ? 'bold' : 'normal';

            // Show output count if > 1 (e.g., "×10")
            const nameDisplay = item.outputCount > 1 ? `${item.name} ×${item.outputCount}` : item.name;
            // Show EV tag for expected-value priced items
            const valueDisplay =
                item.valueSource === 'EV'
                    ? `${formatKMB(item.askPrice)} <span style="color:#888; font-size:10px;">EV</span>`
                    : formatKMB(item.askPrice);

            html += `<tr style="${rowStyle}">`;
            html += `<td style="padding: 2px 4px;">${nameDisplay}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px;">${formatKMB(item.cost)}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px;">${valueDisplay}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px; font-weight: ${fontWeight};">${formatKMB(Math.floor(item.goldPerToken))}</td>`;
            html += '</tr>';
        }

        html += '</table>';
        shopDiv.innerHTML = html;
        tooltipText.appendChild(shopDiv);
    }

    /**
     * Inject a simple value line into tooltip (for seals and cowbells)
     * @param {Element} tooltipElement - Tooltip element
     * @param {string} valueLine - Main value text
     * @param {string} detailLine - Detail/explanation text
     * @param {boolean} isCollectionTooltip - True if collection tooltip
     */
    _injectSimpleValue(tooltipElement, valueLine, detailLine, isCollectionTooltip = false) {
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText || tooltipText.querySelector('.dungeon-token-shop-injected')) return;

        const valueDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'dungeon-token-shop-injected');

        let html = `<div style="margin-top: 8px;"><strong>${valueLine}</strong></div>`;
        html += `<div style="font-size: 11px; color: #888; margin-top: 2px;">${detailLine}</div>`;

        valueDiv.innerHTML = html;
        tooltipText.appendChild(valueDiv);
    }

    /**
     * Cleanup
     */
    cleanup() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        this.isActive = false;
        this.isInitialized = false;
    }

    disable() {
        this.cleanup();
    }
}

const dungeonTokenTooltips = new DungeonTokenTooltips();

export default {
    name: 'Dungeon Token Tooltips',
    initialize: async () => {
        await dungeonTokenTooltips.initialize();
    },
    cleanup: () => {
        dungeonTokenTooltips.cleanup();
    },
    disable: () => {
        dungeonTokenTooltips.disable();
    },
};
