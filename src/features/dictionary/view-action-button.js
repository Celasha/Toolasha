/**
 * View Action Button Module
 * Adds a "View Action" button to Item Dictionary modal for actionable items
 */

import domObserver from '../../core/dom-observer.js';
import { navigateToItem, findActionForItem } from '../../utils/item-navigation.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * ViewActionButton class manages action button in Item Dictionary
 */
class ViewActionButton {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.injectTimeout = null;
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize view action button feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Watch for Item Dictionary modal title to appear
        const unregister = domObserver.onClass('ViewActionButton', 'ItemDictionary_title', (titleElem) => {
            // Debounce to avoid injecting multiple times
            clearTimeout(this.injectTimeout);
            this.injectTimeout = setTimeout(() => {
                this.injectButton(titleElem);
            }, 50);
            this.timerRegistry.registerTimeout(this.injectTimeout);
        });
        this.unregisterHandlers.push(unregister);

        // Check if dictionary is already open
        const existingTitle = document.querySelector('[class*="ItemDictionary_title"]');
        if (existingTitle) {
            this.injectButton(existingTitle);
        }
    }

    /**
     * Inject "View Action" button into the dictionary
     * @param {HTMLElement} titleElem - The modal title element
     */
    injectButton(titleElem) {
        // Remove any existing button first
        const existingButton = document.querySelector('.mwi-view-action-button');
        if (existingButton) {
            existingButton.remove();
        }

        // Get item name from title
        const itemName = titleElem.textContent.trim();

        // Convert item name to HRID format (lowercase, spaces to underscores, remove apostrophes)
        const itemHrid = `/items/${itemName.toLowerCase().replace(/'/g, '').replace(/\s+/g, '_')}`;

        // Check if this item has an associated action
        const actionInfo = findActionForItem(itemHrid);

        // If no action found, don't show button
        if (!actionInfo) {
            return;
        }

        // Create the action button
        const actionButton = document.createElement('button');
        actionButton.className = 'mwi-view-action-button';
        actionButton.textContent = 'View Action';
        actionButton.style.cssText = `
            background: #2a2a2a;
            color: #ffffff;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            margin-left: 12px;
            transition: all 0.2s;
        `;

        // Add hover effect
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.background = '#3a3a3a';
            actionButton.style.borderColor = '#666';
        });
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = '#2a2a2a';
            actionButton.style.borderColor = '#555';
        });

        // Add click handler
        actionButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Find the Item Dictionary modal specifically before navigating
            const dictionaryTitle = document.querySelector('[class*="ItemDictionary_title"]');
            let dictionaryCloseButton = null;

            if (dictionaryTitle) {
                // Navigate up to find the Modal_modal container
                const modal = dictionaryTitle.closest('[class*="Modal_modal"]');
                if (modal) {
                    dictionaryCloseButton = modal.querySelector('[class*="Modal_closeButton"]');
                }
            }

            // Navigate to the action first
            navigateToItem(itemHrid);

            // Close the dictionary modal after a short delay
            setTimeout(() => {
                if (dictionaryCloseButton) {
                    dictionaryCloseButton.click();
                } else {
                    // Fallback: try Escape key
                    const escEvent = new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true,
                        cancelable: true,
                    });
                    document.dispatchEvent(escEvent);
                }
            }, 150);
        });

        // Insert button after the title
        titleElem.parentNode.insertBefore(actionButton, titleElem.nextSibling);

        // Adjust title parent to be flexbox
        const parent = titleElem.parentNode;
        if (parent && !parent.style.display) {
            parent.style.cssText = `
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            `;
        }
    }

    /**
     * Disable the feature and clean up
     */
    disable() {
        clearTimeout(this.injectTimeout);
        this.timerRegistry.clearAll();

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Remove all injected buttons
        document.querySelectorAll('.mwi-view-action-button').forEach((elem) => elem.remove());

        this.isInitialized = false;
    }
}

const viewActionButton = new ViewActionButton();

// Auto-initialize (always enabled feature)
viewActionButton.initialize();

export default viewActionButton;
