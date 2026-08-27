/**
 * Openable Analytics Modal Injector
 * Injects a compact Actual/Expected/Luck footer + per-item value labels into the native "Opened
 * Loot" modal. Idempotent by design: injected content is located by its own marker class and
 * replaced in place, so it self-corrects regardless of whether the modal remounts for a new
 * opening or is updated in place while already displayed.
 */

import domObserver from '../../../core/dom-observer.js';
import config from '../../../core/config.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import { coinFormatter, formatKMB3Digits } from '../../../utils/formatters.js';

const MODAL_CONTENT_CLASS = 'Inventory_modalContent';
const LINE_CLASS = 'toolasha-openable-analytics-line';
const GAINED_ITEMS_CLASS = 'Inventory_gainedItems';
const ITEM_CONTAINER_CLASS = 'Item_itemContainer';
const ITEM_VALUE_LABEL_CLASS = 'toolasha-openable-analytics-item-value';
const COIN_HRID = '/items/coin';

const LUCK_TOOLTIP =
    'Luck is Actual loot value minus Expected loot value. It does not include the container/key cost and is not opening profit.';
const LUCK_UNAVAILABLE_TOOLTIP = `Some required values are missing, so Luck can't be calculated. ${LUCK_TOOLTIP}`;
const PARTIAL_TOOLTIP = 'One or more gained items could not be priced.';

function formatValue(value) {
    if (value === null || value === undefined) return '—';
    return coinFormatter(Math.round(value));
}

/** Compact tiny per-item annotation, e.g. `≈54K`, `≈1.10M`, `≈0` - always compact regardless of the user's number-format setting. */
function formatTinyItemValue(value) {
    const rounded = Math.round(value);
    if (rounded === 0) return '≈0';
    return `≈${formatKMB3Digits(rounded)}`;
}

/** Luck value with an explicit `+` on positive amounts; negative values already carry their own `-`. Zero is neutral (no sign). */
function formatLuckValue(value) {
    if (value === null || value === undefined) return '—';
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : '';
    return sign + coinFormatter(rounded);
}

/** Luck percent with an explicit `+`, one decimal place, and `-0.0%` normalized to `0.0%`. */
function formatLuckPercent(percent) {
    if (percent === null || percent === undefined) return '';
    let rounded = percent.toFixed(1);
    if (rounded === '-0.0') rounded = '0.0';
    const sign = parseFloat(rounded) > 0 ? '+' : '';
    return ` (${sign}${rounded}%)`;
}

function luckColor(luckValue) {
    if (luckValue > 0) return config.COLOR_PROFIT;
    if (luckValue < 0) return config.COLOR_LOSS;
    return config.COLOR_TEXT_SECONDARY || '#888888';
}

/**
 * Build the inner HTML for the injected footer from the latest opening record + its lifetime
 * aggregate. The container/opened-count wording is intentionally omitted - the native result
 * already communicates what was opened and how many.
 * @param {Object} record - Latest normalized opening record
 * @param {Object} lifetimeAggregate - Lifetime aggregate for this container
 * @param {Function} [onViewAnalytics] - Invoked when "View Analytics" is clicked
 * @returns {string}
 */
