/**
 * MilkyWay Market Link
 * Adds a small link to view the current marketplace item on milkyway.market.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';

const LINK_ID = 'mwi-milkyway-market-link';

class MilkyWayMarketLink {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandler = null;
        this.currentItemHrid = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('market_milkywayMarketLink')) return;

        this.isInitialized = true;

        const handler = (data) => {
            if (!data.marketItemOrderBooks) return;
            this.currentItemHrid = data.marketItemOrderBooks.itemHrid;
            this._updateLink();
        };

        dataManager.on('market_item_order_books_updated', handler);
        this.unregisterHandler = () => dataManager.off('market_item_order_books_updated', handler);
    }

    /**
     * Get current enhancement level from DOM.
     * @returns {number}
     */
    _getEnhancementLevel() {
        const currentItem = document.querySelector('[class*="MarketplacePanel_currentItem"]');
        if (!currentItem) return 0;
        const el = currentItem.querySelector('[class*="Item_enhancementLevel"]');
        if (!el) return 0;
        const match = el.textContent.match(/\+(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    _updateLink() {
        const existing = document.getElementById(LINK_ID);
        if (existing) existing.remove();

        if (!this.currentItemHrid) return;

        const container = document.querySelector('[class*="MarketplacePanel_marketNavButtonContainer"]');
        if (!container) return;

        const enhancement = this._getEnhancementLevel();
        const itemSlug = this.currentItemHrid.replace('/items/', '');
        const url = `https://milkyway.market/items/${itemSlug}${enhancement > 0 ? `?enhancement=${enhancement}` : ''}`;

        const link = document.createElement('a');
        link.id = LINK_ID;
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'MilkyWay Market \u2197';
        link.style.cssText = `
            font-size: 10px;
            color: #888;
            text-decoration: none;
            margin-left: 8px;
            white-space: nowrap;
        `;
        link.addEventListener('mouseenter', () => (link.style.opacity = '0.7'));
        link.addEventListener('mouseleave', () => (link.style.opacity = '1'));

        container.appendChild(link);
    }

    disable() {
        if (this.unregisterHandler) {
            this.unregisterHandler();
            this.unregisterHandler = null;
        }
        document.getElementById(LINK_ID)?.remove();
        this.currentItemHrid = null;
        this.isInitialized = false;
    }
}

const milkywayMarketLink = new MilkyWayMarketLink();
export default milkywayMarketLink;
