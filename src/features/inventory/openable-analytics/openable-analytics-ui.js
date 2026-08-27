/**
 * Openable Analytics UI
 * Character-scoped Analytics popup: Session/Lifetime toggle, single-open accordion of containers,
 * per-container Actual/Expected/Luck + Loot table, and a collapsed Manage Data section for
 * historical imports and destructive resets. One mounted shell is reused for all interactions -
 * content is rebuilt in place rather than tearing down and recreating the whole popup.
 */

import config from '../../../core/config.js';
import dataManager from '../../../core/data-manager.js';
import domObserver from '../../../core/dom-observer.js';
import { formatLargeNumber } from '../../../utils/formatters.js';
import openableAnalyticsDataCollector from './openable-analytics-data-collector.js';
import openableAnalyticsModalInjector, { formatLuckPercent, luckColor } from './openable-analytics-modal-injector.js';
import { detectImportSource, parseEdibleExport, parseCombatSuiteExport } from './openable-analytics-import-parsers.js';

const INVENTORY_FILTER_CONTAINER_CLASS = 'Inventory_itemFilterContainer';
const INVENTORY_BUTTON_CLASS = 'toolasha-openable-analytics-inventory-button';

const IMPORT_SOURCE_LABELS = {
    'import:edible': 'Edible Tools',
    'import:mwi-combat-suite': 'MWI Combat Suite',
};

function containerLabel(containerHrid) {
    const details = dataManager.getItemDetails(containerHrid);
    return details?.name || containerHrid;
}

function itemLabel(itemHrid) {
    const details = dataManager.getItemDetails(itemHrid);
    return details?.name || itemHrid;
}

/** Signed large-number formatting for Luck: explicit `+` on positive, native `-` on negative, neutral on exactly zero. */
function formatSignedLargeNumber(value) {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : '';
    return sign + formatLargeNumber(rounded);
}

function readEdibleLocalStorage() {
    try {
        return localStorage.getItem('Edible_Tools');
    } catch {
        return null;
    }
}

/**
 * Sort Loot rows: positive known value descending, then known-zero rows, then unavailable-value
 * rows, then alphabetically by display name as a tie-breaker. Uses property existence (not
 * truthiness) so a legitimate resolved value of 0 is never treated the same as "unavailable".
 */
function sortLootEntries(entries, itemValueTotals) {
    const rank = (itemHrid) => {
        if (!(itemHrid in itemValueTotals)) return 2;
        return itemValueTotals[itemHrid] > 0 ? 0 : 1;
    };
    return [...entries].sort(([hridA], [hridB]) => {
        const rankA = rank(hridA);
        const rankB = rank(hridB);
        if (rankA !== rankB) return rankA - rankB;
        if (rankA === 0) return itemValueTotals[hridB] - itemValueTotals[hridA];
        return itemLabel(hridA).localeCompare(itemLabel(hridB));
    });
}

class OpenableAnalyticsUI {
    constructor() {
        this.isInitialized = false;
        this.popupOverlay = null;
        this.popupBody = null;
        this.scope = 'lifetime';
        this.expandedContainer = null;
        this.manageDataOpen = false;
        this.pendingImport = null;
        this.mutationInFlight = false;
        this.deleteContainerError = null;
        this.deleteAllError = null;
        this.unregisterInventoryButtonObserver = null;
        this.unsubscribeStateChange = null;
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        openableAnalyticsModalInjector.initialize({
            onViewAnalytics: (containerHrid) => this.showPopup({ containerHrid }),
        });

        // Persistent entry point: the "View Analytics" link inside the Opened Loot footer only
        // exists right after opening something. This button in the Inventory panel's always-
        // rendered search bar row lets it be opened at any time. Catch up on any matching
        // container that already exists before this feature initialized (OA-RUNTIME-1), in
        // addition to watching for future mounts.
        this.unregisterInventoryButtonObserver = domObserver.onClass(
            'openableAnalyticsInventoryButton',
            INVENTORY_FILTER_CONTAINER_CLASS,
            (node) => this.injectInventoryButton(node)
        );
        document
            .querySelectorAll(`[class*="${INVENTORY_FILTER_CONTAINER_CLASS}"]`)
            .forEach((node) => this.injectInventoryButton(node));

        this.unsubscribeStateChange = openableAnalyticsDataCollector.onStateChange(() => this.refreshIfMounted());
    }

