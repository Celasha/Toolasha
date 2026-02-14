/**
 * Alt+Click Item Navigation Feature
 * Adds Alt+click handlers to item tooltips and inventory/marketplace items
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { navigateToItem } from '../../utils/item-navigation.js';

class AltClickNavigation {
    constructor() {
        this.isActive = false;
        this.unregisterObserver = null;
        this.clickHandler = null;
        this.currentItemHrid = null;
    }

    /**
     * Setup settings listener
     */
    setupSettingListener() {
        config.onSettingChange('altClickNavigation', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });
    }

    /**
     * Initialize Alt+click navigation
     */
    initialize() {
        if (this.isActive) {
            return;
        }

        if (!config.getSetting('altClickNavigation')) {
            return;
        }

        // Watch for tooltip poppers to track current hovered item
        this.unregisterObserver = domObserver.onClass('AltClickNav', 'MuiTooltip-popper', (tooltipElement) => {
            this.handleTooltipAppear(tooltipElement);
        });

        // Create global click handler for Alt+click
        this.clickHandler = (event) => {
            // Only handle Alt+click
            if (!event.altKey) {
                return;
            }

            // Try multiple strategies to find item HRID
            let itemHrid = null;

            // Strategy 1: Check for data-item-hrid attribute (our custom tabs, etc.)
            const dataItemElement = event.target.closest('[data-item-hrid]');
            if (dataItemElement) {
                itemHrid = dataItemElement.getAttribute('data-item-hrid');
            }

            // Strategy 2: If clicking while tooltip is visible, use tracked item
            if (!itemHrid && this.currentItemHrid) {
                itemHrid = this.currentItemHrid;
            }

            // Strategy 3: Check parent chain for item link hrefs
            if (!itemHrid) {
                const linkElement = event.target.closest('a[href*="/items/"]');
                if (linkElement) {
                    const href = linkElement.getAttribute('href');
                    const match = href.match(/\/items\/(.+?)(?:\/|$)/);
                    if (match) {
                        itemHrid = `/items/${match[1]}`;
                    }
                }
            }

            if (!itemHrid) {
                return;
            }

            // Navigate to item
            event.preventDefault();
            event.stopPropagation();
            navigateToItem(itemHrid);
        };

        // Attach global click handler (capture phase to intercept before game handlers)
        document.addEventListener('click', this.clickHandler, true);

        this.isActive = true;
    }

    /**
     * Handle tooltip appearance - extract item HRID
     * @param {HTMLElement} tooltipElement - Tooltip popper element
     */
    handleTooltipAppear(tooltipElement) {
        // Reset current item
        this.currentItemHrid = null;

        try {
            // Look for item link in tooltip content
            const itemLink = tooltipElement.querySelector('a[href*="/items/"]');

            if (itemLink) {
                const href = itemLink.getAttribute('href');

                const match = href.match(/\/items\/(.+?)(?:\/|$)/);
                if (match) {
                    this.currentItemHrid = `/items/${match[1]}`;
                    return;
                }
            }

            // Try to find item from SVG icon href
            const svgUse = tooltipElement.querySelector('use[href*="items_sprite"]');
            if (svgUse) {
                const svgHref = svgUse.getAttribute('href');

                // Extract item name from sprite reference: /static/media/items_sprite.hash.svg#item_name
                const match = svgHref.match(/#(.+)$/);
                if (match) {
                    const itemName = match[1];
                    // Convert sprite item name to HRID format
                    this.currentItemHrid = `/items/${itemName}`;
                    return;
                }
            }

            // Try to extract from ItemTooltipText_name div
            const nameElement = tooltipElement.querySelector(
                '.ItemTooltipText_name__2JAHA span, [class*="ItemTooltipText_name"] span'
            );
            if (nameElement) {
                const itemName = nameElement.textContent.trim();

                // Convert name to HRID format (lowercase, replace spaces with underscores)
                const itemHrid = `/items/${itemName.toLowerCase().replace(/\s+/g, '_')}`;
                this.currentItemHrid = itemHrid;
            }
        } catch (error) {
            console.error('[AltClickNav] Error parsing tooltip:', error);
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler, true);
            this.clickHandler = null;
        }

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        this.currentItemHrid = null;
        this.isActive = false;
    }
}

const altClickNavigation = new AltClickNavigation();
altClickNavigation.setupSettingListener();

export default altClickNavigation;
