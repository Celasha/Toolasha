/**
 * Openable Analytics Modal Injector
 * Injects a compact Actual/Expected/Luck summary line into the native "Opened Loot" modal.
 * Idempotent by design: the injected line is located by its own marker class and its content is
 * replaced in place, so it self-corrects regardless of whether the modal remounts for a new
 * opening or is updated in place while already displayed (both are possible depending on how the
 * native inventory panel batches consecutive openings).
 */

import domObserver from '../../../core/dom-observer.js';
import config from '../../../core/config.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import { coinFormatter } from '../../../utils/formatters.js';

const MODAL_CONTENT_CLASS = 'Inventory_modalContent';
const LINE_CLASS = 'toolasha-openable-analytics-line';

function formatValue(value) {
    if (value === null || value === undefined) return 'N/A';
    return coinFormatter(Math.round(value));
}

function formatLuckPercent(percent) {
    if (percent === null || percent === undefined) return '';
    const sign = percent >= 0 ? '+' : '';
    return ` (${sign}${percent.toFixed(1)}%)`;
}

function luckColor(luckValue) {
    if (luckValue === null || luckValue === undefined) return config.COLOR_TEXT_SECONDARY || '#888888';
    return luckValue >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
}

/**
 * Build the inner HTML for the injected summary line from the latest record + its lifetime
 * aggregate. `openAnalyticsView` is invoked when the "View Analytics" affordance is clicked.
 * @param {Object} record - Latest normalized opening record
 * @param {Object} lifetimeAggregate - Lifetime aggregate for this container
 * @returns {{html: string, containerHrid: string}}
 */
function buildLineContent(record, lifetimeAggregate) {
    const sessionLine = record.expectedValueAvailable
        ? `${record.containerCount} opened · Actual ${formatValue(record.actualValue)} · Expected ${formatValue(
              record.expectedValue
          )} · Luck <span style="color:${luckColor(record.luckValue)}">${formatValue(
              record.luckValue
          )}${formatLuckPercent(record.luckPercent)}</span>`
        : `${record.containerCount} opened · Actual ${formatValue(record.actualValue)} · Expected N/A`;

    const lifetimeLuckAvailable = lifetimeAggregate.expectedValueAvailableEvents > 0;
    const lifetimeLuckValue = lifetimeLuckAvailable
        ? lifetimeAggregate.actualValueTotal - lifetimeAggregate.expectedValueTotal
        : null;
    const lifetimeLuckPercent =
        lifetimeLuckAvailable && lifetimeAggregate.expectedValueTotal > 0
            ? (lifetimeLuckValue / lifetimeAggregate.expectedValueTotal) * 100
            : null;

    const lifetimeLine = lifetimeLuckAvailable
        ? `Lifetime: ${lifetimeAggregate.containersOpened} opened · Luck <span style="color:${luckColor(
              lifetimeLuckValue
          )}">${formatValue(lifetimeLuckValue)}${formatLuckPercent(lifetimeLuckPercent)}</span>`
        : `Lifetime: ${lifetimeAggregate.containersOpened} opened`;

    const partialNote = record.actualValueComplete
        ? ''
        : ' <span title="One or more gained items could not be priced">(partial)</span>';

    return `<div>${sessionLine}${partialNote}</div><div style="opacity:0.75">${lifetimeLine} · <span class="toolasha-openable-analytics-view-link" style="cursor:pointer;text-decoration:underline">View Analytics</span></div>`;
}

class OpenableAnalyticsModalInjector {
    constructor() {
        this.isInitialized = false;
        this.unregisterObserver = null;
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

        // Data-driven fallback: if the modal is already mounted when a new record arrives (the
        // native component updates in place instead of remounting), refresh directly.
        this.unsubscribeCollector = openableAnalyticsDataCollector.onUpdate(() => this.refreshMountedModal());
    }

    tryInject(container) {
        if (!container?.classList) return;
        const className = typeof container.className === 'string' ? container.className : '';
        if (!className.includes(MODAL_CONTENT_CLASS)) return;

        const record = openableAnalyticsDataCollector.getLatestRecord();
        if (!record) return;

        this.renderLine(container, record);
    }

    refreshMountedModal() {
        const container = document.querySelector(`[class*="${MODAL_CONTENT_CLASS}"]`);
        if (!container) return;

        const record = openableAnalyticsDataCollector.getLatestRecord();
        if (!record) return;

        this.renderLine(container, record);
    }

    renderLine(container, record) {
        const lifetimeAggregate = openableAnalyticsDataCollector.getLifetimeAggregate(record.containerHrid);

        let line = container.querySelector(`.${LINE_CLASS}`);
        if (!line) {
            line = document.createElement('div');
            line.className = LINE_CLASS;
            line.style.cssText = 'font-size:12px;margin:4px 0;';
            const headerChild = container.children[0] || null;
            container.insertBefore(line, headerChild ? headerChild.nextSibling : container.firstChild);
        }

        line.innerHTML = buildLineContent(record, lifetimeAggregate);

        const viewLink = line.querySelector('.toolasha-openable-analytics-view-link');
        if (viewLink && this.viewAnalyticsHandler) {
            viewLink.onclick = () => this.viewAnalyticsHandler(record.containerHrid);
        }
    }

    cleanup() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        if (this.unsubscribeCollector) {
            this.unsubscribeCollector();
            this.unsubscribeCollector = null;
        }
        this.viewAnalyticsHandler = null;
        this.isInitialized = false;
    }
}

const openableAnalyticsModalInjector = new OpenableAnalyticsModalInjector();

export default openableAnalyticsModalInjector;
export { buildLineContent, formatValue, formatLuckPercent, MODAL_CONTENT_CLASS, LINE_CLASS };