    injectInventoryButton(container) {
        // Fail closed against a stale/captured observer callback firing after cleanup() has
        // already torn down this feature's lifecycle.
        if (!this.isInitialized) return;
        if (container.querySelector(`.${INVENTORY_BUTTON_CLASS}`)) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = INVENTORY_BUTTON_CLASS;
        button.textContent = '📊';
        button.title = 'Openable Analytics';
        button.setAttribute('aria-label', 'Openable Analytics');
        button.style.cssText =
            'cursor:pointer; margin-left:8px; font-size:16px; display:inline-flex; align-items:center; background:none; border:none; padding:2px;';
        button.onclick = () => this.showPopup();

        container.appendChild(button);
    }

    /**
     * @param {Object} [options]
     * @param {string} [options.containerHrid] - When provided (View Analytics from a footer),
     *      opens Lifetime with this container expanded and scrolled into view. Without it
     *      (persistent Inventory entry point), opens Lifetime with all rows collapsed.
     */
    showPopup({ containerHrid } = {}) {
        this.scope = 'lifetime';
        this.expandedContainer =
            containerHrid && openableAnalyticsDataCollector.getKnownContainers().includes(containerHrid)
                ? containerHrid
                : null;
        this.manageDataOpen = false;
        this.pendingImport = null;

        if (!this.popupOverlay) {
            this.buildShell();
        }
        this.renderBody();

        if (this.expandedContainer) {
            const row = [...this.popupBody.querySelectorAll('[data-container-hrid]')].find(
                (el) => el.dataset.containerHrid === this.expandedContainer
            );
            row?.scrollIntoView?.({ block: 'nearest' });
        }
    }

    closePopup() {
        if (this.popupOverlay) {
            this.popupOverlay.remove();
            this.popupOverlay = null;
            this.popupBody = null;
        }
    }

    /** Refresh in-place content only while the popup is currently mounted; never opens/recreates it. */
    refreshIfMounted() {
        if (!this.popupOverlay) return;
        const scrollTop = this.popupBody.scrollTop;
        this.renderBody();
        this.popupBody.scrollTop = scrollTop;
    }

