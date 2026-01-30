/**
 * Dungeon Token Shop Tooltips
 * Adds shop item lists to dungeon token tooltips with market pricing
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import dom from '../../utils/dom.js';
import { numberFormatter } from '../../utils/formatters.js';
import { getItemPrices } from '../../utils/market-data.js';

/**
 * Dungeon token HRIDs
 */
const DUNGEON_TOKENS = {
    '/items/chimerical_token': 'Chimerical Token',
    '/items/sinister_token': 'Sinister Token',
    '/items/enchanted_token': 'Enchanted Token',
    '/items/pirate_token': 'Pirate Token',
};

/**
 * DungeonTokenTooltips class handles injecting shop item lists into dungeon token tooltips
 */
class DungeonTokenTooltips {
    constructor() {
        this.unregisterObserver = null;
        this.isActive = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the dungeon token tooltips feature
     */
    async initialize() {
        // Guard against duplicate initialization
        if (this.isInitialized) {
            return;
        }

        // Check if feature is enabled
        if (!config.isFeatureEnabled('dungeonTokenTooltips')) {
            return;
        }

        this.isInitialized = true;

        // Register with centralized DOM observer
        this.setupObserver();
    }

    /**
     * Set up observer to watch for tooltip elements
     */
    setupObserver() {
        // Register with centralized DOM observer to watch for tooltip poppers
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
        // Check if it's a collection tooltip
        const collectionContent = tooltipElement.querySelector('div.Collection_tooltipContent__2IcSJ');
        const isCollectionTooltip = !!collectionContent;

        // Check if it's a regular item tooltip
        const nameElement = tooltipElement.querySelector('div.ItemTooltipText_name__2JAHA');
        const isItemTooltip = !!nameElement;

        if (!isCollectionTooltip && !isItemTooltip) {
            return; // Not a tooltip we can enhance
        }

        // Extract item name from appropriate element
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

        // Get the item HRID from the name
        const itemHrid = this.extractItemHridFromName(itemName);

        if (!itemHrid) {
            return;
        }

        // Check if this is a dungeon token
        if (!DUNGEON_TOKENS[itemHrid]) {
            return; // Not a dungeon token
        }

        // Get shop items for this token
        const shopItems = this.getShopItemsForToken(itemHrid);

        if (!shopItems || shopItems.length === 0) {
            return; // No shop items found
        }

        // Inject shop items display
        this.injectShopItemsDisplay(tooltipElement, shopItems, isCollectionTooltip);

        // Fix tooltip overflow
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

        // Search for item by name
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            if (item.name === itemName) {
                return hrid;
            }
        }

        return null;
    }

    /**
     * Get shop items purchasable with a specific token with market prices
     * @param {string} tokenHrid - Dungeon token HRID
     * @returns {Array} Array of shop items with pricing data (only tradeable items)
     */
    getShopItemsForToken(tokenHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.shopItemDetailMap || !gameData.itemDetailMap) {
            return [];
        }

        // Filter shop items by token cost
        const shopItems = Object.values(gameData.shopItemDetailMap)
            .filter((shopItem) => shopItem.costs && shopItem.costs[0]?.itemHrid === tokenHrid)
            .map((shopItem) => {
                const itemDetails = gameData.itemDetailMap[shopItem.itemHrid];
                const tokenCost = shopItem.costs[0].count;

                // Get market ask price (same as networth calculation)
                const prices = getItemPrices(shopItem.itemHrid, 0);
                const askPrice = prices?.ask || null;

                // Only include tradeable items (items with ask prices)
                if (!askPrice || askPrice <= 0) {
                    return null;
                }

                // Calculate gold per token efficiency
                const goldPerToken = askPrice / tokenCost;

                return {
                    name: itemDetails?.name || 'Unknown Item',
                    hrid: shopItem.itemHrid,
                    cost: tokenCost,
                    askPrice: askPrice,
                    goldPerToken: goldPerToken,
                };
            })
            .filter((item) => item !== null) // Remove non-tradeable items
            .sort((a, b) => b.goldPerToken - a.goldPerToken); // Sort by efficiency (best first)

        return shopItems;
    }

    /**
     * Inject shop items display into tooltip
     * @param {Element} tooltipElement - Tooltip element
     * @param {Array} shopItems - Array of shop items with pricing data
     * @param {boolean} isCollectionTooltip - True if this is a collection tooltip
     */
    injectShopItemsDisplay(tooltipElement, shopItems, isCollectionTooltip = false) {
        // Find the tooltip text container
        const tooltipText = isCollectionTooltip
            ? tooltipElement.querySelector('.Collection_tooltipContent__2IcSJ')
            : tooltipElement.querySelector('.ItemTooltipText_itemTooltipText__zFq3A');

        if (!tooltipText) {
            return;
        }

        // Check if we already injected (prevent duplicates)
        if (tooltipText.querySelector('.dungeon-token-shop-injected')) {
            return;
        }

        // Create shop items display container
        const shopDiv = dom.createStyledDiv({ color: config.COLOR_TOOLTIP_INFO }, '', 'dungeon-token-shop-injected');

        // Build table HTML content
        let html = '<div style="margin-top: 8px;"><strong>Token Shop Value:</strong></div>';
        html += '<table style="width: 100%; margin-top: 4px; font-size: 12px;">';
        html += '<tr style="border-bottom: 1px solid #444;">';
        html += '<th style="text-align: left; padding: 2px 4px;">Item</th>';
        html += '<th style="text-align: right; padding: 2px 4px;">Cost</th>';
        html += '<th style="text-align: right; padding: 2px 4px;">Ask Price</th>';
        html += '<th style="text-align: right; padding: 2px 4px;">Gold/Token</th>';
        html += '</tr>';

        shopItems.forEach((item, index) => {
            // Highlight the best value (first item after sorting)
            const isBestValue = index === 0;
            const rowStyle = isBestValue ? 'background-color: rgba(4, 120, 87, 0.2);' : '';

            html += `<tr style="${rowStyle}">`;
            html += `<td style="padding: 2px 4px;">${item.name}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px;">${numberFormatter(item.cost)}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px;">${numberFormatter(item.askPrice)}</td>`;
            html += `<td style="text-align: right; padding: 2px 4px; font-weight: ${isBestValue ? 'bold' : 'normal'};">${numberFormatter(Math.floor(item.goldPerToken))}</td>`;
            html += '</tr>';
        });

        html += '</table>';

        shopDiv.innerHTML = html;

        // Insert at the end of the tooltip
        tooltipText.appendChild(shopDiv);
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
}

// Create singleton instance
const dungeonTokenTooltips = new DungeonTokenTooltips();

export default {
    name: 'Dungeon Token Tooltips',
    initialize: async () => {
        await dungeonTokenTooltips.initialize();
    },
    cleanup: () => {
        dungeonTokenTooltips.cleanup();
    },
};
