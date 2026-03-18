/**
 * Guild XP Display
 * Injects XP/hr stats, charts, and sortable columns into
 * the Guild Overview, Members, and Guild Leaderboard tabs.
 */

import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { guildXPTracker } from './guild-xp-tracker.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const CSS_PREFIX = 'mwi-guild-xp';

// ─── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Format a duration in ms to a human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function formatTimeLeft(ms) {
    const m1 = 60 * 1000;
    const h1 = 60 * 60 * 1000;
    const d1 = 24 * 60 * 60 * 1000;
    const w1 = 7 * d1;

    const w = Math.floor(ms / w1);
    const d = Math.floor((ms % w1) / d1);
    const h = Math.floor((ms % d1) / h1);
    const m = Math.ceil((ms % h1) / m1);

    const s = (n) => (n === 1 ? '' : 's');
    const parts = [];

    if (w >= 1) parts.push(`${w} week${s(w)}`);
    if (d >= 1) parts.push(`${d} day${s(d)}`);
    if (ms < w1 && h >= 1) parts.push(`${h} hour${s(h)}`);
    if (ms < 6 * h1 && m >= 1) parts.push(`${m} minute${s(m)}`);

    return parts.join(' ') || '< 1 minute';
}

/**
 * Format number with non-breaking spaces as thousands separator (for chart display).
 * @param {number} n
 * @returns {string}
 */
function fNum(n) {
    return formatWithSeparator(Math.round(n));
}

/**
 * Get ranking emoji for top 3 places.
 * @param {number} rank - 1-indexed rank
 * @returns {string} HTML
 */
function rankBadge(rank) {
    if (rank <= 3) {
        return ['&#x1F947;', '&#x1F948;', '&#x1F949;'][rank - 1];
    }
    return `<span style="color: var(--color-disabled);">#${rank}</span>`;
}

// ─── Chart rendering ────────────────────────────────────────────────────────

/**
 * Build a bar chart HTML string from chart data.
 * @param {Array<{t: number, tD: number, xpH: number}>} chart
 * @returns {string} HTML
 */
