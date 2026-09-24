/**
 * Collectable Listings Sort
 *
 * Moves listings with something to collect to the top of the native "My Listings" table, so the
 * result of "Collect All" is visible without scrolling down or checking Market History.
 *
 * Detection uses the game's own rendered "Collect" button rather than reconstructing listing
 * status from tracked state, so this works independently of listing-price-display.js (which owns
 * its own manual column sort). A manually-selected column sort (shown via the ▲/▼/# indicator
 * listing-price-display.js renders in the header row) takes over until that sort is cleared.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';

const TABLE_CLASS = 'MarketplacePanel_myListingsTable';
const SORT_INDICATOR_PATTERN = /[▲▼#]/;

class CollectableListingsSort {
    constructor() {
        this.isInitialized = false;
        this.cleanupRegistry = createCleanupRegistry();
        this.currentTbody = null;
        this.unregisterCurrentObserver = null;
    }

    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_collectableListingsToTop')) {
            return;
        }

        this.isInitialized = true;

        const unregister = domObserver.onClass('CollectableListingsSort', TABLE_CLASS, (tableNode) => {
            this._watchTable(tableNode);
        });
        this.cleanupRegistry.registerCleanup(unregister);

        const existingTable = document.querySelector(`[class*="${TABLE_CLASS}"]`);
        if (existingTable) {
            this._watchTable(existingTable);
        }
    }

    /**
     * @param {HTMLElement} tableNode
     */
    _watchTable(tableNode) {
        const tbody = tableNode.querySelector('tbody');
        if (!tbody) {
            return;
        }

        if (tbody !== this.currentTbody) {
            // A new tbody means React remounted the table (e.g. reopening the marketplace
            // panel) — release the previous observer first so the old, now-detached tbody
            // isn't kept referenced forever by an observer that's still watching it.
            if (this.unregisterCurrentObserver) {
                this.unregisterCurrentObserver();
            }

            // subtree: true is required — React reuses the same <tr> when a listing's status
            // flips to Filled and just swaps in a Collect button inside it, rather than
            // replacing the row itself, so a childList-only watch on tbody never sees it.
            const observer = new MutationObserver(() => this._reorder(tableNode));
            observer.observe(tbody, { childList: true, subtree: true });
            this.currentTbody = tbody;
            this.unregisterCurrentObserver = this.cleanupRegistry.registerObserver(observer);
        }

        this._reorder(tableNode);
    }

    /**
     * @param {HTMLElement} tableNode
     * @returns {boolean}
     */
    _hasManualSortActive(tableNode) {
        const thead = tableNode.querySelector('thead');
        return !!thead && SORT_INDICATOR_PATTERN.test(thead.textContent);
    }

    /**
     * @param {HTMLElement} row
     * @returns {boolean}
     */
    _isRowCollectable(row) {
        return Array.from(row.querySelectorAll('button')).some((btn) => btn.textContent.trim() === 'Collect');
    }

    /**
     * @param {HTMLElement} tableNode
     */
    _reorder(tableNode) {
        if (this._hasManualSortActive(tableNode)) {
            return;
        }

        const tbody = tableNode.querySelector('tbody');
        if (!tbody) {
            return;
        }

        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (rows.length === 0) {
            return;
        }

        const collectable = [];
        const rest = [];
        for (const row of rows) {
            (this._isRowCollectable(row) ? collectable : rest).push(row);
        }

        if (collectable.length === 0 || rest.length === 0) {
            return;
        }

        const desired = [...collectable, ...rest];
        const alreadySorted = desired.every((row, i) => row === rows[i]);
        if (alreadySorted) {
            return;
        }

        for (const row of desired) {
            tbody.appendChild(row);
        }
    }

    cleanup() {
        this.cleanupRegistry.cleanupAll();
        this.currentTbody = null;
        this.unregisterCurrentObserver = null;
        this.isInitialized = false;
    }
}

const collectableListingsSort = new CollectableListingsSort();
export default collectableListingsSort;
