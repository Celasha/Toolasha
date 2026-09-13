/**
 * Openable Analytics Side Panel
 * Pins a Current/History stat-card panel to the LEFT of the native "Opened Loot" modal whenever
 * a monetary box opening occurs, alongside the existing inline footer. Always anchored on the
 * left (shrinking rather than flipping to the right when space is tight), matching the fixed
 * modal-anchoring technique already used by the Sharable Profile Score panel.
 */

import config from '../../../core/config.js';
import domObserver from '../../../core/dom-observer.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import { isMonetaryRewardModal, MODAL_CONTENT_CLASS } from './openable-analytics-modal-injector.js';
import { calculateOpeningCost } from './openable-analytics-cost.js';
import { calculateIncomeStdDev } from './openable-analytics-variance.js';
import { createMutationWatcher } from '../../../utils/dom-observer-helpers.js';
import { coinFormatter, formatWithSeparator } from '../../../utils/formatters.js';

const PANEL_GAP = 8;
const PANEL_VIEWPORT_MARGIN = 10;
const MIN_PANEL_WIDTH = 150;
const NATURAL_PANEL_WIDTH = 300;
const PANEL_ID = 'mwi-openable-analytics-side-panel';

function formatMoney(value) {
    if (value === null || value === undefined) return '—';
    return coinFormatter(Math.round(value));
}

function formatSignedMoney(value) {
    if (value === null || value === undefined) return '—';
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : '';
    return sign + coinFormatter(rounded);
}

function formatPercent(percent) {
    if (percent === null || percent === undefined) return '—';
    let rounded = percent.toFixed(1);
    if (rounded === '-0.0') rounded = '0.0';
    const sign = parseFloat(rounded) > 0 ? '+' : '';
    return `${sign}${rounded}%`;
}

function luckColor(value) {
    if (value === null || value === undefined) return config.COLOR_TEXT_SECONDARY || '#888888';
    if (value > 0) return config.COLOR_PROFIT;
    if (value < 0) return config.COLOR_LOSS;
    return config.COLOR_TEXT_SECONDARY || '#888888';
}

/**
 * Derive the card's stat set from a container HRID, an amount-opened count, and the same
 * {actualValue, actualValueComplete/PartialEvents, expectedValue*, luck*} shape shared by both a
 * single normalized opening record and a lifetime aggregate (see `mapRecordToCardInputs` /
 * `mapAggregateToCardInputs` below).
 * @param {string} containerHrid
 * @param {Object} input
 * @returns {Object} Stat values ready for `buildCard`
 */
function computeStats(containerHrid, input) {
    const cost = calculateOpeningCost(containerHrid, input.amount);
    const profit = input.incomeComplete && cost.complete ? input.income - cost.cost : null;
    const stdDev = calculateIncomeStdDev(containerHrid, input.amount);

    return {
        amount: input.amount,
        income: input.income,
        incomeIncomplete: !input.incomeComplete,
        profit,
        luckPercent: input.luckAvailable ? input.luckPercent : null,
        expectedIncome: input.expectedIncomeAvailable ? input.expectedIncome : null,
        expectedIncomeIncomplete: input.expectedIncomeAvailable && !input.expectedIncomeComplete,
        stdDev,
        higher: input.luckAvailable ? input.luckValue : null,
    };
}

function mapRecordToCardInputs(record) {
    return {
        amount: record.containerCount,
        income: record.actualValue,
        incomeComplete: record.actualValueComplete,
        expectedIncome: record.expectedValue,
        expectedIncomeAvailable: record.expectedValueAvailable,
        expectedIncomeComplete: record.expectedValueComplete,
        luckAvailable: record.luckValue !== null && record.luckValue !== undefined,
        luckValue: record.luckValue,
        luckPercent: record.luckPercent,
    };
}

function mapAggregateToCardInputs(lifetimeAggregate) {
    const luckAvailable =
        (lifetimeAggregate.valuationRecordCount || 0) > 0 &&
        lifetimeAggregate.luckEligibleRecordCount === lifetimeAggregate.valuationRecordCount;
    const luckValue = luckAvailable ? lifetimeAggregate.actualValueTotal - lifetimeAggregate.expectedValueTotal : null;
    const luckPercent =
        luckAvailable && lifetimeAggregate.expectedValueTotal > 0
            ? (luckValue / lifetimeAggregate.expectedValueTotal) * 100
            : null;

    return {
        amount: lifetimeAggregate.containersOpened,
        income: lifetimeAggregate.actualValueTotal,
        incomeComplete: (lifetimeAggregate.actualValuePartialEvents || 0) === 0,
        expectedIncome: lifetimeAggregate.expectedValueTotal,
        expectedIncomeAvailable: (lifetimeAggregate.expectedValueAvailableEvents || 0) > 0,
        expectedIncomeComplete: (lifetimeAggregate.expectedValuePartialEvents || 0) === 0,
        luckAvailable,
        luckValue,
        luckPercent,
    };
}

function buildStatRow(label, valueHtml, { indent = false } = {}) {
    return `<div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; ${
        indent ? 'margin-left:12px; border-left:2px solid #4a4a4a; padding-left:6px;' : ''
    }"><span style="color:${config.COLOR_TEXT_SECONDARY || '#aaa'};">${label}:</span><span>${valueHtml}</span></div>`;
}

