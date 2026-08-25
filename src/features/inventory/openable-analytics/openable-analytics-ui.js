/**
 * Openable Analytics UI
 * Character-scoped Analytics popup: container selector, Session/Lifetime toggle, Actual/Expected/
 * Luck summary, aggregated item outcomes, and destructive reset controls. Modeled on the existing
 * bespoke-overlay popup convention used by Combat Statistics (no shared modal utility exists in
 * Toolasha to build on top of).
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import openableAnalyticsModalInjector, { formatValue, formatLuckPercent } from './openable-analytics-modal-injector.js';

function luckColor(luckValue) {
    if (luckValue === null || luckValue === undefined) return config.COLOR_TEXT_SECONDARY || '#888888';
    return luckValue >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
}

function containerLabel(containerHrid) {
    const details = dataManager.getItemDetails(containerHrid);
    return details?.name || containerHrid;
}

function itemLabel(itemHrid) {
    const details = dataManager.getItemDetails(itemHrid);
    return details?.name || itemHrid;
}

class OpenableAnalyticsUI {
    constructor() {
        this.isInitialized = false;
        this.popup = null;
        this.selectedContainer = null;
        this.selectedScope = 'session';
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        openableAnalyticsModalInjector.initialize({
            onViewAnalytics: (containerHrid) => this.showPopup(containerHrid),
        });
    }

    showPopup(containerHrid) {
        const known = openableAnalyticsDataCollector.getKnownContainers();
        this.selectedContainer = containerHrid || known[0] || null;
        this.selectedScope = 'session';
        this.createPopup();
    }

    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    getActiveAggregate() {
        if (!this.selectedContainer) return null;
        return this.selectedScope === 'lifetime'
            ? openableAnalyticsDataCollector.getLifetimeAggregate(this.selectedContainer)
            : openableAnalyticsDataCollector.getSessionAggregate(this.selectedContainer);
    }

    createPopup() {
        if (this.popup) {
            this.closePopup();
        }

        const textColor = config.COLOR_TEXT_PRIMARY;
        const known = openableAnalyticsDataCollector.getKnownContainers();

        const overlay = document.createElement('div');
        overlay.className = 'toolasha-openable-analytics-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const popup = document.createElement('div');
        popup.className = 'toolasha-openable-analytics-popup';
        popup.style.cssText = `
            background: #1a1a1a; border: 2px solid #3a3a3a; border-radius: 8px;
            padding: 20px; max-width: 90%; max-height: 90%; overflow-y: auto;
            color: ${textColor}; min-width: 480px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 16px; border-bottom: 2px solid #3a3a3a; padding-bottom: 10px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Openable Analytics';
        title.style.cssText = `margin: 0; color: ${textColor}; font-size: 22px;`;

        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.cssText = `background: none; border: none; color: ${textColor}; font-size: 32px; cursor: pointer; padding: 0; line-height: 1;`;
        closeButton.onclick = () => this.closePopup();

        header.appendChild(title);
        header.appendChild(closeButton);
        popup.appendChild(header);

        if (known.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No openings recorded yet for this character.';
            empty.style.opacity = '0.75';
            popup.appendChild(empty);
        } else {
            popup.appendChild(this.buildControls(known));
            popup.appendChild(this.buildSummary());
            popup.appendChild(this.buildItemOutcomes());
            popup.appendChild(this.buildResetControls());
        }

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        overlay.onclick = (e) => {
            if (e.target === overlay) this.closePopup();
        };

        this.popup = overlay;
    }

    buildControls(known) {
        const container = document.createElement('div');
        container.style.cssText = 'display:flex; gap:12px; margin-bottom:16px; align-items:center;';

        const containerSelect = document.createElement('select');
        containerSelect.style.cssText =
            'background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; padding:4px 8px; border-radius:4px;';
        for (const hrid of known) {
            const option = document.createElement('option');
            option.value = hrid;
            option.textContent = containerLabel(hrid);
            if (hrid === this.selectedContainer) option.selected = true;
            containerSelect.appendChild(option);
        }
        containerSelect.onchange = () => {
            this.selectedContainer = containerSelect.value;
            this.createPopup();
        };

        const scopeSelect = document.createElement('select');
        scopeSelect.style.cssText =
            'background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; padding:4px 8px; border-radius:4px;';
        for (const scope of ['session', 'lifetime']) {
            const option = document.createElement('option');
            option.value = scope;
            option.textContent = scope === 'session' ? 'Session' : 'Lifetime';
            if (scope === this.selectedScope) option.selected = true;
            scopeSelect.appendChild(option);
        }
        scopeSelect.onchange = () => {
            this.selectedScope = scopeSelect.value;
            this.createPopup();
        };

        container.appendChild(containerSelect);
        container.appendChild(scopeSelect);
        return container;
    }

    buildSummary() {
        const aggregate = this.getActiveAggregate();
        const wrapper = document.createElement('div');
        wrapper.style.cssText =
            'background:#2a2a2a; border:1px solid #4a4a4a; border-radius:6px; padding:12px; margin-bottom:16px;';

        const luckAvailable = aggregate.expectedValueAvailableEvents > 0;
        const luckValue = luckAvailable ? aggregate.actualValueTotal - aggregate.expectedValueTotal : null;
        const luckPercent =
            luckAvailable && aggregate.expectedValueTotal > 0 ? (luckValue / aggregate.expectedValueTotal) * 100 : null;

        const rows = [
            ['Opening events', aggregate.eventsCount],
            ['Containers opened', aggregate.containersOpened],
            ['Actual Value', formatValue(aggregate.actualValueTotal)],
            ['Expected Value', luckAvailable ? formatValue(aggregate.expectedValueTotal) : 'N/A'],
            [
                'Luck',
                luckAvailable ? `${formatValue(luckValue)}${formatLuckPercent(luckPercent)}` : 'N/A',
                luckAvailable ? luckColor(luckValue) : undefined,
            ],
        ];

        if (aggregate.actualValuePartialEvents > 0) {
            rows.push(['Partial-data events', aggregate.actualValuePartialEvents]);
        }

        for (const [label, value, color] of rows) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; padding:2px 0;';
            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            const valueEl = document.createElement('span');
            valueEl.textContent = value;
            if (color) valueEl.style.color = color;
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            wrapper.appendChild(row);
        }

        return wrapper;
    }

    buildItemOutcomes() {
        const aggregate = this.getActiveAggregate();
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:16px;';

        const heading = document.createElement('div');
        heading.textContent = 'Aggregated Item Outcomes';
        heading.style.cssText = 'font-weight:600; margin-bottom:6px;';
        wrapper.appendChild(heading);

        const entries = Object.entries(aggregate.itemTotals || {}).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No items gained in this scope.';
            empty.style.opacity = '0.75';
            wrapper.appendChild(empty);
            return wrapper;
        }

        for (const [itemHrid, count] of entries) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; padding:2px 0; font-size:13px;';
            const labelEl = document.createElement('span');
            labelEl.textContent = itemLabel(itemHrid);
            const valueEl = document.createElement('span');
            valueEl.textContent = count;
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            wrapper.appendChild(row);
        }

        return wrapper;
    }

    buildResetControls() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; gap:10px; padding-top:10px; border-top:1px solid #3a3a3a;';

        const resetContainerButton = document.createElement('button');
        resetContainerButton.textContent = 'Reset This Container';
        resetContainerButton.style.cssText =
            'background:#4a4a4a; border:1px solid #5a5a5a; color:#fff; font-size:12px; cursor:pointer; padding:6px 12px; border-radius:4px;';
        resetContainerButton.onclick = async () => {
            if (
                confirm(
                    `Reset all Openable Analytics history for ${containerLabel(this.selectedContainer)}? This cannot be undone.`
                )
            ) {
                await openableAnalyticsDataCollector.resetContainer(this.selectedContainer);
                this.showPopup();
            }
        };

        const resetAllButton = document.createElement('button');
        resetAllButton.textContent = 'Reset All Openable Analytics';
        resetAllButton.style.cssText =
            'background:#4a4a4a; border:1px solid #5a5a5a; color:#fff; font-size:12px; cursor:pointer; padding:6px 12px; border-radius:4px;';
        resetAllButton.onclick = async () => {
            if (confirm('Reset ALL Openable Analytics history for this character? This cannot be undone.')) {
                await openableAnalyticsDataCollector.resetAll();
                this.closePopup();
            }
        };

        wrapper.appendChild(resetContainerButton);
        wrapper.appendChild(resetAllButton);
        return wrapper;
    }

    cleanup() {
        this.closePopup();
        openableAnalyticsModalInjector.cleanup();
        this.isInitialized = false;
    }
}

const openableAnalyticsUI = new OpenableAnalyticsUI();

export default openableAnalyticsUI;
