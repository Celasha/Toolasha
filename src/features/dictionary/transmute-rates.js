/**
 * Transmute Rates Module
 * Shows transmutation success rate percentages in Item Dictionary modal
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * TransmuteRates class manages success rate display in Item Dictionary
 */
class TransmuteRates {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.injectTimeout = null;
        this.nameToHridCache = new Map();
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Setup setting change listener
     */
    setupSettingListener() {
        config.onSettingChange('itemDictionary_transmuteRates', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        // Listen for base rate inclusion toggle
        config.onSettingChange('itemDictionary_transmuteIncludeBaseRate', () => {
            if (this.isInitialized) {
                this.refreshRates();
            }
        });

        config.onSettingChange('color_transmute', () => {
            if (this.isInitialized) {
                this.refreshRates();
            }
        });
    }

    /**
     * Initialize transmute rates feature
     */
    initialize() {
        if (config.getSetting('itemDictionary_transmuteRates') !== true) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Watch for individual source items being added to the dictionary
        const unregister = domObserver.onClass('TransmuteRates', 'ItemDictionary_item', (elem) => {
            // When a new source item appears, find the parent section and inject rates
            const section = elem.closest('[class*="ItemDictionary_transmutedFrom"]');

            if (section) {
                // Debounce to avoid injecting multiple times as items are added
                clearTimeout(this.injectTimeout);
                this.injectTimeout = setTimeout(() => {
                    this.injectRates(section);
                }, 50);
                this.timerRegistry.registerTimeout(this.injectTimeout);
            }
        });
        this.unregisterHandlers.push(unregister);

        // Check if dictionary is already open
        const existingSection = document.querySelector('[class*="ItemDictionary_transmutedFrom"]');
        if (existingSection) {
            this.injectRates(existingSection);
        }
    }

    /**
     * Inject transmutation success rates into the dictionary
     * @param {HTMLElement} transmutedFromSection - The "Transmuted From" section
     */
    injectRates(transmutedFromSection) {
        // Get current item name from modal title
        const titleElem = document.querySelector('[class*="ItemDictionary_title"]');
        if (!titleElem) {
            return;
        }

        const currentItemName = titleElem.textContent.trim();
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return;
        }

        // Build name->HRID cache once for O(1) lookups
        if (this.nameToHridCache.size === 0) {
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                this.nameToHridCache.set(item.name, hrid);
            }
        }

        // Find current item HRID by name (O(1) lookup)
        const currentItemHrid = this.nameToHridCache.get(currentItemName);

        if (!currentItemHrid) {
            return;
        }

        // Find all source items in "Transmuted From" list
        const sourceItems = transmutedFromSection.querySelectorAll('[class*="ItemDictionary_item"]');

        for (const sourceItemElem of sourceItems) {
            // Remove any existing rate first (in case React re-rendered this item)
            const existingRate = sourceItemElem.querySelector('.mwi-transmute-rate');
            if (existingRate) {
                existingRate.remove();
            }

            // Get source item name
            const nameElem = sourceItemElem.querySelector('[class*="Item_name"]');
            if (!nameElem) {
                continue;
            }

            const sourceItemName = nameElem.textContent.trim();

            // Find source item HRID by name (O(1) lookup)
            const sourceItemHrid = this.nameToHridCache.get(sourceItemName);

            if (!sourceItemHrid) {
                continue;
            }

            // Get source item's alchemy details
            const sourceItem = gameData.itemDetailMap[sourceItemHrid];
            if (!sourceItem.alchemyDetail || !sourceItem.alchemyDetail.transmuteDropTable) {
                continue;
            }

            const transmuteSuccessRate = sourceItem.alchemyDetail.transmuteSuccessRate;

            // Find current item in source's drop table
            const dropEntry = sourceItem.alchemyDetail.transmuteDropTable.find(
                (entry) => entry.itemHrid === currentItemHrid
            );

            if (!dropEntry) {
                continue;
            }

            // Calculate effective rate based on setting
            const includeBaseRate = config.getSetting('itemDictionary_transmuteIncludeBaseRate') !== false;
            const effectiveRate = includeBaseRate
                ? transmuteSuccessRate * dropEntry.dropRate // Total probability
                : dropEntry.dropRate; // Conditional probability
            const percentageText = `${(effectiveRate * 100).toFixed((effectiveRate * 100) % 1 === 0 ? 1 : 2)}%`;

            // Create rate element
            const rateElem = document.createElement('span');
            rateElem.className = 'mwi-transmute-rate';
            rateElem.textContent = ` ~${percentageText}`;
            rateElem.style.cssText = `
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                color: ${config.COLOR_TRANSMUTE};
                font-size: 0.9em;
                pointer-events: none;
            `;

            // Make parent container position: relative so absolute positioning works
            sourceItemElem.style.position = 'relative';

            // Insert as sibling after item box (outside React's control)
            sourceItemElem.appendChild(rateElem);
        }
    }

    /**
     * Refresh all displayed rates (e.g., after color change)
     */
    refreshRates() {
        // Remove all existing rate displays
        document.querySelectorAll('.mwi-transmute-rate').forEach((elem) => elem.remove());

        // Re-inject if section is visible
        const existingSection = document.querySelector('[class*="ItemDictionary_transmutedFrom"]');
        if (existingSection) {
            this.injectRates(existingSection);
        }
    }

    /**
     * Disable the feature and clean up
     */
    disable() {
        // Clear any pending injection timeouts
        clearTimeout(this.injectTimeout);
        this.timerRegistry.clearAll();

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Remove all injected rate displays
        document.querySelectorAll('.mwi-transmute-rate').forEach((elem) => elem.remove());

        // Clear cache
        this.nameToHridCache.clear();

        this.isInitialized = false;
    }
}

const transmuteRates = new TransmuteRates();

// Setup setting listener (always active, even when feature is disabled)
transmuteRates.setupSettingListener();

export default transmuteRates;