function buildFooterContent(record, lifetimeAggregate) {
    const actualPartial = !record.actualValueComplete;
    const actualText = `${formatValue(record.actualValue)}${
        actualPartial ? ` <span title="${PARTIAL_TOOLTIP}">[Partial]</span>` : ''
    }`;
    const expectedText = record.expectedValueAvailable ? formatValue(record.expectedValue) : '—';
    const luckAvailable = record.luckValue !== null && record.luckValue !== undefined;
    const luckTitle = luckAvailable ? LUCK_TOOLTIP : LUCK_UNAVAILABLE_TOOLTIP;
    const luckText = luckAvailable
        ? `<span style="color:${luckColor(record.luckValue)}">${formatLuckValue(record.luckValue)}${formatLuckPercent(record.luckPercent)}</span>`
        : '—';

    const currentLine = `Actual ${actualText} · Expected ${expectedText} · <span title="${luckTitle}">Luck</span> ${luckText}`;

    // Suppress a Lifetime row that would just repeat this exact first event: semantically, this
    // container's Lifetime consists of nothing but this one live event and no imported data.
    const isOnlyEverEvent = lifetimeAggregate.eventsCount === 1 && !lifetimeAggregate.hasImportedData;
    const lifetimeLuckAvailable =
        !isOnlyEverEvent &&
        (lifetimeAggregate.valuationRecordCount || 0) > 0 &&
        lifetimeAggregate.luckEligibleRecordCount === lifetimeAggregate.valuationRecordCount;
    const lifetimeLuckValue = lifetimeLuckAvailable
        ? lifetimeAggregate.actualValueTotal - lifetimeAggregate.expectedValueTotal
        : null;
    const lifetimeLuckPercent =
        lifetimeLuckAvailable && lifetimeAggregate.expectedValueTotal > 0
            ? (lifetimeLuckValue / lifetimeAggregate.expectedValueTotal) * 100
            : null;

    const viewLink = `<span class="toolasha-openable-analytics-view-link" style="cursor:pointer;text-decoration:underline">View Analytics</span>`;
    const lifetimeLine = isOnlyEverEvent
        ? viewLink
        : `Lifetime ×${lifetimeAggregate.containersOpened}${
              lifetimeLuckAvailable
                  ? ` · Luck <span style="color:${luckColor(lifetimeLuckValue)}">${formatLuckValue(lifetimeLuckValue)}${formatLuckPercent(lifetimeLuckPercent)}</span>`
                  : ''
          } · ${viewLink}`;

    return `<div>${currentLine}</div><div style="opacity:0.75">${lifetimeLine}</div>`;
}

class OpenableAnalyticsModalInjector {
    constructor() {
        this.isInitialized = false;
        this.unregisterObserver = null;
        this.unregisterItemObserver = null;
        this.unsubscribeCollector = null;
        this.viewAnalyticsHandler = null;
    }

    initialize({ onViewAnalytics } = {}) {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.viewAnalyticsHandler = onViewAnalytics || null;

        this.unregisterObserver = domObserver.onClass('openableAnalyticsModal', MODAL_CONTENT_CLASS, (node) =>
            this.tryInject(node)
        );

        // Per-item labels need to react to the item icons themselves, not just the modal
        // container: if the native modal stays mounted and updates in place for a new opening
        // (rather than remounting), the modal-level observer above never fires again, but React
        // still has to insert fresh Item_itemContainer nodes for the new gained items - this
        // catches that update with the DOM already in its post-render state.
        this.unregisterItemObserver = domObserver.onClass(
            'openableAnalyticsModalItems',
            ITEM_CONTAINER_CLASS,
            (node) => {
                if (!this.isInitialized) return;
                const container = node.closest(`[class*="${MODAL_CONTENT_CLASS}"]`);
                if (!container) return;
                this.reconcileModal(container);
            }
        );

        // Data-driven fallback: covers the footer (and opportunistically the per-item labels)
        // as soon as new data arrives, ahead of any DOM mutation.
        this.unsubscribeCollector = openableAnalyticsDataCollector.onUpdate(() => this.refreshMountedModal());
    }

    tryInject(container) {
        if (!this.isInitialized) return;
        if (!container?.classList) return;
        const className = typeof container.className === 'string' ? container.className : '';
        if (!className.includes(MODAL_CONTENT_CLASS)) return;

        this.reconcileModal(container);
    }

    refreshMountedModal() {
        if (!this.isInitialized) return;
        const container = document.querySelector(`[class*="${MODAL_CONTENT_CLASS}"]`);
        if (!container) return;

        this.reconcileModal(container);
    }

    /**
     * Never trust a generic `Inventory_modalContent` match alone. Only treat a mounted container
     * as the current monetary reward result when the DOM structurally proves it: it must contain
     * a real, non-empty gained-items section, and the collector's latest record must itself be a
     * monetary opening (at least one gained item). This also naturally excludes buff-only
     * openables, which never render a gained-items section at all. If ownership cannot be
     * established, any previously injected OA content is stripped instead of left stale - this
     * also handles the native modal being reused from a monetary opening into a buff-only result.
     * @param {HTMLElement} container - Candidate `Inventory_modalContent` root
     */
    reconcileModal(container) {
        if (!this.isInitialized) return;

        const record = openableAnalyticsDataCollector.getLatestRecord();
        const gainedItemsContainer = container.querySelector(`[class*="${GAINED_ITEMS_CLASS}"]`);
        const itemContainers = gainedItemsContainer
            ? gainedItemsContainer.querySelectorAll(`[class*="${ITEM_CONTAINER_CLASS}"]`)
            : [];
        const isMonetaryRewardModal = Boolean(record) && record.gainedItems?.length > 0 && itemContainers.length > 0;

        if (!isMonetaryRewardModal) {
            this.clearOwnedDom(container);
            return;
        }

        this.renderFooter(container, record);
        this.renderItemValueLabels(container, record, itemContainers);
    }

