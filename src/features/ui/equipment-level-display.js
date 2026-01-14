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
        this.isInitialized = false;
    }

    /**
     * Setup setting change listener (always active, even when feature is disabled)
     */
    setupSettingListener() {
        // Listen for main toggle changes
        config.onSettingChange('itemIconLevel', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        // Listen for key info toggle
        config.onSettingChange('showsKeyInfoInIcon', () => {
            if (this.isInitialized) {
                // Clear processed set and re-render
                this.processedDivs = new WeakSet();
                this.addItemLevels();
            }
        });

        // Listen for color changes
        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize the equipment level display
     */
    initialize() {
        // Check if feature is enabled
        if (!config.getSetting('itemIconLevel')) {
            return;
        }

        // Prevent multiple initializations
        if (this.isInitialized) {
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
        this.isInitialized = true;
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
            } else if (config.getSetting('showsKeyInfoInIcon') && this.isKeyOrFragment(itemHrid)) {
                // Keys and fragments: Show zone/dungeon info
                displayText = this.getKeyDisplayText(itemHrid);
            }

            // Add overlay if we have valid text to display
            if (displayText && !div.querySelector('div.script_itemLevel')) {
                div.style.position = 'relative';

                // Position: bottom left for all items (matches market value style)
                const position = 'bottom: 2px; left: 2px; text-align: left;';

                div.insertAdjacentHTML(
                    'beforeend',
                    `<div class="script_itemLevel" style="z-index: 1; position: absolute; ${position} color: ${config.SCRIPT_COLOR_MAIN}; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;">${displayText}</div>`
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
     * Check if item is a key or fragment
     * @param {string} itemHrid - Item HRID
     * @returns {boolean} True if item is a key or fragment
     */
    isKeyOrFragment(itemHrid) {
        return itemHrid.includes('_key') || itemHrid.includes('_fragment');
    }

    /**
     * Get display text for keys and fragments
     * Uses hardcoded mapping like MWI Tools
     * @param {string} itemHrid - Key/fragment HRID
     * @returns {string|null} Display text (e.g., "D1", "Z3", "3.4.5.6") or null
     */
    getKeyDisplayText(itemHrid) {
        const keyMap = new Map([
            // Key fragments (zones where they drop)
            ['/items/blue_key_fragment', 'Z3'],
            ['/items/green_key_fragment', 'Z4'],
            ['/items/purple_key_fragment', 'Z5'],
            ['/items/white_key_fragment', 'Z6'],
            ['/items/orange_key_fragment', 'Z7'],
            ['/items/brown_key_fragment', 'Z8'],
            ['/items/stone_key_fragment', 'Z9'],
            ['/items/dark_key_fragment', 'Z10'],
            ['/items/burning_key_fragment', 'Z11'],

            // Entry keys (dungeon identifiers)
            ['/items/chimerical_entry_key', 'D1'],
            ['/items/sinister_entry_key', 'D2'],
            ['/items/enchanted_entry_key', 'D3'],
            ['/items/pirate_entry_key', 'D4'],

            // Chest keys (zones where they drop)
            ['/items/chimerical_chest_key', '3.4.5.6'],
            ['/items/sinister_chest_key', '5.7.8.10'],
            ['/items/enchanted_chest_key', '7.8.9.11'],
            ['/items/pirate_chest_key', '6.9.10.11']
        ]);

        return keyMap.get(itemHrid) || null;
    }

    /**
     * Refresh colors (called when settings change)
     */
    refresh() {
        // Update color for all level overlays
        const overlays = document.querySelectorAll('div.script_itemLevel');
        overlays.forEach(overlay => {
            overlay.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.unregisterHandler) {
            this.unregisterHandler();
            this.unregisterHandler = null;
        }

        // Remove all level overlays
        const overlays = document.querySelectorAll('div.script_itemLevel');
        for (const overlay of overlays) {
            overlay.remove();
        }

        // Clear processed tracking
        this.processedDivs = new WeakSet();

        this.isActive = false;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const equipmentLevelDisplay = new EquipmentLevelDisplay();

// Setup setting listener immediately (before initialize)
equipmentLevelDisplay.setupSettingListener();

export default equipmentLevelDisplay;