function buildCard(title, stats) {
    const incomeHtml = `${formatMoney(stats.income)}${stats.incomeIncomplete ? ' <span title="Some gained items could not be priced">[Partial]</span>' : ''}`;
    const profitHtml =
        stats.profit === null
            ? '—'
            : `<span style="color:${luckColor(stats.profit)}">${formatSignedMoney(stats.profit)}</span>`;
    const luckHtml =
        stats.luckPercent === null
            ? '—'
            : `<span style="color:${luckColor(stats.luckPercent)}">${formatPercent(stats.luckPercent)}</span>`;
    const expectedHtml = `${formatMoney(stats.expectedIncome)}${stats.expectedIncomeIncomplete ? ' <span title="One or more openings could not be fully priced">[Partial]</span>' : ''}`;
    const stdDevHtml = formatMoney(stats.stdDev);
    const higherHtml =
        stats.higher === null
            ? '—'
            : `<span style="color:${luckColor(stats.higher)}">${formatSignedMoney(stats.higher)}</span>`;

    return `
        <div style="background:#2a2a2a; border:2px solid #4a4a4a; border-radius:8px; padding:10px; min-width:140px; flex:1;">
            <div style="font-size:13px; font-weight:bold; text-align:center; border-bottom:1px solid #4a4a4a; padding-bottom:6px; margin-bottom:6px;">${title}</div>
            ${buildStatRow('Amount', formatWithSeparator(Math.round(stats.amount || 0)))}
            ${buildStatRow('Income', incomeHtml)}
            ${buildStatRow('Profit', profitHtml)}
            ${buildStatRow('Luck', luckHtml)}
            <div style="height:6px;"></div>
            ${buildStatRow('E[income]', expectedHtml)}
            ${buildStatRow('std. dev.', stdDevHtml, { indent: true })}
            ${buildStatRow('Higher', higherHtml)}
        </div>
    `;
}

class OpenableAnalyticsSidePanel {
    constructor() {
        this.isInitialized = false;
        this.unregisterObserver = null;
        this.unsubscribeCollector = null;
        this.currentPanel = null;
        this.currentModal = null;
        this.stopWatchingModal = null;
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.unregisterObserver = domObserver.onClass('openableAnalyticsSidePanel', MODAL_CONTENT_CLASS, (node) =>
            this.tryShow(node)
        );

        this.unsubscribeCollector = openableAnalyticsDataCollector.onUpdate(() => this.refreshMountedModal());
    }

    refreshMountedModal() {
        if (!this.isInitialized) return;
        const container = document.querySelector(`[class*="${MODAL_CONTENT_CLASS}"]`);
        if (!container) return;
        this.tryShow(container);
    }

    tryShow(container) {
        if (!this.isInitialized) return;
        if (!config.getSetting('openableAnalytics_sidePanel')) {
            this.removePanel();
            return;
        }

        const record = openableAnalyticsDataCollector.getLatestRecord();
        if (!isMonetaryRewardModal(container, record)) {
            this.removePanel();
            return;
        }

        this.renderPanel(container, record);
    }

    renderPanel(modal, record) {
        const lifetimeAggregate = openableAnalyticsDataCollector.getLifetimeAggregate(record.containerHrid);

        if (!this.currentPanel || this.currentModal !== modal) {
            this.removePanel();
            this.currentPanel = document.createElement('div');
            this.currentPanel.id = PANEL_ID;
            this.currentPanel.style.cssText = `
                position: fixed;
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                z-index: ${config.Z_FLOATING_PANEL};
            `;
            document.body.appendChild(this.currentPanel);
            this.currentModal = modal;
            this.setupCleanupObserver(modal);
        }

        const currentStats = computeStats(record.containerHrid, mapRecordToCardInputs(record));
        const historyStats = computeStats(record.containerHrid, mapAggregateToCardInputs(lifetimeAggregate));

        this.currentPanel.innerHTML = buildCard('Current', currentStats) + buildCard('History', historyStats);
        this.positionPanel(this.currentPanel, modal);
    }

    /**
     * Always anchor to the left of the modal (never the right): shrink the panel width to
     * whatever room is available on the left before it would cross the viewport margin.
     * @param {HTMLElement} panel
     * @param {HTMLElement} modal
     */
    positionPanel(panel, modal) {
        const modalRect = modal.getBoundingClientRect();
        const naturalWidth = panel.scrollWidth || NATURAL_PANEL_WIDTH;
        const availableLeft = modalRect.left - PANEL_GAP - PANEL_VIEWPORT_MARGIN;
        const width = Math.max(MIN_PANEL_WIDTH, Math.min(naturalWidth, availableLeft));

        panel.style.width = `${width}px`;
        panel.style.left = `${Math.max(PANEL_VIEWPORT_MARGIN, modalRect.left - PANEL_GAP - width)}px`;
        panel.style.top = `${modalRect.top}px`;
    }

    setupCleanupObserver(modal) {
        this.stopWatchingModal = createMutationWatcher(
            document.body,
            () => {
                if (!document.body.contains(modal)) {
                    this.removePanel();
                }
            },
            { childList: true, subtree: true }
        );
    }

    removePanel() {
        if (this.stopWatchingModal) {
            this.stopWatchingModal();
            this.stopWatchingModal = null;
        }
        if (this.currentPanel) {
            this.currentPanel.remove();
            this.currentPanel = null;
        }
        this.currentModal = null;
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
        this.removePanel();
        this.isInitialized = false;
    }
}

const openableAnalyticsSidePanel = new OpenableAnalyticsSidePanel();

export default openableAnalyticsSidePanel;
export { computeStats, mapRecordToCardInputs, mapAggregateToCardInputs, buildCard, PANEL_ID };