    buildShell() {
        const textColor = config.COLOR_TEXT_PRIMARY;

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
            color: ${textColor}; width: min(560px, 92vw); max-height: 85vh;
            display: flex; flex-direction: column; box-sizing: border-box; min-width: 0;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 16px 20px; border-bottom: 2px solid #3a3a3a; flex-shrink: 0;
        `;

        const titleWrap = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Openable Analytics';
        title.style.cssText = `margin: 0; color: ${textColor}; font-size: 20px;`;
        const characterName = document.createElement('div');
        characterName.style.cssText = 'font-size:12px; opacity:0.7; margin-top:2px;';
        characterName.textContent = dataManager.getCurrentCharacterName() || '';
        titleWrap.appendChild(title);
        titleWrap.appendChild(characterName);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Close');
        closeButton.style.cssText = `background: none; border: none; color: ${textColor}; font-size: 28px; cursor: pointer; padding: 0; line-height: 1;`;
        closeButton.onclick = () => this.closePopup();

        header.appendChild(titleWrap);
        header.appendChild(closeButton);
        popup.appendChild(header);

        const body = document.createElement('div');
        body.className = 'toolasha-openable-analytics-body';
        body.style.cssText = 'padding: 16px 20px; overflow-y: auto; min-width: 0;';
        popup.appendChild(body);

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        overlay.onclick = (e) => {
            if (e.target === overlay) this.closePopup();
        };

        this.popupOverlay = overlay;
        this.popupBody = body;
    }

    getContainersForScope() {
        return this.scope === 'session'
            ? openableAnalyticsDataCollector.getSessionContainers()
            : openableAnalyticsDataCollector.getKnownContainers();
    }

    getAggregate(containerHrid) {
        return this.scope === 'session'
            ? openableAnalyticsDataCollector.getSessionAggregate(containerHrid)
            : openableAnalyticsDataCollector.getLifetimeAggregate(containerHrid);
    }

    setScope(scope) {
        if (scope === this.scope) return;
        this.scope = scope;
        const stillExists = this.getContainersForScope().includes(this.expandedContainer);
        if (!stillExists) this.expandedContainer = null;
        this.renderBody();
    }

    toggleContainer(containerHrid) {
        this.expandedContainer = this.expandedContainer === containerHrid ? null : containerHrid;
        this.renderBody();
    }

    renderBody() {
        if (!this.popupBody) return;
        this.popupBody.innerHTML = '';

        this.popupBody.appendChild(this.buildScopeToggle());

        const containers = this.getContainersForScope();
        if (!this.getContainersForScope().includes(this.expandedContainer)) {
            this.expandedContainer = null;
        }

        if (containers.length === 0) {
            this.popupBody.appendChild(this.buildEmptyState());
        } else {
            this.popupBody.appendChild(this.buildAccordion(containers));
        }

        this.popupBody.appendChild(this.buildManageData());
    }

    buildScopeToggle() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; gap:6px; margin-bottom:14px;';

        for (const scope of ['session', 'lifetime']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = scope === 'session' ? 'Session' : 'Lifetime';
            const active = scope === this.scope;
            button.style.cssText = `
                flex:1; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:13px;
                border:1px solid ${active ? config.COLOR_ACCENT : '#4a4a4a'};
                background:${active ? config.COLOR_ACCENT : '#2a2a2a'};
                color:${active ? '#0a0a0a' : '#fff'};
            `;
            button.onclick = () => this.setScope(scope);
            wrapper.appendChild(button);
        }

        return wrapper;
    }

    buildEmptyState() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'opacity:0.75; padding:12px 0; font-size:13px; line-height:1.5;';

        if (this.scope === 'session') {
            wrapper.textContent = 'No tracked chest, crate, or cache openings this session.';
            return wrapper;
        }

        wrapper.innerHTML = 'No chest, crate, or cache history yet.<br>Open one to start tracking.<br>';
        const importLink = document.createElement('span');
        importLink.textContent = 'Import History';
        importLink.style.cssText = 'cursor:pointer; text-decoration:underline;';
        importLink.onclick = () => {
            this.manageDataOpen = true;
            this.renderBody();
            this.popupBody.querySelector('.toolasha-openable-analytics-manage-data')?.scrollIntoView();
        };
        wrapper.appendChild(importLink);
        return wrapper;
    }

    buildAccordion(containers) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:16px;';

        // Stable alphabetical order - never reordered by Luck/value/count/recent activity.
        const sorted = [...containers].sort((a, b) => containerLabel(a).localeCompare(containerLabel(b)));

        for (const containerHrid of sorted) {
            wrapper.appendChild(this.buildAccordionRow(containerHrid));
        }

        return wrapper;
    }

    buildAccordionRow(containerHrid) {
        const aggregate = this.getAggregate(containerHrid);
        const isOpen = this.expandedContainer === containerHrid;

        const details = document.createElement('details');
        details.dataset.containerHrid = containerHrid;
        details.open = isOpen;
        details.style.cssText = 'border-bottom:1px solid #2a2a2a; padding:6px 0;';

        const summary = document.createElement('summary');
        summary.style.cssText =
            'cursor:pointer; display:flex; align-items:center; gap:8px; list-style:none; font-size:13px;';
        summary.onclick = (e) => {
            e.preventDefault();
            this.toggleContainer(containerHrid);
        };

        const name = document.createElement('span');
        name.textContent = containerLabel(containerHrid);
        name.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

        const count = document.createElement('span');
        count.textContent = `×${aggregate.containersOpened}`;
        count.style.cssText = 'flex-shrink:0; opacity:0.8;';

        if (aggregate.hasImportedData) {
            const infoMark = document.createElement('span');
            infoMark.textContent = 'ⓘ';
            infoMark.title = 'Includes imported historical data';
            infoMark.style.cssText = `flex-shrink:0; color:${config.COLOR_INFO};`;
            count.appendChild(document.createTextNode(' '));
            count.appendChild(infoMark);
        }

        const luckEligible =
            (aggregate.valuationRecordCount || 0) > 0 &&
            aggregate.luckEligibleRecordCount === aggregate.valuationRecordCount;
        const luckValue = luckEligible ? aggregate.actualValueTotal - aggregate.expectedValueTotal : null;
        const luckPercent =
            luckEligible && aggregate.expectedValueTotal > 0 ? (luckValue / aggregate.expectedValueTotal) * 100 : null;

        const luck = document.createElement('span');
        luck.style.cssText = 'flex-shrink:0; min-width:56px; text-align:right;';
        if (!luckEligible) {
            luck.textContent = '—';
        } else if (luckPercent !== null) {
            luck.textContent = formatLuckPercent(luckPercent)
                .trim()
                .replace(/^\(|\)$/g, '');
            luck.style.color = luckColor(luckValue);
        } else {
            // Complete Expected of exactly zero: percent is meaningless, but the absolute Luck
            // value is still valid - show that instead of making the row look unavailable.
            luck.textContent = formatSignedLargeNumber(luckValue);
            luck.style.color = luckColor(luckValue);
        }

        summary.appendChild(name);
        summary.appendChild(count);
        summary.appendChild(luck);
        details.appendChild(summary);

        if (isOpen) {
            details.appendChild(this.buildExpandedDetails(containerHrid, aggregate));
        }

        return details;
    }

    buildExpandedDetails(containerHrid, aggregate) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding:10px 4px 4px 4px;';

        const luckEligible =
            (aggregate.valuationRecordCount || 0) > 0 &&
            aggregate.luckEligibleRecordCount === aggregate.valuationRecordCount;
        const luckValue = luckEligible ? aggregate.actualValueTotal - aggregate.expectedValueTotal : null;
        const luckPercent =
            luckEligible && aggregate.expectedValueTotal > 0 ? (luckValue / aggregate.expectedValueTotal) * 100 : null;

        const summaryRow = document.createElement('div');
        summaryRow.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:10px; font-size:13px;';

        const actualCol = document.createElement('div');
        actualCol.innerHTML = `<div style="opacity:0.7; font-size:11px;">Actual</div>${formatLargeNumber(aggregate.actualValueTotal)}${aggregate.actualValuePartialEvents > 0 ? ' <span title="One or more openings/imports could not be fully priced">[Partial]</span>' : ''}`;

        const expectedCol = document.createElement('div');
        const expectedHasAny = aggregate.expectedValueAvailableEvents > 0;
        expectedCol.innerHTML = `<div style="opacity:0.7; font-size:11px;">Expected</div>${expectedHasAny ? formatLargeNumber(aggregate.expectedValueTotal) : '—'}`;

        const luckCol = document.createElement('div');
        luckCol.style.textAlign = 'right';
        const luckHeader = document.createElement('div');
        luckHeader.style.cssText = 'opacity:0.7; font-size:11px;';
        const luckInfo = document.createElement('span');
        luckInfo.textContent = 'Luck ⓘ';
        luckInfo.title =
            'Luck is Actual loot value minus Expected loot value. It does not include the container/key cost and is not opening profit.';
        luckHeader.appendChild(luckInfo);
        const luckValueEl = document.createElement('div');
        if (!luckEligible) {
            luckValueEl.textContent = '—';
        } else {
            luckValueEl.textContent =
                formatSignedLargeNumber(luckValue) + (luckPercent !== null ? formatLuckPercent(luckPercent) : '');
            luckValueEl.style.color = luckColor(luckValue);
        }
        luckCol.appendChild(luckHeader);
        luckCol.appendChild(luckValueEl);

        summaryRow.appendChild(actualCol);
        summaryRow.appendChild(expectedCol);
        summaryRow.appendChild(luckCol);
        wrapper.appendChild(summaryRow);

        if (aggregate.hasImportedData) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11px; opacity:0.7; margin-bottom:10px; line-height:1.35;';
            note.textContent =
                'Includes imported historical data: imported raw counts are recalculated using current Toolasha prices/loot model at import time, and imported/live periods may overlap.';
            wrapper.appendChild(note);
        }

        wrapper.appendChild(this.buildLootTable(aggregate));

        if (this.expandedContainer) {
            const deleteRow = document.createElement('div');
            deleteRow.style.cssText = 'margin-top:10px;';
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = `Delete ${containerLabel(containerHrid)} Data…`;
            deleteButton.disabled = this.mutationInFlight;
            deleteButton.style.cssText = this.destructiveButtonStyle();
            deleteButton.onclick = () => this.handleDeleteContainer(containerHrid);
            deleteRow.appendChild(deleteButton);

            if (this.deleteContainerError?.containerHrid === containerHrid) {
                const error = document.createElement('div');
                error.style.cssText = `margin-top:6px; font-size:12px; color:${config.COLOR_WARNING};`;
                error.textContent = this.deleteContainerError.message;
                deleteRow.appendChild(error);
            }

            wrapper.appendChild(deleteRow);
        }

        return wrapper;
    }

    buildLootTable(aggregate) {
        const wrapper = document.createElement('div');

        const heading = document.createElement('div');
        heading.textContent = 'Loot';
        heading.style.cssText = 'font-weight:600; margin-bottom:6px; font-size:13px;';
        wrapper.appendChild(heading);

        const entries = Object.entries(aggregate.itemTotals || {});
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No items gained in this scope.';
            empty.style.cssText = 'opacity:0.75; font-size:12px;';
            wrapper.appendChild(empty);
            return wrapper;
        }

        const itemValueTotals = aggregate.itemValueTotals || {};
        const sorted = sortLootEntries(entries, itemValueTotals);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; font-size:12px;';

        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'opacity:0.7; text-align:left;';
        headerRow.innerHTML = `<th style="font-weight:400; padding:2px 0;">Item</th><th style="font-weight:400; text-align:right; padding:2px 0;">Qty</th><th style="font-weight:400; text-align:right; padding:2px 0;">Value <span title="Values are the amounts recorded at each opening/import, not current market value.">ⓘ</span></th>`;
        table.appendChild(headerRow);

        for (const [itemHrid, count] of sorted) {
            const row = document.createElement('tr');
            const hasValue = itemHrid in itemValueTotals;
            const valueText = hasValue ? formatLargeNumber(itemValueTotals[itemHrid]) : '—';
            row.innerHTML = `<td style="padding:2px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:0;">${itemLabel(itemHrid)}</td><td style="text-align:right; padding:2px 0;">${formatLargeNumber(count)}</td><td style="text-align:right; padding:2px 0;">${valueText}</td>`;
            table.appendChild(row);
        }

        wrapper.appendChild(table);
        return wrapper;
    }

    destructiveButtonStyle() {
        return 'background:#4a2a2a; border:1px solid #5a3a3a; color:#fff; font-size:12px; cursor:pointer; padding:6px 12px; border-radius:4px;';
    }

    buildManageData() {
        const details = document.createElement('details');
        details.className = 'toolasha-openable-analytics-manage-data';
        details.open = this.manageDataOpen;
        details.style.cssText = 'margin-top:8px; border-top:1px solid #3a3a3a; padding-top:10px;';

        const summary = document.createElement('summary');
        summary.textContent = 'Manage Data';
        summary.style.cssText = 'cursor:pointer; font-weight:600; font-size:13px; list-style:none;';
        summary.onclick = (e) => {
            e.preventDefault();
            this.manageDataOpen = !this.manageDataOpen;
            this.renderBody();
        };
        details.appendChild(summary);

        if (this.manageDataOpen) {
            const content = document.createElement('div');
            content.style.cssText = 'padding-top:10px;';
            content.appendChild(this.buildImportSourceList());
            content.appendChild(this.buildImportControls());
            content.appendChild(this.buildDeleteAllControl());
            details.appendChild(content);
        }

        return details;
    }

    buildImportSourceList() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:12px;';

        const heading = document.createElement('div');
        heading.textContent = 'Historical Imports';
        heading.style.cssText = 'font-weight:600; font-size:12px; margin-bottom:6px;';
        wrapper.appendChild(heading);

        const sources = openableAnalyticsDataCollector.getImportSourceKeys();
        if (sources.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No imported sources.';
            empty.style.cssText = 'opacity:0.7; font-size:12px;';
            wrapper.appendChild(empty);
            return wrapper;
        }

        for (const source of sources) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:4px 0;';

            const label = document.createElement('span');
            label.textContent = IMPORT_SOURCE_LABELS[source] || source;
            label.style.cssText = 'font-size:12px;';

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.textContent = 'Remove Import';
            removeButton.disabled = this.mutationInFlight;
            removeButton.style.cssText =
                'background:#3a3a3a; border:1px solid #4a4a4a; color:#fff; font-size:11px; cursor:pointer; padding:4px 8px; border-radius:4px;';
            removeButton.onclick = () => this.handleRemoveImport(source);

            row.appendChild(label);
            row.appendChild(removeButton);
            wrapper.appendChild(row);
        }

        return wrapper;
    }

    buildImportControls() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:12px; padding-top:10px; border-top:1px solid #2a2a2a;';

        const heading = document.createElement('div');
        heading.textContent = 'Import History';
        heading.style.cssText = 'font-weight:600; font-size:12px; margin-bottom:6px;';
        wrapper.appendChild(heading);

        if (this.pendingImport?.needsPlayerSelection) {
            wrapper.appendChild(this.buildEdiblePlayerPicker());
            return wrapper;
        }

        if (this.pendingImport?.preflight) {
            wrapper.appendChild(this.buildImportPreflight());
            return wrapper;
        }

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;';

        if (readEdibleLocalStorage() !== null) {
            const edibleButton = document.createElement('button');
            edibleButton.type = 'button';
            edibleButton.textContent = 'Import from Edible Tools';
            edibleButton.style.cssText = this.controlButtonStyle();
            edibleButton.onclick = () => this.beginImport(readEdibleLocalStorage(), 'edible');
            controls.appendChild(edibleButton);
        }

        const fileButtonWrap = document.createElement('div');
        fileButtonWrap.style.cssText = 'position:relative; overflow:hidden; display:inline-block;';
        const fileButton = document.createElement('button');
        fileButton.type = 'button';
        fileButton.textContent = 'Choose JSON File';
        fileButton.style.cssText = this.controlButtonStyle();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json,text/plain';
        fileInput.style.cssText = 'position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;';
        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => this.beginImport(String(reader.result || ''));
            reader.onerror = () => {
                this.pendingImport = { errorMessage: 'Could not read the selected file.' };
                this.renderBody();
            };
            reader.readAsText(file);
        };
        fileButtonWrap.appendChild(fileButton);
        fileButtonWrap.appendChild(fileInput);
        controls.appendChild(fileButtonWrap);

        const pasteLink = document.createElement('span');
        pasteLink.textContent = 'Paste JSON Instead';
        pasteLink.style.cssText = 'cursor:pointer; text-decoration:underline; font-size:12px; align-self:center;';
        pasteLink.onclick = () => {
            this.showPasteArea = true;
            this.renderBody();
        };
        wrapper.appendChild(controls);

        if (this.showPasteArea) {
            const textarea = document.createElement('textarea');
            textarea.placeholder = 'Paste exported JSON here (Edible Tools or MWI Combat Suite).';
            textarea.style.cssText =
                'width:100%; height:70px; background:#2a2a2a; color:#fff; border:1px solid #4a4a4a; border-radius:4px; padding:6px; font-size:12px; box-sizing:border-box; resize:vertical; margin-bottom:6px;';
            wrapper.appendChild(textarea);

            const submitButton = document.createElement('button');
            submitButton.type = 'button';
            submitButton.textContent = 'Preview Import';
            submitButton.style.cssText = this.controlButtonStyle();
            submitButton.onclick = () => this.beginImport(textarea.value);
            wrapper.appendChild(submitButton);
        } else {
            wrapper.appendChild(pasteLink);
        }

        if (this.pendingImport?.errorMessage) {
            const error = document.createElement('div');
            error.style.cssText = `margin-top:8px; font-size:12px; color:${config.COLOR_WARNING};`;
            error.textContent = this.pendingImport.errorMessage;
            wrapper.appendChild(error);
        }

        if (this.pendingImport?.statusMessage) {
            const status = document.createElement('div');
            status.style.cssText = 'margin-top:8px; font-size:12px; opacity:0.9;';
            status.textContent = this.pendingImport.statusMessage;
            wrapper.appendChild(status);
        }

        return wrapper;
    }

    controlButtonStyle() {
        return 'background:#3a3a3a; border:1px solid #4a4a4a; color:#fff; font-size:12px; cursor:pointer; padding:6px 10px; border-radius:4px;';
    }

    /** Parse pasted/uploaded/one-click text, auto-detecting the source unless explicitly known (Edible one-click). */
    beginImport(rawText, knownSource) {
        if (!rawText?.trim()) {
            this.pendingImport = { errorMessage: 'No data found to import.' };
            this.renderBody();
            return;
        }

        let source = knownSource;
        if (!source) {
            const detected = detectImportSource(rawText);
            if (!detected.source) {
                this.pendingImport = { errorMessage: detected.error };
                this.renderBody();
                return;
            }
            source = detected.source;
        }

        const result = source === 'edible' ? parseEdibleExport(rawText) : parseCombatSuiteExport(rawText);
        this.applyParseResult(source, rawText, result);
    }

    applyParseResult(source, rawText, result) {
        if (result.needsPlayerSelection) {
            this.pendingImport = { needsPlayerSelection: true, players: result.players, rawText, source };
            this.renderBody();
            return;
        }

        if (result.status === 'invalid') {
            this.pendingImport = { errorMessage: result.message };
            this.renderBody();
            return;
        }

        if (result.status === 'empty') {
            this.pendingImport = { statusMessage: result.message };
            this.renderBody();
            return;
        }

        const prefixedSource = `import:${source}`;
        const alreadyExists = openableAnalyticsDataCollector.getImportSourceKeys().includes(prefixedSource);
        const overlaps = this.detectOverlap(prefixedSource, result.containers);

        this.pendingImport = {
            source,
            prefixedSource,
            containers: result.containers,
            warnings: result.warnings,
            alreadyExists,
            overlaps,
            ownerMismatch: result.ownerMismatch,
            ownerName: result.ownerName,
            preflight: true,
        };
        this.renderBody();
    }

    detectOverlap(prefixedSource, containers) {
        const otherImportedHrids = new Set();
        for (const source of openableAnalyticsDataCollector.getImportSourceKeys()) {
            if (source === prefixedSource) continue;
            for (const hrid of openableAnalyticsDataCollector.getImportedContainerHrids(source)) {
                otherImportedHrids.add(hrid);
            }
        }

        return containers.some(({ containerHrid }) => {
            const hasLive = openableAnalyticsDataCollector.getLiveLifetimeAggregate(containerHrid).eventsCount > 0;
            return hasLive || otherImportedHrids.has(containerHrid);
        });
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
        for (const player of this.pendingImport.players) {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = player.name;
            select.appendChild(option);
        }
        wrapper.appendChild(select);

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.textContent = 'Continue';
        confirmButton.style.cssText = this.controlButtonStyle();
        confirmButton.onclick = () => {
            const result = parseEdibleExport(this.pendingImport.rawText, { playerId: select.value });
            this.applyParseResult('edible', this.pendingImport.rawText, result);
        };

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = this.controlButtonStyle() + 'margin-left:6px;';
        cancelButton.onclick = () => {
            this.pendingImport = null;
            this.renderBody();
        };

        wrapper.appendChild(confirmButton);
        wrapper.appendChild(cancelButton);
        return wrapper;
    }

    buildImportPreflight() {
        const { source, containers, warnings, alreadyExists, overlaps, ownerMismatch, ownerName } = this.pendingImport;
        const wrapper = document.createElement('div');

        const summary = document.createElement('div');
        const totalOpenings = containers.reduce((sum, c) => sum + c.containerCount, 0);
        summary.style.cssText = 'font-size:12px; margin-bottom:6px;';
        summary.textContent = `${IMPORT_SOURCE_LABELS[`import:${source}`]}: ${formatLargeNumber(totalOpenings)} openings across ${containers.length} container(s) ready to import.`;
        wrapper.appendChild(summary);

        if (ownerMismatch === true) {
            const warn = document.createElement('div');
            warn.style.cssText = `font-size:12px; color:${config.COLOR_WARNING}; margin-bottom:6px;`;
            warn.textContent = `This export's recorded player ("${ownerName}") does not match the current character.`;
            wrapper.appendChild(warn);
        } else if (ownerMismatch === null) {
            const warn = document.createElement('div');
            warn.style.cssText = `font-size:12px; color:${config.COLOR_WARNING}; margin-bottom:6px;`;
            warn.textContent = 'This export does not record which character it belongs to - please verify ownership.';
            wrapper.appendChild(warn);
        }