function buildChart(chart) {
    if (chart.length === 0) return '<div style="color: var(--color-disabled);">Not enough data for chart</div>';

    // Truncate outliers at 2x the median
    let maxXPH = 0;
    let tDSum = 0;
    let hasTruncated = false;

    if (chart.length >= 2) {
        const sorted = chart.slice().sort((a, b) => a.xpH - b.xpH);
        const per50 = sorted[Math.ceil(chart.length / 2)].xpH;

        for (const d of chart) {
            if (d.xpH > per50 * 2) {
                d.truncated = true;
                hasTruncated = true;
            }
        }
    }

    for (const d of chart) {
        tDSum += d.tD;
        if (!d.truncated) {
            maxXPH = Math.max(maxXPH, d.xpH);
        }
    }

    if (hasTruncated) {
        maxXPH *= 1.1;
    }

    if (maxXPH <= 0) return '';

    const minT = chart[0].t;
    const maxT = chart[chart.length - 1].t;

    // Horizontal legend (day boundaries)
    const hLegend = [];
    const lastDayStart = new Date(maxT);
    lastDayStart.setHours(0, 0, 0, 0);
    let lt = lastDayStart.getTime();

    while (lt > minT) {
        hLegend.unshift({ t: lt });
        lt = new Date(lt);
        lt.setDate(lt.getDate() - 1);
        lt = lt.getTime();
    }

    if (hLegend.length === 0) {
        hLegend.unshift({ t: minT });
    } else if (hLegend[0].t - minT > tDSum / 10) {
        hLegend.unshift({ t: minT });
    }

    if (hLegend.length > 0 && maxT - hLegend[hLegend.length - 1].t > tDSum / 10) {
        hLegend.push({ t: maxT });
    }

    // Build bars
    let barsHTML = '';
    for (const d of chart) {
        const heightPct = ((d.truncated ? maxXPH : d.xpH) / maxXPH) * 100;
        const widthPct = (d.tD / tDSum) * 100;
        const bgStyle = d.truncated
            ? 'background-image: linear-gradient(45deg, var(--color-space-300) 25%, transparent 25%, transparent 50%, var(--color-space-300) 50%, var(--color-space-300) 75%, transparent 75%); background-size: 10px 10px;'
            : 'background-color: var(--color-space-300);';

        barsHTML += `<div class="${CSS_PREFIX}__bar"
            style="height: ${heightPct}%; width: ${widthPct}%; ${bgStyle}"
            data-xph="${d.xpH}"
            ${d.truncated ? 'data-truncated="true"' : ''}
            data-t="${d.t}"></div>`;
    }

    // Build legend
    let legendHTML = '';
    for (let i = 0; i < hLegend.length; i++) {
        const d = hLegend[i];
        const leftPct = ((d.t - minT) / tDSum) * 100;
        // Clamp first label left-aligned, last label right-aligned, middle labels centered
        let labelTransform = 'translate(-50%, 0)';
        if (i === 0 && leftPct < 10) labelTransform = 'translate(0, 0)';
        else if (i === hLegend.length - 1 && leftPct > 90) labelTransform = 'translate(-100%, 0)';
        legendHTML += `<div style="position: absolute; top: 0; left: ${leftPct}%; flex-direction: column;">
            <div style="width: 1px; height: 8px; background-color: var(--color-space-300);"></div>
            <div style="font-size: 10px; width: 80px; transform: ${labelTransform};">${new Date(d.t).toLocaleString()}</div>
        </div>`;
    }

    return `
        <div class="${CSS_PREFIX}" style="
            display: grid;
            grid-template-columns: auto auto 1fr;
            grid-template-rows: 1fr auto;
            width: calc(100% - 56px);
            height: calc(100% - 28px * 3 - 14px);
            margin-top: 28px;
            margin-left: 28px;
            gap: 2px;
        ">
            <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
                <div style="font-size: 10px; transform: translate(0, -50%);">${fNum(maxXPH)}</div>
                <div style="font-size: 10px;">${fNum(maxXPH / 2)}</div>
                <div style="font-size: 10px; transform: translate(0, 50%);">0</div>
            </div>
            <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
                <div style="width: 8px; height: 1px; background-color: var(--color-space-300);"></div>
                <div style="width: 8px; height: 1px; background-color: var(--color-space-300);"></div>
                <div style="width: 8px; height: 1px; background-color: var(--color-space-300);"></div>
            </div>
            <div style="flex: 1 1; display: flex; align-items: flex-end; height: 100%; gap: 1px;">
                ${barsHTML}
            </div>
            <div></div>
            <div></div>
            <div style="flex: 0 0; position: relative; height: 28px; overflow: visible;">
                ${legendHTML}
            </div>
        </div>`;
}

// ─── Column sort helpers ────────────────────────────────────────────────────

/**
 * Sort icon HTML.
 * @param {string} direction - 'asc', 'desc', or 'none'
 * @returns {string} HTML
 */
