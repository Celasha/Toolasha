/**
 * Openable Analytics Side Panel
 * Pins a Current/History stat-card panel to the LEFT of the native "Opened Loot" modal whenever
 * a monetary box opening occurs, alongside the existing inline footer. Always anchored on the
 * left (shrinking rather than flipping to the right when space is tight), matching the fixed
 * modal-anchoring technique already used by the Sharable Profile Score panel.
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import domObserver from '../../../core/dom-observer.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import { isMonetaryRewardModal, MODAL_CONTENT_CLASS } from './openable-analytics-modal-injector.js';
import { calculateOpeningCost } from './openable-analytics-cost.js';
import { calculateIncomeStdDev } from './openable-analytics-variance.js';
import expectedValueCalculator from '../../market/expected-value-calculator.js';
import assetManifest from '../../../utils/asset-manifest.js';
import { createMutationWatcher } from '../../../utils/dom-observer-helpers.js';
import { coinFormatter, formatWithSeparator } from '../../../utils/formatters.js';

const PANEL_GAP = 8;
const PANEL_VIEWPORT_MARGIN = 10;
const MIN_PANEL_WIDTH = 150;
const NATURAL_PANEL_WIDTH = 300;
const PANEL_ID = 'mwi-openable-analytics-side-panel';
const MAX_BREAKDOWN_ROWS = 8;

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

function buildPartialBadge() {
    return ` <span style="color:${config.COLOR_WARNING || '#ffa500'}; font-size:10px;">(partial)</span>`;
}

function buildStatRow(label, valueHtml, { stacked = false } = {}) {
    if (stacked) {
        return `<div style="padding:3px 0;"><div style="font-size:12px; color:${config.COLOR_TEXT_SECONDARY || '#aaa'};">${label}</div><div style="font-size:13px; color:${config.COLOR_TEXT_PRIMARY || '#fff'};">${valueHtml}</div></div>`;
    }
    return `<div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:13px; padding:3px 0;"><span style="color:${config.COLOR_TEXT_SECONDARY || '#aaa'};">${label}</span><span style="color:${config.COLOR_TEXT_PRIMARY || '#fff'};">${valueHtml}</span></div>`;
}

/**
 * A stat row that can be clicked to reveal a breakdown underneath it (e.g. which items made up
 * this total, or why it's marked "(partial)"). The expand/collapse state is tracked by the
 * caller (`OpenableAnalyticsSidePanel.expandedSections`) so it survives the panel's frequent
 * full re-renders instead of silently collapsing every time new loot data comes in.
 *
 * Returns the toggle row and its breakdown content as separate strings (rather than one
 * concatenated block) so the caller can place the breakdown content outside the narrow
 * two-column layout - item rows inside a breakdown (icon + name + value) need much more
 * horizontal room than a half-width column can offer, or their values get clipped.
 * @param {string} label
 * @param {string} valueHtml
 * @param {string} toggleKey - Unique key for this row's expand state
 * @param {string} contentHtml - Breakdown HTML shown when expanded
 * @param {boolean} expanded
 * @param {{stacked?: boolean}} [options]
 * @returns {{toggleHtml: string, detailHtml: string}}
 */