        if (overlaps) {
            const warn = document.createElement('div');
            warn.style.cssText = `font-size:12px; color:${config.COLOR_INFO}; margin-bottom:6px;`;
            warn.textContent =
                'These cumulative histories may cover the same openings and cannot be reliably deduplicated.';
            wrapper.appendChild(warn);
        }

        if (warnings?.length > 0) {
            const warn = document.createElement('div');
            warn.style.cssText = 'font-size:11px; opacity:0.75; margin-bottom:6px;';
            warn.textContent = warnings.join(' ');
            wrapper.appendChild(warn);
        }

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.textContent = this.mutationInFlight ? 'Importing…' : alreadyExists ? 'Replace Import…' : 'Import';
        confirmButton.disabled = this.mutationInFlight;
        confirmButton.style.cssText = this.controlButtonStyle();
        confirmButton.onclick = () => this.handleConfirmImport();

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.disabled = this.mutationInFlight;
        cancelButton.style.cssText = this.controlButtonStyle() + 'margin-left:6px;';
        cancelButton.onclick = () => {
            this.pendingImport = null;
            this.renderBody();
        };

        wrapper.appendChild(confirmButton);
        wrapper.appendChild(cancelButton);
        return wrapper;
    }

    async handleConfirmImport() {
        const { prefixedSource, containers, alreadyExists } = this.pendingImport;
        this.mutationInFlight = true;
        this.renderBody();

        const { persisted } = await openableAnalyticsDataCollector.importContainers(prefixedSource, containers);

        // The popup may have been closed while this awaited - never resurrect/recreate it.
        this.mutationInFlight = false;
        if (!this.popupOverlay) return;

        const totalOpenings = containers.reduce((sum, c) => sum + c.containerCount, 0);
        this.pendingImport = persisted
            ? {
                  statusMessage: `${alreadyExists ? 'Replaced' : 'Imported'} ${IMPORT_SOURCE_LABELS[prefixedSource]} import: ${formatLargeNumber(totalOpenings)} openings across ${containers.length} container(s).`,
              }
            : { errorMessage: 'Could not save Openable Analytics data. Current changes may not persist after reload.' };
        this.showPasteArea = false;
        this.renderBody();
    }

    async handleRemoveImport(source) {
        this.mutationInFlight = true;
        this.renderBody();

        const persisted = await openableAnalyticsDataCollector.removeImport(source);

        this.mutationInFlight = false;
        if (!this.popupOverlay) return;

        if (!persisted) {
            this.pendingImport = { errorMessage: 'Could not remove the imported data. It may reappear after reload.' };
        } else {
            this.pendingImport = {
                statusMessage: `Removed ${IMPORT_SOURCE_LABELS[source]} import. Live Toolasha history was kept.`,
            };
        }
        this.renderBody();
    }

    async handleDeleteContainer(containerHrid) {
        if (
            !confirm(
                `Delete all Openable Analytics data for ${containerLabel(containerHrid)} on this character? This cannot be undone.`
            )
        ) {
            return;
        }

        this.mutationInFlight = true;
        this.deleteContainerError = null;
        this.renderBody();

        const persisted = await openableAnalyticsDataCollector.resetContainer(containerHrid);

        this.mutationInFlight = false;
        if (!this.popupOverlay) return;
        this.deleteContainerError = persisted
            ? null
            : { containerHrid, message: 'Could not save this deletion. It may reappear after reload.' };
        this.renderBody();
    }

    buildDeleteAllControl() {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding-top:10px; border-top:1px solid #2a2a2a;';

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Delete All Analytics Data…';
        button.disabled = this.mutationInFlight;
        button.style.cssText = this.destructiveButtonStyle();
        button.onclick = () => this.handleDeleteAll();

        wrapper.appendChild(button);

        if (this.deleteAllError) {
            const error = document.createElement('div');
            error.style.cssText = `margin-top:6px; font-size:12px; color:${config.COLOR_WARNING};`;
            error.textContent = this.deleteAllError;
            wrapper.appendChild(error);
        }

        return wrapper;
    }

    async handleDeleteAll() {
        const characterName = dataManager.getCurrentCharacterName() || 'this character';
        if (!confirm(`Delete ALL Openable Analytics data for ${characterName}? This cannot be undone.`)) {
            return;
        }

        this.mutationInFlight = true;
        this.deleteAllError = null;
        this.renderBody();

        const persisted = await openableAnalyticsDataCollector.resetAll();

        this.mutationInFlight = false;
        if (!this.popupOverlay) return;
        this.deleteAllError = persisted ? null : 'Could not save this deletion. It may reappear after reload.';
        // Delete All does not silently close the popup - show the resulting empty state in place.
        this.renderBody();
    }

    cleanup() {
        this.closePopup();
        openableAnalyticsModalInjector.cleanup();
        document.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`).forEach((button) => button.remove());
        if (this.unregisterInventoryButtonObserver) {
            this.unregisterInventoryButtonObserver();
            this.unregisterInventoryButtonObserver = null;
        }
        if (this.unsubscribeStateChange) {
            this.unsubscribeStateChange();
            this.unsubscribeStateChange = null;
        }
        this.isInitialized = false;
        this.showPasteArea = false;
        this.deleteContainerError = null;
        this.deleteAllError = null;
    }
}

const openableAnalyticsUI = new OpenableAnalyticsUI();

export default openableAnalyticsUI;
export { INVENTORY_FILTER_CONTAINER_CLASS, INVENTORY_BUTTON_CLASS };
