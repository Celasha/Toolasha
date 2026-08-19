/**
 * Listing Refresh Navigator
 *
 * Adds a "Refresh" button next to "Upgrade Capacity" on the My Listings page that starts a
 * cycling session through all listings. From there, listing-next-navigator.js exposes a
 * "Next"/"Back to My Listings" button on each listing's order-book page, so the rest of the
 * cycle never needs to come back through this table — opening a listing already refreshes it.
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
        this.watcher = null;
        this.refreshBtn = null;
        this.session = null; // { items: [{itemHrid, enhancementLevel, listingId}], currentIndex }
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
            btn.textContent = 'Refresh';
            btn.addEventListener('click', () => this._startSession());

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

    _startSession() {
        const table = document.querySelector(TABLE_SEL);
        if (!table) return;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length === 0) return;

        const items = rows.map((row) => ({
            itemHrid: row.dataset.itemHrid,
            enhancementLevel: parseInt(row.dataset.enhancementLevel || '0', 10),
            listingId: row.dataset.listingId || null,
        }));

        let startIndex = 0;
        const lastListingId = this.session?.items[this.session.currentIndex]?.listingId;
        if (lastListingId != null) {
            const lastIdx = items.findIndex((item) => item.listingId === lastListingId);
            if (lastIdx !== -1) startIndex = (lastIdx + 1) % items.length;
        }

        this.session = { items, currentIndex: startIndex };
        this._navigateToCurrent();
    }

    _navigateToCurrent() {
        const item = this.session?.items[this.session.currentIndex];
        if (!item?.itemHrid) return;
        navigateToMarketplace(item.itemHrid, item.enhancementLevel);
    }

    /**
     * @returns {{current: {itemHrid: string, enhancementLevel: number, listingId: string|null},
     *   index: number, total: number, isLast: boolean}|null} Null when no session is active.
     */
    getSessionProgress() {
        if (!this.session) return null;
        const { items, currentIndex } = this.session;
        return {
            current: items[currentIndex],
            index: currentIndex,
            total: items.length,
            isLast: currentIndex >= items.length - 1,
        };
    }

    /**
     * Advance the active session to the next listing and navigate to it.
     * @returns {boolean} True when advanced; false when there is no session or already at the end.
     */
    advanceSession() {
        if (!this.session || this.session.currentIndex >= this.session.items.length - 1) return false;
        this.session.currentIndex += 1;
        this._navigateToCurrent();
        return true;
    }

    endSession() {
        this.session = null;
    }

    cleanup() {
        if (this.watcher) {
            this.watcher();
            this.watcher = null;
        }
        if (this.refreshBtn) {
            this.refreshBtn.remove();
            this.refreshBtn = null;
        }
        this.session = null;
        this.isInitialized = false;
    }
}

const listingRefreshNavigator = new ListingRefreshNavigator();
export default listingRefreshNavigator;
