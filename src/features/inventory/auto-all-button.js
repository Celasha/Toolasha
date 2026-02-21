/**
 * Auto All Button Feature
 * Automatically clicks the "All" button when opening loot boxes/containers
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

class AutoAllButton {
    constructor() {
        this.unregisterObserver = null;
        this.processedContainers = new WeakSet();
        this.itemNameToHridCache = null;
    }

    /**
     * Initialize the feature
     */
    initialize() {
        if (!config.getSetting('autoAllButton')) {
            return;
        }

        // Watch for tooltip/popper containers appearing (when clicking items)
        this.unregisterObserver = domObserver.register('AutoAllButton', (node) => {
            // Check if this is a tooltip/popper container
            const isTooltip = node.getAttribute && node.getAttribute('role') === 'tooltip';
            const isPopper = node.className && typeof node.className === 'string' && node.className.includes('Popper');

            if (isTooltip || isPopper) {
                this.handleContainer(node);
            }
        });
    }

    /**
     * Handle container appearance (tooltip/popper)
     * @param {Element} container - Container element
     */
    handleContainer(container) {
        // Skip if already processed
        if (this.processedContainers.has(container)) {
            return;
        }

        // Mark as processed immediately
        this.processedContainers.add(container);

        // Small delay to let content fully render
        setTimeout(() => {
            try {
                this.processContainer(container);
            } catch (error) {
                console.error('[AutoAllButton] Error processing container:', error);
            }
        }, 50);
    }

    /**
     * Process the container - check if it's for a loot box and click All button
     * @param {Element} container - Container element
     */
    processContainer(container) {
        // Find item name
        let itemName = null;

        // Method 1: Look for span with Item_name class
        const nameSpan = container.querySelector('[class*="Item_name"]');
        if (nameSpan) {
            itemName = nameSpan.textContent.trim();
        }

        // Method 2: Try SVG aria-label (fallback for other UI types)
        if (!itemName) {
            const svg = container.querySelector('svg[aria-label]');
            if (svg) {
                itemName = svg.getAttribute('aria-label');
            }
        }

        if (!itemName) {
            return;
        }

        // Get game data
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.itemDetailMap) {
            return;
        }

        // Find item HRID from name
        const itemHrid = this.findItemHrid(itemName, gameData);
        if (!itemHrid) {
            return;
        }

        // Check if item is openable - exit early if not
        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails || !itemDetails.isOpenable) {
            return;
        }

        // Item IS openable - find and click the "All" button
        this.clickAllButton(container);
    }

    /**
     * Find and click the "All" button in the container
     * @param {Element} container - Container element
     */
    clickAllButton(container) {
        const buttons = container.querySelectorAll('button');

        for (const button of buttons) {
            if (button.textContent.trim() === 'All' && !button.disabled) {
                button.click();
                break;
            }
        }
    }

    /**
     * Find item HRID by name
     * @param {string} itemName - Item name
     * @param {Object} gameData - Game data
     * @returns {string|null} Item HRID or null if not found
     */
    findItemHrid(itemName, gameData) {
        // Build cache on first use
        if (!this.itemNameToHridCache) {
            this.itemNameToHridCache = new Map();
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                if (item.name) {
                    this.itemNameToHridCache.set(item.name, hrid);
                }
            }
        }

        return this.itemNameToHridCache.get(itemName) || null;
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this.processedContainers = new WeakSet();
        this.itemNameToHridCache = null;
    }
}

const autoAllButton = new AutoAllButton();

export default {
    name: 'Auto All Button',
    initialize: () => autoAllButton.initialize(),
    cleanup: () => autoAllButton.disable(),
};
