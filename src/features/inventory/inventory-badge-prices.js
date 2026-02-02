/**
 * Inventory Badge Prices Module
 * Shows ask/bid price badges on inventory item icons
 * Works independently of inventory sorting feature
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import marketAPI from '../../api/marketplace.js';
import { formatKMB } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import inventoryBadgeManager from './inventory-badge-manager.js';
import inventorySort from './inventory-sort.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * InventoryBadgePrices class manages price badge overlays on inventory items
 */
class InventoryBadgePrices {
    constructor() {
        this.unregisterHandlers = [];
        this.currentInventoryElem = null;
        this.warnedItems = new Set();
        this.isCalculating = false;
        this.isInitialized = false;
        this.itemsUpdatedHandler = null;
        this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
        this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Setup setting change listener (always active, even when feature is disabled)
     */
    setupSettingListener() {
        // Listen for main toggle changes
        config.onSettingChange('invBadgePrices', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_invBadge_bid', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });

        config.onSettingChange('color_invBadge_ask', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize badge prices feature
     */
    initialize() {
        if (!config.getSetting('invBadgePrices')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Check if inventory is already open
        const existingInv = document.querySelector('[class*="Inventory_items"]');
        if (existingInv) {
            this.currentInventoryElem = existingInv;
            this.updateBadges();
        }

        // Watch for inventory panel
        const unregister = domObserver.onClass('InventoryBadgePrices', 'Inventory_items', (elem) => {
            this.currentInventoryElem = elem;
            this.updateBadges();
        });
        this.unregisterHandlers.push(unregister);

        // Register with badge manager for coordinated rendering
        inventoryBadgeManager.registerProvider(
            'inventory-badge-prices',
            (itemElem) => this.renderBadgesForItem(itemElem),
            100 // Priority: render after stack prices
        );

        // Store handler reference for cleanup with debouncing
        this.itemsUpdatedHandler = () => {
            clearTimeout(this.itemsUpdatedDebounceTimer);
            this.itemsUpdatedDebounceTimer = setTimeout(() => {
                if (this.currentInventoryElem) {
                    this.updateBadges();
                }
            }, this.DEBOUNCE_DELAY);
        };

        // Listen for inventory changes to recalculate prices
        dataManager.on('items_updated', this.itemsUpdatedHandler);

        // Listen for market data updates
        this.setupMarketDataListener();
    }

    /**
     * Setup listener for market data updates
     */
    setupMarketDataListener() {
        if (!marketAPI.isLoaded()) {
            let retryCount = 0;
            const maxRetries = 10;
            const retryInterval = 500;

            const retryCheck = setInterval(() => {
                retryCount++;

                if (marketAPI.isLoaded()) {
                    clearInterval(retryCheck);
                    if (this.currentInventoryElem) {
                        this.updateBadges();
                    }
                } else if (retryCount >= maxRetries) {
                    console.warn('[InventoryBadgePrices] Market data still not available after', maxRetries, 'retries');
                    clearInterval(retryCheck);
                }
            }, retryInterval);

            this.timerRegistry.registerInterval(retryCheck);
        }
    }

    /**
     * Update all price badges (delegates to badge manager)
     * Skips rendering if InventorySort is active (it already handles badge rendering)
     */
    async updateBadges() {
        // Skip if InventorySort is active - it already calls renderAllBadges() in applyCurrentSort()
        // This prevents duplicate calculations when both modules are enabled
        if (inventorySort.isInitialized && config.getSetting('invSort')) {
            return;
        }

        await inventoryBadgeManager.renderAllBadges();
    }

    /**
     * Render price badges for a single item (called by badge manager)
     * @param {Element} itemElem - Item container element
     */
    renderBadgesForItem(itemElem) {
        // Get per-item prices from dataset
        const bidPrice = parseFloat(itemElem.dataset.bidPrice) || 0;
        const askPrice = parseFloat(itemElem.dataset.askPrice) || 0;

        // Show badges if they have values and don't already exist
        if (bidPrice > 0 && !itemElem.querySelector('.mwi-badge-price-bid')) {
            this.renderPriceBadge(itemElem, bidPrice, 'bid');
        }
        if (askPrice > 0 && !itemElem.querySelector('.mwi-badge-price-ask')) {
            this.renderPriceBadge(itemElem, askPrice, 'ask');
        }
    }

    /**
     * Render all badges (legacy method - now delegates to manager)
     */
    renderBadges() {
        inventoryBadgeManager.renderAllBadges();
    }

    /**
     * Render price badge on item
     * @param {Element} itemElem - Item container element
     * @param {number} price - Per-item price
     * @param {string} type - 'bid' or 'ask'
     */
    renderPriceBadge(itemElem, price, type) {
        itemElem.style.position = 'relative';

        const badge = document.createElement('div');
        badge.className = `mwi-badge-price-${type}`;

        // Position: vertically centered on left (ask) or right (bid)
        const isAsk = type === 'ask';
        const color = isAsk ? config.COLOR_INVBADGE_ASK : config.COLOR_INVBADGE_BID;

        badge.style.cssText = `
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            ${isAsk ? 'left: 2px;' : 'right: 2px;'}
            z-index: 1;
            color: ${color};
            font-size: 0.7rem;
            font-weight: bold;
            text-align: ${isAsk ? 'left' : 'right'};
            pointer-events: none;
            text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;
        `;
        badge.textContent = formatKMB(Math.round(price), 0);

        const itemInner = itemElem.querySelector('[class*="Item_item"]');
        if (itemInner) {
            itemInner.appendChild(badge);
        }
    }

    /**
     * Refresh badges (called when settings change)
     */
    refresh() {
        // Clear badge manager's processed tracking to force re-render
        inventoryBadgeManager.clearProcessedTracking();

        // Remove all existing badges so they can be recreated with new settings
        const badges = document.querySelectorAll('.mwi-badge-price-bid, .mwi-badge-price-ask');
        badges.forEach((badge) => badge.remove());

        // Trigger re-render
        this.updateBadges();
    }

    /**
     * Disable and cleanup
     */
    disable() {
        // Clear debounce timer
        clearTimeout(this.itemsUpdatedDebounceTimer);
        this.itemsUpdatedDebounceTimer = null;

        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }

        inventoryBadgeManager.unregisterProvider('inventory-badge-prices');

        const badges = document.querySelectorAll('.mwi-badge-price-bid, .mwi-badge-price-ask');
        badges.forEach((badge) => badge.remove());

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        this.timerRegistry.clearAll();

        this.currentInventoryElem = null;
        this.isInitialized = false;
    }
}

const inventoryBadgePrices = new InventoryBadgePrices();

inventoryBadgePrices.setupSettingListener();

export default inventoryBadgePrices;
