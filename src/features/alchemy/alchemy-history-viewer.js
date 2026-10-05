/**
 * Alchemy History Viewer
 * Single modal UI for browsing transmute/coinify/decompose session history, with an internal
 * switcher between the enabled types. Injected as one tab in the alchemy panel tab bar,
 * replacing what used to be three separate tabs/modals (one per type).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { t } from '../../core/i18n.js';
import { transmuteHistoryTracker } from './transmute-history-tracker.js';
import { coinifyHistoryTracker } from './coinify-history-tracker.js';
import { decomposeHistoryTracker } from './decompose-history-tracker.js';
import { formatKMB, formatDateTime } from '../../utils/formatters.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const CATALYST_OF_COINIFICATION_HRID = '/items/catalyst_of_coinification';
const CATALYST_OF_DECOMPOSITION_HRID = '/items/catalyst_of_decomposition';
const PRIME_CATALYST_HRID = '/items/prime_catalyst';

// The native alchemy tab bar's own labels are always in the game's own (possibly non-English)
// language, but the DOM text we match against to find a reference tab to clone is hardcoded
// English in the original three viewers this replaces - preserved as-is rather than using our
// own t()'d action name, which would resolve to Toolasha's locale and likely never match.
const NATIVE_TAB_TEXT = { transmute: 'Transmute', coinify: 'Coinify', decompose: 'Decompose' };

const TYPE_ORDER = ['transmute', 'coinify', 'decompose'];

const TYPE_CONFIGS = {
    transmute: {
        type: 'transmute',
        tracker: transmuteHistoryTracker,
        settingKey: 'alchemy_transmuteHistory',
        actionNameKey: 'skillingOptimizer.alchemyTypeTransmute',
        emptyStateKey: 'alchemyHistoryViewer.noTransmuteHistoryYet',
        hasEnhancement: false,
        hasSuccessRate: false,
        hasCoins: false,
        hasResults: true,
        resultsSupportSelfReturn: true,
        catalystHrids: [],
        catalystUsedFields: [],
        catalystCellAlign: 'left',
        successRateZeroDisplay: null,
        clearConfirmLocaleKey: 'alchemyHistoryViewer.clearHistoryConfirmWithWarning',
        filenamePrefix: 'transmute-history',
        csvColumns: [
            { kind: 'date' },
            { kind: 'itemName' },
            { kind: 'attempts' },
            { kind: 'successes' },
            { kind: 'failures' },
            { kind: 'results', supportSelfReturn: true },
        ],
    },
    coinify: {
        type: 'coinify',
        tracker: coinifyHistoryTracker,
        settingKey: 'alchemy_coinifyHistory',
        actionNameKey: 'skillingOptimizer.alchemyTypeCoinify',
        emptyStateKey: 'alchemyHistoryViewer.noCoinifyHistoryYet',
        hasEnhancement: true,
        hasSuccessRate: true,
        hasCoins: true,
        hasResults: false,
        resultsSupportSelfReturn: false,
        catalystHrids: [CATALYST_OF_COINIFICATION_HRID, PRIME_CATALYST_HRID],
        catalystUsedFields: ['catalystOfCoinificationUsed', 'primeCatalystUsed'],
        catalystCellAlign: 'left',
        successRateZeroDisplay: '—',
        clearConfirmLocaleKey: 'alchemyHistoryViewer.clearHistoryConfirmPlain',
        filenamePrefix: 'coinify-history',
        csvColumns: [
            { kind: 'date' },
            { kind: 'itemName' },
            { kind: 'enhancement', headerKey: 'csvColEnhancementLevelFull' },
            { kind: 'attempts' },
            { kind: 'successes' },
            { kind: 'failures' },
            { kind: 'successRate' },
            { kind: 'coinsEarned' },
            { kind: 'catalystUsed', catalystIndex: 0, headerStyle: 'used' },
            { kind: 'catalystUsed', catalystIndex: 1, headerStyle: 'used' },
        ],
    },
    decompose: {
        type: 'decompose',
        tracker: decomposeHistoryTracker,
        settingKey: 'alchemy_decomposeHistory',
        actionNameKey: 'skillingOptimizer.alchemyTypeDecompose',
        emptyStateKey: 'alchemyHistoryViewer.noDecomposeHistoryYet',
        hasEnhancement: true,
        hasSuccessRate: true,
        hasCoins: false,
        hasResults: true,
        resultsSupportSelfReturn: false,
        catalystHrids: [CATALYST_OF_DECOMPOSITION_HRID, PRIME_CATALYST_HRID],
        catalystUsedFields: ['catalystOfDecompositionUsed', 'primeCatalystUsed'],
        catalystCellAlign: 'center',
        successRateZeroDisplay: '0.0%',
        clearConfirmLocaleKey: 'alchemyHistoryViewer.clearHistoryConfirmWithWarning',
        filenamePrefix: 'decompose-history',
        csvColumns: [
            { kind: 'date' },
            { kind: 'itemName' },
            { kind: 'enhancement', headerKey: 'colEnhLevel' },
            { kind: 'attempts' },
            { kind: 'successes' },
            { kind: 'failures' },
            { kind: 'successRate' },
            { kind: 'results', supportSelfReturn: false },
            { kind: 'catalystUsed', catalystIndex: 0, headerStyle: 'plain' },
            { kind: 'catalystUsed', catalystIndex: 1, headerStyle: 'plain' },
        ],
    },
};

class AlchemyHistoryViewer {
    constructor() {
        this.isInitialized = false;
        this.modal = null;
        this.enabledTypes = [];
        this.activeType = null;

        // Per-type state (sessions/filters/pagination/sort) so switching types preserves each
        // type's own filter/page position rather than resetting on every switch.
        this.typeState = {};
        TYPE_ORDER.forEach((type) => {
            this.typeState[type] = {
                sessions: [],
                filteredSessions: [],
                currentPage: 1,
                rowsPerPage: 50,
                showAll: false,
                sortColumn: 'startTime',
                sortDirection: 'desc',
                filters: { dateFrom: null, dateTo: null, selectedInputItems: [], resultsSearch: '' },
                cachedDateRange: null,
            };
        });

        this.activeFilterPopup = null;
        this.activeFilterButton = null;
        this.popupCloseHandler = null;

        // Tab injection
        this.alchemyTab = null;
        this.tabWatcher = null;

        // Caches (shared across types - item names/sprite URL don't vary by alching type)
        this.itemNameCache = new Map();
        this.itemsSpriteUrl = null;

        this.timerRegistry = createTimerRegistry();
    }

    /**
     * @returns {Object} the active type's per-type state
     */
    get state() {
        return this.typeState[this.activeType];
    }

    /**
     * @returns {Object} the active type's config from TYPE_CONFIGS
     */
    get activeConfig() {
        return TYPE_CONFIGS[this.activeType];
    }

    /**
     * Initialize the viewer. Mirrors the original three viewers' gating: each type participates
     * only if its tracker's own setting is on (there is no separate viewer-specific setting).
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.enabledTypes = TYPE_ORDER.filter((type) => config.getSetting(TYPE_CONFIGS[type].settingKey));
        if (this.enabledTypes.length === 0) {
            return;
        }

        this.activeType = this.enabledTypes[0];
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
     * Inject a single "Alchemy History" tab into the alchemy tab bar.
     * The alchemy tab bar contains Coinify, Decompose, Transmute, Unrefine, Current Action.
     * We identify it by the presence of any enabled type's native tab text.
     */
    addAlchemyTab() {
        const ensureTabExists = () => {
            const tablist = document.querySelector('[role="tablist"]');
            if (!tablist) return;

            // Already injected?
            if (tablist.querySelector('[data-mwi-alchemy-history-tab="true"]')) return;

            // Clone an existing tab for structure - matched by the native (English) tab text for
            // any of our enabled types, since the game's own tab labels aren't run through our t().
            const referenceTab = Array.from(tablist.children).find(
                (btn) =>
                    !btn.dataset.mwiAlchemyHistoryTab &&
                    this.enabledTypes.some((type) => btn.textContent.includes(NATIVE_TAB_TEXT[type]))
            );
            if (!referenceTab) return;

            const tab = referenceTab.cloneNode(true);
            tab.setAttribute('data-mwi-alchemy-history-tab', 'true');
            tab.classList.remove('Mui-selected');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');

            const label = t('alchemyHistoryViewer.unifiedModalTitle');
            const badge = tab.querySelector('.TabsComponent_badge__1Du26');
            if (badge) {
                // Replace first text node (the label) while keeping badge span
                const badgeSpan = badge.querySelector('.MuiBadge-badge');
                badge.textContent = '';
                badge.appendChild(document.createTextNode(label));
                if (badgeSpan) badge.appendChild(badgeSpan);
            } else {
                tab.textContent = label;
            }

            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openModal();
            });

            tablist.appendChild(tab);
            tablist.style.overflowX = 'auto';
            tablist.style.flexWrap = 'nowrap';
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
     * Open the modal, showing the given type (or the current/first-enabled type if omitted).
     * @param {string} [initialType]
     */
    async openModal(initialType) {
        if (initialType && this.enabledTypes.includes(initialType)) {
            this.activeType = initialType;
        }

        if (!this.modal) {
            this.createModal();
        }

        this.modal.style.display = 'flex';
        await this.switchType(this.activeType);
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
        this.modal.className = 'mwi-alchemy-history-modal';
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
        content.className = 'mwi-alchemy-history-content';
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
            margin-bottom: 16px;
        `;

        const title = document.createElement('h2');
        title.className = 'mwi-alchemy-history-title';
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

        // Type switcher row - hidden entirely when only one type is enabled
        const switcher = document.createElement('div');
        switcher.className = 'mwi-alchemy-history-switcher';
        switcher.style.cssText = 'display: flex; gap: 6px; margin-bottom: 14px;';

        // Controls
        const controls = document.createElement('div');
        controls.className = 'mwi-alchemy-history-controls';
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
        badges.className = 'mwi-alchemy-history-badges';
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
        tableContainer.className = 'mwi-alchemy-history-table-container';
        tableContainer.style.cssText = 'overflow-x: auto;';

        // Pagination
        const pagination = document.createElement('div');
        pagination.className = 'mwi-alchemy-history-pagination';
        pagination.style.cssText = `
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        content.appendChild(header);
        content.appendChild(switcher);
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

    /**
     * Render the type-switcher buttons, hidden entirely when only one type is enabled.
     */
    renderSwitcher() {
        const switcher = this.modal.querySelector('.mwi-alchemy-history-switcher');
        while (switcher.firstChild) switcher.removeChild(switcher.firstChild);

        if (this.enabledTypes.length <= 1) {
            switcher.style.display = 'none';
            return;
        }
        switcher.style.display = 'flex';

        this.enabledTypes.forEach((type) => {
            const btn = document.createElement('button');
            btn.textContent = t(TYPE_CONFIGS[type].actionNameKey);
            const active = type === this.activeType;
            btn.style.cssText = active
                ? 'padding: 6px 14px; background: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;'
                : 'padding: 6px 14px; background: #3a3a3a; color: #ccc; border: none; border-radius: 4px; cursor: pointer;';
            btn.addEventListener('click', () => {
                if (type !== this.activeType) this.switchType(type);
            });
            switcher.appendChild(btn);
        });
    }

    /**
     * Switch the modal to show a different type: loads that type's sessions fresh (alchemy
     * session history can change in near-real-time while a character is actively alchemy-ing,
     * so always reloading avoids showing stale attempt counts after switching tabs), then
     * re-renders. Per-type filter/sort/page state is preserved across switches.
     * @param {string} type
     */
    async switchType(type) {
        this.activeType = type;
        this.closeActiveFilterPopup();
        this.state.sessions = await this.activeConfig.tracker.loadSessions();
        this.state.cachedDateRange = null;
        this.applyFilters();

        this.modal.querySelector('.mwi-alchemy-history-title').textContent = t('alchemyHistoryViewer.historyTabTitle', {
            actionName: t(this.activeConfig.actionNameKey),
        });

        this.renderSwitcher();
        this.renderTable();
    }

    // ─── Filtering ───────────────────────────────────────────────────────────

    /**
     * Apply all active filters to the active type's sessions → filteredSessions
     */
    applyFilters() {
        const state = this.state;
        const activeConfig = this.activeConfig;
        state.cachedDateRange = null;

        const hasDateFilter = !!(state.filters.dateFrom || state.filters.dateTo);
        let dateToEndOfDay = null;
        if (hasDateFilter && state.filters.dateTo) {
            dateToEndOfDay = new Date(state.filters.dateTo);
            dateToEndOfDay.setHours(23, 59, 59, 999);
        }

        const hasItemFilter = state.filters.selectedInputItems.length > 0;
        const itemFilterSet = hasItemFilter ? new Set(state.filters.selectedInputItems) : null;

        const hasResultsFilter = activeConfig.hasResults && !!state.filters.resultsSearch.trim();
        const resultsSearch = hasResultsFilter ? state.filters.resultsSearch.trim().toLowerCase() : '';

        const filtered = state.sessions.filter((session) => {
            // Date filter
            if (hasDateFilter) {
                const d = new Date(session.startTime);
                if (state.filters.dateFrom && d < state.filters.dateFrom) return false;
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
            const aVal = a[state.sortColumn] ?? 0;
            const bVal = b[state.sortColumn] ?? 0;
            return state.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });

        state.filteredSessions = filtered;
        state.currentPage = 1;
    }

    /**
     * Check if a column has an active filter
     * @param {string} col
     * @returns {boolean}
     */
    hasActiveFilter(col) {
        const state = this.state;
        switch (col) {
            case 'startTime':
                return !!(state.filters.dateFrom || state.filters.dateTo);
            case 'inputItemHrid':
                return state.filters.selectedInputItems.length > 0;
            case 'results':
                return !!state.filters.resultsSearch.trim();
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
            (this.activeConfig.hasResults && this.hasActiveFilter('results'))
        );
    }

    /**
     * Clear all filters
     */
    clearAllFilters() {
        const state = this.state;
        state.filters.dateFrom = null;
        state.filters.dateTo = null;
        state.filters.selectedInputItems = [];
        state.filters.resultsSearch = '';
        this.applyFilters();
        this.renderTable();
    }

    // ─── Rendering ───────────────────────────────────────────────────────────

    /**
     * Build the column definition list for a given type's config.
     * @param {Object} activeConfig
     * @returns {Array<Object>}
     */
    buildColumns(activeConfig) {
        const columns = [
            { key: 'startTime', label: t('alchemyHistoryViewer.colSessionStart'), filterable: true },
            { key: 'inputItemHrid', label: t('alchemyHistoryViewer.colInputItem'), filterable: true },
        ];
        if (activeConfig.hasEnhancement) {
            columns.push({
                key: 'enhancementLevel',
                label: t('alchemyHistoryViewer.colEnhLevel'),
                filterable: false,
            });
        }
        columns.push({ key: 'totalAttempts', label: t('alchemyHistoryViewer.colAttempts'), filterable: false });
        columns.push({ key: 'totalSuccesses', label: t('alchemyHistoryViewer.colSuccesses'), filterable: false });
        if (activeConfig.hasSuccessRate) {
            columns.push({
                key: '_successRate',
                label: t('alchemyHistoryViewer.colSuccessRate'),
                filterable: false,
            });
        }
        if (activeConfig.hasCoins) {
            columns.push({
                key: 'totalCoinsEarned',
                label: t('alchemyHistoryViewer.colCoinsEarned'),
                filterable: false,
            });
        }
        if (activeConfig.hasResults) {
            columns.push({ key: 'results', label: t('alchemyHistoryViewer.colResults'), filterable: true });
        }
        activeConfig.catalystHrids.forEach((hrid, i) => {
            columns.push({
                key: `_catalyst${i}`,
                label: this.getItemName(hrid),
                filterable: false,
                catalystHrid: hrid,
            });
        });
        columns.push({ key: '_delete', label: '', filterable: false });
        return columns;
    }

    /**
     * Full render: switcher + controls + badges + table + pagination
     */
    renderTable() {
        this.renderSwitcher();
        this.renderControls();
        this.renderBadges();

        const tableContainer = this.modal.querySelector('.mwi-alchemy-history-table-container');
        while (tableContainer.firstChild) tableContainer.removeChild(tableContainer.firstChild);

        const table = document.createElement('table');
        table.style.cssText = 'width: max-content; border-collapse: collapse; color: #fff; white-space: nowrap;';

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.background = '#1a1a1a';

        const activeConfig = this.activeConfig;
        const columns = this.buildColumns(activeConfig);

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

            // Computed columns (starting with _) and 'results' are not directly sortable by field
            const isSortable = !col.key.startsWith('_') && col.key !== 'results';
            const isCatalystCol = col.key.startsWith('_catalyst');

            if (isSortable) {
                if (this.state.sortColumn === col.key) {
                    labelSpan.textContent = col.label + (this.state.sortDirection === 'asc' ? ' ▲' : ' ▼');
                } else {
                    labelSpan.textContent = col.label;
                }
                labelSpan.addEventListener('click', () => {
                    const state = this.state;
                    if (state.sortColumn === col.key) {
                        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        state.sortColumn = col.key;
                        state.sortDirection = 'desc';
                    }
                    this.applyFilters();
                    this.renderTable();
                });
            } else if (isCatalystCol) {
                // Render icon as header with item name as tooltip
                labelSpan.title = col.label;
                labelSpan.style.cursor = 'default';
                this.appendItemIcon(labelSpan, col.catalystHrid, 20);
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
                this.state.sessions.length === 0
                    ? t(activeConfig.emptyStateKey)
                    : t('alchemyHistoryViewer.noSessionsMatchFilters');
            cell.style.cssText = 'padding: 20px; text-align: center; color: #888;';
            row.appendChild(cell);
            tbody.appendChild(row);
        } else {
            paginated.forEach((session, index) => {
                tbody.appendChild(this.buildRow(session, index, activeConfig));
            });
        }

        table.appendChild(tbody);
        tableContainer.appendChild(table);
        this.renderPagination();
    }

    /**
     * Build one table row for a session, per the active type's config.
     * @param {Object} session
     * @param {number} index
     * @param {Object} activeConfig
     * @returns {HTMLElement}
     */
    buildRow(session, index, activeConfig) {
        const row = document.createElement('tr');
        row.style.cssText = `
            border-bottom: 1px solid #333;
            background: ${index % 2 === 0 ? '#2a2a2a' : '#252525'};
        `;

        // Session Start
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDateTime(new Date(session.startTime));
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

        // Enhancement Level
        if (activeConfig.hasEnhancement) {
            const enhCell = document.createElement('td');
            enhCell.textContent = session.enhancementLevel > 0 ? `+${session.enhancementLevel}` : '0';
            enhCell.style.cssText = 'padding: 6px 10px; text-align: center;';
            row.appendChild(enhCell);
        }

        // Attempts
        const attemptsCell = document.createElement('td');
        attemptsCell.textContent = session.totalAttempts;
        attemptsCell.style.padding = '6px 10px';
        row.appendChild(attemptsCell);

        // Successes
        const successCell = document.createElement('td');
        const failures = session.totalAttempts - session.totalSuccesses;
        successCell.textContent = t('alchemyHistoryViewer.successesFailedLabel', {
            successes: session.totalSuccesses,
            failures,
        });
        successCell.style.cssText = `
            padding: 6px 10px;
            color: ${failures > 0 ? '#fbbf24' : '#4ade80'};
        `;
        row.appendChild(successCell);

        // Success Rate
        if (activeConfig.hasSuccessRate) {
            const rateCell = document.createElement('td');
            rateCell.textContent =
                session.totalAttempts > 0
                    ? `${((session.totalSuccesses / session.totalAttempts) * 100).toFixed(1)}%`
                    : activeConfig.successRateZeroDisplay;
            rateCell.style.padding = '6px 10px';
            row.appendChild(rateCell);
        }

        // Coins Earned
        if (activeConfig.hasCoins) {
            const earnedCell = document.createElement('td');
            earnedCell.textContent = formatKMB(session.totalCoinsEarned || 0, 1);
            earnedCell.style.cssText = 'padding: 6px 10px; color: #fbbf24;';
            row.appendChild(earnedCell);
        }

        // Results
        if (activeConfig.hasResults) {
            const resultsCell = document.createElement('td');
            resultsCell.style.cssText = 'padding: 6px 10px;';
            this.renderResultsCell(resultsCell, session, activeConfig);
            row.appendChild(resultsCell);
        }

        // Catalysts
        activeConfig.catalystHrids.forEach((hrid, i) => {
            const cell = document.createElement('td');
            cell.style.cssText = `padding: 6px 10px;${activeConfig.catalystCellAlign === 'center' ? ' text-align: center;' : ''}`;
            const used = session[activeConfig.catalystUsedFields[i]] || 0;
            this.renderCatalystCell(cell, hrid, used);
            row.appendChild(cell);
        });

        // Delete
        const deleteCell = document.createElement('td');
        deleteCell.style.cssText = 'padding: 6px 4px; text-align: center;';
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '✕';
        deleteBtn.title = t('alchemyHistoryViewer.deleteSessionTitle');
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

        return row;
    }

    /**
     * Render the results cell for a session. When resultsSupportSelfReturn is true (transmute),
     * self-returns sort last and render with a muted "self-return" label; decompose has no
     * self-return concept and just sorts by totalValue desc.
     * @param {HTMLElement} cell
     * @param {Object} session
     * @param {Object} activeConfig
     */
    renderResultsCell(cell, session, activeConfig) {
        const results = session.results || {};
        const entries = Object.entries(results);

        if (entries.length === 0) {
            const span = document.createElement('span');
            span.textContent = '—';
            span.style.color = '#888';
            cell.appendChild(span);
            return;
        }

        const sortedEntries = activeConfig.resultsSupportSelfReturn
            ? entries.sort(([, a], [, b]) => {
                  if (a.isSelfReturn && !b.isSelfReturn) return 1;
                  if (!a.isSelfReturn && b.isSelfReturn) return -1;
                  return (b.totalValue || 0) - (a.totalValue || 0);
              })
            : entries.sort(([, a], [, b]) => (b.totalValue || 0) - (a.totalValue || 0));

        sortedEntries.forEach(([itemHrid, result]) => {
            const line = document.createElement('div');
            line.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 2px;';

            this.appendItemIcon(line, itemHrid, 16);

            const text = document.createElement('span');
            const name = this.getItemName(itemHrid);

            if (activeConfig.resultsSupportSelfReturn && result.isSelfReturn) {
                text.textContent = t('alchemyHistoryViewer.selfReturnResultLine', { name, count: result.count });
                text.style.color = '#888';
            } else {
                const total = formatKMB(result.totalValue || 0, 1);
                const each = formatKMB(result.priceEach || 0, 1);
                text.textContent =
                    t('alchemyHistoryViewer.resultLine', { name, count: result.count, total, each }) +
                    (result.isOutlier ? ' ⚠' : '');
                if (result.isOutlier) {
                    text.title = t('marketData.outlierPriceWarningTooltip');
                }
            }

            line.appendChild(text);
            cell.appendChild(line);
        });
    }

    /**
     * Render a catalyst cell: icon + count, or — if zero
     * @param {HTMLElement} cell
     * @param {string} catalystHrid
     * @param {number} count
     */
    renderCatalystCell(cell, catalystHrid, count) {
        if (count === 0) {
            const dash = document.createElement('span');
            dash.textContent = '—';
            dash.style.color = '#888';
            cell.appendChild(dash);
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';

        this.appendItemIcon(wrapper, catalystHrid, 18);

        const countSpan = document.createElement('span');
        countSpan.textContent = count.toLocaleString();
        wrapper.appendChild(countSpan);

        cell.appendChild(wrapper);
    }

    /**
     * Render controls bar (stats + action buttons)
     */
    renderControls() {
        const controls = this.modal.querySelector('.mwi-alchemy-history-controls');
        while (controls.firstChild) controls.removeChild(controls.firstChild);

        // Stats
        const stats = document.createElement('span');
        stats.style.cssText = 'color: #aaa; font-size: 14px;';
        stats.textContent = t('alchemyHistoryViewer.sessionCountStat', { count: this.state.filteredSessions.length });
        controls.appendChild(stats);

        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        // Clear All Filters button (only when filters active)
        if (this.hasAnyFilter()) {
            const clearFiltersBtn = document.createElement('button');
            clearFiltersBtn.textContent = t('marketHistory.clearAllFiltersButton');
            clearFiltersBtn.style.cssText = `
                padding: 6px 12px; background: #e67e22; color: white;
                border: none; border-radius: 4px; cursor: pointer;
            `;
            clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());
            rightGroup.appendChild(clearFiltersBtn);
        }

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('customTabsUi.exportButton');
        exportBtn.style.cssText = `
            padding: 6px 12px; background: #2563eb; color: white;
            border: none; border-radius: 4px; cursor: pointer;
        `;
        exportBtn.addEventListener('click', () => this.exportHistory());
        rightGroup.appendChild(exportBtn);

        // Clear History button
        const clearBtn = document.createElement('button');
        clearBtn.textContent = t('marketHistory.clearHistoryButton');
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
        const container = this.modal.querySelector('.mwi-alchemy-history-badges');
        while (container.firstChild) container.removeChild(container.firstChild);

        const state = this.state;
        const activeConfig = this.activeConfig;
        const badges = [];

        if (state.filters.dateFrom || state.filters.dateTo) {
            const parts = [];
            if (state.filters.dateFrom) parts.push(formatDateTime(state.filters.dateFrom, { includeTime: false }));
            if (state.filters.dateTo) parts.push(formatDateTime(state.filters.dateTo, { includeTime: false }));
            badges.push({
                label: t('marketHistory.dateFilterBadge', { range: parts.join(' - ') }),
                onRemove: () => {
                    state.filters.dateFrom = null;
                    state.filters.dateTo = null;
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        if (state.filters.selectedInputItems.length > 0) {
            const label =
                state.filters.selectedInputItems.length === 1
                    ? this.getItemName(state.filters.selectedInputItems[0])
                    : t('alchemyHistoryViewer.inputItemsCountLabel', {
                          count: state.filters.selectedInputItems.length,
                      });
            badges.push({
                label: t('alchemyHistoryViewer.inputFilterBadge', { label }),
                icon: state.filters.selectedInputItems[0],
                onRemove: () => {
                    state.filters.selectedInputItems = [];
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        if (activeConfig.hasResults && state.filters.resultsSearch.trim()) {
            badges.push({
                label: t('alchemyHistoryViewer.resultsFilterBadge', { text: state.filters.resultsSearch.trim() }),
                onRemove: () => {
                    state.filters.resultsSearch = '';
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
        const pagination = this.modal.querySelector('.mwi-alchemy-history-pagination');
        while (pagination.firstChild) pagination.removeChild(pagination.firstChild);

        const state = this.state;

        const leftSide = document.createElement('div');
        leftSide.style.cssText = 'display: flex; gap: 8px; align-items: center; color: #aaa;';

        const label = document.createElement('span');
        label.textContent = t('marketHistory.rowsPerPageLabel');

        const rowsInput = document.createElement('input');
        rowsInput.type = 'number';
        rowsInput.value = state.rowsPerPage;
        rowsInput.min = '1';
        rowsInput.disabled = state.showAll;
        rowsInput.style.cssText = `
            width: 60px; padding: 4px 8px;
            border: 1px solid #555; border-radius: 4px;
            background: ${state.showAll ? '#333' : '#1a1a1a'};
            color: ${state.showAll ? '#666' : '#fff'};
        `;
        rowsInput.addEventListener('change', (e) => {
            state.rowsPerPage = Math.max(1, parseInt(e.target.value) || 50);
            state.currentPage = 1;
            this.renderTable();
        });

        const showAllLabel = document.createElement('label');
        showAllLabel.style.cssText = 'cursor: pointer; color: #aaa; display: flex; align-items: center; gap: 4px;';

        const showAllCheckbox = document.createElement('input');
        showAllCheckbox.type = 'checkbox';
        showAllCheckbox.checked = state.showAll;
        showAllCheckbox.style.cursor = 'pointer';
        showAllCheckbox.addEventListener('change', (e) => {
            state.showAll = e.target.checked;
            rowsInput.disabled = state.showAll;
            rowsInput.style.background = state.showAll ? '#333' : '#1a1a1a';
            rowsInput.style.color = state.showAll ? '#666' : '#fff';
            state.currentPage = 1;
            this.renderTable();
        });

        showAllLabel.appendChild(showAllCheckbox);
        showAllLabel.appendChild(document.createTextNode(t('marketHistory.showAllLabel')));

        leftSide.appendChild(label);
        leftSide.appendChild(rowsInput);
        leftSide.appendChild(showAllLabel);

        const rightSide = document.createElement('div');
        rightSide.style.cssText = 'display: flex; gap: 8px; align-items: center; color: #aaa;';

        if (!state.showAll) {
            const totalPages = this.getTotalPages();

            const prevBtn = document.createElement('button');
            prevBtn.textContent = '◀';
            prevBtn.disabled = state.currentPage === 1;
            prevBtn.style.cssText = `
                padding: 4px 12px;
                background: ${state.currentPage === 1 ? '#333' : '#4a90e2'};
                color: ${state.currentPage === 1 ? '#666' : 'white'};
                border: none; border-radius: 4px;
                cursor: ${state.currentPage === 1 ? 'default' : 'pointer'};
            `;
            prevBtn.addEventListener('click', () => {
                if (state.currentPage > 1) {
                    state.currentPage--;
                    this.renderTable();
                }
            });

            const pageInfo = document.createElement('span');
            pageInfo.textContent = t('marketHistory.pageInfo', {
                current: state.currentPage,
                total: totalPages || 1,
            });

            const nextBtn = document.createElement('button');
            nextBtn.textContent = '▶';
            nextBtn.disabled = state.currentPage >= totalPages;
            nextBtn.style.cssText = `
                padding: 4px 12px;
                background: ${state.currentPage >= totalPages ? '#333' : '#4a90e2'};
                color: ${state.currentPage >= totalPages ? '#666' : 'white'};
                border: none; border-radius: 4px;
                cursor: ${state.currentPage >= totalPages ? 'default' : 'pointer'};
            `;
            nextBtn.addEventListener('click', () => {
                if (state.currentPage < totalPages) {
                    state.currentPage++;
                    this.renderTable();
                }
            });

            rightSide.appendChild(prevBtn);
            rightSide.appendChild(pageInfo);
            rightSide.appendChild(nextBtn);
        } else {
            const info = document.createElement('span');
            info.textContent = t('alchemyHistoryViewer.showingAllSessions', { count: state.filteredSessions.length });
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
                if (!this.activeConfig.hasResults) return;
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
        const timeoutId = setTimeout(() => document.addEventListener('click', this.popupCloseHandler), 10);
        this.timerRegistry.registerTimeout(timeoutId);
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
        const state = this.state;
        const popup = this.createPopupBase(t('marketHistory.filterByDateTitle'));

        // Compute available range
        if (!state.cachedDateRange) {
            const timestamps = state.sessions.map((s) => s.startTime).filter(Boolean);
            if (timestamps.length > 0) {
                state.cachedDateRange = {
                    minDate: new Date(Math.min(...timestamps)),
                    maxDate: new Date(Math.max(...timestamps)),
                };
            } else {
                state.cachedDateRange = { minDate: null, maxDate: null };
            }
        }

        const { minDate, maxDate } = state.cachedDateRange;

        if (minDate && maxDate) {
            const rangeInfo = document.createElement('div');
            rangeInfo.style.cssText = `
                color: #aaa; font-size: 11px; margin-bottom: 10px;
                padding: 6px; background: #1a1a1a; border-radius: 3px;
            `;
            rangeInfo.textContent = t('marketHistory.availableRangeLabel', {
                range: `${formatDateTime(minDate, { includeTime: false })} - ${formatDateTime(maxDate, { includeTime: false })}`,
            });
            popup.appendChild(rangeInfo);
        }

        const fromInput = this.createDateInput(
            t('marketHistory.fromLabel'),
            state.filters.dateFrom ? state.filters.dateFrom.toISOString().split('T')[0] : '',
            minDate,
            maxDate
        );
        const toInput = this.createDateInput(
            t('marketHistory.toLabel'),
            state.filters.dateTo ? state.filters.dateTo.toISOString().split('T')[0] : '',
            minDate,
            maxDate
        );

        popup.appendChild(fromInput.label);
        popup.appendChild(fromInput.input);
        popup.appendChild(toInput.label);
        popup.appendChild(toInput.input);

        const btnRow = this.createPopupButtonRow(
            () => {
                state.filters.dateFrom = fromInput.input.value ? new Date(fromInput.input.value) : null;
                state.filters.dateTo = toInput.input.value ? new Date(toInput.input.value) : null;
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                state.filters.dateFrom = null;
                state.filters.dateTo = null;
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
        const state = this.state;
        const popup = this.createPopupBase(t('alchemyHistoryViewer.filterByInputItemTitle'));
        popup.style.minWidth = '220px';

        // Gather unique input items from all sessions
        const itemSet = new Map();
        state.sessions.forEach((s) => {
            if (!itemSet.has(s.inputItemHrid)) {
                itemSet.set(s.inputItemHrid, this.getItemName(s.inputItemHrid));
            }
        });
        const allItems = Array.from(itemSet.entries()).sort((a, b) => a[1].localeCompare(b[1]));

        // Track pending selection (local to this popup)
        const pending = new Set(state.filters.selectedInputItems);

        // Search box
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = t('marketHistory.searchItemsPlaceholder');
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
                state.filters.selectedInputItems = Array.from(pending);
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                state.filters.selectedInputItems = [];
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
        const state = this.state;
        const popup = this.createPopupBase(t('alchemyHistoryViewer.filterByResultItemTitle'));
        popup.style.minWidth = '220px';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = t('alchemyHistoryViewer.itemNamePlaceholder');
        searchInput.value = state.filters.resultsSearch;
        searchInput.style.cssText = `
            width: 100%; padding: 6px; margin-bottom: 10px;
            background: #1a1a1a; border: 1px solid #555;
            border-radius: 3px; color: #fff; box-sizing: border-box;
        `;

        popup.appendChild(searchInput);

        const btnRow = this.createPopupButtonRow(
            () => {
                state.filters.resultsSearch = searchInput.value;
                this.applyFilters();
                this.renderTable();
                this.closeActiveFilterPopup();
            },
            () => {
                state.filters.resultsSearch = '';
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
        applyBtn.textContent = t('marketHistory.applyButton');
        applyBtn.style.cssText = `
            flex: 1; padding: 6px; background: #4a90e2; color: white;
            border: none; border-radius: 3px; cursor: pointer;
        `;
        applyBtn.addEventListener('click', onApply);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = t('settings.clearButton');
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
        const state = this.state;
        if (state.showAll) return state.filteredSessions;
        const start = (state.currentPage - 1) * state.rowsPerPage;
        return state.filteredSessions.slice(start, start + state.rowsPerPage);
    }

    /**
     * Get total number of pages
     * @returns {number}
     */
    getTotalPages() {
        const state = this.state;
        if (state.showAll) return 1;
        return Math.ceil(state.filteredSessions.length / state.rowsPerPage);
    }

    /**
     * Delete a single session by ID
     * @param {string} sessionId
     */
    async deleteSession(sessionId) {
        const state = this.state;
        const activeConfig = this.activeConfig;
        state.sessions = state.sessions.filter((s) => s.id !== sessionId);

        try {
            await activeConfig.tracker.deleteSessions(state.sessions);
        } catch (error) {
            console.error('[AlchemyHistoryViewer] Failed to delete session:', error);
        }

        this.applyFilters();
        this.renderTable();
    }

    /**
     * Resolve a CSV column's header text, driven by the active type's csvColumns config entry
     * rather than inferred from hasX flags - preserves pre-existing per-type wording differences
     * (e.g. coinify's "Enhancement Level" vs decompose's "Enh. Level") exactly.
     * @param {Object} col
     * @param {Object} activeConfig
     * @returns {string}
     */
    getCsvHeader(col, activeConfig) {
        switch (col.kind) {
            case 'date':
                return t('alchemyHistoryViewer.colSessionStart');
            case 'itemName':
                return t('alchemyHistoryViewer.colInputItem');
            case 'enhancement':
                return t(`alchemyHistoryViewer.${col.headerKey}`);
            case 'attempts':
                return t('alchemyHistoryViewer.colAttempts');
            case 'successes':
                return t('alchemyHistoryViewer.colSuccesses');
            case 'failures':
                return t('alchemyHistoryViewer.colFailures');
            case 'successRate':
                return t('alchemyHistoryViewer.colSuccessRate');
            case 'coinsEarned':
                return t('alchemyHistoryViewer.colCoinsEarned');
            case 'results':
                return t('alchemyHistoryViewer.colResults');
            case 'catalystUsed': {
                const hrid = activeConfig.catalystHrids[col.catalystIndex];
                const name = this.getItemName(hrid);
                return col.headerStyle === 'used' ? t('alchemyHistoryViewer.csvColItemUsedHeader', { name }) : name;
            }
            default:
                return '';
        }
    }

    /**
     * Resolve a CSV column's value for one session.
     * @param {Object} col
     * @param {Object} session
     * @param {Object} activeConfig
     * @returns {string|number}
     */
    getCsvValue(col, session, activeConfig) {
        switch (col.kind) {
            case 'date':
                return formatDateTime(new Date(session.startTime));
            case 'itemName':
                return this.getItemName(session.inputItemHrid);
            case 'enhancement':
                return session.enhancementLevel;
            case 'attempts':
                return session.totalAttempts;
            case 'successes':
                return session.totalSuccesses;
            case 'failures':
                return session.totalAttempts - session.totalSuccesses;
            case 'successRate':
                return session.totalAttempts > 0
                    ? `${((session.totalSuccesses / session.totalAttempts) * 100).toFixed(1)}%`
                    : activeConfig.successRateZeroDisplay;
            case 'coinsEarned':
                return session.totalCoinsEarned || 0;
            case 'results':
                return this.formatResultsForCsv(session, col.supportSelfReturn);
            case 'catalystUsed': {
                const field = activeConfig.catalystUsedFields[col.catalystIndex];
                return session[field] || 0;
            }
            default:
                return '';
        }
    }

    /**
     * Format a session's results map as a single CSV cell string.
     * @param {Object} session
     * @param {boolean} supportSelfReturn
     * @returns {string}
     */
    formatResultsForCsv(session, supportSelfReturn) {
        const entries = Object.entries(session.results || {});
        const sorted = supportSelfReturn
            ? entries.sort(([, a], [, b]) => {
                  if (a.isSelfReturn && !b.isSelfReturn) return 1;
                  if (!a.isSelfReturn && b.isSelfReturn) return -1;
                  return (b.totalValue || 0) - (a.totalValue || 0);
              })
            : entries.sort(([, a], [, b]) => (b.totalValue || 0) - (a.totalValue || 0));

        return sorted
            .map(([hrid, result]) => {
                const name = this.getItemName(hrid);
                if (supportSelfReturn && result.isSelfReturn) {
                    return t('alchemyHistoryViewer.selfReturnResultLine', { name, count: result.count });
                }
                const total = formatKMB(result.totalValue || 0, 1);
                const each = formatKMB(result.priceEach || 0, 1);
                return (
                    t('alchemyHistoryViewer.resultLine', { name, count: result.count, total, each }) +
                    (result.isOutlier ? ' ⚠' : '')
                );
            })
            .join('; ');
    }

    /**
     * Export the active type's sessions to a CSV file download. Column headers/values are
     * driven by the active config's csvColumns list rather than inferred from hasX flags, since
     * coinify/decompose have small pre-existing differences in header wording and zero-attempt
     * success-rate display that are preserved exactly, not silently unified.
     */
    exportHistory() {
        const state = this.state;
        const activeConfig = this.activeConfig;
        const escape = (val) => `"${String(val === null || val === undefined ? '' : val).replace(/"/g, '""')}"`;

        const headers = activeConfig.csvColumns.map((col) => this.getCsvHeader(col, activeConfig));
        const rows = state.sessions.map((session) =>
            activeConfig.csvColumns
                .map((col) => this.getCsvValue(col, session, activeConfig))
                .map(escape)
                .join(',')
        );

        const csv = [headers.map(escape).join(','), ...rows].join('\n');
        const date = new Date().toISOString().slice(0, 10);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeConfig.filenamePrefix}-${date}.csv`;
        a.click();

        URL.revokeObjectURL(url);
    }

    /**
     * Clear all history for the active type after confirmation
     */
    async clearHistory() {
        const state = this.state;
        const activeConfig = this.activeConfig;
        const confirmed = confirm(
            t(activeConfig.clearConfirmLocaleKey, {
                actionName: t(activeConfig.actionNameKey),
                count: state.sessions.length,
            })
        );
        if (!confirmed) return;

        try {
            await activeConfig.tracker.clearHistory();
            state.sessions = [];
            state.filteredSessions = [];
            alert(
                t('alchemyHistoryViewer.historyClearedAlert', {
                    actionName: t(activeConfig.actionNameKey),
                })
            );
            this.applyFilters();
            this.renderTable();
        } catch (error) {
            console.error('[AlchemyHistoryViewer] Failed to clear history:', error);
            alert(t('marketHistory.clearHistoryFailedAlert', { error: error.message }));
        }
    }
}

const alchemyHistoryViewer = new AlchemyHistoryViewer();

export { AlchemyHistoryViewer, TYPE_CONFIGS };

export default {
    name: 'Alchemy History Viewer',
    initialize: () => alchemyHistoryViewer.initialize(),
    cleanup: () => alchemyHistoryViewer.disable(),
};
