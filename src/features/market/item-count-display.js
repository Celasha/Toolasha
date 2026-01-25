/**
 * Market Item Count Display Module
 *
 * Shows inventory count on market item tiles
 * Ported from Ranged Way Idle's visibleItemCountMarket feature
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';

class ItemCountDisplay {
    constructor() {
        this.unregisterObserver = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the item count display
     */
    initialize() {
        // Guard against duplicate initialization
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_visibleItemCount')) {
            return;
        }

        this.isInitialized = true;
        this.setupObserver();
    }

    /**
     * Setup DOM observer to watch for market panels
     */
    setupObserver() {
        // Watch for market items container
        this.unregisterObserver = domObserver.onClass(
            'ItemCountDisplay',
            'MarketplacePanel_marketItems',
            (marketContainer) => {
                this.updateItemCounts(marketContainer);
            }
        );

        // Check for existing market container
        const existingContainer = document.querySelector('[class*="MarketplacePanel_marketItems"]');
        if (existingContainer) {
            this.updateItemCounts(existingContainer);
        }
    }

    /**
     * Update item counts for all items in market container
     * @param {HTMLElement} marketContainer - The market items container
     */
    updateItemCounts(marketContainer) {
        // Build item count map from inventory
        const itemCountMap = this.buildItemCountMap();

        // Find all clickable item tiles
        const itemTiles = marketContainer.querySelectorAll('[class*="Item_clickable"]');

        for (const itemTile of itemTiles) {
            this.updateSingleItem(itemTile, itemCountMap);
        }
    }

    /**
     * Build a map of itemHrid → count from inventory
     * @returns {Object} Map of item HRIDs to counts
     */
    buildItemCountMap() {
        const itemCountMap = {};
        const inventory = dataManager.getInventory();
        const includeEquipped = config.getSetting('market_visibleItemCountIncludeEquipped');

        if (!inventory) {
            return itemCountMap;
        }

        // Count inventory items (sum across all enhancement levels)
        for (const item of inventory) {
            if (!item.itemHrid) continue;
            itemCountMap[item.itemHrid] = (itemCountMap[item.itemHrid] || 0) + (item.count || 0);
        }

        // Optionally include equipped items
        if (includeEquipped) {
            const equipment = dataManager.getEquipment();
            if (equipment) {
                for (const slot of Object.values(equipment)) {
                    if (slot && slot.itemHrid) {
                        itemCountMap[slot.itemHrid] = (itemCountMap[slot.itemHrid] || 0) + 1;
                    }
                }
            }
        }

        return itemCountMap;
    }

    /**
     * Update a single item tile with count
     * @param {HTMLElement} itemTile - The item tile element
     * @param {Object} itemCountMap - Map of item HRIDs to counts
     */
    updateSingleItem(itemTile, itemCountMap) {
        // Extract item HRID from SVG use element
        const useElement = itemTile.querySelector('use');
        if (!useElement || !useElement.href || !useElement.href.baseVal) {
            return;
        }

        // Extract item ID from href (e.g., "#iron_bar" -> "iron_bar")
        const itemId = useElement.href.baseVal.split('#')[1];
        if (!itemId) {
            return;
        }

        const itemHrid = `/items/${itemId}`;
        const itemCount = itemCountMap[itemHrid] || 0;

        // Find or create count display element
        let countDiv = itemTile.querySelector('.mwi-item-count');
        if (!countDiv) {
            countDiv = document.createElement('div');
            countDiv.className = 'mwi-item-count';
            itemTile.appendChild(countDiv);

            // Set positioning (only on first creation)
            itemTile.style.position = 'relative';
            countDiv.style.position = 'absolute';
            countDiv.style.bottom = '-1px';
            countDiv.style.right = '2px';
            countDiv.style.textAlign = 'right';
            countDiv.style.fontSize = '0.85em';
            countDiv.style.fontWeight = 'bold';
            countDiv.style.pointerEvents = 'none';
        }

        // Get opacity setting (use getSettingValue for non-boolean settings)
        const opacity = config.getSettingValue('market_visibleItemCountOpacity', 0.25);

        // Update display based on count
        if (itemCount === 0) {
            // No items: dim the tile, hide the count text
            itemTile.style.opacity = opacity.toString();
            countDiv.textContent = '';
        } else {
            // Has items: full opacity, show count
            itemTile.style.opacity = '1.0';
            countDiv.textContent = itemCount.toString();
        }
    }

    /**
     * Disable the item count display
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove all injected count displays and reset opacity
        document.querySelectorAll('.mwi-item-count').forEach(el => el.remove());
        document.querySelectorAll('[class*="Item_clickable"]').forEach(tile => {
            tile.style.opacity = '1.0';
        });

        this.isInitialized = false;
    }
}

// Create and export singleton instance
const itemCountDisplay = new ItemCountDisplay();

export default itemCountDisplay;
