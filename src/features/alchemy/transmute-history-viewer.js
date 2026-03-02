/**
 * Transmute History Viewer
 * Modal UI for browsing transmute session history.
 * Injected as a tab in the alchemy panel tab bar.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { transmuteHistoryTracker } from './transmute-history-tracker.js';
import { formatKMB } from '../../utils/formatters.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class TransmuteHistoryViewer {
    constructor() {
        this.isInitialized = false;
        this.modal = null;
        this.sessions = [];
        this.filteredSessions = [];
        this.currentPage = 1;
        this.rowsPerPage = 50;
        this.showAll = false;
        this.sortColumn = 'startTime';
        this.sortDirection = 'desc';

        // Column filters
        this.filters = {
            dateFrom: null,
            dateTo: null,
            selectedInputItems: [], // Array of itemHrids
            resultsSearch: '', // Text search for result item names
        };

        this.activeFilterPopup = null;
        this.activeFilterButton = null;
        this.popupCloseHandler = null;

        // Tab injection
        this.alchemyTab = null;
        this.tabWatcher = null;

        // Caches
        this.itemNameCache = new Map();
        this.itemsSpriteUrl = null;
        this.cachedDateRange = null;

        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize the viewer
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('alchemy_transmuteHistory')) {
            return;
        }

        this.isInitialized = true;
        this.addAlchemyTab();
    }

    /**
     * Disable the viewer
     */
    disable() {
        if (this.tabWatcher) {
            this.tabWatcher();
            this.tabWatcher = null;
        }
        if (this.alchemyTab && this.alchemyTab.parentNode) {
            this.alchemyTab.remove();
            this.alchemyTab = null;
        }
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        this.timerRegistry.clearAll();
        this.isInitialized = false;
    }

    // ─── Tab Injection ───────────────────────────────────────────────────────

    /**
     * Inject "Transmute History" tab into the alchemy tab bar.
     * The alchemy tab bar contains Coinify, Decompose, Transmute, Unrefine, Current Action.
     * We identify it by the presence of a "Transmute" tab text.
     */
    addAlchemyTab() {
        const ensureTabExists = () => {
            const tablist = document.querySelector('[role="tablist"]');
            if (!tablist) return;

            // Verify this is the alchemy tablist by checking for "Transmute" tab
            const hasTransmute = Array.from(tablist.children).some(
                (btn) => btn.textContent.includes('Transmute') && !btn.dataset.mwiTransmuteHistoryTab
            );
            if (!hasTransmute) return;

            // Already injected?
            if (tablist.querySelector('[data-mwi-transmute-history-tab="true"]')) return;

            // Clone an existing tab for structure
            const referenceTab = Array.from(tablist.children).find(
                (btn) => btn.textContent.includes('Transmute') && !btn.dataset.mwiTransmuteHistoryTab
            );
            if (!referenceTab) return;

            const tab = referenceTab.cloneNode(true);
            tab.setAttribute('data-mwi-transmute-history-tab', 'true');
            tab.classList.remove('Mui-selected');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');

            // Set label
            const badge = tab.querySelector('.TabsComponent_badge__1Du26');
            if (badge) {
                // Replace first text node (the label) while keeping badge span
                const badgeSpan = badge.querySelector('.MuiBadge-badge');
                badge.textContent = '';
                badge.appendChild(document.createTextNode('Transmute History'));
                if (badgeSpan) badge.appendChild(badgeSpan);
            } else {
                tab.textContent = 'Transmute History';
            }

            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openModal();
            });

            tablist.appendChild(tab);
            this.alchemyTab = tab;
        };

        // Watch for DOM changes that recreate the tablist
        if (!this.tabWatcher) {
            this.tabWatcher = createMutationWatcher(
                document.body,
                () => {
                    // If our tab was removed from DOM, clear reference
                    if (this.alchemyTab && !document.body.contains(this.alchemyTab)) {
                        this.alchemyTab = null;
                    }
                    ensureTabExists();
                },
                { childList: true, subtree: true }
            );
        }

        ensureTabExists();
    }

    // ─── Modal ───────────────────────────────────────────────────────────────

    /**
     * Open the modal — load sessions and render
     */
    async openModal() {
        this.sessions = await transmuteHistoryTracker.loadSessions();
        this.cachedDateRange = null;
        this.applyFilters();

        if (!this.modal) {
            this.createModal();
        }

        this.modal.style.display = 'flex';
        this.renderTable();
    }

    /**
     * Close the modal
     */
    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
        this.closeActiveFilterPopup();
    }

    /**
     * Create modal DOM structure
     */
    createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'mwi-transmute-history-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        const content = document.createElement('div');
        content.className = 'mwi-transmute-history-content';
        content.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            width: fit-content;
            min-width: 500px;
            max-width: 95vw;
            max-height: 90%;
            overflow: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Transmute History';
        title.style.cssText = 'margin: 0; color: #fff;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none; border: none; color: #fff;
            font-size: 24px; cursor: pointer; padding: 0;
            width: 30px; height: 30px;
        `;
        closeBtn.addEventListener('click', () => this.closeModal());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'mwi-transmute-history-controls';
        controls.style.cssText = `
            display: flex;
            gap: 10px;
            margin-bottom: 8px;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
        `;

        // Active filter badges row
        const badges = document.createElement('div');
        badges.className = 'mwi-transmute-history-badges';
        badges.style.cssText = `
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
            min-height: 28px;
            margin-bottom: 10px;
        `;

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'mwi-transmute-history-table-container';
        tableContainer.style.cssText = 'overflow-x: auto;';

        // Pagination
        const pagination = document.createElement('div');
        pagination.className = 'mwi-transmute-history-pagination';
        pagination.style.cssText = `
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        content.appendChild(header);
        content.appendChild(controls);
        content.appendChild(badges);
        content.appendChild(tableContainer);
        content.appendChild(pagination);
        this.modal.appendChild(content);
        document.body.appendChild(this.modal);

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });
    }

    // ─── Filtering ───────────────────────────────────────────────────────────

    /**
     * Apply all active filters to this.sessions → this.filteredSessions
     */
    applyFilters() {
        this.cachedDateRange = null;

        const hasDateFilter = !!(this.filters.dateFrom || this.filters.dateTo);
        let dateToEndOfDay = null;
        if (hasDateFilter && this.filters.dateTo) {
            dateToEndOfDay = new Date(this.filters.dateTo);
            dateToEndOfDay.setHours(23, 59, 59, 999);
        }

        const hasItemFilter = this.filters.selectedInputItems.length > 0;
        const itemFilterSet = hasItemFilter ? new Set(this.filters.selectedInputItems) : null;

        const hasResultsFilter = !!this.filters.resultsSearch.trim();
        const resultsSearch = hasResultsFilter ? this.filters.resultsSearch.trim().toLowerCase() : '';

        const filtered = this.sessions.filter((session) => {
            // Date filter
            if (hasDateFilter) {
                const d = new Date(session.startTime);
                if (this.filters.dateFrom && d < this.filters.dateFrom) return false;
                if (dateToEndOfDay && d > dateToEndOfDay) return false;
            }

            // Input item filter
            if (hasItemFilter && !itemFilterSet.has(session.inputItemHrid)) return false;

            // Results text search
            if (hasResultsFilter) {
                const resultNames = Object.keys(session.results || {}).map((hrid) =>
                    this.getItemName(hrid).toLowerCase()
                );
                if (!resultNames.some((name) => name.includes(resultsSearch))) return false;
            }

            return true;
        });

        // Sort
        filtered.sort((a, b) => {
            const aVal = a[this.sortColumn] ?? 0;
            const bVal = b[this.sortColumn] ?? 0;
            return this.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });

        this.filteredSessions = filtered;
        this.currentPage = 1;
    }

    /**
     * Check if a column has an active filter
     * @param {string} col
     * @returns {boolean}
     */
    hasActiveFilter(col) {
        switch (col) {
            case 'startTime':
                return !!(this.filters.dateFrom || this.filters.dateTo);
            case 'inputItemHrid':
                return this.filters.selectedInputItems.length > 0;
            case 'results':
                return !!this.filters.resultsSearch.trim();
            default:
                return false;
        }
    }

    /**
     * Returns true if any filter is active
     */
    hasAnyFilter() {
        return (
            this.hasActiveFilter('startTime') ||
            this.hasActiveFilter('inputItemHrid') ||
            this.hasActiveFilter('results')
        );
    }

    /**
     * Clear all filters
     */
    clearAllFilters() {
        this.filters.dateFrom = null;
        this.filters.dateTo = null;
        this.filters.selectedInputItems = [];
        this.filters.resultsSearch = '';
        this.applyFilters();
        this.renderTable();
    }

    // ─── Rendering ───────────────────────────────────────────────────────────

    /**
     * Full render: controls + badges + table + pagination
     */
    renderTable() {
        this.renderControls();
        this.renderBadges();

        const tableContainer = this.modal.querySelector('.mwi-transmute-history-table-container');
        while (tableContainer.firstChild) tableContainer.removeChild(tableContainer.firstChild);

        const table = document.createElement('table');
        table.style.cssText = 'width: max-content; border-collapse: collapse; color: #fff; white-space: nowrap;';

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.background = '#1a1a1a';

        const columns = [
            { key: 'startTime', label: 'Session Start', filterable: true },
            { key: 'inputItemHrid', label: 'Input Item', filterable: true },
            { key: 'totalAttempts', label: 'Attempts', filterable: false },
            { key: 'totalSuccesses', label: 'Successes', filterable: false },
            { key: 'results', label: 'Results', filterable: true },
            { key: '_delete', label: '', filterable: false },
        ];

        columns.forEach((col) => {
            const th = document.createElement('th');
            th.style.cssText = `
                padding: 10px;
                text-align: left;
                border-bottom: 2px solid #555;
                user-select: none;
                white-space: nowrap;
            `;

            const headerContent = document.createElement('div');
            headerContent.style.cssText = 'display: flex; align-items: center; gap: 8px;';

            const labelSpan = document.createElement('span');
            labelSpan.style.cursor = 'pointer';

            const isSortable = col.key !== 'results';
            if (isSortable) {
                if (this.sortColumn === col.key) {
                    labelSpan.textContent = col.label + (this.sortDirection === 'asc' ? ' ▲' : ' ▼');
                } else {
                    labelSpan.textContent = col.label;
                }
                labelSpan.addEventListener('click', () => {
                    if (this.sortColumn === col.key) {
                        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.sortColumn = col.key;
                        this.sortDirection = 'desc';
                    }
                    this.applyFilters();
                    this.renderTable();
                });
            } else {
                labelSpan.textContent = col.label;
                labelSpan.style.cursor = 'default';
            }

            headerContent.appendChild(labelSpan);

            if (col.filterable) {
                const filterBtn = document.createElement('button');
                filterBtn.textContent = '⋮';
                filterBtn.style.cssText = `
                    background: none; border: none;
                    color: ${this.hasActiveFilter(col.key) ? '#4a90e2' : '#aaa'};
                    cursor: pointer; font-size: 16px;
                    padding: 2px 4px; font-weight: bold;
                `;
                filterBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showFilterPopup(col.key, filterBtn);
                });
                headerContent.appendChild(filterBtn);
            }

            th.appendChild(headerContent);
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        const paginated = this.getPaginatedSessions();

        if (paginated.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = columns.length;
            cell.textContent =
                this.sessions.length === 0
                    ? 'No transmute history recorded yet.'
                    : 'No sessions match the current filters.';
            cell.style.cssText = 'padding: 20px; text-align: center; color: #888;';
            row.appendChild(cell);
            tbody.appendChild(row);
        } else {
            paginated.forEach((session, index) => {
                const row = document.createElement('tr');
                row.style.cssText = `
                    border-bottom: 1px solid #333;
                    background: ${index % 2 === 0 ? '#2a2a2a' : '#252525'};
                `;

                // Session Start
                const dateCell = document.createElement('td');
                dateCell.textContent = new Date(session.startTime).toLocaleString();
                dateCell.style.padding = '6px 10px';
                row.appendChild(dateCell);

                // Input Item
                const inputCell = document.createElement('td');
                inputCell.style.cssText = 'padding: 6px 10px; display: flex; align-items: center; gap: 8px;';
                this.appendItemIcon(inputCell, session.inputItemHrid, 20);
                const inputName = document.createElement('span');
                inputName.textContent = this.getItemName(session.inputItemHrid);
                inputCell.appendChild(inputName);
                row.appendChild(inputCell);

                // Attempts
                const attemptsCell = document.createElement('td');
                attemptsCell.textContent = session.totalAttempts;
                attemptsCell.style.padding = '6px 10px';
                row.appendChild(attemptsCell);

                // Successes
                const successCell = document.createElement('td');
                const failures = session.totalAttempts - session.totalSuccesses;
                successCell.textContent = `${session.totalSuccesses} (${failures} failed)`;
                successCell.style.cssText = `
                    padding: 6px 10px;
                    color: ${failures > 0 ? '#fbbf24' : '#4ade80'};
                `;
                row.appendChild(successCell);

                // Results
                const resultsCell = document.createElement('td');
                resultsCell.style.cssText = 'padding: 6px 10px;';
                this.renderResultsCell(resultsCell, session);
                row.appendChild(resultsCell);

                // Delete
                const deleteCell = document.createElement('td');
                deleteCell.style.cssText = 'padding: 6px 4px; text-align: center;';
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '✕';
                deleteBtn.title = 'Delete this session';
                deleteBtn.style.cssText = `
                    background: none; border: none; color: #dc2626;
                    cursor: pointer; font-size: 14px; padding: 2px 6px;
                    border-radius: 3px; line-height: 1;
                `;
                deleteBtn.addEventListener('mouseenter', () => {
                    deleteBtn.style.background = 'rgba(220,38,38,0.15)';
                });
                deleteBtn.addEventListener('mouseleave', () => {
                    deleteBtn.style.background = 'none';
                });
                deleteBtn.addEventListener('click', () => this.deleteSession(session.id));
                deleteCell.appendChild(deleteBtn);
                row.appendChild(deleteCell);

                tbody.appendChild(row);
            });
        }

        table.appendChild(tbody);
        tableContainer.appendChild(table);
        this.renderPagination();
    }

    /**
     * Render the results cell for a session
     * Results sorted by totalValue desc, self-returns last
     * @param {HTMLElement} cell
     * @param {Object} session
     */
    renderResultsCell(cell, session) {
        const results = session.results || {};
        const entries = Object.entries(results);

        if (entries.length === 0) {
            const span = document.createElement('span');
            span.textContent = '—';
            span.style.color = '#888';
            cell.appendChild(span);
            return;
        }

        // Sort: non-self-returns by totalValue desc, self-returns last
        // Exclude incidental drops (essences, artisan's crates) recorded in older sessions
        const filteredEntries = entries.sort(([, a], [, b]) => {
            if (a.isSelfReturn && !b.isSelfReturn) return 1;
            if (!a.isSelfReturn && b.isSelfReturn) return -1;
            return (b.totalValue || 0) - (a.totalValue || 0);
        });

        filteredEntries.forEach(([itemHrid, result]) => {
            const line = document.createElement('div');
            line.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 2px;';

            this.appendItemIcon(line, itemHrid, 16);

            const text = document.createElement('span');
            const name = this.getItemName(itemHrid);

            if (result.isSelfReturn) {
                text.textContent = `${name} x${result.count} (self-return)`;
                text.style.color = '#888';
            } else {
                const total = formatKMB(result.totalValue || 0, 1);
                const each = formatKMB(result.priceEach || 0, 1);
                text.textContent = `${name} x${result.count} = ${total} (${each} each)`;
            }

            line.appendChild(text);
            cell.appendChild(line);
        });
    }

    /**
     * Render controls bar (stats + clear history button)
     */
    renderControls() {
        const controls = this.modal.querySelector('.mwi-transmute-history-controls');
        while (controls.firstChild) controls.removeChild(controls.firstChild);

        // Stats
        const stats = document.createElement('span');
        stats.style.cssText = 'color: #aaa; font-size: 14px;';
        stats.textContent = `${this.filteredSessions.length} session${this.filteredSessions.length !== 1 ? 's' : ''}`;
        controls.appendChild(stats);

        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        // Clear All Filters button (only when filters active)
        if (this.hasAnyFilter()) {
            const clearFiltersBtn = document.createElement('button');
            clearFiltersBtn.textContent = 'Clear All Filters';
            clearFiltersBtn.style.cssText = `
                padding: 6px 12px; background: #e67e22; color: white;
                border: none; border-radius: 4px; cursor: pointer;
            `;
            clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());
            rightGroup.appendChild(clearFiltersBtn);
        }

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export';
        exportBtn.style.cssText = `
            padding: 6px 12px; background: #2563eb; color: white;
            border: none; border-radius: 4px; cursor: pointer;
        `;
        exportBtn.addEventListener('click', () => this.exportHistory());
        rightGroup.appendChild(exportBtn);

        // Clear History button
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear History';
        clearBtn.style.cssText = `
            padding: 6px 12px; background: #dc2626; color: white;
            border: none; border-radius: 4px; cursor: pointer;
        `;
        clearBtn.addEventListener('click', () => this.clearHistory());
        rightGroup.appendChild(clearBtn);

        controls.appendChild(rightGroup);
    }

    /**
     * Render active filter badges
     */
    renderBadges() {
        const container = this.modal.querySelector('.mwi-transmute-history-badges');
        while (container.firstChild) container.removeChild(container.firstChild);

        const badges = [];

        if (this.filters.dateFrom || this.filters.dateTo) {
            const parts = [];
            if (this.filters.dateFrom) parts.push(this.filters.dateFrom.toLocaleDateString());
            if (this.filters.dateTo) parts.push(this.filters.dateTo.toLocaleDateString());
            badges.push({
                label: `Date: ${parts.join(' - ')}`,
                onRemove: () => {
                    this.filters.dateFrom = null;
                    this.filters.dateTo = null;
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        if (this.filters.selectedInputItems.length > 0) {
            const label =
                this.filters.selectedInputItems.length === 1
                    ? this.getItemName(this.filters.selectedInputItems[0])
                    : `${this.filters.selectedInputItems.length} input items`;
            badges.push({
                label: `Input: ${label}`,
                icon: this.filters.selectedInputItems[0],
                onRemove: () => {
                    this.filters.selectedInputItems = [];
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        if (this.filters.resultsSearch.trim()) {
            badges.push({
                label: `Results: "${this.filters.resultsSearch.trim()}"`,
                onRemove: () => {
                    this.filters.resultsSearch = '';
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        badges.forEach((badge) => {
            const el = document.createElement('div');
            el.style.cssText = `
                display: flex; align-items: center; gap: 6px;
                padding: 4px 8px; background: #3a3a3a;
                border: 1px solid #555; border-radius: 4px;
                color: #aaa; font-size: 13px;
            `;

            if (badge.icon) {
                this.appendItemIcon(el, badge.icon, 14);
            }

            const labelSpan = document.createElement('span');
            labelSpan.textContent = badge.label;
            el.appendChild(labelSpan);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '✕';
            removeBtn.style.cssText = `
                background: none; border: none; color: #aaa;
                cursor: pointer; padding: 0; font-size: 13px; line-height: 1;
            `;
            removeBtn.addEventListener('click', badge.onRemove);
            el.appendChild(removeBtn);

            container.appendChild(el);
        });
    }

    /**
     * Render pagination controls
     */
    renderPagination() {
        const pagination = this.modal.querySelector('.mwi-transmute-history-pagination');
        while (pagination.firstChild) pagination.removeChild(pagination.firstChild);

        const leftSide = document.createElement('div');
        leftSide.style.cssText = 'display: flex; gap: 8px; align-items: center; color: #aaa;';

        const label = document.createElement('span');
        label.textContent = 'Rows per page:';

        const rowsInput = document.createElement('input');
        rowsInput.type = 'number';
        rowsInput.value = this.rowsPerPage;
        rowsInput.min = '1';
        rowsInput.disabled = this.showAll;
        rowsInput.style.cssText = `
            width: 60px; padding: 4px 8px;
            border: 1px solid #555; border-radius: 4px;
            background: ${this.showAll ? '#333' : '#1a1a1a'};
            color: ${this.showAll ? '#666' : '#fff'};
        `;
        rowsInput.addEventListener('change', (e) => {
            this.rowsPerPage = Math.max(1, parseInt(e.target.value) || 50);
            this.currentPage = 1;
            this.renderTable();
        });

        const showAllLabel = document.createElement('label');
        showAllLabel.style.cssText = 'cursor: pointer; color: #aaa; display: flex; align-items: center; gap: 4px;';

        const showAllCheckbox = document.createElement('input');
        showAllCheckbox.type = 'checkbox';
        showAllCheckbox.checked = this.showAll;
        showAllCheckbox.style.cursor = 'pointer';
        showAllCheckbox.addEventListener('change', (e) => {
            this.showAll = e.target.checked;
            rowsInput.disabled = this.showAll;
            rowsInput.style.background = this.showAll ? '#333' : '#1a1a1a';
            rowsInput.style.color = this.showAll ? '#666' : '#fff';
            this.currentPage = 1;
            this.renderTable();
        });

        showAllLabel.appendChild(showAllCheckbox);
        showAllLabel.appendChild(document.createTextNode('Show All'));

        leftSide.appendChild(label);
        leftSide.appendChild(rowsInput);
        leftSide.appendChild(showAllLabel);

        const rightSide = document.createElement('div');
        rightSide.style.cssText = 'display: flex; gap: 8px; align-items: center; color: #aaa;';

        if (!this.showAll) {
            const totalPages = this.getTotalPages();

            const prevBtn = document.createElement('button');
            prevBtn.textContent = '◀';
            prevBtn.disabled = this.currentPage === 1;
            prevBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage === 1 ? '#333' : '#4a90e2'};
                color: ${this.currentPage === 1 ? '#666' : 'white'};
                border: none; border-radius: 4px;
                cursor: ${this.currentPage === 1 ? 'default' : 'pointer'};
            `;
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.renderTable();
                }
            });

            const pageInfo = document.createElement('span');
            pageInfo.textContent = `Page ${this.currentPage} of ${totalPages || 1}`;

            const nextBtn = document.createElement('button');
            nextBtn.textContent = '▶';
            nextBtn.disabled = this.currentPage >= totalPages;
            nextBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage >= totalPages ? '#333' : '#4a90e2'};
                color: ${this.currentPage >= totalPages ? '#666' : 'white'};
                border: none; border-radius: 4px;
                cursor: ${this.currentPage >= totalPages ? 'default' : 'pointer'};
            `;
            nextBtn.addEventListener('click', () => {
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.renderTable();
                }
            });

            rightSide.appendChild(prevBtn);
            rightSide.appendChild(pageInfo);
            rightSide.appendChild(nextBtn);
        } else {
            const info = document.createElement('span');
            info.textContent = `Showing all ${this.filteredSessions.length} sessions`;
            rightSide.appendChild(info);
        }

        pagination.appendChild(leftSide);
        pagination.appendChild(rightSide);
    }

    // ─── Filter Popups ───────────────────────────────────────────────────────

    /**
     * Show the appropriate filter popup for a column
     * @param {string} columnKey
     * @param {HTMLElement} buttonElement
     */
    showFilterPopup(columnKey, buttonElement) {
        // Toggle behavior
        if (this.activeFilterPopup && this.activeFilterButton === buttonElement) {
            this.closeActiveFilterPopup();
            return;
        }

        this.closeActiveFilterPopup();

        let popup;
        switch (columnKey) {
            case 'startTime':
                popup = this.createDateFilterPopup();
                break;
            case 'inputItemHrid':
                popup = this.createInputItemFilterPopup();
                break;
            case 'results':
                popup = this.createResultsFilterPopup();
                break;
            default:
                return;
        }

        const rect = buttonElement.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.top = `${rect.bottom + 5}px`;
        popup.style.left = `${rect.left}px`;
        popup.style.zIndex = '10002';

        document.body.appendChild(popup);
        this.activeFilterPopup = popup;
        this.activeFilterButton = buttonElement;

        this.popupCloseHandler = (e) => {
            if (e.target.type === 'date' || e.target.closest?.('input[type="date"]')) return;
            if (!popup.contains(e.target) && e.target !== buttonElement) {
                this.closeActiveFilterPopup();
            }
        };
        const t = setTimeout(() => document.addEventListener('click', this.popupCloseHandler), 10);
        this.timerRegistry.registerTimeout(t);
    }

    /**
     * Close and clean up the active filter popup
     */
    closeActiveFilterPopup() {
        if (this.activeFilterPopup) {
            this.activeFilterPopup.remove();
            this.activeFilterPopup = null;
        }
        if (this.popupCloseHandler) {
            document.removeEventListener('click', this.popupCloseHandler);
            this.popupCloseHandler = null;
        }
        this.activeFilterButton = null;
    }

    /**
     * Create date range filter popup
     * @returns {HTMLElement}
     */
    createDateFilterPopup() {
        const popup = this.createPopupBase('Filter by Date');

        // Compute available range
        if (!this.cachedDateRange) {
            const timestamps = this.sessions.map((s) => s.startTime).filter(Boolean);
            if (timestamps.length > 0) {
                this.cachedDateRange = {
                    minDate: new Date(Math.min(...timestamps)),
                    maxDate: new Date(Math.max(...timestamps)),
                };
            } else {
                this.cachedDateRange = { minDate: null, maxDate: null };
            }
        }

        const { minDate, maxDate } = this.cachedDateRange;

        if (minDate && maxDate) {
            const rangeInfo = document.createElement('div');
            rangeInfo.style.cssText = `
                color: #aaa; font-size: 11px; margin-bottom: 10px;
                padding: 6px; background: #1a1a1a; border-radius: 3px;
            `;
            rangeInfo.textContent = `Available: ${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
            popup.appendChild(rangeInfo);
        }

        const fromInput = this.createDateInput(
            'From:',
            this.filters.dateFrom ? this.filters.dateFrom.toISOString().split('T')[0] : '',
            minDate,
            maxDate
        );
        const toInput = this.createDateInput(
            'To:',
            this.filters.dateTo ? this.filters.dateTo.toISOString().split('T')[0] : '',
            minDate,
            maxDate
        );

        popup.appendChild(fromInput.label);
        popup.appendChild(fromInput.input);
        popup.appendChild(toInput.label);
        popup.appendChild(toInput.input);

        const btnRow = this.createPopupButtonRow(
            () => {
                this.filters.dateFrom = fromInput.input.value ? new Date(fromInput.input.value) : null;
                this.filters.dateTo = toInput.input.value ? new Date(toInput.input.value) : null;
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                this.filters.dateFrom = null;
                this.filters.dateTo = null;
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            }
        );
        popup.appendChild(btnRow);

        return popup;
    }

    /**
     * Create input item filter popup (checkbox list with search)
     * @returns {HTMLElement}
     */
    createInputItemFilterPopup() {
        const popup = this.createPopupBase('Filter by Input Item');
        popup.style.minWidth = '220px';

        // Gather unique input items from all sessions
        const itemSet = new Map();
        this.sessions.forEach((s) => {
            if (!itemSet.has(s.inputItemHrid)) {
                itemSet.set(s.inputItemHrid, this.getItemName(s.inputItemHrid));
            }
        });
        const allItems = Array.from(itemSet.entries()).sort((a, b) => a[1].localeCompare(b[1]));

        // Track pending selection (local to this popup)
        const pending = new Set(this.filters.selectedInputItems);

        // Search box
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search items...';
        searchInput.style.cssText = `
            width: 100%; padding: 6px; margin-bottom: 8px;
            background: #1a1a1a; border: 1px solid #555;
            border-radius: 3px; color: #fff; box-sizing: border-box;
        `;

        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'max-height: 200px; overflow-y: auto;';

        const renderList = (filterText) => {
            while (listContainer.firstChild) listContainer.removeChild(listContainer.firstChild);
            const term = filterText.toLowerCase();
            const visible = term ? allItems.filter(([, name]) => name.toLowerCase().includes(term)) : allItems;

            visible.forEach(([hrid, name]) => {
                const row = document.createElement('label');
                row.style.cssText = `
                    display: flex; align-items: center; gap: 8px;
                    padding: 4px 2px; cursor: pointer; color: #ddd;
                `;

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = pending.has(hrid);
                cb.style.cursor = 'pointer';
                cb.addEventListener('change', () => {
                    if (cb.checked) pending.add(hrid);
                    else pending.delete(hrid);
                });

                this.appendItemIcon(row, hrid, 16);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;

                row.appendChild(cb);
                row.appendChild(nameSpan);
                listContainer.appendChild(row);
            });
        };

        searchInput.addEventListener('input', () => renderList(searchInput.value));
        renderList('');

        popup.appendChild(searchInput);
        popup.appendChild(listContainer);

        const btnRow = this.createPopupButtonRow(
            () => {
                this.filters.selectedInputItems = Array.from(pending);
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                this.filters.selectedInputItems = [];
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            }
        );
        popup.appendChild(btnRow);

        return popup;
    }

    /**
     * Create results text search popup
     * @returns {HTMLElement}
     */
    createResultsFilterPopup() {
        const popup = this.createPopupBase('Filter by Result Item');
        popup.style.minWidth = '220px';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Item name...';
        searchInput.value = this.filters.resultsSearch;
        searchInput.style.cssText = `
            width: 100%; padding: 6px; margin-bottom: 10px;
            background: #1a1a1a; border: 1px solid #555;
            border-radius: 3px; color: #fff; box-sizing: border-box;
        `;

        popup.appendChild(searchInput);

        const btnRow = this.createPopupButtonRow(
            () => {
                this.filters.resultsSearch = searchInput.value;
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                this.filters.resultsSearch = '';
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            }
        );
        popup.appendChild(btnRow);

        return popup;
    }

    // ─── Popup Helpers ───────────────────────────────────────────────────────

    /**
     * Create a styled popup base div with a title
     * @param {string} titleText
     * @returns {HTMLElement}
     */
    createPopupBase(titleText) {
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a; border: 1px solid #555;
            border-radius: 4px; padding: 12px; min-width: 200px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;

        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.cssText = 'color: #fff; font-weight: bold; margin-bottom: 10px;';
        popup.appendChild(title);

        return popup;
    }

    /**
     * Create a date input with label
     * @param {string} labelText
     * @param {string} value
     * @param {Date|null} minDate
     * @param {Date|null} maxDate
     * @returns {{ label: HTMLElement, input: HTMLInputElement }}
     */
    createDateInput(labelText, value, minDate, maxDate) {
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.cssText = 'display: block; color: #aaa; margin-bottom: 4px; font-size: 12px;';

        const input = document.createElement('input');
        input.type = 'date';
        input.value = value;
        if (minDate) input.min = minDate.toISOString().split('T')[0];
        if (maxDate) input.max = maxDate.toISOString().split('T')[0];
        input.style.cssText = `
            width: 100%; padding: 6px; background: #1a1a1a;
            border: 1px solid #555; border-radius: 3px; color: #fff; margin-bottom: 10px;
        `;

        return { label, input };
    }

    /**
     * Create Apply + Clear button row for filter popups
     * @param {Function} onApply
     * @param {Function} onClear
     * @returns {HTMLElement}
     */
    createPopupButtonRow(onApply, onClear) {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 8px; margin-top: 10px;';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1; padding: 6px; background: #4a90e2; color: white;
            border: none; border-radius: 3px; cursor: pointer;
        `;
        applyBtn.addEventListener('click', onApply);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1; padding: 6px; background: #666; color: white;
            border: none; border-radius: 3px; cursor: pointer;
        `;
        clearBtn.addEventListener('click', onClear);

        row.appendChild(applyBtn);
        row.appendChild(clearBtn);
        return row;
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    /**
     * Append a 16×16 or 20×20 SVG item icon to an element
     * @param {HTMLElement} parent
     * @param {string} itemHrid
     * @param {number} size
     */
    appendItemIcon(parent, itemHrid, size = 20) {
        const spriteUrl = this.getItemsSpriteUrl();
        if (!spriteUrl) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.style.flexShrink = '0';

        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `${spriteUrl}#${itemHrid.split('/').pop()}`);
        svg.appendChild(use);
        parent.appendChild(svg);
    }

    /**
     * Get items sprite URL from DOM (cached)
     * @returns {string|null}
     */
    getItemsSpriteUrl() {
        if (!this.itemsSpriteUrl) {
            const el = document.querySelector('use[href*="items_sprite"]');
            if (el) {
                const href = el.getAttribute('href');
                this.itemsSpriteUrl = href ? href.split('#')[0] : null;
            }
        }
        return this.itemsSpriteUrl;
    }

    /**
     * Get item display name from HRID (cached)
     * @param {string} itemHrid
     * @returns {string}
     */
    getItemName(itemHrid) {
        if (this.itemNameCache.has(itemHrid)) {
            return this.itemNameCache.get(itemHrid);
        }
        const details = dataManager.getItemDetails(itemHrid);
        const name = details?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
        this.itemNameCache.set(itemHrid, name);
        return name;
    }

    /**
     * Get paginated sessions for current page
     * @returns {Array}
     */
    getPaginatedSessions() {
        if (this.showAll) return this.filteredSessions;
        const start = (this.currentPage - 1) * this.rowsPerPage;
        return this.filteredSessions.slice(start, start + this.rowsPerPage);
    }

    /**
     * Get total number of pages
     * @returns {number}
     */
    getTotalPages() {
        if (this.showAll) return 1;
        return Math.ceil(this.filteredSessions.length / this.rowsPerPage);
    }

    /**
     * Delete a single session by ID
     * @param {string} sessionId
     */
    async deleteSession(sessionId) {
        this.sessions = this.sessions.filter((s) => s.id !== sessionId);

        try {
            await transmuteHistoryTracker.deleteSessions(this.sessions);
        } catch (error) {
            console.error('[TransmuteHistoryViewer] Failed to delete session:', error);
        }

        this.applyFilters();
        this.renderTable();
    }

    /**
     * Export all sessions to a CSV file download
     */
    exportHistory() {
        const escape = (val) => `"${String(val === null || val === undefined ? '' : val).replace(/"/g, '""')}"`;

        const headers = ['Session Start', 'Input Item', 'Attempts', 'Successes', 'Failures', 'Results'];

        const rows = this.sessions.map((session) => {
            const start = new Date(session.startTime).toLocaleString();
            const inputName = this.getItemName(session.inputItemHrid);
            const failures = session.totalAttempts - session.totalSuccesses;

            const resultParts = Object.entries(session.results || {})
                .sort(([, a], [, b]) => {
                    if (a.isSelfReturn && !b.isSelfReturn) return 1;
                    if (!a.isSelfReturn && b.isSelfReturn) return -1;
                    return (b.totalValue || 0) - (a.totalValue || 0);
                })
                .map(([hrid, result]) => {
                    const name = this.getItemName(hrid);
                    if (result.isSelfReturn) {
                        return `${name} x${result.count} (self-return)`;
                    }
                    const total = formatKMB(result.totalValue || 0, 1);
                    const each = formatKMB(result.priceEach || 0, 1);
                    return `${name} x${result.count} = ${total} (${each} each)`;
                });

            return [start, inputName, session.totalAttempts, session.totalSuccesses, failures, resultParts.join('; ')]
                .map(escape)
                .join(',');
        });

        const csv = [headers.map(escape).join(','), ...rows].join('\n');
        const date = new Date().toISOString().slice(0, 10);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `transmute-history-${date}.csv`;
        a.click();

        URL.revokeObjectURL(url);
    }

    /**
     * Clear all history after confirmation
     */
    async clearHistory() {
        const confirmed = confirm(
            `⚠️ This will permanently delete ALL transmute history (${this.sessions.length} sessions).\nThis cannot be undone.\n\nAre you sure?`
        );
        if (!confirmed) return;

        try {
            await transmuteHistoryTracker.clearHistory();
            this.sessions = [];
            this.filteredSessions = [];
            alert('Transmute history cleared.');
            this.applyFilters();
            this.renderTable();
        } catch (error) {
            console.error('[TransmuteHistoryViewer] Failed to clear history:', error);
            alert(`Failed to clear history: ${error.message}`);
        }
    }
}

const transmuteHistoryViewer = new TransmuteHistoryViewer();

export default {
    name: 'Transmute History Viewer',
    initialize: () => transmuteHistoryViewer.initialize(),
    cleanup: () => transmuteHistoryViewer.disable(),
};
