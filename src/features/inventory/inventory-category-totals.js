/**
 * Inventory Category Totals
 *
 * Appends the total market value of all item stacks in each inventory category
 * to the category label (e.g. "Equipment  3.2M", "Food  480K").
 *
 * Registers as a badge provider at priority 200 so it runs after the badge manager
 * has already populated dataset.askValue / dataset.bidValue on every item element.
 */

import config from '../../core/config.js';
import inventoryBadgeManager from './inventory-badge-manager.js';
import { formatKMB } from '../../utils/formatters.js';
import * as dom from '../../utils/dom.js';

const CSS_ID = 'mwi-inv-category-totals';
const SPAN_ATTR = 'data-mwi-category-total';

const CSS = `
.mwi-category-total {
    margin-left: 8px;
    font-size: 10pt;
    font-weight: bold;
    opacity: 0.8;
}
`;

class InventoryCategoryTotals {
    constructor() {
        this.isInitialized = false;
        this.pendingUpdate = false;
    }

    initialize() {
        if (!config.getSetting('invCategoryTotals')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        dom.addStyles(CSS, CSS_ID);

        inventoryBadgeManager.registerProvider('inventory-category-totals', () => this.scheduleUpdate(), 200);

        // Trigger an immediate render pass so totals appear without needing a manual refresh
        inventoryBadgeManager.clearProcessedTracking();
    }

    disable() {
        if (!this.isInitialized) {
            return;
        }

        inventoryBadgeManager.unregisterProvider('inventory-category-totals');
        document.querySelectorAll(`.mwi-category-total`).forEach((el) => el.remove());
        dom.removeStyles(CSS_ID);

        this.isInitialized = false;
        this.pendingUpdate = false;
    }

    scheduleUpdate() {
        if (this.pendingUpdate) {
            return;
        }
        this.pendingUpdate = true;
        setTimeout(() => {
            this.pendingUpdate = false;
            this.updateAllCategoryTotals();
        }, 0);
    }

    updateAllCategoryTotals() {
        const inventoryElem = inventoryBadgeManager.currentInventoryElem;
        if (!inventoryElem) {
            return;
        }

        const mode = config.getSetting('invCategoryTotals_mode') || 'ask';
        const valueKey = mode === 'bid' ? 'bidValue' : 'askValue';

        for (const categoryDiv of inventoryElem.children) {
            const labelEl = categoryDiv.querySelector('[class*="Inventory_label"]');
            if (!labelEl) {
                continue;
            }

            // Get label text without any injected span
            const existingSpan = labelEl.querySelector(`[${SPAN_ATTR}]`);
            const labelText = existingSpan
                ? labelEl.textContent.replace(existingSpan.textContent, '').trim()
                : labelEl.textContent.trim();

            if (labelText.toLowerCase() === 'currencies') {
                continue;
            }

            const itemContainers = categoryDiv.querySelectorAll('[class*="Item_itemContainer"]');
            let total = 0;
            for (const itemEl of itemContainers) {
                const val = parseFloat(itemEl.dataset[valueKey]);
                if (val > 0) {
                    total += val;
                }
            }

            this.injectOrUpdateLabel(labelEl, total);
        }
    }

    /**
     * @param {HTMLElement} labelEl
     * @param {number} total
     */
    injectOrUpdateLabel(labelEl, total) {
        let span = labelEl.querySelector(`[${SPAN_ATTR}]`);

        if (total <= 0) {
            if (span) {
                span.remove();
            }
            return;
        }

        if (!span) {
            span = document.createElement('span');
            span.className = 'mwi-category-total';
            span.setAttribute(SPAN_ATTR, 'true');
            labelEl.appendChild(span);
        }

        span.textContent = formatKMB(total);
    }
}

const inventoryCategoryTotals = new InventoryCategoryTotals();
export default inventoryCategoryTotals;