function buildExpandableStatRow(label, valueHtml, toggleKey, contentHtml, expanded, { stacked = false } = {}) {
    const chevron = `<span class="mwi-oa-chevron" style="display:inline-block; width:11px;">${expanded ? '▾' : '▸'}</span>`;
    const toggleRowHtml = stacked
        ? `<div style="font-size:12px; color:${config.COLOR_TEXT_SECONDARY || '#aaa'};">${chevron}${label}</div><div style="font-size:13px; color:${config.COLOR_TEXT_PRIMARY || '#fff'};">${valueHtml}</div>`
        : `<span style="color:${config.COLOR_TEXT_SECONDARY || '#aaa'};">${chevron}${label}</span><span style="color:${config.COLOR_TEXT_PRIMARY || '#fff'};">${valueHtml}</span>`;
    const toggleRowStyle = stacked
        ? 'padding:3px 0; cursor:pointer;'
        : 'display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:13px; padding:3px 0; cursor:pointer;';
    const toggleHtml = `
        <div data-toggle-key="${toggleKey}" style="${toggleRowStyle}" title="Click for details">
            ${toggleRowHtml}
        </div>
    `;
    const detailHtml = `
        <div data-content-key="${toggleKey}" style="display:${expanded ? 'block' : 'none'}; padding:2px 0 6px 4px; font-size:11px; color:${config.COLOR_TEXT_SECONDARY || '#aaa'}; line-height:1.5;">
            ${contentHtml}
        </div>
    `;
    return { toggleHtml, detailHtml };
}

/**
 * Inline SVG icon referencing the game's own items sprite sheet, matching the
 * `<svg><use href="{spriteUrl}#{slug}"></use></svg>` convention used elsewhere in Toolasha (e.g.
 * pinned-actions-page.js) rather than an `<img>` tag. Renders nothing if the manifest fetch
 * hasn't resolved yet or the item has no hrid, so breakdown rows never show a broken image.
 * @param {string|null} spriteUrl
 * @param {string} itemHrid
 * @param {number} [size]
 * @returns {string}
 */
function buildItemIconHtml(spriteUrl, itemHrid, size = 16) {
    if (!spriteUrl || !itemHrid) return '';
    const slug = itemHrid.replace('/items/', '');
    return `<span style="display:inline-flex; align-items:center; justify-content:center; width:${size}px; height:${size}px; margin-right:4px; flex-shrink:0;"><svg width="${size}" height="${size}"><use href="${spriteUrl}#${slug}"></use></svg></span>`;
}

function buildDropBreakdownRows(drops, amount, spriteUrl) {
    return drops
        .map((drop) => {
            const total = drop.expectedValue * (amount || 0);
            const priceNote = drop.hasPriceData
                ? ''
                : ` <span style="color:${config.COLOR_WARNING || '#ffa500'};">(no price yet)</span>`;
            const icon = buildItemIconHtml(spriteUrl, drop.itemHrid);
            return `<div style="display:flex; justify-content:space-between; gap:8px; padding:1px 0;"><span style="display:flex; align-items:center; min-width:0;">${icon}${drop.itemName}${priceNote}</span><span style="flex-shrink:0;">${formatMoney(total)}</span></div>`;
        })
        .join('');
}

/**
 * A container can have multiple raw drop-table rows for the same item (e.g. a guaranteed roll
 * and a separate bonus-roll tier) - `getDropBreakdown()` returns those as-is since other
 * consumers (risk-of-ruin-ui.js) need the per-tier `avgCount`/`dropRate` for their own math. This
 * display only cares about "what can this item drop", so same-item rows are summed into one.
 * @param {Array} drops
 * @returns {Array}
 */
function mergeDropsByItem(drops) {
    const byItemHrid = new Map();
    for (const drop of drops) {
        const existing = byItemHrid.get(drop.itemHrid);
        if (existing) {
            existing.expectedValue += drop.expectedValue;
        } else {
            byItemHrid.set(drop.itemHrid, { ...drop });
        }
    }
    return Array.from(byItemHrid.values()).sort((a, b) => b.expectedValue - a.expectedValue);
}

/**
 * Breakdown for the "Expected income" row: every item this container can drop, valued at
 * current market prices and scaled to the card's own opened count - the same drop table backs
 * both the Current and History cards, only the scaling amount differs.
 * @param {string} containerHrid
 * @param {number} amount
 * @param {string|null} spriteUrl
 * @returns {string}
 */
