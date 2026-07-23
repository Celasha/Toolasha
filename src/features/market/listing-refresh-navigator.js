/**
 * Listing Refresh Navigator
 *
 * Adds a "Refresh Next" button next to "Upgrade Capacity" on the My Listings page.
 * Each click navigates to the next listing's order book, cycling through all listings.
 *
 * Depends on listing-price-display.js stamping row.dataset.itemHrid / listingId.
 */

import config from '../../core/config.js';
import { navigateToMarketplace } from '../../utils/marketplace-tabs.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

const LISTING_COUNT_SEL = '[class*="MarketplacePanel_listingCount"]';
const TABLE_SEL = '[class*="MarketplacePanel_myListingsTable"]';
const BTN_CLASS = 'Button_button__1Fe9z Button_small__3fqC7';

class ListingRefreshNavigator {
    constructor() {
        this.isInitialized = false;
        this.lastListingId = null;
        this.watcher = null;
        this.refreshBtn = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('market_listingRefreshNavigator')) return;
        this.isInitialized = true;
        this._watch();
    }

    _watch() {
        const ensureButton = () => {
            const countContainer = document.querySelector(LISTING_COUNT_SEL);

            if (!countContainer) {
                if (this.refreshBtn && document.body.contains(this.refreshBtn)) {
                    this.refreshBtn.remove();
                    this.refreshBtn = null;
                }
                return;
            }

            if (this.refreshBtn && !document.body.contains(this.refreshBtn)) {
                this.refreshBtn = null;
            }

            if (this.refreshBtn) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = BTN_CLASS;
            btn.textContent = 'Refresh Next';
            btn.addEventListener('click', () => this._refreshNext());

            const upgradeBtn = Array.from(countContainer.querySelectorAll('button')).find((b) =>
                b.textContent.includes('Upgrade Capacity')
            );

            if (upgradeBtn) {
                upgradeBtn.after(btn);
            } else {
                countContainer.appendChild(btn);
            }

            this.refreshBtn = btn;
        };

        if (!this.watcher) {
            this.watcher = createMutationWatcher(document.body, ensureButton, {
                childList: true,
                subtree: true,
            });
        }

        ensureButton();
    }

    _refreshNext() {
        const table = document.querySelector(TABLE_SEL);
        if (!table) return;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length === 0) return;

        let startIndex = 0;
        if (this.lastListingId !== null) {
            const lastIdx = rows.findIndex((row) => row.dataset.listingId === this.lastListingId);
            if (lastIdx !== -1) {
                startIndex = (lastIdx + 1) % rows.length;
            }
        }

        const row = rows[startIndex];
        const itemHrid = row.dataset.itemHrid;
        const enhancementLevel = parseInt(row.dataset.enhancementLevel || '0', 10);

        if (!itemHrid) return;

        this.lastListingId = row.dataset.listingId || null;

        if (this.refreshBtn) {
            this.refreshBtn.textContent = `Refresh Next (${startIndex + 1}/${rows.length})`;
        }

        navigateToMarketplace(itemHrid, enhancementLevel);
    }

    cleanup() {
        if (this.watcher) {
            this.watcher.disconnect();
            this.watcher = null;
        }
        if (this.refreshBtn) {
            this.refreshBtn.remove();
            this.refreshBtn = null;
        }
        this.lastListingId = null;
        this.isInitialized = false;
    }
}

const listingRefreshNavigator = new ListingRefreshNavigator();
export default listingRefreshNavigator;
