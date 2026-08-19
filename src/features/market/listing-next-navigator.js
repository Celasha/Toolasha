/**
 * Listing Next Navigator
 *
 * On a listing's order-book page opened via listing-refresh-navigator's "Refresh" session,
 * replaces the native "Refresh" button with a "Next"/"Back to My Listings" button so a user can
 * cycle through every listing without returning to the My Listings table between each one.
 * Opening a listing's page already re-fetches its order book, so the native per-item Refresh
 * button is redundant while a session is active — it's only hidden while the currently-open
 * item matches the session's current listing, and restored otherwise.
 */

import config from '../../core/config.js';
import { navigateToMyListings } from '../../utils/marketplace-tabs.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import listingRefreshNavigator from './listing-refresh-navigator.js';

const CONTAINER_SEL = '[class*="MarketplacePanel_marketNavButtonContainer"]';
const CURRENT_ITEM_SEL = '[class*="MarketplacePanel_currentItem"]';
const BTN_CLASS = 'Button_button__1Fe9z Button_small__3fqC7';
const NEXT_BTN_ID = 'mwi-listing-next-btn';

class ListingNextNavigator {
    constructor() {
        this.isInitialized = false;
        this.watcher = null;
        this.nextBtn = null;
        this.nativeRefreshBtn = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('market_listingRefreshNavigator')) return;
        this.isInitialized = true;
        this._watch();
    }

    _watch() {
        const update = () => this._update();

        if (!this.watcher) {
            this.watcher = createMutationWatcher(document.body, update, {
                childList: true,
                subtree: true,
            });
        }

        update();
    }

    /**
     * @returns {{itemHrid: string, enhancementLevel: number}|null} Item currently open in the
     *   order-book panel, read from the DOM (same approach as market-depth-cap.js).
     */
    _getCurrentItem() {
        const currentItemEl = document.querySelector(CURRENT_ITEM_SEL);
        const useElement = currentItemEl?.querySelector('use');
        const href = useElement?.href?.baseVal;
        const itemHrid = href ? '/items/' + href.split('#')[1] : null;
        if (!itemHrid) return null;

        const enhancementEl = currentItemEl.querySelector('[class*="Item_enhancementLevel"]');
        const match = enhancementEl?.textContent.match(/\+(\d+)/);
        const enhancementLevel = match ? parseInt(match[1], 10) : 0;

        return { itemHrid, enhancementLevel };
    }

    _restore() {
        if (this.nativeRefreshBtn) {
            this.nativeRefreshBtn.style.display = '';
            this.nativeRefreshBtn = null;
        }
        if (this.nextBtn && document.body.contains(this.nextBtn)) {
            this.nextBtn.remove();
        }
        this.nextBtn = null;
    }

    _update() {
        const progress = listingRefreshNavigator.getSessionProgress();
        const container = document.querySelector(CONTAINER_SEL);

        if (!progress || !container) {
            this._restore();
            return;
        }

        const currentItem = this._getCurrentItem();
        const matches =
            currentItem &&
            currentItem.itemHrid === progress.current.itemHrid &&
            currentItem.enhancementLevel === progress.current.enhancementLevel;

        if (!matches) {
            this._restore();
            return;
        }

        if (this.nextBtn && !document.body.contains(this.nextBtn)) {
            this.nextBtn = null;
        }
        if (this.nativeRefreshBtn && !document.body.contains(this.nativeRefreshBtn)) {
            this.nativeRefreshBtn = null;
        }

        if (!this.nativeRefreshBtn) {
            const found = Array.from(container.querySelectorAll('button')).find(
                (b) => b.id !== NEXT_BTN_ID && b.textContent.trim() === 'Refresh'
            );
            if (found) {
                found.style.display = 'none';
                this.nativeRefreshBtn = found;
            }
        }

        if (!this.nextBtn) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = NEXT_BTN_ID;
            btn.className = BTN_CLASS;
            btn.addEventListener('click', () => this._handleClick());
            container.appendChild(btn);
            this.nextBtn = btn;
        }

        const label = progress.isLast ? 'Back to My Listings' : `Next (${progress.index + 1}/${progress.total})`;
        this.nextBtn.textContent = label;
    }

    _handleClick() {
        const progress = listingRefreshNavigator.getSessionProgress();
        if (!progress) return;

        if (progress.isLast) {
            listingRefreshNavigator.endSession();
            this._restore();
            navigateToMyListings();
        } else {
            listingRefreshNavigator.advanceSession();
        }
    }

    cleanup() {
        if (this.watcher) {
            this.watcher();
            this.watcher = null;
        }
        this._restore();
        this.isInitialized = false;
    }
}

const listingNextNavigator = new ListingNextNavigator();
export default listingNextNavigator;