function buildExpectedBreakdownContent(containerHrid, amount, spriteUrl) {
    const drops = mergeDropsByItem(expectedValueCalculator.getDropBreakdown(containerHrid));
    if (!drops.length) {
        return '<div>No drop data available for this container.</div>';
    }

    const shown = drops.slice(0, MAX_BREAKDOWN_ROWS);
    const omittedCount = drops.length - shown.length;
    const omittedNote =
        omittedCount > 0
            ? `<div style="opacity:0.7; margin-top:2px;">+ ${omittedCount} more possible drop${omittedCount === 1 ? '' : 's'} not shown</div>`
            : '';

    return `
        <div style="margin-bottom:4px;">What this container can drop, valued at today's market prices for ${formatWithSeparator(Math.round(amount || 0))} opened:</div>
        ${buildDropBreakdownRows(shown, amount, spriteUrl)}
        ${omittedNote}
    `;
}

/**
 * Breakdown for the Current card's "Income" row: the actual items received this opening.
 * @param {Object} record
 * @param {string|null} spriteUrl
 * @returns {string}
 */
function buildCurrentIncomeBreakdownContent(record, spriteUrl) {
    if (!record?.actualValueBreakdown?.length) {
        return '<div>No item data available for this opening.</div>';
    }

    const rows = record.actualValueBreakdown
        .map((item) => {
            const name = dataManager.getItemDetails(item.itemHrid)?.name || item.itemHrid;
            const priceNote = item.resolved
                ? ''
                : ` <span style="color:${config.COLOR_WARNING || '#ffa500'};">(no price yet)</span>`;
            const icon = buildItemIconHtml(spriteUrl, item.itemHrid);
            return `<div style="display:flex; justify-content:space-between; gap:8px; padding:1px 0;"><span style="display:flex; align-items:center; min-width:0;">${icon}${name} ×${formatWithSeparator(item.count)}${priceNote}</span><span style="flex-shrink:0;">${formatMoney(item.value)}</span></div>`;
        })
        .join('');

    return `<div style="margin-bottom:4px;">Items received this opening:</div>${rows}`;
}

/**
 * Breakdown for the History card's "Income" row: cumulative item counts/values across every
 * lifetime opening of this container. Sourced from the same `itemTotals`/`itemValueTotals` the
 * lifetime aggregate already accumulates per opening (see `foldRecordIntoAggregate` in
 * openable-analytics-storage.js) - no new tracking needed, just surfacing what's already recorded.
 * An item present in `itemTotals` but missing from `itemValueTotals` was never resolved to a
 * price across any opening and is flagged rather than silently valued at 0.
 * @param {Object|null} aggregate - Lifetime aggregate (see mapAggregateToCardInputs)
 * @param {string|null} spriteUrl
 * @returns {string}
 */
function buildHistoryIncomeBreakdownContent(aggregate, spriteUrl) {
    const itemHrids = Object.keys(aggregate?.itemTotals || {});
    if (!itemHrids.length) {
        return '<div>No item data recorded yet.</div>';
    }

    const items = itemHrids
        .map((itemHrid) => {
            const count = aggregate.itemTotals[itemHrid] || 0;
            const value = aggregate.itemValueTotals?.[itemHrid];
            return { itemHrid, count, value: value || 0, resolved: value !== undefined };
        })
        .sort((a, b) => b.value - a.value);

    const shown = items.slice(0, MAX_BREAKDOWN_ROWS);
    const omittedCount = items.length - shown.length;
    const omittedNote =
        omittedCount > 0
            ? `<div style="opacity:0.7; margin-top:2px;">+ ${omittedCount} more item${omittedCount === 1 ? '' : 's'} not shown</div>`
            : '';

    const rows = shown
        .map((item) => {
            const name = dataManager.getItemDetails(item.itemHrid)?.name || item.itemHrid;
            const priceNote = item.resolved
                ? ''
                : ` <span style="color:${config.COLOR_WARNING || '#ffa500'};">(no price yet)</span>`;
            const icon = buildItemIconHtml(spriteUrl, item.itemHrid);
            return `<div style="display:flex; justify-content:space-between; gap:8px; padding:1px 0;"><span style="display:flex; align-items:center; min-width:0;">${icon}${name} ×${formatWithSeparator(item.count)}${priceNote}</span><span style="flex-shrink:0;">${formatMoney(item.value)}</span></div>`;
        })
        .join('');

    return `<div style="margin-bottom:4px;">Cumulative items received across all lifetime openings:</div>${rows}${omittedNote}`;
}

