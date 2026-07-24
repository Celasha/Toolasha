/**
 * Shared table column utilities for injecting sortable columns into game tables.
 */

import { formatWithSeparator } from './formatters.js';

const SORT_ICON_CLASS = 'mwi-col-sort-icon';

/**
 * Format a number with thousands separators.
 * @param {number} n
 * @returns {string}
 */
export function fNum(n) {
    return formatWithSeparator(Math.round(n));
}

/**
 * Get ranking badge HTML for top 3 places.
 * @param {number} rank - 1-indexed rank
 * @returns {string} HTML
 */
export function rankBadge(rank) {
    if (rank <= 3) {
        return ['&#x1F947;', '&#x1F948;', '&#x1F949;'][rank - 1];
    }
    return `<span style="color: var(--color-disabled);">#${rank}</span>`;
}

/**
 * Sort icon HTML.
 * @param {string} direction - 'asc', 'desc', or 'none'
 * @returns {string} HTML
 */
export function sortIcon(direction) {
    return `<span class="${SORT_ICON_CLASS}" style="display: inline-flex; flex-direction: column; vertical-align: middle; margin-left: 2px;">
        <span style="font-size: 8px; line-height: 8px;">${direction === 'asc' ? '▲' : '△'}</span>
        <span style="font-size: 8px; line-height: 8px;">${direction === 'desc' ? '▼' : '▽'}</span>
    </span>`;
}

/**
 * Make a column header sortable.
 * @param {HTMLElement} thEl - Header cell
 * @param {Object} options
 * @param {string} options.sortId - Unique sort identifier
 * @param {Function} options.valueGetter - (trEl) => number|string
 * @param {boolean} [options.skipFirst=false] - Skip first body row (sticky row)
 */
export function makeColumnSortable(thEl, options) {
    const tableEl = thEl.closest('table');
    if (!tableEl) return;

    thEl.dataset.sortId = options.sortId;
    thEl.style.cursor = 'pointer';
    thEl.insertAdjacentHTML('beforeend', sortIcon('none'));

    thEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;

        if (tableEl.dataset.sortId === options.sortId) {
            tableEl.dataset.sortDirection = tableEl.dataset.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            tableEl.dataset.sortId = options.sortId;
            tableEl.dataset.sortDirection = 'desc';
        }

        const direction = tableEl.dataset.sortDirection;

        let rows = Array.from(tbodyEl.children);
        if (options.skipFirst) {
            rows = rows.slice(1);
        }

        rows.sort((a, b) => {
            const av = options.valueGetter(a);
            const bv = options.valueGetter(b);
            const aInf = av === Infinity || av === -Infinity;
            const bInf = bv === Infinity || bv === -Infinity;
            if (aInf && bInf) return 0;
            if (aInf) return 1;
            if (bInf) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
                return direction === 'asc' ? av - bv : bv - av;
            }
            const sa = String(av);
            const sb = String(bv);
            return direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        });

        for (const row of rows) {
            tbodyEl.appendChild(row);
        }

        const theadTr = thEl.parentElement;
        for (const th of theadTr.children) {
            const icon = th.querySelector(`.${SORT_ICON_CLASS}`);
            if (icon) {
                const d = th.dataset.sortId === tableEl.dataset.sortId ? direction : 'none';
                icon.outerHTML = sortIcon(d);
            }
        }
    });
}

/**
 * Add a column to a table.
 * @param {HTMLElement} tableEl
 * @param {string} cssPrefix - CSS class applied to injected th/td elements
 * @param {Object} options
 * @param {string} options.name - Column header text
 * @param {Array} options.data - One value per body row
 * @param {Function} [options.format] - (value, index) => HTML string
 * @param {number} [options.insertAfter] - Column index to insert after
 * @param {boolean} [options.makeSortable] - Whether to make column sortable
 * @param {string} [options.sortId] - Sort identifier
 * @param {boolean} [options.skipFirst] - Skip first row for sorting
 * @param {Array} [options.sortData] - Custom sort values (numbers) per row
 */
export function addColumn(tableEl, cssPrefix, options) {
    if (tableEl.querySelector(`th.${cssPrefix}[data-name="${options.name}"]`)) return;

    const theadTr = tableEl.querySelector('thead tr');
    if (!theadTr) return;

    const insertAfter = options.insertAfter !== undefined ? options.insertAfter : theadTr.children.length - 1;

    const th = document.createElement('th');
    th.className = cssPrefix;
    th.dataset.name = options.name;
    th.textContent = options.name;

    if (insertAfter < theadTr.children.length - 1) {
        theadTr.children[insertAfter + 1].insertAdjacentElement('beforebegin', th);
    } else {
        theadTr.appendChild(th);
    }

    const tbodyEl = tableEl.querySelector('tbody');
    const rows = Array.from(tbodyEl.children);

    for (let i = 0; i < rows.length; i++) {
        const td = document.createElement('td');
        td.className = cssPrefix;

        const value = i < options.data.length ? options.data[i] : null;
        if (options.format) {
            td.innerHTML = options.format(value, i);
        } else if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
            td.textContent = '';
        } else if (typeof value === 'number') {
            td.textContent = fNum(value);
        } else {
            td.textContent = value;
        }

        if (options.sortData) {
            td._sortValue = options.sortData[i];
        } else if (typeof value === 'number') {
            td._sortValue = value;
        }

        const refChild = rows[i].children[insertAfter + 1];
        if (refChild) {
            refChild.insertAdjacentElement('beforebegin', td);
        } else {
            rows[i].appendChild(td);
        }
    }

    if (options.makeSortable) {
        makeColumnSortable(th, {
            sortId: options.sortId || options.name,
            skipFirst: options.skipFirst || false,
            valueGetter: (trEl) => {
                const currentIndex = Array.from(theadTr.children).indexOf(th);
                const cell = currentIndex >= 0 ? trEl.children[currentIndex] : undefined;
                if (cell && cell._sortValue !== undefined) return cell._sortValue;
                const text = cell?.textContent?.replace(/[^\d.-]/g, '');
                return text ? parseFloat(text) : 0;
            },
        });
    }
}
