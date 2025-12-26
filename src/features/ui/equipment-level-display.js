/**
 * Equipment Level Display
 * Shows item level in top right corner of equipment icons
 * Based on original MWI Tools implementation
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';

/**
 * EquipmentLevelDisplay class adds level overlays to equipment icons
 */
class EquipmentLevelDisplay {
    constructor() {
        this.observer = null;
        this.isActive = false;
        this.processedDivs = new WeakSet(); // Track already-processed divs
    }

    /**
     * Initialize the equipment level display
     */
    initialize() {
        // Check if feature is enabled
        if (!config.getSetting('itemIconLevel')) {
            return;
        }

        // Set up MutationObserver to watch for new item icons
        this.observer = new MutationObserver((mutations) => {
            // Only process if we see actual node additions
            let shouldProcess = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                    break;
                }
            }

            if (shouldProcess) {
                this.addItemLevels();
            }
        });

        // Watch for new elements anywhere in the page
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Process any existing items on page
        this.addItemLevels();

        this.isActive = true;
    }

    /**
     * Add item levels to all equipment icons
     * Matches original MWI Tools logic - UNCHANGED
     */
    addItemLevels() {
        // Find all item icon divs (the clickable containers)
        const iconDivs = document.querySelectorAll('div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6');

        for (const div of iconDivs) {
            // Skip if already processed
            if (this.processedDivs.has(div)) {
                continue;
            }

            // Skip if already has a name element (tooltip is open)
            if (div.querySelector('div.Item_name__2C42x')) {
                continue;
            }

            // Get the use element inside this div
            const useElement = div.querySelector('use');
            if (!useElement) {
                continue;
            }

            const href = useElement.getAttribute('href');
            if (!href) {
                continue;
            }

            // Extract item HRID (e.g., "#cheese_sword" -> "/items/cheese_sword")
            const hrefName = href.split('#')[1];
            const itemHrid = `/items/${hrefName}`;

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                continue;
            }

            // For equipment, show the level requirement (not itemLevel)
            // For ability books, show the ability level requirement
            let displayLevel = null;

            if (itemDetails.equipmentDetail) {
                // Equipment: Use levelRequirements from equipmentDetail
                const levelReq = itemDetails.equipmentDetail.levelRequirements;
                if (levelReq && levelReq.length > 0 && levelReq[0].level > 0) {
                    displayLevel = levelReq[0].level;
                }
            } else if (itemDetails.abilityBookDetail) {
                // Ability book: Use level requirement from abilityBookDetail
                const abilityLevelReq = itemDetails.abilityBookDetail.levelRequirements;
                if (abilityLevelReq && abilityLevelReq.length > 0 && abilityLevelReq[0].level > 0) {
                    displayLevel = abilityLevelReq[0].level;
                }
            }

            // Add level overlay if we have a valid level to display
            if (displayLevel && !div.querySelector('div.script_itemLevel')) {
                div.style.position = 'relative';
                div.insertAdjacentHTML(
                    'beforeend',
                    `<div class="script_itemLevel" style="z-index: 1; position: absolute; top: 2px; right: 2px; text-align: right; color: ${config.SCRIPT_COLOR_MAIN};">${displayLevel}</div>`
                );
                // Mark as processed
                this.processedDivs.add(div);
            } else {
                // No valid level or already has overlay, mark as processed
                this.processedDivs.add(div);
            }
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Remove all level overlays
        const overlays = document.querySelectorAll('div.script_itemLevel');
        for (const overlay of overlays) {
            overlay.remove();
        }

        // Clear processed tracking
        this.processedDivs = new WeakSet();

        this.isActive = false;
    }
}

// Create and export singleton instance
const equipmentLevelDisplay = new EquipmentLevelDisplay();

export default equipmentLevelDisplay;
