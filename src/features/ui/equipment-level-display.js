/**
 * Equipment Level Display
 * Shows item level in top right corner of equipment icons
 * Based on original MWI Tools implementation
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

/**
 * EquipmentLevelDisplay class adds level overlays to equipment icons
 */
class EquipmentLevelDisplay {
    constructor() {
        this.unregisterHandler = null;
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

        // Register with centralized DOM observer
        this.unregisterHandler = domObserver.register(
            'EquipmentLevelDisplay',
            () => {
                this.addItemLevels();
            }
        );

        // Process any existing items on page
        this.addItemLevels();

        this.isActive = true;
    }

    /**
     * Clean up
     */
    cleanup() {
        if (this.unregisterHandler) {
            this.unregisterHandler();
            this.unregisterHandler = null;
        }
        this.isActive = false;
    }

    /**
     * Add item levels to all equipment icons
     * Matches original MWI Tools logic with dungeon key zone info
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
            // For dungeon entry keys, show zone index
            let displayText = null;

            if (itemDetails.equipmentDetail) {
                // Equipment: Use levelRequirements from equipmentDetail
                const levelReq = itemDetails.equipmentDetail.levelRequirements;
                if (levelReq && levelReq.length > 0 && levelReq[0].level > 0) {
                    displayText = levelReq[0].level.toString();
                }
            } else if (itemDetails.abilityBookDetail) {
                // Ability book: Use level requirement from abilityBookDetail
                const abilityLevelReq = itemDetails.abilityBookDetail.levelRequirements;
                if (abilityLevelReq && abilityLevelReq.length > 0 && abilityLevelReq[0].level > 0) {
                    displayText = abilityLevelReq[0].level.toString();
                }
            } else if (config.getSetting('showsKeyInfoInIcon') && this.isDungeonEntryKey(itemHrid)) {
                // Dungeon entry key: Show zone index
                const zoneIndex = this.getZoneIndexForDungeonKey(itemHrid);
                if (zoneIndex) {
                    displayText = `Z${zoneIndex}`;
                }
            }

            // Add overlay if we have valid text to display
            if (displayText && !div.querySelector('div.script_itemLevel')) {
                div.style.position = 'relative';

                // Position: bottom left for dungeon keys (matches market value style), top right for others
                const isDungeonKey = this.isDungeonEntryKey(itemHrid);
                const position = isDungeonKey
                    ? 'bottom: 2px; left: 2px; text-align: left;'
                    : 'top: 2px; right: 2px; text-align: right;';

                div.insertAdjacentHTML(
                    'beforeend',
                    `<div class="script_itemLevel" style="z-index: 1; position: absolute; ${position} color: ${config.SCRIPT_COLOR_MAIN};">${displayText}</div>`
                );
                // Mark as processed
                this.processedDivs.add(div);
            } else {
                // No valid text or already has overlay, mark as processed
                this.processedDivs.add(div);
            }
        }
    }

    /**
     * Check if item is a dungeon entry key
     * @param {string} itemHrid - Item HRID
     * @returns {boolean} True if item is a dungeon entry key
     */
    isDungeonEntryKey(itemHrid) {
        const entryKeys = [
            '/items/chimerical_entry_key',
            '/items/sinister_entry_key',
            '/items/enchanted_entry_key',
            '/items/pirate_entry_key'
        ];
        return entryKeys.includes(itemHrid);
    }

    /**
     * Get zone index for a dungeon entry key
     * @param {string} itemHrid - Dungeon entry key HRID
     * @returns {number|null} Zone index or null
     */
    getZoneIndexForDungeonKey(itemHrid) {
        // Map entry keys to dungeon action HRIDs
        const keyToDungeon = {
            '/items/chimerical_entry_key': '/actions/combat/chimerical_den',
            '/items/sinister_entry_key': '/actions/combat/sinister_circus',
            '/items/enchanted_entry_key': '/actions/combat/enchanted_fortress',
            '/items/pirate_entry_key': '/actions/combat/pirate_cove'
        };

        const dungeonHrid = keyToDungeon[itemHrid];
        if (!dungeonHrid) {
            return null;
        }

        // Get action details
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return null;
        }

        const action = gameData.actionDetailMap[dungeonHrid];
        if (!action || !action.category) {
            return null;
        }

        // Get zone index from category
        const category = gameData.actionCategoryDetailMap[action.category];
        return category?.sortIndex || null;
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
