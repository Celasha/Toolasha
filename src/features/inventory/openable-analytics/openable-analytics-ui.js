/**
 * Openable Analytics UI
 * Character-scoped Analytics popup: container selector, Session/Lifetime toggle, Actual/Expected/
 * Luck summary, aggregated item outcomes, and destructive reset controls. Modeled on the existing
 * bespoke-overlay popup convention used by Combat Statistics (no shared modal utility exists in
 * Toolasha to build on top of).
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import domObserver from '../../../core/dom-observer.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import openableAnalyticsModalInjector, { formatValue, formatLuckPercent } from './openable-analytics-modal-injector.js';
import { parseEdibleExport, parseCombatSuiteExport } from './openable-analytics-import-parsers.js';

const IMPORT_SOURCES = [
    { key: 'edible', label: 'Edible Tools', prefixedSource: 'import:edible' },
    { key: 'mwi-combat-suite', label: 'MWI Combat Suite', prefixedSource: 'import:mwi-combat-suite' },
];

const INVENTORY_FILTER_CONTAINER_CLASS = 'Inventory_itemFilterContainer';
const INVENTORY_BUTTON_CLASS = 'toolasha-openable-analytics-inventory-button';

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
        this.importSourceKey = 'mwi-combat-suite';
        this.importStatus = null;
        this.pendingEdiblePlayers = null;
        this.pendingEdibleRawText = null;
        this.unregisterInventoryButtonObserver = null;
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        openableAnalyticsModalInjector.initialize({
            onViewAnalytics: (containerHrid) => this.showPopup(containerHrid),
        });

        // Persistent entry point: the "View Analytics" link inside the Opened Loot modal only
        // exists right after opening something. This button in the Inventory panel's always-
        // rendered search bar row lets it be opened at any time.
        this.unregisterInventoryButtonObserver = domObserver.onClass(
            'openableAnalyticsInventoryButton',
            INVENTORY_FILTER_CONTAINER_CLASS,
            (node) => this.injectInventoryButton(node)
        );
    }

    injectInventoryButton(container) {
        if (container.querySelector(`.${INVENTORY_BUTTON_CLASS}`)) return;

        const button = document.createElement('div');
        button.className = INVENTORY_BUTTON_CLASS;
        button.textContent = '📊';
        button.title = 'Openable Analytics';
        button.style.cssText =
            'cursor:pointer; margin-left:8px; font-size:16px; display:inline-flex; align-items:center;';
        button.onclick = () => this.showPopup();

        container.appendChild(button);
    }

    showPopup(containerHrid) {
        const known = openableAnalyticsDataCollector.getKnownContainers();
        this.selectedContainer = containerHrid || known[0] || null;
        this.selectedScope = 'session';
        this.importStatus = null;
        this.pendingEdiblePlayers = null;
        this.pendingEdibleRawText = null;
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
            empty.style.marginBottom = '16px';
            popup.appendChild(empty);
        } else {
            popup.appendChild(this.buildControls(known));
            popup.appendChild(this.buildSummary());
            popup.appendChild(this.buildItemOutcomes());
            popup.appendChild(this.buildResetControls());
        }

        popup.appendChild(this.buildImportPanel());

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
            const itemValue = aggregate.itemValueTotals?.[itemHrid];
            valueEl.textContent = itemValue !== undefined ? `${count} (${formatValue(itemValue)})` : `${count} (N/A)`;
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

    buildImportPanel() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding-top:16px; border-top:1px solid #3a3a3a;';

        const heading = document.createElement('div');
        heading.textContent = 'Import Historical Data';
        heading.style.cssText = 'font-weight:600; margin-bottom:6px;';
        wrapper.appendChild(heading);

        const help = document.createElement('div');
        help.style.cssText = 'font-size:12px; opacity:0.75; margin-bottom:8px;';
        help.textContent =
            "Adds a one-time bulk total to your Lifetime totals, revalued using Toolasha's own pricing. Does not add individual opening events (these sources only keep running totals, not per-opening history). Re-importing the same source replaces its previous total rather than adding to it.";
        wrapper.appendChild(help);

        if (this.pendingEdiblePlayers) {
            wrapper.appendChild(this.buildEdiblePlayerPicker());
            return wrapper;
        }

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;';

        const sourceSelect = document.createElement('select');
        sourceSelect.style.cssText =
            'background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; padding:4px 8px; border-radius:4px;';
        for (const { key, label } of IMPORT_SOURCES) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = label;
            if (key === this.importSourceKey) option.selected = true;
            sourceSelect.appendChild(option);
        }
        sourceSelect.onchange = () => {
            this.importSourceKey = sourceSelect.value;
        };

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json,text/plain';
        fileInput.style.cssText = 'font-size:12px; max-width:180px;';

        controls.appendChild(sourceSelect);
        controls.appendChild(fileInput);
        wrapper.appendChild(controls);

        const textarea = document.createElement('textarea');
        textarea.placeholder =
            "Paste exported/copied data here (MWI Combat Suite: paste the exported .json file contents. Edible Tools: paste the value of localStorage.getItem('Edible_Tools') from your browser devtools).";
        textarea.style.cssText =
            'width:100%; height:70px; background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; border-radius:4px; padding:6px; font-size:12px; box-sizing:border-box; resize:vertical;';
        wrapper.appendChild(textarea);

        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                textarea.value = String(reader.result || '');
            };
            reader.readAsText(file);
        };

        const importButton = document.createElement('button');
        importButton.textContent = 'Import';
        importButton.style.cssText =
            'margin-top:8px; background:#4a4a4a; border:1px solid #5a5a5a; color:#fff; font-size:12px; cursor:pointer; padding:6px 12px; border-radius:4px;';
        importButton.onclick = () => this.handleImportSubmit(textarea.value);
        wrapper.appendChild(importButton);

        if (this.importStatus) {
            const status = document.createElement('div');
            status.style.cssText = 'margin-top:8px; font-size:12px; opacity:0.9;';
            status.textContent = this.importStatus;
            wrapper.appendChild(status);
        }

        return wrapper;
    }

    buildEdiblePlayerPicker() {
        const wrapper = document.createElement('div');

        const label = document.createElement('div');
        label.textContent = 'This Edible Tools data has more than one player - which one is this character?';
        label.style.cssText = 'font-size:12px; margin-bottom:6px;';
        wrapper.appendChild(label);

        const select = document.createElement('select');
        select.style.cssText =
            'background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; padding:4px 8px; border-radius:4px; margin-right:8px;';
        for (const player of this.pendingEdiblePlayers) {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = player.name;
            select.appendChild(option);
        }
        wrapper.appendChild(select);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Import for this player';
        confirmButton.style.cssText =
            'background:#4a4a4a; border:1px solid #5a5a5a; color:#fff; font-size:12px; cursor:pointer; padding:6px 12px; border-radius:4px;';
        confirmButton.onclick = () => this.handleEdiblePlayerSelected(select.value);
        wrapper.appendChild(confirmButton);

        return wrapper;
    }

    async handleImportSubmit(rawText) {
        if (!rawText?.trim()) {
            this.importStatus = 'Paste or upload some data first.';
            this.createPopup();
            return;
        }

        const result = this.importSourceKey === 'edible' ? parseEdibleExport(rawText) : parseCombatSuiteExport(rawText);

        if (result.needsPlayerSelection) {
            this.pendingEdiblePlayers = result.players;
            this.pendingEdibleRawText = rawText;
            this.createPopup();
            return;
        }

        const sourceEntry = IMPORT_SOURCES.find((entry) => entry.key === this.importSourceKey);
        await this.applyImportResult(sourceEntry.prefixedSource, result);
    }

    async handleEdiblePlayerSelected(playerId) {
        const result = parseEdibleExport(this.pendingEdibleRawText, { playerId });
        this.pendingEdiblePlayers = null;
        this.pendingEdibleRawText = null;
        await this.applyImportResult('import:edible', result);
    }

    async applyImportResult(source, result) {
        if (result.containers.length > 0) {
            await openableAnalyticsDataCollector.importContainers(source, result.containers);
        }

        const importedCount = result.containers.length;
        const warningsText = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
        this.importStatus =
            importedCount > 0
                ? `Imported ${importedCount} container(s).${warningsText}`
                : `Nothing imported.${warningsText}`;

        if (!this.selectedContainer && result.containers[0]) {
            this.selectedContainer = result.containers[0].containerHrid;
        }

        this.createPopup();
    }

    cleanup() {
        this.closePopup();
        openableAnalyticsModalInjector.cleanup();
        if (this.unregisterInventoryButtonObserver) {
            this.unregisterInventoryButtonObserver();
            this.unregisterInventoryButtonObserver = null;
        }
        this.isInitialized = false;
    }
}

const openableAnalyticsUI = new OpenableAnalyticsUI();

export default openableAnalyticsUI;
export { INVENTORY_FILTER_CONTAINER_CLASS, INVENTORY_BUTTON_CLASS };