function sortIcon(direction) {
    return `<span class="${CSS_PREFIX}__sort-icon" style="display: inline-flex; flex-direction: column; vertical-align: middle; margin-left: 2px;">
        <span style="font-size: 8px; line-height: 8px;">${direction === 'asc' ? '\u25B2' : '\u25B3'}</span>
        <span style="font-size: 8px; line-height: 8px;">${direction === 'desc' ? '\u25BC' : '\u25BD'}</span>
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
function makeColumnSortable(thEl, options) {
    const tableEl = thEl.closest('table');
    if (!tableEl) return;

    thEl.dataset.sortId = options.sortId;
    thEl.style.cursor = 'pointer';
    thEl.insertAdjacentHTML('beforeend', sortIcon('none'));

    thEl.addEventListener('click', () => {
        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;

        // Toggle direction
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

        // Update all sort icons in this table
        const theadTr = thEl.parentElement;
        for (const th of theadTr.children) {
            const icon = th.querySelector(`.${CSS_PREFIX}__sort-icon`);
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
 * @param {Object} options
 * @param {string} options.name - Column header text
 * @param {Array} options.data - One value per body row
 * @param {Function} [options.format] - (value, index) => HTML string
 * @param {number} [options.insertAfter] - Column index to insert after
 * @param {boolean} [options.makeSortable] - Whether to make column sortable
 * @param {string} [options.sortId] - Sort identifier
 * @param {boolean} [options.skipFirst] - Skip first row for sorting (leaderboard)
 * @param {Array} [options.sortData] - Custom sort values (numbers) per row
 */
function addColumn(tableEl, options) {
    // Don't add duplicate columns
    if (tableEl.querySelector(`th.${CSS_PREFIX}[data-name="${options.name}"]`)) return;

    const theadTr = tableEl.querySelector('thead tr');
    if (!theadTr) return;

    const insertAfter = options.insertAfter !== undefined ? options.insertAfter : theadTr.children.length - 1;

    // Add header
    const th = document.createElement('th');
    th.className = CSS_PREFIX;
    th.dataset.name = options.name;
    th.textContent = options.name;

    if (insertAfter < theadTr.children.length - 1) {
        theadTr.children[insertAfter + 1].insertAdjacentElement('beforebegin', th);
    } else {
        theadTr.appendChild(th);
    }

    // Add body cells
    const tbodyEl = tableEl.querySelector('tbody');
    const rows = Array.from(tbodyEl.children);

    for (let i = 0; i < rows.length; i++) {
        const td = document.createElement('td');
        td.className = CSS_PREFIX;

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

        // Store sort value
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

    // Make sortable
    if (options.makeSortable) {
        const colIndex = Array.from(theadTr.children).indexOf(th);
        makeColumnSortable(th, {
            sortId: options.sortId || options.name,
            skipFirst: options.skipFirst || false,
            valueGetter: (trEl) => {
                const cell = trEl.children[colIndex];
                if (cell && cell._sortValue !== undefined) return cell._sortValue;
                const text = cell?.textContent?.replace(/[^\d.-]/g, '');
                return text ? parseFloat(text) : 0;
            },
        });
    }
}

// ─── Display class ──────────────────────────────────────────────────────────

class GuildXPDisplay {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
        this.timerRegistry = createTimerRegistry();
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('guildXPDisplay', true)) return;

        // Watch for Guild panel tabs
        const unregOverview = domObserver.onClass('GuildXPDisplay-Overview', 'GuildPanel_dataGrid', (el) =>
            this._renderOverview(el)
        );
        this.unregisterObservers.push(unregOverview);

        const unregMembers = domObserver.onClass('GuildXPDisplay-Members', 'GuildPanel_membersTable', (el) =>
            this._renderMembers(el)
        );
        this.unregisterObservers.push(unregMembers);

        // Watch for guild leaderboard
        const unregLeaderboard = domObserver.onClass(
            'GuildXPDisplay-Leaderboard',
            'LeaderboardPanel_leaderboardTable',
            (el) => this._renderLeaderboard(el)
        );
        this.unregisterObservers.push(unregLeaderboard);

        // Live refresh on data updates
        this._boundRefreshOverview = () => this._refreshOverviewIfVisible();
        this._boundRefreshMembers = () => this._refreshMembersIfVisible();
        this._boundRefreshLeaderboard = (data) => {
            if (data.leaderboardCategory === 'guild') this._refreshLeaderboardIfVisible();
        };

        webSocketHook.on('guild_updated', this._boundRefreshOverview);
        webSocketHook.on('guild_characters_updated', this._boundRefreshMembers);
        webSocketHook.on('leaderboard_updated', this._boundRefreshLeaderboard);

        this.unregisterObservers.push(() => {
            webSocketHook.off('guild_updated', this._boundRefreshOverview);
            webSocketHook.off('guild_characters_updated', this._boundRefreshMembers);
            webSocketHook.off('leaderboard_updated', this._boundRefreshLeaderboard);
        });

        this.initialized = true;
    }

    // ─── Overview tab ────────────────────────────────────────────────────────

    _renderOverview(dataGridEl) {
        // Remove previous injection
        dataGridEl.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());

        const guildName = guildXPTracker.getOwnGuildName();
        if (!guildName) return;

        const stats = guildXPTracker.getGuildStats(guildName);

        // XP/h stats row
        const rateLabel = stats.lastHourXPH > 0 ? 'Last hour XP/h' : 'Last XP/h';
        const rateValue = stats.lastHourXPH > 0 ? stats.lastHourXPH : stats.lastXPH;

        const statsHTML = `
            <div class="GuildPanel_dataBlockGroup__1d2rR ${CSS_PREFIX}">
                <div class="GuildPanel_dataBlock__3qVhK">
                    <div class="GuildPanel_label__-A63g">${rateLabel}</div>
                    <div class="GuildPanel_value__Hm2I9">${fNum(rateValue)}</div>
                </div>
                <div class="GuildPanel_dataBlock__3qVhK">
                    <div class="GuildPanel_label__-A63g">Last day XP/h</div>
                    <div class="GuildPanel_value__Hm2I9">${fNum(stats.lastDayXPH)}</div>
                </div>
            </div>`;

        // Chart row
        const chartHTML = `
            <div class="GuildPanel_dataBlockGroup__1d2rR ${CSS_PREFIX}" style="grid-column: 1 / 3; max-width: none;">
                <div class="GuildPanel_dataBlock__3qVhK" style="height: 240px;">
                    <div class="GuildPanel_label__-A63g">Last week XP/h</div>
                    ${buildChart(stats.chart)}
                </div>
            </div>`;

        dataGridEl.insertAdjacentHTML('beforeend', statsHTML + chartHTML);

        // Attach chart bar event listeners
        dataGridEl.querySelectorAll(`.${CSS_PREFIX}__bar`).forEach((bar) => {
            bar.addEventListener('mouseenter', this._onBarEnter);
            bar.addEventListener('mouseleave', this._onBarLeave);
        });

        // Time to level
        const timeToLevel = guildXPTracker.getTimeToLevel(guildName);
        if (timeToLevel !== null) {
            const ttlHTML = `<div class="${CSS_PREFIX}" style="color: var(--color-space-300); font-size: 13px;">${formatTimeLeft(timeToLevel)}</div>`;
            // Find the "Exp to Next Level" data block and append
            const dataBlocks = dataGridEl.querySelectorAll('.GuildPanel_dataBlock__3qVhK');
            for (const block of dataBlocks) {
                const label = block.querySelector('.GuildPanel_label__-A63g');
                if (label && label.textContent.includes('Exp to')) {
                    block.insertAdjacentHTML('beforeend', ttlHTML);
                    break;
                }
            }
        }
    }

    _refreshOverviewIfVisible() {
        const dataGridEl = document.querySelector('[class*="GuildPanel_dataGrid"]');
        if (dataGridEl) {
            this._renderOverview(dataGridEl);
        }
    }

    // ─── Members tab ─────────────────────────────────────────────────────────

    _renderMembers(tableEl) {
        // Skip if already rendered
        if (tableEl.querySelector(`.${CSS_PREFIX}`)) return;

        const guildID = guildXPTracker.getOwnGuildID();
        if (!guildID) return;

        const memberList = guildXPTracker.getMemberList();
        if (memberList.length === 0) return;

        // Widen the container
        const containerEl = tableEl.closest('[class*="GuildPanel_membersTab"]');
        if (containerEl) {
            containerEl.style.maxWidth = '1100px';
        }

        // Build name → characterID map from table rows
        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;

        const rows = Array.from(tbodyEl.children);
        const nameToCharId = {};
        for (const member of memberList) {
            nameToCharId[member.name] = member.characterID;
        }

        // Calculate stats for each row
        const allStats = [];
        for (const row of rows) {
            const name = row.children[0]?.textContent?.trim();
            const charId = nameToCharId[name];
            const memberStats = charId ? guildXPTracker.getMemberStats(charId) : { lastXPH: 0, lastDayXPH: 0 };
            const meta = charId ? guildXPTracker.getMemberMeta(charId) : null;
            const xp = charId ? guildXPTracker.getMemberXP(charId) : 0;

            allStats.push({
                name,
                charId,
                lastXPH: memberStats.lastXPH,
                lastDayXPH: memberStats.lastDayXPH,
                gameMode: meta?.gameMode || 'standard',
                joinTime: meta?.joinTime || null,
                xp: xp || 0,
            });
        }

        // Compute rankings
        const byLastXPH = allStats.slice().sort((a, b) => b.lastXPH - a.lastXPH);
        const byLastDayXPH = allStats.slice().sort((a, b) => b.lastDayXPH - a.lastDayXPH);
        for (let i = 0; i < byLastXPH.length; i++) byLastXPH[i].lastXPH_rank = i + 1;
        for (let i = 0; i < byLastDayXPH.length; i++) byLastDayXPH[i].lastDayXPH_rank = i + 1;

        const theadTr = tableEl.querySelector('thead tr');
        if (!theadTr) return;

        // Find Activity column index for inserting before it
        const activityIndex = Array.from(theadTr.children).findIndex((el) => el.textContent.trim() === 'Activity');
        const insertAfter = activityIndex > 0 ? activityIndex - 1 : theadTr.children.length - 1;

        const gameModes = { standard: 'MC', ironcow: 'IC', legacy_ironcow: 'LC' };

        // Game Mode column
        addColumn(tableEl, {
            name: 'Game Mode',
            insertAfter,
            data: allStats.map((s) => s.gameMode),
            format: (v) => gameModes[v] || v || '',
            makeSortable: true,
            sortId: 'gameMode',
            sortData: allStats.map((s) => s.gameMode || ''),
        });

        // Joined column
        addColumn(tableEl, {
            name: 'Joined',
            insertAfter: insertAfter + 1,
            data: allStats.map((s) => s.joinTime),
            format: (v) => (v ? new Date(v).toLocaleDateString() : ''),
            makeSortable: true,
            sortId: 'joinTime',
            sortData: allStats.map((s) => (s.joinTime ? +new Date(s.joinTime) : 0)),
        });

        // Last XP/h column
        addColumn(tableEl, {
            name: 'Last XP/h',
            insertAfter: insertAfter + 2,
            data: allStats.map((s) => s.lastXPH),
            format: (v, i) => {
                if (!v || v <= 0) return '';
                return `${fNum(v)} ${rankBadge(allStats[i].lastXPH_rank)}`;
            },
            makeSortable: true,
            sortId: 'lastXPH',
            sortData: allStats.map((s) => s.lastXPH),
        });

        // Last day XP/h column
        addColumn(tableEl, {
            name: 'Last day XP/h',
            insertAfter: insertAfter + 3,
            data: allStats.map((s) => s.lastDayXPH),
            format: (v, i) => {
                if (!v || v <= 0) return '';
                return `${fNum(v)} ${rankBadge(allStats[i].lastDayXPH_rank)}`;
            },
            makeSortable: true,
            sortId: 'lastDayXPH',
            sortData: allStats.map((s) => s.lastDayXPH),
        });

        // Make existing columns sortable
        const nameHeader = theadTr.children[0];
        if (nameHeader && !nameHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            makeColumnSortable(nameHeader, {
                sortId: 'name',
                valueGetter: (trEl) => trEl.children[0]?.textContent?.trim() || '',
            });
        }

        // Guild Exp column
        const expHeader = Array.from(theadTr.children).find((el) => el.textContent.includes('Guild Exp'));
        if (expHeader && !expHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            makeColumnSortable(expHeader, {
                sortId: 'xp',
                valueGetter: (trEl) => {
                    const name = trEl.children[0]?.textContent?.trim();
                    const stat = allStats.find((s) => s.name === name);
                    return stat?.xp || 0;
                },
            });
        }

        // Role column
        const rolePriority = { Leader: 1, General: 2, Officer: 3, Member: 4 };
        const roleHeader = Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Role');
        if (roleHeader && !roleHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            const roleColIndex = Array.from(theadTr.children).indexOf(roleHeader);
            makeColumnSortable(roleHeader, {
                sortId: 'role',
                valueGetter: (trEl) => {
                    const text = trEl.children[roleColIndex]?.textContent?.trim() || '';
                    return rolePriority[text] ?? 99;
                },
            });
        }

        // Activity column
        const activityHeader = Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Activity');
        if (activityHeader && !activityHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            const activityColIndex = Array.from(theadTr.children).indexOf(activityHeader);
            makeColumnSortable(activityHeader, {
                sortId: 'activity',
                valueGetter: (trEl) => {
                    const cell = trEl.children[activityColIndex];
                    if (!cell) return Infinity;
                    const text = cell.textContent?.trim() || '';
                    // Parse "Xd ago" format
                    const daysMatch = text.match(/(\d+)d\s*ago/);
                    if (daysMatch) return parseInt(daysMatch[1], 10) * 1440;
                    // Active players with SVG activity icons — group by href fragment
                    const useEl = cell.querySelector('use');
                    if (useEl) {
                        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
                        return href;
                    }
                    // Fallback
                    return text || Infinity;
                },
            });
        }

        // Status column
        const statusHeader = Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Status');
        if (statusHeader && !statusHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            const statusColIndex = Array.from(theadTr.children).indexOf(statusHeader);
            makeColumnSortable(statusHeader, {
                sortId: 'status',
                valueGetter: (trEl) => {
                    const text = trEl.children[statusColIndex]?.textContent?.trim() || '';
                    return text === 'Online' ? 0 : 1;
                },
            });
        }

        // Highlight self-player row
        const selfName = dataManager.getCurrentCharacterName();
        if (selfName) {
            for (const row of rows) {
                if (row.children[0]?.textContent?.trim() === selfName) {
                    row.style.backgroundColor = 'rgba(74, 222, 128, 0.1)';
                    break;
                }
            }
        }

        // Highlight inactive players (orange for days inactive, red for 10d+)
        if (activityHeader) {
            const actColIndex = Array.from(theadTr.children).indexOf(activityHeader);
            for (const row of rows) {
                // Skip self-player row
                if (selfName && row.children[0]?.textContent?.trim() === selfName) continue;
                const cell = row.children[actColIndex];
                if (!cell) continue;
                const text = cell.textContent?.trim() || '';
                const daysMatch = text.match(/(\d+)d\s*ago/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[1], 10);
                    if (days >= 10) {
                        row.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                    } else {
                        row.style.backgroundColor = 'rgba(251, 146, 60, 0.12)';
                    }
                }
            }
        }
    }

    _refreshMembersIfVisible() {
        // Members tab re-renders fully on data change, so DOM observer will re-fire.
        // No explicit refresh needed.
    }

    // ─── Leaderboard tab ─────────────────────────────────────────────────────

    _renderLeaderboard(tableEl) {
        // Skip if already rendered
        if (tableEl.querySelector(`.${CSS_PREFIX}`)) return;

        const allHistories = guildXPTracker.getAllGuildHistories();
        if (!allHistories || Object.keys(allHistories).length === 0) return;

        // Widen container
        const containerEl = tableEl.closest('[class*="LeaderboardPanel_content"]');
        if (containerEl) {
            containerEl.style.maxWidth = '1000px';
        }

        const tbodyEl = tableEl.querySelector('tbody');
        if (!tbodyEl) return;

        const rows = Array.from(tbodyEl.children);
        const theadTr = tableEl.querySelector('thead tr');
        if (!theadTr) return;

        // Calculate stats for each guild row
        const allStats = [];
        for (const row of rows) {
            // Leaderboard: col[0]=Rank, col[1]=Name
            const name = row.children[1]?.textContent?.trim();
            const stats = name ? guildXPTracker.getGuildStats(name) : { lastXPH: 0, lastDayXPH: 0 };
            allStats.push({
                name,
                lastXPH: stats.lastXPH,
                lastDayXPH: stats.lastDayXPH,
            });
        }

        // Compute rankings
        const byLastXPH = allStats.slice().sort((a, b) => b.lastXPH - a.lastXPH);
        const byLastDayXPH = allStats.slice().sort((a, b) => b.lastDayXPH - a.lastDayXPH);
        for (let i = 0; i < byLastXPH.length; i++) byLastXPH[i].lastXPH_rank = i + 1;
        for (let i = 0; i < byLastDayXPH.length; i++) byLastDayXPH[i].lastDayXPH_rank = i + 1;

        const insertAfter = theadTr.children.length - 1;

        // Last XP/h
        addColumn(tableEl, {
            name: 'Last XP/h',
            insertAfter,
            data: allStats.map((s) => s.lastXPH),
            format: (v, i) => {
                if (!v || v <= 0) return '';
                return `${fNum(v)} ${rankBadge(allStats[i].lastXPH_rank)}`;
            },
            makeSortable: true,
            sortId: 'lastXPH',
            skipFirst: true,
            sortData: allStats.map((s) => s.lastXPH),
        });

        // Last day XP/h
        addColumn(tableEl, {
            name: 'Last day XP/h',
            insertAfter: insertAfter + 1,
            data: allStats.map((s) => s.lastDayXPH),
            format: (v, i) => {
                if (!v || v <= 0) return '';
                return `${fNum(v)} ${rankBadge(allStats[i].lastDayXPH_rank)}`;
            },
            makeSortable: true,
            sortId: 'lastDayXPH',
            skipFirst: true,
            sortData: allStats.map((s) => s.lastDayXPH),
        });

        // Make Rank column sortable
        const rankHeader = Array.from(theadTr.children).find((el) => el.textContent.trim() === 'Rank');
        if (rankHeader && !rankHeader.querySelector(`.${CSS_PREFIX}__sort-icon`)) {
            makeColumnSortable(rankHeader, {
                sortId: 'rank',
                skipFirst: true,
                valueGetter: (trEl) => {
                    const text = trEl.children[0]?.textContent?.replace(/[^\d]/g, '');
                    return text ? parseInt(text, 10) : 0;
                },
            });
        }
    }

    _refreshLeaderboardIfVisible() {
        const tableEl = document.querySelector('[class*="LeaderboardPanel_leaderboardTable"]');
        if (tableEl) {
            // Remove existing columns and re-render
            tableEl.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());
            this._renderLeaderboard(tableEl);
        }
    }

    // ─── Chart tooltip handlers ──────────────────────────────────────────────

    _onBarEnter(event) {
        const el = event.target;
        const xpH = parseFloat(el.dataset.xph);
        const t = parseInt(el.dataset.t, 10);
        const truncated = el.dataset.truncated === 'true';

        const bb = el.getBoundingClientRect();
        const dbb = document.body.getBoundingClientRect();

        const tooltipHTML = `<div role="tooltip"
            class="${CSS_PREFIX}__tooltip MuiPopper-root MuiTooltip-popper css-112l0a2"
            style="position: absolute; inset: auto auto 0px 0px; margin: 0px; transform: translate(${Math.floor(bb.x - dbb.x)}px, ${Math.floor(bb.y - dbb.bottom)}px) translate(-50%, 0);"
            data-popper-placement="top">
            <div class="MuiTooltip-tooltip MuiTooltip-tooltipPlacementTop css-1spb1s5" style="opacity: 1;">
                <div class="ItemTooltipText_itemTooltipText__zFq3A">
                    <div class="ItemTooltipText_name__2JAHA">
                        <span>${new Date(t).toLocaleString()}</span>
                    </div>
                    <div>
                        <span>${fNum(xpH)} XP/h${truncated ? ' (anomalous)' : ''}</span>
                    </div>
                </div>
            </div>
        </div>`;

        // Remove existing tooltip
        document.body.querySelectorAll(`.${CSS_PREFIX}__tooltip`).forEach((el) => el.remove());
        document.body.insertAdjacentHTML('beforeend', tooltipHTML);
    }

    _onBarLeave() {
        document.body.querySelectorAll(`.${CSS_PREFIX}__tooltip`).forEach((el) => el.remove());
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    disable() {
        for (const unregister of this.unregisterObservers) {
            unregister();
        }
        this.unregisterObservers = [];
        this.timerRegistry.clearAll();

        // Remove all injected elements
        document.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());
        document.querySelectorAll(`.${CSS_PREFIX}__tooltip`).forEach((el) => el.remove());

        this.initialized = false;
    }
}

const guildXPDisplay = new GuildXPDisplay();

export default {
    name: 'Guild XP Display',
    initialize: () => guildXPDisplay.initialize(),
    cleanup: () => guildXPDisplay.disable(),
};