/**
 * @param {string} title
 * @param {Object} stats
 * @param {Object} options
 * @param {string} options.keyPrefix - 'current' or 'history', keeps the two cards' toggle keys distinct
 * @param {string} options.containerHrid
 * @param {Object|null} options.record - Single opening record (Current card only, null for History)
 * @param {Object|null} options.aggregate - Lifetime aggregate (History card only, null for Current)
 * @param {Set<string>} options.expandedSections
 * @param {string|null} options.spriteUrl
 * @returns {string}
 */
function buildCard(title, stats, { keyPrefix, containerHrid, record, aggregate, expandedSections, spriteUrl }) {
    const incomeKey = `${keyPrefix}-income`;
    const expectedKey = `${keyPrefix}-expected`;

    const incomeValueHtml = `${formatMoney(stats.income)}${stats.incomeIncomplete ? buildPartialBadge() : ''}`;
    const profitHtml =
        stats.profit === null
            ? '—'
            : `<span style="color:${luckColor(stats.profit)}">${formatSignedMoney(stats.profit)}</span>`;
    const luckHtml =
        stats.luckPercent === null
            ? '—'
            : `<span style="color:${luckColor(stats.luckPercent)}">${formatPercent(stats.luckPercent)}</span>`;
    const rangeHtml =
        stats.stdDev === null || stats.stdDev === undefined
            ? ''
            : ` <span style="color:${config.COLOR_TEXT_SECONDARY || '#aaa'}; font-size:11px;" title="Actual income for a batch this size usually lands within this range of the expected amount">± ${formatMoney(stats.stdDev)}</span>`;
    const expectedValueHtml = `${formatMoney(stats.expectedIncome)}${rangeHtml}${stats.expectedIncomeIncomplete ? buildPartialBadge() : ''}`;
    const vsExpectedHtml =
        stats.higher === null
            ? '—'
            : `<span style="color:${luckColor(stats.higher)}">${formatSignedMoney(stats.higher)}</span>`;

    const incomeBreakdownHtml = record
        ? buildCurrentIncomeBreakdownContent(record, spriteUrl)
        : buildHistoryIncomeBreakdownContent(aggregate, spriteUrl);

    const incomeRow = buildExpandableStatRow(
        'Income',
        incomeValueHtml,
        incomeKey,
        incomeBreakdownHtml,
        expandedSections.has(incomeKey),
        { stacked: true }
    );

    const expectedRow = buildExpandableStatRow(
        'Expected income',
        expectedValueHtml,
        expectedKey,
        buildExpectedBreakdownContent(containerHrid, stats.amount, spriteUrl),
        expandedSections.has(expectedKey),
        { stacked: true }
    );

    return `
        <div style="
            background: rgba(26, 26, 26, 0.97);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 10px;
            padding: 14px;
            min-width: 160px;
            flex: 1;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
        ">
            <div style="
                font-size: 14px;
                font-weight: 700;
                text-align: center;
                letter-spacing: 0.3px;
                color: ${config.COLOR_TEXT_PRIMARY || '#fff'};
                padding-bottom: 8px;
                margin-bottom: 6px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.09);
            ">${title}</div>
            ${buildStatRow('Opened', formatWithSeparator(Math.round(stats.amount || 0)))}
            <div style="display:flex; gap:12px; align-items:flex-start;">
                <div style="flex:1; min-width:0;">
                    ${incomeRow.toggleHtml}
                    ${buildStatRow('Profit', profitHtml, { stacked: true })}
                </div>
                <div style="flex:1; min-width:0; border-left:1px solid rgba(255, 255, 255, 0.08); padding-left:12px;">
                    ${expectedRow.toggleHtml}
                    ${buildStatRow('vs. expected', vsExpectedHtml, { stacked: true })}
                </div>
            </div>
            ${incomeRow.detailHtml}
            ${expectedRow.detailHtml}
            <div style="height:1px; background:rgba(255, 255, 255, 0.08); margin:8px 0;"></div>
            ${buildStatRow('Luck', luckHtml)}
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
        this.expandedSections = new Set();
        this.itemsSpriteUrl = null;
        this.handlePanelClick = this.handlePanelClick.bind(this);
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.unregisterObserver = domObserver.onClass('openableAnalyticsSidePanel', MODAL_CONTENT_CLASS, (node) =>
            this.tryShow(node)
        );

        this.unsubscribeCollector = openableAnalyticsDataCollector.onUpdate(() => this.refreshMountedModal());

        // Item icons are a visual nice-to-have, not a data dependency - the panel renders fine
        // without them while this resolves, then re-renders once the sprite sheet URL is known.
        assetManifest.getSpriteUrl('items').then((url) => {
            if (!this.isInitialized) return;
            this.itemsSpriteUrl = url;
            this.refreshMountedModal();
        });
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
            this.currentPanel.addEventListener('click', this.handlePanelClick);
            document.body.appendChild(this.currentPanel);
            this.currentModal = modal;
            this.setupCleanupObserver(modal);
        }

        const currentStats = computeStats(record.containerHrid, mapRecordToCardInputs(record));
        const historyStats = computeStats(record.containerHrid, mapAggregateToCardInputs(lifetimeAggregate));

        this.currentPanel.innerHTML =
            buildCard('Current', currentStats, {
                keyPrefix: 'current',
                containerHrid: record.containerHrid,
                record,
                aggregate: null,
                expandedSections: this.expandedSections,
                spriteUrl: this.itemsSpriteUrl,
            }) +
            buildCard('History', historyStats, {
                keyPrefix: 'history',
                containerHrid: record.containerHrid,
                record: null,
                aggregate: lifetimeAggregate,
                expandedSections: this.expandedSections,
                spriteUrl: this.itemsSpriteUrl,
            });
        this.positionPanel(this.currentPanel, modal);
    }

    /**
     * Delegated click handler for every expandable stat row in the panel (bound once per panel
     * element in `renderPanel`, since `innerHTML` gets fully replaced on every data refresh).
     * Toggles the row's breakdown content and remembers the open/closed state in
     * `expandedSections` so the next refresh renders it back the way the user left it.
     * @param {MouseEvent} event
     */
    handlePanelClick(event) {
        const toggle = event.target.closest('[data-toggle-key]');
        if (!toggle) return;

        const key = toggle.dataset.toggleKey;
        const content = this.currentPanel?.querySelector(`[data-content-key="${key}"]`);
        if (!content) return;

        const nowExpanded = content.style.display === 'none';
        content.style.display = nowExpanded ? 'block' : 'none';

        const chevron = toggle.querySelector('.mwi-oa-chevron');
        if (chevron) chevron.textContent = nowExpanded ? '▾' : '▸';

        if (nowExpanded) {
            this.expandedSections.add(key);
        } else {
            this.expandedSections.delete(key);
        }
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
        this.expandedSections.clear();
        this.itemsSpriteUrl = null;
        this.isInitialized = false;
    }
}

const openableAnalyticsSidePanel = new OpenableAnalyticsSidePanel();

export default openableAnalyticsSidePanel;
export { computeStats, mapRecordToCardInputs, mapAggregateToCardInputs, buildCard, PANEL_ID };