    renderFooter(container, record) {
        const lifetimeAggregate = openableAnalyticsDataCollector.getLifetimeAggregate(record.containerHrid);

        let line = container.querySelector(`.${LINE_CLASS}`);
        if (!line) {
            line = document.createElement('div');
            line.className = LINE_CLASS;
            line.style.cssText = 'font-size:12px;margin:6px 0;';
            // Place after all native reward content, immediately above the native Close button,
            // which the client always renders as the final child of modalContent.
            const closeButton = container.lastElementChild;
            if (closeButton) {
                container.insertBefore(line, closeButton);
            } else {
                container.appendChild(line);
            }
        }

        line.innerHTML = buildFooterContent(record, lifetimeAggregate);

        const viewLink = line.querySelector('.toolasha-openable-analytics-view-link');
        if (viewLink && this.viewAnalyticsHandler) {
            viewLink.onclick = () => this.viewAnalyticsHandler(record.containerHrid);
        }
    }

    /**
     * Stamp a small value annotation onto each individual gained-item icon, matched positionally
     * against `record.actualValueBreakdown` (both derive from the identical `gainedItems` array,
     * so DOM order and breakdown order always agree). Always clears any previously stamped labels
     * first so a failed/mismatched re-render never leaves a stale value on the wrong item, then
     * skips labeling entirely - rather than risk mismatching values - if the icon count doesn't
     * match the breakdown count.
     * @param {HTMLElement} container - The modal's `Inventory_modalContent` root
     * @param {Object} record - Latest normalized opening record
     * @param {NodeList} itemContainers - Item icon nodes inside the gained-items section
     */
    renderItemValueLabels(container, record, itemContainers) {
        container.querySelectorAll(`.${ITEM_VALUE_LABEL_CLASS}`).forEach((label) => label.remove());

        const breakdown = record.actualValueBreakdown || [];
        if (itemContainers.length !== breakdown.length) return;

        itemContainers.forEach((itemEl, index) => {
            const item = breakdown[index];
            if (item.itemHrid === COIN_HRID) return; // native quantity already equals face value
            if (!item.resolved) return; // no fabricated/placeholder label for an unpriced item

            const label = document.createElement('div');
            label.className = ITEM_VALUE_LABEL_CLASS;
            label.style.cssText = 'font-size:10px; text-align:center; opacity:0.85;';
            label.textContent = formatTinyItemValue(item.value);
            itemEl.appendChild(label);
        });
    }

    /** Remove any OA-owned footer/labels from one modal container without touching native content. */
    clearOwnedDom(container) {
        container.querySelectorAll(`.${LINE_CLASS}, .${ITEM_VALUE_LABEL_CLASS}`).forEach((el) => el.remove());
    }

    cleanup() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        if (this.unregisterItemObserver) {
            this.unregisterItemObserver();
            this.unregisterItemObserver = null;
        }
        if (this.unsubscribeCollector) {
            this.unsubscribeCollector();
            this.unsubscribeCollector = null;
        }
        this.viewAnalyticsHandler = null;
        this.isInitialized = false;

        // Remove any OA-owned DOM left in the document (e.g. a modal still open when the
        // feature/character is toggled off), and guarantee a stale/queued observer callback
        // cannot reinject after this point since isInitialized is now false.
        document.querySelectorAll(`.${LINE_CLASS}, .${ITEM_VALUE_LABEL_CLASS}`).forEach((el) => el.remove());
    }
}

const openableAnalyticsModalInjector = new OpenableAnalyticsModalInjector();

export default openableAnalyticsModalInjector;
export {
    buildFooterContent,
    formatValue,
    formatTinyItemValue,
    formatLuckValue,
    formatLuckPercent,
    luckColor,
    MODAL_CONTENT_CLASS,
    LINE_CLASS,
    GAINED_ITEMS_CLASS,
    ITEM_CONTAINER_CLASS,
    ITEM_VALUE_LABEL_CLASS,
    COIN_HRID,
};
