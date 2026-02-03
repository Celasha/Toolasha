/**
 * Alchemy Item Dimming
 * Dims items in alchemy panel that require higher level than player has
 * Player must have Alchemy level >= itemLevel to perform alchemy actions
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

/**
 * AlchemyItemDimming class dims items based on level requirements
 */
class AlchemyItemDimming {
    constructor() {
        this.unregisterObserver = null; // Unregister function from centralized observer
        this.isActive = false;
        this.processedDivs = new WeakSet(); // Track already-processed divs
        this.isInitialized = false;
    }

    /**
     * Initialize the alchemy item dimming
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('alchemyItemDimming')) {
            return;
        }

        this.isInitialized = true;

        // Register with centralized observer to watch for alchemy panel
        this.unregisterObserver = domObserver.onClass('AlchemyItemDimming', 'ItemSelector_menu__12sEM', () => {
            this.processAlchemyItems();
        });

        // Process any existing items on page
        this.processAlchemyItems();

        this.isActive = true;
    }

    /**
     * Process all items in the alchemy panel
     */
    processAlchemyItems() {
        // Check if alchemy panel is open
        const alchemyPanel = this.findAlchemyPanel();
        if (!alchemyPanel) {
            return;
        }

        // Get player's Alchemy level
        const skills = dataManager.getSkills();
        if (!skills) {
            return;
        }

        const alchemySkill = skills.find((s) => s.skillHrid === '/skills/alchemy');
        const playerAlchemyLevel = alchemySkill?.level || 1;

        // Find all item icon divs within the alchemy panel
        const iconDivs = alchemyPanel.querySelectorAll(
            'div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6'
        );

        for (const div of iconDivs) {
            if (this.processedDivs.has(div)) {
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

            // Get item's alchemy level requirement
            const itemLevel = itemDetails.itemLevel || 0;

            // Apply dimming if player level is too low
            if (playerAlchemyLevel < itemLevel) {
                div.style.opacity = '0.5';
                div.style.pointerEvents = 'auto'; // Still clickable
                div.classList.add('mwi-alchemy-dimmed');
            } else {
                // Remove dimming if level is now sufficient (player leveled up)
                div.style.opacity = '1';
                div.classList.remove('mwi-alchemy-dimmed');
            }

            // Mark as processed
            this.processedDivs.add(div);
        }
    }

    /**
     * Find the alchemy panel in the DOM
     * @returns {Element|null} Alchemy panel element or null
     */
    findAlchemyPanel() {
        // The alchemy item selector is a MuiTooltip dropdown with ItemSelector_menu class
        // It appears when clicking in the "Alchemize Item" box
        const itemSelectorMenus = document.querySelectorAll('div.ItemSelector_menu__12sEM');

        // Check each menu to find the one with "Alchemize Item" label
        for (const menu of itemSelectorMenus) {
            // Look for the ItemSelector_label element in the document
            // (It's not a direct sibling, it's part of the button that opens this menu)
            const alchemyLabels = document.querySelectorAll('div.ItemSelector_label__22ds9');

            for (const label of alchemyLabels) {
                if (label.textContent.trim() === 'Alchemize Item') {
                    // Found the alchemy label, this menu is likely the alchemy selector
                    return menu;
                }
            }
        }

        return null;
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        // Remove all dimming effects
        const dimmedItems = document.querySelectorAll('.mwi-alchemy-dimmed');
        for (const item of dimmedItems) {
            item.style.opacity = '1';
            item.classList.remove('mwi-alchemy-dimmed');
        }

        // Clear processed tracking
        this.processedDivs = new WeakSet();

        this.isActive = false;
        this.isInitialized = false;
    }
}

const alchemyItemDimming = new AlchemyItemDimming();

export default alchemyItemDimming;
